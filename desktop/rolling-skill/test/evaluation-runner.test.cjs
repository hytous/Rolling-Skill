const assert = require("node:assert/strict")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {EvaluationRunner} = require("../src/evaluation-runner.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")
const {skillContentDigest} = require("../src/skill-content.cjs")
const {
    JUDGE_RESULT_SCHEMA,
    buildScoreContract,
} = require("../src/evaluation-grading.cjs")

function curatedCase(id, question) {
    return {
        id,
        question,
        curated: {
            schemaVersion: "rolling-skill-curated-case/v1",
            referenceAnswer: {
                summary: "Follow the Skill and return evidence.",
                requiredFacts: [],
                requiredSteps: ["Read the Skill"],
                requiredOutputFormat: ["Include evidence"],
                evidence: [],
            },
            grading: {
                hardRequirements: [
                    {
                        id: "H1",
                        criterion: "Uses the Skill",
                        passCondition: "The trace shows the Skill workflow",
                        evidenceBasis: "The frozen Skill requires it",
                    },
                ],
                softCriteria: [{id: "S1", criterion: "Clear answer", weight: 1}],
                automaticFailures: ["Invents unsupported facts"],
            },
        },
    }
}

function contractFromPrompt(prompt) {
    const match = prompt.match(/<score-contract>([\s\S]*?)<\/score-contract>/)
    assert.ok(match, "Judge prompt must contain a score contract")
    return JSON.parse(match[1])
}

function passingJudge(caseEntry, contract = buildScoreContract(caseEntry)) {
    return {
        schemaVersion: JUDGE_RESULT_SCHEMA,
        contractDigest: contract.digest,
        assessments: contract.criteria.map((criterion) => ({
            criterionId: criterion.id,
            status: "scored",
            rating: 10,
            confidence: 0.9,
            verificationStatus: "verified",
            verifiableFields: ["answer"],
            crossChecks: ["answer matches the frozen reference"],
            evidenceRefs: ["response"],
            rationale: "The answer is clear.",
        })),
    }
}

describe("multi-runtime evaluation runner", () => {
    it("holds and releases one run-level power lease even when execution fails", async () => {
        const events = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => {
                            throw new Error("target failed")
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
            acquireRunLease: () => {
                events.push("acquire")
                return () => events.push("release")
            },
        })

        await runner.run({
            id: "run-power-lease",
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [{
                id: "result",
                runtimeId: "target",
                status: "queued",
                caseSnapshot: curatedCase("case", "question"),
            }],
        })

        assert.deepEqual(events, ["acquire", "release"])
    })

    it("persists target failure diagnostics for post-mortem inspection", async () => {
        const resultPatches = new Map()
        const failure = Object.assign(new Error("The evaluation turn timed out"), {
            code: "EVALUATION_TURN_TIMEOUT",
            threadId: "target-thread",
            turnId: "target-turn",
            durationMs: 1234,
            lastActivityAt: "2026-08-14T01:02:03.000Z",
            traceReference: "trace://target.jsonl#L2-L9",
            traceEvidence: {reference: "trace://target.jsonl#L2-L9", entries: []},
        })
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, resultId, patch) {
                    resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
                },
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => {
                            throw failure
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        await runner.run({
            id: "run-target-diagnostics",
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [{
                id: "result",
                runtimeId: "target",
                status: "queued",
                caseSnapshot: curatedCase("case", "question"),
            }],
        })

        assert.deepEqual(resultPatches.get("result").failureDiagnostics, {
            code: "EVALUATION_TURN_TIMEOUT",
            threadId: "target-thread",
            turnId: "target-turn",
            durationMs: 1234,
            lastActivityAt: "2026-08-14T01:02:03.000Z",
            traceReference: "trace://target.jsonl#L2-L9",
            traceEvidence: {reference: "trace://target.jsonl#L2-L9", entries: []},
        })
        assert.equal(resultPatches.get("result").threadId, "target-thread")
        assert.equal(resultPatches.get("result").turnId, "target-turn")
        assert.equal(resultPatches.get("result").traceReference, "trace://target.jsonl#L2-L9")
    })

    it("continues with the next Case after a non-interactive runtime request fails fast", async () => {
        const resultPatches = new Map()
        const questions = []
        let clientOptions = null
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, resultId, patch) {
                    resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
                },
            },
            runtimeRegistry: {
                createClient(_descriptor, options) {
                    clientOptions = options
                    return {
                        start: async () => {},
                        async runEvaluationCase({question}) {
                            questions.push(question)
                            if (question === "needs-input") {
                                const error = new Error("The evaluation required an interactive user answer")
                                error.code = "EVALUATION_INTERACTION_REQUIRED"
                                throw error
                            }
                            return {response: "completed without interaction", durationMs: 1}
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        const completed = await runner.run({
            id: "run-interactive-request",
            activationMode: "automatic",
            runtimeConfigurations: [
                {runtimeId: "deepseek-harness:local", providerId: "deepseek-harness", executablePath: "/dsh"},
            ],
            results: [
                {
                    id: "result-needs-input",
                    runtimeId: "deepseek-harness:local",
                    status: "queued",
                    caseSnapshot: curatedCase("case-needs-input", "needs-input"),
                },
                {
                    id: "result-next",
                    runtimeId: "deepseek-harness:local",
                    status: "queued",
                    caseSnapshot: curatedCase("case-next", "next-case"),
                },
            ],
        })

        assert.equal(clientOptions.nonInteractive, true)
        assert.deepEqual(questions, ["needs-input", "next-case"])
        assert.equal(resultPatches.get("result-needs-input").status, "failed")
        assert.match(resultPatches.get("result-needs-input").error, /interactive user answer/)
        assert.equal(resultPatches.get("result-next").status, "completed")
        assert.equal(completed.status, "partial")
    })

    it("sends only the frozen original question to the target runtime", async () => {
        const calls = []
        const recordedInternalThreads = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
                recordInternalThread(threadId, kind) {
                    recordedInternalThreads.push({threadId, kind})
                },
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        async runEvaluationCase(input) {
                            calls.push(input)
                            input.onThreadStarted?.("evaluation-target-thread")
                            return {
                                response: "answer",
                                durationMs: 1,
                                threadId: "evaluation-target-thread",
                            }
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const caseSnapshot = {
            ...curatedCase("case-original-question", "查一下七月各业务成本。"),
            issueDescription: "历史回答把成本当成了预算。",
        }

        await runner.run({
            id: "run-original-question",
            activationMode: "automatic",
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [{
                id: "result",
                runtimeId: "target",
                status: "queued",
                caseSnapshot,
            }],
        })

        assert.equal(calls.length, 1)
        assert.equal(calls[0].question, "查一下七月各业务成本。")
        assert.equal("issueDescription" in calls[0], false)
        assert.deepEqual(recordedInternalThreads, [{
            threadId: "evaluation-target-thread",
            kind: "evaluation-target",
        }])
    })

    it("runs runtime queues concurrently and Cases sequentially within a runtime", async () => {
        const events = []
        const resolvers = new Map()
        const store = {
            updateEvaluationRun: (_runId, patch) => events.push(["run", patch.status]),
            updateEvaluationResult: (_runId, resultId, patch) => events.push([resultId, patch.status]),
        }
        const clients = new Map()
        const makeClient = (runtimeId) => ({
            async start() {
                events.push([runtimeId, "start"])
            },
            runEvaluationCase({question}) {
                events.push([runtimeId, `case:${question}`])
                return new Promise((resolve) => resolvers.set(`${runtimeId}:${question}`, resolve))
            },
            async stop() {
                events.push([runtimeId, "stop"])
            },
        })
        const registry = {
            createClient(descriptor) {
                const client = makeClient(descriptor.runtimeId)
                clients.set(descriptor.runtimeId, client)
                return client
            },
        }
        const runner = new EvaluationRunner({store, runtimeRegistry: registry, workspaceRoot: "/workspace", traceDirectory: "/traces"})
        const run = {
            id: "run-1",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", executablePath: "/a"},
                {runtimeId: "codebuddy:b", providerId: "codebuddy", executablePath: "/b"},
            ],
            results: [
                {id: "a1", caseSnapshot: {question: "q1"}, runtimeConfiguration: {runtimeId: "codex:a"}},
                {id: "a2", caseSnapshot: {question: "q2"}, runtimeConfiguration: {runtimeId: "codex:a"}},
                {id: "b1", caseSnapshot: {question: "q1"}, runtimeConfiguration: {runtimeId: "codebuddy:b"}},
                {id: "b2", caseSnapshot: {question: "q2"}, runtimeConfiguration: {runtimeId: "codebuddy:b"}},
            ],
        }

        const running = runner.run(run)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(
            events.filter(([, status]) => status === "case:q1").length,
            2,
            "both Runtime queues must start their first Case before either one resolves",
        )
        assert.equal(resolvers.has("codex:a:q1"), true)
        assert.equal(resolvers.has("codebuddy:b:q1"), true)
        assert.equal(resolvers.has("codex:a:q2"), false)
        assert.equal(resolvers.has("codebuddy:b:q2"), false)

        resolvers.get("codex:a:q1")({response: "a1", durationMs: 10})
        resolvers.get("codebuddy:b:q1")({response: "b1", durationMs: 11})
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(resolvers.has("codex:a:q2"), true)
        assert.equal(resolvers.has("codebuddy:b:q2"), true)
        resolvers.get("codex:a:q2")({response: "a2", durationMs: 12})
        resolvers.get("codebuddy:b:q2")({response: "b2", durationMs: 13})

        const completed = await running
        assert.equal(completed.status, "completed")
        assert.equal(events.some(([id, status]) => id === "run" && status === "completed"), true)
    })

    it("cancels the active Case and every not-yet-started Case without starting a Judge", async () => {
        const resultPatches = new Map()
        const runStatuses = []
        const targetQuestions = []
        let rejectActiveCase
        let activeCaseStarted
        const started = new Promise((resolve) => {
            activeCaseStarted = resolve
        })
        let targetStopCount = 0
        let judgeCreated = false
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun(_runId, patch) {
                    if (patch.status) runStatuses.push(patch.status)
                },
                updateEvaluationResult(_runId, resultId, patch) {
                    resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        judgeCreated = true
                        throw new Error("Judge must not start after cancellation")
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase({question}) {
                            targetQuestions.push(question)
                            activeCaseStarted()
                            return new Promise((_resolve, reject) => {
                                rejectActiveCase = reject
                            })
                        },
                        async stop() {
                            targetStopCount += 1
                            rejectActiveCase?.(new Error("target stopped"))
                        },
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-cancel-targets",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: ["q1", "q2", "q3"].map((question, index) => ({
                id: `result-${index + 1}`,
                runtimeId: "target",
                status: "queued",
                gradingStatus: "queued",
                caseSnapshot: curatedCase(`case-${index + 1}`, question),
            })),
        }

        const operation = runner.run(run)
        await started
        const cancelled = runner.cancel(run.id)
        const [summary] = await Promise.all([operation, cancelled])

        assert.equal(summary.status, "cancelled")
        assert.deepEqual(targetQuestions, ["q1"])
        assert.equal(targetStopCount, 1)
        assert.equal(judgeCreated, false)
        assert.deepEqual(runStatuses, ["running", "cancelled"])
        for (const id of ["result-1", "result-2", "result-3"]) {
            assert.equal(resultPatches.get(id).status, "cancelled")
            assert.equal(resultPatches.get(id).gradingStatus, "skipped")
            assert.match(resultPatches.get(id).error, /cancelled by user/i)
        }
    })

    it("preserves completed target answers and skips remaining Judge work when cancelled", async () => {
        const resultPatches = new Map()
        let judgeStarted
        const started = new Promise((resolve) => {
            judgeStarted = resolve
        })
        let rejectJudge
        let judgeCalls = 0
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, resultId, patch) {
                    resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            runEvaluationJudge() {
                                judgeCalls += 1
                                judgeStarted()
                                return new Promise((_resolve, reject) => {
                                    rejectJudge = reject
                                })
                            },
                            async stop() {
                                rejectJudge?.(new Error("judge stopped"))
                            },
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async ({question}) => ({
                            response: `answer:${question}`,
                            durationMs: 1,
                        }),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-cancel-grading",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: ["q1", "q2"].map((question, index) => ({
                id: `result-${index + 1}`,
                runtimeId: "target",
                status: "queued",
                gradingStatus: "queued",
                caseSnapshot: curatedCase(`case-${index + 1}`, question),
            })),
        }

        const operation = runner.run(run)
        await started
        const cancelled = runner.cancel(run.id)
        const [summary] = await Promise.all([operation, cancelled])

        assert.equal(summary.status, "cancelled")
        assert.equal(judgeCalls, 1)
        for (const id of ["result-1", "result-2"]) {
            assert.equal(resultPatches.get(id).status, "completed")
            assert.match(resultPatches.get(id).response, /^answer:q/)
            assert.equal(resultPatches.get(id).gradingStatus, "skipped")
            assert.match(resultPatches.get(id).gradingError, /cancelled by user/i)
        }
    })

    it("cancels queued Judge work without grading it after the active Judge is stopped", async () => {
        const resultPatches = new Map()
        let firstJudgeStarted
        const started = new Promise((resolve) => {
            firstJudgeStarted = resolve
        })
        let rejectJudge
        let judgeCalls = 0
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, resultId, patch) {
                    resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
                },
                getEvaluationRun: () => ({id: "run-cancel-judge-queue", status: "cancelled"}),
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            runEvaluationJudge() {
                                judgeCalls += 1
                                firstJudgeStarted()
                                return new Promise((_resolve, reject) => {
                                    rejectJudge = reject
                                })
                            },
                            async stop() {
                                rejectJudge?.(new Error("judge stopped"))
                            },
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async ({question}) => ({
                            response: `answer:${question}`,
                            durationMs: 1,
                        }),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-cancel-judge-queue",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: ["q1", "q2", "q3"].map((question, index) => ({
                id: `result-${index + 1}`,
                runtimeId: "target",
                status: "queued",
                gradingStatus: "awaiting_execution",
                caseSnapshot: curatedCase(`case-${index + 1}`, question),
            })),
        }

        const operation = runner.run(run)
        await started
        await runner.cancel(run.id)
        await operation

        assert.equal(judgeCalls, 1)
        for (const id of ["result-1", "result-2", "result-3"]) {
            assert.equal(resultPatches.get(id).status, "completed")
            assert.equal(resultPatches.get(id).gradingStatus, "skipped")
            assert.match(resultPatches.get(id).gradingError, /cancelled by user/i)
        }
    })

    it("cancels only the selected run and leaves another concurrent run executing", async () => {
        const active = new Map()
        const stopped = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    return {
                        start: async () => {},
                        runEvaluationCase() {
                            return new Promise((resolve, reject) => {
                                active.set(descriptor.runtimeId, {resolve, reject})
                            })
                        },
                        async stop() {
                            stopped.push(descriptor.runtimeId)
                            active.get(descriptor.runtimeId)?.reject(new Error("runtime stopped"))
                        },
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const makeRun = (runId, runtimeId) => ({
            id: runId,
            activationMode: "automatic",
            runtimeConfigurations: [
                {runtimeId, providerId: "codex", executablePath: `/${runtimeId}`},
            ],
            results: [{
                id: `${runId}-result`,
                runtimeId,
                status: "queued",
                gradingStatus: "queued",
                caseSnapshot: curatedCase(`${runId}-case`, runId),
            }],
        })

        const cancelledOperation = runner.run(makeRun("run-a", "target:a"))
        const continuingOperation = runner.run(makeRun("run-b", "target:b"))
        while (!active.has("target:a") || !active.has("target:b")) {
            await new Promise((resolve) => setImmediate(resolve))
        }
        await runner.cancel("run-a")
        active.get("target:b").resolve({response: "answer-b", durationMs: 1})

        const [cancelled, completed] = await Promise.all([cancelledOperation, continuingOperation])
        assert.equal(cancelled.status, "cancelled")
        assert.equal(completed.status, "completed")
        assert.equal(stopped.includes("target:a"), true)
        assert.equal(stopped.filter((runtimeId) => runtimeId === "target:b").length, 1)
    })

    it("returns the persisted full run after cancellation for immediate UI rendering", async () => {
        const persisted = {id: "run-persisted", status: "cancelled", results: [{id: "result"}]}
        let rejectActiveCase
        let activeCaseStarted
        const started = new Promise((resolve) => {
            activeCaseStarted = resolve
        })
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
                getEvaluationRun: () => persisted,
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        runEvaluationCase() {
                            activeCaseStarted()
                            return new Promise((_resolve, reject) => {
                                rejectActiveCase = reject
                            })
                        },
                        async stop() {
                            rejectActiveCase?.(new Error("stopped"))
                        },
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-persisted",
            activationMode: "automatic",
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [{
                id: "result",
                runtimeId: "target",
                status: "queued",
                gradingStatus: "queued",
                caseSnapshot: curatedCase("case", "q"),
            }],
        }

        runner.run(run)
        await started
        assert.equal(await runner.cancel(run.id), persisted)
    })

    it("stops every isolated runtime client during application shutdown", async () => {
        let releaseStart
        let stopCount = 0
        const client = {
            start: () => new Promise((resolve) => {
                releaseStart = resolve
            }),
            async stop() {
                stopCount += 1
                releaseStart?.()
            },
        }
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {createClient: () => client},
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-shutdown",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", executablePath: "/a"},
            ],
            results: [],
        }

        const running = runner.run(run)
        await new Promise((resolve) => setImmediate(resolve))
        await runner.stopAll()

        assert.equal(stopCount, 1)
        await running
    })

    it("passes the current local execution policy to isolated evaluation clients", async () => {
        let clientOptions = null
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient(_descriptor, options) {
                    clientOptions = options
                    return {start: async () => {}, stop: async () => {}}
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
            getExecutionPolicy: () => ({
                sandbox: "danger-full-access",
                approvalPolicy: "never",
            }),
        })

        await runner.run({
            id: "run-policy",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            runtimeConfigurations: [
                {runtimeId: "codex:a", providerId: "codex", executablePath: "/a"},
            ],
            results: [],
        })

        assert.deepEqual(clientOptions.executionPolicy, {
            sandbox: "danger-full-access",
            approvalPolicy: "never",
        })
    })

    it("starts the independent read-only Judge as soon as a result finishes and waits for grading to drain", async () => {
        const resultPatches = new Map()
        const events = []
        let releaseSlowTarget
        let releaseFirstJudge
        let slowTargetCompleted = false
        let firstJudgeCompleted = false
        let firstJudgeStarted
        const judgeStarted = new Promise((resolve) => {
            firstJudgeStarted = resolve
        })
        let judgeClientOptions = null
        const cases = [curatedCase("case-1", "q1"), curatedCase("case-2", "q2")]
        const targetClients = {
            "target:fast": {
                start: async () => events.push("target:fast:start"),
                async runEvaluationCase({question}) {
                    events.push(`target:fast:${question}`)
                    return {
                        response: `answer:${question}`,
                        durationMs: 10,
                        traceReference: `trace://${question}`,
                        traceEvidence: {
                            schemaVersion: "rolling-skill-trace-evidence/v1",
                            reference: `trace://${question}`,
                            entries: [{sequence: 1}],
                            truncated: false,
                            omittedEntries: 0,
                            digest: `sha256:${"a".repeat(64)}`,
                        },
                    }
                },
                stop: async () => events.push("target:fast:stop"),
            },
            "target:slow": {
                start: async () => events.push("target:slow:start"),
                runEvaluationCase({question}) {
                    events.push(`target:slow:${question}`)
                    return new Promise((resolve) => {
                        releaseSlowTarget = () => {
                            slowTargetCompleted = true
                            resolve({
                                response: `answer:${question}`,
                                durationMs: 11,
                                traceReference: `trace://${question}`,
                                traceEvidence: {
                                    schemaVersion: "rolling-skill-trace-evidence/v1",
                                    reference: `trace://${question}`,
                                    entries: [{sequence: 2}],
                                    truncated: false,
                                    omittedEntries: 0,
                                    digest: `sha256:${"b".repeat(64)}`,
                                },
                            })
                        }
                    })
                },
                stop: async () => events.push("target:slow:stop"),
            },
        }
        const judgeClient = {
            start: async () => {},
            async runEvaluationJudge({prompt, modelId, effort}) {
                events.push("judge:run")
                assert.match(prompt, /answer:q[12]/)
                assert.equal(modelId, "judge-model")
                assert.equal(effort, "high")
                const caseEntry = prompt.includes("answer:q1") ? cases[0] : cases[1]
                const contract = contractFromPrompt(prompt)
                const judgment = passingJudge(caseEntry, contract)
                if (caseEntry.id === "case-1") {
                    firstJudgeStarted()
                    await new Promise((resolve) => {
                        releaseFirstJudge = () => {
                            firstJudgeCompleted = true
                            resolve()
                        }
                    })
                }
                return {
                    response: JSON.stringify(judgment),
                    threadId: `judge-${caseEntry.id}`,
                    durationMs: 20,
                }
            },
            stop: async () => events.push("judge:stop"),
        }
        const store = {
            updateEvaluationRun() {},
            updateEvaluationResult(_runId, resultId, patch) {
                resultPatches.set(resultId, {...resultPatches.get(resultId), ...patch})
            },
        }
        const runner = new EvaluationRunner({
            store,
            runtimeRegistry: {
                createClient(descriptor, options) {
                    if (descriptor.runtimeId === "judge:one") {
                        judgeClientOptions = options
                        return judgeClient
                    }
                    return targetClients[descriptor.runtimeId]
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const run = {
            id: "run-graded",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            judgeConfiguration: {
                runtimeId: "judge:one",
                providerId: "codex",
                executablePath: "/judge",
                modelId: "judge-model",
                effort: "high",
            },
            runtimeConfigurations: [
                {runtimeId: "target:fast", providerId: "codex", executablePath: "/target-fast", skillEvidenceBinding: "verified"},
                {runtimeId: "target:slow", providerId: "codex", executablePath: "/target-slow", skillEvidenceBinding: "verified"},
            ],
            results: cases.map((caseSnapshot, index) => ({
                id: `result-${index + 1}`,
                runtimeId: index === 0 ? "target:fast" : "target:slow",
                status: "queued",
                caseSnapshot,
            })),
        }

        let runSettled = false
        const operation = runner.run(run).finally(() => {
            runSettled = true
        })
        await Promise.race([
            judgeStarted,
            new Promise((resolve) => setImmediate(resolve)),
        ])
        assert.equal(typeof releaseFirstJudge, "function", "Judge should start while the slow Runtime is still running")

        assert.equal(slowTargetCompleted, false, "Judge should start before the slow Runtime finishes")
        assert.equal(runSettled, false)
        assert.deepEqual(judgeClientOptions.executionPolicy, {
            sandbox: "read-only",
            approvalPolicy: "never",
        })
        releaseFirstJudge()
        while (!firstJudgeCompleted) await new Promise((resolve) => setImmediate(resolve))
        assert.equal(runSettled, false, "Run should still wait for unfinished target execution")
        releaseSlowTarget()

        const completed = await operation

        assert.equal(completed.status, "completed")
        assert.equal(events.filter((event) => event === "judge:run").length, 2)
        for (const id of ["result-1", "result-2"]) {
            const saved = resultPatches.get(id)
            assert.equal(saved.status, "completed")
            assert.equal(saved.gradingStatus, "completed")
            assert.equal(saved.computedScore.overallVerdict, "pass")
            assert.equal(saved.judge.runtimeId, "judge:one")
            assert.equal(saved.judge.status, "completed")
            assert.equal(saved.traceEvidence.reference, `trace://q${id.endsWith("1") ? 1 : 2}`)
        }
    })

    it("retries an invalid Judge result once, then saves the program-computed score", async () => {
        const caseEntry = curatedCase("case-1", "q1")
        const patches = []
        let judgeCalls = 0
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    patches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            async runEvaluationJudge({prompt}) {
                                judgeCalls += 1
                                return {
                                    response: judgeCalls === 1
                                        ? "not valid JSON"
                                        : JSON.stringify(passingJudge(caseEntry, contractFromPrompt(prompt))),
                                }
                            },
                            stop: async () => {},
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => ({response: "answer", durationMs: 1}),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        await runner.run({
            id: "run-retry",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target", skillEvidenceBinding: "verified"},
            ],
            results: [{id: "result", runtimeId: "target", status: "queued", caseSnapshot: caseEntry}],
        })

        assert.equal(judgeCalls, 2)
        const grading = patches.find((patch) => patch.gradingStatus === "completed")
        assert.equal(grading.computedScore.totalScore, 100)
        assert.equal(grading.computedScore.overallVerdict, "pass")
    })

    it("uses exact execution Trace to formally grade a runtime without Skill inventory", async () => {
        const caseEntry = curatedCase("case-trace-binding", "q1")
        const skillContent = "---\nname: billing\ndescription: costs\n---\n\n# Billing\nUse CLI.\n"
        const resultPatches = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    resultPatches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            async runEvaluationJudge({prompt}) {
                                const contract = contractFromPrompt(prompt)
                                return {response: JSON.stringify(passingJudge(caseEntry, contract))}
                            },
                            stop: async () => {},
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => ({
                            response: "answer",
                            durationMs: 1,
                            traceEvidence: {entries: [{
                                sequence: 7,
                                message: {params: {update: {
                                    sessionUpdate: "tool_call_update",
                                    status: "completed",
                                    rawInput: {skill: "billing"},
                                    skillContentDigest: skillContentDigest(skillContent),
                                }}},
                            }]},
                        }),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        await runner.run({
            id: "run-trace-binding",
            activationMode: "automatic",
            skillReference: {name: "billing", path: "/skills/billing/SKILL.md"},
            skillEvidence: {
                name: "billing",
                files: [{id: "skill:SKILL.md", path: "SKILL.md", content: skillContent}],
            },
            judgeConfiguration: {
                runtimeId: "judge",
                providerId: "codex",
                executablePath: "/judge",
            },
            runtimeConfigurations: [{
                runtimeId: "target",
                providerId: "codebuddy",
                executablePath: "/target",
                skillEvidenceBinding: "unverified",
            }],
            results: [{
                id: "result",
                runtimeId: "target",
                status: "queued",
                caseSnapshot: caseEntry,
            }],
        })

        const execution = resultPatches.find((patch) => patch.skillExecutionBinding)
        assert.equal(execution.skillExecutionBinding.declaredBinding, "unverified")
        assert.equal(execution.skillExecutionBinding.observedBinding, "matched")
        assert.equal(execution.skillExecutionBinding.effectiveBinding, "verified-by-trace")
        const grading = resultPatches.find((patch) => patch.gradingStatus === "completed")
        assert.equal(grading.computedScore.totalScore, 100)
        assert.equal(grading.computedScore.outcomeTier, "formal_pass")
    })

    it("freezes response, sequenced Trace entries, and the Skill snapshot into an untrusted Judge evidence catalog", async () => {
        const caseEntry = curatedCase("case-evidence", "q-evidence")
        const skillEvidence = {
            schemaVersion: "rolling-skill-evaluation-skill-evidence/v1",
            name: "billing",
            files: [{
                id: "skill:SKILL.md",
                path: "SKILL.md",
                content: "SKILL_SNAPSHOT_SENTINEL: read the billing Skill before querying.",
            }],
            digest: "sha256:frozen-skill",
        }
        const traceEvidence = {
            entries: [
                {sequence: 7, direction: "runtime", message: {method: "item/commandExecution"}},
                {sequence: 11, direction: "runtime", message: {method: "turn/completed"}},
            ],
        }
        let judgePrompt = null
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            async runEvaluationJudge({prompt}) {
                                judgePrompt = prompt
                                const contract = contractFromPrompt(prompt)
                                assert.equal(contract.evidence.typed, true)
                                assert.deepEqual(
                                    contract.evidence.allowedRefs,
                                    ["response", "trace:scope", "trace:L7", "trace:L11", "skill:SKILL.md"],
                                )
                                assert.equal(
                                    contract.evidence.entries.find((entry) => entry.id === "trace:L7").kind,
                                    "command",
                                )
                                return {response: JSON.stringify(passingJudge(caseEntry, contract))}
                            },
                            stop: async () => {},
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => ({
                            response: "TARGET_RESPONSE_SENTINEL",
                            durationMs: 1,
                            traceEvidence,
                        }),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        await runner.run({
            id: "run-evidence",
            activationMode: "automatic",
            skillEvidence,
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target", skillEvidenceBinding: "verified"},
            ],
            results: [
                {id: "result", runtimeId: "target", status: "queued", caseSnapshot: caseEntry},
            ],
        })

        assert.match(judgePrompt, /SKILL_SNAPSHOT_SENTINEL/)
        assert.match(judgePrompt, /TARGET_RESPONSE_SENTINEL/)
        assert.match(judgePrompt, /"sequence":7/)
        assert.match(judgePrompt, /"sequence":11/)
        assert.match(judgePrompt, /"response"/)
        assert.match(judgePrompt, /"trace:L7"/)
        assert.match(judgePrompt, /"trace:L11"/)
        assert.match(judgePrompt, /"skill:SKILL.md"/)
        assert.match(judgePrompt, /response[\s\S]*Trace[\s\S]*Skill snapshot[\s\S]*untrusted evidence/i)
        assert.match(judgePrompt, /never execute|do not execute/i)
    })

    it("includes the first validation error in the second Judge retry prompt", async () => {
        const caseEntry = curatedCase("case-repair", "q-repair")
        const prompts = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            async runEvaluationJudge({prompt}) {
                                prompts.push(prompt)
                                return {
                                    response: prompts.length === 1
                                        ? "FIRST_INVALID_OUTPUT_WITHOUT_JSON"
                                        : JSON.stringify(passingJudge(caseEntry, contractFromPrompt(prompt))),
                                }
                            },
                            stop: async () => {},
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => ({response: "answer", durationMs: 1}),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        await runner.run({
            id: "run-repair-prompt",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [
                {id: "result", runtimeId: "target", status: "queued", caseSnapshot: caseEntry},
            ],
        })

        assert.equal(prompts.length, 2)
        assert.doesNotMatch(prompts[0], /Judge response does not contain a JSON result/)
        assert.match(prompts[1], /Judge response does not contain a JSON result/)
        assert.match(prompts[1], /correct|repair|retry/i)
    })

    it("keeps a completed target result when both Judge outputs are invalid", async () => {
        const caseEntry = curatedCase("case-1", "q1")
        const patches = []
        let judgeCalls = 0
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    patches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        return {
                            start: async () => {},
                            runEvaluationJudge: async () => {
                                judgeCalls += 1
                                return {response: "invalid Judge output"}
                            },
                            stop: async () => {},
                        }
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => ({
                            response: "valuable target answer",
                            durationMs: 7,
                            traceReference: "trace://target#L1-L4",
                        }),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        const completed = await runner.run({
            id: "run-failed-grading",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [{id: "result", runtimeId: "target", status: "queued", caseSnapshot: caseEntry}],
        })

        assert.equal(completed.status, "completed")
        assert.equal(judgeCalls, 2)
        const executionPatch = patches.find((patch) => patch.status === "completed")
        assert.equal(executionPatch.response, "valuable target answer")
        assert.equal(executionPatch.traceReference, "trace://target#L1-L4")
        const failedGrading = patches.find((patch) => patch.gradingStatus === "failed")
        assert.equal("status" in failedGrading, false)
        assert.equal(failedGrading.judge.status, "failed")
        assert.match(failedGrading.judge.error, /JSON result/i)
        assert.equal(patches.some((patch) => patch.status === "failed"), false)
    })

    it("refuses to execute a Case when the installed Skill changed after the Run snapshot", async () => {
        const skillDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-drift-before-"))
        const skillPath = join(skillDirectory, "SKILL.md")
        writeFileSync(skillPath, "# Billing\n\nUse the frozen workflow.\n")
        const skillReference = {name: "billing", path: skillPath}
        const skillEvidence = snapshotSkillEvidence(skillReference)
        writeFileSync(skillPath, "# Billing\n\nUse a changed workflow.\n")

        const patches = []
        let targetCalls = 0
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    patches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => {
                            targetCalls += 1
                            return {response: "must not run"}
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        try {
            const completed = await runner.run({
                id: "run-skill-drift-before",
                activationMode: "automatic",
                skillReference,
                skillEvidence,
                runtimeConfigurations: [
                    {runtimeId: "target", providerId: "codex", executablePath: "/target"},
                ],
                results: [{
                    id: "result",
                    runtimeId: "target",
                    status: "queued",
                    caseSnapshot: curatedCase("case-drift-before", "q1"),
                }],
            })

            assert.equal(completed.status, "failed")
            assert.equal(targetCalls, 0)
            const failed = patches.find((patch) => patch.status === "failed")
            assert.equal(failed.gradingStatus, "skipped")
            assert.match(failed.error, /Skill changed after evaluation snapshot/)
        } finally {
            rmSync(skillDirectory, {recursive: true, force: true})
        }
    })

    it("rejects a target response when the Skill changes during Case execution", async () => {
        const skillDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-drift-after-"))
        const skillPath = join(skillDirectory, "SKILL.md")
        writeFileSync(skillPath, "# Billing\n\nUse the frozen workflow.\n")
        const skillReference = {name: "billing", path: skillPath}
        const skillEvidence = snapshotSkillEvidence(skillReference)

        const patches = []
        let judgeCreated = false
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    patches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") judgeCreated = true
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => {
                            writeFileSync(skillPath, "# Billing\n\nUse a changed workflow.\n")
                            return {response: "answer from changed Skill", durationMs: 1}
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        try {
            const completed = await runner.run({
                id: "run-skill-drift-after",
                activationMode: "automatic",
                skillReference,
                skillEvidence,
                judgeConfiguration: {
                    runtimeId: "judge",
                    providerId: "codex",
                    executablePath: "/judge",
                },
                runtimeConfigurations: [
                    {runtimeId: "target", providerId: "codex", executablePath: "/target"},
                ],
                results: [{
                    id: "result",
                    runtimeId: "target",
                    status: "queued",
                    caseSnapshot: curatedCase("case-drift-after", "q1"),
                }],
            })

            assert.equal(completed.status, "failed")
            assert.equal(judgeCreated, false)
            assert.equal(patches.some((patch) => patch.status === "completed"), false)
            const failed = patches.find((patch) => patch.status === "failed")
            assert.equal(failed.gradingStatus, "skipped")
            assert.match(failed.error, /Skill changed after evaluation snapshot/)
        } finally {
            rmSync(skillDirectory, {recursive: true, force: true})
        }
    })

    it("marks grading skipped and never starts a Judge when target execution fails", async () => {
        const patches = []
        let judgeCreated = false
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) {
                    patches.push(patch)
                },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") {
                        judgeCreated = true
                        throw new Error("Judge must not start")
                    }
                    return {
                        start: async () => {},
                        runEvaluationCase: async () => {
                            throw new Error("target runtime failed")
                        },
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })

        const completed = await runner.run({
            id: "run-target-failed",
            activationMode: "automatic",
            judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
            runtimeConfigurations: [
                {runtimeId: "target", providerId: "codex", executablePath: "/target"},
            ],
            results: [
                {
                    id: "result",
                    runtimeId: "target",
                    status: "queued",
                    caseSnapshot: curatedCase("case-1", "q1"),
                },
            ],
        })

        assert.equal(completed.status, "failed")
        assert.equal(judgeCreated, false)
        const failed = patches.find((patch) => patch.status === "failed")
        assert.equal(failed.gradingStatus, "skipped")
        assert.equal(failed.judge.status, "skipped")
        assert.match(failed.error, /target runtime failed/)
    })
})
