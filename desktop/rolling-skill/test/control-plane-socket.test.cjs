const assert = require("node:assert/strict")
const fs = require("node:fs")
const net = require("node:net")
const os = require("node:os")
const path = require("node:path")
const {createHash} = require("node:crypto")
const {spawn} = require("node:child_process")
const {EventEmitter, once} = require("node:events")
const {describe, it} = require("node:test")

const {createPublicControlError} = require("../src/control-plane/contracts.cjs")
const {
    CONTROL_SOCKET_BIND_DIRECTORY_PREFIX,
    CONTROL_SOCKET_BIND_RECOVERY_PREFIX,
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX,
    CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX,
    CONTROL_SOCKET_QUARANTINE_PREFIX,
    DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    DEFAULT_MAX_QUEUED_RESPONSES,
    DEFAULT_MAX_QUEUED_RESPONSE_BYTES,
    MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS,
    MAX_CONTROL_MESSAGE_BYTES,
    MAX_CONTROL_SOCKET_PATH_BYTES,
    ControlSocketServer,
    attachControlSocketConnection,
} = require("../src/control-plane/socket-server.cjs")
const {
    DEFAULT_CONTROL_SOCKET_TIMEOUT_MS,
    DEFAULT_MAX_PENDING_REQUESTS,
    DEFAULT_MAX_UNSENT_REQUESTS,
    DEFAULT_MAX_USED_REQUEST_IDS,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketClient,
} = require("../src/control-plane/socket-client.cjs")

const temporaryCleanupByDirectory = new Map()

function registerTemporaryDirectoryCleanup(t, directory) {
    const cleanup = {beforeRemove: []}
    temporaryCleanupByDirectory.set(directory, cleanup)
    t.after(async () => {
        try {
            for (const callback of cleanup.beforeRemove) await callback()
        } finally {
            temporaryCleanupByDirectory.delete(directory)
            await fs.promises.rm(directory, {recursive: true, force: true})
        }
    })
}

function registerControlServerCleanup(t, userData, server) {
    const temporaryCleanup = temporaryCleanupByDirectory.get(userData)
    if (temporaryCleanup) temporaryCleanup.beforeRemove.push(() => server.close())
    else t.after(async () => server.close())
}

async function temporaryUserData(t) {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rolling-control-"))
    await fs.promises.chmod(directory, 0o700)
    registerTemporaryDirectoryCleanup(t, directory)
    return directory
}

async function temporaryShortUserData(t) {
    const directory = await fs.promises.mkdtemp(path.join("/tmp", "rolling-control-"))
    await fs.promises.chmod(directory, 0o700)
    registerTemporaryDirectoryCleanup(t, directory)
    return directory
}

function expectedSocketPath(userData) {
    return path.join(userData, CONTROL_SOCKET_DIRECTORY, CONTROL_SOCKET_NAME)
}

function publicRecoveryName(stat, stage = 0) {
    const digest = createHash("sha256")
        .update(`${stat.dev}:${stat.ino}`)
        .digest()
    return `.p-${digest.subarray(stage * 9, (stage + 1) * 9).toString("base64url")}`
}

async function userDataForPublicPathBytes(t, targetBytes) {
    const parent = await fs.promises.mkdtemp(path.join("/tmp", "rolling-budget-"))
    t.after(async () => {
        await fs.promises.rm(parent, {recursive: true, force: true})
    })
    const publicSuffix = path.join(CONTROL_SOCKET_DIRECTORY, CONTROL_SOCKET_NAME)
    const nestedLength = targetBytes -
        Buffer.byteLength(`${parent}${path.sep}${publicSuffix}`, "utf8") - 1
    assert.ok(nestedLength > 0)
    const userData = path.join(parent, "x".repeat(nestedLength))
    await fs.promises.mkdir(userData, {mode: 0o700})
    assert.equal(Buffer.byteLength(expectedSocketPath(userData), "utf8"), targetBytes)
    return userData
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
    registerControlServerCleanup(t, userData, server)
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

async function invokeControlSocketFrom(executable, socketPath, id) {
    const source = [
        'const net = require("node:net")',
        "const socket = net.createConnection(process.argv[1])",
        'let buffer = ""',
        'socket.on("connect", () => socket.write(JSON.stringify({id: process.argv[2], method: "context.get", params: {runtime: process.argv[2]}, token: "opaque", sessionId: "operator"}) + "\\n"))',
        'socket.on("data", (chunk) => { buffer += chunk.toString("utf8"); const newline = buffer.indexOf("\\n"); if (newline >= 0) { process.stdout.write(buffer.slice(0, newline)); socket.destroy() } })',
        'socket.on("error", (error) => { process.stderr.write(error.message); process.exitCode = 1 })',
    ].join(";")
    const child = spawn(executable, ["-e", source, socketPath, id], {
        env: {...process.env, ELECTRON_RUN_AS_NODE: "1"},
        stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8")
    })
    child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8")
    })
    const [code] = await once(child, "exit")
    assert.equal(code, 0, stderr)
    return JSON.parse(stdout)
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
    it("keeps the private bind namespace read-only for the listener lifetime", async (t) => {
        assert.equal(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX, ".b-")
        assert.equal(CONTROL_SOCKET_BIND_RECOVERY_PREFIX, ".r-")
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        t.after(async () => server.close().catch(() => {}))
        await server.start()
        const controlDir = path.dirname(server.socketPath)
        const bindNames = (await fs.promises.readdir(controlDir))
            .filter((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.equal(bindNames.length, 1)
        const bindDir = path.join(controlDir, bindNames[0])
        const bindPath = path.join(bindDir, "s")
        const bindDirStat = await fs.promises.lstat(bindDir)
        const bindStat = await fs.promises.lstat(bindPath)
        const publicStat = await fs.promises.lstat(server.socketPath)
        assert.equal(bindDirStat.isDirectory(), true)
        assert.equal(bindDirStat.mode & 0o777, 0o500)
        assert.equal(bindStat.isSocket(), true)
        assert.equal(bindStat.dev, publicStat.dev)
        assert.equal(bindStat.ino, publicStat.ino)
        await assert.rejects(fs.promises.unlink(bindPath), (error) =>
            error?.code === "EACCES" || error?.code === "EPERM")

        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME || name.startsWith(".b-") ||
                name.startsWith(".r-")),
            [],
        )
    })

    it("preserves a forced bind-path replacement in a recovery directory", async (t) => {
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        t.after(async () => server.close().catch(() => {}))
        await server.start()
        const controlDir = path.dirname(server.socketPath)
        const bindName = (await fs.promises.readdir(controlDir))
            .find((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.ok(bindName)
        const bindDir = path.join(controlDir, bindName)
        const bindPath = path.join(bindDir, "s")

        await fs.promises.chmod(bindDir, 0o700)
        await fs.promises.unlink(bindPath)
        await fs.promises.writeFile(bindPath, "forced replacement", {mode: 0o600})
        await fs.promises.chmod(bindDir, 0o500)

        await assert.rejects(server.close(), /bind|recovery|mismatch|replacement/i)
        await assert.rejects(fs.promises.lstat(server.socketPath), {code: "ENOENT"})
        const recoveryNames = (await fs.promises.readdir(controlDir))
            .filter((name) => /^\.r-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.equal(recoveryNames.length, 1)
        const recoveryDir = path.join(controlDir, recoveryNames[0])
        assert.equal(
            await fs.promises.readFile(path.join(recoveryDir, "s"), "utf8"),
            "forced replacement",
        )
        await fs.promises.chmod(recoveryDir, 0o700)
    })

    it("moves a forced bind-directory replacement into recovery without deleting it", async (t) => {
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        t.after(async () => server.close().catch(() => {}))
        await server.start()
        const controlDir = path.dirname(server.socketPath)
        const bindName = (await fs.promises.readdir(controlDir))
            .find((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.ok(bindName)
        const bindDir = path.join(controlDir, bindName)
        const bindPath = path.join(bindDir, "s")

        await fs.promises.chmod(bindDir, 0o700)
        await fs.promises.unlink(bindPath)
        await fs.promises.rmdir(bindDir)
        await fs.promises.mkdir(bindDir, {mode: 0o700})
        await fs.promises.writeFile(bindPath, "directory replacement", {mode: 0o600})
        await fs.promises.chmod(bindDir, 0o500)

        await assert.rejects(server.close(), /bind|recovery|mismatch|identity/i)
        await assert.rejects(fs.promises.lstat(server.socketPath), {code: "ENOENT"})
        const recoveryNames = (await fs.promises.readdir(controlDir))
            .filter((name) => /^\.r-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.equal(recoveryNames.length, 1)
        const recoveryDir = path.join(controlDir, recoveryNames[0])
        assert.equal(
            await fs.promises.readFile(path.join(recoveryDir, "s"), "utf8"),
            "directory replacement",
        )
        await fs.promises.chmod(recoveryDir, 0o700)
    })

    it("continues stale bind cleanup after a crash immediately following quarantine", async (t) => {
        const userData = await temporaryShortUserData(t)
        const serverModule = require.resolve("../src/control-plane/socket-server.cjs")
        const source = [
            'const fs = require("node:fs")',
            'const path = require("node:path")',
            'const {ControlSocketServer} = require(process.argv[1])',
            'const server = new ControlSocketServer({userData: process.argv[2], controlPlane: {invoke: async () => ({})}})',
            'server.start().then(() => {',
            '  const renameSync = fs.renameSync',
            '  fs.renameSync = (source, destination) => {',
            '    renameSync(source, destination)',
            '    if (/^\\.b-[A-Za-z0-9_-]{11}$/.test(path.basename(source)) && path.basename(destination).startsWith(".r-")) process.kill(process.pid, "SIGKILL")',
            '  }',
            '  process.stdout.write("ready\\n")',
            '  setImmediate(() => server.close())',
            '}, (error) => { process.stderr.write(error.stack); process.exit(1) })',
        ].join(";")
        const child = spawn(process.execPath, ["-e", source, serverModule, userData], {
            stdio: ["ignore", "pipe", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8")
        })
        const exitPromise = once(child, "exit")
        await Promise.race([
            once(child.stdout, "data"),
            exitPromise.then(([code, signal]) => {
                throw new Error(`cleanup crash fixture exited ${code}/${signal}: ${stderr}`)
            }),
        ])
        const [code, signal] = await exitPromise
        assert.equal(code, null)
        assert.equal(signal, "SIGKILL")

        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        assert.equal(
            (await fs.promises.readdir(controlDir))
                .filter((name) => /^\.r-[A-Za-z0-9_-]{11}$/u.test(name)).length,
            1,
        )
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        await server.start()
        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME || name.startsWith(".b-") ||
                name.startsWith(".r-")),
            [],
        )
    })

    it("recovers an identity-named public socket after close crashes following quarantine", async (t) => {
        const userData = await userDataForPublicPathBytes(
            t,
            MAX_CONTROL_SOCKET_PATH_BYTES - 4,
        )
        const socketPath = expectedSocketPath(userData)
        const serverModule = require.resolve("../src/control-plane/socket-server.cjs")
        const source = [
            'const fs = require("node:fs")',
            'const path = require("node:path")',
            'const {ControlSocketServer} = require(process.argv[1])',
            'const server = new ControlSocketServer({userData: process.argv[2], controlPlane: {invoke: async () => ({})}})',
            'server.start().then(() => {',
            '  const renameSync = fs.renameSync',
            '  fs.renameSync = (source, destination) => {',
            '    renameSync(source, destination)',
            '    if (path.basename(source) === "control.sock" && path.basename(destination).startsWith(".p-")) process.kill(process.pid, "SIGKILL")',
            '  }',
            '  process.stdout.write("ready\\n")',
            '  setImmediate(() => server.close())',
            '}, (error) => { process.stderr.write(error.stack); process.exit(1) })',
        ].join(";")
        const child = spawn(process.execPath, ["-e", source, serverModule, userData], {
            stdio: ["ignore", "pipe", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8")
        })
        const exitPromise = once(child, "exit")
        await Promise.race([
            once(child.stdout, "data"),
            exitPromise.then(([code, signal]) => {
                throw new Error(`public cleanup crash fixture exited ${code}/${signal}: ${stderr}`)
            }),
        ])
        const [code, signal] = await exitPromise
        assert.equal(code, null)
        assert.equal(signal, "SIGKILL")

        const controlDir = path.dirname(socketPath)
        const recoveryNames = (await fs.promises.readdir(controlDir))
            .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX))
        assert.equal(recoveryNames.length, 1)
        const recoveryPath = path.join(controlDir, recoveryNames[0])
        const recoveryStat = await fs.promises.lstat(recoveryPath)
        assert.equal(recoveryStat.isSocket(), true)
        assert.equal(recoveryNames[0], publicRecoveryName(recoveryStat))
        assert.equal(Buffer.byteLength(recoveryNames[0], "utf8"), 15)
        await assert.rejects(fs.promises.lstat(socketPath), {code: "ENOENT"})

        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        await server.start()
        const electronExecutable = require("electron")
        for (const [runtime, executable] of [
            ["node-budget-recovery", process.execPath],
            ["electron-budget-recovery", electronExecutable],
        ]) {
            assert.deepEqual(
                await invokeControlSocketFrom(executable, socketPath, runtime),
                {id: runtime, result: {ok: true}},
            )
        }
        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX) ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX) ||
                name.startsWith(CONTROL_SOCKET_BIND_RECOVERY_PREFIX)),
            [],
        )
    })

    it("keeps public recovery recognizable when recovery crashes after its second rename", async (t) => {
        const userData = await temporaryShortUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        const preparedPath = path.join(controlDir, "prepared.sock")
        await makeStaleUnixSocket(preparedPath)
        const preparedStat = await fs.promises.lstat(preparedPath)
        const firstRecoveryPath = path.join(controlDir, publicRecoveryName(preparedStat))
        await fs.promises.rename(preparedPath, firstRecoveryPath)

        const serverModule = require.resolve("../src/control-plane/socket-server.cjs")
        const source = [
            'const fs = require("node:fs")',
            'const path = require("node:path")',
            'const {ControlSocketServer} = require(process.argv[1])',
            'const renameSync = fs.renameSync',
            'fs.renameSync = (source, destination) => {',
            '  renameSync(source, destination)',
            '  if (path.basename(source).startsWith(".p-") && path.basename(destination).startsWith(".p-")) process.kill(process.pid, "SIGKILL")',
            '}',
            'const server = new ControlSocketServer({userData: process.argv[2], controlPlane: {invoke: async () => ({})}})',
            'server.start().then(() => process.exit(2), (error) => { process.stderr.write(error.stack); process.exit(1) })',
        ].join(";")
        const child = spawn(process.execPath, ["-e", source, serverModule, userData], {
            stdio: ["ignore", "ignore", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8")
        })
        const [code, signal] = await once(child, "exit")
        assert.equal(code, null, stderr)
        assert.equal(signal, "SIGKILL", stderr)

        const recoveryNames = (await fs.promises.readdir(controlDir))
            .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX))
        assert.equal(recoveryNames.length, 1)
        assert.notEqual(recoveryNames[0], path.basename(firstRecoveryPath))
        const recoveryStat = await fs.promises.lstat(path.join(controlDir, recoveryNames[0]))
        assert.equal(recoveryStat.isSocket(), true)
        assert.equal(recoveryStat.dev, preparedStat.dev)
        assert.equal(recoveryStat.ino, preparedStat.ino)
        assert.equal(recoveryNames[0], publicRecoveryName(recoveryStat, 1))

        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir))
                .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX)),
            [],
        )
    })

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

        const invalidUtf8 = await connectRaw(server.socketPath)
        const invalidUtf8Closed = once(invalidUtf8, "close")
        invalidUtf8.write(Buffer.concat([
            Buffer.from('{"id":"invalid-utf8","method":"context.get","params":{"x":"'),
            Buffer.from([0xc0, 0xaf]),
            Buffer.from('"},"token":"opaque","sessionId":"operator"}\n'),
        ]))
        await invalidUtf8Closed

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

    it("uses a 15-second default timeout and reconnects after isolating that connection", async (t) => {
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
        await waitFor(() => typeof releaseSlow === "function")
        assert.equal(observedDelay, 15_000)
        timerCallback()
        await assert.rejects(slow, (error) => {
            assert.match(error.message, /timed out/i)
            assert.doesNotMatch(error.message, /timeout-secret/u)
            return true
        })
        assert.deepEqual(
            await client.invoke("runtimes.list", {}, {id: "after-timeout"}),
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

        const batchedCalls = []
        const batchedResolvers = new Map()
        const batchedSocket = new FakeSocket()
        attachControlSocketConnection(batchedSocket, {
            invoke({params}) {
                batchedCalls.push(params.order)
                return new Promise((resolve) => batchedResolvers.set(params.order, resolve))
            },
        }, {maxInFlightRequests: 2, maxQueuedResponses: 2})
        batchedSocket.emit("data", Buffer.from(
            [1, 2, 3, 4, 5].map((order) =>
                controlRequestLine(`batched-${order}`, {order}),
            ).join(""),
        ))
        await nextTurn()
        assert.deepEqual(batchedCalls, [1, 2])
        assert.equal(batchedSocket.destroyed, false)

        batchedResolvers.get(1)({order: 1})
        await nextTurn()
        assert.deepEqual(batchedCalls, [1, 2, 3])
        batchedResolvers.get(2)({order: 2})
        await nextTurn()
        assert.deepEqual(batchedCalls, [1, 2, 3, 4])
        batchedResolvers.get(3)({order: 3})
        await nextTurn()
        assert.deepEqual(batchedCalls, [1, 2, 3, 4, 5])
        assert.equal(batchedSocket.destroyed, false)
    })

    it("dispatches 64 requests from one chunk in two default-sized batches", async () => {
        const calls = []
        const resolvers = new Map()
        const socket = new FakeSocket()
        attachControlSocketConnection(socket, {
            invoke({params}) {
                calls.push(params.order)
                return new Promise((resolve) => resolvers.set(params.order, resolve))
            },
        })
        socket.emit("data", Buffer.from(
            Array.from({length: 64}, (_, index) =>
                controlRequestLine(`batch-${index + 1}`, {order: index + 1}),
            ).join(""),
        ))
        await nextTurn()
        assert.equal(calls.length, 32)
        assert.equal(socket.destroyed, false)

        for (let order = 1; order <= 32; order += 1) {
            resolvers.get(order)({order})
        }
        await nextTurn()
        assert.equal(calls.length, 64)
        assert.equal(socket.destroyed, false)
        for (let order = 33; order <= 64; order += 1) {
            resolvers.get(order)({order})
        }
        await nextTurn()
        assert.equal(socket.writes.length, 64)
    })

    it("queues server responses after write false and caps that queue", async () => {
        assert.equal(DEFAULT_MAX_QUEUED_RESPONSE_BYTES, 4 * 1_048_576)
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

    it("replaces an oversized domain result with a bounded public INVALID_RESULT", async (t) => {
        const {server} = await startControlServer(t, {
            async invoke() {
                return {
                    rawCases: [{blob: "x".repeat(MAX_CONTROL_MESSAGE_BYTES + 200_000)}],
                    nextCursor: null,
                }
            },
        })
        const client = new ControlSocketClient({
            socketPath: server.socketPath,
            token: "oversized-result-token",
            sessionId: "oversized-result-session",
        })
        t.after(() => client.close())

        await assert.rejects(
            client.invoke("raw_cases.list", {}),
            (error) => {
                assert.equal(error.code, "INVALID_RESULT")
                assert.equal(error.message, "Invalid control result")
                assert.deepEqual(error.details, {
                    method: "raw_cases.list",
                    issues: [{path: ["limit"]}],
                })
                return true
            },
        )
    })

    it("caps the server response queue by encoded bytes", async () => {
        const socket = new FakeSocket({writeResults: [false]})
        const resolvers = new Map()
        attachControlSocketConnection(socket, {
            invoke({params}) {
                return new Promise((resolve) => resolvers.set(params.order, resolve))
            },
        }, {
            maxInFlightRequests: 3,
            maxQueuedResponses: 10,
            maxQueuedResponseBytes: 250,
        })
        socket.emit("data", Buffer.from(
            [1, 2, 3].map((order) =>
                controlRequestLine(`byte-bounded-${order}`, {order}),
            ).join(""),
        ))
        await nextTurn()
        for (const resolve of resolvers.values()) resolve({blob: "x".repeat(120)})
        await nextTurn()

        assert.equal(socket.writes.length, 1)
        assert.equal(socket.destroyed, true)
    })

    it("caps client pending and unsent queues without leaking authority", async (t) => {
        assert.equal(DEFAULT_MAX_PENDING_REQUESTS, 32)
        assert.equal(DEFAULT_MAX_UNSENT_REQUESTS, 32)
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

    it("isolates a timed-out generation, rejects its peers, and ignores its late response", async (t) => {
        const firstSocket = new FakeSocket({writeResults: [false]})
        const secondSocket = new FakeSocket()
        const sockets = [firstSocket, secondSocket]
        const client = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "unsent-timeout.sock"),
            token: "timeout-queue-token",
            sessionId: "timeout-queue-session",
            socketFactory: () => {
                const socket = sockets.shift()
                queueMicrotask(() => socket.emit("connect"))
                return socket
            },
            maxPendingRequests: 4,
            maxUnsentRequests: 2,
        })
        t.after(() => client.close())
        const timedOut = client.invoke("context.get", {}, {id: "same-id", timeoutMs: 10})
        await waitFor(() => firstSocket.writes.length === 1)
        const peer = client.invoke("context.get", {}, {id: "peer", timeoutMs: 50})
        const peerRejected = assert.rejects(peer, /disconnected/i)
        await assert.rejects(timedOut, /timed out/i)
        await peerRejected
        assert.equal(firstSocket.destroyed, true)

        let replacementSettled = false
        const replacement = client.invoke("context.get", {}, {
            id: "same-id",
            timeoutMs: 1_000,
        }).finally(() => {
            replacementSettled = true
        })
        await waitFor(() => secondSocket.writes.length === 1)
        firstSocket.emit("data", Buffer.from(
            '{"id":"same-id","result":{"source":"old"}}\n',
        ))
        await nextTurn()
        assert.equal(replacementSettled, false)
        secondSocket.emit("data", Buffer.from(
            '{"id":"same-id","result":{"source":"new"}}\n',
        ))
        assert.deepEqual(await replacement, {source: "new"})
        assert.equal(firstSocket.listenerCount("drain"), 0)
    })

    it("starts timeout accounting before a connection attempt completes", async (t) => {
        const socket = new FakeSocket()
        const client = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "connect-timeout.sock"),
            token: "connect-timeout-token",
            sessionId: "connect-timeout-session",
            socketFactory: () => socket,
        })
        t.after(() => client.close())
        const startedAt = Date.now()

        await assert.rejects(
            client.invoke("context.get", {}, {id: "connect-timeout", timeoutMs: 10}),
            (error) => error.code === "CONTROL_TIMEOUT",
        )
        assert.ok(Date.now() - startedAt < 500)
        assert.equal(socket.destroyed, true)
    })

    it("never reuses an ID on the same connection but permits it after reconnect", async (t) => {
        const firstSocket = new FakeSocket()
        const secondSocket = new FakeSocket()
        const sockets = [firstSocket, secondSocket]
        const client = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "id-lifecycle.sock"),
            token: "id-lifecycle-token",
            sessionId: "id-lifecycle-session",
            socketFactory: () => {
                const socket = sockets.shift()
                queueMicrotask(() => socket.emit("connect"))
                return socket
            },
        })
        t.after(() => client.close())

        const first = client.invoke("context.get", {}, {id: "once"})
        await waitFor(() => firstSocket.writes.length === 1)
        firstSocket.emit("data", Buffer.from('{"id":"once","result":{"n":1}}\n'))
        assert.deepEqual(await first, {n: 1})
        await assert.rejects(
            client.invoke("context.get", {}, {id: "once"}),
            /already in use/i,
        )

        firstSocket.destroy()
        const reused = client.invoke("context.get", {}, {id: "once"})
        await waitFor(() => secondSocket.writes.length === 1)
        secondSocket.emit("data", Buffer.from('{"id":"once","result":{"n":2}}\n'))
        assert.deepEqual(await reused, {n: 2})
    })

    it("bounds used IDs and rotates only after the connection has no pending work", async (t) => {
        assert.equal(DEFAULT_MAX_USED_REQUEST_IDS, 4_096)
        const sockets = []
        const client = new ControlSocketClient({
            socketPath: path.join(os.tmpdir(), "id-capacity.sock"),
            token: "id-capacity-token",
            sessionId: "id-capacity-session",
            maxUsedRequestIds: 2,
            socketFactory: () => {
                const socket = new FakeSocket()
                sockets.push(socket)
                queueMicrotask(() => socket.emit("connect"))
                return socket
            },
        })
        t.after(() => client.close())

        for (const id of ["first", "second"]) {
            const request = client.invoke("context.get", {}, {id})
            await waitFor(() => sockets[0].writes.some((line) => JSON.parse(line).id === id))
            sockets[0].emit("data", Buffer.from(`${JSON.stringify({id, result: {id}})}\n`))
            assert.deepEqual(await request, {id})
        }
        const rotated = client.invoke("context.get", {}, {id: "third"})
        await waitFor(() => sockets.length === 2 && sockets[1].writes.length === 1)
        assert.equal(sockets[0].destroyed, true)
        sockets[1].emit("data", Buffer.from('{"id":"third","result":{"id":"third"}}\n'))
        assert.deepEqual(await rotated, {id: "third"})

        const pending = client.invoke("context.get", {}, {id: "capacity-pending"})
        await waitFor(() => sockets[1].writes.length === 2)
        await assert.rejects(
            client.invoke("context.get", {}, {id: "capacity-overflow"}),
            (error) => error.code === "CONTROL_CAPACITY",
        )
        const pendingRejected = assert.rejects(pending, /closed/i)
        client.close()
        await pendingRejected
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

    it("keeps close permanent even after startup had completed", async (t) => {
        const userData = await temporaryUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        await server.close()

        await assert.rejects(server.start(), /closed/i)
        await assert.rejects(connectRaw(server.socketPath), /ENOENT|refused|connect/i)
    })

    it("waits for a start blocked before server creation and then closes it", async (t) => {
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalLstat = fs.promises.lstat
        const originalListen = net.Server.prototype.listen
        let releasePreparation
        let preparationEntered
        let rawServer = null
        const preparationGate = new Promise((resolve) => {
            releasePreparation = resolve
        })
        const entered = new Promise((resolve) => {
            preparationEntered = resolve
        })
        fs.promises.lstat = async (candidate) => {
            if (candidate === userData) {
                preparationEntered()
                await preparationGate
            }
            return originalLstat(candidate)
        }
        net.Server.prototype.listen = function listen(...args) {
            rawServer = this
            return originalListen.apply(this, args)
        }
        let starting
        let closing
        try {
            starting = server.start()
            await entered
            closing = server.close()
            let closeSettled = false
            closing.then(() => {
                closeSettled = true
            }, () => {
                closeSettled = true
            })
            await nextTurn()
            const settledBeforeRelease = closeSettled
            releasePreparation()
            const startOutcome = await starting.then(
                () => ({status: "fulfilled"}),
                (error) => ({status: "rejected", error}),
            )
            await closing.catch(() => {})
            assert.equal(settledBeforeRelease, false)
            assert.equal(startOutcome.status, "rejected")
            assert.match(startOutcome.error.message, /closed/i)
        } finally {
            releasePreparation()
            fs.promises.lstat = originalLstat
            net.Server.prototype.listen = originalListen
            if (rawServer?.listening) await new Promise((resolve) => rawServer.close(resolve))
        }
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        if (fs.existsSync(controlDir)) assert.deepEqual(await fs.promises.readdir(controlDir), [])
    })

    it("waits for a published start boundary before completing close", async (t) => {
        const userData = await temporaryShortUserData(t)
        const socketPath = expectedSocketPath(userData)
        const controlDir = path.dirname(socketPath)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalLstat = fs.promises.lstat
        let releasePublished
        let publishedEntered
        let blocked = false
        const publishedGate = new Promise((resolve) => {
            releasePublished = resolve
        })
        const entered = new Promise((resolve) => {
            publishedEntered = resolve
        })
        fs.promises.lstat = async (candidate) => {
            if (!blocked && candidate === socketPath && fs.existsSync(socketPath)) {
                blocked = true
                publishedEntered()
                await publishedGate
            }
            return originalLstat(candidate)
        }
        try {
            const starting = server.start()
            await entered
            const bindName = (await fs.promises.readdir(controlDir))
                .find((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
            assert.ok(bindName)
            assert.equal(
                (await fs.promises.lstat(path.join(controlDir, bindName))).mode & 0o777,
                0o500,
            )
            const closing = server.close()
            let closeSettled = false
            closing.then(() => {
                closeSettled = true
            }, () => {
                closeSettled = true
            })
            await nextTurn()
            const settledBeforeRelease = closeSettled
            releasePublished()
            const startOutcome = await starting.then(
                () => ({status: "fulfilled"}),
                (error) => ({status: "rejected", error}),
            )
            await closing.catch(() => {})
            assert.equal(settledBeforeRelease, false)
            assert.equal(startOutcome.status, "rejected")
            assert.match(startOutcome.error.message, /closed/i)
        } finally {
            releasePublished()
            fs.promises.lstat = originalLstat
            await server.close().catch(() => {})
        }
        assert.deepEqual(
            (await fs.promises.readdir(path.dirname(socketPath))).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
            [],
        )
    })

    it("cancels startup while the bind socket is being secured", async (t) => {
        const userData = await temporaryShortUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalChmod = fs.promises.chmod
        let releaseBindChmod
        let bindChmodEntered
        const gate = new Promise((resolve) => {
            releaseBindChmod = resolve
        })
        const entered = new Promise((resolve) => {
            bindChmodEntered = resolve
        })
        fs.promises.chmod = async (candidate, mode) => {
            if (
                path.basename(candidate) === "s" &&
                path.basename(path.dirname(candidate))
                    .startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)
            ) {
                bindChmodEntered()
                await gate
            }
            return originalChmod(candidate, mode)
        }
        try {
            const starting = server.start()
            await entered
            const closing = server.close()
            let closeSettled = false
            closing.finally(() => {
                closeSettled = true
            })
            await nextTurn()
            assert.equal(closeSettled, false)
            releaseBindChmod()
            await assert.rejects(starting, /closed/i)
            await closing
        } finally {
            releaseBindChmod()
            fs.promises.chmod = originalChmod
            await server.close().catch(() => {})
        }
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
            [],
        )
    })

    it("publishes one hard-linked socket usable by Node and Electron", async (t) => {
        const userData = await temporaryShortUserData(t)
        const socketPath = expectedSocketPath(userData)
        const controlDir = path.dirname(socketPath)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {
                invoke: async ({params}) => ({runtime: params.runtime}),
            },
        })
        const originalLinkSync = fs.linkSync
        let publication = null
        fs.linkSync = (source, destination) => {
            if (
                destination === socketPath &&
                path.basename(source) === "s" &&
                path.dirname(path.dirname(source)) === controlDir &&
                path.basename(path.dirname(source))
                    .startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)
            ) publication = fs.lstatSync(source)
            return originalLinkSync(source, destination)
        }
        try {
            await server.start()
        } finally {
            fs.linkSync = originalLinkSync
        }
        t.after(async () => server.close())
        assert.ok(publication)
        const publicStat = await fs.promises.lstat(socketPath)
        assert.equal(publicStat.isSocket(), true)
        assert.equal(publicStat.dev, publication.dev)
        assert.equal(publicStat.ino, publication.ino)
        const bindNames = (await fs.promises.readdir(controlDir))
            .filter((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.equal(bindNames.length, 1)
        const bindDir = path.join(controlDir, bindNames[0])
        const bindDirectoryStat = await fs.promises.lstat(bindDir)
        const bindStat = await fs.promises.lstat(path.join(bindDir, "s"))
        assert.equal(bindDirectoryStat.mode & 0o777, 0o500)
        assert.equal(bindStat.isSocket(), true)
        assert.equal(bindStat.dev, publicStat.dev)
        assert.equal(bindStat.ino, publicStat.ino)

        const electronExecutable = require("electron")
        for (const [runtime, executable] of [
            ["node", process.execPath],
            ["electron", electronExecutable],
        ]) {
            assert.deepEqual(
                await invokeControlSocketFrom(executable, socketPath, runtime),
                {id: runtime, result: {runtime}},
            )
        }
        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
            [],
        )
    })

    it("recovers public and private bind links left by a crashed server", async (t) => {
        const userData = await temporaryShortUserData(t)
        const socketPath = expectedSocketPath(userData)
        const serverModule = require.resolve("../src/control-plane/socket-server.cjs")
        const source = [
            'const {ControlSocketServer} = require(process.argv[1])',
            'const server = new ControlSocketServer({userData: process.argv[2], controlPlane: {invoke: async () => ({})}})',
            'server.start().then(() => process.stdout.write("ready\\n"), (error) => { process.stderr.write(error.stack); process.exit(1) })',
            'setInterval(() => {}, 1000)',
        ].join(";")
        const child = spawn(process.execPath, ["-e", source, serverModule, userData], {
            stdio: ["ignore", "pipe", "pipe"],
        })
        let stderr = ""
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8")
        })
        await Promise.race([
            once(child.stdout, "data"),
            once(child, "exit").then(([code]) => {
                throw new Error(`crash fixture exited ${code}: ${stderr}`)
            }),
        ])
        child.kill("SIGKILL")
        await once(child, "exit")

        const controlDir = path.dirname(socketPath)
        const crashedPublic = await fs.promises.lstat(socketPath)
        const crashedBindNames = (await fs.promises.readdir(controlDir))
            .filter((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.equal(crashedBindNames.length, 1)
        const crashedBindDir = path.join(controlDir, crashedBindNames[0])
        const crashedBindDirectoryStat = await fs.promises.lstat(crashedBindDir)
        const crashedBind = await fs.promises.lstat(path.join(crashedBindDir, "s"))
        assert.equal(crashedBindDirectoryStat.mode & 0o777, 0o500)
        assert.equal(crashedBind.dev, crashedPublic.dev)
        assert.equal(crashedBind.ino, crashedPublic.ino)

        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({ok: true})},
        })
        await server.start()
        const replacement = await fs.promises.lstat(socketPath)
        assert.notEqual(replacement.ino, crashedPublic.ino)
        await server.close()
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
            [],
        )
    })

    it("fails closed on unsafe strict bind namespaces and ignores unmatched names", async (t) => {
        for (const kind of [
            "active",
            "file",
            "symlink",
            "inner-file",
            "inner-symlink",
            "extra-entry",
        ]) {
            await t.test(kind, async (caseTest) => {
                const userData = await temporaryUserData(caseTest)
                const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
                const bindDir = path.join(controlDir, ".b-AAAAAAAAAAA")
                const bindPath = path.join(bindDir, "s")
                await fs.promises.mkdir(controlDir, {mode: 0o700})
                let active = null
                if (kind === "active") {
                    await fs.promises.mkdir(bindDir, {mode: 0o700})
                    active = net.createServer((socket) => socket.end())
                    await new Promise((resolve, reject) => {
                        active.once("error", reject)
                        active.listen(bindPath, resolve)
                    })
                    await fs.promises.chmod(bindDir, 0o500)
                } else if (kind === "file") {
                    await fs.promises.writeFile(bindDir, "bind sentinel")
                } else if (kind === "symlink") {
                    const target = path.join(userData, "bind-target")
                    await fs.promises.mkdir(target)
                    await fs.promises.symlink(target, bindDir)
                } else {
                    await fs.promises.mkdir(bindDir, {mode: 0o700})
                    if (kind === "inner-symlink") {
                        const target = path.join(userData, "inner-target")
                        await fs.promises.writeFile(target, "target")
                        await fs.promises.symlink(target, bindPath)
                    } else {
                        await fs.promises.writeFile(bindPath, "inner sentinel")
                    }
                    if (kind === "extra-entry") {
                        await fs.promises.writeFile(path.join(bindDir, "extra"), "extra")
                    }
                    await fs.promises.chmod(bindDir, 0o500)
                }
                const server = new ControlSocketServer({
                    userData,
                    controlPlane: {invoke: async () => ({})},
                })
                try {
                    await assert.rejects(server.start(), /active|in use|directory|entry|socket|refus/i)
                    const occupant = await fs.promises.lstat(bindDir)
                    if (kind === "active") {
                        assert.equal(active.listening, true)
                        assert.equal((await fs.promises.lstat(bindPath)).isSocket(), true)
                    } else if (kind === "file") {
                        assert.equal(await fs.promises.readFile(bindDir, "utf8"), "bind sentinel")
                    } else if (kind === "symlink") {
                        assert.equal(occupant.isSymbolicLink(), true)
                    } else if (kind === "inner-symlink") {
                        assert.equal((await fs.promises.lstat(bindPath)).isSymbolicLink(), true)
                    } else {
                        assert.equal(await fs.promises.readFile(bindPath, "utf8"), "inner sentinel")
                    }
                } finally {
                    await server.close().catch(() => {})
                    if (active?.listening) await new Promise((resolve) => active.close(resolve))
                    if (fs.existsSync(bindDir) && !fs.lstatSync(bindDir).isSymbolicLink()) {
                        await fs.promises.chmod(bindDir, 0o700)
                    }
                }
            })
        }

        const ignoredUserData = await temporaryUserData(t)
        const ignoredDir = path.join(ignoredUserData, CONTROL_SOCKET_DIRECTORY)
        const ignoredPath = path.join(ignoredDir, ".b-not-a-strict-bind-name")
        await fs.promises.mkdir(ignoredDir, {mode: 0o700})
        await fs.promises.writeFile(ignoredPath, "ignore me")
        const server = new ControlSocketServer({
            userData: ignoredUserData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        await server.close()
        assert.equal(await fs.promises.readFile(ignoredPath, "utf8"), "ignore me")
    })

    it("preserves and rejects unsafe identity-named public recovery evidence", async (t) => {
        for (const kind of ["active", "file", "symlink", "mismatched-socket"]) {
            await t.test(kind, async (caseTest) => {
                const userData = await temporaryShortUserData(caseTest)
                const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
                await fs.promises.mkdir(controlDir, {mode: 0o700})
                const preparedPath = path.join(controlDir, "prepared")
                let active = null
                if (kind === "active") {
                    active = net.createServer((socket) => socket.end())
                    await new Promise((resolve, reject) => {
                        active.once("error", reject)
                        active.listen(preparedPath, resolve)
                    })
                    caseTest.after(async () => {
                        if (active.listening) {
                            await new Promise((resolve) => active.close(resolve))
                        }
                    })
                } else if (kind === "file") {
                    await fs.promises.writeFile(preparedPath, "public recovery sentinel")
                } else if (kind === "symlink") {
                    const target = path.join(userData, "public-recovery-target")
                    await fs.promises.writeFile(target, "target sentinel")
                    await fs.promises.symlink(target, preparedPath)
                } else {
                    await makeStaleUnixSocket(preparedPath)
                }
                const preparedStat = await fs.promises.lstat(preparedPath)
                const namedIdentity = kind === "mismatched-socket"
                    ? {...preparedStat, ino: preparedStat.ino + 1}
                    : preparedStat
                const recoveryPath = path.join(controlDir, publicRecoveryName(namedIdentity))
                await fs.promises.rename(preparedPath, recoveryPath)

                const server = new ControlSocketServer({
                    userData,
                    controlPlane: {invoke: async () => ({})},
                })
                try {
                    await assert.rejects(server.start(), /public|recovery|active|socket|identity|refus/i)
                } finally {
                    await server.close().catch(() => {})
                }
                const preserved = await fs.promises.lstat(recoveryPath)
                assert.equal(preserved.dev, preparedStat.dev)
                assert.equal(preserved.ino, preparedStat.ino)
                if (kind === "active") {
                    const socket = await connectRaw(recoveryPath)
                    socket.destroy()
                } else if (kind === "file") {
                    assert.equal(
                        await fs.promises.readFile(recoveryPath, "utf8"),
                        "public recovery sentinel",
                    )
                } else if (kind === "symlink") {
                    assert.equal(preserved.isSymbolicLink(), true)
                } else {
                    assert.equal(preserved.isSocket(), true)
                }
            })
        }
    })

    it("does not blindly remove legacy close quarantine names", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        await fs.promises.mkdir(controlDir, {mode: 0o700})
        const legacyPath = path.join(
            controlDir,
            `${CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX}legacy-sentinel`,
        )
        await fs.promises.writeFile(legacyPath, "legacy close evidence")
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        await server.close()
        assert.equal(await fs.promises.readFile(legacyPath, "utf8"), "legacy close evidence")
    })

    it("preserves a stale bind replacement raced into directory quarantine", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const bindDir = path.join(controlDir, ".b-AAAAAAAAAAA")
        const bindPath = path.join(bindDir, "s")
        await fs.promises.mkdir(bindDir, {recursive: true, mode: 0o700})
        await makeStaleUnixSocket(bindPath)
        await fs.promises.chmod(bindDir, 0o500)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalRenameSync = fs.renameSync
        let exchanged = false
        let recoveryPath = null
        fs.renameSync = (source, destination) => {
            if (
                !exchanged && source === bindDir &&
                path.basename(destination).startsWith(CONTROL_SOCKET_BIND_RECOVERY_PREFIX)
            ) {
                exchanged = true
                fs.unlinkSync(bindPath)
                fs.writeFileSync(bindPath, "bind replacement", {mode: 0o600})
                recoveryPath = destination
            }
            return originalRenameSync(source, destination)
        }
        try {
            await assert.rejects(server.start(), /bind|recovery|mismatch|changed/i)
        } finally {
            fs.renameSync = originalRenameSync
            await server.close().catch(() => {})
        }
        assert.equal(exchanged, true)
        assert.equal(
            await fs.promises.readFile(path.join(recoveryPath, "s"), "utf8"),
            "bind replacement",
        )
        await fs.promises.chmod(recoveryPath, 0o700)
    })

    it("does not depend on private Node server fields", async () => {
        const source = await fs.promises.readFile(
            require.resolve("../src/control-plane/socket-server.cjs"),
            "utf8",
        )
        assert.doesNotMatch(source, /(?:\._(?:pipeName|handle)\b|["']_(?:pipeName|handle)["'])/u)
    })

    it("closes the listener and public socket even when bind protection fails", async (t) => {
        for (const kind of ["file", "symlink", "throwing-lstat"]) {
            await t.test(kind, async (caseTest) => {
                const userData = await temporaryShortUserData(caseTest)
                const originalCreateServer = net.createServer
                let nativeServer = null
                net.createServer = (...args) => {
                    nativeServer = originalCreateServer(...args)
                    return nativeServer
                }
                const server = new ControlSocketServer({
                    userData,
                    controlPlane: {invoke: async () => ({})},
                })
                try {
                    await server.start()
                } finally {
                    net.createServer = originalCreateServer
                }
                const socketPath = server.socketPath
                const controlDir = path.dirname(socketPath)
                const bindName = (await fs.promises.readdir(controlDir))
                    .find((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
                assert.ok(bindName)
                const bindDir = path.join(controlDir, bindName)
                const bindPath = path.join(bindDir, "s")
                let replacementPath = bindDir
                const originalLstatSync = fs.lstatSync
                if (kind === "file" || kind === "symlink") {
                    await fs.promises.chmod(bindDir, 0o700)
                    await fs.promises.unlink(bindPath)
                    await fs.promises.rmdir(bindDir)
                    if (kind === "file") {
                        await fs.promises.writeFile(bindDir, "bind file replacement")
                    } else {
                        const target = path.join(userData, "bind-symlink-target")
                        await fs.promises.mkdir(target)
                        await fs.promises.writeFile(path.join(target, "s"), "target sentinel")
                        await fs.promises.symlink(target, bindDir)
                    }
                } else {
                    let injected = false
                    fs.lstatSync = (candidate, options) => {
                        if (!injected && candidate === bindDir) {
                            injected = true
                            throw new Error("injected protect lstat failure")
                        }
                        return originalLstatSync(candidate, options)
                    }
                }
                try {
                    await assert.rejects(server.close(), /bind|protect|lstat|cleanup|recovery/i)
                } finally {
                    fs.lstatSync = originalLstatSync
                }
                assert.equal(nativeServer.listening, false)
                await assert.rejects(fs.promises.lstat(socketPath), {code: "ENOENT"})
                await assert.rejects(connectRaw(socketPath))
                if (kind === "file") {
                    assert.equal(await fs.promises.readFile(replacementPath, "utf8"), "bind file replacement")
                } else if (kind === "symlink") {
                    const recoveryName = (await fs.promises.readdir(controlDir))
                        .find((name) => /^\.r-[A-Za-z0-9_-]{11}$/u.test(name))
                    assert.ok(recoveryName)
                    replacementPath = path.join(controlDir, recoveryName)
                    assert.equal((await fs.promises.lstat(replacementPath)).isSymbolicLink(), true)
                    assert.equal(
                        await fs.promises.readFile(path.join(userData, "bind-symlink-target", "s"), "utf8"),
                        "target sentinel",
                    )
                }
            })
        }
    })

    it("never overwrites a different inode occupying its public recovery fingerprint", async (t) => {
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        const socketPath = server.socketPath
        const controlDir = path.dirname(socketPath)
        const serverIdentity = await fs.promises.lstat(socketPath)
        const preparedPath = path.join(controlDir, "prepared-recovery.sock")
        await makeStaleUnixSocket(preparedPath)
        const occupantIdentity = await fs.promises.lstat(preparedPath)
        assert.equal(
            occupantIdentity.dev === serverIdentity.dev &&
                occupantIdentity.ino === serverIdentity.ino,
            false,
        )
        const recoveryPath = path.join(controlDir, publicRecoveryName(serverIdentity))
        await fs.promises.rename(preparedPath, recoveryPath)

        await assert.rejects(server.close(), /public|recovery|fingerprint|occupied|collision/i)
        const preserved = await fs.promises.lstat(recoveryPath)
        assert.equal(preserved.isSocket(), true)
        assert.equal(preserved.dev, occupantIdentity.dev)
        assert.equal(preserved.ino, occupantIdentity.ino)
        const publicSocket = await fs.promises.lstat(socketPath)
        assert.equal(publicSocket.dev, serverIdentity.dev)
        assert.equal(publicSocket.ino, serverIdentity.ino)
        await assert.rejects(connectRaw(socketPath))
    })

    it("quarantines a replacement created after the close callback", async (t) => {
        const {server} = await startControlServer(t, {invoke: async () => ({})})
        const socketPath = server.socketPath
        const originalClose = net.Server.prototype.close
        const originalRenameSync = fs.renameSync
        let quarantined = false
        net.Server.prototype.close = function close(callback) {
            return originalClose.call(this, (...args) => {
                if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
                fs.writeFileSync(socketPath, "after-close-callback", {mode: 0o600})
                callback?.(...args)
            })
        }
        fs.renameSync = (source, destination) => {
            if (
                source === socketPath &&
                path.basename(destination).startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX)
            ) quarantined = true
            return originalRenameSync(source, destination)
        }
        try {
            await server.close()
        } finally {
            net.Server.prototype.close = originalClose
            fs.renameSync = originalRenameSync
        }
        assert.equal(quarantined, true)
        assert.equal(await fs.promises.readFile(socketPath, "utf8"), "after-close-callback")
    })

    it("keeps a new occupant created after post-close quarantine", async (t) => {
        const {server} = await startControlServer(t, {invoke: async () => ({})})
        const socketPath = server.socketPath
        const controlDir = path.dirname(socketPath)
        const originalRenameSync = fs.renameSync
        let injected = false
        fs.renameSync = (source, destination) => {
            if (
                !injected && source === socketPath &&
                path.basename(destination).startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX)
            ) {
                injected = true
                originalRenameSync(source, destination)
                fs.writeFileSync(source, "after-quarantine", {mode: 0o600})
                return
            }
            return originalRenameSync(source, destination)
        }
        try {
            await server.close()
        } finally {
            fs.renameSync = originalRenameSync
        }
        assert.equal(injected, true)
        assert.equal(await fs.promises.readFile(socketPath, "utf8"), "after-quarantine")
        assert.deepEqual(
            (await fs.promises.readdir(controlDir))
                .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX)),
            [],
        )
    })

    it("keeps close idempotent when a raced replacement cannot be restored", async (t) => {
        const userData = await temporaryUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        const socketPath = server.socketPath
        const controlDir = path.dirname(socketPath)
        const serverIdentity = await fs.promises.lstat(socketPath)
        await fs.promises.unlink(socketPath)
        await fs.promises.writeFile(socketPath, "quarantined-close-replacement", {mode: 0o600})

        const originalRenameSync = fs.renameSync
        let injected = false
        fs.renameSync = (source, destination) => {
            if (
                !injected && source === socketPath &&
                path.basename(destination).startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX)
            ) {
                injected = true
                originalRenameSync(source, destination)
                fs.writeFileSync(source, "new-close-occupant", {mode: 0o600})
                return
            }
            return originalRenameSync(source, destination)
        }
        try {
            const first = server.close()
            const second = server.close()
            assert.equal(second, first)
            await Promise.all([
                assert.rejects(first, /close|quarantine|restore|occupied/i),
                assert.rejects(second, /close|quarantine|restore|occupied/i),
            ])
        } finally {
            fs.renameSync = originalRenameSync
        }
        assert.equal(await fs.promises.readFile(socketPath, "utf8"), "new-close-occupant")
        const quarantines = (await fs.promises.readdir(controlDir))
            .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX))
        assert.equal(quarantines.length, 1)
        assert.equal(quarantines[0], publicRecoveryName(serverIdentity))
        assert.equal(
            await fs.promises.readFile(path.join(controlDir, quarantines[0]), "utf8"),
            "quarantined-close-replacement",
        )
        assert.equal(server.connectionCount, 0)
    })

    it("cleans up its socket when the close callback reports a failure", async (t) => {
        const userData = await temporaryUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        const socketPath = server.socketPath
        const originalClose = net.Server.prototype.close
        net.Server.prototype.close = function close(callback) {
            return originalClose.call(this, () => callback?.(new Error("injected close failure")))
        }
        try {
            const first = server.close()
            const second = server.close()
            assert.equal(second, first)
            await Promise.all([
                assert.rejects(first, /close failure/),
                assert.rejects(second, /close failure/),
            ])
        } finally {
            net.Server.prototype.close = originalClose
        }
        await assert.rejects(fs.promises.lstat(socketPath), {code: "ENOENT"})
        assert.equal(server.connectionCount, 0)
    })

    it("closes and removes every socket path when bind-socket chmod fails", async (t) => {
        const userData = await temporaryUserData(t)
        const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalChmod = fs.promises.chmod
        let injected = false
        fs.promises.chmod = async (candidate, mode) => {
            if (
                path.basename(candidate) === "s" &&
                path.basename(path.dirname(candidate))
                    .startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)
            ) {
                injected = true
                throw new Error("injected bind chmod failure")
            }
            return originalChmod(candidate, mode)
        }
        try {
            await assert.rejects(server.start(), /bind chmod failure/)
        } finally {
            fs.promises.chmod = originalChmod
            await server.close().catch(() => {})
        }
        assert.equal(injected, true)
        assert.deepEqual(
            (await fs.promises.readdir(controlDir)).filter((name) =>
                name === CONTROL_SOCKET_NAME ||
                name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
            [],
        )
    })

    it("protects the bind namespace before native close during startup cleanup", async (t) => {
        const userData = await temporaryShortUserData(t)
        const socketPath = expectedSocketPath(userData)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalLinkSync = fs.linkSync
        const originalClose = net.Server.prototype.close
        let bindPath = null
        let modeAtClose = null
        let unlinkErrorCode = null
        fs.linkSync = (source, destination) => {
            if (destination === socketPath) {
                bindPath = source
                throw new Error("injected publish failure")
            }
            return originalLinkSync(source, destination)
        }
        net.Server.prototype.close = function close(callback) {
            if (bindPath) {
                modeAtClose = fs.lstatSync(path.dirname(bindPath)).mode & 0o777
                try {
                    fs.unlinkSync(bindPath)
                } catch (error) {
                    unlinkErrorCode = error?.code
                }
            }
            return originalClose.call(this, callback)
        }
        try {
            await assert.rejects(server.start(), /publish/i)
        } finally {
            fs.linkSync = originalLinkSync
            net.Server.prototype.close = originalClose
            await server.close().catch(() => {})
        }
        assert.equal(modeAtClose, 0o500)
        assert.ok(unlinkErrorCode === "EACCES" || unlinkErrorCode === "EPERM")
        assert.deepEqual(await fs.promises.readdir(path.dirname(socketPath)), [])
    })

    it("installs a read-only guard when the bind namespace is missing before close", async (t) => {
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        await server.start()
        const controlDir = path.dirname(server.socketPath)
        const bindName = (await fs.promises.readdir(controlDir))
            .find((name) => /^\.b-[A-Za-z0-9_-]{11}$/u.test(name))
        assert.ok(bindName)
        const bindDir = path.join(controlDir, bindName)
        const bindPath = path.join(bindDir, "s")
        await fs.promises.chmod(bindDir, 0o700)
        await fs.promises.unlink(bindPath)
        await fs.promises.rmdir(bindDir)

        const originalClose = net.Server.prototype.close
        let guardObserved = false
        net.Server.prototype.close = function close(callback) {
            const guard = fs.lstatSync(bindDir)
            guardObserved = guard.isDirectory() && (guard.mode & 0o777) === 0o500
            assert.throws(
                () => fs.writeFileSync(bindPath, "replacement"),
                (error) => error?.code === "EACCES" || error?.code === "EPERM",
            )
            return originalClose.call(this, callback)
        }
        try {
            await server.close()
        } finally {
            net.Server.prototype.close = originalClose
            await server.close().catch(() => {})
        }
        assert.equal(guardObserved, true)
        assert.deepEqual(await fs.promises.readdir(controlDir), [])
    })

    it("rejects an over-budget socket layout before binding and without artifacts", async (t) => {
        const expectedMaximum = process.platform === "linux" ? 107 : 103
        assert.equal(MAX_CONTROL_SOCKET_PATH_BYTES, expectedMaximum)
        assert.equal(
            Buffer.byteLength(CONTROL_SOCKET_BIND_RECOVERY_PREFIX),
            Buffer.byteLength(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX),
        )
        for (const [kind, targetPublicBytes] of [
            ["private-and-recovery", expectedMaximum - 2],
            ["public", expectedMaximum + 1],
        ]) {
            await t.test(kind, async (pathTest) => {
                const userData = await userDataForPublicPathBytes(pathTest, targetPublicBytes)
                const socketPath = expectedSocketPath(userData)
                const server = new ControlSocketServer({
                    userData,
                    controlPlane: {invoke: async () => ({})},
                })
                const originalCreateServer = net.createServer
                let serverCreations = 0
                net.createServer = (...args) => {
                    serverCreations += 1
                    return originalCreateServer(...args)
                }
                try {
                    await assert.rejects(server.start(), /socket path.*too long|path budget/i)
                } finally {
                    net.createServer = originalCreateServer
                    await server.close().catch(() => {})
                }
                assert.equal(serverCreations, 0)
                const controlDir = path.dirname(socketPath)
                if (fs.existsSync(controlDir)) {
                    assert.deepEqual(await fs.promises.readdir(controlDir), [])
                }
            })
        }
    })

    it("bounds collisions while choosing an unpredictable bind namespace", async (t) => {
        assert.ok(Number.isSafeInteger(MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS))
        assert.ok(MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS > 0)
        const userData = await temporaryShortUserData(t)
        const server = new ControlSocketServer({
            userData,
            controlPlane: {invoke: async () => ({})},
        })
        const originalMkdirSync = fs.mkdirSync
        let attempts = 0
        fs.mkdirSync = (candidate, options) => {
            if (
                /^\.b-[A-Za-z0-9_-]{11}$/u.test(path.basename(candidate)) &&
                path.basename(path.dirname(candidate)) === CONTROL_SOCKET_DIRECTORY
            ) {
                attempts += 1
                throw Object.assign(new Error("injected bind collision"), {
                    code: "EEXIST",
                })
            }
            return originalMkdirSync(candidate, options)
        }
        try {
            await assert.rejects(server.start(), /collision|unique|in use/i)
        } finally {
            fs.mkdirSync = originalMkdirSync
            await server.close().catch(() => {})
        }
        assert.equal(attempts, MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS)
    })

    it("never overwrites a publish-race file, socket, or symlink", async (t) => {
        for (const kind of ["file", "socket", "symlink"]) {
            await t.test(kind, async (raceTest) => {
                const userData = await temporaryUserData(raceTest)
                const controlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
                const socketPath = path.join(controlDir, CONTROL_SOCKET_NAME)
                await fs.promises.mkdir(controlDir, {mode: 0o700})
                const preparedSocket = path.join(controlDir, "prepared.sock")
                const symlinkTarget = path.join(userData, "symlink-target")
                let expectedSocketIdentity = null
                if (kind === "socket") {
                    await makeStaleUnixSocket(preparedSocket)
                    expectedSocketIdentity = await fs.promises.lstat(preparedSocket)
                } else if (kind === "symlink") {
                    await fs.promises.writeFile(symlinkTarget, "target")
                }

                const server = new ControlSocketServer({
                    userData,
                    controlPlane: {invoke: async () => ({})},
                })
                const originalLinkSync = fs.linkSync
                let raced = false
                fs.linkSync = (source, destination) => {
                    if (
                        !raced && destination === socketPath &&
                        path.basename(source) === "s" &&
                        path.basename(path.dirname(source))
                            .startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)
                    ) {
                        raced = true
                        if (kind === "file") {
                            fs.writeFileSync(destination, "publish-race file", {mode: 0o600})
                        } else if (kind === "socket") {
                            fs.renameSync(preparedSocket, destination)
                        } else {
                            fs.symlinkSync(symlinkTarget, destination)
                        }
                    }
                    return originalLinkSync(source, destination)
                }
                try {
                    await assert.rejects(server.start(), /publish|exist|link|race/i)
                } finally {
                    fs.linkSync = originalLinkSync
                    await server.close().catch(() => {})
                }
                assert.equal(raced, true)
                const occupant = await fs.promises.lstat(socketPath)
                if (kind === "file") {
                    assert.equal(await fs.promises.readFile(socketPath, "utf8"), "publish-race file")
                } else if (kind === "socket") {
                    assert.equal(occupant.isSocket(), true)
                    assert.equal(occupant.dev, expectedSocketIdentity.dev)
                    assert.equal(occupant.ino, expectedSocketIdentity.ino)
                } else {
                    assert.equal(occupant.isSymbolicLink(), true)
                    assert.equal(await fs.promises.readlink(socketPath), symlinkTarget)
                }
                assert.deepEqual(
                    (await fs.promises.readdir(controlDir))
                        .filter((name) =>
                            name.startsWith(CONTROL_SOCKET_BIND_DIRECTORY_PREFIX)),
                    [],
                )
            })
        }
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
        registerControlServerCleanup(t, userData, server)
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
