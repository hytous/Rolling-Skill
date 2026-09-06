const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    evaluationTimeoutMs,
} = require("../src/evaluation-timeout.cjs")

describe("evaluation timeout policy", () => {
    it("does not impose a deadline when no timeout was explicitly requested", () => {
        assert.equal(evaluationTimeoutMs({}), null)
        assert.equal(evaluationTimeoutMs({timeoutMs: null}), null)
    })

    it("preserves an explicit timeout for focused tests and callers that need one", () => {
        assert.equal(evaluationTimeoutMs({timeoutMs: 5}), 5)
        assert.throws(
            () => evaluationTimeoutMs({timeoutMs: 0}),
            /positive finite number/,
        )
    })
})
