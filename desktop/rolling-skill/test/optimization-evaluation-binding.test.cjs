const assert = require("node:assert/strict")
const {execFileSync} = require("node:child_process")
const {mkdtempSync, mkdirSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {EvaluationRunner} = require("../src/evaluation-runner.cjs")
const {
    resolveExecutedSkillEvidenceBinding,
    runtimeReportsSkill,
} = require("../src/evaluation-skill-binding.cjs")
const {
    snapshotManagedSkillEvidence,
    snapshotSkillEvidence,
} = require("../src/evaluation-skill-evidence.cjs")
const {LocalEvaluationStore} = require("../src/local-store.cjs")
const {ManagedSkillGit} = require("../src/managed-skill-git.cjs")
const {skillContentDigest} = require("../src/skill-content.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory(prefix) {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    temporaryDirectories.push(directory)
    return directory
}

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function git(repository, ...args) {
    return execFileSync("git", args, {cwd: repository, encoding: "utf8"}).trim()
}

function commitManagedSkill() {
    const repositoryPath = temporaryDirectory("rolling-skill-managed-evaluation-")
    mkdirSync(join(repositoryPath, "skills", "billing", "references"), {recursive: true})
    writeFileSync(
        join(repositoryPath, "skills", "billing", "SKILL.md"),
        "# Candidate\n\nRead [workflow](workflow.md).\n",
    )
    writeFileSync(
        join(repositoryPath, "skills", "billing", "references", "workflow.md"),
        "Use the immutable Candidate workflow.\n",
    )
    git(repositoryPath, "init", "-q")
    git(repositoryPath, "config", "user.name", "Test")
    git(repositoryPath, "config", "user.email", "test@example.com")
    git(repositoryPath, "add", ".")
    git(repositoryPath, "commit", "-qm", "candidate")
    const commit = git(repositoryPath, "rev-parse", "HEAD")
    writeFileSync(
        join(repositoryPath, "skills", "billing", "SKILL.md"),
        "# Mutable Working\n\nDo not use this content.\n",
    )
    return {repositoryPath, commit}
}

async function exactManagedEvidence() {
    const {repositoryPath, commit} = commitManagedSkill()
    const gitClient = new ManagedSkillGit()
    const snapshot = await gitClient.snapshotSkill(repositoryPath, commit, "skills/billing")
    const source = {
        repositoryId: "repository-1",
        skillId: "skill-1",
        versionId: "candidate-2",
        name: "billing",
        repositoryPath,
        commit,
        skillRoot: "skills/billing",
        contentDigest: snapshot.digest,
    }
    const evidence = await snapshotManagedSkillEvidence(source, {git: gitClient})
    return {
        evidence,
        source,
        version: managedVersionSnapshot({
            commit,
            contentDigest: snapshot.digest,
        }),
    }
}

function localEvidence(content = "# Candidate\n\nUse the immutable Candidate workflow.\n") {
    const directory = temporaryDirectory("rolling-skill-candidate-evidence-")
    const path = join(directory, "SKILL.md")
    writeFileSync(path, content)
    return snapshotSkillEvidence({name: "billing", path})
}

function managedVersionSnapshot(overrides = {}) {
    return {
        repositoryId: "repository-1",
        skillId: "skill-1",
        versionId: "candidate-2",
        commit: "c".repeat(40),
        skillRoot: "skills/billing",
        contentDigest: digest("d"),
        installationJobIdsByRuntime: {
            "codex:target": "install-job-codex",
            "codebuddy:target": "install-job-codebuddy",
        },
        ...overrides,
    }
}

function evaluationStoreFixture() {
    const directory = temporaryDirectory("rolling-skill-managed-evaluation-store-")
    const store = new LocalEvaluationStore(join(directory, "store.json"))
    const dataset = store.listDatasets()[0]
    store.bindDatasetSkill(dataset.id, {
        schemaVersion: "rolling-skill-skill-reference/v1",
        name: "billing",
        path: "/runtime/skills/billing/SKILL.md",
        scope: "user",
        description: "Billing",
        runtimeId: "codex:target",
        confirmedAt: "2026-08-25T00:00:00.000Z",
    })
    const saved = store.saveCase({
        datasetId: dataset.id,
        caseType: "goodcase",
        question: "查询 2026-08-24 这一历史时点的账单值",
        answer: "按历史对比语义回答",
    })
    return {store, dataset: store.getDataset(dataset.id), saved}
}

function runtimeConfiguration(runtimeId = "codex:target") {
    return {
        runtimeId,
        providerId: runtimeId.split(":")[0],
        displayName: runtimeId,
        executablePath: `/bin/${runtimeId.split(":")[0]}`,
        skillEvidenceBinding: "verified",
    }
}

describe("Optimization Evaluation managed Candidate binding", () => {
    it("exports Judge evidence from the exact managed commit instead of mutable Working", async () => {
        const {evidence, source} = await exactManagedEvidence()

        assert.equal(evidence.name, "billing")
        assert.match(evidence.files.find((entry) => entry.path === "SKILL.md").content, /Candidate/u)
        assert.doesNotMatch(JSON.stringify(evidence), /Mutable Working/u)
        assert.deepEqual(evidence.files.map((entry) => entry.path), [
            "SKILL.md",
            "references/workflow.md",
        ])
        assert.equal(evidence.managedSource.commit, source.commit)
        assert.equal(evidence.managedSource.contentDigest, source.contentDigest)
    })

    it("allows managed snapshots only on the internal optimization path and preserves frozen inputs", async () => {
        const {store, dataset, saved} = evaluationStoreFixture()
        const mutableEvidence = localEvidence()
        const exact = await exactManagedEvidence()
        const managed = exact.version
        const input = {
            datasetId: dataset.id,
            caseIds: [saved.id],
            selectionMode: "selected",
            activationMode: "automatic",
            skillEvidence: mutableEvidence,
            managedVersionSnapshot: managed,
            runtimeConfigurations: [
                runtimeConfiguration("codex:target"),
                runtimeConfiguration("codebuddy:target"),
            ],
        }

        assert.throws(() => store.createEvaluationRun(input), /Optimization.*capability|internal/u)
        assert.throws(
            () => store.createEvaluationRun(input, {optimizationAuthorized: true}),
            /managed.*evidence|Candidate.*evidence/i,
        )
        input.skillEvidence = exact.evidence
        const expectedManaged = structuredClone(exact.version)
        const run = store.createEvaluationRun(input, {optimizationAuthorized: true})
        input.caseIds[0] = "forged-case"
        input.managedVersionSnapshot.commit = "0".repeat(40)

        assert.deepEqual(run.managedVersionSnapshot, expectedManaged)
        assert.equal(run.caseSnapshots[0].question, saved.question)
        assert.equal(run.caseSnapshots[0].answer, saved.answer)
        assert.equal(run.caseSnapshots[0].revision, saved.revision)
        assert.equal(run.runtimeConfigurations[0].expectedContentDigest, expectedManaged.contentDigest)
        assert.equal(run.runtimeConfigurations[0].experimentInstallationJobId, "install-job-codex")
        assert.equal(run.runtimeConfigurations[1].experimentInstallationJobId, "install-job-codebuddy")
    })

    it("requires exact inventory digest and keeps name-only evidence unverified", () => {
        const skillReference = {name: "billing", path: "/runtime/skills/billing/SKILL.md"}
        const expectedContentDigest = digest("d")
        const response = {data: [{skills: [{
            ...skillReference,
            enabled: true,
            contentDigest: digest("e"),
        }]}]}

        assert.equal(runtimeReportsSkill(response, skillReference, {expectedContentDigest}), false)
        assert.equal(runtimeReportsSkill({data: [{skills: [{
            name: "billing",
            enabled: true,
            evidencePrecision: "name-only",
        }]}]}, skillReference, {allowNameOnly: true, expectedContentDigest}), false)

        const evidence = localEvidence()
        const expectedBodyDigest = skillContentDigest(
            evidence.files.find((entry) => entry.path === "SKILL.md").content,
        )
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "unverified",
            skillReference,
            skillEvidence: evidence,
            expectedContentDigest: expectedBodyDigest,
            traceEvidence: {entries: [{
                sequence: 4,
                message: {params: {update: {
                    rawInput: {skill: "billing"},
                    skillContentDigest: expectedBodyDigest,
                }}},
            }]},
        })
        assert.equal(binding.expectedContentDigest, expectedBodyDigest)
        assert.equal(binding.effectiveBinding, "verified-by-trace")
    })

    it("fails before execution when path-precise inventory exposes a previous Candidate", async () => {
        const evidence = localEvidence()
        const patches = []
        let targetCalls = 0
        let judgeCreated = false
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) { patches.push(patch) },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") judgeCreated = true
                    return {
                        start: async () => {},
                        listSkills: async () => ({data: [{skills: [{
                            name: "billing",
                            path: "/runtime/skills/billing/SKILL.md",
                            enabled: true,
                            contentDigest: digest("f"),
                        }]}]}),
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
        const completed = await runner.run(candidateRun(evidence))

        assert.equal(completed.status, "failed")
        assert.equal(targetCalls, 0)
        assert.equal(judgeCreated, false)
        const failed = patches.find((patch) => patch.status === "failed")
        assert.equal(failed.failureDiagnostics.code, "SKILL_VERSION_CHANGED")
        assert.match(failed.error, /SKILL_VERSION_CHANGED/u)
    })

    it("checks again after execution and does not grade a Runtime that rotated mid-Case", async () => {
        const evidence = localEvidence()
        const patches = []
        let inventoryCalls = 0
        let judgeCreated = false
        const runner = new EvaluationRunner({
            store: {
                updateEvaluationRun() {},
                updateEvaluationResult(_runId, _resultId, patch) { patches.push(patch) },
            },
            runtimeRegistry: {
                createClient(descriptor) {
                    if (descriptor.runtimeId === "judge") judgeCreated = true
                    return {
                        start: async () => {},
                        listSkills: async () => {
                            inventoryCalls += 1
                            return {data: [{skills: [{
                                name: "billing",
                                path: "/runtime/skills/billing/SKILL.md",
                                enabled: true,
                                contentDigest: inventoryCalls === 1 ? digest("d") : digest("f"),
                            }]}]}
                        },
                        runEvaluationCase: async () => ({response: "stale answer", durationMs: 1}),
                        stop: async () => {},
                    }
                },
            },
            workspaceRoot: "/workspace",
            traceDirectory: "/traces",
        })
        const completed = await runner.run(candidateRun(evidence))

        assert.equal(completed.status, "failed")
        assert.equal(inventoryCalls, 2)
        assert.equal(judgeCreated, false)
        assert.equal(patches.some((patch) => patch.status === "completed"), false)
        assert.equal(
            patches.find((patch) => patch.status === "failed").failureDiagnostics.code,
            "SKILL_VERSION_CHANGED",
        )
    })
})

function candidateRun(skillEvidence) {
    return {
        id: "optimization-evaluation-run",
        activationMode: "automatic",
        skillReference: {name: "billing", path: "/runtime/skills/billing/SKILL.md"},
        skillEvidence,
        managedVersionSnapshot: managedVersionSnapshot({
            installationJobIdsByRuntime: {"codex:target": "install-job-codex"},
        }),
        judgeConfiguration: {runtimeId: "judge", providerId: "codex", executablePath: "/judge"},
        runtimeConfigurations: [{
            ...runtimeConfiguration("codex:target"),
            expectedContentDigest: digest("d"),
            experimentInstallationJobId: "install-job-codex",
        }],
        results: [{
            id: "result-1",
            runtimeId: "codex:target",
            status: "queued",
            caseSnapshot: {
                id: "case-1",
                revision: 1,
                question: "查询 2026-08-24 这一历史时点的账单值",
            },
        }],
    }
}
