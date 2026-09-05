#!/usr/bin/env node

import {
    closeSync,
    constants as fileConstants,
    fstatSync,
    lstatSync,
    openSync,
    readSync,
} from "node:fs"
import {readFile} from "node:fs/promises"
import process from "node:process"
import {McpServer} from "@modelcontextprotocol/server"
import {serveStdio} from "@modelcontextprotocol/server/stdio"
import {z} from "zod"
import rawCaseStoreModule from "../src/raw-case-store.cjs"
import controlContractsModule from "../src/control-plane/contracts.cjs"
import controlSocketClientModule from "../src/control-plane/socket-client.cjs"

const {RawCaseStore} = rawCaseStoreModule
const {
    CONTROL_METHODS,
    INSTALLATION_AGENT_CONTROL_METHODS,
    OPERATOR_CONTROL_METHODS,
    PUBLIC_CONTROL_ERROR_CODES,
    controlDefinition,
    createPublicControlError,
    parseControlInput,
    parseControlOutput,
    publicControlError,
} = controlContractsModule
const {ControlSocketClient} = controlSocketClientModule

const TOOL_VERSION = "0.1.0"
const MAX_CONTROL_PARAMS_BYTES = 1_048_576
const CONTROL_FILE_READ_CHUNK_BYTES = 64 * 1_024
const CONTROL_ENVIRONMENT_KEYS = Object.freeze({
    socketPath: "ROLLING_SKILL_CONTROL_SOCKET",
    token: "ROLLING_SKILL_CONTROL_TOKEN",
    sessionId: "ROLLING_SKILL_OPERATOR_SESSION",
})
const PUBLIC_CONTROL_ERROR_CODE_SET = new Set(PUBLIC_CONTROL_ERROR_CODES)

function parseArguments(arguments_) {
    const [command = "help", ...tokens] = arguments_
    const options = {}
    const positionals = []
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        if (!token.startsWith("--")) {
            positionals.push(token)
            continue
        }
        const name = token.slice(2)
        if (name === "json") {
            if (command === "list") {
                options.json = true
            } else {
                if (tokens[index + 1] === undefined) throw new Error("Missing value for --json")
                options.json = tokens[index + 1]
                index += 1
            }
        } else if (name === "params-json") {
            if (tokens[index + 1] === undefined) throw new Error("Missing value for --params-json")
            options[name] = tokens[index + 1]
            index += 1
        } else if (name === "skill" || name === "skill-path" || name === "question" || name === "note") {
            if (tokens[index + 1] === undefined) throw new Error(`Missing value for --${name}`)
            options[name] = tokens[index + 1]
            index += 1
        } else {
            throw new Error(`Unknown option: --${name}`)
        }
    }
    if (command === "control") {
        if (positionals.length !== 1) throw new Error("control requires exactly one method")
        options.method = positionals[0]
    } else if (positionals.length > 0) {
        throw new Error(`Unexpected argument: ${positionals[0]}`)
    }
    return {command, options}
}

async function readStandardInput() {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString("utf8")
}

async function readJsonInput(path) {
    if (!path) throw new Error("--json requires a file path or - for stdin")
    return JSON.parse(path === "-" ? await readStandardInput() : await readFile(path, "utf8"))
}

async function readBoundedJsonInput(path) {
    if (!path) throw new Error("--params-json requires a file path or - for stdin")
    const source = path === "-"
        ? await readBoundedStream(process.stdin)
        : readBoundedRegularFile(path)
    const parsed = JSON.parse(source.toString("utf8"))
    if (
        typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
        Object.getPrototypeOf(parsed) !== Object.prototype
    ) throw new TypeError("Control params must be a plain object")
    return parsed
}

async function readBoundedStream(input) {
    const chunks = []
    let bytes = 0
    for await (const chunk of input) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.length
        if (bytes > MAX_CONTROL_PARAMS_BYTES) {
            throw new RangeError("Control params exceed the maximum input size")
        }
        chunks.push(buffer)
    }
    return Buffer.concat(chunks)
}

function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino
}

function sameFileSnapshot(left, right) {
    return sameFileIdentity(left, right) &&
        left.size === right.size &&
        left.mtimeMs === right.mtimeMs &&
        left.ctimeMs === right.ctimeMs
}

function readBoundedRegularFile(path) {
    const supportsNoFollow = Number.isInteger(fileConstants.O_NOFOLLOW) &&
        fileConstants.O_NOFOLLOW > 0
    const supportsNonBlock = Number.isInteger(fileConstants.O_NONBLOCK) &&
        fileConstants.O_NONBLOCK > 0
    let expectedIdentity = null
    if (!supportsNoFollow || !supportsNonBlock) {
        expectedIdentity = lstatSync(path)
        if (!expectedIdentity.isFile() || expectedIdentity.isSymbolicLink()) {
            throw new Error("Control params file is invalid")
        }
    }
    let flags = fileConstants.O_RDONLY
    if (supportsNoFollow) flags |= fileConstants.O_NOFOLLOW
    if (supportsNonBlock) flags |= fileConstants.O_NONBLOCK

    let descriptor = null
    try {
        descriptor = openSync(path, flags)
        const initial = fstatSync(descriptor)
        if (
            !initial.isFile() ||
            (expectedIdentity && !sameFileIdentity(expectedIdentity, initial))
        ) throw new Error("Control params file is invalid")
        if (initial.size > MAX_CONTROL_PARAMS_BYTES) {
            throw new RangeError("Control params exceed the maximum input size")
        }

        const chunks = []
        let bytes = 0
        const buffer = Buffer.allocUnsafe(CONTROL_FILE_READ_CHUNK_BYTES)
        while (true) {
            const remainingWithOverflowByte = MAX_CONTROL_PARAMS_BYTES - bytes + 1
            const bytesRead = readSync(
                descriptor,
                buffer,
                0,
                Math.min(buffer.length, remainingWithOverflowByte),
                null,
            )
            if (bytesRead === 0) break
            bytes += bytesRead
            if (bytes > MAX_CONTROL_PARAMS_BYTES) {
                throw new RangeError("Control params exceed the maximum input size")
            }
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
        }

        const final = fstatSync(descriptor)
        if (!final.isFile() || !sameFileSnapshot(initial, final) || bytes !== initial.size) {
            throw new Error("Control params file changed while being read")
        }
        return Buffer.concat(chunks, bytes)
    } finally {
        if (descriptor !== null) closeSync(descriptor)
    }
}

function controlCredentials(environment = process.env) {
    const credentials = Object.fromEntries(Object.entries(CONTROL_ENVIRONMENT_KEYS).map(
        ([name, environmentKey]) => [name, environment[environmentKey]],
    ))
    credentials.sessionId ??= environment.ROLLING_SKILL_CONTROL_SESSION
    if (Object.values(credentials).some((value) => typeof value !== "string" || value.length === 0)) {
        throw new Error("Rolling Skill control credentials are unavailable")
    }
    const configuredTimeout = environment.ROLLING_SKILL_CONTROL_TIMEOUT_MS
    if (configuredTimeout !== undefined) {
        if (!/^[1-9]\d{0,4}$/u.test(configuredTimeout)) {
            throw new Error("Rolling Skill control timeout is invalid")
        }
        const timeoutMs = Number(configuredTimeout)
        if (timeoutMs > 15_000) throw new Error("Rolling Skill control timeout is invalid")
        credentials.timeoutMs = timeoutMs
    }
    return credentials
}

async function invokeControl(method, params, credentials = controlCredentials()) {
    controlDefinition(method)
    const input = parseControlInput(method, params)
    const client = new ControlSocketClient(credentials)
    try {
        const output = parseControlOutput(method, await client.invoke(method, input))
        return serializableControlResult(output, credentials)
    } finally {
        client.close()
    }
}

function containsControlAuthority(root, credentials) {
    const secrets = [credentials?.token, credentials?.sessionId].filter(
        (secret) => typeof secret === "string" && secret.length > 0,
    )
    if (secrets.length === 0) return false
    const pending = [root]
    const visited = new WeakSet()
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value === "string") {
            if (secrets.some((secret) => value.includes(secret))) return true
            continue
        }
        if (typeof value !== "object" || value === null || visited.has(value)) continue
        visited.add(value)
        let descriptors
        try {
            descriptors = Object.getOwnPropertyDescriptors(value)
        } catch {
            return true
        }
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (secrets.some((secret) => key.includes(secret))) return true
            if (!Object.hasOwn(descriptor, "value")) return true
            pending.push(descriptor.value)
        }
    }
    return false
}

function serializableControlResult(result, credentials) {
    if (containsControlAuthority(result, credentials)) {
        throw new Error("Control result was rejected")
    }
    return serializableResult(result)
}

function safeControlError(error, credentials) {
    const fallback = publicControlError(null)
    const publish = (candidate) => containsControlAuthority(candidate, credentials)
        ? fallback
        : candidate
    const trusted = publicControlError(error)
    if (trusted.code !== fallback.code) return publish(trusted)
    if (typeof error !== "object" || error === null) return fallback
    let descriptors
    try {
        descriptors = Object.getOwnPropertyDescriptors(error)
    } catch {
        return fallback
    }
    const ownValue = (name) => {
        const descriptor = descriptors[name]
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined
    }
    const code = ownValue("code")
    if (!PUBLIC_CONTROL_ERROR_CODE_SET.has(code)) return fallback
    try {
        const canonical = publicControlError(createPublicControlError(code, {
            details: ownValue("details"),
        }))
        if (
            ownValue("message") !== canonical.message ||
            ownValue("retryable") !== canonical.retryable
        ) return fallback
        return publish(canonical)
    } catch {
        return fallback
    }
}

function externalInput(entry, skill, sourceKind) {
    return {
        question: entry?.question,
        skill: entry?.skill ?? skill,
        note: entry?.note ?? "",
        source: {kind: sourceKind},
    }
}

function enqueueBatch(store, payload, sourceKind) {
    const cases = Array.isArray(payload?.cases) ? payload.cases : []
    if (!cases.length) throw new Error("At least one Raw Case is required")
    return store.addMany(cases.map((entry) => externalInput(entry, payload.skill, sourceKind)))
}

function serializableResult(result) {
    return JSON.parse(JSON.stringify(result))
}

function toolResponse(result) {
    const structuredContent = serializableResult(result)
    return {
        content: [{type: "text", text: JSON.stringify(structuredContent)}],
        structuredContent,
    }
}

function createRawCaseMcpServer() {
    const server = new McpServer(
        {name: "rolling-skill-raw-case-inbox", version: TOOL_VERSION},
        {capabilities: {tools: {}}},
    )
    server.registerTool(
        "rolling_skill_enqueue_raw_cases",
        {
            title: "Enqueue Rolling Skill Raw Cases",
            description:
                "Append unverified natural-language questions to Rolling Skill's Raw Case inbox. This does not execute a runtime or create formal evaluation Cases.",
            inputSchema: z.object({
                skill: z.object({
                    name: z.string().min(1).max(200),
                    path: z.string().max(4000).optional(),
                }),
                cases: z.array(z.object({
                    question: z.string().min(1).max(120000),
                    note: z.string().max(10000).optional(),
                })).min(1).max(200),
            }),
            outputSchema: z.object({
                created: z.array(z.any()),
                duplicates: z.array(z.any()),
                rejected: z.array(z.any()),
            }),
            annotations: {
                title: "Enqueue Raw Cases",
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
        },
        async (input) => {
            const store = new RawCaseStore()
            try {
                return toolResponse(enqueueBatch(store, input, "external-mcp"))
            } finally {
                store.close()
            }
        },
    )
    server.registerTool(
        "rolling_skill_list_raw_cases",
        {
            title: "List Rolling Skill Raw Cases",
            description: "List pending questions in Rolling Skill's Raw Case inbox.",
            inputSchema: z.object({skillName: z.string().max(200).optional()}),
            outputSchema: z.object({rawCases: z.array(z.any())}),
            annotations: {
                title: "List Raw Cases",
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async ({skillName}) => {
            const store = new RawCaseStore()
            try {
                return toolResponse({rawCases: store.list({skillName})})
            } finally {
                store.close()
            }
        },
    )
    return server
}

function controlToolName(method) {
    return `rolling_skill_${method.replaceAll(".", "_")}`
}

function controlToolAnnotations(definition) {
    const readOnly = definition.action.endsWith(".read")
    const idempotent = readOnly || (
        definition.input?.shape && Object.hasOwn(definition.input.shape, "idempotencyKey")
    )
    return {
        readOnlyHint: readOnly,
        destructiveHint: false,
        idempotentHint: Boolean(idempotent),
        openWorldHint: false,
    }
}

function controlToolError(error, credentials) {
    const structuredContent = safeControlError(error, credentials)
    return {
        content: [{type: "text", text: JSON.stringify(structuredContent)}],
        structuredContent,
        isError: true,
    }
}

function createOperatorMcpServer(credentials = controlCredentials()) {
    const client = new ControlSocketClient(credentials)
    const server = new McpServer(
        {name: "rolling-skill-operator", version: TOOL_VERSION},
        {capabilities: {tools: {}}},
    )
    for (const method of OPERATOR_CONTROL_METHODS) {
        const definition = controlDefinition(method)
        server.registerTool(
            controlToolName(method),
            {
                title: `Rolling Skill ${method}`,
                description: definition.description ??
                    `Invoke the authenticated Rolling Skill ${method} control method.`,
                inputSchema: definition.input,
                outputSchema: definition.output,
                annotations: {
                    title: `Rolling Skill ${method}`,
                    ...controlToolAnnotations(definition),
                },
            },
            async (input) => {
                try {
                    const result = parseControlOutput(method, await client.invoke(method, input))
                    return toolResponse(serializableControlResult(result, credentials))
                } catch (error) {
                    return controlToolError(error, credentials)
                }
            },
        )
    }
    const closeServer = server.close.bind(server)
    server.close = async () => {
        client.close()
        await closeServer()
    }
    return server
}

function createInstallationMcpServer(credentials = controlCredentials()) {
    const client = new ControlSocketClient(credentials)
    const server = new McpServer(
        {name: "rolling-skill-installation", version: TOOL_VERSION},
        {capabilities: {tools: {}}},
    )
    for (const method of INSTALLATION_AGENT_CONTROL_METHODS) {
        const definition = controlDefinition(method)
        server.registerTool(
            controlToolName(method),
            {
                title: "Register Rolling Skill Installation",
                description: "Register verified terminal evidence for this scoped installation Job.",
                inputSchema: definition.input,
                outputSchema: definition.output,
                annotations: {
                    title: "Register Skill Installation",
                    readOnlyHint: false,
                    destructiveHint: false,
                    idempotentHint: true,
                    openWorldHint: false,
                },
            },
            async (input) => {
                try {
                    const result = parseControlOutput(method, await client.invoke(method, input))
                    return toolResponse(serializableControlResult(result, credentials))
                } catch (error) {
                    return controlToolError(error, credentials)
                }
            },
        )
    }
    const closeServer = server.close.bind(server)
    server.close = async () => {
        client.close()
        await closeServer()
    }
    return server
}

function usage() {
    return [
        "rolling-skill-tool enqueue --skill <name> --question <text> [--skill-path <path>] [--note <text>]",
        "rolling-skill-tool enqueue --json <file|->",
        "rolling-skill-tool list [--skill <name>] --json",
        "rolling-skill-tool mcp",
        "rolling-skill-tool control <method> --params-json <file|->",
        "rolling-skill-tool installation-mcp",
        "rolling-skill-tool operator-mcp",
    ].join("\n")
}

function serveMcpUntilShutdown(factory, options = {}) {
    const processObject = options.processObject ?? process
    const input = options.input ?? processObject.stdin
    const handle = serveStdio(factory, {onerror: options.onerror})
    let closePromise = null
    let resolveClosed
    const closed = new Promise((resolve) => {
        resolveClosed = resolve
    })
    const listeners = []
    const listenOnce = (emitter, event, listener) => {
        emitter.once(event, listener)
        listeners.push([emitter, event, listener])
    }
    const removeListeners = () => {
        for (const [emitter, event, listener] of listeners.splice(0)) {
            emitter.removeListener(event, listener)
        }
    }
    const close = () => {
        if (closePromise) return closePromise
        removeListeners()
        closePromise = Promise.resolve()
            .then(() => handle.close())
            .catch(() => {})
            .finally(resolveClosed)
        return closePromise
    }
    const onInputClosed = () => {
        void close()
    }
    const onSignal = () => {
        processObject.exitCode = 0
        void close()
    }
    listenOnce(input, "end", onInputClosed)
    listenOnce(input, "close", onInputClosed)
    listenOnce(processObject, "SIGINT", onSignal)
    listenOnce(processObject, "SIGTERM", onSignal)
    return {close, closed}
}

async function runCli(arguments_) {
    const {command, options} = parseArguments(arguments_)
    if (command === "mcp") {
        const lifecycle = serveMcpUntilShutdown(() => createRawCaseMcpServer(), {
            onerror: (error) => console.error(error?.stack || error?.message || String(error)),
        })
        await lifecycle.closed
        return
    }
    if (command === "operator-mcp") {
        const credentials = controlCredentials()
        const lifecycle = serveMcpUntilShutdown(
            () => createOperatorMcpServer(credentials),
            {onerror: () => {}},
        )
        await lifecycle.closed
        return
    }
    if (command === "installation-mcp") {
        const credentials = controlCredentials()
        const lifecycle = serveMcpUntilShutdown(
            () => createInstallationMcpServer(credentials),
            {onerror: () => {}},
        )
        await lifecycle.closed
        return
    }
    if (command === "help" || command === "--help" || command === "-h") {
        process.stdout.write(`${usage()}\n`)
        return
    }
    if (command === "control") {
        controlDefinition(options.method)
        const credentials = controlCredentials()
        const result = await invokeControl(
            options.method,
            await readBoundedJsonInput(options["params-json"]),
            credentials,
        )
        process.stdout.write(`${JSON.stringify(serializableResult(result))}\n`)
        return
    }
    const store = new RawCaseStore()
    try {
        if (command === "enqueue") {
            let result
            if (options.json) {
                result = enqueueBatch(store, await readJsonInput(options.json), "external-cli")
            } else {
                const added = store.add({
                    question: options.question,
                    skill: {name: options.skill, path: options["skill-path"]},
                    note: options.note,
                    source: {kind: "external-cli"},
                })
                result = added?.created === false
                    ? {created: [], duplicates: [{index: 0, duplicateOf: added.duplicateOf}], rejected: []}
                    : {created: [added], duplicates: [], rejected: []}
            }
            process.stdout.write(`${JSON.stringify(result)}\n`)
            return
        }
        if (command === "list") {
            process.stdout.write(`${JSON.stringify({rawCases: store.list({skillName: options.skill})})}\n`)
            return
        }
        throw new Error(`Unknown command: ${command}\n${usage()}`)
    } finally {
        store.close()
    }
}

const cliArguments = process.argv.slice(2)
runCli(cliArguments).catch((error) => {
if (
    cliArguments[0] === "control" ||
    cliArguments[0] === "operator-mcp" ||
    cliArguments[0] === "installation-mcp"
) {
        process.stderr.write(`${JSON.stringify(safeControlError(error, {
            token: process.env.ROLLING_SKILL_CONTROL_TOKEN,
            sessionId: process.env.ROLLING_SKILL_OPERATOR_SESSION ??
                process.env.ROLLING_SKILL_CONTROL_SESSION,
        }))}\n`)
    } else {
        console.error(error?.message || String(error))
    }
    process.exitCode = 1
})

export {
    createInstallationMcpServer,
    createOperatorMcpServer,
    createRawCaseMcpServer,
    enqueueBatch,
    invokeControl,
    parseArguments,
    runCli,
    serveMcpUntilShutdown,
}
