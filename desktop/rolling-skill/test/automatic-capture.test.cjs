const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    AutomaticCaptureManager,
    ConversationDiscoveryManager,
} = require("../src/automatic-capture.cjs")
const {AutomaticCaptureStateStore} = require("../src/automatic-capture-state-store.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function thread(id, question = "查本月账单") {
    return {
        id,
        cwd: "/workspace/project",
        modelProvider: "openai",
        turns: [
            {
                id: `${id}-turn-1`,
                items: [
                    {id: `${id}-user-1`, type: "userMessage", text: question, content: [{type: "text", text: question}]},
                    {id: `${id}-agent-1`, type: "agentMessage", text: "本月账单为 100 元"},
                ],
            },
            {
                id: `${id}-turn-2`,
                items: [
                    {id: `${id}-user-2`, type: "userMessage", text: "再按产品拆分", content: [{type: "text", text: "再按产品拆分"}]},
                    {id: `${id}-agent-2`, type: "agentMessage", text: "产品 A 为 60 元，B 为 40 元"},
                ],
            },
        ],
    }
}

function fixture({
    mode = "scheduled",
    runtime = null,
    runAnalysis = null,
    rawCaseStore = null,
    hidden = new Set(),
} = {}) {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-discovery-"))
    directories.push(directory)
    const stateStore = new AutomaticCaptureStateStore(join(directory, "capture-state.json"))
    const settings = {
        autoCaptureProfile: {
            runtimePolicy: "active",
            mode,
            schedule: {cadence: "daily", time: "09:00", weekday: 1},
            modelId: "gpt-small",
            effort: "low",
            datasetId: null,
        },
    }
    const sourceThread = thread("thread-1")
    const runtimeCalls = {list: [], read: []}
    const activeRuntime = runtime ?? {
        async listThreads(options) {
            runtimeCalls.list.push(options)
            if (options.archived) return {data: [], nextCursor: null}
            return {data: [{id: sourceThread.id}], nextCursor: null}
        },
        async readThread(threadId) {
            runtimeCalls.read.push(threadId)
            return {thread: sourceThread}
        },
    }
    const candidates = []
    const raw = rawCaseStore ?? {
        addAutomaticCandidate(input) {
            candidates.push(input)
            return {created: true, observed: true, rawCase: {id: `raw-${candidates.length}`, ...input}}
        },
        list: () => candidates,
    }
    const analyses = []
    const analysis = runAnalysis ?? (async (input) => {
        analyses.push(input)
        if (input.stage === "boundary") {
            return JSON.stringify({
                segments: [{
                    startUserItemId: "thread-1-user-1",
                    endUserItemId: "thread-1-user-2",
                    summary: "Billing question",
                }],
                pendingStartUserItemId: null,
            })
        }
        return JSON.stringify({
            skillName: "billing-cost-management",
            outcome: "resolved",
            caseType: "goodcase",
            finalAssistantItemId: "thread-1-agent-2",
            confidence: 0.92,
            reason: "The answer contains the requested breakdown.",
        })
    })
    const statuses = []
    const errors = []
    const manager = new ConversationDiscoveryManager({
        store: {read: () => ({settings})},
        stateStore,
        rawCaseStore: raw,
        getRuntime: async () => activeRuntime,
        getRuntimeDescriptor: () => ({runtimeId: "codex:/opt/codex-a"}),
        listDatasets: () => [{
            id: "dataset-1",
            name: "Billing",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
        }],
        listSkills: async () => [{
            name: "billing-cost-management",
            path: "/skills/billing/SKILL.md",
            runtimeId: "codex:/opt/codex-a",
        }],
        runAnalysis: analysis,
        getHiddenThreadIds: () => hidden,
        now: () => new Date(2026, 7, 26, 9, 5, 0, 0),
        onStatus: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
    })
    return {
        analyses,
        candidates,
        errors,
        manager,
        raw,
        runtimeCalls,
        settings,
        sourceThread,
        stateStore,
        statuses,
    }
}

describe("scheduled conversation discovery manager", () => {
    it("does nothing while capture is off and ignores turn completion notifications", async () => {
        const {analyses, manager, stateStore} = fixture({mode: "off"})

        assert.equal(await manager.runDueScan(), false)
        assert.equal(await manager.handleNotification({method: "turn/completed"}), false)
        assert.deepEqual(analyses, [])
        assert.equal(stateStore.read().lastScheduledSlot, null)
        assert.equal(AutomaticCaptureManager, ConversationDiscoveryManager)
    })

    it("scans current and archived pages while excluding hidden internal tasks", async () => {
        const threads = {
            current: thread("current-thread", "current question"),
            current2: thread("current-thread-2", "second page"),
            archived: thread("archived-thread", "archived question"),
        }
        const reads = []
        const listCalls = []
        const runtime = {
            async listThreads({archived, cursor}) {
                listCalls.push({archived, cursor: cursor ?? null})
                if (archived) return {data: [{id: "archived-thread"}], nextCursor: null}
                if (!cursor) {
                    return {data: [{id: "current-thread"}, {id: "hidden-thread"}], nextCursor: "page-2"}
                }
                return {data: [{id: "current-thread-2"}], nextCursor: null}
            },
            async readThread(id) {
                reads.push(id)
                return {thread: threads[id === "current-thread-2" ? "current2" : id === "archived-thread" ? "archived" : "current"]}
            },
        }
        const prompts = []
        const {manager} = fixture({
            runtime,
            hidden: new Set(["hidden-thread"]),
            runAnalysis: async (input) => {
                prompts.push(input.prompt)
                const ids = [...input.prompt.matchAll(/"id":"([^"]+-user-[12])"/gu)].map((match) => match[1])
                return JSON.stringify({segments: [], pendingStartUserItemId: ids.at(-1)})
            },
        })

        assert.equal(await manager.runDueScan(), true)
        assert.deepEqual(reads, ["current-thread", "current-thread-2", "archived-thread"])
        assert.deepEqual(listCalls, [
            {archived: false, cursor: null},
            {archived: false, cursor: "page-2"},
            {archived: true, cursor: null},
        ])
        assert.equal(prompts.every((prompt) => !/本月账单为|产品 A/u.test(prompt)), true)
    })

    it("resumes a pending tail, persists the candidate before advancing its cursor, and deduplicates the slot", async () => {
        let fixtureValue
        const rawCaseStore = {
            records: [],
            addAutomaticCandidate(input) {
                assert.equal(
                    fixtureValue.stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId,
                    "thread-1-user-1",
                )
                this.records.push(input)
                return {created: true, observed: true, rawCase: {id: "raw-1", ...input}}
            },
            list() { return this.records },
        }
        fixtureValue = fixture({rawCaseStore})
        fixtureValue.stateStore.commitThread("codex:/opt/codex-a", "thread-1", {
            lastInspectedUserItemId: "thread-1-user-1",
            pendingStartUserItemId: "thread-1-user-1",
        }, "2026-08-25T09:05:00.000Z")

        assert.equal(await fixtureValue.manager.runDueScan(), true)
        assert.equal(await fixtureValue.manager.runDueScan(), false)
        assert.equal(rawCaseStore.records.length, 1)
        assert.equal(rawCaseStore.records[0].question, "查本月账单")
        assert.equal(rawCaseStore.records[0].source.kind, "automatic_capture")
        assert.equal(rawCaseStore.records[0].source.endItemId, "thread-1-agent-2")
        assert.equal(fixtureValue.analyses[0].stage, "boundary")
        assert.match(fixtureValue.analyses[0].prompt, /thread-1-user-1/u)
        assert.match(fixtureValue.analyses[0].prompt, /thread-1-user-2/u)
        assert.equal(fixtureValue.analyses[1].stage, "outcome")
        assert.match(fixtureValue.analyses[1].prompt, /产品 A 为 60 元/u)
        assert.equal(
            fixtureValue.stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId,
            "thread-1-user-2",
        )
        assert.equal(fixtureValue.stateStore.read().lastScheduledSlot !== null, true)
        assert.equal(fixtureValue.statuses.some((status) => status.running), true)
    })

    it("does not advance a candidate cursor or satisfy the slot when Raw Case persistence fails", async () => {
        const rawCaseStore = {
            addAutomaticCandidate() { throw new Error("Raw Case disk full") },
            list: () => [],
        }
        const {errors, manager, stateStore} = fixture({rawCaseStore})

        assert.equal(await manager.runDueScan(), false)
        assert.equal(stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId, null)
        assert.equal(stateStore.read().lastScheduledSlot, null)
        assert.match(stateStore.read().lastError.message, /disk full/i)
        assert.match(errors[0].message, /disk full/i)
    })

    it("starts and stops without a timer while capture is off", () => {
        const {manager} = fixture({mode: "off"})
        const timers = []
        const cleared = []
        manager.setTimer = (callback, delay) => {
            timers.push({callback, delay})
            return `timer-${timers.length}`
        }
        manager.clearTimer = (timer) => cleared.push(timer)

        manager.start()
        manager.reschedule()
        manager.stop()

        assert.equal(timers.length, 0)
        assert.deepEqual(cleared, [])
    })
})
