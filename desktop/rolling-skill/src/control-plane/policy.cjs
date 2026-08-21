const {METHOD_DEFINITIONS, controlDefinition} = require("./contracts.cjs")

const PHASE_ONE_ACTIONS = new Set(
    Object.values(METHOD_DEFINITIONS).map(({action}) => action),
)

const SCOPE_DEFINITIONS = Object.freeze([
    Object.freeze({key: "skillIds", singular: "Skill", direct: "skillId"}),
    Object.freeze({key: "datasetIds", singular: "Dataset", direct: "datasetId"}),
    Object.freeze({key: "runtimeIds", singular: "Runtime", direct: "runtimeId"}),
])

const ALLOW_WITHOUT_RESERVATION = Object.freeze({decision: "allow", reservation: null})

const APPROVAL_METHOD_DEFINITIONS = Object.freeze({
    "datasets.delete": Object.freeze({action: "datasets.delete", reason: "destructive_action"}),
    "datasets.delete_case": Object.freeze({
        action: "datasets.delete",
        reason: "destructive_action",
    }),
    "raw_cases.delete": Object.freeze({
        action: "raw_cases.delete",
        reason: "destructive_action",
    }),
    "evaluations.delete": Object.freeze({
        action: "evaluations.delete",
        reason: "destructive_action",
    }),
    "skills.delete": Object.freeze({action: "skills.delete", reason: "destructive_action"}),
    "skills.release": Object.freeze({action: "skills.release", reason: "release"}),
    "skills.install": Object.freeze({action: "skills.install", reason: "installation"}),
    "installations.start": Object.freeze({
        action: "installations.execute",
        reason: "installation",
    }),
    "rubrics.publish": Object.freeze({action: "rubrics.publish", reason: "rubric_publish"}),
    "budget.expand": Object.freeze({action: "budget.expand", reason: "budget_expansion"}),
    "budgets.expand": Object.freeze({action: "budget.expand", reason: "budget_expansion"}),
})

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

function policyMethodDefinition(method) {
    let contract
    try {
        contract = controlDefinition(method)
    } catch {
        contract = null
    }

    let approval = null
    try {
        if (Object.hasOwn(APPROVAL_METHOD_DEFINITIONS, method)) {
            approval = APPROVAL_METHOD_DEFINITIONS[method]
        }
    } catch {
        return null
    }

    if (contract !== null) {
        return {action: contract.action, reason: approval?.reason ?? null}
    }
    return approval
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
    const definition = policyMethodDefinition(method)
    if (definition === null) {
        return deny("UNKNOWN_CONTROL_METHOD", "Unknown control method")
    }
    const canonicalAction = definition.action
    if (action !== undefined && action !== canonicalAction) {
        return deny("METHOD_ACTION_MISMATCH", "Action does not match the control method")
    }
    if (definition.reason !== null) return approvalDecision(definition.reason, input)

    if (!Array.isArray(grant?.actions) || !grant.actions.includes(canonicalAction)) {
        return deny(
            "ACTION_NOT_GRANTED",
            "Action is not granted for this Operator session",
        )
    }

    const scopeDenial = checkObjectScope(grant, input)
    if (scopeDenial !== null) return scopeDenial

    if (!PHASE_ONE_ACTIONS.has(canonicalAction)) {
        return deny(
            "ACTION_NOT_ALLOWED",
            "Action is not available in control-plane phase one",
        )
    }

    if (canonicalAction === "runtime.execute") {
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

    if (canonicalAction === "evaluations.execute") {
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
