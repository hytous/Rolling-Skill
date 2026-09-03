const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("keeps visible data and user filters when refresh fails, then reconnects without a page reload", async (t) => {
    const previous = {fetch: global.fetch, window: global.window}
    const timers = new Map()
    let nextTimer = 0
    global.window = {setInterval: (f) => {timers.set(++nextTimer, f); return nextTimer}, clearInterval: (id) => timers.delete(id), addEventListener() {}, removeEventListener() {}}
    let connected = true
    let dataBusy = false
    global.fetch = async (_url, options) => {
        if (!connected) throw new TypeError("Failed to fetch")
        const {method} = JSON.parse(options.body)
        if (dataBusy) return {ok: false, status: 503, json: async () => ({ok: false, error: {code: "DATA_BUSY", message: "Worker owns data"}})}
        const value = method === "dashboard.get" ? {}
            : method === "rawCases.list" ? [{id: "raw", question: "Retained incident", note: "", skill: {id: "skill", name: "Skill"}}]
            : method === "skills.catalog" ? {skills: [{id: "skill", name: "Skill", repositoryId: "repo", status: "valid"}], repositories: []} : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {Workbench} = loadView("Workbench.tsx")
    let view
    await act(async () => {view = create(React.createElement(Workbench, {t: (key) => key, initialRoute: {page: "raw-cases"}, locale: {subscribe: () => () => {}, getSnapshot: () => ({revision: 0})}}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const button = (key) => view.root.findAllByType("button").find((node) => textOf(node) === key)
    const search = () => view.root.findByProps({"aria-label": "searchRawCases"})
    await act(async () => search().props.onChange({target: {value: "Retained"}}))
    connected = false
    await act(async () => button("refresh").props.onClick())
    assert.match(textOf(view.root), /Retained incident/)
    assert.equal(search().props.value, "Retained")
    assert.match(textOf(view.root), /connectionUnavailable/)
    connected = true
    await act(async () => button("reconnect").props.onClick())
    assert.doesNotMatch(textOf(view.root), /connectionUnavailable/)
    assert.match(textOf(view.root), /Retained incident/)
    connected = false
    await act(async () => {for (const f of [...timers.values()]) f()})
    assert.match(textOf(view.root), /connectionUnavailable/, "idle pages also detect disconnection")
    await act(async () => view.unmount())
    await act(async () => {view = create(React.createElement(Workbench, {t: (key) => key, initialRoute: {page: "raw-cases"}, locale: {subscribe: () => () => {}, getSnapshot: () => ({revision: 0})}}))})
    assert.match(textOf(view.root), /connectionUnavailable/)
    connected = true
    await act(async () => {for (const f of [...timers.values()]) f()})
    assert.match(textOf(view.root), /Retained incident/, "an initial offline load recovers when the health probe succeeds")
    await act(async () => view.unmount())
    dataBusy = true
    await act(async () => {view = create(React.createElement(Workbench, {t: (key) => key, initialRoute: {page: "raw-cases"}, locale: {subscribe: () => () => {}, getSnapshot: () => ({revision: 0})}}))})
    assert.match(textOf(view.root), /Worker owns data/)
    dataBusy = false
    await act(async () => {for (const f of [...timers.values()]) f()})
    assert.match(textOf(view.root), /Retained incident/, "the initial busy-owner page also recovers without a reconnect event or manual retry")
})
