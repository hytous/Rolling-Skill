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

const {formatCuratedAnswer, validateCuratorDraft} = require("./episode-curation.cjs")

const LOCAL_SCHEMA = "rolling-skill-local/v4"
const CURATION_STATUSES = new Set([
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
const EVALUATION_RESULT_STATUSES = new Set(["queued", "running", "completed", "failed"])

function copy(value) {
    return JSON.parse(JSON.stringify(value))
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

function defaultSettings() {
    return {
        autoCapture: false,
        language: "zh-CN",
        theme: "codex-light",
        localAccess: "full",
        taskProfile: {runtimePolicy: "active", modelId: null, effort: null},
        curatorProfile: {runtimePolicy: "active", modelId: null, effort: null},
        autoCaptureProfile: {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
            datasetId: null,
            caseType: "goodcase",
            skillName: null,
            skillPath: null,
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
                createdAt: now,
            },
        ],
        cases: [],
        curationSessions: [],
        evaluationRuns: [],
    }
}

function migrateState(input) {
    const state = copy(input ?? {})
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
    if (!state.settings.autoCaptureProfile) {
        state.settings.autoCaptureProfile = {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
            datasetId: null,
            caseType: "goodcase",
            skillName: null,
            skillPath: null,
        }
        changed = true
    }
    if (!("skillName" in state.settings.autoCaptureProfile)) {
        state.settings.autoCaptureProfile.skillName = null
        changed = true
    }
    if (!("skillPath" in state.settings.autoCaptureProfile)) {
        state.settings.autoCaptureProfile.skillPath = null
        changed = true
    }
    for (const profile of [
        state.settings.taskProfile,
        state.settings.curatorProfile,
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
    if (!Array.isArray(state.evaluationRuns)) {
        state.evaluationRuns = []
        changed = true
    }
    for (const session of state.curationSessions) {
        if (typeof session.datasetQuestion !== "string" || !session.datasetQuestion.trim()) {
            session.datasetQuestion = String(session.episode?.originalQuestion ?? "")
            changed = true
        }
        if (!("skillReference" in session)) {
            session.skillReference = null
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
    return {state, changed}
}

function requireDataset(state, datasetId) {
    if (!state.datasets.some((dataset) => dataset.id === datasetId)) {
        throw new Error("Unknown dataset")
    }
}

function requireCaseType(caseType) {
    if (caseType !== "goodcase" && caseType !== "badcase") {
        throw new Error("Case type must be goodcase or badcase")
    }
}

function requireCurationSession(state, id) {
    const session = state.curationSessions.find((entry) => entry.id === id)
    if (!session) throw new Error("Unknown curation session")
    return session
}

function skillIdentity(value, label) {
    const normalized = value === null || value === undefined ? null : String(value).trim()
    if (normalized && normalized.length > 4_096) throw new Error(`${label} is too long`)
    return normalized || null
}

function normalizeSkillReference(value) {
    if (value === null || value === undefined) return null
    if (value.schemaVersion !== "rolling-skill-skill-reference/v1") {
        throw new Error("A valid runtime Skill reference is required")
    }
    const name = skillIdentity(value.name, "Skill name")
    const path = skillIdentity(value.path, "Skill path")
    if (!name || !path || !path.startsWith("/")) {
        throw new Error("A valid runtime Skill name and absolute path are required")
    }
    return {
        schemaVersion: value.schemaVersion,
        name,
        path,
        scope: skillIdentity(value.scope, "Skill scope"),
        description: skillIdentity(value.description, "Skill description"),
        runtimeId: skillIdentity(value.runtimeId, "Skill runtime id"),
        confirmedAt: skillIdentity(value.confirmedAt, "Skill confirmation time"),
    }
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

    createDataset(name) {
        const trimmed = String(name ?? "").trim()
        if (!trimmed) throw new Error("Dataset name is required")
        const state = this.load()
        const dataset = {id: randomUUID(), name: trimmed, createdAt: new Date().toISOString()}
        state.datasets.push(dataset)
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
        if ((this.datasetReservations.get(datasetId) ?? 0) > 0) {
            throw new Error("Dataset has an unfinished Curator draft or capture in progress")
        }
        const unfinishedCurations = state.curationSessions.filter(
            (entry) =>
                entry.datasetId === datasetId &&
                entry.status !== "archived" &&
                entry.status !== "cancelled",
        )
        if (unfinishedCurations.length) {
            throw new Error("Dataset has unfinished Curator drafts")
        }

        const dataset = state.datasets.find((entry) => entry.id === datasetId)
        const deletedCaseCount = state.cases.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const deletedCurationCount = state.curationSessions.filter(
            (entry) => entry.datasetId === datasetId,
        ).length
        const preservedEvaluationRunCount = state.evaluationRuns.filter(
            (entry) => entry.datasetId === datasetId,
        ).length

        state.datasets = state.datasets.filter((entry) => entry.id !== datasetId)
        state.cases = state.cases.filter((entry) => entry.datasetId !== datasetId)
        state.curationSessions = state.curationSessions.filter(
            (entry) => entry.datasetId !== datasetId,
        )

        const automatic = state.settings.autoCaptureProfile
        if (automatic.datasetId === datasetId) {
            automatic.datasetId = null
            state.settings.autoCapture = false
        }

        this.persist()
        return copy({
            dataset,
            deletedCaseCount,
            deletedCurationCount,
            preservedEvaluationRunCount,
            settings: state.settings,
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
        if (input.autoCapture !== undefined) settings.autoCapture = Boolean(input.autoCapture)
        const automatic = {...settings.autoCaptureProfile, runtimePolicy: "active"}
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
        if (input.autoCaptureCaseType !== undefined) {
            requireCaseType(input.autoCaptureCaseType)
            automatic.caseType = input.autoCaptureCaseType
        }
        if (input.autoCaptureSkillName !== undefined) {
            automatic.skillName = skillIdentity(
                input.autoCaptureSkillName,
                "Automatic capture Skill name",
            )
        }
        if (input.autoCaptureSkillPath !== undefined) {
            const path = skillIdentity(
                input.autoCaptureSkillPath,
                "Automatic capture Skill path",
            )
            if (path && !path.startsWith("/")) {
                throw new Error("Automatic capture Skill path must be absolute")
            }
            automatic.skillPath = path
        }
        settings.autoCaptureProfile = automatic
        this.persist()
        return copy(settings)
    }

    saveCase(input) {
        const state = this.load()
        const question = String(input.question ?? "").trim()
        const answer = String(input.answer ?? "").trim()
        requireCaseType(input.caseType)
        requireDataset(state, input.datasetId)
        if (!question) throw new Error("Case question is required")
        if (!answer) throw new Error("Case answer is required")
        const entry = {
            id: randomUUID(),
            datasetId: input.datasetId,
            caseType: input.caseType,
            question,
            answer,
            source: {
                threadId: input.threadId ?? null,
                turnId: input.turnId ?? null,
                itemId: input.itemId ?? null,
                runtimeId: input.runtimeId ?? null,
                traceReference: input.traceReference ?? null,
            },
            createdAt: new Date().toISOString(),
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

    createCurationSession(input) {
        const state = this.load()
        requireCaseType(input.caseType)
        requireDataset(state, input.datasetId)
        const episode = copy(input.episode)
        if (episode?.schemaVersion !== "rolling-skill-episode/v1") {
            throw new Error("A valid frozen episode is required")
        }
        if (typeof episode.originalQuestion !== "string" || !episode.originalQuestion.trim()) {
            throw new Error("The episode must contain the original question")
        }
        const datasetQuestion = String(input.datasetQuestion ?? episode.originalQuestion)
        if (!datasetQuestion.trim()) throw new Error("The dataset question is required")
        if (datasetQuestion.length > 120_000) throw new Error("The dataset question is too large")
        if (JSON.stringify(episode).length > 1_500_000) {
            throw new Error("The selected episode is too large to curate locally")
        }
        const now = new Date().toISOString()
        const session = {
            id: randomUUID(),
            datasetId: input.datasetId,
            caseType: input.caseType,
            datasetQuestion,
            status: "queued",
            episode,
            skillReference: normalizeSkillReference(input.skillReference),
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
                          caseType: session.caseType,
                          sourceItemIds: session.episode.items.map((item) => item.id),
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
                caseType: session.caseType,
                sourceItemIds: session.episode.items.map((item) => item.id),
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
        requireDataset(state, session.datasetId)
        const draft = copy(
            validateCuratorDraft(session.draft, {
                caseType: session.caseType,
                sourceItemIds: session.episode.items.map((item) => item.id),
            }),
        )
        const now = new Date().toISOString()
        const latestRevision = session.revisions.at(-1)
        const entry = {
            id: randomUUID(),
            datasetId: session.datasetId,
            caseType: session.caseType,
            question: session.datasetQuestion ?? session.episode.originalQuestion,
            answer: formatCuratedAnswer(draft),
            curated: draft,
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
                skillConfirmedAt: session.skillReference?.confirmedAt ?? null,
            },
            evidence: {
                episodeSchemaVersion: session.episode.schemaVersion,
                toolActivity: copy(session.episode.toolActivity),
            },
            createdAt: now,
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
        const index = state.cases.findIndex(
            (entry) => entry.datasetId === datasetId && entry.id === caseId,
        )
        if (index < 0) throw new Error("Unknown Case")
        const [deleted] = state.cases.splice(index, 1)
        this.persist()
        return copy(deleted)
    }

    createEvaluationRun(input = {}) {
        const state = this.load()
        requireDataset(state, input.datasetId)
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
        const runtimeConfigurations = (input.runtimeConfigurations ?? []).map((configuration) => {
            const runtimeId = modelId(configuration.runtimeId, "Runtime id")
            const providerId = modelId(configuration.providerId, "Runtime provider id")
            const executablePath = skillIdentity(
                configuration.executablePath,
                "Runtime executable path",
            )
            if (!runtimeId || !providerId || !executablePath?.startsWith("/")) {
                throw new Error("Every evaluation runtime requires an id, provider, and executable")
            }
            return {
                runtimeId,
                providerId,
                displayName: modelId(configuration.displayName, "Runtime name") ?? providerId,
                version: modelId(configuration.version, "Runtime version"),
                executablePath,
                source: modelId(configuration.source, "Runtime source"),
                transport: modelId(configuration.transport, "Runtime transport"),
                capabilities: copy(configuration.capabilities ?? []),
                models: copy(configuration.models ?? []),
                efforts: copy(configuration.efforts ?? []),
                modelId: modelId(configuration.modelId, "Evaluation model id"),
                effort: reasoningEffort(configuration.effort, "Evaluation reasoning effort"),
            }
        })
        if (!runtimeConfigurations.length) throw new Error("At least one runtime is required")
        const duplicateRuntimes = new Set()
        for (const configuration of runtimeConfigurations) {
            if (duplicateRuntimes.has(configuration.runtimeId)) {
                throw new Error("Each runtime may only appear once in an evaluation")
            }
            duplicateRuntimes.add(configuration.runtimeId)
        }
        const dataset = state.datasets.find((entry) => entry.id === input.datasetId)
        const now = new Date().toISOString()
        const run = {
            id: randomUUID(),
            datasetId: input.datasetId,
            datasetSnapshot: copy(dataset),
            selectionMode: input.selectionMode,
            selectedCaseIds: caseSnapshots.map((entry) => entry.id),
            caseSnapshots: copy(caseSnapshots),
            skillReference: input.skillReference
                ? {
                      name: modelId(input.skillReference.name, "Skill name"),
                      path: skillIdentity(input.skillReference.path, "Skill path"),
                  }
                : null,
            activationMode: input.activationMode,
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
                    durationMs: null,
                    response: null,
                    error: null,
                    threadId: null,
                    turnId: null,
                    traceReference: null,
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
        if (patch.status !== undefined) {
            if (!EVALUATION_RESULT_STATUSES.has(patch.status)) {
                throw new Error("Invalid evaluation result status")
            }
            result.status = patch.status
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
