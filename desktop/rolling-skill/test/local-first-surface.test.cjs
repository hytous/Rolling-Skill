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
        assert.doesNotMatch(
            `${html}\n${renderer}`,
            /Ask Rolling Skill to evaluate or run a task|让 Rolling Skill 评测或执行一个任务/,
        )
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
        assert.match(html, /id="settings-auto-capture-skill"/)
        assert.match(html, /id="case-skill"/)
        assert.match(renderer, /data-curation-model/)
        assert.match(renderer, /data-discard-curation/)
        assert.match(renderer, /skillDisplayLabel/)
        assert.match(renderer, /translations/)
        assert.match(styles, /data-theme="codex-light"/)
        assert.match(styles, /data-theme="codex-dark"/)
        assert.match(preload, /listModels/)
        assert.match(preload, /updateSettings/)
        assert.match(preload, /discardCuration/)
        assert.match(main, /models:list/)
        assert.match(main, /settings:update/)
        assert.match(main, /curation:discard/)
        assert.match(main, /skillPath/)
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
        const styles = source("renderer/styles.css")
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
        assert.doesNotMatch(styles, /\.workbench\.evaluation-mode\s*>\s*\.topbar/)
        assert.match(styles, /\.evaluation-workbench\s*\{[^}]*grid-row:\s*2\s*\/\s*-1/s)
    })

    it("keeps runtime and trace utilities inside Settings instead of the sidebar footer", () => {
        const html = source("renderer/index.html")
        const footer = html.match(/<div class="sidebar-footer">[\s\S]*?<\/aside>/)?.[0] ?? ""
        const settings = html.match(/<dialog id="settings-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? ""

        assert.doesNotMatch(footer, /id="open-trace"|id="choose-runtime"/)
        assert.match(settings, /id="open-trace"/)
        assert.match(settings, /id="choose-runtime"/)
    })

    it("exposes effort controls, dataset runs, runtime matrices, run history, deletion, and archived drafts", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        for (const id of [
            "composer-effort",
            "settings-task-effort",
            "settings-curator-effort",
            "settings-auto-capture-effort",
            "evaluation-runtime-list",
            "start-dataset-evaluation",
            "evaluation-runs",
            "archived-curations",
        ]) {
            assert.match(html, new RegExp(`id="${id}"`))
        }
        assert.match(preload, /deleteCase/)
        assert.match(preload, /deleteDataset/)
        assert.match(preload, /deleteEvaluationRun/)
        assert.match(preload, /startEvaluationRun/)
        assert.match(preload, /listEvaluationRuns/)
        assert.match(preload, /listArchivedCurations/)
        assert.match(main, /CodeBuddyRuntimeProvider/)
        assert.match(main, /datasets:delete-case/)
        assert.match(main, /datasets:delete/)
        assert.match(main, /evaluations:delete/)
        assert.match(main, /evaluations:start/)
        assert.match(html, /id="delete-dataset-dialog"/)
        assert.match(html, /id="delete-evaluation-run-dialog"/)
        assert.match(renderer, /data-delete-evaluation-dataset/)
        assert.match(renderer, /data-delete-evaluation-run/)
        assert.match(renderer, /state\.evaluationRuns\s*=\s*await window\.rollingSkill\.listEvaluationRuns\(\)/)
        assert.match(styles, /\.evaluation-case-row:hover\s+\.evaluation-case-delete/)
    })

    it("offers capability-gated Current and Archived thread history with read-only archived sessions", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="thread-view-switch"/)
        assert.match(html, /data-thread-view="current"/)
        assert.match(html, /data-thread-view="archived"/)
        assert.match(html, /id="thread-history-status"/)
        assert.match(html, /id="archived-thread-notice"/)
        assert.match(renderer, /threadView:\s*"current"/)
        assert.match(renderer, /capabilities\.includes\("thread-archive"\)/)
        assert.match(renderer, /listThreads\(requestedView === "archived"\)/)
        assert.match(renderer, /threadRefreshToken/)
        assert.match(renderer, /requestedView/)
        assert.match(renderer, /window\.rollingSkill\.archiveThread\(/)
        assert.match(renderer, /window\.rollingSkill\.unarchiveThread\(/)
        assert.match(renderer, /dataset\.archiveThread/)
        assert.match(renderer, /dataset\.unarchiveThread/)
        assert.match(renderer, /isThreadRunning\(thread\)/)
        assert.match(renderer, /activeThreadArchived/)
        assert.match(renderer, /archiveHistoryUnavailable/)
        assert.match(styles, /\.thread-row:hover\s+\.thread-action/)
    })

    it("renders web and absolute local-path links with safe DOM nodes and narrow preload calls", () => {
        const renderer = source("renderer/renderer.js")

        assert.match(renderer, /appendSafeMessageText/)
        assert.match(renderer, /localPathReference/)
        assert.match(renderer, /dataset\.externalUrl/)
        assert.match(renderer, /dataset\.localPath/)
        assert.match(renderer, /window\.rollingSkill\.openExternal\(/)
        assert.match(renderer, /window\.rollingSkill\.openLocalPath\(/)
        assert.doesNotMatch(renderer, /\.innerHTML\s*=/)
    })

    it("keeps the composer pinned in short viewports and shows the exact workspace path", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="sidebar-workspace-path"/)
        assert.match(html, /id="settings-workspace-path"/)
        assert.match(renderer, /sidebarWorkspacePath\.textContent\s*=\s*state\.workspaceRoot/)
        assert.match(renderer, /settingsWorkspacePath\.textContent\s*=\s*state\.workspaceRoot/)
        assert.match(renderer, /window\.innerHeight/)
        assert.match(styles, /\.app-shell\s*\{[^}]*min-height:\s*0/s)
        assert.match(styles, /\.sidebar\s*\{[^}]*min-height:\s*0/s)
        assert.match(styles, /\.workbench\s*\{[^}]*min-height:\s*0/s)
        assert.match(styles, /\.composer-wrap\s*\{[^}]*min-height:\s*0/s)
        assert.match(styles, /\.composer textarea\s*\{[^}]*max-height:\s*min\(220px,\s*28vh\)/s)
    })

    it("lets Settings choose the selected runtime local-access sandbox", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /id="settings-local-access"/)
        assert.match(html, /id="composer-access"/)
        assert.match(html, /id="settings-local-access-help"/)
        assert.match(html, /option value="full"[^>]*data-i18n="fullLocalAccess"/)
        assert.match(html, /option value="workspace"[^>]*data-i18n="workspaceOnlyAccess"/)
        assert.match(html, /data-i18n="localAccessHelp"/)
        assert.match(renderer, /localAccess:\s*"full"/)
        assert.match(renderer, /settingsLocalAccess\.value\s*=\s*state\.settings\.localAccess\s*\?\?\s*"full"/)
        assert.match(renderer, /localAccess:\s*elements\.settingsLocalAccess\.value/)
        assert.match(renderer, /capabilities\.includes\("sandbox-policy"\)/)
        assert.match(renderer, /localAccessUnsupported/)
    })
})
