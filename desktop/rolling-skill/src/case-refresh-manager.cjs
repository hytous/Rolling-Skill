const {buildEpisodeSnapshot} = require("./episode-curation.cjs")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function buildCaseRefreshPrompt(entry) {
    const baseline = {
        answer: entry.answer,
        curated: entry.curated ?? null,
        issueDescription: entry.issueDescription ?? "",
        source: entry.source ?? null,
        evidence: entry.evidence ?? null,
    }
    return `Re-execute the immutable evaluation question below with the current Skill and current
tools. The historical Case is guidance about intent and the prior successful or failed workflow
only. Do not copy historical values as current truth; query or derive current values again.

Use a read-only-first policy. Do not perform protected external writes such as deletion, migration,
ownership changes, purchases, or approval flows. If the question now requires one, stop and explain
what confirmation would be required instead of approving it automatically.

<immutable-evaluation-question>${entry.question}</immutable-evaluation-question>
<historical-case>${JSON.stringify(baseline)}</historical-case>`
}

function flattenedEnabledSkills(response) {
    return (response?.data ?? [])
        .flatMap((entry) => entry.skills ?? [])
        .filter((entry) => entry?.enabled !== false && entry?.name)
}

function currentSkillReference(bound, response, runtimeDescriptor = {}) {
    if (!bound?.name) throw new Error("Dataset Skill binding is required for Case refresh")
    if (bound.runtimeId && runtimeDescriptor.runtimeId && bound.runtimeId !== runtimeDescriptor.runtimeId) {
        throw new Error("The dataset Skill is unavailable in the current Runtime")
    }
    const candidate = flattenedEnabledSkills(response).find((entry) => {
        if (entry.name !== bound.name) return false
        if (bound.evidencePrecision === "name-only") return !entry.path
        return entry.path === bound.path
    })
    if (!candidate) throw new Error("The dataset Skill is unavailable in the current Runtime")
    return {
        ...copy(bound),
        ...copy(candidate),
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: bound.name,
        path: bound.evidencePrecision === "name-only" ? null : bound.path,
        runtimeId: runtimeDescriptor.runtimeId ?? bound.runtimeId ?? null,
    }
}

class CaseRefreshManager {
    constructor({
        store,
        curationManager,
        getRuntime,
        getRuntimeDescriptor = () => null,
        getCuratorRuntimeDescriptor = getRuntimeDescriptor,
        getTaskProfile = null,
        getCuratorProfile = null,
        resolveOperation = null,
    }) {
        this.store = store
        this.curationManager = curationManager
        this.getRuntime = getRuntime
        this.getRuntimeDescriptor = getRuntimeDescriptor
        this.getCuratorRuntimeDescriptor = getCuratorRuntimeDescriptor
        this.getTaskProfile = getTaskProfile ?? (() => this.store.read().settings.taskProfile)
        this.getCuratorProfile = getCuratorProfile ?? (() => this.store.read().settings.curatorProfile)
        this.resolveOperation = resolveOperation
        this.hidden = new Set()
    }

    hiddenThreadIds() {
        return new Set(this.hidden)
    }

    async createSession({datasetId, caseId}) {
        const dataset = this.store.getDataset(datasetId)
        const entry = this.store.listCases(dataset.id).find((candidate) => candidate.id === caseId)
        if (!entry) throw new Error("Unknown Case")
        const existing = this.store.listCurationSessions().find((session) =>
            session.operation === "refresh" &&
            session.targetCaseId === entry.id &&
            session.status !== "archived" &&
            session.status !== "cancelled",
        )
        if (existing) throw new Error("Case refresh is already in progress")

        const releaseDataset = this.store.reserveDataset(dataset.id)
        let runtime = null
        let internalThreadId = null
        try {
            runtime = await this.getRuntime()
            const runtimeDescriptor = this.getRuntimeDescriptor() ?? {}
            const operation = this.resolveOperation?.(dataset.id, runtimeDescriptor.runtimeId)
            const skillReference = operation?.executionSkillReference ?? currentSkillReference(
                dataset.skillReference,
                await runtime.listSkills({forceReload: true}),
                runtimeDescriptor,
            )
            const taskProfile = this.getTaskProfile() ?? {}
            const output = await runtime.runEvaluationCase({
                question: buildCaseRefreshPrompt(entry),
                activationMode: "explicit",
                skillReference,
                modelId: taskProfile.modelId ?? null,
                effort: taskProfile.effort ?? null,
                onThreadStarted: (threadId) => {
                    internalThreadId = threadId
                    this.hidden.add(threadId)
                },
            })
            internalThreadId = output.threadId ?? internalThreadId
            if (!internalThreadId) throw new Error("Case refresh Runtime did not return a task id")
            this.hidden.add(internalThreadId)
            const response = await runtime.readThread(internalThreadId)
            const episode = buildEpisodeSnapshot(response.thread, {
                endTurnId: output.turnId,
                endMessagePosition: "last",
                runtimeId: runtimeDescriptor.runtimeId ?? null,
                modelId: taskProfile.modelId ?? response.thread.model ?? null,
                traceReference: output.traceReference ?? null,
                originalQuestionOverride: entry.question,
            })
            const curatorProfile = this.getCuratorProfile() ?? {}
            return await this.curationManager.createRefreshSession({
                datasetId: dataset.id,
                caseId: entry.id,
                episode,
                runtimeId: this.getCuratorRuntimeDescriptor()?.runtimeId,
                executionSkillReference: operation?.executionSkillReference,
                operationEvidence: operation?.operationEvidence,
                modelId: curatorProfile.modelId ?? null,
                effort: curatorProfile.effort ?? null,
            })
        } finally {
            if (runtime && internalThreadId && typeof runtime.archiveThread === "function") {
                try {
                    await runtime.archiveThread(internalThreadId)
                } catch {
                    // Hidden identity remains authoritative if the Runtime cannot archive its internal task.
                }
            }
            releaseDataset()
        }
    }
}

module.exports = {
    CaseRefreshManager,
    buildCaseRefreshPrompt,
    currentSkillReference,
}
