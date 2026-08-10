const assert = require("node:assert/strict")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {
    buildComposeInvocation,
    createRuntimePaths,
    DESKTOP_PATH,
} = require("../src/runtime-command.cjs")

describe("runtime command construction", () => {
    const repositoryRoot = "/tmp/checkout with spaces"

    it("keeps durable state under the ignored checkout-local directory", () => {
        const paths = createRuntimePaths(repositoryRoot)
        assert.equal(paths.evidenceDirectory, join(repositoryRoot, ".local", "codex-evidence"))
        assert.equal(paths.codexHomeDirectory, join(repositoryRoot, ".local", "codex-home"))
        assert.equal(paths.logFile, join(repositoryRoot, ".local", "desktop.log"))
    })

    it("starts Compose with fixed arguments and no shell interpolation", () => {
        const invocation = buildComposeInvocation(repositoryRoot, "start", {BASE: "kept"})
        assert.equal(invocation.executable, "/bin/bash")
        assert.equal(invocation.options.shell, false)
        assert.equal(invocation.options.cwd, repositoryRoot)
        assert.deepEqual(invocation.args.slice(1), [
            "--oss",
            "--dev",
            "--build",
            "--no-tunnel",
            "--env-file",
            ".env.oss.dev",
            "--compose-file",
            "docker-compose.dev.rolling-skill.yml",
        ])
        assert.equal(invocation.options.env.BASE, "kept")
        assert.equal(invocation.options.env.PATH, DESKTOP_PATH)
        assert.equal(
            invocation.options.env.ROLLING_SKILL_EVIDENCE_DIR,
            join(repositoryRoot, ".local", "codex-evidence"),
        )
    })

    it("stops Compose without deleting volumes or rebuilding", () => {
        const invocation = buildComposeInvocation(repositoryRoot, "stop")
        assert.equal(invocation.args.includes("--down"), true)
        assert.equal(invocation.args.includes("--nuke"), false)
        assert.equal(invocation.args.includes("--build"), false)
    })

    it("rejects unknown lifecycle actions", () => {
        assert.throws(() => buildComposeInvocation(repositoryRoot, "destroy"), /Unsupported/)
    })
})
