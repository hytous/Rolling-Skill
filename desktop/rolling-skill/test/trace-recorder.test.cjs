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
        const recorder = new TraceRecorder(directory, {sessionId: "session-test"})

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
    })
})

