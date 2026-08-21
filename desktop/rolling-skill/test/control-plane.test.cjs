const assert = require("node:assert/strict")
const {describe, it, mock} = require("node:test")

const {CapabilityStore} = require("../src/control-plane/capability-store.cjs")
const {publicControlError} = require("../src/control-plane/contracts.cjs")
const {
    ControlPlane,
    IDEMPOTENCY_TTL_MS,
} = require("../src/control-plane/control-plane.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy} = require("../src/control-plane/policy.cjs")

function createFixture({
    auditSink = null,
    onAuditError = null,
    addMany = null,
    clock = null,
    observeHandler = null,
    runtimeScopeIds = ["runtime-1", "judge-1"],
} = {}) {
    const skills = [
        {id: "skill-1", repositoryId: "repository-1", name: "billing", skillRoot: "billing"},
    ]
    const rawCases = [{id: "raw-1", question: "existing", skill: {name: "billing"}}]
    const rawCaseStore = {
        list: mock.fn(() => structuredClone(rawCases)),
        get: mock.fn((id) => structuredClone(rawCases.find((entry) => entry.id === id) ?? null)),
        addMany: mock.fn(addMany ?? ((cases) => ({created: structuredClone(cases), duplicates: [], rejected: []}))),
        update: mock.fn((id, changes) => ({...structuredClone(rawCases[0]), ...structuredClone(changes), id})),
    }
    const evaluationStore = {
        listDatasets: mock.fn(() => [{id: "dataset-1", name: "Billing"}]),
        getDataset: mock.fn(() => ({id: "dataset-1", name: "Billing"})),
        listCases: mock.fn(() => [{id: "case-1", datasetId: "dataset-1", question: "case"}]),
        listEvaluationRunSummaries: mock.fn(() => [{id: "run-1", datasetId: "dataset-1", status: "running"}]),
        getEvaluationRun: mock.fn(() => ({id: "run-1", datasetId: "dataset-1", status: "running"})),
    }
    const dispatchRawCase = mock.fn(() => ({threadId: "thread-1", turnId: "turn-1"}))
    const domainServices = createDomainServices({
        workspaceRoot: "/trusted/workspace",
        rawCaseStore,
        evaluationStore,
        evaluationRunner: {cancel: mock.fn(() => ({id: "run-1", datasetId: "dataset-1", status: "cancelled"}))},
        managedSkillManager: {
            overview: mock.fn(() => ({
                repositories: [],
                skills: structuredClone(skills),
                versions: [],
            })),
            readSkill: mock.fn(() => ({
                repository: {id: "repository-1", managedPath: "/private/managed"},
                skill: {id: "skill-1", repositoryId: "repository-1", name: "billing", skillRoot: "billing"},
                manifest: "skill",
                snapshot: {digest: "sha256:test"},
                versions: [],
            })),
        },
        listRuntimes: mock.fn(() => [
            {runtimeId: "runtime-1", providerId: "codex", executablePath: "/trusted/codex"},
            {runtimeId: "judge-1", providerId: "codex", executablePath: "/trusted/codex"},
        ]),
        listModelsForRuntime: mock.fn(() => []),
        dispatchRawCase,
        startEvaluation: mock.fn((input) => ({id: "run-new", datasetId: input.datasetId, status: "queued"})),
    })
    let services = domainServices
    if (typeof observeHandler === "function") {
        services = {...domainServices}
        for (const [method, handler] of Object.entries(domainServices)) {
            services[method] = async (input, context) => {
                observeHandler(method, input, context)
                return handler(input, context)
            }
        }
        Object.defineProperty(services, "resolveScope", {
            enumerable: false,
            value: domainServices.resolveScope,
        })
    }
    const capabilities = new CapabilityStore()
    const issued = capabilities.issue({
        sessionId: "operator-1",
        actions: [
            "context.read",
            "raw_cases.read",
            "raw_cases.write",
            "runtime.execute",
            "runtimes.read",
            "datasets.read",
            "evaluations.read",
            "evaluations.execute",
            "skills.read",
        ],
        scopes: {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: runtimeScopeIds,
        },
        expiresInMs: 60_000,
        budget: {maxRuntimeTurns: 1, maxEvaluations: 1},
    })
    const control = new ControlPlane({
        services,
        capabilities,
        policy: createControlPolicy(),
        auditSink,
        onAuditError,
        ...(clock ? {clock} : {}),
    })
    return {control, issued, rawCaseStore, dispatchRawCase, skills}
}

function enqueueRequest(token, overrides = {}) {
    return {
        token,
        method: "raw_cases.enqueue",
        params: {
            cases: [{
                question: "  exact secret question  ",
                skill: {name: "billing"},
                note: "",
                source: {kind: "operator"},
            }],
            idempotencyKey: "enqueue-1",
        },
        sessionId: "operator-1",
        ...overrides,
    }
}

describe("ControlPlane", () => {
    it("authorizes the expected session and replays one immutable idempotent result", async () => {
        const {control, issued, rawCaseStore} = createFixture()
        const request = enqueueRequest(issued.token)

        const first = await control.invoke(request)
        first.created[0].question = "mutated by caller"
        const repeated = await control.invoke(request)

        assert.equal(repeated.created[0].question, "  exact secret question  ")
        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
    })

    it("replays a terminal idempotent result without re-resolving mutable inventory", async () => {
        const {control, issued, rawCaseStore, skills} = createFixture()
        const request = enqueueRequest(issued.token)

        const first = await control.invoke(request)
        skills.splice(0)
        const repeated = await control.invoke(request)

        assert.deepEqual(repeated, first)
        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
    })

    it("requires a session ID and rejects cross-Operator token replay before a handler runs", async () => {
        const {control, issued, rawCaseStore} = createFixture()

        await assert.rejects(
            control.invoke(enqueueRequest(issued.token, {sessionId: undefined})),
            (error) => error.code === "INVALID_ARGUMENT",
        )
        await assert.rejects(control.invoke(
            enqueueRequest(issued.token, {sessionId: "operator-2"}),
        ), (error) => {
            assert.deepEqual(publicControlError(error), {
                code: "CAPABILITY_SESSION_MISMATCH",
                message: "Control capability belongs to another Operator session",
                retryable: false,
                details: null,
            })
            return true
        })
        assert.equal(rawCaseStore.addMany.mock.callCount(), 0)
    })

    it("coalesces concurrent requests with the same canonical input", async () => {
        let release
        const blocked = new Promise((resolve) => {
            release = resolve
        })
        const fixture = createFixture({
            addMany: async (cases) => {
                await blocked
                return {created: structuredClone(cases), duplicates: [], rejected: []}
            },
        })
        const request = enqueueRequest(fixture.issued.token)

        const first = fixture.control.invoke(request)
        const second = fixture.control.invoke(request)
        release()

        assert.deepEqual(await second, await first)
        assert.equal(fixture.rawCaseStore.addMany.mock.callCount(), 1)
    })

    it("rejects reuse of an idempotency key with a different canonical input", async () => {
        const {control, issued, rawCaseStore} = createFixture()
        await control.invoke(enqueueRequest(issued.token))

        await assert.rejects(control.invoke(enqueueRequest(issued.token, {
            params: {
                ...enqueueRequest(issued.token).params,
                cases: [{
                    ...enqueueRequest(issued.token).params.cases[0],
                    question: "different question",
                }],
            },
        })), (error) => {
            assert.deepEqual(publicControlError(error), {
                code: "IDEMPOTENCY_CONFLICT",
                message: "Idempotency key conflicts with another request",
                retryable: false,
                details: {method: "raw_cases.enqueue"},
            })
            return true
        })
        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
    })

    it("reserves execution budget once before dispatch and maps exhaustion to a public decision error", async () => {
        const {control, issued, dispatchRawCase} = createFixture()
        const base = {
            token: issued.token,
            method: "raw_cases.dispatch",
            params: {
                id: "raw-1",
                mode: "new",
                runtime: {runtimeId: "runtime-1", modelId: null, effort: null},
                idempotencyKey: "dispatch-1",
            },
            sessionId: "operator-1",
        }

        const first = await control.invoke(base)
        assert.deepEqual(await control.invoke(base), first)
        await assert.rejects(
            control.invoke({
                ...base,
                params: {...base.params, idempotencyKey: "dispatch-2"},
            }),
            (error) => {
                assert.deepEqual(publicControlError(error), {
                    code: "APPROVAL_REQUIRED",
                    message: "Control action requires approval",
                    retryable: false,
                    details: {action: "runtime.execute", reason: "budget_expansion"},
                })
                return true
            },
        )
        assert.equal(dispatchRawCase.mock.callCount(), 1)
    })

    it("resolves the requested Runtime before reserving execution budget", async () => {
        const {control, issued, dispatchRawCase} = createFixture({
            runtimeScopeIds: ["runtime-1", "judge-1", "runtime-missing"],
        })

        await assert.rejects(control.invoke({
            token: issued.token,
            method: "raw_cases.dispatch",
            params: {
                id: "raw-1",
                mode: "new",
                runtime: {runtimeId: "runtime-missing", modelId: null, effort: null},
                idempotencyKey: "dispatch-missing",
            },
            sessionId: "operator-1",
        }), (error) => error.code === "NOT_FOUND")

        const result = await control.invoke({
            token: issued.token,
            method: "raw_cases.dispatch",
            params: {
                id: "raw-1",
                mode: "new",
                runtime: {runtimeId: "runtime-1", modelId: null, effort: null},
                idempotencyKey: "dispatch-valid",
            },
            sessionId: "operator-1",
        })

        assert.equal(result.threadId, "thread-1")
        assert.equal(dispatchRawCase.mock.callCount(), 1)
    })

    it("passes only parsed authority metadata and the policy scope filter to handlers", async () => {
        const contexts = []
        const inputs = []
        const {control, issued} = createFixture({
            observeHandler(method, input, context) {
                if (method === "datasets.list") {
                    inputs.push(input)
                    contexts.push(context)
                }
            },
        })
        const original = control.services?.["datasets.list"]
        assert.equal(original, undefined, "ControlPlane service registry must remain private")

        const result = await control.invoke({
            token: issued.token,
            method: "datasets.list",
            params: {limit: 100},
            sessionId: "operator-1",
        })

        assert.deepEqual(result.datasets.map((entry) => entry.id), ["dataset-1"])
        assert.deepEqual(inputs, [{cursor: null, limit: 100}])
        assert.equal(contexts.length, 1)
        assert.equal(contexts[0].capabilityId, issued.id)
        assert.equal(contexts[0].sessionId, "operator-1")
        assert.deepEqual(contexts[0].scopeFilter, {datasetIds: ["dataset-1"]})
        assert.equal(Object.hasOwn(contexts[0], "token"), false)
        assert.doesNotMatch(JSON.stringify(contexts[0]), new RegExp(issued.token, "u"))
    })

    it("records bounded redacted audit events and ignores audit sink failures", async () => {
        const auditEvents = []
        const diagnostics = []
        const auditSink = mock.fn((event) => {
            auditEvents.push(event)
            throw new Error("/private/audit/path secret sink failure")
        })
        const {control, issued} = createFixture({
            auditSink,
            onAuditError: (diagnostic) => diagnostics.push(diagnostic),
        })

        const result = await control.invoke(enqueueRequest(issued.token))
        await new Promise((resolve) => setImmediate(resolve))

        assert.equal(result.created.length, 1)
        assert.equal(auditEvents.length, 1)
        assert.equal(auditEvents[0].capabilityId, issued.id)
        assert.equal(auditEvents[0].sessionId, "operator-1")
        assert.equal(auditEvents[0].method, "raw_cases.enqueue")
        assert.equal(auditEvents[0].outcome, "success")
        const serialized = JSON.stringify(auditEvents[0])
        assert.doesNotMatch(serialized, new RegExp(issued.token, "u"))
        assert.doesNotMatch(serialized, /exact secret question|private\/audit|trusted\/workspace/u)
        assert.deepEqual(diagnostics, [{code: "AUDIT_SINK_FAILED"}])
    })

    it("does not leak unknown handler exceptions", async () => {
        const {control, issued, rawCaseStore} = createFixture({
            addMany: () => {
                throw new Error("secret /absolute/path with stack material")
            },
        })

        await assert.rejects(
            control.invoke(enqueueRequest(issued.token)),
            (error) => {
                assert.equal(error.code, "CONTROL_ERROR")
                assert.equal(error.message, "Control operation failed")
                assert.doesNotMatch(error.message, /secret|absolute|stack/u)
                return true
            },
        )
        await assert.rejects(
            control.invoke(enqueueRequest(issued.token)),
            (error) => error.code === "CONTROL_ERROR" &&
                error.message === "Control operation failed",
        )
        assert.deepEqual(publicControlError(await control.invoke(
            enqueueRequest(issued.token),
        ).catch((error) => error)), {
            code: "CONTROL_ERROR",
            message: "Control operation failed",
            retryable: false,
            details: null,
        })
        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
    })

    it("publishes stable resource-only NOT_FOUND errors", async () => {
        const {control, issued} = createFixture()

        const error = await control.invoke({
            token: issued.token,
            method: "raw_cases.update",
            params: {
                id: "raw-missing",
                changes: {note: "updated"},
                idempotencyKey: "update-missing",
            },
            sessionId: "operator-1",
        }).catch((failure) => failure)

        assert.deepEqual(publicControlError(error), {
            code: "NOT_FOUND",
            message: "Control object was not found",
            retryable: false,
            details: {resource: "raw_case"},
        })
    })

    it("expires terminal idempotency snapshots after 24 hours", async () => {
        let now = 1_800_000_000_000
        const {control, issued, rawCaseStore} = createFixture({clock: () => now})
        const request = enqueueRequest(issued.token)

        await control.invoke(request)
        now += IDEMPOTENCY_TTL_MS + 1
        await control.invoke(request)

        assert.equal(rawCaseStore.addMany.mock.callCount(), 2)
    })

    it("digests path-shaped untrusted identifiers in audit records", async () => {
        const auditEvents = []
        const {control} = createFixture({auditSink: (event) => auditEvents.push(event)})

        await assert.rejects(control.invoke({
            token: "not-a-live-token",
            method: "/tmp/private/control-method",
            params: {},
            sessionId: "operator-1",
        }))

        assert.equal(auditEvents.length, 1)
        assert.doesNotMatch(JSON.stringify(auditEvents[0]), /\/tmp\/private/u)
        assert.match(auditEvents[0].method, /^sha256:/u)
    })

    it("rejects accessor-backed invocation envelopes without reading secrets and still audits", async () => {
        let reads = 0
        const auditEvents = []
        const {control} = createFixture({auditSink: (event) => auditEvents.push(event)})
        const request = Object.create(null, {
            method: {enumerable: true, value: "raw_cases.enqueue"},
            params: {enumerable: true, value: enqueueRequest("unused").params},
            sessionId: {enumerable: true, value: "operator-1"},
            token: {
                enumerable: true,
                get() {
                    reads += 1
                    throw new Error("bearer-secret /private/token")
                },
            },
        })

        const error = await control.invoke(request).catch((failure) => failure)

        assert.equal(reads, 0)
        assert.deepEqual(publicControlError(error), {
            code: "CONTROL_ERROR",
            message: "Control operation failed",
            retryable: false,
            details: null,
        })
        assert.equal(auditEvents.length, 1)
        assert.doesNotMatch(JSON.stringify(auditEvents[0]), /bearer-secret|private\/token/u)
    })
})
