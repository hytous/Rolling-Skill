const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CaseCalibrationBatch,
} = require("../renderer/case-calibration-batch.js")

describe("automatic Case calibration batch", () => {
    it("serializes Cases and auto-archives each valid review exactly once", () => {
        const batch = new CaseCalibrationBatch({
            id: "batch-1",
            datasetId: "dataset-1",
            rubricVersionId: "rubric-2",
            caseIds: ["case-1", "case-2"],
        })

        assert.equal(batch.nextCase(), "case-1")
        assert.equal(batch.nextCase(), null)
        batch.attachSession("case-1", "curation-1")
        assert.equal(batch.beginAutoArchive({
            id: "curation-1",
            operation: "calibration",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        }), true)
        assert.equal(batch.beginAutoArchive({
            id: "curation-1",
            operation: "calibration",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        }), false)

        batch.completeAutoArchive("curation-1")
        assert.equal(batch.snapshot().completed, 1)
        assert.equal(batch.nextCase(), "case-2")
        batch.attachSession("case-2", "curation-2")
        assert.equal(batch.beginAutoArchive({
            id: "curation-2",
            operation: "calibration",
            targetCaseId: "case-2",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        }), true)
        batch.completeAutoArchive("curation-2")

        assert.deepEqual(batch.snapshot(), {
            id: "batch-1",
            datasetId: "dataset-1",
            rubricVersionId: "rubric-2",
            status: "completed",
            total: 2,
            completed: 2,
            remaining: 0,
            currentCaseId: null,
            currentSessionId: null,
            archiving: false,
            error: null,
        })
        assert.equal(batch.nextCase(), null)
    })

    it("stops without starting another Case and rejects stale session updates", () => {
        const batch = new CaseCalibrationBatch({
            id: "batch-2",
            datasetId: "dataset-1",
            rubricVersionId: "rubric-2",
            caseIds: ["case-1", "case-2"],
        })
        assert.equal(batch.nextCase(), "case-1")
        batch.attachSession("case-1", "curation-1")

        assert.equal(batch.beginAutoArchive({
            id: "other-curation",
            operation: "calibration",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {},
        }), false)
        batch.stop()
        assert.equal(batch.nextCase(), null)
        assert.equal(batch.beginAutoArchive({
            id: "curation-1",
            operation: "calibration",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {},
        }), false)
        assert.equal(batch.snapshot().status, "stopped")
    })

    it("pauses on failure without consuming the current Case", () => {
        const batch = new CaseCalibrationBatch({
            datasetId: "dataset-1",
            rubricVersionId: "rubric-2",
            caseIds: ["case-1", "case-2"],
        })
        assert.equal(batch.nextCase(), "case-1")
        batch.fail("Curator failed")

        assert.equal(batch.snapshot().status, "failed")
        assert.equal(batch.snapshot().completed, 0)
        assert.equal(batch.snapshot().remaining, 2)
        assert.equal(batch.snapshot().error, "Curator failed")
        assert.equal(batch.nextCase(), null)
    })
})
