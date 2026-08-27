const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {RuntimeInteractionBroker} = require("../src/runtime-interaction-broker.cjs")

describe("Runtime interaction broker", () => {
    it("publishes bounded owner-scoped permission requests and resolves an allowed decision", async () => {
        const broker = new RuntimeInteractionBroker({timeoutMs: 60_000})
        const response = broker.requestPermission({
            jobId: "install-1",
            rpcId: "rpc-1",
            runtime: {runtimeId: "codex:one", displayName: "Codex", executablePath: "/private/codex"},
            options: [{optionId: "allow_once", label: "Allow once"}, {optionId: "reject", label: "Reject"}],
            sourceClient: {token: "secret"},
        })

        const [pending] = broker.list({ownerKind: "installation", ownerId: "install-1"})
        assert.equal(pending.kind, "permission")
        assert.doesNotMatch(JSON.stringify(pending), /private|executablePath|token|sourceClient/iu)
        broker.resolve({interactionId: pending.id, decision: "allow_once"})
        assert.equal(await response, "allow_once")
        assert.deepEqual(broker.list(), [])
        broker.close()
    })

    it("validates question ids, preserves verbatim answers, and falls back when closed", async () => {
        const broker = new RuntimeInteractionBroker({timeoutMs: 60_000})
        const response = broker.requestQuestion({
            operatorSessionId: "operator-1",
            operatorJobId: "job-1",
            rpcId: "question-1",
            questions: [{id: "confirm", prompt: "Overwrite?"}],
        })
        const [pending] = broker.list({ownerKind: "operator", ownerId: "operator-1"})
        assert.throws(() => broker.resolve({
            interactionId: pending.id,
            answers: [{questionId: "unknown", answer: "yes"}],
        }), /unknown question/iu)
        broker.resolve({
            interactionId: pending.id,
            answers: [{questionId: "confirm", answer: "继续覆盖"}],
        })
        assert.deepEqual(await response, {
            answers: [{questionId: "confirm", answer: "继续覆盖"}],
        })

        const closed = broker.requestPermission({
            operatorSessionId: "operator-2",
            options: [{optionId: "allow_once"}],
        })
        broker.close()
        assert.equal(await closed, "decline")
    })
})
