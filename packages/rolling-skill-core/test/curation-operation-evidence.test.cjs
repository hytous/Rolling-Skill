const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    createCurationOperationEvidenceResolver,
} = require("../src/curation-operation-evidence.cjs")

const DIGEST = `sha256:${"a".repeat(64)}`
const COMMIT = "b".repeat(40)

function fixture(overrides = {}) {
    const dataset = {
        id: "dataset-1",
        name: "Billing cases",
        activeRubricVersionId: "rubric-1",
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            evidencePrecision: "managed",
            id: "skill-1",
            repositoryId: "repository-1",
            name: "billing",
            path: null,
            scope: "managed",
            description: "Billing Skill",
            runtimeId: null,
            providerId: null,
            confirmedAt: "2026-08-27T00:00:00.000Z",
        },
        ...(overrides.dataset ?? {}),
    }
    const runtime = {
        runtimeId: "deepseek-harness:/opt/dsh",
        providerId: "deepseek-harness",
        displayName: "DeepSeek Harness",
        version: "1.0.0",
        executablePath: "/opt/dsh",
    }
    const version = {
        id: "version-1",
        repositoryId: "repository-1",
        skillId: "skill-1",
        skillRoot: "billing",
        commit: COMMIT,
        contentDigest: DIGEST,
        state: "released",
        versionLabel: "v1",
        releasedAt: "2026-08-26T00:00:00.000Z",
        deprecatedAt: null,
    }
    const installation = {
        id: "installation-1",
        installationId: "installation-1",
        jobId: "job-1",
        repositoryId: "repository-1",
        skillId: "skill-1",
        skillName: "billing",
        versionId: "version-1",
        runtimeId: runtime.runtimeId,
        providerId: runtime.providerId,
        commit: COMMIT,
        contentDigest: DIGEST,
        destination: "/opt/dsh/skills/billing",
        verification: "runtime-inventory",
        installedAt: "2026-08-27T01:00:00.000Z",
        runtime,
    }
    const dependencies = {
        store: {
            getDataset: () => structuredClone(dataset),
            getActiveDatasetRubric: () => overrides.rubric === undefined
                ? {id: "rubric-1", version: 1}
                : overrides.rubric,
        },
        configStore: {
            read: () => ({runtime: overrides.selectedRuntime === undefined
                ? structuredClone(runtime)
                : overrides.selectedRuntime}),
        },
        runtimeServices: {
            descriptor: (runtimeId) => structuredClone(
                overrides.runtimeDescriptors?.[runtimeId] ?? runtime,
            ),
        },
        managedSkillStore: {
            getRepository: () => ({id: "repository-1", displayName: "Billing repo"}),
            getSkill: () => ({
                id: "skill-1",
                repositoryId: "repository-1",
                name: "billing",
                description: "Billing Skill",
            }),
            listVersions: () => structuredClone(overrides.versions ?? [version]),
        },
        installationStore: {
            listVerifiedInstallations: (query) => structuredClone(
                overrides.listVerifiedInstallations
                    ? overrides.listVerifiedInstallations(query)
                    : overrides.installations ?? [installation],
            ),
        },
    }
    return {dataset, installation, runtime, version, resolver: createCurationOperationEvidenceResolver(dependencies)}
}

describe("Curation operation evidence", () => {
    it("freezes one Released version and verified Runtime installation without changing Dataset identity", () => {
        const {dataset, resolver} = fixture()

        const resolved = resolver.resolve(dataset.id)

        assert.equal(dataset.skillReference.path, null)
        assert.equal(resolved.executionSkillReference.path, "/opt/dsh/skills/billing/SKILL.md")
        assert.equal(resolved.executionSkillReference.runtimeId, "deepseek-harness:/opt/dsh")
        assert.deepEqual(resolved.operationEvidence, {
            schemaVersion: "rolling-skill-operation-evidence/v1",
            kind: "curation",
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillName: "billing",
            versionId: "version-1",
            versionLabel: "v1",
            commit: COMMIT,
            skillRoot: "billing",
            contentDigest: DIGEST,
            rubricVersionId: "rubric-1",
            runtime: {
                runtimeId: "deepseek-harness:/opt/dsh",
                providerId: "deepseek-harness",
                displayName: "DeepSeek Harness",
                version: "1.0.0",
                executablePath: "/opt/dsh",
            },
            installation: {
                installationId: "installation-1",
                jobId: "job-1",
                destination: "/opt/dsh/skills/billing",
                verification: "runtime-inventory",
                installedAt: "2026-08-27T01:00:00.000Z",
                marker: {
                    schema: "rolling-skill-install/v1",
                    repositoryId: "repository-1",
                    skillId: "skill-1",
                    versionId: "version-1",
                    commit: COMMIT,
                    contentDigest: DIGEST,
                    installedAt: "2026-08-27T01:00:00.000Z",
                },
            },
        })
        assert.deepEqual(resolver.inspectDataset(dataset.id), {
            datasetId: "dataset-1",
            name: "Billing cases",
            ready: true,
            blockers: [],
            rubricVersionId: "rubric-1",
            runtime: {runtimeId: "deepseek-harness:/opt/dsh", displayName: "DeepSeek Harness", version: "1.0.0"},
            version: {versionId: "version-1", versionLabel: "v1"},
        })
    })

    it("fails closed for missing identity, Rubric, Runtime, installation, drift, or ambiguous newest evidence", () => {
        const cases = [
            [fixture({dataset: {skillReference: {...fixture().dataset.skillReference, path: "/forged"}}}).resolver, /managed Skill/i],
            [fixture({rubric: null}).resolver, /published dataset Rubric/i],
            [fixture({selectedRuntime: null}).resolver, /Select a Runtime/i],
            [fixture({installations: []}).resolver, /verified Skill installation/i],
            [fixture({versions: [{...fixture().version, contentDigest: `sha256:${"c".repeat(64)}`}] }).resolver, /does not match.*Released version/i],
            [fixture({installations: [
                fixture().installation,
                {...fixture().installation, id: "installation-2", installationId: "installation-2", destination: "/other", jobId: "job-2"},
            ]}).resolver, /ambiguous/i],
        ]
        for (const [resolver, expected] of cases) {
            assert.throws(() => resolver.resolve("dataset-1"), expected)
            const inspected = resolver.inspectDataset("dataset-1")
            assert.equal(inspected.ready, false)
            assert.equal(inspected.blockers.length, 1)
            assert.match(inspected.blockers[0].message, expected)
        }
    })

    it("binds the selected Dataset only to matching trusted DSH Skill-call evidence", () => {
        const {resolver} = fixture()
        const observedSkills = [{
            name: "billing",
            provider: "local",
            resourceBase: {kind: "directory", path: "/opt/dsh/skills/billing"},
            callSeq: 6,
            resultSeq: 7,
        }]

        const resolved = resolver.resolve("dataset-1", {observedSkills})

        assert.deepEqual(resolved.operationEvidence.sourceSkill, observedSkills[0])
        assert.throws(
            () => resolver.resolve("dataset-1", {observedSkills: [{
                ...observedSkills[0],
                name: "other-skill",
            }]}),
            /source.*Skill.*does not match|observed.*Skill/i,
        )
        assert.throws(
            () => resolver.resolve("dataset-1", {observedSkills: [{
                ...observedSkills[0],
                resourceBase: {kind: "directory", path: "/forged/skill"},
            }]}),
            /source.*Skill.*installation|observed.*Skill.*installation/i,
        )
    })

    it("resolves Rubric authoring from the same managed Skill installation without requiring an active Rubric", () => {
        const {resolver} = fixture({rubric: null})

        const resolved = resolver.resolveRubric("dataset-1")

        assert.equal(resolved.executionSkillReference.path, "/opt/dsh/skills/billing/SKILL.md")
        assert.equal(resolved.operationEvidence.kind, "rubric")
        assert.equal(resolved.operationEvidence.rubricVersionId, null)
        assert.equal(resolved.operationEvidence.versionId, "version-1")
    })

    it("uses an existing verified installation when the Rubric Agent runs in another Runtime", () => {
        const rubricRuntime = {
            runtimeId: "codex:/Applications/Codex",
            providerId: "codex",
            displayName: "Codex",
            version: "0.150.0",
            executablePath: "/Applications/Codex",
        }
        const installed = fixture().installation
        const {resolver} = fixture({
            rubric: null,
            selectedRuntime: rubricRuntime,
            runtimeDescriptors: {
                [rubricRuntime.runtimeId]: rubricRuntime,
                [installed.runtimeId]: fixture().runtime,
            },
            listVerifiedInstallations(query) {
                return query.runtimeId === rubricRuntime.runtimeId ? [] : [installed]
            },
        })

        const resolved = resolver.resolveRubric("dataset-1")

        assert.equal(resolved.executionSkillReference.runtimeId, installed.runtimeId)
        assert.equal(resolved.operationEvidence.runtime.runtimeId, installed.runtimeId)
        assert.equal(resolved.operationEvidence.installation.installationId, installed.id)
    })
})
