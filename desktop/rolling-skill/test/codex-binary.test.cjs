const assert = require("node:assert/strict")
const {chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {resolveCodexBinary} = require("../src/codex-binary.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function executable(path) {
    mkdirSync(require("node:path").dirname(path), {recursive: true})
    writeFileSync(path, "#!/bin/sh\n", {mode: 0o755})
    chmodSync(path, 0o755)
    return path
}

describe("Codex runtime binary resolution", () => {
    it("uses the packaged app resource before host installations", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-binary-"))
        temporaryDirectories.push(root)
        const packaged = executable(join(root, "resources", "codex-runtime", "bin", "codex"))
        const host = executable(join(root, "host", "codex"))

        assert.equal(
            resolveCodexBinary({
                isPackaged: true,
                resourcesPath: join(root, "resources"),
                projectRoot: root,
                installedCandidates: [host],
            }),
            packaged,
        )
    })

    it("uses the pinned npm arm64 binary during development", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-binary-"))
        temporaryDirectories.push(root)
        const development = executable(
            join(
                root,
                "node_modules",
                "@openai",
                "codex-darwin-arm64",
                "vendor",
                "aarch64-apple-darwin",
                "bin",
                "codex",
            ),
        )

        assert.equal(
            resolveCodexBinary({
                isPackaged: false,
                resourcesPath: join(root, "resources"),
                projectRoot: root,
                installedCandidates: [],
            }),
            development,
        )
    })

    it("returns null when no executable runtime exists", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-binary-"))
        temporaryDirectories.push(root)
        assert.equal(
            resolveCodexBinary({
                isPackaged: true,
                resourcesPath: join(root, "resources"),
                projectRoot: root,
                installedCandidates: [join(root, "missing")],
            }),
            null,
        )
    })
})
