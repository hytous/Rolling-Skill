const net = require("node:net")
const path = require("node:path")
const {randomUUID} = require("node:crypto")

const {JsonLineDecoder} = require("../json-rpc.cjs")

const DEFAULT_CONTROL_SOCKET_TIMEOUT_MS = 15_000
const MAX_CONTROL_MESSAGE_BYTES = 1_048_576
const MAX_CONTROL_REQUEST_ID_LENGTH = 200
const MAX_CONTROL_METHOD_LENGTH = 200
const MAX_CONTROL_TOKEN_LENGTH = 4_096
const MAX_CONTROL_SESSION_ID_LENGTH = 200
const MAX_PENDING_REQUESTS = 1_024
const MAX_IGNORED_RESPONSE_IDS = 1_024
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])
const stateByClient = new WeakMap()

function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    return Object.getPrototypeOf(value) === Object.prototype
}

function isBoundedString(value, maximum) {
    return typeof value === "string" &&
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= maximum
}

function ownDataValue(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor && Object.hasOwn(descriptor, "value")
        ? {present: true, value: descriptor.value}
        : {present: false, value: undefined}
}

function containsForbiddenObjectKey(root) {
    const pending = [root]
    let visited = 0
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value !== "object" || value === null) continue
        visited += 1
        if (visited > MAX_CONTROL_MESSAGE_BYTES) return true
        if (
            (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) ||
            (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype)
        ) return true
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

function genericError(message, code = "CONTROL_SOCKET_ERROR") {
    const error = new Error(message)
    error.code = code
    return error
}

function validateConstructorOptions(options) {
    if (!isPlainObject(options)) throw new TypeError("Control socket options are required")
    if (
        typeof options.socketPath !== "string" ||
        !path.isAbsolute(options.socketPath) ||
        path.resolve(options.socketPath) !== options.socketPath
    ) throw new TypeError("Control socket path must be an exact absolute path")
    if (!isBoundedString(options.token, MAX_CONTROL_TOKEN_LENGTH)) {
        throw new TypeError("A valid control capability is required")
    }
    if (!isBoundedString(options.sessionId, MAX_CONTROL_SESSION_ID_LENGTH)) {
        throw new TypeError("A valid control session is required")
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONTROL_SOCKET_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new TypeError("Control socket timeout must be positive")
    }
    return timeoutMs
}

function validateResponse(message) {
    if (!isPlainObject(message) || containsForbiddenObjectKey(message)) return null
    const keys = Object.keys(message)
    if (keys.length !== 2 || !keys.includes("id")) return null
    const id = ownDataValue(message, "id")
    if (!id.present || !isBoundedString(id.value, MAX_CONTROL_REQUEST_ID_LENGTH)) return null
    const result = ownDataValue(message, "result")
    const error = ownDataValue(message, "error")
    if (result.present === error.present) return null
    if (result.present) return {id: id.value, kind: "result", value: result.value}
    if (!isPlainObject(error.value) || Object.keys(error.value).length !== 4) return null
    const code = ownDataValue(error.value, "code")
    const messageField = ownDataValue(error.value, "message")
    const retryable = ownDataValue(error.value, "retryable")
    const details = ownDataValue(error.value, "details")
    if (
        !code.present || !isBoundedString(code.value, 200) ||
        !messageField.present || !isBoundedString(messageField.value, 1_000) ||
        !retryable.present || typeof retryable.value !== "boolean" ||
        !details.present
    ) return null
    return {
        id: id.value,
        kind: "error",
        value: {
            code: code.value,
            message: messageField.value,
            retryable: retryable.value,
            details: details.value,
        },
    }
}

function rejectPending(state, error) {
    for (const pending of state.pending.values()) {
        state.clearTimeoutFn(pending.timer)
        pending.reject(error)
    }
    state.pending.clear()
}

function detachSocket(state, socket) {
    if (state.socket !== socket) return
    state.socket = null
    state.connected = false
    state.connectPromise = null
}

function terminate(state, error, {permanent = true} = {}) {
    if (permanent) {
        state.closed = true
        state.ignoredResponseIds.clear()
    }
    rejectPending(state, error)
    const socket = state.socket
    if (socket && !socket.destroyed) socket.destroy()
}

function safeRemoteMessage(state, message) {
    if (message.includes(state.token) || message.includes(state.sessionId)) {
        return "Control operation failed"
    }
    return message
}

function settleResponse(state, message) {
    const response = validateResponse(message)
    if (!response) {
        terminate(state, genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"))
        return
    }
    if (state.ignoredResponseIds.delete(response.id)) return
    const pending = state.pending.get(response.id)
    if (!pending) {
        terminate(state, genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"))
        return
    }
    state.pending.delete(response.id)
    state.clearTimeoutFn(pending.timer)
    if (response.kind === "result") {
        pending.resolve(response.value)
        return
    }
    const error = new Error(safeRemoteMessage(state, response.value.message))
    error.code = response.value.code
    error.retryable = response.value.retryable
    error.details = response.value.details
    pending.reject(error)
}

class ControlSocketClient {
    constructor(options = {}) {
        const timeoutMs = validateConstructorOptions(options)
        stateByClient.set(this, {
            socketPath: options.socketPath,
            token: options.token,
            sessionId: options.sessionId,
            timeoutMs,
            idFactory: options.idFactory ?? randomUUID,
            setTimeoutFn: options.setTimeoutFn ?? setTimeout,
            clearTimeoutFn: options.clearTimeoutFn ?? clearTimeout,
            socket: null,
            connected: false,
            connectPromise: null,
            pending: new Map(),
            ignoredResponseIds: new Set(),
            closed: false,
        })
    }

    async #connect(state) {
        if (state.closed) throw genericError("Control socket client is closed")
        if (state.connected && state.socket && !state.socket.destroyed) return state.socket
        if (state.connectPromise) return state.connectPromise

        const socket = net.createConnection(state.socketPath)
        state.socket = socket
        const decoder = new JsonLineDecoder(
            (message) => settleResponse(state, message),
            () => terminate(
                state,
                genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"),
            ),
            {maximumBufferBytes: MAX_CONTROL_MESSAGE_BYTES},
        )
        state.connectPromise = new Promise((resolve, reject) => {
            let connecting = true
            socket.on("data", (chunk) => decoder.push(chunk))
            socket.on("error", () => {
                const error = genericError("Control socket connection failed")
                if (connecting) {
                    connecting = false
                    reject(error)
                }
                terminate(state, error)
            })
            socket.once("connect", () => {
                if (state.closed) {
                    reject(genericError("Control socket client is closed"))
                    socket.destroy()
                    return
                }
                connecting = false
                state.connected = true
                resolve(socket)
            })
            socket.once("close", () => {
                const error = genericError("Control socket disconnected")
                if (connecting) {
                    connecting = false
                    reject(error)
                }
                const wasCurrent = state.socket === socket
                detachSocket(state, socket)
                if (wasCurrent) {
                    terminate(state, error)
                }
                socket.removeAllListeners()
            })
        })
        return state.connectPromise
    }

    async invoke(method, params, options = {}) {
        const state = stateByClient.get(this)
        if (!isBoundedString(method, MAX_CONTROL_METHOD_LENGTH) || !isPlainObject(params)) {
            throw new TypeError("Control request is invalid")
        }
        if (!isPlainObject(options)) throw new TypeError("Control request options are invalid")
        let id
        try {
            id = options.id ?? state.idFactory()
        } catch {
            throw genericError("Control request id generation failed")
        }
        if (!isBoundedString(id, MAX_CONTROL_REQUEST_ID_LENGTH)) {
            throw new TypeError("Control request id is invalid")
        }
        if (state.pending.size >= MAX_PENDING_REQUESTS) {
            throw genericError("Control socket has too many pending requests")
        }
        if (state.pending.has(id) || state.ignoredResponseIds.has(id)) {
            throw new TypeError("Control request id is already in use")
        }
        const timeoutMs = options.timeoutMs ?? state.timeoutMs
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new TypeError("Control request timeout must be positive")
        }
        const socket = await this.#connect(state)
        if (state.closed || socket.destroyed) {
            throw genericError("Control socket client is closed")
        }

        let line
        try {
            line = `${JSON.stringify({
                id,
                method,
                params,
                token: state.token,
                sessionId: state.sessionId,
            })}\n`
        } catch {
            throw new TypeError("Control request is not JSON serializable")
        }
        if (Buffer.byteLength(line, "utf8") - 1 > MAX_CONTROL_MESSAGE_BYTES) {
            throw new RangeError("Control request exceeds the maximum message size")
        }

        return new Promise((resolve, reject) => {
            const timer = state.setTimeoutFn(() => {
                const pending = state.pending.get(id)
                if (!pending) return
                state.pending.delete(id)
                if (state.ignoredResponseIds.size >= MAX_IGNORED_RESPONSE_IDS) {
                    const oldest = state.ignoredResponseIds.values().next().value
                    state.ignoredResponseIds.delete(oldest)
                }
                state.ignoredResponseIds.add(id)
                reject(genericError("Control socket request timed out", "CONTROL_TIMEOUT"))
            }, timeoutMs)
            state.pending.set(id, {resolve, reject, timer})
            try {
                socket.write(line, (error) => {
                    if (!error) return
                    const pending = state.pending.get(id)
                    if (!pending) return
                    state.pending.delete(id)
                    state.clearTimeoutFn(pending.timer)
                    pending.reject(genericError("Control socket write failed"))
                    terminate(state, genericError("Control socket disconnected"))
                })
            } catch {
                const pending = state.pending.get(id)
                state.pending.delete(id)
                state.clearTimeoutFn(pending.timer)
                pending.reject(genericError("Control socket write failed"))
                terminate(state, genericError("Control socket disconnected"))
            }
        })
    }

    call(method, params, options) {
        return this.invoke(method, params, options)
    }

    close() {
        const state = stateByClient.get(this)
        if (state.closed) return
        state.closed = true
        state.ignoredResponseIds.clear()
        rejectPending(state, genericError("Control socket client is closed"))
        if (state.socket && !state.socket.destroyed) state.socket.destroy()
    }
}

module.exports = {
    DEFAULT_CONTROL_SOCKET_TIMEOUT_MS,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketClient,
}
