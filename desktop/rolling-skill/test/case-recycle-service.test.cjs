const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {CaseRecycleService} = require("../src/case-recycle-service.cjs")

function skillReference() {
    return {
        id: "skill-billing",
        name: "billing-cost-management",
        path: "/skills/billing/SKILL.md",
    }
}

function datasetSnapshot(count = 2) {
    return {
        dataset: {
            id: "dataset-1",
            name: "Billing regression",
            skillReference: skillReference(),
        },
        cases: Array.from({length: count}, (_, index) => ({
            id: `case-${index + 1}`,
            datasetId: "dataset-1",
            caseType: index % 2 === 0 ? "goodcase" : "badcase",
            question: index === 0 ? "question one  \n" : `question ${index + 1}`,
            answer: `secret answer ${index + 1}`,
            skillReference: skillReference(),
        })),
    }
}

function fixture({count = 2, addMany} = {}) {
    const snapshot = datasetSnapshot(count)
    const events = []
    const store = {
        prepareDatasetDeletion(datasetId) {
            assert.equal(datasetId, "dataset-1")
            events.push("preflight-dataset")
            return structuredClone(snapshot)
        },
        prepareCaseDeletion(datasetId, caseId) {
            assert.equal(datasetId, "dataset-1")
            events.push("preflight-case")
            return {
                dataset: structuredClone(snapshot.dataset),
                cases: [structuredClone(snapshot.cases.find((entry) => entry.id === caseId))],
            }
        },
        deleteDataset(datasetId) {
            events.push("delete-dataset")
            return {dataset: {id: datasetId}}
        },
        deleteCase(datasetId, caseId) {
            events.push("delete-case")
            return {id: caseId, datasetId}
        },
    }
    const batches = []
    const rawCaseStore = {
        addMany(entries) {
            batches.push(structuredClone(entries))
            events.push(`raw-${entries.length}`)
            return addMany?.(entries) ?? {created: entries, duplicates: [], rejected: []}
        },
    }
    const service = new CaseRecycleService({
        store,
        rawCaseStore,
        now: () => "2026-08-26T02:00:00.000Z",
    })
    return {service, events, batches}
}

describe("Case deletion recovery", () => {
    it("preserves dataset questions in bounded Raw Case batches before deletion", () => {
        const {service, events, batches} = fixture({count: 201})

        service.deleteDataset({datasetId: "dataset-1", recoverQuestions: true})

        assert.deepEqual(batches.map((batch) => batch.length), [200, 1])
        assert.deepEqual(events, ["preflight-dataset", "raw-200", "raw-1", "delete-dataset"])
        assert.equal(batches[0][0].question, "question one  \n")
        assert.deepEqual(batches[0][0].skill, skillReference())
        assert.deepEqual(batches[0][0].source, {
            kind: "deleted_case",
            datasetId: "dataset-1",
            caseId: "case-1",
            caseType: "goodcase",
            recoveredAt: "2026-08-26T02:00:00.000Z",
        })
        assert.match(batches[0][0].note, /Billing regression.*Goodcase/iu)
        assert.doesNotMatch(JSON.stringify(batches), /secret answer/u)
    })

    it("accepts duplicates but aborts deletion when one Raw Case is rejected", () => {
        const duplicates = fixture({
            addMany: () => ({created: [], duplicates: [{index: 0}], rejected: []}),
        })
        assert.doesNotThrow(() => duplicates.service.deleteDataset({
            datasetId: "dataset-1",
            recoverQuestions: true,
        }))
        assert.equal(duplicates.events.at(-1), "delete-dataset")

        const rejected = fixture({
            addMany: () => ({
                created: [],
                duplicates: [],
                rejected: [{index: 0, error: "disk unavailable"}],
            }),
        })
        assert.throws(
            () => rejected.service.deleteDataset({datasetId: "dataset-1", recoverQuestions: true}),
            /Raw Case recovery.*disk unavailable/iu,
        )
        assert.equal(rejected.events.includes("delete-dataset"), false)
    })

    it("recovers one Case or explicitly deletes without recovery", () => {
        const recovered = fixture()
        recovered.service.deleteCase({
            datasetId: "dataset-1",
            caseId: "case-2",
            recoverQuestions: true,
        })
        assert.deepEqual(recovered.events, ["preflight-case", "raw-1", "delete-case"])
        assert.equal(recovered.batches[0][0].question, "question 2")

        const direct = fixture()
        direct.service.deleteDataset({datasetId: "dataset-1", recoverQuestions: false})
        assert.deepEqual(direct.events, ["preflight-dataset", "delete-dataset"])
        assert.deepEqual(direct.batches, [])
    })
})
