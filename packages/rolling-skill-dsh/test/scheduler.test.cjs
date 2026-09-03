const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {RollingSkillConfigStore} = require("../../rolling-skill-core/src/config-store.cjs")
const {resolveDataPaths} = require("../../rolling-skill-core/src/data-root.cjs")
const {createRollingSkillApplication} = require("../../rolling-skill-core/src/application.cjs")
const {LocalEvaluationStore} = require("../../../desktop/rolling-skill/src/local-store.cjs")

const IDENTIFIER = "com.rolling-skill.dsh.capture"
const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function temporaryDirectory(prefix) {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    directories.push(directory)
    return directory
}

function runner(calls, result = {exitCode: 0, stdout: ""}) {
    return async (command, args) => {
        calls.push([command, [...args]])
        return result
    }
}

describe("Rolling Skill OS scheduler adapters", () => {
    it("renders and registers one exact escaped macOS LaunchAgent", async () => {
        const {createLaunchdAdapter, renderLaunchAgent} = require("../src/scheduler/launchd.cjs")
        const homeDirectory = temporaryDirectory("rolling-skill-launchd-")
        const workerExecutable = "/Applications/Rolling & Skill/rolling-skill-worker"
        const dataRoot = "/Users/me/DSH <data>"
        const source = renderLaunchAgent({
            workerExecutable,
            dataRoot,
            schedule: {cadence: "weekly", time: "08:35", weekday: 0},
        })
        assert.match(source, /<string>com\.rolling-skill\.dsh\.capture<\/string>/u)
        assert.match(source, /Rolling &amp; Skill/u)
        assert.match(source, /DSH &lt;data&gt;/u)
        assert.match(source, /<key>Weekday<\/key>\s*<integer>0<\/integer>/u)
        assert.doesNotMatch(source, /\$\(|`/u)

        const calls = []
        const adapter = createLaunchdAdapter({
            homeDirectory,
            workerExecutable,
            dataRoot,
            uid: 501,
            run: runner(calls),
        })
        await adapter.install({cadence: "daily", time: "09:10", weekday: 1})
        const plist = join(homeDirectory, "Library", "LaunchAgents", `${IDENTIFIER}.plist`)
        assert.match(readFileSync(plist, "utf8"), /<integer>9<\/integer>/u)
        assert.deepEqual(calls, [
            ["launchctl", ["bootout", `gui/501/${IDENTIFIER}`]],
            ["launchctl", ["bootstrap", "gui/501", plist]],
        ])
        await adapter.uninstall()
        assert.deepEqual(calls.at(-1), ["launchctl", ["bootout", `gui/501/${IDENTIFIER}`]])
    })

    it("renders exact Linux user service/timer files and systemctl arguments", async () => {
        const {
            createSystemdAdapter,
            renderSystemdService,
            renderSystemdTimer,
        } = require("../src/scheduler/systemd.cjs")
        const homeDirectory = temporaryDirectory("rolling-skill-systemd-")
        const workerExecutable = "/opt/Rolling Skill/bin/rolling-skill-worker"
        const dataRoot = "/home/me/.dsh/rolling skill"
        const service = renderSystemdService({workerExecutable, dataRoot, nodeExecutable: "/opt/node/bin/node", workspaceRoot: "/home/me/project"})
        assert.match(service, /ExecStart="\/opt\/node\/bin\/node" "\/opt\/Rolling Skill\/bin\/rolling-skill-worker" "--data-root" "\/home\/me\/\.dsh\/rolling skill" "--slot" "scheduled" "--workspace-root" "\/home\/me\/project"/u)
        assert.doesNotMatch(service, /\$\(|`/u)
        assert.match(renderSystemdTimer({cadence: "daily", time: "09:10", weekday: 1}), /OnCalendar=\*-\*-\* 09:10:00/u)
        assert.match(renderSystemdTimer({cadence: "weekly", time: "09:10", weekday: 1}), /OnCalendar=Mon \*-\*-\* 09:10:00/u)

        const calls = []
        const adapter = createSystemdAdapter({
            homeDirectory,
            workerExecutable,
            dataRoot,
            run: runner(calls),
        })
        await adapter.install({cadence: "weekly", time: "18:40", weekday: 5})
        assert.deepEqual(calls, [
            ["systemctl", ["--user", "daemon-reload"]],
            ["systemctl", ["--user", "enable", "--now", `${IDENTIFIER}.timer`]],
        ])
        await adapter.uninstall()
        assert.deepEqual(calls.slice(-2), [
            ["systemctl", ["--user", "disable", "--now", `${IDENTIFIER}.timer`]],
            ["systemctl", ["--user", "daemon-reload"]],
        ])
    })

    it("uses fixed Windows Task Scheduler names and argument arrays", async () => {
        const {
            createTaskSchedulerAdapter,
            taskCreateArguments,
        } = require("../src/scheduler/task-scheduler.cjs")
        const workerExecutable = "C:\\Program Files\\Rolling Skill\\rolling-skill-worker.cmd"
        const dataRoot = "C:\\Users\\me\\.dsh\\rolling skill"
        const daily = taskCreateArguments({
            workerExecutable,
            dataRoot,
            nodeExecutable: "C:\\Node\\node.exe",
            workspaceRoot: "C:\\Project",
            schedule: {cadence: "daily", time: "09:05", weekday: 2},
        })
        assert.deepEqual(daily.slice(0, 6), ["/Create", "/F", "/TN", IDENTIFIER, "/TR", `"C:\\Node\\node.exe" "${workerExecutable}" --data-root "${dataRoot}" --slot scheduled --workspace-root "C:\\Project"`])
        assert.deepEqual(daily.slice(6), ["/SC", "DAILY", "/ST", "09:05"])
        const weekly = taskCreateArguments({
            workerExecutable,
            dataRoot,
            schedule: {cadence: "weekly", time: "18:40", weekday: 5},
        })
        assert.deepEqual(weekly.slice(-6), ["/SC", "WEEKLY", "/D", "FRI", "/ST", "18:40"])

        const calls = []
        const adapter = createTaskSchedulerAdapter({workerExecutable, dataRoot, run: runner(calls)})
        await adapter.install({cadence: "daily", time: "09:05", weekday: 2})
        await adapter.status()
        await adapter.uninstall()
        assert.equal(calls.every(([command]) => command === "schtasks.exe"), true)
        assert.deepEqual(calls.at(-1)[1], ["/Delete", "/F", "/TN", IDENTIFIER])
    })

    it("selects the current platform and resolves the worker script without a PATH-dependent shim", () => {
        const {createSchedulerAdapter, resolveWorkerExecutable} = require("../src/scheduler/index.cjs")
        const moduleUrl = "file:///profile/node_modules/@rolling-skill/dsh-plugin/lib/index.js"
        assert.equal(resolveWorkerExecutable(moduleUrl, "linux"), "/profile/node_modules/@rolling-skill/dsh-plugin/lib/worker.cjs")
        assert.equal(resolveWorkerExecutable(moduleUrl, "win32"), "/profile/node_modules/@rolling-skill/dsh-plugin/lib/worker.cjs")
        assert.equal(createSchedulerAdapter({
            platform: "freebsd",
            dataRoot: "/tmp/data",
            workerExecutable: "/tmp/worker",
        }).capabilities().supported, false)
    })

    it("launches the registered Node directly, preserves the source workspace and exposes a failed launch", async () => {
        const {createLaunchdAdapter, renderLaunchAgent} = require("../src/scheduler/launchd.cjs")
        const options = {homeDirectory: temporaryDirectory("rolling-skill-launchd-path-"), workerExecutable: "/profile/lib/worker.cjs", nodeExecutable: "/opt/Node & Tools/node", workspaceRoot: "/work/project", dataRoot: "/data", uid: 501}
        const source = renderLaunchAgent({...options, schedule: {cadence: "daily", time: "20:00", weekday: 1}})
        assert.match(source, /<array>\s*<string>\/opt\/Node &amp; Tools\/node<\/string>\s*<string>\/profile\/lib\/worker.cjs<\/string>/u)
        assert.match(source, /<string>--workspace-root<\/string>\s*<string>\/work\/project<\/string>/u)
        const failed = await createLaunchdAdapter({...options, run: runner([], {exitCode: 0, stdout: "state = not running\nlast exit code = 127\n"})}).status()
        assert.equal(failed.installed, true)
        assert.equal(failed.lastExitCode, 127)
        assert.match(failed.error, /127/u)
        const successful = await createLaunchdAdapter({...options, run: runner([], {exitCode: 0, stdout: "last exit code = 0\n"})}).status()
        assert.equal(successful.error, null)
    })

    it("persists installation status without changing automatic mode when registration fails", async () => {
        const dataRoot = temporaryDirectory("rolling-skill-scheduler-app-")
        const paths = resolveDataPaths({dataRoot})
        const runtime = {
            providerId: "deepseek-harness",
            runtimeId: "deepseek-harness:/opt/dsh",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
            executablePath: "/opt/dsh",
        }
        new RollingSkillConfigStore(paths.config).update({
            executionLocation: "always",
            runtime,
            worker: {enabled: true},
        })
        new LocalEvaluationStore(paths.evaluationStore).updateSettings({
            autoCaptureMode: "scheduled",
            autoCaptureCadence: "daily",
            autoCaptureTime: "09:00",
            autoCaptureWeekday: 1,
        })
        const schedulerAdapter = {
            capabilities: () => ({platform: "linux", supported: true}),
            install: async () => { throw new Error("systemd user service unavailable") },
            status: async () => ({installed: false}),
            uninstall: async () => {},
        }
        const application = createRollingSkillApplication({dataRoot, schedulerAdapter, workerMode: true})
        await assert.rejects(() => application.dispatch("scheduler.enable", {}), /systemd user service unavailable/u)
        const settings = await application.dispatch("settings.get", {})
        assert.equal(settings.rollingSkill.autoCaptureProfile.mode, "scheduled")
        assert.equal(settings.plugin.executionLocation, "always")
        assert.equal(settings.plugin.worker.installed, false)
        assert.match(settings.plugin.worker.lastRegistrationError, /systemd user service unavailable/u)
        await application.close()
    })
})
