"use strict"
const {test} = require("node:test")
const assert = require("node:assert/strict")
const {parseSearch, sampleFeedback, selectCandidates, vectorDistance} = require("../src/optimization/optimization-search.cjs")

function result(id, score = 50, duration = 100) {
    return {caseId: id, runtimeId: "runtime", status: "completed", gradingStatus: "completed",
        durationMs: duration, caseSnapshot: {question: "question"}, response: "response",
        computedScore: {totalScore: score, overallVerdict: score >= 80 ? "pass" : "fail", criticalFailures: []},
        scoreContract: {criteria: [{id: "quality", weight: 1}]},
        judgment: {assessments: [{criterionId: "quality", rating: score / 10, verificationStatus: "verified", rationale: "evidence", evidenceRefs: ["response"]}]}}
}
function feedback(patch = {}) {
    return sampleFeedback({runId: "run", parentId: "parent", epoch: 1,
        evaluation: {id: "eval", results: Array.from({length: 50}, (_, i) => result(`case-${i}`, i < 30 ? 50 : 90))},
        search: {}, ...patch})
}
test("sampling is deterministic, order-independent, without replacement and candidate-specific", () => {
    const a = feedback(), b = feedback()
    assert.deepEqual(a, b)
    assert.equal(a.selectedKeys.length, 8)
    assert.equal(new Set(a.selectedKeys).size, 8)
    assert.notDeepEqual(a.selectedKeys, feedback({epoch: 2}).selectedKeys)
    assert.notDeepEqual(a.seed, feedback({parentId: "another"}).seed)
    const evaluation = {id: "eval", results: Array.from({length: 50}, (_, i) => result(`case-${i}`, i < 30 ? 50 : 90)).reverse()}
    assert.deepEqual(a, feedback({evaluation}))
})
test("small and empty pools do not duplicate or fabricate feedback", () => {
    assert.equal(feedback({evaluation: {id: "small", results: [result("one")]}}).cards.length, 1)
    assert.equal(feedback({evaluation: {results: []}}).cards.length, 0)
    const invalid = result("bad"); invalid.gradingStatus = "failed"
    const sample = feedback({evaluation: {results: [invalid, result("pass", 95)]}})
    assert.equal(sample.excludedResults, 1)
    assert.equal(sample.cards.length, 1)
    assert.equal(sample.failurePoolSize, 0)
    assert.throws(() => feedback({evaluation: {results: [result("one"), result("one")]}}), /Duplicate/)
})
test("large feedback remains bounded and all sampled Cases stay represented", () => {
    const results = Array.from({length: 50}, (_, i) => ({...result(`case-${i}`),
        response: "X".repeat(100000), caseSnapshot: {question: "Q".repeat(10000)},
        judgment: {assessments: Array.from({length: 30}, (_, j) => ({criterionId: `R${j}`, rating: j % 10, rationale: "R".repeat(1000), evidenceRefs: ["response"]}))}}))
    const sample = feedback({evaluation: {id: "long", results}})
    assert.ok(JSON.stringify(sample).length <= 12000)
    assert.equal(sample.cards.length, sample.selectedKeys.length)
    assert.ok(sample.cards.every((c) => c.omittedCriteria > 0 && c.evidenceComplete === false))
    assert.throws(() => parseSearch({caseWorkers: 0}), /Invalid/)
    assert.throws(() => parseSearch({extra: 1}), /Unsupported/)
})
const entry = (id, scores, duration = 100) => ({id, evaluation: {results: scores.map((s, i) => result(`case-${i}`, s, duration))}})
test("selection uses the full common set, rejects incomplete data, never imputes missing cost", () => {
    const baseline = entry("base", [50, 50])
    const better = entry("better", [90, 90], 200)
    const fast = entry("fast", [80, 80], 50)
    const incomplete = entry("partial", [100])
    const selection = selectCandidates([baseline, better, fast, incomplete], {parentLimit: 2, baselineId: "base"})
    assert.equal(selection.winnerId, "better")
    assert.deepEqual(new Set(selection.parentIds), new Set(["better", "fast"]))
    assert.ok(selection.rejectedIds.includes("partial"))
    assert.deepEqual(selection.objectives, ["quality", "latency"])
    assert.equal(selection.diversityCoordinates, 2)
    const unknownDuration = entry("unknown", [85, 85]); delete unknownDuration.evaluation.results[0].durationMs
    assert.deepEqual(selectCandidates([baseline, better, unknownDuration], {baselineId: "base"}).objectives, ["quality"])
})
test("new critical failures cannot be hidden by a higher average", () => {
    const bad = entry("bad", [99, 99]); bad.evaluation.results[1].computedScore.criticalFailures = ["fraud"]
    const selected = selectCandidates([entry("base", [50, 50]), bad], {baselineId: "base"})
    assert.equal(selected.winnerId, "base")
    assert.ok(selected.rejectedIds.includes("bad"))
})
test("verified vector distance is symmetric, bounded and identity-zero", () => {
    const a = {a: {value: 0.9, weight: 0.5}, b: {value: 0.5, weight: 0.5}}
    const b = {a: {value: 0.5, weight: 0.5}, b: {value: 0.9, weight: 0.5}}
    assert.equal(vectorDistance(a, a, ["a", "b"]), 0)
    assert.equal(vectorDistance(a, b, ["a", "b"]), 0.4)
    assert.equal(vectorDistance(a, b, ["a", "b"]), vectorDistance(b, a, ["a", "b"]))
    assert.equal(vectorDistance(a, b, []), 0)
})

test("within a tied front, graded-vector diversity retains complementary Case strengths", () => {
    const selected = selectCandidates([
        entry("base", [50, 50]), entry("a", [100, 60]),
        entry("b", [99, 61]), entry("c", [60, 100]),
    ], {parentLimit: 2, baselineId: "base"})
    assert.deepEqual(selected.fronts, [["a", "b", "c"], ["base"]])
    assert.deepEqual(selected.parentIds, ["a", "c"])
    assert.equal(selected.winnerId, "a")
})
test("missing or unverified coordinates do not masquerade as behavioral differences", () => {
    const unknown = entry("b", [60, 100])
    unknown.evaluation.results.forEach((r) => r.judgment.assessments[0].verificationStatus = "unverified")
    const selected = selectCandidates([entry("base", [50, 50]), entry("a", [100, 60]), unknown], {baselineId: "base"})
    assert.equal(selected.diversityCoordinates, 0)
})
test("cost axes require complete telemetry and exact ties prefer the existing baseline", () => {
    const baseline = entry("z-baseline", [90, 90]), same = entry("a-same", [90, 90])
    const fast = entry("fast", [90, 90], 50)
    for (const e of [baseline, same, fast]) e.evaluation.results.forEach((r) => r.tokenUsage = {totalTokens: 0})
    const selected = selectCandidates([baseline, same, fast], {baselineId: baseline.id})
    assert.deepEqual(selected.objectives, ["quality", "tokens", "latency"])
    assert.equal(selected.winnerId, "fast")
    assert.equal(selectCandidates([baseline, same], {baselineId: baseline.id}).winnerId, baseline.id)
    assert.throws(() => selectCandidates([baseline, baseline], {baselineId: baseline.id}), /Duplicate/)
})
