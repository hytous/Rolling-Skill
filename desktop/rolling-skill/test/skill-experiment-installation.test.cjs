const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {SkillInstallationManager} = require("../src/skill-installation-manager.cjs")
const {SkillInstallationStore} = require("../src/skill-installation-store.cjs")
const {
    buildSkillInstallationPrompt,
    freezeSkillExperimentRequest,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillInstallationRequest,
    validateSkillInstallationRegistration,
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

function successEvidence(request, overrides = {}) {
    const operation = overrides.operation ?? request.operation
    const inspection = operation === "experiment_inspect"
    const actualDigest = operation === "experiment_restore"
        ? request.experiment.baseline.expectedDigest
        : operation === "experiment_remove"
          ? null
          : inspection && request.experiment.inspectionMode === "preflight"
            ? request.experiment.baseline.expectedDigest
            : request.source.expectedDigest
    const beforeDigest = inspection
        ? actualDigest
        : operation === "experiment_install"
          ? request.experiment.previous?.expectedDigest ?? (
              request.experiment.initial.classification === "absent"
                  ? null
                  : request.experiment.baseline.expectedDigest
          )
          : request.source.expectedDigest
    return {
        status: "succeeded",
        operation,
        classificationBefore: inspection
            ? actualDigest === null ? "absent" : "managed-clean"
            : request.experiment.previous ? "managed-clean" : request.experiment.initial.classification,
        destination: inspection && actualDigest === null ? null : "/runtime/skills/billing",
        actualDigest,
        beforeDigest,
        mutationPerformed: !inspection,
        runtimeDiscovered: true,
        warnings: [],
        error: null,
        ...overrides,
    }
}

describe("Optimization Candidate experiment installation", () => {
    it("keeps ordinary installation Released-only", () => {
        const facts = managedFacts()
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
        assert.equal(Object.hasOwn(request, "markerSchema"), false)
        assert.equal(Object.hasOwn(request.experiment, "marker"), false)
        assert.equal(request.experiment.previous.versionId, "candidate-1")
        assert.equal(request.experiment.restoration.mode, "remove")
        assert.equal(Object.isFrozen(request.experiment), true)

        const managed = experimentRequest({initial: initialManaged()})
        assert.equal(managed.experiment.restoration.mode, "restore")
        assert.equal(managed.experiment.restoration.source.versionId, "release-1")
        assert.equal(managed.experiment.restoration.source.expectedDigest, digest("b"))
    })

    it("restores from an optimization version after the Candidate was released", () => {
        const facts = managedFacts()
        const releasedCandidate = {
            ...facts.candidate,
            state: "released",
            releasedAt: "2026-09-06T09:08:52.808Z",
        }
        const request = experimentRequest({
            operation: "experiment_restore",
            candidate: releasedCandidate,
            initial: initialManaged(facts),
        })

        assert.equal(request.operation, "experiment_restore")
        assert.equal(request.source.versionId, releasedCandidate.id)
        assert.equal(request.experiment.restoration.source.versionId, facts.baseline.id)
        assert.throws(() => experimentRequest({
            candidate: releasedCandidate,
        }), /immutable optimization Candidate/u)
    })

    it("accepts a positive safe Epoch above the former product cap", () => {
        const facts = managedFacts()
        const request = experimentRequest({
            epoch: 101,
            candidate: {...facts.candidate, optimizationEpoch: 101},
            previousCandidate: {...facts.previousCandidate, optimizationEpoch: 100},
        })
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-late-epoch-store-"))
        temporaryDirectories.push(root)
        const store = new SkillInstallationStore(join(root, "installations.json"))
        const job = store.createJob({
            operation: request.operation,
            runtime: {runtimeId: "codex:one", providerId: "codex", displayName: "Codex"},
            request,
        })

        assert.equal(request.experiment.epoch, 101)
        assert.equal(store.getJob(job.id).request.experiment.epoch, 101)
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

    it("validates Candidate rotation, restoration, removal, and recovery using only digests", () => {
        const installed = validateSkillInstallationRegistration(
            successEvidence(experimentRequest()),
            experimentRequest(),
        )
        assert.equal(installed.trusted, true)
        assert.equal(Object.hasOwn(installed.result, "markerAfter"), false)

        const restore = experimentRequest({
            operation: "experiment_restore",
            initial: initialManaged(),
        })
        assert.equal(validateSkillInstallationRegistration(
            successEvidence(restore),
            restore,
        ).trusted, true)

        const remove = experimentRequest({operation: "experiment_remove"})
        assert.equal(validateSkillInstallationRegistration(
            successEvidence(remove),
            remove,
        ).trusted, true)
        assert.throws(() => validateSkillInstallationRegistration(
            successEvidence(remove, {destination: null}),
            remove,
        ), /destination/u)

        const recovery = freezeSkillExperimentRecoveryInspectionRequest(remove)
        assert.equal(validateSkillInstallationRegistration(
            successEvidence(recovery),
            recovery,
        ).trusted, true)
    })

    it("normalizes recovery mismatches only as untrusted terminal evidence", () => {
        const request = experimentRequest({operation: "experiment_remove"})
        const recovered = validateSkillInstallationRegistration({
            ...successEvidence(request),
            status: "needs_recovery",
            classificationBefore: "managed-drifted",
            actualDigest: digest("0"),
            beforeDigest: digest("0"),
            mutationPerformed: false,
            runtimeDiscovered: false,
            error: {code: "EXPERIMENT_TARGET_MISMATCH", message: "Target changed"},
        }, request)
        assert.equal(recovered.status, "needs_recovery")
        assert.equal(recovered.trusted, false)
    })

    it("builds operation-specific marker-free prompts", () => {
        const install = buildSkillInstallationPrompt(experimentRequest(), {
            requestedPermission: "workspace-write",
        })
        assert.match(install, /optimization installation Job/u)
        assert.match(install, /previous Candidate digest/u)
        assert.match(install, /records ownership and recovery state centrally/u)
        assert.match(install, /rolling_skill_installations_register/u)
        assert.doesNotMatch(install, /rolling-skill-managed|rolling-skill-experiment/iu)

        const registrationExample = (prompt) => JSON.parse(
            prompt.match(/Registration arguments:\n(\{[\s\S]*?\})\n(?:Requested permission profile:|$)/u)[1],
        )
        assert.equal(registrationExample(install).actualDigest, digest("d"))
        assert.equal(registrationExample(install).beforeDigest, digest("f"))

        const restore = buildSkillInstallationPrompt(experimentRequest({
            operation: "experiment_restore",
            initial: initialManaged(),
        }))
        assert.equal(registrationExample(restore).actualDigest, digest("b"))
        assert.equal(registrationExample(restore).beforeDigest, digest("d"))

        const remove = buildSkillInstallationPrompt(experimentRequest({
            operation: "experiment_remove",
        }))
        assert.match(remove, /Remove only that exact Candidate target/u)
        assert.match(remove, /needs_recovery/u)
        assert.equal(registrationExample(remove).actualDigest, null)
        assert.equal(registrationExample(remove).beforeDigest, digest("d"))

        const inspection = freezeSkillExperimentRecoveryInspectionRequest(experimentRequest())
        const inspect = buildSkillInstallationPrompt(inspection, {requestedPermission: "read-only"})
        assert.match(inspect, /strictly read-only/u)
        assert.match(inspect, /"operation": "experiment_inspect"/u)
        assert.doesNotMatch(inspect, /Install the exact frozen Candidate/u)
        assert.match(registrationExample(inspect).actualDigest, /null when absent/u)
        assert.match(registrationExample(inspect).beforeDigest, /null when absent/u)
    })

    it("keeps successful experiment Jobs out of the formal installation matrix", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-experiment-store-"))
        temporaryDirectories.push(root)
        const store = new SkillInstallationStore(join(root, "installations.json"))
        const request = experimentRequest()
        const parsed = validateSkillInstallationRegistration(successEvidence(request), request)
        const job = store.createJob({
            operation: request.operation,
            runtime: {runtimeId: "codex:one", providerId: "codex", displayName: "Codex"},
            request,
        })
        store.updateJob(job.id, {status: "running"})
        store.acceptRegistration(job.id, {
            invocationFingerprint: `sha256:${"1".repeat(64)}`,
            parsedResult: parsed,
        })
        store.completeJob(job.id, {status: "succeeded", parsedResult: parsed})

        assert.equal(store.getJob(job.id).operation, "experiment_install")
        assert.deepEqual(store.read().installations, [])
        assert.deepEqual(store.installationMatrix("skill-1"), [])
    })

    it("starts experiment Jobs with the scoped registration tool", async () => {
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
        let executor = null
        const controlPlane = {
            registerInstallationExecutor(registration) {
                executor = registration
                return {unregister() { executor = null; return true }}
            },
            invoke(request) {
                return executor.execute({
                    invocationId: "registration-1",
                    method: request.method,
                    input: request.params,
                })
            },
        }
        const capabilityIds = []
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
                    const client = new AutoRegistrationClient(descriptor, options)
                    clients.push(client)
                    return client
                },
            },
            getRuntimes: () => [runtime],
            workspaceRoot: "/workspace",
            traceDirectory: join(root, "traces"),
            resolvePermission: (_providerId, mode) => ({permissionMode: mode}),
            timeoutMs: 2_000,
            controlPlane,
            capabilities: {
                issue(request) {
                    return {
                        id: "capability-1",
                        token: "secret-token",
                        sessionId: request.sessionId,
                        actions: request.actions,
                    }
                },
                revoke(id) { capabilityIds.push(id); return true },
            },
            controlSocketPath: join(root, "control.sock"),
            installationToolPath: process.execPath,
            transportSupport: () => ({dynamicToolsReady: true}),
        })

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
        assert.equal(clients[0].profile.dynamicTools[0].name, "rolling_skill")
        assert.deepEqual(capabilityIds, ["capability-1"])
        assert.equal(executor, null)
    })
})

class AutoRegistrationClient extends EventEmitter {
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

    async startTurn(threadId, prompt) {
        const turnId = `turn-${++this.sequence}`
        this.emit("notification", {
            method: "turn/started",
            params: {threadId, turn: {id: turnId, status: "inProgress"}},
        })
        setImmediate(async () => {
            try {
                await this.options.requestTool({
                    threadId,
                    turnId,
                    callId: "registration-1",
                    method: "installations.register",
                    params: successEvidence(this.options.installationRequest),
                })
                this.emit("notification", {
                    method: "item/completed",
                    params: {
                        threadId,
                        turnId,
                        item: {id: "message-1", type: "agentMessage", text: "Candidate installed"},
                    },
                })
                this.emit("notification", {
                    method: "turn/completed",
                    params: {threadId, turn: {id: turnId, status: "completed"}},
                })
            } catch (error) {
                this.emit("runtimeError", error)
            }
        })
        assert.match(prompt, /rolling_skill_installations_register/u)
        return {turn: {id: turnId, status: "inProgress"}}
    }

    state() {
        return {status: "ready", traceReference: this.recorder.latestReference}
    }

    async stop() {}
}
