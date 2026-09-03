const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {RollingSkillConfigStore} = require("../../rolling-skill-core/src/config-store.cjs")
const {resolveDataPaths} = require("../../rolling-skill-core/src/data-root.cjs")
const {AutomaticCaptureStateStore} = require("../../../desktop/rolling-skill/src/automatic-capture-state-store.cjs")
const {LocalEvaluationStore} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {
    MAX_WORKER_LOG_BYTES,
    appendWorkerLog,
    parseWorkerArguments,
    runWorker,
} = require("../src/worker/run.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function dataRoot() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-worker-"))
    directories.push(root)
    return root
}

function enable(root) {
    const paths = resolveDataPaths({dataRoot: root})
    new RollingSkillConfigStore(paths.config).update({
        executionLocation: "always",
        runtime: {
            providerId: "deepseek-harness",
            runtimeId: "deepseek-harness:/opt/dsh",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
            executablePath: "/opt/dsh",
        },
        worker: {enabled: true, installed: true, platform: "linux"},
    })
    return paths
}

describe("Rolling Skill one-shot Worker", () => {
    it("parses only the supported explicit options", () => {
        assert.deepEqual(parseWorkerArguments([
            "--data-root", "/tmp/rolling-skill",
            "--slot", "2026-08-26T09:00:00.000Z",
        ]), {
            dataRoot: "/tmp/rolling-skill",
            slot: "2026-08-26T09:00:00.000Z",
        })
        assert.deepEqual(parseWorkerArguments([
            "--data-root", "/tmp/rolling-skill",
            "--slot", "scheduled",
        ]), {
            dataRoot: "/tmp/rolling-skill",
            slot: "scheduled",
        })
        assert.throws(() => parseWorkerArguments(["--data-root", "/tmp/root", "--open"]), /unknown option/iu)
        assert.throws(() => parseWorkerArguments(["--slot", "today"]), /data root|timestamp/iu)
    })

    it("resolves a scheduler wake-up to the latest due persisted slot", async () => {
        const root = dataRoot()
        const paths = enable(root)
        new LocalEvaluationStore(paths.evaluationStore).updateSettings({
            autoCaptureMode: "scheduled",
            autoCaptureCadence: "daily",
            autoCaptureTime: "09:00",
            autoCaptureWeekday: 1,
        })
        const calls = []
        const result = await runWorker({
            dataRoot: root,
            slot: "scheduled",
            now: () => new Date(2026, 7, 26, 9, 5, 0, 0),
            createApplication: () => ({
                dispatch: async (method, input) => (calls.push([method, input]), {}),
                close: async () => {},
            }),
        })

        const expectedSlot = new Date(2026, 7, 26, 9, 0, 0, 0).toISOString()
        assert.equal(result.slot, expectedSlot)
        assert.equal(calls[0][1].slot, expectedSlot)
    })

    it("runs one configured slot, completes it, and skips the same slot", async () => {
        const root = dataRoot()
        const paths = enable(root)
        const calls = []
        let closes = 0
        const createApplication = (options) => (assert.equal(options.workerMode, true), {
            dispatch: async (method, input) => (calls.push([method, input]), {captured: 2}),
            close: async () => { closes += 1 },
        })
        const input = {
            dataRoot: root,
            slot: "2026-08-26T09:00:00.000Z",
            createApplication,
        }
        assert.equal((await runWorker(input)).status, "completed")
        assert.equal((await runWorker(input)).status, "already-completed")
        assert.deepEqual(calls.map(([method]) => method), ["automatic.runOnce"])
        assert.equal(closes, 1)
        assert.equal(new AutomaticCaptureStateStore(paths.automaticCaptureState).read().lastScheduledSlot, input.slot)
    })

    it("fails closed when disabled or cancelled and never completes a failed slot", async () => {
        const disabledRoot = dataRoot()
        assert.equal((await runWorker({
            dataRoot: disabledRoot,
            slot: "2026-08-26T09:00:00.000Z",
            createApplication: () => { throw new Error("must not start") },
        })).status, "disabled")

        const root = dataRoot()
        const paths = enable(root)
        const controller = new AbortController()
        controller.abort()
        await assert.rejects(() => runWorker({
            dataRoot: root,
            slot: "2026-08-26T10:00:00.000Z",
            signal: controller.signal,
            createApplication: () => { throw new Error("must not start") },
        }), /cancelled|aborted/iu)

        await assert.rejects(() => runWorker({
            dataRoot: root,
            slot: "2026-08-26T11:00:00.000Z",
            createApplication: () => ({
                dispatch: async () => { throw new Error("Runtime unavailable") },
                close: async () => {},
            }),
        }), /Runtime unavailable/u)
        const state = new AutomaticCaptureStateStore(paths.automaticCaptureState).read()
        assert.equal(state.lastScheduledSlot, null)
        assert.match(state.lastError.message, /Runtime unavailable/u)
    })

    it("keeps status logs bounded", () => {
        const root = dataRoot()
        const paths = resolveDataPaths({dataRoot: root})
        for (let index = 0; index < 300; index += 1) {
            appendWorkerLog(paths.workerLog, {status: "test", message: "x".repeat(8_000), index})
        }
        assert.equal(statSync(paths.workerLog).size <= MAX_WORKER_LOG_BYTES, true)
        assert.match(readFileSync(paths.workerLog, "utf8"), /"status":"test"/u)
    })

    it("keeps source workspace and newly inspected conversation cursors on both success and failure", async () => {
        for (const fail of [false, true]) {
            const root = dataRoot()
            const paths = enable(root)
            const task = runWorker({dataRoot: root, workspaceRoot: "/source/project", slot: "2026-09-01T09:00:00.000Z", createApplication: (options) => ({
                dispatch: async () => {
                    assert.equal(options.workspaceRoot, "/source/project")
                    const appState = options.automaticCaptureStateStore ?? new AutomaticCaptureStateStore(paths.automaticCaptureState)
                    appState.commitThread("dsh", "conversation", {lastInspectedUserItemId: "new-item", inspectionSignature: "new-signature"})
                    if (fail) throw new Error("Curator failed after scanning")
                    return {}
                },
                close: async () => {},
            })})
            if (fail) await assert.rejects(task, /Curator failed/u)
            else await task
            const state = new AutomaticCaptureStateStore(paths.automaticCaptureState)
            assert.equal(state.thread("dsh", "conversation").inspectionSignature, "new-signature")
            assert.equal(state.thread("dsh", "conversation").lastInspectedUserItemId, "new-item")
        }
    })

    it("accepts an explicit source workspace and makes Node available to child runtimes with a minimal scheduler PATH", () => {
        const {workerEnvironment} = require("../src/worker/cli.cjs")
        assert.equal(parseWorkerArguments(["--data-root", "/data", "--slot", "scheduled", "--workspace-root", "/source/project"]).workspaceRoot, "/source/project")
        assert.throws(() => parseWorkerArguments(["--data-root", "/data", "--slot", "scheduled", "--workspace-root", "relative"]), /absolute/u)
        assert.equal(workerEnvironment({PATH: "/usr/bin:/bin", EXISTING: "keep"}, "/opt/node/bin/node").PATH, "/opt/node/bin:/usr/bin:/bin")
        assert.equal(workerEnvironment({PATH: "/usr/bin", EXISTING: "keep"}, "/opt/node/bin/node").EXISTING, "keep")
    })
})
