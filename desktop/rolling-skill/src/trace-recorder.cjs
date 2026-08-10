const {appendFileSync, chmodSync, constants, mkdirSync, openSync, closeSync, readFileSync} = require("node:fs")
const {join} = require("node:path")

function safeSessionId(value) {
    return String(value).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120)
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
}

module.exports = {TraceRecorder, safeSessionId}
