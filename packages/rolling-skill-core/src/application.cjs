const {Buffer} = require("node:buffer")
const {basename, join, resolve} = require("node:path")

const {
    AutomaticCaptureStateStore,
} = require("../../../desktop/rolling-skill/src/automatic-capture-state-store.cjs")
const {
    LocalEvaluationStore,
} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {
    ManagedSkillStore,
} = require("../../../desktop/rolling-skill/src/managed-skill-store.cjs")
const {
    ManagedSkillManager,
} = require("../../../desktop/rolling-skill/src/managed-skill-manager.cjs")
const {
    SkillEditStore,
} = require("../../../desktop/rolling-skill/src/skill-edit-store.cjs")
const {
    SkillEditWorkspaceManager,
} = require("../../../desktop/rolling-skill/src/skill-edit-workspace.cjs")
const {
    RawCaseStore,
} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")
const {
    AutomaticCaptureEvidenceStore,
} = require("../../../desktop/rolling-skill/src/automatic-capture-evidence-store.cjs")
const {
    buildEpisodeSnapshot,
} = require("../../../desktop/rolling-skill/src/episode-curation.cjs")
const {
    CaseRecycleService,
} = require("../../../desktop/rolling-skill/src/case-recycle-service.cjs")
const {
    CaseRefreshManager,
} = require("../../../desktop/rolling-skill/src/case-refresh-manager.cjs")
const {
    CurationManager,
} = require("../../../desktop/rolling-skill/src/curation-manager.cjs")
const {
    RubricManager,
} = require("../../../desktop/rolling-skill/src/rubric-manager.cjs")
const {
    snapshotSkillEvidence,
} = require("../../../desktop/rolling-skill/src/evaluation-skill-evidence.cjs")
const {
    EvaluationRunner,
} = require("../../../desktop/rolling-skill/src/evaluation-runner.cjs")
const {
    resolveExecutionPolicy,
    resolveRuntimePermission,
} = require("../../../desktop/rolling-skill/src/execution-policy.cjs")
const {
    SkillInstallationManager,
} = require("../../../desktop/rolling-skill/src/skill-installation-manager.cjs")
const {
    SkillInstallationStore,
} = require("../../../desktop/rolling-skill/src/skill-installation-store.cjs")
const {createCaseServices} = require("./case-services.cjs")
const {createAutomaticCaptureService} = require("./automatic-capture-service.cjs")
const {RollingSkillConfigStore} = require("./config-store.cjs")
const {
    createCurationOperationEvidenceResolver,
} = require("./curation-operation-evidence.cjs")
const {ensureDataLayout, resolveDataPaths} = require("./data-root.cjs")
const {createEvaluationServices} = require("./evaluation-services.cjs")
const {
    detectLegacyElectronDataRoot,
    importLegacyData,
    inspectLegacyImport,
} = require("./legacy-import.cjs")
const {createOperatorRuntime} = require("./operator-services.cjs")
const {createRuntimeServices} = require("./runtime-services.cjs")
const {RuntimeInteractionBroker} = require("./runtime-interaction-broker.cjs")
const {createSkillEditServices} = require("./skill-edit-services.cjs")
const {createSkillServices} = require("./skill-services.cjs")

const MAX_DISPATCH_BYTES = 1024 * 1024

function assertPlainJson(value, ancestors = new Set()) {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    ) return
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Rolling Skill input must be plain JSON")
        return
    }
    if (typeof value !== "object") {
        throw new Error("Rolling Skill input must be plain JSON")
    }
    if (ancestors.has(value)) throw new Error("Rolling Skill input must be plain JSON")

    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new Error("Rolling Skill input must be plain JSON")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error("Rolling Skill input must be plain JSON")
    }

    ancestors.add(value)
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
                ancestors.delete(value)
                throw new Error("Rolling Skill input must be plain JSON")
            }
            assertPlainJson(value[index], ancestors)
        }
    } else {
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if (!descriptor.enumerable || !("value" in descriptor)) {
                ancestors.delete(value)
                throw new Error("Rolling Skill input must be plain JSON")
            }
            assertPlainJson(descriptor.value, ancestors)
        }
    }
    ancestors.delete(value)
}

function jsonCopy(value) {
    return JSON.parse(JSON.stringify(value))
}

function checkedInput(method, input) {
    assertPlainJson(input)
    const serialized = JSON.stringify({method, input})
    if (Buffer.byteLength(serialized, "utf8") > MAX_DISPATCH_BYTES) {
        throw new Error("Rolling Skill request must not exceed 1 MiB")
    }
    return JSON.parse(JSON.stringify(input))
}

function requiredIdentifier(value, label) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > 200) throw new Error(`${label} is required`)
    return normalized
}

function requiredBodyText(value, label, maxLength = 120_000) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) throw new Error(`${label} is required`)
    if (value.length > maxLength) throw new Error(`${label} is too large`)
    return value
}

function optionalBodyText(value, label, maxLength = 120_000) {
    if (value === null || value === undefined) return ""
    if (typeof value !== "string") throw new Error(`${label} must be text`)
    if (value.length > maxLength) throw new Error(`${label} is too large`)
    return value.trim()
}

function exactFields(input, allowed, label) {
    const unsupported = Object.keys(input).find((field) => !allowed.has(field))
    if (unsupported) throw new Error(`Unsupported ${label} field: ${unsupported}`)
}

function requiredSequence(value, label) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
    return value
}

function publicConversationCuration(session) {
    const source = session?.episode?.source ?? {}
    return {
        id: session.id,
        datasetId: session.datasetId,
        caseType: session.caseType,
        status: session.status,
        caseId: session.caseId ?? null,
        sessionId: source.sessionId ?? null,
        startSeq: source.startSeq ?? null,
        endSeq: source.endSeq ?? null,
        endMessageId: source.endMessageId ?? null,
        digest: source.digest ?? null,
    }
}

function boundedText(value, limit = 20_000) {
    const text = String(value ?? "")
    return text.length <= limit ? text : `${text.slice(0, limit)}\n…[truncated]`
}

function boundedDetail(value, limit = 20_000) {
    if (value === undefined || value === null) return null
    if (typeof value === "string") return boundedText(value, limit)
    try {
        return boundedText(JSON.stringify(value, null, 2), limit)
    } catch {
        return "[unserializable]"
    }
}

function publicSkillReference(reference) {
    if (!reference) return null
    return {
        schemaVersion: reference.schemaVersion ?? null,
        evidencePrecision: reference.evidencePrecision ?? null,
        id: reference.id ?? null,
        repositoryId: reference.repositoryId ?? null,
        name: reference.name ?? null,
        scope: reference.scope ?? null,
        description: reference.description ?? null,
        runtimeId: reference.runtimeId ?? null,
        providerId: reference.providerId ?? null,
        confirmedAt: reference.confirmedAt ?? null,
    }
}

function publicDataset(dataset) {
    if (!dataset) return null
    return {
        ...dataset,
        skillReference: publicSkillReference(dataset.skillReference),
    }
}

function publicRawCase(record) {
    if (!record) return null
    return {
        ...record,
        skill: record.skill ? {
            ...(record.skill.id ? {id: record.skill.id} : {}),
            name: record.skill.name,
        } : null,
    }
}

function publicOperationEvidence(evidence) {
    if (!evidence) return null
    return {
        schemaVersion: evidence.schemaVersion ?? null,
        kind: evidence.kind ?? null,
        repositoryId: evidence.repositoryId ?? null,
        skillId: evidence.skillId ?? null,
        skillName: evidence.skillName ?? null,
        versionId: evidence.versionId ?? null,
        versionLabel: evidence.versionLabel ?? null,
        commit: evidence.commit ?? null,
        contentDigest: evidence.contentDigest ?? null,
        rubricVersionId: evidence.rubricVersionId ?? null,
        runtime: evidence.runtime ? {
            runtimeId: evidence.runtime.runtimeId ?? null,
            providerId: evidence.runtime.providerId ?? null,
            displayName: evidence.runtime.displayName ?? null,
            version: evidence.runtime.version ?? null,
        } : null,
        installation: evidence.installation ? {
            installationId: evidence.installation.installationId ?? null,
            jobId: evidence.installation.jobId ?? null,
            verification: evidence.installation.verification ?? null,
            installedAt: evidence.installation.installedAt ?? null,
            marker: evidence.installation.marker ?? null,
        } : null,
        sourceSkill: evidence.sourceSkill ? {
            name: evidence.sourceSkill.name ?? null,
            provider: evidence.sourceSkill.provider ?? null,
            resourceKind: evidence.sourceSkill.resourceBase?.kind ?? null,
            callSeq: evidence.sourceSkill.callSeq ?? null,
            resultSeq: evidence.sourceSkill.resultSeq ?? null,
        } : null,
    }
}

function publicEpisode(episode, {itemLimit = 250} = {}) {
    if (!episode) return null
    const source = episode.source ?? {}
    return {
        schemaVersion: episode.schemaVersion ?? null,
        id: episode.id ?? null,
        originalQuestion: boundedText(episode.originalQuestion, 120_000),
        capturedAt: episode.capturedAt ?? null,
        source: {
            kind: source.kind ?? null,
            sessionId: source.sessionId ?? null,
            startSeq: source.startSeq ?? null,
            endSeq: source.endSeq ?? null,
            endMessageId: source.endMessageId ?? null,
            digest: source.digest ?? null,
            observedSkills: Array.isArray(source.observedSkills)
                ? source.observedSkills.map((entry) => ({
                    name: entry.name ?? null,
                    provider: entry.provider ?? null,
                    resourceKind: entry.resourceBase?.kind ?? null,
                    callSeq: entry.callSeq ?? null,
                    resultSeq: entry.resultSeq ?? null,
                }))
                : [],
        },
        items: Array.isArray(episode.items) ? (itemLimit === null
            ? episode.items
            : episode.items.slice(0, itemLimit)).map((item) => ({
            id: item.id ?? null,
            type: item.type ?? null,
            role: item.role ?? null,
            text: boundedText(item.text ?? item.summary),
            ...(item.source?.kind ? {sourceKind: item.source.kind} : {}),
            turnId: item.turnId ?? null,
            seq: item.seq ?? null,
            toolName: item.toolName ?? item.tool ?? item.name ?? null,
            status: item.status ?? null,
            arguments: boundedDetail(item.arguments ?? item.command),
            result: boundedDetail(item.result ?? item.output),
            error: boundedDetail(item.error),
            usage: item.usage ?? null,
        })) : [],
    }
}

function publicConversationMessages(messages) {
    return Array.isArray(messages) ? messages.slice(-100).map((message) => ({
        id: message.id ?? null,
        role: message.role ?? null,
        text: boundedText(message.text),
        turnId: message.turnId ?? null,
        createdAt: message.createdAt ?? null,
    })) : []
}

function publicCurationSession(session) {
    return {
        id: session.id,
        datasetId: session.datasetId,
        operation: session.operation ?? "curation",
        targetCaseId: session.targetCaseId ?? null,
        caseType: session.caseType,
        issueDescription: boundedText(session.issueDescription, 120_000),
        status: session.status,
        caseId: session.caseId ?? null,
        skillReference: publicSkillReference(session.skillReference),
        episode: publicEpisode(session.episode),
        operationEvidence: publicOperationEvidence(session.operationEvidence),
        rubricVersionSnapshot: publicRubricVersion(session.rubricVersionSnapshot),
        curator: session.curator ? {
            runtimeId: session.curator.runtimeId ?? null,
            modelProvider: session.curator.modelProvider ?? null,
            modelId: session.curator.modelId ?? null,
            effort: session.curator.effort ?? null,
            effectiveModelId: session.curator.effectiveModelId ?? null,
            effectiveEffort: session.curator.effectiveEffort ?? null,
            working: Boolean(session.curator.currentTurnId),
        } : null,
        conversation: publicConversationMessages(session.conversation),
        revisions: Array.isArray(session.revisions) ? session.revisions.map((entry) => ({
            id: entry.id,
            draft: entry.draft,
            turnId: entry.turnId ?? null,
            createdAt: entry.createdAt ?? null,
        })) : [],
        draft: session.draft ?? null,
        error: session.error ?? null,
        createdAt: session.createdAt ?? null,
        updatedAt: session.updatedAt ?? null,
        revision: session.updatedAt ?? null,
    }
}

function publicRubricSession(session) {
    return {
        id: session.id,
        datasetId: session.datasetId,
        baseVersionId: session.baseVersionId ?? null,
        publishedVersionId: session.publishedVersionId ?? null,
        status: session.status,
        skillReference: publicSkillReference(session.skillReference),
        operationEvidence: publicOperationEvidence(session.operationEvidence),
        skillEvidence: session.skillEvidence ? {
            schemaVersion: session.skillEvidence.schemaVersion,
            name: session.skillEvidence.name,
            digest: session.skillEvidence.digest,
            truncated: session.skillEvidence.truncated,
            warnings: session.skillEvidence.warnings,
            files: session.skillEvidence.files?.map((file) => ({
                id: file.id,
                path: file.path,
                bytes: file.bytes,
                digest: file.digest,
            })) ?? [],
        } : null,
        rubricAgent: session.rubricAgent ? {
            runtimeId: session.rubricAgent.runtimeId ?? null,
            modelProvider: session.rubricAgent.modelProvider ?? null,
            modelId: session.rubricAgent.modelId ?? null,
            effort: session.rubricAgent.effort ?? null,
            effectiveModelId: session.rubricAgent.effectiveModelId ?? null,
            effectiveEffort: session.rubricAgent.effectiveEffort ?? null,
            working: Boolean(session.rubricAgent.currentTurnId),
        } : null,
        conversation: publicConversationMessages(session.conversation),
        revisions: Array.isArray(session.revisions) ? session.revisions.map((entry) => ({
            id: entry.id,
            rubric: entry.rubric,
            rubricDigest: entry.rubricDigest,
            turnId: entry.turnId ?? null,
            createdAt: entry.createdAt ?? null,
        })) : [],
        draft: session.draft ?? null,
        error: session.error ?? null,
        createdAt: session.createdAt ?? null,
        updatedAt: session.updatedAt ?? null,
        revision: session.updatedAt ?? null,
    }
}

function publicRubricVersion(version) {
    if (!version) return null
    return {
        id: version.id,
        datasetId: version.datasetId,
        version: version.version,
        rubric: version.rubric,
        rubricDigest: version.rubricDigest,
        skillReference: publicSkillReference(version.skillReference),
        skillEvidenceDigest: version.skillEvidenceDigest ?? null,
        operationEvidence: publicOperationEvidence(version.operationEvidence),
        sourceSessionId: version.sourceSessionId ?? null,
        createdAt: version.createdAt ?? null,
        updatedAt: version.updatedAt ?? null,
    }
}

function managedSkillReference(repository, skill, confirmedAt = new Date().toISOString()) {
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        evidencePrecision: "managed",
        id: skill.id,
        repositoryId: repository.id,
        name: skill.name,
        path: null,
        scope: "managed",
        description: skill.description ?? null,
        runtimeId: null,
        providerId: null,
        confirmedAt,
    }
}

function managedDatasetSkillReference(managedSkillStore, input = {}) {
    const allowed = new Set(["name", "repositoryId", "skillId"])
    const unsupported = Object.keys(input).find((field) => !allowed.has(field))
    if (unsupported) throw new Error(`Unsupported Dataset field: ${unsupported}`)
    const repositoryId = requiredIdentifier(input.repositoryId, "Dataset Skill repository id")
    const skillId = requiredIdentifier(input.skillId, "Dataset Skill id")
    const repository = managedSkillStore.getRepository(repositoryId)
    const skill = managedSkillStore.getSkill(skillId)
    if (skill.repositoryId !== repository.id) {
        throw new Error("Dataset Skill repository does not match the managed Skill")
    }
    return managedSkillReference(repository, skill)
}

function managedRawCaseSkill(managedSkillStore, input = {}) {
    const repositoryId = requiredIdentifier(input.repositoryId, "Raw Case Skill repository id")
    const skillId = requiredIdentifier(input.skillId, "Raw Case Skill id")
    const repository = managedSkillStore.getRepository(repositoryId)
    const skill = managedSkillStore.getSkill(skillId)
    if (skill.repositoryId !== repository.id) {
        throw new Error("Raw Case Skill repository does not match the managed Skill")
    }
    if (skill.status !== "valid") throw new Error("Raw Case Skill is not valid")
    return {id: skill.id, name: skill.name}
}

function automaticRawCaseObservation(record) {
    const observations = Array.isArray(record?.source?.observations)
        ? record.source.observations
        : record?.source?.kind === "automatic_capture"
            ? [record.source]
            : []
    return observations.at(-1) ?? null
}

function reconcileManagedDatasetBindings({store, managedSkillStore, installationStore}) {
    let migrated = 0
    let skipped = 0
    for (const dataset of store.listDatasets()) {
        const legacy = dataset.skillReference
        if (!legacy || legacy.evidencePrecision === "managed" || !legacy.path) {
            skipped += 1
            continue
        }
        try {
            const installation = legacy.repositoryId && legacy.id
                ? {
                    repositoryId: legacy.repositoryId,
                    skillId: legacy.id,
                    installedAt: legacy.confirmedAt ?? new Date().toISOString(),
                }
                : installationStore.resolveManagedInstallationForLegacyReference(legacy)
            if (!installation) {
                skipped += 1
                continue
            }
            const repository = managedSkillStore.getRepository(installation.repositoryId)
            const skill = managedSkillStore.getSkill(installation.skillId)
            if (skill.repositoryId !== repository.id) {
                skipped += 1
                continue
            }
            store.migrateDatasetSkillReference(dataset.id, {
                expectedLegacyReference: legacy,
                managedSkillReference: managedSkillReference(
                    repository,
                    skill,
                    installation.installedAt ?? legacy.confirmedAt ?? new Date().toISOString(),
                ),
            })
            migrated += 1
        } catch {
            skipped += 1
        }
    }
    return {migrated, skipped}
}

function workerOperatorRuntime() {
    const unavailable = () => {
        throw new Error("Operator and Optimization services are unavailable in Worker mode")
    }
    const services = {
        operatorSummary: () => ({
            generation: null,
            revision: 0,
            sessions: [],
            jobs: [],
            steps: [],
            approvals: [],
            totals: {sessions: 0, jobs: 0, steps: 0, approvals: 0},
            truncated: false,
            nextCursor: null,
        }),
        optimizationList: () => [],
    }
    for (const method of [
        "operatorGet",
        "operatorStart",
        "operatorPause",
        "operatorResume",
        "operatorCancel",
        "operatorApprove",
        "operatorArtifacts",
        "operatorArtifact",
        "operatorSend",
        "optimizationGet",
        "optimizationPreflight",
        "optimizationStart",
        "optimizationPause",
        "optimizationResume",
        "optimizationCancel",
        "optimizationReport",
    ]) services[method] = unavailable
    return Object.freeze({services: Object.freeze(services), close: async () => {}})
}

function runtimeSkillMatchesVerifiedInstallation({
    runtimeSkill,
    managedSkillName,
    installedManifest,
    allowNameOnly = false,
}) {
    if (runtimeSkill?.enabled === false || runtimeSkill?.name !== managedSkillName) return false
    if (typeof runtimeSkill.path === "string") {
        return resolve(runtimeSkill.path) === resolve(installedManifest)
    }
    return allowNameOnly && runtimeSkill?.evidencePrecision === "name-only"
}

function evaluationRuntimeThreadIds(state) {
    const ids = new Set()
    for (const run of state?.evaluationRuns ?? []) {
        for (const result of run?.results ?? []) {
            if (typeof result?.threadId === "string" && result.threadId) ids.add(result.threadId)
            if (typeof result?.judge?.threadId === "string" && result.judge.threadId) {
                ids.add(result.judge.threadId)
            }
        }
    }
    return ids
}

function installationRuntimeThreadIds(installationStore) {
    const ids = new Set()
    for (const job of installationStore?.listJobs?.() ?? []) {
        if (typeof job?.threadId === "string" && job.threadId) ids.add(job.threadId)
    }
    return ids
}

function createDeferredInstallationManager(resolveManager, installationStore) {
    const requireManager = () => {
        const manager = resolveManager()
        if (!manager) throw new Error("Skill installation is unavailable in this application mode")
        return manager
    }
    const call = (method, args) => {
        const manager = requireManager()
        if (typeof manager[method] !== "function") {
            throw new Error(`Skill installation ${method} is unavailable`)
        }
        return manager[method](...args)
    }
    return Object.freeze({
        get store() {
            return resolveManager()?.store ?? installationStore
        },
        overview(skillId = null) {
            const manager = resolveManager()
            if (manager) return call("overview", [skillId])
            const jobs = installationStore.listJobs(skillId ? {skillId} : {})
            return {
                jobs,
                matrix: skillId ? installationStore.installationMatrix(skillId) : [],
            }
        },
        start: (...args) => call("start", args),
        startOptimizationExperiment: (...args) => call("startOptimizationExperiment", args),
        cancel: (...args) => call("cancel", args),
        inspect: (...args) => call("inspect", args),
        send: (...args) => call("send", args),
        wait: (...args) => call("wait", args),
        stopAll: (...args) => {
            const manager = resolveManager()
            return manager?.stopAll?.(...args)
        },
    })
}

function createRollingSkillApplication(options = {}) {
    const paths = ensureDataLayout(resolveDataPaths(options))
    const legacySourceRoot = options.legacySourceRoot ?? detectLegacyElectronDataRoot()
    const store = new LocalEvaluationStore(paths.evaluationStore)
    const rawCaseStore = new RawCaseStore(paths.rawCaseEvents)
    const automaticEvidenceStore = new AutomaticCaptureEvidenceStore(paths.rawCaseEvidence)
    const automaticCaptureStateStore = options.automaticCaptureStateStore ?? new AutomaticCaptureStateStore(
        paths.automaticCaptureState,
    )
    const managedSkillStore = new ManagedSkillStore(paths.managedSkillRegistry)
    const configStore = new RollingSkillConfigStore(paths.config)
    const runtimeInteractionBroker = options.runtimeInteractionBroker ?? new RuntimeInteractionBroker({
        onChanged: () => publish(),
    })
    const requestRuntimePermission = options.requestRuntimePermission ?? (
        (request) => runtimeInteractionBroker.requestPermission(request)
    )
    const requestRuntimeQuestion = options.requestRuntimeQuestion ?? (
        (request) => runtimeInteractionBroker.requestQuestion(request)
    )
    let automaticCaptureService = null
    let routeRuntimeNotification = () => {}
    const workspaceRoot = options.workspaceRoot ?? process.cwd()
    const runtimeServices = createRuntimeServices({
        registry: options.runtimeRegistry,
        configStore,
        workspaceRoot,
        traceDirectory: paths.traces,
        onNotification: (message) => routeRuntimeNotification(message),
    })
    const managedSkillManager = new ManagedSkillManager({
        applicationSupportDirectory: paths.managedSkills,
        store: managedSkillStore,
    })
    const skillEditStore = new SkillEditStore(paths.skillEdits)
    const skillEditWorkspaceManager = new SkillEditWorkspaceManager({
        workspacesRoot: paths.skillEditWorkspaces,
    })
    const installationStore = new SkillInstallationStore(paths.skillInstallations)
    reconcileManagedDatasetBindings({store, managedSkillStore, installationStore})
    let installationManager = options.installationManager ?? null
    const deferredInstallationManager = createDeferredInstallationManager(
        () => installationManager,
        installationStore,
    )
    const selectedRuntimeId = () => configStore.read().runtime?.runtimeId ?? null
    const selectedRuntimeDescriptor = (runtimeId = selectedRuntimeId()) => {
        return runtimeId ? runtimeServices.descriptor(runtimeId) : null
    }
    const getSelectedRuntime = (runtimeId = selectedRuntimeId()) => {
        runtimeId ??= selectedRuntimeId()
        if (!runtimeId) throw new Error("Select a Runtime before starting an Agent task")
        return runtimeServices.getClient(runtimeId, {nonInteractive: false})
    }
    const curationManager = options.curationManager ?? new CurationManager({
        store,
        getRuntime: getSelectedRuntime,
        getRuntimeDescriptor: selectedRuntimeDescriptor,
        onChanged: (session) => {
            void automaticCaptureService?.handleCurationChanged(session)
            publish()
        },
    })
    const managedOperationResolver = createCurationOperationEvidenceResolver({
            store,
            configStore,
            runtimeServices,
            managedSkillStore,
            installationStore,
        })
    const conversationCurationOperationResolver =
        options.conversationCurationOperationResolver ?? managedOperationResolver
    const rubricManager = options.rubricManager ?? new RubricManager({
        store,
        getRuntime: getSelectedRuntime,
        getRuntimeDescriptor: selectedRuntimeDescriptor,
        onChanged: () => publish(),
    })
    routeRuntimeNotification = (message) => {
        if (typeof curationManager.handleNotification === "function") {
            void curationManager.handleNotification(message)
        }
        if (typeof rubricManager.handleNotification === "function") {
            void rubricManager.handleNotification(message)
        }
        if (typeof automaticCaptureService?.handleNotification === "function") {
            void automaticCaptureService.handleNotification(message)
        }
    }
    const automaticCurationManager = Object.freeze({
        async createSession(input) {
            const sourceRuntimeId = input.episode?.source?.runtimeId ??
                configStore.read().captureRuntime?.runtimeId ?? selectedRuntimeId()
            const operation = conversationCurationOperationResolver.resolve(input.datasetId, {
                runtimeId: sourceRuntimeId,
                ...(input.episode?.source?.kind === "dsh-session" ? {sourceProviderId: "deepseek-harness"} : {}),
            })
            const request = {
                ...input,
                executionSkillReference: operation.executionSkillReference,
                operationEvidence: operation.operationEvidence,
            }
            if (
                input.episode?.source?.kind === "dsh-session" &&
                input.source?.kind === "dsh-session" &&
                typeof curationManager.createSessionFromFrozenEpisode === "function"
            ) {
                return curationManager.createSessionFromFrozenEpisode({
                    ...request,
                    idempotencyKey:
                        input.idempotencyKey ??
                        `automatic:${input.datasetId}:${input.source.digest}`,
                    curator: {
                        modelId: input.modelId ?? null,
                        effort: input.effort ?? null,
                    },
                })
            }
            if (input.episode) {
                return curationManager.createEpisodeSession({
                    ...request,
                    curator: {modelId: input.modelId ?? null, effort: input.effort ?? null},
                })
            }
            return curationManager.createSession(request)
        },
        archive: (sessionId) => curationManager.archive(sessionId),
        hiddenThreadIds: () => curationManager.hiddenThreadIds(),
        listSessions: (options) => typeof curationManager.listSessions === "function"
            ? curationManager.listSessions(options)
            : store.listCurationSessions(),
        retry: (sessionId) => curationManager.retry(sessionId),
    })
    automaticCaptureService = createAutomaticCaptureService({
        store,
        configStore,
        runtimeServices,
        stateStore: automaticCaptureStateStore,
        signal: options.signal ?? null,
        rawCaseStore,
        curationManager: automaticCurationManager,
        captureEpisode: async (input) => {
            if (typeof options.conversationEpisodeSource?.capture === "function") {
                return options.conversationEpisodeSource.capture(input)
            }
            const sourceRuntimeId = configStore.read().captureRuntime?.runtimeId ?? selectedRuntimeId()
            const runtime = await runtimeServices.getClient(sourceRuntimeId, {nonInteractive: true})
            if (typeof runtime.captureConversationEpisode !== "function") {
                throw new Error("Automatic capture trusted DSH episode source is unavailable")
            }
            return runtime.captureConversationEpisode(input)
        },
        saveEvidence: (episode) => automaticEvidenceStore.save(episode),
        listSkills: async () => {
            const sourceRuntimeId = configStore.read().captureRuntime?.runtimeId ?? selectedRuntimeId()
            if (!sourceRuntimeId) return []
            const descriptor = runtimeServices.descriptor(sourceRuntimeId)
            const verified = installationStore.listVerifiedInstallations({
                runtimeId: descriptor.runtimeId,
                providerId: descriptor.providerId,
            })
            const matched = []
            const seen = new Set()
            for (const installation of verified) {
                const skill = managedSkillStore.getSkill(installation.skillId)
                if (seen.has(skill.id) || skill.status !== "valid") continue
                seen.add(skill.id)
                matched.push({id: skill.id, name: skill.name})
            }
            return matched
        },
        listDatasets: () => store.listDatasets(),
        getHiddenThreadIds: () => new Set([
            ...curationManager.hiddenThreadIds(),
            ...rubricManager.hiddenThreadIds(),
            ...evaluationRuntimeThreadIds(store.read()),
            ...installationRuntimeThreadIds(installationStore),
        ]),
        onChanged: () => publish(),
    })
    const refreshManager = options.caseRefreshManager ?? {
        async createSession({runtimeId, datasetId, caseId}) {
            const selectedRuntimeId = runtimeId ?? configStore.read().runtime?.runtimeId
            if (!selectedRuntimeId) throw new Error("Select a Runtime before refreshing Cases")
            const descriptor = runtimeServices.descriptor(selectedRuntimeId)
            const getRuntime = () => runtimeServices.getClient(selectedRuntimeId, {
                nonInteractive: false,
            })
            const manager = new CaseRefreshManager({
                store,
                curationManager,
                getRuntime,
                getRuntimeDescriptor: () => descriptor,
                getCuratorRuntimeDescriptor: () => selectedRuntimeDescriptor(),
                resolveOperation: (id, runtimeId) => managedOperationResolver.resolve(id, {
                    runtimeId,
                    requireRubric: false,
                }),
            })
            return manager.createSession({datasetId, caseId})
        },
    }
    const recycleService = new CaseRecycleService({store, rawCaseStore})
    const caseServices = createCaseServices({
        store,
        rawCaseStore,
        recycleService,
        refreshManager,
        dispatchRawCase: options.rawCaseDispatcher ?? null,
    })
    const evaluationRunner = options.evaluationRunner ?? new EvaluationRunner({
        store,
        runtimeRegistry: {
            createClient: (descriptor, clientOptions) =>
                runtimeServices.createClient(descriptor.runtimeId, clientOptions),
        },
        workspaceRoot,
        traceDirectory: join(paths.traces, "evaluations"),
        getExecutionPolicy: () => resolveExecutionPolicy(store.read().settings),
        onChanged: () => publish(),
    })
    const evaluationServices = createEvaluationServices({
        store,
        runtimeServices,
        runner: evaluationRunner,
        managedSkillStore,
        managedSkillManager,
        installationStore,
        onChanged: () => publish(),
        ...(options.snapshotManagedSkill
            ? {snapshotManagedSkill: options.snapshotManagedSkill}
            : {}),
    })
    const operatorRuntime = options.operatorRuntime ?? (options.workerMode
        ? workerOperatorRuntime()
        : createOperatorRuntime({
        paths,
        store,
        rawCaseStore,
        managedSkillStore,
        managedSkillManager,
        installationStore,
        installationManager: deferredInstallationManager,
        runtimeServices,
        evaluationRunner,
        evaluationServices,
        curationManager,
        rubricManager,
        workspaceRoot,
        requestPermission: requestRuntimePermission,
        requestQuestion: requestRuntimeQuestion,
        operatorToolPath: options.operatorToolPath ?? null,
        resolveSkillEditWorkspace: (binding) => {
            const edit = skillEditStore.require(binding.skillEditSessionId)
            if (
                edit.repositoryId !== binding.repositoryId ||
                edit.skillId !== binding.skillId ||
                ["published", "discarded", "failed"].includes(edit.state)
            ) throw new Error("Skill edit workspace does not match an active edit session")
            return {
                repositoryId: edit.repositoryId,
                skillId: edit.skillId,
                skillEditSessionId: edit.id,
                workspaceRoot: skillEditWorkspaceManager.resolve(edit.id),
            }
        },
        onChanged: () => publish(),
        }))
    if (
        !installationManager &&
        !options.workerMode &&
        typeof operatorRuntime.controlPlane?.invoke === "function" &&
        typeof operatorRuntime.controlPlane?.registerInstallationExecutor === "function" &&
        typeof operatorRuntime.controlCapabilities?.issue === "function" &&
        typeof operatorRuntime.controlCapabilities?.revoke === "function" &&
        typeof operatorRuntime.controlSocketPath === "string"
    ) {
        const installationToolPath = options.installationToolPath ?? options.operatorToolPath ?? null
        installationManager = new SkillInstallationManager({
            store: installationStore,
            managedSkillStore,
            managedSkillManager,
            runtimeRegistry: {
                createClient: (descriptor, clientOptions) =>
                    runtimeServices.createClient(descriptor.runtimeId, clientOptions),
            },
            getRuntimes: () => runtimeServices.list(),
            workspaceRoot,
            traceDirectory: join(paths.traces, "skill-installations"),
            controlPlane: operatorRuntime.controlPlane,
            capabilities: operatorRuntime.controlCapabilities,
            controlSocketPath: operatorRuntime.controlSocketPath,
            installationToolPath,
            transportSupport: (runtime) => ({
                dynamicToolsReady: runtime?.providerId === "codex",
                mcpServersReady: runtime?.providerId === "codebuddy" && Boolean(installationToolPath),
                dshMcpReady: runtime?.providerId === "deepseek-harness" && Boolean(installationToolPath),
            }),
            resolvePermission: (providerId, permissionMode) =>
                resolveRuntimePermission(providerId, permissionMode, store.read().settings),
            requestPermission: requestRuntimePermission,
            requestQuestion: requestRuntimeQuestion,
            onChanged: () => publish(),
        })
    }
    const skillServices = createSkillServices({
        manager: managedSkillManager,
        installationManager: deferredInstallationManager,
        installationStore,
        runtimeServices,
        revealPath: options.revealPath ?? null,
    })
    const operatorServices = operatorRuntime.services
    const skillEditServices = createSkillEditServices({
        store: skillEditStore,
        workspaceManager: skillEditWorkspaceManager,
        managedSkillManager,
        operatorServices,
    })
    const schedulerAdapter = options.schedulerAdapter ?? Object.freeze({
        capabilities: () => ({platform: process.platform, supported: false}),
        status: async () => ({platform: process.platform, supported: false, installed: false}),
        install: async () => { throw new Error("System scheduling is unavailable") },
        uninstall: async () => { throw new Error("System scheduling is unavailable") },
    })
    const subscribers = new Set()
    const conversationCreates = new Map()
    const reviewMutationResults = new Map()
    let closed = false

    async function schedulerStatus() {
        const capabilities = schedulerAdapter.capabilities()
        try {
            const actual = await schedulerAdapter.status()
            return {...capabilities, ...actual, worker: configStore.read().worker}
        } catch (error) {
            return {
                ...capabilities,
                installed: false,
                error: String(error?.message ?? error).slice(0, 2_000),
                worker: configStore.read().worker,
            }
        }
    }

    async function enableScheduler() {
        const profile = store.read().settings.autoCaptureProfile
        const plugin = configStore.read()
        const capabilities = schedulerAdapter.capabilities()
        if (profile.mode === "off") throw new Error("Enable automatic capture before installing its scheduler")
        if (plugin.executionLocation !== "always") throw new Error("Select always-on execution before installing its scheduler")
        if (!(plugin.captureRuntime ?? plugin.runtime) || !(plugin.detectionRuntime ?? plugin.runtime)) {
            throw new Error("Select a Runtime before installing the automatic capture scheduler")
        }
        if (!capabilities.supported) throw new Error("System scheduling is unavailable on this platform")
        try {
            await schedulerAdapter.install(profile.schedule)
            configStore.update({
                worker: {
                    ...plugin.worker,
                    enabled: true,
                    installed: true,
                    platform: capabilities.platform,
                    lastRegistrationError: null,
                },
            })
            return schedulerStatus()
        } catch (error) {
            configStore.update({
                worker: {
                    ...plugin.worker,
                    enabled: true,
                    installed: false,
                    platform: capabilities.platform,
                    lastRegistrationError: String(error?.message ?? error).slice(0, 2_000),
                },
            })
            throw error
        }
    }

    async function disableScheduler() {
        const plugin = configStore.read()
        try {
            await schedulerAdapter.uninstall()
            configStore.update({
                worker: {
                    ...plugin.worker,
                    enabled: false,
                    installed: false,
                    platform: schedulerAdapter.capabilities().platform,
                    lastRegistrationError: null,
                },
            })
            return schedulerStatus()
        } catch (error) {
            configStore.update({
                worker: {
                    ...plugin.worker,
                    lastRegistrationError: String(error?.message ?? error).slice(0, 2_000),
                },
            })
            throw error
        }
    }

    function dashboardSnapshot() {
        const state = store.read()
        const rawCases = rawCaseStore.list()
        const managedSkills = managedSkillStore.read()
        return {
            counts: {
                datasets: state.datasets.length,
                cases: state.cases.length,
                rawCases: rawCases.length,
                evaluations: state.evaluationRuns.length,
                managedSkills: managedSkills.skills.length,
                operatorSessions: operatorServices.operatorSummary({limit: 1}).totals.sessions,
                optimizations: operatorServices.optimizationList().length,
            },
            dataRoot: paths.root,
            automaticCapture: automaticCaptureService.status(),
            settings: {
                rollingSkill: state.settings,
                plugin: configStore.read(),
            },
        }
    }

    function settingsSnapshot() {
        return {
            rollingSkill: store.read().settings,
            plugin: configStore.read(),
        }
    }

    function requireConversationEpisodeSource() {
        const source = options.conversationEpisodeSource
        if (
            !source ||
            typeof source.inspect !== "function" ||
            typeof source.capture !== "function"
        ) {
            throw new Error("Trusted DSH conversation evidence is unavailable")
        }
        return source
    }

    function dshSequence(itemId, sessionId) {
        const id = typeof itemId === "string" ? itemId : ""
        const prefix = `dsh:${sessionId}:`
        if (!sessionId || !id.startsWith(prefix)) return null
        const sequence = Number(id.slice(prefix.length))
        return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null
    }

    async function automaticRawCaseEvidence(rawCase, {forCuration = false} = {}) {
        const present = (episode) => forCuration ? episode : publicEpisode(episode, {itemLimit: null})
        const observation = automaticRawCaseObservation(rawCase)
        if (!observation) throw new Error("Raw Case has no automatic source evidence")
        if (observation.evidence) {
            return {
                provenance: "snapshot",
                episode: present(automaticEvidenceStore.read(observation.evidence)),
            }
        }
        const startSeq = dshSequence(observation.startItemId, observation.threadId)
        const endSeq = dshSequence(observation.endItemId, observation.threadId)
        if (startSeq !== null || endSeq !== null) {
            if (
                startSeq === null ||
                endSeq === null ||
                startSeq > endSeq ||
                typeof options.conversationEpisodeSource?.readRange !== "function"
            ) {
                throw new Error("Trusted DSH source range is unavailable")
            }
            const episode = await options.conversationEpisodeSource.readRange({
                sessionId: observation.threadId,
                startSeq,
                endSeq,
            })
            return {provenance: "source", episode: present(episode)}
        }
        const runtime = await runtimeServices.getClient(observation.runtimeId, {
            nonInteractive: true,
        })
        if (typeof runtime.readThread !== "function") {
            throw new Error("Source Runtime cannot read the captured conversation")
        }
        const response = await runtime.readThread(observation.threadId)
        const thread = response?.thread ?? response
        const episode = buildEpisodeSnapshot(thread, {
            startItemId: observation.startItemId,
            startTurnId: observation.startTurnId,
            endItemId: observation.endItemId,
            endTurnId: observation.endTurnId,
            runtimeId: observation.runtimeId,
        })
        return {provenance: "source", episode: present(episode)}
    }

    function curationSession(id) {
        return typeof curationManager.getSession === "function"
            ? curationManager.getSession(id)
            : store.getCurationSession(id)
    }

    function curationSessions(archived) {
        if (typeof curationManager.listSessions === "function") {
            return curationManager.listSessions({archived})
        }
        return archived ? store.listArchivedCurationSessions() : store.listCurationSessions()
    }

    function rubricSession(id) {
        return typeof rubricManager.getSession === "function"
            ? rubricManager.getSession(id)
            : store.getRubricSession(id)
    }

    function rubricSessions(datasetId) {
        return typeof rubricManager.listSessions === "function"
            ? rubricManager.listSessions({datasetId})
            : store.listRubricSessions(datasetId)
    }

    function expectedSessionRevision(input, getSession, label) {
        const sessionId = requiredIdentifier(input.sessionId, `${label} Session id`)
        const expectedRevision = requiredIdentifier(input.expectedRevision, `${label} revision`)
        const session = getSession(sessionId)
        if (session.updatedAt !== expectedRevision) {
            throw new Error(`Stale ${label} revision; reload the latest Session`)
        }
        return session
    }

    function idempotentReviewMutation(method, input, operation) {
        const idempotencyKey = requiredIdentifier(input.idempotencyKey, `${method} idempotency key`)
        const cacheKey = `${method}:${idempotencyKey}`
        const signature = JSON.stringify(input)
        const existing = reviewMutationResults.get(cacheKey)
        if (existing) {
            if (existing.signature !== signature) {
                throw new Error(`${method} idempotency key was already used with different input`)
            }
            return existing.value
        }
        const value = Promise.resolve().then(operation)
        reviewMutationResults.set(cacheKey, {signature, value})
        if (reviewMutationResults.size > 1_000) {
            reviewMutationResults.delete(reviewMutationResults.keys().next().value)
        }
        value.catch(() => {
            if (reviewMutationResults.get(cacheKey)?.value === value) {
                reviewMutationResults.delete(cacheKey)
            }
        })
        return value
    }

    function curationMutation(input, allowed, method, operation) {
        exactFields(input, new Set(["sessionId", "expectedRevision", "idempotencyKey", ...allowed]), "curation")
        return idempotentReviewMutation(method, input, async () => {
            const session = expectedSessionRevision(input, curationSession, "Curation")
            return operation(session)
        })
    }

    function rubricMutation(input, allowed, method, operation) {
        exactFields(input, new Set(["sessionId", "expectedRevision", "idempotencyKey", ...allowed]), "rubric")
        return idempotentReviewMutation(method, input, async () => {
            const session = expectedSessionRevision(input, rubricSession, "Rubric")
            return operation(session)
        })
    }

    async function inspectConversationCuration(input) {
        exactFields(input, new Set(["sessionId", "endMessageId"]), "conversation curation")
        const request = {
            sessionId: requiredIdentifier(input.sessionId, "DSH Session id"),
            endMessageId: requiredIdentifier(input.endMessageId, "Assistant message id"),
        }
        const inspection = await requireConversationEpisodeSource().inspect(request)
        return {
            ...inspection,
            datasets: store.listDatasets().map((dataset) =>
                conversationCurationOperationResolver.inspectDataset(dataset.id, {sourceProviderId: "deepseek-harness"}),
            ),
        }
    }

    async function createConversationCuration(input) {
        exactFields(input, new Set([
            "sessionId",
            "endMessageId",
            "startSeq",
            "datasetId",
            "label",
            "note",
            "idempotencyKey",
        ]), "conversation curation")
        const label = requiredIdentifier(input.label, "Case label")
        if (label !== "good" && label !== "bad") throw new Error("Case label is invalid")
        if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
            throw new Error("Curation note must be text")
        }
        const note = input.note ?? ""
        if (note.length > 120_000) throw new Error("Curation note is too large")
        const request = {
            sessionId: requiredIdentifier(input.sessionId, "DSH Session id"),
            endMessageId: requiredIdentifier(input.endMessageId, "Assistant message id"),
            startSeq: requiredSequence(input.startSeq, "Human start sequence"),
            datasetId: requiredIdentifier(input.datasetId, "Dataset id"),
            caseType: label === "good" ? "goodcase" : "badcase",
            issueDescription: note,
            idempotencyKey: requiredIdentifier(input.idempotencyKey, "Curation idempotency key"),
        }
        store.getDataset(request.datasetId)
        const existing = store.findCurationSessionByIdempotencyKey(request.idempotencyKey)
        if (existing) {
            const source = existing.episode?.source
            if (
                existing.datasetId !== request.datasetId ||
                existing.caseType !== request.caseType ||
                existing.issueDescription !== request.issueDescription ||
                source?.sessionId !== request.sessionId ||
                source?.startSeq !== request.startSeq ||
                source?.endMessageId !== request.endMessageId
            ) {
                throw new Error("Curation idempotency key was already used with different input")
            }
            return publicConversationCuration(existing)
        }
        const signature = JSON.stringify(request)
        const pending = conversationCreates.get(request.idempotencyKey)
        if (pending) {
            if (pending.signature !== signature) {
                throw new Error("Curation idempotency key was already used with different input")
            }
            return pending.value
        }
        const value = Promise.resolve().then(async () => {
            const frozen = await requireConversationEpisodeSource().capture({
                sessionId: request.sessionId,
                endMessageId: request.endMessageId,
                startSeq: request.startSeq,
            })
            const operation = conversationCurationOperationResolver.resolve(request.datasetId, {
                sourceProviderId: "deepseek-harness",
                observedSkills: frozen.source.observedSkills,
            })
            const curatorProfile = store.read().settings.curatorProfile ?? {}
            const session = await curationManager.createSessionFromFrozenEpisode({
                datasetId: request.datasetId,
                caseType: request.caseType,
                issueDescription: request.issueDescription,
                idempotencyKey: request.idempotencyKey,
                episode: frozen.episode,
                source: frozen.source,
                curator: {modelId: curatorProfile.modelId ?? null, effort: curatorProfile.effort ?? null},
                executionSkillReference: operation.executionSkillReference,
                operationEvidence: operation.operationEvidence,
            })
            return publicConversationCuration(session)
        })
        conversationCreates.set(request.idempotencyKey, {signature, value})
        try {
            return await value
        } finally {
            if (conversationCreates.get(request.idempotencyKey)?.value === value) {
                conversationCreates.delete(request.idempotencyKey)
            }
        }
    }

    const methods = {
        "health.get": () => ({status: "ready"}),
        "dashboard.get": () => dashboardSnapshot(),
        "datasets.list": () => store.listDatasets().map(publicDataset),
        "datasets.get": ({datasetId}) => ({
            ...publicDataset(store.getDataset(datasetId)),
            cases: store.listCases(datasetId),
        }),
        "datasets.create": (input) => publicDataset(store.createDataset({
            name: input.name,
            skillReference: managedDatasetSkillReference(managedSkillStore, input),
        })),
        "datasets.bindSkill": (input) => {
            exactFields(input, new Set([
                "datasetId",
                "repositoryId",
                "skillId",
                "expectedCreatedAt",
                "idempotencyKey",
            ]), "Dataset Skill binding")
            return idempotentReviewMutation("datasets.bindSkill", input, async () => {
                const datasetId = requiredIdentifier(input.datasetId, "Dataset id")
                const dataset = store.getDataset(datasetId)
                const expectedCreatedAt = requiredIdentifier(
                    input.expectedCreatedAt,
                    "Dataset creation revision",
                )
                if (dataset.createdAt !== expectedCreatedAt) {
                    throw new Error("Dataset changed since it was loaded")
                }
                return publicDataset(store.bindDatasetSkill(
                    datasetId,
                    managedDatasetSkillReference(managedSkillStore, {
                        repositoryId: input.repositoryId,
                        skillId: input.skillId,
                    }),
                ))
            })
        },
        "rawCases.list": () => rawCaseStore.list().map(publicRawCase),
        "rawCases.evidence": (input) => {
            exactFields(input, new Set(["id"]), "Raw Case evidence")
            const rawCase = rawCaseStore.requireRecord(requiredIdentifier(input.id, "Raw Case id"))
            return automaticRawCaseEvidence(rawCase)
        },
        "rawCases.add": (input) => {
            exactFields(input, new Set([
                "question",
                "note",
                "repositoryId",
                "skillId",
            ]), "Raw Case")
            return publicRawCase(rawCaseStore.add({
                question: input.question,
                note: input.note ?? "",
                skill: managedRawCaseSkill(managedSkillStore, input),
                source: {kind: "manual"},
            }))
        },
        "rawCases.updateManaged": (input) => {
            exactFields(input, new Set([
                "id",
                "expectedRevision",
                "expectedSkillName",
                "question",
                "note",
                "repositoryId",
                "skillId",
                "idempotencyKey",
            ]), "Raw Case update")
            return idempotentReviewMutation("rawCases.updateManaged", input, async () =>
                publicRawCase(rawCaseStore.updateIfCurrent(
                    requiredIdentifier(input.id, "Raw Case id"),
                    {
                        expectedRevision: input.expectedRevision,
                        expectedSkillName: requiredIdentifier(
                            input.expectedSkillName,
                            "Raw Case Skill name",
                        ),
                    },
                    {
                        question: input.question,
                        note: input.note ?? "",
                        skill: managedRawCaseSkill(managedSkillStore, input),
                    },
                )))
        },
        "rawCases.createDraft": (input) => {
            exactFields(input, new Set(["id", "datasetId", "idempotencyKey"]), "Raw Case Draft")
            return idempotentReviewMutation("rawCases.createDraft", input, async () => {
                const rawCase = rawCaseStore.requireRecord(requiredIdentifier(input.id, "Raw Case id"))
                const datasetId = requiredIdentifier(input.datasetId, "Dataset id")
                const dataset = store.getDataset(datasetId)
                if (
                    !rawCase.skill?.id ||
                    dataset.skillReference?.evidencePrecision !== "managed" ||
                    dataset.skillReference.id !== rawCase.skill.id
                ) {
                    throw new Error("Raw Case Skill does not match the Dataset managed Skill")
                }
                const source = automaticRawCaseObservation(rawCase)
                if (
                    !source ||
                    source.outcome === "uncertain" ||
                    !source.threadId ||
                    !source.startItemId ||
                    !source.endItemId
                ) {
                    throw new Error("Raw Case has no complete automatic Episode evidence")
                }
                const operation = conversationCurationOperationResolver.resolve(datasetId, {
                    runtimeId: source.runtimeId,
                })
                const {episode} = await automaticRawCaseEvidence(rawCase, {forCuration: true})
                const profile = store.read().settings.curatorProfile ?? {}
                const session = await curationManager.createEpisodeSession({
                    datasetId,
                    caseType: source.caseType,
                    episode,
                    curator: {modelId: profile.modelId ?? null, effort: profile.effort ?? null},
                    issueDescription: rawCase.note ?? source.reason ?? "",
                    executionSkillReference: operation.executionSkillReference,
                    operationEvidence: operation.operationEvidence,
                })
                rawCaseStore.markDispatched(rawCase.id, {
                    mode: "curation-draft",
                    sessionId: session.id,
                })
                return publicCurationSession(session)
            })
        },
        "settings.get": () => settingsSnapshot(),
        "settings.update": ({rollingSkill = {}, plugin = {}}) => {
            if (["runtime", "captureRuntime", "detectionRuntime", "worker"].some((field) => Object.hasOwn(plugin, field))) {
                throw new Error("Runtime and Worker settings require their dedicated Host operations")
            }
            if (Object.keys(rollingSkill).length > 0) store.updateSettings(rollingSkill)
            if (Object.keys(plugin).length > 0) configStore.update(plugin)
            return settingsSnapshot()
        },
        "settings.selectRuntime": (input) => {
            exactFields(input, new Set(["runtimeId"]), "Runtime selection")
            const descriptor = runtimeServices.descriptor(
                requiredIdentifier(input.runtimeId, "Runtime id"),
            )
            configStore.update({runtime: {
                providerId: descriptor.providerId,
                runtimeId: descriptor.runtimeId,
                displayName: descriptor.displayName,
                version: descriptor.version,
                executablePath: descriptor.executablePath,
            }})
            return settingsSnapshot()
        },
        "conversationCuration.inspect": (input) => inspectConversationCuration(input),
        "conversationCuration.create": (input) => createConversationCuration(input),
        "conversationCuration.markers": (input) => {
            exactFields(input, new Set(["sessionId"]), "conversation curation")
            return store.listConversationCurationMarkers(
                requiredIdentifier(input.sessionId, "DSH Session id"),
            )
        },
        "curation.list": (input) => {
            exactFields(input, new Set(["archived"]), "curation")
            const archived = input.archived === true
            return {items: curationSessions(archived).map(publicCurationSession), archived}
        },
        "curation.get": (input) => {
            exactFields(input, new Set(["sessionId"]), "curation")
            return publicCurationSession(curationSession(
                requiredIdentifier(input.sessionId, "Curation Session id"),
            ))
        },
        "curation.createCalibration": (input) => {
            exactFields(input, new Set(["datasetId", "caseId", "idempotencyKey"]), "calibration")
            return idempotentReviewMutation("curation.createCalibration", input, async () => {
                const datasetId = requiredIdentifier(input.datasetId, "Dataset id")
                const caseId = requiredIdentifier(input.caseId, "Case id")
                store.getDataset(datasetId)
                const profile = store.read().settings.curatorProfile
                return publicCurationSession(await curationManager.createCalibrationSession({
                    datasetId,
                    caseId,
                    modelId: profile.modelId,
                    effort: profile.effort,
                }))
            })
        },
        "curation.send": (input) => curationMutation(input, ["text"], "curation.send", async (session) => {
            const text = requiredBodyText(input.text, "Curation review message")
            return publicCurationSession(await curationManager.sendMessage(session.id, text))
        }),
        "curation.retry": (input) => curationMutation(input, [], "curation.retry", async (session) =>
            publicCurationSession(await curationManager.retry(session.id))),
        "curation.model": (input) => curationMutation(input, ["modelId"], "curation.model", async (session) =>
            publicCurationSession(curationManager.updateModel(session.id, input.modelId ?? null))),
        "curation.effort": (input) => curationMutation(input, ["effort"], "curation.effort", async (session) =>
            publicCurationSession(curationManager.updateEffort(session.id, input.effort ?? null))),
        "curation.save": (input) => curationMutation(input, [], "curation.save", async (session) => {
            const caseRecord = await curationManager.archive(session.id)
            const updated = curationSession(session.id)
            return {
                session: publicCurationSession(updated),
                caseRecord: {
                    id: caseRecord.id,
                    datasetId: caseRecord.datasetId,
                    caseType: caseRecord.caseType,
                    updatedAt: caseRecord.updatedAt ?? caseRecord.createdAt ?? null,
                },
            }
        }),
        "curation.discard": (input) => curationMutation(input, [], "curation.discard", async (session) =>
            publicCurationSession(await curationManager.discard(session.id))),
        "curation.hidden": (input) => {
            exactFields(input, new Set(), "curation")
            return [...curationManager.hiddenThreadIds()].sort()
        },
        "rubrics.list": (input) => {
            exactFields(input, new Set(["datasetId"]), "rubric")
            const datasetId = input.datasetId
                ? requiredIdentifier(input.datasetId, "Dataset id")
                : null
            return {
                sessions: rubricSessions(datasetId).map(publicRubricSession),
                versions: datasetId
                    ? store.listDatasetRubricVersions(datasetId).map(publicRubricVersion)
                    : [],
                active: datasetId
                    ? publicRubricVersion(store.getActiveDatasetRubric(datasetId))
                    : null,
            }
        },
        "rubrics.get": (input) => {
            exactFields(input, new Set(["sessionId"]), "rubric")
            return publicRubricSession(rubricSession(
                requiredIdentifier(input.sessionId, "Rubric Session id"),
            ))
        },
        "rubrics.create": (input) => {
            exactFields(input, new Set(["datasetId", "modelId", "effort", "initialInstruction", "idempotencyKey"]), "rubric")
            return idempotentReviewMutation("rubrics.create", input, async () => {
                const datasetId = requiredIdentifier(input.datasetId, "Dataset id")
                const initialInstruction = optionalBodyText(input.initialInstruction, "Rubric generation request")
                const operation = conversationCurationOperationResolver.resolveRubric(datasetId)
                const skillEvidence = snapshotSkillEvidence(operation.executionSkillReference)
                return publicRubricSession(await rubricManager.createSession({
                    datasetId,
                    modelId: input.modelId ?? null,
                    effort: input.effort ?? null,
                    skillEvidence,
                    executionSkillReference: operation.executionSkillReference,
                    operationEvidence: operation.operationEvidence,
                    initialInstruction,
                }))
            })
        },
        "rubrics.send": (input) => rubricMutation(input, ["text"], "rubrics.send", async (session) => {
            const text = requiredBodyText(input.text, "Rubric review message")
            return publicRubricSession(await rubricManager.sendMessage(session.id, text))
        }),
        "rubrics.retry": (input) => rubricMutation(input, [], "rubrics.retry", async (session) =>
            publicRubricSession(await rubricManager.retry(session.id))),
        "rubrics.model": (input) => rubricMutation(input, ["modelId"], "rubrics.model", async (session) =>
            publicRubricSession(rubricManager.updateModel(session.id, input.modelId ?? null))),
        "rubrics.effort": (input) => rubricMutation(input, ["effort"], "rubrics.effort", async (session) =>
            publicRubricSession(rubricManager.updateEffort(session.id, input.effort ?? null))),
        "rubrics.publish": (input) => rubricMutation(input, [], "rubrics.publish", async (session) => {
            const version = await rubricManager.publish(session.id)
            return {
                session: publicRubricSession(rubricSession(session.id)),
                version: publicRubricVersion(version),
            }
        }),
        "rubrics.migrateLegacy": (input) => {
            exactFields(input, new Set(["datasetId", "idempotencyKey"]), "rubric migration")
            return idempotentReviewMutation("rubrics.migrateLegacy", input, async () =>
                publicRubricVersion(store.migrateActiveDatasetRubricToUnified(
                    requiredIdentifier(input.datasetId, "Dataset id"),
                )))
        },
        "rubrics.discard": (input) => rubricMutation(input, [], "rubrics.discard", async (session) =>
            publicRubricSession(await rubricManager.discard(session.id))),
        "rubrics.hidden": (input) => {
            exactFields(input, new Set(), "rubric")
            return [...rubricManager.hiddenThreadIds()].sort()
        },
        "runtimes.list": ({force = false}) => force
            ? runtimeServices.refresh()
            : runtimeServices.list(),
        "runtimes.models": ({runtimeId}) => runtimeServices.models(runtimeId),
        "evaluations.start": (input) => evaluationServices.start(input),
        "evaluations.list": (input) => evaluationServices.list(input),
        "evaluations.get": (input) => evaluationServices.get(input),
        "evaluations.cancel": (input) => evaluationServices.cancel(input),
        "evaluations.delete": (input) => evaluationServices.delete(input),
        "skills.catalog": () => skillServices.catalog(),
        "skills.get": (input) => skillServices.get(input),
        "skills.path": (input) => skillServices.path(input),
        "skills.versions": (input) => skillServices.versions(input),
        "skills.candidateBase": (input) => skillServices.candidateBase(input),
        "skills.createCandidate": (input) => skillServices.createCandidate(input),
        "skills.release": (input) => skillServices.release(input),
        "skills.deprecate": (input) => skillServices.deprecate(input),
        "skills.import": (input) => skillServices.importSource(input),
        "skills.rescan": () => skillServices.rescan(),
        "skills.reveal": (input) => skillServices.revealRepository(input),
        "skills.revealSkill": (input) => skillServices.revealSkill(input),
        "skillEdits.list": (input) => skillEditServices.list(input),
        "skillEdits.start": (input) => skillEditServices.start(input),
        "skillEdits.get": (input) => skillEditServices.get(input),
        "skillEdits.send": (input) => skillEditServices.send(input),
        "skillEdits.diff": (input) => skillEditServices.diff(input),
        "skillEdits.applyAndRelease": (input) => skillEditServices.applyAndRelease(input),
        "skillEdits.discard": (input) => skillEditServices.discard(input),
        "installations.targets": () => skillServices.installationTargets(),
        "installations.list": (input) => skillServices.installations(input),
        "installations.get": (input) => skillServices.installation(input),
        "installations.start": (input) => skillServices.startInstallation(input),
        "installations.cancel": (input) => skillServices.cancelInstallation(input),
        "installations.inspect": (input) => skillServices.inspectInstallation(input),
        "installations.send": (input) => skillServices.sendInstallation(input),
        "interactions.list": (input) => runtimeInteractionBroker.list(input),
        "interactions.resolve": (input) => runtimeInteractionBroker.resolve(input),
        "automatic.status": async () => ({
            ...automaticCaptureService.status(),
            scheduler: await schedulerStatus(),
        }),
        "automatic.update": (input) => automaticCaptureService.update(input),
        "automatic.runOnce": (input) => automaticCaptureService.runOnce(input),
        "scheduler.status": () => schedulerStatus(),
        "scheduler.enable": () => enableScheduler(),
        "scheduler.disable": () => disableScheduler(),
        "legacyImport.status": () => inspectLegacyImport({
            sourceRoot: legacySourceRoot,
            destinationRoot: paths.root,
        }),
        "legacyImport.run": (input) => {
            if (input.confirmed !== true || Object.keys(input).some((key) => key !== "confirmed")) {
                throw new Error("Legacy import requires explicit confirmation")
            }
            return importLegacyData({
                sourceRoot: legacySourceRoot,
                destinationRoot: paths.root,
            })
        },
        "operators.summary": (input) => operatorServices.operatorSummary(input),
        "operators.get": (input) => operatorServices.operatorGet(input),
        "operators.start": (input) => operatorServices.operatorStart(input),
        "operators.pause": (input) => operatorServices.operatorPause(input),
        "operators.resume": (input) => operatorServices.operatorResume(input),
        "operators.cancel": (input) => operatorServices.operatorCancel(input),
        "operators.approve": (input) => operatorServices.operatorApprove(input),
        "operators.artifacts": (input) => operatorServices.operatorArtifacts(input),
        "operators.artifact": (input) => operatorServices.operatorArtifact(input),
        "operators.send": (input) => operatorServices.operatorSend(input),
        "optimizations.list": () => operatorServices.optimizationList(),
        "optimizations.get": (input) => operatorServices.optimizationGet(input),
        "optimizations.preflight": (input) => operatorServices.optimizationPreflight(input),
        "optimizations.start": (input) => operatorServices.optimizationStart(input),
        "optimizations.pause": (input) => operatorServices.optimizationPause(input),
        "optimizations.resume": (input) => operatorServices.optimizationResume(input),
        "optimizations.cancel": (input) => operatorServices.optimizationCancel(input),
        "optimizations.report": (input) => operatorServices.optimizationReport(input),
        ...caseServices.methods,
    }
    const mutations = new Set([
        "datasets.create",
        "datasets.bindSkill",
        "rawCases.add",
        "rawCases.updateManaged",
        "rawCases.createDraft",
        "rawCases.update",
        "settings.update",
        "settings.selectRuntime",
        "conversationCuration.create",
        "curation.send",
        "curation.createCalibration",
        "curation.retry",
        "curation.model",
        "curation.effort",
        "curation.save",
        "curation.discard",
        "rubrics.create",
        "rubrics.send",
        "rubrics.retry",
        "rubrics.model",
        "rubrics.effort",
        "rubrics.publish",
        "rubrics.migrateLegacy",
        "rubrics.discard",
        "evaluations.start",
        "evaluations.cancel",
        "evaluations.delete",
        "skills.createCandidate",
        "skills.release",
        "skills.deprecate",
        "skills.import",
        "skills.rescan",
        "skills.reveal",
        "skills.revealSkill",
        "skillEdits.start",
        "skillEdits.send",
        "skillEdits.applyAndRelease",
        "skillEdits.discard",
        "installations.start",
        "installations.cancel",
        "installations.inspect",
        "installations.send",
        "interactions.resolve",
        "automatic.update",
        "automatic.runOnce",
        "scheduler.enable",
        "scheduler.disable",
        "operators.start",
        "operators.pause",
        "operators.resume",
        "operators.cancel",
        "operators.approve",
        "operators.send",
        "optimizations.start",
        "optimizations.pause",
        "optimizations.resume",
        "optimizations.cancel",
        "optimizations.report",
        ...caseServices.mutations,
    ])

    async function snapshot() {
        if (closed) throw new Error("Rolling Skill application is closed")
        return jsonCopy(dashboardSnapshot())
    }

    async function publish() {
        if (subscribers.size === 0) return
        const value = dashboardSnapshot()
        for (const listener of subscribers) {
            try {
                listener(jsonCopy(value))
            } catch {}
        }
    }

    async function dispatch(method, input = {}) {
        if (closed) throw new Error("Rolling Skill application is closed")
        if (typeof method !== "string" || !Object.hasOwn(methods, method)) {
            throw new Error(`Unknown Rolling Skill method: ${String(method ?? "")}`)
        }
        const value = await methods[method](checkedInput(method, input))
        if (mutations.has(method)) await publish()
        return jsonCopy(value)
    }

    function subscribe(listener) {
        if (closed) throw new Error("Rolling Skill application is closed")
        if (typeof listener !== "function") {
            throw new Error("Rolling Skill subscriber must be a function")
        }
        subscribers.add(listener)
        return () => subscribers.delete(listener)
    }

    async function close() {
        if (closed) return
        closed = true
        subscribers.clear()
        rawCaseStore.close()
        automaticCaptureService.stopHostSchedule()
        await evaluationRunner.stopAll?.()
        await deferredInstallationManager.stopAll()
        runtimeInteractionBroker.close?.()
        await skillEditServices.close()
        await operatorRuntime.close()
        await runtimeServices.close()
    }

    if (!options.workerMode) automaticCaptureService.startHostSchedule()
    return Object.freeze({close, dispatch, snapshot, subscribe})
}

module.exports = {
    MAX_DISPATCH_BYTES,
    createRollingSkillApplication,
    evaluationRuntimeThreadIds,
    installationRuntimeThreadIds,
    reconcileManagedDatasetBindings,
    runtimeSkillMatchesVerifiedInstallation,
}
