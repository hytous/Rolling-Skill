const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    buildSkillInstallationPrompt,
    freezeSkillExperimentRequest,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillInstallationRequest,
    validateSkillInstallationRegistration,
} = require("../src/skill-installation-protocol.cjs")

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function facts() {
    const repository = {id: "repository-1", managedPath: "/managed/repository-1"}
    const skill = {
        id: "skill-1",
        repositoryId: repository.id,
        name: "billing",
        skillRoot: "skills/billing",
    }
    const baseline = {
        id: "release-1",
        repositoryId: repository.id,
        skillId: skill.id,
        skillRoot: skill.skillRoot,
        state: "released",
        commit: "a".repeat(40),
        contentDigest: digest("b"),
        versionLabel: "v1.0.0",
    }
    const candidate = {
        id: "candidate-2",
        repositoryId: repository.id,
        skillId: skill.id,
        skillRoot: skill.skillRoot,
        state: "candidate",
        commit: "c".repeat(40),
        contentDigest: digest("d"),
        createdBy: "optimization",
        optimizationRunId: "run-1",
        optimizationEpoch: 2,
    }
    const previousCandidate = {
        ...candidate,
        id: "candidate-1",
        commit: "e".repeat(40),
        contentDigest: digest("f"),
        optimizationEpoch: 1,
    }
    const run = {
        id: "run-1",
        snapshot: {
            digest: digest("1"),
            baseline: {
                repositoryId: baseline.repositoryId,
                skillId: baseline.skillId,
                versionId: baseline.id,
                commit: baseline.commit,
                skillRoot: baseline.skillRoot,
                contentDigest: baseline.contentDigest,
            },
        },
    }
    return {repository, skill, baseline, candidate, previousCandidate, run}
}

function ordinaryRequest() {
    const value = facts()
    return freezeSkillInstallationRequest({
        repository: value.repository,
        skill: value.skill,
        version: value.baseline,
    })
}

function experimentRequest(overrides = {}) {
    const value = facts()
    return freezeSkillExperimentRequest({
        operation: "experiment_install",
        run: value.run,
        epoch: 2,
        repository: value.repository,
        skill: value.skill,
        baseline: value.baseline,
        candidate: value.candidate,
        previousCandidate: value.previousCandidate,
        initial: {classification: "absent", destination: null},
        ...overrides,
    })
}

function success(request, overrides = {}) {
    return {
        status: "succeeded",
        operation: request.operation ?? "install",
        classificationBefore: request.purpose === "optimization-experiment"
            ? request.experiment.previous ? "managed-clean" : request.experiment.initial.classification
            : "unmanaged",
        destination: "/runtime/skills/billing",
        actualDigest: request.source.expectedDigest,
        beforeDigest: request.experiment?.previous?.expectedDigest ?? digest("9"),
        mutationPerformed: true,
        runtimeDiscovered: true,
        warnings: [],
        error: null,
        ...overrides,
    }
}

describe("tool-registered Skill installation evidence", () => {
    it("trusts an ordinary installation without any Runtime-directory marker", () => {
        const request = ordinaryRequest()
        const parsed = validateSkillInstallationRegistration(success(request), request)

        assert.equal(parsed.trusted, true)
        assert.equal(parsed.verification, "runtime-inventory")
        assert.deepEqual(parsed.source, request.source)
        assert.equal(Object.hasOwn(request, "markerSchema"), false)
        assert.equal(Object.hasOwn(parsed.result, "markerWritten"), false)
    })

    it("rejects relative paths and successful digest mismatches", () => {
        const request = ordinaryRequest()
        assert.throws(() => validateSkillInstallationRegistration(
            success(request, {destination: "relative/skill"}),
            request,
        ), /absolute/u)
        assert.throws(() => validateSkillInstallationRegistration(
            success(request, {actualDigest: digest("0")}),
            request,
        ), /digest/u)
    })

    it("normalizes a structured failure without trusting it", () => {
        const request = ordinaryRequest()
        const parsed = validateSkillInstallationRegistration(success(request, {
            status: "failed",
            operation: "inspect",
            mutationPerformed: false,
            error: {code: "TARGET_CHANGED", message: "Target changed"},
        }), request, {operation: "inspect"})

        assert.equal(parsed.status, "failed")
        assert.equal(parsed.trusted, false)
        assert.equal(parsed.error.code, "TARGET_CHANGED")
    })

    it("validates Candidate rotation by exact journal digests instead of markers", () => {
        const request = experimentRequest()
        const parsed = validateSkillInstallationRegistration(success(request), request)

        assert.equal(parsed.trusted, true)
        assert.equal(parsed.result.beforeDigest, request.experiment.previous.expectedDigest)
        assert.equal(Object.hasOwn(request.experiment, "marker"), false)
        assert.equal(Object.hasOwn(parsed.result, "markerBefore"), false)
        assert.throws(() => validateSkillInstallationRegistration(
            success(request, {beforeDigest: digest("0")}),
            request,
        ), /previous Candidate digest/u)
    })

    it("validates restore, remove, and recovery inspection without marker evidence", () => {
        const value = facts()
        const managedInitial = {
            classification: "managed-clean",
            destination: "/runtime/skills/billing",
            versionId: value.baseline.id,
            commit: value.baseline.commit,
            contentDigest: value.baseline.contentDigest,
        }
        const restore = experimentRequest({
            operation: "experiment_restore",
            initial: managedInitial,
        })
        const restored = validateSkillInstallationRegistration(success(restore, {
            actualDigest: restore.experiment.baseline.expectedDigest,
            beforeDigest: restore.source.expectedDigest,
        }), restore)
        assert.equal(restored.trusted, true)

        const remove = experimentRequest({operation: "experiment_remove"})
        const removed = validateSkillInstallationRegistration(success(remove, {
            actualDigest: null,
            beforeDigest: remove.source.expectedDigest,
            runtimeDiscovered: false,
        }), remove)
        assert.equal(removed.trusted, true)

        const recovery = freezeSkillExperimentRecoveryInspectionRequest(remove)
        const inspected = validateSkillInstallationRegistration(success(recovery, {
            operation: "experiment_inspect",
            classificationBefore: "absent",
            destination: null,
            actualDigest: null,
            beforeDigest: null,
            mutationPerformed: false,
            runtimeDiscovered: false,
        }), recovery)
        assert.equal(inspected.trusted, true)
    })

    it("requires the registration tool and never requests marker or sentinel output", () => {
        const request = ordinaryRequest()
        const prompt = buildSkillInstallationPrompt(request, {
            operation: "install",
            requestedPermission: "full",
            registrationInstruction: "Call rolling_skill_installations_register with the verified evidence.",
        })

        assert.match(prompt, /rolling_skill_installations_register/u)
        assert.match(prompt, /final assistant response is display-only/iu)
        assert.doesNotMatch(prompt, /rolling-skill-managed|rolling-skill-experiment/iu)
        assert.doesNotMatch(prompt, /rolling-skill-install-result|sentinel/iu)
    })
})
