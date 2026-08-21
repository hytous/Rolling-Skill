const {METHOD_DEFINITIONS} = require("./contracts.cjs")

const PHASE_ONE_ACTIONS = new Set(
    Object.values(METHOD_DEFINITIONS).map(({action}) => action),
)

const SCOPE_DEFINITIONS = Object.freeze([
    Object.freeze({key: "skillIds", singular: "Skill", direct: "skillId"}),
    Object.freeze({key: "datasetIds", singular: "Dataset", direct: "datasetId"}),
    Object.freeze({key: "runtimeIds", singular: "Runtime", direct: "runtimeId"}),
])

const ALLOW_WITHOUT_RESERVATION = Object.freeze({decision: "allow", reservation: null})

function deepFreeze(value) {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function uniqueStrings(values) {
    return [...new Set(values.filter((value) => typeof value === "string"))]
}

function canonicalObjectIds(input) {
    const request = typeof input === "object" && input !== null ? input : {}
    const skillIds = uniqueStrings([
        request.skillId,
        ...(Array.isArray(request.skillIds) ? request.skillIds : []),
    ])
    const datasetIds = uniqueStrings([
        request.datasetId,
        ...(Array.isArray(request.datasetIds) ? request.datasetIds : []),
    ])
    const runtimeIds = uniqueStrings([
        request.runtimeId,
        ...(Array.isArray(request.runtimeIds) ? request.runtimeIds : []),
        request.runtime?.runtimeId,
        ...(Array.isArray(request.runtimeConfigurations)
            ? request.runtimeConfigurations.map((runtime) => runtime?.runtimeId)
            : []),
        request.judgeConfiguration?.runtimeId,
    ])
    return {skillIds, datasetIds, runtimeIds}
}

function canonicalBudget(value) {
    const source = typeof value === "object" && value !== null ? value : {}
    const budget = {}
    for (const key of ["maxRuntimeTurns", "maxEvaluations"]) {
        if (Number.isSafeInteger(source[key]) && source[key] >= 0) budget[key] = source[key]
    }
    return budget
}

function requestedScope(input, {budget} = {}) {
    const objectIds = canonicalObjectIds(input)
    const scope = {}
    for (const {key} of SCOPE_DEFINITIONS) {
        if (objectIds[key].length > 0) scope[key] = objectIds[key]
    }
    if (budget !== undefined) scope.budget = canonicalBudget(budget)
    return deepFreeze(scope)
}

function approvalReason(method, action) {
    if (
        method === "budget.expand" ||
        method === "budgets.expand" ||
        action === "budget.expand"
    ) return "budget_expansion"
    if (/(?:^|\.)(?:delete|delete_case)$/u.test(method)) return "destructive_action"
    if (method === "skills.release" || action === "skills.release") return "release"
    if (
        method === "skills.install" ||
        method === "installations.start" ||
        action === "skills.install" ||
        action === "installations.execute"
    ) return "installation"
    if (method === "rubrics.publish" || action === "rubrics.publish") return "rubric_publish"
    return null
}

function approvalDecision(reason, input) {
    const options = reason === "budget_expansion" ? {budget: input?.budget} : undefined
    return deepFreeze({
        decision: "approval_required",
        reason,
        requestedScope: requestedScope(input, options),
    })
}

function deny(code, message) {
    return Object.freeze({decision: "deny", code, message})
}

function checkObjectScope(grant, input) {
    const referenced = canonicalObjectIds(input)
    for (const {key, singular} of SCOPE_DEFINITIONS) {
        const granted = new Set(Array.isArray(grant?.scopes?.[key]) ? grant.scopes[key] : [])
        if (referenced[key].some((id) => !granted.has(id))) {
            return deny(
                "OBJECT_OUT_OF_SCOPE",
                `${singular} is outside this Operator session`,
            )
        }
    }
    return null
}

function usageValue(usage, key) {
    const value = usage?.[key] ?? 0
    return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function reserveBudget(grant, usage, {budgetKey, usageKey}) {
    const used = usageValue(usage, usageKey)
    const limit = grant?.budget?.[budgetKey]
    if (used === null || !Number.isSafeInteger(limit) || limit < 0) {
        return deny("INVALID_BUDGET_USAGE", "Budget usage is not valid")
    }
    if (used + 1 > limit) {
        return deepFreeze({
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {
                budget: {[budgetKey]: used + 1},
            },
        })
    }
    return deepFreeze({
        decision: "allow",
        reservation: {budgetKey, usageKey, amount: 1, used, limit},
    })
}

function decideControlPolicy({grant, method, action, input, usage = {}} = {}) {
    const reason = approvalReason(method, action)
    if (reason !== null) return approvalDecision(reason, input)

    if (!Array.isArray(grant?.actions) || !grant.actions.includes(action)) {
        return deny(
            "ACTION_NOT_GRANTED",
            "Action is not granted for this Operator session",
        )
    }

    const scopeDenial = checkObjectScope(grant, input)
    if (scopeDenial !== null) return scopeDenial

    if (!PHASE_ONE_ACTIONS.has(action)) {
        return deny(
            "ACTION_NOT_ALLOWED",
            "Action is not available in control-plane phase one",
        )
    }

    if (action === "runtime.execute") {
        if (method !== "raw_cases.dispatch") {
            return deny(
                "ACTION_NOT_ALLOWED",
                "Action is not available in control-plane phase one",
            )
        }
        return reserveBudget(grant, usage, {
            budgetKey: "maxRuntimeTurns",
            usageKey: "runtimeTurns",
        })
    }

    if (action === "evaluations.execute") {
        if (method === "evaluations.cancel") return ALLOW_WITHOUT_RESERVATION
        if (method === "evaluations.start") {
            return reserveBudget(grant, usage, {
                budgetKey: "maxEvaluations",
                usageKey: "evaluations",
            })
        }
        return deny(
            "ACTION_NOT_ALLOWED",
            "Action is not available in control-plane phase one",
        )
    }

    return ALLOW_WITHOUT_RESERVATION
}

class ControlPolicy {
    decide(request) {
        return decideControlPolicy(request)
    }
}

function createControlPolicy() {
    return Object.freeze(new ControlPolicy())
}

module.exports = {
    ControlPolicy,
    createControlPolicy,
    decide: decideControlPolicy,
    decideControlPolicy,
}
