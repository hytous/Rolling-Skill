const {createHash} = require("node:crypto")
const {appendFileSync, chmodSync, constants, mkdirSync, openSync, closeSync, readFileSync} = require("node:fs")
const {join} = require("node:path")

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

function truncateJsonEntry(entry, maxCharacters) {
    const serialized = JSON.stringify(entry)
    if (serialized.length <= maxCharacters) return {...entry, truncated: false}
    return {
        schemaVersion: entry.schemaVersion,
        sequence: entry.sequence,
        recordedAt: entry.recordedAt,
        direction: entry.direction,
        runtime: entry.runtime,
        messagePreview: serialized.slice(0, maxCharacters),
        truncated: true,
        omittedCharacters: serialized.length - maxCharacters,
    }
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
        this.runtime = options.runtime
            ? {
                  runtimeId: options.runtime.runtimeId,
                  providerId: options.runtime.providerId,
                  version: options.runtime.version,
              }
            : null
    }

    record(direction, message) {
        this.line += 1
        const entry = {
            schemaVersion: "rolling-skill-trace/v1",
            sequence: this.line,
            recordedAt: new Date().toISOString(),
            direction,
            message,
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
        const maxEntries = Math.max(1, Math.min(Number(options.maxEntries) || 200, 1_000))
        const maxEntryCharacters = Math.max(
            200,
            Math.min(Number(options.maxEntryCharacters) || 4_000, 20_000),
        )
        const maxTotalCharacters = Math.max(
            1_000,
            Math.min(Number(options.maxTotalCharacters) || 60_000, 200_000),
        )
        const lines = readFileSync(this.path, "utf8").trim().split("\n").filter(Boolean)
        const entries = []
        let usedCharacters = 0
        let omittedEntries = 0
        for (let lineNumber = start; lineNumber <= end; lineNumber += 1) {
            if (entries.length >= maxEntries) {
                omittedEntries += end - lineNumber + 1
                break
            }
            const entry = truncateJsonEntry(JSON.parse(lines[lineNumber - 1]), maxEntryCharacters)
            const size = JSON.stringify(entry).length
            if (usedCharacters + size > maxTotalCharacters) {
                omittedEntries += end - lineNumber + 1
                break
            }
            entries.push(entry)
            usedCharacters += size
        }
        const evidence = {
            schemaVersion: "rolling-skill-trace-evidence/v1",
            reference,
            entries,
            truncated: omittedEntries > 0 || entries.some((entry) => entry.truncated),
            omittedEntries,
        }
        return {...evidence, digest: evidenceDigest(evidence)}
    }

    readRecent(limit = 200) {
        try {
            return readFileSync(this.path, "utf8")
                .trim()
                .split("\n")
                .filter(Boolean)
                .slice(-Math.max(1, Math.min(limit, 1000)))
                .map((line) => JSON.parse(line))
        } catch {
            return []
        }
    }

    referenceForEpisode({threadId, startItemId, endItemId}) {
        try {
            const lines = readFileSync(this.path, "utf8").trim().split("\n").filter(Boolean)
            let startLine = null
            let endLine = null
            for (const line of lines) {
                const event = JSON.parse(line)
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
