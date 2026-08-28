const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    RAW_CASE_EVENT_SCHEMA,
    RawCaseConflictError,
    RawCaseStore,
    defaultRawCaseEventsPath,
    readRawCaseEvents,
    reduceRawCaseEvents,
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

function automaticInput(threadId, question = "查一下七月混元 3 的成本") {
    return {
        question,
        skill: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
        note: "Automatically discovered",
        source: {
            kind: "automatic_capture",
            runtimeId: "codex:/opt/codex-a",
            threadId,
            startTurnId: `turn-${threadId}-1`,
            startItemId: `user-${threadId}-1`,
            endTurnId: `turn-${threadId}-2`,
            endItemId: `agent-${threadId}-2`,
            outcome: "resolved",
            caseType: "goodcase",
            confidence: 0.91,
            inspectedAt: "2026-08-26T03:00:00.000Z",
        },
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

    it("accepts only the caller's event when two store instances interleave one revision", () => {
        const {path, store: firstStore} = fixture()
        const secondStore = new RawCaseStore(path)
        const created = firstStore.add(input("original"))
        const appendFirst = firstStore.append.bind(firstStore)
        let winner
        firstStore.append = (event) => {
            winner = secondStore.updateIfCurrent(created.id, {
                expectedRevision: created.revision,
                expectedSkillName: created.skill.name,
            }, {question: "second store wins"})
            return appendFirst(event)
        }

        let loserResult = null
        assert.throws(() => {
            loserResult = firstStore.updateIfCurrent(created.id, {
                expectedRevision: created.revision,
                expectedSkillName: created.skill.name,
            }, {question: "first store loses"})
        }, (error) => error.code === "RAW_CASE_CONFLICT")

        assert.equal(winner.question, "second store wins")
        assert.equal(winner.revision, 2)
        assert.equal(loserResult, null)
        assert.equal(firstStore.get(created.id).question, "second store wins")
        assert.equal(firstStore.get(created.id).revision, 2)
        assert.equal(readRawCaseEvents(path).events.length, 3)
        firstStore.close()
        secondStore.close()
    })

    it("tracks only the last applied event internally and never publishes its event ID", () => {
        const events = [
            {
                schemaVersion: RAW_CASE_EVENT_SCHEMA,
                eventId: "added-event",
                type: "added",
                rawCase: {
                    id: "raw-1",
                    question: "original",
                    skill: {name: "billing"},
                    revision: 1,
                },
            },
            {
                schemaVersion: RAW_CASE_EVENT_SCHEMA,
                eventId: "winner-event",
                type: "updated",
                rawCaseId: "raw-1",
                expectedRevision: 1,
                expectedSkillName: "billing",
                changes: {question: "winner"},
            },
            {
                schemaVersion: RAW_CASE_EVENT_SCHEMA,
                eventId: "stale-event",
                type: "updated",
                rawCaseId: "raw-1",
                expectedRevision: 1,
                expectedSkillName: "billing",
                changes: {question: "stale"},
            },
        ]
        const reduced = reduceRawCaseEvents(events)
        const {path, store} = fixture()
        store.append({type: "test-directory-initialization"})
        writeFileSync(path, `${events.map(JSON.stringify).join("\n")}\n`, "utf8")

        assert.equal(reduced[0].question, "winner")
        assert.equal(reduced[0]._lastAppliedEventId, "winner-event")
        assert.equal(Object.hasOwn(store.get("raw-1"), "_lastAppliedEventId"), false)
        store.close()
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

    it("merges unique automatic episode observations into one pending question", () => {
        const {store} = fixture()

        const first = store.addAutomaticCandidate(automaticInput("thread-1"))
        const second = store.addAutomaticCandidate(automaticInput("thread-2"))
        const repeated = store.addAutomaticCandidate(automaticInput("thread-2"))
        const records = store.list()

        assert.equal(first.created, true)
        assert.equal(first.observed, true)
        assert.equal(second.created, false)
        assert.equal(second.observed, true)
        assert.equal(second.duplicateOf, first.rawCase.id)
        assert.equal(repeated.observed, false)
        assert.equal(records.length, 1)
        assert.equal(records[0].source.kind, "automatic_capture")
        assert.deepEqual(
            records[0].source.observations.map((entry) => entry.threadId),
            ["thread-1", "thread-2"],
        )
        store.close()
    })

    it("persists only validated optional automatic Episode evidence references", () => {
        const {store} = fixture()
        const reference = {
            schemaVersion: "rolling-skill-automatic-evidence-reference/v1",
            digest: `sha256:${"a".repeat(64)}`,
        }

        const created = store.addAutomaticCandidate({
            ...automaticInput("thread-evidence"),
            source: {...automaticInput("thread-evidence").source, evidence: reference},
        })

        assert.deepEqual(created.rawCase.source.observations[0].evidence, reference)
        assert.throws(() => store.addAutomaticCandidate({
            ...automaticInput("thread-invalid"),
            source: {
                ...automaticInput("thread-invalid").source,
                evidence: {...reference, digest: "sha256:not-a-digest"},
            },
        }), /evidence digest/u)
        assert.equal(store.addAutomaticCandidate(automaticInput("thread-legacy")).observed, true)
        store.close()
    })

    it("keeps normal duplicate behavior from mutating source observations", () => {
        const {store} = fixture()
        const created = store.add(input("manual duplicate"))
        const duplicate = store.add({...input(" manual duplicate "), source: {kind: "cli"}})

        assert.equal(duplicate.created, false)
        assert.equal(duplicate.duplicateOf, created.id)
        assert.deepEqual(store.get(created.id).source, {kind: "manual"})
        store.close()
    })

    it("retries one automatic observation compare-and-set conflict from the latest record", () => {
        const {store} = fixture()
        const first = store.addAutomaticCandidate(automaticInput("thread-1"))
        const updateIfCurrent = store.updateIfCurrent.bind(store)
        let attempts = 0
        store.updateIfCurrent = (...args) => {
            attempts += 1
            if (attempts === 1) {
                const current = store.get(first.rawCase.id)
                updateIfCurrent(first.rawCase.id, {
                    expectedRevision: current.revision,
                    expectedSkillName: current.skill.name,
                }, {note: "concurrent edit"})
                throw new RawCaseConflictError()
            }
            return updateIfCurrent(...args)
        }

        const merged = store.addAutomaticCandidate(automaticInput("thread-2"))

        assert.equal(attempts, 2)
        assert.equal(merged.rawCase.note, "concurrent edit")
        assert.deepEqual(
            merged.rawCase.source.observations.map((entry) => entry.threadId),
            ["thread-1", "thread-2"],
        )
        store.close()
    })

    it("persists bounded stable Skill IDs and deduplicates ID-owned records by ID", () => {
        const {store} = fixture()
        const first = store.add({
            ...input("same question"),
            skill: {id: "skill-1", name: "Billing"},
        })
        const sameNameDifferentId = store.add({
            ...input("same question"),
            skill: {id: "skill-2", name: " billing "},
        })
        const sameIdDifferentName = store.add({
            ...input(" same question "),
            skill: {id: "skill-1", name: "renamed-billing"},
        })

        assert.equal(first.skill.id, "skill-1")
        assert.equal(store.get(first.id).skill.id, "skill-1")
        assert.equal(sameNameDifferentId.skill.id, "skill-2")
        assert.equal(sameIdDifferentName.created, false)
        assert.equal(sameIdDifferentName.duplicateOf, first.id)
        for (const id of ["", " skill-1 ", "skill\n1", "x".repeat(201)]) {
            assert.throws(() => store.add({
                ...input(`invalid id ${JSON.stringify(id)}`),
                skill: {id, name: "billing"},
            }), /Skill ID/u)
        }
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
