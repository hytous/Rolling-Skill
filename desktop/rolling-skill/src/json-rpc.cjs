class JsonLineDecoder {
    constructor(onMessage, onError = () => {}) {
        this.onMessage = onMessage
        this.onError = onError
        this.buffer = ""
    }

    push(chunk) {
        this.buffer += chunk.toString("utf8")
        let newline = this.buffer.indexOf("\n")
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline).trim()
            this.buffer = this.buffer.slice(newline + 1)
            if (line) {
                try {
                    this.onMessage(JSON.parse(line))
                } catch (error) {
                    this.onError(error, line)
                }
            }
            newline = this.buffer.indexOf("\n")
        }
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

