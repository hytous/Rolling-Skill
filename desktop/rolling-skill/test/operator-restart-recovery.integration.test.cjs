const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {OperatorJobStore} = require("../src/operator/job-store.cjs")
const {OperatorJobEngine} = require("../src/operator/job-engine.cjs")
const {OperatorSessionManager} = require("../src/operator/operator-session-manager.cjs")
const {
    CapabilityStore,
    createTrustedHumanCapabilityIssuer,
} = require("../src/control-plane/capability-store.cjs")
const {ControlPlane} = require("../src/control-plane/control-plane.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy} = require("../src/control-plane/policy.cjs")

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
    constructor({onStartTurn = () => {}, autoCompleteTurns = false, failStart = false} = {}) {
        super()
        this.onStartTurn = onStartTurn
        this.autoCompleteTurns = autoCompleteTurns
        this.failStart = failStart
    }
    async start() {
        if (this.failStart) throw new Error("Runtime restoration failed")
    }
    async startThread() { return {thread: {id: "operator-restart-thread"}} }
    async resumeThread(threadId) { return {thread: {id: threadId}} }
    async startTurn() {
        this.onStartTurn()
        if (this.autoCompleteTurns) {
            queueMicrotask(() => this.emit("notification", {
                method: "turn/completed",
                params: {turn: {id: "operator-restart-turn", status: "completed"}},
            }))
        }
        return {turn: {id: "operator-restart-turn", status: "inProgress"}}
    }
    async stop() {}
}

function managerFixture(store, engine, {
    onCreateClient = () => {},
    createClient = () => new RecoveryRuntimeClient(),
    capabilities: suppliedCapabilities = null,
    controlPlane: suppliedControlPlane = null,
    resolveManagedSkillWorkspace = null,
} = {}) {
    let capabilitySequence = 0
    const capabilities = suppliedCapabilities ?? {
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
            createClient: () => {
                onCreateClient()
                return createClient()
            },
        },
        capabilities,
        controlPlane: suppliedControlPlane ?? {
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
        resolveManagedSkillWorkspace,
    })
}

function recoveredControlStack(store, engine, {onCreateClient, createClient} = {}) {
    const capabilities = new CapabilityStore()
    let manager
    const services = createDomainServices({
        operatorJobStore: store,
        operatorJobEngine: engine,
        operatorSessionManager: {
            resumeAfterApproval(sessionId) {
                return manager.resumeAfterApproval(sessionId)
            },
        },
    })
    const controlPlane = new ControlPlane({
        capabilities,
        policy: createControlPolicy(),
        services,
    })
    manager = managerFixture(store, engine, {
        capabilities,
        controlPlane,
        onCreateClient,
        createClient,
    })
    return {capabilities, controlPlane, manager}
}

async function resolveApprovalThroughHumanControl({
    capabilities,
    controlPlane,
    sessionId,
    approvalId,
    decision = "approve",
    idempotencyKey = `resolve-${approvalId}`,
}) {
    const issued = createTrustedHumanCapabilityIssuer(capabilities).issue({
        sessionId,
        actions: ["approvals.resolve"],
        scopes: {},
        expiresInMs: 60_000,
        budget: {},
    })
    return controlPlane.invoke({
        token: issued.token,
        sessionId,
        method: "approvals.resolve",
        params: {approvalId, decision, idempotencyKey},
    })
}

async function persistRecoveryTree() {
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
    const evaluationJob = initialStore.createJob({
        sessionId: created.session.id,
        parentJobId: created.parentJob.id,
        type: "evaluation",
        objective: "Recover evaluation by durable run ID",
        budget,
    })
    initialStore.transitionJob(evaluationJob.id, "running")
    const evaluation = initialStore.createStep(evaluationJob.id, {
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
        risk: "release",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    initialStore.close()
    return {registryPath, created, evaluationJob, evaluation, release, approval}
}

async function persistReleaseGate({
    pauseParent = false,
    decisionWithoutContinuation = null,
    expired = false,
} = {}) {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-release-restart-"))
    directories.push(directory)
    const registryPath = join(directory, "operator-jobs.json")
    const initialStore = new OperatorJobStore(registryPath)
    const initialEngine = new OperatorJobEngine({store: initialStore})
    const initialManager = managerFixture(initialStore, initialEngine)
    const created = await initialManager.create({
        runtimeId: runtime.runtimeId,
        modelId: "gpt-5.6-sol",
        effort: "high",
        objective: "Resume only after the durable release gate settles",
        actions: ["skills.release"],
        scopes: {
            skillIds: ["skill-1"],
            datasetIds: [],
            runtimeIds: [runtime.runtimeId],
            repositoryIds: ["repository-1"],
        },
        budget,
        expiresInMs: 60_000,
    })
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
        idempotencyKey: "restart-release-gate",
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
            idempotencyKey: "restart-release-gate",
            reservation: {},
        },
        risk: "release",
        expiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
    })
    if (decisionWithoutContinuation !== null) {
        initialStore.resolveApproval(approval.id, {
            decision: decisionWithoutContinuation,
            scope: "once",
            decidedBy: "restart-integration",
        })
    }
    if (pauseParent) await initialManager.pause(created.session.id)
    initialStore.close()
    return {registryPath, created, releaseJob, release, approval}
}

function appendPendingReleaseGate(registryPath, created, suffix) {
    const store = new OperatorJobStore(registryPath)
    const job = store.createJob({
        sessionId: created.session.id,
        parentJobId: created.parentJob.id,
        type: "release",
        objective: `Release another candidate ${suffix}`,
        budget,
    })
    store.transitionJob(job.id, "running")
    const step = store.createStep(job.id, {
        method: "skills.release",
        params: {
            skillId: "skill-1",
            versionId: `candidate-${suffix}`,
            versionLabel: `v1.0.${suffix}`,
        },
        reservation: {},
        idempotencyKey: `restart-release-${suffix}`,
    })
    store.transitionStep(step.id, "waiting_approval")
    store.transitionJob(job.id, "waiting_approval")
    const approval = store.createApproval(job.id, {
        stepId: step.id,
        action: "skills.release",
        scope: {skillIds: ["skill-1"]},
        proposedMutation: {
            method: "skills.release",
            params: {
                skillId: "skill-1",
                versionId: `candidate-${suffix}`,
                versionLabel: `v1.0.${suffix}`,
            },
            idempotencyKey: `restart-release-${suffix}`,
            reservation: {},
        },
        risk: "release",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    store.close()
    return {job, step, approval}
}

describe("Operator restart recovery integration", () => {
    it("resumes an unbounded Optimization Operator for more turns without creating an iteration limit", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-unbounded-restart-"))
        directories.push(directory)
        const registryPath = join(directory, "operator-jobs.json")
        const workspaceRoot = join(directory, "optimization-worktree")
        const resolveManagedSkillWorkspace = async (binding) => ({...binding, workspaceRoot})
        const initialStore = new OperatorJobStore(registryPath)
        const initialEngine = new OperatorJobEngine({store: initialStore})
        const initialManager = managerFixture(initialStore, initialEngine, {
            resolveManagedSkillWorkspace,
        })
        const created = await initialManager.create({
            runtimeId: runtime.runtimeId,
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Continue Optimization Epoch 2 after restart",
            actions: ["optimizations.read", "optimizations.execute"],
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: [runtime.runtimeId],
                repositoryIds: ["repository-1"],
            },
            budget: {},
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                optimizationRunId: "optimization-run-epoch-2",
            },
        })
        assert.equal(created.parentJob.checkpoint.optimizationRunId, "optimization-run-epoch-2")

        const recoveredStore = new OperatorJobStore(registryPath)
        const recoveredEngine = new OperatorJobEngine({store: recoveredStore})
        let runtimeTurns = 0
        const turnWaiters = []
        const recoveredManager = managerFixture(recoveredStore, recoveredEngine, {
            resolveManagedSkillWorkspace,
            createClient: () => new RecoveryRuntimeClient({
                autoCompleteTurns: true,
                onStartTurn: () => {
                    runtimeTurns += 1
                    turnWaiters.shift()?.()
                },
            }),
        })

        const resumed = await recoveredManager.restart(created.session.id)
        assert.equal(resumed.parentJob.checkpoint.optimizationRunId, "optimization-run-epoch-2")
        for (const message of ["Continue candidate editing", "Review evaluation evidence", "Submit the Epoch decision"]) {
            const completed = new Promise((resolve) => turnWaiters.push(resolve))
            await recoveredManager.followUp(created.session.id, message)
            await completed
            await new Promise((resolve) => setImmediate(resolve))
        }

        const transcript = recoveredStore.getSession(created.session.id).transcript
        assert.equal(runtimeTurns, 3)
        assert.equal(transcript.some((entry) => entry.kind === "operator_iteration_started"), false)
        assert.equal(transcript.some((entry) => entry.kind === "operator_iteration_limit_reached"), false)
        assert.equal(recoveredManager.get(created.session.id).state, "idle")
        recoveredStore.close()
        initialStore.close()
    })

    it("reconciles a running Evaluation by run ID and restores the untouched release gate", async () => {
        const {registryPath, created, evaluationJob, evaluation, release, approval} =
            await persistRecoveryTree()

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
        assert.equal(recoveredStore.getJob(evaluationJob.id).status, "running")
        assert.equal(recoveredStore.getStep(release.id).status, "waiting_approval")
        assert.equal(recoveredStore.getApproval(approval.id).status, "pending")
        assert.equal(resumed.parentJob.status, "waiting_approval")
        assert.equal(releaseExecutions, 0)
        recoveredStore.close()
    })

    it("fails closed when a pending release gate has an Evaluation descendant with unknown outcome", async () => {
        const {registryPath, created, evaluationJob, evaluation, release, approval} =
            await persistRecoveryTree()
        const recoveredStore = new OperatorJobStore(registryPath)
        let evaluationReconciliations = 0
        let releaseExecutions = 0
        let runtimeClients = 0
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
                    return {status: "running", result: {runId: input.runId}}
                },
                release: async () => {
                    releaseExecutions += 1
                    return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                },
            },
        })
        const {capabilities, controlPlane, manager: recoveredManager} = recoveredControlStack(
            recoveredStore,
            recoveredEngine,
            {onCreateClient: () => { runtimeClients += 1 }},
        )

        await assert.rejects(
            () => recoveredManager.restart(created.session.id),
            /cannot resume while needs_recovery/iu,
        )

        assert.equal(evaluationReconciliations, 1)
        assert.equal(recoveredStore.getStep(evaluation.id).status, "needs_recovery")
        assert.equal(recoveredStore.getJob(evaluationJob.id).status, "needs_recovery")
        assert.equal(recoveredStore.getStep(release.id).status, "waiting_approval")
        assert.equal(recoveredStore.getApproval(approval.id).status, "pending")
        assert.equal(recoveredStore.getJob(created.parentJob.id).status, "needs_recovery")
        assert.equal(runtimeClients, 0)
        assert.equal(releaseExecutions, 0)

        const request = {
            capabilities,
            controlPlane,
            sessionId: created.session.id,
            approvalId: approval.id,
            idempotencyKey: "resolve-with-unknown-descendant",
        }
        await assert.rejects(
            () => resolveApprovalThroughHumanControl(request),
            (error) => error.code === "CONTROL_BUSY" && error.retryable === true,
        )
        assert.equal(recoveredStore.getApproval(approval.id).status, "approved")
        assert.equal(recoveredStore.getStep(release.id).status, "succeeded")
        assert.equal(recoveredStore.getJob(created.parentJob.id).status, "needs_recovery")
        assert.equal(runtimeClients, 0)
        assert.equal(releaseExecutions, 1)
        await assert.rejects(
            () => resolveApprovalThroughHumanControl(request),
            (error) => error.code === "CONTROL_BUSY" && error.retryable === true,
        )
        assert.equal(releaseExecutions, 1)
        recoveredStore.close()
    })

    it("keeps a paused parent at its pending release gate without restoring a Runtime", async () => {
        const {registryPath, created, release, approval} = await persistReleaseGate({pauseParent: true})
        const recoveredStore = new OperatorJobStore(registryPath)
        let releaseExecutions = 0
        let runtimeClients = 0
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseExecutions += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
            reconcilers: {
                release: async () => {
                    releaseExecutions += 1
                    return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                },
            },
        })
        const recoveredManager = managerFixture(recoveredStore, recoveredEngine, {
            onCreateClient: () => { runtimeClients += 1 },
        })

        const resumed = await recoveredManager.restart(created.session.id)

        assert.equal(resumed.parentJob.status, "waiting_approval")
        assert.equal(resumed.state, "waiting_approval")
        assert.equal(recoveredStore.getStep(release.id).status, "waiting_approval")
        assert.equal(recoveredStore.getApproval(approval.id).status, "pending")
        assert.equal(runtimeClients, 0)
        assert.equal(releaseExecutions, 0)
        recoveredStore.close()
    })

    it("automatically restores a cold Runtime after a human resolves its last pending Approval", async () => {
        const {registryPath, created, release, approval} = await persistReleaseGate({
            pauseParent: true,
        })
        const recoveredStore = new OperatorJobStore(registryPath)
        let releaseHandlerCalls = 0
        let releaseReconciliations = 0
        let runtimeClients = 0
        let runtimeTurns = 0
        let resolveFollowUpTurn
        const followUpTurn = new Promise((resolve) => { resolveFollowUpTurn = resolve })
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseHandlerCalls += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
            reconcilers: {
                release: async () => {
                    releaseReconciliations += 1
                    return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                },
            },
        })
        const {capabilities, controlPlane, manager} = recoveredControlStack(
            recoveredStore,
            recoveredEngine,
            {
                onCreateClient: () => { runtimeClients += 1 },
                createClient: () => new RecoveryRuntimeClient({
                    autoCompleteTurns: true,
                    onStartTurn: () => {
                        runtimeTurns += 1
                        resolveFollowUpTurn()
                    },
                }),
            },
        )

        const waiting = await manager.restart(created.session.id)
        assert.equal(waiting.parentJob.status, "waiting_approval")
        assert.equal(waiting.state, "waiting_approval")
        assert.equal(runtimeClients, 0)

        const resolved = await resolveApprovalThroughHumanControl({
            capabilities,
            controlPlane,
            sessionId: created.session.id,
            approvalId: approval.id,
        })

        assert.equal(resolved.approval.status, "approved")
        assert.equal(recoveredStore.getStep(release.id).status, "succeeded")
        assert.equal(manager.get(created.session.id).parentJob.status, "running")
        assert.equal(runtimeClients, 1)
        assert.ok(releaseHandlerCalls + releaseReconciliations <= 1)
        await manager.followUp(created.session.id, "Continue after the approved release gate")
        await followUpTurn
        assert.equal(runtimeTurns, 1)
        recoveredStore.close()
    })

    it("keeps the cold Runtime stopped while another Approval remains pending", async () => {
        const {registryPath, created, approval} = await persistReleaseGate({pauseParent: true})
        const second = appendPendingReleaseGate(registryPath, created, "second")
        const recoveredStore = new OperatorJobStore(registryPath)
        let releaseExecutions = 0
        let runtimeClients = 0
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseExecutions += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
        })
        const {capabilities, controlPlane, manager} = recoveredControlStack(
            recoveredStore,
            recoveredEngine,
            {onCreateClient: () => { runtimeClients += 1 }},
        )

        await manager.restart(created.session.id)
        await resolveApprovalThroughHumanControl({
            capabilities,
            controlPlane,
            sessionId: created.session.id,
            approvalId: approval.id,
        })

        assert.equal(recoveredStore.getApproval(approval.id).status, "approved")
        assert.equal(recoveredStore.getApproval(second.approval.id).status, "pending")
        assert.equal(manager.get(created.session.id).parentJob.status, "waiting_approval")
        assert.equal(runtimeClients, 0)
        assert.equal(releaseExecutions, 1)
        recoveredStore.close()
    })

    it("retries Runtime restoration after durable Approval resolution without replaying release", async () => {
        const {registryPath, created, approval} = await persistReleaseGate({pauseParent: true})
        const recoveredStore = new OperatorJobStore(registryPath)
        let releaseExecutions = 0
        let runtimeClients = 0
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseExecutions += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
        })
        const {capabilities, controlPlane, manager} = recoveredControlStack(
            recoveredStore,
            recoveredEngine,
            {
                onCreateClient: () => { runtimeClients += 1 },
                createClient: () => new RecoveryRuntimeClient({failStart: runtimeClients === 1}),
            },
        )

        await manager.restart(created.session.id)
        const request = {
            capabilities,
            controlPlane,
            sessionId: created.session.id,
            approvalId: approval.id,
            idempotencyKey: "retry-approved-runtime-resume",
        }
        await assert.rejects(
            () => resolveApprovalThroughHumanControl(request),
            (error) => error.code === "CONTROL_BUSY" && error.retryable === true,
        )
        assert.equal(recoveredStore.getApproval(approval.id).status, "approved")
        assert.equal(releaseExecutions, 1)

        const retried = await resolveApprovalThroughHumanControl(request)

        assert.equal(retried.approval.status, "approved")
        assert.equal(manager.get(created.session.id).parentJob.status, "running")
        assert.equal(runtimeClients, 2)
        assert.equal(releaseExecutions, 1)
        recoveredStore.close()
    })

    it("continues an approved release Step left waiting by a crash exactly once", async () => {
        const {registryPath, created, release, approval} = await persistReleaseGate({
            decisionWithoutContinuation: "approve",
        })
        const recoveredStore = new OperatorJobStore(registryPath)
        let releaseHandlerCalls = 0
        let releaseReconciliations = 0
        const recoveredEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {
                "skills.release": async () => {
                    releaseHandlerCalls += 1
                    return {versionId: "candidate-1", versionLabel: "v1.0.0"}
                },
            },
            reconcilers: {
                release: async () => {
                    releaseReconciliations += 1
                    return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                },
            },
        })
        const recoveredManager = managerFixture(recoveredStore, recoveredEngine)

        await recoveredManager.restart(created.session.id)

        assert.equal(recoveredStore.getApproval(approval.id).status, "approved")
        assert.equal(recoveredStore.getStep(release.id).status, "succeeded")
        assert.equal(releaseHandlerCalls, 1)
        assert.equal(releaseReconciliations, 0)
        assert.ok(releaseHandlerCalls + releaseReconciliations <= 1)
        recoveredStore.close()
    })

    it("settles rejected and expired release Steps left waiting by a crash", async () => {
        for (const scenario of ["rejected", "expired"]) {
            const {registryPath, created, release, approval} = await persistReleaseGate({
                decisionWithoutContinuation: scenario === "rejected" ? "reject" : null,
                expired: scenario === "expired",
            })
            const recoveredStore = new OperatorJobStore(registryPath)
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
                    release: async () => {
                        releaseExecutions += 1
                        return {status: "released", candidateId: "candidate-1", tag: "v1.0.0"}
                    },
                },
            })
            const recoveredManager = managerFixture(recoveredStore, recoveredEngine)

            await recoveredManager.restart(created.session.id)

            assert.equal(recoveredStore.getApproval(approval.id).status, "rejected", scenario)
            assert.equal(recoveredStore.getStep(release.id).status, "failed", scenario)
            assert.equal(recoveredStore.getStep(release.id).error.code, (
                scenario === "expired" ? "APPROVAL_EXPIRED" : "APPROVAL_REJECTED"
            ))
            assert.equal(releaseExecutions, 0, scenario)
            recoveredStore.close()
        }
    })
})
