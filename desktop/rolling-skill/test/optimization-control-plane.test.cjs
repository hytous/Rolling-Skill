"use strict"

const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {parseControlOutput} = require("../src/control-plane/contracts.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy, createResolvedScope} = require("../src/control-plane/policy.cjs")

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function config() {
    return {
        skillId: "skill-1",
        baselineVersionId: "version-1",
        datasetId: "dataset-1",
        operator: {runtimeId: "operator-1", modelId: "gpt", effort: "high"},
        targets: [{runtimeId: "target-1", modelId: "gpt", effort: "high"}],
        judge: {runtimeId: "judge-1", modelId: "gpt", effort: "high"},
        activationMode: "automatic",
        limits: {maxEpochs: 101},
    }
}

function publicRun() {
    return {
        id: "run-1",
        state: "editing",
        revision: 2,
        currentEpoch: 1,
        snapshotDigest: digest("s"),
        baseline: {repositoryId: "repository-1", skillId: "skill-1", versionId: "version-1"},
        dataset: {id: "dataset-1", revision: 7},
        rubric: {id: "rubric-1", version: 4},
        operator: config().operator,
        targets: config().targets,
        judge: config().judge,
        activationMode: config().activationMode,
        limits: config().limits,
        epochs: [{number: 1, status: "editing", candidateArtifactId: null}],
        checkpoint: {},
        error: null,
    }
}

function serviceFixture() {
    const calls = []
    const optimizationControlService = {
        async preflight(input) {
            calls.push({method: "preflight", input: structuredClone(input)})
            return {
                snapshotDigest: digest("s"),
                baseline: publicRun().baseline,
                dataset: publicRun().dataset,
                rubric: publicRun().rubric,
                targets: publicRun().targets,
                ready: true,
            }
        },
        async start(input) { calls.push({method: "start", input: structuredClone(input)}); return {run: publicRun()} },
        get(runId) { calls.push({method: "get", runId}); return {run: publicRun()} },
        async pause(runId) { calls.push({method: "pause", runId}); return {run: publicRun()} },
        async resume(runId) { calls.push({method: "resume", runId}); return {run: publicRun()} },
        async stop(runId) { calls.push({method: "stop", runId}); return {run: publicRun()} },
        submitCandidate(input, context) {
            calls.push({method: "submitCandidate", input: structuredClone(input), sessionId: context.sessionId})
            return {accepted: {runId: input.runId, kind: "candidate"}}
        },
        submitDecision(input, context) {
            calls.push({method: "submitDecision", input: structuredClone(input), sessionId: context.sessionId})
            return {accepted: {runId: input.runId, kind: "decision"}}
        },
        report(runId) {
            calls.push({method: "report", runId})
            return {report: {artifactId: "report-1", digest: digest("p"), mediaType: "text/markdown; charset=utf-8"}}
        },
        scope() {
            return {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["operator-1", "judge-1", "target-1"],
                repositoryIds: ["repository-1"],
            }
        },
    }
    return {calls, services: createDomainServices({optimizationControlService})}
}

function context() {
    return {
        sessionId: "operator-session-1",
        grant: {
            sessionId: "operator-session-1",
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["operator-1", "judge-1", "target-1"],
                repositoryIds: ["repository-1"],
            },
        },
    }
}

describe("optimization control-plane integration", () => {
    it("resolves all frozen object identities and delegates every lifecycle method", async () => {
        const {calls, services} = serviceFixture()
        const startInput = {...config(), idempotencyKey: "start-1"}
        const resolution = await services.resolveScope("optimization.start", startInput, context().grant)
        assert.deepEqual(resolution.scope, {
            method: "optimization.start",
            mode: "access",
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["operator-1", "judge-1", "target-1"],
            repositoryIds: ["repository-1"],
        })
        assert.equal(Object.isFrozen(resolution.executionContext), true)

        const started = await services["optimization.start"](startInput, context())
        assert.doesNotThrow(() => parseControlOutput("optimization.start", started))
        for (const method of ["get", "pause", "resume", "stop"]) {
            const result = await services[`optimization.${method}`](
                method === "get" ? {runId: "run-1"} : {runId: "run-1", idempotencyKey: `${method}-1`},
                context(),
            )
            assert.doesNotThrow(() => parseControlOutput(`optimization.${method}`, result))
        }
        const candidate = await services["optimization.submit_candidate"]({
            runId: "run-1",
            message: "Improve drilldown",
            idempotencyKey: "candidate-1",
        }, context())
        assert.equal(candidate.accepted.kind, "candidate")
        assert.equal(calls.find((call) => call.method === "submitCandidate").sessionId, "operator-session-1")
        const decision = await services["optimization.submit_decision"]({
            runId: "run-1",
            decision: {
                schemaVersion: "rolling-skill-optimization-decision/v1",
                action: "continue",
                rationale: "Continue within the configured Epoch boundary",
                observations: [],
            },
            idempotencyKey: "decision-1",
        }, context())
        assert.equal(decision.accepted.kind, "decision")
        assert.equal(Object.hasOwn(
            calls.find((call) => call.method === "submitDecision").input,
            "limitRequest",
        ), false)
        const report = await services["optimization.report"]({runId: "run-1", idempotencyKey: "report-1"}, context())
        assert.doesNotThrow(() => parseControlOutput("optimization.report", report))
    })

    it("requires every optimization object to remain inside the capability scope", () => {
        const policy = createControlPolicy()
        const input = {...config(), idempotencyKey: "start-1"}
        const grant = {
            actions: ["optimizations.execute"],
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["operator-1", "target-1"],
                repositoryIds: ["repository-1"],
            },
        }
        const resolvedScope = createResolvedScope({
            method: "optimization.start",
            mode: "access",
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["operator-1", "judge-1", "target-1"],
            repositoryIds: ["repository-1"],
        })

        assert.deepEqual(policy.decide({
            grant,
            method: "optimization.start",
            action: "optimizations.execute",
            input,
            resolvedScope,
        }), {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Runtime is outside this Operator session",
        })
    })
})
