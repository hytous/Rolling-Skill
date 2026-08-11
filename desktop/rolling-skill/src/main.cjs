const {app, BrowserWindow, dialog, ipcMain, Menu, session, shell} = require("electron")
const {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} = require("node:fs")
const {homedir} = require("node:os")
const {join} = require("node:path")
const {pathToFileURL} = require("node:url")

const {CodexRuntimeProvider} = require("./codex-runtime-provider.cjs")
const {AutomaticCaptureManager} = require("./automatic-capture.cjs")
const {CurationManager} = require("./curation-manager.cjs")
const {LocalEvaluationStore} = require("./local-store.cjs")
const {RuntimeRegistry} = require("./runtime-registry.cjs")
const {findGitWorkspace} = require("./workspace.cjs")

const RENDERER_FILE = join(__dirname, "..", "renderer", "index.html")
const PRELOAD_FILE = join(__dirname, "preload.cjs")

let mainWindow = null
let client = null
let runtimeRegistry = null
let runtimeDescriptor = null
let availableRuntimes = []
let store = null
let curationManager = null
let automaticCaptureManager = null
let workspaceRoot = null
let rendererUrl = null
let runtimeStart = null
let runtimeOperationTail = Promise.resolve()
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

function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function installClientEvents(nextClient) {
    nextClient.on("state", (state) => send("runtime:state", enrichRuntimeState(state)))
    nextClient.on("notification", (message) => {
        void curationManager?.handleNotification(message)
        void automaticCaptureManager?.handleNotification(message)
        const params = message?.params ?? {}
        const threadId = params.threadId ?? params.thread?.id ?? null
        const hidden =
            (threadId && curationManager?.hiddenThreadIds().has(threadId)) ||
            params.thread?.threadSource === "subagent"
        if (!hidden) send("runtime:notification", message)
    })
    nextClient.on("runtimeError", (error) => {
        send("runtime:state", {
            ...enrichRuntimeState(nextClient.state()),
            status: "error",
            error: error.message,
        })
    })
}

function preferredRuntime() {
    const selected = readPreferences().runtimeSelection
    return selected && typeof selected === "object" ? selected : null
}

function discoverLocalRuntimes(options = {}) {
    const preferred = options.preferredRuntime ?? preferredRuntime()
    const discovery = runtimeRegistry.discover({
        preferredRuntime: preferred,
        commonProviderOptions: {configuredPath: preferred?.executablePath ?? null},
    })
    availableRuntimes = discovery.available
    runtimeDescriptor = discovery.selected
    return discovery
}

function enrichRuntimeState(state) {
    return {...state, availableRuntimes}
}

function unavailableRuntimeState(error = null) {
    return {
        status: "unavailable",
        workspaceRoot,
        runtime: null,
        availableRuntimes,
        error:
            error?.message ??
            "No compatible local agent runtime was found. Install one, rescan, or choose its executable.",
    }
}

function createClient() {
    if (!runtimeDescriptor) return null
    const nextClient = runtimeRegistry.createClient(runtimeDescriptor, {
        traceDirectory: join(app.getPath("userData"), "traces"),
        workspaceRoot,
    })
    installClientEvents(nextClient)
    return nextClient
}

async function ensureRuntime() {
    if (client?.ready) return client
    if (!client) {
        if (!runtimeDescriptor) discoverLocalRuntimes()
        client = createClient()
    }
    if (!client) {
        const error = new Error("No compatible local agent runtime is available")
        error.code = "RUNTIME_UNAVAILABLE"
        throw error
    }
    if (!runtimeStart) {
        runtimeStart = client.start().finally(() => {
            runtimeStart = null
        })
    }
    await runtimeStart
    return client
}

function enqueueRuntimeOperation(operation) {
    const result = runtimeOperationTail.then(operation, operation)
    runtimeOperationTail = result.catch(() => {})
    return result
}

async function restartRuntimeNow({rediscover = false} = {}) {
    if (client) await client.stop()
    runtimeStart = null
    loadedThreads.clear()
    client = null
    if (rediscover || !runtimeDescriptor) discoverLocalRuntimes()
    client = createClient()
    if (!client) {
        const state = unavailableRuntimeState()
        send("runtime:state", state)
        return state
    }
    try {
        await ensureRuntime()
        return enrichRuntimeState(client.state())
    } catch (error) {
        const state =
            error.code === "RUNTIME_UNAVAILABLE"
                ? unavailableRuntimeState(error)
                : {...enrichRuntimeState(client.state()), status: "error", error: error.message}
        send("runtime:state", state)
        return state
    }
}

function restartRuntime(options) {
    return enqueueRuntimeOperation(() => restartRuntimeNow(options))
}

async function detectLocalRuntimes() {
    return enqueueRuntimeOperation(() => restartRuntimeNow({rediscover: true}))
}

async function chooseRuntimeExecutable() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Choose a local agent runtime executable",
        properties: ["openFile"],
        message: "The executable must identify a supported provider and pass its compatibility probe.",
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const executablePath = result.filePaths[0]
    const discovery = runtimeRegistry.discover({
        preferredRuntime: {executablePath},
        commonProviderOptions: {configuredPath: executablePath},
    })
    const selected = discovery.available.find(
        (runtime) => runtime.executablePath === executablePath,
    )
    if (!selected) {
        await dialog.showMessageBox(mainWindow, {
            type: "error",
            message: "Unsupported agent runtime",
            detail: "The selected executable did not pass any registered runtime provider probe.",
        })
        return null
    }
    return enqueueRuntimeOperation(async () => {
        writePreferences({
            runtimeSelection: {
                runtimeId: selected.runtimeId,
                providerId: selected.providerId,
                executablePath: selected.executablePath,
            },
        })
        availableRuntimes = discovery.available
        runtimeDescriptor = selected
        return restartRuntimeNow()
    })
}

async function useAutomaticRuntimeSelection() {
    return enqueueRuntimeOperation(async () => {
        writePreferences({runtimeSelection: null})
        runtimeDescriptor = null
        return restartRuntimeNow({rediscover: true})
    })
}

async function selectDiscoveredRuntime(runtimeId) {
    runtimeId = requireIdentifier(runtimeId, "runtime")
    return enqueueRuntimeOperation(async () => {
        const selected = availableRuntimes.find((runtime) => runtime.runtimeId === runtimeId)
        if (!selected) throw new Error("The selected local runtime is no longer available")
        writePreferences({
            runtimeSelection: {
                runtimeId: selected.runtimeId,
                providerId: selected.providerId,
                executablePath: selected.executablePath,
            },
        })
        runtimeDescriptor = selected
        return restartRuntimeNow()
    })
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
                if (process.env.ROLLING_SKILL_SMOKE_SURFACE === "evaluation") {
                    await mainWindow.webContents.executeJavaScript(
                        'document.querySelector("[data-surface=evaluation]")?.click()',
                    )
                    await new Promise((resolve) => setTimeout(resolve, 800))
                }
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
                    {
                        label: "Restart Active Runtime",
                        click: () => void restartRuntime(),
                    },
                    {
                        label: "Detect Local Runtimes",
                        accelerator: "CommandOrControl+Shift+R",
                        click: () => void detectLocalRuntimes(),
                    },
                    {
                        label: "Choose Runtime Executable…",
                        click: () => void chooseRuntimeExecutable(),
                    },
                    {
                        label: "Use Automatic Runtime Selection",
                        click: () => void useAutomaticRuntimeSelection(),
                    },
                    {type: "separator"},
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
        const runtime = client
            ? enrichRuntimeState(client.state())
            : runtimeDescriptor
              ? enrichRuntimeState({status: "starting", workspaceRoot, runtime: runtimeDescriptor})
              : unavailableRuntimeState()
        return {
            runtime,
            workspaceRoot,
            datasets: store.listDatasets(),
            curationSessions: store.listCurationSessions(),
            curatorProfile: store.read().settings.curatorProfile,
            settings: store.read().settings,
        }
    })
    ipcMain.handle("workspace:choose", chooseWorkspace)
    ipcMain.handle("runtime:restart", restartRuntime)
    ipcMain.handle("runtime:detect", detectLocalRuntimes)
    ipcMain.handle("runtime:choose", chooseRuntimeExecutable)
    ipcMain.handle("runtime:automatic", useAutomaticRuntimeSelection)
    ipcMain.handle("runtime:select", (_event, runtimeId) =>
        selectDiscoveredRuntime(runtimeId),
    )
    ipcMain.handle("runtime:trace", (_event, limit) =>
        client?.recentTrace(limit) ?? {path: null, reference: null, events: []},
    )
    ipcMain.handle("runtime:open-traces", openTraceFolder)

    ipcMain.handle("runtime:list-threads", async () => {
        const response = await (await ensureRuntime()).listThreads()
        const hidden = curationManager.hiddenThreadIds()
        return {...response, data: (response.data ?? []).filter((thread) => !hidden.has(thread.id))}
    })
    ipcMain.handle("models:list", async () => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listModels !== "function") return {data: [], nextCursor: null}
        return runtime.listModels()
    })
    ipcMain.handle("skills:list", async (_event, input = {}) => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listSkills !== "function") return {data: []}
        return runtime.listSkills({forceReload: Boolean(input.forceReload)})
    })
    ipcMain.handle("plugins:list", async () => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listPlugins !== "function") return {marketplaces: []}
        return runtime.listPlugins()
    })
    ipcMain.handle("plugins:installed", async () => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listInstalledPlugins !== "function") return {marketplaces: []}
        return runtime.listInstalledPlugins()
    })
    ipcMain.handle("plugins:install", async (_event, input = {}) => {
        const runtime = await ensureRuntime()
        if (typeof runtime.installPlugin !== "function") {
            throw new Error("The active runtime does not support plugin installation")
        }
        const pluginName = requireIdentifier(input.pluginName, "plugin")
        const response = await runtime.installPlugin({
            pluginName,
            marketplacePath: input.marketplacePath ?? null,
            remoteMarketplaceName: input.remoteMarketplaceName ?? null,
        })
        await runtime.listSkills({forceReload: true})
        return response
    })
    ipcMain.handle("runtime:read-thread", async (_event, threadId) => {
        threadId = requireIdentifier(threadId, "thread")
        if (curationManager.hiddenThreadIds().has(threadId)) {
            throw new Error("Curator threads are available through curation sessions only")
        }
        return (await ensureRuntime()).readThread(threadId)
    })
    ipcMain.handle("runtime:start-thread", async (_event, input = {}) => {
        const model = optionalIdentifier(input.modelId, "model")
        const response = await (await ensureRuntime()).startThread(model ? {model} : {})
        loadedThreads.add(response.thread.id)
        return response
    })
    ipcMain.handle("runtime:start-turn", async (_event, {threadId, text, modelId}) => {
        threadId = requireIdentifier(threadId, "thread")
        const input = normalizeTurnInput(text)
        const model = optionalIdentifier(modelId, "model")
        const runtime = await ensureRuntime()
        if (!loadedThreads.has(threadId)) {
            await runtime.resumeThread(threadId, model ? {model} : {})
            loadedThreads.add(threadId)
        }
        return runtime.startTurn(threadId, input, model ? {model} : {})
    })
    ipcMain.handle("runtime:interrupt-turn", async (_event, input) =>
        (await ensureRuntime()).interruptTurn(
            requireIdentifier(input.threadId, "thread"),
            requireIdentifier(input.turnId, "turn"),
        ),
    )
    ipcMain.handle("datasets:list", () => store.listDatasets())
    ipcMain.handle("datasets:list-cases", (_event, datasetId) =>
        store.listCases(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("datasets:create", (_event, name) => store.createDataset(name))
    ipcMain.handle("datasets:reveal", revealLocalData)
    ipcMain.handle("settings:update", (_event, input) => store.updateSettings(input))

    ipcMain.handle("curation:list", () => store.listCurationSessions())
    ipcMain.handle("curation:get", (_event, sessionId) =>
        store.getCurationSession(requireIdentifier(sessionId, "curation session")),
    )
    ipcMain.handle("curation:create", async (_event, input = {}) => {
        const sourceThreadId = requireIdentifier(input.sourceThreadId, "source thread")
        const startItemId = input.startItemId
            ? requireIdentifier(input.startItemId, "episode start item")
            : null
        const endItemId = requireIdentifier(input.endItemId, "episode end item")
        const traceReference = client?.recorder?.referenceForEpisode({
            threadId: sourceThreadId,
            startItemId,
            endItemId,
        })
        const profile = store.read().settings.curatorProfile
        return curationManager.createSession({
            datasetId: requireIdentifier(input.datasetId, "dataset"),
            caseType: input.caseType,
            sourceThreadId,
            startItemId,
            endItemId,
            traceReference,
            modelId: profile.modelId,
        })
    })
    ipcMain.handle("curation:send", (_event, input = {}) =>
        curationManager.sendMessage(
            requireIdentifier(input.sessionId, "curation session"),
            String(input.text ?? ""),
        ),
    )
    ipcMain.handle("curation:retry", (_event, sessionId) =>
        curationManager.retry(requireIdentifier(sessionId, "curation session")),
    )
    ipcMain.handle("curation:archive", (_event, sessionId) =>
        curationManager.archive(requireIdentifier(sessionId, "curation session")),
    )
    ipcMain.handle("curation:discard", (_event, sessionId) =>
        curationManager.discard(requireIdentifier(sessionId, "curation session")),
    )
    ipcMain.handle("curation:update-model", (_event, input = {}) =>
        curationManager.updateModel(
            requireIdentifier(input.sessionId, "curation session"),
            optionalIdentifier(input.modelId, "model"),
        ),
    )
    ipcMain.handle("curation:update-profile", (_event, input) =>
        store.updateCuratorProfile(input),
    )
}

function requireIdentifier(value, label) {
    if (typeof value !== "string" || !value || value.length > 200) {
        throw new Error(`A valid ${label} identifier is required`)
    }
    return value
}

function optionalIdentifier(value, label) {
    if (value === null || value === undefined || String(value).trim() === "") return null
    return requireIdentifier(String(value).trim(), label)
}

function normalizeTurnInput(value) {
    if (!Array.isArray(value)) {
        const text = String(value ?? "")
        if (!text.trim()) throw new Error("Task text is required")
        return text
    }
    if (!value.length || value.length > 20) throw new Error("Task input is invalid")
    let hasText = false
    const normalized = value.map((part) => {
        if (part?.type === "text") {
            const text = String(part.text ?? "")
            if (!text.trim()) throw new Error("Task text is required")
            hasText = true
            return {type: "text", text, text_elements: []}
        }
        if (part?.type === "skill") {
            const name = requireIdentifier(part.name, "Skill")
            const path = String(part.path ?? "")
            if (!path.startsWith("/") || path.length > 4_096) {
                throw new Error("A valid absolute Skill path is required")
            }
            return {type: "skill", name, path}
        }
        throw new Error("Only text and Skill inputs are supported")
    })
    if (!hasText) throw new Error("Task input requires text")
    return normalized
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
        curationManager = new CurationManager({
            store,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
            onChanged: (session) => send("curation:changed", session),
        })
        automaticCaptureManager = new AutomaticCaptureManager({
            store,
            curationManager,
            getTraceReference: (episode) => client?.recorder?.referenceForEpisode(episode) ?? null,
            onError: (error) => send("runtime:state", {
                ...enrichRuntimeState(client?.state() ?? {workspaceRoot}),
                error: `Automatic capture failed: ${error.message}`,
            }),
        })
        runtimeRegistry = new RuntimeRegistry([new CodexRuntimeProvider()])
        discoverLocalRuntimes()
        client = createClient()
        installIpc()
        installMenu()
        createWindow()
        void ensureRuntime().catch((error) => {
            send(
                "runtime:state",
                error.code === "RUNTIME_UNAVAILABLE"
                    ? unavailableRuntimeState(error)
                    : {
                          ...enrichRuntimeState(client?.state() ?? {workspaceRoot}),
                          status: "error",
                          error: error.message,
                      },
            )
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
