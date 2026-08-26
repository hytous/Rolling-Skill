const CAPTURE_CADENCES = new Set(["daily", "weekly"])

function scheduleParts(schedule = {}) {
    if (!CAPTURE_CADENCES.has(schedule.cadence)) {
        throw new Error("Automatic capture cadence is invalid")
    }
    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/u.exec(String(schedule.time ?? ""))
    if (!match) throw new Error("Automatic capture time is invalid")
    const weekday = Number(schedule.weekday)
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
        throw new Error("Automatic capture weekday is invalid")
    }
    return {cadence: schedule.cadence, hour: Number(match[1]), minute: Number(match[2]), weekday}
}

function localSlot(year, month, day, hour, minute) {
    return new Date(year, month, day, hour, minute, 0, 0)
}

function previousScheduledSlot(nowInput, schedule) {
    const now = new Date(nowInput)
    if (!Number.isFinite(now.getTime())) throw new Error("Automatic capture current time is invalid")
    const {cadence, hour, minute, weekday} = scheduleParts(schedule)
    const candidate = localSlot(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
    if (cadence === "daily") {
        if (candidate > now) candidate.setDate(candidate.getDate() - 1)
        return candidate
    }
    candidate.setDate(candidate.getDate() + weekday - candidate.getDay())
    if (candidate > now) candidate.setDate(candidate.getDate() - 7)
    return candidate
}

function nextScheduledSlot(nowInput, schedule) {
    const now = new Date(nowInput)
    if (!Number.isFinite(now.getTime())) throw new Error("Automatic capture current time is invalid")
    const {cadence, hour, minute, weekday} = scheduleParts(schedule)
    const candidate = localSlot(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute)
    if (cadence === "daily") {
        if (candidate <= now) candidate.setDate(candidate.getDate() + 1)
        return candidate
    }
    candidate.setDate(candidate.getDate() + weekday - candidate.getDay())
    if (candidate <= now) candidate.setDate(candidate.getDate() + 7)
    return candidate
}

function dueCaptureSlot({now = new Date(), schedule, lastScheduledSlot = null} = {}) {
    const due = previousScheduledSlot(now, schedule)
    if (!lastScheduledSlot) return due
    const satisfied = new Date(lastScheduledSlot)
    if (!Number.isFinite(satisfied.getTime())) return due
    return satisfied >= due ? null : due
}

module.exports = {
    dueCaptureSlot,
    nextScheduledSlot,
    previousScheduledSlot,
}
