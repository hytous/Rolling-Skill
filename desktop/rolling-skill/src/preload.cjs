const {contextBridge, ipcRenderer} = require("electron")

function subscribe(channel, listener) {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld("rollingSkill", {
    bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
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
    listModels: () => ipcRenderer.invoke("models:list"),
    listModelsForRuntime: (runtimeId) =>
        ipcRenderer.invoke("models:list-for-runtime", runtimeId),
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
    listRawCases: (skillName = null) => ipcRenderer.invoke("raw-cases:list", {skillName}),
    addRawCases: (cases_) => ipcRenderer.invoke("raw-cases:add", {cases: cases_}),
    updateRawCase: (id, changes) => ipcRenderer.invoke("raw-cases:update", {id, changes}),
    deleteRawCase: (id) => ipcRenderer.invoke("raw-cases:delete", id),
    markRawCaseDispatched: (id, threadId, mode) =>
        ipcRenderer.invoke("raw-cases:mark-dispatched", {id, threadId, mode}),
    listManagedSkills: () => ipcRenderer.invoke("skill-repositories:list"),
    rescanManagedSkills: () => ipcRenderer.invoke("skill-repositories:rescan"),
    importManagedSkill: (input) => ipcRenderer.invoke("skill-repositories:import", input),
    readManagedSkill: (skillId) => ipcRenderer.invoke("managed-skills:read", {skillId}),
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
    sendSkillInstallationMessage: (jobId, text) =>
        ipcRenderer.invoke("skill-installations:send", {jobId, text}),
    respondSkillInstallationQuestion: (input) =>
        ipcRenderer.invoke("skill-installations:respond-question", input),
    revealManagedSkillRepository: (repositoryId) =>
        ipcRenderer.invoke("skill-repositories:reveal", {repositoryId}),
    listDatasets: () => ipcRenderer.invoke("datasets:list"),
    listCases: (datasetId) => ipcRenderer.invoke("datasets:list-cases", datasetId),
    deleteCase: (datasetId, caseId) =>
        ipcRenderer.invoke("datasets:delete-case", {datasetId, caseId}),
    createDataset: (input) => ipcRenderer.invoke("datasets:create", input),
    bindDatasetSkill: (datasetId, skillReference) =>
        ipcRenderer.invoke("datasets:bind-skill", {datasetId, skillReference}),
    exportDatasetCsv: (input) => ipcRenderer.invoke("datasets:export-csv", input),
    deleteDataset: (datasetId) => ipcRenderer.invoke("datasets:delete", datasetId),
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
    listEvaluationRuns: (datasetId = null) => ipcRenderer.invoke("evaluations:list", datasetId),
    getEvaluationRun: (runId) => ipcRenderer.invoke("evaluations:get", runId),
    cancelEvaluationRun: (runId) => ipcRenderer.invoke("evaluations:cancel", runId),
    deleteEvaluationRun: (runId) => ipcRenderer.invoke("evaluations:delete", runId),
    startEvaluationRun: (input) => ipcRenderer.invoke("evaluations:start", input),
    respondRuntimeQuestion: (input) => ipcRenderer.invoke("runtime:respond-question", input),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onRuntimeNotification: (listener) => subscribe("runtime:notification", listener),
    onRuntimeQuestion: (listener) => subscribe("runtime:question-requested", listener),
    onRuntimeQuestionResolved: (listener) => subscribe("runtime:question-resolved", listener),
    onRawCasesChanged: (listener) => subscribe("raw-cases:changed", listener),
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
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
