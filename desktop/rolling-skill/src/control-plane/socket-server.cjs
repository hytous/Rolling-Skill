const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const {randomUUID} = require("node:crypto")

const {JsonLineDecoder} = require("../json-rpc.cjs")
const {publicControlError} = require("./contracts.cjs")

const CONTROL_SOCKET_DIRECTORY = "control"
const CONTROL_SOCKET_NAME = "control.sock"
const CONTROL_SOCKET_QUARANTINE_PREFIX = ".control.sock.stale-"
const CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX = ".control.sock.close-"
const CONTROL_SOCKET_HANDLE_QUARANTINE_PREFIX = ".control.sock.handle-"
const MAX_CONTROL_MESSAGE_BYTES = 1_048_576
const MAX_CONTROL_REQUEST_ID_LENGTH = 200
const MAX_CONTROL_METHOD_LENGTH = 200
const MAX_CONTROL_TOKEN_LENGTH = 4_096
const MAX_CONTROL_SESSION_ID_LENGTH = 200
const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 32
const DEFAULT_MAX_QUEUED_RESPONSES = 32
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])
const stateByServer = new WeakMap()

function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    return Object.getPrototypeOf(value) === Object.prototype
}

function ownDataValue(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor && Object.hasOwn(descriptor, "value")
        ? {present: true, value: descriptor.value}
        : {present: false, value: undefined}
}

function isBoundedString(value, maximum) {
    return typeof value === "string" &&
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= maximum
}

function containsForbiddenObjectKey(root) {
    const pending = [root]
    let visited = 0
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value !== "object" || value === null) continue
        visited += 1
        if (visited > MAX_CONTROL_MESSAGE_BYTES) return true
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return true
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (FORBIDDEN_OBJECT_KEYS.has(key)) return true
            if (!Object.hasOwn(descriptor, "value")) return true
            if (typeof descriptor.value === "object" && descriptor.value !== null) {
                pending.push(descriptor.value)
            }
        }
    }
    return false
}

function parseRequest(message) {
    if (!isPlainObject(message) || containsForbiddenObjectKey(message)) return null
    const id = ownDataValue(message, "id")
    const method = ownDataValue(message, "method")
    const params = ownDataValue(message, "params")
    const token = ownDataValue(message, "token")
    const sessionId = ownDataValue(message, "sessionId")
    if (
        !id.present || !isBoundedString(id.value, MAX_CONTROL_REQUEST_ID_LENGTH) ||
        !method.present || !isBoundedString(method.value, MAX_CONTROL_METHOD_LENGTH) ||
        !params.present || !isPlainObject(params.value) ||
        !token.present || !isBoundedString(token.value, MAX_CONTROL_TOKEN_LENGTH) ||
        !sessionId.present || !isBoundedString(sessionId.value, MAX_CONTROL_SESSION_ID_LENGTH)
    ) return null
    return {
        id: id.value,
        invocation: {
            token: token.value,
            sessionId: sessionId.value,
            method: method.value,
            params: params.value,
        },
    }
}

function checkOwner(stat, label) {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${label} must be owned by the current user`)
    }
}

async function existingLstat(candidate) {
    try {
        return await fs.promises.lstat(candidate)
    } catch (error) {
        if (error?.code === "ENOENT") return null
        throw error
    }
}

async function prepareControlDirectory(userData, configuredControlDir) {
    if (typeof userData !== "string" || !path.isAbsolute(userData) || path.resolve(userData) !== userData) {
        throw new Error("userData must be an exact absolute directory")
    }
    const expectedControlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
    const controlDir = configuredControlDir ?? expectedControlDir
    if (controlDir !== expectedControlDir) {
        throw new Error("Control directory must be the exact configured child")
    }

    const userDataStat = await fs.promises.lstat(userData)
    if (userDataStat.isSymbolicLink() || !userDataStat.isDirectory()) {
        throw new Error("userData must be a real directory")
    }
    checkOwner(userDataStat, "userData")
    const realUserData = await fs.promises.realpath(userData)

    try {
        await fs.promises.mkdir(controlDir, {mode: 0o700})
    } catch (error) {
        if (error?.code !== "EEXIST") throw error
    }
    const controlStat = await fs.promises.lstat(controlDir)
    if (controlStat.isSymbolicLink() || !controlStat.isDirectory()) {
        throw new Error("Control directory must be a real directory, not a symlink")
    }
    checkOwner(controlStat, "Control directory")
    const realControlDir = await fs.promises.realpath(controlDir)
    if (realControlDir !== path.join(realUserData, CONTROL_SOCKET_DIRECTORY)) {
        throw new Error("Control directory must be the exact configured child")
    }
    await fs.promises.chmod(controlDir, 0o700)
    const securedStat = await fs.promises.lstat(controlDir)
    checkOwner(securedStat, "Control directory")
    if ((securedStat.mode & 0o777) !== 0o700) {
        throw new Error("Control directory permissions are not private")
    }
    return {controlDir, socketPath: path.join(controlDir, CONTROL_SOCKET_NAME)}
}

function probeSocket(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath)
        let settled = false
        const finish = (callback, value) => {
            if (settled) return
            settled = true
            socket.removeAllListeners()
            socket.destroy()
            callback(value)
        }
        socket.once("connect", () => finish(resolve, "active"))
        socket.once("error", (error) => {
            if (error?.code === "ECONNREFUSED" || error?.code === "ENOENT") {
                finish(resolve, "stale")
                return
            }
            finish(reject, error)
        })
    })
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino
}

async function removeStaleSocket(socketPath) {
    const initial = await existingLstat(socketPath)
    if (!initial) return
    if (initial.isSymbolicLink() || !initial.isSocket()) {
        throw new Error("Refusing to replace a non-socket control socket path")
    }
    checkOwner(initial, "Control socket")
    if (await probeSocket(socketPath) === "active") {
        throw new Error("Control socket is active or already in use")
    }
    const current = await existingLstat(socketPath)
    if (!current) return
    if (!current.isSocket() || !sameFile(initial, current)) {
        throw new Error("Control socket path changed while checking stale state")
    }
    const controlDir = path.dirname(socketPath)
    if (path.basename(socketPath) !== CONTROL_SOCKET_NAME) {
        throw new Error("Control socket path is not the exact configured child")
    }
    const quarantinePath = path.join(
        controlDir,
        `${CONTROL_SOCKET_QUARANTINE_PREFIX}${process.pid}-${randomUUID()}`,
    )
    if (
        path.dirname(quarantinePath) !== controlDir ||
        !path.basename(quarantinePath).startsWith(CONTROL_SOCKET_QUARANTINE_PREFIX)
    ) throw new Error("Control socket quarantine path is invalid")

    fs.renameSync(socketPath, quarantinePath)
    const quarantined = await fs.promises.lstat(quarantinePath)
    if (quarantined.isSocket() && sameFile(current, quarantined)) {
        fs.unlinkSync(quarantinePath)
        return
    }

    let restored = false
    if (!await existingLstat(socketPath)) {
        try {
            fs.linkSync(quarantinePath, socketPath)
            const linked = await fs.promises.lstat(socketPath)
            if (!sameFile(linked, quarantined)) {
                throw new Error("Restored control socket replacement changed identity")
            }
            fs.unlinkSync(quarantinePath)
            restored = true
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw new Error("Control socket quarantine restore failed", {cause: error})
            }
        }
    }
    throw new Error(restored
        ? "Stale control socket changed before quarantine and was restored"
        : "Stale control socket changed before quarantine; replacement remains quarantined")
}

function quarantinePath(socketPath, prefix) {
    const controlDir = path.dirname(socketPath)
    if (path.basename(socketPath) !== CONTROL_SOCKET_NAME) {
        throw new Error("Control socket path is not the exact configured child")
    }
    const quarantinePath = path.join(
        controlDir,
        `${prefix}${process.pid}-${randomUUID()}`,
    )
    if (
        path.dirname(quarantinePath) !== controlDir ||
        !path.basename(quarantinePath).startsWith(prefix)
    ) throw new Error("Control socket quarantine path is invalid")
    return quarantinePath
}

function tryRestoreQuarantinedPath(socketPath, quarantinePath, identity) {
    try {
        fs.linkSync(quarantinePath, socketPath)
    } catch (error) {
        if (error?.code === "EEXIST") return false
        throw new Error("Control socket close quarantine restore failed", {cause: error})
    }
    const restored = fs.lstatSync(socketPath)
    if (!sameFile(restored, identity)) {
        throw new Error("Restored control socket replacement changed identity")
    }
    fs.unlinkSync(quarantinePath)
    return true
}

async function cleanupClosedSocketPath(socketPath, serverIdentity) {
    if (!socketPath || !serverIdentity) return
    if (!await existingLstat(socketPath)) return

    const closedQuarantinePath = quarantinePath(
        socketPath,
        CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX,
    )
    try {
        fs.renameSync(socketPath, closedQuarantinePath)
    } catch (error) {
        if (error?.code === "ENOENT") return
        throw new Error("Control socket close quarantine failed", {cause: error})
    }

    const quarantined = await fs.promises.lstat(closedQuarantinePath)
    if (quarantined.isSocket() && sameFile(quarantined, serverIdentity)) {
        fs.unlinkSync(closedQuarantinePath)
        return
    }
    if (tryRestoreQuarantinedPath(
        socketPath,
        closedQuarantinePath,
        quarantined,
    )) return
    throw new Error(
        "Control socket close quarantine is occupied; replacement remains quarantined",
    )
}

function disableNodePipePathCleanup(server, socketPath) {
    // Compatibility boundary for the current Node/Electron net.Server: on Unix,
    // close() unlinks its exact `_pipeName`. Clear only that verified own field so
    // a pathname replacement cannot be removed while the listening handle closes.
    const descriptor = Object.getOwnPropertyDescriptor(server, "_pipeName")
    if (
        !descriptor || !Object.hasOwn(descriptor, "value") ||
        descriptor.value !== socketPath || descriptor.writable !== true
    ) {
        throw new Error("Cannot safely disable Node control socket pathname cleanup")
    }
    server._pipeName = null
    const cleared = Object.getOwnPropertyDescriptor(server, "_pipeName")
    if (!cleared || cleared.value !== null) {
        throw new Error("Cannot safely disable Node control socket pathname cleanup")
    }
}

function guardNativePipeHandleClose(server, socketPath) {
    const handle = server?._handle
    const nativeClose = handle?.close
    if (!handle || typeof nativeClose !== "function") {
        throw new Error("Cannot safely guard the Node control socket handle")
    }
    let quarantine = null
    let quarantineIdentity = null
    let guardError = null
    let finalized = false

    const finalize = () => {
        if (finalized) return
        finalized = true
        if (!quarantine) return
        try {
            if (!tryRestoreQuarantinedPath(
                socketPath,
                quarantine,
                quarantineIdentity,
            )) {
                guardError = new Error(
                    "Control socket handle quarantine is occupied; replacement remains quarantined",
                )
            }
        } catch (error) {
            guardError = error
        }
    }
    server.prependOnceListener("close", finalize)

    const guardedClose = function guardedControlSocketHandleClose(...args) {
        try {
            let current
            try {
                current = fs.lstatSync(socketPath)
            } catch (error) {
                if (error?.code !== "ENOENT") throw error
            }
            if (current) {
                quarantine = quarantinePath(
                    socketPath,
                    CONTROL_SOCKET_HANDLE_QUARANTINE_PREFIX,
                )
                fs.renameSync(socketPath, quarantine)
                quarantineIdentity = fs.lstatSync(quarantine)
            }
            return Reflect.apply(nativeClose, this, args)
        } catch (error) {
            guardError = new Error("Control socket handle close guard failed", {cause: error})
            finalize()
            throw guardError
        }
    }
    handle.close = guardedClose
    if (handle.close !== guardedClose) {
        server.off("close", finalize)
        throw new Error("Cannot safely guard the Node control socket handle")
    }
    return {
        finish() {
            if (!finalized) finalize()
            return guardError
        },
    }
}

async function closeListeningHandle(server, socketPath) {
    if (!server?.listening) return
    disableNodePipePathCleanup(server, socketPath)
    // libuv versions that unlink a bound pipe from the native handle ignore
    // `_pipeName`. Guard that synchronous close boundary too, then restore the
    // exact quarantined inode before user close callbacks run.
    const handleGuard = guardNativePipeHandleClose(server, socketPath)
    let closeError = null
    try {
        await new Promise((resolve, reject) => {
            try {
                server.close((error) => error ? reject(error) : resolve())
            } catch (error) {
                reject(error)
            }
        })
    } catch (error) {
        closeError = error
    }
    const guardError = handleGuard.finish()
    if (closeError && guardError) {
        throw new AggregateError(
            [closeError, guardError],
            "Control socket handle close and quarantine restoration failed",
        )
    }
    if (closeError) throw closeError
    if (guardError) throw guardError
}

function serializeResponse(response) {
    let line
    try {
        line = `${JSON.stringify(response)}\n`
    } catch {
        line = `${JSON.stringify({
            id: response.id,
            error: publicControlError(null),
        })}\n`
    }
    return line
}

function attachControlSocketConnection(socket, controlPlane, {
    maxInFlightRequests = DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    maxQueuedResponses = DEFAULT_MAX_QUEUED_RESPONSES,
} = {}) {
    if (
        !Number.isSafeInteger(maxInFlightRequests) || maxInFlightRequests < 1 ||
        !Number.isSafeInteger(maxQueuedResponses) || maxQueuedResponses < 1
    ) throw new TypeError("Control socket connection limits must be positive integers")

    const state = {
        inFlight: 0,
        paused: false,
        outputBackpressured: false,
        responseQueue: [],
        closed: false,
    }
    const pause = () => {
        if (state.closed || state.paused) return
        state.paused = true
        socket.pause()
    }
    const close = () => {
        if (state.closed) return
        state.closed = true
        state.responseQueue.length = 0
        if (!socket.destroyed) socket.destroy()
    }
    const maybeResume = () => {
        if (
            state.closed || socket.destroyed || !state.paused ||
            state.inFlight >= maxInFlightRequests ||
            state.outputBackpressured || state.responseQueue.length > 0
        ) return
        state.paused = false
        socket.resume()
    }
    const writeLine = (line) => {
        if (state.closed || socket.destroyed || !socket.writable) return false
        try {
            const accepted = socket.write(line, (error) => {
                if (error) close()
            })
            if (!accepted) {
                state.outputBackpressured = true
                pause()
            }
            return true
        } catch {
            close()
            return false
        }
    }
    const send = (response) => {
        if (state.closed || socket.destroyed) return
        const line = serializeResponse(response)
        if (state.outputBackpressured || state.responseQueue.length > 0) {
            if (state.responseQueue.length >= maxQueuedResponses) {
                close()
                return
            }
            state.responseQueue.push(line)
            return
        }
        writeLine(line)
    }
    const settle = (response) => {
        if (state.closed) return
        state.inFlight -= 1
        send(response)
        maybeResume()
    }
    const decoder = new JsonLineDecoder(
        (message) => {
            if (state.closed || socket.destroyed) return
            if (state.inFlight >= maxInFlightRequests) {
                pause()
                close()
                return
            }
            const request = parseRequest(message)
            if (!request) {
                close()
                return
            }
            state.inFlight += 1
            if (state.inFlight >= maxInFlightRequests) pause()
            Promise.resolve()
                .then(() => controlPlane.invoke(request.invocation))
                .then(
                    (result) => settle({id: request.id, result}),
                    (error) => settle({id: request.id, error: publicControlError(error)}),
                )
                .catch(close)
        },
        close,
        {maximumBufferBytes: MAX_CONTROL_MESSAGE_BYTES},
    )
    const onData = (chunk) => decoder.push(chunk)
    const onDrain = () => {
        if (state.closed) return
        state.outputBackpressured = false
        while (!state.outputBackpressured && state.responseQueue.length > 0) {
            const line = state.responseQueue.shift()
            if (!writeLine(line)) return
        }
        maybeResume()
    }
    const onClose = () => {
        state.closed = true
        state.responseQueue.length = 0
    }
    socket.on("data", onData)
    socket.on("drain", onDrain)
    socket.on("error", close)
    socket.once("close", onClose)
    return {close}
}

class ControlSocketServer {
    constructor({userData, controlDir, controlPlane} = {}) {
        stateByServer.set(this, {
            userData,
            configuredControlDir: controlDir,
            controlPlane,
            server: null,
            socketPath: null,
            socketIdentity: null,
            connections: new Set(),
            startPromise: null,
            closePromise: null,
            closed: false,
        })
    }

    get socketPath() {
        return stateByServer.get(this).socketPath
    }

    get connectionCount() {
        return stateByServer.get(this).connections.size
    }

    start() {
        const state = stateByServer.get(this)
        if (state.startPromise) return state.startPromise
        state.startPromise = this.#start(state)
        return state.startPromise
    }

    async #start(state) {
        if (state.closed) throw new Error("Control socket server is closed")
        if (!state.controlPlane || typeof state.controlPlane.invoke !== "function") {
            throw new Error("A control plane is required")
        }
        const layout = await prepareControlDirectory(
            state.userData,
            state.configuredControlDir,
        )
        state.socketPath = layout.socketPath
        await removeStaleSocket(state.socketPath)

        const server = net.createServer((socket) => this.#accept(state, socket))
        state.server = server
        server.on("error", () => {})
        try {
            await new Promise((resolve, reject) => {
                const onError = (error) => {
                    server.off("listening", onListening)
                    reject(error)
                }
                const onListening = () => {
                    server.off("error", onError)
                    resolve()
                }
                server.once("error", onError)
                server.once("listening", onListening)
                server.listen(state.socketPath)
            })
            await fs.promises.chmod(state.socketPath, 0o600)
            const socketStat = await fs.promises.lstat(state.socketPath)
            if (!socketStat.isSocket()) throw new Error("Control socket path is not a socket")
            checkOwner(socketStat, "Control socket")
            state.socketIdentity = socketStat
            return this
        } catch (error) {
            await closeListeningHandle(server, state.socketPath)
            await cleanupClosedSocketPath(state.socketPath, state.socketIdentity)
            throw error
        }
    }

    #accept(state, socket) {
        if (state.closed) {
            socket.destroy()
            return
        }
        state.connections.add(socket)
        socket.once("close", () => state.connections.delete(socket))
        attachControlSocketConnection(socket, state.controlPlane)
    }

    close() {
        const state = stateByServer.get(this)
        if (state.closePromise) return state.closePromise
        state.closed = true
        state.closePromise = this.#close(state)
        return state.closePromise
    }

    async #close(state) {
        for (const socket of state.connections) socket.destroy()
        state.connections.clear()
        let closeError = null
        try {
            await closeListeningHandle(state.server, state.socketPath)
        } catch (error) {
            closeError = error
        }
        if (closeError && state.server?.listening) throw closeError

        let cleanupError = null
        try {
            await cleanupClosedSocketPath(state.socketPath, state.socketIdentity)
        } catch (error) {
            cleanupError = error
        }
        if (closeError && cleanupError) {
            throw new AggregateError(
                [closeError, cleanupError],
                "Control socket close and cleanup failed",
            )
        }
        if (closeError) throw closeError
        if (cleanupError) throw cleanupError
    }
}

module.exports = {
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX,
    CONTROL_SOCKET_QUARANTINE_PREFIX,
    DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    DEFAULT_MAX_QUEUED_RESPONSES,
    MAX_CONTROL_MESSAGE_BYTES,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketServer,
    attachControlSocketConnection,
}
