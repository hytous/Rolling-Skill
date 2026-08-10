const {
    chmodSync,
    constants,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    renameSync,
    statSync,
} = require("node:fs")
const {randomUUID} = require("node:crypto")

const {createRuntimePaths} = require("./runtime-command.cjs")

function runtimeError(code, message) {
    const error = new Error(message)
    error.code = code
    return error
}

function requireRegularFile(path, label) {
    try {
        if (!statSync(path).isFile()) throw new Error("not a file")
    } catch {
        throw runtimeError("INCOMPLETE_CHECKOUT", `${label} is missing: ${path}`)
    }
}

function ensureRealDirectory(path, mode) {
    if (existsSync(path)) {
        const metadata = lstatSync(path)
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw runtimeError(
                "UNSAFE_LOCAL_PATH",
                `Refusing unsafe local runtime directory: ${path}`,
            )
        }
    } else {
        mkdirSync(path, {mode})
    }
    chmodSync(path, mode)
}

function copyCredentialAtomically(source, destination) {
    const temporary = `${destination}.tmp-${randomUUID()}`
    copyFileSync(source, temporary, constants.COPYFILE_EXCL)
    chmodSync(temporary, 0o600)
    renameSync(temporary, destination)
}

function prepareRuntimeFilesystem(repositoryRoot, options = {}) {
    const paths = createRuntimePaths(repositoryRoot)
    const hostAuthFile = options.hostAuthFile

    requireRegularFile(paths.runScript, "Compose runner")
    requireRegularFile(paths.environmentExample, "Development environment template")
    requireRegularFile(paths.composeOverlay, "Rolling Skill Compose overlay")

    ensureRealDirectory(paths.localDirectory, 0o700)
    ensureRealDirectory(paths.evidenceDirectory, 0o700)
    ensureRealDirectory(paths.codexHomeDirectory, 0o700)

    if (!existsSync(paths.environmentFile)) {
        copyFileSync(paths.environmentExample, paths.environmentFile, constants.COPYFILE_EXCL)
    }

    try {
        if (!hostAuthFile || !statSync(hostAuthFile).isFile() || statSync(hostAuthFile).size === 0) {
            throw new Error("missing")
        }
    } catch {
        throw runtimeError(
            "CODEX_LOGIN_REQUIRED",
            "Codex login is required. Run `codex login` in Terminal, finish sign-in, then retry.",
        )
    }
    copyCredentialAtomically(hostAuthFile, paths.isolatedAuthFile)

    return paths
}

module.exports = {
    prepareRuntimeFilesystem,
    runtimeError,
}
