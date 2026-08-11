const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
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
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-evaluation-store-"))
    temporaryDirectories.push(directory)
    return new LocalEvaluationStore(join(directory, "store.json"))
}

function frozenEpisode() {
    return {
        schemaVersion: "rolling-skill-episode/v1",
        originalQuestion: "查一下七月账单",
        source: {threadId: "source", endItemId: "agent", runtimeId: "codex:source"},
        items: [
            {id: "user", type: "userMessage", text: "查一下七月账单"},
            {id: "agent", type: "agentMessage", text: "结果"},
        ],
        toolActivity: [],
    }
}

function draft() {
    return {
        schemaVersion: CURATED_CASE_SCHEMA,
        referenceAnswer: {
            summary: "返回账单结论",
            requiredFacts: [],
            requiredSteps: ["查询账单"],
            requiredOutputFormat: ["标明币种"],
            evidence: [],
        },
        grading: {
            hardRequirements: [
                {
                    id: "H1",
                    criterion: "执行账单查询流程",
                    passCondition: "使用账单工具并报告结果",
                    evidenceBasis: "Trace",
                },
            ],
            softCriteria: [],
            automaticFailures: ["未查询账单"],
        },
        badCaseAnalysis: null,
    }
}

describe("evaluation data lifecycle", () => {
    it("keeps archived Curator records out of Case drafts and exposes them separately", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        const session = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: frozenEpisode(),
            curator: {runtimeId: "codex:source"},
        })
        store.recordCurationRevision(session.id, {draft: draft(), assistantText: "已整理"})
        store.archiveCurationSession(session.id)

        assert.deepEqual(store.listCurationSessions(), [])
        assert.deepEqual(store.listArchivedCurationSessions().map((entry) => entry.id), [session.id])
    })

    it("persists reasoning effort for every configurable profile", () => {
        const store = fixture()
        const settings = store.updateSettings({
            taskEffort: "high",
            curatorEffort: "xhigh",
            autoCaptureEffort: "medium",
        })

        assert.equal(settings.taskProfile.effort, "high")
        assert.equal(settings.curatorProfile.effort, "xhigh")
        assert.equal(settings.autoCaptureProfile.effort, "medium")
        assert.equal(store.updateSettings({taskEffort: "ultra"}).taskProfile.effort, "ultra")
        assert.throws(() => store.updateSettings({taskEffort: "impossible"}), /effort/i)
    })

    it("deletes a Case without invalidating immutable evaluation-run snapshots", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        const saved = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "原始自然语言问题",
            answer: "参考答案",
        })
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [saved.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {
                    runtimeId: "codex:alpha",
                    providerId: "codex",
                    displayName: "Codex",
                    version: "0.147.0",
                    executablePath: "/Applications/Codex/codex",
                    modelId: "gpt-5.6-sol",
                    effort: "high",
                },
            ],
        })

        store.deleteCase(dataset.id, saved.id)

        assert.deepEqual(store.listCases(dataset.id), [])
        const historical = store.getEvaluationRun(run.id)
        assert.equal(historical.caseSnapshots[0].question, "原始自然语言问题")
        assert.equal(historical.results[0].caseSnapshot.question, "原始自然语言问题")
        assert.equal(historical.results[0].runtimeConfiguration.effort, "high")
    })

    it("deletes a Dataset and its Cases while preserving immutable evaluation history", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        const saved = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "原始问题",
            answer: "参考答案",
        })
        store.updateSettings({autoCapture: true, autoCaptureDatasetId: dataset.id})
        const finishedDraft = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "badcase",
            episode: frozenEpisode(),
            curator: {runtimeId: "codex:source"},
        })
        store.cancelCurationSession(finishedDraft.id)
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [saved.id],
            selectionMode: "dataset",
            activationMode: "automatic",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", displayName: "Codex", executablePath: "/a"},
            ],
        })
        store.updateEvaluationRun(run.id, {status: "completed", completedAt: "later"})

        const deleted = store.deleteDataset(dataset.id)

        assert.equal(deleted.dataset.id, dataset.id)
        assert.equal(deleted.deletedCaseCount, 1)
        assert.equal(deleted.deletedCurationCount, 1)
        assert.equal(deleted.settings.autoCapture, false)
        assert.equal(deleted.settings.autoCaptureProfile.datasetId, null)
        assert.deepEqual(store.listDatasets(), [])
        assert.deepEqual(store.read().curationSessions, [])
        assert.equal(store.read().settings.autoCaptureProfile.datasetId, null)
        assert.equal(store.read().settings.autoCapture, false)
        assert.throws(() => store.listCases(dataset.id), /dataset/i)
        assert.equal(store.listEvaluationRuns()[0].datasetSnapshot.name, dataset.name)
        assert.equal(store.listEvaluationRuns(dataset.id)[0].id, run.id)
    })

    it("disables automatic capture instead of silently redirecting it to another Dataset", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        store.createDataset("Remaining")
        store.updateSettings({autoCapture: true, autoCaptureDatasetId: dataset.id})

        store.deleteDataset(dataset.id)

        const settings = store.read().settings
        assert.equal(settings.autoCaptureProfile.datasetId, null)
        assert.equal(settings.autoCapture, false)
    })

    it("refuses to delete a Dataset with an unfinished Curator draft", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: frozenEpisode(),
            curator: {runtimeId: "codex:source"},
        })

        assert.throws(() => store.deleteDataset(dataset.id), /unfinished.*draft/i)
        assert.equal(store.listDatasets()[0].id, dataset.id)
    })

    it("deletes finished evaluation records but protects active runs", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        const saved = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "q",
            answer: "a",
        })
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [saved.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", displayName: "Codex", executablePath: "/a"},
            ],
        })

        assert.throws(() => store.deleteEvaluationRun(run.id), /active evaluation run/i)
        store.updateEvaluationRun(run.id, {status: "failed", completedAt: "later"})
        assert.equal(store.deleteEvaluationRun(run.id).id, run.id)
        assert.deepEqual(store.listEvaluationRuns(), [])
        assert.throws(() => store.getEvaluationRun(run.id), /evaluation run/i)
    })

    it("updates and lists durable Case x runtime evaluation results", () => {
        const store = fixture()
        const dataset = store.listDatasets()[0]
        const one = store.saveCase({datasetId: dataset.id, caseType: "goodcase", question: "q1", answer: "a1"})
        const two = store.saveCase({datasetId: dataset.id, caseType: "badcase", question: "q2", answer: "a2"})
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [one.id, two.id],
            selectionMode: "dataset",
            activationMode: "automatic",
            skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", displayName: "Codex", executablePath: "/a"},
                {runtimeId: "codebuddy:b", providerId: "codebuddy", displayName: "CodeBuddy", executablePath: "/b"},
            ],
        })
        assert.equal(run.results.length, 4)
        assert.equal(run.status, "queued")

        store.updateEvaluationRun(run.id, {status: "running", startedAt: "now"})
        store.updateEvaluationResult(run.id, run.results[0].id, {
            status: "completed",
            durationMs: 123,
            response: "done",
            threadId: "thread-1",
            traceReference: "trace://run#L2",
        })
        store.updateEvaluationRun(run.id, {status: "partial", completedAt: "later"})

        const listed = store.listEvaluationRuns(dataset.id)[0]
        assert.equal(listed.id, run.id)
        assert.equal(listed.status, "partial")
        assert.equal(listed.results[0].response, "done")

        const summary = store.listEvaluationRunSummaries(dataset.id)[0]
        assert.equal(summary.id, run.id)
        assert.equal(summary.caseCount, 2)
        assert.equal(summary.runtimeCount, 2)
        assert.equal("caseSnapshots" in summary, false)
        assert.equal("results" in summary, false)
    })
})
