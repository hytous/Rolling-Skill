const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
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
    it("forwards dynamic tools only for their Operator thread and routes tool calls", async () => {
        const requests = []
        const writes = []
        const toolRequests = []
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            description: "Operator tools",
            tools: [{
                type: "function",
                name: "context_get",
                description: "Read context",
                inputSchema: {type: "object", properties: {}, additionalProperties: false},
            }],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {workspaceRoot: "/workspace", runtimes: []}
            },
        })
        client.request = async (method, params) => {
            requests.push({method, params})
            if (method === "turn/start") return {turn: {id: "turn-1", status: "inProgress"}}
            return {thread: {id: method === "thread/resume" ? params.threadId : `thread-${requests.length}`}}
        }
        client.write = (message) => writes.push(message)

        await client.startThread({dynamicTools})
        await client.startThread()
        await client.resumeThread("resumed-operator", {dynamicTools})
        await client.startTurn("thread-1", "work")
        client.handleMessage({
            id: 60,
            method: "item/tool/call",
            params: {
                threadId: "thread-1",
                turnId: "turn-1",
                callId: "call-1",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(requests[0].params.dynamicTools, dynamicTools)
        assert.equal(Object.hasOwn(requests[1].params, "dynamicTools"), false)
        assert.deepEqual(requests[2].params.dynamicTools, dynamicTools)
        assert.deepEqual(toolRequests, [{
            threadId: "thread-1",
            turnId: "turn-1",
            callId: "call-1",
            method: "context.get",
            params: {},
        }])
        assert.deepEqual(writes, [{
            id: 60,
            result: {
                contentItems: [{
                    type: "inputText",
                    text: JSON.stringify({workspaceRoot: "/workspace", runtimes: []}),
                }],
                success: true,
            },
        }])
    })

    it("fails closed for unknown, wrong-thread, callback-error, and oversized dynamic tool calls", async () => {
        const writes = []
        let callbackCalls = 0
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            description: "Operator tools",
            tools: [{
                type: "function",
                name: "context_get",
                description: "Read context",
                inputSchema: {type: "object"},
            }],
        }]
        const secret = "must-not-leak-from-tool-callback"
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            childEnvironment: {
                ROLLING_SKILL_CONTROL_SOCKET: "/private/codex.sock",
                ROLLING_SKILL_CONTROL_TOKEN: secret,
                ROLLING_SKILL_OPERATOR_SESSION: "operator-session",
            },
            requestTool: async ({params}) => {
                callbackCalls += 1
                if (params.fail) throw new Error(`${secret}:${"x".repeat(20_000)}`)
                if (params.reflect) return {value: secret}
                return {padding: "x".repeat(300_000)}
            },
        })
        client.request = async (method, params) => method === "turn/start"
            ? {turn: {id: "turn-1", status: "inProgress"}}
            : {thread: {id: params.threadId ?? "operator-thread"}}
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})
        await client.startTurn("operator-thread", "work")

        const base = {
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "turn-1",
                callId: "call-1",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        }
        client.handleMessage({id: 61, ...base, params: {...base.params, namespace: "other"}})
        client.handleMessage({id: 62, ...base, params: {...base.params, threadId: "ordinary-thread"}})
        client.handleMessage({id: 63, ...base, params: {...base.params, arguments: {fail: true}}})
        client.handleMessage({id: 64, ...base})
        client.handleMessage({id: 65, ...base, params: {...base.params, arguments: {reflect: true}}})
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(callbackCalls, 3)
        for (const id of [61, 62, 63, 64, 65]) {
            const response = writes.find((entry) => entry.id === id)
            assert.equal(response.result.success, false)
            assert.equal(response.result.contentItems.length, 1)
            assert.equal(response.result.contentItems[0].type, "inputText")
            assert.ok(Buffer.byteLength(response.result.contentItems[0].text) <= 4_096)
            assert.equal(response.result.contentItems[0].text.includes(secret), false)
            assert.deepEqual(JSON.parse(response.result.contentItems[0].text), {
                code: "CONTROL_ERROR",
                message: "Control operation failed",
                retryable: false,
                details: null,
            })
        }
    })

    it("rejects a forged dynamic Tool call while its Operator thread is idle", async () => {
        const writes = []
        let callbackCalls = 0
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async () => {
                callbackCalls += 1
                return {}
            },
        })
        client.request = async () => ({thread: {id: "operator-thread"}})
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        client.handleMessage({
            id: 66,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "forged-turn",
                callId: "forged-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(callbackCalls, 0)
        assert.equal(writes[0].result.success, false)
    })

    it("rejects a valid dynamic Tool identity until turn/start confirms the turn", async () => {
        const writes = []
        const toolRequests = []
        let resolveTurn
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            return new Promise((resolve) => {
                resolveTurn = resolve
            })
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        const starting = client.startTurn("operator-thread", "work")
        const call = (id, turnId) => client.handleMessage({
            id,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId,
                callId: `call-${id}`,
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        call(67, "forged-turn")
        await new Promise((resolve) => setImmediate(resolve))
        const earlyToolRequests = toolRequests.length
        const earlySuccess = writes.find((message) => message.id === 67).result.success

        resolveTurn({turn: {id: "real-turn", status: "inProgress"}})
        await starting
        call(68, "real-turn")
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(earlyToolRequests, 0)
        assert.equal(earlySuccess, false)
        assert.deepEqual(toolRequests.map((request) => request.turnId), ["real-turn"])
        assert.equal(writes.find((message) => message.id === 68).result.success, true)
    })

    it("waits for the matching turn/start response even after turn/started arrives", async () => {
        const writes = []
        const toolRequests = []
        let resolveTurn
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            return new Promise((resolve) => {
                resolveTurn = resolve
            })
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        const starting = client.startTurn("operator-thread", "work")
        client.handleMessage({
            method: "turn/started",
            params: {threadId: "operator-thread", turn: {id: "notified-turn", status: "inProgress"}},
        })
        client.handleMessage({
            id: 69,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "notified-turn",
                callId: "call-69",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))
        const earlyToolRequests = toolRequests.length
        const earlySuccess = writes.find((message) => message.id === 69).result.success

        resolveTurn({turn: {id: "notified-turn", status: "inProgress"}})
        await starting
        client.handleMessage({
            id: 70,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "notified-turn",
                callId: "call-70",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(earlyToolRequests, 0)
        assert.equal(earlySuccess, false)
        assert.deepEqual(toolRequests.map((request) => request.turnId), ["notified-turn"])
        assert.equal(writes.find((message) => message.id === 70).result.success, true)
    })

    it("rejects missing and stale dynamic Tool call identities without invoking the callback", async () => {
        const writes = []
        const toolRequests = []
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {workspaceRoot: "/workspace", runtimes: []}
            },
        })
        client.request = async (method, params) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            if (method === "turn/start") return {turn: {id: "active-turn", status: "inProgress"}}
            return {thread: {id: params.threadId}}
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})
        await client.startTurn("operator-thread", "work")

        const params = {
            threadId: "operator-thread",
            turnId: "active-turn",
            callId: "call-1",
            namespace: "rolling_skill",
            tool: "context_get",
            arguments: {},
        }
        client.handleMessage({id: 70, method: "item/tool/call", params: {...params, turnId: ""}})
        client.handleMessage({id: 71, method: "item/tool/call", params: {...params, callId: ""}})
        client.handleMessage({id: 72, method: "item/tool/call", params: {...params, turnId: "old-turn"}})
        client.handleMessage({id: 74, method: "item/tool/call", params: {...params, callId: "   "}})
        client.handleMessage({
            method: "turn/completed",
            params: {threadId: "operator-thread", turn: {id: "active-turn", status: "completed"}},
        })
        client.handleMessage({id: 73, method: "item/tool/call", params})
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(toolRequests.length, 0)
        assert.deepEqual(writes.map((message) => [message.id, message.result.success]), [
            [70, false],
            [71, false],
            [72, false],
            [74, false],
            [73, false],
        ])
    })

    it("does not reactivate a turn that completed before turn/start returned", async () => {
        const writes = []
        let callbackCalls = 0
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async () => {
                callbackCalls += 1
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            client.handleMessage({
                method: "turn/completed",
                params: {threadId: "operator-thread", turn: {id: "fast-turn", status: "completed"}},
            })
            return {turn: {id: "fast-turn", status: "completed"}}
        }
        client.write = (message) => writes.push(message)

        await client.startThread({dynamicTools})
        await client.startTurn("operator-thread", "work")
        client.handleMessage({
            id: 75,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "fast-turn",
                callId: "late-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(callbackCalls, 0)
        assert.equal(writes[0].result.success, false)
    })

    it("bounds pre-response terminal notifications without losing a matching completion", async () => {
        const writes = []
        let callbackCalls = 0
        let resolveTurn
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async () => {
                callbackCalls += 1
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            return new Promise((resolve) => {
                resolveTurn = resolve
            })
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        const starting = client.startTurn("operator-thread", "work")
        for (let index = 0; index < 1_000; index += 1) {
            client.handleMessage({
                method: "turn/completed",
                params: {
                    threadId: "operator-thread",
                    turn: {id: `terminal-${index}`, status: "completed"},
                },
            })
        }
        const recorded = client.dynamicToolTurnStates.get("operator-thread")
            ?.preResponseTerminalIds?.size ?? Number.POSITIVE_INFINITY
        resolveTurn({turn: {id: "terminal-0", status: "inProgress"}})
        await starting
        client.handleMessage({
            id: 76,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "terminal-0",
                callId: "late-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.ok(recorded <= 32)
        assert.equal(callbackCalls, 0)
        assert.equal(writes.find((message) => message.id === 76).result.success, false)
    })

    it("rejects dynamic Tool calls throughout resume and remains idle after resume", async () => {
        const writes = []
        let callbackCalls = 0
        let resolveResume
        const resumed = new Promise((resolve) => {
            resolveResume = resolve
        })
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async () => {
                callbackCalls += 1
                return {}
            },
        })
        client.request = async (method) => method === "thread/start"
            ? {thread: {id: "resumed-thread"}}
            : resumed
        client.write = (message) => writes.push(message)

        await client.startThread({dynamicTools})
        const resume = client.resumeThread("resumed-thread", {dynamicTools})
        const toolCall = (id) => client.handleMessage({
            id,
            method: "item/tool/call",
            params: {
                threadId: "resumed-thread",
                turnId: "forged-turn",
                callId: `call-${id}`,
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        toolCall(76)
        resolveResume({thread: {id: "resumed-thread"}})
        await resume
        toolCall(77)
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(callbackCalls, 0)
        assert.deepEqual(writes.map((message) => [message.id, message.result.success]), [
            [76, false],
            [77, false],
        ])
    })

    it("allows only one starting or active startTurn for an Operator thread", async () => {
        const writes = []
        const turnResolvers = []
        let turnStartRequests = 0
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            turnStartRequests += 1
            return new Promise((resolve) => turnResolvers.push(resolve))
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        const first = client.startTurn("operator-thread", "first")
        const concurrent = client.startTurn("operator-thread", "concurrent").then(
            (value) => ({status: "fulfilled", value}),
            (reason) => ({status: "rejected", reason}),
        )
        await new Promise((resolve) => setImmediate(resolve))
        for (const [index, resolve] of turnResolvers.entries()) {
            resolve({turn: {id: `turn-${index + 1}`, status: "inProgress"}})
        }
        const [firstResult, concurrentResult] = await Promise.all([
            first.then(
                (value) => ({status: "fulfilled", value}),
                (reason) => ({status: "rejected", reason}),
            ),
            concurrent,
        ])
        assert.equal(firstResult.status, "fulfilled")
        assert.equal(concurrentResult.status, "rejected")
        assert.equal(concurrentResult.reason.message, "Codex Operator turn is already in progress")
        assert.equal(turnStartRequests, 1)

        await assert.rejects(client.startTurn("operator-thread", "while-active"), {
            message: "Codex Operator turn is already in progress",
        })
        assert.equal(turnStartRequests, 1)
    })

    it("does not let a retired turn notification confirm a later startTurn", async () => {
        const writes = []
        const toolRequests = []
        let resolveTurn
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            if (method === "turn/start" && resolveTurn === undefined) {
                resolveTurn = null
                return {turn: {id: "old-turn", status: "inProgress"}}
            }
            return new Promise((resolve) => {
                resolveTurn = resolve
            })
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})
        await client.startTurn("operator-thread", "old")
        client.handleMessage({
            method: "turn/completed",
            params: {threadId: "operator-thread", turn: {id: "old-turn", status: "completed"}},
        })

        const starting = client.startTurn("operator-thread", "new")
        client.handleMessage({
            method: "turn/started",
            params: {threadId: "operator-thread", turn: {id: "old-turn", status: "inProgress"}},
        })
        client.handleMessage({
            id: 78,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "old-turn",
                callId: "stale-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(toolRequests.length, 0)
        assert.equal(writes.find((message) => message.id === 78).result.success, false)

        resolveTurn({turn: {id: "new-turn", status: "inProgress"}})
        await starting
    })

    it("ignores a failed generation's late notifications while the next start is pending", async () => {
        const writes = []
        const toolRequests = []
        let rejectFirst
        let resolveSecond
        let turnStartRequests = 0
        const dynamicTools = [{
            type: "namespace",
            name: "rolling_skill",
            tools: [{type: "function", name: "context_get", inputSchema: {type: "object"}}],
        }]
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestTool: async (request) => {
                toolRequests.push(request)
                return {}
            },
        })
        client.request = async (method) => {
            if (method === "thread/start") return {thread: {id: "operator-thread"}}
            turnStartRequests += 1
            return new Promise((resolve, reject) => {
                if (turnStartRequests === 1) rejectFirst = reject
                else resolveSecond = resolve
            })
        }
        client.write = (message) => writes.push(message)
        await client.startThread({dynamicTools})

        const failed = client.startTurn("operator-thread", "old")
        rejectFirst(new Error("old start failed"))
        await assert.rejects(failed, {message: "old start failed"})
        const next = client.startTurn("operator-thread", "new")
        client.handleMessage({
            method: "turn/started",
            params: {threadId: "operator-thread", turn: {id: "old-turn", status: "inProgress"}},
        })
        client.handleMessage({
            method: "turn/completed",
            params: {threadId: "operator-thread", turn: {id: "old-turn", status: "failed"}},
        })
        client.handleMessage({
            id: 79,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "old-turn",
                callId: "old-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))
        const earlyToolRequests = toolRequests.length
        const earlySuccess = writes.find((message) => message.id === 79).result.success

        resolveSecond({turn: {id: "new-turn", status: "inProgress"}})
        const nextResult = await next.then(
            (value) => ({status: "fulfilled", value}),
            (reason) => ({status: "rejected", reason}),
        )
        client.handleMessage({
            id: 80,
            method: "item/tool/call",
            params: {
                threadId: "operator-thread",
                turnId: "new-turn",
                callId: "new-call",
                namespace: "rolling_skill",
                tool: "context_get",
                arguments: {},
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(earlyToolRequests, 0)
        assert.equal(earlySuccess, false)
        assert.equal(nextResult.status, "fulfilled")
        assert.deepEqual(toolRequests.map((request) => request.turnId), ["new-turn"])
        assert.equal(writes.find((message) => message.id === 80).result.success, true)
    })

    it("routes command approval requests through the injected permission callback", async () => {
        const writes = []
        const requests = []
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestPermission: async (request) => {
                requests.push(request)
                return "accept"
            },
        })
        client.write = (message) => writes.push(message)

        client.handleMessage({
            id: 91,
            method: "item/commandExecution/requestApproval",
            params: {
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "command-1",
                command: "cp source target",
                cwd: "/tmp/workspace",
                availableDecisions: ["accept", "acceptForSession", "decline"],
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(requests.length, 1)
        assert.equal(requests[0].params.sessionId, "thread-1")
        assert.deepEqual(requests[0].options.map((entry) => entry.optionId), [
            "accept",
            "acceptForSession",
            "decline",
        ])
        assert.deepEqual(writes, [{id: 91, result: {decision: "accept"}}])
    })

    it("routes request_user_input and maps answers back to the Codex protocol", async () => {
        const writes = []
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            requestQuestion: async (request) => {
                assert.equal(request.sessionId, "thread-1")
                assert.equal(request.questions[0].id, "confirm")
                return {
                    answers: [{questionId: "confirm", answers: ["Continue overwrite"]}],
                }
            },
        })
        client.write = (message) => writes.push(message)

        client.handleMessage({
            id: "question-1",
            method: "item/tool/requestUserInput",
            params: {
                threadId: "thread-1",
                turnId: "turn-1",
                itemId: "question-item",
                isBlocking: true,
                questions: [{
                    id: "confirm",
                    header: "Overwrite",
                    question: "Continue?",
                    isOther: false,
                    isSecret: false,
                    options: [{label: "Continue overwrite", description: "Replace the target"}],
                }],
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(writes, [{
            id: "question-1",
            result: {answers: {confirm: {answers: ["Continue overwrite"]}}},
        }])
    })

    it("fails closed for denied or unsupported Codex client requests", async () => {
        const writes = []
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.write = (message) => writes.push(message)

        client.handleMessage({
            id: 1,
            method: "item/fileChange/requestApproval",
            params: {threadId: "thread-1", turnId: "turn-1", itemId: "patch-1"},
        })
        client.handleMessage({id: 2, method: "unknown/request", params: {}})
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(writes.find((entry) => entry.id === 1), {
            id: 1,
            result: {decision: "decline"},
        })
        assert.equal(writes.find((entry) => entry.id === 2).error.code, -32601)
    })

    it("uses the temporary codex_exec originator while retaining the Rolling Skill title", async () => {
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

        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-originator-trace-"))
        const child = new FakeChild()
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory,
            workspaceRoot: "/tmp/workspace",
            spawnProcess: () => child,
        })

        try {
            const started = client.start()
            await new Promise((resolve) => setImmediate(resolve))
            child.stdout.emit("data", `${JSON.stringify({id: 1, result: {userAgent: "Codex"}})}\n`)
            await started

            assert.equal(writes[0].method, "initialize")
            assert.deepEqual(writes[0].params.clientInfo, {
                name: "codex_exec",
                title: "Rolling Skill",
                version: require("../package.json").version,
            })
        } finally {
            await client.stop()
            rmSync(traceDirectory, {recursive: true, force: true})
        }
    })

    it("merges only explicit Operator child credentials and redacts stderr logs", async () => {
        const writes = []
        const runtimeLogs = []
        let spawnOptions
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
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-codex-operator-env-"))
        const childEnvironment = {
            ROLLING_SKILL_CONTROL_SOCKET: "/private/operator.sock",
            ROLLING_SKILL_CONTROL_TOKEN: "codex-operator-token",
            ROLLING_SKILL_OPERATOR_SESSION: "codex-operator-session",
            SHOULD_NOT_PASS: "unknown-environment",
        }
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory,
            workspaceRoot: "/tmp/workspace",
            childEnvironment,
            requestQuestion: async () => {
                throw new Error(`question failed: ${childEnvironment.ROLLING_SKILL_CONTROL_TOKEN}`)
            },
            spawnProcess: (_path, _args, options) => {
                spawnOptions = options
                return child
            },
        })
        client.on("runtimeLog", (message) => runtimeLogs.push(message))

        try {
            const started = client.start()
            await new Promise((resolve) => setImmediate(resolve))
            child.stdout.emit("data", `${JSON.stringify({id: 1, result: {userAgent: "Codex"}})}\n`)
            await started
            child.stderr.emit("data", Buffer.from("ROLLING_SKILL_CONTROL_TOKEN=codex-oper"))
            child.stderr.emit("data", Buffer.from(
                `ator-token ${childEnvironment.ROLLING_SKILL_CONTROL_SOCKET}\n`,
            ))
            client.handleMessage({
                id: 90,
                method: "item/tool/requestUserInput",
                params: {threadId: "operator", questions: []},
            })
            await new Promise((resolve) => setImmediate(resolve))

            assert.equal(spawnOptions.env.ROLLING_SKILL_CONTROL_SOCKET, "/private/operator.sock")
            assert.equal(spawnOptions.env.ROLLING_SKILL_CONTROL_TOKEN, "codex-operator-token")
            assert.equal(spawnOptions.env.ROLLING_SKILL_OPERATOR_SESSION, "codex-operator-session")
            assert.equal(Object.hasOwn(spawnOptions.env, "SHOULD_NOT_PASS"), false)
            const diagnostic = JSON.stringify({runtimeLogs, trace: client.recentTrace(50), writes})
            assert.equal(runtimeLogs.join("").includes("codex-operator-token"), false)
            for (const forbidden of [
                "ROLLING_SKILL_CONTROL_SOCKET",
                "ROLLING_SKILL_CONTROL_TOKEN",
                "ROLLING_SKILL_OPERATOR_SESSION",
                "/private/operator.sock",
                "codex-operator-token",
                "codex-operator-session",
            ]) assert.equal(diagnostic.includes(forbidden), false, forbidden)
        } finally {
            await client.stop()
            rmSync(traceDirectory, {recursive: true, force: true})
        }
    })

    it("flushes an unterminated redacted stderr line when forced stop receives no close", async () => {
        const runtimeLogs = []
        const token = "codex-stop-flush-token"
        class HangingChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.stdin = {writable: true, write: () => {}}
                this.killed = false
            }
            kill() {
                this.killed = true
            }
        }
        const child = new HangingChild()
        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-codex-stop-flush-"))
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory,
            workspaceRoot: "/tmp/workspace",
            shutdownTimeoutMs: 5,
            childEnvironment: {
                ROLLING_SKILL_CONTROL_SOCKET: "/private/stop-flush.sock",
                ROLLING_SKILL_CONTROL_TOKEN: token,
                ROLLING_SKILL_OPERATOR_SESSION: "stop-flush-session",
            },
            spawnProcess: () => child,
        })
        client.on("runtimeLog", (message) => runtimeLogs.push(message))

        try {
            const started = client.start()
            await new Promise((resolve) => setImmediate(resolve))
            child.stdout.emit("data", `${JSON.stringify({id: 1, result: {userAgent: "Codex"}})}\n`)
            await started
            child.stderr.emit("data", Buffer.from(`unterminated ${token}`))
            await client.stop()

            assert.equal(client.state().status, "stopped")
            assert.equal(runtimeLogs.join("").includes(token), false)
            assert.match(runtimeLogs.join(""), /unterminated \[REDACTED\]/u)
        } finally {
            rmSync(traceDirectory, {recursive: true, force: true})
        }
    })

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

    it("lists active threads by default and archived threads on request", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        const requests = []
        client.request = async (method, params) => {
            requests.push({method, params})
            return {data: []}
        }

        await client.listThreads()
        await client.listThreads({archived: false})
        await client.listThreads({archived: true})

        assert.deepEqual(
            requests.map(({method, params}) => ({method, archived: params.archived})),
            [
                {method: "thread/list", archived: false},
                {method: "thread/list", archived: false},
                {method: "thread/list", archived: true},
            ],
        )
        assert.equal(requests.every(({params}) => params.cwd === "/tmp/workspace"), true)
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

    it("applies approval and sandbox overrides directly on the turn", async () => {
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
            approvalPolicy: "never",
            sandbox: "workspace-write",
        })

        assert.equal(request.params.approvalPolicy, "never")
        assert.deepEqual(request.params.sandboxPolicy, {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
        })
    })

    it("sends explicit nulls when the user resets turn settings to runtime defaults", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-default"}}
        }

        await client.startTurn("thread-1", "hello", {model: null, effort: null})

        assert.equal(request.method, "turn/start")
        assert.equal(request.params.model, null)
        assert.equal(request.params.effort, null)
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

    it("sets a user-facing task name through the supported thread protocol", async () => {
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

        await client.setThreadName("thread-1", "Skill 自动优化 · billing · adcf41f4")

        assert.deepEqual(request, {
            method: "thread/name/set",
            params: {
                threadId: "thread-1",
                name: "Skill 自动优化 · billing · adcf41f4",
            },
        })
    })

    it("applies a client-level execution policy to thread start and resume", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            executionPolicy: {
                sandbox: "danger-full-access",
                approvalPolicy: "never",
            },
        })
        const requests = []
        client.request = async (method, params) => {
            requests.push({method, params})
            return {thread: {id: "thread-1"}}
        }

        await client.startThread()
        await client.resumeThread("thread-1")
        client.setExecutionPolicy({
            sandbox: "workspace-write",
            approvalPolicy: "never",
        })
        await client.startThread()

        assert.deepEqual(
            requests.map(({method, params}) => ({
                method,
                sandbox: params.sandbox,
                approvalPolicy: params.approvalPolicy,
            })),
            [
                {
                    method: "thread/start",
                    sandbox: "danger-full-access",
                    approvalPolicy: "never",
                },
                {
                    method: "thread/resume",
                    sandbox: "danger-full-access",
                    approvalPolicy: "never",
                },
                {
                    method: "thread/start",
                    sandbox: "workspace-write",
                    approvalPolicy: "never",
                },
            ],
        )
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

    it("unarchives a thread through the supported protocol method", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {thread: {id: "thread-1"}}
        }

        const response = await client.unarchiveThread("thread-1")

        assert.deepEqual(request, {
            method: "thread/unarchive",
            params: {threadId: "thread-1"},
        })
        assert.deepEqual(response, {thread: {id: "thread-1"}})
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

    it("runs an evaluation Judge in a fresh ephemeral read-only subagent thread", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        const threadOptions = []
        const turnCalls = []
        const startedThreads = []
        client.recorder = {
            latestReference: "trace://judge.jsonl#L9",
            mark: () => ({line: 2}),
            referenceFrom: () => "trace://judge.jsonl#L3-L9",
            evidenceForReference: (reference) => ({reference, events: [{sequence: 3}]}),
        }
        client.startThread = async (options) => {
            threadOptions.push(options)
            return {thread: {id: `judge-thread-${threadOptions.length}`}}
        }
        client.startTurn = async (threadId, prompt, options) => {
            turnCalls.push({threadId, prompt, options})
            const turnId = `judge-turn-${turnCalls.length}`
            setImmediate(() => {
                client.emit("notification", {
                    method: "item/completed",
                    params: {
                        threadId,
                        item: {type: "agentMessage", text: '{"schemaVersion":"judge/v1"}'},
                    },
                })
                client.emit("notification", {
                    method: "turn/completed",
                    params: {threadId, turn: {id: turnId, status: "completed"}},
                })
            })
            return {turn: {id: turnId}}
        }

        const first = await client.runEvaluationJudge({
            prompt: "judge this",
            modelId: "gpt-5.6-sol",
            effort: "xhigh",
            timeoutMs: 1_000,
            onThreadStarted: (threadId) => startedThreads.push(threadId),
        })
        const second = await client.runEvaluationJudge({
            prompt: "judge that",
            modelId: "gpt-5.6-sol",
            effort: "xhigh",
            timeoutMs: 1_000,
            onThreadStarted: (threadId) => startedThreads.push(threadId),
        })

        assert.deepEqual(startedThreads, ["judge-thread-1", "judge-thread-2"])

        assert.deepEqual(threadOptions, [
            {
                model: "gpt-5.6-sol",
                threadSource: "subagent",
                ephemeral: true,
                sandbox: "read-only",
                approvalPolicy: "never",
            },
            {
                model: "gpt-5.6-sol",
                threadSource: "subagent",
                ephemeral: true,
                sandbox: "read-only",
                approvalPolicy: "never",
            },
        ])
        assert.deepEqual(turnCalls[0], {
            threadId: "judge-thread-1",
            prompt: "judge this",
            options: {
                model: "gpt-5.6-sol",
                effort: "xhigh",
                sandbox: "read-only",
                approvalPolicy: "never",
            },
        })
        assert.equal(first.threadId, "judge-thread-1")
        assert.equal(first.turnId, "judge-turn-1")
        assert.equal(first.response, '{"schemaVersion":"judge/v1"}')
        assert.equal(first.traceReference, "trace://judge.jsonl#L3-L9")
        assert.deepEqual(first.traceEvidence, {
            reference: "trace://judge.jsonl#L3-L9",
            events: [{sequence: 3}],
        })
        assert.equal(typeof first.durationMs, "number")
        assert.equal(second.threadId, "judge-thread-2")
        assert.notEqual(second.threadId, first.threadId)
    })

    it("returns a Case-scoped trace range and bounded evidence", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.recorder = {
            mark: () => ({line: 10}),
            referenceFrom: () => "trace://case.jsonl#L11-L18",
            evidenceForReference: (reference) => ({reference, entries: [{sequence: 11}]}),
        }
        client.startThread = async () => ({thread: {id: "evaluation-thread"}})
        client.startTurn = async () => {
            setImmediate(() => {
                client.emit("notification", {
                    method: "turn/completed",
                    params: {
                        threadId: "evaluation-thread",
                        turn: {id: "evaluation-turn", status: "completed"},
                    },
                })
            })
            return {turn: {id: "evaluation-turn"}}
        }

        const startedThreads = []
        const result = await client.runEvaluationCase({
            question: "hello",
            timeoutMs: 1_000,
            onThreadStarted: (threadId) => startedThreads.push(threadId),
        })

        assert.deepEqual(startedThreads, ["evaluation-thread"])
        assert.equal(result.traceReference, "trace://case.jsonl#L11-L18")
        assert.deepEqual(result.traceEvidence, {
            reference: "trace://case.jsonl#L11-L18",
            entries: [{sequence: 11}],
        })
    })

    it("interrupts a timed-out target turn and returns preserved diagnostics", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        const interrupts = []
        client.recorder = {
            mark: () => ({line: 10}),
            referenceFrom: () => "trace://timeout.jsonl#L11-L19",
            evidenceForReference: (reference) => ({reference, entries: [{sequence: 19}]}),
        }
        client.startThread = async () => ({thread: {id: "timed-out-thread"}})
        client.startTurn = async () => ({turn: {id: "timed-out-turn"}})
        client.interruptTurn = async (threadId, turnId) => {
            interrupts.push([threadId, turnId])
        }

        let failure
        await assert.rejects(
            client.runEvaluationCase({question: "hello", timeoutMs: 5}),
            (error) => {
                failure = error
                return /timed out/.test(error.message)
            },
        )

        assert.deepEqual(interrupts, [["timed-out-thread", "timed-out-turn"]])
        assert.equal(failure.code, "EVALUATION_TURN_TIMEOUT")
        assert.equal(failure.threadId, "timed-out-thread")
        assert.equal(failure.turnId, "timed-out-turn")
        assert.equal(failure.traceReference, "trace://timeout.jsonl#L11-L19")
        assert.deepEqual(failure.traceEvidence, {
            reference: "trace://timeout.jsonl#L11-L19",
            entries: [{sequence: 19}],
        })
        assert.equal(typeof failure.durationMs, "number")
        assert.match(failure.lastActivityAt, /^\d{4}-\d{2}-\d{2}T/)
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
