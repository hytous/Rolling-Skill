const {contextBridge, ipcRenderer} = require("electron")

const CONTROL_PAGE_LIMIT = 100
const CONTROL_MAX_PAGES = 1_000
const CONTROL_MAX_ITEMS = 100_000

async function invokeControl(method, params = {}) {
    const response = await ipcRenderer.invoke("control:invoke", {method, params})
    if (!response?.__rollingSkillControl) return response
    if (response.ok) return response.value
    const error = new Error(response.error?.message ?? "Control operation failed")
    error.code = response.error?.code ?? "CONTROL_ERROR"
    error.retryable = Boolean(response.error?.retryable)
    error.details = response.error?.details ?? null
    if (error.code === "APPROVAL_REQUIRED") error.decision = "approval_required"
    throw error
}

async function collectControlPages(method, params, key) {
    const items = []
    const seenCursors = new Set()
    let cursor = null
    for (let pageNumber = 0; pageNumber < CONTROL_MAX_PAGES; pageNumber += 1) {
        const page = await invokeControl(method, {...params, cursor, limit: CONTROL_PAGE_LIMIT})
        const pageItems = Array.isArray(page?.[key]) ? page[key] : []
        if (items.length + pageItems.length > CONTROL_MAX_ITEMS) {
            throw new Error(`Control pagination exceeded ${CONTROL_MAX_ITEMS} items`)
        }
        items.push(...pageItems)
        const nextCursor = page?.nextCursor ?? null
        if (nextCursor === null) return items
        const signature = JSON.stringify(nextCursor)
        if (seenCursors.has(signature)) {
            throw new Error("Control pagination repeated a cursor")
        }
        seenCursors.add(signature)
        cursor = nextCursor
    }
    throw new Error(`Control pagination exceeded ${CONTROL_MAX_PAGES} pages`)
}

function controlRawCase(input = {}) {
    return {
        question: input.question,
        skill: {
            ...(input.skill?.id ? {id: input.skill.id} : {}),
            name: input.skill?.name,
        },
        note: input.note ?? "",
        source: {kind: input.source?.kind ?? "operator"},
    }
}

function controlRawCaseChanges(input = {}) {
    return {
        ...(Object.hasOwn(input, "question") ? {question: input.question} : {}),
        ...(Object.hasOwn(input, "skill") ? {skill: {
            ...(input.skill?.id ? {id: input.skill.id} : {}),
            name: input.skill?.name,
        }} : {}),
        ...(Object.hasOwn(input, "note") ? {note: input.note} : {}),
    }
}

async function collectManagedSkillOverview() {
    const [repositories, skills, versions] = await Promise.all([
        collectControlPages("skill_repositories.list", {}, "repositories"),
        collectControlPages("skills.list", {}, "skills"),
        collectControlPages("skill_versions.list", {}, "versions"),
    ])
    return {repositories, skills, versions}
}

async function readManagedSkill(skillId) {
    const [detail, versions] = await Promise.all([
        invokeControl("skills.get", {skillId}),
        collectControlPages("skill_versions.list", {skillId}, "versions"),
    ])
    return {...detail.skill, versions}
}

function subscribe(channel, listener) {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("rollingSkill", {
    bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
    bootstrapOperator: () => ipcRenderer.invoke("operator:bootstrap"),
    readOperatorSummaryPage: (cursor = null, limit = CONTROL_PAGE_LIMIT) =>
        ipcRenderer.invoke("operator:summary-page", {cursor, limit}),
    createOperatorSession: (input) => ipcRenderer.invoke("operator:create", input),
    getOperatorSession: (sessionId) => ipcRenderer.invoke("operator:get", {sessionId}),
    sendOperatorMessage: (sessionId, text) =>
        ipcRenderer.invoke("operator:send", {sessionId, text}),
    pauseOperatorJob: (jobId) => invokeControl("jobs.pause", {jobId})
        .then((result) => result.job),
    resumeOperatorJob: (jobId) => invokeControl("jobs.resume", {jobId})
        .then((result) => result.job),
    stopOperatorJob: (jobId) => invokeControl("jobs.stop", {jobId})
        .then((result) => result.job),
    preflightOptimization: (input) => invokeControl("optimization.preflight", input),
    startOptimization: (input) => invokeControl("optimization.start", input)
        .then((result) => result.run),
    getOptimizationRun: (runId) => invokeControl("optimization.get", {runId})
        .then((result) => result.run),
    pauseOptimization: (runId, idempotencyKey) => invokeControl(
        "optimization.pause",
        {runId, idempotencyKey},
    ).then((result) => result.run),
    resumeOptimization: (runId, idempotencyKey) => invokeControl(
        "optimization.resume",
        {runId, idempotencyKey},
    ).then((result) => result.run),
    stopOptimization: (runId, idempotencyKey) => invokeControl(
        "optimization.stop",
        {runId, idempotencyKey},
    ).then((result) => result.run),
    getOptimizationReport: (runId, idempotencyKey) => invokeControl(
        "optimization.report",
        {runId, idempotencyKey},
    ).then((result) => result.report),
    resolveOperatorApproval: (approvalId, decision) =>
        invokeControl("approvals.resolve", {approvalId, decision}),
    listOperatorArtifacts: (jobId, cursor = null, limit = CONTROL_PAGE_LIMIT) =>
        ipcRenderer.invoke("operator:list-artifacts", {jobId, cursor, limit}),
    chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
    restartRuntime: () => ipcRenderer.invoke("runtime:restart"),
    detectRuntimes: () => ipcRenderer.invoke("runtime:detect"),
    chooseRuntime: () => ipcRenderer.invoke("runtime:choose"),
    useAutomaticRuntime: () => ipcRenderer.invoke("runtime:automatic"),
    selectRuntime: (runtimeId) => ipcRenderer.invoke("runtime:select", runtimeId),
    getTrace: (limit = 200) => ipcRenderer.invoke("runtime:trace", limit),
    openTraceFolder: () => ipcRenderer.invoke("runtime:open-traces"),
    listThreads: (archived = false) =>
        ipcRenderer.invoke("runtime:list-threads", {archived}),
    archiveThread: (threadId) => ipcRenderer.invoke("runtime:archive-thread", threadId),
    unarchiveThread: (threadId) => ipcRenderer.invoke("runtime:unarchive-thread", threadId),
    openExternal: (url) => ipcRenderer.invoke("links:open-external", url),
    openLocalPath: (path) => ipcRenderer.invoke("links:open-local", path),
    listRuntimes: () => invokeControl("runtimes.list").then((result) => result.runtimes),
    listModels: () => invokeControl("runtimes.models").then((result) => ({
        data: result.models,
        nextCursor: null,
    })),
    listModelsForRuntime: (runtimeId) =>
        invokeControl("runtimes.models", {runtimeId}).then((result) => ({
            data: result.models,
            nextCursor: null,
        })),
    listSkills: (forceReload = false) => ipcRenderer.invoke("skills:list", {forceReload}),
    listPlugins: () => ipcRenderer.invoke("plugins:list"),
    listInstalledPlugins: () => ipcRenderer.invoke("plugins:installed"),
    installPlugin: (input) => ipcRenderer.invoke("plugins:install", input),
    readThread: (threadId) => ipcRenderer.invoke("runtime:read-thread", threadId),
    drainThreadObservation: (epoch) =>
        ipcRenderer.invoke("runtime:drain-observation", {epoch}),
    clearThreadObservation: (epoch = null) =>
        ipcRenderer.invoke("runtime:clear-observation", {epoch}),
    startThread: (modelId = null, effort = null, permissionMode = null) =>
        ipcRenderer.invoke("runtime:start-thread", {modelId, effort, permissionMode}),
    startTurn: (threadId, text, modelId = null, effort = null, permissionMode = null) =>
        ipcRenderer.invoke("runtime:start-turn", {
            threadId,
            text,
            modelId,
            effort,
            permissionMode,
        }),
    interruptTurn: (threadId, turnId) =>
        ipcRenderer.invoke("runtime:interrupt-turn", {threadId, turnId}),
    listRawCases: (skillName = null) =>
        collectControlPages("raw_cases.list", {skillName}, "rawCases"),
    addRawCases: (cases_) => invokeControl("raw_cases.enqueue", {
        cases: cases_.map(controlRawCase),
    }),
    updateRawCase: (id, changes) => invokeControl("raw_cases.update", {
        id,
        changes: controlRawCaseChanges(changes),
    }).then((result) => result.rawCase),
    deleteRawCase: (id) => ipcRenderer.invoke("raw-cases:delete", id),
    markRawCaseDispatched: (id, threadId, mode) =>
        ipcRenderer.invoke("raw-cases:mark-dispatched", {id, threadId, mode}),
    createCurationFromRawCase: (rawCaseId, datasetId) =>
        ipcRenderer.invoke("curation:create-from-raw-case", {rawCaseId, datasetId}),
    getAutomaticCaptureStatus: () => ipcRenderer.invoke("automatic-capture:status"),
    listManagedSkills: collectManagedSkillOverview,
    rescanManagedSkills: () => ipcRenderer.invoke("skill-repositories:rescan"),
    importManagedSkill: (input) => ipcRenderer.invoke("skill-repositories:import", input),
    readManagedSkill,
    createManagedSkillCandidate: (input) =>
        ipcRenderer.invoke("skill-versions:create-candidate", input),
    releaseManagedSkillVersion: (input) =>
        ipcRenderer.invoke("skill-versions:release", input),
    deprecateManagedSkillVersion: (input) =>
        ipcRenderer.invoke("skill-versions:deprecate", input),
    listSkillInstallations: (skillId = null) =>
        ipcRenderer.invoke("skill-installations:list", {skillId}),
    getSkillInstallation: (jobId) =>
        ipcRenderer.invoke("skill-installations:get", {jobId}),
    startSkillInstallations: (input) =>
        ipcRenderer.invoke("skill-installations:start", input),
    cancelSkillInstallation: (jobId) =>
        ipcRenderer.invoke("skill-installations:cancel", {jobId}),
    inspectSkillInstallation: (jobId) =>
        ipcRenderer.invoke("skill-installations:inspect", {jobId}),
    respondSkillInstallationQuestion: (input) =>
        ipcRenderer.invoke("skill-installations:respond-question", input),
    revealManagedSkillRepository: (repositoryId) =>
        ipcRenderer.invoke("skill-repositories:reveal", {repositoryId}),
    listDatasets: () => collectControlPages("datasets.list", {}, "datasets"),
    listCases: (datasetId) => invokeControl("datasets.get", {datasetId, includeCases: true})
        .then((result) => result.cases ?? []),
    deleteCase: (datasetId, caseId, recoverQuestions = true) =>
        ipcRenderer.invoke("datasets:delete-case", {datasetId, caseId, recoverQuestions}),
    createDataset: (input) => ipcRenderer.invoke("datasets:create", input),
    bindDatasetSkill: (datasetId, skillReference) =>
        ipcRenderer.invoke("datasets:bind-skill", {datasetId, skillReference}),
    exportDatasetCsv: (input) => ipcRenderer.invoke("datasets:export-csv", input),
    deleteDataset: (datasetId, recoverQuestions = true) =>
        ipcRenderer.invoke("datasets:delete", {datasetId, recoverQuestions}),
    revealLocalData: () => ipcRenderer.invoke("datasets:reveal"),
    updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
    listDatasetRubricVersions: (datasetId) =>
        ipcRenderer.invoke("rubrics:list-versions", datasetId),
    getActiveDatasetRubric: (datasetId) => ipcRenderer.invoke("rubrics:active", datasetId),
    migrateLegacyDatasetRubric: (datasetId) =>
        ipcRenderer.invoke("rubrics:migrate-legacy-contract", datasetId),
    listRubricSessions: (datasetId = null) =>
        ipcRenderer.invoke("rubrics:list-sessions", datasetId),
    getRubricSession: (sessionId) => ipcRenderer.invoke("rubrics:get-session", sessionId),
    createRubricSession: (datasetId) => ipcRenderer.invoke("rubrics:create", {datasetId}),
    sendRubricMessage: (sessionId, text) =>
        ipcRenderer.invoke("rubrics:send", {sessionId, text}),
    retryRubricSession: (sessionId) => ipcRenderer.invoke("rubrics:retry", sessionId),
    publishRubricSession: (sessionId) => ipcRenderer.invoke("rubrics:publish", sessionId),
    discardRubricSession: (sessionId) => ipcRenderer.invoke("rubrics:discard", sessionId),
    updateRubricModel: (sessionId, modelId) =>
        ipcRenderer.invoke("rubrics:update-model", {sessionId, modelId}),
    updateRubricEffort: (sessionId, effort) =>
        ipcRenderer.invoke("rubrics:update-effort", {sessionId, effort}),
    listCurations: () => ipcRenderer.invoke("curation:list"),
    listArchivedCurations: () => ipcRenderer.invoke("curation:list-archived"),
    getCuration: (sessionId) => ipcRenderer.invoke("curation:get", sessionId),
    createCuration: (input) => ipcRenderer.invoke("curation:create", input),
    createCaseCalibration: (input) => ipcRenderer.invoke("curation:create-calibration", input),
    createCaseRefresh: (input) => ipcRenderer.invoke("cases:refresh", input),
    sendCurationMessage: (sessionId, text) =>
        ipcRenderer.invoke("curation:send", {sessionId, text}),
    retryCuration: (sessionId) => ipcRenderer.invoke("curation:retry", sessionId),
    archiveCuration: (sessionId) => ipcRenderer.invoke("curation:archive", sessionId),
    discardCuration: (sessionId) => ipcRenderer.invoke("curation:discard", sessionId),
    updateCurationModel: (sessionId, modelId) =>
        ipcRenderer.invoke("curation:update-model", {sessionId, modelId}),
    updateCurationEffort: (sessionId, effort) =>
        ipcRenderer.invoke("curation:update-effort", {sessionId, effort}),
    updateCuratorProfile: (input) => ipcRenderer.invoke("curation:update-profile", input),
    listEvaluationRuns: (datasetId = null) =>
        collectControlPages("evaluations.list", {datasetId}, "runs"),
    getEvaluationRun: (runId) => invokeControl("evaluations.get", {runId})
        .then((result) => result.run),
    cancelEvaluationRun: (runId) => invokeControl("evaluations.cancel", {runId})
        .then((result) => result.run),
    deleteEvaluationRun: (runId) => ipcRenderer.invoke("evaluations:delete", runId),
    startEvaluationRun: (input) => invokeControl("evaluations.start", input)
        .then((result) => result.run),
    respondRuntimeQuestion: (input) => ipcRenderer.invoke("runtime:respond-question", input),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onRuntimeNotification: (listener) => subscribe("runtime:notification", listener),
    onRuntimeQuestion: (listener) => subscribe("runtime:question-requested", listener),
    onRuntimeQuestionResolved: (listener) => subscribe("runtime:question-resolved", listener),
    onRawCasesChanged: (listener) => subscribe("raw-cases:changed", listener),
    onAutomaticCaptureStatus: (listener) => subscribe("automatic-capture:status", listener),
    onManagedSkillsChanged: (listener) => subscribe("managed-skills:changed", listener),
    onSkillInstallationsChanged: (listener) =>
        subscribe("skill-installations:changed", listener),
    onSkillInstallationQuestion: (listener) =>
        subscribe("skill-installations:question-requested", listener),
    onSkillInstallationQuestionResolved: (listener) =>
        subscribe("skill-installations:question-resolved", listener),
    onManagedSkillVersionReleased: (listener) =>
        subscribe("skill-versions:released", listener),
    onCurationChanged: (listener) => subscribe("curation:changed", listener),
    onCurationActivity: (listener) => subscribe("curation:activity", listener),
    onRubricChanged: (listener) => subscribe("rubric:changed", listener),
    onRubricActivity: (listener) => subscribe("rubric:activity", listener),
    onEvaluationChanged: (listener) => subscribe("evaluation:changed", listener),
    onOperatorChanged: (listener) => subscribe("operator:changed", listener),
    onOperatorEvent: (listener) => subscribe("operator:event", listener),
    onOperatorApproval: (listener) => subscribe("operator:approval", listener),
    onOperatorArtifact: (listener) => subscribe("operator:artifact", listener),
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
