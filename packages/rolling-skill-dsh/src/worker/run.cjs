const {
    appendFileSync,
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} = require("node:fs")
const {dirname, isAbsolute} = require("node:path")

const {
    AutomaticCaptureStateStore,
} = require("../../../../desktop/rolling-skill/src/automatic-capture-state-store.cjs")
const {
    RollingSkillConfigStore,
} = require("../../../rolling-skill-core/src/config-store.cjs")
const {
    ensureDataLayout,
    resolveDataPaths,
} = require("../../../rolling-skill-core/src/data-root.cjs")
const {
    acquireRunLease,
} = require("../../../rolling-skill-core/src/run-lease.cjs")

const MAX_WORKER_LOG_BYTES = 1024 * 1024
const RETAINED_WORKER_LOG_BYTES = 512 * 1024

function normalizedSlot(value) {
    const date = new Date(String(value ?? ""))
    if (!Number.isFinite(date.getTime())) throw new Error("Worker slot must be an ISO timestamp")
    return date.toISOString()
}

function parseWorkerArguments(argv = []) {
    if (!Array.isArray(argv)) throw new Error("Worker arguments are invalid")
    const result = {dataRoot: null, slot: null}
    for (let index = 0; index < argv.length; index += 2) {
        const option = argv[index]
        const value = argv[index + 1]
        if (option !== "--data-root" && option !== "--slot") {
            throw new Error(`Unknown option: ${String(option)}`)
        }
        if (!value || value.startsWith("--")) throw new Error(`Worker option ${option} requires a value`)
        if (option === "--data-root") result.dataRoot = value
        else result.slot = value
    }
    if (!result.dataRoot || !isAbsolute(result.dataRoot)) {
        throw new Error("Worker data root must be an absolute path")
    }
    if (!result.slot) throw new Error("Worker slot is required")
    return {dataRoot: result.dataRoot, slot: normalizedSlot(result.slot)}
}

function appendWorkerLog(path, record) {
    mkdirSync(dirname(path), {recursive: true, mode: 0o700})
    const entry = `${JSON.stringify({at: new Date().toISOString(), ...record})}\n`
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(entry) > MAX_WORKER_LOG_BYTES) {
        const current = readFileSync(path)
        const retained = current.subarray(Math.max(0, current.length - RETAINED_WORKER_LOG_BYTES))
        const newline = retained.indexOf(0x0a)
        writeFileSync(path, newline >= 0 ? retained.subarray(newline + 1) : retained, {mode: 0o600})
    }
    appendFileSync(path, entry, {encoding: "utf8", mode: 0o600})
    chmodSync(path, 0o600)
}

function assertRunning(signal) {
    if (!signal?.aborted) return
    throw Object.assign(new Error("Rolling Skill Worker was cancelled"), {code: "ABORTED"})
}

async function defaultCreateApplication(options) {
    const {createRollingSkillApplication} = require("../../../rolling-skill-core/src/index.cjs")
    return createRollingSkillApplication(options)
}

async function runWorker({
    dataRoot,
    slot,
    signal = null,
    createApplication = defaultCreateApplication,
    acquireLease = acquireRunLease,
} = {}) {
    if (typeof dataRoot !== "string" || !isAbsolute(dataRoot)) {
        throw new Error("Worker data root must be an absolute path")
    }
    const normalized = normalizedSlot(slot)
    const paths = ensureDataLayout(resolveDataPaths({dataRoot}))
    const config = new RollingSkillConfigStore(paths.config).read()
    if (
        config.executionLocation !== "always" ||
        config.worker.enabled !== true ||
        config.runtime === null
    ) {
        appendWorkerLog(paths.workerLog, {status: "disabled", slot: normalized})
        return {status: "disabled", slot: normalized}
    }
    assertRunning(signal)
    const stateStore = new AutomaticCaptureStateStore(paths.automaticCaptureState)
    if (stateStore.read().lastScheduledSlot === normalized) {
        appendWorkerLog(paths.workerLog, {status: "already-completed", slot: normalized})
        return {status: "already-completed", slot: normalized}
    }
    const lease = await acquireLease(paths.locks, {slot: normalized})
    let application = null
    try {
        assertRunning(signal)
        if (stateStore.read().lastScheduledSlot === normalized) {
            appendWorkerLog(paths.workerLog, {status: "already-completed", slot: normalized})
            return {status: "already-completed", slot: normalized}
        }
        stateStore.beginSlot(normalized)
        appendWorkerLog(paths.workerLog, {
            status: "running",
            slot: normalized,
            runtimeId: config.runtime.runtimeId,
        })
        application = await createApplication({
            dataRoot,
            workerMode: true,
            configuredRuntime: config.runtime,
        })
        const result = await application.dispatch("automatic.runOnce", {
            slot: normalized,
            idempotencyKey: `worker:${normalized}`,
        })
        assertRunning(signal)
        stateStore.completeSlot(normalized)
        appendWorkerLog(paths.workerLog, {status: "completed", slot: normalized})
        return {status: "completed", slot: normalized, result}
    } catch (error) {
        stateStore.failSlot(error)
        appendWorkerLog(paths.workerLog, {
            status: "failed",
            slot: normalized,
            error: String(error?.message ?? error).slice(0, 2_000),
        })
        throw error
    } finally {
        await Promise.allSettled([
            application?.close?.(),
            lease.release(),
        ])
    }
}

module.exports = {
    MAX_WORKER_LOG_BYTES,
    appendWorkerLog,
    parseWorkerArguments,
    runWorker,
}
