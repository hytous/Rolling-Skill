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

        assert.equal(state.status, "ready")
        assert.equal(state.runtime.runtimeId, descriptor.runtimeId)
        assert.equal(Array.isArray(response.data), true)
        assert.equal(response.data.every((thread) => thread.cwd === workspaceRoot), true)
        const listRequest = client
            .recentTrace(20)
            .events.find((event) => event.message?.method === "thread/list")
        assert.equal(listRequest.message.params.cwd, workspaceRoot)
    })
})

describe("Codex app-server request construction", () => {
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
})
