const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const modulePath = "../src/case-services.cjs"

function cases() {
    return [
        {
            id: "case-3",
            datasetId: "dataset-1",
            caseType: "goodcase",
            question: "question 3",
            answer: "answer 3",
            updatedAt: "2026-08-26T03:00:00.000Z",
            source: {originalAssistantMessages: [{role: "assistant", content: "original 3"}]},
        },
        {
            id: "case-2",
            datasetId: "dataset-1",
            caseType: "badcase",
            question: "question 2",
            answer: "answer 2",
            updatedAt: "2026-08-26T02:00:00.000Z",
        },
        {
            id: "case-1",
            datasetId: "dataset-1",
            caseType: "goodcase",
            question: "question 1",
            answer: "answer 1",
            updatedAt: "2026-08-26T01:00:00.000Z",
        },
    ]
}

function fixture() {
    let entries = cases()
    const refreshes = []
    const recycled = []
    const rawDispatches = []
    const rawDeletes = []
    const rawUpdates = []
    let datasets = [{
        id: "dataset-1",
        name: "Billing cases",
        createdAt: "2026-08-26T00:00:00.000Z",
    }]
    const store = {
        listDatasets: () => structuredClone(datasets),
        getDataset: (datasetId) => {
            const dataset = datasets.find((entry) => entry.id === datasetId)
            if (!dataset) throw new Error("Unknown dataset")
            return structuredClone(dataset)
        },
        listCases: (datasetId) => {
            if (datasetId !== "dataset-1") throw new Error("Unknown dataset")
            return structuredClone(entries)
        },
        listCurationSessions: () => [{
            operation: "refresh",
            targetCaseId: "case-1",
            status: "running",
        }],
        prepareCaseDeletion: (datasetId, caseId) => ({
            dataset: store.getDataset(datasetId),
            cases: [structuredClone(entries.find((entry) => entry.id === caseId))],
        }),
        prepareDatasetDeletion: (datasetId) => ({
            dataset: store.getDataset(datasetId),
            cases: structuredClone(entries),
        }),
    }
    const recycleService = {
        deleteCase(input) {
            recycled.push(structuredClone(input))
            const removed = entries.find((entry) => entry.id === input.caseId)
            entries = entries.filter((entry) => entry.id !== input.caseId)
            return structuredClone(removed)
        },
        deleteDataset(input) {
            recycled.push(structuredClone(input))
            const removed = datasets.find((entry) => entry.id === input.datasetId)
            datasets = datasets.filter((entry) => entry.id !== input.datasetId)
            entries = []
            return {dataset: structuredClone(removed)}
        },
    }
    const refreshManager = {
        async createSession(input) {
            refreshes.push(structuredClone(input))
            return {id: `refresh-${input.caseId}`, operation: "refresh", targetCaseId: input.caseId}
        },
    }
    const rawCaseStore = {
        requireRecord(id) {
            return {id, question: "raw question", note: "note", skill: {id: "skill-1", name: "billing"}}
        },
        updateIfCurrent(id, expected, changes) {
            rawUpdates.push({id, expected: structuredClone(expected), changes: structuredClone(changes)})
            return {id, revision: expected.expectedRevision + 1, ...changes}
        },
        markDispatched(id, dispatch) {
            rawDispatches.push({id, dispatch: structuredClone(dispatch)})
            return {id, question: "raw question"}
        },
        delete(id) {
            rawDeletes.push(id)
            return {id, question: "raw question"}
        },
    }
    const {createCaseServices} = require(modulePath)
    return {
        services: createCaseServices({
            store,
            rawCaseStore,
            recycleService,
            refreshManager,
            dispatchRawCase: async () => ({sessionId: "thread-1", status: "queued"}),
        }),
        refreshes,
        refreshManager,
        recycled,
        rawDispatches,
        rawDeletes,
        rawUpdates,
    }
}

describe("Rolling Skill Case services", () => {
    it("pages complete Case DTOs and reads one Case", async () => {
        const test = fixture()
        const page = await test.services.dispatch("cases.list", {
            datasetId: "dataset-1",
            page: 2,
            pageSize: 2,
        })
        assert.deepEqual(page, {
            items: [cases()[2]],
            page: 2,
            pageSize: 2,
            total: 3,
            pageCount: 2,
        })
        assert.deepEqual(
            await test.services.dispatch("cases.get", {datasetId: "dataset-1", caseId: "case-2"}),
            cases()[1],
        )
    })

    it("deletes a Case or Dataset only at the expected revision and recovers by default", async () => {
        const test = fixture()
        await test.services.dispatch("cases.delete", {
            datasetId: "dataset-1",
            caseId: "case-2",
            expectedUpdatedAt: "2026-08-26T02:00:00.000Z",
            idempotencyKey: "delete-case-2",
        })
        await test.services.dispatch("cases.delete", {
            datasetId: "dataset-1",
            caseId: "case-2",
            expectedUpdatedAt: "2026-08-26T02:00:00.000Z",
            idempotencyKey: "delete-case-2",
        })
        assert.deepEqual(test.recycled, [{
            datasetId: "dataset-1",
            caseId: "case-2",
            recoverQuestions: true,
        }])

        await assert.rejects(
            test.services.dispatch("datasets.delete", {
                datasetId: "dataset-1",
                expectedCreatedAt: "stale",
                idempotencyKey: "delete-dataset-stale",
            }),
            /changed since/u,
        )
        await test.services.dispatch("datasets.delete", {
            datasetId: "dataset-1",
            expectedCreatedAt: "2026-08-26T00:00:00.000Z",
            recoverQuestions: false,
            idempotencyKey: "delete-dataset-1",
        })
        assert.equal(test.recycled[1].recoverQuestions, false)
    })

    it("refreshes one Case and batches only eligible good Cases", async () => {
        const test = fixture()
        await test.services.dispatch("cases.refresh", {
            datasetId: "dataset-1",
            caseId: "case-2",
            expectedUpdatedAt: "2026-08-26T02:00:00.000Z",
            idempotencyKey: "refresh-one",
        })
        const batch = await test.services.dispatch("cases.refreshBatch", {
            datasetId: "dataset-1",
            scope: "goodcase",
            idempotencyKey: "refresh-good",
        })

        assert.deepEqual(test.refreshes.map((entry) => entry.caseId), ["case-2", "case-3"])
        assert.deepEqual(batch, {
            scope: "goodcase",
            eligibleCount: 1,
            skipped: [{caseId: "case-1", reason: "refresh-in-progress"}],
            sessions: [{id: "refresh-case-3", operation: "refresh", targetCaseId: "case-3"}],
        })
    })

    it("retains already created batch Drafts when a later Case replay fails", async () => {
        const test = fixture()
        const create = test.refreshManager.createSession
        test.refreshManager.createSession = async (input) => {
            if (input.caseId === "case-2") throw new Error("Runtime unavailable")
            return create(input)
        }
        const result = await test.services.dispatch("cases.refreshBatch", {datasetId: "dataset-1", scope: "all", idempotencyKey: "partial"})
        assert.deepEqual(result.sessions.map((session) => session.id), ["refresh-case-3"])
        assert.deepEqual(result.failures, [{caseId: "case-2", error: "Runtime unavailable"}])
    })

    it("exports CSV and dispatches or recycles Raw Cases", async () => {
        const test = fixture()
        const exported = await test.services.dispatch("datasets.exportCsv", {
            datasetId: "dataset-1",
            caseScope: "goodcase",
            outputMode: "original",
        })
        assert.equal(exported.filename, "Billing-cases-goodcases-original.csv")
        assert.equal(exported.caseCount, 2)
        assert.equal(exported.missingOriginalCount, 1)
        assert.match(exported.content, /original 3/u)

        await test.services.dispatch("rawCases.dispatch", {
            id: "raw-1",
            target: "new",
            idempotencyKey: "dispatch-raw-1",
        })
        await test.services.dispatch("rawCases.update", {
            id: "raw-1",
            expectedRevision: 2,
            expectedSkillName: "billing",
            changes: {question: "new question"},
            idempotencyKey: "update-raw-1",
        })
        await test.services.dispatch("rawCases.update", {
            id: "raw-1",
            expectedRevision: 2,
            expectedSkillName: "billing",
            changes: {question: "new question"},
            idempotencyKey: "update-raw-1",
        })
        await test.services.dispatch("rawCases.recycle", {
            id: "raw-2",
            idempotencyKey: "recycle-raw-2",
        })
        assert.deepEqual(test.rawDispatches[0], {
            id: "raw-1",
            dispatch: {mode: "new", sessionId: "thread-1", status: "queued", target: "new"},
        })
        assert.deepEqual(test.rawDeletes, ["raw-2"])
        assert.deepEqual(test.rawUpdates, [{
            id: "raw-1",
            expected: {expectedRevision: 2, expectedSkillName: "billing"},
            changes: {question: "new question"},
        }])
    })
})
