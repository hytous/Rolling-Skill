"use strict"

const {
    freezeOptimizationRun,
    parseOptimizationConfig,
} = require("./optimization-contract.cjs")
const {generateOptimizationReport, persistOptimizationReport} = require("./optimization-report.cjs")

const MAX_PUBLIC_ARTIFACT_BYTES = 1024 * 1024
const MAX_PUBLIC_REPORT_PREVIEW_BYTES = 32 * 1024
const LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v1"

function boundedReportPreview(value) {
    const body = Buffer.from(String(value ?? ""), "utf8")
    if (body.byteLength <= MAX_PUBLIC_REPORT_PREVIEW_BYTES) return body.toString("utf8")
    return `${body.subarray(0, MAX_PUBLIC_REPORT_PREVIEW_BYTES - 3).toString("utf8").replace(/\uFFFD$/u, "")}…`
}

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

function boundedArtifactValue(readArtifact, artifactId) {
    if (!artifactId) return null
    let value
    try {
        value = readArtifact(artifactId, MAX_PUBLIC_ARTIFACT_BYTES)
        if (Buffer.isBuffer(value)) value = value.toString("utf8")
        if (typeof value === "string") {
            if (Buffer.byteLength(value, "utf8") > MAX_PUBLIC_ARTIFACT_BYTES) return null
            value = JSON.parse(value)
        }
        if (value?.inline && typeof value.inline.body === "string") {
            if (
                value.inline.encoding === "base64" &&
                value.inline.body.length > Math.ceil(MAX_PUBLIC_ARTIFACT_BYTES * 4 / 3) + 4
            ) return null
            const body = value.inline.encoding === "base64"
                ? Buffer.from(value.inline.body, "base64").toString("utf8")
                : value.inline.body
            if (Buffer.byteLength(body, "utf8") > MAX_PUBLIC_ARTIFACT_BYTES) return null
            value = JSON.parse(body)
        } else if (value && typeof value.body === "string") {
            if (Buffer.byteLength(value.body, "utf8") > MAX_PUBLIC_ARTIFACT_BYTES) return null
            value = JSON.parse(value.body)
        }
    } catch {
        return null
    }
    return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function publicInstallation(value) {
    if (!value || typeof value !== "object") return null
    const runtimeId = typeof value.runtimeId === "string"
        ? value.runtimeId
        : value.runtime?.runtimeId
    const installationJobId = typeof value.installationJobId === "string"
        ? value.installationJobId
        : value.id
    if (typeof runtimeId !== "string" || !runtimeId || typeof installationJobId !== "string" || !installationJobId) {
        return null
    }
    const parsedResult = value.parsedResult ?? {}
    const result = parsedResult.result ?? {}
    const digest = value.lastVerifiedDigest ?? result.actualDigest ?? null
    const operation = typeof value.operation === "string" ? value.operation : null
    const destination = Object.hasOwn(value, "destination")
        ? value.destination
        : parsedResult.destination
    return {
        runtimeId: runtimeId.slice(0, 200),
        status: String(value.status ?? "unknown").slice(0, 80),
        installationJobId: installationJobId.slice(0, 200),
        ...(operation ? {operation: operation.slice(0, 80)} : {}),
        ...(typeof destination === "string"
            ? {destination: destination.slice(0, 4_096)}
            : destination === null ? {destination: null} : {}),
        ...(typeof digest === "string" ? {lastVerifiedDigest: digest.slice(0, 80)} : {}),
    }
}

function publicCheckpoint(value = {}, {legacy = false} = {}) {
    const fields = [
        "operatorSessionId",
        "operatorCleanupError",
        "stopRequested",
        "activeEvaluationRunId",
        "activeEvaluationKind",
        "installationOperation",
        "installationPending",
        "installationJobIds",
        "baselineEvaluationRunId",
        "paused",
        "pauseReason",
        "stopReason",
        "reportArtifactId",
        "reportDigest",
        "finalApprovalId",
        "releaseApprovalId",
        "installApprovalId",
        "releasedVersionId",
        "releasedInstallArtifactId",
        "finalEvaluationArtifactId",
        "finalRegressionPassed",
    ]
    const checkpoint = Object.fromEntries(fields
        .filter((field) => value[field] !== undefined)
        .map((field) => [field, structuredClone(value[field])]))
    if (checkpoint.paused === false) delete checkpoint.pauseReason
    if (legacy && value.telemetry && typeof value.telemetry === "object") {
        const elapsedMs = Number(value.telemetry.elapsedMs)
        const turnsUsed = Number(value.telemetry.turnsUsed)
        const tokens = value.telemetry.tokens
        const costMicros = value.telemetry.costMicros
        if (Number.isFinite(elapsedMs) && elapsedMs >= 0 && Number.isSafeInteger(turnsUsed) && turnsUsed >= 0) {
            checkpoint.telemetry = {
                elapsedMs,
                turnsUsed,
                tokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null,
                costMicros: Number.isSafeInteger(costMicros) && costMicros >= 0 ? costMicros : null,
            }
        }
    }
    const recoveryTargets = (Array.isArray(value.recoveryTargets) ? value.recoveryTargets : [])
        .slice(0, 64)
        .map(publicInstallation)
        .filter(Boolean)
    if (recoveryTargets.length) checkpoint.recoveryTargets = recoveryTargets
    return checkpoint
}

function publicCandidate(value) {
    if (!value || typeof value !== "object") return null
    const versionId = typeof value.versionId === "string" ? value.versionId : value.id
    if (
        typeof versionId !== "string" || !versionId ||
        typeof value.commit !== "string" || !value.commit ||
        typeof value.contentDigest !== "string" || !value.contentDigest
    ) return null
    return {
        versionId: versionId.slice(0, 200),
        commit: value.commit.slice(0, 80),
        contentDigest: value.contentDigest.slice(0, 80),
    }
}

function publicAnalysis(value) {
    if (!value || typeof value !== "object") return null
    const regressionCount = Number.isSafeInteger(value.regressionCount)
        ? value.regressionCount
        : Array.isArray(value.regressed) ? value.regressed.length : 0
    const summary = {regressionCount: Math.max(0, Math.min(regressionCount, 100_000))}
    for (const [field, minimum, maximum] of [
        ["score", 0, 100],
        ["scoreDelta", -100, 100],
        ["passRate", 0, 1],
    ]) {
        if (Number.isFinite(value[field]) && value[field] >= minimum && value[field] <= maximum) {
            summary[field] = value[field]
        }
    }
    for (const field of ["executionFailureCount", "gradingFailureCount"]) {
        if (Number.isSafeInteger(value[field]) && value[field] >= 0) {
            summary[field] = Math.min(value[field], 100_000)
        }
    }
    return summary
}

function publicDecision(value) {
    if (!value || typeof value !== "object" || !["continue", "finish", "pause"].includes(value.action)) {
        return null
    }
    return {
        action: value.action,
        rationale: String(value.rationale ?? "").slice(0, 8_192),
    }
}

function publicEpoch(epoch, readArtifact) {
    const candidate = publicCandidate(boundedArtifactValue(readArtifact, epoch.candidateArtifactId))
    const installationArtifacts = (epoch.installArtifactIds ?? [])
        .slice(0, 64)
        .map((artifactId) => boundedArtifactValue(readArtifact, artifactId))
        .filter(Boolean)
    const installations = installationArtifacts
        .flatMap((artifact) => (Array.isArray(artifact.jobs) ? artifact.jobs.slice(0, 64) : [artifact])
            .map((job) => ({operation: job.operation ?? artifact.operation, ...job})))
        .slice(0, 64)
        .map(publicInstallation)
        .filter(Boolean)
    const analysis = publicAnalysis(boundedArtifactValue(readArtifact, epoch.analysisArtifactId))
    const decision = publicDecision(boundedArtifactValue(readArtifact, epoch.decisionArtifactId))
    return {
        number: epoch.number,
        status: epoch.status,
        candidateArtifactId: epoch.candidateArtifactId ?? null,
        installArtifactIds: structuredClone(epoch.installArtifactIds ?? []),
        evaluationArtifactIds: structuredClone(epoch.evaluationArtifactIds ?? []),
        analysisArtifactId: epoch.analysisArtifactId ?? null,
        decisionArtifactId: epoch.decisionArtifactId ?? null,
        ...(candidate ? {candidate} : {}),
        ...(installations.length ? {installations} : {}),
        ...(analysis ? {analysis} : {}),
        ...(decision ? {decision} : {}),
    }
}

function publicRun(run, readArtifact = () => null) {
    const snapshot = run.snapshot ?? {}
    const legacy = snapshot.schemaVersion === LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA
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
        operator: structuredClone(snapshot.operator),
        targets: structuredClone(snapshot.targets ?? []),
        judge: structuredClone(snapshot.judge),
        activationMode: snapshot.activationMode,
        limits: structuredClone(snapshot.limits),
        ...(legacy ? {
            mode: snapshot.mode,
            target: structuredClone(snapshot.target),
            telemetry: structuredClone(snapshot.telemetry),
        } : {}),
        epochs: (run.epochs ?? []).map((epoch) => publicEpoch(epoch, readArtifact)),
        checkpoint: publicCheckpoint(run.checkpoint, {legacy}),
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
        dependency(this.runner, "resumeFinalApproval", "Optimization Runner")
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
        this.operatorTurnsUsed = options.operatorTurnsUsed ?? (() => 0)
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

    async #createOperator(run, resuming = false) {
        const snapshot = run.snapshot
        const legacy = snapshot.schemaVersion === LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA
        if (resuming && run.checkpoint.operatorSessionId && this.operatorSessionManager.stop) {
            await this.operatorSessionManager.stop(run.checkpoint.operatorSessionId)
        }
        const runtimeIds = [...new Set([
            snapshot.operator.runtimeId,
            snapshot.judge.runtimeId,
            ...snapshot.targets.map((target) => target.runtimeId),
        ])]
        const request = {
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
            budget: {},
            managedSkillBinding: {
                repositoryId: snapshot.baseline.repositoryId,
                skillId: snapshot.baseline.skillId,
                optimizationRunId: run.id,
            },
        }
        let turnsUsed = 0
        if (legacy) {
            const elapsedMs = resuming
                ? Math.max(0, Date.parse(this.clock()) - Date.parse(run.createdAt ?? this.clock()))
                : 0
            turnsUsed = (run.checkpoint.operatorTurnsUsedBefore ?? 0) +
                (resuming ? this.operatorTurnsUsed(run) : 0)
            const maxDurationMs = Math.floor(snapshot.limits.maxDurationMs - elapsedMs)
            const maxRuntimeTurns = (snapshot.limits.maxTurns ?? 1_000_000) - turnsUsed
            if (maxDurationMs <= 0 || maxRuntimeTurns <= 0) {
                throw new Error("Optimization time or turn budget has been exhausted")
            }
            if (resuming && (
                snapshot.limits.maxTokens !== null || snapshot.limits.maxCostMicros !== null
            )) {
                throw new Error("Optimization with usage caps cannot restart until reliable remaining usage is available")
            }
            const maxEvaluations = Math.max(0, snapshot.limits.maxEpochs + 2 - (resuming
                ? Number(Boolean(run.checkpoint.baselineEvaluationRunId)) + run.epochs.reduce(
                    (count, epoch) => count + (epoch.evaluationArtifactIds?.length ?? 0),
                    0,
                )
                : 0))
            const caseCount = snapshot.dataset.caseRevisions?.length ?? 1
            request.budget = {
                maxDurationMs,
                maxRuntimeTurns,
                maxEvaluations,
                maxTargetExecutions: caseCount * snapshot.targets.length * maxEvaluations,
                maxJudgeExecutions: caseCount * snapshot.targets.length * maxEvaluations,
                maxTokens: snapshot.limits.maxTokens,
                maxReportedCost: snapshot.limits.maxCostMicros === null
                    ? null
                    : snapshot.limits.maxCostMicros / 1_000_000,
            }
            request.expiresInMs = maxDurationMs
        }
        const operator = await this.operatorSessionManager.create(request)
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
        this.store.updateCheckpoint(run.id, {
            operatorSessionId,
            operatorParentJobId: parentJobId,
            ...(legacy ? {operatorTurnsUsedBefore: turnsUsed} : {}),
        })
        return {operatorSessionId, parentJobId}
    }

    async start(input) {
        const {idempotencyKey, ...config} = structuredClone(input)
        const snapshot = await this.#snapshot(config)
        const created = this.store.createRun(snapshot, {idempotencyKey})
        const run = this.store.getRun(created.runId)
        const workspace = await this.workspaceManager.create(run)
        const {operatorSessionId, parentJobId} = await this.#createOperator(run)
        const operation = this.runner.run(run.id, {
            operatorSessionId,
            parentJobId,
            workspace: structuredClone(workspace),
        })
        Promise.resolve(operation).catch(() => {})
        return this.get(run.id)
    }

    get(runId) {
        return {run: publicRun(
            this.store.getRun(requiredText(runId, "Optimization Run id", 200)),
            this.readArtifact,
        )}
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
            if (
                run.recovery?.previousState === "waiting_approval" ||
                run.checkpoint?.resumePhase === "final_approval"
            ) {
                const operation = this.runner.resumeFinalApproval(run.id, {
                    operatorSessionId: run.checkpoint.operatorSessionId,
                    parentJobId: run.checkpoint.operatorParentJobId,
                    workspace: run.checkpoint.workspace,
                })
                Promise.resolve(operation).catch(() => {})
                recovered.push({runId: run.id, status: "waiting_approval"})
            } else {
                recovered.push({runId: run.id, status: "ready"})
            }
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
        if (run.state !== "needs_recovery" || run.checkpoint.paused !== true) throw new Error("Optimization is not paused and resumable")
        if (run.checkpoint?.resumePhase === "final_approval") {
            const operation = this.runner.resumeFinalApproval(runId, {
                operatorSessionId: run.checkpoint.operatorSessionId,
                parentJobId: run.checkpoint.operatorParentJobId,
                workspace: run.checkpoint.workspace,
            })
            Promise.resolve(operation).catch(() => {})
            return this.get(runId)
        }
        const operator = await this.#createOperator(run, true)
        let operation
        try {
            operation = this.runner.resume(runId, {
                ...operator,
                workspace: run.checkpoint?.workspace,
            })
        } catch (error) {
            await this.operatorSessionManager.stop?.(operator.operatorSessionId)
            throw error
        }
        Promise.resolve(operation).catch(() => {})
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
            operatorSessionId: requiredText(context.operatorSessionId ?? context.sessionId, "Current Operator session id", 300),
        })
        return {accepted}
    }

    submitDecision(input, context = {}) {
        const accepted = this.operatorGateway.submitDecision({
            runId: input.runId,
            decision: structuredClone(input.decision),
            operatorSessionId: requiredText(context.operatorSessionId ?? context.sessionId, "Current Operator session id", 300),
        })
        return {accepted}
    }

    report(runId) {
        runId = requiredText(runId, "Optimization Run id", 200)
        const run = this.store.getRun(runId)
        if (["succeeded", "failed", "cancelled"].includes(run.state)) {
            // Reports are derived from frozen evidence. A finished Operator Job
            // cannot accept new artifacts; do not reopen or rewrite its audit.
            const generated = generateOptimizationReport({run, readArtifact: this.readArtifact})
            return {report: {
                artifactId: null,
                digest: generated.digest,
                mediaType: "text/markdown; charset=utf-8",
                preview: boundedReportPreview(generated.markdown),
            }}
        }
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
            preview: boundedReportPreview(generated.markdown),
        }}
    }
}

module.exports = {OptimizationControlService, publicOptimizationRun: publicRun}
