const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    buildBoundaryPrompt,
    buildOutcomePrompt,
    dueCaptureSlot,
    nextScheduledSlot,
    parseBoundaryResult,
    parseOutcomeResult,
    partitionUserMessages,
    previousScheduledSlot,
} = require("../src/conversation-discovery.cjs")

function localDate(year, month, day, hour, minute) {
    return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function parts(date) {
    return [
        date.getFullYear(),
        date.getMonth() + 1,
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getDay(),
    ]
}

describe("scheduled conversation discovery helpers", () => {
    it("finds daily slots before and after local schedule time across month and year", () => {
        const schedule = {cadence: "daily", time: "09:00", weekday: 1}

        assert.deepEqual(parts(previousScheduledSlot(localDate(2027, 1, 1, 8, 30), schedule)), [
            2026, 12, 31, 9, 0, 4,
        ])
        assert.deepEqual(parts(previousScheduledSlot(localDate(2027, 1, 1, 9, 5), schedule)), [
            2027, 1, 1, 9, 0, 5,
        ])
        assert.deepEqual(parts(nextScheduledSlot(localDate(2026, 2, 28, 9, 5), schedule)), [
            2026, 3, 1, 9, 0, 0,
        ])
    })

    it("finds weekly slots on the selected weekday before and after local time", () => {
        const schedule = {cadence: "weekly", time: "18:30", weekday: 3}

        assert.deepEqual(parts(previousScheduledSlot(localDate(2026, 8, 26, 18, 20), schedule)), [
            2026, 8, 19, 18, 30, 3,
        ])
        assert.deepEqual(parts(previousScheduledSlot(localDate(2026, 8, 26, 18, 40), schedule)), [
            2026, 8, 26, 18, 30, 3,
        ])
        assert.deepEqual(parts(nextScheduledSlot(localDate(2026, 8, 26, 18, 40), schedule)), [
            2026, 9, 2, 18, 30, 3,
        ])
    })

    it("collapses first-run and multiple missed slots to the latest due slot", () => {
        const now = localDate(2026, 8, 26, 9, 5)
        const schedule = {cadence: "daily", time: "09:00", weekday: 1}
        const latest = previousScheduledSlot(now, schedule)

        assert.equal(dueCaptureSlot({now, schedule, lastScheduledSlot: null}).toISOString(), latest.toISOString())
        assert.equal(dueCaptureSlot({
            now,
            schedule,
            lastScheduledSlot: localDate(2026, 8, 20, 9, 0).toISOString(),
        }).toISOString(), latest.toISOString())
        assert.equal(dueCaptureSlot({
            now,
            schedule,
            lastScheduledSlot: latest.toISOString(),
        }), null)
    })

    it("constructs slots from local calendar parts", () => {
        const slot = nextScheduledSlot(localDate(2026, 3, 7, 23, 30), {
            cadence: "daily",
            time: "02:15",
            weekday: 1,
        })
        assert.equal(slot.getHours(), 2)
        assert.equal(slot.getMinutes(), 15)
        assert.equal(slot.getDate(), 8)
    })

    it("builds a boundary prompt from user messages only", () => {
        const prompt = buildBoundaryPrompt({
            threadId: "thread-1",
            userMessages: [
                {id: "user-1", turnId: "turn-1", text: "查本月账单", assistantText: "assistant secret"},
                {id: "user-2", turnId: "turn-2", text: "再按产品拆分", toolOutput: "tool secret"},
            ],
        })

        assert.match(prompt, /"id":"user-1"/u)
        assert.match(prompt, /查本月账单/u)
        assert.doesNotMatch(prompt, /assistant secret|tool secret|reasoning|command output/iu)
        assert.match(prompt, /pendingStartUserItemId/u)
        assert.match(prompt, /internal orchestration|installation|evaluation/iu)
    })

    it("parses ordered boundary segments and rejects unknown or overlapping IDs", () => {
        const context = {userMessageIds: ["user-1", "user-2", "user-3", "user-4"]}
        assert.deepEqual(parseBoundaryResult(
            'prefix ```json\n{"segments":[{"startUserItemId":"user-1","endUserItemId":"user-2","summary":"billing"}],"pendingStartUserItemId":"user-3"}\n```',
            context,
        ), {
            segments: [{startUserItemId: "user-1", endUserItemId: "user-2", summary: "billing"}],
            pendingStartUserItemId: "user-3",
        })
        assert.throws(() => parseBoundaryResult(
            '{"segments":[{"startUserItemId":"unknown","endUserItemId":"user-2","summary":"x"}],"pendingStartUserItemId":null}',
            context,
        ), /unknown|membership/i)
        assert.throws(() => parseBoundaryResult(
            '{"segments":[{"startUserItemId":"user-1","endUserItemId":"user-3","summary":"x"},{"startUserItemId":"user-2","endUserItemId":"user-4","summary":"y"}],"pendingStartUserItemId":null}',
            context,
        ), /overlap|order/i)
        assert.throws(() => parseBoundaryResult('{"segments":[]}', context), /schema|pending|field/i)
    })

    it("builds a bounded outcome prompt from only the selected Episode and compact identities", () => {
        const prompt = buildOutcomePrompt({
            threadId: "thread-1",
            episode: {
                originalQuestion: "查账单",
                items: [
                    {id: "user-1", turnId: "turn-1", type: "userMessage", text: "查账单", secret: "item secret"},
                    {id: "agent-1", turnId: "turn-1", type: "agentMessage", text: "结果 100 元", reasoning: "reasoning secret"},
                ],
                toolActivity: [{type: "mcpToolCall", server: "billing", tool: "query", output: "tool output secret"}],
                unrelatedHistory: "outside episode",
            },
            skills: [{name: "billing-cost-management", path: "/skills/billing/SKILL.md", instructions: "skill secret"}],
            datasets: [{id: "dataset-1", name: "Billing", skillReference: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"}, cases: "dataset secret"}],
        })

        assert.match(prompt, /结果 100 元/u)
        assert.match(prompt, /billing-cost-management/u)
        assert.match(prompt, /dataset-1/u)
        assert.doesNotMatch(prompt, /reasoning secret|tool output secret|outside episode|skill secret|dataset secret/u)
        assert.match(prompt, /eligibleForCase/u)
        assert.match(prompt, /human-authored|internal orchestration/iu)
        assert.match(prompt, /installation|Rubric|Curator|Judge/iu)
    })

    it("strictly parses outcome classification and confidence", () => {
        const context = {
            skillNames: ["billing-cost-management"],
            assistantItemIds: ["agent-1"],
        }
        const valid = {
            eligibleForCase: true,
            sourceKind: "human_task",
            skillName: "billing-cost-management",
            outcome: "resolved",
            caseType: "goodcase",
            finalAssistantItemId: "agent-1",
            confidence: 0.86,
            reason: "The answer contains queried values.",
        }
        assert.deepEqual(parseOutcomeResult(JSON.stringify(valid), context), valid)
        const rejected = {
            eligibleForCase: false,
            sourceKind: "skill_installation",
            skillName: null,
            outcome: "uncertain",
            caseType: null,
            finalAssistantItemId: null,
            confidence: 0.98,
            reason: "This episode installs a Skill for Rolling Skill itself.",
        }
        assert.deepEqual(parseOutcomeResult(JSON.stringify(rejected), context), rejected)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...valid, skillName: "unknown"}), context), /skill/i)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...valid, confidence: 1.1}), context), /confidence/i)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...valid, finalAssistantItemId: "agent-2"}), context), /assistant/i)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...rejected, skillName: "billing-cost-management"}), context), /ineligible|skill/i)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...rejected, caseType: "goodcase"}), context), /ineligible|case type/i)
        assert.throws(() => parseOutcomeResult(JSON.stringify({...valid, extra: true}), context), /schema|field/i)
        assert.throws(() => parseOutcomeResult("not json", context), /JSON/i)
    })

    it("partitions user messages without splitting one message", () => {
        const messages = [
            {id: "user-1", text: "12345"},
            {id: "user-2", text: "67890"},
            {id: "user-3", text: "a".repeat(30)},
            {id: "user-4", text: "last"},
        ]
        assert.deepEqual(
            partitionUserMessages(messages, {maxMessages: 2, maxCharacters: 8}).map(
                (batch) => batch.map((message) => message.id),
            ),
            [["user-1"], ["user-2"], ["user-3"], ["user-4"]],
        )
        assert.equal(partitionUserMessages(messages, {maxMessages: 2, maxCharacters: 100})[0].length, 2)
    })
})
