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

    it("bridges the independent Raw Case inbox and watches external appends", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /new RawCaseStore\(/)
        assert.match(main, /rawCaseStore\.subscribe/)
        assert.match(main, /send\("raw-cases:changed"/)
        assert.match(main, /raw-cases:list/)
        assert.match(main, /raw-cases:add/)
        assert.match(main, /raw-cases:update/)
        assert.match(main, /raw-cases:delete/)
        assert.match(main, /raw-cases:mark-dispatched/)
        assert.match(preload, /listRawCases/)
        assert.match(preload, /addRawCases/)
        assert.match(preload, /markRawCaseDispatched/)
        assert.match(preload, /onRawCasesChanged/)
    })

    it("keeps managed Skill repository paths and mutations in the main process", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /ManagedSkillStore/)
        assert.match(main, /ManagedSkillManager/)
        assert.match(main, /skill-registry\.json/)
        assert.match(main, /applicationSupportDirectory:\s*app\.getPath\("userData"\)/)
        assert.match(main, /managedSkills:\s*managedSkillManager\.overview\(\)/)
        assert.match(main, /skill-repositories:list/)
        assert.match(main, /skill-repositories:rescan/)
        assert.match(main, /skill-repositories:import/)
        assert.match(main, /skill-repositories:reveal/)
        assert.match(main, /managed-skills:read/)
        assert.match(main, /skill-versions:create-candidate/)
        assert.match(main, /skill-versions:release/)
        assert.match(main, /skill-versions:deprecate/)
        assert.match(main, /dialog\.showOpenDialog/)
        assert.match(main, /managed-skills:changed/)
        assert.match(main, /requireGitSourceLocation/)
        assert.match(main, /\.corrupt-/)
        assert.match(main, /managedSkillStartupError/)
        assert.doesNotMatch(preload, /destinationPath|repositoriesRoot|managedPath/)

        assert.match(preload, /listManagedSkills/)
        assert.match(preload, /rescanManagedSkills/)
        assert.match(preload, /importManagedSkill/)
        assert.match(preload, /readManagedSkill/)
        assert.match(preload, /createManagedSkillCandidate/)
        assert.match(preload, /releaseManagedSkillVersion/)
        assert.match(preload, /deprecateManagedSkillVersion/)
        assert.match(preload, /revealManagedSkillRepository/)
        assert.match(preload, /onManagedSkillsChanged/)
    })

    it("bridges Runtime-driven Skill installation jobs without accepting target paths", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /SkillInstallationStore/)
        assert.match(main, /SkillInstallationManager/)
        assert.match(main, /skill-installations\.json/)
        assert.match(main, /skillInstallations:\s*skillInstallationManager\.overview\(\)/)
        for (const channel of [
            "skill-installations:list",
            "skill-installations:get",
            "skill-installations:start",
            "skill-installations:cancel",
            "skill-installations:inspect",
            "skill-installations:send",
            "skill-installations:respond-question",
        ]) {
            assert.match(main, new RegExp(channel))
        }
        assert.match(main, /send\("skill-installations:changed"/)
        assert.match(main, /send\("skill-installations:question-requested"/)
        assert.match(main, /send\("skill-versions:released"/)
        assert.match(main, /skillInstallationManager\?\.stopAll/)
        const startIndex = main.indexOf('ipcMain.handle("skill-installations:start"')
        const cancelIndex = main.indexOf('ipcMain.handle("skill-installations:cancel"', startIndex)
        const startHandler = main.slice(startIndex, cancelIndex)
        assert.ok(startIndex >= 0 && cancelIndex > startIndex)
        assert.match(startHandler, /skillId:/)
        assert.match(startHandler, /versionId:/)
        assert.match(startHandler, /targets/)
        assert.doesNotMatch(startHandler, /destination|managedPath|repositoryPath|commit/)

        assert.match(preload, /listSkillInstallations/)
        assert.match(preload, /getSkillInstallation/)
        assert.match(preload, /startSkillInstallations/)
        assert.match(preload, /cancelSkillInstallation/)
        assert.match(preload, /inspectSkillInstallation/)
        assert.match(preload, /sendSkillInstallationMessage/)
        assert.match(preload, /respondSkillInstallationQuestion/)
        assert.match(preload, /onSkillInstallationsChanged/)
        assert.match(preload, /onSkillInstallationQuestion/)
        assert.match(preload, /onManagedSkillVersionReleased/)
        assert.doesNotMatch(preload, /installSkill.*destination|installSkill.*managedPath/)
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

    it("routes high-frequency notifications only to the observed Chat thread", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /RuntimeNotificationRouter/)
        assert.match(main, /new RuntimeNotificationRouter\(\)/)
        const notificationStart = main.indexOf('nextClient.on("notification"')
        const notificationEnd = main.indexOf('nextClient.on("runtimeError"', notificationStart)
        const notificationHandler = main.slice(notificationStart, notificationEnd)
        assert.ok(notificationStart >= 0, "runtime notification handler must exist")
        assert.ok(
            notificationHandler.indexOf("activityStore?.captureNotification") <
                notificationHandler.indexOf("runtimeNotificationRouter.route"),
            "evidence capture must happen before renderer routing",
        )
        assert.match(
            notificationHandler,
            /runtimeNotificationRouter\.route\(message\)\.forward[\s\S]{0,120}send\("runtime:notification", message\)/,
        )

        const readStart = main.indexOf('ipcMain.handle("runtime:read-thread"')
        const readEnd = main.indexOf('\nipcMain.handle', readStart + 1)
        const readHandler = main.slice(readStart, readEnd)
        assert.match(readHandler, /beginObservation\(threadId\)[\s\S]*runtime\.readThread\(threadId\)/)
        assert.match(readHandler, /snapshotReady\(observationEpoch\)/)
        assert.match(readHandler, /rollingSkillObservationEpoch:\s*observationEpoch/)
        assert.match(main, /runtime:drain-observation/)
        assert.match(main, /runtime:clear-observation/)
        assert.match(preload, /drainThreadObservation:[\s\S]{0,120}runtime:drain-observation/)
        assert.match(preload, /clearThreadObservation:[\s\S]{0,120}runtime:clear-observation/)
    })
})
