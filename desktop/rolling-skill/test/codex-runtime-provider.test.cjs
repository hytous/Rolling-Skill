const assert = require("node:assert/strict")
const {chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {delimiter, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    CodexRuntimeProvider,
    buildCodexCandidates,
    probeCodexRuntime,
} = require("../src/codex-runtime-provider.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-runtime-"))
    temporaryDirectories.push(root)
    return root
}

function executable(path) {
    mkdirSync(require("node:path").dirname(path), {recursive: true})
    writeFileSync(path, "#!/bin/sh\n", {mode: 0o755})
    chmodSync(path, 0o755)
    return path
}

describe("Codex runtime candidate discovery", () => {
    it("prioritizes configured, environment, PATH, application, and fallback sources", () => {
        const root = fixture()
        const configured = executable(join(root, "configured", "codex"))
        const environment = executable(join(root, "environment", "codex"))
        const pathBinary = executable(join(root, "path", "codex"))
        const application = executable(join(root, "application", "codex"))
        const fallback = executable(join(root, "fallback", "codex"))

        const candidates = buildCodexCandidates({
            configuredPath: configured,
            environmentBinary: environment,
            pathValue: join(root, "path"),
            applicationCandidates: [application],
            systemCandidates: [fallback],
            userCandidates: [],
            sreCandidates: [],
        })

        assert.deepEqual(
            candidates.map((candidate) => [candidate.path, candidate.source]),
            [
                [configured, "configured"],
                [environment, "environment"],
                [pathBinary, "path"],
                [application, "application"],
                [fallback, "system"],
            ],
        )
    })

    it("deduplicates symlinks while preserving the highest-priority path", () => {
        const root = fixture()
        const target = executable(join(root, "actual", "codex"))
        const linkedDirectory = join(root, "linked")
        mkdirSync(linkedDirectory)
        const linked = join(linkedDirectory, "codex")
        symlinkSync(target, linked)

        const candidates = buildCodexCandidates({
            configuredPath: linked,
            pathValue: require("node:path").dirname(target),
            applicationCandidates: [],
            systemCandidates: [],
            userCandidates: [],
            sreCandidates: [],
        })

        assert.deepEqual(candidates, [{path: linked, source: "configured"}])
    })

    it("reads every PATH entry without invoking a shell", () => {
        const root = fixture()
        const first = executable(join(root, "one", "codex"))
        const second = executable(join(root, "two", "codex"))
        const candidates = buildCodexCandidates({
            pathValue: [require("node:path").dirname(first), require("node:path").dirname(second)].join(
                delimiter,
            ),
            applicationCandidates: [],
            systemCandidates: [],
            userCandidates: [],
            sreCandidates: [],
        })
        assert.deepEqual(
            candidates.map((candidate) => candidate.path),
            [first, second],
        )
    })
})

describe("Codex runtime compatibility probing", () => {
    it("accepts Codex only when app-server support is present", () => {
        const calls = []
        const spawnProcess = (path, args, options) => {
            calls.push({path, args, options})
            if (args[0] === "--version") return {status: 0, stdout: "codex-cli 0.147.0\n", stderr: ""}
            return {status: 0, stdout: "Usage: codex app-server [OPTIONS]\n", stderr: ""}
        }

        const result = probeCodexRuntime("/runtime/codex", spawnProcess)

        assert.equal(result.version, "0.147.0")
        assert.equal(result.appServer, true)
        assert.equal(calls.length, 2)
        assert.equal(calls.every((call) => call.options.shell === false), true)
    })

    it("rejects non-Codex and app-server-incompatible executables", () => {
        const notCodex = (_path, args) =>
            args[0] === "--version"
                ? {status: 0, stdout: "other-cli 1.0\n", stderr: ""}
                : {status: 0, stdout: "", stderr: ""}
        assert.equal(probeCodexRuntime("/runtime/other", notCodex), null)

        const noServer = (_path, args) =>
            args[0] === "--version"
                ? {status: 0, stdout: "codex-cli 0.100.0\n", stderr: ""}
                : {status: 2, stdout: "", stderr: "unknown command"}
        assert.equal(probeCodexRuntime("/runtime/codex", noServer), null)
    })
})

describe("Codex runtime provider", () => {
    it("returns descriptors only for compatible executable candidates", () => {
        const root = fixture()
        const compatible = executable(join(root, "good", "codex"))
        executable(join(root, "bad", "codex"))
        const provider = new CodexRuntimeProvider({
            probe: (path) =>
                path === compatible ? {version: "0.147.0", appServer: true} : null,
        })

        const results = provider.discover({
            pathValue: [join(root, "good"), join(root, "bad")].join(delimiter),
            applicationCandidates: [],
            systemCandidates: [],
            userCandidates: [],
            sreCandidates: [],
        })

        assert.equal(results.length, 1)
        assert.equal(results[0].providerId, "codex")
        assert.equal(results[0].version, "0.147.0")
        assert.equal(results[0].executablePath, compatible)
        assert.match(results[0].runtimeId, /^codex:/)
        assert.deepEqual(results[0].capabilities, [
            "threads",
            "thread-archive",
            "sandbox-policy",
            "turns",
            "models",
            "reasoning-effort",
            "skills",
            "plugins",
            "streaming",
            "raw-trace",
        ])
    })
})
