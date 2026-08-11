const translations = {
    en: {
        newTask: "New task",
        tasks: "Tasks",
        settings: "Settings",
        datasets: "Datasets",
        trace: "Trace",
        runtime: "Runtime…",
        caseDrafts: "Case drafts",
        taskCouldNotContinue: "Task could not continue",
        dismiss: "Dismiss",
        taskPlaceholder: "Message the agent…",
        composerHint: "Enter to send · Shift+Enter for a new line",
        appearance: "Appearance",
        language: "Language",
        theme: "Theme",
        models: "Models",
        taskModel: "New task model",
        curatorModel: "Default Curator model",
        automaticCapture: "Automatic capture",
        automaticCaptureHelp: "Create a reviewable draft after each completed response. Nothing is saved until Done.",
        captureModel: "Capture Curator model",
        destinationDataset: "Destination dataset",
        defaultClassification: "Default classification",
        settingsLocalOnly: "Settings stay on this Mac.",
        cancel: "Cancel",
        save: "Save",
        discardDraft: "Discard this draft?",
        discardDraftHelp: "The Curator task will be stopped and archived. No case will be saved.",
        discard: "Discard",
        autoCaptureOff: "Automatic capture is off",
        autoCaptureOn: "Automatic capture is on",
        runtimeDefault: "Runtime default",
        sourceOrRuntimeModel: "Source / runtime model",
        model: "Model",
        send: "Send",
        doneSaveCase: "Done · save case",
        done: "Done",
        retry: "Retry",
        selectDraft: "Select a case draft to review it.",
        noDrafts: "No drafts yet. Use Curate case under an assistant response.",
        curatorConversation: "Curator conversation",
        curatorWorking: "Curator is working…",
        verbatimQuestion: "Verbatim question",
        queued: "Queued",
        running: "Running",
        needsReview: "Needs review",
        failed: "Failed",
        archived: "Archived",
        settingsSaved: "Settings saved",
        draftDiscarded: "Draft discarded; no case was saved",
        caseSaved: "Case saved and Curator archived",
        taskModelUpdated: "Task model updated",
        curatorModelUpdated: "Curator model updated",
        workspace: "Workspace",
        runtimeTrace: "Runtime trace",
        refresh: "Refresh",
        openFolder: "Open folder",
        traceInitial: "Trace begins when the local runtime starts.",
        agentRuntimes: "Agent runtimes",
        runtimeDialogCopy: "Compatible runtimes are discovered locally and are not installed or upgraded by Rolling Skill.",
        rescan: "Rescan",
        automaticRuntime: "Use automatic selection",
        addExecutable: "Add executable…",
        curateEpisode: "Curate a problem-solving episode",
        dataset: "Dataset",
        createDataset: "Create a new dataset",
        create: "Create",
        classification: "Classification",
        expectedSkill: "Expected Skill behavior",
        needsImprovement: "Needs improvement",
        episodeStartsAt: "Episode starts at",
        datasetQuestion: "Verbatim dataset question",
        endingResponse: "Selected ending response",
        frozenCopyHelp: "A frozen copy goes to Curator; the original task stays live.",
        startCuration: "Start curation",
        welcomeHeading: "What should we evaluate?",
        welcomeCopy: "Run a task through a compatible local agent runtime, then curate a complete problem-solving episode into a reviewable goodcase or badcase.",
        runtimeDiscovery: "Runtime auto-discovery",
        episodeCuration: "Episode curation",
        localTraceEvidence: "Local trace evidence",
        loadingTasks: "Loading local tasks…",
        noTasks: "No tasks in this workspace yet. Start one below.",
        loadingTask: "Loading task…",
        curateCase: "Curate case",
        curatorPromptPlaceholder: "Ask Curator to explain or revise this draft",
        you: "You",
        localEvidence: "LOCAL EVIDENCE",
        curatorTasks: "CURATOR TASKS",
        localProviders: "LOCAL PROVIDERS",
        caseDraft: "CASE DRAFT",
        curateEvaluationData: "CURATE EVALUATION DATA",
        chooseWorkspace: "Choose workspace",
        home: "Home",
        runtimeReady: "Local runtime ready",
        runtimeStarting: "Starting {name}",
        detectingRuntimes: "Detecting local runtimes",
        runtimeStopped: "Local runtime stopped",
        runtimeError: "Local runtime error",
        noRuntime: "No local runtime",
        localRuntime: "Local runtime",
        detected: "detected",
        rescanRuntimes: "Rescan compatible local runtimes",
        noCompatibleRuntime: "No compatible local runtime was detected. Rescan or choose an executable.",
        active: "Active",
        use: "Use",
        now: "now",
        minuteShort: "{count}m",
        hourShort: "{count}h",
        dayShort: "{count}d",
        image: "[Image]",
        audio: "[Audio]",
        reasoning: "Reasoning",
        working: "working",
        command: "command",
        fileChanges: "file changes",
        planUpdated: "Plan updated",
        completed: "completed",
        structuredReference: "Structured reference",
        referenceAnswer: "Reference answer",
        requiredFacts: "Required facts",
        requiredSteps: "Required steps",
        requiredOutputFormat: "Required output format",
        hardRequirements: "Hard requirements",
        pass: "Pass",
        basis: "Basis",
        softCriteria: "Soft criteria",
        weight: "weight {value}",
        automaticFailures: "Automatic failures",
        rootCauses: "Root causes",
        expectedRecovery: "Expected recovery",
        none: "None",
        untitledCase: "Untitled case",
        frozenRange: "Frozen range: {count} conversation and tool items. New messages in the original task are not included.",
        noSourceQuestion: "No source question was found before this response",
        createdDataset: "Created dataset “{name}”",
        episodeSent: "Frozen episode sent to Curator",
        readingTrace: "Reading local trace…",
        noEventsYet: "No events yet",
        noTraceEvents: "No trace events yet.",
        chat: "Chat",
        skillEvaluation: "Skill evaluation",
        evaluationWorkbench: "SKILL EVALUATION WORKBENCH",
        evaluateSkills: "Evaluate Skills against real language",
        evaluationWorkbenchHelp: "Keep questions verbatim, preflight the active runtime, and launch a test without forcing Skill activation.",
        cases: "Cases",
        verbatimQuestions: "Questions stay verbatim",
        testRun: "Test run",
        runtimePreflight: "Runtime preflight",
        skillUnderTest: "Skill under test",
        activationMode: "Activation mode",
        automaticTrigger: "Automatic trigger",
        automaticTriggerHelp: "Send only the original question. This is the scored path.",
        explicitDiagnostic: "Explicit diagnostic",
        explicitDiagnosticHelp: "Attach a structured Skill mention to isolate trigger failures.",
        startSelectedCase: "Start selected case",
        evaluationLaunchHelp: "The target task runs in the selected runtime. Automated grading is not applied yet; review the native task and its trace.",
        noDatasets: "No datasets yet.",
        noCases: "This dataset has no saved cases yet.",
        noSkills: "The active runtime reported no enabled Skills for this workspace.",
        selectCase: "Select one case to run.",
        skillReady: "Installed and enabled in {runtime}",
        originalQuestionOnly: "Original question only",
        explicitSkillAttached: "Structured Skill mention attached",
        evaluationStarted: "Test task started in Chat",
        localRuntimeAndData: "Local runtime & data",
        localRuntimeAndDataHelp: "Runtime discovery, raw trace, and the local evaluation store stay on this Mac.",
        openDatasetFile: "Open dataset file",
    },
    "zh-CN": {
        newTask: "新任务",
        tasks: "任务",
        settings: "设置",
        datasets: "数据集",
        trace: "Trace",
        runtime: "运行时…",
        caseDrafts: "Case 草稿",
        taskCouldNotContinue: "任务无法继续",
        dismiss: "关闭",
        taskPlaceholder: "输入消息…",
        composerHint: "Enter 发送 · Shift+Enter 换行",
        appearance: "外观",
        language: "语言",
        theme: "主题",
        models: "模型",
        taskModel: "新任务默认模型",
        curatorModel: "Curator 默认模型",
        automaticCapture: "自动沉淀",
        automaticCaptureHelp: "每次回答完成后自动创建待审核草稿；只有点击 Done 才会保存 Case。",
        captureModel: "自动沉淀 Curator 模型",
        destinationDataset: "目标数据集",
        defaultClassification: "默认分类",
        settingsLocalOnly: "设置仅保存在这台 Mac。",
        cancel: "取消",
        save: "保存",
        discardDraft: "丢弃这个草稿？",
        discardDraftHelp: "Curator 任务会停止并归档，不会保存任何 Case。",
        discard: "丢弃",
        autoCaptureOff: "自动沉淀已关闭",
        autoCaptureOn: "自动沉淀已开启",
        runtimeDefault: "运行时默认模型",
        sourceOrRuntimeModel: "沿用来源 / 运行时模型",
        model: "模型",
        send: "发送",
        doneSaveCase: "完成并保存 Case",
        done: "完成",
        retry: "重试",
        selectDraft: "请选择一个 Case 草稿进行审核。",
        noDrafts: "还没有草稿，请在助手回答下方点击 Curate case。",
        curatorConversation: "Curator 对话",
        curatorWorking: "Curator 正在处理…",
        verbatimQuestion: "原始问题",
        queued: "排队中",
        running: "处理中",
        needsReview: "待审核",
        failed: "失败",
        archived: "已归档",
        settingsSaved: "设置已保存",
        draftDiscarded: "草稿已丢弃，未保存 Case",
        caseSaved: "Case 已保存，Curator 已归档",
        taskModelUpdated: "任务模型已更新",
        curatorModelUpdated: "Curator 模型已更新",
        workspace: "工作目录",
        runtimeTrace: "运行时 Trace",
        refresh: "刷新",
        openFolder: "打开文件夹",
        traceInitial: "本地运行时启动后会开始记录 Trace。",
        agentRuntimes: "Agent 运行时",
        runtimeDialogCopy: "Rolling Skill 只发现并连接本地兼容运行时，不会安装或升级它们。",
        rescan: "重新扫描",
        automaticRuntime: "自动选择",
        addExecutable: "添加可执行文件…",
        curateEpisode: "沉淀一个完整的问题解决片段",
        dataset: "数据集",
        createDataset: "创建新数据集",
        create: "创建",
        classification: "分类",
        expectedSkill: "符合预期的 Skill 行为",
        needsImprovement: "需要改进",
        episodeStartsAt: "片段起点",
        datasetQuestion: "数据集中的原始问题",
        endingResponse: "选中的结束回答",
        frozenCopyHelp: "冻结副本会交给 Curator，原任务仍可继续使用。",
        startCuration: "开始沉淀",
        welcomeHeading: "今天要评测什么？",
        welcomeCopy: "通过本地 Agent 运行时执行任务，再把完整的问题解决片段沉淀为可审核的 Goodcase 或 Badcase。",
        runtimeDiscovery: "自动发现运行时",
        episodeCuration: "完整片段沉淀",
        localTraceEvidence: "本地 Trace 证据",
        loadingTasks: "正在加载本地任务…",
        noTasks: "此工作目录还没有任务，请从下方开始。",
        loadingTask: "正在加载任务…",
        curateCase: "沉淀 Case",
        curatorPromptPlaceholder: "询问 Curator，或要求它解释、修改这个草稿",
        you: "你",
        localEvidence: "本地证据",
        curatorTasks: "CURATOR 任务",
        localProviders: "本地运行时提供方",
        caseDraft: "CASE 草稿",
        curateEvaluationData: "沉淀评测数据",
        chooseWorkspace: "选择工作目录",
        home: "主目录",
        runtimeReady: "本地运行时已就绪",
        runtimeStarting: "正在启动 {name}",
        detectingRuntimes: "正在发现本地运行时",
        runtimeStopped: "本地运行时已停止",
        runtimeError: "本地运行时错误",
        noRuntime: "没有可用的本地运行时",
        localRuntime: "本地运行时",
        detected: "自动发现",
        rescanRuntimes: "重新扫描兼容的本地运行时",
        noCompatibleRuntime: "未发现兼容的本地运行时，请重新扫描或选择可执行文件。",
        active: "已启用",
        use: "使用",
        now: "刚刚",
        minuteShort: "{count} 分钟",
        hourShort: "{count} 小时",
        dayShort: "{count} 天",
        image: "[图片]",
        audio: "[音频]",
        reasoning: "推理",
        working: "处理中",
        command: "命令",
        fileChanges: "文件变更",
        planUpdated: "计划已更新",
        completed: "已完成",
        structuredReference: "结构化参考结果",
        referenceAnswer: "参考答案",
        requiredFacts: "必备事实",
        requiredSteps: "必需步骤",
        requiredOutputFormat: "必需输出格式",
        hardRequirements: "硬判定要求",
        pass: "通过条件",
        basis: "判定依据",
        softCriteria: "软评分项",
        weight: "权重 {value}",
        automaticFailures: "自动判失败项",
        rootCauses: "错误根因",
        expectedRecovery: "预期修正方式",
        none: "无",
        untitledCase: "未命名 Case",
        frozenRange: "冻结范围：{count} 条对话及工具记录；原任务后续的新消息不包含在内。",
        noSourceQuestion: "这条回答之前没有找到来源问题",
        createdDataset: "已创建数据集“{name}”",
        episodeSent: "冻结片段已发送给 Curator",
        readingTrace: "正在读取本地 Trace…",
        noEventsYet: "暂无事件",
        noTraceEvents: "暂无 Trace 事件。",
        chat: "对话",
        skillEvaluation: "Skill 评测",
        evaluationWorkbench: "SKILL 评测工作台",
        evaluateSkills: "用真实自然语言评测 Skill",
        evaluationWorkbenchHelp: "保留原始问题，预检当前运行时，并在不强制唤起 Skill 的情况下启动测试。",
        cases: "Cases",
        verbatimQuestions: "问题保持原文",
        testRun: "测试运行",
        runtimePreflight: "运行时预检",
        skillUnderTest: "被测 Skill",
        activationMode: "唤起模式",
        automaticTrigger: "自动触发",
        automaticTriggerHelp: "只发送原始问题；这是正式评测路径。",
        explicitDiagnostic: "显式诊断",
        explicitDiagnosticHelp: "附加结构化 Skill mention，用于区分触发失败和执行失败。",
        startSelectedCase: "启动选中 Case",
        evaluationLaunchHelp: "目标任务会在所选运行时执行。当前尚未自动判分，请在原生任务及 Trace 中审核结果。",
        noDatasets: "还没有数据集。",
        noCases: "这个数据集还没有已保存的 Case。",
        noSkills: "当前运行时在此工作目录下没有报告已启用的 Skill。",
        selectCase: "请选择一个 Case 运行。",
        skillReady: "已安装并在 {runtime} 中启用",
        originalQuestionOnly: "仅发送原始问题",
        explicitSkillAttached: "已附加结构化 Skill mention",
        evaluationStarted: "测试任务已在对话页启动",
        localRuntimeAndData: "本地运行时与数据",
        localRuntimeAndDataHelp: "运行时发现、原始 Trace 和本地评测数据都保存在这台 Mac。",
        openDatasetFile: "打开数据集文件",
    },
}

const state = {
    runtime: {status: "starting"},
    workspaceRoot: "",
    threads: [],
    activeThreadId: null,
    activeThread: null,
    activeTurnId: null,
    datasets: [],
    loadingThreads: true,
    loadingThread: false,
    sending: false,
    newTaskMode: false,
    error: null,
    runtimeErrorDismissed: false,
    runtimeOperationInProgress: false,
    runtimeEpoch: 0,
    caseSelection: null,
    curationSessions: [],
    activeCurationId: null,
    curationOpen: false,
    curatorProfile: {runtimePolicy: "active", modelId: null},
    settings: {
        autoCapture: false,
        language: "zh-CN",
        theme: "codex-light",
        taskProfile: {runtimePolicy: "active", modelId: null},
        curatorProfile: {runtimePolicy: "active", modelId: null},
        autoCaptureProfile: {runtimePolicy: "active", modelId: null, datasetId: null, caseType: "goodcase"},
    },
    models: [],
    selectedTaskModelId: null,
    discardCurationId: null,
    traceOpen: false,
    surface: "chat",
    evaluationCases: [],
    evaluationSkills: [],
    evaluationDatasetId: null,
    evaluationCaseId: null,
    evaluationLoading: false,
    evaluationError: null,
    renderQueued: false,
}

const elements = {
    newTask: document.querySelector("#new-task"),
    surfaceSwitch: document.querySelector("#surface-switch"),
    workbench: document.querySelector(".workbench"),
    refreshThreads: document.querySelector("#refresh-threads"),
    threadList: document.querySelector("#thread-list"),
    workspaceButton: document.querySelector("#workspace-button"),
    settingsButton: document.querySelector("#settings-button"),
    workspaceName: document.querySelector("#workspace-name"),
    workspacePath: document.querySelector("#workspace-path"),
    activeTitle: document.querySelector("#active-title"),
    runtimeStatus: document.querySelector("#runtime-status"),
    runtimeLabel: document.querySelector("#runtime-label"),
    captureStatus: document.querySelector("#capture-status"),
    showLocalData: document.querySelector("#show-local-data"),
    chooseRuntime: document.querySelector("#choose-runtime"),
    openTrace: document.querySelector("#open-trace"),
    topbarCurations: document.querySelector("#topbar-curations"),
    topbarTrace: document.querySelector("#topbar-trace"),
    evaluationWorkbench: document.querySelector("#evaluation-workbench"),
    refreshEvaluation: document.querySelector("#refresh-evaluation"),
    evaluationDatasetCount: document.querySelector("#evaluation-dataset-count"),
    evaluationDatasetList: document.querySelector("#evaluation-dataset-list"),
    evaluationCreateDataset: document.querySelector("#evaluation-create-dataset"),
    evaluationNewDatasetName: document.querySelector("#evaluation-new-dataset-name"),
    evaluationCaseCount: document.querySelector("#evaluation-case-count"),
    evaluationCaseList: document.querySelector("#evaluation-case-list"),
    evaluationSkill: document.querySelector("#evaluation-skill"),
    evaluationSkillStatus: document.querySelector("#evaluation-skill-status"),
    evaluationModel: document.querySelector("#evaluation-model"),
    startEvaluation: document.querySelector("#start-evaluation"),
    errorBanner: document.querySelector("#error-banner"),
    errorMessage: document.querySelector("#error-message"),
    dismissError: document.querySelector("#dismiss-error"),
    conversationScroll: document.querySelector("#conversation-scroll"),
    conversation: document.querySelector("#conversation"),
    composer: document.querySelector("#composer"),
    composerInput: document.querySelector("#composer-input"),
    composerModel: document.querySelector("#composer-model"),
    sendTurn: document.querySelector("#send-turn"),
    stopTurn: document.querySelector("#stop-turn"),
    traceDrawer: document.querySelector("#trace-drawer"),
    closeTrace: document.querySelector("#close-trace"),
    refreshTrace: document.querySelector("#refresh-trace"),
    openTraceFolder: document.querySelector("#open-trace-folder"),
    traceMeta: document.querySelector("#trace-meta"),
    traceEvents: document.querySelector("#trace-events"),
    curationDrawer: document.querySelector("#curation-drawer"),
    closeCurations: document.querySelector("#close-curations"),
    curationList: document.querySelector("#curation-list"),
    curationDetail: document.querySelector("#curation-detail"),
    settingsDialog: document.querySelector("#settings-dialog"),
    settingsForm: document.querySelector("#settings-form"),
    closeSettingsDialog: document.querySelector("#close-settings-dialog"),
    cancelSettings: document.querySelector("#cancel-settings"),
    saveSettings: document.querySelector("#save-settings"),
    settingsLanguage: document.querySelector("#settings-language"),
    settingsTheme: document.querySelector("#settings-theme"),
    settingsTaskModel: document.querySelector("#settings-task-model"),
    settingsCuratorModel: document.querySelector("#settings-curator-model"),
    settingsAutoCapture: document.querySelector("#settings-auto-capture"),
    settingsAutoCaptureModel: document.querySelector("#settings-auto-capture-model"),
    settingsAutoCaptureDataset: document.querySelector("#settings-auto-capture-dataset"),
    settingsAutoCaptureCaseType: document.querySelector("#settings-auto-capture-case-type"),
    discardDialog: document.querySelector("#discard-curation-dialog"),
    closeDiscardDialog: document.querySelector("#close-discard-dialog"),
    cancelDiscard: document.querySelector("#cancel-discard"),
    confirmDiscard: document.querySelector("#confirm-discard"),
    runtimeDialog: document.querySelector("#runtime-dialog"),
    closeRuntimeDialog: document.querySelector("#close-runtime-dialog"),
    runtimeOptions: document.querySelector("#runtime-options"),
    detectRuntimes: document.querySelector("#detect-runtimes"),
    automaticRuntime: document.querySelector("#automatic-runtime"),
    chooseRuntimeFile: document.querySelector("#choose-runtime-file"),
    confirmRuntime: document.querySelector("#confirm-runtime"),
    caseDialog: document.querySelector("#save-case-dialog"),
    caseForm: document.querySelector("#save-case-form"),
    caseDataset: document.querySelector("#case-dataset"),
    newDatasetName: document.querySelector("#new-dataset-name"),
    createDataset: document.querySelector("#create-dataset"),
    caseStartItem: document.querySelector("#case-start-item"),
    caseQuestion: document.querySelector("#case-question"),
    caseScope: document.querySelector("#case-scope"),
    caseEndPreview: document.querySelector("#case-end-preview"),
    closeCaseDialog: document.querySelector("#close-case-dialog"),
    cancelSaveCase: document.querySelector("#cancel-save-case"),
    confirmSaveCase: document.querySelector("#confirm-save-case"),
    toast: document.querySelector("#toast"),
}

function node(tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
}

function t(key) {
    const language = state.settings?.language ?? "zh-CN"
    return translations[language]?.[key] ?? translations.en[key] ?? key
}

function formatMessage(key, values = {}) {
    return t(key).replace(/\{(\w+)\}/g, (match, name) =>
        values[name] === undefined ? match : String(values[name]),
    )
}

function applyLocalization() {
    document.documentElement.lang = state.settings.language
    for (const element of document.querySelectorAll("[data-i18n]")) {
        element.textContent = t(element.dataset.i18n)
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
        element.placeholder = t(element.dataset.i18nPlaceholder)
    }
}

function modelValue(model) {
    return String(model?.model ?? model?.id ?? "").trim()
}

function populateModelSelect(select, selectedModelId, defaultLabel = t("runtimeDefault")) {
    const selected = String(selectedModelId ?? "").trim()
    const catalog = state.models
        .map((model) => ({
            value: modelValue(model),
            label: model.displayName || modelValue(model),
            isDefault: Boolean(model.isDefault),
        }))
        .filter((model) => model.value)
    const signature = JSON.stringify({catalog, selected, defaultLabel})
    if (select.dataset.modelSignature === signature) return
    select.replaceChildren()
    const runtimeDefault = catalog.find((model) => model.isDefault)
    const defaultOption = node(
        "option",
        "",
        runtimeDefault ? `${defaultLabel} · ${runtimeDefault.label}` : defaultLabel,
    )
    defaultOption.value = ""
    select.append(defaultOption)
    for (const model of catalog) {
        const option = node("option", "", model.label)
        option.value = model.value
        select.append(option)
    }
    if (selected && !catalog.some((model) => model.value === selected)) {
        const custom = node("option", "", selected)
        custom.value = selected
        select.append(custom)
    }
    select.value = selected
    select.dataset.modelSignature = signature
}

function renderCaptureStatus() {
    const enabled = Boolean(state.settings.autoCapture)
    elements.captureStatus.textContent = t(enabled ? "autoCaptureOn" : "autoCaptureOff")
    elements.captureStatus.closest(".capture-note")?.classList.toggle("active", enabled)
}

function applySettings(settings) {
    state.settings = settings
    state.curatorProfile = settings.curatorProfile
    document.documentElement.dataset.theme = settings.theme
    applyLocalization()
    renderCaptureStatus()
}

function renderTaskModelPicker() {
    populateModelSelect(elements.composerModel, state.selectedTaskModelId)
}

function renderSettingsForm() {
    const settings = state.settings
    elements.settingsLanguage.value = settings.language
    elements.settingsTheme.value = settings.theme
    populateModelSelect(elements.settingsTaskModel, settings.taskProfile?.modelId)
    populateModelSelect(
        elements.settingsCuratorModel,
        settings.curatorProfile?.modelId,
        t("sourceOrRuntimeModel"),
    )
    populateModelSelect(
        elements.settingsAutoCaptureModel,
        settings.autoCaptureProfile?.modelId,
        t("sourceOrRuntimeModel"),
    )
    elements.settingsAutoCapture.checked = Boolean(settings.autoCapture)
    elements.settingsAutoCaptureDataset.replaceChildren()
    for (const dataset of state.datasets) {
        const option = node("option", "", dataset.name)
        option.value = dataset.id
        elements.settingsAutoCaptureDataset.append(option)
    }
    elements.settingsAutoCaptureDataset.value =
        settings.autoCaptureProfile?.datasetId ?? state.datasets[0]?.id ?? ""
    elements.settingsAutoCaptureCaseType.value =
        settings.autoCaptureProfile?.caseType ?? "goodcase"
}

function openSettings() {
    renderSettingsForm()
    elements.settingsDialog.showModal()
}

async function saveSettings() {
    elements.saveSettings.disabled = true
    try {
        const settings = await window.rollingSkill.updateSettings({
            language: elements.settingsLanguage.value,
            theme: elements.settingsTheme.value,
            taskModelId: elements.settingsTaskModel.value,
            curatorModelId: elements.settingsCuratorModel.value,
            autoCapture: elements.settingsAutoCapture.checked,
            autoCaptureModelId: elements.settingsAutoCaptureModel.value,
            autoCaptureDatasetId: elements.settingsAutoCaptureDataset.value || null,
            autoCaptureCaseType: elements.settingsAutoCaptureCaseType.value,
        })
        applySettings(settings)
        if (state.newTaskMode || !state.activeThread) {
            state.selectedTaskModelId = settings.taskProfile?.modelId ?? null
        }
        renderAll()
        renderCurations()
        elements.settingsDialog.close()
        showToast(t("settingsSaved"))
    } catch (error) {
        showError(error)
    } finally {
        elements.saveSettings.disabled = false
    }
}

async function refreshModels() {
    try {
        const response = await window.rollingSkill.listModels()
        state.models = response.data ?? []
    } catch {
        state.models = []
    }
    renderTaskModelPicker()
    renderEvaluationWorkbench()
    if (elements.settingsDialog.open) renderSettingsForm()
    if (state.curationOpen) renderCurations()
}

function baseName(path) {
    const value = String(path ?? "").replace(/\/+$/, "")
    return value.split("/").filter(Boolean).at(-1) || value || t("home")
}

function titleForThread(thread) {
    return String(thread?.name || thread?.preview || t("newTask")).trim() || t("newTask")
}

function statusType(status) {
    return typeof status === "string" ? status : status?.type
}

function relativeTime(timestamp) {
    if (!timestamp) return ""
    const seconds = Math.max(0, Date.now() / 1000 - timestamp)
    if (seconds < 60) return t("now")
    if (seconds < 3600) return formatMessage("minuteShort", {count: Math.floor(seconds / 60)})
    if (seconds < 86400) return formatMessage("hourShort", {count: Math.floor(seconds / 3600)})
    if (seconds < 604800) return formatMessage("dayShort", {count: Math.floor(seconds / 86400)})
    return new Date(timestamp * 1000).toLocaleDateString(state.settings.language, {
        month: "short",
        day: "numeric",
    })
}

function textFromUserInput(content) {
    return (content ?? [])
        .map((part) => {
            if (part.type === "text") return part.text
            if (part.type === "skill") return `$${part.name}`
            if (part.type === "mention") return `@${part.name}`
            if (part.type === "image" || part.type === "localImage") return t("image")
            if (part.type === "audio" || part.type === "localAudio") return t("audio")
            return ""
        })
        .filter(Boolean)
        .join("\n")
}

function getTurns() {
    return state.activeThread?.turns ?? []
}

function findTurn(turnId) {
    return getTurns().find((turn) => turn.id === turnId)
}

function ensureTurn(turnId) {
    if (!state.activeThread) return null
    if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = []
    let turn = findTurn(turnId)
    if (!turn) {
        turn = {id: turnId, items: [], status: "inProgress", error: null}
        state.activeThread.turns.push(turn)
    }
    return turn
}

function upsertTurn(nextTurn) {
    if (!state.activeThread || !nextTurn?.id) return
    if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = []
    const index = state.activeThread.turns.findIndex((turn) => turn.id === nextTurn.id)
    if (index >= 0) {
        const current = state.activeThread.turns[index]
        const mergedItems = [...(current.items ?? [])]
        for (const nextItem of nextTurn.items ?? []) {
            const itemIndex = mergedItems.findIndex((item) => item.id === nextItem.id)
            if (itemIndex >= 0) mergedItems[itemIndex] = {...mergedItems[itemIndex], ...nextItem}
            else mergedItems.push(nextItem)
        }
        state.activeThread.turns[index] = {
            ...current,
            ...nextTurn,
            items: mergedItems,
        }
    } else {
        state.activeThread.turns.push({...nextTurn, items: nextTurn.items ?? []})
    }
}

function upsertItem(turnId, nextItem) {
    if (!nextItem?.id) return
    const turn = ensureTurn(turnId)
    if (!turn) return
    const index = turn.items.findIndex((item) => item.id === nextItem.id)
    if (index >= 0) turn.items[index] = {...turn.items[index], ...nextItem}
    else turn.items.push(nextItem)
}

function upsertThreadSummary(thread) {
    if (!thread?.id) return
    const index = state.threads.findIndex((entry) => entry.id === thread.id)
    if (index >= 0) state.threads[index] = {...state.threads[index], ...thread}
    else state.threads.unshift(thread)
    state.threads.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
}

function renderWorkspace() {
    elements.workspaceName.textContent = baseName(state.workspaceRoot)
    elements.workspacePath.textContent = state.workspaceRoot
    elements.workspaceButton.title = state.workspaceRoot || t("chooseWorkspace")
}

function renderRuntime() {
    const status = state.runtime?.status || "starting"
    const runtime = state.runtime?.runtime
    elements.runtimeStatus.className = `runtime-status ${status}`
    const labels = {
        ready: runtime ? `${runtime.displayName} ${runtime.version}` : t("runtimeReady"),
        starting: runtime
            ? formatMessage("runtimeStarting", {name: runtime.displayName})
            : t("detectingRuntimes"),
        stopped: t("runtimeStopped"),
        error: t("runtimeError"),
        unavailable: t("noRuntime"),
    }
    elements.runtimeLabel.textContent = labels[status] || status
    elements.runtimeStatus.title =
        status === "ready"
            ? `${runtime?.executablePath || t("localRuntime")} · ${runtime?.source || t("detected")}`
            : t("rescanRuntimes")

    const runtimeError = state.runtimeErrorDismissed ? null : state.runtime?.error
    const message = state.error || runtimeError
    elements.errorBanner.classList.toggle("hidden", !message)
    elements.errorMessage.textContent = message || ""
}

function renderRuntimeOptions() {
    elements.runtimeOptions.replaceChildren()
    elements.detectRuntimes.disabled = state.runtimeOperationInProgress
    elements.automaticRuntime.disabled = state.runtimeOperationInProgress
    elements.chooseRuntimeFile.disabled = state.runtimeOperationInProgress
    elements.confirmRuntime.disabled = state.runtimeOperationInProgress
    const runtimes = state.runtime?.availableRuntimes ?? []
    if (runtimes.length === 0) {
        elements.runtimeOptions.append(
            node(
                "div",
                "sidebar-placeholder",
                t("noCompatibleRuntime"),
            ),
        )
        return
    }
    for (const runtime of runtimes) {
        const button = node("button", "runtime-option")
        button.type = "button"
        button.disabled = state.runtimeOperationInProgress
        button.dataset.runtimeId = runtime.runtimeId
        const selected = runtime.runtimeId === state.runtime?.runtime?.runtimeId
        if (selected) button.classList.add("selected")
        const copy = node("span")
        const title = node("span", "runtime-option-title")
        title.append(
            node("span", "", `${runtime.displayName} ${runtime.version}`),
            node("small", "", runtime.source),
        )
        copy.append(title, node("span", "runtime-option-path", runtime.executablePath))
        button.append(copy, node("span", "runtime-option-state", t(selected ? "active" : "use")))
        elements.runtimeOptions.append(button)
    }
}

function openRuntimeDialog() {
    renderRuntimeOptions()
    elements.runtimeDialog.showModal()
}

function renderThreads() {
    elements.threadList.replaceChildren()
    if (state.loadingThreads) {
        elements.threadList.append(node("div", "sidebar-placeholder", t("loadingTasks")))
        return
    }
    if (state.threads.length === 0) {
        elements.threadList.append(node("div", "sidebar-placeholder", t("noTasks")))
        return
    }

    for (const thread of state.threads) {
        const button = node("button", "thread-button")
        button.type = "button"
        button.dataset.threadId = thread.id
        if (thread.id === state.activeThreadId && !state.newTaskMode) button.classList.add("active")

        button.append(
            node("span", "thread-title", titleForThread(thread)),
            node("span", "thread-time", relativeTime(thread.recencyAt ?? thread.updatedAt)),
            node("span", "thread-preview", thread.preview || baseName(thread.cwd)),
        )
        if (statusType(thread.status) === "active") button.append(node("span", "thread-status"))
        elements.threadList.append(button)
    }
}

function renderWelcome() {
    const welcome = node("div", "welcome")
    const inner = node("div", "welcome-inner")
    const mark = node("div", "welcome-mark")
    const image = node("img")
    image.src = "logo.svg"
    image.alt = ""
    mark.append(image)
    const heading = node("h1", "", t("welcomeHeading"))
    const copy = node("p", "", t("welcomeCopy"))
    const chips = node("div", "welcome-chips")
    for (const key of ["runtimeDiscovery", "episodeCuration", "localTraceEvidence"]) {
        chips.append(node("span", "welcome-chip", t(key)))
    }
    inner.append(mark, heading, copy, chips)
    welcome.append(inner)
    elements.conversation.append(welcome)
}

function activityStatus(status, fallbackKey) {
    const keys = {
        completed: "completed",
        failed: "failed",
        running: "running",
        inProgress: "running",
        working: "working",
    }
    return keys[status] ? t(keys[status]) : String(status || t(fallbackKey))
}

function activityText(item) {
    if (item.type === "reasoning") {
        return `${t("reasoning")} · ${(item.summary ?? []).join(" ") || t("working")}`
    }
    if (item.type === "commandExecution") {
        return `${activityStatus(item.status, "running")} · ${item.command || t("command")}`
    }
    if (item.type === "fileChange") {
        return `${activityStatus(item.status, "working")} · ${t("fileChanges")}`
    }
    if (item.type === "mcpToolCall") {
        return `${activityStatus(item.status, "running")} · ${item.server}/${item.tool}`
    }
    if (item.type === "dynamicToolCall") {
        return `${activityStatus(item.status, "running")} · ${item.tool}`
    }
    if (item.type === "collabAgentToolCall") {
        return `${activityStatus(item.status, "running")} · ${item.tool}`
    }
    if (item.type === "plan") return item.text || t("planUpdated")
    return null
}

function renderItem(item, turn) {
    if (item.type === "userMessage") {
        const wrapper = node("article", "message user")
        wrapper.append(node("div", "message-body", textFromUserInput(item.content)))
        return wrapper
    }
    if (item.type === "agentMessage") {
        const wrapper = node("article", "message assistant")
        const avatar = node("span", "assistant-avatar")
        const image = node("img")
        image.src = "logo.svg"
        image.alt = ""
        avatar.append(image)
        const body = node("div", "message-body", item.text || "")
        wrapper.append(avatar, body)
        if (turn.status !== "inProgress") {
            const actions = node("div", "message-actions")
            const save = node("button", "save-case-button", t("curateCase"))
            save.type = "button"
            save.dataset.saveCase = "true"
            save.dataset.turnId = turn.id
            save.dataset.itemId = item.id
            actions.append(save)
            wrapper.append(actions)
        }
        return wrapper
    }
    const text = activityText(item)
    return text ? node("div", "activity-card", text) : null
}

function renderConversation(options = {}) {
    const wasNearBottom =
        elements.conversationScroll.scrollHeight -
            elements.conversationScroll.scrollTop -
            elements.conversationScroll.clientHeight <
        90
    elements.conversation.replaceChildren()
    if (state.loadingThread) {
        elements.conversation.append(node("div", "loading-conversation", t("loadingTask")))
        return
    }
    if (!state.activeThread || getTurns().length === 0) {
        renderWelcome()
        return
    }

    for (const turn of getTurns()) {
        const block = node("section", "turn-block")
        for (const item of turn.items ?? []) {
            const rendered = renderItem(item, turn)
            if (rendered) block.append(rendered)
        }
        if (turn.error?.message) block.append(node("div", "turn-error", turn.error.message))
        elements.conversation.append(block)
    }

    if (options.forceBottom || wasNearBottom) {
        requestAnimationFrame(() => {
            elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight
        })
    }
}

function renderComposer() {
    const running = Boolean(state.activeTurnId) || state.sending
    elements.stopTurn.classList.toggle("hidden", !running)
    elements.sendTurn.classList.toggle("hidden", running)
    elements.sendTurn.disabled = state.runtime?.status !== "ready" || !elements.composerInput.value.trim()
    elements.composerInput.disabled = state.sending
    elements.composerModel.disabled = running || state.runtime?.status !== "ready"
    renderTaskModelPicker()
}

function renderTitle() {
    elements.activeTitle.textContent = state.newTaskMode
        ? t("newTask")
        : titleForThread(state.activeThread || state.threads.find((item) => item.id === state.activeThreadId))
}

function curationStatusLabel(status) {
    const keys = {
        queued: "queued",
        running: "running",
        needs_review: "needsReview",
        failed: "failed",
        archived: "archived",
        cancelled: "discard",
    }
    return t(keys[status] ?? status)
}

function activeCuration() {
    return state.curationSessions.find((session) => session.id === state.activeCurationId) ?? null
}

function appendStringList(container, values, empty = t("none")) {
    if (!values?.length) {
        container.append(node("div", "curation-empty", empty))
        return
    }
    const list = node("ul", "curation-value-list")
    for (const value of values) list.append(node("li", "", value))
    container.append(list)
}

function draftSection(title, values) {
    const section = node("section", "draft-section")
    section.append(node("h4", "", title))
    appendStringList(section, values)
    return section
}

function renderDraft(draft) {
    const wrapper = node("div", "curation-draft")
    wrapper.append(node("h3", "", t("structuredReference")))
    const summary = node("section", "draft-section")
    summary.append(
        node("h4", "", t("referenceAnswer")),
        node("div", "draft-summary", draft.referenceAnswer.summary),
    )
    wrapper.append(
        summary,
        draftSection(t("requiredFacts"), draft.referenceAnswer.requiredFacts),
        draftSection(t("requiredSteps"), draft.referenceAnswer.requiredSteps),
        draftSection(t("requiredOutputFormat"), draft.referenceAnswer.requiredOutputFormat),
    )

    const hard = node("section", "draft-section hard-requirements")
    hard.append(node("h4", "", t("hardRequirements")))
    for (const requirement of draft.grading.hardRequirements) {
        const card = node("article", "requirement-card")
        card.append(
            node("strong", "", `${requirement.id} · ${requirement.criterion}`),
            node("span", "", `${t("pass")}: ${requirement.passCondition}`),
            node("small", "", `${t("basis")}: ${requirement.evidenceBasis}`),
        )
        hard.append(card)
    }
    wrapper.append(
        hard,
        draftSection(
            t("softCriteria"),
            draft.grading.softCriteria.map(
                (criterion) =>
                    `${criterion.id} · ${criterion.criterion} (${formatMessage("weight", {value: criterion.weight})})`,
            ),
        ),
        draftSection(t("automaticFailures"), draft.grading.automaticFailures),
    )
    if (draft.badCaseAnalysis) {
        wrapper.append(
            draftSection(t("rootCauses"), draft.badCaseAnalysis.rootCauses),
            draftSection(t("expectedRecovery"), [draft.badCaseAnalysis.expectedRecovery]),
        )
    }
    return wrapper
}

function renderCurations() {
    elements.curationDrawer.classList.toggle("visible", state.curationOpen)
    elements.curationList.replaceChildren()
    elements.topbarCurations.textContent = state.curationSessions.length
        ? `${t("caseDrafts")} (${state.curationSessions.length})`
        : t("caseDrafts")
    if (!state.curationSessions.length) {
        elements.curationList.append(
            node("div", "sidebar-placeholder", t("noDrafts")),
        )
    } else {
        for (const session of state.curationSessions) {
            const button = node("button", "curation-list-item")
            button.type = "button"
            button.dataset.curationId = session.id
            if (session.id === state.activeCurationId) button.classList.add("active")
            const title = String(session.episode?.originalQuestion ?? t("untitledCase")).trim()
            button.append(
                node("span", "curation-list-title", title || t("untitledCase")),
                node(
                    "span",
                    `curation-status ${session.status}`,
                    curationStatusLabel(session.status),
                ),
            )
            elements.curationList.append(button)
        }
    }

    elements.curationDetail.replaceChildren()
    const scroll = node("div", "curation-detail-scroll")
    elements.curationDetail.append(scroll)
    const session = activeCuration()
    if (!session) {
        scroll.append(node("div", "sidebar-placeholder", t("selectDraft")))
        return
    }

    const overview = node("div", "curation-overview")
    overview.append(
        node("span", `case-kind ${session.caseType}`, session.caseType),
        node("span", `curation-status ${session.status}`, curationStatusLabel(session.status)),
    )
    const question = node("section", "frozen-question")
    question.append(
        node("span", "curation-label", t("verbatimQuestion")),
        node("div", "", session.episode.originalQuestion),
    )
    const provenance = node(
        "div",
        "curation-provenance",
        `${session.episode.items.length} episode items · ${session.episode.toolActivity.length} tool signatures · ${session.curator.modelId || t("runtimeDefault")}`,
    )
    scroll.append(overview, question, provenance)

    const conversation = node("section", "curator-conversation")
    conversation.append(node("h3", "", t("curatorConversation")))
    for (const message of session.conversation) {
        const bubble = node("article", `curator-message ${message.role}`)
        bubble.append(node("span", "curator-role", message.role === "assistant" ? "Curator" : t("you")))
        bubble.append(node("div", "", message.text))
        conversation.append(bubble)
    }
    if (session.status === "queued" || session.status === "running") {
        conversation.append(node("div", "curator-working", t("curatorWorking")))
    }
    if (session.error) {
        const error = node("div", "curation-error")
        error.append(node("span", "", session.error))
        if (session.status === "failed") {
            const retry = node("button", "", t("retry"))
            retry.type = "button"
            retry.dataset.retryCuration = session.id
            error.append(retry)
        }
        conversation.append(error)
    }
    scroll.append(conversation)
    if (session.draft) scroll.append(renderDraft(session.draft))

    if (session.status !== "archived" && session.status !== "cancelled") {
        const composerWrap = node("div", "curation-composer-wrap")
        const form = node("form", "curation-followup")
        form.dataset.curationForm = session.id
        const input = node("textarea")
        input.rows = 3
        input.maxLength = 120000
        input.placeholder = t("curatorPromptPlaceholder")
        input.disabled = session.status === "queued" || session.status === "running"
        input.dataset.curationInput = session.id
        const footer = node("div", "curation-followup-footer")
        const modelPicker = node("select", "model-picker curation-model-picker")
        modelPicker.setAttribute("data-curation-model", session.id)
        modelPicker.setAttribute("aria-label", t("model"))
        modelPicker.disabled = input.disabled
        populateModelSelect(modelPicker, session.curator.modelId, t("sourceOrRuntimeModel"))
        const send = node("button", "", t("send"))
        send.type = "submit"
        send.disabled = input.disabled
        footer.append(modelPicker, send)
        form.append(input, footer)
        composerWrap.append(form)
        const actions = node("div", "curation-actions")
        const discard = node("button", "curation-discard", t("discard"))
        discard.type = "button"
        discard.setAttribute("data-discard-curation", session.id)
        actions.append(discard)
        if (session.status === "needs_review" && session.draft) {
            const done = node("button", "curation-done primary", t("doneSaveCase"))
            done.type = "button"
            done.dataset.archiveCuration = session.id
            actions.append(done)
        }
        composerWrap.append(actions)
        elements.curationDetail.append(composerWrap)
    }
}

function renderAll(options) {
    renderWorkspace()
    renderRuntime()
    renderThreads()
    renderTitle()
    renderConversation(options)
    renderComposer()
    renderRuntimeOptions()
    renderEvaluationWorkbench()
}

function queueRender(options = {}) {
    if (state.renderQueued) return
    state.renderQueued = true
    requestAnimationFrame(() => {
        state.renderQueued = false
        renderAll(options)
    })
}

function showError(error) {
    state.error = error?.message || String(error)
    renderRuntime()
}

let toastTimer = null
function showToast(message) {
    clearTimeout(toastTimer)
    elements.toast.textContent = message
    elements.toast.classList.remove("hidden")
    toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), 2600)
}

function selectedEvaluationSkill() {
    return state.evaluationSkills.find((skill) => skill.path === elements.evaluationSkill.value) ?? null
}

function renderEvaluationWorkbench() {
    const evaluation = state.surface === "evaluation"
    elements.workbench.classList.toggle("evaluation-mode", evaluation)
    elements.evaluationWorkbench.classList.toggle("hidden", !evaluation)
    for (const button of elements.surfaceSwitch.querySelectorAll("[data-surface]")) {
        button.classList.toggle("active", button.dataset.surface === state.surface)
    }
    if (!evaluation) return

    elements.evaluationDatasetCount.textContent = String(state.datasets.length)
    elements.evaluationDatasetList.replaceChildren()
    if (!state.datasets.length) {
        elements.evaluationDatasetList.append(node("div", "sidebar-placeholder", t("noDatasets")))
    }
    for (const dataset of state.datasets) {
        const button = node("button", "evaluation-dataset")
        button.type = "button"
        button.dataset.evaluationDatasetId = dataset.id
        if (dataset.id === state.evaluationDatasetId) button.classList.add("active")
        const copy = node("span")
        copy.append(
            node("strong", "", dataset.name),
            node("small", "", `${dataset.goodcaseCount ?? 0} good · ${dataset.badcaseCount ?? 0} bad`),
        )
        button.append(copy, node("span", "dataset-count", String(dataset.caseCount ?? 0)))
        elements.evaluationDatasetList.append(button)
    }

    elements.evaluationCaseCount.textContent = String(state.evaluationCases.length)
    elements.evaluationCaseList.replaceChildren()
    if (state.evaluationLoading) {
        elements.evaluationCaseList.append(node("div", "sidebar-placeholder", t("loadingTask")))
    } else if (state.evaluationError) {
        elements.evaluationCaseList.append(node("div", "evaluation-empty error", state.evaluationError))
    } else if (!state.evaluationCases.length) {
        elements.evaluationCaseList.append(node("div", "evaluation-empty", t("noCases")))
    }
    for (const caseEntry of state.evaluationCases) {
        const button = node("button", "evaluation-case")
        button.type = "button"
        button.dataset.evaluationCaseId = caseEntry.id
        if (caseEntry.id === state.evaluationCaseId) button.classList.add("active")
        button.append(
            node("span", `case-badge ${caseEntry.caseType}`, caseEntry.caseType),
            node("strong", "", caseEntry.question),
            node("small", "", caseEntry.curated?.referenceAnswer?.summary || caseEntry.answer || ""),
        )
        elements.evaluationCaseList.append(button)
    }

    const selectedPath = elements.evaluationSkill.value
    elements.evaluationSkill.replaceChildren()
    for (const skill of state.evaluationSkills) {
        const option = node("option", "", skill.interface?.displayName || skill.name)
        option.value = skill.path
        elements.evaluationSkill.append(option)
    }
    if (selectedPath && state.evaluationSkills.some((skill) => skill.path === selectedPath)) {
        elements.evaluationSkill.value = selectedPath
    }
    const skill = selectedEvaluationSkill()
    elements.evaluationSkillStatus.className = `skill-preflight ${skill ? "ready" : "missing"}`
    elements.evaluationSkillStatus.textContent = skill
        ? `${formatMessage("skillReady", {runtime: state.runtime?.runtime?.displayName ?? t("localRuntime")})} · ${skill.scope}`
        : t("noSkills")
    populateModelSelect(
        elements.evaluationModel,
        elements.evaluationModel.value || state.settings.taskProfile?.modelId,
    )
    elements.startEvaluation.disabled =
        state.evaluationLoading ||
        state.runtime?.status !== "ready" ||
        !state.evaluationCaseId ||
        !skill
}

function flattenRuntimeSkills(response) {
    const byPath = new Map()
    for (const entry of response?.data ?? []) {
        for (const skill of entry.skills ?? []) {
            if (!skill?.path || !skill.enabled) continue
            byPath.set(skill.path, skill)
        }
    }
    return [...byPath.values()].sort((left, right) =>
        String(left.interface?.displayName || left.name).localeCompare(
            String(right.interface?.displayName || right.name),
            state.settings.language,
        ),
    )
}

async function loadEvaluationWorkbench(forceReload = false) {
    state.evaluationLoading = true
    state.evaluationError = null
    renderEvaluationWorkbench()
    try {
        state.datasets = await window.rollingSkill.listDatasets()
        if (!state.datasets.some((dataset) => dataset.id === state.evaluationDatasetId)) {
            state.evaluationDatasetId = state.datasets[0]?.id ?? null
        }
        state.evaluationCases = state.evaluationDatasetId
            ? await window.rollingSkill.listCases(state.evaluationDatasetId)
            : []
        if (!state.evaluationCases.some((entry) => entry.id === state.evaluationCaseId)) {
            state.evaluationCaseId = state.evaluationCases[0]?.id ?? null
        }
        state.evaluationSkills = state.runtime?.status === "ready"
            ? flattenRuntimeSkills(await window.rollingSkill.listSkills(forceReload))
            : []
    } catch (error) {
        state.evaluationError = error?.message || String(error)
    } finally {
        state.evaluationLoading = false
        renderEvaluationWorkbench()
    }
}

async function selectEvaluationDataset(datasetId) {
    if (!datasetId || datasetId === state.evaluationDatasetId) return
    state.evaluationDatasetId = datasetId
    state.evaluationCaseId = null
    await loadEvaluationWorkbench(false)
}

async function createEvaluationDataset() {
    const name = elements.evaluationNewDatasetName.value.trim()
    if (!name) return
    try {
        const dataset = await window.rollingSkill.createDataset(name)
        elements.evaluationNewDatasetName.value = ""
        state.evaluationDatasetId = dataset.id
        await loadEvaluationWorkbench(false)
        showToast(formatMessage("createdDataset", {name: dataset.name}))
    } catch (error) {
        showError(error)
    }
}

async function startSelectedEvaluation() {
    const caseEntry = state.evaluationCases.find((entry) => entry.id === state.evaluationCaseId)
    if (!caseEntry) return
    const selectedPath = elements.evaluationSkill.value
    elements.startEvaluation.disabled = true
    try {
        state.evaluationSkills = flattenRuntimeSkills(await window.rollingSkill.listSkills(true))
        elements.evaluationSkill.value = selectedPath
        const skill = selectedEvaluationSkill()
        if (!skill) throw new Error(t("noSkills"))
        const modelId = elements.evaluationModel.value || null
        const activationMode = elements.evaluationWorkbench.querySelector(
            'input[name="activation-mode"]:checked',
        )?.value ?? "automatic"
        const threadResponse = await window.rollingSkill.startThread(modelId)
        state.activeThread = threadResponse.thread
        state.activeThreadId = threadResponse.thread.id
        state.activeTurnId = null
        state.newTaskMode = false
        state.selectedTaskModelId = modelId
        upsertThreadSummary(threadResponse.thread)
        const input = activationMode === "explicit"
            ? [
                  {type: "skill", name: skill.name, path: skill.path},
                  {type: "text", text: caseEntry.question, text_elements: []},
              ]
            : caseEntry.question
        const turnResponse = await window.rollingSkill.startTurn(
            state.activeThreadId,
            input,
            modelId,
        )
        state.activeTurnId = turnResponse.turn.id
        upsertTurn(turnResponse.turn)
        state.surface = "chat"
        renderAll({forceBottom: true})
        showToast(t("evaluationStarted"))
    } catch (error) {
        showError(error)
        renderEvaluationWorkbench()
    }
}

function setSurface(surface) {
    if (surface !== "chat" && surface !== "evaluation") return
    state.surface = surface
    if (surface === "evaluation") {
        setTraceOpen(false)
        setCurationOpen(false)
        void loadEvaluationWorkbench(true)
    }
    renderAll()
}

async function refreshThreads(selectFirst = false) {
    const runtimeEpoch = state.runtimeEpoch
    state.loadingThreads = true
    renderThreads()
    try {
        const response = await window.rollingSkill.listThreads()
        if (runtimeEpoch !== state.runtimeEpoch) return false
        state.threads = response.data ?? []
        state.loadingThreads = false
        renderThreads()
        if (
            selectFirst &&
            !state.newTaskMode &&
            !state.activeThreadId &&
            state.threads.length > 0
        ) {
            await loadThread(state.threads[0].id)
        }
        return true
    } catch (error) {
        if (runtimeEpoch !== state.runtimeEpoch) return false
        state.loadingThreads = false
        showError(error)
        renderThreads()
        return false
    }
}

async function loadThread(threadId) {
    if (!threadId) return
    state.surface = "chat"
    const runtimeEpoch = state.runtimeEpoch
    state.activeThreadId = threadId
    state.newTaskMode = false
    state.loadingThread = true
    state.error = null
    state.activeTurnId = null
    renderAll()
    try {
        const response = await window.rollingSkill.readThread(threadId)
        if (runtimeEpoch !== state.runtimeEpoch || state.activeThreadId !== threadId) return
        state.activeThread = response.thread
        state.selectedTaskModelId =
            response.thread.model ?? state.settings.taskProfile?.modelId ?? null
        state.activeTurnId =
            response.thread.turns?.find((turn) => turn.status === "inProgress")?.id ?? null
        state.loadingThread = false
        upsertThreadSummary(response.thread)
        renderAll({forceBottom: true})
    } catch (error) {
        if (runtimeEpoch !== state.runtimeEpoch || state.activeThreadId !== threadId) return
        state.loadingThread = false
        showError(error)
        renderConversation()
    }
}

function beginNewTask() {
    state.surface = "chat"
    state.activeThreadId = null
    state.activeThread = null
    state.activeTurnId = null
    state.loadingThread = false
    state.newTaskMode = true
    state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
    state.error = null
    renderAll()
    elements.composerInput.focus()
}

function resizeComposer() {
    elements.composerInput.style.height = "auto"
    elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 220)}px`
    renderComposer()
}

async function submitTurn() {
    const text = elements.composerInput.value.trim()
    if (!text || state.sending || state.activeTurnId) return
    state.sending = true
    state.error = null
    renderAll()
    try {
        if (!state.activeThread) {
            const response = await window.rollingSkill.startThread(state.selectedTaskModelId)
            state.activeThread = response.thread
            state.activeThreadId = response.thread.id
            state.newTaskMode = false
            upsertThreadSummary(response.thread)
        }
        const response = await window.rollingSkill.startTurn(
            state.activeThreadId,
            text,
            state.selectedTaskModelId,
        )
        state.activeTurnId = response.turn.id
        upsertTurn(response.turn)
        elements.composerInput.value = ""
        resizeComposer()
        state.sending = false
        renderAll({forceBottom: true})
    } catch (error) {
        state.sending = false
        showError(error)
        renderComposer()
    }
}

async function stopTurn() {
    if (!state.activeThreadId || !state.activeTurnId) return
    const turnId = state.activeTurnId
    try {
        await window.rollingSkill.interruptTurn(state.activeThreadId, turnId)
    } catch (error) {
        showError(error)
    }
}

function updateDatasetOptions(selectedId) {
    elements.caseDataset.replaceChildren()
    for (const dataset of state.datasets) {
        const option = node("option", "", `${dataset.name} (${dataset.caseCount ?? 0})`)
        option.value = dataset.id
        if (dataset.id === selectedId) option.selected = true
        elements.caseDataset.append(option)
    }
}

function flattenedActiveItems() {
    const items = []
    for (const turn of getTurns()) {
        for (const item of turn.items ?? []) items.push({turnId: turn.id, item})
    }
    return items
}

function updateEpisodeStartPreview() {
    const selection = state.caseSelection
    if (!selection) return
    const selected = selection.startCandidates.find(
        (candidate) => candidate.item.id === elements.caseStartItem.value,
    )
    if (!selected) return
    selection.startItemId = selected.item.id
    elements.caseQuestion.value = textFromUserInput(selected.item.content)
    const flattened = flattenedActiveItems()
    const startIndex = flattened.findIndex(({item}) => item.id === selected.item.id)
    const endIndex = flattened.findIndex(({item}) => item.id === selection.itemId)
    elements.caseScope.textContent = formatMessage("frozenRange", {
        count: Math.max(0, endIndex - startIndex + 1),
    })
}

function openCaseDialog(turnId, itemId) {
    const turn = findTurn(turnId)
    const item = turn?.items?.find((entry) => entry.id === itemId)
    if (!turn || !item || item.type !== "agentMessage") return
    const flattened = flattenedActiveItems()
    const endIndex = flattened.findIndex(({item: entry}) => entry.id === itemId)
    const startCandidates = flattened
        .slice(0, endIndex + 1)
        .filter(({item: entry}) => entry.type === "userMessage")
    if (!startCandidates.length) {
        showError(new Error(t("noSourceQuestion")))
        return
    }
    state.caseSelection = {turnId, itemId, startCandidates, startItemId: startCandidates.at(-1).item.id}
    elements.caseStartItem.replaceChildren()
    for (const candidate of [...startCandidates].reverse()) {
        const question = textFromUserInput(candidate.item.content)
        const option = node("option", "", question.replace(/\s+/g, " ").slice(0, 110))
        option.value = candidate.item.id
        elements.caseStartItem.append(option)
    }
    elements.caseStartItem.value = state.caseSelection.startItemId
    elements.caseEndPreview.value = item.text || ""
    updateEpisodeStartPreview()
    updateDatasetOptions(state.datasets[0]?.id)
    elements.caseDialog.showModal()
}

async function createDataset() {
    const name = elements.newDatasetName.value.trim()
    if (!name) return
    elements.createDataset.disabled = true
    try {
        const created = await window.rollingSkill.createDataset(name)
        state.datasets = await window.rollingSkill.listDatasets()
        updateDatasetOptions(created.id)
        elements.newDatasetName.value = ""
        showToast(formatMessage("createdDataset", {name: created.name}))
    } catch (error) {
        showError(error)
    } finally {
        elements.createDataset.disabled = false
    }
}

async function createCuration() {
    const selection = state.caseSelection
    if (!selection) return
    const caseType = new FormData(elements.caseForm).get("case-type")
    elements.confirmSaveCase.disabled = true
    elements.caseDialog.close()
    try {
        const session = await window.rollingSkill.createCuration({
            datasetId: elements.caseDataset.value,
            caseType,
            sourceThreadId: state.activeThreadId,
            startItemId: selection.startItemId,
            endItemId: selection.itemId,
        })
        upsertCuration(session)
        state.activeCurationId = session.id
        setCurationOpen(true)
        showToast(t("episodeSent"))
    } catch (error) {
        showError(error)
    } finally {
        elements.confirmSaveCase.disabled = false
        state.caseSelection = null
    }
}

async function loadTrace() {
    elements.traceEvents.replaceChildren(node("div", "sidebar-placeholder", t("readingTrace")))
    try {
        const trace = await window.rollingSkill.getTrace(160)
        elements.traceMeta.textContent = trace.path
            ? `${trace.reference || t("noEventsYet")}\n${trace.path}`
            : t("traceInitial")
        elements.traceEvents.replaceChildren()
        if (!trace.events.length) {
            elements.traceEvents.append(node("div", "sidebar-placeholder", t("noTraceEvents")))
            return
        }
        for (const event of [...trace.events].reverse()) {
            const card = node("article", "trace-event")
            const head = node("div", "trace-event-head")
            head.append(
                node("span", "trace-event-direction", event.direction),
                node("span", "", `#${event.sequence} · ${new Date(event.recordedAt).toLocaleTimeString()}`),
            )
            const serialized = JSON.stringify(event.message, null, 2)
            card.append(head, node("pre", "", serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n…` : serialized))
            elements.traceEvents.append(card)
        }
    } catch (error) {
        elements.traceEvents.replaceChildren(node("div", "sidebar-placeholder", error.message))
    }
}

function setTraceOpen(open) {
    state.traceOpen = open
    if (open) {
        state.curationOpen = false
        elements.curationDrawer.classList.remove("visible")
    }
    elements.traceDrawer.classList.toggle("visible", open)
    if (open) void loadTrace()
}

function setCurationOpen(open) {
    state.curationOpen = open
    if (open) {
        state.traceOpen = false
        elements.traceDrawer.classList.remove("visible")
        if (!state.activeCurationId && state.curationSessions.length) {
            state.activeCurationId = state.curationSessions[0].id
        }
    }
    renderCurations()
}

function upsertCuration(session) {
    const index = state.curationSessions.findIndex((entry) => entry.id === session.id)
    if (session.status === "cancelled") {
        if (index >= 0) state.curationSessions.splice(index, 1)
        if (state.activeCurationId === session.id) {
            state.activeCurationId = state.curationSessions[0]?.id ?? null
        }
        return
    }
    if (index >= 0) state.curationSessions[index] = session
    else state.curationSessions.unshift(session)
    state.curationSessions.sort((left, right) =>
        String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
}

async function sendCurationMessage(sessionId, text) {
    if (!String(text).trim()) return
    try {
        const session = await window.rollingSkill.sendCurationMessage(sessionId, text)
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

async function retryCuration(sessionId) {
    try {
        const session = await window.rollingSkill.retryCuration(sessionId)
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

async function archiveCuration(sessionId) {
    try {
        await window.rollingSkill.archiveCuration(sessionId)
        const session = await window.rollingSkill.getCuration(sessionId)
        upsertCuration(session)
        state.datasets = await window.rollingSkill.listDatasets()
        renderCurations()
        showToast(t("caseSaved"))
    } catch (error) {
        showError(error)
    }
}

function openDiscardDialog(sessionId) {
    state.discardCurationId = sessionId
    elements.discardDialog.showModal()
}

async function discardCuration() {
    const sessionId = state.discardCurationId
    if (!sessionId) return
    elements.confirmDiscard.disabled = true
    try {
        const session = await window.rollingSkill.discardCuration(sessionId)
        upsertCuration(session)
        elements.discardDialog.close()
        renderCurations()
        showToast(t("draftDiscarded"))
    } catch (error) {
        showError(error)
    } finally {
        state.discardCurationId = null
        elements.confirmDiscard.disabled = false
    }
}

async function updateCurationModel(sessionId, selectedModelId) {
    try {
        const session = await window.rollingSkill.updateCurationModel(
            sessionId,
            selectedModelId || null,
        )
        upsertCuration(session)
        renderCurations()
        showToast(t("curatorModelUpdated"))
    } catch (error) {
        showError(error)
    }
}

function handleNotification(message) {
    const {method, params = {}} = message ?? {}
    if (method === "thread/started") {
        upsertThreadSummary(params.thread)
    } else if (method === "thread/name/updated") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.name = params.threadName
        if (state.activeThread?.id === params.threadId) state.activeThread.name = params.threadName
    } else if (method === "thread/status/changed") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.status = params.status
    } else if (method === "turn/started" && params.threadId === state.activeThreadId) {
        state.activeTurnId = params.turn.id
        state.sending = false
        upsertTurn(params.turn)
    } else if (method === "item/started" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
    } else if (method === "item/agentMessage/delta" && params.threadId === state.activeThreadId) {
        const turn = ensureTurn(params.turnId)
        let item = turn?.items.find((entry) => entry.id === params.itemId)
        if (!item) {
            item = {type: "agentMessage", id: params.itemId, text: ""}
            turn?.items.push(item)
        }
        item.text = `${item.text || ""}${params.delta || ""}`
    } else if (method === "item/completed" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
    } else if (method === "turn/completed" && params.threadId === state.activeThreadId) {
        upsertTurn(params.turn)
        if (state.activeTurnId === params.turn.id) state.activeTurnId = null
        state.sending = false
        const summary = state.threads.find((entry) => entry.id === params.threadId)
        if (summary) summary.updatedAt = Date.now() / 1000
        void refreshThreads(false)
    } else if (method === "error" && params.threadId === state.activeThreadId) {
        state.error = params.error?.message || "The task failed"
        if (!params.willRetry) {
            state.activeTurnId = null
            state.sending = false
        }
    }
    queueRender({forceBottom: method === "item/agentMessage/delta"})
}

function clearRuntimeTaskState() {
    state.threads = []
    state.activeThreadId = null
    state.activeThread = null
    state.activeTurnId = null
    state.loadingThread = false
    state.loadingThreads = true
    state.sending = false
    state.newTaskMode = false
}

async function changeRuntime(operation, {markStarting = true, clearBefore = true} = {}) {
    if (state.runtimeOperationInProgress) return
    state.runtimeOperationInProgress = true
    state.runtimeEpoch += 1
    state.error = null
    if (clearBefore) clearRuntimeTaskState()
    if (markStarting) state.runtime = {...state.runtime, status: "starting", error: null}
    renderAll()
    try {
        const runtime = await operation()
        if (!runtime) return
        if (!clearBefore) clearRuntimeTaskState()
        state.runtime = runtime
        state.runtimeErrorDismissed = false
        if (runtime.status === "ready") {
            const refreshed = await refreshThreads(true)
            await refreshModels()
            if (refreshed) state.error = null
        } else {
            state.loadingThreads = false
        }
    } catch (error) {
        state.loadingThreads = false
        showError(error)
    } finally {
        state.runtimeOperationInProgress = false
        renderAll()
    }
}

elements.surfaceSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-surface]")
    if (button) setSurface(button.dataset.surface)
})
elements.newTask.addEventListener("click", beginNewTask)
elements.refreshThreads.addEventListener("click", () => refreshThreads(false))
elements.threadList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-thread-id]")
    if (button) void loadThread(button.dataset.threadId)
})
elements.workspaceButton.addEventListener("click", async () => {
    try {
        await window.rollingSkill.chooseWorkspace()
    } catch (error) {
        showError(error)
    }
})
elements.settingsButton.addEventListener("click", openSettings)
elements.closeSettingsDialog.addEventListener("click", () => elements.settingsDialog.close())
elements.cancelSettings.addEventListener("click", () => elements.settingsDialog.close())
elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveSettings()
})
elements.showLocalData.addEventListener("click", () => window.rollingSkill.revealLocalData())
elements.chooseRuntime.addEventListener("click", () => {
    elements.settingsDialog.close()
    openRuntimeDialog()
})
elements.openTrace.addEventListener("click", () => {
    elements.settingsDialog.close()
    setTraceOpen(true)
})
elements.refreshEvaluation.addEventListener("click", () => loadEvaluationWorkbench(true))
elements.evaluationDatasetList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-evaluation-dataset-id]")
    if (button) void selectEvaluationDataset(button.dataset.evaluationDatasetId)
})
elements.evaluationCaseList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-evaluation-case-id]")
    if (!button) return
    state.evaluationCaseId = button.dataset.evaluationCaseId
    renderEvaluationWorkbench()
})
elements.evaluationCreateDataset.addEventListener("submit", (event) => {
    event.preventDefault()
    void createEvaluationDataset()
})
elements.evaluationSkill.addEventListener("change", renderEvaluationWorkbench)
elements.startEvaluation.addEventListener("click", startSelectedEvaluation)
elements.topbarCurations.addEventListener("click", () => setCurationOpen(true))
elements.topbarTrace.addEventListener("click", () => setTraceOpen(true))
elements.closeTrace.addEventListener("click", () => setTraceOpen(false))
elements.closeCurations.addEventListener("click", () => setCurationOpen(false))
elements.refreshTrace.addEventListener("click", loadTrace)
elements.openTraceFolder.addEventListener("click", () => window.rollingSkill.openTraceFolder())
elements.runtimeStatus.addEventListener("click", async () => {
    openRuntimeDialog()
})
elements.closeRuntimeDialog.addEventListener("click", () => elements.runtimeDialog.close())
elements.confirmRuntime.addEventListener("click", () => elements.runtimeDialog.close())
elements.runtimeOptions.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-runtime-id]")
    if (!button || button.dataset.runtimeId === state.runtime?.runtime?.runtimeId) return
    await changeRuntime(() => window.rollingSkill.selectRuntime(button.dataset.runtimeId))
})
elements.detectRuntimes.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.detectRuntimes())
})
elements.automaticRuntime.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.useAutomaticRuntime())
})
elements.chooseRuntimeFile.addEventListener("click", async () => {
    await changeRuntime(() => window.rollingSkill.chooseRuntime(), {
        markStarting: false,
        clearBefore: false,
    })
})
elements.dismissError.addEventListener("click", () => {
    state.error = null
    state.runtimeErrorDismissed = true
    renderRuntime()
})
elements.composer.addEventListener("submit", (event) => {
    event.preventDefault()
    void submitTurn()
})
elements.composerInput.addEventListener("input", resizeComposer)
elements.composerInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault()
        void submitTurn()
    }
})
elements.composerModel.addEventListener("change", () => {
    state.selectedTaskModelId = elements.composerModel.value || null
    renderComposer()
})
elements.stopTurn.addEventListener("click", stopTurn)
elements.conversation.addEventListener("click", (event) => {
    const button = event.target.closest("[data-save-case]")
    if (button) openCaseDialog(button.dataset.turnId, button.dataset.itemId)
})
elements.closeCaseDialog.addEventListener("click", () => elements.caseDialog.close())
elements.cancelSaveCase.addEventListener("click", () => elements.caseDialog.close())
elements.caseStartItem.addEventListener("change", updateEpisodeStartPreview)
elements.createDataset.addEventListener("click", createDataset)
elements.caseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void createCuration()
})
elements.curationList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-curation-id]")
    if (!button) return
    state.activeCurationId = button.dataset.curationId
    renderCurations()
})
elements.curationDetail.addEventListener("click", (event) => {
    const retry = event.target.closest("[data-retry-curation]")
    if (retry) void retryCuration(retry.dataset.retryCuration)
    const archive = event.target.closest("[data-archive-curation]")
    if (archive) void archiveCuration(archive.dataset.archiveCuration)
    const discard = event.target.closest("[data-discard-curation]")
    if (discard) openDiscardDialog(discard.dataset.discardCuration)
})
elements.curationDetail.addEventListener("change", (event) => {
    const picker = event.target.closest("[data-curation-model]")
    if (picker) void updateCurationModel(picker.dataset.curationModel, picker.value)
})
elements.curationDetail.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-curation-form]")
    if (!form) return
    event.preventDefault()
    const input = form.querySelector("[data-curation-input]")
    const text = input?.value ?? ""
    if (input) input.value = ""
    void sendCurationMessage(form.dataset.curationForm, text)
})
elements.closeDiscardDialog.addEventListener("click", () => elements.discardDialog.close())
elements.cancelDiscard.addEventListener("click", () => elements.discardDialog.close())
elements.confirmDiscard.addEventListener("click", discardCuration)

window.rollingSkill.onRuntimeState((runtime) => {
    state.runtime = runtime
    state.runtimeErrorDismissed = false
    renderRuntime()
    renderComposer()
    if (runtime.status === "ready") void refreshModels()
    if (state.surface === "evaluation") void loadEvaluationWorkbench(true)
})
window.rollingSkill.onRuntimeNotification(handleNotification)
window.rollingSkill.onCurationChanged((session) => {
    upsertCuration(session)
    if (!state.activeCurationId) state.activeCurationId = session.id
    renderCurations()
})
window.rollingSkill.onWorkspaceChanged(async ({workspaceRoot}) => {
    state.workspaceRoot = workspaceRoot
    state.activeThread = null
    state.activeThreadId = null
    state.activeTurnId = null
    state.newTaskMode = false
    state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
    renderAll()
    if (state.runtime?.status === "ready") await refreshThreads(true)
    else {
        state.loadingThreads = false
        renderThreads()
    }
    if (state.surface === "evaluation") await loadEvaluationWorkbench(true)
})
window.rollingSkill.onNewTask(beginNewTask)
async function bootstrap() {
    try {
        const initial = await window.rollingSkill.bootstrap()
        state.runtime = initial.runtime
        state.workspaceRoot = initial.workspaceRoot
        state.datasets = initial.datasets ?? []
        state.evaluationDatasetId = state.datasets[0]?.id ?? null
        state.curationSessions = initial.curationSessions ?? []
        applySettings(initial.settings ?? state.settings)
        state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
        state.activeCurationId = state.curationSessions[0]?.id ?? null
        renderAll()
        renderCurations()
        if (state.runtime?.status !== "unavailable") {
            await refreshModels()
            await refreshThreads(true)
        } else {
            state.loadingThreads = false
            renderThreads()
        }
    } catch (error) {
        state.loadingThreads = false
        showError(error)
        renderAll()
    }
}

resizeComposer()
void bootstrap()
