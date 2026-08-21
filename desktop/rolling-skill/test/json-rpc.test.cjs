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

    it("pauses when onMessage returns false and drains retained bytes on resume", () => {
        const messages = []
        const decoder = new JsonLineDecoder((message) => {
            messages.push(message)
            return messages.length !== 1
        }, () => {}, {maximumBufferBytes: 100})

        assert.equal(decoder.push('{"id":1}\n{"id":2}\n'), false)
        decoder.push('{"id":3}\n')
        assert.deepEqual(messages, [{id: 1}])
        assert.equal(decoder.resume(), true)
        assert.deepEqual(messages, [{id: 1}, {id: 2}, {id: 3}])
    })

    it("still enforces the byte limit while message delivery is paused", () => {
        const errors = []
        const decoder = new JsonLineDecoder(
            () => false,
            (error) => errors.push(error),
            {maximumBufferBytes: 16},
        )

        assert.equal(decoder.push('{"id":1}\n'), false)
        assert.equal(decoder.push(Buffer.alloc(17, 0x61)), false)
        assert.equal(decoder.resume(), false)
        assert.equal(errors.length, 1)
        assert.match(errors[0].message, /maximum buffer/i)
    })

    it("terminates on invalid UTF-8, including a truncated final sequence", () => {
        const messages = []
        const errors = []
        const decoder = new JsonLineDecoder(
            (message) => messages.push(message),
            (error, line) => errors.push({error, line}),
        )
        const prefix = Buffer.from('{"value":"')
        const suffix = Buffer.from('"}\n')

        assert.equal(
            decoder.push(Buffer.concat([prefix, Buffer.from([0xc0, 0xaf]), suffix])),
            false,
        )
        const character = Buffer.from("界")
        decoder.push(Buffer.concat([prefix, character.subarray(0, 1)]))
        decoder.push(Buffer.concat([character.subarray(1), suffix]))

        assert.equal(errors.length, 1)
        assert.match(errors[0].error.message, /utf-?8|encoded data/i)
        assert.equal(errors[0].line, null)
        assert.deepEqual(messages, [])

        const truncatedErrors = []
        const truncated = new JsonLineDecoder(
            () => assert.fail("truncated UTF-8 must not decode"),
            (error) => truncatedErrors.push(error),
        )
        assert.equal(truncated.end(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xe7])), false)
        assert.equal(truncatedErrors.length, 1)
    })

    it("accepts a valid multibyte UTF-8 sequence split across chunks", () => {
        const messages = []
        const decoder = new JsonLineDecoder((message) => messages.push(message))
        const character = Buffer.from("界")

        decoder.push(Buffer.concat([Buffer.from('{"value":"'), character.subarray(0, 1)]))
        decoder.push(Buffer.concat([character.subarray(1), Buffer.from('"}\n')]))

        assert.deepEqual(messages, [{value: "界"}])
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
