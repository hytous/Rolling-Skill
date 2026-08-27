const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {it} = require("node:test")
const {pathToFileURL} = require("node:url")
const {join} = require("node:path")

it("opens only the Host-resolved path without a shell", async () => {
    const {createPathRevealer} = await import(pathToFileURL(join(__dirname, "../src/host/reveal-path.js")))
    const calls = []
    const reveal = createPathRevealer({
        platform: "darwin",
        spawnProcess(command, args, options) {
            calls.push({command, args, options})
            const child = new EventEmitter()
            child.unref = () => calls.push({unref: true})
            queueMicrotask(() => child.emit("spawn"))
            return child
        },
    })
    await reveal("/managed/repository-1")
    assert.deepEqual(calls[0], {
        command: "open",
        args: ["/managed/repository-1"],
        options: {detached: true, shell: false, stdio: "ignore"},
    })
    assert.deepEqual(calls[1], {unref: true})
})
