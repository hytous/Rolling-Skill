const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    AutomaticCaptureManager,
    ConversationDiscoveryManager,
    automaticDatasetFor,
} = require("../src/automatic-capture.cjs")
const {AutomaticCaptureStateStore} = require("../src/automatic-capture-state-store.cjs")

const directories = []

it("reports real source-scan and model stages rather than an undifferentiated running flag", async () => {
    const result = fixture()
    await result.manager.runSlot(new Date("2026-09-01T08:00:00Z"))
    const progress = result.statuses.map((entry) => entry.progress).filter(Boolean)
    assert.ok(progress.some((entry) => entry.stage === "boundary" && entry.totalThreads === 1 && entry.completedThreads === 0))
    assert.ok(progress.some((entry) => entry.stage === "outcome" && entry.analysisCount === 2))
    assert.equal(progress.at(-1).completedThreads, 1)
    assert.equal(progress.at(-1).stage, "completed")
})

it("skips full history reads only for an unchanged, successfully inspected source revision", async () => {
    let revision = "dsh:100"
    let reads = 0
    let fail = false
    const value = fixture({runtime: {
        listThreads: async ({archived}) => ({data: archived ? [] : [{id: "thread-1", sourceRevision: revision}]}),
        readThread: async () => {reads += 1; if (fail) throw new Error("history unavailable"); return {thread: thread("thread-1")}},
    }})
    const scan = () => value.manager.runSlot(new Date("2026-09-01T09:00:00Z"))
    await scan()
    await scan()
    assert.equal(reads, 1, "unchanged source summaries must not download the whole conversation again")
    assert.equal(value.stateStore.thread("codex:/opt/codex-a", "thread-1").sourceRevision, "dsh:100")
    revision = "dsh:101"
    fail = true
    await assert.rejects(scan, /history unavailable/u)
    assert.equal(value.stateStore.thread("codex:/opt/codex-a", "thread-1").sourceRevision, "dsh:100", "failed reads must not advance the source checkpoint")
    fail = false
    await scan()
    assert.equal(reads, 3)
    revision = null
    await scan()
    await scan()
    assert.equal(reads, 5, "active sources and providers without reliable revision metadata still get read")
})

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
    datasets = null,
    curationManager = null,
    alreadyCurated = () => false,
    captureEpisode = null,
    saveEvidence = null,
    skills = null,
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
            targets: [],
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
    const dispatches = []
    const raw = rawCaseStore ?? {
        addAutomaticCandidate(input) {
            candidates.push(input)
            return {created: true, observed: true, rawCase: {id: `raw-${candidates.length}`, ...input}}
        },
        list: () => candidates,
        markDispatched(id, dispatch) {
            dispatches.push({id, dispatch})
            return {id}
        },
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
            eligibleForCase: true,
            sourceKind: "human_task",
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
        store: {
            read: () => ({settings}),
            hasCurationForSource: alreadyCurated,
        },
        stateStore,
        rawCaseStore: raw,
        getRuntime: async () => activeRuntime,
        getRuntimeDescriptor: () => ({runtimeId: "codex:/opt/codex-a"}),
        curationManager,
        listDatasets: () => datasets ?? [{
            id: "dataset-1",
            name: "Billing",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
        }],
        listSkills: async () => skills ?? [{
            name: "billing-cost-management",
            path: "/skills/billing/SKILL.md",
            runtimeId: "codex:/opt/codex-a",
        }],
        runAnalysis: analysis,
        captureEpisode,
        saveEvidence,
        getHiddenThreadIds: () => hidden,
        now: () => new Date(2026, 7, 26, 9, 5, 0, 0),
        onStatus: (status) => statuses.push(status),
        onError: (error) => errors.push(error),
    })
    return {
        analyses,
        candidates,
        dispatches,
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

describe("automatic dataset routing", () => {
    const candidate = {
        confidence: 0.92,
        outcome: "resolved",
        skill: {
            id: "skill-billing",
            name: "billing-cost-management",
            path: "/skills/billing/SKILL.md",
        },
    }
    const matching = (id) => ({
        id,
        skillReference: {
            id: "skill-billing",
            name: "billing-cost-management",
            path: "/skills/billing/SKILL.md",
        },
    })

    it("prefers a compatible configured dataset and otherwise accepts one unique match", () => {
        const datasets = [matching("dataset-1"), matching("dataset-2")]

        assert.equal(automaticDatasetFor(candidate, datasets, "dataset-2")?.id, "dataset-2")
        assert.equal(automaticDatasetFor(candidate, [matching("dataset-1")], null)?.id, "dataset-1")
    })

    it("fails closed for low confidence, uncertain, missing, and ambiguous routes", () => {
        assert.equal(automaticDatasetFor({...candidate, confidence: 0.79}, [matching("dataset-1")]), null)
        assert.equal(automaticDatasetFor({...candidate, confidence: undefined}, [matching("dataset-1")]), null)
        assert.equal(automaticDatasetFor({...candidate, outcome: "uncertain"}, [matching("dataset-1")]), null)
        assert.equal(automaticDatasetFor(candidate, [{id: "other", skillReference: {name: "other"}}]), null)
        assert.equal(automaticDatasetFor(candidate, [matching("dataset-1"), matching("dataset-2")]), null)
    })

    it("uses an explicit candidate Skill route when several compatible Datasets exist", () => {
        const datasets = [matching("dataset-1"), matching("dataset-2")]
        const targets = [{skillId: "skill-billing", datasetId: "dataset-2"}]

        assert.equal(automaticDatasetFor(candidate, datasets, targets)?.id, "dataset-2")
    })
})

describe("scheduled conversation discovery manager", () => {
    it("can schedule the next run without silently backfilling historical slots on Host startup", () => {
        const {manager} = fixture({mode: "automatic"})
        let scans = 0
        let timers = 0
        manager.runDueScan = async () => {scans += 1}
        manager.setTimer = () => {timers += 1; return 1}
        manager.clearTimer = () => {}
        manager.start({catchUp: false})
        assert.equal(scans, 0)
        assert.equal(timers, 1)
        manager.stop()
    })
    it("passes only configured candidate Skills to Case detection", async () => {
        const datasets = [
            {
                id: "dataset-billing",
                name: "Billing",
                skillReference: {id: "skill-billing", name: "billing-cost-management"},
            },
            {
                id: "dataset-incident",
                name: "Incidents",
                skillReference: {id: "skill-incident", name: "incident-response-planner"},
            },
        ]
        const value = fixture({
            datasets,
            skills: [
                {name: "billing-cost-management"},
                {name: "incident-response-planner"},
            ],
        })
        value.settings.autoCaptureProfile.targets = [{
            skillId: "skill-billing",
            datasetId: "dataset-billing",
        }]

        await value.manager.runDueScan()

        const outcome = value.analyses.find((entry) => entry.stage === "outcome")
        assert.match(outcome.prompt, /billing-cost-management/u)
        assert.doesNotMatch(outcome.prompt, /incident-response-planner/u)
    })

    it("freezes a DSH source range through the trusted episode source before classification", async () => {
        const captured = []
        const value = fixture({
            captureEpisode: async (input) => {
                captured.push(input)
                return {episode: {schemaVersion: "rolling-skill-episode/v1", source: {kind: "dsh-session"}}}
            },
        })
        value.sourceThread.modelProvider = "deepseek-harness"
        value.sourceThread.turns[0].items[0].sourceSeq = 7
        value.sourceThread.turns[1].items[1].sourceSeq = 42
        value.sourceThread.turns[1].items[1].sourceMessageId = "assistant-native-id"

        const episode = await value.manager.episodeForSegment(value.sourceThread, {
            startUserItemId: "thread-1-user-1",
            endUserItemId: "thread-1-user-2",
        }, "deepseek-harness:runtime")

        assert.deepEqual(captured, [{
            sessionId: "thread-1",
            startSeq: 7,
            endMessageId: "assistant-native-id",
        }])
        assert.equal(episode.source.kind, "dsh-session")
    })

    it("fails closed instead of synthesizing evidence when a DSH episode source is unavailable", async () => {
        const value = fixture()
        value.sourceThread.modelProvider = "deepseek-harness"

        await assert.rejects(
            value.manager.episodeForSegment(value.sourceThread, {
                startUserItemId: "thread-1-user-1",
                endUserItemId: "thread-1-user-2",
            }, "deepseek-harness:runtime"),
            /trusted DSH episode source is unavailable/u,
        )
    })

    it("does not treat Assistant text from non-completed turns as a final response", async () => {
        for (const status of ["inProgress", "interrupted", "failed"]) {
            const value = fixture()
            value.sourceThread.turns[1].status = status

            const messages = value.manager.userMessages(value.sourceThread)
            assert.equal(messages[1].assistantCompleted, false, status)
            await assert.rejects(
                value.manager.episodeForSegment(value.sourceThread, {
                    startUserItemId: "thread-1-user-1",
                    endUserItemId: "thread-1-user-2",
                }, "codex:/opt/codex-a"),
                /no final Assistant response/u,
                status,
            )
        }
    })

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
                const selected = structuredClone(
                    threads[id === "current-thread-2" ? "current2" : id === "archived-thread" ? "archived" : "current"],
                )
                for (const turn of selected.turns) {
                    turn.items = turn.items.filter((item) => item.type !== "agentMessage")
                }
                return {thread: selected}
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

    it("does not recursively scan Rolling Skill internal tasks after a service restart", async () => {
        const reads = []
        const internalThreads = [
            thread("thread-1", "Identify complete user problem ranges from incremental user messages only.\n<incremental-user-messages>{}</incremental-user-messages>"),
            thread("thread-2", "You are judging one agent Skill evaluation result. Evaluate only the supplied answer."),
            thread("thread-3", "/billing-cost-managementYou are the Curator for an agent Skill evaluation dataset.\nThe source episode follows."),
            thread("thread-4", "Decide whether this completed episode is eligible to become a Skill evaluation Case.\nThe source episode follows."),
            thread("thread-5", "[Environment context — rolling-skill-operator/v1]\nRolling Skill Operator Protocol v1\nFrozen scope: {}"),
        ]
        const runtime = {
            async listThreads({archived}) {
                return {data: archived ? [] : internalThreads.map(({id}) => ({id})), nextCursor: null}
            },
            async readThread(threadId) {
                reads.push(threadId)
                return {thread: internalThreads.find(({id}) => id === threadId)}
            },
        }
        const value = fixture({runtime})

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses, [])
        assert.deepEqual(value.candidates, [])
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId,
            "thread-1-user-2",
        )

        await value.manager.runSlot(new Date(2026, 7, 27, 9, 0), value.settings.autoCaptureProfile)
        assert.deepEqual(reads.sort(), ["thread-1", "thread-2", "thread-3", "thread-4", "thread-5"])
    })

    it("does not persist an ineligible internal or installation episode as a Raw Case", async () => {
        for (const sourceKind of ["rolling_skill_internal", "skill_installation", "evaluation_or_optimization"]) {
            const value = fixture({
                runAnalysis: async (input) => {
                    value.analyses.push(input)
                    if (input.stage === "boundary") {
                        return JSON.stringify({
                            segments: [{
                                startUserItemId: "thread-1-user-1",
                                endUserItemId: "thread-1-user-2",
                                summary: "Internal task",
                            }],
                            pendingStartUserItemId: null,
                        })
                    }
                    return JSON.stringify({
                        eligibleForCase: false,
                        sourceKind,
                        skillName: null,
                        outcome: "uncertain",
                        caseType: null,
                        finalAssistantItemId: null,
                        confidence: 0.99,
                        reason: "This is not a human evaluation Case.",
                    })
                },
            })

            assert.equal(await value.manager.runDueScan(), true)
            assert.deepEqual(value.candidates, [])
            assert.equal(
                value.stateStore.thread("codex:/opt/codex-a", "thread-1").checkedRanges[0].reason,
                `ineligible_${sourceKind}`,
            )
        }
    })

    it("does not persist uncertain or low-confidence classifications as Raw Cases", async () => {
        for (const classification of [
            {outcome: "uncertain", confidence: 0.99, reason: "uncertain_outcome"},
            {outcome: "resolved", confidence: 0.79, reason: "low_confidence"},
        ]) {
            const value = fixture({
                runAnalysis: async (input) => {
                    value.analyses.push(input)
                    if (input.stage === "boundary") {
                        return JSON.stringify({
                            segments: [{
                                startUserItemId: "thread-1-user-1",
                                endUserItemId: "thread-1-user-2",
                                summary: "Candidate task",
                            }],
                            pendingStartUserItemId: null,
                        })
                    }
                    return JSON.stringify({
                        eligibleForCase: true,
                        sourceKind: "human_task",
                        skillName: "billing-cost-management",
                        outcome: classification.outcome,
                        caseType: "goodcase",
                        finalAssistantItemId: "thread-1-agent-2",
                        confidence: classification.confidence,
                        reason: "Classification evidence.",
                    })
                },
            })

            assert.equal(await value.manager.runDueScan(), true)
            assert.deepEqual(value.candidates, [])
            assert.equal(
                value.stateStore.thread("codex:/opt/codex-a", "thread-1").checkedRanges[0].reason,
                classification.reason,
            )
        }
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

    it("freezes the classified Episode reference only for a saved automatic candidate", async () => {
        const savedEpisodes = []
        const reference = {
            schemaVersion: "rolling-skill-automatic-evidence-reference/v1",
            digest: `sha256:${"b".repeat(64)}`,
        }
        const value = fixture({
            saveEvidence(episode) {
                savedEpisodes.push(structuredClone(episode))
                return reference
            },
        })

        await value.manager.runDueScan()

        assert.equal(savedEpisodes.length, 1)
        assert.equal(savedEpisodes[0].source.startItemId, "thread-1-user-1")
        assert.equal(savedEpisodes[0].source.endItemId, "thread-1-agent-2")
        assert.deepEqual(value.candidates[0].source.evidence, reference)

        const rejectedEpisodes = []
        const rejected = fixture({
            runAnalysis: async (input) => input.stage === "boundary"
                ? JSON.stringify({
                    segments: [{
                        startUserItemId: "thread-1-user-1",
                        endUserItemId: "thread-1-user-2",
                        summary: "Billing question",
                    }],
                    pendingStartUserItemId: null,
                })
                : JSON.stringify({
                    eligibleForCase: false,
                    sourceKind: "internal_agent_work",
                    skillName: null,
                    outcome: "uncertain",
                    caseType: "goodcase",
                    finalAssistantItemId: null,
                    confidence: 1,
                    reason: "Internal work",
                }),
            saveEvidence(episode) {
                rejectedEpisodes.push(episode)
                return reference
            },
        })

        await rejected.manager.runDueScan()
        assert.deepEqual(rejectedEpisodes, [])
        assert.deepEqual(rejected.candidates, [])
    })

    it("rescans a persisted pending tail even when no newer user message exists", async () => {
        const value = fixture()
        value.stateStore.commitThread("codex:/opt/codex-a", "thread-1", {
            lastInspectedUserItemId: "thread-1-user-2",
            pendingStartUserItemId: "thread-1-user-1",
        }, "2026-08-25T09:05:00.000Z")

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary", "outcome"])
        assert.equal(value.candidates.length, 1)
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").pendingStartUserItemId,
            null,
        )
    })

    it("closes a model-pending tail when every user turn already has a final Assistant response", async () => {
        const value = fixture({
            runAnalysis: async (input) => {
                value.analyses.push(input)
                if (input.stage === "boundary") {
                    return JSON.stringify({
                        segments: [],
                        pendingStartUserItemId: "thread-1-user-1",
                    })
                }
                return JSON.stringify({
                    eligibleForCase: true,
                    sourceKind: "human_task",
                    skillName: "billing-cost-management",
                    outcome: "resolved",
                    caseType: "goodcase",
                    finalAssistantItemId: "thread-1-agent-2",
                    confidence: 0.92,
                    reason: "The completed response contains the requested breakdown.",
                })
            },
        })

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary", "outcome"])
        assert.equal(value.candidates.length, 1)
        assert.equal(value.candidates[0].source.startItemId, "thread-1-user-1")
        assert.equal(value.candidates[0].source.endItemId, "thread-1-agent-2")
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").pendingStartUserItemId,
            null,
        )
    })

    it("keeps a model-pending tail open when its final user turn has no Assistant response", async () => {
        const incomplete = thread("thread-1")
        incomplete.turns[1].items = incomplete.turns[1].items.filter((item) => item.type !== "agentMessage")
        const runtime = {
            async listThreads({archived}) {
                return {data: archived ? [] : [{id: incomplete.id}], nextCursor: null}
            },
            async readThread() { return {thread: incomplete} },
        }
        const value = fixture({
            runtime,
            runAnalysis: async (input) => {
                value.analyses.push(input)
                return JSON.stringify({
                    segments: [],
                    pendingStartUserItemId: "thread-1-user-1",
                })
            },
        })

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary"])
        assert.deepEqual(value.candidates, [])
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").pendingStartUserItemId,
            "thread-1-user-1",
        )
        await value.manager.runSlot(new Date("2026-09-02T08:00:00Z"))
        assert.equal(value.analyses.length, 1, "an unchanged unanswered tail must not spend another model call")
        incomplete.turns[1].items.push({id: "thread-1-agent-2", type: "agentMessage", text: "Now completed"})
        value.manager.runAnalysis = async (input) => {
            value.analyses.push(input)
            if (input.stage === "boundary") return JSON.stringify({segments: [], pendingStartUserItemId: "thread-1-user-1"})
            return JSON.stringify({eligibleForCase: false, sourceKind: "other_internal", skillName: null, outcome: "resolved", caseType: null, finalAssistantItemId: null, confidence: 0.9, reason: "Not a business Case"})
        }
        await value.manager.runSlot(new Date("2026-09-03T08:00:00Z"))
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary", "boundary", "outcome"], "a newly completed assistant response must be inspected")
    })

    it("defers a model-closed segment whose final user turn has no Assistant response", async () => {
        const incomplete = thread("thread-1")
        incomplete.turns[1].items = incomplete.turns[1].items.filter((item) => item.type !== "agentMessage")
        const runtime = {
            async listThreads({archived}) {
                return {data: archived ? [] : [{id: incomplete.id}], nextCursor: null}
            },
            async readThread() { return {thread: incomplete} },
        }
        const value = fixture({
            runtime,
            runAnalysis: async (input) => {
                value.analyses.push(input)
                return JSON.stringify({
                    segments: [{
                        startUserItemId: "thread-1-user-1",
                        endUserItemId: "thread-1-user-2",
                        summary: "The model closed an incomplete range",
                    }],
                    pendingStartUserItemId: null,
                })
            },
        })

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary"])
        assert.deepEqual(value.candidates, [])
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").pendingStartUserItemId,
            "thread-1-user-1",
        )
    })

    it("does not reclassify or duplicate a conversation range already curated by a human", async () => {
        const checked = []
        const value = fixture({
            alreadyCurated(threadId, endItemId) {
                checked.push({threadId, endItemId})
                return threadId === "thread-1" && endItemId === "thread-1-agent-2"
            },
        })

        assert.equal(await value.manager.runDueScan(), true)
        assert.deepEqual(value.analyses.map((entry) => entry.stage), ["boundary"])
        assert.deepEqual(value.candidates, [])
        assert.deepEqual(checked, [{threadId: "thread-1", endItemId: "thread-1-agent-2"}])
        assert.equal(
            value.stateStore.thread("codex:/opt/codex-a", "thread-1").checkedRanges[0].reason,
            "already_curated",
        )
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

    it("creates an automatic Draft only with a published Rubric and archives a valid Draft once", async () => {
        const created = []
        const archived = []
        const curationManager = {
            async createSession(input) {
                created.push(input)
                return {id: "session-1", status: "queued"}
            },
            async archive(id) {
                archived.push(id)
                return {id: "case-1"}
            },
            hiddenThreadIds: () => new Set(),
        }
        const value = fixture({
            mode: "automatic",
            curationManager,
            datasets: [{
                id: "dataset-1",
                name: "Billing",
                activeRubricVersionId: "rubric-1",
                skillReference: {
                    name: "billing-cost-management",
                    path: "/skills/billing/SKILL.md",
                },
            }],
        })

        assert.equal(await value.manager.runDueScan(), true)
        assert.equal(created.length, 1)
        assert.equal(created[0].datasetId, "dataset-1")
        assert.equal(created[0].sourceThreadId, "thread-1")
        assert.equal(created[0].startItemId, "thread-1-user-1")
        assert.equal(created[0].endItemId, "thread-1-agent-2")
        assert.equal(created[0].episode.source.threadId, "thread-1")
        assert.equal(created[0].episode.source.startItemId, "thread-1-user-1")
        assert.equal(created[0].episode.source.endItemId, "thread-1-agent-2")
        assert.deepEqual(value.dispatches, [])

        await value.manager.handleCurationChanged({
            id: "session-1",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        })
        await value.manager.handleCurationChanged({
            id: "session-1",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        })

        assert.deepEqual(archived, ["session-1"])
        assert.deepEqual(value.dispatches, [{
            id: "raw-1",
            dispatch: {mode: "automatic", caseId: "case-1"},
        }])
    })

    it("uses the current automatic mode when a scan started with a stale profile", async () => {
        const created = []
        const value = fixture({
            mode: "automatic",
            curationManager: {
                async createSession(input) { created.push(input); return {id: "session-live", status: "queued"} },
                hiddenThreadIds: () => new Set(),
            },
            datasets: [{
                id: "dataset-1",
                activeRubricVersionId: "rubric-1",
                skillReference: {name: "billing-cost-management"},
            }],
        })
        const episode = {
            originalQuestion: "查本月账单",
            source: {
                threadId: "thread-1",
                startItemId: "thread-1-user-1",
                startTurnId: "thread-1-turn-1",
                endItemId: "thread-1-agent-2",
                endTurnId: "thread-1-turn-2",
            },
            items: [],
        }

        await value.manager.createAutomaticCuration({
            saved: {rawCase: {id: "raw-live"}},
            source: {confidence: 0.92, outcome: "resolved", caseType: "goodcase", threadId: "thread-1"},
            episode,
            skill: {name: "billing-cost-management"},
            datasets: [{
                id: "dataset-1",
                activeRubricVersionId: "rubric-1",
                skillReference: {name: "billing-cost-management"},
            }],
            profile: {mode: "scheduled", datasetId: "dataset-1"},
        })

        assert.equal(created.length, 1)
    })

    it("uses the current Skill route and Dataset inventory before creating a Draft", async () => {
        const created = []
        const datasets = [{
            id: "dataset-current",
            activeRubricVersionId: "rubric-current",
            skillReference: {id: "skill-billing", name: "billing-cost-management"},
        }]
        const value = fixture({
            mode: "automatic",
            datasets,
            curationManager: {
                async createSession(input) { created.push(input); return {id: "session-current", status: "queued"} },
                hiddenThreadIds: () => new Set(),
            },
        })
        value.settings.autoCaptureProfile.targets = [{
            skillId: "skill-billing",
            datasetId: "dataset-current",
        }]

        await value.manager.createAutomaticCuration({
            saved: {rawCase: {id: "raw-current"}},
            source: {confidence: 0.92, outcome: "resolved", caseType: "goodcase", threadId: "thread-1"},
            episode: {
                originalQuestion: "查本月账单",
                source: {threadId: "thread-1", startItemId: "user-1", endItemId: "agent-1"},
                items: [],
            },
            skill: {id: "skill-billing", name: "billing-cost-management"},
            datasets: [{
                id: "dataset-stale",
                activeRubricVersionId: "rubric-stale",
                skillReference: {id: "skill-billing", name: "billing-cost-management"},
            }],
            profile: {targets: [{skillId: "skill-billing", datasetId: "dataset-stale"}]},
        })

        assert.equal(created[0].datasetId, "dataset-current")
        assert.equal(created[0].automaticCaptureRawCaseId, "raw-current")
    })

    it("fails closed when selected managed Skills have an ambiguous name", async () => {
        const duplicateSkills = [
            {id: "skill-billing-a", name: "billing-cost-management"},
            {id: "skill-billing-b", name: "billing-cost-management"},
        ]
        const duplicateDatasets = duplicateSkills.map((skill, index) => ({
            id: `dataset-${index}`,
            activeRubricVersionId: `rubric-${index}`,
            skillReference: skill,
        }))
        const value = fixture({mode: "automatic", skills: duplicateSkills, datasets: duplicateDatasets})
        value.settings.autoCaptureProfile.targets = duplicateDatasets.map((dataset) => ({
            skillId: dataset.skillReference.id,
            datasetId: dataset.id,
        }))

        assert.equal(await value.manager.runDueScan(), false)
        assert.equal(value.candidates.length, 0)
        assert.match(value.errors.at(-1).message, /ambiguous.*Skill name/i)
    })

    it("retains the Raw Case when the route lacks a Rubric or Draft creation fails", async () => {
        let creates = 0
        const missingRubric = fixture({
            mode: "automatic",
            curationManager: {
                async createSession() { creates += 1 },
                hiddenThreadIds: () => new Set(),
            },
            datasets: [{
                id: "dataset-1",
                skillReference: {
                    name: "billing-cost-management",
                    path: "/skills/billing/SKILL.md",
                },
                activeRubricVersionId: null,
            }],
        })

        assert.equal(await missingRubric.manager.runDueScan(), false)
        assert.equal(creates, 0)
        assert.equal(missingRubric.candidates.length, 1)
        assert.deepEqual(missingRubric.dispatches, [])
        assert.match(missingRubric.stateStore.read().lastError.message, /published Rubric/u)

        const failedDraft = fixture({
            mode: "automatic",
            curationManager: {
                async createSession() {
                    creates += 1
                    throw new Error("Curator unavailable")
                },
                hiddenThreadIds: () => new Set(),
            },
            datasets: [{
                id: "dataset-1",
                skillReference: {
                    name: "billing-cost-management",
                    path: "/skills/billing/SKILL.md",
                },
                activeRubricVersionId: "rubric-1",
            }],
        })

        assert.equal(await failedDraft.manager.runDueScan(), false)
        assert.equal(failedDraft.candidates.length, 1)
        assert.deepEqual(failedDraft.dispatches, [])
        assert.match(failedDraft.errors.at(-1).message, /Curator unavailable/u)
        assert.match(failedDraft.stateStore.read().lastError.message, /Curator unavailable/u)
        assert.equal(
            failedDraft.stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId,
            null,
        )
    })

    it("keeps a background run alive until the automatic Curator actually saves its Case", async () => {
        let session = {id: "owned", status: "running", automaticCaptureRawCaseId: "raw-owned"}
        const value = fixture({mode: "automatic", curationManager: {
            listSessions: () => [session], hiddenThreadIds: () => new Set(),
            async archive() {session = {...session, status: "archived", caseId: "saved"}; return {id: "saved"}},
        }})
        value.manager.automaticSessions.set("owned", {rawCaseId: "raw-owned"})
        let done = false
        const waiting = value.manager.waitForAutomaticSessions({pollMs: 1}).then(() => {done = true})
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(done, false)
        session = {...session, status: "needs_review", draft: {schemaVersion: "rolling-skill-curated-case/v1"}}
        await value.manager.handleCurationChanged(session)
        await waiting
        assert.equal(done, true)
        assert.equal(value.dispatches[0].dispatch.caseId, "saved")
    })

    it("marks a Raw Case dispatched only after automatic Case persistence succeeds", async () => {
        let resolveArchive
        const archiveResult = new Promise((resolve) => { resolveArchive = resolve })
        const value = fixture({
            mode: "automatic",
            curationManager: {
                async createSession() { return {id: "session-1", status: "queued"} },
                archive: () => archiveResult,
                hiddenThreadIds: () => new Set(),
            },
            datasets: [{
                id: "dataset-1",
                activeRubricVersionId: "rubric-1",
                skillReference: {
                    name: "billing-cost-management",
                    path: "/skills/billing/SKILL.md",
                },
            }],
        })
        await value.manager.runDueScan()

        const saving = value.manager.handleCurationChanged({
            id: "session-1",
            status: "needs_review",
            draft: {schemaVersion: "rolling-skill-curated-case/v1"},
        })
        await Promise.resolve()
        assert.deepEqual(value.dispatches, [])

        resolveArchive({id: "case-1"})
        await saving
        assert.equal(value.dispatches.length, 1)
    })

    it("recovers only explicitly owned automatic curation after restart, never a matching manual Draft", async () => {
        const dispatches = []
        const retries = []
        const archives = []
        const rawCaseStore = {
            list: () => [{
                id: "raw-restart",
                source: {
                    kind: "automatic_capture",
                    observations: [{
                        threadId: "thread-source",
                        endItemId: "thread-source-agent-2",
                    }],
                },
            }],
            markDispatched(id, dispatch) {
                dispatches.push({id, dispatch})
            },
        }
        const interrupted = {
            id: "session-restart",
            automaticCaptureRawCaseId: "raw-restart",
            status: "failed",
            error: "The Curator task was interrupted when Rolling Skill stopped. Retry to continue.",
            draft: null,
            episode: {
                source: {
                    threadId: "thread-source",
                    endItemId: "thread-source-agent-2",
                },
            },
        }
        const curationManager = {
            listSessions: () => [
                {...interrupted, id: "manual-review", automaticCaptureRawCaseId: null,
                    status: "needs_review", draft: {schemaVersion: "rolling-skill-curated-case/v1"}},
                interrupted,
            ],
            async retry(id) {
                retries.push(id)
                return {
                    ...interrupted,
                    status: "needs_review",
                    error: null,
                    draft: {schemaVersion: "rolling-skill-curated-case/v1"},
                }
            },
            async archive(id) {
                archives.push(id)
                return {id: "case-recovered"}
            },
            hiddenThreadIds: () => new Set(),
        }
        const value = fixture({mode: "automatic", rawCaseStore, curationManager})

        assert.equal(await value.manager.recoverAutomaticSessions(), true)
        assert.deepEqual(retries, ["session-restart"])
        assert.deepEqual(archives, ["session-restart"])
        assert.deepEqual(dispatches, [{
            id: "raw-restart",
            dispatch: {mode: "automatic", caseId: "case-recovered"},
        }])
    })
})
