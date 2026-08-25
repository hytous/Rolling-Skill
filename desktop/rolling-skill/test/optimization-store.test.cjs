"use strict"

const assert = require("node:assert/strict")
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

function frozenRun() {
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
    it("persists the v1 schema atomically with owner-only permissions", () => {
        const {directory, path, store} = fixture()
        const run = store.createRun(frozenRun(), {idempotencyKey: "create:run-1"})
        const persisted = JSON.parse(readFileSync(path, "utf8"))

        assert.equal(persisted.schemaVersion, OPTIMIZATION_STORE_SCHEMA)
        assert.equal(persisted.runs[0].id, run.id)
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
        const returned = store.getRun(run.id)
        returned.snapshot.baseline.skillRoot = "mutated-copy"

        assert.equal(store.getRun(run.id).snapshot.baseline.skillRoot, "skills/billing-cost-management")
        assert.equal(store.getRun(run.id).snapshot.digest, snapshot.digest)
    })

    it("enforces run revisions with CAS and durable idempotency", () => {
        const {store} = fixture()
        const created = store.createRun(frozenRun(), {idempotencyKey: "create:one"})
        const baseline = store.transitionRun(created.id, "baseline", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:baseline",
        })
        const retried = store.transitionRun(created.id, "baseline", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:baseline",
        })

        assert.deepEqual(retried, baseline)
        assert.equal(baseline.revision, created.revision + 1)
        assert.throws(() => store.transitionRun(created.id, "editing", {}, {
            expectedRevision: created.revision,
            idempotencyKey: "transition:stale",
        }), /revision|changed|CAS/i)
    })

    it("coordinates live stores for one path without recovering or overwriting active state", () => {
        const {path, store: first} = fixture()
        let run = first.createRun(frozenRun())
        run = first.transitionRun(run.id, "baseline")
        run = first.transitionRun(run.id, "editing")

        const second = new OptimizationStore(path)
        assert.equal(second.getRun(run.id).state, "editing")
        assert.equal(second.coordinationKey, first.coordinationKey)
        const installing = second.transitionRun(run.id, "installing", {}, {
            expectedRevision: run.revision,
        })
        assert.equal(first.getRun(run.id).state, "installing")
        assert.equal(first.revision, second.revision)
        assert.equal(first.getRun(run.id).revision, installing.revision)
        second.close()
    })

    it("enforces lifecycle transitions and terminal immutability", () => {
        const {store} = fixture()
        let run = store.createRun(frozenRun())
        assert.throws(() => store.transitionRun(run.id, "evaluating"), /transition/i)
        for (const state of [
            "baseline",
            "editing",
            "installing",
            "evaluating",
            "deciding",
            "restoring",
            "succeeded",
        ]) {
            run = store.transitionRun(run.id, state, {}, {expectedRevision: run.revision})
        }
        assert.ok(run.completedAt)
        assert.throws(() => store.transitionRun(run.id, "failed"), /terminal/i)
        assert.throws(() => store.createEpoch(run.id, {}), /terminal/i)
    })

    it("stores bounded epoch artifact references and freezes terminal epochs append-only", () => {
        const {store} = fixture()
        let run = store.createRun(frozenRun())
        run = store.transitionRun(run.id, "baseline")
        run = store.transitionRun(run.id, "editing")
        let epoch = store.createEpoch(run.id, {candidateArtifactId: "candidate:1"}, {
            expectedRevision: run.revision,
            idempotencyKey: "epoch:1:create",
        })
        epoch = store.updateEpoch(run.id, epoch.id, {
            status: "completed",
            installArtifactIds: ["install:1"],
            evaluationArtifactIds: ["evaluation:1"],
            analysisArtifactId: "analysis:1",
            decisionArtifactId: "decision:1",
        }, {idempotencyKey: "epoch:1:complete"})

        assert.deepEqual(epoch.evaluationArtifactIds, ["evaluation:1"])
        assert.ok(epoch.completedAt)
        assert.throws(() => store.updateEpoch(run.id, epoch.id, {
            analysisArtifactId: "analysis:forged",
        }), /terminal|append-only/i)
        assert.throws(() => store.createEpoch(run.id, {payload: {large: true}}), /unknown|payload/i)
    })

    it("does not allow terminal evaluation references to be rewritten while deciding", () => {
        const {store} = fixture()
        let run = store.createRun(frozenRun())
        run = store.transitionRun(run.id, "baseline")
        run = store.transitionRun(run.id, "editing")
        const epoch = store.createEpoch(run.id, {candidateArtifactId: "candidate:1"})
        store.updateEpoch(run.id, epoch.id, {
            status: "deciding",
            installArtifactIds: ["install:1"],
            evaluationArtifactIds: ["evaluation:1"],
        })

        assert.throws(() => store.updateEpoch(run.id, epoch.id, {
            evaluationArtifactIds: ["evaluation:forged"],
        }), /evaluation.*immutable|append-only/i)
    })

    it("normalizes interrupted active phases to needs_recovery with a checkpoint", () => {
        const {path, store} = fixture()
        let run = store.createRun(frozenRun())
        run = store.transitionRun(run.id, "baseline")
        run = store.transitionRun(run.id, "editing")
        store.close()

        const restarted = new OptimizationStore(path)
        const recovered = restarted.getRun(run.id)
        assert.equal(recovered.state, "needs_recovery")
        assert.equal(recovered.checkpoint.previousState, "editing")
        assert.equal(recovered.revision, run.revision + 1)
    })

    it("returns summaries without trusted paths, commits, digests, models, or internal snapshots", () => {
        const {store} = fixture()
        let run = store.createRun(frozenRun())
        run = store.transitionRun(run.id, "baseline")
        run = store.transitionRun(run.id, "editing")
        store.createEpoch(run.id, {candidateArtifactId: "candidate:1"})

        const summary = store.publicSummary(run.id)
        const encoded = JSON.stringify(summary)
        assert.equal(summary.id, run.id)
        assert.equal(summary.state, "editing")
        assert.equal(summary.counts.epochs, 1)
        assert.deepEqual(summary.artifactRefs.candidates, ["candidate:1"])
        assert.doesNotMatch(encoded, /skillRoot|skills\/billing|commit|sha256|gpt-|snapshot|modelId/u)
    })

    it("rejects path-shaped public run and artifact identifiers", () => {
        const {store} = fixture()
        assert.throws(() => store.createRun(frozenRun(), {id: "/tmp/private-run"}), /id|path|reference/i)
        let run = store.createRun(frozenRun())
        run = store.transitionRun(run.id, "baseline")
        run = store.transitionRun(run.id, "editing")
        assert.throws(
            () => store.createEpoch(run.id, {candidateArtifactId: "/tmp/private-candidate"}),
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
