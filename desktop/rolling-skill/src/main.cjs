const {app, BrowserWindow, dialog, ipcMain, Menu, session, shell} = require("electron")
const {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} = require("node:fs")
const {homedir} = require("node:os")
const {join} = require("node:path")
const {pathToFileURL} = require("node:url")

const {CodexAppServerClient} = require("./codex-app-server.cjs")
const {resolveCodexBinary} = require("./codex-binary.cjs")
const {LocalEvaluationStore} = require("./local-store.cjs")
const {findGitWorkspace} = require("./workspace.cjs")

const RENDERER_FILE = join(__dirname, "..", "renderer", "index.html")
const PRELOAD_FILE = join(__dirname, "preload.cjs")

let mainWindow = null
let client = null
let store = null
let workspaceRoot = null
let rendererUrl = null
let runtimeStart = null
let quitAfterRuntimeStops = false
const loadedThreads = new Set()

app.setName("Rolling Skill")

function preferencesFile() {
    return join(app.getPath("userData"), "preferences.json")
}

function readPreferences() {
    try {
        return JSON.parse(readFileSync(preferencesFile(), "utf8"))
    } catch {
        return {}
    }
}

function writePreferences(patch) {
    const next = {...readPreferences(), ...patch}
    mkdirSync(app.getPath("userData"), {recursive: true, mode: 0o700})
    writeFileSync(preferencesFile(), `${JSON.stringify(next, null, 2)}\n`, {mode: 0o600})
    chmodSync(preferencesFile(), 0o600)
}

function locateInitialWorkspace() {
    const saved = readPreferences().workspaceRoot
    if (typeof saved === "string" && existsSync(saved)) return saved
    const checkout = findGitWorkspace([process.cwd(), app.getAppPath(), __dirname, process.execPath])
    if (checkout) return checkout
    return homedir()
}

function desktopProjectRoot() {
    return join(__dirname, "..")
}

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function installClientEvents(nextClient) {
    nextClient.on("state", (state) => send("runtime:state", state))
    nextClient.on("notification", (message) => send("codex:notification", message))
    nextClient.on("runtimeError", (error) => {
        send("runtime:state", {...nextClient.state(), status: "error", error: error.message})
    })
}

function createClient() {
    const binaryPath = resolveCodexBinary({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
        projectRoot: desktopProjectRoot(),
    })
    const nextClient = new CodexAppServerClient({
        binaryPath,
        traceDirectory: join(app.getPath("userData"), "traces"),
        workspaceRoot,
    })
    installClientEvents(nextClient)
    return nextClient
}

async function ensureRuntime() {
    if (client?.ready) return client
    if (!client) client = createClient()
    if (!runtimeStart) {
        runtimeStart = client.start().finally(() => {
            runtimeStart = null
        })
    }
    await runtimeStart
    return client
}

async function restartRuntime() {
    if (client) await client.stop()
    loadedThreads.clear()
    client = createClient()
    await ensureRuntime()
    return client.state()
}

async function chooseWorkspace() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Choose a local workspace",
        properties: ["openDirectory", "createDirectory"],
        message: "Codex threads shown in Rolling Skill are scoped to this folder.",
    })
    if (result.canceled || result.filePaths.length === 0) return null
    workspaceRoot = result.filePaths[0]
    writePreferences({workspaceRoot})
    loadedThreads.clear()
    client?.setWorkspace(workspaceRoot)
    send("workspace:changed", {workspaceRoot})
    return workspaceRoot
}

function openTraceFolder() {
    const directory = join(app.getPath("userData"), "traces")
    mkdirSync(directory, {recursive: true, mode: 0o700})
    void shell.openPath(directory)
    return directory
}

function revealLocalData() {
    shell.showItemInFolder(store.path)
    return store.path
}

function installNavigationPolicy(window) {
    window.webContents.setWindowOpenHandler(({url}) => {
        if (url.startsWith("https://")) void shell.openExternal(url)
        return {action: "deny"}
    })
    window.webContents.on("will-navigate", (event, target) => {
        if (target === rendererUrl) return
        event.preventDefault()
        if (target.startsWith("https://")) void shell.openExternal(target)
    })
    window.webContents.on("will-attach-webview", (event) => event.preventDefault())
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1480,
        height: 940,
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
            }, 1_200)
        }
    })
    mainWindow.on("closed", () => {
        mainWindow = null
    })
    void mainWindow.loadFile(RENDERER_FILE)
}

function installMenu() {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: "Rolling Skill",
                submenu: [
                    {role: "about"},
                    {type: "separator"},
                    {
                        label: "New Task",
                        accelerator: "CommandOrControl+N",
                        click: () => send("app:new-task"),
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
                    {label: "Restart Local Runtime", click: () => restartRuntime()},
                    {label: "Choose Workspace…", click: () => chooseWorkspace()},
                    {type: "separator"},
                    {label: "Open Trace Folder", click: openTraceFolder},
                    {label: "Show Local Evaluation Data", click: revealLocalData},
                ],
            },
            {role: "windowMenu"},
        ]),
    )
}

function installIpc() {
    ipcMain.handle("app:bootstrap", async () => {
        const runtime = client?.state() ?? {status: "starting", workspaceRoot}
        return {runtime, workspaceRoot, datasets: store.listDatasets()}
    })
    ipcMain.handle("workspace:choose", chooseWorkspace)
    ipcMain.handle("runtime:restart", restartRuntime)
    ipcMain.handle("runtime:trace", (_event, limit) =>
        client?.recentTrace(limit) ?? {path: null, reference: null, events: []},
    )
    ipcMain.handle("runtime:open-traces", openTraceFolder)

    ipcMain.handle("codex:list-threads", async () => (await ensureRuntime()).listThreads())
    ipcMain.handle("codex:read-thread", async (_event, threadId) =>
        (await ensureRuntime()).readThread(requireIdentifier(threadId, "thread")),
    )
    ipcMain.handle("codex:start-thread", async () => {
        const response = await (await ensureRuntime()).startThread()
        loadedThreads.add(response.thread.id)
        return response
    })
    ipcMain.handle("codex:start-turn", async (_event, {threadId, text}) => {
        threadId = requireIdentifier(threadId, "thread")
        text = String(text ?? "").trim()
        if (!text) throw new Error("Task text is required")
        const runtime = await ensureRuntime()
        if (!loadedThreads.has(threadId)) {
            await runtime.resumeThread(threadId)
            loadedThreads.add(threadId)
        }
        return runtime.startTurn(threadId, text)
    })
    ipcMain.handle("codex:interrupt-turn", async (_event, input) =>
        (await ensureRuntime()).interruptTurn(
            requireIdentifier(input.threadId, "thread"),
            requireIdentifier(input.turnId, "turn"),
        ),
    )
    ipcMain.handle("datasets:list", () => store.listDatasets())
    ipcMain.handle("datasets:create", (_event, name) => store.createDataset(name))
    ipcMain.handle("datasets:save-case", (_event, input) =>
        store.saveCase({
            ...input,
            traceReference: input.traceReference ?? client?.recorder?.latestReference ?? null,
        }),
    )
    ipcMain.handle("datasets:reveal", revealLocalData)
}

function requireIdentifier(value, label) {
    if (typeof value !== "string" || !value || value.length > 200) {
        throw new Error(`A valid ${label} identifier is required`)
    }
    return value
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

    app.whenReady().then(() => {
        rendererUrl = pathToFileURL(RENDERER_FILE).toString()
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
            callback(false)
        })
        workspaceRoot = locateInitialWorkspace()
        store = new LocalEvaluationStore(join(app.getPath("userData"), "evaluation-store.json"))
        client = createClient()
        installIpc()
        installMenu()
        createWindow()
        void ensureRuntime().catch((error) => {
            send("runtime:state", {status: "error", error: error.message, workspaceRoot})
        })
    })

    app.on("activate", () => {
        if (!mainWindow) createWindow()
    })

    app.on("before-quit", (event) => {
        if (!client?.child || quitAfterRuntimeStops) return
        event.preventDefault()
        quitAfterRuntimeStops = true
        void client.stop().finally(() => app.quit())
    })

    app.on("window-all-closed", () => {
        // Keep the local app-server available while the macOS app remains in the Dock.
    })
}
