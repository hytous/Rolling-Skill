;(function exposeCaseCalibrationBatch(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillCalibrationBatch = api
})(typeof globalThis === "undefined" ? this : globalThis, function createCaseCalibrationBatch() {
    "use strict"

    function nonEmpty(value, label) {
        const text = String(value ?? "").trim()
        if (!text) throw new Error(`${label} is required`)
        return text
    }

    class CaseCalibrationBatch {
        constructor({id = `calibration-batch-${Date.now()}`, datasetId, rubricVersionId, caseIds}) {
            this.id = nonEmpty(id, "Batch id")
            this.datasetId = nonEmpty(datasetId, "Dataset id")
            this.rubricVersionId = nonEmpty(rubricVersionId, "Rubric version id")
            this.caseIds = [...new Set((caseIds ?? []).map((caseId) => nonEmpty(caseId, "Case id")))]
            if (!this.caseIds.length) throw new Error("At least one Case is required")
            this.status = "running"
            this.completedCaseIds = new Set()
            this.cursor = 0
            this.currentCaseId = null
            this.currentSessionId = null
            this.archiving = false
            this.error = null
        }

        nextCase() {
            if (this.status !== "running" || this.currentCaseId || this.archiving) return null
            while (this.cursor < this.caseIds.length) {
                const caseId = this.caseIds[this.cursor]
                this.cursor += 1
                if (this.completedCaseIds.has(caseId)) continue
                this.currentCaseId = caseId
                return caseId
            }
            this.status = "completed"
            return null
        }

        attachSession(caseId, sessionId) {
            if (this.status !== "running" || caseId !== this.currentCaseId) return false
            this.currentSessionId = nonEmpty(sessionId, "Curation session id")
            return true
        }

        matches(session) {
            return Boolean(
                this.status === "running" &&
                session?.operation === "calibration" &&
                session.id === this.currentSessionId &&
                session.targetCaseId === this.currentCaseId,
            )
        }

        beginAutoArchive(session) {
            if (
                !this.matches(session) ||
                this.archiving ||
                session.status !== "needs_review" ||
                !session.draft
            ) {
                return false
            }
            this.archiving = true
            return true
        }

        completeAutoArchive(sessionId) {
            if (!this.archiving || sessionId !== this.currentSessionId || !this.currentCaseId) {
                throw new Error("The calibration archive does not belong to this batch")
            }
            this.completedCaseIds.add(this.currentCaseId)
            this.currentCaseId = null
            this.currentSessionId = null
            this.archiving = false
            if (this.completedCaseIds.size === this.caseIds.length) this.status = "completed"
            return this.snapshot()
        }

        pause() {
            if (this.status === "running") this.status = "paused"
            this.archiving = false
            return this.snapshot()
        }

        stop() {
            if (this.status !== "completed") this.status = "stopped"
            this.archiving = false
            return this.snapshot()
        }

        fail(error) {
            if (this.status === "completed" || this.status === "stopped") return this.snapshot()
            this.status = "failed"
            this.archiving = false
            this.error = error?.message ?? String(error ?? "Calibration failed")
            return this.snapshot()
        }

        snapshot() {
            return {
                id: this.id,
                datasetId: this.datasetId,
                rubricVersionId: this.rubricVersionId,
                status: this.status,
                total: this.caseIds.length,
                completed: this.completedCaseIds.size,
                remaining: this.caseIds.length - this.completedCaseIds.size,
                currentCaseId: this.currentCaseId,
                currentSessionId: this.currentSessionId,
                archiving: this.archiving,
                error: this.error,
            }
        }
    }

    return {CaseCalibrationBatch}
})
