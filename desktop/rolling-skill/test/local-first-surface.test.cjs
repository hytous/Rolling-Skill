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

    it("keeps automatic capture disabled and exposes episode curation controls", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        assert.match(html, /Automatic capture is off/i)
        assert.match(html, /id="curation-drawer"/)
        assert.match(html, /id="case-start-item"/)
        assert.match(html, /id="case-question"[^>]*readonly/)
        assert.match(renderer, /createCuration/)
        assert.match(preload, /createCuration/)
        assert.match(main, /curation:create/)
        assert.match(main, /hiddenThreadIds/)
        assert.doesNotMatch(preload, /saveCase/)
        assert.doesNotMatch(main, /datasets:save-case/)
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

    it("uses Done as the runtime dialog primary action", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const runtimeDialog = html.match(/<dialog id="runtime-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? ""

        assert.match(runtimeDialog, /id="choose-runtime-file"[^>]*>Add executable…<\/button>/)
        assert.doesNotMatch(runtimeDialog, /id="choose-runtime-file"[^>]*class="primary"/)
        assert.match(runtimeDialog, /id="confirm-runtime" class="primary"[^>]*>Done<\/button>/)
        assert.match(renderer, /confirmRuntime\.addEventListener\("click", \(\) => elements\.runtimeDialog\.close\(\)\)/)
    })

    it("pins both chat composers outside their scrollable message regions", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="conversation-scroll"/)
        assert.match(html, /class="composer-wrap"/)
        assert.match(styles, /\.topbar\s*\{[^}]*grid-row:\s*1/s)
        assert.match(styles, /\.error-banner\s*\{[^}]*grid-row:\s*2/s)
        assert.match(styles, /\.conversation-scroll\s*\{[^}]*grid-row:\s*3/s)
        assert.match(styles, /\.composer-wrap\s*\{[^}]*grid-row:\s*4/s)

        assert.match(renderer, /curation-detail-scroll/)
        assert.match(renderer, /curation-composer-wrap/)
        assert.match(styles, /\.curation-detail-scroll\s*\{[^}]*overflow-y:\s*auto/s)
        assert.match(styles, /\.curation-composer-wrap\s*\{[^}]*border-top:/s)
    })

    it("offers runtime-backed model pickers, discard, localization, themes, and capture settings", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        assert.match(html, /id="composer-model"/)
        assert.match(html, /id="settings-button"/)
        assert.match(html, /id="settings-dialog"/)
        assert.match(html, /id="settings-language"/)
        assert.match(html, /id="settings-theme"/)
        assert.match(html, /id="settings-auto-capture"/)
        assert.match(html, /id="settings-auto-capture-model"/)
        assert.match(renderer, /data-curation-model/)
        assert.match(renderer, /data-discard-curation/)
        assert.match(renderer, /translations/)
        assert.match(styles, /data-theme="codex-light"/)
        assert.match(styles, /data-theme="codex-dark"/)
        assert.match(preload, /listModels/)
        assert.match(preload, /updateSettings/)
        assert.match(preload, /discardCuration/)
        assert.match(main, /models:list/)
        assert.match(main, /settings:update/)
        assert.match(main, /curation:discard/)
    })

    it("keeps per-task model selection separate from the new-task default", () => {
        const renderer = source("renderer/renderer.js")
        const start = renderer.indexOf('elements.composerModel.addEventListener("change"')
        const end = renderer.indexOf("elements.stopTurn.addEventListener", start)
        const handler = renderer.slice(start, end)

        assert.ok(start >= 0 && end > start)
        assert.match(handler, /state\.selectedTaskModelId/)
        assert.doesNotMatch(handler, /updateSettings/)
    })

    it("routes core runtime and Curator chrome through localization keys", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /data-i18n="localEvidence"/)
        assert.match(html, /data-i18n="curatorTasks"/)
        assert.match(renderer, /t\("structuredReference"\)/)
        assert.match(renderer, /t\("hardRequirements"\)/)
        assert.match(renderer, /t\("runtimeReady"\)/)
        assert.match(renderer, /thread\?\.preview \|\| t\("newTask"\)/)
    })

    it("reports the package version to the runtime", () => {
        const appServer = source("src/codex-app-server.cjs")

        assert.match(appServer, /version:\s*clientVersion/)
        assert.doesNotMatch(appServer, /version:\s*"0\.5\.0"/)
    })

    it("switches between chat and a Skill evaluation workbench", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        assert.match(html, /id="surface-switch"/)
        assert.match(html, /data-surface="chat"/)
        assert.match(html, /data-surface="evaluation"/)
        assert.match(html, /id="evaluation-workbench"/)
        assert.match(html, /id="evaluation-dataset-list"/)
        assert.match(html, /id="evaluation-case-list"/)
        assert.match(html, /id="evaluation-skill"/)
        assert.match(html, /id="start-evaluation"/)
        assert.match(renderer, /renderEvaluationWorkbench/)
        assert.match(preload, /listSkills/)
        assert.match(preload, /listCases/)
        assert.match(main, /skills:list/)
        assert.match(main, /datasets:list-cases/)
    })

    it("keeps runtime and trace utilities inside Settings instead of the sidebar footer", () => {
        const html = source("renderer/index.html")
        const footer = html.match(/<div class="sidebar-footer">[\s\S]*?<\/aside>/)?.[0] ?? ""
        const settings = html.match(/<dialog id="settings-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? ""

        assert.doesNotMatch(footer, /id="open-trace"|id="choose-runtime"/)
        assert.match(settings, /id="open-trace"/)
        assert.match(settings, /id="choose-runtime"/)
    })
})
