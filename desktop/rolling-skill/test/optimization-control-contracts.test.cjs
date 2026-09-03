"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    controlDefinition,
    parseControlInput,
    parseControlOutput,
} = require("../src/control-plane/contracts.cjs")

function config() {
    return {
        skillId: "skill-1",
        baselineVersionId: "version-1",
        datasetId: "dataset-1",
        operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
        targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"}],
        judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "high"},
        activationMode: "automatic",
        mode: "adaptive",
        limits: {
            maxEpochs: 3,
            maxDurationMs: 3_600_000,
            patience: 2,
            minimumImprovement: 1,
            maxTurns: 50,
            maxTokens: null,
            maxCostMicros: null,
        },
        target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
        telemetry: {tokens: false, cost: false},
    }
}

function compactConfig() {
    const legacy = config()
    return {
        skillId: legacy.skillId,
        baselineVersionId: legacy.baselineVersionId,
        datasetId: legacy.datasetId,
        operator: legacy.operator,
        targets: legacy.targets,
        judge: legacy.judge,
        activationMode: legacy.activationMode,
        limits: {maxEpochs: 101},
    }
}

function runOutput(state = "editing") {
    return {
        run: {
            id: "optimization-run-1",
            state,
            revision: 2,
            currentEpoch: 1,
            snapshotDigest: `sha256:${"a".repeat(64)}`,
            baseline: {repositoryId: "repository-1", skillId: "skill-1", versionId: "version-1"},
            dataset: {id: "dataset-1", revision: 7},
            rubric: {id: "rubric-1", version: 4},
            operator: config().operator,
            targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"}],
            judge: config().judge,
            activationMode: "automatic",
            mode: "adaptive",
            limits: config().limits,
            target: config().target,
            telemetry: config().telemetry,
            epochs: [{
                number: 1,
                status: "editing",
                candidateArtifactId: "artifact-candidate-1",
                candidate: {
                    versionId: "candidate-1",
                    commit: "b".repeat(40),
                    contentDigest: `sha256:${"b".repeat(64)}`,
                },
                installations: [{
                    runtimeId: "codex:target",
                    status: "succeeded",
                    installationJobId: "install-1",
                    lastVerifiedDigest: `sha256:${"b".repeat(64)}`,
                }],
                analysis: {score: 88, scoreDelta: 4, passRate: 0.8, regressionCount: 1},
                decision: {action: "continue", rationale: "仍有一个回归项"},
            }],
            checkpoint: {
                operatorSessionId: "operator-session-1",
                activeEvaluationRunId: "evaluation-1",
                activeEvaluationKind: "baseline",
                installationOperation: "experiment_inspect",
                installationPending: true,
                installationJobIds: ["inspection-job-1"],
                baselineEvaluationRunId: "evaluation-1",
                stopRequested: false,
                operatorCleanupError: "Example bounded cleanup failure",
                paused: false,
                finalApprovalId: "approval-final-1",
                telemetry: {elapsedMs: 1_000, turnsUsed: 2, tokens: null, costMicros: null},
                recoveryTargets: [{
                    runtimeId: "codex:target",
                    status: "needs_recovery",
                    installationJobId: "install-restore-1",
                    lastVerifiedDigest: `sha256:${"c".repeat(64)}`,
                }],
            },
            error: null,
        },
    }
}

function compactRunOutput(state = "editing") {
    const output = runOutput(state)
    delete output.run.mode
    delete output.run.target
    delete output.run.telemetry
    delete output.run.checkpoint.telemetry
    output.run.limits = {maxEpochs: 101}
    output.run.currentEpoch = 101
    output.run.epochs = Array.from({length: 101}, (_, index) => ({
        number: index + 1,
        status: "completed",
        candidateArtifactId: null,
    }))
    return output
}

describe("optimization control contracts", () => {
    it("accepts compact Epoch-only start and preflight inputs above the old 100-Epoch cap", () => {
        const preflight = parseControlInput("optimization.preflight", {
            ...compactConfig(),
            idempotencyKey: "compact-preflight",
        })
        const start = parseControlInput("optimization.start", {
            ...compactConfig(),
            idempotencyKey: "compact-start",
        })

        assert.deepEqual(preflight.limits, {maxEpochs: 101})
        assert.deepEqual(start.limits, {maxEpochs: 101})
        assert.equal(Object.hasOwn(start, "mode"), false)
        assert.equal(Object.hasOwn(start, "target"), false)
        assert.equal(Object.hasOwn(start, "telemetry"), false)
        assert.doesNotThrow(() => parseControlOutput("optimization.start", compactRunOutput()))
    })

    it("accepts a read-only report preview without claiming a stored Artifact", () => {
        assert.doesNotThrow(() => parseControlOutput("optimization.report", {report: {
            artifactId: null,
            digest: `sha256:${"a".repeat(64)}`,
            mediaType: "text/markdown; charset=utf-8",
            preview: "# Skill 多轮优化报告\n\n已结束任务的只读报告。",
        }}))
    })

    it("defines strict typed lifecycle inputs and outputs", () => {
        const preflight = parseControlInput("optimization.preflight", {
            ...config(),
            idempotencyKey: "preflight-1",
        })
        assert.equal(preflight.limits.maxEpochs, 3)
        assert.deepEqual(parseControlInput("optimization.start", {
            ...config(),
            idempotencyKey: "start-1",
        }), {...config(), idempotencyKey: "start-1"})

        for (const method of ["optimization.get", "optimization.pause", "optimization.resume", "optimization.stop", "optimization.report"]) {
            const input = method === "optimization.get"
                ? {runId: "optimization-run-1"}
                : {runId: "optimization-run-1", idempotencyKey: `${method}-1`}
            assert.doesNotThrow(() => parseControlInput(method, input))
        }
        assert.doesNotThrow(() => parseControlInput("optimization.submit_candidate", {
            runId: "optimization-run-1",
            message: "补充下钻指导",
            idempotencyKey: "candidate-1",
        }))
        const decisionSubmission = parseControlInput("optimization.submit_decision", {
            runId: "optimization-run-1",
            decision: {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: "continue",
                rationale: "仍有回归项",
                observations: [],
            },
            idempotencyKey: "decision-1",
        })
        assert.equal(Object.hasOwn(decisionSubmission, "limitRequest"), false)
        assert.throws(() => parseControlInput("optimization.submit_decision", {
            ...decisionSubmission,
            limitRequest: null,
        }), (error) => error.code === "INVALID_ARGUMENT")

        for (const method of ["optimization.start", "optimization.get", "optimization.pause", "optimization.resume", "optimization.stop"]) {
            assert.doesNotThrow(() => parseControlOutput(method, runOutput()))
        }
        assert.doesNotThrow(() => parseControlOutput("optimization.preflight", {
            snapshotDigest: `sha256:${"a".repeat(64)}`,
            baseline: runOutput().run.baseline,
            dataset: runOutput().run.dataset,
            rubric: runOutput().run.rubric,
            targets: runOutput().run.targets,
            ready: true,
        }))
        assert.doesNotThrow(() => parseControlOutput("optimization.submit_candidate", {
            accepted: {runId: "optimization-run-1", kind: "candidate"},
        }))
        assert.doesNotThrow(() => parseControlOutput("optimization.submit_decision", {
            accepted: {runId: "optimization-run-1", kind: "decision"},
        }))
        assert.doesNotThrow(() => parseControlOutput("optimization.report", {
            report: {
                artifactId: "artifact-report-1",
                digest: `sha256:${"b".repeat(64)}`,
                mediaType: "text/markdown; charset=utf-8",
            },
        }))
    })

    it("keeps human lifecycle controls out of Operator Tools while exposing bounded submissions", () => {
        for (const method of [
            "optimization.preflight",
            "optimization.start",
            "optimization.pause",
            "optimization.resume",
            "optimization.stop",
        ]) assert.equal(controlDefinition(method).operatorExposed, false, method)
        for (const method of [
            "optimization.get",
            "optimization.submit_candidate",
            "optimization.submit_decision",
            "optimization.report",
        ]) assert.equal(controlDefinition(method).operatorExposed, true, method)
    })

    it("rejects paths, unknown fields, oversized messages, and malformed decisions", () => {
        assert.throws(() => parseControlInput("optimization.start", {
            ...config(),
            workspacePath: "/tmp/forged",
            idempotencyKey: "start-bad",
        }), (error) => error.code === "INVALID_ARGUMENT")
        assert.throws(() => parseControlInput("optimization.submit_candidate", {
            runId: "optimization-run-1",
            message: "x".repeat(2_001),
            idempotencyKey: "candidate-bad",
        }), (error) => error.code === "INVALID_ARGUMENT")
        assert.throws(() => parseControlInput("optimization.submit_decision", {
            runId: "optimization-run-1",
            decision: {action: "continue", rationale: "missing schema"},
            idempotencyKey: "decision-bad",
        }), (error) => error.code === "INVALID_ARGUMENT")
    })
})
