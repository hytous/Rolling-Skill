const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {basename, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    OperatorJobEngine,
    operatorArtifactMetadata,
    preflightOperatorBudget,
} = require("../src/operator/job-engine.cjs")
const {OperatorJobStore} = require("../src/operator/job-store.cjs")
const {operatorApprovalRequirement} = require("../src/control-plane/policy.cjs")

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

function withControlPolicyApproval(request) {
    return {
        ...request,
        policyApproval: operatorApprovalRequirement(request.method, request.params),
    }
}

function createUncertainStep(store, job, request) {
    store.transitionJob(job.id, "running")
    const step = store.createStep(job.id, request)
    return store.transitionStep(step.id, "running")
}

describe("Operator Job engine", () => {
    it("does not expire the immutable final optimization review during background sweeps", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            action: "optimization.release-install", scope: {versionId: "frozen-version"},
            proposedMutation: {method: "optimization.approval"},
            risk: "final review", expiresAt: "2000-01-01T00:00:00.000Z",
        })
        const engine = new OperatorJobEngine({store, invoke: async () => ({})})
        assert.deepEqual(await engine.expireApprovals(job.id), [])
        assert.equal(store.getApproval(approval.id).status, "pending")
    })

    it("projects only method-specific stable entity IDs into public artifact metadata", () => {
        assert.deepEqual(operatorArtifactMetadata("datasets.get", {
            dataset: {
                id: "dataset-1",
                repositoryId: "repository-1",
                skillId: "skill-1",
                path: "/private/dataset.json",
            },
            metadata: {
                caseId: "forged-case",
                response: "secret response",
            },
            trace: {runtimeExecutable: "/usr/local/bin/runtime"},
        }, {}), {
            datasetId: "dataset-1",
            repositoryId: "repository-1",
            skillId: "skill-1",
        })
        assert.deepEqual(operatorArtifactMetadata("curation.save", {
            session: {datasetId: "dataset-2"},
            case: {id: "case-2", datasetId: "dataset-2", evidence: "secret"},
        }, {methodFacts: {
            method: "curation.save",
            datasetId: "dataset-2",
            resourceDigest: "do-not-project",
        }}), {
            datasetId: "dataset-2",
            caseId: "case-2",
        })
        assert.deepEqual(operatorArtifactMetadata("evaluations.start", {
            run: {id: "evaluation-1", datasetId: "dataset-3", judge: {body: "secret"}},
        }, {evaluationSelection: {
            datasetId: "dataset-3",
            caseIds: ["case-secret"],
            datasetRevision: "revision-secret",
        }}), {
            datasetId: "dataset-3",
            evaluationId: "evaluation-1",
        })
        assert.deepEqual(operatorArtifactMetadata("skills.create_candidate", {
            version: {
                id: "candidate-1",
                repositoryId: "repository-2",
                skillId: "skill-2",
                contentDigest: "do-not-project",
            },
        }, {methodFacts: {
            method: "skills.create_candidate",
            repositoryId: "repository-2",
            skillId: "skill-2",
            baseCommit: "do-not-project",
        }}), {
            repositoryId: "repository-2",
            skillId: "skill-2",
            candidateId: "candidate-1",
        })
        assert.deepEqual(operatorArtifactMetadata("installations.get", {
            installation: {
                id: "installation-1",
                request: {source: {repositoryId: "repository-3", skillId: "skill-3"}},
                runtime: {executablePath: "/private/runtime"},
            },
        }, {methodFacts: {
            method: "installations.get",
            installationId: "installation-1",
            repositoryId: "repository-3",
            skillId: "skill-3",
            resourceDigest: "do-not-project",
        }}), {
            installationId: "installation-1",
            repositoryId: "repository-3",
            skillId: "skill-3",
        })
        assert.deepEqual(operatorArtifactMetadata("installations.start", {
            installations: [
                {id: "installation-2"},
                {id: "installation-3", runtime: {executablePath: "/private/runtime"}},
            ],
            metadata: {installationIds: ["forged-installation"]},
        }, {methodFacts: {
            method: "installations.start",
            repositoryId: "repository-3",
            skillId: "skill-3",
        }}), {
            installationIds: ["installation-2", "installation-3"],
            repositoryId: "repository-3",
            skillId: "skill-3",
        })
        assert.equal(operatorArtifactMetadata("unknown.method", {
            dataset: {id: "forged-dataset"},
            metadata: {datasetId: "forged-dataset"},
        }, {methodFacts: {datasetId: "forged-dataset"}}), null)
        assert.equal(operatorArtifactMetadata("datasets.get", {
            dataset: {id: "/private/dataset.json"},
        }, {}), null)
    })

    it("persists the allowlisted IDs and keeps legacy artifacts without metadata safe", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.get": async () => ({
                    dataset: {
                        id: "dataset-1",
                        repositoryId: "repository-1",
                        skillId: "skill-1",
                    },
                    metadata: {caseId: "forged-case"},
                    path: "/private/dataset.json",
                    response: {body: "secret"},
                }),
            },
        })
        const execution = await engine.execute(job.id, {
            method: "datasets.get",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "artifact-metadata-dataset-1",
        })
        assert.equal(execution.status, "succeeded")
        const [artifact] = store.listArtifacts(job.id)
        assert.deepEqual(artifact.metadata, {
            datasetId: "dataset-1",
            repositoryId: "repository-1",
            skillId: "skill-1",
        })
        assert.doesNotMatch(JSON.stringify(artifact.metadata), /private|forged|response|body/iu)

        const legacy = store.createArtifact(job.id, {
            kind: "operator-report",
            name: "legacy.json",
            mediaType: "application/json",
            body: JSON.stringify({datasetId: "body-only-id"}),
        })
        assert.equal(legacy.metadata, null)
    })

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

        store.close()
        const restartedStore = new OperatorJobStore(path)
        const restarted = new OperatorJobEngine({
            store: restartedStore,
            handlers: {"datasets.read": async () => { calls += 1 }},
        })
        const afterRestart = await restarted.execute(parent.id, request)
        assert.deepEqual(afterRestart.result, first.result)
        assert.equal(calls, 1)
    })

    it("persists an internal Optimization approval and waits for the existing approval resolver", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id)
        const engine = new OperatorJobEngine({store})

        const pending = engine.requestApproval(parent.id, {
            action: "optimization.release",
            risk: "Release the selected immutable Candidate",
            scope: {runId: "optimization-run-1", versionId: "candidate-2"},
            proposedMutation: {kind: "release", versionId: "candidate-2"},
            idempotencyKey: "optimization-run-1:release:candidate-2",
        })
        await new Promise((resolve_) => setImmediate(resolve_))
        const [approval] = store.listApprovals(parent.id)

        assert.equal(approval.status, "pending")
        assert.equal(approval.action, "optimization.release")
        assert.equal(store.getJob(parent.id).status, "waiting_approval")
        await engine.resolveApproval(approval.id, {
            decision: "approve",
            scope: "single_action",
            decidedBy: "human-renderer",
        })

        assert.deepEqual(await pending, {
            approved: true,
            approvalId: approval.id,
            decisionScope: "single_action",
        })
        assert.equal(store.getStep(approval.stepId).status, "succeeded")
        assert.equal(store.getJob(parent.id).status, "running")
        assert.deepEqual(await engine.requestApproval(parent.id, {
            action: "optimization.release",
            risk: "Release the selected immutable Candidate",
            scope: {runId: "optimization-run-1", versionId: "candidate-2"},
            proposedMutation: {kind: "release", versionId: "candidate-2"},
            idempotencyKey: "optimization-run-1:release:candidate-2",
        }), {
            approved: true,
            approvalId: approval.id,
            decisionScope: "single_action",
        })
    })

    it("settles a pending internal approval waiter when its Operator Job is cancelled", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id)
        const engine = new OperatorJobEngine({store})
        const observed = []
        const pending = engine.requestApproval(parent.id, {
            action: "optimization.release-install",
            risk: "Release and install the selected Candidate",
            scope: {runId: "optimization-run-1", epoch: 2},
            proposedMutation: {kind: "release-install", runId: "optimization-run-1"},
            idempotencyKey: "optimization-run-1:release-install:2",
        }, {
            onPending: (approval) => observed.push(approval),
        })
        await new Promise((resolve_) => setImmediate(resolve_))
        const [approval] = store.listApprovals(parent.id)
        assert.equal(observed[0].id, approval.id)

        await engine.cancel(parent.id)
        const decision = await Promise.race([
            pending,
            new Promise((_, reject) => setTimeout(() => reject(new Error("approval waiter did not settle")), 100)),
        ])

        assert.deepEqual(decision, {
            approved: false,
            approvalId: approval.id,
            decisionScope: "job_cancelling",
        })
        assert.equal(store.getApproval(approval.id).status, "rejected")
    })

    it("detaches an in-memory approval waiter for shutdown without resolving its durable approval", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id)
        const engine = new OperatorJobEngine({store})
        const pending = engine.requestApproval(parent.id, {
            action: "optimization.release-install",
            risk: "Release and install the selected Candidate",
            scope: {runId: "optimization-run-1", epoch: 2},
            proposedMutation: {kind: "release-install", runId: "optimization-run-1"},
            idempotencyKey: "optimization-run-1:release-install:shutdown",
        })
        await new Promise((resolve_) => setImmediate(resolve_))
        const [approval] = store.listApprovals(parent.id)

        assert.equal(engine.suspendApprovalWaiter(approval.id), true)
        assert.deepEqual(await pending, {
            approved: false,
            suspended: true,
            approvalId: approval.id,
            decisionScope: "app_shutdown",
        })
        assert.equal(store.getApproval(approval.id).status, "pending")
        assert.equal(store.getJob(parent.id).status, "waiting_approval")
    })

    it("runs an internal phase inside a durable child Job and terminalizes success or failure", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id)
        const engine = new OperatorJobEngine({store})
        const result = await engine.runChild({
            parentJobId: parent.id,
            type: "optimization_candidate",
            objective: "Commit one immutable Candidate",
            budget: budget(),
        }, ({jobId, createArtifact}) => {
            const artifact = createArtifact({
                kind: "optimization-candidate",
                name: "candidate.json",
                mediaType: "application/json",
                body: "{}",
            })
            return {jobId, artifactId: artifact.id}
        })
        const succeeded = store.getJob(result.jobId)
        assert.equal(succeeded.status, "succeeded")
        assert.deepEqual(succeeded.artifactIds, [result.artifactId])

        await assert.rejects(() => engine.runChild({
            parentJobId: parent.id,
            type: "optimization_evaluation",
            objective: "Evaluate one Candidate",
            budget: budget(),
        }, () => {
            throw Object.assign(new Error("evaluation failed"), {code: "EVALUATION_FAILED"})
        }), /evaluation failed/u)
        const failed = store.listJobs({parentJobId: parent.id}).at(-1)
        assert.equal(failed.status, "failed")
        assert.equal(failed.error.code, "EVALUATION_FAILED")
    })

    it("inherits the frozen parent budget for an internal child Job", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id, {budget: {}})
        const engine = new OperatorJobEngine({store})

        const result = await engine.runChild({
            parentJobId: parent.id,
            type: "optimization_baseline",
            objective: "Run the baseline evaluation",
        }, ({jobId}) => ({jobId}))

        assert.deepEqual(store.getJob(result.jobId).budget, parent.budget)
    })

    it("terminalizes an internally cancelled Optimization phase as cancelled", async () => {
        const {store, session} = fixture()
        const parent = createJob(store, session.id)
        const engine = new OperatorJobEngine({store})

        const outcome = await engine.runChild({
            parentJobId: parent.id,
            type: "optimization_baseline",
            objective: "Run the baseline evaluation",
            budget: budget(),
        }, () => {
            throw Object.assign(new Error("Optimization cancelled by user"), {
                code: "OPTIMIZATION_CANCELLED",
            })
        })

        const cancelled = store.listJobs({parentJobId: parent.id}).at(-1)
        assert.equal(outcome.status, "cancelled")
        assert.equal(cancelled.status, "cancelled")
        assert.equal(cancelled.error.code, "OPERATOR_CHILD_CANCELLED")
    })

    it("coordinates idempotency and Job queues across Store instances for the same path", async () => {
        const {root, path, store, session} = fixture()
        const job = createJob(store, session.id)
        const aliasContainer = mkdtempSync(join(tmpdir(), "rolling-skill-operator-alias-"))
        temporaryDirectories.push(aliasContainer)
        const rootAlias = join(aliasContainer, "store-root")
        symlinkSync(root, rootAlias, "dir")
        const aliasPath = join(rootAlias, "private", basename(path))
        const secondStore = new OperatorJobStore(aliasPath)
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
        const second = new OperatorJobEngine({store: secondStore, handlers: {"datasets.read": handler}})
        const request = {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "multi-store-idempotency",
        }

        const firstExecution = first.execute(job.id, request)
        await started
        const secondExecution = second.execute(job.id, request)
        releaseHandler()
        const results = await Promise.all([firstExecution, secondExecution])

        assert.equal(calls, 1)
        assert.equal(results.every((result) => result.status === "succeeded"), true)
        assert.equal(store.coordinationKey, secondStore.coordinationKey)
        assert.equal(store.path, secondStore.path)
        assert.equal(store.listSteps({jobId: job.id}).length, 1)
        assert.equal(secondStore.listSteps({jobId: job.id}).length, 1)
    })

    it("serializes budget check-and-reserve across Store instances and re-enters approval on conflict", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({maxRuntimeTurns: 1})})
        const secondStore = new OperatorJobStore(path)
        let calls = 0
        let releaseHandler
        let markStarted
        const started = new Promise((resolve) => { markStarted = resolve })
        const handlerGate = new Promise((resolve) => { releaseHandler = resolve })
        const handler = async () => {
            calls += 1
            markStarted()
            await handlerGate
            return {accepted: true}
        }
        const first = new OperatorJobEngine({store, handlers: {"raw_cases.dispatch": handler}})
        const second = new OperatorJobEngine({store: secondStore, handlers: {"raw_cases.dispatch": handler}})

        const firstExecution = first.execute(job.id, {
            method: "raw_cases.dispatch",
            params: {id: "case-1"},
            idempotencyKey: "budget-race-1",
        })
        await started
        const secondExecution = second.execute(job.id, {
            method: "raw_cases.dispatch",
            params: {id: "case-2"},
            idempotencyKey: "budget-race-2",
        })
        releaseHandler()
        const results = await Promise.all([firstExecution, secondExecution])

        assert.equal(calls, 1)
        assert.deepEqual(results.map((result) => result.status), ["succeeded", "waiting_approval"])
        assert.equal(store.listEvents(job.id).filter((event) => event.kind === "operator_budget_reserved").length, 1)
        assert.equal(store.getApproval(results[1].approvalId).action, "budget.expand")
    })

    it("runs preauthorized self-operation mutations without creating approvals", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: {maxIterations: 50}})
        const called = []
        const engine = new OperatorJobEngine({
            store,
            handlers: Object.fromEntries([
                "skills.release",
                "rubrics.publish",
                "installations.start",
                "datasets.delete",
            ].map((method) => [method, async () => {
                called.push(method)
                return {ok: true}
            }])),
        })
        const requests = [
            ["skills.release", {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"}],
            ["rubrics.publish", {datasetId: "dataset-1", sessionId: "rubric-1"}],
            ["installations.start", {skillId: "skill-1", runtimeId: "runtime-1"}],
            ["datasets.delete", {datasetId: "dataset-1"}],
        ]

        for (const [method, params] of requests) {
            const result = await engine.execute(job.id, {
                method,
                params,
                idempotencyKey: `preauthorized:${method}`,
            })
            assert.equal(result.status, "succeeded")
        }
        assert.deepEqual(called, requests.map(([method]) => method))
        assert.deepEqual(store.listApprovals(job.id), [])
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
        const waiting = await engine.execute(releaseJob.id, withControlPolicyApproval({
            method: "skills.release",
            params,
            idempotencyKey: "release-candidate-1",
        }))
        params.versionId = "tampered"
        assert.equal(waiting.status, "waiting_approval")
        assert.equal(store.getJob(releaseJob.id).status, "waiting_approval")
        assert.deepEqual(store.getApproval(waiting.approvalId).proposedMutation, {
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-candidate-1",
            reservation: {},
        })
        assert.equal((await engine.execute(releaseJob.id, withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-candidate-1",
        }))).approvalId, waiting.approvalId)

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
        const rejectedWaiting = await engine.execute(rejectedJob.id, withControlPolicyApproval({
            method: "installations.start",
            params: {skillId: "skill-1", runtimeId: "runtime-1"},
            idempotencyKey: "install-1",
        }))
        const rejected = await engine.resolveApproval(rejectedWaiting.approvalId, {
            decision: "reject",
            scope: "action",
        })
        assert.equal(rejected.status, "failed")
        assert.equal(store.getStep(rejected.stepId).error.code, "APPROVAL_REJECTED")
        assert.equal(store.getJob(rejectedJob.id).status, "running")

        const expiredJob = createJob(store, session.id)
        const expiredWaiting = await engine.execute(expiredJob.id, withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "release-candidate-2",
        }))
        clock += 1_001
        const expired = await engine.expireApprovals(expiredJob.id)
        assert.deepEqual(expired.map((entry) => entry.approvalId), [expiredWaiting.approvalId])
        assert.equal(store.getApproval(expiredWaiting.approvalId).status, "rejected")
        assert.equal(store.getStep(expiredWaiting.stepId).error.code, "APPROVAL_EXPIRED")
    })

    it("never lets a custom approval decider downgrade a ControlPlane gate or hide its deny", async () => {
        const allowedFixture = fixture()
        const releaseJob = createJob(allowedFixture.store, allowedFixture.session.id)
        let releases = 0
        const permissive = new OperatorJobEngine({
            store: allowedFixture.store,
            approvalDecider: () => ({decision: "allow"}),
            handlers: {"skills.release": async () => { releases += 1; return {released: true} }},
        })
        const mandatory = await permissive.execute(releaseJob.id, withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "mandatory-release",
        }))
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
        const firstGate = await additive.execute(additiveJob.id, withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "additive-release",
        }))
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
        const request = withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-with-budget-expansion",
            reservation: {runtimeTurns: 1},
        })
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

    it("matches an approval to the latest stable gate and never recreates a rejected later gate", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        let requestedScope = {organizationId: "organization-1", revision: 1}
        const request = withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "stable-gate-release",
        })
        const decider = () => ({
            decision: "approval_required",
            action: "organization.release",
            reason: "organization_review",
            requestedScope,
        })
        const firstEngine = new OperatorJobEngine({store, approvalDecider: decider})
        const mandatory = await firstEngine.execute(job.id, request)
        const custom = await firstEngine.resolveApproval(mandatory.approvalId, {
            decision: "approve",
            scope: "action",
        })
        store.resolveApproval(custom.approvalId, {decision: "approve", scope: "action"})

        requestedScope = {organizationId: "organization-1", revision: 2}
        store.close()
        const restartedStore = new OperatorJobStore(path)
        const restarted = new OperatorJobEngine({store: restartedStore, approvalDecider: decider})
        const latest = await restarted.execute(job.id, request)
        assert.equal(latest.status, "waiting_approval")
        assert.deepEqual(restartedStore.getApproval(latest.approvalId).scope, requestedScope)
        restartedStore.resolveApproval(latest.approvalId, {decision: "reject", scope: "action"})
        assert.equal(restartedStore.listApprovals(job.id).length, 3)
        restartedStore.close()

        const afterCrashStore = new OperatorJobStore(path)
        const afterCrash = new OperatorJobEngine({store: afterCrashStore, approvalDecider: decider})
        const rejected = await afterCrash.execute(job.id, request)
        assert.equal(rejected.status, "failed")
        assert.equal(rejected.error.code, "APPROVAL_REJECTED")
        assert.equal(afterCrashStore.listApprovals(job.id).length, 3)
    })

    it("resolves a durable mutation approval after restart without replaying its idempotency key", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        let releaseCalls = 0
        const request = withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "release-after-restart",
        })
        const firstEngine = new OperatorJobEngine({
            store,
            handlers: {"skills.release": async () => { releaseCalls += 1; return {released: true} }},
        })
        const waiting = await firstEngine.execute(job.id, request)
        assert.equal((await firstEngine.execute(job.id, request)).approvalId, waiting.approvalId)

        store.close()
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

        restartedStore.close()
        const secondRestart = new OperatorJobStore(path)
        const finalEngine = new OperatorJobEngine({
            store: secondRestart,
            handlers: {"skills.release": async () => { releaseCalls += 1 }},
        })
        assert.deepEqual((await finalEngine.execute(job.id, request)).result, {released: true})
        assert.equal(releaseCalls, 1)
    })

    it("freezes method-specific trusted facts before Step creation and never re-resolves them after approval", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        let resolverCalls = 0
        let currentRevision = "revision-1"
        let observedFacts = null
        const engine = new OperatorJobEngine({
            store,
            resolveTrustedFacts: async ({method, params}) => {
                resolverCalls += 1
                return {method, datasetId: params.datasetId, revision: currentRevision}
            },
            handlers: {
                "datasets.delete": async ({trustedFacts}) => {
                    observedFacts = trustedFacts.methodFacts
                    return {deleted: true}
                },
            },
        })
        const waiting = await engine.execute(job.id, withControlPolicyApproval({
            method: "datasets.delete",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "delete-frozen-facts",
        }))
        assert.equal(waiting.status, "waiting_approval")
        assert.equal(resolverCalls, 1)
        const created = store.listEvents(job.id).find((event) => (
            event.kind === "operator_step_created" && event.stepId === waiting.stepId
        ))
        assert.deepEqual(created.trustedFacts.methodFacts, {
            method: "datasets.delete",
            datasetId: "dataset-1",
            revision: "revision-1",
        })

        currentRevision = "revision-2"
        const result = await engine.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
            decidedBy: "user",
        })
        assert.equal(result.status, "succeeded")
        assert.equal(resolverCalls, 1)
        assert.deepEqual(observedFacts, created.trustedFacts.methodFacts)
    })

    it("resumes an approval decision persisted immediately before a process interruption", async () => {
        const approvedFixture = fixture()
        const approvedJob = createJob(approvedFixture.store, approvedFixture.session.id)
        const request = withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
            idempotencyKey: "approval-crash-approved",
        })
        const beforeCrash = new OperatorJobEngine({store: approvedFixture.store})
        const waiting = await beforeCrash.execute(approvedJob.id, request)
        approvedFixture.store.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
            decidedBy: "user-1",
        })

        let releaseCalls = 0
        approvedFixture.store.close()
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
        const rejectedRequest = withControlPolicyApproval({
            method: "skills.release",
            params: {skillId: "skill-1", versionId: "candidate-2", versionLabel: "v1.2.0"},
            idempotencyKey: "approval-crash-rejected",
        })
        const rejectedBeforeCrash = new OperatorJobEngine({store: rejectedFixture.store})
        const rejectedWaiting = await rejectedBeforeCrash.execute(rejectedJob.id, rejectedRequest)
        rejectedFixture.store.resolveApproval(rejectedWaiting.approvalId, {
            decision: "reject",
            scope: "action",
            decidedBy: "user-1",
        })
        rejectedFixture.store.close()
        const rejectedStore = new OperatorJobStore(rejectedFixture.path)
        const rejectedResumed = new OperatorJobEngine({store: rejectedStore})
        const rejected = await rejectedResumed.execute(rejectedJob.id, rejectedRequest)
        assert.equal(rejected.status, "failed")
        assert.equal(rejected.error.code, "APPROVAL_REJECTED")
        assert.equal(rejectedStore.getJob(rejectedJob.id).status, "running")
    })

    it("persists and enforces a mandatory ControlPlane approval gate before handler execution", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.read": async () => {
                    calls += 1
                    return {dataset: {id: "dataset-1"}}
                },
            },
        })
        const request = {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "control-policy-gate",
            policyApproval: {
                decision: "approval_required",
                action: "datasets.delete",
                reason: "destructive_action",
                requestedScope: {datasetIds: ["dataset-1"]},
            },
        }

        const waiting = await engine.execute(job.id, request)
        assert.equal(waiting.status, "waiting_approval")
        assert.equal(calls, 0)
        const approval = store.getApproval(waiting.approvalId)
        assert.equal(approval.action, "datasets.delete")
        assert.equal(approval.risk, "destructive_action")
        assert.deepEqual(approval.scope, {datasetIds: ["dataset-1"]})

        const resolved = await engine.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "once",
            decidedBy: "reviewer",
        })
        assert.equal(resolved.status, "succeeded")
        assert.equal(calls, 1)
    })

    it("passes the authorized ControlPlane context only to the live handler and never persists it", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        const handlerContext = Object.freeze({
            capabilityId: "capability-1",
            sessionId: "authority-session-1",
            grant: Object.freeze({id: "capability-1"}),
            scopeFilter: Object.freeze({datasetIds: Object.freeze(["dataset-1"])}),
            executionContext: Object.freeze({privatePath: "/private/runtime/provider"}),
        })
        let observed = null
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.read": async ({controlContext}) => {
                    observed = controlContext
                    return {dataset: {id: "dataset-1"}}
                },
            },
        })

        const result = await engine.execute(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "ephemeral-control-context",
            handlerContext,
        })

        assert.equal(result.status, "succeeded")
        assert.equal(observed, handlerContext)
        assert.equal(readFileSync(path, "utf8").includes("/private/runtime/provider"), false)
    })

    it("restarts pre-invoke pending and partially-created approval Steps deterministically", async () => {
        for (const phase of ["pending", "step_waiting", "job_waiting"]) {
            const {path, store, session} = fixture()
            const job = createJob(store, session.id, {objective: phase})
            store.transitionJob(job.id, "running")
            const request = withControlPolicyApproval({
                method: "skills.release",
                params: {skillId: "skill-1", versionId: "candidate-1", versionLabel: "v1.1.0"},
                idempotencyKey: `release-${phase}`,
            })
            let step = store.createStep(job.id, {
                method: request.method,
                params: request.params,
                reservation: {},
                trustedFacts: {controlPolicyApproval: request.policyApproval},
                idempotencyKey: request.idempotencyKey,
            })
            if (phase !== "pending") step = store.transitionStep(step.id, "waiting_approval")
            if (phase === "job_waiting") store.transitionJob(job.id, "waiting_approval")

            store.close()
            const restartedStore = new OperatorJobStore(path)
            const restartedEngine = new OperatorJobEngine({store: restartedStore})
            const result = await restartedEngine.execute(job.id, request)
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
                return {
                    caseIds: ["case-1", "case-2", "case-3"],
                    datasetRevision: "dataset-revision-1",
                }
            },
            handlers: {"evaluations.start": async ({params}) => {
                assert.equal(params.selectionMode, "selected")
                assert.deepEqual(params.caseIds, ["case-1", "case-2", "case-3"])
                return {runId: "run-all"}
            }},
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

    it("runs a many-Case Evaluation without Tool reservations for an iteration budget", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: {maxIterations: 2}})
        let telemetryCalls = 0
        const engine = new OperatorJobEngine({
            store,
            runtimeTelemetry: () => {
                telemetryCalls += 1
                return []
            },
            handlers: {"evaluations.start": async ({params}) => ({
                runId: "iteration-evaluation",
                caseCount: params.caseIds.length,
            })},
        })
        const result = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: Array.from({length: 100}, (_unused, index) => `case-${index + 1}`),
                selectionMode: "selected",
                runtimeConfigurations: [{runtimeId: "runtime-1"}, {runtimeId: "runtime-2"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "iteration-evaluation",
        })

        assert.equal(result.status, "succeeded")
        assert.equal(result.result.caseCount, 100)
        assert.equal(telemetryCalls, 0)
        assert.equal(store.listEvents(job.id).some((event) => (
            event.kind === "operator_budget_reserved"
        )), false)
        const created = store.listEvents(job.id).find((event) => (
            event.kind === "operator_step_created"
        ))
        assert.deepEqual(created.request.reservation, {})
        assert.deepEqual(preflightOperatorBudget({maxIterations: 2}), {valid: true, fields: {}})
    })

    it("runs Tool steps without telemetry, reservations, or duration enforcement for an unbounded budget", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: {}})
        let telemetryCalls = 0
        const engine = new OperatorJobEngine({
            store,
            now: () => Date.parse(job.createdAt) + 365 * 24 * 60 * 60 * 1_000,
            runtimeTelemetry: () => {
                telemetryCalls += 1
                return []
            },
            handlers: {"evaluations.start": async ({params}) => ({
                runId: "unbounded-evaluation",
                caseCount: params.caseIds.length,
            })},
        })
        const result = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: ["case-1", "case-2"],
                selectionMode: "selected",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "unbounded-evaluation",
        })

        assert.equal(result.status, "succeeded")
        assert.equal(result.result.caseCount, 2)
        assert.equal(telemetryCalls, 0)
        assert.equal(store.listEvents(job.id).some((event) => (
            event.kind === "operator_budget_reserved"
        )), false)
        assert.deepEqual(preflightOperatorBudget({}), {valid: true, fields: {}})
    })

    it("freezes trusted Dataset selection facts before Step creation and never resolves them again", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({
            maxEvaluations: 0,
            maxTargetExecutions: 0,
            maxJudgeExecutions: 0,
        })})
        let resolvedSelection = {
            caseIds: ["case-1", "case-2", "case-3"],
            datasetRevision: "dataset-revision-3",
        }
        let resolverCalls = 0
        let handlerCalls = 0
        let handlerParams = null
        const engine = new OperatorJobEngine({
            store,
            resolveEvaluationCaseCount: async () => {
                resolverCalls += 1
                return resolvedSelection
            },
            handlers: {"evaluations.start": async ({params, trustedFacts}) => {
                handlerCalls += 1
                handlerParams = params
                assert.equal(params.expectedDatasetRevision, "dataset-revision-3")
                assert.deepEqual(trustedFacts, {
                    evaluationSelection: {
                        datasetId: "dataset-1",
                        caseIds: ["case-1", "case-2", "case-3"],
                        datasetRevision: "dataset-revision-3",
                    },
                })
                return {runId: "run-frozen"}
            }},
        })
        const request = {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: [],
                selectionMode: "dataset",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            idempotencyKey: "frozen-dataset-selection",
        }
        const waiting = await engine.execute(job.id, request)
        const creation = store.listEvents(job.id).find((event) => event.kind === "operator_step_created")
        assert.deepEqual(creation.request.reservation, {
            evaluations: 1,
            targetExecutions: 3,
            judgeExecutions: 3,
        })
        assert.equal(creation.request.params.selectionMode, "selected")
        assert.deepEqual(creation.request.params.caseIds, ["case-1", "case-2", "case-3"])
        assert.equal(creation.request.params.expectedDatasetRevision, "dataset-revision-3")
        assert.equal(creation.requestedParams.selectionMode, "dataset")
        assert.deepEqual(creation.requestedParams.caseIds, [])
        assert.deepEqual(creation.trustedFacts, {
            evaluationSelection: {
                datasetId: "dataset-1",
                caseIds: ["case-1", "case-2", "case-3"],
                datasetRevision: "dataset-revision-3",
            },
        })

        resolvedSelection = {
            caseIds: Array.from({length: 50}, (_unused, index) => `changed-case-${index}`),
            datasetRevision: "dataset-revision-50",
        }
        store.close()
        const restartedStore = new OperatorJobStore(path)
        const restarted = new OperatorJobEngine({
            store: restartedStore,
            resolveEvaluationCaseCount: async () => {
                resolverCalls += 1
                return resolvedSelection
            },
            handlers: {"evaluations.start": async ({params, trustedFacts}) => {
                handlerCalls += 1
                handlerParams = params
                assert.equal(params.expectedDatasetRevision, "dataset-revision-3")
                assert.equal(
                    trustedFacts.evaluationSelection.datasetRevision,
                    "dataset-revision-3",
                )
                return {runId: "run-frozen"}
            }},
        })
        const result = await restarted.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
        })
        assert.equal(result.status, "succeeded")
        assert.equal(resolverCalls, 1)
        assert.equal(handlerCalls, 1)
        assert.equal(handlerParams.selectionMode, "selected")
        assert.deepEqual(handlerParams.caseIds, ["case-1", "case-2", "case-3"])
        assert.equal(handlerParams.expectedDatasetRevision, "dataset-revision-3")
    })

    it("lets the Evaluation handler fail closed when the frozen Dataset revision changed", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id, {budget: budget({
            maxEvaluations: 0,
            maxTargetExecutions: 0,
        })})
        let currentDatasetRevision = "dataset-revision-1"
        const engine = new OperatorJobEngine({
            store,
            resolveEvaluationCaseCount: async () => ({
                caseIds: ["case-1"],
                datasetRevision: "dataset-revision-1",
            }),
            handlers: {"evaluations.start": async ({params, trustedFacts}) => {
                assert.equal(
                    params.expectedDatasetRevision,
                    trustedFacts.evaluationSelection.datasetRevision,
                )
                if (params.expectedDatasetRevision !== currentDatasetRevision) {
                    throw Object.assign(new Error("Dataset revision changed after selection was frozen"), {
                        code: "DATASET_REVISION_MISMATCH",
                    })
                }
                return {runId: "must-not-run"}
            }},
        })
        const waiting = await engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: [],
                selectionMode: "dataset",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
            },
            idempotencyKey: "dataset-revision-mismatch",
        })

        currentDatasetRevision = "dataset-revision-2"
        const result = await engine.resolveApproval(waiting.approvalId, {
            decision: "approve",
            scope: "action",
        })
        assert.equal(result.status, "failed")
        assert.equal(result.error.code, "DATASET_REVISION_MISMATCH")
    })

    it("fails Dataset hard-budget preflight when a legacy resolver returns only a count", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        const engine = new OperatorJobEngine({
            store,
            resolveEvaluationCaseCount: async () => 3,
        })

        await assert.rejects(() => engine.execute(job.id, {
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: [],
                selectionMode: "dataset",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
            },
            idempotencyKey: "legacy-count-only",
        }), (error) => error.code === "BUDGET_SELECTION_UNRESOLVED")
        assert.equal(store.listSteps({jobId: job.id}).length, 0)
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

    it("segments a safe-integer duration without relying on Node's one-millisecond overflow timer", async () => {
        const {store, session} = fixture()
        const maximumTimerDelay = 2_147_483_647
        const job = createJob(store, session.id, {
            budget: budget({maxDurationMs: maximumTimerDelay + 10_000}),
        })
        const observedDelays = []
        const nativeSetTimeout = global.setTimeout
        global.setTimeout = (callback, delay, ...args) => {
            observedDelays.push(delay)
            return nativeSetTimeout(callback, Math.min(delay, 25), ...args)
        }
        try {
            const engine = new OperatorJobEngine({
                store,
                handlers: {"datasets.read": async () => ({ok: true})},
            })
            assert.equal((await engine.execute(job.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "large-duration",
            })).status, "succeeded")
        } finally {
            global.setTimeout = nativeSetTimeout
        }
        assert.equal(observedDelays.some((delay) => delay > maximumTimerDelay), false)
        assert.equal(observedDelays.includes(maximumTimerDelay), true)
        assert.equal(observedDelays.includes(1), false)
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

    it("cancels without waiting for hanging trusted pre-invoke work or a signal-ignoring handler", async () => {
        for (const phase of ["case_resolver", "telemetry", "decider", "handler"]) {
            const {store, session} = fixture()
            const job = createJob(store, session.id, {objective: phase})
            let markStarted
            let hookSignalAborted = false
            const started = new Promise((resolve) => { markStarted = resolve })
            const hangs = (...args) => {
                markStarted()
                const signal = args.at(-1)?.signal
                signal?.addEventListener("abort", () => { hookSignalAborted = true }, {once: true})
                return new Promise(() => {})
            }
            const options = {store, externalAwaitTimeoutMs: 5_000}
            let request = {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: `hanging-${phase}`,
            }
            if (phase === "case_resolver") {
                options.resolveEvaluationCaseCount = hangs
                request = {
                    method: "evaluations.start",
                    params: {
                        datasetId: "dataset-1",
                        caseIds: [],
                        selectionMode: "dataset",
                        runtimeConfigurations: [{runtimeId: "runtime-1"}],
                        judgeConfiguration: {runtimeId: "judge-1"},
                    },
                    idempotencyKey: `hanging-${phase}`,
                }
            } else if (phase === "telemetry") {
                options.runtimeTelemetry = hangs
            } else if (phase === "decider") {
                options.approvalDecider = hangs
            } else {
                options.handlers = {"datasets.read": hangs}
            }
            const engine = new OperatorJobEngine(options)
            const execution = engine.execute(job.id, request)
            await started
            const cancellation = engine.cancel(job.id)
            const results = await Promise.race([
                Promise.all([execution, cancellation]),
                new Promise((_resolve, reject) => setTimeout(
                    () => reject(new Error(`Cancellation waited for hanging ${phase}`)),
                    500,
                )),
            ])
            assert.equal(results[0].status, "cancelled")
            assert.equal(results[1].status, "cancelled")
            assert.equal(store.getJob(job.id).status, "cancelled")
            assert.equal(hookSignalAborted, true, phase)
        }
    })

    it("interrupts a hanging Runtime Step into durable recovery without waiting for its handler", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        let started
        const entered = new Promise((resolve) => { started = resolve })
        const never = new Promise(() => {})
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.read": async () => {
                    started()
                    return never
                },
            },
        })
        const execution = engine.execute(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "runtime-interruption",
        })
        await entered

        const interrupted = await engine.interrupt(job.id, {
            code: "OPERATOR_RUNTIME_FAILED",
            message: "Operator Runtime failed",
        })
        const result = await execution

        assert.equal(interrupted.status, "needs_recovery")
        assert.equal(result.status, "needs_recovery")
        assert.equal(store.listSteps({jobId: job.id})[0].status, "needs_recovery")
    })

    it("preserves a pending approval when interruption happens before handler execution", async () => {
        const {store, session} = fixture()
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        const step = store.createStep(job.id, {
            method: "evaluations.start",
            params: {datasetId: "dataset-1"},
            reservation: {evaluations: 1},
            idempotencyKey: "approval-before-handler",
        })
        store.transitionStep(step.id, "waiting_approval")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            stepId: step.id,
            action: "evaluations.execute",
            scope: {datasetIds: ["dataset-1"]},
            proposedMutation: {
                method: "evaluations.start",
                params: {datasetId: "dataset-1"},
                reservation: {evaluations: 1},
                idempotencyKey: "approval-before-handler",
            },
            risk: "budget_expansion",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })
        const engine = new OperatorJobEngine({store})

        const interrupted = await engine.interrupt(job.id, {
            code: "OPERATOR_RUNTIME_FAILED",
            message: "Operator Runtime failed",
        })

        assert.equal(interrupted.status, "waiting_approval")
        assert.equal(store.getJob(job.id).status, "waiting_approval")
        assert.equal(store.getStep(step.id).status, "waiting_approval")
        assert.equal(store.getApproval(approval.id).status, "pending")
    })

    it("checks cancellation before invoking the next hook and aborts a timed-out hook signal", async () => {
        const cancelledFixture = fixture()
        const cancelledJob = createJob(cancelledFixture.store, cancelledFixture.session.id)
        let deciderCalls = 0
        let cancelEngine
        cancelEngine = new OperatorJobEngine({
            store: cancelledFixture.store,
            runtimeTelemetry: () => {
                queueMicrotask(() => { void cancelEngine.cancel(cancelledJob.id) })
                return []
            },
            approvalDecider: () => {
                deciderCalls += 1
                return {decision: "allow"}
            },
        })
        const cancelled = await cancelEngine.execute(cancelledJob.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "cancel-between-hooks",
        })
        assert.equal(cancelled.status, "cancelled")
        assert.equal(deciderCalls, 0)

        const timeoutFixture = fixture()
        const timeoutJob = createJob(timeoutFixture.store, timeoutFixture.session.id)
        let hookSignalAborted = false
        const timeoutEngine = new OperatorJobEngine({
            store: timeoutFixture.store,
            externalAwaitTimeoutMs: 10,
            runtimeTelemetry: ({signal}) => new Promise((_resolve, reject) => {
                signal.addEventListener("abort", () => {
                    hookSignalAborted = true
                    reject(signal.reason)
                }, {once: true})
            }),
        })
        await assert.rejects(() => timeoutEngine.execute(timeoutJob.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "timeout-hook-signal",
        }), /timed out/iu)
        assert.equal(hookSignalAborted, true)
    })

    it("does not invoke a later reconciler after telemetry cancels recovery in the same tick", async () => {
        const {path, store, session} = fixture()
        const job = createJob(store, session.id)
        createUncertainStep(store, job, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "recovery-read-before-cancel",
        })
        const evaluation = store.createStep(job.id, {
            method: "evaluations.start",
            params: {runId: "run-after-cancel"},
            idempotencyKey: "recovery-evaluation-after-cancel",
        })
        store.transitionStep(evaluation.id, "running")
        store.transitionStep(evaluation.id, "needs_recovery", {
            error: {code: "OPERATOR_INTERRUPTED", message: "outcome unknown"},
        })
        store.close()

        const recoveredStore = new OperatorJobStore(path)
        let reconcilerCalls = 0
        let engine
        engine = new OperatorJobEngine({
            store: recoveredStore,
            runtimeTelemetry: () => {
                queueMicrotask(() => { void engine.cancel(job.id) })
                return []
            },
            reconcilers: {
                evaluation: () => {
                    reconcilerCalls += 1
                    return {status: "completed", result: {runId: "run-after-cancel"}}
                },
            },
        })

        assert.equal((await engine.reconcile(job.id)).status, "cancelled")
        assert.equal(reconcilerCalls, 0)
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
        store.close()
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
        restartFixture.store.close()
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
        store.close()
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

        store.close()
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
        store.close()
        const restarted = new OperatorJobStore(path)
        const engine = new OperatorJobEngine({
            store: restarted,
            reconcilers: {
                installation: async () => ({
                    status: "installed",
                    installationId: "installation-1",
                    runtimeId: "runtime-1",
                    skillId: "skill-1",
                    versionId: "version-1",
                    result: {
                        installationId: "installation-1",
                        runtimeId: "runtime-other",
                        skillId: "skill-1",
                        versionId: "version-1",
                    },
                }),
            },
        })
        await engine.reconcile(job.id)
        assert.equal(restarted.getStep(step.id).status, "needs_recovery")
        assert.equal(restarted.getJob(job.id).status, "needs_recovery")
    })
})
