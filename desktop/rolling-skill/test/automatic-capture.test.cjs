const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {AutomaticCaptureManager} = require("../src/automatic-capture.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-auto-capture-"))
    directories.push(directory)
    const store = new LocalEvaluationStore(join(directory, "store.json"))
    const created = []
    const hidden = new Set()
    const errors = []
    const curationManager = {
        hiddenThreadIds: () => hidden,
        createSession: async (input) => {
            created.push(input)
            return {id: `draft-${created.length}`}
        },
    }
    const manager = new AutomaticCaptureManager({
        store,
        curationManager,
        getTraceReference: ({threadId, endItemId}) => `trace://${threadId}#${endItemId}`,
        onError: (error) => errors.push(error),
    })
    return {store, created, hidden, errors, manager}
}

function completion(threadId = "thread-1") {
    return {
        method: "turn/completed",
        params: {
            threadId,
            turn: {
                id: "turn-1",
                status: "completed",
                items: [
                    {id: "user-1", type: "userMessage", content: [{type: "text", text: "question"}]},
                    {id: "answer-1", type: "agentMessage", text: "answer"},
                ],
            },
        },
    }
}

describe("automatic capture manager", () => {
    it("does nothing while automatic capture remains disabled", async () => {
        const {created, manager} = fixture()
        assert.equal(await manager.handleNotification(completion()), false)
        assert.deepEqual(created, [])
    })

    it("creates a reviewable draft with the configured model and dataset", async () => {
        const {store, created, manager} = fixture()
        const dataset = store.listDatasets()[0]
        store.updateSettings({
            autoCapture: true,
            autoCaptureModelId: "gpt-5.6-terra",
            autoCaptureDatasetId: dataset.id,
            autoCaptureCaseType: "goodcase",
            autoCaptureSkillName: "billing-cost-management",
            autoCaptureSkillPath: "/runtime/skills/billing-cost-management/SKILL.md",
        })

        assert.equal(await manager.handleNotification(completion()), true)
        assert.deepEqual(created, [
            {
                datasetId: dataset.id,
                caseType: "goodcase",
                sourceThreadId: "thread-1",
                startItemId: null,
                endItemId: "answer-1",
                traceReference: "trace://thread-1#answer-1",
                modelId: "gpt-5.6-terra",
                skillPath: "/runtime/skills/billing-cost-management/SKILL.md",
            },
        ])
    })

    it("reports an explicit error instead of creating a draft without a configured Skill", async () => {
        const {store, created, errors, manager} = fixture()
        store.updateSettings({autoCapture: true})

        assert.equal(await manager.handleNotification(completion()), false)
        assert.deepEqual(created, [])
        assert.match(errors[0].message, /Skill.*not configured/i)
    })

    it("ignores Curator threads", async () => {
        const {store, created, hidden, manager} = fixture()
        store.updateSettings({
            autoCapture: true,
            autoCaptureSkillName: "billing-cost-management",
            autoCaptureSkillPath: "/runtime/skills/billing-cost-management/SKILL.md",
        })
        hidden.add("curator-thread")

        assert.equal(await manager.handleNotification(completion("curator-thread")), false)
        assert.deepEqual(created, [])
    })
})
