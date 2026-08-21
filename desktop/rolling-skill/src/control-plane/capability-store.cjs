const crypto = require("node:crypto")

const {METHOD_DEFINITIONS} = require("./contracts.cjs")

const MAX_CAPABILITY_LIFETIME_MS = 24 * 60 * 60 * 1_000
const MAX_IDENTIFIER_LENGTH = 200
const MAX_SCOPE_IDS = 256
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
const SCOPE_KEYS = Object.freeze(["skillIds", "datasetIds", "runtimeIds"])
const SCOPE_KEY_SET = new Set(SCOPE_KEYS)
const BUDGET_KEYS = Object.freeze(["maxRuntimeTurns", "maxEvaluations"])
const BUDGET_KEY_SET = new Set(BUDGET_KEYS)

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

function assertPlainObject(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw capabilityRequestError(`${label} must be an object`)
    }
}

function assertKnownKeys(value, allowedKeys, message) {
    const unknown = Reflect.ownKeys(value).find(
        (key) => typeof key !== "string" || !allowedKeys.has(key),
    )
    if (unknown !== undefined) throw capabilityRequestError(message)
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
    if (!Array.isArray(actions) || actions.length < 1 || actions.length > CAPABILITY_ACTIONS.length) {
        throw capabilityRequestError("Capability actions must be a non-empty bounded array")
    }
    const normalized = []
    const seen = new Set()
    for (const action of actions) {
        if (typeof action !== "string" || !CAPABILITY_ACTION_SET.has(action)) {
            throw capabilityRequestError("Unknown capability action")
        }
        if (!seen.has(action)) {
            seen.add(action)
            normalized.push(action)
        }
    }
    return Object.freeze(normalized)
}

function normalizeScopeIds(value, key) {
    if (!Array.isArray(value) || value.length > MAX_SCOPE_IDS) {
        throw capabilityRequestError(
            `${key} must be an array containing at most ${MAX_SCOPE_IDS} identifiers`,
        )
    }
    const normalized = []
    const seen = new Set()
    for (const id of value) {
        const normalizedId = normalizeIdentifier(id, key)
        if (!seen.has(normalizedId)) {
            seen.add(normalizedId)
            normalized.push(normalizedId)
        }
    }
    return Object.freeze(normalized)
}

function normalizeScopes(scopes) {
    assertPlainObject(scopes, "Capability scopes")
    assertKnownKeys(scopes, SCOPE_KEY_SET, "Unknown capability scope")
    const normalized = {}
    for (const key of SCOPE_KEYS) normalized[key] = normalizeScopeIds(scopes[key] ?? [], key)
    return Object.freeze(normalized)
}

function normalizeBudgetLimit(value, key) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw capabilityRequestError(`${key} must be a non-negative safe integer`)
    }
    return value
}

function normalizeBudget(budget) {
    assertPlainObject(budget, "Capability budget")
    assertKnownKeys(budget, BUDGET_KEY_SET, "Unknown capability budget")
    const normalized = {}
    for (const key of BUDGET_KEYS) normalized[key] = normalizeBudgetLimit(budget[key] ?? 0, key)
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
    #timingSafeEqual
    #records = new Map()

    constructor({
        clock = Date.now,
        randomBytes = crypto.randomBytes,
        timingSafeEqual = crypto.timingSafeEqual,
    } = {}) {
        if (typeof clock !== "function") throw new TypeError("clock must be a function")
        if (typeof randomBytes !== "function") throw new TypeError("randomBytes must be a function")
        if (typeof timingSafeEqual !== "function") {
            throw new TypeError("timingSafeEqual must be a function")
        }
        this.#clock = clock
        this.#randomBytes = randomBytes
        this.#timingSafeEqual = timingSafeEqual
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
        assertPlainObject(request, "Capability request")
        assertKnownKeys(request, REQUEST_KEYS, "Unknown capability request field")

        const sessionId = normalizeIdentifier(request.sessionId, "sessionId")
        const actions = normalizeActions(request.actions)
        const scopes = normalizeScopes(request.scopes ?? {})
        const budget = normalizeBudget(request.budget ?? {})
        const expiresInMs = normalizeLifetime(request.expiresInMs)
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
        this.#records.set(id, {grant, tokenHash, revokedAt: null})

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

module.exports = {
    CAPABILITY_ACTIONS,
    CapabilityError,
    CapabilityStore,
    MAX_CAPABILITY_LIFETIME_MS,
    MAX_SCOPE_IDS,
}
