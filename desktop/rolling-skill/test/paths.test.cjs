const assert = require("node:assert/strict")
const {mkdirSync, writeFileSync} = require("node:fs")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")
const {tmpdir} = require("node:os")
const {mkdtempSync, rmSync} = require("node:fs")

const {findRepositoryRoot, isRepositoryRoot} = require("../src/paths.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function makeRepository() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-repo-"))
    temporaryDirectories.push(root)
    mkdirSync(join(root, "hosting", "docker-compose"), {recursive: true})
    writeFileSync(join(root, "hosting", "docker-compose", "run.sh"), "#!/bin/bash\n")
    mkdirSync(join(root, "desktop", "rolling-skill", "dist", "mac-arm64"), {recursive: true})
    return root
}

describe("repository discovery", () => {
    it("recognises a checkout only when the Compose runner exists", () => {
        const root = makeRepository()
        assert.equal(isRepositoryRoot(root), true)
        assert.equal(isRepositoryRoot(join(root, "desktop")), false)
    })

    it("walks upward from an app bundle candidate", () => {
        const root = makeRepository()
        const bundle = join(root, "desktop", "rolling-skill", "dist", "mac-arm64")
        assert.equal(findRepositoryRoot([bundle]), root)
    })

    it("prefers the first valid candidate and ignores missing saved paths", () => {
        const root = makeRepository()
        assert.equal(findRepositoryRoot([join(root, "missing"), join(root, "desktop")]), root)
    })

    it("returns null rather than guessing when no checkout is found", () => {
        const empty = mkdtempSync(join(tmpdir(), "rolling-skill-empty-"))
        temporaryDirectories.push(empty)
        assert.equal(findRepositoryRoot([empty]), null)
    })
})
