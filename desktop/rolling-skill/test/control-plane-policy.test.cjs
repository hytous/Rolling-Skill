const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    createBudgetSnapshot,
    createControlPolicy,
    createResolvedScope,
    operatorApprovalRequirement,
    operatorMethodBudgetMinimum,
} = require("../src/control-plane/policy.cjs")

function grant(overrides = {}) {
    return Object.freeze({
        id: "cap-1",
        sessionId: "operator-1",
        actions: Object.freeze([
            "context.read",
            "raw_cases.read",
            "raw_cases.write",
            "runtimes.read",
            "runtime.execute",
            "datasets.read",
            "datasets.write",
            "datasets.delete",
            "evaluations.read",
            "evaluations.execute",
            "skills.read",
            "skills.write",
            "skills.release",
            "jobs.read",
            "jobs.control",
            "approvals.read",
            "approvals.resolve",
            "curation.write",
            "rubrics.publish",
            "installations.read",
            "installations.execute",
        ]),
        scopes: Object.freeze({
            skillIds: Object.freeze(["skill-1"]),
            datasetIds: Object.freeze(["dataset-1"]),
            runtimeIds: Object.freeze(["runtime-1", "judge-1"]),
            repositoryIds: Object.freeze(["repository-1"]),
        }),
        budget: Object.freeze({maxRuntimeTurns: 4, maxEvaluations: 1}),
        ...overrides,
    })
}

function budgetSnapshot(authority, overrides = {}) {
    return createBudgetSnapshot({
        capabilityId: authority.id,
        sessionId: authority.sessionId,
        usage: {runtimeTurns: 0, evaluations: 0},
        revision: 7,
        ...overrides,
    })
}

function resolvedScope(method, {mode = "access", ...ids} = {}) {
    return createResolvedScope({method, mode, ...ids})
}

describe("control-plane policy", () => {
    it("allows granted reads and Raw Case writes without a budget reservation", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "datasets.get",
            action: "datasets.read",
            input: {datasetId: "dataset-1", includeCases: true},
        }), {decision: "allow", reservation: null})
        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "raw_cases.enqueue",
            action: "raw_cases.write",
            input: {
                cases: [{
                    question: "Question",
                    skill: {name: "billing", path: "/renderer/controlled/path"},
                }],
                idempotencyKey: "enqueue-1",
                commit: "renderer-commit",
            },
            resolvedScope: resolvedScope("raw_cases.enqueue", {skillIds: ["skill-1"]}),
        }), {decision: "allow", reservation: null})
    })

    it("requires the selected managed Skill and its repository for editing actions", () => {
        const policy = createControlPolicy()
        const request = {
            grant: grant(),
            method: "skills.create_candidate",
            action: "skills.write",
            input: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                message: "Improve guidance",
                idempotencyKey: "candidate-1",
            },
        }

        assert.deepEqual(policy.decide(request), {
            decision: "deny",
            code: "OBJECT_SCOPE_UNRESOLVED",
            message: "Object scope could not be resolved for this control method",
        })
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: resolvedScope("skills.create_candidate", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-1"],
            }),
        }), {decision: "allow", reservation: null})
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: resolvedScope("skills.create_candidate", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-2"],
            }),
        }), {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Repository is outside this Operator session",
        })
    })

    it("requires the source Dataset, managed Skill, and repository when cloning", () => {
        const policy = createControlPolicy()
        const request = {
            grant: grant(),
            method: "datasets.clone",
            action: "datasets.write",
            input: {
                sourceDatasetId: "dataset-1",
                name: "Billing clone",
                caseIds: ["case-1"],
                idempotencyKey: "clone-1",
            },
        }

        assert.equal(policy.decide(request).code, "OBJECT_SCOPE_UNRESOLVED")
        const resolved = resolvedScope("datasets.clone", {
            subject: {kind: "dataset", id: "dataset-1"},
            datasetIds: ["dataset-1"],
            skillIds: ["skill-1"],
            repositoryIds: ["repository-1"],
        })
        assert.deepEqual(policy.decide({...request, resolvedScope: resolved}), {
            decision: "allow",
            reservation: null,
        })
        assert.equal(policy.decide({
            ...request,
            resolvedScope: resolvedScope("datasets.clone", {
                subject: {kind: "dataset", id: "dataset-1"},
                datasetIds: ["dataset-1"],
                skillIds: ["skill-1"],
                repositoryIds: ["repository-2"],
            }),
        }).code, "OBJECT_OUT_OF_SCOPE")
    })

    it("checks every Runtime target on installation requests", () => {
        const policy = createControlPolicy()
        const decision = policy.decide({
            grant: grant(),
            method: "installations.start",
            action: "installations.execute",
            input: {
                skillId: "skill-1",
                repositoryId: "repository-1",
                versionId: "version-1",
                targets: [{runtimeId: "runtime-2"}],
                idempotencyKey: "install-1",
            },
            resolvedScope: resolvedScope("installations.start", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-1"],
            }),
        })

        assert.deepEqual(decision, {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Runtime is outside this Operator session",
        })
    })

    it("denies an action missing from the capability before considering execution", () => {
        const policy = createControlPolicy()
        const withoutExecution = grant({actions: Object.freeze(["evaluations.read"])})

        assert.deepEqual(policy.decide({
            grant: withoutExecution,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {datasetId: "dataset-1"},
        }), {
            decision: "deny",
            code: "ACTION_NOT_GRANTED",
            message: "Action is not granted for this Operator session",
        })
    })

    it("rejects an Evaluation method disguised as a granted read action", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze(["datasets.read"])}),
            method: "evaluations.start",
            action: "datasets.read",
            input: {datasetId: "dataset-1"},
        }), {
            decision: "deny",
            code: "METHOD_ACTION_MISMATCH",
            message: "Action does not match the control method",
        })
    })

    it("rejects Runtime dispatch disguised as a granted Raw Case read", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze(["raw_cases.read"])}),
            method: "raw_cases.dispatch",
            action: "raw_cases.read",
            input: {runtime: {runtimeId: "runtime-1"}},
        }), {
            decision: "deny",
            code: "METHOD_ACTION_MISMATCH",
            message: "Action does not match the control method",
        })
    })

    it("returns a stable denial for an unknown method instead of allowing its claimed action", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze(["datasets.read"])}),
            method: "unknown.internal-secret-method",
            action: "datasets.read",
            input: {},
        }), {
            decision: "deny",
            code: "UNKNOWN_CONTROL_METHOD",
            message: "Unknown control method",
        })
    })

    it("denies each referenced Skill, Dataset, and Runtime outside its object scope", () => {
        const policy = createControlPolicy()
        const cases = [
            {
                request: {
                    method: "skills.get",
                    action: "skills.read",
                    input: {skillId: "skill-2"},
                },
                type: "Skill",
            },
            {
                request: {
                    method: "evaluations.start",
                    action: "evaluations.execute",
                    input: {
                        datasetId: "dataset-2",
                        runtimeConfigurations: [{runtimeId: "runtime-1"}],
                        judgeConfiguration: {runtimeId: "judge-1"},
                    },
                },
                type: "Dataset",
            },
            {
                request: {
                    method: "raw_cases.dispatch",
                    action: "runtime.execute",
                    input: {runtime: {runtimeId: "runtime-2"}},
                },
                type: "Runtime",
            },
        ]

        for (const {request, type} of cases) {
            assert.deepEqual(policy.decide({grant: grant(), ...request}), {
                decision: "deny",
                code: "OBJECT_OUT_OF_SCOPE",
                message: `${type} is outside this Operator session`,
            })
        }
    })

    it("checks every canonical runtime ID used by an evaluation", () => {
        const policy = createControlPolicy()
        const input = {
            datasetId: "dataset-1",
            runtimeConfigurations: [
                {runtimeId: "runtime-1"},
                {runtimeId: "runtime-2"},
            ],
            judgeConfiguration: {runtimeId: "judge-1"},
        }

        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "evaluations.start",
            action: "evaluations.execute",
            input,
        }), {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Runtime is outside this Operator session",
        })
    })

    it("fails closed for missing, forged, wrong-method, or incomplete owner resolution", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const request = {
            grant: authority,
            method: "raw_cases.update",
            action: "raw_cases.write",
            input: {id: "raw-case-1", changes: {note: "updated"}},
        }
        const expected = {
            decision: "deny",
            code: "OBJECT_SCOPE_UNRESOLVED",
            message: "Object scope could not be resolved for this control method",
        }

        assert.deepEqual(policy.decide(request), expected)
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: Object.freeze({
                method: "raw_cases.update",
                mode: "access",
                skillIds: Object.freeze(["skill-1"]),
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: resolvedScope("raw_cases.update", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: [],
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            ...request,
            resolvedScope: resolvedScope("raw_cases.update", {
                mode: "filter",
                skillIds: ["skill-1"],
            }),
        }), expected)
    })

    it("creates own normalized IDs and provided keys despite inherited numeric setters", () => {
        const policy = createControlPolicy()
        const authority = grant({
            scopes: Object.freeze({
                skillIds: Object.freeze(["skill-2"]),
                datasetIds: Object.freeze(["dataset-1"]),
                runtimeIds: Object.freeze(["runtime-1", "judge-1"]),
            }),
        })
        const original = Object.getOwnPropertyDescriptor(Array.prototype, "0")
        let scope
        let decision
        try {
            Object.defineProperty(Array.prototype, "0", {
                configurable: true,
                set(value) {
                    const replacement = value === "skill-2"
                        ? "skill-1"
                        : value === "skillIds" ? "runtimeIds" : value
                    Object.defineProperty(this, "0", {
                        configurable: true,
                        enumerable: true,
                        value: replacement,
                        writable: true,
                    })
                },
            })
            scope = createResolvedScope({
                method: "raw_cases.enqueue",
                mode: "access",
                skillIds: ["skill-2"],
            })
            decision = policy.decide({
                grant: authority,
                method: "raw_cases.enqueue",
                action: "raw_cases.write",
                input: {
                    cases: [{question: "Question", skill: {name: "billing"}}],
                    idempotencyKey: "enqueue-1",
                },
                resolvedScope: scope,
            })
        } finally {
            if (original === undefined) delete Array.prototype["0"]
            else Object.defineProperty(Array.prototype, "0", original)
        }

        assert.deepEqual(scope.skillIds, ["skill-2"])
        assert.deepEqual(decision, {decision: "allow", reservation: null})
    })

    it("rejects an unbounded trusted resolved-scope limit", () => {
        assert.throws(() => createResolvedScope({
            method: "skills.list",
            mode: "filter",
            skillIds: [],
        }, {maxScopeIds: 4_097}), /scope limit/iu)
    })

    it("denies replaying an access resolution for another opaque subject", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const cases = [
            {
                method: "raw_cases.update",
                action: "raw_cases.write",
                input: {id: "raw-case-2", changes: {note: "updated"}},
                subject: {kind: "raw_case", id: "raw-case-1"},
                scope: {skillIds: ["skill-1"]},
            },
            {
                method: "raw_cases.dispatch",
                action: "runtime.execute",
                input: {id: "raw-case-2", runtime: {runtimeId: "runtime-1"}},
                subject: {kind: "raw_case", id: "raw-case-1"},
                scope: {skillIds: ["skill-1"]},
            },
            {
                method: "evaluations.get",
                action: "evaluations.read",
                input: {runId: "run-2"},
                subject: {kind: "evaluation_run", id: "run-1"},
                scope: {datasetIds: ["dataset-1"]},
            },
            {
                method: "evaluations.cancel",
                action: "evaluations.execute",
                input: {runId: "run-2", idempotencyKey: "cancel-2"},
                subject: {kind: "evaluation_run", id: "run-1"},
                scope: {datasetIds: ["dataset-1"]},
            },
        ]

        for (const {method, action, input, subject, scope} of cases) {
            assert.deepEqual(policy.decide({
                grant: authority,
                method,
                action,
                input,
                resolvedScope: createResolvedScope({
                    method,
                    mode: "access",
                    subject,
                    ...scope,
                }),
            }), {
                decision: "deny",
                code: "OBJECT_SCOPE_SUBJECT_MISMATCH",
                message: "Resolved object scope belongs to a different request subject",
            })
        }
    })

    it("requires strict own-data subjects only for opaque access resolutions", () => {
        assert.throws(() => createResolvedScope({
            method: "raw_cases.update",
            mode: "access",
            skillIds: ["skill-1"],
        }), /resolved scope/iu)
        assert.throws(() => createResolvedScope({
            method: "raw_cases.update",
            mode: "access",
            subject: {kind: "evaluation_run", id: "raw-case-1"},
            skillIds: ["skill-1"],
        }), /resolved scope/iu)
        assert.throws(() => createResolvedScope({
            method: "raw_cases.update",
            mode: "access",
            subject: Object.create({kind: "raw_case", id: "raw-case-1"}),
            skillIds: ["skill-1"],
        }), /resolved scope/iu)

        let getterCalls = 0
        const accessorSubject = {kind: "raw_case"}
        Object.defineProperty(accessorSubject, "id", {
            enumerable: true,
            get() {
                getterCalls += 1
                return "raw-case-1"
            },
        })
        assert.throws(() => createResolvedScope({
            method: "raw_cases.update",
            mode: "access",
            subject: accessorSubject,
            skillIds: ["skill-1"],
        }), /resolved scope/iu)
        assert.equal(getterCalls, 0)

        assert.throws(() => createResolvedScope({
            method: "raw_cases.list",
            mode: "filter",
            subject: {kind: "raw_case", id: "raw-case-1"},
            skillIds: ["skill-1"],
        }), /resolved scope/iu)
    })

    it("denies Raw Case update and dispatch when the resolved owner Skill is outside scope", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const expected = {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Skill is outside this Operator session",
        }

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "raw_cases.update",
            action: "raw_cases.write",
            input: {id: "raw-case-outside", changes: {note: "updated"}},
            resolvedScope: resolvedScope("raw_cases.update", {
                subject: {kind: "raw_case", id: "raw-case-outside"},
                skillIds: ["skill-2"],
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {id: "raw-case-outside", runtime: {runtimeId: "runtime-1"}},
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-outside"},
                skillIds: ["skill-2"],
            }),
            budgetSnapshot: budgetSnapshot(authority),
        }), expected)
    })

    it("denies Evaluation get and cancel when the resolved owner Dataset is outside scope", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const expected = {
            decision: "deny",
            code: "OBJECT_OUT_OF_SCOPE",
            message: "Dataset is outside this Operator session",
        }

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.get",
            action: "evaluations.read",
            input: {runId: "run-outside"},
            resolvedScope: resolvedScope("evaluations.get", {
                subject: {kind: "evaluation_run", id: "run-outside"},
                datasetIds: ["dataset-2"],
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.cancel",
            action: "evaluations.execute",
            input: {runId: "run-outside", idempotencyKey: "cancel-outside"},
            resolvedScope: resolvedScope("evaluations.cancel", {
                subject: {kind: "evaluation_run", id: "run-outside"},
                datasetIds: ["dataset-2"],
            }),
            budgetSnapshot: budgetSnapshot(authority),
        }), expected)
    })

    it("requires a Dataset filter when evaluations.list has no direct Dataset", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const request = {
            grant: authority,
            method: "evaluations.list",
            action: "evaluations.read",
            input: {datasetId: null},
        }

        assert.deepEqual(policy.decide(request), {
            decision: "deny",
            code: "OBJECT_SCOPE_UNRESOLVED",
            message: "Object scope could not be resolved for this control method",
        })
        const allowed = policy.decide({
            ...request,
            resolvedScope: resolvedScope("evaluations.list", {
                mode: "filter",
                datasetIds: ["dataset-1"],
            }),
        })
        assert.deepEqual(allowed, {
            decision: "allow",
            reservation: null,
            scopeFilter: {datasetIds: ["dataset-1"]},
        })
        assert.ok(Object.isFrozen(allowed))
        assert.ok(Object.isFrozen(allowed.scopeFilter))
        assert.ok(Object.isFrozen(allowed.scopeFilter.datasetIds))
    })

    it("returns executable filters for every unfiltered phase-one list", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const cases = [
            ["context.get", "context.read", "runtimeIds", ["runtime-1"]],
            ["raw_cases.list", "raw_cases.read", "skillIds", ["skill-1"]],
            ["runtimes.list", "runtimes.read", "runtimeIds", ["runtime-1", "judge-1"]],
            ["datasets.list", "datasets.read", "datasetIds", ["dataset-1"]],
            ["skill_repositories.list", "skills.read", "repositoryIds", ["repository-1"]],
            ["skills.list", "skills.read", "skillIds", ["skill-1"]],
            ["skill_versions.list", "skills.read", "skillIds", ["skill-1"]],
        ]

        for (const [method, action, scopeKey, ids] of cases) {
            const withoutFilter = policy.decide({grant: authority, method, action, input: {}})
            assert.equal(withoutFilter.decision, "deny")
            assert.equal(withoutFilter.code, "OBJECT_SCOPE_UNRESOLVED")

            assert.deepEqual(policy.decide({
                grant: authority,
                method,
                action,
                input: {},
                resolvedScope: resolvedScope(method, {mode: "filter", [scopeKey]: ids}),
            }), {
                decision: "allow",
                reservation: null,
                scopeFilter: {[scopeKey]: ids},
            })
        }
    })

    it("does not turn a branded list filter into authority outside the grant", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const cases = [
            ["raw_cases.list", "raw_cases.read", "skillIds", "skill-2", "Skill"],
            ["runtimes.list", "runtimes.read", "runtimeIds", "runtime-2", "Runtime"],
            ["datasets.list", "datasets.read", "datasetIds", "dataset-2", "Dataset"],
            ["skill_repositories.list", "skills.read", "repositoryIds", "repository-2", "Repository"],
            ["skills.list", "skills.read", "skillIds", "skill-2", "Skill"],
            ["skill_versions.list", "skills.read", "skillIds", "skill-2", "Skill"],
        ]

        for (const [method, action, scopeKey, outsideId, type] of cases) {
            assert.deepEqual(policy.decide({
                grant: authority,
                method,
                action,
                input: {},
                resolvedScope: resolvedScope(method, {
                    mode: "filter",
                    [scopeKey]: [outsideId],
                }),
            }), {
                decision: "deny",
                code: "OBJECT_OUT_OF_SCOPE",
                message: `${type} is outside this Operator session`,
            })
        }
    })

    it("allows valid direct and resolved object paths without widening scope", () => {
        const policy = createControlPolicy()
        const authority = grant()

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "runtimes.models",
            action: "runtimes.read",
            input: {runtimeId: "runtime-1"},
        }), {decision: "allow", reservation: null})
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "raw_cases.update",
            action: "raw_cases.write",
            input: {id: "raw-case-1", changes: {note: "updated"}},
            resolvedScope: resolvedScope("raw_cases.update", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
        }), {decision: "allow", reservation: null})
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.get",
            action: "evaluations.read",
            input: {runId: "run-1"},
            resolvedScope: resolvedScope("evaluations.get", {
                subject: {kind: "evaluation_run", id: "run-1"},
                datasetIds: ["dataset-1"],
            }),
        }), {decision: "allow", reservation: null})
    })

    it("returns a side-effect-free Runtime-turn reservation while budget remains", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const snapshot = budgetSnapshot(authority, {
            usage: {runtimeTurns: 3, evaluations: 0},
        })

        const first = policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {id: "raw-case-1", runtime: {runtimeId: "runtime-1"}},
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
            budgetSnapshot: snapshot,
        })
        const second = policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {id: "raw-case-1", runtime: {runtimeId: "runtime-1"}},
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
            budgetSnapshot: snapshot,
        })

        assert.deepEqual(first, {
            decision: "allow",
            reservation: {
                capabilityId: "cap-1",
                sessionId: "operator-1",
                budgetKey: "maxRuntimeTurns",
                usageKey: "runtimeTurns",
                amount: 1,
                expectedUsed: 3,
                expectedRevision: 7,
                limit: 4,
            },
        })
        assert.deepEqual(second, first)
        assert.deepEqual(snapshot.usage, {runtimeTurns: 3, evaluations: 0})
        assert.equal(first.reservation.expectedRevision, second.reservation.expectedRevision)
        assert.ok(Object.isFrozen(first))
        assert.ok(Object.isFrozen(first.reservation))
        assert.ok(Object.isFrozen(snapshot))
        assert.ok(Object.isFrozen(snapshot.usage))
    })

    it("returns an Evaluation reservation while evaluation budget remains", () => {
        const policy = createControlPolicy()
        const authority = grant()

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            budgetSnapshot: budgetSnapshot(authority),
        }), {
            decision: "allow",
            reservation: {
                capabilityId: "cap-1",
                sessionId: "operator-1",
                budgetKey: "maxEvaluations",
                usageKey: "evaluations",
                amount: 1,
                expectedUsed: 0,
                expectedRevision: 7,
                limit: 1,
            },
        })
    })

    it("allows Runtime and Evaluation execution when no Tool budget key is frozen", () => {
        const policy = createControlPolicy()
        const authority = grant({budget: Object.freeze({})})

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {id: "raw-case-1", runtime: {runtimeId: "runtime-1"}},
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
        }), {decision: "allow", reservation: null})
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
        }), {decision: "allow", reservation: null})
    })

    it("requires budget-expansion approval when an execution would exceed its limit", () => {
        const policy = createControlPolicy()
        const authority = grant()

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {id: "raw-case-1", runtime: {runtimeId: "runtime-1"}},
            resolvedScope: resolvedScope("raw_cases.dispatch", {
                subject: {kind: "raw_case", id: "raw-case-1"},
                skillIds: ["skill-1"],
            }),
            budgetSnapshot: budgetSnapshot(authority, {
                usage: {runtimeTurns: 4, evaluations: 0},
            }),
        }), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {budget: {maxRuntimeTurns: 5}},
        })
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            budgetSnapshot: budgetSnapshot(authority, {
                usage: {runtimeTurns: 0, evaluations: 1},
            }),
        }), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {budget: {maxEvaluations: 2}},
        })
    })

    it("allows cancellation without reserving or expanding execution budget", () => {
        const policy = createControlPolicy()
        const authority = grant()

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.cancel",
            action: "evaluations.execute",
            input: {runId: "run-1", idempotencyKey: "cancel-1"},
            resolvedScope: resolvedScope("evaluations.cancel", {
                subject: {kind: "evaluation_run", id: "run-1"},
                datasetIds: ["dataset-1"],
            }),
            budgetSnapshot: budgetSnapshot(authority, {
                usage: {runtimeTurns: 4, evaluations: 1},
            }),
        }), {decision: "allow", reservation: null})
    })

    it("fails closed when an execution has no branded budget snapshot", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const request = {
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
        }
        const expected = {
            decision: "deny",
            code: "BUDGET_SNAPSHOT_INVALID",
            message: "A trusted budget snapshot is required",
        }

        assert.deepEqual(policy.decide(request), expected)
        assert.deepEqual(policy.decide({
            ...request,
            budgetSnapshot: Object.freeze({
                capabilityId: "cap-1",
                sessionId: "operator-1",
                usage: Object.freeze({runtimeTurns: 0, evaluations: 0}),
                revision: 7,
            }),
        }), expected)
    })

    it("rejects a branded budget snapshot owned by another capability or session", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const request = {
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
        }
        const expected = {
            decision: "deny",
            code: "BUDGET_SNAPSHOT_MISMATCH",
            message: "Budget snapshot belongs to a different capability session",
        }

        assert.deepEqual(policy.decide({
            ...request,
            budgetSnapshot: createBudgetSnapshot({
                capabilityId: "cap-other",
                sessionId: "operator-1",
                usage: {runtimeTurns: 0, evaluations: 0},
                revision: 1,
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            ...request,
            budgetSnapshot: createBudgetSnapshot({
                capabilityId: "cap-1",
                sessionId: "operator-other",
                usage: {runtimeTurns: 0, evaluations: 0},
                revision: 1,
            }),
        }), expected)
    })

    it("keeps budget snapshots independent across capability sessions", () => {
        const policy = createControlPolicy()
        const firstGrant = grant()
        const secondGrant = grant({id: "cap-2", sessionId: "operator-2"})
        const input = {
            datasetId: "dataset-1",
            runtimeConfigurations: [{runtimeId: "runtime-1"}],
            judgeConfiguration: {runtimeId: "judge-1"},
        }

        const first = policy.decide({
            grant: firstGrant,
            method: "evaluations.start",
            action: "evaluations.execute",
            input,
            budgetSnapshot: budgetSnapshot(firstGrant, {
                usage: {runtimeTurns: 0, evaluations: 1},
                revision: 9,
            }),
        })
        const second = policy.decide({
            grant: secondGrant,
            method: "evaluations.start",
            action: "evaluations.execute",
            input,
            budgetSnapshot: budgetSnapshot(secondGrant, {revision: 2}),
        })

        assert.equal(first.decision, "approval_required")
        assert.equal(second.decision, "allow")
        assert.equal(second.reservation.capabilityId, "cap-2")
        assert.equal(second.reservation.sessionId, "operator-2")
        assert.equal(second.reservation.expectedRevision, 2)
    })

    it("rejects unsafe budget arithmetic instead of overflowing a reservation or approval", () => {
        const policy = createControlPolicy()
        const authority = grant({
            budget: Object.freeze({
                maxRuntimeTurns: Number.MAX_SAFE_INTEGER,
                maxEvaluations: Number.MAX_SAFE_INTEGER,
            }),
        })
        const expected = {
            decision: "deny",
            code: "BUDGET_ARITHMETIC_OVERFLOW",
            message: "Budget reservation would exceed safe integer bounds",
        }

        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            budgetSnapshot: budgetSnapshot(authority, {
                usage: {runtimeTurns: 0, evaluations: Number.MAX_SAFE_INTEGER},
                revision: 1,
            }),
        }), expected)
        assert.deepEqual(policy.decide({
            grant: authority,
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            budgetSnapshot: budgetSnapshot(authority, {
                revision: Number.MAX_SAFE_INTEGER,
            }),
        }), expected)
    })

    it("rejects malformed budget snapshot source data", () => {
        const authority = grant()

        for (const request of [
            {
                capabilityId: authority.id,
                sessionId: authority.sessionId,
                usage: {runtimeTurns: 0},
                revision: 1,
            },
            {
                capabilityId: authority.id,
                sessionId: authority.sessionId,
                usage: {runtimeTurns: -1, evaluations: 0},
                revision: 1,
            },
            {
                capabilityId: authority.id,
                sessionId: authority.sessionId,
                usage: {runtimeTurns: 0, evaluations: 0},
                revision: -1,
            },
        ]) {
            assert.throws(() => createBudgetSnapshot(request), /budget snapshot/iu)
        }
    })

    it("requires approval for delete, release, install, and Rubric publish outside Operator routes", () => {
        const policy = createControlPolicy()
        const cases = [
            ["datasets.delete", "datasets.delete", "destructive_action", {datasetId: "dataset-1"}],
            ["datasets.delete_case", "datasets.delete", "destructive_action", {
                datasetId: "dataset-1",
                caseId: "case-1",
            }],
            ["skills.release", "skills.release", "release", {
                repositoryId: "repository-1",
                skillId: "skill-1",
            }],
            ["installations.start", "installations.execute", "installation", {
                repositoryId: "repository-1",
                skillId: "skill-1",
                runtimeId: "runtime-1",
            }],
            ["installations.cancel", "installations.execute", "installation", {
                installationId: "installation-1",
            }],
            ["rubrics.publish", "rubrics.publish", "rubric_publish", {
                datasetId: "dataset-1",
                sessionId: "rubric-1",
            }],
        ]

        for (const [method, action, reason, input] of cases) {
            const scopes = method === "skills.release" || method === "installations.start"
                ? resolvedScope(method, {
                    subject: {kind: "skill", id: input.skillId},
                    skillIds: [input.skillId],
                    repositoryIds: ["repository-1"],
                    })
                : method === "installations.cancel"
                    ? resolvedScope(method, {
                        subject: {kind: "installation", id: input.installationId},
                        skillIds: ["skill-1"],
                        runtimeIds: ["runtime-1"],
                        repositoryIds: ["repository-1"],
                    })
                : method === "rubrics.publish"
                    ? resolvedScope(method, {
                        subject: {kind: "rubric_session", id: "rubric-1"},
                        datasetIds: [input.datasetId],
                    })
                    : undefined
            const decision = policy.decide({
                grant: grant(),
                method,
                action,
                input: {...input, path: "/untrusted/path", commit: "untrusted-commit"},
                resolvedScope: scopes,
            })
            assert.equal(decision.decision, "approval_required")
            assert.equal(decision.reason, reason)
            assert.equal(JSON.stringify(decision.requestedScope).includes("untrusted"), false)
            assert.equal(Object.hasOwn(decision.requestedScope, "path"), false)
            assert.equal(Object.hasOwn(decision.requestedScope, "commit"), false)
        }
    })

    it("preauthorizes granted Operator release, Rubric, installation, and deletion actions", () => {
        const policy = createControlPolicy()
        const cases = [
            ["datasets.delete", "datasets.delete", {datasetId: "dataset-1"}, undefined],
            ["skills.release", "skills.release", {
                repositoryId: "repository-1",
                skillId: "skill-1",
            }, resolvedScope("skills.release", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-1"],
            })],
            ["rubrics.publish", "rubrics.publish", {
                datasetId: "dataset-1",
                sessionId: "rubric-1",
            }, resolvedScope("rubrics.publish", {
                subject: {kind: "rubric_session", id: "rubric-1"},
                datasetIds: ["dataset-1"],
            })],
            ["installations.start", "installations.execute", {
                repositoryId: "repository-1",
                skillId: "skill-1",
                runtimeId: "runtime-1",
            }, resolvedScope("installations.start", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-1"],
            })],
        ]

        for (const [method, action, input, scopes] of cases) {
            assert.deepEqual(policy.decide({
                grant: grant(),
                method,
                action,
                input,
                resolvedScope: scopes,
                operatorPreauthorized: true,
            }), {decision: "allow", reservation: null})
        }

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze([])}),
            method: "skills.release",
            action: "skills.release",
            input: {repositoryId: "repository-1", skillId: "skill-1"},
            resolvedScope: resolvedScope("skills.release", {
                subject: {kind: "skill", id: "skill-1"},
                skillIds: ["skill-1"],
                repositoryIds: ["repository-1"],
            }),
            operatorPreauthorized: true,
        }), {
            decision: "deny",
            code: "ACTION_NOT_GRANTED",
            message: "Action is not granted for this Operator session",
        })
    })

    it("always represents direct budget expansion as approval-required canonical scope", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze(["budget.expand"])}),
            method: "budget.expand",
            action: "budget.expand",
            input: {
                budget: {maxRuntimeTurns: 8, maxEvaluations: 2, arbitraryCost: 10_000},
                path: "/renderer/path",
            },
        }), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {
                budget: {maxRuntimeTurns: 8, maxEvaluations: 2},
            },
        })
    })

    it("exposes canonical Operator approval requirements for every high-risk method", () => {
        const cases = [
            ["datasets.delete", "datasets.delete", "destructive_action"],
            ["datasets.delete_case", "datasets.delete", "destructive_action"],
            ["raw_cases.delete", "raw_cases.delete", "destructive_action"],
            ["evaluations.delete", "evaluations.delete", "destructive_action"],
            ["skills.delete", "skills.delete", "destructive_action"],
            ["skills.release", "skills.release", "release"],
            ["skills.install", "skills.install", "installation"],
            ["installations.start", "installations.execute", "installation"],
            ["installations.cancel", "installations.execute", "installation"],
            ["rubrics.publish", "rubrics.publish", "rubric_publish"],
        ]
        for (const [method, action, reason] of cases) {
            const decision = operatorApprovalRequirement(method, {
                skillId: "skill-1",
                datasetId: "dataset-1",
                runtimeId: "runtime-1",
            })
            assert.equal(decision.decision, "approval_required")
            assert.equal(decision.action, action)
            assert.equal(decision.reason, reason)
        }
        assert.equal(operatorApprovalRequirement("datasets.read", {datasetId: "dataset-1"}), null)
    })

    it("canonicalizes every durable Operator budget field in expansion approval scope", () => {
        assert.deepEqual(operatorApprovalRequirement("budget.expand", {budget: {
            maxDurationMs: 90_000,
            maxRuntimeTurns: 8,
            maxEvaluations: 2,
            maxTargetExecutions: 40,
            maxJudgeExecutions: 10,
            maxTokens: 100_000,
            maxReportedCost: 12.5,
            inherited: true,
        }}), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {budget: {
                maxDurationMs: 90_000,
                maxRuntimeTurns: 8,
                maxEvaluations: 2,
                maxTargetExecutions: 40,
                maxJudgeExecutions: 10,
                maxTokens: 100_000,
                maxReportedCost: 12.5,
            }},
            action: "budget.expand",
        })
    })

    it("derives non-overridable execution minimums from the trusted method", () => {
        assert.deepEqual(operatorMethodBudgetMinimum("raw_cases.dispatch"), {runtimeTurns: 1})
        assert.deepEqual(operatorMethodBudgetMinimum("evaluations.start"), {evaluations: 1})
        assert.deepEqual(operatorMethodBudgetMinimum("evaluations.cancel"), {})
        assert.deepEqual(operatorMethodBudgetMinimum("skills.release"), {})
    })

})
