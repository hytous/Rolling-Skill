const {createHash} = require("node:crypto")
const {spawnSync} = require("node:child_process")
const {accessSync, constants, realpathSync} = require("node:fs")
const {homedir} = require("node:os")
const {delimiter, dirname, join} = require("node:path")

const {DeepSeekHarnessClient} = require("./deepseek-harness-client.cjs")

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

function buildDeepSeekHarnessCandidates(options = {}) {
    const homeDirectory = options.homeDirectory ?? homedir()
    const pathValue = options.pathValue ?? process.env.PATH ?? ""
    const systemCandidates = options.systemCandidates ?? [
        "/opt/homebrew/bin/dsh",
        "/usr/local/bin/dsh",
        "/usr/bin/dsh",
    ]
    const userCandidates = options.userCandidates ?? [
        join(homeDirectory, ".local", "bin", "dsh"),
        join(homeDirectory, ".npm", "bin", "dsh"),
        join(homeDirectory, ".npm-global", "bin", "dsh"),
    ]
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
    add(options.environmentBinary ?? process.env.ROLLING_SKILL_DSH_BIN, "environment")
    for (const directory of pathValue.split(delimiter).filter(Boolean)) {
        add(join(directory, "dsh"), "path")
    }
    for (const path of systemCandidates) add(path, "system")
    for (const path of userCandidates) add(path, "user")
    return candidates
}

function probeDeepSeekHarnessRuntime(executablePath, spawnProcess = spawnSync) {
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
    const version = versionText.match(/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/)?.[1]
    if (!version) return null

    const helpResult = spawnProcess(executablePath, ["--profile", "web", "--help"], options)
    if (helpResult?.status !== 0 || helpResult.error) return null
    const help = `${helpResult.stdout ?? ""}\n${helpResult.stderr ?? ""}`
    if (!/--port\s+<port>/i.test(help) || !/--trusted-host\s+<authority/i.test(help)) return null
    return {version, webHost: true}
}

function runtimeIdFor(path) {
    const fingerprint = createHash("sha256").update(stablePath(path)).digest("hex").slice(0, 16)
    return `deepseek-harness:${fingerprint}`
}

class DeepSeekHarnessRuntimeProvider {
    constructor({probe = probeDeepSeekHarnessRuntime} = {}) {
        this.id = "deepseek-harness"
        this.probe = probe
    }

    discover(options = {}) {
        const descriptors = []
        for (const candidate of buildDeepSeekHarnessCandidates(options)) {
            const compatibility = this.probe(candidate.path)
            if (!compatibility?.webHost) continue
            descriptors.push(Object.freeze({
                runtimeId: runtimeIdFor(candidate.path),
                providerId: this.id,
                displayName: "DeepSeek Harness",
                version: compatibility.version,
                executablePath: candidate.path,
                source: candidate.source,
                transport: "localhost-http-websocket",
                developerPreview: true,
                capabilities: Object.freeze([
                    "threads",
                    "turns",
                    "models",
                    "reasoning-effort",
                    "streaming",
                    "permission-mode",
                    "raw-trace",
                    "skills-name-only",
                ]),
            }))
        }
        return descriptors
    }

    createClient(descriptor, options) {
        return new DeepSeekHarnessClient({
            ...options,
            binaryPath: descriptor.executablePath,
            runtimeDescriptor: descriptor,
        })
    }
}

module.exports = {
    DeepSeekHarnessRuntimeProvider,
    buildDeepSeekHarnessCandidates,
    isExecutable,
    probeDeepSeekHarnessRuntime,
    runtimeIdFor,
}
