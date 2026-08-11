const translations = {
    en: {
        newTask: "New task",
        tasks: "Tasks",
        currentThreads: "Current",
        archivedThreads: "Archived",
        archiveThread: "Archive",
        restoreThread: "Restore",
        archiveHistoryUnavailable: "Archive history is unavailable for this runtime.",
        archivedThreadReadOnly: "Archived tasks are read-only. Restore this task to continue.",
        runningThreadCannotArchive: "Stop the running task before archiving it.",
        settings: "Settings",
        datasets: "Datasets",
        trace: "Trace",
        runtime: "Runtime…",
        caseDrafts: "Case drafts",
        taskCouldNotContinue: "Task could not continue",
        dismiss: "Dismiss",
        close: "Close",
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
        captureSkill: "Skill used by the Curator",
        selectSkill: "Select an enabled Skill",
        unavailableSkill: "Previously selected Skill is unavailable",
        skillRequiredForCapture: "Automatic capture requires an enabled Skill from the current runtime.",
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
        reasoningEffort: "Reasoning effort",
        runtimeDefaultEffort: "Runtime default effort",
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
        noArchivedThreads: "No archived tasks in this workspace.",
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
        evaluationWorkbenchHelp: "Keep questions verbatim and compare the same Skill across local runtime configurations.",
        cases: "Cases",
        verbatimQuestions: "Questions stay verbatim",
        testRun: "Test run",
        runtimePreflight: "Runtime preflight",
        skillUnderTest: "Skill under test",
        activationMode: "Activation mode",
        automaticTrigger: "Automatic trigger",
        automaticTriggerHelp: "Send only the original question. This is the scored path.",
        explicitDiagnostic: "Explicit diagnostic",
        explicitDiagnosticHelp: "Use the provider's explicit Skill instruction to isolate trigger failures.",
        startSelectedCase: "Start selected case",
        evaluationLaunchHelp: "Selected runtimes execute in parallel and save durable evidence here. Automated grading is not applied yet.",
        noDatasets: "No datasets yet.",
        noCases: "This dataset has no saved cases yet.",
        noSkills: "No Skill reference is available from runtime inventory or saved Cases.",
        selectCase: "Select one case to run.",
        skillReady: "Installed and enabled in {runtime}",
        skillSelected: "Selected Skill reference",
        originalQuestionOnly: "Original question only",
        explicitSkillAttached: "Structured Skill mention attached",
        evaluationRuns: "Evaluation runs",
        runtimeConfigurations: "Runtime configurations",
        startDataset: "Run entire dataset",
        noRuns: "No evaluation runs yet.",
        runQueued: "Evaluation run queued",
        runResults: "Case × runtime results",
        deleteCase: "Delete Case?",
        deleteCaseHelp: "The Case will be removed from the dataset. Existing run snapshots stay available.",
        deleteDataset: "Delete dataset?",
        deleteDatasetHelp: "All Cases and finished draft records in this dataset will be removed. Unfinished drafts block deletion; evaluation records keep their snapshots.",
        deleteEvaluationRun: "Delete evaluation record?",
        deleteEvaluationRunHelp: "This saved run, its results, and embedded snapshots will be permanently removed. Trace files are not deleted.",
        delete: "Delete",
        caseDeleted: "Case deleted",
        datasetDeleted: "Dataset deleted",
        evaluationRunDeleted: "Evaluation record deleted",
        unfinishedDraftBlocksDatasetDelete: "Finish or discard the dataset's active Case drafts before deleting it.",
        activeRunCannotDelete: "Wait for this evaluation run to finish before deleting it.",
        archivedDrafts: "Archived Case drafts",
        noArchivedDrafts: "No archived Case drafts.",
        skillInventoryUnavailable: "Skill inventory is unavailable for this runtime",
        localRuntimeAndData: "Local runtime & data",
        localRuntimeAndDataHelp: "Runtime discovery, raw trace, and the local evaluation store stay on this Mac.",
        localAccess: "Local access",
        fullLocalAccess: "Full local access",
        workspaceOnlyAccess: "Workspace only",
        localAccessHelp: "This is the selected runtime's own local sandbox. Full local access lets its CLI read credentials and files available to the current user.",
        localAccessUnsupported: "This runtime manages its own permissions and does not expose a workspace sandbox to Rolling Skill.",
        runtimeManagedAccess: "Runtime-managed access",
        openDatasetFile: "Open dataset file",
    },
    "zh-CN": {
        newTask: "新任务",
        tasks: "任务",
        currentThreads: "当前",
        archivedThreads: "已归档",
        archiveThread: "归档",
        restoreThread: "恢复",
        archiveHistoryUnavailable: "当前运行时不支持会话归档历史。",
        archivedThreadReadOnly: "已归档任务为只读；恢复后才能继续对话。",
        runningThreadCannotArchive: "请先停止正在运行的任务，再将其归档。",
        settings: "设置",
        datasets: "数据集",
        trace: "Trace",
        runtime: "运行时…",
        caseDrafts: "Case 草稿",
        taskCouldNotContinue: "任务无法继续",
        dismiss: "关闭",
        close: "关闭",
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
        captureSkill: "Curator 使用的 Skill",
        selectSkill: "请选择一个已启用的 Skill",
        unavailableSkill: "之前选择的 Skill 当前不可用",
        skillRequiredForCapture: "自动沉淀必须选择当前运行时中已启用的 Skill。",
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
        reasoningEffort: "推理强度",
        runtimeDefaultEffort: "运行时默认强度",
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
        noArchivedThreads: "此工作目录没有已归档任务。",
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
        evaluationWorkbenchHelp: "保留原始问题，在多个本地运行时配置间对比同一个 Skill。",
        cases: "Cases",
        verbatimQuestions: "问题保持原文",
        testRun: "测试运行",
        runtimePreflight: "运行时预检",
        skillUnderTest: "被测 Skill",
        activationMode: "唤起模式",
        automaticTrigger: "自动触发",
        automaticTriggerHelp: "只发送原始问题；这是正式评测路径。",
        explicitDiagnostic: "显式诊断",
        explicitDiagnosticHelp: "使用对应运行时的显式 Skill 指令，用于区分触发失败和执行失败。",
        startSelectedCase: "启动选中 Case",
        evaluationLaunchHelp: "所选运行时会并行执行，并在这里保存持久证据；当前尚未自动判分。",
        noDatasets: "还没有数据集。",
        noCases: "这个数据集还没有已保存的 Case。",
        noSkills: "运行时清单和已保存 Case 中都没有可用的 Skill 引用。",
        selectCase: "请选择一个 Case 运行。",
        skillReady: "已安装并在 {runtime} 中启用",
        skillSelected: "已选择 Skill 引用",
        originalQuestionOnly: "仅发送原始问题",
        explicitSkillAttached: "已附加结构化 Skill mention",
        evaluationRuns: "评测记录",
        runtimeConfigurations: "运行时配置",
        startDataset: "运行整个数据集",
        noRuns: "还没有评测记录。",
        runQueued: "评测任务已进入队列",
        runResults: "Case × Runtime 结果",
        deleteCase: "删除 Case？",
        deleteCaseHelp: "该 Case 会从数据集中移除；已有评测记录中的快照仍会保留。",
        deleteDataset: "删除数据集？",
        deleteDatasetHelp: "该数据集中的所有 Case 和已结束草稿记录都会被删除；未结束草稿会阻止删除，已有评测记录仍保留快照。",
        deleteEvaluationRun: "删除评测记录？",
        deleteEvaluationRunHelp: "本次评测、结果及内嵌快照会被永久删除；对应的原始 Trace 文件不会删除。",
        delete: "删除",
        caseDeleted: "Case 已删除",
        datasetDeleted: "数据集已删除",
        evaluationRunDeleted: "评测记录已删除",
        unfinishedDraftBlocksDatasetDelete: "请先完成或丢弃这个数据集中的活动 Case 草稿，再删除数据集。",
        activeRunCannotDelete: "请等待本次评测结束后再删除这条记录。",
        archivedDrafts: "已归档 Case 草稿",
        noArchivedDrafts: "还没有已归档的 Case 草稿。",
        skillInventoryUnavailable: "该运行时不提供 Skill 清单",
        localRuntimeAndData: "本地运行时与数据",
        localRuntimeAndDataHelp: "运行时发现、原始 Trace 和本地评测数据都保存在这台 Mac。",
        localAccess: "本地访问权限",
        fullLocalAccess: "完整本机访问",
        workspaceOnlyAccess: "仅工作目录",
        localAccessHelp: "这是所选运行时自身的本地 sandbox。完整本机访问会让其 CLI 读取当前用户可访问的凭据和文件。",
        localAccessUnsupported: "当前运行时自行管理权限，未向 Rolling Skill 提供工作目录 sandbox。",
        runtimeManagedAccess: "运行时自行管理权限",
        openDatasetFile: "打开数据集文件",
    },
}

const state = {
    runtime: {status: "starting"},
    workspaceRoot: "",
    threads: [],
    threadView: "current",
    threadRefreshToken: 0,
    activeThreadId: null,
    activeThread: null,
    activeThreadArchived: false,
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
        localAccess: "full",
        taskProfile: {runtimePolicy: "active", modelId: null, effort: null},
        curatorProfile: {runtimePolicy: "active", modelId: null, effort: null},
        autoCaptureProfile: {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
            datasetId: null,
            caseType: "goodcase",
            skillName: null,
            skillPath: null,
        },
    },
    models: [],
    selectedTaskModelId: null,
    selectedTaskEffort: null,
    discardCurationId: null,
    traceOpen: false,
    surface: "chat",
    evaluationCases: [],
    evaluationSkills: [],
    evaluationDatasetId: null,
    evaluationCaseId: null,
    evaluationView: "cases",
    evaluationRuns: [],
    activeEvaluationRunId: null,
    activeEvaluationRun: null,
    evaluationRuntimeConfigurations: {},
    archivedCurations: [],
    archivedCurationsOpen: false,
    deleteCaseId: null,
    deleteDatasetId: null,
    deleteEvaluationRunId: null,
    evaluationLoading: false,
    evaluationError: null,
    evaluationSkillByThread: {},
    renderQueued: false,
}

const elements = {
    newTask: document.querySelector("#new-task"),
    surfaceSwitch: document.querySelector("#surface-switch"),
    workbench: document.querySelector(".workbench"),
    refreshThreads: document.querySelector("#refresh-threads"),
    threadViewSwitch: document.querySelector("#thread-view-switch"),
    threadHistoryStatus: document.querySelector("#thread-history-status"),
    threadList: document.querySelector("#thread-list"),
    workspaceButton: document.querySelector("#workspace-button"),
    settingsButton: document.querySelector("#settings-button"),
    workspaceName: document.querySelector("#workspace-name"),
    sidebarWorkspacePath: document.querySelector("#sidebar-workspace-path"),
    settingsWorkspacePath: document.querySelector("#settings-workspace-path"),
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
    evaluationRuntimeList: document.querySelector("#evaluation-runtime-list"),
    startEvaluation: document.querySelector("#start-evaluation"),
    startDatasetEvaluation: document.querySelector("#start-dataset-evaluation"),
    evaluationCasesView: document.querySelector("#evaluation-cases-view"),
    evaluationRuns: document.querySelector("#evaluation-runs"),
    evaluationRunCount: document.querySelector("#evaluation-run-count"),
    evaluationRunList: document.querySelector("#evaluation-run-list"),
    evaluationRunDetail: document.querySelector("#evaluation-run-detail"),
    errorBanner: document.querySelector("#error-banner"),
    errorMessage: document.querySelector("#error-message"),
    dismissError: document.querySelector("#dismiss-error"),
    conversationScroll: document.querySelector("#conversation-scroll"),
    conversation: document.querySelector("#conversation"),
    composer: document.querySelector("#composer"),
    composerInput: document.querySelector("#composer-input"),
    composerModel: document.querySelector("#composer-model"),
    composerEffort: document.querySelector("#composer-effort"),
    composerAccess: document.querySelector("#composer-access"),
    archivedThreadNotice: document.querySelector("#archived-thread-notice"),
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
    settingsLocalAccess: document.querySelector("#settings-local-access"),
    settingsLocalAccessHelp: document.querySelector("#settings-local-access-help"),
    settingsTaskModel: document.querySelector("#settings-task-model"),
    settingsTaskEffort: document.querySelector("#settings-task-effort"),
    settingsCuratorModel: document.querySelector("#settings-curator-model"),
    settingsCuratorEffort: document.querySelector("#settings-curator-effort"),
    settingsAutoCapture: document.querySelector("#settings-auto-capture"),
    settingsAutoCaptureModel: document.querySelector("#settings-auto-capture-model"),
    settingsAutoCaptureEffort: document.querySelector("#settings-auto-capture-effort"),
    settingsAutoCaptureSkill: document.querySelector("#settings-auto-capture-skill"),
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
    archivedCurations: document.querySelector("#archived-curations"),
    archivedCurationList: document.querySelector("#archived-curation-list"),
    deleteCaseDialog: document.querySelector("#delete-case-dialog"),
    closeDeleteCaseDialog: document.querySelector("#close-delete-case-dialog"),
    cancelDeleteCase: document.querySelector("#cancel-delete-case"),
    confirmDeleteCase: document.querySelector("#confirm-delete-case"),
    deleteDatasetDialog: document.querySelector("#delete-dataset-dialog"),
    closeDeleteDatasetDialog: document.querySelector("#close-delete-dataset-dialog"),
    cancelDeleteDataset: document.querySelector("#cancel-delete-dataset"),
    confirmDeleteDataset: document.querySelector("#confirm-delete-dataset"),
    deleteDatasetError: document.querySelector("#delete-dataset-error"),
    deleteEvaluationRunDialog: document.querySelector("#delete-evaluation-run-dialog"),
    closeDeleteEvaluationRunDialog: document.querySelector("#close-delete-evaluation-run-dialog"),
    cancelDeleteEvaluationRun: document.querySelector("#cancel-delete-evaluation-run"),
    confirmDeleteEvaluationRun: document.querySelector("#confirm-delete-evaluation-run"),
    deleteEvaluationRunError: document.querySelector("#delete-evaluation-run-error"),
    caseDialog: document.querySelector("#save-case-dialog"),
    caseForm: document.querySelector("#save-case-form"),
    caseDataset: document.querySelector("#case-dataset"),
    caseSkill: document.querySelector("#case-skill"),
    caseSkillStatus: document.querySelector("#case-skill-status"),
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

const messageLinkPattern = /\[([^\]\n]+)\]\(<?(https?:\/\/[^)>\s]+|\/[^)>\n]+)>?\)|(https?:\/\/[^\s<]+)|(\/(?:[^\s<>()]+\/)*[^\s<>()]+)/g

function localPathReference(value) {
    const match = String(value ?? "").match(/^(\/.*?)(?::(\d+))?$/)
    if (!match) return null
    return {path: match[1], line: match[2] ? Number(match[2]) : null}
}

function trimBareLinkSuffix(value) {
    const suffix = String(value).match(/[.,;!?]+$/)?.[0] ?? ""
    return {target: suffix ? value.slice(0, -suffix.length) : value, suffix}
}

function messageLink(label, target) {
    const external = /^https?:\/\//i.test(target)
    const local = external ? null : localPathReference(target)
    if (!external && !local) return null
    const link = node("a", "message-link", label)
    link.href = external ? target : "#"
    if (external) {
        link.rel = "noreferrer"
        link.dataset.externalUrl = target
    } else {
        link.dataset.localPath = local.path
        if (local.line !== null) {
            link.dataset.line = String(local.line)
            link.title = `${local.path}:${local.line}`
        }
    }
    return link
}

function appendSafeMessageText(container, value) {
    const text = String(value ?? "")
    messageLinkPattern.lastIndex = 0
    let cursor = 0
    for (const match of text.matchAll(messageLinkPattern)) {
        if (match.index > cursor) {
            container.append(document.createTextNode(text.slice(cursor, match.index)))
        }
        const markdown = match[1] !== undefined
        const rawTarget = match[2] ?? match[3] ?? match[4]
        const {target, suffix} = markdown
            ? {target: rawTarget, suffix: ""}
            : trimBareLinkSuffix(rawTarget)
        const link = messageLink(markdown ? match[1] : target, target)
        if (link) container.append(link)
        else container.append(document.createTextNode(match[0]))
        if (suffix) container.append(document.createTextNode(suffix))
        cursor = match.index + match[0].length
    }
    if (cursor < text.length) container.append(document.createTextNode(text.slice(cursor)))
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
    for (const element of document.querySelectorAll("[data-i18n-title]")) {
        element.title = t(element.dataset.i18nTitle)
    }
    for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
        element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel))
    }
}

function modelValue(model) {
    return String(model?.model ?? model?.id ?? "").trim()
}

function populateModelSelect(
    select,
    selectedModelId,
    defaultLabel = t("runtimeDefault"),
    sourceModels = state.models,
) {
    const selected = String(selectedModelId ?? "").trim()
    const catalog = sourceModels
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

function effortValue(entry) {
    return String(entry?.reasoningEffort ?? entry?.effort ?? entry?.value ?? entry ?? "").trim()
}

function modelEfforts(model) {
    const values =
        model?.reasoningEfforts ??
        model?.supportedReasoningEfforts ??
        model?.supportedEfforts ??
        []
    return [...new Set(values.map(effortValue).filter(Boolean))]
}

function effortsForModel(models, modelId, fallback = []) {
    const selected = String(modelId ?? "").trim()
    const model = selected
        ? models.find((entry) => modelValue(entry) === selected)
        : models.find((entry) => entry.isDefault) ?? models[0]
    const efforts = modelEfforts(model)
    return efforts.length ? efforts : [...new Set((fallback ?? []).map(effortValue).filter(Boolean))]
}

function populateEffortSelect(
    select,
    selectedEffort,
    modelId,
    sourceModels = state.models,
    fallbackEfforts = state.runtime?.runtime?.efforts ?? [],
) {
    const selected = String(selectedEffort ?? "").trim()
    const efforts = effortsForModel(sourceModels, modelId, fallbackEfforts)
    const selectedModel = modelId
        ? sourceModels.find((entry) => modelValue(entry) === modelId)
        : sourceModels.find((entry) => entry.isDefault) ?? sourceModels[0]
    const defaultEffort = effortValue(selectedModel?.defaultReasoningEffort)
    const signature = JSON.stringify({selected, modelId, efforts, defaultEffort, language: state.settings.language})
    if (select.dataset.effortSignature === signature) return
    select.replaceChildren()
    const runtimeDefault = node(
        "option",
        "",
        defaultEffort ? `${t("runtimeDefaultEffort")} · ${defaultEffort}` : t("runtimeDefaultEffort"),
    )
    runtimeDefault.value = ""
    select.append(runtimeDefault)
    for (const effort of efforts) {
        const option = node("option", "", effort)
        option.value = effort
        select.append(option)
    }
    if (selected && !efforts.length) {
        const custom = node("option", "", selected)
        custom.value = selected
        select.append(custom)
    }
    select.value = selected
    select.dataset.effortSignature = signature
}

function renderCaptureStatus() {
    const enabled = Boolean(state.settings.autoCapture)
    elements.captureStatus.textContent = t(enabled ? "autoCaptureOn" : "autoCaptureOff")
    elements.captureStatus.closest(".capture-note")?.classList.toggle("active", enabled)
}

function applySettings(settings) {
    state.settings = {
        ...settings,
        localAccess: settings.localAccess ?? "full",
        taskProfile: {...settings.taskProfile, effort: settings.taskProfile?.effort ?? null},
        curatorProfile: {...settings.curatorProfile, effort: settings.curatorProfile?.effort ?? null},
        autoCaptureProfile: {
            ...settings.autoCaptureProfile,
            effort: settings.autoCaptureProfile?.effort ?? null,
        },
    }
    state.curatorProfile = settings.curatorProfile
    document.documentElement.dataset.theme = settings.theme
    applyLocalization()
    renderCaptureStatus()
}

function renderTaskModelPicker() {
    populateModelSelect(elements.composerModel, state.selectedTaskModelId)
    populateEffortSelect(
        elements.composerEffort,
        state.selectedTaskEffort,
        state.selectedTaskModelId,
    )
    state.selectedTaskEffort = elements.composerEffort.value || null
}

function runtimeSkillByPath(path) {
    return state.evaluationSkills.find((skill) => skill.path === path) ?? null
}

function skillBaseLabel(skill) {
    return skill.interface?.displayName || skill.name
}

function skillDisplayLabel(skill) {
    const base = skillBaseLabel(skill)
    const duplicate = state.evaluationSkills.some(
        (entry) => entry.path !== skill.path && skillBaseLabel(entry) === base,
    )
    if (!duplicate) return base
    const directory = String(skill.path).split("/").filter(Boolean).at(-2) || skill.scope || "runtime"
    return `${base} · ${directory}`
}

function populateSkillSelect(select, selectedPath = null, {allowEmpty = true} = {}) {
    select.replaceChildren()
    if (allowEmpty) {
        const empty = node("option", "", t("selectSkill"))
        empty.value = ""
        select.append(empty)
    }
    for (const skill of state.evaluationSkills) {
        const option = node("option", "", skillDisplayLabel(skill))
        option.value = skill.path
        select.append(option)
    }
    if (selectedPath && runtimeSkillByPath(selectedPath)) {
        select.value = selectedPath
    } else if (selectedPath) {
        const unavailable = node("option", "", t("unavailableSkill"))
        unavailable.value = selectedPath
        unavailable.disabled = true
        select.append(unavailable)
        select.value = selectedPath
    } else {
        select.value = allowEmpty ? "" : state.evaluationSkills[0]?.path ?? ""
    }
}

function renderCaseSkillStatus() {
    const skill = runtimeSkillByPath(elements.caseSkill.value)
    elements.caseSkillStatus.className = `skill-preflight ${skill ? "ready" : "missing"}`
    elements.caseSkillStatus.textContent = skill
        ? `${formatMessage("skillReady", {runtime: state.runtime?.runtime?.displayName ?? t("localRuntime")})} · ${skill.scope}`
        : t("selectSkill")
}

function renderSettingsForm() {
    const settings = state.settings
    elements.settingsLanguage.value = settings.language
    elements.settingsTheme.value = settings.theme
    elements.settingsLocalAccess.value = state.settings.localAccess ?? "full"
    elements.settingsLocalAccess.disabled = !supportsLocalAccessPolicy()
    elements.settingsLocalAccessHelp.textContent = t(
        supportsLocalAccessPolicy() ? "localAccessHelp" : "localAccessUnsupported",
    )
    populateModelSelect(elements.settingsTaskModel, settings.taskProfile?.modelId)
    populateEffortSelect(
        elements.settingsTaskEffort,
        settings.taskProfile?.effort,
        settings.taskProfile?.modelId,
    )
    populateModelSelect(
        elements.settingsCuratorModel,
        settings.curatorProfile?.modelId,
        t("sourceOrRuntimeModel"),
    )
    populateEffortSelect(
        elements.settingsCuratorEffort,
        settings.curatorProfile?.effort,
        settings.curatorProfile?.modelId,
    )
    populateModelSelect(
        elements.settingsAutoCaptureModel,
        settings.autoCaptureProfile?.modelId,
        t("sourceOrRuntimeModel"),
    )
    populateEffortSelect(
        elements.settingsAutoCaptureEffort,
        settings.autoCaptureProfile?.effort,
        settings.autoCaptureProfile?.modelId,
    )
    populateSkillSelect(
        elements.settingsAutoCaptureSkill,
        settings.autoCaptureProfile?.skillPath,
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

async function openSettings() {
    renderSettingsForm()
    elements.settingsDialog.showModal()
    try {
        await refreshRuntimeSkills(true)
        if (elements.settingsDialog.open) renderSettingsForm()
    } catch (error) {
        showError(error)
    }
}

async function saveSettings() {
    elements.saveSettings.disabled = true
    try {
        const captureSkill = runtimeSkillByPath(elements.settingsAutoCaptureSkill.value)
        if (elements.settingsAutoCapture.checked && !captureSkill) {
            throw new Error(t("skillRequiredForCapture"))
        }
        const settings = await window.rollingSkill.updateSettings({
            language: elements.settingsLanguage.value,
            theme: elements.settingsTheme.value,
            localAccess: elements.settingsLocalAccess.value,
            taskModelId: elements.settingsTaskModel.value,
            taskEffort: elements.settingsTaskEffort.value,
            curatorModelId: elements.settingsCuratorModel.value,
            curatorEffort: elements.settingsCuratorEffort.value,
            autoCapture: elements.settingsAutoCapture.checked,
            autoCaptureModelId: elements.settingsAutoCaptureModel.value,
            autoCaptureEffort: elements.settingsAutoCaptureEffort.value,
            autoCaptureDatasetId: elements.settingsAutoCaptureDataset.value || null,
            autoCaptureCaseType: elements.settingsAutoCaptureCaseType.value,
            autoCaptureSkillName: captureSkill?.name ?? null,
            autoCaptureSkillPath: captureSkill?.path ?? null,
        })
        applySettings(settings)
        if (state.newTaskMode || !state.activeThread) {
            state.selectedTaskModelId = settings.taskProfile?.modelId ?? null
            state.selectedTaskEffort = settings.taskProfile?.effort ?? null
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

function supportsThreadArchive() {
    const capabilities = state.runtime?.runtime?.capabilities ?? []
    return capabilities.includes("thread-archive")
}

function supportsLocalAccessPolicy() {
    const capabilities = state.runtime?.runtime?.capabilities ?? []
    return capabilities.includes("sandbox-policy")
}

function isThreadRunning(thread) {
    const status = statusType(thread?.status)
    return (
        status === "active" ||
        status === "running" ||
        status === "inProgress" ||
        (thread?.id === state.activeThreadId && (Boolean(state.activeTurnId) || state.sending))
    )
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
    elements.sidebarWorkspacePath.textContent = state.workspaceRoot
    elements.sidebarWorkspacePath.title = state.workspaceRoot
    elements.settingsWorkspacePath.textContent = state.workspaceRoot
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
    const archiveSupported = supportsThreadArchive()
    for (const button of elements.threadViewSwitch.querySelectorAll("[data-thread-view]")) {
        const selected = button.dataset.threadView === state.threadView
        button.classList.toggle("active", selected)
        button.setAttribute("aria-selected", String(selected))
        if (button.dataset.threadView === "archived") button.disabled = !archiveSupported
    }
    elements.threadHistoryStatus.classList.toggle("hidden", archiveSupported)
    elements.threadHistoryStatus.textContent = archiveSupported
        ? ""
        : t("archiveHistoryUnavailable")
    elements.threadList.replaceChildren()
    if (state.loadingThreads) {
        elements.threadList.append(node("div", "sidebar-placeholder", t("loadingTasks")))
        return
    }
    if (state.threadView === "archived" && !archiveSupported) {
        elements.threadList.append(
            node("div", "sidebar-placeholder", t("archiveHistoryUnavailable")),
        )
        return
    }
    if (state.threads.length === 0) {
        elements.threadList.append(
            node(
                "div",
                "sidebar-placeholder",
                t(state.threadView === "archived" ? "noArchivedThreads" : "noTasks"),
            ),
        )
        return
    }

    for (const thread of state.threads) {
        const row = node("div", "thread-row")
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
        row.append(button)
        if (archiveSupported) {
            const action = node(
                "button",
                "thread-action",
                t(state.threadView === "archived" ? "restoreThread" : "archiveThread"),
            )
            action.type = "button"
            if (state.threadView === "archived") {
                action.dataset.unarchiveThread = thread.id
            } else {
                action.dataset.archiveThread = thread.id
                action.disabled = isThreadRunning(thread)
                if (action.disabled) action.title = t("runningThreadCannotArchive")
            }
            row.append(action)
        }
        elements.threadList.append(row)
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
        const body = node("div", "message-body")
        appendSafeMessageText(body, textFromUserInput(item.content))
        wrapper.append(body)
        return wrapper
    }
    if (item.type === "agentMessage") {
        const wrapper = node("article", "message assistant")
        const avatar = node("span", "assistant-avatar")
        const image = node("img")
        image.src = "logo.svg"
        image.alt = ""
        avatar.append(image)
        const body = node("div", "message-body")
        appendSafeMessageText(body, item.text || "")
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
    const readOnly = state.activeThreadArchived
    elements.stopTurn.classList.toggle("hidden", !running)
    elements.sendTurn.classList.toggle("hidden", running || readOnly)
    elements.sendTurn.disabled =
        readOnly || state.runtime?.status !== "ready" || !elements.composerInput.value.trim()
    elements.composerInput.disabled = state.sending || readOnly
    elements.composerModel.disabled = readOnly || running || state.runtime?.status !== "ready"
    elements.composerEffort.disabled = readOnly || running || state.runtime?.status !== "ready"
    elements.composer.classList.toggle("archived-readonly", readOnly)
    elements.archivedThreadNotice.classList.toggle("hidden", !readOnly)
    elements.composerAccess.textContent = supportsLocalAccessPolicy()
        ? t(state.settings.localAccess === "workspace" ? "workspaceOnlyAccess" : "fullLocalAccess")
        : t("runtimeManagedAccess")
    renderTaskModelPicker()
}

function renderTitle() {
    elements.activeTitle.textContent = state.surface === "evaluation"
        ? t("skillEvaluation")
        : state.newTaskMode
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
        `${session.episode.items.length} episode items · ${session.episode.toolActivity.length} tool signatures · ${session.skillReference?.name || t("none")} · ${session.curator.modelId || t("runtimeDefault")}`,
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
        const effortPicker = node("select", "effort-picker curation-effort-picker")
        effortPicker.setAttribute("data-curation-effort", session.id)
        effortPicker.setAttribute("aria-label", t("reasoningEffort"))
        effortPicker.disabled = input.disabled
        populateEffortSelect(
            effortPicker,
            session.curator.effort,
            session.curator.modelId,
        )
        const send = node("button", "", t("send"))
        send.type = "submit"
        send.disabled = input.disabled
        footer.append(modelPicker, effortPicker, send)
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

    for (const button of elements.evaluationWorkbench.querySelectorAll("[data-evaluation-view]")) {
        button.classList.toggle("active", button.dataset.evaluationView === state.evaluationView)
    }
    elements.evaluationCasesView.classList.toggle("hidden", state.evaluationView !== "cases")
    elements.evaluationRuns.classList.toggle("hidden", state.evaluationView !== "runs")

    elements.evaluationDatasetCount.textContent = String(state.datasets.length)
    elements.evaluationDatasetList.replaceChildren()
    if (!state.datasets.length) {
        elements.evaluationDatasetList.append(node("div", "sidebar-placeholder", t("noDatasets")))
    }
    for (const dataset of state.datasets) {
        const row = node("article", "evaluation-dataset-row")
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
        const remove = node("button", "hover-delete-button evaluation-dataset-delete", "×")
        remove.type = "button"
        remove.title = t("deleteDataset")
        remove.setAttribute("aria-label", t("deleteDataset"))
        remove.dataset.deleteEvaluationDataset = dataset.id
        row.append(button, remove)
        elements.evaluationDatasetList.append(row)
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
        const row = node("article", "evaluation-case-row")
        const button = node("button", "evaluation-case")
        button.type = "button"
        button.dataset.evaluationCaseId = caseEntry.id
        if (caseEntry.id === state.evaluationCaseId) button.classList.add("active")
        button.append(
            node("span", `case-badge ${caseEntry.caseType}`, caseEntry.caseType),
            node("strong", "", caseEntry.question),
            node("small", "", caseEntry.curated?.referenceAnswer?.summary || caseEntry.answer || ""),
        )
        const remove = node("button", "hover-delete-button evaluation-case-delete", "×")
        remove.type = "button"
        remove.title = t("deleteCase")
        remove.setAttribute("aria-label", t("deleteCase"))
        remove.dataset.deleteEvaluationCase = caseEntry.id
        row.append(button, remove)
        elements.evaluationCaseList.append(row)
    }

    const selectedPath = elements.evaluationSkill.value
    elements.evaluationSkill.replaceChildren()
    for (const skill of state.evaluationSkills) {
        const option = node("option", "", skillDisplayLabel(skill))
        option.value = skill.path
        elements.evaluationSkill.append(option)
    }
    if (selectedPath && state.evaluationSkills.some((skill) => skill.path === selectedPath)) {
        elements.evaluationSkill.value = selectedPath
    }
    const skill = selectedEvaluationSkill()
    elements.evaluationSkillStatus.className = `skill-preflight ${skill ? "ready" : "missing"}`
    elements.evaluationSkillStatus.textContent = skill
        ? `${t("skillSelected")} · ${skill.scope ?? "dataset"}`
        : t("noSkills")
    renderEvaluationRuntimeConfigurations(skill)
    renderEvaluationRuns()
    const selectedRuntimeCount = Object.values(state.evaluationRuntimeConfigurations).filter(
        (configuration) => configuration.selected,
    ).length
    elements.startEvaluation.disabled =
        state.evaluationLoading ||
        !state.evaluationCaseId ||
        !skill ||
        !selectedRuntimeCount
    elements.startDatasetEvaluation.disabled =
        state.evaluationLoading ||
        !state.evaluationCases.length ||
        !skill ||
        !selectedRuntimeCount
}

function ensureEvaluationRuntimeConfigurations() {
    const runtimes = state.runtime?.availableRuntimes ?? []
    const availableIds = new Set(runtimes.map((runtime) => runtime.runtimeId))
    for (const runtimeId of Object.keys(state.evaluationRuntimeConfigurations)) {
        if (!availableIds.has(runtimeId)) delete state.evaluationRuntimeConfigurations[runtimeId]
    }
    for (const runtime of runtimes) {
        if (state.evaluationRuntimeConfigurations[runtime.runtimeId]) continue
        const active = runtime.runtimeId === state.runtime?.runtime?.runtimeId
        state.evaluationRuntimeConfigurations[runtime.runtimeId] = {
            runtime,
            selected: active,
            modelId: active ? state.settings.taskProfile?.modelId ?? null : null,
            effort: active ? state.settings.taskProfile?.effort ?? null : null,
            models: (runtime.models ?? []).map((model, index) => ({
                id: model,
                model,
                displayName: model,
                isDefault: index === 0 || model === "default-model",
                reasoningEfforts: (runtime.efforts ?? []).map((effort) => ({reasoningEffort: effort})),
            })),
            loading: false,
            error: null,
        }
    }
}

async function refreshEvaluationRuntimeModels(forceReload = false) {
    ensureEvaluationRuntimeConfigurations()
    await Promise.all(
        Object.values(state.evaluationRuntimeConfigurations).map(async (configuration) => {
            if (!forceReload && configuration.models.length) return
            configuration.loading = true
            configuration.error = null
            try {
                const response = await window.rollingSkill.listModelsForRuntime(
                    configuration.runtime.runtimeId,
                )
                configuration.models = response.data ?? []
            } catch (error) {
                configuration.error = error?.message ?? String(error)
            } finally {
                configuration.loading = false
            }
        }),
    )
}

function renderEvaluationRuntimeConfigurations(skill) {
    ensureEvaluationRuntimeConfigurations()
    elements.evaluationRuntimeList.replaceChildren()
    const configurations = Object.values(state.evaluationRuntimeConfigurations)
    if (!configurations.length) {
        elements.evaluationRuntimeList.append(
            node("div", "sidebar-placeholder", t("noCompatibleRuntime")),
        )
        return
    }
    for (const configuration of configurations) {
        const runtime = configuration.runtime
        const row = node("article", `evaluation-runtime-row${configuration.selected ? " selected" : ""}`)
        row.dataset.evaluationRuntimeId = runtime.runtimeId
        const heading = node("label", "evaluation-runtime-heading")
        const checkbox = document.createElement("input")
        checkbox.type = "checkbox"
        checkbox.checked = configuration.selected
        checkbox.dataset.evaluationRuntimeToggle = runtime.runtimeId
        const title = node("span")
        title.append(
            node("strong", "", `${runtime.displayName} ${runtime.version ?? ""}`.trim()),
            node("small", "", runtime.executablePath),
        )
        heading.append(checkbox, title)
        const controls = node("div", "evaluation-runtime-controls")
        const modelSelect = node("select")
        modelSelect.dataset.evaluationRuntimeModel = runtime.runtimeId
        populateModelSelect(
            modelSelect,
            configuration.modelId,
            t("runtimeDefault"),
            configuration.models,
        )
        const effortSelect = node("select")
        effortSelect.dataset.evaluationRuntimeEffort = runtime.runtimeId
        populateEffortSelect(
            effortSelect,
            configuration.effort,
            configuration.modelId,
            configuration.models,
            runtime.efforts,
        )
        configuration.effort = effortSelect.value || null
        modelSelect.disabled = !configuration.selected || configuration.loading
        effortSelect.disabled = !configuration.selected || configuration.loading
        controls.append(modelSelect, effortSelect)
        const skillPreflight = runtime.capabilities?.includes("skills")
            ? skill
                ? skill.name
                : t("noSkills")
            : t("skillInventoryUnavailable")
        const accessPreflight = runtime.capabilities?.includes("sandbox-policy")
            ? t(
                  state.settings.localAccess === "workspace"
                      ? "workspaceOnlyAccess"
                      : "fullLocalAccess",
              )
            : t("runtimeManagedAccess")
        const preflight = `${skillPreflight} · ${accessPreflight}`
        row.append(heading, controls, node("small", "evaluation-runtime-preflight", preflight))
        if (configuration.error) row.append(node("small", "error", configuration.error))
        elements.evaluationRuntimeList.append(row)
    }
}

function renderEvaluationRuns() {
    elements.evaluationRunCount.textContent = String(state.evaluationRuns.length)
    elements.evaluationRunList.replaceChildren()
    if (!state.evaluationRuns.length) {
        elements.evaluationRunList.append(node("div", "evaluation-empty", t("noRuns")))
    }
    for (const run of state.evaluationRuns) {
        const row = node("article", "evaluation-run-row")
        const button = node("button", "evaluation-run-item")
        button.type = "button"
        button.dataset.evaluationRunId = run.id
        if (run.id === state.activeEvaluationRunId) button.classList.add("active")
        button.append(
            node("span", `run-status ${run.status}`, run.status),
            node("strong", "", run.datasetSnapshot?.name ?? run.datasetId),
            node(
                "small",
                "",
                `${run.caseCount ?? 0} Cases · ${run.runtimeCount ?? 0} runtimes · ${new Date(run.createdAt).toLocaleString(state.settings.language)}`,
            ),
        )
        row.append(button)
        if (run.status !== "queued" && run.status !== "running") {
            const remove = node("button", "hover-delete-button evaluation-run-delete", "×")
            remove.type = "button"
            remove.title = t("deleteEvaluationRun")
            remove.setAttribute("aria-label", t("deleteEvaluationRun"))
            remove.dataset.deleteEvaluationRun = run.id
            row.append(remove)
        }
        elements.evaluationRunList.append(row)
    }
    elements.evaluationRunDetail.replaceChildren()
    const run = state.activeEvaluationRun?.id === state.activeEvaluationRunId
        ? state.activeEvaluationRun
        : null
    if (!run) {
        elements.evaluationRunDetail.append(
            node(
                "div",
                "evaluation-empty",
                state.activeEvaluationRunId ? t("loadingTask") : t("noRuns"),
            ),
        )
        return
    }
    const header = node("header", "evaluation-run-detail-header")
    header.append(
        node("span", `run-status ${run.status}`, run.status),
        node("h2", "", run.datasetSnapshot?.name ?? run.datasetId),
        node("p", "", `${run.skillReference?.name ?? "Skill"} · ${run.activationMode}`),
    )
    const results = node("div", "evaluation-result-list")
    for (const result of run.results ?? []) {
        const card = node("article", "evaluation-result-card")
        const resultHeader = node("div", "evaluation-result-head")
        resultHeader.append(
            node("span", `run-status ${result.status}`, result.status),
            node("strong", "", result.runtimeConfiguration?.displayName ?? result.runtimeId),
            node(
                "small",
                "",
                [
                    result.runtimeConfiguration?.modelId || t("runtimeDefault"),
                    result.runtimeConfiguration?.effort || t("runtimeDefaultEffort"),
                    result.durationMs === null ? null : `${result.durationMs} ms`,
                ].filter(Boolean).join(" · "),
            ),
        )
        card.append(
            resultHeader,
            node("p", "evaluation-result-question", result.caseSnapshot?.question ?? ""),
        )
        if (result.response || result.error) {
            const detail = document.createElement("details")
            detail.append(
                node("summary", "", result.error ? t("failed") : t("completed")),
                node("pre", "", result.error ?? result.response),
            )
            card.append(detail)
        }
        results.append(card)
    }
    elements.evaluationRunDetail.append(header, node("h3", "", t("runResults")), results)
}

function evaluationRunSummary(run) {
    return {
        id: run.id,
        datasetId: run.datasetId,
        datasetSnapshot: run.datasetSnapshot,
        selectionMode: run.selectionMode,
        skillReference: run.skillReference,
        activationMode: run.activationMode,
        status: run.status,
        caseCount: run.caseCount ?? run.caseSnapshots?.length ?? 0,
        runtimeCount: run.runtimeCount ?? run.runtimeConfigurations?.length ?? 0,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
    }
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

async function refreshRuntimeSkills(forceReload = false) {
    const runtimeSkills = state.runtime?.status === "ready"
        ? flattenRuntimeSkills(await window.rollingSkill.listSkills(forceReload))
        : []
    const byPath = new Map(runtimeSkills.map((skill) => [skill.path, skill]))
    for (const caseEntry of state.evaluationCases) {
        const reference = caseEntry.skillReference
        if (!reference?.path || !reference?.name || byPath.has(reference.path)) continue
        byPath.set(reference.path, {
            ...reference,
            enabled: true,
            scope: "dataset",
            interface: {displayName: reference.name},
        })
    }
    state.evaluationSkills = [...byPath.values()]
    return state.evaluationSkills
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
        const previousSkillPath = elements.evaluationSkill.value
        await Promise.all([
            refreshRuntimeSkills(forceReload),
            refreshEvaluationRuntimeModels(forceReload),
        ])
        state.evaluationRuns = await window.rollingSkill.listEvaluationRuns()
        if (!state.evaluationRuns.some((entry) => entry.id === state.activeEvaluationRunId)) {
            state.activeEvaluationRunId = state.evaluationRuns[0]?.id ?? null
        }
        state.activeEvaluationRun = state.activeEvaluationRunId
            ? await window.rollingSkill.getEvaluationRun(state.activeEvaluationRunId)
            : null
        if (previousSkillPath && state.evaluationSkills.some((skill) => skill.path === previousSkillPath)) {
            elements.evaluationSkill.value = previousSkillPath
        }
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

async function selectEvaluationRun(runId) {
    if (!runId || runId === state.activeEvaluationRunId) return
    state.activeEvaluationRunId = runId
    state.activeEvaluationRun = null
    renderEvaluationWorkbench()
    try {
        const run = await window.rollingSkill.getEvaluationRun(runId)
        if (state.activeEvaluationRunId !== runId) return
        state.activeEvaluationRun = run
    } catch (error) {
        if (state.activeEvaluationRunId === runId) {
            state.activeEvaluationRunId = null
            showError(error)
        }
    }
    renderEvaluationWorkbench()
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

function openDeleteCaseDialog(caseId) {
    state.deleteCaseId = caseId
    elements.deleteCaseDialog.showModal()
}

function openDeleteDatasetDialog(datasetId) {
    state.deleteDatasetId = datasetId
    elements.deleteDatasetError.textContent = ""
    elements.deleteDatasetError.classList.add("hidden")
    elements.deleteDatasetDialog.showModal()
}

async function deleteEvaluationDataset() {
    if (!state.deleteDatasetId) return
    elements.confirmDeleteDataset.disabled = true
    try {
        const datasetId = state.deleteDatasetId
        const deleted = await window.rollingSkill.deleteDataset(datasetId)
        if (deleted.settings) applySettings(deleted.settings)
        state.deleteDatasetId = null
        if (state.evaluationDatasetId === datasetId) {
            state.evaluationDatasetId = null
            state.evaluationCaseId = null
        }
        elements.deleteDatasetDialog.close()
        await loadEvaluationWorkbench(false)
        showToast(t("datasetDeleted"))
    } catch (error) {
        const message = error?.message || String(error)
        elements.deleteDatasetError.textContent = /unfinished Curator draft|capture in progress/i.test(message)
            ? t("unfinishedDraftBlocksDatasetDelete")
            : message
        elements.deleteDatasetError.classList.remove("hidden")
    } finally {
        elements.confirmDeleteDataset.disabled = false
    }
}

function openDeleteEvaluationRunDialog(runId) {
    state.deleteEvaluationRunId = runId
    elements.deleteEvaluationRunError.textContent = ""
    elements.deleteEvaluationRunError.classList.add("hidden")
    elements.deleteEvaluationRunDialog.showModal()
}

async function deleteEvaluationRun() {
    if (!state.deleteEvaluationRunId) return
    elements.confirmDeleteEvaluationRun.disabled = true
    try {
        const runId = state.deleteEvaluationRunId
        await window.rollingSkill.deleteEvaluationRun(runId)
        state.deleteEvaluationRunId = null
        if (state.activeEvaluationRunId === runId) state.activeEvaluationRunId = null
        if (state.activeEvaluationRun?.id === runId) state.activeEvaluationRun = null
        elements.deleteEvaluationRunDialog.close()
        await loadEvaluationWorkbench(false)
        showToast(t("evaluationRunDeleted"))
    } catch (error) {
        const message = error?.message || String(error)
        elements.deleteEvaluationRunError.textContent = /active evaluation run/i.test(message)
            ? t("activeRunCannotDelete")
            : message
        elements.deleteEvaluationRunError.classList.remove("hidden")
    } finally {
        elements.confirmDeleteEvaluationRun.disabled = false
    }
}

async function deleteEvaluationCase() {
    if (!state.deleteCaseId || !state.evaluationDatasetId) return
    elements.confirmDeleteCase.disabled = true
    try {
        await window.rollingSkill.deleteCase(state.evaluationDatasetId, state.deleteCaseId)
        state.deleteCaseId = null
        elements.deleteCaseDialog.close()
        await loadEvaluationWorkbench(false)
        showToast(t("caseDeleted"))
    } catch (error) {
        state.deleteCaseId = null
        elements.deleteCaseDialog.close()
        showToast(error?.message || String(error))
    } finally {
        elements.confirmDeleteCase.disabled = false
    }
}

async function toggleArchivedCurations() {
    state.archivedCurationsOpen = !state.archivedCurationsOpen
    elements.archivedCurationList.classList.toggle("hidden", !state.archivedCurationsOpen)
    if (!state.archivedCurationsOpen) return
    elements.archivedCurationList.replaceChildren(
        node("div", "sidebar-placeholder", t("loadingTask")),
    )
    try {
        state.archivedCurations = await window.rollingSkill.listArchivedCurations()
        elements.archivedCurationList.replaceChildren()
        if (!state.archivedCurations.length) {
            elements.archivedCurationList.append(
                node("div", "sidebar-placeholder", t("noArchivedDrafts")),
            )
            return
        }
        for (const session of state.archivedCurations) {
            const card = node("article", "archived-curation-card")
            card.append(
                node("strong", "", session.episode?.originalQuestion ?? t("untitledCase")),
                node(
                    "small",
                    "",
                    `${session.caseType} · ${session.skillReference?.name ?? t("none")} · ${new Date(session.updatedAt).toLocaleString(state.settings.language)}`,
                ),
            )
            elements.archivedCurationList.append(card)
        }
    } catch (error) {
        elements.archivedCurationList.replaceChildren(
            node("div", "sidebar-placeholder", error?.message ?? String(error)),
        )
    }
}

async function startEvaluation(selectionMode) {
    const caseEntry = state.evaluationCases.find((entry) => entry.id === state.evaluationCaseId)
    if (selectionMode === "selected" && !caseEntry) return
    elements.startEvaluation.disabled = true
    elements.startDatasetEvaluation.disabled = true
    try {
        const skill = selectedEvaluationSkill()
        if (!skill) throw new Error(t("noSkills"))
        const runtimeConfigurations = Object.values(state.evaluationRuntimeConfigurations)
            .filter((configuration) => configuration.selected)
            .map((configuration) => ({
                runtimeId: configuration.runtime.runtimeId,
                modelId: configuration.modelId || null,
                effort: configuration.effort || null,
            }))
        if (!runtimeConfigurations.length) throw new Error(t("noCompatibleRuntime"))
        const activationMode = elements.evaluationWorkbench.querySelector(
            'input[name="activation-mode"]:checked',
        )?.value ?? "automatic"
        const run = await window.rollingSkill.startEvaluationRun({
            datasetId: state.evaluationDatasetId,
            caseIds: selectionMode === "selected" ? [caseEntry.id] : [],
            selectionMode,
            activationMode,
            skillReference: {name: skill.name, path: skill.path},
            runtimeConfigurations,
        })
        state.evaluationRuns.unshift(evaluationRunSummary(run))
        state.activeEvaluationRunId = run.id
        state.activeEvaluationRun = run
        state.evaluationView = "runs"
        renderEvaluationWorkbench()
        showToast(t("runQueued"))
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

async function setThreadView(view) {
    if (view !== "current" && view !== "archived") return
    if (view === "archived" && !supportsThreadArchive()) return
    if (view === state.threadView) return
    state.threadView = view
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.newTaskMode = false
    state.loadingThreads = true
    renderAll()
    await refreshThreads(true)
}

async function archiveThread(threadId) {
    const thread = state.threads.find((entry) => entry.id === threadId)
    if (!thread || !supportsThreadArchive()) return
    if (isThreadRunning(thread)) {
        showError(new Error(t("runningThreadCannotArchive")))
        return
    }
    try {
        await window.rollingSkill.archiveThread(threadId)
        if (state.activeThreadId === threadId) {
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
        }
        await refreshThreads(true)
    } catch (error) {
        showError(error)
    }
}

async function unarchiveThread(threadId) {
    if (!threadId || !supportsThreadArchive()) return
    try {
        await window.rollingSkill.unarchiveThread(threadId)
        if (state.activeThreadId === threadId) {
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
        }
        await refreshThreads(true)
    } catch (error) {
        showError(error)
    }
}

async function refreshThreads(selectFirst = false) {
    const runtimeEpoch = state.runtimeEpoch
    const requestedView = state.threadView
    const requestToken = ++state.threadRefreshToken
    if (requestedView === "archived" && !supportsThreadArchive()) {
        state.threads = []
        state.loadingThreads = false
        renderThreads()
        return true
    }
    state.loadingThreads = true
    renderThreads()
    try {
        const response = await window.rollingSkill.listThreads(requestedView === "archived")
        if (
            runtimeEpoch !== state.runtimeEpoch ||
            requestToken !== state.threadRefreshToken ||
            requestedView !== state.threadView
        ) {
            return false
        }
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
        if (
            runtimeEpoch !== state.runtimeEpoch ||
            requestToken !== state.threadRefreshToken ||
            requestedView !== state.threadView
        ) {
            return false
        }
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
    state.activeThreadArchived = state.threadView === "archived"
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
        state.selectedTaskEffort =
            response.thread.effort ?? state.settings.taskProfile?.effort ?? null
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
    const changedView = state.threadView !== "current"
    state.surface = "chat"
    state.threadView = "current"
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.loadingThread = false
    state.newTaskMode = true
    state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
    state.selectedTaskEffort = state.settings.taskProfile?.effort ?? null
    state.error = null
    renderAll()
    if (changedView) void refreshThreads(false)
    elements.composerInput.focus()
}

function resizeComposer() {
    const viewportCap = window.innerHeight * 0.28
    elements.composerInput.style.height = "auto"
    elements.composerInput.style.height = `${Math.min(elements.composerInput.scrollHeight, 220, viewportCap)}px`
    renderComposer()
}

async function submitTurn() {
    const text = elements.composerInput.value.trim()
    if (!text || state.sending || state.activeTurnId || state.activeThreadArchived) return
    state.sending = true
    state.error = null
    renderAll()
    try {
        if (!state.activeThread) {
            const response = await window.rollingSkill.startThread(
                state.selectedTaskModelId,
                state.selectedTaskEffort,
            )
            state.activeThread = response.thread
            state.activeThreadId = response.thread.id
            state.newTaskMode = false
            upsertThreadSummary(response.thread)
        }
        const response = await window.rollingSkill.startTurn(
            state.activeThreadId,
            text,
            state.selectedTaskModelId,
            state.selectedTaskEffort,
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

async function openCaseDialog(turnId, itemId) {
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
    try {
        await refreshRuntimeSkills(true)
    } catch (error) {
        showError(error)
        return
    }
    if (!state.evaluationSkills.length) {
        showError(new Error(t("noSkills")))
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
    populateSkillSelect(
        elements.caseSkill,
        state.evaluationSkillByThread[state.activeThreadId] ?? null,
    )
    renderCaseSkillStatus()
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
    const skill = runtimeSkillByPath(elements.caseSkill.value)
    if (!skill) {
        showError(new Error(t("selectSkill")))
        return
    }
    elements.confirmSaveCase.disabled = true
    elements.caseDialog.close()
    try {
        const session = await window.rollingSkill.createCuration({
            datasetId: elements.caseDataset.value,
            caseType,
            sourceThreadId: state.activeThreadId,
            startItemId: selection.startItemId,
            endItemId: selection.itemId,
            skillPath: skill.path,
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
    if (session.status === "cancelled" || session.status === "archived") {
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

async function updateCurationEffort(sessionId, selectedEffort) {
    try {
        const session = await window.rollingSkill.updateCurationEffort(
            sessionId,
            selectedEffort || null,
        )
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

function handleNotification(message) {
    const {method, params = {}} = message ?? {}
    if (method === "thread/started") {
        if (state.threadView === "current") upsertThreadSummary(params.thread)
    } else if (method === "thread/archived" || method === "thread/unarchived") {
        const threadId = params.threadId ?? params.thread?.id ?? null
        if (threadId && state.activeThreadId === threadId) {
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
            state.activeTurnId = null
            state.newTaskMode = false
        }
        void refreshThreads(false)
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
    state.threadView = "current"
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
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
elements.threadViewSwitch.addEventListener("click", (event) => {
    const button = event.target.closest("[data-thread-view]")
    if (button) void setThreadView(button.dataset.threadView)
})
elements.threadList.addEventListener("click", (event) => {
    const archive = event.target.closest("[data-archive-thread]")
    if (archive) {
        void archiveThread(archive.dataset.archiveThread)
        return
    }
    const unarchive = event.target.closest("[data-unarchive-thread]")
    if (unarchive) {
        void unarchiveThread(unarchive.dataset.unarchiveThread)
        return
    }
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
elements.settingsButton.addEventListener("click", () => void openSettings())
elements.closeSettingsDialog.addEventListener("click", () => elements.settingsDialog.close())
elements.cancelSettings.addEventListener("click", () => elements.settingsDialog.close())
elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveSettings()
})
for (const [modelSelect, effortSelect] of [
    [elements.settingsTaskModel, elements.settingsTaskEffort],
    [elements.settingsCuratorModel, elements.settingsCuratorEffort],
    [elements.settingsAutoCaptureModel, elements.settingsAutoCaptureEffort],
]) {
    modelSelect.addEventListener("change", () => {
        populateEffortSelect(effortSelect, effortSelect.value, modelSelect.value)
    })
}
elements.archivedCurations.addEventListener("click", () => void toggleArchivedCurations())
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
elements.evaluationWorkbench.addEventListener("click", (event) => {
    const view = event.target.closest("[data-evaluation-view]")
    if (!view) return
    state.evaluationView = view.dataset.evaluationView
    renderEvaluationWorkbench()
})
elements.evaluationDatasetList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-evaluation-dataset]")
    if (remove) {
        openDeleteDatasetDialog(remove.dataset.deleteEvaluationDataset)
        return
    }
    const button = event.target.closest("[data-evaluation-dataset-id]")
    if (button) void selectEvaluationDataset(button.dataset.evaluationDatasetId)
})
elements.evaluationCaseList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-evaluation-case]")
    if (remove) {
        openDeleteCaseDialog(remove.dataset.deleteEvaluationCase)
        return
    }
    const button = event.target.closest("[data-evaluation-case-id]")
    if (!button) return
    state.evaluationCaseId = button.dataset.evaluationCaseId
    renderEvaluationWorkbench()
})
elements.evaluationRuntimeList.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-evaluation-runtime-toggle]")
    const model = event.target.closest("[data-evaluation-runtime-model]")
    const effort = event.target.closest("[data-evaluation-runtime-effort]")
    const runtimeId =
        toggle?.dataset.evaluationRuntimeToggle ??
        model?.dataset.evaluationRuntimeModel ??
        effort?.dataset.evaluationRuntimeEffort
    const configuration = state.evaluationRuntimeConfigurations[runtimeId]
    if (!configuration) return
    if (toggle) configuration.selected = toggle.checked
    if (model) configuration.modelId = model.value || null
    if (effort) configuration.effort = effort.value || null
    renderEvaluationWorkbench()
})
elements.evaluationRunList.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-evaluation-run]")
    if (remove) {
        openDeleteEvaluationRunDialog(remove.dataset.deleteEvaluationRun)
        return
    }
    const button = event.target.closest("[data-evaluation-run-id]")
    if (!button) return
    void selectEvaluationRun(button.dataset.evaluationRunId)
})
elements.evaluationCreateDataset.addEventListener("submit", (event) => {
    event.preventDefault()
    void createEvaluationDataset()
})
elements.evaluationSkill.addEventListener("change", renderEvaluationWorkbench)
elements.startEvaluation.addEventListener("click", () => void startEvaluation("selected"))
elements.startDatasetEvaluation.addEventListener("click", () => void startEvaluation("dataset"))
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
elements.composerEffort.addEventListener("change", () => {
    state.selectedTaskEffort = elements.composerEffort.value || null
    renderComposer()
})
elements.stopTurn.addEventListener("click", stopTurn)
elements.conversation.addEventListener("click", (event) => {
    const external = event.target.closest("[data-external-url]")
    if (external) {
        event.preventDefault()
        void window.rollingSkill.openExternal(external.dataset.externalUrl).catch(showError)
        return
    }
    const local = event.target.closest("[data-local-path]")
    if (local) {
        event.preventDefault()
        void window.rollingSkill.openLocalPath(local.dataset.localPath).catch(showError)
        return
    }
    const button = event.target.closest("[data-save-case]")
    if (button) void openCaseDialog(button.dataset.turnId, button.dataset.itemId)
})
elements.closeCaseDialog.addEventListener("click", () => elements.caseDialog.close())
elements.cancelSaveCase.addEventListener("click", () => elements.caseDialog.close())
elements.caseStartItem.addEventListener("change", updateEpisodeStartPreview)
elements.caseSkill.addEventListener("change", renderCaseSkillStatus)
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
    const effort = event.target.closest("[data-curation-effort]")
    if (effort) void updateCurationEffort(effort.dataset.curationEffort, effort.value)
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
elements.closeDeleteCaseDialog.addEventListener("click", () => elements.deleteCaseDialog.close())
elements.cancelDeleteCase.addEventListener("click", () => elements.deleteCaseDialog.close())
elements.confirmDeleteCase.addEventListener("click", () => void deleteEvaluationCase())
elements.closeDeleteDatasetDialog.addEventListener("click", () => elements.deleteDatasetDialog.close())
elements.cancelDeleteDataset.addEventListener("click", () => elements.deleteDatasetDialog.close())
elements.confirmDeleteDataset.addEventListener("click", () => void deleteEvaluationDataset())
elements.closeDeleteEvaluationRunDialog.addEventListener("click", () => elements.deleteEvaluationRunDialog.close())
elements.cancelDeleteEvaluationRun.addEventListener("click", () => elements.deleteEvaluationRunDialog.close())
elements.confirmDeleteEvaluationRun.addEventListener("click", () => void deleteEvaluationRun())

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
window.rollingSkill.onEvaluationChanged(async ({runId, resultId, status}) => {
    if (!runId) return
    try {
        const index = state.evaluationRuns.findIndex((entry) => entry.id === runId)
        if (index < 0) {
            state.evaluationRuns = await window.rollingSkill.listEvaluationRuns()
        } else if (!resultId && status) {
            state.evaluationRuns[index] = {...state.evaluationRuns[index], status}
        }
        if (state.activeEvaluationRunId === runId) {
            state.activeEvaluationRun = await window.rollingSkill.getEvaluationRun(runId)
        }
        renderEvaluationWorkbench()
    } catch {
        // The next explicit refresh will reconcile local run history.
    }
})
window.rollingSkill.onWorkspaceChanged(async ({workspaceRoot}) => {
    state.workspaceRoot = workspaceRoot
    state.threadView = "current"
    state.activeThread = null
    state.activeThreadId = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.newTaskMode = false
    state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
    state.selectedTaskEffort = state.settings.taskProfile?.effort ?? null
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
        state.selectedTaskEffort = state.settings.taskProfile?.effort ?? null
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
