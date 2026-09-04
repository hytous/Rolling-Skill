const assert = require("node:assert/strict")
const {execFileSync, spawn} = require("node:child_process")
const {
    chmodSync,
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {RawCaseStore} = require("../src/raw-case-store.cjs")
const {ControlSocketServer} = require("../src/control-plane/socket-server.cjs")
const {
    CONTROL_METHODS,
    INSTALLATION_AGENT_CONTROL_METHODS,
    OPERATOR_CONTROL_METHODS,
    createPublicControlError,
} = require("../src/control-plane/contracts.cjs")

const toolPath = join(__dirname, "..", "tools", "rolling-skill-tool.mjs")
const buildScriptPath = join(__dirname, "..", "scripts", "build-external-tool.mjs")
const temporaryDirectories = []
const controlEnvironmentKeys = [
    "ROLLING_SKILL_CONTROL_SOCKET",
    "ROLLING_SKILL_CONTROL_TOKEN",
    "ROLLING_SKILL_CONTROL_SESSION",
    "ROLLING_SKILL_OPERATOR_SESSION",
    "ROLLING_SKILL_CONTROL_TIMEOUT_MS",
]

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function cleanEnvironment(overrides = {}) {
    const environment = {...process.env}
    for (const key of controlEnvironmentKeys) delete environment[key]
    return {...environment, ...overrides}
}

function fixtureEnvironment() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-raw-case-tool-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "raw-case-events.jsonl")
    return {
        path,
        environment: cleanEnvironment({ROLLING_SKILL_RAW_CASE_PATH: path}),
    }
}

function controlEnvironment(socketPath, token, sessionId, overrides = {}) {
    return cleanEnvironment({
        ROLLING_SKILL_CONTROL_SOCKET: socketPath,
        ROLLING_SKILL_CONTROL_TOKEN: token,
        ROLLING_SKILL_CONTROL_SESSION: sessionId,
        ...overrides,
    })
}

async function startControlFixture(invoke) {
    const directory = mkdtempSync("/tmp/rs-control-")
    temporaryDirectories.push(directory)
    const server = new ControlSocketServer({
        userData: directory,
        controlPlane: {invoke},
    })
    await server.start()
    return server
}

function assertNoSecrets(output, secrets) {
    for (const secret of secrets) assert.doesNotMatch(output, new RegExp(secret, "u"))
}

async function waitFor(predicate, message = "condition was not met") {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
        if (predicate()) return
        await new Promise((resolve) => setTimeout(resolve, 5))
    }
    assert.fail(message)
}

function runTool(arguments_, {environment, input} = {}) {
    return execFileSync(process.execPath, [toolPath, ...arguments_], {
        env: environment,
        encoding: "utf8",
        input,
    })
}

function runToolAsync(arguments_, {
    environment,
    input,
    executablePath = toolPath,
    nodeArguments = [],
    timeoutMs = 5_000,
} = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            ...nodeArguments,
            executablePath,
            ...arguments_,
        ], {
            env: environment,
            stdio: ["pipe", "pipe", "pipe"],
        })
        const stdout = []
        const stderr = []
        let timedOut = false
        const timeout = setTimeout(() => {
            timedOut = true
            child.kill("SIGKILL")
        }, timeoutMs)
        child.stdout.on("data", (chunk) => stdout.push(chunk))
        child.stderr.on("data", (chunk) => stderr.push(chunk))
        child.once("error", (error) => {
            clearTimeout(timeout)
            reject(error)
        })
        child.once("close", (code, signal) => {
            clearTimeout(timeout)
            resolve({
                code,
                signal,
                timedOut,
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
            })
        })
        child.stdin.end(input)
    })
}

function spawnMcpPeer(arguments_, environment) {
    const child = spawn(process.execPath, [toolPath, ...arguments_], {
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
    })
    const pending = new Map()
    const stderr = []
    let buffer = ""
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.stdout.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        let newline = buffer.indexOf("\n")
        while (newline >= 0) {
            const message = JSON.parse(buffer.slice(0, newline))
            buffer = buffer.slice(newline + 1)
            const waiter = pending.get(message.id)
            if (waiter) {
                pending.delete(message.id)
                clearTimeout(waiter.timeout)
                waiter.resolve(message)
            }
            newline = buffer.indexOf("\n")
        }
    })
    child.once("close", () => {
        for (const waiter of pending.values()) {
            clearTimeout(waiter.timeout)
            waiter.reject(new Error("MCP child closed before responding"))
        }
        pending.clear()
    })
    return {
        child,
        stderr,
        notify(method, params = {}) {
            child.stdin.write(`${JSON.stringify({jsonrpc: "2.0", method, params})}\n`)
        },
        request(id, method, params) {
            const response = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    pending.delete(id)
                    reject(new Error(`MCP request timed out: ${method}`))
                }, 2_000)
                pending.set(id, {resolve, reject, timeout})
            })
            child.stdin.write(`${JSON.stringify({jsonrpc: "2.0", id, method, params})}\n`)
            return response
        },
    }
}

describe("rolling-skill external Raw Case tool", () => {
    it("invokes a control method with JSON params from stdin", async () => {
        const invocations = []
        const server = await startControlFixture(async (request) => {
            invocations.push(request)
            return {workspaceRoot: "/workspace", runtimes: []}
        })
        const environment = controlEnvironment(
            server.socketPath,
            "stdin-secret-token",
            "stdin-secret-session",
        )

        try {
            const result = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {environment, input: "{}"})

            assert.equal(result.code, 0, result.stderr)
            assert.equal(result.stderr, "")
            assert.deepEqual(JSON.parse(result.stdout), {
                workspaceRoot: "/workspace",
                runtimes: [],
            })
            assert.equal(result.stdout.split("\n").length, 2)
            assert.deepEqual(invocations, [{
                method: "context.get",
                params: {},
                token: "stdin-secret-token",
                sessionId: "stdin-secret-session",
            }])
        } finally {
            await server.close()
        }
    })

    it("reads control params from a bounded file and applies the shared contract", async () => {
        const invocations = []
        const server = await startControlFixture(async (request) => {
            invocations.push(request)
            return {rawCases: [], nextCursor: null}
        })
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-params-"))
        temporaryDirectories.push(directory)
        const paramsPath = join(directory, "params.json")
        writeFileSync(paramsPath, JSON.stringify({skillName: "billing"}))

        try {
            const result = await runToolAsync([
                "control",
                "raw_cases.list",
                "--params-json",
                paramsPath,
            ], {
                environment: controlEnvironment(server.socketPath, "file-token", "file-session"),
            })

            assert.equal(result.code, 0, result.stderr)
            assert.deepEqual(JSON.parse(result.stdout), {rawCases: [], nextCursor: null})
            assert.deepEqual(invocations[0].params, {
                cursor: null,
                limit: 50,
                skillName: "billing",
            })
        } finally {
            await server.close()
        }
    })

    it("validates all control credentials before opening a params file", async () => {
        if (process.platform === "win32") return
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-fifo-"))
        temporaryDirectories.push(directory)
        const fifoPath = join(directory, "params.fifo")
        execFileSync("mkfifo", [fifoPath])
        const result = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            fifoPath,
        ], {
            environment: cleanEnvironment({
                ROLLING_SKILL_CONTROL_SOCKET: "/tmp/unused-control.sock",
                ROLLING_SKILL_CONTROL_TOKEN: "credential-first-token",
            }),
            timeoutMs: 500,
        })

        assert.equal(result.timedOut, false, "params FIFO was opened before credential validation")
        assert.notEqual(result.code, 0)
        assert.equal(JSON.parse(result.stderr).code, "CONTROL_ERROR")
        assertNoSecrets(result.stdout + result.stderr, ["credential-first-token"])
    })

    it("rejects symlinks and non-regular params files without blocking", async () => {
        if (process.platform === "win32") return
        let invocations = 0
        const server = await startControlFixture(async () => {
            invocations += 1
            return {workspaceRoot: "/workspace", runtimes: []}
        })
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-files-"))
        temporaryDirectories.push(directory)
        const regularPath = join(directory, "regular.json")
        const regularLinkPath = join(directory, "regular-link.json")
        const fifoPath = join(directory, "params.fifo")
        const fifoLinkPath = join(directory, "fifo-link")
        const directoryPath = join(directory, "params-directory")
        writeFileSync(regularPath, "{}")
        symlinkSync(regularPath, regularLinkPath)
        execFileSync("mkfifo", [fifoPath])
        symlinkSync(fifoPath, fifoLinkPath)
        mkdirSync(directoryPath)

        try {
            const candidates = [
                ["symlink to regular file", regularLinkPath],
                ["FIFO", fifoPath],
                ["symlink to FIFO", fifoLinkPath],
                ["directory", directoryPath],
                ["device", "/dev/null"],
            ]
            const results = await Promise.all(candidates.map(async ([label, paramsPath]) => [
                label,
                await runToolAsync([
                    "control",
                    "context.get",
                    "--params-json",
                    paramsPath,
                ], {
                    environment: controlEnvironment(
                        server.socketPath,
                        "unsafe-file-token",
                        "unsafe-file-session",
                    ),
                    timeoutMs: 750,
                }),
            ]))

            for (const [label, result] of results) {
                assert.equal(result.timedOut, false, `${label} blocked the control tool`)
                assert.notEqual(result.code, 0, `${label} was accepted`)
                assert.equal(JSON.parse(result.stderr).code, "CONTROL_ERROR")
                assertNoSecrets(
                    result.stdout + result.stderr,
                    ["unsafe-file-token", "unsafe-file-session"],
                )
            }
            assert.equal(invocations, 0)
        } finally {
            await server.close()
        }
    })

    it("bounds oversized and concurrently growing regular params files", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-growth-"))
        temporaryDirectories.push(directory)
        const oversizedPath = join(directory, "oversized.json")
        const growingPath = join(directory, "growing.json")
        const growthHookPath = join(directory, "grow-after-first-read.cjs")
        writeFileSync(oversizedPath, `{"padding":"${"x".repeat(1_048_576)}"}`)
        writeFileSync(growingPath, `{"padding":"${"x".repeat(900_000)}"}`)
        writeFileSync(growthHookPath, [
            'const fs = require("node:fs")',
            'const {syncBuiltinESMExports} = require("node:module")',
            "const originalReadSync = fs.readSync",
            "let grew = false",
            "fs.readSync = function (...arguments_) {",
            "    const bytesRead = Reflect.apply(originalReadSync, this, arguments_)",
            "    const opened = fs.fstatSync(arguments_[0])",
            "    const target = fs.statSync(process.env.ROLLING_SKILL_TEST_GROW_PATH)",
            "    if (!grew && bytesRead > 0 && opened.dev === target.dev && opened.ino === target.ino) {",
            "        grew = true",
            '        fs.appendFileSync(process.env.ROLLING_SKILL_TEST_GROW_PATH, " ")',
            "    }",
            "    return bytesRead",
            "}",
            "syncBuiltinESMExports()",
        ].join("\n"))
        const environment = controlEnvironment(
            "/tmp/rolling-skill-growth-unused.sock",
            "growth-token",
            "growth-session",
        )

        const oversized = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            oversizedPath,
        ], {environment, timeoutMs: 750})
        assert.equal(oversized.timedOut, false)
        assert.notEqual(oversized.code, 0)
        assert.equal(JSON.parse(oversized.stderr).code, "CONTROL_ERROR")

        const initialGrowingBytes = readFileSync(growingPath).length
        const growing = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            growingPath,
        ], {
            environment: {
                ...environment,
                ROLLING_SKILL_TEST_GROW_PATH: growingPath,
            },
            nodeArguments: ["--require", growthHookPath],
            timeoutMs: 750,
        })
        assert.equal(growing.timedOut, false)
        assert.notEqual(growing.code, 0)
        assert.equal(JSON.parse(growing.stderr).code, "CONTROL_ERROR")
        assert.equal(readFileSync(growingPath).length, initialGrowingBytes + 1)
        assertNoSecrets(
            oversized.stdout + oversized.stderr + growing.stdout + growing.stderr,
            ["growth-token", "growth-session"],
        )
    })

    it("publishes one sanitized structured CLI error and requires all three credentials", async () => {
        const secrets = ["cli-secret-token", "cli-secret-session", "private-state"]
        const server = await startControlFixture(async () => {
            throw createPublicControlError("CONTROL_BUSY", {internalMessage: "private-state"})
        })
        try {
            const publicFailure = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                environment: controlEnvironment(server.socketPath, secrets[0], secrets[1]),
                input: "{}",
            })
            assert.notEqual(publicFailure.code, 0)
            assert.equal(publicFailure.stdout, "")
            assert.deepEqual(JSON.parse(publicFailure.stderr), {
                code: "CONTROL_BUSY",
                message: "Control operation is busy",
                retryable: true,
                details: null,
            })
            assert.equal(publicFailure.stderr.split("\n").length, 2)
            assertNoSecrets(publicFailure.stdout + publicFailure.stderr, secrets)

            const completeCredentials = {
                ROLLING_SKILL_CONTROL_SOCKET: server.socketPath,
                ROLLING_SKILL_CONTROL_TOKEN: secrets[0],
                ROLLING_SKILL_CONTROL_SESSION: secrets[1],
            }
            for (const missingKey of Object.keys(completeCredentials)) {
                const incompleteCredentials = {...completeCredentials}
                delete incompleteCredentials[missingKey]
                const missingCredential = await runToolAsync([
                    "control",
                    "context.get",
                    "--params-json",
                    "-",
                ], {environment: cleanEnvironment(incompleteCredentials), input: "{}"})
                assert.notEqual(missingCredential.code, 0)
                assert.deepEqual(JSON.parse(missingCredential.stderr), {
                    code: "CONTROL_ERROR",
                    message: "Control operation failed",
                    retryable: false,
                    details: null,
                })
                assertNoSecrets(missingCredential.stdout + missingCredential.stderr, secrets)
            }

            const missingOperatorCredential = await runToolAsync(["operator-mcp"], {
                environment: cleanEnvironment({
                    ROLLING_SKILL_CONTROL_SOCKET: server.socketPath,
                    ROLLING_SKILL_CONTROL_TOKEN: secrets[0],
                }),
            })
            assert.notEqual(missingOperatorCredential.code, 0)
            assert.equal(JSON.parse(missingOperatorCredential.stderr).code, "CONTROL_ERROR")
            assertNoSecrets(
                missingOperatorCredential.stdout + missingOperatorCredential.stderr,
                secrets,
            )
        } finally {
            await server.close()
        }
    })

    it("accepts the session-scoped Operator environment name without argv credentials", async () => {
        const invocations = []
        const server = await startControlFixture(async (request) => {
            invocations.push(request)
            return {workspaceRoot: "/workspace", runtimes: []}
        })
        try {
            const result = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                environment: cleanEnvironment({
                    ROLLING_SKILL_CONTROL_SOCKET: server.socketPath,
                    ROLLING_SKILL_CONTROL_TOKEN: "operator-name-token",
                    ROLLING_SKILL_OPERATOR_SESSION: "operator-name-session",
                }),
                input: "{}",
            })

            assert.equal(result.code, 0, result.stderr)
            assert.equal(invocations[0].sessionId, "operator-name-session")
            assert.equal(invocations[0].token, "operator-name-token")
            assertNoSecrets(result.stdout + result.stderr, [
                "operator-name-token",
                "operator-name-session",
            ])
        } finally {
            await server.close()
        }
    })

    it("fails closed if a control result reflects either authority secret", async () => {
        const token = "reflected-authority-token"
        const session = "reflected-authority-session"
        const server = await startControlFixture(async () => ({
            workspaceRoot: token,
            runtimes: [{session}],
        }))
        try {
            const result = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                environment: controlEnvironment(server.socketPath, token, session),
                input: "{}",
            })
            assert.notEqual(result.code, 0)
            assert.equal(result.stdout, "")
            assert.equal(JSON.parse(result.stderr).code, "CONTROL_ERROR")
            assertNoSecrets(result.stdout + result.stderr, [token, session])
        } finally {
            await server.close()
        }
    })

    it("rejects a socket result that violates the shared output contract", async () => {
        const server = await startControlFixture(async () => ({privateResult: true}))
        try {
            const result = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                environment: controlEnvironment(server.socketPath, "output-token", "output-session"),
                input: "{}",
            })
            assert.notEqual(result.code, 0)
            assert.equal(result.stdout, "")
            const error = JSON.parse(result.stderr)
            assert.equal(error.code, "INVALID_RESULT")
            assert.equal(error.details.method, "context.get")
        } finally {
            await server.close()
        }
    })

    it("rejects unknown methods and non-object or oversized params before socket dispatch", async () => {
        const environment = controlEnvironment(
            "/tmp/rolling-skill-control-does-not-exist.sock",
            "validation-token",
            "validation-session",
        )
        const unknown = await runToolAsync([
            "control",
            "unknown.method",
            "--params-json",
            "-",
        ], {environment, input: "{}"})
        assert.notEqual(unknown.code, 0)
        assert.equal(JSON.parse(unknown.stderr).code, "UNKNOWN_CONTROL_METHOD")

        const unknownBeforeFileRead = await runToolAsync([
            "control",
            "still.unknown",
            "--params-json",
            "/tmp/rolling-skill-params-do-not-exist.json",
        ], {environment})
        assert.notEqual(unknownBeforeFileRead.code, 0)
        assert.equal(JSON.parse(unknownBeforeFileRead.stderr).code, "UNKNOWN_CONTROL_METHOD")

        const notAnObject = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            "-",
        ], {environment, input: "[]"})
        assert.notEqual(notAnObject.code, 0)
        assert.equal(JSON.parse(notAnObject.stderr).code, "CONTROL_ERROR")

        const oversized = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            "-",
        ], {environment, input: `{"padding":"${"x".repeat(1_048_576)}"}`})
        assert.notEqual(oversized.code, 0)
        assert.equal(JSON.parse(oversized.stderr).code, "CONTROL_ERROR")

        const argvSecret = "must-not-appear-from-argv"
        const forbiddenArgv = await runToolAsync([
            "control",
            "context.get",
            "--token",
            argvSecret,
            "--params-json",
            "-",
        ], {environment, input: "{}"})
        assert.notEqual(forbiddenArgv.code, 0)
        assert.equal(JSON.parse(forbiddenArgv.stderr).code, "CONTROL_ERROR")

        const collidingToken = "context.get"
        const localValidation = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            "-",
        ], {
            environment: controlEnvironment(
                "/tmp/rolling-skill-validation.sock",
                collidingToken,
                "local-validation-session",
            ),
            input: '{"unexpected":true}',
        })
        assert.notEqual(localValidation.code, 0)
        assertNoSecrets(localValidation.stderr, [collidingToken, "local-validation-session"])
        assertNoSecrets(
            unknown.stderr + unknownBeforeFileRead.stderr + notAnObject.stderr +
                oversized.stderr + forbiddenArgv.stderr,
            ["validation-token", "validation-session", argvSecret],
        )
    })

    it("registers all typed control contracts through operator MCP", async () => {
        const token = "operator-mcp-secret-token"
        const session = "operator-mcp-secret-session"
        const invocations = []
        const server = await startControlFixture(async (request) => {
            invocations.push(request)
            if (request.method === "raw_cases.list") {
                throw createPublicControlError("CONTROL_BUSY", {internalMessage: "hidden-queue"})
            }
            if (request.method === "runtimes.list") return {runtimes: [token, session]}
            return {workspaceRoot: "/workspace", runtimes: []}
        })
        const [{Client}, {StdioClientTransport}] = await Promise.all([
            import("@modelcontextprotocol/client"),
            import("@modelcontextprotocol/client/stdio"),
        ])
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [toolPath, "operator-mcp"],
            env: controlEnvironment(server.socketPath, token, session),
            stderr: "pipe",
        })
        const stderr = []
        transport.stderr.on("data", (chunk) => stderr.push(chunk))
        const client = new Client({name: "rolling-skill-operator-test", version: "1.0.0"})
        try {
            await client.connect(transport)
            const listed = await client.listTools()
            assert.equal(listed.tools.length, OPERATOR_CONTROL_METHODS.length)
            assert.deepEqual(
                listed.tools.map((tool) => tool.name).sort(),
                OPERATOR_CONTROL_METHODS.map((method) => `rolling_skill_${method.replaceAll(".", "_")}`).sort(),
            )
            assert.equal(listed.tools.some((tool) => (
                [
                    "rolling_skill_approvals_resolve",
                    "rolling_skill_jobs_pause",
                    "rolling_skill_jobs_resume",
                    "rolling_skill_jobs_stop",
                    "rolling_skill_skills_get",
                ].includes(tool.name)
            )), false)

            const readTool = listed.tools.find((tool) => tool.name === "rolling_skill_raw_cases_list")
            assert.equal(readTool.inputSchema.type, "object")
            assert.equal(readTool.inputSchema.additionalProperties, false)
            assert.ok(readTool.inputSchema.properties.limit)
            assert.equal(readTool.annotations.readOnlyHint, true)
            assert.equal(readTool.annotations.destructiveHint, false)
            assert.equal(readTool.annotations.idempotentHint, true)
            assert.equal(readTool.annotations.openWorldHint, false)

            const writeTool = listed.tools.find((tool) => tool.name === "rolling_skill_raw_cases_enqueue")
            assert.equal(writeTool.inputSchema.additionalProperties, false)
            assert.ok(writeTool.inputSchema.properties.idempotencyKey)
            assert.equal(writeTool.annotations.readOnlyHint, false)
            assert.equal(writeTool.annotations.destructiveHint, false)
            assert.equal(writeTool.annotations.idempotentHint, true)
            assert.equal(writeTool.annotations.openWorldHint, false)

            const result = await client.callTool({
                name: "rolling_skill_context_get",
                arguments: {},
            })
            assert.deepEqual(result.structuredContent, {
                workspaceRoot: "/workspace",
                runtimes: [],
            })

            const failure = await client.callTool({
                name: "rolling_skill_raw_cases_list",
                arguments: {},
            })
            assert.equal(failure.isError, true)
            assert.deepEqual(failure.structuredContent, {
                code: "CONTROL_BUSY",
                message: "Control operation is busy",
                retryable: true,
                details: null,
            })
            assert.deepEqual(JSON.parse(failure.content[0].text), failure.structuredContent)

            const reflected = await client.callTool({
                name: "rolling_skill_runtimes_list",
                arguments: {},
            })
            assert.equal(reflected.isError, true)
            assert.deepEqual(reflected.structuredContent, {
                code: "CONTROL_ERROR",
                message: "Control operation failed",
                retryable: false,
                details: null,
            })
            assertNoSecrets(JSON.stringify(reflected), [token, session])
            assert.equal(invocations[0].token, token)
            assert.equal(invocations[0].sessionId, session)
        } finally {
            await client.close().catch(() => {})
            await server.close()
        }
        assertNoSecrets(Buffer.concat(stderr).toString("utf8"), [token, session, "hidden-queue"])
    })

    it("exposes only the private registration contract through installation MCP", async () => {
        const token = "installation-mcp-secret-token"
        const session = "installation-mcp-secret-session"
        const invocations = []
        const server = await startControlFixture(async (request) => {
            invocations.push(request)
            return {accepted: true, duplicate: false}
        })
        const [{Client}, {StdioClientTransport}] = await Promise.all([
            import("@modelcontextprotocol/client"),
            import("@modelcontextprotocol/client/stdio"),
        ])
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [toolPath, "installation-mcp"],
            env: controlEnvironment(server.socketPath, token, session),
            stderr: "pipe",
        })
        const stderr = []
        transport.stderr.on("data", (chunk) => stderr.push(chunk))
        const client = new Client({name: "rolling-skill-installation-test", version: "1.0.0"})
        try {
            await client.connect(transport)
            const listed = await client.listTools()
            assert.deepEqual(INSTALLATION_AGENT_CONTROL_METHODS, ["installations.register"])
            assert.deepEqual(listed.tools.map((tool) => tool.name), [
                "rolling_skill_installations_register",
            ])
            assert.equal(listed.tools[0].inputSchema.additionalProperties, false)
            assert.equal(listed.tools[0].inputSchema.properties.runtimeId, undefined)

            const evidence = {
                status: "succeeded",
                operation: "install",
                classificationBefore: "unmanaged",
                destination: "/runtime/skills/billing",
                actualDigest: `sha256:${"a".repeat(64)}`,
                beforeDigest: `sha256:${"b".repeat(64)}`,
                mutationPerformed: true,
                runtimeDiscovered: true,
                warnings: [],
                error: null,
            }
            const result = await client.callTool({
                name: "rolling_skill_installations_register",
                arguments: evidence,
            })
            assert.deepEqual(result.structuredContent, {accepted: true, duplicate: false})
            assert.deepEqual(invocations, [{
                method: "installations.register",
                params: evidence,
                token,
                sessionId: session,
            }])
        } finally {
            await client.close().catch(() => {})
            await server.close()
        }
        assertNoSecrets(Buffer.concat(stderr).toString("utf8"), [token, session])
    })

    it("closes the operator MCP handle and socket client promptly on stdin EOF", async () => {
        const server = await startControlFixture(async () => ({
            workspaceRoot: "/workspace",
            runtimes: [],
        }))
        const [{Client}, {StdioClientTransport}] = await Promise.all([
            import("@modelcontextprotocol/client"),
            import("@modelcontextprotocol/client/stdio"),
        ])
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [toolPath, "operator-mcp"],
            env: controlEnvironment(server.socketPath, "eof-token", "eof-session"),
            stderr: "pipe",
        })
        const stderr = []
        transport.stderr.on("data", (chunk) => stderr.push(chunk))
        const client = new Client({name: "rolling-skill-eof-test", version: "1.0.0"})
        try {
            await client.connect(transport)
            const result = await client.callTool({
                name: "rolling_skill_context_get",
                arguments: {},
            })
            assert.equal(result.structuredContent.workspaceRoot, "/workspace")
            await waitFor(() => server.connectionCount === 1)

            const startedAt = Date.now()
            await client.close()
            assert.ok(Date.now() - startedAt < 1_000, "operator MCP waited for forced termination")
            await waitFor(() => server.connectionCount === 0)
            assertNoSecrets(
                Buffer.concat(stderr).toString("utf8"),
                ["eof-token", "eof-session"],
            )
        } finally {
            await client.close().catch(() => {})
            await server.close()
        }
    })

    it("closes the operator MCP handle cleanly on SIGTERM", async () => {
        if (process.platform === "win32") return
        const token = "signal-token"
        const session = "signal-session"
        const server = await startControlFixture(async () => ({
            workspaceRoot: "/workspace",
            runtimes: [],
        }))
        const peer = spawnMcpPeer(
            ["operator-mcp"],
            controlEnvironment(server.socketPath, token, session),
        )
        try {
            const initialized = await peer.request(1, "initialize", {
                protocolVersion: "2025-06-18",
                capabilities: {},
                clientInfo: {name: "rolling-skill-signal-test", version: "1.0.0"},
            })
            assert.ok(initialized.result)
            peer.notify("notifications/initialized")
            const called = await peer.request(2, "tools/call", {
                name: "rolling_skill_context_get",
                arguments: {},
            })
            assert.equal(called.result.structuredContent.workspaceRoot, "/workspace")
            await waitFor(() => server.connectionCount === 1)

            const exited = new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({code: null, signal: null, timedOut: true})
                }, 1_000)
                peer.child.once("close", (code, signal) => {
                    clearTimeout(timeout)
                    resolve({code, signal, timedOut: false})
                })
            })
            peer.child.kill("SIGTERM")
            const outcome = await exited
            if (outcome.timedOut) peer.child.kill("SIGKILL")
            assert.equal(outcome.timedOut, false)
            assert.equal(outcome.code, 0)
            assert.equal(outcome.signal, null)
            await waitFor(() => server.connectionCount === 0)
            assertNoSecrets(Buffer.concat(peer.stderr).toString("utf8"), [token, session])
        } finally {
            if (peer.child.exitCode === null && peer.child.signalCode === null) {
                peer.child.kill("SIGKILL")
            }
            await server.close()
        }
    })

    it("sanitizes control timeouts, disconnects, and an unavailable App", async () => {
        const timeoutSecrets = ["timeout-token", "timeout-session"]
        const timeoutServer = await startControlFixture(() => new Promise(() => {}))
        try {
            const startedAt = Date.now()
            const timedOut = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                environment: controlEnvironment(
                    timeoutServer.socketPath,
                    timeoutSecrets[0],
                    timeoutSecrets[1],
                    {ROLLING_SKILL_CONTROL_TIMEOUT_MS: "25"},
                ),
                input: "{}",
            })
            assert.notEqual(timedOut.code, 0)
            assert.ok(Date.now() - startedAt < 1_000, "safe timeout override was not applied")
            assert.equal(JSON.parse(timedOut.stderr).code, "CONTROL_ERROR")
            assertNoSecrets(timedOut.stdout + timedOut.stderr, timeoutSecrets)
        } finally {
            await timeoutServer.close()
        }

        const disconnectSecrets = ["disconnect-token", "disconnect-session"]
        const disconnectServer = await startControlFixture(() => new Promise(() => {}))
        const pending = runToolAsync([
            "control",
            "context.get",
            "--params-json",
            "-",
        ], {
            environment: controlEnvironment(
                disconnectServer.socketPath,
                disconnectSecrets[0],
                disconnectSecrets[1],
            ),
            input: "{}",
        })
        await waitFor(() => disconnectServer.connectionCount === 1)
        await disconnectServer.close()
        const disconnected = await pending
        assert.notEqual(disconnected.code, 0)
        assert.equal(JSON.parse(disconnected.stderr).code, "CONTROL_ERROR")
        assertNoSecrets(disconnected.stdout + disconnected.stderr, disconnectSecrets)

        const missingAppSecrets = ["missing-app-token", "missing-app-session"]
        const unavailable = await runToolAsync([
            "control",
            "context.get",
            "--params-json",
            "-",
        ], {
            environment: controlEnvironment(
                "/tmp/rolling-skill-missing-app.sock",
                missingAppSecrets[0],
                missingAppSecrets[1],
            ),
            input: "{}",
        })
        assert.notEqual(unavailable.code, 0)
        assert.equal(JSON.parse(unavailable.stderr).code, "CONTROL_ERROR")
        assertNoSecrets(unavailable.stdout + unavailable.stderr, missingAppSecrets)
    })

    it("runs the single-file bundled control tool from a temporary directory", async () => {
        const rollingSkillRoot = join(__dirname, "..")
        const builtPath = execFileSync(process.execPath, [buildScriptPath], {
            cwd: rollingSkillRoot,
            encoding: "utf8",
        }).trim()
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-bundled-tool-"))
        temporaryDirectories.push(directory)
        const copiedPath = join(directory, "rolling-skill-tool")
        copyFileSync(builtPath, copiedPath)
        chmodSync(copiedPath, 0o755)
        const bundledSource = readFileSync(copiedPath, "utf8")
        assert.match(bundledSource, /^#!\/usr\/bin\/env node/u)
        assert.ok(bundledSource.includes("// src/control-plane/contracts.cjs"))
        assert.ok(bundledSource.includes("// src/control-plane/socket-client.cjs"))
        assert.doesNotMatch(bundledSource, /control-plane\/domain-services\.cjs/u)

        const server = await startControlFixture(async () => ({
            workspaceRoot: "/bundled-workspace",
            runtimes: [],
        }))
        try {
            const result = await runToolAsync([
                "control",
                "context.get",
                "--params-json",
                "-",
            ], {
                executablePath: copiedPath,
                environment: controlEnvironment(server.socketPath, "bundle-token", "bundle-session"),
                input: "{}",
            })
            assert.equal(result.code, 0, result.stderr)
            assert.deepEqual(JSON.parse(result.stdout), {
                workspaceRoot: "/bundled-workspace",
                runtimes: [],
            })
        } finally {
            await server.close()
        }
    })

    it("enqueues one verbatim question and lists it as JSON", () => {
        const {path, environment} = fixtureEnvironment()
        const question = "  查一下 7 月账单，混元 3 花了多少？  "

        const enqueueResult = JSON.parse(runTool([
            "enqueue",
            "--skill",
            "billing-cost-management",
            "--question",
            question,
            "--note",
            "来自另一个 Agent",
        ], {environment}))
        const listResult = JSON.parse(runTool(["list", "--json"], {environment}))
        const store = new RawCaseStore(path)

        assert.equal(enqueueResult.created.length, 1)
        assert.equal(listResult.rawCases.length, 1)
        assert.equal(listResult.rawCases[0].question, question)
        assert.equal(listResult.rawCases[0].skill.name, "billing-cost-management")
        assert.equal(store.list()[0].source.kind, "external-cli")
        store.close()
    })

    it("accepts a bounded JSON batch from stdin and reports duplicates", () => {
        const {environment} = fixtureEnvironment()
        const payload = JSON.stringify({
            skill: {name: "billing-cost-management"},
            cases: [
                {question: "问题一"},
                {question: "问题一"},
                {question: "问题二", note: "稍后确认"},
            ],
        })

        const result = JSON.parse(runTool(["enqueue", "--json", "-"], {
            environment,
            input: payload,
        }))

        assert.equal(result.created.length, 2)
        assert.equal(result.duplicates.length, 1)
        assert.equal(result.rejected.length, 0)
    })

    it("serves enqueue and list through MCP stdio without protocol noise on stdout", async () => {
        const {environment} = fixtureEnvironment()
        const [{Client}, {StdioClientTransport}] = await Promise.all([
            import("@modelcontextprotocol/client"),
            import("@modelcontextprotocol/client/stdio"),
        ])
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [toolPath, "mcp"],
            env: environment,
            stderr: "pipe",
        })
        const client = new Client({name: "rolling-skill-tool-test", version: "1.0.0"})
        let clientClosed = false
        try {
            await client.connect(transport)
            const tools = await client.listTools()
            assert.deepEqual(
                tools.tools.map((tool) => tool.name).sort(),
                ["rolling_skill_enqueue_raw_cases", "rolling_skill_list_raw_cases"],
            )

            const enqueued = await client.callTool({
                name: "rolling_skill_enqueue_raw_cases",
                arguments: {
                    skill: {name: "billing-cost-management"},
                    cases: [{question: "MCP 生成的问题一"}, {question: "MCP 生成的问题二"}],
                },
            })
            assert.equal(enqueued.structuredContent.created.length, 2)

            const listed = await client.callTool({
                name: "rolling_skill_list_raw_cases",
                arguments: {skillName: "billing-cost-management"},
            })
            assert.equal(listed.structuredContent.rawCases.length, 2)

            const startedAt = Date.now()
            await client.close()
            clientClosed = true
            assert.ok(Date.now() - startedAt < 1_000, "offline MCP waited for forced termination")
        } finally {
            if (!clientClosed) await client.close().catch(() => {})
        }
    })
})
