const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {formatEvaluationDuration} = require("../renderer/evaluation-format.js")

describe("evaluation duration formatting", () => {
    it("renders milliseconds as minute-second values", () => {
        assert.equal(formatEvaluationDuration(0), "0:00")
        assert.equal(formatEvaluationDuration(999), "0:01")
        assert.equal(formatEvaluationDuration(8_000), "0:08")
        assert.equal(formatEvaluationDuration(65_000), "1:05")
        assert.equal(formatEvaluationDuration(754_000), "12:34")
    })
})
