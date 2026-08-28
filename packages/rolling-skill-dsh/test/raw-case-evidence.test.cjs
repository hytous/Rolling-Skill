const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    latestObservation,
    evidenceTimeline,
    rawCaseEvidence,
} = require("../src/client/workbench/raw-case-evidence.cjs")

describe("Raw Case capture evidence", () => {
    const source = {
        kind: "automatic_capture",
        observations: [{
            threadId: "session-1",
            startItemId: "dsh:session-1:12",
            endItemId: "dsh:session-1:20",
            outcome: "resolved",
            caseType: "goodcase",
            confidence: 0.92,
            reason: "The task was completed.",
        }],
    }

    it("uses the latest automatic observation as the visible evidence", () => {
        assert.equal(latestObservation({
            ...source,
            observations: [
                {...source.observations[0], confidence: 0.4},
                {...source.observations[0], confidence: 0.92},
            ],
        }).confidence, 0.92)
    })

    it("maps DSH item boundaries to an inclusive native conversation range", () => {
        assert.deepEqual(rawCaseEvidence(source, "session-1"), {
            kind: "automatic_capture",
            observation: source.observations[0],
            startSeq: 12,
            endSeq: 20,
            canRevealRange: true,
        })
    })

    it("does not claim it can reveal another or non-DSH conversation", () => {
        assert.equal(rawCaseEvidence(source, "session-2").canRevealRange, false)
        assert.equal(rawCaseEvidence({
            kind: "automatic_capture",
            observations: [{...source.observations[0], startItemId: "opaque-a"}],
        }, "session-1").canRevealRange, false)
        assert.equal(rawCaseEvidence({kind: "manual"}, "session-1").observation, null)
    })

    it("projects a bounded Episode into readable message and collapsed tool rows", () => {
        const timeline = evidenceTimeline({items: [
            {id: "user-1", type: "userMessage", text: "查账单"},
            {id: "context-1", type: "userMessage", sourceKind: "plugin", text: "Runtime context"},
            {id: "tool-1", type: "dynamicToolCall", toolName: "billing", status: "completed", arguments: "{}", result: "100"},
            {id: "agent-1", type: "agentMessage", text: "本月 100 元"},
        ]})

        assert.deepEqual(timeline.map((item) => ({
            kind: item.kind,
            boundary: item.boundary,
            collapsible: item.collapsible,
        })), [
            {kind: "user", boundary: "start", collapsible: false},
            {kind: "context", boundary: null, collapsible: true},
            {kind: "tool", boundary: null, collapsible: true},
            {kind: "assistant", boundary: "end", collapsible: false},
        ])
        assert.equal(timeline[1].label, "plugin")
        assert.equal(timeline[2].label, "billing")
    })
})
