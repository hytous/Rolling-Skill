const {join} = require("node:path")

const DESKTOP_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
const COMPOSE_OVERLAY = "docker-compose.dev.rolling-skill.yml"

function createRuntimePaths(repositoryRoot) {
    const localDirectory = join(repositoryRoot, ".local")
    return {
        repositoryRoot,
        localDirectory,
        evidenceDirectory: join(localDirectory, "codex-evidence"),
        codexHomeDirectory: join(localDirectory, "codex-home"),
        isolatedAuthFile: join(localDirectory, "codex-home", "auth.json"),
        logFile: join(localDirectory, "desktop.log"),
        environmentFile: join(repositoryRoot, "hosting", "docker-compose", "oss", ".env.oss.dev"),
        environmentExample: join(
            repositoryRoot,
            "hosting",
            "docker-compose",
            "oss",
            "env.oss.dev.example",
        ),
        composeOverlay: join(
            repositoryRoot,
            "hosting",
            "docker-compose",
            "oss",
            COMPOSE_OVERLAY,
        ),
        runScript: join(repositoryRoot, "hosting", "docker-compose", "run.sh"),
    }
}

function buildComposeInvocation(repositoryRoot, action, inheritedEnvironment = process.env) {
    if (action !== "start" && action !== "stop") {
        throw new Error(`Unsupported runtime lifecycle action: ${action}`)
    }
    const paths = createRuntimePaths(repositoryRoot)
    const commonArguments = [
        "--oss",
        "--dev",
        "--no-tunnel",
        "--env-file",
        ".env.oss.dev",
        "--compose-file",
        COMPOSE_OVERLAY,
    ]
    const argumentsForAction =
        action === "start"
            ? [commonArguments[0], commonArguments[1], "--build", ...commonArguments.slice(2)]
            : [...commonArguments, "--down"]

    return {
        executable: "/bin/bash",
        args: [paths.runScript, ...argumentsForAction],
        options: {
            cwd: repositoryRoot,
            env: {
                ...inheritedEnvironment,
                PATH: DESKTOP_PATH,
                ROLLING_SKILL_EVIDENCE_DIR: paths.evidenceDirectory,
                ROLLING_SKILL_CODEX_HOME_DIR: paths.codexHomeDirectory,
            },
            shell: false,
        },
    }
}

module.exports = {
    COMPOSE_OVERLAY,
    DESKTOP_PATH,
    buildComposeInvocation,
    createRuntimePaths,
}
