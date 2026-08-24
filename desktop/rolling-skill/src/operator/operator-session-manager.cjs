const {createHash, randomUUID} = require("node:crypto")

const {
    OPERATOR_PROTOCOL,
    buildOperatorInitialInput,
    protocolSnapshot,
    serializeOperatorInput,
} = require("./operator-protocol.cjs")
const {
    OperatorToolTransport,
    redactOperatorSecrets,
} = require("./operator-tool-transport.cjs")
const {
    controlDefinition,
    createPublicControlError,
} = require("../control-plane/contracts.cjs")

const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"])
const MAX_TRANSCRIPT_TEXT = 32 * 1_024
const MAX_BOUNDARY_TEXT = 16 * 1_024
const MAX_PENDING_BOUNDARIES = 1_000
const MAX_ITEM_IDS = 10_000
const MAX_CAPABILITY_LIFETIME_MS = 24 * 60 * 60 * 1_000

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
    return {
        maxRuntimeTurns: budget.maxRuntimeTurns,
        maxEvaluations: budget.maxEvaluations,
    }
}

function capabilityLifetime(input, budget) {
    const requested = input.expiresInMs ?? Math.max(60_000, budget.maxDurationMs)
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
    if (!["codex-dynamic", "acp-mcp", "cli"].includes(selection.kind)) {
        throw new Error("Operator Tool transport selection is invalid")
    }
    const output = {
        kind: selection.kind,
        ready: true,
        descriptor: operatorRuntime(runtime),
        support: {
            dynamicToolsReady: support?.dynamicToolsReady === true,
            mcpServersReady: support?.mcpServersReady === true,
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
    #traceDirectory
    #controls = new Map()
    #resumeFlights = new Map()
    #stopPromises = new Map()
    #blockedSessions = new Set()

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
        this.#traceDirectory = traceDirectory
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

    async #authority({actions, scopes, budget, expiresInMs}) {
        const authoritySessionId = `operator-${randomUUID()}`
        const grant = await this.#capabilities.issue({
            sessionId: authoritySessionId,
            actions: clone(actions, "Operator actions"),
            scopes: clone(scopes, "Operator scopes"),
            expiresInMs,
            budget: capabilityBudget(budget),
        })
        const expectedBudget = capabilityBudget(budget)
        const invalid = (
            !plainObject(grant) || typeof grant.id !== "string" || grant.id.length === 0 ||
            typeof grant.token !== "string" || grant.token.length === 0 ||
            grant.sessionId !== authoritySessionId ||
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
        return {grant, authoritySessionId}
    }

    #childEnvironment(authority) {
        return {
            ROLLING_SKILL_CONTROL_SOCKET: this.#controlSocketPath,
            ROLLING_SKILL_CONTROL_TOKEN: authority.grant.token,
            ROLLING_SKILL_OPERATOR_SESSION: authority.authoritySessionId,
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

    #controlIsLive(control, generation = control.controlGeneration) {
        return (
            this.#controls.get(control.sessionId) === control &&
            !control.stopped &&
            !control.paused &&
            control.controlGeneration === generation &&
            (control.phase === "starting" || control.phase === "active")
        )
    }

    #registerExecutor(control, replace = undefined) {
        const registration = {
            sessionId: control.authority.authoritySessionId,
            capabilityId: control.authority.grant.id,
            budgetSnapshot: () => this.#budgetSnapshot(control),
            assertLive: () => this.#controlIsLive(control),
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
            })
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
            client: null,
            runtimeThreadId: null,
            turnId: null,
            phase: "idle",
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
        return {
            ...(this.#workspaceRoot ? {workspaceRoot: this.#workspaceRoot} : {}),
            ...(this.#traceDirectory ? {traceDirectory: this.#traceDirectory} : {}),
            childEnvironment: {...control.childEnvironment},
            nonInteractive: false,
            requestTool: (request) => this.#requestTool(control, request),
            requestPermission: (request) => this.#permission(control, request),
            requestQuestion: (request) => this.#question(control, request),
        }
    }

    #attach(control) {
        const client = control.client
        control.notification = (message) => this.#notification(control, message)
        control.runtimeError = (error) => this.#runtimeFailure(control, error)
        control.stateListener = (state) => {
            if (state?.status === "error" || state?.status === "stopped") {
                this.#runtimeFailure(control, new Error("Operator Runtime stopped unexpectedly"))
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
                if (typeof turnId === "string" && turnId.length > 0) control.turnId = turnId
                control.phase = "active"
                this.#append(control, "turn_started", {turnId: control.turnId})
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
                if (control.turnId && turnId && control.turnId !== turnId) return
                if (typeof turnId === "string") {
                    if (control.completedTurnIds.size >= 100) {
                        control.completedTurnIds.delete(control.completedTurnIds.values().next().value)
                    }
                    control.completedTurnIds.add(turnId)
                }
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
            this.#runtimeFailure(control, error)
        }
    }

    #runtimeFailure(control, error) {
        if (control.failurePromise || control.stopped) return control.failurePromise
        control.stopped = true
        control.controlGeneration += 1
        control.generation += 1
        control.phase = "failed"
        control.executorLease?.disable()
        control.executorLease?.unregister()
        this.#abortInteractions(control)
        try {
            this.#append(control, "runtime_error", {error: errorRecord(error)})
        } catch {}
        this.#detach(control)
        let interrupted
        try {
            interrupted = typeof this.#engine.interrupt === "function"
                ? this.#engine.interrupt(control.parentJobId, {
                      code: "OPERATOR_RUNTIME_FAILED",
                      message: "Operator Runtime failed",
                  })
                : this.#store.interruptJob(control.parentJobId, {
                      code: "OPERATOR_RUNTIME_FAILED",
                      message: "Operator Runtime failed",
                  })
        } catch (failure) {
            interrupted = Promise.reject(failure)
        }
        let revoked
        try {
            revoked = this.#capabilities.revoke(control.authority.grant.id)
        } catch (failure) {
            revoked = Promise.reject(failure)
        }
        let stopped
        try {
            stopped = control.client?.stop?.()
        } catch (failure) {
            stopped = Promise.reject(failure)
        }
        control.failurePromise = Promise.allSettled([
            Promise.resolve(interrupted),
            Promise.resolve(revoked),
            Promise.resolve(stopped),
        ]).then(() => {
            if (this.#controls.get(control.sessionId) === control) {
                this.#controls.delete(control.sessionId)
            }
        })
        return control.failurePromise
    }

    async #startTurn(control, input) {
        if (control.stopped) throw new Error("Operator session is stopped")
        if (control.paused) throw new Error("Operator session is paused")
        if (control.phase !== "idle") throw new Error("Operator Runtime turn is already active")
        const generation = ++control.generation
        control.phase = "starting"
        try {
            const response = await control.client.startTurn(
                control.runtimeThreadId,
                serializeOperatorInput(input),
                this.#profile(control),
            )
            if (control.generation !== generation || control.stopped) return response
            const turnId = response?.turn?.id ?? null
            if (typeof turnId === "string" && turnId.length > 0) control.turnId = turnId
            if (!control.completedTurnIds.has(turnId)) control.phase = "active"
            else {
                control.turnId = null
                control.phase = "idle"
                queueMicrotask(() => void this.#drainBoundary(control))
            }
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
        if (control.paused) throw new Error("Operator session is paused; new Steps are disabled")
        if (control.phase !== "active" && control.phase !== "starting") {
            throw new Error("Operator Tool call is outside an active Runtime turn")
        }
        if (!plainObject(request) || !plainObject(request.params)) throw new TypeError("Operator Tool request is invalid")
        const method = methodName(request.method)
        const callId = requiredText(request.callId, "Operator Tool call id", 500)
        try {
            const result = await this.#controlPlane.invoke({
                token: control.authority.grant.token,
                sessionId: control.authority.authoritySessionId,
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

    async create(input = {}) {
        if (!plainObject(input)) throw new TypeError("Operator session request is invalid")
        const runtime = await this.#runtimeById(input.runtimeId)
        const modelId = selectedModel(runtime, input.modelId)
        const effort = selectedEffort(runtime, input.effort)
        const objective = messageText(input.objective, "Operator objective")
        const context = protocolSnapshot({
            actions: input.actions,
            scope: input.scopes,
            budget: input.budget,
            transport: {kind: "codex-dynamic", ready: true},
        })
        const expiresInMs = capabilityLifetime(input, context.budget)
        const authority = await this.#authority({
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
            })
            this.#append(control, "operator_authority_issued", {
                capabilityId: authority.grant.id,
            })
            this.#append(control, "message", {role: "user", content: objective})
            await control.client.start()
            const thread = await control.client.startThread(this.#threadOptions(control))
            control.runtimeThreadId = runtimeThreadId(thread)
            this.#append(control, "runtime_thread_started", {runtimeThreadId: control.runtimeThreadId})
            parentJob = this.#store.transitionJob(parentJob.id, "running")
            await this.#startTurn(control, buildOperatorInitialInput(protocolContext, objective))
            return this.#snapshot(control)
        } catch (error) {
            if (control) {
                control.stopped = true
                control.executorLease?.unregister()
                this.#detach(control)
                await bestEffort(() => control.client?.stop?.())
                this.#controls.delete(control.sessionId)
            }
            if (parentJob) {
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
            state: TERMINAL_JOB_STATUSES.has(parentJob.status) ? "stopped" : parentJob.status,
        }
    }

    async followUp(sessionId, text) {
        const control = this.#control(sessionId)
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
            await this.#startTurn(control, boundary.input)
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
            this.#runtimeFailure(control, error)
        }
        finally {
            control.draining = false
            if (control.phase === "idle" && control.boundaryQueue.length > 0) {
                queueMicrotask(() => void this.#drainBoundary(control))
            }
        }
    }

    async notifyChildCompletion(sessionId, childJobId) {
        const control = this.#control(sessionId)
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
                } else if (parent.status !== "paused") {
                    throw new Error(`Operator session cannot pause while ${parent.status}`)
                }
                control.paused = true
                this.#append(control, "operator_session_paused", {})
            } catch (error) {
                control.executorLease?.enable()
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
            if (!TERMINAL_JOB_STATUSES.has(this.#store.getJob(job.id).status)) {
                await this.#engine.reconcile(job.id)
            }
        }
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
        await this.#reconcile(session, parentJob)
        if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
        parentJob = this.#store.getJob(parentJob.id)
        if (parentJob.status === "paused") parentJob = this.#store.transitionJob(parentJob.id, "running")
        if (parentJob.status === "queued") parentJob = this.#store.transitionJob(parentJob.id, "running")
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
        const authority = await this.#authority({
            actions: context.actions,
            scopes: context.scope,
            budget: context.budget,
            expiresInMs: capabilityLifetime({}, context.budget),
        })
        this.#store.appendSessionTranscript(session.id, {
            kind: "operator_authority_issued",
            capabilityId: authority.grant.id,
        })
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
        })
        try {
            control.client = this.#runtimeRegistry.createClient(runtime, this.#clientOptions(control))
            if (!control.client || typeof control.client.start !== "function" || typeof control.client.startThread !== "function" || typeof control.client.startTurn !== "function") {
                throw new Error("Operator Runtime client is incomplete")
            }
            this.#controls.set(session.id, control)
            this.#registerExecutor(control)
            this.#attach(control)
            await control.client.start()
            if (this.#blockedSessions.has(sessionId)) throw new Error("Operator session is stopped")
            const priorThreadId = latestRuntimeThread(session)
            if (control.nativeResume && priorThreadId && typeof control.client.resumeThread === "function") {
                try {
                    const resumed = await control.client.resumeThread(priorThreadId, this.#threadOptions(control))
                    control.runtimeThreadId = runtimeThreadId(resumed)
                    this.#append(control, "runtime_thread_resumed", {
                        runtimeThreadId: control.runtimeThreadId,
                        capabilityId: authority.grant.id,
                    })
                } catch (error) {
                    if (!nativeResumeUnavailable(error)) throw error
                    control.nativeResume = false
                }
            }
            if (!control.runtimeThreadId) {
                const started = await control.client.startThread(this.#threadOptions(control))
                control.runtimeThreadId = runtimeThreadId(started)
                this.#append(control, "runtime_thread_started", {
                    runtimeThreadId: control.runtimeThreadId,
                    capabilityId: authority.grant.id,
                    checkpointResume: true,
                })
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
            return this.#snapshot(control)
        } catch (error) {
            control.stopped = true
            control.executorLease?.unregister()
            this.#detach(control)
            await bestEffort(() => control.client?.stop?.())
            this.#controls.delete(session.id)
            await bestEffort(() => this.#capabilities.revoke(authority.grant.id))
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
        if (control.stopped) throw new Error("Operator session is stopped")
        if (control.paused) {
            const parent = this.#store.getJob(control.parentJobId)
            if (parent.status !== "paused") throw new Error("Operator pause state is inconsistent")
            this.#store.transitionJob(parent.id, "running")
            control.paused = false
            control.controlGeneration += 1
            if (control.executorLease?.enable() !== true) {
                throw new Error("Operator executor lease is unavailable")
            }
            this.#append(control, "operator_session_resumed", {})
            void this.#drainBoundary(control)
        }
        return this.#snapshot(control)
    }

    resume(sessionId) {
        const id = requiredText(sessionId, "Operator session id")
        const existing = this.#resumeFlights.get(id)
        if (existing) return existing
        const flight = this.#resume(id)
        this.#resumeFlights.set(id, flight)
        return flight.finally(() => {
            if (this.#resumeFlights.get(id) === flight) this.#resumeFlights.delete(id)
        })
    }

    restart(sessionId) {
        return this.resume(sessionId)
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
        if (control && !control.stopped) {
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
        const capabilityIds = new Set([latestCapabilityId(session)])
        if (control) capabilityIds.add(control.authority.grant.id)
        const work = []
        for (const capabilityId of capabilityIds) {
            try {
                work.push(Promise.resolve(this.#capabilities.revoke(capabilityId)))
            } catch (error) {
                work.push(Promise.reject(error))
            }
        }
        try {
            if (!TERMINAL_JOB_STATUSES.has(parent.status)) {
                work.push(Promise.resolve(this.#engine.cancel(parent.id)))
            }
        } catch (error) {
            work.push(Promise.reject(error))
        }
        if (control?.runtimeThreadId && typeof control.client?.interruptTurn === "function") {
            try {
                work.push(Promise.resolve(
                    control.client.interruptTurn(control.runtimeThreadId, control.turnId),
                ))
            } catch (error) {
                work.push(Promise.reject(error))
            }
        }
        if (control?.client) {
            try {
                work.push(Promise.resolve(control.client.stop?.()))
            } catch (error) {
                work.push(Promise.reject(error))
            }
        }
        const stopping = Promise.allSettled(work).then(() => {
            if (control) {
                try {
                    this.#append(control, "operator_session_stopped", {})
                } catch {}
                return this.#snapshot(control)
            }
            return this.get(id)
        })
        this.#stopPromises.set(id, stopping)
        return stopping
    }

    async stopAll() {
        const sessionIds = new Set([
            ...this.#controls.keys(),
            ...this.#resumeFlights.keys(),
        ])
        await Promise.allSettled([...sessionIds].map((sessionId) => this.stop(sessionId)))
    }
}

module.exports = {
    MAX_BOUNDARY_TEXT,
    MAX_PENDING_BOUNDARIES,
    MAX_TRANSCRIPT_TEXT,
    OperatorSessionManager,
}
