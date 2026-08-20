const {contextBridge} = require("electron")

const settings = {
    autoCapture: false,
    language: "zh-CN",
    theme: process.env.ROLLING_SKILL_RENDERER_SMOKE_THEME || "codex-light",
    localAccess: "full",
    taskProfile: {runtimePolicy: "active", modelId: null, effort: null},
    curatorProfile: {runtimePolicy: "active", modelId: null, effort: null},
    rubricProfile: {runtimePolicy: "active", modelId: null, effort: "high"},
    autoCaptureProfile: {
        runtimePolicy: "active",
        modelId: null,
        effort: null,
        datasetId: null,
        caseType: "goodcase",
    },
}

let lastRuntimeQuestionResponse = null

function conversationThread(id, name, marker) {
    const turns = Array.from({length: 18}, (_unused, index) => ({
        id: `${id}-turn-${index}`,
        status: "completed",
        items: [
            {
                id: `${id}-user-${index}`,
                type: "userMessage",
                content: [{type: "text", text: `${marker} question ${index}`}],
            },
            ...(index === 0
                ? [
                      {
                          id: `${id}-command`,
                          type: "commandExecution",
                          status: "completed",
                          command: "billing-cli cost query",
                          aggregatedOutput: "huge-noisy-shell-output",
                      },
                      {
                          id: `${id}-mcp`,
                          type: "mcpToolCall",
                          status: "completed",
                          server: "billing",
                          tool: "query_cost",
                      },
                      {
                          id: `${id}-subagent`,
                          type: "subAgentActivity",
                          kind: "completed",
                          agentPath: "/root/reviewer",
                      },
                      {id: `${id}-compaction`, type: "contextCompaction"},
                  ]
                : []),
            {
                id: `${id}-agent-${index}`,
                type: "agentMessage",
                text:
                    index === 0
                        ? `## ${marker} result\n\n- **verified**\n- item ${index}\n\n| Model | Cost |\n| --- | ---: |\n| Hunyuan | 12 |\n\n[docs](https://example.com/docs) [report](</tmp/rolling-skill-renderer-smoke/report.md:3>) [route](/v1/responses) [run](javascript:alert(1))\n\n![remote](https://example.com/image.png) <script>unsafe()</script>\n\n\`https://example.com/in-code\`\n\n\`\`\`sh\necho A/B\n\`\`\``
                        : `${marker} response ${index}\n\nThis makes the conversation tall enough to test reading-position restoration.`,
            },
        ],
    }))
    return {
        id,
        name,
        preview: `${marker} preview`,
        updatedAt: id === "thread-a" ? 2 : 1,
        status: "idle",
        turns,
    }
}

const threads = {
    "thread-a": conversationThread("thread-a", "Thread A", "Alpha"),
    "thread-b": conversationThread("thread-b", "Thread B", "Beta"),
}

function curatedDraft(summary) {
    return {
        schemaVersion: "rolling-skill-curated-case/v1",
        referenceAnswer: {
            summary,
            requiredFacts: ["July is the billing period."],
            requiredSteps: ["Query and verify the billing source."],
            requiredOutputFormat: ["State amount and currency."],
            evidence: [{claim: "The question asks for July.", sourceItemIds: ["thread-a-user-0"]}],
        },
        grading: {
            hardRequirements: [{
                id: "H1",
                criterion: "Uses July billing data",
                passCondition: "The answer explicitly identifies July.",
                evidenceBasis: "The source question asks for July.",
            }],
            softCriteria: [{id: "S1", criterion: "Concise", weight: 1}],
            automaticFailures: ["Invents an unverified amount"],
        },
        badCaseAnalysis: null,
    }
}

function curationSession(overrides = {}) {
    const draft = overrides.draft ?? curatedDraft("Initial verified reference")
    return {
        id: "curation-live-smoke",
        caseType: "goodcase",
        status: "running",
        issueDescription: "回答遗漏了一个业务线。",
        episode: {
            originalQuestion: "查一下7月份账单，各业务混元3多少成本？",
            source: {
                threadId: "thread-a",
                startItemId: "thread-a-user-0",
                endItemId: "thread-a-agent-0",
            },
            items: [
                {id: "thread-a-user-0", type: "userMessage"},
                {id: "thread-a-agent-0", type: "agentMessage"},
            ],
            toolActivity: [{signature: "billing-cli cost query"}],
        },
        skillReference: {name: "billing-cost-management"},
        curator: {
            modelId: null,
            effort: null,
            effectiveModelId: "gpt-5.6-sol",
            effectiveEffort: "xhigh",
            threadId: "curator-live-thread",
            currentTurnId: "curator-live-turn",
        },
        conversation: [{
            role: "assistant",
            text: `Initial review note.\n\n\`\`\`\n${JSON.stringify(draft)}\n\`\`\``,
            turnId: "curator-initial-turn",
        }],
        draft,
        revisions: [{createdAt: "2026-08-12T10:00:00.000Z"}],
        createdAt: "2026-08-12T10:00:00.000Z",
        updatedAt: "2026-08-12T10:01:00.000Z",
        error: null,
        ...overrides,
    }
}

let smokeCurationSession = curationSession()
let smokeRawCases = [{
    id: "raw-case-smoke",
    question: "查一下还没验证的 8 月账单问题",
    skill: {
        name: "billing-cost-management",
        path: "/tmp/rolling-skill-renderer-smoke/billing-cost-management/SKILL.md",
    },
    note: "Renderer smoke",
    source: {kind: "external-mcp"},
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
}]
let lastRawCaseTurnText = null
const smokeEvaluationCase = {
    id: "case-smoke",
    datasetId: "dataset-smoke",
    caseType: "goodcase",
    question: "用户后来对这个 Case 的评价，不应成为卡片标题",
    answer: "Structured reference answer",
    curated: curatedDraft("Verified case summary"),
    source: {
        originalQuestion: "查一下7月份账单，各业务混元3多少成本？",
    },
    rubricVersionId: null,
    rubricCalibration: {
        status: "needed",
        rubricVersionId: "rubric-version-smoke",
        previousRubricVersionId: null,
    },
}
const smokeEvaluationCaseTwo = {
    ...smokeEvaluationCase,
    id: "case-smoke-2",
    question: "第二条 Case 的后续评价",
    source: {
        originalQuestion: "查一下7月份，技术产品自身成本和结算成本情况",
    },
    curated: curatedDraft("Second verified case summary"),
}
let smokeEvaluationCases = [smokeEvaluationCase, smokeEvaluationCaseTwo]
const smokeCalibrationSessions = new Map()
let calibrationCreateOrder = []
let calibrationArchiveOrder = []
let calibrationDiscardOrder = []
const noOpSubscription = () => () => {}
let readCount = 0
let nextReadFailureThreadId = null
let failNextCuration = false
let lastCurationInput = null
let lastCalibrationInput = null
const notificationListeners = new Set()
const runtimeStateListeners = new Set()
let observationSequence = 0
let threadObservation = null
let deliveredTimelineNotifications = 0
let blockedTimelineNotifications = 0

const summaryNotificationMethods = new Set([
    "thread/started",
    "thread/archived",
    "thread/unarchived",
    "thread/name/updated",
    "thread/status/changed",
])

function notificationThreadId(message) {
    return message?.params?.threadId ?? message?.params?.thread?.id ?? null
}

function emitRuntimeNotification(message) {
    if (summaryNotificationMethods.has(message?.method)) {
        for (const listener of notificationListeners) listener(message)
        return
    }
    const threadId = notificationThreadId(message)
    if (!threadObservation || threadObservation.threadId !== threadId) {
        blockedTimelineNotifications += 1
        return
    }
    if (threadObservation.phase !== "live") {
        threadObservation.buffer.push(message)
        return
    }
    deliveredTimelineNotifications += 1
    for (const listener of notificationListeners) listener(message)
}
const runtimeQuestionListeners = new Set()
const runtimeQuestionResolvedListeners = new Set()
const rawCasesChangedListeners = new Set()
const managedSkillsChangedListeners = new Set()
const curationChangedListeners = new Set()
const curationActivityListeners = new Set()
const rubricChangedListeners = new Set()
const rubricActivityListeners = new Set()
const modelDelayByRuntime = new Map()
let currentRuntimeId = "codex:renderer-smoke"
const smokeSkillReference = {
    schemaVersion: "rolling-skill-skill-reference/v1",
    name: "billing-cost-management",
    path: "/tmp/rolling-skill-renderer-smoke/billing-cost-management/SKILL.md",
    scope: "user",
    description: "Smoke Skill",
    runtimeId: "codex:renderer-smoke",
    confirmedAt: "2026-08-13T00:00:00.000Z",
}
const smokeManagedRepository = {
    id: "managed-repository-smoke",
    displayName: "Billing Skill",
    defaultBranch: "main",
    source: {kind: "folder", location: "billing-cost-management"},
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
}
const smokeManagedSkill = {
    id: "managed-skill-smoke",
    repositoryId: smokeManagedRepository.id,
    name: "billing-cost-management",
    description: "Smoke managed Skill",
    skillRoot: ".",
    manifestPath: "SKILL.md",
    status: "valid",
    warnings: [],
    executableFiles: [],
}
const smokeManagedSkillTwo = {
    ...smokeManagedSkill,
    id: "managed-skill-smoke-two",
    name: "billing-cost-analysis",
    description: "Second managed Skill",
    skillRoot: "skills/analysis",
    manifestPath: "skills/analysis/SKILL.md",
}
let smokeManagedVersions = [{
    id: "managed-version-smoke",
    repositoryId: smokeManagedRepository.id,
    skillId: smokeManagedSkill.id,
    skillRoot: ".",
    commit: "0123456789abcdef0123456789abcdef01234567",
    contentDigest: `sha256:${"a".repeat(64)}`,
    state: "candidate",
    versionLabel: null,
    createdBy: "import",
    createdAt: "2026-08-20T00:00:00.000Z",
    releasedAt: null,
    deprecatedAt: null,
}, {
    id: "managed-version-released-smoke",
    repositoryId: smokeManagedRepository.id,
    skillId: smokeManagedSkillTwo.id,
    skillRoot: smokeManagedSkillTwo.skillRoot,
    commit: "89abcdef0123456789abcdef0123456789abcdef",
    contentDigest: `sha256:${"b".repeat(64)}`,
    state: "released",
    versionLabel: "v0.9.0",
    createdBy: "import",
    createdAt: "2026-08-19T00:00:00.000Z",
    releasedAt: "2026-08-19T00:01:00.000Z",
    deprecatedAt: null,
}]

function smokeManagedOverview() {
    return {
        repositories: [smokeManagedRepository],
        skills: [smokeManagedSkill, smokeManagedSkillTwo],
        versions: smokeManagedVersions,
    }
}

function emitManagedSkillsChanged() {
    const overview = smokeManagedOverview()
    for (const listener of managedSkillsChangedListeners) listener(overview)
}
const smokeRubric = {
    schemaVersion: "rolling-skill-dataset-rubric/v1",
    scoringModel: "unified-100/v1",
    title: "账单结果质量标准",
    summary: "检查账单 Skill 的业务口径、成本结论和证据完整性。",
    criteria: [{
        id: "R1",
        title: "账单结论完整性",
        criterion: "返回范围明确且有证据支持的成本结论。",
        weight: 1,
        evidenceRequirements: ["Agent 回答", "冻结的 Case 参考事实"],
        scoringAnchors: {
            "0": "结论缺失或捏造。",
            "2": "大部分结论无证据。",
            "5": "结论部分完整。",
            "8": "结论基本完整且仅有轻微缺口。",
            "10": "全部结论完整、可归因且已交叉校验。",
        },
        criticalFailure: true,
    }],
    automaticFailures: [{
        id: "RF1",
        condition: "回答捏造了任何无证据支持的账单数字。",
        rationale: "虚构财务结论会使结果不可用。",
    }],
}
const smokeRubricVersion = {
    id: "rubric-version-smoke",
    datasetId: "dataset-smoke",
    version: 1,
    rubric: smokeRubric,
    rubricDigest: "sha256:smoke",
    createdAt: "2026-08-13T00:00:00.000Z",
    publishedAt: "2026-08-13T00:00:00.000Z",
}
let smokeRubricSession = {
    id: "rubric-session-smoke",
    datasetId: "dataset-smoke",
    baseVersionId: smokeRubricVersion.id,
    status: "needs_review",
    skillReference: smokeSkillReference,
    rubricAgent: {
        runtimeId: "codex:renderer-smoke",
        modelId: null,
        effort: "high",
        effectiveModelId: "gpt-5.6-sol",
        effectiveEffort: "high",
        threadId: "rubric-thread-smoke",
        currentTurnId: null,
    },
    conversation: [
        {role: "user", text: "把跨业务线归因写得更清楚。"},
        {role: "assistant", text: "已补充账单结论的范围和证据要求。"},
    ],
    revisions: [{createdAt: "2026-08-13T00:02:00.000Z"}],
    draft: smokeRubric,
    error: null,
    createdAt: "2026-08-13T00:01:00.000Z",
    updatedAt: "2026-08-13T00:02:00.000Z",
}
let smokeDatasets = [{
    id: "dataset-smoke",
    name: "Smoke Dataset",
    caseCount: 2,
    goodcaseCount: 2,
    badcaseCount: 0,
    skillReference: smokeSkillReference,
    activeRubricVersionId: smokeRubricVersion.id,
}]
const smokeEvaluationRun = {
    id: "run-smoke",
    datasetId: "dataset-smoke",
    datasetSnapshot: {id: "dataset-smoke", name: "Smoke Dataset"},
    selectionMode: "dataset",
    activationMode: "automatic",
    skillReference: smokeSkillReference,
    rubricVersionSnapshot: smokeRubricVersion,
    status: "completed",
    createdAt: "2026-08-13T00:00:00.000Z",
    completedAt: "2026-08-13T00:01:05.000Z",
    caseSnapshots: [smokeEvaluationCase, smokeEvaluationCaseTwo],
    runtimeConfigurations: [
        {
            runtimeId: "codex:renderer-smoke",
            displayName: "Codex",
            modelId: "gpt-5.6-sol",
            effort: "high",
        },
        {
            runtimeId: "codebuddy:renderer-smoke",
            displayName: "CodeBuddy",
            modelId: "claude-sonnet-4.5",
            effort: "high",
        },
    ],
    results: [
        {
            id: "result-smoke-codex-one",
            runtimeId: "codex:renderer-smoke",
            runtimeConfiguration: {
                runtimeId: "codex:renderer-smoke",
                displayName: "Codex",
                modelId: "gpt-5.6-sol",
                effort: "high",
            },
            caseSnapshot: smokeEvaluationCase,
            status: "completed",
            gradingStatus: "completed",
            durationMs: 65_000,
            response: "Smoke evaluation answer",
            scoreContract: {
                schemaVersion: "rolling-skill-score-contract/v2",
                criteria: [{
                    id: "R1",
                    title: "Skill 工作流与结论",
                    criterion: "按 Skill 工作流返回有证据的账单结论。",
                    weight: 1,
                    criticalFailure: false,
                }],
            },
            judgment: {
                assessments: [{
                    criterionId: "R1",
                    status: "scored",
                    rating: 8.4,
                    confidence: 0.9,
                    verificationStatus: "verified",
                    verifiableFields: ["账期", "金额"],
                    crossChecks: ["回答与 Trace 一致"],
                    evidenceRefs: ["response"],
                    rationale: "工作流和结论均有证据，存在少量说明缺口。",
                }],
            },
            computedScore: {
                schemaVersion: "rolling-skill-computed-score/v2",
                totalScore: 84,
                overallVerdict: "pass",
                outcomeTier: "formal_pass",
                criticalFailures: [],
                diagnosticReasons: [],
                criterionScores: [{
                    id: "R1",
                    status: "scored",
                    rating: 8.4,
                    confidence: 0.9,
                    verificationStatus: "verified",
                    verifiableFields: ["账期", "金额"],
                    crossChecks: ["回答与 Trace 一致"],
                    points: 84,
                    maxPoints: 100,
                    criticalFailureTriggered: false,
                }],
            },
        },
        {
            id: "result-smoke-codebuddy-one",
            runtimeId: "codebuddy:renderer-smoke",
            runtimeConfiguration: {
                runtimeId: "codebuddy:renderer-smoke",
                displayName: "CodeBuddy",
                modelId: "claude-sonnet-4.5",
                effort: "high",
            },
            caseSnapshot: smokeEvaluationCase,
            status: "completed",
            gradingStatus: "completed",
            durationMs: 64_000,
            response: "Smoke CodeBuddy evaluation answer",
            scoreContract: {
                a: {dimensions: [{
                    id: "skill_activation",
                    criterion: "Read and apply the selected Skill.",
                }]},
                b: {criteria: [{
                    id: "H1",
                    criterion: "Use the correct billing workflow.",
                }]},
            },
            judgment: {
                aAssessments: [{
                    dimensionId: "skill_activation",
                    status: "scored",
                    level: 3,
                    evidenceRefs: ["trace:L1"],
                    rationale: "Legacy Skill evidence remains inspectable.",
                }],
                bAssessments: [{
                    criterionId: "H1",
                    status: "scored",
                    rating: 7,
                    confidence: 0.8,
                    verificationStatus: "partially_verified",
                    verifiableFields: ["billing period"],
                    crossChecks: ["response against Trace"],
                    evidenceRefs: ["response", "trace:L2"],
                    rationale: "Legacy workflow evidence remains inspectable.",
                }],
            },
            computedScore: {
                aScore: 28,
                bScore: 38,
                totalScore: null,
                aVerdict: "diagnostic",
                overallVerdict: "diagnostic",
                outcomeTier: "diagnostic",
                diagnosticReasons: ["target_skill_binding_unverified"],
                dimensionScores: [],
                bCriterionScores: [],
            },
        },
        {
            id: "result-smoke-codex-two",
            runtimeId: "codex:renderer-smoke",
            runtimeConfiguration: {
                runtimeId: "codex:renderer-smoke",
                displayName: "Codex",
                modelId: "gpt-5.6-sol",
                effort: "high",
            },
            caseSnapshot: smokeEvaluationCaseTwo,
            status: "completed",
            gradingStatus: "queued",
            durationMs: 61_000,
            response: "Smoke evaluation answer two",
        },
        {
            id: "result-smoke-codebuddy-two",
            runtimeId: "codebuddy:renderer-smoke",
            runtimeConfiguration: {
                runtimeId: "codebuddy:renderer-smoke",
                displayName: "CodeBuddy",
                modelId: "claude-sonnet-4.5",
                effort: "high",
            },
            caseSnapshot: smokeEvaluationCaseTwo,
            status: "completed",
            gradingStatus: "queued",
            durationMs: 59_000,
            response: "Smoke CodeBuddy evaluation answer two",
        },
    ],
}

contextBridge.exposeInMainWorld("rollingSkill", {
    bootstrap: async () => ({
        runtime: {
            status: "ready",
            workspaceRoot: "/tmp/rolling-skill-renderer-smoke",
            runtime: {
                runtimeId: "codex:renderer-smoke",
                providerId: "codex",
                displayName: "Codex",
                version: "smoke",
                executablePath: "/usr/local/bin/codex",
                source: "smoke fixture",
                capabilities: ["thread-archive", "sandbox-policy"],
            },
            availableRuntimes: [{
                runtimeId: "codex:renderer-smoke",
                providerId: "codex",
                displayName: "Codex",
                version: "smoke",
                executablePath: "/usr/local/bin/codex",
                efforts: ["low", "medium", "high", "xhigh"],
                models: ["gpt-5.6-sol"],
            }],
        },
        workspaceRoot: "/tmp/rolling-skill-renderer-smoke",
        datasets: smokeDatasets,
        curationSessions: [smokeCurationSession],
        sourceCurationMarkers: [{
            id: smokeCurationSession.id,
            datasetId: smokeCurationSession.datasetId,
            caseId: null,
            status: smokeCurationSession.status,
            threadId: "thread-a",
            startItemId: "thread-a-user-0",
            endItemId: "thread-a-agent-0",
            itemIds: ["thread-a-user-0", "thread-a-agent-0"],
        }],
        rawCases: smokeRawCases,
        managedSkills: smokeManagedOverview(),
        skillInstallations: {jobs: [], matrix: []},
        settings,
    }),
    listModels: async () => {
        const requestedRuntimeId = currentRuntimeId
        const delay = modelDelayByRuntime.get(requestedRuntimeId) ?? 0
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        const suffix = requestedRuntimeId.split(":").at(-1)
        return {
            data: [{
                id: requestedRuntimeId === "codex:renderer-smoke" ? "gpt-5.6-sol" : `model-${suffix}`,
                displayName: requestedRuntimeId === "codex:renderer-smoke" ? "GPT-5.6-Sol" : `Model ${suffix}`,
                isDefault: true,
                reasoningEfforts: ["low", "medium", "high", "xhigh"],
            }],
        }
    },
    listModelsForRuntime: async () => ({
        data: [{
            id: "gpt-5.6-sol",
            model: "gpt-5.6-sol",
            displayName: "GPT-5.6-Sol",
            isDefault: true,
            reasoningEfforts: ["low", "medium", "high", "xhigh"],
        }],
    }),
    listThreads: async (archived = false) => ({
        data: archived ? [] : Object.values(threads).map(({turns: _turns, ...thread}) => thread),
        nextCursor: null,
    }),
    readThread: async (threadId) => {
        const epoch = ++observationSequence
        const observation = {epoch, threadId, phase: "snapshot", buffer: []}
        threadObservation = observation
        readCount += 1
        if (readCount > 1) await new Promise((resolve) => setTimeout(resolve, 70))
        if (nextReadFailureThreadId === threadId) {
            nextReadFailureThreadId = null
            throw new Error(`smoke read failure for ${threadId}`)
        }
        if (threadObservation === observation) {
            threadObservation.phase = "catch-up"
            threadObservation.buffer = []
        }
        return {thread: threads[threadId], rollingSkillObservationEpoch: epoch}
    },
    drainThreadObservation: async (epoch) => {
        if (!threadObservation || threadObservation.epoch !== epoch) {
            return {matched: false, notifications: [], live: false, reloadRequired: false}
        }
        const notifications = threadObservation.buffer.splice(0)
        if (!notifications.length) threadObservation.phase = "live"
        return {
            matched: true,
            notifications,
            live: threadObservation.phase === "live",
            reloadRequired: false,
        }
    },
    clearThreadObservation: async (epoch = null) => {
        if (threadObservation && (epoch == null || threadObservation.epoch === epoch)) {
            threadObservation = null
        }
        return {cleared: !threadObservation}
    },
    startThread: async () => {
        const id = `thread-raw-${Date.now()}`
        threads[id] = {
            id,
            name: "Raw Case task",
            preview: "Raw Case",
            updatedAt: Date.now(),
            status: "idle",
            turns: [],
        }
        return {thread: threads[id], rollingSkillObservationEpoch: ++observationSequence}
    },
    startTurn: async (threadId, text) => {
        lastRawCaseTurnText = text
        const turn = {
            id: `${threadId}-raw-turn`,
            status: "inProgress",
            items: [{
                id: `${threadId}-raw-user`,
                type: "userMessage",
                content: [{type: "text", text}],
            }],
        }
        threads[threadId].turns.push(turn)
        return {turn}
    },
    listRawCases: async (skillName = null) => smokeRawCases.filter(
        (entry) => !skillName || entry.skill.name.toLowerCase() === skillName.toLowerCase(),
    ),
    addRawCases: async (cases_) => {
        const created = cases_.map((entry, index) => ({
            id: `raw-case-added-${Date.now()}-${index}`,
            ...entry,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }))
        smokeRawCases = [...created, ...smokeRawCases]
        for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
        return {created, duplicates: [], rejected: []}
    },
    updateRawCase: async (id, changes) => {
        smokeRawCases = smokeRawCases.map((entry) =>
            entry.id === id ? {...entry, ...changes, updatedAt: new Date().toISOString()} : entry,
        )
        for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
        return smokeRawCases.find((entry) => entry.id === id)
    },
    deleteRawCase: async (id) => {
        const removed = smokeRawCases.find((entry) => entry.id === id)
        smokeRawCases = smokeRawCases.filter((entry) => entry.id !== id)
        for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
        return removed
    },
    markRawCaseDispatched: async (id) => {
        smokeRawCases = smokeRawCases.filter((entry) => entry.id !== id)
        for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
        return {id}
    },
    onRawCasesChanged: (listener) => {
        rawCasesChangedListeners.add(listener)
        return () => rawCasesChangedListeners.delete(listener)
    },
    listManagedSkills: async () => smokeManagedOverview(),
    listSkillInstallations: async () => ({jobs: [], matrix: []}),
    startSkillInstallations: async () => [],
    cancelSkillInstallation: async () => null,
    inspectSkillInstallation: async () => null,
    sendSkillInstallationMessage: async () => null,
    respondSkillInstallationQuestion: async () => ({accepted: true}),
    rescanManagedSkills: async () => ({...smokeManagedOverview(), failures: []}),
    importManagedSkill: async () => ({cancelled: true}),
    readManagedSkill: async (skillId) => {
        const skill = [smokeManagedSkill, smokeManagedSkillTwo].find((entry) => entry.id === skillId)
        if (!skill) throw new Error("Unknown smoke managed Skill")
        return {
            repository: smokeManagedRepository,
            skill,
            manifest: `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill === smokeManagedSkillTwo ? "Second managed Skill" : "Use the smoke workflow."}\n`,
            snapshot: {digest: `sha256:${(skill === smokeManagedSkillTwo ? "b" : "a").repeat(64)}`},
            versions: smokeManagedVersions.filter((version) => version.skillId === skill.id),
        }
    },
    createManagedSkillCandidate: async ({skillId}) => {
        const candidate = {
            id: "managed-version-created-smoke",
            repositoryId: smokeManagedRepository.id,
            skillId,
            skillRoot: smokeManagedSkill.skillRoot,
            commit: "fedcba9876543210fedcba9876543210fedcba98",
            contentDigest: `sha256:${"c".repeat(64)}`,
            state: "candidate",
            versionLabel: null,
            createdBy: "user",
            createdAt: new Date().toISOString(),
            releasedAt: null,
            deprecatedAt: null,
        }
        smokeManagedVersions = [candidate, ...smokeManagedVersions]
        emitManagedSkillsChanged()
        return candidate
    },
    releaseManagedSkillVersion: async ({versionId, versionLabel}) => {
        smokeManagedVersions = smokeManagedVersions.map((version) =>
            version.id === versionId
                ? {...version, state: "released", versionLabel, releasedAt: new Date().toISOString()}
                : version,
        )
        emitManagedSkillsChanged()
        return smokeManagedVersions.find((version) => version.id === versionId)
    },
    deprecateManagedSkillVersion: async ({versionId}) => {
        smokeManagedVersions = smokeManagedVersions.map((version) =>
            version.id === versionId
                ? {...version, deprecatedAt: new Date().toISOString()}
                : version,
        )
        emitManagedSkillsChanged()
        return smokeManagedVersions.find((version) => version.id === versionId)
    },
    revealManagedSkillRepository: async () => "/tmp/rolling-skill-renderer-smoke/managed-skills",
    onManagedSkillsChanged: (listener) => {
        managedSkillsChangedListeners.add(listener)
        return () => managedSkillsChangedListeners.delete(listener)
    },
    onSkillInstallationsChanged: noOpSubscription,
    onSkillInstallationQuestion: noOpSubscription,
    onSkillInstallationQuestionResolved: noOpSubscription,
    onManagedSkillVersionReleased: noOpSubscription,
    smokeLastRawCaseTurnText: () => lastRawCaseTurnText,
    listSkills: async () => ({
        data: [{
            cwd: "/tmp/rolling-skill-renderer-smoke",
            skills: [{
                name: "billing-cost-management",
                path: "/tmp/rolling-skill-renderer-smoke/billing-cost-management/SKILL.md",
                scope: "user",
                description: "Smoke Skill",
                enabled: true,
            }],
        }],
    }),
    listDatasets: async () => smokeDatasets,
    createDataset: async ({name, skillReference}) => {
        const dataset = {
            id: `dataset-smoke-${smokeDatasets.length + 1}`,
            name,
            caseCount: 0,
            goodcaseCount: 0,
            badcaseCount: 0,
            skillReference,
        }
        smokeDatasets = [...smokeDatasets, dataset]
        return dataset
    },
    bindDatasetSkill: async (datasetId, skillReference) => {
        smokeDatasets = smokeDatasets.map((dataset) =>
            dataset.id === datasetId ? {...dataset, skillReference} : dataset,
        )
        return smokeDatasets.find((dataset) => dataset.id === datasetId)
    },
    listDatasetRubricVersions: async () => [smokeRubricVersion],
    getActiveDatasetRubric: async () => smokeRubricVersion,
    listRubricSessions: async () => [smokeRubricSession],
    getRubricSession: async () => smokeRubricSession,
    createRubricSession: async () => smokeRubricSession,
    sendRubricMessage: async (_sessionId, text) => {
        smokeRubricSession = {
            ...smokeRubricSession,
            conversation: [...smokeRubricSession.conversation, {role: "user", text}],
        }
        return smokeRubricSession
    },
    retryRubricSession: async () => smokeRubricSession,
    publishRubricSession: async () => smokeRubricVersion,
    discardRubricSession: async () => {
        smokeRubricSession = {...smokeRubricSession, status: "cancelled"}
        return smokeRubricSession
    },
    updateRubricModel: async (_sessionId, modelId) => {
        smokeRubricSession = {
            ...smokeRubricSession,
            rubricAgent: {...smokeRubricSession.rubricAgent, modelId},
        }
        return smokeRubricSession
    },
    updateRubricEffort: async (_sessionId, effort) => {
        smokeRubricSession = {
            ...smokeRubricSession,
            rubricAgent: {...smokeRubricSession.rubricAgent, effort},
        }
        return smokeRubricSession
    },
    listCases: async () => smokeEvaluationCases,
    listEvaluationRuns: async () => [smokeEvaluationRun],
    getEvaluationRun: async () => smokeEvaluationRun,
    createCuration: async (input) => {
        lastCurationInput = input
        if (failNextCuration) {
            failNextCuration = false
            await new Promise((resolve) => setTimeout(resolve, 80))
            throw new Error("smoke curation failure")
        }
        return {id: "curation-smoke", status: "queued", episode: {originalQuestion: "Smoke"}}
    },
    createCaseCalibration: async (input) => {
        lastCalibrationInput = input
        const existing = [...smokeCalibrationSessions.values()].find(
            (session) =>
                session.targetCaseId === input.caseId &&
                session.status !== "archived" &&
                session.status !== "cancelled",
        )
        if (existing) return existing
        calibrationCreateOrder.push(input.caseId)
        const sourceCase = smokeEvaluationCases.find((entry) => entry.id === input.caseId)
        const session = curationSession({
            id: input.caseId === "case-smoke"
                ? "curation-calibration-smoke"
                : `curation-calibration-${input.caseId}`,
            operation: "calibration",
            targetCaseId: input.caseId,
            status: "queued",
            baselineCaseSnapshot: {
                caseId: input.caseId,
                caseType: sourceCase.caseType,
                answer: sourceCase.answer,
                curated: sourceCase.curated,
                rubricVersionId: null,
            },
            rubricVersionSnapshot: smokeRubricVersion,
            curator: {
                modelId: null,
                effort: null,
                effectiveModelId: null,
                effectiveEffort: null,
                threadId: null,
                currentTurnId: null,
            },
        })
        smokeCalibrationSessions.set(session.id, session)
        return session
    },
    archiveCuration: async (sessionId) => {
        const session = smokeCalibrationSessions.get(sessionId)
        if (!session) throw new Error(`Unknown smoke calibration: ${sessionId}`)
        calibrationArchiveOrder.push(session.targetCaseId)
        const archived = {...session, status: "archived"}
        smokeCalibrationSessions.set(sessionId, archived)
        smokeEvaluationCases = smokeEvaluationCases.map((entry) =>
            entry.id === session.targetCaseId
                ? {...entry, rubricVersionId: smokeRubricVersion.id, rubricCalibration: {status: "current"}}
                : entry,
        )
        for (const listener of curationChangedListeners) listener(archived)
    },
    getCuration: async (sessionId) => {
        if (sessionId === smokeCurationSession.id) return smokeCurationSession
        const session = smokeCalibrationSessions.get(sessionId)
        if (!session) throw new Error(`Unknown smoke curation: ${sessionId}`)
        return session
    },
    discardCuration: async (sessionId) => {
        if (sessionId === smokeCurationSession.id) {
            smokeCurationSession = {...smokeCurationSession, status: "cancelled"}
            return smokeCurationSession
        }
        const session = smokeCalibrationSessions.get(sessionId)
        if (!session) throw new Error(`Unknown smoke calibration: ${sessionId}`)
        calibrationDiscardOrder.push(session.targetCaseId)
        const cancelled = {...session, status: "cancelled"}
        smokeCalibrationSessions.set(sessionId, cancelled)
        for (const listener of curationChangedListeners) listener(cancelled)
        return cancelled
    },
    updateCurationModel: async (_sessionId, modelId) => {
        smokeCurationSession = {
            ...smokeCurationSession,
            curator: {...smokeCurationSession.curator, modelId},
        }
        return smokeCurationSession
    },
    updateCurationEffort: async (_sessionId, effort) => {
        smokeCurationSession = {
            ...smokeCurationSession,
            curator: {...smokeCurationSession.curator, effort},
        }
        return smokeCurationSession
    },
    onRuntimeState: (listener) => {
        runtimeStateListeners.add(listener)
        return () => runtimeStateListeners.delete(listener)
    },
    onRuntimeNotification: (listener) => {
        notificationListeners.add(listener)
        return () => notificationListeners.delete(listener)
    },
    onRuntimeQuestion: (listener) => {
        runtimeQuestionListeners.add(listener)
        return () => runtimeQuestionListeners.delete(listener)
    },
    onRuntimeQuestionResolved: (listener) => {
        runtimeQuestionResolvedListeners.add(listener)
        return () => runtimeQuestionResolvedListeners.delete(listener)
    },
    respondRuntimeQuestion: async ({requestId, cancelled, answers}) => {
        lastRuntimeQuestionResponse = {requestId, cancelled, answers}
        for (const listener of runtimeQuestionResolvedListeners) {
            listener({requestId, reason: cancelled ? "cancelled" : "answered"})
        }
        return {accepted: true}
    },
    smokeEmitRuntimeQuestion: (request) => {
        for (const listener of runtimeQuestionListeners) listener(request)
    },
    smokeLastRuntimeQuestionResponse: () => lastRuntimeQuestionResponse,
    smokeEmitNotification: (message) => {
        emitRuntimeNotification(message)
    },
    smokeAppendBackgroundAnswer: (threadId, text, deltaCount = 100) => {
        const turnId = `${threadId}-background-turn`
        const itemId = `${threadId}-background-agent`
        const item = {id: itemId, type: "agentMessage", text}
        const turn = {id: turnId, status: "completed", items: [item]}
        threads[threadId].turns.push(turn)
        threads[threadId].updatedAt += 1
        for (let index = 0; index < deltaCount; index += 1) {
            emitRuntimeNotification({
                method: "item/agentMessage/delta",
                params: {threadId, turnId, itemId, delta: "."},
            })
        }
        emitRuntimeNotification({
            method: "item/completed",
            params: {threadId, turnId, item},
        })
        emitRuntimeNotification({
            method: "turn/completed",
            params: {threadId, turn},
        })
    },
    smokeNotificationRoutingMetrics: () => ({
        observedThreadId: threadObservation?.threadId ?? null,
        observationPhase: threadObservation?.phase ?? null,
        deliveredTimelineNotifications,
        blockedTimelineNotifications,
    }),
    smokeFailNextRead: (threadId) => {
        nextReadFailureThreadId = threadId
    },
    smokeFailNextCuration: () => {
        failNextCuration = true
    },
    smokeLastCurationInput: () => lastCurationInput,
    smokeLastCalibrationInput: () => lastCalibrationInput,
    smokeEmitCalibrationReady: (caseId) => {
        const entry = [...smokeCalibrationSessions.entries()].find(
            ([, session]) => session.targetCaseId === caseId && session.status !== "cancelled",
        )
        if (!entry) throw new Error(`No smoke calibration for ${caseId}`)
        const [sessionId, session] = entry
        const ready = {
            ...session,
            status: "needs_review",
            draft: curatedDraft(`Automatically calibrated ${caseId}`),
            revisions: [...(session.revisions ?? []), {createdAt: new Date().toISOString()}],
        }
        smokeCalibrationSessions.set(sessionId, ready)
        for (const listener of curationChangedListeners) listener(ready)
    },
    smokeCalibrationMetrics: () => ({
        created: [...calibrationCreateOrder],
        archived: [...calibrationArchiveOrder],
        discarded: [...calibrationDiscardOrder],
    }),
    smokeResetCalibrationCases: () => {
        smokeEvaluationCases = [smokeEvaluationCase, smokeEvaluationCaseTwo]
        smokeCalibrationSessions.clear()
        calibrationCreateOrder = []
        calibrationArchiveOrder = []
        calibrationDiscardOrder = []
    },
    smokeEmitRuntimeState: (runtimeId, modelDelayMs = 0) => {
        currentRuntimeId = runtimeId
        modelDelayByRuntime.set(runtimeId, modelDelayMs)
        const suffix = runtimeId.split(":").at(-1)
        const runtime = {
            status: "ready",
            workspaceRoot: "/tmp/rolling-skill-renderer-smoke",
            runtime: {
                runtimeId,
                displayName: `Codex ${suffix}`,
                version: "smoke",
                executablePath: "/usr/local/bin/codex",
                source: "smoke fixture",
                capabilities: ["thread-archive", "sandbox-policy"],
            },
            availableRuntimes: [],
        }
        for (const listener of runtimeStateListeners) listener(runtime)
    },
    onCurationChanged: (listener) => {
        curationChangedListeners.add(listener)
        return () => curationChangedListeners.delete(listener)
    },
    smokeEmitCurationChanged: (patch) => {
        smokeCurationSession = {...smokeCurationSession, ...patch}
        for (const listener of curationChangedListeners) listener(smokeCurationSession)
    },
    onCurationActivity: (listener) => {
        curationActivityListeners.add(listener)
        return () => curationActivityListeners.delete(listener)
    },
    smokeEmitCurationActivity: (activity) => {
        for (const listener of curationActivityListeners) listener(activity)
    },
    onRubricChanged: (listener) => {
        rubricChangedListeners.add(listener)
        return () => rubricChangedListeners.delete(listener)
    },
    smokeEmitRubricChanged: (patch) => {
        smokeRubricSession = {
            ...smokeRubricSession,
            ...patch,
            rubricAgent: patch.rubricAgent
                ? {...smokeRubricSession.rubricAgent, ...patch.rubricAgent}
                : smokeRubricSession.rubricAgent,
        }
        for (const listener of rubricChangedListeners) listener(smokeRubricSession)
    },
    onRubricActivity: (listener) => {
        rubricActivityListeners.add(listener)
        return () => rubricActivityListeners.delete(listener)
    },
    smokeEmitRubricActivity: (activity) => {
        for (const listener of rubricActivityListeners) listener(activity)
    },
    onEvaluationChanged: noOpSubscription,
    onWorkspaceChanged: noOpSubscription,
    onNewTask: noOpSubscription,
})
