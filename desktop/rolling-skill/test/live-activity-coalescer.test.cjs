const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {LiveActivityCoalescer} = require("../src/live-activity-coalescer.cjs")

function harness() {
    const emitted = []
    const scheduled = []
    const cancelled = []
    const coalescer = new LiveActivityCoalescer({
        intervalMs: 250,
        emit: (activity) => emitted.push(activity),
        schedule(callback, delayMs) {
            const timer = {callback, delayMs, id: scheduled.length + 1}
            scheduled.push(timer)
            return timer
        },
        cancel(timer) {
            cancelled.push(timer.id)
        },
    })
    return {coalescer, emitted, scheduled, cancelled}
}

describe("live activity coalescer", () => {
    it("emits one leading and one trailing update for a burst of identical activity", () => {
        const {coalescer, emitted, scheduled} = harness()
        coalescer.publish({
            sessionId: "session-1",
            stage: "analyzing",
            summary: "",
            lastActivityAt: 1,
            terminal: false,
        })
        for (let index = 2; index <= 101; index += 1) {
            coalescer.publish({
                sessionId: "session-1",
                stage: "analyzing",
                summary: "",
                lastActivityAt: index,
                terminal: false,
            })
        }

        assert.equal(emitted.length, 1)
        assert.equal(scheduled.length, 1)
        assert.equal(scheduled[0].delayMs, 250)

        scheduled[0].callback()

        assert.equal(emitted.length, 2)
        assert.equal(emitted[1].lastActivityAt, 101)
    })

    it("emits visible changes and terminal activity immediately while invalidating old timers", () => {
        const {coalescer, emitted, scheduled, cancelled} = harness()
        coalescer.publish({sessionId: "session-1", stage: "analyzing", summary: "", terminal: false})
        coalescer.publish({sessionId: "session-1", stage: "analyzing", summary: "", terminal: false})
        coalescer.publish({sessionId: "session-1", stage: "command", summary: "pwd", terminal: false})

        assert.deepEqual(emitted.map((entry) => entry.stage), ["analyzing", "command"])
        assert.deepEqual(cancelled, [1])
        scheduled[0].callback()
        assert.equal(emitted.length, 2)

        coalescer.publish({sessionId: "session-1", stage: "command", summary: "pwd", terminal: false})
        coalescer.publish({sessionId: "session-1", stage: "completed", summary: "", terminal: true})
        scheduled[1].callback()

        assert.deepEqual(cancelled, [1, 2])
        assert.deepEqual(emitted.map((entry) => entry.stage), ["analyzing", "command", "completed"])
        assert.equal(emitted.at(-1).terminal, true)
    })
})

