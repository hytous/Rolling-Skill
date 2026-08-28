const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {projectMarkers, projectSequenceRange} = require("../src/client/conversation/curation-markers.cjs")

function snapshot() {
    const rows = new Map([
        ["flow-4", {key: "flow-4", anchorSeq: 4}],
        ["flow-6", {key: "flow-6", anchorSeq: 6}],
        ["flow-12", {key: "flow-12", anchorSeq: 12}],
        ["flow-14", {key: "flow-14", anchorSeq: 14}],
        ["flow-16", {key: "flow-16", anchorSeq: 16}],
        ["flow-20", {key: "flow-20", anchorSeq: 20}],
    ])
    return {chat: {order: [...rows.keys()], nodes: {get: (key) => rows.get(key)}}}
}

describe("DSH conversation curation marker projection", () => {
    it("projects a Raw Case evidence range through native flow keys", () => {
        assert.deepEqual(
            projectSequenceRange(snapshot(), 6, 16),
            ["flow-6", "flow-12", "flow-14", "flow-16"],
        )
        assert.deepEqual(projectSequenceRange(snapshot(), 20, 12), [])
    })

    it("projects inclusive ranges through stable flow keys", () => {
        assert.deepEqual(
            [...projectMarkers(snapshot(), [{startSeq: 6, endSeq: 16, status: "draft"}])],
            [
                ["flow-6", "draft"],
                ["flow-12", "draft"],
                ["flow-14", "draft"],
                ["flow-16", "draft"],
            ],
        )
    })

    it("lets a saved Case win over Draft overlap and ignores invalid ranges", () => {
        assert.deepEqual(
            [...projectMarkers(snapshot(), [
                {startSeq: 4, endSeq: 14, status: "draft"},
                {startSeq: 12, endSeq: 20, status: "saved"},
                {startSeq: 30, endSeq: 2, status: "saved"},
            ])],
            [
                ["flow-4", "draft"],
                ["flow-6", "draft"],
                ["flow-12", "saved"],
                ["flow-14", "saved"],
                ["flow-16", "saved"],
                ["flow-20", "saved"],
            ],
        )
    })
})
