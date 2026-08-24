const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    OPERATOR_ACTIONS,
    OPERATOR_DELTA_INTERVAL_MS,
    artifactDeepLinks,
    buildOperatorSessionRequest,
    createKeyedTranscriptPatcher,
    createOperatorWorkbenchState,
    transcriptEntryKey,
} = require("../renderer/operator-workbench.js")

function summary(overrides = {}) {
    return {
        generation: "generation-a-0123456789abcdef",
        revision: 1,
        sessions: [{id: "session-1", transcriptSequence: 0}],
        jobs: [{
            id: "job-1",
            sessionId: "session-1",
            parentJobId: null,
            objective: "Improve the selected Skill",
            status: "queued",
            budget: {},
            childJobIds: [],
            artifactIds: [],
            approvalIds: [],
        }],
        steps: [],
        approvals: [],
        totals: {sessions: 1, jobs: 1, steps: 0, approvals: 0},
        truncated: false,
        nextCursor: null,
        ...overrides,
    }
}

function event(id, sessionId = "session-1", jobId = "job-1") {
    return {
        id,
        sessionId,
        jobId,
        kind: "message",
        role: "assistant",
        content: `delta ${id}`,
        sequence: Number(id.replace(/\D/gu, "")) || 1,
    }
}

describe("Operator workbench state", () => {
    it("offers only actions exposed to the Operator control catalog", () => {
        assert.deepEqual(OPERATOR_ACTIONS, [
            "context.read",
            "raw_cases.read",
            "raw_cases.write",
            "runtime.execute",
            "runtimes.read",
            "datasets.read",
            "datasets.write",
            "datasets.delete",
            "evaluations.read",
            "evaluations.execute",
            "skills.read",
            "skills.write",
            "skills.release",
            "jobs.read",
            "approvals.read",
            "curation.write",
            "rubrics.publish",
            "installations.execute",
            "installations.read",
        ])
    })

    it("builds setup requests only from capability-backed Runtime and model catalogs", () => {
        const request = buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            modelId: "model-live-1",
            effort: "high",
            objective: "Improve and evaluate this Skill",
            actionIds: ["datasets.read", "evaluations.execute"],
            skillId: "skill-1",
            datasetId: "dataset-1",
            targetRuntimeIds: ["runtime-1", "runtime-2"],
            budget: {
                maxDurationMs: "60000",
                maxRuntimeTurns: "10",
                maxEvaluations: "2",
                maxTargetExecutions: "20",
                maxJudgeExecutions: "20",
                maxTokens: "",
                maxReportedCost: "",
            },
        }, {
            runtimes: [
                {runtimeId: "runtime-1", efforts: ["low", "high"]},
                {runtimeId: "runtime-2", efforts: ["medium"]},
            ],
            modelsByRuntime: new Map([["runtime-1", [{id: "model-live-1"}]]]),
            skills: [{id: "skill-1", repositoryId: "repository-1"}],
            datasets: [{id: "dataset-1"}],
        })

        assert.deepEqual(request, {
            runtimeId: "runtime-1",
            modelId: "model-live-1",
            effort: "high",
            objective: "Improve and evaluate this Skill",
            actions: ["datasets.read", "evaluations.execute"],
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["runtime-1", "runtime-2"],
                repositoryIds: ["repository-1"],
            },
            budget: {
                maxDurationMs: 60000,
                maxRuntimeTurns: 10,
                maxEvaluations: 2,
                maxTargetExecutions: 20,
                maxJudgeExecutions: 20,
                maxTokens: null,
                maxReportedCost: null,
            },
            managedSkillBinding: {repositoryId: "repository-1", skillId: "skill-1"},
        })
        assert.throws(() => buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            modelId: "invented-model",
            objective: "Do work",
            actionIds: [],
            targetRuntimeIds: [],
            budget: request.budget,
        }, {
            runtimes: [{runtimeId: "runtime-1"}],
            modelsByRuntime: new Map([["runtime-1", [{id: "model-live-1"}]]]),
            skills: [],
            datasets: [],
        }), /model.*catalog/iu)
        assert.throws(() => buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            objective: "Do work",
            actionIds: ["unknown.action"],
            targetRuntimeIds: [],
            budget: request.budget,
        }, {
            runtimes: [{runtimeId: "runtime-1"}],
            modelsByRuntime: new Map([["runtime-1", []]]),
            skills: [],
            datasets: [],
        }), /action.*catalog/iu)
    })

    it("derives artifact entity links from public metadata without exposing local paths", () => {
        assert.deepEqual(artifactDeepLinks({metadata: {
            datasetId: "dataset-1",
            caseId: "case-1",
            evaluationId: "evaluation-1",
            candidateId: "candidate-1",
            installationId: "installation-1",
            path: "/private/never-render-this",
        }}), [
            {kind: "dataset", id: "dataset-1", label: "Dataset dataset-1"},
            {kind: "case", id: "case-1", label: "Case case-1"},
            {kind: "evaluation", id: "evaluation-1", label: "Evaluation evaluation-1"},
            {kind: "candidate", id: "candidate-1", label: "Candidate candidate-1"},
            {kind: "installation", id: "installation-1", label: "Installation installation-1"},
        ])
        assert.doesNotMatch(JSON.stringify(artifactDeepLinks({metadata: {path: "/private"}})), /private/)
        assert.deepEqual(artifactDeepLinks({metadata: {
            installationId: "installation-1",
            installationIds: ["installation-1", "installation-2", "installation-2"],
        }}), [
            {kind: "installation", id: "installation-1", label: "Installation installation-1"},
            {kind: "installation", id: "installation-2", label: "Installation installation-2"},
        ])
    })

    it("upserts Jobs and deduplicates repeated event envelopes by stable identity", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary())

        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            invalidate: true,
            job: {...summary().jobs[0], status: "running"},
        })
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            invalidate: true,
            job: {...summary().jobs[0], status: "running"},
        })
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            invalidate: true,
            event: event("event-1"),
        })
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            invalidate: true,
            event: event("event-1"),
        })

        const snapshot = state.getSnapshot("job-1")
        assert.equal(snapshot.job.status, "running")
        assert.deepEqual(snapshot.jobs.map(({id}) => id), ["job-1"])
        assert.deepEqual(snapshot.events.map(({id}) => id), ["event-1"])
    })

    it("counts unread background deltas once and clears them when their session activates", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            sessions: [
                {id: "session-1", transcriptSequence: 0},
                {id: "session-2", transcriptSequence: 0},
            ],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2", objective: "Evaluate"},
            ],
        }))
        state.setVisible(true)
        await state.activateSession("session-1")

        const background = {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            invalidate: true,
            event: event("event-2", "session-2", "job-2"),
        }
        await state.ingest("event", background)
        await state.ingest("event", background)
        await state.ingest("approval", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            invalidate: true,
            approval: {
                id: "approval-1",
                sessionId: "session-2",
                jobId: "job-2",
                status: "pending",
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
            },
        })

        assert.deepEqual(state.getSnapshot("job-2").unread, {
            events: 1,
            approvals: 1,
            artifacts: 0,
        })
        await state.activateSession("session-2")
        assert.deepEqual(state.getSnapshot("job-2").unread, {
            events: 0,
            approvals: 0,
            artifacts: 0,
        })
    })

    it("normalizes bootstrap and notification approval keys without duplicates", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            approvals: [{
                id: "approval-1",
                sessionId: "session-1",
                jobId: "job-1",
                status: "pending",
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
            }],
        }))
        await state.ingest("approval", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            approval: {
                id: "approval-1",
                sessionId: "session-1",
                jobId: "job-1",
                status: "approved",
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
            },
        })

        const approvals = state.getSnapshot("job-1").approvals
        assert.equal(approvals.length, 1)
        assert.equal(approvals[0].status, "approved")
    })

    it("never invokes renderer patch hooks for hidden or background sessions", async () => {
        const patches = []
        const state = createOperatorWorkbenchState({
            onListPatch: (patch) => patches.push(["list", patch]),
            onActivePatch: (patch) => patches.push(["active", patch]),
        })
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2"},
            ],
        }))
        await state.activateSession("session-1")
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            job: {...summary().jobs[0], status: "running"},
        })
        assert.deepEqual(patches, [])

        state.setVisible(true)
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            job: {...summary().jobs[0], id: "job-2", sessionId: "session-2", status: "running"},
        })
        assert.deepEqual(patches, [])

        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 4,
            job: {...summary().jobs[0], status: "paused"},
        })
        assert.equal(patches.length, 1)
        assert.equal(patches[0][0], "list")
        assert.equal(patches[0][1].jobId, "job-1")
    })

    it("does not let stale changed or approval envelopes roll back caught-up state", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            revision: 5,
            jobs: [{...summary().jobs[0], status: "running"}],
            approvals: [{
                id: "approval-1",
                sessionId: "session-1",
                jobId: "job-1",
                status: "approved",
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
            }],
        }))
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 4,
            job: {...summary().jobs[0], status: "queued"},
        })
        await state.ingest("approval", {
            generation: "generation-a-0123456789abcdef",
            revision: 4,
            approval: {
                id: "approval-1",
                sessionId: "session-1",
                jobId: "job-1",
                status: "pending",
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
            },
        })

        const snapshot = state.getSnapshot("job-1")
        assert.equal(snapshot.job.status, "running")
        assert.equal(snapshot.approvals.length, 1)
        assert.equal(snapshot.approvals[0].status, "approved")
    })

    it("accepts out-of-order first updates for a different Job without entity rollback", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2", status: "queued"},
            ],
        }))
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            job: {...summary().jobs[0], status: "running"},
        })
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            event: event("event-3"),
        })
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            job: {...summary().jobs[0], id: "job-2", sessionId: "session-2", status: "running"},
        })
        await state.ingest("approval", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            approval: {
                id: "approval-2",
                sessionId: "session-2",
                jobId: "job-2",
                status: "pending",
                action: "evaluations.execute",
                scope: {datasetIds: ["dataset-1"]},
            },
        })

        assert.equal(state.getSnapshot("job-2").job.status, "running")
        assert.deepEqual(state.getSnapshot("job-2").approvals.map(({id}) => id), ["approval-2"])
    })

    it("batches only visible active-session text and activity patches at 64ms", async () => {
        const scheduled = []
        const patches = []
        const state = createOperatorWorkbenchState({
            schedule(callback, delay) {
                scheduled.push({callback, delay})
                return scheduled.length
            },
            cancel: () => {},
            onActivePatch: (patch) => patches.push(patch),
        })
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2"},
            ],
        }))
        state.setVisible(true)
        await state.activateSession("session-1")

        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            event: event("event-1"),
        })
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 3,
            event: event("event-3"),
        })
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 4,
            event: event("event-4", "session-2", "job-2"),
        })

        assert.equal(OPERATOR_DELTA_INTERVAL_MS, 64)
        assert.equal(scheduled.length, 1)
        assert.equal(scheduled[0].delay, 64)
        scheduled[0].callback()
        assert.equal(patches.length, 1)
        assert.equal(patches[0].jobId, "job-1")
        assert.deepEqual(patches[0].entryKeys, ["entry:event-1", "entry:event-3"])

        state.setVisible(false)
        await state.ingest("event", {
            generation: "generation-a-0123456789abcdef",
            revision: 5,
            event: event("event-5"),
        })
        assert.equal(scheduled.length, 1)
    })

    it("coalesces generation and revision-gap catch-up and retries a stale cursor from page one", async () => {
        const calls = []
        let staleOnce = true
        const state = createOperatorWorkbenchState({
            async readSummaryPage(cursor, limit) {
                calls.push({cursor, limit})
                assert.ok(limit <= 100)
                if (cursor === null && staleOnce) {
                    return summary({
                        generation: "generation-b-fedcba9876543210",
                        revision: 7,
                        jobs: [{...summary().jobs[0], status: "running"}],
                        truncated: true,
                        nextCursor: "stale-page-2",
                    })
                }
                if (cursor === "stale-page-2") {
                    staleOnce = false
                    const error = new Error("stale cursor")
                    error.code = "STALE_CURSOR"
                    throw error
                }
                if (cursor === null) {
                    return summary({
                        generation: "generation-b-fedcba9876543210",
                        revision: 8,
                        jobs: [{...summary().jobs[0], status: "running"}],
                        truncated: true,
                        nextCursor: "fresh-page-2",
                    })
                }
                assert.equal(cursor, "fresh-page-2")
                return summary({
                    generation: "generation-b-fedcba9876543210",
                    revision: 8,
                    sessions: [{id: "session-2", transcriptSequence: 0}],
                    jobs: [{...summary().jobs[0], id: "job-2", sessionId: "session-2"}],
                    truncated: false,
                    nextCursor: null,
                })
            },
        })
        state.initialize(summary())

        await Promise.all([
            state.ingest("changed", {
                generation: "generation-b-fedcba9876543210",
                revision: 7,
                invalidate: true,
            }),
            state.ingest("event", {
                generation: "generation-b-fedcba9876543210",
                revision: 7,
                invalidate: true,
                event: event("event-7"),
            }),
        ])

        assert.equal(calls.length, 4)
        assert.deepEqual(calls.map(({cursor}) => cursor), [
            null,
            "stale-page-2",
            null,
            "fresh-page-2",
        ])
        assert.equal(state.generation, "generation-b-fedcba9876543210")
        assert.equal(state.revision, 8)
        assert.deepEqual(state.listSnapshots().map(({job}) => job.id).sort(), ["job-1", "job-2"])
    })

    it("recovers missed active transcript and artifacts after a gap and invalidates prior artifact paging", async () => {
        let detailVersion = 1
        let artifactVersion = 1
        let detailReads = 0
        let artifactFirstPageReads = 0
        const resets = []
        const state = createOperatorWorkbenchState({
            async readSummaryPage() {
                return summary({
                    revision: 4,
                    jobs: [{...summary().jobs[0], status: "running"}],
                })
            },
            async readOperatorSession() {
                detailReads += 1
                return {
                    session: {
                        id: "session-1",
                        transcript: [{
                            sessionId: "session-1",
                            sequence: detailVersion,
                            kind: "message",
                            role: "assistant",
                            content: `detail ${detailVersion}`,
                        }],
                    },
                    parentJob: {...summary().jobs[0], status: "running"},
                }
            },
            async readArtifactPage(jobId, cursor, limit) {
                assert.equal(jobId, "job-1")
                assert.equal(cursor, null)
                assert.ok(limit <= 100)
                artifactFirstPageReads += 1
                return {
                    artifacts: [{
                        id: `artifact-${artifactVersion}`,
                        jobId,
                        kind: "operator-step-result",
                        name: `artifact-${artifactVersion}.json`,
                        metadata: {datasetId: `dataset-${artifactVersion}`},
                    }],
                    nextCursor: null,
                }
            },
            onActiveReset: (reset) => resets.push(reset),
        })
        state.initialize(summary())
        state.setVisible(true)
        await state.activateSession("session-1")
        assert.equal(detailReads, 1)
        assert.equal(artifactFirstPageReads, 1)

        detailVersion = 2
        artifactVersion = 2
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 4,
            invalidate: true,
            job: {...summary().jobs[0], status: "running"},
        })

        const recovered = state.getSnapshot("job-1")
        assert.deepEqual(recovered.transcript.map(({content}) => content), ["detail 2"])
        assert.deepEqual(recovered.artifacts.map(({id}) => id), ["artifact-2"])
        assert.equal(recovered.needsDetailCatchUp, false)
        assert.equal(detailReads, 2)
        assert.equal(artifactFirstPageReads, 2)
        assert.ok(resets.some(({reason}) => reason === "catch-up"))
    })

    it("does not let deferred stale detail roll back a newer Job delta", async () => {
        let releaseDetail
        let detailStarted
        const detailGate = new Promise((resolve) => { releaseDetail = resolve })
        const started = new Promise((resolve) => { detailStarted = resolve })
        const state = createOperatorWorkbenchState({
            async readOperatorSession() {
                detailStarted()
                await detailGate
                return {
                    session: {id: "session-1", transcript: []},
                    parentJob: {...summary().jobs[0], status: "running"},
                }
            },
            async readArtifactPage() {
                return {artifacts: [], nextCursor: null}
            },
        })
        state.initialize(summary())
        state.setVisible(true)

        const activation = state.activateSession("session-1")
        await started
        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            job: {...summary().jobs[0], status: "paused"},
        })
        releaseDetail()
        await activation

        assert.equal(state.revision, 2)
        assert.equal(state.getSnapshot("job-1").job.status, "paused")
    })

    it("merges artifacts that arrive while an older artifact page is deferred", async () => {
        let releaseArtifacts
        let artifactReadStarted
        const artifactGate = new Promise((resolve) => { releaseArtifacts = resolve })
        const started = new Promise((resolve) => { artifactReadStarted = resolve })
        const state = createOperatorWorkbenchState({
            async readOperatorSession() {
                return {
                    session: {id: "session-1", transcript: []},
                    parentJob: {...summary().jobs[0], status: "running"},
                }
            },
            async readArtifactPage() {
                artifactReadStarted()
                await artifactGate
                return {artifacts: [], nextCursor: null}
            },
        })
        state.initialize(summary())
        state.setVisible(true)

        const activation = state.activateSession("session-1")
        await started
        await state.ingest("artifact", {
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            artifact: {
                id: "artifact-new",
                jobId: "job-1",
                kind: "report",
                name: "new report",
            },
        })
        releaseArtifacts()
        await activation

        assert.equal(state.revision, 2)
        assert.deepEqual(state.getSnapshot("job-1").artifacts.map(({id}) => id), ["artifact-new"])
    })

    it("retries a newer generation that arrives during an in-flight detail catch-up", async () => {
        let summaryReads = 0
        let detailReads = 0
        let releaseDetail
        let detailRecoveryStarted
        const detailGate = new Promise((resolve) => { releaseDetail = resolve })
        const started = new Promise((resolve) => { detailRecoveryStarted = resolve })
        const state = createOperatorWorkbenchState({
            async readSummaryPage() {
                summaryReads += 1
                return summary({
                    generation: summaryReads === 1
                        ? "generation-b-fedcba9876543210"
                        : "generation-c-0011223344556677",
                    revision: summaryReads === 1 ? 7 : 8,
                })
            },
            async readOperatorSession() {
                detailReads += 1
                if (detailReads === 2) {
                    detailRecoveryStarted()
                    await detailGate
                }
                return {
                    session: {id: "session-1", transcript: []},
                    parentJob: {...summary().jobs[0], status: "running"},
                }
            },
            async readArtifactPage() {
                return {artifacts: [], nextCursor: null}
            },
        })
        state.initialize(summary())
        state.setVisible(true)
        await state.activateSession("session-1")

        const first = state.ingest("changed", {
            generation: "generation-b-fedcba9876543210",
            revision: 7,
            invalidate: true,
        })
        await started
        const second = state.ingest("changed", {
            generation: "generation-c-0011223344556677",
            revision: 8,
            invalidate: true,
        })
        releaseDetail()
        await Promise.all([first, second])

        assert.equal(summaryReads, 2)
        assert.equal(state.generation, "generation-c-0011223344556677")
        assert.equal(state.revision, 8)
        assert.equal(detailReads, 3)
        assert.equal(state.getSnapshot("job-1").needsDetailCatchUp, false)
    })

    it("defers hidden Job detail recovery until activation and marks it unread", async () => {
        const detailReads = []
        const artifactReads = []
        const state = createOperatorWorkbenchState({
            async readSummaryPage() {
                return summary({
                    revision: 5,
                    sessions: [{id: "session-1"}, {id: "session-2"}],
                    jobs: [
                        {...summary().jobs[0], status: "running"},
                        {...summary().jobs[0], id: "job-2", sessionId: "session-2", status: "running"},
                    ],
                })
            },
            async readOperatorSession(sessionId) {
                detailReads.push(sessionId)
                const jobId = sessionId === "session-1" ? "job-1" : "job-2"
                return {
                    session: {
                        id: sessionId,
                        transcript: [{
                            sessionId,
                            sequence: 9,
                            kind: "message",
                            content: `caught up ${sessionId}`,
                        }],
                    },
                    parentJob: {...summary().jobs[0], id: jobId, sessionId, status: "running"},
                }
            },
            async readArtifactPage(jobId) {
                artifactReads.push(jobId)
                return {
                    artifacts: [{id: `artifact-${jobId}`, jobId, kind: "report", name: "report"}],
                    nextCursor: null,
                }
            },
        })
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2"},
            ],
        }))
        state.setVisible(true)
        await state.activateSession("session-1")
        detailReads.length = 0
        artifactReads.length = 0

        await state.ingest("changed", {
            generation: "generation-a-0123456789abcdef",
            revision: 5,
            invalidate: true,
            job: {...summary().jobs[0], status: "running"},
        })
        assert.deepEqual(detailReads, ["session-1"])
        assert.deepEqual(artifactReads, ["job-1"])
        assert.equal(state.getSnapshot("job-2").needsDetailCatchUp, true)
        assert.equal(state.getSnapshot("job-2").unread.events, 1)

        await state.activateSession("session-2")
        assert.deepEqual(detailReads, ["session-1", "session-2"])
        assert.deepEqual(artifactReads, ["job-1", "job-2"])
        assert.deepEqual(state.getSnapshot("job-2").transcript.map(({content}) => content), [
            "caught up session-2",
        ])
        assert.equal(state.getSnapshot("job-2").needsDetailCatchUp, false)
        assert.deepEqual(state.getSnapshot("job-2").unread, {
            events: 0,
            approvals: 0,
            artifacts: 0,
        })
    })

    it("does not refresh summary pages for contiguous background Job notifications", async () => {
        let reads = 0
        const state = createOperatorWorkbenchState({
            readSummaryPage: async () => {
                reads += 1
                return summary()
            },
        })
        state.initialize(summary())
        for (let revision = 2; revision <= 8; revision += 1) {
            await state.ingest("changed", {
                generation: "generation-a-0123456789abcdef",
                revision,
                invalidate: true,
                job: {...summary().jobs[0], status: "running", revision},
            })
        }
        assert.equal(reads, 0)
    })

    it("keeps composer drafts and scroll positions isolated by parent Job ID", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2"},
            ],
        }))
        state.setViewState("job-1", {draft: "first", scrollTop: 144})
        state.setViewState("job-2", {draft: "second", scrollTop: 9})

        assert.deepEqual(state.getViewState("job-1"), {draft: "first", scrollTop: 144})
        assert.deepEqual(state.getViewState("job-2"), {draft: "second", scrollTop: 9})
    })
})

describe("Operator keyed transcript patcher", () => {
    function entry(id, sequence, content = id) {
        return {id, sequence, kind: "message", role: "assistant", content}
    }

    function fixture() {
        const children = []
        const creates = []
        const updates = []
        const moves = []
        const container = {
            replaceChildren(...nodes) {
                children.splice(0, children.length, ...nodes)
            },
            insertBefore(node, before) {
                const current = children.indexOf(node)
                if (current >= 0) children.splice(current, 1)
                const index = before === null ? children.length : children.indexOf(before)
                children.splice(index < 0 ? children.length : index, 0, node)
                moves.push({node, before})
            },
            append(node) {
                this.insertBefore(node, null)
            },
        }
        const patcher = createKeyedTranscriptPatcher({
            container,
            createNode(key) {
                const node = {key}
                creates.push(node)
                return node
            },
            updateNode(node, value) {
                node.content = value.content
                updates.push(node)
            },
        })
        return {children, creates, updates, moves, patcher}
    }

    it("patches one dirty node in a large transcript without moving unchanged nodes", () => {
        const context = fixture()
        const transcript = Array.from({length: 5_000}, (_unused, index) => (
            entry(`event-${index}`, index, `initial ${index}`)
        ))
        context.patcher.reset(transcript)
        const identities = [...context.children]
        context.creates.length = 0
        context.updates.length = 0
        context.moves.length = 0

        context.patcher.patch([entry("event-2500", 2_500, "updated")])

        assert.equal(context.creates.length, 0)
        assert.equal(context.updates.length, 1)
        assert.equal(context.moves.length, 0)
        assert.deepEqual(context.children, identities)
        assert.equal(context.children[2_500], identities[2_500])
        assert.equal(context.children[2_500].content, "updated")
    })

    it("coalesces the same dirty key and inserts distinct keys in stable order", () => {
        const context = fixture()
        context.patcher.reset([entry("event-10", 10), entry("event-40", 40)])
        const first = context.children[0]
        const last = context.children[1]
        context.creates.length = 0
        context.updates.length = 0
        context.moves.length = 0

        context.patcher.patch([
            entry("event-30", 30),
            entry("event-20", 20, "old"),
            entry("event-20", 20, "new"),
        ])

        assert.deepEqual(context.children.map(({key}) => key), [
            "entry:event-10",
            "entry:event-20",
            "entry:event-30",
            "entry:event-40",
        ])
        assert.equal(context.children[0], first)
        assert.equal(context.children[3], last)
        assert.equal(context.children[1].content, "new")
        assert.equal(context.creates.length, 2)
        assert.equal(context.updates.length, 2)
        assert.equal(transcriptEntryKey(entry("event-20", 20)), "entry:event-20")
    })
})
