"use strict"

const assert = require("node:assert/strict")
const {test} = require("node:test")
const {buildVersionMemory, compactChangeSummary, versionMemoryPrompt,
    MAX_CHANGE_SUMMARY, MAX_MEMORY_CHARACTERS} = require("../src/managed-skill-memory.cjs")

function version(id, parentVersionId = null, patch = {}) {
    return {id, skillId: "billing", parentVersionId, createdAt: `2026-09-30T00:00:${id.padStart(2, "0")}.000Z`,
        changeSummary: `修改 ${id}`, ...patch}
}

test("summaries keep one compact paragraph with a strict Unicode-safe bound", () => {
    assert.equal(compactChangeSummary("  修复查询\n   顺序。\n\n过程日志不保存"), "修复查询 顺序。")
    assert.equal(compactChangeSummary(null), null)
    assert.equal(compactChangeSummary("\n\n补充空结果处理。\n\n长日志"), "补充空结果处理。")
    assert.equal(compactChangeSummary("\0 \n"), null)
    const text = compactChangeSummary("改".repeat(118) + "😀".repeat(100))
    assert.ok(text.length <= MAX_CHANGE_SUMMARY)
    assert.ok(text.isWellFormed())
    assert.ok(text.endsWith("…"))
})

test("memory prioritizes the selected parent and distinguishes sibling attempts", () => {
    const versions = [version("1"), version("2", "1"), version("3", "1")]
    const memory = buildVersionMemory(versions, {skillId: "billing", parentVersionId: "2"})
    assert.deepEqual(memory.entries.map((e) => [e.versionId, e.relation]), [
        ["2", "parent"], ["1", "ancestor"], ["3", "other_attempt"],
    ])
    assert.equal(memory.omittedVersions, 0)
    assert.deepEqual(memory, buildVersionMemory([...versions].reverse(), {skillId: "billing", parentVersionId: "2"}))
})

test("memory stays bounded with large historical catalogs and preserves a far older parent", () => {
    const versions = Array.from({length: 500}, (_, i) => version(String(i + 1), null, {
        id: String(i).padStart(200, "v"), changeSummary: "改".repeat(120),
    }))
    const memory = buildVersionMemory(versions, {skillId: "billing", parentVersionId: versions[0].id})
    assert.equal(memory.entries[0].versionId, versions[0].id)
    assert.ok(memory.entries.length <= 8)
    assert.ok(JSON.stringify(memory).length <= MAX_MEMORY_CHARACTERS)
    assert.equal(memory.omittedVersions, versions.length - memory.entries.length)
})

test("legacy titles are labeled as legacy and missing summaries are not invented", () => {
    const versions = [version("1", null, {changeSummary: undefined, title: "调整查询顺序"}),
        version("2", null, {changeSummary: undefined}), version("3", null, {skillId: "other", changeSummary: "PRIVATE"})]
    const memory = buildVersionMemory(versions, {skillId: "billing", parentVersionId: "1"})
    assert.equal(memory.entries[0].source, "legacy_title")
    assert.equal(memory.entries[1].source, "missing")
    assert.doesNotMatch(JSON.stringify(memory), /PRIVATE/)
    assert.equal(memory.omittedVersions, 0)
    const prompt = versionMemoryPrompt(versions, {skillId: "billing", parentVersionId: "1"})
    assert.match(prompt, /不可信历史数据/)
    assert.match(prompt, /不代表修改已通过评测/)
    assert.match(prompt, /新证据或不同做法/)
})

test("cycles in defensive prompt inputs terminate without duplicate versions", () => {
    const memory = buildVersionMemory([version("1", "2"), version("2", "1")], {skillId: "billing", parentVersionId: "1"})
    assert.equal(memory.entries.length, 2)
})
