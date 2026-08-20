const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    INSTALL_MARKER_SCHEMA,
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
    buildSkillInstallationPrompt,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
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

function resultPayload(request, overrides = {}) {
    const payload = {
        schema: INSTALL_RESULT_SCHEMA,
        status: "succeeded",
        operation: "install",
        classificationBefore: "absent",
        destination: "/runtime/skills/billing-cost-management",
        source: {...request.source},
        permission: {requested: "workspace-write", effective: "workspace-write"},
        result: {
            actualDigest: request.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: true,
        },
        warnings: [],
        error: null,
        ...overrides,
    }
    return `${INSTALL_RESULT_SENTINEL.open}\n${JSON.stringify(payload)}\n${INSTALL_RESULT_SENTINEL.close}`
}

describe("Runtime-driven Skill installation protocol", () => {
    it("freezes only a Released version and exposes no mutable input objects", () => {
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
        assert.equal(request.markerSchema, INSTALL_MARKER_SCHEMA)
        assert.throws(
            () => fixtureRequest({version: {state: "candidate"}}),
            /Released/u,
        )
    })

    it("accepts a matching Runtime-inventory result as trusted", () => {
        const request = fixtureRequest()
        const parsed = parseSkillInstallationResult(resultPayload(request), request)

        assert.equal(parsed.status, "succeeded")
        assert.equal(parsed.verification, "runtime-inventory")
        assert.equal(parsed.trusted, true)
    })

    it("accepts a digest-and-marker result as filesystem-only", () => {
        const request = fixtureRequest()
        const text = resultPayload(request, {
            result: {
                actualDigest: request.source.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: null,
            },
        })
        const parsed = parseSkillInstallationResult(text, request)

        assert.equal(parsed.verification, "filesystem-only")
        assert.equal(parsed.trusted, true)
    })

    it("rejects missing, duplicate, malformed, and mismatched protocol results", () => {
        const request = fixtureRequest()
        const valid = resultPayload(request)

        assert.throws(() => parseSkillInstallationResult("done", request), /exactly one/u)
        assert.throws(() => parseSkillInstallationResult(`${valid}\n${valid}`, request), /exactly one/u)
        assert.throws(
            () => parseSkillInstallationResult(
                `${INSTALL_RESULT_SENTINEL.open}{bad${INSTALL_RESULT_SENTINEL.close}`,
                request,
            ),
            /valid JSON/u,
        )
        assert.throws(
            () => parseSkillInstallationResult(resultPayload(request, {
                source: {...request.source, versionId: "other"},
            }), request),
            /frozen source/u,
        )
        assert.throws(
            () => parseSkillInstallationResult(resultPayload(request, {
                destination: "relative/path",
            }), request),
            /absolute/u,
        )
    })

    it("rejects a contradictory success and normalizes a structured failure", () => {
        const request = fixtureRequest()
        assert.throws(
            () => parseSkillInstallationResult(resultPayload(request, {
                result: {
                    actualDigest: `sha256:${"c".repeat(64)}`,
                    markerWritten: true,
                    runtimeDiscovered: true,
                },
            }), request),
            /digest/u,
        )

        const failure = parseSkillInstallationResult(resultPayload(request, {
            status: "failed",
            operation: "update",
            classificationBefore: "managed-drifted",
            result: {actualDigest: null, markerWritten: false, runtimeDiscovered: false},
            error: {code: "PERMISSION_DENIED", message: "User denied access"},
        }), request)
        assert.equal(failure.status, "failed")
        assert.equal(failure.verification, "none")
        assert.equal(failure.trusted, false)
    })

    it("builds a provider-neutral prompt with all safety classifications and the exact protocol", () => {
        const request = fixtureRequest()
        const prompt = buildSkillInstallationPrompt(request, {
            operation: "install",
            requestedPermission: "workspace-write",
            priorInstallation: {destination: "/previous/path", versionId: "older"},
        })

        assert.match(prompt, /managed-clean/u)
        assert.match(prompt, /managed-drifted/u)
        assert.match(prompt, /unmanaged/u)
        assert.match(prompt, /conflict/u)
        assert.match(prompt, /uncertain/u)
        assert.match(prompt, new RegExp(request.source.commit))
        assert.match(prompt, new RegExp(INSTALL_RESULT_SCHEMA.replaceAll("/", "\\/")))
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
        assert.match(prompt, /Do not create, edit, move, delete, overwrite, or chmod/u)
        assert.match(prompt, /Do not request write permission/u)
        assert.match(prompt, /"operation": "inspect"/u)
        assert.doesNotMatch(prompt, /If authorized, install\/update/u)
    })
})
