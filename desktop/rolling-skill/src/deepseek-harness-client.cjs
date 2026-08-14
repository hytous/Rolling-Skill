const {randomUUID} = require("node:crypto")
const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {dirname} = require("node:path")

const {evaluationTurnError} = require("./evaluation-turn-error.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")

const DEFAULT_POLL_INTERVAL_MS = 180
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000

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
                    text,
                })
            }
            continue
        }
        if (event.type === "turn/end") {
            const turn = ensureTurn(event.data.turn)
            const kind = event.data.reason?.kind
            turn.status = kind === "completed" ? "completed" : kind === "aborted" ? "interrupted" : "failed"
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
        pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
        startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.spawnProcess = spawnProcess
        this.fetchImpl = fetchImpl
        this.pollIntervalMs = pollIntervalMs
        this.startupTimeoutMs = startupTimeoutMs
        this.child = null
        this.baseUrl = null
        this.ready = false
        this.stopping = false
        this.initialization = null
        this.recorder = null
        this.pendingTurns = new Map()
        this.catalogSessionId = null
        this.processEpoch = 0
        this.recordedEventSequences = new Map()
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
        this.recorder = new TraceRecorder(this.traceDirectory, {
            sessionId: `deepseek-harness-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            runtime: this.runtimeDescriptor,
        })
        const epoch = ++this.processEpoch
        const child = this.spawnProcess(
            this.binaryPath,
            ["--profile", "web", "--port", "0"],
            {
                cwd: this.workspaceRoot,
                env: {
                    ...process.env,
                    PATH: `${dirname(this.binaryPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
                },
                shell: false,
                stdio: ["ignore", "pipe", "pipe"],
            },
        )
        this.child = child
        this.emit("state", this.state())
        child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim()
            if (text) this.emit("runtimeLog", text)
        })
        child.once("error", (error) => this.handleExit(error, child, epoch))
        child.once("close", (code, signal) => {
            this.handleExit(new Error(
                `DeepSeek Harness Host exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
            ), child, epoch)
        })

        try {
            this.baseUrl = await this.waitForHostUrl(child, epoch)
            await this.request("host.describe", {})
            if (this.child !== child || this.processEpoch !== epoch) {
                throw new Error("DeepSeek Harness Host changed during startup")
            }
            this.ready = true
            this.emit("state", this.state())
            return this.state()
        } catch (error) {
            if (this.child === child && !child.killed) child.kill("SIGTERM")
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

    handleExit(error, child = this.child, epoch = this.processEpoch) {
        if (this.child !== child || this.processEpoch !== epoch) return
        this.child = null
        this.baseUrl = null
        this.ready = false
        this.pendingTurns.clear()
        this.emit("state", {...this.state(), error: this.stopping ? null : error.message})
        if (!this.stopping) this.emit("runtimeError", error)
    }

    async request(method, payload = {}) {
        if (!this.baseUrl) throw new Error("DeepSeek Harness Host is not running")
        const rpcId = randomUUID()
        const envelope = {type: "client-request", rpcId, method, payload}
        this.recorder?.record("outbound", {method, params: payload, rpcId})
        let response
        try {
            response = await this.fetchImpl(`${this.baseUrl}/api/${method}`, {
                method: "POST",
                headers: {"content-type": "application/json", accept: "application/json"},
                body: JSON.stringify(envelope),
            })
        } catch (error) {
            throw new Error(`DeepSeek Harness ${method} request failed: ${error?.message ?? String(error)}`)
        }
        let body
        try {
            body = await response.json()
        } catch {
            throw new Error(`DeepSeek Harness ${method} returned an invalid response (${response.status})`)
        }
        if (!response.ok || body?.type !== "server-response" || body.rpcId !== rpcId || !body?.result?.ok) {
            const failure = body?.result?.error ?? {}
            const error = new Error(failure.message ?? `DeepSeek Harness ${method} failed (${response.status})`)
            error.code = failure.code ?? `HTTP_${response.status}`
            error.details = failure.details ?? null
            this.recorder?.record("inbound", {method, rpcId, error: failure})
            throw error
        }
        if (method !== "session.history") {
            this.recorder?.record("inbound", {method, rpcId, result: body.result.value})
        }
        return body.result.value
    }

    setWorkspace(workspaceRoot) {
        this.workspaceRoot = workspaceRoot
        this.catalogSessionId = null
        this.emit("state", this.state())
    }

    async listModels() {
        const catalog = await this.request("llm.models", {})
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
        this.recorder?.record("inbound", {method: "thread/read", result: {thread}})
        return {thread}
    }

    async ensureCatalogSession() {
        if (this.catalogSessionId) return this.catalogSessionId
        const {items} = await this.listSessionSummaries()
        const existing = items.find((entry) => entry.cwd === this.workspaceRoot)
        if (existing) {
            this.catalogSessionId = existing.sessionId
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
            chunks: new Map(),
            toolCalls: new Map(),
            stopped: false,
        }
        this.pendingTurns.set(threadId, pending)
        this.emitNotification("turn/started", {threadId, turn})
        void this.watchTurn(pending)
        return {turn}
    }

    emitNotification(method, params) {
        const message = {method, params}
        this.emit("notification", message)
        this.emit(method, params)
    }

    recordHistoryEvents(sessionId, entries) {
        let recorded = this.recordedEventSequences.get(sessionId)
        if (!recorded) {
            recorded = new Set()
            this.recordedEventSequences.set(sessionId, recorded)
        }
        for (const entry of entries ?? []) {
            const event = entry?.event
            if (!event || recorded.has(event.seq)) continue
            if (!["user/message", "assistant/message", "tool/call", "tool/result", "turn/end", "session/title"].includes(event.type)) {
                continue
            }
            recorded.add(event.seq)
            let item = null
            if (event.type === "tool/call") item = toolItem({...event, view: entry.view})
            this.recorder?.record("inbound", {
                method: "session/event",
                params: {threadId: sessionId, event, ...(item ? {item} : {})},
            })
        }
    }

    processLiveEntries(pending, entries) {
        this.recordHistoryEvents(pending.threadId, entries)
        for (const entry of entries) {
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
                const callId = event.data?.message?.content?.find(
                    (block) => block?.type === "tool-result",
                )?.toolCallId ?? event.data?.message?.source?.callId
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
        }
    }

    async watchTurn(pending) {
        try {
            while (!this.stopping && !pending.stopped && this.pendingTurns.get(pending.threadId) === pending) {
                const tail = await this.historyTail(pending.threadId)
                const fresh = (tail.events ?? []).filter((entry) => entry.event?.seq > pending.lastSeq)
                if (fresh.length) {
                    pending.lastSeq = fresh.at(-1).event.seq
                    this.processLiveEntries(pending, fresh)
                }
                const ended = (tail.events ?? []).find(
                    (entry) => entry.event?.type === "turn/end" && entry.event.data.turn === pending.turnNumber,
                )
                if (ended) {
                    const thread = threadFromHistory({
                        summary: {
                            sessionId: pending.threadId,
                            updatedAt: ended.event.time,
                            running: false,
                            cwd: this.workspaceRoot,
                        },
                        entries: tail.events ?? [],
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
                    return
                }
                await delay(this.pollIntervalMs)
            }
        } catch (error) {
            if (this.stopping || pending.stopped) return
            this.pendingTurns.delete(pending.threadId)
            this.emitNotification("error", {
                threadId: pending.threadId,
                turnId: pending.turnId,
                error: {message: error?.message ?? String(error)},
                willRetry: false,
            })
            this.emitNotification("turn/completed", {
                threadId: pending.threadId,
                turn: {
                    id: pending.turnId,
                    status: "failed",
                    items: [],
                    error: {message: error?.message ?? String(error)},
                },
            })
        }
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
                if (turn?.status === "failed") reject(new Error(turn.error?.message ?? "The DeepSeek Harness turn failed"))
                else resolve(turn)
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
        })
        return output
    }

    async stop() {
        this.stopping = true
        for (const pending of this.pendingTurns.values()) pending.stopped = true
        this.pendingTurns.clear()
        const child = this.child
        const epoch = this.processEpoch
        if (!child) return
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
