const net = require("node:net")
const path = require("node:path")
const {randomUUID} = require("node:crypto")

const {JsonLineDecoder} = require("../json-rpc.cjs")
const {
    PUBLIC_CONTROL_ERROR_CODES,
    createPublicControlError,
    publicControlError,
} = require("./contracts.cjs")

const DEFAULT_CONTROL_SOCKET_TIMEOUT_MS = 15_000
const MAX_CONTROL_MESSAGE_BYTES = 1_048_576
const MAX_CONTROL_REQUEST_ID_LENGTH = 200
const MAX_CONTROL_METHOD_LENGTH = 200
const MAX_CONTROL_TOKEN_LENGTH = 4_096
const MAX_CONTROL_SESSION_ID_LENGTH = 200
const DEFAULT_MAX_PENDING_REQUESTS = 32
const DEFAULT_MAX_UNSENT_REQUESTS = 32
const DEFAULT_MAX_USED_REQUEST_IDS = 4_096
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])
const PUBLIC_CONTROL_ERROR_CODE_SET = new Set(PUBLIC_CONTROL_ERROR_CODES)
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
    const maxPendingRequests = options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS
    const maxUnsentRequests = options.maxUnsentRequests ?? DEFAULT_MAX_UNSENT_REQUESTS
    const maxUsedRequestIds = options.maxUsedRequestIds ?? DEFAULT_MAX_USED_REQUEST_IDS
    if (
        !Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 1 ||
        !Number.isSafeInteger(maxUnsentRequests) || maxUnsentRequests < 1 ||
        !Number.isSafeInteger(maxUsedRequestIds) || maxUsedRequestIds < 1
    ) throw new TypeError("Control socket queue limits must be positive integers")
    if (options.socketFactory !== undefined && typeof options.socketFactory !== "function") {
        throw new TypeError("Control socket factory must be a function")
    }
    return {timeoutMs, maxPendingRequests, maxUnsentRequests, maxUsedRequestIds}
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

function removeUnsentRequest(state, id) {
    const index = state.unsentQueue.indexOf(id)
    if (index >= 0) state.unsentQueue.splice(index, 1)
}

function containsAuthorityString(root, state) {
    const pending = [root]
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value === "string") {
            if (value.includes(state.token) || value.includes(state.sessionId)) return true
            continue
        }
        if (typeof value !== "object" || value === null) continue
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (key.includes(state.token) || key.includes(state.sessionId)) return true
            if (Object.hasOwn(descriptor, "value")) pending.push(descriptor.value)
        }
    }
    return false
}

function canonicalRemoteError(state, remoteError) {
    const fallback = publicControlError(null)
    if (containsAuthorityString(remoteError, state)) return fallback
    if (!PUBLIC_CONTROL_ERROR_CODE_SET.has(remoteError.code)) return fallback
    try {
        const canonical = publicControlError(createPublicControlError(remoteError.code, {
            details: remoteError.details,
        }))
        if (
            remoteError.message !== canonical.message ||
            remoteError.retryable !== canonical.retryable
        ) return fallback
        return canonical
    } catch {
        return fallback
    }
}

function rejectPendingGeneration(state, generation, error, exceptId = null) {
    for (const [id, pending] of state.pending) {
        if (pending.generation !== generation || id === exceptId) continue
        state.pending.delete(id)
        removeUnsentRequest(state, id)
        if (pending.timer !== null) state.clearTimeoutFn(pending.timer)
        pending.reject(error)
    }
}

function rejectAllPending(state, error) {
    for (const pending of state.pending.values()) {
        if (pending.timer !== null) state.clearTimeoutFn(pending.timer)
        pending.reject(error)
    }
    state.pending.clear()
    state.unsentQueue.length = 0
}

function isolateConnection(state, generation, error, exceptId = null) {
    rejectPendingGeneration(state, generation, error, exceptId)
    if (generation !== state.generation) return
    const socket = state.socket
    const rejectConnect = state.connectReject
    state.socket = null
    state.connected = false
    state.connectPromise = null
    state.connectReject = null
    state.outputBackpressured = false
    state.unsentQueue.length = 0
    state.usedIds.clear()
    if (socket && typeof socket.removeAllListeners === "function") {
        socket.removeAllListeners()
    }
    if (rejectConnect) rejectConnect(error)
    if (socket && !socket.destroyed) socket.destroy()
}

function settleResponse(state, message, generation, socket) {
    if (state.closed || state.generation !== generation || state.socket !== socket) return
    const response = validateResponse(message)
    if (!response) {
        isolateConnection(
            state,
            generation,
            genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"),
        )
        return
    }
    const pending = state.pending.get(response.id)
    if (!pending || pending.generation !== generation) {
        isolateConnection(
            state,
            generation,
            genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"),
        )
        return
    }
    state.pending.delete(response.id)
    removeUnsentRequest(state, response.id)
    if (pending.timer !== null) state.clearTimeoutFn(pending.timer)
    if (response.kind === "result") {
        pending.resolve(response.value)
        return
    }
    const published = canonicalRemoteError(state, response.value)
    const error = new Error(published.message)
    error.code = published.code
    error.retryable = published.retryable
    error.details = published.details
    pending.reject(error)
}

function failPendingWrite(state, id, generation) {
    const pending = state.pending.get(id)
    if (!pending || pending.generation !== generation) return
    state.pending.delete(id)
    removeUnsentRequest(state, id)
    if (pending.timer !== null) state.clearTimeoutFn(pending.timer)
    pending.reject(genericError("Control socket write failed"))
    isolateConnection(
        state,
        generation,
        genericError("Control socket disconnected"),
        id,
    )
}

function writePendingRequest(state, pending) {
    const socket = state.socket
    if (
        !socket || socket.destroyed || state.closed ||
        state.generation !== pending.generation
    ) {
        failPendingWrite(state, pending.id, pending.generation)
        return false
    }
    pending.sent = true
    pending.queued = false
    try {
        const accepted = socket.write(pending.line, (error) => {
            if (error) failPendingWrite(state, pending.id, pending.generation)
        })
        if (!accepted) state.outputBackpressured = true
        return true
    } catch {
        failPendingWrite(state, pending.id, pending.generation)
        return false
    }
}

function queueOrWritePendingRequest(state, pending) {
    if (!state.outputBackpressured && state.unsentQueue.length === 0) {
        writePendingRequest(state, pending)
        return
    }
    if (state.unsentQueue.length >= state.maxUnsentRequests) {
        state.pending.delete(pending.id)
        if (pending.timer !== null) state.clearTimeoutFn(pending.timer)
        pending.reject(genericError(
            "Control socket backpressure queue is full",
            "CONTROL_BACKPRESSURE",
        ))
        return
    }
    pending.queued = true
    state.unsentQueue.push(pending.id)
}

function flushUnsentRequests(state, socket) {
    if (state.closed || state.socket !== socket || socket.destroyed) return
    state.outputBackpressured = false
    while (!state.outputBackpressured && state.unsentQueue.length > 0) {
        const id = state.unsentQueue.shift()
        const pending = state.pending.get(id)
        if (!pending) continue
        if (!writePendingRequest(state, pending)) return
    }
}

function beginConnection(state) {
    if (state.closed) {
        const promise = Promise.reject(genericError("Control socket client is closed"))
        promise.catch(() => {})
        return promise
    }
    if (state.connected && state.socket && !state.socket.destroyed) {
        return Promise.resolve({socket: state.socket, generation: state.generation})
    }
    if (state.connectPromise) return state.connectPromise

    const generation = state.generation + 1
    state.generation = generation
    let socket
    try {
        socket = state.socketFactory(state.socketPath)
        if (!socket || typeof socket.on !== "function" || typeof socket.write !== "function") {
            throw new TypeError("Invalid socket")
        }
    } catch {
        const error = genericError("Control socket connection failed")
        rejectPendingGeneration(state, generation, error)
        state.usedIds.clear()
        const promise = Promise.reject(error)
        promise.catch(() => {})
        return promise
    }

    state.socket = socket
    const decoder = new JsonLineDecoder(
        (message) => settleResponse(state, message, generation, socket),
        () => isolateConnection(
            state,
            generation,
            genericError("Control socket protocol error", "CONTROL_PROTOCOL_ERROR"),
        ),
        {maximumBufferBytes: MAX_CONTROL_MESSAGE_BYTES},
    )
    let settled = false
    const connectPromise = new Promise((resolve, reject) => {
        state.connectReject = (error) => {
            if (settled) return
            settled = true
            reject(error)
        }
        socket.on("data", (chunk) => {
            if (state.generation === generation && state.socket === socket) decoder.push(chunk)
        })
        socket.on("drain", () => {
            if (state.generation === generation) flushUnsentRequests(state, socket)
        })
        socket.on("error", () => {
            if (state.generation !== generation || state.socket !== socket) return
            isolateConnection(
                state,
                generation,
                genericError(settled
                    ? "Control socket disconnected"
                    : "Control socket connection failed"),
            )
        })
        socket.once("connect", () => {
            if (
                state.closed || state.generation !== generation ||
                state.socket !== socket || socket.destroyed
            ) {
                state.connectReject?.(genericError("Control socket client is closed"))
                if (!socket.destroyed) socket.destroy()
                return
            }
            settled = true
            state.connectReject = null
            state.connected = true
            resolve({socket, generation})
        })
        socket.once("close", () => {
            if (state.generation !== generation || state.socket !== socket) return
            isolateConnection(
                state,
                generation,
                genericError("Control socket disconnected"),
            )
        })
    })
    connectPromise.catch(() => {})
    state.connectPromise = connectPromise
    return connectPromise
}

function timeoutPendingRequest(state, pending) {
    if (state.pending.get(pending.id) !== pending) return
    state.pending.delete(pending.id)
    removeUnsentRequest(state, pending.id)
    pending.reject(genericError("Control socket request timed out", "CONTROL_TIMEOUT"))
    if (pending.generation > state.generation && !state.socket) {
        state.generation = pending.generation
    }
    isolateConnection(
        state,
        pending.generation,
        genericError("Control socket disconnected"),
        pending.id,
    )
}

function closeClient(state) {
    if (state.closed) return
    state.closed = true
    const error = genericError("Control socket client is closed")
    rejectAllPending(state, error)
    const socket = state.socket
    const rejectConnect = state.connectReject
    state.socket = null
    state.connected = false
    state.connectPromise = null
    state.connectReject = null
    state.outputBackpressured = false
    state.usedIds.clear()
    if (socket && typeof socket.removeAllListeners === "function") {
        socket.removeAllListeners()
    }
    if (rejectConnect) rejectConnect(error)
    if (socket && !socket.destroyed) socket.destroy()
}

class ControlSocketClient {
    constructor(options = {}) {
        const limits = validateConstructorOptions(options)
        stateByClient.set(this, {
            socketPath: options.socketPath,
            token: options.token,
            sessionId: options.sessionId,
            timeoutMs: limits.timeoutMs,
            maxPendingRequests: limits.maxPendingRequests,
            maxUnsentRequests: limits.maxUnsentRequests,
            maxUsedRequestIds: limits.maxUsedRequestIds,
            idFactory: options.idFactory ?? randomUUID,
            setTimeoutFn: options.setTimeoutFn ?? setTimeout,
            clearTimeoutFn: options.clearTimeoutFn ?? clearTimeout,
            socketFactory: options.socketFactory ?? ((socketPath) => net.createConnection(socketPath)),
            socket: null,
            connected: false,
            connectPromise: null,
            connectReject: null,
            generation: 0,
            pending: new Map(),
            unsentQueue: [],
            outputBackpressured: false,
            usedIds: new Set(),
            closed: false,
        })
    }

    async invoke(method, params, options = {}) {
        const state = stateByClient.get(this)
        if (!isBoundedString(method, MAX_CONTROL_METHOD_LENGTH) || !isPlainObject(params)) {
            throw new TypeError("Control request is invalid")
        }
        if (!isPlainObject(options)) throw new TypeError("Control request options are invalid")
        if (state.closed) throw genericError("Control socket client is closed")
        if (state.socket?.destroyed) {
            isolateConnection(
                state,
                state.generation,
                genericError("Control socket disconnected"),
            )
        }
        if (state.pending.size >= state.maxPendingRequests) {
            throw genericError("Control socket has too many pending requests")
        }
        let id
        try {
            id = options.id ?? state.idFactory()
        } catch {
            throw genericError("Control request id generation failed")
        }
        if (!isBoundedString(id, MAX_CONTROL_REQUEST_ID_LENGTH)) {
            throw new TypeError("Control request id is invalid")
        }
        if (state.usedIds.size >= state.maxUsedRequestIds) {
            if (state.pending.size > 0) {
                throw genericError(
                    "Control socket request ID capacity requires reconnect",
                    "CONTROL_CAPACITY",
                )
            }
            isolateConnection(
                state,
                state.generation,
                genericError("Control socket connection rotated"),
            )
        }
        if (state.usedIds.has(id)) {
            throw new TypeError("Control request id is already in use")
        }
        const timeoutMs = options.timeoutMs ?? state.timeoutMs
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new TypeError("Control request timeout must be positive")
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

        let resolveRequest
        let rejectRequest
        const requestPromise = new Promise((resolve, reject) => {
            resolveRequest = resolve
            rejectRequest = reject
        })
        requestPromise.catch(() => {})
        const pending = {
            id,
            line,
            resolve: resolveRequest,
            reject: rejectRequest,
            timer: null,
            sent: false,
            queued: false,
            generation: state.socket || state.connectPromise
                ? state.generation
                : state.generation + 1,
        }
        state.pending.set(id, pending)
        state.usedIds.add(id)
        try {
            pending.timer = state.setTimeoutFn(
                () => timeoutPendingRequest(state, pending),
                timeoutMs,
            )
        } catch {
            state.pending.delete(id)
            pending.reject(genericError("Control socket timeout setup failed"))
        }
        if (state.pending.get(id) !== pending) return requestPromise

        beginConnection(state).then(
            ({socket, generation}) => {
                if (
                    state.closed || socket.destroyed ||
                    state.pending.get(id) !== pending ||
                    pending.generation !== generation ||
                    state.generation !== generation
                ) return
                queueOrWritePendingRequest(state, pending)
            },
            () => {
                // Connection failure rejects the matching generation centrally.
            }
        )
        return requestPromise
    }

    call(method, params, options) {
        return this.invoke(method, params, options)
    }

    close() {
        closeClient(stateByClient.get(this))
    }
}

module.exports = {
    DEFAULT_CONTROL_SOCKET_TIMEOUT_MS,
    DEFAULT_MAX_PENDING_REQUESTS,
    DEFAULT_MAX_UNSENT_REQUESTS,
    DEFAULT_MAX_USED_REQUEST_IDS,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    ControlSocketClient,
}
