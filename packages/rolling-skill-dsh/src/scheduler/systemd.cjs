const fsPromises = require("node:fs/promises")
const {join} = require("node:path")

const {
    IDENTIFIER,
    WEEKDAYS,
    assertCommand,
    defaultRun,
    ignoreFailure,
    normalizeSchedule,
    requiredAbsolutePath,
} = require("./common.cjs")

function systemdArgument(value) {
    const text = String(value)
    if (/\0|[\r\n]/u.test(text)) throw new Error("systemd argument is invalid")
    return `"${text.replaceAll("%", "%%").replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}

function renderSystemdService({workerExecutable, dataRoot, nodeExecutable = process.execPath, workspaceRoot = process.cwd()}) {
    const command = [
        requiredAbsolutePath(nodeExecutable, "Node executable"),
        requiredAbsolutePath(workerExecutable, "Worker executable"),
        "--data-root",
        requiredAbsolutePath(dataRoot, "Rolling Skill data root"),
        "--slot",
        "scheduled",
        "--workspace-root",
        requiredAbsolutePath(workspaceRoot, "Source workspace"),
    ].map(systemdArgument).join(" ")
    return `[Unit]
Description=Rolling Skill automatic capture

[Service]
Type=oneshot
ExecStart=${command}
`
}

function renderSystemdTimer(schedule) {
    const normalized = normalizeSchedule(schedule)
    const calendar = normalized.cadence === "daily"
        ? `*-*-* ${normalized.time}:00`
        : `${WEEKDAYS[normalized.weekday][0]}${WEEKDAYS[normalized.weekday].slice(1).toLocaleLowerCase("en-US")} *-*-* ${normalized.time}:00`
    return `[Unit]
Description=Schedule Rolling Skill automatic capture

[Timer]
OnCalendar=${calendar}
Persistent=true
Unit=${IDENTIFIER}.service

[Install]
WantedBy=timers.target
`
}

function createSystemdAdapter({
    homeDirectory,
    workerExecutable,
    nodeExecutable = process.execPath,
    workspaceRoot = process.cwd(),
    dataRoot,
    run = defaultRun,
    fs = fsPromises,
} = {}) {
    const home = requiredAbsolutePath(homeDirectory, "Home directory")
    const worker = requiredAbsolutePath(workerExecutable, "Worker executable")
    const root = requiredAbsolutePath(dataRoot, "Rolling Skill data root")
    const directory = join(home, ".config", "systemd", "user")
    const servicePath = join(directory, `${IDENTIFIER}.service`)
    const timerPath = join(directory, `${IDENTIFIER}.timer`)
    const timerUnit = `${IDENTIFIER}.timer`

    return Object.freeze({
        capabilities: () => ({platform: "linux", supported: true, identifier: IDENTIFIER}),
        async install(schedule) {
            await fs.mkdir(directory, {recursive: true, mode: 0o700})
            await fs.writeFile(servicePath, renderSystemdService({workerExecutable: worker, dataRoot: root, nodeExecutable, workspaceRoot}), {encoding: "utf8", mode: 0o600})
            await fs.writeFile(timerPath, renderSystemdTimer(schedule), {encoding: "utf8", mode: 0o600})
            assertCommand(await run("systemctl", ["--user", "daemon-reload"]), "systemd user reload")
            assertCommand(await run("systemctl", ["--user", "enable", "--now", timerUnit]), "systemd timer registration")
            return {installed: true, platform: "linux", identifier: IDENTIFIER, servicePath, timerPath}
        },
        async status() {
            const result = await run("systemctl", ["--user", "is-enabled", timerUnit])
            return {installed: Number(result?.exitCode ?? 1) === 0, platform: "linux", identifier: IDENTIFIER, servicePath, timerPath}
        },
        async uninstall() {
            await ignoreFailure(async () => run("systemctl", ["--user", "disable", "--now", timerUnit]))
            await Promise.all([fs.rm(servicePath, {force: true}), fs.rm(timerPath, {force: true})])
            assertCommand(await run("systemctl", ["--user", "daemon-reload"]), "systemd user reload")
            return {installed: false, platform: "linux", identifier: IDENTIFIER}
        },
    })
}

module.exports = {createSystemdAdapter, renderSystemdService, renderSystemdTimer}
