class JsonLineDecoder {
    constructor(onMessage, onError = () => {}, {maximumBufferBytes = Infinity} = {}) {
        this.onMessage = onMessage
        this.onError = onError
        this.maximumBufferBytes = maximumBufferBytes
        this.buffer = Buffer.alloc(0)
        this.terminated = false
    }

    push(chunk) {
        if (this.terminated) return false
        const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        if (incoming.length === 0) return true
        this.buffer = this.buffer.length === 0
            ? Buffer.from(incoming)
            : Buffer.concat([this.buffer, incoming])
        let newline = this.buffer.indexOf(0x0a)
        while (newline >= 0) {
            if (newline > this.maximumBufferBytes) return this.#overflow()
            const line = this.buffer.subarray(0, newline).toString("utf8").trim()
            this.buffer = this.buffer.slice(newline + 1)
            this.#decode(line)
            if (this.terminated) return false
            newline = this.buffer.indexOf(0x0a)
        }
        if (this.buffer.length > this.maximumBufferBytes) return this.#overflow()
        return true
    }

    end(chunk) {
        if (chunk !== undefined && !this.push(chunk)) return false
        if (this.terminated) return false
        if (this.buffer.length > this.maximumBufferBytes) return this.#overflow()
        const line = this.buffer.toString("utf8").trim()
        this.buffer = Buffer.alloc(0)
        this.#decode(line)
        return !this.terminated
    }

    #decode(line) {
        if (!line) return
        try {
            this.onMessage(JSON.parse(line))
        } catch (error) {
            this.onError(error, line)
        }
    }

    #overflow() {
        this.buffer = Buffer.alloc(0)
        this.terminated = true
        this.onError(new RangeError("JSON line exceeded the maximum buffer bytes"), null)
        return false
    }
}

class RpcRequestTracker {
    constructor() {
        this.nextId = 1
        this.pending = new Map()
    }

    create(method, params) {
        const id = this.nextId
        this.nextId += 1
        const message = {id, method, params}
        let resolvePromise
        let rejectPromise
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve
            rejectPromise = reject
        })
        this.pending.set(id, {resolve: resolvePromise, reject: rejectPromise})
        return {message, promise}
    }

    settle(message) {
        if (message?.id === undefined || message?.id === null) return false
        const pending = this.pending.get(message.id)
        if (!pending) return false
        this.pending.delete(message.id)
        if (message.error) {
            const error = new Error(message.error.message || "Codex app-server request failed")
            error.code = message.error.code
            error.data = message.error.data
            pending.reject(error)
        } else {
            pending.resolve(message.result)
        }
        return true
    }

    rejectAll(error) {
        for (const pending of this.pending.values()) pending.reject(error)
        this.pending.clear()
    }
}

module.exports = {JsonLineDecoder, RpcRequestTracker}
