const assert = require("node:assert/strict")
const {mkdtempSync, readFileSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {TraceRecorder} = require("../src/trace-recorder.cjs")
const {skillContentDigest} = require("../src/skill-content.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

describe("local app-server trace recorder", () => {
    it("reads trace ranges incrementally without whole-file reads", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-streaming-trace-"))
        temporaryDirectories.push(directory)
        const fs = require("node:fs")
        const modulePath = require.resolve("../src/trace-recorder.cjs")
        const originalReadFileSync = fs.readFileSync
        const source = originalReadFileSync(modulePath, "utf8")
        const IsolatedModule = module.constructor
        const isolatedModule = new IsolatedModule(modulePath, module)
        isolatedModule.filename = modulePath
        isolatedModule.paths = IsolatedModule._nodeModulePaths(require("node:path").dirname(modulePath))
        let StreamingTraceRecorder
        try {
            fs.readFileSync = () => {
                throw new Error("whole-file trace reads are forbidden")
            }
            isolatedModule._compile(source, modulePath)
            StreamingTraceRecorder = isolatedModule.exports.TraceRecorder
        } finally {
            fs.readFileSync = originalReadFileSync
        }
        const recorder = new StreamingTraceRecorder(directory, {sessionId: "streaming"})
        const mark = recorder.mark()
        recorder.record("inbound", {
            method: "item/started",
            params: {threadId: "thread-1", turnId: "turn-1", item: {id: "user-1", type: "userMessage"}},
        })
        recorder.record("inbound", {
            method: "item/agentMessage/delta",
            params: {threadId: "thread-1", turnId: "turn-1", itemId: "answer-1", delta: "answer"},
        })
        recorder.record("inbound", {
            method: "item/completed",
            params: {threadId: "thread-1", turnId: "turn-1", item: {id: "answer-1", type: "agentMessage", text: "answer"}},
        })

        const reference = recorder.referenceFrom(mark)
        const evidence = recorder.evidenceForReference(reference)

        assert.equal(evidence.reference, "trace://streaming.jsonl#L1-L3")
        assert.deepEqual(recorder.readRecent(1).map((entry) => entry.sequence), [3])
        assert.equal(
            recorder.referenceForEpisode({
                threadId: "thread-1",
                startItemId: "user-1",
                endItemId: "answer-1",
            }),
            "trace://streaming.jsonl#L1-L3",
        )
    })

    it("keeps DSH tool/result evidence and complete Case coverage instead of filling the budget with token chunks", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-dsh-trace-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "dsh"})
        recorder.record("inbound", {method: "events.mux", params: {type: "session/event", sessionId: "other", event: {type: "assistant/message", data: {message: {content: [{type: "text", text: "Other Case"}]}}}}})
        const mark = recorder.mark()
        const record = (type, data) => recorder.record("inbound", {method: "events.mux", params: {type: "session/event", sessionId: "current", event: {type, data}}})
        record("turn/start", {turn: 1})
        for (let index = 0; index < 850; index++) record("assistant/chunk", {text: "token"})
        record("tool/call", {callId: "load", name: "skill", arguments: {name: "incident-response-planner"}})
        const tool = record("tool/result", {message: {source: {callId: "load"}, content: [{type: "text", text: "Skill body ".repeat(3000)}]}, meta: {name: "incident-response-planner", provider: "dsh-skill-tool", resourceBase: {kind: "directory", path: "/skills/incident-response-planner"}}, error: null})
        record("assistant/message", {message: {content: [{type: "text", text: "Current Case answer"}]}})
        record("turn/end", {turn: 1})
        const evidence = recorder.evidenceForReference(recorder.referenceFrom(mark), {maxEntries: 20, maxTotalCharacters: 12000})
        assert.equal(evidence.semanticCoverageComplete, true)
        assert.equal(evidence.compactedEntries, 850)
        assert.ok(evidence.entries.some((entry) => entry.sequence === tool.entry.sequence))
        const {buildEvidenceCatalog} = require("../src/evaluation-evidence-catalog.cjs")
        const catalog = buildEvidenceCatalog({traceEvidence: evidence})
        assert.deepEqual(catalog.entries.find((entry) => entry.id === `trace:L${tool.entry.sequence}`).kinds, ["skill_activation", "skill_read", "tool_call"])
        assert.doesNotMatch(JSON.stringify(evidence), /Other Case/)
        assert.match(JSON.stringify(evidence), /Current Case answer/)
    })
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

    it("records only a compact identity index for historical thread responses", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-history-trace-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "history-index"})
        const oversizedPayload = "oversized-history-payload-".repeat(4_000)
        const response = {
            id: 7,
            result: {
                thread: {
                    id: "thread-1",
                    cwd: "/workspace",
                    turns: [{
                        id: "turn-1",
                        status: "completed",
                        items: [
                            {id: "user-1", type: "userMessage", content: [{type: "text", text: "question"}]},
                            {id: "tool-1", type: "commandExecution", aggregatedOutput: oversizedPayload},
                            {id: "answer-1", type: "agentMessage", text: "answer"},
                        ],
                    }],
                },
            },
        }
        recorder.record("outbound", {
            id: 7,
            method: "thread/read",
            params: {threadId: "thread-1", includeTurns: true},
        })
        recorder.record("inbound", {
            id: 7,
            method: "item/tool/call",
            params: {threadId: "operator-thread", callId: "tool-call-1"},
        })
        recorder.record("inbound", response)

        const traceText = readFileSync(recorder.path, "utf8")

        assert.doesNotMatch(traceText, /oversized-history-payload/u)
        assert.match(traceText, /user-1/u)
        assert.match(traceText, /tool-1/u)
        assert.match(traceText, /answer-1/u)
        assert.equal(response.result.thread.turns[0].items[1].aggregatedOutput, oversizedPayload)
        assert.equal(
            recorder.referenceForEpisode({
                threadId: "thread-1",
                startItemId: "user-1",
                endItemId: "answer-1",
            }),
            "trace://history-index.jsonl#L3-L3",
        )
    })

    it("freezes an exact range from a mark and produces bounded Judge evidence", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "evaluation-range"})
        recorder.record("outbound", {id: 1, method: "initialize"})
        const mark = recorder.mark()
        recorder.record("outbound", {
            id: 2,
            method: "turn/start",
            params: {threadId: "thread-1", input: [{type: "text", text: "question"}]},
        })
        recorder.record("inbound", {
            method: "item/completed",
            params: {
                threadId: "thread-1",
                item: {
                    type: "commandExecution",
                    command: "billing-cli query --month 2026-07",
                    status: "completed",
                    aggregatedOutput: "x".repeat(20_000),
                },
            },
        })

        const reference = recorder.referenceFrom(mark)
        assert.equal(reference, "trace://evaluation-range.jsonl#L2-L3")
        const evidence = recorder.evidenceForReference(reference, {
            maxEntryCharacters: 500,
            maxTotalCharacters: 2_000,
        })
        assert.equal(evidence.reference, reference)
        assert.equal(evidence.entries.length, 2)
        assert.equal(evidence.entries[1].sequence, 3)
        assert.equal(evidence.entries[1].contentCompacted, true)
        assert.equal(evidence.truncated, false)
        assert.equal(evidence.semanticCoverageComplete, true)
        assert.match(evidence.digest, /^sha256:[a-f0-9]{64}$/)
        assert.ok(JSON.stringify(evidence).length < 3_000)
    })

    it("scans the full range and compacts protocol noise without losing semantic evidence", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "semantic-range"})
        const mark = recorder.mark()
        for (let index = 0; index < 2_400; index += 1) {
            recorder.record("inbound", {
                method: index % 2 ? "item/agentMessage/delta" : "thread/tokenUsage/updated",
                params: {delta: "protocol-noise", index},
            })
            if (index === 700) {
                recorder.record("inbound", {
                    method: "session/update",
                    params: {
                        update: {
                            sessionUpdate: "tool_call",
                            toolCallId: "skill-call",
                            kind: "other",
                            status: "pending",
                            rawInput: {skill: "billing-cost-management"},
                            _meta: {"codebuddy.ai/toolName": "Skill"},
                        },
                    },
                })
            }
            if (index === 1_300) {
                recorder.record("inbound", {
                    method: "session/update",
                    params: {
                        update: {
                            sessionUpdate: "tool_call",
                            toolCallId: "reference-call",
                            kind: "read",
                            status: "pending",
                            rawInput: {file_path: "/skills/billing/references/query.md"},
                        },
                    },
                })
            }
        }
        const fullCommand = `billing-cli query --page-size 100 --cursor ${"x".repeat(700)}`
        recorder.record("inbound", {
            method: "session/update",
            params: {
                update: {
                    sessionUpdate: "tool_call",
                    toolCallId: "command-call",
                    kind: "execute",
                    status: "pending",
                    rawInput: {command: fullCommand},
                },
            },
        })
        recorder.record("inbound", {
            method: "session/update",
            params: {
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: "command-call",
                    status: "failed",
                    rawOutput: {type: "text", text: "failure output ".repeat(2_000)},
                    error: {code: "E_QUERY"},
                },
            },
        })

        const evidence = recorder.evidenceForReference(recorder.referenceFrom(mark), {
            maxEntryCharacters: 2_000,
            maxTotalCharacters: 20_000,
        })

        assert.deepEqual(
            evidence.entries.map((entry) => entry.sequence),
            [...evidence.entries.map((entry) => entry.sequence)].sort((left, right) => left - right),
        )
        assert.equal(evidence.sourceEntryCount, 2_404)
        assert.equal(evidence.includedEntries, 3)
        assert.equal(evidence.compactedEntries, 2_401)
        assert.equal(evidence.collapsedToolCallEntries, 1)
        assert.equal(evidence.omittedImportantEntries, 0)
        assert.equal(evidence.samplingStrategy, "semantic-v2")
        assert.equal(evidence.semanticCoverageComplete, true)
        assert.equal(evidence.truncated, false)
        assert.ok(evidence.entries.some((entry) => entry.sequence > 2_400))
        const completion = evidence.entries.find((entry) =>
            entry.message?.params?.update?.toolCallId === "command-call" &&
            entry.message?.params?.update?.sessionUpdate === "tool_call_update",
        )
        assert.equal(completion.message.params.update.rawInput.command, fullCommand)
        assert.equal(completion.message.params.update.startedSequence, 2_403)
        assert.equal(completion.contentCompacted, true)
        assert.ok(JSON.stringify(completion).length <= 2_200)
        assert.ok(evidence.entries.some((entry) =>
            entry.message?.params?.update?.toolCallId === "skill-call" &&
            entry.message?.params?.update?.sessionUpdate === "tool_call",
        ), "an unfinished tool call must retain its start event")
    })

    it("merges a completed CodeBuddy Skill call and fingerprints the unabridged output", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "skill-call"})
        const mark = recorder.mark()
        const frozenSkill = "---\nname: billing-cost-management\ndescription: costs\n---\n\n# Billing\n\nUse the CLI first.\n"
        recorder.record("inbound", {
            method: "session/update",
            params: {update: {
                sessionUpdate: "tool_call",
                toolCallId: "skill-1",
                title: "Skill",
                status: "pending",
                rawInput: {skill: "billing-cost-management"},
            }},
        })
        recorder.record("inbound", {
            method: "session/update",
            params: {update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "skill-1",
                status: "completed",
                rawOutput: {
                    type: "text",
                    text: "Base directory for this skill: /Users/test/.codebuddy/skills/billing-cost-management\n# Billing\n\nUse the CLI first.\n",
                },
                _meta: {"codebuddy.ai/rawResponse": "duplicated output that must not enter Judge evidence"},
            }},
        })

        const evidence = recorder.evidenceForReference(recorder.referenceFrom(mark), {
            maxEntryCharacters: 800,
        })

        assert.equal(evidence.entries.length, 1)
        assert.equal(evidence.collapsedToolCallEntries, 1)
        const update = evidence.entries[0].message.params.update
        assert.equal(update.sessionUpdate, "tool_call_update")
        assert.equal(update.startedSequence, 1)
        assert.deepEqual(update.rawInput, {skill: "billing-cost-management"})
        assert.match(update.rawOutputDigest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(update.skillContentDigest, skillContentDigest(frozenSkill))
        assert.equal(update._meta["codebuddy.ai/rawResponse"], undefined)
    })

    it("marks semantic coverage incomplete only when important events exceed the bound", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "semantic-overflow"})
        const mark = recorder.mark()
        for (let index = 0; index < 5; index += 1) {
            recorder.record("inbound", {
                method: "item/completed",
                params: {item: {type: "commandExecution", command: `billing-cli query ${index}`, status: "completed"}},
            })
        }

        const evidence = recorder.evidenceForReference(recorder.referenceFrom(mark), {maxEntries: 2})

        assert.equal(evidence.includedEntries, 2)
        assert.equal(evidence.omittedImportantEntries, 3)
        assert.equal(evidence.semanticCoverageComplete, false)
        assert.equal(evidence.truncated, true)
    })

    it("rejects trace references that do not belong to this recorder", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-traces-"))
        temporaryDirectories.push(directory)
        const recorder = new TraceRecorder(directory, {sessionId: "safe-range"})
        recorder.record("inbound", {method: "turn/completed"})

        assert.throws(
            () => recorder.evidenceForReference("trace://../other.jsonl#L1-L2"),
            /trace reference/i,
        )
        assert.throws(
            () => recorder.evidenceForReference("trace://safe-range.jsonl#L0-L999999"),
            /trace reference/i,
        )
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
