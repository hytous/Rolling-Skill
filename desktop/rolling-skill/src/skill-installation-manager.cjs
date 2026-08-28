const {join} = require("node:path")

const {
    buildSkillInstallationPrompt,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillExperimentRequest,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
} = require("./skill-installation-protocol.cjs")

const TERMINAL_STATUSES = new Set([
    "succeeded",
    "failed",
    "cancelled",
    "unverified",
    "needs_recovery",
])
const EXPERIMENT_OPERATIONS = new Set([
    "experiment_install",
    "experiment_restore",
    "experiment_remove",
    "experiment_inspect",
])
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

function readOnlyPermissionMode(providerId) {
    if (providerId === "codex" || providerId === "deepseek-harness") return "read-only"
    if (providerId === "codebuddy") return "plan"
    return null
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

    frozenExperimentRequest(input, target) {
        const runId = requiredText(input.run?.id, "Optimization Run id", 200)
        const epoch = Number(input.epoch)
        const baselineIdentity = input.run?.snapshot?.baseline ?? {}
        const skill = this.managedSkillStore.getSkill(
            requiredText(baselineIdentity.skillId, "Optimization Skill id", 200),
        )
        const repository = this.managedSkillStore.getRepository(skill.repositoryId)
        const baseline = this.managedSkillStore.getVersion(
            requiredText(baselineIdentity.versionId, "Optimization baseline version id", 200),
        )
        const candidate = this.managedSkillStore.getVersion(
            requiredText(input.candidateVersionId, "Optimization Candidate version id", 200),
        )
        const previousCandidate = input.previousCandidateVersionId
            ? this.managedSkillStore.getVersion(requiredText(
                input.previousCandidateVersionId,
                "Previous Optimization Candidate version id",
                200,
            ))
            : null
        return freezeSkillExperimentRequest({
            operation: input.operation,
            run: {...input.run, id: runId},
            epoch,
            repository: {
                ...repository,
                managedPath: this.managedSkillManager.repositoryPath(repository.id),
            },
            skill,
            baseline,
            candidate,
            previousCandidate,
            initial: input.operation === "experiment_inspect" ? null : target.initial,
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
                operation: "install",
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

    // This entry point is intentionally not exposed through Renderer IPC. OptimizationRunner
    // supplies the frozen Run and immutable Candidate IDs from the control plane.
    async startOptimizationExperiment(input = {}) {
        const operation = requiredText(input.operation, "Optimization experiment operation", 80)
        if (!EXPERIMENT_OPERATIONS.has(operation)) {
            throw new Error("Unsupported optimization experiment operation")
        }
        if (!Array.isArray(input.targets) || !input.targets.length || input.targets.length > 20) {
            throw new Error("Select between one and twenty Runtime experiment targets")
        }
        const seen = new Set()
        const prepared = input.targets.map((target) => {
            const descriptor = this.runtimeById(target.runtimeId)
            if (seen.has(descriptor.runtimeId)) throw new Error("Duplicate Runtime experiment target")
            seen.add(descriptor.runtimeId)
            const request = this.frozenExperimentRequest(input, target)
            const permissionMode = operation === "experiment_inspect"
                ? readOnlyPermissionMode(descriptor.providerId)
                : optionalText(target.permissionMode, "Installation permission", 100)
            if (operation === "experiment_inspect" && !permissionMode) {
                throw new Error("This Runtime has no supported read-only permission mode")
            }
            return {descriptor, permissionMode, request, target}
        })
        const jobs = prepared.map(({descriptor, permissionMode, request, target}) => {
            const job = this.store.createJob({
                operation,
                runtime: publicRuntime(descriptor),
                request,
                modelId: optionalText(target.modelId, "Installation model", 300),
                effort: optionalText(target.effort, "Installation effort", 100),
                permissionMode,
            })
            this.schedule(job)
            this.emit(job.id)
            return job
        })
        return jobs
    }

    async inspect(jobId) {
        const parent = this.store.getJob(requiredText(jobId, "Installation job id", 200))
        const descriptor = this.runtimeById(parent.runtime.runtimeId)
        const permissionMode = readOnlyPermissionMode(descriptor.providerId)
        if (!permissionMode) throw new Error("This Runtime has no supported read-only permission mode")
        const experiment = parent.request.purpose === "optimization-experiment"
        const request = experiment
            ? freezeSkillExperimentRecoveryInspectionRequest(parent.request)
            : parent.request
        const job = this.store.createJob({
            operation: experiment ? "experiment_inspect" : "inspect",
            parentJobId: parent.id,
            threadId: parent.threadId,
            runtime: publicRuntime(descriptor),
            request,
            modelId: parent.modelId,
            effort: parent.effort,
            permissionMode,
        })
        this.schedule(job)
        this.emit(job.id)
        return job
    }

    async send(jobId, text) {
        const job = this.store.getJob(requiredText(jobId, "Installation job id", 200))
        text = requiredText(text, "Installer message", 120_000)
        if (!TERMINAL_STATUSES.has(job.status) || !job.threadId) {
            throw new Error("The installer session is not ready for a follow-up")
        }
        if (this.operations.has(job.id) || job.conversationStatus === "running") {
            throw new Error("The installer session is already running")
        }
        const key = `${job.runtime.runtimeId}\0${job.request.source.skillId}`
        const previous = this.queueTails.get(key) ?? Promise.resolve()
        const operation = previous.then(
            () => this.executeConversation(job.id, text),
            () => this.executeConversation(job.id, text),
        )
        const tail = operation.catch(() => {}).finally(() => {
            if (this.queueTails.get(key) === tail) this.queueTails.delete(key)
        })
        this.queueTails.set(key, tail)
        const tracked = operation.finally(() => {
            if (this.operations.get(job.id) === tracked) this.operations.delete(job.id)
        })
        this.operations.set(job.id, tracked)
        return this.store.getJob(job.id)
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
        if (TERMINAL_STATUSES.has(job.status)) {
            if (job.conversationStatus !== "running" || typeof callback !== "function") return null
            return callback({
                ...request,
                jobId,
                runtime: job.runtime,
                threadId: request.sessionId ?? request.params?.sessionId ?? job.threadId,
            })
        }
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
            content: job.operation === "inspect" || job.operation === "experiment_inspect"
                ? `Inspect ${job.request.skillName} ${job.request.versionLabel} in ${job.runtime.displayName}`
                : `${job.operation.startsWith("experiment_") ? "Experiment" : "Install"} ${job.request.skillName} ${job.request.versionLabel} in ${job.runtime.displayName}`,
        })
        this.emit(jobId)
        job = this.store.getJob(jobId)
        const {client, permission} = this.clientFor(job, descriptor)
        const control = {
            client,
            threadId: null,
            turnId: null,
            cancelRequested: false,
            cancelWake: null,
            inspecting: false,
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
            const threadResponse = (job.operation === "inspect" || job.operation === "experiment_inspect") && job.threadId
                ? await client.resumeThread(job.threadId, profile)
                : await client.startThread(profile)
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
                operation: job.operation,
                requestedPermission: job.permissionMode,
                priorInstallation: this.store.installationMatrix(job.request.source.skillId)
                    .find((entry) => entry.runtimeId === job.runtime.runtimeId) ?? null,
            })
            const output = await this.runTurn({client, jobId, threadId: control.threadId, prompt, profile, control})
            if (control.cancelRequested || output.turnStatus === "interrupted" || output.turnStatus === "cancelled") {
                if (job.operation === "inspect" || job.operation === "experiment_inspect") {
                    return this.finish(jobId, "unverified", {
                        rawResult: output.response,
                        traceReference: traceReferenceFor(client),
                        error: {
                            code: "INSPECTION_CANCELLED",
                            message: "Read-only inspection was cancelled before verification completed",
                        },
                    })
                }
                return this.inspectAfterCancellation({
                    client,
                    descriptor,
                    jobId,
                    threadId: control.threadId,
                    profile,
                    control,
                })
            }
            this.store.updateJob(jobId, {status: "verifying", rawResult: output.response})
            this.emit(jobId)
            let parsed
            try {
                parsed = parseSkillInstallationResult(output.response, job.request)
                if (job.operation === "inspect" && parsed.operation !== "inspect") {
                    throw new Error("Inspection result must report an inspect operation")
                }
                if (job.operation === "experiment_inspect" && parsed.operation !== "experiment_inspect") {
                    throw new Error("Experiment inspection result must report an experiment_inspect operation")
                }
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
            if (cancelled && (job.operation === "inspect" || job.operation === "experiment_inspect")) {
                return this.finish(jobId, "unverified", {
                    traceReference: traceReferenceFor(client),
                    error: {
                        code: "INSPECTION_CANCELLED",
                        message: "Read-only inspection was cancelled before verification completed",
                    },
                })
            }
            if (cancelled && control.threadId && !control.inspecting) {
                return this.inspectAfterCancellation({
                    client,
                    descriptor,
                    jobId,
                    threadId: control.threadId,
                    profile: {
                        ...(job.modelId ? {model: job.modelId} : {}),
                        ...(job.effort ? {effort: job.effort} : {}),
                        ...permission,
                        threadSource: "subagent",
                        ephemeral: false,
                    },
                    control,
                })
            }
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

    async inspectAfterCancellation({client, descriptor, jobId, threadId, profile, control}) {
        control.inspecting = true
        control.turnId = null
        const current = this.store.getJob(jobId)
        if (TERMINAL_STATUSES.has(current.status)) return current
        if (current.status !== "verifying") {
            this.store.updateJob(jobId, {status: "verifying"})
        }
        this.store.appendMessage(jobId, {
            role: "user",
            content: "The installation was interrupted. Inspect the target read-only and report its current state.",
        })
        this.emit(jobId)
        const permissionMode = readOnlyPermissionMode(descriptor.providerId)
        if (!permissionMode) {
            return this.finish(jobId, "unverified", {
                traceReference: traceReferenceFor(client),
                error: {
                    code: "POST_CANCEL_INSPECTION_UNSUPPORTED",
                    message: "This Runtime has no supported read-only permission mode",
                },
            })
        }
        let inspectPermission
        try {
            inspectPermission = this.resolvePermission(descriptor.providerId, permissionMode) ?? {}
        } catch (error) {
            return this.finish(jobId, "unverified", {
                traceReference: traceReferenceFor(client),
                error: errorRecord(error, "POST_CANCEL_INSPECTION_PERMISSION_FAILED"),
            })
        }
        const originalRequest = this.store.getJob(jobId).request
        const experiment = originalRequest.purpose === "optimization-experiment"
        const request = experiment
            ? freezeSkillExperimentRecoveryInspectionRequest(originalRequest)
            : originalRequest
        const prompt = buildSkillInstallationPrompt(request, {
            operation: experiment ? "experiment_inspect" : "inspect",
            requestedPermission: permissionMode,
            priorInstallation: this.store.installationMatrix(request.source.skillId)
                .find((entry) => entry.runtimeId === descriptor.runtimeId) ?? null,
        })
        try {
            const output = await this.runTurn({
                client,
                jobId,
                threadId,
                prompt,
                profile: {...profile, ...inspectPermission},
                control,
            })
            if (output.turnStatus === "interrupted" || output.turnStatus === "cancelled") {
                throw Object.assign(new Error("Read-only inspection was interrupted"), {
                    code: "POST_CANCEL_INSPECTION_INTERRUPTED",
                })
            }
            const parsed = parseSkillInstallationResult(output.response, request)
            const expectedOperation = experiment ? "experiment_inspect" : "inspect"
            if (parsed.operation !== expectedOperation) {
                throw new Error(`Post-cancellation result must report an ${expectedOperation} operation`)
            }
            return this.finish(jobId, "cancelled", {
                parsedResult: parsed,
                rawResult: output.response,
                traceReference: traceReferenceFor(client),
                error: {
                    code: "INSTALLATION_CANCELLED",
                    message: "Installation cancelled by user; the target was inspected read-only",
                },
            })
        } catch (error) {
            return this.finish(jobId, "unverified", {
                traceReference: traceReferenceFor(client),
                error: errorRecord(error, "POST_CANCEL_INSPECTION_FAILED"),
            })
        }
    }

    async executeConversation(jobId, text) {
        const job = this.store.getJob(jobId)
        const descriptor = this.runtimeById(job.runtime.runtimeId)
        this.store.updateJob(jobId, {
            conversationStatus: "running",
            conversationError: null,
        })
        this.store.appendMessage(jobId, {role: "user", content: text})
        this.emit(jobId)
        const {client, permission} = this.clientFor(job, descriptor)
        const control = {
            client,
            threadId: job.threadId,
            turnId: null,
            cancelRequested: false,
            cancelWake: null,
            inspecting: false,
            conversation: true,
        }
        this.controls.set(jobId, control)
        try {
            await client.start()
            const profile = {
                ...(job.modelId ? {model: job.modelId} : {}),
                ...(job.effort ? {effort: job.effort} : {}),
                ...permission,
                threadSource: "subagent",
                ephemeral: false,
            }
            await client.resumeThread(job.threadId, profile)
            const output = await this.runTurn({
                client,
                jobId,
                threadId: job.threadId,
                prompt: text,
                profile,
                control,
            })
            this.store.updateJob(jobId, {
                conversationStatus: "idle",
                conversationError: output.turnStatus === "interrupted" || output.turnStatus === "cancelled"
                    ? {code: "INSTALLER_CONVERSATION_CANCELLED", message: "Installer follow-up cancelled"}
                    : null,
            })
            return this.emit(jobId)
        } catch (error) {
            this.store.updateJob(jobId, {
                conversationStatus: "failed",
                conversationError: errorRecord(error, "INSTALLER_CONVERSATION_FAILED"),
            })
            return this.emit(jobId)
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
                if (control.cancelWake === cancelWake) control.cancelWake = null
                client.off("notification", onNotification)
                client.off("state", onState)
                client.off("runtimeError", onRuntimeError)
                operation(value)
            }
            const cancelWake = () => finish(resolve, {
                response: assistantTexts.join("\n\n"),
                turnStatus: "interrupted",
            })
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
            control.cancelWake = cancelWake
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
        const control = this.controls.get(job.id)
        if (TERMINAL_STATUSES.has(job.status)) {
            if (!control) return job
            if (control.cancelRequested) return this.store.getJob(job.id)
            control.cancelRequested = true
            if (control.threadId && control.turnId) {
                await control.client.interruptTurn(control.threadId, control.turnId)
            }
            control.cancelWake?.()
            return this.store.getJob(job.id)
        }
        if (!control) {
            const cancelled = this.store.completeJob(job.id, {
                status: "cancelled",
                error: {code: "INSTALLATION_CANCELLED", message: "Installation cancelled before it started"},
            })
            this.emit(job.id)
            return cancelled
        }
        if (control.cancelRequested) return this.store.getJob(job.id)
        control.cancelRequested = true
        if (job.status !== "verifying") {
            this.store.updateJob(job.id, {status: "verifying"})
            this.emit(job.id)
        }
        if (control.threadId && control.turnId) {
            await control.client.interruptTurn(control.threadId, control.turnId)
        }
        control.cancelWake?.()
        return this.store.getJob(job.id)
    }

    overview(skillId = null) {
        const jobs = this.store.listJobs(skillId ? {skillId} : {})
        const skillIds = skillId
            ? [skillId]
            : [...new Set(jobs
                .filter((job) => job.request?.purpose === "managed-installation")
                .map((job) => job.request?.source?.skillId)
                .filter(Boolean))]
        return {
            jobs,
            matrix: skillIds.flatMap((id) => this.store.installationMatrix(id)),
        }
    }

    async stopAll() {
        await Promise.allSettled([...this.controls.keys()].map((jobId) => this.cancel(jobId)))
        await Promise.allSettled([...this.operations.values()])
    }
}

module.exports = {SkillInstallationManager}
