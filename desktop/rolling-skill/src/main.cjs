const {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    powerSaveBlocker,
    session,
    shell,
} = require("electron")
const {chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync} = require("node:fs")
const {homedir} = require("node:os")
const {join} = require("node:path")
const {pathToFileURL} = require("node:url")

const {CodexRuntimeProvider} = require("./codex-runtime-provider.cjs")
const {CodeBuddyRuntimeProvider} = require("./codebuddy-runtime-provider.cjs")
const {DeepSeekHarnessRuntimeProvider} = require("./deepseek-harness-runtime-provider.cjs")
const {AutomaticCaptureManager} = require("./automatic-capture.cjs")
const {CurationManager} = require("./curation-manager.cjs")
const {RubricManager} = require("./rubric-manager.cjs")
const {EvaluationRunner} = require("./evaluation-runner.cjs")
const {EvaluationPowerGuard} = require("./evaluation-power-guard.cjs")
const {
    buildDatasetCsv,
    datasetExportFilename,
    originalFinalAssistantMessages,
} = require("./dataset-csv-export.cjs")
const {
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
} = require("./evaluation-skill-binding.cjs")
const {snapshotSkillEvidence} = require("./evaluation-skill-evidence.cjs")
const {LocalEvaluationStore, reasoningEffort} = require("./local-store.cjs")
const {resolveExecutionPolicy, resolveRuntimePermission} = require("./execution-policy.cjs")
const {requireLocalPath, requireWebUrl} = require("./link-targets.cjs")
const {readThreadProfile, updateThreadProfiles} = require("./thread-profile-store.cjs")
const {ThreadActivityStore} = require("./thread-activity-store.cjs")
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
let rubricManager = null
let automaticCaptureManager = null
let evaluationRunner = null
let activityStore = null
let workspaceRoot = null
let rendererUrl = null
let runtimeStart = null
let runtimeOperationTail = Promise.resolve()
let clientGeneration = 0
const permissionDialogTails = new Map()
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

function currentThreadProfile(threadId, runtimeId = runtimeDescriptor?.runtimeId) {
    return readThreadProfile(readPreferences(), runtimeId, threadId)
}

function rememberThreadProfile(threadId, patch, runtimeId = runtimeDescriptor?.runtimeId) {
    if (!runtimeId || !threadId) return null
    const preferences = readPreferences()
    const threadProfiles = updateThreadProfiles(
        preferences.threadProfiles,
        runtimeId,
        threadId,
        patch,
    )
    writePreferences({threadProfiles})
    return readThreadProfile({threadProfiles}, runtimeId, threadId)
}

function attachThreadProfile(
    response,
    threadId = response?.thread?.id,
    runtimeId = runtimeDescriptor?.runtimeId,
) {
    const rollingSkillProfile = currentThreadProfile(threadId, runtimeId)
    if (!response?.thread || !rollingSkillProfile) return response
    return {...response, thread: {...response.thread, rollingSkillProfile}}
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

function installClientEvents(nextClient, sourceRuntimeId) {
    nextClient.on("state", (state) => {
        if (state.status === "stopped" || state.status === "error") activeThreads.clear()
        send("runtime:state", enrichRuntimeState(state))
    })
    nextClient.on("notification", (message) => {
        void curationManager?.handleNotification(message)
        void rubricManager?.handleNotification(message)
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
        if (threadId && message.method === "thread/settings/updated") {
            const threadSettings = params.threadSettings ?? params.settings ?? {}
            const patch = {}
            if ("model" in threadSettings) patch.modelId = threadSettings.model
            if ("effort" in threadSettings) patch.effort = threadSettings.effort
            else if ("reasoningEffort" in threadSettings) {
                patch.effort = threadSettings.reasoningEffort
            }
            if (Object.keys(patch).length) {
                rememberThreadProfile(threadId, patch, sourceRuntimeId)
            }
        }
        const hidden =
            (threadId && curationManager?.hiddenThreadIds().has(threadId)) ||
            (threadId && rubricManager?.hiddenThreadIds().has(threadId)) ||
            params.thread?.threadSource === "subagent"
        if (!hidden) {
            activityStore?.captureNotification(sourceRuntimeId, message)
            send("runtime:notification", message)
        }
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

function runtimePermissionFor(providerId, requestedMode = null) {
    return resolveRuntimePermission(
        providerId,
        requestedMode,
        store?.read().settings,
    )
}

function permissionOptionId(option = {}) {
    return String(option.optionId ?? option.name ?? "")
}

function permissionOptionKind(option = {}) {
    return String(option.kind ?? "")
}

function isRejectionOption(option = {}) {
    return /reject|deny|decline|cancel/i.test(
        `${permissionOptionKind(option)} ${permissionOptionId(option)} ${option.name ?? ""}`,
    )
}

function permissionOptionLabel(option = {}, language = store?.read().settings.language) {
    const id = permissionOptionKind(option) || permissionOptionId(option)
    const english = {
        allow: "Allow once",
        allow_once: "Allow once",
        allow_always: "Always allow",
        allow_session: "Allow for session",
        reject: "Deny",
        reject_once: "Deny",
        reject_always: "Always deny",
        deny: "Deny",
        decline: "Deny",
        cancel: "Cancel",
    }
    const chinese = {
        allow: "仅本次允许",
        allow_once: "仅本次允许",
        allow_always: "始终允许",
        allow_session: "本会话允许",
        reject: "拒绝",
        reject_once: "拒绝",
        reject_always: "始终拒绝",
        deny: "拒绝",
        decline: "拒绝",
        cancel: "取消",
    }
    const translated = language === "zh-CN" ? chinese[id] : english[id]
    return String((translated ?? option.name ?? id) || (language === "zh-CN" ? "拒绝" : "Deny"))
}

function permissionRequestDetail(params = {}, request = {}) {
    const toolCall = params.toolCall ?? {}
    const value =
        toolCall.rawInput ??
        params.rawInput ??
        params.command ??
        params.reason ??
        toolCall.content ??
        ""
    const detail = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    const lines = []
    if (request.workspaceRoot) lines.push(`Workspace: ${request.workspaceRoot}`)
    if (params.sessionId) lines.push(`Session: ${params.sessionId}`)
    if (Array.isArray(toolCall.locations) && toolCall.locations.length) {
        lines.push(`Locations: ${JSON.stringify(toolCall.locations)}`)
    }
    if (detail) lines.push(detail)
    return lines.join("\n")
}

async function showRuntimePermissionDialog(request = {}) {
    const options = Array.isArray(request.options) ? request.options : []
    const rejectedIndex = options.findIndex(isRejectionOption)
    if (rejectedIndex < 0) throw new Error("Permission request has no explicit rejection option")
    if (!mainWindow || mainWindow.isDestroyed()) return permissionOptionId(options[rejectedIndex])
    const params = request.params ?? {}
    const toolCall = params.toolCall ?? {}
    const title = String(
        toolCall._meta?.["codebuddy.ai/toolName"] ??
            toolCall.name ??
            toolCall.title ??
            params.title ??
            params.toolName ??
            "Tool permission",
    )
    const language = store?.read().settings.language ?? "zh-CN"
    const runtimeName = request.runtime?.displayName ?? "Runtime"
    const sessionLabel = params.sessionId ? ` · ${params.sessionId}` : ""
    const result = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: language === "zh-CN" ? "运行时权限" : "Runtime permission",
        message:
            language === "zh-CN"
                ? `${runtimeName} 请求执行：${title}${sessionLabel}`
                : `${runtimeName} requests permission: ${title}${sessionLabel}`,
        detail: permissionRequestDetail(params, request),
        buttons: options.map((option) => permissionOptionLabel(option, language)),
        defaultId: rejectedIndex,
        cancelId: rejectedIndex,
        noLink: true,
    })
    return permissionOptionId(options[result.response] ?? options[rejectedIndex])
}

function requestRuntimePermission(request = {}) {
    const options = Array.isArray(request.options) ? request.options : []
    const rejection = options.find(isRejectionOption)
    if (!rejection) return Promise.reject(new Error("Permission request has no explicit rejection option"))
    const rejectionId = permissionOptionId(rejection)
    const generation = request.clientGeneration
    const processEpoch = request.processEpoch ?? null
    const permissionQueueId = `${generation}:${processEpoch ?? "runtime"}`
    const isCurrent = () =>
        generation === clientGeneration &&
        request.runtimeId === runtimeDescriptor?.runtimeId &&
        request.sourceClient === client &&
        (processEpoch === null || request.sourceClient?.processEpoch === processEpoch)
    const respond = async () => {
        if (!isCurrent()) return rejectionId
        const selected = await showRuntimePermissionDialog(request).catch(() => rejectionId)
        if (!isCurrent()) return rejectionId
        return options.some((option) => permissionOptionId(option) === selected)
            ? selected
            : rejectionId
    }
    const previous = permissionDialogTails.get(permissionQueueId) ?? Promise.resolve()
    const operation = previous.then(respond, respond)
    const tail = operation.catch(() => {}).finally(() => {
        if (permissionDialogTails.get(permissionQueueId) === tail) {
            permissionDialogTails.delete(permissionQueueId)
        }
    })
    permissionDialogTails.set(permissionQueueId, tail)
    return operation
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

async function skillEvidenceBindingForRuntime(descriptor, skillReference) {
    return resolveSkillEvidenceBinding({
        descriptor,
        selectedRuntimeId: runtimeDescriptor?.runtimeId,
        getSelectedRuntime: ensureRuntime,
        createClient: (candidate, options) => runtimeRegistry.createClient(candidate, options),
        clientOptions: {
            traceDirectory: join(app.getPath("userData"), "traces", "catalogs"),
            workspaceRoot,
            executionPolicy: currentExecutionPolicy(),
        },
        skillReference,
    })
}

async function currentRuntimeSkillReference(value) {
    const name = requireIdentifier(value?.name, "Skill")
    const path = requireAbsolutePath(value?.path, "Skill")
    const runtime = await ensureRuntime()
    if (typeof runtime.listSkills !== "function") {
        throw new Error("The active runtime cannot verify installed Skills")
    }
    const response = await runtime.listSkills({forceReload: true})
    const requested = {name, path}
    const allowNameOnly = runtimeDescriptor?.capabilities?.includes("skills-name-only")
    if (!runtimeReportsSkill(response, requested, {allowNameOnly})) {
        throw new Error(
            "The selected Skill is not installed and enabled in the active runtime and workspace",
        )
    }
    const reported = response.data
        .flatMap((entry) => entry.skills ?? [])
        .find((skill) =>
            skill.enabled &&
            skill.name === name &&
            (skill.path === path || (allowNameOnly && skill.evidencePrecision === "name-only")),
        )
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name,
        path,
        scope: reported?.scope ?? null,
        description: reported?.description ?? reported?.interface?.shortDescription ?? null,
        runtimeId: runtimeDescriptor?.runtimeId ?? null,
        confirmedAt: new Date().toISOString(),
    }
}

async function requireAvailableDatasetSkill(dataset) {
    if (!dataset?.skillReference) {
        throw new Error("Bind an enabled Skill to this dataset before continuing")
    }
    await currentRuntimeSkillReference(dataset.skillReference)
    return dataset.skillReference
}

function requirePublishedDatasetRubric(dataset) {
    if (!dataset?.activeRubricVersionId) {
        throw new Error(
            "Publish a dataset scoring rubric before capturing Cases or starting an evaluation",
        )
    }
    return store.getDatasetRubricVersion(dataset.activeRubricVersionId)
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
    const sourceRuntime = runtimeDescriptor
    const sourceGeneration = ++clientGeneration
    let nextClient = null
    nextClient = runtimeRegistry.createClient(runtimeDescriptor, {
        traceDirectory: join(app.getPath("userData"), "traces"),
        workspaceRoot,
        executionPolicy: currentExecutionPolicy(),
        requestPermission: (request) =>
            requestRuntimePermission({
                ...request,
                runtime: sourceRuntime,
                runtimeId: sourceRuntime.runtimeId,
                clientGeneration: sourceGeneration,
                sourceClient: nextClient,
                workspaceRoot:
                    nextClient?.sessions?.get(request.params?.sessionId)?.cwd ??
                    nextClient?.workspaceRoot ??
                    workspaceRoot,
            }),
    })
    installClientEvents(nextClient, runtimeDescriptor.runtimeId)
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
    clientGeneration += 1
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
    const selectedWorkspace = result.filePaths[0]
    return enqueueRuntimeOperation(async () => {
        if (activeThreads.size) {
            throw new Error("Stop active tasks before changing the workspace")
        }
        workspaceRoot = selectedWorkspace
        writePreferences({workspaceRoot})
        loadedThreads.clear()
        activeThreads.clear()
        client?.setWorkspace(workspaceRoot)
        if (evaluationRunner) evaluationRunner.workspaceRoot = workspaceRoot
        send("workspace:changed", {workspaceRoot})
        return workspaceRoot
    })
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
        const hidden = new Set([
            ...curationManager.hiddenThreadIds(),
            ...rubricManager.hiddenThreadIds(),
        ])
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
        if (
            curationManager.hiddenThreadIds().has(threadId) ||
            rubricManager.hiddenThreadIds().has(threadId)
        ) {
            throw new Error("Curator and Rubric Agent threads are available through their review sessions only")
        }
        const runtime = await ensureRuntime()
        const sourceRuntimeId = runtimeDescriptor?.runtimeId
        const sourceProviderId = runtimeDescriptor?.providerId
        const response = await runtime.readThread(threadId)
        const observedActivityCount = activityStore.list(sourceRuntimeId, threadId).length
        const withActivity = activityStore.mergeThreadResponse(sourceRuntimeId, response)
        const withCoverage = withActivity?.thread
            ? {
                  ...withActivity,
                  thread: {
                      ...withActivity.thread,
                      rollingSkillActivityHistory: {
                          observedActivityCount,
                          runtimeMayOmitItems: sourceProviderId === "codex",
                      },
                  },
              }
            : withActivity
        return attachThreadProfile(withCoverage, threadId, sourceRuntimeId)
    })
    ipcMain.handle("runtime:start-thread", async (_event, input = {}) => {
        const model = optionalIdentifier(input.modelId, "model")
        const effort = optionalEffort(input.effort)
        return enqueueRuntimeOperation(async () => {
            const runtime = await ensureRuntime()
            const sourceRuntime = runtimeDescriptor
            if (!sourceRuntime || runtime !== client) {
                throw new Error("The active runtime changed before the task could start")
            }
            const sourceRuntimeId = sourceRuntime.runtimeId
            const permission = runtimePermissionFor(
                sourceRuntime.providerId,
                input.permissionMode,
            )
            const response = await runtime.startThread({
                ...(model ? {model} : {}),
                ...(effort ? {effort} : {}),
                ...permission,
            })
            loadedThreads.add(response.thread.id)
            rememberThreadProfile(
                response.thread.id,
                {
                    modelId: model,
                    effort,
                    permissionMode: permission.permissionMode,
                },
                sourceRuntimeId,
            )
            return attachThreadProfile(response, response.thread.id, sourceRuntimeId)
        })
    })
    ipcMain.handle(
        "runtime:start-turn",
        async (_event, {threadId, text, modelId, effort, permissionMode}) => {
            threadId = requireIdentifier(threadId, "thread")
            const input = normalizeTurnInput(text)
            const model = optionalIdentifier(modelId, "model")
            effort = optionalEffort(effort)
            return enqueueRuntimeOperation(async () => {
                const runtime = await ensureRuntime()
                const sourceRuntime = runtimeDescriptor
                if (!sourceRuntime || runtime !== client) {
                    throw new Error("The active runtime changed before the turn could start")
                }
                const sourceRuntimeId = sourceRuntime.runtimeId
                const permission = runtimePermissionFor(
                    sourceRuntime.providerId,
                    permissionMode,
                )
                const options = {model, effort, ...permission}
                if (!loadedThreads.has(threadId)) {
                    await runtime.resumeThread(
                        threadId,
                        sourceRuntime.providerId === "codex" ? permission : {},
                    )
                    loadedThreads.add(threadId)
                }
                activeThreads.add(threadId)
                try {
                    const response = await runtime.startTurn(threadId, input, options)
                    rememberThreadProfile(
                        threadId,
                        {
                            modelId: model,
                            effort,
                            permissionMode: permission.permissionMode,
                        },
                        sourceRuntimeId,
                    )
                    return response
                } catch (error) {
                    activeThreads.delete(threadId)
                    throw error
                }
            })
        },
    )
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
    ipcMain.handle("datasets:create", async (_event, input = {}) =>
        store.createDataset({
            name: input.name,
            skillReference: await currentRuntimeSkillReference(input.skillReference),
        }),
    )
    ipcMain.handle("datasets:bind-skill", async (_event, input = {}) =>
        store.bindDatasetSkill(
            requireIdentifier(input.datasetId, "dataset"),
            await currentRuntimeSkillReference(input.skillReference),
        ),
    )
    ipcMain.handle("datasets:delete", (_event, datasetId) =>
        store.deleteDataset(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("datasets:export-csv", async (_event, requestedInput) => {
        const input = typeof requestedInput === "string"
            ? {datasetId: requestedInput}
            : requestedInput ?? {}
        const datasetId = requireIdentifier(input.datasetId, "dataset")
        const exportOptions = {
            caseScope: input.caseScope ?? "all",
            outputMode: input.outputMode ?? "curated",
        }
        const dataset = store.getDataset(datasetId)
        const cases = store.listCases(datasetId)
        const csv = buildDatasetCsv(cases, exportOptions)
        const selectedCases = exportOptions.caseScope === "goodcase"
            ? cases.filter((entry) => entry.caseType === "goodcase")
            : cases
        const missingOriginalCount = exportOptions.outputMode === "original"
            ? selectedCases.filter(
                  (entry) => !originalFinalAssistantMessages(entry).length,
              ).length
            : 0
        const result = await dialog.showSaveDialog(mainWindow, {
            title: `Export ${dataset.name}`,
            defaultPath: join(
                app.getPath("downloads"),
                datasetExportFilename(dataset.name, exportOptions),
            ),
            filters: [{name: "CSV", extensions: ["csv"]}],
        })
        if (result.canceled || !result.filePath) return {canceled: true, filePath: null}
        writeFileSync(result.filePath, csv, {encoding: "utf8", mode: 0o600})
        return {
            canceled: false,
            filePath: result.filePath,
            caseCount: selectedCases.length,
            missingOriginalCount,
        }
    })
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

    ipcMain.handle("rubrics:list-versions", (_event, datasetId) =>
        store.listDatasetRubricVersions(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("rubrics:active", (_event, datasetId) =>
        store.getActiveDatasetRubric(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("rubrics:list-sessions", (_event, datasetId) =>
        store.listRubricSessions(
            datasetId ? requireIdentifier(datasetId, "dataset") : null,
        ),
    )
    ipcMain.handle("rubrics:get-session", (_event, sessionId) =>
        store.getRubricSession(requireIdentifier(sessionId, "rubric session")),
    )
    ipcMain.handle("rubrics:create", async (_event, input = {}) => {
        const datasetId = requireIdentifier(input.datasetId, "dataset")
        const dataset = store.getDataset(datasetId)
        await requireAvailableDatasetSkill(dataset)
        const skillEvidence = snapshotSkillEvidence(dataset.skillReference)
        if (skillEvidence.truncated || skillEvidence.warnings.length) {
            const details = skillEvidence.warnings.length
                ? skillEvidence.warnings.map((warning) => `- ${warning}`).join("\n")
                : "- Skill evidence exceeded a snapshot limit"
            throw new Error(`Rubric generation requires complete Skill evidence:\n${details}`)
        }
        const profile = store.read().settings.rubricProfile
        return rubricManager.createSession({
            datasetId,
            baseVersionId: dataset.activeRubricVersionId,
            skillEvidence,
            modelId: profile.modelId,
            effort: profile.effort,
        })
    })
    ipcMain.handle("rubrics:send", (_event, input = {}) =>
        rubricManager.sendMessage(
            requireIdentifier(input.sessionId, "rubric session"),
            String(input.text ?? ""),
        ),
    )
    ipcMain.handle("rubrics:retry", (_event, sessionId) =>
        rubricManager.retry(requireIdentifier(sessionId, "rubric session")),
    )
    ipcMain.handle("rubrics:publish", (_event, sessionId) =>
        rubricManager.publish(requireIdentifier(sessionId, "rubric session")),
    )
    ipcMain.handle("rubrics:discard", (_event, sessionId) =>
        rubricManager.discard(requireIdentifier(sessionId, "rubric session")),
    )
    ipcMain.handle("rubrics:update-model", (_event, input = {}) =>
        rubricManager.updateModel(
            requireIdentifier(input.sessionId, "rubric session"),
            optionalIdentifier(input.modelId, "model"),
        ),
    )
    ipcMain.handle("rubrics:update-effort", (_event, input = {}) =>
        rubricManager.updateEffort(
            requireIdentifier(input.sessionId, "rubric session"),
            optionalEffort(input.effort),
        ),
    )

    ipcMain.handle("curation:list", () => store.listCurationSessions())
    ipcMain.handle("curation:list-archived", () => store.listArchivedCurationSessions())
    ipcMain.handle("curation:get", (_event, sessionId) =>
        store.getCurationSession(requireIdentifier(sessionId, "curation session")),
    )
    ipcMain.handle("curation:create", async (_event, input = {}) => {
        const datasetId = requireIdentifier(input.datasetId, "dataset")
        const dataset = store.getDataset(datasetId)
        await requireAvailableDatasetSkill(dataset)
        requirePublishedDatasetRubric(dataset)
        const sourceThreadId = requireIdentifier(input.sourceThreadId, "source thread")
        const startItemId = input.startItemId
            ? requireIdentifier(input.startItemId, "episode start item")
            : null
        const startTurnId = optionalIdentifier(input.startTurnId, "episode start turn")
        const startMessageOrdinal = optionalMessageOrdinal(
            input.startMessageOrdinal,
            "episode start message",
        )
        const endItemId = requireIdentifier(input.endItemId, "episode end item")
        const endTurnId = optionalIdentifier(input.endTurnId, "episode end turn")
        const endMessageOrdinal = optionalMessageOrdinal(
            input.endMessageOrdinal,
            "episode end message",
        )
        const traceReference = client?.recorder?.referenceForEpisode({
            threadId: sourceThreadId,
            startItemId,
            endItemId,
        })
        const profile = store.read().settings.curatorProfile
        return curationManager.createSession({
            datasetId,
            caseType: input.caseType,
            sourceThreadId,
            startItemId,
            startTurnId,
            startMessageOrdinal,
            endItemId,
            endTurnId,
            endMessageOrdinal,
            issueDescription:
                "issueDescription" in input
                    ? optionalIssueDescription(input.issueDescription)
                    : undefined,
            traceReference,
            modelId: profile.modelId,
            effort: profile.effort,
        })
    })
    ipcMain.handle("curation:create-calibration", async (_event, input = {}) => {
        const datasetId = requireIdentifier(input.datasetId, "dataset")
        const dataset = store.getDataset(datasetId)
        await requireAvailableDatasetSkill(dataset)
        requirePublishedDatasetRubric(dataset)
        const profile = store.read().settings.curatorProfile
        return curationManager.createCalibrationSession({
            datasetId,
            caseId: requireIdentifier(input.caseId, "Case"),
            modelId: profile.modelId,
            effort: profile.effort,
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
    ipcMain.handle("evaluations:cancel", (_event, runId) =>
        evaluationRunner.cancel(requireIdentifier(runId, "evaluation run")),
    )
    ipcMain.handle("evaluations:delete", (_event, runId) =>
        store.deleteEvaluationRun(requireIdentifier(runId, "evaluation run")),
    )
    ipcMain.handle("evaluations:start", async (_event, input = {}) => {
        const datasetId = requireIdentifier(input.datasetId, "dataset")
        const dataset = store.getDataset(datasetId)
        const skillReference = dataset.skillReference
        await requireAvailableDatasetSkill(dataset)
        requirePublishedDatasetRubric(dataset)
        const runtimeConfigurations = await Promise.all((input.runtimeConfigurations ?? []).map(async (requested) => {
            const runtimeId = requireIdentifier(requested.runtimeId, "runtime")
            const descriptor = availableRuntimes.find((entry) => entry.runtimeId === runtimeId)
            if (!descriptor) throw new Error(`Runtime ${runtimeId} is no longer available`)
            return {
                ...descriptor,
                modelId: optionalIdentifier(requested.modelId, "model"),
                effort: optionalEffort(requested.effort),
                skillEvidenceBinding: await skillEvidenceBindingForRuntime(
                    descriptor,
                    skillReference,
                ),
            }
        }))
        const skillEvidence = snapshotSkillEvidence(skillReference)
        if (skillEvidence.truncated || skillEvidence.warnings.length) {
            const details = skillEvidence.warnings.length
                ? skillEvidence.warnings.map((warning) => `- ${warning}`).join("\n")
                : "- Skill evidence exceeded a snapshot limit"
            throw new Error(`Formal evaluation requires complete Skill evidence:\n${details}`)
        }
        const requestedJudge = input.judgeConfiguration ?? {}
        const judgeRuntimeId = requireIdentifier(requestedJudge.runtimeId, "Judge runtime")
        const judgeDescriptor = availableRuntimes.find(
            (entry) => entry.runtimeId === judgeRuntimeId,
        )
        if (!judgeDescriptor) {
            throw new Error(`Judge runtime ${judgeRuntimeId} is no longer available`)
        }
        const judgeConfiguration = {
            ...judgeDescriptor,
            modelId: optionalIdentifier(requestedJudge.modelId, "Judge model"),
            effort: optionalEffort(requestedJudge.effort),
        }
        const run = store.createEvaluationRun({
            datasetId,
            caseIds: (input.caseIds ?? []).map((caseId) =>
                requireIdentifier(caseId, "Case"),
            ),
            selectionMode: input.selectionMode,
            activationMode: input.activationMode,
            skillEvidence,
            judgeProfile: {
                runtimePolicy: "active",
                modelId: judgeConfiguration.modelId,
                effort: judgeConfiguration.effort,
            },
            judgeConfiguration,
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

function optionalMessageOrdinal(value, label) {
    if (value === null || value === undefined) return null
    if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
        throw new Error(`A valid ${label} ordinal is required`)
    }
    return value
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

function optionalIssueDescription(value) {
    const description = String(value ?? "")
    if (description.length > 120_000) throw new Error("Issue description is too large")
    return description.trim() ? description : ""
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
        activityStore = new ThreadActivityStore(
            join(app.getPath("userData"), "thread-activity-store.json"),
        )
        curationManager = new CurationManager({
            store,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
            onChanged: (session) => send("curation:changed", session),
            onActivity: (activity) => send("curation:activity", activity),
        })
        rubricManager = new RubricManager({
            store,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
            onChanged: (session) => send("rubric:changed", session),
            onActivity: (activity) => send("rubric:activity", activity),
        })
        automaticCaptureManager = new AutomaticCaptureManager({
            store,
            curationManager,
            getTraceReference: (episode) => client?.recorder?.referenceForEpisode(episode) ?? null,
            verifyDatasetSkill: async (dataset) => {
                await requireAvailableDatasetSkill(dataset)
                requirePublishedDatasetRubric(dataset)
            },
            onError: (error) => send("runtime:state", {
                ...enrichRuntimeState(client?.state() ?? {workspaceRoot}),
                error: `Automatic capture failed: ${error.message}`,
            }),
        })
        runtimeRegistry = new RuntimeRegistry([
            new CodexRuntimeProvider(),
            new CodeBuddyRuntimeProvider(),
            new DeepSeekHarnessRuntimeProvider(),
        ])
        const evaluationPowerGuard = new EvaluationPowerGuard(powerSaveBlocker)
        evaluationRunner = new EvaluationRunner({
            store,
            runtimeRegistry,
            workspaceRoot,
            traceDirectory: join(app.getPath("userData"), "traces", "evaluations"),
            getExecutionPolicy: currentExecutionPolicy,
            acquireRunLease: () => evaluationPowerGuard.acquire(),
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
        void Promise.allSettled([
            client?.stop?.() ?? Promise.resolve(),
            evaluationRunner?.stopAll?.() ?? Promise.resolve(),
        ])
            .then((results) => {
                for (const result of results) {
                    if (result.status === "rejected") {
                        console.error("Rolling Skill runtime shutdown failed", result.reason)
                    }
                }
                activityStore?.flush()
            })
            .catch((error) => console.error("Rolling Skill shutdown persistence failed", error))
            .finally(() => app.quit())
    })

    app.on("window-all-closed", () => {
        // Keep the local app-server available while the macOS app remains in the Dock.
    })
}
