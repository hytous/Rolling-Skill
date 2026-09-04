const {createHash, randomUUID} = require("node:crypto")
const {join} = require("node:path")

const {
    buildSkillInstallationPrompt,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillExperimentRequest,
    freezeSkillInstallationRequest,
    validateSkillInstallationRegistration,
} = require("./skill-installation-protocol.cjs")
const {SkillInstallationToolTransport} = require("./skill-installation-tool-transport.cjs")

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
    const name = item.title ?? item.name ?? item.tool ?? item.toolName ?? item.server
    if (typeof name === "string" && name.trim()) activity.name = name.slice(0, 1_024)
    return activity
}

function traceReferenceFor(client) {
    return client?.recorder?.latestReference ?? client?.state?.()?.traceReference ?? null
}

function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function clone(value, label = "Value") {
    try {
        const serialized = JSON.stringify(value)
        if (serialized === undefined) throw new Error()
        return JSON.parse(serialized)
    } catch {
        throw new TypeError(`${label} must be JSON data`)
    }
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function registrationFingerprint(parsedResult) {
    return `sha256:${createHash("sha256").update(canonicalJson(parsedResult), "utf8").digest("hex")}`
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
        this.controlPlane = options.controlPlane
        this.capabilities = options.capabilities
        this.controlSocketPath = options.controlSocketPath
        this.installationToolPath = options.installationToolPath
        this.transportSupport = options.transportSupport ?? (() => ({}))
        this.transportFactory = options.transportFactory ?? ((input) => new SkillInstallationToolTransport({
            executablePath: this.installationToolPath,
            childEnvironment: input.childEnvironment,
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
        if (
            !this.controlPlane ||
            typeof this.controlPlane.invoke !== "function" ||
            typeof this.controlPlane.registerInstallationExecutor !== "function"
        ) throw new TypeError("Skill installation manager requires the shared ControlPlane")
        if (
            !this.capabilities ||
            typeof this.capabilities.issue !== "function" ||
            typeof this.capabilities.revoke !== "function"
        ) throw new TypeError("Skill installation manager requires capability issue and revoke access")
        if (typeof this.controlSocketPath !== "string" || !this.controlSocketPath) {
            throw new TypeError("Skill installation control socket is required")
        }
        if (typeof this.transportSupport !== "function") {
            throw new TypeError("Skill installation transport support resolver is invalid")
        }
        if (typeof this.transportFactory !== "function") {
            throw new TypeError("Skill installation transport factory is invalid")
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

    async registrationControl(job, descriptor) {
        const sessionId = `installation-${randomUUID()}`
        const grant = await this.capabilities.issue({
            sessionId,
            actions: ["installations.register"],
            scopes: {
                skillIds: [job.request.source.skillId],
                runtimeIds: [job.runtime.runtimeId],
                repositoryIds: [job.request.source.repositoryId],
            },
            expiresInMs: Math.min(24 * 60 * 60 * 1_000, this.timeoutMs + 60_000),
        })
        if (
            !plainObject(grant) ||
            typeof grant.id !== "string" || !grant.id ||
            typeof grant.token !== "string" || !grant.token ||
            grant.sessionId !== sessionId ||
            !Array.isArray(grant.actions) || !grant.actions.includes("installations.register")
        ) {
            if (typeof grant?.id === "string") {
                await Promise.resolve(this.capabilities.revoke(grant.id)).catch(() => {})
            }
            throw new Error("Skill installation capability issuer returned an invalid grant")
        }
        const childEnvironment = {
            ROLLING_SKILL_CONTROL_SOCKET: this.controlSocketPath,
            ROLLING_SKILL_CONTROL_TOKEN: grant.token,
            ROLLING_SKILL_OPERATOR_SESSION: sessionId,
        }
        const transport = this.transportFactory({descriptor, runtime: descriptor, childEnvironment})
        if (!transport || typeof transport.freeze !== "function") {
            await Promise.resolve(this.capabilities.revoke(grant.id)).catch(() => {})
            throw new Error("Skill installation Tool transport factory returned an invalid transport")
        }
        try {
            const support = clone(
                await this.transportSupport(descriptor),
                "Skill installation transport support",
            )
            const preflight = typeof transport.preflight === "function"
                ? transport.preflight(descriptor, support)
                : null
            if (preflight && preflight.ready !== true) {
                throw new Error(preflight.reason ?? "Skill installation Tool transport is unavailable")
            }
            const selection = transport.freeze(descriptor, support)
            if (!plainObject(selection) || selection.ready !== true || ![
                "codex-dynamic",
                "acp-mcp",
                "dsh-mcp",
                "cli",
            ].includes(selection.kind)) {
                throw new Error(selection?.reason ?? "Skill installation Tool transport is unavailable")
            }
            return {
                grant,
                sessionId,
                childEnvironment,
                transport,
                selection,
                registrationRequest: job.request,
                registrationOperation: job.operation,
                acceptingRegistrations: true,
                executorLease: null,
            }
        } catch (error) {
            await Promise.resolve(this.capabilities.revoke(grant.id)).catch(() => {})
            throw error
        }
    }

    profileWithRegistration(profile, registration) {
        const result = {...profile}
        if (registration.selection.kind === "codex-dynamic") {
            result.dynamicTools = registration.transport.dynamicTools()
        }
        if (registration.selection.kind === "acp-mcp") {
            result.mcpServers = registration.transport.mcpServers()
        }
        return result
    }

    registerExecutor(jobId, control) {
        const registration = control.registration
        registration.executorLease = this.controlPlane.registerInstallationExecutor({
            sessionId: registration.sessionId,
            capabilityId: registration.grant.id,
            assertLive: () => (
                this.controls.get(jobId) === control && registration.acceptingRegistrations
            ),
            contextSnapshot: () => Object.freeze({
                workspaceRoot: this.workspaceRoot,
                runtimeId: control.descriptor.runtimeId,
            }),
            execute: (request) => this.acceptRegistration(jobId, control, request),
        })
    }

    acceptRegistration(jobId, control, request = {}) {
        const registration = control.registration
        if (
            this.controls.get(jobId) !== control ||
            registration.acceptingRegistrations !== true ||
            request.method !== "installations.register"
        ) throw new Error("Skill installation registration is unavailable")
        const parsedResult = validateSkillInstallationRegistration(
            clone(request.input, "Installation registration evidence"),
            registration.registrationRequest,
            {
                operation: registration.registrationOperation,
                requestedPermission: this.store.getJob(jobId).permissionMode,
                effectivePermission: this.store.getJob(jobId).effectivePermissionMode,
            },
        )
        const accepted = this.store.acceptRegistration(jobId, {
            invocationFingerprint: registrationFingerprint(parsedResult),
            parsedResult,
        })
        this.emit(jobId)
        return accepted
    }

    async requestRegistrationTool(jobId, control, request = {}) {
        if (!plainObject(request) || !plainObject(request.params)) {
            throw new TypeError("Skill installation Tool request is invalid")
        }
        if (
            this.controls.get(jobId) !== control ||
            control.registration.acceptingRegistrations !== true
        ) throw new Error("Skill installation Tool call is outside an active Job")
        if (request.threadId !== control.threadId) {
            throw new Error("Skill installation Tool call belongs to another thread")
        }
        if (control.turnId && request.turnId !== control.turnId) {
            throw new Error("Skill installation Tool call belongs to another turn")
        }
        return this.controlPlane.invoke({
            token: control.registration.grant.token,
            sessionId: control.registration.sessionId,
            method: requiredText(request.method, "Skill installation Tool method", 300),
            params: clone(request.params, "Skill installation Tool parameters"),
        })
    }

    clientFor(job, descriptor, control) {
        const permission = this.resolvePermission(descriptor.providerId, job.permissionMode) ?? {}
        let client = null
        const registration = control?.registration ?? null
        client = this.runtimeRegistry.createClient(descriptor, {
            workspaceRoot: this.workspaceRoot,
            traceDirectory: join(this.traceDirectory, job.id),
            executionPolicy: permission,
            nonInteractive: false,
            installationRequest: job.request,
            ...(registration ? {
                childEnvironment: registration.transport.childEnvironment(),
                ...(registration.selection.kind === "dsh-mcp"
                    ? {mcpServers: registration.transport.mcpServers()}
                    : {}),
                requestTool: (request) => this.requestRegistrationTool(job.id, control, request),
            } : {}),
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
        const control = {
            client: null,
            descriptor,
            registration: null,
            threadId: null,
            turnId: null,
            cancelRequested: false,
            cancelWake: null,
            inspecting: false,
        }
        this.controls.set(jobId, control)
        let client = null
        let permission = {}
        try {
            control.registration = await this.registrationControl(job, descriptor)
            if (control.cancelRequested) throw Object.assign(new Error("Installation cancelled"), {
                code: "INSTALLATION_CANCELLED",
            })
            ;({client, permission} = this.clientFor(job, descriptor, control))
            control.client = client
            this.registerExecutor(jobId, control)
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
            const registeredProfile = this.profileWithRegistration(profile, control.registration)
            const threadResponse = (job.operation === "inspect" || job.operation === "experiment_inspect") && job.threadId
                ? await client.resumeThread(job.threadId, registeredProfile)
                : await client.startThread(registeredProfile)
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
                registrationInstruction: control.registration.transport.registrationInstruction(),
                priorInstallation: this.store.installationMatrix(job.request.source.skillId)
                    .find((entry) => entry.runtimeId === job.runtime.runtimeId) ?? null,
            })
            const output = await this.runTurn({
                client,
                jobId,
                threadId: control.threadId,
                prompt,
                profile: registeredProfile,
                control,
            })
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
            const registered = this.store.getJob(jobId)
            if (registered.registration?.state !== "accepted") {
                return this.finish(jobId, "unverified", {
                    rawResult: output.response,
                    traceReference: traceReferenceFor(client),
                    error: {
                        code: "INSTALLATION_REGISTRATION_MISSING",
                        message: "安装 Agent 未登记执行结果。",
                    },
                })
            }
            return this.finish(jobId, registered.parsedResult.status, {
                parsedResult: registered.parsedResult,
                rawResult: output.response,
                traceReference: traceReferenceFor(client),
                error: registered.parsedResult.error,
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
            if (
                cancelled && client && control.registration &&
                control.threadId && !control.inspecting
            ) {
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
            if (control.registration) {
                control.registration.acceptingRegistrations = false
                try {
                    control.registration.executorLease?.unregister()
                } catch {}
                await Promise.resolve(
                    this.capabilities.revoke(control.registration.grant.id),
                ).catch(() => {})
            }
            this.controls.delete(jobId)
            await client?.stop?.().catch(() => {})
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
        const expectedOperation = experiment ? "experiment_inspect" : "inspect"
        const alreadyRegistered = this.store.getJob(jobId)
        if (alreadyRegistered.registration?.state === "accepted") {
            return this.finish(jobId, "cancelled", {
                parsedResult: alreadyRegistered.parsedResult,
                rawResult: alreadyRegistered.rawResult,
                traceReference: traceReferenceFor(client),
                error: {
                    code: "INSTALLATION_CANCELLED",
                    message: "Installation cancelled after verified evidence was registered",
                },
            })
        }
        control.registration.registrationRequest = request
        control.registration.registrationOperation = expectedOperation
        const prompt = buildSkillInstallationPrompt(request, {
            operation: expectedOperation,
            requestedPermission: permissionMode,
            registrationInstruction: control.registration.transport.registrationInstruction(),
            priorInstallation: this.store.installationMatrix(request.source.skillId)
                .find((entry) => entry.runtimeId === descriptor.runtimeId) ?? null,
        })
        try {
            const inspectionProfile = this.profileWithRegistration(
                {...profile, ...inspectPermission},
                control.registration,
            )
            const output = await this.runTurn({
                client,
                jobId,
                threadId,
                prompt,
                profile: inspectionProfile,
                control,
            })
            if (output.turnStatus === "interrupted" || output.turnStatus === "cancelled") {
                throw Object.assign(new Error("Read-only inspection was interrupted"), {
                    code: "POST_CANCEL_INSPECTION_INTERRUPTED",
                })
            }
            const registered = this.store.getJob(jobId)
            if (registered.registration?.state !== "accepted") {
                throw Object.assign(new Error("安装 Agent 未登记只读检查结果。"), {
                    code: "INSTALLATION_REGISTRATION_MISSING",
                })
            }
            if (registered.parsedResult.operation !== expectedOperation) {
                throw new Error(`Post-cancellation result must report an ${expectedOperation} operation`)
            }
            return this.finish(jobId, "cancelled", {
                parsedResult: registered.parsedResult,
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

    finish(jobId, status, input) {
        const completed = this.store.completeJob(jobId, {status, ...input})
        this.emit(jobId)
        return completed
    }

    runTurn({client, jobId, threadId, prompt, profile, control, timeoutMs = this.timeoutMs}) {
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
            }, timeoutMs)
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
            const cancelWake = control.cancelWake
            if (control.threadId && control.turnId) {
                await control.client.interruptTurn(control.threadId, control.turnId)
            }
            cancelWake?.()
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
        const cancelWake = control.cancelWake
        if (job.status !== "verifying") {
            this.store.updateJob(job.id, {status: "verifying"})
            this.emit(job.id)
        }
        if (control.threadId && control.turnId) {
            await control.client.interruptTurn(control.threadId, control.turnId)
        }
        cancelWake?.()
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

    hiddenThreadIds() {
        return new Set(this.store.listJobs().map((job) => job.threadId).filter(Boolean))
    }

    async stopAll() {
        await Promise.allSettled([...this.controls.keys()].map((jobId) => this.cancel(jobId)))
        await Promise.allSettled([...this.operations.values()])
    }
}

module.exports = {SkillInstallationManager}
