const assert = require("node:assert/strict")
const fs = require("node:fs")
const {describe, it} = require("node:test")

const {
    AUTOMATIC_OPERATOR_ACTIONS,
    OPERATOR_ACTIONS,
    OPTIONAL_OPERATOR_ACTIONS,
    OPERATOR_DELTA_INTERVAL_MS,
    artifactDeepLinks,
    buildOptimizationConfig,
    buildOperatorSessionRequest,
    createKeyedTranscriptPatcher,
    createOperatorDomListenerScope,
    createOperatorInitializationGate,
    createOperatorMessageSender,
    createOperatorSurfaceGate,
    createOperatorWorkbenchState,
    optimizationPanelView,
    optimizationFinalApproval,
    optimizationFinalApprovalView,
    optimizationPreflightSummary,
    optimizationRunActions,
    operatorStatusText,
    operatorJobTreeIds,
    operatorSessionActions,
    reduceOptimizationTimeline,
    registerOperatorActionDelegates,
    runtimeDisplayParts,
    runtimeDisplayLabel,
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
    it("splits Runtime identity into the same title and path hierarchy used by Skill evaluation", () => {
        assert.deepEqual(runtimeDisplayParts({
            runtimeId: "codex:chatgpt",
            displayName: "Codex",
            version: "0.149.0",
            executablePath: "/Applications/ChatGPT.app/Contents/Resources/codex",
        }), {
            base: "Codex 0.149.0",
            detail: "/Applications/ChatGPT.app/Contents/Resources/codex",
        })
        assert.deepEqual(runtimeDisplayParts({
            runtimeId: "dsh:local",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
        }), {
            base: "DeepSeek Harness 0.1.1-rc.1",
            detail: "dsh:local",
        })
    })

    it("shows the full Runtime identity so every selectable installation is distinguishable", () => {
        const codexA = {
            runtimeId: "codex:a",
            displayName: "Codex",
            version: "0.149.0",
            executablePath: "/Applications/ChatGPT.app/Contents/Resources/codex",
        }
        const codexB = {
            runtimeId: "codex:b",
            displayName: "Codex",
            version: "0.148.0",
            executablePath: "/usr/local/bin/codex",
        }

        assert.equal(
            runtimeDisplayLabel(codexA, [codexA, codexB]),
            "Codex 0.149.0 · /Applications/ChatGPT.app/Contents/Resources/codex",
        )
        assert.equal(
            runtimeDisplayLabel(codexB, [codexA, codexB]),
            "Codex 0.148.0 · /usr/local/bin/codex",
        )

        const duplicateA = {...codexA, runtimeId: "codex:duplicate-a", version: "0.149.0"}
        const duplicateB = {
            ...codexA,
            runtimeId: "codex:duplicate-b",
            version: "0.149.0",
            executablePath: "/opt/codex/bin/codex",
        }
        const duplicates = [duplicateA, duplicateB]
        assert.equal(
            runtimeDisplayLabel(duplicateA, duplicates),
            "Codex 0.149.0 · /Applications/ChatGPT.app/Contents/Resources/codex",
        )
        assert.equal(
            runtimeDisplayLabel(duplicateB, duplicates),
            "Codex 0.149.0 · /opt/codex/bin/codex",
        )
        assert.equal(runtimeDisplayLabel({
            runtimeId: "codex:versioned-name",
            displayName: "Codex 0.149.0",
            version: "0.149.0",
        }), "Codex 0.149.0 · codex:versioned-name")
    })

    it("uses the host translation pipeline for dynamic Job statuses", () => {
        const translate = (key) => ({
            operatorStatusWaitingApproval: "等待审批",
            operatorStatusUnknown: "未知状态",
        })[key] ?? key

        assert.equal(operatorStatusText("waiting_approval", translate), "等待审批")
        assert.equal(operatorStatusText(null, translate), "未知状态")
    })

    it("bounds root approval actions to its persisted Job tree", () => {
        assert.deepEqual([...operatorJobTreeIds({
            job: {id: "job-root", childJobIds: ["job-child"]},
            jobs: [
                {id: "job-root", parentJobId: null, childJobIds: ["job-child"]},
                {id: "job-child", parentJobId: "job-root", children: ["job-grandchild"]},
                {id: "job-grandchild", parentJobId: "job-child", children: []},
                {id: "job-foreign", parentJobId: null, children: []},
            ],
        })], ["job-root", "job-child", "job-grandchild"])
    })

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
            "optimizations.read",
            "optimizations.execute",
        ])
    })

    it("preauthorizes every normal Operator action and keeps permanent deletion optional", () => {
        assert.deepEqual(OPTIONAL_OPERATOR_ACTIONS, ["datasets.delete"])
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("runtime.execute"), true)
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("evaluations.execute"), true)
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("skills.release"), true)
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("rubrics.publish"), true)
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("installations.execute"), true)
        assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("datasets.delete"), false)
        assert.deepEqual(operatorSessionActions(false), AUTOMATIC_OPERATOR_ACTIONS)
        assert.deepEqual(operatorSessionActions(true), [
            ...AUTOMATIC_OPERATOR_ACTIONS,
            "datasets.delete",
        ])
    })

    it("renders only maximum iterations and permanent deletion in the automation boundary", () => {
        const markup = fs.readFileSync(require.resolve("../renderer/index.html"), "utf8")
        assert.doesNotMatch(markup, /id="operator-permission-grants"/u)
        assert.doesNotMatch(markup, /data-operator-budget=/u)
        assert.equal((markup.match(/data-operator-max-iterations/gu) ?? []).length, 1)
        assert.match(markup, /<input[^>]+value="50"[^>]+data-operator-max-iterations[^>]*>/u)
        const risk = markup.match(/<input[^>]+data-operator-risk="datasets\.delete"[^>]*>/u)?.[0]
        assert.ok(risk)
        assert.doesNotMatch(risk, /\schecked(?:\s|=|>)/u)
    })

    it("builds setup requests only from capability-backed Runtime and model catalogs", () => {
        const request = buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            modelId: "model-live-1",
            effort: "high",
            objective: "Improve and evaluate this Skill",
            allowPermanentDelete: false,
            skillId: "skill-1",
            datasetId: "dataset-1",
            targetRuntimeIds: ["runtime-1", "runtime-2"],
            maxIterations: "50",
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
            actions: AUTOMATIC_OPERATOR_ACTIONS,
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["runtime-1", "runtime-2"],
                repositoryIds: ["repository-1"],
            },
            budget: {maxIterations: 50},
            managedSkillBinding: {repositoryId: "repository-1", skillId: "skill-1"},
        })
        assert.throws(() => buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            modelId: "invented-model",
            objective: "Do work",
            allowPermanentDelete: false,
            targetRuntimeIds: [],
            maxIterations: "50",
        }, {
            runtimes: [{runtimeId: "runtime-1"}],
            modelsByRuntime: new Map([["runtime-1", [{id: "model-live-1"}]]]),
            skills: [],
            datasets: [],
        }), /model.*catalog/iu)
        assert.throws(() => buildOperatorSessionRequest({
            runtimeId: "runtime-1",
            objective: "Do work",
            allowPermanentDelete: false,
            targetRuntimeIds: [],
            maxIterations: "0",
        }, {
            runtimes: [{runtimeId: "runtime-1"}],
            modelsByRuntime: new Map([["runtime-1", []]]),
            skills: [],
            datasets: [],
        }), /maxIterations.*positive safe integer/iu)
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

    it("retries the real OPERATOR_SNAPSHOT_CHANGED preload error from page one within bounds", async () => {
        for (const makeError of [
            () => Object.assign(new Error("snapshot changed"), {code: "OPERATOR_SNAPSHOT_CHANGED"}),
            () => new Error("Error invoking remote method: OPERATOR_SNAPSHOT_CHANGED"),
            () => Object.assign(new Error("Error invoking remote method 'operator:summary-page'"), {
                cause: {code: "OPERATOR_SNAPSHOT_CHANGED"},
            }),
        ]) {
            const cursors = []
            let stale = true
            const state = createOperatorWorkbenchState({
                async readSummaryPage(cursor) {
                    cursors.push(cursor)
                    if (cursor === null && stale) return summary({nextCursor: "page-2", truncated: true})
                    if (cursor === "page-2") {
                        stale = false
                        throw makeError()
                    }
                    return summary({revision: 2})
                },
            })
            state.initialize(summary())

            await state.catchUp()

            assert.deepEqual(cursors, [null, "page-2", null])
            assert.equal(state.revision, 2)
        }
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

    it("keeps a late A activation in A cache without selecting or rendering over B", async () => {
        let releaseA
        let startedA
        const gateA = new Promise((resolve) => { releaseA = resolve })
        const enteredA = new Promise((resolve) => { startedA = resolve })
        const state = createOperatorWorkbenchState({
            async readOperatorSession(sessionId) {
                if (sessionId === "session-1") {
                    startedA()
                    await gateA
                }
                const jobId = sessionId === "session-1" ? "job-1" : "job-2"
                return {
                    session: {id: sessionId, transcript: [event(`event-${jobId}`, sessionId, jobId)]},
                    parentJob: {...summary().jobs[0], id: jobId, sessionId},
                }
            },
            async readArtifactPage() {
                return {artifacts: [], nextCursor: null}
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

        const activationA = state.activateSession("session-1")
        await enteredA
        const selectedB = await state.activateSession("session-2")
        releaseA()
        const staleA = await activationA

        assert.equal(selectedB.job.id, "job-2")
        assert.equal(staleA, null)
        assert.equal(state.activeJobId, "job-2")
        assert.equal(state.getSnapshot("job-1").transcript.length, 1)
    })
})

describe("Operator workbench coordination", () => {
    function fakeEventTarget() {
        const listeners = new Map()
        return {
            addEventListener(type, listener) {
                if (!listeners.has(type)) listeners.set(type, new Set())
                listeners.get(type).add(listener)
            },
            removeEventListener(type, listener) {
                listeners.get(type)?.delete(listener)
            },
            dispatch(type, target) {
                for (const listener of listeners.get(type) ?? []) listener({target})
            },
            listenerCount(type) {
                return listeners.get(type)?.size ?? 0
            },
        }
    }

    function fakeActionButton(selector, dataset) {
        const target = fakeEventTarget()
        target.dataset = dataset
        target.closest = (requested) => requested === selector ? target : null
        return target
    }

    it("atomically cleans failed initialization attempts and retries with one bounded listener set", async () => {
        for (const failurePhase of ["bootstrap", "hydrate", "catchUp"]) {
            const listeners = new Map()
            const listenerCount = () => [...listeners.values()].reduce((total, entries) => total + entries.size, 0)
            const emit = (kind, payload) => {
                for (const listener of listeners.get(kind) ?? []) listener(payload)
            }
            const ingested = []
            let attempt = 0
            let releaseBootstrap
            let bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve })
            const lifecycle = createOperatorInitializationGate({
                subscribe(kind, listener) {
                    if (!listeners.has(kind)) listeners.set(kind, new Set())
                    listeners.get(kind).add(listener)
                    return () => {
                        const entries = listeners.get(kind)
                        entries?.delete(listener)
                        if (!entries?.size) listeners.delete(kind)
                    }
                },
                async bootstrap() {
                    attempt += 1
                    if (failurePhase === "bootstrap" && attempt === 1) throw new Error("bootstrap failed")
                    return bootstrapGate
                },
                hydrate: async () => {
                    if (failurePhase === "hydrate" && attempt === 1) throw new Error("hydrate failed")
                },
                ingest: async (kind, payload) => { ingested.push([kind, payload.index]) },
                catchUp: async () => {
                    if (failurePhase === "catchUp" && attempt === 1) throw new Error("catch-up failed")
                },
            })

            if (failurePhase !== "bootstrap") releaseBootstrap(summary())
            const first = lifecycle.initialize()
            for (let index = 0; index < 300; index += 1) {
                emit("event", {index})
            }
            await assert.rejects(first, new RegExp(`${failurePhase.replace("Up", "-up")} failed`, "iu"))
            assert.equal(listenerCount(), 0)
            ingested.length = 0

            bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve })
            const second = lifecycle.initialize()
            assert.equal(listenerCount(), 4)
            for (let index = 300; index < 600; index += 1) {
                emit("event", {index})
            }
            releaseBootstrap(summary())
            await second

            assert.equal(attempt, 2)
            assert.equal(listenerCount(), 4)
            assert.equal(ingested.length, 256)
            assert.equal(ingested[0][1], 344)
            lifecycle.destroy()
            assert.equal(listenerCount(), 0)
        }
    })

    it("subscribes before bootstrap, flushes the initialization window, and cleans up on destroy", async () => {
        let releaseBootstrap
        const bootstrapGate = new Promise((resolve) => { releaseBootstrap = resolve })
        const listeners = new Map()
        let catchUps = 0
        let renders = 0
        const state = createOperatorWorkbenchState()
        const lifecycle = createOperatorInitializationGate({
            subscribe(kind, listener) {
                listeners.set(kind, listener)
                return () => listeners.delete(kind)
            },
            bootstrap: () => bootstrapGate,
            applyBootstrap(page) {
                state.initialize(page)
                renders += 1
            },
            hydrate: async () => {},
            ingest: (kind, envelope) => state.ingest(kind, envelope),
            catchUp: async () => { catchUps += 1 },
        })

        const initializing = lifecycle.initialize()
        assert.deepEqual([...listeners.keys()], ["changed", "event", "approval", "artifact"])
        listeners.get("changed")({
            generation: "generation-a-0123456789abcdef",
            revision: 2,
            job: {...summary().jobs[0], status: "paused"},
        })
        releaseBootstrap(summary())
        await initializing

        assert.equal(state.getSnapshot("job-1").job.status, "paused")
        assert.equal(catchUps, 1)
        assert.equal(renders, 1)

        let releaseDestroyedBootstrap
        const destroyedBootstrap = new Promise((resolve) => { releaseDestroyedBootstrap = resolve })
        const destroyedListeners = new Map()
        let destroyedDomWrites = 0
        const destroyed = createOperatorInitializationGate({
            subscribe(kind, listener) {
                destroyedListeners.set(kind, listener)
                return () => destroyedListeners.delete(kind)
            },
            bootstrap: () => destroyedBootstrap,
            applyBootstrap() { destroyedDomWrites += 1 },
            hydrate: async () => { destroyedDomWrites += 1 },
            ingest: async () => { destroyedDomWrites += 1 },
            catchUp: async () => { destroyedDomWrites += 1 },
        })
        const abandoned = destroyed.initialize()
        destroyed.destroy()
        releaseDestroyedBootstrap(summary())
        await abandoned
        assert.equal(destroyedListeners.size, 0)
        assert.equal(destroyedDomWrites, 0)
    })

    it("freezes the sending Job and restores or clears only that Job draft", async () => {
        const state = createOperatorWorkbenchState()
        state.initialize(summary({
            sessions: [{id: "session-1"}, {id: "session-2"}],
            jobs: [
                summary().jobs[0],
                {...summary().jobs[0], id: "job-2", sessionId: "session-2"},
            ],
        }))
        state.setViewState("job-1", {draft: "send A"})
        state.setViewState("job-2", {draft: "draft B"})
        const pending = []
        const sender = createOperatorMessageSender({
            state,
            send(sessionId, text, sendId) {
                return new Promise((resolve, reject) => pending.push({sessionId, text, sendId, resolve, reject}))
            },
        })

        const sent = sender.send({jobId: "job-1", sessionId: "session-1", text: "send A"})
        assert.match(pending[0].sendId, /^operator-send-/u)
        state.setVisible(true)
        await state.activateSession("session-2")
        pending[0].resolve({queued: true})
        await sent
        assert.deepEqual(state.getViewState("job-1"), {draft: "", scrollTop: 0})
        assert.equal(state.getViewState("job-2").draft, "draft B")

        state.setViewState("job-1", {draft: "retry A"})
        const failed = sender.send({jobId: "job-1", sessionId: "session-1", text: "retry A"})
        pending[1].reject(new Error("send failed"))
        await assert.rejects(failed, /send failed/)
        assert.equal(state.getViewState("job-1").draft, "retry A")
        assert.equal(state.getViewState("job-2").draft, "draft B")
    })

    it("makes repeated visibility and structural catalog updates DOM-idempotent", async () => {
        let rootHidden = false
        let reads = 0
        let rebuilds = 0
        let domIdentity = {}
        const gate = createOperatorSurfaceGate({
            initialVisible: true,
            setStateVisible() {},
            setRootHidden(hidden) { rootHidden = hidden },
            recover: async () => { reads += 1 },
            applyCatalogs() {
                rebuilds += 1
                domIdentity = {}
            },
            render() {},
        })
        const catalog = {runtimes: [{runtimeId: "runtime-1"}], skills: [], datasets: []}
        gate.setCatalogs(catalog)
        const initialIdentity = domIdentity
        gate.setCatalogs(structuredClone(catalog))
        await gate.setVisible(true)
        assert.equal(rootHidden, false)
        assert.equal(reads, 0)
        assert.equal(rebuilds, 1)
        assert.equal(domIdentity, initialIdentity)

        await gate.setVisible(false)
        gate.setCatalogs({...catalog, datasets: [{id: "dataset-1"}]})
        gate.setCatalogs({...catalog, datasets: [{id: "dataset-1"}]})
        assert.equal(rebuilds, 1)
        await gate.setVisible(false)
        await gate.setVisible(true)
        assert.equal(rootHidden, false)
        assert.equal(reads, 1)
        assert.equal(rebuilds, 2)
    })

    it("retries a failed show, singleflights concurrent shows, and ignores late recovery after hide", async () => {
        let rootHidden = true
        let reads = 0
        let fail = true
        let releaseRecovery
        let recoveryGate = Promise.resolve()
        const gate = createOperatorSurfaceGate({
            initialVisible: false,
            setStateVisible() {},
            setRootHidden(hidden) { rootHidden = hidden },
            recover() {
                reads += 1
                if (fail) throw new Error("temporary recovery failure")
                return recoveryGate
            },
            render() {},
        })

        await assert.rejects(gate.setVisible(true), /temporary recovery failure/u)
        assert.equal(rootHidden, true)
        fail = false
        recoveryGate = new Promise((resolve) => { releaseRecovery = resolve })
        const firstRetry = gate.setVisible(true)
        const concurrentRetry = gate.setVisible(true)
        assert.equal(reads, 2)
        releaseRecovery()
        assert.equal(await firstRetry, true)
        assert.equal(await concurrentRetry, true)
        assert.equal(rootHidden, false)

        await gate.setVisible(false)
        recoveryGate = new Promise((resolve) => { releaseRecovery = resolve })
        const lateShow = gate.setVisible(true)
        await gate.setVisible(false)
        releaseRecovery()
        assert.equal(await lateShow, false)
        assert.equal(rootHidden, true)
        assert.equal(reads, 3)
    })

    it("removes every scoped DOM handler on destroy and a replacement fires only once", () => {
        const target = new EventTarget()
        const effects = {api: 0, state: 0, dom: 0}
        const first = createOperatorDomListenerScope()
        first.listen(target, "operator", () => {
            effects.api += 1
            effects.state += 1
            effects.dom += 1
        })
        first.destroy()
        target.dispatchEvent(new Event("operator"))
        assert.deepEqual(effects, {api: 0, state: 0, dom: 0})

        const replacement = createOperatorDomListenerScope()
        replacement.listen(target, "operator", () => { effects.api += 1 })
        target.dispatchEvent(new Event("operator"))
        assert.deepEqual(effects, {api: 1, state: 0, dom: 0})
        replacement.destroy()
    })

    it("keeps dynamic action rendering listener-free with only three fixed delegated listeners", () => {
        const source = fs.readFileSync(require.resolve("../renderer/operator-workbench.js"), "utf8")
        const dynamicRender = source.slice(
            source.indexOf("function patchStatus"),
            source.indexOf("function patchActiveChrome"),
        )
        assert.doesNotMatch(dynamicRender, /\.listen\(|addEventListener\(/u)

        const containers = {
            artifacts: fakeEventTarget(),
            approvals: fakeEventTarget(),
            sessionActions: fakeEventTarget(),
        }
        const scope = createOperatorDomListenerScope()
        registerOperatorActionDelegates({
            listen: scope.listen,
            containers,
            getActiveSnapshot: () => null,
        })
        assert.equal(scope.registrationCount, 3)
        for (let index = 0; index < 10_000; index += 1) {
            const oldButton = fakeActionButton("[data-operator-entity-kind]", {operatorEntityKind: "dataset"})
            assert.equal(oldButton.listenerCount("click"), 0)
        }
        assert.equal(scope.registrationCount, 3)

        scope.destroy()
        const replacement = createOperatorDomListenerScope()
        registerOperatorActionDelegates({
            listen: replacement.listen,
            containers,
            getActiveSnapshot: () => null,
        })
        assert.equal(replacement.registrationCount, 3)
        assert.deepEqual(Object.values(containers).map((target) => target.listenerCount("click")), [1, 1, 1])
        replacement.destroy()
    })

    it("delegates only current validated artifact, approval, and session actions", async () => {
        const containers = {
            artifacts: fakeEventTarget(),
            approvals: fakeEventTarget(),
            sessionActions: fakeEventTarget(),
        }
        let snapshot = {
            job: {id: "job-1", status: "running", childJobIds: ["job-child"]},
            jobs: [
                {id: "job-1", parentJobId: null, childJobIds: ["job-child"]},
                {id: "job-child", parentJobId: "job-1", childJobIds: []},
                {id: "job-foreign", parentJobId: null, childJobIds: []},
            ],
            artifacts: [{id: "artifact-new", metadata: {datasetId: "dataset-new"}}],
            approvals: [
                {id: "approval-1", jobId: "job-child", status: "pending"},
                {id: "approval-2", jobId: "job-1", status: "pending"},
                {id: "approval-foreign", jobId: "job-foreign", status: "pending"},
            ],
        }
        const calls = []
        const scope = createOperatorDomListenerScope()
        registerOperatorActionDelegates({
            listen: scope.listen,
            containers,
            getActiveSnapshot: () => snapshot,
            onSelectEntity: (...args) => calls.push(["entity", ...args]),
            onResolveApproval: (...args) => calls.push(["approval", ...args]),
            onApproveCurrentJob: (...args) => calls.push(["approve-job", ...args]),
            onControlJob: (...args) => calls.push(["control", ...args]),
        })

        const artifactSelector = "[data-operator-entity-kind][data-operator-entity-id][data-operator-artifact-id]"
        containers.artifacts.dispatch("click", fakeActionButton(artifactSelector, {
            operatorEntityKind: "dataset",
            operatorEntityId: "dataset-new",
            operatorArtifactId: "artifact-new",
        }))
        containers.artifacts.dispatch("click", fakeActionButton(artifactSelector, {
            operatorEntityKind: "dataset",
            operatorEntityId: "dataset-old",
            operatorArtifactId: "artifact-old",
        }))
        containers.artifacts.dispatch("click", fakeActionButton(artifactSelector, {
            operatorEntityKind: "case",
            operatorEntityId: "forged-case",
            operatorArtifactId: "artifact-new",
        }))

        const approvalSelector = "[data-operator-approval-decision][data-operator-approval-id][data-operator-job-id]"
        const approvalButton = fakeActionButton(approvalSelector, {
            operatorApprovalDecision: "approve",
            operatorApprovalId: "approval-1",
            operatorJobId: "job-1",
        })
        containers.approvals.dispatch("click", approvalButton)
        const approveJobSelector = "[data-operator-approve-job]"
        containers.approvals.dispatch("click", fakeActionButton(approveJobSelector, {
            operatorApproveJob: "job-1",
        }))
        snapshot.approvals[0].status = "approved"
        containers.approvals.dispatch("click", approvalButton)
        containers.approvals.dispatch("click", fakeActionButton(approvalSelector, {
            operatorApprovalDecision: "approve",
            operatorApprovalId: "forged",
            operatorJobId: "job-1",
        }))
        containers.approvals.dispatch("click", fakeActionButton(approvalSelector, {
            operatorApprovalDecision: "approve",
            operatorApprovalId: "approval-foreign",
            operatorJobId: "job-1",
        }))

        containers.approvals.dispatch("click", fakeActionButton(approveJobSelector, {
            operatorApproveJob: "job-1",
        }))
        const sessionSelector = "[data-operator-job-action][data-operator-job-id]"
        const pauseButton = fakeActionButton(sessionSelector, {
            operatorJobAction: "pause",
            operatorJobId: "job-1",
        })
        containers.sessionActions.dispatch("click", pauseButton)
        containers.sessionActions.dispatch("click", fakeActionButton(sessionSelector, {
            operatorJobAction: "resume",
            operatorJobId: "job-1",
        }))
        snapshot.job.status = "paused"
        containers.sessionActions.dispatch("click", pauseButton)

        await new Promise((resolve) => setImmediate(resolve))
        assert.deepEqual(calls.map((entry) => entry.slice(0, 3)), [
            ["entity", "dataset", "dataset-new"],
            ["approval", "approval-1", "approve"],
            ["approve-job", "job-1"],
            ["control", "job-1", "pause"],
        ])
        scope.destroy()
    })
})

describe("multi-Epoch Optimization workbench", () => {
    function catalogs() {
        return {
            runtimes: [
                {
                    runtimeId: "codex:operator",
                    capabilities: ["token-usage", "cost-usage"],
                    models: [{id: "gpt-5.6-sol", reasoningEfforts: ["high"]}],
                },
                {
                    runtimeId: "codebuddy:target",
                    capabilities: ["token-usage", "cost-usage"],
                    models: [{id: "claude-sonnet", reasoningEfforts: ["medium"]}],
                },
            ],
            skills: [{id: "skill-1", repositoryId: "repository-1", status: "valid"}],
            versions: [{
                id: "released-1",
                skillId: "skill-1",
                repositoryId: "repository-1",
                state: "released",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
            }],
            datasets: [{
                id: "dataset-1",
                activeRubricVersionId: "rubric-1",
                skillReference: {id: "skill-1", repositoryId: "repository-1"},
            }],
        }
    }

    function values() {
        return {
            skillId: "skill-1",
            baselineVersionId: "released-1",
            datasetId: "dataset-1",
            operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
            targets: [{runtimeId: "codebuddy:target", modelId: "claude-sonnet", effort: "medium"}],
            judge: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
            activationMode: "automatic",
            mode: "adaptive",
            limits: {
                maxEpochs: "5",
                maxDurationMs: "7200000",
                patience: "2",
                minimumImprovement: "1",
                maxTurns: "50",
                maxTokens: "100000",
                maxCostMicros: "5000000",
            },
            target: {minimumScore: "90", minimumPassRate: "0.95", requireCriticalCases: true},
        }
    }

    it("builds a frozen optimization config only from matching Released, Dataset, model, and telemetry catalogs", () => {
        assert.deepEqual(buildOptimizationConfig(values(), catalogs()), {
            skillId: "skill-1",
            baselineVersionId: "released-1",
            datasetId: "dataset-1",
            operator: values().operator,
            targets: values().targets,
            judge: values().judge,
            activationMode: "automatic",
            mode: "adaptive",
            limits: {
                maxEpochs: 5,
                maxDurationMs: 7_200_000,
                patience: 2,
                minimumImprovement: 1,
                maxTurns: 50,
                maxTokens: 100_000,
                maxCostMicros: 5_000_000,
            },
            target: {minimumScore: 90, minimumPassRate: 0.95, requireCriticalCases: true},
            telemetry: {tokens: true, cost: true},
        })

        const wrongDataset = catalogs()
        wrongDataset.datasets[0].skillReference.id = "skill-other"
        assert.throws(() => buildOptimizationConfig(values(), wrongDataset), /Dataset.*Skill|binding/iu)
        const candidateBaseline = catalogs()
        candidateBaseline.versions[0].state = "candidate"
        assert.throws(() => buildOptimizationConfig(values(), candidateBaseline), /Released/iu)
        const unsupportedTelemetry = catalogs()
        unsupportedTelemetry.runtimes[1].capabilities = []
        assert.throws(
            () => buildOptimizationConfig(values(), unsupportedTelemetry),
            /token.*telemetry|telemetry.*Runtime/iu,
        )
    })

    it("reduces revisioned Epoch summaries into a stable score trend without accepting stale updates", () => {
        const first = reduceOptimizationTimeline(null, {
            id: "optimization-1",
            revision: 4,
            state: "evaluating",
            currentEpoch: 2,
            checkpoint: {},
            epochs: [
                {number: 1, status: "completed", analysis: {score: 80, passRate: 0.75, scoreDelta: 5, regressionCount: 1}},
                {number: 2, status: "evaluating", installations: [{runtimeId: "codex:target", status: "succeeded"}]},
            ],
        })
        const stale = reduceOptimizationTimeline(first, {
            id: "optimization-1",
            revision: 3,
            state: "editing",
            currentEpoch: 1,
            checkpoint: {},
            epochs: [],
        })
        const completed = reduceOptimizationTimeline(stale, {
            id: "optimization-1",
            revision: 5,
            state: "deciding",
            currentEpoch: 2,
            checkpoint: {stopReason: "target_achieved"},
            epochs: [
                {number: 1, status: "completed", analysis: {score: 80, passRate: 0.75, scoreDelta: 5, regressionCount: 1}},
                {number: 2, status: "succeeded", analysis: {score: 92, passRate: 1, scoreDelta: 12, regressionCount: 0}},
            ],
        })

        assert.equal(stale, first)
        assert.deepEqual(completed.scoreTrend, [
            {epoch: 1, score: 80, passRate: 0.75},
            {epoch: 2, score: 92, passRate: 1},
        ])
        assert.equal(completed.epochs[1].analysis.regressionCount, 0)
        assert.equal(completed.stopReason, "target_achieved")
    })

    it("disables forward actions while restoring and exposes exact recovery targets", () => {
        const recovering = reduceOptimizationTimeline(null, {
            id: "optimization-1",
            revision: 9,
            state: "needs_recovery",
            currentEpoch: 2,
            checkpoint: {
                recoveryTargets: [{
                    runtimeId: "codebuddy:target",
                    status: "needs_recovery",
                    installationJobId: "install-9",
                    lastVerifiedDigest: `sha256:${"c".repeat(64)}`,
                }],
            },
            epochs: [],
        })

        assert.deepEqual(optimizationRunActions({state: "restoring", checkpoint: {}}), ["report"])
        assert.deepEqual(optimizationRunActions({state: "waiting_approval", checkpoint: {}}), ["report"])
        assert.deepEqual(optimizationRunActions(recovering), ["report"])
        assert.deepEqual(optimizationRunActions({
            state: "needs_recovery",
            checkpoint: {paused: true},
        }), ["resume", "stop", "report"])
        assert.equal(recovering.recoveryTargets[0].installationJobId, "install-9")
        assert.match(recovering.recoveryTargets[0].lastVerifiedDigest, /^sha256:/u)
    })

    it("summarizes frozen preflight evidence and experiment approval boundaries", () => {
        const config = buildOptimizationConfig(values(), catalogs())
        const summary = optimizationPreflightSummary({
            ready: true,
            snapshotDigest: `sha256:${"d".repeat(64)}`,
            baseline: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "released-1",
                contentDigest: `sha256:${"b".repeat(64)}`,
            },
            dataset: {id: "dataset-1", revision: 7, digest: `sha256:${"e".repeat(64)}`},
            rubric: {id: "rubric-1", version: 4, digest: `sha256:${"f".repeat(64)}`},
            targets: config.targets,
        }, config)

        assert.equal(summary.ready, true)
        assert.deepEqual(summary.frozen, {
            snapshotDigest: `sha256:${"d".repeat(64)}`,
            baselineVersionId: "released-1",
            baselineDigest: `sha256:${"b".repeat(64)}`,
            datasetId: "dataset-1",
            datasetRevision: 7,
            rubricId: "rubric-1",
            rubricVersion: 4,
        })
        assert.deepEqual(summary.telemetry, {tokens: true, cost: true})
        assert.deepEqual(summary.approvals, [
            "candidate-experiment-install",
            "release-install",
        ])
    })

    it("selects the one persisted release-install approval for the optimization detail", () => {
        const pending = {
            id: "approval-final-1",
            jobId: "job-1",
            status: "pending",
            action: "optimization.release-install",
        }
        assert.equal(optimizationFinalApproval({job: {id: "job-1"}, approvals: [pending]}).id, pending.id)
        assert.equal(optimizationFinalApproval({
            job: {id: "job-1"},
            approvals: [{...pending, status: "approved"}],
        }), null)
    })

    it("presents the Candidate, evaluation, target Runtimes, and risk beside the final decision", () => {
        const view = optimizationFinalApprovalView({
            currentEpoch: 2,
            targets: [
                {runtimeId: "codex:target"},
                {runtimeId: "dsh:target"},
            ],
            epochs: [{
                number: 2,
                candidate: {versionId: "candidate-v2"},
                analysis: {score: 93, passRate: 1, regressionCount: 0},
            }],
            checkpoint: {},
        }, {
            id: "approval-final-1",
            risk: "Release and install this Candidate on every frozen target Runtime",
        })

        assert.deepEqual(view, {
            approvalId: "approval-final-1",
            candidateVersionId: "candidate-v2",
            score: 93,
            passRate: 1,
            regressionCount: 0,
            runtimeIds: ["codex:target", "dsh:target"],
            risk: "Release and install this Candidate on every frozen target Runtime",
        })
    })

    it("derives live Epoch, regression, remaining-budget, stop, and recovery panel state", () => {
        const timeline = reduceOptimizationTimeline(null, {
            id: "optimization-1",
            revision: 12,
            state: "needs_recovery",
            currentEpoch: 2,
            baseline: {versionId: "released-1", contentDigest: `sha256:${"b".repeat(64)}`},
            dataset: {id: "dataset-1", revision: 7},
            rubric: {id: "rubric-1", version: 4},
            limits: {maxDurationMs: 10_000, maxTurns: 20, maxTokens: 1_000, maxCostMicros: 5_000},
            epochs: [{
                number: 2,
                status: "failed",
                candidate: {versionId: "candidate-2"},
                installations: [{runtimeId: "codebuddy:target", status: "needs_recovery", installationJobId: "install-2"}],
                analysis: {score: 86, passRate: 0.8, regressionCount: 3},
            }],
            checkpoint: {
                stopReason: "broad_regression",
                telemetry: {elapsedMs: 4_000, turnsUsed: 8, tokens: 600, costMicros: 2_000},
                reportArtifactId: "report-1",
                finalApprovalId: "final-approval-1",
                releasedInstallArtifactId: "released-install-1",
                recoveryTargets: [{
                    runtimeId: "codebuddy:target",
                    status: "needs_recovery",
                    installationJobId: "install-restore-2",
                    lastVerifiedDigest: `sha256:${"c".repeat(64)}`,
                }],
            },
        })

        const panel = optimizationPanelView(timeline)
        assert.deepEqual(panel.remaining, {
            durationMs: 6_000,
            turns: 12,
            tokens: 400,
            costMicros: 3_000,
        })
        assert.equal(panel.regressionCount, 3)
        assert.equal(panel.stopReason, "broad_regression")
        assert.equal(panel.reportArtifactId, "report-1")
        assert.deepEqual(panel.release, {
            approvalId: "final-approval-1",
            releasedVersionId: null,
            installArtifactId: "released-install-1",
        })
        assert.deepEqual(panel.actions, ["report"])
        assert.equal(panel.recoveryTargets[0].installationJobId, "install-restore-2")
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
