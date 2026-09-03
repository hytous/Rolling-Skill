"use strict"

const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {OptimizationRunner} = require("../src/optimization/optimization-runner.cjs")
const {OptimizationOperatorGateway} = require("../src/optimization/optimization-operator-gateway.cjs")
const {OperatorJobEngine} = require("../src/operator/job-engine.cjs")
const {OperatorJobStore} = require("../src/operator/job-store.cjs")

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function candidate(runId, epoch) {
    return {
        id: `candidate-${epoch}`,
        repositoryId: "repository-1",
        skillId: "skill-1",
        state: "candidate",
        commit: String(epoch).repeat(40),
        skillRoot: "skills/billing",
        contentDigest: digest(String(epoch)),
        createdBy: "optimization",
        optimizationRunId: runId,
        optimizationEpoch: epoch,
    }
}

function evaluation(id, score) {
    return {
        id,
        status: "completed",
        results: [
            evaluatedResult("case-1", "codex:target", score),
            evaluatedResult("case-2", "codex:target", score),
        ],
    }
}

function evaluatedResult(caseId, runtimeId, score) {
    return {
        id: `${caseId}:${runtimeId}`,
        caseId,
        runtimeId,
        status: "completed",
        gradingStatus: "completed",
        computedScore: {
            totalScore: score,
            overallVerdict: score >= 80 ? "pass" : "fail",
            outcomeTier: score >= 80 ? "formal_pass" : "fail",
            criticalFailures: [],
        },
    }
}

class MemoryOptimizationStore {
    constructor(run, childJobs) {
        this.run = structuredClone(run)
        this.childJobs = childJobs
        this.transitions = []
    }

    getRun(runId) {
        assert.equal(runId, this.run.id)
        return structuredClone(this.run)
    }

    transitionRun(_runId, state, patch = {}) {
        assert.equal(this.childJobs.active, 0, `phase advanced to ${state} before child terminal`)
        this.run.state = state
        if (["installing", "evaluating", "deciding"].includes(state)) {
            const epoch = this.run.epochs.at(-1)
            if (epoch && epoch.status !== "deciding") epoch.status = state
        }
        if (patch.checkpoint) this.run.checkpoint = structuredClone(patch.checkpoint)
        if (patch.error !== undefined) this.run.error = structuredClone(patch.error)
        this.transitions.push(state)
        return {runId: this.run.id, state}
    }

    createEpoch() {
        const number = this.run.epochs.length + 1
        const epoch = {
            id: `epoch-${number}`,
            number,
            status: "editing",
            candidateArtifactId: null,
            installArtifactIds: [],
            evaluationArtifactIds: [],
            analysisArtifactId: null,
            decisionArtifactId: null,
        }
        this.run.epochs.push(epoch)
        this.run.currentEpoch = number
        return {epochId: epoch.id, index: number, status: epoch.status}
    }

    updateEpoch(_runId, epochId, patch) {
        const epoch = this.run.epochs.find((entry) => entry.id === epochId)
        Object.assign(epoch, structuredClone(patch))
        return {epochId, status: epoch.status}
    }

    updateCheckpoint(_runId, patch) {
        Object.assign(this.run.checkpoint, structuredClone(patch))
        this.run.revision += 1
        return structuredClone(this.run)
    }
}

function runnerFixture(options = {}) {
    const run = {
        id: "optimization-run-1",
        state: "preflight",
        revision: 0,
        snapshot: {
            digest: digest("a"),
            baseline: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "released-baseline",
                state: "released",
                commit: "a".repeat(40),
                skillRoot: "skills/billing",
                contentDigest: digest("a"),
            },
            dataset: {
                id: "dataset-1",
                revision: 7,
                caseRevisions: [
                    {caseId: "case-1", revision: 3},
                    {caseId: "case-2", revision: 5},
                ],
                digest: digest("b"),
            },
            rubric: {id: "rubric-1", version: 4, digest: digest("c")},
            targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "high"}],
            judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "high"},
            activationMode: "automatic",
            mode: "adaptive",
            limits: {
                maxEpochs: 3,
                maxDurationMs: 3_600_000,
                maxTurns: 50,
                maxTokens: null,
                maxCostMicros: null,
                patience: 2,
                minimumImprovement: 1,
            },
            target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
        },
        epochs: [],
        currentEpoch: 0,
        checkpoint: {},
        error: null,
    }
    const childJobs = {
        active: 0,
        sequence: [],
        async run(input, operation) {
            this.active += 1
            this.sequence.push({event: "started", type: input.type})
            try {
                const result = await operation({jobId: `child-${this.sequence.length}`})
                this.sequence.push({event: "terminal", type: input.type})
                return result
            } finally {
                this.active -= 1
            }
        },
    }
    const store = new MemoryOptimizationStore(run, childJobs)
    const artifacts = []
    const artifactStore = {
        createArtifact(_jobId, input) {
            const artifact = {id: `artifact-${artifacts.length + 1}`, ...structuredClone(input)}
            artifacts.push(artifact)
            return artifact
        },
        readArtifactBody(artifactId) {
            const artifact = artifacts.find((entry) => entry.id === artifactId)
            if (!artifact) throw new Error("Unknown artifact")
            return Buffer.from(artifact.body, "utf8")
        },
    }
    const installationJobs = new Map()
    const installationCalls = []
    let installationSequence = 0
    const installationManager = {
        store: {getJob(jobId) { return structuredClone(installationJobs.get(jobId)) }},
        async startOptimizationExperiment(input) {
            installationCalls.push({kind: "experiment", ...structuredClone(input)})
            return input.targets.map((target) => {
                const id = `installation-${++installationSequence}`
                const classification = input.operation === "experiment_inspect"
                    ? "managed-clean"
                    : target.initial?.classification ?? "managed-clean"
                installationJobs.set(id, {
                    id,
                    status: "succeeded",
                    runtime: {runtimeId: target.runtimeId},
                    parsedResult: {
                        status: "succeeded",
                        classificationBefore: classification,
                        destination: "/runtime/skills/billing",
                        result: {actualDigest: input.run.snapshot.baseline.contentDigest},
                    },
                })
                return {id}
            })
        },
        async start(input) {
            installationCalls.push({kind: "released", ...structuredClone(input)})
            return input.targets.map((target) => {
                const id = `installation-${++installationSequence}`
                installationJobs.set(id, {
                    id,
                    status: "succeeded",
                    runtime: {runtimeId: target.runtimeId},
                    parsedResult: {status: "succeeded"},
                })
                return {id}
            })
        },
        async wait(jobId) { return structuredClone(installationJobs.get(jobId)) },
    }
    const evaluationCalls = []
    const scores = [70, 80, 95]
    const evaluationManager = {
        async run(input) {
            evaluationCalls.push(structuredClone(input))
            const result = evaluation(`evaluation-${evaluationCalls.length}`, scores.shift())
            result.results = input.targets.flatMap((target) => result.results.map((entry) => ({...entry, id: `${entry.caseId}:${target.runtimeId}`, runtimeId: target.runtimeId})))
            return result
        },
    }
    let candidateEpoch = 0
    const workspaceManager = {
        createCalls: 0,
        registered: null,
        async create() {
            this.createCalls += 1
            this.registered = {
                runId: run.id,
                workspacePath: "/app-support/optimization-workspaces/optimization-run-1",
            }
            return structuredClone(this.registered)
        },
        get(runId) {
            assert.equal(runId, run.id)
            if (!this.registered) throw new Error("Unknown workspace")
            return structuredClone(this.registered)
        },
        async createCandidate(input) {
            assert.equal(input.epoch > candidateEpoch, true)
            candidateEpoch = input.epoch
            return candidate(run.id, candidateEpoch)
        },
        async cleanup() {},
    }
    const operatorGateway = {
        candidateRequests: 0,
        decisionRequests: 0,
        async requestCandidate() {
            this.candidateRequests += 1
            return {message: `Candidate ${this.candidateRequests}`}
        },
        async requestDecision() {
            this.decisionRequests += 1
            return {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: this.decisionRequests === 1 ? "continue" : "finish",
                rationale: "deterministic fixture decision",
            }
        },
    }
    const approvalCalls = []
    const approvals = {
        async request(input, onPending) {
            approvalCalls.push(structuredClone(input))
            const approvalId = `approval-${approvalCalls.length}`
            onPending?.({approvalId})
            return {approved: true, approvalId}
        },
        async reject() {},
        suspend() { return false },
    }
    const releaseCalls = []
    const releaseManager = {
        async release(input) {
            releaseCalls.push(structuredClone(input))
            return {...input.candidate, id: "released-optimized", state: "released"}
        },
    }
    const runner = new OptimizationRunner({
        store,
        artifactStore,
        childJobs,
        workspaceManager,
        installationManager,
        evaluationManager,
        operatorGateway,
        approvals,
        releaseManager,
        telemetry: ({runId}) => {
            assert.equal(runId, run.id, "Telemetry must receive the real Core adapter contract")
            return {elapsedMs: 1_000, turnsUsed: 2, tokensUsed: null, costMicros: null}
        },
        ...options,
    })
    return {
        run,
        store,
        runner,
        childJobs,
        artifacts,
        installationCalls,
        installationManager,
        installationJobs,
        evaluationCalls,
        evaluationManager,
        workspaceManager,
        operatorGateway,
        approvals,
        approvalCalls,
        releaseManager,
        releaseCalls,
    }
}

describe("multi-Epoch OptimizationRunner", () => {
    it("cancels a real pending Operator submission without waiting for another model response", async () => {
        const gateway = new OptimizationOperatorGateway()
        const fixture = runnerFixture({operatorGateway: gateway})
        const operation = fixture.runner.run(fixture.run.id, {operatorSessionId: "operator-session-1", parentJobId: "operator-job-1"})
        for (let index = 0; index < 20 && !gateway.pending(fixture.run.id); index += 1) await new Promise((resolve) => setImmediate(resolve))
        assert.equal(gateway.pending(fixture.run.id)?.kind, "candidate")
        fixture.runner.stop(fixture.run.id)
        assert.equal(gateway.pending(fixture.run.id), null, "Stop must release the pending request immediately")
        assert.equal((await operation).status, "cancelled")
        assert.equal(fixture.installationCalls.length, 0)
    })
    it("can cancel a recovered pre-install run without resuming the Agent", async () => {
        const gateway = new OptimizationOperatorGateway()
        const fixture = runnerFixture({operatorGateway: gateway})
        fixture.store.updateCheckpoint(fixture.run.id, {operatorSessionId: "operator-session-1", operatorParentJobId: "operator-job-1"})
        const operation = fixture.runner.run(fixture.run.id, {operatorSessionId: "operator-session-1", parentJobId: "operator-job-1"})
        for (let index = 0; index < 20 && !gateway.pending(fixture.run.id); index += 1) await new Promise((resolve) => setImmediate(resolve))
        fixture.runner.pause(fixture.run.id)
        assert.equal((await operation).status, "paused")
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.pauseReason, "user_pause")
        fixture.runner.stop(fixture.run.id)
        await fixture.runner.waitForIdle()
        assert.equal(fixture.store.getRun(fixture.run.id).state, "cancelled")
        assert.equal(fixture.installationCalls.length, 0)
    })
    it("preserves an incomplete baseline and stops before changing the Skill when Judge is unavailable", async () => {
        const failed = evaluation("baseline-capacity-error", 70)
        failed.results[0].gradingStatus = "failed"
        failed.results[0].gradingError = "Selected model is at capacity"
        failed.results[0].computedScore = null
        const fixture = runnerFixture({evaluationManager: {run: async () => failed}})
        const outcome = await fixture.runner.run(fixture.run.id, {operatorSessionId: "operator-session-1", parentJobId: "operator-job-1"})
        assert.equal(outcome.status, "failed")
        assert.equal(fixture.store.getRun(fixture.run.id).error.code, "OPTIMIZATION_BASELINE_INCOMPLETE")
        assert.match(fixture.store.getRun(fixture.run.id).error.message, /at capacity/)
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.baselineEvaluationRunId, failed.id)
        assert.equal(fixture.operatorGateway.candidateRequests, 0)
        assert.equal(fixture.installationCalls.length, 0)
    })
    it("uses the controller-created registered workspace without creating a second worktree", async () => {
        const fixture = runnerFixture()
        const workspace = {
            runId: fixture.run.id,
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "released-baseline",
            workspacePath: "/app-support/optimization-workspaces/optimization-run-1",
            branchName: "rolling-skill/optimization/optimization-run-1",
            baselineCommit: "a".repeat(40),
        }

        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
            workspace,
        })

        assert.equal(outcome.status, "succeeded")
        assert.equal(fixture.workspaceManager.createCalls, 0)
    })

    it("keeps ordinary Skill release automatic while Optimization waits for one final approval", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-approval-boundary-"))
        const operatorStore = new OperatorJobStore(join(directory, "operator-jobs.json"))
        try {
            const session = operatorStore.createSession({
                runtime: {
                    runtimeId: "codex:operator",
                    providerId: "codex",
                    displayName: "Codex Operator",
                    version: "1.0.0",
                    executablePath: "/usr/local/bin/codex",
                },
                modelId: "gpt-5.6-sol",
                effort: "high",
                protocol: "rolling-skill-operator/v1",
                capabilityId: "capability-1",
            })
            const job = operatorStore.createJob({
                sessionId: session.id,
                type: "operator",
                objective: "Improve the billing Skill",
                budget: {maxIterations: 50},
            })
            let ordinaryReleaseCalls = 0
            const engine = new OperatorJobEngine({
                store: operatorStore,
                handlers: {
                    "skills.release": async () => {
                        ordinaryReleaseCalls += 1
                        return {released: true}
                    },
                },
            })

            const ordinaryRelease = await engine.execute(job.id, {
                method: "skills.release",
                params: {
                    skillId: "skill-1",
                    versionId: "candidate-manual",
                    versionLabel: "v1.1.0",
                },
                idempotencyKey: "ordinary-skill-release",
            })
            assert.equal(ordinaryRelease.status, "succeeded")
            assert.equal(ordinaryReleaseCalls, 1)
            assert.equal(operatorStore.listApprovals(job.id).length, 0)

            const fixture = runnerFixture()
            fixture.approvals.request = (input, onPending) => {
                const scope = {
                    runId: input.runId,
                    epoch: input.epoch,
                    candidateVersionId: input.candidate.id,
                }
                return engine.requestApproval(job.id, {
                    action: `optimization.${input.kind}`,
                    risk: "Release and install the improved Candidate",
                    scope,
                    proposedMutation: scope,
                    idempotencyKey: `${input.runId}:${input.kind}:${input.epoch}`,
                }, {onPending})
            }
            const operation = fixture.runner.run(fixture.run.id, {
                operatorSessionId: session.id,
                parentJobId: job.id,
            })
            for (let index = 0; index < 30 && operatorStore.listApprovals(job.id).length === 0; index += 1) {
                await new Promise((resolve) => setImmediate(resolve))
            }

            const pending = operatorStore.listApprovals(job.id)
            const stored = fixture.store.getRun(fixture.run.id)
            assert.equal(stored.state, "waiting_approval")
            assert.ok(stored.epochs.at(-1).candidateArtifactId)
            assert.equal(pending.length, 1)
            assert.equal(pending[0].status, "pending")
            assert.equal(pending[0].action, "optimization.release-install")

            await engine.resolveApproval(pending[0].id, {
                decision: "reject",
                scope: "action",
                decidedBy: "test-user",
            })
            assert.equal((await operation).status, "cancelled")
        } finally {
            operatorStore.close()
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it("runs baseline, two Candidates, and one approved release-install in engine-owned order", async () => {
        const fixture = runnerFixture()
        const frozenDataset = JSON.stringify(fixture.run.snapshot.dataset)
        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        const stored = fixture.store.getRun(fixture.run.id)

        assert.equal(outcome.status, "succeeded")
        assert.equal(stored.state, "succeeded")
        assert.equal(stored.epochs.length, 2, "baseline must not count as an Epoch")
        assert.equal(JSON.stringify(stored.snapshot.dataset), frozenDataset)
        assert.equal(JSON.stringify(stored.snapshot.rubric), JSON.stringify(fixture.run.snapshot.rubric))
        assert.deepEqual(
            fixture.installationCalls.map((entry) => [entry.kind, entry.operation ?? entry.versionId]),
            [
                ["experiment", "experiment_inspect"],
                ["experiment", "experiment_install"],
                ["experiment", "experiment_install"],
                ["released", "released-optimized"],
            ],
        )
        assert.equal(
            fixture.installationCalls.some((entry) =>
                entry.operation === "experiment_restore" || entry.operation === "experiment_remove"),
            false,
            "Candidate 1 must rotate directly to Candidate 2",
        )
        assert.deepEqual(fixture.evaluationCalls.map((entry) => entry.kind), [
            "baseline",
            "candidate",
            "candidate",
        ])
        assert.equal(fixture.operatorGateway.candidateRequests, 2)
        assert.equal(fixture.operatorGateway.decisionRequests, 2)
        assert.deepEqual(fixture.approvalCalls.map((entry) => entry.kind), ["release-install"])
        assert.equal(
            fixture.approvalCalls.every((entry) => entry.parentJobId === "operator-job-1"),
            true,
        )
        assert.equal(fixture.releaseCalls.length, 1)
        assert.equal(stored.checkpoint.finalApprovalId, "approval-1")
        assert.equal(stored.checkpoint.installApprovalId, undefined)
        assert.equal(stored.checkpoint.finalEvaluationArtifactId, undefined)
        assert.equal(stored.checkpoint.finalRegressionPassed, undefined)
        assert.equal(fixture.workspaceManager.createCalls, 1)
        assert.equal(fixture.childJobs.active, 0)
        assert.equal(
            fixture.childJobs.sequence.filter((entry) => entry.event === "started").length,
            fixture.childJobs.sequence.filter((entry) => entry.event === "terminal").length,
        )
    })

    it("checkpoints the final approval id while the user decision is still pending", async () => {
        const fixture = runnerFixture()
        let settleApproval
        fixture.approvals.request = (input, onPending) => {
            fixture.approvalCalls.push(structuredClone(input))
            onPending?.({approvalId: "approval-pending-1"})
            return new Promise((resolve) => { settleApproval = resolve })
        }
        const operation = fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        for (let index = 0; index < 30 && !settleApproval; index += 1) {
            await new Promise((resolve) => setImmediate(resolve))
        }

        assert.equal(typeof settleApproval, "function")
        assert.equal(fixture.store.getRun(fixture.run.id).state, "waiting_approval")
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.finalApprovalId, "approval-pending-1")

        settleApproval({approved: true, approvalId: "approval-pending-1"})
        assert.equal((await operation).status, "succeeded")
    })

    it("rebuilds the approved Candidate from durable evidence after a final-approval restart", async () => {
        const fixture = runnerFixture()
        await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        const run = fixture.store.run
        const epoch = run.epochs.at(-1)
        run.state = "needs_recovery"
        run.recovery = {
            previousState: "waiting_approval",
            reason: "process_interrupted",
            recoveredAt: "2026-09-03T08:00:00.000Z",
        }
        epoch.status = "deciding"
        delete run.checkpoint.finalApprovalId
        delete run.checkpoint.releasePhase
        delete run.checkpoint.releasedVersionId
        delete run.checkpoint.releasedInstallArtifactId
        fixture.approvalCalls.length = 0
        fixture.releaseCalls.length = 0
        fixture.installationCalls.length = 0
        const candidateRequests = fixture.operatorGateway.candidateRequests
        const evaluationCalls = fixture.evaluationCalls.length

        const outcome = await fixture.runner.resumeFinalApproval(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
            workspace: run.checkpoint.workspace,
        })

        assert.equal(outcome.status, "succeeded")
        assert.deepEqual(fixture.approvalCalls.map((entry) => entry.kind), ["release-install"])
        assert.equal(fixture.releaseCalls.length, 1)
        assert.deepEqual(fixture.installationCalls.map((entry) => entry.kind), ["released"])
        assert.equal(fixture.operatorGateway.candidateRequests, candidateRequests)
        assert.equal(fixture.evaluationCalls.length, evaluationCalls)
    })

    it("honors fixed maximum Epoch and adaptive patience before an Agent can continue", async () => {
        for (const [mode, configure] of [
            ["fixed", (run) => { run.snapshot.limits.maxEpochs = 1 }],
            ["adaptive", (run) => {
                run.snapshot.limits.patience = 1
                run.snapshot.limits.minimumImprovement = 20
            }],
        ]) {
            const fixture = runnerFixture()
            fixture.store.run.snapshot.mode = mode
            configure(fixture.store.run)
            const outcome = await fixture.runner.run(fixture.run.id, {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
            })

            assert.equal(outcome.status, "succeeded")
            assert.equal(fixture.store.getRun(fixture.run.id).epochs.length, 1)
            assert.equal(fixture.operatorGateway.decisionRequests, 1)
        }
    })

    it("waits for a separate limit approval before starting another Epoch", async () => {
        const fixture = runnerFixture()
        fixture.store.run.snapshot.limits.maxEpochs = 1
        let decisionCount = 0
        fixture.operatorGateway.requestDecision = async () => {
            decisionCount += 1
            const decision = {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: decisionCount === 1 ? "continue" : "finish",
                rationale: "Need one bounded additional Epoch",
            }
            return decisionCount === 1
                ? {
                    decision,
                    limitRequest: {
                        field: "maxEpochs",
                        value: 2,
                        rationale: "The first Candidate improved but did not reach the target",
                    },
                }
                : decision
        }
        const originalApproval = fixture.approvals.request.bind(fixture.approvals)
        let approveLimit
        fixture.approvals.request = (input) => {
            if (input.kind !== "limit") return originalApproval(input)
            return new Promise((resolve) => { approveLimit = resolve })
        }
        const operation = fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        for (let index = 0; index < 20 && !approveLimit; index += 1) {
            await new Promise((resolve) => setImmediate(resolve))
        }

        assert.equal(typeof approveLimit, "function")
        assert.equal(fixture.store.getRun(fixture.run.id).epochs.length, 1)
        approveLimit({approved: true, approvalId: "limit-approval-1"})
        const outcome = await operation

        assert.equal(outcome.status, "succeeded")
        assert.equal(fixture.store.getRun(fixture.run.id).epochs.length, 2)
        assert.equal(fixture.store.getRun(fixture.run.id).snapshot.limits.maxEpochs, 1)
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.approvedLimits.maxEpochs, 2)
    })

    it("restores enrolled targets after timeout or token exhaustion", async () => {
        for (const telemetry of [
            {elapsedMs: 3_600_000, turnsUsed: 1, tokensUsed: null, costMicros: null},
            {elapsedMs: 1_000, turnsUsed: 1, tokensUsed: 100, costMicros: null},
        ]) {
            const fixture = runnerFixture({telemetry: () => telemetry})
            if (telemetry.tokensUsed !== null) fixture.store.run.snapshot.limits.maxTokens = 100
            const outcome = await fixture.runner.run(fixture.run.id, {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
            })

            assert.equal(outcome.status, "failed")
            assert.equal(fixture.store.getRun(fixture.run.id).state, "failed")
            assert.deepEqual(fixture.store.getRun(fixture.run.id).checkpoint.telemetry, {
                elapsedMs: telemetry.elapsedMs,
                turnsUsed: telemetry.turnsUsed,
                tokens: telemetry.tokensUsed,
                costMicros: telemetry.costMicros,
            })
            assert.equal(
                fixture.installationCalls.at(-1).operation,
                "experiment_restore",
            )
        }
    })

    it("pauses after an Agent pause or two invalid structured decisions", async () => {
        const explicit = runnerFixture()
        explicit.operatorGateway.requestDecision = async () => ({
            schemaVersion: "rolling-skill-optimization-decision/v1",
            action: "pause",
            rationale: "等待用户检查",
        })
        const paused = await explicit.runner.run(explicit.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(paused.status, "paused")
        assert.equal(explicit.store.getRun(explicit.run.id).state, "needs_recovery")

        const invalid = runnerFixture()
        const attempts = []
        invalid.operatorGateway.requestDecision = async (input) => {
            attempts.push(input)
            return "not valid JSON"
        }
        const invalidOutcome = await invalid.runner.run(invalid.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(invalidOutcome.status, "paused")
        assert.equal(attempts.length, 2)
        assert.equal(attempts[0].validationError, null)
        assert.match(attempts[1].validationError, /JSON/u)
    })

    it("rebuilds durable context and resumes a paused Run at the next Epoch", async () => {
        const fixture = runnerFixture()
        fixture.operatorGateway.requestDecision = async () => ({
            schemaVersion: "rolling-skill-optimization-decision/v1",
            action: "pause",
            rationale: "等待用户检查",
        })
        const paused = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(paused.status, "paused")

        fixture.operatorGateway.requestDecision = async () => ({
            schemaVersion: "rolling-skill-optimization-decision/v1",
            action: "finish",
            rationale: "恢复后目标已达到",
        })
        const resumed = await fixture.runner.resume(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.equal(resumed.status, "succeeded")
        assert.equal(fixture.store.getRun(fixture.run.id).epochs.length, 2)
        assert.equal(fixture.workspaceManager.createCalls, 1)
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.paused, false)
    })

    it("exposes a pending inspection and retains its Job and failure reason without installing", async () => {
        const fixture = runnerFixture()
        fixture.installationManager.wait = async (jobId) => {
            const checkpoint = fixture.store.getRun(fixture.run.id).checkpoint
            assert.equal(checkpoint.installationOperation, "experiment_inspect")
            assert.equal(checkpoint.installationPending, true)
            assert.deepEqual(checkpoint.installationJobIds, [jobId])
            return {...fixture.installationJobs.get(jobId), status: "unverified", error: {message: "Management marker is truncated; nothing was changed."}}
        }
        const result = await fixture.runner.run(fixture.run.id, {operatorSessionId: "operator-session-1", parentJobId: "operator-job-1"})
        assert.equal(result.status, "failed")
        const run = fixture.store.getRun(fixture.run.id)
        assert.match(run.error.message, /Management marker is truncated/u)
        assert.equal(run.checkpoint.installationPending, false)
        assert.deepEqual(run.checkpoint.installationJobIds, ["installation-1"])
        assert.deepEqual(fixture.installationCalls.map((call) => call.operation), ["experiment_inspect"])
    })

    it("restores after Candidate install/evaluation failure and release rejection", async () => {
        const installFailure = runnerFixture()
        const originalInstallStart = installFailure.installationManager.startOptimizationExperiment.bind(
            installFailure.installationManager,
        )
        installFailure.installationManager.startOptimizationExperiment = async (input) => {
            const jobs = await originalInstallStart(input)
            if (input.operation === "experiment_install") {
                for (const job of jobs) installFailure.installationJobs.get(job.id).status = "failed"
            }
            return jobs
        }
        const failedInstall = await installFailure.runner.run(installFailure.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(failedInstall.status, "failed")
        assert.equal(installFailure.installationCalls.at(-1).operation, "experiment_restore")

        const evaluationFailure = runnerFixture()
        const originalEvaluationRun = evaluationFailure.evaluationManager.run.bind(
            evaluationFailure.evaluationManager,
        )
        evaluationFailure.evaluationManager.run = async (input) => {
            if (input.kind === "candidate") throw new Error("candidate evaluation failed")
            return originalEvaluationRun(input)
        }
        const failedEvaluation = await evaluationFailure.runner.run(evaluationFailure.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(failedEvaluation.status, "failed")
        assert.equal(evaluationFailure.installationCalls.at(-1).operation, "experiment_restore")

        const rejected = runnerFixture()
        rejected.approvals.request = async (input) => ({
            approved: input.kind !== "release-install",
            approvalId: "approval-rejected",
        })
        const rejectedOutcome = await rejected.runner.run(rejected.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(rejectedOutcome.status, "cancelled")
        assert.equal(rejected.releaseCalls.length, 0)
        assert.equal(rejected.installationCalls.at(-1).operation, "experiment_restore")
    })

    it("marks needs_recovery when restoration cannot prove a safe terminal state", async () => {
        const fixture = runnerFixture({telemetry: () => ({
            elapsedMs: 3_600_000,
            turnsUsed: 1,
            tokensUsed: null,
            costMicros: null,
        })})
        const originalStart = fixture.installationManager.startOptimizationExperiment.bind(
            fixture.installationManager,
        )
        fixture.installationManager.startOptimizationExperiment = async (input) => {
            const jobs = await originalStart(input)
            if (input.operation === "experiment_restore") {
                for (const job of jobs) {
                    const stored = fixture.installationJobs.get(job.id)
                    stored.status = "needs_recovery"
                    stored.parsedResult.result.actualDigest = digest("e")
                    stored.parsedResult.result.markerAfter = {
                        runId: fixture.run.id,
                        epoch: 1,
                        versionId: "candidate-1",
                        contentDigest: digest("e"),
                    }
                }
            }
            return jobs
        }
        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.equal(outcome.status, "needs_recovery")
        const stored = fixture.store.getRun(fixture.run.id)
        assert.equal(stored.state, "needs_recovery")
        assert.deepEqual(stored.checkpoint.recoveryTargets, [{
            runtimeId: "codex:target",
            status: "needs_recovery",
            installationJobId: "installation-3",
            lastVerifiedDigest: digest("e"),
            lastVerifiedMarker: {
                runId: fixture.run.id,
                epoch: 1,
                versionId: "candidate-1",
                contentDigest: digest("e"),
            },
        }])
    })

    it("honors a user stop and restores each mixed initial target with only its safe operation", async () => {
        const fixture = runnerFixture()
        fixture.store.run.snapshot.targets.push({
            runtimeId: "codebuddy:target",
            modelId: "claude-sonnet",
            effort: "high",
        })
        const originalStart = fixture.installationManager.startOptimizationExperiment.bind(
            fixture.installationManager,
        )
        fixture.installationManager.startOptimizationExperiment = async (input) => {
            const jobs = await originalStart(input)
            if (input.operation === "experiment_inspect") {
                const absent = fixture.installationJobs.get(jobs[1].id)
                absent.parsedResult.classificationBefore = "absent"
                absent.parsedResult.destination = null
            }
            return jobs
        }
        let decisions = 0
        fixture.operatorGateway.requestDecision = async () => {
            decisions += 1
            fixture.runner.stop(fixture.run.id)
            return {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: "continue",
                rationale: "stop is controlled by the user",
            }
        }
        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.equal(decisions, 1)
        assert.equal(outcome.status, "cancelled")
        const restorationCalls = fixture.installationCalls.filter((entry) =>
            entry.operation === "experiment_restore" || entry.operation === "experiment_remove")
        assert.deepEqual(restorationCalls.map((entry) => [
            entry.operation,
            entry.targets.map((target) => target.runtimeId),
        ]), [
            ["experiment_restore", ["codex:target"]],
            ["experiment_remove", ["codebuddy:target"]],
        ])
    })

    it("checkpoints active Runs for shutdown and permanently stops new scheduling", async () => {
        const fixture = runnerFixture()
        let shutdown
        fixture.operatorGateway.requestDecision = async () => {
            shutdown = fixture.runner.checkpointAndStop()
            return {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: "continue",
                rationale: "the App is shutting down",
            }
        }

        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.deepEqual(shutdown, {activeRunIds: [fixture.run.id]})
        assert.equal(outcome.status, "paused")
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.paused, true)
        assert.deepEqual(await fixture.runner.waitForIdle(), {activeRunIds: []})
        assert.throws(
            () => fixture.runner.run(fixture.run.id, {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
            }),
            /shutting down|scheduling.*stopped/iu,
        )
        assert.throws(
            () => fixture.runner.resume(fixture.run.id),
            /shutting down|scheduling.*stopped/iu,
        )
    })

    it("pauses a final approval for shutdown without resolving its durable decision", async () => {
        const fixture = runnerFixture()
        let settleApproval
        fixture.approvals.request = (input, onPending) => {
            fixture.approvalCalls.push(structuredClone(input))
            onPending?.({approvalId: "approval-before-shutdown"})
            return new Promise((resolve) => { settleApproval = resolve })
        }
        fixture.approvals.suspend = (approvalId) => {
            assert.equal(approvalId, "approval-before-shutdown")
            settleApproval({
                approved: false,
                suspended: true,
                approvalId,
                decisionScope: "app_shutdown",
            })
            return true
        }
        const operation = fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        for (let index = 0; index < 30 && !settleApproval; index += 1) {
            await new Promise((resolve) => setImmediate(resolve))
        }
        assert.equal(typeof settleApproval, "function")

        fixture.runner.checkpointAndStop()
        const outcome = await Promise.race([
            operation,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Runner did not detach its approval waiter")), 100)),
        ])

        assert.equal(outcome.status, "paused")
        assert.equal(fixture.store.getRun(fixture.run.id).state, "needs_recovery")
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.paused, true)
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.resumePhase, "final_approval")
        assert.deepEqual(await fixture.runner.waitForIdle(), {activeRunIds: []})
    })

    it("resolves a direct stop during final approval as the same persisted rejection", async () => {
        const fixture = runnerFixture()
        let settleApproval
        fixture.approvals.request = (input, onPending) => {
            fixture.approvalCalls.push(structuredClone(input))
            onPending?.({approvalId: "approval-before-stop"})
            return new Promise((resolve) => { settleApproval = resolve })
        }
        const rejected = []
        fixture.approvals.reject = async (approvalId) => {
            rejected.push(approvalId)
            settleApproval({
                approved: false,
                approvalId,
                decisionScope: "optimization_cancel",
            })
        }
        const operation = fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        for (let index = 0; index < 30 && !settleApproval; index += 1) {
            await new Promise((resolve) => setImmediate(resolve))
        }
        assert.equal(typeof settleApproval, "function")

        await fixture.runner.stop(fixture.run.id)
        assert.deepEqual(rejected, ["approval-before-stop"])
        assert.equal((await operation).status, "cancelled")
        assert.equal(fixture.releaseCalls.length, 0)
    })

    it("resumes from a shutdown checkpoint when a pending Candidate request is cancelled", async () => {
        const fixture = runnerFixture()
        let firstRequest = true
        fixture.operatorGateway.requestCandidate = async () => {
            if (firstRequest) {
                firstRequest = false
                fixture.runner.checkpointAndStop()
                throw new Error("Optimization Operator gateway stopped")
            }
            return {message: "Candidate after restart"}
        }

        const paused = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(paused.status, "paused")
        assert.equal(fixture.store.getRun(fixture.run.id).checkpoint.paused, true)

        fixture.runner.schedulingStopped = false
        const resumed = await fixture.runner.resume(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.equal(resumed.status, "succeeded", JSON.stringify(resumed))
        assert.equal(fixture.store.getRun(fixture.run.id).state, "succeeded")
    })

    it("restores after a Released installation failure", async () => {
        const releasedInstallFailure = runnerFixture()
        const originalReleasedStart = releasedInstallFailure.installationManager.start.bind(
            releasedInstallFailure.installationManager,
        )
        releasedInstallFailure.installationManager.start = async (input) => {
            const jobs = await originalReleasedStart(input)
            for (const job of jobs) releasedInstallFailure.installationJobs.get(job.id).status = "failed"
            return jobs
        }
        const installOutcome = await releasedInstallFailure.runner.run(releasedInstallFailure.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(installOutcome.status, "failed")
        assert.equal(releasedInstallFailure.installationCalls.at(-1).operation, "experiment_restore")
    })
})
