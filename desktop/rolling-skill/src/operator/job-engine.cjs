const {operatorMethodBudgetMinimum} = require("../control-plane/policy.cjs")
const {isIterationBudget} = require("./operator-budget.cjs")

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"])
const TERMINAL_STEP_STATUSES = new Set(["succeeded", "failed", "cancelled"])
const RESERVATION_FIELDS = Object.freeze([
    "runtimeTurns",
    "evaluations",
    "targetExecutions",
    "judgeExecutions",
    "tokens",
    "reportedCost",
])
const BUDGET_FIELDS = Object.freeze([
    "maxDurationMs",
    "maxRuntimeTurns",
    "maxEvaluations",
    "maxTargetExecutions",
    "maxJudgeExecutions",
    "maxTokens",
    "maxReportedCost",
])
const RESERVATION_LIMITS = Object.freeze({
    runtimeTurns: "maxRuntimeTurns",
    evaluations: "maxEvaluations",
    targetExecutions: "maxTargetExecutions",
    judgeExecutions: "maxJudgeExecutions",
    tokens: "maxTokens",
    reportedCost: "maxReportedCost",
})
const COST_SCALE = 1_000_000
const MAX_TIMER_DELAY_MS = 2_147_483_647

const OPERATOR_ARTIFACT_ID_PROJECTIONS = Object.freeze({
    "datasets.read": {
        datasetId: [["result", "dataset", "id"]],
        repositoryId: [["result", "dataset", "repositoryId"]],
        skillId: [["result", "dataset", "skillId"]],
    },
    "datasets.get": {
        datasetId: [["result", "dataset", "id"]],
        repositoryId: [["result", "dataset", "repositoryId"]],
        skillId: [["result", "dataset", "skillId"]],
    },
    "datasets.create": {
        datasetId: [["result", "dataset", "id"]],
        repositoryId: [["result", "dataset", "repositoryId"]],
        skillId: [["result", "dataset", "skillId"]],
    },
    "datasets.delete": {
        datasetId: [["result", "dataset", "id"], ["facts", "datasetId"]],
        repositoryId: [["result", "dataset", "repositoryId"]],
        skillId: [["result", "dataset", "skillId"]],
    },
    "datasets.delete_case": {
        datasetId: [["result", "case", "datasetId"], ["facts", "datasetId"]],
        caseId: [["result", "case", "id"], ["facts", "caseId"]],
    },
    "evaluations.get": {
        datasetId: [["result", "run", "datasetId"]],
        evaluationId: [["result", "run", "id"], ["result", "runId"]],
    },
    "evaluations.start": {
        datasetId: [["result", "run", "datasetId"], ["selection", "datasetId"]],
        evaluationId: [["result", "run", "id"], ["result", "runId"]],
    },
    "evaluations.cancel": {
        datasetId: [["result", "run", "datasetId"]],
        evaluationId: [["result", "run", "id"], ["result", "runId"]],
    },
    "curation.start": {
        datasetId: [["result", "session", "datasetId"]],
    },
    "curation.message": {
        datasetId: [["result", "session", "datasetId"]],
    },
    "curation.save": {
        datasetId: [["result", "case", "datasetId"], ["result", "session", "datasetId"], ["facts", "datasetId"]],
        caseId: [["result", "case", "id"]],
    },
    "curation.discard": {
        datasetId: [["result", "session", "datasetId"], ["facts", "datasetId"]],
    },
    "rubrics.publish": {
        datasetId: [["facts", "datasetId"]],
    },
    "skills.get": {
        repositoryId: [["result", "skill", "repositoryId"]],
        skillId: [["result", "skill", "id"]],
    },
    "skills.diff": {
        repositoryId: [["result", "diff", "repositoryId"]],
        skillId: [["result", "diff", "skillId"]],
        candidateId: [["result", "diff", "candidateVersionId"]],
    },
    "skills.create_candidate": {
        repositoryId: [["result", "version", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["result", "version", "skillId"], ["facts", "skillId"]],
        candidateId: [["result", "version", "id"], ["result", "versionId"]],
    },
    "skills.release": {
        repositoryId: [["result", "version", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["result", "version", "skillId"], ["facts", "skillId"]],
        candidateId: [["result", "version", "id"], ["result", "versionId"], ["facts", "versionId"]],
    },
    "installations.start": {
        installationId: [["singleInstallation", "id"], ["result", "installationId"]],
        repositoryId: [["singleInstallation", "request", "source", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["singleInstallation", "request", "source", "skillId"], ["facts", "skillId"]],
    },
    "skills.install": {
        installationId: [["result", "installationId"]],
        repositoryId: [["facts", "repositoryId"]],
        skillId: [["facts", "skillId"]],
    },
    "installations.get": {
        installationId: [["result", "installation", "id"], ["facts", "installationId"]],
        repositoryId: [["result", "installation", "request", "source", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["result", "installation", "request", "source", "skillId"], ["facts", "skillId"]],
    },
    "installations.cancel": {
        installationId: [["result", "installation", "id"], ["facts", "installationId"]],
        repositoryId: [["result", "installation", "request", "source", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["result", "installation", "request", "source", "skillId"], ["facts", "skillId"]],
    },
    "installations.inspect": {
        installationId: [["result", "installation", "id"], ["facts", "installationId"]],
        repositoryId: [["result", "installation", "request", "source", "repositoryId"], ["facts", "repositoryId"]],
        skillId: [["result", "installation", "request", "source", "skillId"], ["facts", "skillId"]],
    },
})

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function ownDataProperty(value, key) {
    if ((typeof value !== "object" || value === null) || !Object.hasOwn(value, key)) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined
}

function valueAtPath(source, path) {
    let value = source
    for (const key of path) {
        value = ownDataProperty(value, key)
        if (value === undefined) return undefined
    }
    return value
}

function stableArtifactId(value) {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    if (
        !normalized ||
        normalized.length > 300 ||
        /[\u0000-\u001f\u007f\\/]/u.test(normalized)
    ) return null
    return normalized
}

function operatorArtifactMetadata(method, result, trustedFacts = {}) {
    const projections = OPERATOR_ARTIFACT_ID_PROJECTIONS[method]
    if (!projections) return null
    const methodFacts = isPlainObject(trustedFacts?.methodFacts) &&
        trustedFacts.methodFacts.method === method
        ? trustedFacts.methodFacts
        : null
    const evaluationSelection = method === "evaluations.start" &&
        isPlainObject(trustedFacts?.evaluationSelection)
        ? trustedFacts.evaluationSelection
        : null
    const installations = isPlainObject(result) ? ownDataProperty(result, "installations") : null
    const source = {
        result: isPlainObject(result) ? result : null,
        facts: methodFacts,
        selection: evaluationSelection,
        singleInstallation: Array.isArray(installations) && installations.length === 1
            ? installations[0]
            : null,
    }
    const metadata = {}
    if (method === "installations.start" && Array.isArray(installations)) {
        const installationIds = [...new Set(installations.slice(0, 100).map((installation) => (
            stableArtifactId(ownDataProperty(installation, "id"))
        )).filter((id) => id !== null))]
        if (installationIds.length > 1) metadata.installationIds = installationIds
    }
    for (const [key, paths] of Object.entries(projections)) {
        for (const path of paths) {
            const id = stableArtifactId(valueAtPath(source, path))
            if (id === null) continue
            metadata[key] = id
            break
        }
    }
    return Object.keys(metadata).length > 0 ? metadata : null
}

function requireObject(value, label) {
    if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
    return value
}

function requiredText(value, label, maximum = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maximum) throw new Error(`${label} is required`)
    return normalized
}

function cloneJson(value, label = "Value", seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${label} is not finite JSON`)
        return value
    }
    if (typeof value !== "object" || value === undefined) throw new Error(`${label} is not JSON`)
    if (seen.has(value)) throw new Error(`${label} is cyclic`)
    seen.add(value)
    let cloned
    if (Array.isArray(value)) {
        const keys = Object.keys(value)
        if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
            throw new Error(`${label} must be a dense array`)
        }
        cloned = value.map((entry) => cloneJson(entry, label, seen))
    } else {
        requireObject(value, label)
        cloned = {}
        for (const key of Object.keys(value)) cloned[key] = cloneJson(value[key], label, seen)
    }
    seen.delete(value)
    return cloned
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${stableJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function normalizeReservation(value = {}) {
    const source = requireObject(value, "Operator budget reservation")
    const reservation = {}
    for (const field of Object.keys(source)) {
        if (!RESERVATION_FIELDS.includes(field)) {
            throw new Error(`Operator budget reservation ${field} is unsupported`)
        }
    }
    for (const field of RESERVATION_FIELDS) {
        if (!Object.hasOwn(source, field)) continue
        const amount = source[field]
        const valid = field === "reportedCost"
            ? Number.isFinite(amount) && amount >= 0
            : Number.isSafeInteger(amount) && amount >= 0
        if (!valid) throw new Error(`Operator budget reservation ${field} is invalid`)
        reservation[field] = amount
    }
    return reservation
}

function normalizeTelemetry(value) {
    if (!Array.isArray(value)) throw new Error("Operator Runtime telemetry must be an array")
    const normalized = value.map((entry) => {
        const telemetry = requireObject(entry, "Operator Runtime telemetry entry")
        return {
            runtimeId: requiredText(telemetry.runtimeId, "Operator Runtime telemetry id", 300),
            tokens: telemetry.tokens === true,
            cost: telemetry.cost === true,
        }
    })
    if (new Set(normalized.map((entry) => entry.runtimeId)).size !== normalized.length) {
        throw new Error("Operator Runtime telemetry ids must be unique")
    }
    return normalized
}

function preflightOperatorBudget(budget, runtimeTelemetry = [], involvedRuntimeIds = null) {
    const limits = requireObject(budget, "Operator Job budget")
    if (isIterationBudget(limits)) return {valid: true, fields: {}}
    const telemetry = normalizeTelemetry(runtimeTelemetry)
    const involved = involvedRuntimeIds === null
        ? telemetry.map((entry) => entry.runtimeId)
        : [...new Set(involvedRuntimeIds.map((runtimeId) => (
            requiredText(runtimeId, "Involved Operator Runtime id", 300)
        )))]
    const byRuntimeId = new Map(telemetry.map((entry) => [entry.runtimeId, entry]))
    const tokenTelemetry = involved.length > 0 && involved.every((runtimeId) => byRuntimeId.get(runtimeId)?.tokens)
    const costTelemetry = involved.length > 0 && involved.every((runtimeId) => byRuntimeId.get(runtimeId)?.cost)
    const fields = {}
    for (const field of BUDGET_FIELDS) {
        const optionalTelemetry = field === "maxTokens" || field === "maxReportedCost"
        const supported = !optionalTelemetry || (field === "maxTokens" ? tokenTelemetry : costTelemetry)
        fields[field] = {
            value: limits[field],
            status: supported ? "supported" : "unsupported",
        }
    }
    const selectedUnsupported = ["maxTokens", "maxReportedCost"].some((field) => (
        limits[field] !== null && fields[field].status === "unsupported"
    ))
    return {valid: !selectedUnsupported, fields}
}

function involvedRuntimeIds(params) {
    const source = requireObject(params, "Operator Step params")
    const candidates = [
        source.runtimeId,
        ...(Array.isArray(source.runtimeIds) ? source.runtimeIds : []),
        ...(Array.isArray(source.runtimeConfigurations)
            ? source.runtimeConfigurations.map((entry) => entry?.runtimeId)
            : []),
        source.judgeConfiguration?.runtimeId,
    ]
    return [...new Set(candidates.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()))]
}

function errorRecord(error, fallbackCode = "OPERATOR_STEP_FAILED") {
    const code = typeof error?.code === "string" && error.code.trim()
        ? error.code.trim().slice(0, 200)
        : fallbackCode
    const message = typeof error?.message === "string" && error.message.trim()
        ? error.message.trim().slice(0, 16_384)
        : "Operator Step failed"
    return {code, message}
}

function requestForExecution(input) {
    const request = requireObject(input, "Operator Step execution")
    const requestedReservation = normalizeReservation(request.reservation ?? {})
    const normalized = {
        method: requiredText(request.method, "Operator Step method", 300),
        params: cloneJson(requireObject(request.params ?? {}, "Operator Step params"), "Operator Step params"),
        idempotencyKey: requiredText(request.idempotencyKey, "Operator Step idempotency key", 500),
        reservation: cloneJson(requestedReservation),
        requestedReservation,
    }
    if (Object.hasOwn(request, "policyApproval") && request.policyApproval !== null) {
        const approval = requireObject(request.policyApproval, "Operator control approval gate")
        normalized.policyApproval = {
            decision: "approval_required",
            reason: requiredText(approval.reason, "Operator control approval reason", 300),
            action: requiredText(approval.action, "Operator control approval action", 300),
            requestedScope: cloneJson(
                requireObject(approval.requestedScope ?? {}, "Operator control approval scope"),
                "Operator control approval scope",
            ),
        }
    }
    if (Object.hasOwn(request, "assertRunnable")) {
        if (typeof request.assertRunnable !== "function") {
            throw new Error("Operator execution guard must be a function")
        }
        normalized.assertRunnable = request.assertRunnable
    }
    if (Object.hasOwn(request, "handlerContext")) {
        if (!isPlainObject(request.handlerContext) || !Object.isFrozen(request.handlerContext)) {
            throw new Error("Operator handler context must be an immutable plain object")
        }
        normalized.handlerContext = request.handlerContext
    }
    if (Object.hasOwn(request, "trustedFacts")) {
        normalized.trustedFacts = cloneJson(
            requireObject(request.trustedFacts, "Pre-resolved Operator trusted facts"),
            "Pre-resolved Operator trusted facts",
        )
    }
    return normalized
}

function frozenStepRequest(request) {
    return {
        method: request.method,
        params: cloneJson(request.params),
        reservation: cloneJson(request.reservation),
        policyApproval: request.policyApproval ? cloneJson(request.policyApproval) : null,
    }
}

function approvalMutation(request) {
    return {
        method: request.method,
        params: cloneJson(request.params),
        idempotencyKey: request.idempotencyKey,
        reservation: cloneJson(request.reservation),
    }
}

function isReadMethod(method) {
    return /\.(?:get|list|read|inspect)$/u.test(method)
}

function isDeleteMethod(method) {
    return /\.(?:delete|delete_case)$/u.test(method)
}

function safeProduct(left, right, label) {
    const value = left * right
    if (!Number.isSafeInteger(value)) throw new Error(`${label} is too large`)
    return value
}

function resolvedEvaluationSelection(value, datasetId) {
    const fail = (message) => Object.assign(new Error(message), {
        code: "BUDGET_SELECTION_UNRESOLVED",
    })
    let selection
    try {
        selection = requireObject(value, "Resolved Dataset evaluation selection")
        const fields = Object.keys(selection).sort()
        if (fields.length !== 2 || fields[0] !== "caseIds" || fields[1] !== "datasetRevision") {
            throw new Error("must freeze exactly caseIds and datasetRevision")
        }
        if (!Array.isArray(selection.caseIds) || selection.caseIds.length === 0) {
            throw new Error("must contain at least one Case")
        }
        const caseIds = cloneJson(selection.caseIds, "Resolved Dataset evaluation Case ids")
            .map((caseId) => requiredText(caseId, "Resolved Dataset evaluation Case id", 300))
        if (new Set(caseIds).size !== caseIds.length) throw new Error("has duplicate Cases")
        return {
            datasetId: requiredText(datasetId, "Evaluation Dataset id", 300),
            caseIds,
            datasetRevision: requiredText(
                selection.datasetRevision,
                "Resolved Dataset evaluation revision",
                500,
            ),
        }
    } catch (error) {
        throw fail(`Dataset evaluation selection is invalid: ${error.message}`)
    }
}

function selectedParamsFromFacts(params, trustedFacts) {
    const source = cloneJson(params, "Operator Step params")
    if (source.selectionMode !== "dataset") return source
    const facts = requireObject(trustedFacts, "Operator Step trusted facts")
    const persisted = requireObject(
        facts.evaluationSelection,
        "Frozen Dataset evaluation selection",
    )
    const fields = Object.keys(persisted).sort()
    if (fields.length !== 3 || fields[0] !== "caseIds" || fields[1] !== "datasetId" ||
        fields[2] !== "datasetRevision") {
        throw Object.assign(new Error("Frozen Dataset evaluation selection has invalid fields"), {
            code: "BUDGET_SELECTION_UNRESOLVED",
        })
    }
    const selection = resolvedEvaluationSelection({
        caseIds: persisted.caseIds,
        datasetRevision: persisted.datasetRevision,
    }, source.datasetId)
    if (persisted.datasetId !== source.datasetId) {
        throw Object.assign(new Error("Frozen Dataset evaluation selection does not match the request"), {
            code: "BUDGET_SELECTION_UNRESOLVED",
        })
    }
    return {
        ...source,
        selectionMode: "selected",
        caseIds: cloneJson(selection.caseIds),
        expectedDatasetRevision: selection.datasetRevision,
    }
}

function costUnits(value) {
    return Math.round(value * COST_SCALE)
}

function segmentedTimeout(callback, totalMs) {
    if (!Number.isSafeInteger(totalMs) || totalMs < 0) {
        throw new Error("Operator timeout must be a non-negative safe integer")
    }
    let remainingMs = totalMs
    let handle = null
    let cancelled = false
    const arm = () => {
        if (cancelled) return
        if (remainingMs === 0) {
            callback()
            return
        }
        const delay = Math.min(remainingMs, MAX_TIMER_DELAY_MS)
        handle = setTimeout(() => {
            handle = null
            remainingMs -= delay
            arm()
        }, delay)
    }
    arm()
    return () => {
        cancelled = true
        if (handle !== null) clearTimeout(handle)
    }
}

function operatorCancellationError() {
    return Object.assign(new Error("Operator Job was cancelled"), {code: "OPERATOR_CANCELLED"})
}

const ENGINE_COORDINATION = new WeakMap()

function engineCoordination(store) {
    const key = store.coordinationKey
    let coordination = ENGINE_COORDINATION.get(key)
    if (!coordination) {
        coordination = {
            activeSteps: new Map(),
            jobQueues: new Map(),
            operations: new Map(),
        }
        ENGINE_COORDINATION.set(key, coordination)
    }
    return coordination
}

class OperatorJobEngine {
    #store
    #handlers
    #approvalDecider
    #reconcilers
    #runtimeTelemetry
    #resolveEvaluationCaseCount
    #resolveTrustedFacts
    #externalAwaitTimeoutMs
    #now
    #approvalTtlMs
    #coordination
    #activeSteps
    #manualApprovalWaiters

    constructor({
        store,
        handlers = {},
        approvalDecider = null,
        reconcilers = {},
        runtimeTelemetry = [],
        resolveEvaluationCaseCount = null,
        resolveTrustedFacts = null,
        externalAwaitTimeoutMs = 30_000,
        now = Date.now,
        approvalTtlMs = 15 * 60 * 1_000,
    } = {}) {
        if (!store || typeof store.createStep !== "function") {
            throw new Error("Operator Job store with Step support is required")
        }
        if (!isPlainObject(handlers) || !isPlainObject(reconcilers)) {
            throw new Error("Operator handlers and reconcilers must be plain objects")
        }
        if (approvalDecider !== null && typeof approvalDecider !== "function") {
            throw new Error("Operator approval decider must be a function")
        }
        if (typeof runtimeTelemetry !== "function") normalizeTelemetry(runtimeTelemetry)
        if (resolveEvaluationCaseCount !== null && typeof resolveEvaluationCaseCount !== "function") {
            throw new Error("Operator evaluation case resolver must be a function")
        }
        if (resolveTrustedFacts !== null && typeof resolveTrustedFacts !== "function") {
            throw new Error("Operator trusted facts resolver must be a function")
        }
        if (typeof now !== "function" || !Number.isSafeInteger(approvalTtlMs) || approvalTtlMs <= 0 ||
            !Number.isSafeInteger(externalAwaitTimeoutMs) || externalAwaitTimeoutMs <= 0) {
            throw new Error("Operator engine clock or approval TTL is invalid")
        }
        this.#store = store
        this.#handlers = {...handlers}
        this.#approvalDecider = approvalDecider
        this.#reconcilers = {...reconcilers}
        this.#runtimeTelemetry = runtimeTelemetry
        this.#resolveEvaluationCaseCount = resolveEvaluationCaseCount
        this.#resolveTrustedFacts = resolveTrustedFacts
        this.#externalAwaitTimeoutMs = externalAwaitTimeoutMs
        this.#now = now
        this.#approvalTtlMs = approvalTtlMs
        this.#coordination = engineCoordination(store)
        this.#activeSteps = this.#coordination.activeSteps
        this.#manualApprovalWaiters = new Map()
    }

    scheduleChild(parentJobId, input = {}) {
        const child = requireObject(input, "Child Operator Job")
        return this.#enqueue(parentJobId, () => {
            const parent = this.#store.getJob(parentJobId)
            return this.#store.createJob({
                sessionId: parent.sessionId,
                parentJobId: parent.id,
                type: child.type,
                objective: child.objective,
                budget: child.budget,
            })
        })
    }

    async runChild(input = {}, operation) {
        const request = requireObject(input, "Internal child Operator Job")
        if (typeof operation !== "function") {
            throw new Error("Internal child Operator Job operation is required")
        }
        const child = await this.scheduleChild(
            requiredText(request.parentJobId, "Parent Operator Job id", 200),
            {
                type: requiredText(request.type, "Child Operator Job type", 200),
                objective: requiredText(request.objective, "Child Operator Job objective", 32_768),
                budget: request.budget,
            },
        )
        return this.#enqueue(child.id, () => this.#withJobOperation(child.id, async (signal) => {
            this.#store.transitionJob(child.id, "running")
            try {
                const result = await operation({
                    jobId: child.id,
                    signal,
                    createArtifact: (artifact) => this.#store.createArtifact(child.id, artifact),
                })
                if (signal.aborted) {
                    this.#store.beginCancellation(child.id)
                    this.#store.transitionJob(child.id, "cancelled", {
                        error: {code: "OPERATOR_CHILD_CANCELLED", message: "Internal child Job was cancelled"},
                    })
                    return result
                }
                this.#store.transitionJob(child.id, "succeeded", {
                    result: {internal: true},
                })
                return result
            } catch (error) {
                const current = this.#store.getJob(child.id)
                if (current.status === "cancelling" || signal.aborted) {
                    if (current.status !== "cancelling") this.#store.beginCancellation(child.id)
                    this.#store.transitionJob(child.id, "cancelled", {
                        error: {
                            code: "OPERATOR_CHILD_CANCELLED",
                            message: error?.message ?? "Internal child Job was cancelled",
                        },
                    })
                } else if (error?.code === "OPTIMIZATION_INSTALL_NEEDS_RECOVERY") {
                    this.#store.transitionJob(child.id, "needs_recovery", {
                        error: {code: error.code, message: error.message},
                    })
                } else {
                    this.#store.transitionJob(child.id, "failed", {
                        error: {
                            code: typeof error?.code === "string" && error.code
                                ? error.code
                                : "OPERATOR_CHILD_FAILED",
                            message: error?.message ?? String(error),
                        },
                    })
                }
                throw error
            }
        }))
    }

    requestApproval(jobId, input = {}, options = {}) {
        const request = requireObject(input, "Internal Operator approval")
        const onPending = options?.onPending ?? null
        if (onPending !== null && typeof onPending !== "function") {
            throw new Error("Internal Operator approval pending callback is invalid")
        }
        const action = requiredText(request.action, "Internal approval action", 300)
        const risk = requiredText(request.risk, "Internal approval risk", 16_384)
        const scope = cloneJson(requireObject(request.scope, "Internal approval scope"))
        const proposedMutation = cloneJson(requireObject(
            request.proposedMutation,
            "Internal approval mutation",
        ))
        const idempotencyKey = requiredText(
            request.idempotencyKey,
            "Internal approval idempotency key",
            300,
        )
        return this.#enqueue(jobId, () => {
            let job = this.#store.getJob(jobId)
            const existing = this.#store.listSteps({jobId}).find((step) => (
                step.idempotencyKey === idempotencyKey
            ))
            if (existing) {
                if (existing.method !== "optimization.approval") {
                    throw new Error("Internal approval idempotency conflict")
                }
                const approval = this.#store.listApprovals(jobId).find(
                    (entry) => entry.stepId === existing.id,
                )
                if (!approval) throw new Error("Internal approval evidence is incomplete")
                if (approval.action !== action || approval.risk !== risk ||
                    stableJson(approval.scope) !== stableJson(scope) ||
                    stableJson(approval.proposedMutation.params?.proposedMutation) !==
                        stableJson(proposedMutation)) {
                    throw new Error("Internal approval idempotency conflict")
                }
                return approval
            }
            if (job.status === "queued") job = this.#store.transitionJob(job.id, "running")
            if (job.status !== "running") {
                throw new Error(`Operator Job cannot request approval while ${job.status}`)
            }
            let step = this.#store.createStep(job.id, {
                method: "optimization.approval",
                params: {action, risk, scope, proposedMutation},
                idempotencyKey,
                reservation: {},
            })
            step = this.#store.transitionStep(step.id, "waiting_approval")
            this.#store.transitionJob(job.id, "waiting_approval")
            return this.#store.createApproval(job.id, {
                stepId: step.id,
                action,
                scope,
                proposedMutation: {
                    method: "optimization.approval",
                    params: {action, risk, scope, proposedMutation},
                    idempotencyKey,
                    reservation: {},
                },
                risk,
                expiresAt: new Date(this.#now() + this.#approvalTtlMs).toISOString(),
            })
        }).then((approval) => {
            onPending?.(cloneJson(approval))
            return this.#waitForManualApproval(approval)
        })
    }

    #manualApprovalResult(approval) {
        if (approval.status === "pending") return null
        return {
            approved: approval.status === "approved",
            approvalId: approval.id,
            decisionScope: approval.decisionScope,
        }
    }

    #waitForManualApproval(approval) {
        const settled = this.#manualApprovalResult(approval)
        if (settled) return settled
        const existing = this.#manualApprovalWaiters.get(approval.id)
        if (existing) return existing.promise
        let resolveWaiter
        const promise = new Promise((resolve_) => { resolveWaiter = resolve_ })
        this.#manualApprovalWaiters.set(approval.id, {promise, resolve: resolveWaiter})
        return promise
    }

    #settleManualApproval(approval) {
        const waiter = this.#manualApprovalWaiters.get(approval.id)
        if (!waiter) return
        this.#manualApprovalWaiters.delete(approval.id)
        waiter.resolve(this.#manualApprovalResult(approval))
    }

    suspendApprovalWaiter(approvalId) {
        const approval = this.#store.getApproval(requiredText(
            approvalId,
            "Operator approval id",
            200,
        ))
        if (approval.status !== "pending") return false
        const waiter = this.#manualApprovalWaiters.get(approval.id)
        if (!waiter) return false
        this.#manualApprovalWaiters.delete(approval.id)
        waiter.resolve({
            approved: false,
            suspended: true,
            approvalId: approval.id,
            decisionScope: "app_shutdown",
        })
        return true
    }

    #settleClosedManualApprovals() {
        for (const approvalId of [...this.#manualApprovalWaiters.keys()]) {
            let approval
            try {
                approval = this.#store.getApproval(approvalId)
            } catch {
                continue
            }
            if (approval.status !== "pending") this.#settleManualApproval(approval)
        }
    }

    execute(jobId, input = {}) {
        return this.#enqueue(jobId, () => this.#withJobOperation(
            jobId,
            (signal) => this.#execute(jobId, requestForExecution(input), signal),
        ))
    }

    async #effectiveRequest(request, signal, budget) {
        const iterationOnly = isIterationBudget(budget)
        const minimum = iterationOnly ? {} : {...operatorMethodBudgetMinimum(request.method)}
        const trustedFacts = {
            ...(request.policyApproval ? {
                controlPolicyApproval: cloneJson(request.policyApproval),
            } : {}),
            ...(request.trustedFacts ? {
                methodFacts: cloneJson(request.trustedFacts),
            } : {}),
        }
        if (!request.trustedFacts && this.#resolveTrustedFacts !== null) {
            const resolved = await this.#boundedAwait(
                (hookSignal) => this.#resolveTrustedFacts({
                    method: request.method,
                    params: cloneJson(request.params),
                    controlContext: request.handlerContext ?? null,
                    signal: hookSignal,
                }),
                {signal, label: "Operator trusted facts resolution"},
            )
            if (resolved !== null && resolved !== undefined) {
                trustedFacts.methodFacts = cloneJson(
                    requireObject(resolved, "Operator method-specific trusted facts"),
                    "Operator method-specific trusted facts",
                )
            }
        }
        if (request.method === "evaluations.start") {
            const params = request.params
            let caseCount = 0
            if (params.selectionMode === "selected") {
                if (!Array.isArray(params.caseIds) || params.caseIds.length === 0) {
                    throw Object.assign(new Error("Selected evaluation cases are required"), {
                        code: "BUDGET_SELECTION_UNRESOLVED",
                    })
                }
                caseCount = params.caseIds.length
            } else if (params.selectionMode === "dataset") {
                if (this.#resolveEvaluationCaseCount === null) {
                    throw Object.assign(new Error("Dataset evaluation size must be resolved before execution"), {
                        code: "BUDGET_SELECTION_UNRESOLVED",
                    })
                }
                const selection = resolvedEvaluationSelection(await this.#boundedAwait(
                    (hookSignal) => this.#resolveEvaluationCaseCount(
                        cloneJson(params),
                        {signal: hookSignal},
                    ),
                    {signal, label: "Operator evaluation case resolution"},
                ), params.datasetId)
                caseCount = selection.caseIds.length
                trustedFacts.evaluationSelection = selection
            }
            if (caseCount > 0) {
                if (!Array.isArray(params.runtimeConfigurations) || params.runtimeConfigurations.length === 0) {
                    throw Object.assign(new Error("Evaluation Runtime selection is required"), {
                        code: "BUDGET_SELECTION_UNRESOLVED",
                    })
                }
                if (!iterationOnly) {
                    const executions = safeProduct(
                        caseCount,
                        params.runtimeConfigurations.length,
                        "Operator evaluation execution reservation",
                    )
                    minimum.targetExecutions = executions
                    if (isPlainObject(params.judgeConfiguration)) minimum.judgeExecutions = executions
                }
            }
        }
        const reservation = iterationOnly ? {} : {...request.reservation}
        for (const [field, amount] of Object.entries(minimum)) {
            reservation[field] = Math.max(reservation[field] ?? 0, amount)
        }
        return {
            ...request,
            ...(request.params.selectionMode === "dataset" ? {requestedParams: request.params} : {}),
            params: selectedParamsFromFacts(request.params, trustedFacts),
            reservation,
            trustedFacts,
        }
    }

    async #execute(jobId, request, signal) {
        if (request.assertRunnable && request.assertRunnable() !== true) {
            throw Object.assign(new Error("Operator session is not accepting new Steps"), {
                code: "CONTROL_BUSY",
            })
        }
        let job = this.#store.getJob(jobId)
        const existing = this.#store.listSteps({jobId}).find((step) => (
            step.idempotencyKey === request.idempotencyKey
        ))
        if (existing) return this.#existingResult(existing, request, signal)
        if (job.status === "queued") job = this.#store.transitionJob(job.id, "running")
        if (job.status !== "running") {
            throw new Error(`Operator Job cannot execute a new Step while ${job.status}`)
        }

        request = await this.#effectiveRequest(request, signal, job.budget)
        if (request.assertRunnable && request.assertRunnable() !== true) {
            throw Object.assign(new Error("Operator session is not accepting new Steps"), {
                code: "CONTROL_BUSY",
            })
        }
        const step = this.#store.createStep(job.id, {
            method: request.method,
            params: request.params,
            ...(request.requestedParams ? {requestedParams: request.requestedParams} : {}),
            reservation: request.reservation,
            requestedReservation: request.requestedReservation,
            trustedFacts: request.trustedFacts,
            idempotencyKey: request.idempotencyKey,
        })
        const telemetry = isIterationBudget(job.budget) ? [] : await this.#telemetry(request, signal)
        const policyDecision = await this.#preInvokeDecision(job, step, request, telemetry, signal)
        if (policyDecision?.decision === "deny") {
            const error = {
                code: policyDecision.code ?? "OPERATOR_POLICY_DENIED",
                message: policyDecision.message ?? "Operator policy denied the Step",
            }
            this.#store.transitionStep(step.id, "failed", {error})
            return this.#failedResult(this.#store.getStep(step.id))
        }
        if (policyDecision?.decision === "approval_required") {
            return this.#createApproval(job, step, request, policyDecision)
        }
        return this.#runStep(job, step, request, {telemetry, signal})
    }

    async #existingResult(step, request, signal) {
        const creation = this.#stepCreation(step)
        const requestedReservation = creation.requestedReservation ?? creation.request.reservation ?? {}
        if (stableJson({
            method: creation.request.method,
            params: creation.requestedParams ?? creation.request.params,
            reservation: requestedReservation,
            policyApproval: creation.trustedFacts?.controlPolicyApproval ?? null,
        }) !== stableJson(frozenStepRequest(request))) {
            throw new Error("Operator Step idempotency conflict: the key was used for a different request")
        }
        const approvals = this.#store.listApprovals(step.jobId).filter((entry) => entry.stepId === step.id)
        const resolvedApproval = approvals.find((entry) => entry.status !== "pending")
        let job = this.#store.getJob(step.jobId)
        if (resolvedApproval && job.status === "waiting_approval" && step.status !== "waiting_approval") {
            job = this.#store.transitionJob(job.id, "running")
            if (step.status === "running") job = this.#store.transitionJob(job.id, "needs_recovery")
        }
        if (step.status === "succeeded") {
            return this.#succeededResult(step, {cached: true})
        }
        if (step.status === "failed") return this.#failedResult(step)
        if (step.status === "cancelled") {
            return {status: "cancelled", jobId: step.jobId, stepId: step.id}
        }
        const frozenRequest = this.#executionFromStep(step)
        if (request.handlerContext) frozenRequest.handlerContext = request.handlerContext
        if (request.assertRunnable) frozenRequest.assertRunnable = request.assertRunnable
        if (step.status === "pending") return this.#resumePreInvokeStep(step, frozenRequest, signal)
        if (step.status === "waiting_approval") {
            const rejectedApproval = approvals.findLast((entry) => entry.status === "rejected")
            if (rejectedApproval) return this.#resumeResolvedApproval(step, rejectedApproval, signal)
            const approval = approvals.find((entry) => entry.status === "pending")
            if (approval) {
                return {
                    status: "waiting_approval",
                    approvalId: approval.id,
                    jobId: step.jobId,
                    stepId: step.id,
                }
            }
            const latestResolved = approvals.findLast((entry) => entry.status !== "pending")
            if (latestResolved) return this.#resumeResolvedApproval(step, latestResolved, signal)
            return this.#resumePreInvokeStep(step, frozenRequest, signal)
        }
        return {status: "needs_recovery", jobId: step.jobId, stepId: step.id}
    }

    async #resumePreInvokeStep(step, request, signal) {
        let job = this.#store.getJob(step.jobId)
        if (job.status === "needs_recovery") job = this.#store.transitionJob(job.id, "running")
        if (job.status !== "running" && job.status !== "waiting_approval") {
            return {status: "needs_recovery", jobId: step.jobId, stepId: step.id}
        }
        const telemetry = isIterationBudget(job.budget) ? [] : await this.#telemetry(request, signal)
        const decision = await this.#preInvokeDecision(job, step, request, telemetry, signal)
        if (decision?.decision === "approval_required") {
            return this.#createApproval(job, step, request, decision)
        }
        if (decision?.decision === "deny") {
            if (job.status === "waiting_approval") this.#store.transitionJob(job.id, "running")
            const failed = this.#store.transitionStep(step.id, "failed", {error: {
                code: decision.code ?? "OPERATOR_POLICY_DENIED",
                message: decision.message ?? "Operator policy denied the Step",
            }})
            return this.#failedResult(failed)
        }
        if (job.status === "waiting_approval") job = this.#store.transitionJob(job.id, "running")
        return this.#runStep(job, step, request, {telemetry, signal})
    }

    async #resumeResolvedApproval(step, approval, signal) {
        let job = this.#store.getJob(step.jobId)
        if (job.status === "waiting_approval") {
            job = this.#store.transitionJob(job.id, "running")
        }
        if (approval.status === "rejected") {
            const failed = this.#store.transitionStep(step.id, "failed", {
                error: {code: "APPROVAL_REJECTED", message: "Operator approval was rejected"},
            })
            this.#restoreJobAfterRecovery(step.jobId)
            return this.#failedResult(failed)
        }
        if (approval.status !== "approved") {
            throw new Error("Resolved Operator approval status is invalid")
        }
        const request = this.#executionFromStep(step)
        const result = await this.#resumePreInvokeStep(step, request, signal)
        this.#restoreJobAfterRecovery(step.jobId)
        return result
    }

    #restoreJobAfterRecovery(jobId) {
        const job = this.#store.getJob(jobId)
        if (job.status !== "needs_recovery") return job
        const unknown = this.#store.listSteps({jobId}).some((step) => !TERMINAL_STEP_STATUSES.has(step.status))
        return unknown ? job : this.#store.transitionJob(job.id, "running")
    }

    async #customApprovalDecision(request, job, signal) {
        if (this.#approvalDecider) {
            return this.#boundedAwait(
                (hookSignal) => this.#approvalDecider({
                    method: request.method,
                    params: cloneJson(request.params),
                    job: cloneJson(job),
                    signal: hookSignal,
                }),
                {signal, label: "Operator approval policy"},
            )
        }
        return {decision: "allow"}
    }

    #hasApprovedGate(step, decision) {
        return this.#store.listApprovals(step.jobId).some((approval) => (
            approval.stepId === step.id && approval.status === "approved" &&
            approval.action === (decision.action ?? decision.requestedAction ?? step.method) &&
            approval.risk === decision.reason &&
            stableJson(approval.scope) === stableJson(decision.requestedScope ?? {})
        ))
    }

    async #preInvokeDecision(job, step, request, telemetry, signal) {
        const custom = requireObject(
            await this.#customApprovalDecision(request, job, signal),
            "Operator approval decision",
        )
        if (custom.decision === "deny") return custom
        const controlGate = request.trustedFacts?.controlPolicyApproval ?? null
        if (controlGate && !this.#hasApprovedGate(step, controlGate)) return controlGate
        if (custom.decision === "approval_required" && !this.#hasApprovedGate(step, custom)) return custom
        if (custom.decision !== "allow" && custom.decision !== "approval_required") {
            throw new Error("Operator approval decision is invalid")
        }
        if (isIterationBudget(job.budget)) return {decision: "allow"}
        const budget = this.#budgetAssessment(
            job,
            request.reservation,
            telemetry,
            involvedRuntimeIds(request.params),
            this.#budgetLimits(job, step.id),
        )
        if (!budget.preflight.valid) {
            return {
                decision: "deny",
                code: "BUDGET_TELEMETRY_UNSUPPORTED",
                message: "Token or reported-cost budget requires telemetry from every involved Runtime",
            }
        }
        if (budget.overages.length > 0) {
            return {
                decision: "approval_required",
                reason: "budget_expansion",
                action: "budget.expand",
                requestedScope: {budget: this.#requestedBudgetScope(
                    job,
                    request.reservation,
                    this.#budgetLimits(job, step.id),
                )},
            }
        }
        return {decision: "allow"}
    }

    #createApproval(job, step, request, decision) {
        let currentJob = this.#store.getJob(job.id)
        let currentStep = this.#store.getStep(step.id)
        if (currentJob.status === "needs_recovery") {
            currentJob = this.#store.transitionJob(currentJob.id, "running")
        }
        const existing = this.#store.listApprovals(currentJob.id).find((approval) => (
            approval.stepId === currentStep.id && approval.status === "pending" &&
            approval.action === (decision.action ?? request.method) && approval.risk === decision.reason &&
            stableJson(approval.scope) === stableJson(decision.requestedScope ?? {})
        ))
        if (existing) {
            return {
                status: "waiting_approval",
                approvalId: existing.id,
                jobId: currentJob.id,
                stepId: currentStep.id,
            }
        }
        if (currentStep.status === "pending") {
            currentStep = this.#store.transitionStep(currentStep.id, "waiting_approval")
        }
        if (currentStep.status !== "waiting_approval") {
            throw new Error("Operator Step cannot enter approval from its current status")
        }
        if (currentJob.status === "running") {
            currentJob = this.#store.transitionJob(currentJob.id, "waiting_approval")
        }
        if (currentJob.status !== "waiting_approval") {
            throw new Error("Operator Job cannot enter approval from its current status")
        }
        const approval = this.#store.createApproval(currentJob.id, {
            stepId: step.id,
            action: decision.action ?? request.method,
            scope: cloneJson(decision.requestedScope ?? {}),
            proposedMutation: approvalMutation(request),
            risk: requiredText(decision.reason, "Operator approval risk", 16_384),
            expiresAt: new Date(this.#now() + this.#approvalTtlMs).toISOString(),
        })
        return {
            status: "waiting_approval",
            approvalId: approval.id,
            jobId: currentJob.id,
            stepId: step.id,
        }
    }

    resolveApproval(approvalId, input = {}) {
        const approval = this.#store.getApproval(approvalId)
        return this.#enqueue(approval.jobId, () => this.#withJobOperation(
            approval.jobId,
            (signal) => this.#resolveApproval(approvalId, input, null, signal),
        ))
    }

    async #resolveApproval(approvalId, input = {}, errorOverride = null, signal = null) {
        const decision = requireObject(input, "Operator approval decision")
        if (decision.decision !== "approve" && decision.decision !== "reject") {
            throw new Error("Operator approval decision must be approve or reject")
        }
        const resolved = this.#store.resolveApproval(approvalId, {
            decision: decision.decision,
            scope: requiredText(decision.scope, "Operator approval decision scope", 300),
            decidedBy: typeof decision.decidedBy === "string" ? decision.decidedBy : null,
        })
        const step = this.#store.getStep(resolved.stepId)
        if (this.#store.getJob(resolved.jobId).status === "waiting_approval") {
            this.#store.transitionJob(resolved.jobId, "running")
        }
        if (step.method === "optimization.approval") {
            if (decision.decision === "approve") {
                this.#store.transitionStep(step.id, "running")
                const artifact = this.#store.createArtifact(resolved.jobId, {
                    kind: "optimization-approval",
                    name: `optimization-approval-${resolved.id}.json`,
                    mediaType: "application/json",
                    body: `${JSON.stringify({
                        approvalId: resolved.id,
                        approved: true,
                        decisionScope: resolved.decisionScope,
                    })}\n`,
                    metadata: null,
                })
                this.#store.transitionStep(step.id, "succeeded", {
                    outputArtifactIds: [artifact.id],
                })
            } else {
                this.#store.transitionStep(step.id, "failed", {error: errorOverride ?? {
                    code: "APPROVAL_REJECTED",
                    message: "Operator approval was rejected",
                }})
            }
            this.#settleManualApproval(resolved)
            return decision.decision === "approve"
                ? this.#succeededResult(this.#store.getStep(step.id))
                : this.#failedResult(this.#store.getStep(step.id))
        }
        if (decision.decision === "reject") {
            const error = errorOverride ?? {
                code: "APPROVAL_REJECTED",
                message: "Operator approval was rejected",
            }
            const failed = this.#store.transitionStep(step.id, "failed", {error})
            return this.#failedResult(failed)
        }
        const request = this.#executionFromStep(step)
        return this.#resumePreInvokeStep(step, request, signal)
    }

    async expireApprovals(jobId = null) {
        const jobs = jobId === null ? this.#store.listJobs() : [this.#store.getJob(jobId)]
        const expired = []
        for (const job of jobs) {
            const approvals = this.#store.listApprovals(job.id).filter((approval) => (
                approval.status === "pending" && Date.parse(approval.expiresAt) <= this.#now()
            ))
            for (const approval of approvals) {
                const result = await this.#enqueue(approval.jobId, () => this.#withJobOperation(
                    approval.jobId,
                    (signal) => this.#resolveApproval(
                        approval.id,
                        {
                            decision: "reject",
                            scope: "expired",
                            decidedBy: "job-engine",
                        },
                        {
                            code: "APPROVAL_EXPIRED",
                            message: "Operator approval expired",
                        },
                        signal,
                    ),
                ))
                expired.push({approvalId: approval.id, jobId: approval.jobId, stepId: result.stepId})
            }
        }
        return expired
    }

    async #runStep(job, initialStep, request, {telemetry = [], signal = null} = {}) {
        let step = this.#store.getStep(initialStep.id)
        try {
            const iterationOnly = isIterationBudget(job.budget)
            if (!iterationOnly) this.#reserveBudget(job, step, request, telemetry)
            if (step.status === "running") {
                return {status: "needs_recovery", jobId: job.id, stepId: step.id}
            }
            try {
                step = this.#store.transitionStep(step.id, "running")
            } catch (error) {
                const current = this.#store.getStep(step.id)
                if (current.status === "running" || TERMINAL_STEP_STATUSES.has(current.status)) {
                    return current.status === "succeeded"
                        ? this.#succeededResult(current, {cached: true})
                        : {status: current.status === "running" ? "needs_recovery" : current.status,
                            jobId: job.id, stepId: current.id}
                }
                throw error
            }
            const handler = this.#handlers[request.method]
            if (typeof handler !== "function") {
                throw Object.assign(new Error(`No Operator handler is registered for ${request.method}`), {
                    code: "OPERATOR_HANDLER_MISSING",
                })
            }
            const controller = new AbortController()
            const abortFromOperation = () => controller.abort(signal?.reason ?? operatorCancellationError())
            if (signal?.aborted) abortFromOperation()
            else signal?.addEventListener("abort", abortFromOperation, {once: true})
            this.#activeSteps.set(step.id, controller)
            let result
            try {
                const handlerTrustedFacts = cloneJson(request.trustedFacts ?? {})
                const handlerControlContext = Object.hasOwn(handlerTrustedFacts, "methodFacts")
                    ? Object.freeze({
                          ...(request.handlerContext ?? {}),
                          trustedFacts: handlerTrustedFacts,
                      })
                    : request.handlerContext ?? null
                const awaitOptions = {
                    signal: controller.signal,
                    label: "Operator handler",
                }
                if (!iterationOnly) {
                    const timeoutError = Object.assign(new Error("Operator Job duration budget was exceeded"), {
                        code: "BUDGET_DURATION_EXCEEDED",
                    })
                    const limits = this.#budgetLimits(job, step.id)
                    const remainingMs = limits.maxDurationMs - Math.max(0, this.#now() - Date.parse(job.createdAt))
                    if (remainingMs <= 0) throw timeoutError
                    awaitOptions.timeoutMs = remainingMs
                    awaitOptions.timeoutError = timeoutError
                }
                result = await this.#boundedAwait((hookSignal) => handler({
                    method: request.method,
                    params: cloneJson(request.params),
                    trustedFacts: handlerTrustedFacts,
                    idempotencyKey: request.idempotencyKey,
                    jobId: job.id,
                    stepId: step.id,
                    signal: hookSignal,
                    controlContext: handlerControlContext,
                }), awaitOptions)
            } finally {
                signal?.removeEventListener("abort", abortFromOperation)
                this.#activeSteps.delete(step.id)
            }
            const current = this.#store.getStep(step.id)
            if (current.status === "cancelled") {
                return {status: "cancelled", jobId: job.id, stepId: step.id}
            }
            return this.#persistStepResult(current, result ?? null, {
                method: request.method,
                trustedFacts: request.trustedFacts,
            })
        } catch (error) {
            const current = this.#store.getStep(step.id)
            if (
                current.status === "needs_recovery" ||
                this.#store.getJob(job.id).status === "needs_recovery"
            ) {
                return {status: "needs_recovery", jobId: job.id, stepId: current.id}
            }
            if (current.status === "cancelled") {
                return {status: "cancelled", jobId: job.id, stepId: step.id}
            }
            if (this.#store.getJob(job.id).status === "cancelling") {
                return {status: "cancelled", jobId: job.id, stepId: step.id}
            }
            if (!TERMINAL_STEP_STATUSES.has(current.status)) {
                step = this.#store.transitionStep(current.id, "failed", {error: errorRecord(error)})
            } else {
                step = current
            }
            return this.#failedResult(step)
        }
    }

    #persistStepResult(step, result, {method = step.method, trustedFacts = {}} = {}) {
        const metadata = operatorArtifactMetadata(method, result, trustedFacts)
        const artifact = this.#store.createArtifact(step.jobId, {
            kind: "operator-step-result",
            name: `step-${step.id}.json`,
            mediaType: "application/json",
            body: JSON.stringify(result),
            ...(metadata === null ? {} : {metadata}),
        })
        const succeeded = this.#store.transitionStep(step.id, "succeeded", {
            outputArtifactIds: [artifact.id],
        })
        return this.#succeededResult(succeeded, {result})
    }

    #succeededResult(step, {result = undefined, cached = false} = {}) {
        const restored = result === undefined ? this.#readStepResult(step) : cloneJson(result)
        return {
            status: "succeeded",
            jobId: step.jobId,
            stepId: step.id,
            result: restored,
            cached,
        }
    }

    #failedResult(step) {
        return {
            status: "failed",
            jobId: step.jobId,
            stepId: step.id,
            error: cloneJson(step.error),
        }
    }

    #readStepResult(step) {
        if (step.outputArtifactIds.length !== 1) throw new Error("Operator Step result artifact is missing")
        const body = this.#store.readArtifactBody(step.outputArtifactIds[0])
        return JSON.parse(body.toString("utf8"))
    }

    async #boundedAwait(invoke, {
        signal = null,
        label,
        timeoutMs = this.#externalAwaitTimeoutMs,
        timeoutError = Object.assign(new Error(`${label} timed out`), {code: "OPERATOR_EXTERNAL_TIMEOUT"}),
    }) {
        if (typeof invoke !== "function") throw new Error(`${label} hook must be a function`)
        if (signal?.aborted) throw signal.reason ?? operatorCancellationError()
        const controller = new AbortController()
        const abortChild = () => controller.abort(signal?.reason ?? operatorCancellationError())
        signal?.addEventListener("abort", abortChild, {once: true})
        let rejectAbort
        const abortPromise = new Promise((_resolve, reject) => { rejectAbort = reject })
        const onAbort = () => rejectAbort(controller.signal.reason ?? operatorCancellationError())
        controller.signal.addEventListener("abort", onAbort, {once: true})
        const cancelTimeout = segmentedTimeout(() => {
            controller.abort(timeoutError)
        }, timeoutMs)
        try {
            if (controller.signal.aborted) throw controller.signal.reason ?? operatorCancellationError()
            const value = invoke(controller.signal)
            return await Promise.race([Promise.resolve(value), abortPromise])
        } finally {
            cancelTimeout()
            signal?.removeEventListener("abort", abortChild)
            controller.signal.removeEventListener("abort", onAbort)
        }
    }

    async #telemetry(request, signal) {
        const value = typeof this.#runtimeTelemetry === "function"
            ? await this.#boundedAwait(
                (hookSignal) => this.#runtimeTelemetry({
                    method: request.method,
                    params: cloneJson(request.params),
                    signal: hookSignal,
                }),
                {signal, label: "Operator Runtime telemetry"},
            )
            : this.#runtimeTelemetry
        return normalizeTelemetry(value)
    }

    #budgetUsage(jobId) {
        const usage = Object.fromEntries(RESERVATION_FIELDS.map((field) => [field, 0]))
        for (const event of this.#store.listEvents(jobId)) {
            if (event.kind !== "operator_budget_reserved") continue
            for (const field of RESERVATION_FIELDS) {
                const amount = event.usage?.[field] ?? 0
                const valid = field === "reportedCost"
                    ? Number.isFinite(amount) && amount >= 0
                    : Number.isSafeInteger(amount) && amount >= 0
                if (!valid) {
                    throw new Error("Persisted Operator budget reservation is invalid")
                }
                usage[field] += amount
            }
        }
        return usage
    }

    #budgetLimits(job, stepId = null) {
        const limits = {...job.budget}
        if (stepId === null) return limits
        for (const approval of this.#store.listApprovals(job.id)) {
            if (approval.stepId !== stepId || approval.status !== "approved" ||
                approval.action !== "budget.expand" || approval.risk !== "budget_expansion") {
                continue
            }
            const expansion = isPlainObject(approval.scope?.budget) ? approval.scope.budget : {}
            for (const field of Object.keys(expansion)) {
                if (!BUDGET_FIELDS.includes(field)) throw new Error("Operator budget expansion scope is invalid")
            }
            for (const field of BUDGET_FIELDS) {
                const value = expansion[field]
                if (value === undefined) continue
                const valid = field === "maxReportedCost"
                    ? Number.isFinite(value) && value >= 0
                    : Number.isSafeInteger(value) && value >= 0
                if (!valid || limits[field] === null || value < limits[field]) {
                    throw new Error("Operator budget expansion scope is invalid")
                }
                limits[field] = value
            }
        }
        return limits
    }

    #budgetAssessment(job, reservation, telemetry, runtimeIds = [], limits = job.budget) {
        const preflight = preflightOperatorBudget(
            limits,
            telemetry,
            runtimeIds.length > 0 ? runtimeIds : null,
        )
        const usage = this.#budgetUsage(job.id)
        const overages = []
        if (this.#now() - Date.parse(job.createdAt) > limits.maxDurationMs) {
            overages.push("maxDurationMs")
        }
        for (const [usageField, budgetField] of Object.entries(RESERVATION_LIMITS)) {
            const limit = limits[budgetField]
            if (limit === null) continue
            const exceeds = usageField === "reportedCost"
                ? costUnits(usage[usageField]) + costUnits(reservation[usageField] ?? 0) > costUnits(limit)
                : usage[usageField] + (reservation[usageField] ?? 0) > limit
            if (exceeds) overages.push(budgetField)
        }
        return {preflight, usage, overages}
    }

    #reserveBudget(job, step, request, telemetry) {
        const {reservation} = request
        if (this.#store.listEvents(job.id).some((event) => (
            event.kind === "operator_budget_reserved" && event.stepId === step.id
        ))) return
        const assessment = this.#budgetAssessment(
            job,
            reservation,
            telemetry,
            involvedRuntimeIds(request.params),
            this.#budgetLimits(job, step.id),
        )
        if (!assessment.preflight.valid) {
            throw Object.assign(new Error("Operator token or cost telemetry is unsupported"), {
                code: "BUDGET_TELEMETRY_UNSUPPORTED",
            })
        }
        if (assessment.overages.length > 0) {
            throw Object.assign(new Error("Operator Job budget would be exceeded"), {
                code: "BUDGET_EXCEEDED",
            })
        }
        if (Object.keys(reservation).length > 0) {
            this.#store.appendEvent(job.id, {
                kind: "operator_budget_reserved",
                stepId: step.id,
                usage: cloneJson(reservation),
            })
        }
    }

    #requestedBudgetScope(job, reservation, limits = job.budget) {
        const requested = {}
        const usage = this.#budgetUsage(job.id)
        const elapsed = Math.max(0, this.#now() - Date.parse(job.createdAt))
        if (elapsed > limits.maxDurationMs) requested.maxDurationMs = elapsed + job.budget.maxDurationMs
        for (const [usageField, budgetField] of Object.entries(RESERVATION_LIMITS)) {
            const required = usageField === "reportedCost"
                ? (costUnits(usage[usageField]) + costUnits(reservation[usageField] ?? 0)) / COST_SCALE
                : usage[usageField] + (reservation[usageField] ?? 0)
            const limit = limits[budgetField]
            if (limit !== null && required > limit) requested[budgetField] = required
        }
        return requested
    }

    #stepCreation(step) {
        const event = this.#store.listEvents(step.jobId).find((candidate) => (
            candidate.kind === "operator_step_created" && candidate.stepId === step.id
        ))
        if (!event || !isPlainObject(event.request)) {
            throw new Error("Operator Step frozen request is missing")
        }
        return cloneJson(event)
    }

    #executionFromStep(step) {
        const creation = this.#stepCreation(step)
        const trustedFacts = cloneJson(creation.trustedFacts ?? {})
        const requestedParams = creation.requestedParams ?? creation.request.params
        const params = selectedParamsFromFacts(requestedParams, trustedFacts)
        if (stableJson(params) !== stableJson(creation.request.params)) {
            throw new Error("Frozen Dataset evaluation selection does not match the Step request")
        }
        return {
            method: creation.request.method,
            params,
            reservation: normalizeReservation(creation.request.reservation ?? {}),
            requestedReservation: normalizeReservation(
                creation.requestedReservation ?? creation.request.reservation ?? {},
            ),
            trustedFacts,
            policyApproval: trustedFacts.controlPolicyApproval ?? null,
            idempotencyKey: step.idempotencyKey,
        }
    }

    async cancel(jobId) {
        const job = this.#store.beginCancellation(jobId)
        this.#settleClosedManualApprovals()
        if (TERMINAL_JOB_STATUSES.has(job.status)) return job
        this.#abortTree(jobId)
        const cancelled = this.#store.cancelJobTree(jobId).job
        this.#settleClosedManualApprovals()
        return cancelled
    }

    interrupt(jobId, error = {}) {
        requiredText(jobId, "Operator Job id", 200)
        const record = errorRecord(error, "OPERATOR_RUNTIME_FAILED")
        const interruption = Object.assign(new Error(record.message), {
            code: record.code,
        })
        for (const controller of this.#coordination.operations.get(jobId) ?? []) {
            controller.abort(interruption)
        }
        const steps = this.#store.listSteps({jobId})
        for (const step of steps) {
            this.#activeSteps.get(step.id)?.abort(interruption)
        }
        if (!steps.some((step) => step.status === "running")) {
            return this.#store.getJob(jobId)
        }
        const interrupted = this.#store.interruptJob(jobId, record)
        this.#settleClosedManualApprovals()
        return interrupted
    }

    #abortTree(jobId) {
        const jobs = this.#store.listJobs()
        const byId = new Map(jobs.map((job) => [job.id, job]))
        const stepsByJob = new Map()
        for (const step of this.#store.listSteps()) {
            if (!stepsByJob.has(step.jobId)) stepsByJob.set(step.jobId, [])
            stepsByJob.get(step.jobId).push(step)
        }
        const stack = [jobId]
        while (stack.length > 0) {
            const current = byId.get(stack.pop())
            if (!current) continue
            for (const controller of this.#coordination.operations.get(current.id) ?? []) {
                controller.abort(operatorCancellationError())
            }
            for (const step of stepsByJob.get(current.id) ?? []) {
                this.#activeSteps.get(step.id)?.abort(operatorCancellationError())
            }
            stack.push(...current.children)
        }
    }

    completeJob(jobId, status, patch = {}) {
        if (!TERMINAL_JOB_STATUSES.has(status)) {
            return Promise.reject(new Error("Operator Job completion status is invalid"))
        }
        if (status === "cancelled") return this.cancel(jobId)
        if (status === "failed") {
            const current = this.#store.getJob(jobId)
            if (TERMINAL_JOB_STATUSES.has(current.status)) {
                if (current.status !== status) {
                    return Promise.reject(new Error("Operator Job already completed with another status"))
                }
                return Promise.resolve(current)
            }
            this.#store.beginCancellation(jobId)
            this.#settleClosedManualApprovals()
            this.#abortTree(jobId)
            const failed = this.#store.cancelJobTree(jobId, {
                rootStatus: "failed",
                rootPatch: patch,
            }).job
            this.#settleClosedManualApprovals()
            return Promise.resolve(failed)
        }
        return this.#enqueue(jobId, async () => {
            let job = this.#store.getJob(jobId)
            if (TERMINAL_JOB_STATUSES.has(job.status)) {
                if (job.status !== status) throw new Error("Operator Job already completed with another status")
                return job
            }
            if (status === "succeeded") {
                const children = job.children.map((childId) => this.#store.getJob(childId))
                if (children.some((child) => child.status !== "succeeded")) {
                    throw new Error("Every child Operator Job must succeed before its parent")
                }
                const steps = this.#store.listSteps({jobId})
                if (steps.some((step) => step.status !== "succeeded")) {
                    throw new Error("Every Operator Step must succeed before its Job")
                }
            }
            if (job.status === "queued") job = this.#store.transitionJob(job.id, "running")
            return this.#store.transitionJob(job.id, status, patch)
        })
    }

    reconcile(jobId) {
        return this.#enqueue(jobId, () => this.#withJobOperation(
            jobId,
            (signal) => this.#reconcile(jobId, signal),
        ))
    }

    async #reconcile(jobId, signal) {
        let job = this.#store.getJob(jobId)
        if (job.status !== "needs_recovery" && job.status !== "waiting_approval") {
            return {status: job.status, jobId}
        }
        const recovery = this.#store.listEvents(jobId).findLast((event) => event.kind === "recovery_required")
        if (recovery?.previousStatus === "cancelling") {
            this.#store.beginCancellation(jobId)
            this.#abortTree(jobId)
            const cancelled = this.#store.cancelJobTree(jobId).job
            return {status: cancelled.status, jobId: cancelled.id}
        }
        const steps = this.#store.listSteps({jobId})
        for (let step of steps) {
            if (TERMINAL_STEP_STATUSES.has(step.status)) continue
            if (step.status === "waiting_approval") {
                const approvals = this.#store.listApprovals(jobId).filter((entry) => (
                    entry.stepId === step.id && entry.status !== "pending"
                ))
                const approval = approvals.findLast((entry) => entry.status === "rejected") ?? approvals.at(-1)
                if (approval) await this.#resumeResolvedApproval(step, approval, signal)
                continue
            }
            if (step.status === "running" || step.status === "pending") {
                step = this.#store.transitionStep(step.id, "needs_recovery", {
                    error: {code: "OPERATOR_INTERRUPTED", message: "Operator Step outcome is unknown after restart"},
                })
            }
            await this.#reconcileStep(job, step, signal)
        }
        const unknown = this.#store.listSteps({jobId}).some((step) => (
            !TERMINAL_STEP_STATUSES.has(step.status) && step.status !== "waiting_approval"
        ))
        job = this.#store.getJob(jobId)
        if (!unknown && job.status === "needs_recovery") {
            job = this.#store.transitionJob(job.id, "running")
        }
        return {status: job.status, jobId: job.id}
    }

    async #reconcileStep(job, step, signal) {
        const priorArtifact = this.#store.read().artifacts.find((artifact) => (
            artifact.jobId === job.id && artifact.kind === "operator-step-result" && artifact.name === `step-${step.id}.json`
        ))
        if (priorArtifact) {
            this.#store.transitionStep(step.id, "succeeded", {outputArtifactIds: [priorArtifact.id]})
            return true
        }
        const execution = this.#executionFromStep(step)
        if (isDeleteMethod(step.method)) return false
        if (isReadMethod(step.method)) {
            const telemetry = isIterationBudget(job.budget) ? [] : await this.#telemetry(execution, signal)
            const result = await this.#runStep(job, step, execution, {telemetry, signal})
            return result.status === "succeeded" || result.status === "failed"
        }
        if (step.method === "evaluations.start") {
            const runId = requiredText(execution.params.runId, "Evaluation recovery run id", 300)
            const outcome = await this.#callReconciler(
                "evaluation",
                {...execution.params, runId, jobId: job.id, stepId: step.id},
                signal,
            )
            if (["succeeded", "completed"].includes(outcome?.status) && outcome.result?.runId === runId) {
                this.#persistStepResult(step, outcome.result)
                return true
            }
            return this.#finishReconcilerFailure(step, outcome)
        }
        if (step.method === "installations.start" || step.method === "skills.install") {
            const installationId = requiredText(
                execution.params.installationId,
                "Installation recovery id",
                300,
            )
            const outcome = await this.#callReconciler("installation", {
                ...execution.params,
                installationId,
                jobId: job.id,
                stepId: step.id,
            }, signal)
            const identityMatches = ["installationId", "runtimeId", "skillId", "versionId"].every((field) => {
                if (!Object.hasOwn(execution.params, field)) return true
                const observations = []
                if (isPlainObject(outcome) && Object.hasOwn(outcome, field)) observations.push(outcome[field])
                if (isPlainObject(outcome?.result) && Object.hasOwn(outcome.result, field)) {
                    observations.push(outcome.result[field])
                }
                return observations.length > 0 && observations.every((observed) => observed === execution.params[field])
            })
            if (["installed", "succeeded"].includes(outcome?.status) && identityMatches) {
                this.#persistStepResult(step, outcome.result ?? {installationId})
                return true
            }
            return this.#finishReconcilerFailure(step, outcome)
        }
        if (step.method === "skills.release") {
            const versionId = requiredText(execution.params.versionId, "Release Candidate id", 300)
            const versionLabel = requiredText(execution.params.versionLabel, "Release tag", 300)
            const outcome = await this.#callReconciler("release", {
                ...execution.params,
                versionId,
                versionLabel,
                jobId: job.id,
                stepId: step.id,
            }, signal)
            if (outcome?.status === "released" && outcome.candidateId === versionId && outcome.tag === versionLabel) {
                this.#persistStepResult(step, outcome.result ?? {versionId, versionLabel})
                return true
            }
            return this.#finishReconcilerFailure(step, outcome)
        }
        return false
    }

    async #callReconciler(kind, input, signal) {
        const reconciler = this.#reconcilers[kind]
        if (typeof reconciler !== "function") return null
        return this.#boundedAwait(
            (hookSignal) => reconciler(cloneJson(input), {signal: hookSignal}),
            {signal, label: `Operator ${kind} reconciliation`},
        )
    }

    #finishReconcilerFailure(step, outcome) {
        if (outcome?.status !== "failed") return false
        this.#store.transitionStep(step.id, "failed", {
            error: cloneJson(outcome.error ?? {
                code: "OPERATOR_RECONCILE_FAILED",
                message: "Operator Step reconciliation failed",
            }),
        })
        return true
    }

    #enqueue(jobId, operation) {
        requiredText(jobId, "Operator Job id", 200)
        const queues = this.#coordination.jobQueues
        const prior = queues.get(jobId) ?? Promise.resolve()
        const queued = prior.then(operation, operation)
        queues.set(jobId, queued)
        return queued.finally(() => {
            if (queues.get(jobId) === queued) queues.delete(jobId)
        })
    }

    async #withJobOperation(jobId, operation) {
        const controller = new AbortController()
        let operations = this.#coordination.operations.get(jobId)
        if (!operations) {
            operations = new Set()
            this.#coordination.operations.set(jobId, operations)
        }
        operations.add(controller)
        try {
            return await operation(controller.signal)
        } catch (error) {
            let job = null
            try {
                job = this.#store.getJob(jobId)
            } catch {}
            if (job?.status === "needs_recovery") {
                const step = this.#store.listSteps({jobId}).at(-1)
                return {status: "needs_recovery", jobId, ...(step ? {stepId: step.id} : {})}
            }
            if (controller.signal.aborted || job?.status === "cancelling" || job?.status === "cancelled") {
                const step = this.#store.listSteps({jobId}).at(-1)
                return {status: "cancelled", jobId, ...(step ? {stepId: step.id} : {})}
            }
            throw error
        } finally {
            operations.delete(controller)
            if (operations.size === 0) this.#coordination.operations.delete(jobId)
        }
    }
}

module.exports = {
    OperatorJobEngine,
    operatorArtifactMetadata,
    preflightOperatorBudget,
}
