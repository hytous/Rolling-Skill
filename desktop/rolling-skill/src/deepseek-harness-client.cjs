const {randomUUID} = require("node:crypto")
const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {dirname} = require("node:path")

const {evaluationTurnError} = require("./evaluation-turn-error.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")
const {
    mergeOperatorChildEnvironment,
    OperatorStreamRedactor,
    redactOperatorSecrets,
    sanitizeOperatorChildEnvironment,
} = require("./operator/operator-tool-transport.cjs")

const DEFAULT_POLL_INTERVAL_MS = 180
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const DEFAULT_STARTUP_RETRY_DELAY_MS = 50
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000
const DEFAULT_MUX_RECONNECT_DELAY_MS = 500
const MAX_MUX_RECONNECT_DELAY_MS = 5_000
const DSH_PERMISSION_MODES = new Set(["read-only", "workspace-write", "danger-full-access"])

function encodeModelId(provider, model) {
    provider = String(provider ?? "").trim()
    model = String(model ?? "").trim()
    if (!provider || !model) throw new Error("A complete DeepSeek Harness model route is required")
    return `${provider}/${model}`
}

function decodeModelId(value) {
    const text = String(value ?? "")
    const separator = text.indexOf("/")
    if (separator <= 0 || separator === text.length - 1) {
        throw new Error("DeepSeek Harness requires a provider-qualified model id")
    }
    return {provider: text.slice(0, separator), model: text.slice(separator + 1)}
}

function textBlocks(content) {
    return (content ?? [])
        .filter((block) => block?.type === "text" || block?.type === "reasoning")
        .map((block) => String(block.text ?? ""))
        .filter(Boolean)
}

function toolResultText(message) {
    const blocks = message?.content ?? []
    const output = []
    for (const block of blocks) {
        if (block?.type === "text") output.push(String(block.text ?? ""))
        if (block?.type === "tool-result") output.push(...textBlocks(block.content))
    }
    return output.filter(Boolean).join("\n")
}

function parseArguments(value) {
    try {
        const parsed = JSON.parse(String(value ?? "{}"))
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {raw: String(value ?? "")}
    }
}

function titleProjection(summary) {
    const value = summary?.projections?.values?.title
    if (typeof value === "string") return value
    if (typeof value?.title === "string") return value.title
    return ""
}

function titleFromEntries(entries) {
    return [...(entries ?? [])]
        .reverse()
        .find((entry) => entry?.event?.type === "session/title")?.event?.data?.title ?? ""
}

function modelFromEntries(entries) {
    const config = [...(entries ?? [])]
        .reverse()
        .find((entry) => entry?.event?.type === "request/header")
        ?.event?.data?.header?.config
    if (!config?.provider || !config?.model) return {model: null, effort: null}
    return {
        model: encodeModelId(config.provider, config.model),
        effort: config.reasoningEffort ?? null,
    }
}

function commandForTool(name, args) {
    if (!/^(?:bash|pwsh|shell|zsh|sh)$/i.test(String(name))) return null
    return String(args.command ?? args.cmd ?? args.script ?? args.raw ?? "")
}

function toolItem(call, result = null) {
    const args = parseArguments(call.data.arguments)
    const command = commandForTool(call.data.name, args)
    const failed = Boolean(result?.data?.error) || Boolean(
        result?.data?.message?.content?.some((block) => block?.type === "tool-result" && block.isError),
    )
    if (command !== null) {
        return {
            id: `dsh-tool-${call.data.callId}`,
            type: "commandExecution",
            command,
            status: result ? (failed ? "failed" : "completed") : "inProgress",
            ...(result ? {aggregatedOutput: toolResultText(result.data.message)} : {}),
            ...(failed ? {error: result.data.error ?? {message: "Tool execution failed"}} : {}),
        }
    }
    return {
        id: `dsh-tool-${call.data.callId}`,
        type: "dynamicToolCall",
        tool: call.data.name,
        title: call.view?.title ?? call.data.name,
        input: args,
        status: result ? (failed ? "failed" : "completed") : "inProgress",
        ...(result ? {output: toolResultText(result.data.message)} : {}),
        ...(failed ? {error: result.data.error ?? {message: "Tool execution failed"}} : {}),
    }
}

function toolCallIdFromResult(event) {
    return event?.data?.message?.content?.find(
        (block) => block?.type === "tool-result",
    )?.toolCallId ?? event?.data?.message?.source?.callId ?? null
}

function threadFromHistory({summary = {}, entries = [], workspaceRoot = null}) {
    const turns = new Map()
    const toolCalls = new Map()
    const toolResults = new Map()
    const ensureTurn = (turnNumber) => {
        if (!turns.has(turnNumber)) {
            turns.set(turnNumber, {
                id: `dsh-turn-${turnNumber}`,
                status: "inProgress",
                items: [],
            })
        }
        return turns.get(turnNumber)
    }
    let activeTurn = null
    let preview = ""

    for (const entry of entries) {
        const event = entry?.event ?? {}
        if (event.type === "turn/start") {
            activeTurn = event.data.turn
            ensureTurn(activeTurn)
            continue
        }
        const turnNumber = event.data?.turn ?? activeTurn
        if (event.type === "user/message") {
            if (event.data?.source?.kind !== "user" || turnNumber === null) continue
            const text = textBlocks(event.data.content).join("\n")
            preview ||= text.slice(0, 160)
            ensureTurn(turnNumber).items.push({
                id: event.data.id ?? `dsh-user-${event.seq}`,
                type: "userMessage",
                sourceSeq: event.seq,
                sourceMessageId: event.data.id ?? null,
                content: (event.data.content ?? [])
                    .filter((block) => block?.type === "text")
                    .map((block) => ({type: "text", text: String(block.text ?? ""), text_elements: []})),
            })
            continue
        }
        if (event.type === "tool/call") {
            toolCalls.set(event.data.callId, {...event, view: entry.view})
            if (turnNumber !== null) ensureTurn(turnNumber).items.push(toolItem({...event, view: entry.view}))
            continue
        }
        if (event.type === "tool/result") {
            const callId = event.data?.message?.content?.find(
                (block) => block?.type === "tool-result",
            )?.toolCallId ?? event.data?.message?.source?.callId
            if (callId) toolResults.set(callId, event)
            continue
        }
        if (event.type === "assistant/message") {
            const turn = ensureTurn(event.data.turn)
            const reasoning = (event.data.message?.content ?? [])
                .filter((block) => block?.type === "reasoning")
                .map((block) => String(block.text ?? ""))
                .filter(Boolean)
                .join("\n")
            const text = (event.data.message?.content ?? [])
                .filter((block) => block?.type === "text")
                .map((block) => String(block.text ?? ""))
                .filter(Boolean)
                .join("\n")
            if (reasoning) {
                turn.items.push({
                    id: `dsh-assistant-${event.data.turn}-${event.data.step}-reasoning`,
                    type: "reasoning",
                    text: reasoning,
                    summary: [reasoning],
                })
            }
            if (text) {
                turn.items.push({
                    id: `dsh-assistant-${event.data.turn}-${event.data.step}-text`,
                    type: "agentMessage",
                    sourceSeq: event.seq,
                    sourceMessageId: event.data.message?.id ?? null,
                    text,
                })
            }
            continue
        }
        if (event.type === "turn/end") {
            const turn = ensureTurn(event.data.turn)
            const kind = event.data.reason?.kind
            turn.status = kind === "completed"
                ? "completed"
                : kind === "aborted" || kind === "interrupted"
                  ? "interrupted"
                  : "failed"
            if (turn.status === "failed") {
                turn.error = {
                    message: event.data.reason?.error?.message ?? `DeepSeek Harness turn ended: ${kind ?? "unknown"}`,
                }
            }
            if (activeTurn === event.data.turn) activeTurn = null
        }
    }

    for (const turn of turns.values()) {
        turn.items = turn.items.map((item) => {
            if (!item.id?.startsWith("dsh-tool-")) return item
            const callId = item.id.slice("dsh-tool-".length)
            const call = toolCalls.get(callId)
            return call ? toolItem(call, toolResults.get(callId) ?? null) : item
        })
    }

    const model = modelFromEntries(entries)
    const name = titleFromEntries(entries) || titleProjection(summary) || preview || "DeepSeek Harness task"
    const updatedAt = Number(summary.updatedAt) > 10_000_000_000
        ? Number(summary.updatedAt) / 1000
        : Number(summary.updatedAt) || Date.now() / 1000
    return {
        id: summary.sessionId,
        name,
        preview,
        cwd: summary.cwd ?? workspaceRoot,
        model: model.model,
        effort: model.effort,
        updatedAt,
        recencyAt: updatedAt,
        status: {type: summary.running ? "active" : "idle"},
        turns: [...turns.values()].sort((left, right) =>
            Number(left.id.slice("dsh-turn-".length)) - Number(right.id.slice("dsh-turn-".length)),
        ),
        modelProvider: "deepseek-harness",
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

class DeepSeekHarnessClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        spawnProcess = spawn,
        fetchImpl = globalThis.fetch,
        webSocketFactory = null,
        executionPolicy = null,
        nonInteractive = false,
        requestPermission = null,
        requestQuestion = null,
        childEnvironment = {},
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
        startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
        startupRetryDelayMs = DEFAULT_STARTUP_RETRY_DELAY_MS,
        shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.spawnProcess = spawnProcess
        this.fetchImpl = fetchImpl
        this.webSocketFactory = webSocketFactory ?? ((url) => {
            if (typeof globalThis.WebSocket !== "function") {
                throw new Error("This app cannot open the DeepSeek Harness event stream")
            }
            return new globalThis.WebSocket(url)
        })
        this.executionPolicy = executionPolicy ?? {}
        this.nonInteractive = Boolean(nonInteractive)
        const requestedDefaultPermission =
            this.executionPolicy.permissionMode ?? this.executionPolicy.sandbox
        this.defaultPermissionMode = DSH_PERMISSION_MODES.has(requestedDefaultPermission)
            ? requestedDefaultPermission
            : "workspace-write"
        this.requestPermission = requestPermission
        this.requestQuestion = requestQuestion
        this.childEnvironment = sanitizeOperatorChildEnvironment(childEnvironment)
        this.stderrRedactor = null
        this.pollIntervalMs = pollIntervalMs
        this.startupTimeoutMs = startupTimeoutMs
        this.startupRetryDelayMs = Math.max(1, Number(startupRetryDelayMs) || DEFAULT_STARTUP_RETRY_DELAY_MS)
        this.shutdownTimeoutMs = Math.max(1, Number(shutdownTimeoutMs) || DEFAULT_SHUTDOWN_TIMEOUT_MS)
        this.child = null
        this.baseUrl = null
        this.ready = false
        this.stopping = false
        this.initialization = null
        this.recorder = null
        this.pendingTurns = new Map()
        this.catalogSessionId = null
        this.modelCatalog = null
        this.processEpoch = 0
        this.recordedEventSequences = new Map()
        this.recordedToolCalls = new Map()
        this.sessionPermissions = new Map()
        this.liveEventBuffers = new Map()
        this.muxSocket = null
        this.muxReconnectTimer = null
        this.muxReconnectAttempt = 0
        this.pendingInteractions = new Map()
        this.pendingNonInteractiveFailures = new Map()
    }

    state() {
        return {
            status: this.ready ? "ready" : this.child ? "starting" : "stopped",
            binaryPath: this.binaryPath,
            runtime: this.runtimeDescriptor,
            workspaceRoot: this.workspaceRoot,
            tracePath: this.recorder?.path ?? null,
            traceReference: this.recorder?.latestReference ?? null,
            ...(this.baseUrl ? {hostUrl: this.baseUrl} : {}),
        }
    }

    recordTrace(kind, payload) {
        this.recorder?.record(kind, redactOperatorSecrets(payload, this.childEnvironment))
    }

    emitRuntimeLog(message) {
        this.emit("runtimeLog", redactOperatorSecrets(String(message), this.childEnvironment))
    }

    publicValue(value) {
        return redactOperatorSecrets(value, this.childEnvironment)
    }

    emitStderr(output) {
        for (const value of output) {
            const text = value.trim()
            if (text) this.emitRuntimeLog(text)
        }
    }

    flushStderr() {
        if (!this.stderrRedactor) return
        const redactor = this.stderrRedactor
        this.stderrRedactor = null
        this.emitStderr(redactor.end())
    }

    async start() {
        if (this.ready) return this.state()
        if (this.initialization) return this.initialization
        this.initialization = this.startProcess().finally(() => {
            this.initialization = null
        })
        return this.initialization
    }

    async startProcess() {
        if (!this.binaryPath) throw new Error("The selected local DeepSeek Harness runtime is unavailable")
        if (typeof this.fetchImpl !== "function") throw new Error("This app cannot connect to a DeepSeek Harness Host")
        this.stopping = false
        this.catalogSessionId = null
        this.modelCatalog = null
        this.recordedEventSequences.clear()
        this.recordedToolCalls.clear()
        this.liveEventBuffers.clear()
        this.recorder = new TraceRecorder(this.traceDirectory, {
            sessionId: `deepseek-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            runtime: this.runtimeDescriptor,
        })
        const epoch = ++this.processEpoch
        const child = this.spawnProcess(
            this.binaryPath,
            ["--profile", "web", "--no-open", "--port", "0"],
            {
                cwd: this.workspaceRoot,
                env: {
                    ...mergeOperatorChildEnvironment({
                        ...process.env,
                        PATH: `${dirname(this.binaryPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
                        DSH_PERMISSION_MODE: this.defaultPermissionMode,
                    }, this.childEnvironment),
                    ROLLING_SKILL_OPERATOR_HOST: "1",
                },
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
            },
        )
        this.child = child
        this.stderrRedactor = new OperatorStreamRedactor(this.childEnvironment)
        this.emit("state", this.state())
        child.stderr.on("data", (chunk) => {
            this.emitStderr(this.stderrRedactor?.push(chunk) ?? [])
        })
        child.once("error", (error) => this.handleExit(error, child, epoch))
        child.once("close", (code, signal) => {
            this.handleExit(new Error(
                `DeepSeek Harness Host exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
            ), child, epoch)
        })

        try {
            this.baseUrl = await this.waitForHostUrl(child, epoch)
            await this.waitForHostReady(child, epoch)
            if (this.child !== child || this.processEpoch !== epoch) {
                throw new Error("DeepSeek Harness Host changed during startup")
            }
            this.ready = true
            this.openMux(child, epoch)
            this.emit("state", this.state())
            return this.state()
        } catch (error) {
            if (this.child === child) await this.terminateProcess(child)
            if (this.child === child && this.processEpoch === epoch) {
                this.handleExit(error, child, epoch)
            }
            throw error
        }
    }

    waitForHostUrl(child, epoch) {
        return new Promise((resolve, reject) => {
            let buffer = ""
            const timeout = setTimeout(() => finish(new Error("Timed out waiting for the DeepSeek Harness Host")), this.startupTimeoutMs)
            const onData = (chunk) => {
                buffer += chunk.toString("utf8")
                const match = buffer.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/i)
                if (match) finish(null, match[1])
            }
            const onClose = () => finish(new Error("DeepSeek Harness Host exited before becoming ready"))
            const finish = (error, value) => {
                clearTimeout(timeout)
                child.stdout.off("data", onData)
                child.off("close", onClose)
                if (this.child !== child || this.processEpoch !== epoch) {
                    reject(new Error("DeepSeek Harness Host changed during startup"))
                } else if (error) reject(error)
                else resolve(value)
            }
            child.stdout.on("data", onData)
            child.once("close", onClose)
        })
    }

    async waitForHostReady(child, epoch) {
        const deadline = Date.now() + this.startupTimeoutMs
        let lastError = null
        while (Date.now() < deadline) {
            if (this.child !== child || this.processEpoch !== epoch) {
                throw new Error("DeepSeek Harness Host changed during startup")
            }
            try {
                let remaining = Math.max(1, deadline - Date.now())
                const description = await this.request("host.describe", {}, {timeoutMs: remaining})
                remaining = Math.max(1, deadline - Date.now())
                this.modelCatalog = await this.request("llm.models", {}, {timeoutMs: remaining})
                return description
            } catch (error) {
                if (error?.code !== "HOST_CONNECTION_FAILED") throw error
                lastError = error
            }
            const remaining = deadline - Date.now()
            if (remaining > 0) await delay(Math.min(this.startupRetryDelayMs, remaining))
        }
        throw new Error(
            `Timed out waiting for the DeepSeek Harness Host HTTP endpoint${lastError ? `: ${lastError.message}` : ""}`,
            {cause: lastError ?? undefined},
        )
    }

    handleExit(error, child = this.child, epoch = this.processEpoch) {
        if (this.child !== child || this.processEpoch !== epoch) return
        this.flushStderr()
        this.closeMux()
        this.cancelPendingInteractions()
        this.child = null
        this.baseUrl = null
        this.ready = false
        this.modelCatalog = null
        this.pendingTurns.clear()
        this.pendingNonInteractiveFailures.clear()
        this.sessionPermissions.clear()
        const message = redactOperatorSecrets(error.message, this.childEnvironment)
        this.emit("state", {...this.state(), error: this.stopping ? null : message})
        if (!this.stopping) this.emit("runtimeError", new Error(message))
    }

    async request(method, payload = {}, {timeoutMs = null} = {}) {
        if (!this.baseUrl) throw new Error("DeepSeek Harness Host is not running")
        const rpcId = randomUUID()
        const envelope = {type: "client-request", rpcId, method, payload}
        this.recordTrace("outbound", {method, params: payload, rpcId})
        const boundedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
            ? Math.max(1, Number(timeoutMs))
            : null
        const controller = boundedTimeoutMs ? new AbortController() : null
        const timeout = controller
            ? setTimeout(() => controller.abort(), boundedTimeoutMs)
            : null
        timeout?.unref?.()
        let response
        try {
            response = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
                method: "POST",
                headers: {"content-type": "application/json", accept: "application/json"},
                body: JSON.stringify(envelope),
                ...(controller ? {signal: controller.signal} : {}),
            })
        } catch (error) {
            if (timeout) clearTimeout(timeout)
            const safeMessage = this.publicValue(error?.message ?? String(error))
            const connectionError = new Error(`DeepSeek Harness ${method} request failed: ${safeMessage}`)
            connectionError.code = "HOST_CONNECTION_FAILED"
            throw connectionError
        }
        let body
        try {
            body = await response.json()
        } catch (error) {
            if (controller?.signal.aborted) {
                const safeCause = new Error(this.publicValue(error?.message ?? String(error)))
                const connectionError = new Error(
                    `DeepSeek Harness ${method} request failed: request timed out after ${boundedTimeoutMs}ms`,
                    {cause: safeCause},
                )
                connectionError.code = "HOST_CONNECTION_FAILED"
                throw connectionError
            }
            throw new Error(`DeepSeek Harness ${method} returned an invalid response (${response.status})`)
        } finally {
            if (timeout) clearTimeout(timeout)
        }
        if (!response.ok || body?.type !== "server-response" || body.rpcId !== rpcId || !body?.result?.ok) {
            const failure = body?.result?.error ?? {}
            const safeFailure = this.publicValue(failure)
            const error = new Error(safeFailure.message ?? `DeepSeek Harness ${method} failed (${response.status})`)
            error.code = safeFailure.code ?? `HTTP_${response.status}`
            error.details = safeFailure.details ?? null
            this.recordTrace("inbound", {method, rpcId, error: failure})
            throw error
        }
        if (method !== "session.history") {
            this.recordTrace("inbound", {method, rpcId, result: body.result.value})
        }
        return this.publicValue(body.result.value)
    }

    async respond(message) {
        if (!this.baseUrl) throw new Error("DeepSeek Harness Host is not running")
        this.recordTrace("outbound", {method: "respond", rpcId: message.rpcId, params: message})
        let response
        try {
            response = await this.fetchImpl(`${this.baseUrl}/api/respond`, {
                method: "POST",
                headers: {"content-type": "application/json", accept: "application/json"},
                body: JSON.stringify(message),
            })
        } catch (error) {
            throw new Error(`DeepSeek Harness respond failed: ${this.publicValue(
                error?.message ?? String(error),
            )}`)
        }
        let receipt
        try {
            receipt = await response.json()
        } catch {
            throw new Error(`DeepSeek Harness respond returned an invalid response (${response.status})`)
        }
        if (!response.ok) throw new Error(`DeepSeek Harness respond failed (${response.status})`)
        if (receipt?.accepted === false && receipt.reason === "bad-response") {
            throw new Error("DeepSeek Harness rejected an invalid interaction response")
        }
        if (receipt?.accepted !== true && receipt?.reason !== "not-pending") {
            throw new Error("DeepSeek Harness returned an invalid interaction receipt")
        }
        this.recordTrace("inbound", {
            method: "respond",
            rpcId: message.rpcId,
            result: receipt,
        })
        return this.publicValue(receipt)
    }

    muxUrl() {
        const url = new URL("/api/events.mux", this.baseUrl)
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
        return url.toString()
    }

    openMux(child = this.child, epoch = this.processEpoch) {
        if (
            this.stopping ||
            !this.baseUrl ||
            this.child !== child ||
            this.processEpoch !== epoch ||
            this.muxSocket
        ) {
            return
        }
        let socket
        try {
            socket = this.webSocketFactory(this.muxUrl())
        } catch (error) {
            this.emitRuntimeLog(`DeepSeek Harness event stream failed: ${error?.message ?? String(error)}`)
            this.scheduleMuxReconnect(child, epoch)
            return
        }
        this.muxSocket = socket
        const isCurrent = () =>
            !this.stopping &&
            this.child === child &&
            this.processEpoch === epoch &&
            this.muxSocket === socket
        const onOpen = () => {
            if (!isCurrent()) return
            this.muxReconnectAttempt = 0
            this.recordTrace("inbound", {method: "events.mux/open", processEpoch: epoch})
            void this.recoverPendingTurns().catch((error) => {
                this.emitRuntimeLog(`DeepSeek Harness history recovery failed: ${error?.message ?? String(error)}`)
            })
        }
        const onMessage = (event) => {
            if (!isCurrent()) return
            try {
                const raw = typeof event?.data === "string"
                    ? event.data
                    : Buffer.isBuffer(event?.data)
                      ? event.data.toString("utf8")
                      : String(event?.data ?? "")
                const envelope = JSON.parse(raw)
                if (envelope?.type !== "server-request" || !envelope.rpcId || !envelope.payload?.type) {
                    throw new Error("invalid server-request envelope")
                }
                this.recordTrace("inbound", {
                    method: "events.mux",
                    rpcId: envelope.rpcId,
                    params: envelope.payload,
                })
                this.handleMuxEnvelope(envelope, epoch)
            } catch (error) {
                this.emitRuntimeLog(`DeepSeek Harness dropped an invalid event frame: ${error?.message ?? String(error)}`)
            }
        }
        const onClose = () => {
            if (this.muxSocket !== socket) return
            this.muxSocket = null
            if (!this.stopping && this.child === child && this.processEpoch === epoch) {
                this.scheduleMuxReconnect(child, epoch)
            }
        }
        const onError = (error) => {
            if (!isCurrent()) return
            const message = error?.message ?? "WebSocket connection failed"
            this.emitRuntimeLog(`DeepSeek Harness event stream error: ${message}`)
        }
        socket.addEventListener("open", onOpen)
        socket.addEventListener("message", onMessage)
        socket.addEventListener("close", onClose, {once: true})
        socket.addEventListener("error", onError)
    }

    scheduleMuxReconnect(child, epoch) {
        if (this.stopping || this.muxReconnectTimer || this.child !== child || this.processEpoch !== epoch) return
        const delayMs = Math.min(
            MAX_MUX_RECONNECT_DELAY_MS,
            DEFAULT_MUX_RECONNECT_DELAY_MS * (2 ** this.muxReconnectAttempt),
        )
        this.muxReconnectAttempt += 1
        this.muxReconnectTimer = setTimeout(() => {
            this.muxReconnectTimer = null
            this.openMux(child, epoch)
        }, delayMs)
        this.muxReconnectTimer.unref?.()
    }

    closeMux() {
        if (this.muxReconnectTimer) clearTimeout(this.muxReconnectTimer)
        this.muxReconnectTimer = null
        const socket = this.muxSocket
        this.muxSocket = null
        if (!socket) return
        try {
            socket.close(1000, "Rolling Skill stopped")
        } catch {
            // A failed or already-closed socket needs no further cleanup.
        }
    }

    bufferLiveEntry(sessionId, entry) {
        const buffer = this.liveEventBuffers.get(sessionId) ?? []
        if (!buffer.some((candidate) => candidate.event?.seq === entry.event?.seq)) buffer.push(entry)
        buffer.sort((left, right) => Number(left.event?.seq ?? -1) - Number(right.event?.seq ?? -1))
        if (buffer.length > 500) buffer.splice(0, buffer.length - 500)
        this.liveEventBuffers.set(sessionId, buffer)
    }

    handleMuxEnvelope(envelope, epoch) {
        const payload = envelope.payload
        if (payload.type === "session/event") {
            const entry = {
                event: payload.event,
                ...(payload.view ? {view: payload.view.view ?? payload.view} : {}),
            }
            this.bufferLiveEntry(payload.sessionId, entry)
            const pending = this.pendingTurns.get(payload.sessionId)
            if (pending && Number(entry.event?.seq) > pending.lastSeq) {
                this.processLiveEntries(pending, [entry])
            } else {
                this.recordHistoryEvents(payload.sessionId, [entry])
            }
            return
        }
        if (payload.type === "approval/requested" || payload.type === "question/requested") {
            if (this.pendingInteractions.has(envelope.rpcId)) return
            const controller = new AbortController()
            const token = {
                rpcId: envelope.rpcId,
                type: payload.type,
                payload,
                epoch,
                controller,
            }
            this.pendingInteractions.set(envelope.rpcId, token)
            void this.resolveInteraction(token).catch((error) => {
                if (this.pendingInteractions.get(token.rpcId) !== token) return
                this.emitRuntimeLog(`DeepSeek Harness interaction failed: ${error?.message ?? String(error)}`)
            })
            return
        }
        if (payload.type === "approval/resolved") {
            for (const token of this.pendingInteractions.values()) {
                if (token.payload.approvalId === payload.approvalId) this.finishInteraction(token)
            }
            return
        }
        if (payload.type === "question/resolved") {
            const token = this.pendingInteractions.get(payload.questionRpcId)
            if (token) this.finishInteraction(token)
        }
    }

    finishInteraction(token) {
        if (this.pendingInteractions.get(token.rpcId) !== token) return
        this.pendingInteractions.delete(token.rpcId)
        token.controller.abort()
    }

    cancelPendingInteractions() {
        for (const token of this.pendingInteractions.values()) token.controller.abort()
        this.pendingInteractions.clear()
    }

    interactionIsCurrent(token) {
        return (
            !this.stopping &&
            this.ready &&
            token.epoch === this.processEpoch &&
            this.pendingInteractions.get(token.rpcId) === token &&
            !token.controller.signal.aborted
        )
    }

    async resolveInteraction(token) {
        const {payload} = token
        let message
        if (payload.type === "approval/requested") {
            const options = [
                {optionId: "allowed-once", kind: "allow_once", name: "Allow once"},
                {optionId: "rejected", kind: "reject", name: "Reject"},
            ]
            let selected = "rejected"
            if (!this.nonInteractive && typeof this.requestPermission === "function") {
                selected = await this.requestPermission(this.publicValue({
                    processEpoch: token.epoch,
                    rpcId: token.rpcId,
                    options,
                    params: {
                        sessionId: payload.sessionId,
                        approvalId: payload.approvalId,
                        toolName: payload.toolName,
                        reason: payload.reason ?? "",
                        toolCall: {
                            name: payload.toolName,
                            rawInput: payload.reason ?? "",
                        },
                    },
                })).catch(() => "rejected")
            }
            const outcome = selected === "allowed-once" ? "allowed-once" : "rejected"
            message = {
                type: "client-response",
                rpcId: token.rpcId,
                result: {
                    ok: true,
                    value: {
                        sessionId: payload.sessionId,
                        approvalId: payload.approvalId,
                        outcome,
                    },
                },
            }
        } else {
            let answer = null
            if (!this.nonInteractive && typeof this.requestQuestion === "function") {
                const publicRequest = this.publicValue({
                    processEpoch: token.epoch,
                    rpcId: token.rpcId,
                    sessionId: payload.sessionId,
                    questions: payload.questions,
                })
                answer = await this.requestQuestion({
                    ...publicRequest,
                    signal: token.controller.signal,
                }).catch(() => null)
            }
            message = answer?.answers
                ? {
                      type: "client-response",
                      rpcId: token.rpcId,
                      result: {
                          ok: true,
                          value: {sessionId: payload.sessionId, answer},
                      },
                  }
                : {
                      type: "client-response",
                      rpcId: token.rpcId,
                      result: {
                          ok: false,
                          error: {
                              code: "cancelled",
                              message: "User cancelled the question",
                              details: {},
                          },
                      },
                  }
        }
        if (!this.interactionIsCurrent(token)) return
        let responseError = null
        try {
            await this.respond(message)
        } catch (error) {
            responseError = error
        }
        const processIsCurrent =
            !this.stopping &&
            this.ready &&
            token.epoch === this.processEpoch
        if (this.nonInteractive && processIsCurrent) {
            const error = new Error(
                payload.type === "approval/requested"
                    ? "The evaluation required an interactive permission decision"
                    : "The evaluation required an interactive user answer",
            )
            error.code = "EVALUATION_INTERACTION_REQUIRED"
            const pending = this.pendingTurns.get(payload.sessionId)
            if (pending) {
                this.failPendingTurn(pending, error)
            } else {
                this.pendingNonInteractiveFailures.set(payload.sessionId, error)
            }
            void this.request("session.cancel", {sessionId: payload.sessionId}).catch(() => {})
            this.finishInteraction(token)
        }
        if (responseError) throw responseError
    }

    async recoverPendingTurns() {
        for (const pending of this.pendingTurns.values()) {
            if (pending.stopped) continue
            const tail = await this.historyTail(pending.threadId)
            const fresh = (tail.events ?? []).filter((entry) => Number(entry.event?.seq) > pending.lastSeq)
            if (fresh.length) this.processLiveEntries(pending, fresh)
        }
    }

    async terminateProcess(child) {
        if (!child) return
        if (child.exitCode !== undefined && child.exitCode !== null) return
        if (child.signalCode !== undefined && child.signalCode !== null) return
        await new Promise((resolve) => {
            let settled = false
            let timeout = null
            const finish = () => {
                if (settled) return
                settled = true
                if (timeout) clearTimeout(timeout)
                child.off("close", finish)
                resolve()
            }
            child.once("close", finish)
            try {
                child.kill("SIGTERM")
            } catch {
                finish()
                return
            }
            if (settled) return
            timeout = setTimeout(() => {
                try {
                    child.kill("SIGKILL")
                } catch {
                    // The Host may have exited between the grace deadline and escalation.
                }
                finish()
            }, this.shutdownTimeoutMs)
            timeout.unref?.()
        })
    }

    setWorkspace(workspaceRoot) {
        this.workspaceRoot = workspaceRoot
        this.catalogSessionId = null
        this.emit("state", this.state())
    }

    async listModels() {
        const catalog = this.modelCatalog ?? await this.request("llm.models", {})
        const data = []
        for (const group of catalog.groups ?? []) {
            for (const model of group.models ?? []) {
                data.push({
                    id: encodeModelId(group.id, model.id),
                    model: encodeModelId(group.id, model.id),
                    displayName: `${model.name ?? model.id} · ${group.name ?? group.id}`,
                    isDefault: false,
                    reasoningEfforts: (model.reasoning?.efforts ?? []).map((effort) => ({
                        reasoningEffort: effort.id,
                        displayName: effort.name,
                        description: effort.description ?? null,
                    })),
                    defaultReasoningEffort: model.reasoning?.defaultEffort ?? null,
                    provider: group.id,
                })
            }
        }
        return {data, nextCursor: null, failures: catalog.failures ?? []}
    }

    async listSessionSummaries() {
        const [{items = []}, workspace] = await Promise.all([
            this.request("session.list", {}),
            this.request("workspace.list", {}).catch(() => ({items: [], archivedSessionIds: []})),
        ])
        const archived = new Set(workspace.archivedSessionIds ?? [])
        return {items, archived}
    }

    async listThreads(options = {}) {
        const {items, archived} = await this.listSessionSummaries()
        const wantsArchived = Boolean(options.archived)
        const data = items
            .filter((summary) =>
                !summary.blank &&
                (!this.workspaceRoot || summary.cwd === this.workspaceRoot) &&
                archived.has(summary.sessionId) === wantsArchived,
            )
            .map((summary) => {
                const updatedAt = Number(summary.updatedAt) > 10_000_000_000
                    ? Number(summary.updatedAt) / 1000
                    : Number(summary.updatedAt) || Date.now() / 1000
                return {
                    id: summary.sessionId,
                    name: titleProjection(summary) || "DeepSeek Harness task",
                    preview: "",
                    cwd: summary.cwd ?? this.workspaceRoot,
                    model: null,
                    updatedAt,
                    recencyAt: updatedAt,
                    status: {type: summary.running ? "active" : "idle"},
                    modelProvider: "deepseek-harness",
                    // Keep millisecond precision. The display timestamp has a
                    // fallback, which must never be used to skip source reads.
                    sourceRevision: summary.running === false && Number.isFinite(Number(summary.updatedAt)) && Number(summary.updatedAt) > 0
                        ? `dsh:${Number(summary.updatedAt)}` : null,
                }
            })
            .sort((left, right) => right.updatedAt - left.updatedAt)
        return {data, nextCursor: null}
    }

    async readHistory(sessionId, {record = false} = {}) {
        const pages = []
        let beforeSeq
        for (let page = 0; page < 50; page += 1) {
            const value = await this.request("session.history", {
                sessionId,
                maxMessages: 200,
                ...(beforeSeq === undefined ? {} : {beforeSeq}),
            })
            pages.unshift(value.events ?? [])
            if (!value.hasMore || !value.events?.length) break
            const firstSeq = value.events[0]?.event?.seq
            if (!Number.isSafeInteger(firstSeq) || firstSeq <= 0 || firstSeq === beforeSeq) break
            beforeSeq = firstSeq
        }
        const entries = pages.flat()
        if (record) this.recordHistoryEvents(sessionId, entries)
        return entries
    }

    async sessionSummary(sessionId) {
        const {items} = await this.listSessionSummaries()
        return items.find((entry) => entry.sessionId === sessionId) ?? {
            sessionId,
            updatedAt: Date.now(),
            running: this.pendingTurns.has(sessionId),
            cwd: this.workspaceRoot,
        }
    }

    async readThread(threadId) {
        const [entries, summary] = await Promise.all([
            this.readHistory(threadId, {record: true}),
            this.sessionSummary(threadId),
        ])
        const thread = threadFromHistory({summary, entries, workspaceRoot: this.workspaceRoot})
        this.recordTrace("inbound", {method: "thread/read", result: {thread}})
        return this.publicValue({thread})
    }

    async captureConversationEpisode(input) {
        if (!this.baseUrl) throw new Error("DeepSeek Harness Host is not running")
        const response = await this.fetchImpl(`${this.baseUrl}/rolling-skill/evidence`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({method: "capture", input}),
            signal: AbortSignal.timeout(30_000),
        })
        const result = await response.json()
        if (!response.ok || result?.ok !== true || !result.value?.episode) {
            throw new Error("DSH background source evidence is unavailable; check that the current Rolling Skill plugin is installed in the web profile")
        }
        return this.publicValue(result.value)
    }

    async ensureCatalogSession() {
        if (this.catalogSessionId) return this.catalogSessionId
        const {items} = await this.listSessionSummaries()
        const existing = items.find((entry) => entry.cwd === this.workspaceRoot)
        if (existing) {
            const attached = await this.request("session.create", {
                cwd: this.workspaceRoot,
                sessionId: existing.sessionId,
            })
            this.catalogSessionId = attached.sessionId
            return this.catalogSessionId
        }
        const created = await this.request("session.create", {cwd: this.workspaceRoot})
        this.catalogSessionId = created.sessionId
        return this.catalogSessionId
    }

    async listSkills() {
        const sessionId = await this.ensureCatalogSession()
        const value = await this.request("skill.list", {sessionId})
        return {
            data: [{
                cwd: this.workspaceRoot,
                skills: (value.skills ?? []).map((skill) => ({
                    name: skill.name,
                    description: skill.description,
                    whenToUse: skill.whenToUse ?? null,
                    enabled: true,
                    modelInvocable: skill.modelInvocable,
                    scope: "runtime",
                    evidencePrecision: "name-only",
                })),
            }],
            nextCursor: null,
        }
    }

    async configureSession(sessionId, options = {}) {
        const requestedPermission = options.permissionMode ?? options.sandbox
        const permissionMode = DSH_PERMISSION_MODES.has(requestedPermission)
            ? requestedPermission
            : this.defaultPermissionMode
        if (this.sessionPermissions.get(sessionId) !== permissionMode) {
            const command = await this.request("commands/execute", {
                args: {agentId: sessionId, line: `/permission ${permissionMode}`, images: []},
            })
            const result = command?.result ?? command
            if (result?.kind === "error") {
                throw new Error(result.text || `DeepSeek Harness could not select ${permissionMode}`)
            }
            this.sessionPermissions.set(sessionId, permissionMode)
        }
        if (!options.model && !options.effort) return null
        let route
        if (options.model) route = decodeModelId(options.model)
        else {
            const current = await this.request("session.models", {sessionId})
            route = {provider: current.current.provider, model: current.current.model}
        }
        const selected = await this.request("session.selectModel", {
            sessionId,
            ...route,
            ...(options.effort ? {reasoningEffort: options.effort} : {}),
        })
        this.emitNotification("thread/settings/updated", {
            threadId: sessionId,
            threadSettings: {
                model: encodeModelId(selected.selected.provider, selected.selected.model),
                effort: selected.selected.reasoningEffort ?? null,
            },
        })
        return selected.selected
    }

    async startThread(options = {}) {
        const created = await this.request("session.create", {cwd: this.workspaceRoot})
        this.sessionPermissions.set(created.sessionId, this.defaultPermissionMode)
        const selected = await this.configureSession(created.sessionId, options)
        const models = selected ? null : await this.request("session.models", {sessionId: created.sessionId})
        const current = selected ?? models?.current ?? null
        const now = Date.now() / 1000
        const thread = {
            id: created.sessionId,
            name: "New DeepSeek Harness task",
            preview: "",
            cwd: this.workspaceRoot,
            model: current ? encodeModelId(current.provider, current.model) : null,
            effort: current?.reasoningEffort ?? options.effort ?? null,
            status: {type: "idle"},
            updatedAt: now,
            recencyAt: now,
            turns: [],
            modelProvider: "deepseek-harness",
            permissionMode: this.sessionPermissions.get(created.sessionId),
            threadSource: options.threadSource ?? "user",
        }
        this.emitNotification("thread/started", {thread})
        return {thread, model: thread.model, reasoningEffort: thread.effort}
    }

    async resumeThread(threadId, options = {}) {
        await this.configureSession(threadId, options)
        return this.readThread(threadId)
    }

    turnContent(value) {
        if (!Array.isArray(value)) return [{type: "text", text: String(value)}]
        return value
            .map((part) => {
                if (part?.type === "skill") return {type: "text", text: `/${part.name}`}
                if (part?.type === "text") return {type: "text", text: String(part.text ?? "")}
                return null
            })
            .filter((part) => part?.text)
    }

    async historyTail(sessionId) {
        return this.request("session.history", {sessionId, maxMessages: 200})
    }

    async startTurn(threadId, value, options = {}) {
        await this.configureSession(threadId, options)
        const before = await this.historyTail(threadId)
        const mark = before.events?.at(-1)?.event?.seq ?? -1
        const content = this.turnContent(value)
        if (!content.length || !content.some((part) => part.text.trim())) {
            throw new Error("Task text is required")
        }
        await this.request("session.prompt", {
            sessionId: threadId,
            mode: "queue",
            content,
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })

        const deadline = Date.now() + 5_000
        let tail
        let startEvent
        while (Date.now() < deadline) {
            tail = await this.historyTail(threadId)
            startEvent = (tail.events ?? []).find(
                (entry) => entry.event?.type === "turn/start" && entry.event.seq > mark,
            )
            if (startEvent) break
            await delay(Math.min(this.pollIntervalMs, 100))
        }
        if (!startEvent) throw new Error("DeepSeek Harness accepted the prompt but did not start a turn")
        const turnNumber = startEvent.event.data.turn
        const turnId = `dsh-turn-${turnNumber}`
        const summary = {
            sessionId: threadId,
            updatedAt: Date.now(),
            running: true,
            cwd: this.workspaceRoot,
        }
        const turn = threadFromHistory({summary, entries: tail.events ?? [], workspaceRoot: this.workspaceRoot})
            .turns.find((entry) => entry.id === turnId) ?? {id: turnId, status: "inProgress", items: []}
        const pending = {
            threadId,
            turnNumber,
            turnId,
            lastSeq: startEvent.event.seq,
            entries: [...(tail.events ?? [])],
            chunks: new Map(),
            toolCalls: new Map(),
            stopped: false,
        }
        this.pendingTurns.set(threadId, pending)
        this.emitNotification("turn/started", {threadId, turn})
        const interactionFailure = this.pendingNonInteractiveFailures.get(threadId)
        if (interactionFailure) {
            this.pendingNonInteractiveFailures.delete(threadId)
            this.failPendingTurn(pending, interactionFailure)
            void this.request("session.cancel", {sessionId: threadId}).catch(() => {})
            return {turn}
        }
        const buffered = (this.liveEventBuffers.get(threadId) ?? []).filter(
            (entry) => Number(entry.event?.seq) > pending.lastSeq,
        )
        if (buffered.length) this.processLiveEntries(pending, buffered)
        return {turn}
    }

    emitNotification(method, params) {
        const safeParams = this.publicValue(params)
        const message = {method, params: safeParams}
        this.emit("notification", message)
        if (method !== "error" || this.listenerCount("error") > 0) this.emit(method, safeParams)
    }

    recordHistoryEvents(sessionId, entries) {
        let recorded = this.recordedEventSequences.get(sessionId)
        if (!recorded) {
            recorded = new Set()
            this.recordedEventSequences.set(sessionId, recorded)
        }
        let toolCalls = this.recordedToolCalls.get(sessionId)
        if (!toolCalls) {
            toolCalls = new Map()
            this.recordedToolCalls.set(sessionId, toolCalls)
        }
        for (const entry of entries ?? []) {
            const event = entry?.event
            if (!event || recorded.has(event.seq)) continue
            if (!["user/message", "assistant/message", "tool/call", "tool/result", "turn/end", "session/title"].includes(event.type)) {
                continue
            }
            recorded.add(event.seq)
            let item = null
            if (event.type === "tool/call") {
                const call = {...event, view: entry.view}
                toolCalls.set(event.data.callId, call)
                item = toolItem(call)
            }
            if (event.type === "tool/result") {
                const call = toolCalls.get(toolCallIdFromResult(event))
                if (call) item = toolItem(call, event)
            }
            this.recordTrace("inbound", {
                method: "session/event",
                params: {threadId: sessionId, event, ...(item ? {item} : {})},
            })
        }
    }

    processLiveEntries(pending, entries) {
        const fresh = (entries ?? []).filter(
            (entry) => Number(entry.event?.seq) > pending.lastSeq,
        )
        if (!fresh.length) return
        pending.lastSeq = Math.max(
            pending.lastSeq,
            ...fresh.map((entry) => Number(entry.event?.seq ?? pending.lastSeq)),
        )
        pending.entries.push(...fresh)
        this.recordHistoryEvents(pending.threadId, fresh)
        let ended = null
        for (const entry of fresh) {
            const event = entry.event
            if (event.type === "assistant/chunk" && event.data.turn === pending.turnNumber) {
                const chunk = event.data.chunk ?? {}
                const key = `${event.data.step}:${chunk.index}`
                const current = pending.chunks.get(key) ?? ""
                if (chunk.type === "reasoning-delta") {
                    const text = current + String(chunk.text ?? "")
                    pending.chunks.set(key, text)
                    this.emitNotification("item/started", {
                        threadId: pending.threadId,
                        turnId: pending.turnId,
                        item: {
                            id: `dsh-assistant-${event.data.turn}-${event.data.step}-reasoning`,
                            type: "reasoning",
                            text,
                            summary: [text],
                        },
                    })
                } else if (chunk.type === "text-delta") {
                    pending.chunks.set(key, current + String(chunk.text ?? ""))
                    this.emitNotification("item/agentMessage/delta", {
                        threadId: pending.threadId,
                        turnId: pending.turnId,
                        itemId: `dsh-assistant-${event.data.turn}-${event.data.step}-text`,
                        delta: String(chunk.text ?? ""),
                    })
                }
                continue
            }
            if (event.type === "tool/call" && event.data.turn === pending.turnNumber) {
                pending.toolCalls.set(event.data.callId, {...event, view: entry.view})
                this.emitNotification("item/started", {
                    threadId: pending.threadId,
                    turnId: pending.turnId,
                    item: toolItem({...event, view: entry.view}),
                })
                continue
            }
            if (event.type === "tool/result" && event.data.turn === pending.turnNumber) {
                const callId = toolCallIdFromResult(event)
                const call = pending.toolCalls.get(callId)
                if (call) {
                    this.emitNotification("item/completed", {
                        threadId: pending.threadId,
                        turnId: pending.turnId,
                        item: toolItem(call, event),
                    })
                }
                continue
            }
            if (event.type === "assistant/message" && event.data.turn === pending.turnNumber) {
                const content = event.data.message?.content ?? []
                const reasoning = content.filter((block) => block?.type === "reasoning").map((block) => block.text).join("\n")
                const text = content.filter((block) => block?.type === "text").map((block) => block.text).join("\n")
                if (reasoning) {
                    this.emitNotification("item/completed", {
                        threadId: pending.threadId,
                        turnId: pending.turnId,
                        item: {
                            id: `dsh-assistant-${event.data.turn}-${event.data.step}-reasoning`,
                            type: "reasoning",
                            text: reasoning,
                            summary: [reasoning],
                        },
                    })
                }
                if (text) {
                    this.emitNotification("item/completed", {
                        threadId: pending.threadId,
                        turnId: pending.turnId,
                        item: {
                            id: `dsh-assistant-${event.data.turn}-${event.data.step}-text`,
                            type: "agentMessage",
                            text,
                        },
                    })
                }
                continue
            }
            if (event.type === "session/title") {
                this.emitNotification("thread/name/updated", {
                    threadId: pending.threadId,
                    threadName: event.data.title,
                })
            }
            if (event.type === "turn/end" && event.data.turn === pending.turnNumber) ended = entry
        }
        if (ended) this.finishPendingTurn(pending, ended)
    }

    finishPendingTurn(pending, ended) {
        if (this.pendingTurns.get(pending.threadId) !== pending) return
        this.pendingNonInteractiveFailures.delete(pending.threadId)
        const thread = threadFromHistory({
            summary: {
                sessionId: pending.threadId,
                updatedAt: ended.event.time,
                running: false,
                cwd: this.workspaceRoot,
            },
            entries: pending.entries,
            workspaceRoot: this.workspaceRoot,
        })
        const turn = thread.turns.find((entry) => entry.id === pending.turnId) ?? {
            id: pending.turnId,
            status: "failed",
            items: [],
            error: {message: "DeepSeek Harness turn history is incomplete"},
        }
        this.pendingTurns.delete(pending.threadId)
        if (turn.status === "failed") {
            this.emitNotification("error", {
                threadId: pending.threadId,
                turnId: pending.turnId,
                error: turn.error,
                willRetry: false,
            })
        }
        this.emitNotification("turn/completed", {threadId: pending.threadId, turn})
    }

    failPendingTurn(pending, error) {
        if (this.pendingTurns.get(pending.threadId) !== pending) return
        this.pendingNonInteractiveFailures.delete(pending.threadId)
        this.pendingTurns.delete(pending.threadId)
        const normalized = {
            message: error?.message ?? String(error),
            ...(error?.code ? {code: error.code} : {}),
        }
        this.emitNotification("error", {
            threadId: pending.threadId,
            turnId: pending.turnId,
            error: normalized,
            willRetry: false,
        })
        this.emitNotification("turn/completed", {
            threadId: pending.threadId,
            turn: {
                id: pending.turnId,
                status: "failed",
                items: [],
                error: normalized,
            },
        })
    }

    async interruptTurn(threadId) {
        await this.request("session.cancel", {sessionId: threadId})
        return {}
    }

    recentTrace(limit) {
        return {
            path: this.recorder?.path ?? null,
            reference: this.recorder?.latestReference ?? null,
            events: this.recorder?.readRecent(limit) ?? [],
        }
    }

    waitForCompletedTurn(threadId, timeoutMs, onTimeout) {
        let cleanup = () => {}
        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup()
                onTimeout()
                reject(new Error("The DeepSeek Harness turn timed out"))
            }, timeoutMs)
            const onNotification = (message) => {
                if (message?.method !== "turn/completed" || message.params?.threadId !== threadId) return
                cleanup()
                const turn = message.params.turn
                if (turn?.status === "completed") resolve(turn)
                else {
                    const error = new Error(
                        turn?.error?.message ??
                        (turn?.status === "interrupted"
                            ? "The DeepSeek Harness turn was interrupted"
                            : "The DeepSeek Harness turn failed"),
                    )
                    if (turn?.error?.code) error.code = turn.error.code
                    reject(error)
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The DeepSeek Harness runtime stopped before completion"))
            }
            cleanup = () => {
                clearTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        return {promise, cleanup}
    }

    async runEvaluationCase(input = {}) {
        const startedAt = Date.now()
        const traceMark = this.recorder?.mark?.() ?? null
        const response = await this.startThread({model: input.modelId, effort: input.effort})
        const threadId = response.thread.id
        input.onThreadStarted?.(threadId)
        let turnId = null
        let lastActivityAt = new Date().toISOString()
        const activityListener = (message) => {
            if (message?.params?.threadId === threadId) lastActivityAt = new Date().toISOString()
        }
        this.on("notification", activityListener)
        const completion = this.waitForCompletedTurn(
            threadId,
            input.timeoutMs ?? 30 * 60 * 1000,
            () => void this.interruptTurn(threadId).catch(() => {}),
        )
        try {
            const turnInput = input.activationMode === "explicit" && input.skillReference?.name
                ? [
                      {type: "skill", name: input.skillReference.name, path: input.skillReference.path},
                      {type: "text", text: input.question},
                  ]
                : input.question
            const turn = await this.startTurn(threadId, turnInput, {
                model: input.modelId,
                effort: input.effort,
            })
            turnId = turn.turn.id
            const completedTurn = await completion.promise
            const responseText = [...(completedTurn.items ?? [])]
                .reverse()
                .find((item) => item.type === "agentMessage")?.text ?? ""
            const traceReference = traceMark
                ? this.recorder.referenceFrom(traceMark)
                : this.recorder?.latestReference ?? null
            return {
                threadId,
                turnId,
                response: responseText,
                durationMs: Date.now() - startedAt,
                attempt: input.attempt ?? null,
                traceReference,
                traceEvidence: traceReference
                    ? this.recorder?.evidenceForReference?.(traceReference) ?? null
                    : null,
            }
        } catch (error) {
            completion.cleanup()
            if (error?.message === "The DeepSeek Harness turn timed out") {
                throw evaluationTurnError(error.message, {
                    code: "EVALUATION_TURN_TIMEOUT",
                    recorder: this.recorder,
                    traceMark,
                    threadId,
                    turnId,
                    startedAt,
                    lastActivityAt,
                })
            }
            if (error?.code === "EVALUATION_INTERACTION_REQUIRED") {
                throw evaluationTurnError(error.message, {
                    code: error.code,
                    recorder: this.recorder,
                    traceMark,
                    threadId,
                    turnId,
                    startedAt,
                    lastActivityAt,
                })
            }
            throw error
        } finally {
            completion.cleanup()
            this.off("notification", activityListener)
        }
    }

    async runEvaluationJudge(input = {}) {
        const output = await this.runEvaluationCase({
            question: input.prompt,
            activationMode: "automatic",
            modelId: input.modelId,
            effort: input.effort,
            timeoutMs: input.timeoutMs,
            attempt: input.attempt,
            onThreadStarted: input.onThreadStarted,
        })
        return output
    }

    async stop() {
        this.stopping = true
        this.closeMux()
        this.cancelPendingInteractions()
        for (const pending of this.pendingTurns.values()) pending.stopped = true
        this.pendingTurns.clear()
        this.pendingNonInteractiveFailures.clear()
        const child = this.child
        const epoch = this.processEpoch
        if (!child) return
        await this.terminateProcess(child)
        if (this.child === child && this.processEpoch === epoch) {
            this.handleExit(new Error("DeepSeek Harness Host stopped"), child, epoch)
        }
    }
}

module.exports = {
    DeepSeekHarnessClient,
    decodeModelId,
    encodeModelId,
    threadFromHistory,
    toolItem,
}
