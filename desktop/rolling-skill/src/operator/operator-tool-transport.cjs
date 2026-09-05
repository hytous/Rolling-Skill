const {constants, lstatSync, realpathSync} = require("node:fs")
const {accessSync} = require("node:fs")
const {isAbsolute} = require("node:path")
const {StringDecoder} = require("node:string_decoder")
const {z} = require("zod")

const {
    OPERATOR_CONTROL_METHODS,
    controlDefinition,
} = require("../control-plane/contracts.cjs")

const OPERATOR_ENVIRONMENT_KEYS = Object.freeze([
    "ROLLING_SKILL_CONTROL_SOCKET",
    "ROLLING_SKILL_CONTROL_TOKEN",
    "ROLLING_SKILL_OPERATOR_SESSION",
])
const OPERATOR_ENVIRONMENT_KEY_SET = new Set(OPERATOR_ENVIRONMENT_KEYS)
const MAX_OPERATOR_ENVIRONMENT_VALUE_LENGTH = 8_192
const MAX_OPERATOR_STREAM_BUFFER_BYTES = 64 * 1_024
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
            value.length > MAX_OPERATOR_ENVIRONMENT_VALUE_LENGTH || /[\0\r\n]/u.test(value)
        ) {
            throw new TypeError("Operator child environment value is invalid")
        }
        sanitized[name] = value
    }
    return sanitized
}

function operatorSecretPatterns(childEnvironment = {}) {
    return [...new Set([
        ...OPERATOR_ENVIRONMENT_KEYS,
        ...Object.values(sanitizeOperatorChildEnvironment(childEnvironment)).filter(Boolean),
    ])].sort((left, right) => right.length - left.length)
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
    const secrets = operatorSecretPatterns(childEnvironment)
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

class OperatorStreamRedactor {
    #decoder = new StringDecoder("utf8")
    #ended = false
    #pending = ""
    #patterns
    #overlap

    constructor(childEnvironment = {}) {
        this.#patterns = operatorSecretPatterns(childEnvironment)
        this.#overlap = Math.max(0, ...this.#patterns.map((pattern) => pattern.length - 1))
    }

    #nextMatch(limit) {
        let selected = null
        for (const pattern of this.#patterns) {
            const index = this.#pending.indexOf(pattern)
            if (index < 0 || index >= limit) continue
            if (
                selected === null || index < selected.index ||
                (index === selected.index && pattern.length > selected.pattern.length)
            ) selected = {index, pattern}
        }
        return selected
    }

    #drain(limit) {
        if (limit <= 0) return []
        let output = ""
        while (limit > 0) {
            const match = this.#nextMatch(limit)
            if (!match) {
                output += this.#pending.slice(0, limit)
                this.#pending = this.#pending.slice(limit)
                break
            }
            output += this.#pending.slice(0, match.index) + REDACTED
            const matchEnd = match.index + match.pattern.length
            limit -= matchEnd
            this.#pending = this.#pending.slice(matchEnd)
        }
        return output ? [output] : []
    }

    #drainAvailable({flush = false} = {}) {
        const output = []
        let newline = this.#pending.indexOf("\n")
        while (newline >= 0) {
            output.push(...this.#drain(newline + 1))
            newline = this.#pending.indexOf("\n")
        }
        if (flush) {
            output.push(...this.#drain(this.#pending.length))
        } else if (Buffer.byteLength(this.#pending, "utf8") > MAX_OPERATOR_STREAM_BUFFER_BYTES) {
            output.push(...this.#drain(Math.max(0, this.#pending.length - this.#overlap)))
        }
        return output
    }

    push(chunk) {
        if (this.#ended) throw new Error("Operator stream redactor is closed")
        this.#pending += this.#decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        return this.#drainAvailable()
    }

    end(chunk) {
        if (this.#ended) return []
        this.#ended = true
        this.#pending += chunk === undefined
            ? this.#decoder.end()
            : this.#decoder.end(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
        return this.#drainAvailable({flush: true})
    }
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
        tools: OPERATOR_CONTROL_METHODS.map((method) => {
            const definition = controlDefinition(method)
            return {
                type: "function",
                name: methodToolName(method),
                description: definition.description ??
                    `Invoke the scoped Rolling Skill ${method} action.`,
                inputSchema: z.toJSONSchema(definition.input),
            }
        }),
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
        if (providerId === "deepseek-harness") {
            return support.dshMcpReady === true
                ? {kind: "dsh-mcp", ready: true}
                : {
                    kind: "unsupported",
                    ready: false,
                    reason: "DeepSeek Harness native MCP tools are unavailable",
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
        if (!["acp-mcp", "dsh-mcp"].includes(this.#selection?.kind)) return []
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
    MAX_OPERATOR_STREAM_BUFFER_BYTES,
    OPERATOR_ENVIRONMENT_KEYS,
    OperatorStreamRedactor,
    OperatorToolTransport,
    codexDynamicTools,
    mergeOperatorChildEnvironment,
    redactOperatorSecrets,
    sanitizeOperatorChildEnvironment,
}
