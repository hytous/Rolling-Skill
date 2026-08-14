const assert = require("node:assert/strict")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, beforeEach, describe, it} = require("node:test")

const {DATASET_RUBRIC_SCHEMA} = require("../src/dataset-rubric.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")
const {RubricManager} = require("../src/rubric-manager.cjs")

function rubric(title = "Billing rubric") {
    return {
        schemaVersion: DATASET_RUBRIC_SCHEMA,
        title,
        summary: "Billing Skill-specific result quality.",
        criteria: [{
            id: "R1",
            title: "Verified billing conclusion",
            criterion: "Return scoped and supported cost conclusions.",
            weight: 1,
            evidenceRequirements: ["Agent response", "Trace evidence"],
            scoringAnchors: {
                "0": "Missing or fabricated.",
                "2": "Mostly unsupported.",
                "5": "Partially supported.",
                "8": "Substantially supported.",
                "10": "Complete and cross-checked.",
            },
            criticalFailure: true,
        }],
        automaticFailures: [],
    }
}

class FakeRuntime {
    constructor() {
        this.startedThreads = []
        this.startedTurns = []
        this.resumedThreads = []
        this.archivedThreads = []
    }

    async startThread(options) {
        this.startedThreads.push(options)
        return {
            thread: {id: `rubric-thread-${this.startedThreads.length}`, modelProvider: "openai"},
            model: options.model ?? "runtime-default",
            reasoningEffort: options.effort ?? "low",
        }
    }

    async startTurn(threadId, input, options) {
        const turn = {id: `rubric-turn-${this.startedTurns.length + 1}`}
        this.startedTurns.push({threadId, input, options, turn})
        return {turn}
    }

    async resumeThread(threadId, options) {
        this.resumedThreads.push({threadId, options})
        return {thread: {id: threadId}}
    }

    async archiveThread(threadId) {
        this.archivedThreads.push(threadId)
    }

    async interruptTurn() {}
}

describe("Rubric Agent manager", () => {
    let directory
    let store
    let dataset
    let evidence
    let runtime
    let manager

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), "rolling-skill-rubric-manager-"))
        const skillPath = join(directory, "SKILL.md")
        writeFileSync(skillPath, "# Billing Skill\n\nUse billing-cli, paginate all results, then verify totals.\n")
        store = new LocalEvaluationStore(join(directory, "store.json"))
        dataset = store.bindDatasetSkill(store.listDatasets()[0].id, {
            schemaVersion: "rolling-skill-skill-reference/v1",
            name: "billing-cost-management",
            path: skillPath,
            scope: "user",
            description: "Billing queries",
            runtimeId: "codex:alpha",
            confirmedAt: "2026-08-14T00:00:00.000Z",
        })
        evidence = snapshotSkillEvidence(dataset.skillReference)
        runtime = new FakeRuntime()
        manager = new RubricManager({
            store,
            getRuntime: async () => runtime,
            getRuntimeDescriptor: () => ({runtimeId: "codex:alpha", providerId: "codex"}),
            schedule: (task) => task(),
        })
    })

    afterEach(() => rmSync(directory, {recursive: true, force: true}))

    async function start() {
        const session = await manager.createSession({
            datasetId: dataset.id,
            skillEvidence: evidence,
            modelId: "gpt-5.6-sol",
            effort: "high",
        })
        await manager.waitForIdle(session.id)
        return store.getRubricSession(session.id)
    }

    async function complete(session, responseRubric = rubric()) {
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: session.rubricAgent.threadId,
                turn: {
                    id: store.getRubricSession(session.id).rubricAgent.currentTurnId,
                    status: "completed",
                    items: [{
                        type: "agentMessage",
                        text: `Draft ready.\n\n\`\`\`json\n${JSON.stringify(responseRubric)}\n\`\`\``,
                    }],
                },
            },
        })
        return store.getRubricSession(session.id)
    }

    it("starts a read-only subagent with frozen Skill evidence and selected effort", async () => {
        const session = await start()

        assert.equal(session.status, "running")
        assert.equal(session.rubricAgent.effectiveModelId, "gpt-5.6-sol")
        assert.equal(session.rubricAgent.effectiveEffort, "high")
        assert.deepEqual(runtime.startedThreads[0], {
            sandbox: "read-only",
            approvalPolicy: "never",
            ephemeral: false,
            threadSource: "subagent",
            model: "gpt-5.6-sol",
            effort: "high",
        })
        assert.deepEqual(runtime.startedTurns[0].input[0], {
            type: "skill",
            name: "billing-cost-management",
            path: dataset.skillReference.path,
        })
        const prompt = runtime.startedTurns[0].input[1].text
        assert.match(prompt, /rolling-skill-dataset-rubric\/v1/)
        assert.match(prompt, /paginate all results/)
        assert.match(prompt, /application, not you, computes all scores and verdicts/i)
        assert.equal(manager.hiddenThreadIds().has(session.rubricAgent.threadId), true)
    })

    it("keeps conversational review while applying complete JSON revisions", async () => {
        let session = await start()
        session = await complete(session)
        assert.equal(session.status, "needs_review")
        assert.equal(session.draft.title, "Billing rubric")

        await manager.sendMessage(session.id, "为什么 R1 是关键失败？")
        session = store.getRubricSession(session.id)
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: session.rubricAgent.threadId,
                turn: {
                    id: session.rubricAgent.currentTurnId,
                    status: "completed",
                    items: [{type: "agentMessage", text: "因为伪造财务结论会使结果不可用。"}],
                },
            },
        })
        session = store.getRubricSession(session.id)
        assert.equal(session.status, "needs_review")
        assert.equal(session.error, null)
        assert.equal(session.revisions.length, 1)
        assert.match(session.conversation.at(-1).text, /伪造财务结论/)

        await manager.sendMessage(session.id, "把标题改清楚")
        session = await complete(store.getRubricSession(session.id), rubric("Clear billing rubric"))
        assert.equal(session.revisions.length, 2)
        assert.equal(session.draft.title, "Clear billing rubric")

        const published = await manager.publish(session.id)
        assert.equal(published.version, 1)
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, published.id)
        assert.deepEqual(runtime.archivedThreads, [session.rubricAgent.threadId])
    })

    it("fails an initial malformed contract without destroying a prior valid draft", async () => {
        let session = await start()
        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: session.rubricAgent.threadId,
                turn: {
                    id: session.rubricAgent.currentTurnId,
                    status: "completed",
                    items: [{type: "agentMessage", text: "I forgot the JSON."}],
                },
            },
        })
        session = store.getRubricSession(session.id)
        assert.equal(session.status, "failed")
        assert.match(session.error, /JSON rubric/i)
    })
})
