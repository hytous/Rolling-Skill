#!/usr/bin/env node

const {parseWorkerArguments, runWorker} = require("./run.cjs")

async function main(argv = process.argv.slice(2)) {
    const options = parseWorkerArguments(argv)
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

module.exports = {main}
