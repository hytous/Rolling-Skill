const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    buildCuratorPrompt,
    buildEpisodeSnapshot,
    compactEpisodeForCurator,
    formatCuratedAnswer,
    parseCliInvocations,
    parseCuratorDraft,
} = require("../src/episode-curation.cjs")

function sourceThread() {
    return {
        id: "thread-source",
        modelProvider: "openai",
        turns: [
            {
                id: "turn-1",
                status: "completed",
                items: [
                    {
                        id: "user-1",
                        type: "userMessage",
                        content: [{type: "text", text: "帮我瞅瞅 7月账单？混元3 各业务到底花了多少呀"}],
                    },
                    {id: "reason-1", type: "reasoning", summary: ["Inspect billing data"]},
                    {
                        id: "command-1",
                        type: "commandExecution",
                        command: "bash -lc 'billing-cli cost query --month 7 && git status'",
                        status: "completed",
                        exitCode: 0,
                    },
                    {id: "agent-1", type: "agentMessage", text: "我先查一下。"},
                    {
                        id: "command-2",
                        type: "commandExecution",
                        command: "billing-cli cost query --month 7",
                        status: "failed",
                        exitCode: 1,
                    },
                    {
                        id: "mcp-1",
                        type: "mcpToolCall",
                        server: "billing",
                        tool: "query_cost",
                        status: "completed",
                    },
                    {id: "agent-2", type: "agentMessage", text: "最终按业务汇总如下。"},
                ],
            },
        ],
    }
}

function goodDraft() {
    return {
        schemaVersion: "rolling-skill-curated-case/v1",
        referenceAnswer: {
            summary: "列出每个业务的 7 月混元 3 成本并给出合计。",
            requiredFacts: ["必须覆盖查询结果中的每个业务"],
            requiredSteps: ["按业务聚合 7 月混元 3 成本"],
            requiredOutputFormat: ["业务、成本、币种三列"],
            evidence: [{claim: "成本来自账单查询", sourceItemIds: ["mcp-1"]}],
        },
        grading: {
            hardRequirements: [
                {
                    id: "H1",
                    criterion: "覆盖所有业务并保留币种",
                    passCondition: "每个业务都有数值和币种",
                    evidenceBasis: "用户问题与账单查询结果",
                },
            ],
            softCriteria: [{id: "S1", criterion: "表达简洁", weight: 1}],
            automaticFailures: ["遗漏任一业务"],
        },
        badCaseAnalysis: null,
    }
}

function badDraft() {
    const draft = goodDraft()
    draft.referenceAnswer = {
        summary: "正确恢复方向：停止重复查询，按 Skill 要求完成校验后再汇总。",
        requiredFacts: [],
        requiredSteps: [],
        requiredOutputFormat: ["明确标注查询范围、证据和未验证项"],
        evidence: [{claim: "失败查询随后改用了账单工具", sourceItemIds: ["command-2", "mcp-1"]}],
    }
    draft.badCaseAnalysis = {
        failureMode: "CLI 查询失败后没有先判断错误原因。",
        firstDivergence: "command-2 失败后仍沿用同一查询思路。",
        rootCauses: ["没有按错误类型选择恢复路径"],
        loopSummary: "重复同一账单查询，参数和数据源没有发生有效变化。",
        expectedRecovery: "识别失败原因，选择有效账单数据源并验证覆盖范围。",
        deductionRules: [
            {
                id: "D1",
                errorPattern: "查询失败后无诊断地重复相同调用",
                matchCondition: "Trace 中出现至少两次参数及数据源相同的失败查询，且中间没有诊断或恢复动作",
                deduction: 8,
                evidenceBasis: "冻结 Trace 中 command-2 所代表的失败路径",
                sourceItemIds: ["command-2"],
            },
        ],
    }
    return draft
}

describe("episode curation evidence", () => {
    it("preserves the exact user question and freezes the selected contiguous range", () => {
        const thread = sourceThread()

        const episode = buildEpisodeSnapshot(thread, {
            startItemId: "user-1",
            endItemId: "agent-2",
            runtimeId: "codex:local",
            traceReference: "trace://runtime.jsonl#L42",
        })

        assert.equal(episode.originalQuestion, "帮我瞅瞅 7月账单？混元3 各业务到底花了多少呀")
        assert.deepEqual(
            episode.items.map((item) => item.id),
            ["user-1", "reason-1", "command-1", "agent-1", "command-2", "mcp-1", "agent-2"],
        )
        assert.equal(episode.source.threadId, "thread-source")
        assert.equal(episode.source.startItemId, "user-1")
        assert.equal(episode.source.endItemId, "agent-2")
        assert.equal(Object.isFrozen(episode), true)

        thread.turns[0].items[0].content[0].text = "changed later"
        assert.equal(episode.originalQuestion, "帮我瞅瞅 7月账单？混元3 各业务到底花了多少呀")
    })

    it("resolves live notification ids to canonical thread/read message ids", () => {
        const thread = sourceThread()
        thread.turns[0].items[0].id = "item-12"
        thread.turns[0].items.at(-1).id = "item-16"

        const episode = buildEpisodeSnapshot(thread, {
            startItemId: "019ff0e9-live-user-id",
            startTurnId: "turn-1",
            startMessageOrdinal: 0,
            endItemId: "msg_live-assistant-id",
            endTurnId: "turn-1",
            endMessageOrdinal: 1,
        })

        assert.equal(episode.source.startItemId, "item-12")
        assert.equal(episode.source.endItemId, "item-16")
        assert.equal(episode.items[0].type, "userMessage")
        assert.equal(episode.items.at(-1).type, "agentMessage")
    })

    it("resolves automatic capture to the last assistant in the completed turn", () => {
        const thread = sourceThread()
        thread.turns[0].items.at(-1).id = "canonical-final-answer"

        const episode = buildEpisodeSnapshot(thread, {
            endItemId: "live-final-answer",
            endTurnId: "turn-1",
            endMessagePosition: "last",
        })

        assert.equal(episode.source.endItemId, "canonical-final-answer")
        assert.equal(episode.items.at(-1).id, "canonical-final-answer")
    })

    it("keeps command input but bounds long shell output in the frozen Case episode", () => {
        const thread = sourceThread()
        const command = thread.turns[0].items.find((item) => item.id === "command-1")
        command.command = `billing-cli query --payload ${"input".repeat(6_000)}`
        command.aggregatedOutput = `output-start\n${"x".repeat(12_000)}\noutput-end-error`

        const episode = buildEpisodeSnapshot(thread, {
            startItemId: "user-1",
            endItemId: "agent-2",
            traceReference: "trace://full-output-remains-in-trace.jsonl#L1-L2",
        })
        const frozenCommand = episode.items.find((item) => item.id === "command-1")

        assert.equal(frozenCommand.command, command.command)
        assert.equal(frozenCommand.output.length, 4_000)
        assert.match(frozenCommand.output, /^output-start/u)
        assert.match(frozenCommand.output, /output-end-error$/u)
        assert.match(frozenCommand.output, /output truncated/u)
        assert.equal(
            episode.source.traceReference,
            "trace://full-output-remains-in-trace.jsonl#L1-L2",
        )
    })

    it("distinguishes shell CLI operations and compacts repeated tool signatures", () => {
        assert.deepEqual(
            parseCliInvocations("bash -lc 'git status && billing-cli cost query --month 7'").map(
                (entry) => entry.signature,
            ),
            ["git status", "billing-cli cost query"],
        )

        const episode = buildEpisodeSnapshot(sourceThread(), {
            startItemId: "user-1",
            endItemId: "agent-2",
        })
        const billing = episode.toolActivity.find(
            (entry) => entry.signature === "billing-cli cost query",
        )
        const git = episode.toolActivity.find((entry) => entry.signature === "git status")
        const mcp = episode.toolActivity.find((entry) => entry.signature === "billing/query_cost")

        assert.equal(billing.kind, "cli")
        assert.equal(billing.count, 2)
        assert.deepEqual(billing.statuses, {completed: 1, failed: 1})
        assert.equal(git.count, 1)
        assert.equal(mcp.kind, "mcp")
        assert.equal(mcp.count, 1)
    })

    it("keeps the raw audit episode but removes repeated loop bodies from the Curator view", () => {
        const thread = sourceThread()
        const repeated = Array.from({length: 6}, (_, index) => ({
            id: `loop-${index + 1}`,
            type: "commandExecution",
            command: "billing-cli cost query --month 7",
            status: index === 1 ? "failed" : "completed",
            aggregatedOutput: `unique-loop-output-${index + 1}`,
        }))
        thread.turns[0].items.splice(-1, 0, ...repeated)
        const episode = buildEpisodeSnapshot(thread, {
            startItemId: "user-1",
            endItemId: "agent-2",
        })
        const compact = compactEpisodeForCurator(episode)

        assert.equal(episode.items.filter((item) => item.id.startsWith("loop-")).length, 6)
        assert.equal(compact.items.filter((item) => item.id.startsWith("loop-")).length < 6, true)
        const loop = compact.compaction.find(
            (entry) => entry.signature === "billing-cli cost query",
        )
        assert.equal(loop.count >= 6, true)
        assert.equal(loop.omittedItemIds.length > 0, true)
        const prompt = buildCuratorPrompt({episode, caseType: "badcase"})
        for (const omittedId of loop.omittedItemIds) {
            const raw = episode.items.find((item) => item.id === omittedId)
            assert.doesNotMatch(prompt, new RegExp(raw.output))
        }
    })

    it("requires a fixed hard-gated Curator contract and formats it for evaluators", () => {
        const episode = buildEpisodeSnapshot(sourceThread(), {
            startItemId: "user-1",
            endItemId: "agent-2",
        })
        const prompt = buildCuratorPrompt({
            episode,
            caseType: "goodcase",
            skillReference: {
                name: "billing-cost-management",
                path: "/runtime/skills/billing-cost-management/SKILL.md",
                scope: "user",
                description: "Billing cost queries and analysis",
                runtimeId: "codex-alpha",
                confirmedAt: "2026-08-11T00:00:00.000Z",
            },
        })

        assert.match(prompt, /verbatim/i)
        assert.match(prompt, /hardRequirements/)
        assert.match(prompt, /requiredOutputFormat/)
        assert.match(prompt, /Skill requirement/)
        assert.match(prompt, /billing-cost-management/)
        assert.match(prompt, /currently installed Skill/i)
        assert.match(prompt, /activation failure.*execution failure/is)
        assert.doesNotMatch(prompt, /\/runtime\/skills\/billing-cost-management\/SKILL\.md/)
        assert.match(prompt, /numerical conclusions as soft\/diagnostic/i)
        assert.match(prompt, /帮我瞅瞅 7月账单？混元3 各业务到底花了多少呀/)

        const parsed = parseCuratorDraft(`Here is the draft.\n\n\`\`\`json\n${JSON.stringify(goodDraft())}\n\`\`\``, {
            caseType: "goodcase",
        })
        const formatted = formatCuratedAnswer(parsed)

        assert.equal(parsed.grading.hardRequirements[0].id, "H1")
        assert.match(formatted, /## Hard requirements/)
        assert.match(formatted, /\[H1\]/)
        assert.match(formatted, /## Required output format/)
        assert.match(formatted, /## Evidence/)
        assert.match(formatted, /mcp-1/)
    })

    it("rejects badcase drafts without an explicit failure analysis", () => {
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(goodDraft()), {caseType: "badcase"}),
            /badcase analysis/i,
        )
    })

    it("makes badcase curation failure-led and requires executable recurrence deductions", () => {
        const episode = buildEpisodeSnapshot(sourceThread(), {
            startItemId: "user-1",
            endItemId: "agent-2",
        })
        const prompt = buildCuratorPrompt({episode, caseType: "badcase"})

        assert.match(prompt, /do not reconstruct a polished ideal answer/i)
        assert.match(prompt, /deductionRules/)
        assert.match(prompt, /same or materially equivalent error/i)
        assert.match(prompt, /observable match condition/i)

        const missingRules = badDraft()
        delete missingRules.badCaseAnalysis.deductionRules
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(missingRules), {caseType: "badcase"}),
            /deduction rules/i,
        )

        const parsed = parseCuratorDraft(JSON.stringify(badDraft()), {
            caseType: "badcase",
            sourceItemIds: sourceThread().turns[0].items.map((item) => item.id),
        })
        const formatted = formatCuratedAnswer(parsed)
        assert.match(formatted, /^## Badcase analysis/u)
        assert.match(formatted, /## Deduction rules/u)
        assert.match(formatted, /\[D1\].*Deduct up to 8 points/su)
        assert.doesNotMatch(formatted, /^## Reference answer/u)
    })

    it("rejects ambiguous, duplicated, or unbounded badcase deduction rules", () => {
        const duplicate = badDraft()
        duplicate.badCaseAnalysis.deductionRules.push({
            ...duplicate.badCaseAnalysis.deductionRules[0],
        })
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(duplicate), {caseType: "badcase"}),
            /deduction rule ids must be unique/i,
        )

        const noMatchCondition = badDraft()
        noMatchCondition.badCaseAnalysis.deductionRules[0].matchCondition = ""
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(noMatchCondition), {caseType: "badcase"}),
            /matchCondition/i,
        )

        const invalidDeduction = badDraft()
        invalidDeduction.badCaseAnalysis.deductionRules[0].deduction = 0
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(invalidDeduction), {caseType: "badcase"}),
            /deduction.*positive/i,
        )

        const unknownEvidence = badDraft()
        unknownEvidence.badCaseAnalysis.deductionRules[0].sourceItemIds = ["invented-item"]
        assert.throws(
            () =>
                parseCuratorDraft(JSON.stringify(unknownEvidence), {
                    caseType: "badcase",
                    sourceItemIds: sourceThread().turns[0].items.map((item) => item.id),
                }),
            /source item/i,
        )
    })

    it("rejects unusable grading fields and evidence ids outside the frozen episode", () => {
        const invalidEvidence = goodDraft()
        invalidEvidence.referenceAnswer.evidence[0].sourceItemIds = ["invented-item"]
        assert.throws(
            () =>
                parseCuratorDraft(JSON.stringify(invalidEvidence), {
                    caseType: "goodcase",
                    sourceItemIds: sourceThread().turns[0].items.map((item) => item.id),
                }),
            /source item/i,
        )

        const invalidWeight = goodDraft()
        invalidWeight.grading.softCriteria[0].weight = "high"
        assert.throws(
            () => parseCuratorDraft(JSON.stringify(invalidWeight), {caseType: "goodcase"}),
            /weight/i,
        )
    })
})
