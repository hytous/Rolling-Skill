const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

const t = (key) => key
const fixture = (status = "needs_review") => ({
    id: "rubric-session", datasetId: "dataset", status, revision: "1",
    error: null, operationEvidence: null,
    rubricAgent: {runtimeId: "codex", modelId: "configured-model", effort: "high", effectiveModelId: "configured-model", effectiveEffort: "high", working: status === "running"},
    conversation: [{id: "message", role: "assistant", text: "Agent implementation transcript"}],
    revisions: [], draft: {title: "Incident response", summary: "Score the response", scoringModel: "unified-100/v1", criteria: []},
})

describe("Rubric user journey", () => {
    it("keeps the published version selected while another task is being polled", async () => {
        const {RubricPanel} = loadView("RubricPanel.tsx")
        const previousFetch = global.fetch
        const previousWindow = global.window
        const timers = new Map()
        let timerId = 0
        global.window = {setTimeout: (callback) => {timers.set(++timerId, callback); return timerId}, clearTimeout: (id) => timers.delete(id), addEventListener() {}, removeEventListener() {}}
        const version = {id: "published", version: 1, rubric: {title: "Published rubric", criteria: [], scoringModel: "unified-100/v1"}, createdAt: "2026-09-01T00:00:00Z"}
        global.fetch = async (_url, options) => {
            const {method} = JSON.parse(options.body)
            const value = method === "datasets.list" ? [{id: "dataset", name: "Dataset"}]
                : method === "settings.get" ? {rollingSkill: {rubricProfile: {modelId: "configured-model", effort: "high"}}, plugin: {runtime: {runtimeId: "codex"}}}
                : method === "rubrics.list" ? {sessions: [fixture("running")], versions: [version], active: version}
                : method === "runtimes.models" ? [] : fixture("running")
            return {ok: true, status: 200, json: async () => ({ok: true, value})}
        }
        let rendered
        try {
            await act(async () => {rendered = create(React.createElement(RubricPanel, {t, onNavigate() {}}))})
            const versionButton = () => rendered.root.findAllByType("button").find((button) => textOf(button).includes("v1 · Published rubric"))
            await act(async () => versionButton().props.onClick())
            assert.equal(versionButton().props["data-selected"], true)
            await act(async () => {const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) await callback()})
            assert.equal(versionButton().props["data-selected"], true, "background polling must not move the user's selection")
        } finally {
            if (rendered) await act(async () => rendered.unmount())
            global.fetch = previousFetch
            global.window = previousWindow
        }
    })
    it("keeps an unsent revision after request failure and prevents a second turn while running", async () => {
        const {RubricSessionView} = loadView("RubricSessionView.tsx")
        const previousFetch = global.fetch
        const previousWindow = global.window
        global.window = {setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}}
        let snapshot = fixture()
        let failSend = true
        global.fetch = async (_url, options) => {
            const {method} = JSON.parse(options.body)
            if (method === "runtimes.models") return {ok: true, status: 200, json: async () => ({ok: true, value: [{id: "configured-model", displayName: "Configured model", supportedReasoningEfforts: ["high", "max"]}]})}
            if (method === "rubrics.send" && failSend) return {ok: false, status: 500, json: async () => ({ok: false, error: {code: "REQUEST_FAILED", message: "Runtime disconnected"}})}
            if (method === "rubrics.send") snapshot = fixture("running")
            return {ok: true, status: 200, json: async () => ({ok: true, value: snapshot})}
        }
        let rendered
        try {
            await act(async () => { rendered = create(React.createElement(RubricSessionView, {sessionId: snapshot.id, t, onChanged() {}})) })
            assert.ok(rendered.root.findAllByType("details").some((node) => textOf(node).includes("Agent implementation transcript")), "technical transcript must be folded, not placed before the rubric")
            assert.ok(rendered.root.findAllByType("option").some((node) => node.props.value === "configured-model"), "model selection must use the selected Runtime catalog and retain the configured value")
            const textarea = () => rendered.root.findByType("textarea")
            const send = () => rendered.root.findAllByType("button").find((button) => textOf(button) === "sendRevision")
            await act(async () => textarea().props.onChange({target: {value: "Keep the recovery verification criterion"}}))
            await act(async () => { await send().props.onClick() })
            assert.equal(textarea().props.value, "Keep the recovery verification criterion", "failed send must not erase user instructions")
            failSend = false
            await act(async () => { await send().props.onClick() })
            assert.equal(textarea().props.value, "")
            await act(async () => textarea().props.onChange({target: {value: "Next revision"}}))
            assert.equal(send().props.disabled, true, "active generation cannot accept duplicate turns")
            assert.ok(rendered.root.findAll((node) => node.props.role === "status").length > 0)
        } finally {
            if (rendered) await act(async () => rendered.unmount())
            global.fetch = previousFetch
            global.window = previousWindow
        }
    })

    it("does not overwrite a configured effort while its model catalog is loading", async () => {
        const {ModelEffortSelect} = loadView("ModelEffortSelect.tsx")
        const changed = []
        let rendered
        await act(async () => {
            rendered = create(React.createElement(ModelEffortSelect, {
                label: "Effort", runtimeDefaultLabel: "Configured default", models: [],
                modelId: "configured-model", value: "high", onChange: (value) => changed.push(value),
            }))
        })
        try {
            assert.deepEqual(changed, [], "loading or unavailable catalogs must not mutate user settings")
            assert.ok(rendered.root.findAllByType("option").some((option) => option.props.value === "high"))
        } finally {
            await act(async () => rendered.unmount())
        }
    })
})
