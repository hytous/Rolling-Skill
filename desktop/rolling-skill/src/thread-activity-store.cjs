const {
    chmodSync,
    mkdirSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {randomUUID} = require("node:crypto")
const {dirname} = require("node:path")
const {commandActivityDetail} = require("../renderer/command-activity.js")

const THREAD_ACTIVITY_SCHEMA = "rolling-skill-thread-activity/v1"
const SUPPORTED_ACTIVITY_TYPES = new Set([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "subAgentActivity",
    "contextCompaction",
])

const DEFAULT_MAX_THREADS = 500
const DEFAULT_MAX_RECORDS = 5_000
const DEFAULT_MAX_TEXT_LENGTH = 1_000
const DEFAULT_MAX_FILE_CHANGES = 20
const DEFAULT_FLUSH_DELAY_MS = 1_000
const MAX_IDENTIFIER_LENGTH = 500

function positiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function identifier(value) {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) return null
    return normalized
}

function compactText(value, limit) {
    if (value === null || value === undefined) return null
    const text = String(value)
    if (!text) return null
    if (text.length <= limit) return text
    return limit === 1 ? "…" : `${text.slice(0, limit - 1)}…`
}

function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null
}

function compactCommand(item) {
    const detail = commandActivityDetail(item)
    return {
        command: detail.command || null,
        invocationCount: detail.invocationCount,
        detailUnavailable: detail.detailUnavailable,
    }
}

function compactActivity(item, options) {
    const id = identifier(item?.id)
    const type = identifier(item?.type)
    if (!id || !type || !SUPPORTED_ACTIVITY_TYPES.has(type)) return null

    const compact = {id, type}
    const status = compactText(item.status, 100)
    if (status) compact.status = status

    if (type === "commandExecution") {
        const commandDetail = compactCommand(item)
        const exitCode = finiteNumber(item.exitCode)
        if (commandDetail.command) compact.command = commandDetail.command
        if (commandDetail.invocationCount) {
            compact.commandInvocationCount = commandDetail.invocationCount
        }
        if (commandDetail.detailUnavailable) compact.commandDetailUnavailable = true
        if (exitCode !== null) compact.exitCode = exitCode
        return compact
    }

    if (type === "fileChange") return compact

    if (type === "mcpToolCall") {
        const server = compactText(item.server, 200)
        const tool = compactText(item.tool, 200)
        if (server) compact.server = server
        if (tool) compact.tool = tool
        return compact
    }

    if (type === "dynamicToolCall" || type === "collabAgentToolCall") {
        const tool = compactText(item.tool, 200)
        if (tool) compact.tool = tool
        return compact
    }

    if (type === "subAgentActivity") {
        const kind = compactText(item.kind, 100)
        const agentPath = compactText(item.agentPath, options.maxTextLength)
        if (kind) compact.kind = kind
        if (agentPath) compact.agentPath = agentPath
        return compact
    }

    return compact
}

function emptyState() {
    return {schemaVersion: THREAD_ACTIVITY_SCHEMA, sequence: 0, records: []}
}

function recordKey(record) {
    return `${record.runtimeId}\u0000${record.threadId}\u0000${record.turnId}\u0000${record.item.id}`
}

function threadKey(record) {
    return `${record.runtimeId}\u0000${record.threadId}`
}

function turnKey(runtimeId, threadId, turnId) {
    return `${runtimeId}\u0000${threadId}\u0000${turnId}`
}

class ThreadActivityStore {
    constructor(path, options = {}) {
        if (typeof path !== "string" || !path.trim()) {
            throw new Error("Thread activity store path is required")
        }
        this.path = path
        this.options = {
            maxThreads: positiveInteger(options.maxThreads, DEFAULT_MAX_THREADS),
            maxRecords: positiveInteger(options.maxRecords, DEFAULT_MAX_RECORDS),
            maxTextLength: positiveInteger(options.maxTextLength, DEFAULT_MAX_TEXT_LENGTH),
            maxFileChanges: positiveInteger(options.maxFileChanges, DEFAULT_MAX_FILE_CHANGES),
            flushDelayMs: positiveInteger(options.flushDelayMs, DEFAULT_FLUSH_DELAY_MS),
        }
        this.state = this.load()
        this.latestAgentMessageByTurn = new Map()
        this.dirty = false
        this.flushTimer = null
        this.lastPersistError = null
    }

    load() {
        try {
            const parsed = JSON.parse(readFileSync(this.path, "utf8"))
            const records = Array.isArray(parsed?.records) ? parsed.records : []
            const byKey = new Map()
            let sequence = 0
            for (const candidate of records) {
                const runtimeId = identifier(candidate?.runtimeId)
                const threadId = identifier(candidate?.threadId)
                const turnId = identifier(candidate?.turnId)
                const item = compactActivity(candidate?.item, this.options)
                if (!runtimeId || !threadId || !turnId || !item) continue
                const recordSequence = positiveInteger(candidate.sequence, sequence + 1)
                sequence = Math.max(sequence, recordSequence)
                const record = {
                    runtimeId,
                    threadId,
                    turnId,
                    item,
                    sequence: recordSequence,
                    order: positiveInteger(candidate.order, recordSequence),
                    updatedAt: compactText(candidate.updatedAt, 100) ?? "",
                    ...(Object.hasOwn(candidate, "afterAgentMessageId")
                        ? {afterAgentMessageId: identifier(candidate.afterAgentMessageId)}
                        : {}),
                }
                const key = recordKey(record)
                const previous = byKey.get(key)
                if (!previous || previous.sequence <= record.sequence) byKey.set(key, record)
            }
            this.state = {
                schemaVersion: THREAD_ACTIVITY_SCHEMA,
                sequence: Math.max(positiveInteger(parsed?.sequence, 1), sequence),
                records: [...byKey.values()],
            }
            this.prune()
            return this.state
        } catch {
            return emptyState()
        }
    }

    persist() {
        mkdirSync(dirname(this.path), {recursive: true, mode: 0o700})
        const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`
        try {
            writeFileSync(temporaryPath, `${JSON.stringify(this.state)}\n`, {
                encoding: "utf8",
                mode: 0o600,
            })
            chmodSync(temporaryPath, 0o600)
            renameSync(temporaryPath, this.path)
            chmodSync(this.path, 0o600)
            this.dirty = false
            this.lastPersistError = null
        } catch (error) {
            try {
                unlinkSync(temporaryPath)
            } catch {
                // The temporary file may not have been created.
            }
            throw error
        }
    }

    prune() {
        const latestByThread = new Map()
        for (const record of this.state.records) {
            const key = threadKey(record)
            latestByThread.set(key, Math.max(latestByThread.get(key) ?? 0, record.sequence))
        }
        const retainedThreads = new Set(
            [...latestByThread.entries()]
                .sort((left, right) => right[1] - left[1])
                .slice(0, this.options.maxThreads)
                .map(([key]) => key),
        )
        this.state.records = this.state.records
            .filter((record) => retainedThreads.has(threadKey(record)))
            .sort((left, right) => left.sequence - right.sequence)
            .slice(-this.options.maxRecords)
    }

    updateNotification(runtimeId, message, updatedAt = new Date().toISOString()) {
        runtimeId = identifier(runtimeId)
        const threadId = identifier(message.params?.threadId)
        const turnId = identifier(message.params?.turnId ?? message.params?.turn?.id)
        if (!runtimeId || !threadId || !turnId) return null
        const currentTurnKey = turnKey(runtimeId, threadId, turnId)
        if (message.method === "turn/started") {
            this.latestAgentMessageByTurn.set(currentTurnKey, null)
            return null
        }
        if (message.method === "turn/completed") {
            this.latestAgentMessageByTurn.delete(currentTurnKey)
            return null
        }
        const eventItem = message.params?.item
        const agentMessageId = identifier(
            message.method === "item/agentMessage/delta"
                ? message.params?.itemId
                : eventItem?.type === "agentMessage"
                  ? eventItem.id
                  : null,
        )
        if (agentMessageId) {
            this.latestAgentMessageByTurn.set(currentTurnKey, agentMessageId)
            return null
        }
        if (message?.method !== "item/started" && message?.method !== "item/completed") return null
        const nextItem = compactActivity(message.params?.item, this.options)
        if (!nextItem) return null

        const key = recordKey({runtimeId, threadId, turnId, item: nextItem})
        const previousIndex = this.state.records.findIndex((record) => recordKey(record) === key)
        const previous = previousIndex >= 0 ? this.state.records[previousIndex] : null
        const mergedSource = {...previous?.item, ...nextItem}
        if (nextItem.type === "commandExecution" && nextItem.command) {
            delete mergedSource.commandDetailUnavailable
        }
        const mergedItem = compactActivity(mergedSource, this.options)
        const record = {
            runtimeId,
            threadId,
            turnId,
            item: mergedItem,
            sequence: (this.state.sequence += 1),
            order: previous?.order ?? this.state.sequence,
            updatedAt: compactText(updatedAt, 100) ?? "",
            ...(previous && Object.hasOwn(previous, "afterAgentMessageId")
                ? {afterAgentMessageId: previous.afterAgentMessageId}
                : this.latestAgentMessageByTurn.has(currentTurnKey)
                  ? {afterAgentMessageId: this.latestAgentMessageByTurn.get(currentTurnKey)}
                  : {}),
        }
        if (previousIndex >= 0) this.state.records.splice(previousIndex, 1)
        this.state.records.push(record)
        this.prune()
        this.dirty = true
        return {...record, item: {...record.item}}
    }

    recordNotification(runtimeId, message, updatedAt) {
        const record = this.updateNotification(runtimeId, message, updatedAt)
        if (record) this.flush()
        return record
    }

    captureNotification(runtimeId, message, updatedAt) {
        const record = this.updateNotification(runtimeId, message, updatedAt)
        if (!record || this.flushTimer) return record
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null
            if (!this.dirty) return
            try {
                this.persist()
            } catch (error) {
                this.lastPersistError = error
            }
        }, this.options.flushDelayMs)
        this.flushTimer.unref?.()
        return record
    }

    list(runtimeId, threadId) {
        runtimeId = identifier(runtimeId)
        threadId = identifier(threadId)
        if (!runtimeId || !threadId) return []
        return this.state.records
            .filter((record) => record.runtimeId === runtimeId && record.threadId === threadId)
            .sort((left, right) => left.order - right.order)
            .map((record) => ({...record, item: {...record.item}}))
    }

    mergeThread(runtimeId, thread) {
        const threadId = identifier(thread?.id)
        const activities = this.list(runtimeId, threadId)
        const byTurn = new Map()
        for (const activity of activities) {
            const turnActivities = byTurn.get(activity.turnId) ?? []
            turnActivities.push(activity)
            byTurn.set(activity.turnId, turnActivities)
        }

        return {
            ...(thread ?? {}),
            turns: (thread?.turns ?? []).map((turn) => {
                const items = [...(turn.items ?? [])]
                const existingIds = new Set(items.map((item) => item?.id).filter(Boolean))
                const turnFinished = turn.status && turn.status !== "inProgress"
                const turnActivities = byTurn.get(turn.id) ?? []
                const missing = turnActivities
                    .filter((record) => !existingIds.has(record.item.id))
                    .map((record) => ({
                        ...record,
                        item:
                            turnFinished && ["inProgress", "running", "working"].includes(record.item.status)
                                ? {...record.item, status: "unknown"}
                                : record.item,
                    }))
                const legacy = []
                const merged = [...items]
                for (const record of missing) {
                    if (!Object.hasOwn(record, "afterAgentMessageId")) {
                        legacy.push(record.item)
                        continue
                    }
                    const anchor = record.afterAgentMessageId
                    if (anchor && !existingIds.has(anchor)) {
                        legacy.push(record.item)
                        continue
                    }
                    const siblings = turnActivities.filter(
                        (candidate) =>
                            Object.hasOwn(candidate, "afterAgentMessageId") &&
                            candidate.afterAgentMessageId === anchor,
                    )
                    const siblingIndex = siblings.findIndex(
                        (candidate) => candidate.item.id === record.item.id,
                    )
                    let insertionIndex = -1
                    for (let index = siblingIndex - 1; index >= 0; index -= 1) {
                        const previousIndex = merged.findIndex(
                            (item) => item.id === siblings[index].item.id,
                        )
                        if (previousIndex >= 0) {
                            insertionIndex = previousIndex + 1
                            break
                        }
                    }
                    if (insertionIndex < 0) {
                        for (let index = siblingIndex + 1; index < siblings.length; index += 1) {
                            const nextIndex = merged.findIndex(
                                (item) => item.id === siblings[index].item.id,
                            )
                            if (nextIndex >= 0) {
                                insertionIndex = nextIndex
                                break
                            }
                        }
                    }
                    if (insertionIndex < 0 && anchor) {
                        const anchorIndex = merged.findIndex((item) => item.id === anchor)
                        insertionIndex = merged.findIndex(
                            (item, index) => index > anchorIndex && item.type === "agentMessage",
                        )
                        if (insertionIndex < 0) insertionIndex = merged.length
                    }
                    if (insertionIndex < 0) {
                        insertionIndex = merged.findIndex((item) => item.type === "agentMessage")
                        if (insertionIndex < 0) insertionIndex = merged.length
                    }
                    merged.splice(insertionIndex, 0, {...record.item})
                }
                let insertionIndex = -1
                for (let index = merged.length - 1; index >= 0; index -= 1) {
                    if (merged[index]?.type === "agentMessage") {
                        insertionIndex = index
                        break
                    }
                }
                if (insertionIndex < 0) insertionIndex = merged.length
                merged.splice(insertionIndex, 0, ...legacy.map((item) => ({...item})))
                const lastAgent = [...items].reverse().find((item) => item?.type === "agentMessage")
                if (turn.status === "inProgress") {
                    this.latestAgentMessageByTurn.set(
                        turnKey(runtimeId, threadId, turn.id),
                        lastAgent?.id ?? null,
                    )
                }
                return {...turn, items: merged}
            }),
        }
    }

    mergeThreadResponse(runtimeId, response) {
        if (!response || typeof response !== "object" || !response.thread) return response
        return {...response, thread: this.mergeThread(runtimeId, response.thread)}
    }

    flush() {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer)
            this.flushTimer = null
        }
        if (this.dirty || this.lastPersistError) this.persist()
        return this.path
    }
}

module.exports = {
    SUPPORTED_ACTIVITY_TYPES,
    THREAD_ACTIVITY_SCHEMA,
    ThreadActivityStore,
}
