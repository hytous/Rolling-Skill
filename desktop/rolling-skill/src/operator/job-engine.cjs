const {
    operatorApprovalRequirement,
    operatorMethodBudgetMinimum,
} = require("../control-plane/policy.cjs")

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

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
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
    return {
        method: requiredText(request.method, "Operator Step method", 300),
        params: cloneJson(requireObject(request.params ?? {}, "Operator Step params"), "Operator Step params"),
        idempotencyKey: requiredText(request.idempotencyKey, "Operator Step idempotency key", 500),
        reservation: normalizeReservation(request.reservation ?? {}),
    }
}

function frozenStepRequest(request) {
    return {
        method: request.method,
        params: cloneJson(request.params),
        reservation: cloneJson(request.reservation),
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

function costUnits(value) {
    return Math.round(value * COST_SCALE)
}

const ACTIVE_STEPS_BY_STORE = new WeakMap()

class OperatorJobEngine {
    #store
    #handlers
    #approvalDecider
    #reconcilers
    #runtimeTelemetry
    #resolveEvaluationCaseCount
    #now
    #approvalTtlMs
    #jobQueues = new Map()
    #activeSteps

    constructor({
        store,
        handlers = {},
        approvalDecider = null,
        reconcilers = {},
        runtimeTelemetry = [],
        resolveEvaluationCaseCount = null,
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
        if (typeof now !== "function" || !Number.isSafeInteger(approvalTtlMs) || approvalTtlMs <= 0) {
            throw new Error("Operator engine clock or approval TTL is invalid")
        }
        this.#store = store
        this.#handlers = {...handlers}
        this.#approvalDecider = approvalDecider
        this.#reconcilers = {...reconcilers}
        this.#runtimeTelemetry = runtimeTelemetry
        this.#resolveEvaluationCaseCount = resolveEvaluationCaseCount
        this.#now = now
        this.#approvalTtlMs = approvalTtlMs
        if (!ACTIVE_STEPS_BY_STORE.has(store)) ACTIVE_STEPS_BY_STORE.set(store, new Map())
        this.#activeSteps = ACTIVE_STEPS_BY_STORE.get(store)
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

    execute(jobId, input = {}) {
        return this.#enqueue(jobId, () => this.#execute(jobId, requestForExecution(input)))
    }

    async #effectiveRequest(request) {
        const minimum = {...operatorMethodBudgetMinimum(request.method)}
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
                caseCount = await this.#resolveEvaluationCaseCount(cloneJson(params))
                if (!Number.isSafeInteger(caseCount) || caseCount <= 0) {
                    throw Object.assign(new Error("Dataset evaluation size is invalid"), {
                        code: "BUDGET_SELECTION_UNRESOLVED",
                    })
                }
            }
            if (caseCount > 0) {
                if (!Array.isArray(params.runtimeConfigurations) || params.runtimeConfigurations.length === 0) {
                    throw Object.assign(new Error("Evaluation Runtime selection is required"), {
                        code: "BUDGET_SELECTION_UNRESOLVED",
                    })
                }
                const executions = safeProduct(
                    caseCount,
                    params.runtimeConfigurations.length,
                    "Operator evaluation execution reservation",
                )
                minimum.targetExecutions = executions
                if (isPlainObject(params.judgeConfiguration)) minimum.judgeExecutions = executions
            }
        }
        const reservation = {...request.reservation}
        for (const [field, amount] of Object.entries(minimum)) {
            reservation[field] = Math.max(reservation[field] ?? 0, amount)
        }
        return {...request, reservation}
    }

    async #execute(jobId, request) {
        request = await this.#effectiveRequest(request)
        let job = this.#store.getJob(jobId)
        const existing = this.#store.listSteps({jobId}).find((step) => (
            step.idempotencyKey === request.idempotencyKey
        ))
        if (existing) return this.#existingResult(existing, request)
        if (job.status === "queued") job = this.#store.transitionJob(job.id, "running")
        if (job.status !== "running") {
            throw new Error(`Operator Job cannot execute a new Step while ${job.status}`)
        }

        const step = this.#store.createStep(job.id, {
            method: request.method,
            params: request.params,
            reservation: request.reservation,
            idempotencyKey: request.idempotencyKey,
        })
        const telemetry = await this.#telemetry(request)
        const policyDecision = await this.#preInvokeDecision(job, step, request, telemetry)
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
        return this.#runStep(job, step, request, {telemetry})
    }

    async #existingResult(step, request) {
        const persisted = this.#stepRequest(step)
        if (stableJson(persisted) !== stableJson(frozenStepRequest(request))) {
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
        if (step.status === "pending") return this.#resumePreInvokeStep(step, request)
        if (step.status === "waiting_approval") {
            const approval = approvals.find((entry) => entry.status === "pending")
            if (approval) {
                return {
                    status: "waiting_approval",
                    approvalId: approval.id,
                    jobId: step.jobId,
                    stepId: step.id,
                }
            }
            if (resolvedApproval) return this.#resumeResolvedApproval(step, resolvedApproval)
            return this.#resumePreInvokeStep(step, request)
        }
        return {status: "needs_recovery", jobId: step.jobId, stepId: step.id}
    }

    async #resumePreInvokeStep(step, request) {
        request = await this.#effectiveRequest(request)
        let job = this.#store.getJob(step.jobId)
        if (job.status === "needs_recovery") job = this.#store.transitionJob(job.id, "running")
        if (job.status !== "running" && job.status !== "waiting_approval") {
            return {status: "needs_recovery", jobId: step.jobId, stepId: step.id}
        }
        const telemetry = await this.#telemetry(request)
        const decision = await this.#preInvokeDecision(job, step, request, telemetry)
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
        return this.#runStep(job, step, request, {telemetry})
    }

    async #resumeResolvedApproval(step, approval) {
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
        const request = requestForExecution(approval.proposedMutation)
        const result = await this.#resumePreInvokeStep(step, request)
        this.#restoreJobAfterRecovery(step.jobId)
        return result
    }

    #restoreJobAfterRecovery(jobId) {
        const job = this.#store.getJob(jobId)
        if (job.status !== "needs_recovery") return job
        const unknown = this.#store.listSteps({jobId}).some((step) => !TERMINAL_STEP_STATUSES.has(step.status))
        return unknown ? job : this.#store.transitionJob(job.id, "running")
    }

    async #customApprovalDecision(request, job) {
        if (this.#approvalDecider) {
            return this.#approvalDecider({
                method: request.method,
                params: cloneJson(request.params),
                job: cloneJson(job),
            })
        }
        return {decision: "allow"}
    }

    #hasApprovedGate(step, decision) {
        return this.#store.listApprovals(step.jobId).some((approval) => (
            approval.stepId === step.id && approval.status === "approved" &&
            approval.action === (decision.action ?? decision.requestedAction ?? step.method) &&
            approval.risk === decision.reason
        ))
    }

    async #preInvokeDecision(job, step, request, telemetry) {
        const custom = requireObject(
            await this.#customApprovalDecision(request, job),
            "Operator approval decision",
        )
        if (custom.decision === "deny") return custom
        const mandatory = operatorApprovalRequirement(request.method, request.params)
        if (mandatory && !this.#hasApprovedGate(step, mandatory)) return mandatory
        if (custom.decision === "approval_required" && !this.#hasApprovedGate(step, custom)) return custom
        if (custom.decision !== "allow" && custom.decision !== "approval_required") {
            throw new Error("Operator approval decision is invalid")
        }
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
            approval.action === (decision.action ?? request.method) && approval.risk === decision.reason
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
        return this.#enqueue(approval.jobId, () => this.#resolveApproval(approvalId, input))
    }

    async #resolveApproval(approvalId, input = {}, errorOverride = null) {
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
        if (decision.decision === "reject") {
            const error = errorOverride ?? {
                code: "APPROVAL_REJECTED",
                message: "Operator approval was rejected",
            }
            const failed = this.#store.transitionStep(step.id, "failed", {error})
            return this.#failedResult(failed)
        }
        const request = requestForExecution(resolved.proposedMutation)
        return this.#resumePreInvokeStep(step, request)
    }

    async expireApprovals(jobId = null) {
        const jobs = jobId === null ? this.#store.listJobs() : [this.#store.getJob(jobId)]
        const expired = []
        for (const job of jobs) {
            const approvals = this.#store.listApprovals(job.id).filter((approval) => (
                approval.status === "pending" && Date.parse(approval.expiresAt) <= this.#now()
            ))
            for (const approval of approvals) {
                const result = await this.#enqueue(approval.jobId, () => this.#resolveApproval(
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
                ))
                expired.push({approvalId: approval.id, jobId: approval.jobId, stepId: result.stepId})
            }
        }
        return expired
    }

    async #runStep(job, initialStep, request, {telemetry = []} = {}) {
        let step = this.#store.getStep(initialStep.id)
        try {
            this.#reserveBudget(job, step, request, telemetry)
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
            this.#activeSteps.set(step.id, controller)
            let result
            let timer = null
            let durationExceeded = false
            const timeoutError = Object.assign(new Error("Operator Job duration budget was exceeded"), {
                code: "BUDGET_DURATION_EXCEEDED",
            })
            try {
                const limits = this.#budgetLimits(job, step.id)
                const remainingMs = limits.maxDurationMs - Math.max(0, this.#now() - Date.parse(job.createdAt))
                if (remainingMs <= 0) throw timeoutError
                const handlerPromise = Promise.resolve().then(() => handler({
                    method: request.method,
                    params: cloneJson(request.params),
                    idempotencyKey: request.idempotencyKey,
                    jobId: job.id,
                    stepId: step.id,
                    signal: controller.signal,
                }))
                const timeoutPromise = new Promise((_resolve, reject) => {
                    timer = setTimeout(() => {
                        durationExceeded = true
                        controller.abort(timeoutError)
                        reject(timeoutError)
                    }, remainingMs)
                })
                try {
                    result = await Promise.race([handlerPromise, timeoutPromise])
                } catch (error) {
                    if (durationExceeded) throw timeoutError
                    throw error
                }
            } finally {
                if (timer !== null) clearTimeout(timer)
                this.#activeSteps.delete(step.id)
            }
            const current = this.#store.getStep(step.id)
            if (current.status === "cancelled") {
                return {status: "cancelled", jobId: job.id, stepId: step.id}
            }
            return this.#persistStepResult(current, result ?? null)
        } catch (error) {
            const current = this.#store.getStep(step.id)
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

    #persistStepResult(step, result) {
        const artifact = this.#store.createArtifact(step.jobId, {
            kind: "operator-step-result",
            name: `step-${step.id}.json`,
            mediaType: "application/json",
            body: JSON.stringify(result),
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

    async #telemetry(request) {
        const value = typeof this.#runtimeTelemetry === "function"
            ? await this.#runtimeTelemetry({method: request.method, params: cloneJson(request.params)})
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

    #stepRequest(step) {
        const event = this.#store.listEvents(step.jobId).find((candidate) => (
            candidate.kind === "operator_step_created" && candidate.stepId === step.id
        ))
        if (!event || !isPlainObject(event.request)) {
            throw new Error("Operator Step frozen request is missing")
        }
        return cloneJson(event.request)
    }

    cancel(jobId) {
        const job = this.#store.beginCancellation(jobId)
        if (TERMINAL_JOB_STATUSES.has(job.status)) return Promise.resolve(job)
        this.#abortTree(jobId)
        return this.#enqueue(jobId, () => this.#store.cancelJobTree(jobId).job)
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
            for (const step of stepsByJob.get(current.id) ?? []) {
                this.#activeSteps.get(step.id)?.abort()
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
            this.#abortTree(jobId)
            return this.#enqueue(jobId, () => this.#store.cancelJobTree(jobId, {
                rootStatus: "failed",
                rootPatch: patch,
            }).job)
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
        return this.#enqueue(jobId, () => this.#reconcile(jobId))
    }

    async #reconcile(jobId) {
        let job = this.#store.getJob(jobId)
        if (job.status !== "needs_recovery") return {status: job.status, jobId}
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
                const approval = this.#store.listApprovals(jobId).find((entry) => (
                    entry.stepId === step.id && entry.status !== "pending"
                ))
                if (approval) await this.#resumeResolvedApproval(step, approval)
                continue
            }
            if (step.status === "running" || step.status === "pending") {
                step = this.#store.transitionStep(step.id, "needs_recovery", {
                    error: {code: "OPERATOR_INTERRUPTED", message: "Operator Step outcome is unknown after restart"},
                })
            }
            await this.#reconcileStep(job, step)
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

    async #reconcileStep(job, step) {
        const priorArtifact = this.#store.read().artifacts.find((artifact) => (
            artifact.jobId === job.id && artifact.kind === "operator-step-result" && artifact.name === `step-${step.id}.json`
        ))
        if (priorArtifact) {
            this.#store.transitionStep(step.id, "succeeded", {outputArtifactIds: [priorArtifact.id]})
            return true
        }
        const request = this.#stepRequest(step)
        const execution = {
            method: request.method,
            params: request.params,
            reservation: request.reservation ?? {},
            idempotencyKey: step.idempotencyKey,
        }
        if (isDeleteMethod(step.method)) return false
        if (isReadMethod(step.method)) {
            const telemetry = await this.#telemetry(execution)
            const result = await this.#runStep(job, step, execution, {telemetry})
            return result.status === "succeeded" || result.status === "failed"
        }
        if (step.method === "evaluations.start") {
            const runId = requiredText(execution.params.runId, "Evaluation recovery run id", 300)
            const outcome = await this.#callReconciler("evaluation", {...execution.params, runId, jobId: job.id, stepId: step.id})
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
            })
            const identityMatches = ["installationId", "runtimeId", "skillId", "versionId"].every((field) => {
                if (!Object.hasOwn(execution.params, field)) return true
                const observed = outcome?.[field] ?? outcome?.result?.[field]
                return observed === execution.params[field]
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
            })
            if (outcome?.status === "released" && outcome.candidateId === versionId && outcome.tag === versionLabel) {
                this.#persistStepResult(step, outcome.result ?? {versionId, versionLabel})
                return true
            }
            return this.#finishReconcilerFailure(step, outcome)
        }
        return false
    }

    async #callReconciler(kind, input) {
        const reconciler = this.#reconcilers[kind]
        if (typeof reconciler !== "function") return null
        return reconciler(cloneJson(input))
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
        const prior = this.#jobQueues.get(jobId) ?? Promise.resolve()
        const queued = prior.then(operation, operation)
        this.#jobQueues.set(jobId, queued)
        return queued.finally(() => {
            if (this.#jobQueues.get(jobId) === queued) this.#jobQueues.delete(jobId)
        })
    }
}

module.exports = {
    OperatorJobEngine,
    preflightOperatorBudget,
}
