const {isAbsolute, posix} = require("node:path")

const EVIDENCE_CATALOG_SCHEMA = "rolling-skill-evidence-catalog/v1"

const KIND_PRIORITY = Object.freeze([
    "response",
    "trace_scope",
    "skill_activation",
    "skill_read",
    "reference_read",
    "command",
    "tool_call",
    "file_change",
    "error",
    "trace_event",
    "skill_definition",
    "reference_definition",
])

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function copy(value) {
    if (value === undefined) return undefined
    return JSON.parse(JSON.stringify(value))
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

function structuredStrings(record, fieldNames) {
    const names = new Set(fieldNames)
    const values = []
    for (const candidate of nestedObjects(record)) {
        for (const [key, value] of Object.entries(candidate)) {
            if (!names.has(key)) continue
            if (typeof value === "string") values.push(value)
            else if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
                values.push(value.join(" "))
            }
        }
    }
    return values
}

function structuredTypes(record) {
    return structuredStrings(record, ["type", "method", "tool", "name"])
        .map((value) => value.toLowerCase())
}

function isMarkdownReadCommand(command, predicate) {
    const text = String(command ?? "")
    if (!/\b(?:cat|sed|head|tail|less|more|bat|rg|grep|awk|perl|python\d*)\b/iu.test(text)) {
        return false
    }
    const paths = text.match(/(?:^|[\s'"=])([^\s'";|&<>]+\.md)(?=$|[\s'";|&<>])/giu) ?? []
    return paths.some((value) => predicate(value.trim().replace(/^['"=\s]+|['"\s]+$/gu, "")))
}

function hasSkillMention(record) {
    for (const candidate of nestedObjects(record)) {
        if (candidate.type === "skill" && typeof candidate.name === "string" && candidate.name) {
            return true
        }
    }
    return false
}

function hasSkillInvocation(record) {
    return nestedObjects(record).some((candidate) => {
        if (String(candidate.type ?? "").toLowerCase() !== "user/message") return false
        const source = object(candidate.data).source
        return source?.kind === "skill-invocation" &&
            typeof source.name === "string" && Boolean(source.name)
    })
}

function hasDshSkillResult(data, call) {
    if (data.meta?.name && data.meta?.resourceBase) return true
    // Public DSH events omit private tool meta. The completed, correlated
    // skill-tool result carries the loaded instructions instead.
    if (!Number.isSafeInteger(call.startedSequence)) return false
    let args = call.arguments
    try {if (typeof args === "string") args = JSON.parse(args)} catch {return false}
    const name = args?.name
    const message = object(data.message)
    if (typeof name !== "string" || !name || !message.source?.callId) return false
    return (Array.isArray(message.content) ? message.content : []).some((result) =>
        result?.type === "tool-result" && result.isError === false &&
        result.toolCallId === message.source.callId &&
        Array.isArray(result.content) && result.content.some((part) =>
            part?.type === "text" && typeof part.text === "string" &&
            part.text.startsWith(`<skill_content name="${name}">`) &&
            part.text.includes("<skill_instructions>") && part.text.includes("</skill_content>"),
        ),
    )
}

function eventKinds(record) {
    const kinds = new Set()
    const types = structuredTypes(record)
    const commands = structuredStrings(record, ["command", "cmd", "argv"])
    const statuses = structuredStrings(record, ["status", "outcome"]).map((value) => value.toLowerCase())
    const hasErrorObject = nestedObjects(record).some((entry) =>
        entry.isError === true || (Object.hasOwn(entry, "error") && entry.error !== null && entry.error !== undefined),
    )
    const failed = hasErrorObject || statuses.some((value) =>
        ["failed", "error", "rejected", "cancelled"].includes(value),
    )
    const codeBuddyUpdate = object(record?.message?.params?.update)
    const codeBuddyToolEvent = ["tool_call", "tool_call_update"].includes(
        String(codeBuddyUpdate.sessionUpdate ?? ""),
    )
    const codeBuddyInput = object(codeBuddyUpdate.rawInput)
    const codeBuddyCompleted = String(codeBuddyUpdate.status ?? "").toLowerCase() === "completed"
    const dshEvent = ["events.mux", "session/event"].includes(record?.message?.method)
        ? object(record?.message?.params?.event) : {}
    const dshData = object(dshEvent.data)
    const dshCall = dshEvent.type === "tool/call" ? dshData : object(dshData.call)
    if (["tool/call", "tool/result"].includes(dshEvent.type)) {
        kinds.add("tool_call")
        if (/^(?:bash|shell|terminal)$/iu.test(String(dshCall.name ?? ""))) kinds.add("command")
        if (/^(?:apply_patch|write_file|edit_file)$/iu.test(String(dshCall.name ?? ""))) kinds.add("file_change")
        if (dshEvent.type === "tool/result" && dshCall.name === "skill" && !failed && hasDshSkillResult(dshData, dshCall)) {
            kinds.add("skill_activation")
            kinds.add("skill_read")
        }
    }

    if (hasSkillMention(record)) kinds.add("skill_activation")
    if (hasSkillInvocation(record)) {
        kinds.add("skill_activation")
        kinds.add("skill_read")
    }
    if (types.some((value) => /commandexecution|executecommand|shell|terminal/iu.test(value))) {
        kinds.add("command")
    }
    if (types.some((value) => /mcptoolcall|dynamictoolcall|collabagenttoolcall|toolcall/iu.test(value))) {
        kinds.add("tool_call")
    }
    if (codeBuddyToolEvent) kinds.add("tool_call")
    if (codeBuddyInput.skill && codeBuddyCompleted) {
        kinds.add("skill_activation")
        kinds.add("skill_read")
    }
    if (codeBuddyUpdate.kind === "read" && codeBuddyCompleted) {
        const path = String(codeBuddyInput.file_path ?? codeBuddyInput.path ?? "")
        if (/(?:^|\/)SKILL\.md$/iu.test(path)) {
            kinds.add("skill_activation")
            kinds.add("skill_read")
        }
        if (/(?:^|\/)(?:references?|assets?|DEPENDENCIES)\//iu.test(path) || /(?:^|\/)DEPENDENCIES\.md$/iu.test(path)) {
            kinds.add("reference_read")
        }
    }
    if (codeBuddyUpdate.kind === "execute") kinds.add("command")
    if (codeBuddyUpdate.kind === "edit") kinds.add("file_change")
    if (types.some((value) => /filechange|file_change|applypatch|writefile|editfile/iu.test(value))) {
        kinds.add("file_change")
    }
    if (
        types.some((value) => value === "error" || /(?:^|\/)error$/u.test(value)) ||
        failed
    ) {
        kinds.add("error")
    }
    for (const command of commands) {
        kinds.add("command")
        if (!failed && isMarkdownReadCommand(command, (path) => /(?:^|\/)SKILL\.md$/iu.test(path))) {
            kinds.add("skill_activation")
            kinds.add("skill_read")
        }
        if (!failed && isMarkdownReadCommand(command, (path) =>
            /(?:^|\/)(?:references?|assets?|DEPENDENCIES)\//iu.test(path) ||
            /(?:^|\/)DEPENDENCIES\.md$/iu.test(path),
        )) {
            kinds.add("reference_read")
        }
    }
    if (!kinds.size) kinds.add("trace_event")
    return KIND_PRIORITY.filter((kind) => kinds.has(kind))
}

function safeSkillPath(file) {
    const path = String(file?.path ?? "").replaceAll("\\", "/")
    if (
        !path ||
        isAbsolute(path) ||
        path === ".." ||
        path.startsWith("../") ||
        posix.normalize(path) !== path
    ) {
        throw new Error("Evidence catalog contains an unsafe Skill evidence path")
    }
    const id = String(file?.id ?? "")
    if (id !== `skill:${path}`) throw new Error("Evidence catalog contains an invalid Skill evidence id")
    return path
}

function buildEvidenceCatalog({response = "", traceEvidence = null, skillEvidence = null} = {}) {
    const entries = [{
        id: "response",
        source: "response",
        kind: "response",
        kinds: ["response"],
        content: String(response ?? ""),
    }]

    if (traceEvidence && typeof traceEvidence === "object" && !Array.isArray(traceEvidence)) {
        const trace = object(traceEvidence)
        const traceEntries = Array.isArray(trace.entries) ? trace.entries : []
        entries.push({
            id: "trace:scope",
            source: "trace",
            kind: "trace_scope",
            kinds: ["trace_scope"],
            reference: typeof trace.reference === "string" ? trace.reference : null,
            truncated: Boolean(trace.truncated),
            omittedEntries: Number.isSafeInteger(trace.omittedEntries) && trace.omittedEntries >= 0
                ? trace.omittedEntries
                : 0,
            sourceEntryCount: Number.isSafeInteger(trace.sourceEntryCount) ? trace.sourceEntryCount : traceEntries.length,
            includedEntries: Number.isSafeInteger(trace.includedEntries) ? trace.includedEntries : traceEntries.length,
            compactedEntries: Number.isSafeInteger(trace.compactedEntries) ? trace.compactedEntries : 0,
            contentCompactedEntries: Number.isSafeInteger(trace.contentCompactedEntries)
                ? trace.contentCompactedEntries
                : 0,
            omittedImportantEntries: Number.isSafeInteger(trace.omittedImportantEntries)
                ? trace.omittedImportantEntries
                : Number(trace.omittedEntries) || 0,
            samplingStrategy: typeof trace.samplingStrategy === "string" ? trace.samplingStrategy : null,
            semanticCoverageComplete: trace.semanticCoverageComplete === true,
            entryCount: traceEntries.length,
        })
        const seen = new Set()
        const sorted = traceEntries.map((entry) => copy(entry)).sort((left, right) => {
            const leftSequence = Number(left?.sequence)
            const rightSequence = Number(right?.sequence)
            return leftSequence - rightSequence
        })
        for (const record of sorted) {
            const sequence = Number(record?.sequence)
            if (!Number.isSafeInteger(sequence) || sequence <= 0) {
                throw new Error("Evidence catalog requires positive integer Trace sequences")
            }
            if (seen.has(sequence)) throw new Error(`Evidence catalog contains duplicate Trace sequence ${sequence}`)
            seen.add(sequence)
            const kinds = eventKinds(record)
            entries.push({
                id: `trace:L${sequence}`,
                source: "trace",
                kind: kinds[0],
                kinds,
                sequence,
                record,
            })
        }
    }

    const files = Array.isArray(skillEvidence?.files) ? skillEvidence.files.map((file) => copy(file)) : []
    files.sort((left, right) => {
        const leftPath = safeSkillPath(left)
        const rightPath = safeSkillPath(right)
        if (leftPath === "SKILL.md") return rightPath === "SKILL.md" ? 0 : -1
        if (rightPath === "SKILL.md") return 1
        return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0
    })
    const seenSkillIds = new Set()
    for (const file of files) {
        const path = safeSkillPath(file)
        if (seenSkillIds.has(file.id)) throw new Error(`Evidence catalog contains duplicate Skill id ${file.id}`)
        seenSkillIds.add(file.id)
        const kind = path === "SKILL.md" ? "skill_definition" : "reference_definition"
        entries.push({
            id: file.id,
            source: "skill",
            kind,
            kinds: [kind],
            path,
            content: typeof file.content === "string" ? file.content : "",
            ...(typeof file.digest === "string" ? {digest: file.digest} : {}),
        })
    }

    return deepFreeze({schemaVersion: EVIDENCE_CATALOG_SCHEMA, entries})
}

module.exports = {EVIDENCE_CATALOG_SCHEMA, buildEvidenceCatalog}
