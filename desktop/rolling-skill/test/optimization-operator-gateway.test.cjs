"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    OptimizationOperatorGateway,
} = require("../src/optimization/optimization-operator-gateway.cjs")

async function remainsPending(promise) {
    return Promise.race([
        promise.then(() => false, () => false),
        new Promise((resolve) => setImmediate(() => resolve(true))),
    ])
}

describe("Optimization Operator submit gateway", () => {
    it("expires an unanswered Agent request instead of leaving the run editing forever", async () => {
        const gateway = new OptimizationOperatorGateway()
        const pending = gateway.requestCandidate({run: {runId: "timed-run"}, epoch: 1, operatorSessionId: "session-1", timeoutMs: 10})
        await assert.rejects(pending, /time budget/)
        assert.equal(gateway.pending("timed-run"), null)
    })

    it("accepts a Candidate only from the current Runner Operator session", async () => {
        const gateway = new OptimizationOperatorGateway()
        const requested = gateway.requestCandidate({
            run: {runId: "run-1"},
            epoch: 1,
            operatorSessionId: "operator-session-1",
        })

        assert.deepEqual(gateway.pending("run-1"), {
            runId: "run-1",
            kind: "candidate",
            epoch: 1,
            operatorSessionId: "operator-session-1",
        })
        assert.throws(() => gateway.submitCandidate({
            runId: "run-1",
            operatorSessionId: "operator-session-other",
            message: "forged",
        }), /session|current Operator/iu)
        assert.equal(await remainsPending(requested), true)

        assert.deepEqual(gateway.submitCandidate({
            runId: "run-1",
            operatorSessionId: "operator-session-1",
            message: "Improve billing drilldown",
        }), {runId: "run-1", kind: "candidate"})
        assert.deepEqual(await requested, {message: "Improve billing drilldown"})
        assert.equal(gateway.pending("run-1"), null)
        assert.throws(() => gateway.submitCandidate({
            runId: "run-1",
            operatorSessionId: "operator-session-1",
            message: "duplicate",
        }), /pending|current/iu)
    })

    it("passes a typed decision and optional limit request to the waiting Runner", async () => {
        const gateway = new OptimizationOperatorGateway()
        const requested = gateway.requestDecision({
            run: {runId: "run-2"},
            epoch: 2,
            operatorSessionId: "operator-session-2",
        })
        const decision = {
            schemaVersion: "rolling-skill-optimization-decision/v1",
            action: "continue",
            rationale: "One broad regression remains",
            observations: [],
        }
        const limitRequest = {field: "maxEpochs", value: 4, rationale: "Need one repair Epoch"}

        assert.throws(() => gateway.submitCandidate({
            runId: "run-2",
            operatorSessionId: "operator-session-2",
            message: "wrong phase",
        }), /decision|phase|pending/iu)
        assert.deepEqual(gateway.submitDecision({
            runId: "run-2",
            operatorSessionId: "operator-session-2",
            decision,
            limitRequest,
        }), {runId: "run-2", kind: "decision"})
        assert.deepEqual(await requested, {decision, limitRequest})
    })

    it("allows only one pending request per Run and cancels pending waits at shutdown", async () => {
        const gateway = new OptimizationOperatorGateway()
        const first = gateway.requestCandidate({
            run: {runId: "run-3"},
            epoch: 1,
            operatorSessionId: "operator-session-3",
        })
        assert.throws(() => gateway.requestDecision({
            run: {runId: "run-3"},
            epoch: 1,
            operatorSessionId: "operator-session-3",
        }), /pending/iu)

        gateway.cancelAll("Application shutdown")
        await assert.rejects(first, /Application shutdown/u)
        assert.equal(gateway.pending("run-3"), null)
    })

    it("notifies the bound Operator only after the pending request is registered", async () => {
        const notifications = []
        let gateway
        gateway = new OptimizationOperatorGateway({
            async onRequest(request) {
                notifications.push(request)
                assert.equal(gateway.pending(request.runId)?.kind, request.kind)
            },
        })
        const requested = gateway.requestCandidate({
            run: {runId: "run-4"},
            epoch: 1,
            operatorSessionId: "operator-session-4",
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(notifications, [{
            runId: "run-4",
            kind: "candidate",
            epoch: 1,
            operatorSessionId: "operator-session-4",
        }])
        gateway.submitCandidate({
            runId: "run-4",
            operatorSessionId: "operator-session-4",
            message: "Candidate after wakeup",
        })
        assert.deepEqual(await requested, {message: "Candidate after wakeup"})
    })
})
