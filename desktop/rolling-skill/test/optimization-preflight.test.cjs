const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    assertOptimizationTelemetrySupport,
} = require("../src/optimization/optimization-preflight.cjs")

describe("Optimization preflight compatibility", () => {
    const runtimes = [{runtimeId: "runtime-1", capabilities: []}]

    it("accepts an Epoch-only v2 config without telemetry", () => {
        assert.doesNotThrow(() => assertOptimizationTelemetrySupport({
            limits: {maxEpochs: 5},
        }, runtimes))
    })

    it("keeps legacy token and cost capability checks", () => {
        assert.throws(() => assertOptimizationTelemetrySupport({
            telemetry: {tokens: true, cost: false},
        }, runtimes), /token telemetry is unavailable/i)
        assert.throws(() => assertOptimizationTelemetrySupport({
            telemetry: {tokens: false, cost: true},
        }, runtimes), /cost telemetry is unavailable/i)
    })
})
