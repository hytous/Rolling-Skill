const {createHash, randomUUID} = require("node:crypto")
const {isAbsolute, resolve} = require("node:path")

const intrinsicPromiseResolve = Promise.resolve.bind(Promise)
const intrinsicPromiseThen = Promise.prototype.then

const {
    CapabilityError,
    capabilityScopeLimit,
    isTrustedHumanCapability,
} = require("./capability-store.cjs")
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
const MAX_OPERATOR_EXECUTOR_RECORDS = 1_024
const OPERATOR_EXECUTOR_TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1_000
const stateByControlPlane = new WeakMap()
const serviceDiagnosticStates = new WeakMap()
const operatorExecutorLeaseStates = new WeakMap()

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

function safeControlError(error) {
    try {
        if (publicControlError(error).code !== "CONTROL_ERROR") return error
    } catch {}
    return stableError("CONTROL_ERROR")
}

function authorizationError(error) {
    let capabilityError = false
    try {
        capabilityError = error instanceof CapabilityError
    } catch {
        return stableError("CONTROL_ERROR")
    }
    if (!capabilityError) return stableError("CONTROL_ERROR")
    let code
    try {
        code = error.code
    } catch {
        return stableError("CONTROL_ERROR")
    }
    return CAPABILITY_PUBLIC_CODES.has(code)
        ? createPublicControlError(code)
        : stableError("CONTROL_ERROR")
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

function createServiceErrorDiagnosticChannel({maxMessageLength = 1_000} = {}) {
    if (
        !Number.isSafeInteger(maxMessageLength) ||
        maxMessageLength < 1 ||
        maxMessageLength > 4_096
    ) throw new TypeError("Service diagnostic message limit is invalid")
    const diagnostics = new WeakMap()
    const channel = Object.freeze({
        capture(publicError, serviceError) {
            if (!publicError || (typeof publicError !== "object" && typeof publicError !== "function")) {
                return
            }
            let message = ""
            try {
                message = typeof serviceError?.message === "string"
                    ? serviceError.message
                    : String(serviceError ?? "")
            } catch {}
            message = message.slice(0, maxMessageLength)
            if (message) diagnostics.set(publicError, Object.freeze({message}))
        },
        consume(publicError) {
            if (!publicError || (typeof publicError !== "object" && typeof publicError !== "function")) {
                return null
            }
            const diagnostic = diagnostics.get(publicError) ?? null
            diagnostics.delete(publicError)
            return diagnostic
        },
    })
    serviceDiagnosticStates.set(channel, true)
    return channel
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
        throw createPublicControlError("IDEMPOTENCY_CAPACITY")
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

function containsAuditSecret(value, bearerSecret) {
    return typeof value === "string" &&
        typeof bearerSecret === "string" &&
        bearerSecret.length > 0 &&
        value.includes(bearerSecret)
}

function boundedAuditId(value, bearerSecret = null) {
    if (typeof value !== "string" || value.length === 0) return null
    if (containsAuditSecret(value, bearerSecret)) return "[redacted]"
    if (value.length <= 200 && !/[\\/\u0000-\u001f\u007f]/u.test(value)) return value
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24)}`
}

function auditObjectIds(input, resolvedScope, bearerSecret) {
    const candidates = {
        rawCaseIds: [input?.id],
        datasetIds: [input?.datasetId, ...(resolvedScope?.datasetIds ?? [])],
        caseIds: Array.isArray(input?.caseIds) ? input.caseIds : [],
        runIds: [input?.runId],
        skillIds: [input?.skillId, ...(resolvedScope?.skillIds ?? [])],
        runtimeIds: [
            input?.runtimeId,
            input?.runtime?.runtimeId,
            ...(Array.isArray(input?.runtimeConfigurations)
                ? input.runtimeConfigurations.map((entry) => entry?.runtimeId)
                : []),
            input?.judgeConfiguration?.runtimeId,
            ...(resolvedScope?.runtimeIds ?? []),
        ],
    }
    const result = {}
    for (const [key, values] of Object.entries(candidates)) {
        const normalized = [...new Set(values
            .map((value) => boundedAuditId(value, bearerSecret))
            .filter(Boolean))].slice(0, 20)
        if (normalized.length > 0) result[key] = normalized
    }
    return result
}

function boundedAuditMethod(value, bearerSecret = null) {
    if (containsAuditSecret(value, bearerSecret)) return "[redacted]"
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

function observeWithoutThrow(value, onRejected = null) {
    const reject = () => {
        if (onRejected === null) return
        try {
            onRejected()
        } catch {}
    }
    try {
        intrinsicPromiseThen.call(value, undefined, reject)
        return
    } catch (error) {
        if (!(error instanceof TypeError)) {
            reject()
            return
        }
    }
    let assimilated
    try {
        assimilated = intrinsicPromiseResolve(value)
    } catch {
        reject()
        return
    }
    try {
        intrinsicPromiseThen.call(assimilated, undefined, reject)
    } catch {
        reject()
    }
}

function auditFailure(state) {
    let diagnostic
    try {
        diagnostic = state.onAuditError?.(Object.freeze({code: "AUDIT_SINK_FAILED"}))
    } catch {
        return
    }
    observeWithoutThrow(diagnostic)
}

function sanitizeAuditValue(value, bearerSecret) {
    if (typeof value === "string") {
        return containsAuditSecret(value, bearerSecret) ? "[redacted]" : value
    }
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeAuditValue(entry, bearerSecret))
    }
    if (value && typeof value === "object") {
        const sanitized = {}
        for (const [key, entry] of Object.entries(value)) {
            sanitized[key] = sanitizeAuditValue(entry, bearerSecret)
        }
        return sanitized
    }
    return value
}

function writeAudit(state, event, bearerSecret) {
    if (!state.auditSink) return
    let operation
    try {
        const frozen = immutableSnapshot(sanitizeAuditValue(event, bearerSecret))
        operation = typeof state.auditSink === "function"
            ? state.auditSink(frozen)
            : state.auditSink.record(frozen)
    } catch {
        auditFailure(state)
        return
    }
    observeWithoutThrow(operation, () => auditFailure(state))
}

function auditTimestamp(state) {
    try {
        const value = state.clock()
        return Number.isFinite(value) ? value : null
    } catch {
        return null
    }
}

function finalizeAudit(state, {
    bearerSecret,
    capabilityId,
    errorCode,
    input,
    method,
    outcome,
    resolvedScope,
    sessionId,
    startedAt,
}) {
    if (!state.auditSink) return
    try {
        const finishedAt = auditTimestamp(state)
        if (finishedAt === null || startedAt === null) {
            auditFailure(state)
            return
        }
        const elapsed = finishedAt - startedAt
        const durationMs = Number.isFinite(elapsed) ? Math.max(0, Math.trunc(elapsed)) : 0
        writeAudit(state, {
            capabilityId,
            sessionId,
            method,
            objectIds: auditObjectIds(input, resolvedScope, bearerSecret),
            durationMs,
            outcome,
            errorCode,
        }, bearerSecret)
    } catch {
        auditFailure(state)
    }
}

function trustedResolution(services, method, input, grant) {
    return typeof services.resolveScope === "function"
        ? services.resolveScope(method, input, grant)
        : null
}

async function trustedFactsResolution(services, method, input, context) {
    if (typeof services.resolveTrustedFacts !== "function") return null
    const facts = await services.resolveTrustedFacts({method, params: input, controlContext: context})
    if (facts === null || facts === undefined) return null
    const snapshot = immutableSnapshot(facts)
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error("Control trusted facts must be a plain object")
    }
    return snapshot
}

function operatorExecutorInput(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Operator executor registration is invalid")
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError("Operator executor registration is invalid")
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const allowed = new Set([
        "sessionId",
        "capabilityId",
        "budgetSnapshot",
        "assertLive",
        "contextSnapshot",
        "execute",
        "enabled",
        "replace",
    ])
    const input = {}
    for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key]
        if (
            typeof key !== "string" ||
            !allowed.has(key) ||
            !Object.hasOwn(descriptor, "value")
        ) throw new TypeError("Operator executor registration is invalid")
        input[key] = descriptor.value
    }
    if (
        identifier(input.sessionId) === null ||
        identifier(input.capabilityId) === null ||
        typeof input.budgetSnapshot !== "function" ||
        typeof input.assertLive !== "function" ||
        (input.contextSnapshot !== undefined && typeof input.contextSnapshot !== "function") ||
        typeof input.execute !== "function" ||
        (input.enabled !== undefined && typeof input.enabled !== "boolean")
    ) throw new TypeError("Operator executor registration is invalid")
    return input
}

function operatorSessionContext(route) {
    if (route.contextSnapshot === null) return null
    const value = route.contextSnapshot()
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Operator session context is invalid")
    }
    const prototype = Object.getPrototypeOf(value)
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (
        (prototype !== Object.prototype && prototype !== null) ||
        Reflect.ownKeys(descriptors).length !== 2 ||
        !Object.hasOwn(descriptors, "workspaceRoot") ||
        !Object.hasOwn(descriptors, "runtimeId") ||
        Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value")) ||
        identifier(descriptors.runtimeId.value) === null ||
        typeof descriptors.workspaceRoot.value !== "string" ||
        descriptors.workspaceRoot.value.length === 0 ||
        descriptors.workspaceRoot.value.length > 8_192 ||
        !isAbsolute(descriptors.workspaceRoot.value)
    ) throw new Error("Operator session context is invalid")
    return Object.freeze({
        workspaceRoot: resolve(descriptors.workspaceRoot.value),
        runtimeId: descriptors.runtimeId.value,
    })
}

function sweepOperatorExecutors(state) {
    if (state.operatorExecutors.size === 0) return
    let now = null
    try {
        const candidate = state.clock()
        if (Number.isFinite(candidate) && candidate >= 0) now = candidate
    } catch {}
    if (now === null) return
    for (const [sessionId, record] of state.operatorExecutors) {
        if (record.tombstone === true && record.expiresAt <= now) {
            state.operatorExecutors.delete(sessionId)
        }
    }
}

function retireOperatorExecutor(state, record) {
    record.enabled = false
    record.registered = false
    record.budgetSnapshot = null
    record.assertLive = null
    record.contextSnapshot = null
    record.execute = null
    if (state.operatorExecutors.get(record.sessionId) === record) {
        let now = null
        try {
            const candidate = state.clock()
            if (Number.isFinite(candidate) && candidate >= 0) now = candidate
        } catch {}
        state.operatorExecutors.set(record.sessionId, Object.freeze({
            tombstone: true,
            sessionId: record.sessionId,
            capabilityId: record.capabilityId,
            expiresAt: now === null
                ? Number.MAX_SAFE_INTEGER
                : Math.min(Number.MAX_SAFE_INTEGER, now + OPERATOR_EXECUTOR_TOMBSTONE_TTL_MS),
        }))
    }
}

function operatorRouteForGrant(state, grant) {
    sweepOperatorExecutors(state)
    const route = state.operatorExecutors.get(grant.sessionId)
    if (route === undefined) return null
    if (route.capabilityId !== grant.id) {
        throw createPublicControlError("CAPABILITY_REVOKED")
    }
    if (route.tombstone === true) throw createPublicControlError("CONTROL_BUSY")
    return route
}

function assertOperatorRouteLive(state, route) {
    if (
        state.operatorExecutors.get(route.sessionId) !== route ||
        !route.registered ||
        !route.enabled
    ) throw createPublicControlError("CONTROL_BUSY")
    if (route.assertLive() !== true) throw createPublicControlError("CONTROL_BUSY")
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
            serviceErrorDiagnostics: serviceDiagnosticStates.has(options.serviceErrorDiagnostics)
                ? options.serviceErrorDiagnostics
                : null,
            operatorExecutors: new Map(),
        })
        Object.freeze(this)
    }

    registerOperatorExecutor(registration = {}) {
        const state = stateByControlPlane.get(this)
        const input = operatorExecutorInput(registration)
        sweepOperatorExecutors(state)
        const current = state.operatorExecutors.get(input.sessionId) ?? null
        const replacement = input.replace === undefined
            ? null
            : operatorExecutorLeaseStates.get(input.replace) ?? null
        if (current !== null && current.tombstone !== true && current.registered && replacement !== current) {
            throw new Error("Operator executor replacement lease is required")
        }
        if (
            (current === null && input.replace !== undefined) ||
            (current !== null && input.replace !== undefined && replacement !== current)
        ) {
            throw new Error("Operator executor replacement lease is stale")
        }
        if (current === null && state.operatorExecutors.size >= MAX_OPERATOR_EXECUTOR_RECORDS) {
            throw new Error("Operator executor registry capacity is exhausted")
        }
        const record = {
            sessionId: input.sessionId,
            capabilityId: input.capabilityId,
            budgetSnapshot: input.budgetSnapshot,
            assertLive: input.assertLive,
            contextSnapshot: input.contextSnapshot ?? null,
            execute: input.execute,
            enabled: input.enabled !== false,
            registered: true,
        }
        const lease = Object.freeze({
            disable() {
                if (state.operatorExecutors.get(record.sessionId) !== record || !record.registered) {
                    return false
                }
                record.enabled = false
                return true
            },
            enable() {
                if (state.operatorExecutors.get(record.sessionId) !== record || !record.registered) {
                    return false
                }
                record.enabled = true
                return true
            },
            unregister() {
                if (state.operatorExecutors.get(record.sessionId) !== record || !record.registered) {
                    return false
                }
                retireOperatorExecutor(state, record)
                return true
            },
        })
        operatorExecutorLeaseStates.set(lease, record)
        state.operatorExecutors.set(record.sessionId, record)
        if (current !== null && current.tombstone !== true) {
            current.enabled = false
            current.registered = false
            current.budgetSnapshot = null
            current.assertLive = null
            current.contextSnapshot = null
            current.execute = null
        }
        return lease
    }

    operatorExecutorRegistryStats() {
        const state = stateByControlPlane.get(this)
        sweepOperatorExecutors(state)
        let live = 0
        let tombstones = 0
        let retainedCallbacks = 0
        for (const record of state.operatorExecutors.values()) {
            if (record.tombstone === true) {
                tombstones += 1
                continue
            }
            live += 1
            for (const key of ["budgetSnapshot", "assertLive", "contextSnapshot", "execute"]) {
                if (typeof record[key] === "function") retainedCallbacks += 1
            }
        }
        return Object.freeze({
            live,
            tombstones,
            retainedCallbacks,
            total: state.operatorExecutors.size,
        })
    }

    async invoke(request = {}) {
        const state = stateByControlPlane.get(this)
        const startedAt = state.auditSink ? auditTimestamp(state) : null
        let method = boundedAuditMethod(undefined)
        let envelope = null
        let bearerSecret = null
        let input = null
        let grant = null
        let auditCapabilityId = null
        let auditSessionId = null
        let resolution = null
        let resolvedScope
        let executionContext = null
        let outcome = "error"
        let errorCode = null
        let idempotencyOwner = null
        let executionStarted = false
        let serviceFailure = null
        let operatorRoute = null
        let operatorExecution = false
        try {
            envelope = snapshotControlRequest(request)
            bearerSecret = typeof envelope.token === "string" ? envelope.token : null
            method = boundedAuditMethod(envelope.method, bearerSecret)
            const definition = controlDefinition(envelope.method)
            method = envelope.method
            input = parseControlInput(method, envelope.params)
            if (identifier(envelope.sessionId) === null) throw invalidEnvelope(method, "sessionId")
            try {
                grant = state.capabilities.authorize(
                    envelope.token,
                    definition.action,
                    envelope.sessionId,
                )
            } catch (error) {
                throw authorizationError(error)
            }
            auditCapabilityId = boundedAuditId(grant.id, bearerSecret)
            auditSessionId = boundedAuditId(grant.sessionId, bearerSecret)
            operatorRoute = operatorRouteForGrant(state, grant)
            if (operatorRoute !== null) assertOperatorRouteLive(state, operatorRoute)
            if (operatorRoute !== null && definition.operatorExposed !== true) {
                throw decisionError({decision: "deny", code: "OPERATOR_METHOD_NOT_EXPOSED"}, definition.action)
            }

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

            let source
            try {
                source = await trustedResolution(state.services, method, input, grant)
            } catch (error) {
                if (isTrustedHumanCapability(grant)) serviceFailure = error
                throw error
            }
            if (source !== null && source !== undefined) {
                if (Object.hasOwn(source, "scope") && Object.hasOwn(source, "executionContext")) {
                    resolution = source.scope
                    executionContext = source.executionContext
                    if (
                        executionContext !== null &&
                        (!executionContext ||
                            typeof executionContext !== "object" ||
                            !Object.isFrozen(executionContext))
                    ) {
                        throw new Error("Control execution context must be immutable")
                    }
                } else {
                    resolution = source
                }
            }
            resolvedScope = resolution === null
                ? undefined
                : createResolvedScope(resolution, {
                      maxScopeIds: capabilityScopeLimit(grant),
                  })

            let decision = null
            for (let attempt = 0; attempt < MAX_BUDGET_CAS_ATTEMPTS; attempt += 1) {
                let budgetSnapshot
                if (
                    (definition.action === "runtime.execute" &&
                        Object.hasOwn(grant.budget, "maxRuntimeTurns")) ||
                    (definition.action === "evaluations.execute" &&
                        Object.hasOwn(grant.budget, "maxEvaluations"))
                ) {
                    const budget = operatorRoute === null
                        ? state.budgetLedger.read(grant)
                        : operatorRoute.budgetSnapshot()
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
                    operatorPreauthorized: operatorRoute !== null,
                })
                if (!decision || typeof decision.then === "function") {
                    throw new Error("Control policy must return a synchronous decision")
                }
                if (decision.decision !== "allow") {
                    if (
                        decision.decision === "approval_required" &&
                        operatorRoute !== null
                    ) break
                    throw decisionError(decision, definition.action)
                }
                if (operatorRoute !== null) break
                if (decision.reservation === null) break
                if (state.budgetLedger.commit(decision.reservation, grant)) break
                decision = null
            }
            if (decision === null) throw createPublicControlError("CONTROL_BUSY")

            const operatorSession = operatorRoute === null
                ? null
                : operatorSessionContext(operatorRoute)
            if (operatorRoute !== null) assertOperatorRouteLive(state, operatorRoute)
            const context = Object.freeze({
                capabilityId: grant.id,
                sessionId: grant.sessionId,
                grant,
                scopeFilter: decision.scopeFilter ?? null,
                executionContext,
                operatorSession,
            })
            executionStarted = true
            let rawResult
            if (operatorRoute !== null) {
                assertOperatorRouteLive(state, operatorRoute)
                operatorExecution = true
                const trustedFacts = await trustedFactsResolution(
                    state.services,
                    method,
                    input,
                    context,
                )
                assertOperatorRouteLive(state, operatorRoute)
                rawResult = await operatorRoute.execute(Object.freeze({
                    invocationId: randomUUID(),
                    method,
                    input,
                    policyDecision: decision,
                    context,
                    ...(trustedFacts === null ? {} : {trustedFacts}),
                }))
            } else {
                try {
                    rawResult = await state.services[method](input, context)
                } catch (error) {
                    serviceFailure = error
                    throw error
                }
            }
            const parsed = parseControlOutput(method, rawResult)
            const result = idempotencyOwner
                ? state.idempotency.complete(idempotencyOwner, parsed)
                : parsed
            idempotencyOwner = null
            outcome = "success"
            return result
        } catch (error) {
            const safe = safeControlError(error, method)
            if (serviceFailure !== null) {
                state.serviceErrorDiagnostics?.capture(safe, serviceFailure)
            }
            if (idempotencyOwner) {
                if (
                    executionStarted &&
                    safe.code !== "CONTROL_BUSY" &&
                    !(operatorExecution && safe.code === "APPROVAL_REQUIRED")
                ) {
                    state.idempotency.completeError(idempotencyOwner, safe)
                }
                else state.idempotency.fail(idempotencyOwner, safe)
                idempotencyOwner = null
            }
            errorCode = safe.code ?? "CONTROL_ERROR"
            throw safe
        } finally {
            if (state.auditSink) {
                finalizeAudit(state, {
                    bearerSecret,
                    capabilityId: auditCapabilityId,
                    sessionId: auditSessionId,
                    method,
                    input,
                    resolvedScope,
                    startedAt,
                    outcome,
                    errorCode,
                })
            }
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
    createServiceErrorDiagnosticChannel,
    DEFAULT_IDEMPOTENCY_LIMIT,
    IDEMPOTENCY_TTL_MS,
    MAX_OPERATOR_EXECUTOR_RECORDS,
    OPERATOR_EXECUTOR_TOMBSTONE_TTL_MS,
}
