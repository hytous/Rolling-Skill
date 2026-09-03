const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} = require("node:fs")
const {dirname} = require("node:path")
const {randomUUID} = require("node:crypto")

const STATE_SCHEMA = "rolling-skill-automatic-capture-state/v1"

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function initialState() {
    return {
        schemaVersion: STATE_SCHEMA,
        lastScheduledSlot: null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        runtimes: {},
    }
}

function timestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error("Automatic capture timestamp is invalid")
    return date.toISOString()
}

function identifier(value, label) {
    const normalized = String(value ?? "").trim()
    if (!normalized || normalized.length > 4_096) throw new Error(`${label} is required`)
    return normalized
}

function itemId(value, label) {
    if (value === null || value === undefined || value === "") return null
    return identifier(value, label)
}

function normalizeState(value) {
    const state = value && typeof value === "object" ? copy(value) : initialState()
    state.schemaVersion = STATE_SCHEMA
    for (const field of ["lastScheduledSlot", "lastRunAt", "lastSuccessAt"]) {
        if (state[field] !== null && state[field] !== undefined) {
            try {
                state[field] = timestamp(state[field])
            } catch {
                state[field] = null
            }
        } else {
            state[field] = null
        }
    }
    if (
        !state.lastError ||
        typeof state.lastError.message !== "string" ||
        typeof state.lastError.at !== "string"
    ) state.lastError = null
    if (!state.runtimes || typeof state.runtimes !== "object" || Array.isArray(state.runtimes)) {
        state.runtimes = {}
    }
    return state
}

class AutomaticCaptureStateStore {
    constructor(path) {
        this.path = path
        this.state = null
    }

    load() {
        if (this.state) return this.state
        this.state = existsSync(this.path)
            ? normalizeState(JSON.parse(readFileSync(this.path, "utf8")))
            : initialState()
        this.persist()
        return this.state
    }

    persist() {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {mode: 0o600})
        chmodSync(temporary, 0o600)
        renameSync(temporary, this.path)
    }

    read() {
        return copy(this.load())
    }

    beginSlot(slot, now = new Date()) {
        const state = this.load()
        timestamp(slot)
        state.lastRunAt = timestamp(now)
        state.lastError = null
        this.persist()
        return this.read()
    }

    completeSlot(slot, now = new Date()) {
        const state = this.load()
        const completedAt = timestamp(now)
        state.lastScheduledSlot = timestamp(slot)
        state.lastRunAt = completedAt
        state.lastSuccessAt = completedAt
        state.lastError = null
        this.persist()
        return this.read()
    }

    failSlot(error, now = new Date()) {
        const state = this.load()
        const failedAt = timestamp(now)
        state.lastRunAt = failedAt
        state.lastError = {
            message: String(error?.message ?? error ?? "Automatic capture failed").slice(0, 4_000),
            at: failedAt,
        }
        this.persist()
        return this.read()
    }

    thread(runtimeId, threadId) {
        const runtime = this.load().runtimes[identifier(runtimeId, "Runtime id")]
        const thread = runtime?.threads?.[identifier(threadId, "Thread id")]
        return copy(thread ?? {
            lastInspectedUserItemId: null,
            pendingStartUserItemId: null,
            checkedRanges: [],
            updatedAt: null,
        })
    }

    commitThread(runtimeId, threadId, patch = {}, now = new Date()) {
        const state = this.load()
        const normalizedRuntimeId = identifier(runtimeId, "Runtime id")
        const normalizedThreadId = identifier(threadId, "Thread id")
        const runtime = state.runtimes[normalizedRuntimeId] ?? {threads: {}}
        if (!runtime.threads || typeof runtime.threads !== "object") runtime.threads = {}
        const current = runtime.threads[normalizedThreadId] ?? {
            lastInspectedUserItemId: null,
            pendingStartUserItemId: null,
            checkedRanges: [],
            updatedAt: null,
        }
        runtime.threads[normalizedThreadId] = {
            ...current,
            ...(Object.hasOwn(patch, "lastInspectedUserItemId")
                ? {lastInspectedUserItemId: itemId(patch.lastInspectedUserItemId, "Inspected user Item id")}
                : {}),
            ...(Object.hasOwn(patch, "inspectionSignature")
                ? {inspectionSignature: itemId(patch.inspectionSignature, "Conversation inspection signature")}
                : {}),
            ...(Object.hasOwn(patch, "sourceRevision")
                ? {sourceRevision: itemId(patch.sourceRevision, "Source revision")}
                : {}),
            ...(Object.hasOwn(patch, "pendingStartUserItemId")
                ? {pendingStartUserItemId: itemId(patch.pendingStartUserItemId, "Pending user Item id")}
                : {}),
            ...(Object.hasOwn(patch, "checkedRanges")
                ? {checkedRanges: copy(Array.isArray(patch.checkedRanges) ? patch.checkedRanges : [])}
                : {}),
            updatedAt: timestamp(now),
        }
        state.runtimes[normalizedRuntimeId] = runtime
        this.persist()
        return this.thread(normalizedRuntimeId, normalizedThreadId)
    }
}

module.exports = {
    AutomaticCaptureStateStore,
    STATE_SCHEMA,
    initialState,
}
