const {createHash} = require("node:crypto")
const {appendFileSync, chmodSync, constants, mkdirSync, openSync, closeSync, readSync} = require("node:fs")
const {join} = require("node:path")
const {skillContentDigest} = require("./skill-content.cjs")

const TRACE_READ_BUFFER_BYTES = 64 * 1_024

function safeSessionId(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120)
}

function parseOwnedReference(reference, fileName, maximumLine) {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = String(reference ?? "").match(
        new RegExp(`^trace://${escaped}#L([1-9]\\d*)(?:-L([1-9]\\d*))?$`),
    )
    const start = Number(match?.[1])
    const end = Number(match?.[2] ?? match?.[1])
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end > maximumLine) {
        throw new Error("Invalid or foreign trace reference")
    }
    return {start, end}
}

function *traceJsonLines(path, {start = 1, end = Number.POSITIVE_INFINITY} = {}) {
    const descriptor = openSync(
        path,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    )
    const buffer = Buffer.allocUnsafe(TRACE_READ_BUFFER_BYTES)
    let lineNumber = 1
    let fragments = []
    try {
        while (lineNumber <= end) {
            const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
            if (bytesRead === 0) break
            let fragmentStart = 0
            for (let index = 0; index < bytesRead; index += 1) {
                if (buffer[index] !== 0x0a) continue
                if (lineNumber >= start && lineNumber <= end) {
                    fragments.push(Buffer.from(buffer.subarray(fragmentStart, index)))
                    const line = Buffer.concat(fragments).toString("utf8").trim()
                    if (line) yield {lineNumber, entry: JSON.parse(line)}
                }
                fragments = []
                lineNumber += 1
                fragmentStart = index + 1
                if (lineNumber > end) break
            }
            if (
                fragmentStart < bytesRead &&
                lineNumber >= start &&
                lineNumber <= end
            ) {
                fragments.push(Buffer.from(buffer.subarray(fragmentStart, bytesRead)))
            }
        }
        if (fragments.length && lineNumber >= start && lineNumber <= end) {
            const line = Buffer.concat(fragments).toString("utf8").trim()
            if (line) yield {lineNumber, entry: JSON.parse(line)}
        }
    } finally {
        closeSync(descriptor)
    }
}

function historyItemIndex(item) {
    return {
        id: item?.id ?? null,
        type: item?.type ?? null,
    }
}

function historyTurnIndex(turn) {
    return {
        id: turn?.id ?? null,
        status: turn?.status ?? null,
        itemsView: turn?.itemsView ?? null,
        items: Array.isArray(turn?.items) ? turn.items.map(historyItemIndex) : [],
    }
}

function compactHistoricalResponse(method, message) {
    if (method === "thread/read" && message?.result?.thread) {
        const thread = message.result.thread
        return {
            ...message,
            result: {
                ...message.result,
                thread: {
                    id: thread.id ?? null,
                    sessionId: thread.sessionId ?? null,
                    forkedFromId: thread.forkedFromId ?? null,
                    parentThreadId: thread.parentThreadId ?? null,
                    cwd: thread.cwd ?? null,
                    modelProvider: thread.modelProvider ?? null,
                    status: thread.status ?? null,
                    turns: Array.isArray(thread.turns) ? thread.turns.map(historyTurnIndex) : [],
                },
            },
        }
    }
    if (method === "thread/turns/list" && Array.isArray(message?.result?.data)) {
        return {
            ...message,
            result: {
                ...message.result,
                data: message.result.data.map(historyTurnIndex),
            },
        }
    }
    return message
}

function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function nestedObjects(value, output = []) {
    if (!value || typeof value !== "object") return output
    if (!Array.isArray(value)) output.push(value)
    for (const child of Object.values(value)) nestedObjects(child, output)
    return output
}

function hasFailure(value) {
    return nestedObjects(value).some((candidate) => {
        const status = String(candidate.status ?? candidate.outcome ?? "").toLowerCase()
        return (
            (Object.hasOwn(candidate, "error") && candidate.error !== null && candidate.error !== undefined) ||
            ["failed", "error", "rejected", "cancelled"].includes(status)
        )
    })
}

function codeBuddyUpdate(entry) {
    return object(entry?.message?.params?.update)
}

function dshEvent(entry) {
    const message = object(entry?.message)
    if (!["events.mux", "session/event"].includes(message.method)) return null
    const params = object(message.params)
    if (message.method === "events.mux" && params.type !== "session/event") return null
    return params.event && typeof params.event === "object" ? params.event : null
}

function codeBuddyToolInput(update) {
    const rawInput = object(update.rawInput)
    return Object.keys(rawInput).length ? rawInput : null
}

function isSemanticTraceEntry(entry) {
    const message = object(entry?.message)
    const method = String(message.method ?? "")
    if (hasFailure(message)) return true
    if (!method) return Boolean(message.result)

    if (method === "events.mux") {
        const event = dshEvent(entry)
        if (!event) return !["session/projection", "session/queue", "session/subscribed"].includes(message.params?.type)
        return !["assistant/chunk", "request/header", "request/context", "session/title", "session/title-llm-request"].includes(event.type)
    }

    if (method === "session/update") {
        const update = codeBuddyUpdate(entry)
        const type = String(update.sessionUpdate ?? "")
        if (type === "tool_call") return Boolean(codeBuddyToolInput(update))
        if (type === "tool_call_update") {
            return ["completed", "failed", "error", "rejected", "cancelled"].includes(
                String(update.status ?? "").toLowerCase(),
            )
        }
        return ![
            "agent_message_chunk",
            "agent_thought_chunk",
            "session_info_update",
            "usage_update",
            "config_option_update",
            "available_commands_update",
            "plan",
        ].includes(type)
    }

    if (
        /(?:\/delta|\/outputDelta)$/u.test(method) ||
        [
            "thread/tokenUsage/updated",
            "account/rateLimits/updated",
            "mcpServer/startupStatus/updated",
            "thread/status/changed",
            "thread/settings/updated",
            "remoteControl/status/changed",
            "initialized",
        ].includes(method)
    ) {
        return false
    }

    if (method === "item/started" || method === "item/completed") {
        const item = object(message.params?.item)
        if (["reasoning", "userMessage"].includes(item.type)) return false
        if (item.type === "agentMessage") return method === "item/completed"
    }
    return true
}

function compactText(value, limit) {
    const text = String(value)
    if (text.length <= limit) return {text, omitted: 0}
    const marker = `\n… [${text.length - limit} characters compacted] …\n`
    const available = Math.max(0, limit - marker.length)
    const head = Math.ceil(available * 0.7)
    const tail = available - head
    return {
        text: `${text.slice(0, head)}${marker}${tail ? text.slice(-tail) : ""}`,
        omitted: text.length - limit,
    }
}

function isProtectedCommandPath(path) {
    const key = path.at(-1)
    return ["command", "cmd", "argv"].includes(key)
}

function compactStrings(value, {limit, aggressive = false, path = [], stats}) {
    if (typeof value === "string") {
        if (isProtectedCommandPath(path)) return value
        const outputPath = path.some((entry) =>
            /^(?:aggregatedOutput|rawOutput|stdout|stderr|output|outputDelta)$/iu.test(entry),
        )
        const stringLimit = outputPath ? Math.min(limit, 400) : aggressive ? Math.min(limit, 320) : limit
        const compacted = compactText(value, stringLimit)
        if (compacted.omitted) {
            stats.omittedCharacters += compacted.omitted
            stats.compacted = true
        }
        return compacted.text
    }
    if (Array.isArray(value)) {
        return value.map((entry, index) => compactStrings(entry, {
            limit,
            aggressive,
            path: [...path, String(index)],
            stats,
        }))
    }
    if (!value || typeof value !== "object") return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        compactStrings(child, {limit, aggressive, path: [...path, key], stats}),
    ]))
}

function semanticMessageProjection(entry, maxCharacters, stats) {
    const message = object(entry.message)
    const params = object(message.params)
    const update = object(params.update)
    const item = object(params.item)
    const event = dshEvent(entry)
    const projected = {
        schemaVersion: entry.schemaVersion,
        sequence: entry.sequence,
        recordedAt: entry.recordedAt,
        direction: entry.direction,
        runtime: entry.runtime,
        message: {
            ...(message.id === undefined ? {} : {id: message.id}),
            ...(message.method ? {method: message.method} : {}),
            ...(event ? {params: {type: params.type, sessionId: params.sessionId, event: {type: event.type, seq: event.seq, time: event.time, data: event.data}}} : {}),
            ...(Object.keys(update).length ? {params: {update: {
                sessionUpdate: update.sessionUpdate,
                toolCallId: update.toolCallId,
                title: update.title,
                kind: update.kind,
                status: update.status,
                rawInput: update.rawInput,
                locations: update.locations,
                error: update.error,
                rawOutput: update.rawOutput,
                rawOutputDigest: update.rawOutputDigest,
                skillContentDigest: update.skillContentDigest,
                startedSequence: update.startedSequence,
                _meta: {
                    "codebuddy.ai/toolName": update._meta?.["codebuddy.ai/toolName"],
                },
            }}} : {}),
            ...(Object.keys(item).length ? {params: {item: {
                id: item.id,
                type: item.type,
                command: item.command,
                status: item.status,
                path: item.path,
                server: item.server,
                tool: item.tool,
                error: item.error,
                aggregatedOutput: item.aggregatedOutput,
            }}} : {}),
            ...(!Object.keys(update).length && !Object.keys(item).length && params.turn
                ? {params: {turn: params.turn}}
                : {}),
            ...(message.error ? {error: message.error} : {}),
            ...(message.result ? {result: message.result} : {}),
        },
    }
    stats.compacted = true
    const projectedStats = {compacted: false, omittedCharacters: 0}
    const compacted = compactStrings(projected, {
        limit: Math.max(80, Math.floor(maxCharacters / 5)),
        aggressive: true,
        stats: projectedStats,
    })
    stats.omittedCharacters += projectedStats.omittedCharacters
    return compacted
}

function compactJsonEntry(entry, maxCharacters) {
    const originalSize = JSON.stringify(entry).length
    const stats = {compacted: false, omittedCharacters: 0}
    const codeBuddyType = codeBuddyUpdate(entry).sessionUpdate
    let compacted = ["tool_call", "tool_call_update"].includes(codeBuddyType)
        ? semanticMessageProjection(entry, maxCharacters, stats)
        : compactStrings(entry, {limit: 1_200, stats})
    if (JSON.stringify(compacted).length > maxCharacters) {
        compacted = compactStrings(entry, {limit: 320, aggressive: true, stats})
    }
    if (JSON.stringify(compacted).length > maxCharacters) {
        compacted = semanticMessageProjection(entry, maxCharacters, stats)
    }
    const finalSize = JSON.stringify(compacted).length
    if (finalSize < originalSize) {
        stats.compacted = true
        stats.omittedCharacters = Math.max(stats.omittedCharacters, originalSize - finalSize)
    }
    return {
        ...compacted,
        ...(stats.compacted ? {
            contentCompacted: true,
            omittedCharacters: stats.omittedCharacters,
        } : {}),
    }
}

function augmentCodeBuddyTerminalEntry(entry, starts) {
    const update = codeBuddyUpdate(entry)
    if (String(update.sessionUpdate) !== "tool_call_update" || !update.toolCallId) return entry
    const start = starts.get(update.toolCallId)
    if (!start) return entry
    const startUpdate = codeBuddyUpdate(start)
    const copy = JSON.parse(JSON.stringify(entry))
    copy.message.params.update = {
        ...startUpdate,
        ...copy.message.params.update,
        rawInput: copy.message.params.update.rawInput ?? startUpdate.rawInput,
        kind: copy.message.params.update.kind ?? startUpdate.kind,
        title: copy.message.params.update.title ?? startUpdate.title,
        locations: copy.message.params.update.locations ?? startUpdate.locations,
        _meta: {...startUpdate._meta, ...copy.message.params.update._meta},
        startedSequence: start.sequence,
    }
    return copy
}

function attachCodeBuddyOutputDigests(entry) {
    const update = codeBuddyUpdate(entry)
    if (String(update.sessionUpdate) !== "tool_call_update" || !update.rawOutput) return entry
    const copy = JSON.parse(JSON.stringify(entry))
    const target = copy.message.params.update
    target.rawOutputDigest = evidenceDigest(update.rawOutput)
    const outputText = typeof update.rawOutput?.text === "string" ? update.rawOutput.text : null
    if (update.rawInput?.skill && outputText !== null) {
        target.skillContentDigest = skillContentDigest(outputText)
    }
    return copy
}

function isCodeBuddyTerminalUpdate(update) {
    return update.sessionUpdate === "tool_call_update" &&
        Boolean(update.toolCallId) &&
        ["completed", "failed", "error", "rejected", "cancelled"].includes(
            String(update.status ?? "").toLowerCase(),
        )
}

function entryPriority(entry) {
    if (hasFailure(entry.message)) return 100
    const event = dshEvent(entry)
    if (event?.type === "user/message" && event.data?.source?.kind === "skill-invocation") return 95
    if (["tool/call", "tool/result"].includes(event?.type)) return event.data?.name === "skill" || event.data?.call?.name === "skill" ? 95 : 80
    if (["assistant/message", "turn/end"].includes(event?.type)) return 60
    const update = codeBuddyUpdate(entry)
    if (update.rawInput?.skill || update.kind === "read") return 95
    const method = String(entry.message?.method ?? "")
    const itemType = String(entry.message?.params?.item?.type ?? "")
    if (/commandExecution|mcpToolCall|dynamicToolCall|fileChange|tool_call/iu.test(`${method} ${itemType} ${update.sessionUpdate ?? ""}`)) {
        return 80
    }
    if (/turn\/completed|agentMessage/iu.test(`${method} ${itemType}`)) return 60
    return 30
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) =>
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
        ).join(",")}}`
    }
    return JSON.stringify(value)
}

function evidenceDigest(value) {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

class TraceRecorder {
    constructor(directory, options = {}) {
        mkdirSync(directory, {recursive: true, mode: 0o700})
        const sessionId = safeSessionId(options.sessionId ?? `runtime-${Date.now()}`)
        this.path = join(directory, `${sessionId}.jsonl`)
        this.fileName = `${sessionId}.jsonl`
        this.line = 0
        this.latestReference = null
        this.requestMethods = new Map()
        this.runtime = options.runtime
            ? {
                  runtimeId: options.runtime.runtimeId,
                  providerId: options.runtime.providerId,
                  version: options.runtime.version,
              }
            : null
    }

    record(direction, message) {
        const requestId = message?.id === undefined || message?.id === null
            ? null
            : String(message.id)
        if (direction === "outbound" && requestId && message?.method) {
            this.requestMethods.set(requestId, message.method)
        }
        const inboundResponse = direction === "inbound" &&
            requestId &&
            !message?.method &&
            (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))
        const requestMethod = inboundResponse
            ? this.requestMethods.get(requestId)
            : null
        const recordedMessage = requestMethod
            ? compactHistoricalResponse(requestMethod, message)
            : message
        if (inboundResponse) this.requestMethods.delete(requestId)
        this.line += 1
        const entry = {
            schemaVersion: "rolling-skill-trace/v1",
            sequence: this.line,
            recordedAt: new Date().toISOString(),
            direction,
            message: recordedMessage,
            runtime: this.runtime,
        }
        const descriptor = openSync(
            this.path,
            constants.O_WRONLY |
                constants.O_CREAT |
                constants.O_APPEND |
                (constants.O_NOFOLLOW ?? 0),
            0o600,
        )
        try {
            appendFileSync(descriptor, `${JSON.stringify(entry)}\n`, "utf8")
        } finally {
            closeSync(descriptor)
        }
        chmodSync(this.path, 0o600)
        this.latestReference = `trace://${this.fileName}#L${this.line}`
        return {entry, reference: this.latestReference}
    }

    mark() {
        return Object.freeze({fileName: this.fileName, line: this.line})
    }

    referenceFrom(mark) {
        if (mark?.fileName !== this.fileName || !Number.isSafeInteger(mark.line) || mark.line < 0 || mark.line > this.line) {
            throw new Error("Invalid trace mark")
        }
        if (this.line === mark.line) return null
        return `trace://${this.fileName}#L${mark.line + 1}-L${this.line}`
    }

    evidenceForReference(reference, options = {}) {
        const {start, end} = parseOwnedReference(reference, this.fileName, this.line)
        const maxEntries = Math.max(1, Math.min(Number(options.maxEntries) || 500, 1_000))
        const maxEntryCharacters = Math.max(
            200,
            Math.min(Number(options.maxEntryCharacters) || 4_000, 20_000),
        )
        const maxTotalCharacters = Math.max(
            1_000,
            Math.min(Number(options.maxTotalCharacters) || 240_000, 400_000),
        )
        const semanticEntries = []
        const codeBuddyStarts = new Map()
        const codeBuddyTerminalSequences = new Map()
        const dshCalls = new Map()
        let compactedEntries = 0
        let collapsedToolCallEntries = 0
        for (const {entry} of traceJsonLines(this.path, {start, end})) {
            const event = dshEvent(entry)
            if (event?.type === "tool/call" && event.data?.callId) {
                dshCalls.set(`${entry.message.params.sessionId}:${event.data.callId}`, {name: event.data.name, arguments: event.data.arguments, startedSequence: entry.sequence})
            }
            const update = codeBuddyUpdate(entry)
            if (update.sessionUpdate === "tool_call" && update.toolCallId && codeBuddyToolInput(update)) {
                codeBuddyStarts.set(update.toolCallId, entry)
            }
            if (isCodeBuddyTerminalUpdate(update)) {
                codeBuddyTerminalSequences.set(update.toolCallId, entry.sequence)
            }
        }
        // Re-open the trace for the semantic pass instead of retaining every raw
        // entry from the evidence range. This keeps memory bounded by one JSONL
        // record plus the deliberately compact semantic result set.
        for (const line of traceJsonLines(this.path, {start, end})) {
            let entry = line.entry
            const update = codeBuddyUpdate(entry)
            if (
                update.sessionUpdate === "tool_call" &&
                update.toolCallId &&
                codeBuddyTerminalSequences.has(update.toolCallId)
            ) {
                compactedEntries += 1
                collapsedToolCallEntries += 1
                continue
            }
            if (
                isCodeBuddyTerminalUpdate(update) &&
                codeBuddyTerminalSequences.get(update.toolCallId) !== entry.sequence
            ) {
                compactedEntries += 1
                collapsedToolCallEntries += 1
                continue
            }
            if (!isSemanticTraceEntry(entry)) {
                compactedEntries += 1
                continue
            }
            entry = augmentCodeBuddyTerminalEntry(entry, codeBuddyStarts)
            const event = dshEvent(entry)
            if (event?.type === "tool/result") {
                const call = dshCalls.get(`${entry.message.params.sessionId}:${event.data?.message?.source?.callId}`)
                if (call) entry = {...entry, message: {...entry.message, params: {...entry.message.params, event: {...event, data: {...event.data, call}}}}}
            }
            entry = attachCodeBuddyOutputDigests(entry)
            semanticEntries.push(compactJsonEntry(entry, Math.min(maxEntryCharacters, maxTotalCharacters)))
        }

        const ranked = semanticEntries
            .map((entry) => ({entry, priority: entryPriority(entry), size: JSON.stringify(entry).length}))
            .sort((left, right) => right.priority - left.priority || left.entry.sequence - right.entry.sequence)
        const selected = []
        let usedCharacters = 0
        for (const candidate of ranked) {
            if (selected.length >= maxEntries || usedCharacters + candidate.size > maxTotalCharacters) continue
            selected.push(candidate.entry)
            usedCharacters += candidate.size
        }
        const entries = selected.sort((left, right) => left.sequence - right.sequence)
        const omittedImportantEntries = semanticEntries.length - entries.length
        const evidence = {
            schemaVersion: "rolling-skill-trace-evidence/v1",
            reference,
            entries,
            sourceEntryCount: end - start + 1,
            includedEntries: entries.length,
            compactedEntries,
            collapsedToolCallEntries,
            contentCompactedEntries: entries.filter((entry) => entry.contentCompacted).length,
            omittedImportantEntries,
            samplingStrategy: "semantic-v2",
            semanticCoverageComplete: omittedImportantEntries === 0,
            truncated: omittedImportantEntries > 0,
            omittedEntries: omittedImportantEntries,
        }
        return {...evidence, digest: evidenceDigest(evidence)}
    }

    readRecent(limit = 200) {
        try {
            const maximum = Math.max(1, Math.min(limit, 1000))
            const recent = []
            for (const {entry} of traceJsonLines(this.path)) {
                recent.push(entry)
                if (recent.length > maximum) recent.shift()
            }
            return recent
        } catch {
            return []
        }
    }

    referenceForEpisode({threadId, startItemId, endItemId}) {
        try {
            let startLine = null
            let endLine = null
            for (const {entry: event} of traceJsonLines(this.path)) {
                const params = event.message?.params ?? {}
                const historicalThread = event.message?.result?.thread ?? null
                const eventThreadId =
                    params.threadId ?? params.thread?.id ?? historicalThread?.id ?? null
                if (eventThreadId !== threadId) continue
                const historicalItemIds = (historicalThread?.turns ?? []).flatMap((turn) =>
                    (turn.items ?? []).map((item) => item.id),
                )
                const itemIds = new Set([
                    params.itemId,
                    params.item?.id,
                    ...(params.turn?.items ?? []).map((item) => item.id),
                    ...historicalItemIds,
                ])
                if (startLine === null && itemIds.has(startItemId)) startLine = event.sequence
                if (itemIds.has(endItemId)) endLine = event.sequence
            }
            if (startLine !== null && endLine !== null && startLine <= endLine) {
                return `trace://${this.fileName}#L${startLine}-L${endLine}`
            }
        } catch {
            // Fall back to the last immutable append position when a range cannot be recovered.
        }
        return this.latestReference
    }
}

module.exports = {TraceRecorder, safeSessionId}
