const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} = require("node:fs")
const {randomUUID} = require("node:crypto")
const {dirname, isAbsolute} = require("node:path")

const SKILL_EDIT_STORE_SCHEMA = "rolling-skill-skill-edits/v1"
const ACTIVE_STATES = new Set(["draft", "running", "idle", "applying", "needs_recovery"])
const TERMINAL_STATES = new Set(["published", "discarded", "failed"])
const STATES = new Set([...ACTIVE_STATES, ...TERMINAL_STATES])

function copy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 4_096) {
    const normalized = String(value ?? "").trim()
    if (!normalized || normalized.length > maximum) throw new Error(`${label} is required`)
    return normalized
}

function optionalText(value, label, maximum = 4_096) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maximum)
}

function timestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error("Skill edit timestamp is invalid")
    return date.toISOString()
}

function digest(value, label) {
    const normalized = requiredText(value, label, 80)
    if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${label} is invalid`)
    return normalized
}

function commit(value) {
    const normalized = requiredText(value, "Base commit", 128)
    if (!/^[a-f0-9]{7,64}$/u.test(normalized)) throw new Error("Base commit is invalid")
    return normalized
}

function state(value) {
    const normalized = requiredText(value, "Skill edit state", 32)
    if (!STATES.has(normalized)) throw new Error("Skill edit state is invalid")
    return normalized
}

function runtime(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Skill edit Runtime is required")
    }
    return {
        runtimeId: requiredText(value.runtimeId, "Runtime id", 1_024),
        modelId: requiredText(value.modelId, "Model id", 1_024),
        effort: requiredText(value.effort, "Reasoning effort", 64),
    }
}

function publishedVersion(value) {
    if (value === null || value === undefined) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Published version is invalid")
    }
    return {
        id: requiredText(value.id, "Published version id", 1_024),
        label: requiredText(value.label, "Published version label", 128),
    }
}

function publicError(value) {
    if (value === null || value === undefined) return null
    if (typeof value === "string") return {message: requiredText(value, "Skill edit error", 4_000)}
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Skill edit error is invalid")
    }
    return {
        code: optionalText(value.code, "Skill edit error code", 128),
        message: requiredText(value.message, "Skill edit error", 4_000),
    }
}

function normalizeRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Skill edit record is invalid")
    }
    const workspacePath = requiredText(value.workspacePath, "Skill edit workspace path", 16_384)
    if (!isAbsolute(workspacePath)) throw new Error("Skill edit workspace path must be absolute")
    const revision = Number(value.revision)
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Skill edit revision is invalid")
    return {
        id: requiredText(value.id, "Skill edit id", 1_024),
        repositoryId: requiredText(value.repositoryId, "Repository id", 1_024),
        skillId: requiredText(value.skillId, "Skill id", 1_024),
        skillRoot: requiredText(value.skillRoot, "Skill root", 16_384),
        baseCommit: commit(value.baseCommit),
        baseContentDigest: digest(value.baseContentDigest, "Base content digest"),
        baseSnapshotDigest: digest(value.baseSnapshotDigest, "Base snapshot digest"),
        workspacePath,
        runtime: runtime(value.runtime),
        objective: requiredText(value.objective, "Skill edit objective", 20_000),
        state: state(value.state),
        revision,
        operatorSessionId: optionalText(value.operatorSessionId, "Operator session id", 1_024),
        publishedVersion: publishedVersion(value.publishedVersion),
        error: publicError(value.error),
        createdAt: timestamp(value.createdAt),
        updatedAt: timestamp(value.updatedAt),
    }
}

function emptyState() {
    return {schemaVersion: SKILL_EDIT_STORE_SCHEMA, edits: []}
}

class SkillEditStore {
    constructor(path, {now = () => new Date(), idFactory = randomUUID} = {}) {
        this.path = requiredText(path, "Skill edit store path", 16_384)
        if (!isAbsolute(this.path)) throw new Error("Skill edit store path must be absolute")
        this.now = now
        this.idFactory = idFactory
        this.state = null
    }

    load() {
        if (this.state) return this.state
        if (!existsSync(this.path)) {
            this.state = emptyState()
            this.persist()
            return this.state
        }
        const parsed = JSON.parse(readFileSync(this.path, "utf8"))
        if (
            !parsed ||
            parsed.schemaVersion !== SKILL_EDIT_STORE_SCHEMA ||
            !Array.isArray(parsed.edits)
        ) throw new Error("Unsupported Skill edit store schema")
        const edits = parsed.edits.map(normalizeRecord)
        const ids = new Set()
        const activeSkills = new Set()
        for (const edit of edits) {
            if (ids.has(edit.id)) throw new Error("Duplicate Skill edit id")
            ids.add(edit.id)
            if (!ACTIVE_STATES.has(edit.state)) continue
            if (activeSkills.has(edit.skillId)) throw new Error("Duplicate active Skill edit session")
            activeSkills.add(edit.skillId)
        }
        this.state = {schemaVersion: SKILL_EDIT_STORE_SCHEMA, edits}
        return this.state
    }

    persist() {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        chmodSync(directory, 0o700)
        const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {mode: 0o600})
        chmodSync(temporary, 0o600)
        renameSync(temporary, this.path)
        chmodSync(this.path, 0o600)
    }

    get(id) {
        const normalizedId = requiredText(id, "Skill edit id", 1_024)
        const record = this.load().edits.find(edit => edit.id === normalizedId)
        return record ? copy(record) : null
    }

    require(id) {
        const record = this.get(id)
        if (!record) {
            const error = new Error("Skill edit session was not found")
            error.code = "NOT_FOUND"
            throw error
        }
        return record
    }

    list({skillId = null} = {}) {
        const normalizedSkillId = skillId === null
            ? null
            : requiredText(skillId, "Skill id", 1_024)
        return this.load().edits
            .filter(edit => normalizedSkillId === null || edit.skillId === normalizedSkillId)
            .slice()
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map(copy)
    }

    activeForSkill(skillId) {
        const normalizedSkillId = requiredText(skillId, "Skill id", 1_024)
        const record = this.load().edits.find(edit => (
            edit.skillId === normalizedSkillId && ACTIVE_STATES.has(edit.state)
        ))
        return record ? copy(record) : null
    }

    create(input) {
        const normalizedSkillId = requiredText(input?.skillId, "Skill id", 1_024)
        if (this.activeForSkill(normalizedSkillId)) {
            const error = new Error("This Skill already has an active edit session")
            error.code = "RESOURCE_CHANGED"
            throw error
        }
        const now = timestamp(this.now())
        const record = normalizeRecord({
            ...copy(input),
            id: requiredText(this.idFactory(), "Skill edit id", 1_024),
            skillId: normalizedSkillId,
            state: "draft",
            revision: 1,
            operatorSessionId: null,
            publishedVersion: null,
            error: null,
            createdAt: now,
            updatedAt: now,
        })
        this.load().edits.push(record)
        this.persist()
        return copy(record)
    }

    update(id, expectedRevision, patch = {}) {
        const current = this.require(id)
        if (current.revision !== expectedRevision) {
            const error = new Error("Skill edit changed since it was loaded")
            error.code = "RESOURCE_CHANGED"
            throw error
        }
        if (TERMINAL_STATES.has(current.state)) throw new Error("Skill edit is already closed")
        const allowed = new Set(["state", "operatorSessionId", "publishedVersion", "error"])
        for (const key of Object.keys(patch)) {
            if (!allowed.has(key)) throw new Error(`Skill edit field cannot be updated: ${key}`)
        }
        const next = normalizeRecord({
            ...current,
            ...copy(patch),
            revision: current.revision + 1,
            updatedAt: timestamp(this.now()),
        })
        if (TERMINAL_STATES.has(next.state)) {
            throw new Error("Use close to enter a terminal state")
        }
        const index = this.load().edits.findIndex(edit => edit.id === current.id)
        this.state.edits[index] = next
        this.persist()
        return copy(next)
    }

    close(id, expectedRevision, patch = {}) {
        const current = this.require(id)
        if (current.revision !== expectedRevision) {
            const error = new Error("Skill edit changed since it was loaded")
            error.code = "RESOURCE_CHANGED"
            throw error
        }
        const nextState = state(patch.state)
        if (!TERMINAL_STATES.has(nextState)) throw new Error("Skill edit terminal state is required")
        const next = normalizeRecord({
            ...current,
            state: nextState,
            publishedVersion: Object.hasOwn(patch, "publishedVersion")
                ? patch.publishedVersion
                : current.publishedVersion,
            error: Object.hasOwn(patch, "error") ? patch.error : current.error,
            revision: current.revision + 1,
            updatedAt: timestamp(this.now()),
        })
        const index = this.load().edits.findIndex(edit => edit.id === current.id)
        this.state.edits[index] = next
        this.persist()
        return copy(next)
    }
}

module.exports = {
    ACTIVE_STATES,
    SKILL_EDIT_STORE_SCHEMA,
    SkillEditStore,
    TERMINAL_STATES,
}
