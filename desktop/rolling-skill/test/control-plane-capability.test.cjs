const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CapabilityStore,
    MAX_CAPABILITY_LIFETIME_MS,
    MAX_SCOPE_IDS,
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

function issueOperator(store, overrides = {}) {
    return store.issue({
        sessionId: "operator-1",
        actions: ["raw_cases.read", "raw_cases.write", "evaluations.read"],
        scopes: {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: [],
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
