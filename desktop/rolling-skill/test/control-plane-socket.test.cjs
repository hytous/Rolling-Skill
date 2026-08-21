const assert = require("node:assert/strict")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const {spawn} = require("node:child_process")
const {EventEmitter, once} = require("node:events")
const {describe, it} = require("node:test")

const {createPublicControlError} = require("../src/control-plane/contracts.cjs")
const {
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    CONTROL_SOCKET_QUARANTINE_PREFIX,
    DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    DEFAULT_MAX_QUEUED_RESPONSES,
    MAX_CONTROL_MESSAGE_BYTES,
    ControlSocketServer,
    attachControlSocketConnection,
} = require("../src/control-plane/socket-server.cjs")
const {
    DEFAULT_CONTROL_SOCKET_TIMEOUT_MS,
    DEFAULT_MAX_PENDING_REQUESTS,
    DEFAULT_MAX_UNSENT_REQUESTS,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketClient,
} = require("../src/control-plane/socket-client.cjs")

async function temporaryUserData(t) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rolling-control-"))
    await fs.promises.chmod(directory, 0o700)
    t.after(async () => {
        await fs.promises.rm(directory, {recursive: true, force: true})
    })
    return directory
}

function expectedSocketPath(userData) {
    return path.join(userData, CONTROL_SOCKET_DIRECTORY, CONTROL_SOCKET_NAME)
}

async function waitFor(predicate, message = "condition was not met") {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.fail(message)
}

async function connectRaw(socketPath) {
    const socket = net.createConnection(socketPath)
    socket.on("error", () => {})
    await once(socket, "connect")
    return socket
}

async function nextJsonLine(socket) {
    let buffer = ""
    for await (const chunk of socket) {
        buffer += chunk.toString("utf8")
        const newline = buffer.indexOf("\n")
        if (newline >= 0) return JSON.parse(buffer.slice(0, newline))
    }
    throw new Error("socket closed before a JSON line arrived")
}

async function startControlServer(t, controlPlane, options = {}) {
    const userData = options.userData ?? await temporaryUserData(t)
    const server = new ControlSocketServer({userData, controlPlane, ...options})
    await server.start()
    t.after(async () => server.close())
    return {server, userData}
}

async function listenUnixServer(t, socketPath, onConnection) {
    const sockets = new Set()
    const server = net.createServer((socket) => {
        sockets.add(socket)
        socket.once("close", () => sockets.delete(socket))
        onConnection(socket)
    })
    await new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(socketPath, resolve)
    })
    t.after(async () => {
        for (const socket of sockets) socket.destroy()
        if (server.listening) await new Promise((resolve) => server.close(resolve))
        await fs.promises.rm(socketPath, {force: true})
    })
    return server
}

async function makeStaleUnixSocket(socketPath) {
    const source = [
        'const net = require("node:net")',
        "const server = net.createServer()",
        'server.listen(process.argv[1], () => process.stdout.write("ready\\n"))',
        "setInterval(() => {}, 1_000)",
    ].join(";")
    const child = spawn(process.execPath, ["-e", source, socketPath], {
        stdio: ["ignore", "pipe", "pipe"],
    })
    let stderr = ""
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
    })
    await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(([code]) => {
            throw new Error(`stale socket helper exited ${code}: ${stderr}`)
        }),
    ])
    child.kill("SIGKILL")
    await once(child, "exit")
    assert.equal((await fs.promises.lstat(socketPath)).isSocket(), true)
}

function controlRequestLine(id, params = {}) {
    return `${JSON.stringify({
        id,
        method: "context.get",
        params,
        token: "opaque",
        sessionId: "operator",
    })}\n`
}

function nextTurn() {
    return new Promise((resolve) => setImmediate(resolve))
}

class FakeSocket extends EventEmitter {
    constructor({autoConnect = false, writeResults = []} = {}) {
        super()
        this.destroyed = false
        this.writable = true
        this.writes = []
        this.writeResults = [...writeResults]
        this.pauseCount = 0
        this.resumeCount = 0
        if (autoConnect) queueMicrotask(() => this.emit("connect"))
    }

    write(line, callback) {
        if (this.destroyed) throw new Error("fake socket is destroyed")
        this.writes.push(line)
        if (callback) queueMicrotask(() => callback())
        return this.writeResults.length > 0 ? this.writeResults.shift() : true
    }

    pause() {
        this.pauseCount += 1
        return this
    }

    resume() {
        this.resumeCount += 1
        return this
    }

    destroy() {
        if (this.destroyed) return this
        this.destroyed = true
        this.writable = false
        queueMicrotask(() => this.emit("close"))
        return this
    }
}

function assertFixedControlError(error, secrets = []) {
    assert.equal(error.code, "CONTROL_ERROR")
    assert.equal(error.message, "Control operation failed")
    assert.equal(error.retryable, false)
    assert.equal(error.details, null)
    assert.equal(Object.hasOwn(error, "cause"), false)
    assert.equal(Object.hasOwn(error, "rawResponse"), false)
    const serialized = JSON.stringify({
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        details: error.details,
    })
    for (const secret of secrets) assert.equal(serialized.includes(secret), false)
    return true
}

describe("owner-only control socket transport", () => {
    it("routes a request with session authority and returns one JSON result", async (t) => {
        const invocations = []
        const {server, userData} = await startControlServer(t, {
            async invoke(request) {
                invocations.push(request)
                return {workspaceRoot: "/workspace", runtimes: []}
            },
        })
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "opaque-secret",
            sessionId: "operator-1",
            idFactory: () => "request-1",
        })
        t.after(() => client.close())

        const result = await client.invoke("context.get", {})

        assert.deepEqual(result, {workspaceRoot: "/workspace", runtimes: []})
        assert.deepEqual(invocations, [{
            token: "opaque-secret",
            sessionId: "operator-1",
            method: "context.get",
            params: {},
        }])
        assert.equal(server.socketPath, expectedSocketPath(userData))
        const controlStat = await fs.promises.lstat(path.dirname(server.socketPath))
        assert.equal(controlStat.isDirectory(), true)
        assert.equal(controlStat.mode & 0o777, 0o700)
        if (typeof process.getuid === "function") assert.equal(controlStat.uid, process.getuid())
        if (process.platform === "darwin") {
            const socketStat = await fs.promises.lstat(server.socketPath)
            assert.equal(socketStat.mode & 0o777, 0o600)
        }
    })

    it("publishes trusted errors and sanitizes unknown exceptions", async (t) => {
        const {server} = await startControlServer(t, {
            async invoke({method}) {
                if (method === "context.get") {
                    throw createPublicControlError("CONTROL_BUSY", {
                        internalMessage: "private scheduling state",
                    })
                }
                throw new Error("database password and internal stack")
            },
        })
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "token-not-for-errors",
            sessionId: "session-not-for-errors",
        })
        t.after(() => client.close())

        await assert.rejects(client.invoke("context.get", {}), (error) => {
            assert.equal(error.code, "CONTROL_BUSY")
            assert.equal(error.message, "Control operation is busy")
            assert.equal(error.retryable, true)
            assert.equal(error.details, null)
            assert.doesNotMatch(error.message, /private scheduling state/u)
            return true
        })
        await assert.rejects(client.invoke("runtimes.list", {}), (error) => {
            assert.equal(error.code, "CONTROL_ERROR")
            assert.equal(error.message, "Control operation failed")
            assert.equal(error.retryable, false)
            assert.equal(error.details, null)
            assert.doesNotMatch(error.message, /password|stack|token-not|session-not/u)
            return true
        })
    })

    it("rebuilds remote public errors and rejects secret or untrusted provenance", async (t) => {
        const userData = await temporaryUserData(t)
        const socketPath = path.join(userData, "remote-errors.sock")
        const remoteErrors = new Map([
            ["secret-code", {
                code: "CONTROL_BUSY",
                message: "Control operation is busy",
                retryable: true,
                details: null,
            }],
            ["secret-message", {
                code: "CONTROL_BUSY",
                message: "before-message-secret-after",
                retryable: true,
                details: null,
            }],
            ["secret-details", {
                code: "FORBIDDEN",
                message: "Control action is forbidden",
                retryable: false,
                details: {action: "context.read", scopes: ["raw_cases.read"]},
            }],
            ["invalid-code", {
                code: "REMOTE_PRIVATE_FAILURE",
                message: "remote private failure",
                retryable: true,
                details: {raw: "private"},
            }],
            ["invalid-message", {
                code: "CONTROL_BUSY",
                message: "spoofed public message",
                retryable: true,
                details: null,
            }],
            ["invalid-details", {
                code: "FORBIDDEN",
                message: "Control action is forbidden",
                retryable: false,
                details: {action: "not-an-action"},
            }],
        ])
        await listenUnixServer(t, socketPath, (socket) => {
            let buffer = ""
            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8")
                let newline = buffer.indexOf("\n")
                while (newline >= 0) {
                    const request = JSON.parse(buffer.slice(0, newline))
                    buffer = buffer.slice(newline + 1)
                    socket.write(`${JSON.stringify({
                        id: request.id,
                        error: remoteErrors.get(request.id),
                    })}\n`)
                    newline = buffer.indexOf("\n")
                }
            })
        })

        const scenarios = [
            {id: "secret-code", token: "CONTROL_BUSY", sessionId: "operator-code"},
            {id: "secret-message", token: "message-secret", sessionId: "operator-message"},
            {id: "secret-details", token: "opaque-detail", sessionId: "cases.read"},
            {id: "invalid-code", token: "opaque-code", sessionId: "operator-invalid-code"},
            {id: "invalid-message", token: "opaque-message", sessionId: "operator-invalid-message"},
            {id: "invalid-details", token: "opaque-details", sessionId: "operator-invalid-details"},
        ]
        for (const scenario of scenarios) {
            const client = new ControlSocketClient({
                socketPath,
                token: scenario.token,
                sessionId: scenario.sessionId,
            })
            t.after(() => client.close())
            await assert.rejects(
                client.invoke("context.get", {}, {id: scenario.id}),
                (error) => assertFixedControlError(
                    error,
                    [scenario.token, scenario.sessionId, "before-", "-after"],
                ),
            )
        }
    })

    it("closes only malformed or oversized connections and continues serving clients", async (t) => {
        let calls = 0
        const {server} = await startControlServer(t, {
            async invoke() {
                calls += 1
                return {ok: true}
            },
        })

        const malformed = await connectRaw(server.socketPath)
        const malformedClosed = once(malformed, "close")
        malformed.write(
            'not-json\n{"id":"trailing","method":"context.get","params":{},' +
            '"token":"opaque","sessionId":"operator"}\n',
        )
        await malformedClosed

        const oversized = await connectRaw(server.socketPath)
        const oversizedClosed = once(oversized, "close")
        oversized.write(Buffer.alloc(MAX_CONTROL_MESSAGE_BYTES + 1, 0x61))
        await oversizedClosed

        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        t.after(() => client.close())
        assert.deepEqual(await client.invoke("context.get", {}), {ok: true})
        assert.equal(calls, 1)
    })

    it("requires a plain request with bounded own fields and resists hostile JSON", async (t) => {
        let calls = 0
        const {server} = await startControlServer(t, {
            async invoke() {
                calls += 1
                return {ok: true}
            },
        })

        for (const payload of [
            "[]\n",
            '{"id":"missing-token","method":"context.get","params":{},"sessionId":"s"}\n',
            `${JSON.stringify({
                id: "x".repeat(MAX_CONTROL_REQUEST_ID_LENGTH + 1),
                method: "context.get",
                params: {},
                token: "t",
                sessionId: "s",
            })}\n`,
            '{"id":"hostile","method":"context.get","params":{},"token":"t","sessionId":"s","__proto__":{"polluted":true}}\n',
        ]) {
            const socket = await connectRaw(server.socketPath)
            const closed = once(socket, "close")
            socket.write(payload)
            await closed
        }

        assert.equal(calls, 0)
        assert.equal(Object.prototype.polluted, undefined)
    })

    it("uses a 15-second default timeout and removes only the timed-out request", async (t) => {
        assert.equal(DEFAULT_CONTROL_SOCKET_TIMEOUT_MS, 15_000)
        let releaseSlow
        const {server} = await startControlServer(t, {
            async invoke({method}) {
                if (method === "context.get") {
                    return new Promise((resolve) => {
                        releaseSlow = resolve
                    })
                }
                return {runtimes: []}
            },
        })
        let timerCallback = null
        let observedDelay = null
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "timeout-secret-token",
            sessionId: "timeout-secret-session",
            setTimeoutFn(callback, delay) {
                timerCallback = callback
                observedDelay = delay
                return {callback}
            },
            clearTimeoutFn() {},
        })
        t.after(() => client.close())

        const slow = client.invoke("context.get", {}, {id: "slow"})
        await waitFor(() => timerCallback !== null)
        assert.equal(observedDelay, 15_000)
        timerCallback()
        await assert.rejects(slow, (error) => {
            assert.match(error.message, /timed out/i)
            assert.doesNotMatch(error.message, /timeout-secret/u)
            return true
        })
        assert.deepEqual(
            await client.invoke("runtimes.list", {}, {id: "still-live"}),
            {runtimes: []},
        )
        releaseSlow({late: true})
    })

    it("correlates concurrent IDs when replies complete out of order", async (t) => {
        const resolvers = new Map()
        const {server} = await startControlServer(t, {
            invoke({params}) {
                return new Promise((resolve) => resolvers.set(params.order, resolve))
            },
        })
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        t.after(() => client.close())

        const first = client.invoke("raw_cases.list", {order: 1}, {id: "first"})
        const second = client.invoke("raw_cases.list", {order: 2}, {id: "second"})
        await waitFor(() => resolvers.size === 2)
        resolvers.get(2)({order: 2})
        assert.deepEqual(await second, {order: 2})
        resolvers.get(1)({order: 1})
        assert.deepEqual(await first, {order: 1})
    })

    it("bounds server in-flight dispatch and pauses until work settles", async () => {
        assert.equal(DEFAULT_MAX_IN_FLIGHT_REQUESTS, 32)
        assert.equal(DEFAULT_MAX_QUEUED_RESPONSES, 32)
        const resolvers = new Map()
        const calls = []
        const socket = new FakeSocket()
        attachControlSocketConnection(socket, {
            invoke({params}) {
                calls.push(params.order)
                return new Promise((resolve) => resolvers.set(params.order, resolve))
            },
        }, {maxInFlightRequests: 2, maxQueuedResponses: 2})

        socket.emit("data", Buffer.from(
            controlRequestLine("one", {order: 1}) +
            controlRequestLine("two", {order: 2}),
        ))
        await nextTurn()
        assert.deepEqual(calls, [1, 2])
        assert.equal(socket.pauseCount, 1)
        assert.equal(socket.destroyed, false)

        resolvers.get(1)({order: 1})
        await nextTurn()
        assert.equal(socket.resumeCount, 1)

        const overflowCalls = []
        const overflowSocket = new FakeSocket()
        attachControlSocketConnection(overflowSocket, {
            invoke({params}) {
                overflowCalls.push(params.order)
                return new Promise(() => {})
            },
        }, {maxInFlightRequests: 2, maxQueuedResponses: 2})
        overflowSocket.emit("data", Buffer.from(
            [1, 2, 3].map((order) =>
                controlRequestLine(`overflow-${order}`, {order}),
            ).join(""),
        ))
        await nextTurn()
        assert.deepEqual(overflowCalls, [1, 2])
        assert.equal(overflowSocket.destroyed, true)
    })

    it("queues server responses after write false and caps that queue", async () => {
        const socket = new FakeSocket({writeResults: [false, true, true]})
        const resolvers = new Map()
        attachControlSocketConnection(socket, {
            invoke({params}) {
                return new Promise((resolve) => resolvers.set(params.order, resolve))
            },
        }, {maxInFlightRequests: 3, maxQueuedResponses: 2})
        socket.emit("data", Buffer.from(
            [1, 2, 3].map((order) =>
                controlRequestLine(`response-${order}`, {order}),
            ).join(""),
        ))
        await nextTurn()
        resolvers.get(1)({order: 1})
        resolvers.get(2)({order: 2})
        resolvers.get(3)({order: 3})
        await nextTurn()

        assert.equal(socket.writes.length, 1)
        assert.ok(socket.pauseCount >= 1)
        socket.emit("drain")
        await nextTurn()
        assert.deepEqual(
            socket.writes.map((line) => JSON.parse(line).id),
            ["response-1", "response-2", "response-3"],
        )
        assert.ok(socket.resumeCount >= 1)

        const bounded = new FakeSocket({writeResults: [false]})
        const boundedResolvers = new Map()
        attachControlSocketConnection(bounded, {
            invoke({params}) {
                return new Promise((resolve) => boundedResolvers.set(params.order, resolve))
            },
        }, {maxInFlightRequests: 4, maxQueuedResponses: 1})
        bounded.emit("data", Buffer.from(
            [1, 2, 3, 4].map((order) =>
                controlRequestLine(`bounded-${order}`, {order}),
            ).join(""),
        ))
        await nextTurn()
        for (const resolve of boundedResolvers.values()) resolve({ok: true})
        await nextTurn()
        assert.equal(bounded.writes.length, 1)
        assert.equal(bounded.destroyed, true)
    })

    it("caps client pending and unsent queues without leaking authority", async (t) => {
        assert.equal(DEFAULT_MAX_PENDING_REQUESTS, 64)
        assert.equal(DEFAULT_MAX_UNSENT_REQUESTS, 64)
        const pendingSocket = new FakeSocket({autoConnect: true})
        const pendingClient = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "pending-limit.sock"),
            token: "pending-limit-token",
            sessionId: "pending-limit-session",
            socketFactory: () => pendingSocket,
            maxPendingRequests: 2,
        })
        t.after(() => pendingClient.close())
        const one = pendingClient.invoke("context.get", {}, {id: "pending-one"})
        const two = pendingClient.invoke("context.get", {}, {id: "pending-two"})
        const oneRejected = assert.rejects(one, /closed/i)
        const twoRejected = assert.rejects(two, /closed/i)
        await assert.rejects(
            pendingClient.invoke("context.get", {}, {id: "pending-three"}),
            (error) => {
                assert.match(error.message, /pending requests/i)
                assert.doesNotMatch(error.message, /pending-limit-token|pending-limit-session/u)
                return true
            },
        )
        pendingClient.close()
        await Promise.all([oneRejected, twoRejected])

        const queueSocket = new FakeSocket({autoConnect: true, writeResults: [false, true]})
        const queueClient = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "unsent-limit.sock"),
            token: "unsent-limit-token",
            sessionId: "unsent-limit-session",
            socketFactory: () => queueSocket,
            maxPendingRequests: 4,
            maxUnsentRequests: 1,
        })
        t.after(() => queueClient.close())
        const sent = queueClient.invoke("context.get", {}, {
            id: "sent-first",
            timeoutMs: 1_000,
        })
        await waitFor(() => queueSocket.writes.length === 1)
        const queued = queueClient.invoke("context.get", {}, {
            id: "queued-second",
            timeoutMs: 1_000,
        })
        await nextTurn()
        assert.equal(queueSocket.writes.length, 1)
        await assert.rejects(
            queueClient.invoke("context.get", {}, {id: "queue-overflow"}),
            (error) => {
                assert.match(error.message, /backpressure|queue/i)
                assert.doesNotMatch(error.message, /unsent-limit-token|unsent-limit-session/u)
                return true
            },
        )
        queueSocket.emit("drain")
        await nextTurn()
        assert.deepEqual(
            queueSocket.writes.map((line) => JSON.parse(line).id),
            ["sent-first", "queued-second"],
        )
        queueSocket.emit("data", Buffer.from(
            '{"id":"sent-first","result":{"order":1}}\n' +
            '{"id":"queued-second","result":{"order":2}}\n',
        ))
        assert.deepEqual(await sent, {order: 1})
        assert.deepEqual(await queued, {order: 2})
    })

    it("removes timed-out unsent requests and clears drain listeners on close", async (t) => {
        const socket = new FakeSocket({autoConnect: true, writeResults: [false, false]})
        const client = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "unsent-timeout.sock"),
            token: "timeout-queue-token",
            sessionId: "timeout-queue-session",
            socketFactory: () => socket,
            maxPendingRequests: 4,
            maxUnsentRequests: 1,
        })
        const sent = client.invoke("context.get", {}, {id: "sent", timeoutMs: 1_000})
        await waitFor(() => socket.writes.length === 1)
        const timedOut = client.invoke("context.get", {}, {id: "timed-out", timeoutMs: 10})
        await assert.rejects(timedOut, /timed out/i)
        const replacement = client.invoke("context.get", {}, {
            id: "replacement",
            timeoutMs: 1_000,
        })
        await nextTurn()
        socket.emit("drain")
        await nextTurn()
        assert.deepEqual(
            socket.writes.map((line) => JSON.parse(line).id),
            ["sent", "replacement"],
        )

        const sentRejected = assert.rejects(sent, /closed/i)
        const replacementRejected = assert.rejects(replacement, /closed/i)
        client.close()
        await Promise.all([sentRejected, replacementRejected])
        await nextTurn()
        assert.equal(socket.listenerCount("drain"), 0)
    })

    it("rejects every pending request on remote disconnect and explicit close", async (t) => {
        const remoteUserData = await temporaryUserData(t)
        const remotePath = path.join(remoteUserData, "remote.sock")
        await listenUnixServer(t, remotePath, (socket) => {
            socket.once("data", () => socket.destroy())
        })
        const disconnected = new ControlSocketClient({
            socketPath: remotePath,
            token: "disconnect-token",
            sessionId: "disconnect-session",
        })
        await assert.rejects(disconnected.invoke("context.get", {}), (error) => {
            assert.doesNotMatch(error.message, /disconnect-token|disconnect-session/u)
            return true
        })

        const {server} = await startControlServer(t, {invoke: () => new Promise(() => {})})
        const closed = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "close-token",
            sessionId: "close-session",
        })
        const one = closed.invoke("context.get", {}, {id: "one"})
        const two = closed.invoke("runtimes.list", {}, {id: "two"})
        await waitFor(() => server.connectionCount === 1)
        closed.close()
        await Promise.all([
            assert.rejects(one, /closed/i),
            assert.rejects(two, /closed/i),
        ])

        const beforeConnect = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "early-close-token",
            sessionId: "early-close-session",
        })
        const connecting = beforeConnect.invoke("context.get", {}).then(
            () => "resolved",
            () => "rejected",
        )
        beforeConnect.close()
        assert.equal(await Promise.race([
            connecting,
            new Promise((resolve) => setTimeout(() => resolve("hung"), 100)),
        ]), "rejected")
    })

    it("fails closed on unknown or duplicate response IDs", async (t) => {
        const userData = await temporaryUserData(t)
        const socketPath = path.join(userData, "hostile.sock")
        let buffer = ""
        await listenUnixServer(t, socketPath, (socket) => {
            socket.on("data", (chunk) => {
                buffer += chunk.toString("utf8")
                const lines = buffer.split("\n").filter(Boolean)
                if (lines.length < 2) return
                const first = JSON.parse(lines[0])
                socket.write(`${JSON.stringify({id: first.id, result: {ok: 1}})}\n`)
                socket.write(`${JSON.stringify({id: first.id, result: {duplicate: true}})}\n`)
            })
        })
        const client = new ControlSocketClient({
            socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        const first = client.invoke("context.get", {}, {id: "known"})
        const second = client.invoke("runtimes.list", {}, {id: "pending"})
        assert.deepEqual(await first, {ok: 1})
        await assert.rejects(second, /protocol|closed/i)
        client.close()
    })

    it("rejects hostile nested JSON in responses without prototype pollution", async (t) => {
        const userData = await temporaryUserData(t)
        const socketPath = path.join(userData, "hostile-result.sock")
        await listenUnixServer(t, socketPath, (socket) => {
            socket.once("data", (chunk) => {
                const request = JSON.parse(chunk.toString("utf8").trim())
                socket.write(
                    `{"id":${JSON.stringify(request.id)},` +
                    '"result":{"__proto__":{"polluted":true}}}\n',
                )
            })
        })
        const client = new ControlSocketClient({
            socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        t.after(() => client.close())
        await assert.rejects(client.invoke("context.get", {}), /protocol/i)
        assert.equal(Object.prototype.polluted, undefined)
    })

    it("server close rejects clients and removes only its own socket inode", async (t) => {
        const {server} = await startControlServer(t, {invoke: () => new Promise(() => {})})
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        const pending = client.invoke("context.get", {})
        await waitFor(() => server.connectionCount === 1)
        const socketPath = server.socketPath
        const pendingRejected = assert.rejects(pending, /closed|disconnected/i)
        await server.close()
        await pendingRejected
        await assert.rejects(fs.promises.lstat(socketPath), {code: "ENOENT"})

        const {server: replacementServer} = await startControlServer(t, {
            invoke: async () => ({}),
        })
        const replacementPath = replacementServer.socketPath
        await fs.promises.unlink(replacementPath)
        await fs.promises.writeFile(replacementPath, "replacement", {mode: 0o600})
        await replacementServer.close()
        assert.equal(await fs.promises.readFile(replacementPath, "utf8"), "replacement")
    })

    it("replaces only a stale socket at the exact configured path", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const socketPath = path.join(controlDir, CONTROL_SOCKET_NAME)
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        await makeStaleUnixSocket(socketPath)
        const staleIdentity = await fs.promises.lstat(socketPath)

        const server = new ControlSocketServer({
            userData,
            controlDir,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        await server.start()
        t.after(async () => server.close())
        const replacementIdentity = await fs.promises.lstat(socketPath)
        assert.notEqual(replacementIdentity.ino, staleIdentity.ino)
        assert.deepEqual(
            (await fs.promises.readdir(controlDir))
                .filter((name) => name.startsWith(CONTROL_SOCKET_QUARANTINE_PREFIX)),
            [],
        )
        const client = new ControlSocketClient({
            socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        t.after(() => client.close())
        assert.deepEqual(await client.invoke("context.get", {}), {ok: true})
    })

    it("quarantines a raced regular replacement without deleting it", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const socketPath = path.join(controlDir, CONTROL_SOCKET_NAME)
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        await makeStaleUnixSocket(socketPath)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        t.after(async () => server.close())

        const renameSync = fs.renameSync
        let exchanged = false
        fs.renameSync = (source, destination) => {
            if (!exchanged && source === socketPath) {
                exchanged = true
                fs.unlinkSync(source)
                fs.writeFileSync(source, "regular replacement", {mode: 0o600})
            }
            return renameSync(source, destination)
        }
        try {
            await assert.rejects(server.start(), /changed|quarantine|stale/i)
        } finally {
            fs.renameSync = renameSync
        }
        assert.equal(await fs.promises.readFile(socketPath, "utf8"), "regular replacement")
        assert.deepEqual(
            (await fs.promises.readdir(controlDir))
                .filter((name) => name.startsWith(CONTROL_SOCKET_QUARANTINE_PREFIX)),
            [],
        )
    })

    it("quarantines a raced socket replacement without deleting it", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const socketPath = path.join(controlDir, CONTROL_SOCKET_NAME)
        const preparedReplacement = path.join(controlDir, "r.sock")
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        await makeStaleUnixSocket(socketPath)
        await makeStaleUnixSocket(preparedReplacement)
        const preparedIdentity = await fs.promises.lstat(preparedReplacement)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        t.after(async () => server.close())

        const renameSync = fs.renameSync
        let exchanged = false
        fs.renameSync = (source, destination) => {
            if (!exchanged && source === socketPath) {
                exchanged = true
                fs.unlinkSync(source)
                renameSync(preparedReplacement, source)
            }
            return renameSync(source, destination)
        }
        try {
            await assert.rejects(server.start(), /changed|quarantine|stale/i)
        } finally {
            fs.renameSync = renameSync
        }
        const restored = await fs.promises.lstat(socketPath)
        assert.equal(restored.isSocket(), true)
        assert.equal(restored.dev, preparedIdentity.dev)
        assert.equal(restored.ino, preparedIdentity.ino)
    })

    it("never overwrites a new socket-path occupant when quarantine restore fails", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const socketPath = path.join(controlDir, CONTROL_SOCKET_NAME)
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        await makeStaleUnixSocket(socketPath)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        t.after(async () => server.close())

        const renameSync = fs.renameSync
        let exchanged = false
        fs.renameSync = (source, destination) => {
            if (!exchanged && source === socketPath) {
                exchanged = true
                fs.unlinkSync(source)
                fs.writeFileSync(source, "quarantined replacement", {mode: 0o600})
                renameSync(source, destination)
                fs.writeFileSync(source, "new occupant", {mode: 0o600})
                return
            }
            return renameSync(source, destination)
        }
        try {
            await assert.rejects(server.start(), /restore|occupied|quarantine|changed/i)
        } finally {
            fs.renameSync = renameSync
        }
        assert.equal(await fs.promises.readFile(socketPath, "utf8"), "new occupant")
        const quarantines = (await fs.promises.readdir(controlDir))
            .filter((name) => name.startsWith(CONTROL_SOCKET_QUARANTINE_PREFIX))
        assert.equal(quarantines.length, 1)
        assert.equal(
            await fs.promises.readFile(path.join(controlDir, quarantines[0]), "utf8"),
            "quarantined replacement",
        )
    })

    it("refuses active sockets, files, symlinks, and alternate control directories", async (t) => {
        const activeUserData = await temporaryUserData(t)
        const activeDir = path.join(activeUserData, CONTROL_SOCKET_DIRECTORY)
        const activePath = path.join(activeDir, CONTROL_SOCKET_NAME)
        await fs.promises.mkdir(activeDir, {mode: 0o700})
        const active = await listenUnixServer(t, activePath, (socket) => socket.end())
        const activeServer = new ControlSocketServer({
            userData: activeUserData,
            controlPlane: {invoke: async () => ({})},
        })
        await assert.rejects(activeServer.start(), /active|in use/i)
        assert.equal(active.listening, true)

        const fileUserData = await temporaryUserData(t)
        const fileDir = path.join(fileUserData, CONTROL_SOCKET_DIRECTORY)
        const filePath = path.join(fileDir, CONTROL_SOCKET_NAME)
        await fs.promises.mkdir(fileDir, {mode: 0o700})
        await fs.promises.writeFile(filePath, "sentinel")
        const fileServer = new ControlSocketServer({
            userData: fileUserData,
            controlPlane: {invoke: async () => ({})},
        })
        await assert.rejects(fileServer.start(), /socket path|regular|refus/i)
        assert.equal(await fs.promises.readFile(filePath, "utf8"), "sentinel")

        const symlinkUserData = await temporaryUserData(t)
        const symlinkDir = path.join(symlinkUserData, CONTROL_SOCKET_DIRECTORY)
        const symlinkPath = path.join(symlinkDir, CONTROL_SOCKET_NAME)
        const symlinkTarget = path.join(symlinkUserData, "target")
        await fs.promises.mkdir(symlinkDir, {mode: 0o700})
        await fs.promises.writeFile(symlinkTarget, "target")
        await fs.promises.symlink(symlinkTarget, symlinkPath)
        const symlinkServer = new ControlSocketServer({
            userData: symlinkUserData,
            controlPlane: {invoke: async () => ({})},
        })
        await assert.rejects(symlinkServer.start(), /socket path|symlink|refus/i)
        assert.equal((await fs.promises.lstat(symlinkPath)).isSymbolicLink(), true)

        const alternateUserData = await temporaryUserData(t)
        const alternateDir = path.join(alternateUserData, "control", "..", "elsewhere")
        const alternateServer = new ControlSocketServer({
            userData: alternateUserData,
            controlDir: alternateDir,
            controlPlane: {invoke: async () => ({})},
        })
        await assert.rejects(alternateServer.start(), /control directory|exact/i)
        assert.equal(fs.existsSync(path.resolve(alternateDir, CONTROL_SOCKET_NAME)), false)
    })

    it("refuses symlinked or foreign-owned control directories", async (t) => {
        const userData = await temporaryUserData(t)
        const target = path.join(userData, "actual-control")
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        await fs.promises.mkdir(target, {mode: 0o700})
        await fs.promises.symlink(target, controlDir)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await assert.rejects(server.start(), /control directory|symlink/i)
    })
})
