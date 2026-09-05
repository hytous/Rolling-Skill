const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CONTROL_METHODS,
    INSTALLATION_AGENT_CONTROL_METHODS,
    OPERATOR_CONTROL_METHODS,
    METHOD_DEFINITIONS,
    controlDefinition,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
    parseControlInput,
    parseControlOutput,
    publicControlError,
} = require("../src/control-plane/contracts.cjs")
const {
    decodeSkillVersionCursor,
    encodeSkillVersionCursor,
} = require("../src/managed-skill-version-cursor.cjs")

const rawCase = {
    question: "Which service caused the July cost increase?",
    skill: {
        id: "skill-billing",
        name: "billing-cost-management",
        path: "/skills/billing/SKILL.md",
    },
    note: "Compare with June",
    source: {kind: "operator"},
}

const runtime = {
    runtimeId: "codex:local",
    modelId: "gpt-5.6-sol",
    effort: "high",
}

const optimizationConfig = {
    skillId: "skill-1",
    baselineVersionId: "version-1",
    datasetId: "dataset-1",
    operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
    targets: [{runtimeId: "codex:local", modelId: "gpt-5.6-sol", effort: "high"}],
    judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "high"},
    activationMode: "automatic",
    limits: {maxEpochs: 3},
}

const legacyOptimizationConfig = {
    ...optimizationConfig,
    mode: "adaptive",
    limits: {
        maxEpochs: 3,
        maxDurationMs: 3_600_000,
        patience: 2,
        minimumImprovement: 1,
        maxTurns: 50,
        maxTokens: null,
        maxCostMicros: null,
    },
    target: {minimumScore: 90, minimumPassRate: 1, requireCriticalCases: true},
    telemetry: {tokens: false, cost: false},
}

const optimizationRun = {
    id: "optimization-run-1",
    state: "editing",
    revision: 2,
    currentEpoch: 1,
    snapshotDigest: `sha256:${"a".repeat(64)}`,
    baseline: {repositoryId: "repository-1", skillId: "skill-1", versionId: "version-1"},
    dataset: {id: "dataset-1", revision: 7},
    rubric: {id: "rubric-1", version: 4},
    operator: optimizationConfig.operator,
    targets: optimizationConfig.targets,
    judge: optimizationConfig.judge,
    activationMode: optimizationConfig.activationMode,
    limits: optimizationConfig.limits,
    epochs: [{number: 1, status: "editing", candidateArtifactId: null}],
    checkpoint: {paused: false},
    error: null,
}

const validInputs = {
    "context.get": {},
    "raw_cases.list": {skillName: "billing", limit: 20},
    "raw_cases.enqueue": {cases: [rawCase], idempotencyKey: "enqueue-1"},
    "raw_cases.update": {
        id: "raw-case-1",
        changes: {question: "Updated question", note: "Updated note"},
        idempotencyKey: "update-1",
    },
    "raw_cases.dispatch": {
        id: "raw-case-1",
        mode: "new",
        runtime,
        idempotencyKey: "dispatch-1",
    },
    "runtimes.list": {},
    "runtimes.models": {runtimeId: "codex:local"},
    "datasets.list": {},
    "datasets.get": {datasetId: "dataset-1"},
    "datasets.create": {
        name: "Billing",
        repositoryId: "repository-1",
        skillId: "skill-1",
        idempotencyKey: "dataset-create-1",
    },
    "datasets.clone": {
        sourceDatasetId: "dataset-1",
        name: "Billing clone",
        caseIds: ["case-1", "case-2"],
        idempotencyKey: "dataset-clone-1",
    },
    "datasets.delete": {datasetId: "dataset-1", idempotencyKey: "dataset-delete-1"},
    "datasets.delete_case": {
        datasetId: "dataset-1",
        caseId: "case-1",
        idempotencyKey: "case-delete-1",
    },
    "evaluations.list": {datasetId: "dataset-1"},
    "evaluations.get": {runId: "run-1"},
    "evaluations.start": {
        datasetId: "dataset-1",
        caseIds: ["case-1"],
        selectionMode: "selected",
        activationMode: "automatic",
        runtimeConfigurations: [runtime],
        judgeConfiguration: {runtimeId: "codex:judge"},
        idempotencyKey: "evaluation-1",
    },
    "evaluations.cancel": {runId: "run-1", idempotencyKey: "cancel-1"},
    "skill_repositories.list": {},
    "skills.list": {},
    "skill_versions.list": {},
    "skills.get": {skillId: "skill-1"},
    "skills.diff": {
        repositoryId: "repository-1",
        skillId: "skill-1",
        baseVersionId: "version-1",
        candidateVersionId: "version-2",
    },
    "skills.create_candidate": {
        repositoryId: "repository-1",
        skillId: "skill-1",
        message: "Improve billing guidance",
        idempotencyKey: "candidate-1",
    },
    "skills.release": {
        repositoryId: "repository-1",
        skillId: "skill-1",
        versionId: "version-2",
        versionLabel: "v1.1.0",
        idempotencyKey: "release-1",
    },
    "jobs.get": {jobId: "job-1"},
    "jobs.list": {},
    "jobs.pause": {jobId: "job-1", idempotencyKey: "pause-1"},
    "jobs.resume": {jobId: "job-1", idempotencyKey: "resume-1"},
    "jobs.stop": {jobId: "job-1", idempotencyKey: "stop-1"},
    "approvals.list": {},
    "approvals.resolve": {
        approvalId: "approval-1",
        decision: "approve",
        idempotencyKey: "approval-resolve-1",
    },
    "curation.start": {
        datasetId: "dataset-1",
        caseType: "badcase",
        sourceThreadId: "thread-1",
        startItemId: "item-1",
        endItemId: "item-2",
        issueDescription: "The answer skipped the owner breakdown.",
        idempotencyKey: "curation-start-1",
    },
    "curation.message": {
        sessionId: "curation-1",
        message: "Preserve the original failure mode.",
        idempotencyKey: "curation-message-1",
    },
    "curation.save": {sessionId: "curation-1", idempotencyKey: "curation-save-1"},
    "curation.discard": {sessionId: "curation-1", idempotencyKey: "curation-discard-1"},
    "rubrics.publish": {
        datasetId: "dataset-1",
        sessionId: "rubric-1",
        idempotencyKey: "rubric-publish-1",
    },
    "installations.start": {
        repositoryId: "repository-1",
        skillId: "skill-1",
        versionId: "version-1",
        targets: [{runtimeId: "codex:local", modelId: "gpt-5.6-sol", effort: "high"}],
        idempotencyKey: "install-start-1",
    },
    "installations.get": {installationId: "installation-1"},
    "installations.cancel": {
        installationId: "installation-1",
        idempotencyKey: "install-cancel-1",
    },
    "installations.inspect": {
        installationId: "installation-1",
        idempotencyKey: "install-inspect-1",
    },
    "installations.register": {
        status: "succeeded",
        operation: "install",
        classificationBefore: "unmanaged",
        destination: "/runtime/skills/billing",
        actualDigest: `sha256:${"a".repeat(64)}`,
        beforeDigest: `sha256:${"b".repeat(64)}`,
        mutationPerformed: true,
        runtimeDiscovered: true,
        warnings: [],
        error: null,
    },
    "optimization.preflight": {...optimizationConfig, idempotencyKey: "optimization-preflight-1"},
    "optimization.start": {...optimizationConfig, idempotencyKey: "optimization-start-1"},
    "optimization.get": {runId: "optimization-run-1"},
    "optimization.pause": {runId: "optimization-run-1", idempotencyKey: "optimization-pause-1"},
    "optimization.resume": {runId: "optimization-run-1", idempotencyKey: "optimization-resume-1"},
    "optimization.stop": {runId: "optimization-run-1", idempotencyKey: "optimization-stop-1"},
    "optimization.submit_candidate": {
        runId: "optimization-run-1",
        message: "Improve billing guidance",
        idempotencyKey: "optimization-candidate-1",
    },
    "optimization.submit_decision": {
        runId: "optimization-run-1",
        decision: {
            schemaVersion: "rolling-skill-optimization-decision/v1",
            action: "continue",
            rationale: "Continue after the first Epoch",
            observations: [],
        },
        idempotencyKey: "optimization-decision-1",
    },
    "optimization.report": {runId: "optimization-run-1", idempotencyKey: "optimization-report-1"},
}

const validOutputs = {
    "context.get": {workspaceRoot: "/workspace", runtimes: []},
    "raw_cases.list": {rawCases: [], nextCursor: null},
    "raw_cases.enqueue": {created: [], duplicates: [], rejected: []},
    "raw_cases.update": {
        rawCase: {id: "raw-case-1", skill: {id: "skill-1", name: "billing"}},
    },
    "raw_cases.dispatch": {threadId: "thread-1", turnId: null},
    "runtimes.list": {runtimes: []},
    "runtimes.models": {models: []},
    "datasets.list": {datasets: [], nextCursor: null},
    "datasets.get": {
        dataset: {id: "dataset-1"},
        cases: [{
            id: "case-1",
            datasetId: "dataset-1",
            title: "July billing",
            label: "goodcase",
            inputSummary: "Find the July total",
            outputSummary: "The verified total is summarized",
            artifactRefs: [{id: "artifact-case-1", kind: "case-summary"}],
        }],
    },
    "datasets.create": {dataset: {id: "dataset-1"}},
    "datasets.clone": {
        dataset: {id: "dataset-clone"},
        cases: [
            {id: "case-clone-1", datasetId: "dataset-clone"},
            {id: "case-clone-2", datasetId: "dataset-clone"},
        ],
        rubricCopied: true,
    },
    "datasets.delete": {dataset: {id: "dataset-1"}},
    "datasets.delete_case": {case: {id: "case-1", datasetId: "dataset-1"}},
    "evaluations.list": {runs: [], nextCursor: null},
    "evaluations.get": {run: {id: "run-1", datasetId: "dataset-1", status: "completed"}},
    "evaluations.start": {run: {id: "run-1", datasetId: "dataset-1", status: "queued"}},
    "evaluations.cancel": {run: {id: "run-1", datasetId: "dataset-1", status: "cancelled"}},
    "skill_repositories.list": {repositories: [], nextCursor: null},
    "skills.list": {repositories: [], skills: [], nextCursor: null},
    "skill_versions.list": {versions: [], nextCursor: null},
    "skills.get": {skill: {id: "skill-1"}},
    "skills.diff": {
        diff: {
            skillId: "skill-1",
            repositoryId: "repository-1",
            baseVersionId: "version-1",
            candidateVersionId: "version-2",
            changed: true,
        },
    },
    "skills.create_candidate": {version: {id: "version-2", repositoryId: "repository-1", skillId: "skill-1"}},
    "skills.release": {version: {id: "version-2", repositoryId: "repository-1", skillId: "skill-1"}},
    "jobs.get": {job: {id: "job-1", sessionId: "operator-1", status: "running"}},
    "jobs.list": {jobs: [], nextCursor: null},
    "jobs.pause": {job: {id: "job-1", sessionId: "operator-1", status: "paused"}},
    "jobs.resume": {job: {id: "job-1", sessionId: "operator-1", status: "running"}},
    "jobs.stop": {job: {id: "job-1", sessionId: "operator-1", status: "cancelled"}},
    "approvals.list": {approvals: [], nextCursor: null},
    "approvals.resolve": {
        approval: {id: "approval-1", jobId: "job-1", sessionId: "operator-1", status: "approved"},
        execution: {status: "succeeded", jobId: "job-1", stepId: "step-1"},
    },
    "curation.start": {session: {id: "curation-1", datasetId: "dataset-1", status: "queued"}},
    "curation.message": {session: {id: "curation-1", datasetId: "dataset-1", status: "running"}},
    "curation.save": {
        session: {id: "curation-1", datasetId: "dataset-1", status: "archived"},
        case: {id: "case-1", datasetId: "dataset-1"},
    },
    "curation.discard": {session: {id: "curation-1", datasetId: "dataset-1", status: "cancelled"}},
    "rubrics.publish": {version: {id: "rubric-version-1", datasetId: "dataset-1"}},
    "installations.start": {
        installations: [{id: "installation-1", status: "queued", repositoryId: "repository-1", skillId: "skill-1", runtimeId: "codex:local"}],
    },
    "installations.get": {
        installation: {id: "installation-1", status: "running", repositoryId: "repository-1", skillId: "skill-1", runtimeId: "codex:local"},
    },
    "installations.cancel": {
        installation: {id: "installation-1", status: "cancelled", repositoryId: "repository-1", skillId: "skill-1", runtimeId: "codex:local"},
    },
    "installations.inspect": {
        installation: {id: "inspection-1", status: "queued", repositoryId: "repository-1", skillId: "skill-1", runtimeId: "codex:local"},
    },
    "installations.register": {
        accepted: true,
        duplicate: false,
    },
    "optimization.preflight": {
        snapshotDigest: optimizationRun.snapshotDigest,
        baseline: optimizationRun.baseline,
        dataset: optimizationRun.dataset,
        rubric: optimizationRun.rubric,
        targets: optimizationRun.targets,
        ready: true,
    },
    "optimization.start": {run: optimizationRun},
    "optimization.get": {run: optimizationRun},
    "optimization.pause": {run: optimizationRun},
    "optimization.resume": {run: optimizationRun},
    "optimization.stop": {run: optimizationRun},
    "optimization.submit_candidate": {
        accepted: {runId: "optimization-run-1", kind: "candidate"},
    },
    "optimization.submit_decision": {
        accepted: {runId: "optimization-run-1", kind: "decision"},
    },
    "optimization.report": {
        report: {
            artifactId: "optimization-report-1",
            digest: `sha256:${"b".repeat(64)}`,
            mediaType: "text/markdown; charset=utf-8",
        },
    },
}

describe("control-plane contracts", () => {
    it("keeps Optimization recovery installation evidence marker-free", () => {
        const recoveryTarget = {
            runtimeId: "codex:target",
            status: "needs_recovery",
            installationJobId: "installation-1",
            operation: "experiment_restore",
            destination: "/runtime/skills/billing",
            lastVerifiedDigest: `sha256:${"c".repeat(64)}`,
        }
        assert.doesNotThrow(() => parseControlOutput("optimization.get", {
            run: {
                ...optimizationRun,
                checkpoint: {paused: false, recoveryTargets: [recoveryTarget]},
            },
        }))
        assert.throws(() => parseControlOutput("optimization.get", {
            run: {
                ...optimizationRun,
                checkpoint: {
                    paused: false,
                    recoveryTargets: [{
                        ...recoveryTarget,
                        lastVerifiedMarker: {runId: "run-1"},
                    }],
                },
            },
        }), /lastVerifiedMarker|unrecognized/iu)
    })

    it("defines the complete initial method and action inventory", () => {
        assert.deepEqual(CONTROL_METHODS, Object.keys(validInputs))
        assert.ok(CONTROL_METHODS.includes("evaluations.start"))
        assert.deepEqual(
            Object.fromEntries(CONTROL_METHODS.map((method) => [method, controlDefinition(method).action])),
            {
                "context.get": "context.read",
                "raw_cases.list": "raw_cases.read",
                "raw_cases.enqueue": "raw_cases.write",
                "raw_cases.update": "raw_cases.write",
                "raw_cases.dispatch": "runtime.execute",
                "runtimes.list": "runtimes.read",
                "runtimes.models": "runtimes.read",
                "datasets.list": "datasets.read",
                "datasets.get": "datasets.read",
                "datasets.create": "datasets.write",
                "datasets.clone": "datasets.write",
                "datasets.delete": "datasets.delete",
                "datasets.delete_case": "datasets.delete",
                "evaluations.list": "evaluations.read",
                "evaluations.get": "evaluations.read",
                "evaluations.start": "evaluations.execute",
                "evaluations.cancel": "evaluations.execute",
                "skill_repositories.list": "skills.read",
                "skills.list": "skills.read",
                "skill_versions.list": "skills.read",
                "skills.get": "skills.read",
                "skills.diff": "skills.read",
                "skills.create_candidate": "skills.write",
                "skills.release": "skills.release",
                "jobs.get": "jobs.read",
                "jobs.list": "jobs.read",
                "jobs.pause": "jobs.control",
                "jobs.resume": "jobs.control",
                "jobs.stop": "jobs.control",
                "approvals.list": "approvals.read",
                "approvals.resolve": "approvals.resolve",
                "curation.start": "curation.write",
                "curation.message": "curation.write",
                "curation.save": "curation.write",
                "curation.discard": "curation.write",
                "rubrics.publish": "rubrics.publish",
                "installations.start": "installations.execute",
                "installations.get": "installations.read",
                "installations.cancel": "installations.execute",
                "installations.inspect": "installations.execute",
                "installations.register": "installations.register",
                "optimization.preflight": "optimizations.read",
                "optimization.start": "optimizations.execute",
                "optimization.get": "optimizations.read",
                "optimization.pause": "optimizations.control",
                "optimization.resume": "optimizations.control",
                "optimization.stop": "optimizations.control",
                "optimization.submit_candidate": "optimizations.execute",
                "optimization.submit_decision": "optimizations.execute",
                "optimization.report": "optimizations.read",
            },
        )
        assert.deepEqual(Object.keys(METHOD_DEFINITIONS), CONTROL_METHODS)
    })

    it("freezes every method definition against action and schema replacement", () => {
        assert.ok(Object.isFrozen(METHOD_DEFINITIONS))
        for (const method of CONTROL_METHODS) {
            const definition = controlDefinition(method)
            const {action, input, output, operatorExposed} = definition

            assert.ok(Object.isFrozen(definition), `${method} definition should be frozen`)
            assert.equal(typeof operatorExposed, "boolean", `${method} exposure must be explicit`)
            assert.equal(Reflect.set(definition, "action", "context.read"), false)
            assert.equal(Reflect.set(definition, "input", null), false)
            assert.equal(Reflect.deleteProperty(definition, "output"), false)
            assert.equal(Reflect.set(METHOD_DEFINITIONS, method, {}), false)
            assert.equal(controlDefinition(method).action, action)
            assert.equal(controlDefinition(method).input, input)
            assert.equal(controlDefinition(method).output, output)
            assert.equal(controlDefinition(method).operatorExposed, operatorExposed)
        }
    })

    it("keeps human decisions, session lifecycle, and repository bodies out of Operator Tools", () => {
        const uiOnly = [
            "approvals.resolve",
            "jobs.pause",
            "jobs.resume",
            "jobs.stop",
            "optimization.preflight",
            "optimization.start",
            "optimization.pause",
            "optimization.resume",
            "optimization.stop",
            "skills.get",
            "installations.register",
        ]
        assert.deepEqual(
            CONTROL_METHODS.filter((method) => !controlDefinition(method).operatorExposed).sort(),
            uiOnly.sort(),
        )
        assert.deepEqual(
            OPERATOR_CONTROL_METHODS,
            CONTROL_METHODS.filter((method) => !uiOnly.includes(method)),
        )
        assert.deepEqual(INSTALLATION_AGENT_CONTROL_METHODS, ["installations.register"])
        assert.equal(OPERATOR_CONTROL_METHODS.includes("installations.register"), false)
    })

    it("accepts only evidence for the private installation Agent registration method", () => {
        assert.deepEqual(
            parseControlInput("installations.register", validInputs["installations.register"]),
            validInputs["installations.register"],
        )
        for (const forbiddenField of ["runtimeId", "skillId", "repositoryId", "versionId", "jobId"]) {
            assert.throws(
                () => parseControlInput("installations.register", {
                    ...validInputs["installations.register"],
                    [forbiddenField]: "agent-must-not-bind-identity",
                }),
                new RegExp(`${forbiddenField}|unrecognized`, "iu"),
            )
        }
    })

    it("rejects unknown methods before attempting to parse input or output", () => {
        for (const method of ["unknown.method", "toString", "constructor", "__proto__"]) {
            assert.throws(() => controlDefinition(method), /Unknown control method/u)
            assert.throws(() => parseControlInput(method, {}), /Unknown control method/u)
            assert.throws(() => parseControlOutput(method, {}), /Unknown control method/u)
        }
    })

    it("rejects undefined instead of treating it as an empty input object", () => {
        for (const method of [
            "context.get",
            "raw_cases.list",
            "datasets.list",
            "evaluations.list",
            "skill_repositories.list",
            "skills.list",
            "skill_versions.list",
        ]) {
            assert.throws(() => parseControlInput(method, undefined), /object|undefined/iu)
        }
    })

    it("applies pagination defaults and preserves valid filters", () => {
        assert.deepEqual(parseControlInput("raw_cases.list", {
            skillName: "billing",
            limit: 20,
        }), {
            skillName: "billing",
            cursor: null,
            limit: 20,
        })
        assert.deepEqual(parseControlInput("datasets.list", {}), {
            cursor: null,
            limit: 50,
        })
        assert.deepEqual(parseControlInput("evaluations.list", {}), {
            cursor: null,
            limit: 50,
            datasetId: null,
        })
        assert.deepEqual(parseControlInput("datasets.get", {datasetId: "dataset-1"}), {
            datasetId: "dataset-1",
            includeCases: false,
        })
        assert.deepEqual(parseControlInput("skill_versions.list", {}), {
            skillId: null,
            cursor: null,
            limit: 50,
        })
        assert.deepEqual(parseControlInput("skill_repositories.list", {}), {
            cursor: null,
            limit: 50,
        })
    })

    it("bounds page limits and accepts only opaque base64url sequence cursors", () => {
        const cursor = encodeCursor(42)
        assert.equal(decodeCursor(cursor), 42)
        assert.deepEqual(parseControlInput("skills.list", {cursor, limit: 100}), {
            cursor,
            limit: 100,
        })

        for (const limit of [0, 101, 500, 1.5, "20"]) {
            assert.throws(() => parseControlInput("raw_cases.list", {limit}), /limit/u)
        }
        for (const invalidCursor of ["42", "***", "", "LTE", "MDE", "e30"]) {
            assert.throws(
                () => parseControlInput("datasets.list", {cursor: invalidCursor}),
                /cursor/u,
            )
        }
        assert.throws(() => encodeCursor(-1), /sequence/u)
        assert.throws(() => encodeCursor(Number.MAX_SAFE_INTEGER + 1), /sequence/u)
        assert.throws(() => decodeCursor("not-a-sequence"), /cursor/u)
    })

    it("uses a revision-bound cursor only for managed Skill version pages", () => {
        const revision = "01234567-89ab-4def-8123-456789abcdef"
        const cursor = encodeSkillVersionCursor({revision, sequence: 42})

        assert.deepEqual(decodeSkillVersionCursor(cursor), {revision, sequence: 42})
        assert.deepEqual(parseControlInput("skill_versions.list", {
            cursor,
            limit: 100,
            skillId: "skill-1",
        }), {
            cursor,
            limit: 100,
            skillId: "skill-1",
        })
        assert.throws(() => parseControlInput("skills.list", {cursor}), /cursor/u)
        assert.throws(
            () => parseControlInput("skill_versions.list", {cursor: encodeCursor(42)}),
            /cursor/u,
        )
        assert.throws(
            () => parseControlOutput("skill_versions.list", {versions: [], nextCursor: encodeCursor(1)}),
            /cursor/u,
        )
    })

    it("accepts representative input for every initial method", () => {
        for (const method of CONTROL_METHODS) {
            assert.doesNotThrow(
                () => parseControlInput(method, validInputs[method]),
                `${method} should accept its representative input`,
            )
        }
    })

    it("uses Epoch-only Optimization inputs while retaining legacy config and run compatibility", () => {
        const compact = parseControlInput("optimization.start", validInputs["optimization.start"])
        assert.deepEqual(compact.limits, {maxEpochs: 3})
        for (const field of ["mode", "target", "telemetry"]) {
            assert.equal(Object.hasOwn(compact, field), false)
            assert.equal(Object.hasOwn(optimizationRun, field), false)
        }
        assert.doesNotThrow(() => parseControlInput("optimization.preflight", {
            ...legacyOptimizationConfig,
            idempotencyKey: "legacy-optimization-preflight",
        }))
        assert.doesNotThrow(() => parseControlOutput("optimization.get", {
            run: {
                ...optimizationRun,
                mode: legacyOptimizationConfig.mode,
                limits: legacyOptimizationConfig.limits,
                target: legacyOptimizationConfig.target,
                telemetry: legacyOptimizationConfig.telemetry,
            },
        }))
        assert.throws(() => parseControlInput("optimization.submit_decision", {
            ...validInputs["optimization.submit_decision"],
            limitRequest: {maxTurns: 100},
        }), /limitRequest|unrecognized/iu)
    })

    it("requires an idempotency key on every expanded mutation", () => {
        for (const method of [
            "datasets.create",
            "datasets.clone",
            "datasets.delete",
            "datasets.delete_case",
            "skills.create_candidate",
            "skills.release",
            "jobs.pause",
            "jobs.resume",
            "jobs.stop",
            "approvals.resolve",
            "curation.start",
            "curation.message",
            "curation.save",
            "curation.discard",
            "rubrics.publish",
            "installations.start",
            "installations.cancel",
            "installations.inspect",
            "optimization.start",
            "optimization.pause",
            "optimization.resume",
            "optimization.stop",
            "optimization.submit_candidate",
            "optimization.submit_decision",
            "optimization.report",
        ]) {
            const {idempotencyKey: _idempotencyKey, ...withoutKey} = validInputs[method]
            assert.throws(
                () => parseControlInput(method, withoutKey),
                /idempotencyKey|invalid control input/iu,
                `${method} must require idempotencyKey`,
            )
        }
    })

    it("rejects unknown keys on every method input and on nested objects", () => {
        for (const method of CONTROL_METHODS) {
            assert.throws(
                () => parseControlInput(method, {...validInputs[method], unexpected: true}),
                /unexpected|unrecognized/i,
                `${method} should reject unknown keys`,
            )
        }
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                ...validInputs["raw_cases.enqueue"],
                cases: [{...rawCase, skill: {...rawCase.skill, unexpected: true}}],
            }),
            /unexpected|unrecognized/i,
        )
        assert.throws(
            () => parseControlInput("raw_cases.dispatch", {
                ...validInputs["raw_cases.dispatch"],
                runtime: {...runtime, executablePath: "/bin/codex"},
            }),
            /executablePath|unrecognized/i,
        )
    })

    it("accepts an optional stable Skill id on Raw Case writes", () => {
        const parsed = parseControlInput("raw_cases.enqueue", {
            cases: [{
                ...rawCase,
                skill: {id: "skill-billing", name: "billing-cost-management"},
            }],
            idempotencyKey: "enqueue-stable-skill",
        })

        assert.deepEqual(parsed.cases[0].skill, {
            id: "skill-billing",
            name: "billing-cost-management",
        })
        assert.deepEqual(parseControlInput("raw_cases.update", {
            id: "raw-case-1",
            changes: {skill: {id: "skill-billing", name: "billing-cost-management"}},
            idempotencyKey: "update-stable-skill",
        }).changes.skill, {
            id: "skill-billing",
            name: "billing-cost-management",
        })
    })

    it("enforces identifier, Raw Case, and batch limits", () => {
        assert.throws(
            () => parseControlInput("datasets.get", {datasetId: "x".repeat(201)}),
            /datasetId|200/u,
        )
        assert.throws(
            () => parseControlInput("evaluations.cancel", {
                runId: "run-1",
                idempotencyKey: " ",
            }),
            /idempotencyKey/u,
        )
        assert.throws(
            () => parseControlInput("datasets.clone", {
                ...validInputs["datasets.clone"],
                caseIds: [],
            }),
            /caseIds/u,
        )
        assert.throws(
            () => parseControlInput("datasets.clone", {
                ...validInputs["datasets.clone"],
                caseIds: ["case-1", "case-1"],
            }),
            /caseIds|unique/u,
        )
        assert.throws(
            () => parseControlInput("datasets.clone", {
                ...validInputs["datasets.clone"],
                caseIds: Array.from({length: 101}, (_value, index) => `case-${index}`),
            }),
            /caseIds/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: [],
                idempotencyKey: "enqueue-1",
            }),
            /cases/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: Array.from({length: 201}, () => rawCase),
                idempotencyKey: "enqueue-1",
            }),
            /cases/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: [{...rawCase, question: "x".repeat(120_001)}],
                idempotencyKey: "enqueue-1",
            }),
            /question/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: [{...rawCase, skill: {name: "x".repeat(201)}}],
                idempotencyKey: "enqueue-1",
            }),
            /name/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: [{...rawCase, note: "x".repeat(10_001)}],
                idempotencyKey: "enqueue-1",
            }),
            /note/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.enqueue", {
                cases: [{...rawCase, source: {kind: "x".repeat(201)}}],
                idempotencyKey: "enqueue-1",
            }),
            /kind/u,
        )
    })

    it("requires non-empty Raw Case updates and valid runtime profiles", () => {
        assert.throws(
            () => parseControlInput("raw_cases.update", {
                id: "raw-case-1",
                changes: {},
                idempotencyKey: "update-1",
            }),
            /changes/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.dispatch", {
                ...validInputs["raw_cases.dispatch"],
                mode: "reuse",
            }),
            /mode/u,
        )
        assert.throws(
            () => parseControlInput("raw_cases.dispatch", {
                ...validInputs["raw_cases.dispatch"],
                runtime: {...runtime, effort: "impossible"},
            }),
            /effort/u,
        )
        assert.deepEqual(parseControlInput("raw_cases.dispatch", {
            id: "raw-case-1",
            mode: "current",
            runtime: {runtimeId: "codex:local"},
            idempotencyKey: "dispatch-1",
        }).runtime, {
            runtimeId: "codex:local",
            modelId: null,
            effort: null,
        })
    })

    it("validates evaluation selection, runtime, judge, and idempotency input", () => {
        assert.throws(
            () => parseControlInput("evaluations.start", {
                ...validInputs["evaluations.start"],
                selectionMode: "selected",
                caseIds: [],
            }),
            /caseIds|selected/u,
        )
        assert.throws(
            () => parseControlInput("evaluations.start", {
                ...validInputs["evaluations.start"],
                activationMode: "prompted",
            }),
            /activationMode/u,
        )
        assert.throws(
            () => parseControlInput("evaluations.start", {
                ...validInputs["evaluations.start"],
                runtimeConfigurations: [],
            }),
            /runtimeConfigurations/u,
        )
        assert.throws(
            () => parseControlInput("evaluations.start", {
                ...validInputs["evaluations.start"],
                runtimeConfigurations: [runtime, runtime],
            }),
            /runtimeConfigurations|runtimeId|unique/u,
        )
        assert.throws(
            () => parseControlInput("evaluations.start", {
                ...validInputs["evaluations.start"],
                judgeConfiguration: {runtimeId: "codex:judge", token: "secret"},
            }),
            /token|unrecognized/i,
        )
    })

    it("parses representative strict output for every initial method", () => {
        for (const method of CONTROL_METHODS) {
            assert.deepEqual(parseControlOutput(method, validOutputs[method]), validOutputs[method])
            assert.throws(
                () => parseControlOutput(method, {...validOutputs[method], unexpected: true}),
                /unexpected|unrecognized/i,
                `${method} should reject unknown output keys`,
            )
        }
    })

    it("rejects private Dataset Case and Evaluation payloads at the public contract", () => {
        const safeCase = validOutputs["datasets.get"].cases[0]
        for (const forbidden of [
            {traceReference: "/private/trace.jsonl"},
            {skillPath: "/private/skill"},
            {messages: [{role: "assistant", text: "private"}]},
            {toolEvidence: {raw: "private"}},
        ]) {
            assert.throws(() => parseControlOutput("datasets.get", {
                dataset: {id: "dataset-1"},
                cases: [{...safeCase, ...forbidden}],
            }), /unrecognized|invalid result/iu)
        }

        const safeRun = {
            id: "run-1",
            datasetId: "dataset-1",
            status: "completed",
            results: [{
                id: "result-1",
                caseId: "case-1",
                runtimeId: "runtime-1",
                status: "completed",
                computedScore: {totalScore: 92, outcomeTier: "formal_pass"},
                reasonSummary: "Verified against the published rubric",
                artifactRefs: [{id: "artifact-result-1", kind: "evaluation-summary"}],
            }],
        }
        assert.doesNotThrow(() => parseControlOutput("evaluations.get", {run: safeRun}))
        for (const forbidden of [
            {response: "raw assistant response"},
            {judge: {transcript: "private"}},
            {traceEvidence: {reference: "/private/trace.jsonl"}},
            {referenceAnswer: "private expected body"},
        ]) {
            assert.throws(() => parseControlOutput("evaluations.get", {
                run: {...safeRun, results: [{...safeRun.results[0], ...forbidden}]},
            }), /unrecognized|invalid result/iu)
        }
    })

    it("validates paged cursors and stable IDs in outputs", () => {
        const nextCursor = encodeCursor(100)
        assert.deepEqual(parseControlOutput("datasets.list", {
            datasets: [{id: "dataset-1"}],
            nextCursor,
        }), {
            datasets: [{id: "dataset-1"}],
            nextCursor,
        })
        assert.throws(
            () => parseControlOutput("datasets.list", {datasets: [], nextCursor: "100"}),
            /nextCursor|cursor/u,
        )
        assert.throws(
            () => parseControlOutput("raw_cases.dispatch", {
                threadId: "x".repeat(201),
                turnId: null,
            }),
            /threadId|200/u,
        )
        assert.throws(
            () => parseControlOutput("runtimes.list", {runtimes: "not-an-array"}),
            /runtimes/u,
        )
    })

    it("defines a strict paged managed Skill overview without private paths or detail wrappers", () => {
        const output = {
            repositories: [{
                id: "repository-1",
                displayName: "Billing Skills",
                defaultBranch: "main",
                source: {
                    kind: "folder",
                },
            }],
            skills: [{
                id: "skill-1",
                repositoryId: "repository-1",
                name: "billing",
                description: "Billing cost analysis",
                skillRoot: "skills/billing",
                manifestPath: "skills/billing/SKILL.md",
                status: "valid",
                warnings: ["Reference at /Users/alice/private was omitted"],
                warningCount: 0,
                executableFiles: ["scripts/query.js"],
                createdAt: "2026-08-20T00:00:00.000Z",
                updatedAt: "2026-08-21T00:00:00.000Z",
            }],
            nextCursor: null,
        }
        const repositoryOutput = {
            repositories: output.repositories,
            nextCursor: null,
        }
        const versionOutput = {
            versions: [{
                id: "version-1",
                repositoryId: "repository-1",
                skillId: "skill-1",
                commit: "a".repeat(40),
                contentDigest: `sha256:${"b".repeat(64)}`,
                state: "candidate",
                versionLabel: null,
                createdBy: "import",
                optimizationRoundId: null,
                createdAt: "2026-08-21T00:00:00.000Z",
                releasedAt: null,
                deprecatedAt: null,
            }],
            nextCursor: null,
        }

        assert.deepEqual(parseControlOutput("skill_repositories.list", repositoryOutput), repositoryOutput)
        assert.deepEqual(parseControlOutput("skills.list", output), output)
        assert.deepEqual(
            parseControlOutput("skill_versions.list", versionOutput),
            versionOutput,
        )
        assert.throws(
            () => parseControlOutput("skills.list", {
                ...output,
                repositories: [{...output.repositories[0], managedPath: "/private/repository"}],
            }),
            /managedPath|unrecognized/iu,
        )
        assert.throws(
            () => parseControlOutput("skills.list", {
                ...output,
                skills: [{
                    repository: output.repositories[0],
                    skill: output.skills[0],
                    manifest: "---\nname: billing\n---\n",
                    snapshot: {digest: "sha256:private"},
                    versions: versionOutput.versions,
                }],
            }),
            /skills|repository|unrecognized/iu,
        )
    })

    it("rejects legacy Skill paths in every typed Raw Case record output", () => {
        const leaked = {
            id: "raw-1",
            question: "question",
            skill: {id: "skill-1", name: "billing", path: "/Users/alice/private/SKILL.md"},
        }

        for (const [method, output] of [
            ["raw_cases.list", {rawCases: [leaked], nextCursor: null}],
            ["raw_cases.enqueue", {created: [leaked], duplicates: [], rejected: []}],
            ["raw_cases.update", {rawCase: leaked}],
        ]) {
            assert.throws(
                () => parseControlOutput(method, output),
                /skill|path|unrecognized/iu,
            )
        }
    })

    it("rejects more than 100 records in every paginated output", () => {
        for (const [method, field] of [
            ["raw_cases.list", "rawCases"],
            ["datasets.list", "datasets"],
            ["evaluations.list", "runs"],
            ["skill_repositories.list", "repositories"],
            ["skills.list", "skills"],
            ["skill_versions.list", "versions"],
        ]) {
            const item = method === "skill_repositories.list"
                ? {id: "repository-1"}
                : method === "skills.list"
                ? {
                    id: "skill-1",
                    repositoryId: "repository-1",
                    name: "billing",
                    warningCount: 0,
                }
                : method === "skill_versions.list"
                    ? {id: "version-1", repositoryId: "repository-1", skillId: "skill-1"}
                    : method === "raw_cases.list"
                        ? {id: "raw-1", skill: {id: "skill-1", name: "billing"}}
                    : method === "evaluations.list"
                        ? {id: "run-1", datasetId: "dataset-1", status: "completed"}
                : {id: "item"}
            const related = method === "skills.list"
                ? {repositories: []}
                : {}
            assert.doesNotThrow(() => parseControlOutput(method, {
                ...related,
                [field]: Array.from({length: 100}, (_, index) => ({
                    ...item,
                    id: `item-${index}`,
                })),
                nextCursor: null,
            }))
            assert.throws(
                () => parseControlOutput(method, {
                    ...related,
                    [field]: Array.from({length: 101}, (_, index) => ({
                        ...item,
                        id: `item-${index}`,
                    })),
                    nextCursor: null,
                }),
                new RegExp(`${field}|100`, "u"),
            )
        }
    })

    it("publishes only errors created through the trusted public-error mechanism", () => {
        const error = createPublicControlError("FORBIDDEN", {
            details: {
                action: "evaluations.execute",
                retryAfterMs: 250,
                scopes: ["evaluations.read", "evaluations.execute"],
            },
            internalMessage: "denied by credential at /Users/private/control.sock",
        })
        error.code = "STACK_LEAK"
        error.message = "postgres://admin:password@db.internal/control"
        error.details = {apiKey: "secret-token"}

        assert.deepEqual(publicControlError(error), {
            code: "FORBIDDEN",
            message: "Control action is forbidden",
            retryable: false,
            details: {
                action: "evaluations.execute",
                retryAfterMs: 250,
                scopes: ["evaluations.read", "evaluations.execute"],
            },
        })
        assert.throws(
            () => createPublicControlError("NOT_WHITELISTED", {}),
            /public control error code/i,
        )
        assert.throws(
            () => createPublicControlError("FORBIDDEN", {
                details: {action: "evaluations.execute", apiKey: "secret"},
            }),
            /apiKey|unrecognized/i,
        )
        assert.throws(
            () => createPublicControlError("INVALID_ARGUMENT", {
                details: {method: "datasets.get", issues: ["apiKey=secret"]},
            }),
            /issues|object/i,
        )
    })

    it("defines strict safe public errors for control-domain failures", () => {
        const cases = [
            ["NOT_FOUND", {resource: "raw_case"}, "Control object was not found", false],
            ["IDEMPOTENCY_CONFLICT", {method: "raw_cases.enqueue"}, "Idempotency key conflicts with another request", false],
            ["CONTROL_BUSY", null, "Control operation is busy", true],
            ["IDEMPOTENCY_CAPACITY", null, "Idempotency capacity is temporarily unavailable", true],
            ["CAPABILITY_INVALID", null, "Control capability is invalid", false],
            ["CAPABILITY_REVOKED", null, "Control capability is revoked", false],
            ["CAPABILITY_EXPIRED", null, "Control capability is expired", false],
            ["CAPABILITY_SESSION_MISMATCH", null, "Control capability belongs to another Operator session", false],
            ["CAPABILITY_ACTION_NOT_GRANTED", null, "Control capability does not grant this action", false],
            ["APPROVAL_REQUIRED", {
                action: "evaluations.execute",
                reason: "budget_expansion",
                approvalId: "approval-1",
                jobId: "job-1",
                stepId: "step-1",
            }, "Control action requires approval", false],
        ]

        for (const [code, details, message, retryable] of cases) {
            const error = createPublicControlError(code, {
                details,
                internalMessage: "/private/path bearer-secret",
            })
            assert.deepEqual(publicControlError(error), {code, message, retryable, details})
        }

        for (const invalid of [
            ["NOT_FOUND", {resource: "filesystem"}],
            ["NOT_FOUND", {resource: "dataset", id: "/private/dataset"}],
            ["IDEMPOTENCY_CONFLICT", {method: "unknown.method"}],
            ["CONTROL_BUSY", {retryAfterMs: 1}],
            ["CAPABILITY_INVALID", {}],
            ["APPROVAL_REQUIRED", {action: "evaluations.execute", reason: "arbitrary"}],
            ["APPROVAL_REQUIRED", {
                action: "evaluations.execute",
                reason: "budget_expansion",
                payload: "secret",
            }],
            ["APPROVAL_REQUIRED", {
                action: "evaluations.execute",
                reason: "budget_expansion",
                approvalId: "approval-incomplete",
            }],
        ]) {
            assert.throws(
                () => createPublicControlError(invalid[0], {details: invalid[1]}),
                /invalid|unrecognized|expected|resource|method|reason|payload|identity|complete/iu,
            )
        }
    })

    it("uses a fixed fallback for ordinary errors regardless of message or metadata", () => {
        const secretText = [
            "postgres://admin:password@db.internal/control",
            "/Users/private/control.sock",
            "apiKey=secret",
            "cookie=session-secret",
            "credential=private-key",
        ].join(" ")
        const ordinary = Object.assign(new Error(secretText), {
            code: "FORBIDDEN",
            retryable: true,
            details: {action: "evaluations.execute", apiKey: "secret-token"},
        })
        const inherited = Object.create({
            code: "FORBIDDEN",
            message: secretText,
            retryable: true,
            details: {cookie: "secret-cookie"},
        })
        const expected = {
            code: "CONTROL_ERROR",
            message: "Control operation failed",
            retryable: false,
            details: null,
        }

        assert.deepEqual(publicControlError(ordinary), expected)
        assert.deepEqual(publicControlError(inherited), expected)
        assert.equal(JSON.stringify(publicControlError(ordinary)).includes("secret"), false)
    })

    it("does not inspect accessors or proxies on untrusted errors", () => {
        let propertyReads = 0
        const accessorError = Object.create(null, {
            code: {get: () => { propertyReads += 1; throw new Error("credential") }},
            message: {get: () => { propertyReads += 1; throw new Error("apiKey") }},
            details: {get: () => { propertyReads += 1; throw new Error("cookie") }},
        })
        const proxyError = new Proxy({}, {
            get() {
                throw new Error("Proxy leaked a local path")
            },
        })
        const functionProxyError = new Proxy(() => {}, {
            get() {
                throw new Error("Function proxy leaked a credential")
            },
        })
        const revoked = Proxy.revocable({}, {})
        revoked.revoke()
        const expected = {
            code: "CONTROL_ERROR",
            message: "Control operation failed",
            retryable: false,
            details: null,
        }

        assert.deepEqual(publicControlError(accessorError), expected)
        assert.deepEqual(publicControlError(proxyError), expected)
        assert.deepEqual(publicControlError(functionProxyError), expected)
        assert.deepEqual(publicControlError(revoked.proxy), expected)
        assert.equal(propertyReads, 0)
    })

    it("marks contract validation and unknown-method errors as trusted safe errors", () => {
        let validationError
        let unknownMethodError
        try {
            parseControlInput("datasets.get", {datasetId: "x".repeat(201)})
        } catch (error) {
            validationError = error
        }
        try {
            controlDefinition("credential=private")
        } catch (error) {
            unknownMethodError = error
        }

        const validation = publicControlError(validationError)
        assert.equal(validation.code, "INVALID_ARGUMENT")
        assert.equal(validation.message, "Invalid control input")
        assert.equal(validation.details.method, "datasets.get")
        assert.deepEqual(validation.details.issues[0], {path: ["datasetId"]})
        assert.deepEqual(publicControlError(unknownMethodError), {
            code: "UNKNOWN_CONTROL_METHOD",
            message: "Unknown control method",
            retryable: false,
            details: null,
        })
    })
})
