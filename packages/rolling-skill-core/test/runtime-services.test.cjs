const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createRuntimeServices} = require("../src/runtime-services.cjs")

function descriptor(providerId, name, version, executablePath) {
    return {
        runtimeId: `${providerId}:${executablePath}`,
        providerId,
        displayName: name,
        version,
        executablePath,
        source: "test",
        transport: "stdio-jsonl",
        capabilities: ["models"],
        models: [],
        efforts: ["low", "high"],
    }
}

describe("Rolling Skill Runtime services", () => {
    it("keeps every installed executable distinct with a full public label", () => {
        const runtimes = [
            descriptor("codex", "Codex", "1.2.3", "/opt/codex-a/bin/codex"),
            descriptor("codex", "Codex", "1.4.0", "/opt/codex-b/bin/codex"),
            descriptor("codebuddy", "CodeBuddy", "2.0.0", "/opt/codebuddy"),
            descriptor("deepseek-harness", "DeepSeek Harness", "0.1.1-rc.1", "/opt/dsh"),
        ]
        const services = createRuntimeServices({
            registry: {discover: () => ({available: runtimes, selected: runtimes[0]})},
        })

        const listed = services.list()
        assert.deepEqual(listed.map((entry) => entry.runtimeId), runtimes.map((entry) => entry.runtimeId))
        assert.equal(listed[0].label, "Codex 1.2.3 · /opt/codex-a/bin/codex")
        assert.equal(listed[1].label, "Codex 1.4.0 · /opt/codex-b/bin/codex")
        assert.equal(listed[3].executablePath, "/opt/dsh")
    })

    it("loads models from the exact selected Runtime and stops temporary clients", async () => {
        const selected = descriptor("codex", "Codex", "1.2.3", "/opt/codex")
        const calls = []
        const services = createRuntimeServices({
            registry: {
                discover: () => ({available: [selected], selected}),
                createClient(runtime, options) {
                    calls.push({type: "create", runtime, options})
                    return {
                        start: async () => calls.push({type: "start"}),
                        listModels: async () => ({data: [{id: "gpt-5.6", displayName: "GPT-5.6"}]}),
                        stop: async () => calls.push({type: "stop"}),
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        assert.deepEqual(await services.models(selected.runtimeId), [{id: "gpt-5.6", displayName: "GPT-5.6"}])
        assert.equal(calls[0].runtime.executablePath, "/opt/codex")
        assert.equal(calls[0].options.workspaceRoot, "/workspace")
        assert.deepEqual(calls.slice(1), [{type: "start"}, {type: "stop"}])
        assert.throws(() => services.descriptor("missing"), /no longer available/u)
    })
})
