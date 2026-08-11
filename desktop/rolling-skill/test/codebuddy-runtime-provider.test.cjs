const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    CodeBuddyRuntimeProvider,
    buildCodeBuddyCandidates,
    probeCodeBuddyRuntime,
} = require("../src/codebuddy-runtime-provider.cjs")
const {CodeBuddyAcpClient} = require("../src/codebuddy-acp-client.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function executable(path) {
    mkdirSync(require("node:path").dirname(path), {recursive: true})
    writeFileSync(path, "#!/bin/sh\n", {mode: 0o755})
    chmodSync(path, 0o755)
    return path
}

describe("CodeBuddy runtime provider", () => {
    it("discovers compatible ACP executables without claiming path-precise Skill inventory", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-codebuddy-"))
        temporaryDirectories.push(root)
        const binary = executable(join(root, "bin", "codebuddy"))
        const candidates = buildCodeBuddyCandidates({
            configuredPath: binary,
            pathValue: "",
            systemCandidates: [],
            userCandidates: [],
            sreCandidates: [],
        })
        assert.deepEqual(candidates, [{path: binary, source: "configured"}])

        const provider = new CodeBuddyRuntimeProvider({
            probe: () => ({
                version: "2.133.1",
                acp: true,
                models: ["default-model", "gpt-5.5"],
                efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
            }),
        })
        const descriptor = provider.discover({
            configuredPath: binary,
            pathValue: "",
            systemCandidates: [],
            userCandidates: [],
            sreCandidates: [],
        })[0]

        assert.equal(descriptor.providerId, "codebuddy")
        assert.equal(descriptor.transport, "acp-stdio-jsonl")
        assert.equal(descriptor.capabilities.includes("skills"), false)
        assert.deepEqual(descriptor.models, ["default-model", "gpt-5.5"])
    })

    it("requires both a CodeBuddy version and ACP support", () => {
        const spawnProcess = (_path, args) => {
            if (args[0] === "--version") return {status: 0, stdout: "2.133.1\n", stderr: ""}
            return {
                status: 0,
                stdout: "--acp Start ACP --acp-transport stdio --model <model> (default-model, gpt-5.5) --effort <level>",
                stderr: "",
            }
        }
        const result = probeCodeBuddyRuntime("/bin/codebuddy", spawnProcess)
        assert.equal(result.version, "2.133.1")
        assert.equal(result.acp, true)
        assert.deepEqual(result.models, ["default-model", "gpt-5.5"])
    })
})

describe("CodeBuddy ACP client", () => {
    it("uses native ACP model and thought_level configuration", async () => {
        const writes = []
        class FakeChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.stdin = {writable: true, write: (value) => writes.push(JSON.parse(value))}
            }
            kill() {
                this.emit("close", 0, null)
            }
        }
        const child = new FakeChild()
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-codebuddy-trace-")),
            spawnProcess: (_path, args) => {
                assert.deepEqual(args, ["--acp", "--acp-transport", "stdio", "--permission-mode", "dontAsk"])
                return child
            },
        })

        const started = client.start()
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 1, result: {protocolVersion: 1}})}\n`)
        await started

        const threadPromise = client.startThread({model: "gpt-5.5", effort: "xhigh"})
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 2, result: {sessionId: "session-1", models: {availableModels: []}}})}\n`)
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 3, result: {}})}\n`)
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 4, result: {configOptions: []}})}\n`)
        const thread = await threadPromise

        assert.equal(thread.thread.id, "session-1")
        assert.deepEqual(writes.slice(1).map((entry) => [entry.method, entry.params]), [
            ["session/new", {cwd: "/workspace", mcpServers: []}],
            ["session/set_model", {sessionId: "session-1", modelId: "gpt-5.5"}],
            ["session/set_config_option", {sessionId: "session-1", configId: "thought_level", value: "xhigh"}],
        ])
        await client.stop()
    })

    it("removes its evaluation listener when turn startup fails", async () => {
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
        })
        client.startThread = async () => ({thread: {id: "evaluation-session"}})
        client.startTurn = async () => {
            throw new Error("turn startup failed")
        }

        await assert.rejects(
            client.runEvaluationCase({question: "hello"}),
            /turn startup failed/,
        )

        assert.equal(client.listenerCount("notification"), 0)
    })
})
