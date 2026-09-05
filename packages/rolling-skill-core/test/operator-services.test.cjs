const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const {
    createManagedWorkspaceResolver,
    createOperatorServices,
    optimizationRuntimeSkillBinding,
    optimizationVersionIdentity,
    optimizationReleasedSkillBinding,
    optimizationApprovalRequest,
} = require("../src/operator-services.cjs")
const coreOptimizationContext = require("../src/optimization-agent-context.cjs")
const desktopOptimizationContext = require(
    "../../../desktop/rolling-skill/src/optimization/optimization-agent-context.cjs",
)

function fixture(options = {}) {
    const calls = []
    const summary = {
        generation: "generation-1",
        revision: 7,
        sessions: [{
            id: "session-1",
            runtime: {
                runtimeId: "codex:one",
                providerId: "codex",
                displayName: "Codex CLI",
                version: "1.2.3",
                executablePath: "/private/bin/codex",
            },
            capabilityId: "capability-secret",
            reasoning: "private chain",
        }],
        jobs: [{id: "job-1", sessionId: "session-1", status: "running"}],
        steps: [],
        approvals: [{
            id: "approval-1",
            jobId: "job-1",
            status: "pending",
            action: options.approvalAction ?? "skills.release",
        }],
        totals: {sessions: 1, jobs: 1, steps: 0, approvals: 1},
        truncated: false,
        nextCursor: null,
    }
    const jobStore = {
        readSummaryPage: (input) => (calls.push(["summary", input]), summary),
        getApproval: (id) => {
            assert.equal(id, "approval-1")
            return structuredClone(summary.approvals[0])
        },
        listArtifacts: () => [{
            id: "artifact-1",
            jobId: "job-1",
            name: "result.json",
            path: "/private/result.json",
            body: "secret body",
            byteLength: 20,
        }],
        readArtifactBody: (id) => (calls.push(["artifact-content", id]), Buffer.from("# Operator result\n\nReview this saved report.")),
    }
    const sessionManager = {
        create: async (input) => (calls.push(["start", input]), {
            session: summary.sessions[0],
            parentJob: summary.jobs[0],
            state: "active",
            childEnvironment: {TOKEN: "secret"},
        }),
        get: (id) => (calls.push(["get", id]), {
            session: summary.sessions[0],
            parentJob: summary.jobs[0],
            state: "active",
        }),
        pause: async (id) => (calls.push(["pause", id]), {state: "paused"}),
        resume: async (id) => (calls.push(["resume", id]), {state: "active"}),
        resumeAfterApproval: async (id) => (calls.push(["resume-approval", id]), {state: "active"}),
        stop: async (id) => (calls.push(["stop", id]), {state: "stopped"}),
        sendMessage: async (id, message) => (calls.push(["send", id, message]), {queued: true}),
    }
    const jobEngine = {
        resolveApproval: async (id, decision) => (
            calls.push(["approve", id, decision]),
            {jobId: "job-1", status: decision.decision === "approve" ? "running" : "failed"}
        ),
    }
    const optimizationStore = {
        listPublicSummaries: () => [{id: "optimization-1", state: "editing", socketPath: "/secret"}],
    }
    const optimizationControl = {
        get: (id) => (calls.push(["optimization-get", id]), {
            run: {id, state: "editing", environment: {TOKEN: "secret"}},
        }),
        preflight: async (input) => (calls.push(["optimization-preflight", input]), {ready: true}),
        start: async (input) => (calls.push(["optimization-start", input]), {run: {id: "optimization-1", state: "editing"}}),
        pause: async (id) => (calls.push(["optimization-pause", id]), {run: {id, state: "paused"}}),
        resume: async (id) => (calls.push(["optimization-resume", id]), {run: {id, state: "editing"}}),
        stop: async (id) => (calls.push(["optimization-stop", id]), {run: {id, state: "cancelled"}}),
        report: (id) => (calls.push(["optimization-report", id]), {report: {
            artifactId: "artifact-2",
            preview: "# Optimization report",
        }}),
    }
    return {
        calls,
        services: createOperatorServices({
            jobStore,
            jobEngine,
            sessionManager,
            optimizationStore,
            optimizationControl,
        }),
    }
}

describe("Rolling Skill Operator services", () => {
    it("connects Optimization stop to the active Evaluation Runner", () => {
        const source = readFileSync(join(__dirname, "../src/operator-services.cjs"), "utf8")
        assert.match(
            source,
            /evaluationManager:\s*\{[\s\S]*run:\s*runEvaluation,[\s\S]*cancel:\s*\(runId/u,
        )
    })

    it("accepts the Epoch-only Optimization config when optional telemetry caps are absent", () => {
        const source = readFileSync(join(__dirname, "../src/operator-services.cjs"), "utf8")
        assert.match(source, /assertOptimizationTelemetrySupport\(config, runtimes\)/u)
        assert.doesNotMatch(source, /config\.telemetry\.(?:tokens|cost)/u)
    })

    it("uses the packaged Desktop optimization objective and phase-message implementation", () => {
        assert.equal(
            coreOptimizationContext.optimizationRequestMessage,
            desktopOptimizationContext.optimizationRequestMessage,
        )
        assert.equal(
            coreOptimizationContext.optimizationTaskObjective,
            desktopOptimizationContext.optimizationTaskObjective,
        )
    })

    it("binds the final approval audit to the exact immutable Candidate on every host", () => {
        assert.deepEqual(optimizationApprovalRequest({
            kind: "release-install",
            parentJobId: "operator-job-1",
            runId: "optimization-run-1",
            epoch: 2,
            candidate: {id: "candidate-v2"},
        }), {
            action: "optimization.release-install",
            risk: "Release the selected immutable Optimization Candidate and install it on every frozen target Runtime",
            scope: {
                runId: "optimization-run-1",
                epoch: 2,
                kind: "release-install",
                versionId: "candidate-v2",
            },
            proposedMutation: {
                runId: "optimization-run-1",
                epoch: 2,
                kind: "release-install",
                versionId: "candidate-v2",
            },
            idempotencyKey: "optimization-run-1:release-install:2:candidate-v2",
        })
    })
    it("normalizes frozen baseline identity and binds its already saved release installation", () => {
        const candidate = optimizationVersionIdentity({versionId: "release-1", skillId: "skill-1", repositoryId: "repo-1", commit: "a".repeat(40), contentDigest: `sha256:${"b".repeat(64)}`})
        assert.equal(candidate.id, "release-1")
        const binding = optimizationReleasedSkillBinding({
            runtimeConfiguration: {runtimeId: "dsh:1", providerId: "deepseek-harness", modelId: "chosen", effort: null},
            repository: {id: "repo-1"}, skill: {id: "skill-1", name: "incident-response-planner"}, candidate,
            installationStore: {resolveVerifiedInstallation(input) {
                assert.deepEqual(input, {repositoryId: "repo-1", skillId: "skill-1", versionId: "release-1", runtimeId: "dsh:1", providerId: "deepseek-harness"})
                return {id: "installation-1", jobId: "install-1", commit: candidate.commit, contentDigest: candidate.contentDigest, destination: "/recorded/skills/incident-response-planner", installedAt: "2026-09-01T00:00:00.000Z", verification: "filesystem-only"}
            }},
        })
        assert.equal(binding.installationJobId, "install-1")
        assert.equal(binding.skillReference.path, "/recorded/skills/incident-response-planner/SKILL.md")
        assert.equal(binding.modelId, "chosen")
        assert.equal(binding.effort, null)
        assert.deepEqual(optimizationVersionIdentity({...candidate}), candidate)
    })
    it("resolves a Skill edit binding before managed and Optimization workspaces", async () => {
        const calls = []
        const resolve = createManagedWorkspaceResolver({
            workspaceManager: {
                get(runId) {
                    calls.push(["optimization", runId])
                    return {
                        runId,
                        repositoryId: "repository-1",
                        skillId: "skill-1",
                        workspacePath: "/private/optimization/run-1",
                    }
                },
            },
            managedSkillStore: {
                getSkill(skillId) {
                    calls.push(["managed", skillId])
                    return {id: skillId, repositoryId: "repository-1"}
                },
            },
            managedSkillManager: {
                repositoryPath(repositoryId) {
                    return `/private/managed/${repositoryId}`
                },
            },
            resolveSkillEditWorkspace(binding) {
                calls.push(["edit", binding.skillEditSessionId])
                return {
                    repositoryId: "repository-1",
                    skillId: "skill-1",
                    skillEditSessionId: "edit-1",
                    workspaceRoot: "/private/skill-edits/edit-1",
                }
            },
        })

        assert.deepEqual(await resolve({
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillEditSessionId: "edit-1",
        }), {
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillEditSessionId: "edit-1",
            workspaceRoot: "/private/skill-edits/edit-1",
        })
        assert.deepEqual(calls, [["edit", "edit-1"]])
    })

    it("freezes each Optimization target's experiment installation path", () => {
        const runtimeConfiguration = {
            runtimeId: "codex:one",
            providerId: "codex",
            displayName: "Codex",
            executablePath: "/opt/codex",
        }
        const candidate = {
            id: "candidate-1",
            repositoryId: "repository-1",
            skillId: "skill-1",
            commit: "a".repeat(40),
            contentDigest: `sha256:${"b".repeat(64)}`,
        }
        const binding = optimizationRuntimeSkillBinding({
            runtimeConfiguration,
            repository: {id: "repository-1"},
            skill: {id: "skill-1", name: "billing", description: "Billing"},
            candidate,
            installationJob: {
                id: "experiment-job-1",
                status: "succeeded",
                runtime: {runtimeId: "codex:one", providerId: "codex"},
                request: {
                    purpose: "optimization-experiment",
                    source: {
                        repositoryId: "repository-1",
                        skillId: "skill-1",
                        versionId: "candidate-1",
                        commit: "a".repeat(40),
                        expectedDigest: `sha256:${"b".repeat(64)}`,
                    },
                },
                parsedResult: {
                    trusted: true,
                    destination: "/experiments/codex/billing",
                    verification: "runtime-inventory",
                },
                completedAt: "2026-08-26T00:00:00.000Z",
            },
        })

        assert.equal(binding.skillReference.path, "/experiments/codex/billing/SKILL.md")
        assert.equal(binding.skillReference.runtimeId, "codex:one")
        assert.equal(binding.installationJobId, "experiment-job-1")
        assert.equal(binding.expectedContentDigest, candidate.contentDigest)
    })

    it("returns bounded public summaries without capabilities, paths, environment, or reasoning", () => {
        const {services} = fixture()
        const summary = services.operatorSummary({limit: 20})
        const artifacts = services.operatorArtifacts({jobId: "job-1"})
        assert.equal(summary.sessions[0].runtime.displayName, "Codex CLI")
        assert.doesNotMatch(JSON.stringify({summary, artifacts}), /capability|executablePath|private|reasoning|body|TOKEN|socket/iu)
    })

    it("opens an artifact by its owning Job and persisted id without accepting a filesystem path", () => {
        const {services} = fixture()
        const preview = services.operatorArtifact({jobId: "job-1", artifactId: "artifact-1"})
        assert.match(preview.preview, /Operator result/)
        assert.equal(preview.truncated, false)
        assert.throws(() => services.operatorArtifact({jobId: "job-1", artifactId: "unknown"}), /not found/)
        assert.throws(() => services.operatorArtifact({jobId: "job-1", artifactId: "artifact-1", path: "/etc/passwd"}), /unsupported field/)
        assert.doesNotMatch(JSON.stringify(preview), /\/private/)
    })

    it("starts and controls an Operator session without accepting renderer-owned executable paths", async () => {
        const {calls, services} = fixture()
        await assert.rejects(() => services.operatorStart({
            runtimeId: "codex:one",
            objective: "Refresh stale Cases",
            executablePath: "/tmp/forged",
        }), /unsupported field/iu)
        await services.operatorStart({
            runtimeId: "codex:one",
            modelId: "gpt-5.6-sol",
            effort: "high",
            objective: "Refresh stale Cases",
            actions: ["datasets.read"],
            scopes: {datasetIds: ["dataset-1"]},
            budget: {maxDurationMs: 60_000},
        })
        await services.operatorPause({sessionId: "session-1"})
        await services.operatorResume({sessionId: "session-1"})
        await services.operatorSend({sessionId: "session-1", text: "Continue"})
        await services.operatorCancel({sessionId: "session-1"})
        assert.deepEqual(calls.filter(([kind]) => ["start", "pause", "resume", "send", "stop"].includes(kind)).map(([kind]) => kind), [
            "start", "pause", "resume", "send", "stop",
        ])
    })

    it("resolves approvals and exposes restart recovery through session resume", async () => {
        const {calls, services} = fixture()
        await services.operatorApprove({
            sessionId: "session-1",
            approvalId: "approval-1",
            decision: "approve",
            scope: "once",
        })
        assert.deepEqual(calls.slice(-2).map(([kind]) => kind), ["approve", "resume-approval"])
    })

    it("lets the Optimization Runner continue a final approval without restarting the Agent Runtime", async () => {
        const {calls, services} = fixture({approvalAction: "optimization.release-install"})
        await services.operatorApprove({
            sessionId: "session-1",
            approvalId: "approval-1",
            decision: "approve",
            scope: "once",
        })
        assert.deepEqual(calls.filter(([kind]) => ["approve", "resume-approval"].includes(kind)), [[
            "approve",
            "approval-1",
            {decision: "approve", scope: "once", decidedBy: "dsh-user"},
        ]])
    })

    it("controls Optimization runs through public DTOs", async () => {
        const {calls, services} = fixture()
        assert.deepEqual(services.optimizationList(), [{id: "optimization-1", state: "editing"}])
        assert.equal((await services.optimizationStart({mode: "adaptive"})).run.id, "optimization-1")
        await services.optimizationPause({runId: "optimization-1"})
        await services.optimizationResume({runId: "optimization-1"})
        await services.optimizationCancel({runId: "optimization-1"})
        const report = services.optimizationReport({runId: "optimization-1"}).report
        assert.equal(report.artifactId, "artifact-2")
        assert.equal(report.preview, "# Optimization report")
        assert.deepEqual(calls.filter(([kind]) => kind.startsWith("optimization-")).map(([kind]) => kind), [
            "optimization-start",
            "optimization-pause",
            "optimization-resume",
            "optimization-stop",
            "optimization-report",
        ])
    })
})
