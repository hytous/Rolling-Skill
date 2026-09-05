const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {createAutomaticCaptureService} = require("../src/automatic-capture-service.cjs")
const {RollingSkillConfigStore} = require("../src/config-store.cjs")

const directories = []
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function fixture({mode = "off", executionLocation = "while-harness-running"} = {}) {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-automatic-service-"))
    directories.push(root)
    const configStore = new RollingSkillConfigStore(join(root, "config.json"))
    const settings = {
        autoCaptureProfile: {
            runtimePolicy: "active",
            mode,
            schedule: {cadence: "daily", time: "09:00", weekday: 1},
            modelId: null,
            effort: null,
            datasetId: null,
            targets: [],
        },
    }
    const settingUpdates = []
    const store = {
        read: () => ({settings: structuredClone(settings)}),
        updateSettings(input) {
            settingUpdates.push(structuredClone(input))
            settings.autoCaptureProfile = {
                ...settings.autoCaptureProfile,
                mode: input.autoCaptureMode ?? settings.autoCaptureProfile.mode,
                schedule: {
                    ...settings.autoCaptureProfile.schedule,
                    cadence: input.autoCaptureCadence ?? settings.autoCaptureProfile.schedule.cadence,
                    time: input.autoCaptureTime ?? settings.autoCaptureProfile.schedule.time,
                    weekday: input.autoCaptureWeekday ?? settings.autoCaptureProfile.schedule.weekday,
                },
                modelId: input.autoCaptureModelId ?? settings.autoCaptureProfile.modelId,
                effort: input.autoCaptureEffort ?? settings.autoCaptureProfile.effort,
                datasetId: input.autoCaptureDatasetId ?? settings.autoCaptureProfile.datasetId,
                targets: input.autoCaptureTargets ?? settings.autoCaptureProfile.targets,
            }
            return structuredClone(settings)
        },
        listDatasets: () => [{
            id: "dataset-incident",
            skillReference: {id: "skill-incident", name: "incident-response-planner"},
        }],
    }
    const runtime = {
        providerId: "deepseek-harness",
        runtimeId: "deepseek-harness:/opt/dsh",
        displayName: "DeepSeek Harness",
        version: "0.1.1-rc.1",
        executablePath: "/opt/dsh",
    }
    const runtimeServices = {
        descriptor(id) {
            if (id !== runtime.runtimeId) throw new Error("Runtime unavailable")
            return structuredClone(runtime)
        },
    }
    const calls = []
    const manager = {
        start: () => calls.push(["start"]),
        stop: () => calls.push(["stop"]),
        reschedule: () => calls.push(["reschedule"]),
        configurationChanged: () => calls.push(["configurationChanged"]),
        async clearObsoleteRouteError() {calls.push(["clearObsoleteRouteError"])},
        status: () => ({mode: settings.autoCaptureProfile.mode, nextRunAt: null, running: false, pendingCount: 0, lastSuccessAt: null, error: null}),
        async runSlot(slot, profile) {
            calls.push(["runSlot", slot.toISOString?.() ?? slot, profile.mode])
        },
        async handleCurationChanged(session) {
            calls.push(["curation", session.id])
            return true
        },
        async recoverAutomaticSessions() {
            calls.push(["recover"])
            return true
        },
    }
    if (executionLocation === "always") {
        configStore.update({
            executionLocation,
            runtime,
            worker: {enabled: true},
        })
    }
    const service = createAutomaticCaptureService({
        store,
        configStore,
        runtimeServices,
        manager,
        now: () => new Date("2026-08-26T09:05:00.000Z"),
    })
    return {calls, configStore, runtime, service, settingUpdates, settings, manager}
}

describe("Rolling Skill automatic capture composition", () => {
    it("acknowledges a browser scan immediately, exposes running state, and rejects duplicate starts", async () => {
        const {runtime, service, manager} = fixture()
        service.update({mode: "scheduled", executionLocation: "while-harness-running", runtimeId: runtime.runtimeId,
            cadence: "daily", time: "09:00", weekday: 1, modelId: "saved", effort: "high"})
        let finish
        manager.runSlot = () => new Promise((resolve) => {finish = resolve})
        assert.equal((await service.runOnce({wait: false})).status, "running")
        assert.equal(service.status().running, true)
        assert.equal((await service.runOnce({wait: false})).status, "busy")
        finish()
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(service.status().running, false)
    })
    it("updates scheduled daily and weekly profiles with a Host-owned full Runtime identity", () => {
        const {configStore, runtime, service, settingUpdates} = fixture()
        const daily = service.update({
            mode: "scheduled",
            executionLocation: "while-harness-running",
            runtimeId: runtime.runtimeId,
            cadence: "daily",
            time: "08:30",
            weekday: 1,
            modelId: "small-model",
            effort: "low",
            datasetId: null,
        })
        assert.equal(daily.mode, "scheduled")
        assert.equal(daily.schedule.time, "08:30")
        assert.deepEqual(configStore.read().detectionRuntime, runtime)

        const weekly = service.update({
            mode: daily.mode,
            executionLocation: daily.executionLocation,
            runtimeId: runtime.runtimeId,
            cadence: "weekly",
            time: daily.schedule.time,
            weekday: 5,
            modelId: daily.modelId,
            effort: daily.effort,
            datasetId: daily.datasetId,
        })
        assert.equal(weekly.schedule.cadence, "weekly")
        assert.equal(weekly.schedule.weekday, 5)
        assert.equal(settingUpdates.at(-1).autoCaptureCadence, "weekly")
    })

    it("persists candidate Skill routes and exposes them in automatic status", () => {
        const {runtime, service, settingUpdates} = fixture()
        const targets = [{skillId: "skill-incident", datasetId: "dataset-incident"}]

        const updated = service.update({
            mode: "automatic",
            executionLocation: "while-harness-running",
            runtimeId: runtime.runtimeId,
            cadence: "daily",
            time: "09:00",
            weekday: 1,
            modelId: null,
            effort: null,
            datasetId: null,
            targets,
        })

        assert.deepEqual(updated.targets, targets)
        assert.deepEqual(settingUpdates.at(-1).autoCaptureTargets, targets)
    })

    it("preserves a legacy Dataset route when an older caller omits targets", () => {
        const {runtime, service, settingUpdates, settings} = fixture()
        settings.autoCaptureProfile.datasetId = "dataset-incident"

        const updated = service.update({
            mode: "automatic",
            executionLocation: "while-harness-running",
            runtimeId: runtime.runtimeId,
            cadence: "daily",
            time: "09:00",
            weekday: 1,
            modelId: null,
            effort: null,
            datasetId: "dataset-incident",
        })

        assert.equal(updated.datasetId, "dataset-incident")
        assert.equal("autoCaptureTargets" in settingUpdates.at(-1), false)
    })

    it("keeps off disabled, runs one explicit slot, and delegates automatic Case completion", async () => {
        const {calls, runtime, service} = fixture()
        assert.equal((await service.runOnce({slot: "2026-08-26T09:00:00.000Z"})).status, "disabled")
        service.update({
            mode: "automatic",
            executionLocation: "while-harness-running",
            runtimeId: runtime.runtimeId,
            cadence: "daily",
            time: "09:00",
            weekday: 1,
            modelId: null,
            effort: null,
            datasetId: null,
        })
        assert.equal((await service.runOnce({slot: "2026-08-26T09:00:00.000Z"})).status, "completed")
        assert.equal(await service.handleCurationChanged({id: "curation-1"}), true)
        assert.deepEqual(calls.filter(([kind]) => ["recover", "runSlot", "curation"].includes(kind)).map(([kind]) => kind), ["recover", "runSlot", "curation"])
    })

    it("lets the single owning Host schedule both foreground and always-on capture", () => {
        const host = fixture({mode: "scheduled"})
        host.service.startHostSchedule()
        assert.equal(host.calls.some(([kind]) => kind === "start"), true)
        assert.equal(host.calls.some(([kind]) => kind === "clearObsoleteRouteError"), true)

        const worker = fixture({mode: "scheduled", executionLocation: "always"})
        worker.service.startHostSchedule()
        assert.deepEqual(worker.calls, [["start"], ["clearObsoleteRouteError"], ["recover"]])
    })

    it("clears obsolete errors when a running Host accepts new automatic settings", () => {
        const value = fixture({mode: "scheduled"})
        value.service.startHostSchedule()
        value.calls.length = 0

        value.service.update({
            mode: "scheduled",
            executionLocation: "while-harness-running",
            runtimeId: value.runtime.runtimeId,
            cadence: "weekly",
            time: "08:30",
            weekday: 5,
            modelId: "small-model",
            effort: "low",
            datasetId: null,
        })

        assert.deepEqual(value.calls, [["configurationChanged"]])
    })

    it("fails closed before changing settings when the selected Runtime is unavailable", () => {
        const {service, settingUpdates} = fixture()
        assert.throws(() => service.update({
            mode: "automatic",
            executionLocation: "always",
            runtimeId: "deepseek-harness:/missing",
            cadence: "daily",
            time: "09:00",
            weekday: 1,
            modelId: null,
            effort: null,
            datasetId: null,
        }), /Runtime unavailable/u)
        assert.equal(settingUpdates.length, 0)
    })

    it("persists only stable Runtime identity fields from discovery", () => {
        const {configStore, runtime, service} = fixture()
        runtime.capabilities = ["skills-name-only"]
        runtime.models = [{id: "model-a"}]

        service.update({
            mode: "automatic",
            executionLocation: "while-harness-running",
            runtimeId: runtime.runtimeId,
            cadence: "daily",
            time: "09:00",
            weekday: 1,
            modelId: "model-a",
            effort: null,
            datasetId: null,
        })

        assert.deepEqual(configStore.read().detectionRuntime, {
            providerId: runtime.providerId,
            runtimeId: runtime.runtimeId,
            displayName: runtime.displayName,
            version: runtime.version,
            executablePath: runtime.executablePath,
        })
    })

    it("keeps Case detection and source selection independent from the saved Curator Runtime", () => {
        const {configStore, runtime, service, settings} = fixture()
        const curatorRuntime = {providerId: "codex", runtimeId: "codex:/opt/codex", executablePath: "/opt/codex"}
        configStore.update({runtime: curatorRuntime})
        settings.curatorProfile = {modelId: "saved-curator-model", effort: "high"}
        const result = service.update({mode: "scheduled", executionLocation: "while-harness-running",
            cadence: "daily", time: "09:00", weekday: 1,
            runtimeId: runtime.runtimeId, sourceRuntimeId: runtime.runtimeId,
            modelId: "saved-detection-model", effort: "max", datasetId: null})
        assert.deepEqual(configStore.read().runtime, curatorRuntime)
        assert.deepEqual(result.sourceRuntime, runtime)
        assert.deepEqual(result.runtime, runtime)
        assert.deepEqual(result.curatorRuntime, curatorRuntime)
        assert.deepEqual(settings.curatorProfile, {modelId: "saved-curator-model", effort: "high"})
    })
})
