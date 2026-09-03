const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("keeps Case replay feedback visible and opens the resulting Draft instead of silently resetting the button", async (t) => {
    const previous = global.fetch
    let finish
    const routes = []
    const entry = {id: "case", caseType: "goodcase", question: "Offline note", answer: "Old answer", updatedAt: "yesterday"}
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const value = method === "datasets.list" ? [{id: "dataset", name: "Dataset"}]
            : method === "runtimes.list" ? [{runtimeId: "dsh", displayName: "DSH"}]
            : method === "cases.list" ? {items: [entry], total: 1, page: 1, pageCount: 1}
            : method === "cases.refresh" ? await new Promise((resolve) => {finish = resolve}) : null
        return {ok: true, json: async () => ({ok: true, value})}
    }
    const {CasesPanel} = loadView("CasesPanel.tsx")
    let view, action
    await act(async () => {view = create(React.createElement(CasesPanel, {t: (key) => key, revision: 0, onChanged() {}, onNavigate(route) {routes.push(route)}}))})
    t.after(() => {act(() => view.unmount()); global.fetch = previous})
    const button = view.root.findAllByType("button").find((node) => textOf(node) === "refreshCase")
    await act(async () => {action = button.props.onClick(); await Promise.resolve()})
    assert.match(textOf(view.root), /caseRefreshRunning/)
    await act(async () => {finish({id: "refresh-draft", status: "queued"}); await action; await new Promise((resolve) => setImmediate(resolve))})
    assert.deepEqual(routes, [{page: "curation", sessionId: "refresh-draft"}])
})

it("keeps saved Case lists concise and opens structured content with the persisted source and installation", async (t) => {
    const previous = global.fetch
    const entry = {id: "case", caseType: "goodcase", question: "Internal delay", answer: "## Reference answer\nP1\n## Evidence\nVerbose legacy export", curated: {referenceAnswer: {summary: "P1", requiredFacts: ["No customer impact"]}}, source: {sessionId: "native-session", startSeq: 7, endSeq: 564, originalAssistantMessages: [{content: "Original offline answer"}]}, rubricVersionId: "rubric-1", evidence: {operationEvidence: {skillName: "incident-response-planner", versionLabel: "1.0.0", installation: {jobId: "install-1"}}}}
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const value = method === "datasets.list" ? [{id: "dataset", name: "Dataset"}]
            : method === "runtimes.list" ? [] : method === "cases.list" ? {items: [entry], total: 1, page: 1, pageCount: 1}
            : entry
        return {ok: true, json: async () => ({ok: true, value})}
    }
    const {CasesPanel} = loadView("CasesPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(CasesPanel, {t: (key) => key, revision: 0, onChanged() {}, onNavigate() {}}))})
    t.after(() => {act(() => view.unmount()); global.fetch = previous})
    assert.doesNotMatch(textOf(view.root), /Verbose legacy export/)
    const details = view.root.findAllByType("button").find((node) => textOf(node) === "details")
    await act(async () => details.props.onClick())
    const content = textOf(view.root)
    assert.match(content, /No customer impact/)
    assert.match(content, /Original offline answer/)
    assert.match(content, /native-session/)
    assert.match(content, /7.*564/)
    assert.match(content, /install-1/)
    assert.doesNotMatch(content, /"source": null/)
})
