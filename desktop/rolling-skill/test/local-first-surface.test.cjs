const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "..")

function source(path) {
    return readFileSync(join(root, path), "utf8")
}

describe("local-first desktop surface", () => {
    it("provides a dedicated three-column Operator self-operation surface", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const operator = source("renderer/operator-workbench.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /data-surface="operator"/)
        assert.match(html, /id="operator-workbench"/)
        assert.match(html, /id="operator-job-list"/)
        assert.match(html, /id="operator-transcript"/)
        assert.match(html, /id="operator-status-panel"/)
        assert.match(html, /id="operator-composer"/)
        assert.match(
            html,
            /id="operator-composer-send"[^>]*class="[^"]*operator-action-button[^"]*primary[^"]*"/u,
        )
        assert.match(html, /id="operator-setup-form"/)
        assert.match(html, /id="operator-approval-queue"/)
        assert.match(html, /id="operator-job-kind"/)
        assert.match(html, /id="operator-optimization-fields"/)
        assert.match(html, /id="operator-optimization-baseline"/)
        assert.match(html, /id="operator-optimization-judge-runtime"/)
        assert.doesNotMatch(html, /id="operator-optimization-preflight"/u)
        assert.doesNotMatch(html, /id="operator-optimization-preflight-summary"/u)
        assert.match(html, /id="operator-optimization-start"[^>]*type="submit"/u)
        assert.doesNotMatch(
            html.match(/id="operator-optimization-start"[^>]*>/u)?.[0] ?? "",
            /disabled/u,
        )
        assert.match(html, /id="operator-optimization-panel"/)
        assert.match(html, /id="operator-optimization-timeline"/)
        assert.match(html, /id="operator-optimization-recovery"/)
        assert.match(html, /id="operator-new-job"[^>]*data-i18n="operatorNewJob"/)
        assert.match(html, /id="operator-setup-form"[\s\S]*data-i18n="operatorStartSelfOperation"/)
        assert.match(html, /id="operator-composer-input"[^>]*data-i18n-placeholder="operatorMessagePlaceholder"/)
        assert.match(html, /id="operator-approval-queue"/)
        assert.match(html, /operator-workbench\.js/)
        assert.match(renderer, /createOperatorWorkbench/)
        assert.match(renderer, /surface === "operator"/)
        assert.match(renderer, /typeof window\.rollingSkill\.bootstrapOperator === "function"/)
        assert.match(renderer, /operatorJobs:\s*"Jobs"/)
        assert.match(renderer, /operatorJobs:\s*"任务"/)
        assert.match(renderer, /translate:\s*t/)
        assert.match(renderer, /formatMessage,/)
        assert.match(operator, /readOperatorSummaryPage/)
        assert.match(operator, /resolveOperatorApproval/)
        assert.match(operator, /listModelsForRuntime/)
        assert.doesNotMatch(operator, /preflightOptimization/u)
        assert.match(operator, /startOptimization/)
        assert.match(operator, /getOptimizationRun/)
        assert.match(operator, /pauseOptimization/)
        assert.match(operator, /resumeOptimization/)
        assert.match(operator, /stopOptimization/)
        assert.match(operator, /getOptimizationReport/)
        assert.ok((operator.match(/"operator-action-button"/gu) ?? []).length >= 2)
        assert.match(operator, /operator-action-button operator-action-danger/u)
        assert.match(renderer, /versions:\s*state\.managedSkills\.versions/)
        assert.doesNotMatch(operator, /renderAll\s*\(/)
        assert.doesNotMatch(operator, /gpt-[\w.-]+|claude-[\w.-]+|deepseek-[\w.-]+/iu)
        assert.match(html, /class="operator-workbench-header"/)
        assert.match(html, /data-i18n="operatorWorkbenchTitle"/)
        assert.match(html, /data-i18n="operatorWorkbenchHelp"/)
        assert.match(html, /class="operator-grid"/)
        assert.match(html, /class="operator-setup-hero-copy"/)
        assert.match(html, /id="operator-setup-scroll" class="operator-setup-scroll"/)
        assert.match(html, /class="operator-field operator-job-kind-field operator-hero-control"/)
        assert.match(html, /class="operator-field operator-objective-field"/)
        assert.match(html, /class="operator-setup-section operator-environment-section"/)
        assert.match(html, /class="operator-setup-section operator-resource-section"/)
        assert.match(html, /class="operator-primary-runtime-card evaluation-runtime-row"/)
        assert.match(html, /class="operator-primary-runtime-heading evaluation-runtime-heading"/)
        assert.match(html, /class="operator-primary-runtime-controls evaluation-runtime-controls"/)
        assert.match(html, /id="operator-runtime-name"/)
        assert.match(html, /id="operator-runtime-detail"/)
        assert.doesNotMatch(html, /operator-(?:objective-field|setup-section)[^>]*data-step=/u)
        assert.match(html, /class="operator-setup-actions operator-setup-footer"/)
        assert.match(renderer, /operatorEnvironment:\s*"Run environment"/)
        assert.match(renderer, /operatorEnvironment:\s*"运行环境"/)
        assert.match(renderer, /operatorWorkbenchTitle:\s*"Run scoped self-operation Jobs"/)
        assert.match(renderer, /operatorWorkbenchTitle:\s*"运行受控的自操作任务"/)
        assert.match(styles, /\.operator-workbench\s*\{[^}]*radial-gradient/s)
        assert.match(styles, /\.operator-workbench\s*\{[^}]*flex-direction:\s*column/s)
        assert.match(styles, /\.operator-grid\s*\{[^}]*grid-template-columns:/s)
        assert.match(styles, /\.operator-workbench-header h1\s*\{[^}]*font-size:\s*24px/s)
        assert.match(styles, /\.operator-job-panel,\s*\.operator-session-panel,\s*\.operator-status-panel\s*\{[^}]*border-radius:\s*13px/s)
        assert.match(styles, /\.operator-job-panel,\s*\.operator-session-panel,\s*\.operator-status-panel\s*\{[^}]*background:\s*color-mix/s)
        assert.match(styles, /\.operator-target-card:has\(input:checked\)/)
        assert.match(styles, /\.operator-setup-actions button:disabled\s*\{[^}]*opacity:\s*0\.45/su)
        assert.match(styles, /\.operator-check-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
        assert.match(styles, /\.evaluation-runtime-heading\.operator-primary-runtime-heading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
        assert.match(styles, /\.evaluation-runtime-controls\.operator-primary-runtime-controls\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s)
        assert.match(styles, /\.operator-objective-field\s*\{[^}]*border:/s)
        assert.doesNotMatch(styles, /content:\s*attr\(data-step\)/s)
        assert.doesNotMatch(styles, /\.operator-setup-footer\s*\{[^}]*position:\s*sticky/s)
        assert.match(styles, /\.operator-setup-actions button\.primary\s*\{[^}]*background:\s*var\(--accent\)/s)
        assert.match(styles, /\.operator-session-panel:has\(\.operator-setup-form:not\(\.hidden\)\) \.operator-transcript/)
        assert.doesNotMatch(styles, /\.operator-state-pill\s*\{[^}]*text-transform:\s*capitalize/s)
        assert.match(styles, /\.operator-composer-wrap\s*\{[^}]*position:\s*sticky/s)
        assert.match(styles, /\.operator-action-button\s*\{[^}]*min-height:[^}]*border-radius:/su)
        assert.match(styles, /\.operator-action-button\.primary\s*\{[^}]*background:\s*var\(--accent\)/su)
        assert.match(styles, /\.operator-action-button:focus-visible\s*\{[^}]*outline:/su)
        assert.match(styles, /\.operator-action-button:disabled\s*\{[^}]*opacity:/su)
        assert.match(
            styles,
            /\.operator-action-button\.operator-action-danger:hover:not\(:disabled\),[\s\S]*?\{[^}]*var\(--danger\)/u,
        )
        assert.match(styles, /\.operator-optimization-grid\s*\{[^}]*grid-template-columns:/s)
        assert.match(styles, /\.operator-optimization-recovery/)
        assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*?\.operator-grid\s*\{[^}]*grid-template-columns:/)
        assert.match(styles, /@media \(max-height: 640px\)[\s\S]*?\.operator-composer-wrap\s*\{[^}]*bottom:\s*0/)
        assert.match(operator, /selectors\.setupScroll\.scrollTop\s*=\s*0/)
        assert.match(operator, /"article",\s*"operator-target-card evaluation-runtime-row"/s)
        assert.match(operator, /"label",\s*"operator-target-runtime-heading evaluation-runtime-heading"/s)
        assert.match(operator, /"div",\s*"operator-target-runtime-options evaluation-runtime-controls"/s)
        assert.doesNotMatch(operator, /"operator-check operator-target-card"/)
    })

    it("ships a reversible two-color mechanical S keycap app icon and keeps both originals", () => {
        const previousAppIcon = source("assets/icon.svg")
        const previousKeycapIcon = source("assets/icon-spin-keycap.svg")
        const appIcon = source("assets/icon-s-keycap-orange.svg")
        const inAppLogo = source("renderer/logo.svg")
        const styles = source("renderer/styles.css")
        const packageJson = source("package.json")
        const previousPng = readFileSync(join(root, "assets/icon.svg.png"))
        const previousKeycapPng = readFileSync(join(root, "assets/icon-spin-keycap.png"))
        const png = readFileSync(join(root, "assets/icon-s-keycap-orange.png"))

        assert.match(previousAppIcon, /#78B8FF/)
        assert.match(previousAppIcon, /M244 338H348/)
        assert.match(previousKeycapIcon, />放<\/text>/)
        assert.match(appIcon, /rotate\(-7 512 512\)/)
        assert.match(appIcon, />S<\/text>/)
        assert.doesNotMatch(appIcon, />放<\/text>/)
        assert.doesNotMatch(appIcon, /linearGradient|radialGradient|filter|stop-color/)
        const colors = new Set(
            [...appIcon.matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) => match[0].toUpperCase()),
        )
        assert.deepEqual([...colors].sort(), ["#F36B21", "#FFFFFF"])
        assert.match(appIcon, /data-keycap-side/)
        assert.match(appIcon, /data-keycap-top/)
        assert.match(packageJson, /assets\/icon-s-keycap-orange\.png/)
        assert.match(packageJson, /"pack:mac":\s*"npm run render:icon && npm run build:tool && electron-builder/)
        assert.equal(inAppLogo.trim(), appIcon.trim())
        assert.doesNotMatch(`${previousAppIcon}\n${appIcon}\n${inAppLogo}`, /#F2F25C/i)
        assert.doesNotMatch(styles, /filter:\s*hue-rotate/)
        assert.equal(previousPng.subarray(1, 4).toString("ascii"), "PNG")
        assert.equal(previousKeycapPng.subarray(1, 4).toString("ascii"), "PNG")
        assert.equal(png.subarray(1, 4).toString("ascii"), "PNG")
        assert.equal(png.readUInt32BE(16), 1024)
        assert.equal(png.readUInt32BE(20), 1024)
    })

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
        assert.match(html, /id="case-issue-description"/)
        assert.match(html, /id="case-create-error"[^>]*role="alert"/)
        assert.doesNotMatch(html, /id="case-issue-description"[^>]*readonly/)
        assert.doesNotMatch(html, /id="case-issue-description"[^>]*required/)
        assert.match(renderer, /createCuration/)
        assert.match(renderer, /issueDescription:\s*elements\.caseIssueDescription\.value/)
        assert.match(renderer, /elements\.caseIssueDescription\.value = ""/)
        assert.doesNotMatch(renderer, /datasetQuestionDirty/)
        const createStart = renderer.indexOf("async function createCuration()")
        const createEnd = renderer.indexOf("function assertCalibrationBatchContext", createStart)
        const createHandler = renderer.slice(createStart, createEnd)
        assert.ok(createStart >= 0 && createEnd > createStart)
        assert.ok(
            createHandler.indexOf("elements.caseDialog.close()") >
                createHandler.indexOf("await window.rollingSkill.createCuration"),
        )
        assert.match(createHandler, /sourceThreadId:\s*selection\.sourceThreadId/)
        assert.match(createHandler, /startTurnId:\s*selection\.startTurnId/)
        assert.match(createHandler, /startMessageOrdinal:\s*selection\.startMessageOrdinal/)
        assert.match(createHandler, /endTurnId:\s*selection\.endTurnId/)
        assert.match(createHandler, /endMessageOrdinal:\s*selection\.endMessageOrdinal/)
        assert.match(createHandler, /const issueDescription = elements\.caseIssueDescription\.value\.trim\(\)/)
        assert.match(createHandler, /issueDescription\s*\? \{issueDescription:/)
        assert.match(createHandler, /catch \(error\)[\s\S]*showCaseError\(error\)/)
        assert.doesNotMatch(createHandler, /catch \(error\)[\s\S]*showError\(error\)/)
        assert.match(preload, /createCuration/)
        assert.match(main, /curation:create/)
        assert.match(main, /startTurnId[\s\S]{0,500}startMessageOrdinal/)
        assert.match(main, /endTurnId[\s\S]{0,500}endMessageOrdinal/)
        assert.match(main, /hiddenThreadIds/)
        assert.doesNotMatch(preload, /saveCase/)
        assert.doesNotMatch(main, /datasets:save-case/)
        assert.match(renderer, /goodcase/)
        assert.match(renderer, /badcase/)
        assert.match(renderer, /curation-reference-card/)
        assert.match(renderer, /curation-live-activity/)
        assert.match(renderer, /createCaseCalibration/)
        assert.match(renderer, /dataset\.calibrateEvaluationCase/)
        assert.match(renderer, /operation === "calibration"/)
        assert.match(renderer, /effectiveEffort/)
        assert.match(renderer, /actualRuntimeUnknown/)
        assert.match(renderer, /rolling-skill-curated-case\\\/v\[12\]/)
        assert.doesNotMatch(renderer, /defaultEffort \? `\$\{t\("runtimeDefaultEffort"\)\} · \$\{defaultEffort\}`/)
    })

    it("offers bilingual single-Case refresh with historical baseline review", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(renderer, /refreshCase:\s*"Refresh Case"/u)
        assert.match(renderer, /refreshCase:\s*"更新 Case"/u)
        assert.match(renderer, /refreshingCase:\s*"Refreshing…"/u)
        assert.match(renderer, /refreshingCase:\s*"更新中…"/u)
        assert.match(renderer, /reviewRefresh:\s*"Review refresh"/u)
        assert.match(renderer, /reviewRefresh:\s*"查看更新"/u)
        assert.match(renderer, /caseRefresh:\s*"Case refresh"/u)
        assert.match(renderer, /caseRefresh:\s*"Case 更新"/u)
        assert.match(renderer, /refreshBaseline:\s*"Previous saved Case"/u)
        assert.match(renderer, /refreshBaseline:\s*"更新前保存的 Case"/u)
        assert.match(renderer, /caseRefreshed:\s*"Case updated; the previous version was preserved"/u)
        assert.match(renderer, /caseRefreshed:\s*"Case 已更新，旧版本已保留"/u)
        assert.match(renderer, /refreshTargetChanged:\s*"The Case changed during refresh\. Start again\."/u)
        assert.match(renderer, /refreshTargetChanged:\s*"更新期间 Case 已发生变化，请重新开始。"/u)
        assert.match(renderer, /refreshFailed:\s*"Case refresh failed: \{message\}"/u)
        assert.match(renderer, /refreshFailed:\s*"Case 更新失败：\{message\}"/u)

        assert.match(renderer, /dataset\.refreshEvaluationCase\s*=\s*caseEntry\.id/u)
        assert.match(renderer, /function activeRefreshForCase\(/u)
        assert.match(renderer, /session\.operation === "refresh" && session\.baselineCaseSnapshot/u)
        assert.match(renderer, /t\("refreshBaseline"\)/u)
        assert.match(renderer, /async function createCaseRefresh\(/u)
        assert.match(renderer, /window\.rollingSkill\.createCaseRefresh/u)
        assert.match(renderer, /leaveAutomaticRefreshForManualAction\(sessionId\)/u)
        assert.match(styles, /\.evaluation-case-refresh/u)
        assert.match(styles, /\.refresh-baseline-card/u)
    })

    it("offers bilingual Goodcase-only or all-Case automatic refresh batches", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="open-case-refresh-batch"[^>]*data-i18n="refreshCases"/u)
        assert.match(html, /id="case-refresh-batch-dialog"/u)
        assert.match(html, /name="case-refresh-scope" value="goodcase" checked/u)
        assert.match(html, /name="case-refresh-scope" value="all"/u)
        assert.match(html, /id="case-refresh-batch-status"/u)

        assert.match(renderer, /refreshCases:\s*"Refresh Cases"/u)
        assert.match(renderer, /refreshCases:\s*"批量更新 Case"/u)
        assert.match(renderer, /refreshBatchProgress:\s*"Batch refresh · \{completed\}\/\{total\} saved"/u)
        assert.match(renderer, /refreshBatchProgress:\s*"批量更新 · 已保存 \{completed\}\/\{total\}"/u)
        assert.match(renderer, /refreshBatchSaving:\s*"Valid draft ready · saving automatically…"/u)
        assert.match(renderer, /refreshBatchSaving:\s*"草稿校验通过 · 正在自动保存…"/u)
        assert.match(renderer, /refreshBatchComplete:\s*"All selected Cases were refreshed and saved"/u)
        assert.match(renderer, /refreshBatchComplete:\s*"所选 Case 已全部更新并保存"/u)
        assert.match(renderer, /refreshBatchStopped:\s*"Automatic Case refresh stopped"/u)
        assert.match(renderer, /refreshBatchStopped:\s*"已停止批量更新"/u)
        assert.match(renderer, /refreshBatchFailed:\s*"Automatic Case refresh paused: \{message\}"/u)
        assert.match(renderer, /refreshBatchFailed:\s*"批量更新已暂停：\{message\}"/u)

        assert.match(renderer, /function openCaseRefreshBatchDialog\(/u)
        assert.match(renderer, /function startCaseRefreshBatch\(/u)
        assert.match(renderer, /async function advanceCaseRefreshBatch\(/u)
        assert.match(renderer, /function maybeAutoArchiveRefresh\(/u)
        assert.match(renderer, /async function stopCaseRefreshBatch\(/u)
        assert.match(
            renderer,
            /\.filter\(\(entry\) => scope === "all" \|\| entry\.caseType === "goodcase"\)/u,
        )
        assert.match(renderer, /archiveCuration\(session\.id, \{automatic: true\}\)/u)
        assert.match(renderer, /batch\.snapshot\(\)\.status !== "running"\) return/u)
        assert.match(styles, /\.refresh-batch-panel/u)
        assert.match(styles, /\.refresh-scope-options/u)
    })

    it("offers bilingual Raw Case recovery before Case and dataset deletion", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="recover-deleted-case-question"[^>]*checked/u)
        assert.match(html, /id="recover-deleted-dataset-questions"[^>]*checked/u)
        assert.match(html, /id="recover-deleted-dataset-count"/u)
        assert.match(renderer, /recoverDeleteQuestions:\s*"Preserve questions in Raw Cases"/u)
        assert.match(renderer, /recoverDeleteQuestions:\s*"删除前将问题保留到 Raw Case"/u)
        assert.match(
            renderer,
            /deleteDataset\(datasetId,\s*elements\.recoverDeletedDatasetQuestions\.checked\)/u,
        )
        assert.match(
            renderer,
            /deleteCase\([^,]+,\s*[^,]+,\s*elements\.recoverDeletedCaseQuestion\.checked\)/u,
        )
        assert.match(styles, /\.confirm-preserve-option/u)
    })

    it("contains no bundled agent runtime dependency", () => {
        const packageJson = JSON.parse(source("package.json"))
        assert.doesNotMatch(JSON.stringify(packageJson.dependencies), /@openai\/codex|codex-runtime/)
        assert.deepEqual(packageJson.build.extraResources, [{
            from: "dist-tools/rolling-skill-tool",
            to: "rolling-skill-tool",
        }])
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
        assert.match(html, /id="settings-auto-capture-mode"/)
        assert.match(html, /id="settings-auto-capture-model"/)
        assert.doesNotMatch(html, /id="settings-auto-capture-skill"/)
        assert.doesNotMatch(html, /id="case-skill"/)
        assert.match(html, /id="case-dataset-skill-status"/)
        assert.match(html, /id="new-dataset-skill"/)
        assert.match(renderer, /data-curation-model/)
        assert.match(renderer, /data-discard-curation/)
        assert.match(renderer, /skillDisplayLabel/)
        assert.match(renderer, /translations/)
        assert.match(styles, /data-theme="codex-light"/)
        assert.match(styles, /data-theme="codex-dark"/)
        assert.match(preload, /listModels/)
        assert.match(preload, /updateSettings/)
        assert.match(preload, /discardCuration/)
        assert.match(main, /"runtimes\.models"/)
        assert.match(main, /settings:update/)
        assert.match(main, /curation:discard/)
        assert.doesNotMatch(main, /input\.skillPath/)
    })

    it("configures scheduled discovery and renders bilingual capture status without whole-page refresh", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        for (const id of [
            "settings-auto-capture-mode",
            "settings-auto-capture-cadence",
            "settings-auto-capture-time",
            "settings-auto-capture-weekday",
            "settings-auto-capture-model",
            "settings-auto-capture-effort",
            "settings-auto-capture-dataset",
            "settings-auto-capture-status",
            "settings-auto-capture-last-success",
        ]) assert.match(html, new RegExp(`id="${id}"`))

        assert.doesNotMatch(html, /id="settings-auto-capture"\s+type="checkbox"/u)
        assert.doesNotMatch(
            `${html}\n${renderer}`,
            /Create a reviewable draft after each completed response|每次回答完成后自动创建待审核草稿/u,
        )
        assert.match(renderer, /autoCaptureScheduled:\s*"Scheduled · keep in Raw Cases"/u)
        assert.match(renderer, /autoCaptureScheduled:\s*"定时发现 · 保留到 Raw Case"/u)
        assert.match(renderer, /autoCaptureAutomatic:\s*"Fully automatic · save gated Cases"/u)
        assert.match(renderer, /autoCaptureAutomatic:\s*"完全自动 · 仅保存通过闸门的 Case"/u)
        assert.match(renderer, /captureCadence:\s*"Cadence"/u)
        assert.match(renderer, /captureCadence:\s*"频率"/u)
        assert.match(renderer, /captureWeekday:\s*"Weekday"/u)
        assert.match(renderer, /captureWeekday:\s*"星期"/u)
        assert.match(renderer, /autoCaptureNextRun:\s*"Next scan \{time\}"/u)
        assert.match(renderer, /autoCaptureNextRun:\s*"下次扫描 \{time\}"/u)
        assert.match(renderer, /autoCaptureLastSuccess:\s*"Last successful scan \{time\}"/u)
        assert.match(renderer, /autoCaptureLastSuccess:\s*"上次成功扫描 \{time\}"/u)
        assert.match(renderer, /autoCaptureError:\s*"Capture needs attention: \{message\}"/u)
        assert.match(renderer, /autoCaptureError:\s*"自动沉淀需要处理：\{message\}"/u)
        assert.match(renderer, /onAutomaticCaptureStatus/u)
        assert.match(renderer, /Intl\.DateTimeFormat/u)
        assert.match(renderer, /autoCaptureMode:\s*elements\.settingsAutoCaptureMode\.value/u)
        assert.match(renderer, /autoCaptureCadence:\s*elements\.settingsAutoCaptureCadence\.value/u)
        assert.match(renderer, /autoCaptureTime:\s*elements\.settingsAutoCaptureTime\.value/u)
        assert.match(renderer, /autoCaptureWeekday:\s*Number\(elements\.settingsAutoCaptureWeekday\.value\)/u)
        assert.match(renderer, /settingsAutoCaptureWeekdayField\.classList\.toggle\("hidden"/u)
        const statusStart = renderer.indexOf("function renderCaptureStatus()")
        const statusEnd = renderer.indexOf("\nfunction ", statusStart + 1)
        const statusRenderer = renderer.slice(statusStart, statusEnd)
        assert.ok(statusStart >= 0 && statusEnd > statusStart)
        assert.doesNotMatch(statusRenderer, /renderAll\s*\(/u)
        assert.match(styles, /\.automatic-capture-status/u)
        assert.match(styles, /\.automatic-capture-schedule/u)
    })

    it("keeps per-task model selection separate from the new-task default", () => {
        const renderer = source("renderer/renderer.js")
        const start = renderer.indexOf('elements.composerModel.addEventListener("change"')
        const end = renderer.indexOf("elements.stopTurn.addEventListener", start)
        const handler = renderer.slice(start, end)

        assert.ok(start >= 0 && end > start)
        assert.match(handler, /state\.selectedTaskModelId/)
        assert.doesNotMatch(handler, /updateSettings/)
        assert.match(renderer, /rollingSkillProfile/)
        assert.match(renderer, /submittedRuntimeEpoch/)
        assert.match(renderer, /state\.activeThreadId !== submittedThreadId/)
    })

    it("renders DeepSeek Harness questions in chat without replacing the task composer", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(renderer, /pendingRuntimeQuestions/)
        assert.match(renderer, /onRuntimeQuestion/)
        assert.match(renderer, /function renderRuntimeQuestion/)
        assert.match(renderer, /respondRuntimeQuestion/)
        assert.match(renderer, /question\.multiSelect/)
        assert.match(renderer, /question\.options/)
        assert.match(renderer, /custom/)
        assert.match(renderer, /state\.activeThreadId/)
        assert.match(styles, /\.runtime-question-card/)
        assert.match(styles, /\.runtime-question-options/)
    })

    it("provides a Skill-grouped Raw Case inbox with verbatim runtime dispatch", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /id="topbar-raw-cases"/)
        assert.match(html, /id="raw-case-panel"/)
        assert.match(html, /id="raw-case-form"/)
        assert.match(html, /id="raw-case-skill"/)
        assert.match(html, /id="raw-case-question"/)
        assert.match(html, /id="raw-case-list"/)
        assert.match(renderer, /function renderRawCases\(/)
        assert.match(renderer, /function dispatchRawCase\(/)
        assert.match(renderer, /markRawCaseDispatched/)
        assert.match(renderer, /rawCase\.question/)
        assert.doesNotMatch(renderer, /\[\s*rawCase\.question\s*,\s*\{\s*type:\s*"skill"/)
        assert.match(styles, /\.raw-case-panel/)
        assert.match(styles, /\.raw-case-skill-group/)
        assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*\.raw-case-panel\.visible/s)
        assert.match(
            styles,
            /\.app-shell:has\(\.raw-case-panel\.visible\):has\(\.trace-drawer\.visible\)[\s\S]{0,500}var\(--drawer-width\)[\s\S]{0,120}var\(--raw-case-width\)/,
        )
        assert.doesNotMatch(
            styles,
            /:has\(\.trace-drawer\.visible\) \.raw-case-panel[\s\S]{0,100}display:\s*none/,
        )
    })

    it("renders automatic Raw Case evidence and creates a Draft from frozen source boundaries", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")
        const preload = source("src/preload.cjs")

        assert.match(renderer, /source\?\.kind === "automatic_capture"/u)
        assert.match(renderer, /source\.observations/u)
        assert.match(renderer, /rawCaseDetectedSkill:\s*"Detected Skill: \{name\}"/u)
        assert.match(renderer, /rawCaseDetectedSkill:\s*"识别到 Skill：\{name\}"/u)
        assert.match(renderer, /rawCaseOutcomeResolved:\s*"Resolved"/u)
        assert.match(renderer, /rawCaseOutcomeResolved:\s*"已解决"/u)
        assert.match(renderer, /rawCaseOutcomeUnresolved:\s*"Unresolved"/u)
        assert.match(renderer, /rawCaseOutcomeUncertain:\s*"Uncertain"/u)
        assert.match(renderer, /rawCaseConfidence:\s*"Confidence \{value\}%"/u)
        assert.match(renderer, /rawCaseConfidence:\s*"置信度 \{value\}%"/u)
        assert.match(renderer, /rawCaseSourceTime:\s*"Detected \{time\}"/u)
        assert.match(renderer, /rawCaseSourceTime:\s*"识别于 \{time\}"/u)
        assert.match(renderer, /createCaseDraft:\s*"Create Case Draft"/u)
        assert.match(renderer, /createCaseDraft:\s*"创建 Case 草稿"/u)
        assert.match(renderer, /rawCaseSourceRuntimeMismatch/u)
        assert.match(renderer, /rawCaseNoCompatibleDataset/u)
        assert.match(renderer, /rawCaseEpisodeIncomplete/u)
        assert.match(renderer, /function automaticRawCaseObservation\(/u)
        assert.match(renderer, /function compatibleRawCaseDatasets\(/u)
        assert.match(renderer, /dataOpenRawCaseDraft/u)
        assert.match(renderer, /createCurationFromRawCase\(rawCaseId, datasetId\)/u)
        assert.match(renderer, /upsertCuration\(session\)/u)
        assert.match(renderer, /setCurationOpen\(true\)/u)
        assert.match(preload, /createCurationFromRawCase/u)
        assert.match(styles, /\.raw-case-automatic-meta/u)
        assert.match(styles, /\.raw-case-draft-chooser/u)

        const rawCardStart = renderer.indexOf("function renderRawCases()")
        const rawCardEnd = renderer.indexOf("\nfunction clearRawCaseForm", rawCardStart)
        const rawCards = renderer.slice(rawCardStart, rawCardEnd)
        assert.ok(rawCardStart >= 0 && rawCardEnd > rawCardStart)
        assert.match(rawCards, /automaticRawCaseObservation\(rawCase\)/u)
        assert.match(rawCards, /observation\?\.complete/u)
        assert.match(rawCards, /dataOpenRawCaseDraft/u)
        assert.match(rawCards, /actions\.append\(edit, remove, current, fresh\)/u)
    })

    it("marks source timeline ranges that already have a Case draft or saved Case", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(renderer, /sourceCurationMarkers/)
        assert.match(renderer, /curationMarkerForItem/)
        assert.match(renderer, /source-case-range/)
        assert.match(renderer, /source-case-range-status/)
        assert.match(renderer, /curateAgain/)
        assert.match(styles, /\.source-case-range\.draft/)
        assert.match(styles, /\.source-case-range\.archived/)
    })

    it("offers all three native DeepSeek Harness permission presets in the task composer", () => {
        const renderer = source("renderer/renderer.js")
        const optionsStart = renderer.indexOf("function permissionModeOptions")
        const optionsEnd = renderer.indexOf("function defaultPermissionMode", optionsStart)
        const options = renderer.slice(optionsStart, optionsEnd)
        const defaultStart = optionsEnd
        const defaultEnd = renderer.indexOf("function renderPermissionModePicker", defaultStart)
        const defaults = renderer.slice(defaultStart, defaultEnd)

        assert.ok(optionsStart >= 0 && optionsEnd > optionsStart)
        assert.match(options, /providerId === "deepseek-harness"/)
        assert.match(options, /value:\s*"danger-full-access"/)
        assert.match(options, /value:\s*"workspace-write"/)
        assert.match(options, /value:\s*"read-only"/)
        assert.match(defaults, /providerId === "deepseek-harness"/)
        assert.match(defaults, /"danger-full-access"/)
        assert.match(defaults, /"workspace-write"/)
    })

    it("routes core runtime and Curator chrome through localization keys", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /data-i18n="localEvidence"/)
        assert.match(html, /data-i18n="curatorTasks"/)
        assert.match(renderer, /t\(isBadcase \? "structuredBadcase" : "structuredReference"\)/)
        assert.match(renderer, /t\("deductionRules"\)/)
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
        assert.doesNotMatch(html, /id="evaluation-skill"/)
        assert.match(html, /id="evaluation-dataset-skill-status"/)
        assert.match(html, /id="evaluation-new-dataset-skill"/)
        assert.match(html, /id="dataset-skill-dialog"/)
        assert.match(html, /id="start-evaluation"/)
        assert.match(renderer, /renderEvaluationWorkbench/)
        assert.match(renderer, /caseEntry\.title \|\| caseEntry\.inputSummary \|\| caseEntry\.id/)
        assert.match(preload, /listSkills/)
        assert.match(preload, /bindDatasetSkill/)
        assert.match(preload, /listCases/)
        assert.match(main, /skills:list/)
        assert.match(main, /"datasets\.get"/)
        assert.doesNotMatch(styles, /\.workbench\.evaluation-mode\s*>\s*\.topbar/)
        assert.match(styles, /\.evaluation-workbench\s*\{[^}]*grid-row:\s*2\s*\/\s*-1/s)
    })

    it("adds a responsive managed Skill repository workbench without disturbing Chat drafts", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /data-surface="skills"/)
        assert.match(html, /id="skill-management-workbench"/)
        assert.match(html, /id="managed-repository-list"/)
        assert.match(html, /id="managed-skill-detail"/)
        assert.match(html, /id="managed-skill-versions"/)
        assert.match(html, /id="managed-skill-side-tabs"/)
        assert.match(html, /data-managed-skill-side-view="versions"/)
        assert.match(html, /data-managed-skill-side-view="installations"/)
        assert.match(html, /id="managed-skill-installations"/)
        assert.match(html, /id="managed-install-version"/)
        assert.match(html, /id="managed-install-runtime-list"/)
        assert.match(html, /id="start-managed-skill-installations"/)
        assert.match(html, /id="managed-install-job-list"/)
        assert.match(html, /id="managed-install-session"/)
        assert.match(html, /id="cancel-managed-skill-installation"/)
        assert.match(html, /id="inspect-managed-skill-installation"/)
        for (const kind of ["zip", "folder", "local-git", "git-url"]) {
            assert.match(html, new RegExp(`data-import-skill="${kind}"`))
        }
        assert.match(html, /id="managed-git-url-dialog"/)
        assert.match(html, /id="managed-candidate-dialog"/)
        assert.match(html, /id="managed-release-dialog"/)
        assert.match(renderer, /managedSkills:\s*\{repositories:\s*\[\],\s*skills:\s*\[\],\s*versions:\s*\[\]\}/)
        assert.match(renderer, /renderSkillManagementWorkbench/)
        assert.match(renderer, /loadManagedSkills/)
        assert.match(renderer, /rescanManagedSkills/)
        assert.match(renderer, /importManagedGitUrl/)
        assert.match(renderer, /importManagedSkill/)
        assert.match(renderer, /createManagedSkillCandidate/)
        assert.match(renderer, /releaseManagedSkillVersion/)
        assert.match(renderer, /\["chat", "evaluation", "skills", "operator"\]\.includes\(surface\)/)
        assert.match(renderer, /initial\.managedSkills/)
        assert.match(renderer, /onManagedSkillsChanged/)
        assert.match(renderer, /onSkillInstallationsChanged/)
        assert.match(renderer, /startManagedSkillInstallations/)
        assert.match(renderer, /renderManagedSkillInstallations/)
        assert.match(renderer, /retryManagedSkillInstallation/)
        assert.doesNotMatch(renderer, /sendSkillInstallationMessage/)
        assert.match(styles, /\.workbench\.skills-mode\s*>\s*\.conversation-scroll/)
        assert.match(styles, /\.skill-management-grid\s*\{[^}]*grid-template-columns:/s)
        assert.match(styles, /\.managed-install-runtime-row/)
        assert.match(styles, /\.managed-install-timeline/)
        assert.match(styles, /\.managed-install-diagnostics/)
        assert.doesNotMatch(styles, /\.managed-install-composer/)
        assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*\.skill-management-grid/s)
        assert.doesNotMatch(styles, /body\.(?:busy|loading)[^}]*cursor:\s*(?:wait|progress)/s)
    })

    it("manages one versioned dataset rubric before Case curation and evaluation", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")
        const preload = source("src/preload.cjs")
        const main = source("src/main.cjs")

        for (const id of [
            "evaluation-dataset-rubric-status",
            "manage-dataset-rubric",
            "rubric-drawer",
            "rubric-version-list",
            "rubric-detail",
            "settings-rubric-model",
            "settings-rubric-effort",
        ]) {
            assert.match(html, new RegExp(`id="${id}"`))
        }
        assert.match(renderer, /createRubricSession/)
        assert.match(renderer, /sendRubricMessage/)
        assert.match(renderer, /function patchRubricActivityCard/)
        assert.match(renderer, /onRubricActivity[\s\S]*patchRubricActivityCard/)
        assert.match(renderer, /publishRubricSession/)
        assert.match(renderer, /discardRubricSession/)
        assert.match(renderer, /dataset\.migrateLegacyRubric/)
        assert.match(renderer, /migrateLegacyDatasetRubric/)
        assert.match(renderer, /data-rubric-model/)
        assert.match(renderer, /data-rubric-effort/)
        assert.match(renderer, /rubricCalibration\?\.status === "needed"/)
        assert.match(renderer, /session\.datasetId !== state\.evaluationDatasetId/)
        assert.match(renderer, /state\.rubricSessions\.some\(\(session\) => session\.id === activity\.sessionId\)/)
        assert.match(preload, /listDatasetRubricVersions/)
        assert.match(preload, /getActiveDatasetRubric/)
        assert.match(preload, /migrateLegacyDatasetRubric/)
        assert.match(preload, /onRubricChanged/)
        assert.match(main, /rubrics:create/)
        assert.match(main, /rubrics:publish/)
        assert.match(main, /rubrics:migrate-legacy-contract/)
        assert.match(main, /requirePublishedDatasetRubric\(dataset\)/)
        assert.match(styles, /\.dataset-rubric-card/)
        assert.match(styles, /\.rubric-drawer\.visible/)
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
            "settings-judge-model",
            "settings-judge-effort",
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
        assert.match(preload, /cancelEvaluationRun/)
        assert.match(preload, /startEvaluationRun/)
        assert.match(preload, /listEvaluationRuns/)
        assert.match(preload, /listArchivedCurations/)
        assert.match(main, /CodeBuddyRuntimeProvider/)
        assert.match(main, /datasets:delete-case/)
        assert.match(main, /datasets:delete/)
        assert.match(main, /evaluations:delete/)
        assert.match(main, /"evaluations\.cancel"/)
        assert.match(main, /"evaluations\.start"/)
        assert.match(html, /id="delete-dataset-dialog"/)
        assert.match(html, /id="delete-evaluation-run-dialog"/)
        assert.match(html, /id="cancel-evaluation-run-dialog"/)
        assert.match(renderer, /data-delete-evaluation-dataset/)
        assert.match(renderer, /data-delete-evaluation-run/)
        assert.match(renderer, /data-cancel-evaluation-run/)
        assert.match(renderer, /state\.evaluationRuns\s*=\s*await window\.rollingSkill\.listEvaluationRuns\(\)/)
        assert.match(styles, /\.evaluation-case-row:hover\s+\.evaluation-case-delete/)
    })

    it("configures an independent Judge and renders unified grading with neutral legacy history", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        for (const id of [
            "evaluation-judge-runtime",
            "evaluation-judge-model",
            "evaluation-judge-effort",
        ]) {
            assert.match(html, new RegExp(`id="${id}"`))
        }
        assert.match(renderer, /judgeConfiguration:\s*evaluationJudgeRequestConfiguration\(\)/)
        assert.match(renderer, /judgeModelId:\s*elements\.settingsJudgeModel\.value/)
        assert.match(renderer, /evaluationRunQualitySummary/)
        assert.match(renderer, /executionCompleted:\s*"Execution completed"/)
        assert.match(renderer, /qualityPassed:\s*"Passed"/)
        assert.match(renderer, /qualityFailed:\s*"Not passed"/)
        assert.match(renderer, /qualityIndeterminate:\s*"Indeterminate"/)
        assert.match(renderer, /qualityPending:\s*"Pending grading"/)
        assert.match(renderer, /qualityGradingFailed:\s*"Grading failed"/)
        assert.match(renderer, /judgeModelsLoading/)
        assert.match(renderer, /judgeModelsUnavailable/)
        assert.match(renderer, /judge\.displayName \|\| run\.judgeConfiguration\?\.displayName/)
        assert.match(renderer, /计算一个统一百分制总分/)
        assert.match(renderer, /settings\.judgeProfile/)
        assert.match(renderer, /gradingStatus/)
        assert.match(renderer, /computedScore\.criterionScores/)
        assert.match(renderer, /scoreContract\.criteria/)
        assert.match(renderer, /judgment\.assessments/)
        assert.match(renderer, /renderUnifiedCompletedGrading/)
        assert.match(renderer, /result\.scoreContract/)
        assert.match(renderer, /skillBindingDiagnostic/)
        assert.match(renderer, /effectiveBinding === "unverified"/)
        assert.match(renderer, /skillBindingTraceVerified/)
        assert.match(renderer, /qualityUsable:\s*"Usable · improve"/)
        assert.match(renderer, /computedScore\.outcomeTier/)
        assert.match(renderer, /result\.judgment/)
        assert.match(renderer, /judge\.runtimeId/)
        assert.match(renderer, /gradingFailed/)
        assert.match(renderer, /verificationStatus/)
        assert.match(renderer, /verifiableFields/)
        assert.match(renderer, /crossChecks/)
        assert.match(renderer, /legacySplitGrading/)
        assert.match(renderer, /evaluationRuntimeViewByRun/)
        assert.match(renderer, /runtimeView\.dataset\.evaluationRuntimeView/)
        assert.match(renderer, /data-evaluation-runtime-view/)
        assert.match(styles, /\.evaluation-score-summary/)
        assert.match(styles, /\.evaluation-grading-breakdown/)
        assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.evaluation-grid/)
        assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.evaluation-runs/)
        assert.doesNotMatch(`${html}\n${renderer}`, /Automated grading is not applied yet|自动评分尚未应用/)
    })

    it("exports the selected dataset as CSV from the dataset workbench", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /id="export-evaluation-dataset"/)
        assert.match(html, /id="export-dataset-dialog"/)
        assert.match(html, /id="export-case-scope"/)
        assert.match(html, /id="export-output-mode"/)
        assert.match(renderer, /window\.rollingSkill\.exportDatasetCsv\(\{[\s\S]*datasetId:/)
        assert.match(renderer, /datasetExported/)
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

    it("shows evaluation durations as minute-second values instead of raw milliseconds", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const formatter = source("renderer/evaluation-format.js")

        assert.match(html, /<script src="evaluation-format\.js"><\/script>/)
        assert.match(renderer, /formatEvaluationDuration\(result\.durationMs\)/)
        assert.doesNotMatch(renderer, /result\.durationMs\}\s*ms/)
        assert.match(formatter, /padStart\(2, "0"\)/)
    })

    it("renders web and absolute local-path links with safe DOM nodes and narrow preload calls", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /<script src="message-links\.js"><\/script>/)
        assert.match(html, /<script src="message-markdown\.js"><\/script>/)
        assert.match(html, /<script src="renderer\.js"><\/script>/)
        assert.match(renderer, /appendSafeMessageText/)
        assert.match(renderer, /tokenizeMessageLinks/)
        assert.match(renderer, /dataset\.externalUrl/)
        assert.match(renderer, /dataset\.localPath/)
        assert.match(renderer, /window\.rollingSkill\s*\.openExternal\(/)
        assert.match(renderer, /window\.rollingSkill\s*\.openLocalPath\(/)
        assert.doesNotMatch(renderer, /openLocalPath\([^)]*\)\.catch\(showError\)/)
        assert.match(renderer, /reportLinkOpenFailure/)
        assert.match(renderer, /localFileUnavailable/)
        assert.match(renderer, /externalLinkUnavailable/)
        assert.doesNotMatch(renderer, /\.innerHTML\s*=/)
    })

    it("restores per-conversation drafts and reading positions without animated catch-up", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /<script src="thread-view-state\.js"><\/script>/)
        assert.match(renderer, /RollingSkillThreadViewState/)
        assert.match(renderer, /snapshotActiveThreadView/)
        assert.match(renderer, /restoreActiveThreadView/)
        assert.match(renderer, /NEW_TASK_CONVERSATION_ID/)
        assert.match(renderer, /threadLoadToken/)
        assert.match(renderer, /modelRefreshToken/)
        assert.match(renderer, /state\.loadingThread[\s\S]{0,160}updateDraft/)
        assert.match(renderer, /state\.activeThread\?\.id === state\.activeThreadId/)
        assert.match(renderer, /runtimeId !== runtimeViewId\(\)/)
        assert.match(renderer, /const loading = state\.loadingThread/)
        assert.match(renderer, /threadLoadFailed/)
        assert.match(renderer, /migrate\(/)
        assert.match(renderer, /clearDraft\(/)
        assert.match(renderer, /conversationScroll\.addEventListener\("scroll"/)
        assert.match(renderer, /composerInput\.addEventListener\("input"/)
        assert.doesNotMatch(renderer, /forceBottom:\s*method === "item\/agentMessage\/delta"/)
        assert.doesNotMatch(styles, /scroll-behavior:\s*smooth/)
    })

    it("renders assistant and user Markdown through a safe DOM renderer", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.match(html, /marked\.umd\.js/)
        assert.match(html, /node_modules\/he\/he\.js/)
        assert.match(html, /<script src="message-markdown\.js"><\/script>/)
        assert.match(renderer, /appendSafeMessageMarkdown/)
        assert.match(renderer, /RollingSkillMessageMarkdown/)
        assert.match(renderer, /renderedItemCache/)
        assert.match(styles, /\.message-body\s+pre/)
        assert.match(styles, /\.message-body\s+table/)
        assert.match(styles, /\.message-body\s+blockquote/)
        assert.doesNotMatch(renderer, /\.innerHTML\s*=/)
    })

    it("shows full command input plus compact tool, subagent, and context activity", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")
        const commandActivity = source("renderer/command-activity.js")
        const styles = source("renderer/styles.css")

        for (const type of [
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "dynamicToolCall",
            "collabAgentToolCall",
            "subAgentActivity",
            "contextCompaction",
        ]) {
            assert.match(renderer, new RegExp(type))
        }
        assert.match(renderer, /activityText/)
        assert.match(renderer, /activity-card/)
        assert.match(html, /<script src="command-activity\.js"><\/script>/)
        assert.match(renderer, /RollingSkillCommandActivity/)
        assert.match(renderer, /commandActivityDetail\(item/)
        assert.match(commandActivity, /commandActions/)
        assert.match(commandActivity, /LEGACY_SHELL_PLACEHOLDER/)
        assert.match(styles, /\.activity-card[\s\S]{0,500}white-space:\s*pre-wrap/)
        assert.match(renderer, /runtimeMayOmitItems[\s\S]{0,200}getTurns\(\)\.length/)
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

    it("uses one compact Codex-style stop control across evaluation list and detail", () => {
        const renderer = source("renderer/renderer.js")
        const styles = source("renderer/styles.css")

        assert.doesNotMatch(renderer, /evaluation-run-cancel",\s*"■"/)
        assert.match(renderer, /evaluation-stop-control evaluation-run-cancel/)
        assert.match(renderer, /evaluation-stop-control evaluation-stop-button/)
        assert.match(renderer, /evaluation-stop-icon/)
        assert.match(styles, /\.evaluation-stop-control\s*\{[^}]*border-radius:\s*8px/s)
        assert.match(styles, /\.evaluation-stop-icon\s*\{[^}]*border-radius:/s)
        assert.match(styles, /\.evaluation-stop-control:hover\s*\{[^}]*var\(--danger\)/s)
    })

    it("lets the composer manage provider-specific permission modes per conversation", () => {
        const html = source("renderer/index.html")
        const renderer = source("renderer/renderer.js")

        assert.match(html, /id="settings-local-access"/)
        assert.match(html, /id="composer-access"/)
        assert.match(html, /class="access-picker"/)
        assert.match(html, /id="settings-local-access-help"/)
        assert.match(html, /option value="full"[^>]*data-i18n="fullLocalAccess"/)
        assert.match(html, /option value="workspace"[^>]*data-i18n="workspaceOnlyAccess"/)
        assert.match(html, /data-i18n="localAccessHelp"/)
        assert.match(renderer, /localAccess:\s*"full"/)
        assert.match(renderer, /settingsLocalAccess\.value\s*=\s*state\.settings\.localAccess\s*\?\?\s*"full"/)
        assert.match(renderer, /localAccess:\s*elements\.settingsLocalAccess\.value/)
        assert.match(renderer, /capabilities\.includes\("sandbox-policy"\)/)
        assert.match(renderer, /permissionModeOptions/)
        assert.match(renderer, /availablePermissionModes/)
        assert.match(renderer, /runtimeCurrent/)
        assert.match(renderer, /selectedTaskPermissionMode/)
        assert.match(renderer, /composerAccess\.addEventListener\("change"/)
        assert.match(renderer, /submittedPermissionMode/)
    })
})
