const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createEvaluationServices} = require("../src/evaluation-services.cjs")

function runtime(runtimeId, executablePath) {
    return {
        runtimeId,
        providerId: runtimeId.split(":")[0],
        displayName: "Runtime",
        version: "1.0.0",
        executablePath,
        source: "test",
        transport: "stdio-jsonl",
        capabilities: [],
        models: [],
        efforts: ["low", "high"],
    }
}

function fixture() {
    const target = runtime("codex:a", "/opt/codex-a")
    const judge = runtime("deepseek-harness:b", "/opt/dsh-b")
    const created = []
    const resolvedInstallations = []
    const running = []
    const cancelled = []
    const run = {
        id: "run-1",
        datasetId: "dataset-1",
        status: "queued",
        createdAt: "2026-08-26T00:00:00.000Z",
        results: [],
    }
    const store = {
        getDataset: () => ({
            id: "dataset-1",
            skillReference: {
                schemaVersion: "rolling-skill-skill-reference/v1",
                evidencePrecision: "managed",
                id: "skill-1",
                repositoryId: "repository-1",
                name: "billing",
                path: null,
                runtimeId: null,
                providerId: null,
            },
        }),
        createEvaluationRun(input, options) {
            created.push({input: structuredClone(input), options: structuredClone(options)})
            return structuredClone(run)
        },
        listEvaluationRunSummaries: () => [{id: "run-1", status: "running"}],
        getEvaluationRun: () => ({
            ...run,
            status: "running",
            managedVersionSnapshot: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "released-1",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                installationJobIdsByRuntime: {"codex:a": "job-codex:a"},
            },
            rubricVersionSnapshot: {
                id: "rubric-1",
                version: 3,
                rubricDigest: "sha256:rubric",
                rubric: {title: "Billing rubric", scoringModel: "unified-100/v1", criteria: []},
            },
            skillReference: {id: "skill-1", repositoryId: "repository-1", name: "billing", path: "/installed/private/SKILL.md"},
            runtimeConfigurations: [{runtimeId: "codex:a", executablePath: "/opt/codex-a", skillReference: {path: "/installed/private/SKILL.md"}}],
            results: [{
                id: "result-1",
                status: "completed",
                gradingStatus: "completed",
                threadId: "private-thread",
                traceReference: "/tmp/private-trace",
                traceEvidence: {
                    schemaVersion: "rolling-skill-trace-evidence/v1",
                    reference: "trace://case.jsonl#L7-L8",
                    sourceEntryCount: 2,
                    includedEntries: 2,
                    semanticCoverageComplete: true,
                    truncated: false,
                    omittedEntries: 0,
                    entries: [
                        {sequence: 7, direction: "outbound", message: {method: "turn/start"}},
                        {sequence: 8, direction: "inbound", message: {method: "turn/completed"}},
                    ],
                },
                scoreContract: {criteria: [{id: "R1", title: "Workflow", weight: 1}]},
                judgment: {assessments: [{criterionId: "R1", rating: 8, rationale: "Observed", evidenceRefs: ["trace:L7"]}]},
                computedScore: {totalScore: 80, overallVerdict: "pass", criterionScores: [{id: "R1", points: 80, maxPoints: 100, rating: 8}]},
                judge: {runtimeId: "deepseek-harness:b", modelId: "judge-model", effort: "high", threadId: "private-judge-thread"},
            }],
        }),
        deleteEvaluationRun: (id) => ({id, status: "completed"}),
    }
    const runtimeServices = {
        descriptor(id) {
            if (id === target.runtimeId) return structuredClone(target)
            if (id === judge.runtimeId) return structuredClone(judge)
            throw new Error("Runtime is no longer available")
        },
    }
    const runner = {
        run(value) {
            running.push(structuredClone(value))
            return Promise.resolve({id: value.id, status: "completed"})
        },
        async cancel(id) {
            cancelled.push(id)
            return {...run, status: "cancelled"}
        },
    }
    const managedSkillStore = {
        getSkill(id) {
            if (id !== "skill-1") throw new Error("Unknown managed Skill")
            return {id, repositoryId: "repository-1", name: "billing", skillRoot: "skills/billing"}
        },
        getRepository(id) {
            if (id !== "repository-1") throw new Error("Unknown managed Skill repository")
            return {id, managedPath: "/managed/repository-1"}
        },
        getVersion(id) {
            if (id === "candidate-1") return {
                id,
                repositoryId: "repository-1",
                skillId: "skill-1",
                state: "candidate",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                skillRoot: "skills/billing",
            }
            if (id !== "released-1") throw new Error("Unknown managed Skill version")
            return {
                id,
                repositoryId: "repository-1",
                skillId: "skill-1",
                state: "released",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                skillRoot: "skills/billing",
            }
        },
    }
    const installationStore = {
        resolveVerifiedInstallation(input) {
            resolvedInstallations.push(structuredClone(input))
            return {
                id: `installation-${input.runtimeId}`,
                installationId: `installation-${input.runtimeId}`,
                jobId: `job-${input.runtimeId}`,
                ...input,
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                destination: `/installed/${input.runtimeId}/billing`,
                verification: "runtime-inventory",
                installedAt: "2026-08-26T00:00:00.000Z",
            }
        },
    }
    const services = createEvaluationServices({
        store,
        runtimeServices,
        runner,
        managedSkillStore,
        managedSkillManager: {git: {}},
        installationStore,
        snapshotManagedSkill: async () => ({
            schemaVersion: "evidence/v1",
            digest: "sha256:test",
            managedSource: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "released-1",
                commit: "a".repeat(40),
                skillRoot: "skills/billing",
                contentDigest: `sha256:${"b".repeat(64)}`,
            },
        }),
    })
    return {services, created, running, cancelled, resolvedInstallations}
}

describe("Rolling Skill evaluation services", () => {
    it("resolves Host-owned Runtime descriptors and starts one evaluation", async () => {
        const test = fixture()
        const started = await test.services.start({
            datasetId: "dataset-1",
            versionId: "released-1",
            caseIds: [],
            selectionMode: "dataset",
            activationMode: "explicit",
            targets: [{runtimeId: "codex:a", modelId: "gpt-5.6", effort: "high"}],
            judge: {runtimeId: "deepseek-harness:b", modelId: "deepseek-chat", effort: "low"},
        })

        assert.equal(started.id, "run-1")
        assert.equal(test.created[0].input.runtimeConfigurations[0].executablePath, "/opt/codex-a")
        assert.equal(test.created[0].input.runtimeConfigurations[0].modelId, "gpt-5.6")
        assert.equal(
            test.created[0].input.runtimeConfigurations[0].skillReference.path,
            "/installed/codex:a/billing/SKILL.md",
        )
        assert.equal(test.created[0].input.runtimeConfigurations[0].installationId, "installation-codex:a")
        assert.equal(test.created[0].input.judgeConfiguration.executablePath, "/opt/dsh-b")
        assert.equal(test.created[0].input.skillEvidence.digest, "sha256:test")
        assert.equal(test.created[0].input.managedVersionSnapshot.versionId, "released-1")
        assert.deepEqual(test.created[0].options, {managedVersionAuthorized: true})
        assert.equal(test.resolvedInstallations.length, 1)
        assert.equal(test.running.length, 1)
    })

    it("requires a Released version owned by the Dataset Skill", async () => {
        const test = fixture()
        const request = {
            datasetId: "dataset-1",
            targets: [{runtimeId: "codex:a"}],
            judge: {runtimeId: "deepseek-harness:b"},
        }

        await assert.rejects(() => test.services.start(request), /version.*required/i)
        await assert.rejects(
            () => test.services.start({...request, versionId: "candidate-1"}),
            /Released version|version.*released/i,
        )
        assert.equal(test.created.length, 0)
        assert.equal(test.resolvedInstallations.length, 0)
    })

    it("lists summaries, returns completed detail, and cancels through the runner", async () => {
        const test = fixture()
        assert.deepEqual(test.services.list({datasetId: "dataset-1"}), [{id: "run-1", status: "running"}])
        const detail = test.services.get({runId: "run-1"})
        assert.equal(detail.results[0].id, "result-1")
        assert.equal(Object.hasOwn(detail.skillReference, "path"), false)
        assert.equal(Object.hasOwn(detail.runtimeConfigurations[0], "executablePath"), false)
        assert.equal(Object.hasOwn(detail.results[0], "traceReference"), false)
        assert.equal(detail.traceScope, "case")
        assert.equal(detail.managedVersionSnapshot.versionId, "released-1")
        assert.equal(detail.rubricVersionSnapshot.version, 3)
        assert.equal(detail.results[0].traceEvidence.scope, "case")
        assert.deepEqual(
            detail.results[0].traceEvidence.entries.map((entry) => entry.sequence),
            [7, 8],
        )
        assert.equal(detail.results[0].traceEvidence.semanticCoverageComplete, true)
        assert.equal(detail.results[0].computedScore.totalScore, 80)
        assert.equal(detail.results[0].judgment.assessments[0].criterionId, "R1")
        assert.equal(Object.hasOwn(detail.results[0].judge, "threadId"), false)
        assert.equal((await test.services.cancel({runId: "run-1"})).status, "cancelled")
        assert.deepEqual(test.cancelled, ["run-1"])
    })

    it("deletes terminal runs through the durable Store", () => {
        const test = fixture()
        assert.deepEqual(test.services.delete({runId: "run-1"}), {
            id: "run-1",
            status: "completed",
        })
    })
})
