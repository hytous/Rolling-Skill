class EvaluationRunner {
    constructor({
        store,
        runtimeRegistry,
        workspaceRoot,
        traceDirectory,
        getExecutionPolicy = () => null,
        onChanged = () => {},
    }) {
        this.store = store
        this.runtimeRegistry = runtimeRegistry
        this.workspaceRoot = workspaceRoot
        this.traceDirectory = traceDirectory
        this.getExecutionPolicy = getExecutionPolicy
        this.onChanged = onChanged
        this.running = new Map()
        this.activeClients = new Set()
        this.clientStopOperations = new WeakMap()
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
        const status = failedCount === 0 ? "completed" : completedCount === 0 ? "failed" : "partial"
        const completedAt = new Date().toISOString()
        this.store.updateEvaluationRun(run.id, {status, completedAt})
        this.onChanged({runId: run.id, status})
        return {id: run.id, status, startedAt, completedAt, completedCount, failedCount}
    }

    async runRuntimeQueue(run, configuration) {
        const descriptor = {
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
        const results = run.results.filter(
            (entry) =>
                (entry.runtimeId ?? entry.runtimeConfiguration?.runtimeId) ===
                configuration.runtimeId,
        )
        const client = this.runtimeRegistry.createClient(descriptor, {
            workspaceRoot: this.workspaceRoot,
            traceDirectory: this.traceDirectory,
            executionPolicy: this.getExecutionPolicy(),
        })
        this.activeClients.add(client)
        let completed = 0
        let failed = 0
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
                    const output = await client.runEvaluationCase({
                        question: result.caseSnapshot.question,
                        activationMode: run.activationMode,
                        skillReference: run.skillReference,
                        modelId: configuration.modelId,
                        effort: configuration.effort,
                    })
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "completed",
                        durationMs: output.durationMs,
                        response: output.response ?? "",
                        threadId: output.threadId ?? null,
                        turnId: output.turnId ?? null,
                        traceReference: output.traceReference ?? null,
                        completedAt: new Date().toISOString(),
                    })
                    completed += 1
                    this.onChanged({runId: run.id, resultId: result.id, status: "completed"})
                } catch (error) {
                    this.store.updateEvaluationResult(run.id, result.id, {
                        status: "failed",
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
                    error: error?.message ?? String(error),
                    completedAt: new Date().toISOString(),
                })
                failed += 1
                this.onChanged({runId: run.id, resultId: result.id, status: "failed"})
            }
        } finally {
            await this.stopClient(client)
        }
        return {completed, failed}
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
