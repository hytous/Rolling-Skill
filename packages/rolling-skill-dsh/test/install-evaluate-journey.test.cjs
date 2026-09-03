const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

async function fixture(test, file, props = {}, state = {}) {
    const previous = {fetch: global.fetch, window: global.window}
    const timers = new Map()
    let timerId = 0
    global.window = {setInterval: (f) => {timers.set(++timerId, f); return timerId}, clearInterval: (id) => timers.delete(id), setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {}}
    const calls = []
    const skill = {id: "skill", repositoryId: "repo", name: "Incident response", evidencePrecision: "managed"}
    const versions = ["v2", "v1"].map((id) => ({id, skillId: skill.id, state: "released", versionLabel: id}))
    global.fetch = async (_url, options) => {
        const {method, input} = JSON.parse(options.body)
        calls.push({method, input})
        const value = method === "skills.catalog" ? {skills: [skill], repositories: []}
            : method === "skills.get" ? {skill, versions}
            : method === "skills.versions" ? {versions, nextCursor: null}
            : ["runtimes.list", "installations.targets"].includes(method) ? [{runtimeId: "runtime", displayName: "Runtime"}, {runtimeId: "dsh", displayName: "DSH"}]
            : method === "installations.list" ? {jobs: [], matrix: [{runtimeId: "runtime", versionId: "v2", verification: "runtime-inventory"}]}
            : method === "installations.start" ? [{id: "new-install", status: "running", request: {source: {skillId: "skill"}}}]
            : method === "installations.get" ? {id: input.jobId, status: "running", runtime: {displayName: "Runtime"}, request: {skillName: "Incident response", versionLabel: "v1", source: {skillId: "skill"}}, messages: []}
            : method === "datasets.list" ? [{id: "dataset", name: "Dataset", caseCount: 201, skillReference: skill}]
            : method === "settings.get" ? {plugin: {runtime: {runtimeId: "runtime"}}, rollingSkill: {judgeProfile: {modelId: "model", effort: "high"}}}
            : method === "runtimes.models" ? [{
                id: input.runtimeId === "dsh" ? "glm" : "model",
                reasoningEfforts: ["low", "high"],
            }]
            : method === "evaluations.start" ? {id: "run"}
            : method === "evaluations.list" ? state.started ? [{id: "run", status: state.status ?? "running", results: []}] : []
            : method === "evaluations.get" ? {id: "run", status: state.status ?? "running", results: [{id: "result", status: state.status ?? "running", response: "## Response preview\n\nReadable **answer**.", ...state.result}]}
            : method === "cases.list" ? {items: Array.from({length: input.page === 2 ? 1 : 200}, (_, index) => ({id: `case-${input.page === 2 ? 200 : index}`})), pageCount: 2, total: 201}
            : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const Component = Object.values(loadView(file))[0]
    let view
    await act(async () => {view = create(React.createElement(Component, {t: (key) => key, ...props}))})
    test.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const button = (label) => view.root.findAllByType("button").find((node) => textOf(node) === label)
    const select = (label) => view.root.findAllByType("select").find((node) => node.props["aria-label"] === label)
    return {view, calls, button, select, poll: () => act(async () => {for (const f of [...timers.values()]) f()})}
}

it("installs the release the user selected, not always the newest release", async (t) => {
    const page = await fixture(t, "SkillsPanel.tsx", {mode: "install"})
    assert.ok(page.select("publishedVersions"), "installation must offer a release choice")
    await act(async () => page.select("publishedVersions").props.onChange({target: {value: "v1"}}))
    await act(async () => page.button("installReleased").props.onClick())
    assert.equal(page.calls.find((call) => call.method === "installations.start").input.versionId, "v1")
    assert.equal(page.select("publishedVersions").props.value, "v1", "list refresh must preserve the selected release")
    assert.ok(page.button("close"), "a started installation must open its real task, not silently reset the submit button")
    assert.ok(page.calls.some((call) => call.method === "installations.get" && call.input.jobId === "new-install"))
})

it("lets the user choose the model and effort for every selected installation Runtime", async (t) => {
    const page = await fixture(t, "SkillsPanel.tsx", {mode: "install"})
    const runtimeCheckbox = page.view.root.findAllByType("input").find((node) => node.props.type === "checkbox" && textOf(node.parent).includes("Runtime"))
    assert.equal(runtimeCheckbox.props.checked, false, "installation targets must require an explicit user choice")
    assert.equal(page.button("installReleased").props.disabled, true, "installation must stay disabled until a target is selected")
    await act(async () => runtimeCheckbox.props.onChange({target: {checked: true}}))
    const target = page.view.root.findAll((node) => node.props["aria-label"] === "Runtime")[0]
    assert.ok(target, "the selected Runtime must expose its own installation profile")
    const selects = target.findAllByType("select")
    assert.equal(selects.length, 2)
    await act(async () => selects[0].props.onChange({target: {value: "model"}}))
    await act(async () => target.findAllByType("select")[1].props.onChange({target: {value: "high"}}))
    await act(async () => page.button("installReleased").props.onClick())

    const input = page.calls.find((call) => call.method === "installations.start").input
    assert.deepEqual(input.targets, [{
        runtimeId: "runtime",
        modelId: "model",
        effort: "high",
        permissionMode: null,
    }])
})

it("keeps each target model independent and never silently replaces configured Judge choices", async (t) => {
    const page = await fixture(t, "EvaluationsPanel.tsx")
    const selectByLabel = (label) => page.view.root.findAllByType("label").find((node) => node.findAllByType("span").some((span) => textOf(span) === label)).findByType("select")
    await act(async () => selectByLabel("model").props.onChange({target: {value: "model"}}))
    const dsh = page.view.root.findAllByType("input").find((node) => node.props.type === "checkbox" && textOf(node.parent).includes("DSH"))
    await act(async () => dsh.props.onChange({target: {checked: true}}))
    await act(async () => page.button("makePrimaryRuntime").props.onClick({preventDefault() {}, stopPropagation() {}}))
    assert.equal(selectByLabel("model").props.value, "", "a different Runtime must not receive the prior Runtime's model id")
    assert.ok(selectByLabel("model").findAllByType("option").some((option) => option.props.value === ""), "Runtime default must be visible, not a misleading first model")
    await act(async () => selectByLabel("model").props.onChange({target: {value: "glm"}}))
    await act(async () => page.button("makePrimaryRuntime").props.onClick({preventDefault() {}, stopPropagation() {}}))
    assert.equal(selectByLabel("model").props.value, "model")
    const judgeEffort = page.view.root.findAllByType("select").at(-1)
    await act(async () => judgeEffort.props.onChange({target: {value: ""}}))
    await act(async () => page.button("refresh").props.onClick())
    assert.equal(page.view.root.findAllByType("select").at(-1).props.value, "", "refresh must not restore saved high after the user explicitly chose Runtime default")
})

it("opens a started evaluation and updates its detail until completion without reopening closed details", async (t) => {
    const state = {started: false, status: "running"}
    const page = await fixture(t, "EvaluationsPanel.tsx", {}, state)
    state.started = true
    await act(async () => page.button("startEvaluation").props.onClick())
    assert.ok(page.button("close"), "start must open the run detail")
    assert.ok(page.view.root.findAllByType("h2").some((node) => textOf(node) === "Response preview"), "the actual response must render as Markdown")
    state.status = "completed"
    await page.poll()
    assert.ok(page.view.root.findAllByType("span").some((node) => textOf(node) === "statusCompleted"), "open detail must reach its terminal status automatically")
    await act(async () => page.button("close").props.onClick())
    await act(async () => page.button("refresh").props.onClick())
    assert.equal(page.button("close"), undefined)
})

it("leads with results and keeps long grading standards readable on demand", async (t) => {
    const page = await fixture(t, "EvaluationsPanel.tsx", {initialRunId: "run"}, {
        status: "completed",
        result: {
            computedScore: {totalScore: 90, outcomeTier: "formal_pass", criterionScores: [{id: "R1", points: 9, maxPoints: 10}]},
            scoreContract: {criteria: [{id: "R1", title: "Correct classification", criterion: "Complete original criterion with applicability and anchors"}]},
            judgment: {assessments: [{criterionId: "R1", rationale: "Supported by the Case", verificationStatus: "verified"}]},
        },
    })
    const detailsFor = (label) => page.view.root.findAllByType("details").find((node) => node.findAllByType("summary").some((summary) => textOf(summary) === label))
    assert.equal(Boolean(detailsFor("scoreBreakdown").props.open), false)
    assert.ok(detailsFor("evaluationCriterionDetails"))
    assert.match(textOf(detailsFor("evaluationCriterionDetails")), /Complete original criterion/u)
    assert.ok(page.view.root.findAllByType("span").some((node) => textOf(node) === "evaluationFormalPass"))
})

it("evaluates all matching Good Cases across pages, including case 201", async (t) => {
    const page = await fixture(t, "EvaluationsPanel.tsx")
    const scope = page.view.root.findAllByType("select").find((node) => node.findAllByType("option").some((option) => option.props.value === "goodcase"))
    await act(async () => scope.props.onChange({target: {value: "goodcase"}}))
    const start = page.button("startEvaluation")
    assert.ok(start)
    assert.equal(start.props.disabled, false)
    await act(async () => start.props.onClick())
    const input = page.calls.find((call) => call.method === "evaluations.start").input
    assert.equal(input.caseIds.length, 201)
    assert.ok(input.caseIds.includes("case-200"))
    assert.equal(input.selectionMode, "selected")
})
