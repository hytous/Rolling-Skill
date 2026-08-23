const {createHash, randomUUID} = require("node:crypto")
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
const {dirname, join, relative, resolve, sep} = require("node:path")

const OPERATOR_JOB_STORE_SCHEMA = "rolling-skill-operator-jobs/v1"
const MAX_STORE_BYTES = 64 * 1024 * 1024
const MAX_ENVELOPE_BYTES = 256 * 1024
const MAX_INLINE_ARTIFACT_BYTES = 128 * 1024
const MAX_JOB_EVENTS = 10_000
const MAX_SESSION_TRANSCRIPT_ENTRIES = 10_000
const TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"])
const JOB_TRANSITIONS = new Map([
    ["queued", new Set(["running", "cancelled", "failed"])],
    ["running", new Set([
        "waiting_approval",
        "paused",
        "cancelling",
        "succeeded",
        "failed",
        "needs_recovery",
    ])],
    ["waiting_approval", new Set(["running", "paused", "cancelling", "failed"])],
    ["paused", new Set(["running", "cancelling"])],
    ["cancelling", new Set(["cancelled", "needs_recovery"])],
    ["needs_recovery", new Set(["running", "cancelled", "failed"])],
])
const ALL_JOB_STATUSES = new Set([
    ...JOB_TRANSITIONS.keys(),
    ...TERMINAL_JOB_STATUSES,
])
const BUDGET_FIELDS = [
    "maxDurationMs",
    "maxRuntimeTurns",
    "maxEvaluations",
    "maxTargetExecutions",
    "maxJudgeExecutions",
    "maxTokens",
    "maxReportedCost",
]

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function copyNullable(value) {
    return value === undefined ? null : copy(value)
}

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function nullableText(value, label, maxLength = 4_096) {
    if (value === undefined || value === null || value === "") return null
    return requiredText(value, label, maxLength)
}

function requireObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} is required`)
    }
    return value
}

function encodedBytes(value, label) {
    try {
        return Buffer.byteLength(JSON.stringify(value))
    } catch {
        throw new Error(`${label} is invalid`)
    }
}

function boundedEnvelope(value, label) {
    if (encodedBytes(value, label) > MAX_ENVELOPE_BYTES) {
        throw new Error(`${label} exceeds the 256 KiB envelope limit`)
    }
    return copy(value)
}

function nowTimestamp() {
    return new Date().toISOString()
}

function initialState() {
    return {
        schemaVersion: OPERATOR_JOB_STORE_SCHEMA,
        sessions: [],
        jobs: [],
        steps: [],
        approvals: [],
        artifacts: [],
        events: [],
    }
}

function normalizeRuntime(value) {
    const runtime = requireObject(value, "Operator Runtime")
    return {
        runtimeId: requiredText(runtime.runtimeId, "Runtime id", 300),
        providerId: requiredText(runtime.providerId, "Runtime provider id", 200),
        displayName: requiredText(runtime.displayName ?? runtime.runtimeId, "Runtime name", 300),
        version: nullableText(runtime.version, "Runtime version", 200),
        executablePath: nullableText(runtime.executablePath, "Runtime executable", 8_192),
    }
}

function normalizeBudget(value) {
    const budget = requireObject(value, "Job budget")
    const normalized = {}
    for (const field of BUDGET_FIELDS) {
        const entry = budget[field]
        if (entry === null && (field === "maxTokens" || field === "maxReportedCost")) {
            normalized[field] = null
            continue
        }
        if (!Number.isFinite(entry) || entry < 0) throw new Error(`Job budget ${field} is invalid`)
        normalized[field] = entry
    }
    return normalized
}

function isInside(directory, path) {
    const candidate = relative(directory, path)
    return candidate !== "" && candidate !== ".." && !candidate.startsWith(`..${sep}`)
}

function validateTimestamp(value, label) {
    const timestamp = requiredText(value, label, 100)
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error(`${label} is invalid`)
    return timestamp
}

function validateState(state, artifactDirectory) {
    if (!state || typeof state !== "object" || state.schemaVersion !== OPERATOR_JOB_STORE_SCHEMA) {
        throw new Error("Unsupported Operator Job store schema")
    }
    for (const field of ["sessions", "jobs", "steps", "approvals", "artifacts", "events"]) {
        if (!Array.isArray(state[field])) throw new Error(`Operator Job store ${field} is invalid`)
    }

    const sessionIds = new Set()
    for (const session of state.sessions) {
        const id = requiredText(session.id, "Operator session id", 200)
        if (sessionIds.has(id)) throw new Error("Duplicate Operator session id")
        sessionIds.add(id)
        normalizeRuntime(session.runtime)
        nullableText(session.modelId, "Operator model id", 300)
        nullableText(session.effort, "Operator effort", 100)
        requiredText(session.protocol, "Operator protocol", 200)
        requiredText(session.capabilityId, "Operator capability id", 300)
        validateTimestamp(session.createdAt, "Operator session createdAt")
        validateTimestamp(session.updatedAt, "Operator session updatedAt")
        if (!Array.isArray(session.transcript)) throw new Error("Operator transcript is invalid")
        if (session.transcript.length > MAX_SESSION_TRANSCRIPT_ENTRIES) {
            throw new Error("Operator transcript exceeds its limit")
        }
        if (session.transcriptSequence !== session.transcript.length) {
            throw new Error("Operator transcript sequence is invalid")
        }
        session.transcript.forEach((entry, index) => {
            if (entry.sessionId !== id || entry.sequence !== index + 1) {
                throw new Error("Operator transcript sequence is invalid")
            }
            requiredText(entry.id, "Operator transcript id", 200)
            validateTimestamp(entry.recordedAt, "Operator transcript recordedAt")
            boundedEnvelope(entry, "Operator transcript entry")
        })
    }

    const jobIds = new Set()
    for (const job of state.jobs) {
        const id = requiredText(job.id, "Operator Job id", 200)
        if (jobIds.has(id)) throw new Error("Duplicate Operator Job id")
        jobIds.add(id)
        if (!sessionIds.has(job.sessionId)) throw new Error("Operator Job session is unknown")
        requiredText(job.type, "Operator Job type", 200)
        requiredText(job.objective, "Operator Job objective", 32_768)
        normalizeBudget(job.budget)
        if (!ALL_JOB_STATUSES.has(job.status)) throw new Error("Operator Job status is invalid")
        if (!Array.isArray(job.children) || !Array.isArray(job.artifactIds) || !Array.isArray(job.approvalIds)) {
            throw new Error("Operator Job references are invalid")
        }
        if (!Number.isSafeInteger(job.eventSequence) || job.eventSequence < 0 || job.eventSequence > MAX_JOB_EVENTS) {
            throw new Error("Operator Job event sequence is invalid")
        }
        validateTimestamp(job.createdAt, "Operator Job createdAt")
        validateTimestamp(job.updatedAt, "Operator Job updatedAt")
        if (job.startedAt !== null) validateTimestamp(job.startedAt, "Operator Job startedAt")
        if (job.completedAt !== null) validateTimestamp(job.completedAt, "Operator Job completedAt")
        if (TERMINAL_JOB_STATUSES.has(job.status) !== Boolean(job.terminalSnapshot)) {
            throw new Error("Operator Job terminal snapshot is invalid")
        }
    }
    for (const job of state.jobs) {
        if (job.parentJobId !== null) {
            const parent = state.jobs.find((candidate) => candidate.id === job.parentJobId)
            if (!parent || parent.sessionId !== job.sessionId || !parent.children.includes(job.id)) {
                throw new Error("Operator Job parent reference is invalid")
            }
        }
        for (const childId of job.children) {
            const child = state.jobs.find((candidate) => candidate.id === childId)
            if (!child || child.parentJobId !== job.id || child.sessionId !== job.sessionId) {
                throw new Error("Operator Job child reference is invalid")
            }
        }
    }

    const eventIds = new Set()
    const eventsByJob = new Map()
    for (const event of state.events) {
        const id = requiredText(event.id, "Operator event id", 200)
        if (eventIds.has(id)) throw new Error("Duplicate Operator event id")
        eventIds.add(id)
        if (!jobIds.has(event.jobId)) throw new Error("Operator event Job is unknown")
        if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) {
            throw new Error("Operator event sequence is invalid")
        }
        requiredText(event.kind, "Operator event kind", 300)
        validateTimestamp(event.occurredAt, "Operator event occurredAt")
        boundedEnvelope(event, "Operator event")
        const list = eventsByJob.get(event.jobId) ?? []
        list.push(event.sequence)
        eventsByJob.set(event.jobId, list)
    }
    for (const job of state.jobs) {
        const sequences = (eventsByJob.get(job.id) ?? []).sort((left, right) => left - right)
        if (sequences.length > MAX_JOB_EVENTS || sequences.length !== job.eventSequence) {
            throw new Error("Operator Job event sequence is invalid")
        }
        sequences.forEach((sequence, index) => {
            if (sequence !== index + 1) throw new Error("Operator Job event sequence is invalid")
        })
    }

    const approvalIds = new Set()
    for (const approval of state.approvals) {
        const id = requiredText(approval.id, "Operator approval id", 200)
        if (approvalIds.has(id)) throw new Error("Duplicate Operator approval id")
        approvalIds.add(id)
        const job = state.jobs.find((candidate) => candidate.id === approval.jobId)
        if (!job || job.sessionId !== approval.sessionId || !job.approvalIds.includes(id)) {
            throw new Error("Operator approval Job reference is invalid")
        }
        if (!["pending", "approved", "rejected"].includes(approval.status)) {
            throw new Error("Operator approval status is invalid")
        }
        boundedEnvelope(approval, "Operator approval")
    }

    const artifactIds = new Set()
    for (const artifact of state.artifacts) {
        const id = requiredText(artifact.id, "Operator artifact id", 200)
        if (artifactIds.has(id)) throw new Error("Duplicate Operator artifact id")
        artifactIds.add(id)
        const job = state.jobs.find((candidate) => candidate.id === artifact.jobId)
        if (!job || !job.artifactIds.includes(id)) throw new Error("Operator artifact Job reference is invalid")
        requiredText(artifact.mediaType, "Operator artifact media type", 300)
        if (!Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) {
            throw new Error("Operator artifact byte length is invalid")
        }
        if (!/^[a-f0-9]{64}$/u.test(artifact.sha256)) throw new Error("Operator artifact digest is invalid")
        if (artifact.path === null) {
            if (!artifact.inline || artifact.byteLength > MAX_INLINE_ARTIFACT_BYTES) {
                throw new Error("Operator inline artifact is invalid")
            }
        } else {
            const artifactPath = resolve(requiredText(artifact.path, "Operator artifact path", 8_192))
            if (!isInside(artifactDirectory, artifactPath) || artifact.inline !== null) {
                throw new Error("Operator external artifact path is invalid")
            }
        }
        boundedEnvelope(artifact, "Operator artifact")
    }
    return state
}

function writePrivateFile(path, body) {
    const directory = dirname(path)
    mkdirSync(directory, {recursive: true, mode: 0o700})
    chmodSync(directory, 0o700)
    const temporaryPath = `${path}.tmp-${process.pid}-${randomUUID()}`
    const descriptor = openSync(temporaryPath, "wx", 0o600)
    try {
        try {
            writeFileSync(descriptor, body)
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        renameSync(temporaryPath, path)
        chmodSync(path, 0o600)
    } catch (error) {
        try {
            unlinkSync(temporaryPath)
        } catch {}
        throw error
    }
}

function terminalSnapshot(job) {
    return copy({
        jobId: job.id,
        sessionId: job.sessionId,
        parentJobId: job.parentJobId,
        type: job.type,
        objective: job.objective,
        budget: job.budget,
        status: job.status,
        children: job.children,
        artifactIds: job.artifactIds,
        approvalIds: job.approvalIds,
        eventSequence: job.eventSequence,
        checkpoint: job.checkpoint,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
    })
}

class OperatorJobStore {
    constructor(path) {
        this.path = resolve(requiredText(path, "Operator Job store path", 8_192))
        this.artifactDirectory = join(dirname(this.path), "operator-artifacts")
        this.state = null
        this.load()
    }

    load() {
        if (!existsSync(this.path)) {
            this.state = initialState()
            this.persist()
            return this.read()
        }
        if (statSync(this.path).size > MAX_STORE_BYTES) {
            throw new Error("Operator Job store exceeds its byte limit")
        }
        try {
            this.state = validateState(JSON.parse(readFileSync(this.path, "utf8")), this.artifactDirectory)
        } catch (error) {
            throw new Error(`Could not read Operator Job store: ${error.message}`)
        }
        chmodSync(dirname(this.path), 0o700)
        chmodSync(this.path, 0o600)
        if (existsSync(this.artifactDirectory)) chmodSync(this.artifactDirectory, 0o700)
        for (const artifact of this.state.artifacts) {
            if (artifact.path !== null && existsSync(artifact.path)) chmodSync(artifact.path, 0o600)
        }
        this.recoverInterruptedJobs()
        return this.read()
    }

    persist() {
        const encoded = `${JSON.stringify(this.state, null, 2)}\n`
        if (Buffer.byteLength(encoded) > MAX_STORE_BYTES) {
            throw new Error("Operator Job store exceeds its byte limit")
        }
        writePrivateFile(this.path, encoded)
    }

    mutate(callback) {
        const previous = copy(this.state)
        try {
            const result = callback(this.state)
            validateState(this.state, this.artifactDirectory)
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

    flush() {
        this.persist()
        return this.read()
    }

    createSession(input = {}) {
        const runtime = normalizeRuntime(input.runtime)
        const now = nowTimestamp()
        const session = {
            id: randomUUID(),
            runtime,
            modelId: nullableText(input.modelId, "Operator model id", 300),
            effort: nullableText(input.effort, "Operator effort", 100),
            protocol: requiredText(input.protocol, "Operator protocol", 200),
            capabilityId: requiredText(input.capabilityId, "Operator capability id", 300),
            transcript: [],
            transcriptSequence: 0,
            createdAt: now,
            updatedAt: now,
            closedAt: null,
        }
        boundedEnvelope(session, "Operator session")
        return this.mutate((state) => {
            state.sessions.push(session)
            return session
        })
    }

    getSession(sessionId) {
        const session = this.state.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) throw new Error("Operator session not found")
        return copy(session)
    }

    listSessions() {
        return copy(this.state.sessions)
    }

    createJob(input = {}) {
        const sessionId = requiredText(input.sessionId, "Operator session id", 200)
        const parentJobId = nullableText(input.parentJobId, "Parent Operator Job id", 200)
        const now = nowTimestamp()
        const job = {
            id: randomUUID(),
            sessionId,
            parentJobId,
            type: requiredText(input.type, "Operator Job type", 200),
            objective: requiredText(input.objective, "Operator Job objective", 32_768),
            budget: normalizeBudget(input.budget),
            status: "queued",
            children: [],
            artifactIds: [],
            approvalIds: [],
            eventSequence: 0,
            checkpoint: null,
            result: null,
            error: null,
            terminalSnapshot: null,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
        }
        boundedEnvelope(job, "Operator Job")
        return this.mutate((state) => {
            if (!state.sessions.some((session) => session.id === sessionId)) {
                throw new Error("Operator Job session not found")
            }
            if (parentJobId !== null) {
                const parent = state.jobs.find((candidate) => candidate.id === parentJobId)
                if (!parent) throw new Error("Parent Operator Job not found")
                if (parent.sessionId !== sessionId) throw new Error("Parent Job must use the same session")
                if (TERMINAL_JOB_STATUSES.has(parent.status)) {
                    throw new Error("Cannot add a child to a terminal Operator Job")
                }
                parent.children.push(job.id)
                parent.updatedAt = now
            }
            state.jobs.push(job)
            return job
        })
    }

    getJob(jobId) {
        const job = this.state.jobs.find((candidate) => candidate.id === jobId)
        if (!job) throw new Error("Operator Job not found")
        return copy(job)
    }

    listJobs({sessionId = null, parentJobId = undefined} = {}) {
        return copy(this.state.jobs.filter((job) => (
            (sessionId === null || job.sessionId === sessionId) &&
            (parentJobId === undefined || job.parentJobId === parentJobId)
        )))
    }

    transitionJob(jobId, nextStatus, patch = {}) {
        requiredText(nextStatus, "Operator Job status", 100)
        const allowedPatchFields = new Set(["checkpoint", "result", "error"])
        for (const field of Object.keys(requireObject(patch, "Operator Job transition patch"))) {
            if (!allowedPatchFields.has(field)) {
                throw new Error(`Operator Job ${field} is immutable or unsupported`)
            }
        }
        const normalizedPatch = {}
        for (const field of allowedPatchFields) {
            if (Object.hasOwn(patch, field)) normalizedPatch[field] = copyNullable(patch[field])
        }
        boundedEnvelope(normalizedPatch, "Operator Job transition")
        return this.mutate((state) => {
            const job = state.jobs.find((candidate) => candidate.id === jobId)
            if (!job) throw new Error("Operator Job not found")
            if (TERMINAL_JOB_STATUSES.has(job.status)) {
                throw new Error("A terminal Operator Job cannot transition")
            }
            if (!JOB_TRANSITIONS.get(job.status)?.has(nextStatus)) {
                throw new Error(`Illegal Operator Job transition: ${job.status} -> ${nextStatus}`)
            }
            const now = nowTimestamp()
            if (job.startedAt === null && nextStatus === "running") job.startedAt = now
            Object.assign(job, normalizedPatch)
            job.status = nextStatus
            job.updatedAt = now
            if (TERMINAL_JOB_STATUSES.has(nextStatus)) {
                job.completedAt = now
                job.terminalSnapshot = terminalSnapshot(job)
            }
            return job
        })
    }

    appendEvent(jobId, input = {}) {
        const supplied = boundedEnvelope(requireObject(input, "Operator event"), "Operator event")
        return this.mutate((state) => {
            const job = state.jobs.find((candidate) => candidate.id === jobId)
            if (!job) throw new Error("Operator Job not found")
            if (TERMINAL_JOB_STATUSES.has(job.status)) {
                throw new Error("Cannot append an event to a terminal Operator Job")
            }
            if (job.eventSequence >= MAX_JOB_EVENTS) {
                throw new Error("Operator Job reached the 10,000 event limit")
            }
            const now = nowTimestamp()
            const event = {
                ...supplied,
                id: randomUUID(),
                jobId,
                sequence: job.eventSequence + 1,
                kind: requiredText(supplied.kind, "Operator event kind", 300),
                occurredAt: now,
            }
            boundedEnvelope(event, "Operator event")
            state.events.push(event)
            job.eventSequence = event.sequence
            job.updatedAt = now
            return event
        })
    }

    listEvents(jobId, {afterSequence = 0, limit = MAX_JOB_EVENTS} = {}) {
        this.getJob(jobId)
        if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
            throw new Error("Operator event cursor is invalid")
        }
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_JOB_EVENTS) {
            throw new Error("Operator event page limit is invalid")
        }
        return copy(this.state.events
            .filter((event) => event.jobId === jobId && event.sequence > afterSequence)
            .sort((left, right) => left.sequence - right.sequence)
            .slice(0, limit))
    }

    createArtifact(jobId, input = {}) {
        const artifactInput = requireObject(input, "Operator artifact")
        const job = this.state.jobs.find((candidate) => candidate.id === jobId)
        if (!job) throw new Error("Operator Job not found")
        if (TERMINAL_JOB_STATUSES.has(job.status)) {
            throw new Error("Cannot add an artifact to a terminal Operator Job")
        }
        let body
        let encoding
        if (typeof artifactInput.body === "string") {
            body = Buffer.from(artifactInput.body, "utf8")
            encoding = "utf8"
        } else if (Buffer.isBuffer(artifactInput.body) || artifactInput.body instanceof Uint8Array) {
            body = Buffer.from(artifactInput.body)
            encoding = "base64"
        } else {
            throw new Error("Operator artifact body is required")
        }
        const id = randomUUID()
        const sha256 = createHash("sha256").update(body).digest("hex")
        const now = nowTimestamp()
        const artifact = {
            id,
            jobId,
            kind: requiredText(artifactInput.kind, "Operator artifact kind", 200),
            name: requiredText(artifactInput.name, "Operator artifact name", 1_000),
            mediaType: requiredText(artifactInput.mediaType, "Operator artifact media type", 300),
            byteLength: body.byteLength,
            sha256,
            metadata: copyNullable(artifactInput.metadata),
            path: null,
            inline: body.byteLength <= MAX_INLINE_ARTIFACT_BYTES
                ? {encoding, body: encoding === "utf8" ? body.toString("utf8") : body.toString("base64")}
                : null,
            createdAt: now,
        }
        let externalPath = null
        if (artifact.inline === null) {
            externalPath = join(this.artifactDirectory, `${id}-${sha256}.artifact`)
            artifact.path = externalPath
        }
        boundedEnvelope(artifact, "Operator artifact")
        if (externalPath !== null) writePrivateFile(externalPath, body)
        try {
            return this.mutate((state) => {
                const currentJob = state.jobs.find((candidate) => candidate.id === jobId)
                if (!currentJob || TERMINAL_JOB_STATUSES.has(currentJob.status)) {
                    throw new Error("Operator Job cannot accept an artifact")
                }
                state.artifacts.push(artifact)
                currentJob.artifactIds.push(id)
                currentJob.updatedAt = now
                return artifact
            })
        } catch (error) {
            if (externalPath !== null) {
                try {
                    unlinkSync(externalPath)
                } catch {}
            }
            throw error
        }
    }

    getArtifact(artifactId) {
        const artifact = this.state.artifacts.find((candidate) => candidate.id === artifactId)
        if (!artifact) throw new Error("Operator artifact not found")
        return copy(artifact)
    }

    listArtifacts(jobId) {
        this.getJob(jobId)
        return copy(this.state.artifacts.filter((artifact) => artifact.jobId === jobId))
    }

    readArtifactBody(artifactId) {
        const artifact = this.getArtifact(artifactId)
        let body
        if (artifact.inline !== null) {
            body = Buffer.from(artifact.inline.body, artifact.inline.encoding)
        } else {
            if (!isInside(this.artifactDirectory, resolve(artifact.path))) {
                throw new Error("Operator artifact path is outside the private artifact directory")
            }
            body = readFileSync(artifact.path)
        }
        const digest = createHash("sha256").update(body).digest("hex")
        if (body.byteLength !== artifact.byteLength || digest !== artifact.sha256) {
            throw new Error("Operator artifact integrity check failed")
        }
        return body
    }

    createApproval(jobId, input = {}) {
        const approvalInput = requireObject(input, "Operator approval")
        const job = this.getJob(jobId)
        if (TERMINAL_JOB_STATUSES.has(job.status)) {
            throw new Error("Cannot create approval for a terminal Operator Job")
        }
        const approval = {
            id: randomUUID(),
            jobId,
            sessionId: job.sessionId,
            stepId: nullableText(approvalInput.stepId, "Operator approval Step id", 200),
            action: requiredText(approvalInput.action, "Operator approval action", 300),
            scope: copyNullable(approvalInput.scope),
            proposedMutation: copyNullable(approvalInput.proposedMutation),
            risk: requiredText(approvalInput.risk, "Operator approval risk", 16_384),
            expiresAt: validateTimestamp(approvalInput.expiresAt, "Operator approval expiresAt"),
            status: "pending",
            decision: null,
            decisionScope: null,
            decidedBy: null,
            createdAt: nowTimestamp(),
            resolvedAt: null,
        }
        boundedEnvelope(approval, "Operator approval")
        return this.mutate((state) => {
            const currentJob = state.jobs.find((candidate) => candidate.id === jobId)
            if (!currentJob || TERMINAL_JOB_STATUSES.has(currentJob.status)) {
                throw new Error("Operator Job cannot accept approval")
            }
            state.approvals.push(approval)
            currentJob.approvalIds.push(approval.id)
            currentJob.updatedAt = approval.createdAt
            return approval
        })
    }

    getApproval(approvalId) {
        const approval = this.state.approvals.find((candidate) => candidate.id === approvalId)
        if (!approval) throw new Error("Operator approval not found")
        return copy(approval)
    }

    listApprovals(jobId) {
        this.getJob(jobId)
        return copy(this.state.approvals.filter((approval) => approval.jobId === jobId))
    }

    resolveApproval(approvalId, input = {}) {
        const decisionInput = requireObject(input, "Operator approval decision")
        if (!["approve", "reject"].includes(decisionInput.decision)) {
            throw new Error("Operator approval decision is invalid")
        }
        const decisionScope = requiredText(decisionInput.scope, "Operator approval decision scope", 300)
        const decidedBy = nullableText(decisionInput.decidedBy, "Operator approval decider", 300)
        return this.mutate((state) => {
            const approval = state.approvals.find((candidate) => candidate.id === approvalId)
            if (!approval) throw new Error("Operator approval not found")
            if (approval.status !== "pending") throw new Error("Operator approval is already resolved")
            approval.status = decisionInput.decision === "approve" ? "approved" : "rejected"
            approval.decision = decisionInput.decision
            approval.decisionScope = decisionScope
            approval.decidedBy = decidedBy
            approval.resolvedAt = nowTimestamp()
            return approval
        })
    }

    appendSessionTranscript(sessionId, input = {}) {
        const supplied = boundedEnvelope(requireObject(input, "Operator transcript entry"), "Operator transcript entry")
        return this.mutate((state) => {
            const session = state.sessions.find((candidate) => candidate.id === sessionId)
            if (!session) throw new Error("Operator session not found")
            if (session.closedAt !== null) throw new Error("Operator session is closed")
            if (session.transcriptSequence >= MAX_SESSION_TRANSCRIPT_ENTRIES) {
                throw new Error("Operator transcript reached its entry limit")
            }
            const now = nowTimestamp()
            const entry = {
                ...supplied,
                id: randomUUID(),
                sessionId,
                sequence: session.transcriptSequence + 1,
                kind: requiredText(supplied.kind, "Operator transcript kind", 300),
                recordedAt: now,
            }
            boundedEnvelope(entry, "Operator transcript entry")
            session.transcript.push(entry)
            session.transcriptSequence = entry.sequence
            session.updatedAt = now
            return entry
        })
    }

    getTerminalSnapshot(jobId) {
        const job = this.getJob(jobId)
        if (!TERMINAL_JOB_STATUSES.has(job.status) || job.terminalSnapshot === null) {
            throw new Error("Operator Job has no terminal snapshot")
        }
        return copy(job.terminalSnapshot)
    }

    recoverInterruptedJobs() {
        const interrupted = this.state.jobs.filter((job) => (
            job.status === "running" || job.status === "cancelling"
        ))
        if (interrupted.length === 0) return
        const now = nowTimestamp()
        for (const job of interrupted) {
            const previousStatus = job.status
            job.status = "needs_recovery"
            job.updatedAt = now
            if (job.eventSequence < MAX_JOB_EVENTS) {
                job.eventSequence += 1
                this.state.events.push({
                    id: randomUUID(),
                    jobId: job.id,
                    sequence: job.eventSequence,
                    kind: "recovery_required",
                    previousStatus,
                    occurredAt: now,
                })
            }
        }
        validateState(this.state, this.artifactDirectory)
        this.persist()
    }
}

module.exports = {
    MAX_ENVELOPE_BYTES,
    MAX_INLINE_ARTIFACT_BYTES,
    MAX_JOB_EVENTS,
    OPERATOR_JOB_STORE_SCHEMA,
    OperatorJobStore,
}
