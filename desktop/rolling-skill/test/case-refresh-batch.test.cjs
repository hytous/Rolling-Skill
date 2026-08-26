const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {CaseRefreshBatch} = require("../renderer/case-refresh-batch.js")

describe("automatic Case refresh batch", () => {
    it("serializes unique Cases and auto-archives each valid refresh exactly once", () => {
        const batch = new CaseRefreshBatch({
            id: "refresh-batch-1",
            datasetId: "dataset-1",
            caseIds: ["good-1", "good-1", "bad-1"],
        })

        assert.equal(batch.nextCase(), "good-1")
        assert.equal(batch.nextCase(), null)
        assert.equal(batch.attachSession("good-1", "refresh-1"), true)
        const valid = {
            id: "refresh-1",
            operation: "refresh",
            targetCaseId: "good-1",
            status: "needs_review",
            draft: {},
        }
        assert.equal(batch.beginAutoArchive(valid), true)
        assert.equal(batch.beginAutoArchive(valid), false)
        batch.completeAutoArchive("refresh-1")

        assert.equal(batch.nextCase(), "bad-1")
        batch.attachSession("bad-1", "refresh-2")
        assert.equal(batch.beginAutoArchive({
            ...valid,
            id: "refresh-2",
            targetCaseId: "bad-1",
        }), true)
        batch.completeAutoArchive("refresh-2")

        assert.deepEqual(batch.snapshot(), {
            id: "refresh-batch-1",
            datasetId: "dataset-1",
            status: "completed",
            total: 2,
            completed: 2,
            remaining: 0,
            currentCaseId: null,
            currentSessionId: null,
            archiving: false,
            error: null,
        })
    })

    it("rejects stale or non-refresh Sessions and stops before the next Case", () => {
        const batch = new CaseRefreshBatch({
            datasetId: "dataset-1",
            caseIds: ["case-1", "case-2"],
        })
        batch.nextCase()
        batch.attachSession("case-1", "refresh-1")

        assert.equal(batch.beginAutoArchive({
            id: "refresh-1",
            operation: "calibration",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {},
        }), false)
        assert.equal(batch.beginAutoArchive({
            id: "stale-refresh",
            operation: "refresh",
            targetCaseId: "case-1",
            status: "needs_review",
            draft: {},
        }), false)
        batch.stop()
        assert.equal(batch.nextCase(), null)
        assert.equal(batch.snapshot().status, "stopped")
    })

    it("pauses for manual takeover and retains failures without consuming the current Case", () => {
        const manual = new CaseRefreshBatch({datasetId: "dataset-1", caseIds: ["case-1"]})
        manual.nextCase()
        manual.pause()
        assert.equal(manual.snapshot().status, "paused")
        assert.equal(manual.snapshot().completed, 0)

        const failed = new CaseRefreshBatch({
            datasetId: "dataset-1",
            caseIds: ["case-1", "case-2"],
        })
        failed.nextCase()
        failed.fail(new Error("Runtime replay failed"))
        assert.equal(failed.snapshot().status, "failed")
        assert.equal(failed.snapshot().completed, 0)
        assert.equal(failed.snapshot().remaining, 2)
        assert.equal(failed.snapshot().error, "Runtime replay failed")
    })
})
