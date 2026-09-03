const {createHash} = require("node:crypto")
const {spawnSync} = require("node:child_process")
const {
    accessSync,
    constants,
    readdirSync,
    realpathSync,
} = require("node:fs")
const {homedir} = require("node:os")
const {delimiter, join} = require("node:path")

const {CodexAppServerClient} = require("./codex-app-server.cjs")

function isExecutable(path) {
    if (!path || typeof path !== "string") return false
    try {
        accessSync(path, constants.X_OK)
        return true
    } catch {
        return false
    }
}

function stablePath(path) {
    try {
        return realpathSync.native(path)
    } catch {
        return path
    }
}

function sreCodexCandidates(homeDirectory) {
    const root = join(homeDirectory, ".sre-codex", "node")
    try {
        return readdirSync(root, {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(root, entry.name, "bin", "codex"))
            .sort()
            .reverse()
    } catch {
        return []
    }
}

function buildCodexCandidates(options = {}) {
    const homeDirectory = options.homeDirectory ?? homedir()
    const pathValue = options.pathValue ?? process.env.PATH ?? ""
    const applicationCandidates = options.applicationCandidates ?? [
        "/Applications/ChatGPT.app/Contents/Resources/codex",
        "/Applications/Codex.app/Contents/Resources/codex",
        join(homeDirectory, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
        join(homeDirectory, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    ]
    const systemCandidates = options.systemCandidates ?? [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/usr/bin/codex",
    ]
    const userCandidates = options.userCandidates ?? [
        join(homeDirectory, ".local", "bin", "codex"),
        join(homeDirectory, ".npm", "bin", "codex"),
        join(homeDirectory, ".npm-global", "bin", "codex"),
    ]
    const sreCandidates = options.sreCandidates ?? sreCodexCandidates(homeDirectory)
    const candidates = []
    const seen = new Set()

    function add(path, source) {
        if (!isExecutable(path)) return
        const key = stablePath(path)
        if (seen.has(key)) return
        seen.add(key)
        candidates.push({path, source})
    }

    add(options.configuredPath, "configured")
    add(options.environmentBinary ?? process.env.ROLLING_SKILL_CODEX_BIN, "environment")
    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
        add(join(directory, "codex"), "path")
    }
    for (const path of applicationCandidates) add(path, "application")
    for (const path of systemCandidates) add(path, "system")
    for (const path of userCandidates) add(path, "user")
    for (const path of sreCandidates) add(path, "user")
    return candidates
}

function probeCodexRuntime(executablePath, spawnProcess = spawnSync) {
    const options = {
        encoding: "utf8",
        timeout: 3_000,
        shell: false,
        windowsHide: true,
    }
    const versionResult = spawnProcess(executablePath, ["--version"], options)
    if (versionResult?.status !== 0 || versionResult.error) return null
    const versionOutput = `${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`
    const match = versionOutput.match(/\bcodex-cli\s+([^\s]+)/i)
    if (!match) return null

    const serverResult = spawnProcess(executablePath, ["app-server", "--help"], options)
    if (serverResult?.status !== 0 || serverResult.error) return null
    const serverOutput = `${serverResult.stdout ?? ""}\n${serverResult.stderr ?? ""}`
    if (!/codex app-server|run the app server/i.test(serverOutput)) return null
    return {version: match[1], appServer: true}
}

function runtimeIdFor(path) {
    const fingerprint = createHash("sha256").update(stablePath(path)).digest("hex").slice(0, 16)
    return `codex:${fingerprint}`
}

class CodexRuntimeProvider {
    constructor({probe = probeCodexRuntime} = {}) {
        this.id = "codex"
        this.probe = probe
    }

    discover(options = {}) {
        const descriptors = []
        for (const candidate of buildCodexCandidates(options)) {
            const compatibility = this.probe(candidate.path)
            if (!compatibility?.appServer) continue
            descriptors.push(
                Object.freeze({
                    runtimeId: runtimeIdFor(candidate.path),
                    providerId: this.id,
                    displayName: "Codex",
                    version: compatibility.version,
                    executablePath: candidate.path,
                    source: candidate.source,
                    transport: "stdio-jsonl",
                    capabilities: Object.freeze([
                        "threads",
                        "thread-archive",
                        "sandbox-policy",
                        "turns",
                        "models",
                        "reasoning-effort",
                        "skills",
                        "plugins",
                        "streaming",
                        "raw-trace",
                    ]),
                }),
            )
        }
        return descriptors
    }

    createClient(descriptor, options) {
        return new CodexAppServerClient({
            ...options,
            binaryPath: descriptor.executablePath,
            runtimeDescriptor: descriptor,
        })
    }
}

module.exports = {
    CodexRuntimeProvider,
    buildCodexCandidates,
    isExecutable,
    probeCodexRuntime,
    runtimeIdFor,
    sreCodexCandidates,
}
