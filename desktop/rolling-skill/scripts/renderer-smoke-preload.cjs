const {contextBridge} = require("electron")

const settings = {
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
}

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
            items: [{id: "thread-a-user-0", type: "userMessage"}],
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
}
const noOpSubscription = () => () => {}
let readCount = 0
let nextReadFailureThreadId = null
let failNextCuration = false
let lastCurationInput = null
const notificationListeners = new Set()
const runtimeStateListeners = new Set()
const curationChangedListeners = new Set()
const curationActivityListeners = new Set()
const modelDelayByRuntime = new Map()
let currentRuntimeId = "codex:renderer-smoke"

contextBridge.exposeInMainWorld("rollingSkill", {
    bootstrap: async () => ({
        runtime: {
            status: "ready",
            workspaceRoot: "/tmp/rolling-skill-renderer-smoke",
            runtime: {
                runtimeId: "codex:renderer-smoke",
                displayName: "Codex",
                version: "smoke",
                executablePath: "/usr/local/bin/codex",
                source: "smoke fixture",
                capabilities: ["thread-archive", "sandbox-policy"],
            },
            availableRuntimes: [],
        },
        workspaceRoot: "/tmp/rolling-skill-renderer-smoke",
        datasets: [{id: "dataset-smoke", name: "Smoke Dataset", caseCount: 1}],
        curationSessions: [smokeCurationSession],
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
    listThreads: async (archived = false) => ({
        data: archived ? [] : Object.values(threads).map(({turns: _turns, ...thread}) => thread),
        nextCursor: null,
    }),
    readThread: async (threadId) => {
        readCount += 1
        if (readCount > 1) await new Promise((resolve) => setTimeout(resolve, 70))
        if (nextReadFailureThreadId === threadId) {
            nextReadFailureThreadId = null
            throw new Error(`smoke read failure for ${threadId}`)
        }
        return {thread: threads[threadId]}
    },
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
    listDatasets: async () => [{
        id: "dataset-smoke",
        name: "Smoke Dataset",
        caseCount: 1,
        goodcaseCount: 1,
        badcaseCount: 0,
    }],
    listCases: async () => [smokeEvaluationCase],
    listEvaluationRuns: async () => [],
    createCuration: async (input) => {
        lastCurationInput = input
        if (failNextCuration) {
            failNextCuration = false
            await new Promise((resolve) => setTimeout(resolve, 80))
            throw new Error("smoke curation failure")
        }
        return {id: "curation-smoke", status: "queued", episode: {originalQuestion: "Smoke"}}
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
    smokeEmitNotification: (message) => {
        for (const listener of notificationListeners) listener(message)
    },
    smokeFailNextRead: (threadId) => {
        nextReadFailureThreadId = threadId
    },
    smokeFailNextCuration: () => {
        failNextCuration = true
    },
    smokeLastCurationInput: () => lastCurationInput,
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
    onEvaluationChanged: noOpSubscription,
    onWorkspaceChanged: noOpSubscription,
    onNewTask: noOpSubscription,
})
