const {createHash, randomUUID} = require("node:crypto")
const {isAbsolute, resolve} = require("node:path")

const {
    OPERATOR_PROTOCOL,
    buildOperatorInitialInput,
    protocolSnapshot,
    serializeOperatorInput,
} = require("./operator-protocol.cjs")
const {isAutomaticBudget, isIterationBudget} = require("./operator-budget.cjs")
const {
    OperatorToolTransport,
    redactOperatorSecrets,
} = require("./operator-tool-transport.cjs")
const {
    OPERATOR_CONTROL_ACTIONS,
    controlDefinition,
    createPublicControlError,
} = require("../control-plane/contracts.cjs")

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"])
const MAX_TRANSCRIPT_TEXT = 32 * 1_024
const MAX_BOUNDARY_TEXT = 16 * 1_024
const MAX_PENDING_BOUNDARIES = 1_000
const MAX_ITEM_IDS = 10_000
const MAX_CAPABILITY_LIFETIME_MS = 24 * 60 * 60 * 1_000
const OPERATOR_CONTROL_ACTION_SET = new Set(OPERATOR_CONTROL_ACTIONS)

function plainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
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

async function bestEffort(operation) {
    try {
        return await operation()
    } catch {
        return undefined
    }
}

function requiredText(value, label, maximum = 300) {
    if (
        typeof value !== "string" || value.length === 0 || value.length > maximum ||
        value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)
    ) throw new TypeError(`${label} is invalid`)
    return value
}

function messageText(value, label = "Operator message", maximum = MAX_TRANSCRIPT_TEXT) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
        throw new TypeError(`${label} is required and bounded`)
    }
    return value
}

function boundedText(value, maximum = MAX_TRANSCRIPT_TEXT) {
    const text = typeof value === "string" ? value : ""
    if (text.length <= maximum) return text
    return `${text.slice(0, maximum - 1)}…`
}

function operatorRuntime(runtime) {
    if (!plainObject(runtime)) throw new TypeError("Operator Runtime is invalid")
    return {
        runtimeId: requiredText(runtime.runtimeId, "Operator Runtime id"),
        providerId: requiredText(runtime.providerId, "Operator Runtime provider"),
        displayName: requiredText(runtime.displayName ?? runtime.runtimeId, "Operator Runtime name"),
        version: runtime.version === undefined || runtime.version === null || runtime.version === ""
            ? null
            : requiredText(runtime.version, "Operator Runtime version"),
        executablePath: runtime.executablePath === undefined || runtime.executablePath === null || runtime.executablePath === ""
            ? null
            : requiredText(runtime.executablePath, "Operator Runtime executable", 8_192),
    }
}

function runtimeCapabilities(runtime) {
    return Array.isArray(runtime?.capabilities)
        ? new Set(runtime.capabilities.filter((value) => typeof value === "string"))
        : new Set()
}

function selectedEffort(runtime, requested) {
    if (requested === undefined || requested === null || requested === "") return null
    if (!runtimeCapabilities(runtime).has("reasoning-effort")) return null
    const effort = requiredText(requested, "Operator effort", 100)
    if (Array.isArray(runtime.efforts) && runtime.efforts.length > 0 && !runtime.efforts.includes(effort)) {
        return null
    }
    return effort
}

function selectedModel(runtime, requested) {
    if (requested === undefined || requested === null || requested === "") return null
    const model = requiredText(requested, "Operator model", 300)
    if (Array.isArray(runtime.models) && runtime.models.length > 0) {
        const available = runtime.models.some((candidate) => (
            candidate === model || candidate?.id === model || candidate?.modelId === model
        ))
        if (!available) throw new Error("Selected Operator model is unavailable")
    }
    return model
}

function capabilityBudget(budget) {
    if (isAutomaticBudget(budget)) return {}
    return {
        maxRuntimeTurns: budget.maxRuntimeTurns,
        maxEvaluations: budget.maxEvaluations,
    }
}

function capabilityLifetime(input, budget) {
    const requested = input.expiresInMs ?? (
        isAutomaticBudget(budget)
            ? MAX_CAPABILITY_LIFETIME_MS
            : Math.max(60_000, budget.maxDurationMs)
    )
    if (!Number.isSafeInteger(requested) || requested <= 0 || requested > MAX_CAPABILITY_LIFETIME_MS) {
        throw new TypeError("Operator capability lifetime is invalid")
    }
    return requested
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function safeSelection(selection, runtime, support) {
    if (!plainObject(selection) || selection.ready !== true || typeof selection.kind !== "string") {
        throw new Error(selection?.reason ?? "Operator Tool transport is unavailable")
    }
    if (!["codex-dynamic", "acp-mcp", "dsh-mcp", "cli"].includes(selection.kind)) {
        throw new Error("Operator Tool transport selection is invalid")
    }
    const output = {
        kind: selection.kind,
        ready: true,
        descriptor: operatorRuntime(runtime),
        support: {
            dynamicToolsReady: support?.dynamicToolsReady === true,
            mcpServersReady: support?.mcpServersReady === true,
            dshMcpReady: support?.dshMcpReady === true,
        },
    }
    if (selection.kind === "cli") {
        output.executablePath = requiredText(
            selection.executablePath,
            "Bundled Operator Tool path",
            8_192,
        )
    }
    return output
}

function publicSelection(selection) {
    return selection.kind === "cli"
        ? {kind: selection.kind, ready: true, executablePath: selection.executablePath}
        : {kind: selection.kind, ready: true}
}

function nativeResumeUnavailable(error) {
    return [
        "THREAD_NOT_FOUND",
        "SESSION_NOT_FOUND",
        "NOT_FOUND",
        "RESUME_UNSUPPORTED",
        "UNSUPPORTED",
    ].includes(error?.code)
}

function turnInterruptionConverged(error) {
    if (["NOT_FOUND", "NO_ACTIVE_TURN"].includes(error?.code)) return true
    return typeof error?.message === "string" && /\balready (?:completed|complete|finished)\b/iu.test(error.message)
}

function activeTurnTarget(control) {
    if (
        control?.phase !== "active" ||
        typeof control.runtimeThreadId !== "string" || control.runtimeThreadId.trim().length === 0 ||
        typeof control.turnId !== "string" || control.turnId.trim().length === 0
    ) return null
    return Object.freeze({
        runtimeThreadId: control.runtimeThreadId,
        turnId: control.turnId,
    })
}

function runtimeThreadId(response) {
    return requiredText(
        response?.thread?.id ?? response?.sessionId,
        "Operator Runtime thread id",
        500,
    )
}

function methodName(value) {
    return requiredText(value, "Operator Tool method", 300)
}

function compactResult(value) {
    if (!plainObject(value)) return {status: "unknown"}
    const compact = {}
    for (const key of ["status", "jobId", "stepId", "approvalId"]) {
        if (typeof value[key] === "string") compact[key] = boundedText(value[key], 500)
    }
    if (plainObject(value.error)) {
        compact.error = {
            ...(typeof value.error.code === "string" ? {code: boundedText(value.error.code, 200)} : {}),
            ...(typeof value.error.message === "string" ? {message: boundedText(value.error.message, 1_000)} : {}),
        }
    }
    return compact
}

function controlIdempotencyKey(control, method, input, invocationId) {
    const explicit = typeof input?.idempotencyKey === "string" ? input.idempotencyKey : null
    const identity = canonicalJson([
        control.sessionId,
        method,
        explicit ?? invocationId,
    ])
    return `operator:${createHash("sha256").update(identity).digest("hex")}`
}

function compactActivity(item) {
    const activity = {
        itemId: requiredText(item.id ?? `item-${randomUUID()}`, "Operator activity id", 500),
        type: requiredText(item.type ?? "runtimeActivity", "Operator activity type", 300),
    }
    for (const key of ["status", "name", "title"]) {
        if (typeof item[key] === "string" && item[key].trim()) {
            activity[key] = boundedText(item[key], 500)
        }
    }
    if (Number.isSafeInteger(item.exitCode)) activity.exitCode = item.exitCode
    return activity
}

function errorRecord(error, fallback = "Operator Runtime failed") {
    return {
        code: typeof error?.code === "string" ? boundedText(error.code, 200) : "OPERATOR_RUNTIME_ERROR",
        message: boundedText(error?.message ?? fallback, 2_000),
    }
}

function sessionConfiguration(session) {
    return session.transcript.findLast((entry) => entry.kind === "operator_session_configuration") ?? null
}

function latestRuntimeThread(session) {
    return session.transcript.findLast((entry) => (
        (entry.kind === "runtime_thread_started" || entry.kind === "runtime_thread_resumed") &&
        typeof entry.runtimeThreadId === "string"
    ))?.runtimeThreadId ?? null
}

function latestCapabilityId(session) {
    return session.transcript.findLast((entry) => (
        typeof entry.capabilityId === "string" &&
        [
            "operator_authority_issued",
            "runtime_thread_started",
            "runtime_thread_resumed",
        ].includes(entry.kind)
    ))?.capabilityId ?? session.capabilityId
}

function sessionIsPaused(session) {
    const boundary = session.transcript.findLast((entry) => (
        entry.kind === "operator_session_paused" ||
        entry.kind === "operator_session_resumed" ||
        entry.kind === "operator_session_stopped"
    ))
    return boundary?.kind === "operator_session_paused"
}

function safeCheckpoint(job, artifacts) {
    const summary = typeof job.checkpoint?.summary === "string"
        ? boundedText(job.checkpoint.summary, 8_000)
        : "The prior Runtime session was interrupted. Continue from durable Job state."
    const artifactIds = artifacts.map((artifact) => artifact.id).slice(0, 1_000)
    return messageText([
        "Operator restart checkpoint:",
        summary,
        `Durable artifact IDs: ${JSON.stringify(artifactIds)}`,
        "Re-read durable Job state through Rolling Skill Tools before acting.",
    ].join("\n"), "Operator checkpoint", MAX_BOUNDARY_TEXT)
}

class OperatorSessionManager {
    #store
    #engine
    #controlPlane
    #runtimeRegistry
    #capabilities
    #controlSocketPath
    #operatorToolPath
    #transportFactory
    #transportSupport
    #requestPermission
    #requestQuestion
    #supportsNativeResume
    #workspaceRoot
    #resolveManagedSkillWorkspace
    #traceDirectory
    #controls = new Map()
    #resumeFlights = new Map()
    #stopPromises = new Map()
    #blockedSessions = new Set()
    #revokedCapabilities = new Set()
    #hiddenThreadIds = new Set()

    constructor({
        store,
        engine,
        controlPlane,
        runtimeRegistry,
        capabilities = null,
        capabilityIssuer = null,
        capabilityStore = null,
        controlSocketPath,
        operatorToolPath,
        transportFactory = null,
        transportSupport = () => ({}),
        requestPermission = null,
        requestQuestion = null,
        supportsNativeResume = null,
        workspaceRoot = null,
        resolveManagedSkillWorkspace = null,
        traceDirectory = null,
    } = {}) {
        if (!store || typeof store.createSession !== "function" || typeof store.createJob !== "function") {
            throw new TypeError("OperatorSessionManager requires an OperatorJobStore")
        }
        if (!engine || typeof engine.execute !== "function" || typeof engine.reconcile !== "function" || typeof engine.cancel !== "function") {
            throw new TypeError("OperatorSessionManager requires an OperatorJobEngine")
        }
        if (
            !controlPlane ||
            typeof controlPlane.invoke !== "function" ||
            typeof controlPlane.registerOperatorExecutor !== "function"
        ) throw new TypeError("OperatorSessionManager requires the shared ControlPlane")
        if (!runtimeRegistry || typeof runtimeRegistry.createClient !== "function") {
            throw new TypeError("OperatorSessionManager requires a RuntimeRegistry")
        }
        const issuer = capabilities ?? capabilityIssuer
        const revoker = capabilities ?? capabilityStore
        if (!issuer || typeof issuer.issue !== "function" || !revoker || typeof revoker.revoke !== "function") {
            throw new TypeError("OperatorSessionManager requires capability issue and revoke access")
        }
        if (typeof controlSocketPath !== "string" || controlSocketPath.length === 0) {
            throw new TypeError("Operator control socket is required")
        }
        if (transportFactory !== null && typeof transportFactory !== "function") {
            throw new TypeError("Operator transport factory is invalid")
        }
        if (typeof transportSupport !== "function") throw new TypeError("Operator transport support resolver is invalid")
        if (requestPermission !== null && typeof requestPermission !== "function") throw new TypeError("Operator permission callback is invalid")
        if (requestQuestion !== null && typeof requestQuestion !== "function") throw new TypeError("Operator question callback is invalid")
        if (supportsNativeResume !== null && typeof supportsNativeResume !== "function") throw new TypeError("Operator resume support resolver is invalid")
        if (resolveManagedSkillWorkspace !== null && typeof resolveManagedSkillWorkspace !== "function") {
            throw new TypeError("Managed Skill workspace resolver is invalid")
        }
        this.#store = store
        this.#engine = engine
        this.#controlPlane = controlPlane
        this.#runtimeRegistry = runtimeRegistry
        this.#capabilities = {
            issue: issuer.issue.bind(issuer),
            revoke: revoker.revoke.bind(revoker),
        }
        this.#controlSocketPath = controlSocketPath
        this.#operatorToolPath = operatorToolPath
        this.#transportFactory = transportFactory ?? ((input) => new OperatorToolTransport({
            executablePath: this.#operatorToolPath,
            childEnvironment: input.childEnvironment,
        }))
        this.#transportSupport = transportSupport
        this.#requestPermission = requestPermission
        this.#requestQuestion = requestQuestion
        this.#supportsNativeResume = supportsNativeResume
        this.#workspaceRoot = workspaceRoot
        this.#resolveManagedSkillWorkspace = resolveManagedSkillWorkspace
        this.#traceDirectory = traceDirectory
        for (const session of this.#store.listSessions()) {
            for (const entry of session.transcript) {
                if (typeof entry.runtimeThreadId === "string" && entry.runtimeThreadId) {
                    this.#hiddenThreadIds.add(entry.runtimeThreadId)
                }
            }
        }
    }

    async #managedWorkspace(value, scope, {persisted = false} = {}) {
        if (value === undefined || value === null) {
            return {binding: null, workspaceRoot: this.#workspaceRoot}
        }
        if (!plainObject(value)) throw new TypeError("Managed Skill binding is invalid")
        const allowed = new Set([
            "repositoryId",
            "skillId",
            "optimizationRunId",
            "skillEditSessionId",
            ...(persisted ? ["workspaceDigest"] : []),
        ])
        const required = new Set([
            "repositoryId",
            "skillId",
            ...(persisted ? ["workspaceDigest"] : []),
        ])
        if (Object.keys(value).some((key) => !allowed.has(key)) ||
            [...required].some((key) => !Object.hasOwn(value, key))) {
            throw new TypeError("Managed Skill binding is invalid")
        }
        const binding = {
            repositoryId: requiredText(value.repositoryId, "Managed Skill repository id", 200),
            skillId: requiredText(value.skillId, "Managed Skill id", 200),
            ...(value.optimizationRunId === undefined ? {} : {
                optimizationRunId: requiredText(
                    value.optimizationRunId,
                    "Optimization Run id",
                    200,
                ),
            }),
            ...(value.skillEditSessionId === undefined ? {} : {
                skillEditSessionId: requiredText(
                    value.skillEditSessionId,
                    "Skill edit session id",
                    200,
                ),
            }),
        }
        if (binding.optimizationRunId && binding.skillEditSessionId) {
            throw new TypeError("Managed Skill binding cannot select two workspaces")
        }
        if (!Array.isArray(scope?.repositoryIds) || !scope.repositoryIds.includes(binding.repositoryId) ||
            !Array.isArray(scope?.skillIds) || !scope.skillIds.includes(binding.skillId)) {
            throw new Error("Managed Skill binding is outside the frozen capability scope")
        }
        if (this.#resolveManagedSkillWorkspace === null) {
            throw new Error("Managed Skill workspace resolution is unavailable")
        }
        const resolvedWorkspace = await this.#resolveManagedSkillWorkspace(Object.freeze({...binding}))
        if (!plainObject(resolvedWorkspace) ||
            resolvedWorkspace.repositoryId !== binding.repositoryId ||
            resolvedWorkspace.skillId !== binding.skillId ||
            resolvedWorkspace.optimizationRunId !== binding.optimizationRunId ||
            resolvedWorkspace.skillEditSessionId !== binding.skillEditSessionId ||
            typeof resolvedWorkspace.workspaceRoot !== "string" ||
            !isAbsolute(resolvedWorkspace.workspaceRoot)) {
            throw new Error("Managed Skill workspace resolution is invalid")
        }
        const workspaceRoot = resolve(resolvedWorkspace.workspaceRoot)
        const workspaceDigest = `sha256:${createHash("sha256").update(workspaceRoot, "utf8").digest("hex")}`
        if (persisted && value.workspaceDigest !== workspaceDigest) {
            throw Object.assign(new Error("Managed Skill workspace changed since the session was created"), {
                code: "RESOURCE_CHANGED",
            })
        }
        return {
            binding: Object.freeze({...binding, workspaceDigest}),
            workspaceRoot,
        }
    }

    async #runtimes() {
        if (typeof this.#runtimeRegistry.discover !== "function") {
            throw new Error("Operator Runtime discovery is unavailable")
        }
        const discovered = await this.#runtimeRegistry.discover()
        if (Array.isArray(discovered)) return discovered
        if (Array.isArray(discovered?.available)) return discovered.available
        throw new Error("Operator Runtime discovery returned an invalid inventory")
    }

    async #runtimeById(runtimeId) {
        const id = requiredText(runtimeId, "Operator Runtime id")
        const descriptor = (await this.#runtimes()).find((candidate) => candidate?.runtimeId === id)
        if (!descriptor) throw new Error("Selected Operator Runtime is unavailable")
        operatorRuntime(descriptor)
        return descriptor
    }

    async #authority({sessionId, actions, scopes, budget, expiresInMs}) {
        if (!Array.isArray(actions) || actions.some((action) => !OPERATOR_CONTROL_ACTION_SET.has(action))) {
            throw new Error("Operator action is not exposed to the Runtime Tool")
        }
        const operatorSessionId = requiredText(sessionId, "Operator session id", 200)
        const grant = await this.#capabilities.issue({
            sessionId: operatorSessionId,
            actions: clone(actions, "Operator actions"),
            scopes: clone(scopes, "Operator scopes"),
            expiresInMs,
            budget: capabilityBudget(budget),
        })
        const expectedBudget = capabilityBudget(budget)
        const invalid = (
            !plainObject(grant) || typeof grant.id !== "string" || grant.id.length === 0 ||
            typeof grant.token !== "string" || grant.token.length === 0 ||
            grant.sessionId !== operatorSessionId ||
            JSON.stringify(grant.actions) !== JSON.stringify(actions) ||
            JSON.stringify(grant.scopes) !== JSON.stringify(scopes) ||
            JSON.stringify(grant.budget) !== JSON.stringify(expectedBudget)
        )
        if (invalid) {
            if (typeof grant?.id === "string") {
                await bestEffort(() => this.#capabilities.revoke(grant.id))
            }
            throw new Error("Operator capability issuer returned an invalid grant")
        }
        return {grant}
    }

    #childEnvironment(authority) {
        return {
            ROLLING_SKILL_CONTROL_SOCKET: this.#controlSocketPath,
            ROLLING_SKILL_CONTROL_TOKEN: authority.grant.token,
            ROLLING_SKILL_OPERATOR_SESSION: authority.grant.sessionId,
        }
    }

    async #freezeTransport(runtime, authority, frozenSelection = null) {
        const childEnvironment = this.#childEnvironment(authority)
        const transport = this.#transportFactory({runtime, childEnvironment})
        if (!transport || typeof transport.freeze !== "function") {
            throw new Error("Operator Tool transport factory returned an invalid transport")
        }
        const support = clone(await this.#transportSupport(runtime), "Operator transport support")
        if (typeof transport.preflight === "function") {
            const preflight = transport.preflight(runtime, support)
            if (preflight?.ready !== true) throw new Error(preflight?.reason ?? "Operator Tool transport is unavailable")
        }
        const selection = safeSelection(transport.freeze(runtime, support), runtime, support)
        if (
            frozenSelection !== null &&
            canonicalJson(selection) !== canonicalJson(frozenSelection)
        ) {
            throw new Error("Frozen Operator Tool transport descriptor is no longer available")
        }
        return {transport, selection, childEnvironment}
    }

    #nativeResume(runtime, client) {
        if (this.#supportsNativeResume) return this.#supportsNativeResume(runtime, client) === true
        return typeof client.resumeThread === "function" && runtimeCapabilities(runtime).has("threads")
    }

    #profile(control) {
        return {
            ...(control.modelId ? {model: control.modelId} : {}),
            ...(control.effort ? {effort: control.effort} : {}),
            threadSource: "subagent",
            ephemeral: false,
        }
    }

    #threadOptions(control) {
        const options = this.#profile(control)
        const dynamicTools = control.transport.dynamicTools?.() ?? []
        const mcpServers = control.transport.mcpServers?.() ?? []
        if (control.selection.kind === "codex-dynamic") options.dynamicTools = dynamicTools
        if (control.selection.kind === "acp-mcp") options.mcpServers = mcpServers
        return options
    }

    async #nameRuntimeThread(control, title) {
        if (!title || typeof control.client?.setThreadName !== "function") return
        await bestEffort(() => control.client.setThreadName(control.runtimeThreadId, title))
    }

    #append(control, kind, payload = {}) {
        const safe = redactOperatorSecrets(payload, control.childEnvironment)
        return this.#store.appendSessionTranscript(control.sessionId, {kind, ...safe})
    }

    #budgetSnapshot(control) {
        const usage = {runtimeTurns: 0, evaluations: 0}
        let revision = 0
        for (const event of this.#store.listEvents(control.parentJobId)) {
            if (event.kind !== "operator_budget_reserved") continue
            for (const field of Object.keys(usage)) {
                const amount = event.usage?.[field] ?? 0
                if (!Number.isSafeInteger(amount) || amount < 0) {
                    throw new Error("Durable Operator budget usage is invalid")
                }
                usage[field] += amount
                if (!Number.isSafeInteger(usage[field])) {
                    throw new Error("Durable Operator budget usage is too large")
                }
            }
            revision += 1
            if (!Number.isSafeInteger(revision)) throw new Error("Durable Operator budget revision is too large")
        }
        return {usage, revision}
    }

    #iterationState(control) {
        if (!isIterationBudget(control.budget)) return null
        const transcript = this.#store.getSession(control.sessionId).transcript
        const used = transcript.filter((entry) => (
            entry.kind === "operator_iteration_started"
        )).length
        return {
            transcript,
            used,
            limit: control.budget.maxIterations,
        }
    }

    #reserveIteration(control) {
        const state = this.#iterationState(control)
        if (state === null) return true
        if (state.used < state.limit) {
            this.#append(control, "operator_iteration_started", {
                iteration: state.used + 1,
                limit: state.limit,
            })
            return true
        }
        control.paused = true
        const parent = this.#store.getJob(control.parentJobId)
        if (parent.status === "running") this.#store.transitionJob(parent.id, "paused")
        else if (parent.status !== "paused" && parent.status !== "waiting_approval") {
            throw new Error(`Operator iteration limit cannot pause Job while ${parent.status}`)
        }
        if (!state.transcript.some((entry) => (
            entry.kind === "operator_iteration_limit_reached" &&
            entry.used === state.used &&
            entry.limit === state.limit
        ))) {
            this.#append(control, "operator_iteration_limit_reached", {
                used: state.used,
                limit: state.limit,
                reason: "max_iterations_reached",
            })
        }
        return false
    }

    #controlIsLive(control, generation = control.controlGeneration) {
        return (
            this.#controls.get(control.sessionId) === control &&
            !control.stopped &&
            !control.paused &&
            control.controlGeneration === generation &&
            control.phase === "active"
        )
    }

    #controlIsOwned(control, generation = control.controlGeneration) {
        return (
            this.#controls.get(control.sessionId) === control &&
            !control.stopped &&
            control.controlGeneration === generation
        )
    }

    #assertControlOwned(control, generation = control.controlGeneration) {
        if (!this.#controlIsOwned(control, generation)) {
            throw Object.assign(new Error("Operator session ownership changed"), {
                code: "CONTROL_BUSY",
            })
        }
    }

    #syncExecutorLease(control) {
        const shouldEnable = this.#controlIsLive(control)
        const changed = shouldEnable
            ? control.executorLease?.enable()
            : control.executorLease?.disable()
        if (shouldEnable && changed !== true) {
            throw new Error("Operator executor lease is unavailable")
        }
    }

    #registerExecutor(control, replace = undefined) {
        const registration = {
            sessionId: control.sessionId,
            capabilityId: control.authority.grant.id,
            enabled: false,
            budgetSnapshot: () => this.#budgetSnapshot(control),
            assertLive: () => this.#controlIsLive(control),
            contextSnapshot: () => ({
                workspaceRoot: control.workspaceRoot,
                runtimeId: control.runtime.runtimeId,
            }),
            execute: (request) => this.#executeControl(control, request),
            ...(replace === undefined ? {} : {replace}),
        }
        control.executorLease = this.#controlPlane.registerOperatorExecutor(registration)
    }

    async #executeControl(control, request) {
        const generation = control.controlGeneration
        if (!this.#controlIsLive(control, generation)) {
            throw createPublicControlError("CONTROL_BUSY")
        }
        const method = methodName(request?.method)
        const callId = requiredText(request.invocationId, "Operator control invocation id", 500)
        const input = clone(request?.input ?? {}, "Operator Tool parameters")
        const policyDecision = request?.policyDecision
        if (!plainObject(policyDecision) || !["allow", "approval_required"].includes(policyDecision.decision)) {
            throw createPublicControlError("FORBIDDEN", {
                details: {action: controlDefinition(method).action},
            })
        }
        this.#append(control, "tool_call_started", {callId, method})
        let completionRecorded = false
        try {
            const result = await this.#engine.execute(control.parentJobId, {
                method,
                params: input,
                idempotencyKey: controlIdempotencyKey(control, method, input, callId),
                ...(policyDecision.decision === "approval_required" ? {
                    policyApproval: {
                        decision: "approval_required",
                        action: policyDecision.reason === "budget_expansion"
                            ? "budget.expand"
                            : controlDefinition(method).action,
                        reason: policyDecision.reason,
                        requestedScope: policyDecision.requestedScope ?? {},
                    },
                } : {}),
                assertRunnable: () => this.#controlIsLive(control, generation),
                handlerContext: request.context,
                ...(request.trustedFacts ? {trustedFacts: request.trustedFacts} : {}),
            })
            if (!this.#controlIsLive(control, generation)) {
                throw createPublicControlError("CONTROL_BUSY")
            }
            this.#append(control, "tool_call_completed", {
                callId,
                method,
                result: compactResult(result),
            })
            completionRecorded = true
            if (result?.status === "succeeded") return result.result
            if (result?.status === "waiting_approval") {
                const approval = this.#store.getApproval(result.approvalId)
                throw createPublicControlError("APPROVAL_REQUIRED", {
                    details: {
                        action: approval.action,
                        reason: approval.risk,
                        approvalId: result.approvalId,
                        jobId: result.jobId,
                        stepId: result.stepId,
                    },
                })
            }
            if (["cancelled", "needs_recovery"].includes(result?.status)) {
                throw createPublicControlError("CONTROL_BUSY")
            }
            throw createPublicControlError("CONTROL_ERROR")
        } catch (error) {
            if (!completionRecorded) {
                this.#append(control, "tool_call_failed", {callId, method, error: errorRecord(error)})
            }
            throw error
        }
    }

    #snapshot(control) {
        return {
            session: this.#store.getSession(control.sessionId),
            parentJob: this.#store.getJob(control.parentJobId),
            runtimeThreadId: control.runtimeThreadId,
            transport: publicSelection(control.selection),
            state: control.stopped ? "stopped" : control.paused ? "paused" : control.phase,
        }
    }

    #createControl({
        session,
        parentJob,
        runtime,
        modelId,
        effort,
        authority,
        transport,
        selection,
        childEnvironment,
        scope,
        actions,
        budget,
        nativeResume,
        managedSkillBinding = null,
        workspaceRoot = this.#workspaceRoot,
    }) {
        const control = {
            sessionId: session.id,
            parentJobId: parentJob.id,
            runtime,
            modelId,
            effort,
            authority,
            transport,
            selection,
            childEnvironment,
            scope,
            actions,
            budget,
            nativeResume,
            managedSkillBinding,
            workspaceRoot,
            client: null,
            runtimeThreadId: null,
            turnId: null,
            phase: "restoring",
            paused: parentJob.status === "paused",
            stopped: false,
            generation: 0,
            controlGeneration: 0,
            completedTurnIds: new Set(),
            itemIds: new Set(),
            completedChildIds: new Set(),
            pendingChildIds: new Set(),
            boundaryQueue: [],
            draining: false,
            notification: null,
            runtimeError: null,
            stateListener: null,
            executorLease: null,
            pendingInteractions: new Set(),
            failurePromise: null,
            failureCleanup: null,
            runtimeExited: false,
            clientStopped: false,
            stopProgress: null,
        }
        control.itemIds = new Set(session.transcript
            .filter((entry) => typeof entry.itemId === "string")
            .map((entry) => entry.itemId)
            .slice(-MAX_ITEM_IDS))
        control.completedChildIds = new Set(session.transcript
            .filter((entry) => entry.kind === "child_completion_delivered" && typeof entry.childJobId === "string")
            .map((entry) => entry.childJobId))
        const deliveredBoundaries = new Set(session.transcript
            .filter((entry) => entry.kind === "operator_boundary_delivered" && typeof entry.boundaryId === "string")
            .map((entry) => entry.boundaryId))
        for (const entry of session.transcript) {
            if (
                entry.kind !== "operator_boundary_enqueued" ||
                typeof entry.boundaryId !== "string" ||
                deliveredBoundaries.has(entry.boundaryId)
            ) continue
            if (control.boundaryQueue.length >= MAX_PENDING_BOUNDARIES) {
                throw new Error("Durable Operator boundary queue exceeds its limit")
            }
            const content = messageText(entry.content, "Durable Operator boundary", MAX_BOUNDARY_TEXT)
            const boundaryKind = entry.boundaryKind === "environment" ? "environment" : "user"
            control.boundaryQueue.push({
                id: entry.boundaryId,
                kind: boundaryKind,
                ...(typeof entry.childJobId === "string" ? {childJobId: entry.childJobId} : {}),
                input: boundaryKind === "environment"
                    ? [{type: "operatorContext", protocol: OPERATOR_PROTOCOL, text: content}]
                    : [{type: "text", text: content}],
            })
            if (typeof entry.childJobId === "string") control.pendingChildIds.add(entry.childJobId)
        }
        return control
    }

    #clientOptions(control) {
        const mcpServers = control.selection.kind === "dsh-mcp"
            ? control.transport.mcpServers?.() ?? []
            : []
        return {
            ...(control.workspaceRoot ? {workspaceRoot: control.workspaceRoot} : {}),
            ...(this.#traceDirectory ? {traceDirectory: this.#traceDirectory} : {}),
            childEnvironment: {...control.childEnvironment},
            ...(mcpServers.length > 0 ? {mcpServers} : {}),
            nonInteractive: false,
            requestTool: (request) => this.#requestTool(control, request),
            requestPermission: (request) => this.#permission(control, request),
            requestQuestion: (request) => this.#question(control, request),
        }
    }

    #attach(control) {
        const client = control.client
        control.notification = (message) => this.#notification(control, message)
        control.runtimeError = (error) => {
            void this.#runtimeFailure(control, error, {runtimeExited: true}).catch(() => {})
        }
        control.stateListener = (state) => {
            if (state?.status === "error" || state?.status === "stopped") {
                void this.#runtimeFailure(
                    control,
                    new Error("Operator Runtime stopped unexpectedly"),
                    {runtimeExited: true},
                ).catch(() => {})
            }
        }
        client.on?.("notification", control.notification)
        client.on?.("runtimeError", control.runtimeError)
        client.on?.("state", control.stateListener)
    }

    #detach(control) {
        const client = control.client
        if (!client) return
        client.off?.("notification", control.notification)
        client.off?.("runtimeError", control.runtimeError)
        client.off?.("state", control.stateListener)
    }

    #matchesThread(control, params) {
        const candidate = params.threadId ?? params.thread?.id ?? params.sessionId
        return candidate === undefined || candidate === control.runtimeThreadId
    }

    #notification(control, message) {
        if (control.stopped || !plainObject(message)) return
        const params = plainObject(message.params) ? message.params : {}
        if (!this.#matchesThread(control, params)) return
        try {
            if (message.method === "turn/started") {
                const turnId = params.turn?.id ?? params.turnId
                if (
                    control.phase === "active" &&
                    typeof turnId === "string" &&
                    turnId.length > 0 &&
                    (control.turnId === null || control.turnId === turnId)
                ) control.turnId = turnId
                this.#append(control, "turn_started", {
                    turnId: typeof turnId === "string" ? turnId : null,
                })
                return
            }
            if (message.method === "item/completed") {
                const item = plainObject(params.item) ? params.item : {}
                const itemId = typeof item.id === "string" ? item.id : null
                if (itemId && control.itemIds.has(itemId)) return
                if (itemId) {
                    if (control.itemIds.size >= MAX_ITEM_IDS) control.itemIds.delete(control.itemIds.values().next().value)
                    control.itemIds.add(itemId)
                }
                if (item.type === "agentMessage" && typeof item.text === "string" && item.text.length > 0) {
                    this.#append(control, "message", {
                        role: "assistant",
                        ...(itemId ? {itemId} : {}),
                        content: boundedText(item.text),
                    })
                } else {
                    this.#append(control, "activity", compactActivity(item))
                }
                return
            }
            if (message.method === "turn/completed") {
                const turnId = params.turn?.id ?? params.turnId ?? control.turnId
                if (
                    control.phase === "active" &&
                    control.turnId &&
                    turnId &&
                    control.turnId !== turnId
                ) return
                if (typeof turnId === "string") {
                    if (control.completedTurnIds.size >= 100) {
                        control.completedTurnIds.delete(control.completedTurnIds.values().next().value)
                    }
                    control.completedTurnIds.add(turnId)
                }
                if (control.phase === "starting") {
                    this.#append(control, "turn_completed", {
                        turnId: turnId ?? null,
                        status: typeof params.turn?.status === "string" ? params.turn.status : "completed",
                    })
                    return
                }
                if (control.phase !== "active") return
                control.executorLease?.disable()
                control.controlGeneration += 1
                control.turnId = null
                control.phase = "idle"
                this.#append(control, "turn_completed", {
                    turnId: turnId ?? null,
                    status: typeof params.turn?.status === "string" ? params.turn.status : "completed",
                })
                queueMicrotask(() => void this.#drainBoundary(control))
                return
            }
            if (message.method === "error" && params.willRetry !== true) {
                this.#append(control, "runtime_error", {
                    error: errorRecord(params.error ?? new Error(params.message ?? "Operator Runtime failed")),
                })
            }
        } catch (error) {
            void this.#runtimeFailure(control, error).catch(() => {})
        }
    }

    #retryRuntimeFailureCleanup(control) {
        const cleanup = control.failureCleanup
        if (!cleanup) return Promise.resolve()
        if (cleanup.promise) return cleanup.promise
        const required = []
        if (!cleanup.jobInterruptComplete) {
            required.push(this.#requiredStopOperation(
                `interrupt ${control.parentJobId}`,
                () => (
                    typeof this.#engine.interrupt === "function"
                        ? this.#engine.interrupt(control.parentJobId, {
                              code: "OPERATOR_RUNTIME_FAILED",
                              message: "Operator Runtime failed",
                          })
                        : cleanup.outcomeUnknown
                            ? this.#store.interruptJob(control.parentJobId, {
                                  code: "OPERATOR_RUNTIME_FAILED",
                                  message: "Operator Runtime failed",
                              })
                            : this.#store.getJob(control.parentJobId)
                ),
                () => { cleanup.jobInterruptComplete = true },
            ))
        }
        if (!cleanup.revokeComplete) {
            required.push(this.#requiredStopOperation(
                `revoke ${control.authority.grant.id}`,
                () => this.#capabilities.revoke(control.authority.grant.id),
                () => {
                    cleanup.revokeComplete = true
                    this.#revokedCapabilities.add(control.authority.grant.id)
                },
            ))
        }
        const turnInterruption = this.#turnInterruptionOperation(control, cleanup)
        if (turnInterruption) required.push(turnInterruption)
        const operation = (async () => {
            const settled = await Promise.allSettled(required.map((entry) => entry.promise))
            const failures = settled.flatMap((entry, index) => (
                entry.status === "rejected"
                    ? [Object.assign(
                          new Error(`${required[index].label}: ${entry.reason?.message ?? "failed"}`),
                          {cause: entry.reason},
                      )]
                    : []
            ))
            if (cleanup.turnSettled && !cleanup.clientStopComplete) {
                const clientStop = this.#requiredStopOperation(
                    "stop failed Runtime client",
                    () => {
                        if (typeof control.client?.stop !== "function") {
                            throw new Error("Operator Runtime client cannot be stopped")
                        }
                        return control.client.stop()
                    },
                    () => {
                        cleanup.clientStopComplete = true
                        control.clientStopped = true
                    },
                )
                const [clientResult] = await Promise.allSettled([clientStop.promise])
                if (clientResult.status === "rejected") {
                    failures.push(Object.assign(
                        new Error(`${clientStop.label}: ${clientResult.reason?.message ?? "failed"}`),
                        {cause: clientResult.reason},
                    ))
                }
            }
            if (failures.length > 0) {
                control.phase = control.stopped ? "stopping" : "cleanup_failed"
                throw new AggregateError(
                    failures,
                    `Operator Runtime cleanup incomplete: ${failures.map((failure) => failure.message).join("; ")}`,
                )
            }
            control.phase = "needs_recovery"
            if (this.#controls.get(control.sessionId) === control) {
                this.#controls.delete(control.sessionId)
            }
        })()
        let shared
        shared = operation.finally(() => {
            if (cleanup.promise === shared) cleanup.promise = null
            if (control.failurePromise === shared) control.failurePromise = null
        })
        cleanup.promise = shared
        control.failurePromise = shared
        return shared
    }

    #runtimeFailure(control, error, {runtimeExited = false} = {}) {
        if (control.failureCleanup) {
            if (runtimeExited) {
                control.runtimeExited = true
                control.failureCleanup.turnTarget = null
                control.failureCleanup.turnSettled = true
            }
            return this.#retryRuntimeFailureCleanup(control)
        }
        if (control.stopped) return Promise.resolve()
        const turnTarget = runtimeExited ? null : activeTurnTarget(control)
        const outcomeUnknown = this.#store.listSteps({jobId: control.parentJobId})
            .some((step) => step.status === "running")
        control.runtimeExited = runtimeExited
        control.controlGeneration += 1
        control.generation += 1
        control.phase = "needs_recovery"
        control.executorLease?.disable()
        control.executorLease?.unregister()
        this.#abortInteractions(control)
        try {
            this.#append(control, "runtime_error", {error: errorRecord(error)})
            if (!outcomeUnknown) {
                this.#append(control, "operator_session_needs_resume", {
                    reason: "runtime_failure",
                })
            }
        } catch {}
        this.#detach(control)
        control.failureCleanup = {
            outcomeUnknown,
            jobInterruptComplete: false,
            revokeComplete: this.#revokedCapabilities.has(control.authority.grant.id),
            clientStopComplete: control.clientStopped,
            turnTarget,
            turnSettled: runtimeExited || turnTarget === null,
            promise: null,
        }
        return this.#retryRuntimeFailureCleanup(control)
    }

    async #startTurn(control, input) {
        if (control.stopped) throw new Error("Operator session is stopped")
        if (control.paused) throw new Error("Operator session is paused")
        if (control.phase !== "idle" && control.phase !== "restoring") {
            throw new Error("Operator Runtime turn is already active")
        }
        if (!this.#reserveIteration(control)) return null
        const controlGeneration = control.controlGeneration
        const generation = ++control.generation
        control.phase = "starting"
        control.executorLease?.disable()
        try {
            const response = await control.client.startTurn(
                control.runtimeThreadId,
                serializeOperatorInput(input),
                this.#profile(control),
            )
            this.#assertControlOwned(control, controlGeneration)
            if (control.generation !== generation) {
                throw Object.assign(new Error("Operator Runtime turn ownership changed"), {
                    code: "CONTROL_BUSY",
                })
            }
            const turnId = requiredText(response?.turn?.id, "Operator Runtime turn id", 500)
            control.turnId = turnId
            if (!control.completedTurnIds.has(turnId)) control.phase = "active"
            else {
                control.turnId = null
                control.phase = "idle"
                queueMicrotask(() => void this.#drainBoundary(control))
            }
            this.#syncExecutorLease(control)
            return response
        } catch (error) {
            if (control.generation === generation && !control.stopped) {
                control.turnId = null
                control.phase = "idle"
                this.#append(control, "turn_failed", {error: errorRecord(error)})
            }
            throw error
        }
    }

    async #requestTool(control, request) {
        if (control.stopped) throw new Error("Operator session is stopped")
        if (control.failureCleanup) throw new Error("Operator Runtime is stopped; resume is required")
        if (control.paused) throw new Error("Operator session is paused; new Steps are disabled")
        if (control.phase !== "active") {
            throw new Error("Operator Tool call is outside an active Runtime turn")
        }
        if (!plainObject(request) || !plainObject(request.params)) throw new TypeError("Operator Tool request is invalid")
        const method = methodName(request.method)
        const callId = requiredText(request.callId, "Operator Tool call id", 500)
        try {
            const result = await this.#controlPlane.invoke({
                token: control.authority.grant.token,
                sessionId: control.sessionId,
                method,
                params: clone(request.params, "Operator Tool parameters"),
            })
            if (control.stopped) throw new Error("Operator session is stopped")
            const publicResult = redactOperatorSecrets(
                clone(result, "Operator Tool result"),
                control.childEnvironment,
            )
            return publicResult
        } catch (error) {
            throw error
        }
    }

    async #interaction(control, invoke, fallback) {
        const generation = control.controlGeneration
        if (!this.#controlIsLive(control, generation)) return fallback
        const controller = new AbortController()
        control.pendingInteractions.add(controller)
        let rejectAbort
        const aborted = new Promise((_resolve, reject) => { rejectAbort = reject })
        const abort = () => rejectAbort(Object.assign(new Error("Operator interaction cancelled"), {
            code: "OPERATOR_CANCELLED",
        }))
        controller.signal.addEventListener("abort", abort, {once: true})
        try {
            const value = await Promise.race([
                Promise.resolve().then(() => invoke(controller.signal)),
                aborted,
            ])
            return this.#controlIsLive(control, generation) ? value : fallback
        } catch {
            return fallback
        } finally {
            controller.signal.removeEventListener("abort", abort)
            control.pendingInteractions.delete(controller)
        }
    }

    #abortInteractions(control) {
        for (const controller of control.pendingInteractions) {
            controller.abort()
        }
        control.pendingInteractions.clear()
    }

    async #permission(control, request) {
        const generation = control.controlGeneration
        if (!this.#controlIsLive(control, generation)) return "decline"
        const requestId = typeof request?.rpcId === "string" ? boundedText(request.rpcId, 500) : null
        this.#append(control, "permission_requested", {requestId})
        const enriched = {...clone(request ?? {}, "Operator permission request"), operatorSessionId: control.sessionId, operatorJobId: control.parentJobId}
        const response = await this.#interaction(control, (signal) => (
            this.#requestPermission ? this.#requestPermission({...enriched, signal}) : "decline"
        ), "decline")
        if (!this.#controlIsLive(control, generation)) return "decline"
        this.#append(control, "permission_resolved", {
            requestId,
            decision: typeof response === "string" ? boundedText(response, 200) : "decline",
        })
        return response
    }

    async #question(control, request) {
        const generation = control.controlGeneration
        if (!this.#controlIsLive(control, generation)) return {answers: []}
        const requestId = typeof request?.rpcId === "string" ? boundedText(request.rpcId, 500) : null
        const questions = Array.isArray(request?.questions) ? request.questions : []
        this.#append(control, "question_requested", {requestId, count: questions.length})
        const enriched = {...clone(request ?? {}, "Operator question request"), operatorSessionId: control.sessionId, operatorJobId: control.parentJobId}
        const response = await this.#interaction(control, (signal) => (
            this.#requestQuestion ? this.#requestQuestion({...enriched, signal}) : {answers: []}
        ), {answers: []})
        if (!this.#controlIsLive(control, generation)) return {answers: []}
        this.#append(control, "question_resolved", {
            requestId,
            answerCount: Array.isArray(response?.answers) ? response.answers.length : 0,
        })
        return response
    }

    hiddenThreadIds() {
        return new Set(this.#hiddenThreadIds)
    }

    async create(input = {}) {
        if (!plainObject(input)) throw new TypeError("Operator session request is invalid")
        const allowedInputKeys = new Set([
            "runtimeId",
            "modelId",
            "effort",
            "title",
            "objective",
            "actions",
            "scopes",
            "budget",
            "expiresInMs",
            "managedSkillBinding",
        ])
        if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
            throw new TypeError("Operator session request contains an unsupported field")
        }
        const runtime = await this.#runtimeById(input.runtimeId)
        const modelId = selectedModel(runtime, input.modelId)
        const effort = selectedEffort(runtime, input.effort)
        const title = input.title === undefined
            ? null
            : requiredText(input.title, "Operator session title", 200)
        const objective = messageText(input.objective, "Operator objective")
        const context = protocolSnapshot({
            actions: input.actions,
            scope: input.scopes,
            budget: input.budget,
            transport: {kind: "codex-dynamic", ready: true},
        })
        const managedWorkspace = await this.#managedWorkspace(
            input.managedSkillBinding,
            context.scope,
        )
        const expiresInMs = capabilityLifetime(input, context.budget)
        const operatorSessionId = randomUUID()
        const authority = await this.#authority({
            sessionId: operatorSessionId,
            actions: context.actions,
            scopes: context.scope,
            budget: context.budget,
            expiresInMs,
        })
        let frozen
        try {
            frozen = await this.#freezeTransport(runtime, authority)
        } catch (error) {
            await bestEffort(() => this.#capabilities.revoke(authority.grant.id))
            throw error
        }
        const protocolContext = {...context, transport: publicSelection(frozen.selection)}
        let session
        let parentJob
        let control
        try {
            session = this.#store.createSession({
                id: operatorSessionId,
                runtime: operatorRuntime(runtime),
                modelId,
                effort,
                protocol: OPERATOR_PROTOCOL,
                capabilityId: authority.grant.id,
            })
            parentJob = this.#store.createJob({
                sessionId: session.id,
                type: "operator-session",
                objective,
                budget: context.budget,
                checkpoint: managedWorkspace.binding?.optimizationRunId
                    ? {optimizationRunId: managedWorkspace.binding.optimizationRunId}
                    : managedWorkspace.binding?.skillEditSessionId
                        ? {skillEditSessionId: managedWorkspace.binding.skillEditSessionId}
                        : null,
            })
            control = this.#createControl({
                session,
                parentJob,
                runtime,
                modelId,
                effort,
                authority,
                ...frozen,
                scope: context.scope,
                actions: context.actions,
                budget: context.budget,
                nativeResume: false,
                managedSkillBinding: managedWorkspace.binding,
                workspaceRoot: managedWorkspace.workspaceRoot,
            })
            control.client = this.#runtimeRegistry.createClient(runtime, this.#clientOptions(control))
            if (!control.client || typeof control.client.start !== "function" || typeof control.client.startThread !== "function" || typeof control.client.startTurn !== "function") {
                throw new Error("Operator Runtime client is incomplete")
            }
            control.nativeResume = this.#nativeResume(runtime, control.client)
            this.#controls.set(session.id, control)
            this.#registerExecutor(control)
            this.#attach(control)
            this.#append(control, "operator_session_configuration", {
                protocol: OPERATOR_PROTOCOL,
                actions: context.actions,
                scopes: context.scope,
                budget: context.budget,
                transport: publicSelection(frozen.selection),
                frozenTransport: frozen.selection,
                nativeResume: control.nativeResume,
                ...(title === null ? {} : {title}),
                ...(managedWorkspace.binding === null
                    ? {}
                    : {managedSkillBinding: managedWorkspace.binding}),
            })
            this.#append(control, "operator_authority_issued", {
                capabilityId: authority.grant.id,
            })
            this.#append(control, "message", {role: "user", content: objective})
            const restorationGeneration = control.controlGeneration
            await control.client.start()
            this.#assertControlOwned(control, restorationGeneration)
            const thread = await control.client.startThread(this.#threadOptions(control))
            this.#assertControlOwned(control, restorationGeneration)
            control.runtimeThreadId = runtimeThreadId(thread)
            this.#hiddenThreadIds.add(control.runtimeThreadId)
            this.#append(control, "runtime_thread_started", {runtimeThreadId: control.runtimeThreadId})
            await this.#nameRuntimeThread(control, title)
            parentJob = this.#store.transitionJob(parentJob.id, "running")
            await this.#startTurn(control, buildOperatorInitialInput(protocolContext, objective))
            return this.#snapshot(control)
        } catch (error) {
            const stoppedByLifecycle = control?.stopped === true || this.#blockedSessions.has(session?.id)
            if (control) {
                control.stopped = true
                control.executorLease?.unregister()
                this.#detach(control)
                await bestEffort(() => control.client?.stop?.())
                this.#controls.delete(control.sessionId)
            }
            if (parentJob && !stoppedByLifecycle) {
                try {
                    const current = this.#store.getJob(parentJob.id)
                    if (!TERMINAL_JOB_STATUSES.has(current.status)) {
                        await this.#engine.completeJob?.(parentJob.id, "failed", {error: errorRecord(error)})
                    }
                } catch {}
            }
            await bestEffort(() => this.#capabilities.revoke(authority.grant.id))
            throw error
        }
    }

    #control(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        return this.#controls.get(id) ?? null
    }

    get(sessionId) {
        const control = this.#control(sessionId)
        if (control) return this.#snapshot(control)
        const session = this.#store.getSession(requiredText(sessionId, "Operator session id"))
        const parentJob = this.#store.listJobs({sessionId: session.id, parentJobId: null})[0]
        if (!parentJob) throw new Error("Operator parent Job is missing")
        const configuration = sessionConfiguration(session)
        return {
            session,
            parentJob,
            runtimeThreadId: latestRuntimeThread(session),
            transport: configuration?.transport ?? null,
            state: TERMINAL_JOB_STATUSES.has(parentJob.status)
                ? "stopped"
                : sessionIsPaused(session) ? "paused" : parentJob.status,
        }
    }

    async followUp(sessionId, text) {
        const id = requiredText(sessionId, "Operator session id")
        if (this.#blockedSessions.has(id)) throw new Error("Operator session is stopped")
        const control = this.#control(id)
        if (!control) throw new Error("Operator session must be resumed before messaging")
        if (control.stopped) throw new Error("Operator session is stopped")
        const content = messageText(text)
        if (control.boundaryQueue.length >= MAX_PENDING_BOUNDARIES) throw new Error("Operator message queue is full")
        const boundaryId = `boundary-${randomUUID()}`
        this.#append(control, "operator_boundary_enqueued", {
            boundaryId,
            boundaryKind: "user",
            content,
        })
        this.#append(control, "message", {role: "user", content})
        const entry = {id: boundaryId, kind: "user", input: [{type: "text", text: content}]}
        control.boundaryQueue.push(entry)
        const queued = control.phase !== "idle" || control.paused || control.draining
        void this.#drainBoundary(control)
        return {queued}
    }

    sendMessage(sessionId, text) {
        return this.followUp(sessionId, text)
    }

    async #drainBoundary(control) {
        if (control.draining || control.stopped || control.paused || control.phase !== "idle") return
        const boundary = control.boundaryQueue[0]
        if (!boundary) return
        control.draining = true
        try {
            const started = await this.#startTurn(control, boundary.input)
            if (started === null) return
            this.#assertControlOwned(control)
            this.#append(control, "operator_boundary_delivered", {
                boundaryId: boundary.id,
                boundaryKind: boundary.kind,
                ...(boundary.childJobId ? {childJobId: boundary.childJobId} : {}),
            })
            control.boundaryQueue.shift()
            if (boundary.childJobId) {
                control.pendingChildIds.delete(boundary.childJobId)
                control.completedChildIds.add(boundary.childJobId)
                this.#append(control, "child_completion_delivered", {
                    childJobId: boundary.childJobId,
                    boundaryId: boundary.id,
                })
            }
        } catch (error) {
            void this.#runtimeFailure(control, error).catch(() => {})
        }
        finally {
            control.draining = false
            if (control.phase === "idle" && control.boundaryQueue.length > 0) {
                queueMicrotask(() => void this.#drainBoundary(control))
            }
        }
    }

    async notifyChildCompletion(sessionId, childJobId) {
        const id = requiredText(sessionId, "Operator session id")
        if (this.#blockedSessions.has(id)) throw new Error("Operator session is stopped")
        const control = this.#control(id)
        if (!control) throw new Error("Operator session must be resumed before child notification")
        if (control.stopped) throw new Error("Operator session is stopped")
        const child = this.#store.getJob(requiredText(childJobId, "Child Operator Job id"))
        if (child.sessionId !== control.sessionId || child.parentJobId !== control.parentJobId) {
            throw new Error("Child Operator Job does not belong to this session")
        }
        if (!TERMINAL_JOB_STATUSES.has(child.status)) throw new Error("Child Operator Job is not complete")
        if (control.completedChildIds.has(child.id)) return {queued: false, duplicate: true}
        if (control.pendingChildIds.has(child.id)) return {queued: true, duplicate: true}
        if (control.boundaryQueue.length >= MAX_PENDING_BOUNDARIES) throw new Error("Operator message queue is full")
        const artifactIds = this.#store.listArtifacts(child.id).map((artifact) => artifact.id).slice(0, 1_000)
        const text = messageText([
            "Rolling Skill environment update:",
            `Child jobId ${child.id} completed with status ${child.status}.`,
            `Artifact IDs: ${JSON.stringify(artifactIds)}`,
            "Continue from durable Job and artifact state.",
        ].join("\n"), "Operator child completion", MAX_BOUNDARY_TEXT)
        this.#append(control, "child_completion_enqueued", {
            childJobId: child.id,
            status: child.status,
            artifactIds,
        })
        const boundaryId = `boundary-${randomUUID()}`
        this.#append(control, "operator_boundary_enqueued", {
            boundaryId,
            boundaryKind: "environment",
            childJobId: child.id,
            content: text,
        })
        control.pendingChildIds.add(child.id)
        control.boundaryQueue.push({
            id: boundaryId,
            kind: "environment",
            childJobId: child.id,
            input: [{type: "operatorContext", protocol: OPERATOR_PROTOCOL, text}],
        })
        const queued = control.phase !== "idle" || control.paused || control.draining
        void this.#drainBoundary(control)
        return {queued}
    }

    async pause(sessionId) {
        const control = this.#control(sessionId)
        if (!control) throw new Error("Operator session must be resumed before pausing")
        if (control.stopped) throw new Error("Operator session is stopped")
        if (!control.paused) {
            control.executorLease?.disable()
            control.controlGeneration += 1
            this.#abortInteractions(control)
            const parent = this.#store.getJob(control.parentJobId)
            try {
                if (parent.status === "running") {
                    this.#store.transitionJob(parent.id, "paused")
                } else if (parent.status !== "paused" && parent.status !== "waiting_approval") {
                    throw new Error(`Operator session cannot pause while ${parent.status}`)
                }
                control.paused = true
                this.#append(control, "operator_session_paused", {})
            } catch (error) {
                if (!control.paused) this.#syncExecutorLease(control)
                throw error
            }
        }
        return this.#snapshot(control)
    }

    async #reconcile(session, parentJob) {
        const jobs = this.#store.listJobs({sessionId: session.id})
        const byParent = new Map()
        for (const job of jobs) {
            if (!byParent.has(job.parentJobId)) byParent.set(job.parentJobId, [])
            byParent.get(job.parentJobId).push(job)
        }
        const stack = [{job: parentJob, visited: false}]
        const ordered = []
        while (stack.length > 0) {
            const entry = stack.pop()
            if (entry.visited) {
                ordered.push(entry.job)
                continue
            }
            stack.push({job: entry.job, visited: true})
            const children = byParent.get(entry.job.id) ?? []
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push({job: children[index], visited: false})
            }
        }
        for (const job of ordered) {
            let current = this.#store.getJob(job.id)
            if (current.status === "paused" || current.status === "queued") {
                current = this.#store.transitionJob(current.id, "running")
            }
            if (!TERMINAL_JOB_STATUSES.has(current.status)) {
                if (typeof this.#engine.expireApprovals === "function") {
                    await this.#engine.expireApprovals(current.id)
                }
                await this.#engine.reconcile(job.id)
            }
        }
        const steps = ordered.flatMap((job) => this.#store.listSteps({jobId: job.id}))
        const approvals = ordered.flatMap((job) => this.#store.listApprovals(job.id))
        const pendingApprovals = approvals.filter((approval) => approval.status === "pending")
        const pendingStepIds = new Set(pendingApprovals.map((approval) => approval.stepId))
        const invalidPendingApproval = pendingApprovals.some((approval) => (
            approval.stepId === null ||
            this.#store.getStep(approval.stepId).status !== "waiting_approval"
        ))
        const unresolvedWaitingStep = steps.some((step) => (
            step.status === "waiting_approval" && !pendingStepIds.has(step.id)
        ))
        const hasUnknownRecovery = invalidPendingApproval || unresolvedWaitingStep || ordered.some((job) => (
            this.#store.getJob(job.id).status === "needs_recovery" ||
            this.#store.listSteps({jobId: job.id}).some((step) => step.status === "needs_recovery")
        ))
        let recoveredParent = this.#store.getJob(parentJob.id)
        if (hasUnknownRecovery) {
            if (recoveredParent.status === "running") {
                recoveredParent = this.#store.transitionJob(recoveredParent.id, "needs_recovery")
            }
            throw new Error("Operator session cannot resume while needs_recovery")
        }
        if (pendingApprovals.length > 0) {
            if (recoveredParent.status === "running") {
                this.#store.transitionJob(recoveredParent.id, "waiting_approval")
            }
        } else if (recoveredParent.status === "waiting_approval") {
            this.#store.transitionJob(recoveredParent.id, "running")
        }
        return {pendingApproval: pendingApprovals.length > 0}
    }

    async #restore(sessionId) {
        if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
        const session = this.#store.getSession(sessionId)
        const parents = this.#store.listJobs({sessionId: session.id, parentJobId: null})
        if (parents.length !== 1) throw new Error("Operator session must have exactly one parent Job")
        let parentJob = parents[0]
        if (TERMINAL_JOB_STATUSES.has(parentJob.status)) throw new Error("Operator session is stopped")
        const configuration = sessionConfiguration(session)
        if (!configuration || configuration.protocol !== OPERATOR_PROTOCOL) {
            throw new Error("Operator session has no supported durable configuration")
        }
        if (isIterationBudget(configuration.budget)) {
            const used = session.transcript.filter((entry) => (
                entry.kind === "operator_iteration_started"
            )).length
            if (used >= configuration.budget.maxIterations) {
                if (parentJob.status === "running") {
                    parentJob = this.#store.transitionJob(parentJob.id, "paused")
                }
                if (!session.transcript.some((entry) => (
                    entry.kind === "operator_iteration_limit_reached" &&
                    entry.used === used &&
                    entry.limit === configuration.budget.maxIterations
                ))) {
                    this.#store.appendSessionTranscript(session.id, {
                        kind: "operator_iteration_limit_reached",
                        used,
                        limit: configuration.budget.maxIterations,
                        reason: "max_iterations_reached",
                    })
                }
                if (parentJob.status === "paused") return this.get(sessionId)
            }
        }
        const wasSessionPaused = sessionIsPaused(session)
        const recovery = await this.#reconcile(session, parentJob)
        if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
        parentJob = this.#store.getJob(parentJob.id)
        if (parentJob.status === "paused") parentJob = this.#store.transitionJob(parentJob.id, "running")
        if (parentJob.status === "queued") parentJob = this.#store.transitionJob(parentJob.id, "running")
        if (parentJob.status === "waiting_approval" && recovery.pendingApproval) {
            if (wasSessionPaused) {
                this.#store.appendSessionTranscript(session.id, {kind: "operator_session_resumed"})
            }
            return this.get(sessionId)
        }
        if (parentJob.status !== "running" && parentJob.status !== "waiting_approval") {
            throw new Error(`Operator session cannot resume while ${parentJob.status}`)
        }

        const runtime = await this.#runtimeById(session.runtime.runtimeId)
        if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
        const context = protocolSnapshot({
            actions: configuration.actions,
            scope: configuration.scopes,
            budget: configuration.budget,
            transport: configuration.transport,
        })
        const managedWorkspace = await this.#managedWorkspace(
            configuration.managedSkillBinding,
            context.scope,
            {persisted: configuration.managedSkillBinding !== undefined},
        )
        const authority = await this.#authority({
            sessionId: session.id,
            actions: context.actions,
            scopes: context.scope,
            budget: context.budget,
            expiresInMs: capabilityLifetime({}, context.budget),
        })
        this.#store.appendSessionTranscript(session.id, {
            kind: "operator_authority_issued",
            capabilityId: authority.grant.id,
        })
        if (this.#blockedSessions.has(sessionId)) {
            await this.#capabilities.revoke(authority.grant.id)
            this.#revokedCapabilities.add(authority.grant.id)
            throw new Error("Operator session is stopped")
        }
        let frozen
        try {
            frozen = await this.#freezeTransport(
                runtime,
                authority,
                configuration.frozenTransport ?? context.transport,
            )
            if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
        } catch (error) {
            await bestEffort(() => this.#capabilities.revoke(authority.grant.id))
            throw error
        }
        const control = this.#createControl({
            session,
            parentJob,
            runtime,
            modelId: session.modelId,
            effort: session.effort,
            authority,
            ...frozen,
            scope: context.scope,
            actions: context.actions,
            budget: context.budget,
            nativeResume: configuration.nativeResume === true,
            managedSkillBinding: managedWorkspace.binding,
            workspaceRoot: managedWorkspace.workspaceRoot,
        })
        try {
            control.client = this.#runtimeRegistry.createClient(runtime, this.#clientOptions(control))
            if (!control.client || typeof control.client.start !== "function" || typeof control.client.startThread !== "function" || typeof control.client.startTurn !== "function") {
                throw new Error("Operator Runtime client is incomplete")
            }
            this.#controls.set(session.id, control)
            this.#registerExecutor(control)
            this.#attach(control)
            const restorationGeneration = control.controlGeneration
            await control.client.start()
            this.#assertControlOwned(control, restorationGeneration)
            const priorThreadId = latestRuntimeThread(session)
            if (control.nativeResume && priorThreadId && typeof control.client.resumeThread === "function") {
                try {
                    const resumed = await control.client.resumeThread(priorThreadId, this.#threadOptions(control))
                    this.#assertControlOwned(control, restorationGeneration)
                    control.runtimeThreadId = runtimeThreadId(resumed)
                    this.#hiddenThreadIds.add(control.runtimeThreadId)
                    control.phase = "idle"
                    this.#append(control, "runtime_thread_resumed", {
                        runtimeThreadId: control.runtimeThreadId,
                        capabilityId: authority.grant.id,
                    })
                    await this.#nameRuntimeThread(control, configuration.title)
                } catch (error) {
                    this.#assertControlOwned(control, restorationGeneration)
                    if (!nativeResumeUnavailable(error)) throw error
                    control.nativeResume = false
                }
            }
            if (!control.runtimeThreadId) {
                const started = await control.client.startThread(this.#threadOptions(control))
                this.#assertControlOwned(control, restorationGeneration)
                control.runtimeThreadId = runtimeThreadId(started)
                this.#hiddenThreadIds.add(control.runtimeThreadId)
                this.#append(control, "runtime_thread_started", {
                    runtimeThreadId: control.runtimeThreadId,
                    capabilityId: authority.grant.id,
                    checkpointResume: true,
                })
                await this.#nameRuntimeThread(control, configuration.title)
                const jobs = this.#store.listJobs({sessionId: session.id})
                const jobIds = new Set(jobs.map((job) => job.id))
                const artifacts = this.#store.read().artifacts.filter((artifact) => jobIds.has(artifact.jobId))
                const checkpoint = safeCheckpoint(parentJob, artifacts)
                this.#append(control, "environment", {content: checkpoint})
                await this.#startTurn(control, buildOperatorInitialInput({
                    actions: context.actions,
                    scope: context.scope,
                    budget: context.budget,
                    transport: publicSelection(frozen.selection),
                }, checkpoint))
            }
            if (control.phase === "idle" && control.boundaryQueue.length > 0) {
                queueMicrotask(() => void this.#drainBoundary(control))
            }
            if (wasSessionPaused) this.#append(control, "operator_session_resumed", {})
            return this.#snapshot(control)
        } catch (error) {
            control.stopped = true
            control.executorLease?.unregister()
            this.#detach(control)
            await bestEffort(() => control.client?.stop?.())
            this.#controls.delete(session.id)
            await bestEffort(() => this.#capabilities.revoke(authority.grant.id))
            const outcomeUnknown = this.#store.listSteps({jobId: parentJob.id})
                .some((step) => step.status === "running")
            if (!outcomeUnknown) {
                await bestEffort(() => Promise.resolve(this.#store.appendSessionTranscript(session.id, {
                    kind: "operator_session_needs_resume",
                    reason: "resume_failure",
                })))
            }
            if (!TERMINAL_JOB_STATUSES.has(this.#store.getJob(parentJob.id).status)) {
                await bestEffort(() => Promise.resolve(
                    typeof this.#engine.interrupt === "function"
                        ? this.#engine.interrupt(parentJob.id, {
                              code: "OPERATOR_RESUME_FAILED",
                              message: "Operator Runtime resume failed",
                          })
                        : this.#store.interruptJob(parentJob.id, {
                              code: "OPERATOR_RESUME_FAILED",
                              message: "Operator Runtime resume failed",
                          }),
                ))
            }
            throw error
        }
    }

    async #resume(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        if (this.#blockedSessions.has(id)) throw new Error("Operator session is stopped")
        const control = this.#controls.get(id)
        if (!control) return this.#restore(id)
        if (control.failureCleanup) {
            await this.#retryRuntimeFailureCleanup(control)
            if (this.#blockedSessions.has(id)) throw new Error("Operator session is stopped")
            return this.#restore(id)
        }
        if (control.stopped) throw new Error("Operator session is stopped")
        if (control.paused) {
            const iteration = this.#iterationState(control)
            if (control.phase === "idle" && iteration?.used >= iteration?.limit) {
                return this.#snapshot(control)
            }
            const parent = this.#store.getJob(control.parentJobId)
            if (parent.status === "paused") this.#store.transitionJob(parent.id, "running")
            else if (parent.status !== "waiting_approval") {
                throw new Error("Operator pause state is inconsistent")
            }
            control.paused = false
            control.controlGeneration += 1
            this.#syncExecutorLease(control)
            this.#append(control, "operator_session_resumed", {})
            void this.#drainBoundary(control)
        }
        return this.#snapshot(control)
    }

    resume(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        const existing = this.#resumeFlights.get(id)
        if (existing) return existing
        const operation = this.#resume(id)
        let shared
        shared = operation.finally(() => {
            if (this.#resumeFlights.get(id) === shared) this.#resumeFlights.delete(id)
        })
        this.#resumeFlights.set(id, shared)
        return shared
    }

    restart(sessionId) {
        return this.resume(sessionId)
    }

    resumeAfterApproval(sessionId) {
        return this.resume(sessionId)
    }

    #requiredStopOperation(label, operation, onSuccess = null) {
        let result
        try {
            result = operation()
        } catch (error) {
            result = Promise.reject(error)
        }
        return {
            label,
            promise: Promise.resolve(result).then((value) => {
                onSuccess?.(value)
                return value
            }),
        }
    }

    #turnInterruptionOperation(control, progress) {
        if (!progress?.turnTarget || progress.turnSettled) return null
        const {runtimeThreadId, turnId} = progress.turnTarget
        return this.#requiredStopOperation(
            "interrupt Runtime turn",
            async () => {
                if (typeof control.client?.interruptTurn !== "function") {
                    throw new Error("Operator Runtime turn cannot be interrupted")
                }
                try {
                    await control.client.interruptTurn(runtimeThreadId, turnId)
                } catch (error) {
                    if (!turnInterruptionConverged(error)) throw error
                }
            },
            () => { progress.turnSettled = true },
        )
    }

    async #performStop(id, session, parent, control) {
        const required = []
        if (control?.failureCleanup) {
            required.push(this.#requiredStopOperation(
                "settle failed Runtime cleanup",
                () => this.#retryRuntimeFailureCleanup(control),
            ))
        }
        const capabilityIds = new Set([latestCapabilityId(session)])
        if (control) capabilityIds.add(control.authority.grant.id)
        for (const capabilityId of capabilityIds) {
            if (control?.failureCleanup && capabilityId === control.authority.grant.id) continue
            if (this.#revokedCapabilities.has(capabilityId)) continue
            required.push(this.#requiredStopOperation(
                `revoke ${capabilityId}`,
                () => this.#capabilities.revoke(capabilityId),
                () => this.#revokedCapabilities.add(capabilityId),
            ))
        }
        if (!TERMINAL_JOB_STATUSES.has(this.#store.getJob(parent.id).status)) {
            required.push(this.#requiredStopOperation(
                `cancel ${parent.id}`,
                () => this.#engine.cancel(parent.id),
            ))
        }
        const turnInterruption = control?.failureCleanup
            ? null
            : this.#turnInterruptionOperation(control, control?.stopProgress)
        if (turnInterruption) required.push(turnInterruption)
        const resumeFlight = this.#resumeFlights.get(id)
        if (resumeFlight) {
            required.push(this.#requiredStopOperation(
                "settle in-flight resume",
                () => Promise.resolve(resumeFlight).then(() => undefined, () => undefined),
            ))
        }

        const settled = await Promise.allSettled(required.map((entry) => entry.promise))
        const failures = settled.flatMap((entry, index) => (
            entry.status === "rejected"
                ? [Object.assign(
                      new Error(`${required[index].label}: ${entry.reason?.message ?? "failed"}`),
                      {cause: entry.reason},
                  )]
                : []
        ))
        if (
            control &&
            !control.failureCleanup &&
            control.stopProgress?.turnSettled &&
            !control.clientStopped
        ) {
            const clientStop = this.#requiredStopOperation(
                "stop Runtime client",
                () => {
                    if (typeof control.client?.stop !== "function") {
                        throw new Error("Operator Runtime client cannot be stopped")
                    }
                    return control.client.stop()
                },
                () => { control.clientStopped = true },
            )
            const [clientResult] = await Promise.allSettled([clientStop.promise])
            if (clientResult.status === "rejected") {
                failures.push(Object.assign(
                    new Error(`${clientStop.label}: ${clientResult.reason?.message ?? "failed"}`),
                    {cause: clientResult.reason},
                ))
            }
        }
        const refreshed = this.#store.getSession(id)
        const lateCapabilityId = latestCapabilityId(refreshed)
        if (
            !capabilityIds.has(lateCapabilityId) &&
            !this.#revokedCapabilities.has(lateCapabilityId)
        ) {
            const late = this.#requiredStopOperation(
                `revoke ${lateCapabilityId}`,
                () => this.#capabilities.revoke(lateCapabilityId),
                () => this.#revokedCapabilities.add(lateCapabilityId),
            )
            const lateResult = await Promise.allSettled([late.promise])
            if (lateResult[0].status === "rejected") {
                failures.push(Object.assign(
                    new Error(`revoke ${lateCapabilityId}: ${lateResult[0].reason?.message ?? "failed"}`),
                    {cause: lateResult[0].reason},
                ))
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(
                failures,
                `Operator stop incomplete: ${failures.map((failure) => failure.message).join("; ")}`,
            )
        }
        const stoppedParent = this.#store.getJob(parent.id)
        if (!TERMINAL_JOB_STATUSES.has(parent.status) && stoppedParent.status !== "cancelled") {
            throw new Error("Operator parent Job was not cancelled")
        }
        if (control && !control.clientStopped) {
            throw new Error("Operator Runtime client did not stop")
        }
        let snapshot
        if (control) {
            this.#append(control, "operator_session_stopped", {})
            snapshot = this.#snapshot(control)
            if (this.#controls.get(id) === control) this.#controls.delete(id)
        } else {
            snapshot = this.get(id)
        }
        return snapshot
    }

    stop(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        const existingStop = this.#stopPromises.get(id)
        if (existingStop) return existingStop
        this.#blockedSessions.add(id)
        const control = this.#controls.get(id)
        const session = this.#store.getSession(id)
        const parent = this.#store.listJobs({sessionId: session.id, parentJobId: null})[0]
        if (!parent) throw new Error("Operator parent Job is missing")
        if (control) {
            if (!control.stopProgress) {
                const turnTarget = activeTurnTarget(control)
                control.stopProgress = {
                    turnTarget,
                    turnSettled: turnTarget === null,
                }
            }
            control.stopped = true
            control.phase = "stopping"
            control.controlGeneration += 1
            control.generation += 1
            control.boundaryQueue.length = 0
            control.pendingChildIds.clear()
            control.executorLease?.disable()
            control.executorLease?.unregister()
            this.#abortInteractions(control)
            this.#detach(control)
        }
        const operation = this.#performStop(id, session, parent, control)
        let shared
        shared = operation.catch((error) => {
            if (this.#stopPromises.get(id) === shared) this.#stopPromises.delete(id)
            throw error
        })
        this.#stopPromises.set(id, shared)
        return shared
    }

    async #suspendWaitingApproval(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        const session = this.#store.getSession(id)
        const parent = this.#store.listJobs({sessionId: session.id, parentJobId: null})[0]
        if (!parent || parent.status !== "waiting_approval") {
            throw new Error("Operator session has no waiting approval to preserve")
        }
        const control = this.#controls.get(id)
        if (!control) {
            this.#blockedSessions.add(id)
            return this.get(id)
        }
        await this.pause(id)
        this.#blockedSessions.add(id)
        control.stopped = true
        control.phase = "stopping"
        control.controlGeneration += 1
        control.generation += 1
        control.executorLease?.disable()
        control.executorLease?.unregister()
        this.#abortInteractions(control)
        this.#detach(control)
        const capabilityIds = new Set([
            latestCapabilityId(session),
            control.authority.grant.id,
        ])
        const operations = []
        for (const capabilityId of capabilityIds) {
            if (this.#revokedCapabilities.has(capabilityId)) continue
            operations.push(this.#requiredStopOperation(
                `revoke ${capabilityId}`,
                () => this.#capabilities.revoke(capabilityId),
                () => this.#revokedCapabilities.add(capabilityId),
            ))
        }
        operations.push(this.#requiredStopOperation(
            "stop Runtime client",
            () => control.client?.stop?.(),
            () => { control.clientStopped = true },
        ))
        const settled = await Promise.allSettled(operations.map((entry) => entry.promise))
        const failures = settled.flatMap((entry, index) => (
            entry.status === "rejected"
                ? [Object.assign(
                      new Error(`${operations[index].label}: ${entry.reason?.message ?? "failed"}`),
                      {cause: entry.reason},
                  )]
                : []
        ))
        if (failures.length > 0) {
            throw new AggregateError(failures, "Operator waiting-approval shutdown was incomplete")
        }
        this.#append(control, "operator_session_suspended", {reason: "app_shutdown"})
        const snapshot = this.#snapshot(control)
        if (this.#controls.get(id) === control) this.#controls.delete(id)
        return snapshot
    }

    async stopAll(options = {}) {
        const preserveWaitingApprovals = options?.preserveWaitingApprovals === true
        const sessionIds = new Set([
            ...this.#controls.keys(),
            ...this.#resumeFlights.keys(),
            ...this.#stopPromises.keys(),
        ])
        for (const session of this.#store.listSessions()) {
            const parent = this.#store.listJobs({sessionId: session.id, parentJobId: null})[0]
            if (parent && !TERMINAL_JOB_STATUSES.has(parent.status)) sessionIds.add(session.id)
        }
        const operations = [...sessionIds].map((sessionId) => {
            const session = this.#store.getSession(sessionId)
            const parent = this.#store.listJobs({sessionId: session.id, parentJobId: null})[0]
            return preserveWaitingApprovals && parent?.status === "waiting_approval"
                ? this.#suspendWaitingApproval(sessionId)
                : this.stop(sessionId)
        })
        const settled = await Promise.allSettled(operations)
        const failures = settled.flatMap((entry) => (
            entry.status === "rejected" ? [entry.reason] : []
        ))
        if (failures.length > 0) throw new AggregateError(failures, "Operator stopAll incomplete")
    }
}

module.exports = {
    MAX_BOUNDARY_TEXT,
    MAX_PENDING_BOUNDARIES,
    MAX_TRANSCRIPT_TEXT,
    OperatorSessionManager,
}
