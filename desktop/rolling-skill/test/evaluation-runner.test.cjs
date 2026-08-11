const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {EvaluationRunner} = require("../src/evaluation-runner.cjs")

describe("multi-runtime evaluation runner", () => {
    it("runs runtime queues concurrently and Cases sequentially within a runtime", async () => {
        const events = []
        const resolvers = new Map()
        const store = {
            updateEvaluationRun: (_runId, patch) => events.push(["run", patch.status]),
            updateEvaluationResult: (_runId, resultId, patch) => events.push([resultId, patch.status]),
        }
        const clients = new Map()
        const makeClient = (runtimeId) => ({
            async start() {
                events.push([runtimeId, "start"])
            },
            runEvaluationCase({question}) {
                events.push([runtimeId, `case:${question}`])
                return new Promise((resolve) => resolvers.set(`${runtimeId}:${question}`, resolve))
            },
            async stop() {
                events.push([runtimeId, "stop"])
            },
        })
        const registry = {
            createClient(descriptor) {
                const client = makeClient(descriptor.runtimeId)
                clients.set(descriptor.runtimeId, client)
                return client
            },
        }
        const runner = new EvaluationRunner({store, runtimeRegistry: registry, workspaceRoot: "/workspace", traceDirectory: "/traces"})
        const run = {
            id: "run-1",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", executablePath: "/a"},
                {runtimeId: "codebuddy:b", providerId: "codebuddy", executablePath: "/b"},
            ],
            results: [
                {id: "a1", caseSnapshot: {question: "q1"}, runtimeConfiguration: {runtimeId: "codex:a"}},
                {id: "a2", caseSnapshot: {question: "q2"}, runtimeConfiguration: {runtimeId: "codex:a"}},
                {id: "b1", caseSnapshot: {question: "q1"}, runtimeConfiguration: {runtimeId: "codebuddy:b"}},
                {id: "b2", caseSnapshot: {question: "q2"}, runtimeConfiguration: {runtimeId: "codebuddy:b"}},
            ],
        }

        const running = runner.run(run)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(resolvers.has("codex:a:q1"), true)
        assert.equal(resolvers.has("codebuddy:b:q1"), true)
        assert.equal(resolvers.has("codex:a:q2"), false)
        assert.equal(resolvers.has("codebuddy:b:q2"), false)

        resolvers.get("codex:a:q1")({response: "a1", durationMs: 10})
        resolvers.get("codebuddy:b:q1")({response: "b1", durationMs: 11})
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(resolvers.has("codex:a:q2"), true)
        assert.equal(resolvers.has("codebuddy:b:q2"), true)
        resolvers.get("codex:a:q2")({response: "a2", durationMs: 12})
        resolvers.get("codebuddy:b:q2")({response: "b2", durationMs: 13})

        const completed = await running
        assert.equal(completed.status, "completed")
        assert.equal(events.some(([id, status]) => id === "run" && status === "completed"), true)
    })

    it("stops every isolated runtime client during application shutdown", async () => {
        let releaseStart
        let stopCount = 0
        const client = {
            start: () => new Promise((resolve) => {
                releaseStart = resolve
            }),
            async stop() {
                stopCount += 1
                releaseStart?.()
            },
        }
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {createClient: () => client},
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-shutdown",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", executablePath: "/a"},
            ],
            results: [],
        }

        const running = runner.run(run)
        await new Promise((resolve) => setImmediate(resolve))
        await runner.stopAll()

        assert.equal(stopCount, 1)
        await running
    })
})
