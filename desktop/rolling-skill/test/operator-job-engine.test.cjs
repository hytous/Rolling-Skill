const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs")
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
        const child = await engine.scheduleChild(parent.id, {
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

    it("never lets a custom approval decider downgrade mandatory policy or hide its deny", async () => {
        const allowedFixture = fixture()
        const releaseJob = createJob(allowedFixture.store, allowedFixture.session.id)
        let releases = 0
        const permissive = new OperatorJobEngine({
            store: allowedFixture.store,
            approvalDecider: () => ({decision: "allow"}),
            handlers: {"skills.release": async () => { releases += 1; return {released: true} }},
        })
        const mandatory = await permissive.execute(releaseJob.id, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "mandatory-release",
        })
        assert.equal(mandatory.status, "waiting_approval")
        assert.equal(allowedFixture.store.getApproval(mandatory.approvalId).action, "skills.release")
        assert.equal(releases, 0)

        const deniedFixture = fixture()
        const deniedJob = createJob(deniedFixture.store, deniedFixture.session.id, {
            budget: budget({maxEvaluations: 0, maxTargetExecutions: 0, maxJudgeExecutions: 0}),
        })
        const denied = new OperatorJobEngine({
            store: deniedFixture.store,
            approvalDecider: () => ({decision: "deny", code: "CUSTOM_DENY", message: "blocked"}),
            handlers: {"evaluations.start": async () => ({runId: "forbidden"})},
        })
        const result = await denied.execute(deniedJob.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: ["case-1"],
                selectionMode: "selected",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "denied-evaluation",
        })
        assert.equal(result.status, "failed")
        assert.equal(result.error.code, "CUSTOM_DENY")
        assert.equal(deniedFixture.store.listApprovals(deniedJob.id).length, 0)

        const additiveFixture = fixture()
        const additiveJob = createJob(additiveFixture.store, additiveFixture.session.id)
        let additiveCalls = 0
        const additive = new OperatorJobEngine({
            store: additiveFixture.store,
            approvalDecider: () => ({
                decision: "approval_required",
                action: "organization.release",
                reason: "organization_review",
                requestedScope: {organizationId: "organization-1"},
            }),
            handlers: {"skills.release": async () => { additiveCalls += 1; return {released: true} }},
        })
        const firstGate = await additive.execute(additiveJob.id, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "additive-release",
        })
        assert.equal(additiveFixture.store.getApproval(firstGate.approvalId).action, "skills.release")
        const secondGate = await additive.resolveApproval(firstGate.approvalId, {
            decision: "approve",
            scope: "action",
        })
        assert.equal(additiveFixture.store.getApproval(secondGate.approvalId).action, "organization.release")
        assert.equal(additiveCalls, 0)
        assert.equal((await additive.resolveApproval(secondGate.approvalId, {
            decision: "approve",
            scope: "action",
        })).status, "succeeded")
        assert.equal(additiveCalls, 1)
    })

    it("requires both mutation and budget approvals before executing a high-risk Step", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({maxRuntimeTurns: 0})})
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            handlers: {"skills.release": async () => { calls += 1; return {released: true} }},
        })
        const request = {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-with-budget-expansion",
            reservation: {runtimeTurns: 1},
        }
        const mutationApproval = await engine.execute(job.id, request)
        assert.equal(store.getApproval(mutationApproval.approvalId).action, "skills.release")
        const budgetApproval = await engine.resolveApproval(mutationApproval.approvalId, {
            decision: "approve",
            scope: "action",
        })
        assert.equal(budgetApproval.status, "waiting_approval")
        assert.equal(store.getApproval(budgetApproval.approvalId).action, "budget.expand")
        assert.equal(calls, 0)
        const executed = await engine.resolveApproval(budgetApproval.approvalId, {
            decision: "approve",
            scope: "action",
        })
        assert.equal(executed.status, "succeeded")
        assert.equal(calls, 1)
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
            maxTargetExecutions: 4,
            maxJudgeExecutions: 4,
            maxTokens: 100,
            maxReportedCost: 2.5,
        })})
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            runtimeTelemetry: [
                {runtimeId: "runtime-1", tokens: true, cost: true},
                {runtimeId: "runtime-2", tokens: true, cost: true},
                {runtimeId: "judge-1", tokens: true, cost: true},
            ],
            handlers: {"evaluations.start": async () => { calls += 1; return {runId: "run-1"} }},
            approvalDecider: () => ({decision: "allow"}),
        })
        const first = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: ["case-1", "case-2"],
                selectionMode: "selected",
                runtimeConfigurations: [{runtimeId: "runtime-1"}, {runtimeId: "runtime-2"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "evaluation-1",
            reservation: {
                runtimeTurns: 1,
                evaluations: 1,
                targetExecutions: 0,
                judgeExecutions: 0,
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
                targetExecutions: 4,
                judgeExecutions: 4,
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

        const dispatchFixture = fixture()
        const dispatchJob = createJob(dispatchFixture.store, dispatchFixture.session.id, {
            budget: budget({maxRuntimeTurns: 1}),
        })
        const dispatchEngine = new OperatorJobEngine({
            store: dispatchFixture.store,
            handlers: {"raw_cases.dispatch": async () => ({accepted: true})},
        })
        assert.equal((await dispatchEngine.execute(dispatchJob.id, {
            method: "raw_cases.dispatch",
            params: {id: "case-1"},
            idempotencyKey: "dispatch-minimum",
            reservation: {runtimeTurns: 0},
        })).status, "succeeded")
        assert.equal(
            dispatchFixture.store.listEvents(dispatchJob.id)
                .find((event) => event.kind === "operator_budget_reserved").usage.runtimeTurns,
            1,
        )

        const datasetFixture = fixture()
        const datasetJob = createJob(datasetFixture.store, datasetFixture.session.id, {
            budget: budget({maxEvaluations: 1, maxTargetExecutions: 6, maxJudgeExecutions: 6}),
        })
        const datasetEngine = new OperatorJobEngine({
            store: datasetFixture.store,
            resolveEvaluationCaseCount: async ({datasetId}) => {
                assert.equal(datasetId, "dataset-all")
                return 3
            },
            handlers: {"evaluations.start": async () => ({runId: "run-all"})},
        })
        assert.equal((await datasetEngine.execute(datasetJob.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-all",
                caseIds: [],
                selectionMode: "dataset",
                runtimeConfigurations: [{runtimeId: "runtime-1"}, {runtimeId: "runtime-2"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "dataset-selection-minimum",
            reservation: {evaluations: 0, targetExecutions: 0, judgeExecutions: 0},
        })).status, "succeeded")
        assert.deepEqual(
            datasetFixture.store.listEvents(datasetJob.id)
                .find((event) => event.kind === "operator_budget_reserved").usage,
            {evaluations: 1, targetExecutions: 6, judgeExecutions: 6},
        )
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

    it("aborts a handler that consumes the remaining hard duration budget", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({maxDurationMs: 50})})
        let aborted = false
        const engine = new OperatorJobEngine({
            store,
            now: () => Date.parse(job.createdAt),
            handlers: {
                "datasets.read": ({signal}) => new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => {
                        aborted = true
                        reject(Object.assign(new Error("duration exceeded"), {code: "ABORT_ERR"}))
                    }, {once: true})
                }),
            },
        })
        const result = await engine.execute(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "duration-bound-read",
        })
        assert.equal(result.status, "failed")
        assert.equal(result.error.code, "BUDGET_DURATION_EXCEEDED")
        assert.equal(aborted, true)
    })

    it("uses fixed precision for reported cost and rejects sparse request arrays", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({maxReportedCost: 0.3})})
        const engine = new OperatorJobEngine({
            store,
            runtimeTelemetry: [{runtimeId: "runtime-1", tokens: true, cost: true}],
            handlers: {"datasets.read": async ({params}) => ({id: params.datasetId})},
        })
        for (const [index, reportedCost] of [0.1, 0.2].entries()) {
            const result = await engine.execute(job.id, {
                method: "datasets.read",
                params: {datasetId: `dataset-${index + 1}`},
                idempotencyKey: `reported-cost-${index + 1}`,
                reservation: {reportedCost},
            })
            assert.equal(result.status, "succeeded")
        }
        const sparse = []
        sparse[1] = "case-2"
        await assert.rejects(() => engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: sparse,
                selectionMode: "selected",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "runtime-1"},
            },
            idempotencyKey: "sparse-selection",
        }), /sparse|dense/iu)
    })

    it("propagates cancellation and refuses successful parents until every child succeeds", async () => {
        const {store, session} = fixture()
        const engine = new OperatorJobEngine({store})
        const parent = createJob(store, session.id)
        store.transitionJob(parent.id, "running")
        const child = await engine.scheduleChild(parent.id, {
            type: "evaluation",
            objective: "child",
            budget: budget(),
        })
        const grandchild = await engine.scheduleChild(child.id, {
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
        await assert.rejects(() => engine.scheduleChild(parent.id, {
            type: "late",
            objective: "late child",
            budget: budget(),
        }), /terminal/iu)

        const successfulParent = createJob(store, session.id)
        store.transitionJob(successfulParent.id, "running")
        const successfulChild = await engine.scheduleChild(successfulParent.id, {
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

    it("cancels a 15,000-Job tree iteratively and child-first", async () => {
        const {path, store, session} = fixture()
        createJob(store, session.id)
        const registry = JSON.parse(readFileSync(path, "utf8"))
        const template = registry.jobs[0]
        registry.jobs = Array.from({length: 15_000}, (_unused, index) => {
            const id = `cancel-depth-${String(index).padStart(5, "0")}`
            return {
                ...template,
                id,
                objective: id,
                parentJobId: index === 0 ? null : `cancel-depth-${String(index - 1).padStart(5, "0")}`,
                children: index === 14_999 ? [] : [`cancel-depth-${String(index + 1).padStart(5, "0")}`],
            }
        })
        writeFileSync(path, `${JSON.stringify(registry)}\n`)
        const restarted = new OperatorJobStore(path)
        let completionOrder = null
        const cancelJobTree = restarted.cancelJobTree.bind(restarted)
        restarted.cancelJobTree = (...args) => {
            const result = cancelJobTree(...args)
            completionOrder = result.completionOrder
            return result
        }
        const engine = new OperatorJobEngine({store: restarted})

        const result = await engine.cancel("cancel-depth-00000")

        assert.equal(result.status, "cancelled")
        assert.equal(restarted.getJob("cancel-depth-14999").status, "cancelled")
        assert.equal(restarted.listJobs({sessionId: session.id}).every((job) => job.status === "cancelled"), true)
        assert.equal(completionOrder[0], "cancel-depth-14999")
        assert.equal(completionOrder.at(-1), "cancel-depth-00000")
    })

    it("blocks late children, resumes cancelling after restart, and fails parents only after children stop", async () => {
        const lateFixture = fixture()
        const parent = createJob(lateFixture.store, lateFixture.session.id)
        lateFixture.store.transitionJob(parent.id, "running")
        const canceller = new OperatorJobEngine({store: lateFixture.store})
        const scheduler = new OperatorJobEngine({store: lateFixture.store})
        const cancellation = canceller.cancel(parent.id)
        await assert.rejects(() => scheduler.scheduleChild(parent.id, {
            type: "late",
            objective: "must not start",
            budget: budget(),
        }), /cancell|terminal/iu)
        assert.equal((await cancellation).status, "cancelled")

        const restartFixture = fixture()
        const restarting = createJob(restartFixture.store, restartFixture.session.id)
        restartFixture.store.transitionJob(restarting.id, "running")
        restartFixture.store.createStep(restarting.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "must-not-retry",
        })
        restartFixture.store.transitionStep(
            restartFixture.store.listSteps({jobId: restarting.id})[0].id,
            "running",
        )
        restartFixture.store.transitionJob(restarting.id, "cancelling")
        const recoveredStore = new OperatorJobStore(restartFixture.path)
        let retries = 0
        const recoveryEngine = new OperatorJobEngine({
            store: recoveredStore,
            handlers: {"datasets.read": async () => { retries += 1; return {ok: true} }},
        })
        await recoveryEngine.reconcile(restarting.id)
        assert.equal(retries, 0)
        assert.equal(recoveredStore.getJob(restarting.id).status, "cancelled")

        const failedFixture = fixture()
        const failedParent = createJob(failedFixture.store, failedFixture.session.id)
        failedFixture.store.transitionJob(failedParent.id, "running")
        const failureEngine = new OperatorJobEngine({store: failedFixture.store})
        const activeChild = await failureEngine.scheduleChild(failedParent.id, {
            type: "child",
            objective: "active child",
            budget: budget(),
        })
        failedFixture.store.transitionJob(activeChild.id, "running")
        const failed = await failureEngine.completeJob(failedParent.id, "failed", {
            error: {code: "PARENT_FAILED"},
        })
        assert.equal(failed.status, "failed")
        assert.equal(failedFixture.store.getJob(activeChild.id).status, "cancelled")
    })

    it("atomically claims one Step across Engines sharing the same durable store", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        let calls = 0
        let releaseHandler
        let markStarted
        const started = new Promise((resolve) => { markStarted = resolve })
        const handlerGate = new Promise((resolve) => { releaseHandler = resolve })
        const handler = async () => {
            calls += 1
            markStarted()
            await handlerGate
            return {ok: true}
        }
        const first = new OperatorJobEngine({store, handlers: {"datasets.read": handler}})
        const second = new OperatorJobEngine({store, handlers: {"datasets.read": handler}})
        const request = {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "shared-store-claim",
        }
        const firstExecution = first.execute(job.id, request)
        const secondExecution = second.execute(job.id, request)
        await started
        releaseHandler()
        const results = await Promise.all([firstExecution, secondExecution])
        assert.equal(calls, 1)
        assert.equal(results.some((result) => result.status === "succeeded"), true)
        assert.equal(store.listSteps({jobId: job.id}).length, 1)
        assert.notEqual(store.getStep(results[0].stepId).status, "failed")
    })

    it("serializes concurrent recovery claims and never invokes an unknown running Step directly", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        createUncertainStep(store, job, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "reconcile-claim",
        })
        const restarted = new OperatorJobStore(path)
        let calls = 0
        let releaseHandler
        let markStarted
        const started = new Promise((resolve) => { markStarted = resolve })
        const handlerGate = new Promise((resolve) => { releaseHandler = resolve })
        const handler = async () => {
            calls += 1
            markStarted()
            await handlerGate
            return {ok: true}
        }
        const first = new OperatorJobEngine({store: restarted, handlers: {"datasets.read": handler}})
        const second = new OperatorJobEngine({store: restarted, handlers: {"datasets.read": handler}})
        const firstRecovery = first.reconcile(job.id)
        const secondRecovery = second.reconcile(job.id)
        await started
        releaseHandler()
        await Promise.all([firstRecovery, secondRecovery])
        assert.equal(calls, 1)
        assert.equal(restarted.listSteps({jobId: job.id})[0].status, "succeeded")
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
                    return {
                        status: "installed",
                        installationId: input.installationId,
                        runtimeId: input.runtimeId,
                        result: {installationId: input.installationId, runtimeId: input.runtimeId},
                    }
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
            assert.equal(restarted.getStep(entry.step.id).error, null)
            assert.equal(restarted.getJob(entry.job.id).status, "running")
            const terminal = await engine.completeJob(entry.job.id, "succeeded", {result: {ok: true}})
            assert.equal(JSON.stringify(terminal.terminalSnapshot).includes("OPERATOR_INTERRUPTED"), false)
        }
        const deletion = cases.find(({label}) => label === "delete")
        assert.equal(restarted.getStep(deletion.step.id).status, "needs_recovery")
        assert.equal(restarted.getJob(deletion.job.id).status, "needs_recovery")
    })

    it("keeps Installation recovery unknown when the inspected target identity mismatches", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        const step = createUncertainStep(store, job, {
            method: "installations.start",
            params: {
                installationId: "installation-1",
                runtimeId: "runtime-1",
                skillId: "skill-1",
                versionId: "version-1",
            },
            idempotencyKey: "installation-mismatch",
        })
        const restarted = new OperatorJobStore(path)
        const engine = new OperatorJobEngine({
            store: restarted,
            reconcilers: {
                installation: async () => ({
                    status: "installed",
                    installationId: "installation-1",
                    runtimeId: "runtime-other",
                    skillId: "skill-1",
                    versionId: "version-1",
                }),
            },
        })
        await engine.reconcile(job.id)
        assert.equal(restarted.getStep(step.id).status, "needs_recovery")
        assert.equal(restarted.getJob(job.id).status, "needs_recovery")
    })
})
