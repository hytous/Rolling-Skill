const {
    ConversationDiscoveryManager,
} = require("../../../desktop/rolling-skill/src/automatic-capture.cjs")
const {normalizeConfig} = require("./config-store.cjs")

const MODES = new Set(["off", "scheduled", "automatic"])
const LOCATIONS = new Set(["while-harness-running", "always"])
const CADENCES = new Set(["daily", "weekly"])

function requiredText(value, label, maximum = 4_096) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function optionalText(value, label, maximum = 4_096) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maximum)
}

function stableRuntimeIdentity(descriptor) {
    if (!descriptor) return null
    return {
        providerId: descriptor.providerId,
        runtimeId: descriptor.runtimeId,
        displayName: descriptor.displayName,
        version: descriptor.version,
        executablePath: descriptor.executablePath,
    }
}

function automaticTargets(value, datasets) {
    if (!Array.isArray(value)) throw new Error("Automatic capture candidate Skill routes are invalid")
    if (value.length > 100) throw new Error("Automatic capture candidate Skill routes are too large")
    const skillIds = new Set()
    return value.map((entry) => {
        const skillId = requiredText(entry?.skillId, "Automatic capture candidate Skill id", 200)
        const datasetId = requiredText(entry?.datasetId, "Automatic capture Dataset id", 200)
        if (skillIds.has(skillId)) throw new Error("Automatic capture candidate Skill is duplicated")
        const dataset = datasets.find((candidate) => candidate?.id === datasetId)
        if (!dataset || dataset.skillReference?.id !== skillId) {
            throw new Error("Automatic capture candidate Skill does not match the Dataset binding")
        }
        skillIds.add(skillId)
        return {skillId, datasetId}
    })
}

function createAutomaticCaptureService({
    store,
    configStore,
    runtimeServices,
    stateStore = null,
    rawCaseStore = null,
    curationManager = null,
    listSkills = null,
    listDatasets = () => store.listDatasets(),
    captureEpisode = null,
    saveEvidence = null,
    getHiddenThreadIds = () => new Set(),
    manager = null,
    now = () => new Date(),
    setTimer,
    clearTimer,
    onChanged = () => {},
    onError = () => {},
} = {}) {
    if (!store || !configStore || !runtimeServices) {
        throw new Error("Automatic capture service dependencies are required")
    }

    function runtimeDescriptor() {
        const selected = configStore.read().runtime
        if (!selected?.runtimeId) {
            throw new Error("Select a Runtime before running automatic capture")
        }
        return runtimeServices.descriptor(selected.runtimeId)
    }

    async function runtimeClient() {
        const descriptor = runtimeDescriptor()
        return runtimeServices.getClient(descriptor.runtimeId, {nonInteractive: true})
    }

    const captureManager = manager ?? new ConversationDiscoveryManager({
        store,
        stateStore,
        rawCaseStore,
        curationManager,
        getRuntime: runtimeClient,
        getRuntimeDescriptor: runtimeDescriptor,
        listDatasets,
        captureEpisode,
        saveEvidence,
        listSkills: listSkills ?? (async (runtime) => {
            if (typeof runtime.listSkills !== "function") return []
            const response = await runtime.listSkills({forceReload: true})
            return (response?.data ?? []).flatMap((entry) => entry.skills ?? [])
                .filter((skill) => skill.enabled !== false)
        }),
        runAnalysis: async (input) => {
            const runtime = await runtimeClient()
            if (typeof runtime.runEvaluationJudge !== "function") {
                throw new Error("Selected Runtime cannot run automatic capture analysis")
            }
            return runtime.runEvaluationJudge(input)
        },
        getHiddenThreadIds,
        now,
        ...(setTimer ? {setTimer} : {}),
        ...(clearTimer ? {clearTimer} : {}),
        onStatus: onChanged,
        onError,
    })
    let hostStarted = false
    let running = null

    function status() {
        const profile = store.read().settings.autoCaptureProfile
        const plugin = configStore.read()
        return {
            ...captureManager.status(),
            mode: profile.mode,
            schedule: structuredClone(profile.schedule),
            modelId: profile.modelId,
            effort: profile.effort,
            datasetId: profile.datasetId,
            targets: structuredClone(profile.targets ?? []),
            executionLocation: plugin.executionLocation,
            runtime: plugin.runtime,
            worker: plugin.worker,
        }
    }

    function update(input = {}) {
        const mode = requiredText(input.mode, "Automatic capture mode", 40)
        if (!MODES.has(mode)) throw new Error("Automatic capture mode is invalid")
        const executionLocation = requiredText(
            input.executionLocation,
            "Automatic capture execution location",
            80,
        )
        if (!LOCATIONS.has(executionLocation)) {
            throw new Error("Automatic capture execution location is invalid")
        }
        const cadence = requiredText(input.cadence, "Automatic capture cadence", 20)
        if (!CADENCES.has(cadence)) throw new Error("Automatic capture cadence is invalid")
        const time = requiredText(input.time, "Automatic capture time", 5)
        if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
            throw new Error("Automatic capture time is invalid")
        }
        const weekday = Number(input.weekday)
        if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
            throw new Error("Automatic capture weekday is invalid")
        }
        const runtimeId = optionalText(input.runtimeId, "Automatic capture Runtime id", 500)
        const current = configStore.read()
        const targetSettings = input.targets === undefined
            ? {}
            : {autoCaptureTargets: automaticTargets(input.targets, listDatasets())}
        const runtime = runtimeId
            ? stableRuntimeIdentity(runtimeServices.descriptor(runtimeId))
            : current.runtime
        if (mode !== "off" && !runtime) {
            throw new Error("Select a Runtime before enabling automatic capture")
        }
        if (executionLocation === "always" && !runtime) {
            throw new Error("Always-on automatic capture requires a Runtime")
        }
        const worker = {
            ...current.worker,
            enabled: mode !== "off" && executionLocation === "always",
        }
        normalizeConfig({...current, executionLocation, runtime, worker})
        const settings = store.updateSettings({
            autoCaptureMode: mode,
            autoCaptureCadence: cadence,
            autoCaptureTime: time,
            autoCaptureWeekday: weekday,
            autoCaptureModelId: optionalText(input.modelId, "Automatic capture model id", 300),
            autoCaptureEffort: optionalText(input.effort, "Automatic capture effort", 100),
            autoCaptureDatasetId: optionalText(input.datasetId, "Automatic capture Dataset id", 200),
            ...targetSettings,
        })
        configStore.update({executionLocation, runtime, worker})
        if (hostStarted) {
            if (executionLocation === "always") captureManager.stop()
            else captureManager.reschedule()
        }
        onChanged(status())
        return {
            ...status(),
            mode: settings.autoCaptureProfile.mode,
            schedule: settings.autoCaptureProfile.schedule,
        }
    }

    async function runOnce({slot = "manual"} = {}) {
        const profile = store.read().settings.autoCaptureProfile
        if (profile.mode === "off") return {status: "disabled", slot: null}
        runtimeDescriptor()
        if (running) return {status: "busy", slot: null}
        await captureManager.recoverAutomaticSessions?.()
        const selectedSlot = slot === "manual" ? now() : new Date(slot)
        if (!Number.isFinite(selectedSlot.getTime())) {
            throw new Error("Automatic capture slot is invalid")
        }
        const operation = captureManager.runSlot(selectedSlot, profile)
        running = operation
        onChanged(status())
        try {
            await operation
            return {status: "completed", slot: selectedSlot.toISOString()}
        } catch (error) {
            stateStore?.failSlot?.(error, now())
            onError(error)
            throw error
        } finally {
            if (running === operation) running = null
            onChanged(status())
        }
    }

    function startHostSchedule() {
        hostStarted = true
        if (configStore.read().executionLocation === "always") captureManager.stop()
        else captureManager.start()
        void Promise.resolve(captureManager.recoverAutomaticSessions?.()).catch(onError)
        return status()
    }

    function stopHostSchedule() {
        hostStarted = false
        captureManager.stop()
        return status()
    }

    return Object.freeze({
        handleCurationChanged: (session) => captureManager.handleCurationChanged(session),
        manager: captureManager,
        runDueAutomaticCapture: runOnce,
        runOnce,
        startHostSchedule,
        status,
        stopHostSchedule,
        update,
    })
}

module.exports = {createAutomaticCaptureService}
