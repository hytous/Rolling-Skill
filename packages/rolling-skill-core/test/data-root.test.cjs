const assert = require("node:assert/strict")
const {mkdtempSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {isAbsolute, join} = require("node:path")
const {describe, it} = require("node:test")

const modulePath = "../src/data-root.cjs"

describe("Rolling Skill DSH data root", () => {
    it("keeps every durable path under the explicit data root", () => {
        const {ensureDataLayout, resolveDataPaths} = require(modulePath)
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-root-"))
        const paths = resolveDataPaths({
            dataRoot: root,
            homeDirectory: "/unused/home",
            environment: {DSH_HOME: "/unused/dsh"},
        })

        assert.equal(paths.root, root)
        assert.equal(paths.dshConversationTraces, join(root, "traces", "dsh-conversations"))
        assert.equal(paths.rawCaseEvidence, join(root, "raw-cases", "evidence"))
        assert.equal(paths.skillEdits, join(root, "jobs", "skill-edits.json"))
        assert.equal(paths.skillEditWorkspaces, join(root, "skill-edit-workspaces"))
        for (const [key, value] of Object.entries(paths)) {
            assert.equal(isAbsolute(value), true, `${key} should be absolute`)
            assert.equal(value === root || value.startsWith(`${root}/`), true, `${key} escaped root`)
        }

        ensureDataLayout(paths)
        for (const directory of [paths.root, paths.rawCases, paths.managedSkills, paths.skillEditWorkspaces, paths.traces, paths.jobs, paths.logs, paths.locks, paths.scheduler]) {
            assert.equal(statSync(directory).isDirectory(), true)
            assert.equal(statSync(directory).mode & 0o777, 0o700)
        }
    })

    it("uses DSH_HOME before the home-directory fallback", () => {
        const {resolveDataPaths} = require(modulePath)
        assert.equal(resolveDataPaths({
            homeDirectory: "/Users/example",
            environment: {DSH_HOME: "/srv/dsh"},
        }).root, "/srv/dsh/rolling-skill")
        assert.equal(resolveDataPaths({
            homeDirectory: "/Users/example",
            environment: {},
        }).root, "/Users/example/.dsh/rolling-skill")
    })

    it("rejects a relative explicit root", () => {
        const {resolveDataPaths} = require(modulePath)
        assert.throws(() => resolveDataPaths({dataRoot: "relative/root"}), /absolute/u)
    })
})
