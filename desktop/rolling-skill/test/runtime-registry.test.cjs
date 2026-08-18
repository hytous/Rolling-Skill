const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {RuntimeRegistry} = require("../src/runtime-registry.cjs")

function descriptor(providerId, suffix) {
    return {
        runtimeId: `${providerId}:${suffix}`,
        providerId,
        displayName: providerId.toUpperCase(),
        version: suffix,
        executablePath: `/runtime/${providerId}/${suffix}`,
        source: "test",
        transport: "stdio-jsonl",
        capabilities: [],
    }
}

describe("agent runtime registry", () => {
    it("keeps the application usable when no compatible runtime is discovered", () => {
        const provider = {id: "alpha", discover: () => [], createClient: () => {}}
        const registry = new RuntimeRegistry([provider])

        assert.deepEqual(registry.discover(), {available: [], selected: null})
    })

    it("discovers compatible descriptors from every registered provider", () => {
        const received = []
        const alpha = {
            id: "alpha",
            discover: (options) => {
                received.push({providerId: "alpha", options})
                return [descriptor("alpha", options.version)]
            },
            createClient: () => {},
        }
        const beta = {
            id: "beta",
            discover: (options) => {
                received.push({providerId: "beta", options})
                return [descriptor("beta", "2"), descriptor("beta", "3")]
            },
            createClient: () => {},
        }
        const registry = new RuntimeRegistry([alpha, beta])

        const result = registry.discover({
            commonProviderOptions: {configuredPath: "/runtime/manual"},
            providerOptions: {alpha: {version: "1"}},
        })

        assert.deepEqual(
            result.available.map((runtime) => runtime.runtimeId),
            ["alpha:1", "beta:2", "beta:3"],
        )
        assert.equal(result.selected.runtimeId, "alpha:1")
        assert.deepEqual(received, [
            {
                providerId: "alpha",
                options: {configuredPath: "/runtime/manual", version: "1"},
            },
            {providerId: "beta", options: {configuredPath: "/runtime/manual"}},
        ])
    })

    it("selects a saved runtime by id or executable path", () => {
        const runtimes = [descriptor("alpha", "1"), descriptor("alpha", "2")]
        const provider = {id: "alpha", discover: () => runtimes, createClient: () => {}}
        const registry = new RuntimeRegistry([provider])

        assert.equal(
            registry.discover({preferredRuntime: {runtimeId: "alpha:2"}}).selected.runtimeId,
            "alpha:2",
        )
        assert.equal(
            registry.discover({
                preferredRuntime: {executablePath: "/runtime/alpha/2"},
            }).selected.runtimeId,
            "alpha:2",
        )
    })

    it("delegates client creation to the descriptor provider", () => {
        const selected = descriptor("alpha", "1")
        const expected = {kind: "client"}
        const calls = []
        const provider = {
            id: "alpha",
            discover: () => [selected],
            createClient: (runtime, options) => {
                calls.push({runtime, options})
                return expected
            },
        }
        const registry = new RuntimeRegistry([provider])

        const client = registry.createClient(selected, {workspaceRoot: "/workspace"})

        assert.equal(client, expected)
        assert.deepEqual(calls, [{runtime: selected, options: {workspaceRoot: "/workspace"}}])
    })

    it("rejects duplicate providers and unknown descriptors", () => {
        const provider = {id: "alpha", discover: () => [], createClient: () => {}}
        assert.throws(() => new RuntimeRegistry([provider, provider]), /duplicate/i)
        const registry = new RuntimeRegistry([provider])
        assert.throws(() => registry.createClient(descriptor("missing", "1"), {}), /provider/i)
    })
})
