const {Buffer} = require("node:buffer")

const {
    AutomaticCaptureStateStore,
} = require("../../../desktop/rolling-skill/src/automatic-capture-state-store.cjs")
const {
    LocalEvaluationStore,
} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {
    ManagedSkillStore,
} = require("../../../desktop/rolling-skill/src/managed-skill-store.cjs")
const {
    RawCaseStore,
} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")
const {
    CaseRecycleService,
} = require("../../../desktop/rolling-skill/src/case-recycle-service.cjs")
const {createCaseServices} = require("./case-services.cjs")
const {RollingSkillConfigStore} = require("./config-store.cjs")
const {ensureDataLayout, resolveDataPaths} = require("./data-root.cjs")

const MAX_DISPATCH_BYTES = 1024 * 1024

function assertPlainJson(value, ancestors = new Set()) {
    if (
        value === null ||
        typeof value === "string" ||
        typeof value === "boolean"
    ) return
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error("Rolling Skill input must be plain JSON")
        return
    }
    if (typeof value !== "object") {
        throw new Error("Rolling Skill input must be plain JSON")
    }
    if (ancestors.has(value)) throw new Error("Rolling Skill input must be plain JSON")

    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        throw new Error("Rolling Skill input must be plain JSON")
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new Error("Rolling Skill input must be plain JSON")
    }

    ancestors.add(value)
    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
            if (!Object.hasOwn(value, index)) {
                ancestors.delete(value)
                throw new Error("Rolling Skill input must be plain JSON")
            }
            assertPlainJson(value[index], ancestors)
        }
    } else {
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if (!descriptor.enumerable || !("value" in descriptor)) {
                ancestors.delete(value)
                throw new Error("Rolling Skill input must be plain JSON")
            }
            assertPlainJson(descriptor.value, ancestors)
        }
    }
    ancestors.delete(value)
}

function jsonCopy(value) {
    return JSON.parse(JSON.stringify(value))
}

function checkedInput(method, input) {
    assertPlainJson(input)
    const serialized = JSON.stringify({method, input})
    if (Buffer.byteLength(serialized, "utf8") > MAX_DISPATCH_BYTES) {
        throw new Error("Rolling Skill request must not exceed 1 MiB")
    }
    return JSON.parse(JSON.stringify(input))
}

function defaultSkillReference(paths) {
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: "rolling-skill",
        path: null,
        scope: "plugin",
        description: "Rolling Skill DeepSeek Harness plugin",
        runtimeId: "deepseek-harness:rolling-skill",
        providerId: "deepseek-harness",
        workspaceRoot: paths.root,
        evidencePrecision: "name-only",
        confirmedAt: new Date().toISOString(),
    }
}

function createRollingSkillApplication(options = {}) {
    const paths = ensureDataLayout(resolveDataPaths(options))
    const store = new LocalEvaluationStore(paths.evaluationStore)
    const rawCaseStore = new RawCaseStore(paths.rawCaseEvents)
    const automaticCaptureStateStore = new AutomaticCaptureStateStore(
        paths.automaticCaptureState,
    )
    const managedSkillStore = new ManagedSkillStore(paths.managedSkillRegistry)
    const configStore = new RollingSkillConfigStore(paths.config)
    const recycleService = new CaseRecycleService({store, rawCaseStore})
    const caseServices = createCaseServices({
        store,
        rawCaseStore,
        recycleService,
        refreshManager: options.caseRefreshManager ?? null,
    })
    const subscribers = new Set()
    let closed = false

    function dashboardSnapshot() {
        const state = store.read()
        const rawCases = rawCaseStore.list()
        const managedSkills = managedSkillStore.read()
        return {
            counts: {
                datasets: state.datasets.length,
                cases: state.cases.length,
                rawCases: rawCases.length,
                evaluations: state.evaluationRuns.length,
                managedSkills: managedSkills.skills.length,
            },
            dataRoot: paths.root,
            automaticCapture: automaticCaptureStateStore.read(),
            settings: {
                rollingSkill: state.settings,
                plugin: configStore.read(),
            },
        }
    }

    function settingsSnapshot() {
        return {
            rollingSkill: store.read().settings,
            plugin: configStore.read(),
        }
    }

    const methods = {
        "dashboard.get": () => dashboardSnapshot(),
        "datasets.list": () => store.listDatasets(),
        "datasets.get": ({datasetId}) => ({
            ...store.getDataset(datasetId),
            cases: store.listCases(datasetId),
        }),
        "datasets.create": (input) => store.createDataset({
            ...input,
            skillReference: input.skillReference ?? defaultSkillReference(paths),
        }),
        "rawCases.list": () => rawCaseStore.list(),
        "rawCases.add": (input) => rawCaseStore.add(input),
        "evaluations.list": ({datasetId = null}) =>
            store.listEvaluationRunSummaries(datasetId),
        "settings.get": () => settingsSnapshot(),
        "settings.update": ({rollingSkill = {}, plugin = {}}) => {
            if (Object.keys(rollingSkill).length > 0) store.updateSettings(rollingSkill)
            if (Object.keys(plugin).length > 0) configStore.update(plugin)
            return settingsSnapshot()
        },
        ...caseServices.methods,
    }
    const mutations = new Set([
        "datasets.create",
        "rawCases.add",
        "rawCases.update",
        "settings.update",
        ...caseServices.mutations,
    ])

    async function snapshot() {
        if (closed) throw new Error("Rolling Skill application is closed")
        return jsonCopy(dashboardSnapshot())
    }

    async function publish() {
        if (subscribers.size === 0) return
        const value = dashboardSnapshot()
        for (const listener of subscribers) {
            try {
                listener(jsonCopy(value))
            } catch {}
        }
    }

    async function dispatch(method, input = {}) {
        if (closed) throw new Error("Rolling Skill application is closed")
        if (typeof method !== "string" || !Object.hasOwn(methods, method)) {
            throw new Error(`Unknown Rolling Skill method: ${String(method ?? "")}`)
        }
        const value = await methods[method](checkedInput(method, input))
        if (mutations.has(method)) await publish()
        return jsonCopy(value)
    }

    function subscribe(listener) {
        if (closed) throw new Error("Rolling Skill application is closed")
        if (typeof listener !== "function") {
            throw new Error("Rolling Skill subscriber must be a function")
        }
        subscribers.add(listener)
        return () => subscribers.delete(listener)
    }

    async function close() {
        if (closed) return
        closed = true
        subscribers.clear()
        rawCaseStore.close()
    }

    return Object.freeze({close, dispatch, snapshot, subscribe})
}

module.exports = {
    MAX_DISPATCH_BYTES,
    createRollingSkillApplication,
}
