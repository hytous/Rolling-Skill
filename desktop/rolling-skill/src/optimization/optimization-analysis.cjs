"use strict"

const OPTIMIZATION_ANALYSIS_SCHEMA = "rolling-skill-optimization-analysis/v1"
const SCORE_EPSILON = 1e-9

function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    return value
}

function finiteNumber(value, label, {minimum = 0, maximum = Number.MAX_SAFE_INTEGER} = {}) {
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
        throw new Error(`${label} must be a finite number between ${minimum} and ${maximum}`)
    }
    return value
}

function optionalLimit(value, label, {integer = false} = {}) {
    if (value === null || value === undefined) return null
    const normalized = finiteNumber(value, label)
    if (integer && !Number.isSafeInteger(normalized)) throw new Error(`${label} must be an integer`)
    return normalized
}

function rounded(value) {
    if (value === null || value === undefined) return null
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function resultIdentity(result, label) {
    const caseId = String(result?.caseId ?? result?.caseSnapshot?.id ?? "").trim()
    const runtimeId = String(
        result?.runtimeId ?? result?.runtimeConfiguration?.runtimeId ?? "",
    ).trim()
    if (!caseId || !runtimeId) throw new Error(`${label} has an incomplete Case × Runtime key`)
    return {caseId, runtimeId, key: `${caseId}\u0000${runtimeId}`}
}

function indexEvaluation(run, label, expectedKeys = null) {
    requireObject(run, label)
    if (!Array.isArray(run.results)) throw new Error(`${label} results must be an array`)
    const indexed = new Map()
    for (const result of run.results) {
        const identity = resultIdentity(result, label)
        if (indexed.has(identity.key)) throw new Error(`${label} contains a duplicate Case × Runtime key`)
        if (expectedKeys && !expectedKeys.has(identity.key)) {
            throw new Error(`${label} contains a foreign Case × Runtime snapshot key`)
        }
        indexed.set(identity.key, {identity, result})
    }
    return indexed
}

function scoredResult(result) {
    if (!result) {
        return {
            score: null,
            passed: false,
            criticalFailures: [],
            reason: "missing_result",
        }
    }
    if (result.status !== "completed") {
        return {
            score: null,
            passed: false,
            criticalFailures: [],
            reason: "execution_failure",
        }
    }
    const score = result.computedScore?.totalScore
    if (
        result.gradingStatus !== "completed" ||
        !Number.isFinite(score) ||
        score < 0 ||
        score > 100
    ) {
        return {
            score: null,
            passed: false,
            criticalFailures: [],
            reason: "grading_failure",
        }
    }
    const criticalFailures = Array.isArray(result.computedScore.criticalFailures)
        ? [...new Set(result.computedScore.criticalFailures.map(String))].sort()
        : []
    return {
        score,
        passed:
            result.computedScore.overallVerdict === "pass" ||
            result.computedScore.outcomeTier === "formal_pass",
        criticalFailures,
        reason: null,
    }
}

function summarize(indexed, expectedEntries) {
    let scoreSum = 0
    let completedScoreCount = 0
    let passCount = 0
    let executionFailureCount = 0
    let gradingFailureCount = 0
    let missingResultCount = 0
    const criticalFailures = []
    for (const entry of expectedEntries) {
        const indexedResult = indexed.get(entry.key)?.result ?? null
        const scored = scoredResult(indexedResult)
        if (scored.score !== null) {
            scoreSum += scored.score
            completedScoreCount += 1
            if (scored.passed) passCount += 1
        }
        if (scored.reason === "missing_result") missingResultCount += 1
        if (scored.reason === "execution_failure") executionFailureCount += 1
        if (scored.reason === "grading_failure") gradingFailureCount += 1
        if (scored.criticalFailures.length) {
            criticalFailures.push({
                caseId: entry.caseId,
                runtimeId: entry.runtimeId,
                criticalFailures: scored.criticalFailures,
            })
        }
    }
    const expectedResultCount = expectedEntries.length
    return {
        score: completedScoreCount ? rounded(scoreSum / completedScoreCount) : null,
        passRate: expectedResultCount ? rounded(passCount / expectedResultCount) : 0,
        passCount,
        expectedResultCount,
        completedScoreCount,
        missingScoreCount: expectedResultCount - completedScoreCount,
        executionFailureCount,
        gradingFailureCount,
        missingResultCount,
        criticalFailures,
    }
}

function comparisonEntry(expected, comparisonIndex, currentIndex) {
    const previous = scoredResult(comparisonIndex.get(expected.key)?.result ?? null)
    const current = scoredResult(currentIndex.get(expected.key)?.result ?? null)
    return {
        caseId: expected.caseId,
        runtimeId: expected.runtimeId,
        previousScore: previous.score,
        currentScore: current.score,
        delta: previous.score === null || current.score === null
            ? null
            : rounded(current.score - previous.score),
        previousPassed: previous.passed,
        currentPassed: current.passed,
        reason: current.reason,
        criticalFailures: current.criticalFailures,
        previousCriticalFailures: previous.criticalFailures,
    }
}

function normalizedRegressionThresholds(value = {}) {
    requireObject(value, "Optimization regression thresholds")
    return {
        maximumScoreDrop: optionalLimit(
            value.maximumScoreDrop,
            "Optimization maximum score drop",
        ),
        maximumRegressedResults: optionalLimit(
            value.maximumRegressedResults,
            "Optimization maximum regressed results",
            {integer: true},
        ),
    }
}

function compareEvaluationRuns(input = {}) {
    const baselineIndex = indexEvaluation(input.baseline, "Baseline evaluation")
    if (!baselineIndex.size) throw new Error("Baseline evaluation must contain results")
    const expectedEntries = [...baselineIndex.values()]
        .map((entry) => entry.identity)
        .sort((left, right) => left.caseId.localeCompare(right.caseId) ||
            left.runtimeId.localeCompare(right.runtimeId))
    const expectedKeys = new Set(expectedEntries.map((entry) => entry.key))
    const previousRun = input.previous ?? input.baseline
    const previousIndex = indexEvaluation(previousRun, "Previous evaluation", expectedKeys)
    const currentIndex = indexEvaluation(input.current, "Current evaluation", expectedKeys)
    const baselineSummary = summarize(baselineIndex, expectedEntries)
    const previousSummary = summarize(previousIndex, expectedEntries)
    const currentSummary = summarize(currentIndex, expectedEntries)
    const entries = expectedEntries.map((entry) =>
        comparisonEntry(entry, previousIndex, currentIndex))
    const improved = entries.filter((entry) => entry.delta !== null && entry.delta > SCORE_EPSILON)
    const unchanged = entries.filter((entry) => entry.delta !== null && Math.abs(entry.delta) <= SCORE_EPSILON)
    const regressed = entries.filter((entry) =>
        entry.currentScore === null || (entry.delta !== null && entry.delta < -SCORE_EPSILON))
    const newlyPassed = entries.filter((entry) => !entry.previousPassed && entry.currentPassed)
    const newlyFailed = entries.filter((entry) => entry.previousPassed && !entry.currentPassed)
    const newCriticalFailures = entries
        .map((entry) => ({
            caseId: entry.caseId,
            runtimeId: entry.runtimeId,
            criticalFailures: entry.criticalFailures.filter(
                (failure) => !entry.previousCriticalFailures.includes(failure),
            ),
        }))
        .filter((entry) => entry.criticalFailures.length)
    const limits = requireObject(input.limits, "Optimization limits")
    const maxEpochs = optionalLimit(limits.maxEpochs, "Optimization max epochs", {integer: true})
    if (!maxEpochs) throw new Error("Optimization max Epochs is required")
    if (!Number.isSafeInteger(input.epoch) || input.epoch < 1) {
        throw new Error("Optimization Epoch must be a positive integer")
    }
    const scoreDelta = currentSummary.score === null || previousSummary.score === null
        ? null
        : rounded(currentSummary.score - previousSummary.score)
    const baselineScoreDelta = currentSummary.score === null || baselineSummary.score === null
        ? null
        : rounded(currentSummary.score - baselineSummary.score)
    const regressionThresholds = normalizedRegressionThresholds(input.regressionThresholds ?? {})
    const broadRegressionReasons = []
    if (
        regressionThresholds.maximumScoreDrop !== null &&
        scoreDelta !== null &&
        scoreDelta < -regressionThresholds.maximumScoreDrop - SCORE_EPSILON
    ) broadRegressionReasons.push("score_drop")
    if (
        regressionThresholds.maximumRegressedResults !== null &&
        regressed.length > regressionThresholds.maximumRegressedResults
    ) broadRegressionReasons.push("regressed_results")
    const analysis = {
        schemaVersion: OPTIMIZATION_ANALYSIS_SCHEMA,
        baselineEvaluationRunId: String(input.baseline.id ?? ""),
        previousEvaluationRunId: String(previousRun.id ?? ""),
        currentEvaluationRunId: String(input.current.id ?? ""),
        epoch: input.epoch,
        limits: {maxEpochs},
        cancelRequested: input.cancelRequested === true,
        recoveryFailed: input.recoveryFailed === true,
        agentDecision: input.agentDecision ? {action: String(input.agentDecision.action ?? "")} : null,
        regressionThresholds,
        broadRegressionReasons,
        broadRegression: broadRegressionReasons.length > 0,
        baseline: baselineSummary,
        previous: previousSummary,
        current: currentSummary,
        score: currentSummary.score,
        scoreDelta,
        baselineScoreDelta,
        passRate: currentSummary.passRate,
        completedScoreCount: currentSummary.completedScoreCount,
        missingScoreCount: currentSummary.missingScoreCount,
        executionFailureCount: currentSummary.executionFailureCount,
        gradingFailureCount: currentSummary.gradingFailureCount,
        missingResultCount: currentSummary.missingResultCount,
        improved,
        unchanged,
        regressed,
        newlyPassed,
        newlyFailed,
        criticalFailures: currentSummary.criticalFailures,
        newCriticalFailures,
    }
    return deepFreeze(analysis)
}

function stop(action, reason, hardStop) {
    return Object.freeze({action, reason, hardStop, shouldStop: action !== "continue"})
}

function evaluateStopRules(analysis) {
    requireObject(analysis, "Optimization analysis")
    const limits = requireObject(analysis.limits, "Optimization limits")
    if (analysis.cancelRequested) return stop("restore", "cancel_requested", true)
    if (analysis.recoveryFailed) return stop("recover", "recovery_failed", true)
    if (analysis.epoch >= limits.maxEpochs) return stop("finish", "max_epochs_reached", true)
    const action = analysis.agentDecision?.action ?? "continue"
    if (action === "finish") return stop("finish", "agent_finish", false)
    if (action === "pause") return stop("pause", "agent_pause", false)
    if (action !== "continue") throw new Error("Optimization Agent decision is invalid")
    return stop("continue", "continue", false)
}

module.exports = {
    OPTIMIZATION_ANALYSIS_SCHEMA,
    compareEvaluationRuns,
    evaluateStopRules,
}
