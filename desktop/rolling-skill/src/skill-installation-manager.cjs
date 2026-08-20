const {join} = require("node:path")

const {
    buildSkillInstallationPrompt,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
} = require("./skill-installation-protocol.cjs")

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "unverified"])
const ACTIVITY_TYPES = new Set([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "toolCall",
    "webSearch",
])

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function optionalText(value, label, maxLength = 4_096) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maxLength)
}

function errorRecord(error, fallbackCode = "INSTALLATION_FAILED") {
    return {
        code: optionalText(error?.code, "Installation error code", 200) ?? fallbackCode,
        message: optionalText(error?.message, "Installation error message", 16_384) ?? String(error),
    }
}

function publicRuntime(descriptor = {}) {
    return {
        runtimeId: requiredText(descriptor.runtimeId, "Runtime id", 300),
        providerId: requiredText(descriptor.providerId, "Provider id", 100),
        displayName: requiredText(descriptor.displayName ?? descriptor.providerId, "Runtime name", 300),
        version: optionalText(descriptor.version, "Runtime version", 200),
        executablePath: optionalText(descriptor.executablePath, "Runtime executable", 8_192),
    }
}

function activityFromItem(item = {}) {
    const activity = {
        itemId: optionalText(item.id, "Activity item id", 300),
        type: requiredText(item.type, "Activity type", 100),
        status: optionalText(item.status, "Activity status", 100),
    }
    const command = item.command ?? item.rawInput?.command ?? item.input?.command
    if (typeof command === "string" && command.trim()) activity.command = command.slice(0, 32_768)
    else if (Array.isArray(command)) activity.command = command.map(String).join(" ").slice(0, 32_768)
    const name = item.name ?? item.toolName ?? item.server
    if (typeof name === "string" && name.trim()) activity.name = name.slice(0, 1_024)
    return activity
}

function traceReferenceFor(client) {
    return client?.recorder?.latestReference ?? client?.state?.()?.traceReference ?? null
}

class SkillInstallationManager {
    constructor(options = {}) {
        this.store = options.store
        this.managedSkillStore = options.managedSkillStore
        this.managedSkillManager = options.managedSkillManager
        this.runtimeRegistry = options.runtimeRegistry
        this.getRuntimes = options.getRuntimes ?? (() => [])
        this.workspaceRoot = options.workspaceRoot
        this.traceDirectory = options.traceDirectory
        this.requestPermission = options.requestPermission ?? null
        this.requestQuestion = options.requestQuestion ?? null
        this.resolvePermission = options.resolvePermission ?? ((_providerId, mode) => ({
            permissionMode: mode,
        }))
        this.onChanged = options.onChanged ?? (() => {})
        this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1_000
        this.queueTails = new Map()
        this.operations = new Map()
        this.controls = new Map()
        if (!this.store || !this.managedSkillStore || !this.managedSkillManager) {
            throw new Error("Skill installation stores and manager are required")
        }
        if (!this.runtimeRegistry || typeof this.runtimeRegistry.createClient !== "function") {
            throw new Error("Runtime registry is required")
        }
    }

    emit(jobId) {
        const job = this.store.getJob(jobId)
        this.onChanged(job)
        return job
    }

    frozenRequest(skillId, versionId) {
        const skill = this.managedSkillStore.getSkill(requiredText(skillId, "Skill id", 200))
        const version = this.managedSkillStore.getVersion(requiredText(versionId, "Version id", 200))
        if (version.state !== "released") throw new Error("Only a Released Skill version can be installed")
        if (version.skillId !== skill.id || version.repositoryId !== skill.repositoryId) {
            throw new Error("Released version does not belong to the selected Skill")
        }
        const repository = this.managedSkillStore.getRepository(skill.repositoryId)
        return freezeSkillInstallationRequest({
            repository: {
                ...repository,
                managedPath: this.managedSkillManager.repositoryPath(repository.id),
            },
            skill,
            version,
        })
    }

    runtimeById(runtimeId) {
        runtimeId = requiredText(runtimeId, "Runtime id", 300)
        const descriptor = this.getRuntimes().find((entry) => entry.runtimeId === runtimeId)
        if (!descriptor) throw new Error("The selected local Runtime is no longer available")
        return descriptor
    }

    async start(input = {}) {
        const request = this.frozenRequest(input.skillId, input.versionId)
        if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 20) {
            throw new Error("Select between one and twenty Runtime installation targets")
        }
        const seen = new Set()
        const jobs = []
        for (const target of input.targets) {
            const descriptor = this.runtimeById(target.runtimeId)
            if (seen.has(descriptor.runtimeId)) throw new Error("Duplicate Runtime installation target")
            seen.add(descriptor.runtimeId)
            const job = this.store.createJob({
                runtime: publicRuntime(descriptor),
                request,
                modelId: optionalText(target.modelId, "Installation model", 300),
                effort: optionalText(target.effort, "Installation effort", 100),
                permissionMode: optionalText(target.permissionMode, "Installation permission", 100),
            })
            jobs.push(job)
            this.schedule(job)
            this.emit(job.id)
        }
        return jobs
    }

    schedule(job) {
        const key = `${job.runtime.runtimeId}\0${job.request.source.skillId}`
        const previous = this.queueTails.get(key) ?? Promise.resolve()
        const operation = previous.then(() => this.execute(job.id), () => this.execute(job.id))
        const tail = operation.catch(() => {}).finally(() => {
            if (this.queueTails.get(key) === tail) this.queueTails.delete(key)
        })
        this.queueTails.set(key, tail)
        this.operations.set(job.id, operation.finally(() => {
            this.operations.delete(job.id)
        }))
    }

    isRunning(jobId) {
        return this.controls.has(jobId)
    }

    wait(jobId) {
        requiredText(jobId, "Installation job id", 200)
        return this.operations.get(jobId) ?? Promise.resolve(this.store.getJob(jobId))
    }

    async interaction(jobId, status, callback, request) {
        const job = this.store.getJob(jobId)
        if (TERMINAL_STATUSES.has(job.status)) return null
        this.store.updateJob(jobId, {status})
        this.emit(jobId)
        try {
            if (typeof callback !== "function") return null
            return await callback({
                ...request,
                jobId,
                runtime: job.runtime,
                threadId: request.sessionId ?? request.params?.sessionId ?? job.threadId,
            })
        } finally {
            const current = this.store.getJob(jobId)
            if (!TERMINAL_STATUSES.has(current.status) && current.status === status) {
                this.store.updateJob(jobId, {status: "running"})
                this.emit(jobId)
            }
        }
    }

    clientFor(job, descriptor) {
        const permission = this.resolvePermission(descriptor.providerId, job.permissionMode) ?? {}
        let client = null
        client = this.runtimeRegistry.createClient(descriptor, {
            workspaceRoot: this.workspaceRoot,
            traceDirectory: join(this.traceDirectory, job.id),
            executionPolicy: permission,
            nonInteractive: false,
            installationRequest: job.request,
            requestPermission: (request) => this.interaction(
                job.id,
                "awaiting_permission",
                this.requestPermission,
                {...request, sourceClient: client},
            ),
            requestQuestion: (request) => this.interaction(
                job.id,
                "awaiting_confirmation",
                this.requestQuestion,
                {...request, sourceClient: client},
            ),
        })
        return {client, permission}
    }

    async execute(jobId) {
        let job = this.store.getJob(jobId)
        if (job.status !== "queued") return job
        const descriptor = this.runtimeById(job.runtime.runtimeId)
        this.store.updateJob(jobId, {status: "running"})
        this.store.appendMessage(jobId, {
            role: "user",
            content: `Install ${job.request.skillName} ${job.request.versionLabel} in ${job.runtime.displayName}`,
        })
        this.emit(jobId)
        job = this.store.getJob(jobId)
        const {client, permission} = this.clientFor(job, descriptor)
        const control = {
            client,
            threadId: null,
            turnId: null,
            cancelRequested: false,
        }
        this.controls.set(jobId, control)
        try {
            await client.start()
            if (control.cancelRequested) throw Object.assign(new Error("Installation cancelled"), {
                code: "INSTALLATION_CANCELLED",
            })
            const profile = {
                ...(job.modelId ? {model: job.modelId} : {}),
                ...(job.effort ? {effort: job.effort} : {}),
                ...permission,
                threadSource: "subagent",
                ephemeral: false,
            }
            const threadResponse = await client.startThread(profile)
            control.threadId = requiredText(threadResponse?.thread?.id, "Installer thread id", 300)
            this.store.updateJob(jobId, {
                threadId: control.threadId,
                effectiveModelId: threadResponse?.thread?.model ?? threadResponse?.model ?? job.modelId,
                effectiveEffort:
                    threadResponse?.thread?.effort ?? threadResponse?.reasoningEffort ?? job.effort,
                effectivePermissionMode:
                    threadResponse?.thread?.permissionMode ?? permission.permissionMode ?? job.permissionMode,
            })
            this.emit(jobId)
            const prompt = buildSkillInstallationPrompt(job.request, {
                operation: "install",
                requestedPermission: job.permissionMode,
                priorInstallation: this.store.installationMatrix(job.request.source.skillId)
                    .find((entry) => entry.runtimeId === job.runtime.runtimeId) ?? null,
            })
            const output = await this.runTurn({client, jobId, threadId: control.threadId, prompt, profile, control})
            if (control.cancelRequested || output.turnStatus === "interrupted" || output.turnStatus === "cancelled") {
                return this.finish(jobId, "cancelled", {
                    rawResult: output.response,
                    traceReference: traceReferenceFor(client),
                    error: {code: "INSTALLATION_CANCELLED", message: "Installation cancelled by user"},
                })
            }
            this.store.updateJob(jobId, {status: "verifying", rawResult: output.response})
            this.emit(jobId)
            let parsed
            try {
                parsed = parseSkillInstallationResult(output.response, job.request)
            } catch (error) {
                return this.finish(jobId, "unverified", {
                    rawResult: output.response,
                    traceReference: traceReferenceFor(client),
                    error: errorRecord(error, "INSTALLATION_RESULT_INVALID"),
                })
            }
            const status = parsed.status
            return this.finish(jobId, status, {
                parsedResult: parsed,
                rawResult: output.response,
                traceReference: traceReferenceFor(client),
                error: parsed.error,
            })
        } catch (error) {
            const current = this.store.getJob(jobId)
            if (TERMINAL_STATUSES.has(current.status)) return current
            const cancelled = control.cancelRequested || error?.code === "INSTALLATION_CANCELLED"
            return this.finish(jobId, cancelled ? "cancelled" : "failed", {
                traceReference: traceReferenceFor(client),
                error: cancelled
                    ? {code: "INSTALLATION_CANCELLED", message: "Installation cancelled by user"}
                    : errorRecord(error),
            })
        } finally {
            this.controls.delete(jobId)
            await client.stop?.().catch(() => {})
        }
    }

    finish(jobId, status, input) {
        const completed = this.store.completeJob(jobId, {status, ...input})
        this.emit(jobId)
        return completed
    }

    runTurn({client, jobId, threadId, prompt, profile, control}) {
        return new Promise((resolve, reject) => {
            const assistantTexts = []
            const seenItems = new Set()
            let settled = false
            let timer = null
            const finish = (operation, value) => {
                if (settled) return
                settled = true
                clearTimeout(timer)
                client.off("notification", onNotification)
                client.off("state", onState)
                client.off("runtimeError", onRuntimeError)
                operation(value)
            }
            const onRuntimeError = (error) => finish(reject, error)
            const onState = (state) => {
                if (state?.status === "stopped" || state?.status === "error") {
                    finish(reject, new Error("Installation Runtime stopped before the turn completed"))
                }
            }
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if ((params.threadId ?? params.thread?.id) !== threadId) return
                if (message.method === "turn/started") {
                    const turnId = params.turn?.id ?? params.turnId ?? null
                    if (turnId) {
                        control.turnId = turnId
                        this.store.updateJob(jobId, {turnId})
                        this.emit(jobId)
                    }
                    return
                }
                if (message.method === "item/completed") {
                    const item = params.item ?? {}
                    const itemId = item.id ?? `${item.type}:${seenItems.size}`
                    if (seenItems.has(itemId)) return
                    seenItems.add(itemId)
                    if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
                        assistantTexts.push(item.text)
                        this.store.appendMessage(jobId, {
                            role: "assistant",
                            itemId,
                            content: item.text,
                        })
                        this.emit(jobId)
                    } else if (ACTIVITY_TYPES.has(item.type)) {
                        this.store.appendActivity(jobId, activityFromItem(item))
                        this.emit(jobId)
                    }
                    return
                }
                if (message.method === "turn/completed") {
                    const turn = params.turn ?? {}
                    if (control.turnId && turn.id && turn.id !== control.turnId) return
                    finish(resolve, {
                        response: assistantTexts.join("\n\n"),
                        turnStatus: turn.status ?? "completed",
                    })
                } else if (message.method === "error" && !params.willRetry) {
                    finish(reject, new Error(params.error?.message ?? params.message ?? "Installation turn failed"))
                }
            }
            client.on("notification", onNotification)
            client.on("state", onState)
            client.on("runtimeError", onRuntimeError)
            timer = setTimeout(() => {
                if (control.turnId) void client.interruptTurn?.(threadId, control.turnId).catch(() => {})
                finish(reject, Object.assign(new Error("Installation turn timed out"), {
                    code: "INSTALLATION_TURN_TIMEOUT",
                }))
            }, this.timeoutMs)
            void client.startTurn(threadId, prompt, profile).then((response) => {
                const turnId = response?.turn?.id ?? null
                if (turnId && !control.turnId) {
                    control.turnId = turnId
                    this.store.updateJob(jobId, {turnId})
                    this.emit(jobId)
                }
            }, (error) => finish(reject, error))
        })
    }

    async cancel(jobId) {
        const job = this.store.getJob(requiredText(jobId, "Installation job id", 200))
        if (TERMINAL_STATUSES.has(job.status)) return job
        const control = this.controls.get(job.id)
        if (!control) {
            const cancelled = this.store.completeJob(job.id, {
                status: "cancelled",
                error: {code: "INSTALLATION_CANCELLED", message: "Installation cancelled before it started"},
            })
            this.emit(job.id)
            return cancelled
        }
        control.cancelRequested = true
        if (control.threadId && control.turnId) {
            await control.client.interruptTurn(control.threadId, control.turnId)
        }
        return this.store.getJob(job.id)
    }

    overview(skillId = null) {
        return {
            jobs: this.store.listJobs(skillId ? {skillId} : {}),
            matrix: skillId ? this.store.installationMatrix(skillId) : [],
        }
    }

    async stopAll() {
        await Promise.allSettled([...this.controls.keys()].map((jobId) => this.cancel(jobId)))
        await Promise.allSettled([...this.operations.values()])
    }
}

module.exports = {SkillInstallationManager}
