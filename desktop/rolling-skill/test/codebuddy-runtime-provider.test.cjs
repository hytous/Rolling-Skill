const assert = require("node:assert/strict")
const {spawnSync} = require("node:child_process")
const {EventEmitter} = require("node:events")
const {chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    CodeBuddyRuntimeProvider,
    buildCodeBuddyCandidates,
    parsePermissionModes,
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
                stdout: '--acp Start ACP --acp-transport stdio --model <model> (default-model, gpt-5.5) --effort <level>\n--permission-mode <mode> (choices: "acceptEdits", "bypassPermissions", "default", "plan", "dontAsk", "auto")',
                stderr: "",
            }
        }
        const result = probeCodeBuddyRuntime("/bin/codebuddy", spawnProcess)
        assert.equal(result.version, "2.133.1")
        assert.equal(result.acp, true)
        assert.deepEqual(result.models, ["default-model", "gpt-5.5"])
        assert.deepEqual(result.permissionModes, [
            "acceptEdits",
            "bypassPermissions",
            "default",
            "plan",
            "dontAsk",
            "auto",
        ])
        assert.deepEqual(parsePermissionModes("no permission choices"), [])
    })

    it("probes env-node installations when the parent PATH is Finder-like", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-codebuddy-finder-path-"))
        temporaryDirectories.push(root)
        const bin = join(root, "bin")
        mkdirSync(bin, {recursive: true})
        symlinkSync(process.execPath, join(bin, "node"))
        const binary = join(bin, "codebuddy")
        writeFileSync(
            binary,
            `#!/usr/bin/env node
const argument = process.argv[2]
if (argument === "--version") console.log("2.133.1")
else if (argument === "--help") console.log("--acp Start ACP --acp-transport stdio")
else process.exitCode = 1
`,
            {mode: 0o755},
        )

        const originalPath = process.env.PATH
        try {
            process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin"
            const result = probeCodeBuddyRuntime(binary, spawnSync)

            assert.equal(result.version, "2.133.1")
            assert.equal(result.acp, true)
        } finally {
            process.env.PATH = originalPath
        }
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
                assert.deepEqual(args, ["--acp", "--acp-transport", "stdio", "--permission-mode", "auto"])
                return child
            },
        })

        const started = client.start()
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 1, result: {protocolVersion: 1}})}\n`)
        await started

        const threadPromise = client.startThread({
            model: "gpt-5.5",
            effort: "xhigh",
            permissionMode: "fullAccess",
        })
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 2, result: {
            sessionId: "session-1",
            models: {availableModels: []},
            modes: {
                currentModeId: "auto",
                availableModes: [
                    {id: "auto", name: "Auto"},
                    {id: "bypassPermissions", name: "Bypass permissions"},
                    {id: "fullAccess", name: "Full access"},
                ],
            },
        }})}\n`)
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 3, result: {}})}\n`)
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 4, result: {}})}\n`)
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 5, result: {configOptions: []}})}\n`)
        const thread = await threadPromise

        assert.equal(thread.thread.id, "session-1")
        assert.deepEqual(writes.slice(1).map((entry) => [entry.method, entry.params]), [
            ["session/new", {cwd: "/workspace", mcpServers: []}],
            ["session/set_mode", {sessionId: "session-1", modeId: "fullAccess"}],
            ["session/set_model", {sessionId: "session-1", modelId: "gpt-5.5"}],
            ["session/set_config_option", {sessionId: "session-1", configId: "thought_level", value: "xhigh"}],
        ])
        await client.stop()
    })

    it("rejects an unavailable permission mode before sending a prompt", async () => {
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
        })
        client.sessionModes.set("session-1", new Set(["auto", "plan"]))

        await assert.rejects(
            client.configureSession("session-1", {permissionMode: "bypassPermissions"}),
            /does not support permission mode bypassPermissions/,
        )
    })

    it("routes ACP permission requests to the client and returns the selected option", async () => {
        const writes = []
        const child = new EventEmitter()
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.stdin = {writable: true, write: (value) => writes.push(JSON.parse(value))}
        child.kill = () => child.emit("close", 0, null)
        const permissionRequests = []
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-codebuddy-permission-")),
            spawnProcess: () => child,
            requestPermission: async (request) => {
                permissionRequests.push(request)
                return "allow"
            },
        })

        const started = client.start()
        await new Promise((resolve) => setImmediate(resolve))
        child.stdout.emit("data", `${JSON.stringify({jsonrpc: "2.0", id: 1, result: {}})}\n`)
        await started
        child.stdout.emit(
            "data",
            `${JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "session/request_permission",
                params: {
                    sessionId: "session-1",
                    toolCall: {title: "Bash", rawInput: {command: "npm test"}},
                    options: [
                        {optionId: "allow", name: "Allow once"},
                        {optionId: "reject", name: "Deny"},
                    ],
                },
            })}\n`,
        )
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(permissionRequests.length, 1)
        assert.equal(permissionRequests[0].params.toolCall.title, "Bash")
        assert.deepEqual(writes.at(-1), {
            jsonrpc: "2.0",
            id: 1,
            result: {outcome: {outcome: "selected", optionId: "allow"}},
        })
        await client.stop()
    })

    it("cancels safely when a permission request has no explicit rejection option", async () => {
        const writes = []
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            requestPermission: async () => {
                throw new Error("dialog unavailable")
            },
        })
        client.child = {stdin: {writable: true, write: (value) => writes.push(JSON.parse(value))}}

        await client.handlePermissionRequest({
            jsonrpc: "2.0",
            id: 9,
            method: "session/request_permission",
            params: {
                sessionId: "session-1",
                options: [{optionId: "allow", name: "Allow once", kind: "allow_once"}],
            },
        })

        assert.equal(writes.length, 1)
        assert.equal(writes[0].id, 9)
        assert.deepEqual(writes[0].result, {outcome: {outcome: "cancelled"}})
    })

    it("cancels pending approvals before interrupting a session and ignores the late dialog result", async () => {
        const writes = []
        let finishDialog
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            requestPermission: () => new Promise((resolve) => {
                finishDialog = resolve
            }),
        })
        client.processEpoch = 1
        client.child = {stdin: {writable: true, write: (value) => writes.push(JSON.parse(value))}}
        const pending = client.handlePermissionRequest({
            jsonrpc: "2.0",
            id: 7,
            method: "session/request_permission",
            params: {
                sessionId: "session-1",
                options: [
                    {kind: "allow_once", optionId: "allow", name: "Allow"},
                    {kind: "reject_once", optionId: "reject", name: "Reject"},
                ],
            },
        }, {sourceChild: client.child, processEpoch: 1})
        await new Promise((resolve) => setImmediate(resolve))

        await client.interruptTurn("session-1")
        finishDialog("allow")
        await pending

        assert.deepEqual(writes, [
            {jsonrpc: "2.0", id: 7, result: {outcome: {outcome: "cancelled"}}},
            {jsonrpc: "2.0", method: "session/cancel", params: {sessionId: "session-1"}},
        ])
    })

    it("never writes an old approval result into a restarted ACP process", async () => {
        const oldWrites = []
        const newWrites = []
        let finishDialog
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            requestPermission: () => new Promise((resolve) => {
                finishDialog = resolve
            }),
        })
        const oldChild = {stdin: {writable: true, write: (value) => oldWrites.push(JSON.parse(value))}}
        const newChild = {stdin: {writable: true, write: (value) => newWrites.push(JSON.parse(value))}}
        client.processEpoch = 3
        client.child = oldChild
        const pending = client.handlePermissionRequest({
            jsonrpc: "2.0",
            id: 4,
            method: "session/request_permission",
            params: {
                sessionId: "session-1",
                options: [
                    {kind: "allow_once", optionId: "allow", name: "Allow"},
                    {kind: "reject_once", optionId: "reject", name: "Reject"},
                ],
            },
        }, {sourceChild: oldChild, processEpoch: 3})
        await new Promise((resolve) => setImmediate(resolve))
        client.child = newChild
        client.processEpoch = 4
        finishDialog("allow")
        await pending

        assert.deepEqual(oldWrites, [])
        assert.deepEqual(newWrites, [])
    })

    it("runs an evaluation Judge in a fresh dontAsk session and rejects its tool requests", async () => {
        const permissionRequests = []
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            requestPermission: async (request) => {
                permissionRequests.push(request)
                return "allow"
            },
        })
        const threadOptions = []
        const turnCalls = []
        const finishTurns = []
        client.recorder = {
            latestReference: "trace://codebuddy-judge.jsonl#L12",
            record() {},
            mark: () => ({line: 4}),
            referenceFrom: () => "trace://codebuddy-judge.jsonl#L5-L12",
            evidenceForReference: (reference) => ({reference, events: [{sequence: 5}]}),
        }
        client.startThread = async (options) => {
            threadOptions.push(options)
            const id = `judge-session-${threadOptions.length}`
            client.sessions.set(id, {id, turns: [], status: {type: "idle"}})
            return {thread: {id}}
        }
        client.startTurn = async (threadId, prompt, options) => {
            turnCalls.push({threadId, prompt, options})
            const turnId = `judge-turn-${turnCalls.length}`
            finishTurns.push(() => {
                client.emitNotification("turn/completed", {
                    threadId,
                    turn: {
                        id: turnId,
                        status: "completed",
                        items: [{type: "agentMessage", text: '{"schemaVersion":"judge/v1"}'}],
                    },
                })
            })
            return {turn: {id: turnId}}
        }

        const firstOperation = client.runEvaluationJudge({
            prompt: "judge this",
            modelId: "gpt-5.6-sol",
            effort: "high",
            timeoutMs: 1_000,
        })
        await new Promise((resolve) => setImmediate(resolve))
        const writes = []
        const child = {stdin: {writable: true, write: (value) => writes.push(JSON.parse(value))}}
        client.processEpoch = 1
        client.child = child
        await client.handlePermissionRequest(
            {
                jsonrpc: "2.0",
                id: 19,
                method: "session/request_permission",
                params: {
                    sessionId: "judge-session-1",
                    options: [
                        {kind: "allow_once", optionId: "allow", name: "Allow"},
                        {kind: "reject_once", optionId: "reject", name: "Reject"},
                    ],
                },
            },
            {sourceChild: child, processEpoch: 1},
        )
        finishTurns.shift()()
        const first = await firstOperation
        const secondOperation = client.runEvaluationJudge({
            prompt: "judge that",
            modelId: "gpt-5.6-sol",
            effort: "high",
            timeoutMs: 1_000,
        })
        await new Promise((resolve) => setImmediate(resolve))
        finishTurns.shift()()
        const second = await secondOperation

        assert.deepEqual(threadOptions, [
            {
                model: "gpt-5.6-sol",
                effort: "high",
                permissionMode: "dontAsk",
                threadSource: "subagent",
            },
            {
                model: "gpt-5.6-sol",
                effort: "high",
                permissionMode: "dontAsk",
                threadSource: "subagent",
            },
        ])
        assert.deepEqual(turnCalls[0], {
            threadId: "judge-session-1",
            prompt: "judge this",
            options: {
                model: "gpt-5.6-sol",
                effort: "high",
                permissionMode: "dontAsk",
            },
        })
        assert.deepEqual(writes, [
            {jsonrpc: "2.0", id: 19, result: {outcome: {outcome: "selected", optionId: "reject"}}},
        ])
        assert.deepEqual(permissionRequests, [])
        assert.equal(first.threadId, "judge-session-1")
        assert.equal(first.turnId, "judge-turn-1")
        assert.equal(first.response, '{"schemaVersion":"judge/v1"}')
        assert.equal(first.traceReference, "trace://codebuddy-judge.jsonl#L5-L12")
        assert.deepEqual(first.traceEvidence, {
            reference: "trace://codebuddy-judge.jsonl#L5-L12",
            events: [{sequence: 5}],
        })
        assert.equal(typeof first.durationMs, "number")
        assert.equal(second.threadId, "judge-session-2")
        assert.notEqual(second.threadId, first.threadId)
        assert.equal(client.sessions.has(first.threadId), false)
        assert.equal(client.sessions.has(second.threadId), false)
        assert.equal(client.evaluationJudgeSessions.size, 0)
    })

    it("returns a Case-scoped trace range and bounded evidence", async () => {
        const client = new CodeBuddyAcpClient({
            binaryPath: "/bin/codebuddy",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
        })
        client.recorder = {
            mark: () => ({line: 20}),
            referenceFrom: () => "trace://case.jsonl#L21-L29",
            evidenceForReference: (reference) => ({reference, entries: [{sequence: 21}]}),
        }
        client.startThread = async () => ({thread: {id: "evaluation-session"}})
        client.startTurn = async () => {
            setImmediate(() => {
                client.emitNotification("turn/completed", {
                    threadId: "evaluation-session",
                    turn: {
                        id: "evaluation-turn",
                        status: "completed",
                        items: [{type: "agentMessage", text: "answer"}],
                    },
                })
            })
            return {turn: {id: "evaluation-turn"}}
        }

        const result = await client.runEvaluationCase({question: "hello", timeoutMs: 1_000})

        assert.equal(result.traceReference, "trace://case.jsonl#L21-L29")
        assert.deepEqual(result.traceEvidence, {
            reference: "trace://case.jsonl#L21-L29",
            entries: [{sequence: 21}],
        })
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
