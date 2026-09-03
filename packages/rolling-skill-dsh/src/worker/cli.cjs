#!/usr/bin/env node

const {parseWorkerArguments, runWorker} = require("./run.cjs")
const {dirname, delimiter} = require("node:path")

function workerEnvironment(environment = process.env, nodeExecutable = process.execPath) {
    // launchd/systemd do not inherit the interactive shell's Node installation.
    // Child runtimes also use /usr/bin/env node; retain the existing PATH.
    return {...environment, PATH: [dirname(nodeExecutable), environment.PATH].filter(Boolean).join(delimiter)}
}

async function main(argv = process.argv.slice(2)) {
    const options = parseWorkerArguments(argv)
    process.env.PATH = workerEnvironment().PATH
    const controller = new AbortController()
    const abort = () => controller.abort()
    process.once("SIGINT", abort)
    process.once("SIGTERM", abort)
    try {
        await runWorker({...options, signal: controller.signal})
        return 0
    } catch (error) {
        process.stderr.write(`Rolling Skill Worker failed: ${String(error?.message ?? error).slice(0, 2_000)}\n`)
        return 1
    } finally {
        process.removeListener("SIGINT", abort)
        process.removeListener("SIGTERM", abort)
    }
}

if (require.main === module) {
    void main().then((code) => {
        process.exitCode = code
    })
}

module.exports = {main, workerEnvironment}
