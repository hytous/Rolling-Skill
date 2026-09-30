const assert = require("node:assert/strict")
const {test} = require("node:test")
const {
    currentOptimizationPlaybook,
    optimizationRequestMessage,
} = require("../src/optimization-agent-context.cjs")

test("shared DSH context includes version memory using the same bounded desktop implementation", () => {
    const message = optimizationRequestMessage({run: {id: "run", snapshot: {
        baseline: {skillId: "billing", versionId: "parent"}, playbook: currentOptimizationPlaybook(),
    }}, kind: "candidate", epoch: 1, versions: [{id: "parent", skillId: "billing", changeSummary: "缩小查询范围"}]})
    assert.match(message, /缩小查询范围/)
    assert.match(message, /"relation":"parent"/)
    assert.match(message, /不可信历史数据/)
})

test("the optimization Agent receives bounded Case evidence rather than only a run id", () => {
    const baseline = {id: "baseline", status: "completed", results: Array.from({length: 20}, (_, index) => ({
        caseId: `case-${index}`, runtimeId: "target", caseSnapshot: {question: "user question", answer: "reference"},
        response: "actual answer ".repeat(1000), status: "completed", gradingStatus: "completed",
        computedScore: {totalScore: 60}, judgment: {assessments: [{criterionId: "format", rating: 6, rationale: "Missing required field"}]},
        traceEvidence: {secret: "must not enter prompt"}, reasoning: "must not enter prompt",
    }))}
    assert.equal(typeof currentOptimizationPlaybook, "function")
    const message = optimizationRequestMessage({run: {id: "run-1", snapshot: {
        limits: {maxEpochs: 1}, optimizationDirection: null,
        playbook: currentOptimizationPlaybook(),
    }}, kind: "candidate", epoch: 1, baselineEvaluation: baseline, currentEvaluation: baseline})
    assert.match(message, /make a generalizable improvement/)
    assert.match(message, /系统全面优化/u)
    assert.match(message, /Rolling Skill Optimization Playbook v1/u)
    assert.match(message, /Missing required field/)
    assert.match(message, /"omittedResults":10/)
    assert.doesNotMatch(message, /must not enter prompt/)
    assert.ok(message.length < 32768)
    const decision = optimizationRequestMessage({run: {id: "run-1", snapshot: {
        limits: {maxEpochs: 1}, optimizationDirection: null,
        playbook: currentOptimizationPlaybook(),
    }}, kind: "decision", epoch: 1, baselineEvaluation: baseline, currentEvaluation: {...baseline, id: "candidate"}})
    assert.ok(decision.length < 32768, "combined baseline and candidate evidence fits the real Operator message contract")
})
