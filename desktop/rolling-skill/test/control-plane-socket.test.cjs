const assert = require("node:assert/strict")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const {spawn} = require("node:child_process")
const {once} = require("node:events")
const {describe, it} = require("node:test")

const {createPublicControlError} = require("../src/control-plane/contracts.cjs")
const {
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    MAX_CONTROL_MESSAGE_BYTES,
    ControlSocketServer,
} = require("../src/control-plane/socket-server.cjs")
const {
    DEFAULT_CONTROL_SOCKET_TIMEOUT_MS,
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

        const server = new ControlSocketServer({
            userData,
            controlDir,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        await server.start()
        t.after(async () => server.close())
        const client = new ControlSocketClient({
            socketPath,
            token: "opaque",
            sessionId: "operator",
        })
        t.after(() => client.close())
        assert.deepEqual(await client.invoke("context.get", {}), {ok: true})
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
