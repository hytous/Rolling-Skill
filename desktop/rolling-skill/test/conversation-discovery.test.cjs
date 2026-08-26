const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    dueCaptureSlot,
    nextScheduledSlot,
    previousScheduledSlot,
} = require("../src/conversation-discovery.cjs")

function localDate(year, month, day, hour, minute) {
    return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function parts(date) {
    return [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getDay(),
    ]
}

describe("scheduled conversation discovery helpers", () => {
    it("finds daily slots before and after local schedule time across month and year", () => {
        const schedule = {cadence: "daily", time: "09:00", weekday: 1}

        assert.deepEqual(parts(previousScheduledSlot(localDate(2027, 1, 1, 8, 30), schedule)), [
            2026, 12, 31, 9, 0, 4,
        ])
        assert.deepEqual(parts(previousScheduledSlot(localDate(2027, 1, 1, 9, 5), schedule)), [
            2027, 1, 1, 9, 0, 5,
        ])
        assert.deepEqual(parts(nextScheduledSlot(localDate(2026, 2, 28, 9, 5), schedule)), [
            2026, 3, 1, 9, 0, 0,
        ])
    })

    it("finds weekly slots on the selected weekday before and after local time", () => {
        const schedule = {cadence: "weekly", time: "18:30", weekday: 3}

        assert.deepEqual(parts(previousScheduledSlot(localDate(2026, 8, 26, 18, 20), schedule)), [
            2026, 8, 19, 18, 30, 3,
        ])
        assert.deepEqual(parts(previousScheduledSlot(localDate(2026, 8, 26, 18, 40), schedule)), [
            2026, 8, 26, 18, 30, 3,
        ])
        assert.deepEqual(parts(nextScheduledSlot(localDate(2026, 8, 26, 18, 40), schedule)), [
            2026, 9, 2, 18, 30, 3,
        ])
    })

    it("collapses first-run and multiple missed slots to the latest due slot", () => {
        const now = localDate(2026, 8, 26, 9, 5)
        const schedule = {cadence: "daily", time: "09:00", weekday: 1}
        const latest = previousScheduledSlot(now, schedule)

        assert.equal(dueCaptureSlot({now, schedule, lastScheduledSlot: null}).toISOString(), latest.toISOString())
        assert.equal(dueCaptureSlot({
            now,
            schedule,
            lastScheduledSlot: localDate(2026, 8, 20, 9, 0).toISOString(),
        }).toISOString(), latest.toISOString())
        assert.equal(dueCaptureSlot({
            now,
            schedule,
            lastScheduledSlot: latest.toISOString(),
        }), null)
    })

    it("constructs slots from local calendar parts", () => {
        const slot = nextScheduledSlot(localDate(2026, 3, 7, 23, 30), {
            cadence: "daily",
            time: "02:15",
            weekday: 1,
        })
        assert.equal(slot.getHours(), 2)
        assert.equal(slot.getMinutes(), 15)
        assert.equal(slot.getDate(), 8)
    })
})
