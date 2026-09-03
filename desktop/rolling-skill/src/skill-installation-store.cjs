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
const {dirname, isAbsolute, resolve, win32} = require("node:path")

const SKILL_INSTALLATION_STORE_SCHEMA = "rolling-skill-installations/v1"
const MAX_STORE_BYTES = 24 * 1024 * 1024
const MAX_ENTRY_BYTES = 128 * 1024
const MAX_TIMELINE_ENTRIES = 2_000
const EXPERIMENT_OPERATIONS = new Set([
    "experiment_install",
    "experiment_restore",
    "experiment_remove",
    "experiment_inspect",
])
const OPERATIONS = new Set(["install", "inspect", ...EXPERIMENT_OPERATIONS])
const CONVERSATION_STATUSES = new Set(["idle", "running", "failed"])
const TERMINAL_STATUSES = new Set([
    "succeeded",
    "failed",
    "cancelled",
    "unverified",
    "needs_recovery",
])
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
        "needs_recovery",
    ])],
    ["awaiting_permission", new Set([
        "running",
        "verifying",
        "failed",
        "cancelled",
        "unverified",
        "needs_recovery",
    ])],
    ["awaiting_confirmation", new Set([
        "running",
        "verifying",
        "failed",
        "cancelled",
        "unverified",
        "needs_recovery",
    ])],
    ["verifying", new Set(["succeeded", "failed", "cancelled", "unverified", "needs_recovery"])],
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
    const purpose = request.purpose ?? "managed-installation"
    const normalized = {
        schema: requiredText(request.schema, "Installation request schema", 100),
        purpose: requiredText(purpose, "Installation purpose", 100),
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
    if (purpose === "managed-installation") return normalized
    if (purpose !== "optimization-experiment") {
        throw new Error("Skill installation purpose is invalid")
    }
    const experiment = request.experiment
    if (!experiment || typeof experiment !== "object" || Array.isArray(experiment)) {
        throw new Error("Optimization experiment evidence is required")
    }
    normalized.operation = requiredText(request.operation, "Optimization experiment operation", 80)
    if (!EXPERIMENT_OPERATIONS.has(normalized.operation)) {
        throw new Error("Optimization experiment operation is invalid")
    }
    normalized.experiment = copy(experiment)
    requiredText(experiment.runId, "Optimization Run id", 200)
    if (!Number.isSafeInteger(experiment.epoch) || experiment.epoch < 1) {
        throw new Error("Optimization Epoch is invalid")
    }
    requiredText(experiment.snapshotDigest, "Optimization snapshot digest", 80)
    if (!experiment.marker || typeof experiment.marker !== "object") {
        throw new Error("Optimization experiment marker is required")
    }
    requiredText(experiment.marker.runId, "Optimization marker Run id", 200)
    requiredText(experiment.marker.versionId, "Optimization marker version id", 200)
    requiredText(experiment.baseline?.versionId, "Optimization baseline version id", 200)
    if (experiment.initial !== null) {
        const classification = requiredText(
            experiment.initial?.classification,
            "Optimization initial classification",
            80,
        )
        if (!new Set(["absent", "managed-clean"]).has(classification)) {
            throw new Error("Optimization initial classification is invalid")
        }
    }
    return normalized
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
        const request = normalizeRequest(job.request)
        if (!OPERATIONS.has(job.operation)) throw new Error("Skill installation operation is invalid")
        if (
            (request.purpose === "optimization-experiment") !== EXPERIMENT_OPERATIONS.has(job.operation) ||
            (request.purpose === "optimization-experiment" && request.operation !== job.operation)
        ) {
            throw new Error("Skill installation Job operation does not match its frozen request")
        }
        nullableText(job.parentJobId, "Parent installation job id", 200)
        if (!CONVERSATION_STATUSES.has(job.conversationStatus)) {
            throw new Error("Skill installation conversation status is invalid")
        }
        normalizeError(job.conversationError)
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

function normalizedSkillRoot(value) {
    const path = typeof value === "string" ? value.trim() : ""
    if (!path || (!isAbsolute(path) && !win32.isAbsolute(path))) return null
    const windows = win32.isAbsolute(path)
    const absolute = windows ? win32.resolve(path) : resolve(path)
    const normalized = absolute.replace(/\\/gu, "/").replace(/\/+$/gu, "")
    return /\/SKILL\.md$/iu.test(normalized)
        ? normalized.slice(0, -"/SKILL.md".length)
        : normalized
}

function frozen(value) {
    return Object.freeze(copy(value))
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
                job.operation ??= "install"
                job.parentJobId ??= null
                job.conversationStatus ??= "idle"
                job.conversationError ??= null
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
        for (const job of this.state.jobs) {
            if (job.conversationStatus !== "running") continue
            job.conversationStatus = "failed"
            job.conversationError = {
                code: "INSTALLER_CONVERSATION_INTERRUPTED",
                message: "Rolling Skill stopped before the installer follow-up completed",
            }
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

    listVerifiedInstallations(filters = {}) {
        const normalizedFilters = {}
        for (const [field, label] of [
            ["repositoryId", "Repository id"],
            ["skillId", "Skill id"],
            ["versionId", "Version id"],
            ["runtimeId", "Runtime id"],
            ["providerId", "Provider id"],
        ]) {
            if (filters[field] !== undefined && filters[field] !== null && filters[field] !== "") {
                normalizedFilters[field] = requiredText(filters[field], label, 300)
            }
        }
        const records = []
        for (const installation of this.state.installations) {
            const job = this.state.jobs.find((entry) => entry.id === installation.jobId)
            if (
                !job ||
                job.status !== "succeeded" ||
                job.request.purpose !== "managed-installation" ||
                job.operation !== "install" ||
                job.parsedResult?.trusted !== true ||
                !installation.repositoryId ||
                !installation.skillId ||
                !installation.versionId ||
                !installation.runtimeId ||
                !installation.providerId ||
                !installation.commit ||
                !installation.contentDigest ||
                !normalizedSkillRoot(installation.destination) ||
                !installation.installedAt ||
                !installation.verification ||
                installation.verification === "none" ||
                job.request.source.repositoryId !== installation.repositoryId ||
                job.request.source.skillId !== installation.skillId ||
                job.request.source.versionId !== installation.versionId ||
                job.request.source.commit !== installation.commit ||
                job.request.source.expectedDigest !== installation.contentDigest ||
                job.runtime.runtimeId !== installation.runtimeId ||
                job.runtime.providerId !== installation.providerId ||
                job.parsedResult.destination !== installation.destination ||
                job.parsedResult.verification !== installation.verification
            ) {
                continue
            }
            if (Object.entries(normalizedFilters).some(([field, value]) => installation[field] !== value)) {
                continue
            }
            records.push({
                ...copy(installation),
                installationId: installation.id,
                skillName: job.request.skillName,
                runtime: copy(job.runtime),
            })
        }
        records.sort(
            (left, right) =>
                right.installedAt.localeCompare(left.installedAt) || right.id.localeCompare(left.id),
        )
        return Object.freeze(records.map((entry) => frozen(entry)))
    }

    resolveVerifiedInstallation(input = {}) {
        const filters = {
            repositoryId: requiredText(input.repositoryId, "Repository id", 200),
            skillId: requiredText(input.skillId, "Skill id", 200),
            versionId: requiredText(input.versionId, "Version id", 200),
            runtimeId: requiredText(input.runtimeId, "Runtime id", 300),
            providerId: requiredText(input.providerId, "Provider id", 100),
        }
        const candidates = this.listVerifiedInstallations(filters)
        if (!candidates.length) throw new Error("A verified Skill installation is required")
        const newestInstalledAt = candidates[0].installedAt
        const newest = candidates.filter((entry) => entry.installedAt === newestInstalledAt)
        const signatures = new Set(newest.map((entry) => JSON.stringify({
            repositoryId: entry.repositoryId,
            skillId: entry.skillId,
            versionId: entry.versionId,
            runtimeId: entry.runtimeId,
            providerId: entry.providerId,
            commit: entry.commit,
            contentDigest: entry.contentDigest,
            destination: normalizedSkillRoot(entry.destination),
            verification: entry.verification,
        })))
        if (signatures.size > 1) {
            throw new Error("Conflicting newest verified Skill installations are ambiguous")
        }
        return frozen(newest[0])
    }

    resolveManagedInstallationForLegacyReference(input = {}) {
        const name = requiredText(input.name, "Legacy Skill name", 200)
        const root = normalizedSkillRoot(requiredText(input.path, "Legacy Skill path", 8_192))
        if (!root) throw new Error("Legacy Skill path must be absolute")
        const runtimeId = requiredText(input.runtimeId, "Legacy Runtime id", 300)
        const providerId = nullableText(input.providerId, "Legacy provider id", 100)
        const candidates = this.listVerifiedInstallations({runtimeId, ...(providerId ? {providerId} : {})})
            .filter((entry) => entry.skillName === name)
            .filter((entry) => normalizedSkillRoot(entry.destination) === root)
        if (!candidates.length) return null
        const identities = new Set(candidates.map(
            (entry) => `${entry.repositoryId}\u0000${entry.skillId}`,
        ))
        if (identities.size > 1) {
            throw new Error("Legacy Skill path matches ambiguous managed installations")
        }
        return frozen(candidates[0])
    }

    createJob(input = {}) {
        const now = new Date().toISOString()
        const job = {
            id: randomUUID(),
            operation: OPERATIONS.has(input.operation) ? input.operation : "install",
            parentJobId: nullableText(input.parentJobId, "Parent installation job id", 200),
            runtime: normalizeRuntime(input.runtime),
            request: normalizeRequest(input.request),
            modelId: nullableText(input.modelId, "Installation model", 300),
            effort: nullableText(input.effort, "Installation effort", 100),
            permissionMode: nullableText(input.permissionMode, "Installation permission", 100),
            effectiveModelId: null,
            effectiveEffort: null,
            effectivePermissionMode: null,
            status: "queued",
            threadId: nullableText(input.threadId, "Installer thread id", 300),
            turnId: null,
            conversationStatus: "idle",
            conversationError: null,
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
            "conversationStatus",
            "conversationError",
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
                job[key] = key === "error" || key === "conversationError"
                    ? normalizeError(patch[key])
                    : copy(patch[key])
            }
            if (!CONVERSATION_STATUSES.has(job.conversationStatus)) {
                throw new Error("Skill installation conversation status is invalid")
            }
            job.updatedAt = new Date().toISOString()
            if (TERMINAL_STATUSES.has(nextStatus) && !job.completedAt) job.completedAt = job.updatedAt
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
            if (status === "succeeded" && stored.request.purpose !== "optimization-experiment") {
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
            if (job.request.purpose === "optimization-experiment") continue
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
