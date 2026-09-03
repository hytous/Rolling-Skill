const assert = require("node:assert/strict")
const {it} = require("node:test")
const {createConversationMarkerSource} = require("../src/client/conversation/marker-source.cjs")

it("shares one request and timer for all messages, updates background saves and retains markers while offline", async () => {
    let loads = 0
    let offline = false
    let records = []
    const timers = new Set()
    const source = createConversationMarkerSource({
        load: async () => {loads += 1; if (offline) throw new Error("offline"); return records},
        schedule: (callback) => {timers.add(callback); return callback},
        cancel: (timer) => timers.delete(timer),
    })
    const first = source.subscribe("native", () => {})
    const second = source.subscribe("native", () => {})
    await new Promise(setImmediate)
    assert.equal(loads, 1)
    assert.equal(timers.size, 1)
    records = [{endMessageId: "answer", status: "saved", caseId: "automatic-case"}]
    const tick = async () => {const timer = [...timers][0]; timers.delete(timer); timer(); await new Promise(setImmediate)}
    await tick()
    assert.equal(source.getSnapshot("native").markers[0].status, "saved")
    offline = true
    await tick()
    assert.equal(source.getSnapshot("native").markers[0].status, "saved")
    first()
    assert.equal(timers.size, 1)
    second()
    assert.equal(timers.size, 0)
})
