const assert = require("node:assert/strict")
const {test} = require("node:test")
const React = require("react")
const {act, create} = require("react-test-renderer")
const {loadView, textOf} = require("./tsx-harness.cjs")

test("version cards show persisted change summaries and keep legacy releases usable", async (t) => {
    const previous = {window: global.window, fetch: global.fetch}
    global.window = {setInterval: () => 1, clearInterval: () => {}}
    const skill = {id: "billing", repositoryId: "repo", name: "billing", status: "valid"}
    const versions = [
        {id: "v2", skillId: skill.id, state: "released", versionLabel: "v2", changeSummary: "先过滤账单，再按需下钻。"},
        {id: "v1", skillId: skill.id, state: "released", versionLabel: "v1"},
    ]
    global.fetch = async (_url, options) => {
        const {method} = JSON.parse(options.body)
        const value = method === "skills.catalog" ? {repositories: [{id: "repo", displayName: "Repo"}], skills: [skill]}
            : method === "skills.get" ? {skill, manifest: "billing", versions}
            : method === "skills.path" ? {skillId: skill.id, path: "/managed/billing"}
            : method === "skillEdits.list" ? {sessions: []} : []
        return {ok: true, status: 200, json: async () => ({ok: true, value})}
    }
    const {SkillsPanel} = loadView("SkillsPanel.tsx")
    let view
    t.after(() => {if (view) act(() => view.unmount()); Object.assign(global, previous)})
    await act(async () => {view = create(React.createElement(SkillsPanel, {t: (key) => key, mode: "versions"}))})
    const cards = view.root.findAllByType("article")
    assert.equal(cards.length, 2)
    assert.match(textOf(cards[0]), /v2.*先过滤账单，再按需下钻。/u)
    assert.match(textOf(cards[1]), /v1/u)
    assert.doesNotMatch(textOf(cards[1]), /undefined|null/u)
})
