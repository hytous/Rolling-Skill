const assert = require("node:assert/strict")
const {mkdirSync, mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {findGitWorkspace, isGitWorkspace} = require("../src/workspace.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture(marker = "directory") {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-workspace-"))
    temporaryDirectories.push(root)
    if (marker === "directory") mkdirSync(join(root, ".git"))
    else writeFileSync(join(root, ".git"), "gitdir: /tmp/worktree\n")
    mkdirSync(join(root, "nested", "folder"), {recursive: true})
    return root
}

describe("workspace discovery", () => {
    it("recognises regular repositories and Git worktrees", () => {
        assert.equal(isGitWorkspace(fixture("directory")), true)
        assert.equal(isGitWorkspace(fixture("file")), true)
    })

    it("walks upward from a nested file or directory", () => {
        const root = fixture()
        const file = join(root, "nested", "folder", "entry.js")
        writeFileSync(file, "")

        assert.equal(findGitWorkspace([file]), root)
        assert.equal(findGitWorkspace([join(root, "nested")]), root)
    })

    it("returns null when no Git workspace is present", () => {
        const empty = mkdtempSync(join(tmpdir(), "rolling-skill-empty-"))
        temporaryDirectories.push(empty)
        assert.equal(findGitWorkspace([empty]), null)
    })
})
