const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {
    closeSync,
    constants: fsConstants,
    fstatSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {basename, isAbsolute, join, relative, resolve, sep} = require("node:path")
const {describe, it} = require("node:test")
const vm = require("node:vm")

const {runtimeReportsSkill} = require("../src/evaluation-skill-binding.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")
const {
    CapabilityStore,
    createTrustedHumanCapabilityIssuer,
    isTrustedHumanCapability,
} = require("../src/control-plane/capability-store.cjs")
const {publicOperatorSummaryPage} = require("../src/operator/public-summary.cjs")

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
    const functionStart = main.indexOf(`function ${startName}`)
    const asyncStart = main.indexOf(`async function ${startName}`)
    const start = [functionStart, asyncStart]
        .filter((candidate) => candidate >= 0)
        .sort((left, right) => left - right)[0] ?? -1
    const functionEnd = main.indexOf(`\nfunction ${endName}`, start + 1)
    const asyncEnd = main.indexOf(`\nasync function ${endName}`, start + 1)
    const end = [functionEnd, asyncEnd]
        .filter((candidate) => candidate > start)
        .sort((left, right) => left - right)[0] ?? -1
    assert.ok(start >= 0 && end > start, `missing main helper slice: ${startName}`)
    const context = {
        closeSync,
        fsConstants,
        fstatSync,
        isAbsolute,
        lstatSync,
        openSync,
        realpathSync,
        relative,
        resolve,
        sep,
        ...globals,
    }
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
    it("keeps a temporary Runtime alive until its model catalog request settles", async () => {
        let resolveModels
        const calls = []
        const models = new Promise((resolve) => { resolveModels = resolve })
        const temporaryClient = {
            async start() { calls.push("start") },
            listModels() {
                calls.push("listModels")
                return models
            },
            async stop() { calls.push("stop") },
        }
        const context = mainFunctionContext(
            "listModelsForRuntimeFromControl",
            "controlScopeIds",
            {
                app: {getPath: () => "/tmp/rolling-skill-test"},
                availableRuntimes: [{runtimeId: "runtime-secondary"}],
                currentExecutionPolicy: () => ({}),
                join,
                requireIdentifier: (value) => String(value),
                runtimeDescriptor: {runtimeId: "runtime-active"},
                runtimeRegistry: {createClient: () => temporaryClient},
                workspaceRoot: "/workspace/project",
            },
        )

        const pending = context.listModelsForRuntimeFromControl("runtime-secondary")
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(calls, ["start", "listModels"])
        resolveModels({data: [{id: "model-1"}]})
        assert.deepEqual(plain(await pending), {data: [{id: "model-1"}]})
        assert.deepEqual(calls, ["start", "listModels", "stop"])
    })

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

    it("exposes Case refresh and keeps its internal Runtime task hidden", async () => {
        const main = source("src/main.cjs")
        const {api, calls} = preloadBridge(() => ({operation: "refresh"}))

        const result = await api.createCaseRefresh({datasetId: "dataset-1", caseId: "case-1"})

        assert.equal(result.operation, "refresh")
        assert.deepEqual(plain(calls), [{
            channel: "cases:refresh",
            payload: {datasetId: "dataset-1", caseId: "case-1"},
        }])
        assert.match(main, /new CaseRefreshManager\(/u)
        assert.match(main, /cases:refresh/u)
        assert.match(main, /caseRefreshManager\.createSession/u)
        assert.match(main, /caseRefreshManager\?\.hiddenThreadIds\(\)\.has\(threadId\)/u)
        assert.match(
            main,
            /runtime:list-threads[\s\S]*?caseRefreshManager\.hiddenThreadIds\(\)/u,
        )
        assert.match(
            main,
            /runtime:read-thread[\s\S]*?isHiddenRuntimeThread\(threadId\)/u,
        )
    })

    it("routes optional delete recovery through the Case recycle service", async () => {
        const main = source("src/main.cjs")
        const {api, calls} = preloadBridge(() => ({deleted: true}))

        await api.deleteCase("dataset-1", "case-1", false)
        await api.deleteDataset("dataset-1", true)

        assert.deepEqual(plain(calls), [
            {
                channel: "datasets:delete-case",
                payload: {datasetId: "dataset-1", caseId: "case-1", recoverQuestions: false},
            },
            {
                channel: "datasets:delete",
                payload: {datasetId: "dataset-1", recoverQuestions: true},
            },
        ])
        assert.match(main, /new CaseRecycleService\(\{store, rawCaseStore\}\)/u)
        assert.match(main, /caseRecycleService\.deleteCase/u)
        assert.match(main, /caseRecycleService\.deleteDataset/u)
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

    it("bridges scheduled capture status and manual Draft creation without exposing scan cursors", async () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")
        const {api, calls} = preloadBridge((channel) => (
            channel === "automatic-capture:status"
                ? {mode: "scheduled", running: false}
                : {id: "session-1"}
        ))

        await api.createCurationFromRawCase("raw-1", "dataset-1")
        const status = await api.getAutomaticCaptureStatus()

        assert.deepEqual(plain(calls), [
            {
                channel: "curation:create-from-raw-case",
                payload: {rawCaseId: "raw-1", datasetId: "dataset-1"},
            },
            {channel: "automatic-capture:status"},
        ])
        assert.deepEqual(plain(status), {mode: "scheduled", running: false})
        assert.match(preload, /onAutomaticCaptureStatus/)
        assert.doesNotMatch(preload, /lastInspectedUserItemId|pendingStartUserItemId|checkedRanges/)
        assert.match(
            main,
            /new AutomaticCaptureStateStore\(join\([\s\S]{0,80}app\.getPath\("userData"\)/u,
        )
        assert.match(main, /curation:create-from-raw-case/u)
        assert.match(main, /automatic-capture:status/u)
        assert.match(main, /source\.runtimeId[\s\S]{0,180}runtimeDescriptor\?\.runtimeId/u)
        assert.match(main, /automaticCaptureManager\.start\(\)/u)
        assert.match(main, /automaticCaptureManager\?\.stop\(\)/u)
        assert.match(main, /settings:update[\s\S]{0,240}automaticCaptureManager\?\.reschedule\(\)/u)
        assert.match(main, /restartRuntimeNow[\s\S]{0,900}automaticCaptureManager\?\.reschedule\(\)/u)
        assert.match(main, /onChanged:[\s\S]{0,220}handleCurationChanged/u)
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

    it("resolves an enabled managed Skill to its trusted repository root", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-workspace-"))
        try {
            const repositoryRoot = join(directory, "repository")
            mkdirSync(join(repositoryRoot, "skills", "billing"), {recursive: true})
            writeFileSync(join(repositoryRoot, "skills", "billing", "SKILL.md"), "# Billing\n")
            const outsideRoot = join(directory, "outside")
            mkdirSync(outsideRoot)
            writeFileSync(join(outsideRoot, "SKILL.md"), "# Outside\n")
            symlinkSync(outsideRoot, join(repositoryRoot, "skills", "escaped"))
            const alias = join(directory, "repository-alias")
            symlinkSync(repositoryRoot, alias)
            const manager = {
                catalog: () => ({
                    repositories: [{id: "repository-1"}],
                    skills: [{
                        id: "skill-1",
                        repositoryId: "repository-1",
                        name: "billing",
                        skillRoot: "skills/billing",
                        manifestPath: "skills/billing/SKILL.md",
                        status: "valid",
                    }, {
                        id: "skill-disabled",
                        repositoryId: "repository-1",
                        name: "disabled",
                        skillRoot: "skills/disabled",
                        status: "invalid",
                    }, {
                        id: "skill-escaped",
                        repositoryId: "repository-1",
                        name: "escaped",
                        skillRoot: "skills/escaped",
                        manifestPath: "skills/escaped/SKILL.md",
                        status: "valid",
                    }],
                }),
                repositoryPath: (repositoryId) => {
                    assert.equal(repositoryId, "repository-1")
                    return alias
                },
            }
            const context = mainFunctionContext(
                "digestSkillIdentity",
                "currentRendererScopes",
                {
                    closeSync,
                    fsConstants,
                    fstatSync,
                    isAbsolute,
                    lstatSync,
                    managedSkillManager: manager,
                    openSync,
                    realpathSync,
                    relative,
                    requireIdentifier: (value, label) => {
                        const normalized = String(value ?? "").trim()
                        if (!normalized) throw new Error(`${label} is required`)
                        return normalized
                    },
                    runtimeDescriptor: {runtimeId: "codex:managed", providerId: "codex"},
                    currentRuntimeSkillReference: async (reference) => {
                        assert.equal(reference.name, "billing")
                        assert.equal(reference.path, realpathSync(join(
                            repositoryRoot,
                            "skills",
                            "billing",
                            "SKILL.md",
                        )))
                        return reference
                    },
                    resolve,
                    sep,
                },
            )

            assert.deepEqual(plain(await context.resolveManagedSkillBinding({
                repositoryId: "repository-1",
                skillId: "skill-1",
            })), {
                repositoryId: "repository-1",
                skillId: "skill-1",
                name: "billing",
                skillPath: realpathSync(join(repositoryRoot, "skills", "billing", "SKILL.md")),
                providerId: "codex",
                runtimeId: "codex:managed",
                workspaceRoot: realpathSync(repositoryRoot),
            })
            assert.deepEqual(plain(await context.resolveManagedSkillWorkspace({
                repositoryId: "repository-1",
                skillId: "skill-1",
            })), {
                repositoryId: "repository-1",
                skillId: "skill-1",
                workspaceRoot: realpathSync(repositoryRoot),
            })
            await assert.rejects(
                context.resolveManagedSkillWorkspace({
                    repositoryId: "repository-other",
                    skillId: "skill-1",
                }),
                /repository|managed Skill/iu,
            )
            await assert.rejects(
                context.resolveManagedSkillWorkspace({
                    repositoryId: "repository-1",
                    skillId: "skill-disabled",
                }),
                /enabled|valid/iu,
            )
            await assert.rejects(
                context.resolveManagedSkillBinding({
                    repositoryId: "repository-1",
                    skillId: "skill-escaped",
                }),
                /outside.*repository|managed.*outside/iu,
            )
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it("maps a trusted managed Dataset binding and Runtime discovery to the same stable Skill id", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-managed-identity-"))
        try {
            const repositoryRoot = join(directory, "repository")
            const manifestPath = join(repositoryRoot, "skills", "billing", "SKILL.md")
            mkdirSync(join(repositoryRoot, "skills", "billing"), {recursive: true})
            writeFileSync(manifestPath, "# Billing\n")
            const managedSkillManager = {
                catalog: () => ({
                    repositories: [{id: "repository-1"}],
                    skills: [{
                        id: "skill-1",
                        repositoryId: "repository-1",
                        name: "billing",
                        skillRoot: "skills/billing",
                        manifestPath: "skills/billing/SKILL.md",
                        status: "valid",
                    }],
                }),
                repositoryPath: () => repositoryRoot,
            }
            const context = mainFunctionContext(
                "digestSkillIdentity",
                "listModelsForRuntimeFromControl",
                {
                    activeRuntimeSkillCache: null,
                    canonicalSkillPath: undefined,
                    clientGeneration: 1,
                    closeSync,
                    createHash,
                    fsConstants,
                    fstatSync,
                    isAbsolute,
                    lstatSync,
                    managedSkillManager,
                    normalizedSkillName: (value) => String(value ?? "").trim().toLowerCase(),
                    openSync,
                    rawCaseStore: {list: () => []},
                    realpathSync,
                    relative,
                    requireIdentifier: (value, label) => {
                        const normalized = String(value ?? "").trim()
                        if (!normalized) throw new Error(`${label} is required`)
                        return normalized
                    },
                    rendererAliasContext: {getStore: () => null},
                    resolve,
                    runtimeDescriptor: {runtimeId: "codex:managed", providerId: "codex"},
                    sep,
                    store: {listDatasets: () => [{
                        id: "dataset-1",
                        skillReference: {
                            id: "skill-1",
                            name: "billing",
                            path: manifestPath,
                            providerId: "codex",
                            runtimeId: "codex:managed",
                            repositoryId: "repository-1",
                        },
                    }]},
                    workspaceRoot: repositoryRoot,
                },
            )
            const response = context.cachedRuntimeSkills({data: [{skills: [{
                name: "billing",
                path: manifestPath,
                enabled: true,
            }]}]})

            assert.equal(response.data[0].skills[0].id, "skill-1")
            assert.equal(context.listDatasetsForControl()[0].skillReference.id, "skill-1")
            assert.equal(context.trustedRawCaseSkills().skills.filter((skill) => (
                skill.id === "skill-1" && skill.name === "billing"
            )).length, 1)
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
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
        const shutdown = main.slice(main.indexOf("async function shutdownApplication"))
        assert.match(shutdown, /await stage\("activity store flush"/)
        assert.ok(shutdown.indexOf("client?.stop") < shutdown.indexOf("activityStore?.flush"))
        assert.doesNotMatch(shutdown, /Promise\.all(?:Settled)?/)
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

    it("constructs one shared control plane after domain dependencies and closes it after runtimes", () => {
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
        const domainReady = main.indexOf("initializeOperatorRuntime()", runnerReady)
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
            shutdown.indexOf("client?.stop") < shutdown.indexOf("stopControlPlane()"),
            "the shared control transport must close after Operator, child and Chat runtimes",
        )
        assert.ok(
            shutdown.indexOf("client?.stop?.()") < shutdown.indexOf("rawCaseStore?.close()"),
            "stores must close after runtime clients",
        )
        assert.match(main, /controlSocketStartPromise/)
        assert.match(main, /controlShutdownPromise/)
    })

    it("wires Optimization lifecycle behind typed Renderer controls and recovers before window creation", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        for (const constructor of [
            "OptimizationStore",
            "OptimizationWorkspaceManager",
            "OptimizationOperatorGateway",
            "OptimizationRunner",
            "OptimizationControlService",
        ]) {
            assert.equal(
                [...main.matchAll(new RegExp(`new ${constructor}\\(`, "g"))].length,
                1,
                `${constructor} must be constructed exactly once`,
            )
        }
        for (const action of [
            "optimizations.read",
            "optimizations.execute",
            "optimizations.control",
        ]) assert.match(main, new RegExp(`"${action.replace(".", "\\.")}"`))
        for (const method of [
            "optimization.preflight",
            "optimization.start",
            "optimization.get",
            "optimization.pause",
            "optimization.resume",
            "optimization.stop",
            "optimization.report",
        ]) assert.match(main, new RegExp(`"${method.replace(".", "\\.")}"`))
        assert.doesNotMatch(
            main.slice(main.indexOf("const RENDERER_CONTROL_METHODS"), main.indexOf("const RENDERER_CONTROL_MUTATIONS")),
            /optimization\.submit_(?:candidate|decision)/u,
        )

        for (const method of [
            "preflightOptimization",
            "startOptimization",
            "getOptimizationRun",
            "pauseOptimization",
            "resumeOptimization",
            "stopOptimization",
            "getOptimizationReport",
        ]) assert.match(preload, new RegExp(`${method}:`))
        assert.doesNotMatch(preload, /submitOptimizationCandidate|submitOptimizationDecision/u)

        const preflightResolver = main.slice(
            main.indexOf("async function resolveOptimizationPreflight"),
            main.indexOf("\nfunction optimizationRuntimeConfiguration"),
        )
        assert.match(preflightResolver, /assertOptimizationTelemetrySupport\(config, runtimes\)/u)
        assert.doesNotMatch(preflightResolver, /config\.telemetry\.(?:tokens|cost)/u)

        const resolver = main.slice(
            main.indexOf("async function resolveManagedSkillWorkspace"),
            main.indexOf("\nfunction currentRendererScopes"),
        )
        assert.match(resolver, /optimizationRunId/u)
        assert.match(resolver, /optimizationWorkspaceManager\.get/u)
        assert.doesNotMatch(resolver, /binding\.workspaceRoot|binding\.workspacePath/u)

        const optimizationInitialization = main.slice(
            main.indexOf("function initializeOptimizationRuntime"),
            main.indexOf("\nfunction startControlSocket"),
        )
        assert.match(optimizationInitialization, /getArtifact\(artifactId\)/u)
        assert.match(optimizationInitialization, /artifact\.byteLength\s*>\s*maximumBytes/u)
        assert.ok(
            optimizationInitialization.indexOf("getArtifact(artifactId)") <
                optimizationInitialization.indexOf("readArtifactBody(artifactId)"),
            "Optimization Artifact size must be checked before its body is read",
        )

        const startup = main.slice(main.indexOf("app.whenReady().then"))
        assert.ok(
            startup.indexOf("initializeOperatorRuntime()") < startup.indexOf("initializeOptimizationRuntime()"),
        )
        assert.ok(
            startup.indexOf("optimizationControlService.recoverStartup()") < startup.indexOf("createWindow()"),
        )
        const shutdown = main.slice(main.indexOf("async function shutdownApplication"))
        assert.ok(
            shutdown.indexOf("optimizationRunner?.checkpointAndStop") < shutdown.indexOf("operatorSessionManager?.stopAll"),
        )
        assert.ok(
            shutdown.indexOf("optimizationOperatorGateway?.cancelAll") < shutdown.indexOf("operatorSessionManager?.stopAll"),
        )
        assert.ok(
            shutdown.indexOf("operatorSessionManager?.stopAll") < shutdown.indexOf("optimizationStore?.close"),
        )
    })

    it("requires every Optimization target to have the exact Released baseline installed", async () => {
        const context = mainFunctionContext(
            "resolveOptimizationPreflight",
            "runOptimizationEvaluation",
            {
                assertOptimizationTelemetrySupport: () => {},
                availableRuntimes: [{
                    runtimeId: "runtime-1",
                    providerId: "codex",
                    displayName: "Codex",
                }],
                basename,
                join,
                managedSkillManager: {git: {}},
                managedSkillStore: {
                    getRepository: () => ({id: "repository-1", managedPath: "/managed/repository"}),
                    getSkill: () => ({
                        id: "skill-1",
                        repositoryId: "repository-1",
                        name: "billing-cost-management",
                    }),
                    getVersion: () => ({
                        id: "version-1",
                        repositoryId: "repository-1",
                        skillId: "skill-1",
                        state: "released",
                        commit: "a".repeat(40),
                        skillRoot: ".",
                        contentDigest: `sha256:${"b".repeat(64)}`,
                    }),
                },
                optimizationDatasetSnapshot: () => ({
                    snapshot: {id: "dataset-1", digest: "dataset-digest"},
                    dataset: {id: "dataset-1"},
                    rubric: {id: "rubric-1", rubricDigest: "rubric-digest"},
                }),
                optionalEffort: (value) => value ?? null,
                optionalIdentifier: (value) => value ?? null,
                requireIdentifier: (value) => value,
                skillInstallationStore: {
                    resolveVerifiedInstallation: () => {
                        throw new Error("A verified Skill installation is required")
                    },
                },
                snapshotManagedSkillEvidence: async () => ({digest: "skill-evidence-digest"}),
            },
        )

        await assert.rejects(
            () => context.resolveOptimizationPreflight({
                skillId: "skill-1",
                baselineVersionId: "version-1",
                datasetId: "dataset-1",
                operator: {runtimeId: "runtime-1"},
                judge: {runtimeId: "runtime-1"},
                targets: [{runtimeId: "runtime-1"}],
            }),
            /Codex.*Released baseline.*Skill Installations/i,
        )
    })

    it("binds baseline evaluation to the exact verified Released installation", async () => {
        const baseline = {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            commit: "a".repeat(40),
            skillRoot: ".",
            contentDigest: `sha256:${"b".repeat(64)}`,
        }
        let evidenceSource = null
        let runInput = null
        const context = mainFunctionContext(
            "optimizationRuntimeConfiguration",
            "optimizationVersionLabel",
            {
                availableRuntimes: [{
                    runtimeId: "runtime-1",
                    providerId: "codex",
                    displayName: "Codex",
                }],
                basename,
                evaluationRunner: {run: async () => {}},
                join,
                managedSkillManager: {git: {}},
                managedSkillStore: {
                    getRepository: () => ({id: "repository-1", managedPath: "/managed/repository"}),
                    getSkill: () => ({id: "skill-1", name: "billing-cost-management"}),
                },
                optimizationDatasetSnapshot: () => ({
                    snapshot: {digest: "dataset-digest"},
                    rubric: {id: "rubric-1", rubricDigest: "rubric-digest"},
                }),
                optimizationRuntimeConfiguration: (value) => value,
                snapshotManagedSkillEvidence: async (source_) => {
                    evidenceSource = structuredClone(source_)
                    return {digest: "skill-evidence-digest"}
                },
                skillInstallationStore: {
                    resolveVerifiedInstallation: (input) => ({
                        id: "installation-1",
                        installationId: "installation-1",
                        jobId: "install-job-1",
                        commit: baseline.commit,
                        contentDigest: baseline.contentDigest,
                        destination: "/runtime/skills/billing-cost-management",
                        installedAt: "2026-09-04T00:00:00.000Z",
                        verification: "runtime-inventory",
                        ...input,
                    }),
                },
                optionalEffort: (value) => value ?? null,
                optionalIdentifier: (value) => value ?? null,
                requireIdentifier: (value) => value,
                store: {
                    createEvaluationRun: (input) => {
                        runInput = structuredClone(input)
                        return {id: "evaluation-1"}
                    },
                    getEvaluationRun: () => ({id: "evaluation-1", status: "completed"}),
                },
            },
        )

        await context.runOptimizationEvaluation({
            optimizationRun: {
                snapshot: {
                    activationMode: "automatic",
                    baseline,
                    dataset: {
                        id: "dataset-1",
                        digest: "dataset-digest",
                        caseRevisions: [{caseId: "case-1"}],
                    },
                    rubric: {id: "rubric-1", digest: "rubric-digest"},
                    judge: {runtimeId: "runtime-1"},
                },
            },
            kind: "baseline",
            candidate: baseline,
            installationJobs: [],
            targets: [{runtimeId: "runtime-1"}],
        })

        assert.equal(evidenceSource.versionId, baseline.versionId)
        assert.equal(runInput.managedVersionSnapshot.versionId, baseline.versionId)
        assert.deepEqual(runInput.managedVersionSnapshot.installationJobIdsByRuntime, {
            "runtime-1": "install-job-1",
        })
        assert.equal(
            runInput.runtimeConfigurations[0].skillReference.path,
            "/runtime/skills/billing-cost-management/SKILL.md",
        )
        assert.equal(runInput.runtimeConfigurations[0].installationId, "installation-1")
        assert.equal(runInput.runtimeConfigurations[0].installationVerification, "runtime-inventory")
    })

    it("binds Candidate evaluation to the exact trusted experiment installation", async () => {
        const candidate = {
            id: "candidate-1",
            repositoryId: "repository-1",
            skillId: "skill-1",
            commit: "c".repeat(40),
            skillRoot: ".",
            contentDigest: `sha256:${"d".repeat(64)}`,
        }
        const installationJob = {
            id: "experiment-job-1",
            status: "succeeded",
            runtime: {runtimeId: "runtime-1", providerId: "codex"},
            request: {
                purpose: "optimization-experiment",
                source: {
                    repositoryId: candidate.repositoryId,
                    skillId: candidate.skillId,
                    versionId: candidate.id,
                    commit: candidate.commit,
                    expectedDigest: candidate.contentDigest,
                },
            },
            parsedResult: {
                trusted: true,
                destination: "/runtime/skills/billing-cost-management",
                verification: "experiment-marker",
            },
            completedAt: "2026-09-04T00:00:00.000Z",
        }
        let runInput = null
        const context = mainFunctionContext(
            "optimizationRuntimeConfiguration",
            "optimizationVersionLabel",
            {
                availableRuntimes: [{
                    runtimeId: "runtime-1",
                    providerId: "codex",
                    displayName: "Codex",
                }],
                basename,
                evaluationRunner: {run: async () => {}},
                join,
                managedSkillManager: {git: {}},
                managedSkillStore: {
                    getRepository: () => ({id: "repository-1", managedPath: "/managed/repository"}),
                    getSkill: () => ({id: "skill-1", name: "billing-cost-management"}),
                },
                optimizationDatasetSnapshot: () => ({
                    snapshot: {digest: "dataset-digest"},
                    rubric: {id: "rubric-1", rubricDigest: "rubric-digest"},
                }),
                optionalEffort: (value) => value ?? null,
                optionalIdentifier: (value) => value ?? null,
                requireIdentifier: (value) => value,
                snapshotManagedSkillEvidence: async () => ({digest: "skill-evidence-digest"}),
                store: {
                    createEvaluationRun: (input) => {
                        runInput = structuredClone(input)
                        return {id: "evaluation-1"}
                    },
                    getEvaluationRun: () => ({id: "evaluation-1", status: "completed"}),
                },
            },
        )

        await context.runOptimizationEvaluation({
            optimizationRun: {
                snapshot: {
                    activationMode: "automatic",
                    dataset: {
                        id: "dataset-1",
                        digest: "dataset-digest",
                        caseRevisions: [{caseId: "case-1"}],
                    },
                    rubric: {id: "rubric-1", digest: "rubric-digest"},
                    judge: {runtimeId: "runtime-1"},
                },
            },
            kind: "candidate",
            candidate,
            installationJobs: [installationJob],
            targets: [{runtimeId: "runtime-1"}],
        })

        assert.equal(runInput.managedVersionSnapshot.versionId, candidate.id)
        assert.deepEqual(runInput.managedVersionSnapshot.installationJobIdsByRuntime, {
            "runtime-1": installationJob.id,
        })
        assert.equal(
            runInput.runtimeConfigurations[0].skillReference.path,
            "/runtime/skills/billing-cost-management/SKILL.md",
        )
        assert.equal(runInput.runtimeConfigurations[0].installationJobId, installationJob.id)
        assert.equal(runInput.runtimeConfigurations[0].installationVerification, "experiment-marker")
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
            "approvals.resolve",
            "jobs.pause",
            "jobs.resume",
            "jobs.stop",
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
        assert.match(main, /createTrustedHumanCapabilityIssuer/)
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

    it("brands the private Renderer grant as human authority without exposing it", async () => {
        const capabilityStore = new CapabilityStore()
        const context = mainFunctionContext(
            "revokeRendererCapabilityEntry",
            "isSafeControlRecord",
            {
                Date,
                Number,
                RENDERER_CAPABILITY_LIFETIME_MS: 3_600_000,
                RENDERER_CAPABILITY_REFRESH_MS: 60_000,
                RENDERER_CONTROL_ACTIONS: ["approvals.resolve", "jobs.control"],
                capabilityStore,
                controlInvocationsAccepted: true,
                currentRendererScopes: () => ({
                    skillIds: [],
                    datasetIds: [],
                    runtimeIds: [],
                    repositoryIds: [],
                }),
                randomUUID: () => "human-renderer-session",
                rendererCapability: null,
                rendererCapabilityEntries: new Set(),
                rendererCapabilityEpoch: 0,
                rendererCapabilityIssuer: (() => {
                    const issuer = createTrustedHumanCapabilityIssuer(capabilityStore)
                    return {issue: (request) => issuer.issue(JSON.parse(JSON.stringify(request)))}
                })(),
                rendererCapabilityRotation: Promise.resolve(),
            },
        )

        const privateGrant = await context.acquireRendererCapability()
        const authorized = capabilityStore.authorize(
            privateGrant.token,
            "approvals.resolve",
            privateGrant.sessionId,
        )
        assert.equal(isTrustedHumanCapability(authorized), true)
        assert.equal(Object.hasOwn(privateGrant, "grant"), false)
        assert.equal(Object.hasOwn(privateGrant, "human"), false)
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

    it("unifies Dataset bindings with the same actual Runtime Skill identity", () => {
        let datasetReference = {
            name: "Shared",
            path: "/workspace/actual/./SKILL.md",
            runtimeId: "runtime-1",
        }
        const context = mainFunctionContext(
            "digestSkillIdentity",
            "listModelsForRuntimeFromControl",
            {
                activeRuntimeSkillCache: null,
                clientGeneration: 7,
                createHash,
                managedSkillManager: {catalog: () => ({repositories: [], skills: []})},
                normalizedSkillName: (value) => String(value ?? "").trim().toLowerCase(),
                rawCaseStore: {list: () => []},
                rendererAliasContext: {getStore: () => null},
                runtimeDescriptor: {runtimeId: "runtime-1", providerId: "codex"},
                store: {listDatasets: () => [{skillReference: datasetReference}]},
                workspaceRoot: "/workspace",
            },
        )

        const samePath = context.cachedRuntimeSkills({data: [{skills: [{
            name: "shared",
            path: "/workspace/actual/SKILL.md",
            enabled: true,
        }]}]})
        const stableId = samePath.data[0].skills[0].id
        assert.match(stableId, /^local-skill-[0-9a-f]{64}$/u)
        let candidates = context.trustedRawCaseSkills().skills
            .filter((skill) => skill.name.toLowerCase() === "shared")
        assert.deepEqual(plain(candidates), [{id: stableId, name: "Shared"}])
        assert.equal(
            context.prepareRendererRawCaseSkillAliases(
                "raw_cases.enqueue",
                {cases: [{skill: {name: "shared"}}]},
            ).params.cases[0].skill.id,
            stableId,
        )

        context.cachedRuntimeSkills({data: [{skills: [{
            name: "shared",
            path: "/workspace/other/SKILL.md",
            enabled: true,
        }]}]})
        candidates = context.trustedRawCaseSkills().skills
            .filter((skill) => skill.name.toLowerCase() === "shared")
        assert.equal(candidates.length, 2)
        assert.equal(new Set(candidates.map((skill) => skill.id)).size, 2)
        assert.equal(
            context.prepareRendererRawCaseSkillAliases(
                "raw_cases.enqueue",
                {cases: [{skill: {name: "shared"}}]},
            ).params.cases[0].skill.id,
            undefined,
        )

        datasetReference = {
            name: "name-only",
            runtimeId: "runtime-1",
            providerId: "codex",
            workspaceRoot: "/workspace",
            evidencePrecision: "name-only",
        }
        const nameOnly = context.cachedRuntimeSkills({data: [{skills: [{
            name: "name-only",
            enabled: true,
            evidencePrecision: "name-only",
        }]}]})
        const nameOnlyId = nameOnly.data[0].skills[0].id
        candidates = context.trustedRawCaseSkills().skills
            .filter((skill) => skill.name === "name-only")
        assert.deepEqual(plain(candidates), [{id: nameOnlyId, name: "name-only"}])

        const main = source("src/main.cjs")
        assert.match(main, /app:bootstrap[\s\S]{0,500}datasets:\s*listDatasetsForControl\(\)/)
    })

    it("carries a name-only Runtime Skill through renderer selection and Dataset persistence", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-name-only-"))
        try {
            const runtimeSkill = {
                id: "local-skill-renderer-id",
                name: "deepseek-billing",
                enabled: true,
                evidencePrecision: "name-only",
                scope: "runtime",
                description: "Discovered without a filesystem path",
            }
            const state = {
                evaluationSkills: [runtimeSkill],
                runtime: {runtime: {
                    runtimeId: "deepseek-harness:local",
                    providerId: "deepseek-harness",
                    capabilities: ["skills-name-only"],
                }},
                workspaceRoot: "/workspace/project",
            }
            const renderer = rendererFunctionContext(
                "runtimeSkillByPath",
                "renderDatasetSkillStatus",
                {
                    node(_tag, _className, text) {
                        return {text, value: "", disabled: false}
                    },
                    state,
                    t: (key) => key,
                },
            )
            const select = {
                children: [],
                value: "",
                replaceChildren() {
                    this.children = []
                },
                append(child) {
                    this.children.push(child)
                },
            }

            renderer.populateSkillSelect(select, null, {allowEmpty: false})
            assert.equal(select.children.length, 1)
            assert.equal(select.value, select.children[0].value)
            const selected = renderer.runtimeSkillBySelectionKey(select.value)
            assert.equal(selected, runtimeSkill)
            const rendererReference = renderer.skillReferenceFromRuntimeSkill(selected)
            assert.deepEqual(plain(rendererReference), {
                schemaVersion: "rolling-skill-skill-reference/v1",
                name: "deepseek-billing",
                path: null,
                scope: "runtime",
                description: "Discovered without a filesystem path",
                runtimeId: "deepseek-harness:local",
                providerId: "deepseek-harness",
                workspaceRoot: "/workspace/project",
                evidencePrecision: "name-only",
                confirmedAt: rendererReference.confirmedAt,
            })

            const runtimeResponse = {data: [{skills: [runtimeSkill]}]}
            const runtimeClient = {
                listSkills: async () => runtimeResponse,
            }
            const mainReference = mainFunctionContext(
                "currentRuntimeSkillReference",
                "unavailableRuntimeState",
                {
                    cachedRuntimeSkills: (response) => response,
                    client: runtimeClient,
                    clientGeneration: 1,
                    ensureRuntime: async () => runtimeClient,
                    requireAbsolutePath(value) {
                        if (typeof value !== "string" || !value.startsWith("/")) {
                            throw new Error("Skill must be an absolute path")
                        }
                        return value
                    },
                    requireIdentifier: (value) => String(value ?? "").trim(),
                    runtimeDescriptor: state.runtime.runtime,
                    runtimeReportsSkill,
                    workspaceRoot: state.workspaceRoot,
                },
            )
            const verifiedReference = await mainReference.currentRuntimeSkillReference(
                rendererReference,
            )
            for (const mismatch of [
                {providerId: "other-provider"},
                {runtimeId: "deepseek-harness:other"},
                {workspaceRoot: "/workspace/other"},
            ]) {
                const staleReference = {...rendererReference, ...mismatch}
                await assert.rejects(
                    mainReference.currentRuntimeSkillReference(staleReference),
                    /name-only.*active runtime.*workspace|stale.*Skill identity/iu,
                )
                await assert.rejects(
                    mainReference.requireAvailableDatasetSkill({
                        skillReference: staleReference,
                    }),
                    /name-only.*active runtime.*workspace|stale.*Skill identity/iu,
                )
            }
            const store = new LocalEvaluationStore(join(directory, "evaluation-store.json"))
            const dataset = store.createDataset({
                name: "DeepSeek Dataset",
                skillReference: verifiedReference,
            })

            const identity = mainFunctionContext(
                "digestSkillIdentity",
                "listModelsForRuntimeFromControl",
                {
                    activeRuntimeSkillCache: null,
                    clientGeneration: 1,
                    createHash,
                    managedSkillManager: {catalog: () => ({repositories: [], skills: []})},
                    normalizedSkillName: (value) => String(value ?? "").trim().toLowerCase(),
                    rawCaseStore: {list: () => []},
                    rendererAliasContext: {getStore: () => null},
                    runtimeDescriptor: state.runtime.runtime,
                    store,
                    workspaceRoot: state.workspaceRoot,
                },
            )
            const datasetId = identity.listDatasetsForControl()
                .find((entry) => entry.id === dataset.id).skillReference.id
            const runtimeId = identity.cachedRuntimeSkills(runtimeResponse).data[0].skills[0].id
            assert.match(datasetId, /^local-skill-[0-9a-f]{64}$/u)
            assert.equal(runtimeId, datasetId)
            assert.equal(
                identity.trustedRawCaseSkills().skills
                    .filter((skill) => skill.name === runtimeSkill.name).length,
                1,
            )
            assert.equal(renderer.runtimeSkillForReference(dataset.skillReference), runtimeSkill)
            assert.equal(renderer.runtimeSkillForReference({
                id: runtimeSkill.id,
                name: runtimeSkill.name,
            }), runtimeSkill)
            assert.equal(renderer.runtimeSkillForReference({
                id: "local-skill-stale",
                name: runtimeSkill.name,
            }), null)
            state.workspaceRoot = "/workspace/other"
            assert.equal(renderer.runtimeSkillForReference(dataset.skillReference), null)
            state.workspaceRoot = "/workspace/project"
            state.runtime.runtime = {
                ...state.runtime.runtime,
                runtimeId: "deepseek-harness:other",
            }
            assert.equal(renderer.runtimeSkillForReference(dataset.skillReference), null)
            state.runtime.runtime = {
                ...state.runtime.runtime,
                runtimeId: "deepseek-harness:local",
                providerId: "other-provider",
            }
            assert.equal(renderer.runtimeSkillForReference(dataset.skillReference), null)
        } finally {
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it("fails closed when the Runtime Skill verification snapshot changes in flight", async () => {
        const scenarios = [
            {
                name: "runtime client",
                mutate(context) {
                    context.client = {ready: true}
                },
            },
            {
                name: "runtime descriptor",
                mutate(context) {
                    context.runtimeDescriptor = {
                        runtimeId: "deepseek-harness:other",
                        providerId: "deepseek-harness",
                        capabilities: ["skills-name-only"],
                    }
                },
            },
            {
                name: "workspace",
                mutate(context) {
                    context.workspaceRoot = "/workspace/other"
                },
            },
            {
                name: "client generation",
                mutate(context) {
                    context.clientGeneration += 1
                },
            },
        ]

        for (const scenario of scenarios) {
            let releaseSkills
            let signalListStarted
            const listStarted = new Promise((resolve) => {
                signalListStarted = resolve
            })
            const skillsResponse = {data: [{skills: [{
                name: "deepseek-billing",
                enabled: true,
                evidencePrecision: "name-only",
            }]}]}
            const runtimeClient = {
                ready: true,
                async listSkills() {
                    signalListStarted()
                    return new Promise((resolve) => {
                        releaseSkills = resolve
                    })
                },
            }
            let cacheWrites = 0
            const descriptor = {
                runtimeId: "deepseek-harness:local",
                providerId: "deepseek-harness",
                capabilities: ["skills-name-only"],
            }
            const context = mainFunctionContext(
                "currentRuntimeSkillReference",
                "unavailableRuntimeState",
                {
                    cachedRuntimeSkills: (response) => {
                        cacheWrites += 1
                        return response
                    },
                    client: runtimeClient,
                    clientGeneration: 7,
                    ensureRuntime: async () => runtimeClient,
                    requireAbsolutePath(value) {
                        if (typeof value !== "string" || !value.startsWith("/")) {
                            throw new Error("Skill must be an absolute path")
                        }
                        return value
                    },
                    requireIdentifier: (value) => String(value ?? "").trim(),
                    runtimeDescriptor: descriptor,
                    runtimeReportsSkill,
                    workspaceRoot: "/workspace/project",
                },
            )
            const pending = context.currentRuntimeSkillReference({
                name: "deepseek-billing",
                path: null,
                providerId: descriptor.providerId,
                runtimeId: descriptor.runtimeId,
                workspaceRoot: "/workspace/project",
                evidencePrecision: "name-only",
            })

            await listStarted
            scenario.mutate(context)
            releaseSkills(skillsResponse)

            await assert.rejects(
                pending,
                /runtime.*workspace.*changed|verification.*stale/iu,
                scenario.name,
            )
            assert.equal(cacheWrites, 0, `${scenario.name} must not write the Skill cache`)
        }
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
        assert.match(first.data[0].skills[0].id, /^local-skill-[0-9a-f]{64}$/u)
        assert.equal(context.currentRuntimeCachedSkills().length, 1)

        context.workspaceRoot = "/workspace-two"
        assert.deepEqual(plain(context.currentRuntimeCachedSkills()), [])
        const second = context.cachedRuntimeSkills(response)
        assert.equal(second.data[0].skills[0].id, first.data[0].skills[0].id)
        context.runtimeDescriptor = {runtimeId: "runtime-2", providerId: "codex"}
        const switchedRuntime = context.cachedRuntimeSkills(response)
        assert.notEqual(switchedRuntime.data[0].skills[0].id, first.data[0].skills[0].id)

        context.runtimeDescriptor = {runtimeId: "runtime-1", providerId: "codex"}
        context.workspaceRoot = "/workspace-one"
        const nameOnlyResponse = {data: [{skills: [{
            name: "billing",
            enabled: true,
            evidencePrecision: "name-only",
        }]}]}
        const firstNameOnly = context.cachedRuntimeSkills(nameOnlyResponse)
        context.workspaceRoot = "/workspace-two"
        const secondNameOnly = context.cachedRuntimeSkills(nameOnlyResponse)
        assert.notEqual(
            secondNameOnly.data[0].skills[0].id,
            firstNameOnly.data[0].skills[0].id,
        )
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
                id: "local-skill-shared",
                name: "shared",
                path: "/private/dataset",
            }}],
            evaluationSkills: [{
                id: "local-skill-runtime-only",
                name: "runtime-only",
                path: "/private/runtime",
            }],
            rawCases: [],
        }
        const context = rendererFunctionContext(
            "rawCaseSkillReference",
            "suggestedRawCaseSkill",
            {state},
        )

        assert.deepEqual(plain(context.rawCaseSkillReference("runtime-only")), {
            id: "local-skill-runtime-only",
            name: "runtime-only",
        })
        assert.deepEqual(plain(context.rawCaseSkillReference("shared")), {
            id: "local-skill-shared",
            name: "shared",
        })
        state.evaluationSkills.push({
            id: "local-skill-shared",
            name: "shared",
            path: "/private/dataset",
        })
        assert.deepEqual(plain(context.rawCaseSkillReference("shared")), {
            id: "local-skill-shared",
            name: "shared",
        })
        state.rawCases.push({skill: {name: "shared"}})
        assert.deepEqual(plain(context.rawCaseSkillReference("shared")), {name: "shared"})
        state.rawCases = []
        state.evaluationSkills.push({
            id: "local-skill-other",
            name: "shared",
            path: "/private/other",
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

    it("exposes an Optimization Run id from the safe parent Job checkpoint without leaking workspace data", () => {
        const page = publicOperatorSummaryPage({
            generation: "generation-a",
            revision: 1,
            sessions: [],
            jobs: [{
                id: "job-1",
                sessionId: "session-1",
                parentJobId: null,
                type: "operator-session",
                objective: "Optimize the frozen Skill",
                budget: {},
                status: "running",
                children: [],
                artifactIds: [],
                approvalIds: [],
                checkpoint: {
                    optimizationRunId: "optimization-run-1",
                    workspacePath: "/private/optimization-workspaces/run-1",
                },
            }],
            steps: [],
            approvals: [],
            totals: {sessions: 0, jobs: 1, steps: 0, approvals: 0},
            truncated: false,
            nextCursor: null,
        })

        assert.equal(page.jobs[0].optimizationRunId, "optimization-run-1")
        assert.doesNotMatch(JSON.stringify(page), /workspacePath|private\/optimization/iu)
    })

    it("exposes a token-free Operator lifecycle bridge and routes human controls privately", async () => {
        const {api, calls} = preloadBridge((channel, payload) => {
            if (channel === "control:invoke") {
                if (payload.method === "approvals.resolve") {
                    return {approval: {id: "approval-1", status: "approved"}, execution: {
                        status: "succeeded",
                        jobId: "job-1",
                    }}
                }
                return {job: {id: payload.params.jobId, status: payload.method.split(".").at(-1)}}
            }
            if (channel === "operator:bootstrap") return {
                generation: "generation-a",
                revision: 7,
                sessions: [],
                jobs: [],
                steps: [],
                approvals: [],
                totals: {sessions: 0, jobs: 0, steps: 0, approvals: 0},
                truncated: true,
                nextCursor: "page-2",
            }
            if (channel === "operator:summary-page") return {
                generation: "generation-a",
                revision: 7,
                sessions: [],
                jobs: [{id: "job-2", status: "running"}],
                steps: [],
                approvals: [],
                totals: {sessions: 0, jobs: 1, steps: 0, approvals: 0},
                truncated: false,
                nextCursor: null,
            }
            if (channel === "operator:create") return {session: {id: "session-1"}, parentJob: {id: "job-1"}}
            if (channel === "operator:get") return {session: {id: payload.sessionId}, parentJob: {id: "job-1"}}
            if (channel === "operator:send") return {queued: true}
            if (channel === "operator:list-artifacts") {
                return {artifacts: [{id: "artifact-1"}], nextCursor: null}
            }
            throw new Error(`Unexpected Operator channel: ${channel}`)
        })

        const bootstrap = await api.bootstrapOperator()
        assert.equal(bootstrap.generation, "generation-a")
        assert.equal(bootstrap.revision, 7)
        assert.deepEqual(plain(await api.readOperatorSummaryPage("page-2", 50)), {
            generation: "generation-a",
            revision: 7,
            sessions: [],
            jobs: [{id: "job-2", status: "running"}],
            steps: [],
            approvals: [],
            totals: {sessions: 0, jobs: 1, steps: 0, approvals: 0},
            truncated: false,
            nextCursor: null,
        })
        assert.deepEqual(plain(await api.createOperatorSession({
            runtimeId: "runtime-1",
            objective: "Improve billing",
            managedSkillBinding: {repositoryId: "repository-1", skillId: "skill-1"},
        })), {session: {id: "session-1"}, parentJob: {id: "job-1"}})
        assert.deepEqual(plain(await api.getOperatorSession("session-1")), {
            session: {id: "session-1"},
            parentJob: {id: "job-1"},
        })
        assert.deepEqual(plain(await api.sendOperatorMessage("session-1", "Continue")), {queued: true})
        assert.equal((await api.pauseOperatorJob("job-1")).id, "job-1")
        assert.equal((await api.resumeOperatorJob("job-1")).id, "job-1")
        assert.equal((await api.stopOperatorJob("job-1")).id, "job-1")
        assert.equal((await api.resolveOperatorApproval("approval-1", "approve")).approval.id, "approval-1")
        assert.deepEqual(plain(await api.listOperatorArtifacts("job-1")), {
            artifacts: [{id: "artifact-1"}],
            nextCursor: null,
        })

        for (const name of [
            "onOperatorChanged",
            "onOperatorEvent",
            "onOperatorApproval",
            "onOperatorArtifact",
        ]) assert.equal(typeof api[name], "function")
        for (const call of calls) {
            assert.doesNotMatch(JSON.stringify(call), /token|socket|executablePath/iu)
            if (call.channel === "control:invoke") {
                assert.deepEqual(Object.keys(call.payload).sort(), ["method", "params"])
            }
        }
    })

    it("broadcasts bounded Operator deltas without reading the full durable registry", () => {
        let fullReads = 0
        const largeTranscript = Array.from({length: 10_000}, (_, index) => ({
            id: `entry-${index}`,
            kind: "message",
            content: "x".repeat(100),
        }))
        const job = {
            id: "job-1",
            sessionId: "session-1",
            parentJobId: null,
            type: "operator",
            objective: "Improve the Skill",
            budget: {},
            status: "running",
            children: [],
            artifactIds: [],
            approvalIds: [],
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        }
        const store = {
            read() {
                fullReads += 1
                return {
                    sessions: [{id: "session-1", transcript: largeTranscript}],
                    jobs: [job],
                    approvals: [],
                }
            },
        }
        for (const method of [
            "createSession",
            "createJob",
            "createStep",
            "transitionStep",
            "transitionJob",
            "beginCancellation",
            "interruptJob",
            "cancelJobTree",
            "appendSessionTranscript",
            "appendEvent",
            "createApproval",
            "resolveApproval",
            "createArtifact",
        ]) store[method] = () => structuredClone(job)
        const broadcasts = []
        const context = mainFunctionContext("operatorSafeValue", "initializeControlPlane", {
            OPERATOR_SAFE_ARRAY_LIMIT: 10_000,
            OPERATOR_SAFE_TEXT_LIMIT: 32 * 1_024,
            OPERATOR_PRIVATE_KEYS: /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu,
            OPERATOR_PRIVATE_INPUT_KEYS: /(?:token|socket|capabilityId|executablePath)/iu,
            operatorJobStore: store,
            send: (channel, payload) => broadcasts.push({channel, payload}),
            structuredClone,
        })

        context.observeOperatorStore(store)
        assert.deepEqual(store.createJob(), job)
        assert.equal(fullReads, 0)
        assert.equal(broadcasts.length, 1)
        assert.equal(broadcasts[0].channel, "operator:changed")
        assert.ok(Buffer.byteLength(JSON.stringify(broadcasts[0].payload)) < 64 * 1_024)
        assert.doesNotMatch(JSON.stringify(broadcasts), /transcript|artifact body/iu)
    })

    it("keeps committed Operator mutations successful when renderer notification throws", () => {
        const job = {
            id: "job-1",
            sessionId: "session-1",
            parentJobId: null,
            type: "operator",
            objective: "Improve the Skill",
            budget: {},
            status: "running",
            children: [],
            artifactIds: [],
            approvalIds: [],
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        }
        const store = {read: () => ({sessions: [], jobs: [], approvals: []})}
        for (const method of [
            "createSession",
            "createJob",
            "createStep",
            "transitionStep",
            "transitionJob",
            "beginCancellation",
            "interruptJob",
            "cancelJobTree",
            "appendSessionTranscript",
            "appendEvent",
            "createApproval",
            "resolveApproval",
            "createArtifact",
        ]) store[method] = () => structuredClone(job)
        const context = mainFunctionContext("operatorSafeValue", "initializeControlPlane", {
            OPERATOR_SAFE_ARRAY_LIMIT: 10_000,
            OPERATOR_SAFE_TEXT_LIMIT: 32 * 1_024,
            OPERATOR_PRIVATE_KEYS: /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu,
            OPERATOR_PRIVATE_INPUT_KEYS: /(?:token|socket|capabilityId|executablePath)/iu,
            operatorJobStore: store,
            send: () => { throw new Error("renderer disappeared") },
            structuredClone,
        })

        context.observeOperatorStore(store)
        assert.deepEqual(store.createJob(), job)
    })

    it("signals a revision gap after one missed notification and serves bounded catch-up pages", () => {
        let generation = "generation-a"
        let revision = 20
        const jobs = [{
            id: "job-1",
            sessionId: "session-1",
            parentJobId: null,
            type: "operator",
            objective: "Improve the Skill",
            budget: {},
            status: "running",
            children: [],
            artifactIds: [],
            approvalIds: [],
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        }]
        const store = {
            get generation() { return generation },
            get revision() { return revision },
            readSummaryPage({cursor, limit}) {
                assert.equal(cursor, null)
                assert.equal(limit, 50)
                return {
                    generation,
                    revision,
                    sessions: [],
                    jobs: structuredClone(jobs),
                    steps: [],
                    approvals: [],
                    totals: {sessions: 0, jobs: jobs.length, steps: 0, approvals: 0},
                    truncated: false,
                    nextCursor: null,
                }
            },
        }
        for (const method of [
            "createSession",
            "createJob",
            "createStep",
            "transitionStep",
            "transitionJob",
            "beginCancellation",
            "interruptJob",
            "cancelJobTree",
            "appendSessionTranscript",
            "appendEvent",
            "createApproval",
            "resolveApproval",
            "createArtifact",
        ]) store[method] = () => {
            revision += 1
            jobs[0].updatedAt = `2026-08-24T00:00:${revision}.000Z`
            return structuredClone(jobs[0])
        }
        const delivered = []
        let dropNextChanged = true
        const context = mainFunctionContext("operatorSafeValue", "initializeControlPlane", {
            OPERATOR_SAFE_ARRAY_LIMIT: 10_000,
            OPERATOR_SAFE_TEXT_LIMIT: 32 * 1_024,
            OPERATOR_BOOTSTRAP_SUMMARY_LIMIT: 200,
            OPERATOR_PRIVATE_KEYS: /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu,
            OPERATOR_PRIVATE_INPUT_KEYS: /(?:token|socket|capabilityId|executablePath)/iu,
            operatorJobStore: store,
            publicOperatorSummaryPage,
            send: (channel, payload) => {
                if (channel === "operator:changed" && dropNextChanged) {
                    dropNextChanged = false
                    throw new Error("missed IPC")
                }
                delivered.push({channel, payload})
            },
            structuredClone,
        })

        context.observeOperatorStore(store)
        const startingGeneration = store.generation
        const startingRevision = store.revision
        assert.doesNotThrow(() => store.transitionJob())
        generation = "generation-b"
        revision = 0
        store.transitionStep()
        const hint = delivered.find((entry) => entry.channel === "operator:changed")?.payload
        assert.equal(hint.generation, "generation-b")
        assert.equal(hint.revision, 1)
        assert.equal(hint.invalidate, true)
        assert.equal(
            hint.generation !== startingGeneration || hint.revision !== startingRevision + 1,
            true,
        )

        const caughtUp = context.operatorSummarySnapshotPage({cursor: null, limit: 50})
        assert.equal(caughtUp.generation, hint.generation)
        assert.equal(caughtUp.revision, hint.revision)
        assert.deepEqual(caughtUp.jobs.map((job) => job.id), ["job-1"])
        assert.equal(caughtUp.truncated, false)
    })

    it("keeps every Operator delta on its dedicated IPC family", () => {
        const record = {
            id: "record-1",
            jobId: "job-1",
            sessionId: "session-1",
            status: "running",
            kind: "progress",
            sequence: 1,
            recordedAt: "2026-08-24T00:00:00.000Z",
            occurredAt: "2026-08-24T00:00:00.000Z",
        }
        const store = {
            generation: "generation-a",
            revision: 17,
            read: () => ({sessions: [], jobs: [], approvals: []}),
        }
        for (const method of [
            "createSession",
            "createJob",
            "createStep",
            "transitionStep",
            "transitionJob",
            "beginCancellation",
            "interruptJob",
            "cancelJobTree",
            "appendSessionTranscript",
            "appendEvent",
            "createApproval",
            "resolveApproval",
            "createArtifact",
        ]) store[method] = () => structuredClone(record)
        const broadcasts = []
        const context = mainFunctionContext("operatorSafeValue", "initializeControlPlane", {
            OPERATOR_SAFE_ARRAY_LIMIT: 10_000,
            OPERATOR_SAFE_TEXT_LIMIT: 32 * 1_024,
            OPERATOR_PRIVATE_KEYS: /(?:token|socket|path|capabilityId|executablePath|inline|body)/iu,
            OPERATOR_PRIVATE_INPUT_KEYS: /(?:token|socket|capabilityId|executablePath)/iu,
            operatorJobStore: store,
            send: (channel, payload) => broadcasts.push({channel, payload}),
            structuredClone,
        })

        context.observeOperatorStore(store)
        store.createJob()
        store.appendEvent()
        store.createApproval()
        store.createArtifact()

        const channels = broadcasts.map(({channel}) => channel)
        assert.deepEqual([...new Set(channels)].sort(), [
            "operator:approval",
            "operator:artifact",
            "operator:changed",
            "operator:event",
        ])
        assert.equal(channels.some((channel) => (
            channel === "runtime:notification" || channel === "runtime:state" ||
            channel.startsWith("curation:") || channel.startsWith("rubric:")
        )), false)
        assert.equal(broadcasts.every(({payload}) => payload.revision === 17), true)
        assert.equal(broadcasts.every(({payload}) => payload.generation === "generation-a"), true)
        assert.equal(broadcasts.every(({payload}) => payload.invalidate === true), true)
    })

    it("changes the frozen Dataset revision when Case content changes under the same id", () => {
        const dataset = {
            id: "dataset-1",
            skillReference: {id: "skill-1"},
            activeRubricVersionId: "rubric-1",
        }
        let cases = [{
            id: "case-1",
            datasetId: dataset.id,
            caseType: "badcase",
            question: "Why was July cost high?",
            answer: "The storage tier changed.",
            curated: {summary: "Storage cost regression"},
        }]
        const context = mainFunctionContext(
            "canonicalOperatorJson",
            "operatorRuntimeTelemetry",
            {
                createHash,
                requireIdentifier: (value) => value,
                store: {
                    getDataset: () => structuredClone(dataset),
                    listCases: () => structuredClone(cases),
                },
            },
        )

        const initial = context.operatorEvaluationSelection(dataset.id).datasetRevision
        cases[0].question = "Why was August cost high?"
        const changedQuestion = context.operatorEvaluationSelection(dataset.id).datasetRevision
        cases[0].question = "Why was July cost high?"
        cases[0].answer = "The database tier changed."
        const changedAnswer = context.operatorEvaluationSelection(dataset.id).datasetRevision

        assert.notEqual(changedQuestion, initial)
        assert.notEqual(changedAnswer, initial)
    })

    it("rechecks the frozen Dataset revision after preflight before creating a run", async () => {
        const dataset = {
            id: "dataset-1",
            skillReference: {id: "skill-1", name: "billing"},
            activeRubricVersionId: "rubric-1",
        }
        const cases = [{
            id: "case-1",
            datasetId: dataset.id,
            caseType: "badcase",
            question: "Why was July cost high?",
            answer: "The storage tier changed.",
        }]
        const selectionContext = mainFunctionContext(
            "canonicalOperatorJson",
            "operatorRuntimeTelemetry",
            {
                createHash,
                requireIdentifier: (value) => value,
                store: {
                    getDataset: () => structuredClone(dataset),
                    listCases: () => structuredClone(cases),
                },
            },
        )
        const frozenRevision = selectionContext
            .operatorEvaluationSelection(dataset.id).datasetRevision
        let createdRuns = 0
        const context = mainFunctionContext(
            "startEvaluationFromControl",
            "requireIdentifier",
            {
                availableRuntimes: [{
                    runtimeId: "runtime-1",
                    providerId: "codex",
                    displayName: "Codex",
                }],
                evaluationRunner: {run: async () => {}},
                operatorEvaluationSelection: selectionContext.operatorEvaluationSelection,
                optionalEffort: (value) => value ?? null,
                optionalIdentifier: (value) => value ?? null,
                requireAvailableDatasetSkill: async () => {
                    cases[0].answer = "The database tier changed during preflight."
                },
                requireIdentifier: (value) => value,
                requirePublishedDatasetRubric: () => {},
                send: () => {},
                skillEvidenceBindingForRuntime: async () => "verified",
                snapshotSkillEvidence: () => ({
                    digest: "sha256:skill",
                    truncated: false,
                    warnings: [],
                }),
                store: {
                    createEvaluationRun() {
                        createdRuns += 1
                        return {id: "run-1", status: "queued"}
                    },
                    getDataset: () => structuredClone(dataset),
                    updateEvaluationRun: () => {},
                },
            },
        )

        await assert.rejects(
            () => context.startEvaluationFromControl({
                datasetId: dataset.id,
                caseIds: ["case-1"],
                selectionMode: "selected",
                activationMode: "explicit",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "runtime-1"},
                expectedDatasetRevision: frozenRevision,
            }),
            (error) => error?.code === "RESOURCE_CHANGED",
        )
        assert.equal(createdRuns, 0)
    })

    it("constructs and shuts down the Operator runtime in dependency order", () => {
        const main = source("src/main.cjs")
        const preload = source("src/preload.cjs")

        for (const constructor of ["OperatorJobStore", "OperatorJobEngine", "OperatorSessionManager"]) {
            assert.equal([...main.matchAll(new RegExp(`new ${constructor}\\(`, "g"))].length, 1)
        }
        const initializationStart = main.indexOf("function initializeOperatorRuntime")
        const initializationEnd = main.indexOf("\nfunction ", initializationStart + 1)
        const initialization = main.slice(initializationStart, initializationEnd)
        assert.ok(initializationStart >= 0)
        assert.ok(initialization.indexOf("new OperatorJobStore") < initialization.indexOf("new OperatorJobEngine"))
        assert.ok(initialization.indexOf("new OperatorJobEngine") < initialization.indexOf("initializeControlPlane()"))
        assert.ok(initialization.indexOf("initializeControlPlane()") < initialization.indexOf("new OperatorSessionManager"))
        assert.match(initialization, /resolveManagedSkillWorkspace/)
        assert.match(initialization, /workspaceRoot/)
        assert.match(initialization, /controlPlane/)
        assert.match(initialization, /requestPermission:\s*\(\)\s*=>\s*"decline"/)
        assert.doesNotMatch(initialization, /requestPermission:[\s\S]{0,160}showRuntimePermissionDialog/)

        const readyStart = main.indexOf("app.whenReady().then")
        const readyEnd = main.indexOf("app.on(\"activate\"", readyStart)
        const ready = main.slice(readyStart, readyEnd)
        assert.ok(ready.indexOf("new EvaluationRunner") < ready.indexOf("initializeOperatorRuntime()"))
        assert.ok(ready.indexOf("new SkillInstallationManager") < ready.indexOf("initializeOperatorRuntime()"))

        const shutdownStart = main.indexOf("async function shutdownApplication")
        const shutdownEnd = main.indexOf("\nconst hasLock", shutdownStart)
        const shutdown = main.slice(shutdownStart, shutdownEnd)
        assert.ok(shutdown.indexOf("operatorSessionManager?.stopAll") < shutdown.indexOf("evaluationRunner?.stopAll"))
        assert.ok(shutdown.indexOf("evaluationRunner?.stopAll") < shutdown.indexOf("skillInstallationManager?.stopAll"))
        assert.ok(shutdown.indexOf("skillInstallationManager?.stopAll") < shutdown.indexOf("client?.stop"))
        assert.ok(shutdown.indexOf("client?.stop") < shutdown.indexOf("stopControlPlane()"))
        assert.ok(shutdown.indexOf("stopControlPlane()") < shutdown.indexOf("operatorJobStore?.close"))

        for (const channel of [
            "operator:bootstrap",
            "operator:summary-page",
            "operator:create",
            "operator:get",
            "operator:send",
            "operator:list-artifacts",
        ]) assert.match(main, new RegExp(channel))
        for (const channel of [
            "operator:bootstrap",
            "operator:summary-page",
            "operator:create",
            "operator:get",
            "operator:send",
            "operator:list-artifacts",
        ]) {
            const start = main.indexOf(`ipcMain.handle("${channel}"`)
            const end = main.indexOf("\n    ipcMain.handle", start + 1)
            assert.ok(start >= 0, `${channel} must be registered`)
            assert.match(main.slice(start, end > start ? end : main.length), /assertRendererControlSender\(event\)/)
        }
        for (const channel of [
            "operator:changed",
            "operator:event",
            "operator:approval",
            "operator:artifact",
        ]) {
            assert.match(main, new RegExp(`sendOperatorNotification\\([\\s\\S]{0,40}\\"${channel}`))
            assert.match(preload, new RegExp(channel))
        }
        assert.match(main, /operator:\s*operatorBootstrapSnapshot\(\)/)
        assert.doesNotMatch(initialization, /runtime:notification|captureNotification|activityStore/)
        assert.doesNotMatch(preload, /ROLLING_SKILL_CONTROL_|capabilityToken|socketPath/)
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
