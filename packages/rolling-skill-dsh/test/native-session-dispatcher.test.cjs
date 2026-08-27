const assert = require("node:assert/strict")
const {it} = require("node:test")
const {pathToFileURL} = require("node:url")
const {join} = require("node:path")

it("dispatches a Raw Case verbatim into a new native DSH Session", async () => {
    const {createNativeSessionDispatcher} = await import(pathToFileURL(join(
        __dirname,
        "../src/host/native-session-dispatcher.js",
    )))
    const calls = []
    const dispatcher = createNativeSessionDispatcher({
        createId: () => "session-1",
        createMessage: (value) => ({id: "message-1", role: "user", ...value}),
        agents: {
            get(sessionId) {
                return sessionId === "current-1"
                    ? {followup: (message) => calls.push(["current-followup", message])}
                    : null
            },
            async create(input) {
                calls.push(["create", input])
                return {
                    agent: {followup: (message) => calls.push(["followup", message])},
                    dispose: async () => calls.push(["dispose"]),
                }
            },
        },
    })

    assert.deepEqual(await dispatcher({question: "  verbatim question  ", target: "new"}), {
        sessionId: "session-1",
        status: "queued",
    })
    assert.equal(calls[1][1].content[0].text, "  verbatim question  ")
    assert.deepEqual(calls.map(([kind]) => kind), ["create", "followup"])

    assert.deepEqual(await dispatcher({
        question: "current question",
        target: "current",
        sessionId: "current-1",
    }), {sessionId: "current-1", status: "queued"})
    assert.equal(calls.at(-1)[0], "current-followup")
})
