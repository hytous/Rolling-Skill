const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {SkillInstallationManager} = require("../src/skill-installation-manager.cjs")
const {SkillInstallationStore} = require("../src/skill-installation-store.cjs")
const {
    EXPERIMENT_MARKER_SCHEMA,
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
    buildSkillInstallationPrompt,
    freezeSkillExperimentRequest,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
} = require("../src/skill-installation-protocol.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function digest(character) {
    return `sha256:${character.repeat(64)}`
}

function managedFacts() {
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
        versionLabel: null,
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

function initialAbsent() {
    return {classification: "absent", destination: null}
}

function initialManaged(facts = managedFacts()) {
    return {
        classification: "managed-clean",
        destination: "/runtime/skills/billing",
        versionId: facts.baseline.id,
        commit: facts.baseline.commit,
        contentDigest: facts.baseline.contentDigest,
    }
}

function experimentRequest(overrides = {}) {
    const facts = managedFacts()
    return freezeSkillExperimentRequest({
        operation: "experiment_install",
        run: facts.run,
        epoch: 2,
        repository: facts.repository,
        skill: facts.skill,
        baseline: facts.baseline,
        candidate: facts.candidate,
        previousCandidate: facts.previousCandidate,
        initial: initialAbsent(),
        ...overrides,
    })
}

function resultText(request, overrides = {}) {
    const resultOverrides = overrides.result ?? {}
    const payloadOverrides = {...overrides}
    delete payloadOverrides.result
    const payload = {
        schema: INSTALL_RESULT_SCHEMA,
        purpose: request.purpose,
        status: "succeeded",
        operation: request.operation,
        classificationBefore: request.experiment.previous
            ? "managed-clean"
            : request.experiment.initial?.classification ?? "absent",
        destination: "/runtime/skills/billing",
        source: {...request.source},
        permission: {requested: "workspace-write", effective: "workspace-write"},
        result: {
            beforeDigest: request.experiment.previous?.expectedDigest ?? null,
            actualDigest: request.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: true,
            mutationPerformed: request.operation !== "experiment_inspect",
            markerBefore: request.experiment.previous?.marker ?? null,
            markerAfter: request.experiment.marker,
            ...resultOverrides,
        },
        warnings: [],
        error: null,
        ...payloadOverrides,
    }
    payload.result = {...payload.result, ...resultOverrides}
    return `${INSTALL_RESULT_SENTINEL.open}\n${JSON.stringify(payload)}\n${INSTALL_RESULT_SENTINEL.close}`
}

describe("Optimization Candidate experiment installation", () => {
    it("keeps ordinary installation Released-only while upgrading its result contract to v2", () => {
        const facts = managedFacts()
        assert.equal(INSTALL_RESULT_SCHEMA, "rolling-skill-install-result/v2")
        assert.throws(() => freezeSkillInstallationRequest({
            repository: facts.repository,
            skill: facts.skill,
            version: facts.candidate,
        }), /Released/u)
    })

    it("freezes the Run, Epoch, Candidate, initial target, restoration source, and previous Candidate", () => {
        const facts = managedFacts()
        const request = experimentRequest()
        facts.candidate.commit = "0".repeat(40)
        facts.run.snapshot.baseline.commit = "9".repeat(40)

        assert.equal(request.purpose, "optimization-experiment")
        assert.equal(request.operation, "experiment_install")
        assert.equal(request.markerSchema, EXPERIMENT_MARKER_SCHEMA)
        assert.deepEqual(request.experiment.marker, {
            schema: "rolling-skill-experiment/v1",
            runId: "run-1",
            epoch: 2,
            skillId: "skill-1",
            versionId: "candidate-2",
            commit: "c".repeat(40),
            contentDigest: digest("d"),
        })
        assert.equal(request.experiment.previous.versionId, "candidate-1")
        assert.equal(request.experiment.restoration.mode, "remove")
        assert.equal(Object.isFrozen(request.experiment), true)

        const managed = experimentRequest({initial: initialManaged()})
        assert.equal(managed.experiment.restoration.mode, "restore")
        assert.equal(managed.experiment.restoration.source.versionId, "release-1")
        assert.equal(managed.experiment.restoration.source.expectedDigest, digest("b"))
    })

    it("rejects Candidate provenance, baseline identity, operation, and rotation mismatches", () => {
        const facts = managedFacts()
        assert.throws(() => experimentRequest({
            candidate: {...facts.candidate, optimizationRunId: "other-run"},
        }), /Run/u)
        assert.throws(() => experimentRequest({
            baseline: {...facts.baseline, commit: "0".repeat(40)},
        }), /baseline/u)
        assert.throws(() => experimentRequest({operation: "install"}), /experiment operation/u)
        assert.throws(() => experimentRequest({previousCandidate: null}), /previous Candidate/u)
        assert.throws(() => experimentRequest({
            previousCandidate: {...facts.previousCandidate, optimizationEpoch: 2},
        }), /previous Candidate/u)
    })

    it("accepts a matching Candidate result only with exact before/after marker evidence", () => {
        const request = experimentRequest()
        const parsed = parseSkillInstallationResult(resultText(request), request)

        assert.equal(parsed.schema, "rolling-skill-install-result/v2")
        assert.equal(parsed.purpose, "optimization-experiment")
        assert.equal(parsed.trusted, true)
        assert.deepEqual(parsed.result.markerAfter, request.experiment.marker)

        assert.throws(() => parseSkillInstallationResult(resultText(request, {
            result: {markerAfter: {...request.experiment.marker, runId: "other-run"}},
        }), request), /experiment marker/u)
        assert.throws(() => parseSkillInstallationResult(resultText(request, {
            result: {beforeDigest: digest("0")},
        }), request), /previous Candidate digest/u)
    })

    it("allows Epoch 1 enrollment only from absent or the exact managed-clean baseline", () => {
        const facts = managedFacts()
        const absent = experimentRequest({
            epoch: 1,
            candidate: {...facts.candidate, id: "candidate-1", optimizationEpoch: 1},
            previousCandidate: null,
            initial: null,
            operation: "experiment_inspect",
        })
        const absentResult = parseSkillInstallationResult(resultText(absent, {
            classificationBefore: "absent",
            destination: null,
            result: {
                beforeDigest: null,
                actualDigest: null,
                markerWritten: false,
                runtimeDiscovered: false,
                mutationPerformed: false,
                markerBefore: null,
                markerAfter: null,
            },
        }), absent)
        assert.equal(absentResult.trusted, true)

        const managed = freezeSkillExperimentRequest({
            operation: "experiment_inspect",
            run: facts.run,
            epoch: 1,
            repository: facts.repository,
            skill: facts.skill,
            baseline: facts.baseline,
            candidate: {...facts.candidate, id: "candidate-1", optimizationEpoch: 1},
            previousCandidate: null,
            initial: null,
        })
        assert.equal(parseSkillInstallationResult(resultText(managed, {
            classificationBefore: "managed-clean",
            result: {
                beforeDigest: facts.baseline.contentDigest,
                actualDigest: facts.baseline.contentDigest,
                markerWritten: true,
                runtimeDiscovered: true,
                mutationPerformed: false,
                markerBefore: null,
                markerAfter: null,
            },
        }), managed).trusted, true)

        for (const classification of [
            "managed-drifted",
            "unmanaged",
            "conflict",
            "uncertain",
        ]) {
            assert.throws(() => parseSkillInstallationResult(resultText(managed, {
                classificationBefore: classification,
                result: {
                    beforeDigest: null,
                    actualDigest: null,
                    markerWritten: false,
                    runtimeDiscovered: false,
                    mutationPerformed: false,
                    markerBefore: null,
                    markerAfter: null,
                },
            }), managed), /preflight/u)
        }
    })

    it("restores a frozen managed baseline and removes only an exact absent-baseline experiment", () => {
        const facts = managedFacts()
        const restore = experimentRequest({
            operation: "experiment_restore",
            initial: initialManaged(facts),
        })
        const restored = parseSkillInstallationResult(resultText(restore, {
            result: {
                beforeDigest: facts.candidate.contentDigest,
                actualDigest: facts.baseline.contentDigest,
                markerWritten: true,
                runtimeDiscovered: true,
                mutationPerformed: true,
                markerBefore: restore.experiment.marker,
                markerAfter: null,
            },
        }), restore)
        assert.equal(restored.trusted, true)

        const remove = experimentRequest({operation: "experiment_remove"})
        const removed = parseSkillInstallationResult(resultText(remove, {
            result: {
                beforeDigest: facts.candidate.contentDigest,
                actualDigest: null,
                markerWritten: false,
                runtimeDiscovered: false,
                mutationPerformed: true,
                markerBefore: remove.experiment.marker,
                markerAfter: null,
            },
        }), remove)
        assert.equal(removed.trusted, true)
        assert.equal(removed.destination, "/runtime/skills/billing")
        assert.throws(() => parseSkillInstallationResult(resultText(remove, {
            destination: null,
            result: {
                beforeDigest: facts.candidate.contentDigest,
                actualDigest: null,
                markerWritten: false,
                runtimeDiscovered: false,
                mutationPerformed: true,
                markerBefore: remove.experiment.marker,
                markerAfter: null,
            },
        }), remove), /destination/u)
    })

    it("normalizes recovery mismatches only when the Runtime proves it made no mutation", () => {
        const request = experimentRequest({operation: "experiment_remove"})
        const recovered = parseSkillInstallationResult(resultText(request, {
            status: "needs_recovery",
            classificationBefore: "managed-drifted",
            result: {
                beforeDigest: digest("0"),
                actualDigest: digest("0"),
                markerWritten: false,
                runtimeDiscovered: false,
                mutationPerformed: false,
                markerBefore: null,
                markerAfter: null,
            },
            error: {code: "EXPERIMENT_TARGET_MISMATCH", message: "Target changed"},
        }), request)
        assert.equal(recovered.status, "needs_recovery")
        assert.equal(recovered.trusted, false)
        assert.equal(recovered.result.mutationPerformed, false)

        assert.throws(() => parseSkillInstallationResult(resultText(request, {
            status: "needs_recovery",
            result: {mutationPerformed: true},
            error: {code: "EXPERIMENT_TARGET_MISMATCH", message: "Target changed"},
        }), request), /must not mutate/u)
    })

    it("builds operation-specific prompts that forbid unsafe preflight, rotation, restore, and removal", () => {
        const install = buildSkillInstallationPrompt(experimentRequest(), {
            requestedPermission: "workspace-write",
        })
        assert.match(install, /optimization experiment/u)
        assert.match(install, /previous Candidate digest/u)
        assert.match(install, /rolling-skill-experiment\/v1/u)
        assert.match(install, /exclude.*\.rolling-skill-experiment\.json/iu)
        assert.match(install, /Do not search controller stores, historical conversations, traces, or application source code/u)
        assert.match(install, /do not retype or guess UUIDs or paths/u)
        assert.match(install, /Preserve the existing ordinary management marker unchanged/u)
        assert.match(install, /If the frozen repository path does not exist, stop/u)

        const remove = buildSkillInstallationPrompt(experimentRequest({
            operation: "experiment_remove",
        }))
        assert.match(remove, /do not delete or overwrite anything/u)
        assert.match(remove, /needs_recovery/u)
        assert.match(remove, /"destination": "\/absolute\/path/u)
        assert.match(remove, /"actualDigest": null/u)
        assert.match(remove, /"markerWritten": false/u)
        assert.match(remove, /"markerAfter": null/u)

        const facts = managedFacts()
        const preflight = buildSkillInstallationPrompt(experimentRequest({
            operation: "experiment_inspect",
            epoch: 1,
            candidate: {...facts.candidate, id: "candidate-1", optimizationEpoch: 1},
            previousCandidate: null,
            initial: null,
        }))
        assert.match(preflight, /"mutationPerformed": false/u)
        assert.match(preflight, /"markerBefore": null/u)
        assert.match(preflight, /"markerAfter": null/u)
        const example = JSON.parse(preflight.split(INSTALL_RESULT_SENTINEL.open)[1].split(INSTALL_RESULT_SENTINEL.close)[0])
        assert.equal(example.result.actualDigest, facts.baseline.contentDigest, "preflight reports installed baseline, not the uninstalled candidate")
        assert.equal(example.result.markerWritten, true, "the example must match the parser's existing-marker semantics")
        assert.equal(example.result.beforeDigest, facts.baseline.contentDigest)
        assert.ok(example.destination?.startsWith("/"))
    })

    it("derives a read-only recovery inspection instead of replaying a cancelled mutation", () => {
        const installing = experimentRequest()
        const inspection = freezeSkillExperimentRecoveryInspectionRequest(installing)
        const prompt = buildSkillInstallationPrompt(inspection, {requestedPermission: "read-only"})

        assert.equal(installing.operation, "experiment_install")
        assert.equal(inspection.operation, "experiment_inspect")
        assert.equal(inspection.experiment.inspectionMode, "recovery")
        assert.match(prompt, /strictly read-only/u)
        assert.match(prompt, /current Candidate marker and digest/u)
        assert.match(prompt, /"operation": "experiment_inspect"/u)
        assert.doesNotMatch(prompt, /Install the exact Candidate/u)

        const parsed = parseSkillInstallationResult(resultText(inspection, {
            classificationBefore: "managed-clean",
            result: {
                beforeDigest: inspection.source.expectedDigest,
                actualDigest: inspection.source.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: true,
                mutationPerformed: false,
                markerBefore: inspection.experiment.marker,
                markerAfter: inspection.experiment.marker,
            },
        }), inspection)
        assert.equal(parsed.verification, "experiment-inspection")
        assert.equal(parsed.trusted, true)
    })

    it("keeps successful experiment Jobs out of the formal installation matrix", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-experiment-store-"))
        temporaryDirectories.push(root)
        const store = new SkillInstallationStore(join(root, "installations.json"))
        const request = experimentRequest()
        const parsed = parseSkillInstallationResult(resultText(request), request)
        const job = store.createJob({
            operation: request.operation,
            runtime: {
                runtimeId: "codex:one",
                providerId: "codex",
                displayName: "Codex",
            },
            request,
            modelId: "model-1",
            effort: "high",
            permissionMode: "workspace-write",
        })
        store.updateJob(job.id, {status: "running"})
        store.completeJob(job.id, {status: "succeeded", parsedResult: parsed})

        assert.equal(store.getJob(job.id).operation, "experiment_install")
        assert.equal(store.getJob(job.id).request.experiment.runId, "run-1")
        assert.deepEqual(store.read().installations, [])
        assert.deepEqual(store.installationMatrix("skill-1"), [])

        const recoveryRequest = experimentRequest({operation: "experiment_remove"})
        const recoveryResult = parseSkillInstallationResult(resultText(recoveryRequest, {
            status: "needs_recovery",
            classificationBefore: "managed-drifted",
            result: {
                beforeDigest: digest("0"),
                actualDigest: digest("0"),
                markerWritten: false,
                runtimeDiscovered: false,
                mutationPerformed: false,
                markerBefore: null,
                markerAfter: null,
            },
            error: {code: "EXPERIMENT_TARGET_MISMATCH", message: "Target changed"},
        }), recoveryRequest)
        const recoveryJob = store.createJob({
            operation: recoveryRequest.operation,
            runtime: {
                runtimeId: "codex:one",
                providerId: "codex",
                displayName: "Codex",
            },
            request: recoveryRequest,
        })
        store.updateJob(recoveryJob.id, {status: "running"})
        store.updateJob(recoveryJob.id, {status: "verifying"})
        store.completeJob(recoveryJob.id, {
            status: "needs_recovery",
            parsedResult: recoveryResult,
        })
        assert.equal(store.getJob(recoveryJob.id).status, "needs_recovery")
    })

    it("starts experiments only for an immutable Candidate matching the frozen Run", async () => {
        const facts = managedFacts()
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-experiment-manager-"))
        temporaryDirectories.push(root)
        const versions = new Map([
            [facts.baseline.id, facts.baseline],
            [facts.candidate.id, facts.candidate],
            [facts.previousCandidate.id, facts.previousCandidate],
        ])
        const clients = []
        const runtime = {
            runtimeId: "codex:one",
            providerId: "codex",
            displayName: "Codex",
            version: "1.0.0",
            executablePath: "/bin/codex",
        }
        const store = new SkillInstallationStore(join(root, "installations.json"))
        const manager = new SkillInstallationManager({
            store,
            managedSkillStore: {
                getRepository: () => ({...facts.repository}),
                getSkill: () => ({...facts.skill}),
                getVersion: (id) => ({...versions.get(id)}),
            },
            managedSkillManager: {repositoryPath: () => facts.repository.managedPath},
            runtimeRegistry: {
                createClient(descriptor, options) {
                    const client = new AutoResultClient(descriptor, options)
                    clients.push(client)
                    return client
                },
            },
            getRuntimes: () => [runtime],
            workspaceRoot: "/workspace",
            traceDirectory: join(root, "traces"),
            resolvePermission: (_providerId, mode) => ({permissionMode: mode}),
            timeoutMs: 2_000,
        })

        await assert.rejects(() => manager.start({
            skillId: facts.skill.id,
            versionId: facts.candidate.id,
            targets: [{runtimeId: runtime.runtimeId}],
        }), /Released/u)

        const [job] = await manager.startOptimizationExperiment({
            operation: "experiment_install",
            run: facts.run,
            epoch: 2,
            candidateVersionId: facts.candidate.id,
            previousCandidateVersionId: facts.previousCandidate.id,
            targets: [{
                runtimeId: runtime.runtimeId,
                modelId: "model-1",
                effort: "high",
                permissionMode: "workspace-write",
                initial: initialAbsent(),
            }],
        })
        await manager.wait(job.id)

        assert.equal(store.getJob(job.id).status, "succeeded")
        assert.equal(store.getJob(job.id).request.purpose, "optimization-experiment")
        assert.deepEqual(store.installationMatrix(facts.skill.id), [])
        assert.equal(clients.length, 1)

        versions.set(facts.candidate.id, {...facts.candidate, optimizationRunId: "forged-run"})
        await assert.rejects(() => manager.startOptimizationExperiment({
            operation: "experiment_install",
            run: facts.run,
            epoch: 2,
            candidateVersionId: facts.candidate.id,
            previousCandidateVersionId: facts.previousCandidate.id,
            targets: [{runtimeId: runtime.runtimeId, initial: initialAbsent()}],
        }), /Run/u)
        assert.equal(clients.length, 1)
    })
})

class AutoResultClient extends EventEmitter {
    constructor(descriptor, options) {
        super()
        this.descriptor = descriptor
        this.options = options
        this.sequence = 0
        this.recorder = {latestReference: `/trace/${descriptor.runtimeId}`}
    }

    async start() {}

    async startThread(options) {
        this.profile = options
        return {thread: {id: "thread-1", model: options.model, effort: options.effort}}
    }

    async startTurn(threadId) {
        const turnId = `turn-${++this.sequence}`
        const text = resultText(this.options.installationRequest)
        setImmediate(() => {
            this.emit("notification", {
                method: "item/completed",
                params: {
                    threadId,
                    turnId,
                    item: {id: `message-${this.sequence}`, type: "agentMessage", text},
                },
            })
            this.emit("notification", {
                method: "turn/completed",
                params: {threadId, turn: {id: turnId, status: "completed"}},
            })
        })
        return {turn: {id: turnId, status: "inProgress"}}
    }

    state() {
        return {status: "ready", traceReference: this.recorder.latestReference}
    }

    async stop() {}
}
