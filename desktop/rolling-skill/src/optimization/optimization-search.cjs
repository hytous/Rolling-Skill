"use strict"

const {createHash} = require("node:crypto")

const DEFAULT_SEARCH = Object.freeze({
    candidatesPerRound: 3, parentLimit: 2, failureSamples: 6, successSamples: 2,
    feedbackCharacters: 12_000, caseWorkers: 1, seed: "rolling-skill-v1",
})

function parseSearch(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Optimization search must be an object")
    for (const key of Object.keys(value)) if (!Object.hasOwn(DEFAULT_SEARCH, key)) throw new Error(`Unsupported search field ${key}`)
    const result = {...DEFAULT_SEARCH, ...value}
    for (const [key, min, max] of [
        ["candidatesPerRound", 1, 8], ["parentLimit", 1, 4],
        ["failureSamples", 1, 24], ["successSamples", 0, 8],
        ["feedbackCharacters", 2_000, 18_000], ["caseWorkers", 1, 8],
    ]) if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`Invalid search ${key}`)
    if (typeof result.seed !== "string" || !result.seed.trim() || result.seed.length > 200 || result.seed.includes("\0")) throw new Error("Invalid search seed")
    return Object.freeze(result)
}

const hash = (value) => createHash("sha256").update(value).digest("hex")
const keyOf = (result) => JSON.stringify([result.caseId ?? result.caseSnapshot?.id, result.runtimeId ?? result.runtimeConfiguration?.runtimeId])
const valid = (result) => result.status === "completed" && result.gradingStatus === "completed" &&
    Number.isFinite(result.computedScore?.totalScore) && result.computedScore.totalScore >= 0 && result.computedScore.totalScore <= 100 &&
    ["pass", "fail"].includes(result.computedScore.overallVerdict)

// Hash ordering is reproducible across processes and independent of input order.
// Candidate-specific seeds produce independent samples; a batch never repeats a key.
function sample(entries, count, seed) {
    return [...entries].sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b)
        return hash(`${seed}\0${ka}`).localeCompare(hash(`${seed}\0${kb}`)) || ka.localeCompare(kb)
    }).slice(0, count)
}

function clip(value, limit) {
    const text = String(value ?? "")
    return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 13))}[truncated]`
}

function feedbackCard(result, allowance) {
    const contract = new Map((result.scoreContract?.criteria ?? []).map((c) => [c.id, c]))
    const assessments = [...(result.judgment?.assessments ?? [])]
        .sort((a, b) => a.rating - b.rating || String(a.criterionId).localeCompare(String(b.criterionId)))
    const criteria = assessments.slice(0, 6).map((a) => ({
        criterionId: a.criterionId, rating: a.rating, verificationStatus: a.verificationStatus ?? null,
        criterion: clip(contract.get(a.criterionId)?.criterion, 200),
        rationale: clip(a.rationale, 160), evidenceRefs: (a.evidenceRefs ?? []).slice(0, 6),
    }))
    const refs = new Set(criteria.flatMap((a) => a.evidenceRefs))
    const trace = (result.traceEvidence?.entries ?? [])
        .filter((entry) => refs.has(`trace:L${entry.sequence}`)).slice(0, 3)
        .map((entry) => ({id: `trace:L${entry.sequence}`, excerpt: clip(JSON.stringify(entry), 350)}))
    const card = {
        key: keyOf(result), score: result.computedScore.totalScore,
        question: clip(result.caseSnapshot?.question ?? result.question, 650),
        response: clip(result.response, 650), criteria, trace,
        criticalFailures: result.computedScore.criticalFailures ?? [],
        omittedCriteria: Math.max(0, assessments.length - criteria.length),
        evidenceComplete: false,
    }
    // Keep every sampled Case represented; shrink evidence rather than dropping
    // later Cases or pretending excerpts are complete authoritative evidence.
    while (JSON.stringify(card).length > allowance && card.trace.length) card.trace.pop()
    while (JSON.stringify(card).length > allowance && card.criteria.length > 1) {
        card.criteria.pop(); card.omittedCriteria += 1
    }
    if (JSON.stringify(card).length > allowance) {
        card.response = clip(card.response, 80)
        card.question = clip(card.question, 120)
    }
    return card
}

function sampleFeedback({runId, parentId, epoch, evaluation, search}) {
    const config = parseSearch(search)
    const seed = hash(JSON.stringify([config.seed, runId, parentId, epoch]))
    const results = evaluation?.results ?? []
    if (new Set(results.map(keyOf)).size !== results.length) throw new Error("Duplicate Case/Runtime feedback keys")
    const eligible = results.filter(valid)
    const failures = eligible.filter((r) => r.computedScore.overallVerdict !== "pass")
    const successes = eligible.filter((r) => r.computedScore.overallVerdict === "pass")
    const selected = failures.length
        ? [...sample(failures, config.failureSamples, `${seed}/failure`), ...sample(successes, config.successSamples, `${seed}/success`)]
        : sample(successes, config.failureSamples + config.successSamples, `${seed}/success-only`)
    const metadata = {
        schemaVersion: "rolling-skill-feedback-sample/v1", seed, parentId, evaluationId: evaluation?.id ?? null,
        selectedKeys: selected.map(keyOf), failurePoolSize: failures.length, successPoolSize: successes.length,
        excludedResults: results.length - eligible.length, budgetUnit: "characters", budget: config.feedbackCharacters,
    }
    const allowance = Math.floor((config.feedbackCharacters - JSON.stringify(metadata).length - 100) / Math.max(1, selected.length))
    const cards = selected.map((r) => feedbackCard(r, allowance))
    const result = {...metadata, cards}
    if (JSON.stringify(result).length > config.feedbackCharacters) {
        // Never silently change the sampled batch to fit a budget.
        throw new Error("Feedback budget cannot represent the selected Cases; reduce sample counts or increase budget")
    }
    return result
}

function profile(evaluation, expectedKeys) {
    const results = evaluation?.results ?? []
    const keys = results.map(keyOf)
    if (results.length !== expectedKeys.length || new Set(keys).size !== keys.length ||
        keys.some((key) => !expectedKeys.includes(key)) || results.some((r) => !valid(r))) return null
    const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length
    const critical = results.reduce((n, r) => n + (r.computedScore.criticalFailures?.length ?? 0), 0)
    const vector = {}
    for (const r of results) {
        const normal = (r.scoreContract?.criteria ?? []).filter((c) => !c.mode && Number.isFinite(c.weight) && c.weight > 0)
        const assessments = new Map((r.judgment?.assessments ?? []).map((a) => [a.criterionId, a]))
        const weight = normal.reduce((n, c) => n + c.weight, 0)
        for (const c of normal) {
            const a = assessments.get(c.id)
            if (Number.isFinite(a?.rating) && a.rating >= 0 && a.rating <= 10 && a.verificationStatus === "verified") {
                vector[JSON.stringify([keyOf(r), c.id])] = {value: a.rating / 10, weight: c.weight / weight / results.length}
            }
        }
    }
    const durations = results.map((r) => r.durationMs)
    const tokens = results.map((r) => r.tokenUsage?.totalTokens)
    return {
        quality: mean(results.map((r) => r.computedScore.totalScore)), critical,
        latency: durations.every((x) => Number.isFinite(x) && x >= 0) ? mean(durations) : null,
        tokens: tokens.every((x) => Number.isFinite(x) && x >= 0) ? mean(tokens) : null,
        vector,
    }
}

function vectorDistance(a, b, coordinates) {
    let sum = 0, weights = 0
    for (const key of coordinates) {
        const w = a[key].weight
        sum += w * Math.abs(a[key].value - b[key].value); weights += w
    }
    return weights ? sum / weights : 0
}

function selectCandidates(entries, {parentLimit = 2, baselineId}) {
    if (!Number.isSafeInteger(parentLimit) || parentLimit < 1 || parentLimit > 4) throw new Error("Invalid parent limit")
    if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error("Duplicate candidate identities")
    const baseline = entries.find((e) => e.id === baselineId)
    if (!baseline) throw new Error("Selection requires its baseline")
    const expected = (baseline.evaluation.results ?? []).map(keyOf)
    if (!expected.length) throw new Error("Selection requires a nonempty evaluation set")
    const profiles = entries.map((entry) => ({...entry, profile: profile(entry.evaluation, expected)}))
    const base = profiles.find((e) => e.id === baselineId).profile
    if (!base) throw new Error("Selection baseline is incomplete or diagnostic")
    const baseFailures = new Map(baseline.evaluation.results.map((r) => [keyOf(r), new Set(r.computedScore.criticalFailures ?? [])]))
    const eligible = profiles.filter((e) => e.profile && e.profile.quality >= base.quality &&
        e.evaluation.results.every((r) => (r.computedScore.criticalFailures ?? []).every((id) => baseFailures.get(keyOf(r)).has(id))))
    const rejectedIds = profiles.filter((e) => !eligible.includes(e)).map((e) => e.id)
    const objectives = ["quality"]
    for (const metric of ["tokens", "latency"]) if (eligible.every((e) => e.profile[metric] !== null)) objectives.push(metric)
    const dominates = (a, b) => objectives.every((m) => m === "quality" ? a[m] >= b[m] : a[m] <= b[m]) &&
        objectives.some((m) => m === "quality" ? a[m] > b[m] : a[m] < b[m])
    let remaining = [...eligible]
    const fronts = []
    while (remaining.length) {
        const front = remaining.filter((b) => !remaining.some((a) => a !== b && dominates(a.profile, b.profile)))
        fronts.push(front); remaining = remaining.filter((e) => !front.includes(e))
    }
    // A common verified coordinate set makes every pair comparable. Missing
    // evidence contributes no artificial diversity and is reported explicitly.
    const coordinates = Object.keys(base.vector).filter((key) => eligible.every((e) =>
        e.profile.vector[key] && Math.abs(e.profile.vector[key].weight - base.vector[key].weight) < 1e-12))
    const order = (a, b) => b.profile.quality - a.profile.quality || a.profile.critical - b.profile.critical ||
        (objectives.includes("tokens") ? a.profile.tokens - b.profile.tokens : 0) ||
        (objectives.includes("latency") ? a.profile.latency - b.profile.latency : 0) ||
        Number(b.id === baselineId) - Number(a.id === baselineId) || a.id.localeCompare(b.id)
    const selected = []
    for (const front of fronts) {
        const pending = [...front].sort(order)
        while (pending.length && selected.length < parentLimit) {
            if (selected.length) pending.sort((a, b) => {
                const distance = (e) => Math.min(...selected.map((s) => vectorDistance(e.profile.vector, s.profile.vector, coordinates)))
                return distance(b) - distance(a) || order(a, b)
            })
            selected.push(pending.shift())
        }
        if (selected.length >= parentLimit) break
    }
    return {
        schemaVersion: "rolling-skill-candidate-selection/v1", objectives,
        fronts: fronts.map((f) => f.map((e) => e.id)), parentIds: selected.map((e) => e.id),
        winnerId: [...fronts[0]].sort(order)[0].id, rejectedIds,
        diversityCoordinates: coordinates.length,
        metrics: profiles.map((e) => ({id: e.id, ...(e.profile ? {
            quality: e.profile.quality, critical: e.profile.critical, tokens: e.profile.tokens, latency: e.profile.latency,
        } : {invalid: true})})),
    }
}

module.exports = {DEFAULT_SEARCH, parseSearch, sampleFeedback, selectCandidates, vectorDistance, keyOf}
