function latestObservation(source) {
    if (Array.isArray(source?.observations)) return source.observations.at(-1) ?? null
    return source?.kind === "automatic_capture" ? source : null
}

function dshSequence(itemId, sessionId) {
    const id = typeof itemId === "string" ? itemId : ""
    const prefix = `dsh:${sessionId}:`
    if (!sessionId || !id.startsWith(prefix)) return null
    const value = Number(id.slice(prefix.length))
    return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function rawCaseEvidence(source, activeSessionId) {
    const observation = latestObservation(source)
    if (!observation) {
        return {
            kind: source?.kind ?? "manual",
            observation: null,
            startSeq: null,
            endSeq: null,
            canRevealRange: false,
        }
    }
    const startSeq = dshSequence(observation.startItemId, observation.threadId)
    const endSeq = dshSequence(observation.endItemId, observation.threadId)
    return {
        kind: source?.kind ?? observation.kind ?? "automatic_capture",
        observation,
        startSeq,
        endSeq,
        canRevealRange: Boolean(
            activeSessionId &&
            activeSessionId === observation.threadId &&
            startSeq !== null &&
            endSeq !== null &&
            startSeq <= endSeq
        ),
    }
}

function evidenceTimeline(episode) {
    const items = Array.isArray(episode?.items) ? episode.items : []
    const firstUser = items.findIndex((item) => item?.type === "userMessage")
    let lastAssistant = -1
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (items[index]?.type === "agentMessage") {
            lastAssistant = index
            break
        }
    }
    return items.map((item, index) => {
        const kind = item?.type === "userMessage"
            ? item?.sourceKind && item.sourceKind !== "user" ? "context" : "user"
            : item?.type === "agentMessage"
                ? "assistant"
                : "tool"
        return {
            ...item,
            kind,
            label: kind === "tool"
                ? item?.toolName ?? item?.type ?? "tool"
                : kind === "context"
                    ? item?.sourceKind
                    : kind,
            boundary: index === firstUser
                ? "start"
                : index === lastAssistant
                    ? "end"
                    : null,
            collapsible: kind === "tool" || kind === "context",
        }
    })
}

module.exports = {evidenceTimeline, latestObservation, rawCaseEvidence}
