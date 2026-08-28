const {createHash, randomUUID} = require("node:crypto")
const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {isAbsolute, join, resolve} = require("node:path")

function requiredText(value, label) {
    const normalized = String(value ?? "").trim()
    if (!normalized || normalized.length > 200) throw new Error(`${label} is required`)
    return normalized
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== "object") return value
    const normalized = {}
    for (const key of Object.keys(value).sort()) normalized[key] = stableValue(value[key])
    return normalized
}

function stableJson(value) {
    return `${JSON.stringify(stableValue(value))}\n`
}

function messageText(message) {
    return (message?.content ?? [])
        .filter((block) => block?.type === "text" && typeof block.text === "string")
        .map((block) => block.text)
        .join("\n")
        .trim()
}

function directHumanEvent(event) {
    return event?.type === "user/message" && event.data?.source?.kind === "user"
}

function finalizedAssistantBoundary(events, endMessageId) {
    const assistant = events.find(
        (event) =>
            event.type === "assistant/message" &&
            event.data?.message?.id === endMessageId &&
            event.data?.interrupted !== true,
    )
    if (!assistant) throw new Error("Selected message is not a finalized Assistant boundary")
    const turnEnd = events.find(
        (event) =>
            event.seq > assistant.seq &&
            event.type === "turn/end" &&
            event.data?.turn === assistant.data?.turn,
    )
    if (turnEnd?.data?.reason?.kind !== "completed") {
        throw new Error("Selected message is not a finalized Assistant boundary")
    }
    return {assistant, turnEnd}
}

function finalizedAssistantSequence(events, endSeq) {
    if (!Number.isSafeInteger(endSeq) || endSeq < 0) {
        throw new Error("DSH Assistant sequence is invalid")
    }
    const assistant = events.find(
        (event) => event.seq === endSeq &&
            event.type === "assistant/message" &&
            event.data?.interrupted !== true,
    )
    if (!assistant) throw new Error("Selected message is not a finalized Assistant boundary")
    const turnEnd = events.find(
        (event) => event.seq > assistant.seq &&
            event.type === "turn/end" &&
            event.data?.turn === assistant.data?.turn,
    )
    if (turnEnd?.data?.reason?.kind !== "completed") {
        throw new Error("Selected message is not a finalized Assistant boundary")
    }
    return {assistant, turnEnd}
}

function traceProjection(observation) {
    return {
        target: observation.target,
        replacedBy: observation.replacedBy ?? null,
        replacementChain: observation.replacementChain ?? [],
        replacedEventSeqs: observation.replacedEventSeqs ?? [],
        sourceEventSeqs: observation.sourceEventSeqs ?? [],
        derivedEventSeqs: observation.derivedEventSeqs ?? [],
    }
}

function validateTraceObservation(observation, {sessionId, seq, boundary}) {
    if (
        observation?.session?.id !== sessionId ||
        observation?.target?.sessionId !== sessionId ||
        observation?.target?.seq !== seq
    ) {
        throw new Error(`DSH ${boundary} trace does not match the captured Session event`)
    }
    if (boundary === "Assistant boundary" && observation.target.surface !== "current") {
        throw new Error("Assistant boundary is no longer current in the DSH conversation")
    }
    if (
        boundary === "Human boundary" &&
        observation.target.surface !== "current" &&
        observation.target.surface !== "shadowed"
    ) {
        throw new Error("Human boundary is not present in the DSH conversation surface")
    }
}

function toolResultText(event) {
    const message = event?.data?.message
    const blocks = message?.content ?? []
    return blocks.map((block) => {
        if (block?.type === "text" || block?.type === "reasoning") return block.text ?? ""
        if (block?.type === "tool-result") return JSON.stringify(block)
        return JSON.stringify(block)
    }).filter(Boolean).join("\n")
}

function toolArguments(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value
    if (typeof value !== "string") return null
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function skillResourceBase(value) {
    if (value?.kind === "directory" && typeof value.path === "string" && value.path) {
        return {kind: "directory", path: value.path}
    }
    if (value?.kind === "url" && typeof value.url === "string" && value.url) {
        return {kind: "url", url: value.url}
    }
    if (value?.kind === "opaque" && typeof value.description === "string" && value.description) {
        return {kind: "opaque", description: value.description}
    }
    return null
}

function skillIdentityFromResult(result, args) {
    const meta = result?.data?.meta
    const metaName = typeof meta?.name === "string" ? meta.name.trim() : ""
    const metaProvider = typeof meta?.provider === "string" ? meta.provider.trim() : ""
    const metaResourceBase = skillResourceBase(meta?.resourceBase)
    if (metaName && metaProvider && metaResourceBase) {
        return {name: metaName, provider: metaProvider, resourceBase: metaResourceBase}
    }
    const text = (result?.data?.message?.content ?? []).flatMap((block) => {
        if (block?.type === "text" || block?.type === "reasoning") return [String(block.text ?? "")]
        if (block?.type !== "tool-result") return []
        return (block.content ?? [])
            .filter((entry) => entry?.type === "text" || entry?.type === "reasoning")
            .map((entry) => String(entry.text ?? ""))
    }).join("\n")
    const name = text.match(/<skill_content\s+name="([^"\r\n]+)">/u)?.[1]?.trim() ?? ""
    const path = text.match(/Base directory for this skill:\s*([^\r\n]+)/u)?.[1]?.trim() ?? ""
    if (!name || name !== args?.name || !isAbsolute(path)) return null
    return {
        name,
        provider: "dsh-skill-tool",
        resourceBase: {kind: "directory", path},
    }
}

function observedSkills(events) {
    const resultsByCallId = new Map(events
        .filter((event) => event.type === "tool/result")
        .map((event) => [event.data?.message?.source?.callId, event]))
    const observed = []
    for (const call of events) {
        if (call.type !== "tool/call" || call.data?.name !== "skill") continue
        const args = toolArguments(call.data.arguments)
        const result = resultsByCallId.get(call.data.callId)
        const identity = skillIdentityFromResult(result, args)
        if (
            !result ||
            result.data?.error ||
            !identity ||
            args?.name !== identity.name
        ) continue
        observed.push({
            ...identity,
            callSeq: call.seq,
            resultSeq: result.seq,
        })
    }
    return observed
}

function episodeFromSlice({session, events, start, startTurn, assistant, turnEnd, source}) {
    const resultsByCallId = new Map()
    for (const event of events) {
        if (event.type !== "tool/result") continue
        const callId = event.data?.message?.source?.callId
        if (callId) resultsByCallId.set(callId, event)
    }
    const items = []
    let currentTurn = startTurn
    for (const event of events) {
        if (event.type === "turn/start") currentTurn = event.data.turn
        const id = `dsh:${session.id}:${event.seq}`
        if (event.type === "user/message" && event.data?.source?.kind !== "tool") {
            items.push({
                id,
                turnId: `dsh:${session.id}:turn:${currentTurn}`,
                type: "userMessage",
                text: messageText(event.data),
                source: event.data?.source ?? null,
            })
            continue
        }
        if (event.type === "assistant/message") {
            const text = messageText(event.data?.message)
            if (!text) continue
            items.push({
                id,
                turnId: `dsh:${session.id}:turn:${event.data.turn}`,
                type: "agentMessage",
                text,
                modelProvider: event.data.message.source?.provider ?? null,
                modelId: event.data.message.source?.model ?? null,
                usage: event.data.usage ?? null,
            })
            continue
        }
        if (event.type === "tool/call") {
            const result = resultsByCallId.get(event.data.callId)
            items.push({
                id,
                turnId: `dsh:${session.id}:turn:${event.data.turn}`,
                type: "dynamicToolCall",
                tool: event.data.name,
                status: result?.data?.error ? "failed" : result ? "completed" : "running",
                arguments: event.data.arguments,
                result: result ? toolResultText(result) : null,
                error: result?.data?.error ?? null,
                sourceEventSeqs: result ? [event.seq, result.seq] : [event.seq],
            })
        }
    }
    const provider = assistant.data.message.source?.provider ?? null
    const model = assistant.data.message.source?.model ?? null
    const episodeSource = {
        threadId: session.id,
        cwd: session.cwd ?? null,
        startTurnId: `dsh:${session.id}:turn:${startTurn}`,
        startItemId: `dsh:${session.id}:${start.seq}`,
        endTurnId: `dsh:${session.id}:turn:${assistant.data.turn}`,
        endItemId: `dsh:${session.id}:${assistant.seq}`,
        runtimeId: null,
        modelProvider: provider,
        modelId: model,
        traceReference: source.digest ? `dsh-conversation:${source.digest}` : null,
        ...source,
    }
    return {
        schemaVersion: "rolling-skill-episode/v1",
        id: `dsh:${session.id}:${start.seq}-${turnEnd.seq}`,
        originalQuestion: messageText(start.data),
        source: episodeSource,
        items,
        toolActivity: items.filter((item) => item.type === "dynamicToolCall"),
        capturedAt: new Date(turnEnd.time).toISOString(),
    }
}

function persistSnapshot(traceRoot, snapshot) {
    mkdirSync(traceRoot, {recursive: true, mode: 0o700})
    chmodSync(traceRoot, 0o700)
    const serialized = stableJson(snapshot)
    const digest = `sha256:${createHash("sha256").update(serialized).digest("hex")}`
    const path = join(traceRoot, `${digest.slice(7)}.json`)
    if (existsSync(path)) {
        if (readFileSync(path, "utf8") !== serialized) {
            throw new Error("Frozen DSH evidence digest collided with different content")
        }
        return {digest, path}
    }
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
        writeFileSync(temporary, serialized, {encoding: "utf8", flag: "wx", mode: 0o600})
        chmodSync(temporary, 0o600)
        renameSync(temporary, path)
    } finally {
        if (existsSync(temporary)) unlinkSync(temporary)
    }
    return {digest, path}
}

function createSessionEvidenceSource({sessionQuery, traceRoot}) {
    if (!sessionQuery || typeof sessionQuery.readSession !== "function") {
        throw new Error("DSH sessionQuery.readSession is required")
    }
    const requestedTraceRoot = String(traceRoot ?? "").trim()
    if (!requestedTraceRoot || !isAbsolute(requestedTraceRoot)) {
        throw new Error("DSH conversation trace root must be absolute")
    }
    const normalizedTraceRoot = resolve(requestedTraceRoot)

    async function inspect(input) {
        const sessionId = requiredText(input?.sessionId, "DSH Session id")
        const endMessageId = requiredText(input?.endMessageId, "Assistant message id")
        const snapshot = await sessionQuery.readSession(sessionId)
        const {assistant, turnEnd} = finalizedAssistantBoundary(snapshot.events, endMessageId)
        const startCandidates = snapshot.events
            .filter((event) => event.seq <= assistant.seq && directHumanEvent(event))
            .map((event) => ({
                seq: event.seq,
                messageId: event.data.id,
                text: messageText(event.data),
                time: event.time,
            }))
        return {
            sessionId,
            endMessageId,
            endSeq: turnEnd.seq,
            assistantSeq: assistant.seq,
            startCandidates,
        }
    }

    async function capture(input) {
        const sessionId = requiredText(input?.sessionId, "DSH Session id")
        const endMessageId = requiredText(input?.endMessageId, "Assistant message id")
        const snapshot = await sessionQuery.readSession(sessionId)
        const {assistant, turnEnd} = finalizedAssistantBoundary(snapshot.events, endMessageId)
        const start = snapshot.events.find(
            (event) => event.seq === input?.startSeq && directHumanEvent(event),
        )
        if (!start || start.seq > assistant.seq) {
            throw new Error("Selected message is not a valid direct-human start boundary")
        }
        const startTurnEvent = snapshot.events
            .filter((event) => event.seq < start.seq && event.type === "turn/start")
            .at(-1)
        const startTurn = startTurnEvent?.data?.turn
        if (!Number.isSafeInteger(startTurn)) {
            throw new Error("Selected Human boundary is not enclosed by a DSH turn")
        }
        if (typeof sessionQuery.traceEvent !== "function") {
            throw new Error("DSH sessionQuery.traceEvent is required to freeze source lineage")
        }
        const [startTrace, endTrace] = await Promise.all([
            sessionQuery.traceEvent({sessionId, seq: start.seq}),
            sessionQuery.traceEvent({sessionId, seq: assistant.seq}),
        ])
        validateTraceObservation(startTrace, {
            sessionId,
            seq: start.seq,
            boundary: "Human boundary",
        })
        validateTraceObservation(endTrace, {
            sessionId,
            seq: assistant.seq,
            boundary: "Assistant boundary",
        })
        const events = snapshot.events.filter(
            (event) => event.seq >= start.seq && event.seq <= turnEnd.seq,
        )
        const frozenSnapshot = {
            schemaVersion: "rolling-skill-dsh-conversation-evidence/v1",
            session: snapshot.session,
            boundaries: {
                startSeq: start.seq,
                assistantSeq: assistant.seq,
                endSeq: turnEnd.seq,
                endMessageId,
            },
            events,
            lineage: {
                start: traceProjection(startTrace),
                end: traceProjection(endTrace),
            },
        }
        const persisted = persistSnapshot(normalizedTraceRoot, frozenSnapshot)
        const evidenceSource = {
            kind: "dsh-session",
            sessionId,
            startSeq: start.seq,
            endSeq: turnEnd.seq,
            endMessageId,
            digest: persisted.digest,
            snapshotPath: persisted.path,
            observedSkills: observedSkills(events),
        }
        return {
            episode: episodeFromSlice({
                session: snapshot.session,
                events,
                start,
                startTurn,
                assistant,
                turnEnd,
                source: evidenceSource,
            }),
            source: evidenceSource,
        }
    }

    async function readRange(input) {
        const sessionId = requiredText(input?.sessionId, "DSH Session id")
        const startSeq = input?.startSeq
        if (!Number.isSafeInteger(startSeq) || startSeq < 0) {
            throw new Error("Selected message is not a valid direct-human start boundary")
        }
        const snapshot = await sessionQuery.readSession(sessionId)
        const {assistant, turnEnd} = finalizedAssistantSequence(snapshot.events, input?.endSeq)
        const start = snapshot.events.find(
            (event) => event.seq === startSeq && directHumanEvent(event),
        )
        if (!start || start.seq > assistant.seq) {
            throw new Error("Selected message is not a valid direct-human start boundary")
        }
        const startTurnEvent = snapshot.events
            .filter((event) => event.seq < start.seq && event.type === "turn/start")
            .at(-1)
        const startTurn = startTurnEvent?.data?.turn
        if (!Number.isSafeInteger(startTurn)) {
            throw new Error("Selected Human boundary is not enclosed by a DSH turn")
        }
        const events = snapshot.events.filter(
            (event) => event.seq >= start.seq && event.seq <= turnEnd.seq,
        )
        const source = {
            kind: "dsh-session-live",
            sessionId,
            startSeq: start.seq,
            endSeq: turnEnd.seq,
            endMessageId: assistant.data?.message?.id ?? null,
            digest: null,
            snapshotPath: null,
            observedSkills: observedSkills(events),
        }
        return episodeFromSlice({
            session: snapshot.session,
            events,
            start,
            startTurn,
            assistant,
            turnEnd,
            source,
        })
    }

    return Object.freeze({capture, inspect, readRange})
}

module.exports = {createSessionEvidenceSource}
