const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createEvaluationServices} = require("../src/evaluation-services.cjs")

function runtime(runtimeId, executablePath) {
    return {
        runtimeId,
        providerId: runtimeId.split(":")[0],
        displayName: "Runtime",
        version: "1.0.0",
        executablePath,
        source: "test",
        transport: "stdio-jsonl",
        capabilities: [],
        models: [],
        efforts: ["low", "high"],
    }
}

function fixture() {
    const target = runtime("codex:a", "/opt/codex-a")
    const judge = runtime("deepseek-harness:b", "/opt/dsh-b")
    const created = []
    const running = []
    const cancelled = []
    const run = {
        id: "run-1",
        datasetId: "dataset-1",
        status: "queued",
        createdAt: "2026-08-26T00:00:00.000Z",
        results: [],
    }
    const store = {
        getDataset: () => ({
            id: "dataset-1",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
        }),
        createEvaluationRun(input) {
            created.push(structuredClone(input))
            return structuredClone(run)
        },
        listEvaluationRunSummaries: () => [{id: "run-1", status: "running"}],
        getEvaluationRun: () => ({...run, status: "running", results: [{id: "result-1"}]}),
    }
    const runtimeServices = {
        descriptor(id) {
            if (id === target.runtimeId) return structuredClone(target)
            if (id === judge.runtimeId) return structuredClone(judge)
            throw new Error("Runtime is no longer available")
        },
    }
    const runner = {
        run(value) {
            running.push(structuredClone(value))
            return Promise.resolve({id: value.id, status: "completed"})
        },
        async cancel(id) {
            cancelled.push(id)
            return {...run, status: "cancelled"}
        },
    }
    const services = createEvaluationServices({
        store,
        runtimeServices,
        runner,
        snapshotSkill: () => ({schemaVersion: "evidence/v1", digest: "sha256:test"}),
    })
    return {services, created, running, cancelled}
}

describe("Rolling Skill evaluation services", () => {
    it("resolves Host-owned Runtime descriptors and starts one evaluation", async () => {
        const test = fixture()
        const started = await test.services.start({
            datasetId: "dataset-1",
            caseIds: [],
            selectionMode: "dataset",
            activationMode: "explicit",
            targets: [{runtimeId: "codex:a", modelId: "gpt-5.6", effort: "high"}],
            judge: {runtimeId: "deepseek-harness:b", modelId: "deepseek-chat", effort: "low"},
        })

        assert.equal(started.id, "run-1")
        assert.equal(test.created[0].runtimeConfigurations[0].executablePath, "/opt/codex-a")
        assert.equal(test.created[0].runtimeConfigurations[0].modelId, "gpt-5.6")
        assert.equal(test.created[0].judgeConfiguration.executablePath, "/opt/dsh-b")
        assert.equal(test.created[0].skillEvidence.digest, "sha256:test")
        assert.equal(test.running.length, 1)
    })

    it("lists summaries, returns completed detail, and cancels through the runner", async () => {
        const test = fixture()
        assert.deepEqual(test.services.list({datasetId: "dataset-1"}), [{id: "run-1", status: "running"}])
        assert.equal(test.services.get({runId: "run-1"}).results[0].id, "result-1")
        assert.equal((await test.services.cancel({runId: "run-1"})).status, "cancelled")
        assert.deepEqual(test.cancelled, ["run-1"])
    })
})
