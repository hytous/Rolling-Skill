const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {existsSync} = require("node:fs")
const {dirname, join} = require("node:path")
const {version: clientVersion} = require("../package.json")

const {JsonLineDecoder, RpcRequestTracker} = require("./json-rpc.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")

function turnSandboxPolicy(sandbox) {
    if (sandbox === "danger-full-access") return {type: "dangerFullAccess"}
    if (sandbox === "read-only") return {type: "readOnly", networkAccess: false}
    if (sandbox === "workspace-write") {
        return {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
        }
    }
    return null
}

// Temporary compatibility identity for the internal Codex gateway used during development.
// Restore this to "rolling-skill" before distributing the client as a standalone product.
const CODEX_APP_SERVER_ORIGINATOR = "codex_exec"

class CodexAppServerClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        executionPolicy = null,
        spawnProcess = spawn,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
        this.executionPolicy = {
            sandbox: executionPolicy?.sandbox ?? "workspace-write",
            approvalPolicy: executionPolicy?.approvalPolicy ?? "never",
        }
        this.spawnProcess = spawnProcess
        this.child = null
        this.tracker = new RpcRequestTracker()
        this.recorder = null
        this.ready = false
        this.stopping = false
        this.initialization = null
    }

    state() {
        return {
            status: this.ready ? "ready" : this.child ? "starting" : "stopped",
            binaryPath: this.binaryPath,
            runtime: this.runtimeDescriptor,
            workspaceRoot: this.workspaceRoot,
            tracePath: this.recorder?.path ?? null,
            traceReference: this.recorder?.latestReference ?? null,
        }
    }

    async start() {
        if (this.ready) return this.state()
        if (this.initialization) return this.initialization
        this.initialization = this.startProcess().finally(() => {
            this.initialization = null
        })
        return this.initialization
    }

    async startProcess() {
        if (!this.binaryPath) throw new Error("The selected local Codex runtime is unavailable")
        this.stopping = false
        this.recorder = new TraceRecorder(this.traceDirectory, {
            sessionId: `runtime-${new Date().toISOString().replace(/[:.]/g, "-")}`,
            runtime: this.runtimeDescriptor,
        })
        const runtimeRoot = dirname(dirname(this.binaryPath))
        const runtimePath = join(runtimeRoot, "codex-path")
        const executablePath = dirname(this.binaryPath)
        const inheritedPath = process.env.PATH ?? "/usr/bin:/bin"
        const managedEnvironment = existsSync(runtimePath)
            ? {
                  CODEX_MANAGED_BY_NPM: "1",
                  CODEX_MANAGED_PACKAGE_ROOT: runtimeRoot,
                  PATH: `${runtimePath}:${executablePath}:${inheritedPath}`,
              }
            : {PATH: `${executablePath}:${inheritedPath}`}
        this.child = this.spawnProcess(this.binaryPath, ["app-server"], {
            cwd: this.workspaceRoot,
            env: {
                ...process.env,
                ...managedEnvironment,
            },
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
        })
        this.emit("state", this.state())

        const decoder = new JsonLineDecoder(
            (message) => this.handleMessage(message),
            (error, line) => {
                this.recorder.record("decode-error", {line, error: error.message})
                this.emit("runtimeLog", `Invalid app-server message: ${error.message}`)
            },
        )
        this.child.stdout.on("data", (chunk) => decoder.push(chunk))
        this.child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim()
            if (!text) return
            this.recorder.record("stderr", {text})
            this.emit("runtimeLog", text)
        })
        this.child.once("error", (error) => this.handleExit(error))
        this.child.once("close", (code, signal) => {
            const error = new Error(
                `Codex app-server exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`,
            )
            this.handleExit(error)
        })

        const initialized = await this.request("initialize", {
            clientInfo: {
                name: CODEX_APP_SERVER_ORIGINATOR,
                title: "Rolling Skill",
                version: clientVersion,
            },
            capabilities: {experimentalApi: true, requestAttestation: false},
        })
        this.notify("initialized")
        this.ready = true
        this.emit("ready", initialized)
        this.emit("state", this.state())
        return this.state()
    }

    handleExit(error) {
        if (!this.child) return
        this.child = null
        this.ready = false
        this.tracker.rejectAll(error)
        this.emit("state", {...this.state(), error: this.stopping ? null : error.message})
        if (!this.stopping) this.emit("runtimeError", error)
    }

    handleMessage(message) {
        this.recorder?.record("inbound", message)
        if (message?.id !== undefined && message?.method) {
            this.write({
                id: message.id,
                error: {code: -32601, message: `Unsupported client request: ${message.method}`},
            })
            return
        }
        if (this.tracker.settle(message)) return
        if (message?.method) {
            this.emit("notification", message)
            this.emit(message.method, message.params)
        }
    }

    write(message) {
        if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not running")
        this.recorder?.record("outbound", message)
        this.child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    request(method, params = {}) {
        const pending = this.tracker.create(method, params)
        try {
            this.write(pending.message)
        } catch (error) {
            this.tracker.settle({
                id: pending.message.id,
                error: {code: -32000, message: error.message},
            })
        }
        return pending.promise
    }

    notify(method, params) {
        this.write(params === undefined ? {method} : {method, params})
    }

    setWorkspace(workspaceRoot) {
        this.workspaceRoot = workspaceRoot
        this.emit("state", this.state())
    }

    setExecutionPolicy(executionPolicy = {}) {
        this.executionPolicy = {
            sandbox: executionPolicy.sandbox ?? "workspace-write",
            approvalPolicy: executionPolicy.approvalPolicy ?? "never",
        }
    }

    listThreads(options = {}) {
        return this.request("thread/list", {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: [],
            archived: options.archived ?? false,
            cwd: this.workspaceRoot,
        })
    }

    listModels() {
        return this.request("model/list", {limit: 100, includeHidden: false})
    }

    listSkills(options = {}) {
        return this.request("skills/list", {
            cwds: [this.workspaceRoot],
            forceReload: Boolean(options.forceReload),
        })
    }

    listPlugins() {
        return this.request("plugin/list", {cwds: [this.workspaceRoot]})
    }

    listInstalledPlugins() {
        return this.request("plugin/installed", {cwds: [this.workspaceRoot]})
    }

    readPlugin(input) {
        return this.request("plugin/read", input)
    }

    installPlugin(input) {
        return this.request("plugin/install", input)
    }

    readThread(threadId) {
        return this.request("thread/read", {threadId, includeTurns: true})
    }

    startThread(options = {}) {
        return this.request("thread/start", {
            cwd: this.workspaceRoot,
            approvalPolicy: options.approvalPolicy ?? this.executionPolicy.approvalPolicy,
            sandbox: options.sandbox ?? this.executionPolicy.sandbox,
            ephemeral: options.ephemeral ?? false,
            sessionStartSource: "startup",
            threadSource: options.threadSource ?? "user",
            ...(options.model ? {model: options.model} : {}),
        })
    }

    resumeThread(threadId, options = {}) {
        return this.request("thread/resume", {
            threadId,
            cwd: options.cwd ?? this.workspaceRoot,
            approvalPolicy: options.approvalPolicy ?? this.executionPolicy.approvalPolicy,
            sandbox: options.sandbox ?? this.executionPolicy.sandbox,
            ...(options.model ? {model: options.model} : {}),
        })
    }

    startTurn(threadId, text, options = {}) {
        const input = Array.isArray(text)
            ? text
            : [{type: "text", text, text_elements: []}]
        return this.request("turn/start", {
            threadId,
            input,
            ...(Object.hasOwn(options, "model") ? {model: options.model ?? null} : {}),
            ...(Object.hasOwn(options, "effort") ? {effort: options.effort ?? null} : {}),
            ...(Object.hasOwn(options, "approvalPolicy")
                ? {approvalPolicy: options.approvalPolicy ?? null}
                : {}),
            ...(Object.hasOwn(options, "sandbox")
                ? {sandboxPolicy: turnSandboxPolicy(options.sandbox)}
                : {}),
        })
    }

    async runEvaluationCase(input = {}) {
        const startedAt = Date.now()
        const threadResponse = await this.startThread({
            model: input.modelId,
            threadSource: "subagent",
            ephemeral: false,
        })
        const threadId = threadResponse.thread.id
        const prompt =
            input.activationMode === "explicit" && input.skillReference?.name && input.skillReference?.path
                ? [
                      {
                          type: "skill",
                          name: input.skillReference.name,
                          path: input.skillReference.path,
                      },
                      {type: "text", text: input.question, text_elements: []},
                  ]
                : input.question
        let turnId = null
        let responseText = ""
        let cleanup = () => {}
        const completed = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup()
                reject(new Error("The evaluation turn timed out"))
            }, input.timeoutMs ?? 30 * 60 * 1000)
            const onNotification = (message) => {
                const params = message?.params ?? {}
                if (params.threadId !== threadId) return
                if (message.method === "item/agentMessage/delta") {
                    responseText += params.delta ?? ""
                } else if (
                    message.method === "item/completed" &&
                    params.item?.type === "agentMessage" &&
                    params.item.text
                ) {
                    responseText = params.item.text
                } else if (message.method === "turn/completed") {
                    turnId = params.turn?.id ?? turnId
                    cleanup()
                    if (params.turn?.status === "failed") {
                        reject(
                            new Error(
                                params.turn.error?.message ?? "The evaluation turn failed",
                            ),
                        )
                    } else {
                        resolve()
                    }
                } else if (message.method === "error" && !params.willRetry) {
                    cleanup()
                    reject(new Error(params.error?.message ?? "The evaluation turn failed"))
                }
            }
            const onState = (state) => {
                if (state?.status !== "stopped") return
                cleanup()
                reject(new Error("The evaluation runtime stopped before completion"))
            }
            cleanup = () => {
                clearTimeout(timeout)
                this.off("notification", onNotification)
                this.off("state", onState)
            }
            this.on("notification", onNotification)
            this.on("state", onState)
        })
        try {
            const turnResponse = await this.startTurn(threadId, prompt, {
                model: input.modelId,
                effort: input.effort,
            })
            turnId = turnResponse.turn.id
            await completed
        } catch (error) {
            cleanup()
            throw error
        }
        return {
            threadId,
            turnId,
            response: responseText,
            durationMs: Date.now() - startedAt,
            traceReference: this.recorder?.latestReference ?? null,
        }
    }

    interruptTurn(threadId, turnId) {
        return this.request("turn/interrupt", {threadId, turnId})
    }

    archiveThread(threadId) {
        return this.request("thread/archive", {threadId})
    }

    unarchiveThread(threadId) {
        return this.request("thread/unarchive", {threadId})
    }

    recentTrace(limit) {
        return {
            path: this.recorder?.path ?? null,
            reference: this.recorder?.latestReference ?? null,
            events: this.recorder?.readRecent(limit) ?? [],
        }
    }

    async stop() {
        if (!this.child) return
        this.stopping = true
        const child = this.child
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                if (!child.killed) child.kill("SIGKILL")
                resolve()
            }, 2_000)
            child.once("close", () => {
                clearTimeout(timeout)
                resolve()
            })
            child.kill("SIGTERM")
        })
    }
}

module.exports = {CodexAppServerClient}
