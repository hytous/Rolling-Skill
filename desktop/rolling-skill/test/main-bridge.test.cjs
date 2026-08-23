const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const vm = require("node:vm")

const root = join(__dirname, "..")
const source = (path) => readFileSync(join(root, path), "utf8")
const plain = (value) => JSON.parse(JSON.stringify(value))

function preloadBridge(responder) {
    const calls = []
    let exposed = null
    const ipcRenderer = {
        invoke(channel, payload) {
            calls.push(structuredClone({channel, payload}))
            return Promise.resolve(responder(channel, payload, calls.length - 1))
        },
        on() {},
        removeListener() {},
    }
    vm.runInNewContext(source("src/preload.cjs"), {
        require(name) {
            assert.equal(name, "electron")
            return {
                contextBridge: {
                    exposeInMainWorld(name_, value) {
                        assert.equal(name_, "rollingSkill")
                        exposed = value
                    },
                },
                ipcRenderer,
            }
        },
    })
    return {api: exposed, calls}
}

function mainFunctionContext(startName, endName, globals = {}) {
    const main = source("src/main.cjs")
    const start = main.indexOf(`function ${startName}`)
    const functionEnd = main.indexOf(`\nfunction ${endName}`, start + 1)
    const asyncEnd = main.indexOf(`\nasync function ${endName}`, start + 1)
    const end = [functionEnd, asyncEnd]
        .filter((candidate) => candidate > start)
        .sort((left, right) => left - right)[0] ?? -1
    assert.ok(start >= 0 && end > start, `missing main helper slice: ${startName}`)
    const context = {...globals}
    vm.runInNewContext(main.slice(start, end), context)
    return context
}

function rendererFunctionContext(startName, endName, globals = {}) {
    const renderer = source("renderer/renderer.js")
    const start = renderer.indexOf(`function ${startName}`)
    const end = renderer.indexOf(`\nfunction ${endName}`, start + 1)
    assert.ok(start >= 0 && end > start, `missing renderer helper slice: ${startName}`)
    const context = {...globals}
    vm.runInNewContext(renderer.slice(start, end), context)
    return context
}

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
        assert.match(main, /startEvaluationFromControl[\s\S]*?requirePublishedDatasetRubric\(dataset\)/)
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

        assert.match(main, /createDomainServices[\s\S]*?evaluationRunner/)
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
        assert.match(main, /"raw_cases\.list"/)
        assert.match(main, /"raw_cases\.enqueue"/)
        assert.match(main, /"raw_cases\.update"/)
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
        assert.match(main, /"skill_repositories\.list"/)
        assert.match(main, /"skills\.list"/)
        assert.match(main, /skill-repositories:rescan/)
        assert.match(main, /skill-repositories:import/)
        assert.match(main, /skill-repositories:reveal/)
        assert.match(main, /"skills\.get"/)
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

    it("constructs one shared control plane after domain dependencies and closes transport first", () => {
        const main = source("src/main.cjs")

        for (const constructor of [
            "CapabilityStore",
            "ControlPlane",
            "ControlSocketServer",
        ]) {
            assert.equal(
                [...main.matchAll(new RegExp(`new ${constructor}\\(`, "g"))].length,
                1,
                `${constructor} must be constructed exactly once`,
            )
        }
        assert.equal([...main.matchAll(/createControlPolicy\(\)/g)].length, 1)
        assert.equal([...main.matchAll(/createDomainServices\(/g)].length, 1)

        const runnerReady = main.indexOf("evaluationRunner = new EvaluationRunner")
        const domainReady = main.indexOf("initializeControlPlane()", runnerReady)
        const socketStart = main.indexOf("startControlSocket()", domainReady)
        assert.ok(runnerReady >= 0 && domainReady > runnerReady && socketStart > domainReady)

        const shutdownStart = main.indexOf("async function shutdownApplication")
        const shutdownEnd = main.indexOf("\nfunction ", shutdownStart + 1)
        const shutdown = main.slice(
            shutdownStart,
            shutdownEnd > shutdownStart ? shutdownEnd : main.length,
        )
        assert.match(shutdown, /controlInvocationsAccepted\s*=\s*false/)
        assert.ok(
            shutdown.indexOf("await stopControlPlane()") <
                shutdown.indexOf("client?.stop?.()"),
            "control transport must close before runtime clients",
        )
        assert.ok(
            shutdown.indexOf("client?.stop?.()") < shutdown.indexOf("rawCaseStore?.close()"),
            "stores must close after runtime clients",
        )
        assert.match(main, /controlSocketStartPromise/)
        assert.match(main, /controlShutdownPromise/)
    })

    it("keeps renderer capability private, rotates scoped grants, and validates the sender", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /RENDERER_CONTROL_METHODS/)
        for (const method of [
            "raw_cases.list",
            "raw_cases.enqueue",
            "raw_cases.update",
            "runtimes.list",
            "runtimes.models",
            "datasets.list",
            "datasets.get",
            "evaluations.list",
            "evaluations.get",
            "evaluations.start",
            "evaluations.cancel",
            "skill_repositories.list",
            "skills.list",
            "skill_versions.list",
            "skills.get",
        ]) {
            assert.match(main, new RegExp(`"${method.replace(".", "\\.")}"`))
        }
        assert.match(main, /event\?\.sender\s*!==\s*mainWindow\.webContents/)
        assert.match(main, /event\.sender\.isDestroyed\(\)/)
        assert.match(main, /Unknown renderer control method/)
        assert.match(main, /RENDERER_FORBIDDEN_CONTROL_KEYS/)
        assert.match(main, /token[\s\S]{0,120}sessionId[\s\S]{0,120}action[\s\S]{0,120}path[\s\S]{0,120}commit[\s\S]{0,120}usage/)

        const rotationStart = main.indexOf("async function acquireRendererCapability")
        const rotationEnd = main.indexOf("\nfunction isSafeControlRecord", rotationStart + 1)
        const rotation = main.slice(
            rotationStart,
            rotationEnd > rotationStart ? rotationEnd : main.length,
        )
        assert.match(rotation, /scopeSignature/)
        assert.match(rotation, /expiresAt/)
        assert.match(main, /createTrustedCapabilityIssuer/)
        assert.match(rotation, /rendererCapabilityIssuer\.issue/)
        assert.match(rotation, /leases/)
        assert.ok(
            rotation.indexOf("rendererCapabilityIssuer.issue") <
                rotation.indexOf("retireRendererCapability"),
            "rotation must successfully issue a replacement before retiring the old grant",
        )
        assert.match(main, /mainWindow\.on\("closed"[\s\S]{0,180}revokeRendererCapabilities\(\)/)
        assert.doesNotMatch(preload, /capabilit|token/i)
        assert.doesNotMatch(preload, /issueControl|listControl|revokeControl|controlInvoke/)
    })

    it("rejects fake senders and renderer-supplied authority before private invocation", () => {
        const trustedSender = {isDestroyed: () => false}
        const senderContext = mainFunctionContext(
            "assertRendererControlSender",
            "installControlIpc",
            {
                mainWindow: {
                    isDestroyed: () => false,
                    webContents: trustedSender,
                },
            },
        )
        assert.doesNotThrow(() => senderContext.assertRendererControlSender({sender: trustedSender}))
        assert.throws(
            () => senderContext.assertRendererControlSender({
                sender: {isDestroyed: () => false},
            }),
            /not active/u,
        )

        const validation = mainFunctionContext(
            "isSafeControlRecord",
            "rendererControlParams",
            {
                RENDERER_FORBIDDEN_CONTROL_KEYS: new Set([
                    "token",
                    "sessionId",
                    "action",
                    "path",
                    "commit",
                    "usage",
                ]),
            },
        )
        assert.equal(validation.containsForbiddenControlKey({
            method: "datasets.list",
            params: {},
            token: "renderer-supplied",
        }), true)
        assert.equal(validation.containsForbiddenControlKey({
            method: "raw_cases.enqueue",
            params: {cases: [{skill: {name: "billing", path: "/private"}}]},
        }), true)
        assert.equal(validation.containsForbiddenControlKey({
            method: "datasets.list",
            params: {},
        }), false)
    })

    it("leases in-flight grants and preserves the old grant when widened issuance fails", async () => {
        let now = 1_000
        let sequence = 0
        let failIssue = false
        let scopes = {
            skillIds: ["skill-1"],
            datasetIds: [],
            runtimeIds: [],
            repositoryIds: [],
        }
        const lifecycle = []
        const context = mainFunctionContext(
            "revokeRendererCapabilityEntry",
            "isSafeControlRecord",
            {
                Date: {now: () => now},
                Number,
                RENDERER_CAPABILITY_LIFETIME_MS: 3_600_000,
                RENDERER_CAPABILITY_REFRESH_MS: 60_000,
                RENDERER_CONTROL_ACTIONS: ["skills.read"],
                rendererCapabilityIssuer: {
                    issue(request) {
                        if (failIssue) throw new Error("renderer scope is over the private limit")
                        sequence += 1
                        lifecycle.push(["issue", plain(request.scopes)])
                        return {
                            id: `cap-${sequence}`,
                            token: `private-${sequence}`,
                            expiresAt: now + 3_600_000,
                        }
                    },
                },
                capabilityStore: {
                    revokeSession(sessionId) {
                        lifecycle.push(["revoke", sessionId])
                    },
                },
                controlInvocationsAccepted: true,
                currentRendererScopes: () => scopes,
                randomUUID: () => `session-${sequence + 1}`,
                rendererCapability: null,
                rendererCapabilityEntries: new Set(),
                rendererCapabilityEpoch: 0,
                rendererCapabilityRotation: Promise.resolve(),
            },
        )

        const first = await context.acquireRendererCapability()
        const unchanged = await context.acquireRendererCapability()
        assert.equal(unchanged.capabilityId, first.capabilityId)
        assert.deepEqual(lifecycle.map(([operation]) => operation), ["issue"])

        scopes = {
            skillIds: ["skill-1", "skill-2"],
            datasetIds: [],
            runtimeIds: [],
            repositoryIds: [],
        }
        const widened = await context.acquireRendererCapability()
        assert.notEqual(widened.capabilityId, first.capabilityId)
        assert.deepEqual(lifecycle.map(([operation]) => operation), ["issue", "issue"])
        context.releaseRendererCapability(first)
        assert.deepEqual(lifecycle.map(([operation]) => operation), ["issue", "issue"])
        context.releaseRendererCapability(unchanged)
        assert.deepEqual(lifecycle.map(([operation]) => operation), ["issue", "issue", "revoke"])

        failIssue = true
        scopes = {...scopes, skillIds: [...scopes.skillIds, "skill-3"]}
        await assert.rejects(context.acquireRendererCapability(), /private limit/u)
        assert.equal(context.rendererCapability.capabilityId, widened.capabilityId)
        assert.equal(lifecycle.filter(([operation]) => operation === "revoke").length, 1)
        context.releaseRendererCapability(widened)
    })

    it("does not issue a queued renderer grant after its window epoch is revoked", async () => {
        let releaseRotation
        let issues = 0
        const context = mainFunctionContext(
            "revokeRendererCapabilityEntry",
            "isSafeControlRecord",
            {
                Date,
                Number,
                RENDERER_CAPABILITY_LIFETIME_MS: 3_600_000,
                RENDERER_CAPABILITY_REFRESH_MS: 60_000,
                RENDERER_CONTROL_ACTIONS: ["skills.read"],
                capabilityStore: {revokeSession() {}},
                controlInvocationsAccepted: true,
                currentRendererScopes: () => ({
                    skillIds: [],
                    datasetIds: [],
                    runtimeIds: [],
                    repositoryIds: [],
                }),
                randomUUID: () => "queued-session",
                rendererCapability: null,
                rendererCapabilityEntries: new Set(),
                rendererCapabilityEpoch: 0,
                rendererCapabilityIssuer: {
                    issue() {
                        issues += 1
                        return {id: "queued", token: "private", expiresAt: Date.now() + 3_600_000}
                    },
                },
                rendererCapabilityRotation: new Promise((resolve) => {
                    releaseRotation = resolve
                }),
            },
        )

        const pending = context.acquireRendererCapability()
        context.revokeRendererCapabilities()
        releaseRotation()
        await assert.rejects(pending, /window|epoch|unavailable/iu)
        assert.equal(issues, 0)
    })

    it("builds Raw Case scope from trusted local catalogs and adds renderer-only name aliases", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        assert.match(main, /listRawCaseSkills:/)
        assert.match(main, /managedSkillManager\.catalog\(\)/)
        assert.match(main, /store\.listDatasets\(\)/)
        assert.match(main, /activeRuntimeSkillCache/)
        assert.match(main, /rawCaseStore\.list\(\)/)
        assert.match(main, /createHash\("sha256"\)/)
        assert.match(main, /function prepareRendererRawCaseSkillAliases/)
        assert.match(main, /assertRendererControlSender\(event\)[\s\S]*prepareRendererRawCaseSkillAliases/)
        assert.match(main, /prepareRendererRawCaseSkillAliases[\s\S]*ensureRendererCapability/)
        assert.match(main, /candidates\.length === 1[\s\S]*\.id/)
        assert.match(main, /AsyncLocalStorage/)
        assert.match(main, /candidates\.length === 0[\s\S]*aliases\.push/)
        assert.match(main, /candidates\.length > 1[\s\S]*return/)
        assert.doesNotMatch(main, /rendererRawCaseSkillAliases\s*=\s*new Map/)
        assert.match(preload, /input\.skill\?\.id\s*\?\s*\{id:\s*input\.skill\.id\}/)
        assert.doesNotMatch(preload, /skill:\s*\{[^}]*path:/)
    })

    it("keeps source Skill identities distinct and stages unseen renderer aliases transactionally", () => {
        const context = mainFunctionContext(
            "digestSkillIdentity",
            "listModelsForRuntimeFromControl",
            {
                activeRuntimeSkillCache: null,
                clientGeneration: 7,
                createHash,
                managedSkillManager: {catalog: () => ({
                    repositories: [],
                    skills: [{id: "managed-1", name: "shared"}],
                })},
                normalizedSkillName: (value) => String(value ?? "").trim().toLowerCase(),
                rawCaseStore: {list: () => [{skill: {name: "legacy"}}]},
                rendererAliasContext: {getStore: () => null},
                runtimeDescriptor: {runtimeId: "runtime-1", providerId: "codex"},
                store: {listDatasets: () => [{
                    skillReference: {
                        name: "shared",
                        path: "/workspace/dataset/SKILL.md",
                        runtimeId: "runtime-1",
                    },
                }]},
                workspaceRoot: "/workspace",
            },
        )
        context.cachedRuntimeSkills({data: [{skills: [{
            name: "shared",
            path: "/workspace/runtime/SKILL.md",
            enabled: true,
        }]}]})
        const shared = context.trustedRawCaseSkills().skills
            .filter((skill) => skill.name === "shared")
        assert.equal(shared.length, 3)
        assert.equal(new Set(shared.map((skill) => skill.id)).size, 3)

        const input = {
            cases: [{question: "q", skill: {name: "Brand New Skill"}}],
        }
        const staged = context.prepareRendererRawCaseSkillAliases("raw_cases.enqueue", input)
        const stableId = staged.params.cases[0].skill.id
        assert.match(stableId, /^renderer-name-[0-9a-f]{64}$/u)
        assert.deepEqual(plain(staged.aliases), [{id: stableId, name: "Brand New Skill"}])
        assert.equal(
            context.trustedRawCaseSkills().skills.some((skill) => skill.id === stableId),
            false,
        )
        assert.equal(
            context.trustedRawCaseSkills({stagedAliases: staged.aliases}).skills
                .some((skill) => skill.id === stableId),
            true,
        )
        const ambiguous = context.prepareRendererRawCaseSkillAliases(
            "raw_cases.enqueue",
            {cases: [{skill: {name: "shared"}}]},
        )
        assert.equal(ambiguous.params.cases[0].skill.id, undefined)
    })

    it("keys the runtime Skill cache by runtime, workspace, and client generation", () => {
        const context = mainFunctionContext(
            "digestSkillIdentity",
            "listModelsForRuntimeFromControl",
            {
                activeRuntimeSkillCache: null,
                clientGeneration: 2,
                createHash,
                normalizedSkillName: (value) => String(value ?? "").trim().toLowerCase(),
                runtimeDescriptor: {runtimeId: "runtime-1", providerId: "codex"},
                workspaceRoot: "/workspace-one",
            },
        )
        const response = {data: [{skills: [{
            name: "billing",
            path: "/skills/billing/SKILL.md",
            enabled: true,
        }]}]}
        const first = context.cachedRuntimeSkills(response)
        assert.match(first.data[0].skills[0].id, /^runtime-skill-[0-9a-f]{64}$/u)
        assert.equal(context.currentRuntimeCachedSkills().length, 1)

        context.workspaceRoot = "/workspace-two"
        assert.deepEqual(plain(context.currentRuntimeCachedSkills()), [])
        const second = context.cachedRuntimeSkills(response)
        assert.notEqual(second.data[0].skills[0].id, first.data[0].skills[0].id)
        context.clientGeneration += 1
        assert.deepEqual(plain(context.currentRuntimeCachedSkills()), [])

        const main = source("src/main.cjs")
        assert.match(main, /function invalidateRuntimeSkillCache/)
        assert.match(main, /workspaceRoot\s*=\s*selectedWorkspace[\s\S]{0,100}invalidateRuntimeSkillCache\(\)/)
        assert.match(main, /async function restartRuntimeNow[\s\S]{0,120}invalidateRuntimeSkillCache\(\)/)
        assert.match(main, /onChanged:\s*\(job\)[\s\S]{0,160}invalidateRuntimeSkillCache\(\)/)
    })

    it("makes the renderer carry a unique trusted Skill id but refuse same-name guessing", () => {
        const state = {
            datasets: [{skillReference: {
                id: "dataset-skill-1",
                name: "shared",
                path: "/private/dataset",
            }}],
            evaluationSkills: [{
                id: "runtime-skill-1",
                name: "runtime-only",
                path: "/private/runtime",
            }, {
                id: "runtime-skill-2",
                name: "shared",
                path: "/private/other",
            }],
            rawCases: [],
        }
        const context = rendererFunctionContext(
            "rawCaseSkillReference",
            "suggestedRawCaseSkill",
            {state},
        )

        assert.deepEqual(plain(context.rawCaseSkillReference("runtime-only")), {
            id: "runtime-skill-1",
            name: "runtime-only",
        })
        assert.deepEqual(plain(context.rawCaseSkillReference("shared")), {name: "shared"})
        assert.doesNotMatch(JSON.stringify(context.rawCaseSkillReference("runtime-only")), /private/u)
    })

    it("returns service diagnostics only through the private renderer bridge", async () => {
        const messages = [
            "Bind an enabled Skill to this dataset before continuing",
            "The selected Skill is not installed and enabled in the active runtime and workspace",
            "Formal evaluation requires a published Rubric",
        ]
        const safeErrors = messages.map(() =>
            Object.assign(new Error("Control operation failed"), {code: "CONTROL_ERROR"}))
        let invocation = 0
        const trustedSender = {isDestroyed: () => false}
        let released = 0
        const context = mainFunctionContext(
            "publicControlResponse",
            "installControlIpc",
            {
                RENDERER_CONTROL_METHODS: new Set(["evaluations.start"]),
                acquireRendererCapability: async () => ({
                    token: "private-main-token",
                    sessionId: "renderer-1",
                }),
                assert: undefined,
                containsForbiddenControlKey: () => false,
                controlInvocationsAccepted: true,
                controlPlane: {invoke: async () => { throw safeErrors[invocation++] }},
                isSafeControlRecord: (value) => Boolean(value) && typeof value === "object",
                mainWindow: {
                    isDestroyed: () => false,
                    webContents: trustedSender,
                },
                prepareRendererRawCaseSkillAliases: (_method, params) => ({params, aliases: []}),
                publicControlError: () => ({
                    code: "CONTROL_ERROR",
                    message: "Control operation failed",
                    retryable: false,
                    details: null,
                }),
                releaseRendererCapability: () => { released += 1 },
                rendererAliasContext: {run: (_value, operation) => operation()},
                rendererControlParams: (_method, params) => params,
                rendererServiceErrorDiagnostics: {
                    consume: (error) => {
                        const index = safeErrors.indexOf(error)
                        return index >= 0 ? {message: messages[index]} : null
                    },
                },
            },
        )
        for (const message of messages) {
            const response = await context.invokeRendererControl(
                {sender: trustedSender},
                {method: "evaluations.start", params: {}},
            )
            assert.equal(response.error.message, message)
            assert.equal(response.error.code, "CONTROL_ERROR")
        }
        assert.equal(released, messages.length)
    })

    it("starts a credential-free socket and leaves a bounded diagnostic on start failure", () => {
        const main = source("src/main.cjs")
        const start = main.indexOf("function startControlSocket")
        const end = main.indexOf("\nfunction ", start + 1)
        const lifecycle = main.slice(start, end > start ? end : main.length)

        assert.match(lifecycle, /controlSocketServer\.start\(\)/)
        assert.doesNotMatch(lifecycle, /capabilityStore\.issue|\.token|socketPath/)
        assert.match(lifecycle, /controlSocketStartupDiagnostic/)
        assert.match(main, /Desktop actions remain available/)
        assert.doesNotMatch(main, /console\.(?:log|error)\([^\n]*(?:token|socketPath)/)
    })

    it("maps every migrated preload call through control:invoke without exposing credentials", async () => {
        const pageCounts = new Map()
        const {api, calls} = preloadBridge((_channel, envelope) => {
            const count = pageCounts.get(envelope.method) ?? 0
            pageCounts.set(envelope.method, count + 1)
            switch (envelope.method) {
                case "raw_cases.list":
                    return count === 0
                        ? {rawCases: [{id: "raw-1"}], nextCursor: "next-raw"}
                        : {rawCases: [{id: "raw-2"}], nextCursor: null}
                case "raw_cases.enqueue":
                    return {created: [{id: "raw-3"}], duplicates: [], rejected: []}
                case "raw_cases.update": return {rawCase: {id: "raw-1", revision: 2}}
                case "runtimes.list": return {runtimes: [{runtimeId: "runtime-1"}]}
                case "runtimes.models": return {models: [{id: "model-1"}]}
                case "datasets.list":
                    return count === 0
                        ? {datasets: [{id: "dataset-1"}], nextCursor: "next-dataset"}
                        : {datasets: [{id: "dataset-2"}], nextCursor: null}
                case "datasets.get": return {dataset: {id: "dataset-1"}, cases: [{id: "case-1"}]}
                case "evaluations.list": return {runs: [{id: "run-1"}], nextCursor: null}
                case "evaluations.get": return {run: {id: "run-1", status: "running"}}
                case "evaluations.start": return {run: {id: "run-2", status: "queued"}}
                case "evaluations.cancel": return {run: {id: "run-1", status: "cancelled"}}
                case "skill_repositories.list": return count === 0
                    ? {
                          repositories: [{id: "repository-1"}],
                          nextCursor: "next-repository",
                      }
                    : {
                          repositories: [{id: "repository-2"}, {id: "repository-empty"}],
                          nextCursor: null,
                      }
                case "skills.list": return count === 0
                    ? {
                          repositories: [{id: "repository-1"}],
                          skills: [{
                              id: "skill-1",
                              repositoryId: "repository-1",
                              skillRoot: "billing",
                              description: "Billing Skill",
                              warnings: [],
                              updatedAt: "2026-08-21T00:00:00.000Z",
                          }],
                          nextCursor: "next-skill",
                      }
                    : {
                          repositories: [{id: "repository-2"}],
                          skills: [{id: "skill-2", repositoryId: "repository-2"}],
                          nextCursor: null,
                      }
                case "skill_versions.list": {
                    if (envelope.params.skillId) {
                        return count === 2
                            ? {
                                  versions: [{id: "version-detail-1", skillId: "skill-1"}],
                                  nextCursor: "next-detail-version",
                              }
                            : {
                                  versions: [{id: "version-detail-2", skillId: "skill-1"}],
                                  nextCursor: null,
                              }
                    }
                    return count === 0
                        ? {
                              versions: [{id: "version-1", skillId: "skill-1"}],
                              nextCursor: "next-version",
                          }
                        : {
                              versions: [{id: "version-2", skillId: "skill-2"}],
                              nextCursor: null,
                          }
                }
                case "skills.get": return {skill: {
                    repository: {id: "repository-1"},
                    skill: {id: "skill-1"},
                    manifest: "---\nname: billing\n---\n",
                    snapshot: {digest: "sha256:test"},
                }}
                default: throw new Error(`Unexpected method: ${envelope.method}`)
            }
        })

        assert.deepEqual(plain(await api.listRawCases()), [{id: "raw-1"}, {id: "raw-2"}])
        assert.deepEqual(
            plain(await api.addRawCases([{
                question: "q",
                skill: {id: "skill-billing", name: "billing", path: "/private"},
            }])),
            {created: [{id: "raw-3"}], duplicates: [], rejected: []},
        )
        assert.deepEqual(plain(await api.updateRawCase("raw-1", {note: "updated"})), {
            id: "raw-1",
            revision: 2,
        })
        assert.deepEqual(plain(await api.listRuntimes()), [{runtimeId: "runtime-1"}])
        assert.deepEqual(plain(await api.listModels()), {data: [{id: "model-1"}], nextCursor: null})
        assert.deepEqual(
            plain(await api.listModelsForRuntime("runtime-1")),
            {data: [{id: "model-1"}], nextCursor: null},
        )
        assert.deepEqual(plain(await api.listDatasets()), [{id: "dataset-1"}, {id: "dataset-2"}])
        assert.deepEqual(plain(await api.listCases("dataset-1")), [{id: "case-1"}])
        assert.deepEqual(plain(await api.listEvaluationRuns()), [{id: "run-1"}])
        assert.deepEqual(plain(await api.getEvaluationRun("run-1")), {id: "run-1", status: "running"})
        assert.deepEqual(plain(await api.startEvaluationRun({datasetId: "dataset-1"})), {
            id: "run-2",
            status: "queued",
        })
        assert.deepEqual(plain(await api.cancelEvaluationRun("run-1")), {
            id: "run-1",
            status: "cancelled",
        })
        assert.deepEqual(plain(await api.listManagedSkills()), {
            repositories: [
                {id: "repository-1"},
                {id: "repository-2"},
                {id: "repository-empty"},
            ],
            skills: [
                {
                    id: "skill-1",
                    repositoryId: "repository-1",
                    skillRoot: "billing",
                    description: "Billing Skill",
                    warnings: [],
                    updatedAt: "2026-08-21T00:00:00.000Z",
                },
                {id: "skill-2", repositoryId: "repository-2"},
            ],
            versions: [
                {id: "version-1", skillId: "skill-1"},
                {id: "version-2", skillId: "skill-2"},
            ],
        })
        assert.deepEqual(plain(await api.readManagedSkill("skill-1")), {
            repository: {id: "repository-1"},
            skill: {id: "skill-1"},
            manifest: "---\nname: billing\n---\n",
            snapshot: {digest: "sha256:test"},
            versions: [
                {id: "version-detail-1", skillId: "skill-1"},
                {id: "version-detail-2", skillId: "skill-1"},
            ],
        })

        assert.ok(calls.length > 0)
        for (const call of calls) {
            assert.equal(call.channel, "control:invoke")
            assert.deepEqual(Object.keys(call.payload).sort(), ["method", "params"])
            assert.doesNotMatch(JSON.stringify(call), /token|sessionId|action|commit|usage/)
            assert.doesNotMatch(JSON.stringify(call.payload.params), /private/)
        }
        const enqueue = calls.find((call) => call.payload.method === "raw_cases.enqueue")
        assert.deepEqual(enqueue.payload.params.cases[0].skill, {
            id: "skill-billing",
            name: "billing",
        })
        assert.equal(typeof api.deleteRawCase, "function")
        assert.equal(typeof api.deleteEvaluationRun, "function")
        assert.equal(typeof api.rescanManagedSkills, "function")
        assert.equal(typeof api.createRubricSession, "function")
        assert.equal(typeof api.createCuration, "function")
        assert.equal(typeof api.startSkillInstallations, "function")
    })

    it("bounds preload pagination and fails fast on a repeated cursor", async () => {
        let repeatedCalls = 0
        const repeated = preloadBridge((_channel, envelope) => {
            assert.equal(envelope.method, "datasets.list")
            repeatedCalls += 1
            return {datasets: [{id: `dataset-${repeatedCalls}`}], nextCursor: "same-cursor"}
        })
        await assert.rejects(repeated.api.listDatasets(), /pagination.*cursor/iu)
        assert.equal(repeatedCalls, 2)

        const oversized = preloadBridge((_channel, envelope) => {
            assert.equal(envelope.method, "raw_cases.list")
            return {
                rawCases: Array.from({length: 100_001}, (_, index) => ({id: `raw-${index}`})),
                nextCursor: null,
            }
        })
        await assert.rejects(oversized.api.listRawCases(), /pagination.*item/iu)

        const preload = source("src/preload.cjs")
        assert.match(preload, /CONTROL_MAX_PAGES/)
        assert.match(preload, /CONTROL_MAX_ITEMS/)
    })

    it("preserves bounded actionable evaluation errors in the preload API", async () => {
        const {api} = preloadBridge(() => ({
            __rollingSkillControl: true,
            ok: false,
            error: {
                code: "CONTROL_ERROR",
                message: "The selected Skill is not installed in the active runtime",
                retryable: false,
                details: null,
            },
        }))

        await assert.rejects(
            api.startEvaluationRun({datasetId: "dataset-1"}),
            /selected Skill is not installed/u,
        )
    })

    it("removes migrated legacy IPC handlers while retaining non-contract surfaces", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        for (const channel of [
            "raw-cases:list",
            "raw-cases:add",
            "raw-cases:update",
            "models:list",
            "models:list-for-runtime",
            "datasets:list",
            "datasets:list-cases",
            "evaluations:list",
            "evaluations:get",
            "evaluations:start",
            "evaluations:cancel",
            "skill-repositories:list",
            "managed-skills:read",
        ]) {
            assert.doesNotMatch(main, new RegExp(`ipcMain\\.handle\\("${channel}`))
            assert.doesNotMatch(preload, new RegExp(`ipcRenderer\\.invoke\\("${channel}`))
        }
        for (const channel of [
            "raw-cases:delete",
            "raw-cases:mark-dispatched",
            "datasets:create",
            "datasets:delete",
            "evaluations:delete",
            "curation:create",
            "rubrics:create",
            "skill-installations:start",
        ]) {
            assert.match(main, new RegExp(channel))
            assert.match(preload, new RegExp(channel))
        }
    })
})
