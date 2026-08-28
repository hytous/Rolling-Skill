const {
    buildScoreContract,
    buildJudgePrompt,
    parseJudgeResult,
    computeScore,
} = require("./evaluation-grading.cjs")
const {buildEvidenceCatalog} = require("./evaluation-evidence-catalog.cjs")
const {snapshotSkillEvidence} = require("./evaluation-skill-evidence.cjs")
const {resolveExecutedSkillEvidenceBinding} = require("./evaluation-skill-binding.cjs")

const SKILL_DRIFT_ERROR = "Skill changed after evaluation snapshot"
const CANCELLATION_ERROR = "Evaluation cancelled by user"

class AsyncTaskQueue {
    constructor() {
        this.items = []
        this.waiters = []
        this.closed = false
    }

    enqueue(item) {
        if (this.closed) return false
        const waiter = this.waiters.shift()
        if (waiter) waiter(item)
        else this.items.push(item)
        return true
    }

    next() {
        if (this.items.length) return Promise.resolve(this.items.shift())
        if (this.closed) return Promise.resolve(null)
        return new Promise((resolve) => this.waiters.push(resolve))
    }

    close() {
        if (this.closed) return
        this.closed = true
        for (const waiter of this.waiters.splice(0)) waiter(null)
    }
}

function runtimeDescriptor(configuration = {}) {
    return {
        runtimeId: configuration.runtimeId,
        providerId: configuration.providerId,
        displayName: configuration.displayName,
        version: configuration.version,
        executablePath: configuration.executablePath,
        source: configuration.source,
        transport: configuration.transport,
        capabilities: configuration.capabilities ?? [],
        models: configuration.models ?? [],
        efforts: configuration.efforts ?? [],
    }
}

function judgeRecord(configuration, output = {}, patch = {}) {
    output = output ?? {}
    return {
        runtimeId: configuration.runtimeId ?? null,
        providerId: configuration.providerId ?? null,
        displayName: configuration.displayName ?? null,
        version: configuration.version ?? null,
        modelId: configuration.modelId ?? null,
        effort: configuration.effort ?? null,
        threadId: output.threadId ?? null,
        turnId: output.turnId ?? null,
        traceReference: output.traceReference ?? null,
        durationMs: output.durationMs ?? null,
        ...patch,
    }
}

function judgeConfigurationForRun(run) {
    const configuration = run.judgeConfiguration ?? null
    if (!configuration) return null
    return {
        ...configuration,
        modelId: configuration.modelId ?? run.judgeProfile?.modelId ?? null,
        effort: configuration.effort ?? run.judgeProfile?.effort ?? null,
    }
}

function targetFailureDiagnostics(error) {
    const fields = [
        "code",
        "threadId",
        "turnId",
        "durationMs",
        "lastActivityAt",
        "traceReference",
        "traceEvidence",
    ]
    const diagnostics = {}
    for (const field of fields) {
        if (error?.[field] !== undefined && error?.[field] !== null) {
            diagnostics[field] = error[field]
        }
    }
    return Object.keys(diagnostics).length ? diagnostics : null
}

class EvaluationRunner {
    constructor({
        store,
        runtimeRegistry,
        workspaceRoot,
        traceDirectory,
        getExecutionPolicy = () => null,
        onChanged = () => {},
        snapshotSkill = snapshotSkillEvidence,
        acquireRunLease = () => () => {},
    }) {
        this.store = store
        this.runtimeRegistry = runtimeRegistry
        this.workspaceRoot = workspaceRoot
        this.traceDirectory = traceDirectory
        this.getExecutionPolicy = getExecutionPolicy
        this.onChanged = onChanged
        this.snapshotSkill = snapshotSkill
        this.acquireRunLease = acquireRunLease
        this.running = new Map()
        this.runControls = new Map()
        this.activeClients = new Set()
        this.clientStopOperations = new WeakMap()
    }

    assertSkillSnapshotUnchanged(run) {
        if (run.managedVersionSnapshot) return
        if (!run.skillReference || !run.skillEvidence?.digest) return
        let current
        try {
            current = this.snapshotSkill(run.skillReference)
        } catch (error) {
            throw new Error(`${SKILL_DRIFT_ERROR}: ${error?.message ?? String(error)}`)
        }
        if (current?.digest !== run.skillEvidence.digest) {
            throw new Error(SKILL_DRIFT_ERROR)
        }
    }

    run(run) {
        if (this.running.has(run.id)) return this.running.get(run.id)
        const control = {
            cancelRequested: false,
            clients: new Set(),
            executionStates: new Map(
                (run.results ?? []).map((result) => [result.id, result.status ?? "queued"]),
            ),
            gradingStates: new Map(
                (run.results ?? []).map((result) => [
                    result.id,
                    result.gradingStatus ??
                        (result.status === "completed" ? "queued" : "awaiting_execution"),
                ]),
            ),
            gradingQueue: new AsyncTaskQueue(),
            operation: null,
        }
        this.runControls.set(run.id, control)
        const operation = this.execute(run, control).finally(() => {
            this.running.delete(run.id)
            this.runControls.delete(run.id)
        })
        control.operation = operation
        this.running.set(run.id, operation)
        return operation
    }

    async execute(run, control) {
        const releaseRunLease = this.acquireRunLease()
        try {
            return await this.executeWithLease(run, control)
        } finally {
            releaseRunLease?.()
        }
    }

    async executeWithLease(run, control) {
        const startedAt = new Date().toISOString()
        this.store.updateEvaluationRun(run.id, {status: "running", startedAt})
        this.onChanged({runId: run.id, status: "running"})
        const gradingOperation = this.runGradingQueue(run, control.gradingQueue, control)
        const queues = run.runtimeConfigurations.map((configuration) =>
            this.runRuntimeQueue(run, configuration, control),
        )
        let settled
        try {
            settled = await Promise.all(queues)
        } finally {
            control.gradingQueue.close()
        }
        await gradingOperation
        const completedCount = settled.reduce((sum, entry) => sum + entry.completed, 0)
        const failedCount = settled.reduce((sum, entry) => sum + entry.failed, 0)

        if (control.cancelRequested) {
            this.cancelRemainingResults(run, control)
            const completedAt = new Date().toISOString()
            this.store.updateEvaluationRun(run.id, {status: "cancelled", completedAt})
            this.onChanged({runId: run.id, status: "cancelled"})
            return {
                id: run.id,
                status: "cancelled",
                startedAt,
                completedAt,
                completedCount,
                failedCount,
            }
        }

        const status = failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "partial"
        const completedAt = new Date().toISOString()
        this.store.updateEvaluationRun(run.id, {status, completedAt})
        this.onChanged({runId: run.id, status})
        return {id: run.id, status, startedAt, completedAt, completedCount, failedCount}
    }

    async runRuntimeQueue(run, configuration, control) {
        const results = run.results.filter(
            (entry) =>
                (entry.runtimeId ?? entry.runtimeConfiguration?.runtimeId) ===
                configuration.runtimeId,
        )
        const client = this.runtimeRegistry.createClient(runtimeDescriptor(configuration), {
            workspaceRoot: this.workspaceRoot,
            traceDirectory: this.traceDirectory,
            executionPolicy: this.getExecutionPolicy(),
            nonInteractive: true,
        })
        this.activeClients.add(client)
        control.clients.add(client)
        let completed = 0
        let failed = 0
        try {
            await client.start()
            if (typeof client.runEvaluationCase !== "function") {
                throw new Error("This runtime does not support evaluation execution")
            }
            for (const result of results) {
                if (control.cancelRequested) {
                    this.cancelExecutionResult(run, result, control)
                    continue
                }
                const resultStartedAt = new Date().toISOString()
                this.store.updateEvaluationResult(run.id, result.id, {
                    status: "running",
                    startedAt: resultStartedAt,
                })
                control.executionStates.set(result.id, "running")
                this.onChanged({runId: run.id, resultId: result.id, status: "running"})
                try {
                    const targetSkillReference = configuration.skillReference ?? run.skillReference
                    this.assertSkillSnapshotUnchanged(run)
                    const output = await client.runEvaluationCase({
                        question: result.caseSnapshot.question,
                        activationMode: run.activationMode,
                        skillReference: targetSkillReference,
                        modelId: configuration.modelId,
                        effort: configuration.effort,
                    })
                    this.assertSkillSnapshotUnchanged(run)
                    if (control.cancelRequested) {
                        this.cancelExecutionResult(run, result, control)
                        continue
                    }
                    const gradingQueuedAt = new Date().toISOString()
                    const declaredBinding =
                        result.runtimeConfiguration?.skillEvidenceBinding ??
                        configuration.skillEvidenceBinding ??
                        "unverified"
                    const skillExecutionBinding = resolveExecutedSkillEvidenceBinding({
                        declaredBinding,
                        skillReference: targetSkillReference,
                        skillEvidence: run.skillEvidence,
                        traceEvidence: output.traceEvidence,
                        verifyContentDigest: !run.managedVersionSnapshot,
                    })
                    output.skillExecutionBinding = skillExecutionBinding
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "completed",
                        gradingStatus: "queued",
                        gradingQueuedAt,
                        durationMs: output.durationMs,
                        response: output.response ?? "",
                        threadId: output.threadId ?? null,
                        turnId: output.turnId ?? null,
                        traceReference: output.traceReference ?? null,
                        ...(output.traceEvidence ? {traceEvidence: output.traceEvidence} : {}),
                        skillExecutionBinding,
                        completedAt: new Date().toISOString(),
                    })
                    control.executionStates.set(result.id, "completed")
                    control.gradingStates.set(result.id, "queued")
                    completed += 1
                    const enqueued = control.gradingQueue.enqueue({result, output})
                    if (!enqueued) this.cancelGradingResult(run, result, control)
                    this.onChanged({
                        runId: run.id,
                        resultId: result.id,
                        status: "completed",
                        phase: "grading",
                        gradingStatus: enqueued ? "queued" : "skipped",
                    })
                } catch (error) {
                    if (control.cancelRequested) {
                        this.cancelExecutionResult(run, result, control)
                        continue
                    }
                    const failureDiagnostics = targetFailureDiagnostics(error)
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "failed",
                        gradingStatus: "skipped",
                        judge: {
                            status: "skipped",
                            error: "Target execution did not complete; grading was skipped",
                        },
                        error: error?.message ?? String(error),
                        ...(failureDiagnostics ? {
                            failureDiagnostics,
                            threadId: failureDiagnostics.threadId ?? null,
                            turnId: failureDiagnostics.turnId ?? null,
                            durationMs: failureDiagnostics.durationMs ?? null,
                            lastActivityAt: failureDiagnostics.lastActivityAt ?? null,
                            traceReference: failureDiagnostics.traceReference ?? null,
                            ...(failureDiagnostics.traceEvidence
                                ? {traceEvidence: failureDiagnostics.traceEvidence}
                                : {}),
                        } : {}),
                        completedAt: new Date().toISOString(),
                    })
                    control.executionStates.set(result.id, "failed")
                    control.gradingStates.set(result.id, "skipped")
                    failed += 1
                    this.onChanged({runId: run.id, resultId: result.id, status: "failed"})
                }
            }
        } catch (error) {
            for (const result of results) {
                if (control.executionStates.get(result.id) !== "queued") continue
                if (control.cancelRequested) {
                    this.cancelExecutionResult(run, result, control)
                    continue
                }
                this.store.updateEvaluationResult(run.id, result.id, {
                    status: "failed",
                    gradingStatus: "skipped",
                    judge: {
                        status: "skipped",
                        error: "Target execution did not start; grading was skipped",
                    },
                    error: error?.message ?? String(error),
                    completedAt: new Date().toISOString(),
                })
                control.executionStates.set(result.id, "failed")
                control.gradingStates.set(result.id, "skipped")
                failed += 1
                this.onChanged({runId: run.id, resultId: result.id, status: "failed"})
            }
        } finally {
            await this.stopClient(client)
            control.clients.delete(client)
        }
        return {completed, failed}
    }

    async runGradingQueue(run, queue, control) {
        const configuration = judgeConfigurationForRun(run)
        let client = null
        let startupError = null
        try {
            while (true) {
                const entry = await queue.next()
                if (!entry) break
                if (control.cancelRequested) {
                    this.cancelGradingResult(run, entry.result, control)
                    continue
                }
                if (!configuration?.runtimeId || !configuration.providerId || !configuration.executablePath) {
                    this.failGrading(run, entry.result, configuration ?? {}, new Error(
                        "An independent Judge runtime configuration is required",
                    ))
                    control.gradingStates.set(entry.result.id, "failed")
                    continue
                }
                if (!client && !startupError) {
                    try {
                        client = this.runtimeRegistry.createClient(runtimeDescriptor(configuration), {
                            workspaceRoot: this.workspaceRoot,
                            traceDirectory: this.traceDirectory,
                            executionPolicy: {sandbox: "read-only", approvalPolicy: "never"},
                            nonInteractive: true,
                        })
                        this.activeClients.add(client)
                        control.clients.add(client)
                        await client.start()
                        if (typeof client.runEvaluationJudge !== "function") {
                            throw new Error("The selected runtime does not support evaluation judging")
                        }
                    } catch (error) {
                        startupError = error
                        if (client) await this.stopClient(client)
                        if (client) control.clients.delete(client)
                        client = null
                    }
                }
                if (control.cancelRequested) {
                    this.cancelGradingResult(run, entry.result, control)
                    continue
                }
                if (startupError) {
                    this.failGrading(run, entry.result, configuration, startupError)
                    control.gradingStates.set(entry.result.id, "failed")
                    continue
                }
                await this.gradeCompletedResult({
                    run,
                    result: entry.result,
                    output: entry.output,
                    configuration,
                    client,
                    control,
                })
            }
        } finally {
            if (client) await this.stopClient(client)
            if (client) control.clients.delete(client)
        }
    }

    async gradeCompletedResult({run, result, output, configuration, client, control}) {
        const gradingStartedAt = new Date().toISOString()
        this.store.updateEvaluationResult(run.id, result.id, {
            gradingStatus: "running",
            gradingStartedAt,
            gradingCompletedAt: null,
            gradingError: null,
        })
        control.gradingStates.set(result.id, "running")
        this.onChanged({
            runId: run.id,
            resultId: result.id,
            phase: "grading",
            gradingStatus: "running",
        })

        let lastOutput = null
        let attempts = 0
        let contract = null
        try {
            const evidenceCatalog = buildEvidenceCatalog({
                response: output.response ?? "",
                traceEvidence: output.traceEvidence ?? null,
                skillEvidence: run.skillEvidence ?? null,
            })
            contract = buildScoreContract(result.caseSnapshot, {
                activationMode: run.activationMode,
                evidenceCatalog,
                rubricVersion: run.rubricVersionSnapshot ?? null,
            })
            const basePrompt = buildJudgePrompt({
                contract,
                question: result.caseSnapshot.question,
                response: output.response ?? "",
                traceEvidence:
                    output.traceEvidence ??
                    (output.traceReference ? {reference: output.traceReference} : null),
                skillEvidence: run.skillEvidence ?? null,
                evidenceCatalog,
                activationMode: run.activationMode,
            })

            let judgment
            let validationError = null
            for (let attempt = 1; attempt <= 2; attempt += 1) {
                if (control.cancelRequested) throw new Error(CANCELLATION_ERROR)
                attempts = attempt
                const prompt = validationError
                    ? `${basePrompt}\n\nYour previous JSON was rejected by the fixed validator: <validation-error>${validationError}</validation-error>\nReturn a corrected JSON object only. Do not rerun or reinterpret the target task.`
                    : basePrompt
                lastOutput = await client.runEvaluationJudge({
                    prompt,
                    modelId: configuration.modelId,
                    effort: configuration.effort,
                    attempt,
                })
                try {
                    judgment = parseJudgeResult(lastOutput.response ?? "", contract)
                    break
                } catch (error) {
                    if (attempt === 2) throw error
                    validationError = error?.message ?? String(error)
                }
            }
            const computedScore = computeScore(contract, judgment, {
                activationMode: run.activationMode,
                skillEvidenceBinding:
                    output.skillExecutionBinding?.effectiveBinding ??
                    result.runtimeConfiguration?.skillEvidenceBinding ??
                    run.runtimeConfigurations.find((candidate) =>
                        candidate.runtimeId ===
                        (result.runtimeId ?? result.runtimeConfiguration?.runtimeId),
                    )?.skillEvidenceBinding ??
                    "unverified",
            })
            const judge = judgeRecord(configuration, lastOutput, {
                status: "completed",
                attempts,
                contractDigest: contract.digest,
            })
            this.store.updateEvaluationResult(run.id, result.id, {
                gradingStatus: "completed",
                scoreContract: contract,
                judgment,
                computedScore,
                judge,
                gradingError: null,
                gradingCompletedAt: new Date().toISOString(),
            })
            control.gradingStates.set(result.id, "completed")
            this.onChanged({
                runId: run.id,
                resultId: result.id,
                phase: "grading",
                gradingStatus: "completed",
                verdict: computedScore.overallVerdict,
            })
        } catch (error) {
            if (control.cancelRequested) {
                this.cancelGradingResult(run, result, control)
                return
            }
            this.failGrading(run, result, configuration, error, lastOutput, {
                attempts,
                scoreContract: contract,
            })
            control.gradingStates.set(result.id, "failed")
        }
    }

    cancelExecutionResult(run, result, control) {
        const status = control.executionStates.get(result.id)
        if (status === "completed" || status === "failed" || status === "cancelled") return
        const completedAt = new Date().toISOString()
        this.store.updateEvaluationResult(run.id, result.id, {
            status: "cancelled",
            gradingStatus: "skipped",
            judge: {status: "skipped", error: `${CANCELLATION_ERROR}; grading skipped`},
            error: CANCELLATION_ERROR,
            completedAt,
            gradingError: CANCELLATION_ERROR,
            gradingCompletedAt: completedAt,
        })
        control.executionStates.set(result.id, "cancelled")
        control.gradingStates.set(result.id, "skipped")
        this.onChanged({runId: run.id, resultId: result.id, status: "cancelled"})
    }

    cancelGradingResult(run, result, control) {
        const gradingStatus = control.gradingStates.get(result.id)
        if (["completed", "failed", "skipped"].includes(gradingStatus)) return
        const completedAt = new Date().toISOString()
        this.store.updateEvaluationResult(run.id, result.id, {
            gradingStatus: "skipped",
            gradingError: CANCELLATION_ERROR,
            gradingCompletedAt: completedAt,
            judge: {status: "skipped", error: CANCELLATION_ERROR},
        })
        control.gradingStates.set(result.id, "skipped")
        this.onChanged({
            runId: run.id,
            resultId: result.id,
            phase: "grading",
            gradingStatus: "skipped",
        })
    }

    cancelRemainingResults(run, control) {
        for (const result of run.results ?? []) {
            const executionStatus = control.executionStates.get(result.id)
            if (executionStatus === "queued" || executionStatus === "running") {
                this.cancelExecutionResult(run, result, control)
            } else if (executionStatus === "completed") {
                this.cancelGradingResult(run, result, control)
            }
        }
    }

    failGrading(run, result, configuration, error, output = {}, details = {}) {
        const message = error?.message ?? String(error)
        this.store.updateEvaluationResult(run.id, result.id, {
            gradingStatus: "failed",
            ...(details.scoreContract ? {scoreContract: details.scoreContract} : {}),
            gradingError: message,
            gradingCompletedAt: new Date().toISOString(),
            judge: judgeRecord(configuration, output, {
                status: "failed",
                attempts: details.attempts ?? 0,
                error: message,
            }),
        })
        this.onChanged({
            runId: run.id,
            resultId: result.id,
            phase: "grading",
            gradingStatus: "failed",
            error: message,
        })
    }

    stopClient(client) {
        const existing = this.clientStopOperations.get(client)
        if (existing) return existing
        const operation = Promise.resolve()
            .then(() => client.stop())
            .catch(() => {})
            .finally(() => this.activeClients.delete(client))
        this.clientStopOperations.set(client, operation)
        return operation
    }

    async cancel(runId) {
        const control = this.runControls.get(runId)
        if (!control) {
            if (typeof this.store.cancelEvaluationRun !== "function") {
                throw new Error("Evaluation run is not active")
            }
            const run = this.store.cancelEvaluationRun(runId)
            this.onChanged({runId, status: "cancelled"})
            return run
        }
        if (!control.cancelRequested) {
            control.cancelRequested = true
            control.gradingQueue.close()
            await Promise.all([...control.clients].map((client) => this.stopClient(client)))
        }
        const outcome = await control.operation
        return typeof this.store.getEvaluationRun === "function"
            ? this.store.getEvaluationRun(runId)
            : outcome
    }

    async stopAll() {
        for (const control of this.runControls.values()) {
            control.cancelRequested = true
            control.gradingQueue.close()
        }
        await Promise.all([...this.activeClients].map((client) => this.stopClient(client)))
        await Promise.allSettled([...this.running.values()])
    }
}

module.exports = {EvaluationRunner}
