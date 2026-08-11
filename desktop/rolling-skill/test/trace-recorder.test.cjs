const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {TraceRecorder} = require("../src/trace-recorder.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

describe("local app-server trace recorder", () => {
    it("appends ordered inbound and outbound JSONL with stable references", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {
            sessionId: "session-test",
            runtime: {runtimeId: "codex:local", providerId: "codex", version: "0.147.0"},
        })

        const first = recorder.record("outbound", {id: 1, method: "initialize"})
        const second = recorder.record("inbound", {id: 1, result: {userAgent: "Codex"}})

        assert.match(first.reference, /^trace:\/\/session-test\.jsonl#L1$/)
        assert.match(second.reference, /^trace:\/\/session-test\.jsonl#L2$/)
        const lines = readFileSync(recorder.path, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        assert.deepEqual(
            lines.map((line) => line.direction),
            ["outbound", "inbound"],
        )
        assert.equal(lines[1].message.result.userAgent, "Codex")
        assert.deepEqual(lines[1].runtime, {
            runtimeId: "codex:local",
            providerId: "codex",
            version: "0.147.0",
        })
    })

    it("freezes a stable line range for the selected source episode", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "episode-range"})
        recorder.record("inbound", {
            method: "item/started",
            params: {threadId: "thread-1", turnId: "turn-1", item: {id: "user-1"}},
        })
        recorder.record("inbound", {
            method: "item/completed",
            params: {threadId: "other-thread", item: {id: "other"}},
        })
        recorder.record("inbound", {
            method: "item/agentMessage/delta",
            params: {threadId: "thread-1", turnId: "turn-1", itemId: "answer-1", delta: "x"},
        })
        recorder.record("inbound", {
            method: "item/completed",
            params: {threadId: "thread-1", turnId: "turn-1", item: {id: "answer-1"}},
        })

        assert.equal(
            recorder.referenceForEpisode({
                threadId: "thread-1",
                startItemId: "user-1",
                endItemId: "answer-1",
            }),
            "trace://episode-range.jsonl#L1-L4",
        )
    })

    it("uses the thread/read response as frozen trace evidence for historical episodes", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "historical-range"})
        recorder.record("outbound", {id: 7, method: "thread/read", params: {threadId: "thread-1"}})
        recorder.record("inbound", {
            id: 7,
            result: {
                thread: {
                    id: "thread-1",
                    turns: [
                        {
                            id: "turn-1",
                            items: [{id: "user-1"}, {id: "answer-1"}],
                        },
                    ],
                },
            },
        })

        assert.equal(
            recorder.referenceForEpisode({
                threadId: "thread-1",
                startItemId: "user-1",
                endItemId: "answer-1",
            }),
            "trace://historical-range.jsonl#L2-L2",
        )
    })
})
