const {EventEmitter} = require("node:events")
const {
    appendFileSync,
    chmodSync,
    closeSync,
    constants,
    existsSync,
    openSync,
    writeFileSync,
} = require("node:fs")
const {homedir} = require("node:os")
const {join} = require("node:path")
const {spawn} = require("node:child_process")

const {buildComposeInvocation, createRuntimePaths, DESKTOP_PATH} = require("./runtime-command.cjs")
const {prepareRuntimeFilesystem, runtimeError} = require("./runtime-files.cjs")

const DOCKER_CANDIDATES = [
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
]

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function executableDockerPath() {
    for (const candidate of DOCKER_CANDIDATES) {
        try {
            require("node:fs").accessSync(candidate, constants.X_OK)
            return candidate
        } catch {
            // Try the next fixed Finder-safe path.
        }
    }
    return null
}

function splitOutput(chunk, onLine) {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) onLine(line)
    }
}

function runProcess(invocation, onLine, registerChild = () => {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(invocation.executable, invocation.args, {
            ...invocation.options,
            stdio: ["ignore", "pipe", "pipe"],
        })
        registerChild(child)
        child.stdout.on("data", (chunk) => splitOutput(chunk, onLine))
        child.stderr.on("data", (chunk) => splitOutput(chunk, onLine))
        child.once("error", reject)
        child.once("close", (code, signal) => resolve({code: code ?? 1, signal}))
    })
}

async function isHttpReady(url) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3_000)
    try {
        const response = await fetch(url, {redirect: "manual", signal: controller.signal})
        if (response.ok) return true
        if (response.status < 300 || response.status >= 400) return false
        const location = response.headers.get("location")
        if (!location) return false
        return new URL(location, url).origin === new URL(url).origin
    } catch {
        return false
    } finally {
        clearTimeout(timeout)
    }
}

class RuntimeController extends EventEmitter {
    constructor({repositoryRoot, appUrl = "http://localhost/"}) {
        super()
        this.repositoryRoot = repositoryRoot
        this.appUrl = appUrl
        this.currentChild = null
        this.operation = null
        this.generation = 0
        this.logLines = []
        this.snapshot = {
            phase: repositoryRoot ? "idle" : "needs-repository",
            title: repositoryRoot ? "Ready to start" : "Choose the Agenta checkout",
            detail: repositoryRoot
                ? "Rolling Skill will inspect the local runtime."
                : "The desktop client needs the checkout that contains hosting/docker-compose/run.sh.",
            repositoryRoot,
            appUrl,
            workbenchAvailable: false,
            logs: [],
            errorCode: null,
        }
    }

    getState() {
        return {...this.snapshot, logs: [...this.logLines]}
    }

    setRepositoryRoot(repositoryRoot) {
        this.repositoryRoot = repositoryRoot
        this.update({
            phase: "idle",
            title: "Checkout selected",
            detail: repositoryRoot,
            repositoryRoot,
            errorCode: null,
        })
    }

    update(patch) {
        this.snapshot = {...this.snapshot, ...patch, logs: [...this.logLines]}
        this.emit("state", this.getState())
    }

    appendLog(line) {
        const timestamped = `[${new Date().toLocaleTimeString()}] ${line}`
        this.logLines.push(timestamped)
        if (this.logLines.length > 240) this.logLines.splice(0, this.logLines.length - 240)
        if (this.repositoryRoot) {
            const paths = createRuntimePaths(this.repositoryRoot)
            try {
                if (existsSync(paths.localDirectory)) {
                    const descriptor = openSync(
                        paths.logFile,
                        constants.O_WRONLY |
                            constants.O_CREAT |
                            constants.O_APPEND |
                            (constants.O_NOFOLLOW ?? 0),
                        0o600,
                    )
                    appendFileSync(descriptor, `${timestamped}\n`, "utf8")
                    closeSync(descriptor)
                    chmodSync(paths.logFile, 0o600)
                }
            } catch {
                // In-window logs remain available even when a local log path is unsafe.
            }
        }
        this.update({})
    }

    async start() {
        if (this.operation) return this.operation
        const generation = ++this.generation
        this.operation = this.startOperation(generation).finally(() => {
            this.operation = null
            this.currentChild = null
        })
        return this.operation
    }

    async startOperation(generation) {
        try {
            if (!this.repositoryRoot) {
                throw runtimeError("REPOSITORY_REQUIRED", "Choose the Agenta checkout to continue.")
            }
            this.update({
                phase: "checking",
                title: "Checking local runtime",
                detail: "Looking for an already-running workbench…",
                errorCode: null,
            })
            this.appendLog(`Using checkout ${this.repositoryRoot}`)
            const alreadyHealthy = await isHttpReady(this.appUrl)

            this.update({
                phase: "preparing",
                title: "Preparing isolated Codex access",
                detail: "Copying only auth.json into the evaluation runtime boundary…",
                workbenchAvailable: alreadyHealthy,
            })
            try {
                prepareRuntimeFilesystem(this.repositoryRoot, {
                    hostAuthFile: join(homedir(), ".codex", "auth.json"),
                })
                this.appendLog("Isolated Codex credential copy is ready")
            } catch (error) {
                if (error.code === "CODEX_LOGIN_REQUIRED") {
                    this.update({
                        phase: "needs-login",
                        title: "Codex sign-in required",
                        detail: error.message,
                        errorCode: error.code,
                        workbenchAvailable: alreadyHealthy,
                    })
                    this.appendLog(error.message)
                    return
                }
                throw error
            }

            if (alreadyHealthy) {
                this.update({
                    phase: "ready",
                    title: "Workbench ready",
                    detail: "The existing local runtime is healthy.",
                    workbenchAvailable: true,
                    errorCode: null,
                })
                this.appendLog("Local workbench is already healthy")
                return
            }

            const dockerPath = executableDockerPath()
            if (!dockerPath) {
                throw runtimeError(
                    "DOCKER_MISSING",
                    "Docker Desktop is not installed. Install it in /Applications, then retry.",
                )
            }

            this.update({
                phase: "checking-docker",
                title: "Checking Docker Desktop",
                detail: "Waiting for the local container engine…",
            })
            let dockerReady = await this.dockerInfo(dockerPath)
            if (!dockerReady) {
                if (!existsSync("/Applications/Docker.app")) {
                    throw runtimeError(
                        "DOCKER_MISSING",
                        "Docker Desktop is not installed in /Applications.",
                    )
                }
                this.update({
                    phase: "starting-docker",
                    title: "Starting Docker Desktop",
                    detail: "The first Docker launch can take up to two minutes…",
                })
                this.appendLog("Opening Docker Desktop")
                spawn("/usr/bin/open", ["-a", "Docker"], {shell: false, stdio: "ignore"})
                for (let attempt = 0; attempt < 120 && generation === this.generation; attempt += 1) {
                    await wait(1_000)
                    dockerReady = await this.dockerInfo(dockerPath)
                    if (dockerReady) break
                }
            }
            if (!dockerReady) {
                throw runtimeError(
                    "DOCKER_TIMEOUT",
                    "Docker Desktop did not become ready within two minutes.",
                )
            }
            if (generation !== this.generation) return

            this.update({
                phase: "starting-runtime",
                title: "Building local evaluation runtime",
                detail: "First launch can take several minutes. Live Compose output appears below.",
            })
            this.appendLog("Starting Docker Compose build")
            const invocation = buildComposeInvocation(this.repositoryRoot, "start")
            const result = await runProcess(
                invocation,
                (line) => this.appendLog(line),
                (child) => {
                    this.currentChild = child
                },
            )
            if (generation !== this.generation) return
            if (result.code !== 0) {
                throw runtimeError(
                    "COMPOSE_FAILED",
                    `Docker Compose exited with code ${result.code}${result.signal ? ` (${result.signal})` : ""}.`,
                )
            }

            this.update({
                phase: "waiting-for-web",
                title: "Waiting for the workbench",
                detail: "Containers are running; waiting for the local HTTP endpoint…",
            })
            let ready = false
            for (let attempt = 0; attempt < 300 && generation === this.generation; attempt += 1) {
                ready = await isHttpReady(this.appUrl)
                if (ready) break
                await wait(1_000)
            }
            if (!ready) {
                throw runtimeError(
                    "HTTP_TIMEOUT",
                    "Compose started, but the local workbench was not ready within five minutes.",
                )
            }
            this.update({
                phase: "ready",
                title: "Workbench ready",
                detail: "Rolling Skill is running locally.",
                workbenchAvailable: true,
                errorCode: null,
            })
            this.appendLog("Local workbench is ready")
        } catch (error) {
            this.appendLog(`ERROR: ${error.message}`)
            this.update({
                phase: "error",
                title: "Rolling Skill could not start",
                detail: error.message,
                errorCode: error.code ?? "START_FAILED",
            })
        }
    }

    async dockerInfo(dockerPath) {
        const result = await runProcess(
            {
                executable: dockerPath,
                args: ["info"],
                options: {env: {...process.env, PATH: DESKTOP_PATH}, shell: false},
            },
            () => {},
        ).catch(() => ({code: 1}))
        return result.code === 0
    }

    async stop() {
        if (!this.repositoryRoot) return
        ++this.generation
        if (this.currentChild && !this.currentChild.killed) this.currentChild.kill("SIGTERM")
        this.operation = null
        this.update({
            phase: "stopping",
            title: "Stopping local runtime",
            detail: "Volumes, datasets, evidence, and logs will be kept.",
        })
        this.appendLog("Stopping Docker Compose without deleting volumes")
        const invocation = buildComposeInvocation(this.repositoryRoot, "stop")
        const result = await runProcess(invocation, (line) => this.appendLog(line))
        if (result.code === 0) {
            this.update({
                phase: "stopped",
                title: "Runtime stopped",
                detail: "Local data and evidence were preserved.",
                workbenchAvailable: false,
                errorCode: null,
            })
            return
        }
        this.update({
            phase: "error",
            title: "Runtime could not be stopped",
            detail: `Docker Compose exited with code ${result.code}.`,
            errorCode: "COMPOSE_STOP_FAILED",
        })
    }

    async restart() {
        await this.stop()
        await this.start()
    }
}

module.exports = {
    RuntimeController,
    executableDockerPath,
    isHttpReady,
    runProcess,
}
