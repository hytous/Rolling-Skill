const {accessSync, constants} = require("node:fs")
const {join} = require("node:path")

const DEVELOPMENT_BINARY_PARTS = [
    "node_modules",
    "@openai",
    "codex-darwin-arm64",
    "vendor",
    "aarch64-apple-darwin",
    "bin",
    "codex",
]

function isExecutable(path) {
    if (!path) return false
    try {
        accessSync(path, constants.X_OK)
        return true
    } catch {
        return false
    }
}

function resolveCodexBinary({
    isPackaged,
    resourcesPath,
    projectRoot,
    environmentBinary = process.env.ROLLING_SKILL_CODEX_BIN,
    installedCandidates = ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"],
}) {
    const candidates = [
        environmentBinary,
        isPackaged ? join(resourcesPath, "codex-runtime", "bin", "codex") : null,
        !isPackaged ? join(projectRoot, ...DEVELOPMENT_BINARY_PARTS) : null,
        ...installedCandidates,
    ]
    return candidates.find(isExecutable) ?? null
}

module.exports = {
    DEVELOPMENT_BINARY_PARTS,
    isExecutable,
    resolveCodexBinary,
}
