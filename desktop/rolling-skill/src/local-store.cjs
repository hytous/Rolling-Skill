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

const {
    UNIFIED_SCORING_MODEL,
    datasetRubricDigest,
    validateDatasetRubric,
} = require("./dataset-rubric.cjs")
const {formatCuratedAnswer, validateCuratorDraft} = require("./episode-curation.cjs")
const {validateSkillEvidence} = require("./evaluation-skill-evidence.cjs")

const LOCAL_SCHEMA = "rolling-skill-local/v11"
const CURATION_STATUSES = new Set([
    "queued",
    "running",
    "needs_review",
    "failed",
    "archived",
    "cancelled",
])
const RUBRIC_STATUSES = new Set([
    "queued",
    "running",
    "needs_review",
    "failed",
    "archived",
    "cancelled",
])
const LANGUAGES = new Set(["zh-CN", "en"])
const THEMES = new Set(["codex-light", "codex-dark", "graphite"])
const LOCAL_ACCESS_POLICIES = new Set(["full", "workspace"])
const AUTO_CAPTURE_MODES = new Set(["off", "scheduled", "automatic"])
const AUTO_CAPTURE_CADENCES = new Set(["daily", "weekly"])
const REASONING_EFFORTS = new Set([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
])
const EVALUATION_RUN_STATUSES = new Set([
    "queued",
    "running",
    "completed",
    "partial",
    "failed",
    "cancelled",
])
const EVALUATION_RESULT_STATUSES = new Set([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
])
const EVALUATION_GRADING_STATUSES = new Set([
    "not_requested",
    "awaiting_execution",
    "queued",
    "running",
    "completed",
    "failed",
    "skipped",
])

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function internalThreadId(value) {
    const normalized = String(value ?? "").trim()
    if (!normalized || normalized.length > 4_096) {
        throw new Error("Internal Runtime task id is invalid")
    }
    return normalized
}

function internalThreadKind(value) {
    const normalized = String(value ?? "internal").trim()
    if (!normalized || normalized.length > 100) {
        throw new Error("Internal Runtime task kind is invalid")
    }
    return normalized
}

function internalThreadRecords(state) {
    const records = new Map()
    const remember = (threadId, kind, recordedAt = null) => {
        if (typeof threadId !== "string" || !threadId.trim()) return
        let id
        try {
            id = internalThreadId(threadId)
        } catch {
            return
        }
        if (records.has(id)) return
        records.set(id, {
            threadId: id,
            kind: internalThreadKind(kind),
            recordedAt: typeof recordedAt === "string" && recordedAt ? recordedAt : null,
        })
    }
    for (const entry of Array.isArray(state.internalThreads) ? state.internalThreads : []) {
        if (typeof entry === "string") remember(entry, "internal")
        else remember(entry?.threadId, entry?.kind, entry?.recordedAt)
    }
    for (const session of state.curationSessions ?? []) {
        remember(
            session?.curator?.threadId,
            "curation",
            session?.updatedAt ?? session?.createdAt,
        )
        if (session?.operation === "refresh") {
            remember(
                session?.episode?.source?.threadId,
                "case-refresh",
                session?.updatedAt ?? session?.createdAt,
            )
        }
    }
    for (const session of state.rubricSessions ?? []) {
        remember(
            session?.rubricAgent?.threadId,
            "rubric",
            session?.updatedAt ?? session?.createdAt,
        )
    }
    for (const run of state.evaluationRuns ?? []) {
        for (const result of run?.results ?? []) {
            remember(
                result?.threadId,
                "evaluation-target",
                result?.completedAt ?? result?.startedAt ?? run?.createdAt,
            )
            remember(
                result?.failureDiagnostics?.threadId,
                "evaluation-target",
                result?.completedAt ?? result?.startedAt ?? run?.createdAt,
            )
            remember(
                result?.judge?.threadId,
                "evaluation-judge",
                result?.gradingCompletedAt ?? result?.gradingStartedAt ?? run?.createdAt,
            )
        }
    }
    return [...records.values()]
}

function originalAssistantMessagesFromEpisode(episode) {
    if (!Array.isArray(episode?.items)) return []
    return episode.items
        .filter((item) => item?.type === "agentMessage" && typeof item.text === "string")
        .map((item) => ({role: "assistant", content: item.text}))
}

function modelId(value, label = "Model id") {
    const normalized = value === null || value === undefined ? null : String(value).trim()
    if (normalized && normalized.length > 200) throw new Error(`${label} is too long`)
    return normalized || null
}

function reasoningEffort(value, label = "Reasoning effort") {
    const normalized = value === null || value === undefined ? null : String(value).trim()
    if (!normalized) return null
    if (!REASONING_EFFORTS.has(normalized)) throw new Error(`${label} is unsupported`)
    return normalized
}

function captureMode(value) {
    const normalized = String(value ?? "").trim()
    if (!AUTO_CAPTURE_MODES.has(normalized)) throw new Error("Automatic capture mode is invalid")
    return normalized
}

function captureCadence(value) {
    const normalized = String(value ?? "").trim()
    if (!AUTO_CAPTURE_CADENCES.has(normalized)) {
        throw new Error("Automatic capture cadence is invalid")
    }
    return normalized
}

function captureTime(value) {
    const normalized = String(value ?? "")
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(normalized)) {
        throw new Error("Automatic capture time is invalid")
    }
    return normalized
}

function captureWeekday(value) {
    const normalized = Number(value)
    if (!Number.isInteger(normalized) || normalized < 0 || normalized > 6) {
        throw new Error("Automatic capture weekday is invalid")
    }
    return normalized
}

function captureTargets(state, value) {
    if (!Array.isArray(value)) throw new Error("Automatic capture candidate Skill routes are invalid")
    if (value.length > 100) throw new Error("Automatic capture candidate Skill routes are too large")
    const skillIds = new Set()
    return value.map((entry) => {
        const skillId = modelId(entry?.skillId, "Automatic capture candidate Skill id")
        const datasetId = modelId(entry?.datasetId, "Automatic capture Dataset id")
        if (!skillId || !datasetId) {
            throw new Error("Automatic capture candidate Skill and Dataset are required")
        }
        if (skillIds.has(skillId)) {
            throw new Error("Automatic capture candidate Skill is duplicated")
        }
        const dataset = requireDataset(state, datasetId)
        if (dataset.skillReference?.id !== skillId) {
            throw new Error("Automatic capture candidate Skill does not match the Dataset binding")
        }
        skillIds.add(skillId)
        return {skillId, datasetId}
    })
}

function removeCaptureTargetDataset(state, datasetId) {
    const automatic = state.settings.autoCaptureProfile
    const current = Array.isArray(automatic.targets) ? automatic.targets : []
    const next = current.filter((target) => target.datasetId !== datasetId)
    if (next.length === current.length) return false
    automatic.targets = next
    automatic.datasetId = next.length === 1 ? next[0].datasetId : null
    if (next.length === 0) {
        automatic.mode = "off"
        state.settings.autoCapture = false
    }
    return true
}

function defaultSettings() {
    return {
        autoCapture: false,
        language: "zh-CN",
        theme: "codex-light",
        localAccess: "full",
        taskProfile: {runtimePolicy: "active", modelId: null, effort: null},
        curatorProfile: {runtimePolicy: "active", modelId: null, effort: null},
        rubricProfile: {runtimePolicy: "active", modelId: null, effort: null},
        judgeProfile: {runtimePolicy: "active", modelId: null, effort: null},
        autoCaptureProfile: {
            runtimePolicy: "active",
            mode: "off",
            schedule: {cadence: "daily", time: "09:00", weekday: 1},
            modelId: null,
            effort: null,
            datasetId: null,
            targets: [],
        },
    }
}

function initialState() {
    const now = new Date().toISOString()
    return {
        schemaVersion: LOCAL_SCHEMA,
        settings: defaultSettings(),
        datasets: [
            {
                id: randomUUID(),
                name: "Skill evaluation cases",
                skillReference: null,
                activeRubricVersionId: null,
                createdAt: now,
            },
        ],
        cases: [],
        curationSessions: [],
        datasetRubricVersions: [],
        rubricSessions: [],
        evaluationRuns: [],
        internalThreads: [],
    }
}

function migrateState(input) {
    const state = copy(input ?? {})
    const sourceSchema = state.schemaVersion
    let changed = state.schemaVersion !== LOCAL_SCHEMA
    state.schemaVersion = LOCAL_SCHEMA
    if (!state.settings || typeof state.settings !== "object") {
        state.settings = defaultSettings()
        changed = true
    }
    if (typeof state.settings.autoCapture !== "boolean") {
        state.settings.autoCapture = false
        changed = true
    }
    if (!LANGUAGES.has(state.settings.language)) {
        state.settings.language = "zh-CN"
        changed = true
    }
    if (!THEMES.has(state.settings.theme)) {
        state.settings.theme = "codex-light"
        changed = true
    }
    if (!LOCAL_ACCESS_POLICIES.has(state.settings.localAccess)) {
        state.settings.localAccess = "full"
        changed = true
    }
    if (!state.settings.taskProfile) {
        state.settings.taskProfile = {runtimePolicy: "active", modelId: null, effort: null}
        changed = true
    }
    if (!state.settings.curatorProfile) {
        state.settings.curatorProfile = {runtimePolicy: "active", modelId: null, effort: null}
        changed = true
    }
    if (!state.settings.rubricProfile) {
        state.settings.rubricProfile = {runtimePolicy: "active", modelId: null, effort: null}
        changed = true
    }
    if (!state.settings.judgeProfile) {
        state.settings.judgeProfile = {runtimePolicy: "active", modelId: null, effort: null}
        changed = true
    }
    const legacyAutoCapture = state.settings.autoCapture === true
    if (!state.settings.autoCaptureProfile || typeof state.settings.autoCaptureProfile !== "object") {
        state.settings.autoCaptureProfile = defaultSettings().autoCaptureProfile
        changed = true
    }
    const automatic = state.settings.autoCaptureProfile
    if (!AUTO_CAPTURE_MODES.has(automatic.mode)) {
        automatic.mode = legacyAutoCapture ? "scheduled" : "off"
        changed = true
    }
    if (!automatic.schedule || typeof automatic.schedule !== "object") {
        automatic.schedule = {cadence: "daily", time: "09:00", weekday: 1}
        changed = true
    }
    if (!AUTO_CAPTURE_CADENCES.has(automatic.schedule.cadence)) {
        automatic.schedule.cadence = "daily"
        changed = true
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(String(automatic.schedule.time ?? ""))) {
        automatic.schedule.time = "09:00"
        changed = true
    }
    if (
        !Number.isInteger(automatic.schedule.weekday) ||
        automatic.schedule.weekday < 0 ||
        automatic.schedule.weekday > 6
    ) {
        automatic.schedule.weekday = 1
        changed = true
    }
    if (automatic.runtimePolicy !== "active") {
        automatic.runtimePolicy = "active"
        changed = true
    }
    for (const field of ["modelId", "effort", "datasetId"]) {
        if (!(field in automatic)) {
            automatic[field] = null
            changed = true
        }
    }
    if (!Array.isArray(automatic.targets)) {
        automatic.targets = []
        changed = true
    }
    if ("caseType" in automatic) {
        delete automatic.caseType
        changed = true
    }
    for (const legacyField of ["skillName", "skillPath"]) {
        if (legacyField in state.settings.autoCaptureProfile) {
            delete state.settings.autoCaptureProfile[legacyField]
            changed = true
        }
    }
    const derivedAutoCapture = automatic.mode !== "off"
    if (state.settings.autoCapture !== derivedAutoCapture) {
        state.settings.autoCapture = derivedAutoCapture
        changed = true
    }
    for (const profile of [
        state.settings.taskProfile,
        state.settings.curatorProfile,
        state.settings.rubricProfile,
        state.settings.judgeProfile,
        state.settings.autoCaptureProfile,
    ]) {
        if (
            !("effort" in profile) ||
            (profile.effort !== null && !REASONING_EFFORTS.has(profile.effort))
        ) {
            profile.effort = null
            changed = true
        }
    }
    if (!Array.isArray(state.datasets)) {
        state.datasets = []
        changed = true
    }
    if (!Array.isArray(state.cases)) {
        state.cases = []
        changed = true
    }
    if (!Array.isArray(state.curationSessions)) {
        state.curationSessions = []
        changed = true
    }
    if (!Array.isArray(state.datasetRubricVersions)) {
        state.datasetRubricVersions = []
        changed = true
    }
    if (!Array.isArray(state.rubricSessions)) {
        state.rubricSessions = []
        changed = true
    }
    if (!Array.isArray(state.evaluationRuns)) {
        state.evaluationRuns = []
        changed = true
    }
    for (const dataset of state.datasets) {
        if (!("skillReference" in dataset)) {
            const candidates = [...state.cases, ...state.curationSessions]
                .filter((entry) => entry.datasetId === dataset.id && entry.skillReference)
                .map((entry) => {
                    try {
                        return normalizeSkillReference(entry.skillReference)
                    } catch {
                        return null
                    }
                })
                .filter(Boolean)
            const identities = new Map()
            for (const reference of candidates) {
                const key = `${reference.name}\u0000${reference.path}`
                const score = Object.values(reference).filter(
                    (value) => value !== null && value !== undefined && value !== "",
                ).length
                const existing = identities.get(key)
                if (!existing || score > existing.score) identities.set(key, {reference, score})
            }
            dataset.skillReference = identities.size === 1
                ? copy([...identities.values()][0].reference)
                : null
            changed = true
        }
        if (!("activeRubricVersionId" in dataset)) {
            dataset.activeRubricVersionId = null
            changed = true
        }
    }
    const hadConfiguredCaptureTargets = Array.isArray(automatic.targets) && automatic.targets.length > 0
    try {
        automatic.targets = captureTargets(state, automatic.targets)
    } catch {
        automatic.targets = []
        if (hadConfiguredCaptureTargets) {
            automatic.mode = "off"
            state.settings.autoCapture = false
        }
        changed = true
    }
    for (const session of state.curationSessions) {
        if (!session.operation) {
            session.operation = "capture"
            changed = true
        }
        if (!("targetCaseId" in session)) {
            session.targetCaseId = null
            changed = true
        }
        if (!("baselineCaseSnapshot" in session)) {
            session.baselineCaseSnapshot = null
            changed = true
        }
        if (!("targetCaseUpdatedAt" in session)) {
            session.targetCaseUpdatedAt = session.baselineCaseSnapshot?.updatedAt ?? null
            changed = true
        }
        if (!("issueDescription" in session)) {
            const legacyQuestion = typeof session.datasetQuestion === "string"
                ? session.datasetQuestion
                : ""
            const originalQuestion = String(session.episode?.originalQuestion ?? "")
            session.issueDescription = legacyQuestion.trim() && legacyQuestion !== originalQuestion
                ? legacyQuestion
                : ""
            changed = true
        }
        if (typeof session.issueDescription !== "string") {
            session.issueDescription = ""
            changed = true
        }
        if ("datasetQuestion" in session) {
            delete session.datasetQuestion
            changed = true
        }
        if (!("skillReference" in session)) {
            session.skillReference = null
            changed = true
        }
        if (!("executionSkillReference" in session)) {
            session.executionSkillReference = null
            changed = true
        }
        if (!("operationEvidence" in session)) {
            session.operationEvidence = null
            changed = true
        }
        if (!("rubricVersionSnapshot" in session)) {
            session.rubricVersionSnapshot = null
            changed = true
        }
        if (session.curator && !("effort" in session.curator)) {
            session.curator.effort = null
            changed = true
        }
        if (session.curator && !("effectiveModelId" in session.curator)) {
            session.curator.effectiveModelId = null
            changed = true
        }
        if (session.curator && !("effectiveEffort" in session.curator)) {
            session.curator.effectiveEffort = null
            changed = true
        }
        if (session.status === "failed" && session.draft) {
            const latestAssistant = [...(session.conversation ?? [])]
                .reverse()
                .find((entry) => entry.role === "assistant")
            const attemptedContract = /```json|schemaVersion|referenceAnswer|hardRequirements|grading/iu.test(
                String(latestAssistant?.text ?? ""),
            )
            session.status = "needs_review"
            session.error = attemptedContract && session.error
                ? `The last Curator response did not replace the valid reference answer: ${session.error}`
                : null
            if (session.curator) session.curator.currentTurnId = null
            changed = true
        }
    }
    for (const session of state.rubricSessions) {
        if (!("executionSkillReference" in session)) {
            session.executionSkillReference = null
            changed = true
        }
        if (!("operationEvidence" in session)) {
            session.operationEvidence = null
            changed = true
        }
    }
    for (const entry of state.cases) {
        if (!entry.source || typeof entry.source !== "object" || Array.isArray(entry.source)) {
            entry.source = {}
            changed = true
        }
        const originalQuestion = String(entry.source?.originalQuestion ?? "")
        if (!("issueDescription" in entry)) {
            entry.issueDescription = originalQuestion && entry.question !== originalQuestion
                ? String(entry.question ?? "")
                : ""
            changed = true
        }
        if (originalQuestion && entry.question !== originalQuestion) {
            entry.question = originalQuestion
            changed = true
        }
        if (!Array.isArray(entry.source.originalAssistantMessages)) {
            const curationSession = state.curationSessions.find(
                (session) =>
                    session.id === entry.source.curationSessionId || session.caseId === entry.id,
            )
            const archivedMessages = originalAssistantMessagesFromEpisode(curationSession?.episode)
            entry.source.originalAssistantMessages = archivedMessages.length
                ? archivedMessages
                : !entry.curated && typeof entry.answer === "string"
                  ? [{role: "assistant", content: entry.answer}]
                  : []
            changed = true
        }
        if (!Array.isArray(entry.calibrationHistory)) {
            entry.calibrationHistory = []
            changed = true
        }
        if (!Array.isArray(entry.refreshHistory)) {
            entry.refreshHistory = []
            changed = true
        }
        if (!("lastRefresh" in entry)) {
            entry.lastRefresh = null
            changed = true
        }
        if (!("updatedAt" in entry)) {
            entry.updatedAt = entry.createdAt ?? new Date().toISOString()
            changed = true
        }
    }
    for (const run of state.evaluationRuns) {
        if (!("judgeProfile" in run)) {
            run.judgeProfile = null
            changed = true
        }
        if (!("judgeConfiguration" in run)) {
            run.judgeConfiguration = null
            changed = true
        }
        if (!("skillEvidence" in run)) {
            run.skillEvidence = null
            changed = true
        }
        if (!("managedVersionSnapshot" in run)) {
            run.managedVersionSnapshot = null
            changed = true
        }
        if (!("rubricVersionSnapshot" in run)) {
            run.rubricVersionSnapshot = null
            changed = true
        }
        for (const result of run.results ?? []) {
            if (!("gradingStatus" in result)) {
                if (result.computedScore || result.judgment) result.gradingStatus = "completed"
                else if (result.status === "failed" || result.status === "cancelled") {
                    result.gradingStatus = "skipped"
                }
                else if (result.status === "queued") result.gradingStatus = "awaiting_execution"
                else result.gradingStatus = "not_requested"
                changed = true
            }
            for (const field of ["scoreContract", "judgment", "computedScore", "judge"]) {
                if (!(field in result)) {
                    result[field] = null
                    changed = true
                }
            }
            if (!("traceEvidence" in result)) {
                result.traceEvidence = null
                changed = true
            }
            for (const field of ["gradingError", "gradingStartedAt", "gradingCompletedAt"]) {
                if (!(field in result)) {
                    result[field] = null
                    changed = true
                }
            }
            if (!("gradingQueuedAt" in result)) {
                result.gradingQueuedAt = null
                changed = true
            }
        }
    }
    const normalizedInternalThreads = internalThreadRecords(state)
    if (JSON.stringify(state.internalThreads ?? []) !== JSON.stringify(normalizedInternalThreads)) {
        state.internalThreads = normalizedInternalThreads
        changed = true
    }
    return {state, changed}
}

function requireDataset(state, datasetId) {
    const dataset = state.datasets.find((entry) => entry.id === datasetId)
    if (!dataset) throw new Error("Unknown dataset")
    return dataset
}

function requireDatasetSkill(dataset) {
    if (!dataset.skillReference) {
        throw new Error("Dataset Skill binding is required")
    }
    return dataset.skillReference
}

function requireCaseType(caseType) {
    if (caseType !== "goodcase" && caseType !== "badcase") {
        throw new Error("Case type must be goodcase or badcase")
    }
}

function requireCase(state, datasetId, caseId) {
    const entry = state.cases.find(
        (candidate) => candidate.datasetId === datasetId && candidate.id === caseId,
    )
    if (!entry) throw new Error("Unknown Case")
    return entry
}

function activeCaseMaintenance(state, datasetId, caseId) {
    return state.curationSessions.find(
        (entry) =>
            entry.datasetId === datasetId &&
            (entry.operation === "calibration" || entry.operation === "refresh") &&
            entry.targetCaseId === caseId &&
            entry.status !== "archived" &&
            entry.status !== "cancelled",
    )
}

function assertCaseDeletable(state, datasetId, caseId) {
    const active = activeCaseMaintenance(state, datasetId, caseId)
    if (active?.operation === "calibration") {
        throw new Error("Discard or finish the active Case calibration before deleting it")
    }
    if (active?.operation === "refresh") {
        throw new Error("Discard or finish the active Case refresh before deleting it")
    }
}

function assertDatasetDeletable(state, datasetReservations, datasetId) {
    if ((datasetReservations.get(datasetId) ?? 0) > 0) {
        throw new Error("Dataset has an unfinished Curator draft or capture in progress")
    }
    const unfinishedCurations = state.curationSessions.some(
        (entry) =>
            entry.datasetId === datasetId &&
            entry.status !== "archived" &&
            entry.status !== "cancelled",
    )
    if (unfinishedCurations) throw new Error("Dataset has unfinished Curator drafts")
    const unfinishedRubrics = state.rubricSessions.some(
        (entry) =>
            entry.datasetId === datasetId &&
            entry.status !== "archived" &&
            entry.status !== "cancelled",
    )
    if (unfinishedRubrics) throw new Error("Dataset has unfinished Rubric Agent sessions")
}

function requireCurationSession(state, id) {
    const session = state.curationSessions.find((entry) => entry.id === id)
    if (!session) throw new Error("Unknown curation session")
    return session
}

function requireRubricSession(state, id) {
    const session = state.rubricSessions.find((entry) => entry.id === id)
    if (!session) throw new Error("Unknown rubric session")
    return session
}

function requireDatasetRubricVersion(state, id) {
    const version = state.datasetRubricVersions.find((entry) => entry.id === id)
    if (!version) throw new Error("Unknown dataset rubric version")
    return version
}

function curationValidationOptions(session) {
    return {
        caseType: session.caseType,
        sourceItemIds: session.episode.items.map((item) => item.id),
        rubricCriteriaIds:
            session.rubricVersionSnapshot?.rubric?.criteria?.map((entry) => entry.id) ?? undefined,
    }
}

function episodeFromCase(entry) {
    const questionId = `case:${entry.id}:question`
    const assistantMessages = Array.isArray(entry.source?.originalAssistantMessages)
        ? entry.source.originalAssistantMessages
        : []
    const answerItems = assistantMessages.map((message, index) => ({
        id: `case:${entry.id}:answer:${index + 1}`,
        type: "agentMessage",
        text: String(message?.content ?? ""),
    })).filter((item) => item.text.trim())
    if (!answerItems.length && typeof entry.answer === "string" && entry.answer.trim()) {
        answerItems.push({
            id: `case:${entry.id}:answer:1`,
            type: "agentMessage",
            text: entry.answer,
        })
    }
    const items = [
        {id: questionId, type: "userMessage", text: entry.question},
        ...answerItems,
    ]
    const endItemId = items.at(-1).id
    return {
        schemaVersion: "rolling-skill-episode/v1",
        originalQuestion: entry.question,
        source: {
            threadId: entry.source?.threadId ?? `case:${entry.id}`,
            cwd: null,
            startTurnId: entry.source?.startTurnId ?? null,
            startItemId: entry.source?.startItemId ?? questionId,
            endTurnId: entry.source?.endTurnId ?? entry.source?.turnId ?? null,
            endItemId: entry.source?.endItemId ?? entry.source?.itemId ?? endItemId,
            runtimeId: entry.source?.runtimeId ?? null,
            modelProvider: entry.source?.modelProvider ?? null,
            modelId: entry.source?.modelId ?? null,
            traceReference: entry.source?.traceReference ?? null,
        },
        items,
        toolActivity: copy(entry.evidence?.toolActivity ?? []),
        capturedAt: entry.createdAt ?? new Date().toISOString(),
    }
}

function dshConversationSource(value) {
    if (
        value?.kind !== "dsh-session" ||
        typeof value.sessionId !== "string" ||
        !value.sessionId.trim() ||
        !Number.isSafeInteger(value.startSeq) ||
        !Number.isSafeInteger(value.endSeq) ||
        value.startSeq < 0 ||
        value.endSeq < value.startSeq ||
        typeof value.endMessageId !== "string" ||
        !value.endMessageId.trim() ||
        !/^sha256:[a-f0-9]{64}$/u.test(String(value.digest ?? ""))
    ) return null
    return {
        kind: "dsh-session",
        sessionId: value.sessionId,
        startSeq: value.startSeq,
        endSeq: value.endSeq,
        endMessageId: value.endMessageId,
        digest: value.digest,
    }
}

function caseCalibrationBaseline(entry) {
    return {
        caseId: entry.id,
        caseType: entry.caseType,
        question: entry.question,
        issueDescription: entry.issueDescription ?? "",
        answer: entry.answer,
        curated: entry.curated ? copy(entry.curated) : null,
        rubricVersionId: entry.rubricVersionId ?? null,
        rubricCalibration: copy(entry.rubricCalibration ?? null),
        sourceCurationSessionId: entry.source?.curationSessionId ?? null,
        sourceCurationRevisionId: entry.source?.curationRevisionId ?? null,
    }
}

function caseRefreshBaseline(entry) {
    return copy({
        id: entry.id,
        updatedAt: entry.updatedAt,
        question: entry.question,
        answer: entry.answer,
        curated: entry.curated ?? null,
        issueDescription: entry.issueDescription ?? "",
        skillReference: entry.skillReference ?? null,
        rubricVersionId: entry.rubricVersionId ?? null,
        rubricCalibration: entry.rubricCalibration ?? null,
        source: entry.source ?? null,
        evidence: entry.evidence ?? null,
    })
}

function newCurationSession({dataset, input, episode, operation = "capture", targetCaseId = null, baselineCaseSnapshot = null}) {
    requireCaseType(input.caseType)
    const skillReference = copy(requireDatasetSkill(dataset))
    const executionSkillReference = input.executionSkillReference
        ? normalizeSkillReference(input.executionSkillReference)
        : null
    const operationEvidence = input.operationEvidence
        ? structuredObject(input.operationEvidence, "Curation operation evidence")
        : null
    if (executionSkillReference && skillReference.evidencePrecision === "managed") {
        if (
            executionSkillReference.id !== skillReference.id ||
            executionSkillReference.repositoryId !== skillReference.repositoryId ||
            executionSkillReference.name !== skillReference.name ||
            !executionSkillReference.path ||
            !executionSkillReference.runtimeId ||
            !executionSkillReference.providerId
        ) {
            throw new Error("Curation execution Skill does not match the Dataset managed Skill")
        }
        if (
            operationEvidence?.schemaVersion !== "rolling-skill-operation-evidence/v1" ||
            operationEvidence.kind !== "curation" ||
            operationEvidence.repositoryId !== skillReference.repositoryId ||
            operationEvidence.skillId !== skillReference.id ||
            operationEvidence.runtime?.runtimeId !== executionSkillReference.runtimeId ||
            operationEvidence.runtime?.providerId !== executionSkillReference.providerId ||
            operationEvidence.installation?.destination !== executionSkillReference.path.replace(/\/SKILL\.md$/iu, "")
        ) {
            throw new Error("Curation operation evidence does not match its execution Skill")
        }
    }
    const rubricVersionSnapshot = dataset.activeRubricVersionId
        ? copy(input.rubricVersionSnapshot)
        : null
    const frozenEpisode = copy(episode)
    if (frozenEpisode?.schemaVersion !== "rolling-skill-episode/v1") {
        throw new Error("A valid frozen episode is required")
    }
    if (typeof frozenEpisode.originalQuestion !== "string" || !frozenEpisode.originalQuestion.trim()) {
        throw new Error("The episode must contain the original question")
    }
    const rawIssueDescription = String(input.issueDescription ?? "")
    if (rawIssueDescription.length > 120_000) {
        throw new Error("The issue description is too large")
    }
    const issueDescription = rawIssueDescription.trim() ? rawIssueDescription : ""
    if (JSON.stringify(frozenEpisode).length > 1_500_000) {
        throw new Error("The selected episode is too large to curate locally")
    }
    const now = new Date().toISOString()
    return {
        id: randomUUID(),
        idempotencyKey: modelId(input.idempotencyKey, "Curation idempotency key"),
        automaticCaptureRawCaseId: modelId(input.automaticCaptureRawCaseId, "Automatic capture Raw Case id"),
        datasetId: dataset.id,
        operation,
        targetCaseId,
        baselineCaseSnapshot: baselineCaseSnapshot ? copy(baselineCaseSnapshot) : null,
        caseType: input.caseType,
        issueDescription,
        status: "queued",
        episode: frozenEpisode,
        skillReference,
        executionSkillReference,
        operationEvidence,
        rubricVersionSnapshot,
        curator: {
            runtimeId: input.curator?.runtimeId ?? null,
            modelProvider: input.curator?.modelProvider ?? null,
            modelId: input.curator?.modelId ?? null,
            effort: reasoningEffort(input.curator?.effort, "Curator reasoning effort"),
            effectiveModelId: input.curator?.effectiveModelId ?? null,
            effectiveEffort: reasoningEffort(
                input.curator?.effectiveEffort,
                "Effective Curator reasoning effort",
            ),
            promptVersion: input.curator?.promptVersion ?? null,
            threadId: null,
            currentTurnId: null,
        },
        conversation: [],
        revisions: [],
        draft: null,
        error: null,
        caseId: null,
        createdAt: now,
        updatedAt: now,
    }
}

function skillIdentity(value, label) {
    const normalized = value === null || value === undefined ? null : String(value).trim()
    if (normalized && normalized.length > 4_096) throw new Error(`${label} is too long`)
    return normalized || null
}

function structuredObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    const normalized = copy(value)
    if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) {
        throw new Error(`${label} must be an object`)
    }
    return normalized
}

function evaluationRuntimeConfiguration(configuration, labels = {}) {
    const runtimeId = modelId(configuration?.runtimeId, labels.runtimeId ?? "Runtime id")
    const providerId = modelId(
        configuration?.providerId,
        labels.providerId ?? "Runtime provider id",
    )
    const executablePath = skillIdentity(
        configuration?.executablePath,
        labels.executablePath ?? "Runtime executable path",
    )
    if (!runtimeId || !providerId || !executablePath?.startsWith("/")) {
        throw new Error("Every evaluation runtime requires an id, provider, and executable")
    }
    return {
        runtimeId,
        providerId,
        displayName: modelId(configuration.displayName, labels.displayName ?? "Runtime name") ?? providerId,
        version: modelId(configuration.version, labels.version ?? "Runtime version"),
        executablePath,
        source: modelId(configuration.source, labels.source ?? "Runtime source"),
        transport: modelId(configuration.transport, labels.transport ?? "Runtime transport"),
        capabilities: copy(configuration.capabilities ?? []),
        models: copy(configuration.models ?? []),
        efforts: copy(configuration.efforts ?? []),
        modelId: modelId(configuration.modelId, labels.modelId ?? "Evaluation model id"),
        effort: reasoningEffort(configuration.effort, labels.effort ?? "Evaluation reasoning effort"),
    }
}

function managedEvaluationVersionSnapshot(value, runtimeIds) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("A managed Candidate snapshot is required")
    }
    const expectedKeys = [
        "commit",
        "contentDigest",
        "installationJobIdsByRuntime",
        "repositoryId",
        "skillId",
        "skillRoot",
        "versionId",
    ]
    if (Object.keys(value).sort().join(",") !== expectedKeys.sort().join(",")) {
        throw new Error("Managed Candidate snapshot contains unsupported fields")
    }
    const required = (field, label, maxLength = 200) => {
        const normalized = String(value[field] ?? "").trim()
        if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
        return normalized
    }
    const commit = required("commit", "Managed Candidate commit", 40)
    const contentDigest = required("contentDigest", "Managed Candidate content digest", 80)
    const skillRoot = required("skillRoot", "Managed Candidate Skill root", 4_096).replace(/\\/gu, "/")
    if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Managed Candidate commit must be a full SHA-1")
    if (!/^sha256:[a-f0-9]{64}$/u.test(contentDigest)) {
        throw new Error("Managed Candidate content digest must be SHA-256")
    }
    if (
        skillRoot.startsWith("/") ||
        (skillRoot !== "." && skillRoot.split("/").some((part) => !part || part === "." || part === ".."))
    ) {
        throw new Error("Managed Candidate Skill root must be repository-relative")
    }
    const jobs = value.installationJobIdsByRuntime
    if (!jobs || typeof jobs !== "object" || Array.isArray(jobs)) {
        throw new Error("Managed Candidate installation Jobs are required")
    }
    const installationJobIdsByRuntime = {}
    for (const runtimeId of runtimeIds) {
        const jobId = String(jobs[runtimeId] ?? "").trim()
        if (!jobId || jobId.length > 200) {
            throw new Error(`Managed Candidate installation Job is required for ${runtimeId}`)
        }
        installationJobIdsByRuntime[runtimeId] = jobId
    }
    if (Object.keys(jobs).some((runtimeId) => !runtimeIds.includes(runtimeId))) {
        throw new Error("Managed Candidate installation Jobs contain an unknown Runtime")
    }
    return {
        repositoryId: required("repositoryId", "Managed Candidate repository id"),
        skillId: required("skillId", "Managed Candidate Skill id"),
        versionId: required("versionId", "Managed Candidate version id"),
        commit,
        skillRoot,
        contentDigest,
        installationJobIdsByRuntime,
    }
}

function managedRuntimeConfigurationBinding({
    input,
    configuration,
    datasetSkillReference,
    managedVersionSnapshot,
    optimizationAuthorized,
}) {
    let skillReference = normalizeSkillReference(input.skillReference)
    if (!skillReference && optimizationAuthorized && datasetSkillReference.path) {
        skillReference = normalizeSkillReference({
            ...datasetSkillReference,
            runtimeId: configuration.runtimeId,
            providerId: configuration.providerId,
        })
    }
    if (
        !skillReference ||
        !skillReference.path ||
        skillReference.evidencePrecision === "managed" ||
        skillReference.evidencePrecision === "name-only"
    ) {
        throw new Error("Managed evaluation requires a path-precise Runtime Skill binding")
    }
    if (
        skillReference.name !== datasetSkillReference.name ||
        skillReference.runtimeId !== configuration.runtimeId ||
        skillReference.providerId !== configuration.providerId
    ) {
        throw new Error("Managed evaluation Runtime Skill binding conflicts with its target")
    }
    if (
        datasetSkillReference.evidencePrecision === "managed" &&
        (skillReference.repositoryId !== datasetSkillReference.repositoryId ||
            skillReference.id !== datasetSkillReference.id)
    ) {
        throw new Error("Managed evaluation Runtime Skill binding conflicts with the Dataset Skill")
    }
    const installationJobId = skillIdentity(
        input.installationJobId ??
            input.experimentInstallationJobId ??
            managedVersionSnapshot.installationJobIdsByRuntime[configuration.runtimeId],
        "Managed installation Job id",
    )
    const installationId = skillIdentity(input.installationId, "Managed installation id")
    const installationVerification = skillIdentity(
        input.installationVerification,
        "Managed installation verification",
    )
    if (!installationJobId) {
        throw new Error("Managed evaluation requires a frozen installation Job")
    }
    if (
        !optimizationAuthorized &&
        (!installationId || !installationVerification || installationVerification === "none")
    ) {
        throw new Error("Managed evaluation requires a verified normal installation")
    }
    if (
        input.expectedContentDigest &&
        input.expectedContentDigest !== managedVersionSnapshot.contentDigest
    ) {
        throw new Error("Managed evaluation Runtime digest conflicts with the frozen version")
    }
    return {
        ...configuration,
        skillReference,
        installationId,
        installationJobId,
        installationVerification,
        expectedContentDigest: managedVersionSnapshot.contentDigest,
        ...(optimizationAuthorized ? {experimentInstallationJobId: installationJobId} : {}),
    }
}

function normalizeSkillReference(value) {
    if (value === null || value === undefined) return null
    if (value.schemaVersion !== "rolling-skill-skill-reference/v1") {
        throw new Error("A valid runtime Skill reference is required")
    }
    const name = skillIdentity(value.name, "Skill name")
    const path = skillIdentity(value.path, "Skill path")
    const evidencePrecision = skillIdentity(value.evidencePrecision, "Skill evidence precision")
    const id = skillIdentity(value.id, "Skill id")
    const repositoryId = skillIdentity(value.repositoryId, "Skill repository id")
    if (!name) {
        throw new Error("A valid runtime Skill name is required")
    }
    if (evidencePrecision === "managed") {
        const providerId = skillIdentity(value.providerId, "Skill provider id")
        const runtimeId = skillIdentity(value.runtimeId, "Skill runtime id")
        const workspaceRoot = skillIdentity(value.workspaceRoot, "Skill workspace root")
        if (!id || !repositoryId) {
            throw new Error("A complete managed Skill identity is required")
        }
        if (path || providerId || runtimeId || workspaceRoot) {
            throw new Error("Managed Skill identity cannot include deployment fields")
        }
        return {
            schemaVersion: value.schemaVersion,
            evidencePrecision,
            id,
            repositoryId,
            name,
            path: null,
            scope: skillIdentity(value.scope, "Skill scope"),
            description: skillIdentity(value.description, "Skill description"),
            runtimeId: null,
            providerId: null,
            confirmedAt: skillIdentity(value.confirmedAt, "Skill confirmation time"),
        }
    }
    if (evidencePrecision === "name-only") {
        const providerId = skillIdentity(value.providerId, "Skill provider id")
        const runtimeId = skillIdentity(value.runtimeId, "Skill runtime id")
        const workspaceRoot = skillIdentity(value.workspaceRoot, "Skill workspace root")
        if (path || !providerId || !runtimeId || !workspaceRoot?.startsWith("/")) {
            throw new Error("A complete name-only Runtime Skill identity is required")
        }
        return {
            schemaVersion: value.schemaVersion,
            ...(id ? {id} : {}),
            name,
            path: null,
            scope: skillIdentity(value.scope, "Skill scope"),
            description: skillIdentity(value.description, "Skill description"),
            runtimeId,
            providerId,
            ...(repositoryId ? {repositoryId} : {}),
            workspaceRoot,
            evidencePrecision,
            confirmedAt: skillIdentity(value.confirmedAt, "Skill confirmation time"),
        }
    }
    if (!path || !path.startsWith("/")) {
        throw new Error("A valid runtime Skill name and absolute path are required")
    }
    const providerId = skillIdentity(value.providerId, "Skill provider id")
    const runtimeId = skillIdentity(value.runtimeId, "Skill runtime id")
    if (repositoryId && (!id || !providerId || !runtimeId)) {
        throw new Error("A complete managed Skill identity is required")
    }
    return {
        schemaVersion: value.schemaVersion,
        ...(id ? {id} : {}),
        name,
        path,
        scope: skillIdentity(value.scope, "Skill scope"),
        description: skillIdentity(value.description, "Skill description"),
        runtimeId,
        ...(providerId ? {providerId} : {}),
        ...(repositoryId ? {repositoryId} : {}),
        confirmedAt: skillIdentity(value.confirmedAt, "Skill confirmation time"),
    }
}

function sameSkillReferenceIdentity(left, right) {
    if (!left || !right) return false
    const managed =
        left.evidencePrecision === "managed" || right.evidencePrecision === "managed"
    if (managed) {
        return (
            left.evidencePrecision === "managed" &&
            right.evidencePrecision === "managed" &&
            left.repositoryId === right.repositoryId &&
            left.id === right.id
        )
    }
    if (left.name !== right.name) return false
    const nameOnly =
        left.evidencePrecision === "name-only" || right.evidencePrecision === "name-only"
    if (nameOnly) {
        return (
            left.evidencePrecision === "name-only" &&
            right.evidencePrecision === "name-only" &&
            left.providerId === right.providerId &&
            left.runtimeId === right.runtimeId &&
            left.workspaceRoot === right.workspaceRoot
        )
    }
    return left.path === right.path && left.runtimeId === right.runtimeId
}

class LocalEvaluationStore {
    constructor(path) {
        this.path = path
        this.state = null
        this.datasetReservations = new Map()
    }

    load() {
        if (this.state) return this.state
        if (existsSync(this.path)) {
            const migrated = migrateState(JSON.parse(readFileSync(this.path, "utf8")))
            this.state = migrated.state
            if (migrated.changed) this.persist()
        } else {
            this.state = initialState()
            this.persist()
        }
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

    listInternalThreadIds(kind = null) {
        const normalizedKind = kind === null ? null : internalThreadKind(kind)
        return this.load().internalThreads
            .filter((entry) => normalizedKind === null || entry.kind === normalizedKind)
            .map((entry) => entry.threadId)
    }

    recordInternalThread(threadId, kind = "internal") {
        const state = this.load()
        const id = internalThreadId(threadId)
        const normalizedKind = internalThreadKind(kind)
        const existing = state.internalThreads.find((entry) => entry.threadId === id)
        if (existing) return copy(existing)
        const record = {
            threadId: id,
            kind: normalizedKind,
            recordedAt: new Date().toISOString(),
        }
        state.internalThreads.push(record)
        this.persist()
        return copy(record)
    }

    listDatasets() {
        const state = this.load()
        return state.datasets.map((dataset) => {
            const cases = state.cases.filter((entry) => entry.datasetId === dataset.id)
            return {
                ...copy(dataset),
                caseCount: cases.length,
                goodcaseCount: cases.filter((entry) => entry.caseType === "goodcase").length,
                badcaseCount: cases.filter((entry) => entry.caseType === "badcase").length,
            }
        })
    }

    getDataset(datasetId) {
        return copy(requireDataset(this.load(), datasetId))
    }

    createDataset(input = {}) {
        const trimmed = String(input?.name ?? "").trim()
        if (!trimmed) throw new Error("Dataset name is required")
        const skillReference = normalizeSkillReference(input.skillReference)
        if (!skillReference) throw new Error("Dataset Skill binding is required")
        const state = this.load()
        const dataset = {
            id: randomUUID(),
            name: trimmed,
            skillReference,
            activeRubricVersionId: null,
            createdAt: new Date().toISOString(),
        }
        state.datasets.push(dataset)
        this.persist()
        return copy(dataset)
    }

    cloneDataset(input = {}) {
        const name = String(input?.name ?? "").trim()
        if (!name) throw new Error("Dataset name is required")
        const sourceDatasetId = String(input?.sourceDatasetId ?? "").trim()
        if (!sourceDatasetId) throw new Error("Source Dataset is required")
        if (!Array.isArray(input.caseIds) || input.caseIds.length === 0) {
            throw new Error("At least one source Case is required")
        }
        if (input.caseIds.length > 100) {
            throw new Error("Dataset clone cannot include more than 100 source Cases")
        }
        const caseIds = input.caseIds.map((value) => String(value ?? "").trim())
        if (caseIds.some((value) => !value)) throw new Error("Source Case id is required")
        if (new Set(caseIds).size !== caseIds.length) {
            throw new Error("Source Case selection contains duplicate ids")
        }

        const state = this.load()
        const sourceDataset = requireDataset(state, sourceDatasetId)
        const sourceCases = caseIds.map((caseId) => {
            const entry = state.cases.find((candidate) => candidate.id === caseId)
            if (!entry || entry.datasetId !== sourceDataset.id) {
                throw new Error("Selected Case does not belong to the source Dataset")
            }
            return entry
        })
        const sourceRubric = sourceDataset.activeRubricVersionId
            ? requireDatasetRubricVersion(state, sourceDataset.activeRubricVersionId)
            : null
        if (sourceRubric && sourceRubric.datasetId !== sourceDataset.id) {
            throw new Error("Source Dataset active rubric does not belong to the Dataset")
        }

        const now = new Date().toISOString()
        const dataset = {
            id: randomUUID(),
            name,
            skillReference: copy(requireDatasetSkill(sourceDataset)),
            activeRubricVersionId: null,
            createdAt: now,
        }
        const rubricVersion = sourceRubric
            ? {
                ...copy(sourceRubric),
                id: randomUUID(),
                datasetId: dataset.id,
                version: 1,
                skillReference: copy(dataset.skillReference),
                sourceSessionId: null,
                baseVersionId: null,
                createdAt: now,
                publishedAt: now,
            }
            : null
        if (rubricVersion) dataset.activeRubricVersionId = rubricVersion.id
        const cases = sourceCases.map((source) => {
            const currentRubric = Boolean(
                rubricVersion &&
                source.rubricVersionId === sourceRubric.id &&
                source.rubricCalibration?.status === "current",
            )
            return {
                ...copy(source),
                id: randomUUID(),
                datasetId: dataset.id,
                ...(rubricVersion
                    ? {
                        rubricVersionId: currentRubric ? rubricVersion.id : null,
                        rubricCalibration: currentRubric
                            ? {
                                status: "current",
                                rubricVersionId: rubricVersion.id,
                                previousRubricVersionId: null,
                            }
                            : {
                                status: "needed",
                                rubricVersionId: rubricVersion.id,
                                previousRubricVersionId: null,
                            },
                    }
                    : {rubricVersionId: null, rubricCalibration: null}),
                createdAt: now,
                updatedAt: now,
            }
        })

        state.datasets.push(dataset)
        if (rubricVersion) state.datasetRubricVersions.push(rubricVersion)
        state.cases.push(...cases)
        this.persist()
        return copy({dataset, cases, rubricVersion})
    }

    bindDatasetSkill(datasetId, value) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        const skillReference = normalizeSkillReference(value)
        if (!skillReference) throw new Error("Dataset Skill binding is required")
        const current = dataset.skillReference
        if (sameSkillReferenceIdentity(current, skillReference)) {
            dataset.skillReference = skillReference
            this.persist()
            return copy(dataset)
        }
        if ((this.datasetReservations.get(datasetId) ?? 0) > 0) {
            throw new Error("Dataset Skill cannot change while capture is in progress")
        }
        const unfinished = state.curationSessions.some(
            (entry) =>
                entry.datasetId === datasetId &&
                entry.status !== "archived" &&
                entry.status !== "cancelled",
        )
        if (unfinished) throw new Error("Dataset Skill cannot change with unfinished Curator drafts")
        const unfinishedRubric = state.rubricSessions.some(
            (entry) =>
                entry.datasetId === datasetId &&
                entry.status !== "archived" &&
                entry.status !== "cancelled",
        )
        if (unfinishedRubric) {
            throw new Error("Dataset Skill cannot change with an unfinished Rubric Agent session")
        }
        removeCaptureTargetDataset(state, datasetId)
        dataset.skillReference = skillReference
        dataset.activeRubricVersionId = null
        this.persist()
        return copy(dataset)
    }

    migrateDatasetSkillReference(datasetId, input = {}) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        const expectedLegacyReference = normalizeSkillReference(input.expectedLegacyReference)
        const managedSkillReference = normalizeSkillReference(input.managedSkillReference)
        if (
            !expectedLegacyReference ||
            expectedLegacyReference.evidencePrecision === "managed"
        ) {
            throw new Error("A legacy Runtime Skill binding is required for migration")
        }
        if (!managedSkillReference || managedSkillReference.evidencePrecision !== "managed") {
            throw new Error("A complete managed Skill identity is required for migration")
        }
        if (
            !dataset.skillReference ||
            dataset.skillReference.evidencePrecision === "managed" ||
            !sameSkillReferenceIdentity(dataset.skillReference, expectedLegacyReference)
        ) {
            throw new Error("Legacy Dataset Skill binding changed before migration")
        }
        dataset.skillReference = managedSkillReference
        this.persist()
        return copy(dataset)
    }

    reserveDataset(datasetId) {
        requireDataset(this.load(), datasetId)
        this.datasetReservations.set(
            datasetId,
            (this.datasetReservations.get(datasetId) ?? 0) + 1,
        )
        let released = false
        return () => {
            if (released) return
            released = true
            const remaining = (this.datasetReservations.get(datasetId) ?? 1) - 1
            if (remaining > 0) this.datasetReservations.set(datasetId, remaining)
            else this.datasetReservations.delete(datasetId)
        }
    }

    deleteDataset(datasetId) {
        const state = this.load()
        requireDataset(state, datasetId)
        assertDatasetDeletable(state, this.datasetReservations, datasetId)

        const dataset = state.datasets.find((entry) => entry.id === datasetId)
        const deletedCaseCount = state.cases.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const deletedCurationCount = state.curationSessions.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const deletedRubricSessionCount = state.rubricSessions.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const deletedRubricVersionCount = state.datasetRubricVersions.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const preservedEvaluationRunCount = state.evaluationRuns.filter(
            (entry) => entry.datasetId === datasetId,
        ).length

        removeCaptureTargetDataset(state, datasetId)

        state.datasets = state.datasets.filter((entry) => entry.id !== datasetId)
        state.cases = state.cases.filter((entry) => entry.datasetId !== datasetId)
        state.curationSessions = state.curationSessions.filter(
            (entry) => entry.datasetId !== datasetId,
        )
        state.rubricSessions = state.rubricSessions.filter(
            (entry) => entry.datasetId !== datasetId,
        )
        state.datasetRubricVersions = state.datasetRubricVersions.filter(
            (entry) => entry.datasetId !== datasetId,
        )

        const automatic = state.settings.autoCaptureProfile
        if (automatic.datasetId === datasetId) {
            automatic.datasetId = null
            automatic.mode = "off"
            state.settings.autoCapture = false
        }

        this.persist()
        return copy({
            dataset,
            deletedCaseCount,
            deletedCurationCount,
            deletedRubricSessionCount,
            deletedRubricVersionCount,
            preservedEvaluationRunCount,
            settings: state.settings,
        })
    }

    prepareDatasetDeletion(datasetId) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        assertDatasetDeletable(state, this.datasetReservations, datasetId)
        return copy({
            dataset,
            cases: state.cases.filter((entry) => entry.datasetId === datasetId),
        })
    }

    listCases(datasetId) {
        const state = this.load()
        requireDataset(state, datasetId)
        return copy(
            state.cases
                .filter((entry) => entry.datasetId === datasetId)
                .sort((left, right) =>
                    String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")),
                ),
        )
    }

    updateCuratorProfile(input = {}) {
        const state = this.load()
        const normalizedModelId = modelId(input.modelId, "Curator model id")
        state.settings.curatorProfile = {
            runtimePolicy: "active",
            modelId: normalizedModelId,
            effort: reasoningEffort(input.effort, "Curator reasoning effort"),
        }
        this.persist()
        return copy(state.settings.curatorProfile)
    }

    updateSettings(input = {}) {
        const state = this.load()
        const settings = state.settings
        if (input.language !== undefined) {
            if (!LANGUAGES.has(input.language)) throw new Error("Unsupported interface language")
            settings.language = input.language
        }
        if (input.theme !== undefined) {
            if (!THEMES.has(input.theme)) throw new Error("Unsupported interface theme")
            settings.theme = input.theme
        }
        if (input.localAccess !== undefined) {
            if (!LOCAL_ACCESS_POLICIES.has(input.localAccess)) {
                throw new Error("Unsupported local access policy")
            }
            settings.localAccess = input.localAccess
        }
        if (input.taskModelId !== undefined) {
            settings.taskProfile = {
                ...settings.taskProfile,
                runtimePolicy: "active",
                modelId: modelId(input.taskModelId, "Task model id"),
            }
        }
        if (input.taskEffort !== undefined) {
            settings.taskProfile.effort = reasoningEffort(input.taskEffort, "Task reasoning effort")
        }
        if (input.curatorModelId !== undefined) {
            settings.curatorProfile = {
                ...settings.curatorProfile,
                runtimePolicy: "active",
                modelId: modelId(input.curatorModelId, "Curator model id"),
            }
        }
        if (input.curatorEffort !== undefined) {
            settings.curatorProfile.effort = reasoningEffort(
                input.curatorEffort,
                "Curator reasoning effort",
            )
        }
        if (input.rubricModelId !== undefined) {
            settings.rubricProfile = {
                ...settings.rubricProfile,
                runtimePolicy: "active",
                modelId: modelId(input.rubricModelId, "Rubric Agent model id"),
            }
        }
        if (input.rubricEffort !== undefined) {
            settings.rubricProfile.effort = reasoningEffort(
                input.rubricEffort,
                "Rubric Agent reasoning effort",
            )
        }
        if (input.judgeModelId !== undefined) {
            settings.judgeProfile = {
                ...settings.judgeProfile,
                runtimePolicy: "active",
                modelId: modelId(input.judgeModelId, "Judge model id"),
            }
        }
        if (input.judgeEffort !== undefined) {
            settings.judgeProfile.effort = reasoningEffort(
                input.judgeEffort,
                "Judge reasoning effort",
            )
        }
        const automatic = {...settings.autoCaptureProfile, runtimePolicy: "active"}
        automatic.schedule = {...settings.autoCaptureProfile.schedule}
        if (input.autoCaptureMode !== undefined) {
            automatic.mode = captureMode(input.autoCaptureMode)
        } else if (input.autoCapture !== undefined) {
            automatic.mode = Boolean(input.autoCapture)
                ? automatic.mode === "off" ? "scheduled" : automatic.mode
                : "off"
        }
        if (input.autoCaptureCadence !== undefined) {
            automatic.schedule.cadence = captureCadence(input.autoCaptureCadence)
        }
        if (input.autoCaptureTime !== undefined) {
            automatic.schedule.time = captureTime(input.autoCaptureTime)
        }
        if (input.autoCaptureWeekday !== undefined) {
            automatic.schedule.weekday = captureWeekday(input.autoCaptureWeekday)
        }
        if (input.autoCaptureModelId !== undefined) {
            automatic.modelId = modelId(input.autoCaptureModelId, "Automatic capture model id")
        }
        if (input.autoCaptureEffort !== undefined) {
            automatic.effort = reasoningEffort(
                input.autoCaptureEffort,
                "Automatic capture reasoning effort",
            )
        }
        if (input.autoCaptureDatasetId !== undefined) {
            const datasetId = modelId(input.autoCaptureDatasetId, "Automatic capture dataset id")
            if (datasetId) requireDataset(state, datasetId)
            automatic.datasetId = datasetId
        }
        if (input.autoCaptureTargets !== undefined) {
            automatic.targets = captureTargets(state, input.autoCaptureTargets)
            automatic.datasetId = automatic.targets.length === 1
                ? automatic.targets[0].datasetId
                : null
        }
        settings.autoCaptureProfile = automatic
        settings.autoCapture = automatic.mode !== "off"
        this.persist()
        return copy(settings)
    }

    listDatasetRubricVersions(datasetId) {
        const state = this.load()
        requireDataset(state, datasetId)
        return copy(
            state.datasetRubricVersions
                .filter((entry) => entry.datasetId === datasetId)
                .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0)),
        )
    }

    getDatasetRubricVersion(id) {
        return copy(requireDatasetRubricVersion(this.load(), id))
    }

    getActiveDatasetRubric(datasetId) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        if (!dataset.activeRubricVersionId) return null
        const version = requireDatasetRubricVersion(state, dataset.activeRubricVersionId)
        if (version.datasetId !== datasetId) {
            throw new Error("Dataset active rubric does not belong to the dataset")
        }
        return copy(version)
    }

    listRubricSessions(datasetId = null) {
        const state = this.load()
        if (datasetId) requireDataset(state, datasetId)
        return copy(
            state.rubricSessions
                .filter((entry) => !datasetId || entry.datasetId === datasetId)
                .filter((entry) => entry.status !== "cancelled" && entry.status !== "archived")
                .sort((left, right) =>
                    String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
                ),
        )
    }

    getRubricSession(id) {
        return copy(requireRubricSession(this.load(), id))
    }

    createRubricSession(input = {}) {
        const state = this.load()
        const dataset = requireDataset(state, input.datasetId)
        const skillReference = copy(requireDatasetSkill(dataset))
        const executionSkillReference = input.executionSkillReference
            ? normalizeSkillReference(input.executionSkillReference)
            : null
        const operationEvidence = input.operationEvidence
            ? structuredObject(input.operationEvidence, "Rubric operation evidence")
            : null
        if (executionSkillReference && skillReference.evidencePrecision === "managed") {
            if (
                executionSkillReference.id !== skillReference.id ||
                executionSkillReference.repositoryId !== skillReference.repositoryId ||
                executionSkillReference.name !== skillReference.name ||
                !executionSkillReference.path ||
                !executionSkillReference.runtimeId ||
                !executionSkillReference.providerId
            ) {
                throw new Error("Rubric execution Skill does not match the Dataset managed Skill")
            }
            if (
                operationEvidence?.schemaVersion !== "rolling-skill-operation-evidence/v1" ||
                operationEvidence.kind !== "rubric" ||
                operationEvidence.repositoryId !== skillReference.repositoryId ||
                operationEvidence.skillId !== skillReference.id ||
                operationEvidence.runtime?.runtimeId !== executionSkillReference.runtimeId ||
                operationEvidence.runtime?.providerId !== executionSkillReference.providerId ||
                operationEvidence.installation?.destination !== executionSkillReference.path.replace(/\/SKILL\.md$/iu, "")
            ) {
                throw new Error("Rubric operation evidence does not match its execution Skill")
            }
        }
        const skillEvidence = copy(validateSkillEvidence(input.skillEvidence, {
            expectedName: skillReference.name,
            requireComplete: true,
        }))
        let baseVersionId = null
        if (input.baseVersionId) {
            const base = requireDatasetRubricVersion(state, input.baseVersionId)
            if (base.datasetId !== dataset.id) {
                throw new Error("Rubric base version does not belong to the dataset")
            }
            baseVersionId = base.id
        }
        const now = new Date().toISOString()
        const session = {
            id: randomUUID(),
            datasetId: dataset.id,
            baseVersionId,
            status: "queued",
            skillReference,
            executionSkillReference,
            operationEvidence,
            skillEvidence,
            rubricAgent: {
                runtimeId: input.rubricAgent?.runtimeId ?? null,
                modelProvider: input.rubricAgent?.modelProvider ?? null,
                modelId: modelId(input.rubricAgent?.modelId, "Rubric Agent model id"),
                effort: reasoningEffort(
                    input.rubricAgent?.effort,
                    "Rubric Agent reasoning effort",
                ),
                effectiveModelId: modelId(
                    input.rubricAgent?.effectiveModelId,
                    "Effective Rubric Agent model id",
                ),
                effectiveEffort: reasoningEffort(
                    input.rubricAgent?.effectiveEffort,
                    "Effective Rubric Agent reasoning effort",
                ),
                promptVersion: input.rubricAgent?.promptVersion ?? null,
                threadId: null,
                currentTurnId: null,
            },
            conversation: [],
            revisions: [],
            draft: null,
            error: null,
            publishedVersionId: null,
            createdAt: now,
            updatedAt: now,
        }
        state.rubricSessions.push(session)
        this.persist()
        return copy(session)
    }

    updateRubricSession(id, patch = {}) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (patch.status !== undefined) {
            if (!RUBRIC_STATUSES.has(patch.status)) throw new Error("Invalid rubric status")
            session.status = patch.status
        }
        if (patch.rubricAgent !== undefined) {
            session.rubricAgent = {...session.rubricAgent, ...copy(patch.rubricAgent)}
        }
        if (patch.error !== undefined) session.error = patch.error ? String(patch.error) : null
        if (patch.draft !== undefined) {
            session.draft = patch.draft ? copy(validateDatasetRubric(patch.draft)) : null
        }
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    appendRubricMessage(id, input = {}) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (input.role !== "user" && input.role !== "assistant") {
            throw new Error("Rubric message role must be user or assistant")
        }
        const message = String(input.text ?? "").trim()
        if (!message) throw new Error("Rubric message text is required")
        if (message.length > 120_000) throw new Error("Rubric message is too large")
        session.conversation.push({
            id: randomUUID(),
            role: input.role,
            text: message,
            turnId: input.turnId ?? null,
            createdAt: new Date().toISOString(),
        })
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    recordRubricRevision(id, input = {}) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        const rubric = copy(validateDatasetRubric(input.rubric))
        const assistantText = String(input.assistantText ?? "").trim()
        if (!assistantText) throw new Error("A Rubric Agent response is required")
        const now = new Date().toISOString()
        session.conversation.push({
            id: randomUUID(),
            role: "assistant",
            text: assistantText,
            turnId: input.turnId ?? null,
            createdAt: now,
        })
        session.revisions.push({
            id: randomUUID(),
            rubric,
            rubricDigest: datasetRubricDigest(rubric),
            turnId: input.turnId ?? null,
            createdAt: now,
        })
        session.draft = rubric
        session.status = "needs_review"
        session.error = null
        session.rubricAgent.currentTurnId = null
        session.updatedAt = now
        this.persist()
        return copy(session)
    }

    updateRubricModel(id, value) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This rubric session is no longer editable")
        }
        session.rubricAgent.modelId = modelId(value, "Rubric Agent model id")
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    updateRubricEffort(id, value) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This rubric session is no longer editable")
        }
        session.rubricAgent.effort = reasoningEffort(value, "Rubric Agent reasoning effort")
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    cancelRubricSession(id) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (session.status === "archived") throw new Error("A published rubric cannot be discarded")
        session.status = "cancelled"
        session.error = null
        session.rubricAgent.currentTurnId = null
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    publishRubricSession(id) {
        const state = this.load()
        const session = requireRubricSession(state, id)
        if (session.status !== "needs_review" || !session.draft) {
            throw new Error("A valid reviewed rubric draft is required before publishing")
        }
        const dataset = requireDataset(state, session.datasetId)
        const currentSkill = requireDatasetSkill(dataset)
        if (
            currentSkill.name !== session.skillReference.name ||
            currentSkill.path !== session.skillReference.path
        ) {
            throw new Error("Dataset Skill changed before the rubric could be published")
        }
        if ((dataset.activeRubricVersionId ?? null) !== (session.baseVersionId ?? null)) {
            throw new Error(
                "A newer dataset Rubric is already active; discard this stale draft and edit the latest version",
            )
        }
        const rubric = copy(validateDatasetRubric(session.draft))
        const versionNumber = state.datasetRubricVersions
            .filter((entry) => entry.datasetId === dataset.id)
            .reduce((highest, entry) => Math.max(highest, Number(entry.version) || 0), 0) + 1
        const now = new Date().toISOString()
        const version = {
            id: randomUUID(),
            datasetId: dataset.id,
            version: versionNumber,
            rubric,
            rubricDigest: datasetRubricDigest(rubric),
            skillReference: copy(session.skillReference),
            skillEvidenceDigest: session.skillEvidence.digest,
            operationEvidence: copy(session.operationEvidence),
            sourceSessionId: session.id,
            baseVersionId: session.baseVersionId,
            createdAt: now,
            publishedAt: now,
        }
        state.datasetRubricVersions.push(version)
        dataset.activeRubricVersionId = version.id
        for (const entry of state.cases.filter((candidate) => candidate.datasetId === dataset.id)) {
            if (entry.rubricVersionId === version.id) continue
            entry.rubricCalibration = {
                status: "needed",
                rubricVersionId: version.id,
                previousRubricVersionId: entry.rubricVersionId ?? null,
            }
        }
        session.status = "archived"
        session.publishedVersionId = version.id
        session.error = null
        session.rubricAgent.currentTurnId = null
        session.updatedAt = now
        this.persist()
        return copy(version)
    }

    migrateActiveDatasetRubricToUnified(datasetId) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        if (!dataset.activeRubricVersionId) {
            throw new Error("A published dataset rubric is required before upgrading its scoring contract")
        }
        const legacyVersion = requireDatasetRubricVersion(
            state,
            dataset.activeRubricVersionId,
        )
        if (legacyVersion.datasetId !== dataset.id) {
            throw new Error("Dataset active rubric does not belong to the dataset")
        }
        const legacyRubric = copy(validateDatasetRubric(legacyVersion.rubric))
        if (legacyRubric.scoringModel === UNIFIED_SCORING_MODEL) {
            throw new Error("The active dataset rubric already uses the unified scoring model")
        }
        if (Object.hasOwn(legacyRubric, "scoringModel")) {
            throw new Error("The active dataset rubric uses an unsupported scoring model")
        }
        const activeEvaluation = state.evaluationRuns.some(
            (entry) =>
                entry.datasetId === dataset.id &&
                (entry.status === "queued" || entry.status === "running"),
        )
        if (activeEvaluation) {
            throw new Error("Finish or stop the active evaluation before upgrading the dataset rubric")
        }
        const activeCaseMaintenance = state.curationSessions.some(
            (entry) =>
                entry.datasetId === dataset.id &&
                (entry.operation === "calibration" || entry.operation === "refresh") &&
                entry.status !== "archived" &&
                entry.status !== "cancelled",
        )
        if (activeCaseMaintenance) {
            throw new Error("Finish or discard the active Case calibration or refresh before upgrading the dataset rubric")
        }
        const activeRubricSession = state.rubricSessions.some(
            (entry) =>
                entry.datasetId === dataset.id &&
                entry.status !== "archived" &&
                entry.status !== "cancelled",
        )
        if (activeRubricSession) {
            throw new Error("Finish or discard the active Rubric Agent editing session before upgrading the dataset rubric")
        }

        const rubric = copy(validateDatasetRubric({
            ...legacyRubric,
            scoringModel: UNIFIED_SCORING_MODEL,
        }))
        const unchangedContent = copy(rubric)
        delete unchangedContent.scoringModel
        if (JSON.stringify(unchangedContent) !== JSON.stringify(legacyRubric)) {
            throw new Error("Dataset rubric content changed during the scoring-contract upgrade")
        }

        const versionNumber = state.datasetRubricVersions
            .filter((entry) => entry.datasetId === dataset.id)
            .reduce((highest, entry) => Math.max(highest, Number(entry.version) || 0), 0) + 1
        const now = new Date().toISOString()
        const version = {
            id: randomUUID(),
            datasetId: dataset.id,
            version: versionNumber,
            rubric,
            rubricDigest: datasetRubricDigest(rubric),
            skillReference: copy(legacyVersion.skillReference),
            skillEvidenceDigest: legacyVersion.skillEvidenceDigest,
            sourceSessionId: null,
            baseVersionId: legacyVersion.id,
            createdAt: now,
            publishedAt: now,
        }
        state.datasetRubricVersions.push(version)
        dataset.activeRubricVersionId = version.id
        for (const entry of state.cases.filter((candidate) => candidate.datasetId === dataset.id)) {
            const currentForLegacy =
                entry.rubricVersionId === legacyVersion.id &&
                entry.rubricCalibration?.status === "current" &&
                entry.rubricCalibration?.rubricVersionId === legacyVersion.id
            const previousRubricVersionId = entry.rubricVersionId ?? null
            if (currentForLegacy) entry.rubricVersionId = version.id
            entry.rubricCalibration = {
                status: currentForLegacy ? "current" : "needed",
                rubricVersionId: version.id,
                previousRubricVersionId,
            }
        }
        this.persist()
        return copy(version)
    }

    saveCase(input) {
        const state = this.load()
        const question = String(input.question ?? "").trim()
        const answer = String(input.answer ?? "").trim()
        requireCaseType(input.caseType)
        const dataset = requireDataset(state, input.datasetId)
        const skillReference = copy(requireDatasetSkill(dataset))
        if (!question) throw new Error("Case question is required")
        if (!answer) throw new Error("Case answer is required")
        const now = new Date().toISOString()
        const entry = {
            id: randomUUID(),
            datasetId: input.datasetId,
            caseType: input.caseType,
            question,
            answer,
            skillReference,
            source: {
                threadId: input.threadId ?? null,
                turnId: input.turnId ?? null,
                itemId: input.itemId ?? null,
                runtimeId: input.runtimeId ?? null,
                traceReference: input.traceReference ?? null,
                originalAssistantMessages: [{role: "assistant", content: answer}],
            },
            refreshHistory: [],
            lastRefresh: null,
            createdAt: now,
            updatedAt: now,
        }
        state.cases.push(entry)
        this.persist()
        return copy(entry)
    }

    listCurationSessions() {
        return copy(
            this.load()
                .curationSessions.filter(
                    (entry) => entry.status !== "cancelled" && entry.status !== "archived",
                )
                .sort((left, right) =>
                    String(right.updatedAt).localeCompare(String(left.updatedAt)),
                ),
        )
    }

    listArchivedCurationSessions() {
        return copy(
            this.load()
                .curationSessions.filter((entry) => entry.status === "archived")
                .sort((left, right) =>
                    String(right.updatedAt).localeCompare(String(left.updatedAt)),
                ),
        )
    }

    listConversationCurationMarkers(sessionId) {
        const normalizedSessionId = String(sessionId ?? "").trim()
        if (!normalizedSessionId || normalizedSessionId.length > 200) {
            throw new Error("DSH Session id is required")
        }
        const state = this.load()
        const markers = []
        const projectedCaseIds = new Set()
        for (const session of state.curationSessions) {
            const source = dshConversationSource(session.episode?.source)
            if (!source || source.sessionId !== normalizedSessionId || session.status === "cancelled") {
                continue
            }
            const caseRecord = state.cases.find((entry) =>
                entry.id === session.caseId || entry.source?.curationSessionId === session.id,
            )
            if (!caseRecord && session.status === "archived") continue
            if (caseRecord) projectedCaseIds.add(caseRecord.id)
            markers.push({
                sessionId: source.sessionId,
                startSeq: source.startSeq,
                endSeq: source.endSeq,
                endMessageId: source.endMessageId,
                curationSessionId: session.id,
                caseId: caseRecord?.id ?? null,
                status: caseRecord ? "saved" : "draft",
                digest: source.digest,
            })
        }
        for (const entry of state.cases) {
            if (projectedCaseIds.has(entry.id)) continue
            const source = dshConversationSource(entry.source)
            if (!source || source.sessionId !== normalizedSessionId) continue
            markers.push({
                sessionId: source.sessionId,
                startSeq: source.startSeq,
                endSeq: source.endSeq,
                endMessageId: source.endMessageId,
                curationSessionId: entry.source?.curationSessionId ?? null,
                caseId: entry.id,
                status: "saved",
                digest: source.digest,
            })
        }
        markers.sort((left, right) =>
            left.startSeq - right.startSeq ||
            left.endSeq - right.endSeq ||
            Number(right.status === "saved") - Number(left.status === "saved") ||
            String(left.curationSessionId ?? "").localeCompare(String(right.curationSessionId ?? "")) ||
            String(left.caseId ?? "").localeCompare(String(right.caseId ?? "")),
        )
        return copy(markers)
    }

    hasCurationForSource(threadId, endItemId) {
        return this.load().curationSessions.some(
            (entry) =>
                entry.episode?.source?.threadId === threadId &&
                entry.episode?.source?.endItemId === endItemId,
        )
    }

    getCurationSession(id) {
        return copy(requireCurationSession(this.load(), id))
    }

    findCurationSessionByIdempotencyKey(idempotencyKey) {
        const normalized = modelId(idempotencyKey, "Curation idempotency key")
        if (!normalized) return null
        const session = this.load().curationSessions.find(
            (entry) => entry.idempotencyKey === normalized && entry.status !== "cancelled",
        )
        return session ? copy(session) : null
    }

    createCurationSession(input) {
        const state = this.load()
        const dataset = requireDataset(state, input.datasetId)
        const rubricVersionSnapshot = dataset.activeRubricVersionId
            ? copy(requireDatasetRubricVersion(state, dataset.activeRubricVersionId))
            : null
        const session = newCurationSession({
            dataset,
            input: {...input, rubricVersionSnapshot},
            episode: input.episode,
        })
        state.curationSessions.push(session)
        this.persist()
        return copy(session)
    }

    createCaseCalibrationSession(input) {
        const state = this.load()
        const dataset = requireDataset(state, input.datasetId)
        const activeRubricVersionId = dataset.activeRubricVersionId
        if (!activeRubricVersionId) {
            throw new Error("A published dataset rubric is required for Case calibration")
        }
        const target = requireCase(state, dataset.id, input.caseId)
        if (
            target.rubricVersionId === activeRubricVersionId &&
            target.rubricCalibration?.status !== "needed"
        ) {
            throw new Error("This Case is already calibrated for the active dataset rubric")
        }
        const existing = activeCaseMaintenance(state, dataset.id, target.id)
        if (existing?.operation === "calibration") {
            throw new Error("Case calibration is already in progress")
        }
        if (existing) throw new Error("Case maintenance is already in progress")
        const sourceSession = state.curationSessions.find(
            (entry) =>
                entry.id === target.source?.curationSessionId ||
                entry.caseId === target.id,
        )
        const episode = sourceSession?.episode
            ? copy(sourceSession.episode)
            : episodeFromCase(target)
        const rubricVersionSnapshot = copy(
            requireDatasetRubricVersion(state, activeRubricVersionId),
        )
        const session = newCurationSession({
            dataset,
            operation: "calibration",
            targetCaseId: target.id,
            baselineCaseSnapshot: caseCalibrationBaseline(target),
            episode,
            input: {
                caseType: target.caseType,
                issueDescription: target.issueDescription ?? "",
                curator: input.curator ?? {},
                rubricVersionSnapshot,
            },
        })
        state.curationSessions.push(session)
        this.persist()
        return copy(session)
    }

    createCaseRefreshSession(input) {
        const state = this.load()
        const dataset = requireDataset(state, input.datasetId)
        const target = requireCase(state, dataset.id, input.caseId)
        if (activeCaseMaintenance(state, dataset.id, target.id)) {
            throw new Error("Case refresh or calibration is already in progress")
        }
        const rubricVersionSnapshot = dataset.activeRubricVersionId
            ? copy(requireDatasetRubricVersion(state, dataset.activeRubricVersionId))
            : null
        const session = newCurationSession({
            dataset,
            operation: "refresh",
            targetCaseId: target.id,
            baselineCaseSnapshot: caseRefreshBaseline(target),
            episode: input.episode,
            input: {
                executionSkillReference: input.executionSkillReference,
                operationEvidence: input.operationEvidence,
                caseType: target.caseType,
                issueDescription: target.issueDescription ?? "",
                curator: input.curator ?? {},
                rubricVersionSnapshot,
            },
        })
        session.targetCaseUpdatedAt = target.updatedAt
        state.curationSessions.push(session)
        this.persist()
        return copy(session)
    }

    updateCurationSession(id, patch = {}) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (patch.status !== undefined) {
            if (!CURATION_STATUSES.has(patch.status)) throw new Error("Invalid curation status")
            session.status = patch.status
        }
        if (patch.curator !== undefined) {
            session.curator = {...session.curator, ...copy(patch.curator)}
        }
        if (patch.error !== undefined) session.error = patch.error ? String(patch.error) : null
        if (patch.draft !== undefined) {
            session.draft = patch.draft
                ? copy(
                      validateCuratorDraft(patch.draft, {
                          ...curationValidationOptions(session),
                      }),
                  )
                : null
        }
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    updateCurationModel(id, value) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This curation session is no longer editable")
        }
        session.curator.modelId = modelId(value, "Curator model id")
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    updateCurationEffort(id, value) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This curation session is no longer editable")
        }
        session.curator.effort = reasoningEffort(value, "Curator reasoning effort")
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    cancelCurationSession(id) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (session.status === "archived") throw new Error("A saved case cannot be discarded")
        if (session.status === "cancelled") throw new Error("Curation session is already discarded")
        session.status = "cancelled"
        session.error = null
        session.curator.currentTurnId = null
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    appendCurationMessage(id, input) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (input.role !== "user" && input.role !== "assistant") {
            throw new Error("Curation message role must be user or assistant")
        }
        const text = String(input.text ?? "").trim()
        if (!text) throw new Error("Curation message text is required")
        if (text.length > 120_000) throw new Error("Curation message is too large")
        session.conversation.push({
            id: randomUUID(),
            role: input.role,
            text,
            turnId: input.turnId ?? null,
            createdAt: new Date().toISOString(),
        })
        session.updatedAt = new Date().toISOString()
        this.persist()
        return copy(session)
    }

    recordCurationRevision(id, input) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        const draft = copy(
            validateCuratorDraft(input.draft, {
                ...curationValidationOptions(session),
            }),
        )
        const assistantText = String(input.assistantText ?? "").trim()
        if (!assistantText) throw new Error("A Curator response is required")
        const now = new Date().toISOString()
        session.conversation.push({
            id: randomUUID(),
            role: "assistant",
            text: assistantText,
            turnId: input.turnId ?? null,
            createdAt: now,
        })
        const revision = {
            id: randomUUID(),
            draft,
            turnId: input.turnId ?? null,
            createdAt: now,
        }
        session.revisions.push(revision)
        session.draft = draft
        session.status = "needs_review"
        session.error = null
        session.curator.currentTurnId = null
        session.updatedAt = now
        this.persist()
        return copy(session)
    }

    archiveCurationSession(id) {
        const state = this.load()
        const session = requireCurationSession(state, id)
        if (session.status === "archived") throw new Error("Curation session is already archived")
        if (session.status !== "needs_review" || !session.draft) {
            throw new Error("A valid reviewed draft is required before archiving")
        }
        const dataset = requireDataset(state, session.datasetId)
        const draft = copy(
            validateCuratorDraft(session.draft, {
                ...curationValidationOptions(session),
            }),
        )
        const now = new Date().toISOString()
        const latestRevision = session.revisions.at(-1)
        const frozenRubricVersionId = session.rubricVersionSnapshot?.id ?? null
        const activeRubricVersionId = dataset.activeRubricVersionId ?? null
        const rubricCalibration = activeRubricVersionId
            ? activeRubricVersionId === frozenRubricVersionId
                ? {
                      status: "current",
                      rubricVersionId: activeRubricVersionId,
                      previousRubricVersionId: frozenRubricVersionId,
                  }
                : {
                      status: "needed",
                      rubricVersionId: activeRubricVersionId,
                      previousRubricVersionId: frozenRubricVersionId,
                  }
            : null
        if (session.operation === "refresh") {
            if (!session.targetCaseId) throw new Error("Case refresh target is missing")
            const target = requireCase(state, session.datasetId, session.targetCaseId)
            if (target.updatedAt !== session.targetCaseUpdatedAt) {
                throw new Error("The Case changed during refresh; restart refresh from the latest Case")
            }
            if (!sameSkillReferenceIdentity(dataset.skillReference, session.skillReference)) {
                throw new Error("The dataset Skill changed during refresh; restart refresh with the current Skill")
            }
            if (activeRubricVersionId !== frozenRubricVersionId) {
                throw new Error("The dataset Rubric changed during refresh; restart refresh with the current Rubric")
            }
            if (!Array.isArray(target.refreshHistory)) target.refreshHistory = []
            target.refreshHistory.push({
                id: randomUUID(),
                answer: target.answer,
                curated: copy(target.curated ?? null),
                issueDescription: target.issueDescription ?? "",
                skillReference: copy(target.skillReference ?? null),
                rubricVersionId: target.rubricVersionId ?? null,
                rubricCalibration: copy(target.rubricCalibration ?? null),
                source: copy(target.source ?? null),
                evidence: copy(target.evidence ?? null),
                archivedAt: now,
            })
            target.answer = formatCuratedAnswer(draft)
            target.curated = draft
            target.issueDescription = session.issueDescription
            target.skillReference = copy(session.skillReference)
            target.rubricVersionId = frozenRubricVersionId
            target.rubricCalibration = rubricCalibration
            target.source = {
                threadId: session.episode.source.threadId,
                turnId: session.episode.source.endTurnId,
                itemId: session.episode.source.endItemId,
                startTurnId: session.episode.source.startTurnId,
                startItemId: session.episode.source.startItemId,
                endTurnId: session.episode.source.endTurnId,
                endItemId: session.episode.source.endItemId,
                runtimeId: session.episode.source.runtimeId,
                modelProvider: session.episode.source.modelProvider,
                modelId: session.episode.source.modelId,
                traceReference: session.episode.source.traceReference,
                ...dshConversationSource(session.episode.source),
                curationSessionId: session.id,
                curationRevisionId: latestRevision?.id ?? null,
                curatorThreadId: session.curator.threadId,
                curatorRuntimeId: session.curator.runtimeId,
                curatorModelProvider: session.curator.modelProvider,
                curatorModelId: session.curator.modelId,
                curatorEffort: session.curator.effort,
                curatorEffectiveModelId: session.curator.effectiveModelId,
                curatorEffectiveEffort: session.curator.effectiveEffort,
                curatorPromptVersion: session.curator.promptVersion,
                skillName: session.skillReference?.name ?? null,
                skillPath: session.skillReference?.path ?? null,
                skillRuntimeId: session.skillReference?.runtimeId ?? null,
                originalQuestion: target.question,
                originalAssistantMessages: originalAssistantMessagesFromEpisode(session.episode),
                skillConfirmedAt: session.skillReference?.confirmedAt ?? null,
            }
            target.evidence = {
                episodeSchemaVersion: session.episode.schemaVersion,
                toolActivity: copy(session.episode.toolActivity),
                operationEvidence: copy(session.operationEvidence),
            }
            target.updatedAt = now
            target.lastRefresh = {
                sessionId: session.id,
                revisionId: latestRevision?.id ?? null,
                threadId: session.episode.source.threadId,
                runtimeId: session.episode.source.runtimeId,
                refreshedAt: now,
            }
            session.status = "archived"
            session.caseId = target.id
            session.updatedAt = now
            this.persist()
            return copy(target)
        }
        if (session.operation === "calibration") {
            if (!session.targetCaseId) throw new Error("Case calibration target is missing")
            if (!frozenRubricVersionId || activeRubricVersionId !== frozenRubricVersionId) {
                throw new Error(
                    "The dataset rubric changed during calibration; discard this draft and calibrate against the latest version",
                )
            }
            const target = requireCase(state, session.datasetId, session.targetCaseId)
            const previousRubricVersionId = target.rubricVersionId ?? null
            if (!Array.isArray(target.calibrationHistory)) target.calibrationHistory = []
            target.calibrationHistory.push({
                id: randomUUID(),
                rubricVersionId: previousRubricVersionId,
                rubricCalibration: copy(target.rubricCalibration ?? null),
                skillReference: copy(target.skillReference ?? null),
                answer: target.answer,
                curated: copy(target.curated ?? null),
                issueDescription: target.issueDescription ?? "",
                curation: {
                    sessionId: target.source?.curationSessionId ?? null,
                    revisionId: target.source?.curationRevisionId ?? null,
                    curatorThreadId: target.source?.curatorThreadId ?? null,
                    curatorRuntimeId: target.source?.curatorRuntimeId ?? null,
                    curatorModelId: target.source?.curatorModelId ?? null,
                    curatorEffort: target.source?.curatorEffort ?? null,
                },
                archivedAt: now,
            })
            target.answer = formatCuratedAnswer(draft)
            target.curated = draft
            target.rubricVersionId = frozenRubricVersionId
            target.rubricCalibration = {
                status: "current",
                rubricVersionId: frozenRubricVersionId,
                previousRubricVersionId,
            }
            target.skillReference = copy(session.skillReference)
            target.issueDescription = session.issueDescription
            target.source = {
                ...target.source,
                curationSessionId: session.id,
                curationRevisionId: latestRevision?.id ?? null,
                curatorThreadId: session.curator.threadId,
                curatorRuntimeId: session.curator.runtimeId,
                curatorModelProvider: session.curator.modelProvider,
                curatorModelId: session.curator.modelId,
                curatorEffort: session.curator.effort,
                curatorEffectiveModelId: session.curator.effectiveModelId,
                curatorEffectiveEffort: session.curator.effectiveEffort,
                curatorPromptVersion: session.curator.promptVersion,
                skillName: session.skillReference?.name ?? null,
                skillPath: session.skillReference?.path ?? null,
                skillRuntimeId: session.skillReference?.runtimeId ?? null,
                skillConfirmedAt: session.skillReference?.confirmedAt ?? null,
            }
            target.updatedAt = now
            session.status = "archived"
            session.caseId = target.id
            session.updatedAt = now
            this.persist()
            return copy(target)
        }
        const entry = {
            id: randomUUID(),
            datasetId: session.datasetId,
            caseType: session.caseType,
            question: session.episode.originalQuestion,
            issueDescription: session.issueDescription,
            answer: formatCuratedAnswer(draft),
            curated: draft,
            rubricVersionId: frozenRubricVersionId,
            rubricCalibration,
            skillReference: copy(session.skillReference),
            source: {
                threadId: session.episode.source.threadId,
                turnId: session.episode.source.endTurnId,
                itemId: session.episode.source.endItemId,
                startTurnId: session.episode.source.startTurnId,
                startItemId: session.episode.source.startItemId,
                endTurnId: session.episode.source.endTurnId,
                endItemId: session.episode.source.endItemId,
                runtimeId: session.episode.source.runtimeId,
                modelProvider: session.episode.source.modelProvider,
                modelId: session.episode.source.modelId,
                traceReference: session.episode.source.traceReference,
                ...dshConversationSource(session.episode.source),
                curationSessionId: session.id,
                curationRevisionId: latestRevision?.id ?? null,
                curatorThreadId: session.curator.threadId,
                curatorRuntimeId: session.curator.runtimeId,
                curatorModelProvider: session.curator.modelProvider,
                curatorModelId: session.curator.modelId,
                curatorEffort: session.curator.effort,
                curatorEffectiveModelId: session.curator.effectiveModelId,
                curatorEffectiveEffort: session.curator.effectiveEffort,
                curatorPromptVersion: session.curator.promptVersion,
                skillName: session.skillReference?.name ?? null,
                skillPath: session.skillReference?.path ?? null,
                skillRuntimeId: session.skillReference?.runtimeId ?? null,
                originalQuestion: session.episode.originalQuestion,
                originalAssistantMessages: originalAssistantMessagesFromEpisode(session.episode),
                skillConfirmedAt: session.skillReference?.confirmedAt ?? null,
            },
            evidence: {
                episodeSchemaVersion: session.episode.schemaVersion,
                toolActivity: copy(session.episode.toolActivity),
                operationEvidence: copy(session.operationEvidence),
            },
            calibrationHistory: [],
            refreshHistory: [],
            lastRefresh: null,
            createdAt: now,
            updatedAt: now,
        }
        state.cases.push(entry)
        session.status = "archived"
        session.caseId = entry.id
        session.updatedAt = now
        this.persist()
        return copy(entry)
    }

    deleteCase(datasetId, caseId) {
        const state = this.load()
        requireDataset(state, datasetId)
        assertCaseDeletable(state, datasetId, caseId)
        const index = state.cases.findIndex(
            (entry) => entry.datasetId === datasetId && entry.id === caseId,
        )
        if (index < 0) throw new Error("Unknown Case")
        const [deleted] = state.cases.splice(index, 1)
        this.persist()
        return copy(deleted)
    }

    prepareCaseDeletion(datasetId, caseId) {
        const state = this.load()
        const dataset = requireDataset(state, datasetId)
        const target = requireCase(state, datasetId, caseId)
        assertCaseDeletable(state, datasetId, caseId)
        return copy({dataset, cases: [target]})
    }

    createEvaluationRun(input = {}, options = {}) {
        const state = this.load()
        const dataset = requireDataset(state, input.datasetId)
        const datasetSkillReference = copy(requireDatasetSkill(dataset))
        const rubricVersionSnapshot = dataset.activeRubricVersionId
            ? copy(requireDatasetRubricVersion(state, dataset.activeRubricVersionId))
            : null
        if (rubricVersionSnapshot && rubricVersionSnapshot.datasetId !== dataset.id) {
            throw new Error("Dataset active rubric does not belong to the dataset")
        }
        if (
            rubricVersionSnapshot &&
            rubricVersionSnapshot.rubric?.scoringModel !== UNIFIED_SCORING_MODEL
        ) {
            throw new Error(
                "Update and publish the dataset Rubric with the unified scoring model before evaluation",
            )
        }
        if (
            input.skillReference &&
            (String(input.skillReference.name ?? "").trim() !== datasetSkillReference.name ||
                String(input.skillReference.path ?? "").trim() !== datasetSkillReference.path)
        ) {
            throw new Error("Evaluation Skill conflicts with the dataset Skill binding")
        }
        if (input.selectionMode !== "selected" && input.selectionMode !== "dataset") {
            throw new Error("Evaluation selection mode must be selected or dataset")
        }
        if (input.activationMode !== "automatic" && input.activationMode !== "explicit") {
            throw new Error("Evaluation activation mode must be automatic or explicit")
        }
        const requestedCaseIds = Array.isArray(input.caseIds) ? input.caseIds : []
        const caseSnapshots = state.cases.filter(
            (entry) =>
                entry.datasetId === input.datasetId &&
                (input.selectionMode === "dataset" || requestedCaseIds.includes(entry.id)),
        )
        if (!caseSnapshots.length) throw new Error("At least one Case is required")
        if (
            input.selectionMode === "selected" &&
            caseSnapshots.length !== new Set(requestedCaseIds).size
        ) {
            throw new Error("One or more selected Cases are unavailable")
        }
        if (
            rubricVersionSnapshot &&
            caseSnapshots.some((entry) => entry.rubricVersionId !== rubricVersionSnapshot.id)
        ) {
            throw new Error(
                "One or more Cases require calibration for the active dataset rubric version",
            )
        }
        const requestedRuntimeConfigurations = input.runtimeConfigurations ?? []
        let runtimeConfigurations = requestedRuntimeConfigurations.map((configuration) => ({
            ...evaluationRuntimeConfiguration(configuration),
            skillEvidenceBinding:
                configuration.skillEvidenceBinding === "verified" ? "verified" : "unverified",
        }))
        if (!runtimeConfigurations.length) throw new Error("At least one runtime is required")
        const duplicateRuntimes = new Set()
        for (const configuration of runtimeConfigurations) {
            if (duplicateRuntimes.has(configuration.runtimeId)) {
                throw new Error("Each runtime may only appear once in an evaluation")
            }
            duplicateRuntimes.add(configuration.runtimeId)
        }
        let managedVersionSnapshot = null
        if (input.managedVersionSnapshot !== undefined && input.managedVersionSnapshot !== null) {
            const optimizationAuthorized = options.optimizationAuthorized === true
            const managedVersionAuthorized = options.managedVersionAuthorized === true
            if (!optimizationAuthorized && !managedVersionAuthorized) {
                throw new Error("Managed evaluation requires an internal capability")
            }
            managedVersionSnapshot = managedEvaluationVersionSnapshot(
                input.managedVersionSnapshot,
                runtimeConfigurations.map((configuration) => configuration.runtimeId),
            )
            if (
                datasetSkillReference.evidencePrecision === "managed" &&
                (datasetSkillReference.repositoryId !== managedVersionSnapshot.repositoryId ||
                    datasetSkillReference.id !== managedVersionSnapshot.skillId)
            ) {
                throw new Error("Managed version does not belong to the Dataset Skill")
            }
            runtimeConfigurations = runtimeConfigurations.map((configuration, index) =>
                managedRuntimeConfigurationBinding({
                    input: requestedRuntimeConfigurations[index],
                    configuration,
                    datasetSkillReference,
                    managedVersionSnapshot,
                    optimizationAuthorized,
                }),
            )
        }
        const now = new Date().toISOString()
        const requestedJudgeProfile = input.judgeProfile ?? state.settings.judgeProfile
        const judgeProfile = {
            runtimePolicy: "active",
            modelId: modelId(requestedJudgeProfile?.modelId, "Judge model id"),
            effort: reasoningEffort(requestedJudgeProfile?.effort, "Judge reasoning effort"),
        }
        const judgeConfiguration = input.judgeConfiguration
            ? evaluationRuntimeConfiguration(input.judgeConfiguration, {
                  runtimeId: "Judge runtime id",
                  providerId: "Judge runtime provider id",
                  executablePath: "Judge runtime executable path",
                  displayName: "Judge runtime name",
                  version: "Judge runtime version",
                  source: "Judge runtime source",
                  transport: "Judge runtime transport",
                  modelId: "Judge model id",
                  effort: "Judge reasoning effort",
              })
            : null
        const skillEvidence = validateSkillEvidence(input.skillEvidence, {
            expectedName: datasetSkillReference.name,
            requireComplete: true,
        })
        if (managedVersionSnapshot) {
            const managedSource = skillEvidence.managedSource
            if (
                !managedSource ||
                managedSource.repositoryId !== managedVersionSnapshot.repositoryId ||
                managedSource.skillId !== managedVersionSnapshot.skillId ||
                managedSource.versionId !== managedVersionSnapshot.versionId ||
                managedSource.commit !== managedVersionSnapshot.commit ||
                managedSource.skillRoot !== managedVersionSnapshot.skillRoot ||
                managedSource.contentDigest !== managedVersionSnapshot.contentDigest
            ) {
                throw new Error("Managed Candidate evaluation requires exact managed commit evidence")
            }
        }
        const run = {
            id: randomUUID(),
            datasetId: input.datasetId,
            datasetSnapshot: copy(dataset),
            rubricVersionSnapshot,
            selectionMode: input.selectionMode,
            selectedCaseIds: caseSnapshots.map((entry) => entry.id),
            caseSnapshots: copy(caseSnapshots),
            skillReference: datasetSkillReference,
            skillEvidence,
            managedVersionSnapshot,
            activationMode: input.activationMode,
            judgeProfile,
            judgeConfiguration,
            runtimeConfigurations,
            status: "queued",
            results: [],
            createdAt: now,
            startedAt: null,
            completedAt: null,
        }
        for (const configuration of runtimeConfigurations) {
            for (const caseSnapshot of caseSnapshots) {
                run.results.push({
                    id: randomUUID(),
                    caseId: caseSnapshot.id,
                    runtimeId: configuration.runtimeId,
                    caseSnapshot: copy(caseSnapshot),
                    runtimeConfiguration: copy(configuration),
                    status: "queued",
                    gradingStatus: "awaiting_execution",
                    scoreContract: null,
                    judgment: null,
                    computedScore: null,
                    judge: null,
                    gradingError: null,
                    gradingQueuedAt: null,
                    gradingStartedAt: null,
                    gradingCompletedAt: null,
                    durationMs: null,
                    response: null,
                    error: null,
                    threadId: null,
                    turnId: null,
                    traceReference: null,
                    traceEvidence: null,
                    startedAt: null,
                    completedAt: null,
                })
            }
        }
        state.evaluationRuns.push(run)
        this.persist()
        return copy(run)
    }

    listEvaluationRuns(datasetId = null) {
        const state = this.load()
        return copy(
            state.evaluationRuns
                .filter((entry) => !datasetId || entry.datasetId === datasetId)
                .sort((left, right) =>
                    String(right.createdAt).localeCompare(String(left.createdAt)),
                ),
        )
    }

    listEvaluationRunSummaries(datasetId = null) {
        const state = this.load()
        return copy(
            state.evaluationRuns
                .filter((entry) => !datasetId || entry.datasetId === datasetId)
                .sort((left, right) =>
                    String(right.createdAt).localeCompare(String(left.createdAt)),
                )
                .map((run) => ({
                    id: run.id,
                    datasetId: run.datasetId,
                    datasetSnapshot: run.datasetSnapshot,
                    selectionMode: run.selectionMode,
                    skillReference: run.skillReference,
                    activationMode: run.activationMode,
                    status: run.status,
                    caseCount: run.caseSnapshots?.length ?? 0,
                    runtimeCount: run.runtimeConfigurations?.length ?? 0,
                    createdAt: run.createdAt,
                    startedAt: run.startedAt,
                    completedAt: run.completedAt,
                })),
        )
    }

    getEvaluationRun(id) {
        const run = this.load().evaluationRuns.find((entry) => entry.id === id)
        if (!run) throw new Error("Unknown evaluation run")
        return copy(run)
    }

    deleteEvaluationRun(id) {
        const state = this.load()
        const index = state.evaluationRuns.findIndex((entry) => entry.id === id)
        if (index < 0) throw new Error("Unknown evaluation run")
        const run = state.evaluationRuns[index]
        if (run.status === "queued" || run.status === "running") {
            throw new Error("Cannot delete an active evaluation run")
        }
        const [deleted] = state.evaluationRuns.splice(index, 1)
        this.persist()
        return copy(deleted)
    }

    cancelEvaluationRun(id) {
        const state = this.load()
        const run = state.evaluationRuns.find((entry) => entry.id === id)
        if (!run) throw new Error("Unknown evaluation run")
        if (run.status !== "queued" && run.status !== "running") {
            throw new Error("Evaluation run is not active")
        }
        const now = new Date().toISOString()
        const cancellationError = "Evaluation cancelled by user"
        for (const result of run.results ?? []) {
            if (result.status === "queued" || result.status === "running") {
                result.status = "cancelled"
                result.error = cancellationError
                result.completedAt = now
            }
            if (
                result.gradingStatus === "awaiting_execution" ||
                result.gradingStatus === "queued" ||
                result.gradingStatus === "running"
            ) {
                result.gradingStatus = "skipped"
                result.gradingError = cancellationError
                result.gradingCompletedAt = now
                result.judge = {status: "skipped", error: cancellationError}
            }
        }
        run.status = "cancelled"
        run.completedAt = now
        this.persist()
        return copy(run)
    }

    updateEvaluationRun(id, patch = {}) {
        const state = this.load()
        const run = state.evaluationRuns.find((entry) => entry.id === id)
        if (!run) throw new Error("Unknown evaluation run")
        if (patch.status !== undefined) {
            if (!EVALUATION_RUN_STATUSES.has(patch.status)) {
                throw new Error("Invalid evaluation run status")
            }
            run.status = patch.status
        }
        for (const field of ["startedAt", "completedAt"]) {
            if (patch[field] !== undefined) run[field] = patch[field] ? String(patch[field]) : null
        }
        this.persist()
        return copy(run)
    }

    updateEvaluationResult(runId, resultId, patch = {}) {
        const state = this.load()
        const run = state.evaluationRuns.find((entry) => entry.id === runId)
        if (!run) throw new Error("Unknown evaluation run")
        const result = run.results.find((entry) => entry.id === resultId)
        if (!result) throw new Error("Unknown evaluation result")
        if (
            patch.gradingStatus !== undefined &&
            !EVALUATION_GRADING_STATUSES.has(patch.gradingStatus)
        ) {
            throw new Error("Invalid evaluation grading status")
        }
        const structuredFields = {}
        for (const field of ["scoreContract", "judgment", "computedScore", "judge", "traceEvidence"]) {
            if (patch[field] !== undefined) {
                structuredFields[field] = structuredObject(
                    patch[field],
                    `Evaluation result ${field}`,
                )
            }
        }
        if (patch.status !== undefined) {
            if (!EVALUATION_RESULT_STATUSES.has(patch.status)) {
                throw new Error("Invalid evaluation result status")
            }
            result.status = patch.status
        }
        if (patch.gradingStatus !== undefined) {
            result.gradingStatus = patch.gradingStatus
        }
        for (const [field, value] of Object.entries(structuredFields)) {
            result[field] = value
        }
        if (patch.durationMs !== undefined) {
            const duration = Number(patch.durationMs)
            if (!Number.isFinite(duration) || duration < 0) throw new Error("Invalid duration")
            result.durationMs = Math.round(duration)
        }
        for (const field of [
            "response",
            "error",
            "threadId",
            "turnId",
            "traceReference",
            "startedAt",
            "completedAt",
            "gradingError",
            "gradingQueuedAt",
            "gradingStartedAt",
            "gradingCompletedAt",
        ]) {
            if (patch[field] !== undefined) {
                result[field] = patch[field] === null ? null : String(patch[field])
            }
        }
        this.persist()
        return copy(run)
    }
}

module.exports = {
    LOCAL_SCHEMA,
    LocalEvaluationStore,
    REASONING_EFFORTS,
    initialState,
    migrateState,
    reasoningEffort,
}
