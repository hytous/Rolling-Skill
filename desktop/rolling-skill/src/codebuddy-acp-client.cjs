const {randomUUID} = require("node:crypto")
const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {dirname} = require("node:path")
const {version: clientVersion} = require("../package.json")

const {JsonLineDecoder, RpcRequestTracker} = require("./json-rpc.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")

function textContent(value) {
    if (typeof value === "string") return value
    if (value?.type === "text") return String(value.text ?? "")
    return ""
}

class CodeBuddyAcpClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        spawnProcess = spawn,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.spawnProcess = spawnProcess
        this.child = null
        this.tracker = new RpcRequestTracker()
        this.recorder = null
        this.ready = false
        this.stopping = false
        this.initialization = null
        this.sessions = new Map()
        this.pendingTurns = new Map()
        this.modelCatalog = null
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
        this.child = this.spawnProcess(
            this.binaryPath,
            ["--acp", "--acp-transport", "stdio", "--permission-mode", "dontAsk"],
            {
                cwd: this.workspaceRoot,
                env: {
                    ...process.env,
                    PATH: `${dirname(this.binaryPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
                },
                shell: false,
                stdio: ["pipe", "pipe", "pipe"],
            },
        )
        this.emit("state", this.state())
        const decoder = new JsonLineDecoder(
            (message) => this.handleMessage(message),
            (error, line) => {
                this.recorder.record("decode-error", {line, error: error.message})
                this.emit("runtimeLog", `Invalid ACP message: ${error.message}`)
            },
        )
        this.child.stdout.on("data", (chunk) => decoder.push(chunk))
        this.child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim()
            if (!text) return
            this.recorder.record("stderr", {text})
            this.emit("runtimeLog", text)
        })
        this.child.once("error", (error) => this.handleExit(error))
        this.child.once("close", (code, signal) => {
            this.handleExit(
                new Error(
                    `CodeBuddy ACP exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
                ),
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

    handleExit(error) {
        if (!this.child) return
        this.child = null
        this.ready = false
        this.tracker.rejectAll(error)
        this.emit("state", {...this.state(), error: this.stopping ? null : error.message})
        if (!this.stopping) this.emit("runtimeError", error)
    }

    handleMessage(message) {
        this.recorder?.record("inbound", message)
        if (this.tracker.settle(message)) return
        if (message?.id !== undefined && message?.method) {
            this.write({
                jsonrpc: "2.0",
                id: message.id,
                error: {code: -32601, message: `Unsupported ACP client request: ${message.method}`},
            })
            return
        }
        if (message?.method === "session/update") this.handleSessionUpdate(message.params)
        if (message?.method) this.emit(message.method, message.params)
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
        this.recorder?.record("outbound", message)
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

    listThreads() {
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

    async configureSession(sessionId, options = {}) {
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
            mcpServers: [],
        })
        this.captureModels(response)
        await this.configureSession(response.sessionId, options)
        const now = Date.now() / 1000
        const thread = {
            id: response.sessionId,
            name: "New CodeBuddy task",
            preview: "",
            cwd: this.workspaceRoot,
            model: options.model ?? response.models?.currentModelId ?? null,
            effort: options.effort ?? null,
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
                mcpServers: [],
            })
            this.captureModels(response)
            const now = Date.now() / 1000
            this.sessions.set(threadId, {
                id: threadId,
                name: "CodeBuddy task",
                preview: "",
                cwd: this.workspaceRoot,
                model: options.model ?? response.models?.currentModelId ?? null,
                effort: options.effort ?? null,
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
        const response = await this.startThread({model: input.modelId, effort: input.effort})
        const threadId = response.thread.id
        const prompt =
            input.activationMode === "explicit" && input.skillReference?.name
                ? `/${input.skillReference.name}\n\n${input.question}`
                : input.question
        let turnId = null
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup()
                reject(new Error("The evaluation turn timed out"))
            }, input.timeoutMs ?? 30 * 60 * 1000)
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
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
                clearTimeout(timeout)
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
        return {
            threadId,
            turnId,
            response: responseText,
            durationMs: Date.now() - startedAt,
            traceReference: this.recorder?.latestReference ?? null,
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
            }, 2_000)
            child.once("close", () => {
                clearTimeout(timeout)
                resolve()
            })
            child.kill("SIGTERM")
        })
    }
}

module.exports = {CodeBuddyAcpClient, textContent}
