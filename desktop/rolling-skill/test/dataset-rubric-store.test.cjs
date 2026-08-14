const assert = require("node:assert/strict")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {DATASET_RUBRIC_SCHEMA} = require("../src/dataset-rubric.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function rubric(label = "v1") {
    return {
        schemaVersion: DATASET_RUBRIC_SCHEMA,
        title: `Billing rubric ${label}`,
        summary: "Skill-specific execution and result quality.",
        criteria: [{
            id: "R1",
            title: "Billing result quality",
            criterion: "Return supported and scoped billing conclusions.",
            weight: 1,
            evidenceRequirements: ["Agent response", "Frozen reference facts"],
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

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-rubric-store-"))
    temporaryDirectories.push(directory)
    const skillPath = join(directory, "SKILL.md")
    writeFileSync(skillPath, "# Billing\n\nUse the billing CLI, paginate, and verify totals.\n")
    const skillReference = {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: "billing-cost-management",
        path: skillPath,
        scope: "user",
        description: "Billing queries",
        runtimeId: "codex:alpha",
        confirmedAt: "2026-08-14T00:00:00.000Z",
    }
    const store = new LocalEvaluationStore(join(directory, "store.json"))
    const dataset = store.bindDatasetSkill(store.listDatasets()[0].id, skillReference)
    return {store, dataset, skillReference, skillEvidence: snapshotSkillEvidence(skillReference)}
}

function startSession(store, dataset, skillEvidence, baseVersionId = null) {
    return store.createRubricSession({
        datasetId: dataset.id,
        baseVersionId,
        skillEvidence,
        rubricAgent: {
            runtimeId: "codex:alpha",
            modelProvider: "openai",
            modelId: "gpt-5.6-sol",
            effort: "high",
            promptVersion: "dataset-rubric-agent/v1",
        },
    })
}

function curatedV2Draft() {
    return {
        schemaVersion: "rolling-skill-curated-case/v2",
        referenceAnswer: {
            summary: "返回账单结果。",
            requiredFacts: [],
            requiredSteps: ["查询账单"],
            requiredOutputFormat: ["金额带币种"],
            evidence: [],
        },
        rubricCoverage: [{
            criterionId: "R1",
            applicability: "applicable",
            expectation: "返回有证据的账单结论",
            evidenceBasis: "原始问题",
        }],
        caseSpecificCriteria: [],
        caseAutomaticFailures: [],
        badCaseAnalysis: null,
    }
}

function episode() {
    return {
        schemaVersion: "rolling-skill-episode/v1",
        originalQuestion: "查账单",
        source: {threadId: "source", endItemId: "answer"},
        items: [
            {id: "question", type: "userMessage", text: "查账单"},
            {id: "answer", type: "agentMessage", text: "结果"},
        ],
        toolActivity: [],
    }
}

describe("dataset rubric lifecycle", () => {
    it("migrates storage and initializes dataset-level rubric fields and profile", () => {
        const {store, dataset} = fixture()
        const snapshot = store.read()

        assert.equal(snapshot.schemaVersion, "rolling-skill-local/v9")
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, null)
        assert.deepEqual(snapshot.datasetRubricVersions, [])
        assert.deepEqual(snapshot.rubricSessions, [])
        assert.deepEqual(snapshot.settings.rubricProfile, {
            runtimePolicy: "active",
            modelId: null,
            effort: null,
        })
    })

    it("records revisions, publishes immutable versions, and preserves prior versions", () => {
        const {store, dataset, skillEvidence} = fixture()
        let session = startSession(store, dataset, skillEvidence)
        session = store.recordRubricRevision(session.id, {
            rubric: rubric("v1"),
            assistantText: "Initial rubric",
            turnId: "turn-1",
        })
        const first = store.publishRubricSession(session.id)

        assert.equal(first.version, 1)
        assert.equal(first.skillEvidenceDigest, skillEvidence.digest)
        assert.match(first.rubricDigest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, first.id)

        session = startSession(store, dataset, skillEvidence, first.id)
        store.recordRubricRevision(session.id, {
            rubric: rubric("v2"),
            assistantText: "Revised rubric",
            turnId: "turn-2",
        })
        const second = store.publishRubricSession(session.id)
        const versions = store.listDatasetRubricVersions(dataset.id)

        assert.equal(second.version, 2)
        assert.deepEqual(versions.map((entry) => entry.id), [second.id, first.id])
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, second.id)
        assert.equal(store.getDatasetRubricVersion(first.id).rubric.title, "Billing rubric v1")
    })

    it("rejects publishing a stale Rubric draft over a newer active version", () => {
        const {store, dataset, skillEvidence} = fixture()
        let initial = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(initial.id, {rubric: rubric("v1"), assistantText: "v1"})
        const first = store.publishRubricSession(initial.id)
        const stale = startSession(store, dataset, skillEvidence, first.id)
        const current = startSession(store, dataset, skillEvidence, first.id)
        store.recordRubricRevision(stale.id, {rubric: rubric("stale"), assistantText: "stale"})
        store.recordRubricRevision(current.id, {rubric: rubric("v2"), assistantText: "v2"})

        const second = store.publishRubricSession(current.id)

        assert.throws(() => store.publishRubricSession(stale.id), /newer|stale|active/i)
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, second.id)
        assert.deepEqual(
            store.listDatasetRubricVersions(dataset.id).map((entry) => entry.rubric.title),
            ["Billing rubric v2", "Billing rubric v1"],
        )
    })

    it("invalidates the active rubric after a Skill rebind without deleting history", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(session.id, {
            rubric: rubric(),
            assistantText: "Rubric",
        })
        const published = store.publishRubricSession(session.id)

        const otherDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-other-skill-"))
        temporaryDirectories.push(otherDirectory)
        const otherPath = join(otherDirectory, "SKILL.md")
        writeFileSync(otherPath, "# Other skill\n")
        store.bindDatasetSkill(dataset.id, {
            ...dataset.skillReference,
            name: "other-skill",
            path: otherPath,
        })

        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, null)
        assert.equal(store.getDatasetRubricVersion(published.id).id, published.id)
    })

    it("freezes the active rubric in evaluation runs and marks older Cases for calibration", () => {
        const {store, dataset, skillEvidence} = fixture()
        let session = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(session.id, {rubric: rubric("v1"), assistantText: "v1"})
        const first = store.publishRubricSession(session.id)
        const savedCase = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "查账单",
            answer: "参考答案",
        })
        session = startSession(store, dataset, skillEvidence, first.id)
        store.recordRubricRevision(session.id, {rubric: rubric("v2"), assistantText: "v2"})
        const second = store.publishRubricSession(session.id)

        assert.deepEqual(store.listCases(dataset.id)[0].rubricCalibration, {
            status: "needed",
            rubricVersionId: second.id,
            previousRubricVersionId: null,
        })

        assert.throws(() => store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [savedCase.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillEvidence,
            runtimeConfigurations: [{
                runtimeId: "codex:alpha",
                providerId: "codex",
                executablePath: "/usr/local/bin/codex",
            }],
        }), /calibration/i)

        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "curated for v2",
        })
        const currentCase = store.archiveCurationSession(curation.id)
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [currentCase.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillEvidence,
            runtimeConfigurations: [{
                runtimeId: "codex:alpha",
                providerId: "codex",
                executablePath: "/usr/local/bin/codex",
            }],
        })

        assert.equal(run.rubricVersionSnapshot.id, second.id)
        assert.equal(run.rubricVersionSnapshot.rubric.title, "Billing rubric v2")

        store.getDatasetRubricVersion(second.id).rubric.title = "mutated outside copy"
        assert.equal(store.getEvaluationRun(run.id).rubricVersionSnapshot.rubric.title, "Billing rubric v2")
    })

    it("marks a Case for calibration when its frozen Curator Rubric became stale", () => {
        const {store, dataset, skillEvidence} = fixture()
        let session = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(session.id, {rubric: rubric("v1"), assistantText: "v1"})
        const first = store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "curated for v1",
        })

        session = startSession(store, dataset, skillEvidence, first.id)
        store.recordRubricRevision(session.id, {rubric: rubric("v2"), assistantText: "v2"})
        const second = store.publishRubricSession(session.id)
        const staleCase = store.archiveCurationSession(curation.id)

        assert.equal(staleCase.rubricVersionId, first.id)
        assert.deepEqual(staleCase.rubricCalibration, {
            status: "needed",
            rubricVersionId: second.id,
            previousRubricVersionId: first.id,
        })
    })

    it("removes current rubric sessions and versions with a dataset while preserving run snapshots", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(session.id, {rubric: rubric(), assistantText: "rubric"})
        const version = store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "current Case",
        })
        const savedCase = store.archiveCurationSession(curation.id)
        const run = store.createEvaluationRun({
            datasetId: dataset.id,
            caseIds: [savedCase.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillEvidence,
            runtimeConfigurations: [{
                runtimeId: "codex:alpha",
                providerId: "codex",
                executablePath: "/usr/local/bin/codex",
            }],
        })

        store.deleteDataset(dataset.id)

        assert.throws(() => store.getDatasetRubricVersion(version.id), /unknown/i)
        assert.deepEqual(store.listRubricSessions(), [])
        assert.equal(store.getEvaluationRun(run.id).rubricVersionSnapshot.id, version.id)
    })
})
