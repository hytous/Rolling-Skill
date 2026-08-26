const assert = require("node:assert/strict")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const {pathToFileURL} = require("node:url")

const source = pathToFileURL(join(__dirname, "../src/host/tools.js"))

async function fixture() {
    const {registerRollingSkillTools} = await import(`${source.href}?test=${Date.now()}-${Math.random()}`)
    const definitions = new Map()
    const disposed = []
    const calls = []
    const shared = {counts: {datasets: 2}}
    const application = {
        async dispatch(method, input) {
            calls.push([method, structuredClone(input)])
            if (method === "dashboard.get") return shared
            if (method === "rawCases.add") return {id: "raw-1", ...input}
            if (method === "evaluations.start") return {id: "evaluation-1", status: "queued"}
            if (method === "automatic.runOnce") return {slot: "manual", status: "completed"}
            throw new Error(`Unknown method from /workspace/private: ${method} TOKEN=secret`)
        },
    }
    const dispose = registerRollingSkillTools({tools: {
        register(definition) {
            definitions.set(definition.name, definition)
            return () => disposed.push(definition.name)
        },
    }}, application)
    return {application, calls, definitions, dispose, disposed, shared}
}

function execution(signal = new AbortController().signal) {
    return {signal, deferContext() {}}
}

describe("Rolling Skill DSH tools", () => {
    it("registers the exact trusted tool catalog with closed parameter schemas", async () => {
        const {definitions, dispose, disposed} = await fixture()
        assert.deepEqual([...definitions.keys()], [
            "rolling_skill_status",
            "rolling_skill_add_raw_case",
            "rolling_skill_start_evaluation",
            "rolling_skill_run_capture",
        ])
        for (const definition of definitions.values()) {
            assert.equal(definition.parameters.type, "object")
            assert.equal(definition.parameters.additionalProperties, false)
            assert.equal(typeof definition.output.render, "function")
        }
        dispose()
        assert.deepEqual(disposed.sort(), [...definitions.keys()].sort())
    })

    it("returns detached JSON values and concise rendered text", async () => {
        const {definitions, shared} = await fixture()
        const tool = definitions.get("rolling_skill_status")
        const value = await tool.execute({}, execution())
        value.counts.datasets = 99
        assert.equal(shared.counts.datasets, 2)
        assert.match(tool.output.render({}, value)[0].text, /Rolling Skill/u)
        await assert.rejects(() => tool.execute({unexpected: true}, execution()), /unknown field|invalid arguments/iu)
    })

    it("delegates mutations to Core with generated idempotency and frozen Runtime identity", async () => {
        const {calls, definitions} = await fixture()
        await definitions.get("rolling_skill_add_raw_case").execute({
            question: "How should this Case be refreshed?",
            skillName: "rolling-skill",
        }, execution())
        await definitions.get("rolling_skill_start_evaluation").execute({
            datasetId: "dataset-1",
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
        }, execution())
        await definitions.get("rolling_skill_run_capture").execute({}, execution())
        assert.deepEqual(calls.map(([method]) => method), [
            "rawCases.add",
            "evaluations.start",
            "automatic.runOnce",
        ])
        assert.equal(calls[1][1].targets[0].runtimeId, "codex:one")
        assert.equal(calls[1][1].judge.runtimeId, "codex:one")
        assert.match(calls[1][1].idempotencyKey, /^dsh-tool-/u)
    })

    it("honors cancellation before writes and sanitizes thrown errors", async () => {
        const {calls, definitions} = await fixture()
        const controller = new AbortController()
        controller.abort()
        await assert.rejects(
            () => definitions.get("rolling_skill_add_raw_case").execute({question: "Cancelled"}, execution(controller.signal)),
            /cancelled|aborted/iu,
        )
        assert.equal(calls.length, 0)
        const broken = definitions.get("rolling_skill_status")
        await assert.rejects(
            () => broken.execute({forceError: true}, execution()),
            /unknown field|invalid arguments/iu,
        )
        assert.doesNotMatch(JSON.stringify([...definitions.values()].map((item) => item.description)), /credential|token=/iu)
    })
})
