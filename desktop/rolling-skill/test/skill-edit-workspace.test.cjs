const assert = require("node:assert/strict")
const {
    existsSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {dirname, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {SkillEditWorkspaceManager} = require("../src/skill-edit-workspace.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-edit-workspace-"))
    temporaryDirectories.push(directory)
    return directory
}

function manifest(name, body = "Use this Skill.") {
    return `---\nname: ${name}\ndescription: ${name} test Skill\n---\n\n${body}\n`
}

function write(path, contents) {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, contents)
}

describe("Skill edit workspace manager", () => {
    it("copies only the selected Skill and computes bounded file diffs", async () => {
        const root = temporaryDirectory()
        const repository = join(root, "repository")
        const sourceRoot = join(repository, "skills", "one")
        write(join(sourceRoot, "SKILL.md"), manifest("one", "Original instructions."))
        write(join(sourceRoot, "references", "guide.md"), "Original guide\n")
        write(join(repository, "skills", "two", "SKILL.md"), manifest("two"))
        const manager = new SkillEditWorkspaceManager({
            workspacesRoot: join(root, "workspaces"),
            maxPatchBytes: 32_768,
            maxTotalPatchBytes: 65_536,
        })

        const created = await manager.create({
            sessionId: "edit-1",
            sourceRoot,
            skillName: "one",
        })

        assert.equal(existsSync(join(created.workspacePath, "SKILL.md")), true)
        assert.equal(existsSync(join(created.workspacePath, "skills", "two")), false)
        writeFileSync(join(created.workspacePath, "SKILL.md"), manifest("one", "Changed instructions."))
        writeFileSync(join(created.workspacePath, "new.txt"), "new\n")
        const diff = await manager.diff("edit-1")

        assert.deepEqual(diff.files.map(({path, status}) => [path, status]), [
            ["SKILL.md", "modified"],
            ["new.txt", "added"],
        ])
        assert.equal(diff.changed, true)
        assert.match(diff.files[0].patch, /Changed instructions/u)
        assert.match(diff.currentSnapshotDigest, /^sha256:[a-f0-9]{64}$/u)
        assert.equal(JSON.stringify(diff).includes(created.workspacePath), false)
        assert.equal((await manager.validate("edit-1")).skill.name, "one")
    })

    it("rejects escaped symlinks before copying any Skill content", async () => {
        const root = temporaryDirectory()
        const sourceRoot = join(root, "repository", "skill")
        const outside = join(root, "outside.txt")
        write(join(sourceRoot, "SKILL.md"), manifest("linked"))
        write(outside, "secret\n")
        symlinkSync(outside, join(sourceRoot, "escape.txt"))
        const manager = new SkillEditWorkspaceManager({
            workspacesRoot: join(root, "workspaces"),
        })

        await assert.rejects(
            () => manager.create({sessionId: "edit-escape", sourceRoot, skillName: "linked"}),
            /outside/iu,
        )
        assert.equal(existsSync(join(root, "workspaces", "edit-escape")), false)
    })

    it("bounds patches while preserving complete file metadata", async () => {
        const root = temporaryDirectory()
        const sourceRoot = join(root, "skill")
        write(join(sourceRoot, "SKILL.md"), manifest("bounded"))
        const manager = new SkillEditWorkspaceManager({
            workspacesRoot: join(root, "workspaces"),
            maxPatchBytes: 128,
            maxTotalPatchBytes: 128,
        })
        const created = await manager.create({
            sessionId: "edit-bounded",
            sourceRoot,
            skillName: "bounded",
        })
        writeFileSync(join(created.workspacePath, "large.txt"), "x".repeat(4_096))

        const diff = await manager.diff("edit-bounded")

        assert.equal(diff.files[0].path, "large.txt")
        assert.equal(diff.files[0].truncated, true)
        assert.equal(Buffer.byteLength(diff.files[0].patch), 128)
        assert.equal(diff.truncated, true)
    })
})
