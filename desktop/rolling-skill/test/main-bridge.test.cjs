const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "..")
const source = (path) => readFileSync(join(root, path), "utf8")

describe("desktop main/preload bridge", () => {
    it("registers the locally discovered DeepSeek Harness provider", () => {
        const main = source("src/main.cjs")

        assert.match(main, /DeepSeekHarnessRuntimeProvider/)
        assert.match(main, /new DeepSeekHarnessRuntimeProvider\(\)/)
    })

    it("derives curation and evaluation Skills from dataset bindings", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /datasets:bind-skill/)
        assert.match(preload, /bindDatasetSkill/)
        assert.match(main, /const dataset = store\.getDataset\(/)
        assert.match(main, /const skillReference = dataset\.skillReference/)
        assert.doesNotMatch(main, /requireAbsolutePath\(input\.skillPath, "Skill"\)/)
        assert.doesNotMatch(main, /input\.skillReference\?\.name/)
    })

    it("exposes the dataset Rubric lifecycle and freezes it into formal runs", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        const store = source("src/local-store.cjs")
        const runner = source("src/evaluation-runner.cjs")

        for (const channel of [
            "rubrics:list-versions",
            "rubrics:active",
            "rubrics:list-sessions",
            "rubrics:get-session",
            "rubrics:create",
            "rubrics:send",
            "rubrics:retry",
            "rubrics:publish",
            "rubrics:discard",
            "rubrics:update-model",
            "rubrics:update-effort",
            "rubrics:migrate-legacy-contract",
        ]) {
            assert.match(main, new RegExp(channel))
        }
        assert.match(preload, /createRubricSession/)
        assert.match(preload, /publishRubricSession/)
        assert.match(preload, /migrateLegacyDatasetRubric/)
        assert.match(
            main,
            /rubrics:migrate-legacy-contract[\s\S]{0,220}migrateActiveDatasetRubricToUnified\([\s\S]{0,100}requireIdentifier\(datasetId, "dataset"\)/,
        )
        assert.match(preload, /onRubricActivity/)
        assert.match(main, /curation:create[\s\S]*?requirePublishedDatasetRubric\(dataset\)/)
        assert.match(main, /evaluations:start[\s\S]*?requirePublishedDatasetRubric\(dataset\)/)
        assert.match(store, /rubricVersionSnapshot/)
        assert.match(store, /rubricCalibration/)
        assert.match(runner, /rubricVersion:\s*run\.rubricVersionSnapshot/)
    })

    it("exposes Case calibration through the existing Curator lifecycle", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        const store = source("src/local-store.cjs")

        assert.match(main, /curation:create-calibration/)
        assert.match(main, /createCalibrationSession/)
        assert.match(preload, /createCaseCalibration/)
        assert.match(store, /createCaseCalibrationSession/)
        assert.match(store, /calibrationHistory/)
        assert.match(store, /targetCaseId/)
    })

    it("exports a selectable dataset subset and output source as JSON-array CSV", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /datasets:export-csv/)
        assert.match(main, /const cases = store\.listCases\(datasetId\)/)
        assert.match(main, /buildDatasetCsv\(cases,\s*exportOptions\)/)
        assert.match(main, /showSaveDialog/)
        assert.match(preload, /exportDatasetCsv:\s*\(input\)/)
    })

    it("exposes explicit evaluation cancellation separately from record deletion", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /evaluations:cancel[\s\S]{0,180}evaluationRunner\.cancel/)
        assert.match(preload, /cancelEvaluationRun/)
        assert.match(main, /evaluations:delete[\s\S]{0,160}deleteEvaluationRun/)
    })

    it("wires runtime-native archive history through capability-gated IPC", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /runtime:list-threads[\s\S]*archived/)
        assert.match(main, /runtime:archive-thread/)
        assert.match(main, /runtime:unarchive-thread/)
        assert.match(main, /thread-archive/)
        assert.match(main, /message\.method === "thread\/archived"[\s\S]*loadedThreads\.delete/)
        assert.match(main, /message\.method === "error"[\s\S]*willRetry/)
        assert.match(preload, /listThreads:\s*\(archived\s*=\s*false\)/)
        assert.match(preload, /archiveThread/)
        assert.match(preload, /unarchiveThread/)
    })

    it("passes persisted local access to primary and evaluation clients", () => {
        const main = source("src/main.cjs")

        assert.match(main, /resolveExecutionPolicy/)
        assert.match(main, /executionPolicy:\s*currentExecutionPolicy\(\)/)
        assert.match(main, /setExecutionPolicy/)
        assert.match(main, /getExecutionPolicy:\s*currentExecutionPolicy/)
    })

    it("freezes an independently selected Judge runtime, model, and effort into each run", () => {
        const main = source("src/main.cjs")

        assert.match(main, /input\.judgeConfiguration/)
        assert.match(main, /const judgeConfiguration = \{[\s\S]{0,160}\.\.\.judgeDescriptor/)
        assert.match(main, /const judgeConfiguration = \{[\s\S]{0,300}modelId/)
        assert.match(main, /const judgeConfiguration = \{[\s\S]{0,400}effort/)
        assert.match(main, /snapshotSkillEvidence/)
        assert.match(main, /skillEvidence/)
        assert.match(main, /skillEvidenceBinding/)
        assert.match(main, /runtimeId === runtimeDescriptor\?\.runtimeId/)
    })

    it("persists the selected task profile per runtime thread", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /readThreadProfile/)
        assert.match(main, /updateThreadProfiles/)
        assert.match(main, /rollingSkillProfile/)
        assert.match(main, /rememberThreadProfile/)
        assert.match(main, /permissionMode:\s*permission\.permissionMode/)
        assert.match(preload, /permissionMode/)
    })

    it("serializes sends with runtime switching and persists profiles after runtime success", () => {
        const main = source("src/main.cjs")

        assert.match(main, /runtime:start-thread[\s\S]{0,500}enqueueRuntimeOperation/)
        assert.match(main, /runtime:start-turn[\s\S]{0,700}enqueueRuntimeOperation/)
        assert.match(main, /const sourceRuntimeId = sourceRuntime\.runtimeId/)
        assert.match(
            main,
            /sourceRuntime\.providerId === "codex" \|\|\s*sourceRuntime\.providerId === "deepseek-harness"[\s\S]{0,80}\? permission\s*: \{\}/,
        )
        const turnHandler = main.match(/ipcMain\.handle\(\s*"runtime:start-turn"[\s\S]*?ipcMain\.handle\("runtime:interrupt-turn"/)?.[0] ?? ""
        assert.ok(turnHandler.indexOf("runtime.startTurn") < turnHandler.indexOf("rememberThreadProfile"))
    })

    it("relays CodeBuddy permission requests to a local approval dialog", () => {
        const main = source("src/main.cjs")
        const client = source("src/codebuddy-acp-client.cjs")

        assert.match(main, /requestPermission:[\s\S]{0,120}requestRuntimePermission/)
        assert.match(main, /dialog\.showMessageBox/)
        assert.match(main, /clientGeneration/)
        assert.match(main, /sessionId/)
        assert.match(client, /session\/request_permission/)
        assert.match(client, /settlePermissionRequest\(pending,\s*\{outcome:\s*"selected",\s*optionId\}\)/)
        assert.match(client, /cancelPendingPermissionRequests/)
    })

    it("routes DeepSeek Harness questions through generation-scoped renderer IPC", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        const client = source("src/deepseek-harness-client.cjs")

        assert.match(main, /requestQuestion:[\s\S]{0,160}requestRuntimeQuestion/)
        assert.match(main, /runtime:question-requested/)
        assert.match(main, /ipcMain\.handle\(\s*"runtime:respond-question"/)
        assert.match(preload, /onRuntimeQuestion:[\s\S]{0,120}runtime:question-requested/)
        assert.match(preload, /respondRuntimeQuestion:[\s\S]{0,120}runtime:respond-question/)
        assert.match(client, /question\/requested/)
        assert.match(client, /requestQuestion/)
        assert.match(client, /\/api\/respond/)

        const requestStart = main.indexOf("function requestRuntimeQuestion")
        const requestEnd = main.indexOf("\nfunction ", requestStart + 1)
        const requestHandler = main.slice(
            requestStart,
            requestEnd > requestStart ? requestEnd : main.length,
        )
        assert.ok(requestStart >= 0, "requestRuntimeQuestion must own the pending renderer request")
        assert.match(requestHandler, /clientGeneration/)
        assert.match(requestHandler, /processEpoch/)
        assert.match(requestHandler, /runtimeId/)
        assert.match(requestHandler, /sourceClient/)
        assert.match(requestHandler, /rpcId/)

        const responseStart = main.indexOf('ipcMain.handle("runtime:respond-question"')
        const responseEnd = main.indexOf("\nipcMain.handle", responseStart + 1)
        const responseHandler = main.slice(
            responseStart,
            responseEnd > responseStart ? responseEnd : main.length,
        )
        assert.ok(responseStart >= 0, "the question response must return through validated IPC")
        assert.match(responseHandler, /clientGeneration/)
        assert.match(responseHandler, /processEpoch/)
        assert.match(responseHandler, /sourceClient/)
    })

    it("fails closed instead of routing hidden Curator or Rubric questions into Chat", () => {
        const main = source("src/main.cjs")

        assert.match(main, /function isHiddenRuntimeThread\(threadId\)/)
        assert.match(main, /curationManager\?\.hiddenThreadIds\(\)\.has\(threadId\)/)
        assert.match(main, /rubricManager\?\.hiddenThreadIds\(\)\.has\(threadId\)/)
        const questionStart = main.indexOf("function requestRuntimeQuestion")
        const questionEnd = main.indexOf("\nfunction ", questionStart + 1)
        const questionHandler = main.slice(questionStart, questionEnd)
        assert.match(questionHandler, /isHiddenRuntimeThread\(sessionId\)/)
        assert.match(questionHandler, /Promise\.resolve\(null\)/)

        const permissionStart = main.indexOf("function requestRuntimePermission")
        const permissionEnd = main.indexOf("\nfunction ", permissionStart + 1)
        const permissionHandler = main.slice(permissionStart, permissionEnd)
        assert.match(permissionHandler, /isHiddenRuntimeThread\(request\.params\?\.sessionId\)/)
        assert.match(permissionHandler, /Promise\.resolve\(rejectionId\)/)
    })

    it("opens message links only through validated IPC handlers", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /links:open-external/)
        assert.match(main, /requireWebUrl/)
        assert.match(main, /links:open-local/)
        assert.match(main, /requireLocalPath/)
        assert.match(main, /links:open-local[\s\S]{0,400}showItemInFolder/)
        assert.match(preload, /openExternal/)
        assert.match(preload, /openLocalPath/)
        assert.doesNotMatch(preload, /shell\./)
    })

    it("persists compact observed runtime activity and merges it into thread history", () => {
        const main = source("src/main.cjs")

        assert.match(main, /ThreadActivityStore/)
        assert.match(main, /thread-activity-store\.json/)
        assert.match(main, /activityStore\?\.captureNotification\(/)
        assert.match(main, /activityStore\.mergeThreadResponse\(/)
        assert.match(main, /activityStore\?\.flush\(/)
        assert.match(main, /rollingSkillActivityHistory/)
        assert.match(main, /Promise\.allSettled/)
        assert.doesNotMatch(main, /Promise\.all\([\s\S]{0,200}\.then\(\(\) => activityStore\?\.flush/)
    })
})
