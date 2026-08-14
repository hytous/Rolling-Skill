const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    DATASET_RUBRIC_SCHEMA,
    datasetRubricDigest,
    parseDatasetRubric,
    validateDatasetRubric,
} = require("../src/dataset-rubric.cjs")

function rubric() {
    return {
        schemaVersion: DATASET_RUBRIC_SCHEMA,
        title: "Billing Skill result-quality rubric",
        summary: "Assess the Skill-specific workflow and the trustworthiness of its conclusions.",
        criteria: [
            {
                id: "R1",
                title: "Billing workflow fidelity",
                criterion: "Use the Skill-prescribed query and verification workflow.",
                weight: 2,
                evidenceRequirements: ["Trace command or tool evidence", "Agent response"],
                scoringAnchors: {
                    "0": "The workflow was absent or contradicted.",
                    "2": "Only a token part of the workflow was visible.",
                    "5": "The main workflow ran with material gaps.",
                    "8": "The workflow was substantially complete with minor gaps.",
                    "10": "The complete workflow and verification were evidenced.",
                },
                criticalFailure: false,
            },
            {
                id: "R2",
                title: "Numerical conclusion quality",
                criterion: "Report scoped, attributable, and internally consistent cost conclusions.",
                weight: 3,
                evidenceRequirements: ["Reference facts", "Agent response"],
                scoringAnchors: {
                    "0": "The numerical conclusion is missing or fabricated.",
                    "2": "Most requested fields are missing or unsupported.",
                    "5": "The conclusion is partly correct but materially incomplete.",
                    "8": "The conclusion is correct with only minor presentation gaps.",
                    "10": "All requested conclusions are correct, scoped, and cross-checked.",
                },
                criticalFailure: true,
            },
        ],
        automaticFailures: [
            {
                id: "RF1",
                condition: "The answer invents a billing number not supported by any supplied evidence.",
                rationale: "Fabricated financial results invalidate the Skill-specific result quality.",
            },
        ],
    }
}

describe("dataset rubric contract", () => {
    it("validates a complete, score-free rubric and returns an immutable normalized copy", () => {
        const validated = validateDatasetRubric(rubric())

        assert.equal(validated.schemaVersion, "rolling-skill-dataset-rubric/v1")
        assert.deepEqual(validated.criteria.map((entry) => entry.id), ["R1", "R2"])
        assert.equal(Object.isFrozen(validated), true)
        assert.equal(Object.isFrozen(validated.criteria[0]), true)
    })

    it("requires unique ids, positive weights, complete anchors, and evidence requirements", () => {
        const duplicate = rubric()
        duplicate.criteria[1].id = "R1"
        assert.throws(() => validateDatasetRubric(duplicate), /unique/i)

        const badWeight = rubric()
        badWeight.criteria[0].weight = 0
        assert.throws(() => validateDatasetRubric(badWeight), /weight/i)

        const missingAnchor = rubric()
        delete missingAnchor.criteria[0].scoringAnchors[8]
        assert.throws(() => validateDatasetRubric(missingAnchor), /anchor/i)

        const missingEvidence = rubric()
        missingEvidence.criteria[0].evidenceRequirements = []
        assert.throws(() => validateDatasetRubric(missingEvidence), /evidence/i)
    })

    it("rejects score and verdict fields anywhere in Agent output", () => {
        const withScore = rubric()
        withScore.criteria[0].score = 10
        assert.throws(() => validateDatasetRubric(withScore), /score|verdict/i)

        const withVerdict = rubric()
        withVerdict.automaticFailures[0].verdict = "fail"
        assert.throws(() => validateDatasetRubric(withVerdict), /score|verdict/i)
    })

    it("produces a stable digest independent of object key order", () => {
        const first = rubric()
        const second = {
            automaticFailures: first.automaticFailures,
            criteria: first.criteria,
            summary: first.summary,
            title: first.title,
            schemaVersion: first.schemaVersion,
        }

        assert.equal(datasetRubricDigest(first), datasetRubricDigest(second))
        assert.match(datasetRubricDigest(first), /^sha256:[a-f0-9]{64}$/)
    })

    it("extracts the last valid JSON contract from a conversational Agent response", () => {
        const parsed = parseDatasetRubric(`I revised the evidence anchors.\n\n\`\`\`json\n${JSON.stringify(rubric())}\n\`\`\``)
        assert.equal(parsed.criteria.length, 2)
    })
})
