const {randomUUID} = require("node:crypto")
const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {dirname} = require("node:path")
const {version: clientVersion} = require("../package.json")

const {JsonLineDecoder, RpcRequestTracker} = require("./json-rpc.cjs")
const {evaluationTurnError} = require("./evaluation-turn-error.cjs")
const {
    clearEvaluationTimeout,
    startEvaluationTimeout,
} = require("./evaluation-timeout.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")
const {
    mergeOperatorChildEnvironment,
    OperatorStreamRedactor,
    redactOperatorSecrets,
    sanitizeOperatorChildEnvironment,
} = require("./operator/operator-tool-transport.cjs")

function textContent(value) {
    if (typeof value === "string") return value
    if (value?.type === "text") return String(value.text ?? "")
    return ""
}

function sessionMcpServers(options) {
    if (!Object.hasOwn(options, "mcpServers")) return []
    if (!Array.isArray(options.mcpServers)) throw new TypeError("CodeBuddy MCP servers must be an array")
    return JSON.parse(JSON.stringify(options.mcpServers))
}

class CodeBuddyAcpClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        spawnProcess = spawn,
        requestPermission = null,
        childEnvironment = {},
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.spawnProcess = spawnProcess
        this.requestPermission = requestPermission
        this.childEnvironment = sanitizeOperatorChildEnvironment(childEnvironment)
        this.stderrRedactor = null
        this.child = null
        this.tracker = new RpcRequestTracker()
        this.recorder = null
        this.ready = false
        this.stopping = false
        this.initialization = null
        this.sessions = new Map()
        this.pendingTurns = new Map()
        this.modelCatalog = null
        this.sessionModes = new Map()
        this.processEpoch = 0
        this.pendingPermissionRequests = new Map()
        this.evaluationJudgeSessions = new Set()
    }

    state() {
        return {
            status: this.ready ? "ready" : this.child ? "starting" : "stopped",
            binaryPath: this.binaryPath,
            runtime: this.runtimeDescriptor,
            workspaceRoot: this.workspaceRoot,
            tracePath: this.recorder?.path ?? null,
            traceReference: this.recorder?.latestReference ?? null,
        }
    }

    emitRuntimeLog(message) {
        this.emit("runtimeLog", redactOperatorSecrets(String(message), this.childEnvironment))
    }

    emitStderr(output) {
        for (const value of output) {
            const text = value.trim()
            if (!text) continue
            this.recorder?.record("stderr", {text})
            this.emitRuntimeLog(text)
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
        if (!this.binaryPath) throw new Error("The selected local CodeBuddy runtime is unavailable")
        this.stopping = false
        this.recorder = new TraceRecorder(this.traceDirectory, {
            sessionId: `codebuddy-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            runtime: this.runtimeDescriptor,
        })
        const processEpoch = ++this.processEpoch
        const sourceChild = this.spawnProcess(
            this.binaryPath,
            ["--acp", "--acp-transport", "stdio", "--permission-mode", "auto"],
            {
                cwd: this.workspaceRoot,
                env: {
                    ...mergeOperatorChildEnvironment({
                        ...process.env,
                        PATH: `${dirname(this.binaryPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
                    }, this.childEnvironment),
                },
                shell: false,
                stdio: ["pipe", "pipe", "pipe"],
            },
        )
        this.child = sourceChild
        this.stderrRedactor = new OperatorStreamRedactor(this.childEnvironment)
        this.emit("state", this.state())
        const decoder = new JsonLineDecoder(
            (message) => this.handleMessage(message, {sourceChild, processEpoch}),
            (error, line) => {
                const diagnostic = redactOperatorSecrets(
                    {line, error: error.message},
                    this.childEnvironment,
                )
                this.recorder.record("decode-error", diagnostic)
                this.emitRuntimeLog(`Invalid ACP message: ${diagnostic.error}`)
            },
        )
        sourceChild.stdout.on("data", (chunk) => decoder.push(chunk))
        sourceChild.stderr.on("data", (chunk) => {
            this.emitStderr(this.stderrRedactor?.push(chunk) ?? [])
        })
        sourceChild.once("error", (error) => this.handleExit(error, sourceChild, processEpoch))
        sourceChild.once("close", (code, signal) => {
            this.handleExit(
                new Error(
                    `CodeBuddy ACP exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
                ),
                sourceChild,
                processEpoch,
            )
        })
        const initialized = await this.request("initialize", {
            protocolVersion: 1,
            clientInfo: {name: "rolling-skill", version: clientVersion},
            clientCapabilities: {},
        })
        this.ready = true
        this.emit("ready", initialized)
        this.emit("state", this.state())
        return this.state()
    }

    handleExit(error, sourceChild = this.child, processEpoch = this.processEpoch) {
        if (this.child !== sourceChild || this.processEpoch !== processEpoch) return
        this.flushStderr()
        this.cancelPendingPermissionRequests(null, {write: false})
        this.child = null
        this.ready = false
        this.tracker.rejectAll(error)
        const message = redactOperatorSecrets(error.message, this.childEnvironment)
        this.emit("state", {...this.state(), error: this.stopping ? null : message})
        if (!this.stopping) this.emit("runtimeError", new Error(message))
    }

    handleMessage(
        message,
        {sourceChild = this.child, processEpoch = this.processEpoch} = {},
    ) {
        if (this.child !== sourceChild || this.processEpoch !== processEpoch) return
        const safeMessage = redactOperatorSecrets(message, this.childEnvironment)
        this.recorder?.record("inbound", safeMessage)
        if (safeMessage?.id !== undefined && safeMessage?.method) {
            if (safeMessage.method === "session/request_permission") {
                void this.handlePermissionRequest(safeMessage, {sourceChild, processEpoch})
                return
            }
            this.write({
                jsonrpc: "2.0",
                id: safeMessage.id,
                error: {code: -32601, message: `Unsupported ACP client request: ${safeMessage.method}`},
            })
            return
        }
        if (this.tracker.settle(safeMessage)) return
        if (safeMessage?.method === "session/update") this.handleSessionUpdate(safeMessage.params)
        if (safeMessage?.method) this.emit(safeMessage.method, safeMessage.params)
    }

    permissionRequestKey(processEpoch, requestId) {
        return JSON.stringify([processEpoch, requestId])
    }

    settlePermissionRequest(pending, outcome) {
        if (this.pendingPermissionRequests.get(pending.key) !== pending) return false
        this.pendingPermissionRequests.delete(pending.key)
        if (
            this.child !== pending.sourceChild ||
            this.processEpoch !== pending.processEpoch ||
            !pending.sourceChild?.stdin?.writable
        ) {
            return false
        }
        try {
            this.write({jsonrpc: "2.0", id: pending.requestId, result: {outcome}})
            return true
        } catch (error) {
            this.emitRuntimeLog(`Permission response failed: ${error.message}`)
            return false
        }
    }

    cancelPendingPermissionRequests(sessionId = null, {write = true} = {}) {
        const matching = [...this.pendingPermissionRequests.values()].filter(
            (pending) => !sessionId || pending.sessionId === sessionId,
        )
        for (const pending of matching) {
            if (write) {
                this.settlePermissionRequest(pending, {outcome: "cancelled"})
            } else {
                this.pendingPermissionRequests.delete(pending.key)
            }
        }
    }

    async handlePermissionRequest(
        message,
        {sourceChild = this.child, processEpoch = this.processEpoch} = {},
    ) {
        if (this.child !== sourceChild || this.processEpoch !== processEpoch) return
        const pending = {
            key: this.permissionRequestKey(processEpoch, message.id),
            requestId: message.id,
            sessionId: message.params?.sessionId ?? null,
            sourceChild,
            processEpoch,
        }
        this.pendingPermissionRequests.set(pending.key, pending)
        const options = Array.isArray(message.params?.options) ? message.params.options : []
        const fallback = options.find((option) =>
            /reject|deny|decline|cancel/i.test(
                `${option.kind ?? ""} ${option.optionId ?? ""} ${option.name ?? ""}`,
            ),
        )
        if (!fallback) {
            this.settlePermissionRequest(pending, {outcome: "cancelled"})
            return
        }
        if (this.evaluationJudgeSessions.has(pending.sessionId)) {
            this.settlePermissionRequest(pending, {
                outcome: "selected",
                optionId: fallback.optionId ?? fallback.name,
            })
            return
        }
        let optionId = null
        try {
            if (typeof this.requestPermission === "function") {
                const selected = await this.requestPermission({
                    providerId: "codebuddy",
                    processEpoch,
                    method: message.method,
                    params: message.params ?? {},
                    options,
                })
                if (options.some((option) => (option.optionId ?? option.name) === selected)) {
                    optionId = selected
                }
            }
        } catch (error) {
            this.emitRuntimeLog(`Permission request failed: ${error.message}`)
        }
        if (this.pendingPermissionRequests.get(pending.key) !== pending) return
        optionId ??= fallback.optionId ?? fallback.name
        this.settlePermissionRequest(pending, {outcome: "selected", optionId})
    }

    handleSessionUpdate(params = {}) {
        const sessionId = params.sessionId
        const update = params.update ?? {}
        const pending = this.pendingTurns.get(sessionId)
        if (!pending) return
        const type = update.sessionUpdate
        if (type === "agent_message_chunk") {
            const delta = textContent(update.content)
            if (!delta) return
            pending.item.text += delta
            this.emitNotification("item/agentMessage/delta", {
                threadId: sessionId,
                turnId: pending.turn.id,
                itemId: pending.item.id,
                delta,
            })
        } else if (type === "agent_thought_chunk") {
            const delta = textContent(update.content)
            if (!delta) return
            pending.reasoning.text += delta
            this.emitNotification("item/started", {
                threadId: sessionId,
                turnId: pending.turn.id,
                item: {...pending.reasoning, summary: [pending.reasoning.text]},
            })
        }
    }

    emitNotification(method, params) {
        const message = {method, params}
        this.emit("notification", message)
        this.emit(method, params)
    }

    write(message) {
        if (!this.child?.stdin?.writable) throw new Error("CodeBuddy ACP is not running")
        this.recorder?.record("outbound", redactOperatorSecrets(message, this.childEnvironment))
        this.child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    request(method, params = {}) {
        const pending = this.tracker.create(method, params)
        pending.message.jsonrpc = "2.0"
        try {
            this.write(pending.message)
        } catch (error) {
            this.tracker.settle({
                id: pending.message.id,
                error: {code: -32000, message: error.message},
            })
        }
        return pending.promise
    }

    notify(method, params = {}) {
        this.write({jsonrpc: "2.0", method, params})
    }

    setWorkspace(workspaceRoot) {
        this.workspaceRoot = workspaceRoot
        this.emit("state", this.state())
    }

    listThreads(options = {}) {
        if (options.archived) return Promise.resolve({data: [], nextCursor: null})
        const data = [...this.sessions.values()]
            .map((thread) => ({
                id: thread.id,
                name: thread.name,
                preview: thread.preview,
                cwd: thread.cwd,
                model: thread.model,
                updatedAt: thread.updatedAt,
                status: thread.status,
            }))
            .sort((left, right) => right.updatedAt - left.updatedAt)
        return Promise.resolve({data, nextCursor: null})
    }

    listModels() {
        if (this.modelCatalog) return Promise.resolve({data: this.modelCatalog, nextCursor: null})
        const efforts = this.runtimeDescriptor?.efforts ?? ["minimal", "low", "medium", "high", "xhigh", "max"]
        const models = this.runtimeDescriptor?.models ?? []
        return Promise.resolve({
            data: models.map((model, index) => ({
                id: model,
                model,
                displayName: model,
                isDefault: index === 0 || model === "default-model",
                reasoningEfforts: efforts.map((effort) => ({reasoningEffort: effort})),
            })),
            nextCursor: null,
        })
    }

    readThread(threadId) {
        const thread = this.sessions.get(threadId)
        if (!thread) throw new Error("CodeBuddy session is not available in this Rolling Skill process")
        return Promise.resolve({thread: JSON.parse(JSON.stringify(thread))})
    }

    captureModels(response) {
        const models = response?.models
        const available = models?.availableModels ?? (Array.isArray(models) ? models : [])
        if (!available.length) return
        const current = models.currentModelId ?? null
        this.modelCatalog = available.map((entry) => {
            const id = entry.modelId ?? entry.id ?? entry.value
            return {
                id,
                model: id,
                displayName: entry.name ?? id,
                isDefault: id === current,
                reasoningEfforts: (this.runtimeDescriptor?.efforts ?? []).map((effort) => ({
                    reasoningEffort: effort,
                })),
            }
        })
    }

    captureModes(sessionId, response) {
        const modes = response?.modes
        const availableModes = Array.isArray(modes?.availableModes) ? modes.availableModes : []
        this.sessionModes.set(
            sessionId,
            new Set(availableModes.map((entry) => entry.id).filter(Boolean)),
        )
        return {
            currentModeId: modes?.currentModeId ?? null,
            availablePermissionModes: [...this.sessionModes.get(sessionId)],
        }
    }

    availablePermissionMode(sessionId, requested) {
        const available = this.sessionModes.get(sessionId)
        if (!available?.size || available.has(requested)) return requested
        throw new Error(`CodeBuddy does not support permission mode ${requested}`)
    }

    async configureSession(sessionId, options = {}) {
        if (options.permissionMode) {
            await this.request("session/set_mode", {
                sessionId,
                modeId: this.availablePermissionMode(sessionId, options.permissionMode),
            })
        }
        if (options.model) {
            await this.request("session/set_model", {sessionId, modelId: options.model})
        }
        if (options.effort) {
            await this.request("session/set_config_option", {
                sessionId,
                configId: "thought_level",
                value: options.effort,
            })
        }
    }

    async startThread(options = {}) {
        const response = await this.request("session/new", {
            cwd: this.workspaceRoot,
            mcpServers: sessionMcpServers(options),
        })
        this.captureModels(response)
        const runtimeModes = this.captureModes(response.sessionId, response)
        await this.configureSession(response.sessionId, options)
        const now = Date.now() / 1000
        const thread = {
            id: response.sessionId,
            name: "New CodeBuddy task",
            preview: "",
            cwd: this.workspaceRoot,
            model: options.model ?? response.models?.currentModelId ?? null,
            effort: options.effort ?? null,
            permissionMode: options.permissionMode ?? runtimeModes.currentModeId,
            availablePermissionModes: runtimeModes.availablePermissionModes,
            status: {type: "idle"},
            updatedAt: now,
            recencyAt: now,
            turns: [],
            modelProvider: "codebuddy",
            threadSource: options.threadSource ?? "user",
        }
        this.sessions.set(thread.id, thread)
        this.emitNotification("thread/started", {thread})
        return {thread: JSON.parse(JSON.stringify(thread))}
    }

    async resumeThread(threadId, options = {}) {
        if (!this.sessions.has(threadId)) {
            const response = await this.request("session/load", {
                sessionId: threadId,
                cwd: this.workspaceRoot,
                mcpServers: sessionMcpServers(options),
            })
            this.captureModels(response)
            const runtimeModes = this.captureModes(threadId, response)
            const now = Date.now() / 1000
            this.sessions.set(threadId, {
                id: threadId,
                name: "CodeBuddy task",
                preview: "",
                cwd: this.workspaceRoot,
                model: options.model ?? response.models?.currentModelId ?? null,
                effort: options.effort ?? null,
                permissionMode: options.permissionMode ?? runtimeModes.currentModeId,
                availablePermissionModes: runtimeModes.availablePermissionModes,
                status: {type: "idle"},
                updatedAt: now,
                recencyAt: now,
                turns: [],
                modelProvider: "codebuddy",
            })
        }
        await this.configureSession(threadId, options)
        return this.readThread(threadId)
    }

    async startTurn(threadId, value, options = {}) {
        const thread = this.sessions.get(threadId)
        if (!thread) throw new Error("Unknown CodeBuddy session")
        await this.configureSession(threadId, options)
        if (options.model) thread.model = options.model
        if (options.effort) thread.effort = options.effort
        if (options.permissionMode) thread.permissionMode = options.permissionMode
        const text = Array.isArray(value)
            ? value
                  .map((part) =>
                      part.type === "skill" ? `/${part.name}` : part.type === "text" ? part.text : "",
                  )
                  .filter(Boolean)
                  .join("\n\n")
            : String(value)
        const turn = {
            id: randomUUID(),
            status: "inProgress",
            items: [
                {
                    id: randomUUID(),
                    type: "userMessage",
                    content: [{type: "text", text, text_elements: []}],
                },
            ],
        }
        const item = {id: randomUUID(), type: "agentMessage", text: ""}
        const reasoning = {id: randomUUID(), type: "reasoning", text: "", summary: []}
        turn.items.push(item)
        thread.turns.push(turn)
        thread.preview ||= text.slice(0, 160)
        thread.status = {type: "active"}
        thread.updatedAt = Date.now() / 1000
        this.pendingTurns.set(threadId, {turn, item, reasoning})
        this.emitNotification("turn/started", {threadId, turn: JSON.parse(JSON.stringify(turn))})
        void this.request("session/prompt", {
            sessionId: threadId,
            prompt: [{type: "text", text}],
        }).then(
            () => this.completeTurn(threadId),
            (error) => this.failTurn(threadId, error),
        )
        return {turn: JSON.parse(JSON.stringify(turn))}
    }

    completeTurn(threadId) {
        const pending = this.pendingTurns.get(threadId)
        const thread = this.sessions.get(threadId)
        if (!pending || !thread) return
        pending.turn.status = "completed"
        thread.status = {type: "idle"}
        thread.updatedAt = Date.now() / 1000
        this.pendingTurns.delete(threadId)
        this.emitNotification("item/completed", {
            threadId,
            turnId: pending.turn.id,
            item: JSON.parse(JSON.stringify(pending.item)),
        })
        this.emitNotification("turn/completed", {
            threadId,
            turn: JSON.parse(JSON.stringify(pending.turn)),
        })
    }

    failTurn(threadId, error) {
        const pending = this.pendingTurns.get(threadId)
        const thread = this.sessions.get(threadId)
        if (!pending || !thread) return
        pending.turn.status = "failed"
        pending.turn.error = {message: error?.message ?? String(error)}
        thread.status = {type: "idle"}
        this.pendingTurns.delete(threadId)
        this.emitNotification("error", {
            threadId,
            turnId: pending.turn.id,
            error: pending.turn.error,
            willRetry: false,
        })
        this.emitNotification("turn/completed", {
            threadId,
            turn: JSON.parse(JSON.stringify(pending.turn)),
        })
    }

    interruptTurn(threadId) {
        this.cancelPendingPermissionRequests(threadId)
        this.notify("session/cancel", {sessionId: threadId})
        return Promise.resolve({})
    }

    archiveThread(threadId) {
        this.sessions.delete(threadId)
        return Promise.resolve({})
    }

    recentTrace(limit) {
        return {
            path: this.recorder?.path ?? null,
            reference: this.recorder?.latestReference ?? null,
            events: this.recorder?.readRecent(limit) ?? [],
        }
    }

    async runEvaluationCase(input = {}) {
        const startedAt = Date.now()
        const traceMark = this.recorder?.mark?.() ?? null
        const response = await this.startThread({model: input.modelId, effort: input.effort})
        const threadId = response.thread.id
        input.onThreadStarted?.(threadId)
        const prompt =
            input.activationMode === "explicit" && input.skillReference?.name
                ? `/${input.skillReference.name}\n\n${input.question}`
                : input.question
        let turnId = null
        let lastActivityAt = new Date().toISOString()
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = startEvaluationTimeout(input, () => {
                cleanup()
                try {
                    void Promise.resolve(this.interruptTurn(threadId)).catch(() => {})
                } catch {
                    // The timeout remains authoritative if ACP already stopped.
                }
                reject(evaluationTurnError("The evaluation turn timed out", {
                    code: "EVALUATION_TURN_TIMEOUT",
                    recorder: this.recorder,
                    traceMark,
                    threadId,
                    turnId,
                    startedAt,
                    lastActivityAt,
                }))
            })
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
                lastActivityAt = new Date().toISOString()
                if (message.method === "turn/completed") {
                    cleanup()
                    if (params.turn?.status === "failed") {
                        reject(new Error(params.turn.error?.message ?? "The evaluation turn failed"))
                    } else {
                        resolve(params.turn)
                    }
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The evaluation runtime stopped before completion"))
            }
            cleanup = () => {
                clearEvaluationTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        let completedTurn
        try {
            const turn = await this.startTurn(threadId, prompt, {
                model: input.modelId,
                effort: input.effort,
            })
            turnId = turn.turn.id
            completedTurn = await completed
        } catch (error) {
            cleanup()
            throw error
        }
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
    }

    async runEvaluationJudge(input = {}) {
        const startedAt = Date.now()
        const traceMark = this.recorder?.mark?.() ?? null
        const response = await this.startThread({
            model: input.modelId,
            effort: input.effort,
            permissionMode: "dontAsk",
            threadSource: "subagent",
        })
        const threadId = response.thread.id
        input.onThreadStarted?.(threadId)
        this.evaluationJudgeSessions.add(threadId)
        let turnId = null
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = startEvaluationTimeout(input, () => {
                cleanup()
                try {
                    void Promise.resolve(this.interruptTurn(threadId)).catch(() => {})
                } catch {
                    // The timeout result remains authoritative if the ACP process already stopped.
                }
                reject(new Error("The evaluation Judge turn timed out"))
            })
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
                if (message.method === "turn/completed") {
                    cleanup()
                    if (params.turn?.status === "failed") {
                        reject(
                            new Error(
                                params.turn.error?.message ?? "The evaluation Judge turn failed",
                            ),
                        )
                    } else {
                        resolve(params.turn)
                    }
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The evaluation Judge runtime stopped before completion"))
            }
            cleanup = () => {
                clearEvaluationTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        let completedTurn
        try {
            const turn = await this.startTurn(threadId, input.prompt, {
                model: input.modelId,
                effort: input.effort,
                permissionMode: "dontAsk",
            })
            turnId = turn.turn.id
            completedTurn = await completed
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
        } finally {
            cleanup()
            this.cancelPendingPermissionRequests(threadId)
            this.evaluationJudgeSessions.delete(threadId)
            this.pendingTurns.delete(threadId)
            this.sessionModes.delete(threadId)
            this.sessions.delete(threadId)
        }
    }

    async stop() {
        if (!this.child) {
            this.cancelPendingPermissionRequests(null, {write: false})
            return
        }
        this.stopping = true
        const child = this.child
        const processEpoch = this.processEpoch
        this.cancelPendingPermissionRequests()
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL")
                resolve()
            }, 2_000)
            child.once("close", () => {
                clearTimeout(timeout)
                resolve()
            })
            child.kill("SIGTERM")
        })
        if (this.child === child && this.processEpoch === processEpoch) {
            this.handleExit(new Error("CodeBuddy ACP stopped"), child, processEpoch)
        }
    }
}

module.exports = {CodeBuddyAcpClient, textContent}
