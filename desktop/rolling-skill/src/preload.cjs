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
    getTrace: (limit = 200) => ipcRenderer.invoke("runtime:trace", limit),
    openTraceFolder: () => ipcRenderer.invoke("runtime:open-traces"),
    listThreads: () => ipcRenderer.invoke("codex:list-threads"),
    readThread: (threadId) => ipcRenderer.invoke("codex:read-thread", threadId),
    startThread: () => ipcRenderer.invoke("codex:start-thread"),
    startTurn: (threadId, text) => ipcRenderer.invoke("codex:start-turn", {threadId, text}),
    interruptTurn: (threadId, turnId) =>
        ipcRenderer.invoke("codex:interrupt-turn", {threadId, turnId}),
    listDatasets: () => ipcRenderer.invoke("datasets:list"),
    createDataset: (name) => ipcRenderer.invoke("datasets:create", name),
    saveCase: (input) => ipcRenderer.invoke("datasets:save-case", input),
    revealLocalData: () => ipcRenderer.invoke("datasets:reveal"),
    onRuntimeState: (listener) => subscribe("runtime:state", listener),
    onCodexNotification: (listener) => subscribe("codex:notification", listener),
    onWorkspaceChanged: (listener) => subscribe("workspace:changed", listener),
    onNewTask: (listener) => subscribe("app:new-task", listener),
})
