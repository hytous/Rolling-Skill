const assert = require("node:assert/strict")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {DATASET_RUBRIC_SCHEMA, UNIFIED_SCORING_MODEL} = require("../src/dataset-rubric.cjs")
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
        scoringModel: UNIFIED_SCORING_MODEL,
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
            promptVersion: "dataset-rubric-agent/v2-unified",
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

function saveCuratedCase(store, dataset, question) {
    const value = episode()
    value.originalQuestion = question
    value.items[0].text = question
    const session = store.createCurationSession({
        datasetId: dataset.id,
        caseType: "goodcase",
        episode: value,
        curator: {},
    })
    store.recordCurationRevision(session.id, {
        draft: curatedV2Draft(),
        assistantText: `curated ${question}`,
    })
    return store.archiveCurationSession(session.id)
}

describe("dataset rubric lifecycle", () => {
    it("migrates storage and initializes dataset-level rubric fields and profile", () => {
        const {store, dataset} = fixture()
        const snapshot = store.read()

        assert.equal(snapshot.schemaVersion, "rolling-skill-local/v11")
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

    it("atomically clones selected Cases and the active Dataset Rubric", () => {
        const {store, dataset, skillEvidence} = fixture()
        const rubricSession = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(rubricSession.id, {
            rubric: rubric("source"),
            assistantText: "source rubric",
        })
        const sourceRubric = store.publishRubricSession(rubricSession.id)
        const first = saveCuratedCase(store, dataset, "first question")
        const second = saveCuratedCase(store, dataset, "second question")
        saveCuratedCase(store, dataset, "not selected")

        const result = store.cloneDataset({
            sourceDatasetId: dataset.id,
            name: "Billing clone",
            caseIds: [second.id, first.id],
        })

        assert.equal(result.dataset.name, "Billing clone")
        assert.notEqual(result.dataset.id, dataset.id)
        assert.deepEqual(result.dataset.skillReference, dataset.skillReference)
        assert.equal(result.cases.length, 2)
        assert.deepEqual(result.cases.map((entry) => entry.question), [
            "second question",
            "first question",
        ])
        assert.equal(new Set(result.cases.map((entry) => entry.id)).size, 2)
        assert.ok(result.cases.every((entry) => entry.datasetId === result.dataset.id))
        assert.ok(result.cases.every((entry) => entry.curated.referenceAnswer.summary === "返回账单结果。"))
        assert.ok(result.cases.every((entry) => entry.rubricVersionId === result.rubricVersion.id))
        assert.ok(result.cases.every((entry) => entry.rubricCalibration.status === "current"))
        assert.notEqual(result.rubricVersion.id, sourceRubric.id)
        assert.equal(result.rubricVersion.datasetId, result.dataset.id)
        assert.equal(result.rubricVersion.version, 1)
        assert.equal(result.rubricVersion.rubricDigest, sourceRubric.rubricDigest)
        assert.deepEqual(result.rubricVersion.rubric, sourceRubric.rubric)
        assert.equal(store.listCases(result.dataset.id).length, 2)
        assert.equal(store.getActiveDatasetRubric(result.dataset.id).id, result.rubricVersion.id)
    })

    it("does not persist a partial Dataset clone when the Case selection is invalid", () => {
        const {store, dataset} = fixture()
        const selected = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "selected",
            answer: "answer",
        })
        const otherDataset = store.createDataset({
            name: "Other",
            skillReference: dataset.skillReference,
        })
        const foreign = store.saveCase({
            datasetId: otherDataset.id,
            caseType: "goodcase",
            question: "foreign",
            answer: "answer",
        })
        const before = store.read()

        assert.throws(() => store.cloneDataset({
            sourceDatasetId: dataset.id,
            name: "Duplicate selection",
            caseIds: [selected.id, selected.id],
        }), /duplicate/i)
        assert.throws(() => store.cloneDataset({
            sourceDatasetId: dataset.id,
            name: "Oversized selection",
            caseIds: Array.from({length: 101}, (_value, index) => `case-${index}`),
        }), /100|too many/i)
        assert.throws(() => store.cloneDataset({
            sourceDatasetId: dataset.id,
            name: "Foreign selection",
            caseIds: [foreign.id],
        }), /case.*source|unknown.*case/i)
        assert.deepEqual(store.read(), before)
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

    it("blocks a legacy split-layer rubric until Rubric Agent republishes it as unified", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "legacy Case",
        })
        const savedCase = store.archiveCurationSession(curation.id)

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
        }), /unified scoring model/i)
    })

    it("upgrades only the active legacy scoring contract and carries current Cases forward", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        const first = store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "legacy Case",
        })
        const currentCase = store.archiveCurationSession(curation.id)
        const staleCase = store.saveCase({
            datasetId: dataset.id,
            caseType: "goodcase",
            question: "旧 Case",
            answer: "旧答案",
        })
        const firstBefore = store.getDatasetRubricVersion(first.id)
        const currentBefore = store.listCases(dataset.id).find((entry) => entry.id === currentCase.id)

        const second = store.migrateActiveDatasetRubricToUnified(dataset.id)
        const versions = store.listDatasetRubricVersions(dataset.id)
        const currentAfter = store.listCases(dataset.id).find((entry) => entry.id === currentCase.id)
        const staleAfter = store.listCases(dataset.id).find((entry) => entry.id === staleCase.id)
        const migratedContent = structuredClone(second.rubric)
        delete migratedContent.scoringModel

        assert.equal(second.version, 2)
        assert.equal(second.baseVersionId, first.id)
        assert.equal(second.sourceSessionId, null)
        assert.equal(second.skillEvidenceDigest, first.skillEvidenceDigest)
        assert.deepEqual(second.skillReference, first.skillReference)
        assert.equal(second.rubric.scoringModel, UNIFIED_SCORING_MODEL)
        assert.deepEqual(migratedContent, firstBefore.rubric)
        assert.deepEqual(versions.map((entry) => entry.id), [second.id, first.id])
        assert.equal("scoringModel" in store.getDatasetRubricVersion(first.id).rubric, false)
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, second.id)
        assert.equal(currentAfter.id, currentBefore.id)
        assert.equal(currentAfter.answer, currentBefore.answer)
        assert.deepEqual(currentAfter.curated, currentBefore.curated)
        assert.equal(currentAfter.rubricVersionId, second.id)
        assert.deepEqual(currentAfter.rubricCalibration, {
            status: "current",
            rubricVersionId: second.id,
            previousRubricVersionId: first.id,
        })
        assert.equal(staleAfter.rubricVersionId ?? null, null)
        assert.deepEqual(staleAfter.rubricCalibration, {
            status: "needed",
            rubricVersionId: second.id,
            previousRubricVersionId: null,
        })
        assert.equal(store.listRubricSessions(dataset.id).length, 0)

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
    })

    it("rejects a legacy contract upgrade while the dataset has an active evaluation", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        const first = store.publishRubricSession(session.id)
        store.state.evaluationRuns.push({
            id: "active-run",
            datasetId: dataset.id,
            status: "running",
        })

        assert.throws(
            () => store.migrateActiveDatasetRubricToUnified(dataset.id),
            /active evaluation/i,
        )
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, first.id)
        assert.deepEqual(store.listDatasetRubricVersions(dataset.id).map((entry) => entry.id), [first.id])
    })

    it("rejects a legacy contract upgrade while Case calibration is active", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        const first = store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "legacy Case",
        })
        const savedCase = store.archiveCurationSession(curation.id)
        const storedCase = store.state.cases.find((entry) => entry.id === savedCase.id)
        storedCase.rubricCalibration.status = "needed"
        store.createCaseCalibrationSession({
            datasetId: dataset.id,
            caseId: savedCase.id,
            curator: {},
        })

        assert.throws(
            () => store.migrateActiveDatasetRubricToUnified(dataset.id),
            /active Case calibration/i,
        )
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, first.id)
        assert.deepEqual(store.listDatasetRubricVersions(dataset.id).map((entry) => entry.id), [first.id])
    })

    it("rejects a legacy contract upgrade while Case refresh is active", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        const first = store.publishRubricSession(session.id)
        const curation = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {},
        })
        store.recordCurationRevision(curation.id, {
            draft: curatedV2Draft(),
            assistantText: "legacy Case",
        })
        const savedCase = store.archiveCurationSession(curation.id)
        store.createCaseRefreshSession({
            datasetId: dataset.id,
            caseId: savedCase.id,
            episode: episode(),
            curator: {},
        })

        assert.throws(
            () => store.migrateActiveDatasetRubricToUnified(dataset.id),
            /active Case maintenance|refresh/i,
        )
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, first.id)
    })

    it("rejects a legacy contract upgrade while Rubric Agent editing is active", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        const legacy = rubric("legacy")
        delete legacy.scoringModel
        store.recordRubricRevision(session.id, {rubric: legacy, assistantText: "legacy"})
        const first = store.publishRubricSession(session.id)
        startSession(store, dataset, skillEvidence, first.id)

        assert.throws(
            () => store.migrateActiveDatasetRubricToUnified(dataset.id),
            /Rubric Agent editing/i,
        )
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, first.id)
    })

    it("rejects repeated or non-legacy scoring-contract upgrades", () => {
        const {store, dataset, skillEvidence} = fixture()
        const session = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(session.id, {rubric: rubric(), assistantText: "unified"})
        const published = store.publishRubricSession(session.id)

        assert.throws(
            () => store.migrateActiveDatasetRubricToUnified(dataset.id),
            /already uses the unified scoring model/i,
        )
        assert.equal(store.getDataset(dataset.id).activeRubricVersionId, published.id)
        assert.deepEqual(store.listDatasetRubricVersions(dataset.id).map((entry) => entry.id), [published.id])
    })

    it("calibrates an existing Case in place against the active rubric and preserves history", () => {
        const {store, dataset, skillEvidence} = fixture()
        let rubricSession = startSession(store, dataset, skillEvidence)
        store.recordRubricRevision(rubricSession.id, {
            rubric: rubric("v1"),
            assistantText: "v1",
        })
        const first = store.publishRubricSession(rubricSession.id)
        const sourceSession = store.createCurationSession({
            datasetId: dataset.id,
            caseType: "goodcase",
            episode: episode(),
            curator: {modelId: "gpt-source", effort: "high"},
        })
        store.recordCurationRevision(sourceSession.id, {
            draft: curatedV2Draft(),
            assistantText: "original curated Case",
        })
        const saved = store.archiveCurationSession(sourceSession.id)

        rubricSession = startSession(store, dataset, skillEvidence, first.id)
        store.recordRubricRevision(rubricSession.id, {
            rubric: rubric("v2"),
            assistantText: "v2",
        })
        const second = store.publishRubricSession(rubricSession.id)

        const calibration = store.createCaseCalibrationSession({
            datasetId: dataset.id,
            caseId: saved.id,
            curator: {modelId: "gpt-calibrator", effort: "xhigh"},
        })
        assert.equal(calibration.operation, "calibration")
        assert.equal(calibration.targetCaseId, saved.id)
        assert.equal(calibration.episode.originalQuestion, saved.question)
        assert.equal(
            calibration.baselineCaseSnapshot.curated.referenceAnswer.summary,
            saved.curated.referenceAnswer.summary,
        )
        assert.equal(calibration.rubricVersionSnapshot.id, second.id)
        assert.throws(() => store.createCaseCalibrationSession({
            datasetId: dataset.id,
            caseId: saved.id,
            curator: {},
        }), /already.*progress/i)
        assert.throws(() => store.deleteCase(dataset.id, saved.id), /calibration/i)

        const calibratedDraft = curatedV2Draft()
        calibratedDraft.referenceAnswer.summary = "按 v2 校准后的参考结论。"
        store.recordCurationRevision(calibration.id, {
            draft: calibratedDraft,
            assistantText: "calibrated for v2",
        })
        const calibrated = store.archiveCurationSession(calibration.id)

        assert.equal(calibrated.id, saved.id)
        assert.equal(store.listCases(dataset.id).length, 1)
        assert.equal(calibrated.curated.referenceAnswer.summary, "按 v2 校准后的参考结论。")
        assert.equal(calibrated.rubricVersionId, second.id)
        assert.deepEqual(calibrated.rubricCalibration, {
            status: "current",
            rubricVersionId: second.id,
            previousRubricVersionId: first.id,
        })
        assert.equal(calibrated.calibrationHistory.length, 1)
        assert.equal(
            calibrated.calibrationHistory[0].curated.referenceAnswer.summary,
            saved.curated.referenceAnswer.summary,
        )
        assert.equal(calibrated.source.originalQuestion, saved.source.originalQuestion)
        assert.equal(calibrated.source.curationSessionId, calibration.id)
        assert.equal(store.getCurationSession(calibration.id).caseId, saved.id)
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
