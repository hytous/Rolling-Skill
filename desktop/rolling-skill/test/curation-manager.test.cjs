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

function datasetRubric() {
    return {
        schemaVersion: "rolling-skill-dataset-rubric/v1",
        scoringModel: "unified-100/v1",
        title: "Billing rubric v2",
        summary: "Current billing result quality standard.",
        criteria: [{
            id: "R1",
            title: "Supported billing conclusion",
            criterion: "Return a scoped and evidenced billing conclusion.",
            weight: 1,
            evidenceRequirements: ["Agent answer"],
            scoringAnchors: {
                "0": "Missing",
                "2": "Minimal",
                "5": "Partial",
                "8": "Substantial",
                "10": "Complete",
            },
            criticalFailure: true,
        }],
        automaticFailures: [],
    }
}

function rubricAwareDraft(summary = "Calibrated billing reference.") {
    return {
        schemaVersion: "rolling-skill-curated-case/v2",
        referenceAnswer: {
            summary,
            requiredFacts: ["July is the billing period."],
            requiredSteps: ["Query and verify the billing source."],
            requiredOutputFormat: ["State amount and currency."],
            evidence: [{claim: "The question asks for July.", sourceItemIds: ["user-1"]}],
        },
        rubricCoverage: [{
            criterionId: "R1",
            applicability: "applicable",
            expectation: "Return a supported July billing conclusion.",
            evidenceBasis: "The frozen question and answer require it.",
        }],
        caseSpecificCriteria: [],
        caseAutomaticFailures: [],
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

function frozenDshEvidence() {
    const baseEpisode = buildEpisodeSnapshot(sourceThread(), {
        startItemId: "user-1",
        endItemId: "answer-1",
        traceReference: "dsh-conversation:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    })
    const source = {
        kind: "dsh-session",
        sessionId: "session-1",
        startSeq: 4,
        endSeq: 12,
        endMessageId: "assistant-2",
        digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }
    const episode = {
        ...JSON.parse(JSON.stringify(baseEpisode)),
        source: {...baseEpisode.source, ...source},
    }
    return {episode, source}
}

function billingSkillReference() {
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: "billing-cost-management",
        path: "/Users/wangbaoheng/.codex/plugins/cache/openai-primary-runtime/template-creator/26.812.11052/skills/billing-cost-management/SKILL.md",
        scope: "user",
        description: "Billing cost queries and analysis",
        runtimeId: "codex-alpha",
        confirmedAt: "2026-08-13T00:00:00.000Z",
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
            },
            model: options.model ?? "runtime-default",
            reasoningEffort: options.effort ?? "xhigh",
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
        store.bindDatasetSkill(store.listDatasets()[0].id, billingSkillReference())
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

    it("persists automatic ownership before a Curator starts, without assigning it to manual Drafts", async () => {
        const input = {datasetId: store.listDatasets()[0].id, caseType: "goodcase", ...frozenDshEvidence()}
        const automatic = await manager.createEpisodeSession({...input, automaticCaptureRawCaseId: "raw-owned"})
        const manual = await manager.createEpisodeSession(input)
        const reloaded = new LocalEvaluationStore(join(directory, "store.json"))
        assert.equal(reloaded.getCurationSession(automatic.id).automaticCaptureRawCaseId, "raw-owned")
        assert.equal(reloaded.getCurationSession(manual.id).automaticCaptureRawCaseId, null)
    })

    it("creates a Curator draft from trusted frozen DSH evidence without rereading its source", async () => {
        runtime.readThread = async () => assert.fail("must not read the source Runtime thread")
        const datasetId = store.listDatasets()[0].id
        store.bindDatasetSkill(datasetId, {
            schemaVersion: "rolling-skill-skill-reference/v1",
            evidencePrecision: "managed",
            id: "skill-1",
            repositoryId: "repository-1",
            name: "billing-cost-management",
            path: null,
            scope: "managed",
            description: "Billing cost queries and analysis",
            runtimeId: null,
            providerId: null,
            confirmedAt: "2026-08-27T00:00:00.000Z",
        })
        const {episode, source} = frozenDshEvidence()
        const executionSkillReference = {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: "skill-1",
            repositoryId: "repository-1",
            name: "billing-cost-management",
            path: "/runtime/skills/billing-cost-management/SKILL.md",
            scope: "runtime",
            description: "Billing cost queries and analysis",
            runtimeId: "codex-alpha",
            providerId: "codex",
            confirmedAt: "2026-08-27T01:00:00.000Z",
        }
        const operationEvidence = {
            schemaVersion: "rolling-skill-operation-evidence/v1",
            kind: "curation",
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            commit: "b".repeat(40),
            contentDigest: `sha256:${"c".repeat(64)}`,
            runtime: {runtimeId: "codex-alpha", providerId: "codex"},
            installation: {
                installationId: "installation-1",
                jobId: "job-1",
                destination: "/runtime/skills/billing-cost-management",
                verification: "runtime-inventory",
            },
        }

        const session = await manager.createSessionFromFrozenEpisode({
            datasetId,
            caseType: "goodcase",
            issueDescription: "The answer needs review.",
            episode,
            source,
            executionSkillReference,
            operationEvidence,
            curator: {
                runtimeId: "codex-alpha",
                modelProvider: "openai",
                modelId: "gpt-5.6-sol",
                effort: "high",
            },
            idempotencyKey: "capture:session-1:4:12",
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        assert.equal(persisted.episode.source.digest, source.digest)
        assert.equal(persisted.episode.source.sessionId, source.sessionId)
        assert.equal(persisted.curator.modelId, "gpt-5.6-sol")
        assert.equal(persisted.curator.effort, "high")
        assert.equal(persisted.status, "running")
        assert.equal(persisted.skillReference.path, null)
        assert.deepEqual(persisted.executionSkillReference, executionSkillReference)
        assert.deepEqual(persisted.operationEvidence, operationEvidence)
        assert.equal(runtime.startedTurns[0].text[0].path, executionSkillReference.path)
    })

    it("reuses the persisted frozen-evidence session for one idempotency key", async () => {
        const datasetId = store.listDatasets()[0].id
        const {episode, source} = frozenDshEvidence()
        const input = {
            datasetId,
            caseType: "goodcase",
            episode,
            source,
            curator: {runtimeId: "codex-alpha"},
            idempotencyKey: "capture:session-1:4:12",
        }

        const first = await manager.createSessionFromFrozenEpisode(input)
        const second = await manager.createSessionFromFrozenEpisode(input)

        assert.equal(second.id, first.id)
        assert.equal(store.listCurationSessions().length, 1)
    })

    it("rejects reuse of a frozen-evidence idempotency key for different evidence", async () => {
        const datasetId = store.listDatasets()[0].id
        const first = frozenDshEvidence()
        const idempotencyKey = "capture:session-1:4:12"
        await manager.createSessionFromFrozenEpisode({
            datasetId,
            caseType: "goodcase",
            ...first,
            curator: {runtimeId: "codex-alpha"},
            idempotencyKey,
        })
        const second = frozenDshEvidence()
        second.source.digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        second.episode.source.digest = second.source.digest

        await assert.rejects(
            manager.createSessionFromFrozenEpisode({
                datasetId,
                caseType: "goodcase",
                ...second,
                curator: {runtimeId: "codex-alpha"},
                idempotencyKey,
            }),
            /idempotency key.*different evidence/i,
        )
        assert.equal(store.listCurationSessions().length, 1)
    })

    it("rejects a frozen Episode whose trusted source digest does not match", async () => {
        const datasetId = store.listDatasets()[0].id
        const {episode, source} = frozenDshEvidence()
        source.digest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

        await assert.rejects(
            manager.createSessionFromFrozenEpisode({
                datasetId,
                caseType: "goodcase",
                episode,
                source,
                curator: {runtimeId: "codex-alpha"},
                idempotencyKey: "capture:session-1:mismatch",
            }),
            /source digest does not match/i,
        )
        assert.equal(store.listCurationSessions().length, 0)
    })

    it("rejects frozen DSH evidence with an item missing its stable id", async () => {
        const datasetId = store.listDatasets()[0].id
        const {episode, source} = frozenDshEvidence()
        delete episode.items[0].id

        await assert.rejects(
            manager.createSessionFromFrozenEpisode({
                datasetId,
                caseType: "goodcase",
                episode,
                source,
                curator: {runtimeId: "codex-alpha"},
                idempotencyKey: "capture:session-1:missing-item-id",
            }),
            /item.*stable id/i,
        )
        assert.equal(store.listCurationSessions().length, 0)
    })

    it("rejects a frozen DSH source whose event range is reversed", async () => {
        const datasetId = store.listDatasets()[0].id
        const {episode, source} = frozenDshEvidence()
        source.startSeq = 20
        episode.source.startSeq = 20

        await assert.rejects(
            manager.createSessionFromFrozenEpisode({
                datasetId,
                caseType: "goodcase",
                episode,
                source,
                curator: {runtimeId: "codex-alpha"},
                idempotencyKey: "capture:session-1:reversed-range",
            }),
            /source event range/i,
        )
        assert.equal(store.listCurationSessions().length, 0)
    })

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
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        assert.equal(session.episode.originalQuestion, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(persisted.status, "running")
        assert.equal(persisted.curator.threadId, "curator-1")
        assert.equal(persisted.curator.modelId, "gpt-5.6-sol")
        assert.equal(persisted.curator.effectiveModelId, "gpt-5.6-sol")
        assert.equal(persisted.curator.effectiveEffort, "xhigh")
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

    it("starts Case calibration from frozen history and includes the current summary and rubric", async () => {
        const datasetId = store.listDatasets()[0].id
        const sourceSession = store.createCurationSession({
            datasetId,
            caseType: "goodcase",
            episode: buildEpisodeSnapshot(sourceThread(), {endItemId: "answer-1"}),
            curator: {},
        })
        store.recordCurationRevision(sourceSession.id, {
            draft: validDraft("Existing saved summary."),
            assistantText: "original curation",
        })
        const saved = store.archiveCurationSession(sourceSession.id)
        const raw = store.load()
        const version = {
            id: "rubric-v2",
            datasetId,
            version: 2,
            rubric: datasetRubric(),
            rubricDigest: "sha256:test",
            publishedAt: "2026-08-14T00:00:00.000Z",
        }
        raw.datasetRubricVersions.push(version)
        raw.datasets[0].activeRubricVersionId = version.id
        raw.cases[0].rubricCalibration = {
            status: "needed",
            rubricVersionId: version.id,
            previousRubricVersionId: null,
        }
        store.persist()
        runtime.readThread = async () => {
            throw new Error("Calibration must reuse frozen Case evidence")
        }

        const session = await manager.createCalibrationSession({
            datasetId,
            caseId: saved.id,
            modelId: "gpt-5.6-sol",
            effort: "high",
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        const prompt = runtime.startedTurns.at(-1).text.at(-1).text
        assert.equal(persisted.operation, "calibration")
        assert.equal(persisted.targetCaseId, saved.id)
        assert.match(prompt, /calibration of an existing saved Case/i)
        assert.match(prompt, /Existing saved summary\./)
        assert.match(prompt, /Billing rubric v2/)
        assert.match(prompt, /查一下7月份账单，各业务混元3多少成本？/)

        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: persisted.curator.threadId,
                turn: {
                    id: persisted.curator.currentTurnId,
                    status: "completed",
                    items: [{
                        id: "calibrated-draft",
                        type: "agentMessage",
                        text: `\`\`\`json\n${JSON.stringify(rubricAwareDraft())}\n\`\`\``,
                    }],
                },
            },
        })
        const calibrated = await manager.archive(session.id)
        assert.equal(calibrated.id, saved.id)
        assert.equal(calibrated.rubricVersionId, version.id)
        assert.equal(calibrated.rubricCalibration.status, "current")
        assert.equal(store.listCases(datasetId).length, 1)
    })

    it("starts a refresh Draft from new replay evidence and a historical Case baseline", async () => {
        const datasetId = store.listDatasets()[0].id
        const sourceSession = store.createCurationSession({
            datasetId,
            caseType: "goodcase",
            episode: buildEpisodeSnapshot(sourceThread(), {endItemId: "answer-1"}),
            curator: {},
        })
        store.recordCurationRevision(sourceSession.id, {
            draft: validDraft("Historical saved summary."),
            assistantText: "original curation",
        })
        const saved = store.archiveCurationSession(sourceSession.id)
        const replayThread = sourceThread()
        replayThread.id = "refresh-replay-thread"
        replayThread.turns[0].items.at(-1).text = "current result"
        const replayEpisode = buildEpisodeSnapshot(replayThread, {
            endItemId: "answer-1",
            runtimeId: "codex-alpha",
        })

        const session = await manager.createRefreshSession({
            datasetId,
            caseId: saved.id,
            episode: replayEpisode,
            modelId: "gpt-5.6-sol",
            effort: "high",
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        const prompt = runtime.startedTurns.at(-1).text.at(-1).text
        assert.equal(persisted.operation, "refresh")
        assert.equal(persisted.targetCaseId, saved.id)
        assert.equal(persisted.episode.source.threadId, "refresh-replay-thread")
        assert.match(prompt, /historical[\s\S]*not current truth/iu)
        assert.match(prompt, /Historical saved summary\./u)
        assert.match(prompt, /immutable evaluation question/iu)
    })

    it("drops high-frequency response deltas before copying the frozen calibration session", async () => {
        const datasetId = store.listDatasets()[0].id
        const sourceSession = store.createCurationSession({
            datasetId,
            caseType: "goodcase",
            episode: buildEpisodeSnapshot(sourceThread(), {endItemId: "answer-1"}),
            curator: {},
        })
        store.recordCurationRevision(sourceSession.id, {
            draft: validDraft("Existing saved summary."),
            assistantText: "original curation",
        })
        const saved = store.archiveCurationSession(sourceSession.id)
        const raw = store.load()
        const version = {
            id: "rubric-v2",
            datasetId,
            version: 2,
            rubric: datasetRubric(),
            rubricDigest: "sha256:test",
            publishedAt: "2026-08-14T00:00:00.000Z",
        }
        raw.datasetRubricVersions.push(version)
        raw.datasets[0].activeRubricVersionId = version.id
        raw.cases[0].rubricCalibration = {
            status: "needed",
            rubricVersionId: version.id,
            previousRubricVersionId: null,
        }
        store.persist()

        const session = await manager.createCalibrationSession({
            datasetId,
            caseId: saved.id,
        })
        await manager.waitForIdle(session.id)
        const running = store.getCurationSession(session.id)
        const getCurationSession = store.getCurationSession.bind(store)
        let sessionCopies = 0
        store.getCurationSession = (...args) => {
            sessionCopies += 1
            return getCurationSession(...args)
        }

        const handled = await manager.handleNotification({
            method: "item/agentMessage/delta",
            params: {
                threadId: running.curator.threadId,
                turnId: running.curator.currentTurnId,
                delta: "streamed calibration fragment",
            },
        })

        assert.equal(handled, false)
        assert.equal(sessionCopies, 0)
    })

    it("keeps requested settings separate from runtime-effective settings", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)

        let persisted = store.getCurationSession(session.id)
        assert.equal(persisted.curator.modelId, null)
        assert.equal(persisted.curator.effort, null)
        assert.equal(persisted.curator.effectiveModelId, "runtime-default")
        assert.equal(persisted.curator.effectiveEffort, "xhigh")

        await manager.handleNotification({
            method: "thread/settings/updated",
            params: {
                threadId: "curator-1",
                threadSettings: {model: "gpt-5.6-sol", effort: "max"},
            },
        })
        persisted = store.getCurationSession(session.id)
        assert.equal(persisted.curator.modelId, null)
        assert.equal(persisted.curator.effort, null)
        assert.equal(persisted.curator.effectiveModelId, "gpt-5.6-sol")
        assert.equal(persisted.curator.effectiveEffort, "max")
    })

    it("emits compact live activity without command output or response deltas", async () => {
        const activity = []
        manager = new CurationManager({
            store,
            getRuntime: async () => runtime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            onChanged: (session) => changed.push(session),
            onActivity: (entry) => activity.push(entry),
            schedule: (task) => task(),
        })
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)

        await manager.handleNotification({
            method: "item/started",
            params: {
                threadId: "curator-1",
                turnId: "curator-turn-1",
                item: {
                    type: "commandExecution",
                    commandActions: [{command: `sed ${"x".repeat(400)}`}],
                    aggregatedOutput: "huge-noisy-shell-output",
                },
            },
        })
        await manager.handleNotification({
            method: "item/agentMessage/delta",
            params: {
                threadId: "curator-1",
                turnId: "curator-turn-1",
                delta: "private streamed answer",
            },
        })

        const latest = activity.at(-1)
        assert.equal(latest.sessionId, session.id)
        assert.equal(latest.stage, "command")
        assert.ok(latest.summary.length <= 240)
        assert.equal(JSON.stringify(activity).includes("huge-noisy-shell-output"), false)
        assert.equal(JSON.stringify(activity).includes("private streamed answer"), false)
    })

    it("coalesces repeated Curator reasoning activity before it crosses IPC", async () => {
        const activity = []
        const scheduledActivity = []
        manager = new CurationManager({
            store,
            getRuntime: async () => runtime,
            getRuntimeDescriptor: () => ({runtimeId: "codex-alpha"}),
            onChanged: (session) => changed.push(session),
            onActivity: (entry) => activity.push(entry),
            schedule: (task) => task(),
            scheduleActivity(callback, delayMs) {
                const timer = {callback, delayMs}
                scheduledActivity.push(timer)
                return timer
            },
            cancelActivity() {},
        })
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        const running = store.getCurationSession(session.id)
        activity.length = 0
        scheduledActivity.length = 0

        for (let index = 0; index < 100; index += 1) {
            await manager.handleNotification({
                method: "item/started",
                params: {
                    threadId: running.curator.threadId,
                    turnId: running.curator.currentTurnId,
                    item: {type: "reasoning", summary: [`chunk-${index}`]},
                },
            })
        }

        assert.equal(activity.length, 0)
        assert.equal(scheduledActivity.length, 1)
        assert.equal(scheduledActivity[0].delayMs, 250)
        scheduledActivity[0].callback()
        assert.equal(activity.length, 1)
        assert.equal(activity[0].stage, "analyzing")
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

    it("uses an optional issue description without replacing the original evaluation question", async () => {
        const datasetId = store.listDatasets()[0].id
        const issueDescription = "回答只给了总成本，没有按业务拆分，也没有证据。"
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            startItemId: "user-1",
            endItemId: "answer-1",
            issueDescription,
        })
        await manager.waitForIdle(session.id)

        const persisted = store.getCurationSession(session.id)
        assert.equal(persisted.episode.originalQuestion, "查一下7月份账单，各业务混元3多少成本？")
        assert.equal(persisted.issueDescription, issueDescription)
        const initialPrompt = runtime.startedTurns[0].text.at(-1).text
        assert.match(initialPrompt, new RegExp(issueDescription))
        assert.match(initialPrompt, /查一下7月份账单，各业务混元3多少成本？/)

        await completeInitialDraft(manager, store, persisted)
        const saved = await manager.archive(session.id)
        assert.equal(saved.question, persisted.episode.originalQuestion)
        assert.equal(saved.issueDescription, issueDescription)
        assert.equal(saved.source.originalQuestion, persisted.episode.originalQuestion)
    })

    it("inherits the dataset Skill without accepting an operation override", async () => {
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

        const session = await manager.createSession({
                datasetId: store.listDatasets()[0].id,
                caseType: "badcase",
                sourceThreadId: "source-thread",
                endItemId: "answer-1",
                skillPath: "/runtime/skills/billing-cost-management/SKILL.md",
            })
        await manager.waitForIdle(session.id)
        assert.deepEqual(session.skillReference, billingSkillReference())
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
        assert.deepEqual(saved.skillReference, billingSkillReference())
        assert.equal(store.getCurationSession(session.id).status, "archived")
        assert.deepEqual(runtime.archivedThreads, ["curator-1"])
    })

    it("keeps the last valid draft reviewable when a follow-up is conversational", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "补充查询计划")
        const revising = store.getCurationSession(session.id)

        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: revising.curator.currentTurnId,
                    status: "completed",
                    items: [{id: "invalid", type: "agentMessage", text: "只有说明，没有契约 JSON。"}],
                },
            },
        })

        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "needs_review")
        assert.equal(recovered.draft.referenceAnswer.summary, "Use the verified billing result.")
        assert.equal(recovered.error, null)
        assert.equal(recovered.conversation.at(-1).role, "assistant")
    })

    it("keeps the last valid draft and explains an invalid attempted revision", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "请修改参考答案")
        const revising = store.getCurationSession(session.id)

        await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: revising.curator.currentTurnId,
                    status: "completed",
                    items: [{
                        id: "invalid-contract",
                        type: "agentMessage",
                        text: "```json\n{\"schemaVersion\":\"wrong\",\"referenceAnswer\":{}}\n```",
                    }],
                },
            },
        })

        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "needs_review")
        assert.equal(recovered.draft.referenceAnswer.summary, "Use the verified billing result.")
        assert.match(recovered.error, /not applied/i)
    })

    it("keeps the last valid draft saveable when a follow-up runtime turn fails", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "请解释一下这个参考答案")

        await manager.handleNotification({
            method: "error",
            params: {
                threadId: "curator-1",
                willRetry: false,
                error: {message: "runtime disconnected"},
            },
        })

        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "needs_review")
        assert.equal(recovered.draft.referenceAnswer.summary, "Use the verified billing result.")
        assert.match(recovered.error, /runtime disconnected/)
        assert.equal(recovered.curator.currentTurnId, null)
    })

    it("does not apply a draft carried by a failed completed turn", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "请修改参考答案")
        const revising = store.getCurationSession(session.id)

        await manager.handleNotification({
            method: "error",
            params: {
                threadId: "curator-1",
                turnId: revising.curator.currentTurnId,
                willRetry: false,
                error: {message: "CodeBuddy prompt failed"},
            },
        })
        const handledCompletion = await manager.handleNotification({
            method: "turn/completed",
            params: {
                threadId: "curator-1",
                turn: {
                    id: revising.curator.currentTurnId,
                    status: "failed",
                    error: {message: "CodeBuddy prompt failed"},
                    items: [{
                        id: "partial-contract",
                        type: "agentMessage",
                        text: `\`\`\`json\n${JSON.stringify(validDraft("Must not be applied"))}\n\`\`\``,
                    }],
                },
            },
        })

        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "needs_review")
        assert.equal(recovered.draft.referenceAnswer.summary, "Use the verified billing result.")
        assert.equal(recovered.revisions.length, 1)
        assert.match(recovered.error, /CodeBuddy prompt failed/)
        assert.equal(handledCompletion, false)
    })

    it("ignores a stale runtime error from a previous Curator turn", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "请修改参考答案")
        const revising = store.getCurationSession(session.id)

        const handled = await manager.handleNotification({
            method: "error",
            params: {
                threadId: "curator-1",
                turnId: "older-turn",
                willRetry: false,
                error: {message: "stale error"},
            },
        })

        const current = store.getCurationSession(session.id)
        assert.equal(handled, false)
        assert.equal(current.status, "running")
        assert.equal(current.curator.currentTurnId, revising.curator.currentTurnId)
        assert.equal(current.error, null)
    })

    it("restores an interrupted follow-up with a valid draft as reviewable on restart", async () => {
        const session = await manager.createSession({
            datasetId: store.listDatasets()[0].id,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
        })
        await manager.waitForIdle(session.id)
        await completeInitialDraft(manager, store, session)
        await manager.sendMessage(session.id, "请解释一下这个参考答案")

        new CurationManager({store, getRuntime: async () => runtime})

        const recovered = store.getCurationSession(session.id)
        assert.equal(recovered.status, "needs_review")
        assert.equal(recovered.draft.referenceAnswer.summary, "Use the verified billing result.")
        assert.match(recovered.error, /interrupted/i)
        assert.equal(recovered.curator.currentTurnId, null)
    })

    it("isolates malformed Curator output and can retry it without changing the source", async () => {
        const datasetId = store.listDatasets()[0].id
        const issueDescription = "回答出现了未经诊断的重复调用。"
        const session = await manager.createSession({
            datasetId,
            caseType: "goodcase",
            sourceThreadId: "source-thread",
            endItemId: "answer-1",
            issueDescription,
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
        assert.equal(failed.issueDescription, issueDescription)

        await manager.retry(session.id)
        const retried = store.getCurationSession(session.id)
        assert.equal(retried.status, "running")
        assert.match(runtime.startedTurns.at(-1).text, /previous response did not satisfy/i)
        assert.match(runtime.startedTurns.at(-1).text, new RegExp(issueDescription))
        assert.match(runtime.startedTurns.at(-1).text, /original user.*immutable evaluation input/is)
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
