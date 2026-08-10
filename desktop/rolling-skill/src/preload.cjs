const {contextBridge, ipcRenderer} = require("electron")

contextBridge.exposeInMainWorld("rollingSkill", {
    getState: () => ipcRenderer.invoke("runtime:get-state"),
    retry: () => ipcRenderer.invoke("runtime:retry"),
    stop: () => ipcRenderer.invoke("runtime:stop"),
    restart: () => ipcRenderer.invoke("runtime:restart"),
    chooseRepository: () => ipcRenderer.invoke("runtime:choose-repository"),
    openLogs: () => ipcRenderer.invoke("runtime:open-logs"),
    revealRepository: () => ipcRenderer.invoke("runtime:reveal-repository"),
    openLoginTerminal: () => ipcRenderer.invoke("runtime:open-login-terminal"),
    openWorkbench: () => ipcRenderer.invoke("runtime:open-workbench"),
    onState: (listener) => {
        const handler = (_event, state) => listener(state)
        ipcRenderer.on("runtime:state", handler)
        return () => ipcRenderer.removeListener("runtime:state", handler)
    },
})
