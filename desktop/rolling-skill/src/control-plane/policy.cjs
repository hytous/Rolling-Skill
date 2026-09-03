const {METHOD_DEFINITIONS, controlDefinition} = require("./contracts.cjs")
const {MAX_SCOPE_IDS, MAX_TRUSTED_SCOPE_IDS} = require("./capability-store.cjs")

const PHASE_ONE_ACTIONS = new Set(
    Object.values(METHOD_DEFINITIONS).map(({action}) => action),
)

const SCOPE_DEFINITIONS = Object.freeze([
    Object.freeze({key: "skillIds", singular: "Skill", direct: "skillId"}),
    Object.freeze({key: "datasetIds", singular: "Dataset", direct: "datasetId"}),
    Object.freeze({key: "runtimeIds", singular: "Runtime", direct: "runtimeId"}),
    Object.freeze({key: "repositoryIds", singular: "Repository", direct: "repositoryId"}),
])

const ALLOW_WITHOUT_RESERVATION = Object.freeze({decision: "allow", reservation: null})
const budgetSnapshotBrands = new WeakMap()
const resolvedScopeBrands = new WeakMap()

const SCOPE_REQUIREMENTS = Object.freeze({
    "context.get": Object.freeze({mode: "filter", keys: Object.freeze(["runtimeIds"])}),
    "raw_cases.list": Object.freeze({mode: "filter", keys: Object.freeze(["skillIds"])}),
    "raw_cases.enqueue": Object.freeze({mode: "access", keys: Object.freeze(["skillIds"])}),
    "raw_cases.update": Object.freeze({mode: "access", keys: Object.freeze(["skillIds"])}),
    "raw_cases.dispatch": Object.freeze({mode: "access", keys: Object.freeze(["skillIds"])}),
    "runtimes.list": Object.freeze({mode: "filter", keys: Object.freeze(["runtimeIds"])}),
    "datasets.list": Object.freeze({mode: "filter", keys: Object.freeze(["datasetIds"])}),
    "datasets.create": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "repositoryIds"]),
    }),
    "evaluations.get": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "evaluations.cancel": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "skill_repositories.list": Object.freeze({mode: "filter", keys: Object.freeze(["repositoryIds"])}),
    "skills.list": Object.freeze({mode: "filter", keys: Object.freeze(["skillIds"])}),
    "skill_versions.list": Object.freeze({mode: "filter", keys: Object.freeze(["skillIds"])}),
    "skills.diff": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "repositoryIds"]),
    }),
    "skills.create_candidate": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "repositoryIds"]),
    }),
    "skills.release": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "repositoryIds"]),
    }),
    "curation.message": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "curation.save": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "curation.discard": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "rubrics.publish": Object.freeze({mode: "access", keys: Object.freeze(["datasetIds"])}),
    "installations.start": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "repositoryIds"]),
    }),
    "installations.get": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "runtimeIds", "repositoryIds"]),
    }),
    "installations.cancel": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "runtimeIds", "repositoryIds"]),
    }),
    "installations.inspect": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.preflight": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.start": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.get": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.pause": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.resume": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.stop": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.submit_candidate": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.submit_decision": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
    "optimization.report": Object.freeze({
        mode: "access",
        keys: Object.freeze(["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]),
    }),
})
const RESOLVED_SCOPE_KEYS = Object.freeze([
    "skillIds",
    "datasetIds",
    "runtimeIds",
    "repositoryIds",
])
const RESOLVED_SCOPE_SOURCE_KEYS = new Set(["method", "mode", "subject", ...RESOLVED_SCOPE_KEYS])
const RESOLVED_SCOPE_SUBJECT_KEYS = new Set(["kind", "id"])
const ACCESS_SCOPE_SUBJECTS = Object.freeze({
    "raw_cases.update": Object.freeze({kind: "raw_case", inputKey: "id"}),
    "raw_cases.dispatch": Object.freeze({kind: "raw_case", inputKey: "id"}),
    "evaluations.get": Object.freeze({kind: "evaluation_run", inputKey: "runId"}),
    "evaluations.cancel": Object.freeze({kind: "evaluation_run", inputKey: "runId"}),
    "datasets.create": Object.freeze({kind: "skill", inputKey: "skillId"}),
    "skills.diff": Object.freeze({kind: "skill", inputKey: "skillId"}),
    "skills.create_candidate": Object.freeze({kind: "skill", inputKey: "skillId"}),
    "skills.release": Object.freeze({kind: "skill", inputKey: "skillId"}),
    "curation.message": Object.freeze({kind: "curation_session", inputKey: "sessionId"}),
    "curation.save": Object.freeze({kind: "curation_session", inputKey: "sessionId"}),
    "curation.discard": Object.freeze({kind: "curation_session", inputKey: "sessionId"}),
    "rubrics.publish": Object.freeze({kind: "rubric_session", inputKey: "sessionId"}),
    "installations.start": Object.freeze({kind: "skill", inputKey: "skillId"}),
    "installations.get": Object.freeze({kind: "installation", inputKey: "installationId"}),
    "installations.cancel": Object.freeze({kind: "installation", inputKey: "installationId"}),
    "installations.inspect": Object.freeze({kind: "installation", inputKey: "installationId"}),
})

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
    "installations.cancel": Object.freeze({
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

function defineOwnData(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

function snapshotPolicyRecord(value, allowedKeys) {
    try {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new TypeError("Invalid resolved scope source data")
        }
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("Invalid resolved scope source data")
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const snapshot = new Map()
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (
                typeof key !== "string" ||
                !allowedKeys.has(key) ||
                descriptor === undefined ||
                !Object.hasOwn(descriptor, "value")
            ) {
                throw new TypeError("Invalid resolved scope source data")
            }
            snapshot.set(key, descriptor.value)
        }
        return snapshot
    } catch {
        throw new TypeError("Invalid resolved scope source data")
    }
}

function policyIdentifier(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 200 &&
        value.trim() === value &&
        /\S/u.test(value) &&
        !/[\u0000-\u001f\u007f]/u.test(value)
        ? value
        : null
}

function normalizedPolicyIds(value, maximum) {
    if (!Array.isArray(value) || value.length > maximum) return null
    const ids = []
    const seen = new Set()
    for (const candidate of value) {
        const id = policyIdentifier(candidate)
        if (id === null) return null
        if (!seen.has(id)) {
            seen.add(id)
            defineOwnData(ids, ids.length, id)
        }
    }
    return Object.freeze(ids)
}

function createBudgetSnapshot({capabilityId, sessionId, usage, revision} = {}) {
    const normalizedCapabilityId = policyIdentifier(capabilityId)
    const normalizedSessionId = policyIdentifier(sessionId)
    if (
        normalizedCapabilityId === null ||
        normalizedSessionId === null ||
        typeof usage !== "object" ||
        usage === null ||
        !Number.isSafeInteger(usage.runtimeTurns) ||
        usage.runtimeTurns < 0 ||
        !Number.isSafeInteger(usage.evaluations) ||
        usage.evaluations < 0 ||
        !Number.isSafeInteger(revision) ||
        revision < 0
    ) {
        throw new TypeError("Invalid budget snapshot source data")
    }
    const snapshot = deepFreeze({
        capabilityId: normalizedCapabilityId,
        sessionId: normalizedSessionId,
        usage: {
            runtimeTurns: usage.runtimeTurns,
            evaluations: usage.evaluations,
        },
        revision,
    })
    budgetSnapshotBrands.set(snapshot, snapshot)
    return snapshot
}

function createResolvedScope(source = {}, {maxScopeIds = MAX_SCOPE_IDS} = {}) {
    if (
        !Number.isSafeInteger(maxScopeIds) ||
        maxScopeIds < MAX_SCOPE_IDS ||
        maxScopeIds > MAX_TRUSTED_SCOPE_IDS
    ) throw new TypeError("Invalid resolved scope limit")
    const sourceSnapshot = snapshotPolicyRecord(source, RESOLVED_SCOPE_SOURCE_KEYS)
    const method = policyIdentifier(sourceSnapshot.get("method"))
    const mode = sourceSnapshot.get("mode")
    if (method === null || (mode !== "access" && mode !== "filter")) {
        throw new TypeError("Invalid resolved scope source data")
    }
    const subjectDefinition = Object.hasOwn(ACCESS_SCOPE_SUBJECTS, method)
        ? ACCESS_SCOPE_SUBJECTS[method]
        : null
    let subject = null
    if (mode === "filter" || subjectDefinition === null) {
        if (sourceSnapshot.has("subject")) {
            throw new TypeError("Invalid resolved scope source data")
        }
    } else {
        if (!sourceSnapshot.has("subject")) {
            throw new TypeError("Invalid resolved scope source data")
        }
        const subjectSnapshot = snapshotPolicyRecord(
            sourceSnapshot.get("subject"),
            RESOLVED_SCOPE_SUBJECT_KEYS,
        )
        const kind = subjectSnapshot.get("kind")
        const id = policyIdentifier(subjectSnapshot.get("id"))
        if (
            subjectSnapshot.size !== RESOLVED_SCOPE_SUBJECT_KEYS.size ||
            kind !== subjectDefinition.kind ||
            id === null
        ) {
            throw new TypeError("Invalid resolved scope source data")
        }
        subject = deepFreeze({kind, id})
    }
    const ids = {}
    const provided = []
    for (const key of RESOLVED_SCOPE_KEYS) {
        if (sourceSnapshot.has(key)) {
            const normalized = normalizedPolicyIds(sourceSnapshot.get(key), maxScopeIds)
            if (normalized === null) throw new TypeError("Invalid resolved scope source data")
            defineOwnData(ids, key, normalized)
            defineOwnData(provided, provided.length, key)
        } else {
            defineOwnData(ids, key, Object.freeze([]))
        }
    }
    const scope = {method, mode}
    for (const key of RESOLVED_SCOPE_KEYS) defineOwnData(scope, key, ids[key])
    if (subject !== null) defineOwnData(scope, "subject", subject)
    deepFreeze(scope)
    resolvedScopeBrands.set(scope, Object.freeze({
        scope,
        provided: Object.freeze(provided),
    }))
    return scope
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
        ...(Array.isArray(request.targets)
            ? request.targets.map((target) => target?.runtimeId)
            : []),
        ...(Array.isArray(request.runtimeConfigurations)
            ? request.runtimeConfigurations.map((runtime) => runtime?.runtimeId)
            : []),
        request.judgeConfiguration?.runtimeId,
        request.operator?.runtimeId,
        request.judge?.runtimeId,
    ])
    const repositoryIds = uniqueStrings([
        request.repositoryId,
        ...(Array.isArray(request.repositoryIds) ? request.repositoryIds : []),
    ])
    return {skillIds, datasetIds, runtimeIds, repositoryIds}
}

function canonicalBudget(value) {
    const source = typeof value === "object" && value !== null ? value : {}
    const budget = {}
    for (const key of [
        "maxDurationMs",
        "maxRuntimeTurns",
        "maxEvaluations",
        "maxTargetExecutions",
        "maxJudgeExecutions",
        "maxTokens",
    ]) {
        if (Number.isSafeInteger(source[key]) && source[key] >= 0) budget[key] = source[key]
    }
    if (Number.isFinite(source.maxReportedCost) && source.maxReportedCost >= 0) {
        budget.maxReportedCost = source.maxReportedCost
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

function operatorApprovalRequirement(method, input = {}) {
    const definition = policyMethodDefinition(method)
    if (definition?.reason === null || definition === null) return null
    return deepFreeze({
        ...approvalDecision(definition.reason, input),
        action: definition.action,
    })
}

const OPERATOR_METHOD_BUDGET_MINIMUMS = Object.freeze({
    "raw_cases.dispatch": Object.freeze({runtimeTurns: 1}),
    "evaluations.start": Object.freeze({evaluations: 1}),
})

function operatorMethodBudgetMinimum(method) {
    if (typeof method !== "string") return Object.freeze({})
    return OPERATOR_METHOD_BUDGET_MINIMUMS[method] ?? Object.freeze({})
}

function deny(code, message) {
    return Object.freeze({decision: "deny", code, message})
}

function checkIdsWithinGrant(grant, referenced) {
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

function scopeRequirement(method, input) {
    if (method === "evaluations.list" && input?.datasetId === null) {
        return {mode: "filter", keys: ["datasetIds"]}
    }
    return Object.hasOwn(SCOPE_REQUIREMENTS, method) ? SCOPE_REQUIREMENTS[method] : null
}

function unresolvedScope() {
    return deny(
        "OBJECT_SCOPE_UNRESOLVED",
        "Object scope could not be resolved for this control method",
    )
}

function mismatchedScopeSubject() {
    return deny(
        "OBJECT_SCOPE_SUBJECT_MISMATCH",
        "Resolved object scope belongs to a different request subject",
    )
}

function checkObjectScope(grant, method, input, resolvedScope) {
    const directDenial = checkIdsWithinGrant(grant, canonicalObjectIds(input))
    if (directDenial !== null) return {denial: directDenial, scopeFilter: null}

    const requirement = scopeRequirement(method, input)
    if (requirement === null) return {denial: null, scopeFilter: null}

    const branded =
        typeof resolvedScope === "object" && resolvedScope !== null
            ? resolvedScopeBrands.get(resolvedScope)
            : null
    if (
        branded === undefined ||
        branded === null ||
        branded.scope.method !== method ||
        branded.scope.mode !== requirement.mode ||
        requirement.keys.some((key) =>
            !branded.provided.includes(key) ||
            (requirement.mode === "access" && branded.scope[key].length === 0),
        )
    ) {
        return {denial: unresolvedScope(), scopeFilter: null}
    }

    const subjectDefinition = Object.hasOwn(ACCESS_SCOPE_SUBJECTS, method)
        ? ACCESS_SCOPE_SUBJECTS[method]
        : null
    if (subjectDefinition !== null) {
        const requestedId = policyIdentifier(input?.[subjectDefinition.inputKey])
        if (
            requestedId === null ||
            branded.scope.subject?.kind !== subjectDefinition.kind ||
            branded.scope.subject.id !== requestedId
        ) {
            return {denial: mismatchedScopeSubject(), scopeFilter: null}
        }
    }

    const resolvedDenial = checkIdsWithinGrant(grant, branded.scope)
    if (resolvedDenial !== null) return {denial: resolvedDenial, scopeFilter: null}

    if (requirement.mode !== "filter") return {denial: null, scopeFilter: null}
    const scopeFilter = {}
    for (const key of requirement.keys) scopeFilter[key] = branded.scope[key]
    return {denial: null, scopeFilter: deepFreeze(scopeFilter)}
}

function allowWithoutReservation(scopeFilter) {
    if (scopeFilter === null) return ALLOW_WITHOUT_RESERVATION
    return deepFreeze({decision: "allow", reservation: null, scopeFilter})
}

function trustedBudgetSnapshot(grant, budgetSnapshot) {
    const snapshot =
        typeof budgetSnapshot === "object" && budgetSnapshot !== null
            ? budgetSnapshotBrands.get(budgetSnapshot)
            : null
    if (snapshot === undefined || snapshot === null) {
        return {
            denial: deny("BUDGET_SNAPSHOT_INVALID", "A trusted budget snapshot is required"),
            snapshot: null,
        }
    }
    if (snapshot.capabilityId !== grant?.id || snapshot.sessionId !== grant?.sessionId) {
        return {
            denial: deny(
                "BUDGET_SNAPSHOT_MISMATCH",
                "Budget snapshot belongs to a different capability session",
            ),
            snapshot: null,
        }
    }
    return {denial: null, snapshot}
}

function reserveBudget(grant, snapshot, {budgetKey, usageKey, amount}) {
    const used = snapshot.usage[usageKey]
    const limit = grant?.budget?.[budgetKey]
    if (!Number.isSafeInteger(limit) || limit < 0) {
        return deny("INVALID_BUDGET_USAGE", "Budget usage is not valid")
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        return deny("INVALID_BUDGET_USAGE", "Budget reservation is not valid")
    }
    const requested = used + amount
    const nextRevision = snapshot.revision + 1
    if (!Number.isSafeInteger(requested) || !Number.isSafeInteger(nextRevision)) {
        return deny(
            "BUDGET_ARITHMETIC_OVERFLOW",
            "Budget reservation would exceed safe integer bounds",
        )
    }
    if (requested > limit) {
        return deepFreeze({
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {
                budget: {[budgetKey]: requested},
            },
        })
    }
    return deepFreeze({
        decision: "allow",
        reservation: {
            capabilityId: snapshot.capabilityId,
            sessionId: snapshot.sessionId,
            budgetKey,
            usageKey,
            amount,
            expectedUsed: used,
            expectedRevision: snapshot.revision,
            limit,
        },
    })
}

function decideControlPolicy({
    grant,
    method,
    action,
    input,
    budgetSnapshot,
    resolvedScope,
    operatorPreauthorized = false,
} = {}) {
    const definition = policyMethodDefinition(method)
    if (definition === null) {
        return deny("UNKNOWN_CONTROL_METHOD", "Unknown control method")
    }
    const canonicalAction = definition.action
    if (action !== undefined && action !== canonicalAction) {
        return deny("METHOD_ACTION_MISMATCH", "Action does not match the control method")
    }
    const scopeState = checkObjectScope(grant, method, input, resolvedScope)
    if (scopeState.denial !== null) return scopeState.denial

    if (!Array.isArray(grant?.actions) || !grant.actions.includes(canonicalAction)) {
        return deny(
            "ACTION_NOT_GRANTED",
            "Action is not granted for this Operator session",
        )
    }

    if (definition.reason !== null) {
        return operatorPreauthorized === true
            ? allowWithoutReservation(scopeState.scopeFilter)
            : approvalDecision(definition.reason, input)
    }

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
        if (!Object.hasOwn(grant?.budget ?? {}, "maxRuntimeTurns")) {
            return allowWithoutReservation(scopeState.scopeFilter)
        }
        const trusted = trustedBudgetSnapshot(grant, budgetSnapshot)
        if (trusted.denial !== null) return trusted.denial
        return reserveBudget(grant, trusted.snapshot, {
            budgetKey: "maxRuntimeTurns",
            usageKey: "runtimeTurns",
            amount: operatorMethodBudgetMinimum(method).runtimeTurns,
        })
    }

    if (canonicalAction === "evaluations.execute") {
        if (method === "evaluations.cancel") {
            return allowWithoutReservation(scopeState.scopeFilter)
        }
        if (method === "evaluations.start") {
            if (!Object.hasOwn(grant?.budget ?? {}, "maxEvaluations")) {
                return allowWithoutReservation(scopeState.scopeFilter)
            }
            const trusted = trustedBudgetSnapshot(grant, budgetSnapshot)
            if (trusted.denial !== null) return trusted.denial
            return reserveBudget(grant, trusted.snapshot, {
                budgetKey: "maxEvaluations",
                usageKey: "evaluations",
                amount: operatorMethodBudgetMinimum(method).evaluations,
            })
        }
        return deny(
            "ACTION_NOT_ALLOWED",
            "Action is not available in control-plane phase one",
        )
    }

    return allowWithoutReservation(scopeState.scopeFilter)
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
    createBudgetSnapshot,
    createControlPolicy,
    createResolvedScope,
    decide: decideControlPolicy,
    decideControlPolicy,
    operatorApprovalRequirement,
    operatorMethodBudgetMinimum,
}
