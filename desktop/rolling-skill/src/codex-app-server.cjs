const {EventEmitter} = require("node:events")
const {spawn} = require("node:child_process")
const {existsSync} = require("node:fs")
const {dirname, join} = require("node:path")

const {JsonLineDecoder, RpcRequestTracker} = require("./json-rpc.cjs")
const {TraceRecorder} = require("./trace-recorder.cjs")

class CodexAppServerClient extends EventEmitter {
    constructor({
        binaryPath,
        runtimeDescriptor = null,
        traceDirectory,
        workspaceRoot,
        spawnProcess = spawn,
    }) {
        super()
        this.binaryPath = binaryPath
        this.runtimeDescriptor = runtimeDescriptor
        this.traceDirectory = traceDirectory
        this.workspaceRoot = workspaceRoot
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
            clientInfo: {name: "rolling-skill", title: "Rolling Skill", version: "0.4.0"},
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
        if (this.tracker.settle(message)) return
        if (message?.id !== undefined && message?.method) {
            this.write({
                id: message.id,
                error: {code: -32601, message: `Unsupported client request: ${message.method}`},
            })
            return
        }
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

    listThreads() {
        return this.request("thread/list", {
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            sourceKinds: [],
            archived: false,
            cwd: this.workspaceRoot,
        })
    }

    readThread(threadId) {
        return this.request("thread/read", {threadId, includeTurns: true})
    }

    startThread() {
        return this.request("thread/start", {
            cwd: this.workspaceRoot,
            approvalPolicy: "never",
            sandbox: "workspace-write",
            ephemeral: false,
            sessionStartSource: "startup",
            threadSource: "user",
        })
    }

    resumeThread(threadId) {
        return this.request("thread/resume", {
            threadId,
            cwd: this.workspaceRoot,
            approvalPolicy: "never",
            sandbox: "workspace-write",
        })
    }

    startTurn(threadId, text) {
        return this.request("turn/start", {
            threadId,
            input: [{type: "text", text, text_elements: []}],
        })
    }

    interruptTurn(threadId, turnId) {
        return this.request("turn/interrupt", {threadId, turnId})
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
