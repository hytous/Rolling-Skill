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
        schema: "rolling-skill-install-result/v2",
        status: "succeeded",
        operation: "install",
        classificationBefore: "absent",
        destination: `/installed/${request_.skillName}`,
        source: {...request_.source},
        permission: {requested: "workspace-write", effective: "workspace-write"},
        result: {
            actualDigest: request_.source.expectedDigest,
            beforeDigest: null,
            mutationPerformed: true,
            runtimeDiscovered: true,
        },
        warnings: [],
        error: null,
        verification: "runtime-inventory",
        trusted: true,
        ...overrides,
    }
}

function acceptResult(store, job, result = parsedResult(job.request), fingerprint = "registration-1") {
    return store.acceptRegistration(job.id, {
        invocationFingerprint: fingerprint,
        parsedResult: result,
    })
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

function completeSuccessfulJob(store, {
    request: request_ = request(),
    runtime: runtime_ = runtime(),
    destination,
} = {}) {
    const job = createJob(store, request_, runtime_)
    store.updateJob(job.id, {status: "running"})
    acceptResult(store, job, parsedResult(request_, {
        ...(destination ? {destination} : {}),
    }))
    store.completeJob(job.id, {
        status: "succeeded",
    })
    return job
}

function completeSuccessfulInspection(store, {
    request: request_ = request(),
    runtime: runtime_ = runtime(),
    destination = "/installed/billing",
} = {}) {
    const job = store.createJob({
        operation: "inspect",
        runtime: runtime_,
        request: request_,
        modelId: "model-1",
        effort: "high",
        permissionMode: "read-only",
    })
    store.updateJob(job.id, {status: "running"})
    const absent = destination === null
    acceptResult(store, job, parsedResult(request_, {
        operation: "inspect",
        classificationBefore: absent ? "absent" : "managed-clean",
        destination,
        permission: {requested: "read-only", effective: "read-only"},
        result: {
            actualDigest: absent ? null : request_.source.expectedDigest,
            beforeDigest: absent ? null : request_.source.expectedDigest,
            mutationPerformed: false,
            runtimeDiscovered: absent ? false : true,
        },
    }), `inspection-${job.id}`)
    store.completeJob(job.id, {status: "succeeded"})
    return job
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
        assert.deepEqual(job.registration, {
            state: "pending",
            invocationFingerprint: null,
            acceptedAt: null,
        })
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
        acceptResult(store, first, parsedResult(firstRequest))
        store.completeJob(first.id, {
            status: "succeeded",
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

    it("lets a trusted inspection invalidate stale install evidence and restore it when present", () => {
        const {path, store} = fixture()
        completeSuccessfulJob(store)
        const absent = completeSuccessfulInspection(store, {destination: null})

        let matrix = store.installationMatrix("skill-1")
        assert.equal(matrix.length, 1)
        assert.equal(matrix[0].versionId, null)
        assert.equal(matrix[0].trustedJobId, null)
        assert.equal(matrix[0].lastJobId, absent.id)
        assert.throws(() => store.resolveVerifiedInstallation({
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            runtimeId: "codex:one",
            providerId: "codex",
        }), /verified.*installation|installation.*required/i)

        const restarted = new SkillInstallationStore(path)
        matrix = restarted.installationMatrix("skill-1")
        assert.equal(matrix[0].versionId, null)

        const present = completeSuccessfulInspection(restarted)
        matrix = restarted.installationMatrix("skill-1")
        assert.equal(matrix[0].versionId, "version-1")
        assert.equal(matrix[0].trustedJobId, present.id)
        assert.equal(matrix[0].destination, "/installed/billing")
    })

    it("does not trust a succeeded-shaped result unless the protocol marked it trusted", () => {
        const {store} = fixture()
        const requested = request()
        const job = createJob(store, requested)
        store.updateJob(job.id, {status: "running"})
        assert.throws(
            () => acceptResult(
                store,
                job,
                parsedResult(requested, {trusted: false, verification: "none"}),
            ),
            /trusted/u,
        )
        const matrix = store.installationMatrix("skill-1")
        assert.equal(matrix.length, 1)
        assert.equal(matrix[0].versionId, null)
        assert.equal(matrix[0].trustedJobId, null)
        assert.equal(matrix[0].lastJobStatus, "running")
    })

    it("accepts one idempotent registration and rejects conflicting evidence", () => {
        const {store} = fixture()
        const job = createJob(store)
        store.updateJob(job.id, {status: "running"})
        const result = parsedResult(job.request)

        assert.deepEqual(acceptResult(store, job, result), {
            accepted: true,
            duplicate: false,
        })
        assert.deepEqual(acceptResult(store, job, result), {
            accepted: true,
            duplicate: true,
        })
        assert.throws(
            () => acceptResult(
                store,
                job,
                {...result, destination: "/installed/other"},
                "registration-2",
            ),
            /conflicting/iu,
        )
        const stored = store.getJob(job.id)
        assert.equal(stored.registration.state, "accepted")
        assert.equal(stored.parsedResult.destination, "/installed/billing")
        assert.ok(stored.registration.acceptedAt)
    })

    it("resolves one exact verified normal installation with complete frozen evidence", () => {
        const {store} = fixture()
        const requested = request()
        const job = completeSuccessfulJob(store, {
            request: requested,
            destination: "/installed/billing-codex",
        })

        const installation = store.resolveVerifiedInstallation({
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            runtimeId: "codex:one",
            providerId: "codex",
        })

        assert.equal(installation.jobId, job.id)
        assert.equal(installation.installationId, installation.id)
        assert.equal(installation.destination, "/installed/billing-codex")
        assert.equal(installation.commit, "a".repeat(40))
        assert.equal(installation.contentDigest, `sha256:${"b".repeat(64)}`)
        assert.equal(installation.verification, "runtime-inventory")
        assert.equal(Object.isFrozen(installation), true)
        assert.throws(
            () => store.resolveVerifiedInstallation({
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "version-2",
                runtimeId: "codex:one",
                providerId: "codex",
            }),
            /verified.*installation|installation.*required/i,
        )
    })

    it("uses the newest verified installation and fails closed on conflicting newest records", () => {
        const {store} = fixture()
        completeSuccessfulJob(store, {destination: "/installed/billing-old"})
        const newestJob = completeSuccessfulJob(store, {destination: "/installed/billing-new"})
        store.state.installations[0].installedAt = "2026-08-26T01:00:00.000Z"
        store.state.installations[1].installedAt = "2026-08-26T02:00:00.000Z"
        store.persist()

        const newest = store.resolveVerifiedInstallation({
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            runtimeId: "codex:one",
            providerId: "codex",
        })
        assert.equal(newest.jobId, newestJob.id)
        assert.equal(newest.destination, "/installed/billing-new")

        store.state.installations[0].installedAt = "2026-08-26T02:00:00.000Z"
        store.persist()
        assert.throws(
            () => store.resolveVerifiedInstallation({
                repositoryId: "repository-1",
                skillId: "skill-1",
                versionId: "version-1",
                runtimeId: "codex:one",
                providerId: "codex",
            }),
            /conflicting.*installation|ambiguous/i,
        )
    })

    it("matches a legacy SKILL.md path only to one trustworthy managed identity", () => {
        const {store} = fixture()
        completeSuccessfulJob(store, {destination: "/installed/billing"})

        const resolved = store.resolveManagedInstallationForLegacyReference({
            name: "billing",
            path: "/installed/billing/SKILL.md",
            runtimeId: "codex:one",
            providerId: "codex",
        })

        assert.equal(resolved.repositoryId, "repository-1")
        assert.equal(resolved.skillId, "skill-1")
        assert.equal(resolved.destination, "/installed/billing")
        assert.equal(
            store.resolveManagedInstallationForLegacyReference({
                name: "billing",
                path: "/installed/other/SKILL.md",
                runtimeId: "codex:one",
                providerId: "codex",
            }),
            null,
        )
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
