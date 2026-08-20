const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {RuntimeNotificationRouter} = require("../src/runtime-notification-router.cjs")

function notification(method, threadId = "thread-a", extra = {}) {
    return {method, params: {threadId, ...extra}}
}

describe("runtime notification router", () => {
    it("forwards only the visible timeline while retaining low-frequency background summaries", () => {
        const router = new RuntimeNotificationRouter()
        const epoch = router.beginObservation("thread-a")
        router.snapshotReady(epoch)
        assert.equal(router.drain(epoch).live, true)

        assert.equal(router.route(notification("item/agentMessage/delta", "thread-a")).forward, true)
        assert.equal(router.route(notification("item/agentMessage/delta", "thread-b")).forward, false)
        assert.equal(router.route(notification("thread/status/changed", "thread-b")).forward, true)
        assert.equal(router.route(notification("thread/tokenUsage/updated", "thread-a")).forward, false)
        assert.equal(router.route({method: "account/rateLimits/updated", params: {}}).forward, false)
    })

    it("discards pre-snapshot activity and drains post-snapshot catch-up before going live", () => {
        const router = new RuntimeNotificationRouter()
        const epoch = router.beginObservation("thread-a")
        router.route(notification("item/agentMessage/delta", "thread-a", {delta: "covered"}))
        router.snapshotReady(epoch)
        router.route(notification("item/agentMessage/delta", "thread-a", {delta: "catch-up"}))

        const catchUp = router.drain(epoch)
        assert.equal(catchUp.live, false)
        assert.deepEqual(catchUp.notifications.map((entry) => entry.params.delta), ["catch-up"])
        assert.deepEqual(router.drain(epoch), {matched: true, live: true, notifications: []})
        assert.equal(router.route(notification("item/agentMessage/delta", "thread-a")).forward, true)
    })

    it("rejects stale epochs and requests a new snapshot after a bounded buffer overflows", () => {
        const router = new RuntimeNotificationRouter({maxBufferedNotifications: 2})
        const oldEpoch = router.beginObservation("thread-a")
        router.snapshotReady(oldEpoch)
        const currentEpoch = router.beginObservation("thread-b")
        assert.deepEqual(router.drain(oldEpoch), {matched: false, live: false, notifications: []})
        router.snapshotReady(currentEpoch)
        for (let index = 0; index < 3; index += 1) {
            router.route(notification("item/agentMessage/delta", "thread-b", {delta: String(index)}))
        }

        const overflow = router.drain(currentEpoch)
        assert.equal(overflow.reloadRequired, true)
        assert.deepEqual(overflow.notifications, [])
    })
})
