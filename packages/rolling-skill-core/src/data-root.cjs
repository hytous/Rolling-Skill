const {chmodSync, mkdirSync} = require("node:fs")
const {homedir} = require("node:os")
const {isAbsolute, join, resolve} = require("node:path")

function absoluteRoot(value, label) {
    const root = String(value ?? "").trim()
    if (!root || !isAbsolute(root)) throw new Error(`${label} must be an absolute path`)
    return resolve(root)
}

function resolveDataPaths({
    dataRoot = null,
    homeDirectory = homedir(),
    environment = process.env,
} = {}) {
    const dshHome = String(environment?.DSH_HOME ?? "").trim()
    const root = dataRoot
        ? absoluteRoot(dataRoot, "Rolling Skill data root")
        : dshHome
            ? join(absoluteRoot(dshHome, "DSH_HOME"), "rolling-skill")
            : join(absoluteRoot(homeDirectory, "Home directory"), ".dsh", "rolling-skill")
    const rawCases = join(root, "raw-cases")
    const managedSkills = join(root, "managed-skills")
    const skillEditWorkspaces = join(root, "skill-edit-workspaces")
    const traces = join(root, "traces")
    const jobs = join(root, "jobs")
    const logs = join(root, "logs")
    const locks = join(root, "locks")
    const scheduler = join(root, "scheduler")

    return Object.freeze({
        root,
        config: join(root, "config.json"),
        evaluationStore: join(root, "evaluation-store.json"),
        automaticCaptureState: join(root, "automatic-capture-state.json"),
        rawCases,
        rawCaseEvents: join(rawCases, "events.jsonl"),
        rawCaseEvidence: join(rawCases, "evidence"),
        managedSkills,
        managedSkillRegistry: join(managedSkills, "registry.json"),
        skillEditWorkspaces,
        skillInstallations: join(root, "skill-installations.json"),
        traces,
        dshConversationTraces: join(traces, "dsh-conversations"),
        jobs,
        operatorJobs: join(jobs, "operator-jobs.json"),
        optimizationRuns: join(jobs, "optimization-runs.json"),
        skillEdits: join(jobs, "skill-edits.json"),
        logs,
        workerLog: join(logs, "worker.log"),
        locks,
        captureLease: join(locks, "automatic-capture.json"),
        scheduler,
        migration: join(root, "migration.json"),
    })
}

function ensurePrivateDirectory(path) {
    mkdirSync(path, {recursive: true, mode: 0o700})
    chmodSync(path, 0o700)
}

function ensureDataLayout(paths) {
    for (const directory of [
        paths.root,
        paths.rawCases,
        paths.managedSkills,
        paths.skillEditWorkspaces,
        paths.traces,
        paths.jobs,
        paths.logs,
        paths.locks,
        paths.scheduler,
    ]) ensurePrivateDirectory(directory)
    return paths
}

module.exports = {ensureDataLayout, resolveDataPaths}
