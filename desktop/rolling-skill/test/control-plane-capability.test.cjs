const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const {describe, it} = require("node:test")

const {
    CapabilityStore,
    createTrustedCapabilityIssuer,
    MAX_CAPABILITY_LIFETIME_MS,
    MAX_SCOPE_IDS,
    MAX_TRUSTED_SCOPE_IDS,
} = require("../src/control-plane/capability-store.cjs")

const minute = 60_000

function createFixture() {
    let now = 1_800_000_000_000
    let randomCall = 0
    const randomBytes = (size) => {
        randomCall += 1
        return Buffer.alloc(size, randomCall)
    }
    const timingCalls = []
    const timingSafeEqual = (left, right) => {
        timingCalls.push([Buffer.from(left), Buffer.from(right)])
        return Buffer.from(left).equals(Buffer.from(right))
    }
    return {
        advance(milliseconds) {
            now += milliseconds
        },
        now: () => now,
        store: new CapabilityStore({
            clock: () => now,
            randomBytes,
            timingSafeEqual,
        }),
        timingCalls,
    }
}

function captureError(callback, pattern) {
    let captured
    assert.throws(callback, (error) => {
        captured = error
        return pattern.test(error.message)
    })
    return captured
}

function captureInvalidRequest(callback) {
    let captured
    assert.throws(callback, (error) => {
        captured = error
        return true
    })
    assert.equal(captured.code, "INVALID_CAPABILITY_REQUEST")
    return captured
}

function issueOperator(store, overrides = {}) {
    return store.issue({
        sessionId: "operator-1",
        actions: ["raw_cases.read", "raw_cases.write", "evaluations.read"],
        scopes: {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: [],
            repositoryIds: [],
        },
        expiresInMs: minute,
        budget: {maxRuntimeTurns: 4, maxEvaluations: 1},
        ...overrides,
    })
}

describe("control-plane capability store", () => {
    it("issues a bearer token once and authorizes only granted actions", () => {
        const {store, now} = createFixture()
        const issued = issueOperator(store)

        assert.match(issued.id, /^cap_[A-Za-z0-9_-]{22}$/u)
        assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/u)
        assert.equal(issued.issuedAt, now())
        assert.equal(issued.expiresAt, now() + minute)

        const authorized = store.authorize(issued.token, "raw_cases.read", "operator-1")
        assert.equal(authorized.id, issued.id)
        assert.equal(authorized.sessionId, "operator-1")
        assert.equal(Object.hasOwn(authorized, "token"), false)

        const error = captureError(
            () => store.authorize(issued.token, "evaluations.execute", "operator-1"),
            /not granted/u,
        )
        assert.equal(error.code, "CAPABILITY_ACTION_NOT_GRANTED")
        assert.doesNotMatch(error.message, new RegExp(issued.token, "u"))
    })

    it("keeps only private token digests and uses timing-safe comparison for lookup", () => {
        const {store, timingCalls} = createFixture()
        const issued = issueOperator(store)

        assert.equal(JSON.stringify(store).includes(issued.token), false)
        assert.equal(Object.values(store).includes(issued.token), false)
        store.authorize(issued.token, "raw_cases.read", "operator-1")

        assert.ok(timingCalls.length > 0)
        for (const [left, right] of timingCalls) {
            assert.equal(left.byteLength, 32)
            assert.equal(right.byteLength, 32)
        }
    })

    it("compares first, last, and unknown valid tokens against every live digest", () => {
        const {store, timingCalls} = createFixture()
        const first = issueOperator(store)
        issueOperator(store, {sessionId: "operator-2"})
        const last = issueOperator(store, {sessionId: "operator-3"})
        const unknown = "z".repeat(43)

        for (const [token, expectedSessionId] of [
            [first.token, "operator-1"],
            [last.token, "operator-3"],
            [unknown, null],
        ]) {
            timingCalls.length = 0
            if (expectedSessionId === null) {
                assert.throws(() => store.authorize(token, "raw_cases.read"), /not recognized/u)
            } else {
                assert.equal(store.authorize(token, "raw_cases.read").sessionId, expectedSessionId)
            }
            assert.equal(timingCalls.length, 3)
            const expectedDigest = crypto.createHash("sha256").update(token, "utf8").digest()
            for (const [candidate, stored] of timingCalls) {
                assert.equal(candidate.byteLength, 32)
                assert.equal(stored.byteLength, 32)
                assert.ok(candidate.equals(expectedDigest))
            }
        }
    })

    it("offers injected hash-only record metadata without exposing a token or digest value", () => {
        let randomCall = 0
        const observed = []
        const store = new CapabilityStore({
            clock: () => 1_800_000_000_000,
            randomBytes(size) {
                randomCall += 1
                return Buffer.alloc(size, randomCall)
            },
            recordObserver(metadata) {
                observed.push(metadata)
            },
        })
        const issued = issueOperator(store)

        assert.equal(observed.length, 1)
        assert.deepEqual(observed[0], {
            id: issued.id,
            storedFields: ["grant", "tokenHash", "revokedAt"],
            tokenHashByteLength: 32,
        })
        assert.ok(Object.isFrozen(observed[0]))
        assert.ok(Object.isFrozen(observed[0].storedFields))
        assert.equal(Object.hasOwn(observed[0], "token"), false)
        assert.equal(Object.hasOwn(observed[0], "tokenHash"), false)
        assert.equal(JSON.stringify(observed[0]).includes(issued.token), false)
    })

    it("binds a token to exactly one expected Operator session", () => {
        const {store} = createFixture()
        const issued = issueOperator(store)

        const error = captureError(
            () => store.authorize(issued.token, "raw_cases.read", "operator-2"),
            /different Operator session/u,
        )
        assert.equal(error.code, "CAPABILITY_SESSION_MISMATCH")
        assert.equal(store.authorize(issued.token, "raw_cases.read").sessionId, "operator-1")
    })

    it("copies, deduplicates, and deeply freezes authority supplied by the caller", () => {
        const {store} = createFixture()
        const request = {
            sessionId: "operator-1",
            actions: ["raw_cases.read", "raw_cases.read", "datasets.read"],
            scopes: {
                skillIds: ["skill-1", "skill-1"],
                datasetIds: ["dataset-1", "dataset-1"],
                runtimeIds: ["runtime-1", "runtime-1"],
            },
            expiresInMs: minute,
            budget: {maxRuntimeTurns: 4, maxEvaluations: 1},
        }
        const issued = store.issue(request)

        request.actions.push("evaluations.execute")
        request.scopes.skillIds.push("skill-2")
        request.budget.maxEvaluations = 99

        const grant = store.authorize(issued.token, "raw_cases.read", "operator-1")
        assert.deepEqual(grant.actions, ["raw_cases.read", "datasets.read"])
        assert.deepEqual(grant.scopes, {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["runtime-1"],
            repositoryIds: [],
        })
        assert.deepEqual(grant.budget, {maxRuntimeTurns: 4, maxEvaluations: 1})
        assert.ok(Object.isFrozen(grant))
        assert.ok(Object.isFrozen(grant.actions))
        assert.ok(Object.isFrozen(grant.scopes))
        assert.ok(Object.isFrozen(grant.scopes.skillIds))
        assert.ok(Object.isFrozen(grant.budget))
        assert.equal(Reflect.set(grant.budget, "maxEvaluations", 100), false)
        assert.equal(Reflect.set(issued.scopes.skillIds, 0, "skill-2"), false)
    })

    it("rejects unknown actions and malformed or oversized authority", () => {
        const {store} = createFixture()

        assert.throws(
            () => issueOperator(store, {actions: ["raw_cases.read", "filesystem.write"]}),
            /Unknown capability action/u,
        )
        assert.throws(() => issueOperator(store, {actions: []}), /action/u)
        assert.throws(() => issueOperator(store, {sessionId: "  "}), /sessionId/u)
        assert.throws(
            () => issueOperator(store, {
                scopes: {skillIds: ["\0bad"], datasetIds: [], runtimeIds: []},
            }),
            /skillIds/u,
        )
        assert.throws(
            () => issueOperator(store, {
                scopes: {
                    skillIds: Array.from({length: MAX_SCOPE_IDS + 1}, (_, index) => `skill-${index}`),
                    datasetIds: [],
                    runtimeIds: [],
                },
            }),
            /skillIds/u,
        )
        assert.throws(
            () => issueOperator(store, {budget: {maxRuntimeTurns: -1, maxEvaluations: 1}}),
            /maxRuntimeTurns/u,
        )
        assert.throws(
            () => issueOperator(store, {budget: {maxRuntimeTurns: 1, maxEvaluations: 1.5}}),
            /maxEvaluations/u,
        )
    })

    it("keeps Operator scopes at 256 while a branded local issuer is explicitly bounded", () => {
        const {store} = createFixture()
        const rendererIssuer = createTrustedCapabilityIssuer(store, {
            maxScopeIds: MAX_TRUSTED_SCOPE_IDS,
        })
        const rendererScopes = Array.from(
            {length: MAX_SCOPE_IDS + 1},
            (_, index) => `skill-${index}`,
        )

        assert.throws(
            () => issueOperator(store, {
                scopes: {
                    skillIds: rendererScopes,
                    datasetIds: [],
                    runtimeIds: [],
                    repositoryIds: [],
                },
            }),
            /skillIds/u,
        )
        assert.doesNotThrow(() => rendererIssuer.issue({
            sessionId: "renderer-1",
            actions: ["raw_cases.read"],
            scopes: {
                skillIds: rendererScopes,
                datasetIds: [],
                runtimeIds: [],
                repositoryIds: [],
            },
            expiresInMs: minute,
            budget: {maxRuntimeTurns: 0, maxEvaluations: 0},
        }))
        assert.doesNotThrow(() => rendererIssuer.issue({
            sessionId: "renderer-at-limit",
            actions: ["raw_cases.read"],
            scopes: {
                skillIds: Array.from(
                    {length: MAX_TRUSTED_SCOPE_IDS},
                    (_, index) => `skill-limit-${index}`,
                ),
                datasetIds: [],
                runtimeIds: [],
                repositoryIds: [],
            },
            expiresInMs: minute,
            budget: {maxRuntimeTurns: 0, maxEvaluations: 0},
        }))
        assert.throws(() => rendererIssuer.issue({
            sessionId: "renderer-over-limit",
            actions: ["raw_cases.read"],
            scopes: {
                skillIds: Array.from(
                    {length: MAX_TRUSTED_SCOPE_IDS + 1},
                    (_, index) => `skill-over-${index}`,
                ),
                datasetIds: [],
                runtimeIds: [],
                repositoryIds: [],
            },
            expiresInMs: minute,
            budget: {maxRuntimeTurns: 0, maxEvaluations: 0},
        }), /skillIds/u)
    })

    it("accepts no unknown scope, budget, or top-level fields", () => {
        const {store} = createFixture()

        assert.throws(
            () => issueOperator(store, {
                scopes: {skillIds: [], datasetIds: [], runtimeIds: [], paths: ["/tmp"]},
            }),
            /Unknown capability scope/u,
        )
        assert.throws(
            () => issueOperator(store, {
                budget: {maxRuntimeTurns: 1, maxEvaluations: 1, maxCost: 100},
            }),
            /Unknown capability budget/u,
        )
        assert.throws(
            () => issueOperator(store, {rendererSuppliedPath: "/tmp/secret"}),
            /Unknown capability request/u,
        )
    })

    it("accepts only ordinary own-data records for request, scopes, and budget", () => {
        const {store} = createFixture()
        const customPrototype = {inherited: true}

        captureInvalidRequest(() => store.issue(Object.assign(Object.create(customPrototype), {
            sessionId: "operator-1",
            actions: ["raw_cases.read"],
            expiresInMs: minute,
        })))
        captureInvalidRequest(() => issueOperator(store, {
            scopes: Object.assign(Object.create(customPrototype), {
                skillIds: [],
                datasetIds: [],
                runtimeIds: [],
            }),
        }))
        captureInvalidRequest(() => issueOperator(store, {
            budget: Object.assign(Object.create(customPrototype), {
                maxRuntimeTurns: 1,
                maxEvaluations: 1,
            }),
        }))

        const nullRecordRequest = Object.assign(Object.create(null), {
            sessionId: "operator-null-prototype",
            actions: ["raw_cases.read"],
            scopes: Object.assign(Object.create(null), {
                skillIds: ["skill-1"],
                datasetIds: [],
                runtimeIds: [],
            }),
            expiresInMs: minute,
            budget: Object.assign(Object.create(null), {
                maxRuntimeTurns: 0,
                maxEvaluations: 0,
            }),
        })
        const issued = store.issue(nullRecordRequest)
        assert.equal(store.authorize(issued.token, "raw_cases.read").sessionId, "operator-null-prototype")
    })

    it("ignores inherited authority at every optional and required record layer", () => {
        const {store} = createFixture()
        const poisoned = {
            actions: ["raw_cases.read"],
            sessionId: "inherited-session",
            expiresInMs: minute,
            scopes: {skillIds: ["skill-inherited"], datasetIds: [], runtimeIds: []},
            budget: {maxRuntimeTurns: 99, maxEvaluations: 99},
            skillIds: ["skill-inherited"],
            datasetIds: ["dataset-inherited"],
            runtimeIds: ["runtime-inherited"],
            maxRuntimeTurns: 99,
            maxEvaluations: 99,
        }
        try {
            for (const [key, value] of Object.entries(poisoned)) {
                Object.defineProperty(Object.prototype, key, {
                    configurable: true,
                    enumerable: false,
                    value,
                })
            }

            captureInvalidRequest(() => store.issue({}))
            const withoutOptionalAuthority = store.issue({
                sessionId: "operator-1",
                actions: ["raw_cases.read"],
                expiresInMs: minute,
            })
            const firstGrant = store.authorize(withoutOptionalAuthority.token, "raw_cases.read")
            assert.deepEqual(firstGrant.scopes, {
                skillIds: [],
                datasetIds: [],
                runtimeIds: [],
                repositoryIds: [],
            })
            assert.deepEqual(firstGrant.budget, {})

            const emptyOwnRecords = store.issue({
                sessionId: "operator-2",
                actions: ["raw_cases.read"],
                scopes: {},
                expiresInMs: minute,
                budget: {},
            })
            const secondGrant = store.authorize(emptyOwnRecords.token, "raw_cases.read")
            assert.deepEqual(secondGrant.scopes, {
                skillIds: [],
                datasetIds: [],
                runtimeIds: [],
                repositoryIds: [],
            })
            assert.deepEqual(secondGrant.budget, {})
        } finally {
            for (const key of Object.keys(poisoned)) delete Object.prototype[key]
        }
    })

    it("rejects accessors without invoking them at any capability record layer", () => {
        const {store} = createFixture()
        let getterCalls = 0
        const topLevel = {
            sessionId: "operator-1",
            scopes: {},
            expiresInMs: minute,
            budget: {},
        }
        Object.defineProperty(topLevel, "actions", {
            enumerable: true,
            get() {
                getterCalls += 1
                return ["raw_cases.read"]
            },
        })
        const scopes = {datasetIds: [], runtimeIds: []}
        Object.defineProperty(scopes, "skillIds", {
            enumerable: true,
            get() {
                getterCalls += 1
                return ["skill-1"]
            },
        })
        const budget = {maxEvaluations: 1}
        Object.defineProperty(budget, "maxRuntimeTurns", {
            enumerable: true,
            get() {
                getterCalls += 1
                return 1
            },
        })

        captureInvalidRequest(() => store.issue(topLevel))
        captureInvalidRequest(() => issueOperator(store, {scopes}))
        captureInvalidRequest(() => issueOperator(store, {budget}))
        assert.equal(getterCalls, 0)
    })

    it("uses one descriptor snapshot and never reads capability fields through Proxy get traps", () => {
        const {store} = createFixture()
        const target = {
            sessionId: "operator-1",
            actions: ["raw_cases.read"],
            scopes: {skillIds: ["skill-1"], datasetIds: [], runtimeIds: []},
            expiresInMs: minute,
            budget: {maxRuntimeTurns: 0, maxEvaluations: 0},
        }
        let getCalls = 0
        const request = new Proxy(target, {
            get(object, key, receiver) {
                getCalls += 1
                if (key === "actions") return ["evaluations.execute"]
                return Reflect.get(object, key, receiver)
            },
        })

        const issued = store.issue(request)
        assert.equal(getCalls, 0)
        assert.equal(store.authorize(issued.token, "raw_cases.read").sessionId, "operator-1")
        assert.throws(
            () => store.authorize(issued.token, "evaluations.execute"),
            /not granted/u,
        )
    })

    it("rejects sparse, accessor-backed, symbol-extended, and hostile Proxy arrays", () => {
        const {store} = createFixture()
        let arrayGetterCalls = 0
        const accessorActions = []
        Object.defineProperty(accessorActions, "0", {
            enumerable: true,
            get() {
                arrayGetterCalls += 1
                return "raw_cases.read"
            },
        })
        const symbolActions = ["raw_cases.read"]
        symbolActions[Symbol("authority")] = "evaluations.execute"
        const throwingActions = new Proxy(["raw_cases.read"], {
            ownKeys() {
                throw new Error("secret array trap")
            },
        })

        for (const actions of [Array(1), accessorActions, symbolActions, throwingActions]) {
            const error = captureInvalidRequest(() => issueOperator(store, {actions}))
            assert.doesNotMatch(error.message, /secret array trap/u)
        }
        assert.equal(arrayGetterCalls, 0)
    })

    it("creates own array elements despite inherited numeric setters", () => {
        const original = Object.getOwnPropertyDescriptor(Array.prototype, "0")
        let issued
        let store
        try {
            Object.defineProperty(Array.prototype, "0", {
                configurable: true,
                set(value) {
                    const replacement = value === "raw_cases.read"
                        ? "evaluations.execute"
                        : value === "skill-2" ? "skill-1" : value
                    Object.defineProperty(this, "0", {
                        configurable: true,
                        enumerable: true,
                        value: replacement,
                        writable: true,
                    })
                },
            })
            ;({store} = createFixture())
            issued = issueOperator(store, {
                actions: ["raw_cases.read"],
                scopes: {
                    skillIds: ["skill-2"],
                    datasetIds: [],
                    runtimeIds: [],
                },
            })
        } finally {
            if (original === undefined) delete Array.prototype["0"]
            else Object.defineProperty(Array.prototype, "0", original)
        }

        const authority = store.authorize(issued.token, "raw_cases.read")
        assert.deepEqual(authority.actions, ["raw_cases.read"])
        assert.deepEqual(authority.scopes.skillIds, ["skill-2"])
        assert.throws(() => store.authorize(issued.token, "evaluations.execute"), /not granted/u)
    })

    it("normalizes throwing and revoked Proxy inputs without leaking trap failures", () => {
        const {store} = createFixture()
        const throwing = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("secret prototype trap")
            },
        })
        const revocable = Proxy.revocable({}, {})
        revocable.revoke()

        for (const request of [throwing, revocable.proxy]) {
            const error = captureInvalidRequest(() => store.issue(request))
            assert.equal(error.code, "INVALID_CAPABILITY_REQUEST")
            assert.doesNotMatch(error.message, /secret|proxy|revoked/iu)
        }
    })

    it("enforces the positive, finite, integral 24-hour lifetime limit", () => {
        const {store} = createFixture()

        assert.equal(
            issueOperator(store, {expiresInMs: MAX_CAPABILITY_LIFETIME_MS}).expiresAt,
            1_800_000_000_000 + MAX_CAPABILITY_LIFETIME_MS,
        )
        for (const expiresInMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, NaN]) {
            assert.throws(
                () => issueOperator(store, {expiresInMs}),
                /expiresInMs/u,
            )
        }
        assert.throws(
            () => issueOperator(store, {expiresInMs: MAX_CAPABILITY_LIFETIME_MS + 1}),
            /24 hours/u,
        )
    })

    it("expires grants at their boundary and sweeps expired records", () => {
        const fixture = createFixture()
        const first = issueOperator(fixture.store, {expiresInMs: 1_000})
        const second = issueOperator(fixture.store, {expiresInMs: 2_000, sessionId: "operator-2"})

        fixture.advance(1_000)
        const error = captureError(
            () => fixture.store.authorize(first.token, "raw_cases.read", "operator-1"),
            /expired/u,
        )
        assert.equal(error.code, "CAPABILITY_EXPIRED")
        assert.equal(fixture.store.sweepExpired(), 1)
        assert.equal(fixture.store.authorize(second.token, "raw_cases.read").sessionId, "operator-2")
        assert.equal(fixture.store.sweepExpired(), 0)
    })

    it("revokes one grant or every grant belonging to one session", () => {
        const {store} = createFixture()
        const first = issueOperator(store)
        const second = issueOperator(store)
        const other = issueOperator(store, {sessionId: "operator-2"})

        assert.equal(store.revoke(first.id), true)
        assert.equal(store.revoke(first.id), false)
        const revoked = captureError(
            () => store.authorize(first.token, "raw_cases.read"),
            /revoked/u,
        )
        assert.equal(revoked.code, "CAPABILITY_REVOKED")

        assert.equal(store.revokeSession("operator-1"), 1)
        assert.throws(() => store.authorize(second.token, "raw_cases.read"), /revoked/u)
        assert.equal(store.authorize(other.token, "raw_cases.read").sessionId, "operator-2")
        assert.equal(store.revokeSession("operator-1"), 0)
    })

    it("returns the same non-secret error for malformed and unknown bearer tokens", () => {
        const {store} = createFixture()
        issueOperator(store)

        for (const token of [null, "", "not-a-token", "a".repeat(43)]) {
            const error = captureError(
                () => store.authorize(token, "raw_cases.read", "operator-1"),
                /not recognized/u,
            )
            assert.equal(error.code, "CAPABILITY_INVALID")
            assert.equal(error.message, "Capability token is not recognized")
            assert.doesNotMatch(error.message, /sha|hash|token=/iu)
        }
    })
})
