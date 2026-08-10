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
