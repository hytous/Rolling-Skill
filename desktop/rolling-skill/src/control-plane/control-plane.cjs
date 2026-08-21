const {createHash} = require("node:crypto")

const {
    CONTROL_METHODS,
    PUBLIC_CONTROL_ERROR_CODES,
    controlDefinition,
    createPublicControlError,
    parseControlInput,
    parseControlOutput,
    publicControlError,
} = require("./contracts.cjs")
const {createBudgetSnapshot, createResolvedScope} = require("./policy.cjs")

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000
const DEFAULT_IDEMPOTENCY_LIMIT = 1_000
const MAX_BUDGET_CAS_ATTEMPTS = 4
const stateByControlPlane = new WeakMap()

const SAFE_CONTROL_MESSAGES = Object.freeze({
    CONTROL_ERROR: "Control operation failed",
})

const CAPABILITY_PUBLIC_CODES = new Set([
    "CAPABILITY_INVALID",
    "CAPABILITY_REVOKED",
    "CAPABILITY_EXPIRED",
    "CAPABILITY_SESSION_MISMATCH",
    "CAPABILITY_ACTION_NOT_GRANTED",
])
const PUBLIC_CONTROL_ERROR_CODE_SET = new Set(PUBLIC_CONTROL_ERROR_CODES)

function stableError(code) {
    const error = new Error(SAFE_CONTROL_MESSAGES[code] ?? SAFE_CONTROL_MESSAGES.CONTROL_ERROR)
    error.code = code
    error.retryable = false
    error.details = null
    return error
}

function invalidEnvelope(method, path) {
    return createPublicControlError("INVALID_ARGUMENT", {
        details: {method, issues: [{path: [path]}]},
        internalMessage: "Invalid control invocation envelope",
    })
}

function decisionError(decision, action) {
    if (decision?.decision === "approval_required") {
        return createPublicControlError("APPROVAL_REQUIRED", {
            details: {action, reason: decision.reason},
        })
    }
    const error = createPublicControlError("FORBIDDEN", {details: {action}})
    error.decision = "deny"
    if (typeof decision?.code === "string") error.decisionCode = decision.code
    return error
}

function ownDataValue(value, key) {
    try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined
    } catch {
        return undefined
    }
}

function safeControlError(error, method) {
    if (publicControlError(error).code !== "CONTROL_ERROR") return error
    const code = (typeof error === "object" && error !== null) || typeof error === "function"
        ? ownDataValue(error, "code")
        : undefined
    if (code === "INVALID_ARGUMENT") {
        return createPublicControlError("INVALID_ARGUMENT", {
            details: {method, issues: [{path: []}]},
            internalMessage: "Invalid domain service input",
        })
    }
    if (CAPABILITY_PUBLIC_CODES.has(code)) return createPublicControlError(code)
    return stableError("CONTROL_ERROR")
}

function terminalErrorSnapshot(error) {
    const published = publicControlError(error)
    return immutableSnapshot(published)
}

function terminalError(snapshot) {
    if (snapshot.code === "CONTROL_ERROR") return stableError("CONTROL_ERROR")
    if (!PUBLIC_CONTROL_ERROR_CODE_SET.has(snapshot.code)) return stableError("CONTROL_ERROR")
    return createPublicControlError(snapshot.code, {details: snapshot.details})
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue)
    if (value && typeof value === "object") {
        const result = {}
        for (const key of Object.keys(value).sort()) {
            if (value[key] !== undefined) result[key] = canonicalValue(value[key])
        }
        return result
    }
    return value
}

function canonicalDigest(value) {
    return createHash("sha256")
        .update(JSON.stringify(canonicalValue(value)), "utf8")
        .digest("hex")
}

function immutableSnapshot(value) {
    const snapshot = JSON.parse(JSON.stringify(value))
    const freeze = (candidate) => {
        if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) {
            return candidate
        }
        for (const child of Object.values(candidate)) freeze(child)
        return Object.freeze(candidate)
    }
    return freeze(snapshot)
}

function replayCopy(value) {
    return structuredClone(value)
}

class IdempotencyCache {
    constructor({clock, limit, ttlMs}) {
        this.clock = clock
        this.limit = limit
        this.ttlMs = ttlMs
        this.entries = new Map()
    }

    sweep(now) {
        for (const [key, entry] of this.entries) {
            if (entry.state === "terminal" && entry.expiresAt <= now) this.entries.delete(key)
        }
    }

    makeRoom() {
        if (this.entries.size < this.limit) return
        let oldest = null
        for (const [key, entry] of this.entries) {
            if (entry.state !== "terminal") continue
            if (oldest === null || entry.completedAt < oldest.entry.completedAt) {
                oldest = {key, entry}
            }
        }
        if (oldest !== null) this.entries.delete(oldest.key)
        if (this.entries.size >= this.limit) {
            throw createPublicControlError("IDEMPOTENCY_CAPACITY")
        }
    }

    prepare(capabilityId, method, input) {
        const idempotencyKey = input?.idempotencyKey
        if (typeof idempotencyKey !== "string") return {kind: "none"}
        const now = this.clock()
        this.sweep(now)
        const key = `${capabilityId}\u0000${method}\u0000${idempotencyKey}`
        const inputDigest = canonicalDigest(input)
        const existing = this.entries.get(key)
        if (existing) {
            if (existing.inputDigest !== inputDigest) {
                throw createPublicControlError("IDEMPOTENCY_CONFLICT", {
                    details: {method},
                })
            }
            if (existing.state === "terminal") {
                if (existing.terminalKind === "error") {
                    return {kind: "error", error: terminalError(existing.error)}
                }
                return {kind: "replay", result: replayCopy(existing.result)}
            }
            return {
                kind: "pending",
                result: new Promise((resolve, reject) => existing.waiters.push({resolve, reject})),
            }
        }
        this.makeRoom()
        const entry = {
            key,
            inputDigest,
            state: "pending",
            waiters: [],
        }
        this.entries.set(key, entry)
        return {kind: "owner", entry}
    }

    complete(entry, value) {
        if (!entry || this.entries.get(entry.key) !== entry) return replayCopy(value)
        const result = immutableSnapshot(value)
        const completedAt = this.clock()
        entry.state = "terminal"
        entry.terminalKind = "result"
        entry.result = result
        entry.resultDigest = canonicalDigest(result)
        entry.completedAt = completedAt
        entry.expiresAt = completedAt + this.ttlMs
        const waiters = entry.waiters.splice(0)
        for (const waiter of waiters) waiter.resolve(replayCopy(result))
        return replayCopy(result)
    }

    completeError(entry, error) {
        if (!entry || this.entries.get(entry.key) !== entry) return
        const snapshot = terminalErrorSnapshot(error)
        const completedAt = this.clock()
        entry.state = "terminal"
        entry.terminalKind = "error"
        entry.error = snapshot
        entry.resultDigest = canonicalDigest(snapshot)
        entry.completedAt = completedAt
        entry.expiresAt = completedAt + this.ttlMs
        const waiters = entry.waiters.splice(0)
        for (const waiter of waiters) waiter.reject(terminalError(snapshot))
    }

    fail(entry, error) {
        if (!entry || this.entries.get(entry.key) !== entry) return
        this.entries.delete(entry.key)
        for (const waiter of entry.waiters.splice(0)) waiter.reject(error)
    }
}

class BudgetLedger {
    constructor() {
        this.records = new Map()
    }

    key(capabilityId, sessionId) {
        return `${capabilityId}\u0000${sessionId}`
    }

    read(grant) {
        const key = this.key(grant.id, grant.sessionId)
        const current = this.records.get(key) ?? {
            usage: {runtimeTurns: 0, evaluations: 0},
            revision: 0,
        }
        return {
            usage: {
                runtimeTurns: current.usage.runtimeTurns,
                evaluations: current.usage.evaluations,
            },
            revision: current.revision,
        }
    }

    commit(reservation, grant) {
        if (
            reservation?.capabilityId !== grant.id ||
            reservation?.sessionId !== grant.sessionId ||
            reservation?.amount !== 1 ||
            !["runtimeTurns", "evaluations"].includes(reservation?.usageKey) ||
            !["maxRuntimeTurns", "maxEvaluations"].includes(reservation?.budgetKey) ||
            (reservation.usageKey === "runtimeTurns" &&
                reservation.budgetKey !== "maxRuntimeTurns") ||
            (reservation.usageKey === "evaluations" &&
                reservation.budgetKey !== "maxEvaluations") ||
            !Number.isSafeInteger(reservation.expectedUsed) ||
            reservation.expectedUsed < 0 ||
            !Number.isSafeInteger(reservation.expectedRevision) ||
            reservation.expectedRevision < 0 ||
            !Number.isSafeInteger(reservation.limit) ||
            reservation.limit < 0
        ) return false
        const key = this.key(reservation.capabilityId, reservation.sessionId)
        const current = this.records.get(key) ?? {
            usage: {runtimeTurns: 0, evaluations: 0},
            revision: 0,
        }
        if (
            current.revision !== reservation.expectedRevision ||
            current.usage[reservation.usageKey] !== reservation.expectedUsed
        ) return false
        const nextUsed = reservation.expectedUsed + reservation.amount
        const nextRevision = reservation.expectedRevision + 1
        if (
            !Number.isSafeInteger(nextUsed) ||
            !Number.isSafeInteger(nextRevision) ||
            nextUsed > reservation.limit
        ) return false
        this.records.set(key, {
            usage: {
                runtimeTurns: reservation.usageKey === "runtimeTurns"
                    ? nextUsed
                    : current.usage.runtimeTurns,
                evaluations: reservation.usageKey === "evaluations"
                    ? nextUsed
                    : current.usage.evaluations,
            },
            revision: nextRevision,
        })
        return true
    }
}

function boundedAuditId(value) {
    if (typeof value !== "string" || value.length === 0) return null
    if (value.length <= 200 && !/[\\/\u0000-\u001f\u007f]/u.test(value)) return value
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`
}

function auditObjectIds(input, resolution) {
    const candidates = {
        rawCaseIds: [input?.id],
        datasetIds: [input?.datasetId, ...(resolution?.datasetIds ?? [])],
        caseIds: Array.isArray(input?.caseIds) ? input.caseIds : [],
        runIds: [input?.runId],
        skillIds: [input?.skillId, ...(resolution?.skillIds ?? [])],
        runtimeIds: [
            input?.runtimeId,
            input?.runtime?.runtimeId,
            ...(Array.isArray(input?.runtimeConfigurations)
                ? input.runtimeConfigurations.map((entry) => entry?.runtimeId)
                : []),
            input?.judgeConfiguration?.runtimeId,
            ...(resolution?.runtimeIds ?? []),
        ],
    }
    const result = {}
    for (const [key, values] of Object.entries(candidates)) {
        const normalized = [...new Set(values.map(boundedAuditId).filter(Boolean))].slice(0, 20)
        if (normalized.length > 0) result[key] = normalized
    }
    return result
}

function boundedAuditMethod(value) {
    if (
        typeof value === "string" &&
        value.length <= 200 &&
        /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/u.test(value)
    ) return value
    const source = typeof value === "string" ? value : String(value)
    return `sha256:${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 24)}`
}

function snapshotControlRequest(value) {
    try {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new TypeError("Invalid control invocation envelope")
        }
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError("Invalid control invocation envelope")
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const snapshot = {}
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (typeof key !== "string" || !Object.hasOwn(descriptor, "value")) {
                throw new TypeError("Invalid control invocation envelope")
            }
            if (["method", "params", "sessionId", "token"].includes(key)) {
                snapshot[key] = descriptor.value
            }
        }
        return snapshot
    } catch {
        throw new TypeError("Invalid control invocation envelope")
    }
}

function auditFailure(state) {
    try {
        state.onAuditError?.(Object.freeze({code: "AUDIT_SINK_FAILED"}))
    } catch {}
}

function writeAudit(state, event) {
    if (!state.auditSink) return
    const frozen = immutableSnapshot(event)
    try {
        const operation = typeof state.auditSink === "function"
            ? state.auditSink(frozen)
            : state.auditSink.record(frozen)
        if (operation && typeof operation.then === "function") {
            operation.catch(() => auditFailure(state))
        }
    } catch {
        auditFailure(state)
    }
}

function trustedResolution(services, method, input, grant) {
    return typeof services.resolveScope === "function"
        ? services.resolveScope(method, input, grant)
        : null
}

function validateConstructor({services, capabilities, policy}) {
    if (!services || typeof services !== "object") throw new TypeError("Control services are required")
    for (const method of CONTROL_METHODS) {
        if (typeof services[method] !== "function") {
            throw new TypeError(`Control service is missing: ${method}`)
        }
    }
    if (typeof capabilities?.authorize !== "function") {
        throw new TypeError("Capability store is required")
    }
    if (typeof policy?.decide !== "function") throw new TypeError("Control policy is required")
}

class ControlPlane {
    constructor(options = {}) {
        const capabilities = options.capabilities ?? options.capabilityStore
        validateConstructor({services: options.services, capabilities, policy: options.policy})
        const clock = typeof options.clock === "function" ? options.clock : Date.now
        const idempotencyLimit = Number.isSafeInteger(options.idempotencyLimit) &&
            options.idempotencyLimit > 0
            ? options.idempotencyLimit
            : DEFAULT_IDEMPOTENCY_LIMIT
        stateByControlPlane.set(this, {
            services: options.services,
            capabilities,
            policy: options.policy,
            clock,
            budgetLedger: new BudgetLedger(),
            idempotency: new IdempotencyCache({
                clock,
                limit: idempotencyLimit,
                ttlMs: IDEMPOTENCY_TTL_MS,
            }),
            auditSink: options.auditSink ?? null,
            onAuditError: typeof options.onAuditError === "function" ? options.onAuditError : null,
        })
        Object.freeze(this)
    }

    async invoke(request = {}) {
        const state = stateByControlPlane.get(this)
        const startedAt = state.clock()
        let method = boundedAuditMethod(undefined)
        let envelope = null
        let input = null
        let grant = null
        let resolution = null
        let outcome = "error"
        let errorCode = null
        let idempotencyOwner = null
        let executionStarted = false
        try {
            envelope = snapshotControlRequest(request)
            method = boundedAuditMethod(envelope.method)
            const definition = controlDefinition(envelope.method)
            method = envelope.method
            input = parseControlInput(method, envelope.params)
            if (identifier(envelope.sessionId) === null) throw invalidEnvelope(method, "sessionId")
            grant = state.capabilities.authorize(
                envelope.token,
                definition.action,
                envelope.sessionId,
            )

            const idempotency = state.idempotency.prepare(grant.id, method, input)
            if (idempotency.kind === "replay") {
                outcome = "success"
                return parseControlOutput(method, idempotency.result)
            }
            if (idempotency.kind === "pending") {
                const repeated = await idempotency.result
                outcome = "success"
                return parseControlOutput(method, repeated)
            }
            if (idempotency.kind === "error") throw idempotency.error
            if (idempotency.kind === "owner") idempotencyOwner = idempotency.entry

            const source = await trustedResolution(state.services, method, input, grant)
            if (source !== null && source !== undefined) {
                resolution = source
            }
            const resolvedScope = resolution === null ? undefined : createResolvedScope(resolution)

            let decision = null
            for (let attempt = 0; attempt < MAX_BUDGET_CAS_ATTEMPTS; attempt += 1) {
                let budgetSnapshot
                if (
                    definition.action === "runtime.execute" ||
                    definition.action === "evaluations.execute"
                ) {
                    const budget = state.budgetLedger.read(grant)
                    budgetSnapshot = createBudgetSnapshot({
                        capabilityId: grant.id,
                        sessionId: grant.sessionId,
                        usage: budget.usage,
                        revision: budget.revision,
                    })
                }
                decision = state.policy.decide({
                    grant,
                    method,
                    action: definition.action,
                    input,
                    resolvedScope,
                    budgetSnapshot,
                })
                if (!decision || typeof decision.then === "function") {
                    throw new Error("Control policy must return a synchronous decision")
                }
                if (decision.decision !== "allow") throw decisionError(decision, definition.action)
                if (decision.reservation === null) break
                if (state.budgetLedger.commit(decision.reservation, grant)) break
                decision = null
            }
            if (decision === null) throw createPublicControlError("CONTROL_BUSY")

            const context = Object.freeze({
                capabilityId: grant.id,
                sessionId: grant.sessionId,
                grant,
                scopeFilter: decision.scopeFilter ?? null,
            })
            executionStarted = true
            const rawResult = await state.services[method](input, context)
            const parsed = parseControlOutput(method, rawResult)
            const result = idempotencyOwner
                ? state.idempotency.complete(idempotencyOwner, parsed)
                : parsed
            idempotencyOwner = null
            outcome = "success"
            return result
        } catch (error) {
            const safe = safeControlError(error, method)
            if (idempotencyOwner) {
                if (executionStarted) state.idempotency.completeError(idempotencyOwner, safe)
                else state.idempotency.fail(idempotencyOwner, safe)
                idempotencyOwner = null
            }
            errorCode = safe.code ?? "CONTROL_ERROR"
            throw safe
        } finally {
            const finishedAt = state.clock()
            const durationMs = Number.isFinite(finishedAt - startedAt)
                ? Math.max(0, Math.trunc(finishedAt - startedAt))
                : 0
            writeAudit(state, {
                capabilityId: grant?.id ?? null,
                sessionId: boundedAuditId(grant?.sessionId ?? envelope?.sessionId),
                method,
                objectIds: auditObjectIds(input, resolution),
                durationMs,
                outcome,
                errorCode,
            })
        }
    }
}

function identifier(value) {
    return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 200 &&
        value.trim() === value &&
        /\S/u.test(value) &&
        !/[\u0000-\u001f\u007f]/u.test(value)
        ? value
        : null
}

module.exports = {
    ControlPlane,
    DEFAULT_IDEMPOTENCY_LIMIT,
    IDEMPOTENCY_TTL_MS,
}
