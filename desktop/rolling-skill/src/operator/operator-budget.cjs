const ITERATION_BUDGET_FIELDS = Object.freeze(["maxIterations"])
const LEGACY_BUDGET_FIELDS = Object.freeze([
    "maxDurationMs",
    "maxRuntimeTurns",
    "maxEvaluations",
    "maxTargetExecutions",
    "maxJudgeExecutions",
    "maxTokens",
    "maxReportedCost",
])

function isIterationBudget(value) {
    return Boolean(value && typeof value === "object" && Object.hasOwn(value, "maxIterations"))
}

function isUnboundedBudget(value) {
    return Boolean(
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0,
    )
}

function isAutomaticBudget(value) {
    return isIterationBudget(value) || isUnboundedBudget(value)
}

function normalizeOperatorBudget(value, {error = TypeError} = {}) {
    const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (prototype !== Object.prototype && prototype !== null)
    ) {
        throw new error("Operator budget must be a plain object")
    }
    if (isUnboundedBudget(value)) return {}
    if (isIterationBudget(value)) {
        if (
            Object.keys(value).length !== 1 ||
            !Number.isSafeInteger(value.maxIterations) ||
            value.maxIterations < 1
        ) {
            throw new error("Operator maxIterations must be a positive safe integer")
        }
        return {maxIterations: value.maxIterations}
    }
    const keys = Object.keys(value)
    if (
        keys.length !== LEGACY_BUDGET_FIELDS.length ||
        keys.some((key) => !LEGACY_BUDGET_FIELDS.includes(key))
    ) {
        throw new error("Legacy Operator budget fields are invalid")
    }
    const normalized = {}
    for (const field of LEGACY_BUDGET_FIELDS) {
        const entry = value[field]
        const optional = field === "maxTokens" || field === "maxReportedCost"
        const valid = optional && entry === null
            ? true
            : field === "maxReportedCost"
                ? Number.isFinite(entry) && entry >= 0
                : Number.isSafeInteger(entry) && entry >= 0
        if (!valid) throw new error(`Legacy Operator budget ${field} is invalid`)
        normalized[field] = entry
    }
    return normalized
}

module.exports = {
    ITERATION_BUDGET_FIELDS,
    LEGACY_BUDGET_FIELDS,
    isAutomaticBudget,
    isIterationBudget,
    isUnboundedBudget,
    normalizeOperatorBudget,
}
