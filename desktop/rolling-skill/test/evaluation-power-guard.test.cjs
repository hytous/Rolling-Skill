const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {EvaluationPowerGuard} = require("../src/evaluation-power-guard.cjs")

describe("evaluation power guard", () => {
    it("shares one prevent-app-suspension blocker across concurrent evaluation runs", () => {
        const calls = []
        const blocker = {
            start(type) {
                calls.push(["start", type])
                return 41
            },
            stop(id) {
                calls.push(["stop", id])
            },
            isStarted: () => true,
        }
        const guard = new EvaluationPowerGuard(blocker)

        const releaseFirst = guard.acquire()
        const releaseSecond = guard.acquire()
        releaseFirst()
        releaseFirst()
        assert.deepEqual(calls, [["start", "prevent-app-suspension"]])

        releaseSecond()
        assert.deepEqual(calls, [
            ["start", "prevent-app-suspension"],
            ["stop", 41],
        ])
    })

    it("fails open when Electron cannot create a blocker", () => {
        const guard = new EvaluationPowerGuard({
            start() {
                throw new Error("unavailable")
            },
        })

        const release = guard.acquire()
        assert.doesNotThrow(() => release())
        assert.equal(guard.activeLeaseCount, 0)
    })
})
