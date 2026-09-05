const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {AutomaticCaptureStateStore} = require("../src/automatic-capture-state-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-capture-state-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "private", "capture-state.json")
    return {path, store: new AutomaticCaptureStateStore(path)}
}

describe("automatic capture private state store", () => {
    it("creates owner-only state and keeps returned values detached", () => {
        const {path, store} = fixture()
        const snapshot = store.read()

        assert.deepEqual(snapshot, {
            schemaVersion: "rolling-skill-automatic-capture-state/v1",
            lastScheduledSlot: null,
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: null,
            runtimes: {},
        })
        snapshot.runtimes.changed = true
        assert.deepEqual(store.read().runtimes, {})
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(JSON.parse(readFileSync(path, "utf8")).schemaVersion, snapshot.schemaVersion)
    })

    it("separates Runtime and thread cursors while preserving pending tails", () => {
        const {path, store} = fixture()

        store.commitThread("codex:/opt/codex-a", "thread-1", {
            lastInspectedUserItemId: "user-3",
            pendingStartUserItemId: "user-2",
            checkedRanges: [{startUserItemId: "user-1", endUserItemId: "user-1"}],
        }, "2026-08-26T01:00:00.000Z")
        store.commitThread("codex:/opt/codex-b", "thread-1", {
            lastInspectedUserItemId: "user-8",
            pendingStartUserItemId: null,
        }, "2026-08-26T02:00:00.000Z")

        assert.deepEqual(store.thread("codex:/opt/codex-a", "thread-1"), {
            lastInspectedUserItemId: "user-3",
            pendingStartUserItemId: "user-2",
            checkedRanges: [{startUserItemId: "user-1", endUserItemId: "user-1"}],
            updatedAt: "2026-08-26T01:00:00.000Z",
        })
        assert.equal(store.thread("codex:/opt/codex-b", "thread-1").lastInspectedUserItemId, "user-8")
        assert.equal(store.read().runtimes["codex:/opt/codex-c"], undefined)
        assert.equal(new AutomaticCaptureStateStore(path).thread("codex:/opt/codex-a", "thread-1").pendingStartUserItemId, "user-2")
    })

    it("records slot attempts, success, and errors without satisfying failed slots", () => {
        const {store} = fixture()
        const slot = "2026-08-26T01:00:00.000Z"

        store.beginSlot(slot, "2026-08-26T01:01:00.000Z")
        assert.equal(store.read().lastScheduledSlot, null)
        assert.equal(store.read().lastRunAt, "2026-08-26T01:01:00.000Z")
        store.failSlot(new Error("Runtime unavailable"), "2026-08-26T01:02:00.000Z")
        assert.deepEqual(store.read().lastError, {
            message: "Runtime unavailable",
            at: "2026-08-26T01:02:00.000Z",
        })
        assert.equal(store.read().lastScheduledSlot, null)

        store.completeSlot(slot, "2026-08-26T01:03:00.000Z")
        assert.equal(store.read().lastScheduledSlot, slot)
        assert.equal(store.read().lastSuccessAt, "2026-08-26T01:03:00.000Z")
        assert.equal(store.read().lastError, null)
    })

    it("clears only the persisted error without changing schedule or thread progress", () => {
        const {store} = fixture()
        const slot = "2026-08-26T01:00:00.000Z"
        store.completeSlot(slot, "2026-08-26T01:01:00.000Z")
        store.commitThread("codex:/opt/codex-a", "thread-1", {
            lastInspectedUserItemId: "user-1",
        }, "2026-08-26T01:01:30.000Z")
        store.failSlot(new Error("Obsolete route error"), "2026-08-26T01:02:00.000Z")

        store.clearError()
        store.clearError()

        const state = store.read()
        assert.equal(state.lastError, null)
        assert.equal(state.lastScheduledSlot, slot)
        assert.equal(state.lastRunAt, "2026-08-26T01:02:00.000Z")
        assert.equal(state.lastSuccessAt, "2026-08-26T01:01:00.000Z")
        assert.equal(
            store.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId,
            "user-1",
        )
    })
})
