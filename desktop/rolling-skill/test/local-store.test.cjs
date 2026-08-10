const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {LocalEvaluationStore} = require("../src/local-store.cjs")

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

describe("local evaluation store", () => {
    it("starts with manual capture disabled and a default dataset", () => {
        const {store} = fixture()
        const snapshot = store.read()
        assert.equal(snapshot.settings.autoCapture, false)
        assert.equal(snapshot.datasets.length, 1)
        assert.equal(snapshot.datasets[0].name, "Skill evaluation cases")
        assert.deepEqual(snapshot.cases, [])
    })

    it("atomically persists a classified case with full local provenance", () => {
        const {path, store} = fixture()
        const dataset = store.read().datasets[0]
        const saved = store.saveCase({
            datasetId: dataset.id,
            caseType: "badcase",
            question: "Why did the Skill not run?",
            answer: "The runtime skipped it.",
            threadId: "thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            traceReference: "trace://runtime/session.jsonl#42",
        })

        assert.equal(saved.caseType, "badcase")
        assert.equal(saved.source.threadId, "thread-1")
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
        const dataset = store.createDataset("Billing Skill regression")
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
})
