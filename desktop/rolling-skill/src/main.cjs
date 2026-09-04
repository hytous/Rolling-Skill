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
const {
    closeSync,
    constants: fsConstants,
    chmodSync,
    existsSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    realpathSync,
    renameSync,
    writeFileSync,
} = require("node:fs")
const {homedir} = require("node:os")
const {basename, isAbsolute, join, relative, resolve, sep} = require("node:path")
const {pathToFileURL} = require("node:url")
const {createHash, randomUUID} = require("node:crypto")
const {AsyncLocalStorage} = require("node:async_hooks")

const {CodexRuntimeProvider} = require("./codex-runtime-provider.cjs")
const {CodeBuddyRuntimeProvider} = require("./codebuddy-runtime-provider.cjs")
const {DeepSeekHarnessRuntimeProvider} = require("./deepseek-harness-runtime-provider.cjs")
const {AutomaticCaptureManager, sameAutomaticSkill} = require("./automatic-capture.cjs")
const {
    AutomaticCaptureStateStore,
} = require("./automatic-capture-state-store.cjs")
const {CurationManager} = require("./curation-manager.cjs")
const {CaseRecycleService} = require("./case-recycle-service.cjs")
const {CaseRefreshManager} = require("./case-refresh-manager.cjs")
const {RubricManager} = require("./rubric-manager.cjs")
const {EvaluationRunner} = require("./evaluation-runner.cjs")
const {EvaluationPowerGuard} = require("./evaluation-power-guard.cjs")
const {classifyInternalRuntimeThread} = require("./internal-runtime-thread.cjs")
const {
    buildDatasetCsv,
    datasetExportFilename,
    originalFinalAssistantMessages,
} = require("./dataset-csv-export.cjs")
const {
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
} = require("./evaluation-skill-binding.cjs")
const {
    snapshotManagedSkillEvidence,
    snapshotSkillEvidence,
} = require("./evaluation-skill-evidence.cjs")
const {LocalEvaluationStore, reasoningEffort} = require("./local-store.cjs")
const {ManagedSkillManager} = require("./managed-skill-manager.cjs")
const {ManagedSkillStore} = require("./managed-skill-store.cjs")
const {requireGitSourceLocation} = require("./managed-skill-git.cjs")
const {normalizedSkillName, RawCaseStore} = require("./raw-case-store.cjs")
const {SkillInstallationManager} = require("./skill-installation-manager.cjs")
const {SkillInstallationStore} = require("./skill-installation-store.cjs")
const {resolveExecutionPolicy, resolveRuntimePermission} = require("./execution-policy.cjs")
const {requireLocalPath, requireWebUrl} = require("./link-targets.cjs")
const {readThreadProfile, updateThreadProfiles} = require("./thread-profile-store.cjs")
const {ThreadActivityStore} = require("./thread-activity-store.cjs")
const {RuntimeNotificationRouter} = require("./runtime-notification-router.cjs")
const {RuntimeRegistry} = require("./runtime-registry.cjs")
const {findGitWorkspace} = require("./workspace.cjs")
const {
    CapabilityStore,
    MAX_CAPABILITY_LIFETIME_MS,
    MAX_TRUSTED_SCOPE_IDS,
    createTrustedCapabilityIssuer,
    createTrustedHumanCapabilityIssuer,
} = require("./control-plane/capability-store.cjs")
const {
    ControlPlane,
    createServiceErrorDiagnosticChannel,
} = require("./control-plane/control-plane.cjs")
const {
    CONTROL_METHODS,
    controlDefinition,
    parseControlInput,
    publicControlError,
} = require("./control-plane/contracts.cjs")
const {createDomainServices} = require("./control-plane/domain-services.cjs")
const {createControlPolicy} = require("./control-plane/policy.cjs")
const {ControlSocketServer} = require("./control-plane/socket-server.cjs")
const {OperatorJobStore} = require("./operator/job-store.cjs")
const {OperatorJobEngine} = require("./operator/job-engine.cjs")
const {OperatorSessionManager} = require("./operator/operator-session-manager.cjs")
const {publicOperatorSummaryPage} = require("./operator/public-summary.cjs")
const {OptimizationStore} = require("./optimization/optimization-store.cjs")
const {
    OptimizationWorkspaceManager,
} = require("./optimization/optimization-workspace.cjs")
const {
    OptimizationOperatorGateway,
} = require("./optimization/optimization-operator-gateway.cjs")
const {OptimizationRunner} = require("./optimization/optimization-runner.cjs")
const {
    OptimizationControlService,
} = require("./optimization/optimization-control-service.cjs")
const {
    assertOptimizationTelemetrySupport,
} = require("./optimization/optimization-preflight.cjs")

const RENDERER_FILE = join(__dirname, "..", "renderer", "index.html")
const PRELOAD_FILE = join(__dirname, "preload.cjs")
const RENDERER_CAPABILITY_LIFETIME_MS = Math.min(
    60 * 60 * 1_000,
    MAX_CAPABILITY_LIFETIME_MS,
)
const RENDERER_CAPABILITY_REFRESH_MS = 60 * 1_000
const RENDERER_CONTROL_ACTIONS = Object.freeze([
    "raw_cases.read",
    "raw_cases.write",
    "runtimes.read",
    "datasets.read",
    "evaluations.read",
    "evaluations.execute",
    "skills.read",
    "approvals.resolve",
    "jobs.control",
    "optimizations.read",
    "optimizations.execute",
    "optimizations.control",
])
const RENDERER_CONTROL_METHODS = new Set([
    "raw_cases.list",
    "raw_cases.enqueue",
    "raw_cases.update",
    "runtimes.list",
    "runtimes.models",
    "datasets.list",
    "datasets.get",
    "evaluations.list",
    "evaluations.get",
    "evaluations.start",
    "evaluations.cancel",
    "skill_repositories.list",
    "skills.list",
    "skill_versions.list",
    "skills.get",
    "approvals.resolve",
    "jobs.pause",
    "jobs.resume",
    "jobs.stop",
    "optimization.preflight",
    "optimization.start",
    "optimization.get",
    "optimization.pause",
    "optimization.resume",
    "optimization.stop",
    "optimization.report",
])
const RENDERER_CONTROL_MUTATIONS = new Set([
    "raw_cases.enqueue",
    "raw_cases.update",
    "evaluations.start",
    "evaluations.cancel",
    "approvals.resolve",
    "jobs.pause",
    "jobs.resume",
    "jobs.stop",
    "optimization.start",
    "optimization.pause",
    "optimization.resume",
    "optimization.stop",
    "optimization.report",
])
const RENDERER_FORBIDDEN_CONTROL_KEYS = new Set([
    "token",
    "sessionId",
    "action",
    "path",
    "commit",
    "usage",
])
const CONTROL_AUDIT_LIMIT = 200

let mainWindow = null
let client = null
let runtimeRegistry = null
let runtimeDescriptor = null
let availableRuntimes = []
let store = null
let curationManager = null
let rubricManager = null
let automaticCaptureManager = null
let automaticCaptureStateStore = null
let evaluationRunner = null
let activityStore = null
let rawCaseStore = null
let caseRecycleService = null
let caseRefreshManager = null
let managedSkillStore = null
let managedSkillManager = null
let managedSkillStartupError = null
let skillInstallationStore = null
let skillInstallationManager = null
let capabilityStore = null
let rendererCapabilityIssuer = null
let rendererServiceErrorDiagnostics = null
let controlPolicy = null
let controlServices = null
let controlPlane = null
let controlSocketServer = null
let controlSocketStartPromise = null
let controlShutdownPromise = null
let rendererCapability = null
let rendererCapabilityRotation = Promise.resolve()
let rendererCapabilityEpoch = 0
const rendererCapabilityEntries = new Set()
const rendererAliasContext = new AsyncLocalStorage()
let activeRuntimeSkillCache = null
let controlInvocationsAccepted = false
let controlIpcInstalled = false
let controlSocketStartupDiagnostic = null
let operatorJobStore = null
let operatorJobEngine = null
let operatorSessionManager = null
let operatorCapabilityIssuer = null
let installationCapabilityIssuer = null
let optimizationStore = null
let optimizationWorkspaceManager = null
let optimizationOperatorGateway = null
let optimizationRunner = null
let optimizationControlService = null
let workspaceRoot = null
let rendererUrl = null
let runtimeStart = null
let runtimeOperationTail = Promise.resolve()
let clientGeneration = 0
const permissionDialogTails = new Map()
const pendingRuntimeQuestions = new Map()
let runtimeQuestionSequence = 0
const pendingSkillInstallationQuestions = new Map()
let skillInstallationQuestionSequence = 0
let quitAfterRuntimeStops = false
const loadedThreads = new Set()
const activeThreads = new Set()
const runtimeNotificationRouter = new RuntimeNotificationRouter()
const controlAuditEvents = []

const skillInstallationControlPlaneFacade = Object.freeze({
    invoke(request) {
        if (!controlPlane) throw new Error("Skill installation ControlPlane is unavailable")
        return controlPlane.invoke(request)
    },
    registerInstallationExecutor(registration) {
        if (!controlPlane) throw new Error("Skill installation ControlPlane is unavailable")
        return controlPlane.registerInstallationExecutor(registration)
    },
})

const skillInstallationCapabilityFacade = Object.freeze({
    issue(request) {
        if (!installationCapabilityIssuer) {
            throw new Error("Skill installation capability issuer is unavailable")
        }
        return installationCapabilityIssuer.issue(request)
    },
    revoke(capabilityId) {
        if (!capabilityStore) return false
        return capabilityStore.revoke(capabilityId)
    },
})

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

function sourceCurationMarkers() {
    return store.read().curationSessions
        .filter(
            (session_) =>
                session_.operation === "capture" &&
                session_.status !== "cancelled" &&
                session_.episode?.source?.threadId,
        )
        .map((session_) => ({
            id: session_.id,
            datasetId: session_.datasetId,
            caseId: session_.caseId ?? null,
            status: session_.status,
            threadId: session_.episode.source.threadId,
            startItemId: session_.episode.source.startItemId,
            endItemId: session_.episode.source.endItemId,
            itemIds: (session_.episode.items ?? []).map((item) => item.id).filter(Boolean),
        }))
}

function isHiddenRuntimeThread(thread) {
    const threadId = typeof thread === "string" ? thread : thread?.id
    const inferredKind = typeof thread === "object" && thread !== null
        ? classifyInternalRuntimeThread(thread)
        : null
    if (threadId && inferredKind) {
        store?.recordInternalThread(threadId, inferredKind)
        return true
    }
    return Boolean(
        threadId && (
            curationManager?.hiddenThreadIds().has(threadId) ||
            rubricManager?.hiddenThreadIds().has(threadId) ||
            caseRefreshManager?.hiddenThreadIds().has(threadId) ||
            automaticCaptureManager?.hiddenThreadIds().has(threadId) ||
            store?.listInternalThreadIds().includes(threadId) ||
            evaluationRunner?.hiddenThreadIds().has(threadId) ||
            operatorSessionManager?.hiddenThreadIds().has(threadId) ||
            skillInstallationManager?.hiddenThreadIds().has(threadId)
        ),
    )
}

function installClientEvents(nextClient, sourceRuntimeId) {
    nextClient.on("state", (state) => {
        if (state.status === "stopped" || state.status === "error") {
            activeThreads.clear()
            runtimeNotificationRouter.clear()
            cancelRuntimeQuestionsForClient(nextClient)
        }
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
        const hidden = isHiddenRuntimeThread(threadId) || params.thread?.threadSource === "subagent"
        if (!hidden) {
            activityStore?.captureNotification(sourceRuntimeId, message)
            if (runtimeNotificationRouter.route(message).forward) {
                send("runtime:notification", message)
            }
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

function installerRuntimePermissionFor(providerId, requestedMode = null) {
    const permission = runtimePermissionFor(providerId, requestedMode)
    if (providerId === "codex" && permission.permissionMode !== "full") {
        return {...permission, approvalPolicy: "on-request"}
    }
    return permission
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

function settleRuntimeQuestion(pending, answer = null, reason = "resolved") {
    if (!pending || pendingRuntimeQuestions.get(pending.requestId) !== pending) return false
    pendingRuntimeQuestions.delete(pending.requestId)
    pending.signal?.removeEventListener?.("abort", pending.onAbort)
    pending.resolve(answer)
    send("runtime:question-resolved", {requestId: pending.requestId, reason})
    return true
}

function cancelRuntimeQuestionsForClient(sourceClient, reason = "runtime-stopped") {
    for (const pending of [...pendingRuntimeQuestions.values()]) {
        if (pending.sourceClient === sourceClient) settleRuntimeQuestion(pending, null, reason)
    }
}

function requestRuntimeQuestion(request = {}) {
    const generation = request.clientGeneration
    const processEpoch = request.processEpoch ?? null
    const rpcId = String(request.rpcId ?? "")
    const sessionId = String(request.sessionId ?? request.params?.sessionId ?? "")
    const questions = Array.isArray(request.questions) ? request.questions : []
    const isCurrent = () =>
        generation === clientGeneration &&
        request.runtimeId === runtimeDescriptor?.runtimeId &&
        request.sourceClient === client &&
        (processEpoch === null || request.sourceClient?.processEpoch === processEpoch)
    if (
        !rpcId ||
        !sessionId ||
        !questions.length ||
        isHiddenRuntimeThread(sessionId) ||
        !isCurrent()
    ) {
        return Promise.resolve(null)
    }
    const duplicate = [...pendingRuntimeQuestions.values()].find(
        (entry) =>
            entry.clientGeneration === generation &&
            entry.processEpoch === processEpoch &&
            entry.rpcId === rpcId,
    )
    if (duplicate) return duplicate.promise
    const requestId = `${generation}:${processEpoch ?? "runtime"}:${++runtimeQuestionSequence}`
    let resolveQuestion
    const promise = new Promise((resolve) => {
        resolveQuestion = resolve
    })
    const pending = {
        requestId,
        promise,
        resolve: resolveQuestion,
        clientGeneration: generation,
        processEpoch,
        runtimeId: request.runtimeId,
        sourceClient: request.sourceClient,
        rpcId,
        sessionId,
        signal: request.signal ?? null,
        onAbort: null,
    }
    pending.onAbort = () => settleRuntimeQuestion(pending, null, "runtime-resolved")
    request.signal?.addEventListener?.("abort", pending.onAbort, {once: true})
    if (request.signal?.aborted || !isCurrent()) {
        pending.resolve(null)
        return promise
    }
    pendingRuntimeQuestions.set(requestId, pending)
    send("runtime:question-requested", {
        requestId,
        runtimeId: request.runtimeId,
        threadId: sessionId,
        rpcId,
        questions,
    })
    return promise
}

function settleSkillInstallationQuestion(pending, answer = null, reason = "resolved") {
    if (
        !pending ||
        pendingSkillInstallationQuestions.get(pending.requestId) !== pending
    ) return false
    pendingSkillInstallationQuestions.delete(pending.requestId)
    pending.signal?.removeEventListener?.("abort", pending.onAbort)
    pending.resolve(answer)
    send("skill-installations:question-resolved", {
        requestId: pending.requestId,
        jobId: pending.jobId,
        reason,
    })
    return true
}

function requestSkillInstallationQuestion(request = {}) {
    const jobId = requireIdentifier(request.jobId, "Skill installation job")
    const questions = Array.isArray(request.questions) ? request.questions : []
    if (!questions.length) return Promise.resolve(null)
    const requestId = `installer:${++skillInstallationQuestionSequence}`
    let resolveQuestion
    const promise = new Promise((resolve) => {
        resolveQuestion = resolve
    })
    const pending = {
        requestId,
        jobId,
        promise,
        resolve: resolveQuestion,
        threadId: request.threadId ?? request.sessionId ?? null,
        signal: request.signal ?? null,
        onAbort: null,
    }
    pending.onAbort = () => settleSkillInstallationQuestion(pending, null, "runtime-resolved")
    request.signal?.addEventListener?.("abort", pending.onAbort, {once: true})
    if (request.signal?.aborted) {
        pending.resolve(null)
        return promise
    }
    pendingSkillInstallationQuestions.set(requestId, pending)
    send("skill-installations:question-requested", {
        requestId,
        jobId,
        runtimeId: request.runtime?.runtimeId ?? null,
        threadId: pending.threadId,
        questions,
    })
    return promise
}

function requestRuntimePermission(request = {}) {
    const options = Array.isArray(request.options) ? request.options : []
    const rejection = options.find(isRejectionOption)
    if (!rejection) return Promise.reject(new Error("Permission request has no explicit rejection option"))
    const rejectionId = permissionOptionId(rejection)
    if (isHiddenRuntimeThread(request.params?.sessionId)) return Promise.resolve(rejectionId)
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
    const previousRuntimeId = runtimeDescriptor?.runtimeId ?? null
    const preferred = options.preferredRuntime ?? preferredRuntime()
    const discovery = runtimeRegistry.discover({
        preferredRuntime: preferred,
        commonProviderOptions: {configuredPath: preferred?.executablePath ?? null},
    })
    availableRuntimes = discovery.available
    runtimeDescriptor = discovery.selected
    if (runtimeDescriptor?.runtimeId !== previousRuntimeId) invalidateRuntimeSkillCache()
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
    const nameOnly = value?.evidencePrecision === "name-only" && !value?.path
    const path = nameOnly ? null : requireAbsolutePath(value?.path, "Skill")
    const runtime = await ensureRuntime()
    const descriptor = runtimeDescriptor
    const root = workspaceRoot
    const generation = clientGeneration
    const snapshotIsCurrent = () =>
        runtime === client &&
        descriptor === runtimeDescriptor &&
        root === workspaceRoot &&
        generation === clientGeneration
    if (!snapshotIsCurrent()) {
        throw new Error("The runtime or workspace changed while verifying the Skill; try again")
    }
    if (
        nameOnly &&
        (
            value?.providerId !== descriptor?.providerId ||
            value?.runtimeId !== descriptor?.runtimeId ||
            value?.workspaceRoot !== root
        )
    ) {
        throw new Error(
            "The name-only Skill identity is stale for the active runtime and workspace",
        )
    }
    if (typeof runtime.listSkills !== "function") {
        throw new Error("The active runtime cannot verify installed Skills")
    }
    const runtimeResponse = await runtime.listSkills({forceReload: true})
    if (!snapshotIsCurrent()) {
        throw new Error("The runtime or workspace changed while verifying the Skill; try again")
    }
    const response = cachedRuntimeSkills(runtimeResponse, descriptor, root, generation)
    const requested = {name, path}
    const allowNameOnly = descriptor?.capabilities?.includes("skills-name-only")
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
            (
                skill.path === path ||
                (allowNameOnly && !path && skill.evidencePrecision === "name-only" && !skill.path)
            ),
        )
    const reference = {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name,
        path,
        scope: reported?.scope ?? null,
        description: reported?.description ?? reported?.interface?.shortDescription ?? null,
        runtimeId: descriptor?.runtimeId ?? null,
        confirmedAt: new Date().toISOString(),
    }
    if (!nameOnly) return reference
    return {
        ...reference,
        providerId: descriptor?.providerId ?? null,
        workspaceRoot: root,
        evidencePrecision: "name-only",
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
        requestQuestion: (request) =>
            requestRuntimeQuestion({
                ...request,
                runtime: sourceRuntime,
                runtimeId: sourceRuntime.runtimeId,
                clientGeneration: sourceGeneration,
                sourceClient: nextClient,
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
    invalidateRuntimeSkillCache()
    clientGeneration += 1
    runtimeNotificationRouter.clear()
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
        automaticCaptureManager?.reschedule()
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
    } finally {
        automaticCaptureManager?.reschedule()
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
        invalidateRuntimeSkillCache()
        return restartRuntimeNow()
    })
}

async function useAutomaticRuntimeSelection() {
    return enqueueRuntimeOperation(async () => {
        writePreferences({runtimeSelection: null})
        runtimeDescriptor = null
        invalidateRuntimeSkillCache()
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
        invalidateRuntimeSkillCache()
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
        invalidateRuntimeSkillCache()
        writePreferences({workspaceRoot})
        loadedThreads.clear()
        activeThreads.clear()
        runtimeNotificationRouter.clear()
        client?.setWorkspace(workspaceRoot)
        if (evaluationRunner) evaluationRunner.workspaceRoot = workspaceRoot
        if (skillInstallationManager) skillInstallationManager.workspaceRoot = workspaceRoot
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

function digestSkillIdentity(prefix, fields) {
    const digest = createHash("sha256")
    for (const field of fields) digest.update(`${String(field ?? "")}\0`, "utf8")
    return `${prefix}-${digest.digest("hex")}`
}

function canonicalSkillPath(value) {
    const path = typeof value === "string" ? value.trim() : ""
    if (!path) return ""
    const absolute = path.startsWith("/")
    const segments = []
    for (const segment of path.split("/")) {
        if (!segment || segment === ".") continue
        if (segment === "..") {
            if (segments.length && segments.at(-1) !== "..") segments.pop()
            else if (!absolute) segments.push(segment)
        } else segments.push(segment)
    }
    return `${absolute ? "/" : ""}${segments.join("/")}` || (absolute ? "/" : "")
}

function inspectManagedPath(inputPath, expectedType, label) {
    if (typeof inputPath !== "string" || !isAbsolute(inputPath)) {
        throw new Error(`${label} must be an absolute path`)
    }
    lstatSync(inputPath)
    const realPath = realpathSync(inputPath)
    const descriptor = openSync(realPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    try {
        const metadata = fstatSync(descriptor)
        if (
            (expectedType === "directory" && !metadata.isDirectory()) ||
            (expectedType === "file" && !metadata.isFile())
        ) throw new Error(`${label} has an invalid file type`)
    } finally {
        closeSync(descriptor)
    }
    return realPath
}

function managedSkillPaths(binding = {}) {
    const repositoryId = requireIdentifier(binding.repositoryId, "managed Skill repository")
    const skillId = requireIdentifier(binding.skillId, "managed Skill")
    const catalog = managedSkillManager.catalog()
    if (!catalog || typeof catalog.then === "function") {
        throw new Error("Managed Skill catalog resolution is invalid")
    }
    const repository = catalog.repositories.find((entry) => entry?.id === repositoryId)
    const skill = catalog.skills.find((entry) => entry?.id === skillId)
    if (!repository || !skill || skill.repositoryId !== repositoryId) {
        throw new Error("Managed Skill does not belong to the selected repository")
    }
    if (skill.status !== "valid") throw new Error("Managed Skill must be valid and enabled")
    const workspaceRoot = inspectManagedPath(
        managedSkillManager.repositoryPath(repositoryId),
        "directory",
        "Managed Skill repository",
    )
    const skillRoot = inspectManagedPath(
        resolve(workspaceRoot, String(skill.skillRoot ?? "")),
        "directory",
        "Managed Skill root",
    )
    const manifestPath = inspectManagedPath(
        resolve(workspaceRoot, String(skill.manifestPath ?? "")),
        "file",
        "Managed Skill manifest",
    )
    for (const [candidate, label] of [
        [skillRoot, "Managed Skill root"],
        [manifestPath, "Managed Skill manifest"],
    ]) {
        const fromRepository = relative(workspaceRoot, candidate)
        if (
            fromRepository === ".." ||
            fromRepository.startsWith(`..${sep}`) ||
            isAbsolute(fromRepository)
        ) throw new Error(`${label} is outside the managed repository`)
    }
    const fromSkill = relative(skillRoot, manifestPath)
    if (
        fromSkill === ".." ||
        fromSkill.startsWith(`..${sep}`) ||
        isAbsolute(fromSkill)
    ) throw new Error("Managed Skill manifest is outside its Skill root")
    return {repositoryId, skillId, repository, skill, workspaceRoot, skillRoot, manifestPath}
}

function actualLocalSkillIdentity(input = {}) {
    const {
        name,
        path,
        runtimeId,
        providerId,
        workspaceRoot: identityWorkspaceRoot,
        evidencePrecision,
    } = input ?? {}
    const normalizedName = normalizedSkillName(name)
    const normalizedRuntimeId = String(runtimeId ?? "").trim()
    if (!normalizedName || !normalizedRuntimeId) return null
    const canonicalPath = canonicalSkillPath(path)
    if (canonicalPath && evidencePrecision !== "name-only") {
        return digestSkillIdentity("local-skill", [
            normalizedRuntimeId,
            canonicalPath,
            normalizedName,
        ])
    }
    const normalizedProviderId = String(providerId ?? "").trim()
    const canonicalWorkspaceRoot = canonicalSkillPath(identityWorkspaceRoot)
    if (!normalizedProviderId || !canonicalWorkspaceRoot) return null
    return digestSkillIdentity("local-skill", [
        normalizedProviderId,
        normalizedRuntimeId,
        canonicalWorkspaceRoot,
        normalizedName,
    ])
}

function datasetSkillIdentity(reference) {
    const stableId = typeof reference?.id === "string" ? reference.id.trim() : ""
    return stableId || actualLocalSkillIdentity(reference)
}

function managedSkillIdForRuntimeSkill(runtimeSkill) {
    if (
        typeof runtimeSkill?.name !== "string" ||
        typeof runtimeSkill?.path !== "string" ||
        !isAbsolute(runtimeSkill.path)
    ) return null
    let candidate
    try {
        lstatSync(runtimeSkill.path)
        candidate = realpathSync(runtimeSkill.path)
    } catch {
        return null
    }
    const matches = []
    let catalog
    try {
        catalog = managedSkillManager.catalog()
    } catch {
        return null
    }
    for (const skill of catalog?.skills ?? []) {
        if (skill?.name !== runtimeSkill.name || skill?.status !== "valid") continue
        try {
            const paths = managedSkillPaths({
                repositoryId: skill.repositoryId,
                skillId: skill.id,
            })
            if (candidate === paths.manifestPath || candidate === paths.skillRoot) {
                matches.push(skill.id)
            }
        } catch {}
    }
    return new Set(matches).size === 1 ? matches[0] : null
}

function runtimeSkillIdentity(skill, descriptor = runtimeDescriptor, root = workspaceRoot) {
    return actualLocalSkillIdentity({
        name: skill?.name,
        path: skill?.path,
        runtimeId: descriptor?.runtimeId,
        providerId: descriptor?.providerId,
        workspaceRoot: root,
        evidencePrecision: skill?.evidencePrecision,
    })
}

function legacyRawCaseSkillIdentity(name) {
    return digestSkillIdentity("legacy-name", [normalizedSkillName(name)])
}

function rendererAliasSkillIdentity(name) {
    return digestSkillIdentity("renderer-name", [normalizedSkillName(name)])
}

function runtimeSkillCacheKey(
    descriptor = runtimeDescriptor,
    root = workspaceRoot,
    generation = clientGeneration,
) {
    return JSON.stringify([
        descriptor?.runtimeId ?? null,
        canonicalSkillPath(root),
        generation,
    ])
}

function invalidateRuntimeSkillCache() {
    activeRuntimeSkillCache = null
}

function cachedRuntimeSkills(
    response,
    descriptor = runtimeDescriptor,
    root = workspaceRoot,
    generation = clientGeneration,
) {
    const data = (response?.data ?? []).map((entry) => ({
        ...entry,
        skills: (entry?.skills ?? []).map((skill) => {
            const id = managedSkillIdForRuntimeSkill(skill) ??
                runtimeSkillIdentity(skill, descriptor, root)
            return id ? {...skill, id} : {...skill}
        }),
    }))
    const result = {...response, data}
    const skills = []
    for (const entry of data) {
        for (const skill of entry.skills) {
            if (!skill?.enabled || !skill.id || !normalizedSkillName(skill.name)) continue
            skills.push({id: skill.id, name: skill.name})
        }
    }
    activeRuntimeSkillCache = {
        key: runtimeSkillCacheKey(descriptor, root, generation),
        skills,
    }
    return result
}

function currentRuntimeCachedSkills() {
    return activeRuntimeSkillCache?.key === runtimeSkillCacheKey()
        ? activeRuntimeSkillCache.skills
        : []
}

function listDatasetsForControl() {
    return store.listDatasets().map((dataset) => {
        const skillReference = dataset?.skillReference
        const id = datasetSkillIdentity(skillReference)
        return id ? {...dataset, skillReference: {...skillReference, id}} : dataset
    })
}

function trustedRawCaseSkills({stagedAliases = rendererAliasContext.getStore()?.aliases ?? []} = {}) {
    const managed = managedSkillManager.catalog().skills
    const sources = [
        ...managed.map((skill) => ({id: skill.id, name: skill.name})),
        ...listDatasetsForControl().map((dataset) => dataset.skillReference),
        ...currentRuntimeCachedSkills(),
        ...rawCaseStore.list().map((rawCase) => ({
            id: rawCase.skill?.id ?? legacyRawCaseSkillIdentity(rawCase.skill?.name),
            name: rawCase.skill?.name,
        })),
        ...stagedAliases,
    ]
    const skills = new Map()
    for (const source of sources) {
        const id = typeof source?.id === "string" ? source.id : ""
        const name = typeof source?.name === "string" ? source.name.trim() : ""
        if (!id || id.length > 200 || !name || name.length > 200 || skills.has(id)) continue
        skills.set(id, {id, name})
    }
    return {skills: [...skills.values()]}
}

function rawCaseSkillCandidates(reference, inventory = trustedRawCaseSkills().skills) {
    if (typeof reference?.id === "string" && reference.id) {
        return inventory.filter((skill) => skill.id === reference.id)
    }
    const name = normalizedSkillName(reference?.name)
    return inventory.filter((skill) => normalizedSkillName(skill.name) === name)
}

function prepareRendererRawCaseSkillAliases(method, input) {
    const staged = {params: input, aliases: []}
    if (method !== "raw_cases.enqueue" && method !== "raw_cases.update") return staged
    const references = method === "raw_cases.enqueue"
        ? input.cases?.map((rawCase) => rawCase?.skill) ?? []
        : input.changes?.skill
          ? [input.changes.skill]
          : []
    for (const reference of references) {
        if (!reference || reference.id) continue
        const candidates = rawCaseSkillCandidates(reference)
        if (candidates.length > 1) return staged
        if (candidates.length === 1) {
            reference.id = candidates[0].id
            continue
        }
        if (candidates.length === 0) {
            const alias = {
                id: rendererAliasSkillIdentity(reference.name),
                name: String(reference.name ?? "").trim(),
            }
            staged.aliases.push(alias)
            reference.id = alias.id
        }
    }
    return staged
}

async function listModelsForRuntimeFromControl(runtimeId) {
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
            ? await temporaryClient.listModels()
            : {data: [], nextCursor: null}
    } finally {
        await temporaryClient.stop().catch(() => {})
    }
}

function controlScopeIds(values, key) {
    const result = []
    const seen = new Set()
    for (const value of values) {
        const id = value?.[key]
        if (typeof id !== "string" || !id || id.length > 200 || seen.has(id)) continue
        seen.add(id)
        result.push(id)
    }
    return result.sort()
}

async function resolveManagedSkillBinding(binding = {}) {
    const paths = managedSkillPaths(binding)
    const descriptor = runtimeDescriptor
    if (!descriptor?.runtimeId || !descriptor?.providerId) {
        throw new Error("An active Runtime is required for a managed Skill binding")
    }
    await currentRuntimeSkillReference({name: paths.skill.name, path: paths.manifestPath})
    if (descriptor !== runtimeDescriptor) {
        throw new Error("The active Runtime changed while binding the managed Skill")
    }
    return {
        repositoryId: paths.repositoryId,
        skillId: paths.skillId,
        name: paths.skill.name,
        skillPath: paths.manifestPath,
        providerId: descriptor.providerId,
        runtimeId: descriptor.runtimeId,
        workspaceRoot: paths.workspaceRoot,
    }
}

async function resolveManagedSkillWorkspace(binding = {}) {
    if (binding.optimizationRunId !== undefined && binding.optimizationRunId !== null) {
        if (!optimizationWorkspaceManager) {
            throw new Error("Optimization workspace manager unavailable")
        }
        const runId = requireIdentifier(binding.optimizationRunId, "Optimization Run")
        const repositoryId = requireIdentifier(binding.repositoryId, "managed repository")
        const skillId = requireIdentifier(binding.skillId, "managed Skill")
        const workspace = optimizationWorkspaceManager.get(runId)
        if (workspace.repositoryId !== repositoryId || workspace.skillId !== skillId) {
            throw new Error("Optimization workspace does not match the managed Skill binding")
        }
        return {
            repositoryId,
            skillId,
            optimizationRunId: runId,
            workspaceRoot: workspace.workspacePath,
        }
    }
    const paths = managedSkillPaths(binding)
    return {
        repositoryId: paths.repositoryId,
        skillId: paths.skillId,
        workspaceRoot: paths.workspaceRoot,
    }
}

function currentRendererScopes() {
    const catalog = managedSkillManager.catalog()
    return {
        skillIds: controlScopeIds(trustedRawCaseSkills().skills, "id"),
        datasetIds: controlScopeIds(listDatasetsForControl(), "id"),
        runtimeIds: controlScopeIds(availableRuntimes, "runtimeId"),
        repositoryIds: controlScopeIds(catalog.repositories, "id"),
    }
}

function revokeRendererCapabilityEntry(entry) {
    if (!entry || !rendererCapabilityEntries.delete(entry)) return
    capabilityStore?.revokeSession(entry.sessionId)
    if (rendererCapability === entry) rendererCapability = null
}

function retireRendererCapability(entry) {
    if (!entry || entry.retired) return
    entry.retired = true
    if (entry.leases === 0) revokeRendererCapabilityEntry(entry)
}

function releaseRendererCapability(entry) {
    if (!entry || entry.leases <= 0) return
    entry.leases -= 1
    if (entry.retired && entry.leases === 0) revokeRendererCapabilityEntry(entry)
}

function revokeRendererCapabilities() {
    rendererCapabilityEpoch += 1
    rendererCapability = null
    for (const entry of [...rendererCapabilityEntries]) revokeRendererCapabilityEntry(entry)
}

async function acquireRendererCapability(expectedEpoch = rendererCapabilityEpoch) {
    const operation = rendererCapabilityRotation.then(() => {
        if (expectedEpoch !== rendererCapabilityEpoch) {
            throw new Error("Renderer control window is no longer active")
        }
        if (!controlInvocationsAccepted || !capabilityStore || !rendererCapabilityIssuer) {
            throw new Error("Desktop control operations are unavailable")
        }
        const scopes = currentRendererScopes()
        const scopeSignature = JSON.stringify(scopes)
        const now = Date.now()
        if (
            rendererCapability?.scopeSignature === scopeSignature &&
            rendererCapability.expiresAt > now + RENDERER_CAPABILITY_REFRESH_MS
        ) {
            rendererCapability.leases += 1
            return rendererCapability
        }

        const sessionId = `renderer-${randomUUID()}`
        const issued = rendererCapabilityIssuer.issue({
            sessionId,
            actions: RENDERER_CONTROL_ACTIONS,
            scopes,
            expiresInMs: RENDERER_CAPABILITY_LIFETIME_MS,
            budget: {
                maxRuntimeTurns: Number.MAX_SAFE_INTEGER,
                maxEvaluations: Number.MAX_SAFE_INTEGER,
            },
        })
        const replacement = {
            capabilityId: issued.id,
            sessionId,
            token: issued.token,
            expiresAt: issued.expiresAt,
            scopeSignature,
            leases: 1,
            retired: false,
        }
        const previous = rendererCapability
        rendererCapabilityEntries.add(replacement)
        rendererCapability = replacement
        if (previous) retireRendererCapability(previous)
        return replacement
    })
    rendererCapabilityRotation = operation.catch(() => {})
    return operation
}

function ensureRendererCapability() {
    return acquireRendererCapability()
}

function isSafeControlRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function containsForbiddenControlKey(root) {
    const pending = [root]
    let visited = 0
    while (pending.length) {
        const value = pending.pop()
        if (!value || typeof value !== "object") continue
        visited += 1
        if (visited > 10_000) return true
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (!Object.hasOwn(descriptor, "value")) return true
            if (RENDERER_FORBIDDEN_CONTROL_KEYS.has(key)) return true
            if (descriptor.value && typeof descriptor.value === "object") {
                pending.push(descriptor.value)
            }
        }
    }
    return false
}

function rendererControlParams(method, params) {
    const input = structuredClone(params)
    if (method === "runtimes.models" && !input.runtimeId) {
        input.runtimeId = requireIdentifier(runtimeDescriptor?.runtimeId, "runtime")
    }
    if (RENDERER_CONTROL_MUTATIONS.has(method)) {
        input.idempotencyKey = `renderer-${randomUUID()}`
    }
    return parseControlInput(method, input)
}

function publicControlResponse(error, diagnostic = null) {
    const snapshot = publicControlError(error)
    if (typeof diagnostic?.message === "string" && diagnostic.message) {
        snapshot.message = diagnostic.message
    }
    return {
        __rollingSkillControl: true,
        ok: false,
        error: snapshot,
    }
}

function assertRendererControlSender(event) {
    if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event?.sender !== mainWindow.webContents ||
        typeof event.sender.isDestroyed !== "function" ||
        event.sender.isDestroyed()
    ) throw new Error("Renderer control sender is not active")
}

async function invokeRendererControl(event, envelope) {
    try {
        assertRendererControlSender(event)
        if (!controlInvocationsAccepted || !controlPlane) {
            throw new Error("Desktop control operations are unavailable")
        }
        if (
            !isSafeControlRecord(envelope) ||
            !isSafeControlRecord(envelope.params) ||
            Object.keys(envelope).length !== 2 ||
            !Object.hasOwn(envelope, "method") ||
            !Object.hasOwn(envelope, "params") ||
            typeof envelope.method !== "string"
        ) throw new Error("Invalid renderer control invocation")
        if (!RENDERER_CONTROL_METHODS.has(envelope.method)) {
            throw new Error("Unknown renderer control method")
        }
        if (containsForbiddenControlKey(envelope)) {
            throw new Error("Renderer control input contains a forbidden field")
        }
        const prepared = prepareRendererRawCaseSkillAliases(
            envelope.method,
            rendererControlParams(envelope.method, envelope.params),
        )
        return rendererAliasContext.run({aliases: prepared.aliases}, async () => {
            const capability = await acquireRendererCapability()
            try {
                const value = await controlPlane.invoke({
                    token: capability.token,
                    sessionId: capability.sessionId,
                    method: envelope.method,
                    params: prepared.params,
                })
                return {__rollingSkillControl: true, ok: true, value}
            } catch (error) {
                const diagnostic = rendererServiceErrorDiagnostics?.consume(error) ?? null
                return publicControlResponse(error, diagnostic)
            } finally {
                releaseRendererCapability(capability)
            }
        })
    } catch (error) {
        return publicControlResponse(error)
    }
}

function installControlIpc() {
    if (controlIpcInstalled) return
    ipcMain.removeHandler("control:invoke")
    ipcMain.handle("control:invoke", invokeRendererControl)
    controlIpcInstalled = true
}

function removeControlIpc() {
    if (!controlIpcInstalled) return
    ipcMain.removeHandler("control:invoke")
    controlIpcInstalled = false
}

const OPERATOR_SAFE_ARRAY_LIMIT = 10_000
const OPERATOR_SAFE_TEXT_LIMIT = 32 * 1_024
const OPERATOR_BOOTSTRAP_SUMMARY_LIMIT = 200
const OPERATOR_PRIVATE_KEYS = /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu
const OPERATOR_PRIVATE_INPUT_KEYS = /(?:token|socket|capabilityId|executablePath)/iu

function operatorSafeValue(value, depth = 0) {
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") {
        return value.length <= OPERATOR_SAFE_TEXT_LIMIT
            ? value
            : `${value.slice(0, OPERATOR_SAFE_TEXT_LIMIT - 1)}…`
    }
    if (depth >= 8 || !value || typeof value !== "object") return null
    if (Array.isArray(value)) {
        return value.slice(0, OPERATOR_SAFE_ARRAY_LIMIT)
            .map((entry) => operatorSafeValue(entry, depth + 1))
    }
    const output = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, "value") || OPERATOR_PRIVATE_KEYS.test(key)) continue
        output[key] = operatorSafeValue(descriptor.value, depth + 1)
    }
    return output
}

function publicOperatorSessionSummary(session = {}) {
    const runtime = session.runtime ?? {}
    return operatorSafeValue({
        id: session.id,
        runtime: {
            runtimeId: runtime.runtimeId,
            providerId: runtime.providerId,
            displayName: runtime.displayName,
            version: runtime.version ?? null,
        },
        modelId: session.modelId ?? null,
        effort: session.effort ?? null,
        protocol: session.protocol,
        transcriptSequence: Number.isSafeInteger(session.transcriptSequence)
            ? session.transcriptSequence
            : 0,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        closedAt: session.closedAt ?? null,
    })
}

function publicOperatorSession(session = {}) {
    return {
        ...publicOperatorSessionSummary(session),
        transcript: operatorSafeValue(Array.isArray(session.transcript) ? session.transcript : []),
    }
}

function publicOperatorJob(job = {}) {
    return operatorSafeValue({
        id: job.id,
        sessionId: job.sessionId,
        parentJobId: job.parentJobId ?? null,
        type: job.type,
        objective: job.objective,
        budget: job.budget,
        status: job.status,
        childJobIds: Array.isArray(job.children) ? job.children : [],
        artifactIds: Array.isArray(job.artifactIds) ? job.artifactIds : [],
        approvalIds: Array.isArray(job.approvalIds) ? job.approvalIds : [],
        checkpoint: job.checkpoint ?? null,
        error: job.error ?? null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
    })
}

function publicOperatorStep(step = {}) {
    return operatorSafeValue({
        id: step.id,
        jobId: step.jobId,
        sessionId: step.sessionId,
        method: step.method,
        status: step.status,
        outputArtifactIds: Array.isArray(step.outputArtifactIds) ? step.outputArtifactIds : [],
        attempt: step.attempt,
        error: step.error ?? null,
        createdAt: step.createdAt,
        updatedAt: step.updatedAt,
        startedAt: step.startedAt ?? null,
        completedAt: step.completedAt ?? null,
    })
}

function publicOperatorApproval(approval = {}) {
    return operatorSafeValue({
        id: approval.id,
        jobId: approval.jobId,
        sessionId: approval.sessionId,
        stepId: approval.stepId ?? null,
        action: approval.action,
        scope: approval.scope,
        proposedMutation: approval.proposedMutation,
        risk: approval.risk,
        expiresAt: approval.expiresAt,
        status: approval.status,
        decision: approval.decision ?? null,
        decisionScope: approval.decisionScope ?? null,
        decidedBy: approval.decidedBy ?? null,
        createdAt: approval.createdAt,
        resolvedAt: approval.resolvedAt ?? null,
    })
}

function publicOperatorArtifact(artifact = {}) {
    return operatorSafeValue({
        id: artifact.id,
        jobId: artifact.jobId,
        kind: artifact.kind,
        name: artifact.name,
        mediaType: artifact.mediaType,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        metadata: artifact.metadata ?? null,
        createdAt: artifact.createdAt,
    })
}

function publicOperatorManagerSnapshot(snapshot = {}) {
    return {
        session: publicOperatorSession(snapshot.session),
        parentJob: publicOperatorJob(snapshot.parentJob),
        runtimeThreadId: typeof snapshot.runtimeThreadId === "string"
            ? snapshot.runtimeThreadId
            : null,
        transport: operatorSafeValue(snapshot.transport ?? null),
        state: String(snapshot.state ?? "unknown").slice(0, 100),
    }
}

function operatorSummarySnapshotPage({cursor = null, limit = OPERATOR_BOOTSTRAP_SUMMARY_LIMIT} = {}) {
    if (typeof operatorJobStore?.readSummaryPage !== "function") {
        return {
            generation: null,
            revision: 0,
            sessions: [],
            jobs: [],
            steps: [],
            approvals: [],
            totals: {sessions: 0, jobs: 0, steps: 0, approvals: 0},
            truncated: false,
            nextCursor: null,
        }
    }
    return publicOperatorSummaryPage(operatorJobStore.readSummaryPage({cursor, limit}))
}

function operatorBootstrapSnapshot() {
    return operatorSummarySnapshotPage()
}

function operatorArtifactPage(input = {}) {
    const jobId = requireIdentifier(input.jobId, "Operator Job")
    const cursor = input.cursor === null || input.cursor === undefined ? 0 : Number(input.cursor)
    const limit = input.limit === undefined ? 100 : Number(input.limit)
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Operator artifact cursor is invalid")
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
        throw new Error("Operator artifact page limit is invalid")
    }
    const artifacts = operatorJobStore.listArtifacts(jobId).map(publicOperatorArtifact)
    const end = Math.min(artifacts.length, cursor + limit)
    return {
        artifacts: artifacts.slice(cursor, end),
        nextCursor: end < artifacts.length ? end : null,
    }
}

function rendererOperatorInput(input, allowedKeys) {
    if (!isSafeControlRecord(input) || Object.keys(input).some((key) => !allowedKeys.has(key))) {
        throw new Error("Invalid Operator request")
    }
    const pending = [input]
    let visited = 0
    while (pending.length > 0) {
        const value = pending.pop()
        if (!value || typeof value !== "object") continue
        visited += 1
        if (visited > 10_000) throw new Error("Operator request is too large")
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
            if (!Object.hasOwn(descriptor, "value") || OPERATOR_PRIVATE_INPUT_KEYS.test(key)) {
                throw new Error("Operator request contains a private control field")
            }
            if (descriptor.value && typeof descriptor.value === "object") pending.push(descriptor.value)
        }
    }
    return structuredClone(input)
}

function requireOperatorSessionManager() {
    if (!operatorSessionManager) throw new Error("Operator session manager is unavailable")
    return operatorSessionManager
}

function sendOperatorNotification(channel, payload) {
    try {
        send(channel, payload)
    } catch {
        // The durable mutation already committed; renderer delivery is best-effort.
    }
}

function operatorChangeDelta(operation, result, args = []) {
    const generation = typeof operatorJobStore?.generation === "string"
        ? operatorJobStore.generation
        : null
    const revision = Number.isSafeInteger(operatorJobStore?.revision)
        ? operatorJobStore.revision
        : 0
    const delta = {generation, revision, invalidate: true, operation}
    const candidate = result?.job ?? result
    if (candidate?.runtime && typeof candidate?.protocol === "string") {
        delta.session = publicOperatorSessionSummary(candidate)
    } else if (
        typeof candidate?.sessionId === "string" &&
        typeof candidate?.type === "string" &&
        Array.isArray(candidate?.children)
    ) {
        delta.job = publicOperatorJob(candidate)
    } else if (
        typeof candidate?.jobId === "string" &&
        typeof candidate?.method === "string"
    ) {
        delta.step = operatorSafeValue({
            id: candidate.id,
            jobId: candidate.jobId,
            sessionId: candidate.sessionId,
            method: candidate.method,
            status: candidate.status,
            attempt: candidate.attempt,
            updatedAt: candidate.updatedAt,
            completedAt: candidate.completedAt ?? null,
        })
    } else {
        const entityId = typeof candidate?.id === "string"
            ? candidate.id
            : typeof args[0] === "string" ? args[0] : null
        if (entityId !== null) delta.entityId = entityId
    }
    return operatorSafeValue(delta)
}

function operatorNotificationEnvelope(key, value) {
    const generation = typeof operatorJobStore?.generation === "string"
        ? operatorJobStore.generation
        : null
    const revision = Number.isSafeInteger(operatorJobStore?.revision)
        ? operatorJobStore.revision
        : 0
    return operatorSafeValue({generation, revision, invalidate: true, [key]: value})
}

function notifyOperatorChanged(result, args, operation) {
    sendOperatorNotification(
        "operator:changed",
        operatorChangeDelta(operation, result, args),
    )
}

function observeOperatorStore(store_) {
    const wrap = (method, notify) => {
        const operation = store_[method].bind(store_)
        Object.defineProperty(store_, method, {
            configurable: false,
            enumerable: false,
            writable: false,
            value(...args) {
                const result = operation(...args)
                try {
                    notify(result, args, method)
                } catch {
                    // Notification projection cannot roll back a committed Store mutation.
                }
                return result
            },
        })
    }
    for (const method of [
        "createSession",
        "createJob",
        "createStep",
        "transitionStep",
        "transitionJob",
        "beginCancellation",
        "interruptJob",
        "cancelJobTree",
    ]) wrap(method, notifyOperatorChanged)
    wrap("appendSessionTranscript", (entry) => {
        sendOperatorNotification(
            "operator:event",
            operatorNotificationEnvelope("event", entry),
        )
    })
    wrap("appendEvent", (event) => {
        sendOperatorNotification(
            "operator:event",
            operatorNotificationEnvelope("event", event),
        )
    })
    wrap("createApproval", (approval) => {
        sendOperatorNotification(
            "operator:approval",
            operatorNotificationEnvelope("approval", publicOperatorApproval(approval)),
        )
        notifyOperatorChanged(approval, [], "createApproval")
    })
    wrap("resolveApproval", (approval) => {
        sendOperatorNotification(
            "operator:approval",
            operatorNotificationEnvelope("approval", publicOperatorApproval(approval)),
        )
        notifyOperatorChanged(approval, [], "resolveApproval")
    })
    wrap("createArtifact", (artifact) => {
        sendOperatorNotification(
            "operator:artifact",
            operatorNotificationEnvelope("artifact", publicOperatorArtifact(artifact)),
        )
        notifyOperatorChanged(artifact, [], "createArtifact")
    })
    return store_
}

const operatorSessionServiceFacade = Object.freeze({
    pause(sessionId) {
        if (!operatorSessionManager) throw new Error("Operator session manager unavailable")
        return operatorSessionManager.pause(sessionId)
    },
    resume(sessionId) {
        if (!operatorSessionManager) throw new Error("Operator session manager unavailable")
        return operatorSessionManager.resume(sessionId)
    },
    resumeAfterApproval(sessionId) {
        if (!operatorSessionManager) throw new Error("Operator session manager unavailable")
        return operatorSessionManager.resumeAfterApproval(sessionId)
    },
    stop(sessionId) {
        if (!operatorSessionManager) throw new Error("Operator session manager unavailable")
        return operatorSessionManager.stop(sessionId)
    },
})

function requireOptimizationControlService() {
    if (!optimizationControlService) throw new Error("Optimization control service unavailable")
    return optimizationControlService
}

const optimizationControlServiceFacade = Object.freeze({
    preflight(input) { return requireOptimizationControlService().preflight(input) },
    start(input) { return requireOptimizationControlService().start(input) },
    get(runId) { return requireOptimizationControlService().get(runId) },
    scope(runId) { return requireOptimizationControlService().scope(runId) },
    pause(runId) { return requireOptimizationControlService().pause(runId) },
    resume(runId) { return requireOptimizationControlService().resume(runId) },
    stop(runId) { return requireOptimizationControlService().stop(runId) },
    submitCandidate(input, context) {
        return requireOptimizationControlService().submitCandidate(input, context)
    },
    submitDecision(input, context) {
        return requireOptimizationControlService().submitDecision(input, context)
    },
    report(runId) { return requireOptimizationControlService().report(runId) },
})

function initializeControlPlane() {
    if (controlPlane) return controlPlane
    capabilityStore = new CapabilityStore()
    rendererCapabilityIssuer = createTrustedHumanCapabilityIssuer(capabilityStore, {
        maxScopeIds: MAX_TRUSTED_SCOPE_IDS,
    })
    installationCapabilityIssuer = createTrustedCapabilityIssuer(capabilityStore, {
        maxScopeIds: MAX_TRUSTED_SCOPE_IDS,
    })
    rendererServiceErrorDiagnostics = createServiceErrorDiagnosticChannel()
    controlPolicy = createControlPolicy()
    controlServices = createDomainServices({
        rawCaseStore,
        evaluationStore: store,
        evaluationRunner,
        managedSkillManager,
        managedSkillStore,
        operatorJobStore,
        operatorJobEngine,
        operatorSessionManager: operatorSessionServiceFacade,
        curationManager,
        rubricManager,
        skillInstallationStore,
        skillInstallationManager,
        optimizationControlService: optimizationControlServiceFacade,
        listDatasets: listDatasetsForControl,
        listRawCaseSkills: trustedRawCaseSkills,
        workspaceRoot: () => workspaceRoot,
        listRuntimes: () => availableRuntimes,
        listModelsForRuntime: listModelsForRuntimeFromControl,
        startEvaluation: startEvaluationFromControl,
        resolveManagedSkillBinding,
    })
    controlPlane = new ControlPlane({
        capabilities: capabilityStore,
        policy: controlPolicy,
        services: controlServices,
        serviceErrorDiagnostics: rendererServiceErrorDiagnostics,
        auditSink: {
            record(event) {
                if (controlAuditEvents.length === CONTROL_AUDIT_LIMIT) {
                    controlAuditEvents.shift()
                }
                controlAuditEvents.push(event)
            },
        },
    })
    controlSocketServer = new ControlSocketServer({
        userData: app.getPath("userData"),
        controlPlane,
    })
    controlInvocationsAccepted = true
    installControlIpc()
    return controlPlane
}

function canonicalOperatorJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalOperatorJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalOperatorJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function operatorEvaluationSelection(datasetId) {
    const dataset = store.getDataset(requireIdentifier(datasetId, "Dataset"))
    const cases = store.listCases(dataset.id)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const caseIds = cases.map((entry) => entry.id)
    const revisionSource = canonicalOperatorJson({
        dataset,
        cases,
        caseIds,
    })
    return {
        caseIds,
        datasetRevision: `sha256:${createHash("sha256").update(revisionSource).digest("hex")}`,
    }
}

function operatorRuntimeTelemetry() {
    return availableRuntimes.map((runtime) => {
        const capabilities = new Set(Array.isArray(runtime.capabilities) ? runtime.capabilities : [])
        return {
            runtimeId: runtime.runtimeId,
            tokens: capabilities.has("token-usage"),
            cost: capabilities.has("cost-usage"),
        }
    })
}

function operatorReconcilers() {
    return {
        evaluation(input) {
            try {
                const run = store.getEvaluationRun(input.runId)
                return {
                    status: ["completed", "failed", "cancelled"].includes(run.status)
                        ? "completed"
                        : run.status,
                    result: {runId: run.id, status: run.status},
                }
            } catch {
                return {status: "failed", error: {
                    code: "EVALUATION_NOT_FOUND",
                    message: "The frozen Evaluation run no longer exists",
                }}
            }
        },
        installation(input) {
            try {
                const job = skillInstallationStore.getJob(input.installationId)
                return {
                    status: job.status,
                    installationId: job.id,
                    runtimeId: job.runtime?.runtimeId,
                    skillId: job.request?.source?.skillId,
                    versionId: job.request?.source?.versionId,
                    result: {installationId: job.id, status: job.status},
                }
            } catch {
                return {status: "failed", error: {
                    code: "INSTALLATION_NOT_FOUND",
                    message: "The frozen Skill installation no longer exists",
                }}
            }
        },
        release(input) {
            try {
                const version = managedSkillStore.getVersion(input.versionId)
                return {
                    status: version.state === "released" || version.releasedAt
                        ? "released"
                        : version.state,
                    candidateId: version.id,
                    tag: version.versionLabel,
                    result: {versionId: version.id, versionLabel: version.versionLabel},
                }
            } catch {
                return {status: "failed", error: {
                    code: "VERSION_NOT_FOUND",
                    message: "The frozen managed Skill version no longer exists",
                }}
            }
        },
    }
}

function initializeOperatorRuntime() {
    if (operatorSessionManager) return operatorSessionManager
    operatorJobStore = observeOperatorStore(new OperatorJobStore(
        join(app.getPath("userData"), "operator-jobs.json"),
    ))
    const handlers = Object.fromEntries(CONTROL_METHODS
        .filter((method) => controlDefinition(method).operatorExposed === true)
        .map((method) => [method, ({params, controlContext}) => {
            if (!controlServices) throw new Error("Operator control services unavailable")
            return controlServices[method](params, controlContext)
        }]))
    operatorJobEngine = new OperatorJobEngine({
        store: operatorJobStore,
        handlers,
        reconcilers: operatorReconcilers(),
        runtimeTelemetry: operatorRuntimeTelemetry,
        resolveEvaluationCaseCount: ({datasetId}) => operatorEvaluationSelection(datasetId),
        resolveTrustedFacts: (request) => {
            if (!controlServices?.resolveTrustedFacts) return null
            return controlServices.resolveTrustedFacts(request)
        },
    })
    initializeControlPlane()
    operatorCapabilityIssuer = createTrustedCapabilityIssuer(capabilityStore, {
        maxScopeIds: MAX_TRUSTED_SCOPE_IDS,
    })
    operatorSessionManager = new OperatorSessionManager({
        store: operatorJobStore,
        engine: operatorJobEngine,
        controlPlane,
        runtimeRegistry,
        capabilities: {
            issue: (request) => operatorCapabilityIssuer.issue(request),
            revoke: (capabilityId) => capabilityStore.revoke(capabilityId),
        },
        controlSocketPath: join(app.getPath("userData"), "control", "control.sock"),
        operatorToolPath: app.isPackaged
            ? join(process.resourcesPath, "rolling-skill-tool")
            : join(__dirname, "..", "dist-tools", "rolling-skill-tool"),
        transportSupport: (runtime) => ({
            dynamicToolsReady: runtime?.providerId === "codex",
            mcpServersReady: runtime?.providerId === "codebuddy",
            dshMcpReady: runtime?.providerId === "deepseek-harness",
        }),
        requestPermission: () => "decline",
        requestQuestion: () => ({answers: []}),
        workspaceRoot,
        resolveManagedSkillWorkspace,
        traceDirectory: join(app.getPath("userData"), "traces", "operator"),
    })
    return operatorSessionManager
}

function optimizationDigest(value) {
    return `sha256:${createHash("sha256").update(canonicalOperatorJson(value)).digest("hex")}`
}

function optimizationRevision(value) {
    const hex = createHash("sha256").update(canonicalOperatorJson(value)).digest("hex").slice(0, 12)
    return Number.parseInt(hex, 16) + 1
}

function optimizationDatasetSnapshot(datasetId) {
    const dataset = store.getDataset(requireIdentifier(datasetId, "Optimization Dataset"))
    const cases = store.listCases(dataset.id)
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    const rubric = store.getActiveDatasetRubric(dataset.id)
    if (!rubric) throw new Error("Optimization requires an active published Dataset Rubric")
    const binding = dataset.skillReference ?? {}
    const repositoryId = requireIdentifier(binding.repositoryId, "Dataset repository")
    const skillId = requireIdentifier(binding.id, "Dataset Skill")
    const caseRevisions = cases.map((entry) => ({
        caseId: requireIdentifier(entry.id, "Dataset Case"),
        revision: Number.isSafeInteger(entry.revision) && entry.revision > 0
            ? entry.revision
            : optimizationRevision(entry),
        rubricVersionId: requireIdentifier(entry.rubricVersionId, "Case Rubric version"),
        calibrationStatus: entry.rubricCalibration?.status === "current"
            ? "current"
            : "needed",
    }))
    const datasetBody = {dataset, cases}
    return {
        dataset,
        cases,
        rubric,
        snapshot: {
            id: dataset.id,
            revision: optimizationRevision(datasetBody),
            caseRevisions,
            digest: optimizationDigest(datasetBody),
            repositoryId,
            skillId,
        },
    }
}

async function resolveOptimizationPreflight(config) {
    const skill = managedSkillStore.getSkill(requireIdentifier(config.skillId, "Optimization Skill"))
    const version = managedSkillStore.getVersion(requireIdentifier(
        config.baselineVersionId,
        "Optimization baseline version",
    ))
    const repository = managedSkillStore.getRepository(skill.repositoryId)
    if (version.state !== "released" || version.skillId !== skill.id ||
        version.repositoryId !== repository.id) {
        throw new Error("Optimization baseline must be the selected Skill's Released version")
    }
    const frozenDataset = optimizationDatasetSnapshot(config.datasetId)
    const runtimeIds = [...new Set([
        config.operator.runtimeId,
        config.judge.runtimeId,
        ...config.targets.map((target) => target.runtimeId),
    ])]
    const runtimes = runtimeIds.map((runtimeId) => {
        const runtime = availableRuntimes.find((entry) => entry.runtimeId === runtimeId)
        if (!runtime) throw new Error(`Optimization Runtime ${runtimeId} is unavailable`)
        return runtime
    })
    for (const target of config.targets) {
        optimizationReleasedSkillBinding({
            runtimeConfiguration: optimizationRuntimeConfiguration(target, "Target"),
            repository,
            skill,
            version,
        })
    }
    assertOptimizationTelemetrySupport(config, runtimes)
    const skillEvidence = await snapshotManagedSkillEvidence({
        name: skill.name,
        repositoryId: repository.id,
        skillId: skill.id,
        versionId: version.id,
        repositoryPath: repository.managedPath,
        commit: version.commit,
        skillRoot: version.skillRoot,
        contentDigest: version.contentDigest,
    }, {git: managedSkillManager.git})
    return {
        baseline: {
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: version.id,
            commit: version.commit,
            skillRoot: version.skillRoot,
            contentDigest: version.contentDigest,
            state: version.state,
        },
        dataset: frozenDataset.snapshot,
        rubric: {
            id: frozenDataset.rubric.id,
            version: frozenDataset.rubric.version,
            scoringModel: frozenDataset.rubric.rubric?.scoringModel,
            digest: frozenDataset.rubric.rubricDigest,
            datasetId: frozenDataset.dataset.id,
            publishedAt: frozenDataset.rubric.publishedAt,
        },
        skillEvidence,
    }
}

function optimizationRuntimeConfiguration(requested, label) {
    const runtimeId = requireIdentifier(requested.runtimeId, `${label} runtime`)
    const descriptor = availableRuntimes.find((entry) => entry.runtimeId === runtimeId)
    if (!descriptor) throw new Error(`${label} Runtime ${runtimeId} is unavailable`)
    return {
        ...descriptor,
        modelId: optionalIdentifier(requested.modelId, `${label} model`),
        effort: optionalEffort(requested.effort),
        skillEvidenceBinding: "verified",
    }
}

function optimizationInstalledSkillPath(destination) {
    return basename(destination).toLocaleLowerCase("en-US") === "skill.md"
        ? destination
        : join(destination, "SKILL.md")
}

function optimizationReleasedSkillBinding({runtimeConfiguration, repository, skill, version}) {
    let installation
    try {
        installation = skillInstallationStore.resolveVerifiedInstallation({
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: version.id ?? version.versionId,
            runtimeId: runtimeConfiguration.runtimeId,
            providerId: runtimeConfiguration.providerId,
        })
    } catch (error) {
        const runtime = runtimeConfiguration.displayName ?? runtimeConfiguration.runtimeId
        throw new Error(
            `Optimization target ${runtime} requires the selected Released baseline to be ` +
            `installed and verified. Install it from Skill Installations before starting: ` +
            `${error?.message ?? String(error)}`,
        )
    }
    if (
        installation.commit !== version.commit ||
        installation.contentDigest !== version.contentDigest
    ) {
        throw new Error("Recorded Runtime installation does not match the Optimization Released baseline")
    }
    return {
        ...runtimeConfiguration,
        skillEvidenceBinding: "verified",
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: skill.id,
            repositoryId: repository.id,
            name: skill.name,
            path: optimizationInstalledSkillPath(installation.destination),
            scope: "runtime",
            description: skill.description ?? null,
            runtimeId: runtimeConfiguration.runtimeId,
            providerId: runtimeConfiguration.providerId,
            confirmedAt: installation.installedAt,
        },
        installationId: installation.installationId ?? installation.id,
        installationJobId: installation.jobId,
        installationVerification: installation.verification,
        expectedContentDigest: version.contentDigest,
    }
}

function optimizationCandidateSkillBinding({
    runtimeConfiguration,
    repository,
    skill,
    candidate,
    installationJob,
}) {
    const versionId = candidate.id ?? candidate.versionId
    if (
        installationJob?.status !== "succeeded" ||
        installationJob.request?.purpose !== "optimization-experiment" ||
        installationJob.parsedResult?.trusted !== true ||
        !installationJob.parsedResult.destination ||
        !installationJob.parsedResult.verification ||
        installationJob.parsedResult.verification === "none" ||
        installationJob.runtime?.runtimeId !== runtimeConfiguration.runtimeId ||
        installationJob.runtime?.providerId !== runtimeConfiguration.providerId ||
        installationJob.request.source?.repositoryId !== repository.id ||
        installationJob.request.source?.skillId !== skill.id ||
        installationJob.request.source?.versionId !== versionId ||
        installationJob.request.source?.commit !== candidate.commit ||
        installationJob.request.source?.expectedDigest !== candidate.contentDigest
    ) {
        throw new Error(
            `Optimization target ${runtimeConfiguration.runtimeId} lacks a trusted Candidate installation`,
        )
    }
    return {
        ...runtimeConfiguration,
        skillEvidenceBinding: "verified",
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: skill.id,
            repositoryId: repository.id,
            name: skill.name,
            path: optimizationInstalledSkillPath(installationJob.parsedResult.destination),
            scope: "runtime",
            description: skill.description ?? null,
            runtimeId: runtimeConfiguration.runtimeId,
            providerId: runtimeConfiguration.providerId,
            confirmedAt: installationJob.completedAt ?? new Date().toISOString(),
        },
        installationJobId: installationJob.id,
        installationVerification: installationJob.parsedResult.verification,
        expectedContentDigest: candidate.contentDigest,
    }
}

async function runOptimizationEvaluation(input) {
    const optimizationRun = input.optimizationRun
    const snapshot = optimizationRun.snapshot
    const frozenDataset = optimizationDatasetSnapshot(snapshot.dataset.id)
    if (frozenDataset.snapshot.digest !== snapshot.dataset.digest ||
        frozenDataset.rubric.id !== snapshot.rubric.id ||
        frozenDataset.rubric.rubricDigest !== snapshot.rubric.digest) {
        throw Object.assign(new Error("Frozen Optimization Dataset or Rubric changed"), {
            code: "RESOURCE_CHANGED",
        })
    }
    const candidate = input.candidate
    const versionId = candidate.id ?? candidate.versionId
    const version = {...candidate, id: versionId}
    const skill = managedSkillStore.getSkill(candidate.skillId)
    const repository = managedSkillStore.getRepository(candidate.repositoryId)
    const skillEvidence = await snapshotManagedSkillEvidence({
        name: skill.name,
        repositoryId: repository.id,
        skillId: skill.id,
        versionId,
        repositoryPath: repository.managedPath,
        commit: candidate.commit,
        skillRoot: candidate.skillRoot,
        contentDigest: candidate.contentDigest,
    }, {git: managedSkillManager.git})
    const installationJobsByRuntime = new Map(
        (input.installationJobs ?? []).map((job) => [job.runtime.runtimeId, job]),
    )
    const runtimeConfigurations = input.targets.map((target) => {
        const runtimeConfiguration = optimizationRuntimeConfiguration(target, "Target")
        if (input.kind === "baseline" || input.kind === "final-regression") {
            return optimizationReleasedSkillBinding({
                runtimeConfiguration,
                repository,
                skill,
                version,
            })
        }
        return optimizationCandidateSkillBinding({
            runtimeConfiguration,
            repository,
            skill,
            candidate: version,
            installationJob: installationJobsByRuntime.get(runtimeConfiguration.runtimeId),
        })
    })
    const installationJobIdsByRuntime = Object.fromEntries(runtimeConfigurations.map(
        (configuration) => [configuration.runtimeId, configuration.installationJobId],
    ))
    const managedVersionSnapshot = {
        repositoryId: repository.id,
        skillId: skill.id,
        versionId,
        commit: candidate.commit,
        skillRoot: candidate.skillRoot,
        contentDigest: candidate.contentDigest,
        installationJobIdsByRuntime,
    }
    const judgeConfiguration = optimizationRuntimeConfiguration(snapshot.judge, "Judge")
    const run = store.createEvaluationRun({
        datasetId: snapshot.dataset.id,
        caseIds: snapshot.dataset.caseRevisions.map((entry) => entry.caseId),
        selectionMode: "selected",
        activationMode: snapshot.activationMode,
        skillEvidence,
        managedVersionSnapshot,
        judgeProfile: {
            runtimePolicy: "active",
            modelId: judgeConfiguration.modelId,
            effort: judgeConfiguration.effort,
        },
        judgeConfiguration,
        runtimeConfigurations,
    }, {optimizationAuthorized: true})
    await evaluationRunner.run(run)
    return store.getEvaluationRun(run.id)
}

function optimizationVersionLabel(runId, epoch) {
    const safeRun = String(runId).replace(/[^A-Za-z0-9._-]/gu, "-").slice(-40)
    return `opt-${safeRun}-e${epoch}`.slice(0, 64)
}

async function requestOptimizationApproval(input, onPending = null) {
    const kind = requireIdentifier(input.kind, "Optimization approval kind")
    const parentJobId = requireIdentifier(input.parentJobId, "Optimization parent Job")
    const versionId = input.candidate?.id ?? input.versionId ?? null
    const scope = {
        runId: input.runId,
        epoch: input.epoch,
        kind,
        ...(versionId ? {versionId} : {}),
        ...(input.request ? {requestedLimit: input.request} : {}),
    }
    const risks = {
        limit: "Expand a frozen Optimization hard limit",
        "release-install": "Release the selected immutable Optimization Candidate and install it on every frozen target Runtime",
        release: "Release the selected immutable Optimization Candidate",
        install: "Install the approved Released Skill on every selected Runtime",
    }
    const approval = await operatorJobEngine.requestApproval(parentJobId, {
        action: `optimization.${kind}`,
        risk: risks[kind] ?? "Approve an Optimization mutation",
        scope,
        proposedMutation: scope,
        idempotencyKey: [input.runId, kind, input.epoch, versionId ?? input.request?.field]
            .filter((value) => value !== null && value !== undefined)
            .join(":"),
    }, {onPending})
    return {
        ...approval,
        ...(kind === "release" || kind === "release-install" ? {
            versionLabel: optimizationVersionLabel(input.runId, input.epoch),
        } : {}),
    }
}

function releaseOptimizationCandidate(input) {
    const candidate = input.candidate
    return managedSkillManager.releaseVersion({
        versionId: candidate.id,
        versionLabel: input.approval.versionLabel,
        expectedCandidate: {
            commit: candidate.commit,
            contentDigest: candidate.contentDigest,
            state: candidate.state,
            versionLabel: input.approval.versionLabel,
        },
    })
}

function optimizationTelemetry({runId}) {
    const run = optimizationStore.getRun(runId)
    const parentJobId = run.checkpoint?.operatorParentJobId
    const usage = {runtimeTurns: 0, tokens: 0, reportedCost: 0}
    if (parentJobId) {
        for (const event of operatorJobStore.listEvents(parentJobId)) {
            if (event.kind !== "operator_budget_reserved") continue
            for (const field of Object.keys(usage)) usage[field] += Number(event.usage?.[field] ?? 0)
        }
    }
    return {
        elapsedMs: Math.max(0, Date.now() - Date.parse(run.createdAt)),
        turnsUsed: usage.runtimeTurns,
        tokensUsed: run.snapshot.telemetry.tokens ? usage.tokens : null,
        costMicros: run.snapshot.telemetry.cost
            ? Math.round(usage.reportedCost * 1_000_000)
            : null,
    }
}

function initializeOptimizationRuntime() {
    if (optimizationControlService) return optimizationControlService
    optimizationStore = new OptimizationStore(
        join(app.getPath("userData"), "optimization-runs.json"),
    )
    optimizationWorkspaceManager = new OptimizationWorkspaceManager({
        applicationSupportDirectory: app.getPath("userData"),
        store: managedSkillStore,
    })
    optimizationOperatorGateway = new OptimizationOperatorGateway({
        onRequest: ({runId, kind, epoch, operatorSessionId}) => (
            operatorSessionManager.sendMessage(operatorSessionId, [
                `Optimization Run ${runId} is waiting for the Epoch ${epoch} ${kind} submission.`,
                kind === "candidate"
                    ? "Edit only the bound experiment worktree, then call optimization.submit_candidate."
                    : "Review the deterministic analysis, then call optimization.submit_decision.",
            ].join(" "))
        ),
    })
    optimizationRunner = new OptimizationRunner({
        store: optimizationStore,
        artifactStore: operatorJobStore,
        childJobs: {run: (input, operation) => operatorJobEngine.runChild(input, operation)},
        workspaceManager: optimizationWorkspaceManager,
        installationManager: skillInstallationManager,
        evaluationManager: {run: runOptimizationEvaluation},
        operatorGateway: optimizationOperatorGateway,
        approvals: {
            request: requestOptimizationApproval,
            reject: (approvalId) => operatorJobEngine.resolveApproval(approvalId, {
                decision: "reject",
                scope: "optimization_cancel",
                decidedBy: "optimization-runner",
            }),
            suspend: (approvalId) => operatorJobEngine.suspendApprovalWaiter(approvalId),
        },
        releaseManager: {release: releaseOptimizationCandidate},
        telemetry: optimizationTelemetry,
        onChanged: (update) => send("optimization:changed", update),
    })
    optimizationControlService = new OptimizationControlService({
        store: optimizationStore,
        workspaceManager: optimizationWorkspaceManager,
        operatorSessionManager,
        runner: optimizationRunner,
        operatorGateway: optimizationOperatorGateway,
        artifactStore: operatorJobStore,
        readArtifact: (artifactId, maximumBytes) => {
            const artifact = operatorJobStore.getArtifact(artifactId)
            if (artifact.byteLength > maximumBytes) return null
            return operatorJobStore.readArtifactBody(artifactId)
        },
        resolvePreflight: resolveOptimizationPreflight,
    })
    return optimizationControlService
}

function startControlSocket() {
    if (controlSocketStartPromise) return controlSocketStartPromise
    controlSocketStartPromise = controlSocketServer.start().catch(() => {
        if (!controlInvocationsAccepted) return null
        controlSocketStartupDiagnostic =
            "Local control transport is unavailable. Desktop actions remain available."
        dialog.showErrorBox(
            "Rolling Skill control integration unavailable",
            controlSocketStartupDiagnostic,
        )
        return null
    })
    return controlSocketStartPromise
}

function stopControlPlane() {
    if (controlShutdownPromise) return controlShutdownPromise
    controlInvocationsAccepted = false
    removeControlIpc()
    revokeRendererCapabilities()
    controlShutdownPromise = (async () => {
        await controlSocketServer?.close()
    })()
    return controlShutdownPromise
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
    revokeRendererCapabilities()
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
    const createdWindow = mainWindow
    mainWindow.on("closed", () => {
        if (mainWindow !== createdWindow) return
        revokeRendererCapabilities()
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

async function chooseManagedSkillSource(kind) {
    const folder = kind === "folder" || kind === "local-git"
    const options = {
        title: kind === "zip"
            ? "Import Skill ZIP"
            : kind === "local-git"
              ? "Import local Git repository"
              : "Import Skill folder",
        properties: folder ? ["openDirectory"] : ["openFile"],
    }
    if (kind === "zip") options.filters = [{name: "ZIP archives", extensions: ["zip"]}]
    const result = await dialog.showOpenDialog(mainWindow, options)
    return result.canceled ? null : result.filePaths[0] ?? null
}

function notifyManagedSkills() {
    const overview = managedSkillManager.overview()
    send("managed-skills:changed", overview)
    return overview
}

function openManagedSkillStore(registryPath) {
    try {
        return new ManagedSkillStore(registryPath)
    } catch (error) {
        const quarantinePath = `${registryPath}.corrupt-${Date.now()}`
        renameSync(registryPath, quarantinePath)
        managedSkillStartupError =
            `The managed Skill registry was invalid and was moved to ${quarantinePath}. ` +
            `${error instanceof Error ? error.message : String(error)}`
        return new ManagedSkillStore(registryPath)
    }
}

function automaticRawCaseObservation(rawCase) {
    if (rawCase?.source?.kind !== "automatic_capture") {
        throw new Error("Only an automatic capture Raw Case can create a Case Draft")
    }
    const observations = Array.isArray(rawCase.source.observations)
        ? rawCase.source.observations
        : []
    const source = observations.at(-1) ?? rawCase.source
    return {
        runtimeId: requireIdentifier(source.runtimeId, "source Runtime"),
        threadId: requireIdentifier(source.threadId, "source task"),
        startTurnId: requireIdentifier(source.startTurnId, "episode start turn"),
        startItemId: requireIdentifier(source.startItemId, "episode start Item"),
        endTurnId: requireIdentifier(source.endTurnId, "episode end turn"),
        endItemId: requireIdentifier(source.endItemId, "episode end Item"),
        caseType: new Set(["goodcase", "badcase"]).has(source.caseType)
            ? source.caseType
            : "goodcase",
        reason: String(source.reason ?? rawCase.note ?? "").trim(),
    }
}

async function createCurationFromRawCase(input = {}) {
    const rawCaseId = requireIdentifier(input.rawCaseId, "Raw Case")
    const rawCase = rawCaseStore.get(rawCaseId)
    if (!rawCase) throw new Error(`Unknown pending Raw Case: ${rawCaseId}`)
    const source = automaticRawCaseObservation(rawCase)
    if (source.runtimeId !== runtimeDescriptor?.runtimeId) {
        throw new Error("Switch to the Raw Case source Runtime before creating its Case Draft")
    }
    const datasetId = requireIdentifier(input.datasetId, "dataset")
    const dataset = store.getDataset(datasetId)
    if (!sameAutomaticSkill(dataset.skillReference, rawCase.skill)) {
        throw new Error("The selected dataset is bound to a different Skill")
    }
    await requireAvailableDatasetSkill(dataset)
    requirePublishedDatasetRubric(dataset)
    const curatorProfile = store.read().settings.curatorProfile
    const session = await curationManager.createSession({
        datasetId,
        caseType: source.caseType,
        sourceThreadId: source.threadId,
        startItemId: source.startItemId,
        startTurnId: source.startTurnId,
        endItemId: source.endItemId,
        endTurnId: source.endTurnId,
        issueDescription: source.reason,
        traceReference: client?.recorder?.referenceForEpisode({
            threadId: source.threadId,
            startItemId: source.startItemId,
            endItemId: source.endItemId,
        }) ?? null,
        modelId: curatorProfile.modelId,
        effort: curatorProfile.effort,
    })
    rawCaseStore.markDispatched(rawCase.id, {
        mode: "curation",
        sessionId: session.id,
    })
    return session
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
            datasets: listDatasetsForControl(),
            curationSessions: store.listCurationSessions(),
            sourceCurationMarkers: sourceCurationMarkers(),
            curatorProfile: store.read().settings.curatorProfile,
            settings: store.read().settings,
            automaticCaptureStatus: automaticCaptureManager.status(),
            rawCases: rawCaseStore.list(),
            managedSkills: managedSkillManager.overview(),
            managedSkillStartupError,
            skillInstallations: skillInstallationManager.overview(),
            controlDiagnostic: controlSocketStartupDiagnostic,
            operator: operatorBootstrapSnapshot(),
        }
    })
    ipcMain.handle("operator:bootstrap", (event) => {
        assertRendererControlSender(event)
        return operatorBootstrapSnapshot()
    })
    ipcMain.handle("operator:summary-page", (event, input = {}) => {
        assertRendererControlSender(event)
        const request = rendererOperatorInput(input, new Set(["cursor", "limit"]))
        return operatorSummarySnapshotPage({
            cursor: request.cursor ?? null,
            limit: request.limit ?? OPERATOR_BOOTSTRAP_SUMMARY_LIMIT,
        })
    })
    ipcMain.handle("operator:create", async (event, input = {}) => {
        assertRendererControlSender(event)
        const request = rendererOperatorInput(input, new Set([
            "runtimeId",
            "modelId",
            "effort",
            "objective",
            "actions",
            "scopes",
            "budget",
            "expiresInMs",
            "managedSkillBinding",
        ]))
        return publicOperatorManagerSnapshot(
            await requireOperatorSessionManager().create(request),
        )
    })
    ipcMain.handle("operator:get", (event, input = {}) => {
        assertRendererControlSender(event)
        const request = rendererOperatorInput(input, new Set(["sessionId"]))
        return publicOperatorManagerSnapshot(
            requireOperatorSessionManager().get(
                requireIdentifier(request.sessionId, "Operator session"),
            ),
        )
    })
    ipcMain.handle("operator:send", async (event, input = {}) => {
        assertRendererControlSender(event)
        const request = rendererOperatorInput(
            input,
            new Set(["sessionId", "text"]),
        )
        return operatorSafeValue(await requireOperatorSessionManager().sendMessage(
            requireIdentifier(request.sessionId, "Operator session"),
            String(request.text ?? ""),
        ))
    })
    ipcMain.handle("operator:list-artifacts", (event, input = {}) => {
        assertRendererControlSender(event)
        const request = rendererOperatorInput(
            input,
            new Set(["jobId", "cursor", "limit"]),
        )
        return operatorArtifactPage(request)
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

    ipcMain.handle("raw-cases:delete", (_event, id) =>
        rawCaseStore.delete(requireIdentifier(id, "Raw Case")),
    )
    ipcMain.handle("raw-cases:mark-dispatched", (_event, input = {}) =>
        rawCaseStore.markDispatched(
            requireIdentifier(input.id, "Raw Case"),
            {
                threadId: requireIdentifier(input.threadId, "thread"),
                mode: input.mode === "current" ? "current" : "new",
                runtimeId: runtimeDescriptor?.runtimeId ?? null,
            },
        ),
    )
    ipcMain.handle("curation:create-from-raw-case", (_event, input = {}) =>
        createCurationFromRawCase(input),
    )
    ipcMain.handle("automatic-capture:status", () => automaticCaptureManager.status())

    ipcMain.handle("skill-repositories:rescan", async () => {
        const overview = await managedSkillManager.rescanAll()
        send("managed-skills:changed", overview)
        return overview
    })
    ipcMain.handle("skill-repositories:import", async (_event, input = {}) => {
        const kind = requireIdentifier(input.kind, "Skill source kind")
        if (!["zip", "folder", "local-git", "git-url"].includes(kind)) {
            throw new Error("Unsupported managed Skill source kind")
        }
        const location = kind === "git-url"
            ? requireGitSourceLocation(input.location)
            : await chooseManagedSkillSource(kind)
        if (!location) return {cancelled: true}
        const imported = await managedSkillManager.importSource({kind, location})
        const overview = notifyManagedSkills()
        return {
            cancelled: false,
            repository: overview.repositories.find((entry) => entry.id === imported.repository.id),
            skills: overview.skills.filter((entry) => entry.repositoryId === imported.repository.id),
            versions: overview.versions.filter((entry) => entry.repositoryId === imported.repository.id),
        }
    })
    ipcMain.handle("skill-repositories:reveal", (_event, input = {}) => {
        const path = managedSkillManager.repositoryPath(
            requireIdentifier(input.repositoryId, "repository"),
        )
        shell.showItemInFolder(path)
        return {revealed: true}
    })
    ipcMain.handle("skill-versions:create-candidate", async (_event, input = {}) => {
        const candidate = await managedSkillManager.createCandidate({
            skillId: requireIdentifier(input.skillId, "Skill"),
            message: String(input.message ?? ""),
        })
        notifyManagedSkills()
        return candidate
    })
    ipcMain.handle("skill-versions:release", async (_event, input = {}) => {
        const released = await managedSkillManager.releaseVersion({
            versionId: requireIdentifier(input.versionId, "version"),
            versionLabel: String(input.versionLabel ?? ""),
        })
        notifyManagedSkills()
        send("skill-versions:released", released)
        return released
    })
    ipcMain.handle("skill-versions:deprecate", async (_event, input = {}) => {
        const deprecated = await managedSkillManager.deprecateVersion({
            versionId: requireIdentifier(input.versionId, "version"),
        })
        notifyManagedSkills()
        return deprecated
    })

    ipcMain.handle("skill-installations:list", (_event, input = {}) =>
        skillInstallationManager.overview(
            optionalIdentifier(input.skillId, "Skill"),
        ),
    )
    ipcMain.handle("skill-installations:get", (_event, input = {}) =>
        skillInstallationStore.getJob(
            requireIdentifier(input.jobId, "Skill installation job"),
        ),
    )
    ipcMain.handle("skill-installations:start", (_event, input = {}) => {
        const targets = (Array.isArray(input.targets) ? input.targets : []).map((target) => ({
            runtimeId: requireIdentifier(target.runtimeId, "runtime"),
            modelId: optionalIdentifier(target.modelId, "model"),
            effort: optionalEffort(target.effort),
            permissionMode: optionalIdentifier(target.permissionMode, "permission mode"),
        }))
        return skillInstallationManager.start({
            skillId: requireIdentifier(input.skillId, "Skill"),
            versionId: requireIdentifier(input.versionId, "version"),
            targets,
        })
    })
    ipcMain.handle("skill-installations:cancel", (_event, input = {}) =>
        skillInstallationManager.cancel(
            requireIdentifier(input.jobId, "Skill installation job"),
        ),
    )
    ipcMain.handle("skill-installations:inspect", (_event, input = {}) =>
        skillInstallationManager.inspect(
            requireIdentifier(input.jobId, "Skill installation job"),
        ),
    )
    ipcMain.handle("skill-installations:respond-question", (_event, input = {}) => {
        const requestId = requireIdentifier(input.requestId, "Skill installation question")
        const jobId = requireIdentifier(input.jobId, "Skill installation job")
        const pending = pendingSkillInstallationQuestions.get(requestId)
        if (!pending || pending.jobId !== jobId) return {accepted: false, reason: "not-pending"}
        const answer = input.cancelled
            ? null
            : {answers: Array.isArray(input.answers) ? input.answers : []}
        settleSkillInstallationQuestion(
            pending,
            answer,
            input.cancelled ? "cancelled" : "answered",
        )
        return {accepted: true}
    })

    ipcMain.handle("runtime:list-threads", async (_event, input = {}) => {
        const archived = Boolean(input.archived)
        if (archived && !runtimeDescriptor?.capabilities?.includes("thread-archive")) {
            return {data: [], nextCursor: null, unsupported: true}
        }
        const response = await (await ensureRuntime()).listThreads({archived})
        return {
            ...response,
            data: (response.data ?? []).filter((thread) => !isHiddenRuntimeThread(thread)),
        }
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
    ipcMain.handle("skills:list", async (_event, input = {}) => {
        const runtime = await ensureRuntime()
        if (typeof runtime.listSkills !== "function") return {data: []}
        return cachedRuntimeSkills(await runtime.listSkills({
            forceReload: Boolean(input.forceReload),
        }))
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
        cachedRuntimeSkills(await runtime.listSkills({forceReload: true}))
        return response
    })
    ipcMain.handle("runtime:read-thread", async (_event, threadId) => {
        threadId = requireIdentifier(threadId, "thread")
        if (isHiddenRuntimeThread(threadId)) {
            throw new Error("Internal refresh, Curator, and Rubric Agent tasks are available through their review sessions only")
        }
        const runtime = await ensureRuntime()
        const sourceRuntimeId = runtimeDescriptor?.runtimeId
        const sourceProviderId = runtimeDescriptor?.providerId
        const observationEpoch = runtimeNotificationRouter.beginObservation(threadId)
        try {
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
            runtimeNotificationRouter.snapshotReady(observationEpoch)
            return {
                ...attachThreadProfile(withCoverage, threadId, sourceRuntimeId),
                rollingSkillObservationEpoch: observationEpoch,
            }
        } catch (error) {
            runtimeNotificationRouter.clear(observationEpoch)
            throw error
        }
    })
    ipcMain.handle("runtime:drain-observation", (_event, input = {}) =>
        runtimeNotificationRouter.drain(requireObservationEpoch(input.epoch)),
    )
    ipcMain.handle("runtime:clear-observation", (_event, input = {}) =>
        runtimeNotificationRouter.clear(
            input.epoch === null || input.epoch === undefined
                ? null
                : requireObservationEpoch(input.epoch),
        ),
    )
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
            const observationEpoch = runtimeNotificationRouter.beginObservation(response.thread.id)
            runtimeNotificationRouter.snapshotReady(observationEpoch)
            runtimeNotificationRouter.drain(observationEpoch)
            rememberThreadProfile(
                response.thread.id,
                {
                    modelId: model,
                    effort,
                    permissionMode: permission.permissionMode,
                },
                sourceRuntimeId,
            )
            return {
                ...attachThreadProfile(response, response.thread.id, sourceRuntimeId),
                rollingSkillObservationEpoch: observationEpoch,
            }
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
                        sourceRuntime.providerId === "codex" ||
                        sourceRuntime.providerId === "deepseek-harness"
                            ? permission
                            : {},
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
    ipcMain.handle("runtime:respond-question", (_event, input = {}) => {
        const requestId = requireIdentifier(input.requestId, "runtime question")
        const pending = pendingRuntimeQuestions.get(requestId)
        if (!pending) return {accepted: false, reason: "not-pending"}
        const processEpoch = pending.processEpoch
        const sourceClient = pending.sourceClient
        const current =
            pending.clientGeneration === clientGeneration &&
            pending.runtimeId === runtimeDescriptor?.runtimeId &&
            sourceClient === client &&
            (processEpoch === null || sourceClient?.processEpoch === processEpoch)
        if (!current) {
            settleRuntimeQuestion(pending, null, "stale")
            return {accepted: false, reason: "stale"}
        }
        const answer = input.cancelled
            ? null
            : {answers: Array.isArray(input.answers) ? input.answers : []}
        settleRuntimeQuestion(pending, answer, input.cancelled ? "cancelled" : "answered")
        return {accepted: true}
    })
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
    ipcMain.handle("datasets:delete", (_event, input = {}) =>
        caseRecycleService.deleteDataset({
            datasetId: requireIdentifier(input.datasetId, "dataset"),
            recoverQuestions: input.recoverQuestions !== false,
        }),
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
        caseRecycleService.deleteCase({
            datasetId: requireIdentifier(input.datasetId, "dataset"),
            caseId: requireIdentifier(input.caseId, "Case"),
            recoverQuestions: input.recoverQuestions !== false,
        }),
    )
    ipcMain.handle("cases:refresh", async (_event, input = {}) =>
        caseRefreshManager.createSession({
            datasetId: requireIdentifier(input.datasetId, "dataset"),
            caseId: requireIdentifier(input.caseId, "Case"),
        }),
    )
    ipcMain.handle("datasets:reveal", revealLocalData)
    ipcMain.handle("settings:update", (_event, input) => {
        const settings = store.updateSettings(input)
        client?.setExecutionPolicy?.(currentExecutionPolicy())
        automaticCaptureManager?.reschedule()
        return settings
    })

    ipcMain.handle("rubrics:list-versions", (_event, datasetId) =>
        store.listDatasetRubricVersions(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("rubrics:active", (_event, datasetId) =>
        store.getActiveDatasetRubric(requireIdentifier(datasetId, "dataset")),
    )
    ipcMain.handle("rubrics:migrate-legacy-contract", (_event, datasetId) =>
        store.migrateActiveDatasetRubricToUnified(
            requireIdentifier(datasetId, "dataset"),
        ),
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

    ipcMain.handle("evaluations:delete", (_event, runId) =>
        store.deleteEvaluationRun(requireIdentifier(runId, "evaluation run")),
    )
}

async function startEvaluationFromControl(input = {}) {
    const datasetId = requireIdentifier(input.datasetId, "dataset")
    const dataset = store.getDataset(datasetId)
    const assertFrozenDatasetRevision = () => {
        if (input.expectedDatasetRevision === undefined) return
        const currentSelection = operatorEvaluationSelection(datasetId)
        if (currentSelection.datasetRevision !== input.expectedDatasetRevision) {
            throw Object.assign(
                new Error("The Dataset changed after the Operator Step was approved"),
                {code: "RESOURCE_CHANGED"},
            )
        }
    }
    assertFrozenDatasetRevision()
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
    assertFrozenDatasetRevision()
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
}

function requireIdentifier(value, label) {
    if (typeof value !== "string" || !value || value.length > 200) {
        throw new Error(`A valid ${label} identifier is required`)
    }
    return value
}

function requireObservationEpoch(value) {
    const epoch = Number(value)
    if (!Number.isSafeInteger(epoch) || epoch <= 0) {
        throw new Error("A valid runtime observation epoch is required")
    }
    return epoch
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

async function shutdownApplication() {
    controlInvocationsAccepted = false
    const failures = []
    const stage = async (label, operation) => {
        try {
            await operation()
        } catch (error) {
            failures.push(error)
            console.error(`Rolling Skill ${label} shutdown failed`, error)
        }
    }
    await stage("Automatic capture", () => automaticCaptureManager?.stop())
    await stage("Optimization Runner", () => optimizationRunner?.checkpointAndStop?.())
    await stage("Optimization gateway", () => optimizationOperatorGateway?.cancelAll?.())
    await stage("Operator", () => operatorSessionManager?.stopAll?.({preserveWaitingApprovals: true}))
    await stage("Optimization Runner idle", () => optimizationRunner?.waitForIdle?.())
    await stage("Evaluation", () => evaluationRunner?.stopAll?.())
    await stage("Skill installation", () => skillInstallationManager?.stopAll?.())
    await stage("Chat Runtime", () => client?.stop?.())
    await stage("control transport", () => stopControlPlane())
    await stage("Optimization store close", () => optimizationStore?.close())
    await stage("Operator store flush", () => operatorJobStore?.flush())
    await stage("Operator store close", () => operatorJobStore?.close())
    await stage("activity store flush", () => activityStore?.flush())
    await stage("Raw Case store close", () => rawCaseStore?.close())
    if (failures.length > 0) {
        throw new AggregateError(failures, "Rolling Skill shutdown was incomplete")
    }
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
        rendererUrl = pathToFileURL(RENDERER_FILE).toString()
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
            callback(false)
        })
        workspaceRoot = locateInitialWorkspace()
        store = new LocalEvaluationStore(join(app.getPath("userData"), "evaluation-store.json"))
        automaticCaptureStateStore = new AutomaticCaptureStateStore(join(
            app.getPath("userData"),
            "automatic-capture-state.json",
        ))
        managedSkillStore = openManagedSkillStore(
            join(app.getPath("userData"), "skill-registry.json"),
        )
        managedSkillManager = new ManagedSkillManager({
            applicationSupportDirectory: app.getPath("userData"),
            store: managedSkillStore,
        })
        rawCaseStore = new RawCaseStore()
        rawCaseStore.subscribe((rawCases) => {
            send("raw-cases:changed", rawCases)
            automaticCaptureManager?.emitStatus()
        })
        caseRecycleService = new CaseRecycleService({store, rawCaseStore})
        activityStore = new ThreadActivityStore(
            join(app.getPath("userData"), "thread-activity-store.json"),
        )
        curationManager = new CurationManager({
            store,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
            onChanged: (session) => {
                send("curation:changed", session)
                void automaticCaptureManager?.handleCurationChanged(session)
            },
            onActivity: (activity) => send("curation:activity", activity),
        })
        caseRefreshManager = new CaseRefreshManager({
            store,
            curationManager,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
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
            stateStore: automaticCaptureStateStore,
            rawCaseStore,
            curationManager,
            getRuntime: ensureRuntime,
            getRuntimeDescriptor: () => runtimeDescriptor,
            listDatasets: () => store.listDatasets(),
            listSkills: async (runtime) => {
                if (typeof runtime.listSkills !== "function") return []
                const response = cachedRuntimeSkills(await runtime.listSkills({forceReload: true}))
                return (response.data ?? []).flatMap((entry) => entry.skills ?? [])
                    .filter((skill) => skill.enabled)
            },
            runAnalysis: async (input) => {
                const runtime = await ensureRuntime()
                if (typeof runtime.runEvaluationJudge !== "function") {
                    throw new Error("The active Runtime cannot run automatic capture analysis")
                }
                return runtime.runEvaluationJudge(input)
            },
            getHiddenThreadIds: () => new Set([
                ...store.listInternalThreadIds(),
                ...curationManager.hiddenThreadIds(),
                ...rubricManager.hiddenThreadIds(),
                ...caseRefreshManager.hiddenThreadIds(),
                ...(evaluationRunner?.hiddenThreadIds() ?? []),
                ...(operatorSessionManager?.hiddenThreadIds() ?? []),
                ...(skillInstallationManager?.hiddenThreadIds() ?? []),
            ]),
            onStatus: (status) => send("automatic-capture:status", status),
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
        skillInstallationStore = new SkillInstallationStore(
            join(app.getPath("userData"), "skill-installations.json"),
        )
        skillInstallationManager = new SkillInstallationManager({
            store: skillInstallationStore,
            managedSkillStore,
            managedSkillManager,
            runtimeRegistry,
            getRuntimes: () => availableRuntimes,
            workspaceRoot,
            traceDirectory: join(app.getPath("userData"), "traces", "skill-installations"),
            controlPlane: skillInstallationControlPlaneFacade,
            capabilities: skillInstallationCapabilityFacade,
            controlSocketPath: join(app.getPath("userData"), "control", "control.sock"),
            installationToolPath: app.isPackaged
                ? join(process.resourcesPath, "rolling-skill-tool")
                : join(__dirname, "..", "dist-tools", "rolling-skill-tool"),
            transportSupport: (runtime) => ({
                dynamicToolsReady: runtime?.providerId === "codex",
                mcpServersReady: runtime?.providerId === "codebuddy",
                dshMcpReady: runtime?.providerId === "deepseek-harness",
            }),
            resolvePermission: installerRuntimePermissionFor,
            requestPermission: (request) => showRuntimePermissionDialog({
                ...request,
                workspaceRoot,
            }),
            requestQuestion: requestSkillInstallationQuestion,
            onChanged: (job) => {
                invalidateRuntimeSkillCache()
                send("skill-installations:changed", job)
            },
        })
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
        initializeOperatorRuntime()
        initializeOptimizationRuntime()
        await optimizationControlService.recoverStartup()
        void startControlSocket()
        client = createClient()
        installIpc()
        installMenu()
        createWindow()
        automaticCaptureManager.start()
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
        void shutdownApplication()
            .catch((error) => console.error("Rolling Skill shutdown persistence failed", error))
            .finally(() => app.quit())
    })

    app.on("window-all-closed", () => {
        // Keep the local app-server available while the macOS app remains in the Dock.
    })
}
