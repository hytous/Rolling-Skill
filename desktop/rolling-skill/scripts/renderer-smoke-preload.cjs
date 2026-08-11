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
const noOpSubscription = () => () => {}
let readCount = 0
let nextReadFailureThreadId = null
let failNextCuration = false
let lastCurationInput = null
const notificationListeners = new Set()
const runtimeStateListeners = new Set()
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
        datasets: [{id: "dataset-smoke", name: "Smoke Dataset", caseCount: 0}],
        curationSessions: [],
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
    createCuration: async (input) => {
        lastCurationInput = input
        if (failNextCuration) {
            failNextCuration = false
            await new Promise((resolve) => setTimeout(resolve, 80))
            throw new Error("smoke curation failure")
        }
        return {id: "curation-smoke", status: "queued", episode: {originalQuestion: "Smoke"}}
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
    onCurationChanged: noOpSubscription,
    onEvaluationChanged: noOpSubscription,
    onWorkspaceChanged: noOpSubscription,
    onNewTask: noOpSubscription,
})
