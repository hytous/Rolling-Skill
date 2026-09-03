const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("does not expose default values or a save action before the saved settings have loaded", async (t) => {
    const previous = global.fetch
    const previousWindow = global.window
    global.window = {setTimeout, clearTimeout}
    global.fetch = () => new Promise(() => {})
    const {AutomaticCapturePanel} = loadView("AutomaticCapturePanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(AutomaticCapturePanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); global.fetch = previous; global.window = previousWindow})
    assert.equal(view.root.findAllByType("select").length, 0)
    assert.equal(view.root.findAllByType("button").some((button) => textOf(button) === "saveAutomatic"), false)
    assert.match(textOf(view.root), /loading/u)
})

it("saves the visible source/detector selections without losing the saved model when its catalog is unavailable", async (t) => {
    const previous = global.fetch
    const previousWindow = global.window
    global.window = {setTimeout, clearTimeout}
    const writes = []
    const runtimes = [{runtimeId: "source", displayName: "DSH", version: "1"}, {runtimeId: "detector", displayName: "Codex", version: "1"}]
    const status = {mode: "scheduled", executionLocation: "while-harness-running", schedule: {cadence: "daily", time: "20:00", weekday: 1},
        runtime: runtimes[1], sourceRuntime: runtimes[0], curatorRuntime: runtimes[1], modelId: "saved-model", effort: "max", targets: [], worker: {}, scheduler: {}}
    global.fetch = async (_url, options) => {
        const {method, input} = JSON.parse(options.body)
        if (method === "runtimes.models") throw new Error("Model catalog temporarily unavailable")
        if (method === "automatic.update") writes.push(input)
        const value = method === "runtimes.list" ? runtimes : method === "datasets.list" ? []
            : method === "skills.catalog" ? {skills: []}
            : method === "settings.get" ? {rollingSkill: {curatorProfile: {modelId: "curator-model", effort: "high"}}} : status
        return {ok: true, json: async () => ({ok: true, value})}
    }
    const {AutomaticCapturePanel} = loadView("AutomaticCapturePanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(AutomaticCapturePanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); global.fetch = previous; global.window = previousWindow})
    await act(async () => view.root.findAllByType("button").find((button) => textOf(button) === "saveAutomatic").props.onClick())
    assert.equal(writes[0].modelId, "saved-model")
    assert.equal(writes[0].effort, "max")
    assert.equal(writes[0].sourceRuntimeId, "source")
    assert.equal(writes[0].runtimeId, "detector")
})
