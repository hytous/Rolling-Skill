const assert = require("node:assert/strict")
const {it} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

it("adds to the filtered Skill, preserves multiline notes and makes the saved Raw Case visible", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {addEventListener() {}, removeEventListener() {}}
    const skills = ["one", "two"].map((id) => ({id, repositoryId: id, name: id, status: "valid"}))
    const entries = []
    const calls = []
    global.fetch = async (_url, options) => {
        const {method, input} = JSON.parse(options.body)
        calls.push({method, input})
        if (method === "rawCases.add") entries.push({id: "raw", question: input.question, note: input.note, skill: skills.find((skill) => skill.id === input.skillId)})
        const value = method === "skills.catalog" ? {skills, repositories: skills.map((skill) => ({id: skill.id, displayName: skill.name}))}
            : method === "rawCases.list" ? [...entries] : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {RawCasesPanel} = loadView("RawCasesPanel.tsx")
    const Wrapper = () => {const [revision, setRevision] = React.useState(0); return React.createElement(RawCasesPanel, {t: (key) => key, revision, onChanged: () => setRevision((r) => r + 1), onNavigate() {}})}
    let view
    await act(async () => {view = create(React.createElement(Wrapper))})
    t.after(() => {act(() => view.unmount()); Object.assign(global, previous)})
    const button = (label) => view.root.findAllByType("button").find((node) => textOf(node) === label)
    const filter = () => view.root.findAllByType("select").find((node) => node.props["aria-label"] === "rawCaseSkillFilter")
    await act(async () => filter().props.onChange({target: {value: "two"}}))
    await act(async () => button("addRawCase").props.onClick())
    const field = (label) => view.root.findAllByType("label").find((node) => node.findAllByType("span").some((span) => textOf(span) === label))
    assert.equal(field("datasetSkill").findByType("select").props.value, "two")
    assert.equal(textOf(field("datasetSkill").findAllByType("option")[1]), "two", "do not repeat an identical repository and Skill name")
    await act(async () => field("question").findByType("textarea").props.onChange({target: {value: "New incident question"}}))
    await act(async () => field("note").findByType("textarea").props.onChange({target: {value: "First line\nSecond line"}}))
    await act(async () => field("datasetSkill").findByType("select").props.onChange({target: {value: "one"}}))
    await act(async () => button("save").props.onClick())
    assert.equal(calls.find((call) => call.method === "rawCases.add").input.note, "First line\nSecond line")
    assert.equal(filter().props.value, "one")
    assert.match(textOf(view.root), /New incident question/)
})
