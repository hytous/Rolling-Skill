const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    OperatorJobEngine,
    preflightOperatorBudget,
} = require("../src/operator/job-engine.cjs")
const {OperatorJobStore} = require("../src/operator/job-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-operator-engine-"))
    temporaryDirectories.push(root)
    const path = join(root, "private", "operator-jobs.json")
    const store = new OperatorJobStore(path)
    const session = store.createSession({
        runtime: {
            runtimeId: "codex:operator",
            providerId: "codex",
            displayName: "Codex Operator",
            version: "1.0.0",
            executablePath: "/usr/local/bin/codex",
        },
        modelId: "gpt-5.6-sol",
        effort: "high",
        protocol: "rolling-skill-operator/v1",
        capabilityId: "capability-1",
    })
    return {root, path, store, session}
}

function budget(overrides = {}) {
    return {
        maxDurationMs: 60_000,
        maxRuntimeTurns: 20,
        maxEvaluations: 4,
        maxTargetExecutions: 20,
        maxJudgeExecutions: 20,
        maxTokens: null,
        maxReportedCost: null,
        ...overrides,
    }
}

function createJob(store, sessionId, overrides = {}) {
    return store.createJob({
        sessionId,
        type: "operator",
        objective: "Improve the billing Skill",
        budget: budget(),
        ...overrides,
    })
}

function createUncertainStep(store, job, request) {
    store.transitionJob(job.id, "running")
    const step = store.createStep(job.id, request)
    return store.transitionStep(step.id, "running")
}

describe("Operator Job engine", () => {
    it("schedules child Jobs and executes one persisted Step exactly once before and after restart", async () => {
        const {path, store, session} = fixture()
        const parent = createJob(store, session.id)
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.read": async ({params, idempotencyKey, stepId}) => {
                    calls += 1
                    assert.equal(store.getStep(stepId).status, "running")
                    assert.equal(idempotencyKey, "read-dataset-1")
                    return {dataset: {id: params.datasetId, revision: 3}}
                },
            },
        })
        const child = engine.scheduleChild(parent.id, {
            type: "evaluation",
            objective: "Evaluate candidate",
            budget: budget({maxEvaluations: 1}),
        })
        assert.equal(child.parentJobId, parent.id)
        assert.deepEqual(store.getJob(parent.id).children, [child.id])

        const request = {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "read-dataset-1",
            reservation: {runtimeTurns: 1},
        }
        const first = await engine.execute(parent.id, request)
        const duplicate = await engine.execute(parent.id, request)
        assert.equal(first.status, "succeeded")
        assert.deepEqual(first.result, {dataset: {id: "dataset-1", revision: 3}})
        assert.deepEqual(duplicate.result, first.result)
        assert.equal(calls, 1)
        assert.equal(store.listSteps({jobId: parent.id}).length, 1)
        assert.equal(
            store.listEvents(parent.id).filter((event) => event.kind === "operator_budget_reserved").length,
            1,
        )
        await assert.rejects(() => engine.execute(parent.id, {
            ...request,
            params: {datasetId: "dataset-2"},
        }), /idempotency.*different|conflict/iu)

        const restartedStore = new OperatorJobStore(path)
        const restarted = new OperatorJobEngine({
            store: restartedStore,
            handlers: {"datasets.read": async () => { calls += 1 }},
        })
        const afterRestart = await restarted.execute(parent.id, request)
        assert.deepEqual(afterRestart.result, first.result)
        assert.equal(calls, 1)
    })

    it("persists a frozen approval request and executes approve, reject, and expiry decisions", async () => {
        const {store, session} = fixture()
        const releaseJob = createJob(store, session.id)
        const releaseCalls = []
        let clock = Date.now()
        const engine = new OperatorJobEngine({
            store,
            now: () => clock,
            approvalTtlMs: 1_000,
            handlers: {
                "skills.release": async ({params}) => {
                    releaseCalls.push(params)
                    return {released: params.versionId, tag: params.versionLabel}
                },
                "installations.start": async () => ({installationId: "installation-1"}),
            },
        })
        const params = {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"}
        const waiting = await engine.execute(releaseJob.id, {
            method: "skills.release",
            params,
            idempotencyKey: "release-candidate-1",
        })
        params.versionId = "tampered"
        assert.equal(waiting.status, "waiting_approval")
        assert.equal(store.getJob(releaseJob.id).status, "waiting_approval")
        assert.deepEqual(store.getApproval(waiting.approvalId).proposedMutation, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-candidate-1",
            reservation: {},
        })
        assert.equal((await engine.execute(releaseJob.id, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-candidate-1",
        })).approvalId, waiting.approvalId)

        const approved = await engine.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
            decidedBy: "user-1",
        })
        assert.equal(approved.status, "succeeded")
        assert.deepEqual(releaseCalls, [{
            skillId: "skill-1",
            versionId: "candidate-1",
            versionLabel: "v1.1.0",
        }])

        const rejectedJob = createJob(store, session.id)
        const rejectedWaiting = await engine.execute(rejectedJob.id, {
            method: "installations.start",
            params: {skillId: "skill-1", runtimeId: "runtime-1"},
            idempotencyKey: "install-1",
        })
        const rejected = await engine.resolveApproval(rejectedWaiting.approvalId, {
            decision: "reject",
            scope: "action",
        })
        assert.equal(rejected.status, "failed")
        assert.equal(store.getStep(rejected.stepId).error.code, "APPROVAL_REJECTED")
        assert.equal(store.getJob(rejectedJob.id).status, "running")

        const expiredJob = createJob(store, session.id)
        const expiredWaiting = await engine.execute(expiredJob.id, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "release-candidate-2",
        })
        clock += 1_001
        const expired = await engine.expireApprovals(expiredJob.id)
        assert.deepEqual(expired.map((entry) => entry.approvalId), [expiredWaiting.approvalId])
        assert.equal(store.getApproval(expiredWaiting.approvalId).status, "rejected")
        assert.equal(store.getStep(expiredWaiting.stepId).error.code, "APPROVAL_EXPIRED")
    })

    it("resolves a durable mutation approval after restart without replaying its idempotency key", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        let releaseCalls = 0
        const request = {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-after-restart",
        }
        const firstEngine = new OperatorJobEngine({
            store,
            handlers: {"skills.release": async () => { releaseCalls += 1; return {released: true} }},
        })
        const waiting = await firstEngine.execute(job.id, request)
        assert.equal((await firstEngine.execute(job.id, request)).approvalId, waiting.approvalId)

        const restartedStore = new OperatorJobStore(path)
        const restartedEngine = new OperatorJobEngine({
            store: restartedStore,
            handlers: {"skills.release": async () => { releaseCalls += 1; return {released: true} }},
        })
        assert.equal((await restartedEngine.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
        })).status, "succeeded")
        assert.equal(releaseCalls, 1)

        const secondRestart = new OperatorJobStore(path)
        const finalEngine = new OperatorJobEngine({
            store: secondRestart,
            handlers: {"skills.release": async () => { releaseCalls += 1 }},
        })
        assert.deepEqual((await finalEngine.execute(job.id, request)).result, {released: true})
        assert.equal(releaseCalls, 1)
    })

    it("resumes an approval decision persisted immediately before a process interruption", async () => {
        const approvedFixture = fixture()
        const approvedJob = createJob(approvedFixture.store, approvedFixture.session.id)
        const request = {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "approval-crash-approved",
        }
        const beforeCrash = new OperatorJobEngine({store: approvedFixture.store})
        const waiting = await beforeCrash.execute(approvedJob.id, request)
        approvedFixture.store.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
            decidedBy: "user-1",
        })

        let releaseCalls = 0
        const approvedStore = new OperatorJobStore(approvedFixture.path)
        const resumed = new OperatorJobEngine({
            store: approvedStore,
            handlers: {"skills.release": async () => { releaseCalls += 1; return {released: true} }},
        })
        assert.equal((await resumed.execute(approvedJob.id, request)).status, "succeeded")
        assert.equal(releaseCalls, 1)
        assert.equal(approvedStore.getJob(approvedJob.id).status, "running")

        const rejectedFixture = fixture()
        const rejectedJob = createJob(rejectedFixture.store, rejectedFixture.session.id)
        const rejectedRequest = {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "approval-crash-rejected",
        }
        const rejectedBeforeCrash = new OperatorJobEngine({store: rejectedFixture.store})
        const rejectedWaiting = await rejectedBeforeCrash.execute(rejectedJob.id, rejectedRequest)
        rejectedFixture.store.resolveApproval(rejectedWaiting.approvalId, {
            decision: "reject",
            scope: "action",
            decidedBy: "user-1",
        })
        const rejectedStore = new OperatorJobStore(rejectedFixture.path)
        const rejectedResumed = new OperatorJobEngine({store: rejectedStore})
        const rejected = await rejectedResumed.execute(rejectedJob.id, rejectedRequest)
        assert.equal(rejected.status, "failed")
        assert.equal(rejected.error.code, "APPROVAL_REJECTED")
        assert.equal(rejectedStore.getJob(rejectedJob.id).status, "running")
    })

    it("restarts pre-invoke pending and partially-created approval Steps deterministically", async () => {
        for (const phase of ["pending", "step_waiting", "job_waiting"]) {
            const {path, store, session} = fixture()
            const job = createJob(store, session.id, {objective: phase})
            store.transitionJob(job.id, "running")
            let step = store.createStep(job.id, {
                method: "skills.release",
                params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
                reservation: {},
                idempotencyKey: `release-${phase}`,
            })
            if (phase !== "pending") step = store.transitionStep(step.id, "waiting_approval")
            if (phase === "job_waiting") store.transitionJob(job.id, "waiting_approval")

            const restartedStore = new OperatorJobStore(path)
            const restartedEngine = new OperatorJobEngine({store: restartedStore})
            const result = await restartedEngine.execute(job.id, {
                method: "skills.release",
                params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
                idempotencyKey: `release-${phase}`,
            })
            assert.equal(result.status, "waiting_approval")
            assert.equal(result.stepId, step.id)
            assert.equal(restartedStore.getJob(job.id).status, "waiting_approval")
            assert.equal(restartedStore.getStep(step.id).status, "waiting_approval")
            assert.equal(restartedStore.listApprovals(job.id).length, 1)
        }
    })

    it("reserves every hard budget dimension durably and gates token/cost limits on telemetry", async () => {
        const {store, session} = fixture()
        const unsupported = preflightOperatorBudget(
            budget({maxTokens: 100, maxReportedCost: 2.5}),
            [{runtimeId: "runtime-1", tokens: true, cost: true}, {runtimeId: "runtime-2", tokens: false, cost: true}],
        )
        assert.equal(unsupported.fields.maxDurationMs.status, "supported")
        assert.equal(unsupported.fields.maxTokens.status, "unsupported")
        assert.equal(unsupported.fields.maxReportedCost.status, "supported")
        assert.equal(unsupported.valid, false)
        assert.equal(preflightOperatorBudget(
            budget({maxTokens: 100}),
            [{runtimeId: "runtime-1", tokens: true, cost: true}],
            ["runtime-1", "runtime-2"],
        ).fields.maxTokens.status, "unsupported")
        const supported = preflightOperatorBudget(
            budget({maxTokens: 100, maxReportedCost: 2.5}),
            [{runtimeId: "runtime-1", tokens: true, cost: true}],
        )
        assert.equal(supported.valid, true)

        const job = createJob(store, session.id, {budget: budget({
            maxRuntimeTurns: 1,
            maxEvaluations: 1,
            maxTargetExecutions: 2,
            maxJudgeExecutions: 1,
            maxTokens: 100,
            maxReportedCost: 2.5,
        })})
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            runtimeTelemetry: [{runtimeId: "runtime-1", tokens: true, cost: true}],
            handlers: {"evaluations.start": async () => { calls += 1; return {runId: "run-1"} }},
            approvalDecider: () => ({decision: "allow"}),
        })
        const first = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {datasetId: "dataset-1", runtimeId: "runtime-1"},
            idempotencyKey: "evaluation-1",
            reservation: {
                runtimeTurns: 1,
                evaluations: 1,
                targetExecutions: 2,
                judgeExecutions: 1,
                tokens: 100,
                reportedCost: 2.5,
            },
        })
        assert.equal(first.status, "succeeded")
        assert.equal(calls, 1)
        assert.deepEqual(
            store.listEvents(job.id).find((event) => event.kind === "operator_budget_reserved")?.usage,
            {
                runtimeTurns: 1,
                evaluations: 1,
                targetExecutions: 2,
                judgeExecutions: 1,
                tokens: 100,
                reportedCost: 2.5,
            },
        )

        const overBudget = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {datasetId: "dataset-1", runtimeId: "runtime-1"},
            idempotencyKey: "evaluation-2",
            reservation: {runtimeTurns: 1},
        })
        assert.equal(overBudget.status, "waiting_approval")
        assert.equal(store.getApproval(overBudget.approvalId).risk, "budget_expansion")
        assert.equal(calls, 1)
    })

    it("enforces duration independently of provider telemetry", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({maxDurationMs: 10})})
        const engine = new OperatorJobEngine({
            store,
            now: () => Date.parse(job.createdAt) + 11,
            runtimeTelemetry: [],
            handlers: {"datasets.read": async () => ({ok: true})},
        })
        const result = await engine.execute(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "late-read",
        })
        assert.equal(result.status, "waiting_approval")
        assert.equal(store.getApproval(result.approvalId).risk, "budget_expansion")
    })

    it("propagates cancellation and refuses successful parents until every child succeeds", async () => {
        const {store, session} = fixture()
        const engine = new OperatorJobEngine({store})
        const parent = createJob(store, session.id)
        store.transitionJob(parent.id, "running")
        const child = engine.scheduleChild(parent.id, {
            type: "evaluation",
            objective: "child",
            budget: budget(),
        })
        const grandchild = engine.scheduleChild(child.id, {
            type: "case",
            objective: "grandchild",
            budget: budget(),
        })
        store.transitionJob(child.id, "running")
        const childStep = store.createStep(child.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "read-before-cancel",
        })
        store.transitionStep(childStep.id, "running")

        await assert.rejects(() => engine.completeJob(parent.id, "succeeded"), /child.*succeed/iu)
        const cancelled = await engine.cancel(parent.id)
        assert.equal(cancelled.status, "cancelled")
        assert.equal(store.getJob(child.id).status, "cancelled")
        assert.equal(store.getJob(grandchild.id).status, "cancelled")
        assert.equal(store.getStep(childStep.id).status, "cancelled")
        assert.throws(() => engine.scheduleChild(parent.id, {
            type: "late",
            objective: "late child",
            budget: budget(),
        }), /terminal/iu)

        const successfulParent = createJob(store, session.id)
        store.transitionJob(successfulParent.id, "running")
        const successfulChild = engine.scheduleChild(successfulParent.id, {
            type: "evaluation",
            objective: "successful child",
            budget: budget(),
        })
        store.transitionJob(successfulChild.id, "running")
        store.transitionJob(successfulChild.id, "succeeded", {result: {ok: true}})
        assert.equal((await engine.completeJob(successfulParent.id, "succeeded", {result: {ok: true}})).status, "succeeded")
    })

    it("aborts an active Step before durably cancelling its Job", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        let signalSeen = false
        let markStarted
        const started = new Promise((resolve) => { markStarted = resolve })
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.read": ({signal}) => new Promise((_resolve, reject) => {
                    markStarted()
                    signal.addEventListener("abort", () => {
                        signalSeen = true
                        reject(Object.assign(new Error("cancelled"), {code: "ABORT_ERR"}))
                    }, {once: true})
                }),
            },
        })
        const execution = engine.execute(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "active-read",
        })
        await started
        assert.equal((await engine.cancel(job.id)).status, "cancelled")
        assert.equal((await execution).status, "cancelled")
        assert.equal(signalSeen, true)
        assert.equal(store.getJob(job.id).status, "cancelled")
        assert.equal(store.listSteps({jobId: job.id})[0].status, "cancelled")
    })

    it("reconciles reads, Evaluation run IDs, Installation inspection, and release tags but never retries delete", async () => {
        const {path, store, session} = fixture()
        const cases = [
            ["read", "datasets.read", {datasetId: "dataset-1"}],
            ["evaluation", "evaluations.start", {runId: "run-1", datasetId: "dataset-1"}],
            ["installation", "installations.start", {installationId: "installation-1", runtimeId: "runtime-1"}],
            ["release", "skills.release", {versionId: "candidate-1", versionLabel: "v1.1.0"}],
            ["delete", "datasets.delete", {datasetId: "dataset-2"}],
        ].map(([label, method, params]) => {
            const job = createJob(store, session.id, {objective: label})
            const step = createUncertainStep(store, job, {
                method,
                params,
                idempotencyKey: `${label}-1`,
            })
            return {label, job, step}
        })

        const restarted = new OperatorJobStore(path)
        let readRetries = 0
        let deleteRetries = 0
        const observations = {}
        const engine = new OperatorJobEngine({
            store: restarted,
            handlers: {
                "datasets.read": async ({idempotencyKey}) => {
                    readRetries += 1
                    assert.equal(idempotencyKey, "read-1")
                    return {dataset: {id: "dataset-1"}}
                },
                "datasets.delete": async () => { deleteRetries += 1 },
            },
            reconcilers: {
                evaluation: async (input) => {
                    observations.evaluation = input
                    return {status: "succeeded", result: {runId: input.runId, status: "completed"}}
                },
                installation: async (input) => {
                    observations.installation = input
                    return {status: "installed", result: {installationId: input.installationId}}
                },
                release: async (input) => {
                    observations.release = input
                    return {
                        status: "released",
                        candidateId: input.versionId,
                        tag: input.versionLabel,
                        result: {versionId: input.versionId},
                    }
                },
            },
        })

        for (const entry of cases) await engine.reconcile(entry.job.id)

        assert.equal(readRetries, 1)
        assert.equal(deleteRetries, 0)
        assert.equal(observations.evaluation.runId, "run-1")
        assert.equal(observations.installation.installationId, "installation-1")
        assert.deepEqual(
            {versionId: observations.release.versionId, versionLabel: observations.release.versionLabel},
            {versionId: "candidate-1", versionLabel: "v1.1.0"},
        )
        for (const entry of cases.filter(({label}) => label !== "delete")) {
            assert.equal(restarted.getStep(entry.step.id).status, "succeeded")
            assert.equal(restarted.getJob(entry.job.id).status, "running")
        }
        const deletion = cases.find(({label}) => label === "delete")
        assert.equal(restarted.getStep(deletion.step.id).status, "needs_recovery")
        assert.equal(restarted.getJob(deletion.job.id).status, "needs_recovery")
    })
})
