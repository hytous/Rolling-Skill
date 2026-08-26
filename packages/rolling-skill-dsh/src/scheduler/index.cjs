const {homedir} = require("node:os")
const {dirname, resolve} = require("node:path")
const {fileURLToPath} = require("node:url")

const {IDENTIFIER} = require("./common.cjs")
const {createLaunchdAdapter} = require("./launchd.cjs")
const {createSystemdAdapter} = require("./systemd.cjs")
const {createTaskSchedulerAdapter} = require("./task-scheduler.cjs")

function resolveWorkerExecutable(moduleUrl, platform = process.platform) {
    const filename = fileURLToPath(moduleUrl)
    const name = platform === "win32" ? "rolling-skill-worker.cmd" : "rolling-skill-worker"
    return resolve(dirname(filename), "..", "..", "..", ".bin", name)
}

function unsupportedAdapter(platform) {
    const capabilities = () => ({platform, supported: false, identifier: IDENTIFIER})
    const unavailable = async () => {
        throw new Error(`Automatic capture system scheduling is unavailable on ${platform}`)
    }
    return Object.freeze({capabilities, install: unavailable, status: async () => ({...capabilities(), installed: false}), uninstall: unavailable})
}

function createSchedulerAdapter({
    platform = process.platform,
    homeDirectory = homedir(),
    workerExecutable,
    dataRoot,
    run,
} = {}) {
    const options = {homeDirectory, workerExecutable, dataRoot, ...(run ? {run} : {})}
    if (platform === "darwin") return createLaunchdAdapter(options)
    if (platform === "linux") return createSystemdAdapter(options)
    if (platform === "win32") return createTaskSchedulerAdapter(options)
    return unsupportedAdapter(platform)
}

module.exports = {createSchedulerAdapter, resolveWorkerExecutable}
