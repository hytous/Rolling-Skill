;(function exposeStreamRenderQueue(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillStreamRenderQueue = api
})(typeof globalThis === "undefined" ? this : globalThis, function createStreamRenderQueueApi() {
    "use strict"

    function createStreamRenderQueue({
        render,
        intervalMs = 64,
        schedule = setTimeout,
        cancel = clearTimeout,
    } = {}) {
        if (typeof render !== "function") throw new Error("A stream render callback is required")
        const dirtyItems = new Map()
        let timer = null
        let forceBottom = false

        function flush() {
            if (timer !== null) cancel(timer)
            timer = null
            if (!dirtyItems.size) return
            const items = [...dirtyItems.values()]
            const options = {forceBottom}
            dirtyItems.clear()
            forceBottom = false
            render(items, options)
        }

        function enqueue(turnId, itemId, options = {}) {
            if (!turnId || !itemId) return
            dirtyItems.set(`${turnId}\u0000${itemId}`, {turnId, itemId})
            forceBottom ||= Boolean(options.forceBottom)
            if (timer !== null) return
            timer = schedule(flush, intervalMs)
        }

        function discard() {
            if (timer !== null) cancel(timer)
            timer = null
            dirtyItems.clear()
            forceBottom = false
        }

        return {enqueue, flushNow: flush, cancel: discard}
    }

    return {createStreamRenderQueue}
})

