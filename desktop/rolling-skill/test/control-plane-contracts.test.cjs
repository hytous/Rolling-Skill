const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CONTROL_METHODS,
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
    "skills.list": {},
    "skill_versions.list": {},
    "skills.get": {skillId: "skill-1"},
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
    "datasets.get": {dataset: {id: "dataset-1"}, cases: []},
    "evaluations.list": {runs: [], nextCursor: null},
    "evaluations.get": {run: {id: "run-1"}},
    "evaluations.start": {run: {id: "run-1"}},
    "evaluations.cancel": {run: {id: "run-1"}},
    "skills.list": {repositories: [], skills: [], nextCursor: null},
    "skill_versions.list": {versions: [], nextCursor: null},
    "skills.get": {skill: {id: "skill-1"}},
}

describe("control-plane contracts", () => {
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
                "evaluations.list": "evaluations.read",
                "evaluations.get": "evaluations.read",
                "evaluations.start": "evaluations.execute",
                "evaluations.cancel": "evaluations.execute",
                "skills.list": "skills.read",
                "skill_versions.list": "skills.read",
                "skills.get": "skills.read",
            },
        )
        assert.deepEqual(Object.keys(METHOD_DEFINITIONS), CONTROL_METHODS)
    })

    it("freezes every method definition against action and schema replacement", () => {
        assert.ok(Object.isFrozen(METHOD_DEFINITIONS))
        for (const method of CONTROL_METHODS) {
            const definition = controlDefinition(method)
            const {action, input, output} = definition

            assert.ok(Object.isFrozen(definition), `${method} definition should be frozen`)
            assert.equal(Reflect.set(definition, "action", "context.read"), false)
            assert.equal(Reflect.set(definition, "input", null), false)
            assert.equal(Reflect.deleteProperty(definition, "output"), false)
            assert.equal(Reflect.set(METHOD_DEFINITIONS, method, {}), false)
            assert.equal(controlDefinition(method).action, action)
            assert.equal(controlDefinition(method).input, input)
            assert.equal(controlDefinition(method).output, output)
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
                status: "valid",
                warningCount: 0,
            }],
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
            ["skills.list", "skills"],
            ["skill_versions.list", "versions"],
        ]) {
            const item = method === "skills.list"
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
        ]) {
            assert.throws(
                () => createPublicControlError(invalid[0], {details: invalid[1]}),
                /invalid|unrecognized|expected|resource|method|reason|payload/iu,
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
