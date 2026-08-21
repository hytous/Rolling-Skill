const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {createControlPolicy} = require("../src/control-plane/policy.cjs")

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
            "evaluations.read",
            "evaluations.execute",
            "skills.read",
        ]),
        scopes: Object.freeze({
            skillIds: Object.freeze(["skill-1"]),
            datasetIds: Object.freeze(["dataset-1"]),
            runtimeIds: Object.freeze(["runtime-1", "judge-1"]),
        }),
        budget: Object.freeze({maxRuntimeTurns: 4, maxEvaluations: 1}),
        ...overrides,
    })
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
        }), {decision: "allow", reservation: null})
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

    it("returns a side-effect-free Runtime-turn reservation while budget remains", () => {
        const policy = createControlPolicy()
        const authority = grant()
        const usage = {runtimeTurns: 3, evaluations: 0}

        const first = policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {runtime: {runtimeId: "runtime-1"}},
            usage,
        })
        const second = policy.decide({
            grant: authority,
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {runtime: {runtimeId: "runtime-1"}},
            usage,
        })

        assert.deepEqual(first, {
            decision: "allow",
            reservation: {
                budgetKey: "maxRuntimeTurns",
                usageKey: "runtimeTurns",
                amount: 1,
                used: 3,
                limit: 4,
            },
        })
        assert.deepEqual(second, first)
        assert.deepEqual(usage, {runtimeTurns: 3, evaluations: 0})
        assert.ok(Object.isFrozen(first))
        assert.ok(Object.isFrozen(first.reservation))
    })

    it("returns an Evaluation reservation while evaluation budget remains", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            usage: {runtimeTurns: 0, evaluations: 0},
        }), {
            decision: "allow",
            reservation: {
                budgetKey: "maxEvaluations",
                usageKey: "evaluations",
                amount: 1,
                used: 0,
                limit: 1,
            },
        })
    })

    it("requires budget-expansion approval when an execution would exceed its limit", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "raw_cases.dispatch",
            action: "runtime.execute",
            input: {runtime: {runtimeId: "runtime-1"}},
            usage: {runtimeTurns: 4, evaluations: 0},
        }), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {budget: {maxRuntimeTurns: 5}},
        })
        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "evaluations.start",
            action: "evaluations.execute",
            input: {
                datasetId: "dataset-1",
                runtimeConfigurations: [{runtimeId: "runtime-1"}],
                judgeConfiguration: {runtimeId: "judge-1"},
            },
            usage: {runtimeTurns: 0, evaluations: 1},
        }), {
            decision: "approval_required",
            reason: "budget_expansion",
            requestedScope: {budget: {maxEvaluations: 2}},
        })
    })

    it("allows cancellation without reserving or expanding execution budget", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant(),
            method: "evaluations.cancel",
            action: "evaluations.execute",
            input: {runId: "run-1", idempotencyKey: "cancel-1"},
            usage: {runtimeTurns: 4, evaluations: 1},
        }), {decision: "allow", reservation: null})
    })

    it("always requires approval for delete, release, install, and Rubric publish", () => {
        const policy = createControlPolicy()
        const cases = [
            ["datasets.delete", "datasets.delete", "destructive_action", {datasetId: "dataset-1"}],
            ["skills.release", "skills.release", "release", {skillId: "skill-1"}],
            ["installations.start", "installations.execute", "installation", {
                skillId: "skill-1",
                runtimeId: "runtime-1",
            }],
            ["rubrics.publish", "rubrics.publish", "rubric_publish", {datasetId: "dataset-1"}],
        ]

        for (const [method, action, reason, input] of cases) {
            const decision = policy.decide({
                grant: grant({actions: Object.freeze([])}),
                method,
                action,
                input: {...input, path: "/untrusted/path", commit: "untrusted-commit"},
            })
            assert.equal(decision.decision, "approval_required")
            assert.equal(decision.reason, reason)
            assert.equal(JSON.stringify(decision.requestedScope).includes("untrusted"), false)
            assert.equal(Object.hasOwn(decision.requestedScope, "path"), false)
            assert.equal(Object.hasOwn(decision.requestedScope, "commit"), false)
        }
    })

    it("always represents direct budget expansion as approval-required canonical scope", () => {
        const policy = createControlPolicy()

        assert.deepEqual(policy.decide({
            grant: grant({actions: Object.freeze([])}),
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

})
