const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {OperatorJobStore} = require("../src/operator/job-store.cjs")
const {OperatorJobEngine} = require("../src/operator/job-engine.cjs")
const {OperatorSessionManager} = require("../src/operator/operator-session-manager.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

const runtime = {
    runtimeId: "codex:restart-smoke",
    providerId: "codex",
    displayName: "Codex",
    version: "smoke",
    executablePath: "/usr/local/bin/codex",
    capabilities: ["threads"],
}

const budget = {
    maxDurationMs: 60_000,
    maxRuntimeTurns: 10,
    maxEvaluations: 2,
    maxTargetExecutions: 20,
    maxJudgeExecutions: 20,
    maxTokens: null,
    maxReportedCost: null,
}

class RecoveryRuntimeClient extends EventEmitter {
    async start() {}
    async startThread() { return {thread: {id: "operator-restart-thread"}} }
    async resumeThread(threadId) { return {thread: {id: threadId}} }
    async startTurn() { return {turn: {id: "operator-restart-turn", status: "inProgress"}} }
    async stop() {}
}

function managerFixture(store, engine) {
    let capabilitySequence = 0
    const capabilities = {
        issue(request) {
            capabilitySequence += 1
            return {
                id: `capability-${capabilitySequence}`,
                token: `private-token-${capabilitySequence}`,
                ...request,
            }
        },
        revoke() { return true },
    }
    return new OperatorSessionManager({
        store,
        engine,
        runtimeRegistry: {
            discover: () => ({available: [runtime], selected: runtime}),
            createClient: () => new RecoveryRuntimeClient(),
        },
        capabilities,
        controlPlane: {
            async invoke() { throw new Error("Control invocation is not part of restart recovery") },
            registerOperatorExecutor() {
                let enabled = true
                return {
                    disable() { const changed = enabled; enabled = false; return changed },
                    enable() { const changed = !enabled; enabled = true; return changed },
                    unregister() { enabled = false; return true },
                }
            },
        },
        controlSocketPath: "/private/operator-restart-smoke.sock",
        transportFactory({childEnvironment}) {
            return {
                freeze: () => ({kind: "codex-dynamic", ready: true}),
                dynamicTools: () => [],
                mcpServers: () => [],
                childEnvironment: () => ({...childEnvironment}),
            }
        },
        transportSupport: () => ({dynamicToolsReady: true, mcpServersReady: false}),
        supportsNativeResume: () => true,
    })
}

describe("Operator restart recovery integration", () => {
    it("reconciles a running Evaluation by run ID and restores the untouched release gate", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-restart-"))
        directories.push(directory)
        const registryPath = join(directory, "operator-jobs.json")
        const initialStore = new OperatorJobStore(registryPath)
        const initialEngine = new OperatorJobEngine({store: initialStore})
        const initialManager = managerFixture(initialStore, initialEngine)
        const created = await initialManager.create({
            runtimeId: runtime.runtimeId,
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Recover evaluation before releasing the candidate",
            actions: ["evaluations.execute", "skills.release"],
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: [runtime.runtimeId],
                repositoryIds: ["repository-1"],
            },
            budget,
            expiresInMs: 60_000,
        })
        const evaluation = initialStore.createStep(created.parentJob.id, {
            method: "evaluations.start",
            params: {
                runId: "evaluation-run-restart",
                datasetId: "dataset-1",
                selectionMode: "selected",
                caseIds: ["case-1"],
                runtimeConfigurations: [{runtimeId: runtime.runtimeId}],
            },
            reservation: {evaluations: 1, targetExecutions: 1},
            idempotencyKey: "restart-evaluation",
        })
        initialStore.transitionStep(evaluation.id, "running")
        const releaseJob = initialStore.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "release",
            objective: "Release candidate after human approval",
            budget,
        })
        initialStore.transitionJob(releaseJob.id, "running")
        const release = initialStore.createStep(releaseJob.id, {
            method: "skills.release",
            params: {
                skillId: "skill-1",
                versionId: "candidate-1",
                versionLabel: "v1.0.0",
            },
            reservation: {},
            idempotencyKey: "restart-release",
        })
        initialStore.transitionStep(release.id, "waiting_approval")
        initialStore.transitionJob(releaseJob.id, "waiting_approval")
        const approval = initialStore.createApproval(releaseJob.id, {
            stepId: release.id,
            action: "skills.release",
            scope: {skillIds: ["skill-1"]},
            proposedMutation: {
                method: "skills.release",
                params: {
                    skillId: "skill-1",
                    versionId: "candidate-1",
                    versionLabel: "v1.0.0",
                },
                idempotencyKey: "restart-release",
                reservation: {},
            },
            risk: "release_requires_human_approval",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
        initialStore.close()

        const recoveredStore = new OperatorJobStore(registryPath)
        let evaluationReconciliations = 0
        let releaseExecutions = 0
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseExecutions += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
            reconcilers: {
                evaluation: async (input) => {
                    evaluationReconciliations += 1
                    assert.equal(input.runId, "evaluation-run-restart")
                    return {
                        status: "completed",
                        result: {runId: "evaluation-run-restart"},
                    }
                },
                release: async () => {
                    releaseExecutions += 1
                    return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                },
            },
        })
        const recoveredManager = managerFixture(recoveredStore, recoveredEngine)

        const resumed = await recoveredManager.restart(created.session.id)

        assert.equal(evaluationReconciliations, 1)
        assert.equal(recoveredStore.getStep(evaluation.id).status, "succeeded")
        assert.equal(recoveredStore.getStep(release.id).status, "waiting_approval")
        assert.equal(recoveredStore.getApproval(approval.id).status, "pending")
        assert.equal(resumed.parentJob.status, "waiting_approval")
        assert.equal(releaseExecutions, 0)
        recoveredStore.close()
    })
})
