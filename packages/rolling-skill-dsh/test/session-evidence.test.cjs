const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, readdirSync, rmSync, statSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {createSessionEvidenceSource} = require("../src/host/session-evidence.cjs")

function message(id, role, text, source) {
    return {id, role, content: [{type: "text", text}], source}
}

function sessionLog() {
    return {
        session: {
            version: 0,
            id: "session-1",
            createdAt: 1_788_000_000_000,
            cwd: "/workspace",
        },
        events: [
            {seq: 0, time: 100, type: "session/end-seed", data: {}},
            {seq: 1, time: 101, type: "request/context", data: {provider: "deepseek", model: "deepseek-chat"}},
            {seq: 2, time: 102, type: "turn/start", data: {turn: 0}},
            {
                seq: 3,
                time: 103,
                type: "user/message",
                data: message("plugin-1", "user", "Workspace context", {kind: "plugin", plugin: "workspace"}),
                surfaceOp: "append",
            },
            {
                seq: 4,
                time: 104,
                type: "user/message",
                data: message("human-1", "user", "查七月账单", {kind: "user"}),
                surfaceOp: "append",
            },
            {seq: 5, time: 105, type: "step/start", data: {turn: 0, step: 0}},
            {seq: 6, time: 106, type: "tool/call", data: {turn: 0, step: 0, callId: "call-1", name: "skill", arguments: "{\"name\":\"billing\"}"}},
            {
                seq: 7,
                time: 107,
                type: "tool/result",
                data: {
                    turn: 0,
                    step: 0,
                    message: message("tool-1", "user", "七月成本 100", {kind: "tool", callId: "call-1"}),
                    meta: {
                        name: "billing",
                        provider: "local",
                        resourceBase: {kind: "directory", path: "/runtime/skills/billing"},
                    },
                },
                surfaceOp: "append",
            },
            {
                seq: 8,
                time: 108,
                type: "assistant/message",
                data: {
                    turn: 0,
                    step: 0,
                    message: message("assistant-1", "assistant", "初步结果", {kind: "model", provider: "deepseek", model: "deepseek-chat"}),
                },
                surfaceOp: "append",
            },
            {seq: 9, time: 109, type: "step/end", data: {turn: 0, step: 0}},
            {seq: 10, time: 110, type: "turn/end", data: {turn: 0, reason: {kind: "completed"}}},
            {seq: 11, time: 111, type: "turn/start", data: {turn: 1}},
            {
                seq: 12,
                time: 112,
                type: "user/message",
                data: message("human-2", "user", "按业务拆分", {kind: "user"}),
                surfaceOp: "append",
            },
            {seq: 13, time: 113, type: "step/start", data: {turn: 1, step: 0}},
            {
                seq: 14,
                time: 114,
                type: "assistant/message",
                data: {
                    turn: 1,
                    step: 0,
                    message: message("assistant-2", "assistant", "业务 A 60，业务 B 40", {kind: "model", provider: "deepseek", model: "deepseek-chat"}),
                    usage: {inputTokens: 10, outputTokens: 8},
                },
                surfaceOp: "append",
            },
            {seq: 15, time: 115, type: "step/end", data: {turn: 1, step: 0}},
            {seq: 16, time: 116, type: "turn/end", data: {turn: 1, reason: {kind: "completed"}}},
        ],
    }
}

describe("DSH trusted session evidence", () => {
    const directories = []

    afterEach(() => {
        for (const directory of directories.splice(0)) {
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it("offers only direct-human starts and rejects a forged Assistant boundary", async () => {
        const traceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evidence-"))
        directories.push(traceRoot)
        let reads = 0
        const sessionQuery = {
            async readSession(sessionId) {
                reads += 1
                assert.equal(sessionId, "session-1")
                return sessionLog()
            },
        }
        const source = createSessionEvidenceSource({sessionQuery, traceRoot})

        const inspection = await source.inspect({
            sessionId: "session-1",
            endMessageId: "assistant-2",
        })

        assert.deepEqual(inspection.startCandidates.map((entry) => entry.seq), [4, 12])
        assert.deepEqual(inspection.startCandidates.map((entry) => entry.messageId), ["human-1", "human-2"])
        await assert.rejects(
            source.capture({
                sessionId: "session-1",
                startSeq: 4,
                endMessageId: "forged-assistant",
            }),
            /finalized Assistant boundary/i,
        )
        assert.equal(reads, 2)
    })

    it("freezes one content-addressed raw slice and derives a deterministic Episode", async () => {
        const traceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evidence-"))
        directories.push(traceRoot)
        const traced = []
        const sessionQuery = {
            async readSession() {
                return sessionLog()
            },
            async traceEvent(request) {
                traced.push(request)
                return {
                    session: sessionLog().session,
                    target: {sessionId: request.sessionId, seq: request.seq, type: "assistant/message", time: 114, surface: "current"},
                    replacementChain: [],
                    replacedEventSeqs: [],
                    sourceEventSeqs: [],
                    derivedEventSeqs: [],
                }
            },
        }
        const source = createSessionEvidenceSource({sessionQuery, traceRoot})

        const first = await source.capture({
            sessionId: "session-1",
            startSeq: 4,
            endMessageId: "assistant-2",
        })
        const second = await source.capture({
            sessionId: "session-1",
            startSeq: 4,
            endMessageId: "assistant-2",
        })

        assert.match(first.source.digest, /^sha256:[a-f0-9]{64}$/u)
        assert.equal(second.source.digest, first.source.digest)
        assert.equal(second.source.snapshotPath, first.source.snapshotPath)
        assert.equal(first.episode.originalQuestion, "查七月账单")
        assert.equal(first.episode.source.digest, first.source.digest)
        assert.equal(first.episode.source.startSeq, 4)
        assert.equal(first.episode.source.endSeq, 16)
        assert.equal(first.episode.source.startTurnId, "dsh:session-1:turn:0")
        assert.equal(first.episode.source.endTurnId, "dsh:session-1:turn:1")
        assert.deepEqual(first.source.observedSkills, [{
            name: "billing",
            provider: "local",
            resourceBase: {kind: "directory", path: "/runtime/skills/billing"},
            callSeq: 6,
            resultSeq: 7,
        }])
        assert.deepEqual(first.episode.source.observedSkills, first.source.observedSkills)
        assert.deepEqual(first.episode.items.map((item) => item.id), [
            "dsh:session-1:4",
            "dsh:session-1:6",
            "dsh:session-1:8",
            "dsh:session-1:12",
            "dsh:session-1:14",
        ])
        const frozen = JSON.parse(readFileSync(first.source.snapshotPath, "utf8"))
        assert.deepEqual(frozen.events.map((event) => event.seq), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
        assert.equal(statSync(first.source.snapshotPath).mode & 0o777, 0o600)
        assert.equal(readdirSync(traceRoot).filter((name) => name.endsWith(".json")).length, 1)
        assert.deepEqual(traced, [
            {sessionId: "session-1", seq: 4},
            {sessionId: "session-1", seq: 14},
            {sessionId: "session-1", seq: 4},
            {sessionId: "session-1", seq: 14},
        ])
    })

    it("reconstructs only an exact legacy source range without requiring trace lookup", async () => {
        const traceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evidence-"))
        directories.push(traceRoot)
        const source = createSessionEvidenceSource({
            sessionQuery: {async readSession() { return sessionLog() }},
            traceRoot,
        })

        const episode = await source.readRange({
            sessionId: "session-1",
            startSeq: 4,
            endSeq: 14,
        })

        assert.equal(episode.originalQuestion, "查七月账单")
        assert.deepEqual(episode.items.map((item) => item.id), [
            "dsh:session-1:4",
            "dsh:session-1:6",
            "dsh:session-1:8",
            "dsh:session-1:12",
            "dsh:session-1:14",
        ])
        assert.equal(episode.items.some((item) => item.id === "dsh:session-1:3"), false)
        assert.equal(episode.source.startSeq, 4)
        assert.equal(episode.source.endSeq, 16)
        assert.equal(episode.source.kind, "dsh-session-live")
        assert.deepEqual(readdirSync(traceRoot), [])

        await assert.rejects(
            source.readRange({sessionId: "session-1", startSeq: 3, endSeq: 14}),
            /direct-human start boundary/u,
        )
        await assert.rejects(
            source.readRange({sessionId: "session-1", startSeq: 4, endSeq: 13}),
            /finalized Assistant boundary/u,
        )
    })

    it("derives Skill identity from the current DSH tool-result body when meta is absent", async () => {
        const traceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evidence-"))
        directories.push(traceRoot)
        const log = sessionLog()
        const result = log.events.find((event) => event.type === "tool/result")
        delete result.data.meta
        result.data.message.content = [{
            type: "tool-result",
            toolCallId: "call-1",
            isError: false,
            content: [{
                type: "text",
                text: '<skill_content name="billing">\n<skill_resources>\nBase directory for this skill: /runtime/skills/billing\n</skill_resources>\n</skill_content>',
            }],
        }]
        const sessionQuery = {
            async readSession() { return log },
            async traceEvent({sessionId, seq}) {
                return {
                    session: log.session,
                    target: {sessionId, seq, type: seq === 14 ? "assistant/message" : "user/message", time: 114, surface: "current"},
                    replacementChain: [], replacedEventSeqs: [], sourceEventSeqs: [], derivedEventSeqs: [],
                }
            },
        }
        const source = createSessionEvidenceSource({sessionQuery, traceRoot})

        const captured = await source.capture({
            sessionId: "session-1",
            startSeq: 4,
            endMessageId: "assistant-2",
        })

        assert.deepEqual(captured.source.observedSkills, [{
            name: "billing",
            provider: "dsh-skill-tool",
            resourceBase: {kind: "directory", path: "/runtime/skills/billing"},
            callSeq: 6,
            resultSeq: 7,
        }])
    })

    it("rejects an Assistant boundary that the trusted trace marks as shadowed", async () => {
        const traceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-evidence-"))
        directories.push(traceRoot)
        const sessionQuery = {
            async readSession() {
                return sessionLog()
            },
            async traceEvent({sessionId, seq}) {
                return {
                    session: sessionLog().session,
                    target: {
                        sessionId,
                        seq,
                        type: seq === 14 ? "assistant/message" : "user/message",
                        time: seq === 14 ? 114 : 104,
                        surface: seq === 14 ? "shadowed" : "current",
                    },
                    replacedBy: seq === 14 ? 20 : undefined,
                    replacementChain: seq === 14 ? [20] : [],
                    replacedEventSeqs: [],
                    sourceEventSeqs: [],
                    derivedEventSeqs: [],
                }
            },
        }
        const source = createSessionEvidenceSource({sessionQuery, traceRoot})

        await assert.rejects(
            source.capture({
                sessionId: "session-1",
                startSeq: 4,
                endMessageId: "assistant-2",
            }),
            /Assistant boundary is no longer current/i,
        )
        assert.deepEqual(readdirSync(traceRoot), [])
    })
})
