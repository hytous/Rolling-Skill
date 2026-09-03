const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    OPERATOR_PROTOCOL,
    buildOperatorInitialInput,
    buildOperatorInstructions,
    protocolSnapshot,
    serializeOperatorInput,
} = require("../src/operator/operator-protocol.cjs")

function protocolContext(overrides = {}) {
    return {
        scope: {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["runtime-1"],
            repositoryIds: ["repository-1"],
        },
        actions: ["datasets.read", "evaluations.execute"],
        budget: {
            maxDurationMs: 60_000,
            maxRuntimeTurns: 8,
            maxEvaluations: 2,
            maxTargetExecutions: 20,
            maxJudgeExecutions: 20,
            maxTokens: null,
            maxReportedCost: null,
        },
        transport: {kind: "codex-dynamic", ready: true},
        ...overrides,
    }
}

describe("Rolling Skill Operator protocol", () => {
    it("defines the v1 Job, artifact, approval, data-safety and turn-boundary rules", () => {
        const text = buildOperatorInstructions(protocolContext())

        assert.equal(OPERATOR_PROTOCOL, "rolling-skill-operator/v1")
        assert.match(text, /Rolling Skill Operator/iu)
        assert.match(text, /durable Job/iu)
        assert.match(text, /artifact ID/iu)
        assert.match(text, /approval/iu)
        assert.match(text, /never (?:directly )?(?:read|edit|write).*data files/iu)
        assert.match(text, /scope.*frozen/iu)
        assert.match(text, /budget.*frozen/iu)
        assert.match(text, /transport.*frozen/iu)
        assert.match(text, /child jobId.*end (?:the )?turn/iu)
        assert.match(text, /dataset-1/u)
        assert.match(text, /maxEvaluations.*2/u)
        assert.match(text, /codex-dynamic/u)
    })

    it("accepts an iteration-only budget without telling the Agent to request expansion", () => {
        const context = protocolContext({budget: {maxIterations: 50}})
        const snapshot = protocolSnapshot(context)
        const text = buildOperatorInstructions(context)

        assert.deepEqual(snapshot.budget, {maxIterations: 50})
        assert.match(text, /50.*iteration|iteration.*50/iu)
        assert.match(text, /finish or pause/iu)
        assert.doesNotMatch(text, /request a budget expansion/iu)
    })

    it("accepts an unbounded budget without imposing an Agent-turn count", () => {
        const context = protocolContext({budget: {}})
        const snapshot = protocolSnapshot(context)
        const text = buildOperatorInstructions(context)

        assert.deepEqual(snapshot.budget, {})
        assert.match(text, /no Agent-turn limit/iu)
        assert.doesNotMatch(text, /request a budget expansion/iu)
        assert.doesNotMatch(text, /finish or pause within/iu)
    })

    it("rejects malformed or mixed iteration budgets", () => {
        const inheritedBudget = Object.assign(
            Object.create({maxIterations: 50}),
            protocolContext().budget,
        )
        for (const budget of [
            {maxIterations: 0},
            {maxIterations: 1.5},
            {maxIterations: 50, unknown: 1},
            {maxIterations: 50, maxDurationMs: 60_000},
            inheritedBudget,
        ]) {
            assert.throws(
                () => protocolSnapshot(protocolContext({budget})),
                /budget|maxIterations|iteration/iu,
            )
        }
    })

    it("builds two typed initial parts and keeps authority and provider paths out", () => {
        const token = "private-bearer-token-never-render"
        const providerPath = "/Applications/Codex.app/Contents/Resources/codex"
        const input = buildOperatorInitialInput(protocolContext({
            token,
            runtime: {providerId: "codex", executablePath: providerPath},
        }), "Improve the selected Skill without widening scope")

        assert.equal(input.length, 2)
        assert.deepEqual(Object.keys(input[0]).sort(), ["protocol", "text", "type"])
        assert.equal(input[0].type, "operatorContext")
        assert.equal(input[0].protocol, OPERATOR_PROTOCOL)
        assert.equal(input[1].type, "text")
        assert.equal(input[1].text, "Improve the selected Skill without widening scope")
        assert.equal(JSON.stringify(input).includes(token), false)
        assert.equal(JSON.stringify(input).includes(providerPath), false)
    })

    it("serializes environment context as Runtime text without changing the visible input", () => {
        const input = buildOperatorInitialInput(protocolContext(), "Evaluate the candidate")
        const before = JSON.parse(JSON.stringify(input))
        const serialized = serializeOperatorInput(input)

        assert.deepEqual(input, before)
        assert.deepEqual(serialized.map((part) => part.type), ["text", "text"])
        assert.match(serialized[0].text, /Environment context/iu)
        assert.equal(serialized[1].text, "Evaluate the candidate")
    })

    it("describes the absolute bundled CLI tool without exposing a provider installation", () => {
        const toolPath = "/Applications/Rolling Skill.app/Contents/Resources/rolling-skill-tool"
        const providerPath = "/Users/example/.local/bin/deepseek-harness"
        const text = buildOperatorInstructions(protocolContext({
            transport: {kind: "cli", ready: true, executablePath: toolPath},
            runtime: {providerId: "deepseek-harness", executablePath: providerPath},
        }))

        assert.match(text, new RegExp(toolPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"))
        assert.equal(text.includes(providerPath), false)
        assert.equal(text.includes("ROLLING_SKILL_CONTROL_TOKEN"), false)
    })
})
