const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createSkillServices} = require("../src/skill-services.cjs")

function fixture() {
    const calls = []
    const manager = {
        catalog: () => ({repositories: [{id: "repo-1"}], skills: [{id: "skill-1", repositoryId: "repo-1"}]}),
        readSkill: (skillId) => ({skill: {id: skillId}, manifest: "# Skill", versions: [{id: "version-1", state: "released"}]}),
        listVersionPage: (input) => ({items: [{id: "version-1"}], input}),
        candidateBase: async (skillId) => ({skillId, commit: "a".repeat(40), contentDigest: "sha256:base", dirty: true}),
        createCandidate: async (input) => { calls.push(["candidate", input]); return {id: "candidate-1", state: "candidate"} },
        releaseVersion: async (input) => { calls.push(["release", input]); return {id: input.versionId, state: "released", versionLabel: input.versionLabel} },
        deprecateVersion: async (input) => ({id: input.versionId, deprecatedAt: "now"}),
        importSource: async (input) => ({repository: {id: "repo-2", ...input}}),
        rescanAll: async () => ({repositories: [], skills: [], versions: [], failures: []}),
    }
    const installationManager = {
        overview: (skillId) => ({skillId, jobs: [{id: "job-1"}], matrix: []}),
        start: async (input) => { calls.push(["install", input]); return [{id: "job-2", status: "queued"}] },
        cancel: async (jobId) => ({id: jobId, status: "cancelled"}),
        inspect: async (jobId) => ({id: "inspect-1", parentJobId: jobId}),
        send: async (jobId, text) => ({id: jobId, text}),
    }
    const installationStore = {getJob: (jobId) => ({id: jobId, status: "running"})}
    const runtimeServices = {list: () => [{runtimeId: "codex:a", executablePath: "/opt/codex-a"}]}
    return {
        services: createSkillServices({manager, installationManager, installationStore, runtimeServices}),
        calls,
    }
}

describe("Rolling Skill managed Skill services", () => {
    it("lists repositories, Skill detail, versions, and installation targets", async () => {
        const test = fixture()
        assert.equal(test.services.catalog().skills[0].id, "skill-1")
        assert.equal(test.services.get({skillId: "skill-1"}).manifest, "# Skill")
        assert.equal(test.services.versions({skillId: "skill-1"}).items[0].id, "version-1")
        assert.equal((await test.services.candidateBase({skillId: "skill-1"})).dirty, true)
        assert.equal(test.services.installationTargets()[0].executablePath, "/opt/codex-a")
    })

    it("delegates Candidate and immutable Release operations to the manager", async () => {
        const test = fixture()
        await test.services.createCandidate({
            skillId: "skill-1",
            message: "Update workflow",
            expectedBase: {commit: "a".repeat(40), contentDigest: "sha256:base", dirty: true},
        })
        await test.services.release({
            versionId: "candidate-1",
            versionLabel: "1.1.0",
            expectedCandidate: {
                commit: "b".repeat(40),
                contentDigest: "sha256:candidate",
                state: "candidate",
                versionLabel: "1.1.0",
            },
        })
        assert.equal(test.calls[0][0], "candidate")
        assert.deepEqual(test.calls[1][1].expectedCandidate, {
            commit: "b".repeat(40),
            contentDigest: "sha256:candidate",
            state: "candidate",
            versionLabel: "1.1.0",
        })
    })

    it("starts, lists, inspects, follows up, and cancels installation Jobs", async () => {
        const test = fixture()
        const started = await test.services.startInstallation({
            skillId: "skill-1",
            versionId: "version-1",
            targets: [{runtimeId: "codex:a", modelId: "gpt", effort: "high", permissionMode: "full"}],
        })
        assert.equal(started[0].status, "queued")
        assert.equal(test.services.installations({skillId: "skill-1"}).jobs[0].id, "job-1")
        assert.equal(test.services.installation({jobId: "job-1"}).status, "running")
        assert.equal((await test.services.inspectInstallation({jobId: "job-1"})).parentJobId, "job-1")
        assert.equal((await test.services.sendInstallation({jobId: "job-1", text: "retry"})).text, "retry")
        assert.equal((await test.services.cancelInstallation({jobId: "job-1"})).status, "cancelled")
    })
})
