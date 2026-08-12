const {
    buildScoreContract,
    buildJudgePrompt,
    parseJudgeResult,
    computeScore,
} = require("./evaluation-grading.cjs")
const {buildEvidenceCatalog} = require("./evaluation-evidence-catalog.cjs")
const {snapshotSkillEvidence} = require("./evaluation-skill-evidence.cjs")

const SKILL_DRIFT_ERROR = "Skill changed after evaluation snapshot"

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

class EvaluationRunner {
    constructor({
        store,
        runtimeRegistry,
        workspaceRoot,
        traceDirectory,
        getExecutionPolicy = () => null,
        onChanged = () => {},
        snapshotSkill = snapshotSkillEvidence,
    }) {
        this.store = store
        this.runtimeRegistry = runtimeRegistry
        this.workspaceRoot = workspaceRoot
        this.traceDirectory = traceDirectory
        this.getExecutionPolicy = getExecutionPolicy
        this.onChanged = onChanged
        this.snapshotSkill = snapshotSkill
        this.running = new Map()
        this.activeClients = new Set()
        this.clientStopOperations = new WeakMap()
    }

    assertSkillSnapshotUnchanged(run) {
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
        const operation = this.execute(run).finally(() => this.running.delete(run.id))
        this.running.set(run.id, operation)
        return operation
    }

    async execute(run) {
        const startedAt = new Date().toISOString()
        this.store.updateEvaluationRun(run.id, {status: "running", startedAt})
        this.onChanged({runId: run.id, status: "running"})
        const queues = run.runtimeConfigurations.map((configuration) =>
            this.runRuntimeQueue(run, configuration),
        )
        const settled = await Promise.all(queues)
        const completedCount = settled.reduce((sum, entry) => sum + entry.completed, 0)
        const failedCount = settled.reduce((sum, entry) => sum + entry.failed, 0)
        const completedResults = settled.flatMap((entry) => entry.completedResults)

        await this.runGradingPhase(run, completedResults)

        const status = failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "partial"
        const completedAt = new Date().toISOString()
        this.store.updateEvaluationRun(run.id, {status, completedAt})
        this.onChanged({runId: run.id, status})
        return {id: run.id, status, startedAt, completedAt, completedCount, failedCount}
    }

    async runRuntimeQueue(run, configuration) {
        const results = run.results.filter(
            (entry) =>
                (entry.runtimeId ?? entry.runtimeConfiguration?.runtimeId) ===
                configuration.runtimeId,
        )
        const client = this.runtimeRegistry.createClient(runtimeDescriptor(configuration), {
            workspaceRoot: this.workspaceRoot,
            traceDirectory: this.traceDirectory,
            executionPolicy: this.getExecutionPolicy(),
        })
        this.activeClients.add(client)
        let completed = 0
        let failed = 0
        const completedResults = []
        try {
            await client.start()
            if (typeof client.runEvaluationCase !== "function") {
                throw new Error("This runtime does not support evaluation execution")
            }
            for (const result of results) {
                const resultStartedAt = new Date().toISOString()
                this.store.updateEvaluationResult(run.id, result.id, {
                    status: "running",
                    startedAt: resultStartedAt,
                })
                this.onChanged({runId: run.id, resultId: result.id, status: "running"})
                try {
                    this.assertSkillSnapshotUnchanged(run)
                    const output = await client.runEvaluationCase({
                        question: result.caseSnapshot.question,
                        activationMode: run.activationMode,
                        skillReference: run.skillReference,
                        modelId: configuration.modelId,
                        effort: configuration.effort,
                    })
                    this.assertSkillSnapshotUnchanged(run)
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "completed",
                        durationMs: output.durationMs,
                        response: output.response ?? "",
                        threadId: output.threadId ?? null,
                        turnId: output.turnId ?? null,
                        traceReference: output.traceReference ?? null,
                        ...(output.traceEvidence ? {traceEvidence: output.traceEvidence} : {}),
                        completedAt: new Date().toISOString(),
                    })
                    completed += 1
                    completedResults.push({result, output})
                    this.onChanged({runId: run.id, resultId: result.id, status: "completed"})
                } catch (error) {
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "failed",
                        gradingStatus: "skipped",
                        judge: {
                            status: "skipped",
                            error: "Target execution did not complete; grading was skipped",
                        },
                        error: error?.message ?? String(error),
                        completedAt: new Date().toISOString(),
                    })
                    failed += 1
                    this.onChanged({runId: run.id, resultId: result.id, status: "failed"})
                }
            }
        } catch (error) {
            for (const result of results) {
                if (result.status !== "queued") continue
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
                failed += 1
                this.onChanged({runId: run.id, resultId: result.id, status: "failed"})
            }
        } finally {
            await this.stopClient(client)
        }
        return {completed, failed, completedResults}
    }

    async runGradingPhase(run, completedResults) {
        if (!completedResults.length) return
        const configuration = judgeConfigurationForRun(run)
        if (!configuration?.runtimeId || !configuration.providerId || !configuration.executablePath) {
            for (const entry of completedResults) {
                this.failGrading(run, entry.result, configuration ?? {}, new Error(
                    "An independent Judge runtime configuration is required",
                ))
            }
            return
        }

        let client
        try {
            client = this.runtimeRegistry.createClient(runtimeDescriptor(configuration), {
                workspaceRoot: this.workspaceRoot,
                traceDirectory: this.traceDirectory,
                executionPolicy: {sandbox: "read-only", approvalPolicy: "never"},
            })
            this.activeClients.add(client)
            await client.start()
            if (typeof client.runEvaluationJudge !== "function") {
                throw new Error("The selected runtime does not support evaluation judging")
            }
        } catch (error) {
            if (client) await this.stopClient(client)
            for (const entry of completedResults) {
                this.failGrading(run, entry.result, configuration, error)
            }
            return
        }

        try {
            for (const entry of completedResults) {
                await this.gradeCompletedResult({
                    run,
                    result: entry.result,
                    output: entry.output,
                    configuration,
                    client,
                })
            }
        } finally {
            await this.stopClient(client)
        }
    }

    async gradeCompletedResult({run, result, output, configuration, client}) {
        const gradingStartedAt = new Date().toISOString()
        this.store.updateEvaluationResult(run.id, result.id, {
            gradingStatus: "running",
            gradingStartedAt,
            gradingCompletedAt: null,
            gradingError: null,
        })
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
            this.onChanged({
                runId: run.id,
                resultId: result.id,
                phase: "grading",
                gradingStatus: "completed",
                verdict: computedScore.overallVerdict,
            })
        } catch (error) {
            this.failGrading(run, result, configuration, error, lastOutput, {
                attempts,
                scoreContract: contract,
            })
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

    async stopAll() {
        await Promise.all([...this.activeClients].map((client) => this.stopClient(client)))
        await Promise.allSettled([...this.running.values()])
    }
}

module.exports = {EvaluationRunner}
