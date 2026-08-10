const {app, BrowserWindow, dialog, ipcMain, Menu, session, shell} = require("electron")
const {existsSync, readFileSync, writeFileSync} = require("node:fs")
const {dirname, join} = require("node:path")
const {pathToFileURL} = require("node:url")
const {spawn} = require("node:child_process")

const {classifyNavigation} = require("./navigation.cjs")
const {findRepositoryRoot, isRepositoryRoot} = require("./paths.cjs")
const {createRuntimePaths} = require("./runtime-command.cjs")
const {RuntimeController} = require("./runtime-controller.cjs")

const APP_URL = process.env.ROLLING_SKILL_APP_URL || "http://localhost/"
const STARTUP_FILE = join(__dirname, "..", "renderer", "index.html")
const PRELOAD_FILE = join(__dirname, "preload.cjs")

let mainWindow = null
let controller = null
let startupUrl = null

app.setName("Rolling Skill")

function preferencesFile() {
    return join(app.getPath("userData"), "preferences.json")
}

function readSavedRepository() {
    try {
        const parsed = JSON.parse(readFileSync(preferencesFile(), "utf8"))
        return typeof parsed.repositoryRoot === "string" ? parsed.repositoryRoot : null
    } catch {
        return null
    }
}

function saveRepository(repositoryRoot) {
    writeFileSync(preferencesFile(), `${JSON.stringify({repositoryRoot}, null, 2)}\n`, {
        mode: 0o600,
    })
}

function locateRepository() {
    return findRepositoryRoot([
        process.env.ROLLING_SKILL_REPO_ROOT,
        app.getAppPath(),
        __dirname,
        process.execPath,
        process.cwd(),
        readSavedRepository(),
    ])
}

function sendState(state = controller?.getState()) {
    if (state && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("runtime:state", state)
    }
}

async function showStartup() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const current = mainWindow.webContents.getURL()
    if (current !== startupUrl) await mainWindow.loadFile(STARTUP_FILE)
    sendState()
}

async function showWorkbench() {
    if (!mainWindow || mainWindow.isDestroyed()) return
    await mainWindow.loadURL(APP_URL)
}

function installNavigationPolicy(window) {
    const guardNavigation = (event, target) => {
        if (target === startupUrl || classifyNavigation(target, APP_URL) === "internal") return
        event.preventDefault()
        if (classifyNavigation(target, APP_URL) === "external") void shell.openExternal(target)
    }
    window.webContents.setWindowOpenHandler(({url}) => {
        const classification = classifyNavigation(url, APP_URL)
        if (classification === "internal") void window.loadURL(url)
        if (classification === "external") void shell.openExternal(url)
        return {action: "deny"}
    })
    window.webContents.on("will-navigate", guardNavigation)
    window.webContents.on("will-redirect", guardNavigation)
    window.webContents.on("will-attach-webview", (event) => event.preventDefault())
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 980,
        minHeight: 680,
        show: false,
        title: "Rolling Skill",
        titleBarStyle: "hiddenInset",
        trafficLightPosition: {x: 18, y: 18},
        backgroundColor: "#111113",
        webPreferences: {
            preload: PRELOAD_FILE,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    })
    installNavigationPolicy(mainWindow)
    mainWindow.once("ready-to-show", () => {
        mainWindow?.show()
        const smokeScreenshot = process.env.ROLLING_SKILL_SMOKE_SCREENSHOT
        if (smokeScreenshot) {
            setTimeout(async () => {
                if (!mainWindow || mainWindow.isDestroyed()) return
                const image = await mainWindow.webContents.capturePage()
                writeFileSync(smokeScreenshot, image.toPNG())
                if (process.env.ROLLING_SKILL_SMOKE_QUIT === "1") app.quit()
            }, 1_000)
        }
    })
    mainWindow.on("closed", () => {
        mainWindow = null
    })
    void showStartup()
}

function installMenu() {
    const template = [
        {
            label: "Rolling Skill",
            submenu: [
                {role: "about"},
                {type: "separator"},
                {label: "Runtime Status", accelerator: "CommandOrControl+Shift+S", click: showStartup},
                {
                    label: "Open Workbench",
                    accelerator: "CommandOrControl+1",
                    click: showWorkbench,
                },
                {type: "separator"},
                {role: "services"},
                {type: "separator"},
                {role: "hide"},
                {role: "hideOthers"},
                {role: "unhide"},
                {type: "separator"},
                {role: "quit"},
            ],
        },
        {role: "editMenu"},
        {role: "viewMenu"},
        {
            label: "Runtime",
            submenu: [
                {
                    label: "Retry Start",
                    accelerator: "CommandOrControl+R",
                    click: async () => {
                        await showStartup()
                        await controller?.start()
                    },
                },
                {
                    label: "Restart Runtime",
                    click: async () => {
                        await showStartup()
                        await controller?.restart()
                    },
                },
                {
                    label: "Stop Runtime",
                    click: async () => {
                        await showStartup()
                        await controller?.stop()
                    },
                },
                {type: "separator"},
                {label: "Open Logs", click: () => openLogs()},
                {label: "Show Checkout in Finder", click: () => revealRepository()},
                {label: "Choose Checkout…", click: () => chooseRepository()},
            ],
        },
        {role: "windowMenu"},
        {
            role: "help",
            submenu: [
                {
                    label: "Agenta Documentation",
                    click: () => shell.openExternal("https://agenta.ai/docs"),
                },
            ],
        },
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function chooseRepository() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Choose the Agenta checkout",
        properties: ["openDirectory"],
        message: "Choose the folder that contains hosting/docker-compose/run.sh",
    })
    if (result.canceled || result.filePaths.length === 0) return false
    const selected = result.filePaths[0]
    if (!isRepositoryRoot(selected)) {
        await dialog.showMessageBox(mainWindow, {
            type: "error",
            message: "This is not an Agenta checkout",
            detail: "The selected folder does not contain hosting/docker-compose/run.sh.",
        })
        return false
    }
    saveRepository(selected)
    controller.setRepositoryRoot(selected)
    await controller.start()
    return true
}

function openLogs() {
    const root = controller?.repositoryRoot
    if (!root) return false
    const path = createRuntimePaths(root).logFile
    if (existsSync(path)) void shell.openPath(path)
    else void shell.showItemInFolder(dirname(path))
    return true
}

function revealRepository() {
    if (!controller?.repositoryRoot) return false
    shell.showItemInFolder(controller.repositoryRoot)
    return true
}

function openLoginTerminal() {
    const root = controller?.repositoryRoot
    if (!root) return false
    spawn("/usr/bin/open", ["-a", "Terminal", root], {shell: false, stdio: "ignore"})
    return true
}

function installIpc() {
    ipcMain.handle("runtime:get-state", () => controller.getState())
    ipcMain.handle("runtime:retry", async () => {
        await controller.start()
        return controller.getState()
    })
    ipcMain.handle("runtime:stop", async () => {
        await controller.stop()
        return controller.getState()
    })
    ipcMain.handle("runtime:restart", async () => {
        await controller.restart()
        return controller.getState()
    })
    ipcMain.handle("runtime:choose-repository", chooseRepository)
    ipcMain.handle("runtime:open-logs", openLogs)
    ipcMain.handle("runtime:reveal-repository", revealRepository)
    ipcMain.handle("runtime:open-login-terminal", openLoginTerminal)
    ipcMain.handle("runtime:open-workbench", async () => {
        await showWorkbench()
        return true
    })
}

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
    app.quit()
} else {
    app.on("second-instance", () => {
        if (!mainWindow) createWindow()
        if (mainWindow?.isMinimized()) mainWindow.restore()
        mainWindow?.focus()
    })

    app.whenReady().then(async () => {
        startupUrl = pathToFileURL(STARTUP_FILE).toString()
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
            callback(false)
        })
        const repositoryRoot = locateRepository()
        controller = new RuntimeController({repositoryRoot, appUrl: APP_URL})
        controller.on("state", (state) => {
            sendState(state)
            if (state.phase === "ready") void showWorkbench()
        })
        installIpc()
        installMenu()
        createWindow()
        if (repositoryRoot) await controller.start()
    })

    app.on("activate", () => {
        if (!mainWindow) createWindow()
    })

    app.on("window-all-closed", () => {
        // Keep the macOS application and local runtime available from the Dock.
    })
}
