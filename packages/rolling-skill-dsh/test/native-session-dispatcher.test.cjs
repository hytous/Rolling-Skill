const assert = require("node:assert/strict")
const {it} = require("node:test")

it("dispatches through the native Session API, including composition and truthful failure", async () => {
    const {createNativeSessionDispatcher} = await import("../src/host/native-session-dispatcher.js")
    const calls = []
    const apiProxy = {sessions: {
        create: async (request) => {calls.push(["create", request.payload]); return {result: {ok: true, value: {sessionId: request.payload.sessionId}}}},
        prompt: async (request) => {calls.push(["prompt", request.payload]); return {result: {ok: true, value: {accepted: true}}}},
    }}
    const dispatcher = createNativeSessionDispatcher({
        createId: () => "session-1",
        apiProxy,
    })

    assert.deepEqual(await dispatcher({question: "  verbatim question  ", target: "new"}), {
        sessionId: "session-1",
        status: "queued",
    })
    assert.equal(calls[1][1].content[0].text, "  verbatim question  ")
    assert.deepEqual(calls.map(([kind]) => kind), ["create", "prompt"])

    assert.deepEqual(await dispatcher({
        question: "current question",
        target: "current",
        sessionId: "current-1",
    }), {sessionId: "current-1", status: "queued"})
    assert.equal(calls.at(-1)[1].sessionId, "current-1")
    assert.equal(calls.filter(([kind]) => kind === "create").length, 1)
    apiProxy.sessions.prompt = async () => ({result: {ok: false, error: {message: "Selected model unavailable"}}})
    await assert.rejects(() => dispatcher({question: "do not mark dispatched", target: "current", sessionId: "current-1"}), /Selected model unavailable/)
})
