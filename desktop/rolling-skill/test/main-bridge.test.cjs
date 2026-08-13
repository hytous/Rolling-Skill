const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "..")
const source = (path) => readFileSync(join(root, path), "utf8")

describe("desktop main/preload bridge", () => {
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
        assert.match(main, /sourceRuntime\.providerId === "codex" \? permission : \{\}/)
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
