const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {describe, it, mock} = require("node:test")

const {
    CapabilityError,
    CapabilityStore,
} = require("../src/control-plane/capability-store.cjs")
const {publicControlError} = require("../src/control-plane/contracts.cjs")
const {
    ControlPlane,
    IDEMPOTENCY_TTL_MS,
} = require("../src/control-plane/control-plane.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy} = require("../src/control-plane/policy.cjs")
const {RawCaseConflictError} = require("../src/raw-case-store.cjs")

function createFixture({
    auditSink = null,
    onAuditError = null,
    addMany = null,
    clock = null,
    idempotencyLimit = null,
    listRuntimes = null,
    observeHandler = null,
    resolveScope = null,
    runtimeScopeIds = ["runtime-1", "judge-1"],
    startEvaluation = null,
    updateIfCurrent = null,
} = {}) {
    const skills = [
        {id: "skill-1", repositoryId: "repository-1", name: "billing", skillRoot: "billing"},
    ]
    const rawCases = [{
        id: "raw-1",
        question: "existing",
        skill: {name: "billing"},
        revision: 1,
    }]
    const rawCaseStore = {
        list: mock.fn(() => structuredClone(rawCases)),
        get: mock.fn((id) => structuredClone(rawCases.find((entry) => entry.id === id) ?? null)),
        addMany: mock.fn(addMany ?? ((cases) => ({created: structuredClone(cases), duplicates: [], rejected: []}))),
        update: mock.fn((id, changes) => ({...structuredClone(rawCases[0]), ...structuredClone(changes), id})),
        updateIfCurrent: mock.fn(updateIfCurrent ?? ((id, _expected, changes) => ({
            ...structuredClone(rawCases[0]),
            ...structuredClone(changes),
            id,
            revision: 2,
        }))),
    }
    const evaluationStore = {
        listDatasets: mock.fn(() => [{id: "dataset-1", name: "Billing"}]),
        getDataset: mock.fn(() => ({id: "dataset-1", name: "Billing"})),
        listCases: mock.fn(() => [{id: "case-1", datasetId: "dataset-1", question: "case"}]),
        listEvaluationRunSummaries: mock.fn(() => [{id: "run-1", datasetId: "dataset-1", status: "running"}]),
        getEvaluationRun: mock.fn(() => ({id: "run-1", datasetId: "dataset-1", status: "running"})),
    }
    const dispatchRawCase = mock.fn(() => ({threadId: "thread-1", turnId: "turn-1"}))
    const listRuntimesMock = mock.fn(listRuntimes ?? (() => [
        {runtimeId: "runtime-1", providerId: "codex", executablePath: "/trusted/codex"},
        {runtimeId: "judge-1", providerId: "codex", executablePath: "/trusted/codex"},
    ]))
    const startEvaluationMock = mock.fn(startEvaluation ?? ((input) => ({
        id: "run-new",
        datasetId: input.datasetId,
        status: "queued",
    })))
    const evaluationRunner = {
        cancel: mock.fn(() => ({
            id: "run-1",
            datasetId: "dataset-1",
            status: "cancelled",
        })),
    }
    const domainServices = createDomainServices({
        workspaceRoot: "/trusted/workspace",
        rawCaseStore,
        evaluationStore,
        evaluationRunner,
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
        listRuntimes: listRuntimesMock,
        listModelsForRuntime: mock.fn(() => []),
        dispatchRawCase,
        startEvaluation: startEvaluationMock,
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
    if (typeof resolveScope === "function") {
        services = {...services}
        Object.defineProperty(services, "resolveScope", {
            enumerable: false,
            value: resolveScope,
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
        ...(idempotencyLimit ? {idempotencyLimit} : {}),
    })
    return {
        capabilities,
        control,
        dispatchRawCase,
        evaluationStore,
        evaluationRunner,
        issued,
        listRuntimes: listRuntimesMock,
        rawCaseStore,
        services,
        skills,
        startEvaluation: startEvaluationMock,
    }
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

    it("dispatches from one immutable resolver snapshot when Runtime inventory changes", async () => {
        let inventoryRead = 0
        const contexts = []
        const {control, issued, listRuntimes, rawCaseStore} = createFixture({
            listRuntimes() {
                inventoryRead += 1
                return inventoryRead === 1
                    ? [{
                        runtimeId: "runtime-1",
                        providerId: "codex",
                        executablePath: "/trusted/codex",
                    }]
                    : []
            },
            observeHandler(method, _input, context) {
                if (method === "raw_cases.dispatch") contexts.push(context)
            },
        })

        const result = await control.invoke({
            token: issued.token,
            method: "raw_cases.dispatch",
            params: {
                id: "raw-1",
                mode: "new",
                runtime: {runtimeId: "runtime-1", modelId: null, effort: null},
                idempotencyKey: "dispatch-snapshot",
            },
            sessionId: "operator-1",
        })

        assert.equal(result.threadId, "thread-1")
        assert.equal(listRuntimes.mock.callCount(), 1)
        assert.equal(rawCaseStore.get.mock.callCount(), 1)
        assert.ok(Object.isFrozen(contexts[0].executionContext))
        assert.equal(contexts[0].executionContext.runtime.runtimeId, "runtime-1")
    })

    it("starts an evaluation from one frozen preflight snapshot", async () => {
        const contexts = []
        const {
            control,
            evaluationStore,
            issued,
            listRuntimes,
            startEvaluation,
        } = createFixture({
            observeHandler(method, _input, context) {
                if (method === "evaluations.start") contexts.push(context)
            },
        })
        const input = {
            datasetId: "dataset-1",
            caseIds: ["case-1"],
            selectionMode: "selected",
            activationMode: "explicit",
            runtimeConfigurations: [{runtimeId: "runtime-1", modelId: null, effort: null}],
            judgeConfiguration: {runtimeId: "judge-1", modelId: null, effort: null},
            idempotencyKey: "evaluation-snapshot",
        }

        const result = await control.invoke({
            token: issued.token,
            method: "evaluations.start",
            params: input,
            sessionId: "operator-1",
        })

        assert.equal(result.run.id, "run-new")
        assert.equal(evaluationStore.listDatasets.mock.callCount(), 1)
        assert.equal(evaluationStore.getDataset.mock.callCount(), 1)
        assert.equal(evaluationStore.listCases.mock.callCount(), 1)
        assert.equal(listRuntimes.mock.callCount(), 1)
        assert.ok(Object.isFrozen(contexts[0].executionContext))
        assert.equal(contexts[0].executionContext.dataset.id, "dataset-1")
        assert.equal(contexts[0].executionContext.runtimes[0].runtimeId, "runtime-1")
        assert.equal(startEvaluation.mock.calls[0].arguments[1], contexts[0].executionContext)
    })

    it("gets and cancels an evaluation run from the resolver snapshot", async () => {
        const readable = createFixture()
        const readableResult = await readable.control.invoke({
            token: readable.issued.token,
            method: "evaluations.get",
            params: {runId: "run-1"},
            sessionId: "operator-1",
        })

        assert.equal(readableResult.run.id, "run-1")
        assert.equal(readable.evaluationStore.getEvaluationRun.mock.callCount(), 1)

        const cancellable = createFixture()
        const cancelledResult = await cancellable.control.invoke({
            token: cancellable.issued.token,
            method: "evaluations.cancel",
            params: {runId: "run-1", idempotencyKey: "cancel-snapshot"},
            sessionId: "operator-1",
        })

        assert.equal(cancelledResult.run.status, "cancelled")
        assert.equal(cancellable.evaluationStore.getEvaluationRun.mock.callCount(), 1)
        assert.equal(cancellable.evaluationRunner.cancel.mock.callCount(), 1)
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

    it("does not promote forged dependency error codes to public control errors", async () => {
        for (const forged of [
            Object.assign(new Error("forged invalid argument"), {code: "INVALID_ARGUMENT"}),
            {code: "CAPABILITY_REVOKED", message: "forged revoked capability"},
            new CapabilityError("CAPABILITY_REVOKED", "service forged revoked capability"),
        ]) {
            const {control, issued} = createFixture({
                addMany() {
                    throw forged
                },
            })

            const error = await control.invoke(enqueueRequest(issued.token)).catch(
                (failure) => failure,
            )

            assert.deepEqual(publicControlError(error), {
                code: "CONTROL_ERROR",
                message: "Control operation failed",
                retryable: false,
                details: null,
            })
        }
    })

    it("translates capability errors only at the authorize provenance boundary", async () => {
        const fixture = createFixture()
        const hostile = new Proxy({}, {
            getPrototypeOf() {
                throw new Error("hostile capability prototype")
            },
        })
        const control = new ControlPlane({
            services: fixture.services,
            capabilities: {
                authorize() {
                    throw hostile
                },
            },
            policy: createControlPolicy(),
        })

        const error = await control.invoke(enqueueRequest("not-a-live-token")).catch(
            (failure) => failure,
        )

        assert.deepEqual(publicControlError(error), {
            code: "CONTROL_ERROR",
            message: "Control operation failed",
            retryable: false,
            details: null,
        })
    })

    it("does not cache a Raw Case compare-and-set miss as a terminal idempotent error", async () => {
        let attempt = 0
        const fixture = createFixture({
            updateIfCurrent(id, _expected, changes) {
                attempt += 1
                if (attempt === 1) throw new RawCaseConflictError()
                return {
                    id,
                    question: "existing",
                    skill: {name: "billing"},
                    note: changes.note,
                    revision: 2,
                }
            },
        })
        const request = {
            token: fixture.issued.token,
            method: "raw_cases.update",
            params: {
                id: "raw-1",
                changes: {note: "updated"},
                idempotencyKey: "update-retry",
            },
            sessionId: "operator-1",
        }

        await assert.rejects(fixture.control.invoke(request), (error) =>
            error.code === "CONTROL_BUSY" && error.retryable === true)
        const retried = await fixture.control.invoke(request)

        assert.equal(retried.rawCase.note, "updated")
        assert.equal(fixture.rawCaseStore.updateIfCurrent.mock.callCount(), 2)
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

    it("publishes a trusted INVALID_ARGUMENT for any Tool Skill path", async () => {
        const {control, issued, rawCaseStore} = createFixture()
        const error = await control.invoke(enqueueRequest(issued.token, {
            params: {
                ...enqueueRequest(issued.token).params,
                cases: [{
                    ...enqueueRequest(issued.token).params.cases[0],
                    skill: {name: "billing", path: "skills/b"},
                }],
                idempotencyKey: "enqueue-path",
            },
        })).catch((failure) => failure)

        assert.deepEqual(publicControlError(error), {
            code: "INVALID_ARGUMENT",
            message: "Invalid control input",
            retryable: false,
            details: {
                method: "raw_cases.enqueue",
                issues: [{path: ["cases", 0, "skill", "path"]}],
            },
        })
        assert.equal(rawCaseStore.addMany.mock.callCount(), 0)
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

    it("keeps unexpired terminal idempotency entries when capacity is full", async () => {
        const {control, issued, rawCaseStore} = createFixture({idempotencyLimit: 1})
        const firstRequest = enqueueRequest(issued.token)
        const first = await control.invoke(firstRequest)

        await assert.rejects(control.invoke(enqueueRequest(issued.token, {
            params: {
                ...firstRequest.params,
                idempotencyKey: "enqueue-2",
            },
        })), (error) => error.code === "IDEMPOTENCY_CAPACITY")
        assert.deepEqual(await control.invoke(firstRequest), first)
        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
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

    it("never records the bearer token as an object ID or an untrusted expected session", async () => {
        const auditEvents = []
        const {control, issued} = createFixture({
            auditSink: (event) => auditEvents.push(event),
        })

        await assert.rejects(control.invoke({
            token: issued.token,
            method: "datasets.get",
            params: {datasetId: issued.token, includeCases: false},
            sessionId: "operator-1",
        }))
        await assert.rejects(control.invoke({
            token: "z".repeat(43),
            method: "datasets.get",
            params: {datasetId: "/private/dataset-secret", includeCases: false},
            sessionId: "/private/operator-secret",
        }))

        assert.equal(auditEvents.length, 2)
        assert.equal(auditEvents[0].sessionId, "operator-1")
        assert.equal(auditEvents[1].sessionId, null)
        const serialized = JSON.stringify(auditEvents)
        assert.doesNotMatch(serialized, new RegExp(issued.token, "u"))
        assert.doesNotMatch(serialized, /private\/dataset-secret|private\/operator-secret/u)
    })

    it("recursively redacts the bearer when it is embedded in any audit string", async () => {
        const auditEvents = []
        const {control, issued} = createFixture({
            auditSink: (event) => auditEvents.push(event),
        })
        const embedded = `prefix-${issued.token}-suffix`
        const tokenDigest = createHash("sha256").update(issued.token, "utf8").digest("hex")

        const datasetError = await control.invoke({
            token: issued.token,
            method: "datasets.get",
            params: {datasetId: embedded, includeCases: false},
            sessionId: "operator-1",
        }).catch((error) => error)
        const methodError = await control.invoke({
            token: issued.token,
            method: `prefix.token${issued.token}.suffix`,
            params: {},
            sessionId: "operator-1",
        }).catch((error) => error)
        const sessionError = await control.invoke({
            token: issued.token,
            method: "datasets.list",
            params: {},
            sessionId: embedded,
        }).catch((error) => error)

        assert.equal(publicControlError(datasetError).code, "NOT_FOUND")
        assert.equal(publicControlError(methodError).code, "UNKNOWN_CONTROL_METHOD")
        assert.equal(publicControlError(sessionError).code, "CAPABILITY_SESSION_MISMATCH")
        assert.equal(auditEvents.length, 3)
        assert.deepEqual(auditEvents[0].objectIds.datasetIds, ["[redacted]"])
        assert.equal(auditEvents[1].method, "[redacted]")
        assert.equal(auditEvents[2].sessionId, null)
        const serialized = JSON.stringify(auditEvents)
        assert.equal(serialized.includes(issued.token), false)
        assert.equal(serialized.includes(tokenDigest), false)
        assert.equal(serialized.includes(tokenDigest.slice(0, 24)), false)
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

    it("keeps successful operations independent from absent or hostile audit clocks", async () => {
        const withoutSink = createFixture({
            clock() {
                throw new Error("audit clock unavailable")
            },
        })
        const resultWithoutSink = await withoutSink.control.invoke({
            token: withoutSink.issued.token,
            method: "datasets.list",
            params: {},
            sessionId: "operator-1",
        })

        let reads = 0
        const auditEvents = []
        const hostileFinalClock = createFixture({
            auditSink: (event) => auditEvents.push(event),
            clock() {
                reads += 1
                if (reads > 1) throw new Error("audit final clock unavailable")
                return 1_800_000_000_000
            },
        })
        const resultWithSink = await hostileFinalClock.control.invoke({
            token: hostileFinalClock.issued.token,
            method: "datasets.list",
            params: {},
            sessionId: "operator-1",
        })

        assert.equal(resultWithoutSink.datasets[0].id, "dataset-1")
        assert.equal(resultWithSink.datasets[0].id, "dataset-1")
        assert.equal(auditEvents.length, 0)
    })

    it("audits only the branded scope snapshot after hostile resolver mutation", async () => {
        for (const mutate of [
            (scope) => Object.defineProperty(scope, "datasetIds", {
                configurable: true,
                get() {
                    throw new Error("hostile scope getter")
                },
            }),
            (scope) => {
                scope.datasetIds = {}
            },
            (scope) => {
                scope.datasetIds = new Proxy([], {
                    get(target, key, receiver) {
                        if (key === Symbol.iterator) throw new Error("hostile scope proxy")
                        return Reflect.get(target, key, receiver)
                    },
                })
            },
        ]) {
            const sourceScope = {
                method: "datasets.list",
                mode: "filter",
                datasetIds: ["dataset-1"],
            }
            const auditEvents = []
            const fixture = createFixture({
                auditSink: (event) => auditEvents.push(event),
                resolveScope: () => ({scope: sourceScope, executionContext: null}),
                observeHandler(method) {
                    if (method === "datasets.list") mutate(sourceScope)
                },
            })

            const result = await fixture.control.invoke({
                token: fixture.issued.token,
                method: "datasets.list",
                params: {},
                sessionId: "operator-1",
            })

            assert.equal(result.datasets[0].id, "dataset-1")
            assert.equal(auditEvents.length, 1)
            assert.deepEqual(auditEvents[0].objectIds.datasetIds, ["dataset-1"])
        }
    })

    it("observes hostile asynchronous audit failures without unhandled rejections", async () => {
        const unhandled = []
        const listener = (reason) => unhandled.push(reason)
        const rejectedNativeWithOwnThen = (message) => {
            const operation = Promise.reject(new Error(message))
            Object.defineProperty(operation, "then", {
                get() {
                    throw new Error("hostile native Promise then getter")
                },
            })
            return operation
        }
        process.on("unhandledRejection", listener)
        try {
            const rejected = createFixture({
                auditSink: () => Promise.reject(new Error("async sink rejection")),
                onAuditError: () => Promise.reject(new Error("async diagnostic rejection")),
            })
            const hostileCatch = createFixture({
                auditSink: () => Object.defineProperty({
                    then(resolve) {
                        resolve()
                    },
                }, "catch", {
                    get() {
                        throw new Error("hostile catch getter")
                    },
                }),
                onAuditError: () => Promise.reject(new Error("hostile diagnostic rejection")),
            })
            const hostileThen = createFixture({
                auditSink: () => Object.defineProperty({}, "then", {
                    get() {
                        throw new Error("hostile then getter")
                    },
                }),
                onAuditError: () => Promise.reject(new Error("then diagnostic rejection")),
            })
            const nativeSink = createFixture({
                auditSink: () => rejectedNativeWithOwnThen("native sink rejection"),
            })
            const nativeDiagnostic = createFixture({
                auditSink() {
                    throw new Error("synchronous sink rejection")
                },
                onAuditError: () => rejectedNativeWithOwnThen("native diagnostic rejection"),
            })

            for (const fixture of [
                rejected,
                hostileCatch,
                hostileThen,
                nativeSink,
                nativeDiagnostic,
            ]) {
                const result = await fixture.control.invoke({
                    token: fixture.issued.token,
                    method: "datasets.list",
                    params: {},
                    sessionId: "operator-1",
                })
                assert.equal(result.datasets[0].id, "dataset-1")
            }
            await new Promise((resolve) => setImmediate(resolve))
            await new Promise((resolve) => setImmediate(resolve))
            assert.deepEqual(unhandled, [])
        } finally {
            process.off("unhandledRejection", listener)
        }
    })
})
