const DEFAULT_ACTIVITY_INTERVAL_MS = 250

function visibleSignature(activity) {
    return JSON.stringify([
        String(activity?.stage ?? ""),
        String(activity?.summary ?? ""),
    ])
}

class LiveActivityCoalescer {
    constructor({
        emit,
        intervalMs = DEFAULT_ACTIVITY_INTERVAL_MS,
        schedule = setTimeout,
        cancel = clearTimeout,
    } = {}) {
        if (typeof emit !== "function") throw new Error("A live activity emitter is required")
        this.emit = emit
        this.intervalMs = intervalMs
        this.schedule = schedule
        this.cancel = cancel
        this.sessions = new Map()
    }

    cancelPending(state) {
        if (!state.timer) return
        this.cancel(state.timer.handle)
        state.timer = null
        state.pending = null
    }

    emitNow(state, activity, signature = visibleSignature(activity)) {
        state.lastSignature = signature
        this.emit(activity)
    }

    publish(activity) {
        const sessionId = String(activity?.sessionId ?? "").trim()
        if (!sessionId) return
        let state = this.sessions.get(sessionId)
        if (!state) {
            state = {lastSignature: null, pending: null, timer: null}
            this.sessions.set(sessionId, state)
        }
        const signature = visibleSignature(activity)
        if (activity.terminal) {
            this.cancelPending(state)
            this.emitNow(state, activity, signature)
            this.sessions.delete(sessionId)
            return
        }
        if (state.lastSignature !== signature) {
            this.cancelPending(state)
            this.emitNow(state, activity, signature)
            return
        }
        state.pending = activity
        if (state.timer) return
        const token = {}
        const handle = this.schedule(() => {
            const current = this.sessions.get(sessionId)
            if (!current || current.timer?.token !== token) return
            current.timer = null
            const pending = current.pending
            current.pending = null
            if (pending) this.emitNow(current, pending)
        }, this.intervalMs)
        handle?.unref?.()
        state.timer = {handle, token}
    }
}

module.exports = {
    DEFAULT_ACTIVITY_INTERVAL_MS,
    LiveActivityCoalescer,
    visibleSignature,
}

