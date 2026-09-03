const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("shows installation evidence only for the selected Skill, including after switching", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {setInterval: () => 1, clearInterval: () => {}}
    const overview = {
        jobs: ["one", "two"].map((id) => ({id: `job-${id}`, status: "succeeded", runtime: {displayName: "DSH"}, request: {skillName: `Skill ${id}`, source: {skillId: id}}})),
        matrix: ["one", "two"].map((id) => ({skillId: id, runtimeId: "dsh", displayName: "DSH", versionId: `version-${id}`})),
    }
    global.fetch = async (_url, options) => ({ok: true, status: 200, json: async () => ({ok: true, value: JSON.parse(options.body).method === "installations.list" ? overview : []})})
    const {InstallationsPanel} = loadView("InstallationsPanel.tsx")
    let view
    await act(async () => { view = create(React.createElement(InstallationsPanel, {t: (key) => key, skillId: "one"})) })
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    assert.match(textOf(view.root), /Skill one/u)
    assert.match(textOf(view.root), /version-one/u)
    assert.doesNotMatch(textOf(view.root), /Skill two|version-two/u)
    await act(async () => { view.update(React.createElement(InstallationsPanel, {t: (key) => key, skillId: "two"})) })
    assert.match(textOf(view.root), /Skill two/u)
    assert.doesNotMatch(textOf(view.root), /Skill one|version-one/u)
})

it("keeps the open installation detail current through running, confirmation and terminal result", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    const timers = new Map()
    let timerId = 0
    global.window = {setInterval: (f) => {timers.set(++timerId, f); return timerId}, clearInterval: (id) => timers.delete(id)}
    let status = "running"
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const job = {id: "job", runtime: {displayName: "Runtime"}, request: {skillName: "Skill", versionLabel: "v1"}, operation: "experiment_inspect", status, canFollowUp: true,
            activities: [{type: "commandExecution", status: "completed", command: "git show frozen:SKILL.md", recordedAt: "2026-09-01T11:34:00Z"}]}
        const value = method === "installations.get" ? job
            : method === "installations.list" ? {jobs: [job], matrix: []}
            : method === "interactions.list" && status === "awaiting_confirmation" ? [{id: "ask", kind: "question", jobId: "job", questions: [{id: "question", prompt: "Confirm this exact target?"}]}]
            : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {InstallationsPanel} = loadView("InstallationsPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(InstallationsPanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    assert.match(textOf(view.root.findAllByType("article")[0]), /installationExperimentInspect/u,
        "the list must distinguish read-only checks, trial installation, and restoration before opening details")
    await act(async () => view.root.findAllByType("button").find((node) => textOf(node) === "details").props.onClick())
    const poll = () => act(async () => {for (const f of [...timers.values()]) f()})
    const dialog = () => view.root.findByType(InstallationsPanel).findAllByType("section").find((node) => node.findAllByType("h4").some((h) => textOf(h) === "installationSource") && !node.props.className)
    assert.match(textOf(dialog()), /git show frozen:SKILL.md/u)
    assert.match(textOf(dialog()), /installationCommandActivity/u)
    assert.match(textOf(dialog()), /installationExperimentInspect/u)
    status = "awaiting_confirmation"
    await poll()
    assert.match(textOf(dialog()), /statusAwaitingConfirmation/)
    assert.match(textOf(dialog()), /Confirm this exact target\?/)
    status = "succeeded"
    await poll()
    assert.match(textOf(dialog()), /statusSucceeded/)
    assert.doesNotMatch(textOf(dialog()), /statusAwaitingConfirmation/)
})

it("explains that an active installer is still working before its first visible activity", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {setInterval: () => 1, clearInterval: () => {}}
    const job = {
        id: "job",
        runtime: {displayName: "Runtime"},
        request: {skillName: "Skill", versionLabel: "v1"},
        operation: "install",
        status: "running",
        messages: [{role: "user", content: "Install Skill"}],
        activities: [],
    }
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const value = method === "installations.get" ? job
            : method === "installations.list" ? {jobs: [job], matrix: []}
            : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {InstallationsPanel} = loadView("InstallationsPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(InstallationsPanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})

    await act(async () => view.root.findAllByType("button").find((node) => textOf(node) === "details").props.onClick())
    assert.match(textOf(view.root), /installationWaitingForActivity/u)
})
