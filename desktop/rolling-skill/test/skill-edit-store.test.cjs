const assert = require("node:assert/strict")
const {mkdtempSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {SkillEditStore} = require("../src/skill-edit-store.cjs")

function input(root, overrides = {}) {
    return {
        repositoryId: "repository-1",
        skillId: "skill-1",
        skillRoot: ".",
        baseCommit: "a".repeat(40),
        baseContentDigest: `sha256:${"b".repeat(64)}`,
        baseSnapshotDigest: `sha256:${"c".repeat(64)}`,
        workspacePath: join(root, "workspaces", "edit-1"),
        runtime: {
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
        },
        objective: "Tighten the Skill instructions",
        ...overrides,
    }
}

describe("Skill edit store", () => {
    it("persists one active edit per Skill with revision checks", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-edit-store-"))
        const path = join(root, "skill-edits.json")
        const store = new SkillEditStore(path)
        const created = store.create(input(root))

        assert.equal(created.state, "draft")
        assert.equal(created.revision, 1)
        assert.equal(store.activeForSkill("skill-1").id, created.id)
        assert.throws(() => store.create(input(root)), /active edit session/iu)
        assert.throws(
            () => store.update(created.id, 99, {state: "idle"}),
            error => error.code === "RESOURCE_CHANGED" && /changed since/iu.test(error.message),
        )

        const running = store.update(created.id, created.revision, {
            state: "running",
            operatorSessionId: "operator-1",
        })
        assert.equal(running.revision, 2)
        assert.equal(running.operatorSessionId, "operator-1")

        const reloaded = new SkillEditStore(path)
        assert.equal(reloaded.get(created.id).state, "running")
        assert.equal(reloaded.list({skillId: "skill-1"}).length, 1)
        assert.equal(statSync(path).mode & 0o777, 0o600)
    })

    it("closes an edit before allowing a replacement for the same Skill", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-edit-close-"))
        const store = new SkillEditStore(join(root, "skill-edits.json"))
        const created = store.create(input(root))
        const closed = store.close(created.id, created.revision, {
            state: "published",
            publishedVersion: {id: "version-1", label: "1.0.0"},
        })

        assert.equal(closed.state, "published")
        assert.equal(store.activeForSkill("skill-1"), null)
        assert.equal(store.create(input(root, {workspacePath: join(root, "edit-2")})).state, "draft")
        assert.throws(
            () => store.close(created.id, closed.revision, {state: "idle"}),
            /terminal state/iu,
        )
    })
})
