const {z} = require("zod")

const {
    INSTALLATION_AGENT_CONTROL_METHODS,
    controlDefinition,
} = require("./control-plane/contracts.cjs")
const {
    OPERATOR_ENVIRONMENT_KEYS,
    OperatorToolTransport,
} = require("./operator/operator-tool-transport.cjs")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function installationDynamicTools() {
    return [{
        type: "namespace",
        name: "rolling_skill",
        description: "Job-scoped Rolling Skill installation registration tool.",
        tools: INSTALLATION_AGENT_CONTROL_METHODS.map((method) => ({
            type: "function",
            name: method.replaceAll(".", "_"),
            description: "Register verified terminal evidence for this installation Job.",
            inputSchema: z.toJSONSchema(controlDefinition(method).input),
        })),
    }]
}

class SkillInstallationToolTransport {
    #base
    #selection = null

    constructor(options = {}) {
        this.#base = new OperatorToolTransport(options)
    }

    preflight(runtimeDescriptor = {}, support = {}) {
        return this.#base.preflight(runtimeDescriptor, support)
    }

    freeze(runtimeDescriptor = {}, support = {}) {
        if (this.#selection) throw new Error("Skill installation Tool transport is already frozen")
        this.#selection = Object.freeze(this.preflight(runtimeDescriptor, support))
        return this.selection()
    }

    selection() {
        return this.#selection ? copy(this.#selection) : null
    }

    dynamicTools() {
        return this.#selection?.kind === "codex-dynamic" ? installationDynamicTools() : []
    }

    mcpServers() {
        if (this.#selection?.kind !== "acp-mcp") return []
        const base = this.#base
        const environment = base.childEnvironment()
        return [{
            name: "rolling-skill-installation",
            command: this.#selection.executablePath ?? base.preflight(
                {providerId: "deepseek-harness"},
            ).executablePath,
            args: ["installation-mcp"],
            env: OPERATOR_ENVIRONMENT_KEYS.map((name) => ({name, value: environment[name]})),
        }]
    }

    childEnvironment() {
        return this.#base.childEnvironment()
    }

    registrationInstruction() {
        if (this.#selection?.kind === "cli") {
            return `Send the registration JSON through stdin to \"${this.#selection.executablePath}\" control installations.register --params-json -.`
        }
        return "Call rolling_skill_installations_register with the verified terminal evidence."
    }
}

module.exports = {
    SkillInstallationToolTransport,
    installationDynamicTools,
}
