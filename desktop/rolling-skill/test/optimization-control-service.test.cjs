"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

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

function snapshot(revision) {
    return {
        digest: digest(String(revision)),
        baseline: {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            commit: "a".repeat(40),
            contentDigest: digest("a"),
        },
        dataset: {id: "dataset-1", revision, digest: digest("d")},
        rubric: {id: "rubric-1", version: 4, digest: digest("r")},
        operator: config().operator,
        targets: config().targets,
        judge: config().judge,
        limits: config().limits,
        target: config().target,
        telemetry: config().telemetry,
    }
}

function fixture() {
    let trustedRevision = 7
    const runs = new Map()
    const preflightCalls = []
    const freezeCalls = []
    const workspaceCalls = []
    const operatorCalls = []
    const runnerCalls = []
    const artifactCalls = []
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
        readArtifact: () => null,
        async resolvePreflight(input) {
            preflightCalls.push(structuredClone(input))
            return {trustedRevision}
        },
        freezeRun(input) {
            freezeCalls.push(structuredClone(input))
            return snapshot(input.trusted.trustedRevision)
        },
        clock: () => "2026-08-25T08:00:00.000Z",
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
        runnerCalls,
        artifactCalls,
        setTrustedRevision(value) { trustedRevision = value },
        setRunState(state, checkpoint = {}) {
            const run = runs.get("optimization-run-1")
            run.state = state
            Object.assign(run.checkpoint, structuredClone(checkpoint))
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
        assert.equal(context.preflightCalls.length, 2)
        assert.equal(context.store.createOptions.idempotencyKey, "start-1")
        assert.equal(context.workspaceCalls.length, 1)
        assert.equal(context.operatorCalls.length, 1)
        assert.deepEqual(context.operatorCalls[0].managedSkillBinding, {
            repositoryId: "repository-1",
            skillId: "skill-1",
            optimizationRunId: "optimization-run-1",
        })
        assert.deepEqual(context.operatorCalls[0].actions, [
            "optimizations.read",
            "optimizations.execute",
        ])
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
        }, {sessionId: "operator-session-1"})
        const decision = context.service.submitDecision({
            runId: "optimization-run-1",
            decision: {schemaVersion: "rolling-skill-optimization-decision/v1", action: "finish", rationale: "Done", observations: []},
            limitRequest: null,
        }, {sessionId: "operator-session-1"})
        assert.deepEqual(candidate, {accepted: {runId: "optimization-run-1", kind: "candidate"}})
        assert.deepEqual(decision, {accepted: {runId: "optimization-run-1", kind: "decision"}})
        assert.equal(context.gatewayCalls[0].input.operatorSessionId, "operator-session-1")
        assert.equal(context.gatewayCalls[1].input.operatorSessionId, "operator-session-1")

        await context.service.pause("optimization-run-1")
        await assert.rejects(
            () => context.service.resume("optimization-run-1"),
            /startup recovery|recovery.*complete/iu,
        )
        await context.service.recoverStartup()
        await context.service.resume("optimization-run-1")
        await context.service.stop("optimization-run-1")
        assert.equal(context.runner.paused, "optimization-run-1")
        assert.equal(context.runner.resumed, "optimization-run-1")
        assert.equal(context.runner.stopped, "optimization-run-1")
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

    it("persists a report Artifact on the owning Operator Job and exposes it from the Run", async () => {
        const context = fixture()
        await context.service.start({...config(), idempotencyKey: "start-3"})

        const result = context.service.report("optimization-run-1")

        assert.equal(context.artifactCalls[0].jobId, "operator-job-1")
        assert.equal(result.report.artifactId, "report-artifact-1")
        assert.match(result.report.digest, /^sha256:[a-f0-9]{64}$/u)
        const stored = context.store.getRun("optimization-run-1")
        assert.equal(stored.checkpoint.reportArtifactId, "report-artifact-1")
        assert.equal(stored.checkpoint.reportDigest, result.report.digest)
    })
})
