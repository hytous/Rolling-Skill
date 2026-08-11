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
    listSkills: (forceReload = false) => ipcRenderer.invoke("skills:list", {forceReload}),
    listPlugins: () => ipcRenderer.invoke("plugins:list"),
    listInstalledPlugins: () => ipcRenderer.invoke("plugins:installed"),
    installPlugin: (input) => ipcRenderer.invoke("plugins:install", input),
    readThread: (threadId) => ipcRenderer.invoke("runtime:read-thread", threadId),
    startThread: (modelId = null) => ipcRenderer.invoke("runtime:start-thread", {modelId}),
    startTurn: (threadId, text, modelId = null) =>
        ipcRenderer.invoke("runtime:start-turn", {threadId, text, modelId}),
    interruptTurn: (threadId, turnId) =>
        ipcRenderer.invoke("runtime:interrupt-turn", {threadId, turnId}),
    listDatasets: () => ipcRenderer.invoke("datasets:list"),
    listCases: (datasetId) => ipcRenderer.invoke("datasets:list-cases", datasetId),
    createDataset: (name) => ipcRenderer.invoke("datasets:create", name),
    revealLocalData: () => ipcRenderer.invoke("datasets:reveal"),
    updateSettings: (input) => ipcRenderer.invoke("settings:update", input),
    listCurations: () => ipcRenderer.invoke("curation:list"),
    getCuration: (sessionId) => ipcRenderer.invoke("curation:get", sessionId),
    createCuration: (input) => ipcRenderer.invoke("curation:create", input),
    sendCurationMessage: (sessionId, text) =>
        ipcRenderer.invoke("curation:send", {sessionId, text}),
    retryCuration: (sessionId) => ipcRenderer.invoke("curation:retry", sessionId),
    archiveCuration: (sessionId) => ipcRenderer.invoke("curation:archive", sessionId),
    discardCuration: (sessionId) => ipcRenderer.invoke("curation:discard", sessionId),
    updateCurationModel: (sessionId, modelId) =>
        ipcRenderer.invoke("curation:update-model", {sessionId, modelId}),
    updateCuratorProfile: (input) => ipcRenderer.invoke("curation:update-profile", input),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onRuntimeNotification: (listener) => subscribe("runtime:notification", listener),
    onCurationChanged: (listener) => subscribe("curation:changed", listener),
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
