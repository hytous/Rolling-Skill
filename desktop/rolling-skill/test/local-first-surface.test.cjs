const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "..")

function source(path) {
    return readFileSync(join(root, path), "utf8")
}

describe("local-first desktop surface", () => {
    it("ships a task client instead of a login or Docker bootstrap screen", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        const defaultPath = `${html}\n${renderer}\n${main}\n${preload}`

        assert.match(html, /id="thread-list"/)
        assert.match(html, /id="conversation"/)
        assert.match(html, /id="composer-input"/)
        assert.match(html, /id="save-case-dialog"/)
        assert.match(html, /id="trace-drawer"/)
        assert.doesNotMatch(defaultPath, /\bdocker\b|\bcompose\b|\blogin\b|localhost/i)
    })

    it("keeps automatic capture disabled and exposes manual case controls", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /Automatic capture is off/i)
        assert.match(renderer, /saveCase/)
        assert.match(renderer, /goodcase/)
        assert.match(renderer, /badcase/)
    })

    it("contains no bundled agent runtime dependency", () => {
        const packageJson = source("package.json")
        assert.doesNotMatch(packageJson, /@openai\/codex|codex-runtime|extraResources/)
    })

    it("exposes local runtime discovery and explicit selection controls", () => {
        const html = source("renderer/index.html")
        const preload = source("src/preload.cjs")
        const renderer = source("renderer/renderer.js")
        const main = source("src/main.cjs")

        assert.match(html, /id="runtime-dialog"/)
        assert.match(html, /id="detect-runtimes"/)
        assert.match(html, /id="automatic-runtime"/)
        assert.match(html, /id="choose-runtime-file"/)
        assert.match(preload, /detectRuntimes/)
        assert.match(preload, /selectRuntime/)
        assert.match(preload, /useAutomaticRuntime/)
        assert.match(renderer, /runtimeOperationInProgress/)
        assert.match(renderer, /changeRuntime/)
        assert.match(main, /enqueueRuntimeOperation/)
    })
})
