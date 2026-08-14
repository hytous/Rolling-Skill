const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    DeepSeekHarnessRuntimeProvider,
    buildDeepSeekHarnessCandidates,
    probeDeepSeekHarnessRuntime,
} = require("../src/deepseek-harness-runtime-provider.cjs")
const {
    DeepSeekHarnessClient,
    decodeModelId,
    encodeModelId,
    threadFromHistory,
} = require("../src/deepseek-harness-client.cjs")

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

function event(type, seq, data) {
    return {event: {type, seq, time: 1_780_000_000_000 + seq, data}}
}

describe("DeepSeek Harness runtime provider", () => {
    it("discovers a compatible local prerelease without claiming native streaming", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-provider-"))
        temporaryDirectories.push(root)
        const binary = executable(join(root, "bin", "dsh"))
        assert.deepEqual(buildDeepSeekHarnessCandidates({
            configuredPath: binary,
            pathValue: "",
            systemCandidates: [],
            userCandidates: [],
        }), [{path: binary, source: "configured"}])

        const provider = new DeepSeekHarnessRuntimeProvider({
            probe: () => ({version: "0.1.0-rc.6", webHost: true}),
        })
        const descriptor = provider.discover({
            configuredPath: binary,
            pathValue: "",
            systemCandidates: [],
            userCandidates: [],
        })[0]

        assert.equal(descriptor.providerId, "deepseek-harness")
        assert.equal(descriptor.transport, "localhost-http-polling")
        assert.equal(descriptor.developerPreview, true)
        assert.equal(descriptor.capabilities.includes("streaming"), false)
        assert.equal(descriptor.capabilities.includes("skills-name-only"), true)
    })

    it("requires the version and compatible web Host flags", () => {
        const calls = []
        const spawnProcess = (_path, args) => {
            calls.push(args)
            if (args[0] === "--version") return {status: 0, stdout: "0.1.0-rc.6\n", stderr: ""}
            return {
                status: 0,
                stdout: "Usage: dsh --profile web --port <port> --trusted-host <authority...>",
                stderr: "",
            }
        }
        assert.deepEqual(probeDeepSeekHarnessRuntime("/bin/dsh", spawnProcess), {
            version: "0.1.0-rc.6",
            webHost: true,
        })
        assert.deepEqual(calls, [["--version"], ["--profile", "web", "--help"]])
        assert.equal(probeDeepSeekHarnessRuntime("/bin/dsh", (_path, args) =>
            args[0] === "--version"
                ? {status: 0, stdout: "other 1.0.0", stderr: ""}
                : {status: 0, stdout: "--port <port> --trusted-host", stderr: ""},
        ), null)
    })
})

describe("DeepSeek Harness session adapter", () => {
    it("uses provider-qualified model ids and preserves reasoning metadata", () => {
        assert.equal(encodeModelId("wetv-glm", "glm-5.3"), "wetv-glm/glm-5.3")
        assert.deepEqual(decodeModelId("deepseek-official/deepseek-v4-pro"), {
            provider: "deepseek-official",
            model: "deepseek-v4-pro",
        })
        assert.throws(() => decodeModelId("glm-5.3"), /provider-qualified/i)
    })

    it("maps persisted messages, reasoning, tools, and failures into Rolling Skill turns", () => {
        const entries = [
            event("turn/start", 0, {turn: 1}),
            event("user/message", 1, {
                id: "user-1",
                role: "user",
                source: {kind: "user"},
                content: [{type: "text", text: "Run the check"}],
            }),
            event("user/message", 2, {
                id: "skill-1",
                role: "user",
                source: {kind: "skill-invocation", name: "billing-cost-management"},
                content: [{type: "text", text: "hidden skill instructions"}],
            }),
            event("tool/call", 3, {
                turn: 1,
                step: 1,
                callId: "call-1",
                name: "bash",
                arguments: JSON.stringify({command: "billing-cli cost query"}),
            }),
            event("tool/result", 4, {
                turn: 1,
                step: 1,
                message: {
                    content: [{type: "tool-result", toolCallId: "call-1", content: [{type: "text", text: "done"}]}],
                },
            }),
            event("assistant/message", 5, {
                turn: 1,
                step: 1,
                message: {
                    id: "assistant-1",
                    content: [
                        {type: "reasoning", text: "Checked the source."},
                        {type: "text", text: "The check passed."},
                    ],
                    source: {kind: "model", provider: "wetv-glm", model: "glm-5.3"},
                },
            }),
            event("turn/end", 6, {turn: 1, reason: {kind: "completed"}}),
        ]
        const thread = threadFromHistory({
            summary: {sessionId: "session-1", updatedAt: 1_780_000_000_100, running: false, cwd: "/workspace"},
            entries,
            workspaceRoot: "/workspace",
        })

        assert.equal(thread.id, "session-1")
        assert.equal(thread.preview, "Run the check")
        assert.equal(thread.turns.length, 1)
        assert.deepEqual(thread.turns[0].items.map((item) => item.type), [
            "userMessage",
            "commandExecution",
            "reasoning",
            "agentMessage",
        ])
        assert.equal(thread.turns[0].items[1].command, "billing-cli cost query")
        assert.equal(thread.turns[0].items[1].status, "completed")
        assert.equal(thread.turns[0].items[3].text, "The check passed.")
    })

    it("starts a managed local Host and speaks the typed HTTP envelope", async () => {
        class FakeChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.killed = false
            }
            kill(signal) {
                this.killed = true
                this.emit("close", signal === "SIGKILL" ? null : 0, signal)
            }
        }
        const child = new FakeChild()
        const calls = []
        const fetchImpl = async (url, options) => {
            const body = JSON.parse(options.body)
            calls.push({url, body})
            const values = {
                "host.describe": {version: "0.0.1", cwd: "/workspace", attachedSessions: 0, canOpenPath: false},
                "llm.models": {groups: [{
                    id: "wetv-glm",
                    name: "GLM",
                    models: [{id: "glm-5.3", name: "GLM-5.3"}],
                }], failures: []},
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    type: "server-response",
                    rpcId: body.rpcId,
                    result: {ok: true, value: values[body.method]},
                }),
            }
        }
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-trace-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            runtimeDescriptor: {runtimeId: "deepseek-harness:test", providerId: "deepseek-harness", version: "0.1.0-rc.6"},
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: (_path, args) => {
                assert.deepEqual(args, ["--profile", "web", "--port", "0"])
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            fetchImpl,
        })

        await client.start()
        const models = await client.listModels()
        assert.equal(client.state().status, "ready")
        assert.equal(models.data[0].id, "wetv-glm/glm-5.3")
        assert.equal(calls[0].url, "http://127.0.0.1:54945/api/host.describe")
        assert.equal(calls[0].body.type, "client-request")
        await client.stop()
        assert.equal(child.killed, true)
    })

    it("keeps the turn watcher alive after cancel so the terminal turn event reaches the UI", async () => {
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-cancel-")),
        })
        temporaryDirectories.push(client.traceDirectory)
        const pending = {stopped: false}
        client.pendingTurns.set("session-1", pending)
        const calls = []
        client.request = async (method, payload) => {
            calls.push({method, payload})
            return {accepted: true}
        }

        await client.interruptTurn("session-1")

        assert.equal(pending.stopped, false)
        assert.deepEqual(calls, [{
            method: "session.cancel",
            payload: {sessionId: "session-1"},
        }])
    })
})
