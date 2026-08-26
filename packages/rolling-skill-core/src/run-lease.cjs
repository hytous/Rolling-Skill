const {randomUUID} = require("node:crypto")
const {
    chmodSync,
    closeSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {isAbsolute, join} = require("node:path")

const LEASE_SCHEMA = "rolling-skill-run-lease/v1"
const LEASE_FILENAME = "automatic-capture.lock"
const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1_000

function timestamp(value, label) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid`)
    return date.toISOString()
}

function liveProcess(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error?.code === "EPERM"
    }
}

function busy(record = null) {
    return Object.assign(new Error("Rolling Skill automatic capture is already running"), {
        code: "LEASE_BUSY",
        ...(record?.slot ? {slot: record.slot} : {}),
    })
}

function readLease(path) {
    try {
        const value = JSON.parse(readFileSync(path, "utf8"))
        if (
            value?.schemaVersion !== LEASE_SCHEMA ||
            typeof value.token !== "string" || !value.token ||
            typeof value.slot !== "string" || !value.slot ||
            !Number.isSafeInteger(value.pid) || value.pid <= 0 ||
            typeof value.acquiredAt !== "string"
        ) return null
        timestamp(value.acquiredAt, "Run lease acquisition time")
        return value
    } catch {
        return null
    }
}

async function acquireRunLease(lockDirectory, {
    slot,
    pid = process.pid,
    now = () => new Date(),
    isProcessAlive = liveProcess,
    staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
    if (typeof lockDirectory !== "string" || !isAbsolute(lockDirectory)) {
        throw new Error("Rolling Skill lock directory must be absolute")
    }
    const normalizedSlot = timestamp(slot, "Run lease slot")
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Run lease pid is invalid")
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1) {
        throw new Error("Run lease stale timeout is invalid")
    }
    mkdirSync(lockDirectory, {recursive: true, mode: 0o700})
    chmodSync(lockDirectory, 0o700)
    const path = join(lockDirectory, LEASE_FILENAME)
    const token = randomUUID()
    let recovered = false

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const acquiredAt = timestamp(now(), "Run lease clock")
        const record = {
            schemaVersion: LEASE_SCHEMA,
            token,
            slot: normalizedSlot,
            pid,
            acquiredAt,
        }
        let descriptor
        try {
            descriptor = openSync(path, "wx", 0o600)
            writeFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8")
            closeSync(descriptor)
            chmodSync(path, 0o600)
        } catch (error) {
            if (descriptor !== undefined) {
                try { closeSync(descriptor) } catch {}
            }
            if (error?.code !== "EEXIST") throw error
            const current = readLease(path)
            if (!current) throw busy()
            const age = Date.parse(acquiredAt) - Date.parse(current.acquiredAt)
            const stale = age >= staleAfterMs || !isProcessAlive(current.pid)
            if (!stale) throw busy(current)
            const quarantine = join(lockDirectory, `${LEASE_FILENAME}.stale-${randomUUID()}`)
            try {
                renameSync(path, quarantine)
                recovered = true
                try { unlinkSync(quarantine) } catch {}
                continue
            } catch (renameError) {
                if (["ENOENT", "EEXIST"].includes(renameError?.code)) continue
                throw renameError
            }
        }

        let released = false
        return Object.freeze({
            path,
            slot: normalizedSlot,
            pid,
            acquiredAt,
            recovered,
            async release() {
                if (released) return false
                const current = readLease(path)
                if (current?.token !== token) return false
                try {
                    unlinkSync(path)
                    released = true
                    return true
                } catch (error) {
                    if (error?.code === "ENOENT") return false
                    throw error
                }
            },
        })
    }
    throw busy()
}

module.exports = {
    DEFAULT_STALE_AFTER_MS,
    LEASE_FILENAME,
    LEASE_SCHEMA,
    acquireRunLease,
}
