const assert = require("node:assert/strict")
const {chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {INSTALLATION_AGENT_CONTROL_METHODS} = require("../src/control-plane/contracts.cjs")
const {
    SkillInstallationToolTransport,
} = require("../src/skill-installation-tool-transport.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function executableTool() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-installation-tool-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "rolling-skill-tool")
    writeFileSync(path, "#!/bin/sh\n", {mode: 0o755})
    chmodSync(path, 0o755)
    return realpathSync(path)
}

function credentials() {
    return {
        ROLLING_SKILL_CONTROL_SOCKET: "/private/control.sock",
        ROLLING_SKILL_CONTROL_TOKEN: "installation-secret-token",
        ROLLING_SKILL_OPERATOR_SESSION: "installation-session-1",
    }
}

describe("Skill installation Tool transport", () => {
    it("exposes only installations.register as a Codex dynamic tool", () => {
        const transport = new SkillInstallationToolTransport({
            executablePath: executableTool(),
            childEnvironment: credentials(),
        })

        assert.deepEqual(transport.freeze(
            {providerId: "codex"},
            {dynamicToolsReady: true},
        ), {kind: "codex-dynamic", ready: true})
        const dynamicTools = transport.dynamicTools()
        assert.deepEqual(INSTALLATION_AGENT_CONTROL_METHODS, ["installations.register"])
        assert.deepEqual(dynamicTools[0].tools.map((tool) => tool.name), [
            "installations_register",
        ])
        assert.equal(JSON.stringify(dynamicTools).includes("installation-secret-token"), false)
        assert.match(transport.registrationInstruction(), /rolling_skill_installations_register/u)
    })

    it("uses a one-tool MCP server for CodeBuddy with credentials only in environment", () => {
        const path = executableTool()
        const transport = new SkillInstallationToolTransport({
            executablePath: path,
            childEnvironment: credentials(),
        })
        transport.freeze({providerId: "codebuddy"}, {mcpServersReady: true})

        assert.deepEqual(transport.mcpServers(), [{
            name: "rolling-skill-install",
            command: path,
            args: ["installation-mcp"],
            env: Object.entries(credentials()).map(([name, value]) => ({name, value})),
        }])
        assert.equal(JSON.stringify(transport.mcpServers()).includes("--token"), false)
        assert.match(transport.registrationInstruction(), /rolling_skill_installations_register/u)
    })

    it("uses a scoped native MCP tool for DSH without putting credentials in prompts", () => {
        const path = executableTool()
        const transport = new SkillInstallationToolTransport({
            executablePath: path,
            childEnvironment: credentials(),
        })
        assert.deepEqual(transport.freeze(
            {providerId: "deepseek-harness"},
            {dshMcpReady: true},
        ), {kind: "dsh-mcp", ready: true})
        assert.deepEqual(transport.dynamicTools(), [])
        assert.deepEqual(transport.mcpServers(), [{
            name: "rolling-skill-install",
            command: path,
            args: ["installation-mcp"],
            env: Object.entries(credentials()).map(([name, value]) => ({name, value})),
        }])
        assert.equal(
            transport.registrationInstruction(),
            "Call mcp__rolling-skill-install__rolling_skill_installations_register with the verified terminal evidence.",
        )
        assert.equal(transport.registrationInstruction().includes("installation-secret-token"), false)
    })
})
