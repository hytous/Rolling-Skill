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
    readThread: (threadId) => ipcRenderer.invoke("runtime:read-thread", threadId),
    startThread: () => ipcRenderer.invoke("runtime:start-thread"),
    startTurn: (threadId, text) => ipcRenderer.invoke("runtime:start-turn", {threadId, text}),
    interruptTurn: (threadId, turnId) =>
        ipcRenderer.invoke("runtime:interrupt-turn", {threadId, turnId}),
    listDatasets: () => ipcRenderer.invoke("datasets:list"),
    createDataset: (name) => ipcRenderer.invoke("datasets:create", name),
    saveCase: (input) => ipcRenderer.invoke("datasets:save-case", input),
    revealLocalData: () => ipcRenderer.invoke("datasets:reveal"),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onRuntimeNotification: (listener) => subscribe("runtime:notification", listener),
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
