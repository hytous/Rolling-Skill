const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {after, describe, it} = require("node:test")

const {CodexAppServerClient} = require("../src/codex-app-server.cjs")
const {CodexRuntimeProvider} = require("../src/codex-runtime-provider.cjs")

const descriptor = new CodexRuntimeProvider().discover()[0] ?? null

describe("discovered local Codex app-server smoke", {skip: !descriptor}, () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-"))
    const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-trace-"))
    const client = new CodexAppServerClient({
        binaryPath: descriptor?.executablePath,
        runtimeDescriptor: descriptor,
        traceDirectory,
        workspaceRoot,
    })

    after(async () => {
        await client.stop()
        rmSync(workspaceRoot, {recursive: true, force: true})
        rmSync(traceDirectory, {recursive: true, force: true})
    })

    it("initializes and lists workspace-scoped threads without any web service", async () => {
        const state = await client.start()
        const response = await client.listThreads()
        const skills = await client.listSkills({forceReload: true})

        assert.equal(state.status, "ready")
        assert.equal(state.runtime.runtimeId, descriptor.runtimeId)
        assert.equal(Array.isArray(response.data), true)
        assert.equal(Array.isArray(skills.data), true)
        assert.equal(skills.data.some((entry) => entry.cwd === workspaceRoot), true)
        assert.equal(response.data.every((thread) => thread.cwd === workspaceRoot), true)
        const listRequest = client
            .recentTrace(20)
            .events.find((event) => event.message?.method === "thread/list")
        assert.equal(listRequest.message.params.cwd, workspaceRoot)
    })
})

describe("Codex app-server request construction", () => {
    it("lists the active runtime model catalog", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {data: []}
        }

        await client.listModels()

        assert.deepEqual(request, {
            method: "model/list",
            params: {limit: 100, includeHidden: false},
        })
    })

    it("can override the model and reasoning effort for this turn and subsequent turns", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-1"}}
        }

        await client.startTurn("thread-1", "hello", {
            model: "gpt-5.6-sol",
            effort: "high",
        })

        assert.equal(request.method, "turn/start")
        assert.equal(request.params.threadId, "thread-1")
        assert.equal(request.params.model, "gpt-5.6-sol")
        assert.equal(request.params.effort, "high")
        assert.equal("reasoningEffort" in request.params, false)
    })

    it("allows a read-only subagent thread and a caller-selected model", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {thread: {id: "curator-thread"}}
        }

        await client.startThread({
            sandbox: "read-only",
            threadSource: "subagent",
            model: "gpt-5.6-sol",
        })

        assert.equal(request.method, "thread/start")
        assert.equal(request.params.cwd, "/tmp/workspace")
        assert.equal(request.params.sandbox, "read-only")
        assert.equal(request.params.threadSource, "subagent")
        assert.equal(request.params.model, "gpt-5.6-sol")
    })

    it("archives a Curator thread through the supported protocol method", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {}
        }

        await client.archiveThread("curator-thread")
        assert.deepEqual(request, {
            method: "thread/archive",
            params: {threadId: "curator-thread"},
        })
    })

    it("resumes Curator threads without upgrading their sandbox", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {}
        }

        await client.resumeThread("curator-thread", {
            sandbox: "read-only",
            model: "gpt-5.6-sol",
        })
        assert.equal(request.params.sandbox, "read-only")
        assert.equal(request.params.model, "gpt-5.6-sol")
    })

    it("lists runtime-owned Skills for the active workspace", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {data: []}
        }

        await client.listSkills({forceReload: true})

        assert.deepEqual(request, {
            method: "skills/list",
            params: {cwds: ["/tmp/workspace"], forceReload: true},
        })
    })

    it("uses a structured Skill mention only for explicit diagnostic runs", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-1"}}
        }
        const input = [
            {type: "skill", name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            {type: "text", text: "查一下七月账单", text_elements: []},
        ]

        await client.startTurn("thread-1", input)

        assert.deepEqual(request.params.input, input)
    })

    it("removes its evaluation listener when turn startup fails", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.startThread = async () => ({thread: {id: "evaluation-thread"}})
        client.startTurn = async () => {
            throw new Error("turn startup failed")
        }

        await assert.rejects(
            client.runEvaluationCase({question: "hello"}),
            /turn startup failed/,
        )

        assert.equal(client.listenerCount("notification"), 0)
    })

    it("ends an evaluation immediately when the runtime stops", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.startThread = async () => ({thread: {id: "evaluation-thread"}})
        client.startTurn = async () => ({turn: {id: "evaluation-turn"}})

        const operation = client.runEvaluationCase({question: "hello"})
        await new Promise((resolve) => setImmediate(resolve))
        client.emit("state", {status: "stopped"})

        await assert.rejects(operation, /stopped before completion/)
        assert.equal(client.listenerCount("notification"), 0)
        assert.equal(client.listenerCount("state"), 0)
    })
})
