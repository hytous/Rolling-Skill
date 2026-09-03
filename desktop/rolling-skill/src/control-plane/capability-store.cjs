const crypto = require("node:crypto")

const {METHOD_DEFINITIONS} = require("./contracts.cjs")

const MAX_CAPABILITY_LIFETIME_MS = 24 * 60 * 60 * 1_000
const MAX_IDENTIFIER_LENGTH = 200
const MAX_SCOPE_IDS = 256
const MAX_TRUSTED_SCOPE_IDS = 4_096
const TOKEN_BYTES = 32
const CAPABILITY_ID_BYTES = 16
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u

const CAPABILITY_ACTIONS = Object.freeze([
    ...new Set(Object.values(METHOD_DEFINITIONS).map(({action}) => action)),
])
const CAPABILITY_ACTION_SET = new Set(CAPABILITY_ACTIONS)
const REQUEST_KEYS = new Set([
    "sessionId",
    "actions",
    "scopes",
    "expiresInMs",
    "budget",
])
const SCOPE_KEYS = Object.freeze([
    "skillIds",
    "datasetIds",
    "runtimeIds",
    "repositoryIds",
])
const SCOPE_KEY_SET = new Set(SCOPE_KEYS)
const BUDGET_KEYS = Object.freeze(["maxRuntimeTurns", "maxEvaluations"])
const BUDGET_KEY_SET = new Set(BUDGET_KEYS)
const trustedIssueByStore = new WeakMap()
const scopeLimitByGrant = new WeakMap()
const humanControlGrants = new WeakSet()

class CapabilityError extends Error {
    constructor(code, message) {
        super(message)
        this.name = "CapabilityError"
        this.code = code
    }
}

function capabilityRequestError(message) {
    return new CapabilityError("INVALID_CAPABILITY_REQUEST", message)
}

function dataDescriptor(descriptor) {
    return descriptor !== undefined && Object.hasOwn(descriptor, "value")
}

function snapshotRecord(value, label) {
    try {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw capabilityRequestError(`${label} must be a safe plain data record`)
        }
        const prototype = Object.getPrototypeOf(value)
        if (prototype !== Object.prototype && prototype !== null) {
            throw capabilityRequestError(`${label} must be a safe plain data record`)
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const snapshot = new Map()
        for (const key of Reflect.ownKeys(descriptors)) {
            const descriptor = descriptors[key]
            if (typeof key !== "string" || !dataDescriptor(descriptor)) {
                throw capabilityRequestError(`${label} must contain only own data properties`)
            }
            snapshot.set(key, descriptor.value)
        }
        return snapshot
    } catch (error) {
        if (error instanceof CapabilityError && error.code === "INVALID_CAPABILITY_REQUEST") {
            throw error
        }
        throw capabilityRequestError(`${label} must be a safe plain data record`)
    }
}

function snapshotArray(value, label, maximum) {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
            throw capabilityRequestError(`${label} must be a safe dense data array`)
        }
        const descriptors = Object.getOwnPropertyDescriptors(value)
        const keys = Reflect.ownKeys(descriptors)
        const lengthDescriptor = descriptors.length
        if (
            !dataDescriptor(lengthDescriptor) ||
            !Number.isSafeInteger(lengthDescriptor.value) ||
            lengthDescriptor.value < 0 ||
            lengthDescriptor.value > maximum ||
            keys.length !== lengthDescriptor.value + 1 ||
            keys.some((key) => typeof key !== "string")
        ) {
            throw capabilityRequestError(`${label} must be a safe dense data array`)
        }
        const snapshot = []
        for (let index = 0; index < lengthDescriptor.value; index += 1) {
            const descriptor = descriptors[String(index)]
            if (!dataDescriptor(descriptor)) {
                throw capabilityRequestError(`${label} must be a safe dense data array`)
            }
            defineOwnData(snapshot, snapshot.length, descriptor.value)
        }
        return snapshot
    } catch (error) {
        if (error instanceof CapabilityError && error.code === "INVALID_CAPABILITY_REQUEST") {
            throw error
        }
        throw capabilityRequestError(`${label} must be a safe dense data array`)
    }
}

function assertKnownKeys(snapshot, allowedKeys, message) {
    for (const key of snapshot.keys()) {
        if (!allowedKeys.has(key)) throw capabilityRequestError(message)
    }
}

function defineOwnData(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
    })
}

function normalizeIdentifier(value, label) {
    if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > MAX_IDENTIFIER_LENGTH ||
        value.trim() !== value ||
        !/\S/u.test(value) ||
        /[\u0000-\u001f\u007f]/u.test(value)
    ) {
        throw capabilityRequestError(
            `${label} must be a non-empty identifier of at most ${MAX_IDENTIFIER_LENGTH} characters`,
        )
    }
    return value
}

function normalizeActions(actions) {
    const source = snapshotArray(actions, "Capability actions", CAPABILITY_ACTIONS.length)
    if (source.length < 1) {
        throw capabilityRequestError("Capability actions must be a non-empty bounded array")
    }
    const normalized = []
    const seen = new Set()
    for (const action of source) {
        if (typeof action !== "string" || !CAPABILITY_ACTION_SET.has(action)) {
            throw capabilityRequestError("Unknown capability action")
        }
        if (!seen.has(action)) {
            seen.add(action)
            defineOwnData(normalized, normalized.length, action)
        }
    }
    return Object.freeze(normalized)
}

function normalizeScopeIds(value, key, maximum) {
    const source = snapshotArray(value, key, maximum)
    const normalized = []
    const seen = new Set()
    for (const id of source) {
        const normalizedId = normalizeIdentifier(id, key)
        if (!seen.has(normalizedId)) {
            seen.add(normalizedId)
            defineOwnData(normalized, normalized.length, normalizedId)
        }
    }
    return Object.freeze(normalized)
}

function normalizeScopes(scopes, present, maximum) {
    const snapshot = present ? snapshotRecord(scopes, "Capability scopes") : new Map()
    assertKnownKeys(snapshot, SCOPE_KEY_SET, "Unknown capability scope")
    const normalized = {}
    for (const key of SCOPE_KEYS) {
        defineOwnData(
            normalized,
            key,
            normalizeScopeIds(snapshot.has(key) ? snapshot.get(key) : [], key, maximum),
        )
    }
    return Object.freeze(normalized)
}

function normalizeBudgetLimit(value, key) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw capabilityRequestError(`${key} must be a non-negative safe integer`)
    }
    return value
}

function normalizeBudget(budget, present) {
    const snapshot = present ? snapshotRecord(budget, "Capability budget") : new Map()
    assertKnownKeys(snapshot, BUDGET_KEY_SET, "Unknown capability budget")
    const normalized = {}
    for (const key of BUDGET_KEYS) {
        if (!snapshot.has(key)) continue
        defineOwnData(normalized, key, normalizeBudgetLimit(snapshot.get(key), key))
    }
    return Object.freeze(normalized)
}

function normalizeLifetime(expiresInMs) {
    if (!Number.isFinite(expiresInMs) || !Number.isInteger(expiresInMs) || expiresInMs <= 0) {
        throw capabilityRequestError("expiresInMs must be a positive finite integer")
    }
    if (expiresInMs > MAX_CAPABILITY_LIFETIME_MS) {
        throw capabilityRequestError("expiresInMs cannot exceed 24 hours")
    }
    return expiresInMs
}

class CapabilityStore {
    #clock
    #randomBytes
    #recordObserver
    #timingSafeEqual
    #records = new Map()

    constructor({
        clock = Date.now,
        randomBytes = crypto.randomBytes,
        recordObserver = null,
        timingSafeEqual = crypto.timingSafeEqual,
    } = {}) {
        if (typeof clock !== "function") throw new TypeError("clock must be a function")
        if (typeof randomBytes !== "function") throw new TypeError("randomBytes must be a function")
        if (typeof timingSafeEqual !== "function") {
            throw new TypeError("timingSafeEqual must be a function")
        }
        if (recordObserver !== null && typeof recordObserver !== "function") {
            throw new TypeError("recordObserver must be a function or null")
        }
        this.#clock = clock
        this.#randomBytes = randomBytes
        this.#recordObserver = recordObserver
        this.#timingSafeEqual = timingSafeEqual
        trustedIssueByStore.set(this, (request, maximum, humanControl = false) => (
            this.#issue(request, maximum, humanControl)
        ))
    }

    #now() {
        const value = this.#clock()
        const timestamp = value instanceof Date ? value.getTime() : value
        if (!Number.isFinite(timestamp)) throw new TypeError("clock must return a finite timestamp")
        return timestamp
    }

    #random(size) {
        const value = this.#randomBytes(size)
        if (!Buffer.isBuffer(value) || value.byteLength !== size) {
            throw new TypeError(`randomBytes must return exactly ${size} bytes`)
        }
        return Buffer.from(value)
    }

    #digest(token) {
        return crypto.createHash("sha256").update(token, "utf8").digest()
    }

    #findByDigest(digest) {
        let matched = null
        for (const record of this.#records.values()) {
            if (this.#timingSafeEqual(digest, record.tokenHash)) matched = record
        }
        return matched
    }

    issue(request) {
        return this.#issue(request, MAX_SCOPE_IDS)
    }

    #issue(request, maximumScopeIds, humanControl = false) {
        const snapshot = snapshotRecord(request, "Capability request")
        assertKnownKeys(snapshot, REQUEST_KEYS, "Unknown capability request field")

        const sessionId = normalizeIdentifier(snapshot.get("sessionId"), "sessionId")
        const actions = normalizeActions(snapshot.get("actions"))
        const scopes = normalizeScopes(
            snapshot.get("scopes"),
            snapshot.has("scopes"),
            maximumScopeIds,
        )
        const budget = normalizeBudget(snapshot.get("budget"), snapshot.has("budget"))
        const expiresInMs = normalizeLifetime(snapshot.get("expiresInMs"))
        const issuedAt = this.#now()

        let token
        let tokenHash
        do {
            token = this.#random(TOKEN_BYTES).toString("base64url")
            tokenHash = this.#digest(token)
        } while (this.#findByDigest(tokenHash) !== null)

        let id
        do {
            id = `cap_${this.#random(CAPABILITY_ID_BYTES).toString("base64url")}`
        } while (this.#records.has(id))

        const grant = Object.freeze({
            id,
            sessionId,
            actions,
            scopes,
            budget,
            issuedAt,
            expiresAt: issuedAt + expiresInMs,
        })
        scopeLimitByGrant.set(grant, maximumScopeIds)
        if (humanControl) humanControlGrants.add(grant)
        const record = {grant, tokenHash, revokedAt: null}
        if (this.#recordObserver !== null) {
            this.#recordObserver(Object.freeze({
                id,
                storedFields: Object.freeze(Object.keys(record)),
                tokenHashByteLength: tokenHash.byteLength,
            }))
        }
        this.#records.set(id, record)

        return Object.freeze({...grant, token})
    }

    authorize(token, action, expectedSessionId) {
        let record = null
        if (typeof token === "string" && TOKEN_PATTERN.test(token)) {
            record = this.#findByDigest(this.#digest(token))
        }
        if (record === null) {
            throw new CapabilityError("CAPABILITY_INVALID", "Capability token is not recognized")
        }
        if (record.revokedAt !== null) {
            throw new CapabilityError("CAPABILITY_REVOKED", "Capability has been revoked")
        }
        if (record.grant.expiresAt <= this.#now()) {
            throw new CapabilityError("CAPABILITY_EXPIRED", "Capability has expired")
        }
        if (expectedSessionId !== undefined && expectedSessionId !== record.grant.sessionId) {
            throw new CapabilityError(
                "CAPABILITY_SESSION_MISMATCH",
                "Capability belongs to a different Operator session",
            )
        }
        if (typeof action !== "string" || !record.grant.actions.includes(action)) {
            throw new CapabilityError(
                "CAPABILITY_ACTION_NOT_GRANTED",
                "Capability action is not granted",
            )
        }
        return record.grant
    }

    revoke(id) {
        const record = this.#records.get(id)
        if (record === undefined || record.revokedAt !== null) return false
        record.revokedAt = this.#now()
        return true
    }

    revokeSession(sessionId) {
        const normalizedSessionId = normalizeIdentifier(sessionId, "sessionId")
        const revokedAt = this.#now()
        let revoked = 0
        for (const record of this.#records.values()) {
            if (record.grant.sessionId === normalizedSessionId && record.revokedAt === null) {
                record.revokedAt = revokedAt
                revoked += 1
            }
        }
        return revoked
    }

    sweepExpired() {
        const now = this.#now()
        let swept = 0
        for (const [id, record] of this.#records) {
            if (record.grant.expiresAt <= now) {
                this.#records.delete(id)
                swept += 1
            }
        }
        return swept
    }
}

function createTrustedCapabilityIssuer(store, {maxScopeIds = MAX_TRUSTED_SCOPE_IDS} = {}) {
    const issue = trustedIssueByStore.get(store)
    if (typeof issue !== "function") throw new TypeError("A CapabilityStore is required")
    if (
        !Number.isSafeInteger(maxScopeIds) ||
        maxScopeIds < MAX_SCOPE_IDS ||
        maxScopeIds > MAX_TRUSTED_SCOPE_IDS
    ) throw new TypeError("Trusted capability scope limit is invalid")
    return Object.freeze({
        issue(request) {
            return issue(request, maxScopeIds)
        },
    })
}

function createTrustedHumanCapabilityIssuer(store, options = {}) {
    const issue = trustedIssueByStore.get(store)
    if (typeof issue !== "function") throw new TypeError("A CapabilityStore is required")
    const {maxScopeIds = MAX_TRUSTED_SCOPE_IDS} = options
    if (
        !Number.isSafeInteger(maxScopeIds) ||
        maxScopeIds < MAX_SCOPE_IDS ||
        maxScopeIds > MAX_TRUSTED_SCOPE_IDS
    ) throw new TypeError("Trusted capability scope limit is invalid")
    return Object.freeze({
        issue(request) {
            return issue(request, maxScopeIds, true)
        },
    })
}

function isTrustedHumanCapability(grant) {
    return humanControlGrants.has(grant)
}

function capabilityScopeLimit(grant) {
    return scopeLimitByGrant.get(grant) ?? MAX_SCOPE_IDS
}

module.exports = {
    CAPABILITY_ACTIONS,
    CapabilityError,
    CapabilityStore,
    capabilityScopeLimit,
    createTrustedCapabilityIssuer,
    createTrustedHumanCapabilityIssuer,
    isTrustedHumanCapability,
    MAX_CAPABILITY_LIFETIME_MS,
    MAX_SCOPE_IDS,
    MAX_TRUSTED_SCOPE_IDS,
}
