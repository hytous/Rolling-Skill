const fsPromises = require("node:fs/promises")
const {join} = require("node:path")

const {
    IDENTIFIER,
    assertCommand,
    defaultRun,
    ignoreFailure,
    normalizeSchedule,
    requiredAbsolutePath,
} = require("./common.cjs")

function xml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;")
}

function renderLaunchAgent({workerExecutable, dataRoot, schedule, nodeExecutable = process.execPath, workspaceRoot = process.cwd()}) {
    const worker = requiredAbsolutePath(workerExecutable, "Worker executable")
    const root = requiredAbsolutePath(dataRoot, "Rolling Skill data root")
    const normalized = normalizeSchedule(schedule)
    const weekday = normalized.cadence === "weekly"
        ? `\n      <key>Weekday</key>\n      <integer>${normalized.weekday}</integer>`
        : ""
    const argumentsList = [requiredAbsolutePath(nodeExecutable, "Node executable"), worker, "--data-root", root, "--slot", "scheduled", "--workspace-root", requiredAbsolutePath(workspaceRoot, "Source workspace")]
        .map((argument) => `      <string>${xml(argument)}</string>`)
        .join("\n")
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${IDENTIFIER}</string>
    <key>ProgramArguments</key>
    <array>
${argumentsList}
    </array>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>${normalized.hour}</integer>
      <key>Minute</key>
      <integer>${normalized.minute}</integer>${weekday}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Background</string>
  </dict>
</plist>
`
}

function createLaunchdAdapter({
    homeDirectory,
    workerExecutable,
    nodeExecutable = process.execPath,
    workspaceRoot = process.cwd(),
    dataRoot,
    uid = process.getuid?.(),
    run = defaultRun,
    fs = fsPromises,
} = {}) {
    const home = requiredAbsolutePath(homeDirectory, "Home directory")
    const worker = requiredAbsolutePath(workerExecutable, "Worker executable")
    const root = requiredAbsolutePath(dataRoot, "Rolling Skill data root")
    if (!Number.isInteger(uid) || uid < 0) throw new Error("macOS user id is unavailable")
    const directory = join(home, "Library", "LaunchAgents")
    const path = join(directory, `${IDENTIFIER}.plist`)
    const domain = `gui/${uid}`
    const target = `${domain}/${IDENTIFIER}`

    return Object.freeze({
        capabilities: () => ({platform: "darwin", supported: true, identifier: IDENTIFIER}),
        async install(schedule) {
            const source = renderLaunchAgent({workerExecutable: worker, dataRoot: root, nodeExecutable, workspaceRoot, schedule})
            await fs.mkdir(directory, {recursive: true, mode: 0o700})
            await fs.writeFile(path, source, {encoding: "utf8", mode: 0o600})
            await ignoreFailure(async () => run("launchctl", ["bootout", target]))
            assertCommand(await run("launchctl", ["bootstrap", domain, path]), "LaunchAgent registration")
            return {installed: true, platform: "darwin", identifier: IDENTIFIER, path}
        },
        async status() {
            const result = await run("launchctl", ["print", target])
            const installed = Number(result?.exitCode ?? 1) === 0
            const match = String(result?.stdout ?? "").match(/\blast exit code = (-?\d+)\b/u)
            const lastExitCode = installed && match ? Number(match[1]) : null
            return {installed, platform: "darwin", identifier: IDENTIFIER, path, lastExitCode,
                error: lastExitCode ? `后台定时任务上次退出失败（退出码 ${lastExitCode}），请重新启用后台定时运行并检查运行状态。` : null}
        },
        async uninstall() {
            await ignoreFailure(async () => run("launchctl", ["bootout", target]))
            await fs.rm(path, {force: true})
            return {installed: false, platform: "darwin", identifier: IDENTIFIER}
        },
    })
}

module.exports = {createLaunchdAdapter, renderLaunchAgent}
