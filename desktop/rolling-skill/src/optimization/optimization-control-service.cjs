"use strict"

const {
    freezeOptimizationRun,
    parseOptimizationConfig,
} = require("./optimization-contract.cjs")
const {persistOptimizationReport} = require("./optimization-report.cjs")

function dependency(value, method, label) {
    if (!value || typeof value[method] !== "function") {
        throw new Error(`${label} with ${method}() is required`)
    }
    return value
}

function requiredText(value, label, maximum = 300) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function normalizedConfig(value) {
    const {schemaVersion: _schemaVersion, ...config} = parseOptimizationConfig(value)
    return structuredClone(config)
}

function publicCheckpoint(value = {}) {
    const fields = [
        "paused",
        "pauseReason",
        "stopReason",
        "reportArtifactId",
        "reportDigest",
        "releaseApprovalId",
        "installApprovalId",
        "releasedVersionId",
        "finalEvaluationArtifactId",
        "finalRegressionPassed",
    ]
    return Object.fromEntries(fields
        .filter((field) => value[field] !== undefined)
        .map((field) => [field, structuredClone(value[field])]))
}

function publicRun(run) {
    const snapshot = run.snapshot ?? {}
    return {
        id: run.id,
        state: run.state,
        revision: run.revision,
        currentEpoch: run.currentEpoch,
        snapshotDigest: snapshot.digest,
        baseline: {
            repositoryId: snapshot.baseline?.repositoryId,
            skillId: snapshot.baseline?.skillId,
            versionId: snapshot.baseline?.versionId,
            ...(snapshot.baseline?.commit ? {commit: snapshot.baseline.commit} : {}),
            ...(snapshot.baseline?.contentDigest
                ? {contentDigest: snapshot.baseline.contentDigest}
                : {}),
        },
        dataset: {
            id: snapshot.dataset?.id,
            revision: snapshot.dataset?.revision,
            ...(snapshot.dataset?.digest ? {digest: snapshot.dataset.digest} : {}),
        },
        rubric: {
            id: snapshot.rubric?.id,
            version: snapshot.rubric?.version,
            ...(snapshot.rubric?.digest ? {digest: snapshot.rubric.digest} : {}),
        },
        targets: structuredClone(snapshot.targets ?? []),
        epochs: (run.epochs ?? []).map((epoch) => ({
            number: epoch.number,
            status: epoch.status,
            candidateArtifactId: epoch.candidateArtifactId ?? null,
            installArtifactIds: structuredClone(epoch.installArtifactIds ?? []),
            evaluationArtifactIds: structuredClone(epoch.evaluationArtifactIds ?? []),
            analysisArtifactId: epoch.analysisArtifactId ?? null,
            decisionArtifactId: epoch.decisionArtifactId ?? null,
        })),
        checkpoint: publicCheckpoint(run.checkpoint),
        error: run.error === null || run.error === undefined
            ? null
            : {
                code: String(run.error.code ?? "OPTIMIZATION_FAILED").slice(0, 200),
                message: String(run.error.message ?? "Optimization failed").slice(0, 4_096),
            },
    }
}

function publicPreflight(snapshot) {
    const run = publicRun({
        id: "preflight",
        state: "preflight",
        revision: 0,
        currentEpoch: 0,
        snapshot,
        epochs: [],
        checkpoint: {},
        error: null,
    })
    return {
        snapshotDigest: run.snapshotDigest,
        baseline: run.baseline,
        dataset: run.dataset,
        rubric: run.rubric,
        targets: run.targets,
        ready: true,
    }
}

class OptimizationControlService {
    constructor(options = {}) {
        this.store = dependency(options.store, "createRun", "Optimization store")
        dependency(this.store, "getRun", "Optimization store")
        dependency(this.store, "listRuns", "Optimization store")
        dependency(this.store, "updateCheckpoint", "Optimization store")
        this.workspaceManager = dependency(
            options.workspaceManager,
            "create",
            "Optimization workspace manager",
        )
        dependency(this.workspaceManager, "recover", "Optimization workspace manager")
        this.operatorSessionManager = dependency(
            options.operatorSessionManager,
            "create",
            "Optimization Operator session manager",
        )
        this.runner = dependency(options.runner, "run", "Optimization Runner")
        dependency(this.runner, "pause", "Optimization Runner")
        dependency(this.runner, "resume", "Optimization Runner")
        dependency(this.runner, "stop", "Optimization Runner")
        this.operatorGateway = dependency(
            options.operatorGateway,
            "submitCandidate",
            "Optimization Operator gateway",
        )
        dependency(this.operatorGateway, "submitDecision", "Optimization Operator gateway")
        this.artifactStore = dependency(options.artifactStore, "createArtifact", "Artifact store")
        if (typeof options.resolvePreflight !== "function") {
            throw new Error("Optimization preflight resolver is required")
        }
        this.resolvePreflight = options.resolvePreflight
        this.freezeRun = options.freezeRun ?? (({trusted, config, createdAt}) => (
            freezeOptimizationRun({...trusted, config, createdAt})
        ))
        if (typeof this.freezeRun !== "function") throw new Error("Optimization freezer is invalid")
        this.readArtifact = options.readArtifact
        if (typeof this.readArtifact !== "function") throw new Error("Optimization artifact reader is required")
        this.clock = options.clock ?? (() => new Date().toISOString())
        if (typeof this.clock !== "function") throw new Error("Optimization clock is invalid")
        this.startupRecoveryComplete = false
    }

    async #snapshot(config) {
        const normalized = normalizedConfig(config)
        const trusted = await this.resolvePreflight(structuredClone(normalized))
        return this.freezeRun({
            trusted: structuredClone(trusted),
            config: normalized,
            createdAt: this.clock(),
        })
    }

    async preflight(config) {
        return publicPreflight(await this.#snapshot(config))
    }

    async start(input) {
        const {idempotencyKey, ...config} = structuredClone(input)
        const snapshot = await this.#snapshot(config)
        const created = this.store.createRun(snapshot, {idempotencyKey})
        const run = this.store.getRun(created.runId)
        const workspace = await this.workspaceManager.create(run)
        const runtimeIds = [...new Set([
            snapshot.operator.runtimeId,
            snapshot.judge.runtimeId,
            ...snapshot.targets.map((target) => target.runtimeId),
        ])]
        const operator = await this.operatorSessionManager.create({
            runtimeId: snapshot.operator.runtimeId,
            modelId: snapshot.operator.modelId,
            effort: snapshot.operator.effort,
            objective: [
                `Optimize frozen Run ${run.id}.`,
                "Wait for an optimization Candidate or decision request, then use only the matching optimization.submit_* Tool.",
                "Edit only the provided optimization worktree and do not change Dataset or Rubric inputs.",
            ].join(" "),
            actions: ["optimizations.read", "optimizations.execute"],
            scopes: {
                skillIds: [snapshot.baseline.skillId],
                datasetIds: [snapshot.dataset.id],
                runtimeIds,
                repositoryIds: [snapshot.baseline.repositoryId],
            },
            budget: {
                maxDurationMs: snapshot.limits.maxDurationMs,
                maxRuntimeTurns: snapshot.limits.maxTurns ?? 1_000_000,
                maxEvaluations: snapshot.limits.maxEpochs + 2,
                maxTargetExecutions: snapshot.targets.length * (snapshot.limits.maxEpochs + 2),
                maxJudgeExecutions: snapshot.limits.maxEpochs + 2,
                maxTokens: snapshot.limits.maxTokens,
                maxReportedCost: snapshot.limits.maxCostMicros === null
                    ? null
                    : snapshot.limits.maxCostMicros / 1_000_000,
            },
            expiresInMs: snapshot.limits.maxDurationMs,
            managedSkillBinding: {
                repositoryId: snapshot.baseline.repositoryId,
                skillId: snapshot.baseline.skillId,
                optimizationRunId: run.id,
            },
        })
        const operatorSessionId = requiredText(
            operator?.session?.id,
            "Optimization Operator session id",
            300,
        )
        const parentJobId = requiredText(
            operator?.parentJob?.id,
            "Optimization Operator parent Job id",
            300,
        )
        this.store.updateCheckpoint(run.id, {operatorSessionId, operatorParentJobId: parentJobId})
        const operation = this.runner.run(run.id, {
            operatorSessionId,
            parentJobId,
            workspace: structuredClone(workspace),
        })
        Promise.resolve(operation).catch(() => {})
        return this.get(run.id)
    }

    get(runId) {
        return {run: publicRun(this.store.getRun(requiredText(runId, "Optimization Run id", 200)))}
    }

    scope(runId) {
        const snapshot = this.store.getRun(requiredText(runId, "Optimization Run id", 200)).snapshot
        return {
            skillIds: [snapshot.baseline.skillId],
            datasetIds: [snapshot.dataset.id],
            runtimeIds: [...new Set([
                snapshot.operator.runtimeId,
                snapshot.judge.runtimeId,
                ...snapshot.targets.map((target) => target.runtimeId),
            ])],
            repositoryIds: [snapshot.baseline.repositoryId],
        }
    }

    async pause(runId) {
        runId = requiredText(runId, "Optimization Run id", 200)
        await this.runner.pause(runId)
        return this.get(runId)
    }

    async recoverStartup() {
        const recovered = []
        for (const run of this.store.listRuns()) {
            if (run.state !== "needs_recovery" || !run.checkpoint?.workspace) continue
            await this.workspaceManager.recover(run, run.checkpoint.workspace)
            recovered.push({runId: run.id, status: "ready"})
        }
        this.startupRecoveryComplete = true
        return recovered
    }

    async resume(runId) {
        runId = requiredText(runId, "Optimization Run id", 200)
        if (!this.startupRecoveryComplete) {
            throw new Error("Optimization startup recovery is not complete")
        }
        const run = this.store.getRun(runId)
        await this.runner.resume(runId, {
            operatorSessionId: run.checkpoint?.operatorSessionId,
            parentJobId: run.checkpoint?.operatorParentJobId,
            workspace: run.checkpoint?.workspace,
        })
        return this.get(runId)
    }

    async stop(runId) {
        runId = requiredText(runId, "Optimization Run id", 200)
        await this.runner.stop(runId)
        return this.get(runId)
    }

    submitCandidate(input, context = {}) {
        const accepted = this.operatorGateway.submitCandidate({
            runId: input.runId,
            message: input.message,
            operatorSessionId: requiredText(context.sessionId, "Current Operator session id", 300),
        })
        return {accepted}
    }

    submitDecision(input, context = {}) {
        const accepted = this.operatorGateway.submitDecision({
            runId: input.runId,
            decision: structuredClone(input.decision),
            limitRequest: input.limitRequest === undefined ? null : structuredClone(input.limitRequest),
            operatorSessionId: requiredText(context.sessionId, "Current Operator session id", 300),
        })
        return {accepted}
    }

    report(runId) {
        runId = requiredText(runId, "Optimization Run id", 200)
        const run = this.store.getRun(runId)
        const parentJobId = requiredText(
            run.checkpoint?.operatorParentJobId,
            "Optimization Operator parent Job id",
            300,
        )
        const generated = persistOptimizationReport({
            run,
            readArtifact: this.readArtifact,
            artifactStore: this.artifactStore,
            jobId: parentJobId,
        })
        this.store.updateCheckpoint(runId, {
            reportArtifactId: generated.reportArtifactId,
            reportDigest: generated.digest,
        }, {expectedRevision: run.revision})
        return {report: {
            artifactId: generated.reportArtifactId,
            digest: generated.digest,
            mediaType: "text/markdown; charset=utf-8",
        }}
    }
}

module.exports = {OptimizationControlService, publicOptimizationRun: publicRun}
