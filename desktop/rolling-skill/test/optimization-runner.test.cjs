"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {OptimizationRunner} = require("../src/optimization/optimization-runner.cjs")

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
    const scores = [70, 80, 95, 95]
    const evaluationManager = {
        async run(input) {
            evaluationCalls.push(structuredClone(input))
            return evaluation(`evaluation-${evaluationCalls.length}`, scores.shift())
        },
    }
    let candidateEpoch = 0
    const workspaceManager = {
        createCalls: 0,
        async create() {
            this.createCalls += 1
            return {workspacePath: "/app-support/optimization-workspaces/optimization-run-1"}
        },
        async createCandidate(input) {
            candidateEpoch += 1
            assert.equal(input.epoch, candidateEpoch)
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
        async request(input) {
            approvalCalls.push(structuredClone(input))
            return {approved: true, approvalId: `approval-${approvalCalls.length}`}
        },
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
        telemetry: () => ({elapsedMs: 1_000, turnsUsed: 2, tokensUsed: null, costMicros: null}),
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
    it("runs baseline, two Candidates, release install, and final regression in engine-owned order", async () => {
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
            "final-regression",
        ])
        assert.equal(fixture.operatorGateway.candidateRequests, 2)
        assert.equal(fixture.operatorGateway.decisionRequests, 2)
        assert.deepEqual(fixture.approvalCalls.map((entry) => entry.kind), ["release", "install"])
        assert.equal(fixture.releaseCalls.length, 1)
        assert.equal(fixture.workspaceManager.createCalls, 1)
        assert.equal(fixture.childJobs.active, 0)
        assert.equal(
            fixture.childJobs.sequence.filter((entry) => entry.event === "started").length,
            fixture.childJobs.sequence.filter((entry) => entry.event === "terminal").length,
        )
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
            approved: input.kind !== "release",
            approvalId: "approval-rejected",
        })
        const rejectedOutcome = await rejected.runner.run(rejected.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(rejectedOutcome.status, "cancelled")
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
                for (const job of jobs) fixture.installationJobs.get(job.id).status = "needs_recovery"
            }
            return jobs
        }
        const outcome = await fixture.runner.run(fixture.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })

        assert.equal(outcome.status, "needs_recovery")
        assert.equal(fixture.store.getRun(fixture.run.id).state, "needs_recovery")
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

    it("restores after a Released installation or final regression failure", async () => {
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

        const finalRegression = runnerFixture()
        const originalRun = finalRegression.evaluationManager.run.bind(finalRegression.evaluationManager)
        finalRegression.evaluationManager.run = async (input) => {
            if (input.kind === "final-regression") return evaluation("final-regression", 50)
            return originalRun(input)
        }
        const regressionOutcome = await finalRegression.runner.run(finalRegression.run.id, {
            operatorSessionId: "operator-session-1",
            parentJobId: "operator-job-1",
        })
        assert.equal(regressionOutcome.status, "failed")
        assert.equal(finalRegression.installationCalls.at(-1).operation, "experiment_restore")
    })
})
