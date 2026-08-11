const {app, BrowserWindow, dialog, ipcMain, Menu, session, shell} = require("electron")
const {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} = require("node:fs")
const {homedir} = require("node:os")
const {join} = require("node:path")
const {pathToFileURL} = require("node:url")

const {CodexRuntimeProvider} = require("./codex-runtime-provider.cjs")
const {CodeBuddyRuntimeProvider} = require("./codebuddy-runtime-provider.cjs")
const {AutomaticCaptureManager} = require("./automatic-capture.cjs")
const {CurationManager} = require("./curation-manager.cjs")
const {EvaluationRunner} = require("./evaluation-runner.cjs")
const {LocalEvaluationStore, reasoningEffort} = require("./local-store.cjs")
const {resolveExecutionPolicy} = require("./execution-policy.cjs")
const {requireLocalPath, requireWebUrl} = require("./link-targets.cjs")
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
let evaluationRunner = null
let workspaceRoot = null
let rendererUrl = null
let runtimeStart = null
let runtimeOperationTail = Promise.resolve()
let quitAfterRuntimeStops = false
const loadedThreads = new Set()
const activeThreads = new Set()

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
    nextClient.on("state", (state) => {
        if (state.status === "stopped" || state.status === "error") activeThreads.clear()
        send("runtime:state", enrichRuntimeState(state))
    })
    nextClient.on("notification", (message) => {
        void curationManager?.handleNotification(message)
        void automaticCaptureManager?.handleNotification(message)
        const params = message?.params ?? {}
        const threadId = params.threadId ?? params.thread?.id ?? null
        if (threadId && message.method === "turn/started") activeThreads.add(threadId)
        if (threadId && message.method === "turn/completed") activeThreads.delete(threadId)
        if (threadId && message.method === "thread/status/changed") {
            const type =
                typeof params.status === "string" ? params.status : params.status?.type
            if (type === "active" || type === "running" || type === "inProgress") {
                activeThreads.add(threadId)
            } else {
                activeThreads.delete(threadId)
            }
        }
        if (threadId && message.method === "error" && !params.willRetry) {
            activeThreads.delete(threadId)
        }
        if (threadId && message.method === "thread/archived") {
            activeThreads.delete(threadId)
            loadedThreads.delete(threadId)
        }
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

function currentExecutionPolicy() {
    return resolveExecutionPolicy(store?.read().settings)
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
        executionPolicy: currentExecutionPolicy(),
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
    activeThreads.clear()
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
    activeThreads.clear()
    client?.setWorkspace(workspaceRoot)
    if (evaluationRunner) evaluationRunner.workspaceRoot = workspaceRoot
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

    ipcMain.handle("runtime:list-threads", async (_event, input = {}) => {
        const archived = Boolean(input.archived)
        if (archived && !runtimeDescriptor?.capabilities?.includes("thread-archive")) {
            return {data: [], nextCursor: null, unsupported: true}
        }
        const response = await (await ensureRuntime()).listThreads({archived})
        const hidden = curationManager.hiddenThreadIds()
        return {...response, data: (response.data ?? []).filter((thread) => !hidden.has(thread.id))}
    })
    ipcMain.handle("runtime:archive-thread", async (_event, threadId) => {
        threadId = requireIdentifier(threadId, "thread")
        if (!runtimeDescriptor?.capabilities?.includes("thread-archive")) {
            throw new Error("The active runtime does not support conversation archive history")
        }
        const runtime = await ensureRuntime()
        if (activeThreads.has(threadId)) {
            const response = await runtime.readThread(threadId)
            const status = response.thread?.status
            const type = typeof status === "string" ? status : status?.type
            if (type === "active" || type === "running" || type === "inProgress") {
                throw new Error("Stop the running task before archiving this conversation")
            }
            activeThreads.delete(threadId)
        }
        if (typeof runtime.archiveThread !== "function") {
            throw new Error("The active runtime does not support conversation archive history")
        }
        const response = await runtime.archiveThread(threadId)
        loadedThreads.delete(threadId)
        return response
    })
    ipcMain.handle("runtime:unarchive-thread", async (_event, threadId) => {
        threadId = requireIdentifier(threadId, "thread")
        if (!runtimeDescriptor?.capabilities?.includes("thread-archive")) {
            throw new Error("The active runtime does not support conversation archive history")
        }
        const runtime = await ensureRuntime()
        if (typeof runtime.unarchiveThread !== "function") {
            throw new Error("The active runtime does not support conversation archive history")
        }
        return runtime.unarchiveThread(threadId)
    })
    ipcMain.handle("links:open-external", async (_event, value) => {
        const url = requireWebUrl(value)
        await shell.openExternal(url)
        return url
    })
    ipcMain.handle("links:open-local", async (_event, value) => {
        const target = requireLocalPath(value)
        if (!existsSync(target.path)) throw new Error("The linked local file no longer exists")
        shell.showItemInFolder(target.path)
        return target
    })
    ipcMain.handle("models:list", async () => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listModels !== "function") return {data: [], nextCursor: null}
        return runtime.listModels()
    })
    ipcMain.handle("models:list-for-runtime", async (_event, runtimeId) => {
        runtimeId = requireIdentifier(runtimeId, "runtime")
        const descriptor = availableRuntimes.find((entry) => entry.runtimeId === runtimeId)
        if (!descriptor) throw new Error("The selected local runtime is no longer available")
        if (descriptor.runtimeId === runtimeDescriptor?.runtimeId) {
            const runtime = await ensureRuntime()
            return typeof runtime.listModels === "function"
                ? runtime.listModels()
                : {data: [], nextCursor: null}
        }
        const temporaryClient = runtimeRegistry.createClient(descriptor, {
            traceDirectory: join(app.getPath("userData"), "traces", "catalogs"),
            workspaceRoot,
            executionPolicy: currentExecutionPolicy(),
        })
        try {
            await temporaryClient.start()
            return typeof temporaryClient.listModels === "function"
                ? temporaryClient.listModels()
                : {data: [], nextCursor: null}
        } finally {
            await temporaryClient.stop().catch(() => {})
        }
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
        const effort = optionalEffort(input.effort)
        const response = await (await ensureRuntime()).startThread({
            ...(model ? {model} : {}),
            ...(effort ? {effort} : {}),
        })
        loadedThreads.add(response.thread.id)
        return response
    })
    ipcMain.handle("runtime:start-turn", async (_event, {threadId, text, modelId, effort}) => {
        threadId = requireIdentifier(threadId, "thread")
        const input = normalizeTurnInput(text)
        const model = optionalIdentifier(modelId, "model")
        effort = optionalEffort(effort)
        const options = {
            ...(model ? {model} : {}),
            ...(effort ? {effort} : {}),
        }
        const runtime = await ensureRuntime()
        if (!loadedThreads.has(threadId)) {
            await runtime.resumeThread(threadId, options)
            loadedThreads.add(threadId)
        }
        activeThreads.add(threadId)
        try {
            return await runtime.startTurn(threadId, input, options)
        } catch (error) {
            activeThreads.delete(threadId)
            throw error
        }
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
    ipcMain.handle("datasets:delete", (_event, datasetId) =>
        store.deleteDataset(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("datasets:delete-case", (_event, input = {}) =>
        store.deleteCase(
            requireIdentifier(input.datasetId, "dataset"),
            requireIdentifier(input.caseId, "Case"),
        ),
    )
    ipcMain.handle("datasets:reveal", revealLocalData)
    ipcMain.handle("settings:update", (_event, input) => {
        const settings = store.updateSettings(input)
        client?.setExecutionPolicy?.(currentExecutionPolicy())
        return settings
    })

    ipcMain.handle("curation:list", () => store.listCurationSessions())
    ipcMain.handle("curation:list-archived", () => store.listArchivedCurationSessions())
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
            effort: profile.effort,
            skillPath: requireAbsolutePath(input.skillPath, "Skill"),
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
    ipcMain.handle("curation:update-effort", (_event, input = {}) =>
        curationManager.updateEffort(
            requireIdentifier(input.sessionId, "curation session"),
            optionalEffort(input.effort),
        ),
    )
    ipcMain.handle("curation:update-profile", (_event, input) =>
        store.updateCuratorProfile(input),
    )

    ipcMain.handle("evaluations:list", (_event, datasetId) =>
        store.listEvaluationRunSummaries(
            datasetId ? requireIdentifier(datasetId, "dataset") : null,
        ),
    )
    ipcMain.handle("evaluations:get", (_event, runId) =>
        store.getEvaluationRun(requireIdentifier(runId, "evaluation run")),
    )
    ipcMain.handle("evaluations:delete", (_event, runId) =>
        store.deleteEvaluationRun(requireIdentifier(runId, "evaluation run")),
    )
    ipcMain.handle("evaluations:start", (_event, input = {}) => {
        const runtimeConfigurations = (input.runtimeConfigurations ?? []).map((requested) => {
            const runtimeId = requireIdentifier(requested.runtimeId, "runtime")
            const descriptor = availableRuntimes.find((entry) => entry.runtimeId === runtimeId)
            if (!descriptor) throw new Error(`Runtime ${runtimeId} is no longer available`)
            return {
                ...descriptor,
                modelId: optionalIdentifier(requested.modelId, "model"),
                effort: optionalEffort(requested.effort),
            }
        })
        const skillName = requireIdentifier(input.skillReference?.name, "Skill")
        const skillPath = requireAbsolutePath(input.skillReference?.path, "Skill")
        const run = store.createEvaluationRun({
            datasetId: requireIdentifier(input.datasetId, "dataset"),
            caseIds: (input.caseIds ?? []).map((caseId) =>
                requireIdentifier(caseId, "Case"),
            ),
            selectionMode: input.selectionMode,
            activationMode: input.activationMode,
            skillReference: {name: skillName, path: skillPath},
            runtimeConfigurations,
        })
        void evaluationRunner.run(run).catch((error) => {
            store.updateEvaluationRun(run.id, {
                status: "failed",
                completedAt: new Date().toISOString(),
            })
            send("evaluation:changed", {runId: run.id, status: "failed", error: error.message})
        })
        return run
    })
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

function optionalEffort(value) {
    return reasoningEffort(value, "Reasoning effort")
}

function requireAbsolutePath(value, label) {
    const path = String(value ?? "")
    if (!path.startsWith("/") || path.length > 4_096) {
        throw new Error(`A valid absolute ${label} path is required`)
    }
    return path
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
            const path = requireAbsolutePath(part.path, "Skill")
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
        runtimeRegistry = new RuntimeRegistry([
            new CodexRuntimeProvider(),
            new CodeBuddyRuntimeProvider(),
        ])
        evaluationRunner = new EvaluationRunner({
            store,
            runtimeRegistry,
            workspaceRoot,
            traceDirectory: join(app.getPath("userData"), "traces", "evaluations"),
            getExecutionPolicy: currentExecutionPolicy,
            onChanged: (update) => send("evaluation:changed", update),
        })
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
        if (quitAfterRuntimeStops) return
        event.preventDefault()
        quitAfterRuntimeStops = true
        void Promise.all([
            client?.stop?.() ?? Promise.resolve(),
            evaluationRunner?.stopAll?.() ?? Promise.resolve(),
        ]).finally(() => app.quit())
    })

    app.on("window-all-closed", () => {
        // Keep the local app-server available while the macOS app remains in the Dock.
    })
}
