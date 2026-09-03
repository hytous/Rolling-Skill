const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {test} = require("node:test")
const {OperatorJobStore} = require("../../../desktop/rolling-skill/src/operator/job-store.cjs")
const {OperatorJobEngine} = require("../../../desktop/rolling-skill/src/operator/job-engine.cjs")
const {createOptimizationChildJobs} = require("../src/operator-services.cjs")

test("optimization phases use the real job engine with the already authorized parent budget", async (t) => {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-jobs-"))
    const store = new OperatorJobStore(join(root, "jobs.json"))
    t.after(() => {store.close(); rmSync(root, {recursive: true, force: true})})
    const session = store.createSession({
        runtime: {runtimeId: "codex:one", providerId: "codex", displayName: "Codex", version: "1", executablePath: "/usr/bin/codex"},
        modelId: "selected-model", effort: "high", protocol: "rolling-skill-operator/v1", capabilityId: "capability-1",
    })
    const budget = {maxDurationMs: 60000, maxRuntimeTurns: 20, maxEvaluations: 3, maxTargetExecutions: 9, maxJudgeExecutions: 9, maxTokens: null, maxReportedCost: null}
    const parent = store.createJob({sessionId: session.id, type: "operator-session", objective: "One optimization round", budget})
    store.transitionJob(parent.id, "running")
    const children = createOptimizationChildJobs({jobStore: store, jobEngine: new OperatorJobEngine({store})})
    for (const phase of ["baseline", "candidate", "experiment_install", "evaluation", "experiment_restore"]) {
        const result = await children.run({parentJobId: parent.id, type: `optimization_${phase}`, objective: phase}, async ({jobId}) => {
            assert.deepEqual(store.getJob(jobId).budget, budget)
            return {jobId, phase}
        })
        assert.equal(store.getJob(result.jobId).status, "succeeded")
    }
})
