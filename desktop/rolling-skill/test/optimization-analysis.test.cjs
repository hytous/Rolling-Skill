"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    compareEvaluationRuns,
    evaluateStopRules,
} = require("../src/optimization/optimization-analysis.cjs")

function result(caseId, runtimeId, score, options = {}) {
    const status = options.status ?? "completed"
    const gradingStatus = options.gradingStatus ?? (score === null ? "failed" : "completed")
    return {
        id: `${caseId}:${runtimeId}`,
        caseId,
        runtimeId,
        status,
        gradingStatus,
        computedScore: score === null ? null : {
            schemaVersion: "rolling-skill-computed-score/v1",
            totalScore: score,
            overallVerdict: options.verdict ?? (score >= 80 ? "pass" : "fail"),
            outcomeTier: options.verdict === "diagnostic" ? "diagnostic" : score >= 80
                ? "formal_pass"
                : "fail",
            criticalFailures: options.criticalFailures ?? [],
        },
    }
}

function evaluation(id, results) {
    return {id, results}
}

function comparison(overrides = {}) {
    const baseline = evaluation("baseline", [
        result("case-1", "runtime-a", 70),
        result("case-1", "runtime-b", 80),
        result("case-2", "runtime-a", 90),
        result("case-2", "runtime-b", 60),
    ])
    const previous = evaluation("previous", [
        result("case-1", "runtime-a", 70),
        result("case-1", "runtime-b", 80),
        result("case-2", "runtime-a", 90),
        result("case-2", "runtime-b", 60),
    ])
    const current = evaluation("current", [
        result("case-2", "runtime-b", 78),
        result("case-1", "runtime-b", 83),
        result("case-2", "runtime-a", 85),
        result("case-1", "runtime-a", 80),
    ])
    return compareEvaluationRuns({
        baseline,
        previous,
        current,
        epoch: 1,
        limits: {maxEpochs: 5},
        agentDecision: {action: "continue"},
        ...overrides,
    })
}

describe("deterministic Optimization analysis", () => {
    it("computes stable per-Case/per-Runtime deltas and unified score/pass summaries", () => {
        const analysis = comparison()

        assert.equal(analysis.score, 81.5)
        assert.equal(analysis.scoreDelta, 6.5)
        assert.equal(analysis.baselineScoreDelta, 6.5)
        assert.equal(analysis.passRate, 0.75)
        assert.deepEqual(
            analysis.improved.map((entry) => [entry.caseId, entry.runtimeId, entry.delta]),
            [
                ["case-1", "runtime-a", 10],
                ["case-1", "runtime-b", 3],
                ["case-2", "runtime-b", 18],
            ],
        )
        assert.deepEqual(
            analysis.regressed.map((entry) => [entry.caseId, entry.runtimeId, entry.delta]),
            [["case-2", "runtime-a", -5]],
        )
        assert.deepEqual(analysis.newlyPassed.map((entry) => entry.caseId), ["case-1"])
    })

    it("treats a missing current key as a regression and keeps it in the pass denominator", () => {
        const baseline = evaluation("baseline", [
            result("case-1", "runtime-a", 80),
            result("case-2", "runtime-a", 90),
        ])
        const analysis = comparison({
            baseline,
            previous: baseline,
            current: evaluation("current", [result("case-1", "runtime-a", 82)]),
        })

        assert.equal(analysis.score, 82)
        assert.equal(analysis.passRate, 0.5)
        assert.equal(analysis.missingResultCount, 1)
        assert.deepEqual(
            analysis.regressed.map((entry) => [entry.caseId, entry.reason]),
            [["case-2", "missing_result"]],
        )
    })

    it("counts execution and grading failures separately without inventing scores", () => {
        const baseline = evaluation("baseline", [
            result("case-1", "runtime-a", 70),
            result("case-2", "runtime-a", 70),
            result("case-3", "runtime-a", 70),
        ])
        const analysis = comparison({
            baseline,
            previous: baseline,
            current: evaluation("current", [
                result("case-1", "runtime-a", 75),
                result("case-2", "runtime-a", null, {status: "failed", gradingStatus: "skipped"}),
                result("case-3", "runtime-a", null, {status: "completed", gradingStatus: "failed"}),
            ]),
        })

        assert.equal(analysis.score, 75)
        assert.equal(analysis.completedScoreCount, 1)
        assert.equal(analysis.executionFailureCount, 1)
        assert.equal(analysis.gradingFailureCount, 1)
        assert.equal(analysis.missingScoreCount, 2)
    })

    it("keeps regression evidence diagnostic while the Epoch loop decides when to stop", () => {
        const previous = evaluation("previous", [result("case-1", "runtime-a", 90)])
        const critical = comparison({
            baseline: previous,
            previous,
            current: evaluation("current", [result("case-1", "runtime-a", 85, {
                criticalFailures: ["must-use-skill"],
            })]),
        })
        assert.deepEqual(critical.newCriticalFailures[0].criticalFailures, ["must-use-skill"])
        assert.equal(evaluateStopRules(critical).reason, "continue")

        const broadPrevious = evaluation("previous", [result("case-1", "runtime-a", 90)])
        const broad = comparison({
            baseline: broadPrevious,
            previous: broadPrevious,
            current: evaluation("current", [result("case-1", "runtime-a", 85)]),
            regressionThresholds: {maximumScoreDrop: 4, maximumRegressedResults: 10},
        })
        assert.equal(broad.broadRegression, true)
        assert.equal(evaluateStopRules(broad).reason, "continue")
        assert.equal(evaluateStopRules({...critical, epoch: 5}).reason, "max_epochs_reached")
    })

    it("applies cancellation and recovery precedence", () => {
        const base = comparison()
        assert.equal(evaluateStopRules({...base,
            cancelRequested: true,
            recoveryFailed: true,
        }).reason, "cancel_requested")
        assert.equal(evaluateStopRules({...base,
            recoveryFailed: true,
        }).reason, "recovery_failed")
    })

    it("stops only at the Epoch boundary or when the Agent chooses finish or pause", () => {
        assert.equal(evaluateStopRules(comparison({epoch: 5})).reason, "max_epochs_reached")
        assert.equal(evaluateStopRules(comparison({
            agentDecision: {action: "finish"},
        })).reason, "agent_finish")
        assert.equal(evaluateStopRules(comparison({
            agentDecision: {action: "pause"},
        })).reason, "agent_pause")
    })

    it("ignores duration, Agent-turn usage, low gains, and target-like inputs", () => {
        const lowGainPrevious = evaluation("previous", [result("case-1", "runtime-a", 70)])
        const lowGainCurrent = evaluation("current", [result("case-1", "runtime-a", 70.2)])
        const analysis = comparison({
            baseline: lowGainPrevious,
            previous: lowGainPrevious,
            current: lowGainCurrent,
            target: {minimumScore: 100, minimumPassRate: 1, requireCriticalCases: true},
            history: [{scoreDelta: 0.2}, {scoreDelta: 0.1}],
            progress: {elapsedMs: 9_000_000, turnsUsed: 500, tokensUsed: 1_000_000},
        })

        assert.equal(evaluateStopRules(analysis).reason, "continue")
        for (const field of [
            "mode",
            "target",
            "progress",
            "targetReached",
            "consecutiveInsufficientImprovement",
            "patienceExhausted",
        ]) assert.equal(Object.hasOwn(analysis, field), false, field)
    })

    it("rejects duplicate or foreign Case × Runtime keys instead of comparing unlike snapshots", () => {
        const baseline = evaluation("baseline", [result("case-1", "runtime-a", 80)])
        assert.throws(() => comparison({
            baseline,
            previous: baseline,
            current: evaluation("current", [
                result("case-1", "runtime-a", 81),
                result("case-1", "runtime-a", 82),
            ]),
        }), /duplicate/i)
        assert.throws(() => comparison({
            baseline,
            previous: baseline,
            current: evaluation("current", [result("case-2", "runtime-a", 81)]),
        }), /foreign|snapshot|key/i)
    })
})
