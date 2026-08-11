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
    listThreads: () => ipcRenderer.invoke("runtime:list-threads"),
    listModels: () => ipcRenderer.invoke("models:list"),
    listModelsForRuntime: (runtimeId) =>
        ipcRenderer.invoke("models:list-for-runtime", runtimeId),
    listSkills: (forceReload = false) => ipcRenderer.invoke("skills:list", {forceReload}),
    listPlugins: () => ipcRenderer.invoke("plugins:list"),
    listInstalledPlugins: () => ipcRenderer.invoke("plugins:installed"),
    installPlugin: (input) => ipcRenderer.invoke("plugins:install", input),
    readThread: (threadId) => ipcRenderer.invoke("runtime:read-thread", threadId),
    startThread: (modelId = null, effort = null) =>
        ipcRenderer.invoke("runtime:start-thread", {modelId, effort}),
    startTurn: (threadId, text, modelId = null, effort = null) =>
        ipcRenderer.invoke("runtime:start-turn", {threadId, text, modelId, effort}),
    interruptTurn: (threadId, turnId) =>
        ipcRenderer.invoke("runtime:interrupt-turn", {threadId, turnId}),
    listDatasets: () => ipcRenderer.invoke("datasets:list"),
    listCases: (datasetId) => ipcRenderer.invoke("datasets:list-cases", datasetId),
    deleteCase: (datasetId, caseId) =>
        ipcRenderer.invoke("datasets:delete-case", {datasetId, caseId}),
    createDataset: (name) => ipcRenderer.invoke("datasets:create", name),
    revealLocalData: () => ipcRenderer.invoke("datasets:reveal"),
    updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
    listCurations: () => ipcRenderer.invoke("curation:list"),
    listArchivedCurations: () => ipcRenderer.invoke("curation:list-archived"),
    getCuration: (sessionId) => ipcRenderer.invoke("curation:get", sessionId),
    createCuration: (input) => ipcRenderer.invoke("curation:create", input),
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
    startEvaluationRun: (input) => ipcRenderer.invoke("evaluations:start", input),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onRuntimeNotification: (listener) => subscribe("runtime:notification", listener),
    onCurationChanged: (listener) => subscribe("curation:changed", listener),
    onEvaluationChanged: (listener) => subscribe("evaluation:changed", listener),
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
