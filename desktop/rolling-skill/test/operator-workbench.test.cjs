const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    OPERATOR_ACTIONS,
    OPERATOR_DELTA_INTERVAL_MS,
    artifactDeepLinks,
    buildOperatorSessionRequest,
    createOperatorWorkbenchState,
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
        assert.deepEqual(patches[0].kinds, ["event"])

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
