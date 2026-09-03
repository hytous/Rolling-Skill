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
const {buildEvidenceCatalog} = require("../src/evaluation-evidence-catalog.cjs")
const {TraceRecorder} = require("../src/trace-recorder.cjs")

const temporaryDirectories = []

it("offers a stable source revision only for an idle DSH session with a real modification timestamp", async () => {
    const client = {workspaceRoot: "/workspace", listSessionSummaries: async () => ({archived: new Set(), items: [
        {sessionId: "idle", cwd: "/workspace", updatedAt: 1788254052795, running: false},
        {sessionId: "running", cwd: "/workspace", updatedAt: 1788254052795, running: true},
        {sessionId: "missing", cwd: "/workspace", running: false},
    ]})}
    const {data} = await DeepSeekHarnessClient.prototype.listThreads.call(client)
    assert.equal(data.find((item) => item.id === "idle").sourceRevision, "dsh:1788254052795")
    assert.equal(data.find((item) => item.id === "running").sourceRevision, null)
    assert.equal(data.find((item) => item.id === "missing").sourceRevision, null)
})

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

class FakeWebSocket extends EventEmitter {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
        super()
        this.url = url
        this.readyState = FakeWebSocket.CONNECTING
        queueMicrotask(() => {
            if (this.readyState !== FakeWebSocket.CONNECTING) return
            this.readyState = FakeWebSocket.OPEN
            this.dispatch("open", {})
        })
    }

    addEventListener(type, listener, options = {}) {
        if (options?.once) this.once(type, listener)
        else this.on(type, listener)
    }

    removeEventListener(type, listener) {
        this.off(type, listener)
    }

    dispatch(type, payload) {
        this.emit(type, payload)
        this[`on${type}`]?.(payload)
    }

    receive(message) {
        this.dispatch("message", {data: JSON.stringify(message)})
    }

    close(code = 1000, reason = "") {
        if (this.readyState === FakeWebSocket.CLOSED) return
        this.readyState = FakeWebSocket.CLOSED
        this.dispatch("close", {code, reason, wasClean: code === 1000})
    }
}

class ManagedFakeChild extends EventEmitter {
    constructor() {
        super()
        this.stdout = new EventEmitter()
        this.stderr = new EventEmitter()
        this.killed = false
    }

    kill(signal) {
        this.killed = true
        this.emit("close", signal === "SIGKILL" ? null : 0, signal)
        return true
    }
}

function eventually(predicate, message = "condition was not met") {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + 250
        const check = () => {
            if (predicate()) return resolve()
            if (Date.now() >= deadline) return reject(new Error(message))
            setTimeout(check, 2)
        }
        check()
    })
}

function responseFor(body, value = {}) {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            type: "server-response",
            rpcId: body.rpcId,
            result: {ok: true, value},
        }),
    }
}

describe("DeepSeek Harness runtime provider", () => {
    it("advertises the WebSocket stream and permission controls exposed by the local Host", () => {
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
        assert.equal(descriptor.transport, "localhost-http-websocket")
        assert.equal(descriptor.developerPreview, true)
        assert.equal(descriptor.capabilities.includes("streaming"), true)
        assert.equal(descriptor.capabilities.includes("permission-mode"), true)
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
        assert.equal(thread.turns[0].items[0].sourceSeq, 1)
        assert.equal(thread.turns[0].items[3].sourceSeq, 5)
        assert.equal(thread.turns[0].items[3].sourceMessageId, "assistant-1")
    })

    it("records DSH tool results as completed and failed Judge evidence", () => {
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-tool-evidence-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
        })
        client.recorder = new TraceRecorder(traceDirectory, {sessionId: "dsh-tool-evidence"})
        const mark = client.recorder.mark()

        client.recordHistoryEvents("session-evidence", [
            event("tool/call", 1, {
                turn: 1,
                step: 1,
                callId: "call-success",
                name: "bash",
                arguments: JSON.stringify({command: "printf success"}),
            }),
            event("tool/result", 2, {
                turn: 1,
                step: 1,
                message: {
                    content: [{
                        type: "tool-result",
                        toolCallId: "call-success",
                        content: [{type: "text", text: "success"}],
                    }],
                },
            }),
            event("tool/call", 3, {
                turn: 1,
                step: 2,
                callId: "call-failure",
                name: "bash",
                arguments: JSON.stringify({command: "exit 7"}),
            }),
            event("tool/result", 4, {
                turn: 1,
                step: 2,
                error: {message: "process exited with status 7"},
                message: {
                    content: [{
                        type: "tool-result",
                        toolCallId: "call-failure",
                        isError: true,
                        content: [{type: "text", text: "exit 7"}],
                    }],
                },
            }),
        ])

        const traceEvidence = client.recorder.evidenceForReference(
            client.recorder.referenceFrom(mark),
        )
        const catalog = buildEvidenceCatalog({traceEvidence})
        const completed = catalog.entries.find((entry) =>
            entry.record?.message?.params?.item?.id === "dsh-tool-call-success" &&
            entry.record.message.params.item.status === "completed",
        )
        const failed = catalog.entries.find((entry) =>
            entry.record?.message?.params?.item?.id === "dsh-tool-call-failure" &&
            entry.record.message.params.item.status === "failed",
        )

        assert.ok(completed, "completed DSH tool evidence must survive trace compaction")
        assert.deepEqual(completed.kinds, ["command", "tool_call"])
        assert.equal(completed.record.message.params.item.aggregatedOutput, "success")
        assert.ok(failed, "failed DSH tool evidence must survive trace compaction")
        assert.deepEqual(failed.kinds, ["command", "tool_call", "error"])
        assert.match(failed.record.message.params.item.error.message, /status 7/)
    })

    it("starts each Host process with fresh Trace deduplication and tool correlation state", async () => {
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-restart-trace-"))
        temporaryDirectories.push(traceDirectory)
        const children = []
        const sockets = []
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                const child = new ManagedFakeChild()
                children.push(child)
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            fetchImpl: async (_url, options) => {
                const body = JSON.parse(options.body)
                if (body.method === "llm.models") return responseFor(body, {groups: [], failures: []})
                return responseFor(body, {})
            },
        })

        try {
            await client.start()
            client.recordHistoryEvents("session-reused", [
                event("tool/call", 1, {
                    turn: 1,
                    step: 1,
                    callId: "call-reused",
                    name: "bash",
                    arguments: JSON.stringify({command: "printf old-process"}),
                }),
                event("tool/result", 2, {
                    turn: 1,
                    step: 1,
                    message: {content: [{type: "tool-result", toolCallId: "call-reused", content: []}]},
                }),
                event("tool/call", 3, {
                    turn: 1,
                    step: 2,
                    callId: "old-process-only",
                    name: "bash",
                    arguments: JSON.stringify({command: "printf must-not-leak"}),
                }),
            ])
            client.bufferLiveEntry("session-reused", event("assistant/message", 50, {
                turn: 1,
                step: 3,
                message: {content: [{type: "text", text: "old buffered message"}]},
            }))
            assert.equal(client.liveEventBuffers.size, 1)
            const firstTracePath = client.recorder.path
            await client.stop()
            await new Promise((resolve) => setTimeout(resolve, 2))

            await client.start()
            assert.notEqual(client.recorder.path, firstTracePath)
            assert.equal(client.liveEventBuffers.size, 0)
            const mark = client.recorder.mark()
            client.recordHistoryEvents("session-reused", [
                event("tool/call", 1, {
                    turn: 1,
                    step: 1,
                    callId: "call-reused",
                    name: "bash",
                    arguments: JSON.stringify({command: "printf new-process"}),
                }),
                event("tool/result", 2, {
                    turn: 1,
                    step: 1,
                    message: {
                        content: [{
                            type: "tool-result",
                            toolCallId: "call-reused",
                            content: [{type: "text", text: "new-process"}],
                        }],
                    },
                }),
                event("tool/result", 100, {
                    turn: 1,
                    step: 2,
                    message: {
                        content: [{type: "tool-result", toolCallId: "old-process-only", content: []}],
                    },
                }),
            ])

            const evidence = client.recorder.evidenceForReference(client.recorder.referenceFrom(mark))
            const completed = evidence.entries.find((entry) =>
                entry.message?.params?.item?.id === "dsh-tool-call-reused" &&
                entry.message.params.item.status === "completed",
            )
            const staleResult = evidence.entries.find((entry) =>
                entry.message?.params?.event?.seq === 100,
            )

            assert.equal(completed?.message.params.item.command, "printf new-process")
            assert.equal(staleResult?.message.params?.item, undefined)
        } finally {
            await client.stop()
        }

        assert.equal(children.length, 2)
        assert.equal(sockets.every((socket) => socket.readyState === FakeWebSocket.CLOSED), true)
    })

    it("preserves an interrupted terminal reason instead of reporting a failed turn", () => {
        const thread = threadFromHistory({
            summary: {sessionId: "session-interrupted", running: false, cwd: "/workspace"},
            entries: [
                event("turn/start", 0, {turn: 1}),
                event("turn/end", 1, {turn: 1, reason: {kind: "interrupted"}}),
            ],
            workspaceRoot: "/workspace",
        })

        assert.equal(thread.turns[0].status, "interrupted")
        assert.equal("error" in thread.turns[0], false)
    })

    it("passes the resolved Rolling Skill sandbox to the managed Host process", async () => {
        const child = new ManagedFakeChild()
        const spawnCalls = []
        const sockets = []
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-permission-env-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            executionPolicy: {sandbox: "danger-full-access", approvalPolicy: "never"},
            spawnProcess: (path, args, options) => {
                spawnCalls.push({path, args, options})
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            fetchImpl: async (_url, options) => {
                const body = JSON.parse(options.body)
                return responseFor(body, body.method === "llm.models" ? {groups: [], failures: []} : {})
            },
        })

        try {
            await client.start()

            assert.equal(spawnCalls.length, 1)
            assert.equal(spawnCalls[0].options.env.DSH_PERMISSION_MODE, "danger-full-access")
            assert.equal(spawnCalls[0].options.env.ROLLING_SKILL_OPERATOR_HOST, "1")
        } finally {
            await client.stop()
        }
        assert.equal(sockets.every((socket) => socket.readyState === FakeWebSocket.CLOSED), true)
    })

    it("merges only explicit Operator CLI credentials and redacts Host stderr", async () => {
        const child = new ManagedFakeChild()
        const spawnCalls = []
        const runtimeLogs = []
        const sockets = []
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-operator-env-"))
        temporaryDirectories.push(traceDirectory)
        const childEnvironment = {
            ROLLING_SKILL_CONTROL_SOCKET: "/private/dsh.sock",
            ROLLING_SKILL_CONTROL_TOKEN: "dsh-operator-token",
            ROLLING_SKILL_OPERATOR_SESSION: "dsh-operator-session",
            SHOULD_NOT_PASS: "unknown-environment",
        }
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            childEnvironment,
            spawnProcess: (path, args, options) => {
                spawnCalls.push({path, args, options})
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            fetchImpl: async (_url, options) => {
                const body = JSON.parse(options.body)
                return responseFor(body, body.method === "llm.models" ? {groups: [], failures: []} : {})
            },
        })
        client.on("runtimeLog", (message) => runtimeLogs.push(message))

        try {
            await client.start()
            child.stderr.emit("data", Buffer.from("ROLLING_SKILL_CONTROL_SOCKET=/private/dsh.sock dsh-oper"))
            child.stderr.emit("data", Buffer.from("ator-token\n"))
            sockets[0].dispatch("error", {
                message: `stream failed: ${childEnvironment.ROLLING_SKILL_OPERATOR_SESSION}`,
            })
            await new Promise((resolve) => setImmediate(resolve))

            assert.equal(spawnCalls[0].options.env.ROLLING_SKILL_CONTROL_SOCKET, "/private/dsh.sock")
            assert.equal(spawnCalls[0].options.env.ROLLING_SKILL_CONTROL_TOKEN, "dsh-operator-token")
            assert.equal(spawnCalls[0].options.env.ROLLING_SKILL_OPERATOR_SESSION, "dsh-operator-session")
            assert.equal(Object.hasOwn(spawnCalls[0].options.env, "SHOULD_NOT_PASS"), false)
            const diagnostic = JSON.stringify({runtimeLogs, trace: client.recentTrace(50)})
            assert.equal(runtimeLogs.join("").includes("dsh-operator-token"), false)
            for (const forbidden of [
                "ROLLING_SKILL_CONTROL_SOCKET",
                "ROLLING_SKILL_CONTROL_TOKEN",
                "ROLLING_SKILL_OPERATOR_SESSION",
                "/private/dsh.sock",
                "dsh-operator-token",
                "dsh-operator-session",
            ]) assert.equal(diagnostic.includes(forbidden), false, forbidden)
        } finally {
            await client.stop()
        }
        assert.equal(sockets.every((socket) => socket.readyState === FakeWebSocket.CLOSED), true)
    })

    it("redacts Operator authority from HTTP successes, failures, and history projections", async () => {
        const token = "dsh-boundary-token"
        const session = "dsh-boundary-session"
        const childEnvironment = {
            ROLLING_SKILL_CONTROL_SOCKET: "/private/dsh-boundary.sock",
            ROLLING_SKILL_CONTROL_TOKEN: token,
            ROLLING_SKILL_OPERATOR_SESSION: session,
        }
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-boundary-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            childEnvironment,
            fetchImpl: async (url, options) => {
                const body = JSON.parse(options.body)
                if (url.endsWith("/api/respond")) throw new Error(`respond ${token}`)
                if (body.method === "boundary.success") {
                    return responseFor(body, {text: `assistant ${token}`, nested: {session}})
                }
                if (body.method === "boundary.failure") {
                    return {
                        ok: false,
                        status: 500,
                        json: async () => ({
                            type: "server-response",
                            rpcId: body.rpcId,
                            result: {
                                ok: false,
                                error: {
                                    code: "HOST_FAILURE",
                                    message: `failed ${token}`,
                                    details: {socket: childEnvironment.ROLLING_SKILL_CONTROL_SOCKET},
                                },
                            },
                        }),
                    }
                }
                if (body.method === "boundary.timeout") {
                    return {
                        ok: true,
                        status: 200,
                        json: async () => {
                            await new Promise((resolve) => setTimeout(resolve, 5))
                            throw new Error(`timeout ${token}`)
                        },
                    }
                }
                if (body.method === "session.history") {
                    return responseFor(body, {events: [
                        event("turn/start", 1, {turn: 1}),
                        event("assistant/message", 2, {
                            turn: 1,
                            step: 1,
                            message: {content: [{type: "text", text: `answer ${token}`}]},
                        }),
                        event("tool/call", 3, {
                            turn: 1,
                            callId: "tool-1",
                            name: "Skill",
                            arguments: JSON.stringify({session}),
                        }),
                        event("tool/result", 4, {
                            turn: 1,
                            message: {
                                source: {callId: "tool-1"},
                                content: [{type: "tool-result", toolCallId: "tool-1", content: [
                                    {type: "text", text: `result ${token}`},
                                ]}],
                            },
                        }),
                        event("turn/end", 5, {
                            turn: 1,
                            reason: {kind: "failed", error: {message: `terminal ${token}`}},
                        }),
                    ], hasMore: false})
                }
                if (body.method === "session.list") {
                    return responseFor(body, {items: [{
                        sessionId: "thread-1",
                        cwd: "/workspace",
                        updatedAt: Date.now(),
                        projections: {values: {title: `title ${session}`}},
                    }]})
                }
                if (body.method === "workspace.list") {
                    return responseFor(body, {items: [], archivedSessionIds: []})
                }
                return responseFor(body, {})
            },
        })
        client.baseUrl = "http://127.0.0.1:54945"

        const success = await client.request("boundary.success")
        assert.equal(JSON.stringify(success).includes(token), false)
        assert.equal(JSON.stringify(success).includes(session), false)
        await assert.rejects(client.request("boundary.failure"), (error) => {
            const snapshot = JSON.stringify({message: error.message, details: error.details})
            assert.equal(snapshot.includes(token), false)
            assert.equal(snapshot.includes(childEnvironment.ROLLING_SKILL_CONTROL_SOCKET), false)
            return true
        })
        await assert.rejects(client.request("boundary.timeout", {}, {timeoutMs: 1}), (error) => {
            const snapshot = JSON.stringify({
                message: error.message,
                cause: error.cause?.message ?? null,
            })
            assert.equal(snapshot.includes(token), false)
            return true
        })
        await assert.rejects(client.respond({type: "client-response", rpcId: "response-1"}), (error) => {
            assert.equal(String(error.message).includes(token), false)
            return true
        })
        const thread = await client.readThread("thread-1")
        const projection = JSON.stringify(thread)
        assert.equal(projection.includes(token), false)
        assert.equal(projection.includes(session), false)
        assert.match(projection, /\[REDACTED\]/u)
    })

    it("redacts assistant chunks, Tool results, and terminal turns before notifications", () => {
        const token = "dsh-notification-token"
        const session = "dsh-notification-session"
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            childEnvironment: {
                ROLLING_SKILL_CONTROL_SOCKET: "/private/dsh-notification.sock",
                ROLLING_SKILL_CONTROL_TOKEN: token,
                ROLLING_SKILL_OPERATOR_SESSION: session,
            },
        })
        const notifications = []
        client.on("notification", (message) => notifications.push(message))
        const pending = {
            threadId: "thread-1",
            turnNumber: 1,
            turnId: "dsh-turn-1",
            lastSeq: 0,
            entries: [event("turn/start", 0, {turn: 1})],
            chunks: new Map(),
            toolCalls: new Map(),
            stopped: false,
        }
        client.pendingTurns.set(pending.threadId, pending)

        client.processLiveEntries(pending, [
            event("assistant/chunk", 1, {
                turn: 1,
                step: 1,
                chunk: {type: "text-delta", index: 0, text: `chunk ${token}`},
            }),
            event("tool/call", 2, {
                turn: 1,
                callId: "tool-1",
                name: "Skill",
                arguments: JSON.stringify({session}),
            }),
            event("tool/result", 3, {
                turn: 1,
                message: {
                    source: {callId: "tool-1"},
                    content: [{type: "tool-result", toolCallId: "tool-1", content: [
                        {type: "text", text: `result ${token}`},
                    ]}],
                },
            }),
            event("assistant/message", 4, {
                turn: 1,
                step: 1,
                message: {content: [{type: "text", text: `answer ${token}`}]},
            }),
            event("turn/end", 5, {
                turn: 1,
                reason: {kind: "failed", error: {message: `terminal ${token}`}},
            }),
        ])

        const projection = JSON.stringify(notifications)
        assert.equal(projection.includes(token), false)
        assert.equal(projection.includes(session), false)
        assert.match(projection, /\[REDACTED\]/u)
        assert.equal(notifications.some((message) => message.method === "item/agentMessage/delta"), true)
        assert.equal(notifications.some((message) => message.method === "item/completed"), true)
        assert.equal(notifications.some((message) => message.method === "turn/completed"), true)
    })

    it("keeps raw mux routing private while callbacks receive redacted interaction payloads", async () => {
        const token = "dsh-interaction-token"
        const requests = []
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: "/tmp",
            childEnvironment: {
                ROLLING_SKILL_CONTROL_SOCKET: "/private/dsh-interaction.sock",
                ROLLING_SKILL_CONTROL_TOKEN: token,
                ROLLING_SKILL_OPERATOR_SESSION: "dsh-interaction-session",
            },
            requestPermission: async (request) => {
                requests.push(request)
                return "rejected"
            },
        })
        client.ready = true
        client.child = {}
        client.processEpoch = 4
        client.respond = async () => ({accepted: true})

        client.handleMuxEnvelope({
            rpcId: "interaction-1",
            payload: {
                type: "approval/requested",
                sessionId: "runtime-thread-1",
                approvalId: "approval-1",
                toolName: "shell",
                reason: `run ${token}`,
            },
        }, 4)
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(requests.length, 1)
        assert.equal(JSON.stringify(requests[0]).includes(token), false)
        assert.match(JSON.stringify(requests[0]), /\[REDACTED\]/u)
    })

    it("honors the read-only sandbox requested by hidden Curator and Rubric threads", async () => {
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-hidden-read-only-")),
            executionPolicy: {sandbox: "danger-full-access"},
        })
        temporaryDirectories.push(client.traceDirectory)
        client.sessionPermissions.set("hidden-session", "danger-full-access")
        const requests = []
        client.request = async (method, payload) => {
            requests.push({method, payload})
            return {result: {kind: "success"}}
        }

        await client.configureSession("hidden-session", {sandbox: "read-only"})

        assert.deepEqual(requests, [{
            method: "commands/execute",
            payload: {args: {agentId: "hidden-session", line: "/permission read-only", images: []}},
        }])
        assert.equal(client.sessionPermissions.get("hidden-session"), "read-only")
    })

    it("reattaches a cold persisted session before listing workspace Skills", async () => {
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-cold-skill-session-")),
        })
        temporaryDirectories.push(client.traceDirectory)
        const requests = []
        client.request = async (method, payload) => {
            requests.push({method, payload})
            if (method === "session.list") {
                return {items: [{sessionId: "cold-session", cwd: "/workspace", blank: false}]}
            }
            if (method === "workspace.list") return {items: [], archivedSessionIds: []}
            if (method === "session.create") return {sessionId: payload.sessionId}
            if (method === "skill.list") {
                return {skills: [{name: "billing-cost-management", description: "Billing", modelInvocable: true}]}
            }
            throw new Error(`Unexpected request: ${method}`)
        }

        const skills = await client.listSkills()

        assert.deepEqual(requests.map((entry) => entry.method), [
            "session.list",
            "workspace.list",
            "session.create",
            "skill.list",
        ])
        assert.deepEqual(requests[2].payload, {cwd: "/workspace", sessionId: "cold-session"})
        assert.equal(skills.data[0].skills[0].name, "billing-cost-management")
    })

    it("completes a turn from the mux WebSocket without continuously polling history", async () => {
        const child = new ManagedFakeChild()
        const sockets = []
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-mux-turn-"))
        temporaryDirectories.push(traceDirectory)
        let historyCalls = 0
        const started = event("turn/start", 1, {turn: 1})
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            pollIntervalMs: 2,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            fetchImpl: async (_url, options) => {
                const body = JSON.parse(options.body)
                if (body.method === "llm.models") return responseFor(body, {groups: [], failures: []})
                if (body.method === "session.history") {
                    historyCalls += 1
                    return responseFor(body, {events: historyCalls === 1 ? [] : [started]})
                }
                return responseFor(body, {accepted: true})
            },
        })

        try {
            await client.start()
            const completion = new Promise((resolve) => client.once("turn/completed", resolve))
            await client.startTurn("session-1", "Run the check")
            const mux = sockets.find((socket) => socket.url.endsWith("/api/events.mux"))
            assert.ok(mux, "the client must open the mux WebSocket")
            mux.receive({
                type: "server-request",
                rpcId: "rpc-assistant",
                method: "events.mux",
                payload: {
                    type: "session/event",
                    sessionId: "session-1",
                    event: event("assistant/message", 2, {
                        turn: 1,
                        step: 1,
                        message: {content: [{type: "text", text: "The check passed."}]},
                    }).event,
                },
            })
            mux.receive({
                type: "server-request",
                rpcId: "rpc-turn-end",
                method: "events.mux",
                payload: {
                    type: "session/event",
                    sessionId: "session-1",
                    event: event("turn/end", 3, {turn: 1, reason: {kind: "completed"}}).event,
                },
            })

            const params = await Promise.race([
                completion,
                new Promise((_resolve, reject) => setTimeout(
                    () => reject(new Error("mux turn did not complete")),
                    250,
                )),
            ])
            await new Promise((resolve) => setTimeout(resolve, 20))
            assert.equal(params.turn.status, "completed")
            assert.equal(params.turn.items.at(-1).text, "The check passed.")
            assert.ok(historyCalls <= 3, `history was polled ${historyCalls} times`)
        } finally {
            await client.stop()
        }
    })

    it("responds to approvals and questions with the exact DSH client-response envelopes", async () => {
        const child = new ManagedFakeChild()
        const sockets = []
        const responses = []
        const permissionRequests = []
        const questionRequests = []
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-interactions-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            requestPermission: async (request) => {
                permissionRequests.push(request)
                return request.params.approvalId === "approval-allow" ? "allowed-once" : "rejected"
            },
            requestQuestion: async (request) => {
                questionRequests.push(request)
                if (request.rpcId === "rpc-question-cancel") return null
                return {answers: [{id: "region", selected: ["APAC"]}]}
            },
            fetchImpl: async (url, options) => {
                const body = JSON.parse(options.body)
                if (url.endsWith("/api/respond")) {
                    responses.push(body)
                    return {ok: true, status: 200, json: async () => ({accepted: true})}
                }
                return responseFor(body, body.method === "llm.models" ? {groups: [], failures: []} : {})
            },
        })

        try {
            await client.start()
            const mux = sockets.find((socket) => socket.url.endsWith("/api/events.mux"))
            assert.ok(mux, "the client must open the mux WebSocket")
            const frames = [
                {
                    type: "server-request",
                    rpcId: "rpc-approval-allow",
                    method: "events.mux",
                    payload: {
                        type: "approval/requested",
                        sessionId: "session-1",
                        approvalId: "approval-allow",
                        toolName: "bash",
                        callId: "call-1",
                        reason: "run a billing query",
                    },
                },
                {
                    type: "server-request",
                    rpcId: "rpc-approval-reject",
                    method: "events.mux",
                    payload: {
                        type: "approval/requested",
                        sessionId: "session-1",
                        approvalId: "approval-reject",
                        toolName: "bash",
                    },
                },
                {
                    type: "server-request",
                    rpcId: "rpc-question-answer",
                    method: "events.mux",
                    payload: {
                        type: "question/requested",
                        sessionId: "session-1",
                        questions: [{
                            id: "region",
                            header: "Region",
                            question: "Which region?",
                            options: [{label: "APAC"}, {label: "Europe"}],
                        }],
                    },
                },
                {
                    type: "server-request",
                    rpcId: "rpc-question-cancel",
                    method: "events.mux",
                    payload: {
                        type: "question/requested",
                        sessionId: "session-1",
                        questions: [{id: "confirm", question: "Continue?"}],
                    },
                },
            ]
            for (const frame of frames) {
                mux.receive(frame)
                await eventually(() => responses.length === frames.indexOf(frame) + 1, "interaction was not answered")
            }

            assert.equal(permissionRequests.length, 2)
            assert.deepEqual(permissionRequests[0].options.map((option) => option.optionId), [
                "allowed-once",
                "rejected",
            ])
            assert.equal(questionRequests.length, 2)
            assert.equal(questionRequests.every((request) => request.signal instanceof AbortSignal), true)
            assert.deepEqual(responses, [
                {
                    type: "client-response",
                    rpcId: "rpc-approval-allow",
                    result: {
                        ok: true,
                        value: {
                            sessionId: "session-1",
                            approvalId: "approval-allow",
                            outcome: "allowed-once",
                        },
                    },
                },
                {
                    type: "client-response",
                    rpcId: "rpc-approval-reject",
                    result: {
                        ok: true,
                        value: {
                            sessionId: "session-1",
                            approvalId: "approval-reject",
                            outcome: "rejected",
                        },
                    },
                },
                {
                    type: "client-response",
                    rpcId: "rpc-question-answer",
                    result: {
                        ok: true,
                        value: {
                            sessionId: "session-1",
                            answer: {answers: [{id: "region", selected: ["APAC"]}]},
                        },
                    },
                },
                {
                    type: "client-response",
                    rpcId: "rpc-question-cancel",
                    result: {
                        ok: false,
                        error: {
                            code: "cancelled",
                            message: "User cancelled the question",
                            details: {},
                        },
                    },
                },
            ])
        } finally {
            await client.stop()
        }
    })

    for (const interaction of ["approval", "question"]) {
        it(`fails a non-interactive evaluation immediately after rejecting a DSH ${interaction}`, async () => {
            const child = new ManagedFakeChild()
            const sockets = []
            const responses = []
            const requests = []
            const notifications = []
            let interactiveHandlerCalls = 0
            const traceDirectory = mkdtempSync(join(tmpdir(), `rolling-skill-dsh-non-interactive-${interaction}-`))
            temporaryDirectories.push(traceDirectory)
            const client = new DeepSeekHarnessClient({
                binaryPath: "/bin/dsh",
                workspaceRoot: "/workspace",
                traceDirectory,
                nonInteractive: true,
                spawnProcess: () => {
                    queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                    return child
                },
                webSocketFactory: (url) => {
                    const socket = new FakeWebSocket(url)
                    sockets.push(socket)
                    return socket
                },
                requestPermission: async () => {
                    interactiveHandlerCalls += 1
                    return new Promise(() => {})
                },
                requestQuestion: async () => {
                    interactiveHandlerCalls += 1
                    return new Promise(() => {})
                },
                fetchImpl: async (url, options) => {
                    const body = JSON.parse(options.body)
                    if (url.endsWith("/api/respond")) {
                        responses.push(body)
                        return {ok: true, status: 200, json: async () => ({accepted: true})}
                    }
                    requests.push(body)
                    return responseFor(body, body.method === "llm.models" ? {groups: [], failures: []} : {})
                },
            })

            try {
                await client.start()
                client.on("notification", (message) => notifications.push(message))
                const mux = sockets.find((socket) => socket.url.endsWith("/api/events.mux"))
                assert.ok(mux, "the client must open the mux WebSocket")
                const pending = {
                    threadId: "evaluation-session",
                    turnId: "dsh-turn-1",
                    stopped: false,
                }
                client.pendingTurns.set(pending.threadId, pending)
                const completion = client.waitForCompletedTurn(pending.threadId, 5_000, () => {})
                const completionError = assert.rejects(completion.promise, (error) => {
                    assert.equal(error.code, "EVALUATION_INTERACTION_REQUIRED")
                    assert.match(error.message, /interactive/i)
                    return true
                })
                mux.receive({
                    type: "server-request",
                    rpcId: `rpc-${interaction}`,
                    method: "events.mux",
                    payload: interaction === "approval"
                        ? {
                              type: "approval/requested",
                              sessionId: pending.threadId,
                              approvalId: "approval-1",
                              toolName: "bash",
                          }
                        : {
                              type: "question/requested",
                              sessionId: pending.threadId,
                              questions: [{id: "region", question: "Which region?"}],
                          },
                })

                await eventually(() => responses.length === 1, "non-interactive response was not immediate")
                await eventually(
                    () => !client.pendingTurns.has(pending.threadId),
                    "the pending evaluation turn was not failed after the interaction response",
                )
                assert.ok(
                    notifications.some((message) =>
                        message.method === "turn/completed" &&
                        message.params?.threadId === pending.threadId &&
                        message.params?.turn?.error?.code === "EVALUATION_INTERACTION_REQUIRED",
                    ),
                    `missing failed completion notification: ${JSON.stringify(notifications)}`,
                )
                await completionError
                await eventually(
                    () => requests.some((entry) => entry.method === "session.cancel"),
                    "the blocked DSH turn was not cancelled",
                )
                assert.equal(interactiveHandlerCalls, 0)
                if (interaction === "approval") {
                    assert.deepEqual(responses[0].result.value, {
                        sessionId: pending.threadId,
                        approvalId: "approval-1",
                        outcome: "rejected",
                    })
                } else {
                    assert.deepEqual(responses[0].result, {
                        ok: false,
                        error: {
                            code: "cancelled",
                            message: "User cancelled the question",
                            details: {},
                        },
                    })
                }
            } finally {
                await client.stop()
            }
        })
    }

    it("preserves a non-interactive failure that arrives before the DSH turn watcher is attached", async () => {
        const child = new ManagedFakeChild()
        const sockets = []
        const responses = []
        let historyCalls = 0
        let client
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-early-interaction-"))
        temporaryDirectories.push(traceDirectory)
        const started = event("turn/start", 1, {turn: 1})
        const fetchImpl = async (url, options) => {
            const body = JSON.parse(options.body)
            if (url.endsWith("/api/respond")) {
                responses.push(body)
                return {ok: true, status: 200, json: async () => ({accepted: true})}
            }
            if (body.method === "llm.models") return responseFor(body, {groups: [], failures: []})
            if (body.method === "session.history") {
                historyCalls += 1
                return responseFor(body, {events: historyCalls === 1 ? [] : [started]})
            }
            if (body.method === "session.prompt") {
                const mux = sockets.find((socket) => socket.url.endsWith("/api/events.mux"))
                mux.receive({
                    type: "server-request",
                    rpcId: "rpc-question-before-turn-start",
                    method: "events.mux",
                    payload: {
                        type: "question/requested",
                        sessionId: "session-early",
                        questions: [{id: "scope", question: "Which scope?"}],
                    },
                })
                const response = responseFor(body, {accepted: true})
                return {
                    ...response,
                    json: async () => {
                        await eventually(
                            () => client.pendingNonInteractiveFailures.has("session-early"),
                            "early interaction failure was not retained",
                        )
                        return response.json()
                    },
                }
            }
            return responseFor(body, {})
        }
        client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            nonInteractive: true,
            pollIntervalMs: 2,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            fetchImpl,
        })

        try {
            await client.start()
            const completion = client.waitForCompletedTurn("session-early", 5_000, () => {})
            const completionError = assert.rejects(completion.promise, (error) => {
                assert.equal(error.code, "EVALUATION_INTERACTION_REQUIRED")
                return true
            })
            await client.startTurn("session-early", "Run without interactive input")
            await completionError

            assert.equal(responses.length, 1)
            assert.equal(client.pendingTurns.has("session-early"), false)
            assert.equal(client.pendingNonInteractiveFailures.has("session-early"), false)
        } finally {
            await client.stop()
        }
    })

    it("does not answer a stale interaction after the client is stopped", async () => {
        const child = new ManagedFakeChild()
        const sockets = []
        const responses = []
        let resolvePermission
        const permissionStarted = new Promise((resolve) => {
            resolvePermission = resolve
        })
        let releasePermission
        const permissionResult = new Promise((resolve) => {
            releasePermission = resolve
        })
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-stale-interaction-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            webSocketFactory: (url) => {
                const socket = new FakeWebSocket(url)
                sockets.push(socket)
                return socket
            },
            requestPermission: async () => {
                resolvePermission()
                return permissionResult
            },
            fetchImpl: async (url, options) => {
                const body = JSON.parse(options.body)
                if (url.endsWith("/api/respond")) {
                    responses.push(body)
                    return {ok: true, status: 200, json: async () => ({accepted: true})}
                }
                return responseFor(body, body.method === "llm.models" ? {groups: [], failures: []} : {})
            },
        })

        try {
            await client.start()
            const mux = sockets.find((socket) => socket.url.endsWith("/api/events.mux"))
            assert.ok(mux, "the client must open the mux WebSocket")
            mux.receive({
                type: "server-request",
                rpcId: "rpc-stale",
                method: "events.mux",
                payload: {
                    type: "approval/requested",
                    sessionId: "session-1",
                    approvalId: "approval-stale",
                    toolName: "bash",
                },
            })
            await permissionStarted
            await client.stop()
            releasePermission("allowed-once")
            await new Promise((resolve) => setImmediate(resolve))

            assert.deepEqual(responses, [])
        } finally {
            releasePermission?.("rejected")
            await client.stop()
        }
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
                assert.deepEqual(args, ["--profile", "web", "--no-open", "--port", "0"])
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

    it("retries startup describe while the announced HTTP Host is not listening yet", async () => {
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
        const attempts = {"host.describe": 0, "llm.models": 0}
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-startup-retry-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            runtimeDescriptor: {runtimeId: "deepseek-harness:test", providerId: "deepseek-harness"},
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            fetchImpl: async (_url, options) => {
                const body = JSON.parse(options.body)
                attempts[body.method] += 1
                if (body.method === "host.describe" && attempts[body.method] < 3) throw new TypeError("fetch failed", {
                    cause: Object.assign(new Error("connect ECONNREFUSED"), {code: "ECONNREFUSED"}),
                })
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        type: "server-response",
                        rpcId: body.rpcId,
                        result: {ok: true, value: {version: "0.1.0-rc.6"}},
                    }),
                }
            },
            startupTimeoutMs: 100,
            startupRetryDelayMs: 1,
        })

        await client.start()

        assert.deepEqual(attempts, {"host.describe": 3, "llm.models": 1})
        assert.equal(client.state().status, "ready")
        assert.equal(child.killed, false)
        await client.stop()
    })

    it("does not retry a reachable Host that rejects the startup request", async () => {
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
        let attempts = 0
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-startup-http-error-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            fetchImpl: async (_url, options) => {
                attempts += 1
                const body = JSON.parse(options.body)
                return {
                    ok: false,
                    status: 503,
                    json: async () => ({
                        type: "server-response",
                        rpcId: body.rpcId,
                        result: {ok: false, error: {code: "HOST_REJECTED", message: "not available"}},
                    }),
                }
            },
            startupTimeoutMs: 100,
            startupRetryDelayMs: 1,
        })

        await assert.rejects(client.start(), /not available/)

        assert.equal(attempts, 1)
        assert.equal(child.killed, true)
    })

    it("bounds a hanging startup request and leaves the client stopped", async () => {
        class FakeChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.killed = false
                this.signals = []
            }
            kill(signal) {
                this.killed = true
                this.signals.push(signal)
                if (signal === "SIGKILL") this.emit("close", null, signal)
                return true
            }
        }
        const child = new FakeChild()
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-startup-timeout-"))
        temporaryDirectories.push(traceDirectory)
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory,
            spawnProcess: () => {
                queueMicrotask(() => child.stdout.emit("data", "dsh web: http://127.0.0.1:54945\n"))
                return child
            },
            fetchImpl: async (_url, options) => {
                if (!options.signal) return new Promise(() => {})
                return new Promise((_resolve, reject) => {
                    options.signal.addEventListener("abort", () => {
                        reject(Object.assign(new Error("request aborted"), {name: "AbortError"}))
                    }, {once: true})
                })
            },
            startupTimeoutMs: 15,
            startupRetryDelayMs: 1,
            shutdownTimeoutMs: 5,
        })

        await assert.rejects(
            Promise.race([
                client.start(),
                new Promise((_resolve, reject) => setTimeout(
                    () => reject(new Error("startup test watchdog expired")),
                    150,
                )),
            ]),
            /Timed out waiting for the DeepSeek Harness Host HTTP endpoint/,
        )

        assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"])
        assert.equal(client.state().status, "stopped")
    })

    it("escalates a graceful stop when the Host ignores SIGTERM", async () => {
        class FakeChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.killed = false
                this.signals = []
            }
            kill(signal) {
                this.killed = true
                this.signals.push(signal)
                if (signal === "SIGKILL") this.emit("close", null, signal)
                return true
            }
        }
        const child = new FakeChild()
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-stop-escalation-")),
            shutdownTimeoutMs: 5,
        })
        temporaryDirectories.push(client.traceDirectory)
        client.child = child

        await client.stop()

        assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"])
        assert.equal(client.state().status, "stopped")
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

    it("reports the hidden evaluation thread immediately after it starts", async () => {
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evaluation-thread-")),
        })
        temporaryDirectories.push(client.traceDirectory)
        client.startThread = async () => ({thread: {id: "evaluation-session"}})
        client.startTurn = async () => ({turn: {id: "evaluation-turn"}})
        client.waitForCompletedTurn = () => ({
            promise: Promise.resolve({
                id: "evaluation-turn",
                items: [{type: "agentMessage", text: "answer"}],
            }),
            cleanup: () => {},
        })
        const startedThreads = []

        await client.runEvaluationCase({
            question: "hello",
            onThreadStarted: (threadId) => startedThreads.push(threadId),
        })

        assert.deepEqual(startedThreads, ["evaluation-session"])
    })

    it("forwards the hidden analysis thread callback through the Judge adapter", async () => {
        const client = new DeepSeekHarnessClient({
            binaryPath: "/bin/dsh",
            workspaceRoot: "/workspace",
            traceDirectory: mkdtempSync(join(tmpdir(), "rolling-skill-dsh-analysis-thread-")),
        })
        temporaryDirectories.push(client.traceDirectory)
        let evaluationInput
        client.runEvaluationCase = async (input) => {
            evaluationInput = input
            input.onThreadStarted?.("analysis-session")
            return {threadId: "analysis-session", response: "{}"}
        }
        const startedThreads = []

        await client.runEvaluationJudge({
            prompt: "classify",
            onThreadStarted: (threadId) => startedThreads.push(threadId),
        })

        assert.equal(evaluationInput.question, "classify")
        assert.equal(typeof evaluationInput.onThreadStarted, "function")
        assert.deepEqual(startedThreads, ["analysis-session"])
    })
})
