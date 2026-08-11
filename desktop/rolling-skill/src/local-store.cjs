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

const LOCAL_SCHEMA = "rolling-skill-local/v2"
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

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function modelId(value, label = "Model id") {
    const normalized = value === null || value === undefined ? null : String(value).trim()
    if (normalized && normalized.length > 200) throw new Error(`${label} is too long`)
    return normalized || null
}

function defaultSettings() {
    return {
        autoCapture: false,
        language: "zh-CN",
        theme: "codex-light",
        taskProfile: {runtimePolicy: "active", modelId: null},
        curatorProfile: {runtimePolicy: "active", modelId: null},
        autoCaptureProfile: {
            runtimePolicy: "active",
            modelId: null,
            datasetId: null,
            caseType: "goodcase",
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
    if (!state.settings.taskProfile) {
        state.settings.taskProfile = {runtimePolicy: "active", modelId: null}
        changed = true
    }
    if (!state.settings.curatorProfile) {
        state.settings.curatorProfile = {runtimePolicy: "active", modelId: null}
        changed = true
    }
    if (!state.settings.autoCaptureProfile) {
        state.settings.autoCaptureProfile = {
            runtimePolicy: "active",
            modelId: null,
            datasetId: null,
            caseType: "goodcase",
        }
        changed = true
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

class LocalEvaluationStore {
    constructor(path) {
        this.path = path
        this.state = null
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
        if (input.taskModelId !== undefined) {
            settings.taskProfile = {
                runtimePolicy: "active",
                modelId: modelId(input.taskModelId, "Task model id"),
            }
        }
        if (input.curatorModelId !== undefined) {
            settings.curatorProfile = {
                runtimePolicy: "active",
                modelId: modelId(input.curatorModelId, "Curator model id"),
            }
        }
        if (input.autoCapture !== undefined) settings.autoCapture = Boolean(input.autoCapture)
        const automatic = {...settings.autoCaptureProfile, runtimePolicy: "active"}
        if (input.autoCaptureModelId !== undefined) {
            automatic.modelId = modelId(input.autoCaptureModelId, "Automatic capture model id")
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
                .curationSessions.filter((entry) => entry.status !== "cancelled")
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
        if (JSON.stringify(episode).length > 1_500_000) {
            throw new Error("The selected episode is too large to curate locally")
        }
        const now = new Date().toISOString()
        const session = {
            id: randomUUID(),
            datasetId: input.datasetId,
            caseType: input.caseType,
            status: "queued",
            episode,
            curator: {
                runtimeId: input.curator?.runtimeId ?? null,
                modelProvider: input.curator?.modelProvider ?? null,
                modelId: input.curator?.modelId ?? null,
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
            question: session.episode.originalQuestion,
            answer: formatCuratedAnswer(draft),
            curated: draft,
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
                curatorPromptVersion: session.curator.promptVersion,
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
}

module.exports = {LOCAL_SCHEMA, LocalEvaluationStore, initialState, migrateState}
