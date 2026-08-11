const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, beforeEach, describe, it} = require("node:test")

const {CurationManager} = require("../src/curation-manager.cjs")
const {buildEpisodeSnapshot} = require("../src/episode-curation.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")

function validDraft(summary = "Use the verified billing result.") {
    return {
        schemaVersion: "rolling-skill-curated-case/v1",
        referenceAnswer: {
            summary,
            requiredFacts: ["The result must be tied to July."],
            requiredSteps: ["Query the billing source and verify the returned month."],
            requiredOutputFormat: ["State the amount and currency."],
            evidence: [{claim: "July is the requested period.", sourceItemIds: ["user-1"]}],
        },
        grading: {
            hardRequirements: [
                {
                    id: "H1",
                    criterion: "Uses July billing data",
                    passCondition: "The answer explicitly identifies July as the billing period.",
                    evidenceBasis: "The verbatim source question asks for July.",
                },
            ],
            softCriteria: [{id: "S1", criterion: "Concise", weight: 1}],
            automaticFailures: ["Invents an unverified amount"],
        },
        badCaseAnalysis: null,
    }
}

function sourceThread() {
    return {
        id: "source-thread",
        modelProvider: "openai",
        turns: [
            {
                id: "turn-1",
                status: "completed",
                items: [
                    {
                        id: "user-1",
                        type: "userMessage",
                        content: [{type: "text", text: "查一下7月份账单，各业务混元3多少成本？"}],
                    },
                    {
                        id: "cmd-1",
                        type: "commandExecution",
                        command: "bash -lc 'billing-cli cost query --month 7'",
                        status: "completed",
                    },
                    {id: "answer-1", type: "agentMessage", text: "原始回答"},
                ],
            },
        ],
    }
}

async function completeInitialDraft(manager, store, session) {
    const turnId = store.getCurationSession(session.id).curator.currentTurnId
    await manager.handleNotification({
        method: "turn/completed",
        params: {
            threadId: "curator-1",
            turn: {
                id: turnId,
                status: "completed",
                items: [
                    {
                        id: "curator-answer-1",
                        type: "agentMessage",
                        text: `\`\`\`json\n${JSON.stringify(validDraft())}\n\`\`\``,
                    },
                ],
            },
        },
    })
}

class FakeRuntime {
    constructor() {
        this.startedThreads = []
        this.startedTurns = []
        this.resumedThreads = []
        this.archivedThreads = []
        this.interruptedTurns = []
    }

    async readThread(threadId) {
        assert.equal(threadId, "source-thread")
        return {thread: sourceThread()}
    }

    async listSkills(options) {
        assert.deepEqual(options, {forceReload: true})
        return {
            data: [
                {
                    cwd: "/workspace",
                    skills: [
                        {
                            name: "billing-cost-management",
                            path: "/runtime/skills/billing-cost-management/SKILL.md",
                            scope: "user",
                            description: "Billing cost queries and analysis",
                            enabled: true,
                        },
                    ],
                },
            ],
        }
    }

    async startThread(options) {
        this.startedThreads.push(options)
        return {
            thread: {
                id: `curator-${this.startedThreads.length}`,
                modelProvider: "openai",
                model: options.model ?? "runtime-default",
            },
        }
    }

    async resumeThread(threadId, options) {
        this.resumedThreads.push({threadId, options})
        return {thread: {id: threadId}}
    }

    async startTurn(threadId, text) {
        const turn = {id: `curator-turn-${this.startedTurns.length + 1}`, items: []}
        this.startedTurns.push({threadId, text, turn})
        return {turn}
    }

    async archiveThread(threadId) {
        this.archivedThreads.push(threadId)
    }

    async interruptTurn(threadId, turnId) {
        this.interruptedTurns.push({threadId, turnId})
    }
}

describe("curation manager", () => {
    let directory
    let store
    let runtime
    let changed
    let manager

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "rolling-skill-curation-manager-"))
        store = new LocalEvaluationStore(join(directory, "store.json"))
        runtime = new FakeRuntime()
        changed = []
        manager = new CurationManager({
            store,
            getRuntime: async () => runtime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            onChanged: (session) => changed.push(session),
            schedule: (task) => task(),
        })
    })

    afterEach(() => rmSync(directory, {recursive: true, force: true}))

    it("freezes an exact source episode and starts a read-only Curator thread", async () => {
        const datasetId = store.listDatasets()[0].id
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            startItemId: "user-1",
            endItemId: "answer-1",
            traceReference: "trace.ndjson#42",
            modelId: "gpt-5.6-sol",
            skillPath: "/runtime/skills/billing-cost-management/SKILL.md",
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        assert.equal(session.episode.originalQuestion, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(persisted.status, "running")
        assert.equal(persisted.curator.threadId, "curator-1")
        assert.equal(persisted.curator.modelId, "gpt-5.6-sol")
        assert.equal(persisted.skillReference.name, "billing-cost-management")
        assert.equal(persisted.skillReference.runtimeId, "codex-alpha")
        assert.deepEqual(runtime.startedThreads[0], {
            sandbox: "read-only",
            approvalPolicy: "never",
            ephemeral: false,
            threadSource: "subagent",
            model: "gpt-5.6-sol",
        })
        assert.deepEqual(runtime.startedTurns[0].text[0], {
            type: "skill",
            name: "billing-cost-management",
            path: persisted.skillReference.path,
        })
        const initialPrompt = runtime.startedTurns[0].text[1].text
        assert.match(initialPrompt, /must remain\s+verbatim/i)
        assert.match(initialPrompt, /billing-cli cost query/)
        assert.match(initialPrompt, /billing-cost-management/)
        assert.match(initialPrompt, /currently installed Skill/i)
        assert.doesNotMatch(
            initialPrompt,
            /\/runtime\/skills\/billing-cost-management\/SKILL\.md/,
        )
        assert.equal(changed.at(-1).status, "running")
    })

    it("forwards stable message locators when live ids differ from thread/read ids", async () => {
        runtime.readThread = async (threadId) => {
            assert.equal(threadId, "source-thread")
            const thread = sourceThread()
            thread.turns[0].items[0].id = "item-12"
            thread.turns[0].items.at(-1).id = "item-16"
            return {thread}
        }
        const datasetId = store.listDatasets()[0].id

        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            startItemId: "live-user-id",
            startTurnId: "turn-1",
            startMessageOrdinal: 0,
            endItemId: "live-assistant-id",
            endTurnId: "turn-1",
            endMessageOrdinal: 0,
        })

        assert.equal(session.episode.source.startItemId, "item-12")
        assert.equal(session.episode.source.endItemId, "item-16")
    })

    it("reserves the target Dataset while source evidence is still loading", async () => {
        const datasetId = store.listDatasets()[0].id
        const originalReadThread = runtime.readThread.bind(runtime)
        let releaseRead
        runtime.readThread = (...args) =>
            new Promise((resolve) => {
                releaseRead = async () => resolve(await originalReadThread(...args))
            })

        const creating = manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            startItemId: "user-1",
            endItemId: "answer-1",
        })
        await new Promise((resolve) => setImmediate(resolve))

        assert.throws(() => store.deleteDataset(datasetId), /unfinished.*draft|capture in progress/i)
        await releaseRead()
        const session = await creating
        await manager.waitForIdle(session.id)
        store.cancelCurationSession(session.id)
        assert.doesNotThrow(() => store.deleteDataset(datasetId))
    })

    it("keeps immutable source wording while curating an edited dataset question", async () => {
        const datasetId = store.listDatasets()[0].id
        const datasetQuestion = "请查询七月各业务的混元 3 成本，并按业务列出。"
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            startItemId: "user-1",
            endItemId: "answer-1",
            datasetQuestion,
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        assert.equal(persisted.episode.originalQuestion, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(persisted.datasetQuestion, datasetQuestion)
        assert.match(runtime.startedTurns[0].text, new RegExp(datasetQuestion))
        assert.match(runtime.startedTurns[0].text, /查一下7月份账单，各业务混元3多少成本？/)

        await completeInitialDraft(manager, store, persisted)
        const saved = await manager.archive(session.id)
        assert.equal(saved.question, datasetQuestion)
        assert.equal(saved.source.originalQuestion, persisted.episode.originalQuestion)
    })

    it("rejects a Skill that the current runtime no longer reports as enabled", async () => {
        runtime.listSkills = async () => ({
            data: [
                {
                    cwd: "/workspace",
                    skills: [
                        {
                            name: "billing-cost-management",
                            path: "/runtime/skills/billing-cost-management/SKILL.md",
                            enabled: false,
                        },
                    ],
                },
            ],
        })

        await assert.rejects(
            manager.createSession({
                datasetId: store.listDatasets()[0].id,
                caseType: "badcase",
                sourceThreadId: "source-thread",
                endItemId: "answer-1",
                skillPath: "/runtime/skills/billing-cost-management/SKILL.md",
            }),
            /not installed and enabled.*current runtime/i,
        )
        assert.equal(store.listCurationSessions().length, 0)
    })

    it("records a valid draft, supports follow-up revision, and archives only on Done", async () => {
        const datasetId = store.listDatasets()[0].id
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        const firstTurn = store.getCurationSession(session.id).curator.currentTurnId
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: firstTurn,
                    status: "completed",
                    items: [
                        {
                            id: "curator-answer-1",
                            type: "agentMessage",
                            text: `Review complete.\n\n\`\`\`json\n${JSON.stringify(validDraft())}\n\`\`\``,
                        },
                    ],
                },
            },
        })
        assert.equal(store.getCurationSession(session.id).status, "needs_review")

        await manager.sendMessage(session.id, "把金额和币种的硬判定写得更明确")
        const revising = store.getCurationSession(session.id)
        assert.equal(revising.status, "running")
        assert.equal(revising.conversation.at(-1).text, "把金额和币种的硬判定写得更明确")
        assert.equal(runtime.startedTurns.at(-1).threadId, "curator-1")

        const secondTurn = revising.curator.currentTurnId
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: secondTurn,
                    status: "completed",
                    items: [
                        {
                            id: "curator-answer-2",
                            type: "agentMessage",
                            text: `\`\`\`json\n${JSON.stringify(validDraft("修订后的参考答案"))}\n\`\`\``,
                        },
                    ],
                },
            },
        })
        const saved = await manager.archive(session.id)
        assert.equal(saved.question, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(saved.curated.referenceAnswer.summary, "修订后的参考答案")
        assert.equal(saved.skillReference, null)
        assert.equal(store.getCurationSession(session.id).status, "archived")
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })

    it("isolates malformed Curator output and can retry it without changing the source", async () => {
        const datasetId = store.listDatasets()[0].id
        const datasetQuestion = "编辑后的评测问题，必须保持这个版本。"
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
            datasetQuestion,
        })
        await manager.waitForIdle(session.id)
        const turnId = store.getCurationSession(session.id).curator.currentTurnId
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: turnId,
                    status: "completed",
                    items: [{id: "broken", type: "agentMessage", text: "I could not decide."}],
                },
            },
        })

        const failed = store.getCurationSession(session.id)
        assert.equal(failed.status, "failed")
        assert.match(failed.error, /JSON draft/i)
        assert.equal(failed.episode.originalQuestion, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(failed.datasetQuestion, datasetQuestion)

        await manager.retry(session.id)
        const retried = store.getCurationSession(session.id)
        assert.equal(retried.status, "running")
        assert.match(runtime.startedTurns.at(-1).text, /previous response did not satisfy/i)
        assert.match(runtime.startedTurns.at(-1).text, new RegExp(datasetQuestion))
        assert.match(runtime.startedTurns.at(-1).text, /original source wording is immutable evidence/i)
        assert.equal(runtime.resumedThreads.at(-1).threadId, "curator-1")
    })

    it("turns an interrupted persisted job into a retryable failure on restart", () => {
        const datasetId = store.listDatasets()[0].id
        const episode = buildEpisodeSnapshot(sourceThread(), {
            endItemId: "answer-1",
            runtimeId: "codex-alpha",
        })
        const session = store.createCurationSession({
            datasetId,
            caseType: "goodcase",
            episode,
            curator: {threadId: "curator-before-restart"},
        })
        store.updateCurationSession(session.id, {
            status: "running",
            curator: {threadId: "curator-before-restart", currentTurnId: "turn-before-restart"},
        })

        const restarted = new CurationManager({store, getRuntime: async () => runtime})
        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "failed")
        assert.match(recovered.error, /interrupted/i)
        assert.equal(recovered.curator.currentTurnId, null)
        assert.equal(restarted.hiddenThreadIds().has("curator-before-restart"), true)
    })

    it("changes the next Curator model and discards a draft without creating a case", async () => {
        const datasetId = store.listDatasets()[0].id
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
            modelId: "gpt-5.6-sol",
        })
        await manager.waitForIdle(session.id)

        const changed = manager.updateModel(session.id, "gpt-5.6-terra")
        assert.equal(changed.curator.modelId, "gpt-5.6-terra")

        const discarded = await manager.discard(session.id)
        assert.equal(discarded.status, "cancelled")
        assert.equal(store.read().cases.length, 0)
        assert.deepEqual(runtime.interruptedTurns, [
            {threadId: "curator-1", turnId: "curator-turn-1"},
        ])
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })

    it("still archives a discarded Curator thread when interrupting its turn fails", async () => {
        const datasetId = store.listDatasets()[0].id
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        runtime.interruptTurn = async () => {
            throw new Error("turn already completed")
        }

        await manager.discard(session.id)

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })

    it("does not start a queued Curator after the draft is discarded", async () => {
        const scheduled = []
        const deferredManager = new CurationManager({
            store,
            getRuntime: async () => runtime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            onChanged: (session) => changed.push(session),
            schedule: (task) => {
                scheduled.push(task)
            },
        })
        const datasetId = store.listDatasets()[0].id
        const session = await deferredManager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })

        await deferredManager.discard(session.id)
        await scheduled[0]()

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.deepEqual(runtime.startedThreads, [])
        assert.deepEqual(runtime.startedTurns, [])
    })

    it("archives a Curator thread that finishes starting after the draft is discarded", async () => {
        const slowRuntime = new FakeRuntime()
        let markStarted
        let releaseStart
        const startEntered = new Promise((resolve) => {
            markStarted = resolve
        })
        const startReleased = new Promise((resolve) => {
            releaseStart = resolve
        })
        slowRuntime.startThread = async (options) => {
            slowRuntime.startedThreads.push(options)
            markStarted()
            await startReleased
            return {
                thread: {
                    id: "curator-1",
                    modelProvider: "openai",
                    model: options.model ?? "runtime-default",
                },
            }
        }
        const slowManager = new CurationManager({
            store,
            getRuntime: async () => slowRuntime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            schedule: (task) => task(),
        })
        const session = await slowManager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await startEntered

        await slowManager.discard(session.id)
        releaseStart()
        await slowManager.waitForIdle(session.id)

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.deepEqual(slowRuntime.startedTurns, [])
        assert.deepEqual(slowRuntime.archivedThreads, ["curator-1"])
    })

    it("interrupts a Curator turn that finishes starting after the draft is discarded", async () => {
        const slowRuntime = new FakeRuntime()
        let markTurnStarted
        let releaseTurn
        const turnEntered = new Promise((resolve) => {
            markTurnStarted = resolve
        })
        const turnReleased = new Promise((resolve) => {
            releaseTurn = resolve
        })
        slowRuntime.startTurn = async (threadId, text) => {
            const turn = {id: "curator-turn-1", items: []}
            slowRuntime.startedTurns.push({threadId, text, turn})
            markTurnStarted()
            await turnReleased
            return {turn}
        }
        const slowManager = new CurationManager({
            store,
            getRuntime: async () => slowRuntime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            schedule: (task) => task(),
        })
        const session = await slowManager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await turnEntered

        await slowManager.discard(session.id)
        releaseTurn()
        await slowManager.waitForIdle(session.id)

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.deepEqual(slowRuntime.interruptedTurns, [
            {threadId: "curator-1", turnId: "curator-turn-1"},
        ])
        assert.deepEqual(slowRuntime.archivedThreads, ["curator-1"])
    })

    it("retries archiving after an in-flight initial turn blocked the first attempt", async () => {
        const slowRuntime = new FakeRuntime()
        let markTurnStarted
        let releaseTurn
        let archiveAttempts = 0
        const turnEntered = new Promise((resolve) => {
            markTurnStarted = resolve
        })
        const turnReleased = new Promise((resolve) => {
            releaseTurn = resolve
        })
        slowRuntime.startTurn = async (threadId, text) => {
            const turn = {id: "curator-turn-1", items: []}
            slowRuntime.startedTurns.push({threadId, text, turn})
            markTurnStarted()
            await turnReleased
            return {turn}
        }
        slowRuntime.archiveThread = async (threadId) => {
            archiveAttempts += 1
            if (archiveAttempts === 1) throw new Error("thread still has an active turn")
            slowRuntime.archivedThreads.push(threadId)
        }
        const slowManager = new CurationManager({
            store,
            getRuntime: async () => slowRuntime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            schedule: (task) => task(),
        })
        const session = await slowManager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await turnEntered

        await slowManager.discard(session.id)
        releaseTurn()
        await slowManager.waitForIdle(session.id)

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.equal(archiveAttempts, 2)
        assert.deepEqual(slowRuntime.interruptedTurns, [
            {threadId: "curator-1", turnId: "curator-turn-1"},
        ])
        assert.deepEqual(slowRuntime.archivedThreads, ["curator-1"])
    })

    it("does not start a follow-up turn after discard wins during resume", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        let markResumeStarted
        let releaseResume
        const resumeEntered = new Promise((resolve) => {
            markResumeStarted = resolve
        })
        const resumeReleased = new Promise((resolve) => {
            releaseResume = resolve
        })
        runtime.resumeThread = async (threadId, options) => {
            runtime.resumedThreads.push({threadId, options})
            markResumeStarted()
            await resumeReleased
            return {thread: {id: threadId}}
        }

        const followUp = manager.sendMessage(session.id, "revise the draft")
        await resumeEntered
        await manager.discard(session.id)
        releaseResume()
        await followUp

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.equal(runtime.startedTurns.length, 1)
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })

    it("cleans up a follow-up turn that finishes starting after discard", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        let markTurnStarted
        let releaseTurn
        let archiveAttempts = 0
        const turnEntered = new Promise((resolve) => {
            markTurnStarted = resolve
        })
        const turnReleased = new Promise((resolve) => {
            releaseTurn = resolve
        })
        runtime.startTurn = async (threadId, text) => {
            const turn = {id: "follow-up-turn", items: []}
            runtime.startedTurns.push({threadId, text, turn})
            markTurnStarted()
            await turnReleased
            return {turn}
        }
        runtime.archiveThread = async (threadId) => {
            archiveAttempts += 1
            if (archiveAttempts === 1) throw new Error("thread still has an active turn")
            runtime.archivedThreads.push(threadId)
        }

        const followUp = manager.sendMessage(session.id, "revise the draft")
        await turnEntered
        await manager.discard(session.id)
        releaseTurn()
        await followUp

        assert.equal(store.getCurationSession(session.id).status, "cancelled")
        assert.equal(archiveAttempts, 2)
        assert.deepEqual(runtime.interruptedTurns, [
            {threadId: "curator-1", turnId: "follow-up-turn"},
        ])
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })
})
