const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {acquireRunLease} = require("../src/run-lease.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-lease-"))
    directories.push(root)
    return root
}

describe("Rolling Skill cross-process run lease", () => {
    it("creates one exclusive lease and rejects a live owner", async () => {
        const directory = fixture()
        const first = await acquireRunLease(directory, {
            slot: "2026-08-26T09:00:00.000Z",
            pid: 123,
            isProcessAlive: () => true,
        })
        await assert.rejects(() => acquireRunLease(directory, {
            slot: first.slot,
            pid: 456,
            isProcessAlive: () => true,
        }), (error) => error?.code === "LEASE_BUSY")
        await first.release()
        const second = await acquireRunLease(directory, {
            slot: "2026-08-26T09:00:00.000Z",
            pid: 456,
            isProcessAlive: () => true,
        })
        await second.release()
    })

    it("recovers a dead or stale owner without deleting a replacement lease", async () => {
        const directory = fixture()
        const lockPath = join(directory, "automatic-capture.lock")
        writeFileSync(lockPath, `${JSON.stringify({
            schemaVersion: "rolling-skill-run-lease/v1",
            token: "stale-token",
            slot: "2026-08-25T09:00:00.000Z",
            pid: 111,
            acquiredAt: "2026-08-25T09:00:00.000Z",
        })}\n`, {mode: 0o600})
        const recovered = await acquireRunLease(directory, {
            slot: "2026-08-26T09:00:00.000Z",
            pid: 222,
            now: () => new Date("2026-08-26T09:00:00.000Z"),
            isProcessAlive: () => false,
        })
        const persisted = JSON.parse(readFileSync(lockPath, "utf8"))
        assert.equal(persisted.pid, 222)
        assert.equal(recovered.recovered, true)
        writeFileSync(lockPath, `${JSON.stringify({...persisted, token: "replacement-token"})}\n`)
        assert.equal(await recovered.release(), false)
        assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).token, "replacement-token")
    })

    it("rejects malformed active lease data safely", async () => {
        const directory = fixture()
        writeFileSync(join(directory, "automatic-capture.lock"), "not-json\n")
        await assert.rejects(() => acquireRunLease(directory, {
            slot: "2026-08-26T09:00:00.000Z",
        }), (error) => error?.code === "LEASE_BUSY")
    })
})
