const {contextBridge, ipcRenderer} = require("electron")

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
const fakeControlInvocations = []
const fakeControlMutations = new Set([
    "raw_cases.enqueue",
    "raw_cases.update",
    "evaluations.start",
    "evaluations.cancel",
])
let fakeControlMutationSequence = 0
const requiredSmokeControlMethods = new Set([
    "runtimes.list",
    "runtimes.models",
    "raw_cases.list",
    "raw_cases.enqueue",
    "raw_cases.update",
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
])

function assertSmokeControlCoverage() {
    const invoked = new Set(fakeControlInvocations.map((entry) => entry.method))
    const missing = [...requiredSmokeControlMethods].filter((method) => !invoked.has(method))
    if (missing.length) throw new Error(`Smoke UI bypassed fake controlInvoke: ${missing.join(", ")}`)
}

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
const automaticCaptureStatusListeners = new Set()
const managedSkillsChangedListeners = new Set()
const curationChangedListeners = new Set()
const curationActivityListeners = new Set()
const rubricChangedListeners = new Set()
const rubricActivityListeners = new Set()
const modelDelayByRuntime = new Map()
let currentRuntimeId = "codex:renderer-smoke"
const operatorChangedListeners = new Set()
const operatorEventListeners = new Set()
const operatorApprovalListeners = new Set()
const operatorArtifactListeners = new Set()

function copyOperator(value) {
    return JSON.parse(JSON.stringify(value))
}

function emitOperator(listeners, payload) {
    for (const listener of listeners) listener(copyOperator(payload))
}

async function invokeOperator(method, input = {}) {
    const response = await ipcRenderer.invoke("smoke:operator", {method, input})
    if (response.ok) return response.value
    throw response.error
}
const smokeSkillReference = {
    id: "local-skill-renderer-smoke",
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
    source: {kind: "folder", importedAt: "2026-08-20T00:00:00.000Z"},
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
}
const smokeManagedRepositoryTwo = {
    id: "managed-repository-smoke-two",
    displayName: "Billing Analysis Skills",
    defaultBranch: "main",
    source: {kind: "git", importedAt: "2026-08-19T00:00:00.000Z"},
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
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
    warningCount: 0,
    executableFiles: [],
}
const smokeManagedSkillTwo = {
    ...smokeManagedSkill,
    id: "managed-skill-smoke-two",
    repositoryId: smokeManagedRepositoryTwo.id,
    name: "billing-cost-analysis",
    description: "Second managed Skill",
    skillRoot: "skills/analysis",
    manifestPath: "skills/analysis/SKILL.md",
}
let smokeManagedVersions = [{
    id: "managed-version-smoke",
    repositoryId: smokeManagedRepository.id,
    skillId: smokeManagedSkill.id,
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
    repositoryId: smokeManagedRepositoryTwo.id,
    skillId: smokeManagedSkillTwo.id,
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
        repositories: [smokeManagedRepository, smokeManagedRepositoryTwo],
        skills: [smokeManagedSkill, smokeManagedSkillTwo],
        versions: smokeManagedVersions,
    }
}

function smokeSkillInstallationOverview(skillId = smokeManagedSkill.id) {
    if (skillId !== smokeManagedSkill.id) return {jobs: [], matrix: []}
    return {
        jobs: [{
            id: "managed-installation-job-smoke",
            operation: "install",
            runtime: {
                runtimeId: "codex:renderer-smoke",
                providerId: "codex",
                displayName: "Codex",
                version: "smoke",
            },
            request: {
                skillName: smokeManagedSkill.name,
                versionLabel: "v1.0.0",
                source: {
                    skillId: smokeManagedSkill.id,
                    versionId: "managed-version-created-smoke",
                },
            },
            modelId: "gpt-5.6-sol",
            effort: "high",
            permissionMode: "danger-full-access",
            status: "unverified",
            registration: {
                state: "accepted",
                invocationFingerprint: "sha256:smoke",
                acceptedAt: "2026-09-04T01:02:03.000Z",
            },
            parsedResult: {
                destination: "/tmp/runtime/skills/billing-cost-management",
                classificationBefore: "unmanaged",
                verification: "none",
            },
            timeline: [{
                kind: "message",
                role: "assistant",
                content: "Checked the exact Runtime target.",
            }, {
                kind: "activity",
                type: "commandExecution",
                command: `find /tmp/runtime/skills/billing-cost-management -type f -print ${"--long-argument ".repeat(40)}`,
            }],
            error: {
                code: "EXPERIMENT_TARGET_MISMATCH",
                message: "The exact target does not match the expected source digest and has no matching management marker.",
            },
            conversationError: null,
            createdAt: "2026-09-04T01:00:00.000Z",
            updatedAt: "2026-09-04T01:02:03.000Z",
        }],
        matrix: [],
    }
}

const smokeOptimizationDataset = {
    id: "optimization-dataset-smoke",
    name: "Optimization Smoke Dataset",
    caseCount: 2,
    goodcaseCount: 2,
    badcaseCount: 0,
    skillReference: {
        id: smokeManagedSkillTwo.id,
        name: smokeManagedSkillTwo.name,
        repositoryId: smokeManagedSkillTwo.repositoryId,
    },
    activeRubricVersionId: "rubric-version-smoke",
}

let smokeOptimizationRun = null
let smokeOptimizationStage = 0
let smokeOptimizationStartCalls = 0
const smokeOptimizationStartInputs = []
let failNextOptimizationStart = false

function smokeOptimizationBase(config) {
    return {
        id: "optimization-renderer-smoke",
        state: "editing",
        revision: 1,
        currentEpoch: 1,
        snapshotDigest: `sha256:${"d".repeat(64)}`,
        baseline: {
            repositoryId: smokeManagedSkillTwo.repositoryId,
            skillId: smokeManagedSkillTwo.id,
            versionId: "managed-version-released-smoke",
            commit: "89abcdef0123456789abcdef0123456789abcdef",
            contentDigest: `sha256:${"b".repeat(64)}`,
        },
        dataset: {id: smokeOptimizationDataset.id, revision: 7, digest: `sha256:${"e".repeat(64)}`},
        rubric: {id: smokeRubricVersion.id, version: 1, digest: `sha256:${"f".repeat(64)}`},
        operator: config.operator,
        targets: config.targets,
        judge: config.judge,
        activationMode: config.activationMode,
        limits: config.limits,
        optimizationDirection: config.optimizationDirection,
        playbook: {
            id: "rolling-skill-optimization",
            version: 1,
            digest: `sha256:${"a".repeat(64)}`,
        },
        epochs: [{number: 1, status: "editing", candidateArtifactId: null}],
        checkpoint: {paused: false},
        error: null,
    }
}

function advanceSmokeOptimization() {
    if (!smokeOptimizationRun) throw new Error("Optimization smoke Run has not started")
    smokeOptimizationStage += 1
    smokeOptimizationRun.revision += 1
    if (smokeOptimizationStage === 1) {
        smokeOptimizationRun.state = "waiting_approval"
        smokeOptimizationRun.currentEpoch = 2
        smokeOptimizationRun.epochs = [{
            number: 1,
            status: "completed",
            candidateArtifactId: "candidate-artifact-1",
            candidate: {versionId: "candidate-smoke-1", commit: "c".repeat(40), contentDigest: `sha256:${"c".repeat(64)}`},
            installations: [{runtimeId: "codebuddy:renderer-smoke", status: "succeeded", installationJobId: "install-smoke-1", lastVerifiedDigest: `sha256:${"c".repeat(64)}`}],
            analysis: {score: 82, scoreDelta: 8, baselineScoreDelta: 0, passRate: 0.75, regressionCount: 1},
            decision: {action: "continue", rationale: "继续第二轮"},
        }, {
            number: 2,
            status: "completed",
            candidateArtifactId: "candidate-artifact-2",
            candidate: {versionId: "candidate-smoke-2", commit: "d".repeat(40), contentDigest: `sha256:${"d".repeat(64)}`},
            installations: [{runtimeId: "codebuddy:renderer-smoke", status: "succeeded", installationJobId: "install-smoke-2", lastVerifiedDigest: `sha256:${"d".repeat(64)}`}],
            analysis: {score: 94, scoreDelta: 12, baselineScoreDelta: 12, passRate: 1, regressionCount: 0},
            decision: {action: "release-install", rationale: "候选版本达到目标，等待一次最终审批。"},
        }]
        smokeOptimizationRun.checkpoint = {
            telemetry: {elapsedMs: 2_000, turnsUsed: 12, tokens: 4_000, costMicros: 2_000},
        }
    }
    return structuredClone(smokeOptimizationRun)
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
}, smokeOptimizationDataset]
function smokePublicDataset(dataset) {
    return {
        id: dataset.id,
        ...(dataset.name === undefined ? {} : {name: dataset.name}),
        ...(dataset.status === undefined ? {} : {status: dataset.status}),
        ...(dataset.skillReference === undefined
            ? {}
            : {skillReference: dataset.skillReference === null
                ? null
                : {
                    ...(dataset.skillReference.id === undefined
                        ? {}
                        : {id: dataset.skillReference.id}),
                    ...(dataset.skillReference.repositoryId === undefined
                        ? {}
                        : {repositoryId: dataset.skillReference.repositoryId}),
                    name: dataset.skillReference.name,
                }}),
        ...(dataset.activeRubricVersionId === undefined
            ? {}
            : {activeRubricVersionId: dataset.activeRubricVersionId}),
        ...(dataset.caseCount === undefined ? {} : {caseCount: dataset.caseCount}),
        ...(dataset.goodcaseCount === undefined ? {} : {goodcaseCount: dataset.goodcaseCount}),
        ...(dataset.badcaseCount === undefined ? {} : {badcaseCount: dataset.badcaseCount}),
        ...(dataset.createdAt === undefined ? {} : {createdAt: dataset.createdAt}),
    }
}

function smokePublicEvaluationCase(entry) {
    return {
        id: entry.id,
        datasetId: entry.datasetId,
        title: entry.source?.originalQuestion ?? entry.question,
        status: entry.rubricCalibration?.status ?? entry.status,
        label: entry.caseType,
        inputSummary: entry.question,
        outputSummary: entry.curated?.referenceAnswer?.summary ?? entry.answer ?? "",
    }
}

function smokePublicEvaluationResult(result) {
    const score = result.computedScore
    const totalScore = Number.isFinite(score?.totalScore)
        ? score.totalScore
        : Number.isFinite(score?.aScore) && Number.isFinite(score?.bScore)
            ? Math.round((score.aScore + score.bScore + Number.EPSILON) * 10) / 10
            : null
    return {
        id: result.id,
        caseId: result.caseId ?? result.caseSnapshot?.id,
        runtimeId: result.runtimeId ?? result.runtimeConfiguration?.runtimeId,
        title: result.caseSnapshot?.question ?? result.title,
        status: result.status,
        ...(result.gradingStatus ? {gradingStatus: result.gradingStatus} : {}),
        ...(result.durationMs === undefined ? {} : {durationMs: result.durationMs}),
        ...(score ? {computedScore: {
            ...(totalScore === null ? {} : {totalScore}),
            ...(score.outcomeTier ? {outcomeTier: score.outcomeTier} : {}),
            ...(score.overallVerdict ? {overallVerdict: score.overallVerdict} : {}),
        }} : {}),
        ...(result.gradingError ? {reasonSummary: result.gradingError} : {}),
    }
}

function smokePublicEvaluationRun(run, includeResults = false) {
    const results = Array.isArray(run.results) ? run.results : []
    const counts = {queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0}
    for (const result of results) {
        const status = Object.hasOwn(counts, result.status) ? result.status : "failed"
        counts[status] += 1
    }
    return {
        id: run.id,
        datasetId: run.datasetId,
        ...(run.datasetSnapshot ? {datasetSnapshot: {
            id: run.datasetSnapshot.id,
            name: run.datasetSnapshot.name,
        }} : {}),
        selectionMode: run.selectionMode,
        activationMode: run.activationMode,
        status: run.status,
        caseCount: run.caseCount ?? run.caseSnapshots?.length ?? 0,
        runtimeCount: run.runtimeCount ?? run.runtimeConfigurations?.length ?? 0,
        resultCount: results.length,
        progress: {total: results.length, ...counts},
        ...(run.runtimeConfigurations?.length ? {runtimeConfigurations: run.runtimeConfigurations.map(
            ({runtimeId, displayName, modelId = null, effort = null}) => ({
                runtimeId,
                displayName,
                modelId,
                effort,
            }),
        )} : {}),
        ...(includeResults ? {
            results: results.map(smokePublicEvaluationResult),
            resultsTruncated: false,
        } : {}),
        ...(run.completedAt === undefined ? {} : {completedAt: run.completedAt}),
        ...(run.createdAt === undefined ? {} : {createdAt: run.createdAt}),
    }
}
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
const smokeStartedEvaluationRuns = new Map()
let smokeEvaluationRunSequence = 0

function smokeControlRawCase(input = {}) {
    return {
        question: input.question,
        skill: {
            ...(input.skill?.id ? {id: input.skill.id} : {}),
            name: input.skill?.name,
        },
        note: input.note ?? "",
        source: {kind: input.source?.kind ?? "operator"},
    }
}

function smokeControlRawCaseChanges(input = {}) {
    return {
        ...(Object.hasOwn(input, "question") ? {question: input.question} : {}),
        ...(Object.hasOwn(input, "skill") ? {skill: {
            ...(input.skill?.id ? {id: input.skill.id} : {}),
            name: input.skill?.name,
        }} : {}),
        ...(Object.hasOwn(input, "note") ? {note: input.note} : {}),
    }
}

function smokePublicRawCase(entry) {
    return {
        ...entry,
        skill: {
            ...(entry.skill?.id ? {id: entry.skill.id} : {}),
            name: entry.skill?.name,
        },
    }
}

const smokeControlCursorSequences = new Map()
const smokeSkillVersionRevision = "01234567-89ab-4def-8123-456789abcdef"

function smokeBase64Url(value) {
    return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "")
}

function smokeControlCursor(method, sequence) {
    const cursor = smokeBase64Url(
        method === "skill_versions.list"
            ? `v1:${smokeSkillVersionRevision}:${sequence}`
            : String(sequence),
    )
    smokeControlCursorSequences.set(`${method}:${cursor}`, sequence)
    return cursor
}

function smokeControlPage(method, items, params) {
    const sequence = params.cursor === null
        ? 0
        : smokeControlCursorSequences.get(`${method}:${params.cursor}`)
    if (!Number.isSafeInteger(sequence)) throw new Error("Unknown smoke control cursor")
    const pageSize = Math.min(params.limit, 1)
    const end = Math.min(sequence + pageSize, items.length)
    return {
        items: items.slice(sequence, end),
        nextCursor: end < items.length ? smokeControlCursor(method, end) : null,
    }
}

async function fakeControlService(method, params) {
    switch (method) {
        case "runtimes.list":
            return {runtimes: [{
                runtimeId: currentRuntimeId,
                providerId: "codex",
                displayName: "Codex",
                version: "smoke",
            }]}
        case "runtimes.models": {
            const requestedRuntimeId = params.runtimeId ?? currentRuntimeId
            const delay = modelDelayByRuntime.get(requestedRuntimeId) ?? 0
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
            const suffix = requestedRuntimeId.split(":").at(-1)
            return {models: [{
                id: requestedRuntimeId === "codex:renderer-smoke"
                    ? "gpt-5.6-sol"
                    : `model-${suffix}`,
                model: requestedRuntimeId === "codex:renderer-smoke"
                    ? "gpt-5.6-sol"
                    : `model-${suffix}`,
                displayName: requestedRuntimeId === "codex:renderer-smoke"
                    ? "GPT-5.6-Sol"
                    : `Model ${suffix}`,
                isDefault: true,
                reasoningEfforts: ["low", "medium", "high", "xhigh"],
            }]}
        }
        case "raw_cases.list":
            return {
                rawCases: smokeRawCases
                    .filter((entry) =>
                        !params.skillName ||
                        entry.skill.name.toLowerCase() === params.skillName.toLowerCase(),
                    )
                    .map(smokePublicRawCase),
                nextCursor: null,
            }
        case "raw_cases.enqueue": {
            const created = params.cases.map((entry, index) => ({
                id: `raw-case-added-${Date.now()}-${index}`,
                ...entry,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }))
            smokeRawCases = [...created, ...smokeRawCases]
            for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
            return {created: created.map(smokePublicRawCase), duplicates: [], rejected: []}
        }
        case "raw_cases.update":
            smokeRawCases = smokeRawCases.map((entry) =>
                entry.id === params.id
                    ? {...entry, ...params.changes, updatedAt: new Date().toISOString()}
                    : entry,
            )
            for (const listener of rawCasesChangedListeners) listener(smokeRawCases)
            return {
                rawCase: smokePublicRawCase(
                    smokeRawCases.find((entry) => entry.id === params.id),
                ),
            }
        case "datasets.list":
            return {datasets: smokeDatasets.map(smokePublicDataset), nextCursor: null}
        case "datasets.get": {
            const dataset = smokeDatasets.find((entry) => entry.id === params.datasetId)
            return {
                dataset: smokePublicDataset(dataset),
                ...(params.includeCases ? {
                    cases: smokeEvaluationCases.filter(
                        (entry) => entry.datasetId === params.datasetId,
                    ).map(smokePublicEvaluationCase),
                } : {}),
            }
        }
        case "evaluations.list":
            return {
                runs: !params.datasetId || params.datasetId === smokeEvaluationRun.datasetId
                    ? [...smokeStartedEvaluationRuns.values()].reverse()
                        .concat(smokeEvaluationRun)
                        .map((run) => smokePublicEvaluationRun(run, false))
                    : [],
                nextCursor: null,
            }
        case "evaluations.get":
            return {run: smokePublicEvaluationRun(
                smokeStartedEvaluationRuns.get(params.runId) ?? smokeEvaluationRun,
                true,
            )}
        case "evaluations.start": {
            smokeEvaluationRunSequence += 1
            const run = {
                ...smokeEvaluationRun,
                id: `run-smoke-started-${smokeEvaluationRunSequence}`,
                selectionMode: params.selectionMode,
                activationMode: params.activationMode,
                runtimeConfigurations: params.runtimeConfigurations,
                status: "running",
                createdAt: new Date().toISOString(),
                completedAt: null,
                caseSnapshots: params.selectionMode === "selected"
                    ? smokeEvaluationCases.filter((entry) => params.caseIds.includes(entry.id))
                    : smokeEvaluationCases,
                results: [],
            }
            smokeStartedEvaluationRuns.set(run.id, run)
            return {run: smokePublicEvaluationRun(run, true)}
        }
        case "evaluations.cancel": {
            const current = smokeStartedEvaluationRuns.get(params.runId)
            if (!current) throw new Error("Unknown smoke active evaluation")
            const run = {
                ...current,
                status: "cancelled",
                completedAt: new Date().toISOString(),
            }
            smokeStartedEvaluationRuns.set(run.id, run)
            return {run: smokePublicEvaluationRun(run, true)}
        }
        case "skill_repositories.list": {
            const page = smokeControlPage(
                method,
                [smokeManagedRepository, smokeManagedRepositoryTwo],
                params,
            )
            return {repositories: page.items, nextCursor: page.nextCursor}
        }
        case "skills.list": {
            const page = smokeControlPage(
                method,
                [smokeManagedSkill, smokeManagedSkillTwo],
                params,
            )
            return {
                repositories: [smokeManagedRepository, smokeManagedRepositoryTwo]
                    .filter((repository) => page.items.some(
                        (skill) => skill.repositoryId === repository.id,
                    )),
                skills: page.items,
                nextCursor: page.nextCursor,
            }
        }
        case "skill_versions.list": {
            const versions = params.skillId
                ? smokeManagedVersions.filter((version) => version.skillId === params.skillId)
                : smokeManagedVersions
            const page = smokeControlPage(method, versions, params)
            return {
                versions: page.items,
                nextCursor: page.nextCursor,
            }
        }
        case "skills.get": {
            const skill = [smokeManagedSkill, smokeManagedSkillTwo]
                .find((entry) => entry.id === params.skillId)
            if (!skill) throw new Error("Unknown smoke managed Skill")
            return {skill: {
                repository: skill.repositoryId === smokeManagedRepositoryTwo.id
                    ? smokeManagedRepositoryTwo
                    : smokeManagedRepository,
                skill,
                manifest: `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill === smokeManagedSkillTwo ? "Second managed Skill" : "Use the smoke workflow."}\n`,
                snapshot: {
                    digest: `sha256:${(skill === smokeManagedSkillTwo ? "b" : "a").repeat(64)}`,
                },
            }}
        }
        default:
            throw new Error(`Unknown fake control method: ${method}`)
    }
}

async function fakeControlInvoke(method, params = {}) {
    const input = JSON.parse(JSON.stringify(params))
    if (method === "runtimes.models" && !input.runtimeId) input.runtimeId = currentRuntimeId
    if (fakeControlMutations.has(method)) {
        fakeControlMutationSequence += 1
        input.idempotencyKey = `renderer-smoke-${fakeControlMutationSequence}`
    }
    const parsedInput = await ipcRenderer.invoke("smoke:parse-control-input", {
        method,
        value: input,
    })
    const invocation = {method, params: parsedInput, nextCursor: null}
    fakeControlInvocations.push(invocation)
    const output = await fakeControlService(method, parsedInput)
    const parsedOutput = await ipcRenderer.invoke("smoke:parse-control-output", {
        method,
        value: output,
    })
    invocation.nextCursor = parsedOutput.nextCursor ?? null
    return parsedOutput
}

const FAKE_CONTROL_PAGE_LIMIT = 100
const FAKE_CONTROL_MAX_PAGES = 1_000
const FAKE_CONTROL_MAX_ITEMS = 100_000

async function fakeControlPage(method, params, key) {
    const items = []
    const seenCursors = new Set()
    let cursor = null
    for (let pageNumber = 0; pageNumber < FAKE_CONTROL_MAX_PAGES; pageNumber += 1) {
        const page = await fakeControlInvoke(method, {
            ...params,
            cursor,
            limit: FAKE_CONTROL_PAGE_LIMIT,
        })
        const pageItems = Array.isArray(page?.[key]) ? page[key] : []
        if (items.length + pageItems.length > FAKE_CONTROL_MAX_ITEMS) {
            throw new Error(`Fake control pagination exceeded ${FAKE_CONTROL_MAX_ITEMS} items`)
        }
        items.push(...pageItems)
        const nextCursor = page?.nextCursor ?? null
        if (nextCursor === null) return items
        const signature = JSON.stringify(nextCursor)
        if (seenCursors.has(signature)) {
            throw new Error("Fake control pagination repeated a cursor")
        }
        seenCursors.add(signature)
        cursor = nextCursor
    }
    throw new Error(`Fake control pagination exceeded ${FAKE_CONTROL_MAX_PAGES} pages`)
}

async function fakeManagedSkillOverview() {
    const [repositories, skills, versions] = await Promise.all([
        fakeControlPage("skill_repositories.list", {}, "repositories"),
        fakeControlPage("skills.list", {}, "skills"),
        fakeControlPage("skill_versions.list", {}, "versions"),
    ])
    return {repositories, skills, versions}
}

async function fakeReadManagedSkill(skillId) {
    const [detail, versions] = await Promise.all([
        fakeControlInvoke("skills.get", {skillId}),
        fakeControlPage("skill_versions.list", {skillId}, "versions"),
    ])
    return {...detail.skill, versions}
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
                capabilities: ["thread-archive", "sandbox-policy", "token-usage", "cost-usage"],
            },
            availableRuntimes: [{
                runtimeId: "codex:renderer-smoke",
                providerId: "codex",
                displayName: "Codex",
                version: "smoke",
                executablePath: "/usr/local/bin/codex",
                efforts: ["low", "medium", "high", "xhigh"],
                models: ["gpt-5.6-sol"],
                capabilities: ["token-usage", "cost-usage"],
            }, {
                runtimeId: "codebuddy:renderer-smoke",
                providerId: "codebuddy",
                displayName: "CodeBuddy",
                version: "smoke",
                efforts: ["low", "medium", "high"],
                models: ["model-renderer-smoke"],
                capabilities: ["token-usage", "cost-usage"],
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
        skillInstallations: smokeSkillInstallationOverview(),
        settings,
    }),
    bootstrapOperator: () => invokeOperator("bootstrap"),
    readOperatorSummaryPage: (cursor = null, limit = 100) =>
        invokeOperator("read-summary", {cursor, limit}),
    createOperatorSession: (input) => invokeOperator("create-session", input),
    getOperatorSession: (sessionId) => invokeOperator("get-session", {sessionId}),
    sendOperatorMessage: async () => ({queued: true}),
    pauseOperatorJob: (jobId) => invokeOperator("pause", {jobId}),
    resumeOperatorJob: (jobId) => invokeOperator("resume", {jobId}),
    stopOperatorJob: (jobId) => invokeOperator("stop", {jobId}),
    dismissOperatorJobRecords: (jobIds) => invokeOperator("dismiss-records", {jobIds}),
    startOptimization: async (input) => {
        smokeOptimizationStartCalls += 1
        smokeOptimizationStartInputs.push(structuredClone(input))
        if (failNextOptimizationStart) {
            failNextOptimizationStart = false
            throw new Error("Optimization Dataset requires a published Rubric")
        }
        smokeOptimizationStage = 0
        smokeOptimizationRun = smokeOptimizationBase(input)
        const created = await invokeOperator("create-optimization", {runId: smokeOptimizationRun.id})
        emitOperator(operatorChangedListeners, created.changed)
        return structuredClone(smokeOptimizationRun)
    },
    getOptimizationRun: async (runId) => {
        if (runId !== smokeOptimizationRun?.id) throw new Error("Unknown Optimization smoke Run")
        return structuredClone(smokeOptimizationRun)
    },
    pauseOptimization: async (runId) => {
        if (runId !== smokeOptimizationRun?.id) throw new Error("Unknown Optimization smoke Run")
        smokeOptimizationRun = {...smokeOptimizationRun, state: "needs_recovery", revision: smokeOptimizationRun.revision + 1, checkpoint: {...smokeOptimizationRun.checkpoint, paused: true, pauseReason: "user_pause"}}
        return structuredClone(smokeOptimizationRun)
    },
    resumeOptimization: async (runId) => {
        if (runId !== smokeOptimizationRun?.id) throw new Error("Unknown Optimization smoke Run")
        smokeOptimizationRun = {...smokeOptimizationRun, state: "editing", revision: smokeOptimizationRun.revision + 1, checkpoint: {...smokeOptimizationRun.checkpoint, paused: false}}
        return structuredClone(smokeOptimizationRun)
    },
    stopOptimization: async (runId) => {
        if (runId !== smokeOptimizationRun?.id) throw new Error("Unknown Optimization smoke Run")
        smokeOptimizationRun = {
            ...smokeOptimizationRun,
            state: "needs_recovery",
            revision: smokeOptimizationRun.revision + 1,
            epochs: smokeOptimizationRun.epochs.map((epoch) => epoch.number === 2 ? {
                ...epoch,
                status: "failed",
                analysis: {score: 78, scoreDelta: -4, passRate: 0.5, regressionCount: 3},
            } : epoch),
            checkpoint: {
                ...smokeOptimizationRun.checkpoint,
                stopReason: "user_stop_restore_failed",
                recoveryTargets: [{
                    runtimeId: "codebuddy:renderer-smoke",
                    status: "needs_recovery",
                    installationJobId: "restore-smoke-2",
                    lastVerifiedDigest: `sha256:${"d".repeat(64)}`,
                    lastVerifiedMarker: {
                        runId,
                        epoch: 2,
                        versionId: "candidate-smoke-2",
                        contentDigest: `sha256:${"d".repeat(64)}`,
                    },
                }],
            },
        }
        return structuredClone(smokeOptimizationRun)
    },
    getOptimizationReport: async (runId) => ({
        artifactId: `report-${runId}`,
        digest: `sha256:${"9".repeat(64)}`,
        mediaType: "text/markdown; charset=utf-8",
    }),
    resolveOperatorApproval: async (approvalId, decision) => {
        const result = await invokeOperator("resolve-approval", {approvalId, decision})
        if (result.changed) emitOperator(operatorChangedListeners, result.changed)
        if (approvalId === smokeOptimizationRun?.checkpoint?.finalApprovalId) {
            smokeOptimizationRun = decision === "approve" ? {
                ...smokeOptimizationRun,
                state: "succeeded",
                revision: smokeOptimizationRun.revision + 1,
                epochs: smokeOptimizationRun.epochs.map((epoch) => epoch.number === smokeOptimizationRun.currentEpoch ? {
                    ...epoch,
                    status: "succeeded",
                } : epoch),
                checkpoint: {
                    ...smokeOptimizationRun.checkpoint,
                    releasePhase: "released-install",
                    releasedVersionId: "managed-version-improved-smoke",
                    releasedInstallArtifactId: "released-install-smoke",
                },
            } : {
                ...smokeOptimizationRun,
                state: "failed",
                revision: smokeOptimizationRun.revision + 1,
                error: {
                    code: "OPTIMIZATION_FINAL_APPROVAL_REJECTED",
                    message: "Final Optimization approval was rejected",
                },
            }
        }
        return result
    },
    listOperatorArtifacts: (jobId, cursor = null, limit = 100) =>
        invokeOperator("list-artifacts", {jobId, cursor, limit}),
    onOperatorChanged: (listener) => {
        operatorChangedListeners.add(listener)
        return () => operatorChangedListeners.delete(listener)
    },
    onOperatorEvent: (listener) => {
        operatorEventListeners.add(listener)
        return () => operatorEventListeners.delete(listener)
    },
    onOperatorApproval: (listener) => {
        operatorApprovalListeners.add(listener)
        return () => operatorApprovalListeners.delete(listener)
    },
    onOperatorArtifact: (listener) => {
        operatorArtifactListeners.add(listener)
        return () => operatorArtifactListeners.delete(listener)
    },
    onAutomaticCaptureStatus: (listener) => {
        automaticCaptureStatusListeners.add(listener)
        return () => automaticCaptureStatusListeners.delete(listener)
    },
    smokeEmitHiddenOperatorDelta: async () => {
        emitOperator(operatorEventListeners, await invokeOperator("emit-hidden"))
    },
    smokeAdvanceOptimization: async () => {
        advanceSmokeOptimization()
        const created = await invokeOperator("create-optimization-approval", {runId: smokeOptimizationRun.id})
        smokeOptimizationRun.checkpoint.finalApprovalId = created.approval.id
        emitOperator(operatorChangedListeners, created.changed)
        return structuredClone(smokeOptimizationRun)
    },
    smokeFailNextOptimizationStart: () => {
        failNextOptimizationStart = true
    },
    smokeEmitOperatorGap: async () => {
        emitOperator(operatorChangedListeners, await invokeOperator("emit-gap"))
    },
    smokeRestartOperatorStore: async () => {
        emitOperator(operatorChangedListeners, await invokeOperator("restart"))
    },
    smokePopulateOperatorPagingRecords: async () => {
        emitOperator(operatorChangedListeners, await invokeOperator("populate-pages"))
    },
    smokeOperatorMetrics: async () => ({
        ...await invokeOperator("metrics"),
        optimizationStartCalls: smokeOptimizationStartCalls,
        optimizationStartInputs: structuredClone(smokeOptimizationStartInputs),
        subscriptions: {
            changed: operatorChangedListeners.size,
            event: operatorEventListeners.size,
            approval: operatorApprovalListeners.size,
            artifact: operatorArtifactListeners.size,
        },
    }),
    listRuntimes: async () => (await fakeControlInvoke("runtimes.list")).runtimes,
    listModels: async () => ({
        data: (await fakeControlInvoke("runtimes.models")).models,
        nextCursor: null,
    }),
    listModelsForRuntime: async (runtimeId) => ({
        data: (await fakeControlInvoke("runtimes.models", {runtimeId})).models,
        nextCursor: null,
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
    listRawCases: async (skillName = null) =>
        fakeControlPage("raw_cases.list", {skillName}, "rawCases"),
    addRawCases: async (cases_) => fakeControlInvoke("raw_cases.enqueue", {
        cases: cases_.map(smokeControlRawCase),
    }),
    updateRawCase: async (id, changes) => (
        await fakeControlInvoke("raw_cases.update", {
            id,
            changes: smokeControlRawCaseChanges(changes),
        })
    ).rawCase,
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
    listManagedSkills: fakeManagedSkillOverview,
    listSkillInstallations: async (skillId) => smokeSkillInstallationOverview(skillId),
    startSkillInstallations: async () => [],
    cancelSkillInstallation: async () => null,
    inspectSkillInstallation: async () => null,
    respondSkillInstallationQuestion: async () => ({accepted: true}),
    rescanManagedSkills: async () => ({...smokeManagedOverview(), failures: []}),
    importManagedSkill: async () => ({cancelled: true}),
    readManagedSkill: fakeReadManagedSkill,
    createManagedSkillCandidate: async ({skillId}) => {
        const candidate = {
            id: "managed-version-created-smoke",
            repositoryId: smokeManagedRepository.id,
            skillId,
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
    smokeLastRawCaseTurnText: () => {
        assertSmokeControlCoverage()
        return lastRawCaseTurnText
    },
    smokeControlInvocations: () => JSON.parse(JSON.stringify(fakeControlInvocations)),
    listSkills: async () => ({
        data: [{
            cwd: "/tmp/rolling-skill-renderer-smoke",
            skills: [{
                id: smokeSkillReference.id,
                name: "billing-cost-management",
                path: "/tmp/rolling-skill-renderer-smoke/billing-cost-management/SKILL.md",
                scope: "user",
                description: "Smoke Skill",
                enabled: true,
            }],
        }],
    }),
    listDatasets: async () => fakeControlPage("datasets.list", {}, "datasets"),
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
    listCases: async (datasetId) => (
        await fakeControlInvoke("datasets.get", {datasetId, includeCases: true})
    ).cases ?? [],
    listEvaluationRuns: async (datasetId = null) =>
        fakeControlPage("evaluations.list", {datasetId}, "runs"),
    getEvaluationRun: async (runId) => (
        await fakeControlInvoke("evaluations.get", {runId})
    ).run,
    startEvaluationRun: async (input) => (
        await fakeControlInvoke("evaluations.start", input)
    ).run,
    cancelEvaluationRun: async (runId) => (
        await fakeControlInvoke("evaluations.cancel", {runId})
    ).run,
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
