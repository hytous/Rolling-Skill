const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {LocalEvaluationStore} = require("../src/local-store.cjs")
const {CURATED_CASE_SCHEMA} = require("../src/episode-curation.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-store-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "evaluation-store.json")
    return {path, store: new LocalEvaluationStore(path)}
}

function episode(question = "帮我随便看看这个账单呗？") {
    return {
        schemaVersion: "rolling-skill-episode/v1",
        originalQuestion: question,
        source: {
            threadId: "thread-source",
            startTurnId: "turn-1",
            startItemId: "user-1",
            endTurnId: "turn-1",
            endItemId: "agent-2",
            runtimeId: "codex:source",
            modelProvider: "openai",
            modelId: null,
            traceReference: "trace://source.jsonl#L10",
        },
        items: [
            {id: "user-1", turnId: "turn-1", type: "userMessage", text: question},
            {id: "agent-2", turnId: "turn-1", type: "agentMessage", text: "结果"},
        ],
        toolActivity: [],
        capturedAt: "2026-08-11T00:00:00.000Z",
    }
}

function curatedDraft() {
    return {
        schemaVersion: CURATED_CASE_SCHEMA,
        referenceAnswer: {
            summary: "给出账单结论。",
            requiredFacts: ["包含实际数值"],
            requiredSteps: ["查询账单"],
            requiredOutputFormat: ["数值必须带币种"],
            evidence: [],
        },
        grading: {
            hardRequirements: [
                {
                    id: "H1",
                    criterion: "数值有币种",
                    passCondition: "每个数值都标明币种",
                    evidenceBasis: "账单结果需要可解释",
                },
            ],
            softCriteria: [],
            automaticFailures: ["缺少账单结论"],
        },
        badCaseAnalysis: null,
    }
}

function skillReference(path = "/skills/billing/SKILL.md", name = "billing-cost-management") {
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name,
        path,
        scope: "user",
        description: "Billing cost queries and analysis",
        runtimeId: "codex-alpha",
        confirmedAt: "2026-08-13T00:00:00.000Z",
    }
}

describe("local evaluation store", () => {
    it("starts with manual capture disabled and a default dataset", () => {
        const {store} = fixture()
        const snapshot = store.read()
        assert.equal(snapshot.settings.autoCapture, false)
        assert.equal(snapshot.settings.language, "zh-CN")
        assert.equal(snapshot.settings.theme, "codex-light")
        assert.equal(snapshot.settings.localAccess, "full")
        assert.deepEqual(snapshot.settings.taskProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
        assert.deepEqual(snapshot.settings.curatorProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
        assert.deepEqual(snapshot.settings.judgeProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
        assert.deepEqual(snapshot.settings.autoCaptureProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
            datasetId: null,
            caseType: "goodcase",
        })
        assert.equal(snapshot.datasets.length, 1)
        assert.equal(snapshot.datasets[0].name, "Skill evaluation cases")
        assert.equal(snapshot.datasets[0].skillReference, null)
        assert.deepEqual(snapshot.cases, [])
        assert.deepEqual(snapshot.curationSessions, [])
        assert.deepEqual(snapshot.evaluationRuns, [])
    })

    it("requires one Skill binding when a dataset is created", () => {
        const {store} = fixture()

        assert.throws(
            () => store.createDataset({name: "Unbound", skillReference: null}),
            /dataset.*skill|skill.*required/i,
        )
        const created = store.createDataset({
            name: "Billing regression",
            skillReference: skillReference(),
        })

        assert.deepEqual(created.skillReference, skillReference())
        assert.deepEqual(store.getDataset(created.id).skillReference, skillReference())
    })

    it("persists the trusted managed Skill and Runtime identity on a path binding", () => {
        const {path, store} = fixture()
        const managedReference = {
            ...skillReference("/managed/repository-1/skills/billing", "billing"),
            id: "skill-1",
            providerId: "codex",
            repositoryId: "repository-1",
        }

        const created = store.createDataset({
            name: "Managed billing regression",
            skillReference: managedReference,
        })

        assert.deepEqual(created.skillReference, managedReference)
        assert.deepEqual(
            new LocalEvaluationStore(path).getDataset(created.id).skillReference,
            managedReference,
        )
    })

    it("persists a complete name-only Runtime Skill identity without weakening path validation", () => {
        const {path, store} = fixture()
        const nameOnlyReference = {
            schemaVersion: "rolling-skill-skill-reference/v1",
            name: "deepseek-billing",
            path: null,
            scope: "runtime",
            description: "Discovered by the DeepSeek Harness provider",
            runtimeId: "deepseek-harness:local",
            providerId: "deepseek-harness",
            workspaceRoot: "/workspace/project",
            evidencePrecision: "name-only",
            confirmedAt: "2026-08-23T00:00:00.000Z",
        }

        const created = store.createDataset({
            name: "Name-only regression",
            skillReference: nameOnlyReference,
        })

        assert.deepEqual(created.skillReference, nameOnlyReference)
        assert.deepEqual(
            new LocalEvaluationStore(path).getDataset(created.id).skillReference,
            nameOnlyReference,
        )
        const persisted = JSON.parse(readFileSync(path, "utf8"))
        persisted.datasets.find((dataset) => dataset.id === created.id).activeRubricVersionId =
            "published-for-original-identity"
        writeFileSync(path, `${JSON.stringify(persisted)}\n`)
        const rebound = new LocalEvaluationStore(path).bindDatasetSkill(created.id, {
            ...nameOnlyReference,
            workspaceRoot: "/workspace/other",
        })
        assert.equal(rebound.activeRubricVersionId, null)
        assert.throws(
            () => store.createDataset({
                name: "Missing path",
                skillReference: {
                    ...skillReference(),
                    path: null,
                },
            }),
            /absolute path/i,
        )
        for (const missing of ["providerId", "runtimeId", "workspaceRoot"]) {
            assert.throws(
                () => store.createDataset({
                    name: `Missing ${missing}`,
                    skillReference: {...nameOnlyReference, [missing]: null},
                }),
                /name-only.*identity|identity.*required/i,
            )
        }
    })

    it("migrates a unique legacy Case Skill to its dataset without rewriting the Case", () => {
        const {path} = fixture()
        const reference = skillReference()
        writeFileSync(path, `${JSON.stringify({
            schemaVersion: "rolling-skill-local/v6",
            settings: {autoCapture: false},
            datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
            cases: [{
                id: "case-old",
                datasetId: "dataset-old",
                caseType: "goodcase",
                question: "q",
                answer: "a",
                skillReference: reference,
            }],
            curationSessions: [],
            evaluationRuns: [],
        })}\n`)

        const migrated = new LocalEvaluationStore(path).read()

        assert.equal(migrated.schemaVersion, "rolling-skill-local/v11")
        assert.deepEqual(migrated.datasets[0].skillReference, reference)
        assert.deepEqual(migrated.cases[0].skillReference, reference)
    })

    it("leaves a legacy dataset unbound when its Case Skills conflict", () => {
        const {path} = fixture()
        writeFileSync(path, `${JSON.stringify({
            schemaVersion: "rolling-skill-local/v6",
            settings: {autoCapture: false},
            datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
            cases: [
                {id: "one", datasetId: "dataset-old", skillReference: skillReference("/skills/a/SKILL.md", "a")},
                {id: "two", datasetId: "dataset-old", skillReference: skillReference("/skills/b/SKILL.md", "b")},
            ],
            curationSessions: [],
            evaluationRuns: [],
        })}\n`)

        const migrated = new LocalEvaluationStore(path).read()

        assert.equal(migrated.datasets[0].skillReference, null)
    })

    it("copies the dataset Skill into a Curator session and ignores caller overrides", () => {
        const {store} = fixture()
        const dataset = store.bindDatasetSkill(store.listDatasets()[0].id, skillReference())

        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            skillReference: skillReference("/skills/wrong/SKILL.md", "wrong"),
            curator: {},
        })

        assert.deepEqual(session.skillReference, skillReference())
    })

    it("stores an optional Curator model override without enabling automatic capture", () => {
        const {store} = fixture()
        assert.deepEqual(store.updateCuratorProfile({modelId: "  gpt-5.6-sol  "}), {
            runtimePolicy: "active",
            modelId: "gpt-5.6-sol",
            effort: null,
        })
        assert.equal(store.read().settings.autoCapture, false)
        assert.equal(store.updateCuratorProfile({modelId: ""}).modelId, null)
    })

    it("persists appearance, task model, and opt-in automatic capture settings", () => {
        const {store} = fixture()
        const dataset = store.listDatasets()[0]

        const settings = store.updateSettings({
            language: "en",
            theme: "codex-dark",
            localAccess: "workspace",
            taskModelId: " gpt-5.6-sol ",
            judgeModelId: " gpt-5.6-sol-judge ",
            judgeEffort: "max",
            autoCapture: true,
            autoCaptureModelId: " gpt-5.6-terra ",
            autoCaptureDatasetId: dataset.id,
            autoCaptureCaseType: "badcase",
        })

        assert.equal(settings.language, "en")
        assert.equal(settings.theme, "codex-dark")
        assert.equal(settings.localAccess, "workspace")
        assert.equal(settings.taskProfile.modelId, "gpt-5.6-sol")
        assert.deepEqual(settings.judgeProfile, {
            runtimePolicy: "active",
            modelId: "gpt-5.6-sol-judge",
            effort: "max",
        })
        assert.equal(settings.autoCapture, true)
        assert.deepEqual(settings.autoCaptureProfile, {
            runtimePolicy: "active",
            modelId: "gpt-5.6-terra",
            effort: null,
            datasetId: dataset.id,
            caseType: "badcase",
        })
        assert.throws(() => store.updateSettings({language: "fr"}), /language/i)
        assert.throws(() => store.updateSettings({theme: "neon"}), /theme/i)
        assert.throws(() => store.updateSettings({localAccess: "container"}), /local access/i)
        assert.throws(() => store.updateSettings({judgeEffort: "impossible"}), /effort/i)
    })

    it("migrates existing stores to full local access without changing other settings", () => {
        const {path} = fixture()
        const legacy = new LocalEvaluationStore(path).read()
        delete legacy.settings.localAccess
        delete legacy.settings.judgeProfile
        writeFileSync(path, `${JSON.stringify(legacy, null, 2)}\n`)

        const migrated = new LocalEvaluationStore(path).read()

        assert.equal(migrated.settings.localAccess, "full")
        assert.deepEqual(migrated.settings.judgeProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
        assert.equal(migrated.settings.language, "zh-CN")
        assert.equal(JSON.parse(readFileSync(path, "utf8")).settings.localAccess, "full")
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).settings.judgeProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
    })

    it("atomically persists a classified case with full local provenance", () => {
        const {path, store} = fixture()
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        const saved = store.saveCase({
            datasetId: dataset.id,
            caseType: "badcase",
            question: "Why did the Skill not run?",
            answer: "The runtime skipped it.",
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            runtimeId: "codex:local",
            traceReference: "trace://runtime/session.jsonl#42",
        })

        assert.equal(saved.caseType, "badcase")
        assert.equal(saved.source.threadId, "thread-1")
        assert.equal(saved.source.runtimeId, "codex:local")
        assert.equal(saved.source.traceReference, "trace://runtime/session.jsonl#42")
        const disk = JSON.parse(readFileSync(path, "utf8"))
        assert.equal(disk.cases.length, 1)
        assert.equal(disk.cases[0].answer, "The runtime skipped it.")
    })

    it("rejects invalid classifications and unknown datasets", () => {
        const {store} = fixture()
        assert.throws(
            () =>
                store.saveCase({
                    datasetId: "missing",
                    caseType: "goodcase",
                    question: "q",
                    answer: "a",
                }),
            /dataset/i,
        )
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        assert.throws(
            () =>
                store.saveCase({
                    datasetId: dataset.id,
                    caseType: "maybe",
                    question: "q",
                    answer: "a",
                }),
            /case type/i,
        )
        assert.throws(
            () =>
                store.saveCase({
                    datasetId: dataset.id,
                    caseType: "badcase",
                    question: " ",
                    answer: "a",
                }),
            /question/i,
        )
        assert.throws(
            () =>
                store.saveCase({
                    datasetId: dataset.id,
                    caseType: "badcase",
                    question: "q",
                    answer: " ",
                }),
            /answer/i,
        )
    })

    it("creates named datasets and reports counts", () => {
        const {store} = fixture()
        const dataset = store.createDataset({name: "Billing Skill regression", skillReference: skillReference()})
        store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "q",
            answer: "a",
        })
        const summary = store.listDatasets().find((entry) => entry.id === dataset.id)
        assert.equal(summary.caseCount, 1)
        assert.equal(summary.goodcaseCount, 1)
        assert.equal(summary.badcaseCount, 0)
    })

    it("lists the curated cases that belong to one dataset", () => {
        const {store} = fixture()
        const first = store.createDataset({name: "First", skillReference: skillReference()})
        const second = store.createDataset({name: "Second", skillReference: skillReference()})
        const saved = store.saveCase({
            datasetId: first.id,
            caseType: "goodcase",
            question: "自然语言问题",
            answer: "参考答案",
        })
        store.saveCase({
            datasetId: second.id,
            caseType: "badcase",
            question: "另一个问题",
            answer: "另一个答案",
        })

        assert.deepEqual(store.listCases(first.id).map((entry) => entry.id), [saved.id])
        assert.throws(() => store.listCases("missing"), /dataset/i)
    })

    it("migrates v1 data without rewriting existing cases", () => {
        const {path} = fixture()
        writeFileSync(
            path,
            `${JSON.stringify({
                schemaVersion: "rolling-skill-local/v1",
                settings: {autoCapture: false},
                datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
                cases: [{id: "case-old", datasetId: "dataset-old", question: "q", answer: "a"}],
            })}\n`,
        )
        const migrated = new LocalEvaluationStore(path).read()

        assert.equal(migrated.schemaVersion, "rolling-skill-local/v11")
        assert.equal(migrated.cases[0].id, "case-old")
        assert.deepEqual(migrated.cases[0].source.originalAssistantMessages, [
            {role: "assistant", content: "a"},
        ])
        assert.deepEqual(migrated.curationSessions, [])
        assert.equal(migrated.settings.curatorProfile.runtimePolicy, "active")
    })

    it("migrates autofilled dataset questions away without changing source evidence", () => {
        const {path} = fixture()
        const sourceEpisode = episode("原始自然语言问题")
        writeFileSync(
            path,
            `${JSON.stringify({
                schemaVersion: "rolling-skill-local/v4",
                settings: {autoCapture: false},
                datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
                cases: [],
                curationSessions: [
                    {
                        id: "curation-old",
                        datasetId: "dataset-old",
                        caseType: "goodcase",
                        status: "failed",
                        episode: sourceEpisode,
                        curator: {modelId: "gpt-old", effort: "max"},
                    },
                ],
                evaluationRuns: [],
            })}\n`,
        )

        const migrated = new LocalEvaluationStore(path).read()
        assert.equal(migrated.curationSessions[0].issueDescription, "")
        assert.equal("datasetQuestion" in migrated.curationSessions[0], false)
        assert.equal(migrated.curationSessions[0].episode.originalQuestion, "原始自然语言问题")
        assert.equal(migrated.curationSessions[0].curator.effectiveModelId, null)
        assert.equal(migrated.curationSessions[0].curator.effectiveEffort, null)
    })

    it("restores legacy edited Case questions and preserves the edit as issue context", () => {
        const {path} = fixture()
        writeFileSync(path, `${JSON.stringify({
            schemaVersion: "rolling-skill-local/v5",
            settings: {autoCapture: false},
            datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
            cases: [{
                id: "case-old",
                datasetId: "dataset-old",
                caseType: "badcase",
                question: "回答无诊断地重复调用了三次。",
                answer: "analysis",
                source: {
                    originalQuestion: "查一下七月各业务成本。",
                    curationSessionId: "curation-old",
                },
            }],
            curationSessions: [{
                id: "curation-old",
                caseId: "case-old",
                datasetId: "dataset-old",
                status: "archived",
                episode: {
                    items: [
                        {id: "agent-1", type: "agentMessage", text: "先查一下。"},
                        {id: "agent-2", type: "agentMessage", text: "原始回答。"},
                    ],
                },
                curator: {},
            }],
            evaluationRuns: [],
        })}\n`)

        const migrated = new LocalEvaluationStore(path).read().cases[0]
        assert.equal(migrated.question, "查一下七月各业务成本。")
        assert.equal(migrated.issueDescription, "回答无诊断地重复调用了三次。")
        assert.deepEqual(migrated.source.originalAssistantMessages, [
            {role: "assistant", content: "先查一下。"},
            {role: "assistant", content: "原始回答。"},
        ])
    })

    it("migrates legacy evaluation runs to ungraded Judge-compatible results", () => {
        const {path} = fixture()
        writeFileSync(
            path,
            `${JSON.stringify({
                schemaVersion: "rolling-skill-local/v4",
                settings: {autoCapture: false},
                datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
                cases: [],
                curationSessions: [],
                evaluationRuns: [
                    {
                        id: "run-old",
                        datasetId: "dataset-old",
                        results: [{id: "result-old", status: "completed", response: "answer"}],
                    },
                ],
            })}\n`,
        )

        const migrated = new LocalEvaluationStore(path).read()
        const run = migrated.evaluationRuns[0]
        assert.equal(run.judgeProfile, null)
        assert.equal(run.judgeConfiguration, null)
        assert.deepEqual(run.results[0], {
            id: "result-old",
            status: "completed",
            response: "answer",
            gradingStatus: "not_requested",
            scoreContract: null,
            judgment: null,
            computedScore: null,
            judge: null,
            traceEvidence: null,
            gradingError: null,
            gradingQueuedAt: null,
            gradingStartedAt: null,
            gradingCompletedAt: null,
        })
        const persisted = JSON.parse(readFileSync(path, "utf8")).evaluationRuns[0]
        assert.equal(persisted.judgeProfile, null)
        assert.equal(persisted.judgeConfiguration, null)
        assert.equal(persisted.results[0].gradingStatus, "not_requested")
    })

    it("does not strand a malformed v5 completed result in the grading queue", () => {
        const {path} = fixture()
        writeFileSync(path, `${JSON.stringify({
            schemaVersion: "rolling-skill-local/v5",
            settings: {autoCapture: false},
            datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
            cases: [],
            curationSessions: [],
            evaluationRuns: [{
                id: "run-old",
                datasetId: "dataset-old",
                judgeConfiguration: null,
                results: [{id: "result-old", status: "completed", response: "answer"}],
            }],
        })}\n`)

        const result = new LocalEvaluationStore(path).read().evaluationRuns[0].results[0]
        assert.equal(result.gradingStatus, "not_requested")
    })

    it("does not strand a completed malformed v5 result even when a Judge was configured", () => {
        const {path} = fixture()
        writeFileSync(path, `${JSON.stringify({
            schemaVersion: "rolling-skill-local/v5",
            settings: {autoCapture: false},
            datasets: [{id: "dataset-old", name: "Old", createdAt: "then"}],
            cases: [],
            curationSessions: [],
            evaluationRuns: [{
                id: "run-old",
                datasetId: "dataset-old",
                status: "completed",
                judgeConfiguration: {runtimeId: "judge"},
                results: [{id: "result-old", status: "completed", response: "answer"}],
            }],
        })}\n`)

        const result = new LocalEvaluationStore(path).read().evaluationRuns[0].results[0]
        assert.equal(result.gradingStatus, "not_requested")
    })

    it("preserves an optional issue description and accepts blank input", () => {
        const {store} = fixture()
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        const issueDescription = "  回答遗漏了两个业务线  \n"

        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            issueDescription,
            episode: episode("不可变的原始问题"),
            curator: {},
        })

        assert.equal(session.issueDescription, issueDescription)
        const blank = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            issueDescription: " \n\t ",
            episode: episode("不可变的原始问题"),
            curator: {},
        })
        assert.equal(blank.issueDescription, "")
    })

    it("persists a reviewable curation conversation and archives one approved revision", () => {
        const {store} = fixture()
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        const question = "帮我随便看看这个账单呗？  别漏啦"
        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(question),
            curator: {
                runtimeId: "codex:curator",
                modelProvider: "openai",
                modelId: "gpt-requested",
                effort: "max",
                effectiveModelId: "gpt-effective",
                effectiveEffort: "xhigh",
                promptVersion: "rolling-skill-curator/v1",
            },
        })

        assert.equal(session.status, "queued")
        assert.equal(session.episode.originalQuestion, question)
        assert.equal(session.skillReference.name, "billing-cost-management")
        store.updateCurationSession(session.id, {
            status: "running",
            curator: {threadId: "thread-curator", currentTurnId: "turn-curator-1"},
        })
        store.appendCurationMessage(session.id, {
            role: "user",
            text: "请让硬判定更明确。",
            turnId: "turn-curator-2",
        })
        const reviewed = store.recordCurationRevision(session.id, {
            draft: curatedDraft(),
            assistantText: "已经补充硬判定。",
            turnId: "turn-curator-2",
        })

        assert.equal(reviewed.status, "needs_review")
        assert.equal(reviewed.revisions.length, 1)
        assert.deepEqual(
            reviewed.conversation.map((message) => message.role),
            ["user", "assistant"],
        )

        const saved = store.archiveCurationSession(session.id)
        const archived = store.getCurationSession(session.id)

        assert.equal(saved.question, question)
        assert.match(saved.answer, /## Hard requirements/)
        assert.equal(saved.curated.schemaVersion, CURATED_CASE_SCHEMA)
        assert.equal(saved.source.curationSessionId, session.id)
        assert.equal(saved.source.startItemId, "user-1")
        assert.equal(saved.skillReference.name, "billing-cost-management")
        assert.equal(saved.source.skillRuntimeId, "codex-alpha")
        assert.equal(saved.source.skillName, "billing-cost-management")
        assert.equal(saved.source.curatorModelId, "gpt-requested")
        assert.equal(saved.source.curatorEffort, "max")
        assert.equal(saved.source.curatorEffectiveModelId, "gpt-effective")
        assert.equal(saved.source.curatorEffectiveEffort, "xhigh")
        assert.deepEqual(saved.source.originalAssistantMessages, [
            {role: "assistant", content: "结果"},
        ])
        assert.equal(archived.status, "archived")
        assert.equal(archived.caseId, saved.id)
    })

    it("does not archive a curation session before a valid draft exists", () => {
        const {store} = fixture()
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "badcase",
            episode: episode(),
            curator: {runtimeId: "codex:local"},
        })

        assert.throws(() => store.archiveCurationSession(session.id), /valid.*draft|review/i)
        assert.equal(store.read().cases.length, 0)
    })

    it("changes an editable Curator model and cancels a discarded draft without saving a case", () => {
        const {store} = fixture()
        const dataset = store.read().datasets[0]
        store.bindDatasetSkill(dataset.id, skillReference())
        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {runtimeId: "codex:local", modelId: "gpt-5.6-sol"},
        })

        const changed = store.updateCurationModel(session.id, "gpt-5.6-terra")
        assert.equal(changed.curator.modelId, "gpt-5.6-terra")

        const cancelled = store.cancelCurationSession(session.id)
        assert.equal(cancelled.status, "cancelled")
        assert.equal(store.read().cases.length, 0)
        assert.equal(store.hasCurationForSource("thread-source", "agent-2"), true)
        assert.equal(store.listCurationSessions().some((entry) => entry.id === session.id), false)
    })
})
