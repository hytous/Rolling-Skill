const assert = require("node:assert/strict")
const {spawnSync} = require("node:child_process")
const {createHash} = require("node:crypto")
const {
    chmodSync,
    linkSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
    truncateSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {dirname, isAbsolute, join, resolve} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    MAX_ARTIFACT_BYTES,
    OPERATOR_JOB_STORE_SCHEMA,
    OperatorJobStore,
} = require("../src/operator/job-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-operator-jobs-"))
    temporaryDirectories.push(root)
    const path = join(root, "private", "operator-jobs.json")
    return {root, path, store: new OperatorJobStore(path)}
}

function runtime(runtimeId = "codex:operator") {
    return {
        runtimeId,
        providerId: runtimeId.split(":")[0],
        displayName: runtimeId,
        version: "1.2.3",
        executablePath: "/usr/local/bin/runtime",
    }
}

function budget() {
    return {
        maxDurationMs: 60_000,
        maxRuntimeTurns: 20,
        maxEvaluations: 4,
        maxTargetExecutions: 20,
        maxJudgeExecutions: 20,
        maxTokens: null,
        maxReportedCost: null,
    }
}

function createSession(store, overrides = {}) {
    return store.createSession({
        runtime: runtime(),
        modelId: "gpt-5.6-sol",
        effort: "high",
        protocol: "rolling-skill-operator/v1",
        capabilityId: "grant-1",
        ...overrides,
    })
}

function createJob(store, sessionId, overrides = {}) {
    return store.createJob({
        sessionId,
        type: "operator",
        objective: "评测 billing Skill",
        budget: budget(),
        ...overrides,
    })
}

function pathToStatus(store, jobId, status) {
    const paths = {
        queued: [],
        running: ["running"],
        waiting_approval: ["running", "waiting_approval"],
        paused: ["running", "paused"],
        cancelling: ["running", "cancelling"],
        needs_recovery: ["running", "needs_recovery"],
    }
    for (const next of paths[status]) store.transitionJob(jobId, next)
}

function collectSummaryPages(store, {limit = 2} = {}) {
    const combined = {
        sessions: [],
        jobs: [],
        steps: [],
        approvals: [],
    }
    let cursor = null
    let revision = null
    do {
        const page = store.readSummaryPage({cursor, limit})
        revision ??= page.revision
        assert.equal(page.revision, revision)
        for (const key of Object.keys(combined)) combined[key].push(...page[key])
        cursor = page.nextCursor
    } while (cursor !== null)
    return {...combined, revision}
}

function rewriteRegistry(path, mutate) {
    const registry = JSON.parse(readFileSync(path, "utf8"))
    mutate(registry)
    writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`)
}

function assertRegistryCorruptionRejected(setup, mutate, pattern = /invalid|unsupported|unknown/iu) {
    const {path, store} = fixture()
    const context = setup(store)
    store.close()
    rewriteRegistry(path, (registry) => mutate(registry, context))
    assert.throws(() => new OperatorJobStore(path), pattern)
}

describe("Operator Job store", () => {
    it("prioritizes active Jobs and exposes revision-bound bounded summary pages", () => {
        const {store} = fixture()
        const first = createSession(store)
        const firstJob = createJob(store, first.id, {
            checkpoint: {
                optimizationRunId: "optimization-run-1",
                workspacePath: "/private/must-not-leak",
            },
        })
        store.transitionJob(firstJob.id, "running")
        for (let index = 0; index < 20; index += 1) {
            store.appendSessionTranscript(first.id, {
                kind: "message",
                content: `large transcript entry ${index} ${"x".repeat(1_000)}`,
            })
            store.appendEvent(firstJob.id, {kind: "progress", index})
        }
        store.createArtifact(firstJob.id, {
            kind: "operator-note",
            name: "large.txt",
            mediaType: "text/plain",
            body: "sensitive artifact body",
        })
        const second = createSession(store, {capabilityId: "grant-2"})
        const secondJob = createJob(store, second.id)
        store.transitionJob(secondJob.id, "running")
        store.transitionJob(secondJob.id, "succeeded")

        const summary = store.readSummaryPage({limit: 1})

        assert.deepEqual(summary.totals, {sessions: 2, jobs: 2, steps: 0, approvals: 0})
        assert.equal(summary.revision, store.revision)
        assert.equal(summary.truncated, true)
        assert.equal(typeof summary.nextCursor, "string")
        assert.deepEqual(summary.jobs.map((job) => job.id), [firstJob.id])
        assert.equal(summary.jobs[0].optimizationRunId, "optimization-run-1")
        assert.equal(Object.hasOwn(summary.jobs[0], "checkpoint"), false)
        assert.doesNotMatch(JSON.stringify(summary), /workspacePath|must-not-leak/iu)
        assert.deepEqual(summary.sessions, [])
        assert.deepEqual(summary.approvals, [])
        assert.doesNotMatch(JSON.stringify(summary), /large transcript|sensitive artifact body/iu)

        const all = collectSummaryPages(store, {limit: 1})
        assert.deepEqual(new Set(all.jobs.map((job) => job.id)), new Set([firstJob.id, secondJob.id]))
        assert.deepEqual(new Set(all.sessions.map((session) => session.id)), new Set([first.id, second.id]))
        assert.equal(Object.hasOwn(all.sessions[0], "transcript"), false)
        assert.doesNotMatch(JSON.stringify(all), /large transcript|sensitive artifact body/iu)
        assert.throws(() => store.readSummaryPage({limit: 0}), /summary.*limit/iu)
        assert.throws(() => store.readSummaryPage({limit: 1_001}), /summary.*limit/iu)
    })

    it("dismisses terminal root Job records from summaries while preserving audit evidence", () => {
        const {path, store} = fixture()
        const hiddenSession = createSession(store)
        const hiddenRoot = createJob(store, hiddenSession.id, {objective: "old optimization"})
        const hiddenChild = createJob(store, hiddenSession.id, {
            parentJobId: hiddenRoot.id,
            objective: "old evaluation",
        })
        store.transitionJob(hiddenRoot.id, "running")
        store.transitionJob(hiddenChild.id, "running")
        const step = store.createStep(hiddenChild.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "read-before-dismiss",
        })
        store.transitionStep(step.id, "running")
        const artifact = store.createArtifact(hiddenChild.id, {
            kind: "evaluation-result",
            name: "result.json",
            mediaType: "application/json",
            body: JSON.stringify({score: 88}),
        })
        store.transitionStep(step.id, "succeeded", {outputArtifactIds: [artifact.id]})
        store.appendEvent(hiddenChild.id, {kind: "evaluation_finished", score: 88})
        store.transitionJob(hiddenChild.id, "succeeded")
        store.transitionJob(hiddenRoot.id, "succeeded")

        const visibleSession = createSession(store, {capabilityId: "grant-visible"})
        const visibleJob = createJob(store, visibleSession.id, {objective: "keep me"})
        store.transitionJob(visibleJob.id, "cancelled")

        const dismissed = store.dismissJobRecords([hiddenRoot.id])
        assert.deepEqual(dismissed, {jobIds: [hiddenRoot.id]})
        const summary = collectSummaryPages(store, {limit: 1})
        assert.deepEqual(summary.jobs.map((job) => job.id), [visibleJob.id])
        assert.deepEqual(summary.sessions.map((session) => session.id), [visibleSession.id])
        assert.deepEqual(summary.steps, [])
        assert.deepEqual(store.readSummaryPage().totals, {
            sessions: 1,
            jobs: 1,
            steps: 0,
            approvals: 0,
        })

        assert.equal(store.getJob(hiddenRoot.id).status, "succeeded")
        assert.equal(store.getJob(hiddenChild.id).status, "succeeded")
        assert.equal(store.getSession(hiddenSession.id).id, hiddenSession.id)
        assert.equal(store.listEvents(hiddenChild.id).at(-1).score, 88)
        assert.deepEqual(JSON.parse(store.readArtifactBody(artifact.id).toString("utf8")), {score: 88})

        const revision = store.revision
        assert.deepEqual(store.dismissJobRecords([hiddenRoot.id]), {jobIds: [hiddenRoot.id]})
        assert.equal(store.revision, revision)
        store.close()

        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.read().dismissedRootJobIds, [hiddenRoot.id])
        assert.deepEqual(collectSummaryPages(restarted).jobs.map((job) => job.id), [visibleJob.id])
        assert.equal(restarted.getArtifact(artifact.id).id, artifact.id)
    })

    it("rejects active or child Job record dismissal atomically", () => {
        const {store} = fixture()
        const session = createSession(store)
        const terminal = createJob(store, session.id, {objective: "terminal"})
        const child = createJob(store, session.id, {
            parentJobId: terminal.id,
            objective: "child",
        })
        const active = createJob(store, session.id, {objective: "active"})
        store.transitionJob(child.id, "cancelled")
        store.transitionJob(terminal.id, "cancelled")
        store.transitionJob(active.id, "running")

        assert.throws(() => store.dismissJobRecords([child.id]), /root/iu)
        assert.throws(() => store.dismissJobRecords([terminal.id, active.id]), /terminal|finished/iu)
        assert.deepEqual(store.read().dismissedRootJobIds, [])
        assert.throws(() => store.dismissJobRecords([]), /at least|1/iu)
        assert.throws(() => store.dismissJobRecords([terminal.id, terminal.id]), /duplicate|unique/iu)
        assert.throws(() => store.dismissJobRecords(["missing-job"]), /not found/iu)
    })

    it("migrates v2 registries with an empty dismissed record set", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "cancelled")
        store.close()
        rewriteRegistry(path, (registry) => {
            registry.schemaVersion = "rolling-skill-operator-jobs/v2"
            delete registry.dismissedRootJobIds
        })

        const migrated = new OperatorJobStore(path)
        assert.equal(migrated.read().schemaVersion, OPERATOR_JOB_STORE_SCHEMA)
        assert.deepEqual(migrated.read().dismissedRootJobIds, [])
        assert.deepEqual(collectSummaryPages(migrated).jobs.map((entry) => entry.id), [job.id])
        assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).dismissedRootJobIds, [])
    })

    it("pages every active Job before recent terminal records and rejects a stale cursor", () => {
        const {store} = fixture()
        const session = createSession(store)
        const activeJobs = ["early", "middle", "late"].map((objective) => {
            const job = createJob(store, session.id, {objective})
            store.transitionJob(job.id, "running")
            return job
        })
        const terminal = createJob(store, session.id, {objective: "newest terminal"})
        store.transitionJob(terminal.id, "running")
        store.transitionJob(terminal.id, "succeeded")

        const first = store.readSummaryPage({limit: 2})
        const second = store.readSummaryPage({cursor: first.nextCursor, limit: 2})
        assert.deepEqual(first.jobs.map((job) => job.id), activeJobs.slice(0, 2).map((job) => job.id))
        assert.deepEqual(second.jobs.map((job) => job.id), [activeJobs[2].id])
        assert.equal(second.sessions[0].id, session.id)
        assert.equal(first.truncated, true)

        const staleCursor = second.nextCursor
        createJob(store, session.id, {objective: "revision changed"})
        assert.throws(
            () => store.readSummaryPage({cursor: staleCursor, limit: 2}),
            (error) => error?.code === "OPERATOR_SNAPSHOT_CHANGED",
        )
    })

    it("rejects snapshot cursors across three backend reopen generations", () => {
        const {path, store: initial} = fixture()
        const session = createSession(initial)
        const job = createJob(initial, session.id)
        initial.transitionJob(job.id, "cancelled")
        initial.close()

        const generations = []
        let priorCursor = null
        for (let cycle = 0; cycle < 3; cycle += 1) {
            const reopened = new OperatorJobStore(path)
            const page = reopened.readSummaryPage({limit: 1})
            assert.equal(typeof page.generation, "string")
            assert.match(page.generation, /^[0-9a-f-]{36}$/u)
            generations.push(page.generation)
            if (priorCursor !== null) {
                assert.throws(
                    () => reopened.readSummaryPage({cursor: priorCursor, limit: 1}),
                    (error) => error?.code === "OPERATOR_SNAPSHOT_CHANGED",
                )
            }
            priorCursor = page.nextCursor
            assert.equal(typeof priorCursor, "string")
            reopened.close()
        }
        assert.equal(new Set(generations).size, 3)
    })

    it("fills remaining summary capacity by terminal update time instead of insertion order", async () => {
        const {store} = fixture()
        const session = createSession(store)
        const createdFirst = createJob(store, session.id, {objective: "finishes last"})
        const createdSecond = createJob(store, session.id, {objective: "finishes first"})
        store.transitionJob(createdSecond.id, "running")
        store.transitionJob(createdSecond.id, "succeeded")
        await new Promise((resolve_) => setTimeout(resolve_, 2))
        store.transitionJob(createdFirst.id, "running")
        store.transitionJob(createdFirst.id, "succeeded")

        const page = store.readSummaryPage({limit: 1})
        assert.deepEqual(page.jobs.map((job) => job.id), [createdFirst.id])
    })

    it("coordinates every live Store for one path without stale snapshot overwrite", () => {
        const {path, store: first} = fixture()
        const second = new OperatorJobStore(path)
        const initialRevision = first.revision
        const session = createSession(first)

        assert.equal(first.coordinationKey, second.coordinationKey)
        assert.equal(first.generation, second.generation)
        assert.match(first.generation, /^[0-9a-f-]{36}$/u)
        assert.deepEqual(second.getSession(session.id), session)
        assert.equal(first.revision, second.revision)
        assert.ok(first.revision > initialRevision)

        const job = createJob(second, session.id)
        assert.deepEqual(first.getJob(job.id), job)
        const page = first.readSummaryPage({limit: 1})
        assert.equal(
            second.readSummaryPage({cursor: page.nextCursor, limit: 1}).generation,
            first.generation,
        )
        first.close()
        assert.throws(() => first.listJobs(), /closed/iu)
        assert.equal(second.getJob(job.id).id, job.id)
        second.close()

        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.getJob(job.id).id, job.id)
        restarted.close()
    })

    it("persists immutable Steps before execution with unique per-Job idempotency", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const params = {datasetId: "dataset-1", nested: {page: 1}}

        const step = store.createStep(job.id, {
            id: "forged-step",
            method: "datasets.read",
            params,
            idempotencyKey: "read-dataset-1",
            status: "succeeded",
            createdAt: "2000-01-01T00:00:00.000Z",
        })
        params.nested.page = 999

        assert.notEqual(step.id, "forged-step")
        assert.equal(step.status, "pending")
        assert.equal(step.attempt, 0)
        assert.equal(step.createdAt, step.updatedAt)
        assert.equal(step.startedAt, null)
        assert.equal(step.completedAt, null)
        assert.match(step.inputDigest, /^[a-f0-9]{64}$/u)
        assert.deepEqual(store.getStep(step.id), step)
        assert.deepEqual(store.listSteps({jobId: job.id}), [step])
        assert.deepEqual(
            store.listEvents(job.id).find((event) => event.kind === "operator_step_created")?.request,
            {method: "datasets.read", params: {datasetId: "dataset-1", nested: {page: 1}}},
        )
        assert.throws(() => store.createStep(job.id, {
            method: "datasets.read",
            params: {datasetId: "dataset-2"},
            idempotencyKey: "read-dataset-1",
        }), /idempotency/iu)

        assert.throws(() => store.transitionStep(step.id, "succeeded"), /transition/iu)
        const running = store.transitionStep(step.id, "running")
        assert.equal(running.status, "running")
        assert.equal(running.attempt, 1)
        assert.ok(running.startedAt)
        assert.throws(
            () => store.transitionStep(step.id, "succeeded", {method: "skills.delete"}),
            /immutable|unsupported/iu,
        )

        const artifact = store.createArtifact(job.id, {
            kind: "step-result",
            name: "read-dataset-1.json",
            mediaType: "application/json",
            body: JSON.stringify({ok: true}),
        })
        const succeeded = store.transitionStep(step.id, "succeeded", {
            outputArtifactIds: [artifact.id],
        })
        assert.equal(succeeded.status, "succeeded")
        assert.deepEqual(succeeded.outputArtifactIds, [artifact.id])
        assert.ok(succeeded.completedAt)
        assert.throws(() => store.transitionStep(step.id, "running"), /terminal/iu)

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.getStep(step.id), succeeded)
        assert.deepEqual(restarted.listSteps({jobId: job.id}), [succeeded])
    })

    it("rejects a corrupted Step creation event or approval mutation on reload", () => {
        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            const step = store.createStep(job.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "read-dataset-1",
            })
            return {job, step}
        }, (registry) => {
            registry.events.find((event) => event.kind === "operator_step_created").payload.request.params.datasetId = "dataset-2"
        }, /Step.*creation|input.*digest|immutable/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            store.transitionJob(job.id, "running")
            const step = store.createStep(job.id, {
                method: "skills.release",
                params: {skillId: "skill-1", versionId: "candidate-1"},
                reservation: {},
                idempotencyKey: "release-1",
            })
            store.transitionStep(step.id, "waiting_approval")
            store.transitionJob(job.id, "waiting_approval")
            const approval = store.createApproval(job.id, {
                stepId: step.id,
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
                proposedMutation: {
                    method: "skills.release",
                    params: {skillId: "skill-1", versionId: "candidate-1"},
                    reservation: {},
                    idempotencyKey: "release-1",
                },
                risk: "release",
                expiresAt: "2099-01-01T00:00:00.000Z",
            })
            return {approval}
        }, (registry) => {
            registry.approvals[0].proposedMutation.params.versionId = "candidate-forged"
        }, /approval.*mutation|frozen.*Step/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            store.createStep(job.id, {
                method: "evaluations.start",
                params: {datasetId: "dataset-1", selectionMode: "selected", caseIds: ["case-1"]},
                requestedParams: {datasetId: "dataset-1", selectionMode: "dataset", caseIds: []},
                requestedReservation: {},
                trustedFacts: {evaluationSelection: {
                    datasetId: "dataset-1",
                    datasetRevision: "revision-1",
                    caseIds: ["case-1"],
                }},
                idempotencyKey: "frozen-dataset-selection",
            })
        }, (registry) => {
            const creation = registry.events.find((event) => event.kind === "operator_step_created")
            creation.payload.trustedFacts.evaluationSelection.caseIds = ["case-forged"]
        }, /Step.*creation|input.*digest|immutable/iu)
    })

    it("requires exactly one same-Job creation event for every Step", () => {
        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            const step = store.createStep(job.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "orphan-event",
            })
            return {job, step}
        }, (registry) => {
            const creation = registry.events[0]
            registry.events.push({
                ...creation,
                id: "orphan-creation-event",
                sequence: 2,
                payload: {...creation.payload, stepId: "orphan-step"},
            })
            registry.jobs[0].eventSequence = 2
        }, /orphan|creation.*Step|unknown.*Step/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const first = createJob(store, session.id, {objective: "first"})
            const second = createJob(store, session.id, {objective: "second"})
            store.createStep(first.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "cross-first",
            })
            store.createStep(second.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-2"},
                idempotencyKey: "cross-second",
            })
            return {first, second}
        }, (registry) => {
            const [firstEvent, secondEvent] = registry.events
            const firstJobId = firstEvent.jobId
            firstEvent.jobId = secondEvent.jobId
            secondEvent.jobId = firstJobId
        }, /creation.*Job|cross.*Job|Step.*Job/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            store.createStep(job.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "duplicate-event",
            })
            return {job}
        }, (registry) => {
            registry.events.push({...registry.events[0], id: "duplicate-creation", sequence: 2})
            registry.jobs[0].eventSequence = 2
        }, /duplicate.*creation|creation.*duplicate/iu)
    })

    it("rejects sparse Step requests and inconsistent success/error/output combinations", () => {
        const sparseFixture = fixture()
        const sparseSession = createSession(sparseFixture.store)
        const sparseJob = createJob(sparseFixture.store, sparseSession.id)
        const sparse = []
        sparse[1] = "case-2"
        assert.throws(() => sparseFixture.store.createStep(sparseJob.id, {
            method: "evaluations.start",
            params: {caseIds: sparse},
            idempotencyKey: "sparse-step",
        }), /sparse|dense/iu)

        const succeededSetup = (store) => {
            const session = createSession(store)
            const job = createJob(store, session.id)
            store.transitionJob(job.id, "running")
            const step = store.createStep(job.id, {
                method: "datasets.read",
                params: {datasetId: "dataset-1"},
                idempotencyKey: "successful-step",
            })
            store.transitionStep(step.id, "running")
            const artifact = store.createArtifact(job.id, {
                kind: "operator-step-result",
                name: "result.json",
                mediaType: "application/json",
                body: "{}",
            })
            store.transitionStep(step.id, "succeeded", {outputArtifactIds: [artifact.id]})
            return {job, step, artifact}
        }
        assertRegistryCorruptionRejected(succeededSetup, (registry) => {
            registry.steps[0].error = {code: "OPERATOR_INTERRUPTED"}
        }, /succeeded.*error|Step.*error.*status/iu)
        assertRegistryCorruptionRejected(succeededSetup, (registry) => {
            registry.steps[0].outputArtifactIds = []
        }, /succeeded.*artifact|Step.*output/iu)
        assertRegistryCorruptionRejected(succeededSetup, (registry) => {
            registry.steps[0].status = "running"
            registry.steps[0].completedAt = null
        }, /running.*artifact|Step.*output.*status/iu)
    })

    it("creates a private atomic registry and preserves immutable session and Job identity", () => {
        const {path, store} = fixture()
        const requestedRuntime = runtime()
        const requestedBudget = budget()
        const session = store.createSession({
            id: "forged-session",
            createdAt: "2000-01-01T00:00:00.000Z",
            runtime: requestedRuntime,
            modelId: "gpt-5.6-sol",
            effort: "high",
            protocol: "rolling-skill-operator/v1",
            capabilityId: "grant-1",
        })
        const job = store.createJob({
            id: "forged-job",
            createdAt: "2000-01-01T00:00:00.000Z",
            sessionId: session.id,
            type: "operator",
            objective: "评测 billing Skill",
            budget: requestedBudget,
        })

        assert.equal(store.read().schemaVersion, OPERATOR_JOB_STORE_SCHEMA)
        assert.deepEqual(Object.keys(store.read()).sort(), [
            "approvals",
            "artifacts",
            "dismissedRootJobIds",
            "events",
            "jobs",
            "schemaVersion",
            "sessions",
            "steps",
        ])
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(path).nlink, 1)
        assert.equal(statSync(dirname(path)).mode & 0o777, 0o700)
        assert.equal(
            readdirSync(dirname(path)).some((name) => name.includes(".tmp-")),
            false,
        )
        assert.notEqual(session.id, "forged-session")
        assert.notEqual(job.id, "forged-job")
        assert.notEqual(session.createdAt, "2000-01-01T00:00:00.000Z")
        assert.notEqual(job.createdAt, "2000-01-01T00:00:00.000Z")

        requestedRuntime.runtimeId = "mutated"
        requestedBudget.maxEvaluations = 999
        session.runtime.runtimeId = "returned-value-mutated"
        job.objective = "returned-value-mutated"
        assert.equal(store.getSession(session.id).runtime.runtimeId, "codex:operator")
        assert.equal(store.getJob(job.id).budget.maxEvaluations, 4)
        assert.equal(store.getJob(job.id).objective, "评测 billing Skill")
        assert.throws(
            () => store.transitionJob(job.id, "running", {id: "replacement"}),
            /immutable|unsupported/iu,
        )

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.getSession(session.id).createdAt, session.createdAt)
        assert.equal(restarted.getJob(job.id).createdAt, job.createdAt)
        assert.equal(JSON.parse(readFileSync(path, "utf8")).jobs.length, 1)
    })

    it("stores a positive iteration-only budget for new Operator jobs", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const created = store.createJob({
            sessionId: session.id,
            type: "operator-session",
            objective: "Run autonomously",
            budget: {maxIterations: 50},
        })

        assert.deepEqual(created.budget, {maxIterations: 50})
        store.close()
        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.getJob(created.id).budget, {maxIterations: 50})
    })

    it("stores an explicit unbounded budget without treating it as a legacy budget", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const created = store.createJob({
            sessionId: session.id,
            type: "operator-session",
            objective: "Run until the Agent finishes or the user stops",
            budget: {},
        })

        assert.deepEqual(created.budget, {})
        store.close()
        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.getJob(created.id).budget, {})
    })

    it("rejects malformed, unknown, and mixed iteration budgets", () => {
        const {store} = fixture()
        const session = createSession(store)
        for (const invalidBudget of [
            {maxIterations: 0},
            {maxIterations: 1.5},
            {maxIterations: 50, unknown: 1},
            {maxIterations: 50, ...budget()},
        ]) {
            assert.throws(() => store.createJob({
                sessionId: session.id,
                type: "operator-session",
                objective: "Reject an invalid budget",
                budget: invalidBudget,
            }), /budget|maxIterations|iteration/iu)
        }
    })

    it("enforces every legal Job transition and rejects invalid or post-terminal changes", () => {
        const {store} = fixture()
        const session = createSession(store)
        const transitions = new Map([
            ["queued", ["running", "cancelled", "failed"]],
            ["running", [
                "waiting_approval",
                "paused",
                "cancelling",
                "succeeded",
                "failed",
                "needs_recovery",
            ]],
            ["waiting_approval", ["running", "paused", "cancelling", "failed"]],
            ["paused", ["running", "cancelling"]],
            ["cancelling", ["cancelled", "needs_recovery"]],
            ["needs_recovery", ["running", "cancelled", "failed"]],
        ])

        for (const [from, targets] of transitions) {
            for (const to of targets) {
                const job = createJob(store, session.id, {objective: `${from} -> ${to}`})
                pathToStatus(store, job.id, from)
                assert.equal(store.transitionJob(job.id, to).status, to)
            }
        }

        const invalid = createJob(store, session.id)
        assert.throws(() => store.transitionJob(invalid.id, "cancelling"), /transition/iu)
        assert.throws(() => store.transitionJob(invalid.id, "succeeded"), /transition/iu)
        assert.throws(() => store.transitionJob(invalid.id, "queued"), /transition/iu)
        store.transitionJob(invalid.id, "cancelled")
        assert.throws(() => store.transitionJob(invalid.id, "running"), /terminal|transition/iu)
        assert.throws(
            () => store.appendEvent(invalid.id, {kind: "late_event"}),
            /terminal/iu,
        )

        const recovery = createJob(store, session.id)
        store.transitionJob(recovery.id, "running")
        store.transitionJob(recovery.id, "needs_recovery")
        assert.throws(() => store.transitionJob(recovery.id, "cancelling"), /transition/iu)
        assert.throws(() => createJob(store, session.id, {
            objective: "unsafe duration",
            budget: {...budget(), maxDurationMs: Number.MAX_SAFE_INTEGER + 1},
        }), /duration|budget|safe|integer/iu)
    })

    it("atomically marks a failed Runtime Job and its active Steps for recovery without widening transitions", () => {
        const {store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        const running = store.createStep(job.id, {
            method: "datasets.get",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "runtime-failure-running",
        })
        store.transitionStep(running.id, "running")
        const waiting = store.createStep(job.id, {
            method: "skills.release",
            params: {skillId: "skill-1"},
            reservation: {},
            idempotencyKey: "runtime-failure-waiting",
        })
        store.transitionStep(waiting.id, "waiting_approval")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            stepId: waiting.id,
            action: "skills.release",
            scope: {skillIds: ["skill-1"]},
            proposedMutation: {
                method: "skills.release",
                params: {skillId: "skill-1"},
                reservation: {},
                idempotencyKey: "runtime-failure-waiting",
            },
            risk: "release",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })

        const interrupted = store.interruptJob(job.id, {
            code: "OPERATOR_RUNTIME_FAILED",
            message: "Operator Runtime failed",
        })

        assert.equal(interrupted.status, "needs_recovery")
        assert.deepEqual(interrupted.error, {
            code: "OPERATOR_RUNTIME_FAILED",
            message: "Operator Runtime failed",
        })
        assert.equal(store.getStep(running.id).status, "needs_recovery")
        assert.equal(store.getStep(waiting.id).status, "needs_recovery")
        assert.equal(store.getApproval(approval.id).status, "rejected")
        assert.equal(store.listEvents(job.id).at(-1).kind, "recovery_required")
        assert.throws(() => store.transitionJob(interrupted.id, "cancelling"), /transition/iu)
    })

    it("reconstructs every Job, Step, and Approval changed by an atomic tree cancellation", () => {
        const {store} = fixture()
        const session = createSession(store)
        const parent = createJob(store, session.id, {objective: "parent"})
        store.transitionJob(parent.id, "running")
        const parentStep = store.createStep(parent.id, {
            method: "datasets.get",
            params: {datasetId: "dataset-1"},
            idempotencyKey: "parent-read",
        })
        store.transitionStep(parentStep.id, "running")
        const child = createJob(store, session.id, {
            parentJobId: parent.id,
            type: "release",
            objective: "child",
        })
        store.transitionJob(child.id, "running")
        const childStep = store.createStep(child.id, {
            method: "skills.release",
            params: {skillId: "skill-1"},
            reservation: {},
            idempotencyKey: "child-release",
        })
        store.transitionStep(childStep.id, "waiting_approval")
        store.transitionJob(child.id, "waiting_approval")
        const approval = store.createApproval(child.id, {
            stepId: childStep.id,
            action: "skills.release",
            scope: {skillIds: ["skill-1"]},
            proposedMutation: {
                method: "skills.release",
                params: {skillId: "skill-1"},
                reservation: {},
                idempotencyKey: "child-release",
            },
            risk: "release",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })

        const beforeCancellationRevision = store.revision
        store.beginCancellation(parent.id)
        store.cancelJobTree(parent.id)
        const recovered = collectSummaryPages(store, {limit: 1})
        const jobs = new Map(recovered.jobs.map((job) => [job.id, job]))
        const steps = new Map(recovered.steps.map((step) => [step.id, step]))
        const approvals = new Map(recovered.approvals.map((entry) => [entry.id, entry]))

        assert.equal(jobs.get(parent.id).status, "cancelled")
        assert.equal(jobs.get(child.id).status, "cancelled")
        assert.equal(steps.get(parentStep.id).status, "cancelled")
        assert.equal(steps.get(childStep.id).status, "cancelled")
        assert.equal(approvals.get(approval.id).status, "rejected")
        assert.equal(recovered.revision, beforeCancellationRevision + 2)
    })

    it("reconstructs a closed Approval after its waiting Job leaves the approval state", () => {
        const {store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        const step = store.createStep(job.id, {
            method: "skills.release",
            params: {skillId: "skill-1"},
            reservation: {},
            idempotencyKey: "pause-release",
        })
        store.transitionStep(step.id, "waiting_approval")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            stepId: step.id,
            action: "skills.release",
            scope: {skillIds: ["skill-1"]},
            proposedMutation: {
                method: "skills.release",
                params: {skillId: "skill-1"},
                reservation: {},
                idempotencyKey: "pause-release",
            },
            risk: "release",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        })

        store.transitionJob(job.id, "paused")
        const recovered = collectSummaryPages(store, {limit: 1})
        const restored = recovered.approvals.find((entry) => entry.id === approval.id)
        assert.equal(restored.status, "rejected")
        assert.equal(restored.decision, "reject")
        assert.equal(restored.decisionScope, "job_transition")
        assert.equal(typeof restored.resolvedAt, "string")
    })

    it("links parent and child Jobs and assigns immutable per-Job event sequences", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const parent = createJob(store, session.id)
        store.transitionJob(parent.id, "running")
        const child = createJob(store, session.id, {
            parentJobId: parent.id,
            type: "evaluation",
            objective: "run dataset",
        })
        const first = store.appendEvent(parent.id, {
            kind: "child_created",
            childJobId: child.id,
        })
        const second = store.appendEvent(parent.id, {
            kind: "child_status",
            childJobId: child.id,
            status: "queued",
        })

        assert.deepEqual(store.getJob(parent.id).children, [child.id])
        assert.equal(store.getJob(child.id).parentJobId, parent.id)
        assert.deepEqual([first.sequence, second.sequence], [1, 2])
        assert.deepEqual(
            store.listEvents(parent.id).map((event) => event.sequence),
            [1, 2],
        )
        first.sequence = 99
        assert.equal(store.listEvents(parent.id)[0].sequence, 1)

        const otherSession = createSession(store, {capabilityId: "grant-2"})
        assert.throws(
            () => createJob(store, otherSession.id, {parentJobId: parent.id}),
            /parent.*session|same session/iu,
        )

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.listEvents(parent.id).at(-1).kind, "recovery_required")
        assert.equal(
            restarted.appendEvent(parent.id, {kind: "resumed_observation"}).sequence,
            4,
        )
    })

    it("bounds event envelopes and rejects an eleventh-thousandth Job event", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)

        assert.throws(
            () => store.appendEvent(job.id, {
                kind: "diagnostic",
                detail: "x".repeat(256 * 1024),
            }),
            /event.*256|event.*large/iu,
        )

        const persisted = JSON.parse(readFileSync(path, "utf8"))
        const occurredAt = "2026-08-23T00:00:00.000Z"
        persisted.events = Array.from({length: 10_000}, (_unused, index) => ({
            id: `event-${index + 1}`,
            jobId: job.id,
            sequence: index + 1,
            kind: "tick",
            payload: {},
            occurredAt,
        }))
        persisted.jobs[0].eventSequence = 10_000
        store.close()
        writeFileSync(path, `${JSON.stringify(persisted)}\n`, {mode: 0o600})

        const atLimit = new OperatorJobStore(path)
        assert.equal(atLimit.listEvents(job.id).length, 10_000)
        assert.throws(
            () => atLimit.appendEvent(job.id, {kind: "overflow"}),
            /10,?000|event limit/iu,
        )
    })

    it("stores 128 KiB artifacts inline and larger bodies in private digest-addressed files", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const inlineBody = "a".repeat(128 * 1024)
        const inline = store.createArtifact(job.id, {
            kind: "report",
            name: "inline report",
            mediaType: "text/plain; charset=utf-8",
            body: inlineBody,
            metadata: {source: "operator"},
        })

        assert.equal(inline.path, null)
        assert.equal(inline.inline.encoding, "utf8")
        assert.equal(inline.inline.body, inlineBody)
        assert.equal(inline.byteLength, Buffer.byteLength(inlineBody))
        assert.equal(
            inline.sha256,
            createHash("sha256").update(inlineBody).digest("hex"),
        )

        const externalBody = Buffer.alloc(128 * 1024 + 1, 0x62)
        const external = store.createArtifact(job.id, {
            kind: "trace",
            name: "full trace",
            mediaType: "application/octet-stream",
            body: externalBody,
        })
        assert.equal(external.inline, null)
        assert.ok(external.path.startsWith(dirname(store.path)))
        assert.equal(statSync(external.path).nlink, 1)
        assert.equal(statSync(external.path).mode & 0o777, 0o600)
        assert.equal(statSync(dirname(external.path)).mode & 0o777, 0o700)
        assert.equal(external.byteLength, externalBody.byteLength)
        assert.equal(
            external.sha256,
            createHash("sha256").update(externalBody).digest("hex"),
        )
        assert.deepEqual(store.readArtifactBody(external.id), externalBody)
        assert.deepEqual(store.getJob(job.id).artifactIds, [inline.id, external.id])

        assert.throws(
            () => store.createArtifact(job.id, {
                kind: "report",
                name: "oversized envelope",
                mediaType: "text/plain",
                body: "small",
                metadata: {detail: "x".repeat(256 * 1024)},
            }),
            /artifact.*256|artifact.*large/iu,
        )

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.readArtifactBody(inline.id), Buffer.from(inlineBody))
        assert.deepEqual(restarted.readArtifactBody(external.id), externalBody)
    })

    it("rejects oversized artifact inputs before copying strings or typed bytes", () => {
        const {store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const inputs = [
            "x".repeat(MAX_ARTIFACT_BYTES + 1),
            Buffer.allocUnsafe(MAX_ARTIFACT_BYTES + 1),
        ]
        for (const body of inputs) {
            const originalFrom = Buffer.from
            let copied = false
            let failure = null
            Buffer.from = function (value, ...rest) {
                if (value === body) {
                    copied = true
                    throw new Error("oversized body was copied")
                }
                return originalFrom.call(Buffer, value, ...rest)
            }
            try {
                store.createArtifact(job.id, {
                    kind: "trace",
                    name: "oversized",
                    mediaType: "application/octet-stream",
                    body,
                })
            } catch (error) {
                failure = error
            } finally {
                Buffer.from = originalFrom
            }
            assert.equal(copied, false)
            assert.match(failure?.message ?? "", /artifact.*64|artifact.*byte limit/iu)
        }
    })

    it("persists approval decisions and an ordered independent session transcript", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            action: "skills.release",
            scope: {skillIds: ["skill-1"], versionIds: ["candidate-1"]},
            proposedMutation: {
                method: "skills.release",
                params: {versionId: "candidate-1", versionLabel: "v1.1.0"},
            },
            risk: "Publishes an immutable Released version.",
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString(),
        })
        const first = store.appendSessionTranscript(session.id, {
            kind: "message",
            role: "user",
            text: "优化 billing Skill",
        })
        const second = store.appendSessionTranscript(session.id, {
            kind: "activity",
            activity: "evaluation_started",
            jobId: job.id,
        })
        const resolved = store.resolveApproval(approval.id, {
            decision: "approve",
            scope: "action",
            decidedBy: "local-user",
        })

        assert.deepEqual([first.sequence, second.sequence], [1, 2])
        assert.equal(resolved.status, "approved")
        assert.equal(resolved.decision, "approve")
        assert.equal(resolved.decisionScope, "action")
        assert.equal(resolved.expiresAt, approval.expiresAt)
        assert.deepEqual(store.getJob(job.id).approvalIds, [approval.id])
        assert.deepEqual(
            store.getSession(session.id).transcript.map((entry) => entry.kind),
            ["message", "activity"],
        )

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.getApproval(approval.id).status, "approved")
        assert.equal(restarted.getSession(session.id).transcriptSequence, 2)
        assert.throws(
            () => restarted.resolveApproval(approval.id, {decision: "reject", scope: "action"}),
            /resolved|pending/iu,
        )
    })

    it("recovers only active Jobs and preserves terminal snapshots across restarts", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const running = createJob(store, session.id, {objective: "running"})
        const cancelling = createJob(store, session.id, {objective: "cancelling"})
        const waiting = createJob(store, session.id, {objective: "waiting"})
        const paused = createJob(store, session.id, {objective: "paused"})
        const terminal = createJob(store, session.id, {objective: "terminal"})
        pathToStatus(store, running.id, "running")
        pathToStatus(store, cancelling.id, "cancelling")
        pathToStatus(store, waiting.id, "waiting_approval")
        pathToStatus(store, paused.id, "paused")
        store.transitionJob(terminal.id, "running")
        store.appendEvent(terminal.id, {kind: "result_ready"})
        const completed = store.transitionJob(terminal.id, "succeeded", {
            checkpoint: {phase: "complete"},
            result: {summary: "billing evaluation complete"},
        })
        const terminalSnapshot = completed.terminalSnapshot

        assert.equal(terminalSnapshot.status, "succeeded")
        assert.equal(terminalSnapshot.eventSequence, 1)
        assert.equal(terminalSnapshot.result.summary, "billing evaluation complete")
        assert.throws(
            () => store.createJob({
                sessionId: session.id,
                parentJobId: terminal.id,
                type: "evaluation",
                objective: "late child",
                budget: budget(),
            }),
            /terminal/iu,
        )

        store.close()
        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.getJob(running.id).status, "needs_recovery")
        assert.equal(restarted.getJob(cancelling.id).status, "needs_recovery")
        assert.equal(restarted.getJob(waiting.id).status, "waiting_approval")
        assert.equal(restarted.getJob(paused.id).status, "paused")
        assert.deepEqual(restarted.getJob(terminal.id).terminalSnapshot, terminalSnapshot)
        assert.equal(
            restarted.listEvents(running.id).at(-1).kind,
            "recovery_required",
        )

        restarted.close()
        const restartedAgain = new OperatorJobStore(path)
        assert.equal(restartedAgain.getJob(running.id).status, "needs_recovery")
        assert.equal(restartedAgain.listEvents(running.id).length, 1)
        assert.deepEqual(restartedAgain.getTerminalSnapshot(terminal.id), terminalSnapshot)
    })

    it("persists an external artifact as its derived relative name", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const artifact = store.createArtifact(job.id, {
            kind: "trace",
            name: "trace",
            mediaType: "application/octet-stream",
            body: Buffer.alloc(128 * 1024 + 1, 0x61),
        })
        const persisted = JSON.parse(readFileSync(path, "utf8")).artifacts[0]

        assert.equal(isAbsolute(persisted.path), false)
        assert.equal(persisted.path, `${artifact.id}-${artifact.sha256}.artifact`)
    })

    it("rejects symlinked external artifacts without changing their targets", () => {
        const {root, path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const body = Buffer.alloc(128 * 1024 + 1, 0x62)
        const artifact = store.createArtifact(job.id, {
            kind: "trace",
            name: "trace",
            mediaType: "application/octet-stream",
            body,
        })
        const outside = join(root, "outside.bin")
        writeFileSync(outside, body, {mode: 0o644})
        chmodSync(outside, 0o644)
        unlinkSync(artifact.path)
        symlinkSync(outside, artifact.path)

        assert.throws(() => store.readArtifactBody(artifact.id), /symbolic|regular|nofollow/iu)
        store.close()
        let loadError = null
        try {
            new OperatorJobStore(path)
        } catch (error) {
            loadError = error
        }
        assert.equal(statSync(outside).mode & 0o777, 0o644)
        assert.match(loadError?.message ?? "", /artifact|symbolic|regular|nofollow/iu)
    })

    it("rejects a hard-linked external artifact through reads and reload", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const artifact = store.createArtifact(job.id, {
            kind: "trace",
            name: "trace",
            mediaType: "application/octet-stream",
            body: Buffer.alloc(128 * 1024 + 1, 0x64),
        })
        const aliasDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-artifact-link-"))
        temporaryDirectories.push(aliasDirectory)
        const aliasPath = join(aliasDirectory, "artifact.alias")
        linkSync(artifact.path, aliasPath)

        assert.equal(statSync(artifact.path).nlink, 2)
        assert.throws(() => store.readArtifactBody(artifact.id), /hard.?link|single link|link count|nlink/iu)
        store.close()
        assert.throws(() => new OperatorJobStore(path), /hard.?link|single link|link count|nlink/iu)
    })

    it("rejects oversized external artifacts from metadata before reading their bodies", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        const artifact = store.createArtifact(job.id, {
            kind: "trace",
            name: "trace",
            mediaType: "application/octet-stream",
            body: Buffer.alloc(128 * 1024 + 1),
        })
        truncateSync(artifact.path, 64 * 1024 * 1024 + 1)

        store.close()
        assert.throws(() => new OperatorJobStore(path), /artifact.*64|artifact.*byte limit/iu)
    })

    it("rejects unknown persisted fields and does not expose mutable state", () => {
        const {path, store} = fixture()
        assert.equal(store.state, undefined)
        store.close()
        rewriteRegistry(path, (registry) => {
            registry.unexpected = true
        })
        assert.throws(() => new OperatorJobStore(path), /unknown|unexpected|schema/iu)
    })

    it("strictly validates Steps, timestamps, references, snapshots, inline bodies, and approvals", () => {
        const basic = (store) => {
            const session = createSession(store)
            return {session, job: createJob(store, session.id)}
        }
        assertRegistryCorruptionRejected(basic, (registry) => {
            registry.steps.push({})
        }, /step/iu)
        assertRegistryCorruptionRejected(basic, (registry) => {
            registry.sessions[0].closedAt = "not-a-timestamp"
        }, /closedAt|timestamp/iu)
        assertRegistryCorruptionRejected((store) => {
            const context = basic(store)
            store.createArtifact(context.job.id, {
                kind: "report",
                name: "inline",
                mediaType: "text/plain",
                body: "trusted",
            })
            return context
        }, (registry) => {
            registry.jobs[0].artifactIds.push(registry.jobs[0].artifactIds[0])
        }, /artifact.*reference|duplicate/iu)
        assertRegistryCorruptionRejected((store) => {
            const context = basic(store)
            store.transitionJob(context.job.id, "running")
            store.transitionJob(context.job.id, "succeeded", {result: {ok: true}})
            return context
        }, (registry) => {
            registry.jobs[0].terminalSnapshot.result.ok = false
        }, /terminal.*snapshot/iu)
        assertRegistryCorruptionRejected((store) => {
            const context = basic(store)
            store.createArtifact(context.job.id, {
                kind: "report",
                name: "inline",
                mediaType: "text/plain",
                body: "trusted",
            })
            return context
        }, (registry) => {
            registry.artifacts[0].inline.body = "tampered"
        }, /artifact.*integrity|artifact.*digest|inline/iu)
        assertRegistryCorruptionRejected((store) => {
            const context = basic(store)
            store.transitionJob(context.job.id, "running")
            store.transitionJob(context.job.id, "waiting_approval")
            store.createApproval(context.job.id, {
                action: "skills.release",
                scope: {skillIds: ["skill-1"]},
                proposedMutation: {method: "skills.release", params: {}},
                risk: "release",
                expiresAt: "2099-01-01T00:00:00.000Z",
            })
            return context
        }, (registry) => {
            registry.approvals[0].status = "approved"
        }, /approval.*decision|approval.*status/iu)
    })

    it("rejects duplicate transcript identities and per-Job Step idempotency keys", () => {
        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            store.appendSessionTranscript(session.id, {kind: "message", text: "first"})
            store.appendSessionTranscript(session.id, {kind: "message", text: "second"})
            return {session}
        }, (registry) => {
            registry.sessions[0].transcript[1].id = registry.sessions[0].transcript[0].id
        }, /transcript.*duplicate|duplicate.*transcript/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            return {session, job: createJob(store, session.id)}
        }, (registry, {session, job}) => {
            const createdAt = registry.jobs[0].createdAt
            const base = {
                jobId: job.id,
                sessionId: session.id,
                method: "evaluations.start",
                idempotencyKey: "same-action",
                status: "pending",
                inputDigest: "a".repeat(64),
                outputArtifactIds: [],
                attempt: 0,
                error: null,
                createdAt,
                updatedAt: createdAt,
                startedAt: null,
                completedAt: null,
            }
            registry.steps.push(
                {id: "step-1", ...base},
                {id: "step-2", ...base},
            )
        }, /idempotency/iu)
    })

    it("rejects self-referential and multi-Job parent cycles", () => {
        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            return {job: createJob(store, session.id)}
        }, (registry, {job}) => {
            registry.jobs[0].parentJobId = job.id
            registry.jobs[0].children = [job.id]
        }, /parent.*cycle|Job.*cycle/iu)

        assertRegistryCorruptionRejected((store) => {
            const session = createSession(store)
            return {
                first: createJob(store, session.id, {objective: "first"}),
                second: createJob(store, session.id, {objective: "second"}),
            }
        }, (registry, {first, second}) => {
            const firstRecord = registry.jobs.find((job) => job.id === first.id)
            const secondRecord = registry.jobs.find((job) => job.id === second.id)
            firstRecord.parentJobId = second.id
            firstRecord.children = [second.id]
            secondRecord.parentJobId = first.id
            secondRecord.children = [first.id]
        }, /parent.*cycle|Job.*cycle/iu)
    })

    it("loads a valid 15,000-Job parent chain without recursive stack growth", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        createJob(store, session.id)
        const registry = JSON.parse(readFileSync(path, "utf8"))
        const template = registry.jobs[0]
        registry.jobs = Array.from({length: 15_000}, (_unused, index) => {
            const id = `deep-${String(index).padStart(5, "0")}`
            return {
                ...template,
                id,
                parentJobId: index === 0
                    ? null
                    : `deep-${String(index - 1).padStart(5, "0")}`,
                children: index === 14_999
                    ? []
                    : [`deep-${String(index + 1).padStart(5, "0")}`],
            }
        })
        store.close()
        writeFileSync(path, `${JSON.stringify(registry)}\n`)

        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.listJobs({sessionId: session.id}).length, 15_000)
        assert.equal(restarted.getJob("deep-14999").parentJobId, "deep-14998")
    })

    it("migrates a registry generated by d1f98c without losing user payload fields", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-operator-d1-"))
        temporaryDirectories.push(root)
        const repository = resolve(__dirname, "..", "..", "..")
        const legacySource = spawnSync("git", [
            "show",
            "d1f98c132a7afd494b266f7febece43c6a02e87e:desktop/rolling-skill/src/operator/job-store.cjs",
        ], {cwd: repository, encoding: "utf8"})
        assert.equal(legacySource.status, 0, legacySource.stderr)
        const legacyModulePath = join(root, "legacy-job-store.cjs")
        writeFileSync(legacyModulePath, legacySource.stdout)
        const {OperatorJobStore: LegacyOperatorJobStore} = require(legacyModulePath)
        const path = join(root, "private", "operator-jobs.json")
        const legacy = new LegacyOperatorJobStore(path)
        const session = createSession(legacy)
        const job = createJob(legacy, session.id)
        legacy.transitionJob(job.id, "running")
        legacy.appendSessionTranscript(session.id, {
            kind: "message",
            payload: {channel: "user-authored"},
            role: "user",
            text: "legacy transcript",
        })
        legacy.appendEvent(job.id, {
            kind: "observation",
            payload: {channel: "user-authored"},
            detail: "legacy event",
        })
        const artifact = legacy.createArtifact(job.id, {
            kind: "trace",
            name: "legacy artifact",
            mediaType: "application/octet-stream",
            body: Buffer.alloc(128 * 1024 + 1, 0x63),
        })

        const migrated = new OperatorJobStore(path)
        const transcript = migrated.getSession(session.id).transcript[0]
        const event = migrated.listEvents(job.id)[0]
        assert.equal(transcript.text, "legacy transcript")
        assert.deepEqual(transcript.payload, {channel: "user-authored"})
        assert.equal(event.detail, "legacy event")
        assert.deepEqual(event.payload, {channel: "user-authored"})
        assert.equal(migrated.getArtifact(artifact.id).path, realpathSync(artifact.path))
        const persisted = JSON.parse(readFileSync(path, "utf8"))
        assert.equal(persisted.schemaVersion, OPERATOR_JOB_STORE_SCHEMA)
        assert.deepEqual(persisted.dismissedRootJobIds, [])
        assert.deepEqual(persisted.sessions[0].transcript[0].payload, {
            payload: {channel: "user-authored"},
            role: "user",
            text: "legacy transcript",
        })
        assert.deepEqual(persisted.events[0].payload, {
            payload: {channel: "user-authored"},
            detail: "legacy event",
        })
        assert.equal(persisted.artifacts[0].path, `${artifact.id}-${artifact.sha256}.artifact`)
    })

    it("rejects corrupted canonical envelopes without reinterpreting them as legacy", () => {
        const eventFixture = fixture()
        const eventSession = createSession(eventFixture.store)
        const eventJob = createJob(eventFixture.store, eventSession.id)
        eventFixture.store.appendEvent(eventJob.id, {kind: "observation", detail: "trusted"})
        eventFixture.store.close()
        rewriteRegistry(eventFixture.path, (registry) => {
            registry.events[0].payload = null
            registry.events[0].unexpected = true
        })
        assert.throws(
            () => new OperatorJobStore(eventFixture.path),
            /event.*unknown|event.*payload|plain object/iu,
        )

        const transcriptFixture = fixture()
        const transcriptSession = createSession(transcriptFixture.store)
        transcriptFixture.store.appendSessionTranscript(transcriptSession.id, {
            kind: "message",
            text: "trusted",
        })
        transcriptFixture.store.close()
        rewriteRegistry(transcriptFixture.path, (registry) => {
            registry.sessions[0].transcript[0].unexpected = true
        })
        assert.throws(
            () => new OperatorJobStore(transcriptFixture.path),
            /transcript.*unknown|transcript.*fields/iu,
        )
    })

    it("projects read state through the same public shapes as get and list", () => {
        const {store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        store.appendSessionTranscript(session.id, {kind: "message", text: "public"})
        store.appendEvent(job.id, {kind: "observation", detail: "public"})
        const artifact = store.createArtifact(job.id, {
            kind: "trace",
            name: "public",
            mediaType: "application/octet-stream",
            body: Buffer.alloc(128 * 1024 + 1, 0x64),
        })

        const state = store.read()
        assert.deepEqual(state.sessions[0], store.getSession(session.id))
        assert.deepEqual(state.events, store.listEvents(job.id))
        assert.deepEqual(state.artifacts[0], store.getArtifact(artifact.id))
        assert.equal(state.events[0].detail, "public")
        assert.equal(state.artifacts[0].path, artifact.path)
    })

    it("atomically closes pending approvals when their Job becomes terminal", () => {
        const {store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        store.transitionJob(job.id, "waiting_approval")
        const approval = store.createApproval(job.id, {
            action: "skills.release",
            scope: {skillIds: ["skill-1"]},
            proposedMutation: {method: "skills.release", params: {}},
            risk: "release",
            expiresAt: "2099-01-01T00:00:00.000Z",
        })

        store.transitionJob(job.id, "failed", {error: {code: "STOPPED"}})
        const closed = store.getApproval(approval.id)
        assert.equal(closed.status, "rejected")
        assert.equal(closed.decision, "reject")
        assert.equal(closed.decisionScope, "job_terminal")
        assert.ok(closed.resolvedAt)
    })

    it("allows rejecting an expired approval but never approving it", () => {
        const expiredFixture = fixture()
        const expiredSession = createSession(expiredFixture.store)
        const expiredJob = createJob(expiredFixture.store, expiredSession.id)
        expiredFixture.store.transitionJob(expiredJob.id, "running")
        expiredFixture.store.transitionJob(expiredJob.id, "waiting_approval")
        const expired = expiredFixture.store.createApproval(expiredJob.id, {
            action: "skills.release",
            scope: {},
            proposedMutation: {},
            risk: "release",
            expiresAt: "2000-01-01T00:00:00.000Z",
        })
        assert.throws(
            () => expiredFixture.store.resolveApproval(expired.id, {
                decision: "approve",
                scope: "action",
            }),
            /expired/iu,
        )
        const rejected = expiredFixture.store.resolveApproval(expired.id, {
            decision: "reject",
            scope: "action",
        })
        assert.equal(rejected.status, "rejected")
        assert.equal(rejected.decision, "reject")
    })

    it("atomically rejects every pending approval when leaving waiting_approval", () => {
        for (const target of ["running", "paused", "cancelling", "failed"]) {
            const {store} = fixture()
            const session = createSession(store)
            const job = createJob(store, session.id)
            store.transitionJob(job.id, "running")
            store.transitionJob(job.id, "waiting_approval")
            const approvals = ["first", "second"].map((action) => store.createApproval(job.id, {
                action,
                scope: {},
                proposedMutation: {},
                risk: action,
                expiresAt: target === "paused" || target === "cancelling"
                    ? "2000-01-01T00:00:00.000Z"
                    : "2099-01-01T00:00:00.000Z",
            }))

            assert.equal(store.transitionJob(job.id, target).status, target)
            for (const approval of approvals) {
                const closed = store.getApproval(approval.id)
                assert.equal(closed.status, "rejected", target)
                assert.equal(closed.decision, "reject", target)
                assert.equal(
                    closed.decisionScope,
                    target === "failed" ? "job_terminal" : "job_transition",
                    target,
                )
                assert.ok(closed.resolvedAt)
            }
        }
    })

    it("rejects a persisted terminal Job with a forged pending approval", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.transitionJob(job.id, "running")
        store.transitionJob(job.id, "waiting_approval")
        store.createApproval(job.id, {
            action: "skills.release",
            scope: {},
            proposedMutation: {},
            risk: "release",
            expiresAt: "2099-01-01T00:00:00.000Z",
        })
        store.transitionJob(job.id, "failed", {error: {code: "STOPPED"}})
        store.close()
        rewriteRegistry(path, (registry) => {
            Object.assign(registry.approvals[0], {
                status: "pending",
                decision: null,
                decisionScope: null,
                decidedBy: null,
                resolvedAt: null,
            })
        })

        assert.throws(
            () => new OperatorJobStore(path),
            /pending.*waiting_approval|approval.*Job status/iu,
        )
    })

    it("accepts pending approval only while its Job is waiting_approval", () => {
        const createPending = () => {
            const context = fixture()
            const session = createSession(context.store)
            const job = createJob(context.store, session.id)
            context.store.transitionJob(job.id, "running")
            context.store.transitionJob(job.id, "waiting_approval")
            context.store.createApproval(job.id, {
                action: "skills.release",
                scope: {},
                proposedMutation: {},
                risk: "release",
                expiresAt: "2099-01-01T00:00:00.000Z",
            })
            return {...context, job}
        }
        const valid = createPending()
        valid.store.close()
        assert.equal(new OperatorJobStore(valid.path).getJob(valid.job.id).status, "waiting_approval")

        for (const status of ["queued", "running", "paused", "needs_recovery", "cancelling"]) {
            const {path, store} = createPending()
            store.close()
            rewriteRegistry(path, (registry) => {
                registry.jobs[0].status = status
                if (status === "queued") registry.jobs[0].startedAt = null
            })
            assert.throws(
                () => new OperatorJobStore(path),
                /pending.*waiting_approval|approval.*Job status/iu,
                status,
            )
        }
    })

    it("rejects a symlinked registry instead of following it", () => {
        const sourceFixture = fixture()
        const linkFixture = fixture()
        linkFixture.store.close()
        rmSync(linkFixture.path, {force: true})
        symlinkSync(sourceFixture.path, linkFixture.path)

        assert.throws(() => new OperatorJobStore(linkFixture.path), /symbolic|regular|nofollow/iu)
    })

    it("rejects either name for a registry hard-linked across owner-only directories", () => {
        const {path, store} = fixture()
        const session = createSession(store)
        const job = createJob(store, session.id)
        store.close()
        const aliasRoot = mkdtempSync(join(tmpdir(), "rolling-skill-registry-link-"))
        temporaryDirectories.push(aliasRoot)
        const aliasDirectory = join(aliasRoot, "private")
        mkdirSync(aliasDirectory, {mode: 0o700})
        const aliasPath = join(aliasDirectory, "operator-jobs.json")
        linkSync(path, aliasPath)

        assert.equal(statSync(path).nlink, 2)
        assert.equal(statSync(aliasPath).nlink, 2)
        assert.throws(() => new OperatorJobStore(path), /hard.?link|single link|link count|nlink/iu)
        assert.throws(() => new OperatorJobStore(aliasPath), /hard.?link|single link|link count|nlink/iu)

        unlinkSync(aliasPath)
        const recovered = new OperatorJobStore(path)
        assert.equal(recovered.getJob(job.id).id, job.id)
        assert.equal(statSync(path).nlink, 1)
    })

    it("fsyncs the registry directory and cannot fail after the atomic rename", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-operator-atomic-"))
        temporaryDirectories.push(root)
        const path = join(root, "private", "operator-jobs.json")
        const modulePath = join(__dirname, "..", "src", "operator", "job-store.cjs")
        const script = `
            const Module = require("node:module")
            const fs = require("node:fs")
            let directoryFsyncs = 0
            const originalLoad = Module._load
            Module._load = function (request) {
                if (request !== "node:fs") return originalLoad.apply(this, arguments)
                return {
                    ...fs,
                    chmodSync(path, mode) {
                        if (require("node:path").resolve(path) === ${JSON.stringify(path)}) {
                            throw new Error("post-rename chmod must not run")
                        }
                        return fs.chmodSync(path, mode)
                    },
                    fsyncSync(descriptor) {
                        if (fs.fstatSync(descriptor).isDirectory()) {
                            directoryFsyncs += 1
                            throw new Error("directory fsync unavailable after rename")
                        }
                        return fs.fsyncSync(descriptor)
                    },
                }
            }
            const {OperatorJobStore} = require(${JSON.stringify(modulePath)})
            new OperatorJobStore(${JSON.stringify(path)})
            process.stdout.write(String(directoryFsyncs))
        `
        const result = spawnSync(process.execPath, ["-e", script], {encoding: "utf8"})

        assert.equal(result.status, 0, result.stderr)
        assert.ok(Number(result.stdout) >= 1, "the parent directory must be fsynced")
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(path).nlink, 1)
    })
})
