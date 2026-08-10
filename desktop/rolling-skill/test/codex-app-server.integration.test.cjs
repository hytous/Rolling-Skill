const assert = require("node:assert/strict")
const {accessSync, constants, mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {after, describe, it} = require("node:test")

const {CodexAppServerClient} = require("../src/codex-app-server.cjs")

const binaryPath = join(
    __dirname,
    "..",
    "node_modules",
    "@openai",
    "codex-darwin-arm64",
    "vendor",
    "aarch64-apple-darwin",
    "bin",
    "codex",
)

function runtimeAvailable() {
    try {
        accessSync(binaryPath, constants.X_OK)
        return process.platform === "darwin" && process.arch === "arm64"
    } catch {
        return false
    }
}

describe("packaged Codex app-server smoke", {skip: !runtimeAvailable()}, () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-"))
    const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-trace-"))
    const client = new CodexAppServerClient({binaryPath, traceDirectory, workspaceRoot})

    after(async () => {
        await client.stop()
        rmSync(workspaceRoot, {recursive: true, force: true})
        rmSync(traceDirectory, {recursive: true, force: true})
    })

    it("initializes and lists workspace-scoped threads without any web service", async () => {
        const state = await client.start()
        const response = await client.listThreads()

        assert.equal(state.status, "ready")
        assert.equal(Array.isArray(response.data), true)
        assert.equal(response.data.every((thread) => thread.cwd === workspaceRoot), true)
        const listRequest = client
            .recentTrace(20)
            .events.find((event) => event.message?.method === "thread/list")
        assert.equal(listRequest.message.params.cwd, workspaceRoot)
    })
})
