const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CaseRefreshManager,
    buildCaseRefreshPrompt,
} = require("../src/case-refresh-manager.cjs")

function skillReference() {
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: "billing-cost-management",
        path: "/skills/billing-cost-management/SKILL.md",
        scope: "user",
        description: "Billing queries",
        runtimeId: "codex:current",
        confirmedAt: "2026-08-26T00:00:00.000Z",
    }
}

function savedCase() {
    return {
        id: "case-1",
        datasetId: "dataset-1",
        caseType: "goodcase",
        question: "原始问题  \n保持不变",
        answer: "历史答案 100 CNY",
        curated: {referenceAnswer: {summary: "历史流程"}},
        updatedAt: "2026-08-25T00:00:00.000Z",
    }
}

function fixture(overrides = {}) {
    const entry = savedCase()
    const dataset = {id: "dataset-1", skillReference: skillReference()}
    const runtimeInputs = []
    const curationInputs = []
    const archivedThreads = []
    let released = 0
    const store = {
        getDataset: (id) => {
            assert.equal(id, dataset.id)
            return dataset
        },
        listCases: (id) => {
            assert.equal(id, dataset.id)
            return [entry]
        },
        listCurationSessions: () => [],
        reserveDataset: () => () => { released += 1 },
        read: () => ({
            settings: {
                taskProfile: {modelId: "gpt-task", effort: "high"},
                curatorProfile: {modelId: "gpt-curator", effort: "xhigh"},
            },
        }),
        ...overrides.store,
    }
    const runtime = {
        listSkills: async () => ({
            data: [{
                cwd: "/workspace",
                skills: [{
                    name: dataset.skillReference.name,
                    path: dataset.skillReference.path,
                    enabled: true,
                }],
            }],
        }),
        runEvaluationCase: async (input) => {
            runtimeInputs.push(input)
            input.onThreadStarted?.("refresh-thread")
            return {
                threadId: "refresh-thread",
                turnId: "refresh-turn",
                traceReference: "trace://refresh.jsonl#L1-L8",
            }
        },
        readThread: async (threadId) => {
            assert.equal(threadId, "refresh-thread")
            return {
                thread: {
                    id: threadId,
                    cwd: "/workspace",
                    modelProvider: "openai",
                    turns: [{
                        id: "refresh-turn",
                        items: [
                            {
                                id: "refresh-user",
                                type: "userMessage",
                                content: [{type: "text", text: runtimeInputs[0].question}],
                            },
                            {
                                id: "refresh-tool",
                                type: "mcpToolCall",
                                server: "billing",
                                tool: "query_cost",
                                status: "completed",
                            },
                            {id: "refresh-answer", type: "agentMessage", text: "当前答案 120 CNY"},
                        ],
                    }],
                },
            }
        },
        archiveThread: async (threadId) => archivedThreads.push(threadId),
        ...overrides.runtime,
    }
    const curationManager = {
        createRefreshSession: async (input) => {
            curationInputs.push(input)
            return {id: "curation-refresh", operation: "refresh", ...input}
        },
        ...overrides.curationManager,
    }
    const manager = new CaseRefreshManager({
        store,
        curationManager,
        getRuntime: async () => runtime,
        getRuntimeDescriptor: () => ({
            runtimeId: "codex:current",
            providerId: "openai",
            workspaceRoot: "/workspace",
        }),
        getCuratorRuntimeDescriptor: () => ({runtimeId: "codex:curator", providerId: "openai"}),
    })
    return {
        manager,
        runtimeInputs,
        curationInputs,
        archivedThreads,
        released: () => released,
    }
}

describe("Case refresh manager", () => {
    it("replays the immutable question with the current Skill and creates a refresh Draft", async () => {
        const test = fixture()

        const session = await test.manager.createSession({
            datasetId: "dataset-1",
            caseId: "case-1",
        })

        assert.equal(session.operation, "refresh")
        assert.equal(test.runtimeInputs.length, 1)
        assert.equal(test.runtimeInputs[0].activationMode, "explicit")
        assert.equal(test.runtimeInputs[0].skillReference.name, "billing-cost-management")
        assert.equal(test.runtimeInputs[0].modelId, "gpt-task")
        assert.equal(test.runtimeInputs[0].effort, "high")
        assert.match(test.runtimeInputs[0].question, /do not copy historical values/iu)
        assert.match(test.runtimeInputs[0].question, /protected external writes/iu)
        assert.match(test.runtimeInputs[0].question, /原始问题  \n保持不变/u)
        assert.equal(test.curationInputs.length, 1)
        assert.equal(test.curationInputs[0].episode.originalQuestion, "原始问题  \n保持不变")
        assert.equal(test.curationInputs[0].episode.source.threadId, "refresh-thread")
        assert.equal(test.curationInputs[0].episode.items[0].text, test.runtimeInputs[0].question)
        assert.equal(test.curationInputs[0].modelId, "gpt-curator")
        assert.equal(test.curationInputs[0].runtimeId, "codex:curator")
        assert.equal(test.curationInputs[0].effort, "xhigh")
        assert.deepEqual([...test.manager.hiddenThreadIds()], ["refresh-thread"])
        assert.deepEqual(test.archivedThreads, ["refresh-thread"])
        assert.equal(test.released(), 1)
    })

    it("fails before replay when the current Runtime no longer exposes the bound Skill", async () => {
        const test = fixture({
            runtime: {listSkills: async () => ({data: []})},
        })

        await assert.rejects(
            test.manager.createSession({datasetId: "dataset-1", caseId: "case-1"}),
            /current Runtime.*Skill|Skill.*unavailable/i,
        )
        assert.equal(test.runtimeInputs.length, 0)
        assert.equal(test.curationInputs.length, 0)
        assert.equal(test.released(), 1)
    })

    it("rejects duplicate active refresh before starting another replay", async () => {
        const test = fixture({
            store: {
                listCurationSessions: () => [{
                    operation: "refresh",
                    targetCaseId: "case-1",
                    status: "running",
                }],
            },
        })

        await assert.rejects(
            test.manager.createSession({datasetId: "dataset-1", caseId: "case-1"}),
            /already.*progress/i,
        )
        assert.equal(test.runtimeInputs.length, 0)
    })

    it("does not create a Curator Draft when replay fails", async () => {
        const test = fixture({
            runtime: {
                runEvaluationCase: async (input) => {
                    input.onThreadStarted?.("failed-refresh-thread")
                    throw new Error("replay failed")
                },
            },
        })

        await assert.rejects(
            test.manager.createSession({datasetId: "dataset-1", caseId: "case-1"}),
            /replay failed/i,
        )
        assert.equal(test.curationInputs.length, 0)
        assert.deepEqual([...test.manager.hiddenThreadIds()], ["failed-refresh-thread"])
        assert.equal(test.released(), 1)
    })

    it("labels saved values as historical guidance in its replay prompt", () => {
        const prompt = buildCaseRefreshPrompt(savedCase())

        assert.match(prompt, /immutable evaluation question/iu)
        assert.match(prompt, /historical Case/iu)
        assert.match(prompt, /do not copy historical values/iu)
        assert.match(prompt, /历史答案 100 CNY/u)
    })
})
