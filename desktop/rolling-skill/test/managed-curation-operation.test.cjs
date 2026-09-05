const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    managedDatasetSkillReference,
    resolveManagedCurationOperation,
} = require("../src/managed-curation-operation.cjs")

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
            name: "billing-cost-management",
            path: null,
            scope: "managed",
            description: "Billing Skill",
            runtimeId: null,
            providerId: null,
            confirmedAt: "2026-09-05T00:00:00.000Z",
        },
        ...(overrides.dataset ?? {}),
    }
    const runtime = {
        runtimeId: "codex:local",
        providerId: "codex",
        displayName: "Codex",
        version: "0.153.3",
        executablePath: "/Applications/ChatGPT.app/Contents/Resources/codex",
    }
    const repository = {id: "repository-1", displayName: "Billing repo"}
    const skill = {
        id: "skill-1",
        repositoryId: repository.id,
        name: "billing-cost-management",
        description: "Billing Skill",
        status: "valid",
    }
    const version = {
        id: "version-1",
        repositoryId: repository.id,
        skillId: skill.id,
        skillRoot: ".",
        commit: COMMIT,
        contentDigest: DIGEST,
        state: "released",
        versionLabel: "v1.0.0",
        releasedAt: "2026-09-05T00:00:00.000Z",
        deprecatedAt: null,
    }
    const installation = {
        id: "installation-1",
        installationId: "installation-1",
        jobId: "job-1",
        repositoryId: repository.id,
        skillId: skill.id,
        skillName: skill.name,
        versionId: version.id,
        runtimeId: runtime.runtimeId,
        providerId: runtime.providerId,
        commit: COMMIT,
        contentDigest: DIGEST,
        destination: "/Users/example/.codex/skills/billing-cost-management",
        verification: "runtime-inventory",
        installedAt: "2026-09-05T01:00:00.000Z",
        runtime,
    }
    const managedSkillStore = {
        getRepository: () => structuredClone(overrides.repository ?? repository),
        getSkill: () => structuredClone(overrides.skill ?? skill),
        listVersions: () => structuredClone(overrides.versions ?? [version]),
    }
    const installationStore = {
        listVerifiedInstallations: () => structuredClone(overrides.installations ?? [installation]),
    }
    return {dataset, installation, installationStore, managedSkillStore, repository, runtime, skill, version}
}

describe("Desktop managed Curation operation", () => {
    it("creates a canonical pathless Dataset Skill from managed ids", () => {
        const {managedSkillStore} = fixture()

        const reference = managedDatasetSkillReference({
            repositoryId: "repository-1",
            skillId: "skill-1",
        }, {managedSkillStore})

        assert.deepEqual(reference, {
            schemaVersion: "rolling-skill-skill-reference/v1",
            evidencePrecision: "managed",
            id: "skill-1",
            repositoryId: "repository-1",
            name: "billing-cost-management",
            path: null,
            scope: "managed",
            description: "Billing Skill",
            runtimeId: null,
            providerId: null,
            confirmedAt: reference.confirmedAt,
        })
        assert.match(reference.confirmedAt, /^2026-/u)
    })

    it("resolves a pathless Dataset Skill through the verified current Runtime installation", () => {
        const fixtureData = fixture()

        const resolved = resolveManagedCurationOperation({
            dataset: fixtureData.dataset,
            runtime: fixtureData.runtime,
            managedSkillStore: fixtureData.managedSkillStore,
            installationStore: fixtureData.installationStore,
        })

        assert.equal(fixtureData.dataset.skillReference.path, null)
        assert.equal(
            resolved.executionSkillReference.path,
            "/Users/example/.codex/skills/billing-cost-management/SKILL.md",
        )
        assert.equal(resolved.executionSkillReference.id, "skill-1")
        assert.equal(resolved.executionSkillReference.runtimeId, "codex:local")
        assert.deepEqual(resolved.operationEvidence, {
            schemaVersion: "rolling-skill-operation-evidence/v1",
            kind: "curation",
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillName: "billing-cost-management",
            versionId: "version-1",
            versionLabel: "v1.0.0",
            commit: COMMIT,
            skillRoot: ".",
            contentDigest: DIGEST,
            rubricVersionId: "rubric-1",
            runtime: fixtureData.runtime,
            installation: {
                installationId: "installation-1",
                jobId: "job-1",
                destination: "/Users/example/.codex/skills/billing-cost-management",
                verification: "runtime-inventory",
                installedAt: "2026-09-05T01:00:00.000Z",
                marker: {
                    schema: "rolling-skill-install/v1",
                    repositoryId: "repository-1",
                    skillId: "skill-1",
                    versionId: "version-1",
                    commit: COMMIT,
                    contentDigest: DIGEST,
                    installedAt: "2026-09-05T01:00:00.000Z",
                },
            },
        })
    })

    it("fails closed when managed identity, Released version, installation, or digest is invalid", () => {
        const base = fixture()
        const cases = [
            [{dataset: {...base.dataset, skillReference: {...base.dataset.skillReference, path: "/forged"}}}, /pathless managed Skill/i],
            [{skill: {...base.skill, repositoryId: "other"}}, /repository/i],
            [{versions: []}, /Released managed Skill version/i],
            [{installations: []}, /current Runtime/i],
            [{installations: [{...base.installation, contentDigest: `sha256:${"c".repeat(64)}`}]}, /Released version/i],
        ]
        for (const [overrides, expected] of cases) {
            const value = fixture(overrides)
            assert.throws(() => resolveManagedCurationOperation({
                dataset: value.dataset,
                runtime: value.runtime,
                managedSkillStore: value.managedSkillStore,
                installationStore: value.installationStore,
            }), expected)
        }
    })
})
