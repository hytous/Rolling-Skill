const assert = require("node:assert/strict")
const {chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {OPERATOR_CONTROL_METHODS} = require("../src/control-plane/contracts.cjs")
const {
    MAX_OPERATOR_STREAM_BUFFER_BYTES,
    OPERATOR_ENVIRONMENT_KEYS,
    OperatorStreamRedactor,
    OperatorToolTransport,
    mergeOperatorChildEnvironment,
    redactOperatorSecrets,
} = require("../src/operator/operator-tool-transport.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function executableTool() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-tool-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "rolling-skill-tool")
    writeFileSync(path, "#!/bin/sh\n", {mode: 0o755})
    chmodSync(path, 0o755)
    return path
}

function credentials() {
    return {
        ROLLING_SKILL_CONTROL_SOCKET: "/private/control.sock",
        ROLLING_SKILL_CONTROL_TOKEN: "operator-secret-token",
        ROLLING_SKILL_OPERATOR_SESSION: "operator-session-1",
        SHOULD_NOT_PASS: "ambient-secret",
    }
}

describe("Operator Tool transport", () => {
    it("builds the complete rolling_skill Codex namespace without embedding credentials", () => {
        const transport = new OperatorToolTransport({
            executablePath: executableTool(),
            childEnvironment: credentials(),
        })

        assert.deepEqual(transport.preflight(
            {providerId: "codex"},
            {dynamicToolsReady: true},
        ), {kind: "codex-dynamic", ready: true})
        transport.freeze({providerId: "codex"}, {dynamicToolsReady: true})
        const dynamicTools = transport.dynamicTools()

        assert.equal(dynamicTools.length, 1)
        assert.equal(dynamicTools[0].type, "namespace")
        assert.equal(dynamicTools[0].name, "rolling_skill")
        assert.deepEqual(
            dynamicTools[0].tools.map((tool) => tool.name).sort(),
            OPERATOR_CONTROL_METHODS.map((method) => method.replaceAll(".", "_")).sort(),
        )
        assert.equal(dynamicTools[0].tools.some((tool) => (
            ["approvals_resolve", "jobs_pause", "jobs_resume", "jobs_stop", "skills_get"]
                .includes(tool.name)
        )), false)
        assert.equal(dynamicTools[0].tools.every((tool) => (
            tool.type === "function" &&
            typeof tool.description === "string" &&
            tool.inputSchema?.type === "object"
        )), true)
        assert.equal(JSON.stringify(dynamicTools).includes("operator-secret-token"), false)
    })

    it("builds one ACP v1 stdio descriptor with environment-only credentials", () => {
        const executablePath = executableTool()
        const transport = new OperatorToolTransport({
            executablePath,
            childEnvironment: credentials(),
        })
        transport.freeze({providerId: "codebuddy"}, {mcpServersReady: true})

        assert.deepEqual(transport.preflight(
            {providerId: "codebuddy"},
            {mcpServersReady: true},
        ), {kind: "acp-mcp", ready: true})
        assert.deepEqual(transport.mcpServers(), [{
            name: "rolling-skill-operator",
            command: realpathSync(executablePath),
            args: ["operator-mcp"],
            env: OPERATOR_ENVIRONMENT_KEYS.map((name) => ({
                name,
                value: credentials()[name],
            })),
        }])
        assert.equal(JSON.stringify(transport.mcpServers()).includes("--token"), false)
        assert.equal(JSON.stringify(transport.mcpServers()).includes("SHOULD_NOT_PASS"), false)
    })

    it("uses native MCP for DSH instead of exposing credentials to Bash", () => {
        const executablePath = executableTool()
        const dsh = new OperatorToolTransport({
            executablePath: realpathSync(executablePath),
            childEnvironment: credentials(),
        })
        const incompatibleCodex = new OperatorToolTransport({
            executablePath: realpathSync(executablePath),
            childEnvironment: credentials(),
        })
        const unprovenCodex = new OperatorToolTransport({
            executablePath: realpathSync(executablePath),
            childEnvironment: credentials(),
        })

        assert.deepEqual(dsh.preflight(
            {providerId: "deepseek-harness"},
            {dshMcpReady: true},
        ), {kind: "dsh-mcp", ready: true})
        dsh.freeze({providerId: "deepseek-harness"}, {dshMcpReady: true})
        assert.deepEqual(dsh.mcpServers(), [{
            name: "rolling-skill-operator",
            command: realpathSync(executablePath),
            args: ["operator-mcp"],
            env: OPERATOR_ENVIRONMENT_KEYS.map((name) => ({
                name,
                value: credentials()[name],
            })),
        }])
        assert.equal(JSON.stringify(dsh.mcpServers()).includes("--token"), false)

        assert.deepEqual(new OperatorToolTransport({
            executablePath: realpathSync(executablePath),
            childEnvironment: credentials(),
        }).preflight({providerId: "deepseek-harness"}), {
            kind: "unsupported",
            ready: false,
            reason: "DeepSeek Harness native MCP tools are unavailable",
        })
        assert.deepEqual(incompatibleCodex.preflight(
            {providerId: "codex"},
            {dynamicToolsReady: false},
        ), {
            kind: "cli",
            ready: true,
            executablePath: realpathSync(executablePath),
        })
        assert.deepEqual(unprovenCodex.preflight({providerId: "codex"}), {
            kind: "cli",
            ready: true,
            executablePath: realpathSync(executablePath),
        })
        assert.throws(
            () => new OperatorToolTransport({
                executablePath: "relative/rolling-skill-tool",
                childEnvironment: credentials(),
            }).preflight({providerId: "deepseek-harness"}),
            /absolute/iu,
        )
    })

    it("reports unsupported before a session and never downgrades a frozen transport", () => {
        const missing = new OperatorToolTransport({
            executablePath: "/missing/rolling-skill-tool",
            childEnvironment: credentials(),
        })
        assert.deepEqual(missing.preflight(
            {providerId: "codex"},
            {dynamicToolsReady: false},
        ), {
            kind: "unsupported",
            ready: false,
            reason: "Bundled Operator Tool is unavailable",
        })

        const fixed = new OperatorToolTransport({
            executablePath: executableTool(),
            childEnvironment: credentials(),
        })
        assert.deepEqual(fixed.freeze(
            {providerId: "codex"},
            {dynamicToolsReady: true},
        ), {kind: "codex-dynamic", ready: true})
        assert.throws(
            () => fixed.freeze(
                {providerId: "codex"},
                {dynamicToolsReady: false},
            ),
            /frozen/iu,
        )
        assert.deepEqual(fixed.selection(), {kind: "codex-dynamic", ready: true})
        assert.deepEqual(fixed.dynamicTools()[0].name, "rolling_skill")
        assert.deepEqual(fixed.mcpServers(), [])
    })

    it("scrubs inherited authority and merges only explicit bounded child credentials", () => {
        const inherited = {
            PATH: "/usr/bin:/bin",
            ROLLING_SKILL_CONTROL_SOCKET: "/ambient/socket",
            ROLLING_SKILL_CONTROL_TOKEN: "ambient-token",
            ROLLING_SKILL_CONTROL_SESSION: "legacy-ambient-session",
            ROLLING_SKILL_CONTROL_TIMEOUT_MS: "1234",
            ROLLING_SKILL_OPERATOR_SESSION: "ambient-session",
        }
        const merged = mergeOperatorChildEnvironment(inherited, {
            ...credentials(),
            ROLLING_SKILL_CONTROL_TOKEN: "explicit-token",
        })

        assert.deepEqual(merged, {
            PATH: "/usr/bin:/bin",
            ROLLING_SKILL_CONTROL_SOCKET: "/private/control.sock",
            ROLLING_SKILL_CONTROL_TOKEN: "explicit-token",
            ROLLING_SKILL_OPERATOR_SESSION: "operator-session-1",
        })
        assert.deepEqual(mergeOperatorChildEnvironment(inherited, {}), {
            PATH: "/usr/bin:/bin",
        })
        assert.throws(
            () => mergeOperatorChildEnvironment({}, {
                ROLLING_SKILL_CONTROL_TOKEN: "x".repeat(8_193),
            }),
            /environment/iu,
        )
    })

    it("redacts every authority value from nested trace and runtime-log content", () => {
        const environment = credentials()
        const redacted = redactOperatorSecrets({
            params: {mcpServers: [{env: environment}]},
            log: `failed ${environment.ROLLING_SKILL_CONTROL_TOKEN} at ${environment.ROLLING_SKILL_CONTROL_SOCKET}`,
        }, environment)

        assert.equal(JSON.stringify(redacted).includes("operator-secret-token"), false)
        assert.equal(JSON.stringify(redacted).includes("/private/control.sock"), false)
        assert.equal(JSON.stringify(redacted).includes("operator-session-1"), false)
        assert.equal(JSON.stringify(redacted).includes("ROLLING_SKILL_CONTROL_TOKEN"), false)
        assert.equal(JSON.stringify(redacted).includes("ROLLING_SKILL_CONTROL_SOCKET"), false)
        assert.equal(JSON.stringify(redacted).includes("ROLLING_SKILL_OPERATOR_SESSION"), false)
        assert.match(redacted.log, /\[REDACTED\]/u)
    })

    it("redacts secrets split across stream chunks and bounds lines without a terminator", () => {
        const environment = credentials()
        const token = environment.ROLLING_SKILL_CONTROL_TOKEN
        const split = Math.floor(token.length / 2)
        const redactor = new OperatorStreamRedactor(environment)
        const output = [
            ...redactor.push(`prefix ${token.slice(0, split)}`),
            ...redactor.push(`${token.slice(split)} suffix\n`),
            ...redactor.end(),
        ].join("")

        assert.equal(output.includes(token), false)
        assert.match(output, /prefix \[REDACTED\] suffix/u)

        const unterminated = new OperatorStreamRedactor(environment)
        const boundaryPrefix = "x".repeat(MAX_OPERATOR_STREAM_BUFFER_BYTES)
        const boundaryOutput = [
            ...unterminated.push(boundaryPrefix + token.slice(0, split)),
            ...unterminated.push(token.slice(split)),
            ...unterminated.end(),
        ].join("")
        assert.ok(boundaryOutput.length > 0)
        assert.equal(boundaryOutput.includes(token), false)
        assert.match(boundaryOutput, /\[REDACTED\]/u)
    })
})
