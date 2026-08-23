const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {dirname, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
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

describe("Operator Job store", () => {
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
            "events",
            "jobs",
            "schemaVersion",
            "sessions",
            "steps",
        ])
        assert.equal(statSync(path).mode & 0o777, 0o600)
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

        const restarted = new OperatorJobStore(path)
        assert.equal(restarted.getSession(session.id).createdAt, session.createdAt)
        assert.equal(restarted.getJob(job.id).createdAt, job.createdAt)
        assert.equal(JSON.parse(readFileSync(path, "utf8")).jobs.length, 1)
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
        assert.throws(() => store.transitionJob(invalid.id, "succeeded"), /transition/iu)
        assert.throws(() => store.transitionJob(invalid.id, "queued"), /transition/iu)
        store.transitionJob(invalid.id, "cancelled")
        assert.throws(() => store.transitionJob(invalid.id, "running"), /terminal|transition/iu)
        assert.throws(
            () => store.appendEvent(invalid.id, {kind: "late_event"}),
            /terminal/iu,
        )
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
            occurredAt,
        }))
        persisted.jobs[0].eventSequence = 10_000
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
        assert.ok(external.path.startsWith(dirname(path)))
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

        const restarted = new OperatorJobStore(path)
        assert.deepEqual(restarted.readArtifactBody(inline.id), Buffer.from(inlineBody))
        assert.deepEqual(restarted.readArtifactBody(external.id), externalBody)
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
            expiresAt: "2026-08-24T00:00:00.000Z",
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

        const restartedAgain = new OperatorJobStore(path)
        assert.equal(restartedAgain.getJob(running.id).status, "needs_recovery")
        assert.equal(restartedAgain.listEvents(running.id).length, 1)
        assert.deepEqual(restartedAgain.getTerminalSnapshot(terminal.id), terminalSnapshot)
    })
})
