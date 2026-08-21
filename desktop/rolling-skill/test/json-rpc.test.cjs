const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {JsonLineDecoder, RpcRequestTracker} = require("../src/json-rpc.cjs")

describe("Codex app-server JSONL framing", () => {
    it("decodes multiple messages split across arbitrary chunks", () => {
        const messages = []
        const decoder = new JsonLineDecoder((message) => messages.push(message))

        decoder.push('{"id":1,"res')
        decoder.push('ult":{"ok":true}}\n{"method":"turn/')
        decoder.push('started","params":{"threadId":"t1"}}\n\n')

        assert.deepEqual(messages, [
            {id: 1, result: {ok: true}},
            {method: "turn/started", params: {threadId: "t1"}},
        ])
    })

    it("reports malformed complete lines without losing the next message", () => {
        const messages = []
        const errors = []
        const decoder = new JsonLineDecoder(
            (message) => messages.push(message),
            (error, line) => errors.push({message: error.message, line}),
        )

        decoder.push('not-json\n{"id":2,"result":{}}\n')

        assert.equal(errors.length, 1)
        assert.equal(errors[0].line, "not-json")
        assert.deepEqual(messages, [{id: 2, result: {}}])
    })

    it("bounds incomplete frames by bytes and becomes terminal after overflow", () => {
        const messages = []
        const errors = []
        const oversizedUtf8 = '{"x":"界"}'
        assert.ok(Buffer.byteLength(oversizedUtf8, "utf8") > oversizedUtf8.length)
        const decoder = new JsonLineDecoder(
            (message) => messages.push(message),
            (error, line) => errors.push({error, line}),
            {maximumBufferBytes: oversizedUtf8.length},
        )

        decoder.push(Buffer.from(oversizedUtf8.slice(0, 6), "utf8"))
        decoder.push(Buffer.from(oversizedUtf8.slice(6), "utf8"))
        decoder.push('\n{"id":3,"result":{}}\n')

        assert.equal(errors.length, 1)
        assert.match(errors[0].error.message, /maximum buffer/i)
        assert.equal(errors[0].line, null)
        assert.deepEqual(messages, [])
    })

    it("decodes bounded multi-line chunks and a final frame without a newline", () => {
        const messages = []
        const errors = []
        const decoder = new JsonLineDecoder(
            (message) => messages.push(message),
            (error) => errors.push(error),
            {maximumBufferBytes: 10},
        )

        decoder.push('{"id":1}\n{"id":')
        decoder.push('2}\n')
        decoder.end('{"id":3}')

        assert.deepEqual(messages, [{id: 1}, {id: 2}, {id: 3}])
        assert.deepEqual(errors, [])
    })
})

describe("JSON-RPC request correlation", () => {
    it("resolves the matching pending request", async () => {
        const tracker = new RpcRequestTracker()
        const pending = tracker.create("thread/list", {limit: 20})
        assert.deepEqual(pending.message, {
            id: 1,
            method: "thread/list",
            params: {limit: 20},
        })

        assert.equal(tracker.settle({id: 1, result: {data: []}}), true)
        assert.deepEqual(await pending.promise, {data: []})
    })

    it("rejects protocol errors and all pending requests on shutdown", async () => {
        const tracker = new RpcRequestTracker()
        const failed = tracker.create("thread/read", {threadId: "missing"})
        tracker.settle({id: 1, error: {code: -32602, message: "bad thread"}})
        await assert.rejects(failed.promise, /bad thread/)

        const interrupted = tracker.create("thread/list", {})
        tracker.rejectAll(new Error("runtime exited"))
        await assert.rejects(interrupted.promise, /runtime exited/)
    })
})
