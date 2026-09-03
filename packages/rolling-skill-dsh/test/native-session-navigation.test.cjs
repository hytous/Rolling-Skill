const assert = require("node:assert/strict")
const {it} = require("node:test")
const {loadView} = require("./tsx-harness.cjs")

it("waits for DSH's real list feed before opening the dispatched session", async (t) => {
    const previous = global.window
    global.window = {setTimeout, clearTimeout}
    t.after(() => {global.window = previous})
    const {registerNativeSessionNavigation, openNativeSession} = loadView("native-session-navigation.ts")
    const listeners = new Set()
    const ids = []
    const opened = []
    const dispose = registerNativeSessionNavigation({open: (id) => opened.push(id), list: {getSnapshot: () => ({ids}), subscribe: (f) => {listeners.add(f); return () => listeners.delete(f)}}})
    t.after(dispose)
    const opening = openNativeSession("native-1")
    assert.deepEqual(opened, [])
    ids.push("native-1")
    for (const f of [...listeners]) f()
    await opening
    assert.deepEqual(opened, ["native-1"])
    assert.equal(listeners.size, 0)
})
