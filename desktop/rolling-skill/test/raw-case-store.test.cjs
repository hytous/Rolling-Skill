const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    RAW_CASE_EVENT_SCHEMA,
    RawCaseStore,
    defaultRawCaseEventsPath,
    readRawCaseEvents,
} = require("../src/raw-case-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-raw-cases-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "nested", "raw-case-events.jsonl")
    return {path, store: new RawCaseStore(path)}
}

function input(question = "查一下七月混元 3 的成本") {
    return {
        question,
        skill: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
        note: "等账期稳定后验证",
        source: {kind: "manual"},
    }
}

describe("raw case event store", () => {
    it("uses an independent Application Support JSONL file by default", () => {
        const path = defaultRawCaseEventsPath({homeDirectory: "/Users/tester", platform: "darwin"})
        assert.equal(
            path,
            "/Users/tester/Library/Application Support/Rolling Skill/raw-case-events.jsonl",
        )
    })

    it("appends versioned events with private filesystem permissions", () => {
        const {path, store} = fixture()

        const created = store.add(input())
        const lines = readFileSync(path, "utf8").trim().split("\n").map(JSON.parse)

        assert.equal(created.question, "查一下七月混元 3 的成本")
        assert.equal(lines.length, 1)
        assert.equal(lines[0].schemaVersion, RAW_CASE_EVENT_SCHEMA)
        assert.equal(lines[0].type, "added")
        assert.equal(lines[0].rawCase.id, created.id)
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700)
        store.close()
    })

    it("reduces add, update, dispatch, and delete events to pending records", () => {
        const {store} = fixture()
        const first = store.add(input("问题一"))
        const second = store.add(input("问题二"))

        const updated = store.update(first.id, {question: "问题一（修订）", note: "新备注"})
        assert.equal(updated.question, "问题一（修订）")
        assert.equal(updated.note, "新备注")
        assert.deepEqual(store.list().map((entry) => entry.id), [second.id, first.id])

        store.markDispatched(first.id, {threadId: "thread-1", mode: "new"})
        assert.deepEqual(store.list().map((entry) => entry.id), [second.id])

        store.delete(second.id)
        assert.deepEqual(store.list(), [])
        store.close()
    })

    it("assigns monotonic revisions while preserving legacy added and updated events", () => {
        const {path, store} = fixture()
        const created = store.add(input("legacy question"))
        store.update(created.id, {question: "legacy update"})
        const legacyEvents = readFileSync(path, "utf8")
            .trim()
            .split("\n")
            .map(JSON.parse)
        delete legacyEvents[0].rawCase.revision
        delete legacyEvents[1].expectedRevision
        delete legacyEvents[1].expectedSkillName
        writeFileSync(path, `${legacyEvents.map(JSON.stringify).join("\n")}\n`, "utf8")

        const reopened = new RawCaseStore(path)
        const legacyRecord = reopened.get(created.id)

        assert.equal(legacyRecord.question, "legacy update")
        assert.equal(legacyRecord.revision, 2)
        reopened.close()
    })

    it("atomically rejects a stale revision and owner without appending an effective update", () => {
        const {path, store} = fixture()
        const created = store.add(input("original"))

        const first = store.updateIfCurrent(created.id, {
            expectedRevision: created.revision,
            expectedSkillName: created.skill.name,
        }, {
            question: "owner B update",
            skill: {name: "owner-b"},
        })
        const eventCountAfterFirst = readRawCaseEvents(path).events.length
        let conflict
        assert.throws(() => store.updateIfCurrent(created.id, {
            expectedRevision: created.revision,
            expectedSkillName: created.skill.name,
        }, {
            question: "stale owner C update",
            skill: {name: "owner-c"},
        }), (error) => {
            conflict = error
            return true
        })

        assert.equal(created.revision, 1)
        assert.equal(first.revision, 2)
        assert.equal(first.skill.name, "owner-b")
        assert.equal(conflict.code, "RAW_CASE_CONFLICT")
        assert.equal(readRawCaseEvents(path).events.length, eventCountAfterFirst)
        assert.equal(store.get(created.id).question, "owner B update")
        assert.equal(store.get(created.id).skill.name, "owner-b")
        store.close()
    })

    it("ignores a persisted stale update event during reduction", () => {
        const {path, store} = fixture()
        const created = store.add(input("original"))
        const current = store.updateIfCurrent(created.id, {
            expectedRevision: created.revision,
            expectedSkillName: created.skill.name,
        }, {question: "current"})
        const staleEvent = {
            schemaVersion: RAW_CASE_EVENT_SCHEMA,
            eventId: "stale-event",
            occurredAt: new Date().toISOString(),
            type: "updated",
            rawCaseId: created.id,
            expectedRevision: 1,
            expectedSkillName: created.skill.name,
            changes: {question: "stale replay"},
        }
        writeFileSync(path, `${readFileSync(path, "utf8")}${JSON.stringify(staleEvent)}\n`, "utf8")

        const reopened = new RawCaseStore(path)
        const reduced = reopened.get(created.id)

        assert.equal(current.revision, 2)
        assert.equal(reduced.revision, 2)
        assert.equal(reduced.question, "current")
        reopened.close()
    })

    it("deduplicates pending questions by trimmed text and normalized Skill name", () => {
        const {store} = fixture()
        const first = store.add(input("  同一个问题  "))
        const duplicate = store.add({
            ...input("同一个问题"),
            skill: {name: " Billing-Cost-Management "},
        })
        const differentSkill = store.add({
            ...input("同一个问题"),
            skill: {name: "another-skill"},
        })

        assert.equal(duplicate.created, false)
        assert.equal(duplicate.duplicateOf, first.id)
        assert.equal(differentSkill.question, "同一个问题")
        assert.equal(store.list().length, 2)
        store.close()
    })

    it("preserves intentional Raw Case question whitespace across add, batch, and update", () => {
        const {store} = fixture()
        const addedQuestion = "\n  first line\nsecond line with trailing spaces  \n"
        const batchQuestion = "  batch question\t\n"
        const updatedQuestion = "\n updated question  \n"

        const added = store.add(input(addedQuestion))
        const batch = store.addMany([input(batchQuestion)])
        const updated = store.update(added.id, {question: updatedQuestion})

        assert.equal(added.question, addedQuestion)
        assert.equal(batch.created[0].question, batchQuestion)
        assert.equal(updated.question, updatedQuestion)
        assert.equal(store.get(added.id).question, updatedQuestion)
        store.close()
    })

    it("uses trimmed question text only for blank checks and deduplication", () => {
        const {store} = fixture()
        const first = store.add(input("\n  same question  \n"))
        const duplicate = store.add(input("same question"))

        assert.equal(first.question, "\n  same question  \n")
        assert.equal(duplicate.created, false)
        assert.equal(duplicate.duplicateOf, first.id)
        assert.throws(() => store.add(input(" \n\t ")), /question/u)
        store.close()
    })

    it("applies the question length limit to the original unmodified text", () => {
        const {store} = fixture()
        const oversizedOnlyBecauseOfWhitespace = ` ${"x".repeat(119_999)} `

        assert.equal(oversizedOnlyBecauseOfWhitespace.length, 120_001)
        assert.throws(() => store.add(input(oversizedOnlyBecauseOfWhitespace)), /120000/u)
        store.close()
    })

    it("supports bounded batch insertion and reports duplicate and rejected rows", () => {
        const {store} = fixture()
        const result = store.addMany([
            input("批量问题一"),
            input("批量问题一"),
            input(" "),
            input("批量问题二"),
        ])

        assert.equal(result.created.length, 2)
        assert.equal(result.duplicates.length, 1)
        assert.equal(result.rejected.length, 1)
        assert.equal(store.list().length, 2)
        assert.throws(
            () => store.addMany(Array.from({length: 201}, (_, index) => input(`问题 ${index}`))),
            /200/,
        )
        store.close()
    })

    it("validates field and aggregate limits without mutating the log", () => {
        const {path, store} = fixture()
        assert.throws(() => store.add(input("x".repeat(120_001))), /120000/)
        assert.throws(() => store.add({...input(), skill: {name: " "}}), /Skill name/)
        assert.equal(readRawCaseEvents(path).events.length, 0)
        assert.throws(
            () => store.addMany(
                Array.from({length: 9}, (_, index) => input(`${index}${"x".repeat(119_999)}`)),
            ),
            /1000000/,
        )
        store.close()
    })

    it("ignores malformed complete and partial JSONL records with indexed warnings", () => {
        const {path, store} = fixture()
        const first = store.add(input("合法问题"))
        store.close()
        writeFileSync(path, `${readFileSync(path, "utf8")}not-json\n{\"partial\":`, "utf8")

        const parsed = readRawCaseEvents(path)
        const reopened = new RawCaseStore(path)

        assert.equal(parsed.events.length, 1)
        assert.equal(parsed.warnings.length, 2)
        assert.match(parsed.warnings[0].message, /line 2/i)
        assert.match(parsed.warnings[1].message, /line 3/i)
        assert.equal(reopened.list()[0].id, first.id)
        reopened.close()
    })

    it("filters pending records by normalized Skill name", () => {
        const {store} = fixture()
        store.add(input("账单问题"))
        store.add({...input("别的问题"), skill: {name: "other"}})

        assert.deepEqual(
            store.list({skillName: " BILLING-COST-MANAGEMENT "}).map((entry) => entry.question),
            ["账单问题"],
        )
        store.close()
    })
})
