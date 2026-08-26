const {Buffer} = require("node:buffer")
const {join} = require("node:path")

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
    ManagedSkillManager,
} = require("../../../desktop/rolling-skill/src/managed-skill-manager.cjs")
const {
    RawCaseStore,
} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")
const {
    CaseRecycleService,
} = require("../../../desktop/rolling-skill/src/case-recycle-service.cjs")
const {
    CaseRefreshManager,
} = require("../../../desktop/rolling-skill/src/case-refresh-manager.cjs")
const {
    CurationManager,
} = require("../../../desktop/rolling-skill/src/curation-manager.cjs")
const {
    RubricManager,
} = require("../../../desktop/rolling-skill/src/rubric-manager.cjs")
const {
    EvaluationRunner,
} = require("../../../desktop/rolling-skill/src/evaluation-runner.cjs")
const {
    resolveExecutionPolicy,
    resolveRuntimePermission,
} = require("../../../desktop/rolling-skill/src/execution-policy.cjs")
const {
    SkillInstallationManager,
} = require("../../../desktop/rolling-skill/src/skill-installation-manager.cjs")
const {
    SkillInstallationStore,
} = require("../../../desktop/rolling-skill/src/skill-installation-store.cjs")
const {createCaseServices} = require("./case-services.cjs")
const {RollingSkillConfigStore} = require("./config-store.cjs")
const {ensureDataLayout, resolveDataPaths} = require("./data-root.cjs")
const {createEvaluationServices} = require("./evaluation-services.cjs")
const {createOperatorRuntime} = require("./operator-services.cjs")
const {createRuntimeServices} = require("./runtime-services.cjs")
const {createSkillServices} = require("./skill-services.cjs")

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

function workerOperatorRuntime() {
    const unavailable = () => {
        throw new Error("Operator and Optimization services are unavailable in Worker mode")
    }
    const services = {
        operatorSummary: () => ({
            generation: null,
            revision: 0,
            sessions: [],
            jobs: [],
            steps: [],
            approvals: [],
            totals: {sessions: 0, jobs: 0, steps: 0, approvals: 0},
            truncated: false,
            nextCursor: null,
        }),
        optimizationList: () => [],
    }
    for (const method of [
        "operatorGet",
        "operatorStart",
        "operatorPause",
        "operatorResume",
        "operatorCancel",
        "operatorApprove",
        "operatorArtifacts",
        "operatorSend",
        "optimizationGet",
        "optimizationPreflight",
        "optimizationStart",
        "optimizationPause",
        "optimizationResume",
        "optimizationCancel",
        "optimizationReport",
    ]) services[method] = unavailable
    return Object.freeze({services: Object.freeze(services), close: async () => {}})
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
    const workspaceRoot = options.workspaceRoot ?? process.cwd()
    const runtimeServices = createRuntimeServices({
        registry: options.runtimeRegistry,
        configStore,
        workspaceRoot,
        traceDirectory: paths.traces,
    })
    const managedSkillManager = new ManagedSkillManager({
        applicationSupportDirectory: paths.managedSkills,
        store: managedSkillStore,
    })
    const installationStore = new SkillInstallationStore(paths.skillInstallations)
    const installationManager = new SkillInstallationManager({
        store: installationStore,
        managedSkillStore,
        managedSkillManager,
        runtimeRegistry: {
            createClient: (descriptor, clientOptions) =>
                runtimeServices.createClient(descriptor.runtimeId, clientOptions),
        },
        getRuntimes: () => runtimeServices.list(),
        workspaceRoot,
        traceDirectory: join(paths.traces, "skill-installations"),
        resolvePermission: (providerId, permissionMode) =>
            resolveRuntimePermission(providerId, permissionMode, store.read().settings),
        requestPermission: options.requestRuntimePermission ?? null,
        requestQuestion: options.requestRuntimeQuestion ?? null,
        onChanged: () => publish(),
    })
    const skillServices = createSkillServices({
        manager: managedSkillManager,
        installationManager,
        installationStore,
        runtimeServices,
    })
    const selectedRuntimeId = () => configStore.read().runtime?.runtimeId ?? null
    const selectedRuntimeDescriptor = () => {
        const runtimeId = selectedRuntimeId()
        return runtimeId ? runtimeServices.descriptor(runtimeId) : null
    }
    const getSelectedRuntime = () => {
        const runtimeId = selectedRuntimeId()
        if (!runtimeId) throw new Error("Select a Runtime before starting an Agent task")
        return runtimeServices.getClient(runtimeId, {nonInteractive: false})
    }
    const curationManager = options.curationManager ?? new CurationManager({
        store,
        getRuntime: getSelectedRuntime,
        getRuntimeDescriptor: selectedRuntimeDescriptor,
        onChanged: () => publish(),
    })
    const rubricManager = options.rubricManager ?? new RubricManager({
        store,
        getRuntime: getSelectedRuntime,
        getRuntimeDescriptor: selectedRuntimeDescriptor,
        onChanged: () => publish(),
    })
    const refreshManager = options.caseRefreshManager ?? {
        async createSession({runtimeId, datasetId, caseId}) {
            const selectedRuntimeId = runtimeId ?? configStore.read().runtime?.runtimeId
            if (!selectedRuntimeId) throw new Error("Select a Runtime before refreshing Cases")
            const descriptor = runtimeServices.descriptor(selectedRuntimeId)
            const getRuntime = () => runtimeServices.getClient(selectedRuntimeId, {
                nonInteractive: false,
            })
            const curationManager = new CurationManager({
                store,
                getRuntime,
                getRuntimeDescriptor: () => descriptor,
                onChanged: () => publish(),
            })
            const manager = new CaseRefreshManager({
                store,
                curationManager,
                getRuntime,
                getRuntimeDescriptor: () => descriptor,
            })
            return manager.createSession({datasetId, caseId})
        },
    }
    const recycleService = new CaseRecycleService({store, rawCaseStore})
    const caseServices = createCaseServices({
        store,
        rawCaseStore,
        recycleService,
        refreshManager,
    })
    const evaluationRunner = options.evaluationRunner ?? new EvaluationRunner({
        store,
        runtimeRegistry: {
            createClient: (descriptor, clientOptions) =>
                runtimeServices.createClient(descriptor.runtimeId, clientOptions),
        },
        workspaceRoot,
        traceDirectory: join(paths.traces, "evaluations"),
        getExecutionPolicy: () => resolveExecutionPolicy(store.read().settings),
        onChanged: () => publish(),
    })
    const evaluationServices = createEvaluationServices({
        store,
        runtimeServices,
        runner: evaluationRunner,
        onChanged: () => publish(),
        ...(options.snapshotSkill ? {snapshotSkill: options.snapshotSkill} : {}),
    })
    const operatorRuntime = options.operatorRuntime ?? (options.workerMode
        ? workerOperatorRuntime()
        : createOperatorRuntime({
        paths,
        store,
        rawCaseStore,
        managedSkillStore,
        managedSkillManager,
        installationStore,
        installationManager,
        runtimeServices,
        evaluationRunner,
        evaluationServices,
        curationManager,
        rubricManager,
        workspaceRoot,
        requestPermission: options.requestRuntimePermission ?? null,
        requestQuestion: options.requestRuntimeQuestion ?? null,
        operatorToolPath: options.operatorToolPath ?? null,
        onChanged: () => publish(),
        }))
    const operatorServices = operatorRuntime.services
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
                operatorSessions: operatorServices.operatorSummary({limit: 1}).totals.sessions,
                optimizations: operatorServices.optimizationList().length,
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
        "settings.get": () => settingsSnapshot(),
        "settings.update": ({rollingSkill = {}, plugin = {}}) => {
            if (Object.keys(rollingSkill).length > 0) store.updateSettings(rollingSkill)
            if (Object.keys(plugin).length > 0) configStore.update(plugin)
            return settingsSnapshot()
        },
        "runtimes.list": ({force = false}) => force
            ? runtimeServices.refresh()
            : runtimeServices.list(),
        "runtimes.models": ({runtimeId}) => runtimeServices.models(runtimeId),
        "evaluations.start": (input) => evaluationServices.start(input),
        "evaluations.list": (input) => evaluationServices.list(input),
        "evaluations.get": (input) => evaluationServices.get(input),
        "evaluations.cancel": (input) => evaluationServices.cancel(input),
        "skills.catalog": () => skillServices.catalog(),
        "skills.get": (input) => skillServices.get(input),
        "skills.versions": (input) => skillServices.versions(input),
        "skills.candidateBase": (input) => skillServices.candidateBase(input),
        "skills.createCandidate": (input) => skillServices.createCandidate(input),
        "skills.release": (input) => skillServices.release(input),
        "skills.deprecate": (input) => skillServices.deprecate(input),
        "skills.import": (input) => skillServices.importSource(input),
        "skills.rescan": () => skillServices.rescan(),
        "installations.targets": () => skillServices.installationTargets(),
        "installations.list": (input) => skillServices.installations(input),
        "installations.get": (input) => skillServices.installation(input),
        "installations.start": (input) => skillServices.startInstallation(input),
        "installations.cancel": (input) => skillServices.cancelInstallation(input),
        "installations.inspect": (input) => skillServices.inspectInstallation(input),
        "installations.send": (input) => skillServices.sendInstallation(input),
        "operators.summary": (input) => operatorServices.operatorSummary(input),
        "operators.get": (input) => operatorServices.operatorGet(input),
        "operators.start": (input) => operatorServices.operatorStart(input),
        "operators.pause": (input) => operatorServices.operatorPause(input),
        "operators.resume": (input) => operatorServices.operatorResume(input),
        "operators.cancel": (input) => operatorServices.operatorCancel(input),
        "operators.approve": (input) => operatorServices.operatorApprove(input),
        "operators.artifacts": (input) => operatorServices.operatorArtifacts(input),
        "operators.send": (input) => operatorServices.operatorSend(input),
        "optimizations.list": () => operatorServices.optimizationList(),
        "optimizations.get": (input) => operatorServices.optimizationGet(input),
        "optimizations.preflight": (input) => operatorServices.optimizationPreflight(input),
        "optimizations.start": (input) => operatorServices.optimizationStart(input),
        "optimizations.pause": (input) => operatorServices.optimizationPause(input),
        "optimizations.resume": (input) => operatorServices.optimizationResume(input),
        "optimizations.cancel": (input) => operatorServices.optimizationCancel(input),
        "optimizations.report": (input) => operatorServices.optimizationReport(input),
        ...caseServices.methods,
    }
    const mutations = new Set([
        "datasets.create",
        "rawCases.add",
        "rawCases.update",
        "settings.update",
        "evaluations.start",
        "evaluations.cancel",
        "skills.createCandidate",
        "skills.release",
        "skills.deprecate",
        "skills.import",
        "skills.rescan",
        "installations.start",
        "installations.cancel",
        "installations.inspect",
        "installations.send",
        "operators.start",
        "operators.pause",
        "operators.resume",
        "operators.cancel",
        "operators.approve",
        "operators.send",
        "optimizations.start",
        "optimizations.pause",
        "optimizations.resume",
        "optimizations.cancel",
        "optimizations.report",
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
        await evaluationRunner.stopAll?.()
        await installationManager.stopAll?.()
        await operatorRuntime.close()
        await runtimeServices.close()
    }

    return Object.freeze({close, dispatch, snapshot, subscribe})
}

module.exports = {
    MAX_DISPATCH_BYTES,
    createRollingSkillApplication,
}
