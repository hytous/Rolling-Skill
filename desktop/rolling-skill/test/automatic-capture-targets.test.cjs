const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    candidateDatasetOptions,
    candidateSkillRows,
    captureTargetsValid,
    initialCaptureTargets,
} = require("../renderer/automatic-capture-targets.js")

const skills = [
    {id: "skill-billing", name: "billing", status: "valid"},
    {id: "skill-risk", name: "risk", status: "warning"},
]

const datasets = [
    {
        id: "dataset-billing-ready",
        name: "Billing ready",
        skillReference: {id: "skill-billing"},
        activeRubricVersionId: "rubric-1",
    },
    {
        id: "dataset-billing-draft",
        name: "Billing draft",
        skillReference: {id: "skill-billing"},
        activeRubricVersionId: null,
    },
    {
        id: "dataset-risk",
        name: "Risk",
        skillReference: {id: "skill-risk"},
        activeRubricVersionId: "rubric-2",
    },
]

describe("automatic capture target view model", () => {
    it("shows valid managed Skills and retains unavailable saved targets for repair", () => {
        assert.deepEqual(
            candidateSkillRows(skills, [{skillId: "skill-missing", datasetId: "dataset-old"}]),
            [
                skills[0],
                {id: "skill-missing", name: "skill-missing", status: "unavailable"},
            ],
        )
    })

    it("offers only bound Datasets and requires a published Rubric only in automatic mode", () => {
        assert.deepEqual(
            candidateDatasetOptions(datasets, "skill-billing", "automatic")
                .map(({id, disabled}) => ({id, disabled})),
            [
                {id: "dataset-billing-ready", disabled: false},
                {id: "dataset-billing-draft", disabled: true},
            ],
        )
        assert.deepEqual(
            candidateDatasetOptions(datasets, "skill-billing", "scheduled")
                .map(({id, disabled}) => ({id, disabled})),
            [
                {id: "dataset-billing-ready", disabled: false},
                {id: "dataset-billing-draft", disabled: false},
            ],
        )
    })

    it("keeps saved routes and migrates the legacy preferred Dataset", () => {
        const saved = [{skillId: "skill-billing", datasetId: "dataset-billing-ready"}]
        assert.deepEqual(initialCaptureTargets({targets: saved}, datasets), saved)
        assert.deepEqual(
            initialCaptureTargets({targets: [], datasetId: "dataset-risk"}, datasets),
            [{skillId: "skill-risk", datasetId: "dataset-risk"}],
        )
    })

    it("requires at least one valid Skill route whenever capture is enabled", () => {
        assert.equal(captureTargetsValid([], skills, datasets, "off"), true)
        assert.equal(captureTargetsValid([], skills, datasets, "scheduled"), false)
        assert.equal(captureTargetsValid([], skills, datasets, "automatic"), false)
        assert.equal(captureTargetsValid([
            {skillId: "skill-billing", datasetId: "dataset-billing-ready"},
        ], skills, datasets, "automatic"), true)
        assert.equal(captureTargetsValid([
            {skillId: "skill-billing", datasetId: "dataset-billing-draft"},
        ], skills, datasets, "automatic"), false)
        assert.equal(captureTargetsValid([
            {skillId: "skill-risk", datasetId: "dataset-risk"},
        ], skills, datasets, "automatic"), false)
    })
})
