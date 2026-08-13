const assert = require("node:assert/strict")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {EvaluationRunner} = require("../src/evaluation-runner.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")
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
    const strongKinds = {
        skill_activation: ["skill_activation", "skill_read"],
        required_references: ["reference_read"],
        tool_policy: ["command", "tool_call", "file_change"],
        workflow_order: ["command", "tool_call", "file_change"],
        completeness_artifacts: ["command", "tool_call", "file_change"],
        deterministic_processing: ["command", "tool_call", "file_change"],
        evidence_output: ["response"],
        error_recovery: ["error"],
    }
    return {
        schemaVersion: JUDGE_RESULT_SCHEMA,
        contractDigest: contract.digest,
        aAssessments: contract.a.dimensions.map((dimension) => {
            const related = contract.evidence.entries?.find((entry) =>
                entry.kinds.some((kind) => strongKinds[dimension.id]?.includes(kind)),
            )
            return {
                dimensionId: dimension.id,
                status: "scored",
                level: 4,
                evidenceRefs: [related?.id ?? "response"],
                rationale: "The supplied evidence satisfies this dimension.",
            }
        }),
        bAssessments: contract.b.criteria.map((criterion) => ({
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
    it("sends only the frozen original question to the target runtime", async () => {
        const calls = []
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult() {},
            },
            runtimeRegistry: {
                createClient() {
                    return {
                        start: async () => {},
                        async runEvaluationCase(input) {
                            calls.push(input)
                            return {response: "answer", durationMs: 1}
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

    it("uses an independent read-only Judge after every target execution has finished", async () => {
        const resultPatches = new Map()
        const events = []
        let remainingTargets = 2
        let judgeCreatedWhileTargetsRunning = false
        let judgeClientOptions = null
        const cases = [curatedCase("case-1", "q1"), curatedCase("case-2", "q2")]
        const targetClient = {
            start: async () => {},
            async runEvaluationCase({question}) {
                events.push(`target:${question}`)
                remainingTargets -= 1
                return {
                    response: `answer:${question}`,
                    durationMs: 10,
                    traceReference: `trace://${question}`,
                    traceEvidence: {
                        schemaVersion: "rolling-skill-trace-evidence/v1",
                        reference: `trace://${question}`,
                        entries: [{sequence: question === "q1" ? 1 : 2}],
                        truncated: false,
                        omittedEntries: 0,
                        digest: `sha256:${"a".repeat(64)}`,
                    },
                }
            },
            stop: async () => events.push("target:stop"),
        }
        const judgeClient = {
            start: async () => events.push("judge:start"),
            async runEvaluationJudge({prompt, modelId, effort}) {
                events.push("judge:run")
                assert.match(prompt, /answer:q[12]/)
                assert.equal(modelId, "judge-model")
                assert.equal(effort, "high")
                const caseEntry = prompt.includes("answer:q1") ? cases[0] : cases[1]
                const contract = contractFromPrompt(prompt)
                const judgment = passingJudge(caseEntry, contract)
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
                        judgeCreatedWhileTargetsRunning = remainingTargets !== 0
                        judgeClientOptions = options
                        return judgeClient
                    }
                    return targetClient
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
                {runtimeId: "target:one", providerId: "codex", executablePath: "/target", skillEvidenceBinding: "verified"},
            ],
            results: cases.map((caseSnapshot, index) => ({
                id: `result-${index + 1}`,
                runtimeId: "target:one",
                status: "queued",
                caseSnapshot,
            })),
        }

        const completed = await runner.run(run)

        assert.equal(completed.status, "completed")
        assert.equal(judgeCreatedWhileTargetsRunning, false)
        assert.deepEqual(judgeClientOptions.executionPolicy, {
            sandbox: "read-only",
            approvalPolicy: "never",
        })
        assert.equal(events.indexOf("target:stop") < events.indexOf("judge:start"), true)
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
