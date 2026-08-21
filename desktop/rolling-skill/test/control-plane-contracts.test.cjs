const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    CONTROL_METHODS,
    METHOD_DEFINITIONS,
    controlDefinition,
    decodeCursor,
    encodeCursor,
    parseControlInput,
    parseControlOutput,
    publicControlError,
} = require("../src/control-plane/contracts.cjs")

const rawCase = {
    question: "Which service caused the July cost increase?",
    skill: {name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
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
    "skills.get": {skillId: "skill-1"},
}

const validOutputs = {
    "context.get": {workspaceRoot: "/workspace", runtimes: []},
    "raw_cases.list": {rawCases: [], nextCursor: null},
    "raw_cases.enqueue": {created: [], duplicates: [], rejected: []},
    "raw_cases.update": {rawCase: {id: "raw-case-1"}},
    "raw_cases.dispatch": {threadId: "thread-1", turnId: null},
    "runtimes.list": {runtimes: []},
    "runtimes.models": {models: []},
    "datasets.list": {datasets: [], nextCursor: null},
    "datasets.get": {dataset: {id: "dataset-1"}, cases: []},
    "evaluations.list": {runs: [], nextCursor: null},
    "evaluations.get": {run: {id: "run-1"}},
    "evaluations.start": {run: {id: "run-1"}},
    "evaluations.cancel": {run: {id: "run-1"}},
    "skills.list": {skills: [], nextCursor: null},
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
                "skills.get": "skills.read",
            },
        )
        assert.deepEqual(Object.keys(METHOD_DEFINITIONS), CONTROL_METHODS)
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

    it("returns a bounded public error without stacks, causes, secrets, or nested errors", () => {
        const nested = new Error("database internals")
        const error = Object.assign(new Error("denied"), {
            code: "FORBIDDEN",
            retryable: true,
            details: {
                action: "evaluations.execute",
                retryAfterMs: 250,
                scopes: ["evaluations.read", "evaluations.execute"],
                nested: {host: "private-host"},
                error: nested,
                stack: "private stack",
                token: "secret-token",
            },
            arbitrary: "must not leak",
            cause: nested,
        })

        const result = publicControlError(error)

        assert.deepEqual(Object.keys(result), ["code", "message", "retryable", "details"])
        assert.deepEqual(result, {
            code: "FORBIDDEN",
            message: "denied",
            retryable: true,
            details: {
                action: "evaluations.execute",
                retryAfterMs: 250,
                scopes: ["evaluations.read", "evaluations.execute"],
            },
        })
        assert.equal("stack" in result, false)
        assert.equal(JSON.stringify(result).includes("private-host"), false)
        assert.equal(JSON.stringify(result).includes("secret-token"), false)
        assert.equal(JSON.stringify(result).includes("database internals"), false)
    })

    it("normalizes invalid error metadata to safe defaults", () => {
        assert.deepEqual(publicControlError({
            message: "x".repeat(5_000),
            code: "bad code",
            retryable: "yes",
            details: {nested: {value: true}},
        }), {
            code: "CONTROL_ERROR",
            message: "x".repeat(4_000),
            retryable: false,
            details: null,
        })
    })

    it("reads error metadata once and bounds the number of public detail fields", () => {
        let codeReads = 0
        const changingError = {
            get code() {
                codeReads += 1
                return codeReads < 3 ? "FORBIDDEN" : "STACK_LEAK"
            },
            message: "denied",
        }
        const manyDetails = Object.fromEntries(
            Array.from({length: 60}, (_, index) => [`field${index}`, index]),
        )

        assert.equal(publicControlError(changingError).code, "FORBIDDEN")
        assert.equal(codeReads, 1)
        assert.equal(Object.keys(publicControlError({details: manyDetails}).details).length, 50)
    })
})
