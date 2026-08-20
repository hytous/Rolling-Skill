const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createStreamRenderQueue} = require("../renderer/stream-render-queue.js")

describe("stream render queue", () => {
    it("coalesces repeated dirty items into one bounded flush", () => {
        const scheduled = []
        const renders = []
        const queue = createStreamRenderQueue({
            intervalMs: 64,
            schedule(callback, delayMs) {
                scheduled.push({callback, delayMs})
                return scheduled.length
            },
            cancel() {},
            render(items, options) {
                renders.push({items, options})
            },
        })

        for (let index = 0; index < 100; index += 1) {
            queue.enqueue("turn-1", "agent-1", {forceBottom: index === 99})
        }
        queue.enqueue("turn-1", "reasoning-1")

        assert.equal(scheduled.length, 1)
        assert.equal(scheduled[0].delayMs, 64)
        assert.equal(renders.length, 0)

        scheduled[0].callback()

        assert.deepEqual(renders, [{
            items: [
                {turnId: "turn-1", itemId: "agent-1"},
                {turnId: "turn-1", itemId: "reasoning-1"},
            ],
            options: {forceBottom: true},
        }])
    })

    it("flushes pending work immediately without a later duplicate render", () => {
        const scheduled = []
        const cancelled = []
        const renders = []
        const queue = createStreamRenderQueue({
            schedule(callback) {
                scheduled.push(callback)
                return "timer-1"
            },
            cancel(timer) {
                cancelled.push(timer)
            },
            render(items) {
                renders.push(items)
            },
        })

        queue.enqueue("turn-1", "agent-1")
        queue.flushNow()
        scheduled[0]()

        assert.deepEqual(cancelled, ["timer-1"])
        assert.deepEqual(renders, [[{turnId: "turn-1", itemId: "agent-1"}]])
    })
})

