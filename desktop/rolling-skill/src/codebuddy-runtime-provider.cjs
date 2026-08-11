const {createHash} = require("node:crypto")
const {spawnSync} = require("node:child_process")
const {accessSync, constants, readdirSync, realpathSync} = require("node:fs")
const {homedir} = require("node:os")
const {delimiter, dirname, join} = require("node:path")

const {CodeBuddyAcpClient} = require("./codebuddy-acp-client.cjs")

const CODEBUDDY_EFFORTS = Object.freeze(["minimal", "low", "medium", "high", "xhigh", "max"])

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

function sreCodeBuddyCandidates(homeDirectory) {
    const root = join(homeDirectory, ".sre-codex", "node")
    try {
        return readdirSync(root, {withFileTypes: true})
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(root, entry.name, "bin", "codebuddy"))
            .sort()
            .reverse()
    } catch {
        return []
    }
}

function buildCodeBuddyCandidates(options = {}) {
    const homeDirectory = options.homeDirectory ?? homedir()
    const pathValue = options.pathValue ?? process.env.PATH ?? ""
    const systemCandidates = options.systemCandidates ?? [
        "/opt/homebrew/bin/codebuddy",
        "/usr/local/bin/codebuddy",
        "/usr/bin/codebuddy",
    ]
    const userCandidates = options.userCandidates ?? [
        join(homeDirectory, ".local", "bin", "codebuddy"),
        join(homeDirectory, ".npm", "bin", "codebuddy"),
        join(homeDirectory, ".npm-global", "bin", "codebuddy"),
    ]
    const sreCandidates = options.sreCandidates ?? sreCodeBuddyCandidates(homeDirectory)
    const candidates = []
    const seen = new Set()
    const add = (path, source) => {
        if (!isExecutable(path)) return
        const key = stablePath(path)
        if (seen.has(key)) return
        seen.add(key)
        candidates.push({path, source})
    }
    add(options.configuredPath, "configured")
    add(options.environmentBinary ?? process.env.ROLLING_SKILL_CODEBUDDY_BIN, "environment")
    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
        add(join(directory, "codebuddy"), "path")
    }
    for (const path of systemCandidates) add(path, "system")
    for (const path of userCandidates) add(path, "user")
    for (const path of sreCandidates) add(path, "user")
    return candidates
}

function parseModels(help) {
    const match = help.match(/Currently supported:\s*\(([^)]+)\)/i) ?? help.match(/\((default-model,[^)]+)\)/i)
    if (!match) return []
    return match[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => /^[a-zA-Z0-9._-]+$/.test(entry))
}

function probeCodeBuddyRuntime(executablePath, spawnProcess = spawnSync) {
    const options = {
        encoding: "utf8",
        timeout: 3_000,
        shell: false,
        windowsHide: true,
        env: {
            ...process.env,
            PATH: `${dirname(executablePath)}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
        },
    }
    const versionResult = spawnProcess(executablePath, ["--version"], options)
    if (versionResult?.status !== 0 || versionResult.error) return null
    const versionText = `${versionResult.stdout ?? ""}\n${versionResult.stderr ?? ""}`.trim()
    const versionMatch = versionText.match(/(?:codebuddy(?:-code)?\s+)?(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/i)
    if (!versionMatch) return null
    const helpResult = spawnProcess(executablePath, ["--help"], options)
    if (helpResult?.status !== 0 || helpResult.error) return null
    const help = `${helpResult.stdout ?? ""}\n${helpResult.stderr ?? ""}`
    if (!/--acp\b/.test(help) || !/--acp-transport\b/.test(help)) return null
    return {
        version: versionMatch[1],
        acp: true,
        models: parseModels(help),
        efforts: [...CODEBUDDY_EFFORTS],
    }
}

function runtimeIdFor(path) {
    const fingerprint = createHash("sha256").update(stablePath(path)).digest("hex").slice(0, 16)
    return `codebuddy:${fingerprint}`
}

class CodeBuddyRuntimeProvider {
    constructor({probe = probeCodeBuddyRuntime} = {}) {
        this.id = "codebuddy"
        this.probe = probe
    }

    discover(options = {}) {
        const descriptors = []
        for (const candidate of buildCodeBuddyCandidates(options)) {
            const compatibility = this.probe(candidate.path)
            if (!compatibility?.acp) continue
            descriptors.push(
                Object.freeze({
                    runtimeId: runtimeIdFor(candidate.path),
                    providerId: this.id,
                    displayName: "CodeBuddy",
                    version: compatibility.version,
                    executablePath: candidate.path,
                    source: candidate.source,
                    transport: "acp-stdio-jsonl",
                    capabilities: Object.freeze([
                        "turns",
                        "models",
                        "streaming",
                        "raw-trace",
                        "reasoning-effort",
                    ]),
                    models: Object.freeze([...(compatibility.models ?? [])]),
                    efforts: Object.freeze([...(compatibility.efforts ?? CODEBUDDY_EFFORTS)]),
                }),
            )
        }
        return descriptors
    }

    createClient(descriptor, options) {
        return new CodeBuddyAcpClient({
            ...options,
            binaryPath: descriptor.executablePath,
            runtimeDescriptor: descriptor,
        })
    }
}

module.exports = {
    CODEBUDDY_EFFORTS,
    CodeBuddyRuntimeProvider,
    buildCodeBuddyCandidates,
    parseModels,
    probeCodeBuddyRuntime,
    runtimeIdFor,
    sreCodeBuddyCandidates,
}
