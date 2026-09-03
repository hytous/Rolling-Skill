const {
    IDENTIFIER,
    WEEKDAYS,
    assertCommand,
    defaultRun,
    ignoreFailure,
    normalizeSchedule,
    requiredAbsolutePath,
} = require("./common.cjs")

function windowsQuoted(value) {
    const text = String(value)
    if (/\0|[\r\n"]/u.test(text)) throw new Error("Windows scheduled task argument is invalid")
    return `"${text.replace(/(\\+)$/u, "$1$1")}"`
}

function taskCreateArguments({workerExecutable, dataRoot, schedule, nodeExecutable = process.execPath, workspaceRoot = process.cwd()}) {
    const worker = requiredAbsolutePath(workerExecutable, "Worker executable")
    const root = requiredAbsolutePath(dataRoot, "Rolling Skill data root")
    const normalized = normalizeSchedule(schedule)
    const taskCommand = `${windowsQuoted(requiredAbsolutePath(nodeExecutable, "Node executable"))} ${windowsQuoted(worker)} --data-root ${windowsQuoted(root)} --slot scheduled --workspace-root ${windowsQuoted(requiredAbsolutePath(workspaceRoot, "Source workspace"))}`
    return [
        "/Create", "/F", "/TN", IDENTIFIER, "/TR", taskCommand,
        "/SC", normalized.cadence === "daily" ? "DAILY" : "WEEKLY",
        ...(normalized.cadence === "weekly" ? ["/D", WEEKDAYS[normalized.weekday]] : []),
        "/ST", normalized.time,
    ]
}

function createTaskSchedulerAdapter({workerExecutable, dataRoot, nodeExecutable = process.execPath, workspaceRoot = process.cwd(), run = defaultRun} = {}) {
    const worker = requiredAbsolutePath(workerExecutable, "Worker executable")
    const root = requiredAbsolutePath(dataRoot, "Rolling Skill data root")
    return Object.freeze({
        capabilities: () => ({platform: "win32", supported: true, identifier: IDENTIFIER}),
        async install(schedule) {
            assertCommand(await run("schtasks.exe", taskCreateArguments({workerExecutable: worker, dataRoot: root, nodeExecutable, workspaceRoot, schedule})), "Windows scheduled task registration")
            return {installed: true, platform: "win32", identifier: IDENTIFIER}
        },
        async status() {
            const result = await run("schtasks.exe", ["/Query", "/TN", IDENTIFIER])
            return {installed: Number(result?.exitCode ?? 1) === 0, platform: "win32", identifier: IDENTIFIER}
        },
        async uninstall() {
            await ignoreFailure(async () => run("schtasks.exe", ["/Delete", "/F", "/TN", IDENTIFIER]))
            return {installed: false, platform: "win32", identifier: IDENTIFIER}
        },
    })
}

module.exports = {createTaskSchedulerAdapter, taskCreateArguments}
