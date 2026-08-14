const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "..")

function source(path) {
    return readFileSync(join(root, path), "utf8")
}

describe("local-first desktop surface", () => {
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
        assert.match(packageJson, /"pack:mac":\s*"npm run render:icon && electron-builder/)
        assert.match(inAppLogo, /M76 132H170/)
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
        const createEnd = renderer.indexOf("async function loadTrace()", createStart)
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
        assert.match(renderer, /effectiveEffort/)
        assert.match(renderer, /actualRuntimeUnknown/)
        assert.match(renderer, /rolling-skill-curated-case\\\/v1/)
        assert.doesNotMatch(renderer, /defaultEffort \? `\$\{t\("runtimeDefaultEffort"\)\} · \$\{defaultEffort\}`/)
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
        assert.match(main, /models:list/)
        assert.match(main, /settings:update/)
        assert.match(main, /curation:discard/)
        assert.doesNotMatch(main, /input\.skillPath/)
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
        assert.match(renderer, /caseEntry\.source\?\.originalQuestion \|\| caseEntry\.question/)
        assert.match(preload, /listSkills/)
        assert.match(preload, /bindDatasetSkill/)
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
        assert.match(main, /evaluations:cancel/)
        assert.match(main, /evaluations:start/)
        assert.match(html, /id="delete-dataset-dialog"/)
        assert.match(html, /id="delete-evaluation-run-dialog"/)
        assert.match(html, /id="cancel-evaluation-run-dialog"/)
        assert.match(renderer, /data-delete-evaluation-dataset/)
        assert.match(renderer, /data-delete-evaluation-run/)
        assert.match(renderer, /data-cancel-evaluation-run/)
        assert.match(renderer, /state\.evaluationRuns\s*=\s*await window\.rollingSkill\.listEvaluationRuns\(\)/)
        assert.match(styles, /\.evaluation-case-row:hover\s+\.evaluation-case-delete/)
    })

    it("configures an independent Judge and renders deterministic 40/60 grading records", () => {
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
        assert.match(renderer, /gradingMaxima\(result\)/)
        assert.match(renderer, /scoreContract\?\.a\?\.maxScore/)
        assert.match(renderer, /scoreContract\?\.b\?\.maxScore/)
        assert.match(renderer, /通用 Skill 执行合规评为 A（40 分）/)
        assert.match(renderer, /灵活的 Skill \/ Case 质量评为 B（60 分）/)
        assert.match(renderer, /settings\.judgeProfile/)
        assert.match(renderer, /gradingStatus/)
        assert.match(renderer, /computedScore\.dimensionScores/)
        assert.match(renderer, /computedScore\.bCriterionScores/)
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
        for (const dimension of [
            "skill_activation",
            "required_references",
            "tool_policy",
            "workflow_order",
            "completeness_artifacts",
            "deterministic_processing",
            "evidence_output",
            "error_recovery",
        ]) {
            assert.match(renderer, new RegExp(`${dimension}:`))
        }
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
        assert.match(renderer, /window\.rollingSkill\.exportDatasetCsv\(state\.evaluationDatasetId\)/)
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
