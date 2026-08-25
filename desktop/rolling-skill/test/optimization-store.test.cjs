"use strict"

const assert = require("node:assert/strict")
const {spawnSync} = require("node:child_process")
const {createHash} = require("node:crypto")
const {
    chmodSync,
    linkSync,
    lstatSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {freezeOptimizationRun} = require("../src/optimization/optimization-contract.cjs")
const {
    OPTIMIZATION_STORE_SCHEMA,
    OptimizationStore,
} = require("../src/optimization/optimization-store.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function digest(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function frozenRun(configOverrides = {}) {
    const evidenceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-store-evidence-"))
    temporaryDirectories.push(evidenceDirectory)
    const evidencePath = join(evidenceDirectory, "SKILL.md")
    writeFileSync(evidencePath, "# Billing\n\nUse the billing workflow.\n")
    const skillEvidence = snapshotSkillEvidence({name: "billing-cost-management", path: evidencePath})
    return freezeOptimizationRun({
        baseline: {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            state: "released",
            commit: "a".repeat(40),
            skillRoot: "skills/billing-cost-management",
            contentDigest: digest("baseline"),
        },
        dataset: {
            id: "dataset-1",
            revision: 1,
            caseRevisions: [{
                caseId: "case-1",
                revision: 1,
                rubricVersionId: "rubric-1",
                calibrationStatus: "current",
            }],
            digest: digest("dataset"),
            skillId: "skill-1",
            repositoryId: "repository-1",
        },
        rubric: {
            id: "rubric-1",
            version: 1,
            scoringModel: "unified-100/v1",
            digest: digest("rubric"),
            datasetId: "dataset-1",
            publishedAt: "2026-08-25T01:02:03.000Z",
        },
        skillEvidence,
        config: {
            skillId: "skill-1",
            baselineVersionId: "version-1",
            datasetId: "dataset-1",
            operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
            targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "high"}],
            judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "xhigh"},
            activationMode: "automatic",
            mode: "adaptive",
            limits: {
                maxEpochs: 3,
                maxDurationMs: 3_600_000,
                patience: 2,
                minimumImprovement: 0.5,
                maxTurns: 50,
                maxTokens: null,
                maxCostMicros: null,
            },
            target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
            telemetry: {tokens: false, cost: false},
            ...configOverrides,
        },
        createdAt: "2026-08-25T02:03:04.000Z",
    })
}

function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-store-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "optimization-runs.json")
    return {directory, path, store: new OptimizationStore(path)}
}

describe("OptimizationStore", () => {
    it("rejects a second process while the live owner keeps active state unchanged", () => {
        const {path, store} = fixture()
        const created = store.createRun(frozenRun())
        store.transitionRun(created.runId, "baseline", {checkpoint: {lease: "active-owner"}})
        const modulePath = require.resolve("../src/optimization/optimization-store.cjs")
        const child = spawnSync(process.execPath, ["-e", `
            const {OptimizationStore} = require(process.argv[1])
            try {
                const store = new OptimizationStore(process.argv[2])
                process.stdout.write("opened:" + store.getRun(process.argv[3]).state)
                store.close()
            } catch (error) {
                process.stdout.write("rejected:" + error.message)
            }
        `, modulePath, path, created.runId], {encoding: "utf8"})

        assert.equal(child.status, 0)
        assert.match(child.stdout, /^rejected:.*(?:own(?:er|ed)|lock)/i)
        assert.equal(JSON.parse(readFileSync(path, "utf8")).runs[0].state, "baseline")
        assert.equal(store.getRun(created.runId).checkpoint.lease, "active-owner")
    })

    it("recovers a dead child owner and persists generation/revision for stale CAS rejection", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-owner-death-"))
        temporaryDirectories.push(directory)
        const path = join(directory, "optimization-runs.json")
        const snapshotPath = join(directory, "snapshot.json")
        writeFileSync(snapshotPath, JSON.stringify(frozenRun()), {mode: 0o600})
        const modulePath = require.resolve("../src/optimization/optimization-store.cjs")
        const child = spawnSync(process.execPath, ["-e", `
            const {readFileSync} = require("node:fs")
            const {OptimizationStore} = require(process.argv[1])
            const store = new OptimizationStore(process.argv[2])
            const snapshot = JSON.parse(readFileSync(process.argv[3], "utf8"))
            const created = store.createRun(snapshot)
            store.transitionRun(created.runId, "baseline", {checkpoint: {childWork: "pending"}})
            process.stdout.write(created.runId)
            process.exit(0)
        `, modulePath, path, snapshotPath], {encoding: "utf8"})
        assert.equal(child.status, 0, child.stderr)

        const recovered = new OptimizationStore(path)
        const runId = child.stdout
        assert.equal(recovered.getRun(runId).state, "needs_recovery")
        const generation = recovered.generation
        const revision = recovered.revision
        recovered.close()

        const reopened = new OptimizationStore(path)
        assert.equal(reopened.generation, generation)
        assert.equal(reopened.revision, revision)
        assert.throws(() => reopened.createRun(frozenRun(), {
            expectedRevision: revision - 1,
        }), /revision|CAS|stale/i)
    })

    it("refuses to persist after its ownership token is replaced", () => {
        const {directory, path, store} = fixture()
        const created = store.createRun(frozenRun())
        store.transitionRun(created.runId, "baseline")
        const ownerPath = join(directory, ".optimization-runs.json.owner")
        const owner = JSON.parse(readFileSync(ownerPath, "utf8"))
        writeFileSync(ownerPath, JSON.stringify({...owner, token: "replacement-owner"}), {mode: 0o600})

        assert.throws(
            () => store.transitionRun(created.runId, "editing"),
            /ownership|owner|lock/i,
        )
        assert.equal(JSON.parse(readFileSync(path, "utf8")).runs[0].state, "baseline")
    })

    it("returns and persists stable narrow create receipts across mutation and restart", () => {
        const {path, store} = fixture()
        const created = store.createRun(frozenRun(), {idempotencyKey: "create:stable-receipt"})
        assert.deepEqual(Object.keys(created).sort(), ["revision", "runId", "state", "updatedAt"])
        assert.doesNotMatch(JSON.stringify(created), /snapshot|epochs|operations/u)

        const persisted = JSON.parse(readFileSync(path, "utf8"))
        assert.deepEqual(persisted.creationKeys[0].result, created)
        assert.deepEqual(store.getRun(created.runId).snapshot, frozenRun())

        store.transitionRun(created.runId, "baseline")
        assert.deepEqual(store.createRun(frozenRun(), {
            idempotencyKey: "create:stable-receipt",
        }), created)
        assert.throws(() => store.createRun(frozenRun({mode: "fixed"}), {
            idempotencyKey: "create:stable-receipt",
        }), /different input|idempotency/i)

        store.close()
        const restarted = new OptimizationStore(path)
        assert.deepEqual(restarted.createRun(frozenRun(), {
            idempotencyKey: "create:stable-receipt",
        }), created)

        const unkeyed = restarted.createRun(frozenRun())
        assert.deepEqual(Object.keys(unkeyed).sort(), ["revision", "runId", "state", "updatedAt"])
    })

    it("rejects a creation receipt mixed from the current Run state", () => {
        const {path, store} = fixture()
        const created = store.createRun(frozenRun(), {idempotencyKey: "create:no-mixed-result"})
        store.transitionRun(created.runId, "baseline")
        store.close()

        const persisted = JSON.parse(readFileSync(path, "utf8"))
        persisted.creationKeys[0].result = {
            runId: created.runId,
            state: persisted.runs[0].state,
            revision: persisted.runs[0].revision,
            updatedAt: persisted.runs[0].updatedAt,
        }
        writeFileSync(path, JSON.stringify(persisted), {mode: 0o600})

        assert.throws(() => new OptimizationStore(path), /creation.*result|receipt.*creation|inconsistent/i)
    })

    it("persists the v1 schema atomically with owner-only permissions", () => {
        const {directory, path, store} = fixture()
        const run = store.createRun(frozenRun(), {idempotencyKey: "create:run-1"})
        const persisted = JSON.parse(readFileSync(path, "utf8"))

        assert.equal(persisted.schemaVersion, OPTIMIZATION_STORE_SCHEMA)
        assert.equal(persisted.runs[0].id, run.runId)
        assert.equal(lstatSync(directory).mode & 0o777, 0o700)
        assert.equal(lstatSync(path).mode & 0o777, 0o600)
    })

    it("keeps frozen snapshots immutable across caller and returned-copy mutation", () => {
        const {store} = fixture()
        const snapshot = frozenRun()
        const run = store.createRun(snapshot)
        assert.throws(() => {
            snapshot.baseline.skillRoot = "forged"
        }, TypeError)
        const returned = store.getRun(run.runId)
        returned.snapshot.baseline.skillRoot = "mutated-copy"

        assert.equal(store.getRun(run.runId).snapshot.baseline.skillRoot, "skills/billing-cost-management")
        assert.equal(store.getRun(run.runId).snapshot.digest, snapshot.digest)
    })

    it("enforces run revisions with CAS and durable idempotency", () => {
        const {store} = fixture()
        const created = store.createRun(frozenRun(), {idempotencyKey: "create:one"})
        const baseline = store.transitionRun(created.runId, "baseline", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:baseline",
        })
        const retried = store.transitionRun(created.runId, "baseline", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:baseline",
        })

        assert.deepEqual(retried, baseline)
        assert.equal(baseline.revision, created.revision + 1)
        assert.throws(() => store.transitionRun(created.runId, "editing", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:stale",
        }), /revision|changed|CAS/i)
    })

    it("returns persisted narrow mutation receipts unchanged after later mutations and restart", () => {
        const {path, store} = fixture()
        const run = store.createRun(frozenRun(), {idempotencyKey: "create:stable"})
        const baseline = store.transitionRun(run.runId, "baseline", {}, {
            idempotencyKey: "transition:stable-baseline",
        })
        assert.deepEqual(Object.keys(baseline).sort(), ["revision", "runId", "state", "updatedAt"])
        const editing = store.transitionRun(run.runId, "editing")

        const epoch1 = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"}, {
            idempotencyKey: "epoch:create:stable-1",
        })
        assert.deepEqual(Object.keys(epoch1).sort(), [
            "epochId",
            "index",
            "revision",
            "runId",
            "status",
            "updatedAt",
        ])
        store.transitionRun(run.runId, "installing")
        const installing = store.updateEpoch(run.runId, epoch1.epochId, {
            installArtifactIds: ["install:1"],
        }, {
            idempotencyKey: "epoch:update:stable-installing",
        })
        store.transitionRun(run.runId, "evaluating")
        store.updateEpoch(run.runId, epoch1.epochId, {
            evaluationArtifactIds: ["evaluation:1"],
        })
        store.transitionRun(run.runId, "deciding")
        store.updateEpoch(run.runId, epoch1.epochId, {
            analysisArtifactId: "analysis:1",
            decisionArtifactId: "decision:1",
        })
        store.updateEpoch(run.runId, epoch1.epochId, {status: "completed"})
        store.transitionRun(run.runId, "editing")
        const epoch2 = store.createEpoch(run.runId, {candidateArtifactId: "candidate:2"}, {
            idempotencyKey: "epoch:create:stable-2",
        })

        const retriedBaseline = store.transitionRun(run.runId, "baseline", {}, {
            idempotencyKey: "transition:stable-baseline",
        })
        const retriedEpoch1 = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"}, {
            idempotencyKey: "epoch:create:stable-1",
        })
        const retriedInstalling = store.updateEpoch(run.runId, epoch1.epochId, {
            installArtifactIds: ["install:1"],
        }, {
            idempotencyKey: "epoch:update:stable-installing",
        })
        assert.deepEqual(retriedBaseline, baseline)
        assert.deepEqual(retriedEpoch1, epoch1)
        assert.deepEqual(retriedInstalling, installing)
        assert.notEqual(retriedEpoch1.epochId, epoch2.epochId)
        assert.throws(() => store.createEpoch(run.runId, {candidateArtifactId: "candidate:forged"}, {
            idempotencyKey: "epoch:create:stable-1",
        }), /different input|idempotency/i)

        const stored = store.getRun(run.runId)
        assert.deepEqual(
            stored.operations.find((entry) => entry.key === "transition:stable-baseline").result,
            baseline,
        )
        assert.deepEqual(
            stored.operations.find((entry) => entry.key === "epoch:create:stable-1").result,
            epoch1,
        )
        assert.deepEqual(
            stored.operations.find((entry) => entry.key === "epoch:update:stable-installing").result,
            installing,
        )
        assert.equal(JSON.stringify(retriedEpoch1), JSON.stringify(epoch1))

        store.close()
        const restarted = new OptimizationStore(path)
        assert.deepEqual(restarted.transitionRun(run.runId, "baseline", {}, {
            idempotencyKey: "transition:stable-baseline",
        }), baseline)
        assert.deepEqual(restarted.createEpoch(run.runId, {candidateArtifactId: "candidate:1"}, {
            idempotencyKey: "epoch:create:stable-1",
        }), epoch1)
        assert.deepEqual(restarted.updateEpoch(run.runId, epoch1.epochId, {
            installArtifactIds: ["install:1"],
        }, {
            idempotencyKey: "epoch:update:stable-installing",
        }), installing)
        assert.equal(editing.runId, run.runId)
    })

    it("coordinates live stores for one path without recovering or overwriting active state", () => {
        const {path, store: first} = fixture()
        const run = first.createRun(frozenRun())
        let mutation = first.transitionRun(run.runId, "baseline")
        mutation = first.transitionRun(run.runId, "editing")
        mutation = first.createEpoch(run.runId, {candidateArtifactId: "candidate:1"})

        const second = new OptimizationStore(path)
        assert.equal(second.getRun(run.runId).state, "editing")
        assert.equal(second.coordinationKey, first.coordinationKey)
        const installing = second.transitionRun(run.runId, "installing", {}, {
            expectedRevision: mutation.revision,
        })
        assert.equal(first.getRun(run.runId).state, "installing")
        assert.equal(first.revision, second.revision)
        assert.equal(first.getRun(run.runId).revision, installing.revision)
        second.close()
    })

    it("enforces lifecycle transitions and terminal immutability", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        let mutation = {revision: run.revision}
        assert.throws(() => store.transitionRun(run.runId, "evaluating"), /transition/i)
        for (const state of ["baseline", "editing", "restoring", "succeeded"]) {
            mutation = store.transitionRun(run.runId, state, {}, {expectedRevision: mutation.revision})
        }
        assert.ok(store.getRun(run.runId).completedAt)
        assert.throws(() => store.transitionRun(run.runId, "failed"), /terminal/i)
        assert.throws(() => store.createEpoch(run.runId, {}), /terminal/i)
    })

    it("supports approval-to-install and restore paths without allowing phase skips", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        assert.throws(() => store.transitionRun(run.runId, "installing"), /transition/i)
        store.transitionRun(run.runId, "baseline")
        assert.throws(() => store.transitionRun(run.runId, "installing"), /transition/i)
        store.transitionRun(run.runId, "editing")
        const epoch = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"})
        store.transitionRun(run.runId, "installing")
        store.updateEpoch(run.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
        store.transitionRun(run.runId, "evaluating")
        store.updateEpoch(run.runId, epoch.epochId, {evaluationArtifactIds: ["evaluation:1"]})
        store.transitionRun(run.runId, "deciding")
        store.transitionRun(run.runId, "waiting_approval")
        assert.equal(store.transitionRun(run.runId, "installing").state, "installing")
        assert.equal(store.transitionRun(run.runId, "restoring").state, "restoring")

        const stopped = store.createRun(frozenRun())
        store.transitionRun(stopped.runId, "baseline")
        store.transitionRun(stopped.runId, "editing")
        assert.equal(store.transitionRun(stopped.runId, "restoring").state, "restoring")
    })

    it("stores bounded epoch artifact references and freezes terminal epochs append-only", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        const editing = store.transitionRun(run.runId, "editing")
        const epoch = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"}, {
            expectedRevision: editing.revision,
            idempotencyKey: "epoch:1:create",
        })
        store.transitionRun(run.runId, "installing")
        store.updateEpoch(run.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
        store.transitionRun(run.runId, "evaluating")
        store.updateEpoch(run.runId, epoch.epochId, {
            evaluationArtifactIds: ["evaluation:1"],
        })
        store.transitionRun(run.runId, "deciding")
        store.updateEpoch(run.runId, epoch.epochId, {
            analysisArtifactId: "analysis:1",
            decisionArtifactId: "decision:1",
        })
        const completed = store.updateEpoch(run.runId, epoch.epochId, {
            status: "completed",
        }, {idempotencyKey: "epoch:1:complete"})

        const storedEpoch = store.getRun(run.runId).epochs[0]
        assert.deepEqual(storedEpoch.evaluationArtifactIds, ["evaluation:1"])
        assert.ok(storedEpoch.completedAt)
        assert.equal(completed.status, "completed")
        assert.throws(() => store.updateEpoch(run.runId, epoch.epochId, {
            analysisArtifactId: "analysis:forged",
        }), /terminal|append-only/i)
        assert.throws(() => store.createEpoch(run.runId, {payload: {large: true}}), /unknown|payload/i)
    })

    it("does not allow terminal evaluation references to be rewritten while deciding", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        store.transitionRun(run.runId, "editing")
        const epoch = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"})
        store.transitionRun(run.runId, "installing")
        store.updateEpoch(run.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
        store.transitionRun(run.runId, "evaluating")
        store.updateEpoch(run.runId, epoch.epochId, {evaluationArtifactIds: ["evaluation:1"]})
        store.transitionRun(run.runId, "deciding")

        assert.throws(() => store.updateEpoch(run.runId, epoch.epochId, {
            evaluationArtifactIds: ["evaluation:forged"],
        }), /evaluation.*immutable|append-only/i)
    })

    it("enforces the complete forward-only Epoch lifecycle", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        store.transitionRun(run.runId, "editing")
        let epoch = store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"})
        assert.throws(
            () => store.createEpoch(run.runId, {candidateArtifactId: "candidate:parallel"}),
            /active.*epoch|epoch.*progress/i,
        )
        assert.throws(
            () => store.updateEpoch(run.runId, epoch.epochId, {status: "evaluating"}),
            /transition|phase/i,
        )
        store.transitionRun(run.runId, "installing")
        assert.throws(
            () => store.updateEpoch(run.runId, epoch.epochId, {status: "editing"}),
            /transition|phase/i,
        )
        store.updateEpoch(run.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
        store.transitionRun(run.runId, "evaluating")
        assert.throws(
            () => store.updateEpoch(run.runId, epoch.epochId, {status: "editing"}),
            /transition|phase/i,
        )
        store.updateEpoch(run.runId, epoch.epochId, {evaluationArtifactIds: ["evaluation:1"]})
        store.transitionRun(run.runId, "deciding")
        assert.throws(
            () => store.updateEpoch(run.runId, epoch.epochId, {status: "installing"}),
            /transition|phase/i,
        )
        store.updateEpoch(run.runId, epoch.epochId, {
            analysisArtifactId: "analysis:1",
            decisionArtifactId: "decision:1",
        })
        assert.equal(store.updateEpoch(run.runId, epoch.epochId, {status: "completed"}).status, "completed")
    })

    it("aligns Run/Epoch phases, gates phase artifacts, and converges terminal state", () => {
        const {store} = fixture()
        const created = store.createRun(frozenRun())
        store.transitionRun(created.runId, "baseline")
        store.transitionRun(created.runId, "editing")
        const epoch = store.createEpoch(created.runId)

        assert.throws(
            () => store.transitionRun(created.runId, "installing"),
            /candidate.*required|installing.*candidate/i,
        )
        store.updateEpoch(created.runId, epoch.epochId, {candidateArtifactId: "candidate:1"})
        store.transitionRun(created.runId, "installing")
        assert.equal(store.getRun(created.runId).epochs[0].status, "installing")

        assert.throws(
            () => store.transitionRun(created.runId, "evaluating"),
            /install.*artifact|required/i,
        )
        store.updateEpoch(created.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
        store.transitionRun(created.runId, "evaluating")
        assert.equal(store.getRun(created.runId).epochs[0].status, "evaluating")

        assert.throws(
            () => store.transitionRun(created.runId, "deciding"),
            /evaluation.*artifact|required/i,
        )
        store.updateEpoch(created.runId, epoch.epochId, {evaluationArtifactIds: ["evaluation:1"]})
        store.transitionRun(created.runId, "deciding")
        assert.equal(store.getRun(created.runId).epochs[0].status, "deciding")

        assert.throws(
            () => store.transitionRun(created.runId, "succeeded"),
            /nonterminal.*epoch|epoch.*terminal/i,
        )
        store.updateEpoch(created.runId, epoch.epochId, {
            status: "completed",
            analysisArtifactId: "analysis:1",
            decisionArtifactId: "decision:1",
        })
        assert.equal(store.transitionRun(created.runId, "succeeded").state, "succeeded")
        assert.equal(store.getRun(created.runId).epochs[0].status, "completed")
    })

    it("normalizes interrupted active phases to needs_recovery with a checkpoint", () => {
        const {path, store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        const editing = store.transitionRun(run.runId, "editing")
        store.close()

        const restarted = new OptimizationStore(path)
        const recovered = restarted.getRun(run.runId)
        assert.equal(recovered.state, "needs_recovery")
        assert.equal(recovered.recovery.previousState, "editing")
        assert.equal(recovered.revision, editing.revision + 1)
    })

    it("normalizes an interrupted baseline phase to needs_recovery", () => {
        const {path, store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        store.close()

        const restarted = new OptimizationStore(path)
        const recovered = restarted.getRun(run.runId)
        assert.equal(recovered.state, "needs_recovery")
        assert.equal(recovered.recovery.previousState, "baseline")
    })

    it("preserves nonempty checkpoints for every interrupted active state", () => {
        for (const targetState of [
            "baseline",
            "editing",
            "installing",
            "evaluating",
            "deciding",
            "restoring",
        ]) {
            const directory = mkdtempSync(join(tmpdir(), `rolling-skill-recovery-${targetState}-`))
            temporaryDirectories.push(directory)
            const path = join(directory, "optimization-runs.json")
            const store = new OptimizationStore(path)
            const created = store.createRun(frozenRun())
            const checkpoint = {
                cursor: `${targetState}:cursor`,
                child: {artifactId: `${targetState}:artifact`, attempt: 3},
            }
            store.transitionRun(
                created.runId,
                "baseline",
                targetState === "baseline" ? {checkpoint} : {},
            )
            if (targetState !== "baseline") {
                store.transitionRun(
                    created.runId,
                    "editing",
                    targetState === "editing" ? {checkpoint} : {},
                )
            }
            if (["installing", "evaluating", "deciding"].includes(targetState)) {
                const epoch = store.createEpoch(created.runId, {candidateArtifactId: "candidate:1"})
                store.transitionRun(
                    created.runId,
                    "installing",
                    targetState === "installing" ? {checkpoint} : {},
                )
                if (["evaluating", "deciding"].includes(targetState)) {
                    store.updateEpoch(created.runId, epoch.epochId, {installArtifactIds: ["install:1"]})
                    store.transitionRun(
                        created.runId,
                        "evaluating",
                        targetState === "evaluating" ? {checkpoint} : {},
                    )
                }
                if (targetState === "deciding") {
                    store.updateEpoch(created.runId, epoch.epochId, {
                        evaluationArtifactIds: ["evaluation:1"],
                    })
                    store.transitionRun(created.runId, "deciding", {checkpoint})
                }
            } else if (targetState === "restoring") {
                store.transitionRun(created.runId, "restoring", {checkpoint})
            }
            store.close()

            const restarted = new OptimizationStore(path)
            const recovered = restarted.getRun(created.runId)
            assert.deepEqual(recovered.checkpoint, checkpoint, targetState)
            assert.deepEqual(recovered.recovery, {
                previousState: targetState,
                reason: "process_interrupted",
                recoveredAt: recovered.updatedAt,
            }, targetState)
            restarted.close()
        }
    })

    it("returns summaries without trusted paths, commits, digests, models, or internal snapshots", () => {
        const {store} = fixture()
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        store.transitionRun(run.runId, "editing")
        store.createEpoch(run.runId, {candidateArtifactId: "candidate:1"})

        const summary = store.publicSummary(run.runId)
        const encoded = JSON.stringify(summary)
        assert.equal(summary.id, run.runId)
        assert.equal(summary.state, "editing")
        assert.equal(summary.counts.epochs, 1)
        assert.deepEqual(summary.artifactRefs.candidates, ["candidate:1"])
        assert.doesNotMatch(encoded, /skillRoot|skills\/billing|commit|sha256|gpt-|snapshot|modelId/u)
    })

    it("rejects path-shaped public run and artifact identifiers", () => {
        const {store} = fixture()
        assert.throws(() => store.createRun(frozenRun(), {id: "/tmp/private-run"}), /id|path|reference/i)
        const run = store.createRun(frozenRun())
        store.transitionRun(run.runId, "baseline")
        store.transitionRun(run.runId, "editing")
        assert.throws(
            () => store.createEpoch(run.runId, {candidateArtifactId: "/tmp/private-candidate"}),
            /artifact|path|reference/i,
        )
    })

    it("rejects symlinked, hard-linked, and permissive private store files", () => {
        const {directory, path, store} = fixture()
        store.createRun(frozenRun())
        store.close()

        const symlinkPath = join(directory, "symlink.json")
        symlinkSync(path, symlinkPath)
        assert.throws(() => new OptimizationStore(symlinkPath), /symbolic link|regular file/i)

        const hardlinkPath = join(directory, "hardlink.json")
        linkSync(path, hardlinkPath)
        assert.throws(() => new OptimizationStore(path), /single link|hard.?link/i)
        rmSync(hardlinkPath)

        chmodSync(path, 0o644)
        assert.throws(() => new OptimizationStore(path), /0600|owner-only/i)
    })

    it("rejects unsupported schemas, unknown fields, and oversized stores", () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-invalid-"))
        temporaryDirectories.push(directory)
        const path = join(directory, "optimization-runs.json")
        writeFileSync(path, JSON.stringify({schemaVersion: "rolling-skill-optimization-runs/v0", runs: []}), {mode: 0o600})
        assert.throws(() => new OptimizationStore(path), /schema/i)

        writeFileSync(path, JSON.stringify({schemaVersion: OPTIMIZATION_STORE_SCHEMA, runs: [], polluted: true}), {mode: 0o600})
        assert.throws(() => new OptimizationStore(path), /unknown|missing fields/i)

        writeFileSync(path, "x".repeat(17 * 1024 * 1024), {mode: 0o600})
        assert.throws(() => new OptimizationStore(path), /byte limit|large/i)
    })
})
