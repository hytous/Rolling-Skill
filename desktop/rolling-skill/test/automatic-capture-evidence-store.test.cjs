const assert = require("node:assert/strict")
const {
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA,
    AutomaticCaptureEvidenceStore,
} = require("../src/automatic-capture-evidence-store.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-automatic-evidence-"))
    directories.push(directory)
    const root = join(directory, "raw-cases", "evidence")
    return {root, store: new AutomaticCaptureEvidenceStore(root)}
}

function episode() {
    return {
        schemaVersion: "rolling-skill-episode/v1",
        originalQuestion: "查本月账单",
        source: {
            runtimeId: "codex:/opt/codex",
            threadId: "thread-1",
            startTurnId: "turn-1",
            startItemId: "user-1",
            endTurnId: "turn-1",
            endItemId: "agent-1",
        },
        items: [
            {id: "user-1", turnId: "turn-1", type: "userMessage", text: "查本月账单"},
            {id: "agent-1", turnId: "turn-1", type: "agentMessage", text: "本月 100 元"},
        ],
        toolActivity: [],
        capturedAt: "2026-08-28T10:00:00.000Z",
    }
}

describe("automatic capture Episode evidence store", () => {
    it("deduplicates stable private snapshots by content digest", () => {
        const {root, store} = fixture()

        const first = store.save(episode())
        const second = store.save(structuredClone(episode()))
        const path = store.pathFor(first)

        assert.deepEqual(first, second)
        assert.equal(first.schemaVersion, AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA)
        assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u)
        assert.deepEqual(store.read(first), episode())
        assert.equal(statSync(root).mode & 0o777, 0o700)
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(readFileSync(path, "utf8").endsWith("\n"), true)
    })

    it("rejects malformed references, unsupported Episodes, and changed files", () => {
        const {store} = fixture()

        assert.throws(
            () => store.save({...episode(), schemaVersion: "other/v1"}),
            /Episode schema/u,
        )
        assert.throws(
            () => store.read({schemaVersion: AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA, digest: "bad"}),
            /digest/u,
        )

        const reference = store.save(episode())
        writeFileSync(store.pathFor(reference), "{}\n", "utf8")

        assert.throws(() => store.read(reference), /digest/u)
    })
})
