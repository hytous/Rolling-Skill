const assert = require("node:assert/strict")
const {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {prepareRuntimeFilesystem} = require("../src/runtime-files.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-files-"))
    const home = mkdtempSync(join(tmpdir(), "rolling-skill-home-"))
    temporaryDirectories.push(root, home)
    mkdirSync(join(root, "hosting", "docker-compose", "oss"), {recursive: true})
    writeFileSync(join(root, "hosting", "docker-compose", "run.sh"), "#!/bin/bash\n")
    writeFileSync(join(root, "hosting", "docker-compose", "oss", "env.oss.dev.example"), "A=1\n")
    writeFileSync(
        join(root, "hosting", "docker-compose", "oss", "docker-compose.dev.rolling-skill.yml"),
        "services: {}\n",
    )
    mkdirSync(join(home, ".codex"), {recursive: true})
    return {root, hostAuthFile: join(home, ".codex", "auth.json")}
}

describe("runtime filesystem preparation", () => {
    it("copies only auth.json and creates the local environment", () => {
        const {root, hostAuthFile} = fixture()
        writeFileSync(hostAuthFile, '{"token":"secret"}\n', {mode: 0o600})

        const paths = prepareRuntimeFilesystem(root, {hostAuthFile})

        assert.equal(readFileSync(paths.isolatedAuthFile, "utf8"), '{"token":"secret"}\n')
        assert.equal(readFileSync(paths.environmentFile, "utf8"), "A=1\n")
        assert.deepEqual(
            require("node:fs").readdirSync(paths.codexHomeDirectory).sort(),
            ["auth.json"],
        )
        assert.equal(lstatSync(paths.codexHomeDirectory).mode & 0o777, 0o700)
        assert.equal(lstatSync(paths.isolatedAuthFile).mode & 0o777, 0o600)
    })

    it("reports a typed actionable error when Codex login is missing", () => {
        const {root, hostAuthFile} = fixture()
        assert.throws(
            () => prepareRuntimeFilesystem(root, {hostAuthFile}),
            (error) => error.code === "CODEX_LOGIN_REQUIRED" && /codex login/.test(error.message),
        )
        assert.equal(existsSync(join(root, ".local", "codex-home")), true)
        assert.equal(
            readFileSync(join(root, "hosting", "docker-compose", "oss", ".env.oss.dev"), "utf8"),
            "A=1\n",
        )
    })

    it("refuses a symlinked credential directory", () => {
        const {root, hostAuthFile} = fixture()
        writeFileSync(hostAuthFile, "{}\n")
        mkdirSync(join(root, ".local"), {recursive: true})
        const outside = mkdtempSync(join(tmpdir(), "rolling-skill-outside-"))
        temporaryDirectories.push(outside)
        require("node:fs").symlinkSync(outside, join(root, ".local", "codex-home"))

        assert.throws(
            () => prepareRuntimeFilesystem(root, {hostAuthFile}),
            (error) => error.code === "UNSAFE_LOCAL_PATH",
        )
        assert.equal(existsSync(join(outside, "auth.json")), false)
    })
})
