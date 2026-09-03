"use strict"

function assertOptimizationTelemetrySupport(config = {}, runtimes = []) {
    const telemetry = config?.telemetry
    if (!telemetry) return

    const allSupport = (capability) => runtimes.every((runtime) => (
        Array.isArray(runtime.capabilities) && runtime.capabilities.includes(capability)
    ))
    if (telemetry.tokens && !allSupport("token-usage")) {
        throw new Error("Optimization token telemetry is unavailable on one or more Runtimes")
    }
    if (telemetry.cost && !allSupport("cost-usage")) {
        throw new Error("Optimization cost telemetry is unavailable on one or more Runtimes")
    }
}

module.exports = {assertOptimizationTelemetrySupport}
