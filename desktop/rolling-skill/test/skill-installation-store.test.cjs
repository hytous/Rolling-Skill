const assert = require("node:assert/strict")
const {
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    SKILL_INSTALLATION_STORE_SCHEMA,
    SkillInstallationStore,
} = require("../src/skill-installation-store.cjs")
const {freezeSkillInstallationRequest} = require("../src/skill-installation-protocol.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-install-store-"))
    temporaryDirectories.push(root)
    const path = join(root, "nested", "skill-installations.json")
    return {root, path, store: new SkillInstallationStore(path)}
}

function request(versionId = "version-1") {
    return freezeSkillInstallationRequest({
        repository: {id: "repository-1", managedPath: "/managed/repository-1"},
        skill: {id: "skill-1", name: "billing", skillRoot: "."},
        version: {
            id: versionId,
            repositoryId: "repository-1",
            skillId: "skill-1",
            state: "released",
            commit: versionId === "version-1" ? "a".repeat(40) : "c".repeat(40),
            contentDigest: `sha256:${versionId === "version-1" ? "b" : "d"}`.padEnd(71, versionId === "version-1" ? "b" : "d"),
            versionLabel: versionId === "version-1" ? "v1" : "v2",
        },
    })
}

function runtime(id = "codex:one") {
    return {
        runtimeId: id,
        providerId: id.split(":")[0],
        displayName: id,
        version: "1.0.0",
        executablePath: "/runtime/bin",
    }
}

function parsedResult(request_, overrides = {}) {
    return {
        schema: "rolling-skill-install-result/v1",
        status: "succeeded",
        operation: "install",
        classificationBefore: "absent",
        destination: `/installed/${request_.skillName}`,
        source: {...request_.source},
        permission: {requested: "workspace-write", effective: "workspace-write"},
        result: {
            actualDigest: request_.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: true,
        },
        warnings: [],
        error: null,
        verification: "runtime-inventory",
        trusted: true,
        ...overrides,
    }
}

function createJob(store, request_ = request(), runtime_ = runtime()) {
    return store.createJob({
        runtime: runtime_,
        request: request_,
        modelId: "model-1",
        effort: "high",
        permissionMode: "workspace-write",
    })
}

describe("Skill installation store", () => {
    it("creates a private atomic registry and persists immutable job inputs", () => {
        const {path, store} = fixture()
        const requested = request()
        const job = createJob(store, requested)

        assert.equal(store.read().schemaVersion, SKILL_INSTALLATION_STORE_SCHEMA)
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700)
        assert.equal(job.status, "queued")
        requested.source.commit = "f".repeat(40)
        assert.equal(store.getJob(job.id).request.source.commit, "a".repeat(40))

        const restarted = new SkillInstallationStore(path)
        assert.equal(restarted.getJob(job.id).request.source.commit, "a".repeat(40))
        assert.equal(JSON.parse(readFileSync(path, "utf8")).jobs.length, 1)
    })

    it("enforces task transitions and persists bounded messages and activities", () => {
        const {store} = fixture()
        const job = createJob(store)
        store.updateJob(job.id, {status: "running", threadId: "thread-1", turnId: "turn-1"})
        store.updateJob(job.id, {status: "awaiting_permission"})
        store.appendMessage(job.id, {role: "assistant", content: "Checking target"})
        store.appendActivity(job.id, {
            type: "commandExecution",
            command: "git archive",
            status: "running",
        })
        store.appendMessage(job.id, {role: "assistant", content: "Target checked"})
        store.updateJob(job.id, {status: "verifying"})

        const stored = store.getJob(job.id)
        assert.deepEqual(
            stored.messages.map((entry) => entry.content),
            ["Checking target", "Target checked"],
        )
        assert.deepEqual(stored.activities.map((entry) => entry.command), ["git archive"])
        assert.deepEqual(
            stored.timeline.map((entry) => entry.kind),
            ["message", "activity", "message"],
        )
        assert.throws(() => store.updateJob(job.id, {status: "queued"}), /transition/u)
        assert.throws(
            () => store.appendMessage(job.id, {role: "assistant", content: "x".repeat(140_000)}),
            /large/u,
        )
    })

    it("uses only the newest trusted success in the installation matrix", () => {
        const {store} = fixture()
        const firstRequest = request("version-1")
        const first = createJob(store, firstRequest)
        store.updateJob(first.id, {status: "running"})
        store.completeJob(first.id, {
            status: "succeeded",
            parsedResult: parsedResult(firstRequest),
            traceReference: "/trace/first",
        })

        const failedRequest = request("version-2")
        const failed = createJob(store, failedRequest)
        store.updateJob(failed.id, {status: "running"})
        store.completeJob(failed.id, {
            status: "failed",
            parsedResult: parsedResult(failedRequest, {
                status: "failed",
                trusted: false,
                verification: "none",
                error: {code: "DENIED", message: "Denied"},
            }),
            error: {code: "DENIED", message: "Denied"},
        })

        const matrix = store.installationMatrix("skill-1")
        assert.equal(matrix.length, 1)
        assert.equal(matrix[0].versionId, "version-1")
        assert.equal(matrix[0].lastJobId, failed.id)
        assert.equal(matrix[0].lastJobStatus, "failed")
        assert.equal(store.listJobs({skillId: "skill-1"}).length, 2)
    })

    it("does not trust a succeeded-shaped result unless the protocol marked it trusted", () => {
        const {store} = fixture()
        const requested = request()
        const job = createJob(store, requested)
        store.updateJob(job.id, {status: "running"})
        assert.throws(
            () => store.completeJob(job.id, {
                status: "succeeded",
                parsedResult: parsedResult(requested, {trusted: false, verification: "none"}),
            }),
            /trusted/u,
        )
        const matrix = store.installationMatrix("skill-1")
        assert.equal(matrix.length, 1)
        assert.equal(matrix[0].versionId, null)
        assert.equal(matrix[0].trustedJobId, null)
        assert.equal(matrix[0].lastJobStatus, "running")
    })

    it("turns persisted nonterminal tasks into unverified recovery records on restart", () => {
        const {path, store} = fixture()
        const job = createJob(store)
        store.updateJob(job.id, {status: "running", threadId: "thread-1"})

        const restarted = new SkillInstallationStore(path)
        const recovered = restarted.getJob(job.id)
        assert.equal(recovered.status, "unverified")
        assert.equal(recovered.error.code, "INSTALLER_PROCESS_INTERRUPTED")
        assert.ok(recovered.completedAt)
    })
})
