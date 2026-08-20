const {randomUUID} = require("node:crypto")
const {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {dirname, resolve} = require("node:path")

const SKILL_INSTALLATION_STORE_SCHEMA = "rolling-skill-installations/v1"
const MAX_STORE_BYTES = 24 * 1024 * 1024
const MAX_ENTRY_BYTES = 128 * 1024
const MAX_TIMELINE_ENTRIES = 2_000
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled", "unverified"])
const NONTERMINAL_STATUSES = new Set([
    "queued",
    "running",
    "awaiting_permission",
    "awaiting_confirmation",
    "verifying",
])
const ALL_STATUSES = new Set([...NONTERMINAL_STATUSES, ...TERMINAL_STATUSES])
const TRANSITIONS = new Map([
    ["queued", new Set(["running", "cancelled", "failed", "unverified"])],
    ["running", new Set([
        "awaiting_permission",
        "awaiting_confirmation",
        "verifying",
        "succeeded",
        "failed",
        "cancelled",
        "unverified",
    ])],
    ["awaiting_permission", new Set(["running", "verifying", "failed", "cancelled", "unverified"])],
    ["awaiting_confirmation", new Set(["running", "verifying", "failed", "cancelled", "unverified"])],
    ["verifying", new Set(["succeeded", "failed", "cancelled", "unverified"])],
])

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function nullableText(value, label, maxLength = 4_096) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maxLength)
}

function initialSkillInstallationState() {
    return {
        schemaVersion: SKILL_INSTALLATION_STORE_SCHEMA,
        jobs: [],
        installations: [],
    }
}

function normalizeError(value) {
    if (!value) return null
    return {
        code: requiredText(value.code ?? "INSTALLATION_FAILED", "Installation error code", 200),
        message: requiredText(value.message ?? String(value), "Installation error message", 16_384),
    }
}

function normalizeRuntime(runtime = {}) {
    return {
        runtimeId: requiredText(runtime.runtimeId, "Runtime id", 300),
        providerId: requiredText(runtime.providerId, "Provider id", 100),
        displayName: requiredText(runtime.displayName ?? runtime.providerId, "Runtime name", 300),
        version: nullableText(runtime.version, "Runtime version", 200),
        executablePath: nullableText(runtime.executablePath, "Runtime executable", 8_192),
    }
}

function normalizeRequest(request = {}) {
    const source = request.source ?? {}
    return {
        schema: requiredText(request.schema, "Installation request schema", 100),
        markerSchema: requiredText(request.markerSchema, "Installation marker schema", 100),
        repositoryPath: requiredText(request.repositoryPath, "Managed repository path", 8_192),
        skillName: requiredText(request.skillName, "Skill name", 200),
        versionLabel: requiredText(request.versionLabel, "Version label", 100),
        source: {
            repositoryId: requiredText(source.repositoryId, "Repository id", 200),
            skillId: requiredText(source.skillId, "Skill id", 200),
            versionId: requiredText(source.versionId, "Version id", 200),
            commit: requiredText(source.commit, "Commit", 40),
            skillRoot: requiredText(source.skillRoot, "Skill root", 4_096),
            expectedDigest: requiredText(source.expectedDigest, "Expected digest", 80),
        },
    }
}

function validateTimelineEntry(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} is required`)
    }
    let encoded
    try {
        encoded = JSON.stringify(value)
    } catch {
        throw new Error(`${label} is invalid`)
    }
    if (Buffer.byteLength(encoded) > MAX_ENTRY_BYTES) throw new Error(`${label} is too large`)
    return copy(value)
}

function validateState(state) {
    if (!state || typeof state !== "object" || state.schemaVersion !== SKILL_INSTALLATION_STORE_SCHEMA) {
        throw new Error("Unsupported Skill installation store schema")
    }
    if (!Array.isArray(state.jobs) || !Array.isArray(state.installations)) {
        throw new Error("Skill installation store is invalid")
    }
    const jobIds = new Set()
    for (const job of state.jobs) {
        const id = requiredText(job.id, "Installation job id", 200)
        if (jobIds.has(id)) throw new Error("Duplicate Skill installation job")
        jobIds.add(id)
        normalizeRuntime(job.runtime)
        normalizeRequest(job.request)
        if (!ALL_STATUSES.has(job.status)) throw new Error("Skill installation job status is invalid")
        if (!Array.isArray(job.messages) || !Array.isArray(job.activities) || !Array.isArray(job.timeline)) {
            throw new Error("Skill installation timeline is invalid")
        }
        if (
            job.messages.length > MAX_TIMELINE_ENTRIES ||
            job.activities.length > MAX_TIMELINE_ENTRIES ||
            job.timeline.length > MAX_TIMELINE_ENTRIES
        ) {
            throw new Error("Skill installation timeline exceeds its limit")
        }
        job.messages.forEach((entry) => validateTimelineEntry(entry, "Installation message"))
        job.activities.forEach((entry) => validateTimelineEntry(entry, "Installation activity"))
        job.timeline.forEach((entry) => validateTimelineEntry(entry, "Installation timeline entry"))
    }
    for (const installation of state.installations) {
        requiredText(installation.id, "Installation record id", 200)
        requiredText(installation.runtimeId, "Runtime id", 300)
        requiredText(installation.skillId, "Skill id", 200)
        requiredText(installation.versionId, "Version id", 200)
        requiredText(installation.jobId, "Installation job id", 200)
        if (!jobIds.has(installation.jobId)) {
            throw new Error("Trusted installation references an unknown job")
        }
    }
    return state
}

function canTransition(from, to) {
    if (from === to) return true
    if (TERMINAL_STATUSES.has(from)) return false
    return TRANSITIONS.get(from)?.has(to) ?? false
}

class SkillInstallationStore {
    constructor(path) {
        this.path = resolve(requiredText(path, "Skill installation store path"))
        this.state = null
        this.load()
    }

    load() {
        if (!existsSync(this.path)) {
            this.state = initialSkillInstallationState()
            this.persist()
            return this.read()
        }
        if (statSync(this.path).size > MAX_STORE_BYTES) {
            throw new Error("Skill installation store exceeds its byte limit")
        }
        try {
            const parsed = JSON.parse(readFileSync(this.path, "utf8"))
            for (const job of parsed.jobs ?? []) {
                if (Array.isArray(job.timeline)) continue
                job.timeline = [
                    ...(job.messages ?? []).map((entry) => ({...entry, kind: "message"})),
                    ...(job.activities ?? []).map((entry) => ({...entry, kind: "activity"})),
                ].sort((left, right) => String(left.recordedAt ?? "").localeCompare(
                    String(right.recordedAt ?? ""),
                ))
            }
            this.state = validateState(parsed)
        } catch (error) {
            throw new Error(`Could not read Skill installation store: ${error.message}`)
        }
        chmodSync(dirname(this.path), 0o700)
        chmodSync(this.path, 0o600)
        const now = new Date().toISOString()
        let recovered = false
        for (const job of this.state.jobs) {
            if (!NONTERMINAL_STATUSES.has(job.status)) continue
            job.status = "unverified"
            job.error = {
                code: "INSTALLER_PROCESS_INTERRUPTED",
                message: "Rolling Skill stopped before the installation task reached a verified result",
            }
            job.completedAt = now
            job.updatedAt = now
            recovered = true
        }
        if (recovered) this.persist()
        return this.read()
    }

    persist() {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        chmodSync(directory, 0o700)
        const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        const descriptor = openSync(temporaryPath, "wx", 0o600)
        try {
            try {
                writeFileSync(descriptor, `${JSON.stringify(this.state, null, 2)}\n`, "utf8")
                fsyncSync(descriptor)
            } finally {
                closeSync(descriptor)
            }
            renameSync(temporaryPath, this.path)
            chmodSync(this.path, 0o600)
        } catch (error) {
            try {
                unlinkSync(temporaryPath)
            } catch {}
            throw error
        }
    }

    mutate(operation) {
        const previous = this.state
        this.state = copy(previous)
        try {
            const result = operation()
            validateState(this.state)
            this.persist()
            return copy(result)
        } catch (error) {
            this.state = previous
            throw error
        }
    }

    read() {
        return copy(this.state)
    }

    createJob(input = {}) {
        const now = new Date().toISOString()
        const job = {
            id: randomUUID(),
            runtime: normalizeRuntime(input.runtime),
            request: normalizeRequest(input.request),
            modelId: nullableText(input.modelId, "Installation model", 300),
            effort: nullableText(input.effort, "Installation effort", 100),
            permissionMode: nullableText(input.permissionMode, "Installation permission", 100),
            effectiveModelId: null,
            effectiveEffort: null,
            effectivePermissionMode: null,
            status: "queued",
            threadId: null,
            turnId: null,
            messages: [],
            activities: [],
            timeline: [],
            parsedResult: null,
            rawResult: null,
            traceReference: null,
            error: null,
            createdAt: now,
            startedAt: null,
            updatedAt: now,
            completedAt: null,
        }
        return this.mutate(() => {
            this.state.jobs.push(job)
            return job
        })
    }

    getJob(jobId) {
        jobId = requiredText(jobId, "Installation job id", 200)
        const job = this.state.jobs.find((entry) => entry.id === jobId)
        if (!job) throw new Error("Unknown Skill installation job")
        return copy(job)
    }

    listJobs(filters = {}) {
        return copy(this.state.jobs
            .filter((job) => !filters.skillId || job.request.source.skillId === filters.skillId)
            .filter((job) => !filters.runtimeId || job.runtime.runtimeId === filters.runtimeId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)))
    }

    updateJob(jobId, patch = {}) {
        const current = this.getJob(jobId)
        const nextStatus = patch.status ?? current.status
        if (!ALL_STATUSES.has(nextStatus)) throw new Error("Skill installation status is invalid")
        if (!canTransition(current.status, nextStatus)) {
            throw new Error(`Invalid Skill installation transition from ${current.status} to ${nextStatus}`)
        }
        const allowed = new Set([
            "status",
            "threadId",
            "turnId",
            "effectiveModelId",
            "effectiveEffort",
            "effectivePermissionMode",
            "traceReference",
            "rawResult",
            "parsedResult",
            "error",
        ])
        for (const key of Object.keys(patch)) {
            if (!allowed.has(key)) throw new Error(`Unsupported Skill installation job field: ${key}`)
        }
        return this.mutate(() => {
            const job = this.state.jobs.find((entry) => entry.id === current.id)
            job.status = nextStatus
            if (!job.startedAt && nextStatus !== "queued") job.startedAt = new Date().toISOString()
            for (const key of allowed) {
                if (!Object.hasOwn(patch, key) || key === "status") continue
                job[key] = key === "error" ? normalizeError(patch[key]) : copy(patch[key])
            }
            job.updatedAt = new Date().toISOString()
            if (TERMINAL_STATUSES.has(nextStatus)) job.completedAt = job.updatedAt
            return job
        })
    }

    appendMessage(jobId, value) {
        const entry = validateTimelineEntry(value, "Installation message")
        const current = this.getJob(jobId)
        return this.mutate(() => {
            const job = this.state.jobs.find((candidate) => candidate.id === current.id)
            const recorded = {...entry, recordedAt: entry.recordedAt ?? new Date().toISOString()}
            job.messages.push(recorded)
            job.timeline.push({...recorded, kind: "message"})
            if (job.messages.length > MAX_TIMELINE_ENTRIES) {
                job.messages.splice(0, job.messages.length - MAX_TIMELINE_ENTRIES)
            }
            if (job.timeline.length > MAX_TIMELINE_ENTRIES) {
                job.timeline.splice(0, job.timeline.length - MAX_TIMELINE_ENTRIES)
            }
            job.updatedAt = new Date().toISOString()
            return job
        })
    }

    appendActivity(jobId, value) {
        const entry = validateTimelineEntry(value, "Installation activity")
        const current = this.getJob(jobId)
        return this.mutate(() => {
            const job = this.state.jobs.find((candidate) => candidate.id === current.id)
            const recorded = {...entry, recordedAt: entry.recordedAt ?? new Date().toISOString()}
            job.activities.push(recorded)
            job.timeline.push({...recorded, kind: "activity"})
            if (job.activities.length > MAX_TIMELINE_ENTRIES) {
                job.activities.splice(0, job.activities.length - MAX_TIMELINE_ENTRIES)
            }
            if (job.timeline.length > MAX_TIMELINE_ENTRIES) {
                job.timeline.splice(0, job.timeline.length - MAX_TIMELINE_ENTRIES)
            }
            job.updatedAt = new Date().toISOString()
            return job
        })
    }

    completeJob(jobId, input = {}) {
        const job = this.getJob(jobId)
        const status = requiredText(input.status, "Installation completion status", 80)
        if (!TERMINAL_STATUSES.has(status)) throw new Error("Installation completion must be terminal")
        if (status === "succeeded" && input.parsedResult?.trusted !== true) {
            throw new Error("A successful installation requires a trusted protocol result")
        }
        return this.mutate(() => {
            const stored = this.state.jobs.find((entry) => entry.id === job.id)
            if (!canTransition(stored.status, status)) {
                throw new Error(`Invalid Skill installation transition from ${stored.status} to ${status}`)
            }
            stored.status = status
            stored.parsedResult = input.parsedResult ? copy(input.parsedResult) : null
            stored.rawResult = nullableText(input.rawResult, "Raw installation result", 256 * 1024)
            stored.traceReference = nullableText(input.traceReference, "Trace reference", 8_192)
            stored.error = normalizeError(input.error ?? input.parsedResult?.error)
            stored.updatedAt = new Date().toISOString()
            stored.completedAt = stored.updatedAt
            if (status === "succeeded") {
                const result = input.parsedResult
                this.state.installations.push({
                    id: randomUUID(),
                    jobId: stored.id,
                    runtimeId: stored.runtime.runtimeId,
                    providerId: stored.runtime.providerId,
                    skillId: stored.request.source.skillId,
                    repositoryId: stored.request.source.repositoryId,
                    versionId: stored.request.source.versionId,
                    commit: stored.request.source.commit,
                    contentDigest: stored.request.source.expectedDigest,
                    destination: result.destination,
                    verification: result.verification,
                    installedAt: stored.completedAt,
                })
            }
            return stored
        })
    }

    installationMatrix(skillId) {
        skillId = requiredText(skillId, "Skill id", 200)
        const installations = new Map()
        for (const installation of this.state.installations) {
            if (installation.skillId === skillId) installations.set(installation.runtimeId, installation)
        }
        const lastJobs = new Map()
        for (const job of this.state.jobs) {
            if (job.request.source.skillId === skillId) lastJobs.set(job.runtime.runtimeId, job)
        }
        const runtimeIds = new Set([...installations.keys(), ...lastJobs.keys()])
        return [...runtimeIds].sort().map((runtimeId) => {
            const installation = installations.get(runtimeId) ?? null
            const lastJob = lastJobs.get(runtimeId) ?? null
            return {
                runtimeId,
                providerId: lastJob?.runtime.providerId ?? installation?.providerId ?? null,
                displayName: lastJob?.runtime.displayName ?? runtimeId,
                skillId,
                versionId: installation?.versionId ?? null,
                commit: installation?.commit ?? null,
                contentDigest: installation?.contentDigest ?? null,
                destination: installation?.destination ?? null,
                verification: installation?.verification ?? "none",
                installedAt: installation?.installedAt ?? null,
                trustedJobId: installation?.jobId ?? null,
                lastJobId: lastJob?.id ?? null,
                lastJobStatus: lastJob?.status ?? null,
                lastJobUpdatedAt: lastJob?.updatedAt ?? null,
            }
        })
    }
}

module.exports = {
    SKILL_INSTALLATION_STORE_SCHEMA,
    SkillInstallationStore,
    initialSkillInstallationState,
}
