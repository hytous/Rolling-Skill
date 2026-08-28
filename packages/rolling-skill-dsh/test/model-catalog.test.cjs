const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    reasoningEffortsFor,
    resolveModelId,
    resolveReasoningEffort,
} = require("../src/client/workbench/model-catalog.cjs")
const {
    candidateDatasetOptions,
    candidateSkillRows,
} = require("../src/client/workbench/automatic-capture-view-model.cjs")

describe("automatic capture view models", () => {
    it("resolves an authoritative Runtime catalog without retaining stale selections", () => {
        const models = [{id: "model-a"}, {id: "model-b"}]
        assert.equal(resolveModelId(models, "model-b"), "model-b")
        assert.equal(resolveModelId(models, "removed-model"), "model-a")
        assert.equal(resolveModelId([], "removed-model"), "")
    })

    it("merges and normalizes every supported reasoning-effort shape", () => {
        const models = [{
            id: "model-a",
            reasoningEfforts: [],
            supportedReasoningEfforts: [
                {reasoningEffort: "low", displayName: "Low"},
                "medium",
                {effort: "high"},
                {value: "xhigh"},
                {id: "low", displayName: "Duplicate"},
            ],
        }]
        assert.deepEqual(reasoningEffortsFor(models, "model-a"), [
            {id: "low", label: "Low"},
            {id: "medium", label: "medium"},
            {id: "high", label: "high"},
            {id: "xhigh", label: "xhigh"},
        ])
        assert.equal(resolveReasoningEffort(models, "model-a", "high"), "high")
        assert.equal(resolveReasoningEffort(models, "model-a", "removed"), "")
    })

    it("keeps a saved target visible when its Skill leaves the valid catalog", () => {
        assert.deepEqual(candidateSkillRows(
            [{id: "skill-live", name: "Live", status: "valid"}],
            [{skillId: "skill-missing", datasetId: "dataset-old"}],
        ), [
            {id: "skill-live", name: "Live", status: "valid"},
            {id: "skill-missing", name: "skill-missing", status: "unavailable"},
        ])
    })

    it("keeps every bound Dataset visible and marks automatic-only Rubric requirements", () => {
        const datasets = [
            {id: "ready", name: "Ready", skillReference: {id: "skill-a"}, activeRubricVersionId: "rubric-1"},
            {id: "draft", name: "Draft", skillReference: {id: "skill-a"}, activeRubricVersionId: null},
            {id: "other", name: "Other", skillReference: {id: "skill-b"}, activeRubricVersionId: "rubric-2"},
        ]

        assert.deepEqual(candidateDatasetOptions(datasets, "skill-a", "automatic"), [
            {...datasets[0], disabled: false},
            {...datasets[1], disabled: true},
        ])
        assert.deepEqual(candidateDatasetOptions(datasets, "skill-a", "scheduled"), [
            {...datasets[0], disabled: false},
            {...datasets[1], disabled: false},
        ])
    })
})
