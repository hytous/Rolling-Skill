function createConversationMarkerSource({load, schedule = setTimeout, cancel = clearTimeout, listen = null, intervalMs = 5_000}) {
    const entries = new Map()
    let subscriberCount = 0
    let stopListening = null
    const ensure = (sessionId) => {
        if (!entries.has(sessionId)) entries.set(sessionId, {snapshot: {loading: true, markers: []}, listeners: new Set(), timer: null, pending: null, version: 0})
        return entries.get(sessionId)
    }
    function refresh(sessionId) {
        const entry = entries.get(sessionId)
        if (!entry?.listeners.size) return
        entry.version += 1
        if (entry.pending) return
        if (entry.timer !== null) cancel(entry.timer)
        entry.timer = null
        const version = entry.version
        const controller = new AbortController()
        entry.pending = controller
        const active = () => entries.get(sessionId) === entry && entry.listeners.size > 0
        const update = (markers) => {
            if (!active() || version !== entry.version) return
            if (entry.snapshot.loading || JSON.stringify(markers) !== JSON.stringify(entry.snapshot.markers)) {
                entry.snapshot = {loading: false, markers}
                for (const listener of entry.listeners) listener()
            }
        }
        Promise.resolve().then(() => load(sessionId, controller.signal))
            .then(update)
            .catch(() => update(entry.snapshot.markers))
            .finally(() => {
                entry.pending = null
                if (!active()) return
                if (entry.version !== version) refresh(sessionId)
                else entry.timer = schedule(() => {entry.timer = null; refresh(sessionId)}, intervalMs)
            })
    }
    return {
        getSnapshot: (sessionId) => ensure(sessionId).snapshot,
        refresh,
        subscribe(sessionId, listener) {
            const entry = ensure(sessionId)
            entry.listeners.add(listener)
            subscriberCount += 1
            if (subscriberCount === 1 && listen) stopListening = listen((changedSessionId) => {
                for (const id of entries.keys()) if (!changedSessionId || changedSessionId === id) refresh(id)
            })
            if (entry.listeners.size === 1) refresh(sessionId)
            return () => {
                if (!entry.listeners.delete(listener)) return
                subscriberCount -= 1
                if (!entry.listeners.size) {
                    if (entry.timer !== null) cancel(entry.timer)
                    entry.pending?.abort()
                    entries.delete(sessionId)
                }
                if (!subscriberCount) {stopListening?.(); stopListening = null}
            }
        },
    }
}

module.exports = {createConversationMarkerSource}
