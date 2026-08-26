const {execFile} = require("node:child_process")
const {isAbsolute, win32} = require("node:path")

const IDENTIFIER = "com.rolling-skill.dsh.capture"
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

function requiredAbsolutePath(value, label) {
    const path = String(value ?? "").trim()
    if (!path || (!isAbsolute(path) && !win32.isAbsolute(path))) {
        throw new Error(`${label} must be an absolute path`)
    }
    if (/\0|[\r\n]/u.test(path)) throw new Error(`${label} is invalid`)
    return path
}

function normalizeSchedule(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Automatic capture schedule is invalid")
    }
    if (value.cadence !== "daily" && value.cadence !== "weekly") {
        throw new Error("Automatic capture cadence is invalid")
    }
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/u.exec(String(value.time ?? ""))
    if (!match) throw new Error("Automatic capture time is invalid")
    const weekday = Number(value.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new Error("Automatic capture weekday is invalid")
    }
    return {
        cadence: value.cadence,
        time: `${match[1]}:${match[2]}`,
        hour: Number(match[1]),
        minute: Number(match[2]),
        weekday,
    }
}

function defaultRun(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, {encoding: "utf8", windowsHide: true}, (error, stdout, stderr) => {
            resolve({
                exitCode: typeof error?.code === "number" ? error.code : error ? 1 : 0,
                stdout: String(stdout ?? ""),
                stderr: String(stderr ?? error?.message ?? ""),
            })
        })
    })
}

function assertCommand(result, label) {
    if (Number(result?.exitCode ?? 1) === 0) return result
    const detail = String(result?.stderr ?? result?.stdout ?? "").trim().slice(0, 2_000)
    throw new Error(detail ? `${label}: ${detail}` : `${label} failed`)
}

async function ignoreFailure(operation) {
    try {
        return await operation()
    } catch {
        return null
    }
}

module.exports = {
    IDENTIFIER,
    WEEKDAYS,
    assertCommand,
    defaultRun,
    ignoreFailure,
    normalizeSchedule,
    requiredAbsolutePath,
}
