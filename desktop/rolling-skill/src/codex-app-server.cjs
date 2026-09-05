const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {existsSync} = require("node:fs")
const {dirname, join} = require("node:path")
const {version: clientVersion} = require("../package.json")

const {JsonLineDecoder, RpcRequestTracker} = require("./json-rpc.cjs")
const {CONTROL_METHODS, publicControlError} = require("./control-plane/contracts.cjs")
const {evaluationTurnError} = require("./evaluation-turn-error.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")
const {
    mergeOperatorChildEnvironment,
    OperatorStreamRedactor,
    redactOperatorSecrets,
    sanitizeOperatorChildEnvironment,
} = require("./operator/operator-tool-transport.cjs")

const MAX_DYNAMIC_TOOL_ARGUMENT_BYTES = 1_048_576
const MAX_DYNAMIC_TOOL_RESPONSE_BYTES = 256 * 1_024
const MAX_PRE_RESPONSE_TERMINAL_IDS = 32
const CAPTURE_TURN_PAGE_SIZE = 10
const CAPTURE_INITIAL_TURN_LIMIT = 40
const CAPTURE_INCREMENTAL_TURN_LIMIT = 120
const CAPTURE_USER_TEXT_LIMIT = 120_000
const CAPTURE_ITEM_TEXT_LIMIT = 24_000
const CAPTURE_COMMAND_OUTPUT_LIMIT = 4_000
const DYNAMIC_TOOL_NAMESPACE = "rolling_skill"
const TERMINAL_TURN_NOTIFICATIONS = new Set([
    "turn/canceled",
    "turn/cancelled",
    "turn/completed",
    "turn/failed",
    "turn/interrupted",
])
const DYNAMIC_TURN_NOTIFICATIONS = new Set([
    "turn/started",
    ...TERMINAL_TURN_NOTIFICATIONS,
])
const TERMINAL_TURN_STATUSES = new Set([
    "cancelled",
    "canceled",
    "completed",
    "failed",
    "interrupted",
])
const DYNAMIC_TOOL_METHODS = new Map(CONTROL_METHODS.map((method) => [
    method.replaceAll(".", "_"),
    method,
]))

function plainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function jsonBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), "utf8")
}

function boundedCaptureText(value, limit, keepTail = false) {
    const text = String(value ?? "")
    if (text.length <= limit) return text
    const marker = "\n…[historical content compacted]…\n"
    const available = Math.max(0, limit - marker.length)
    if (!keepTail) return `${text.slice(0, available)}${marker}`
    const head = Math.ceil(available / 2)
    const tail = Math.floor(available / 2)
    return `${text.slice(0, head)}${marker}${text.slice(-tail)}`
}

function boundedCaptureValue(value, limit = CAPTURE_ITEM_TEXT_LIMIT) {
    const state = {remaining: limit, seen: new WeakSet()}
    const visit = (candidate, depth = 0) => {
        if (state.remaining <= 0) return "[historical content omitted]"
        if (typeof candidate === "string") {
            const text = boundedCaptureText(candidate, state.remaining, true)
            state.remaining -= text.length
            return text
        }
        if (candidate === null || candidate === undefined || typeof candidate !== "object") {
            state.remaining -= String(candidate ?? "").length
            return candidate
        }
        if (depth >= 12 || state.seen.has(candidate)) return "[historical structure omitted]"
        state.seen.add(candidate)
        if (Array.isArray(candidate)) {
            const output = []
            for (const child of candidate.slice(0, 100)) {
                if (state.remaining <= 0) break
                output.push(visit(child, depth + 1))
            }
            if (candidate.length > output.length) output.push("[historical entries omitted]")
            return output
        }
        const output = {}
        const entries = Object.entries(candidate)
        for (const [key, child] of entries.slice(0, 100)) {
            if (state.remaining <= 0) break
            state.remaining -= key.length
            output[key] = visit(child, depth + 1)
        }
        if (entries.length > Object.keys(output).length) output._compacted = true
        return output
    }
    return visit(value)
}

function compactCaptureItem(item) {
    const base = {id: item?.id ?? null, type: item?.type ?? null}
    if (item?.type === "userMessage") {
        return {
            ...base,
            clientId: item.clientId ?? null,
            content: boundedCaptureValue(item.content, CAPTURE_USER_TEXT_LIMIT),
        }
    }
    if (item?.type === "agentMessage") {
        return {
            ...base,
            text: boundedCaptureText(item.text, CAPTURE_ITEM_TEXT_LIMIT),
            phase: item.phase ?? null,
            memoryCitation: boundedCaptureValue(item.memoryCitation),
        }
    }
    if (item?.type === "reasoning") {
        return {
            ...base,
            summary: boundedCaptureValue(item.summary),
            content: [],
        }
    }
    if (item?.type === "commandExecution") {
        return {
            ...base,
            command: String(item.command ?? ""),
            status: item.status ?? null,
            exitCode: item.exitCode ?? null,
            durationMs: item.durationMs ?? null,
            aggregatedOutput: boundedCaptureText(
                item.aggregatedOutput ?? item.output,
                CAPTURE_COMMAND_OUTPUT_LIMIT,
                true,
            ),
        }
    }
    if (["mcpToolCall", "dynamicToolCall", "collabAgentToolCall"].includes(item?.type)) {
        return {
            ...base,
            server: item.server ?? null,
            tool: item.tool ?? null,
            status: item.status ?? null,
            durationMs: item.durationMs ?? null,
            arguments: boundedCaptureValue(item.arguments),
            result: boundedCaptureValue(item.result),
            error: boundedCaptureValue(item.error),
        }
    }
    return {
        ...boundedCaptureValue(item),
        ...base,
    }
}

function compactCaptureTurn(turn) {
    return {
        ...turn,
        items: Array.isArray(turn?.items) ? turn.items.map(compactCaptureItem) : [],
    }
}

function turnHasUserItem(turn, itemId) {
    return Boolean(itemId) && (turn?.items ?? []).some((item) => (
        item?.type === "userMessage" && item?.id === itemId
    ))
}

function capturePaginationUnavailable(error) {
    return error?.code === -32601 || /(?:invalid paginated history lineage|not supported yet|method not found|unknown method)/iu.test(
        String(error?.message ?? ""),
    )
}

function boundedCaptureTurns(turns, {anchorItemId = null, limit}) {
    const descending = [...turns].reverse()
    const selected = []
    let anchorFound = false
    for (const turn of descending) {
        selected.push(compactCaptureTurn(turn))
        if (turnHasUserItem(turn, anchorItemId)) {
            anchorFound = true
            break
        }
        if (selected.length >= limit) break
    }
    return {
        turns: selected.reverse(),
        anchorFound,
        truncated: !anchorFound && selected.length < descending.length,
    }
}

function turnSandboxPolicy(sandbox) {
    if (sandbox === "danger-full-access") return {type: "dangerFullAccess"}
    if (sandbox === "read-only") return {type: "readOnly", networkAccess: false}
    if (sandbox === "workspace-write") {
        return {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
        }
    }
    return null
}

// Temporary compatibility identity for the internal Codex gateway used during development.
// Restore this to "rolling-skill" before distributing the client as a standalone product.
const CODEX_APP_SERVER_ORIGINATOR = "codex_exec"

class CodexAppServerClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        executionPolicy = null,
        requestPermission = null,
        requestQuestion = null,
        requestTool = null,
        childEnvironment = {},
        spawnProcess = spawn,
        shutdownTimeoutMs = 2_000,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.executionPolicy = {
            sandbox: executionPolicy?.sandbox ?? "workspace-write",
            approvalPolicy: executionPolicy?.approvalPolicy ?? "never",
        }
        this.spawnProcess = spawnProcess
        this.requestPermission = requestPermission
        this.requestQuestion = requestQuestion
        this.requestTool = requestTool
        this.childEnvironment = sanitizeOperatorChildEnvironment(childEnvironment)
        this.shutdownTimeoutMs = Math.max(1, Number(shutdownTimeoutMs) || 2_000)
        this.dynamicToolThreads = new Map()
        this.dynamicToolTurnStates = new Map()
        this.dynamicToolTurnGeneration = 0
        this.stderrRedactor = null
        this.child = null
        this.tracker = new RpcRequestTracker()
        this.recorder = null
        this.ready = false
        this.stopping = false
        this.initialization = null
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
        if (!this.binaryPath) throw new Error("The selected local Codex runtime is unavailable")
        this.stopping = false
        this.recorder = new TraceRecorder(this.traceDirectory, {
            sessionId: `runtime-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            runtime: this.runtimeDescriptor,
        })
        const runtimeRoot = dirname(dirname(this.binaryPath))
        const runtimePath = join(runtimeRoot, "codex-path")
        const executablePath = dirname(this.binaryPath)
        const inheritedPath = process.env.PATH ?? "/usr/bin:/bin"
        const managedEnvironment = existsSync(runtimePath)
            ? {
                  CODEX_MANAGED_BY_NPM: "1",
                  CODEX_MANAGED_PACKAGE_ROOT: runtimeRoot,
                  PATH: `${runtimePath}:${executablePath}:${inheritedPath}`,
              }
            : {PATH: `${executablePath}:${inheritedPath}`}
        this.child = this.spawnProcess(this.binaryPath, ["app-server"], {
            cwd: this.workspaceRoot,
            env: {
                ...mergeOperatorChildEnvironment(
                    {...process.env, ...managedEnvironment},
                    this.childEnvironment,
                ),
            },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
        })
        this.stderrRedactor = new OperatorStreamRedactor(this.childEnvironment)
        this.emit("state", this.state())

        const decoder = new JsonLineDecoder(
            (message) => this.handleMessage(message),
            (error, line) => {
                const diagnostic = redactOperatorSecrets(
                    {line, error: error.message},
                    this.childEnvironment,
                )
                this.recorder.record("decode-error", diagnostic)
                this.emitRuntimeLog(`Invalid app-server message: ${diagnostic.error}`)
            },
        )
        this.child.stdout.on("data", (chunk) => decoder.push(chunk))
        this.child.stderr.on("data", (chunk) => {
            this.emitStderr(this.stderrRedactor?.push(chunk) ?? [])
        })
        this.child.once("error", (error) => this.handleExit(error))
        this.child.once("close", (code, signal) => {
            const error = new Error(
                `Codex app-server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
            )
            this.handleExit(error)
        })

        const initialized = await this.request("initialize", {
            clientInfo: {
                name: CODEX_APP_SERVER_ORIGINATOR,
                title: "Rolling Skill",
                version: clientVersion,
            },
            capabilities: {experimentalApi: true, requestAttestation: false},
        })
        this.notify("initialized")
        this.ready = true
        this.emit("ready", initialized)
        this.emit("state", this.state())
        return this.state()
    }

    handleExit(error) {
        if (!this.child) return
        this.flushStderr()
        this.child = null
        this.ready = false
        this.dynamicToolThreads.clear()
        this.dynamicToolTurnStates.clear()
        this.tracker.rejectAll(error)
        const message = redactOperatorSecrets(error.message, this.childEnvironment)
        this.emit("state", {...this.state(), error: this.stopping ? null : message})
        if (!this.stopping) this.emit("runtimeError", new Error(message))
    }

    handleMessage(message) {
        const safeMessage = redactOperatorSecrets(message, this.childEnvironment)
        this.recorder?.record("inbound", safeMessage)
        if (safeMessage?.id !== undefined && safeMessage?.method) {
            if (safeMessage.method === "item/tool/call") {
                void this.handleDynamicToolCall(safeMessage)
                return
            }
            if (this.isInteractiveServerRequest(safeMessage.method)) {
                void this.handleInteractiveServerRequest(safeMessage)
                return
            }
            this.write({
                id: safeMessage.id,
                error: {code: -32601, message: `Unsupported client request: ${safeMessage.method}`},
            })
            return
        }
        if (this.tracker.settle(safeMessage)) return
        if (safeMessage?.method) {
            if (DYNAMIC_TURN_NOTIFICATIONS.has(safeMessage.method)) {
                this.updateDynamicTurnFromNotification(safeMessage)
            }
            this.emit("notification", safeMessage)
            this.emit(safeMessage.method, safeMessage.params)
        }
    }

    isInteractiveServerRequest(method) {
        return method === "item/commandExecution/requestApproval" ||
            method === "item/fileChange/requestApproval" ||
            method === "item/permissions/requestApproval" ||
            method === "item/tool/requestUserInput"
    }

    registerDynamicTools(threadId, dynamicTools) {
        this.dynamicToolThreads.delete(threadId)
        if (!Array.isArray(dynamicTools)) return false
        const namespace = dynamicTools.find((entry) => (
            entry?.type === "namespace" && entry.name === DYNAMIC_TOOL_NAMESPACE
        ))
        if (!namespace || !Array.isArray(namespace.tools)) return false
        const methods = new Map()
        for (const tool of namespace.tools) {
            if (tool?.type !== "function" || typeof tool.name !== "string") continue
            const method = DYNAMIC_TOOL_METHODS.get(tool.name)
            if (method) methods.set(tool.name, method)
        }
        if (methods.size === 0) return false
        this.dynamicToolThreads.set(threadId, methods)
        return true
    }

    beginDynamicTurnPhase(threadId, phase) {
        const previous = this.dynamicToolTurnStates.get(threadId)
        const retiredTurnIds = new Set(previous?.retiredTurnIds ?? [])
        if (previous?.turnId) retiredTurnIds.add(previous.turnId)
        while (retiredTurnIds.size > 32) retiredTurnIds.delete(retiredTurnIds.values().next().value)
        const state = {
            phase,
            generation: ++this.dynamicToolTurnGeneration,
            turnId: null,
            retiredTurnIds,
            preResponseTerminalIds: new Set(),
            preResponseTerminalOverflow: false,
        }
        this.dynamicToolTurnStates.set(threadId, state)
        return state
    }

    updateDynamicTurnFromNotification(message) {
        const threadId = message.params?.threadId
        const turnId = message.params?.turn?.id
        if (
            typeof threadId !== "string" || threadId.length === 0 ||
            typeof turnId !== "string" || turnId.length === 0
        ) return
        const state = this.dynamicToolTurnStates.get(threadId)
        if (!state || state.phase === "idle" || state.phase === "resuming" || state.phase === "terminal") {
            return
        }
        if (state.retiredTurnIds.has(turnId)) return
        if (state.phase === "starting") {
            if (TERMINAL_TURN_NOTIFICATIONS.has(message.method)) {
                if (state.preResponseTerminalIds.size < MAX_PRE_RESPONSE_TERMINAL_IDS) {
                    state.preResponseTerminalIds.add(turnId)
                } else if (!state.preResponseTerminalIds.has(turnId)) {
                    state.preResponseTerminalOverflow = true
                }
            }
            return
        }
        if (state.turnId !== null && state.turnId !== turnId) return
        state.turnId = turnId
        state.phase = TERMINAL_TURN_NOTIFICATIONS.has(message.method) ? "terminal" : "active"
    }

    dynamicToolResult(payload, success) {
        const text = JSON.stringify(payload)
        return {
            contentItems: [{type: "inputText", text}],
            success,
        }
    }

    dynamicToolFailure(error) {
        return this.dynamicToolResult(publicControlError(error), false)
    }

    async handleDynamicToolCall(message) {
        const params = message.params ?? {}
        try {
            if (
                typeof params.threadId !== "string" ||
                typeof params.turnId !== "string" || params.turnId.trim().length === 0 ||
                typeof params.callId !== "string" || params.callId.trim().length === 0 ||
                params.namespace !== DYNAMIC_TOOL_NAMESPACE ||
                typeof params.tool !== "string"
            ) throw new Error("Operator dynamic Tool is unavailable")
            const method = this.dynamicToolThreads.get(params.threadId)?.get(params.tool)
            if (!method || typeof this.requestTool !== "function") {
                throw new Error("Operator dynamic Tool is unavailable")
            }
            if (!plainObject(params.arguments) || jsonBytes(params.arguments) > MAX_DYNAMIC_TOOL_ARGUMENT_BYTES) {
                throw new Error("Operator dynamic Tool arguments are invalid")
            }
            const turnState = this.dynamicToolTurnStates.get(params.threadId)
            if (!turnState || turnState.phase !== "active") {
                throw new Error("Operator dynamic Tool does not belong to the active turn")
            }
            if (turnState.retiredTurnIds.has(params.turnId)) {
                throw new Error("Operator dynamic Tool does not belong to the active turn")
            }
            if (turnState.turnId !== params.turnId) {
                throw new Error("Operator dynamic Tool does not belong to the active turn")
            }
            const result = await this.requestTool({
                threadId: params.threadId,
                turnId: params.turnId,
                callId: params.callId,
                method,
                params: JSON.parse(JSON.stringify(params.arguments)),
            })
            if (
                JSON.stringify(redactOperatorSecrets(result, this.childEnvironment)) !==
                JSON.stringify(result)
            ) throw new Error("Operator dynamic Tool result contains private authority")
            if (jsonBytes(result) > MAX_DYNAMIC_TOOL_RESPONSE_BYTES) {
                throw new Error("Operator dynamic Tool result exceeds its public bound")
            }
            this.write({id: message.id, result: this.dynamicToolResult(result, true)})
        } catch (error) {
            this.write({id: message.id, result: this.dynamicToolFailure(error)})
        }
    }

    permissionOptions(decisions, defaults) {
        const ids = (Array.isArray(decisions) ? decisions : defaults)
            .filter((decision) => typeof decision === "string")
        if (!ids.some((id) => /decline|cancel|reject|deny/iu.test(id))) ids.push("decline")
        return [...new Set(ids)].map((optionId) => ({
            optionId,
            kind: optionId,
            name: optionId,
        }))
    }

    async requestApproval(message, defaults) {
        const params = message.params ?? {}
        const options = this.permissionOptions(params.availableDecisions, defaults)
        const rejection = options.find((option) => /decline|cancel|reject|deny/iu.test(option.optionId))
        if (typeof this.requestPermission !== "function") return rejection.optionId
        const selected = await this.requestPermission({
            rpcId: String(message.id),
            params: {
                ...params,
                sessionId: params.threadId,
                toolCall: {
                    name: message.method.includes("fileChange") ? "fileChange" : "commandExecution",
                    rawInput: params.command ?? params.reason ?? "",
                },
            },
            options,
        })
        return options.some((option) => option.optionId === selected)
            ? selected
            : rejection.optionId
    }

    async handleInteractiveServerRequest(message) {
        try {
            if (message.method === "item/commandExecution/requestApproval") {
                const decision = await this.requestApproval(
                    message,
                    ["accept", "acceptForSession", "decline", "cancel"],
                )
                this.write({id: message.id, result: {decision}})
                return
            }
            if (message.method === "item/fileChange/requestApproval") {
                const decision = await this.requestApproval(
                    message,
                    ["accept", "acceptForSession", "decline", "cancel"],
                )
                this.write({id: message.id, result: {decision}})
                return
            }
            if (message.method === "item/permissions/requestApproval") {
                const selected = await this.requestApproval(
                    message,
                    ["accept", "acceptForSession", "decline"],
                )
                if (selected !== "accept" && selected !== "acceptForSession") {
                    this.write({
                        id: message.id,
                        error: {code: -32000, message: "User denied the requested permissions"},
                    })
                    return
                }
                const requested = message.params?.permissions ?? {}
                const permissions = {}
                if (requested.network) permissions.network = requested.network
                if (requested.fileSystem) permissions.fileSystem = requested.fileSystem
                this.write({
                    id: message.id,
                    result: {
                        permissions,
                        scope: selected === "acceptForSession" ? "session" : "turn",
                    },
                })
                return
            }
            const params = message.params ?? {}
            const questions = (params.questions ?? []).map((question) => ({
                ...question,
                prompt: question.question,
                options: Array.isArray(question.options)
                    ? question.options.map((option) => ({
                          label: option.label,
                          description: option.description,
                      }))
                    : [],
            }))
            const response = typeof this.requestQuestion === "function"
                ? await this.requestQuestion({
                      rpcId: String(message.id),
                      sessionId: params.threadId,
                      questions,
                  })
                : null
            const answers = {}
            for (const answer of response?.answers ?? []) {
                const questionId = String(answer.questionId ?? answer.id ?? "")
                if (!questionId || !questions.some((question) => question.id === questionId)) continue
                const values = Array.isArray(answer.answers)
                    ? answer.answers.map(String)
                    : answer.answer === null || answer.answer === undefined
                      ? []
                      : [String(answer.answer)]
                answers[questionId] = {answers: values}
            }
            this.write({id: message.id, result: {answers}})
        } catch (error) {
            this.write({
                id: message.id,
                error: {
                    code: -32000,
                    message: redactOperatorSecrets(
                        error?.message ?? String(error),
                        this.childEnvironment,
                    ),
                },
            })
        }
    }

    write(message) {
        if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not running")
        this.recorder?.record("outbound", redactOperatorSecrets(message, this.childEnvironment))
        this.child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    request(method, params = {}) {
        const pending = this.tracker.create(method, params)
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

    notify(method, params) {
        this.write(params === undefined ? {method} : {method, params})
    }

    setWorkspace(workspaceRoot) {
        this.workspaceRoot = workspaceRoot
        this.emit("state", this.state())
    }

    setExecutionPolicy(executionPolicy = {}) {
        this.executionPolicy = {
            sandbox: executionPolicy.sandbox ?? "workspace-write",
            approvalPolicy: executionPolicy.approvalPolicy ?? "never",
        }
    }

    listThreads(options = {}) {
        return this.request("thread/list", {
            limit: options.limit ?? 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: [],
            archived: options.archived ?? false,
            cwd: this.workspaceRoot,
            ...(options.cursor ? {cursor: options.cursor} : {}),
        })
    }

    listModels() {
        return this.request("model/list", {limit: 100, includeHidden: false})
    }

    listSkills(options = {}) {
        return this.request("skills/list", {
            cwds: [this.workspaceRoot],
            forceReload: Boolean(options.forceReload),
        })
    }

    listPlugins() {
        return this.request("plugin/list", {cwds: [this.workspaceRoot]})
    }

    listInstalledPlugins() {
        return this.request("plugin/installed", {cwds: [this.workspaceRoot]})
    }

    readPlugin(input) {
        return this.request("plugin/read", input)
    }

    installPlugin(input) {
        return this.request("plugin/install", input)
    }

    readThread(threadId) {
        return this.request("thread/read", {threadId, includeTurns: true})
    }

    async readThreadForCapture(threadId, options = {}) {
        const metadata = await this.request("thread/read", {threadId, includeTurns: false})
        const anchorItemId = options.pendingStartUserItemId ?? options.afterUserItemId ?? null
        const turnLimit = anchorItemId
            ? CAPTURE_INCREMENTAL_TURN_LIMIT
            : CAPTURE_INITIAL_TURN_LIMIT
        const turns = []
        const seenCursors = new Set()
        let cursor = null
        let anchorFound = false
        let exhausted = false
        try {
            while (turns.length < turnLimit) {
                const page = await this.request("thread/turns/list", {
                    threadId,
                    ...(cursor ? {cursor} : {}),
                    limit: CAPTURE_TURN_PAGE_SIZE,
                    sortDirection: "desc",
                    itemsView: "full",
                })
                for (const turn of page?.data ?? []) {
                    turns.push(compactCaptureTurn(turn))
                    if (turnHasUserItem(turn, anchorItemId)) {
                        anchorFound = true
                        break
                    }
                    if (turns.length >= turnLimit) break
                }
                if (anchorFound) break
                const nextCursor = page?.nextCursor ?? null
                if (!nextCursor || seenCursors.has(nextCursor)) {
                    exhausted = true
                    break
                }
                seenCursors.add(nextCursor)
                cursor = nextCursor
            }
            return {
                ...metadata,
                thread: {...metadata.thread, turns: turns.reverse()},
                history: {
                    mode: "paginated",
                    anchorFound,
                    truncated: !anchorFound && !exhausted,
                },
            }
        } catch (error) {
            if (!capturePaginationUnavailable(error)) throw error
            const legacy = await this.request("thread/read", {threadId, includeTurns: true})
            const bounded = boundedCaptureTurns(legacy?.thread?.turns ?? [], {
                anchorItemId,
                limit: turnLimit,
            })
            return {
                ...legacy,
                thread: {...metadata.thread, ...legacy.thread, turns: bounded.turns},
                history: {mode: "legacy-fallback", ...bounded},
            }
        }
    }

    setThreadName(threadId, name) {
        return this.request("thread/name/set", {threadId, name})
    }

    async startThread(options = {}) {
        const dynamicTools = Object.hasOwn(options, "dynamicTools")
            ? JSON.parse(JSON.stringify(options.dynamicTools))
            : null
        const response = await this.request("thread/start", {
            cwd: this.workspaceRoot,
            approvalPolicy: options.approvalPolicy ?? this.executionPolicy.approvalPolicy,
            sandbox: options.sandbox ?? this.executionPolicy.sandbox,
            ephemeral: options.ephemeral ?? false,
            sessionStartSource: "startup",
            threadSource: options.threadSource ?? "user",
            ...(options.model ? {model: options.model} : {}),
            ...(dynamicTools ? {dynamicTools} : {}),
        })
        if (this.registerDynamicTools(response.thread.id, dynamicTools)) {
            this.beginDynamicTurnPhase(response.thread.id, "idle")
        } else {
            this.dynamicToolTurnStates.delete(response.thread.id)
        }
        return response
    }

    async resumeThread(threadId, options = {}) {
        const dynamicTools = Object.hasOwn(options, "dynamicTools")
            ? JSON.parse(JSON.stringify(options.dynamicTools))
            : null
        const turnState = this.beginDynamicTurnPhase(threadId, "resuming")
        try {
            const response = await this.request("thread/resume", {
                threadId,
                cwd: options.cwd ?? this.workspaceRoot,
                approvalPolicy: options.approvalPolicy ?? this.executionPolicy.approvalPolicy,
                sandbox: options.sandbox ?? this.executionPolicy.sandbox,
                ...(options.model ? {model: options.model} : {}),
                ...(dynamicTools ? {dynamicTools} : {}),
            })
            if (this.dynamicToolTurnStates.get(threadId)?.generation !== turnState.generation) {
                return response
            }
            if (this.registerDynamicTools(threadId, dynamicTools)) {
                turnState.phase = "idle"
                turnState.turnId = null
            } else {
                this.dynamicToolTurnStates.delete(threadId)
            }
            return response
        } catch (error) {
            if (this.dynamicToolTurnStates.get(threadId)?.generation === turnState.generation) {
                turnState.phase = "terminal"
                turnState.turnId = null
            }
            throw error
        }
    }

    async startTurn(threadId, text, options = {}) {
        const input = Array.isArray(text)
            ? text
            : [{type: "text", text, text_elements: []}]
        const params = {
            threadId,
            input,
            ...(Object.hasOwn(options, "model") ? {model: options.model ?? null} : {}),
            ...(Object.hasOwn(options, "effort") ? {effort: options.effort ?? null} : {}),
            ...(Object.hasOwn(options, "approvalPolicy")
                ? {approvalPolicy: options.approvalPolicy ?? null}
                : {}),
            ...(Object.hasOwn(options, "sandbox")
                ? {sandboxPolicy: turnSandboxPolicy(options.sandbox)}
                : {}),
        }
        if (!this.dynamicToolThreads.has(threadId)) return this.request("turn/start", params)
        const current = this.dynamicToolTurnStates.get(threadId)
        if (current?.phase === "starting" || current?.phase === "active") {
            throw new Error("Codex Operator turn is already in progress")
        }
        if (!current || (current.phase !== "idle" && current.phase !== "terminal")) {
            throw new Error("Codex Operator thread is not ready")
        }
        const turnState = this.beginDynamicTurnPhase(threadId, "starting")
        try {
            const response = await this.request("turn/start", params)
            const current = this.dynamicToolTurnStates.get(threadId)
            if (current?.generation !== turnState.generation) return response
            const turnId = response?.turn?.id
            if (typeof turnId !== "string" || turnId.length === 0) {
                current.phase = "terminal"
                current.turnId = null
                throw new Error("Codex turn/start did not return a turn identity")
            }
            if (current.turnId !== null && current.turnId !== turnId) {
                current.phase = "terminal"
                throw new Error("Codex turn/start returned a mismatched turn identity")
            }
            const completedBeforeResponse = current.preResponseTerminalIds.has(turnId)
            const terminalOverflow = current.preResponseTerminalOverflow
            current.preResponseTerminalIds.clear()
            current.preResponseTerminalOverflow = false
            current.turnId = turnId
            if (current.phase !== "terminal") {
                current.phase = terminalOverflow || completedBeforeResponse ||
                    TERMINAL_TURN_STATUSES.has(response.turn.status)
                    ? "terminal"
                    : "active"
            }
            return response
        } catch (error) {
            const current = this.dynamicToolTurnStates.get(threadId)
            if (current?.generation === turnState.generation) {
                current.phase = "terminal"
                current.preResponseTerminalIds.clear()
                current.preResponseTerminalOverflow = false
            }
            throw error
        }
    }

    async runEvaluationCase(input = {}) {
        const startedAt = Date.now()
        const traceMark = this.recorder?.mark?.() ?? null
        const threadResponse = await this.startThread({
            model: input.modelId,
            threadSource: "subagent",
            ephemeral: false,
        })
        const threadId = threadResponse.thread.id
        input.onThreadStarted?.(threadId)
        const prompt =
            input.activationMode === "explicit" && input.skillReference?.name && input.skillReference?.path
                ? [
                      {
                          type: "skill",
                          name: input.skillReference.name,
                          path: input.skillReference.path,
                      },
                      {type: "text", text: input.question, text_elements: []},
                  ]
                : input.question
        let turnId = null
        let responseText = ""
        let lastActivityAt = new Date().toISOString()
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup()
                if (turnId) void this.interruptTurn(threadId, turnId).catch(() => {})
                reject(evaluationTurnError("The evaluation turn timed out", {
                    code: "EVALUATION_TURN_TIMEOUT",
                    recorder: this.recorder,
                    traceMark,
                    threadId,
                    turnId,
                    startedAt,
                    lastActivityAt,
                }))
            }, input.timeoutMs ?? 30 * 60 * 1000)
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
                lastActivityAt = new Date().toISOString()
                if (message.method === "item/agentMessage/delta") {
                    responseText += params.delta ?? ""
                } else if (
                    message.method === "item/completed" &&
                    params.item?.type === "agentMessage" &&
                    params.item.text
                ) {
                    responseText = params.item.text
                } else if (message.method === "turn/completed") {
                    turnId = params.turn?.id ?? turnId
                    cleanup()
                    if (params.turn?.status === "failed") {
                        reject(
                            new Error(
                                params.turn.error?.message ?? "The evaluation turn failed",
                            ),
                        )
                    } else {
                        resolve()
                    }
                } else if (message.method === "error" && !params.willRetry) {
                    cleanup()
                    reject(new Error(params.error?.message ?? "The evaluation turn failed"))
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The evaluation runtime stopped before completion"))
            }
            cleanup = () => {
                clearTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        try {
            const turnResponse = await this.startTurn(threadId, prompt, {
                model: input.modelId,
                effort: input.effort,
            })
            turnId = turnResponse.turn.id
            await completed
        } catch (error) {
            cleanup()
            throw error
        }
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
        const threadResponse = await this.startThread({
            model: input.modelId,
            threadSource: "subagent",
            ephemeral: true,
            sandbox: "read-only",
            approvalPolicy: "never",
        })
        const threadId = threadResponse.thread.id
        input.onThreadStarted?.(threadId)
        let turnId = null
        let responseText = ""
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup()
                if (turnId) void this.interruptTurn(threadId, turnId).catch(() => {})
                reject(new Error("The evaluation Judge turn timed out"))
            }, input.timeoutMs ?? 30 * 60 * 1000)
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
                if (message.method === "item/agentMessage/delta") {
                    responseText += params.delta ?? ""
                } else if (
                    message.method === "item/completed" &&
                    params.item?.type === "agentMessage" &&
                    params.item.text
                ) {
                    responseText = params.item.text
                } else if (message.method === "turn/completed") {
                    turnId = params.turn?.id ?? turnId
                    cleanup()
                    if (params.turn?.status === "failed") {
                        reject(
                            new Error(
                                params.turn.error?.message ?? "The evaluation Judge turn failed",
                            ),
                        )
                    } else {
                        resolve()
                    }
                } else if (message.method === "error" && !params.willRetry) {
                    cleanup()
                    reject(new Error(params.error?.message ?? "The evaluation Judge turn failed"))
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The evaluation Judge runtime stopped before completion"))
            }
            cleanup = () => {
                clearTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        try {
            const turnResponse = await this.startTurn(threadId, input.prompt, {
                model: input.modelId,
                effort: input.effort,
                sandbox: "read-only",
                approvalPolicy: "never",
            })
            turnId = turnResponse.turn.id
            await completed
        } catch (error) {
            cleanup()
            throw error
        }
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

    interruptTurn(threadId, turnId) {
        return this.request("turn/interrupt", {threadId, turnId})
    }

    archiveThread(threadId) {
        return this.request("thread/archive", {threadId})
    }

    unarchiveThread(threadId) {
        return this.request("thread/unarchive", {threadId})
    }

    recentTrace(limit) {
        return {
            path: this.recorder?.path ?? null,
            reference: this.recorder?.latestReference ?? null,
            events: this.recorder?.readRecent(limit) ?? [],
        }
    }

    async stop() {
        if (!this.child) return
        this.stopping = true
        const child = this.child
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL")
                resolve()
            }, this.shutdownTimeoutMs)
            child.once("close", () => {
                clearTimeout(timeout)
                resolve()
            })
            child.kill("SIGTERM")
        })
        if (this.child === child) this.handleExit(new Error("Codex app-server stopped"))
    }
}

module.exports = {CodexAppServerClient}
