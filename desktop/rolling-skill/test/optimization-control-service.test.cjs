"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {OperatorJobStore} = require("../src/operator/job-store.cjs")

const {
    OptimizationControlService,
} = require("../src/optimization/optimization-control-service.cjs")

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function config() {
    return {
        skillId: "skill-1",
        baselineVersionId: "version-1",
        datasetId: "dataset-1",
        operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
        targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"}],
        judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "high"},
        activationMode: "automatic",
        limits: {maxEpochs: 3},
    }
}

function legacyConfig() {
    return {
        ...config(),
        mode: "adaptive",
        limits: {
            maxEpochs: 3,
            maxDurationMs: 3_600_000,
            patience: 2,
            minimumImprovement: 1,
            maxTurns: 50,
            maxTokens: null,
            maxCostMicros: null,
        },
        target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
        telemetry: {tokens: false, cost: false},
    }
}

function snapshot(revision, {legacy = false} = {}) {
    const currentConfig = legacy ? legacyConfig() : config()
    return {
        schemaVersion: legacy
            ? "rolling-skill-frozen-optimization-run/v1"
            : "rolling-skill-frozen-optimization-run/v2",
        digest: digest(String(revision)),
        baseline: {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            commit: "a".repeat(40),
            skillName: "billing-cost-management",
            skillRoot: ".",
            contentDigest: digest("a"),
        },
        dataset: {id: "dataset-1", revision, digest: digest("d")},
        rubric: {id: "rubric-1", version: 4, digest: digest("r")},
        operator: currentConfig.operator,
        targets: currentConfig.targets,
        judge: currentConfig.judge,
        activationMode: currentConfig.activationMode,
        limits: currentConfig.limits,
        ...(legacy ? {
            mode: currentConfig.mode,
            target: currentConfig.target,
            telemetry: currentConfig.telemetry,
        } : {}),
    }
}

function fixture(options = {}) {
    let trustedRevision = 7
    const runs = new Map()
    const preflightCalls = []
    const freezeCalls = []
    const workspaceCalls = []
    const operatorCalls = []
    const runnerCalls = []
    const artifactCalls = []
    const artifactBodies = new Map()
    const artifactReadLimits = []
    const gatewayCalls = []
    const store = {
        createRun(frozen, options) {
            const run = {
                id: "optimization-run-1",
                state: "preflight",
                revision: 0,
                currentEpoch: 0,
                snapshot: structuredClone(frozen),
                epochs: [],
                checkpoint: {},
                error: null,
                createdAt: "2026-08-25T08:00:00.000Z",
            }
            runs.set(run.id, run)
            this.createOptions = structuredClone(options)
            return {runId: run.id}
        },
        getRun(runId) {
            const run = runs.get(runId)
            if (!run) throw new Error("Unknown run")
            return structuredClone(run)
        },
        listRuns() { return [...runs.values()].map((run) => structuredClone(run)) },
        updateCheckpoint(runId, patch) {
            const run = runs.get(runId)
            Object.assign(run.checkpoint, structuredClone(patch))
            run.revision += 1
            return structuredClone(run)
        },
    }
    const workspace = {
        runId: "optimization-run-1",
        repositoryId: "repository-1",
        skillId: "skill-1",
        versionId: "version-1",
        workspacePath: "/app-support/optimization-workspaces/optimization-run-1",
        branchName: "rolling-skill/optimization/optimization-run-1",
        baselineCommit: "a".repeat(40),
    }
    const workspaceManager = {
        async create(run) {
            workspaceCalls.push(structuredClone(run))
            return structuredClone(workspace)
        },
        async cleanup() {},
        async recover(run, expected) {
            workspaceCalls.push({recover: run.id, expected: structuredClone(expected)})
            return structuredClone(expected)
        },
    }
    const operatorSessionManager = {
        async create(input) {
            operatorCalls.push(structuredClone(input))
            return {
                session: {id: "operator-session-1"},
                parentJob: {id: "operator-job-1"},
            }
        },
    }
    const runner = {
        run(runId, context) {
            runnerCalls.push({runId, context: structuredClone(context)})
            return Promise.resolve({runId, status: "succeeded"})
        },
        pause(runId) { this.paused = runId },
        resume(runId) { this.resumed = runId; return Promise.resolve() },
        resumeFinalApproval(runId, context) {
            this.finalApprovalResumed = {runId, context: structuredClone(context)}
            return new Promise(() => {})
        },
        stop(runId) { this.stopped = runId },
    }
    const gateway = {
        submitCandidate(input) {
            gatewayCalls.push({kind: "candidate", input: structuredClone(input)})
            return {runId: input.runId, kind: "candidate"}
        },
        submitDecision(input) {
            gatewayCalls.push({kind: "decision", input: structuredClone(input)})
            return {runId: input.runId, kind: "decision"}
        },
    }
    const artifactStore = {
        createArtifact(jobId, input) {
            artifactCalls.push({jobId, input: structuredClone(input)})
            return {id: "report-artifact-1", ...structuredClone(input)}
        },
    }
    const service = new OptimizationControlService({
        store,
        workspaceManager,
        operatorSessionManager,
        runner,
        operatorGateway: gateway,
        artifactStore,
        readArtifact: (artifactId, maximumBytes) => {
            artifactReadLimits.push({artifactId, maximumBytes})
            return artifactBodies.get(artifactId) ?? null
        },
        async resolvePreflight(input) {
            preflightCalls.push(structuredClone(input))
            return {trustedRevision}
        },
        freezeRun(input) {
            freezeCalls.push(structuredClone(input))
            const frozen = snapshot(input.trusted.trustedRevision, {
                legacy: Object.hasOwn(input.config, "mode"),
            })
            frozen.limits = structuredClone(input.config.limits)
            return frozen
        },
        clock: () => "2026-08-25T08:00:00.000Z",
        ...options,
    })
    return {
        service,
        store,
        runner,
        gatewayCalls,
        preflightCalls,
        freezeCalls,
        workspaceCalls,
        operatorCalls,
        operatorSessionManager,
        runnerCalls,
        artifactCalls,
        artifactBodies,
        artifactReadLimits,
        setTrustedRevision(value) { trustedRevision = value },
        setRunState(state, checkpoint = {}, recovery = undefined) {
            const run = runs.get("optimization-run-1")
            run.state = state
            Object.assign(run.checkpoint, structuredClone(checkpoint))
            if (recovery !== undefined) run.recovery = structuredClone(recovery)
        },
        setRunEpochs(epochs, checkpoint = {}) {
            const run = runs.get("optimization-run-1")
            run.epochs = structuredClone(epochs)
            Object.assign(run.checkpoint, structuredClone(checkpoint))
            run.currentEpoch = epochs.at(-1)?.number ?? 0
            run.revision += 1
        },
    }
}

describe("Optimization control service", () => {
    it("freezes at start, creates the experiment workspace and launches a scoped Operator Runner", async () => {
        const context = fixture()
        const first = await context.service.preflight(config())
        assert.equal(first.snapshotDigest, digest("7"))
        context.setTrustedRevision(8)

        const started = await context.service.start({...config(), idempotencyKey: "start-1"})

        assert.equal(started.run.snapshotDigest, digest("8"))
        assert.deepEqual(started.run.limits, config().limits)
        assert.deepEqual(started.run.operator, config().operator)
        assert.deepEqual(started.run.judge, config().judge)
        assert.equal(context.preflightCalls.length, 2)
        assert.equal(context.store.createOptions.idempotencyKey, "start-1")
        assert.equal(context.workspaceCalls.length, 1)
        assert.equal(context.operatorCalls.length, 1)
        assert.equal(
            context.operatorCalls[0].title,
            "Skill 自动优化 · billing-cost-management · optimization-run-1",
        )
        assert.deepEqual(context.operatorCalls[0].managedSkillBinding, {
            repositoryId: "repository-1",
            skillId: "skill-1",
            optimizationRunId: "optimization-run-1",
        })
        assert.deepEqual(context.operatorCalls[0].actions, [
            "optimizations.read",
            "optimizations.execute",
        ])
        assert.deepEqual(context.operatorCalls[0].budget, {})
        assert.equal(Object.hasOwn(context.operatorCalls[0], "expiresInMs"), false)
        assert.deepEqual(context.runnerCalls, [{
            runId: "optimization-run-1",
            context: {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
                workspace: context.runnerCalls[0].context.workspace,
            },
        }])
        assert.equal(context.runnerCalls[0].context.workspace.workspacePath, "/app-support/optimization-workspaces/optimization-run-1")

        context.setTrustedRevision(9)
        assert.equal((await context.service.get("optimization-run-1")).run.dataset.revision, 8)
        assert.deepEqual(context.service.scope("optimization-run-1"), {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["codex:operator", "codex:judge", "codex:target"],
            repositoryIds: ["repository-1"],
        })
    })

    it("routes bounded submissions with the caller session and exposes lifecycle controls", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "start-2"})
        const candidate = context.service.submitCandidate({
            runId: "optimization-run-1",
            message: "Improve owner drilldown",
        }, {sessionId: "rotating-capability-session", operatorSessionId: "operator-session-1"})
        const decision = context.service.submitDecision({
            runId: "optimization-run-1",
            decision: {schemaVersion: "rolling-skill-optimization-decision/v1", action: "finish", rationale: "Done", observations: []},
        }, {sessionId: "operator-session-1"})
        assert.deepEqual(candidate, {accepted: {runId: "optimization-run-1", kind: "candidate"}})
        assert.deepEqual(decision, {accepted: {runId: "optimization-run-1", kind: "decision"}})
        assert.equal(context.gatewayCalls[0].input.operatorSessionId, "operator-session-1")
        assert.equal(context.gatewayCalls[1].input.operatorSessionId, "operator-session-1")
        assert.equal(Object.hasOwn(context.gatewayCalls[1].input, "limitRequest"), false)

        await context.service.pause("optimization-run-1")
        await assert.rejects(
            () => context.service.resume("optimization-run-1"),
            /startup recovery|recovery.*complete/iu,
        )
        await context.service.recoverStartup()
        context.setRunState("needs_recovery", {paused: true})
        await context.service.resume("optimization-run-1")
        await context.service.stop("optimization-run-1")
        assert.equal(context.runner.paused, "optimization-run-1")
        assert.equal(context.runner.resumed, "optimization-run-1")
        assert.equal(context.runner.stopped, "optimization-run-1")
    })

    it("restarts a paused v2 Operator without calculating any remaining usage budget", async () => {
        let now = "2026-08-25T08:00:00.000Z"
        const context = fixture({
            clock: () => now,
            operatorTurnsUsed: () => {throw new Error("v2 must not read Agent Turn usage")},
        })
        await context.service.start({...config(), idempotencyKey: "restart-budget"})
        now = "2036-08-25T08:10:00.000Z"
        context.setRunState("needs_recovery", {paused: true, operatorTurnsUsedBefore: 3, baselineEvaluationRunId: "baseline-1"})
        await context.service.recoverStartup()
        context.runner.resume = () => new Promise(() => {})
        const resumed = await Promise.race([context.service.resume("optimization-run-1"), new Promise((resolve) => setImmediate(() => resolve(null)))])
        assert.ok(resumed, "Resume returns once dispatched, not when the multi-minute run finishes")
        const request = context.operatorCalls.at(-1)
        assert.equal(request.modelId, config().operator.modelId)
        assert.equal(request.effort, config().operator.effort)
        assert.deepEqual(request.budget, {})
        assert.equal(Object.hasOwn(request, "expiresInMs"), false)
        assert.equal(Object.hasOwn(
            context.store.getRun("optimization-run-1").checkpoint,
            "operatorTurnsUsedBefore",
        ), true, "legacy checkpoint data remains readable but is not recalculated")
    })

    it("keeps the remaining-budget branch only for a paused legacy v1 run", async () => {
        let now = "2026-08-25T08:00:00.000Z"
        const context = fixture({clock: () => now, operatorTurnsUsed: () => 2})
        await context.service.start({...legacyConfig(), idempotencyKey: "restart-legacy-budget"})
        now = "2026-08-25T08:10:00.000Z"
        context.setRunState("needs_recovery", {
            paused: true,
            operatorTurnsUsedBefore: 3,
            baselineEvaluationRunId: "baseline-1",
        })
        await context.service.recoverStartup()
        context.runner.resume = () => new Promise(() => {})
        await context.service.resume("optimization-run-1")

        const request = context.operatorCalls.at(-1)
        assert.equal(request.budget.maxDurationMs, 3_000_000)
        assert.equal(request.budget.maxRuntimeTurns, 45)
        assert.equal(request.budget.maxEvaluations, 4)
    })

    it("reports rejected resume preparation and stops the orphaned Operator", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "resume-failure"})
        context.setRunState("needs_recovery", {paused: true})
        await context.service.recoverStartup()
        const stopped = []
        context.operatorSessionManager.stop = async (id) => stopped.push(id)
        context.runner.resume = () => {throw new Error("Resume evidence is missing")}
        await assert.rejects(context.service.resume("optimization-run-1"), /Resume evidence is missing/)
        assert.equal(stopped.at(-1), "operator-session-1")
        assert.equal(context.store.getRun("optimization-run-1").state, "needs_recovery")
    })

    it("hydrates only bounded Epoch, installation, and recovery summaries from Artifacts", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "start-summary"})
        context.artifactBodies.set("candidate-1", Buffer.from(JSON.stringify({
            id: "version-candidate-1",
            commit: "b".repeat(40),
            contentDigest: digest("b"),
            workspacePath: "/must/not/reach-renderer",
        })))
        context.artifactBodies.set("installations-1", JSON.stringify({
            operation: "experiment_install",
            jobs: [{
                id: "install-job-1",
                status: "succeeded",
                runtime: {runtimeId: "codex:target"},
                parsedResult: {
                    destination: "/runtime/skills/billing",
                    result: {actualDigest: digest("b")},
                },
                rawResult: "must not reach Renderer",
            }],
        }))
        context.artifactBodies.set("analysis-1", {
            body: JSON.stringify({
                score: 91,
                scoreDelta: 7,
                passRate: 0.9,
                regressed: [{caseId: "case-1", runtimeId: "codex:target"}],
                improved: [{caseId: "case-2", runtimeId: "codex:target"}],
            }),
        })
        context.artifactBodies.set("decision-1", JSON.stringify({
            action: "continue",
            rationale: "继续处理回归",
            observations: [{kind: "private", summary: "must stay lazy"}],
        }))
        context.setRunEpochs([{
            id: "epoch-1",
            number: 1,
            status: "completed",
            candidateArtifactId: "candidate-1",
            installArtifactIds: ["installations-1"],
            evaluationArtifactIds: ["evaluation-1"],
            analysisArtifactId: "analysis-1",
            decisionArtifactId: "decision-1",
        }], {
            installationOperation: "experiment_inspect",
            installationPending: true,
            installationJobIds: ["inspection-job-1"],
            paused: false,
            pauseReason: "user_pause",
            telemetry: {elapsedMs: 1_000, turnsUsed: 2, tokens: null, costMicros: null},
            recoveryTargets: [{
                runtimeId: "codex:target",
                status: "needs_recovery",
                installationJobId: "restore-job-1",
                operation: "experiment_restore",
                destination: "/runtime/skills/billing",
                lastVerifiedDigest: digest("c"),
                workspacePath: "/must/not/reach-renderer",
            }],
        })

        const output = await context.service.get("optimization-run-1")

        assert.equal(output.run.checkpoint.installationOperation, "experiment_inspect")
        assert.equal(output.run.checkpoint.installationPending, true)
        assert.deepEqual(output.run.checkpoint.installationJobIds, ["inspection-job-1"])
        assert.equal(output.run.checkpoint.pauseReason, undefined)
        assert.deepEqual(output.run.epochs[0].candidate, {
            versionId: "version-candidate-1",
            commit: "b".repeat(40),
            contentDigest: digest("b"),
        })
        assert.deepEqual(output.run.epochs[0].installations, [{
            runtimeId: "codex:target",
            status: "succeeded",
            installationJobId: "install-job-1",
            operation: "experiment_install",
            destination: "/runtime/skills/billing",
            lastVerifiedDigest: digest("b"),
        }])
        assert.deepEqual(output.run.epochs[0].analysis, {
            score: 91,
            scoreDelta: 7,
            passRate: 0.9,
            regressionCount: 1,
        })
        assert.deepEqual(output.run.epochs[0].decision, {
            action: "continue",
            rationale: "继续处理回归",
        })
        assert.deepEqual(output.run.checkpoint.recoveryTargets, [{
            runtimeId: "codex:target",
            status: "needs_recovery",
            installationJobId: "restore-job-1",
            operation: "experiment_restore",
            destination: "/runtime/skills/billing",
            lastVerifiedDigest: digest("c"),
        }])
        assert.equal(output.run.checkpoint.telemetry, undefined)
        assert.ok(context.artifactReadLimits.length >= 4)
        assert.ok(context.artifactReadLimits.every(({maximumBytes}) => maximumBytes === 1024 * 1024))
        assert.doesNotMatch(JSON.stringify(output), /workspacePath|rawResult|observations/u)
    })

    it("exposes every persisted Epoch above the former 100-Epoch display cap", async () => {
        const context = fixture()
        await context.service.start({
            ...config(),
            limits: {maxEpochs: 101},
            idempotencyKey: "start-101-epochs",
        })
        context.setRunEpochs(Array.from({length: 101}, (_, index) => ({
            id: `epoch-${index + 1}`,
            number: index + 1,
            status: "completed",
            candidateArtifactId: null,
            installArtifactIds: [],
            evaluationArtifactIds: [],
            analysisArtifactId: null,
            decisionArtifactId: null,
        })))

        const output = context.service.get("optimization-run-1")
        assert.equal(output.run.currentEpoch, 101)
        assert.equal(output.run.epochs.length, 101)
        assert.equal(output.run.epochs.at(-1).number, 101)
    })

    it("adopts persisted workspaces before enabling resume", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "start-recovery"})
        const persistedWorkspace = context.runnerCalls[0].context.workspace
        context.setRunState("needs_recovery", {
            paused: true,
            workspace: persistedWorkspace,
        })

        const recovered = await context.service.recoverStartup()
        await context.service.resume("optimization-run-1")

        assert.deepEqual(recovered, [{runId: "optimization-run-1", status: "ready"}])
        assert.equal(context.workspaceCalls.some((entry) => entry.recover === "optimization-run-1"), true)
        assert.equal(context.runner.resumed, "optimization-run-1")
    })

    it("reattaches an interrupted persisted final approval without starting another Agent", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "recover-final-approval"})
        const persistedWorkspace = context.runnerCalls[0].context.workspace
        context.setRunState("needs_recovery", {
            workspace: persistedWorkspace,
            operatorSessionId: "operator-session-1",
            operatorParentJobId: "operator-job-1",
        }, {
            previousState: "waiting_approval",
            reason: "process_interrupted",
            recoveredAt: "2026-08-25T08:01:00.000Z",
        })

        const recovered = await Promise.race([
            context.service.recoverStartup(),
            new Promise((resolve) => setImmediate(() => resolve(null))),
        ])

        assert.ok(recovered, "Startup recovery returns after dispatch instead of waiting for user approval")
        assert.deepEqual(recovered, [{runId: "optimization-run-1", status: "waiting_approval"}])
        assert.equal(context.workspaceCalls.some((entry) => entry.recover === "optimization-run-1"), true)
        assert.deepEqual(context.runner.finalApprovalResumed, {
            runId: "optimization-run-1",
            context: {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
                workspace: persistedWorkspace,
            },
        })
        assert.equal(context.operatorCalls.length, 1, "The persisted approval keeps its original Operator Job")
    })

    it("reattaches the same preserved approval after the App was cleanly closed", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "resume-closed-final-approval"})
        const persistedWorkspace = context.runnerCalls[0].context.workspace
        context.setRunState("needs_recovery", {
            workspace: persistedWorkspace,
            paused: true,
            resumePhase: "final_approval",
            operatorSessionId: "operator-session-1",
            operatorParentJobId: "operator-job-1",
        })
        const recovered = await context.service.recoverStartup()

        assert.deepEqual(recovered, [{runId: "optimization-run-1", status: "waiting_approval"}])
        assert.equal(context.operatorCalls.length, 1)
        assert.deepEqual(context.runner.finalApprovalResumed, {
            runId: "optimization-run-1",
            context: {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
                workspace: persistedWorkspace,
            },
        })
        assert.equal(context.runner.resumed, undefined)
    })

    it("resumes a user-paused final approval on its original Operator without starting another Agent", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "resume-paused-final-approval"})
        await context.service.recoverStartup()
        const persistedWorkspace = context.runnerCalls[0].context.workspace
        context.setRunState("needs_recovery", {
            workspace: persistedWorkspace,
            paused: true,
            resumePhase: "final_approval",
            operatorSessionId: "operator-session-1",
            operatorParentJobId: "operator-job-1",
        })
        let replacementOperators = 0
        context.operatorSessionManager.create = async () => {
            replacementOperators += 1
            throw new Error("Final approval resume must not create another Agent")
        }

        const resumed = await Promise.race([
            context.service.resume("optimization-run-1"),
            new Promise((resolve) => setImmediate(() => resolve(null))),
        ])

        assert.ok(resumed, "Resume returns after reattaching the persisted approval")
        assert.equal(replacementOperators, 0)
        assert.deepEqual(context.runner.finalApprovalResumed, {
            runId: "optimization-run-1",
            context: {
                operatorSessionId: "operator-session-1",
                parentJobId: "operator-job-1",
                workspace: persistedWorkspace,
            },
        })
        assert.equal(context.runner.resumed, undefined)
    })

    it("persists a report Artifact on the owning Operator Job and exposes it from the Run", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "start-3"})

        const result = context.service.report("optimization-run-1")

        assert.equal(context.artifactCalls[0].jobId, "operator-job-1")
        assert.equal(result.report.artifactId, "report-artifact-1")
        assert.match(result.report.digest, /^sha256:[a-f0-9]{64}$/u)
        assert.match(result.report.preview, /^# Skill 多轮优化报告/u)
        assert.ok(result.report.preview.length <= 32 * 1024)
        const stored = context.store.getRun("optimization-run-1")
        assert.equal(stored.checkpoint.reportArtifactId, "report-artifact-1")
        assert.equal(stored.checkpoint.reportDigest, result.report.digest)
    })

    it("renders a terminal Run report without writing into its real closed Operator Job", async (t) => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-terminal-report-"))
        const jobs = new OperatorJobStore(join(root, "jobs.json"))
        t.after(() => { jobs.close(); rmSync(root, {recursive: true, force: true}) })
        const session = jobs.createSession({runtime: {runtimeId: "codex:one", providerId: "codex", displayName: "Codex", version: "1", executablePath: "/usr/bin/codex"}, modelId: "chosen-model", effort: "high", protocol: "rolling-skill-operator/v1", capabilityId: "capability-1"})
        const job = jobs.createJob({sessionId: session.id, type: "operator-session", objective: "Finished optimization", budget: {maxDurationMs: 60000, maxRuntimeTurns: 20, maxEvaluations: 3, maxTargetExecutions: 9, maxJudgeExecutions: 9, maxTokens: null, maxReportedCost: null}})
        jobs.transitionJob(job.id, "running")
        jobs.transitionJob(job.id, "cancelling")
        jobs.transitionJob(job.id, "cancelled")
        const context = fixture({artifactStore: jobs})
        await context.service.start({...config(), idempotencyKey: "terminal-report"})
        context.setRunState("cancelled", {operatorParentJobId: job.id})
        const beforeJob = jobs.getJob(job.id)
        const beforeRun = context.store.getRun("optimization-run-1")
        const result = context.service.report("optimization-run-1")
        assert.equal(result.report.artifactId, null, "derived preview must not invent a persisted Artifact")
        assert.match(result.report.preview, /^# Skill 多轮优化报告/u)
        assert.deepEqual(jobs.getJob(job.id), beforeJob)
        assert.deepEqual(context.store.getRun("optimization-run-1"), beforeRun)
        assert.deepEqual(jobs.listArtifacts(job.id), [])
    })
})
