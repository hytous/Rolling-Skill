const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    rawCaseSkillGroups,
    rawCaseSkillOptions,
    resolveRawCaseSkillScope,
} = require("../src/client/workbench/raw-case-skill-filter.cjs")
const {
    visibleCurationSelection,
} = require("../src/client/workbench/curation-selection.cjs")

describe("Rolling Skill workbench selection", () => {
    const entries = [
        {id: "a-1", question: "Alpha outage", note: "first", skill: {id: "skill-a", name: "Alpha"}},
        {id: "a-2", question: "Alpha latency", note: "second", skill: {id: "skill-a", name: "Alpha"}},
        {id: "b-1", question: "Beta billing", note: "third", skill: {id: "skill-b", name: "Beta"}},
        {id: "legacy-1", question: "Legacy issue", note: "", skill: {name: "Legacy"}},
    ]

    it("keeps managed Skills separate and counts every group", () => {
        assert.deepEqual(rawCaseSkillOptions(entries), [
            {key: "skill-a", name: "Alpha", count: 2},
            {key: "skill-b", name: "Beta", count: 1},
            {key: "legacy:Legacy", name: "Legacy", count: 1},
        ])
    })

    it("filters by stable Skill id before applying text search", () => {
        assert.deepEqual(
            rawCaseSkillGroups(entries, "billing", "skill-b")
                .flatMap((group) => group.items.map((item) => item.id)),
            ["b-1"],
        )
        assert.deepEqual(rawCaseSkillGroups(entries, "Alpha", "skill-b"), [])
    })

    it("falls back to all Skills when a selected Skill disappears", () => {
        assert.equal(resolveRawCaseSkillScope("skill-a", entries), "skill-a")
        assert.equal(resolveRawCaseSkillScope("missing", entries), "all")
        assert.equal(resolveRawCaseSkillScope("all", []), "all")
    })

    it("never keeps a Draft selected outside the visible category", () => {
        assert.equal(visibleCurationSelection("archived", [{id: "active"}]), "active")
        assert.equal(visibleCurationSelection("archived", []), "")
        assert.equal(visibleCurationSelection("active", [{id: "active"}]), "active")
    })
})
