const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    buildSkillInstallationPrompt,
    freezeSkillInstallationRequest,
    validateSkillInstallationRegistration,
} = require("../src/skill-installation-protocol.cjs")

function fixtureRequest(overrides = {}) {
    return freezeSkillInstallationRequest({
        repository: {
            id: "repository-1",
            managedPath: "/managed/repository-1",
            ...overrides.repository,
        },
        skill: {
            id: "skill-1",
            name: "billing-cost-management",
            skillRoot: "skills/billing-cost-management",
            ...overrides.skill,
        },
        version: {
            id: "version-1",
            repositoryId: "repository-1",
            skillId: "skill-1",
            state: "released",
            commit: "a".repeat(40),
            contentDigest: `sha256:${"b".repeat(64)}`,
            versionLabel: "v1.0.0",
            ...overrides.version,
        },
    })
}

function evidence(request, overrides = {}) {
    return {
        status: "succeeded",
        operation: "install",
        classificationBefore: "absent",
        destination: "/runtime/skills/billing-cost-management",
        actualDigest: request.source.expectedDigest,
        beforeDigest: null,
        mutationPerformed: true,
        runtimeDiscovered: true,
        warnings: [],
        error: null,
        ...overrides,
    }
}

describe("Runtime-driven Skill installation protocol", () => {
    it("freezes only Released source identity without Runtime-directory metadata", () => {
        const input = {
            repository: {id: "repository-1", managedPath: "/managed/repository-1"},
            skill: {id: "skill-1", name: "billing", skillRoot: "."},
            version: {
                id: "version-1",
                repositoryId: "repository-1",
                skillId: "skill-1",
                state: "released",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                versionLabel: "v1",
            },
        }
        const request = freezeSkillInstallationRequest(input)
        input.version.commit = "c".repeat(40)

        assert.equal(request.source.commit, "a".repeat(40))
        assert.equal(Object.isFrozen(request), true)
        assert.equal(Object.isFrozen(request.source), true)
        assert.equal(Object.hasOwn(request, "markerSchema"), false)
        assert.throws(
            () => fixtureRequest({version: {state: "candidate"}}),
            /Released/u,
        )
    })

    it("accepts structured success and failure registrations without parsing prose", () => {
        const request = fixtureRequest()
        const success = validateSkillInstallationRegistration(evidence(request), request, {
            requestedPermission: "workspace-write",
            effectivePermission: "workspace-write",
        })
        assert.equal(success.verification, "runtime-inventory")
        assert.equal(success.trusted, true)
        assert.equal(Object.hasOwn(success.result, "markerWritten"), false)

        const failure = validateSkillInstallationRegistration(evidence(request, {
            status: "failed",
            actualDigest: null,
            mutationPerformed: false,
            runtimeDiscovered: false,
            error: {code: "PERMISSION_DENIED", message: "User denied access"},
        }), request)
        assert.equal(failure.verification, "none")
        assert.equal(failure.trusted, false)
        assert.equal(failure.error.code, "PERMISSION_DENIED")
    })

    it("builds a provider-neutral prompt with central-journal hints and no legacy protocol", () => {
        const request = fixtureRequest()
        const prompt = buildSkillInstallationPrompt(request, {
            operation: "install",
            requestedPermission: "workspace-write",
            registrationInstruction: "Call rolling_skill_installations_register now.",
            priorInstallation: {
                destination: "/previous/path",
                versionId: "older",
                lastJobId: "current-job",
                lastJobStatus: "running",
                lastJobUpdatedAt: "2026-09-02T03:08:13.355Z",
            },
        })

        assert.match(prompt, /managed-clean/u)
        assert.match(prompt, /managed-drifted/u)
        assert.match(prompt, /unmanaged/u)
        assert.match(prompt, /conflict/u)
        assert.match(prompt, /uncertain/u)
        assert.match(prompt, new RegExp(request.source.commit))
        assert.match(prompt, /priorInstallation\.destination/u)
        assert.match(prompt, /rolling_skill_installations_register/u)
        assert.match(prompt, /final assistant response is display-only/iu)
        assert.match(prompt, /Only delete temporary paths created by this Job/u)
        assert.match(prompt, /Never delete or modify pre-existing temporary paths/u)
        assert.doesNotMatch(prompt, /lastJobStatus|lastJobId|lastJobUpdatedAt|current-job/u)
        assert.doesNotMatch(prompt, /rolling-skill-managed|rolling-skill-experiment/iu)
        assert.doesNotMatch(prompt, /rolling-skill-install-result|sentinel/iu)
        assert.doesNotMatch(prompt, /\.codex\/skills|\.codebuddy\/skills|\.dsh\/skills/u)
        assert.doesNotMatch(prompt, /Codex|CodeBuddy|DeepSeek Harness/u)
    })

    it("builds an inspect-only recovery prompt that forbids filesystem changes", () => {
        const request = fixtureRequest()
        const prompt = buildSkillInstallationPrompt(request, {
            operation: "inspect",
            requestedPermission: "read-only",
        })

        assert.match(prompt, /strictly read-only/u)
        assert.match(prompt, /Do not create, edit, move, delete, overwrite, chmod/u)
        assert.match(prompt, /request write permission/u)
        assert.match(prompt, /"operation": "inspect"/u)
        assert.doesNotMatch(prompt, /Install or update the exact frozen Released source/u)
    })
})
