"use strict"

const {parseOptimizationDecision} = require("./optimization-contract.cjs")
const {compareEvaluationRuns, evaluateStopRules} = require("./optimization-analysis.cjs")

const SUCCESSFUL_INSTALLATION_STATUSES = new Set(["succeeded"])

function requiredDependency(value, method, label) {
    if (!value || typeof value[method] !== "function") {
        throw new Error(`${label} with ${method}() is required`)
    }
    return value
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function errorRecord(error, fallbackCode = "OPTIMIZATION_FAILED") {
    return {
        code: typeof error?.code === "string" && error.code ? error.code : fallbackCode,
        message: typeof error?.message === "string" && error.message
            ? error.message
            : String(error),
    }
}

function installedInitialState(job, baseline) {
    const result = job?.parsedResult
    if (job?.status !== "succeeded" || result?.status !== "succeeded") {
        const error = new Error(`Runtime ${job?.runtime?.runtimeId ?? "unknown"} failed experiment preflight`)
        error.code = job?.status === "needs_recovery"
            ? "OPTIMIZATION_INSTALL_NEEDS_RECOVERY"
            : "OPTIMIZATION_PREFLIGHT_FAILED"
        throw error
    }
    if (result.classificationBefore === "absent") {
        return {classification: "absent", destination: null}
    }
    if (result.classificationBefore !== "managed-clean" || !result.destination) {
        const error = new Error("Optimization preflight requires absent or exact managed-clean baseline")
        error.code = "OPTIMIZATION_PREFLIGHT_FAILED"
        throw error
    }
    return {
        classification: "managed-clean",
        destination: result.destination,
        versionId: baseline.versionId,
        commit: baseline.commit,
        contentDigest: baseline.contentDigest,
    }
}

function optimizationLimitRequest(value, currentLimits, telemetry) {
    if (value === null || value === undefined) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Optimization limit request must be an object")
    }
    const keys = Object.keys(value).sort()
    if (keys.join(",") !== "field,rationale,value") {
        throw new Error("Optimization limit request has unknown or missing fields")
    }
    const field = String(value.field ?? "")
    const maxima = {
        maxEpochs: 100,
        maxDurationMs: 30 * 24 * 60 * 60 * 1_000,
        maxTurns: 1_000_000,
        maxTokens: 1_000_000_000_000,
        maxCostMicros: Number.MAX_SAFE_INTEGER,
    }
    if (!Object.hasOwn(maxima, field)) throw new Error("Optimization limit field is unsupported")
    if (!Number.isSafeInteger(value.value) || value.value < 1 || value.value > maxima[field]) {
        throw new Error("Optimization requested limit is outside its supported bound")
    }
    const current = currentLimits[field]
    if (current !== null && current !== undefined && value.value <= current) {
        throw new Error("Optimization requested limit must increase the current limit")
    }
    if (field === "maxTokens" && telemetry?.tokens !== true) {
        throw new Error("Optimization token limit requires token telemetry")
    }
    if (field === "maxCostMicros" && telemetry?.cost !== true) {
        throw new Error("Optimization cost limit requires cost telemetry")
    }
    const rationale = String(value.rationale ?? "").trim()
    if (!rationale || rationale.length > 8_192) {
        throw new Error("Optimization limit request rationale is required")
    }
    return {field, value: value.value, rationale}
}

function boundedRunSummary(run) {
    const epoch = run.epochs?.at(-1) ?? null
    return {
        runId: run.id,
        state: run.state,
        currentEpoch: run.currentEpoch,
        baselineVersionId: run.snapshot?.baseline?.versionId ?? null,
        datasetId: run.snapshot?.dataset?.id ?? null,
        datasetRevision: run.snapshot?.dataset?.revision ?? null,
        rubricId: run.snapshot?.rubric?.id ?? null,
        rubricVersion: run.snapshot?.rubric?.version ?? null,
        limits: clone(run.snapshot?.limits ?? {}),
        target: clone(run.snapshot?.target ?? {}),
        epoch: epoch ? {
            id: epoch.id,
            number: epoch.number,
            status: epoch.status,
            candidateArtifactId: epoch.candidateArtifactId,
            installArtifactIds: clone(epoch.installArtifactIds),
            evaluationArtifactIds: clone(epoch.evaluationArtifactIds),
            analysisArtifactId: epoch.analysisArtifactId,
            decisionArtifactId: epoch.decisionArtifactId,
        } : null,
    }
}

function boundedAnalysisSummary(analysis) {
    const bounded = (entries) => ({
        entries: clone((entries ?? []).slice(0, 20)),
        omitted: Math.max(0, (entries?.length ?? 0) - 20),
    })
    return {
        schemaVersion: analysis.schemaVersion,
        epoch: analysis.epoch,
        score: analysis.score,
        scoreDelta: analysis.scoreDelta,
        baselineScoreDelta: analysis.baselineScoreDelta,
        passRate: analysis.passRate,
        completedScoreCount: analysis.completedScoreCount,
        missingScoreCount: analysis.missingScoreCount,
        executionFailureCount: analysis.executionFailureCount,
        gradingFailureCount: analysis.gradingFailureCount,
        targetReached: analysis.targetReached,
        consecutiveInsufficientImprovement: analysis.consecutiveInsufficientImprovement,
        improved: bounded(analysis.improved),
        regressed: bounded(analysis.regressed),
        criticalFailures: bounded(analysis.criticalFailures),
    }
}

class OptimizationRunner {
    constructor(options = {}) {
        this.store = requiredDependency(options.store, "getRun", "Optimization store")
        requiredDependency(this.store, "transitionRun", "Optimization store")
        requiredDependency(this.store, "createEpoch", "Optimization store")
        requiredDependency(this.store, "updateEpoch", "Optimization store")
        this.artifactStore = requiredDependency(options.artifactStore, "createArtifact", "Artifact store")
        this.childJobs = requiredDependency(options.childJobs, "run", "Optimization child Job runner")
        this.workspaceManager = requiredDependency(
            options.workspaceManager,
            "createCandidate",
            "Optimization workspace manager",
        )
        requiredDependency(this.workspaceManager, "create", "Optimization workspace manager")
        this.installationManager = requiredDependency(
            options.installationManager,
            "startOptimizationExperiment",
            "Skill installation manager",
        )
        requiredDependency(this.installationManager, "wait", "Skill installation manager")
        this.evaluationManager = requiredDependency(
            options.evaluationManager,
            "run",
            "Optimization evaluation manager",
        )
        this.operatorGateway = requiredDependency(
            options.operatorGateway,
            "requestCandidate",
            "Optimization Operator gateway",
        )
        requiredDependency(this.operatorGateway, "requestDecision", "Optimization Operator gateway")
        this.approvals = requiredDependency(options.approvals, "request", "Optimization approval gateway")
        this.releaseManager = requiredDependency(options.releaseManager, "release", "Skill release manager")
        this.telemetry = options.telemetry ?? (() => ({}))
        if (typeof this.telemetry !== "function") throw new Error("Optimization telemetry reader is invalid")
        this.onChanged = options.onChanged ?? (() => {})
        if (typeof this.onChanged !== "function") throw new Error("Optimization change callback is invalid")
        this.controls = new Map()
    }

    run(runId, context = {}) {
        if (this.controls.has(runId)) return this.controls.get(runId).operation
        const control = {
            runId,
            operatorSessionId: String(context.operatorSessionId ?? ""),
            parentJobId: String(context.parentJobId ?? ""),
            cancelRequested: false,
            pauseRequested: false,
            initialTargets: null,
            currentCandidate: null,
            previousCandidate: null,
            baselineEvaluation: null,
            previousEvaluation: null,
            analyses: [],
            workspace: null,
            approvedLimits: {},
        }
        if (!control.operatorSessionId || !control.parentJobId) {
            throw new Error("Optimization Runner requires an Operator session and parent Job")
        }
        const operation = this.#execute(control).finally(() => {
            if (this.controls.get(runId) === control) this.controls.delete(runId)
        })
        control.operation = operation
        this.controls.set(runId, control)
        return operation
    }

    stop(runId) {
        const control = this.controls.get(runId)
        if (!control) throw new Error("Optimization Run is not active")
        control.cancelRequested = true
        return {runId, status: "stopping"}
    }

    pause(runId) {
        const control = this.controls.get(runId)
        if (!control) throw new Error("Optimization Run is not active")
        control.pauseRequested = true
        return {runId, status: "pausing"}
    }

    #checkpoint(control, patch = {}) {
        const run = this.store.getRun(control.runId)
        return {...clone(run.checkpoint ?? {}), ...clone(patch)}
    }

    #transition(control, state, checkpointPatch = null, error = undefined) {
        const patch = {}
        if (checkpointPatch !== null) patch.checkpoint = this.#checkpoint(control, checkpointPatch)
        if (error !== undefined) patch.error = error
        this.store.transitionRun(control.runId, state, patch)
        this.onChanged({runId: control.runId, state})
        return this.store.getRun(control.runId)
    }

    #artifact(jobId, kind, name, value, metadata = {}) {
        return this.artifactStore.createArtifact(jobId, {
            kind,
            name,
            mediaType: "application/json",
            body: `${JSON.stringify(value, null, 2)}\n`,
            metadata,
        })
    }

    #child(control, type, objective, operation) {
        return this.childJobs.run({
            parentJobId: control.parentJobId,
            type,
            objective,
        }, operation)
    }

    async #evaluate(control, kind, candidate, installationJobs, epoch = null) {
        return this.#child(control, `optimization_${kind.replaceAll("-", "_")}`, `Run ${kind} evaluation`, async ({jobId}) => {
            const evaluation = await this.evaluationManager.run({
                kind,
                optimizationRun: this.store.getRun(control.runId),
                candidate: clone(candidate),
                installationJobs: clone(installationJobs),
                targets: clone(this.store.getRun(control.runId).snapshot.targets),
            })
            if (!evaluation || !new Set(["completed", "partial"]).has(evaluation.status)) {
                const error = new Error(`${kind} evaluation did not complete`)
                error.code = "OPTIMIZATION_EVALUATION_FAILED"
                throw error
            }
            const artifact = this.#artifact(jobId, "optimization-evaluation", `${kind}.json`, evaluation, {
                runId: control.runId,
                epoch,
                kind,
            })
            return {evaluation, artifact}
        })
    }

    async #waitInstallationJobs(jobs) {
        const completed = await Promise.all(jobs.map(async (job) => {
            const waited = await this.installationManager.wait(job.id)
            return waited?.id ? waited : this.installationManager.store.getJob(job.id)
        }))
        const failed = completed.find((job) => !SUCCESSFUL_INSTALLATION_STATUSES.has(job.status))
        if (failed) {
            const error = new Error(`Runtime installation Job ${failed.id} ended as ${failed.status}`)
            error.code = failed.status === "needs_recovery"
                ? "OPTIMIZATION_INSTALL_NEEDS_RECOVERY"
                : "OPTIMIZATION_INSTALL_FAILED"
            error.installationJob = failed
            throw error
        }
        return completed
    }

    async #experiment(
        control,
        operation,
        candidate,
        epoch,
        previousCandidate = null,
        targetRuntimeIds = null,
    ) {
        return this.#child(control, `optimization_${operation}`, `Run ${operation} for Epoch ${epoch}`, async ({jobId}) => {
            const snapshot = this.store.getRun(control.runId).snapshot
            const selectedRuntimeIds = targetRuntimeIds === null
                ? null
                : new Set(targetRuntimeIds)
            const targets = snapshot.targets
                .filter((target) => selectedRuntimeIds === null || selectedRuntimeIds.has(target.runtimeId))
                .map((target) => ({
                    ...clone(target),
                    ...(operation === "experiment_inspect" ? {} : {
                        initial: clone(control.initialTargets[target.runtimeId]),
                    }),
                }))
            const jobs = await this.installationManager.startOptimizationExperiment({
                operation,
                run: this.store.getRun(control.runId),
                epoch,
                candidateVersionId: candidate.id,
                previousCandidateVersionId: previousCandidate?.id ?? null,
                targets,
            })
            const completed = await this.#waitInstallationJobs(jobs)
            const artifact = this.#artifact(jobId, "optimization-installation", `${operation}-${epoch}.json`, {
                operation,
                jobs: completed,
            }, {runId: control.runId, epoch, operation})
            return {jobs: completed, artifact}
        })
    }

    async #requestDecision(control, context) {
        let validationError = null
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const raw = await this.operatorGateway.requestDecision({
                ...context,
                attempt,
                validationError,
                operatorSessionId: control.operatorSessionId,
            })
            try {
                const wrapped = raw && typeof raw === "object" && !Array.isArray(raw) && raw.decision
                    ? raw
                    : {decision: raw, limitRequest: null}
                const decision = parseOptimizationDecision(wrapped.decision)
                const run = this.store.getRun(control.runId)
                const limitRequest = optimizationLimitRequest(
                    wrapped.limitRequest,
                    {...run.snapshot.limits, ...control.approvedLimits},
                    run.snapshot.telemetry,
                )
                if (limitRequest && decision.action !== "continue") {
                    throw new Error("Optimization limit request requires a continue decision")
                }
                return {decision, limitRequest}
            } catch (error) {
                validationError = error.message
            }
        }
        const error = new Error(`Optimization decision remained invalid after one repair: ${validationError}`)
        error.code = "OPTIMIZATION_DECISION_INVALID"
        throw error
    }

    async #execute(control) {
        let terminalIntent = "failed"
        try {
            let run = this.store.getRun(control.runId)
            if (run.state !== "preflight") throw new Error("Optimization Run must start in preflight")
            control.workspace = await this.workspaceManager.create(run)
            this.#transition(control, "baseline", {workspace: control.workspace})
            const baseline = await this.#evaluate(
                control,
                "baseline",
                run.snapshot.baseline,
                [],
            )
            control.baselineEvaluation = baseline.evaluation
            control.previousEvaluation = baseline.evaluation
            this.#transition(control, "editing", {
                baselineEvaluationArtifactId: baseline.artifact.id,
                baselineEvaluationRunId: baseline.evaluation.id,
            })

            while (true) {
                if (control.cancelRequested) {
                    terminalIntent = "cancelled"
                    return this.#restore(control, terminalIntent, new Error("Optimization cancelled by user"))
                }
                const created = this.store.createEpoch(control.runId)
                const epochNumber = created.index
                const submission = await this.operatorGateway.requestCandidate({
                    run: boundedRunSummary(this.store.getRun(control.runId)),
                    epoch: epochNumber,
                    workspace: clone(control.workspace),
                    operatorSessionId: control.operatorSessionId,
                })
                const candidateChild = await this.#child(
                    control,
                    "optimization_candidate",
                    `Commit Candidate for Epoch ${epochNumber}`,
                    async ({jobId}) => {
                        const version = await this.workspaceManager.createCandidate({
                            runId: control.runId,
                            epoch: epochNumber,
                            message: String(submission?.message ?? ""),
                        })
                        const artifact = this.#artifact(
                            jobId,
                            "optimization-candidate",
                            `candidate-${epochNumber}.json`,
                            version,
                            {runId: control.runId, epoch: epochNumber},
                        )
                        return {candidate: version, artifact}
                    },
                )
                control.currentCandidate = candidateChild.candidate
                this.store.updateEpoch(control.runId, created.epochId, {
                    candidateArtifactId: candidateChild.artifact.id,
                })

                if (epochNumber === 1) {
                    const preflight = await this.#experiment(
                        control,
                        "experiment_inspect",
                        control.currentCandidate,
                        epochNumber,
                    )
                    control.initialTargets = Object.fromEntries(preflight.jobs.map((job) => [
                        job.runtime.runtimeId,
                        installedInitialState(job, run.snapshot.baseline),
                    ]))
                    this.#transition(control, "installing", {
                        experimentPreflightArtifactId: preflight.artifact.id,
                        initialTargets: control.initialTargets,
                    })
                } else {
                    this.#transition(control, "installing")
                }

                const installation = await this.#experiment(
                    control,
                    "experiment_install",
                    control.currentCandidate,
                    epochNumber,
                    control.previousCandidate,
                )
                this.store.updateEpoch(control.runId, created.epochId, {
                    installArtifactIds: [installation.artifact.id],
                })
                this.#transition(control, "evaluating")
                const candidateEvaluation = await this.#evaluate(
                    control,
                    "candidate",
                    control.currentCandidate,
                    installation.jobs,
                    epochNumber,
                )
                this.store.updateEpoch(control.runId, created.epochId, {
                    evaluationArtifactIds: [candidateEvaluation.artifact.id],
                })
                this.#transition(control, "deciding")

                const progress = {
                    ...clone(await this.telemetry({runId: control.runId, epoch: epochNumber})),
                    cancelRequested: control.cancelRequested,
                    recoveryFailed: false,
                }
                const analysisInput = {
                    baseline: control.baselineEvaluation,
                    previous: control.previousEvaluation,
                    current: candidateEvaluation.evaluation,
                    mode: run.snapshot.mode,
                    epoch: epochNumber,
                    target: run.snapshot.target,
                    limits: run.snapshot.limits,
                    progress,
                    history: control.analyses,
                }
                const provisional = compareEvaluationRuns({
                    ...analysisInput,
                    agentDecision: {action: "continue"},
                })
                let requestedDecision
                try {
                    requestedDecision = await this.#requestDecision(control, {
                        run: boundedRunSummary(this.store.getRun(control.runId)),
                        epoch: epochNumber,
                        analysis: boundedAnalysisSummary(provisional),
                    })
                } catch (error) {
                    if (error.code !== "OPTIMIZATION_DECISION_INVALID") throw error
                    this.#transition(control, "needs_recovery", {
                        paused: true,
                        pauseReason: error.code,
                    }, errorRecord(error))
                    return {runId: control.runId, status: "paused", reason: error.code}
                }
                const {decision, limitRequest} = requestedDecision
                let limitApproval = null
                if (limitRequest) {
                    limitApproval = await this.approvals.request({
                        kind: "limit",
                        runId: control.runId,
                        epoch: epochNumber,
                        request: limitRequest,
                    })
                    if (limitApproval?.approved === true) {
                        control.approvedLimits[limitRequest.field] = limitRequest.value
                        analysisInput.limits = {
                            ...analysisInput.limits,
                            ...control.approvedLimits,
                        }
                    }
                }
                const analysis = compareEvaluationRuns({...analysisInput, agentDecision: decision})
                const analysisArtifact = this.#artifact(
                    control.parentJobId,
                    "optimization-analysis",
                    `analysis-${epochNumber}.json`,
                    analysis,
                    {runId: control.runId, epoch: epochNumber},
                )
                const decisionArtifact = this.#artifact(
                    control.parentJobId,
                    "optimization-decision",
                    `decision-${epochNumber}.json`,
                    decision,
                    {runId: control.runId, epoch: epochNumber},
                )
                this.store.updateEpoch(control.runId, created.epochId, {
                    analysisArtifactId: analysisArtifact.id,
                    decisionArtifactId: decisionArtifact.id,
                })
                control.analyses.push(analysis)
                const stopDecision = evaluateStopRules(analysis)
                if (control.pauseRequested || stopDecision.action === "pause") {
                    this.#transition(control, "needs_recovery", {
                        paused: true,
                        pauseReason: control.pauseRequested ? "user_pause" : stopDecision.reason,
                    })
                    return {runId: control.runId, status: "paused", reason: stopDecision.reason}
                }
                if (stopDecision.action === "continue") {
                    this.store.updateEpoch(control.runId, created.epochId, {status: "completed"})
                    control.previousCandidate = control.currentCandidate
                    control.previousEvaluation = candidateEvaluation.evaluation
                    this.#transition(control, "editing", {
                        approvedLimits: control.approvedLimits,
                        ...(limitRequest ? {
                            lastLimitRequest: limitRequest,
                            lastLimitApprovalId: limitApproval?.approvalId ?? null,
                        } : {}),
                    })
                    continue
                }
                if (stopDecision.action === "restore" || stopDecision.action === "recover") {
                    terminalIntent = "failed"
                    return this.#restore(
                        control,
                        terminalIntent,
                        Object.assign(new Error(stopDecision.reason), {code: stopDecision.reason}),
                    )
                }
                return await this.#releaseAndVerify(control, {
                    epochId: created.epochId,
                    epochNumber,
                    candidate: control.currentCandidate,
                    candidateEvaluation: candidateEvaluation.evaluation,
                    stopReason: stopDecision.reason,
                })
            }
        } catch (error) {
            return this.#restore(control, terminalIntent, error)
        }
    }

    async #releaseAndVerify(control, context) {
        this.#transition(control, "waiting_approval", {stopReason: context.stopReason})
        const releaseApproval = await this.approvals.request({
            kind: "release",
            runId: control.runId,
            epoch: context.epochNumber,
            candidate: clone(context.candidate),
        })
        if (releaseApproval?.approved !== true) {
            return this.#restore(
                control,
                "cancelled",
                Object.assign(new Error("Optimization release was rejected"), {
                    code: "OPTIMIZATION_RELEASE_REJECTED",
                }),
            )
        }
        if (control.cancelRequested) {
            throw Object.assign(new Error("Optimization cancelled before release"), {
                code: "OPTIMIZATION_CANCELLED",
            })
        }
        const released = await this.#child(
            control,
            "optimization_release",
            "Release approved Optimization Candidate",
            ({jobId}) => this.releaseManager.release({
                run: this.store.getRun(control.runId),
                candidate: context.candidate,
                approval: releaseApproval,
                jobId,
            }),
        )
        const installApproval = await this.approvals.request({
            kind: "install",
            runId: control.runId,
            epoch: context.epochNumber,
            versionId: released.id,
        })
        if (installApproval?.approved !== true) {
            return this.#restore(
                control,
                "cancelled",
                Object.assign(new Error("Optimization Released installation was rejected"), {
                    code: "OPTIMIZATION_INSTALL_REJECTED",
                }),
            )
        }
        if (control.cancelRequested) {
            throw Object.assign(new Error("Optimization cancelled before Released installation"), {
                code: "OPTIMIZATION_CANCELLED",
            })
        }
        this.#transition(control, "installing", {
            releasePhase: "released-install",
            releaseApprovalId: releaseApproval.approvalId ?? null,
            installApprovalId: installApproval.approvalId ?? null,
            releasedVersionId: released.id,
        })
        const formalInstallation = await this.#child(
            control,
            "optimization_released_install",
            "Install approved Released Skill",
            async ({jobId}) => {
                const jobs = await this.installationManager.start({
                    skillId: released.skillId,
                    versionId: released.id,
                    targets: clone(this.store.getRun(control.runId).snapshot.targets),
                })
                const completed = await this.#waitInstallationJobs(jobs)
                const artifact = this.#artifact(jobId, "optimization-installation", "released-install.json", {
                    versionId: released.id,
                    jobs: completed,
                })
                return {jobs: completed, artifact}
            },
        )
        this.#transition(control, "evaluating", {
            releasePhase: "final-regression",
            releasedInstallArtifactId: formalInstallation.artifact.id,
        })
        const finalEvaluation = await this.#evaluate(
            control,
            "final-regression",
            released,
            formalInstallation.jobs,
            context.epochNumber,
        )
        const epoch = this.store.getRun(control.runId).epochs.find(
            (entry) => entry.id === context.epochId,
        )
        this.store.updateEpoch(control.runId, context.epochId, {
            evaluationArtifactIds: [...epoch.evaluationArtifactIds, finalEvaluation.artifact.id],
        })
        this.#transition(control, "deciding", {
            releasePhase: "verified",
            finalEvaluationRunId: finalEvaluation.evaluation.id,
            finalEvaluationArtifactId: finalEvaluation.artifact.id,
        })
        const regression = compareEvaluationRuns({
            baseline: context.candidateEvaluation,
            previous: context.candidateEvaluation,
            current: finalEvaluation.evaluation,
            mode: "fixed",
            epoch: 1,
            target: {minimumScore: 0, minimumPassRate: 0, requireCriticalCases: true},
            limits: {
                maxEpochs: 2,
                maxDurationMs: this.store.getRun(control.runId).snapshot.limits.maxDurationMs,
                maxTurns: null,
                maxTokens: null,
                maxCostMicros: null,
                patience: 1,
                minimumImprovement: 0,
            },
            progress: {elapsedMs: 0, turnsUsed: 0, tokensUsed: null, costMicros: null},
            history: [],
            agentDecision: {action: "finish"},
            regressionThresholds: {maximumScoreDrop: 0, maximumRegressedResults: 0},
        })
        if (
            regression.broadRegression ||
            regression.newCriticalFailures.length ||
            regression.missingScoreCount > 0
        ) {
            return this.#restore(
                control,
                "failed",
                Object.assign(new Error("Released installation final regression failed"), {
                    code: "OPTIMIZATION_FINAL_REGRESSION_FAILED",
                }),
            )
        }
        this.store.updateEpoch(control.runId, context.epochId, {status: "succeeded"})
        this.#transition(control, "succeeded", {finalRegressionPassed: true}, null)
        await this.workspaceManager.cleanup?.(control.runId)
        return {runId: control.runId, status: "succeeded", releasedVersionId: released.id}
    }

    async #restore(control, terminalState, cause) {
        let run = this.store.getRun(control.runId)
        const epoch = run.epochs.at(-1) ?? null
        if (!control.initialTargets || !control.currentCandidate) {
            if (epoch && !["completed", "succeeded", "failed", "cancelled"].includes(epoch.status)) {
                this.store.updateEpoch(control.runId, epoch.id, {
                    status: terminalState === "cancelled" ? "cancelled" : "failed",
                })
            }
            if (run.state === "baseline" || run.state === "preflight") {
                this.#transition(control, terminalState, null, errorRecord(cause))
            } else {
                this.#transition(control, "restoring", null, errorRecord(cause))
                this.#transition(control, terminalState)
            }
            return {runId: control.runId, status: terminalState, error: errorRecord(cause)}
        }
        try {
            if (run.state !== "restoring") this.#transition(control, "restoring", null, errorRecord(cause))
            for (const [classification, operation] of [
                ["managed-clean", "experiment_restore"],
                ["absent", "experiment_remove"],
            ]) {
                const runtimeIds = Object.entries(control.initialTargets)
                    .filter(([, initial]) => initial.classification === classification)
                    .map(([runtimeId]) => runtimeId)
                if (!runtimeIds.length) continue
                await this.#experiment(
                    control,
                    operation,
                    control.currentCandidate,
                    control.currentCandidate.optimizationEpoch,
                    control.previousCandidate,
                    runtimeIds,
                )
            }
            run = this.store.getRun(control.runId)
            const currentEpoch = run.epochs.at(-1)
            if (currentEpoch && !["completed", "succeeded", "failed", "cancelled"].includes(currentEpoch.status)) {
                this.store.updateEpoch(control.runId, currentEpoch.id, {
                    status: terminalState === "cancelled" ? "cancelled" : "failed",
                })
            }
            this.#transition(control, terminalState)
            await this.workspaceManager.cleanup?.(control.runId)
            return {runId: control.runId, status: terminalState, error: errorRecord(cause)}
        } catch (recoveryError) {
            this.#transition(control, "needs_recovery", {
                recoveryError: errorRecord(recoveryError),
            }, errorRecord(cause))
            return {
                runId: control.runId,
                status: "needs_recovery",
                error: errorRecord(cause),
                recoveryError: errorRecord(recoveryError),
            }
        }
    }
}

module.exports = {OptimizationRunner}
