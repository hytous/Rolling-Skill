"use strict"

const {parseOptimizationDecision} = require("./optimization-contract.cjs")
const {compareEvaluationRuns, evaluateStopRules} = require("./optimization-analysis.cjs")
const {sampleFeedback, selectCandidates} = require("./optimization-search.cjs")

const SUCCESSFUL_INSTALLATION_STATUSES = new Set(["succeeded"])
const RECOVERY_INSTALLATION_OPERATIONS = new Set(["experiment_restore", "experiment_remove"])

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
        improved: bounded(analysis.improved),
        regressed: bounded(analysis.regressed),
        criticalFailures: bounded(analysis.criticalFailures),
    }
}

function recoveryTargetSummary(job) {
    const result = job?.parsedResult?.result ?? {}
    const destination = job?.parsedResult?.destination
    return {
        runtimeId: job?.runtime?.runtimeId ?? job?.runtimeId ?? "unknown-runtime",
        status: job?.status ?? "needs_recovery",
        installationJobId: job?.id ?? "unknown-installation-job",
        ...(typeof job?.operation === "string" ? {operation: job.operation} : {}),
        ...(typeof destination === "string" || destination === null ? {destination} : {}),
        ...(typeof result.actualDigest === "string"
            ? {lastVerifiedDigest: result.actualDigest}
            : {}),
    }
}

class OptimizationRunner {
    constructor(options = {}) {
        this.store = requiredDependency(options.store, "getRun", "Optimization store")
        requiredDependency(this.store, "transitionRun", "Optimization store")
        requiredDependency(this.store, "createEpoch", "Optimization store")
        requiredDependency(this.store, "updateEpoch", "Optimization store")
        requiredDependency(this.store, "updateCheckpoint", "Optimization store")
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
        requiredDependency(this.approvals, "reject", "Optimization approval gateway")
        requiredDependency(this.approvals, "suspend", "Optimization approval gateway")
        this.releaseManager = requiredDependency(options.releaseManager, "release", "Skill release manager")
        this.onChanged = options.onChanged ?? (() => {})
        if (typeof this.onChanged !== "function") throw new Error("Optimization change callback is invalid")
        this.controls = new Map()
        this.schedulingStopped = false
    }

    run(runId, context = {}) {
        if (this.schedulingStopped) {
            throw new Error("Optimization Runner scheduling is stopped for App shutdown")
        }
        if (this.controls.has(runId)) return this.controls.get(runId).operation
        const workspace = context.workspace === undefined || context.workspace === null
            ? null
            : clone(context.workspace)
        if (workspace !== null && workspace.runId !== runId) {
            throw new Error("Optimization workspace does not belong to the requested Run")
        }
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
            workspace,
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

    resume(runId, context = {}) {
        if (this.schedulingStopped) {
            throw new Error("Optimization Runner scheduling is stopped for App shutdown")
        }
        if (this.controls.has(runId)) throw new Error("Optimization Run is already active")
        const run = this.store.getRun(runId)
        if (run.state !== "needs_recovery" || run.checkpoint?.paused !== true) {
            throw new Error("Optimization Run is not paused and resumable")
        }
        const control = {
            runId,
            operatorSessionId: String(
                context.operatorSessionId ?? run.checkpoint.operatorSessionId ?? "",
            ),
            parentJobId: String(
                context.parentJobId ?? run.checkpoint.operatorParentJobId ?? "",
            ),
            cancelRequested: false,
            pauseRequested: false,
            initialTargets: clone(run.checkpoint.initialTargets ?? null),
            currentCandidate: null,
            previousCandidate: null,
            baselineEvaluation: null,
            previousEvaluation: null,
            workspace: clone(context.workspace ?? this.workspaceManager.get?.(runId) ?? null),
            resumePrepared: true,
        }
        if (!control.operatorSessionId || !control.parentJobId || !control.workspace) {
            throw new Error("Optimization resume requires its frozen Operator and workspace identities")
        }
        // Preparation only reads durable evidence and transitions the store. Fail
        // synchronously so the HTTP action can report a rejected recovery.
        this.#prepareResume(control)
        const operation = this.#execute(control)
            .finally(() => {
                if (this.controls.get(runId) === control) this.controls.delete(runId)
            })
        control.operation = operation
        this.controls.set(runId, control)
        return operation
    }

    resumeFinalApproval(runId, context = {}) {
        if (this.schedulingStopped) {
            throw new Error("Optimization Runner scheduling is stopped for App shutdown")
        }
        if (this.controls.has(runId)) throw new Error("Optimization Run is already active")
        const run = this.store.getRun(runId)
        if (
            run.state !== "needs_recovery" ||
            (
                run.recovery?.previousState !== "waiting_approval" &&
                run.checkpoint?.resumePhase !== "final_approval"
            )
        ) {
            throw new Error("Optimization Run has no interrupted final approval to resume")
        }
        const epoch = run.epochs.at(-1)
        if (
            !epoch || epoch.status !== "deciding" || !epoch.candidateArtifactId ||
            !epoch.analysisArtifactId || !epoch.decisionArtifactId
        ) {
            throw new Error("Interrupted final approval lacks durable Candidate decision evidence")
        }
        const candidates = run.epochs.filter((entry) => entry.candidateArtifactId)
        const control = {
            runId,
            operatorSessionId: String(
                context.operatorSessionId ?? run.checkpoint.operatorSessionId ?? "",
            ),
            parentJobId: String(
                context.parentJobId ?? run.checkpoint.operatorParentJobId ?? "",
            ),
            cancelRequested: false,
            pauseRequested: false,
            initialTargets: clone(run.checkpoint.initialTargets ?? null),
            currentCandidate: this.#readArtifact(epoch.candidateArtifactId),
            previousCandidate: candidates.length > 1
                ? this.#readArtifact(candidates.at(-2).candidateArtifactId)
                : null,
            baselineEvaluation: null,
            previousEvaluation: null,
            workspace: clone(context.workspace ?? this.workspaceManager.get?.(runId) ?? null),
        }
        if (
            !control.operatorSessionId || !control.parentJobId || !control.workspace ||
            !control.initialTargets
        ) {
            throw new Error("Final approval recovery requires its frozen Operator, workspace, and target identities")
        }
        const operation = this.#releaseAndInstall(control, {
            epochId: epoch.id,
            epochNumber: epoch.number,
            candidate: run.snapshot.search && run.checkpoint.selectedCandidateArtifactId
                ? this.#readArtifact(run.checkpoint.selectedCandidateArtifactId) : control.currentCandidate,
            stopReason: run.checkpoint.stopReason,
        }).catch((error) => this.#restore(control, "failed", error)).finally(() => {
            if (this.controls.get(runId) === control) this.controls.delete(runId)
        })
        control.operation = operation
        this.controls.set(runId, control)
        return operation
    }

    stop(runId) {
        const control = this.controls.get(runId)
        if (!control) {
            const run = this.store.getRun(runId)
            if (run.state !== "needs_recovery") throw new Error("Optimization Run is not active")
            const candidates = run.epochs.filter((epoch) => epoch.candidateArtifactId)
            const restored = {
                runId, cancelRequested: true,
                operatorSessionId: run.checkpoint.operatorSessionId,
                parentJobId: run.checkpoint.operatorParentJobId,
                initialTargets: clone(run.checkpoint.initialTargets ?? null),
                currentCandidate: candidates.length ? this.#readArtifact(candidates.at(-1).candidateArtifactId) : null,
                previousCandidate: candidates.length > 1 ? this.#readArtifact(candidates.at(-2).candidateArtifactId) : null,
                detachedRecovery: true,
            }
            const operation = this.#restore(restored, "cancelled", new Error("Optimization cancelled by user"))
                .finally(() => this.controls.delete(runId))
            restored.operation = operation
            this.controls.set(runId, restored)
            return operation
        }
        control.cancelRequested = true
        this.store.updateCheckpoint(runId, {stopRequested: true})
        this.operatorGateway.cancelRun?.(runId, "Optimization cancelled by user")
        const run = this.store.getRun(runId)
        const cancellations = []
        if (
            new Set(["baseline", "evaluating"]).has(run.state) &&
            run.checkpoint?.activeEvaluationRunId &&
            typeof this.evaluationManager.cancel === "function"
        ) {
            cancellations.push(this.evaluationManager.cancel(run.checkpoint.activeEvaluationRunId))
        }
        if (
            run.checkpoint?.installationPending === true &&
            typeof this.installationManager.cancel === "function"
        ) {
            cancellations.push(this.#cancelInstallationJobs(
                control,
                run.checkpoint.installationJobIds ?? [],
            ))
        }
        if (control.pendingApprovalId) {
            cancellations.push(this.approvals.reject(control.pendingApprovalId))
        }
        return Promise.allSettled(cancellations).then(() => control.operation)
    }

    pause(runId) {
        const control = this.controls.get(runId)
        if (!control) throw new Error("Optimization Run is not active")
        control.pauseRequested = true
        control.pauseReason = "user_pause"
        this.operatorGateway.cancelRun?.(runId, "Optimization paused by user")
        if (control.pendingApprovalId) this.approvals.suspend?.(control.pendingApprovalId)
        return {runId, status: "pausing"}
    }

    checkpointAndStop() {
        this.schedulingStopped = true
        const activeRunIds = [...this.controls.keys()].sort()
        for (const runId of activeRunIds) {
            const control = this.controls.get(runId)
            control.pauseRequested = true
            control.pauseReason = "app_shutdown"
            this.operatorGateway.cancelRun?.(runId, "Application shutdown")
            if (control.pendingApprovalId) this.approvals.suspend?.(control.pendingApprovalId)
        }
        return {activeRunIds}
    }

    async waitForIdle() {
        const operations = [...this.controls.values()].map((control) => control.operation)
        await Promise.allSettled(operations)
        return {activeRunIds: [...this.controls.keys()].sort()}
    }

    #readArtifact(artifactId) {
        if (typeof this.artifactStore.readArtifactBody !== "function") {
            throw new Error("Optimization Artifact store cannot restore persisted bodies")
        }
        const body = this.artifactStore.readArtifactBody(artifactId)
        return JSON.parse(Buffer.from(body).toString("utf8"))
    }

    #searchEntries(control, through = Infinity) {
        const run = this.store.getRun(control.runId)
        const baseline = {...run.snapshot.baseline, id: run.snapshot.baseline.versionId}
        return [{id: baseline.id, candidate: baseline, evaluation: control.baselineEvaluation, artifactId: null},
            ...run.epochs.filter((e) => e.number <= through && e.candidateArtifactId && e.evaluationArtifactIds?.length)
                .map((e) => {
                    const candidate = this.#readArtifact(e.candidateArtifactId)
                    return {id: candidate.id, candidate, artifactId: e.candidateArtifactId,
                        evaluation: this.#readArtifact(e.evaluationArtifactIds[0])}
                })]
    }

    async #prepareSearchCandidate(control, epoch) {
        const run = this.store.getRun(control.runId)
        const search = run.snapshot.search
        if (run.checkpoint.searchRequest?.epoch === epoch) return
        const groupStart = Math.floor((epoch - 1) / search.candidatesPerRound) * search.candidatesPerRound
        const entries = this.#searchEntries(control, groupStart)
        const selection = selectCandidates(entries, {parentLimit: search.parentLimit, baselineId: run.snapshot.baseline.versionId})
        const parentId = selection.parentIds[(epoch - groupStart - 1) % selection.parentIds.length]
        const parent = entries.find((e) => e.id === parentId)
        const feedback = sampleFeedback({runId: run.id, parentId, epoch, evaluation: parent.evaluation, search})
        if (!feedback.cards.length) throw new Error("No valid parent feedback is available for candidate generation")
        if (typeof this.workspaceManager.prepareParent !== "function") throw new Error("Workspace does not support multi-candidate search")
        await this.workspaceManager.prepareParent(run.id, parent.candidate)
        const request = {epoch, round: Math.floor(groupStart / search.candidatesPerRound) + 1,
            parentId, parentCommit: parent.candidate.commit, feedback}
        const artifact = this.#artifact(control.parentJobId, "optimization-feedback", `feedback-${epoch}.json`, request)
        this.store.updateCheckpoint(run.id, {searchRequest: request, feedbackArtifactId: artifact.id})
    }

    #prepareResume(control) {
        const run = this.store.getRun(control.runId)
        const epoch = run.epochs.at(-1)
        if (!run.checkpoint?.baselineEvaluationArtifactId) {
            throw new Error("Paused Optimization Run lacks durable resume evidence")
        }
        control.baselineEvaluation = this.#readArtifact(
            run.checkpoint.baselineEvaluationArtifactId,
        )
        const evaluatedEpoch = [...run.epochs].reverse().find((entry) => (
            entry.candidateArtifactId && entry.evaluationArtifactIds?.length
        ))
        if (evaluatedEpoch) {
            control.previousCandidate = this.#readArtifact(evaluatedEpoch.candidateArtifactId)
            control.currentCandidate = control.previousCandidate
            control.previousEvaluation = this.#readArtifact(evaluatedEpoch.evaluationArtifactIds[0])
        } else {
            control.previousEvaluation = control.baselineEvaluation
        }
        if (epoch?.status === "editing" && !epoch.candidateArtifactId) {
            control.resumeEditingEpoch = {epochId: epoch.id, index: epoch.number}
        } else if (epoch && !["completed", "succeeded", "failed", "cancelled"].includes(epoch.status)) {
            const completeEvidence = epoch.candidateArtifactId &&
                epoch.installArtifactIds?.length && epoch.evaluationArtifactIds?.length &&
                epoch.analysisArtifactId && epoch.decisionArtifactId
            if (completeEvidence && run.snapshot.search && epoch.number >= run.snapshot.limits.maxEpochs) {
                control.resumeSearchFinish = true
            } else {
                this.store.updateEpoch(control.runId, epoch.id, {
                    status: completeEvidence ? "completed" : "cancelled",
                })
            }
        }
        this.#transition(control, control.resumeSearchFinish ? "deciding" : "editing", {paused: false})
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
        const outcome = await this.#child(control, `optimization_${kind.replaceAll("-", "_")}`, `Run ${kind} evaluation`, async ({jobId}) => {
            if (control.cancelRequested) {
                throw Object.assign(new Error("Optimization cancelled before evaluation"), {
                    code: "OPTIMIZATION_CANCELLED",
                })
            }
            const evaluation = await this.evaluationManager.run({
                kind,
                optimizationRun: this.store.getRun(control.runId),
                candidate: clone(candidate),
                installationJobs: clone(installationJobs),
                targets: clone(this.store.getRun(control.runId).snapshot.targets),
            }, {
                cancelRequested: () => control.cancelRequested,
            })
            if (control.cancelRequested && evaluation?.status === "cancelled") {
                throw Object.assign(new Error("Optimization cancelled by user"), {
                    code: "OPTIMIZATION_CANCELLED",
                })
            }
            if (!evaluation || !new Set(["completed", "partial"]).has(evaluation.status)) {
                const error = new Error(`${kind} evaluation did not complete`)
                error.code = "OPTIMIZATION_EVALUATION_FAILED"
                throw error
            }
            const artifact = this.#artifact(jobId, "optimization-evaluation", `${kind}.json`, evaluation, {
                runId: control.runId,
                evaluationId: evaluation.id,
                epoch,
                kind,
            })
            return {evaluation, artifact}
        })
        if (control.cancelRequested && outcome?.status === "cancelled") {
            throw Object.assign(new Error("Optimization cancelled by user"), {
                code: "OPTIMIZATION_CANCELLED",
            })
        }
        return outcome
    }

    async #waitInstallationJobs(jobs) {
        const completed = await Promise.all(jobs.map(async (job) => {
            const waited = await this.installationManager.wait(job.id)
            return waited?.id ? waited : this.installationManager.store.getJob(job.id)
        }))
        const failed = completed.find((job) => !SUCCESSFUL_INSTALLATION_STATUSES.has(job.status))
        if (failed) {
            const reason = typeof failed.error?.message === "string" ? failed.error.message.slice(0, 4_096) : ""
            const error = new Error(`Runtime installation Job ${failed.id} ended as ${failed.status}${reason ? `: ${reason}` : ""}`)
            error.code = failed.status === "needs_recovery"
                ? "OPTIMIZATION_INSTALL_NEEDS_RECOVERY"
                : "OPTIMIZATION_INSTALL_FAILED"
            error.installationJob = failed
            error.installationJobs = completed
            throw error
        }
        return completed
    }

    async #cancelInstallationJobs(control, jobIds) {
        control.cancelledInstallationJobIds ??= new Set()
        const pending = []
        for (const jobId of new Set(jobIds)) {
            if (control.cancelledInstallationJobIds.has(jobId)) continue
            control.cancelledInstallationJobIds.add(jobId)
            pending.push(Promise.resolve().then(() => this.installationManager.cancel(jobId)))
        }
        await Promise.allSettled(pending)
    }

    async #experiment(
        control,
        operation,
        candidate,
        epoch,
        previousCandidate = null,
        targetRuntimeIds = null,
    ) {
        const execute = async (jobId = null) => {
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
            this.store.updateCheckpoint(control.runId, {
                installationOperation: operation,
                installationJobIds: jobs.map((job) => job.id),
                installationPending: true,
            })
            this.onChanged({runId: control.runId})
            if (
                control.cancelRequested &&
                !RECOVERY_INSTALLATION_OPERATIONS.has(operation) &&
                typeof this.installationManager.cancel === "function"
            ) {
                await this.#cancelInstallationJobs(control, jobs.map((job) => job.id))
            }
            let completed
            try {
                completed = await this.#waitInstallationJobs(jobs)
            } finally {
                this.store.updateCheckpoint(control.runId, {installationPending: false})
                this.onChanged({runId: control.runId})
            }
            if (jobId === null) return {jobs: completed}
            const artifact = this.#artifact(jobId, "optimization-installation", `${operation}-${epoch}.json`, {
                operation,
                jobs: completed,
            }, {runId: control.runId, epoch, operation})
            return {jobs: completed, artifact}
        }
        if (control.detachedRecovery === true) return execute()
        return this.#child(
            control,
            `optimization_${operation}`,
            `Run ${operation} for Epoch ${epoch}`,
            ({jobId}) => execute(jobId),
        )
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
                return parseOptimizationDecision(raw?.decision ?? raw)
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
            if (run.state === "preflight") {
                if (control.workspace === null) {
                    control.workspace = await this.workspaceManager.create(run)
                }
                this.#transition(control, "baseline", {workspace: control.workspace})
                const baseline = await this.#evaluate(
                    control,
                    "baseline",
                    run.snapshot.baseline,
                    [],
                )
                control.baselineEvaluation = baseline.evaluation
                control.previousEvaluation = baseline.evaluation
                this.store.updateCheckpoint(control.runId, {
                    baselineEvaluationArtifactId: baseline.artifact.id,
                    baselineEvaluationRunId: baseline.evaluation.id,
                })
                const results = baseline.evaluation.results ?? []
                const incomplete = results.find((result) => result.status !== "completed" ||
                    result.gradingStatus !== "completed" || !Number.isFinite(result.computedScore?.totalScore))
                if (incomplete || results.length !== run.snapshot.dataset.caseRevisions.length * run.snapshot.targets.length) {
                    throw Object.assign(new Error(`Baseline evaluation is incomplete; Skill optimization has not started. ${incomplete?.gradingError ?? incomplete?.error ?? "Some Case results are missing"}`), {
                        code: "OPTIMIZATION_BASELINE_INCOMPLETE",
                    })
                }
                this.#transition(control, "editing")
            } else if (!(control.resumePrepared === true && (run.state === "editing" || control.resumeSearchFinish && run.state === "deciding"))) {
                throw new Error("Optimization Run must start in preflight or a prepared resume")
            }

            if (control.resumeSearchFinish) {
                const last = this.store.getRun(control.runId).epochs.at(-1)
                return await this.#finishSearch(control, {epochId: last.id, epochNumber: last.number, stopReason: "max_epochs_reached"},
                    selectCandidates(this.#searchEntries(control), {parentLimit: run.snapshot.search.parentLimit, baselineId: run.snapshot.baseline.versionId}))
            }
            while (true) {
                if (control.cancelRequested) {
                    terminalIntent = "cancelled"
                    return this.#restore(control, terminalIntent, new Error("Optimization cancelled by user"))
                }
                const created = control.resumeEditingEpoch ?? this.store.createEpoch(control.runId)
                control.resumeEditingEpoch = null
                const epochNumber = created.index
                if (run.snapshot.search) await this.#prepareSearchCandidate(control, epochNumber)
                const submission = await this.operatorGateway.requestCandidate({
                    run: boundedRunSummary(this.store.getRun(control.runId)),
                    epoch: epochNumber,
                    workspace: clone(control.workspace),
                    operatorSessionId: control.operatorSessionId,
                })
                if (control.cancelRequested) {
                    throw Object.assign(new Error("Optimization cancelled before Candidate creation"), {
                        code: "OPTIMIZATION_CANCELLED",
                    })
                }
                const candidateChild = await this.#child(
                    control,
                    "optimization_candidate",
                    `Commit Candidate for Epoch ${epochNumber}`,
                    async ({jobId}) => {
                        const version = await this.workspaceManager.createCandidate({
                            runId: control.runId,
                            epoch: epochNumber,
                            message: String(submission?.message ?? ""),
                            ...(submission?.title ? {title: submission.title} : {}),
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
                if (control.cancelRequested) {
                    throw Object.assign(new Error("Optimization cancelled after Candidate creation"), {
                        code: "OPTIMIZATION_CANCELLED",
                    })
                }
                control.currentCandidate = candidateChild.candidate
                this.store.updateEpoch(control.runId, created.epochId, {
                    candidateArtifactId: candidateChild.artifact.id,
                })

                if (control.initialTargets === null) {
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

                this.onChanged({runId: control.runId, state: "deciding"})
                const analysisInput = {
                    baseline: control.baselineEvaluation,
                    previous: control.previousEvaluation,
                    current: candidateEvaluation.evaluation,
                    epoch: epochNumber,
                    limits: {maxEpochs: run.snapshot.limits.maxEpochs},
                    cancelRequested: control.cancelRequested,
                    recoveryFailed: false,
                }
                const provisional = compareEvaluationRuns({
                    ...analysisInput,
                    agentDecision: {action: "continue"},
                })
                let requestedDecision
                try {
                    requestedDecision = run.snapshot.search ? {
                        schemaVersion: "rolling-skill-optimization-decision/v1",
                        action: epochNumber >= run.snapshot.limits.maxEpochs ? "finish" : "continue",
                        rationale: "Fixed candidate budget; selection uses complete common regression results, not sampled feedback.",
                    } : await this.#requestDecision(control, {
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
                const analysis = clone(compareEvaluationRuns({...analysisInput, agentDecision: requestedDecision}))
                let selection = null
                if (run.snapshot.search) {
                    selection = selectCandidates(this.#searchEntries(control), {
                        parentLimit: run.snapshot.search.parentLimit, baselineId: run.snapshot.baseline.versionId,
                    })
                    analysis.search = selection
                    analysis.feedbackArtifactId = this.store.getRun(control.runId).checkpoint.feedbackArtifactId
                    analysis.parentId = this.store.getRun(control.runId).checkpoint.searchRequest.parentId
                }
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
                    requestedDecision,
                    {runId: control.runId, epoch: epochNumber},
                )
                this.store.updateEpoch(control.runId, created.epochId, {
                    analysisArtifactId: analysisArtifact.id,
                    decisionArtifactId: decisionArtifact.id,
                })
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
                    this.#transition(control, "editing")
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
                if (selection) {
                    return await this.#finishSearch(control, {
                        epochId: created.epochId, epochNumber, stopReason: stopDecision.reason,
                    }, selection)
                }
                return await this.#releaseAndInstall(control, {
                    epochId: created.epochId,
                    epochNumber,
                    candidate: control.currentCandidate,
                    stopReason: stopDecision.reason,
                })
            }
        } catch (error) {
            if (control.cancelRequested) return this.#restore(control, "cancelled", error)
            if (control.pauseRequested) {
                const resumePhase = this.store.getRun(control.runId).state === "waiting_approval"
                    ? "final_approval"
                    : undefined
                this.#transition(control, "needs_recovery", {
                    paused: true,
                    pauseReason: control.pauseReason ?? "app_shutdown",
                    ...(resumePhase ? {resumePhase} : {}),
                })
                return {runId: control.runId, status: "paused", reason: "app_shutdown"}
            }
            return this.#restore(control, terminalIntent, error)
        }
    }

    async #finishSearch(control, context, selection) {
        const winner = this.#searchEntries(control).find((e) => e.id === selection.winnerId)
        this.store.updateCheckpoint(control.runId, {
            selectedCandidateArtifactId: winner.artifactId, selection, stopReason: context.stopReason,
        })
        if (!winner.artifactId) {
            this.store.updateEpoch(control.runId, context.epochId, {status: "succeeded"})
            return this.#restore(control, "succeeded", null)
        }
        return this.#releaseAndInstall(control, {...context, candidate: winner.candidate})
    }

    async #cleanupWorkspace(control) {
        try {
            await this.workspaceManager.cleanup?.(control.runId)
        } catch (error) {
            // Cleanup is not an installation failure. Keep uncommitted work and
            // report it without rolling back an already approved release.
            this.store.updateCheckpoint(control.runId, {workspaceRetained: true, workspaceCleanupError: errorRecord(error)})
        }
    }

    async #releaseAndInstall(control, context) {
        this.#transition(control, "waiting_approval", {stopReason: context.stopReason})
        const finalApproval = await this.approvals.request({
            kind: "release-install",
            parentJobId: control.parentJobId,
            runId: control.runId,
            epoch: context.epochNumber,
            candidate: clone(context.candidate),
        }, (approval) => {
            const approvalId = approval?.approvalId ?? approval?.id ?? null
            if (!approvalId) return
            control.pendingApprovalId = approvalId
            this.store.updateCheckpoint(control.runId, {finalApprovalId: approvalId})
            this.onChanged({runId: control.runId, state: "waiting_approval"})
        })
        control.pendingApprovalId = null
        if (control.pauseRequested) {
            throw Object.assign(new Error("Optimization paused during final approval"), {
                code: "OPTIMIZATION_PAUSED",
            })
        }
        this.store.updateCheckpoint(control.runId, {
            finalApprovalId: finalApproval?.approvalId ?? null,
        })
        this.onChanged({runId: control.runId, state: "waiting_approval"})
        if (finalApproval?.approved !== true) {
            return this.#restore(
                control,
                "cancelled",
                Object.assign(new Error("Optimization release and installation were rejected"), {
                    code: "OPTIMIZATION_FINAL_APPROVAL_REJECTED",
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
                approval: finalApproval,
                jobId,
            }),
        )
        if (control.cancelRequested) {
            throw Object.assign(new Error("Optimization cancelled before Released installation"), {
                code: "OPTIMIZATION_CANCELLED",
            })
        }
        this.#transition(control, "installing", {
            releasePhase: "released-install",
            finalApprovalId: finalApproval.approvalId ?? null,
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
                this.store.updateCheckpoint(control.runId, {
                    installationJobIds: jobs.map((job) => job.id),
                    installationPending: true,
                })
                this.onChanged({runId: control.runId, state: "installing"})
                if (control.cancelRequested && typeof this.installationManager.cancel === "function") {
                    await this.#cancelInstallationJobs(control, jobs.map((job) => job.id))
                }
                let completed
                try {
                    completed = await this.#waitInstallationJobs(jobs)
                } finally {
                    this.store.updateCheckpoint(control.runId, {installationPending: false})
                    this.onChanged({runId: control.runId, state: "installing"})
                }
                const artifact = this.#artifact(jobId, "optimization-installation", "released-install.json", {
                    versionId: released.id,
                    jobs: completed,
                })
                return {jobs: completed, artifact}
            },
        )
        if (formalInstallation?.status === "cancelled") {
            control.cancelRequested = true
            control.detachedRecovery = true
            return this.#restore(
                control,
                "cancelled",
                Object.assign(new Error("Released installation was cancelled"), {
                    code: "OPTIMIZATION_CANCELLED",
                }),
            )
        }
        if (!formalInstallation?.artifact?.id) {
            throw Object.assign(new Error("Released installation completed without an audit Artifact"), {
                code: "OPTIMIZATION_INSTALL_FAILED",
            })
        }
        this.store.updateCheckpoint(control.runId, {
            releasePhase: "installed",
            releasedInstallArtifactId: formalInstallation.artifact.id,
        })
        this.onChanged({runId: control.runId, state: "installing"})
        this.store.updateEpoch(control.runId, context.epochId, {status: "succeeded"})
        this.#transition(control, "succeeded", null, null)
        await this.#cleanupWorkspace(control)
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
            this.#transition(control, terminalState, null, cause ? errorRecord(cause) : null)
            await this.#cleanupWorkspace(control)
            return {runId: control.runId, status: terminalState, error: cause ? errorRecord(cause) : null}
        }
        try {
            if (run.state !== "restoring") this.#transition(control, "restoring", null, cause ? errorRecord(cause) : null)
            for (const [classification, operation] of [
                ["managed-clean", "experiment_restore"],
                ["absent", "experiment_remove"],
            ]) {
                const runtimeIds = Object.entries(control.initialTargets)
                    .filter(([, initial]) => initial.classification === classification)
                    .map(([runtimeId]) => runtimeId)
                if (!runtimeIds.length) continue
                const priorEpoch = run.epochs.find((entry) => entry.number === control.currentCandidate.optimizationEpoch - 1)
                await this.#experiment(
                    control,
                    operation,
                    control.currentCandidate,
                    control.currentCandidate.optimizationEpoch,
                    priorEpoch?.candidateArtifactId ? this.#readArtifact(priorEpoch.candidateArtifactId) : null,
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
            await this.#cleanupWorkspace(control)
            return {runId: control.runId, status: terminalState, error: cause ? errorRecord(cause) : null}
        } catch (recoveryError) {
            const recoveryJobs = Array.isArray(recoveryError.installationJobs)
                ? recoveryError.installationJobs
                : recoveryError.installationJob ? [recoveryError.installationJob] : []
            this.#transition(control, "needs_recovery", {
                recoveryError: errorRecord(recoveryError),
                recoveryTargets: recoveryJobs.map(recoveryTargetSummary),
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
