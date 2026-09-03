const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("keeps a deep-linked conversation closed during polling and presents its approval inside the open detail", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    const timers = new Map()
    let nextTimer = 0
    global.window = {setInterval: (callback) => {timers.set(++nextTimer, callback); return nextTimer}, clearInterval: (id) => timers.delete(id)}
    const session = {id: "session", runtime: {displayName: "Codex"}, transcript: []}
    const job = {id: "job", sessionId: "session", status: "waiting_approval"}
    global.fetch = async (_url, options) => {
        const {method, input} = JSON.parse(options.body)
        const value = method === "operators.summary" && input.cursor === undefined ? {sessions: [], jobs: [], approvals: [], totals: {sessions: 1}, nextCursor: "approval-page"}
            : method === "operators.summary" ? {sessions: [session], jobs: [job], approvals: [{id: "approval", jobId: "job", status: "pending", action: "optimization.release-install", risk: "Release and install candidate"}], totals: {sessions: 1}, nextCursor: null}
            : method === "operators.get" ? {session, parentJob: job, state: "waiting_approval"}
            : method === "skills.catalog" ? {skills: [], repositories: []}
            : method === "settings.get" ? {plugin: {}}
            : []
        return {ok: true, json: async () => ({ok: true, value})}
    }
    const {OperatorPanel} = loadView("OperatorPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(OperatorPanel, {t: (key) => key, initialSessionId: "session"}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const detail = () => view.root.findAllByProps({className: "rolling-skill-detail-stack"})
    assert.match(textOf(detail()[0]), /Release and install candidate/, "approval must not be hidden behind the open modal")
    assert.match(textOf(detail()[0]), /optimizationInstallImproved/u)
    assert.match(textOf(detail()[0]), /optimizationRestoreOriginal/u)
    await act(async () => view.root.findAllByType("button").find((node) => textOf(node) === "close").props.onClick())
    await act(async () => {for (const callback of [...timers.values()]) callback()})
    assert.equal(detail().length, 0, "background refresh must not reopen a conversation the user closed")
})

it("opens the started Operator conversation and lets the user read its result artifact", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {setInterval, clearInterval}
    const session = {id: "session", runtime: {displayName: "Codex"}, transcript: [
        {id: "setup", kind: "operator_session_configuration", diagnostic: "internal setup"},
        {id: "answer", kind: "message", role: "assistant", content: "## Result\n\nReview the report."},
    ]}
    const parentJob = {id: "job", sessionId: session.id, status: "succeeded"}
    const detail = {session, parentJob, state: "completed"}
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const value = method === "runtimes.list" ? [{runtimeId: "runtime", displayName: "Codex"}]
            : method === "skills.catalog" ? {skills: [], repositories: []}
            : method === "operators.summary" ? {sessions: [], jobs: [], approvals: [], totals: {sessions: 0}}
            : method === "runtimes.models" ? [{id: "model"}]
            : method === "settings.get" ? {plugin: {runtime: {runtimeId: "runtime"}}}
            : ["operators.start", "operators.get"].includes(method) ? detail
            : method === "operators.artifacts" ? [{id: "artifact", jobId: "job", name: "report.md", mediaType: "text/markdown"}]
            : method === "operators.artifact" ? {id: "artifact", preview: "# Saved report", mediaType: "text/markdown", truncated: false}
            : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {OperatorPanel} = loadView("OperatorPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(OperatorPanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const button = (label) => view.root.findAllByType("button").find((entry) => textOf(entry) === label)
    await act(async () => view.root.findAllByType("textarea").find((node) => node.props.placeholder === "operatorObjectivePlaceholder").props.onChange({target: {value: "Read-only review"}}))
    await act(async () => button("startOperator").props.onClick())
    assert.ok(view.root.findAllByType("h2").some((node) => textOf(node) === "Result"), "show rendered conversation immediately after starting")
    assert.ok(view.root.findAllByType("details").some((node) => textOf(node).includes("internal setup")), "keep runtime bookkeeping folded")
    await act(async () => button("details").props.onClick())
    assert.ok(view.root.findAllByType("h1").some((node) => textOf(node) === "Saved report"))
})

it("submits only user-selected resources, visible grants and edited budgets, without adding other catalog entries", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {setInterval, clearInterval}
    const writes = []
    const runtimes = [{runtimeId: "r1", displayName: "Codex"}, {runtimeId: "r2", displayName: "DSH"}]
    global.fetch = async (_url, options) => {
        const {method, input} = JSON.parse(options.body)
        if (method === "operators.start") writes.push(input)
        const value = method === "runtimes.list" ? runtimes
            : method === "datasets.list" ? [{id: "d1", name: "Selected", skillReference: {id: "s1"}}, {id: "d2", name: "Other", skillReference: {id: "s2"}}]
            : method === "skills.catalog" ? {skills: [{id: "s1", name: "Selected Skill", repositoryId: "repo1"}, {id: "s2", name: "Other Skill", repositoryId: "repo2"}], repositories: []}
            : method === "operators.summary" ? {sessions: [], jobs: [], approvals: [], totals: {sessions: 0}}
            : method === "runtimes.models" ? [{id: "model"}]
            : method === "settings.get" ? {plugin: {runtime: runtimes[0]}}
            : ["operators.start", "operators.get"].includes(method) ? {session: {id: "session", runtime: runtimes[0]}, parentJob: {id: "job", status: "succeeded"}}
            : []
        return {ok: true, json: async () => ({ok: true, value})}
    }
    const {OperatorPanel} = loadView("OperatorPanel.tsx")
    let view
    await act(async () => {view = create(React.createElement(OperatorPanel, {t: (key) => key}))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const select = (key) => view.root.findAllByType("label").find((node) => node.findAllByType("span").some((span) => textOf(span) === key)).findByType("select")
    await act(async () => select("operatorScopeSkill").props.onChange({target: {value: "s1"}}))
    await act(async () => select("operatorScopeDataset").props.onChange({target: {value: "d1"}}))
    const checkbox = (value) => view.root.findAllByType("input").find((node) => node.props.type === "checkbox" && node.props.value === value)
    assert.equal(checkbox("evaluations.execute").props.checked, false, "execution grants require an explicit selection")
    await act(async () => checkbox("r2").props.onChange({target: {checked: true}}))
    await act(async () => checkbox("evaluations.execute").props.onChange({target: {checked: true}}))
    await act(async () => view.root.findAllByType("input").find((node) => node.props.name === "maxRuntimeTurns").props.onChange({target: {value: "3"}}))
    await act(async () => view.root.findAllByType("textarea").find((node) => node.props.placeholder === "operatorObjectivePlaceholder").props.onChange({target: {value: "Read selected dataset"}}))
    await act(async () => view.root.findAllByType("button").find((node) => textOf(node) === "startOperator").props.onClick())
    assert.deepEqual(writes[0].scopes, {skillIds: ["s1"], datasetIds: ["d1"], repositoryIds: ["repo1"], runtimeIds: ["r2"]})
    assert.equal(writes[0].budget.maxRuntimeTurns, 3)
    assert.ok(writes[0].actions.includes("evaluations.execute"))
    assert.ok(!writes[0].actions.includes("skills.write"))
    assert.ok(!writes[0].actions.includes("approvals.resolve"))
})
