const commandActivity = globalThis.RollingSkillCommandActivity
const {formatEvaluationDuration} = globalThis.RollingSkillEvaluationFormat
const {CaseCalibrationBatch} = globalThis.RollingSkillCalibrationBatch
const {CaseRefreshBatch} = globalThis.RollingSkillRefreshBatch
const UNIFIED_SCORING_MODEL = "unified-100/v1"

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
        externalLinkUnavailable: "Could not open this link.",
        localFileUnavailable: "Could not open this file. It may have been moved or deleted.",
        settings: "Settings",
        datasets: "Datasets",
        trace: "Trace",
        runtime: "Runtime…",
        caseDrafts: "Case drafts",
        rawCases: "Raw Cases",
        rawCaseInbox: "RAW CASE INBOX",
        rawCaseQuestion: "Question",
        rawCaseSkillPlaceholder: "Skill name",
        rawCaseQuestionPlaceholder: "Save an unverified question…",
        rawCaseNotePlaceholder: "Why keep this case?",
        noteOptional: "Note · optional",
        addToInbox: "Add to inbox",
        saveChanges: "Save changes",
        rawCaseEmpty: "No pending questions. Add one here or through the external Tool.",
        rawCaseNewTask: "Run in new task",
        rawCaseCurrentTask: "Run here",
        rawCaseEdit: "Edit",
        rawCaseDelete: "Delete",
        rawCaseDuplicate: "This question is already pending for the same Skill.",
        rawCaseDraftStatus: "Case draft",
        rawCaseArchivedStatus: "Saved Case",
        rawCaseDetectedSkill: "Detected Skill: {name}",
        rawCaseOutcomeResolved: "Resolved",
        rawCaseOutcomeUnresolved: "Unresolved",
        rawCaseOutcomeUncertain: "Uncertain",
        rawCaseConfidence: "Confidence {value}%",
        rawCaseSourceTime: "Detected {time}",
        rawCaseSourceRuntime: "Source Runtime: {runtime}",
        createCaseDraft: "Create Case Draft",
        rawCaseChooseDataset: "Target dataset",
        rawCaseCreateDraftConfirm: "Create draft",
        rawCaseCreatingDraft: "Creating…",
        rawCaseSourceRuntimeMismatch: "Switch to source Runtime {runtime} to create this Draft.",
        rawCaseNoCompatibleDataset: "No matching dataset has a published rubric for this Skill.",
        rawCaseEpisodeIncomplete: "This candidate has incomplete source boundaries and cannot create a Draft.",
        rawCaseDraftCreateFailed: "Could not create the Draft: {message}",
        curateAgain: "Curate again",
        skill: "Skill",
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
        rubricModel: "Default Rubric Agent model",
        judgeModel: "Default Judge model",
        automaticCapture: "Automatic capture",
        automaticCaptureHelp: "Scan new conversations on a daily or weekly schedule. Scheduled mode keeps candidates in Raw Cases; fully automatic mode saves only candidates that pass every gate.",
        captureMode: "Mode",
        autoCaptureModeOff: "Off",
        autoCaptureScheduled: "Scheduled · keep in Raw Cases",
        autoCaptureAutomatic: "Fully automatic · save gated Cases",
        captureModel: "Analysis model",
        captureCadence: "Cadence",
        captureDaily: "Daily",
        captureWeekly: "Weekly",
        captureTime: "Local time",
        captureWeekday: "Weekday",
        weekdayMonday: "Monday",
        weekdayTuesday: "Tuesday",
        weekdayWednesday: "Wednesday",
        weekdayThursday: "Thursday",
        weekdayFriday: "Friday",
        weekdaySaturday: "Saturday",
        weekdaySunday: "Sunday",
        preferredDataset: "Preferred dataset",
        preferredDatasetHelp: "Used only when its Skill matches. Leave automatic routing selected to require one unambiguous dataset.",
        automaticDatasetRouting: "Route automatically",
        selectSkill: "Select an enabled Skill",
        unavailableSkill: "Previously selected Skill is unavailable",
        datasetSkill: "Dataset Skill",
        bindDatasetSkill: "Bind dataset Skill",
        changeSkill: "Change Skill",
        datasetSkillHistoryHelp: "Existing Cases and evaluation runs keep their frozen historical evidence.",
        datasetSkillUnbound: "This dataset has no Skill binding. Bind an enabled runtime Skill before capture or evaluation.",
        datasetSkillStale: "{name} is bound, but its exact name and path are not enabled in the active runtime.",
        datasetSkillReady: "{name} · installed and enabled in {runtime}",
        datasetRubric: "Dataset rubric",
        datasetRubricHelp: "Shared Skill-specific criteria inherited by every Case.",
        manageRubric: "Manage",
        generateRubric: "Generate with Agent",
        editRubric: "Edit with Agent",
        rubricNotPublished: "No rubric has been published for this dataset.",
        rubricPublished: "Published v{version} · {count} criteria",
        rubricDraftRunning: "Rubric Agent is preparing a draft…",
        rubricAgentTask: "RUBRIC AGENT",
        rubricConversation: "Rubric Agent conversation",
        rubricPromptPlaceholder: "Ask why or describe a rubric revision",
        rubricReady: "Rubric draft ready",
        rubricCriteria: "Criteria",
        rubricFailures: "Automatic failures",
        criticalFailure: "Critical failure",
        rubricVersions: "Published versions",
        publishRubric: "Publish rubric",
        rubricPublishedToast: "Dataset rubric published",
        rubricDiscarded: "Rubric draft discarded",
        rubricRequired: "Publish a dataset rubric before capturing Cases or running an evaluation.",
        rubricNeedsUnified: "This rubric uses a retired grading contract. Upgrade its contract without rewriting the rubric or calibrated Cases before evaluation.",
        migrateLegacyRubric: "Upgrade contract",
        legacyRubricMigrated: "Scoring contract upgraded; rubric content and calibrated Cases were preserved",
        caseNeedsCalibration: "Needs calibration for the current rubric",
        casesNeedCalibration: "{count} Cases must be calibrated for rubric v{version} before this dataset can run.",
        calibrateCase: "Calibrate",
        calibrateSelectedCase: "Calibrate selected Case",
        calibrateNextCase: "Calibrate next Case",
        calibrationInProgress: "Calibrating…",
        reviewCalibration: "Review calibration",
        caseCalibration: "Calibration",
        calibrationBaseline: "Current saved summary",
        calibrationStarted: "Case sent to Curator for calibration",
        caseCalibrated: "Case calibrated and previous version preserved",
        doneCalibration: "Done · update case",
        calibrateAllCases: "Auto-calibrate all",
        stopCalibrationBatch: "Stop",
        calibrationBatchProgress: "Auto calibration · {completed}/{total} saved",
        calibrationBatchSaving: "Valid draft ready · saving automatically…",
        calibrationBatchComplete: "All Cases were calibrated and saved",
        calibrationBatchStopped: "Automatic calibration stopped",
        calibrationBatchFailed: "Automatic calibration paused: {message}",
        calibrationContextChanged: "The dataset or published rubric changed during automatic calibration.",
        refreshCase: "Refresh Case",
        refreshingCase: "Refreshing…",
        reviewRefresh: "Review refresh",
        caseRefresh: "Case refresh",
        refreshBaseline: "Previous saved Case",
        refreshStarted: "Case refresh started with the current Skill and tools",
        caseRefreshed: "Case updated; the previous version was preserved",
        doneRefresh: "Done · update Case",
        refreshTargetChanged: "The Case changed during refresh. Start again.",
        refreshFailed: "Case refresh failed: {message}",
        refreshCases: "Refresh Cases",
        refreshBatchTitle: "Refresh saved Cases?",
        refreshBatchHelp: "Each selected Case is rerun in order with the current Skill and tools, then saved automatically after the refreshed draft passes validation.",
        refreshScope: "Cases to refresh",
        refreshGoodcaseHelp: "Refresh trusted reference Cases and leave Badcases unchanged.",
        refreshAllHelp: "Refresh both Goodcases and Badcases.",
        refreshBatchSelection: "{count} Cases selected",
        startRefreshBatch: "Start refresh",
        stopRefreshBatch: "Stop",
        refreshBatchProgress: "Batch refresh · {completed}/{total} saved",
        refreshBatchCurrent: "Current: {case}",
        refreshBatchSaving: "Valid draft ready · saving automatically…",
        refreshBatchComplete: "All selected Cases were refreshed and saved",
        refreshBatchStopped: "Automatic Case refresh stopped",
        refreshBatchFailed: "Automatic Case refresh paused: {message}",
        refreshBatchContextChanged: "The dataset or Case changed during automatic refresh.",
        datasetSkillRequired: "Select an enabled Skill for this dataset.",
        autoCaptureDatasetRequired: "Automatic capture requires a Skill-bound dataset that is available in the active runtime.",
        changeDatasetSkillCopy: "Change the Skill bound to “{name}”. Future capture and evaluation use the new binding.",
        destinationDataset: "Destination dataset",
        defaultClassification: "Default classification",
        settingsLocalOnly: "Settings stay on this Mac.",
        cancel: "Cancel",
        save: "Save",
        discardDraft: "Discard this draft?",
        discardDraftHelp: "The Curator task will be stopped and archived. No case will be saved.",
        discard: "Discard",
        autoCaptureOff: "Automatic capture is off",
        autoCaptureRunning: "Scanning new conversations…",
        autoCapturePending: "{count} candidates waiting in Raw Cases",
        autoCaptureNextRun: "Next scan {time}",
        autoCaptureError: "Capture needs attention: {message}",
        autoCaptureLastSuccess: "Last successful scan {time}",
        autoCaptureNeverRun: "No successful scan yet",
        runtimeDefault: "Runtime default",
        sourceOrRuntimeModel: "Source / runtime model",
        model: "Model",
        reasoningEffort: "Reasoning effort",
        runtimeDefaultEffort: "Runtime default effort",
        inheritRuntimeEffort: "Inherit runtime setting",
        actualRuntimeSetting: "Actual this run: {value}",
        requestedRuntimeSetting: "Requested: {value}",
        actualRuntimeUnknown: "actual setting unavailable",
        send: "Send",
        runtimeQuestionTitle: "The runtime needs your input",
        runtimeQuestionCustom: "Other answer (optional)",
        runtimeQuestionSubmit: "Submit answer",
        runtimeQuestionCancel: "Cancel request",
        runtimeQuestionRequired: "Answer every question before submitting.",
        doneSaveCase: "Done · save case",
        done: "Done",
        retry: "Retry",
        selectDraft: "Select a case draft to review it.",
        noDrafts: "No drafts yet. Use Curate case under an assistant response.",
        curatorConversation: "Curator conversation",
        curatorWorking: "Curator is working…",
        curatorStarting: "Starting Curator",
        curatorAnalyzing: "Analyzing the episode and Skill",
        curatorCommand: "Reading local evaluation material",
        curatorTool: "Checking an evaluation tool",
        curatorDrafting: "Writing the reference answer",
        curatorElapsed: "Elapsed {value}",
        curatorLastActive: "last active {value}",
        referenceReady: "Reference answer ready",
        referenceUpdated: "Reference answer updated",
        expandReference: "Expand to review the structured reference",
        badcaseReady: "Badcase analysis ready",
        badcaseUpdated: "Badcase analysis updated",
        expandBadcase: "Expand to review the error analysis and deduction rules",
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
        issueDescription: "Dataset issue · agent answer (optional)",
        issueDescriptionHelp: "Describe what went wrong in the captured agent answer. This does not change the original evaluation question.",
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
        threadLoadFailed: "Task history could not be loaded. Select this task again to retry.",
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
        commandHistoryUnavailable: "Historical command details were not recorded",
        commandInvocations: "{count} calls",
        fileChanges: "file changes",
        planUpdated: "Plan updated",
        subagentActivity: "Subagent activity",
        contextCompacted: "Context compacted",
        activityStatusUnknown: "status unavailable",
        activityHistoryLimited: "Tool and command history may be incomplete because Codex does not always return earlier activity.",
        completed: "completed",
        structuredReference: "Structured reference",
        structuredBadcase: "Badcase error analysis",
        referenceAnswer: "Reference answer",
        recoveryDirection: "Correct recovery direction",
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
        failureMode: "Failure mode",
        firstDivergence: "First divergence",
        loopSummary: "Repeated-error signature",
        expectedRecovery: "Expected recovery",
        deductionRules: "Recurrence deduction rules",
        matchCondition: "Match condition",
        maximumDeduction: "Deduct up to {value} points",
        sourceItems: "Source items",
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
        skillManagement: "Skill management",
        operator: "Self-operation",
        operatorWorkbenchAria: "Operator self-operation",
        operatorWorkbenchTitle: "Run scoped self-operation Jobs",
        operatorWorkbenchHelp: "Configure Runtime and scope for durable local Agent work.",
        operatorJobs: "Jobs",
        operatorNewJob: "New Job",
        operatorScopedSession: "Scoped session",
        operatorStartSelfOperation: "Start self-operation",
        operatorStartHelp: "Choose the Runtime, authority, and scope for this durable Job.",
        operatorEnvironment: "Run environment",
        operatorResources: "Resources and scope",
        operatorTaskType: "Task type",
        operatorJobType: "Operator Job",
        operatorOptimizationType: "Multi-Epoch Skill optimization",
        operatorObjective: "Objective",
        operatorObjectivePlaceholder: "Describe the bounded outcome…",
        operatorRuntime: "Operator Runtime",
        operatorManagedSkillOptional: "Managed Skill · optional",
        operatorDatasetOptional: "Dataset · optional",
        operatorAllowedTargets: "Allowed target Runtimes",
        operatorReleasedBaseline: "Released baseline",
        operatorJudgeRuntime: "Judge Runtime",
        operatorJudgeModel: "Judge model",
        operatorJudgeEffort: "Judge effort",
        operatorAutomatic: "Automatic",
        operatorExplicit: "Explicit",
        operatorEpochBoundary: "Closed-loop boundary",
        operatorMaxEpochs: "Maximum closed-loop Epochs",
        operatorEpochBoundaryHelp: "One Epoch includes improving the Skill, installing the Candidate, running the complete evaluation, and reviewing the result. Agent operations inside the Epoch are unlimited.",
        operatorPatience: "Patience",
        operatorDurationMs: "Duration (ms)",
        operatorTurns: "Operator turns",
        operatorAutomationBoundary: "Automation boundary",
        operatorAutomaticAuthorityHelp: "Normal work inside the selected scope can run, evaluate, publish, and install automatically. Every action remains audited.",
        operatorMaxIterations: "Maximum iterations",
        operatorAllowPermanentDelete: "Allow permanent Dataset or Case deletion",
        operatorIterationLimitReached: "Iteration limit reached ({used}/{limit}). Start a new task to continue with a larger limit.",
        operatorRuntimeTurns: "Runtime turns",
        operatorEvaluations: "Evaluations",
        operatorTargetExecutions: "Target executions",
        operatorJudgeExecutions: "Judge executions",
        operatorTokensOptional: "Tokens · optional",
        operatorReportedCostOptional: "Reported cost · optional",
        operatorStartJob: "Start Operator Job",
        operatorStartOptimization: "Start Optimization",
        operatorStartingOptimization: "Checking and starting…",
        operatorJobTitle: "Operator Job",
        operatorMessageAria: "Operator message",
        operatorMessagePlaceholder: "Message this Operator session…",
        operatorMultiEpochOptimization: "Multi-Epoch Optimization",
        operatorStopWarning: "Stopping cancels queued work, interrupts current work, and restores Runtime Skills.",
        operatorScope: "Scope",
        operatorNoScope: "No scope selected",
        operatorBudget: "Budget",
        operatorNoBudget: "No budget details",
        operatorChildJobs: "Child Jobs",
        operatorArtifacts: "Artifacts",
        operatorApprovalQueue: "Approval queue",
        operatorRuntimeDefault: "Runtime default",
        operatorLoadingModels: "Loading models…",
        operatorNoManagedSkill: "No managed Skill",
        operatorNoDataset: "No Dataset",
        operatorSelectReleasedBaseline: "Select Released baseline",
        operatorNotReported: "not reported",
        operatorNotRequested: "not requested",
        operatorNotPublished: "not published",
        operatorNotRun: "not run",
        operatorPassed: "passed",
        operatorFailed: "failed",
        operatorState: "State {value}",
        operatorBaselineValue: "Baseline {value}",
        operatorDatasetValue: "Dataset {id} @ {revision}",
        operatorRubricValue: "Rubric {id} @ {version}",
        operatorScoreValue: "score {value}",
        operatorPassValue: "pass {value}%",
        operatorNoEpochScore: "No completed Epoch score yet",
        operatorNoInstallationState: "No current installation state",
        operatorEpochValue: "Epoch {value}",
        operatorRegressionsValue: "Regressions {value}",
        operatorStopReason: "Stop reason {value}",
        operatorFinalApproval: "Final approval {value}",
        operatorApprovalCandidate: "Candidate {value}",
        operatorApprovalEvaluation: "Evaluation {score}/100, pass {passRate}, regressions {regressions}",
        operatorApprovalTargets: "Target Runtimes {value}",
        operatorApprovalRisk: "Risk {value}",
        operatorReleasedValue: "Released {value}",
        operatorInstalledArtifact: "Install result {value}",
        operatorInstallImproved: "Install improved version",
        operatorRestoreOriginal: "Restore original version",
        operatorJobValue: "Job {value}",
        operatorDigestUnavailable: "digest unavailable",
        operatorPause: "Pause",
        operatorResume: "Resume",
        operatorStop: "Stop",
        operatorStopAndRestore: "Stop and restore",
        operatorReport: "Report",
        operatorNoJobs: "No Operator Jobs yet",
        operatorNoAdditionalScope: "No additional scope",
        operatorUnlimited: "unlimited",
        operatorNoChildJobs: "No child Jobs",
        operatorArtifactMeta: "{kind} · {bytes} bytes",
        operatorNoArtifacts: "No artifacts",
        operatorUnknownAction: "Unknown action",
        operatorReject: "Reject",
        operatorApproveOnce: "Approve once",
        operatorApproveCurrentJob: "Approve current Job",
        operatorNoApprovals: "No approvals",
        operatorConfigureScopedJob: "Configure a scoped Operator Job",
        operatorRoleUser: "You",
        operatorRoleAssistant: "Operator",
        operatorRoleActivity: "Activity",
        operatorStatusUnknown: "Unknown status",
        operatorStatusQueued: "Queued",
        operatorStatusRunning: "Running",
        operatorStatusWaitingApproval: "Waiting for approval",
        operatorStatusPaused: "Paused",
        operatorStatusSucceeded: "Succeeded",
        operatorStatusFailed: "Failed",
        operatorStatusCancelled: "Cancelled",
        operatorStatusNeedsRecovery: "Needs recovery",
        operatorStatusRestoring: "Restoring",
        operatorStatusPending: "Pending",
        operatorStatusApproved: "Approved",
        operatorStatusRejected: "Rejected",
        operatorStatusExpired: "Expired",
        operatorStatusCompleted: "Completed",
        operatorStatusPreparing: "Preparing",
        operatorStatusInstalling: "Installing",
        operatorStatusEvaluating: "Evaluating",
        operatorStatusEditing: "Editing",
        operatorActionContextRead: "Read current context",
        operatorActionRawCasesRead: "Read Raw Cases",
        operatorActionRawCasesWrite: "Manage Raw Cases",
        operatorActionRuntimeExecute: "Run Runtime tasks",
        operatorActionRuntimesRead: "Read Runtime catalog",
        operatorActionDatasetsRead: "Read datasets",
        operatorActionDatasetsWrite: "Manage datasets",
        operatorActionDatasetsDelete: "Delete datasets",
        operatorActionEvaluationsRead: "Read evaluations",
        operatorActionEvaluationsExecute: "Run evaluations",
        operatorActionSkillsRead: "Read Skills",
        operatorActionSkillsWrite: "Edit Skill workspace",
        operatorActionSkillsRelease: "Release Skill versions",
        operatorActionJobsRead: "Read Jobs",
        operatorActionApprovalsRead: "Read approvals",
        operatorActionCurationWrite: "Create Case drafts",
        operatorActionRubricsPublish: "Publish rubrics",
        operatorActionInstallationsExecute: "Install Skills",
        operatorActionInstallationsRead: "Read installations",
        operatorActionOptimizationsRead: "Read optimization runs",
        operatorActionOptimizationsExecute: "Run optimization",
        operatorScopeSkillIds: "Skills",
        operatorScopeDatasetIds: "Datasets",
        operatorScopeRuntimeIds: "Runtimes",
        operatorScopeRepositoryIds: "Repositories",
        operatorErrorInvalidConfiguration: "The configuration is invalid. Check the required fields and limits.",
        operatorErrorCatalogMismatch: "The selected Skill, Dataset, Runtime, model, or version is no longer available.",
        operatorErrorTelemetryRequired: "This hard budget requires telemetry from every selected Runtime.",
        operatorErrorOptimizationRubric: "The selected Dataset has no published Rubric. Publish one before starting Optimization.",
        operatorErrorOptimizationBaseline: "The selected baseline is not a Released version of this Skill. Select a matching Released version.",
        operatorErrorOptimizationRuntime: "Runtime {runtime} is unavailable. Select an available Runtime.",
        operatorErrorOptimizationRuntimeSelection: "The {role} Runtime is unavailable. Select another Runtime.",
        operatorErrorOptimizationModel: "The {role} model is unavailable for its Runtime. Select another model.",
        operatorErrorOptimizationDatasetBinding: "The selected Dataset belongs to another Skill. Select a matching Dataset.",
        operatorErrorWithDetail: "Operation failed: {message}",
        operatorArtifactDataset: "Dataset {id}",
        operatorArtifactCase: "Case {id}",
        operatorArtifactEvaluation: "Evaluation {id}",
        operatorArtifactCandidate: "Candidate {id}",
        operatorArtifactInstallation: "Installation {id}",
        skillRepositoryWorkbench: "SKILL REPOSITORY WORKBENCH",
        managedSkillRepositories: "Managed Skill repositories",
        managedSkillHelp: "Import editable repositories, review working changes, and release immutable Skill versions.",
        managedRepositories: "Repositories",
        managedVersions: "Versions",
        importFolder: "Import folder",
        importZip: "Import ZIP",
        importGitRepository: "Import local Git",
        cloneGitUrl: "Clone Git URL",
        gitUrl: "Git URL",
        "import": "Import",
        noManagedRepositories: "No managed Skill repositories yet.",
        selectManagedSkill: "Select a Skill to inspect its manifest and versions.",
        repositoryWorkingTree: "Repository working tree",
        revealRepository: "Reveal repository",
        createCandidate: "Create candidate",
        candidateMessage: "Change summary",
        releaseVersion: "Release version",
        deprecateVersion: "Deprecate",
        versionLabel: "Version label",
        managedWorking: "Working",
        managedCandidate: "Candidate",
        managedReleased: "Released",
        managedDeprecated: "Deprecated",
        managedMissing: "Missing",
        managedInvalid: "Invalid",
        managedSkillImported: "Skill repository imported",
        managedCandidateCreated: "Candidate created",
        managedVersionReleased: "Version released",
        managedVersionDeprecated: "Version deprecated",
        noManagedVersions: "No candidate or released versions yet.",
        noWorkingChanges: "The working tree matches the latest candidate.",
        runtimeInstallations: "Runtime installs",
        releasedVersion: "Released version",
        installWithRuntimes: "Install with selected runtimes",
        installationJobs: "Installation jobs",
        noReleasedVersions: "Release a version before installing it.",
        noInstallationJobs: "No installation jobs for this Skill yet.",
        noRuntimeInstallations: "No compatible local runtime was detected.",
        selectRuntimeInstallTarget: "Select at least one Runtime.",
        installationQueued: "Installation jobs queued",
        installationFailedToStart: "Could not start installation jobs",
        installationStatusQueued: "Queued",
        installationStatusRunning: "Running",
        installationStatusAwaitingPermission: "Awaiting permission",
        installationStatusAwaitingConfirmation: "Awaiting confirmation",
        installationStatusVerifying: "Verifying",
        installationStatusSucceeded: "Installed",
        installationStatusFailed: "Failed",
        installationStatusCancelled: "Cancelled",
        installationStatusUnverified: "Unverified",
        installationRuntimeDefault: "Runtime default",
        installationCurrentVersion: "Installed: {version}",
        installationNotVerified: "No verified installation",
        installationRuntimeVerified: "Runtime verified",
        installationFilesystemOnly: "Copied · awaiting Runtime verification",
        installationLastJob: "Last job: {status}",
        installationSession: "Installer session",
        installationResultSummary: "Structured result",
        installationDestination: "Destination",
        installationClassification: "Pre-state",
        installationVerification: "Verification",
        installationNoTimeline: "The installer has not produced completed output yet.",
        installationTool: "Tool · {name}",
        installationCommand: "Command · {command}",
        installationStop: "Stop installation",
        installationStopped: "Installation stop requested",
        inspectInstallation: "Inspect read-only",
        inspectionQueued: "Read-only inspection queued",
        installerConversationRunning: "Agent running",
        installerMessagePlaceholder: "Ask the installer Agent…",
        sendInstallerMessage: "Send",
        installationQuestionTitle: "Installer needs your input",
        installationOpenAfterRelease: "Version released. Open Runtime installs to deploy it.",
        openRuntimeInstallations: "Open Runtime installs",
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
        evaluationLaunchHelp: "Selected runtimes execute in parallel. The independent Judge applies the published Skill rubric and computes one unified 100-point score.",
        judgeConfiguration: "Independent Judge",
        judgeConfigurationHelp: "This runtime reads the saved answer and Trace evidence only; it does not execute the tested Case.",
        judgeRuntime: "Judge runtime",
        executionStatus: "Execution",
        gradingStatus: "Grading",
        gradingQueued: "Waiting to grade",
        gradingAwaitingExecution: "Waiting for execution result",
        gradingRunning: "Judge is grading",
        gradingCompleted: "Grading completed",
        gradingFailed: "Grading failed",
        gradingSkipped: "Grading skipped",
        legacyUngraded: "Legacy record · no grading data",
        legacySplitGrading: "Legacy score record",
        legacySplitGradingHelp: "Historical grading format · shown as one archived total for reference and not directly comparable with the current unified rubric.",
        executionQueued: "Execution queued",
        executionRunning: "Executing",
        executionCompleted: "Execution completed",
        executionPartial: "Execution partially completed",
        executionFailed: "Execution failed",
        executionCancelled: "Execution cancelled",
        qualityPassed: "Passed",
        qualityUsable: "Usable · improve",
        qualityFailed: "Not passed",
        qualityIndeterminate: "Indeterminate",
        qualityPending: "Pending grading",
        qualityGradingFailed: "Grading failed",
        qualityCancelled: "Stopped before grading",
        qualityDiagnostic: "Diagnostic",
        skillBindingDiagnostic: "Diagnostic only: this runtime could not bind execution to the frozen Skill path, so no formal total or pass verdict is produced.",
        skillBindingTraceVerified: "Formal binding recovered from Trace: the executed Skill content exactly matches the frozen version.",
        skillBindingStatus: "Skill binding · runtime declaration: {declared} · Trace execution: {observed} · effective: {effective}",
        bindingVerified: "verified",
        bindingUnverified: "unverified",
        bindingVerifiedByTrace: "verified by Trace",
        bindingMatched: "exact content match",
        bindingMismatched: "content mismatch",
        bindingNameOnly: "name only",
        bindingNotObserved: "not observed",
        outcomeFormalPass: "Formal pass",
        outcomeUsable: "Usable · needs improvement",
        outcomeFail: "Failed",
        outcomeDiagnostic: "Diagnostic only",
        judgeModelsLoading: "Loading Judge model catalog…",
        judgeModelsReady: "Judge model catalog ready",
        judgeModelsUnavailable: "Judge model catalog unavailable: {message}",
        totalScore: "Total",
        unifiedRubricScore: "Unified Skill rubric",
        automaticFailureTriggered: "Automatic failure triggered",
        automaticFailureClear: "Not triggered",
        criticalGateTriggered: "Critical failure triggered",
        skillComplianceScore: "A · Generic Skill compliance",
        answerQualityScore: "B · Flexible Skill / Case quality",
        gatePass: "A gate passed",
        gateFail: "A gate failed",
        gateIndeterminate: "A gate indeterminate",
        diagnosticOnly: "Diagnostic only",
        judgeDetails: "Judge and grading details",
        scoreReason: "Reason",
        scoreEvidence: "Evidence",
        confidence: "Confidence",
        verificationStatus: "Verification",
        verifiableFields: "Verifiable fields",
        crossChecks: "Cross-checks",
        penaltyApplied: "Deduction {value}/{maximum}",
        avoidanceRating: "error avoidance {value}/10",
        notObservable: "Not observable",
        notApplicable: "Not applicable",
        aSkillActivation: "Skill activation",
        aRequiredReferences: "Required references",
        aToolPolicy: "Tool and CLI policy",
        aWorkflowOrder: "Workflow order",
        aCompletenessArtifacts: "Pagination, completeness, and artifacts",
        aDeterministicProcessing: "Deterministic processing",
        aEvidenceOutput: "Evidence and output specification",
        aErrorRecovery: "Error recovery",
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
        exportCsv: "Export CSV",
        exportDataset: "Export dataset",
        exportCaseScope: "Cases to export",
        allCases: "All Cases",
        goodCasesOnly: "Good Cases only",
        exportOutputMode: "Output column",
        curatedReferenceOutput: "Curated reference answer",
        originalAssistantOutput: "Original final Assistant answer",
        originalAssistantOutputHelp: "Original output keeps only the last Assistant answer in the frozen Case episode; intermediate messages and tool output are excluded.",
        datasetExported: "Exported {count} Cases to CSV",
        datasetExportedMissingOriginal: "Exported {count} Cases; {missing} had no archived original answer and use an empty output array.",
        noRuns: "No evaluation runs yet.",
        runQueued: "Evaluation run queued",
        runResults: "Case × runtime results",
        deleteCase: "Delete Case?",
        deleteCaseHelp: "The Case will be removed from the dataset. Existing run snapshots stay available.",
        deleteDataset: "Delete dataset?",
        deleteDatasetHelp: "All Cases and finished draft records in this dataset will be removed. Unfinished drafts block deletion; evaluation records keep their snapshots.",
        recoverDeleteQuestions: "Preserve questions in Raw Cases",
        recoverDeleteCaseHelp: "Only the question, Skill, type, and source are preserved. The answer is not copied.",
        recoverDeleteDatasetCount: "{count} questions will be preserved. Answers are not copied.",
        deleteRecoveryFailed: "Questions could not be preserved, so nothing was deleted. {message}",
        deleteEvaluationRun: "Delete evaluation record?",
        deleteEvaluationRunHelp: "This saved run, its results, and embedded snapshots will be permanently removed. Trace files are not deleted.",
        cancelEvaluationRun: "Stop evaluation?",
        cancelEvaluationRunHelp: "Running target or Judge turns will be interrupted and queued Cases will not start. Completed answers and Trace evidence stay in this record.",
        stopEvaluation: "Stop evaluation",
        keepRunning: "Keep running",
        evaluationRunCancelled: "Evaluation stopped",
        evaluationRunNotActive: "This evaluation is no longer active.",
        delete: "Delete",
        caseDeleted: "Case deleted",
        caseDeletedWithRecovery: "Case deleted and its question was preserved in Raw Cases",
        datasetDeleted: "Dataset deleted",
        datasetDeletedWithRecovery: "Dataset deleted and {count} questions were preserved in Raw Cases",
        evaluationRunDeleted: "Evaluation record deleted",
        unfinishedDraftBlocksDatasetDelete: "Finish or discard the dataset's active Case drafts before deleting it.",
        activeRunCannotDelete: "Wait for this evaluation run to finish before deleting it.",
        archivedDrafts: "Archived Case drafts",
        noArchivedDrafts: "No archived Case drafts.",
        skillInventoryUnavailable: "Skill inventory is unavailable for this runtime",
        localRuntimeAndData: "Local runtime & data",
        localRuntimeAndDataHelp: "Runtime discovery, raw trace, and the local evaluation store stay on this Mac.",
        localAccess: "Codex new conversation default",
        fullLocalAccess: "Full local access",
        workspaceOnlyAccess: "Workspace only",
        readOnlyAccess: "Read only",
        codebuddyAutoAccess: "Auto review",
        codebuddyAskAccess: "Ask when needed",
        codebuddyAcceptEditsAccess: "Accept edits",
        codebuddyPlanAccess: "Plan mode",
        codebuddyDontAskAccess: "Don't ask · deny unapproved",
        codebuddyBypassAccess: "Bypass prompts · dangerous actions may still ask",
        localAccessHelp: "Default permission for new Codex conversations. Each conversation can override it from the task composer.",
        localAccessUnsupported: "CodeBuddy permissions are selected per conversation in the task composer. Its separate shell sandbox remains runtime-managed.",
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
        externalLinkUnavailable: "无法打开这个链接。",
        localFileUnavailable: "无法打开这个文件，它可能已被移动或删除。",
        settings: "设置",
        datasets: "数据集",
        trace: "Trace",
        runtime: "运行时…",
        caseDrafts: "Case 草稿",
        rawCases: "Raw Cases",
        rawCaseInbox: "RAW CASE 收件箱",
        rawCaseQuestion: "待验证问题",
        rawCaseSkillPlaceholder: "Skill 名称",
        rawCaseQuestionPlaceholder: "先存一个还没来得及验证的问题…",
        rawCaseNotePlaceholder: "为什么先保留这个 Case？",
        noteOptional: "备注 · 可选",
        addToInbox: "加入队列",
        saveChanges: "保存修改",
        rawCaseEmpty: "暂时没有待验证问题。可以在这里添加，也可以让外部 Agent 通过 Tool 填入。",
        rawCaseNewTask: "新会话执行",
        rawCaseCurrentTask: "当前会话执行",
        rawCaseEdit: "编辑",
        rawCaseDelete: "删除",
        rawCaseDuplicate: "同一个 Skill 下已经有这条待验证问题。",
        rawCaseDraftStatus: "Case 草稿",
        rawCaseArchivedStatus: "已沉淀 Case",
        rawCaseDetectedSkill: "识别到 Skill：{name}",
        rawCaseOutcomeResolved: "已解决",
        rawCaseOutcomeUnresolved: "未解决",
        rawCaseOutcomeUncertain: "不确定",
        rawCaseConfidence: "置信度 {value}%",
        rawCaseSourceTime: "识别于 {time}",
        rawCaseSourceRuntime: "来源运行时：{runtime}",
        createCaseDraft: "创建 Case 草稿",
        rawCaseChooseDataset: "目标数据集",
        rawCaseCreateDraftConfirm: "创建草稿",
        rawCaseCreatingDraft: "正在创建…",
        rawCaseSourceRuntimeMismatch: "请切换到来源运行时 {runtime} 后再创建草稿。",
        rawCaseNoCompatibleDataset: "没有为该 Skill 匹配到已发布评分标准的数据集。",
        rawCaseEpisodeIncomplete: "该候选缺少完整的来源边界，无法创建草稿。",
        rawCaseDraftCreateFailed: "无法创建草稿：{message}",
        curateAgain: "再次整理",
        skill: "Skill",
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
        rubricModel: "Rubric Agent 默认模型",
        judgeModel: "Judge 默认模型",
        automaticCapture: "自动沉淀",
        automaticCaptureHelp: "每天或每周定时扫描新对话。定时发现只保留到 Raw Case；完全自动仅保存通过全部闸门的候选。",
        captureMode: "模式",
        autoCaptureModeOff: "关闭",
        autoCaptureScheduled: "定时发现 · 保留到 Raw Case",
        autoCaptureAutomatic: "完全自动 · 仅保存通过闸门的 Case",
        captureModel: "分析模型",
        captureCadence: "频率",
        captureDaily: "每天",
        captureWeekly: "每周",
        captureTime: "本地时间",
        captureWeekday: "星期",
        weekdayMonday: "星期一",
        weekdayTuesday: "星期二",
        weekdayWednesday: "星期三",
        weekdayThursday: "星期四",
        weekdayFriday: "星期五",
        weekdaySaturday: "星期六",
        weekdaySunday: "星期日",
        preferredDataset: "首选数据集",
        preferredDatasetHelp: "仅在 Skill 匹配时使用；选择自动路由时，必须只有一个无歧义数据集才会自动保存。",
        automaticDatasetRouting: "自动路由",
        selectSkill: "请选择一个已启用的 Skill",
        unavailableSkill: "之前选择的 Skill 当前不可用",
        datasetSkill: "数据集绑定的 Skill",
        bindDatasetSkill: "绑定数据集 Skill",
        changeSkill: "更换 Skill",
        datasetSkillHistoryHelp: "已有 Case 和评测记录会继续保留各自冻结的历史证据，不会被改写。",
        datasetSkillUnbound: "这个数据集尚未绑定 Skill；沉淀或评测前请绑定当前运行时中已启用的 Skill。",
        datasetSkillStale: "已绑定 {name}，但当前运行时没有启用名称与路径完全一致的 Skill。",
        datasetSkillReady: "{name} · 已安装并在 {runtime} 中启用",
        datasetRubric: "数据集评分标准",
        datasetRubricHelp: "由 Skill 派生，并被该数据集的所有 Case 继承。",
        manageRubric: "管理标准",
        generateRubric: "让 Agent 生成",
        editRubric: "让 Agent 编辑",
        rubricNotPublished: "该数据集还没有已发布的评分标准。",
        rubricPublished: "已发布 v{version} · {count} 个评分项",
        rubricDraftRunning: "Rubric Agent 正在整理评分标准…",
        rubricAgentTask: "RUBRIC AGENT",
        rubricConversation: "Rubric Agent 会话",
        rubricPromptPlaceholder: "询问原因，或用自然语言要求修改标准",
        rubricReady: "评分标准草稿已就绪",
        rubricCriteria: "评分项",
        rubricFailures: "自动失败条件",
        criticalFailure: "关键失败项",
        rubricVersions: "已发布版本",
        publishRubric: "发布评分标准",
        rubricPublishedToast: "数据集评分标准已发布",
        rubricDiscarded: "评分标准草稿已丢弃",
        rubricRequired: "请先发布数据集评分标准，再沉淀 Case 或启动评测。",
        rubricNeedsUnified: "当前标准仍使用已停用的旧评分契约。请先原样升级契约；评分内容和已校准 Case 不会被改写。",
        migrateLegacyRubric: "原样升级契约",
        legacyRubricMigrated: "评分契约已升级；评分内容和已校准 Case 保持不变",
        caseNeedsCalibration: "需要按当前评分标准校准",
        casesNeedCalibration: "还有 {count} 个 Case 需要按评分标准 v{version} 校准，完成后才能运行整个数据集。",
        calibrateCase: "校准",
        calibrateSelectedCase: "校准选中 Case",
        calibrateNextCase: "校准下一个 Case",
        calibrationInProgress: "校准中…",
        reviewCalibration: "查看校准",
        caseCalibration: "Case 校准",
        calibrationBaseline: "当前已保存总结",
        calibrationStarted: "Case 已交给 Curator 校准",
        caseCalibrated: "Case 已完成校准，旧版本已保留",
        doneCalibration: "完成并更新 Case",
        calibrateAllCases: "全部自动校准",
        stopCalibrationBatch: "停止",
        calibrationBatchProgress: "批量自动校准 · 已保存 {completed}/{total}",
        calibrationBatchSaving: "草稿校验通过 · 正在自动保存…",
        calibrationBatchComplete: "全部 Case 已校准并自动保存",
        calibrationBatchStopped: "已停止批量自动校准",
        calibrationBatchFailed: "批量自动校准已暂停：{message}",
        calibrationContextChanged: "自动校准期间数据集或已发布评分标准发生了变化。",
        refreshCase: "更新 Case",
        refreshingCase: "更新中…",
        reviewRefresh: "查看更新",
        caseRefresh: "Case 更新",
        refreshBaseline: "更新前保存的 Case",
        refreshStarted: "已使用当前 Skill 和工具开始更新 Case",
        caseRefreshed: "Case 已更新，旧版本已保留",
        doneRefresh: "完成并更新 Case",
        refreshTargetChanged: "更新期间 Case 已发生变化，请重新开始。",
        refreshFailed: "Case 更新失败：{message}",
        refreshCases: "批量更新 Case",
        refreshBatchTitle: "更新已保存的 Case？",
        refreshBatchHelp: "所选 Case 会按顺序使用当前 Skill 和工具重新执行；更新草稿校验通过后将自动保存。",
        refreshScope: "要更新的 Case",
        refreshGoodcaseHelp: "只更新可信参考 Case，Badcase 保持不变。",
        refreshAllHelp: "同时更新 Goodcase 和 Badcase。",
        refreshBatchSelection: "已选择 {count} 个 Case",
        startRefreshBatch: "开始更新",
        stopRefreshBatch: "停止",
        refreshBatchProgress: "批量更新 · 已保存 {completed}/{total}",
        refreshBatchCurrent: "当前：{case}",
        refreshBatchSaving: "草稿校验通过 · 正在自动保存…",
        refreshBatchComplete: "所选 Case 已全部更新并保存",
        refreshBatchStopped: "已停止批量更新",
        refreshBatchFailed: "批量更新已暂停：{message}",
        refreshBatchContextChanged: "批量更新期间数据集或 Case 已发生变化。",
        datasetSkillRequired: "请为这个数据集选择当前运行时中已启用的 Skill。",
        autoCaptureDatasetRequired: "自动沉淀必须选择一个已绑定 Skill 且该 Skill 在当前运行时可用的数据集。",
        changeDatasetSkillCopy: "更换数据集“{name}”绑定的 Skill；之后的新沉淀和评测会使用新绑定。",
        destinationDataset: "目标数据集",
        defaultClassification: "默认分类",
        settingsLocalOnly: "设置仅保存在这台 Mac。",
        cancel: "取消",
        save: "保存",
        discardDraft: "丢弃这个草稿？",
        discardDraftHelp: "Curator 任务会停止并归档，不会保存任何 Case。",
        discard: "丢弃",
        autoCaptureOff: "自动沉淀已关闭",
        autoCaptureRunning: "正在扫描新对话…",
        autoCapturePending: "Raw Case 中有 {count} 个候选待处理",
        autoCaptureNextRun: "下次扫描 {time}",
        autoCaptureError: "自动沉淀需要处理：{message}",
        autoCaptureLastSuccess: "上次成功扫描 {time}",
        autoCaptureNeverRun: "尚未成功扫描",
        runtimeDefault: "运行时默认模型",
        sourceOrRuntimeModel: "沿用来源 / 运行时模型",
        model: "模型",
        reasoningEffort: "推理强度",
        runtimeDefaultEffort: "运行时默认强度",
        inheritRuntimeEffort: "沿用运行时设置",
        actualRuntimeSetting: "本轮实际：{value}",
        requestedRuntimeSetting: "请求：{value}",
        actualRuntimeUnknown: "实际设置未知",
        send: "发送",
        runtimeQuestionTitle: "运行时需要你的确认",
        runtimeQuestionCustom: "其他回答（可选）",
        runtimeQuestionSubmit: "提交回答",
        runtimeQuestionCancel: "取消请求",
        runtimeQuestionRequired: "请先回答全部问题。",
        doneSaveCase: "完成并保存 Case",
        done: "完成",
        retry: "重试",
        selectDraft: "请选择一个 Case 草稿进行审核。",
        noDrafts: "还没有草稿，请在助手回答下方点击 Curate case。",
        curatorConversation: "Curator 对话",
        curatorWorking: "Curator 正在处理…",
        curatorStarting: "正在启动 Curator",
        curatorAnalyzing: "正在分析会话与 Skill",
        curatorCommand: "正在读取本地评测材料",
        curatorTool: "正在检查评测工具",
        curatorDrafting: "正在整理参考答案",
        curatorElapsed: "已用时 {value}",
        curatorLastActive: "最近活动于 {value}",
        referenceReady: "参考答案已生成",
        referenceUpdated: "参考答案已更新",
        expandReference: "展开查看结构化参考答案",
        badcaseReady: "Bad Case 问题分析已生成",
        badcaseUpdated: "Bad Case 问题分析已更新",
        expandBadcase: "展开查看错误分析和复现扣分规则",
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
        issueDescription: "数据集问题 · Agent 回答中发生的问题（可选）",
        issueDescriptionHelp: "描述这段 Agent 回答发生了什么问题。这里不会改写用户原始问题，也不会成为评测时发送给 Runtime 的问题。",
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
        threadLoadFailed: "无法加载这条任务的历史记录。请再次选择该任务重试。",
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
        commandHistoryUnavailable: "历史命令详情未记录",
        commandInvocations: "{count} 次调用",
        fileChanges: "文件变更",
        planUpdated: "计划已更新",
        subagentActivity: "子 Agent 活动",
        contextCompacted: "上下文已压缩",
        activityStatusUnknown: "状态不可恢复",
        activityHistoryLimited: "Codex 不一定返回较早的工具和命令活动，因此此处历史可能不完整。",
        completed: "已完成",
        structuredReference: "结构化参考结果",
        structuredBadcase: "Bad Case 错误分析",
        referenceAnswer: "参考答案",
        recoveryDirection: "正确恢复方向",
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
        failureMode: "错误表现",
        firstDivergence: "首次偏离",
        loopSummary: "重复错误特征",
        expectedRecovery: "预期修正方式",
        deductionRules: "相同错误复现扣分规则",
        matchCondition: "命中条件",
        maximumDeduction: "最多扣 {value} 分",
        sourceItems: "来源记录",
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
        skillManagement: "Skill 管理",
        operator: "自操作",
        operatorWorkbenchAria: "自操作工作台",
        operatorWorkbenchTitle: "运行受控的自操作任务",
        operatorWorkbenchHelp: "为本地 Agent 配置 Runtime 与作用范围，并持续管理任务。",
        operatorJobs: "任务",
        operatorNewJob: "新建任务",
        operatorScopedSession: "受限会话",
        operatorStartSelfOperation: "新建自操作任务",
        operatorStartHelp: "选择 Runtime、权限与作用范围；任务会持久保存。",
        operatorEnvironment: "运行环境",
        operatorResources: "资源与范围",
        operatorTaskType: "任务类型",
        operatorJobType: "通用自操作",
        operatorOptimizationType: "多轮 Skill 优化",
        operatorObjective: "目标",
        operatorObjectivePlaceholder: "描述一个有明确边界的目标…",
        operatorRuntime: "操作 Runtime",
        operatorManagedSkillOptional: "受管 Skill · 可选",
        operatorDatasetOptional: "数据集 · 可选",
        operatorAllowedTargets: "允许操作的目标 Runtime",
        operatorReleasedBaseline: "已发布基线",
        operatorJudgeRuntime: "Judge Runtime",
        operatorJudgeModel: "Judge 模型",
        operatorJudgeEffort: "Judge 推理强度",
        operatorAutomatic: "自动触发",
        operatorExplicit: "显式触发",
        operatorEpochBoundary: "闭环边界",
        operatorMaxEpochs: "最大闭环次数（Epoch）",
        operatorEpochBoundaryHelp: "一个 Epoch 包括改进 Skill、安装候选版本、完整评测和结果复盘；Epoch 内 Agent 操作不限次。",
        operatorPatience: "无提升容忍轮数",
        operatorDurationMs: "最长时间（毫秒）",
        operatorTurns: "操作 Agent 轮次",
        operatorAutomationBoundary: "自动化边界",
        operatorAutomaticAuthorityHelp: "所选范围内的正常操作会自动运行、评测、发布和安装，所有操作仍会保留审计记录。",
        operatorMaxIterations: "最大迭代次数",
        operatorAllowPermanentDelete: "允许永久删除数据集或 Case",
        operatorIterationLimitReached: "已达到迭代上限（{used}/{limit}）。如需更大上限，请新建任务。",
        operatorRuntimeTurns: "Runtime 轮次",
        operatorEvaluations: "评测次数",
        operatorTargetExecutions: "目标执行次数",
        operatorJudgeExecutions: "Judge 执行次数",
        operatorTokensOptional: "Token 上限 · 可选",
        operatorReportedCostOptional: "上报成本上限 · 可选",
        operatorStartJob: "开始自操作任务",
        operatorStartOptimization: "开始优化",
        operatorStartingOptimization: "正在检查并启动…",
        operatorJobTitle: "自操作任务",
        operatorMessageAria: "自操作消息",
        operatorMessagePlaceholder: "向这个自操作会话发送消息…",
        operatorMultiEpochOptimization: "多轮优化",
        operatorStopWarning: "停止会取消排队任务、中断当前任务，并恢复各 Runtime 的 Skill。",
        operatorScope: "作用范围",
        operatorNoScope: "尚未选择作用范围",
        operatorBudget: "预算",
        operatorNoBudget: "暂无预算信息",
        operatorChildJobs: "子任务",
        operatorArtifacts: "产物",
        operatorApprovalQueue: "审批队列",
        operatorRuntimeDefault: "Runtime 默认",
        operatorLoadingModels: "正在加载模型…",
        operatorNoManagedSkill: "不指定受管 Skill",
        operatorNoDataset: "不指定数据集",
        operatorSelectReleasedBaseline: "选择已发布基线",
        operatorNotReported: "未上报",
        operatorNotRequested: "未申请",
        operatorNotPublished: "未发布",
        operatorNotRun: "未执行",
        operatorPassed: "通过",
        operatorFailed: "失败",
        operatorState: "状态 {value}",
        operatorBaselineValue: "基线 {value}",
        operatorDatasetValue: "数据集 {id} · 修订 {revision}",
        operatorRubricValue: "评分标准 {id} · 版本 {version}",
        operatorScoreValue: "得分 {value}",
        operatorPassValue: "通过率 {value}%",
        operatorNoEpochScore: "尚无已完成轮次的分数",
        operatorNoInstallationState: "暂无当前安装状态",
        operatorEpochValue: "当前轮次 {value}",
        operatorRegressionsValue: "回归项 {value}",
        operatorStopReason: "停止原因 {value}",
        operatorFinalApproval: "最终审批 {value}",
        operatorApprovalCandidate: "待安装改进版 {value}",
        operatorApprovalEvaluation: "评测 {score}/100，通过率 {passRate}，退步项 {regressions}",
        operatorApprovalTargets: "将安装到 {value}",
        operatorApprovalRisk: "操作风险 {value}",
        operatorReleasedValue: "已发布版本 {value}",
        operatorInstalledArtifact: "正式安装结果 {value}",
        operatorInstallImproved: "安装改进版",
        operatorRestoreOriginal: "回退原版本",
        operatorJobValue: "任务 {value}",
        operatorDigestUnavailable: "摘要不可用",
        operatorPause: "暂停",
        operatorResume: "继续",
        operatorStop: "停止",
        operatorStopAndRestore: "停止并恢复",
        operatorReport: "查看报告",
        operatorNoJobs: "还没有自操作任务",
        operatorNoAdditionalScope: "没有额外作用范围",
        operatorUnlimited: "不限",
        operatorNoChildJobs: "暂无子任务",
        operatorArtifactMeta: "{kind} · {bytes} 字节",
        operatorNoArtifacts: "暂无产物",
        operatorUnknownAction: "未知操作",
        operatorReject: "拒绝",
        operatorApproveOnce: "批准一次",
        operatorApproveCurrentJob: "批准当前任务的全部待处理项",
        operatorNoApprovals: "暂无审批",
        operatorConfigureScopedJob: "配置一个有明确范围的自操作任务",
        operatorRoleUser: "你",
        operatorRoleAssistant: "自操作 Agent",
        operatorRoleActivity: "执行活动",
        operatorStatusUnknown: "未知状态",
        operatorStatusQueued: "排队中",
        operatorStatusRunning: "运行中",
        operatorStatusWaitingApproval: "等待审批",
        operatorStatusPaused: "已暂停",
        operatorStatusSucceeded: "已完成",
        operatorStatusFailed: "失败",
        operatorStatusCancelled: "已取消",
        operatorStatusNeedsRecovery: "需要恢复",
        operatorStatusRestoring: "恢复中",
        operatorStatusPending: "待处理",
        operatorStatusApproved: "已批准",
        operatorStatusRejected: "已拒绝",
        operatorStatusExpired: "已过期",
        operatorStatusCompleted: "已完成",
        operatorStatusPreparing: "准备中",
        operatorStatusInstalling: "安装中",
        operatorStatusEvaluating: "评测中",
        operatorStatusEditing: "修改中",
        operatorActionContextRead: "读取当前上下文",
        operatorActionRawCasesRead: "读取 Raw Case",
        operatorActionRawCasesWrite: "管理 Raw Case",
        operatorActionRuntimeExecute: "运行 Runtime 任务",
        operatorActionRuntimesRead: "读取 Runtime 目录",
        operatorActionDatasetsRead: "读取数据集",
        operatorActionDatasetsWrite: "管理数据集",
        operatorActionDatasetsDelete: "删除数据集",
        operatorActionEvaluationsRead: "读取评测",
        operatorActionEvaluationsExecute: "运行评测",
        operatorActionSkillsRead: "读取 Skill",
        operatorActionSkillsWrite: "修改 Skill 工作区",
        operatorActionSkillsRelease: "发布 Skill 版本",
        operatorActionJobsRead: "读取任务",
        operatorActionApprovalsRead: "读取审批",
        operatorActionCurationWrite: "创建 Case 草稿",
        operatorActionRubricsPublish: "发布评分标准",
        operatorActionInstallationsExecute: "安装 Skill",
        operatorActionInstallationsRead: "读取安装状态",
        operatorActionOptimizationsRead: "读取优化任务",
        operatorActionOptimizationsExecute: "运行优化任务",
        operatorScopeSkillIds: "Skill",
        operatorScopeDatasetIds: "数据集",
        operatorScopeRuntimeIds: "Runtime",
        operatorScopeRepositoryIds: "仓库",
        operatorErrorInvalidConfiguration: "配置无效，请检查必填项和上限。",
        operatorErrorCatalogMismatch: "所选 Skill、数据集、Runtime、模型或版本已不可用。",
        operatorErrorTelemetryRequired: "这个硬预算要求所有已选 Runtime 提供对应遥测。",
        operatorErrorOptimizationRubric: "所选数据集尚未发布评分标准，请先发布后再开始优化。",
        operatorErrorOptimizationBaseline: "所选基线不是这个 Skill 的已发布版本，请重新选择。",
        operatorErrorOptimizationRuntime: "Runtime {runtime} 当前不可用，请重新选择。",
        operatorErrorOptimizationRuntimeSelection: "{role} Runtime 当前不可用，请重新选择。",
        operatorErrorOptimizationModel: "{role} 模型在对应 Runtime 中不可用，请重新选择。",
        operatorErrorOptimizationDatasetBinding: "所选数据集属于另一个 Skill，请选择与当前 Skill 匹配的数据集。",
        operatorErrorWithDetail: "操作失败：{message}",
        operatorArtifactDataset: "数据集 {id}",
        operatorArtifactCase: "Case {id}",
        operatorArtifactEvaluation: "评测 {id}",
        operatorArtifactCandidate: "候选版本 {id}",
        operatorArtifactInstallation: "安装任务 {id}",
        skillRepositoryWorkbench: "SKILL 仓库工作台",
        managedSkillRepositories: "受管 Skill 仓库",
        managedSkillHelp: "导入可编辑仓库、检查工作区变化，并发布不可变的 Skill 版本。",
        managedRepositories: "仓库",
        managedVersions: "版本",
        importFolder: "导入文件夹",
        importZip: "导入 ZIP",
        importGitRepository: "导入本地 Git",
        cloneGitUrl: "克隆 Git 地址",
        gitUrl: "Git 地址",
        "import": "导入",
        noManagedRepositories: "还没有受管 Skill 仓库。",
        selectManagedSkill: "选择一个 Skill 查看清单和版本。",
        repositoryWorkingTree: "仓库工作区",
        revealRepository: "在访达中显示仓库",
        createCandidate: "创建候选版本",
        candidateMessage: "改动摘要",
        releaseVersion: "发布版本",
        deprecateVersion: "弃用",
        versionLabel: "版本标识",
        managedWorking: "工作区",
        managedCandidate: "候选",
        managedReleased: "已发布",
        managedDeprecated: "已弃用",
        managedMissing: "仓库缺失",
        managedInvalid: "Skill 无效",
        managedSkillImported: "Skill 仓库已导入",
        managedCandidateCreated: "候选版本已创建",
        managedVersionReleased: "版本已发布",
        managedVersionDeprecated: "版本已弃用",
        noManagedVersions: "还没有候选或已发布版本。",
        noWorkingChanges: "工作区与最新候选版本一致。",
        runtimeInstallations: "Runtime 安装",
        releasedVersion: "已发布版本",
        installWithRuntimes: "让所选 Runtime 执行安装",
        installationJobs: "安装任务",
        noReleasedVersions: "请先发布一个版本，再执行安装。",
        noInstallationJobs: "这个 Skill 还没有安装任务。",
        noRuntimeInstallations: "没有发现可用的本地 Runtime。",
        selectRuntimeInstallTarget: "请至少选择一个 Runtime。",
        installationQueued: "安装任务已进入队列",
        installationFailedToStart: "无法启动安装任务",
        installationStatusQueued: "排队中",
        installationStatusRunning: "运行中",
        installationStatusAwaitingPermission: "等待权限",
        installationStatusAwaitingConfirmation: "等待确认",
        installationStatusVerifying: "验证中",
        installationStatusSucceeded: "已安装",
        installationStatusFailed: "失败",
        installationStatusCancelled: "已停止",
        installationStatusUnverified: "未验证",
        installationRuntimeDefault: "Runtime 默认",
        installationCurrentVersion: "已安装：{version}",
        installationNotVerified: "尚无可信安装记录",
        installationRuntimeVerified: "Runtime 已验证",
        installationFilesystemOnly: "已复制 · 等待 Runtime 验证",
        installationLastJob: "最近任务：{status}",
        installationSession: "安装 Agent 会话",
        installationResultSummary: "结构化结果",
        installationDestination: "目标目录",
        installationClassification: "安装前状态",
        installationVerification: "验证方式",
        installationNoTimeline: "安装 Agent 还没有产生已完成的输出。",
        installationTool: "工具 · {name}",
        installationCommand: "命令 · {command}",
        installationStop: "停止安装",
        installationStopped: "已请求停止安装",
        inspectInstallation: "只读检查",
        inspectionQueued: "只读检查任务已进入队列",
        installerConversationRunning: "Agent 运行中",
        installerMessagePlaceholder: "追问安装 Agent…",
        sendInstallerMessage: "发送",
        installationQuestionTitle: "安装 Agent 需要你的输入",
        installationOpenAfterRelease: "版本已发布，可前往 Runtime 安装页面部署。",
        openRuntimeInstallations: "打开 Runtime 安装",
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
        evaluationLaunchHelp: "所选运行时会并行执行；独立 Judge 按已发布的 Skill 标准逐项判断，并计算一个统一百分制总分。",
        judgeConfiguration: "独立 Judge",
        judgeConfigurationHelp: "该运行时只读取已保存回答和 Trace 证据进行判分，不执行被测 Case。",
        judgeRuntime: "Judge 运行时",
        executionStatus: "执行状态",
        gradingStatus: "判分状态",
        gradingQueued: "等待判分",
        gradingAwaitingExecution: "等待执行结果",
        gradingRunning: "Judge 判分中",
        gradingCompleted: "判分完成",
        gradingFailed: "判分失败",
        gradingSkipped: "已跳过判分",
        legacyUngraded: "旧评测记录 · 无判分数据",
        legacySplitGrading: "旧版评分记录",
        legacySplitGradingHelp: "历史评分格式 · 仅以归档总分供参考，不能与当前统一评分直接比较。",
        executionQueued: "等待执行",
        executionRunning: "执行中",
        executionCompleted: "执行完成",
        executionPartial: "部分执行完成",
        executionFailed: "执行失败",
        executionCancelled: "执行已取消",
        qualityPassed: "通过",
        qualityUsable: "基本可用 · 待改进",
        qualityFailed: "未通过",
        qualityIndeterminate: "无法判定",
        qualityPending: "待判",
        qualityGradingFailed: "判分失败",
        qualityCancelled: "停止后未判分",
        qualityDiagnostic: "诊断",
        skillBindingDiagnostic: "仅诊断：该 Runtime 无法确认执行的是冻结 Skill 路径，因此不生成正式总分或通过结论。",
        skillBindingTraceVerified: "已由 Trace 补足正式绑定：实际执行的 Skill 正文与冻结版本完全一致。",
        skillBindingStatus: "Skill 绑定 · Runtime 声明：{declared} · Trace 实际执行：{observed} · 最终：{effective}",
        bindingVerified: "已核验",
        bindingUnverified: "未核验",
        bindingVerifiedByTrace: "Trace 已核验",
        bindingMatched: "正文完全匹配",
        bindingMismatched: "正文不匹配",
        bindingNameOnly: "仅名称匹配",
        bindingNotObserved: "未观察到",
        outcomeFormalPass: "正式通过",
        outcomeUsable: "基本可用 · 待改进",
        outcomeFail: "失败",
        outcomeDiagnostic: "仅作诊断",
        judgeModelsLoading: "正在加载 Judge 模型目录…",
        judgeModelsReady: "Judge 模型目录已就绪",
        judgeModelsUnavailable: "Judge 模型目录不可用：{message}",
        totalScore: "总分",
        unifiedRubricScore: "统一 Skill 评分标准",
        automaticFailureTriggered: "已触发自动失败",
        automaticFailureClear: "未触发",
        criticalGateTriggered: "已触发关键失败",
        skillComplianceScore: "A · 通用 Skill 执行合规",
        answerQualityScore: "B · 灵活 Skill / Case 质量",
        gatePass: "A 硬门槛通过",
        gateFail: "A 硬门槛未通过",
        gateIndeterminate: "A 硬门槛无法判定",
        diagnosticOnly: "仅作诊断",
        judgeDetails: "Judge 与评分明细",
        scoreReason: "理由",
        scoreEvidence: "证据",
        confidence: "置信度",
        verificationStatus: "验证状态",
        verifiableFields: "可验证字段",
        crossChecks: "交叉校验",
        penaltyApplied: "已扣 {value}/{maximum} 分",
        avoidanceRating: "错误规避 {value}/10",
        notObservable: "无法观察",
        notApplicable: "不适用",
        aSkillActivation: "Skill 激活",
        aRequiredReferences: "必读 Reference",
        aToolPolicy: "工具与 CLI 策略",
        aWorkflowOrder: "工作流顺序",
        aCompletenessArtifacts: "分页、完整性与落盘",
        aDeterministicProcessing: "确定性处理",
        aEvidenceOutput: "证据与输出规范",
        aErrorRecovery: "错误恢复",
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
        exportCsv: "导出 CSV",
        exportDataset: "导出数据集",
        exportCaseScope: "导出范围",
        allCases: "全部 Case",
        goodCasesOnly: "仅 Good Case",
        exportOutputMode: "Output 列内容",
        curatedReferenceOutput: "Curator 精炼参考答案",
        originalAssistantOutput: "原始最终答案",
        originalAssistantOutputHelp: "原始输出只保留冻结 Case 片段中最后一条 Assistant 答案；中间回复和工具输出不会导出。",
        datasetExported: "已导出 {count} 个 Case 到 CSV",
        datasetExportedMissingOriginal: "已导出 {count} 个 Case；其中 {missing} 个没有可用的归档原始回答，output 使用空数组。",
        noRuns: "还没有评测记录。",
        runQueued: "评测任务已进入队列",
        runResults: "Case × Runtime 结果",
        deleteCase: "删除 Case？",
        deleteCaseHelp: "该 Case 会从数据集中移除；已有评测记录中的快照仍会保留。",
        deleteDataset: "删除数据集？",
        deleteDatasetHelp: "该数据集中的所有 Case 和已结束草稿记录都会被删除；未结束草稿会阻止删除，已有评测记录仍保留快照。",
        recoverDeleteQuestions: "删除前将问题保留到 Raw Case",
        recoverDeleteCaseHelp: "只保留问题、Skill、类型和来源，不复制回答。",
        recoverDeleteDatasetCount: "将保留 {count} 个问题，不复制回答。",
        deleteRecoveryFailed: "问题未能保留，因此没有删除任何内容。{message}",
        deleteEvaluationRun: "删除评测记录？",
        deleteEvaluationRunHelp: "本次评测、结果及内嵌快照会被永久删除；对应的原始 Trace 文件不会删除。",
        cancelEvaluationRun: "停止评测？",
        cancelEvaluationRunHelp: "正在执行的被测任务或 Judge 会被中断，排队中的 Case 不再启动；已经完成的回答和 Trace 会保留在评测记录中。",
        stopEvaluation: "停止评测",
        keepRunning: "继续运行",
        evaluationRunCancelled: "评测已停止",
        evaluationRunNotActive: "这次评测已经不在运行。",
        delete: "删除",
        caseDeleted: "Case 已删除",
        caseDeletedWithRecovery: "Case 已删除，问题已保留到 Raw Case",
        datasetDeleted: "数据集已删除",
        datasetDeletedWithRecovery: "数据集已删除，{count} 个问题已保留到 Raw Case",
        evaluationRunDeleted: "评测记录已删除",
        unfinishedDraftBlocksDatasetDelete: "请先完成或丢弃这个数据集中的活动 Case 草稿，再删除数据集。",
        activeRunCannotDelete: "请等待本次评测结束后再删除这条记录。",
        archivedDrafts: "已归档 Case 草稿",
        noArchivedDrafts: "还没有已归档的 Case 草稿。",
        skillInventoryUnavailable: "该运行时不提供 Skill 清单",
        localRuntimeAndData: "本地运行时与数据",
        localRuntimeAndDataHelp: "运行时发现、原始 Trace 和本地评测数据都保存在这台 Mac。",
        localAccess: "Codex 新会话默认权限",
        fullLocalAccess: "完整本机访问",
        workspaceOnlyAccess: "仅工作目录",
        readOnlyAccess: "只读",
        codebuddyAutoAccess: "自动审核",
        codebuddyAskAccess: "需要时询问",
        codebuddyAcceptEditsAccess: "自动允许编辑",
        codebuddyPlanAccess: "计划模式",
        codebuddyDontAskAccess: "不询问 · 未授权即拒绝",
        codebuddyBypassAccess: "跳过权限提示 · 高危操作仍可能询问",
        localAccessHelp: "这是 Codex 新会话的默认权限；每个会话都可在输入框左下角单独调整。",
        localAccessUnsupported: "CodeBuddy 权限请在输入框左下角按会话选择；它独立的 Shell sandbox 仍由运行时管理。",
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
    threadLoadToken: 0,
    modelRefreshToken: 0,
    activeThreadId: null,
    activeThread: null,
    activeThreadArchived: false,
    activeTurnId: null,
    datasets: [],
    loadingThreads: true,
    loadingThread: false,
    threadLoadFailed: false,
    sending: false,
    newTaskMode: false,
    error: null,
    runtimeErrorDismissed: false,
    runtimeOperationInProgress: false,
    runtimeEpoch: 0,
    activeThreadObservationEpoch: null,
    threadObservationResumePending: false,
    caseSelection: null,
    caseCreationInProgress: false,
    curationSessions: [],
    sourceCurationMarkers: [],
    activeCurationMarkerByItem: new Map(),
    curationActivities: new Map(),
    curationInputDrafts: new Map(),
    curationRevisionCounts: new Map(),
    flashingCurationReferences: new Set(),
    activeCurationId: null,
    curationOpen: false,
    rawCases: [],
    rawCaseOpen: window.innerWidth > 1120,
    rawCaseEditingId: null,
    rawCaseDispatchingIds: new Set(),
    rawCaseDraftChooserId: null,
    rawCaseDraftingIds: new Set(),
    rawCaseDraftErrors: new Map(),
    curatorProfile: {runtimePolicy: "active", modelId: null},
    automaticCaptureStatus: {
        mode: "off",
        nextRunAt: null,
        running: false,
        pendingCount: 0,
        lastSuccessAt: null,
        error: null,
    },
    settings: {
        autoCapture: false,
        language: "zh-CN",
        theme: "codex-light",
        localAccess: "full",
        taskProfile: {runtimePolicy: "active", modelId: null, effort: null},
        curatorProfile: {runtimePolicy: "active", modelId: null, effort: null},
        rubricProfile: {runtimePolicy: "active", modelId: null, effort: null},
        judgeProfile: {runtimePolicy: "active", modelId: null, effort: null},
        autoCaptureProfile: {
            runtimePolicy: "active",
            mode: "off",
            schedule: {cadence: "daily", time: "09:00", weekday: 1},
            modelId: null,
            effort: null,
            datasetId: null,
        },
    },
    models: [],
    selectedTaskModelId: null,
    selectedTaskEffort: null,
    selectedTaskPermissionMode: null,
    pendingRuntimeQuestions: new Map(),
    discardCurationId: null,
    traceOpen: false,
    surface: "chat",
    managedSkills: {repositories: [], skills: [], versions: []},
    activeManagedRepositoryId: null,
    activeManagedSkillId: null,
    managedSkillDetail: null,
    managedSkillLoading: false,
    managedSkillError: null,
    managedSkillMutation: false,
    managedCandidateSkillId: null,
    managedReleaseVersionId: null,
    managedSkillSideView: "versions",
    skillInstallations: {jobs: [], matrix: []},
    managedInstallVersionId: null,
    managedInstallConfigurations: {},
    activeSkillInstallationJobId: null,
    pendingSkillInstallationQuestions: new Map(),
    skillInstallationInputDrafts: new Map(),
    managedInstallationLoading: false,
    managedInstallationStarting: false,
    evaluationCases: [],
    calibrationStartingCaseIds: new Set(),
    calibrationBatch: null,
    refreshStartingCaseIds: new Set(),
    refreshBatch: null,
    evaluationSkills: [],
    evaluationDatasetId: null,
    evaluationCaseId: null,
    evaluationView: "cases",
    evaluationRuns: [],
    evaluationRunDetails: {},
    activeEvaluationRunId: null,
    activeEvaluationRun: null,
    evaluationRuntimeViewByRun: {},
    evaluationRuntimeConfigurations: {},
    evaluationJudgeConfiguration: {runtimeId: null, modelId: null, effort: null},
    evaluationRubricVersion: null,
    evaluationRubricVersions: [],
    rubricSessions: [],
    activeRubricSessionId: null,
    rubricActivities: new Map(),
    rubricInputDrafts: new Map(),
    rubricOpen: false,
    archivedCurations: [],
    archivedCurationsOpen: false,
    deleteCaseId: null,
    deleteDatasetId: null,
    deleteEvaluationRunId: null,
    cancelEvaluationRunId: null,
    evaluationLoading: false,
    evaluationError: null,
    datasetSkillDialogDatasetId: null,
    renderQueued: false,
}

const {
    NEW_TASK_CONVERSATION_ID,
    createThreadViewStateStore,
    keyFor: threadViewStateKey,
} = globalThis.RollingSkillThreadViewState
const threadViewState = createThreadViewStateStore()
const VIEW_BOTTOM_THRESHOLD = 90
let viewScrollFrame = null
let pendingViewScroll = null
let activeViewRestoreKey = null

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
    topbarRawCases: document.querySelector("#topbar-raw-cases"),
    rawCaseCount: document.querySelector("#raw-case-count"),
    rawCasePanel: document.querySelector("#raw-case-panel"),
    closeRawCases: document.querySelector("#close-raw-cases"),
    rawCaseForm: document.querySelector("#raw-case-form"),
    rawCaseSkill: document.querySelector("#raw-case-skill"),
    rawCaseSkillOptions: document.querySelector("#raw-case-skill-options"),
    rawCaseQuestion: document.querySelector("#raw-case-question"),
    rawCaseNote: document.querySelector("#raw-case-note"),
    addRawCase: document.querySelector("#add-raw-case"),
    cancelRawCaseEdit: document.querySelector("#cancel-raw-case-edit"),
    rawCaseList: document.querySelector("#raw-case-list"),
    skillManagementWorkbench: document.querySelector("#skill-management-workbench"),
    operatorWorkbench: document.querySelector("#operator-workbench"),
    managedRepositoryCount: document.querySelector("#managed-repository-count"),
    managedRepositoryList: document.querySelector("#managed-repository-list"),
    managedSkillDetail: document.querySelector("#managed-skill-detail"),
    managedSkillVersions: document.querySelector("#managed-skill-versions"),
    managedSkillSideTabs: document.querySelector("#managed-skill-side-tabs"),
    managedSkillInstallations: document.querySelector("#managed-skill-installations"),
    managedInstallVersion: document.querySelector("#managed-install-version"),
    managedInstallRuntimeList: document.querySelector("#managed-install-runtime-list"),
    startManagedSkillInstallations: document.querySelector("#start-managed-skill-installations"),
    managedInstallJobList: document.querySelector("#managed-install-job-list"),
    managedInstallSession: document.querySelector("#managed-install-session"),
    inspectManagedSkillInstallation: document.querySelector("#inspect-managed-skill-installation"),
    cancelManagedSkillInstallation: document.querySelector("#cancel-managed-skill-installation"),
    managedSkillError: document.querySelector("#managed-skill-error"),
    refreshManagedSkills: document.querySelector("#refresh-managed-skills"),
    managedGitUrlDialog: document.querySelector("#managed-git-url-dialog"),
    managedGitUrlForm: document.querySelector("#managed-git-url-form"),
    managedGitUrl: document.querySelector("#managed-git-url"),
    managedGitUrlError: document.querySelector("#managed-git-url-error"),
    closeManagedGitUrlDialog: document.querySelector("#close-managed-git-url-dialog"),
    cancelManagedGitUrl: document.querySelector("#cancel-managed-git-url"),
    confirmManagedGitUrl: document.querySelector("#confirm-managed-git-url"),
    managedCandidateDialog: document.querySelector("#managed-candidate-dialog"),
    managedCandidateForm: document.querySelector("#managed-candidate-form"),
    managedCandidateMessage: document.querySelector("#managed-candidate-message"),
    managedCandidateError: document.querySelector("#managed-candidate-error"),
    closeManagedCandidateDialog: document.querySelector("#close-managed-candidate-dialog"),
    cancelManagedCandidate: document.querySelector("#cancel-managed-candidate"),
    confirmManagedCandidate: document.querySelector("#confirm-managed-candidate"),
    managedReleaseDialog: document.querySelector("#managed-release-dialog"),
    managedReleaseForm: document.querySelector("#managed-release-form"),
    managedReleaseLabel: document.querySelector("#managed-release-label"),
    managedReleaseError: document.querySelector("#managed-release-error"),
    closeManagedReleaseDialog: document.querySelector("#close-managed-release-dialog"),
    cancelManagedRelease: document.querySelector("#cancel-managed-release"),
    confirmManagedRelease: document.querySelector("#confirm-managed-release"),
    evaluationWorkbench: document.querySelector("#evaluation-workbench"),
    refreshEvaluation: document.querySelector("#refresh-evaluation"),
    evaluationDatasetCount: document.querySelector("#evaluation-dataset-count"),
    evaluationDatasetList: document.querySelector("#evaluation-dataset-list"),
    evaluationCreateDataset: document.querySelector("#evaluation-create-dataset"),
    evaluationNewDatasetName: document.querySelector("#evaluation-new-dataset-name"),
    evaluationNewDatasetSkill: document.querySelector("#evaluation-new-dataset-skill"),
    exportEvaluationDataset: document.querySelector("#export-evaluation-dataset"),
    exportDatasetDialog: document.querySelector("#export-dataset-dialog"),
    exportDatasetForm: document.querySelector("#export-dataset-form"),
    exportCaseScope: document.querySelector("#export-case-scope"),
    exportOutputMode: document.querySelector("#export-output-mode"),
    closeExportDatasetDialog: document.querySelector("#close-export-dataset-dialog"),
    cancelExportDataset: document.querySelector("#cancel-export-dataset"),
    confirmExportDataset: document.querySelector("#confirm-export-dataset"),
    openCaseRefreshBatch: document.querySelector("#open-case-refresh-batch"),
    caseRefreshBatchStatus: document.querySelector("#case-refresh-batch-status"),
    caseRefreshBatchDialog: document.querySelector("#case-refresh-batch-dialog"),
    caseRefreshBatchForm: document.querySelector("#case-refresh-batch-form"),
    caseRefreshBatchCount: document.querySelector("#case-refresh-batch-count"),
    closeCaseRefreshBatchDialog: document.querySelector("#close-case-refresh-batch-dialog"),
    cancelCaseRefreshBatch: document.querySelector("#cancel-case-refresh-batch"),
    confirmCaseRefreshBatch: document.querySelector("#confirm-case-refresh-batch"),
    evaluationCaseCount: document.querySelector("#evaluation-case-count"),
    evaluationCaseList: document.querySelector("#evaluation-case-list"),
    evaluationDatasetSkillStatus: document.querySelector("#evaluation-dataset-skill-status"),
    evaluationDatasetRubricStatus: document.querySelector("#evaluation-dataset-rubric-status"),
    manageDatasetRubric: document.querySelector("#manage-dataset-rubric"),
    changeEvaluationDatasetSkill: document.querySelector("#change-evaluation-dataset-skill"),
    evaluationRuntimeList: document.querySelector("#evaluation-runtime-list"),
    evaluationJudgeRuntime: document.querySelector("#evaluation-judge-runtime"),
    evaluationJudgeModel: document.querySelector("#evaluation-judge-model"),
    evaluationJudgeEffort: document.querySelector("#evaluation-judge-effort"),
    evaluationJudgeModelStatus: document.querySelector("#evaluation-judge-model-status"),
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
    rubricDrawer: document.querySelector("#rubric-drawer"),
    closeRubricDrawer: document.querySelector("#close-rubric-drawer"),
    rubricVersionList: document.querySelector("#rubric-version-list"),
    rubricDetail: document.querySelector("#rubric-detail"),
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
    settingsRubricModel: document.querySelector("#settings-rubric-model"),
    settingsRubricEffort: document.querySelector("#settings-rubric-effort"),
    settingsJudgeModel: document.querySelector("#settings-judge-model"),
    settingsJudgeEffort: document.querySelector("#settings-judge-effort"),
    settingsAutoCaptureMode: document.querySelector("#settings-auto-capture-mode"),
    settingsAutoCaptureSchedule: document.querySelector("#settings-auto-capture-schedule"),
    settingsAutoCaptureCadence: document.querySelector("#settings-auto-capture-cadence"),
    settingsAutoCaptureTime: document.querySelector("#settings-auto-capture-time"),
    settingsAutoCaptureWeekday: document.querySelector("#settings-auto-capture-weekday"),
    settingsAutoCaptureWeekdayField: document.querySelector("#settings-auto-capture-weekday-field"),
    settingsAutoCaptureModel: document.querySelector("#settings-auto-capture-model"),
    settingsAutoCaptureEffort: document.querySelector("#settings-auto-capture-effort"),
    settingsAutoCaptureDataset: document.querySelector("#settings-auto-capture-dataset"),
    settingsAutoCaptureDatasetField: document.querySelector("#settings-auto-capture-dataset-field"),
    settingsAutoCaptureStatus: document.querySelector("#settings-auto-capture-status"),
    settingsAutoCaptureLastSuccess: document.querySelector("#settings-auto-capture-last-success"),
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
    recoverDeletedCaseQuestion: document.querySelector("#recover-deleted-case-question"),
    deleteCaseError: document.querySelector("#delete-case-error"),
    deleteDatasetDialog: document.querySelector("#delete-dataset-dialog"),
    closeDeleteDatasetDialog: document.querySelector("#close-delete-dataset-dialog"),
    cancelDeleteDataset: document.querySelector("#cancel-delete-dataset"),
    confirmDeleteDataset: document.querySelector("#confirm-delete-dataset"),
    recoverDeletedDatasetQuestions: document.querySelector("#recover-deleted-dataset-questions"),
    recoverDeletedDatasetCount: document.querySelector("#recover-deleted-dataset-count"),
    deleteDatasetError: document.querySelector("#delete-dataset-error"),
    deleteEvaluationRunDialog: document.querySelector("#delete-evaluation-run-dialog"),
    closeDeleteEvaluationRunDialog: document.querySelector("#close-delete-evaluation-run-dialog"),
    cancelDeleteEvaluationRun: document.querySelector("#cancel-delete-evaluation-run"),
    confirmDeleteEvaluationRun: document.querySelector("#confirm-delete-evaluation-run"),
    deleteEvaluationRunError: document.querySelector("#delete-evaluation-run-error"),
    cancelEvaluationRunDialog: document.querySelector("#cancel-evaluation-run-dialog"),
    closeCancelEvaluationRunDialog: document.querySelector("#close-cancel-evaluation-run-dialog"),
    dismissCancelEvaluationRun: document.querySelector("#dismiss-cancel-evaluation-run"),
    confirmCancelEvaluationRun: document.querySelector("#confirm-cancel-evaluation-run"),
    cancelEvaluationRunError: document.querySelector("#cancel-evaluation-run-error"),
    caseDialog: document.querySelector("#save-case-dialog"),
    caseForm: document.querySelector("#save-case-form"),
    caseDataset: document.querySelector("#case-dataset"),
    caseDatasetSkillStatus: document.querySelector("#case-dataset-skill-status"),
    changeCaseDatasetSkill: document.querySelector("#change-case-dataset-skill"),
    newDatasetName: document.querySelector("#new-dataset-name"),
    newDatasetSkill: document.querySelector("#new-dataset-skill"),
    createDataset: document.querySelector("#create-dataset"),
    caseStartItem: document.querySelector("#case-start-item"),
    caseIssueDescription: document.querySelector("#case-issue-description"),
    caseScope: document.querySelector("#case-scope"),
    caseEndPreview: document.querySelector("#case-end-preview"),
    caseCreateError: document.querySelector("#case-create-error"),
    closeCaseDialog: document.querySelector("#close-case-dialog"),
    cancelSaveCase: document.querySelector("#cancel-save-case"),
    confirmSaveCase: document.querySelector("#confirm-save-case"),
    datasetSkillDialog: document.querySelector("#dataset-skill-dialog"),
    datasetSkillForm: document.querySelector("#dataset-skill-form"),
    datasetSkillDialogCopy: document.querySelector("#dataset-skill-dialog-copy"),
    datasetSkillSelect: document.querySelector("#dataset-skill-select"),
    closeDatasetSkillDialog: document.querySelector("#close-dataset-skill-dialog"),
    cancelDatasetSkill: document.querySelector("#cancel-dataset-skill"),
    confirmDatasetSkill: document.querySelector("#confirm-dataset-skill"),
    toast: document.querySelector("#toast"),
}

let operatorWorkbench = null

function node(tag, className, text) {
    const element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = text
    return element
}

function messageLink(token) {
    const link = node("a", "message-link", token.label)
    link.href = token.type === "external" ? token.target : "#"
    if (token.type === "external") {
        link.rel = "noreferrer"
        link.dataset.externalUrl = token.target
    } else {
        link.dataset.localPath = token.target
        if (token.line !== null) {
            link.dataset.line = String(token.line)
            link.title = `${token.target}:${token.line}`
        }
    }
    return link
}

function appendSafeMessageText(container, value) {
    const tokens = globalThis.RollingSkillMessageLinks.tokenizeMessageLinks(value, {
        workspaceRoot: state.workspaceRoot,
    })
    for (const token of tokens) {
        if (token.type === "text") container.append(document.createTextNode(token.text))
        else container.append(messageLink(token))
    }
}

function appendSafeMessageMarkdown(container, value) {
    globalThis.RollingSkillMessageMarkdown.appendSafeMessageMarkdown(container, value, {
        marked: globalThis.marked,
        workspaceRoot: state.workspaceRoot,
    })
}

function runtimeViewId(runtime = state.runtime) {
    return runtime?.runtime?.runtimeId || "__runtime_pending__"
}

function threadViewIdentity({
    runtimeId = runtimeViewId(),
    workspaceRoot = state.workspaceRoot || "__workspace_pending__",
    conversationId = state.activeThreadId || NEW_TASK_CONVERSATION_ID,
} = {}) {
    return {runtimeId, workspaceRoot, conversationId}
}

function isConversationNearBottom() {
    return (
        elements.conversationScroll.scrollHeight -
            elements.conversationScroll.scrollTop -
            elements.conversationScroll.clientHeight <
        VIEW_BOTTOM_THRESHOLD
    )
}

function snapshotActiveThreadView(identity = threadViewIdentity()) {
    const loadedConversation =
        !state.loadingThread &&
        (!state.activeThreadId || state.activeThread?.id === state.activeThreadId)
    if (!loadedConversation) {
        threadViewState.updateDraft(identity, elements.composerInput.value)
        return identity
    }
    threadViewState.set(identity, {
        draft: elements.composerInput.value,
        scrollTop: elements.conversationScroll.scrollTop,
        atBottom: isConversationNearBottom(),
    })
    return identity
}

function restoreActiveThreadView({restoreScroll = false, forceBottom = false} = {}) {
    const identity = threadViewIdentity()
    const saved = threadViewState.get(identity)
    elements.composerInput.value = saved?.draft ?? ""
    resizeComposer()
    if (!restoreScroll) return
    const expectedKey = threadViewStateKey(identity)
    activeViewRestoreKey = expectedKey
    requestAnimationFrame(() => {
        if (threadViewStateKey(threadViewIdentity()) !== expectedKey) {
            if (activeViewRestoreKey === expectedKey) activeViewRestoreKey = null
            return
        }
        const scroll = elements.conversationScroll
        if (forceBottom || !saved || saved.atBottom) {
            scroll.scrollTop = scroll.scrollHeight
        } else {
            scroll.scrollTop = Math.min(
                saved.scrollTop,
                Math.max(0, scroll.scrollHeight - scroll.clientHeight),
            )
        }
        threadViewState.updateScroll(identity, scroll.scrollTop, isConversationNearBottom())
        if (activeViewRestoreKey === expectedKey) activeViewRestoreKey = null
    })
}

function queueActiveScrollSnapshot() {
    const identity = threadViewIdentity()
    const identityKey = threadViewStateKey(identity)
    const loadedConversation =
        !state.loadingThread &&
        (!state.activeThreadId || state.activeThread?.id === state.activeThreadId)
    if (!loadedConversation || activeViewRestoreKey === identityKey) return
    pendingViewScroll = {
        identity,
        scrollTop: elements.conversationScroll.scrollTop,
        atBottom: isConversationNearBottom(),
    }
    if (viewScrollFrame !== null) return
    viewScrollFrame = requestAnimationFrame(() => {
        viewScrollFrame = null
        const pending = pendingViewScroll
        pendingViewScroll = null
        if (pending) {
            threadViewState.updateScroll(
                pending.identity,
                pending.scrollTop,
                pending.atBottom,
            )
        }
    })
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
    const signature = JSON.stringify({selected, modelId, efforts, language: state.settings.language})
    if (select.dataset.effortSignature === signature) return
    select.replaceChildren()
    const runtimeDefault = node("option", "", t("inheritRuntimeEffort"))
    runtimeDefault.value = ""
    select.append(runtimeDefault)
    for (const effort of efforts) {
        const option = node("option", "", effort)
        option.value = effort
        select.append(option)
    }
    if (selected && !efforts.includes(selected)) {
        const custom = node("option", "", selected)
        custom.value = selected
        select.append(custom)
    }
    select.value = selected
    select.dataset.effortSignature = signature
}

function formatCaptureDate(value) {
    const date = value ? new Date(value) : null
    if (!date || !Number.isFinite(date.getTime())) return null
    return new Intl.DateTimeFormat(
        state.settings.language === "en" ? "en-US" : "zh-CN",
        {dateStyle: "medium", timeStyle: "short"},
    ).format(date)
}

function captureStatusMessage(status = state.automaticCaptureStatus) {
    if (status.error) return formatMessage("autoCaptureError", {message: status.error})
    if (status.running) return t("autoCaptureRunning")
    if (Number(status.pendingCount) > 0) {
        return formatMessage("autoCapturePending", {count: status.pendingCount})
    }
    const nextRun = formatCaptureDate(status.nextRunAt)
    if (status.mode !== "off" && nextRun) {
        return formatMessage("autoCaptureNextRun", {time: nextRun})
    }
    return t("autoCaptureOff")
}

function renderCaptureStatus() {
    const status = state.automaticCaptureStatus
    const text = captureStatusMessage(status)
    elements.captureStatus.textContent = text
    const note = elements.captureStatus.closest(".capture-note")
    note?.classList.toggle(
        "active",
        status.mode !== "off" || status.running || Number(status.pendingCount) > 0,
    )
    note?.classList.toggle("running", Boolean(status.running))
    note?.classList.toggle("error", Boolean(status.error))
    if (elements.settingsAutoCaptureStatus) {
        elements.settingsAutoCaptureStatus.textContent = text
        const settingsStatus = elements.settingsAutoCaptureStatus.closest(
            ".automatic-capture-status",
        )
        settingsStatus?.classList.toggle("active", status.mode !== "off")
        settingsStatus?.classList.toggle("running", Boolean(status.running))
        settingsStatus?.classList.toggle("error", Boolean(status.error))
    }
    if (elements.settingsAutoCaptureLastSuccess) {
        const lastSuccess = formatCaptureDate(status.lastSuccessAt)
        elements.settingsAutoCaptureLastSuccess.textContent = lastSuccess
            ? formatMessage("autoCaptureLastSuccess", {time: lastSuccess})
            : t("autoCaptureNeverRun")
    }
}

function applySettings(settings) {
    state.settings = {
        ...settings,
        localAccess: settings.localAccess ?? "full",
        taskProfile: {...settings.taskProfile, effort: settings.taskProfile?.effort ?? null},
        curatorProfile: {...settings.curatorProfile, effort: settings.curatorProfile?.effort ?? null},
        rubricProfile: {
            ...(settings.rubricProfile ?? {runtimePolicy: "active", modelId: null}),
            effort: settings.rubricProfile?.effort ?? null,
        },
        judgeProfile: {
            ...(settings.judgeProfile ?? {runtimePolicy: "active", modelId: null}),
            effort: settings.judgeProfile?.effort ?? null,
        },
        autoCaptureProfile: {
            runtimePolicy: "active",
            mode: settings.autoCaptureProfile?.mode ?? (settings.autoCapture ? "scheduled" : "off"),
            schedule: {
                cadence: settings.autoCaptureProfile?.schedule?.cadence ?? "daily",
                time: settings.autoCaptureProfile?.schedule?.time ?? "09:00",
                weekday: settings.autoCaptureProfile?.schedule?.weekday ?? 1,
            },
            modelId: settings.autoCaptureProfile?.modelId ?? null,
            effort: settings.autoCaptureProfile?.effort ?? null,
            datasetId: settings.autoCaptureProfile?.datasetId ?? null,
        },
    }
    state.automaticCaptureStatus = {
        ...state.automaticCaptureStatus,
        mode: state.settings.autoCaptureProfile.mode,
    }
    state.curatorProfile = settings.curatorProfile
    document.documentElement.dataset.theme = settings.theme
    applyLocalization()
    operatorWorkbench?.localize()
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

function configuredTaskProfile() {
    const configuredModelId = state.settings.taskProfile?.modelId ?? null
    const modelAvailable =
        !configuredModelId || state.models.some((model) => modelValue(model) === configuredModelId)
    return {
        modelId: modelAvailable ? configuredModelId : null,
        effort: modelAvailable ? state.settings.taskProfile?.effort ?? null : null,
    }
}

function runtimeSkillByPath(path) {
    return state.evaluationSkills.find((skill) => skill.path === path) ?? null
}

function runtimeSkillSelectionKey(skill) {
    if (!skill) return null
    if (skill.id) return `id:${skill.id}`
    if (skill.path) return `path:${skill.path}`
    if (skill.evidencePrecision === "name-only" && skill.name) {
        return `name-only:${skill.name}`
    }
    return null
}

function runtimeSkillBySelectionKey(key) {
    return state.evaluationSkills.find(
        (skill) => runtimeSkillSelectionKey(skill) === key,
    ) ?? null
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

function populateSkillSelect(select, selectedKey = null, {allowEmpty = true} = {}) {
    select.replaceChildren()
    if (allowEmpty) {
        const empty = node("option", "", t("selectSkill"))
        empty.value = ""
        select.append(empty)
    }
    for (const skill of state.evaluationSkills) {
        const key = runtimeSkillSelectionKey(skill)
        if (!key) continue
        const option = node("option", "", skillDisplayLabel(skill))
        option.value = key
        select.append(option)
    }
    if (selectedKey && runtimeSkillBySelectionKey(selectedKey)) {
        select.value = selectedKey
    } else if (selectedKey) {
        const unavailable = node("option", "", t("unavailableSkill"))
        unavailable.value = selectedKey
        unavailable.disabled = true
        select.append(unavailable)
        select.value = selectedKey
    } else {
        select.value = allowEmpty
            ? ""
            : runtimeSkillSelectionKey(state.evaluationSkills[0]) ?? ""
    }
}

function selectedDataset(datasetId) {
    return state.datasets.find((dataset) => dataset.id === datasetId) ?? null
}

function runtimeSkillForReference(reference) {
    if (!reference?.name) return null
    if (reference.id) {
        const skill = state.evaluationSkills.find((entry) => entry.id === reference.id) ?? null
        return skill?.enabled && skill.name === reference.name ? skill : null
    }
    if (reference.path) {
        const skill = runtimeSkillByPath(reference.path)
        if (skill?.enabled && skill.name === reference.name) return skill
        return null
    }
    const allowsNameOnly = state.runtime?.runtime?.capabilities?.includes("skills-name-only")
    if (
        !allowsNameOnly ||
        reference.evidencePrecision !== "name-only" ||
        reference.providerId !== state.runtime?.runtime?.providerId ||
        reference.runtimeId !== state.runtime?.runtime?.runtimeId ||
        reference.workspaceRoot !== state.workspaceRoot
    ) return null
    return state.evaluationSkills.find((entry) =>
        entry.enabled &&
        !entry.path &&
        entry.evidencePrecision === "name-only" &&
        entry.name === reference.name,
    ) ?? null
}

function skillReferenceFromRuntimeSkill(skill) {
    if (!skill) return null
    const reference = {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: skill.name,
        path: skill.path ?? null,
        scope: skill.scope ?? null,
        description: skill.description ?? skill.interface?.shortDescription ?? null,
        runtimeId: state.runtime?.runtime?.runtimeId ?? null,
        confirmedAt: new Date().toISOString(),
    }
    if (skill.evidencePrecision !== "name-only" || skill.path) return reference
    return {
        ...reference,
        providerId: state.runtime?.runtime?.providerId ?? null,
        workspaceRoot: state.workspaceRoot || null,
        evidencePrecision: "name-only",
    }
}

function renderDatasetSkillStatus(element, dataset) {
    const reference = dataset?.skillReference
    const skill = runtimeSkillForReference(reference)
    element.className = `skill-preflight ${skill ? "ready" : "missing"}`
    if (skill) {
        element.textContent = formatMessage("datasetSkillReady", {
            name: reference.name,
            runtime: state.runtime?.runtime?.displayName ?? t("localRuntime"),
        })
    } else if (reference) {
        element.textContent = formatMessage("datasetSkillStale", {name: reference.name})
    } else {
        element.textContent = t("datasetSkillUnbound")
    }
    return skill
}

function renderCaseDatasetSkillStatus() {
    const dataset = selectedDataset(elements.caseDataset.value)
    const skill = renderDatasetSkillStatus(elements.caseDatasetSkillStatus, dataset)
    elements.changeCaseDatasetSkill.textContent = t(dataset?.skillReference ? "changeSkill" : "bindDatasetSkill")
    elements.changeCaseDatasetSkill.disabled = !dataset
    if (!state.caseCreationInProgress) {
        elements.confirmSaveCase.disabled = !skill || !dataset?.activeRubricVersionId
    }
}

function renderAutomaticCaptureSettingsVisibility() {
    const mode = elements.settingsAutoCaptureMode.value
    const captureOff = mode === "off"
    const weekly = elements.settingsAutoCaptureCadence.value === "weekly"
    elements.settingsAutoCaptureSchedule.classList.toggle("hidden", captureOff)
    for (const control of [
        elements.settingsAutoCaptureCadence,
        elements.settingsAutoCaptureTime,
    ]) control.disabled = captureOff
    elements.settingsAutoCaptureWeekdayField.classList.toggle("hidden", captureOff || !weekly)
    elements.settingsAutoCaptureWeekday.disabled = captureOff || !weekly
    elements.settingsAutoCaptureDatasetField.classList.toggle("hidden", mode !== "automatic")
    elements.settingsAutoCaptureDataset.disabled = mode !== "automatic"
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
        elements.settingsRubricModel,
        settings.rubricProfile?.modelId,
        t("runtimeDefault"),
    )
    populateEffortSelect(
        elements.settingsRubricEffort,
        settings.rubricProfile?.effort,
        settings.rubricProfile?.modelId,
    )
    populateModelSelect(
        elements.settingsJudgeModel,
        settings.judgeProfile?.modelId,
        t("runtimeDefault"),
    )
    populateEffortSelect(
        elements.settingsJudgeEffort,
        settings.judgeProfile?.effort,
        settings.judgeProfile?.modelId,
    )
    populateModelSelect(
        elements.settingsAutoCaptureModel,
        settings.autoCaptureProfile?.modelId,
        t("runtimeDefault"),
    )
    populateEffortSelect(
        elements.settingsAutoCaptureEffort,
        settings.autoCaptureProfile?.effort,
        settings.autoCaptureProfile?.modelId,
    )
    elements.settingsAutoCaptureMode.value = settings.autoCaptureProfile?.mode ?? "off"
    elements.settingsAutoCaptureCadence.value =
        settings.autoCaptureProfile?.schedule?.cadence ?? "daily"
    elements.settingsAutoCaptureTime.value =
        settings.autoCaptureProfile?.schedule?.time ?? "09:00"
    elements.settingsAutoCaptureWeekday.value = String(
        settings.autoCaptureProfile?.schedule?.weekday ?? 1,
    )
    elements.settingsAutoCaptureDataset.replaceChildren()
    const automatic = node("option", "", t("automaticDatasetRouting"))
    automatic.value = ""
    elements.settingsAutoCaptureDataset.append(automatic)
    for (const dataset of state.datasets) {
        const option = node("option", "", dataset.name)
        option.value = dataset.id
        elements.settingsAutoCaptureDataset.append(option)
    }
    elements.settingsAutoCaptureDataset.value =
        settings.autoCaptureProfile?.datasetId ?? ""
    renderAutomaticCaptureSettingsVisibility()
    renderCaptureStatus()
}

function refreshOpenSettingsOptions() {
    if (!elements.settingsDialog.open) return
    const taskModel = elements.settingsTaskModel.value
    const taskEffort = elements.settingsTaskEffort.value
    const curatorModel = elements.settingsCuratorModel.value
    const curatorEffort = elements.settingsCuratorEffort.value
    const rubricModel = elements.settingsRubricModel.value
    const rubricEffort = elements.settingsRubricEffort.value
    const judgeModel = elements.settingsJudgeModel.value
    const judgeEffort = elements.settingsJudgeEffort.value
    const captureModel = elements.settingsAutoCaptureModel.value
    const captureEffort = elements.settingsAutoCaptureEffort.value
    populateModelSelect(elements.settingsTaskModel, taskModel)
    populateEffortSelect(elements.settingsTaskEffort, taskEffort, taskModel)
    populateModelSelect(elements.settingsCuratorModel, curatorModel, t("sourceOrRuntimeModel"))
    populateEffortSelect(elements.settingsCuratorEffort, curatorEffort, curatorModel)
    populateModelSelect(elements.settingsRubricModel, rubricModel)
    populateEffortSelect(elements.settingsRubricEffort, rubricEffort, rubricModel)
    populateModelSelect(elements.settingsJudgeModel, judgeModel)
    populateEffortSelect(elements.settingsJudgeEffort, judgeEffort, judgeModel)
    populateModelSelect(elements.settingsAutoCaptureModel, captureModel)
    populateEffortSelect(elements.settingsAutoCaptureEffort, captureEffort, captureModel)
}

async function openSettings() {
    suspendThreadObservation()
    renderSettingsForm()
    elements.settingsDialog.showModal()
    try {
        await refreshRuntimeSkills(true)
        refreshOpenSettingsOptions()
    } catch (error) {
        showError(error)
    }
}

async function saveSettings() {
    elements.saveSettings.disabled = true
    try {
        const settings = await window.rollingSkill.updateSettings({
            language: elements.settingsLanguage.value,
            theme: elements.settingsTheme.value,
            localAccess: elements.settingsLocalAccess.value,
            taskModelId: elements.settingsTaskModel.value,
            taskEffort: elements.settingsTaskEffort.value,
            curatorModelId: elements.settingsCuratorModel.value,
            curatorEffort: elements.settingsCuratorEffort.value,
            rubricModelId: elements.settingsRubricModel.value,
            rubricEffort: elements.settingsRubricEffort.value,
            judgeModelId: elements.settingsJudgeModel.value,
            judgeEffort: elements.settingsJudgeEffort.value,
            autoCaptureMode: elements.settingsAutoCaptureMode.value,
            autoCaptureCadence: elements.settingsAutoCaptureCadence.value,
            autoCaptureTime: elements.settingsAutoCaptureTime.value,
            autoCaptureWeekday: Number(elements.settingsAutoCaptureWeekday.value),
            autoCaptureModelId: elements.settingsAutoCaptureModel.value,
            autoCaptureEffort: elements.settingsAutoCaptureEffort.value,
            autoCaptureDatasetId: elements.settingsAutoCaptureDataset.value || null,
        })
        applySettings(settings)
        state.evaluationJudgeConfiguration = {
            ...state.evaluationJudgeConfiguration,
            modelId: settings.judgeProfile?.modelId ?? null,
            effort: settings.judgeProfile?.effort ?? null,
        }
        if (state.newTaskMode || !state.activeThread) {
            state.selectedTaskModelId = settings.taskProfile?.modelId ?? null
            state.selectedTaskEffort = settings.taskProfile?.effort ?? null
            state.selectedTaskPermissionMode = defaultPermissionMode()
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
    const runtimeEpoch = state.runtimeEpoch
    const runtimeId = runtimeViewId()
    const requestToken = ++state.modelRefreshToken
    let models
    try {
        const response = await window.rollingSkill.listModels()
        models = response.data ?? []
    } catch {
        models = []
    }
    if (
        runtimeEpoch !== state.runtimeEpoch ||
        runtimeId !== runtimeViewId() ||
        requestToken !== state.modelRefreshToken
    ) {
        return false
    }
    state.models = models
    if (!state.activeThread && !state.loadingThread) {
        const profile = configuredTaskProfile()
        state.selectedTaskModelId = profile.modelId
        state.selectedTaskEffort = profile.effort
        state.selectedTaskPermissionMode ??= defaultPermissionMode()
    }
    renderTaskModelPicker()
    renderEvaluationWorkbench()
    refreshOpenSettingsOptions()
    if (state.curationOpen) renderCurations()
    return true
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

function activeProviderId() {
    return state.runtime?.runtime?.providerId ?? null
}

function permissionModeOptions(providerId = activeProviderId(), availableModes = undefined) {
    if (providerId === "codex") {
        return [
            {value: "full", label: "fullLocalAccess"},
            {value: "workspace", label: "workspaceOnlyAccess"},
            {value: "read-only", label: "readOnlyAccess"},
        ]
    }
    if (providerId === "codebuddy") {
        const options = [
            {value: "auto", label: "codebuddyAutoAccess"},
            {value: "default", label: "codebuddyAskAccess"},
            {value: "acceptEdits", label: "codebuddyAcceptEditsAccess"},
            {value: "plan", label: "codebuddyPlanAccess"},
            {value: "dontAsk", label: "codebuddyDontAskAccess"},
            {value: "bypassPermissions", label: "codebuddyBypassAccess"},
            {value: "fullAccess", label: "fullLocalAccess"},
        ]
        const available = availableModes === undefined
            ? state.activeThread?.availablePermissionModes
            : availableModes
        if (!Array.isArray(available) || !available.length) return options
        const filtered = options.filter((option) => available.includes(option.value))
        const current = state.activeThread?.permissionMode
        if (
            current &&
            available.includes(current) &&
            !filtered.some((option) => option.value === current)
        ) {
            filtered.unshift({value: current, labelText: current, disabled: true})
        }
        return filtered
    }
    if (providerId === "deepseek-harness") {
        return [
            {value: "danger-full-access", label: "fullLocalAccess"},
            {value: "workspace-write", label: "workspaceOnlyAccess"},
            {value: "read-only", label: "readOnlyAccess"},
        ]
    }
    return []
}

function defaultPermissionMode(providerId = activeProviderId()) {
    if (providerId === "codex") {
        return state.settings.localAccess === "workspace" ? "workspace" : "full"
    }
    if (providerId === "codebuddy") return "auto"
    if (providerId === "deepseek-harness") {
        return state.settings.localAccess === "workspace"
            ? "workspace-write"
            : "danger-full-access"
    }
    return null
}

function renderPermissionModePicker() {
    const options = permissionModeOptions()
    const requested = state.selectedTaskPermissionMode
    const runtimeCurrent = state.activeThread?.permissionMode
    const selected = options.some((option) => option.value === requested)
        ? requested
        : options.some((option) => option.value === runtimeCurrent)
          ? runtimeCurrent
          : options.find((option) => !option.disabled)?.value ?? options[0]?.value ?? null
    const signature = JSON.stringify({
        providerId: activeProviderId(),
        language: state.settings.language,
        options,
    })
    if (elements.composerAccess.dataset.permissionSignature !== signature) {
        elements.composerAccess.replaceChildren()
        if (!options.length) {
            const option = node("option", "", t("runtimeManagedAccess"))
            option.value = ""
            elements.composerAccess.append(option)
        } else {
            for (const entry of options) {
                const option = node("option", "", entry.labelText ?? t(entry.label))
                option.value = entry.value
                option.disabled = Boolean(entry.disabled)
                elements.composerAccess.append(option)
            }
        }
        elements.composerAccess.dataset.permissionSignature = signature
    }
    elements.composerAccess.value = selected ?? ""
    state.selectedTaskPermissionMode = elements.composerAccess.value || null
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
    suspendThreadObservation()
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

function rawCaseSkillReference(name) {
    const normalized = String(name ?? "").trim().toLocaleLowerCase("en-US")
    const candidates = [
        ...state.datasets.map((dataset) => dataset.skillReference),
        ...state.evaluationSkills,
        ...state.rawCases.map((rawCase) => rawCase.skill),
    ].filter((skill) =>
        String(skill?.name ?? "").trim().toLocaleLowerCase("en-US") === normalized)
    const ids = new Set(candidates.map((skill) => skill?.id).filter(Boolean))
    const reference = {name: String(name ?? "").trim()}
    if (ids.size === 1) {
        const [id] = ids
        if (candidates.every((skill) => skill?.id === id)) reference.id = id
    }
    return reference
}

function suggestedRawCaseSkill() {
    return (
        state.datasets.find((dataset) => dataset.skillReference)?.skillReference?.name ??
        state.evaluationSkills[0]?.name ??
        ""
    )
}

function renderRawCaseSkillOptions() {
    const current = elements.rawCaseSkill.value
    const names = new Set()
    for (const rawCase of state.rawCases) {
        if (rawCase.skill?.name) names.add(rawCase.skill.name)
    }
    for (const dataset of state.datasets) {
        if (dataset.skillReference?.name) names.add(dataset.skillReference.name)
    }
    for (const skill of state.evaluationSkills) {
        if (skill?.name) names.add(skill.name)
    }
    elements.rawCaseSkillOptions.replaceChildren(
        ...[...names].sort((left, right) => left.localeCompare(right)).map((name) => {
            const option = document.createElement("option")
            option.value = name
            return option
        }),
    )
    elements.rawCaseSkill.value = current
}

function automaticRawCaseObservation(rawCase) {
    const source = rawCase?.source
    const automatic = source?.kind === "automatic_capture"
    if (!automatic) return null
    const observation = Array.isArray(source.observations)
        ? source.observations.at(-1) ?? source
        : source
    const boundaryFields = [
        "runtimeId",
        "threadId",
        "startTurnId",
        "startItemId",
        "endTurnId",
        "endItemId",
    ]
    return {
        ...observation,
        complete: boundaryFields.every((field) => String(observation?.[field] ?? "").trim()),
        outcome: new Set(["resolved", "unresolved", "uncertain"]).has(observation?.outcome)
            ? observation.outcome
            : "uncertain",
        confidence: Number(observation?.confidence),
    }
}

function rawCaseSkillsMatch(left, right) {
    if (!left || !right) return false
    const leftId = String(left.id ?? "").trim()
    const rightId = String(right.id ?? "").trim()
    if (leftId && rightId) return leftId === rightId
    const leftName = String(left.name ?? "").trim().toLocaleLowerCase("en-US")
    const rightName = String(right.name ?? "").trim().toLocaleLowerCase("en-US")
    if (!leftName || leftName !== rightName) return false
    const leftPath = String(left.path ?? "").trim()
    const rightPath = String(right.path ?? "").trim()
    return !leftPath || !rightPath || leftPath === rightPath
}

function compatibleRawCaseDatasets(rawCase) {
    const matches = state.datasets.filter((dataset) => (
        dataset.activeRubricVersionId &&
        rawCaseSkillsMatch(dataset.skillReference, rawCase?.skill)
    ))
    const preferredId = state.settings.autoCaptureProfile?.datasetId
    const preferred = matches.find((dataset) => dataset.id === preferredId)
    return preferred
        ? [preferred, ...matches.filter((dataset) => dataset.id !== preferred.id)]
        : matches
}

function rawCaseDraftBlocker(observation, datasets) {
    if (!observation?.complete) return t("rawCaseEpisodeIncomplete")
    if (observation.runtimeId !== state.runtime?.runtime?.runtimeId) {
        return formatMessage("rawCaseSourceRuntimeMismatch", {
            runtime: observation.runtimeId,
        })
    }
    if (!datasets.length) return t("rawCaseNoCompatibleDataset")
    return null
}

function renderAutomaticRawCaseEvidence(rawCase, observation) {
    const metadata = node("div", "raw-case-automatic-meta")
    const outcomeKey = {
        resolved: "rawCaseOutcomeResolved",
        unresolved: "rawCaseOutcomeUnresolved",
        uncertain: "rawCaseOutcomeUncertain",
    }[observation.outcome]
    metadata.append(
        node("span", "raw-case-evidence-skill", formatMessage("rawCaseDetectedSkill", {
            name: rawCase.skill?.name || t("skill"),
        })),
        node("span", `raw-case-outcome ${observation.outcome}`, t(outcomeKey)),
    )
    if (Number.isFinite(observation.confidence)) {
        metadata.append(node("span", "", formatMessage("rawCaseConfidence", {
            value: Math.round(observation.confidence * 100),
        })))
    }
    const sourceTime = formatCaptureDate(observation.inspectedAt)
    if (sourceTime) {
        metadata.append(node("span", "", formatMessage("rawCaseSourceTime", {
            time: sourceTime,
        })))
    }
    if (observation.runtimeId) {
        metadata.append(node("span", "raw-case-source-runtime", formatMessage(
            "rawCaseSourceRuntime",
            {runtime: observation.runtimeId},
        )))
    }
    return metadata
}

function renderRawCaseDraftChooser(rawCase, datasets) {
    const chooser = node("div", "raw-case-draft-chooser")
    const field = node("label")
    const select = node("select")
    select.dataset.rawCaseDraftDataset = rawCase.id
    for (const dataset of datasets) {
        const option = node("option", "", dataset.name || dataset.id)
        option.value = dataset.id
        select.append(option)
    }
    field.append(node("span", "", t("rawCaseChooseDataset")), select)
    const actions = node("div", "raw-case-draft-chooser-actions")
    const cancel = node("button", "raw-case-secondary", t("cancel"))
    cancel.type = "button"
    cancel.dataset.cancelRawCaseDraft = rawCase.id
    const create = node(
        "button",
        "raw-case-primary",
        t(state.rawCaseDraftingIds.has(rawCase.id)
            ? "rawCaseCreatingDraft"
            : "rawCaseCreateDraftConfirm"),
    )
    create.type = "button"
    create.dataset.createRawCaseDraft = rawCase.id
    create.disabled = state.rawCaseDraftingIds.has(rawCase.id)
    select.disabled = create.disabled
    cancel.disabled = create.disabled
    actions.append(cancel, create)
    chooser.append(field, actions)
    return chooser
}

function canDispatchRawCaseToCurrentThread() {
    return Boolean(
        state.activeThreadId &&
        state.activeThread &&
        !state.newTaskMode &&
        !state.activeThreadArchived &&
        !state.activeTurnId &&
        !state.sending &&
        !state.loadingThread &&
        state.runtime?.status === "ready"
    )
}

function rawCaseDispatchDisabled(rawCaseId) {
    return (
        state.runtime?.status !== "ready" ||
        state.sending ||
        Boolean(state.activeTurnId) ||
        state.rawCaseDispatchingIds.has(rawCaseId) ||
        state.rawCaseDraftingIds.has(rawCaseId)
    )
}

function renderRawCases() {
    const visible = state.surface === "chat" && state.rawCaseOpen
    elements.rawCasePanel.classList.toggle("visible", visible)
    elements.topbarRawCases.classList.toggle("active", visible)
    elements.topbarRawCases.classList.toggle("hidden", state.surface !== "chat")
    elements.rawCaseCount.textContent = String(state.rawCases.length)
    renderRawCaseSkillOptions()
    elements.addRawCase.textContent = t(state.rawCaseEditingId ? "saveChanges" : "addToInbox")
    elements.cancelRawCaseEdit.classList.toggle("hidden", !state.rawCaseEditingId)
    elements.rawCaseList.replaceChildren()
    if (!state.rawCases.length) {
        elements.rawCaseList.append(node("div", "raw-case-empty", t("rawCaseEmpty")))
        return
    }

    const groups = new Map()
    for (const rawCase of state.rawCases) {
        const name = rawCase.skill?.name || t("skill")
        if (!groups.has(name)) groups.set(name, [])
        groups.get(name).push(rawCase)
    }
    for (const [skillName, rawCases] of groups) {
        const group = node("section", "raw-case-skill-group")
        const heading = node("header", "raw-case-skill-heading")
        heading.append(
            node("strong", "", skillName),
            node("span", "", String(rawCases.length)),
        )
        group.append(heading)
        for (const rawCase of rawCases) {
            const observation = automaticRawCaseObservation(rawCase)
            const compatibleDatasets = observation ? compatibleRawCaseDatasets(rawCase) : []
            const draftBlocker = observation
                ? rawCaseDraftBlocker(observation, compatibleDatasets)
                : null
            const card = node("article", "raw-case-card")
            card.dataset.rawCaseId = rawCase.id
            const question = node("p", "raw-case-card-question", rawCase.question)
            const metadata = node(
                "div",
                "raw-case-card-meta",
                [rawCase.note, relativeTime(rawCase.createdAt)].filter(Boolean).join(" · "),
            )
            const actions = node("div", "raw-case-card-actions")
            const edit = node("button", "raw-case-secondary", t("rawCaseEdit"))
            edit.type = "button"
            edit.dataset.editRawCase = rawCase.id
            const remove = node("button", "raw-case-secondary danger", t("rawCaseDelete"))
            remove.type = "button"
            remove.dataset.deleteRawCase = rawCase.id
            const current = node("button", "raw-case-secondary", t("rawCaseCurrentTask"))
            current.type = "button"
            current.dataset.dispatchRawCase = rawCase.id
            current.dataset.dispatchMode = "current"
            current.disabled = !canDispatchRawCaseToCurrentThread() || rawCaseDispatchDisabled(rawCase.id)
            const fresh = node("button", "raw-case-primary", t("rawCaseNewTask"))
            fresh.type = "button"
            fresh.dataset.dispatchRawCase = rawCase.id
            fresh.dataset.dispatchMode = "new"
            fresh.disabled = rawCaseDispatchDisabled(rawCase.id)
            const rawCaseBusy = state.rawCaseDispatchingIds.has(rawCase.id) ||
                state.rawCaseDraftingIds.has(rawCase.id)
            edit.disabled = rawCaseBusy
            remove.disabled = rawCaseBusy
            actions.append(edit, remove, current, fresh)
            card.append(question)
            if (observation) card.append(renderAutomaticRawCaseEvidence(rawCase, observation))
            card.append(metadata, actions)
            if (observation?.complete) {
                const openDraft = node("button", "raw-case-create-draft", t("createCaseDraft"))
                openDraft.type = "button"
                const dataOpenRawCaseDraft = rawCase.id
                openDraft.dataset.openRawCaseDraft = dataOpenRawCaseDraft
                openDraft.disabled = Boolean(draftBlocker) || state.rawCaseDraftingIds.has(rawCase.id)
                if (draftBlocker) openDraft.title = draftBlocker
                card.append(openDraft)
            }
            if (
                observation?.complete &&
                !draftBlocker &&
                state.rawCaseDraftChooserId === rawCase.id
            ) {
                card.append(renderRawCaseDraftChooser(rawCase, compatibleDatasets))
            }
            const creationError = state.rawCaseDraftErrors.get(rawCase.id)
            const errorMessage = draftBlocker ?? (creationError
                ? formatMessage("rawCaseDraftCreateFailed", {message: creationError})
                : null)
            if (errorMessage) card.append(node("p", "raw-case-draft-error", errorMessage))
            group.append(card)
        }
        elements.rawCaseList.append(group)
    }
}

function clearRawCaseForm() {
    state.rawCaseEditingId = null
    elements.rawCaseQuestion.value = ""
    elements.rawCaseNote.value = ""
    if (!elements.rawCaseSkill.value.trim()) {
        elements.rawCaseSkill.value = suggestedRawCaseSkill()
    }
    renderRawCases()
}

function editRawCase(rawCaseId) {
    const rawCase = state.rawCases.find((entry) => entry.id === rawCaseId)
    if (!rawCase) return
    state.rawCaseEditingId = rawCase.id
    elements.rawCaseSkill.value = rawCase.skill?.name ?? ""
    elements.rawCaseQuestion.value = rawCase.question
    elements.rawCaseNote.value = rawCase.note ?? ""
    renderRawCases()
    elements.rawCaseQuestion.focus()
}

async function saveRawCaseForm() {
    const question = elements.rawCaseQuestion.value.trim()
    const skillName = elements.rawCaseSkill.value.trim()
    if (!question || !skillName) return
    elements.addRawCase.disabled = true
    try {
        const input = {
            question,
            skill: rawCaseSkillReference(skillName),
            note: elements.rawCaseNote.value.trim(),
        }
        if (state.rawCaseEditingId) {
            await window.rollingSkill.updateRawCase(state.rawCaseEditingId, input)
        } else {
            const result = await window.rollingSkill.addRawCases([
                {...input, source: {kind: "manual"}},
            ])
            if (!result.created.length && result.duplicates.length) {
                showToast(t("rawCaseDuplicate"))
            }
        }
        state.rawCases = await window.rollingSkill.listRawCases()
        clearRawCaseForm()
    } catch (error) {
        showError(error)
    } finally {
        elements.addRawCase.disabled = false
        renderRawCases()
    }
}

async function deleteRawCase(rawCaseId) {
    try {
        await window.rollingSkill.deleteRawCase(rawCaseId)
        state.rawCases = state.rawCases.filter((entry) => entry.id !== rawCaseId)
        if (state.rawCaseEditingId === rawCaseId) clearRawCaseForm()
        else renderRawCases()
    } catch (error) {
        showError(error)
    }
}

async function createRawCaseDraft(rawCaseId, datasetId) {
    const rawCase = state.rawCases.find((entry) => entry.id === rawCaseId)
    const observation = automaticRawCaseObservation(rawCase)
    const datasets = compatibleRawCaseDatasets(rawCase)
    const blocker = rawCaseDraftBlocker(observation, datasets)
    if (!rawCase || blocker || !datasets.some((dataset) => dataset.id === datasetId)) {
        if (rawCase && blocker) state.rawCaseDraftErrors.set(rawCaseId, blocker)
        renderRawCases()
        return
    }
    state.rawCaseDraftingIds.add(rawCaseId)
    state.rawCaseDraftErrors.delete(rawCaseId)
    renderRawCases()
    try {
        const session = await window.rollingSkill.createCurationFromRawCase(rawCaseId, datasetId)
        upsertSourceCurationMarker(session)
        upsertCuration(session)
        state.activeCurationId = session.id
        state.rawCases = state.rawCases.filter((entry) => entry.id !== rawCaseId)
        state.rawCaseDraftChooserId = null
        setCurationOpen(true)
    } catch (error) {
        state.rawCaseDraftErrors.set(rawCaseId, error instanceof Error ? error.message : String(error))
    } finally {
        state.rawCaseDraftingIds.delete(rawCaseId)
        renderRawCases()
    }
}

async function dispatchRawCase(rawCaseId, mode) {
    const rawCase = state.rawCases.find((entry) => entry.id === rawCaseId)
    if (!rawCase || rawCaseDispatchDisabled(rawCase.id)) return
    if (mode === "current" && !canDispatchRawCaseToCurrentThread()) return
    const modelId = state.selectedTaskModelId
    const effort = state.selectedTaskEffort
    const permissionMode = state.selectedTaskPermissionMode
    const runtimeEpoch = state.runtimeEpoch
    const currentThreadId = state.activeThreadId
    state.rawCaseDispatchingIds.add(rawCase.id)
    state.sending = true
    state.error = null
    renderAll()
    try {
        if (mode === "current") {
            const response = await window.rollingSkill.startTurn(
                currentThreadId,
                rawCase.question,
                modelId,
                effort,
                permissionMode,
            )
            await window.rollingSkill.markRawCaseDispatched(rawCase.id, currentThreadId, "current")
            state.rawCases = state.rawCases.filter((entry) => entry.id !== rawCase.id)
            state.sending = false
            if (runtimeEpoch === state.runtimeEpoch && state.activeThreadId === currentThreadId) {
                state.activeTurnId = response.turn.id
                upsertTurn(response.turn)
                renderAll({forceBottom: true})
            }
        } else {
            snapshotActiveThreadView()
            const threadResponse = await window.rollingSkill.startThread(
                modelId,
                effort,
                permissionMode,
            )
            const threadId = threadResponse.thread.id
            await window.rollingSkill.startTurn(
                threadId,
                rawCase.question,
                modelId,
                effort,
                permissionMode,
            )
            await window.rollingSkill.markRawCaseDispatched(rawCase.id, threadId, "new")
            state.rawCases = state.rawCases.filter((entry) => entry.id !== rawCase.id)
            state.sending = false
            const observationEpoch = threadResponse.rollingSkillObservationEpoch ?? null
            if (observationEpoch !== null) {
                await window.rollingSkill.clearThreadObservation(observationEpoch).catch(() => {})
            }
            upsertThreadSummary(threadResponse.thread)
            if (runtimeEpoch === state.runtimeEpoch) await loadThread(threadId)
            void refreshThreads(false)
        }
    } catch (error) {
        state.sending = false
        showError(error)
    } finally {
        state.rawCaseDispatchingIds.delete(rawCase.id)
        renderAll()
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
        unknown: "activityStatusUnknown",
    }
    return keys[status] ? t(keys[status]) : String(status || t(fallbackKey))
}

function activityText(item) {
    if (item.type === "reasoning") {
        return `${t("reasoning")} · ${(item.summary ?? []).join(" ") || t("working")}`
    }
    if (item.type === "commandExecution") {
        const detail = commandActivity.commandActivityDetail(item)
        const header = [
            activityStatus(item.status, "running"),
            detail.invocationCount > 1
                ? formatMessage("commandInvocations", {count: detail.invocationCount})
                : null,
            Number.isFinite(item.exitCode) ? `exit ${item.exitCode}` : null,
        ].filter(Boolean).join(" · ")
        const command = detail.detailUnavailable
            ? t("commandHistoryUnavailable")
            : detail.command || t("command")
        return `${header}\n${command}`
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
    if (item.type === "subAgentActivity") {
        const detail = item.agentPath || item.kind || item.status || t("working")
        return `${t("subagentActivity")} · ${detail}`
    }
    if (item.type === "contextCompaction") return t("contextCompacted")
    if (item.type === "plan") return item.text || t("planUpdated")
    return null
}

const renderedItemCache = new Map()

function sourceCurationMarkerFromSession(session) {
    if (
        !session ||
        session.operation === "calibration" ||
        session.operation === "refresh" ||
        session.status === "cancelled" ||
        !session.episode?.source?.threadId
    ) {
        return null
    }
    return {
        id: session.id,
        datasetId: session.datasetId,
        caseId: session.caseId ?? null,
        status: session.status,
        threadId: session.episode.source.threadId,
        startItemId: session.episode.source.startItemId,
        endItemId: session.episode.source.endItemId,
        itemIds: (session.episode.items ?? []).map((item) => item.id).filter(Boolean),
    }
}

function upsertSourceCurationMarker(session) {
    const index = state.sourceCurationMarkers.findIndex((marker) => marker.id === session?.id)
    const marker = sourceCurationMarkerFromSession(session)
    if (!marker) {
        if (index >= 0) state.sourceCurationMarkers.splice(index, 1)
        return
    }
    if (index >= 0) state.sourceCurationMarkers[index] = marker
    else state.sourceCurationMarkers.push(marker)
}

function rebuildActiveCurationMarkerIndex() {
    const index = new Map()
    for (const marker of state.sourceCurationMarkers) {
        if (marker.threadId !== state.activeThreadId) continue
        const kind = marker.status === "archived" || marker.caseId ? "archived" : "draft"
        for (const itemId of marker.itemIds ?? []) {
            const current = index.get(itemId)
            if (!current || (current.kind !== "archived" && kind === "archived")) {
                index.set(itemId, {
                    ...marker,
                    kind,
                    isEnd: itemId === marker.endItemId,
                })
            }
        }
    }
    state.activeCurationMarkerByItem = index
}

function curationMarkerForItem(item) {
    return state.activeCurationMarkerByItem.get(item?.id) ?? null
}

function decorateSourceCaseRange(element, item) {
    const marker = curationMarkerForItem(item)
    if (!marker || !element) return marker
    element.classList.add("source-case-range", marker.kind)
    if (marker.isEnd) {
        element.append(
            node(
                "span",
                "source-case-range-status",
                t(marker.kind === "archived" ? "rawCaseArchivedStatus" : "rawCaseDraftStatus"),
            ),
        )
    }
    return marker
}

function renderItemSignature(item, turn) {
    const content =
        item.type === "userMessage"
            ? textFromUserInput(item.content)
            : item.type === "agentMessage"
              ? item.text || ""
              : activityText(item)
    return JSON.stringify([
        state.settings.language,
        state.workspaceRoot,
        turn.status,
        item.type,
        content,
        curationMarkerForItem(item)?.kind ?? null,
        curationMarkerForItem(item)?.isEnd ?? false,
    ])
}

function renderItem(item, turn) {
    if (item.type === "userMessage") {
        const wrapper = node("article", "message user")
        const body = node("div", "message-body")
        appendSafeMessageMarkdown(body, textFromUserInput(item.content))
        wrapper.append(body)
        decorateSourceCaseRange(wrapper, item)
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
        appendSafeMessageMarkdown(body, item.text || "")
        wrapper.append(avatar, body)
        if (turn.status !== "inProgress") {
            const actions = node("div", "message-actions")
            const save = node(
                "button",
                "save-case-button",
                t(curationMarkerForItem(item) ? "curateAgain" : "curateCase"),
            )
            save.type = "button"
            save.dataset.saveCase = "true"
            save.dataset.turnId = turn.id
            save.dataset.itemId = item.id
            actions.append(save)
            wrapper.append(actions)
        }
        decorateSourceCaseRange(wrapper, item)
        return wrapper
    }
    const text = activityText(item)
    if (!text) return null
    const activity = node("div", "activity-card", text)
    decorateSourceCaseRange(activity, item)
    return activity
}

function renderRuntimeQuestion(request) {
    const card = node("form", "runtime-question-card")
    card.dataset.runtimeQuestionId = request.requestId
    card.append(node("h3", "", t("runtimeQuestionTitle")))
    for (const [index, question] of (request.questions ?? []).entries()) {
        const group = node("fieldset", "runtime-question-group")
        const legend = document.createElement("legend")
        legend.textContent = question.header
            ? `${question.header} · ${question.question}`
            : question.question
        group.append(legend)
        if (question.detail) {
            const detail = node("div", "runtime-question-detail")
            appendSafeMessageMarkdown(detail, question.detail)
            group.append(detail)
        }
        const options = node("div", "runtime-question-options")
        for (const option of question.options ?? []) {
            const label = node("label", "runtime-question-option")
            const input = document.createElement("input")
            input.type = question.multiSelect ? "checkbox" : "radio"
            input.name = `runtime-question-${request.requestId}-${index}`
            input.value = option.label
            input.dataset.runtimeQuestionOption = String(index)
            const copy = node("span", "")
            copy.append(node("strong", "", option.label))
            if (option.description) copy.append(node("small", "", option.description))
            label.append(input, copy)
            options.append(label)
        }
        group.append(options)
        const custom = document.createElement("input")
        custom.type = "text"
        custom.className = "runtime-question-custom"
        custom.placeholder = t("runtimeQuestionCustom")
        custom.dataset.runtimeQuestionCustom = String(index)
        group.append(custom)
        card.append(group)
    }
    const error = node("p", "runtime-question-error hidden")
    error.dataset.runtimeQuestionError = "true"
    const actions = node("div", "runtime-question-actions")
    const cancel = node("button", "secondary-button", t("runtimeQuestionCancel"))
    cancel.type = "button"
    cancel.dataset.cancelRuntimeQuestion = request.requestId
    const submit = node("button", "primary-button", t("runtimeQuestionSubmit"))
    submit.type = "submit"
    actions.append(cancel, submit)
    card.append(error, actions)
    return card
}

function appendRuntimeQuestions() {
    for (const request of state.pendingRuntimeQuestions.values()) {
        if (request.threadId !== state.activeThreadId) continue
        elements.conversation.append(renderRuntimeQuestion(request))
    }
}

function onRuntimeQuestion(request) {
    if (!request?.requestId || !request?.threadId) return
    state.pendingRuntimeQuestions.set(request.requestId, request)
    if (request.threadId === state.activeThreadId) renderConversation({forceBottom: true})
}

function onRuntimeQuestionResolved(payload) {
    if (!payload?.requestId) return
    const request = state.pendingRuntimeQuestions.get(payload.requestId)
    state.pendingRuntimeQuestions.delete(payload.requestId)
    if (request?.threadId === state.activeThreadId) renderConversation()
}

async function respondRuntimeQuestion(form, {cancelled = false} = {}) {
    const requestId = form.dataset.runtimeQuestionId
    const request = state.pendingRuntimeQuestions.get(requestId)
    if (!request) return
    const answers = []
    if (!cancelled) {
        for (const [index, question] of (request.questions ?? []).entries()) {
            const selected = [...form.querySelectorAll(
                `[data-runtime-question-option="${index}"]:checked`,
            )].map((input) => input.value)
            const custom = form.querySelector(
                `[data-runtime-question-custom="${index}"]`,
            )?.value.trim() ?? ""
            const valid = question.multiSelect
                ? selected.length > 0 || Boolean(custom)
                : selected.length === 1 !== Boolean(custom)
            if (!valid) {
                const error = form.querySelector("[data-runtime-question-error]")
                error.textContent = t("runtimeQuestionRequired")
                error.classList.remove("hidden")
                return
            }
            answers.push({
                id: question.id,
                selected,
                ...(custom ? {custom} : {}),
            })
        }
    }
    for (const button of form.querySelectorAll("button, input")) button.disabled = true
    try {
        await window.rollingSkill.respondRuntimeQuestion({requestId, cancelled, answers})
        state.pendingRuntimeQuestions.delete(requestId)
        renderConversation()
    } catch (error) {
        for (const button of form.querySelectorAll("button, input")) button.disabled = false
        showError(error)
    }
}

function renderConversation(options = {}) {
    const wasNearBottom = isConversationNearBottom()
    rebuildActiveCurationMarkerIndex()
    elements.conversation.replaceChildren()
    if (state.loadingThread) {
        elements.conversation.append(node("div", "loading-conversation", t("loadingTask")))
        return
    }
    if (state.threadLoadFailed) {
        renderedItemCache.clear()
        elements.conversation.append(node("div", "thread-load-failed", t("threadLoadFailed")))
        return
    }
    if (!state.activeThread || getTurns().length === 0) {
        renderedItemCache.clear()
        renderWelcome()
        appendRuntimeQuestions()
        return
    }

    const visibleItemKeys = new Set()
    for (const turn of getTurns()) {
        const block = node("section", "turn-block")
        block.dataset.turnId = turn.id
        for (let index = 0; index < (turn.items ?? []).length; index += 1) {
            const item = turn.items[index]
            const cacheKey = `${turn.id}:${item.id || `${item.type}-${index}`}`
            const signature = renderItemSignature(item, turn)
            const cached = renderedItemCache.get(cacheKey)
            const rendered =
                cached?.signature === signature ? cached.rendered : renderItem(item, turn)
            renderedItemCache.set(cacheKey, {signature, rendered})
            visibleItemKeys.add(cacheKey)
            if (rendered) {
                rendered.dataset.timelineItemKey = cacheKey
                block.append(rendered)
            }
        }
        if (turn.error?.message) block.append(node("div", "turn-error", turn.error.message))
        elements.conversation.append(block)
    }
    for (const key of renderedItemCache.keys()) {
        if (!visibleItemKeys.has(key)) renderedItemCache.delete(key)
    }

    const activityHistory = state.activeThread.rollingSkillActivityHistory
    if (activityHistory?.runtimeMayOmitItems && getTurns().length) {
        elements.conversation.append(
            node("div", "activity-history-note", t("activityHistoryLimited")),
        )
    }
    appendRuntimeQuestions()

    if (options.forceBottom || wasNearBottom) {
        requestAnimationFrame(() => {
            elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight
        })
    }
}

function renderDirtyConversationItems(locators, options = {}) {
    const wasNearBottom = isConversationNearBottom()
    let requiresConversationRender = false
    for (const {turnId, itemId} of locators) {
        const turn = findTurn(turnId)
        const index = turn?.items?.findIndex((item) => item.id === itemId) ?? -1
        if (!turn || index < 0) continue
        const item = turn.items[index]
        const cacheKey = `${turn.id}:${item.id || `${item.type}-${index}`}`
        const cached = renderedItemCache.get(cacheKey)
        if (!cached?.rendered?.isConnected) {
            requiresConversationRender = true
            break
        }
        const signature = renderItemSignature(item, turn)
        if (cached.signature === signature) continue
        const rendered = renderItem(item, turn)
        if (!rendered) {
            requiresConversationRender = true
            break
        }
        rendered.dataset.timelineItemKey = cacheKey
        cached.rendered.replaceWith(rendered)
        renderedItemCache.set(cacheKey, {signature, rendered})
    }
    if (requiresConversationRender) {
        renderConversation(options)
        return
    }
    if (options.forceBottom || wasNearBottom) {
        requestAnimationFrame(() => {
            elements.conversationScroll.scrollTop = elements.conversationScroll.scrollHeight
        })
    }
}

const streamRenderQueue = globalThis.RollingSkillStreamRenderQueue.createStreamRenderQueue({
    render: renderDirtyConversationItems,
})

function renderDirtyLiveActivities(locators) {
    for (const {turnId: kind, itemId: sessionId} of locators) {
        if (kind === "curation") {
            const activity = state.curationActivities.get(sessionId)
            if (activity) patchCurationActivityCard(activity)
        } else if (kind === "rubric") {
            const activity = state.rubricActivities.get(sessionId)
            if (activity) patchRubricActivityCard(activity)
        }
    }
}

const liveActivityRenderQueue = globalThis.RollingSkillStreamRenderQueue.createStreamRenderQueue({
    intervalMs: 64,
    render: renderDirtyLiveActivities,
})

function enqueueLiveActivityPatch(kind, activity) {
    if (!activity?.sessionId) return
    if (activity.terminal) {
        liveActivityRenderQueue.flushNow()
        if (kind === "curation") state.curationActivities.delete(activity.sessionId)
        else state.rubricActivities.delete(activity.sessionId)
        if (kind === "curation") patchCurationActivityCard(activity)
        else patchRubricActivityCard(activity)
        return
    }
    if (kind === "curation") state.curationActivities.set(activity.sessionId, activity)
    else state.rubricActivities.set(activity.sessionId, activity)
    liveActivityRenderQueue.enqueue(kind, activity.sessionId)
}

function renderComposer() {
    const running = Boolean(state.activeTurnId) || state.sending
    const readOnly = state.activeThreadArchived
    const loading = state.loadingThread
    const loadFailed = state.threadLoadFailed
    elements.stopTurn.classList.toggle("hidden", !running)
    elements.sendTurn.classList.toggle("hidden", running || readOnly)
    elements.sendTurn.disabled =
        readOnly || loading || loadFailed || state.runtime?.status !== "ready" || !elements.composerInput.value.trim()
    elements.composerInput.disabled = state.sending || readOnly || loading || loadFailed
    elements.composerModel.disabled =
        readOnly || loading || loadFailed || running || state.runtime?.status !== "ready"
    elements.composerEffort.disabled =
        readOnly || loading || loadFailed || running || state.runtime?.status !== "ready"
    elements.composerAccess.disabled =
        readOnly || loading || loadFailed || running || state.runtime?.status !== "ready"
    elements.composer.classList.toggle("archived-readonly", readOnly)
    elements.archivedThreadNotice.classList.toggle("hidden", !readOnly)
    renderPermissionModePicker()
    renderTaskModelPicker()
}

function renderTitle() {
    elements.activeTitle.textContent = state.surface === "evaluation"
        ? t("skillEvaluation")
        : state.surface === "skills"
        ? t("skillManagement")
        : state.surface === "operator"
        ? t("operator")
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

function activeCalibrationForCase(caseId) {
    return state.curationSessions.find(
        (session) =>
            session.operation === "calibration" &&
            session.targetCaseId === caseId,
    ) ?? null
}

function activeRefreshForCase(caseId) {
    return state.curationSessions.find(
        (session) =>
            session.operation === "refresh" &&
            session.targetCaseId === caseId,
    ) ?? null
}

function calibrationBatchSnapshot() {
    return state.calibrationBatch?.snapshot?.() ?? null
}

function refreshBatchSnapshot() {
    return state.refreshBatch?.snapshot?.() ?? null
}

function refreshBatchStatusText(snapshot) {
    if (!snapshot) return ""
    if (snapshot.status === "completed") return t("refreshBatchComplete")
    if (snapshot.status === "stopped") return t("refreshBatchStopped")
    if (snapshot.status === "failed") {
        return formatMessage("refreshBatchFailed", {message: snapshot.error || t("failed")})
    }
    if (snapshot.archiving) return t("refreshBatchSaving")
    return formatMessage("refreshBatchProgress", {
        completed: snapshot.completed,
        total: snapshot.total,
    })
}

function refreshBatchCaseTitle(caseId) {
    const entry = state.evaluationCases.find((candidate) => candidate.id === caseId)
    return entry?.title || entry?.inputSummary || entry?.question || caseId || t("none")
}

function fillRefreshBatchPanel(container, snapshot) {
    container.replaceChildren()
    container.className = `refresh-batch-panel ${snapshot.status}`
    const copy = node("span", "refresh-batch-copy")
    copy.append(
        node("strong", "", formatMessage("refreshBatchProgress", {
            completed: snapshot.completed,
            total: snapshot.total,
        })),
        node("small", "", refreshBatchStatusText(snapshot)),
    )
    if (snapshot.currentCaseId) {
        copy.append(node("small", "refresh-batch-current", formatMessage("refreshBatchCurrent", {
            case: refreshBatchCaseTitle(snapshot.currentCaseId),
        })))
    }
    container.append(copy)
    if (snapshot.status === "running") {
        const stop = node("button", "refresh-batch-stop", t("stopRefreshBatch"))
        stop.type = "button"
        stop.dataset.stopRefreshBatch = "true"
        container.append(stop)
    }
    return container
}

function renderCaseRefreshBatchStatus() {
    const snapshot = refreshBatchSnapshot()
    if (!snapshot || snapshot.datasetId !== state.evaluationDatasetId) {
        elements.caseRefreshBatchStatus.replaceChildren()
        elements.caseRefreshBatchStatus.className = "refresh-batch-panel hidden"
        return
    }
    fillRefreshBatchPanel(elements.caseRefreshBatchStatus, snapshot)
}

function calibrationBatchForSession(sessionId) {
    const batch = state.calibrationBatch
    const snapshot = batch?.snapshot?.()
    return snapshot?.status === "running" && snapshot.currentSessionId === sessionId
        ? batch
        : null
}

function calibrationBatchStatusText(snapshot) {
    if (!snapshot) return ""
    if (snapshot.status === "completed") return t("calibrationBatchComplete")
    if (snapshot.status === "stopped") return t("calibrationBatchStopped")
    if (snapshot.status === "failed") {
        return formatMessage("calibrationBatchFailed", {message: snapshot.error || t("failed")})
    }
    if (snapshot.archiving) return t("calibrationBatchSaving")
    return formatMessage("calibrationBatchProgress", {
        completed: snapshot.completed,
        total: snapshot.total,
    })
}

function calibrationActionKey(session, idleKey = "calibrateCase") {
    if (!session) return idleKey
    return session.status === "queued" || session.status === "running"
        ? "calibrationInProgress"
        : "reviewCalibration"
}

function refreshActionKey(session) {
    if (!session) return "refreshCase"
    return session.status === "queued" || session.status === "running"
        ? "refreshingCase"
        : "reviewRefresh"
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

function renderDraft(draft, caseType) {
    const wrapper = node("div", "curation-draft")
    const isBadcase = caseType === "badcase" || Boolean(draft.badCaseAnalysis)
    wrapper.append(node("h3", "", t(isBadcase ? "structuredBadcase" : "structuredReference")))
    if (isBadcase) {
        const analysis = draft.badCaseAnalysis
        wrapper.append(
            draftSection(t("failureMode"), [analysis.failureMode]),
            draftSection(t("firstDivergence"), [analysis.firstDivergence]),
            draftSection(t("rootCauses"), analysis.rootCauses),
            draftSection(t("loopSummary"), [analysis.loopSummary]),
            draftSection(t("expectedRecovery"), [analysis.expectedRecovery]),
        )
        const deductions = node("section", "draft-section deduction-rules")
        deductions.append(node("h4", "", t("deductionRules")))
        for (const rule of analysis.deductionRules ?? []) {
            const card = node("article", "requirement-card deduction-rule")
            card.append(
                node("strong", "", `${rule.id} · ${rule.errorPattern}`),
                node("span", "", `${t("matchCondition")}: ${rule.matchCondition}`),
                node("span", "", formatMessage("maximumDeduction", {value: rule.deduction})),
                node("small", "", `${t("basis")}: ${rule.evidenceBasis}`),
                node("small", "", `${t("sourceItems")}: ${(rule.sourceItemIds ?? []).join(", ")}`),
            )
            deductions.append(card)
        }
        wrapper.append(deductions)
    }
    const summary = node("section", "draft-section")
    summary.append(
        node("h4", "", t(isBadcase ? "recoveryDirection" : "referenceAnswer")),
        node("div", "draft-summary", draft.referenceAnswer.summary),
    )
    wrapper.append(summary)
    if (!isBadcase) {
        wrapper.append(
            draftSection(t("requiredFacts"), draft.referenceAnswer.requiredFacts),
            draftSection(t("requiredSteps"), draft.referenceAnswer.requiredSteps),
        )
    }
    wrapper.append(draftSection(t("requiredOutputFormat"), draft.referenceAnswer.requiredOutputFormat))

    if (draft.schemaVersion === "rolling-skill-curated-case/v2") {
        const coverage = node("section", "draft-section hard-requirements")
        coverage.append(node("h4", "", t("rubricCriteria")))
        for (const entry of draft.rubricCoverage ?? []) {
            const card = node("article", "requirement-card")
            card.append(
                node("strong", "", `${entry.criterionId} · ${entry.applicability}`),
                node("span", "", entry.expectation),
                node("small", "", `${t("basis")}: ${entry.evidenceBasis}`),
            )
            coverage.append(card)
        }
        wrapper.append(
            coverage,
            draftSection(
                t("softCriteria"),
                (draft.caseSpecificCriteria ?? []).map(
                    (entry) => `${entry.id} · ${entry.criterion} (${formatMessage("weight", {value: entry.weight})})`,
                ),
            ),
            draftSection(
                t("automaticFailures"),
                (draft.caseAutomaticFailures ?? []).map(
                    (entry) => `${entry.id} · ${entry.condition}`,
                ),
            ),
        )
        return wrapper
    }

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
    return wrapper
}

function curatorConversationText(message) {
    if (message.role !== "assistant") return message.text
    const text = String(message.text ?? "")
    const marker = text.search(
        /```(?:json)?\s*\{|\{\s*"schemaVersion"\s*:\s*"rolling-skill-curated-case\/v[12]"/iu,
    )
    if (marker < 0) return message.text
    return text.slice(0, marker).trim() || t("referenceUpdated")
}

function curatorActivityStage(activity) {
    const keys = {
        starting: "curatorStarting",
        analyzing: "curatorAnalyzing",
        command: "curatorCommand",
        tool: "curatorTool",
        drafting: "curatorDrafting",
    }
    return t(keys[activity?.stage] ?? "curatorWorking")
}

function shortElapsed(milliseconds) {
    const seconds = Math.max(0, Math.floor(Number(milliseconds ?? 0) / 1000))
    if (seconds < 60) return `${seconds}s`
    return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}

function renderCurationActivity(container, session) {
    if (session.status !== "queued" && session.status !== "running") return
    const activity = state.curationActivities.get(session.id) ?? {
        sessionId: session.id,
        stage: "starting",
        summary: "",
        startedAt: Date.parse(session.updatedAt || session.createdAt || new Date().toISOString()),
        lastActivityAt: Date.now(),
    }
    const card = node("div", "curation-live-activity")
    card.dataset.curationActivity = session.id
    const heading = node("div", "curation-live-heading")
    heading.append(
        node("span", "curation-live-dot"),
        node("strong", "curation-live-stage", curatorActivityStage(activity)),
    )
    const detail = node("div", "curation-live-detail", activity.summary || "")
    detail.classList.toggle("hidden", !activity.summary)
    card.append(heading, detail, node("small", "curation-live-timing"))
    container.append(card)
    patchCurationActivityCard(activity)
}

function patchCurationActivityCard(activity) {
    const card = elements.curationDetail.querySelector(
        `[data-curation-activity="${CSS.escape(String(activity?.sessionId ?? ""))}"]`,
    )
    if (!card) return
    if (activity.terminal) {
        card.remove()
        return
    }
    const now = Date.now()
    card.querySelector(".curation-live-stage").textContent = curatorActivityStage(activity)
    const detail = card.querySelector(".curation-live-detail")
    detail.textContent = activity.summary || ""
    detail.classList.toggle("hidden", !activity.summary)
    card.querySelector(".curation-live-timing").textContent = `${formatMessage("curatorElapsed", {
        value: shortElapsed(now - activity.startedAt),
    })} · ${formatMessage("curatorLastActive", {
        value: shortElapsed(now - activity.lastActivityAt),
    })}`
}

function renderCurations() {
    const existingInput = elements.curationDetail.querySelector("[data-curation-input]")
    if (existingInput?.dataset.curationInput) {
        if (existingInput.value) {
            state.curationInputDrafts.set(existingInput.dataset.curationInput, existingInput.value)
        } else {
            state.curationInputDrafts.delete(existingInput.dataset.curationInput)
        }
    }
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
            const title = String(
                session.episode?.originalQuestion ?? t("untitledCase"),
            ).trim()
            button.append(
                node("span", "curation-list-title", title || t("untitledCase")),
                ...(session.operation === "calibration"
                    ? [node("span", "curation-list-mode", t("caseCalibration"))]
                    : session.operation === "refresh"
                      ? [node("span", "curation-list-mode", t("caseRefresh"))]
                    : []),
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
        ...(session.operation === "calibration"
            ? [node("span", "case-kind calibration", t("caseCalibration"))]
            : session.operation === "refresh"
              ? [node("span", "case-kind refresh", t("caseRefresh"))]
            : []),
        node("span", `curation-status ${session.status}`, curationStatusLabel(session.status)),
    )
    const question = node("section", "frozen-question")
    question.append(
        node("span", "curation-label", t("issueDescription")),
        node("div", "", session.issueDescription || t("none")),
    )
    const sourceQuestion = node("section", "frozen-question")
    sourceQuestion.append(
        node("span", "curation-label", t("verbatimQuestion")),
        node("div", "", session.episode.originalQuestion),
    )
    const curatorModel = session.curator.effectiveModelId
        ? formatMessage("actualRuntimeSetting", {value: session.curator.effectiveModelId})
        : session.curator.modelId
          ? `${formatMessage("requestedRuntimeSetting", {value: session.curator.modelId})} · ${t("actualRuntimeUnknown")}`
          : t("inheritRuntimeEffort")
    const curatorEffort = session.curator.effectiveEffort
        ? formatMessage("actualRuntimeSetting", {value: session.curator.effectiveEffort})
        : session.curator.effort
          ? `${formatMessage("requestedRuntimeSetting", {value: session.curator.effort})} · ${t("actualRuntimeUnknown")}`
          : t("inheritRuntimeEffort")
    const provenance = node(
        "div",
        "curation-provenance",
        `${session.episode.items.length} episode items · ${session.episode.toolActivity.length} tool signatures · ${session.skillReference?.name || t("none")} · ${curatorModel} · ${curatorEffort}`,
    )
    scroll.append(overview, question)
    const batchSnapshot = calibrationBatchSnapshot()
    if (
        session.operation === "calibration" &&
        batchSnapshot?.currentSessionId === session.id
    ) {
        const batchPanel = node("section", `calibration-batch-panel ${batchSnapshot.status}`)
        const batchCopy = node("span", "calibration-batch-copy")
        batchCopy.append(
            node("strong", "", formatMessage("calibrationBatchProgress", {
                completed: batchSnapshot.completed,
                total: batchSnapshot.total,
            })),
            node("small", "", calibrationBatchStatusText(batchSnapshot)),
        )
        batchPanel.append(batchCopy)
        if (batchSnapshot.status === "running") {
            const stop = node("button", "calibration-batch-stop", t("stopCalibrationBatch"))
            stop.type = "button"
            stop.dataset.stopCalibrationBatch = "true"
            batchPanel.append(stop)
        }
        scroll.append(batchPanel)
    }
    const refreshSnapshot = refreshBatchSnapshot()
    if (
        session.operation === "refresh" &&
        refreshSnapshot?.currentSessionId === session.id
    ) {
        scroll.append(fillRefreshBatchPanel(
            node("section", "refresh-batch-panel"),
            refreshSnapshot,
        ))
    }
    scroll.append(sourceQuestion)
    scroll.append(provenance)

    if (session.operation === "calibration" && session.baselineCaseSnapshot) {
        const baseline = document.createElement("details")
        baseline.className = "curation-reference-card calibration-baseline-card"
        const summary = document.createElement("summary")
        summary.append(
            node("span", "curation-reference-check", "↺"),
            node("strong", "", t("calibrationBaseline")),
            node(
                "small",
                "",
                session.baselineCaseSnapshot.curated?.referenceAnswer?.summary ??
                    session.baselineCaseSnapshot.answer ??
                    t("none"),
            ),
        )
        baseline.append(summary)
        if (session.baselineCaseSnapshot.curated) {
            baseline.append(renderDraft(session.baselineCaseSnapshot.curated, session.caseType))
        }
        scroll.append(baseline)
    }

    if (session.operation === "refresh" && session.baselineCaseSnapshot) {
        const baseline = document.createElement("details")
        baseline.className = "curation-reference-card refresh-baseline-card"
        const summary = document.createElement("summary")
        summary.append(
            node("span", "curation-reference-check", "↺"),
            node("strong", "", t("refreshBaseline")),
            node(
                "small",
                "",
                session.baselineCaseSnapshot.curated?.referenceAnswer?.summary ??
                    session.baselineCaseSnapshot.answer ??
                    t("none"),
            ),
        )
        baseline.append(summary)
        if (session.baselineCaseSnapshot.curated) {
            baseline.append(renderDraft(session.baselineCaseSnapshot.curated, session.caseType))
        }
        scroll.append(baseline)
    }

    if (session.draft) {
        const reference = document.createElement("details")
        reference.className = "curation-reference-card"
        if (state.flashingCurationReferences.delete(session.id)) {
            reference.classList.add("just-updated")
        }
        const summary = document.createElement("summary")
        summary.append(
            node("span", "curation-reference-check", "✓"),
            node(
                "strong",
                "",
                session.caseType === "badcase"
                    ? t(session.revisions?.length > 1 ? "badcaseUpdated" : "badcaseReady")
                    : t(session.revisions?.length > 1 ? "referenceUpdated" : "referenceReady"),
            ),
            node("small", "", t(session.caseType === "badcase" ? "expandBadcase" : "expandReference")),
        )
        reference.append(summary, renderDraft(session.draft, session.caseType))
        scroll.append(reference)
    }

    const conversation = node("section", "curator-conversation")
    conversation.append(node("h3", "", t("curatorConversation")))
    for (const message of session.conversation) {
        const bubble = node("article", `curator-message ${message.role}`)
        bubble.append(node("span", "curator-role", message.role === "assistant" ? "Curator" : t("you")))
        bubble.append(node("div", "", curatorConversationText(message)))
        conversation.append(bubble)
    }
    renderCurationActivity(conversation, session)
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
        input.value = state.curationInputDrafts.get(session.id) ?? ""
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
        const inheritOption = effortPicker.querySelector('option[value=""]')
        if (inheritOption && session.curator.effectiveEffort) {
            inheritOption.textContent = `${t("inheritRuntimeEffort")} · ${formatMessage("actualRuntimeSetting", {value: session.curator.effectiveEffort})}`
        }
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
            const done = node(
                "button",
                "curation-done primary",
                t(
                    session.operation === "calibration"
                        ? "doneCalibration"
                        : session.operation === "refresh"
                          ? "doneRefresh"
                          : "doneSaveCase",
                ),
            )
            done.type = "button"
            done.dataset.archiveCuration = session.id
            actions.append(done)
        }
        composerWrap.append(actions)
        elements.curationDetail.append(composerWrap)
    }
}

function rubricConversationText(message) {
    if (message.role !== "assistant") return message.text
    const text = String(message.text ?? "")
    const marker = text.search(/```(?:json)?\s*\{|\{\s*"schemaVersion"\s*:\s*"rolling-skill-dataset-rubric\/v1"/iu)
    return marker < 0 ? text : text.slice(0, marker).trim() || t("rubricReady")
}

function renderRubricDraft(rubric) {
    const wrapper = node("div", "curation-draft rubric-draft")
    wrapper.append(
        node("h3", "", rubric.title),
        node("p", "draft-summary", rubric.summary),
    )
    const criteria = node("section", "draft-section hard-requirements")
    criteria.append(node("h4", "", t("rubricCriteria")))
    for (const entry of rubric.criteria ?? []) {
        const card = node("article", "requirement-card")
        card.append(
            node("strong", "", `${entry.id} · ${entry.title}`),
            node("span", "", entry.criterion),
            node("small", "", `${formatMessage("weight", {value: entry.weight})} · ${entry.criticalFailure ? t("criticalFailure") : t("softCriteria")}`),
        )
        const anchors = node("div", "rubric-anchors")
        for (const [rating, meaning] of Object.entries(entry.scoringAnchors ?? {})) {
            anchors.append(node("span", "", `${rating} · ${meaning}`))
        }
        card.append(anchors)
        criteria.append(card)
    }
    wrapper.append(criteria)
    const failures = (rubric.automaticFailures ?? []).map(
        (entry) => `${entry.id} · ${entry.condition} — ${entry.rationale}`,
    )
    wrapper.append(draftSection(t("rubricFailures"), failures))
    return wrapper
}

function upsertRubricSession(session) {
    const index = state.rubricSessions.findIndex((entry) => entry.id === session.id)
    if (session.status === "cancelled" || session.status === "archived") {
        state.rubricInputDrafts.delete(session.id)
        if (index >= 0) state.rubricSessions.splice(index, 1)
        if (state.activeRubricSessionId === session.id) {
            state.activeRubricSessionId = state.rubricSessions[0]?.id ?? null
        }
        return
    }
    if (index >= 0) state.rubricSessions[index] = session
    else state.rubricSessions.unshift(session)
    state.activeRubricSessionId ??= session.id
}

function renderRubricActivity(container, session) {
    if (session.status !== "queued" && session.status !== "running") return
    const activity = state.rubricActivities.get(session.id) ?? {
        sessionId: session.id,
        stage: "starting",
        summary: "",
        startedAt: Date.parse(session.updatedAt || session.createdAt || new Date().toISOString()),
        lastActivityAt: Date.now(),
    }
    const card = node("div", "curation-live-activity")
    card.dataset.rubricActivity = session.id
    const heading = node("div", "curation-live-heading")
    heading.append(
        node("span", "curation-live-dot"),
        node("strong", "rubric-live-stage", t("rubricDraftRunning")),
    )
    const detail = node("div", "curation-live-detail", activity.summary || "")
    detail.classList.toggle("hidden", !activity.summary)
    card.append(heading, detail, node("small", "rubric-live-timing"))
    container.append(card)
    patchRubricActivityCard(activity)
}

function patchRubricActivityCard(activity) {
    const card = elements.rubricDetail.querySelector(
        `[data-rubric-activity="${CSS.escape(String(activity?.sessionId ?? ""))}"]`,
    )
    if (!card) return
    if (activity.terminal) {
        card.remove()
        return
    }
    const now = Date.now()
    const detail = card.querySelector(".curation-live-detail")
    detail.textContent = activity.summary || ""
    detail.classList.toggle("hidden", !activity.summary)
    card.querySelector(".rubric-live-timing").textContent = `${formatMessage("curatorElapsed", {
        value: shortElapsed(now - activity.startedAt),
    })} · ${formatMessage("curatorLastActive", {
        value: shortElapsed(now - activity.lastActivityAt),
    })}`
}

function renderRubricDrawer() {
    const existingInput = elements.rubricDetail.querySelector("[data-rubric-input]")
    if (existingInput?.dataset.rubricInput) {
        if (existingInput.value) state.rubricInputDrafts.set(existingInput.dataset.rubricInput, existingInput.value)
        else state.rubricInputDrafts.delete(existingInput.dataset.rubricInput)
    }
    elements.rubricDrawer.classList.toggle("visible", state.rubricOpen)
    elements.rubricVersionList.replaceChildren()
    const versionHeading = node("span", "rubric-version-heading", t("rubricVersions"))
    elements.rubricVersionList.append(versionHeading)
    for (const version of state.evaluationRubricVersions) {
        const card = node("article", "rubric-version-card")
        if (version.id === state.evaluationRubricVersion?.id) card.classList.add("active")
        card.append(
            node("strong", "", `v${version.version} · ${version.rubric.title}`),
            node("small", "", new Date(version.publishedAt).toLocaleString(state.settings.language)),
        )
        elements.rubricVersionList.append(card)
    }

    elements.rubricDetail.replaceChildren()
    const scroll = node("div", "curation-detail-scroll")
    elements.rubricDetail.append(scroll)
    const session = activeRubricSession()
    if (!session) {
        if (state.evaluationRubricVersion) {
            scroll.append(renderRubricDraft(state.evaluationRubricVersion.rubric))
        } else {
            scroll.append(node("div", "sidebar-placeholder", t("rubricNotPublished")))
        }
        const create = node(
            "button",
            "rubric-create primary",
            t(state.evaluationRubricVersion ? "editRubric" : "generateRubric"),
        )
        create.type = "button"
        create.dataset.createRubric = state.evaluationDatasetId ?? ""
        create.disabled = !evaluationDataset()?.skillReference
        scroll.append(create)
        return
    }

    const overview = node("div", "curation-overview")
    overview.append(
        node("span", "case-kind", `v${state.evaluationRubricVersion?.version ?? 0} → draft`),
        node("span", `curation-status ${session.status}`, curationStatusLabel(session.status)),
    )
    const agentModel = session.rubricAgent.effectiveModelId ?? session.rubricAgent.modelId ?? t("runtimeDefault")
    const agentEffort = session.rubricAgent.effectiveEffort ?? session.rubricAgent.effort ?? t("runtimeDefaultEffort")
    scroll.append(
        overview,
        node("div", "curation-provenance", `${session.skillReference.name} · ${agentModel} · ${agentEffort}`),
    )
    if (session.draft) {
        const details = document.createElement("details")
        details.className = "curation-reference-card"
        const summary = document.createElement("summary")
        summary.append(
            node("span", "curation-reference-check", "✓"),
            node("strong", "", t("rubricReady")),
            node("small", "", session.draft.title),
        )
        details.append(summary, renderRubricDraft(session.draft))
        scroll.append(details)
    }
    const conversation = node("section", "curator-conversation")
    conversation.append(node("h3", "", t("rubricConversation")))
    for (const message of session.conversation ?? []) {
        const bubble = node("article", `curator-message ${message.role}`)
        bubble.append(
            node("span", "curator-role", message.role === "assistant" ? "Rubric Agent" : t("you")),
        )
        const body = node("div")
        appendSafeMessageMarkdown(body, rubricConversationText(message))
        bubble.append(body)
        conversation.append(bubble)
    }
    renderRubricActivity(conversation, session)
    if (session.error) {
        const error = node("div", "curation-error")
        error.append(node("span", "", session.error))
        if (session.status === "failed") {
            const retry = node("button", "", t("retry"))
            retry.type = "button"
            retry.dataset.retryRubric = session.id
            error.append(retry)
        }
        conversation.append(error)
    }
    scroll.append(conversation)

    const composerWrap = node("div", "curation-composer-wrap")
    const form = node("form", "curation-followup")
    form.dataset.rubricForm = session.id
    const input = node("textarea")
    input.rows = 3
    input.maxLength = 120000
    input.placeholder = t("rubricPromptPlaceholder")
    input.disabled = session.status === "queued" || session.status === "running"
    input.dataset.rubricInput = session.id
    input.value = state.rubricInputDrafts.get(session.id) ?? ""
    const footer = node("div", "curation-followup-footer")
    const model = node("select", "model-picker")
    model.dataset.rubricModel = session.id
    model.disabled = input.disabled
    populateModelSelect(model, session.rubricAgent.modelId)
    const effort = node("select", "effort-picker")
    effort.dataset.rubricEffort = session.id
    effort.disabled = input.disabled
    populateEffortSelect(effort, session.rubricAgent.effort, session.rubricAgent.modelId)
    const send = node("button", "", t("send"))
    send.type = "submit"
    send.disabled = input.disabled
    footer.append(model, effort, send)
    form.append(input, footer)
    const actions = node("div", "curation-actions")
    const discard = node("button", "curation-discard", t("discard"))
    discard.type = "button"
    discard.dataset.discardRubric = session.id
    actions.append(discard)
    if (session.status === "needs_review" && session.draft) {
        const publish = node("button", "curation-done primary", t("publishRubric"))
        publish.type = "button"
        publish.dataset.publishRubric = session.id
        actions.append(publish)
    }
    composerWrap.append(form, actions)
    elements.rubricDetail.append(composerWrap)
}

function renderAll(options) {
    streamRenderQueue.cancel()
    liveActivityRenderQueue.cancel()
    renderWorkspace()
    renderRuntime()
    renderThreads()
    renderRawCases()
    renderTitle()
    const chat = state.surface === "chat"
    elements.topbarCurations.classList.toggle("hidden", !chat)
    elements.topbarTrace.classList.toggle("hidden", !chat)
    if (chat) {
        renderConversation(options)
        renderComposer()
    }
    renderRuntimeOptions()
    renderEvaluationWorkbench()
    renderSkillManagementWorkbench()
    renderOperatorWorkbench()
    renderRubricDrawer()
}

function queueRender(options = {}) {
    streamRenderQueue.cancel()
    liveActivityRenderQueue.cancel()
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

function clearCaseError() {
    elements.caseCreateError.textContent = ""
    elements.caseCreateError.classList.add("hidden")
}

function showCaseError(error) {
    const message = error?.message || String(error)
    elements.caseCreateError.textContent = message.replace(
        /^Error invoking remote method '[^']+': Error:\s*/u,
        "",
    )
    elements.caseCreateError.classList.remove("hidden")
    elements.caseCreateError.scrollIntoView({block: "nearest"})
}

function setCaseCreationInProgress(inProgress) {
    state.caseCreationInProgress = Boolean(inProgress)
    elements.confirmSaveCase.disabled = state.caseCreationInProgress
    elements.closeCaseDialog.disabled = state.caseCreationInProgress
    elements.cancelSaveCase.disabled = state.caseCreationInProgress
}

let toastTimer = null
function showToast(message, options = {}) {
    clearTimeout(toastTimer)
    elements.toast.replaceChildren(node("span", "", message))
    if (options.actionLabel && typeof options.onAction === "function") {
        const action = node("button", "toast-action", options.actionLabel)
        action.type = "button"
        action.addEventListener("click", () => {
            clearTimeout(toastTimer)
            elements.toast.classList.add("hidden")
            options.onAction()
        }, {once: true})
        elements.toast.append(action)
    }
    elements.toast.classList.remove("hidden")
    toastTimer = setTimeout(
        () => elements.toast.classList.add("hidden"),
        options.durationMs ?? 2_600,
    )
}

function reportLinkOpenFailure(error, messageKey) {
    console.error("Unable to open message link", error)
    showToast(t(messageKey))
}

function evaluationDataset() {
    return selectedDataset(state.evaluationDatasetId)
}

function activeRubricSession() {
    return state.rubricSessions.find((entry) => entry.id === state.activeRubricSessionId) ??
        state.rubricSessions[0] ?? null
}

function rubricUsesUnifiedScoring(version) {
    return version?.rubric?.scoringModel === UNIFIED_SCORING_MODEL
}

function caseNeedsCalibration(entry) {
    return entry?.rubricCalibration?.status === "needed" || entry?.status === "needed"
}

function appendDatasetCalibrationNotice(version) {
    const pendingCases = state.evaluationCases.filter(
        caseNeedsCalibration,
    )
    if (!version || !pendingCases.length) return
    const batchSnapshot = calibrationBatchSnapshot()
    const relevantBatch = batchSnapshot?.datasetId === state.evaluationDatasetId &&
        batchSnapshot.rubricVersionId === version.id
        ? batchSnapshot
        : null
    const notice = node("div", "dataset-calibration-notice")
    const copy = node("span")
    copy.append(
        node("strong", "", t("caseNeedsCalibration")),
        node("small", "", formatMessage("casesNeedCalibration", {
            count: pendingCases.length,
            version: version.version,
        })),
    )
    if (relevantBatch) {
        copy.append(node("small", `calibration-batch-status ${relevantBatch.status}`, calibrationBatchStatusText(relevantBatch)))
    }
    const action = node(
        "button",
        relevantBatch?.status === "running"
            ? "dataset-calibration-action calibration-batch-stop"
            : "dataset-calibration-action",
        t(relevantBatch?.status === "running" ? "stopCalibrationBatch" : "calibrateAllCases"),
    )
    action.type = "button"
    if (relevantBatch?.status === "running") action.dataset.stopCalibrationBatch = "true"
    else action.dataset.startCalibrationBatch = "true"
    notice.append(copy, action)
    elements.evaluationDatasetRubricStatus.append(notice)
}

function renderDatasetRubricStatus(dataset) {
    const version = state.evaluationRubricVersion
    const session = activeRubricSession()
    elements.evaluationDatasetRubricStatus.replaceChildren()
    elements.evaluationDatasetRubricStatus.className = "dataset-rubric-status"
    elements.manageDatasetRubric.disabled = !dataset?.skillReference
    if (session) {
        const working = session.status === "queued" || session.status === "running"
        const ready = session.status === "needs_review" && Boolean(session.draft)
        elements.evaluationDatasetRubricStatus.classList.add("draft")
        elements.evaluationDatasetRubricStatus.append(
            node("strong", "", t(working ? "rubricDraftRunning" : ready ? "rubricReady" : "failed")),
            node("small", "", session.draft?.title ?? session.error ?? ""),
        )
        appendDatasetCalibrationNotice(version)
        elements.manageDatasetRubric.textContent = t("manageRubric")
        return rubricUsesUnifiedScoring(version)
    }
    if (!version) {
        elements.evaluationDatasetRubricStatus.classList.add("missing")
        elements.evaluationDatasetRubricStatus.append(
            node("span", "", t("rubricNotPublished")),
        )
        elements.manageDatasetRubric.textContent = t("generateRubric")
        return false
    }
    if (!rubricUsesUnifiedScoring(version)) {
        elements.evaluationDatasetRubricStatus.classList.add("missing")
        const migration = node("div", "dataset-rubric-migration")
        const migrate = node("button", "dataset-rubric-migration-action", t("migrateLegacyRubric"))
        migrate.type = "button"
        migrate.dataset.migrateLegacyRubric = dataset.id
        migration.append(node("p", "", t("rubricNeedsUnified")), migrate)
        elements.evaluationDatasetRubricStatus.append(
            node("strong", "", version.rubric.title),
            node("small", "", formatMessage("rubricPublished", {
                version: version.version,
                count: version.rubric.criteria.length,
            })),
            migration,
        )
        elements.manageDatasetRubric.textContent = t("editRubric")
        return false
    }
    elements.evaluationDatasetRubricStatus.classList.add("ready")
    elements.evaluationDatasetRubricStatus.append(
        node("strong", "", version.rubric.title),
        node("small", "", formatMessage("rubricPublished", {
            version: version.version,
            count: version.rubric.criteria.length,
        })),
        node("p", "", version.rubric.summary),
    )
    appendDatasetCalibrationNotice(version)
    elements.manageDatasetRubric.textContent = t("editRubric")
    return true
}

function normalizedManagedSkills(value) {
    return {
        repositories: Array.isArray(value?.repositories) ? value.repositories : [],
        skills: Array.isArray(value?.skills) ? value.skills : [],
        versions: Array.isArray(value?.versions) ? value.versions : [],
    }
}

function managedSkillErrorMessage(error) {
    return (error?.message || String(error)).replace(
        /^Error invoking remote method '[^']+': Error:\s*/u,
        "",
    )
}

function managedRepositoryById(repositoryId) {
    return state.managedSkills.repositories.find((entry) => entry.id === repositoryId) ?? null
}

function managedSkillById(skillId) {
    return state.managedSkills.skills.find((entry) => entry.id === skillId) ?? null
}

function managedVersionsForSkill(skillId) {
    return state.managedSkills.versions.filter((entry) => entry.skillId === skillId)
}

function reconcileManagedSkillSelection() {
    let skill = managedSkillById(state.activeManagedSkillId)
    let repository = managedRepositoryById(state.activeManagedRepositoryId)
    if (!skill && repository) {
        skill = state.managedSkills.skills.find((entry) => entry.repositoryId === repository.id) ?? null
    }
    if (!skill) skill = state.managedSkills.skills[0] ?? null
    if (skill) repository = managedRepositoryById(skill.repositoryId)
    if (!repository) repository = state.managedSkills.repositories[0] ?? null
    state.activeManagedRepositoryId = repository?.id ?? null
    state.activeManagedSkillId = skill?.id ?? null
    if (state.managedSkillDetail?.skill?.id !== state.activeManagedSkillId) {
        state.managedSkillDetail = null
    }
}

async function readActiveManagedSkill() {
    const skillId = state.activeManagedSkillId
    if (!skillId) {
        state.managedSkillDetail = null
        return
    }
    state.managedSkillLoading = true
    renderSkillManagementWorkbench()
    try {
        const detail = await window.rollingSkill.readManagedSkill(skillId)
        if (state.activeManagedSkillId === skillId) state.managedSkillDetail = detail
    } catch (error) {
        if (state.activeManagedSkillId === skillId) {
            state.managedSkillDetail = null
            state.managedSkillError = managedSkillErrorMessage(error)
        }
    } finally {
        if (state.activeManagedSkillId === skillId) state.managedSkillLoading = false
        renderSkillManagementWorkbench()
    }
}

async function loadManagedSkills(loadDetail = true) {
    state.managedSkillLoading = true
    state.managedSkillError = null
    renderSkillManagementWorkbench()
    try {
        state.managedSkills = normalizedManagedSkills(await window.rollingSkill.listManagedSkills())
        reconcileManagedSkillSelection()
        if (loadDetail && state.activeManagedSkillId) {
            await Promise.all([
                readActiveManagedSkill(),
                loadManagedSkillInstallations(state.activeManagedSkillId),
            ])
        }
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
    } finally {
        state.managedSkillLoading = false
        renderSkillManagementWorkbench()
    }
}

async function rescanManagedSkills() {
    state.managedSkillLoading = true
    state.managedSkillError = null
    renderSkillManagementWorkbench()
    try {
        const result = await window.rollingSkill.rescanManagedSkills()
        state.managedSkills = normalizedManagedSkills(result)
        reconcileManagedSkillSelection()
        if (result.failures?.length) {
            state.managedSkillError = result.failures
                .map((entry) => entry.message)
                .filter(Boolean)
                .join("\n")
        }
        if (state.activeManagedSkillId) {
            await Promise.all([
                readActiveManagedSkill(),
                loadManagedSkillInstallations(state.activeManagedSkillId),
            ])
        }
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
    } finally {
        state.managedSkillLoading = false
        renderSkillManagementWorkbench()
    }
}

async function selectManagedSkill(skillId) {
    const skill = managedSkillById(skillId)
    if (!skill) return
    state.activeManagedSkillId = skill.id
    state.activeManagedRepositoryId = skill.repositoryId
    state.managedSkillDetail = null
    state.managedSkillError = null
    state.managedInstallVersionId = null
    state.activeSkillInstallationJobId = null
    renderSkillManagementWorkbench()
    await Promise.all([readActiveManagedSkill(), loadManagedSkillInstallations(skill.id)])
}

async function importManagedSkill(kind, location = null) {
    state.managedSkillMutation = true
    state.managedSkillError = null
    renderSkillManagementWorkbench()
    try {
        const result = await window.rollingSkill.importManagedSkill({kind, location})
        if (result?.cancelled) return
        state.activeManagedRepositoryId = result.repository?.id ?? state.activeManagedRepositoryId
        state.activeManagedSkillId = result.skills?.find((entry) => entry.status === "valid")?.id ?? null
        showToast(t("managedSkillImported"))
        await loadManagedSkills(true)
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
    } finally {
        state.managedSkillMutation = false
        renderSkillManagementWorkbench()
    }
}

async function importManagedGitUrl() {
    const location = elements.managedGitUrl.value
    clearManagedDialogError(elements.managedGitUrlError)
    state.managedSkillMutation = true
    elements.confirmManagedGitUrl.disabled = true
    elements.cancelManagedGitUrl.disabled = true
    elements.closeManagedGitUrlDialog.disabled = true
    renderSkillManagementWorkbench()
    let succeeded = false
    try {
        const result = await window.rollingSkill.importManagedSkill({
            kind: "git-url",
            location,
        })
        if (result?.cancelled) return
        state.activeManagedRepositoryId = result.repository?.id ?? state.activeManagedRepositoryId
        state.activeManagedSkillId = result.skills?.find((entry) => entry.status === "valid")?.id ?? null
        showToast(t("managedSkillImported"))
        await loadManagedSkills(true)
        succeeded = true
    } catch (error) {
        showManagedDialogError(elements.managedGitUrlError, error)
    } finally {
        state.managedSkillMutation = false
        elements.confirmManagedGitUrl.disabled = false
        elements.cancelManagedGitUrl.disabled = false
        elements.closeManagedGitUrlDialog.disabled = false
        renderSkillManagementWorkbench()
        if (succeeded) elements.managedGitUrlDialog.close()
    }
}

function showManagedDialogError(element, error) {
    element.textContent = managedSkillErrorMessage(error)
    element.classList.remove("hidden")
}

function clearManagedDialogError(element) {
    element.textContent = ""
    element.classList.add("hidden")
}

async function createManagedSkillCandidate() {
    const skillId = state.managedCandidateSkillId
    if (!skillId) return
    clearManagedDialogError(elements.managedCandidateError)
    elements.confirmManagedCandidate.disabled = true
    try {
        await window.rollingSkill.createManagedSkillCandidate({
            skillId,
            message: elements.managedCandidateMessage.value,
        })
        elements.managedCandidateDialog.close()
        showToast(t("managedCandidateCreated"))
        await loadManagedSkills(true)
    } catch (error) {
        showManagedDialogError(elements.managedCandidateError, error)
    } finally {
        elements.confirmManagedCandidate.disabled = false
    }
}

async function releaseManagedSkillVersion() {
    const versionId = state.managedReleaseVersionId
    if (!versionId) return
    clearManagedDialogError(elements.managedReleaseError)
    elements.confirmManagedRelease.disabled = true
    try {
        const released = await window.rollingSkill.releaseManagedSkillVersion({
            versionId,
            versionLabel: elements.managedReleaseLabel.value,
        })
        state.managedInstallVersionId = released?.id ?? null
        elements.managedReleaseDialog.close()
        showToast(t("installationOpenAfterRelease"), {
            actionLabel: t("openRuntimeInstallations"),
            onAction: () => {
                state.managedSkillSideView = "installations"
                renderSkillManagementWorkbench()
                void refreshManagedInstallationRuntimeModels(false)
                void loadManagedSkillInstallations(state.activeManagedSkillId)
            },
            durationMs: 7_000,
        })
        await loadManagedSkills(true)
    } catch (error) {
        showManagedDialogError(elements.managedReleaseError, error)
    } finally {
        elements.confirmManagedRelease.disabled = false
    }
}

async function deprecateManagedSkillVersion(versionId) {
    state.managedSkillMutation = true
    state.managedSkillError = null
    renderSkillManagementWorkbench()
    try {
        await window.rollingSkill.deprecateManagedSkillVersion({versionId})
        showToast(t("managedVersionDeprecated"))
        await loadManagedSkills(true)
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
    } finally {
        state.managedSkillMutation = false
        renderSkillManagementWorkbench()
    }
}

const TERMINAL_SKILL_INSTALLATION_STATUSES = new Set([
    "succeeded",
    "failed",
    "cancelled",
    "unverified",
])

function normalizedSkillInstallationOverview(value = {}) {
    return {
        jobs: Array.isArray(value.jobs) ? value.jobs : [],
        matrix: Array.isArray(value.matrix) ? value.matrix : [],
    }
}

function skillInstallationStatusLabel(status) {
    const key = {
        queued: "installationStatusQueued",
        running: "installationStatusRunning",
        awaiting_permission: "installationStatusAwaitingPermission",
        awaiting_confirmation: "installationStatusAwaitingConfirmation",
        verifying: "installationStatusVerifying",
        succeeded: "installationStatusSucceeded",
        failed: "installationStatusFailed",
        cancelled: "installationStatusCancelled",
        unverified: "installationStatusUnverified",
    }[status]
    return key ? t(key) : String(status ?? t("none"))
}

function releasedManagedVersions(skillId) {
    return managedVersionsForSkill(skillId).filter((version) => version.state === "released")
}

function ensureManagedInstallVersion(skillId = state.activeManagedSkillId) {
    const versions = skillId ? releasedManagedVersions(skillId) : []
    if (!versions.some((entry) => entry.id === state.managedInstallVersionId)) {
        state.managedInstallVersionId = versions[0]?.id ?? null
    }
    return versions
}

function ensureManagedInstallConfigurations() {
    const runtimes = state.runtime?.availableRuntimes ?? []
    const availableIds = new Set(runtimes.map((runtime) => runtime.runtimeId))
    for (const runtimeId of Object.keys(state.managedInstallConfigurations)) {
        if (!availableIds.has(runtimeId)) delete state.managedInstallConfigurations[runtimeId]
    }
    for (const runtime of runtimes) {
        const current = state.managedInstallConfigurations[runtime.runtimeId]
        if (current) {
            current.runtime = runtime
            continue
        }
        const active = runtime.runtimeId === state.runtime?.runtime?.runtimeId
        state.managedInstallConfigurations[runtime.runtimeId] = {
            runtime,
            selected: active,
            modelId: active ? state.settings.taskProfile?.modelId ?? null : null,
            effort: active ? state.settings.taskProfile?.effort ?? null : null,
            permissionMode: defaultPermissionMode(runtime.providerId),
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
    return Object.values(state.managedInstallConfigurations)
}

async function refreshManagedInstallationRuntimeModels(forceReload = false) {
    const configurations = ensureManagedInstallConfigurations().filter(
        (configuration) => forceReload || !configuration.models.length,
    )
    for (const configuration of configurations) {
        configuration.loading = true
        configuration.error = null
    }
    if (state.surface === "skills" && state.managedSkillSideView === "installations") {
        renderManagedSkillInstallations()
    }
    await Promise.all(configurations.map(async (configuration) => {
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
    }))
    if (state.surface === "skills" && state.managedSkillSideView === "installations") {
        renderManagedSkillInstallations()
    }
}

function mergeSkillInstallationJob(job) {
    if (!job?.id || job.request?.source?.skillId !== state.activeManagedSkillId) return false
    const jobs = state.skillInstallations.jobs
    const index = jobs.findIndex((entry) => entry.id === job.id)
    if (index < 0) jobs.unshift(job)
    else jobs[index] = job
    jobs.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    if (!state.activeSkillInstallationJobId) state.activeSkillInstallationJobId = job.id
    return true
}

async function loadManagedSkillInstallations(skillId = state.activeManagedSkillId) {
    if (!skillId) {
        state.skillInstallations = {jobs: [], matrix: []}
        state.activeSkillInstallationJobId = null
        renderManagedSkillInstallations()
        return
    }
    state.managedInstallationLoading = true
    if (state.surface === "skills") renderManagedSkillInstallations()
    try {
        const overview = normalizedSkillInstallationOverview(
            await window.rollingSkill.listSkillInstallations(skillId),
        )
        if (state.activeManagedSkillId !== skillId) return
        state.skillInstallations = overview
        if (!overview.jobs.some((entry) => entry.id === state.activeSkillInstallationJobId)) {
            state.activeSkillInstallationJobId = overview.jobs[0]?.id ?? null
        }
    } catch (error) {
        if (state.activeManagedSkillId === skillId) {
            state.managedSkillError = managedSkillErrorMessage(error)
        }
    } finally {
        if (state.activeManagedSkillId === skillId) state.managedInstallationLoading = false
        if (state.surface === "skills") renderManagedSkillInstallations()
    }
}

function managedInstallMatrixFor(runtimeId) {
    return state.skillInstallations.matrix.find((entry) => entry.runtimeId === runtimeId) ?? null
}

function managedVersionDisplay(versionId) {
    const version = state.managedSkills.versions.find((entry) => entry.id === versionId)
    return version?.versionLabel ?? version?.commit?.slice(0, 8) ?? versionId
}

function renderManagedInstallRuntime(configuration) {
    const runtime = configuration.runtime
    const matrix = managedInstallMatrixFor(runtime.runtimeId)
    const row = node(
        "article",
        `managed-install-runtime-row${configuration.selected ? " selected" : ""}`,
    )
    row.dataset.managedInstallRuntimeId = runtime.runtimeId
    const heading = node("label", "managed-install-runtime-heading")
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.checked = configuration.selected
    checkbox.dataset.managedInstallRuntimeToggle = runtime.runtimeId
    const copy = node("span")
    copy.append(
        node("strong", "", `${runtime.displayName ?? runtime.providerId} ${runtime.version ?? ""}`.trim()),
        node("small", "", runtime.executablePath ?? runtime.runtimeId),
    )
    heading.append(checkbox, copy)
    row.append(heading)

    const current = node(
        "div",
        "managed-install-runtime-state",
        matrix?.versionId
            ? formatMessage("installationCurrentVersion", {
                version: managedVersionDisplay(matrix.versionId),
            })
            : t("installationNotVerified"),
    )
    if (matrix?.verification === "runtime-inventory") {
        current.append(` · ${t("installationRuntimeVerified")}`)
    } else if (matrix?.verification === "filesystem-only") {
        current.append(` · ${t("installationFilesystemOnly")}`)
    }
    if (matrix?.lastJobStatus) {
        current.append(` · ${formatMessage("installationLastJob", {
            status: skillInstallationStatusLabel(matrix.lastJobStatus),
        })}`)
    }
    row.append(current)

    const controls = node("div", "managed-install-runtime-controls")
    const model = node("select")
    model.dataset.managedInstallRuntimeModel = runtime.runtimeId
    populateModelSelect(
        model,
        configuration.modelId,
        t("installationRuntimeDefault"),
        configuration.models,
    )
    model.disabled = configuration.loading
    const effort = node("select")
    effort.dataset.managedInstallRuntimeEffort = runtime.runtimeId
    populateEffortSelect(
        effort,
        configuration.effort,
        configuration.modelId,
        configuration.models,
        runtime.efforts ?? [],
    )
    effort.disabled = configuration.loading || effort.options.length <= 1
    const permission = node("select")
    permission.dataset.managedInstallRuntimePermission = runtime.runtimeId
    const permissionOptions = permissionModeOptions(runtime.providerId, null)
    if (!permissionOptions.length) {
        const option = node("option", "", t("runtimeManagedAccess"))
        option.value = ""
        permission.append(option)
    } else {
        for (const entry of permissionOptions) {
            const option = node("option", "", entry.labelText ?? t(entry.label))
            option.value = entry.value
            permission.append(option)
        }
    }
    if (!permissionOptions.some((entry) => entry.value === configuration.permissionMode)) {
        configuration.permissionMode = permissionOptions[0]?.value ?? null
    }
    permission.value = configuration.permissionMode ?? ""
    controls.append(model, effort, permission)
    row.append(controls)
    if (configuration.error) row.append(node("small", "managed-skill-error", configuration.error))
    return row
}

function renderSkillInstallationQuestion(request) {
    const form = node("form", "managed-install-question")
    form.dataset.skillInstallationQuestionId = request.requestId
    form.dataset.skillInstallationJobId = request.jobId
    form.append(node("p", "", t("installationQuestionTitle")))
    for (const [index, question] of (request.questions ?? []).entries()) {
        const fieldset = document.createElement("fieldset")
        const legend = document.createElement("legend")
        legend.textContent = question.header
            ? `${question.header} · ${question.question}`
            : question.question
        fieldset.append(legend)
        const options = node("div", "managed-install-question-actions")
        for (const option of question.options ?? []) {
            const label = node("label")
            const input = document.createElement("input")
            input.type = question.multiSelect ? "checkbox" : "radio"
            input.name = `managed-install-question-${request.requestId}-${index}`
            input.value = option.label
            input.dataset.skillInstallationQuestionOption = String(index)
            label.append(input, document.createTextNode(option.label))
            options.append(label)
        }
        fieldset.append(options)
        const custom = document.createElement("input")
        custom.type = "text"
        custom.placeholder = t("runtimeQuestionCustom")
        custom.dataset.skillInstallationQuestionCustom = String(index)
        fieldset.append(custom)
        form.append(fieldset)
    }
    const error = node("p", "runtime-question-error hidden")
    error.dataset.skillInstallationQuestionError = "true"
    const actions = node("div", "managed-install-question-actions")
    const cancel = node("button", "", t("runtimeQuestionCancel"))
    cancel.type = "button"
    cancel.dataset.cancelSkillInstallationQuestion = request.requestId
    const submit = node("button", "primary", t("runtimeQuestionSubmit"))
    submit.type = "submit"
    actions.append(cancel, submit)
    form.append(error, actions)
    return form
}

function renderManagedSkillInstallationSession(job) {
    elements.managedInstallSession.replaceChildren()
    elements.inspectManagedSkillInstallation.classList.add("hidden")
    elements.cancelManagedSkillInstallation.classList.add("hidden")
    if (!job) return
    const head = node("div", "managed-skill-panel-head")
    head.append(
        node("span", "", t("installationSession")),
        node(
            "strong",
            "",
            job.conversationStatus === "running"
                ? `${skillInstallationStatusLabel(job.status)} · ${t("installerConversationRunning")}`
                : skillInstallationStatusLabel(job.status),
        ),
    )
    elements.managedInstallSession.append(head)
    if (job.parsedResult) {
        const summary = node("dl", "managed-install-result")
        for (const [label, value] of [
            [t("installationDestination"), job.parsedResult.destination ?? t("none")],
            [t("installationClassification"), job.parsedResult.classificationBefore ?? t("none")],
            [t("installationVerification"), job.parsedResult.verification ?? t("none")],
        ]) {
            summary.append(node("dt", "", label), node("dd", "", value))
        }
        elements.managedInstallSession.append(summary)
    }
    const timeline = node("div", "managed-install-timeline")
    if (!job.timeline?.length) {
        timeline.append(node("div", "managed-skill-empty", t("installationNoTimeline")))
    }
    for (const entry of job.timeline ?? []) {
        if (entry.kind === "message") {
            const item = node("div", `managed-install-timeline-item ${entry.role ?? "assistant"}`)
            appendSafeMessageMarkdown(item, entry.content ?? "")
            timeline.append(item)
            continue
        }
        const label = entry.command
            ? formatMessage("installationCommand", {command: entry.command})
            : formatMessage("installationTool", {name: entry.name ?? entry.type ?? t("none")})
        timeline.append(node("div", "managed-install-timeline-item tool", label))
    }
    elements.managedInstallSession.append(timeline)
    const question = [...state.pendingSkillInstallationQuestions.values()].find(
        (entry) => entry.jobId === job.id,
    )
    if (question) elements.managedInstallSession.append(renderSkillInstallationQuestion(question))
    if (job.error?.message) {
        elements.managedInstallSession.append(node("p", "managed-skill-error", job.error.message))
    }
    if (job.conversationError?.message) {
        elements.managedInstallSession.append(
            node("p", "managed-skill-error", job.conversationError.message),
        )
    }
    if (TERMINAL_SKILL_INSTALLATION_STATUSES.has(job.status)) {
        const form = node("form", "managed-install-composer")
        form.dataset.skillInstallationMessageForm = job.id
        const input = document.createElement("textarea")
        input.rows = 2
        input.maxLength = 120_000
        input.placeholder = t("installerMessagePlaceholder")
        input.value = state.skillInstallationInputDrafts.get(job.id) ?? ""
        input.dataset.skillInstallationMessageInput = job.id
        input.disabled = job.conversationStatus === "running"
        const send = node("button", "primary", t("sendInstallerMessage"))
        send.type = "submit"
        send.disabled = job.conversationStatus === "running"
        form.append(input, send)
        elements.managedInstallSession.append(form)
    }
    if (!TERMINAL_SKILL_INSTALLATION_STATUSES.has(job.status) || job.conversationStatus === "running") {
        elements.cancelManagedSkillInstallation.classList.remove("hidden")
        elements.cancelManagedSkillInstallation.dataset.jobId = job.id
        elements.cancelManagedSkillInstallation.title = t("installationStop")
    } else {
        elements.inspectManagedSkillInstallation.classList.remove("hidden")
        elements.inspectManagedSkillInstallation.dataset.jobId = job.id
    }
}

function renderManagedSkillInstallations() {
    const active = state.managedSkillSideView === "installations"
    elements.managedSkillVersions.classList.toggle("hidden", active)
    elements.managedSkillInstallations.classList.toggle("hidden", !active)
    for (const button of elements.managedSkillSideTabs.querySelectorAll(
        "[data-managed-skill-side-view]",
    )) {
        const selected = button.dataset.managedSkillSideView === state.managedSkillSideView
        button.classList.toggle("active", selected)
        button.setAttribute("aria-selected", String(selected))
    }
    if (!active) return

    const skill = managedSkillById(state.activeManagedSkillId)
    const versions = ensureManagedInstallVersion(skill?.id)
    elements.managedInstallVersion.replaceChildren()
    if (!versions.length) {
        const option = node("option", "", t("noReleasedVersions"))
        option.value = ""
        elements.managedInstallVersion.append(option)
    } else {
        for (const version of versions) {
            const option = node(
                "option",
                "",
                `${version.versionLabel ?? version.commit.slice(0, 8)} · ${version.commit.slice(0, 8)}`,
            )
            option.value = version.id
            elements.managedInstallVersion.append(option)
        }
    }
    elements.managedInstallVersion.value = state.managedInstallVersionId ?? ""
    elements.managedInstallVersion.disabled = !versions.length || state.managedInstallationStarting

    const configurations = ensureManagedInstallConfigurations()
    elements.managedInstallRuntimeList.replaceChildren()
    if (!configurations.length) {
        elements.managedInstallRuntimeList.append(
            node("div", "managed-skill-empty", t("noRuntimeInstallations")),
        )
    }
    for (const configuration of configurations) {
        elements.managedInstallRuntimeList.append(renderManagedInstallRuntime(configuration))
    }
    elements.startManagedSkillInstallations.disabled =
        state.managedInstallationStarting ||
        !skill ||
        !versions.length ||
        !configurations.some((entry) => entry.selected && !entry.loading)

    elements.managedInstallJobList.replaceChildren()
    const jobs = state.skillInstallations.jobs
    if (!jobs.length) {
        elements.managedInstallJobList.append(
            node("div", "managed-skill-empty", state.managedInstallationLoading
                ? t("loadingTask")
                : t("noInstallationJobs")),
        )
    }
    for (const job of jobs) {
        const button = node("button", "managed-install-job")
        button.type = "button"
        button.dataset.skillInstallationJobId = job.id
        if (job.id === state.activeSkillInstallationJobId) button.classList.add("active")
        const copy = node("span", "managed-install-job-copy")
        copy.append(
            node("strong", "", `${job.runtime.displayName} · ${job.request.versionLabel}`),
            node("small", "", new Date(job.updatedAt ?? job.createdAt).toLocaleString(
                state.settings.language,
            )),
        )
        button.append(
            copy,
            node("span", `managed-install-status ${job.status}`, skillInstallationStatusLabel(job.status)),
        )
        elements.managedInstallJobList.append(button)
    }
    const activeJob = jobs.find((entry) => entry.id === state.activeSkillInstallationJobId) ?? null
    renderManagedSkillInstallationSession(activeJob)
}

async function startManagedSkillInstallations() {
    const skillId = state.activeManagedSkillId
    const versionId = state.managedInstallVersionId
    const targets = ensureManagedInstallConfigurations()
        .filter((configuration) => configuration.selected)
        .map((configuration) => ({
            runtimeId: configuration.runtime.runtimeId,
            modelId: configuration.modelId || null,
            effort: configuration.effort || null,
            permissionMode: configuration.permissionMode || null,
        }))
    if (!skillId || !versionId || !targets.length) {
        showToast(t("selectRuntimeInstallTarget"))
        return
    }
    state.managedInstallationStarting = true
    renderManagedSkillInstallations()
    try {
        const jobs = await window.rollingSkill.startSkillInstallations({skillId, versionId, targets})
        for (const job of jobs ?? []) mergeSkillInstallationJob(job)
        state.activeSkillInstallationJobId = jobs?.[0]?.id ?? state.activeSkillInstallationJobId
        showToast(t("installationQueued"))
    } catch (error) {
        state.managedSkillError = `${t("installationFailedToStart")}: ${managedSkillErrorMessage(error)}`
    } finally {
        state.managedInstallationStarting = false
        renderSkillManagementWorkbench()
    }
}

async function cancelManagedSkillInstallation(jobId) {
    try {
        const job = await window.rollingSkill.cancelSkillInstallation(jobId)
        mergeSkillInstallationJob(job)
        showToast(t("installationStopped"))
        renderManagedSkillInstallations()
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
        renderSkillManagementWorkbench()
    }
}

async function inspectManagedSkillInstallation(jobId) {
    try {
        const job = await window.rollingSkill.inspectSkillInstallation(jobId)
        mergeSkillInstallationJob(job)
        state.activeSkillInstallationJobId = job.id
        showToast(t("inspectionQueued"))
        renderManagedSkillInstallations()
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
        renderSkillManagementWorkbench()
    }
}

async function sendSkillInstallationMessage(jobId, text) {
    text = String(text ?? "").trim()
    if (!text) return
    try {
        const job = await window.rollingSkill.sendSkillInstallationMessage(jobId, text)
        state.skillInstallationInputDrafts.delete(jobId)
        mergeSkillInstallationJob(job)
        renderManagedSkillInstallations()
    } catch (error) {
        state.managedSkillError = managedSkillErrorMessage(error)
        renderSkillManagementWorkbench()
    }
}

async function respondSkillInstallationQuestion(form, {cancelled = false} = {}) {
    const requestId = form.dataset.skillInstallationQuestionId
    const jobId = form.dataset.skillInstallationJobId
    const request = state.pendingSkillInstallationQuestions.get(requestId)
    if (!request) return
    const answers = []
    if (!cancelled) {
        for (const [index, question] of (request.questions ?? []).entries()) {
            const selected = [...form.querySelectorAll(
                `[data-skill-installation-question-option="${index}"]:checked`,
            )].map((input) => input.value)
            const custom = form.querySelector(
                `[data-skill-installation-question-custom="${index}"]`,
            )?.value.trim() ?? ""
            const valid = question.multiSelect
                ? selected.length > 0 || Boolean(custom)
                : selected.length === 1 !== Boolean(custom)
            if (!valid) {
                const error = form.querySelector("[data-skill-installation-question-error]")
                error.textContent = t("runtimeQuestionRequired")
                error.classList.remove("hidden")
                return
            }
            answers.push({id: question.id, selected, ...(custom ? {custom} : {})})
        }
    }
    for (const control of form.querySelectorAll("button, input")) control.disabled = true
    try {
        await window.rollingSkill.respondSkillInstallationQuestion({
            requestId,
            jobId,
            cancelled,
            answers,
        })
        state.pendingSkillInstallationQuestions.delete(requestId)
        renderManagedSkillInstallations()
    } catch (error) {
        for (const control of form.querySelectorAll("button, input")) control.disabled = false
        state.managedSkillError = managedSkillErrorMessage(error)
        renderSkillManagementWorkbench()
    }
}

function managedSkillStatusLabel(skill) {
    if (skill.status === "missing") return t("managedMissing")
    if (skill.status !== "valid") return t("managedInvalid")
    return t("managedWorking")
}

function managedVersionStatus(version) {
    if (version.deprecatedAt) return {className: "deprecated", label: t("managedDeprecated")}
    if (version.state === "released") return {className: "released", label: t("managedReleased")}
    return {className: "candidate", label: t("managedCandidate")}
}

function renderSkillManagementWorkbench() {
    const visible = state.surface === "skills"
    elements.workbench.classList.toggle("skills-mode", visible)
    elements.skillManagementWorkbench.classList.toggle("hidden", !visible)
    for (const button of elements.surfaceSwitch.querySelectorAll("[data-surface]")) {
        button.classList.toggle("active", button.dataset.surface === state.surface)
    }
    if (!visible) return

    const {repositories, skills} = state.managedSkills
    elements.managedRepositoryCount.textContent = String(repositories.length)
    elements.managedSkillError.textContent = state.managedSkillError ?? ""
    elements.managedSkillError.classList.toggle("hidden", !state.managedSkillError)
    elements.refreshManagedSkills.disabled = state.managedSkillLoading || state.managedSkillMutation
    for (const button of elements.skillManagementWorkbench.querySelectorAll("[data-import-skill]")) {
        button.disabled = state.managedSkillMutation
    }

    elements.managedRepositoryList.replaceChildren()
    if (!repositories.length) {
        elements.managedRepositoryList.append(node("div", "managed-skill-empty", t("noManagedRepositories")))
    }
    for (const repository of repositories) {
        const card = node("section", "managed-repository-card")
        if (repository.id === state.activeManagedRepositoryId) card.classList.add("active")
        const head = node("button", "managed-repository-button")
        head.type = "button"
        head.dataset.managedRepositoryId = repository.id
        head.append(
            node("strong", "", repository.displayName),
            node("small", "", `${repository.source?.kind ?? "folder"} · ${repository.defaultBranch}`),
        )
        card.append(head)
        const skillList = node("div", "managed-repository-skills")
        for (const skill of skills.filter((entry) => entry.repositoryId === repository.id)) {
            const button = node("button", "managed-skill-row")
            button.type = "button"
            button.dataset.managedSkillId = skill.id
            if (skill.id === state.activeManagedSkillId) button.classList.add("active")
            const copy = node("span")
            copy.append(node("strong", "", skill.name), node("small", "", skill.skillRoot || "."))
            button.append(copy, node("span", `managed-status ${skill.status}`, managedSkillStatusLabel(skill)))
            skillList.append(button)
        }
        card.append(skillList)
        elements.managedRepositoryList.append(card)
    }

    elements.managedSkillDetail.replaceChildren()
    const skill = managedSkillById(state.activeManagedSkillId)
    const repository = skill ? managedRepositoryById(skill.repositoryId) : null
    if (!skill) {
        elements.managedSkillDetail.append(node("div", "managed-skill-empty", t("selectManagedSkill")))
    } else {
        const heading = node("div", "managed-detail-heading")
        const copy = node("div")
        copy.append(
            node("span", "panel-kicker", t("repositoryWorkingTree")),
            node("h2", "", skill.name),
            node("p", "", skill.description ?? skill.skillRoot),
        )
        const actions = node("div", "managed-detail-actions")
        const reveal = node("button", "", t("revealRepository"))
        reveal.type = "button"
        reveal.dataset.revealManagedRepository = repository?.id ?? ""
        const candidate = node("button", "primary", t("createCandidate"))
        candidate.type = "button"
        candidate.dataset.createManagedCandidate = skill.id
        candidate.disabled = state.managedSkillMutation || skill.status !== "valid"
        actions.append(reveal, candidate)
        heading.append(copy, actions)
        elements.managedSkillDetail.append(heading)
        if (skill.warnings?.length) {
            const warnings = node("ul", "managed-skill-warnings")
            for (const warning of skill.warnings) warnings.append(node("li", "", warning))
            elements.managedSkillDetail.append(warnings)
        }
        if (state.managedSkillLoading && !state.managedSkillDetail) {
            elements.managedSkillDetail.append(node("div", "managed-skill-empty", t("loadingTask")))
        } else if (state.managedSkillDetail?.manifest) {
            const manifest = node("pre", "managed-skill-manifest")
            manifest.textContent = state.managedSkillDetail.manifest
            elements.managedSkillDetail.append(manifest)
        }
    }

    elements.managedSkillVersions.replaceChildren()
    const versionsHead = node("div", "managed-skill-panel-head")
    const versions = skill ? managedVersionsForSkill(skill.id) : []
    versionsHead.append(node("span", "", t("managedVersions")), node("strong", "", String(versions.length)))
    elements.managedSkillVersions.append(versionsHead)
    if (!skill || !versions.length) {
        elements.managedSkillVersions.append(node("div", "managed-skill-empty", t("noManagedVersions")))
    }
    for (const version of versions) {
        const status = managedVersionStatus(version)
        const card = node("article", "managed-version-card")
        const heading = node("div", "managed-version-heading")
        heading.append(
            node("strong", "", version.versionLabel ?? version.commit.slice(0, 8)),
            node("span", `managed-version-status ${status.className}`, status.label),
        )
        card.append(
            heading,
            node("code", "managed-version-commit", version.commit),
            node("small", "", new Date(version.releasedAt ?? version.createdAt).toLocaleString(state.settings.language)),
        )
        const actions = node("div", "managed-version-actions")
        if (version.state === "candidate") {
            const release = node("button", "primary", t("releaseVersion"))
            release.type = "button"
            release.dataset.releaseManagedVersion = version.id
            actions.append(release)
        } else if (!version.deprecatedAt) {
            const deprecate = node("button", "", t("deprecateVersion"))
            deprecate.type = "button"
            deprecate.dataset.deprecateManagedVersion = version.id
            actions.append(deprecate)
        }
        card.append(actions)
        elements.managedSkillVersions.append(card)
    }
    renderManagedSkillInstallations()
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
    const refreshBatchRunning = refreshBatchSnapshot()?.status === "running"
    elements.openCaseRefreshBatch.disabled =
        !state.evaluationDatasetId || !state.evaluationCases.length || refreshBatchRunning
    renderCaseRefreshBatchStatus()
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
        const caseTitle = caseEntry.title || caseEntry.inputSummary || caseEntry.id
        const caseLabel = caseEntry.label || caseEntry.status || "case"
        button.append(
            node("span", `case-badge ${caseLabel}`, caseLabel),
            node("strong", "", caseTitle),
            node("small", "", caseEntry.outputSummary || ""),
        )
        let calibrate = null
        const maintenanceActions = node("div", "evaluation-case-maintenance-actions")
        if (caseNeedsCalibration(caseEntry)) {
            button.append(node("span", "case-calibration", t("caseNeedsCalibration")))
            const calibration = activeCalibrationForCase(caseEntry.id)
            calibrate = node(
                "button",
                "evaluation-case-calibrate",
                t(calibrationActionKey(calibration)),
            )
            calibrate.type = "button"
            calibrate.dataset.calibrateEvaluationCase = caseEntry.id
            calibrate.disabled =
                state.calibrationStartingCaseIds.has(caseEntry.id) ||
                Boolean(activeRefreshForCase(caseEntry.id))
            maintenanceActions.append(calibrate)
        }
        const refresh = activeRefreshForCase(caseEntry.id)
        const refreshButton = node(
            "button",
            "evaluation-case-refresh",
            t(refreshActionKey(refresh)),
        )
        refreshButton.type = "button"
        refreshButton.dataset.refreshEvaluationCase = caseEntry.id
        refreshButton.disabled =
            state.refreshStartingCaseIds.has(caseEntry.id) ||
            Boolean(activeCalibrationForCase(caseEntry.id))
        maintenanceActions.append(refreshButton)
        const remove = node("button", "hover-delete-button evaluation-case-delete", "×")
        remove.type = "button"
        remove.title = t("deleteCase")
        remove.setAttribute("aria-label", t("deleteCase"))
        remove.dataset.deleteEvaluationCase = caseEntry.id
        remove.disabled = Boolean(
            activeCalibrationForCase(caseEntry.id) || activeRefreshForCase(caseEntry.id),
        )
        row.append(button, maintenanceActions, remove)
        elements.evaluationCaseList.append(row)
    }

    populateSkillSelect(
        elements.evaluationNewDatasetSkill,
        elements.evaluationNewDatasetSkill.value,
        {allowEmpty: false},
    )
    const dataset = evaluationDataset()
    const skill = renderDatasetSkillStatus(elements.evaluationDatasetSkillStatus, dataset)
    const rubricReady = renderDatasetRubricStatus(dataset)
    elements.changeEvaluationDatasetSkill.textContent = t(dataset?.skillReference ? "changeSkill" : "bindDatasetSkill")
    elements.changeEvaluationDatasetSkill.disabled = !dataset
    elements.exportEvaluationDataset.disabled = !dataset
    renderEvaluationRuntimeConfigurations(skill)
    renderEvaluationJudgeConfiguration()
    renderEvaluationRuns()
    const selectedRuntimeCount = Object.values(state.evaluationRuntimeConfigurations).filter(
        (configuration) => configuration.selected,
    ).length
    const judgeRuntime = selectedEvaluationJudgeRuntime()
    const judgeCatalog = judgeRuntime
        ? state.evaluationRuntimeConfigurations[judgeRuntime.runtimeId]
        : null
    const judgeReady = Boolean(judgeRuntime) && !judgeCatalog?.loading && !judgeCatalog?.error
    const selectedCaseNeedsCalibration = caseNeedsCalibration(state.evaluationCases.find(
        (entry) => entry.id === state.evaluationCaseId,
    ))
    const datasetNeedsCalibration = state.evaluationCases.some(caseNeedsCalibration)
    elements.startEvaluation.disabled =
        state.evaluationLoading ||
        !state.evaluationCaseId ||
        !skill ||
        !rubricReady ||
        selectedCaseNeedsCalibration ||
        !selectedRuntimeCount ||
        !judgeReady
    elements.startDatasetEvaluation.disabled =
        state.evaluationLoading ||
        !state.evaluationCases.length ||
        !skill ||
        !rubricReady ||
        datasetNeedsCalibration ||
        !selectedRuntimeCount ||
        !judgeReady
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

function ensureEvaluationJudgeConfiguration() {
    ensureEvaluationRuntimeConfigurations()
    const runtimes = state.runtime?.availableRuntimes ?? []
    const current = state.evaluationJudgeConfiguration
    if (!runtimes.some((runtime) => runtime.runtimeId === current.runtimeId)) {
        const activeRuntimeId = state.runtime?.runtime?.runtimeId
        const runtime =
            runtimes.find((entry) => entry.runtimeId === activeRuntimeId) ?? runtimes[0] ?? null
        state.evaluationJudgeConfiguration = {
            runtimeId: runtime?.runtimeId ?? null,
            modelId: state.settings.judgeProfile?.modelId ?? null,
            effort: state.settings.judgeProfile?.effort ?? null,
        }
    }
    return state.evaluationJudgeConfiguration
}

function selectedEvaluationJudgeRuntime() {
    const configuration = ensureEvaluationJudgeConfiguration()
    return (state.runtime?.availableRuntimes ?? []).find(
        (runtime) => runtime.runtimeId === configuration.runtimeId,
    ) ?? null
}

function renderEvaluationJudgeConfiguration() {
    const configuration = ensureEvaluationJudgeConfiguration()
    const runtimes = state.runtime?.availableRuntimes ?? []
    const selectedRuntime = selectedEvaluationJudgeRuntime()
    elements.evaluationJudgeRuntime.replaceChildren()
    for (const runtime of runtimes) {
        const option = node(
            "option",
            "",
            `${runtime.displayName ?? runtime.providerId ?? runtime.runtimeId}${runtime.version ? ` ${runtime.version}` : ""}`,
        )
        option.value = runtime.runtimeId
        elements.evaluationJudgeRuntime.append(option)
    }
    elements.evaluationJudgeRuntime.value = configuration.runtimeId ?? ""

    const runtimeModels = selectedRuntime
        ? state.evaluationRuntimeConfigurations[selectedRuntime.runtimeId]?.models ?? []
        : []
    populateModelSelect(
        elements.evaluationJudgeModel,
        configuration.modelId,
        t("runtimeDefault"),
        runtimeModels,
    )
    populateEffortSelect(
        elements.evaluationJudgeEffort,
        configuration.effort,
        configuration.modelId,
        runtimeModels,
        selectedRuntime?.efforts ?? [],
    )
    configuration.modelId = elements.evaluationJudgeModel.value || null
    configuration.effort = elements.evaluationJudgeEffort.value || null
    const runtimeConfiguration = selectedRuntime
        ? state.evaluationRuntimeConfigurations[selectedRuntime.runtimeId]
        : null
    const disabled = !selectedRuntime || Boolean(runtimeConfiguration?.loading)
    elements.evaluationJudgeRuntime.disabled = !runtimes.length
    elements.evaluationJudgeModel.disabled = disabled
    elements.evaluationJudgeEffort.disabled = disabled
    elements.evaluationJudgeModelStatus.className = "evaluation-judge-model-status"
    if (runtimeConfiguration?.loading) {
        elements.evaluationJudgeModelStatus.classList.add("loading")
        elements.evaluationJudgeModelStatus.textContent = t("judgeModelsLoading")
    } else if (runtimeConfiguration?.error) {
        elements.evaluationJudgeModelStatus.classList.add("error")
        elements.evaluationJudgeModelStatus.textContent = formatMessage("judgeModelsUnavailable", {
            message: runtimeConfiguration.error,
        })
    } else if (selectedRuntime) {
        elements.evaluationJudgeModelStatus.classList.add("ready")
        elements.evaluationJudgeModelStatus.textContent = t("judgeModelsReady")
    } else {
        elements.evaluationJudgeModelStatus.textContent = t("noCompatibleRuntime")
    }
}

function evaluationJudgeRequestConfiguration() {
    const requested = ensureEvaluationJudgeConfiguration()
    const runtime = selectedEvaluationJudgeRuntime()
    if (!runtime) throw new Error(t("noCompatibleRuntime"))
    const catalog = state.evaluationRuntimeConfigurations[runtime.runtimeId]
    if (catalog?.loading) throw new Error(t("judgeModelsLoading"))
    if (catalog?.error) {
        throw new Error(formatMessage("judgeModelsUnavailable", {message: catalog.error}))
    }
    return {
        runtimeId: runtime.runtimeId,
        modelId: requested.modelId || null,
        effort: requested.effort || null,
    }
}

async function refreshEvaluationRuntimeModels(forceReload = false) {
    ensureEvaluationRuntimeConfigurations()
    const configurations = Object.values(state.evaluationRuntimeConfigurations).filter(
        (configuration) => forceReload || !configuration.models.length,
    )
    for (const configuration of configurations) {
        configuration.loading = true
        configuration.error = null
    }
    if (configurations.length && state.surface === "evaluation") {
        renderEvaluationJudgeConfiguration()
    }
    await Promise.all(
        configurations.map(async (configuration) => {
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

function gradingStatusLabel(status) {
    return t(
        {
            awaiting_execution: "gradingAwaitingExecution",
            queued: "gradingQueued",
            running: "gradingRunning",
            completed: "gradingCompleted",
            failed: "gradingFailed",
            skipped: "gradingSkipped",
        }[status] ?? "legacyUngraded",
    )
}

function evaluationRunStatusLabel(status) {
    return t(
        {
            queued: "executionQueued",
            running: "executionRunning",
            completed: "executionCompleted",
            partial: "executionPartial",
            failed: "executionFailed",
            cancelled: "executionCancelled",
        }[status] ?? "executionQueued",
    )
}

function evaluationResultQuality(result) {
    if (
        result.status === "cancelled" ||
        (result.gradingStatus === "skipped" && /cancelled by user/i.test(
            result.gradingError ?? result.judge?.error ?? "",
        ))
    ) {
        return "cancelled"
    }
    if (result.gradingStatus === "failed" || result.gradingStatus === "skipped") {
        return "grading_failed"
    }
    if (result.gradingStatus !== "completed" || !result.computedScore) return "pending"
    if (result.computedScore.outcomeTier === "formal_pass") return "passed"
    if (result.computedScore.outcomeTier === "usable_with_gaps") return "usable"
    if (result.computedScore.outcomeTier === "fail") return "failed"
    if (result.computedScore.outcomeTier === "diagnostic") return "diagnostic"
    if (result.computedScore.overallVerdict === "pass") return "passed"
    if (result.computedScore.overallVerdict === "fail") return "failed"
    if (result.computedScore.overallVerdict === "diagnostic") return "diagnostic"
    return "indeterminate"
}

function evaluationRunQualitySummary(run) {
    const counts = {passed: 0, usable: 0, failed: 0, indeterminate: 0, diagnostic: 0, pending: 0, grading_failed: 0, cancelled: 0}
    for (const result of run?.results ?? []) counts[evaluationResultQuality(result)] += 1
    const labels = {
        passed: "qualityPassed",
        usable: "qualityUsable",
        failed: "qualityFailed",
        indeterminate: "qualityIndeterminate",
        pending: "qualityPending",
        grading_failed: "qualityGradingFailed",
        cancelled: "qualityCancelled",
        diagnostic: "qualityDiagnostic",
    }
    const entries = Object.entries(counts)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => ({status, text: `${t(labels[status])} ${count}`}))
    if (!entries.length) entries.push({status: "pending", text: t("qualityPending")})
    return entries
}

function appendEvaluationQualitySummary(parent, run) {
    const summary = node("span", "evaluation-run-quality")
    for (const entry of evaluationRunQualitySummary(run)) {
        summary.append(node("span", `quality-status ${entry.status}`, entry.text))
    }
    parent.append(summary)
}

function resultScoreText(value, maxScore, range = null) {
    if (value !== null && value !== undefined) return `${value}/${maxScore}`
    if (range && range.min !== undefined && range.max !== undefined) {
        return `${range.min}–${range.max}/${maxScore}`
    }
    return `—/${maxScore}`
}

function displayTotalScore(computedScore) {
    if (Number.isFinite(computedScore?.totalScore)) return computedScore.totalScore
    if (!Number.isFinite(computedScore?.aScore) || !Number.isFinite(computedScore?.bScore)) {
        return null
    }
    return Math.round((computedScore.aScore + computedScore.bScore + Number.EPSILON) * 10) / 10
}

function bindingStatusLabel(status) {
    return t({
        verified: "bindingVerified",
        unverified: "bindingUnverified",
        "verified-by-trace": "bindingVerifiedByTrace",
        matched: "bindingMatched",
        mismatched: "bindingMismatched",
        name_only: "bindingNameOnly",
        not_observed: "bindingNotObserved",
    }[status] ?? "bindingUnverified")
}

function outcomeTierLabel(tier) {
    return t({
        formal_pass: "outcomeFormalPass",
        usable_with_gaps: "outcomeUsable",
        fail: "outcomeFail",
        diagnostic: "outcomeDiagnostic",
    }[tier] ?? "outcomeDiagnostic")
}

function evidenceText(refs) {
    return Array.isArray(refs) && refs.length ? refs.join(" · ") : t("none")
}

function verificationLines(assessment) {
    const lines = []
    if (assessment?.verificationStatus) {
        lines.push(`${t("verificationStatus")}: ${assessment.verificationStatus}`)
    }
    if (Array.isArray(assessment?.verifiableFields) && assessment.verifiableFields.length) {
        lines.push(`${t("verifiableFields")}: ${assessment.verifiableFields.map((entry) =>
            typeof entry === "string" ? entry : JSON.stringify(entry),
        ).join(" · ")}`)
    }
    if (Array.isArray(assessment?.crossChecks) && assessment.crossChecks.length) {
        lines.push(`${t("crossChecks")}: ${assessment.crossChecks.map((entry) =>
            typeof entry === "string" ? entry : JSON.stringify(entry),
        ).join(" · ")}`)
    }
    return lines
}

function renderScoreCriterion({section, title, scoreText, weightText, assessment, criterion, verification = []}) {
    const item = node("article", `evaluation-score-item ${section}`)
    const heading = node("div", "evaluation-score-item-head")
    heading.append(
        node("strong", "", title),
        node("span", "evaluation-score-points", scoreText),
        node("small", "", weightText),
    )
    const rationale = node("p", "evaluation-score-rationale")
    rationale.append(node("b", "", `${t("scoreReason")}: `), document.createTextNode(assessment?.rationale ?? t("none")))
    const evidence = node("p", "evaluation-score-evidence")
    evidence.append(node("b", "", `${t("scoreEvidence")}: `), document.createTextNode(evidenceText(assessment?.evidenceRefs)))
    item.append(heading)
    if (criterion) item.append(node("p", "evaluation-score-criterion", criterion))
    item.append(rationale, evidence)
    for (const line of verification) item.append(node("p", "evaluation-score-verification", line))
    return item
}

function appendEvaluationJudgeMetadata(detail, result, run) {
    const judge = result.judge ?? {}
    const skillBinding = result.skillExecutionBinding ?? null
    const effectiveBinding = skillBinding?.effectiveBinding ??
        result.runtimeConfiguration?.skillEvidenceBinding ??
        "unverified"
    if (effectiveBinding === "unverified") {
        detail.append(node("p", "evaluation-judge-meta", t("skillBindingDiagnostic")))
    } else if (effectiveBinding === "verified-by-trace") {
        detail.append(node("p", "evaluation-judge-meta", t("skillBindingTraceVerified")))
    }
    if (skillBinding) {
        detail.append(node("p", "evaluation-judge-meta", formatMessage("skillBindingStatus", {
            declared: bindingStatusLabel(skillBinding.declaredBinding),
            observed: bindingStatusLabel(skillBinding.observedBinding),
            effective: bindingStatusLabel(skillBinding.effectiveBinding),
        })))
    }
    detail.append(node(
        "p",
        "evaluation-judge-meta",
        [
            judge.displayName || run.judgeConfiguration?.displayName || judge.runtimeId,
            judge.modelId || t("runtimeDefault"),
            judge.effort || t("runtimeDefaultEffort"),
        ].filter(Boolean).join(" · "),
    ))
}

function renderUnifiedCompletedGrading(result, run) {
    const computedScore = result.computedScore
    const scoreContract = result.scoreContract ?? {}
    const judgment = result.judgment ?? {}
    const block = node("section", "evaluation-grading unified")
    const summary = node("div", "evaluation-score-summary unified")
    const total = node("div", "evaluation-score-total")
    const displayOutcomeTier = computedScore.outcomeTier ?? ({
        pass: "formal_pass",
        fail: "fail",
        diagnostic: "diagnostic",
    }[computedScore.overallVerdict] ?? "diagnostic")
    total.append(
        node("small", "", t("totalScore")),
        node("strong", "", resultScoreText(displayTotalScore(computedScore), 100)),
        node("span", `evaluation-outcome-tier ${displayOutcomeTier}`, outcomeTierLabel(displayOutcomeTier)),
    )
    summary.append(total)

    const detail = document.createElement("details")
    detail.className = "evaluation-grading-breakdown"
    detail.append(node("summary", "", t("judgeDetails")))
    appendEvaluationJudgeMetadata(detail, result, run)
    const list = node("section", "evaluation-score-section unified")
    list.append(node("h4", "", t("unifiedRubricScore")))
    for (const score of computedScore.criterionScores ?? []) {
        const criterion = scoreContract.criteria?.find((entry) => entry.id === score.id)
        const assessment = judgment.assessments?.find((entry) => entry.criterionId === score.id)
        const isPenalty = criterion?.mode === "penalty"
        const isAutomaticFailure = criterion?.mode === "automatic_failure"
        const confidence = assessment?.confidence === undefined
            ? null
            : `${t("confidence")} ${Math.round(assessment.confidence * 100)}%`
        const item = renderScoreCriterion({
            section: "unified",
            title: criterion?.title ?? criterion?.criterion ?? score.id,
            scoreText: isPenalty
                ? formatMessage("penaltyApplied", {
                      value: score.deduction ?? Math.abs(score.points),
                      maximum: criterion.maximumDeduction,
                  })
                : isAutomaticFailure
                  ? t(score.criticalFailureTriggered ? "automaticFailureTriggered" : "automaticFailureClear")
                  : `${score.points}/${score.maxPoints}`,
            weightText: [
                !isPenalty && !isAutomaticFailure
                    ? t("weight").replace("{value}", criterion?.weight ?? "—")
                    : null,
                isPenalty
                    ? formatMessage("avoidanceRating", {value: score.rating})
                    : isAutomaticFailure
                      ? null
                      : `${score.rating}/10`,
                confidence,
            ].filter(Boolean).join(" · "),
            assessment,
            criterion: criterion?.criterion,
            verification: verificationLines(assessment),
        })
        if (score.criticalFailureTriggered) {
            item.classList.add("critical-triggered")
            item.append(node("p", "evaluation-score-critical", t("criticalGateTriggered")))
        }
        list.append(item)
    }
    detail.append(list)
    block.append(summary, detail)
    return block
}

function renderCompletedGrading(result, run) {
    const computedScore = result.computedScore
    if (!computedScore) return null
    if (Array.isArray(computedScore.criterionScores)) {
        return renderUnifiedCompletedGrading(result, run)
    }
    const block = node("section", "evaluation-grading legacy")
    const summary = node("div", "evaluation-score-summary unified")
    const total = node("div", "evaluation-score-total")
    const displayOutcomeTier = computedScore.outcomeTier ?? ({
        pass: "formal_pass",
        fail: "fail",
        diagnostic: "diagnostic",
    }[computedScore.overallVerdict] ?? "diagnostic")
    total.append(
        node("small", "", t("totalScore")),
        node("strong", "", resultScoreText(displayTotalScore(computedScore), 100)),
        node(
            "span",
            `evaluation-outcome-tier ${displayOutcomeTier}`,
            outcomeTierLabel(displayOutcomeTier),
        ),
    )
    summary.append(total)

    const detail = document.createElement("details")
    detail.className = "evaluation-grading-breakdown"
    detail.append(
        node("summary", "", t("legacySplitGrading")),
        node("p", "evaluation-legacy-grading", t("legacySplitGradingHelp")),
    )
    appendEvaluationJudgeMetadata(detail, result, run)
    const scoreContract = result.scoreContract ?? {}
    const judgment = result.judgment ?? {}
    const legacyAssessments = [
        ...(judgment.aAssessments ?? []).map((assessment) => {
            const dimension = scoreContract.a?.dimensions?.find(
                (entry) => entry.id === assessment.dimensionId,
            )
            return {
                id: assessment.dimensionId,
                criterion: dimension?.criterion,
                assessment,
                scoreText: assessment.level === undefined ? assessment.status : `${assessment.level}/4`,
            }
        }),
        ...(judgment.bAssessments ?? []).map((assessment) => {
            const criterion = scoreContract.b?.criteria?.find(
                (entry) => entry.id === assessment.criterionId,
            )
            return {
                id: assessment.criterionId,
                criterion: criterion?.criterion,
                assessment,
                scoreText: assessment.rating === undefined ? assessment.status : `${assessment.rating}/10`,
            }
        }),
    ]
    if (legacyAssessments.length) {
        const list = node("section", "evaluation-score-section legacy")
        list.append(node("h4", "", t("legacySplitGrading")))
        for (const entry of legacyAssessments) {
            list.append(renderScoreCriterion({
                section: "legacy",
                title: entry.criterion ? `${entry.id} · ${entry.criterion}` : entry.id,
                scoreText: entry.scoreText,
                weightText: [
                    entry.assessment.status,
                    entry.assessment.confidence === undefined
                        ? null
                        : `${t("confidence")} ${Math.round(entry.assessment.confidence * 100)}%`,
                ].filter(Boolean).join(" · "),
                assessment: entry.assessment,
                verification: verificationLines(entry.assessment),
            }))
        }
        detail.append(list)
    }
    block.append(summary, detail)
    return block
}

function evaluationResultsByRuntime(run) {
    const groups = new Map()
    for (const configuration of run.runtimeConfigurations ?? []) {
        const runtimeId = configuration?.runtimeId
        if (!runtimeId || groups.has(runtimeId)) continue
        groups.set(runtimeId, {runtimeId, configuration: {...configuration}, results: []})
    }
    for (const [index, result] of (run.results ?? []).entries()) {
        const runtimeId = result.runtimeId ?? result.runtimeConfiguration?.runtimeId ?? `unknown-runtime-${index}`
        if (!groups.has(runtimeId)) {
            groups.set(runtimeId, {runtimeId, configuration: {}, results: []})
        }
        const group = groups.get(runtimeId)
        group.configuration = {...group.configuration, ...result.runtimeConfiguration, runtimeId}
        group.results.push(result)
    }
    return [...groups.values()].filter((group) => group.results.length)
}

function renderEvaluationRuntimeGroup(group, run, {panelId = null, tabId = null} = {}) {
    const section = node("section", "evaluation-runtime-result-group")
    section.dataset.evaluationRuntimeGroup = group.runtimeId
    section.setAttribute("role", "tabpanel")
    if (panelId) section.id = panelId
    if (tabId) section.setAttribute("aria-labelledby", tabId)
    const groupHeader = node("header", "evaluation-runtime-result-header")
    const identity = node("span", "evaluation-runtime-result-identity")
    identity.append(
        node("strong", "", group.configuration.displayName ?? group.runtimeId),
        node(
            "small",
            "",
            [
                group.configuration.modelId || t("runtimeDefault"),
                group.configuration.effort || t("runtimeDefaultEffort"),
                `${group.results.length} ${t("cases")}`,
            ].filter(Boolean).join(" · "),
        ),
    )
    groupHeader.append(identity)
    appendEvaluationQualitySummary(groupHeader, {results: group.results})
    const cases = node("div", "evaluation-runtime-result-cases")
    for (const result of group.results) cases.append(renderEvaluationResultCard(result, run))
    section.append(groupHeader, cases)
    return section
}

function renderEvaluationResultCard(result, run) {
    const card = node("article", "evaluation-result-card")
    const resultHeader = node("div", "evaluation-result-head")
    const statuses = node("div", "evaluation-result-statuses")
    const executionStatus = node(
        "span",
        `run-status ${result.status}`,
        `${t("executionStatus")} · ${evaluationRunStatusLabel(result.status)}`,
    )
    executionStatus.title = t("executionStatus")
    const hasGradingData = ["awaiting_execution", "queued", "running", "completed", "failed", "skipped"].includes(
        result.gradingStatus,
    )
    const gradingStatus = hasGradingData ? result.gradingStatus : null
    const gradingBadge = node(
        "span",
        `grading-status ${gradingStatus ?? "legacy"}`,
        gradingStatusLabel(gradingStatus),
    )
    gradingBadge.title = t("gradingStatus")
    statuses.append(executionStatus, gradingBadge)
    resultHeader.append(
        statuses,
        node("strong", "", result.title ?? result.caseSnapshot?.question ?? result.id),
        node(
            "small",
            "",
            [
                result.runtimeConfiguration?.modelId || t("runtimeDefault"),
                result.runtimeConfiguration?.effort || t("runtimeDefaultEffort"),
                result.durationMs === null || result.durationMs === undefined
                    ? null
                    : formatEvaluationDuration(result.durationMs),
            ].filter(Boolean).join(" · "),
        ),
    )
    card.append(resultHeader)
    if (gradingStatus === "completed") {
        const grading = renderCompletedGrading(result, run)
        if (grading) card.append(grading)
    } else if (gradingStatus === "failed" || gradingStatus === "skipped") {
        card.append(
            node(
                "p",
                "evaluation-grading-error",
                `${gradingStatusLabel(gradingStatus)}${result.gradingError || result.judge?.error ? ` · ${result.gradingError ?? result.judge.error}` : ""}`,
            ),
        )
    } else if (!hasGradingData) {
        card.append(node("p", "evaluation-legacy-grading", t("legacyUngraded")))
    }
    if (result.response || result.error) {
        const detail = document.createElement("details")
        detail.append(
            node("summary", "", result.error ? t("failed") : t("completed")),
            node("pre", "", result.error ?? result.response),
        )
        card.append(detail)
    }
    if (result.failureDiagnostics) {
        const diagnostics = document.createElement("details")
        diagnostics.className = "evaluation-failure-diagnostics"
        const lines = [
            result.failureDiagnostics.code,
            result.failureDiagnostics.threadId ? `thread: ${result.failureDiagnostics.threadId}` : null,
            result.failureDiagnostics.turnId ? `turn: ${result.failureDiagnostics.turnId}` : null,
            result.failureDiagnostics.lastActivityAt ? `last activity: ${result.failureDiagnostics.lastActivityAt}` : null,
            result.failureDiagnostics.traceReference,
        ].filter(Boolean)
        diagnostics.append(
            node("summary", "", t("runtimeTrace")),
            node("pre", "", lines.join("\n")),
        )
        card.append(diagnostics)
    }
    return card
}

function renderEvaluationRuns() {
    elements.evaluationRunCount.textContent = String(state.evaluationRuns.length)
    elements.evaluationRunList.replaceChildren()
    if (!state.evaluationRuns.length) {
        elements.evaluationRunList.append(node("div", "evaluation-empty", t("noRuns")))
    }
    for (const run of state.evaluationRuns) {
        const detailedRun = state.evaluationRunDetails[run.id] ?? run
        const row = node("article", "evaluation-run-row")
        const button = node("button", "evaluation-run-item")
        button.type = "button"
        button.dataset.evaluationRunId = run.id
        if (run.id === state.activeEvaluationRunId) button.classList.add("active")
        button.append(
            node("span", `run-status ${run.status}`, evaluationRunStatusLabel(run.status)),
            node("strong", "", run.datasetSnapshot?.name ?? run.datasetId),
            node(
                "small",
                "",
                `${run.caseCount ?? 0} Cases · ${run.runtimeCount ?? 0} runtimes · ${new Date(run.createdAt).toLocaleString(state.settings.language)}`,
            ),
        )
        appendEvaluationQualitySummary(button, detailedRun)
        row.append(button)
        if (run.status === "queued" || run.status === "running") {
            const cancel = node("button", "hover-delete-button evaluation-stop-control evaluation-run-cancel")
            cancel.type = "button"
            cancel.title = t("stopEvaluation")
            cancel.setAttribute("aria-label", t("stopEvaluation"))
            cancel.dataset.cancelEvaluationRun = run.id
            const icon = node("span", "evaluation-stop-icon")
            icon.setAttribute("aria-hidden", "true")
            cancel.append(icon)
            row.append(cancel)
        } else {
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
        node("span", `run-status ${run.status}`, evaluationRunStatusLabel(run.status)),
        node("h2", "", run.datasetSnapshot?.name ?? run.datasetId),
        node("p", "", `${run.skillReference?.name ?? "Skill"} · ${run.activationMode}`),
    )
    appendEvaluationQualitySummary(header, run)
    if (run.status === "queued" || run.status === "running") {
        const stop = node("button", "evaluation-stop-control evaluation-stop-button")
        stop.type = "button"
        stop.dataset.cancelEvaluationRun = run.id
        const icon = node("span", "evaluation-stop-icon")
        icon.setAttribute("aria-hidden", "true")
        stop.append(icon, node("span", "", t("stopEvaluation")))
        header.append(stop)
    }
    const groups = evaluationResultsByRuntime(run)
    const selectedRuntimeId = state.evaluationRuntimeViewByRun[run.id]
    const activeGroup = groups.find((group) => group.runtimeId === selectedRuntimeId) ?? groups[0] ?? null
    if (activeGroup) state.evaluationRuntimeViewByRun[run.id] = activeGroup.runtimeId

    const runtimeTabs = node("div", "evaluation-view-tabs evaluation-runtime-tabs")
    runtimeTabs.setAttribute("role", "tablist")
    let activePanelId = null
    let activeTabId = null
    for (const [index, group] of groups.entries()) {
        const active = group.runtimeId === activeGroup?.runtimeId
        const tab = node("button", active ? "active" : "")
        const tabId = `evaluation-runtime-tab-${run.id}-${index}`
        const panelId = `evaluation-runtime-panel-${run.id}-${index}`
        tab.type = "button"
        tab.id = tabId
        tab.dataset.evaluationRuntimeView = group.runtimeId
        tab.setAttribute("role", "tab")
        tab.setAttribute("aria-selected", String(active))
        tab.setAttribute("aria-controls", panelId)
        tab.tabIndex = active ? 0 : -1
        tab.append(
            node("span", "", group.configuration.displayName ?? group.runtimeId),
            node("small", "", String(group.results.length)),
        )
        runtimeTabs.append(tab)
        if (active) {
            activePanelId = panelId
            activeTabId = tabId
        }
    }

    const results = node("div", "evaluation-result-list")
    if (activeGroup) {
        results.append(renderEvaluationRuntimeGroup(activeGroup, run, {
            panelId: activePanelId,
            tabId: activeTabId,
        }))
    }
    elements.evaluationRunDetail.append(
        header,
        node("h3", "", t("runResults")),
        runtimeTabs,
        results,
    )
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
            if (!skill?.enabled) continue
            const key = skill.path || (
                skill.evidencePrecision === "name-only" && skill.name
                    ? `name-only:${skill.name}`
                    : null
            )
            if (!key) continue
            byPath.set(key, skill)
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
    state.evaluationSkills = runtimeSkills
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
        if (state.evaluationDatasetId) {
            const [activeRubric, rubricVersions, rubricSessions] = await Promise.all([
                window.rollingSkill.getActiveDatasetRubric(state.evaluationDatasetId),
                window.rollingSkill.listDatasetRubricVersions(state.evaluationDatasetId),
                window.rollingSkill.listRubricSessions(state.evaluationDatasetId),
            ])
            state.evaluationRubricVersion = activeRubric
            state.evaluationRubricVersions = rubricVersions
            state.rubricSessions = rubricSessions
            if (!rubricSessions.some((entry) => entry.id === state.activeRubricSessionId)) {
                state.activeRubricSessionId = rubricSessions[0]?.id ?? null
            }
        } else {
            state.evaluationRubricVersion = null
            state.evaluationRubricVersions = []
            state.rubricSessions = []
            state.activeRubricSessionId = null
        }
        if (!state.evaluationCases.some((entry) => entry.id === state.evaluationCaseId)) {
            state.evaluationCaseId = state.evaluationCases[0]?.id ?? null
        }
        await Promise.all([
            refreshRuntimeSkills(forceReload),
            refreshEvaluationRuntimeModels(forceReload),
        ])
        state.evaluationRuns = await window.rollingSkill.listEvaluationRuns()
        const runDetails = await Promise.all(
            state.evaluationRuns.map((run) => window.rollingSkill.getEvaluationRun(run.id)),
        )
        state.evaluationRunDetails = Object.fromEntries(runDetails.map((run) => [run.id, run]))
        if (!state.evaluationRuns.some((entry) => entry.id === state.activeEvaluationRunId)) {
            state.activeEvaluationRunId = state.evaluationRuns[0]?.id ?? null
        }
        state.activeEvaluationRun = state.activeEvaluationRunId
            ? state.evaluationRunDetails[state.activeEvaluationRunId] ?? null
            : null
    } catch (error) {
        state.evaluationError = error?.message || String(error)
    } finally {
        state.evaluationLoading = false
        renderEvaluationWorkbench()
        renderRubricDrawer()
    }
}

async function selectEvaluationDataset(datasetId) {
    if (!datasetId || datasetId === state.evaluationDatasetId) return
    await stopCaseRefreshBatch({discardCurrent: true, feedback: false})
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
        state.evaluationRunDetails[runId] = run
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
        const skillReference = skillReferenceFromRuntimeSkill(
            runtimeSkillBySelectionKey(elements.evaluationNewDatasetSkill.value),
        )
        if (!skillReference) throw new Error(t("datasetSkillRequired"))
        const dataset = await window.rollingSkill.createDataset({name, skillReference})
        elements.evaluationNewDatasetName.value = ""
        state.evaluationDatasetId = dataset.id
        await loadEvaluationWorkbench(false)
        showToast(formatMessage("createdDataset", {name: dataset.name}))
    } catch (error) {
        showError(error)
    }
}

async function exportEvaluationDataset() {
    if (!state.evaluationDatasetId) return
    elements.confirmExportDataset.disabled = true
    try {
        const result = await window.rollingSkill.exportDatasetCsv({
            datasetId: state.evaluationDatasetId,
            caseScope: elements.exportCaseScope.value,
            outputMode: elements.exportOutputMode.value,
        })
        elements.exportDatasetDialog.close()
        if (!result?.canceled) {
            showToast(formatMessage(
                result.missingOriginalCount
                    ? "datasetExportedMissingOriginal"
                    : "datasetExported",
                {
                    count: result.caseCount ?? 0,
                    missing: result.missingOriginalCount ?? 0,
                },
            ))
        }
    } catch (error) {
        showError(error)
    } finally {
        elements.confirmExportDataset.disabled = false
    }
}

function openExportDatasetDialog() {
    if (!state.evaluationDatasetId) return
    elements.exportCaseScope.value = "all"
    elements.exportOutputMode.value = "curated"
    elements.exportDatasetDialog.showModal()
}

function openDeleteCaseDialog(caseId) {
    state.deleteCaseId = caseId
    elements.recoverDeletedCaseQuestion.checked = true
    elements.deleteCaseError.textContent = ""
    elements.deleteCaseError.classList.add("hidden")
    elements.deleteCaseDialog.showModal()
}

function openDeleteDatasetDialog(datasetId) {
    state.deleteDatasetId = datasetId
    const dataset = state.datasets.find((entry) => entry.id === datasetId)
    const caseCount = dataset?.caseCount ?? 0
    elements.recoverDeletedDatasetQuestions.checked = true
    elements.recoverDeletedDatasetQuestions.disabled = caseCount === 0
    elements.recoverDeletedDatasetCount.textContent = formatMessage(
        "recoverDeleteDatasetCount",
        {count: caseCount},
    )
    elements.deleteDatasetError.textContent = ""
    elements.deleteDatasetError.classList.add("hidden")
    elements.deleteDatasetDialog.showModal()
}

async function deleteEvaluationDataset() {
    if (!state.deleteDatasetId) return
    elements.confirmDeleteDataset.disabled = true
    try {
        const datasetId = state.deleteDatasetId
        const dataset = state.datasets.find((entry) => entry.id === datasetId)
        const caseCount = dataset?.caseCount ?? 0
        const recoverQuestions = elements.recoverDeletedDatasetQuestions.checked
        const deleted = await window.rollingSkill.deleteDataset(datasetId,
            elements.recoverDeletedDatasetQuestions.checked)
        if (deleted.settings) applySettings(deleted.settings)
        state.deleteDatasetId = null
        if (state.evaluationDatasetId === datasetId) {
            state.evaluationDatasetId = null
            state.evaluationCaseId = null
        }
        elements.deleteDatasetDialog.close()
        await loadEvaluationWorkbench(false)
        showToast(recoverQuestions && caseCount > 0
            ? formatMessage("datasetDeletedWithRecovery", {count: caseCount})
            : t("datasetDeleted"))
    } catch (error) {
        const message = error?.message || String(error)
        elements.deleteDatasetError.textContent = /unfinished Curator draft|capture in progress/i.test(message)
            ? t("unfinishedDraftBlocksDatasetDelete")
            : /Raw Case recovery failed/i.test(message)
              ? formatMessage("deleteRecoveryFailed", {message})
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

function openCancelEvaluationRunDialog(runId) {
    state.cancelEvaluationRunId = runId
    elements.cancelEvaluationRunError.textContent = ""
    elements.cancelEvaluationRunError.classList.add("hidden")
    elements.cancelEvaluationRunDialog.showModal()
}

async function cancelEvaluationRun() {
    if (!state.cancelEvaluationRunId) return
    elements.confirmCancelEvaluationRun.disabled = true
    try {
        const runId = state.cancelEvaluationRunId
        const run = await window.rollingSkill.cancelEvaluationRun(runId)
        state.cancelEvaluationRunId = null
        state.evaluationRunDetails[runId] = run
        if (state.activeEvaluationRunId === runId) state.activeEvaluationRun = run
        const summaryIndex = state.evaluationRuns.findIndex((entry) => entry.id === runId)
        if (summaryIndex >= 0) {
            state.evaluationRuns[summaryIndex] = {
                ...state.evaluationRuns[summaryIndex],
                status: run.status,
                completedAt: run.completedAt,
            }
        }
        elements.cancelEvaluationRunDialog.close()
        renderEvaluationWorkbench()
        showToast(t("evaluationRunCancelled"))
    } catch (error) {
        const message = error?.message || String(error)
        elements.cancelEvaluationRunError.textContent = /not active/i.test(message)
            ? t("evaluationRunNotActive")
            : message
        elements.cancelEvaluationRunError.classList.remove("hidden")
    } finally {
        elements.confirmCancelEvaluationRun.disabled = false
    }
}

async function deleteEvaluationRun() {
    if (!state.deleteEvaluationRunId) return
    elements.confirmDeleteEvaluationRun.disabled = true
    try {
        const runId = state.deleteEvaluationRunId
        await window.rollingSkill.deleteEvaluationRun(runId)
        state.deleteEvaluationRunId = null
        delete state.evaluationRuntimeViewByRun[runId]
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
        const recoverQuestions = elements.recoverDeletedCaseQuestion.checked
        await window.rollingSkill.deleteCase(state.evaluationDatasetId, state.deleteCaseId,
            elements.recoverDeletedCaseQuestion.checked)
        state.deleteCaseId = null
        elements.deleteCaseDialog.close()
        await loadEvaluationWorkbench(false)
        showToast(t(recoverQuestions ? "caseDeletedWithRecovery" : "caseDeleted"))
    } catch (error) {
        const message = error?.message || String(error)
        elements.deleteCaseError.textContent = /Raw Case recovery failed/i.test(message)
            ? formatMessage("deleteRecoveryFailed", {message})
            : message
        elements.deleteCaseError.classList.remove("hidden")
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
                node(
                    "strong",
                    "",
                    session.episode?.originalQuestion ??
                        t("untitledCase"),
                ),
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
        if (!runtimeSkillForReference(evaluationDataset()?.skillReference)) {
            throw new Error(t("datasetSkillRequired"))
        }
        if (!state.evaluationRubricVersion) throw new Error(t("rubricRequired"))
        if (!rubricUsesUnifiedScoring(state.evaluationRubricVersion)) {
            throw new Error(t("rubricNeedsUnified"))
        }
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
            runtimeConfigurations,
            judgeConfiguration: evaluationJudgeRequestConfiguration(),
        })
        state.evaluationRuns.unshift(evaluationRunSummary(run))
        state.evaluationRunDetails[run.id] = run
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

async function migrateLegacyDatasetRubric(button) {
    if (!state.evaluationDatasetId) return
    button.disabled = true
    try {
        await window.rollingSkill.migrateLegacyDatasetRubric(state.evaluationDatasetId)
        await loadEvaluationWorkbench(false)
        showToast(t("legacyRubricMigrated"))
    } catch (error) {
        button.disabled = false
        showError(error)
    }
}

async function createRubricSession() {
    if (!state.evaluationDatasetId) return
    try {
        const session = await window.rollingSkill.createRubricSession(state.evaluationDatasetId)
        upsertRubricSession(session)
        state.activeRubricSessionId = session.id
        setRubricOpen(true)
        renderEvaluationWorkbench()
    } catch (error) {
        showError(error)
    }
}

async function sendRubricMessage(sessionId, text) {
    if (!String(text).trim()) return
    try {
        const session = await window.rollingSkill.sendRubricMessage(sessionId, text)
        state.rubricInputDrafts.delete(sessionId)
        upsertRubricSession(session)
        renderRubricDrawer()
    } catch (error) {
        showError(error)
    }
}

async function retryRubricSession(sessionId) {
    try {
        upsertRubricSession(await window.rollingSkill.retryRubricSession(sessionId))
        renderRubricDrawer()
    } catch (error) {
        showError(error)
    }
}

async function publishRubricSession(sessionId) {
    try {
        await window.rollingSkill.publishRubricSession(sessionId)
        upsertRubricSession(await window.rollingSkill.getRubricSession(sessionId))
        await loadEvaluationWorkbench(false)
        renderRubricDrawer()
        showToast(t("rubricPublishedToast"))
    } catch (error) {
        showError(error)
    }
}

async function discardRubricSession(sessionId) {
    try {
        upsertRubricSession(await window.rollingSkill.discardRubricSession(sessionId))
        renderRubricDrawer()
        renderEvaluationWorkbench()
        showToast(t("rubricDiscarded"))
    } catch (error) {
        showError(error)
    }
}

async function updateRubricModel(sessionId, modelId) {
    try {
        upsertRubricSession(await window.rollingSkill.updateRubricModel(sessionId, modelId || null))
        renderRubricDrawer()
    } catch (error) {
        showError(error)
    }
}

async function updateRubricEffort(sessionId, effort) {
    try {
        upsertRubricSession(await window.rollingSkill.updateRubricEffort(sessionId, effort || null))
        renderRubricDrawer()
    } catch (error) {
        showError(error)
    }
}

function operatorCatalogSnapshot() {
    return {
        runtimes: state.runtime?.availableRuntimes ?? [],
        activeRuntimeId: state.runtime?.runtime?.runtimeId ?? null,
        skills: state.managedSkills.skills ?? [],
        versions: state.managedSkills.versions ?? [],
        datasets: state.datasets ?? [],
    }
}

function renderOperatorWorkbench() {
    const visible = state.surface === "operator"
    elements.workbench.classList.toggle("operator-mode", visible)
    for (const button of elements.surfaceSwitch.querySelectorAll("[data-surface]")) {
        button.classList.toggle("active", button.dataset.surface === state.surface)
    }
    operatorWorkbench?.setCatalogs(operatorCatalogSnapshot())
    operatorWorkbench?.setVisible(visible)
}

async function selectOperatorEntity(kind, id, metadata = {}) {
    if (!id) return
    if (kind === "dataset" || kind === "case" || kind === "evaluation") {
        setSurface("evaluation")
        if (kind === "evaluation") {
            state.evaluationView = "runs"
            if (!state.evaluationRuns.some((run) => run.id === id)) {
                await loadEvaluationWorkbench(false)
            }
            await selectEvaluationRun(id)
            return
        }
        state.evaluationView = "cases"
        const datasetId = kind === "dataset" ? id : metadata.datasetId
        if (datasetId && datasetId !== state.evaluationDatasetId) {
            await selectEvaluationDataset(datasetId)
        }
        if (kind === "case") {
            state.evaluationCaseId = id
            renderEvaluationWorkbench()
        }
        return
    }
    if (kind === "candidate" || kind === "installation") {
        setSurface("skills")
        if (!state.managedSkills.skills.length) await loadManagedSkills(false)
        const version = kind === "candidate"
            ? state.managedSkills.versions.find((entry) => entry.id === id)
            : null
        const skillId = metadata.skillId ?? version?.skillId ?? null
        if (skillId) await selectManagedSkill(skillId)
        if (kind === "installation") {
            state.managedSkillSideView = "installations"
            if (skillId) await loadManagedSkillInstallations(skillId)
            state.activeSkillInstallationJobId = id
            renderManagedSkillInstallations()
        }
    }
}

function setSurface(surface) {
    if (!["chat", "evaluation", "skills", "operator"].includes(surface)) return
    state.surface = surface
    if (surface === "evaluation") {
        suspendThreadObservation()
        setTraceOpen(false)
        setCurationOpen(false)
        void loadEvaluationWorkbench(true)
    } else if (surface === "skills") {
        suspendThreadObservation()
        setTraceOpen(false)
        setCurationOpen(false)
        setRubricOpen(false)
        void loadManagedSkills(true)
    } else if (surface === "operator") {
        suspendThreadObservation()
        setTraceOpen(false)
        setCurationOpen(false)
        setRubricOpen(false)
    } else {
        setRubricOpen(false)
        void resumeThreadObservation()
    }
    renderAll()
}

function chatTimelineSurfaceIsVisible() {
    return (
        state.surface === "chat" &&
        !state.traceOpen &&
        !state.curationOpen &&
        !state.rubricOpen &&
        !elements.settingsDialog.open &&
        !elements.runtimeDialog.open &&
        !elements.caseDialog.open
    )
}

function chatTimelineCanBeObserved() {
    return (
        chatTimelineSurfaceIsVisible() &&
        Boolean(state.activeThreadId) &&
        !state.newTaskMode
    )
}

function suspendThreadObservation({cancelPendingRead = true} = {}) {
    const epoch = state.activeThreadObservationEpoch
    state.activeThreadObservationEpoch = null
    if (cancelPendingRead) {
        state.threadLoadToken += 1
        if (state.loadingThread) {
            state.loadingThread = false
            queueRender()
        }
    }
    return window.rollingSkill.clearThreadObservation(epoch).catch(() => {})
}

async function drainThreadObservation(epoch, threadId, loadToken, runtimeEpoch) {
    while (
        state.activeThreadObservationEpoch === epoch &&
        state.activeThreadId === threadId &&
        state.threadLoadToken === loadToken &&
        state.runtimeEpoch === runtimeEpoch &&
        chatTimelineCanBeObserved()
    ) {
        const result = await window.rollingSkill.drainThreadObservation(epoch)
        if (!result?.matched) return
        if (result.reloadRequired) {
            state.activeThreadObservationEpoch = null
            await loadThread(threadId)
            return
        }
        for (const notification of result.notifications ?? []) handleNotification(notification)
        if (result.live) return
    }
    if (state.activeThreadObservationEpoch === epoch && !chatTimelineCanBeObserved()) {
        suspendThreadObservation()
    }
}

async function resumeThreadObservation() {
    if (state.threadObservationResumePending) return
    state.threadObservationResumePending = true
    await Promise.resolve()
    try {
        if (
            !chatTimelineCanBeObserved() ||
            state.activeThreadObservationEpoch !== null ||
            state.loadingThread ||
            state.threadLoadFailed
        ) {
            return
        }
        await loadThread(state.activeThreadId)
    } finally {
        state.threadObservationResumePending = false
    }
}

async function setThreadView(view) {
    if (view !== "current" && view !== "archived") return
    if (view === "archived" && !supportsThreadArchive()) return
    if (view === state.threadView) return
    suspendThreadObservation()
    snapshotActiveThreadView()
    state.threadLoadToken += 1
    state.loadingThread = false
    state.threadLoadFailed = false
    state.threadView = view
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.newTaskMode = false
    state.loadingThreads = true
    restoreActiveThreadView()
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
            suspendThreadObservation()
            snapshotActiveThreadView()
            state.threadLoadToken += 1
            state.loadingThread = false
            state.threadLoadFailed = false
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
            restoreActiveThreadView()
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
            suspendThreadObservation()
            snapshotActiveThreadView()
            state.threadLoadToken += 1
            state.loadingThread = false
            state.threadLoadFailed = false
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
            restoreActiveThreadView()
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
    state.traceOpen = false
    state.curationOpen = false
    state.rubricOpen = false
    elements.traceDrawer.classList.remove("visible")
    elements.curationDrawer.classList.remove("visible")
    elements.rubricDrawer.classList.remove("visible")
    const retainedThread = state.activeThreadId === threadId ? state.activeThread : null
    const runtimeEpoch = state.runtimeEpoch
    const loadToken = ++state.threadLoadToken
    await suspendThreadObservation({cancelPendingRead: false})
    if (
        runtimeEpoch !== state.runtimeEpoch ||
        loadToken !== state.threadLoadToken ||
        !chatTimelineSurfaceIsVisible()
    ) {
        return
    }
    snapshotActiveThreadView()
    state.activeThreadId = threadId
    state.activeThread = retainedThread
    state.activeThreadArchived = state.threadView === "archived"
    state.newTaskMode = false
    state.loadingThread = true
    state.threadLoadFailed = false
    state.error = null
    state.activeTurnId = null
    restoreActiveThreadView()
    renderAll()
    try {
        const response = await window.rollingSkill.readThread(threadId)
        const observationEpoch = response.rollingSkillObservationEpoch ?? null
        if (
            runtimeEpoch !== state.runtimeEpoch ||
            loadToken !== state.threadLoadToken ||
            state.activeThreadId !== threadId ||
            !chatTimelineCanBeObserved()
        ) {
            if (observationEpoch !== null) {
                void window.rollingSkill.clearThreadObservation(observationEpoch).catch(() => {})
            }
            return
        }
        state.activeThreadObservationEpoch = observationEpoch
        state.activeThread = response.thread
        const rememberedProfile = response.thread.rollingSkillProfile
        state.selectedTaskModelId =
            rememberedProfile && Object.hasOwn(rememberedProfile, "modelId")
                ? rememberedProfile.modelId
                : response.thread.model ?? state.settings.taskProfile?.modelId ?? null
        state.selectedTaskEffort =
            rememberedProfile && Object.hasOwn(rememberedProfile, "effort")
                ? rememberedProfile.effort
                : response.thread.effort ?? state.settings.taskProfile?.effort ?? null
        state.selectedTaskPermissionMode =
            rememberedProfile && Object.hasOwn(rememberedProfile, "permissionMode")
                ? rememberedProfile.permissionMode
                : response.thread.permissionMode ?? defaultPermissionMode()
        state.activeTurnId =
            response.thread.turns?.find((turn) => turn.status === "inProgress")?.id ?? null
        state.loadingThread = false
        state.threadLoadFailed = false
        upsertThreadSummary(response.thread)
        renderAll()
        restoreActiveThreadView({restoreScroll: true})
        if (observationEpoch !== null) {
            await drainThreadObservation(observationEpoch, threadId, loadToken, runtimeEpoch)
        }
    } catch (error) {
        if (
            runtimeEpoch !== state.runtimeEpoch ||
            loadToken !== state.threadLoadToken ||
            state.activeThreadId !== threadId
        ) {
            return
        }
        state.loadingThread = false
        state.threadLoadFailed = true
        showError(error)
        renderAll()
    }
}

function beginNewTask() {
    suspendThreadObservation()
    snapshotActiveThreadView()
    state.threadLoadToken += 1
    const changedView = state.threadView !== "current"
    state.surface = "chat"
    state.threadView = "current"
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.loadingThread = false
    state.threadLoadFailed = false
    state.newTaskMode = true
    const profile = configuredTaskProfile()
    state.selectedTaskModelId = profile.modelId
    state.selectedTaskEffort = profile.effort
    state.selectedTaskPermissionMode = defaultPermissionMode()
    state.error = null
    restoreActiveThreadView()
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
    const submittedSourceIdentity = snapshotActiveThreadView()
    const submittedRuntimeEpoch = state.runtimeEpoch
    const submittedModelId = state.selectedTaskModelId
    const submittedEffort = state.selectedTaskEffort
    const submittedPermissionMode = state.selectedTaskPermissionMode
    let submittedThreadId = state.activeThreadId
    let submittedIdentity = submittedSourceIdentity
    state.sending = true
    state.error = null
    renderAll()
    try {
        if (!submittedThreadId) {
            const response = await window.rollingSkill.startThread(
                submittedModelId,
                submittedEffort,
                submittedPermissionMode,
            )
            const observationEpoch = response.rollingSkillObservationEpoch ?? null
            if (submittedRuntimeEpoch !== state.runtimeEpoch) {
                if (observationEpoch !== null) {
                    void window.rollingSkill.clearThreadObservation(observationEpoch).catch(() => {})
                }
                state.sending = false
                renderAll()
                return
            }
            submittedThreadId = response.thread.id
            submittedIdentity = threadViewIdentity({
                runtimeId: submittedSourceIdentity.runtimeId,
                workspaceRoot: submittedSourceIdentity.workspaceRoot,
                conversationId: submittedThreadId,
            })
            threadViewState.migrate(submittedSourceIdentity, submittedIdentity)
            upsertThreadSummary(response.thread)
            if (
                !state.activeThreadId &&
                threadViewStateKey(threadViewIdentity()) ===
                    threadViewStateKey(submittedSourceIdentity)
            ) {
                state.activeThread = response.thread
                state.activeThreadId = submittedThreadId
                state.newTaskMode = false
                state.activeThreadObservationEpoch = observationEpoch
            } else if (observationEpoch !== null) {
                void window.rollingSkill.clearThreadObservation(observationEpoch).catch(() => {})
            }
        }
        const response = await window.rollingSkill.startTurn(
            submittedThreadId,
            text,
            submittedModelId,
            submittedEffort,
            submittedPermissionMode,
        )
        state.sending = false
        threadViewState.clearDraft(submittedIdentity)
        if (
            submittedRuntimeEpoch !== state.runtimeEpoch ||
            state.activeThreadId !== submittedThreadId
        ) {
            renderAll()
            return
        }
        state.activeTurnId = response.turn.id
        upsertTurn(response.turn)
        restoreActiveThreadView()
        renderAll({forceBottom: true})
        restoreActiveThreadView({restoreScroll: true, forceBottom: true})
    } catch (error) {
        state.sending = false
        showError(error)
        if (
            threadViewStateKey(threadViewIdentity()) === threadViewStateKey(submittedIdentity)
        ) {
            restoreActiveThreadView()
        }
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
        let userMessageOrdinal = 0
        let agentMessageOrdinal = 0
        for (const item of turn.items ?? []) {
            let messageOrdinal = null
            if (item.type === "userMessage") {
                messageOrdinal = userMessageOrdinal
                userMessageOrdinal += 1
            } else if (item.type === "agentMessage") {
                messageOrdinal = agentMessageOrdinal
                agentMessageOrdinal += 1
            }
            items.push({turnId: turn.id, item, messageOrdinal})
        }
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
    selection.startTurnId = selected.turnId
    selection.startMessageOrdinal = selected.messageOrdinal
    const flattened = flattenedActiveItems()
    const startIndex = flattened.findIndex(({item}) => item.id === selected.item.id)
    const endIndex = flattened.findIndex(({item}) => item.id === selection.itemId)
    elements.caseScope.textContent = formatMessage("frozenRange", {
        count: Math.max(0, endIndex - startIndex + 1),
    })
}

async function openCaseDialog(turnId, itemId) {
    const sourceThreadId = state.activeThreadId
    const turn = findTurn(turnId)
    const item = turn?.items?.find((entry) => entry.id === itemId)
    if (!turn || !item || item.type !== "agentMessage") return
    const flattened = flattenedActiveItems()
    const endIndex = flattened.findIndex(({item: entry}) => entry.id === itemId)
    const endSelection = flattened[endIndex]
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
    if (state.activeThreadId !== sourceThreadId) return
    if (!state.evaluationSkills.length) {
        showError(new Error(t("noSkills")))
        return
    }
    state.caseSelection = {
        sourceThreadId,
        turnId,
        itemId,
        endTurnId: endSelection.turnId,
        endMessageOrdinal: endSelection.messageOrdinal,
        startCandidates,
        startItemId: startCandidates.at(-1).item.id,
        startTurnId: startCandidates.at(-1).turnId,
        startMessageOrdinal: startCandidates.at(-1).messageOrdinal,
    }
    elements.caseStartItem.replaceChildren()
    for (const candidate of [...startCandidates].reverse()) {
        const question = textFromUserInput(candidate.item.content)
        const option = node("option", "", question.replace(/\s+/g, " ").slice(0, 110))
        option.value = candidate.item.id
        elements.caseStartItem.append(option)
    }
    elements.caseStartItem.value = state.caseSelection.startItemId
    elements.caseEndPreview.value = item.text || ""
    elements.caseIssueDescription.value = ""
    updateEpisodeStartPreview()
    updateDatasetOptions(state.datasets[0]?.id)
    populateSkillSelect(elements.newDatasetSkill, elements.newDatasetSkill.value, {allowEmpty: false})
    renderCaseDatasetSkillStatus()
    clearCaseError()
    suspendThreadObservation()
    elements.caseDialog.showModal()
}

async function createDataset() {
    const name = elements.newDatasetName.value.trim()
    if (!name) return
    elements.createDataset.disabled = true
    try {
        const skillReference = skillReferenceFromRuntimeSkill(
            runtimeSkillBySelectionKey(elements.newDatasetSkill.value),
        )
        if (!skillReference) throw new Error(t("datasetSkillRequired"))
        const created = await window.rollingSkill.createDataset({name, skillReference})
        state.datasets = await window.rollingSkill.listDatasets()
        updateDatasetOptions(created.id)
        elements.newDatasetName.value = ""
        showToast(formatMessage("createdDataset", {name: created.name}))
    } catch (error) {
        showCaseError(error)
    } finally {
        elements.createDataset.disabled = false
    }
}

function openDatasetSkillDialog(datasetId) {
    const dataset = selectedDataset(datasetId)
    if (!dataset) return
    state.datasetSkillDialogDatasetId = datasetId
    populateSkillSelect(
        elements.datasetSkillSelect,
        runtimeSkillSelectionKey(runtimeSkillForReference(dataset.skillReference)),
        {allowEmpty: false},
    )
    elements.datasetSkillDialogCopy.textContent = formatMessage("changeDatasetSkillCopy", {
        name: dataset.name,
    })
    elements.datasetSkillDialog.showModal()
}

async function bindDatasetSkill() {
    const datasetId = state.datasetSkillDialogDatasetId
    const skillReference = skillReferenceFromRuntimeSkill(
        runtimeSkillBySelectionKey(elements.datasetSkillSelect.value),
    )
    if (!datasetId || !skillReference) return
    elements.confirmDatasetSkill.disabled = true
    try {
        await window.rollingSkill.bindDatasetSkill(datasetId, skillReference)
        state.datasets = await window.rollingSkill.listDatasets()
        elements.datasetSkillDialog.close()
        updateDatasetOptions(elements.caseDataset.value)
        renderCaseDatasetSkillStatus()
        if (state.evaluationDatasetId === datasetId) await loadEvaluationWorkbench(false)
        else renderEvaluationWorkbench()
    } catch (error) {
        showError(error)
    } finally {
        elements.confirmDatasetSkill.disabled = false
    }
}

async function createCuration() {
    const selection = state.caseSelection
    if (!selection) return
    clearCaseError()
    const caseType = new FormData(elements.caseForm).get("case-type")
    const issueDescription = elements.caseIssueDescription.value.trim()
    const dataset = selectedDataset(elements.caseDataset.value)
    if (!runtimeSkillForReference(dataset?.skillReference)) {
        showCaseError(new Error(t("datasetSkillRequired")))
        return
    }
    if (!dataset?.activeRubricVersionId) {
        showCaseError(new Error(t("rubricRequired")))
        return
    }
    setCaseCreationInProgress(true)
    try {
        const session = await window.rollingSkill.createCuration({
            datasetId: elements.caseDataset.value,
            caseType,
            sourceThreadId: selection.sourceThreadId,
            startItemId: selection.startItemId,
            startTurnId: selection.startTurnId,
            startMessageOrdinal: selection.startMessageOrdinal,
            endItemId: selection.itemId,
            endTurnId: selection.endTurnId,
            endMessageOrdinal: selection.endMessageOrdinal,
            ...(issueDescription
                ? {issueDescription: elements.caseIssueDescription.value}
                : {}),
        })
        elements.caseDialog.close()
        state.caseSelection = null
        upsertCuration(session)
        state.activeCurationId = session.id
        setCurationOpen(true)
        showToast(t("episodeSent"))
    } catch (error) {
        showCaseError(error)
    } finally {
        setCaseCreationInProgress(false)
    }
}

function assertCalibrationBatchContext(batch, caseId = null) {
    const snapshot = batch.snapshot()
    if (
        state.evaluationDatasetId !== snapshot.datasetId ||
        state.evaluationRubricVersion?.id !== snapshot.rubricVersionId
    ) {
        throw new Error(t("calibrationContextChanged"))
    }
    if (!caseId) return
    const caseEntry = state.evaluationCases.find((entry) => entry.id === caseId)
    if (
        !caseEntry ||
        !caseNeedsCalibration(caseEntry)
    ) {
        throw new Error(t("calibrationContextChanged"))
    }
}

function failAutomaticCalibrationBatch(batch, error) {
    if (state.calibrationBatch !== batch) return
    const snapshot = batch.fail(error)
    renderEvaluationWorkbench()
    renderCurations()
    showToast(calibrationBatchStatusText(snapshot))
}

async function discardCurationImmediately(sessionId, {feedback = false} = {}) {
    const session = await window.rollingSkill.discardCuration(sessionId)
    upsertCuration(session)
    renderCurations()
    if (
        state.surface === "evaluation" &&
        (session.operation === "calibration" || session.operation === "refresh")
    ) {
        renderEvaluationWorkbench()
    }
    if (feedback) showToast(t("draftDiscarded"))
    return session
}

async function stopAutomaticCalibrationBatch({discardCurrent = true, feedback = true} = {}) {
    const batch = state.calibrationBatch
    const before = batch?.snapshot?.()
    if (!batch || before?.status !== "running") return false
    const wasArchiving = before.archiving
    batch.stop()
    renderEvaluationWorkbench()
    renderCurations()
    if (discardCurrent && before.currentSessionId && !wasArchiving) {
        try {
            await discardCurationImmediately(before.currentSessionId)
        } catch (error) {
            showError(error)
        }
    }
    if (feedback) showToast(t("calibrationBatchStopped"))
    return true
}

function leaveAutomaticCalibrationForManualAction(sessionId) {
    const batch = calibrationBatchForSession(sessionId)
    if (!batch) return false
    batch.stop()
    renderEvaluationWorkbench()
    renderCurations()
    showToast(t("calibrationBatchStopped"))
    return true
}

async function archiveAutomaticCalibration(session, batch) {
    try {
        assertCalibrationBatchContext(batch, session.targetCaseId)
        renderEvaluationWorkbench()
        renderCurations()
        await archiveCuration(session.id, {automatic: true})
        if (state.calibrationBatch !== batch || batch.snapshot().status !== "running") return
        const snapshot = batch.completeAutoArchive(session.id)
        renderEvaluationWorkbench()
        renderCurations()
        if (snapshot.status === "completed") {
            showToast(t("calibrationBatchComplete"))
            return
        }
        await advanceAutomaticCalibrationBatch(batch)
    } catch (error) {
        failAutomaticCalibrationBatch(batch, error)
    }
}

function maybeAutoArchiveCalibration(session) {
    const batch = state.calibrationBatch
    if (!batch || !batch.beginAutoArchive(session)) return false
    void archiveAutomaticCalibration(session, batch)
    return true
}

function handleCalibrationBatchSessionUpdate(session) {
    const batch = calibrationBatchForSession(session.id)
    if (!batch) return
    if (session.status === "failed") {
        failAutomaticCalibrationBatch(batch, new Error(session.error || t("failed")))
        return
    }
    maybeAutoArchiveCalibration(session)
}

async function advanceAutomaticCalibrationBatch(batch = state.calibrationBatch) {
    if (!batch || state.calibrationBatch !== batch || batch.snapshot().status !== "running") return
    let session = null
    try {
        assertCalibrationBatchContext(batch)
        const caseId = batch.nextCase()
        renderEvaluationWorkbench()
        renderCurations()
        if (!caseId) {
            if (batch.snapshot().status === "completed") showToast(t("calibrationBatchComplete"))
            return
        }
        assertCalibrationBatchContext(batch, caseId)
        session = await createCaseCalibration(caseId, {
            automatic: true,
            throwOnError: true,
        })
        if (!session) throw new Error(t("calibrationContextChanged"))
        if (
            state.calibrationBatch !== batch ||
            !batch.attachSession(caseId, session.id)
        ) {
            if (session.status !== "archived" && session.status !== "cancelled") {
                await discardCurationImmediately(session.id)
            }
            return
        }
        renderEvaluationWorkbench()
        renderCurations()
        const latest = state.curationSessions.find((entry) => entry.id === session.id) ?? session
        handleCalibrationBatchSessionUpdate(latest)
    } catch (error) {
        failAutomaticCalibrationBatch(batch, error)
    }
}

function startAutomaticCalibrationBatch() {
    const datasetId = state.evaluationDatasetId
    const rubricVersionId = state.evaluationRubricVersion?.id
    const caseIds = state.evaluationCases
        .filter(caseNeedsCalibration)
        .map((entry) => entry.id)
    if (!datasetId || !rubricVersionId || !caseIds.length) return
    const running = calibrationBatchSnapshot()?.status === "running"
    if (running) return
    const batch = new CaseCalibrationBatch({datasetId, rubricVersionId, caseIds})
    state.calibrationBatch = batch
    renderEvaluationWorkbench()
    void advanceAutomaticCalibrationBatch(batch)
}

async function createCaseCalibration(caseId, {automatic = false, throwOnError = false} = {}) {
    const caseEntry = state.evaluationCases.find((entry) => entry.id === caseId)
    if (!caseNeedsCalibration(caseEntry)) {
        if (throwOnError) throw new Error(t("calibrationContextChanged"))
        return null
    }
    const existing = activeCalibrationForCase(caseId)
    if (existing) {
        state.activeCurationId = existing.id
        setCurationOpen(true)
        return existing
    }
    if (state.calibrationStartingCaseIds.has(caseId)) {
        if (throwOnError) throw new Error(t("calibrationInProgress"))
        return null
    }
    state.calibrationStartingCaseIds.add(caseId)
    renderEvaluationWorkbench()
    try {
        const session = await window.rollingSkill.createCaseCalibration({
            datasetId: caseEntry.datasetId,
            caseId,
        })
        upsertCuration(session)
        state.activeCurationId = session.id
        setCurationOpen(true)
        if (!automatic) showToast(t("calibrationStarted"))
        return session
    } catch (error) {
        if (throwOnError) throw error
        showError(error)
        return null
    } finally {
        state.calibrationStartingCaseIds.delete(caseId)
        renderEvaluationWorkbench()
    }
}

function refreshErrorMessage(error) {
    const message = String(error?.message ?? error ?? t("failed")).replace(
        /^Error invoking remote method '[^']+': Error:\s*/u,
        "",
    )
    if (/The Case changed during refresh/iu.test(message)) return t("refreshTargetChanged")
    return formatMessage("refreshFailed", {message})
}

async function createCaseRefresh(caseId, {automatic = false, throwOnError = false} = {}) {
    const caseEntry = state.evaluationCases.find((entry) => entry.id === caseId)
    if (!caseEntry || caseEntry.datasetId !== state.evaluationDatasetId) {
        const error = new Error(t("refreshTargetChanged"))
        if (throwOnError) throw error
        showError(error)
        return null
    }
    const existing = activeRefreshForCase(caseId)
    if (existing) {
        state.activeCurationId = existing.id
        setCurationOpen(true)
        return existing
    }
    if (state.refreshStartingCaseIds.has(caseId)) {
        if (throwOnError) throw new Error(t("refreshingCase"))
        return null
    }
    state.refreshStartingCaseIds.add(caseId)
    renderEvaluationWorkbench()
    try {
        const session = await window.rollingSkill.createCaseRefresh({
            datasetId: caseEntry.datasetId,
            caseId,
        })
        upsertCuration(session)
        state.activeCurationId = session.id
        setCurationOpen(true)
        if (!automatic) showToast(t("refreshStarted"))
        return session
    } catch (error) {
        if (throwOnError) throw error
        showError(new Error(refreshErrorMessage(error)))
        return null
    } finally {
        state.refreshStartingCaseIds.delete(caseId)
        renderEvaluationWorkbench()
    }
}

function assertCaseRefreshBatchContext(batch, caseId = null) {
    const snapshot = batch.snapshot()
    if (state.evaluationDatasetId !== snapshot.datasetId) {
        throw new Error(t("refreshBatchContextChanged"))
    }
    if (!caseId) return
    const caseEntry = state.evaluationCases.find((entry) => entry.id === caseId)
    const activeRefresh = activeRefreshForCase(caseId)
    if (
        !caseEntry ||
        caseEntry.datasetId !== snapshot.datasetId ||
        activeCalibrationForCase(caseId) ||
        (activeRefresh && activeRefresh.id !== snapshot.currentSessionId)
    ) {
        throw new Error(t("refreshBatchContextChanged"))
    }
}

function failCaseRefreshBatch(batch, error) {
    if (state.refreshBatch !== batch) return
    const snapshot = batch.fail(error)
    renderEvaluationWorkbench()
    renderCurations()
    showToast(refreshBatchStatusText(snapshot))
}

async function stopCaseRefreshBatch({discardCurrent = true, feedback = true} = {}) {
    const batch = state.refreshBatch
    const before = batch?.snapshot?.()
    if (!batch || before?.status !== "running") return false
    const wasArchiving = before.archiving
    batch.stop()
    renderEvaluationWorkbench()
    renderCurations()
    if (discardCurrent && before.currentSessionId && !wasArchiving) {
        try {
            await discardCurationImmediately(before.currentSessionId)
        } catch (error) {
            showError(error)
        }
    }
    if (feedback) showToast(t("refreshBatchStopped"))
    return true
}

async function archiveAutomaticRefresh(session, batch) {
    try {
        assertCaseRefreshBatchContext(batch, session.targetCaseId)
        renderEvaluationWorkbench()
        renderCurations()
        await archiveCuration(session.id, {automatic: true})
        if (state.refreshBatch !== batch || batch.snapshot().status !== "running") return
        const snapshot = batch.completeAutoArchive(session.id)
        renderEvaluationWorkbench()
        renderCurations()
        if (snapshot.status === "completed") {
            showToast(t("refreshBatchComplete"))
            return
        }
        await advanceCaseRefreshBatch(batch)
    } catch (error) {
        failCaseRefreshBatch(batch, error)
    }
}

function maybeAutoArchiveRefresh(session) {
    const batch = state.refreshBatch
    if (!batch || !batch.beginAutoArchive(session)) return false
    void archiveAutomaticRefresh(session, batch)
    return true
}

function handleRefreshBatchSessionUpdate(session) {
    const batch = refreshBatchForSession(session.id)
    if (!batch) return
    if (session.status === "failed") {
        failCaseRefreshBatch(batch, new Error(session.error || t("failed")))
        return
    }
    maybeAutoArchiveRefresh(session)
}

async function advanceCaseRefreshBatch(batch = state.refreshBatch) {
    if (!batch || state.refreshBatch !== batch || batch.snapshot().status !== "running") return
    let session = null
    try {
        assertCaseRefreshBatchContext(batch)
        const caseId = batch.nextCase()
        renderEvaluationWorkbench()
        renderCurations()
        if (!caseId) {
            if (batch.snapshot().status === "completed") showToast(t("refreshBatchComplete"))
            return
        }
        assertCaseRefreshBatchContext(batch, caseId)
        session = await createCaseRefresh(caseId, {
            automatic: true,
            throwOnError: true,
        })
        if (!session) throw new Error(t("refreshBatchContextChanged"))
        if (
            state.refreshBatch !== batch ||
            batch.snapshot().status !== "running" ||
            !batch.attachSession(caseId, session.id)
        ) {
            if (session.status !== "archived" && session.status !== "cancelled") {
                await discardCurationImmediately(session.id)
            }
            return
        }
        renderEvaluationWorkbench()
        renderCurations()
        const latest = state.curationSessions.find((entry) => entry.id === session.id) ?? session
        handleRefreshBatchSessionUpdate(latest)
    } catch (error) {
        failCaseRefreshBatch(batch, error)
    }
}

function updateCaseRefreshBatchSelection() {
    const scope = new FormData(elements.caseRefreshBatchForm).get("case-refresh-scope") ?? "goodcase"
    const count = state.evaluationCases.filter(
        (entry) => scope === "all" || entry.caseType === "goodcase",
    ).length
    elements.caseRefreshBatchCount.textContent = formatMessage("refreshBatchSelection", {count})
    elements.confirmCaseRefreshBatch.disabled = count === 0
    return count
}

function openCaseRefreshBatchDialog() {
    if (!state.evaluationDatasetId || !state.evaluationCases.length) return
    elements.caseRefreshBatchForm.reset()
    updateCaseRefreshBatchSelection()
    elements.caseRefreshBatchDialog.showModal()
}

function startCaseRefreshBatch() {
    const datasetId = state.evaluationDatasetId
    const scope = new FormData(elements.caseRefreshBatchForm).get("case-refresh-scope") ?? "goodcase"
    const caseIds = state.evaluationCases
        .filter((entry) => scope === "all" || entry.caseType === "goodcase")
        .map((entry) => entry.id)
    if (!datasetId || !caseIds.length || refreshBatchSnapshot()?.status === "running") return
    state.refreshBatch = new CaseRefreshBatch({datasetId, caseIds})
    elements.caseRefreshBatchDialog.close()
    renderEvaluationWorkbench()
    void advanceCaseRefreshBatch(state.refreshBatch)
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
        collapseRawCasesForCompactDrawer()
        suspendThreadObservation()
        state.curationOpen = false
        elements.curationDrawer.classList.remove("visible")
        state.rubricOpen = false
        elements.rubricDrawer.classList.remove("visible")
    }
    elements.traceDrawer.classList.toggle("visible", open)
    if (open) void loadTrace()
    else void resumeThreadObservation()
}

function setCurationOpen(open) {
    state.curationOpen = open
    if (open) {
        collapseRawCasesForCompactDrawer()
        suspendThreadObservation()
        state.traceOpen = false
        elements.traceDrawer.classList.remove("visible")
        state.rubricOpen = false
        elements.rubricDrawer.classList.remove("visible")
        if (!state.activeCurationId && state.curationSessions.length) {
            state.activeCurationId = state.curationSessions[0].id
        }
    }
    renderCurations()
    if (!open) void resumeThreadObservation()
}

function setRubricOpen(open) {
    state.rubricOpen = Boolean(open)
    if (open) {
        collapseRawCasesForCompactDrawer()
        suspendThreadObservation()
        state.traceOpen = false
        state.curationOpen = false
        elements.traceDrawer.classList.remove("visible")
        elements.curationDrawer.classList.remove("visible")
    }
    renderRubricDrawer()
    if (!open) void resumeThreadObservation()
}

function transientDrawerIsOpen() {
    return state.traceOpen || state.curationOpen || state.rubricOpen
}

function collapseRawCasesForCompactDrawer() {
    if (window.innerWidth > 1120 || !state.rawCaseOpen) return
    state.rawCaseOpen = false
    renderRawCases()
}

function closeTransientDrawersForCompactRawCases() {
    if (window.innerWidth > 1120 || !transientDrawerIsOpen()) return
    setTraceOpen(false)
    setCurationOpen(false)
    setRubricOpen(false)
}

function upsertCuration(session) {
    const index = state.curationSessions.findIndex((entry) => entry.id === session.id)
    if (session.status === "cancelled" || session.status === "archived") {
        state.curationInputDrafts.delete(session.id)
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

function refreshBatchForSession(sessionId) {
    const batch = state.refreshBatch
    const snapshot = batch?.snapshot?.()
    return snapshot?.status === "running" && snapshot.currentSessionId === sessionId
        ? batch
        : null
}

function leaveAutomaticRefreshForManualAction(sessionId) {
    const batch = refreshBatchForSession(sessionId)
    if (!batch) return false
    batch.stop()
    renderEvaluationWorkbench()
    renderCurations()
    showToast(t("refreshBatchStopped"))
    return true
}

async function sendCurationMessage(sessionId, text) {
    if (!String(text).trim()) return false
    leaveAutomaticCalibrationForManualAction(sessionId)
    leaveAutomaticRefreshForManualAction(sessionId)
    try {
        const session = await window.rollingSkill.sendCurationMessage(sessionId, text)
        const input = elements.curationDetail.querySelector(
            `[data-curation-input="${CSS.escape(String(sessionId))}"]`,
        )
        if (input) input.value = ""
        state.curationInputDrafts.delete(sessionId)
        upsertCuration(session)
        renderCurations()
        return true
    } catch (error) {
        showError(error)
        return false
    }
}

async function retryCuration(sessionId) {
    leaveAutomaticCalibrationForManualAction(sessionId)
    leaveAutomaticRefreshForManualAction(sessionId)
    try {
        const session = await window.rollingSkill.retryCuration(sessionId)
        upsertCuration(session)
        renderCurations()
    } catch (error) {
        showError(error)
    }
}

async function archiveCuration(sessionId, {automatic = false} = {}) {
    if (!automatic) {
        leaveAutomaticCalibrationForManualAction(sessionId)
        leaveAutomaticRefreshForManualAction(sessionId)
    }
    const operation = state.curationSessions.find((entry) => entry.id === sessionId)?.operation
    try {
        await window.rollingSkill.archiveCuration(sessionId)
        const session = await window.rollingSkill.getCuration(sessionId)
        upsertCuration(session)
        state.datasets = await window.rollingSkill.listDatasets()
        renderCurations()
        if (state.surface === "evaluation") await loadEvaluationWorkbench(false)
        if (!automatic) {
            showToast(t(
                operation === "calibration"
                    ? "caseCalibrated"
                    : operation === "refresh"
                      ? "caseRefreshed"
                      : "caseSaved",
            ))
        }
        return session
    } catch (error) {
        if (automatic) throw error
        showError(operation === "refresh" ? new Error(refreshErrorMessage(error)) : error)
        return null
    }
}

function openDiscardDialog(sessionId) {
    leaveAutomaticCalibrationForManualAction(sessionId)
    leaveAutomaticRefreshForManualAction(sessionId)
    state.discardCurationId = sessionId
    elements.discardDialog.showModal()
}

async function discardCuration() {
    const sessionId = state.discardCurationId
    if (!sessionId) return
    elements.confirmDiscard.disabled = true
    try {
        const session = await discardCurationImmediately(sessionId)
        elements.discardDialog.close()
        showToast(t("draftDiscarded"))
    } catch (error) {
        showError(error)
    } finally {
        state.discardCurationId = null
        elements.confirmDiscard.disabled = false
    }
}

async function updateCurationModel(sessionId, selectedModelId) {
    leaveAutomaticCalibrationForManualAction(sessionId)
    leaveAutomaticRefreshForManualAction(sessionId)
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
    leaveAutomaticCalibrationForManualAction(sessionId)
    leaveAutomaticRefreshForManualAction(sessionId)
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
    let dirtyItem = null
    let needsFullRender = false
    if (method === "thread/started") {
        if (state.threadView === "current") upsertThreadSummary(params.thread)
        needsFullRender = true
    } else if (method === "thread/archived" || method === "thread/unarchived") {
        const threadId = params.threadId ?? params.thread?.id ?? null
        if (threadId && state.activeThreadId === threadId) {
            suspendThreadObservation()
            snapshotActiveThreadView()
            state.threadLoadToken += 1
            state.loadingThread = false
            state.threadLoadFailed = false
            state.activeThreadId = null
            state.activeThread = null
            state.activeThreadArchived = false
            state.activeTurnId = null
            state.newTaskMode = false
            restoreActiveThreadView()
        }
        void refreshThreads(false)
        needsFullRender = true
    } else if (method === "thread/name/updated") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.name = params.threadName
        if (state.activeThread?.id === params.threadId) state.activeThread.name = params.threadName
        needsFullRender = true
    } else if (method === "thread/status/changed") {
        const thread = state.threads.find((entry) => entry.id === params.threadId)
        if (thread) thread.status = params.status
        needsFullRender = true
    } else if (method === "thread/settings/updated" && params.threadId === state.activeThreadId) {
        const threadSettings = params.threadSettings ?? params.settings ?? {}
        if ("model" in threadSettings) {
            state.selectedTaskModelId = threadSettings.model || null
            if (state.activeThread) state.activeThread.model = threadSettings.model || null
        }
        if ("effort" in threadSettings || "reasoningEffort" in threadSettings) {
            const effort = threadSettings.effort ?? threadSettings.reasoningEffort ?? null
            state.selectedTaskEffort = effort || null
            if (state.activeThread) state.activeThread.effort = effort || null
        }
        needsFullRender = true
    } else if (method === "turn/started" && params.threadId === state.activeThreadId) {
        state.activeTurnId = params.turn.id
        state.sending = false
        upsertTurn(params.turn)
        needsFullRender = true
    } else if (method === "item/started" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
        dirtyItem = {turnId: params.turnId, itemId: params.item?.id}
    } else if (method === "item/agentMessage/delta" && params.threadId === state.activeThreadId) {
        const turn = ensureTurn(params.turnId)
        let item = turn?.items.find((entry) => entry.id === params.itemId)
        if (!item) {
            item = {type: "agentMessage", id: params.itemId, text: ""}
            turn?.items.push(item)
        }
        item.text = `${item.text || ""}${params.delta || ""}`
        dirtyItem = {turnId: params.turnId, itemId: params.itemId}
    } else if (method === "item/completed" && params.threadId === state.activeThreadId) {
        upsertItem(params.turnId, params.item)
        dirtyItem = {turnId: params.turnId, itemId: params.item?.id}
    } else if (method === "turn/completed" && params.threadId === state.activeThreadId) {
        upsertTurn(params.turn)
        if (state.activeTurnId === params.turn.id) state.activeTurnId = null
        state.sending = false
        const summary = state.threads.find((entry) => entry.id === params.threadId)
        if (summary) summary.updatedAt = Date.now() / 1000
        void refreshThreads(false)
        needsFullRender = true
    } else if (method === "error" && params.threadId === state.activeThreadId) {
        state.error = params.error?.message || "The task failed"
        if (!params.willRetry) {
            state.activeTurnId = null
            state.sending = false
        }
        needsFullRender = true
    }
    if (needsFullRender) queueRender()
    else if (dirtyItem?.turnId && dirtyItem?.itemId) {
        streamRenderQueue.enqueue(dirtyItem.turnId, dirtyItem.itemId)
    }
}

function clearRuntimeTaskState() {
    suspendThreadObservation()
    state.threads = []
    state.threadView = "current"
    state.threadLoadToken += 1
    state.modelRefreshToken += 1
    state.activeThreadId = null
    state.activeThread = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.loadingThread = false
    state.threadLoadFailed = false
    state.loadingThreads = true
    state.sending = false
    state.newTaskMode = false
    state.models = []
    state.selectedTaskModelId = null
    state.selectedTaskEffort = null
    state.selectedTaskPermissionMode = null
    state.pendingRuntimeQuestions.clear()
}

async function changeRuntime(operation, {markStarting = true, clearBefore = true} = {}) {
    if (state.runtimeOperationInProgress) return
    snapshotActiveThreadView()
    state.runtimeOperationInProgress = true
    state.runtimeEpoch += 1
    state.error = null
    if (clearBefore) {
        clearRuntimeTaskState()
        elements.composerInput.value = ""
        resizeComposer()
    }
    if (markStarting) state.runtime = {...state.runtime, status: "starting", error: null}
    renderAll()
    try {
        const runtime = await operation()
        if (!runtime) return
        if (!clearBefore) clearRuntimeTaskState()
        state.runtime = runtime
        restoreActiveThreadView()
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
elements.settingsDialog.addEventListener("close", () => void resumeThreadObservation())
elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveSettings()
})
for (const [modelSelect, effortSelect] of [
    [elements.settingsTaskModel, elements.settingsTaskEffort],
    [elements.settingsCuratorModel, elements.settingsCuratorEffort],
    [elements.settingsRubricModel, elements.settingsRubricEffort],
    [elements.settingsJudgeModel, elements.settingsJudgeEffort],
    [elements.settingsAutoCaptureModel, elements.settingsAutoCaptureEffort],
]) {
    modelSelect.addEventListener("change", () => {
        populateEffortSelect(effortSelect, effortSelect.value, modelSelect.value)
    })
}
elements.settingsAutoCaptureMode.addEventListener(
    "change",
    renderAutomaticCaptureSettingsVisibility,
)
elements.settingsAutoCaptureCadence.addEventListener(
    "change",
    renderAutomaticCaptureSettingsVisibility,
)
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
elements.refreshManagedSkills.addEventListener("click", () => void rescanManagedSkills())
elements.skillManagementWorkbench.addEventListener("click", (event) => {
    const sideView = event.target.closest("[data-managed-skill-side-view]")
    if (sideView) {
        state.managedSkillSideView = sideView.dataset.managedSkillSideView
        renderSkillManagementWorkbench()
        if (state.managedSkillSideView === "installations") {
            void refreshManagedInstallationRuntimeModels(false)
            if (state.activeManagedSkillId) {
                void loadManagedSkillInstallations(state.activeManagedSkillId)
            }
        }
        return
    }
    const installationJob = event.target.closest("[data-skill-installation-job-id]")
    if (installationJob) {
        state.activeSkillInstallationJobId = installationJob.dataset.skillInstallationJobId
        renderManagedSkillInstallations()
        return
    }
    const cancelQuestion = event.target.closest("[data-cancel-skill-installation-question]")
    if (cancelQuestion) {
        const form = cancelQuestion.closest("[data-skill-installation-question-id]")
        if (form) void respondSkillInstallationQuestion(form, {cancelled: true})
        return
    }
    const importer = event.target.closest("[data-import-skill]")
    if (importer) {
        const kind = importer.dataset.importSkill
        if (kind === "git-url") {
            clearManagedDialogError(elements.managedGitUrlError)
            elements.managedGitUrlDialog.showModal()
            elements.managedGitUrl.focus()
        } else {
            void importManagedSkill(kind)
        }
        return
    }
    const skillButton = event.target.closest("[data-managed-skill-id]")
    if (skillButton) {
        void selectManagedSkill(skillButton.dataset.managedSkillId)
        return
    }
    const repositoryButton = event.target.closest("[data-managed-repository-id]")
    if (repositoryButton) {
        const repositoryId = repositoryButton.dataset.managedRepositoryId
        const firstSkill = state.managedSkills.skills.find((entry) => entry.repositoryId === repositoryId)
        state.activeManagedRepositoryId = repositoryId
        if (firstSkill) void selectManagedSkill(firstSkill.id)
        else renderSkillManagementWorkbench()
        return
    }
    const reveal = event.target.closest("[data-reveal-managed-repository]")
    if (reveal) {
        void window.rollingSkill.revealManagedSkillRepository(
            reveal.dataset.revealManagedRepository,
        ).catch((error) => {
            state.managedSkillError = managedSkillErrorMessage(error)
            renderSkillManagementWorkbench()
        })
        return
    }
    const candidate = event.target.closest("[data-create-managed-candidate]")
    if (candidate) {
        state.managedCandidateSkillId = candidate.dataset.createManagedCandidate
        elements.managedCandidateMessage.value = ""
        clearManagedDialogError(elements.managedCandidateError)
        elements.managedCandidateDialog.showModal()
        elements.managedCandidateMessage.focus()
        return
    }
    const release = event.target.closest("[data-release-managed-version]")
    if (release) {
        state.managedReleaseVersionId = release.dataset.releaseManagedVersion
        elements.managedReleaseLabel.value = ""
        clearManagedDialogError(elements.managedReleaseError)
        elements.managedReleaseDialog.showModal()
        elements.managedReleaseLabel.focus()
        return
    }
    const deprecate = event.target.closest("[data-deprecate-managed-version]")
    if (deprecate) void deprecateManagedSkillVersion(deprecate.dataset.deprecateManagedVersion)
})
elements.managedSkillInstallations.addEventListener("change", (event) => {
    if (event.target === elements.managedInstallVersion) {
        state.managedInstallVersionId = elements.managedInstallVersion.value || null
        return
    }
    const toggle = event.target.closest("[data-managed-install-runtime-toggle]")
    const model = event.target.closest("[data-managed-install-runtime-model]")
    const effort = event.target.closest("[data-managed-install-runtime-effort]")
    const permission = event.target.closest("[data-managed-install-runtime-permission]")
    const runtimeId =
        toggle?.dataset.managedInstallRuntimeToggle ??
        model?.dataset.managedInstallRuntimeModel ??
        effort?.dataset.managedInstallRuntimeEffort ??
        permission?.dataset.managedInstallRuntimePermission
    const configuration = state.managedInstallConfigurations[runtimeId]
    if (!configuration) return
    if (toggle) configuration.selected = toggle.checked
    if (model) {
        configuration.modelId = model.value || null
        configuration.effort = null
    }
    if (effort) configuration.effort = effort.value || null
    if (permission) configuration.permissionMode = permission.value || null
    renderManagedSkillInstallations()
})
elements.managedSkillInstallations.addEventListener("submit", (event) => {
    const messageForm = event.target.closest("[data-skill-installation-message-form]")
    if (messageForm) {
        event.preventDefault()
        const jobId = messageForm.dataset.skillInstallationMessageForm
        const input = messageForm.querySelector("[data-skill-installation-message-input]")
        void sendSkillInstallationMessage(jobId, input?.value ?? "")
        return
    }
    const form = event.target.closest("[data-skill-installation-question-id]")
    if (!form) return
    event.preventDefault()
    void respondSkillInstallationQuestion(form)
})
elements.managedSkillInstallations.addEventListener("input", (event) => {
    const input = event.target.closest("[data-skill-installation-message-input]")
    if (!input) return
    if (input.value) state.skillInstallationInputDrafts.set(input.dataset.skillInstallationMessageInput, input.value)
    else state.skillInstallationInputDrafts.delete(input.dataset.skillInstallationMessageInput)
})
elements.startManagedSkillInstallations.addEventListener("click", () => {
    void startManagedSkillInstallations()
})
elements.cancelManagedSkillInstallation.addEventListener("click", () => {
    const jobId = elements.cancelManagedSkillInstallation.dataset.jobId
    if (jobId) void cancelManagedSkillInstallation(jobId)
})
elements.inspectManagedSkillInstallation.addEventListener("click", () => {
    const jobId = elements.inspectManagedSkillInstallation.dataset.jobId
    if (jobId) void inspectManagedSkillInstallation(jobId)
})
elements.closeManagedGitUrlDialog.addEventListener("click", () => elements.managedGitUrlDialog.close())
elements.cancelManagedGitUrl.addEventListener("click", () => elements.managedGitUrlDialog.close())
elements.managedGitUrlForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void importManagedGitUrl()
})
elements.managedGitUrlDialog.addEventListener("cancel", (event) => {
    if (state.managedSkillMutation) event.preventDefault()
})
elements.managedGitUrlDialog.addEventListener("close", () => {
    elements.managedGitUrl.value = ""
    clearManagedDialogError(elements.managedGitUrlError)
})
elements.closeManagedCandidateDialog.addEventListener("click", () => elements.managedCandidateDialog.close())
elements.cancelManagedCandidate.addEventListener("click", () => elements.managedCandidateDialog.close())
elements.managedCandidateForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void createManagedSkillCandidate()
})
elements.managedCandidateDialog.addEventListener("close", () => {
    state.managedCandidateSkillId = null
    clearManagedDialogError(elements.managedCandidateError)
})
elements.closeManagedReleaseDialog.addEventListener("click", () => elements.managedReleaseDialog.close())
elements.cancelManagedRelease.addEventListener("click", () => elements.managedReleaseDialog.close())
elements.managedReleaseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void releaseManagedSkillVersion()
})
elements.managedReleaseDialog.addEventListener("close", () => {
    state.managedReleaseVersionId = null
    clearManagedDialogError(elements.managedReleaseError)
})
elements.refreshEvaluation.addEventListener("click", () => loadEvaluationWorkbench(true))
elements.evaluationWorkbench.addEventListener("click", (event) => {
    const migrateLegacyRubric = event.target.closest("[data-migrate-legacy-rubric]")
    if (migrateLegacyRubric) {
        void migrateLegacyDatasetRubric(migrateLegacyRubric)
        return
    }
    const stopBatch = event.target.closest("[data-stop-calibration-batch]")
    if (stopBatch) {
        void stopAutomaticCalibrationBatch()
        return
    }
    const stopRefreshBatch = event.target.closest("[data-stop-refresh-batch]")
    if (stopRefreshBatch) {
        void stopCaseRefreshBatch()
        return
    }
    const startBatch = event.target.closest("[data-start-calibration-batch]")
    if (startBatch) {
        startAutomaticCalibrationBatch()
        return
    }
    const calibration = event.target.closest("[data-calibrate-evaluation-case]")
    if (calibration) {
        const currentSessionId = calibrationBatchSnapshot()?.currentSessionId
        if (currentSessionId) leaveAutomaticCalibrationForManualAction(currentSessionId)
        void createCaseCalibration(calibration.dataset.calibrateEvaluationCase)
        return
    }
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
    const refresh = event.target.closest("[data-refresh-evaluation-case]")
    if (refresh) {
        const currentCalibrationSessionId = calibrationBatchSnapshot()?.currentSessionId
        if (currentCalibrationSessionId) {
            leaveAutomaticCalibrationForManualAction(currentCalibrationSessionId)
        }
        void createCaseRefresh(refresh.dataset.refreshEvaluationCase)
        return
    }
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
elements.evaluationJudgeRuntime.addEventListener("change", () => {
    state.evaluationJudgeConfiguration = {
        runtimeId: elements.evaluationJudgeRuntime.value || null,
        modelId: null,
        effort: null,
    }
    renderEvaluationWorkbench()
})
elements.evaluationJudgeModel.addEventListener("change", () => {
    state.evaluationJudgeConfiguration.modelId = elements.evaluationJudgeModel.value || null
    state.evaluationJudgeConfiguration.effort = null
    renderEvaluationWorkbench()
})
elements.evaluationJudgeEffort.addEventListener("change", () => {
    state.evaluationJudgeConfiguration.effort = elements.evaluationJudgeEffort.value || null
})
elements.evaluationRunList.addEventListener("click", (event) => {
    const cancel = event.target.closest("[data-cancel-evaluation-run]")
    if (cancel) {
        openCancelEvaluationRunDialog(cancel.dataset.cancelEvaluationRun)
        return
    }
    const remove = event.target.closest("[data-delete-evaluation-run]")
    if (remove) {
        openDeleteEvaluationRunDialog(remove.dataset.deleteEvaluationRun)
        return
    }
    const button = event.target.closest("[data-evaluation-run-id]")
    if (!button) return
    void selectEvaluationRun(button.dataset.evaluationRunId)
})
elements.evaluationRunDetail.addEventListener("click", (event) => {
    const runtimeView = event.target.closest("[data-evaluation-runtime-view]")
    if (runtimeView && state.activeEvaluationRunId) {
        state.evaluationRuntimeViewByRun[state.activeEvaluationRunId] =
            runtimeView.dataset.evaluationRuntimeView
        renderEvaluationRuns()
        return
    }
    const cancel = event.target.closest("[data-cancel-evaluation-run]")
    if (cancel) openCancelEvaluationRunDialog(cancel.dataset.cancelEvaluationRun)
})
elements.evaluationRunDetail.addEventListener("keydown", (event) => {
    const runtimeView = event.target.closest("[data-evaluation-runtime-view]")
    if (!runtimeView || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    const tabs = [...elements.evaluationRunDetail.querySelectorAll("[data-evaluation-runtime-view]")]
    const currentIndex = tabs.indexOf(runtimeView)
    if (currentIndex < 0 || !tabs.length) return
    event.preventDefault()
    const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
    const runtimeId = tabs[nextIndex].dataset.evaluationRuntimeView
    if (!state.activeEvaluationRunId || !runtimeId) return
    state.evaluationRuntimeViewByRun[state.activeEvaluationRunId] = runtimeId
    renderEvaluationRuns()
    requestAnimationFrame(() => {
        elements.evaluationRunDetail.querySelector(
            `[data-evaluation-runtime-view="${CSS.escape(runtimeId)}"]`,
        )?.focus()
    })
})
elements.evaluationCreateDataset.addEventListener("submit", (event) => {
    event.preventDefault()
    void createEvaluationDataset()
})
elements.exportEvaluationDataset.addEventListener("click", openExportDatasetDialog)
elements.closeExportDatasetDialog.addEventListener("click", () =>
    elements.exportDatasetDialog.close(),
)
elements.cancelExportDataset.addEventListener("click", () => elements.exportDatasetDialog.close())
elements.exportDatasetForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void exportEvaluationDataset()
})
elements.openCaseRefreshBatch.addEventListener("click", openCaseRefreshBatchDialog)
elements.closeCaseRefreshBatchDialog.addEventListener("click", () =>
    elements.caseRefreshBatchDialog.close(),
)
elements.cancelCaseRefreshBatch.addEventListener("click", () =>
    elements.caseRefreshBatchDialog.close(),
)
elements.caseRefreshBatchForm.addEventListener("change", updateCaseRefreshBatchSelection)
elements.caseRefreshBatchForm.addEventListener("submit", (event) => {
    event.preventDefault()
    startCaseRefreshBatch()
})
elements.changeEvaluationDatasetSkill.addEventListener("click", () =>
    openDatasetSkillDialog(state.evaluationDatasetId),
)
elements.manageDatasetRubric.addEventListener("click", () => setRubricOpen(true))
elements.startEvaluation.addEventListener("click", () => void startEvaluation("selected"))
elements.startDatasetEvaluation.addEventListener("click", () => void startEvaluation("dataset"))
elements.topbarCurations.addEventListener("click", () => setCurationOpen(true))
elements.topbarTrace.addEventListener("click", () => setTraceOpen(true))
elements.topbarRawCases.addEventListener("click", () => {
    const opening = !state.rawCaseOpen
    if (opening) closeTransientDrawersForCompactRawCases()
    state.rawCaseOpen = opening
    renderRawCases()
})
elements.closeRawCases.addEventListener("click", () => {
    state.rawCaseOpen = false
    renderRawCases()
})
elements.rawCaseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void saveRawCaseForm()
})
elements.cancelRawCaseEdit.addEventListener("click", clearRawCaseForm)
elements.rawCaseList.addEventListener("click", (event) => {
    const openDraft = event.target.closest("[data-open-raw-case-draft]")
    if (openDraft) {
        const rawCaseId = openDraft.dataset.openRawCaseDraft
        state.rawCaseDraftChooserId = rawCaseId
        state.rawCaseDraftErrors.delete(rawCaseId)
        renderRawCases()
        return
    }
    const cancelDraft = event.target.closest("[data-cancel-raw-case-draft]")
    if (cancelDraft) {
        state.rawCaseDraftChooserId = null
        state.rawCaseDraftErrors.delete(cancelDraft.dataset.cancelRawCaseDraft)
        renderRawCases()
        return
    }
    const createDraft = event.target.closest("[data-create-raw-case-draft]")
    if (createDraft) {
        const rawCaseId = createDraft.dataset.createRawCaseDraft
        const datasetId = elements.rawCaseList.querySelector(
            `[data-raw-case-draft-dataset="${CSS.escape(rawCaseId)}"]`,
        )?.value
        if (datasetId) void createRawCaseDraft(rawCaseId, datasetId)
        return
    }
    const edit = event.target.closest("[data-edit-raw-case]")
    if (edit) {
        editRawCase(edit.dataset.editRawCase)
        return
    }
    const remove = event.target.closest("[data-delete-raw-case]")
    if (remove) {
        void deleteRawCase(remove.dataset.deleteRawCase)
        return
    }
    const dispatch = event.target.closest("[data-dispatch-raw-case]")
    if (dispatch) {
        void dispatchRawCase(dispatch.dataset.dispatchRawCase, dispatch.dataset.dispatchMode)
    }
})
elements.closeTrace.addEventListener("click", () => setTraceOpen(false))
elements.closeCurations.addEventListener("click", () => setCurationOpen(false))
elements.closeRubricDrawer.addEventListener("click", () => setRubricOpen(false))
elements.refreshTrace.addEventListener("click", loadTrace)
elements.openTraceFolder.addEventListener("click", () => window.rollingSkill.openTraceFolder())
elements.runtimeStatus.addEventListener("click", async () => {
    openRuntimeDialog()
})
elements.closeRuntimeDialog.addEventListener("click", () => elements.runtimeDialog.close())
elements.confirmRuntime.addEventListener("click", () => elements.runtimeDialog.close())
elements.runtimeDialog.addEventListener("close", () => void resumeThreadObservation())
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
elements.composerInput.addEventListener("input", () => {
    threadViewState.updateDraft(threadViewIdentity(), elements.composerInput.value)
    resizeComposer()
})
elements.conversationScroll.addEventListener("scroll", queueActiveScrollSnapshot)
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
elements.composerAccess.addEventListener("change", () => {
    state.selectedTaskPermissionMode = elements.composerAccess.value || null
    renderComposer()
})
elements.stopTurn.addEventListener("click", stopTurn)
elements.conversation.addEventListener("click", (event) => {
    const cancelQuestion = event.target.closest("[data-cancel-runtime-question]")
    if (cancelQuestion) {
        const form = cancelQuestion.closest("[data-runtime-question-id]")
        if (form) void respondRuntimeQuestion(form, {cancelled: true})
        return
    }
    const external = event.target.closest("[data-external-url]")
    if (external) {
        event.preventDefault()
        void window.rollingSkill
            .openExternal(external.dataset.externalUrl)
            .catch((error) => reportLinkOpenFailure(error, "externalLinkUnavailable"))
        return
    }
    const local = event.target.closest("[data-local-path]")
    if (local) {
        event.preventDefault()
        void window.rollingSkill
            .openLocalPath(local.dataset.localPath)
            .catch((error) => reportLinkOpenFailure(error, "localFileUnavailable"))
        return
    }
    const button = event.target.closest("[data-save-case]")
    if (button) void openCaseDialog(button.dataset.turnId, button.dataset.itemId)
})
elements.conversation.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-runtime-question-id]")
    if (!form) return
    event.preventDefault()
    void respondRuntimeQuestion(form)
})
elements.closeCaseDialog.addEventListener("click", () => elements.caseDialog.close())
elements.cancelSaveCase.addEventListener("click", () => elements.caseDialog.close())
elements.caseDialog.addEventListener("close", () => {
    state.caseSelection = null
    clearCaseError()
    void resumeThreadObservation()
})
elements.caseDialog.addEventListener("cancel", (event) => {
    if (state.caseCreationInProgress) event.preventDefault()
})
elements.caseStartItem.addEventListener("change", updateEpisodeStartPreview)
elements.caseDataset.addEventListener("change", renderCaseDatasetSkillStatus)
elements.changeCaseDatasetSkill.addEventListener("click", () =>
    openDatasetSkillDialog(elements.caseDataset.value),
)
elements.createDataset.addEventListener("click", createDataset)
elements.caseForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void createCuration()
})
elements.closeDatasetSkillDialog.addEventListener("click", () => elements.datasetSkillDialog.close())
elements.cancelDatasetSkill.addEventListener("click", () => elements.datasetSkillDialog.close())
elements.datasetSkillForm.addEventListener("submit", (event) => {
    event.preventDefault()
    void bindDatasetSkill()
})
elements.datasetSkillDialog.addEventListener("close", () => {
    state.datasetSkillDialogDatasetId = null
})
elements.curationList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-curation-id]")
    if (!button) return
    state.activeCurationId = button.dataset.curationId
    renderCurations()
})
elements.curationDetail.addEventListener("click", (event) => {
    const stopBatch = event.target.closest("[data-stop-calibration-batch]")
    if (stopBatch) {
        void stopAutomaticCalibrationBatch()
        return
    }
    const stopRefreshBatch = event.target.closest("[data-stop-refresh-batch]")
    if (stopRefreshBatch) {
        void stopCaseRefreshBatch()
        return
    }
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
elements.curationDetail.addEventListener("input", (event) => {
    const input = event.target.closest("[data-curation-input]")
    if (!input) return
    if (input.value) state.curationInputDrafts.set(input.dataset.curationInput, input.value)
    else state.curationInputDrafts.delete(input.dataset.curationInput)
})
elements.curationDetail.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-curation-form]")
    if (!form) return
    event.preventDefault()
    const input = form.querySelector("[data-curation-input]")
    const text = input?.value ?? ""
    void sendCurationMessage(form.dataset.curationForm, text)
})
elements.rubricDetail.addEventListener("click", (event) => {
    const create = event.target.closest("[data-create-rubric]")
    if (create) void createRubricSession()
    const retry = event.target.closest("[data-retry-rubric]")
    if (retry) void retryRubricSession(retry.dataset.retryRubric)
    const publish = event.target.closest("[data-publish-rubric]")
    if (publish) void publishRubricSession(publish.dataset.publishRubric)
    const discard = event.target.closest("[data-discard-rubric]")
    if (discard) void discardRubricSession(discard.dataset.discardRubric)
})
elements.rubricDetail.addEventListener("change", (event) => {
    const model = event.target.closest("[data-rubric-model]")
    if (model) void updateRubricModel(model.dataset.rubricModel, model.value)
    const effort = event.target.closest("[data-rubric-effort]")
    if (effort) void updateRubricEffort(effort.dataset.rubricEffort, effort.value)
})
elements.rubricDetail.addEventListener("input", (event) => {
    const input = event.target.closest("[data-rubric-input]")
    if (!input) return
    if (input.value) state.rubricInputDrafts.set(input.dataset.rubricInput, input.value)
    else state.rubricInputDrafts.delete(input.dataset.rubricInput)
})
elements.rubricDetail.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-rubric-form]")
    if (!form) return
    event.preventDefault()
    const input = form.querySelector("[data-rubric-input]")
    void sendRubricMessage(form.dataset.rubricForm, input?.value ?? "")
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
elements.closeCancelEvaluationRunDialog.addEventListener("click", () => elements.cancelEvaluationRunDialog.close())
elements.dismissCancelEvaluationRun.addEventListener("click", () => elements.cancelEvaluationRunDialog.close())
elements.confirmCancelEvaluationRun.addEventListener("click", () => void cancelEvaluationRun())

window.rollingSkill.onRuntimeState((runtime) => {
    const previousRuntimeStatus = state.runtime?.status
    const runtimeChanged = runtimeViewId(runtime) !== runtimeViewId(state.runtime)
    const externalRuntimeChange = runtimeChanged && !state.runtimeOperationInProgress
    if (externalRuntimeChange) {
        snapshotActiveThreadView()
        state.runtimeEpoch += 1
        clearRuntimeTaskState()
    }
    state.runtime = runtime
    operatorWorkbench?.setCatalogs(operatorCatalogSnapshot())
    if (runtimeChanged) restoreActiveThreadView()
    state.runtimeErrorDismissed = false
    if (externalRuntimeChange) renderAll()
    else {
        renderRuntime()
        renderComposer()
    }
    if (runtime.status === "ready") {
        if (externalRuntimeChange || previousRuntimeStatus !== "ready") {
            void Promise.all([refreshThreads(true), refreshModels()])
        } else {
            void refreshModels()
        }
    } else if (externalRuntimeChange) {
        state.loadingThreads = false
        renderThreads()
    }
    if (state.surface === "evaluation") void loadEvaluationWorkbench(true)
    if (state.surface === "skills" && state.managedSkillSideView === "installations") {
        ensureManagedInstallConfigurations()
        void refreshManagedInstallationRuntimeModels(false)
    }
})
window.rollingSkill.onRuntimeNotification(handleNotification)
window.rollingSkill.onRuntimeQuestion(onRuntimeQuestion)
window.rollingSkill.onRuntimeQuestionResolved(onRuntimeQuestionResolved)
window.rollingSkill.onRawCasesChanged((rawCases) => {
    state.rawCases = rawCases ?? []
    const pendingIds = new Set(state.rawCases.map((rawCase) => rawCase.id))
    if (!pendingIds.has(state.rawCaseDraftChooserId)) state.rawCaseDraftChooserId = null
    for (const rawCaseId of state.rawCaseDraftErrors.keys()) {
        if (!pendingIds.has(rawCaseId)) state.rawCaseDraftErrors.delete(rawCaseId)
    }
    renderRawCases()
})
window.rollingSkill.onAutomaticCaptureStatus((status) => {
    state.automaticCaptureStatus = {
        ...state.automaticCaptureStatus,
        ...(status ?? {}),
    }
    renderCaptureStatus()
})
window.rollingSkill.onManagedSkillsChanged((overview) => {
    state.managedSkills = normalizedManagedSkills(overview)
    reconcileManagedSkillSelection()
    operatorWorkbench?.setCatalogs(operatorCatalogSnapshot())
    if (state.surface === "skills") {
        renderSkillManagementWorkbench()
        if (state.activeManagedSkillId) void readActiveManagedSkill()
    }
})
window.rollingSkill.onSkillInstallationsChanged((job) => {
    if (!mergeSkillInstallationJob(job)) return
    if (state.surface === "skills") renderManagedSkillInstallations()
    if (TERMINAL_SKILL_INSTALLATION_STATUSES.has(job.status)) {
        void loadManagedSkillInstallations(job.request.source.skillId)
    }
})
window.rollingSkill.onSkillInstallationQuestion((request) => {
    if (!request?.requestId || !request?.jobId) return
    state.pendingSkillInstallationQuestions.set(request.requestId, request)
    if (
        state.surface === "skills" &&
        state.managedSkillSideView === "installations" &&
        request.jobId === state.activeSkillInstallationJobId
    ) {
        renderManagedSkillInstallations()
    }
})
window.rollingSkill.onSkillInstallationQuestionResolved((payload) => {
    if (!payload?.requestId) return
    const request = state.pendingSkillInstallationQuestions.get(payload.requestId)
    state.pendingSkillInstallationQuestions.delete(payload.requestId)
    if (request?.jobId === state.activeSkillInstallationJobId) {
        renderManagedSkillInstallations()
    }
})
window.rollingSkill.onCurationChanged((session) => {
    const revisionCount = session.revisions?.length ?? 0
    const previousCount = state.curationRevisionCounts.get(session.id) ?? 0
    if (revisionCount > previousCount) state.flashingCurationReferences.add(session.id)
    state.curationRevisionCounts.set(session.id, revisionCount)
    upsertSourceCurationMarker(session)
    upsertCuration(session)
    if (!state.activeCurationId) state.activeCurationId = session.id
    renderCurations()
    handleCalibrationBatchSessionUpdate(session)
    handleRefreshBatchSessionUpdate(session)
    if (
        state.surface === "evaluation" &&
        (session.operation === "calibration" || session.operation === "refresh")
    ) {
        renderEvaluationWorkbench()
    }
    if (
        session.operation !== "calibration" &&
        session.operation !== "refresh" &&
        session.episode?.source?.threadId === state.activeThreadId
    ) {
        renderConversation()
    }
})
window.rollingSkill.onCurationActivity((activity) => {
    enqueueLiveActivityPatch("curation", activity)
})
window.rollingSkill.onRubricChanged((session) => {
    if (!session?.datasetId || session.datasetId !== state.evaluationDatasetId) return
    upsertRubricSession(session)
    if (!state.activeRubricSessionId && session.status !== "archived") {
        state.activeRubricSessionId = session.id
    }
    renderRubricDrawer()
    renderEvaluationWorkbench()
})
window.rollingSkill.onRubricActivity((activity) => {
    if (!activity?.sessionId) return
    if (!state.rubricSessions.some((session) => session.id === activity.sessionId)) return
    enqueueLiveActivityPatch("rubric", activity)
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
        const run = await window.rollingSkill.getEvaluationRun(runId)
        state.evaluationRunDetails[runId] = run
        if (state.activeEvaluationRunId === runId) state.activeEvaluationRun = run
        renderEvaluationWorkbench()
    } catch {
        // The next explicit refresh will reconcile local run history.
    }
})
window.rollingSkill.onWorkspaceChanged(async ({workspaceRoot}) => {
    suspendThreadObservation()
    snapshotActiveThreadView()
    state.threadLoadToken += 1
    state.loadingThread = false
    state.threadLoadFailed = false
    state.workspaceRoot = workspaceRoot
    state.threadView = "current"
    state.activeThread = null
    state.activeThreadId = null
    state.activeThreadArchived = false
    state.activeTurnId = null
    state.newTaskMode = false
    const profile = configuredTaskProfile()
    state.selectedTaskModelId = profile.modelId
    state.selectedTaskEffort = profile.effort
    state.selectedTaskPermissionMode = defaultPermissionMode()
    restoreActiveThreadView()
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
        state.rawCases = initial.rawCases ?? []
        state.automaticCaptureStatus = {
            ...state.automaticCaptureStatus,
            ...(initial.automaticCaptureStatus ?? {}),
        }
        state.managedSkills = normalizedManagedSkills(initial.managedSkills)
        state.skillInstallations = normalizedSkillInstallationOverview(initial.skillInstallations)
        state.managedSkillError = initial.managedSkillStartupError ?? null
        reconcileManagedSkillSelection()
        state.evaluationDatasetId = state.datasets[0]?.id ?? null
        state.curationSessions = initial.curationSessions ?? []
        state.sourceCurationMarkers = initial.sourceCurationMarkers ?? []
        state.curationRevisionCounts = new Map(
            state.curationSessions.map((session) => [session.id, session.revisions?.length ?? 0]),
        )
        applySettings(initial.settings ?? state.settings)
        state.selectedTaskModelId = state.settings.taskProfile?.modelId ?? null
        state.selectedTaskEffort = state.settings.taskProfile?.effort ?? null
        state.selectedTaskPermissionMode = defaultPermissionMode()
        state.activeCurationId = state.curationSessions[0]?.id ?? null
        if (typeof window.rollingSkill.bootstrapOperator === "function") {
            operatorWorkbench = globalThis.RollingSkillOperatorWorkbench.createOperatorWorkbench({
                api: window.rollingSkill,
                root: elements.operatorWorkbench,
                language: () => state.settings.language,
                translate: t,
                formatMessage,
                onError: showError,
                onSelectEntity: selectOperatorEntity,
            })
            operatorWorkbench.setCatalogs(operatorCatalogSnapshot())
            await operatorWorkbench.initialize()
        }
        if (!elements.rawCaseSkill.value) elements.rawCaseSkill.value = suggestedRawCaseSkill()
        restoreActiveThreadView()
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
let compactDrawerLayout = window.innerWidth <= 1120
window.addEventListener("resize", () => {
    const nextCompactDrawerLayout = window.innerWidth <= 1120
    if (
        nextCompactDrawerLayout &&
        !compactDrawerLayout &&
        state.rawCaseOpen &&
        transientDrawerIsOpen()
    ) {
        state.rawCaseOpen = false
        renderRawCases()
    }
    compactDrawerLayout = nextCompactDrawerLayout
})
setInterval(() => {
    if (state.curationOpen) {
        for (const activity of state.curationActivities.values()) patchCurationActivityCard(activity)
    }
    if (state.rubricOpen) {
        for (const activity of state.rubricActivities.values()) patchRubricActivityCard(activity)
    }
}, 1_000)
window.addEventListener("beforeunload", () => {
    snapshotActiveThreadView()
    operatorWorkbench?.destroy()
})
void bootstrap()
