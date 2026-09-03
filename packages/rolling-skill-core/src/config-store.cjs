const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    writeFileSync,
} = require("node:fs")
const {randomUUID} = require("node:crypto")
const {dirname, isAbsolute} = require("node:path")

const CONFIG_SCHEMA = "rolling-skill-plugin-config/v1"
const LOCALES = new Set(["follow-harness", "zh-CN", "en"])
const EXECUTION_LOCATIONS = new Set(["while-harness-running", "always"])
const PROVIDERS = new Set(["codex", "codebuddy", "deepseek-harness"])
const PLATFORMS = new Set(["darwin", "linux", "win32"])
const CONFIG_FIELDS = new Set([
    "schemaVersion",
    "locale",
    "executionLocation",
    "runtime",
    "captureRuntime",
    "detectionRuntime",
    "worker",
])
const UPDATE_FIELDS = new Set(["locale", "executionLocation", "runtime", "captureRuntime", "detectionRuntime", "worker"])

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function initialConfig() {
    return {
        schemaVersion: CONFIG_SCHEMA,
        locale: "follow-harness",
        executionLocation: "while-harness-running",
        runtime: null,
        captureRuntime: null,
        detectionRuntime: null,
        worker: {
            enabled: false,
            installed: false,
            platform: null,
            lastRegistrationError: null,
        },
    }
}

function requiredText(value, label, maximum = 4_096) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function optionalText(value, label, maximum) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maximum)
}

function normalizeRuntime(value) {
    if (value === null || value === undefined) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Runtime identity must be an object")
    }
    const allowed = new Set(["providerId", "runtimeId", "displayName", "version", "executablePath"])
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`Runtime identity has unknown field ${key}`)
    }
    const providerId = requiredText(value.providerId, "Runtime provider", 100)
    if (!PROVIDERS.has(providerId)) throw new Error("Runtime provider is unsupported")
    const runtimeId = requiredText(value.runtimeId, "Runtime id", 500)
    const executablePath = requiredText(value.executablePath, "Runtime executable path", 16_384)
    if (!isAbsolute(executablePath)) throw new Error("Runtime executable path must be absolute")
    const displayName = optionalText(value.displayName, "Runtime display name", 500)
    const version = optionalText(value.version, "Runtime version", 200)
    return {
        providerId,
        runtimeId,
        ...(displayName ? {displayName} : {}),
        ...(version ? {version} : {}),
        executablePath,
    }
}

function normalizeWorker(value, base = initialConfig().worker) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Worker configuration must be an object")
    }
    const allowed = new Set(["enabled", "installed", "platform", "lastRegistrationError"])
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new Error(`Worker configuration has unknown field ${key}`)
    }
    const platform = Object.hasOwn(value, "platform") ? value.platform : base.platform
    if (platform !== null && !PLATFORMS.has(platform)) throw new Error("Worker platform is unsupported")
    const error = Object.hasOwn(value, "lastRegistrationError")
        ? optionalText(value.lastRegistrationError, "Worker registration error", 4_000)
        : base.lastRegistrationError
    return {
        enabled: Object.hasOwn(value, "enabled") ? Boolean(value.enabled) : Boolean(base.enabled),
        installed: Object.hasOwn(value, "installed") ? Boolean(value.installed) : Boolean(base.installed),
        platform,
        lastRegistrationError: error,
    }
}

function normalizeConfig(value) {
    const defaults = initialConfig()
    if (!value || typeof value !== "object" || Array.isArray(value)) return defaults
    for (const key of Object.keys(value)) {
        if (!CONFIG_FIELDS.has(key)) throw new Error(`Plugin configuration has unknown field ${key}`)
    }
    const locale = value.locale ?? defaults.locale
    if (!LOCALES.has(locale)) throw new Error("Plugin locale is unsupported")
    const executionLocation = value.executionLocation ?? defaults.executionLocation
    if (!EXECUTION_LOCATIONS.has(executionLocation)) {
        throw new Error("Plugin execution location is unsupported")
    }
    const runtime = normalizeRuntime(value.runtime)
    // Freeze the old shared selection when loading a legacy configuration.
    const captureRuntime = normalizeRuntime(Object.hasOwn(value, "captureRuntime") ? value.captureRuntime : value.runtime)
    const detectionRuntime = normalizeRuntime(Object.hasOwn(value, "detectionRuntime") ? value.detectionRuntime : value.runtime)
    if (executionLocation === "always" && !(captureRuntime ?? runtime)) {
        throw new Error("Always-on execution requires a Runtime")
    }
    return {
        schemaVersion: CONFIG_SCHEMA,
        locale,
        executionLocation,
        runtime,
        captureRuntime,
        detectionRuntime,
        worker: normalizeWorker(value.worker ?? defaults.worker, defaults.worker),
    }
}

class RollingSkillConfigStore {
    constructor(path) {
        if (!isAbsolute(path)) throw new Error("Plugin configuration path must be absolute")
        this.path = path
        this.state = null
    }

    load() {
        if (this.state) return this.state
        this.state = existsSync(this.path)
            ? normalizeConfig(JSON.parse(readFileSync(this.path, "utf8")))
            : initialConfig()
        this.persist()
        return this.state
    }

    persist() {
        mkdirSync(dirname(this.path), {recursive: true, mode: 0o700})
        const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, {mode: 0o600})
        chmodSync(temporary, 0o600)
        renameSync(temporary, this.path)
        chmodSync(this.path, 0o600)
    }

    read() {
        return copy(this.load())
    }

    update(patch = {}) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
            throw new Error("Plugin configuration update must be an object")
        }
        for (const key of Object.keys(patch)) {
            if (!UPDATE_FIELDS.has(key)) throw new Error(`Plugin configuration has unknown field ${key}`)
        }
        const current = this.load()
        this.state = normalizeConfig({
            ...current,
            ...patch,
            worker: Object.hasOwn(patch, "worker")
                ? normalizeWorker(patch.worker, current.worker)
                : current.worker,
        })
        this.persist()
        return this.read()
    }
}

module.exports = {
    CONFIG_SCHEMA,
    RollingSkillConfigStore,
    initialConfig,
    normalizeConfig,
}
