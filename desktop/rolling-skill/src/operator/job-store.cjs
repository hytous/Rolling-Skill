const {createHash, randomUUID} = require("node:crypto")
const {
    constants,
    closeSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    readSync,
    realpathSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {basename, dirname, isAbsolute, join, resolve} = require("node:path")

const OPERATOR_JOB_STORE_SCHEMA = "rolling-skill-operator-jobs/v1"
const MAX_STORE_BYTES = 64 * 1024 * 1024
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
const MAX_ENVELOPE_BYTES = 256 * 1024
const MAX_INLINE_ARTIFACT_BYTES = 128 * 1024
const MAX_JOB_EVENTS = 10_000
const MAX_SESSION_TRANSCRIPT_ENTRIES = 10_000
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const DIRECTORY = constants.O_DIRECTORY ?? 0

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
const ALL_JOB_STATUSES = new Set([...JOB_TRANSITIONS.keys(), ...TERMINAL_JOB_STATUSES])
const STEP_STATUSES = new Set([
    "pending",
    "running",
    "waiting_approval",
    "succeeded",
    "failed",
    "cancelled",
    "needs_recovery",
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

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function requireObject(value, label) {
    if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
    return value
}

function exactKeys(value, expected, label) {
    requireObject(value, label)
    const actual = Object.keys(value).sort()
    const canonical = [...expected].sort()
    if (actual.length !== canonical.length || actual.some((key, index) => key !== canonical[index])) {
        throw new Error(`${label} has unknown or missing fields`)
    }
    return value
}

function cloneJson(value, label = "Value", seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${label} is not finite JSON`)
        return value
    }
    if (typeof value !== "object" || value === undefined) throw new Error(`${label} is not JSON`)
    if (seen.has(value)) throw new Error(`${label} is cyclic`)
    seen.add(value)
    let cloned
    if (Array.isArray(value)) {
        cloned = value.map((entry) => cloneJson(entry, label, seen))
    } else {
        requireObject(value, label)
        cloned = {}
        for (const key of Object.keys(value)) cloned[key] = cloneJson(value[key], label, seen)
    }
    seen.delete(value)
    return cloned
}

function copy(value) {
    return cloneJson(value)
}

function encodedBytes(value, label) {
    try {
        return Buffer.byteLength(JSON.stringify(value))
    } catch {
        throw new Error(`${label} is invalid`)
    }
}

function boundedEnvelope(value, label) {
    const cloned = cloneJson(value, label)
    if (encodedBytes(cloned, label) > MAX_ENVELOPE_BYTES) {
        throw new Error(`${label} exceeds the 256 KiB envelope limit`)
    }
    return cloned
}

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function canonicalText(value, label, maxLength = 4_096) {
    const normalized = requiredText(value, label, maxLength)
    if (normalized !== value) throw new Error(`${label} is not canonical`)
    return value
}

function nullableText(value, label, maxLength = 4_096) {
    if (value === undefined || value === null || value === "") return null
    return requiredText(value, label, maxLength)
}

function canonicalNullableText(value, label, maxLength = 4_096) {
    if (value === null) return null
    return canonicalText(value, label, maxLength)
}

function canonicalTimestamp(value, label) {
    const timestamp = canonicalText(value, label, 100)
    if (!Number.isFinite(Date.parse(timestamp)) || new Date(timestamp).toISOString() !== timestamp) {
        throw new Error(`${label} is not a canonical timestamp`)
    }
    return timestamp
}

function canonicalNullableTimestamp(value, label) {
    return value === null ? null : canonicalTimestamp(value, label)
}

function assertTimestampOrder(earlier, later, label) {
    if (Date.parse(later) < Date.parse(earlier)) throw new Error(`${label} is before creation`)
}

function integer(value, label, {minimum = 0, maximum = Number.MAX_SAFE_INTEGER} = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label} is invalid`)
    }
    return value
}

function uniqueTextArray(value, label) {
    if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
    const entries = value.map((entry) => canonicalText(entry, label, 200))
    if (new Set(entries).size !== entries.length) throw new Error(`${label} has duplicate references`)
    return entries
}

function nowTimestamp() {
    return new Date().toISOString()
}

function sha256(body) {
    return createHash("sha256").update(body).digest("hex")
}

function digest(value, label) {
    const normalized = canonicalText(value, label, 64)
    if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${label} is invalid`)
    return normalized
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

function canonicalRuntime(value) {
    exactKeys(value, ["runtimeId", "providerId", "displayName", "version", "executablePath"], "Operator Runtime")
    return {
        runtimeId: canonicalText(value.runtimeId, "Runtime id", 300),
        providerId: canonicalText(value.providerId, "Runtime provider id", 200),
        displayName: canonicalText(value.displayName, "Runtime name", 300),
        version: canonicalNullableText(value.version, "Runtime version", 200),
        executablePath: canonicalNullableText(value.executablePath, "Runtime executable", 8_192),
    }
}

function normalizeBudget(value) {
    const budget = requireObject(value, "Job budget")
    const normalized = {}
    for (const field of BUDGET_FIELDS) {
        const entry = budget[field]
        if (entry === null && (field === "maxTokens" || field === "maxReportedCost")) {
            normalized[field] = null
        } else {
            if (!Number.isFinite(entry) || entry < 0) throw new Error(`Job budget ${field} is invalid`)
            normalized[field] = entry
        }
    }
    return normalized
}

function canonicalBudget(value) {
    exactKeys(value, BUDGET_FIELDS, "Operator Job budget")
    return normalizeBudget(value)
}

function payloadFrom(input, reserved, label = "Envelope payload") {
    const source = requireObject(input, "Envelope")
    const payload = {}
    for (const key of Object.keys(source)) {
        if (!reserved.has(key)) payload[key] = cloneJson(source[key], label)
    }
    return boundedEnvelope(payload, label)
}

function canonicalTranscriptEntry(value) {
    exactKeys(value, ["id", "sessionId", "sequence", "kind", "payload", "recordedAt"], "Operator transcript entry")
    const entry = {
        id: canonicalText(value.id, "Operator transcript id", 200),
        sessionId: canonicalText(value.sessionId, "Operator transcript session id", 200),
        sequence: integer(value.sequence, "Operator transcript sequence", {minimum: 1}),
        kind: canonicalText(value.kind, "Operator transcript kind", 300),
        payload: boundedEnvelope(requireObject(value.payload, "Operator transcript payload"), "Operator transcript payload"),
        recordedAt: canonicalTimestamp(value.recordedAt, "Operator transcript recordedAt"),
    }
    boundedEnvelope(entry, "Operator transcript entry")
    return entry
}

function canonicalSession(value) {
    exactKeys(value, [
        "id", "runtime", "modelId", "effort", "protocol", "capabilityId",
        "transcript", "transcriptSequence", "createdAt", "updatedAt", "closedAt",
    ], "Operator session")
    if (!Array.isArray(value.transcript)) throw new Error("Operator transcript must be an array")
    if (value.transcript.length > MAX_SESSION_TRANSCRIPT_ENTRIES) {
        throw new Error("Operator transcript exceeds its entry limit")
    }
    const session = {
        id: canonicalText(value.id, "Operator session id", 200),
        runtime: canonicalRuntime(value.runtime),
        modelId: canonicalNullableText(value.modelId, "Operator model id", 300),
        effort: canonicalNullableText(value.effort, "Operator effort", 100),
        protocol: canonicalText(value.protocol, "Operator protocol", 200),
        capabilityId: canonicalText(value.capabilityId, "Operator capability id", 300),
        transcript: value.transcript.map(canonicalTranscriptEntry),
        transcriptSequence: integer(value.transcriptSequence, "Operator transcript sequence", {
            maximum: MAX_SESSION_TRANSCRIPT_ENTRIES,
        }),
        createdAt: canonicalTimestamp(value.createdAt, "Operator session createdAt"),
        updatedAt: canonicalTimestamp(value.updatedAt, "Operator session updatedAt"),
        closedAt: canonicalNullableTimestamp(value.closedAt, "Operator session closedAt"),
    }
    if (session.transcriptSequence !== session.transcript.length) {
        throw new Error("Operator transcript sequence is invalid")
    }
    session.transcript.forEach((entry, index) => {
        if (entry.sessionId !== session.id || entry.sequence !== index + 1) {
            throw new Error("Operator transcript sequence or session reference is invalid")
        }
    })
    assertTimestampOrder(session.createdAt, session.updatedAt, "Operator session updatedAt")
    if (session.closedAt !== null) {
        assertTimestampOrder(session.createdAt, session.closedAt, "Operator session closedAt")
        assertTimestampOrder(session.closedAt, session.updatedAt, "Operator session updatedAt")
    }
    return session
}

function canonicalJob(value) {
    exactKeys(value, [
        "id", "sessionId", "parentJobId", "type", "objective", "budget", "status",
        "children", "artifactIds", "approvalIds", "eventSequence", "checkpoint", "result",
        "error", "terminalSnapshot", "createdAt", "updatedAt", "startedAt", "completedAt",
    ], "Operator Job")
    const status = canonicalText(value.status, "Operator Job status", 100)
    if (!ALL_JOB_STATUSES.has(status)) throw new Error("Operator Job status is invalid")
    const job = {
        id: canonicalText(value.id, "Operator Job id", 200),
        sessionId: canonicalText(value.sessionId, "Operator Job session id", 200),
        parentJobId: canonicalNullableText(value.parentJobId, "Parent Operator Job id", 200),
        type: canonicalText(value.type, "Operator Job type", 200),
        objective: canonicalText(value.objective, "Operator Job objective", 32_768),
        budget: canonicalBudget(value.budget),
        status,
        children: uniqueTextArray(value.children, "Operator Job children"),
        artifactIds: uniqueTextArray(value.artifactIds, "Operator Job artifact references"),
        approvalIds: uniqueTextArray(value.approvalIds, "Operator Job approval references"),
        eventSequence: integer(value.eventSequence, "Operator Job event sequence", {maximum: MAX_JOB_EVENTS}),
        checkpoint: cloneJson(value.checkpoint, "Operator Job checkpoint"),
        result: cloneJson(value.result, "Operator Job result"),
        error: cloneJson(value.error, "Operator Job error"),
        terminalSnapshot: cloneJson(value.terminalSnapshot, "Operator Job terminal snapshot"),
        createdAt: canonicalTimestamp(value.createdAt, "Operator Job createdAt"),
        updatedAt: canonicalTimestamp(value.updatedAt, "Operator Job updatedAt"),
        startedAt: canonicalNullableTimestamp(value.startedAt, "Operator Job startedAt"),
        completedAt: canonicalNullableTimestamp(value.completedAt, "Operator Job completedAt"),
    }
    assertTimestampOrder(job.createdAt, job.updatedAt, "Operator Job updatedAt")
    if (job.startedAt !== null) assertTimestampOrder(job.createdAt, job.startedAt, "Operator Job startedAt")
    if (TERMINAL_JOB_STATUSES.has(job.status)) {
        if (job.completedAt === null || job.terminalSnapshot === null) {
            throw new Error("Terminal Operator Job must have a completion time and snapshot")
        }
        assertTimestampOrder(job.createdAt, job.completedAt, "Operator Job completedAt")
    } else if (job.completedAt !== null || job.terminalSnapshot !== null) {
        throw new Error("Nonterminal Operator Job cannot have a terminal snapshot")
    }
    return job
}

function canonicalStep(value) {
    exactKeys(value, [
        "id", "jobId", "sessionId", "method", "idempotencyKey", "status", "inputDigest",
        "outputArtifactIds", "attempt", "error", "createdAt", "updatedAt", "startedAt", "completedAt",
    ], "Operator Step")
    const status = canonicalText(value.status, "Operator Step status", 100)
    if (!STEP_STATUSES.has(status)) throw new Error("Operator Step status is invalid")
    const step = {
        id: canonicalText(value.id, "Operator Step id", 200),
        jobId: canonicalText(value.jobId, "Operator Step Job id", 200),
        sessionId: canonicalText(value.sessionId, "Operator Step session id", 200),
        method: canonicalText(value.method, "Operator Step method", 300),
        idempotencyKey: canonicalText(value.idempotencyKey, "Operator Step idempotency key", 500),
        status,
        inputDigest: digest(value.inputDigest, "Operator Step input digest"),
        outputArtifactIds: uniqueTextArray(value.outputArtifactIds, "Operator Step artifact references"),
        attempt: integer(value.attempt, "Operator Step attempt"),
        error: cloneJson(value.error, "Operator Step error"),
        createdAt: canonicalTimestamp(value.createdAt, "Operator Step createdAt"),
        updatedAt: canonicalTimestamp(value.updatedAt, "Operator Step updatedAt"),
        startedAt: canonicalNullableTimestamp(value.startedAt, "Operator Step startedAt"),
        completedAt: canonicalNullableTimestamp(value.completedAt, "Operator Step completedAt"),
    }
    assertTimestampOrder(step.createdAt, step.updatedAt, "Operator Step updatedAt")
    if (step.startedAt !== null) assertTimestampOrder(step.createdAt, step.startedAt, "Operator Step startedAt")
    if (["succeeded", "failed", "cancelled"].includes(status) !== (step.completedAt !== null)) {
        throw new Error("Operator Step completion fields are inconsistent")
    }
    return step
}

function canonicalApproval(value) {
    exactKeys(value, [
        "id", "jobId", "sessionId", "stepId", "action", "scope", "proposedMutation", "risk",
        "expiresAt", "status", "decision", "decisionScope", "decidedBy", "createdAt", "resolvedAt",
    ], "Operator approval")
    const status = canonicalText(value.status, "Operator approval status", 100)
    if (!["pending", "approved", "rejected"].includes(status)) {
        throw new Error("Operator approval status is invalid")
    }
    const approval = {
        id: canonicalText(value.id, "Operator approval id", 200),
        jobId: canonicalText(value.jobId, "Operator approval Job id", 200),
        sessionId: canonicalText(value.sessionId, "Operator approval session id", 200),
        stepId: canonicalNullableText(value.stepId, "Operator approval Step id", 200),
        action: canonicalText(value.action, "Operator approval action", 300),
        scope: boundedEnvelope(requireObject(value.scope, "Operator approval scope"), "Operator approval scope"),
        proposedMutation: boundedEnvelope(requireObject(value.proposedMutation, "Operator approval mutation"), "Operator approval mutation"),
        risk: canonicalText(value.risk, "Operator approval risk", 16_384),
        expiresAt: canonicalTimestamp(value.expiresAt, "Operator approval expiresAt"),
        status,
        decision: canonicalNullableText(value.decision, "Operator approval decision", 100),
        decisionScope: canonicalNullableText(value.decisionScope, "Operator approval decision scope", 300),
        decidedBy: canonicalNullableText(value.decidedBy, "Operator approval decider", 300),
        createdAt: canonicalTimestamp(value.createdAt, "Operator approval createdAt"),
        resolvedAt: canonicalNullableTimestamp(value.resolvedAt, "Operator approval resolvedAt"),
    }
    if (status === "pending") {
        if (approval.decision !== null || approval.decisionScope !== null || approval.decidedBy !== null || approval.resolvedAt !== null) {
            throw new Error("Pending Operator approval has inconsistent decision fields")
        }
    } else {
        const expectedDecision = status === "approved" ? "approve" : "reject"
        if (approval.decision !== expectedDecision || approval.decisionScope === null || approval.resolvedAt === null) {
            throw new Error("Operator approval decision and status are inconsistent")
        }
        assertTimestampOrder(approval.createdAt, approval.resolvedAt, "Operator approval resolvedAt")
    }
    boundedEnvelope(approval, "Operator approval")
    return approval
}

function artifactFileName(id, artifactDigest) {
    return `${id}-${artifactDigest}.artifact`
}

function decodeInlineArtifact(inline, label) {
    exactKeys(inline, ["encoding", "body"], label)
    const encoding = canonicalText(inline.encoding, `${label} encoding`, 20)
    const body = typeof inline.body === "string" ? inline.body : null
    if (body === null || !["utf8", "base64"].includes(encoding)) throw new Error(`${label} is invalid`)
    if (encoding === "base64" && Buffer.from(body, "base64").toString("base64") !== body) {
        throw new Error(`${label} base64 body is invalid`)
    }
    return {canonical: {encoding, body}, bytes: Buffer.from(body, encoding)}
}

function canonicalArtifact(value) {
    exactKeys(value, [
        "id", "jobId", "kind", "name", "mediaType", "byteLength", "sha256",
        "metadata", "path", "inline", "createdAt",
    ], "Operator artifact")
    const artifact = {
        id: canonicalText(value.id, "Operator artifact id", 200),
        jobId: canonicalText(value.jobId, "Operator artifact Job id", 200),
        kind: canonicalText(value.kind, "Operator artifact kind", 200),
        name: canonicalText(value.name, "Operator artifact name", 1_000),
        mediaType: canonicalText(value.mediaType, "Operator artifact media type", 300),
        byteLength: integer(value.byteLength, "Operator artifact byte length", {maximum: MAX_ARTIFACT_BYTES}),
        sha256: digest(value.sha256, "Operator artifact digest"),
        metadata: cloneJson(value.metadata, "Operator artifact metadata"),
        path: canonicalNullableText(value.path, "Operator artifact path", 500),
        inline: cloneJson(value.inline, "Operator inline artifact"),
        createdAt: canonicalTimestamp(value.createdAt, "Operator artifact createdAt"),
    }
    if (artifact.path === null) {
        if (artifact.inline === null) throw new Error("Operator inline artifact is missing")
        const decoded = decodeInlineArtifact(artifact.inline, "Operator inline artifact")
        artifact.inline = decoded.canonical
        if (
            decoded.bytes.byteLength !== artifact.byteLength ||
            decoded.bytes.byteLength > MAX_INLINE_ARTIFACT_BYTES ||
            sha256(decoded.bytes) !== artifact.sha256
        ) {
            throw new Error("Operator inline artifact integrity is invalid")
        }
    } else {
        if (artifact.inline !== null || artifact.byteLength <= MAX_INLINE_ARTIFACT_BYTES) {
            throw new Error("Operator external artifact shape is invalid")
        }
        if (artifact.path !== artifactFileName(artifact.id, artifact.sha256) || basename(artifact.path) !== artifact.path) {
            throw new Error("Operator external artifact path is invalid")
        }
    }
    boundedEnvelope(artifact, "Operator artifact")
    return artifact
}

function canonicalEvent(value) {
    exactKeys(value, ["id", "jobId", "sequence", "kind", "payload", "occurredAt"], "Operator event")
    const event = {
        id: canonicalText(value.id, "Operator event id", 200),
        jobId: canonicalText(value.jobId, "Operator event Job id", 200),
        sequence: integer(value.sequence, "Operator event sequence", {minimum: 1, maximum: MAX_JOB_EVENTS}),
        kind: canonicalText(value.kind, "Operator event kind", 300),
        payload: boundedEnvelope(requireObject(value.payload, "Operator event payload"), "Operator event payload"),
        occurredAt: canonicalTimestamp(value.occurredAt, "Operator event occurredAt"),
    }
    boundedEnvelope(event, "Operator event")
    return event
}

function terminalSnapshotFrom(job) {
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

function equalJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function hasExactKeys(value, expected) {
    if (!isPlainObject(value)) return false
    const actual = Object.keys(value).sort()
    const canonical = [...expected].sort()
    return actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
}

function migrateLegacyEnvelope(value, baseFields, canonicalFields, label) {
    requireObject(value, label)
    if (hasExactKeys(value, canonicalFields) && isPlainObject(value.payload)) {
        return {value: cloneJson(value, label), migrated: false}
    }
    for (const field of baseFields) {
        if (!Object.hasOwn(value, field)) throw new Error(`${label} legacy envelope is incomplete`)
    }
    const payload = {}
    for (const key of Object.keys(value)) {
        if (!baseFields.includes(key)) payload[key] = cloneJson(value[key], `${label} legacy payload`)
    }
    const migrated = {payload}
    for (const field of baseFields) migrated[field] = cloneJson(value[field], label)
    return {value: migrated, migrated: true}
}

function migrateV1State(value, artifactDirectory) {
    const stateFields = ["schemaVersion", "sessions", "jobs", "steps", "approvals", "artifacts", "events"]
    exactKeys(value, stateFields, "Operator Job store")
    if (value.schemaVersion !== OPERATOR_JOB_STORE_SCHEMA) return {state: value, migrated: false}
    const state = cloneJson(value, "Operator Job store")
    let migrated = false
    if (!Array.isArray(state.sessions) || !Array.isArray(state.events) || !Array.isArray(state.artifacts)) {
        return {state, migrated}
    }
    const transcriptBase = ["id", "sessionId", "sequence", "kind", "recordedAt"]
    const transcriptCanonical = [...transcriptBase, "payload"]
    for (const session of state.sessions) {
        if (!isPlainObject(session) || !Array.isArray(session.transcript)) continue
        session.transcript = session.transcript.map((entry) => {
            const result = migrateLegacyEnvelope(
                entry,
                transcriptBase,
                transcriptCanonical,
                "Operator transcript entry",
            )
            migrated ||= result.migrated
            return result.value
        })
    }
    const eventBase = ["id", "jobId", "sequence", "kind", "occurredAt"]
    const eventCanonical = [...eventBase, "payload"]
    state.events = state.events.map((event) => {
        const result = migrateLegacyEnvelope(event, eventBase, eventCanonical, "Operator event")
        migrated ||= result.migrated
        return result.value
    })
    for (const artifact of state.artifacts) {
        if (!isPlainObject(artifact) || typeof artifact.path !== "string" || !isAbsolute(artifact.path)) continue
        const expectedName = artifactFileName(
            requiredText(artifact.id, "Legacy Operator artifact id", 200),
            requiredText(artifact.sha256, "Legacy Operator artifact digest", 64),
        )
        const expectedPath = join(artifactDirectory, expectedName)
        if (resolve(artifact.path) !== resolve(expectedPath)) {
            throw new Error("Legacy Operator artifact path escapes its private directory")
        }
        artifact.path = expectedName
        migrated = true
    }
    return {state, migrated}
}

function canonicalState(value) {
    exactKeys(value, ["schemaVersion", "sessions", "jobs", "steps", "approvals", "artifacts", "events"], "Operator Job store")
    if (value.schemaVersion !== OPERATOR_JOB_STORE_SCHEMA) throw new Error("Unsupported Operator Job store schema")
    for (const field of ["sessions", "jobs", "steps", "approvals", "artifacts", "events"]) {
        if (!Array.isArray(value[field])) throw new Error(`Operator Job store ${field} must be an array`)
    }
    const state = {
        schemaVersion: OPERATOR_JOB_STORE_SCHEMA,
        sessions: value.sessions.map(canonicalSession),
        jobs: value.jobs.map(canonicalJob),
        steps: value.steps.map(canonicalStep),
        approvals: value.approvals.map(canonicalApproval),
        artifacts: value.artifacts.map(canonicalArtifact),
        events: value.events.map(canonicalEvent),
    }
    const uniqueById = (entries, label) => {
        const ids = entries.map((entry) => entry.id)
        if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label} id`)
        return new Map(entries.map((entry) => [entry.id, entry]))
    }
    const sessions = uniqueById(state.sessions, "Operator session")
    const jobs = uniqueById(state.jobs, "Operator Job")
    const steps = uniqueById(state.steps, "Operator Step")
    const approvals = uniqueById(state.approvals, "Operator approval")
    const artifacts = uniqueById(state.artifacts, "Operator artifact")
    uniqueById(state.events, "Operator event")
    const transcriptIds = state.sessions.flatMap((session) => (
        session.transcript.map((entry) => entry.id)
    ))
    if (new Set(transcriptIds).size !== transcriptIds.length) {
        throw new Error("Operator transcript has duplicate identities")
    }
    const stepIdempotencyKeys = state.steps.map((step) => `${step.jobId}\0${step.idempotencyKey}`)
    if (new Set(stepIdempotencyKeys).size !== stepIdempotencyKeys.length) {
        throw new Error("Operator Step idempotency key must be unique within its Job")
    }

    for (const job of state.jobs) {
        if (!sessions.has(job.sessionId)) throw new Error("Operator Job session reference is unknown")
        if (job.parentJobId !== null) {
            const parent = jobs.get(job.parentJobId)
            if (!parent || parent.sessionId !== job.sessionId || !parent.children.includes(job.id)) {
                throw new Error("Operator Job parent reference is invalid")
            }
        }
        for (const childId of job.children) {
            const child = jobs.get(childId)
            if (!child || child.parentJobId !== job.id || child.sessionId !== job.sessionId) {
                throw new Error("Operator Job child reference is invalid")
            }
        }
        const expectedArtifacts = state.artifacts.filter((entry) => entry.jobId === job.id).map((entry) => entry.id)
        const expectedApprovals = state.approvals.filter((entry) => entry.jobId === job.id).map((entry) => entry.id)
        if (!equalJson(job.artifactIds, expectedArtifacts) || !equalJson(job.approvalIds, expectedApprovals)) {
            throw new Error("Operator Job artifact or approval references are not bidirectional")
        }
        const sequences = state.events
            .filter((entry) => entry.jobId === job.id)
            .map((entry) => entry.sequence)
            .sort((left, right) => left - right)
        if (sequences.length !== job.eventSequence || sequences.some((entry, index) => entry !== index + 1)) {
            throw new Error("Operator Job event sequence is invalid")
        }
        if (TERMINAL_JOB_STATUSES.has(job.status)) {
            exactKeys(job.terminalSnapshot, Object.keys(terminalSnapshotFrom(job)), "Operator Job terminal snapshot")
            if (!equalJson(job.terminalSnapshot, terminalSnapshotFrom(job))) {
                throw new Error("Operator Job terminal snapshot does not match the Job")
            }
        }
    }
    const jobVisitColors = new Map()
    const visitJob = (jobId) => {
        const color = jobVisitColors.get(jobId) ?? 0
        if (color === 1) throw new Error("Operator Job parent graph contains a cycle")
        if (color === 2) return
        jobVisitColors.set(jobId, 1)
        for (const childId of jobs.get(jobId).children) visitJob(childId)
        jobVisitColors.set(jobId, 2)
    }
    for (const jobId of jobs.keys()) visitJob(jobId)
    for (const step of state.steps) {
        const job = jobs.get(step.jobId)
        if (!job || job.sessionId !== step.sessionId) throw new Error("Operator Step Job reference is invalid")
        for (const artifactId of step.outputArtifactIds) {
            if (artifacts.get(artifactId)?.jobId !== step.jobId) {
                throw new Error("Operator Step artifact reference is invalid")
            }
        }
    }
    for (const approval of state.approvals) {
        const job = jobs.get(approval.jobId)
        if (!job || job.sessionId !== approval.sessionId || !job.approvalIds.includes(approval.id)) {
            throw new Error("Operator approval Job reference is invalid")
        }
        if (approval.status === "pending" && job.status !== "waiting_approval") {
            throw new Error("Pending Operator approval requires a waiting_approval Job status")
        }
        if (approval.stepId !== null) {
            const step = steps.get(approval.stepId)
            if (!step || step.jobId !== approval.jobId || step.sessionId !== approval.sessionId) {
                throw new Error("Operator approval Step reference is invalid")
            }
        }
    }
    for (const artifact of state.artifacts) {
        if (!jobs.has(artifact.jobId)) throw new Error("Operator artifact Job reference is invalid")
    }
    for (const event of state.events) {
        if (!jobs.has(event.jobId)) throw new Error("Operator event Job reference is invalid")
    }
    return state
}

function pathEntryExists(path) {
    try {
        lstatSync(path)
        return true
    } catch (error) {
        if (error?.code === "ENOENT") return false
        throw error
    }
}

function secureDirectory(path, {create = false} = {}) {
    const directory = resolve(path)
    if (create) mkdirSync(directory, {recursive: true, mode: 0o700})
    const status = lstatSync(directory)
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error("Private directory must be a regular directory, not a symbolic link")
    }
    if ((status.mode & 0o777) !== 0o700) throw new Error("Private directory must use owner-only mode 0700")
    return {path: directory, realPath: realpathSync(directory), status}
}

function secureFileMetadata(path, directory, maximumBytes, label) {
    const filePath = resolve(path)
    const parent = secureDirectory(directory)
    if (dirname(filePath) !== parent.path) throw new Error(`${label} path escapes its private directory`)
    const status = lstatSync(filePath)
    if (status.isSymbolicLink() || !status.isFile()) throw new Error(`${label} must be a regular file, not a symbolic link`)
    if ((status.mode & 0o777) !== 0o600) throw new Error(`${label} must use owner-only mode 0600`)
    if (status.size > maximumBytes) throw new Error(`${label} exceeds its byte limit`)
    if (realpathSync(filePath) !== join(parent.realPath, basename(filePath))) {
        throw new Error(`${label} real path escapes its private directory`)
    }
    return {filePath, status}
}

function readSecureFile(path, directory, maximumBytes, label) {
    const before = secureFileMetadata(path, directory, maximumBytes, label)
    const descriptor = openSync(before.filePath, constants.O_RDONLY | NOFOLLOW)
    try {
        const opened = fstatSync(descriptor)
        if (!opened.isFile() || opened.dev !== before.status.dev || opened.ino !== before.status.ino) {
            throw new Error(`${label} changed while it was being opened`)
        }
        if ((opened.mode & 0o777) !== 0o600) throw new Error(`${label} must use owner-only mode 0600`)
        if (opened.size > maximumBytes) throw new Error(`${label} exceeds its byte limit`)
        const body = Buffer.alloc(opened.size)
        let offset = 0
        while (offset < body.byteLength) {
            const count = readSync(descriptor, body, offset, body.byteLength - offset, offset)
            if (count === 0) throw new Error(`${label} changed while it was being read`)
            offset += count
        }
        const extra = Buffer.alloc(1)
        if (readSync(descriptor, extra, 0, 1, offset) !== 0) {
            throw new Error(`${label} grew while it was being read`)
        }
        return body
    } finally {
        closeSync(descriptor)
    }
}

function fsyncDirectoryBestEffort(path) {
    let descriptor = null
    try {
        descriptor = openSync(path, constants.O_RDONLY | DIRECTORY | NOFOLLOW)
        if (!fstatSync(descriptor).isDirectory()) return
        fsyncSync(descriptor)
    } catch {
        // Some supported filesystems do not permit directory fsync. The rename already committed.
    } finally {
        if (descriptor !== null) {
            try {
                closeSync(descriptor)
            } catch {}
        }
    }
}

function writePrivateFile(path, body) {
    const filePath = resolve(path)
    const directory = dirname(filePath)
    secureDirectory(directory, {create: true})
    if (pathEntryExists(filePath)) secureFileMetadata(filePath, directory, Number.MAX_SAFE_INTEGER, "Private file")
    const temporaryPath = join(directory, `.${basename(filePath)}.tmp-${process.pid}-${randomUUID()}`)
    const descriptor = openSync(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
        0o600,
    )
    let renamed = false
    try {
        try {
            const status = fstatSync(descriptor)
            if (!status.isFile()) throw new Error("Atomic temporary path is not a regular file")
            fchmodSync(descriptor, 0o600)
            writeFileSync(descriptor, body)
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        secureFileMetadata(temporaryPath, directory, Number.MAX_SAFE_INTEGER, "Atomic temporary file")
        secureDirectory(directory)
        renameSync(temporaryPath, filePath)
        renamed = true
        fsyncDirectoryBestEffort(directory)
    } catch (error) {
        if (!renamed) {
            try {
                unlinkSync(temporaryPath)
            } catch {}
        }
        throw error
    }
}

function publicTranscriptEntry(entry) {
    return copy({...entry.payload, id: entry.id, sessionId: entry.sessionId, sequence: entry.sequence, kind: entry.kind, recordedAt: entry.recordedAt})
}

function publicSession(session) {
    return copy({...session, transcript: session.transcript.map(publicTranscriptEntry)})
}

function publicEvent(event) {
    return copy({...event.payload, id: event.id, jobId: event.jobId, sequence: event.sequence, kind: event.kind, occurredAt: event.occurredAt})
}

class OperatorJobStore {
    #path
    #artifactDirectory
    #state

    constructor(path) {
        this.#path = resolve(requiredText(path, "Operator Job store path", 8_192))
        this.#artifactDirectory = join(dirname(this.#path), "operator-artifacts")
        this.#state = null
        this.load()
    }

    get path() {
        return this.#path
    }

    load() {
        if (!pathEntryExists(this.#path)) {
            this.#state = canonicalState(initialState())
            this.persist()
            return this.read()
        }
        try {
            const encoded = readSecureFile(this.#path, dirname(this.#path), MAX_STORE_BYTES, "Operator Job store")
            const migration = migrateV1State(
                JSON.parse(encoded.toString("utf8")),
                this.#artifactDirectory,
            )
            this.#state = canonicalState(migration.state)
            if (pathEntryExists(this.#artifactDirectory)) secureDirectory(this.#artifactDirectory)
            for (const artifact of this.#state.artifacts) {
                if (artifact.path !== null) this.#readExternalArtifact(artifact)
            }
            if (migration.migrated) this.persist()
        } catch (error) {
            throw new Error(`Could not read Operator Job store: ${error.message}`)
        }
        this.#recoverInterruptedJobs()
        return this.read()
    }

    persist() {
        this.#state = canonicalState(this.#state)
        const encoded = `${JSON.stringify(this.#state, null, 2)}\n`
        if (Buffer.byteLength(encoded) > MAX_STORE_BYTES) throw new Error("Operator Job store exceeds its byte limit")
        writePrivateFile(this.#path, encoded)
    }

    #mutate(callback) {
        const previous = this.#state
        this.#state = copy(previous)
        try {
            const result = callback(this.#state)
            this.#state = canonicalState(this.#state)
            this.persist()
            return copy(result)
        } catch (error) {
            this.#state = previous
            throw error
        }
    }

    read() {
        return {
            schemaVersion: this.#state.schemaVersion,
            sessions: this.#state.sessions.map(publicSession),
            jobs: copy(this.#state.jobs),
            steps: copy(this.#state.steps),
            approvals: copy(this.#state.approvals),
            artifacts: this.#state.artifacts.map((artifact) => this.#publicArtifact(artifact)),
            events: this.#state.events.map(publicEvent),
        }
    }

    flush() {
        this.persist()
        return this.read()
    }

    createSession(input = {}) {
        const now = nowTimestamp()
        const session = {
            id: randomUUID(),
            runtime: normalizeRuntime(input.runtime),
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
        canonicalSession(session)
        return this.#mutate((state) => {
            state.sessions.push(session)
            return session
        })
    }

    getSession(sessionId) {
        const session = this.#state.sessions.find((candidate) => candidate.id === sessionId)
        if (!session) throw new Error("Operator session not found")
        return publicSession(session)
    }

    listSessions() {
        return this.#state.sessions.map(publicSession)
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
        canonicalJob(job)
        return this.#mutate((state) => {
            if (!state.sessions.some((session) => session.id === sessionId)) throw new Error("Operator Job session not found")
            if (parentJobId !== null) {
                const parent = state.jobs.find((candidate) => candidate.id === parentJobId)
                if (!parent) throw new Error("Parent Operator Job not found")
                if (parent.sessionId !== sessionId) throw new Error("Parent Job must use the same session")
                if (TERMINAL_JOB_STATUSES.has(parent.status)) throw new Error("Cannot add a child to a terminal Operator Job")
                parent.children.push(job.id)
                parent.updatedAt = now
            }
            state.jobs.push(job)
            return job
        })
    }

    getJob(jobId) {
        const job = this.#state.jobs.find((candidate) => candidate.id === jobId)
        if (!job) throw new Error("Operator Job not found")
        return copy(job)
    }

    listJobs({sessionId = null, parentJobId = undefined} = {}) {
        return copy(this.#state.jobs.filter((job) => (
            (sessionId === null || job.sessionId === sessionId) &&
            (parentJobId === undefined || job.parentJobId === parentJobId)
        )))
    }

    transitionJob(jobId, nextStatus, patch = {}) {
        requiredText(nextStatus, "Operator Job status", 100)
        const allowed = new Set(["checkpoint", "result", "error"])
        for (const field of Object.keys(requireObject(patch, "Operator Job transition patch"))) {
            if (!allowed.has(field)) throw new Error(`Operator Job ${field} is immutable or unsupported`)
        }
        const normalized = {}
        for (const field of allowed) {
            if (Object.hasOwn(patch, field)) normalized[field] = cloneJson(patch[field] ?? null, `Operator Job ${field}`)
        }
        boundedEnvelope(normalized, "Operator Job transition")
        return this.#mutate((state) => {
            const job = state.jobs.find((candidate) => candidate.id === jobId)
            if (!job) throw new Error("Operator Job not found")
            if (TERMINAL_JOB_STATUSES.has(job.status)) throw new Error("A terminal Operator Job cannot transition")
            if (!JOB_TRANSITIONS.get(job.status)?.has(nextStatus)) {
                throw new Error(`Illegal Operator Job transition: ${job.status} -> ${nextStatus}`)
            }
            const now = nowTimestamp()
            if (job.startedAt === null && nextStatus === "running") job.startedAt = now
            Object.assign(job, normalized)
            job.status = nextStatus
            job.updatedAt = now
            if (TERMINAL_JOB_STATUSES.has(nextStatus)) {
                for (const approval of state.approvals) {
                    if (approval.jobId !== job.id || approval.status !== "pending") continue
                    approval.status = "rejected"
                    approval.decision = "reject"
                    approval.decisionScope = "job_terminal"
                    approval.decidedBy = "job-engine"
                    approval.resolvedAt = now
                }
                job.completedAt = now
                job.terminalSnapshot = terminalSnapshotFrom(job)
            }
            return job
        })
    }

    appendEvent(jobId, input = {}) {
        const kind = requiredText(input.kind, "Operator event kind", 300)
        const payload = payloadFrom(
            input,
            new Set(["id", "jobId", "sequence", "kind", "occurredAt"]),
            "Operator event payload",
        )
        return this.#mutate((state) => {
            const job = state.jobs.find((candidate) => candidate.id === jobId)
            if (!job) throw new Error("Operator Job not found")
            if (TERMINAL_JOB_STATUSES.has(job.status)) throw new Error("Cannot append an event to a terminal Operator Job")
            if (job.eventSequence >= MAX_JOB_EVENTS) throw new Error("Operator Job reached the 10,000 event limit")
            const now = nowTimestamp()
            const event = {
                id: randomUUID(),
                jobId,
                sequence: job.eventSequence + 1,
                kind,
                payload,
                occurredAt: now,
            }
            canonicalEvent(event)
            state.events.push(event)
            job.eventSequence = event.sequence
            job.updatedAt = now
            return publicEvent(event)
        })
    }

    listEvents(jobId, {afterSequence = 0, limit = MAX_JOB_EVENTS} = {}) {
        this.getJob(jobId)
        integer(afterSequence, "Operator event cursor")
        integer(limit, "Operator event page limit", {minimum: 1, maximum: MAX_JOB_EVENTS})
        return this.#state.events
            .filter((event) => event.jobId === jobId && event.sequence > afterSequence)
            .sort((left, right) => left.sequence - right.sequence)
            .slice(0, limit)
            .map(publicEvent)
    }

    #artifactPath(artifact) {
        return join(this.#artifactDirectory, artifact.path)
    }

    #publicArtifact(artifact) {
        return copy({...artifact, path: artifact.path === null ? null : this.#artifactPath(artifact)})
    }

    #readExternalArtifact(artifact) {
        const body = readSecureFile(
            this.#artifactPath(artifact),
            this.#artifactDirectory,
            MAX_ARTIFACT_BYTES,
            "Operator artifact",
        )
        if (body.byteLength !== artifact.byteLength || sha256(body) !== artifact.sha256) {
            throw new Error("Operator artifact integrity check failed")
        }
        return body
    }

    createArtifact(jobId, input = {}) {
        const artifactInput = requireObject(input, "Operator artifact")
        const currentJob = this.getJob(jobId)
        if (TERMINAL_JOB_STATUSES.has(currentJob.status)) throw new Error("Cannot add an artifact to a terminal Operator Job")
        let body
        let encoding
        if (typeof artifactInput.body === "string") {
            if (Buffer.byteLength(artifactInput.body, "utf8") > MAX_ARTIFACT_BYTES) {
                throw new Error("Operator artifact exceeds its 64 MiB byte limit")
            }
            body = Buffer.from(artifactInput.body, "utf8")
            encoding = "utf8"
        } else if (Buffer.isBuffer(artifactInput.body) || artifactInput.body instanceof Uint8Array) {
            if (artifactInput.body.byteLength > MAX_ARTIFACT_BYTES) {
                throw new Error("Operator artifact exceeds its 64 MiB byte limit")
            }
            body = Buffer.from(artifactInput.body)
            encoding = "base64"
        } else {
            throw new Error("Operator artifact body is required")
        }
        if (body.byteLength > MAX_ARTIFACT_BYTES) throw new Error("Operator artifact exceeds its 64 MiB byte limit")
        const id = randomUUID()
        const artifactDigest = sha256(body)
        const artifact = {
            id,
            jobId,
            kind: requiredText(artifactInput.kind, "Operator artifact kind", 200),
            name: requiredText(artifactInput.name, "Operator artifact name", 1_000),
            mediaType: requiredText(artifactInput.mediaType, "Operator artifact media type", 300),
            byteLength: body.byteLength,
            sha256: artifactDigest,
            metadata: cloneJson(artifactInput.metadata ?? null, "Operator artifact metadata"),
            path: null,
            inline: body.byteLength <= MAX_INLINE_ARTIFACT_BYTES
                ? {encoding, body: body.toString(encoding)}
                : null,
            createdAt: nowTimestamp(),
        }
        if (artifact.inline === null) artifact.path = artifactFileName(id, artifactDigest)
        canonicalArtifact(artifact)
        let externalPath = null
        if (artifact.path !== null) {
            externalPath = this.#artifactPath(artifact)
            writePrivateFile(externalPath, body)
        }
        try {
            const stored = this.#mutate((state) => {
                const job = state.jobs.find((candidate) => candidate.id === jobId)
                if (!job || TERMINAL_JOB_STATUSES.has(job.status)) throw new Error("Operator Job cannot accept an artifact")
                state.artifacts.push(artifact)
                job.artifactIds.push(id)
                job.updatedAt = artifact.createdAt
                return artifact
            })
            return this.#publicArtifact(stored)
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
        const artifact = this.#state.artifacts.find((candidate) => candidate.id === artifactId)
        if (!artifact) throw new Error("Operator artifact not found")
        return this.#publicArtifact(artifact)
    }

    listArtifacts(jobId) {
        this.getJob(jobId)
        return this.#state.artifacts.filter((artifact) => artifact.jobId === jobId).map((artifact) => this.#publicArtifact(artifact))
    }

    readArtifactBody(artifactId) {
        const artifact = this.#state.artifacts.find((candidate) => candidate.id === artifactId)
        if (!artifact) throw new Error("Operator artifact not found")
        const body = artifact.inline === null
            ? this.#readExternalArtifact(artifact)
            : Buffer.from(artifact.inline.body, artifact.inline.encoding)
        if (body.byteLength !== artifact.byteLength || sha256(body) !== artifact.sha256) {
            throw new Error("Operator artifact integrity check failed")
        }
        return body
    }

    createApproval(jobId, input = {}) {
        const approvalInput = requireObject(input, "Operator approval")
        const job = this.getJob(jobId)
        if (job.status !== "waiting_approval") {
            throw new Error("Operator Job must be waiting_approval before creating an approval")
        }
        const approval = {
            id: randomUUID(),
            jobId,
            sessionId: job.sessionId,
            stepId: nullableText(approvalInput.stepId, "Operator approval Step id", 200),
            action: requiredText(approvalInput.action, "Operator approval action", 300),
            scope: boundedEnvelope(requireObject(approvalInput.scope, "Operator approval scope"), "Operator approval scope"),
            proposedMutation: boundedEnvelope(requireObject(approvalInput.proposedMutation, "Operator approval mutation"), "Operator approval mutation"),
            risk: requiredText(approvalInput.risk, "Operator approval risk", 16_384),
            expiresAt: canonicalTimestamp(approvalInput.expiresAt, "Operator approval expiresAt"),
            status: "pending",
            decision: null,
            decisionScope: null,
            decidedBy: null,
            createdAt: nowTimestamp(),
            resolvedAt: null,
        }
        canonicalApproval(approval)
        return this.#mutate((state) => {
            const current = state.jobs.find((candidate) => candidate.id === jobId)
            if (!current || current.status !== "waiting_approval") throw new Error("Operator Job cannot accept approval")
            state.approvals.push(approval)
            current.approvalIds.push(approval.id)
            current.updatedAt = approval.createdAt
            return approval
        })
    }

    getApproval(approvalId) {
        const approval = this.#state.approvals.find((candidate) => candidate.id === approvalId)
        if (!approval) throw new Error("Operator approval not found")
        return copy(approval)
    }

    listApprovals(jobId) {
        this.getJob(jobId)
        return copy(this.#state.approvals.filter((approval) => approval.jobId === jobId))
    }

    resolveApproval(approvalId, input = {}) {
        const decisionInput = requireObject(input, "Operator approval decision")
        if (!["approve", "reject"].includes(decisionInput.decision)) throw new Error("Operator approval decision is invalid")
        const decisionScope = requiredText(decisionInput.scope, "Operator approval decision scope", 300)
        const decidedBy = nullableText(decisionInput.decidedBy, "Operator approval decider", 300)
        return this.#mutate((state) => {
            const approval = state.approvals.find((candidate) => candidate.id === approvalId)
            if (!approval) throw new Error("Operator approval not found")
            if (approval.status !== "pending") throw new Error("Operator approval is already resolved")
            const job = state.jobs.find((candidate) => candidate.id === approval.jobId)
            if (!job || job.status !== "waiting_approval") {
                throw new Error("Operator approval Job status must remain waiting_approval")
            }
            if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error("Operator approval has expired")
            approval.status = decisionInput.decision === "approve" ? "approved" : "rejected"
            approval.decision = decisionInput.decision
            approval.decisionScope = decisionScope
            approval.decidedBy = decidedBy
            approval.resolvedAt = nowTimestamp()
            return approval
        })
    }

    appendSessionTranscript(sessionId, input = {}) {
        const kind = requiredText(input.kind, "Operator transcript kind", 300)
        const payload = payloadFrom(
            input,
            new Set(["id", "sessionId", "sequence", "kind", "recordedAt"]),
            "Operator transcript payload",
        )
        return this.#mutate((state) => {
            const session = state.sessions.find((candidate) => candidate.id === sessionId)
            if (!session) throw new Error("Operator session not found")
            if (session.closedAt !== null) throw new Error("Operator session is closed")
            if (session.transcriptSequence >= MAX_SESSION_TRANSCRIPT_ENTRIES) {
                throw new Error("Operator transcript reached its entry limit")
            }
            const now = nowTimestamp()
            const entry = {
                id: randomUUID(),
                sessionId,
                sequence: session.transcriptSequence + 1,
                kind,
                payload,
                recordedAt: now,
            }
            canonicalTranscriptEntry(entry)
            session.transcript.push(entry)
            session.transcriptSequence = entry.sequence
            session.updatedAt = now
            return publicTranscriptEntry(entry)
        })
    }

    getTerminalSnapshot(jobId) {
        const job = this.getJob(jobId)
        if (!TERMINAL_JOB_STATUSES.has(job.status) || job.terminalSnapshot === null) {
            throw new Error("Operator Job has no terminal snapshot")
        }
        return copy(job.terminalSnapshot)
    }

    #recoverInterruptedJobs() {
        const interrupted = this.#state.jobs.filter((job) => job.status === "running" || job.status === "cancelling")
        if (interrupted.length === 0) return
        const now = nowTimestamp()
        for (const job of interrupted) {
            const previousStatus = job.status
            job.status = "needs_recovery"
            job.updatedAt = now
            if (job.eventSequence < MAX_JOB_EVENTS) {
                job.eventSequence += 1
                this.#state.events.push({
                    id: randomUUID(),
                    jobId: job.id,
                    sequence: job.eventSequence,
                    kind: "recovery_required",
                    payload: {previousStatus},
                    occurredAt: now,
                })
            }
        }
        this.persist()
    }
}

module.exports = {
    MAX_ARTIFACT_BYTES,
    MAX_ENVELOPE_BYTES,
    MAX_INLINE_ARTIFACT_BYTES,
    MAX_JOB_EVENTS,
    OPERATOR_JOB_STORE_SCHEMA,
    OperatorJobStore,
}
