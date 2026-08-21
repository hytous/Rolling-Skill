const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const {randomUUID} = require("node:crypto")

const {JsonLineDecoder} = require("../json-rpc.cjs")
const {publicControlError} = require("./contracts.cjs")

const CONTROL_SOCKET_DIRECTORY = "control"
const CONTROL_SOCKET_NAME = "control.sock"
const MAX_CONTROL_MESSAGE_BYTES = 1_048_576
const MAX_CONTROL_REQUEST_ID_LENGTH = 200
const MAX_CONTROL_METHOD_LENGTH = 200
const MAX_CONTROL_TOKEN_LENGTH = 4_096
const MAX_CONTROL_SESSION_ID_LENGTH = 200
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
    await fs.promises.unlink(socketPath)
}

async function removeOwnedSocket(socketPath, identity) {
    if (!identity) return
    const current = await existingLstat(socketPath)
    if (current?.isSocket() && sameFile(current, identity)) {
        await fs.promises.unlink(socketPath)
    }
}

async function preserveReplacement(socketPath, identity) {
    if (!socketPath || !identity) return null
    const current = await existingLstat(socketPath)
    if (!current || sameFile(current, identity)) return null
    const preservedPath = path.join(
        path.dirname(socketPath),
        `.${CONTROL_SOCKET_NAME}.preserved-${process.pid}-${randomUUID()}`,
    )
    await fs.promises.rename(socketPath, preservedPath)
    return preservedPath
}

async function restoreReplacement(socketPath, preservedPath) {
    if (!preservedPath) return
    if (await existingLstat(socketPath)) {
        throw new Error("Control socket path changed while restoring a preserved replacement")
    }
    await fs.promises.rename(preservedPath, socketPath)
}

function writeResponse(socket, response) {
    if (socket.destroyed || !socket.writable) return
    let line
    try {
        line = `${JSON.stringify(response)}\n`
    } catch {
        line = `${JSON.stringify({
            id: response.id,
            error: publicControlError(null),
        })}\n`
    }
    try {
        socket.write(line, (error) => {
            if (error && !socket.destroyed) socket.destroy()
        })
    } catch {
        socket.destroy()
    }
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
            await new Promise((resolve) => {
                if (server.listening) server.close(resolve)
                else resolve()
            })
            await removeOwnedSocket(state.socketPath, state.socketIdentity)
            throw error
        }
    }

    #accept(state, socket) {
        if (state.closed) {
            socket.destroy()
            return
        }
        state.connections.add(socket)
        socket.on("error", () => {})
        socket.once("close", () => state.connections.delete(socket))
        const decoder = new JsonLineDecoder(
            (message) => {
                if (socket.destroyed) return
                const request = parseRequest(message)
                if (!request) {
                    socket.destroy()
                    return
                }
                Promise.resolve()
                    .then(() => state.controlPlane.invoke(request.invocation))
                    .then(
                        (result) => writeResponse(socket, {id: request.id, result}),
                        (error) => writeResponse(socket, {
                            id: request.id,
                            error: publicControlError(error),
                        }),
                    )
                    .catch(() => socket.destroy())
            },
            () => socket.destroy(),
            {maximumBufferBytes: MAX_CONTROL_MESSAGE_BYTES},
        )
        socket.on("data", (chunk) => decoder.push(chunk))
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
        const preservedPath = await preserveReplacement(
            state.socketPath,
            state.socketIdentity,
        )
        if (state.server?.listening) {
            await new Promise((resolve) => state.server.close(resolve))
        }
        await removeOwnedSocket(state.socketPath, state.socketIdentity)
        await restoreReplacement(state.socketPath, preservedPath)
    }
}

module.exports = {
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    MAX_CONTROL_MESSAGE_BYTES,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketServer,
}
