const {constants, lstatSync, realpathSync} = require("node:fs")
const {accessSync} = require("node:fs")
const {isAbsolute} = require("node:path")
const {z} = require("zod")

const {
    CONTROL_METHODS,
    controlDefinition,
} = require("../control-plane/contracts.cjs")

const OPERATOR_ENVIRONMENT_KEYS = Object.freeze([
    "ROLLING_SKILL_CONTROL_SOCKET",
    "ROLLING_SKILL_CONTROL_TOKEN",
    "ROLLING_SKILL_OPERATOR_SESSION",
])
const OPERATOR_ENVIRONMENT_KEY_SET = new Set(OPERATOR_ENVIRONMENT_KEYS)
const MAX_OPERATOR_ENVIRONMENT_VALUE_LENGTH = 8_192
const REDACTED = "[REDACTED]"

function plainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function sanitizeOperatorChildEnvironment(environment = {}) {
    if (!plainObject(environment)) throw new TypeError("Operator child environment must be a plain object")
    const descriptors = Object.getOwnPropertyDescriptors(environment)
    const sanitized = {}
    for (const name of OPERATOR_ENVIRONMENT_KEYS) {
        const descriptor = descriptors[name]
        if (!descriptor) continue
        if (!Object.hasOwn(descriptor, "value")) {
            throw new TypeError("Operator child environment values must be data properties")
        }
        const value = descriptor.value
        if (
            typeof value !== "string" || value.length === 0 ||
            value.length > MAX_OPERATOR_ENVIRONMENT_VALUE_LENGTH || value.includes("\0")
        ) {
            throw new TypeError("Operator child environment value is invalid")
        }
        sanitized[name] = value
    }
    return sanitized
}

function mergeOperatorChildEnvironment(inherited = {}, childEnvironment = {}) {
    if (!plainObject(inherited)) throw new TypeError("Inherited child environment must be a plain object")
    const merged = {}
    for (const [name, value] of Object.entries(inherited)) {
        if (!name.startsWith("ROLLING_SKILL_CONTROL_") && !OPERATOR_ENVIRONMENT_KEY_SET.has(name)) {
            merged[name] = value
        }
    }
    return {...merged, ...sanitizeOperatorChildEnvironment(childEnvironment)}
}

function redactOperatorSecrets(value, childEnvironment = {}) {
    const secrets = [
        ...OPERATOR_ENVIRONMENT_KEYS,
        ...Object.values(sanitizeOperatorChildEnvironment(childEnvironment)).filter(Boolean),
    ]
        .sort((left, right) => right.length - left.length)
    if (secrets.length === 0) return value
    const redactText = (text) => {
        let result = text
        for (const secret of secrets) result = result.replaceAll(secret, REDACTED)
        return result
    }
    const seen = new WeakMap()
    const visit = (entry) => {
        if (typeof entry === "string") return redactText(entry)
        if (typeof entry !== "object" || entry === null) return entry
        if (seen.has(entry)) return seen.get(entry)
        const output = Array.isArray(entry) ? [] : {}
        seen.set(entry, output)
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(entry))) {
            if (!Object.hasOwn(descriptor, "value")) continue
            output[redactText(key)] = visit(descriptor.value)
        }
        return output
    }
    return visit(value)
}

function executablePath(value) {
    if (typeof value !== "string" || !isAbsolute(value)) {
        throw new TypeError("Bundled Operator Tool path must be absolute")
    }
    try {
        const resolved = realpathSync(value)
        const status = lstatSync(resolved)
        if (!status.isFile()) return null
        accessSync(resolved, constants.X_OK)
        return resolved
    } catch {
        return null
    }
}

function hasCredentials(environment) {
    return OPERATOR_ENVIRONMENT_KEYS.every((name) => typeof environment[name] === "string")
}

function methodToolName(method) {
    return method.replaceAll(".", "_")
}

function codexDynamicTools() {
    return [{
        type: "namespace",
        name: "rolling_skill",
        description: "Scoped Rolling Skill Operator control tools.",
        tools: CONTROL_METHODS.map((method) => ({
            type: "function",
            name: methodToolName(method),
            description: `Invoke the scoped Rolling Skill ${method} action.`,
            inputSchema: z.toJSONSchema(controlDefinition(method).input),
        })),
    }]
}

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

class OperatorToolTransport {
    #childEnvironment
    #executablePath
    #selection = null

    constructor({executablePath: requestedExecutablePath, childEnvironment = {}} = {}) {
        this.requestedExecutablePath = requestedExecutablePath
        this.#childEnvironment = sanitizeOperatorChildEnvironment(childEnvironment)
        this.#executablePath = undefined
    }

    #resolveExecutable() {
        if (this.#executablePath === undefined) {
            this.#executablePath = executablePath(this.requestedExecutablePath)
        }
        return this.#executablePath
    }

    preflight(runtimeDescriptor = {}, support = {}) {
        const providerId = runtimeDescriptor?.providerId
        if (providerId === "codex" && support.dynamicToolsReady === true) {
            return {kind: "codex-dynamic", ready: true}
        }
        const path = this.#resolveExecutable()
        if (!path) {
            return {
                kind: "unsupported",
                ready: false,
                reason: "Bundled Operator Tool is unavailable",
            }
        }
        if (!hasCredentials(this.#childEnvironment)) {
            return {
                kind: "unsupported",
                ready: false,
                reason: "Operator control credentials are unavailable",
            }
        }
        if (providerId === "codebuddy" && support.mcpServersReady === true) {
            return {kind: "acp-mcp", ready: true}
        }
        return {kind: "cli", ready: true, executablePath: path}
    }

    freeze(runtimeDescriptor = {}, support = {}) {
        if (this.#selection) throw new Error("Operator Tool transport is already frozen")
        this.#selection = Object.freeze(this.preflight(runtimeDescriptor, support))
        return this.selection()
    }

    selection() {
        return this.#selection ? copy(this.#selection) : null
    }

    dynamicTools() {
        return this.#selection?.kind === "codex-dynamic" ? codexDynamicTools() : []
    }

    mcpServers() {
        if (this.#selection?.kind !== "acp-mcp") return []
        const path = this.#resolveExecutable()
        return [{
            name: "rolling-skill-operator",
            command: path,
            args: ["operator-mcp"],
            env: OPERATOR_ENVIRONMENT_KEYS.map((name) => ({
                name,
                value: this.#childEnvironment[name],
            })),
        }]
    }

    childEnvironment() {
        return {...this.#childEnvironment}
    }
}

module.exports = {
    MAX_OPERATOR_ENVIRONMENT_VALUE_LENGTH,
    OPERATOR_ENVIRONMENT_KEYS,
    OperatorToolTransport,
    codexDynamicTools,
    mergeOperatorChildEnvironment,
    redactOperatorSecrets,
    sanitizeOperatorChildEnvironment,
}
