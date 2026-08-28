const {
    appendFileSync,
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    watchFile,
    unwatchFile,
} = require("node:fs")
const {homedir} = require("node:os")
const {dirname, join} = require("node:path")
const {randomUUID} = require("node:crypto")
const {
    validatedReference: validatedAutomaticEvidenceReference,
} = require("./automatic-capture-evidence-store.cjs")

const RAW_CASE_EVENT_SCHEMA = "rolling-skill-raw-case-event/v1"
const MAX_QUESTION_LENGTH = 120_000
const MAX_BATCH_SIZE = 200
const MAX_BATCH_TEXT_LENGTH = 1_000_000
const MAX_SKILL_NAME_LENGTH = 200
const MAX_SKILL_PATH_LENGTH = 4_000
const MAX_NOTE_LENGTH = 10_000

class RawCaseConflictError extends Error {
    constructor() {
        super("Raw Case changed since it was resolved")
        this.name = "RawCaseConflictError"
        this.code = "RAW_CASE_CONFLICT"
    }
}

function defaultRawCaseEventsPath({
    homeDirectory = homedir(),
    platform = process.platform,
    environment = process.env,
} = {}) {
    if (environment.ROLLING_SKILL_RAW_CASE_PATH) {
        return environment.ROLLING_SKILL_RAW_CASE_PATH
    }
    if (platform === "darwin") {
        return join(
            homeDirectory,
            "Library",
            "Application Support",
            "Rolling Skill",
            "raw-case-events.jsonl",
        )
    }
    if (platform === "win32") {
        return join(
            environment.LOCALAPPDATA || join(homeDirectory, "AppData", "Local"),
            "Rolling Skill",
            "raw-case-events.jsonl",
        )
    }
    return join(
        environment.XDG_CONFIG_HOME || join(homeDirectory, ".config"),
        "rolling-skill",
        "raw-case-events.jsonl",
    )
}

function normalizedSkillName(value) {
    return String(value ?? "").trim().toLocaleLowerCase("en-US")
}

function normalizedSkillId(value) {
    if (value === undefined) return null
    if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > MAX_SKILL_NAME_LENGTH ||
        value.trim() !== value ||
        !/\S/u.test(value) ||
        /[\u0000-\u001f\u007f]/u.test(value)
    ) {
        throw new Error(`Skill ID must be a valid identifier of at most ${MAX_SKILL_NAME_LENGTH} characters`)
    }
    return value
}

function normalizeSkill(value) {
    const id = normalizedSkillId(value?.id)
    const name = String(value?.name ?? "").trim()
    if (!name) throw new Error("Skill name is required")
    if (name.length > MAX_SKILL_NAME_LENGTH) {
        throw new Error(`Skill name must not exceed ${MAX_SKILL_NAME_LENGTH} characters`)
    }
    const path = String(value?.path ?? "").trim()
    if (path.length > MAX_SKILL_PATH_LENGTH) {
        throw new Error(`Skill path must not exceed ${MAX_SKILL_PATH_LENGTH} characters`)
    }
    return {...(id === null ? {} : {id}), name, ...(path ? {path} : {})}
}

function normalizeQuestion(value) {
    const question = String(value ?? "")
    if (!question.trim()) throw new Error("Raw Case question is required")
    if (question.length > MAX_QUESTION_LENGTH) {
        throw new Error(`Raw Case question must not exceed ${MAX_QUESTION_LENGTH} characters`)
    }
    return question
}

function normalizeNote(value) {
    const note = String(value ?? "").trim()
    if (note.length > MAX_NOTE_LENGTH) {
        throw new Error(`Raw Case note must not exceed ${MAX_NOTE_LENGTH} characters`)
    }
    return note
}

function jsonCopy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function normalizeInput(input = {}) {
    return {
        question: normalizeQuestion(input.question),
        skill: normalizeSkill(input.skill),
        note: normalizeNote(input.note),
        source: jsonCopy(input.source ?? {kind: "unknown"}),
    }
}

function deduplicationKey(input) {
    let owner
    try {
        owner = normalizedSkillId(input.skill?.id)
    } catch {
        owner = null
    }
    const skillKey = owner === null
        ? `name:${normalizedSkillName(input.skill?.name)}`
        : `id:${owner}`
    return `${skillKey}\u0000${String(input.question ?? "").trim()}`
}

function automaticIdentifier(value, label) {
    const normalized = String(value ?? "").trim()
    if (!normalized || normalized.length > 4_096) throw new Error(`${label} is required`)
    return normalized
}

function normalizeAutomaticObservation(source = {}) {
    if (source.kind !== "automatic_capture") {
        throw new Error("Automatic Raw Case source kind is required")
    }
    const observation = {
        runtimeId: automaticIdentifier(source.runtimeId, "Automatic capture Runtime id"),
        threadId: automaticIdentifier(source.threadId, "Automatic capture thread id"),
        startTurnId: automaticIdentifier(source.startTurnId, "Automatic capture start turn id"),
        startItemId: automaticIdentifier(source.startItemId, "Automatic capture start Item id"),
        endTurnId: automaticIdentifier(source.endTurnId, "Automatic capture end turn id"),
        endItemId: automaticIdentifier(source.endItemId, "Automatic capture end Item id"),
        outcome: String(source.outcome ?? "uncertain"),
        caseType: String(source.caseType ?? "goodcase"),
        confidence: Number(source.confidence),
        inspectedAt: automaticIdentifier(source.inspectedAt, "Automatic capture inspection time"),
        ...(source.summary ? {summary: String(source.summary).slice(0, 1_000)} : {}),
        ...(source.reason ? {reason: String(source.reason).slice(0, 2_000)} : {}),
        ...(source.evidence ? {
            evidence: validatedAutomaticEvidenceReference(source.evidence),
        } : {}),
    }
    if (!new Set(["resolved", "unresolved", "uncertain"]).has(observation.outcome)) {
        throw new Error("Automatic capture outcome is invalid")
    }
    if (!new Set(["goodcase", "badcase"]).has(observation.caseType)) {
        throw new Error("Automatic capture Case type is invalid")
    }
    if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) {
        throw new Error("Automatic capture confidence must be between 0 and 1")
    }
    return observation
}

function observationKey(value) {
    return [value.runtimeId, value.threadId, value.startItemId, value.endItemId].join("\u0000")
}

function recordRevision(value) {
    return Number.isSafeInteger(value) && value >= 1 ? value : 1
}

function readRawCaseEvents(path = defaultRawCaseEventsPath()) {
    if (!existsSync(path)) return {events: [], warnings: []}
    const source = readFileSync(path, "utf8")
    const lines = source.split("\n")
    const events = []
    const warnings = []
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]
        if (!line.trim()) continue
        try {
            const event = JSON.parse(line)
            if (event?.schemaVersion !== RAW_CASE_EVENT_SCHEMA || typeof event.type !== "string") {
                throw new Error("unsupported event schema")
            }
            events.push(event)
        } catch (error) {
            warnings.push({
                line: index + 1,
                message: `Raw Case event line ${index + 1} was ignored: ${error.message}`,
                partial: index === lines.length - 1 && !source.endsWith("\n"),
            })
        }
    }
    return {events, warnings}
}

function reduceRawCaseEvents(events) {
    const records = new Map()
    let sequence = 0
    for (const event of events) {
        sequence += 1
        if (event.type === "added" && event.rawCase?.id) {
            const rawCase = jsonCopy(event.rawCase)
            records.set(event.rawCase.id, {
                ...rawCase,
                revision: recordRevision(rawCase.revision),
                _sequence: sequence,
                _lastAppliedEventId: typeof event.eventId === "string" ? event.eventId : null,
            })
            continue
        }
        const id = event.rawCaseId
        if (!id || !records.has(id)) continue
        if (event.type === "updated") {
            const current = records.get(id)
            if (
                Object.hasOwn(event, "expectedRevision") &&
                (!Number.isSafeInteger(event.expectedRevision) ||
                    event.expectedRevision < 1 ||
                    event.expectedRevision !== current.revision)
            ) {
                continue
            }
            if (
                Object.hasOwn(event, "expectedSkillName") &&
                normalizedSkillName(event.expectedSkillName) !==
                    normalizedSkillName(current.skill?.name)
            ) {
                continue
            }
            records.set(id, {
                ...current,
                ...jsonCopy(event.changes ?? {}),
                id,
                createdAt: current.createdAt,
                updatedAt: event.occurredAt ?? current.updatedAt,
                revision: current.revision + 1,
                _sequence: current._sequence,
                _lastAppliedEventId: typeof event.eventId === "string" ? event.eventId : null,
            })
        } else if (event.type === "deleted" || event.type === "dispatched") {
            records.delete(id)
        }
    }
    return [...records.values()]
}

function publicRecord(record) {
    if (!record) return null
    const {_lastAppliedEventId, _sequence, ...value} = record
    return jsonCopy(value)
}

class RawCaseStore {
    constructor(path = defaultRawCaseEventsPath()) {
        this.path = path
        this.listeners = new Set()
        this.watching = false
    }

    read() {
        const parsed = readRawCaseEvents(this.path)
        return {
            records: reduceRawCaseEvents(parsed.events),
            warnings: parsed.warnings,
        }
    }

    list({skillName = null} = {}) {
        const normalizedFilter = skillName ? normalizedSkillName(skillName) : null
        return this.read().records
            .filter(
                (record) =>
                    !normalizedFilter || normalizedSkillName(record.skill?.name) === normalizedFilter,
            )
            .sort((left, right) => right._sequence - left._sequence)
            .map(publicRecord)
    }

    get(id) {
        const normalizedId = String(id ?? "").trim()
        return publicRecord(this.read().records.find((record) => record.id === normalizedId))
    }

    findDuplicate(input, excludedId = null) {
        const key = deduplicationKey(input)
        return this.read().records.find(
            (record) => record.id !== excludedId && deduplicationKey(record) === key,
        )
    }

    add(input) {
        const normalized = normalizeInput(input)
        const duplicate = this.findDuplicate(normalized)
        if (duplicate) {
            return {created: false, duplicateOf: duplicate.id, rawCase: publicRecord(duplicate)}
        }
        const now = new Date().toISOString()
        const rawCase = {
            id: randomUUID(),
            ...normalized,
            createdAt: now,
            updatedAt: now,
            revision: 1,
        }
        this.append({type: "added", rawCase})
        return publicRecord(rawCase)
    }

    addAutomaticCandidate(input) {
        const normalized = normalizeInput(input)
        const observation = normalizeAutomaticObservation(normalized.source)
        const added = this.add({
            ...normalized,
            source: {kind: "automatic_capture", observations: [observation]},
        })
        if (added?.created !== false) {
            return {
                created: true,
                observed: true,
                duplicateOf: null,
                rawCase: added,
            }
        }

        for (let attempt = 0; attempt < 2; attempt += 1) {
            const current = this.requireRecord(added.duplicateOf)
            const observations = Array.isArray(current.source?.observations)
                ? current.source.observations
                : []
            if (observations.some((entry) => observationKey(entry) === observationKey(observation))) {
                return {
                    created: false,
                    observed: false,
                    duplicateOf: current.id,
                    rawCase: current,
                }
            }
            try {
                const updated = this.updateIfCurrent(current.id, {
                    expectedRevision: current.revision,
                    expectedSkillName: current.skill.name,
                }, {
                    source: {
                        ...current.source,
                        observations: [...observations, observation],
                    },
                })
                return {
                    created: false,
                    observed: true,
                    duplicateOf: current.id,
                    rawCase: updated,
                }
            } catch (error) {
                if (error?.code !== "RAW_CASE_CONFLICT" || attempt === 1) throw error
            }
        }
        throw new RawCaseConflictError()
    }

    addMany(inputs) {
        if (!Array.isArray(inputs)) throw new Error("Raw Case batch must be an array")
        if (inputs.length > MAX_BATCH_SIZE) {
            throw new Error(`Raw Case batch must not exceed ${MAX_BATCH_SIZE} entries`)
        }
        const totalTextLength = inputs.reduce(
            (sum, entry) => sum + String(entry?.question ?? "").length,
            0,
        )
        if (totalTextLength > MAX_BATCH_TEXT_LENGTH) {
            throw new Error(
                `Raw Case batch text must not exceed ${MAX_BATCH_TEXT_LENGTH} characters`,
            )
        }
        const result = {created: [], duplicates: [], rejected: []}
        for (let index = 0; index < inputs.length; index += 1) {
            try {
                const added = this.add(inputs[index])
                if (added?.created === false) {
                    result.duplicates.push({index, duplicateOf: added.duplicateOf})
                } else {
                    result.created.push(added)
                }
            } catch (error) {
                result.rejected.push({index, error: error.message})
            }
        }
        return result
    }

    update(id, changes = {}) {
        const current = this.requireRecord(id)
        return this.updateIfCurrent(id, {
            expectedRevision: current.revision,
            expectedSkillName: current.skill.name,
        }, changes)
    }

    updateIfCurrent(id, {expectedRevision, expectedSkillName} = {}, changes = {}) {
        const current = this.requireRecord(id)
        if (
            !Number.isSafeInteger(expectedRevision) ||
            expectedRevision < 1 ||
            current.revision !== expectedRevision ||
            normalizedSkillName(current.skill?.name) !== normalizedSkillName(expectedSkillName)
        ) {
            throw new RawCaseConflictError()
        }
        const normalized = normalizeInput({
            ...current,
            ...changes,
            skill: changes.skill ?? current.skill,
        })
        const duplicate = this.findDuplicate(normalized, current.id)
        if (duplicate) throw new Error(`A duplicate pending Raw Case already exists: ${duplicate.id}`)
        const eventChanges = {
            question: normalized.question,
            skill: normalized.skill,
            note: normalized.note,
            source: normalized.source,
        }
        const event = this.append({
            type: "updated",
            rawCaseId: current.id,
            expectedRevision: current.revision,
            expectedSkillName: current.skill.name,
            changes: eventChanges,
        })
        const updated = this.read().records.find((record) => record.id === current.id) ?? null
        if (
            updated?.revision !== current.revision + 1 ||
            updated?._lastAppliedEventId !== event.eventId
        ) throw new RawCaseConflictError()
        return publicRecord(updated)
    }

    delete(id) {
        const current = this.requireRecord(id)
        this.append({type: "deleted", rawCaseId: current.id})
        return current
    }

    markDispatched(id, dispatch = {}) {
        const current = this.requireRecord(id)
        this.append({
            type: "dispatched",
            rawCaseId: current.id,
            dispatch: jsonCopy(dispatch),
        })
        return current
    }

    requireRecord(id) {
        const record = this.get(id)
        if (!record) throw new Error(`Unknown pending Raw Case: ${String(id ?? "")}`)
        return record
    }

    append(payload) {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        chmodSync(directory, 0o700)
        const event = {
            schemaVersion: RAW_CASE_EVENT_SCHEMA,
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            ...payload,
        }
        appendFileSync(this.path, `${JSON.stringify(event)}\n`, {encoding: "utf8", mode: 0o600})
        chmodSync(this.path, 0o600)
        return event
    }

    subscribe(listener) {
        if (typeof listener !== "function") throw new Error("Raw Case listener must be a function")
        this.listeners.add(listener)
        if (!this.watching) {
            watchFile(
                this.path,
                {interval: 300, persistent: false},
                (current, previous) => {
                    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
                    const snapshot = this.list()
                    for (const registered of this.listeners) registered(snapshot)
                },
            )
            this.watching = true
        }
        return () => {
            this.listeners.delete(listener)
            if (this.listeners.size === 0) this.stopWatching()
        }
    }

    stopWatching() {
        if (!this.watching) return
        unwatchFile(this.path)
        this.watching = false
    }

    close() {
        this.listeners.clear()
        this.stopWatching()
    }
}

module.exports = {
    MAX_BATCH_SIZE,
    MAX_BATCH_TEXT_LENGTH,
    MAX_QUESTION_LENGTH,
    RAW_CASE_EVENT_SCHEMA,
    RawCaseConflictError,
    RawCaseStore,
    defaultRawCaseEventsPath,
    normalizedSkillName,
    readRawCaseEvents,
    reduceRawCaseEvents,
}
