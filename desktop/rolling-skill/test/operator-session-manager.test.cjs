const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {OperatorJobStore} = require("../src/operator/job-store.cjs")
const {OperatorJobEngine} = require("../src/operator/job-engine.cjs")
const {CapabilityStore} = require("../src/control-plane/capability-store.cjs")
const {ControlPlane} = require("../src/control-plane/control-plane.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy} = require("../src/control-plane/policy.cjs")
const {
    OperatorSessionManager,
} = require("../src/operator/operator-session-manager.cjs")

const directories = []

afterEach(() => {
    for (const directory of directories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function budget(overrides = {}) {
    return {
        maxDurationMs: 60_000,
        maxRuntimeTurns: 10,
        maxEvaluations: 2,
        maxTargetExecutions: 20,
        maxJudgeExecutions: 20,
        maxTokens: null,
        maxReportedCost: null,
        ...overrides,
    }
}

function runtime(overrides = {}) {
    return {
        runtimeId: "runtime-1",
        providerId: "codex",
        displayName: "Codex",
        version: "1.0.0",
        executablePath: "/Applications/Codex.app/Contents/Resources/codex",
        capabilities: ["threads", "reasoning-effort"],
        ...overrides,
    }
}

class FakeClient extends EventEmitter {
    constructor(options = {}) {
        super()
        this.options = options
        this.calls = []
        this.threadId = options.threadId ?? "runtime-thread-1"
        this.turn = 0
    }

    async start() {
        this.calls.push({method: "start"})
    }

    async startThread(options) {
        this.calls.push({method: "startThread", options})
        return {thread: {id: this.threadId, model: options.model ?? null, effort: options.effort ?? null}}
    }

    async setThreadName(threadId, name) {
        this.calls.push({method: "setThreadName", threadId, name})
    }

    async resumeThread(threadId, options) {
        this.calls.push({method: "resumeThread", threadId, options})
        return {thread: {id: threadId, model: options.model ?? null, effort: options.effort ?? null}}
    }

    async startTurn(threadId, input, options) {
        this.turn += 1
        const turn = {id: `turn-${this.turn}`, status: "inProgress"}
        this.calls.push({method: "startTurn", threadId, input, options, turn})
        return {turn}
    }

    async interruptTurn(threadId, turnId) {
        this.calls.push({method: "interruptTurn", threadId, turnId})
    }

    async stop() {
        this.calls.push({method: "stop"})
    }

    notify(method, params = {}) {
        this.emit("notification", {method, params})
    }
}

class FakeTransport {
    constructor({childEnvironment, selection = {kind: "codex-dynamic", ready: true}}) {
        this.environment = {...childEnvironment}
        this.selected = selection
        this.freezeCalls = []
    }

    freeze(descriptor, support) {
        this.freezeCalls.push({descriptor, support})
        return {...this.selected}
    }

    selection() {
        return {...this.selected}
    }

    dynamicTools() {
        return this.selected.kind === "codex-dynamic" ? [{type: "namespace", name: "rolling_skill"}] : []
    }

    mcpServers() {
        return ["acp-mcp", "dsh-mcp"].includes(this.selected.kind)
            ? [{name: "rolling-skill-operator"}]
            : []
    }

    childEnvironment() {
        return {...this.environment}
    }
}

class FakeControlPlane {
    constructor(grants, revoked) {
        this.grants = grants
        this.revoked = revoked
        this.invocations = []
        this.routes = new Map()
    }

    registerOperatorExecutor(input) {
        const current = this.routes.get(input.sessionId) ?? null
        if (current && input.replace !== current.lease) throw new Error("replacement lease required")
        const record = {...input, enabled: input.enabled !== false, registered: true}
        const lease = {
            disable: () => {
                if (this.routes.get(input.sessionId) !== record || !record.registered) return false
                record.enabled = false
                return true
            },
            enable: () => {
                if (this.routes.get(input.sessionId) !== record || !record.registered) return false
                record.enabled = true
                return true
            },
            unregister: () => {
                if (this.routes.get(input.sessionId) !== record || !record.registered) return false
                record.enabled = false
                record.registered = false
                this.routes.delete(input.sessionId)
                return true
            },
        }
        record.lease = lease
        this.routes.set(input.sessionId, record)
        if (current) {
            current.enabled = false
            current.registered = false
        }
        return lease
    }

    async invoke(request) {
        this.invocations.push(structuredClone(request))
        const grant = this.grants.find((entry) => entry.token === request.token)
        if (!grant || this.revoked.includes(grant.id)) throw Object.assign(new Error("revoked"), {code: "CAPABILITY_REVOKED"})
        const route = this.routes.get(request.sessionId)
        if (!route || route.capabilityId !== grant.id) throw Object.assign(new Error("revoked"), {code: "CAPABILITY_REVOKED"})
        if (!route.enabled || route.assertLive() !== true) throw Object.assign(new Error("busy"), {code: "CONTROL_BUSY"})
        const authorizedGrant = Object.freeze(Object.fromEntries(
            Object.entries(grant).filter(([key]) => key !== "token"),
        ))
        return route.execute({
            invocationId: `fake-invocation-${this.invocations.length}`,
            method: request.method,
            input: structuredClone(request.params),
            policyDecision: {decision: "allow", reservation: null},
            context: Object.freeze({
                capabilityId: grant.id,
                sessionId: grant.sessionId,
                grant: authorizedGrant,
                scopeFilter: null,
                executionContext: null,
            }),
        })
    }
}

function fixture(options = {}) {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-session-"))
    directories.push(directory)
    const store = options.store ?? new OperatorJobStore(join(directory, "jobs.json"))
    const descriptors = options.runtimes ?? [runtime()]
    const clients = []
    const registry = {
        discover: options.discover ?? (() => ({available: descriptors, selected: descriptors[0] ?? null})),
        createClient(descriptor, clientOptions) {
            const client = options.clientFactory?.(descriptor, clientOptions) ?? new FakeClient(clientOptions)
            clients.push(client)
            return client
        },
    }
    let capabilitySequence = 0
    const grants = []
    const revoked = []
    const capabilities = {
        issue(request) {
            capabilitySequence += 1
            if (options.issue) return options.issue(request, {capabilitySequence, grants})
            const grant = {
                id: `capability-${capabilitySequence}`,
                token: `private-token-${capabilitySequence}`,
                sessionId: request.sessionId,
                ...request,
            }
            grants.push(grant)
            return grant
        },
        revoke(id) {
            if (options.revoke) return options.revoke(id, {revoked})
            revoked.push(id)
            return true
        },
    }
    const controlPlane = options.controlPlane ?? new FakeControlPlane(grants, revoked)
    const engineCalls = []
    const engine = options.engine ?? {
        async execute(jobId, request) {
            engineCalls.push({method: "execute", jobId, request})
            return {status: "succeeded", jobId, stepId: `step-${engineCalls.length}`, result: {ok: true}}
        },
        async reconcile(jobId) {
            engineCalls.push({method: "reconcile", jobId})
            const job = store.getJob(jobId)
            if (job.status === "needs_recovery") store.transitionJob(jobId, "running")
            return {status: store.getJob(jobId).status, jobId}
        },
        async cancel(jobId) {
            engineCalls.push({method: "cancel", jobId})
            if (options.cancel) return options.cancel(jobId, {store, engineCalls})
            store.beginCancellation(jobId)
            return store.cancelJobTree(jobId).job
        },
        async interrupt(jobId, error) {
            engineCalls.push({method: "interrupt", jobId, error})
            if (!store.listSteps({jobId}).some((step) => step.status === "running")) {
                return store.getJob(jobId)
            }
            return store.interruptJob(jobId, error)
        },
    }
    const transports = []
    const manager = new OperatorSessionManager({
        store,
        engine,
        runtimeRegistry: registry,
        capabilities,
        controlPlane,
        controlSocketPath: "/private/operator-control.sock",
        transportFactory(input) {
            const transport = new FakeTransport({
                ...input,
                selection: options.transportSelection,
            })
            transports.push(transport)
            return transport
        },
        transportSupport: options.transportSupport ?? (() => ({dynamicToolsReady: true})),
        requestPermission: options.requestPermission,
        requestQuestion: options.requestQuestion,
        supportsNativeResume: options.supportsNativeResume,
        workspaceRoot: options.workspaceRoot ?? "/private/operator",
        resolveManagedSkillWorkspace: options.resolveManagedSkillWorkspace,
    })
    return {
        store,
        manager,
        clients,
        grants,
        revoked,
        transports,
        engineCalls,
        capabilities,
        controlPlane,
        engine,
        directory,
    }
}

function createInput(overrides = {}) {
    return {
        runtimeId: "runtime-1",
        modelId: "gpt-5.6",
        effort: "high",
        objective: "Improve the selected Skill and evaluate the result",
        actions: ["datasets.read", "evaluations.execute"],
        scopes: {
            skillIds: ["skill-1"],
            datasetIds: ["dataset-1"],
            runtimeIds: ["runtime-1"],
            repositoryIds: ["repository-1"],
        },
        budget: budget(),
        expiresInMs: 60_000,
        ...overrides,
    }
}

function completed(client, turnId = "turn-1") {
    client.notify("turn/completed", {
        threadId: client.threadId,
        turn: {id: turnId, status: "completed"},
    })
}

async function nextTick() {
    await new Promise((resolve) => setImmediate(resolve))
}

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return {promise, resolve, reject}
}

function makeWaitingApproval(store, parentJobId) {
    const step = store.createStep(parentJobId, {
        method: "evaluations.start",
        params: {datasetId: "dataset-1"},
        reservation: {evaluations: 1},
        idempotencyKey: `waiting-${parentJobId}`,
    })
    store.transitionStep(step.id, "waiting_approval")
    store.transitionJob(parentJobId, "waiting_approval")
    const approval = store.createApproval(parentJobId, {
        stepId: step.id,
        action: "evaluations.execute",
        scope: {datasetIds: ["dataset-1"]},
        proposedMutation: {
            method: "evaluations.start",
            params: {datasetId: "dataset-1"},
            reservation: {evaluations: 1},
            idempotencyKey: `waiting-${parentJobId}`,
        },
        risk: "budget_expansion",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    return {step, approval}
}

describe("OperatorSessionManager", () => {
    it("keeps every persisted Operator Runtime task out of ordinary Chat history", async () => {
        const context = fixture()
        const created = await context.manager.create(createInput())

        assert.equal(created.runtimeThreadId, "runtime-thread-1")
        assert.deepEqual([...context.manager.hiddenThreadIds()], ["runtime-thread-1"])
    })

    it("runs a preauthorized ControlPlane mutation through the Manager without approval", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-integration-"))
        directories.push(directory)
        const store = new OperatorJobStore(join(directory, "jobs.json"))
        let revision = 1
        let deleteCalls = 0
        const services = createDomainServices({
            evaluationStore: {
                listDatasets: () => [{id: "dataset-1", name: "Billing", revision}],
                getDataset: () => ({id: "dataset-1", name: "Billing", revision}),
                listCases: () => [{id: "case-1", datasetId: "dataset-1", revision: 1}],
                listEvaluationRunSummaries: () => [{id: "run-1", datasetId: "dataset-1", status: "completed"}],
                deleteDataset: () => {
                    deleteCalls += 1
                    return {id: "dataset-1", name: "Billing", revision}
                },
            },
        })
        const capabilities = new CapabilityStore()
        const controlPlane = new ControlPlane({
            services,
            capabilities,
            policy: createControlPolicy(),
        })
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.delete": ({params, controlContext}) => (
                    services["datasets.delete"](params, controlContext)
                ),
            },
        })
        const clients = []
        const manager = new OperatorSessionManager({
            store,
            engine,
            controlPlane,
            capabilities,
            runtimeRegistry: {
                discover: () => ({available: [runtime()], selected: runtime()}),
                createClient(_descriptor, options) {
                    const client = new FakeClient(options)
                    clients.push(client)
                    return client
                },
            },
            controlSocketPath: "/private/operator-control.sock",
            transportFactory(input) { return new FakeTransport(input) },
            transportSupport: () => ({dynamicToolsReady: true}),
            workspaceRoot: "/private/operator",
        })
        const created = await manager.create(createInput({
            actions: ["datasets.delete"],
        }))
        const result = await clients[0].options.requestTool({
            callId: "delete-approved-dataset",
            method: "datasets.delete",
            params: {datasetId: "dataset-1", idempotencyKey: "delete-approved-dataset"},
        })
        assert.equal(result.dataset.id, "dataset-1")
        const step = store.listSteps({jobId: created.parentJob.id})[0]
        const creation = store.listEvents(created.parentJob.id).find((event) => (
            event.kind === "operator_step_created" && event.stepId === step.id
        ))
        assert.equal(creation.trustedFacts.methodFacts.datasetRevision, 1)
        assert.doesNotMatch(JSON.stringify(creation.trustedFacts), /private|path|trace|token/iu)
        assert.equal(store.listApprovals(created.parentJob.id).length, 0)
        assert.equal(deleteCalls, 1)
    })

    it("binds a managed Skill workspace without persisting or accepting its path", async () => {
        let workspaceRoot = "/private/managed/repository-1/skills/billing"
        const first = fixture({
            resolveManagedSkillWorkspace: async (binding) => ({...binding, workspaceRoot}),
        })
        const created = await first.manager.create(createInput({
            managedSkillBinding: {repositoryId: "repository-1", skillId: "skill-1"},
        }))

        assert.equal(first.clients[0].options.workspaceRoot, workspaceRoot)
        const executor = [...first.controlPlane.routes.values()][0]
        assert.deepEqual(executor.contextSnapshot(), {
            workspaceRoot,
            runtimeId: "runtime-1",
        })
        const configuration = first.store.getSession(created.session.id).transcript.findLast(
            (entry) => entry.kind === "operator_session_configuration",
        )
        assert.equal(configuration.managedSkillBinding.repositoryId, "repository-1")
        assert.equal(configuration.managedSkillBinding.skillId, "skill-1")
        assert.equal(typeof configuration.managedSkillBinding.workspaceDigest, "string")
        assert.doesNotMatch(JSON.stringify(configuration), /private\/managed/iu)

        await assert.rejects(first.manager.create(createInput({
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-outside",
                path: "/attacker/path",
            },
        })), /binding/iu)
        await assert.rejects(first.manager.create(createInput({
            workspaceRoot: "/attacker/path",
        })), /unsupported field/iu)

        completed(first.clients[0])
        await nextTick()
        workspaceRoot = "/private/managed/repository-1/skills/moved"
        const resumedClients = []
        const restarted = new OperatorSessionManager({
            store: first.store,
            engine: first.engine,
            runtimeRegistry: {
                discover: () => ({available: [runtime()], selected: runtime()}),
                createClient(_descriptor, options) {
                    const client = new FakeClient(options)
                    resumedClients.push(client)
                    return client
                },
            },
            capabilities: first.capabilities,
            controlPlane: new FakeControlPlane(first.grants, first.revoked),
            controlSocketPath: "/private/operator-control.sock",
            transportFactory(input) { return new FakeTransport(input) },
            transportSupport: () => ({dynamicToolsReady: true}),
            resolveManagedSkillWorkspace: async (binding) => ({...binding, workspaceRoot}),
        })
        await assert.rejects(restarted.resume(created.session.id), /workspace changed/iu)
        assert.equal(resumedClients.length, 0)
    })

    it("binds a registered optimization Run workspace without accepting a caller path", async () => {
        const resolved = []
        const context = fixture({
            resolveManagedSkillWorkspace: async (binding) => {
                resolved.push(structuredClone(binding))
                return {
                    ...binding,
                    workspaceRoot: "/private/optimization-workspaces/run-1",
                }
            },
        })

        const created = await context.manager.create(createInput({
            actions: ["optimizations.read", "optimizations.execute"],
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                optimizationRunId: "run-1",
            },
        }))

        assert.deepEqual(resolved, [{
            repositoryId: "repository-1",
            skillId: "skill-1",
            optimizationRunId: "run-1",
        }])
        assert.equal(context.clients[0].options.workspaceRoot, "/private/optimization-workspaces/run-1")
        assert.deepEqual(created.parentJob.checkpoint, {optimizationRunId: "run-1"})
        const configuration = context.store.getSession(created.session.id).transcript.findLast(
            (entry) => entry.kind === "operator_session_configuration",
        )
        assert.equal(configuration.managedSkillBinding.optimizationRunId, "run-1")
        assert.doesNotMatch(JSON.stringify(configuration), /private\/optimization-workspaces/iu)

        await assert.rejects(context.manager.create(createInput({
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                optimizationRunId: "run-2",
                workspaceRoot: "/attacker/path",
            },
        })), /binding|unsupported/iu)
    })

    it("binds a Skill edit session workspace and rejects two workspace specializations", async () => {
        const resolved = []
        const context = fixture({
            resolveManagedSkillWorkspace: async (binding) => {
                resolved.push(structuredClone(binding))
                return {
                    ...binding,
                    workspaceRoot: "/private/skill-edit-workspaces/edit-1",
                }
            },
        })

        const created = await context.manager.create(createInput({
            actions: ["skills.read"],
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                skillEditSessionId: "edit-1",
            },
        }))

        assert.deepEqual(resolved, [{
            repositoryId: "repository-1",
            skillId: "skill-1",
            skillEditSessionId: "edit-1",
        }])
        assert.equal(context.clients[0].options.workspaceRoot, "/private/skill-edit-workspaces/edit-1")
        assert.deepEqual(created.parentJob.checkpoint, {skillEditSessionId: "edit-1"})
        const configuration = context.store.getSession(created.session.id).transcript.findLast(
            (entry) => entry.kind === "operator_session_configuration",
        )
        assert.equal(configuration.managedSkillBinding.skillEditSessionId, "edit-1")
        assert.doesNotMatch(JSON.stringify(configuration), /private\/skill-edit-workspaces/iu)

        await assert.rejects(context.manager.create(createInput({
            managedSkillBinding: {
                repositoryId: "repository-1",
                skillId: "skill-1",
                optimizationRunId: "run-1",
                skillEditSessionId: "edit-2",
            },
        })), /two workspaces|binding/iu)
    })

    it("rejects UI-only authority before issuing an Operator capability", async () => {
        const context = fixture()

        await assert.rejects(
            context.manager.create(createInput({actions: ["approvals.resolve", "jobs.control"]})),
            /Operator action|exposed/iu,
        )
        assert.equal(context.grants.length, 0)
        assert.equal(context.clients.length, 0)
    })

    it("freezes authority and transport, persists one parent Job, and starts an independent selected Runtime", async () => {
        const chatClient = {calls: []}
        const {manager, store, clients, grants, transports} = fixture()
        const created = await manager.create(createInput())

        assert.equal(clients.length, 1)
        assert.notEqual(clients[0], chatClient)
        assert.deepEqual(grants[0].actions, createInput().actions)
        assert.deepEqual(grants[0].scopes, createInput().scopes)
        assert.deepEqual(grants[0].budget, {maxRuntimeTurns: 10, maxEvaluations: 2})
        assert.equal(transports[0].freezeCalls.length, 1)
        assert.equal(transports[0].environment.ROLLING_SKILL_CONTROL_TOKEN, "private-token-1")

        const session = store.getSession(created.session.id)
        const parent = store.getJob(created.parentJob.id)
        assert.equal(session.runtime.runtimeId, "runtime-1")
        assert.equal(session.modelId, "gpt-5.6")
        assert.equal(session.effort, "high")
        assert.equal(session.protocol, "rolling-skill-operator/v1")
        assert.equal(parent.parentJobId, null)
        assert.equal(parent.status, "running")
        assert.equal(store.listJobs({sessionId: session.id}).length, 1)

        const startThread = clients[0].calls.find((call) => call.method === "startThread")
        const startTurn = clients[0].calls.find((call) => call.method === "startTurn")
        assert.equal(startThread.options.model, "gpt-5.6")
        assert.equal(startThread.options.effort, "high")
        assert.equal(startThread.options.dynamicTools[0].name, "rolling_skill")
        assert.deepEqual(startTurn.input.map((part) => part.type), ["text", "text"])
        assert.match(startTurn.input[0].text, /Rolling Skill Operator/iu)
        assert.equal(startTurn.input[1].text, createInput().objective)
        assert.equal(JSON.stringify(store.read()).includes("private-token-1"), false)
        assert.equal(JSON.stringify(startTurn.input).includes(runtime().executablePath), false)
    })

    it("sets an explicit user-facing Runtime task title before the first turn", async () => {
        const {manager, clients, store} = fixture()

        const created = await manager.create(createInput({title: "Skill 自动优化 · billing · adcf41f4"}))

        const runtimeCalls = clients[0].calls.filter(({method}) => (
            ["startThread", "setThreadName", "startTurn"].includes(method)
        ))
        assert.deepEqual(runtimeCalls.map(({method}) => method), [
            "startThread",
            "setThreadName",
            "startTurn",
        ])
        assert.deepEqual(runtimeCalls[1], {
            method: "setThreadName",
            threadId: "runtime-thread-1",
            name: "Skill 自动优化 · billing · adcf41f4",
        })
        const configuration = store.getSession(created.session.id).transcript.findLast(
            (entry) => entry.kind === "operator_session_configuration",
        )
        assert.equal(configuration.title, "Skill 自动优化 · billing · adcf41f4")
    })

    it("continues the Operator task when cosmetic Runtime naming is unavailable", async () => {
        const context = fixture({
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.setThreadName = async (threadId, name) => {
                    client.calls.push({method: "setThreadName", threadId, name})
                    throw Object.assign(new Error("thread/name/set unsupported"), {
                        code: "UNSUPPORTED",
                    })
                }
                return client
            },
        })

        const created = await context.manager.create(createInput({
            title: "Skill 自动优化 · billing · adcf41f4",
        }))

        assert.equal(created.parentJob.status, "running")
        assert.equal(context.clients[0].calls.some(({method}) => method === "setThreadName"), true)
        assert.equal(context.clients[0].calls.some(({method}) => method === "startTurn"), true)
    })

    it("omits unsupported effort from Runtime calls and durable session selection", async () => {
        const {manager, clients, store} = fixture({
            runtimes: [runtime({providerId: "minimal", capabilities: ["threads"]})],
            transportSupport: () => ({}),
            transportSelection: {kind: "cli", ready: true, executablePath: "/app/rolling-skill-tool"},
        })
        const created = await manager.create(createInput())
        const session = store.getSession(created.session.id)
        const threadCall = clients[0].calls.find((call) => call.method === "startThread")
        const turnCall = clients[0].calls.find((call) => call.method === "startTurn")

        assert.equal(session.effort, null)
        assert.equal(Object.hasOwn(threadCall.options, "effort"), false)
        assert.equal(Object.hasOwn(turnCall.options, "effort"), false)
    })

    it("revokes the private grant and persists nothing when transport preflight is unavailable", async () => {
        const {manager, store, revoked} = fixture({
            transportSelection: {
                kind: "unsupported",
                ready: false,
                reason: "Bundled Operator Tool is unavailable",
            },
        })

        await assert.rejects(() => manager.create(createInput()), /unavailable/iu)
        assert.deepEqual(revoked, ["capability-1"])
        assert.deepEqual(store.listSessions(), [])
        assert.deepEqual(store.listJobs(), [])
    })

    it("fails a newly persisted parent when Runtime startup fails without a concurrent stop", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-startup-failure-"))
        directories.push(directory)
        const store = new OperatorJobStore(join(directory, "jobs.json"))
        const context = fixture({
            store,
            engine: new OperatorJobEngine({store}),
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.startThread = async () => {
                    client.calls.push({method: "startThread"})
                    throw new Error("Runtime thread startup failed")
                }
                return client
            },
        })

        await assert.rejects(context.manager.create(createInput()), /startup failed/iu)
        assert.equal(context.store.listJobs().length, 1)
        assert.equal(context.store.listJobs()[0].status, "failed")
        assert.deepEqual(context.revoked, ["capability-1"])
    })

    it("persists ordered compact notifications and routes tools, permissions, and questions", async () => {
        const permissionRequests = []
        const questionRequests = []
        const {manager, clients, store, engineCalls, controlPlane, grants} = fixture({
            requestPermission: async (request) => {
                permissionRequests.push(request)
                return "accept"
            },
            requestQuestion: async (request) => {
                questionRequests.push(request)
                return {answers: [{questionId: "q1", answer: "yes"}]}
            },
        })
        const created = await manager.create(createInput())
        const client = clients[0]
        client.notify("item/completed", {
            threadId: client.threadId,
            turnId: "turn-1",
            item: {id: "assistant-1", type: "agentMessage", text: "I will inspect the Dataset."},
        })
        client.notify("item/completed", {
            threadId: client.threadId,
            turnId: "turn-1",
            item: {id: "command-1", type: "commandExecution", command: "secret command output", status: "completed"},
        })

        assert.deepEqual(await client.options.requestTool({
            callId: "call-1",
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), {ok: true})
        assert.deepEqual(controlPlane.invocations[0], {
            token: "private-token-1",
            sessionId: grants[0].sessionId,
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        })
        assert.match(engineCalls[0].request.idempotencyKey, /^operator:[a-f0-9]{64}$/u)
        assert.equal(Object.hasOwn(engineCalls[0].request, "reservation"), false)
        assert.deepEqual(await client.options.requestTool({
            callId: "call-2",
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), {ok: true})
        assert.notEqual(
            engineCalls[0].request.idempotencyKey,
            engineCalls[1].request.idempotencyKey,
        )
        assert.deepEqual(await controlPlane.invoke({
            token: grants[0].token,
            sessionId: grants[0].sessionId,
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), {ok: true})
        assert.equal(engineCalls.length, 3)

        assert.equal(await client.options.requestPermission({kind: "command"}), "accept")
        assert.deepEqual(await client.options.requestQuestion({questions: [{id: "q1"}]}), {
            answers: [{questionId: "q1", answer: "yes"}],
        })
        assert.equal(permissionRequests[0].operatorSessionId, created.session.id)
        assert.equal(questionRequests[0].operatorJobId, created.parentJob.id)

        const transcript = store.getSession(created.session.id).transcript
        assert.deepEqual(transcript.map((entry) => entry.sequence), transcript.map((_, index) => index + 1))
        assert.equal(transcript.some((entry) => entry.kind === "message" && entry.role === "assistant"), true)
        const activity = transcript.find((entry) => entry.kind === "activity" && entry.itemId === "command-1")
        assert.equal(activity.type, "commandExecution")
        assert.equal(JSON.stringify(activity).includes("secret command output"), false)
        assert.equal(transcript.some((entry) => entry.kind === "tool_call_completed"), true)
        assert.equal(transcript.some((entry) => entry.kind === "permission_resolved"), true)
        assert.equal(transcript.some((entry) => entry.kind === "question_resolved"), true)
    })

    it("queues child completion while active, wakes only at idle, and sends user follow-up at a boundary", async () => {
        const {manager, clients, store} = fixture()
        const created = await manager.create(createInput())
        const client = clients[0]
        const child = store.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "evaluation",
            objective: "Evaluate the candidate",
            budget: budget(),
        })
        store.transitionJob(child.id, "running")
        const artifact = store.createArtifact(child.id, {
            kind: "evaluation-summary",
            name: "summary.json",
            mediaType: "application/json",
            body: JSON.stringify({score: 1}),
        })
        store.transitionJob(child.id, "succeeded", {result: {artifactId: artifact.id}})

        const queued = await manager.notifyChildCompletion(created.session.id, child.id)
        assert.equal(queued.queued, true)
        assert.equal(client.calls.filter((call) => call.method === "startTurn").length, 1)
        completed(client)
        await nextTick()
        assert.equal(client.calls.filter((call) => call.method === "startTurn").length, 2)
        const environmentTurn = client.calls.filter((call) => call.method === "startTurn")[1]
        assert.match(environmentTurn.input[0].text, new RegExp(child.id, "u"))
        assert.match(environmentTurn.input[0].text, new RegExp(artifact.id, "u"))

        const followUp = manager.followUp(created.session.id, "Compare this result with the baseline")
        assert.equal((await followUp).queued, true)
        completed(client, "turn-2")
        await nextTick()
        const userTurn = client.calls.filter((call) => call.method === "startTurn")[2]
        assert.equal(userTurn.input[0].text, "Compare this result with the baseline")
    })

    it("pauses durably before a third Agent Turn and keeps its boundary queued", async () => {
        const {manager, clients, store} = fixture()
        const created = await manager.create(createInput({budget: {maxIterations: 2}}))
        const client = clients[0]
        const child = store.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "evaluation",
            objective: "Evaluate many Cases",
            budget: {maxIterations: 2},
        })
        store.transitionJob(child.id, "running")
        store.transitionJob(child.id, "succeeded", {result: {caseCount: 100}})

        await manager.notifyChildCompletion(created.session.id, child.id)
        completed(client, "turn-1")
        await nextTick()
        await manager.followUp(created.session.id, "Use the completed result")
        completed(client, "turn-2")
        await nextTick()
        await nextTick()

        assert.equal(client.calls.filter((call) => call.method === "startTurn").length, 2)
        assert.equal(store.getJob(created.parentJob.id).status, "paused")
        const transcript = store.getSession(created.session.id).transcript
        assert.deepEqual(transcript.filter((entry) => (
            entry.kind === "operator_iteration_started"
        )).map((entry) => ({iteration: entry.iteration, limit: entry.limit})), [
            {iteration: 1, limit: 2},
            {iteration: 2, limit: 2},
        ])
        assert.deepEqual(transcript.filter((entry) => (
            entry.kind === "operator_iteration_limit_reached"
        )).map((entry) => ({used: entry.used, limit: entry.limit, reason: entry.reason})), [{
            used: 2,
            limit: 2,
            reason: "max_iterations_reached",
        }])
        const pending = transcript.find((entry) => (
            entry.kind === "operator_boundary_enqueued" && entry.content === "Use the completed result"
        ))
        assert.ok(pending)
        assert.equal(transcript.some((entry) => (
            entry.kind === "operator_boundary_delivered" && entry.boundaryId === pending.boundaryId
        )), false)

        const resumed = await manager.resume(created.session.id)
        await nextTick()
        assert.equal(resumed.parentJob.status, "paused")
        assert.equal(client.calls.filter((call) => call.method === "startTurn").length, 2)
        assert.equal(store.getSession(created.session.id).transcript.filter((entry) => (
            entry.kind === "operator_iteration_limit_reached"
        )).length, 1)
    })

    it("does not count Evaluation Case fan-out as additional Operator iterations", async () => {
        const {manager, clients, store} = fixture()
        const created = await manager.create(createInput({budget: {maxIterations: 2}}))
        const result = await clients[0].options.requestTool({
            callId: "many-case-evaluation",
            method: "evaluations.start",
            params: {
                datasetId: "dataset-1",
                caseIds: Array.from({length: 100}, (_unused, index) => `case-${index + 1}`),
                selectionMode: "selected",
                activationMode: "automatic",
                runtimeConfigurations: [{runtimeId: "runtime-1", modelId: null, effort: null}],
                judgeConfiguration: {runtimeId: "runtime-1", modelId: null, effort: null},
                idempotencyKey: "many-case-evaluation",
            },
        })

        assert.deepEqual(result, {ok: true})
        assert.equal(store.getSession(created.session.id).transcript.filter((entry) => (
            entry.kind === "operator_iteration_started"
        )).length, 1)
        assert.equal(clients[0].calls.filter((call) => call.method === "startTurn").length, 1)
    })

    it("continues starting Agent Turns without iteration accounting for an unbounded session", async () => {
        const {manager, clients, store} = fixture()
        const created = await manager.create(createInput({budget: {}}))
        const client = clients[0]

        for (let index = 1; index <= 3; index += 1) {
            await manager.followUp(created.session.id, `Continue ${index}`)
            completed(client, `turn-${index}`)
            await nextTick()
        }

        assert.equal(client.calls.filter((call) => call.method === "startTurn").length, 4)
        assert.equal(store.getJob(created.parentJob.id).status, "running")
        assert.equal(store.getSession(created.session.id).transcript.some((entry) => (
            entry.kind === "operator_iteration_started" ||
            entry.kind === "operator_iteration_limit_reached"
        )), false)
    })

    it("does not restart a Runtime after the durable iteration ceiling is reached", async () => {
        const source = fixture()
        const created = await source.manager.create(createInput({budget: {maxIterations: 1}}))
        await source.manager.followUp(created.session.id, "Remain queued at the ceiling")
        completed(source.clients[0], "turn-1")
        await nextTick()
        await nextTick()
        assert.equal(source.store.getJob(created.parentJob.id).status, "paused")

        const restarted = fixture({store: source.store, supportsNativeResume: () => true})
        const restored = await restarted.manager.resume(created.session.id)

        assert.equal(restored.parentJob.status, "paused")
        assert.equal(restored.state, "paused")
        assert.equal(restarted.clients.length, 0)
        assert.equal(restarted.grants.length, 0)
        assert.equal(source.store.getSession(created.session.id).transcript.filter((entry) => (
            entry.kind === "operator_iteration_limit_reached"
        )).length, 1)
    })

    it("pauses without cancelling a running child, resumes, then stops the tree and revokes authority", async () => {
        const {manager, clients, store, revoked, engineCalls} = fixture()
        const created = await manager.create(createInput())
        const client = clients[0]
        const child = store.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "curation",
            objective: "Curate cases",
            budget: budget(),
        })
        store.transitionJob(child.id, "running")

        const paused = await manager.pause(created.session.id)
        assert.equal(paused.parentJob.status, "paused")
        assert.equal(store.getJob(child.id).status, "running")
        await assert.rejects(() => client.options.requestTool({
            callId: "paused-call",
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
        }), /paused/iu)

        const resumed = await manager.resume(created.session.id)
        assert.equal(resumed.parentJob.status, "running")
        const stopped = await manager.stop(created.session.id)
        assert.equal(stopped.parentJob.status, "cancelled")
        assert.equal(store.getJob(child.id).status, "cancelled")
        assert.deepEqual(revoked, ["capability-1"])
        assert.equal(engineCalls.some((call) => call.method === "cancel"), true)
        assert.equal(client.calls.some((call) => call.method === "interruptTurn"), true)
        assert.equal(client.calls.some((call) => call.method === "stop"), true)
        await assert.rejects(
            () => manager.followUp(created.session.id, "should not run"),
            /stopped/iu,
        )
    })

    it("reconciles children before native Runtime resume and preserves the frozen transport", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        const child = first.store.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "evaluation",
            objective: "Recover evaluation",
            budget: budget(),
        })
        first.store.transitionJob(child.id, "running")
        first.store.close()
        const recoveredStore = new OperatorJobStore(join(first.directory, "jobs.json"))

        const resumedClients = []
        const calls = []
        const restarted = new OperatorSessionManager({
            store: recoveredStore,
            engine: {
                async reconcile(jobId) {
                    calls.push(`reconcile:${jobId}`)
                    const job = recoveredStore.getJob(jobId)
                    if (job.status === "needs_recovery") recoveredStore.transitionJob(jobId, "running")
                    return {status: recoveredStore.getJob(jobId).status, jobId}
                },
                async execute() { throw new Error("unused") },
                async cancel(jobId) {
                    recoveredStore.beginCancellation(jobId)
                    return recoveredStore.cancelJobTree(jobId).job
                },
            },
            runtimeRegistry: {
                discover: () => ({available: [runtime()], selected: runtime()}),
                createClient(_descriptor, options) {
                    calls.push("createClient")
                    const client = new FakeClient(options)
                    const original = client.resumeThread.bind(client)
                    client.resumeThread = async (...args) => {
                        calls.push("resumeThread")
                        return original(...args)
                    }
                    resumedClients.push(client)
                    return client
                },
            },
            capabilities: first.capabilities,
            controlPlane: new FakeControlPlane(first.grants, first.revoked),
            controlSocketPath: "/private/operator-control.sock",
            transportFactory(input) { return new FakeTransport(input) },
            transportSupport: () => ({dynamicToolsReady: true}),
            supportsNativeResume: () => true,
        })
        const resumed = await restarted.resume(created.session.id)

        assert.equal(calls.indexOf(`reconcile:${child.id}`) < calls.indexOf("createClient"), true)
        assert.equal(calls.indexOf(`reconcile:${created.parentJob.id}`) < calls.indexOf("createClient"), true)
        assert.equal(calls.includes("resumeThread"), true)
        assert.equal(resumed.transport.kind, "codex-dynamic")
        assert.equal(resumed.parentJob.status, "running")
        assert.equal(resumedClients[0].calls.some((call) => call.method === "startThread"), false)
        assert.deepEqual(first.grants[1].actions, first.grants[0].actions)
        assert.deepEqual(first.grants[1].scopes, first.grants[0].scopes)
        assert.deepEqual(first.grants[1].budget, first.grants[0].budget)
    })

    it("starts a checkpoint Runtime session when native resume is unavailable", async () => {
        const first = fixture({supportsNativeResume: () => false})
        const created = await first.manager.create(createInput({
            title: "Skill 自动优化 · billing · adcf41f4",
        }))
        completed(first.clients[0])
        await nextTick()
        const artifact = first.store.createArtifact(created.parentJob.id, {
            kind: "checkpoint",
            name: "checkpoint.json",
            mediaType: "application/json",
            body: "{}",
        })
        first.store.transitionJob(created.parentJob.id, "needs_recovery", {
            checkpoint: {summary: "Reviewed candidate and prepared evaluation"},
        })

        const resumedClients = []
        const restarted = new OperatorSessionManager({
            store: first.store,
            engine: {
                async reconcile(jobId) {
                    const job = first.store.getJob(jobId)
                    if (job.status === "needs_recovery") first.store.transitionJob(jobId, "running")
                    return {status: first.store.getJob(jobId).status, jobId}
                },
                async execute() { throw new Error("unused") },
                async cancel(jobId) { return first.store.cancelJobTree(jobId).job },
            },
            runtimeRegistry: {
                discover: () => ({available: [runtime()], selected: runtime()}),
                createClient(_descriptor, options) {
                    const client = new FakeClient({...options, threadId: "replacement-thread"})
                    resumedClients.push(client)
                    return client
                },
            },
            capabilities: first.capabilities,
            controlPlane: new FakeControlPlane(first.grants, first.revoked),
            controlSocketPath: "/private/operator-control.sock",
            transportFactory(input) { return new FakeTransport(input) },
            transportSupport: () => ({dynamicToolsReady: true}),
            supportsNativeResume: () => false,
        })
        const resumed = await restarted.resume(created.session.id)
        const replacement = resumedClients[0]
        const checkpointTurn = replacement.calls.find((call) => call.method === "startTurn")
        const replacementName = replacement.calls.find((call) => call.method === "setThreadName")

        assert.equal(replacement.calls.some((call) => call.method === "startThread"), true)
        assert.equal(replacement.calls.some((call) => call.method === "resumeThread"), false)
        assert.deepEqual(replacementName, {
            method: "setThreadName",
            threadId: "replacement-thread",
            name: "Skill 自动优化 · billing · adcf41f4",
        })
        assert.match(JSON.stringify(checkpointTurn.input), /Reviewed candidate/iu)
        assert.match(JSON.stringify(checkpointTurn.input), new RegExp(artifact.id, "u"))
        assert.equal(resumed.runtimeThreadId, "replacement-thread")
    })

    it("tears down an unexpected Runtime failure once and leaves a safe parent resumable", async () => {
        const {manager, clients, store, revoked, engineCalls, controlPlane} = fixture()
        const created = await manager.create(createInput())
        clients[0].emit("runtimeError", Object.assign(new Error("provider failed"), {code: "RUNTIME_EXIT"}))
        clients[0].emit("runtimeError", new Error("duplicate"))
        await nextTick()
        await nextTick()

        assert.equal(store.getJob(created.parentJob.id).status, "running")
        assert.equal(store.getSession(created.session.id).transcript.some((entry) => (
            entry.kind === "operator_session_needs_resume"
        )), true)
        assert.deepEqual(revoked, ["capability-1"])
        assert.equal(engineCalls.filter((call) => call.method === "interrupt").length, 1)
        assert.equal(clients[0].calls.filter((call) => call.method === "interruptTurn").length, 0)
        assert.equal(clients[0].calls.filter((call) => call.method === "stop").length, 1)
        assert.equal(controlPlane.routes.size, 0)
        await assert.rejects(() => clients[0].options.requestTool({
            callId: "after-failure",
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), /stopped|revoked/iu)
    })

    it("treats trusted fatal Runtime state callbacks as exited across typed and CLI transports", async () => {
        const providers = [
            {
                providerId: "codex",
                selection: {kind: "codex-dynamic", ready: true},
                support: {dynamicToolsReady: true},
            },
            {
                providerId: "codebuddy",
                selection: {kind: "acp-mcp", ready: true},
                support: {mcpServersReady: true},
            },
            {
                providerId: "deepseek-harness",
                selection: {kind: "dsh-mcp", ready: true},
                support: {dshMcpReady: true},
            },
        ]
        for (const provider of providers) {
            let clientCount = 0
            let oldInterruptCalls = 0
            let oldStopCalls = 0
            const context = fixture({
                runtimes: [runtime({providerId: provider.providerId})],
                transportSelection: provider.selection,
                transportSupport: () => provider.support,
                clientFactory(_descriptor, options) {
                    clientCount += 1
                    const client = new FakeClient(options)
                    if (clientCount === 1) {
                        client.interruptTurn = async () => {
                            oldInterruptCalls += 1
                            throw new Error("dead process cannot accept interrupt")
                        }
                        client.stop = async () => {
                            oldStopCalls += 1
                            client.calls.push({method: "stop"})
                        }
                    }
                    return client
                },
            })
            const created = await context.manager.create(createInput())

            if (provider.providerId === "deepseek-harness") {
                assert.deepEqual(context.clients[0].options.mcpServers, [{
                    name: "rolling-skill-operator",
                }])
            }

            context.clients[0].emit("state", {
                status: "stopped",
                reason: "process_exit",
                exitCode: 17,
            })
            await nextTick()
            await nextTick()

            assert.equal(oldInterruptCalls, 0, provider.providerId)
            assert.equal(oldStopCalls, 1, provider.providerId)
            assert.equal(context.revoked.includes("capability-1"), true, provider.providerId)
            assert.equal(context.engineCalls.filter((call) => call.method === "interrupt").length, 1)

            const resumed = await context.manager.resume(created.session.id)
            assert.equal(resumed.state, "idle", provider.providerId)
            assert.equal(context.clients.length, 2, provider.providerId)
        }
    })

    it("singleflights concurrent cold resume so the loser creates no client, grant, or lease", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        const restarted = fixture({store: first.store, supportsNativeResume: () => true})

        const [left, right] = await Promise.all([
            restarted.manager.resume(created.session.id),
            restarted.manager.resume(created.session.id),
        ])

        assert.equal(left.runtimeThreadId, right.runtimeThreadId)
        assert.equal(restarted.clients.length, 1)
        assert.equal(restarted.grants.length, 1)
        assert.equal(restarted.controlPlane.routes.size, 1)
    })

    it("normalizes a durable waiting-approval parent when no Approval gate exists", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        first.store.transitionJob(created.parentJob.id, "waiting_approval")
        const restarted = fixture({store: first.store, supportsNativeResume: () => true})

        const resumed = await restarted.manager.resume(created.session.id)

        assert.equal(resumed.parentJob.status, "running")
        assert.equal(resumed.state, "idle")
        assert.equal(restarted.clients.length, 1)
    })

    it("blocks and revokes synchronously when stop starts, including a cold durable session", async () => {
        const live = fixture()
        const created = await live.manager.create(createInput())
        const stopping = live.manager.stop(created.session.id)
        assert.deepEqual(live.revoked, ["capability-1"])
        await assert.rejects(() => live.clients[0].options.requestTool({
            callId: "late-call",
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), /stopped|revoked/iu)
        await stopping

        const coldSource = fixture()
        const coldCreated = await coldSource.manager.create(createInput())
        completed(coldSource.clients[0])
        await nextTick()
        const cold = fixture({store: coldSource.store})
        const coldStopping = cold.manager.stop(coldCreated.session.id)
        assert.deepEqual(cold.revoked, ["capability-1"])
        await coldStopping
    })

    it("cancels a pending permission callback when the control generation stops", async () => {
        const response = deferred()
        let displayed = 0
        const {manager, clients, store} = fixture({
            requestPermission: async () => {
                displayed += 1
                return response.promise
            },
        })
        const created = await manager.create(createInput())
        const permission = clients[0].options.requestPermission({rpcId: "permission-1", kind: "command"})
        await Promise.resolve()
        assert.equal(displayed, 1)
        const stopping = manager.stop(created.session.id)

        assert.equal(await permission, "decline")
        await stopping
        response.resolve("accept")
        await nextTick()
        const transcript = store.getSession(created.session.id).transcript
        assert.equal(transcript.some((entry) => (
            entry.kind === "permission_resolved" && entry.decision === "accept"
        )), false)
    })

    it("replays an enqueued user boundary after restart and marks it delivered only after startTurn", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        await first.manager.followUp(created.session.id, "Durable pending follow-up")
        const restarted = fixture({store: first.store, supportsNativeResume: () => true})

        await restarted.manager.resume(created.session.id)
        await nextTick()

        const turns = restarted.clients[0].calls.filter((call) => call.method === "startTurn")
        assert.equal(turns.length, 1)
        assert.match(JSON.stringify(turns[0].input), /Durable pending follow-up/u)
        const transcript = first.store.getSession(created.session.id).transcript
        assert.equal(transcript.some((entry) => entry.kind === "operator_boundary_enqueued"), true)
        assert.equal(transcript.some((entry) => entry.kind === "operator_boundary_delivered"), true)
    })

    it("fails closed when the full frozen Runtime transport descriptor changes", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        const changed = fixture({
            store: first.store,
            supportsNativeResume: () => true,
            runtimes: [runtime({version: "2.0.0"})],
        })

        await assert.rejects(() => changed.manager.resume(created.session.id), /frozen|descriptor|transport/iu)
        assert.equal(changed.clients.length, 0)
        assert.deepEqual(changed.revoked, ["capability-1"])
    })

    it("replays an undelivered child boundary after native resume and deduplicates only after delivery", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        const child = first.store.createJob({
            sessionId: created.session.id,
            parentJobId: created.parentJob.id,
            type: "evaluation",
            objective: "Evaluate after restart",
            budget: budget(),
        })
        first.store.transitionJob(child.id, "running")
        first.store.transitionJob(child.id, "succeeded", {result: {score: 1}})
        await first.manager.notifyChildCompletion(created.session.id, child.id)
        const restarted = fixture({store: first.store, supportsNativeResume: () => true})

        await restarted.manager.resume(created.session.id)
        await nextTick()

        const turns = restarted.clients[0].calls.filter((call) => call.method === "startTurn")
        assert.equal(turns.length, 1)
        assert.match(JSON.stringify(turns[0].input), new RegExp(child.id, "u"))
        assert.deepEqual(
            await restarted.manager.notifyChildCompletion(created.session.id, child.id),
            {queued: false, duplicate: true},
        )
        const transcript = first.store.getSession(created.session.id).transcript
        assert.equal(transcript.filter((entry) => (
            entry.kind === "child_completion_delivered" && entry.childJobId === child.id
        )).length, 1)
    })

    it("falls back to a checkpoint only for explicit native-resume absence", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        const restarted = fixture({
            store: first.store,
            supportsNativeResume: () => true,
            clientFactory(_descriptor, options) {
                const client = new FakeClient({...options, threadId: "checkpoint-thread"})
                client.resumeThread = async (threadId, resumeOptions) => {
                    client.calls.push({method: "resumeThread", threadId, options: resumeOptions})
                    throw Object.assign(new Error("missing"), {code: "THREAD_NOT_FOUND"})
                }
                return client
            },
        })

        const resumed = await restarted.manager.resume(created.session.id)
        assert.equal(resumed.runtimeThreadId, "checkpoint-thread")
        assert.equal(restarted.clients[0].calls.some((call) => call.method === "resumeThread"), true)
        assert.equal(restarted.clients[0].calls.some((call) => call.method === "startThread"), true)
    })

    it("fails closed on an uncertain native-resume error without silently starting a checkpoint", async () => {
        const first = fixture({supportsNativeResume: () => true})
        const created = await first.manager.create(createInput())
        completed(first.clients[0])
        await nextTick()
        const restarted = fixture({
            store: first.store,
            supportsNativeResume: () => true,
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.resumeThread = async (threadId, resumeOptions) => {
                    client.calls.push({method: "resumeThread", threadId, options: resumeOptions})
                    throw Object.assign(new Error("timed out"), {code: "OPERATOR_EXTERNAL_TIMEOUT"})
                }
                return client
            },
        })

        await assert.rejects(() => restarted.manager.resume(created.session.id), /timed out/iu)
        assert.equal(restarted.clients[0].calls.some((call) => call.method === "startThread"), false)
        assert.equal(first.store.getJob(created.parentJob.id).status, "running")
        assert.equal(first.store.getSession(created.session.id).transcript.some((entry) => (
            entry.kind === "operator_session_needs_resume" && entry.reason === "resume_failure"
        )), true)
        assert.deepEqual(restarted.revoked, ["capability-1"])
    })

    it("shares one stop operation and blocks a cold resume before it can leak a new client or grant", async () => {
        const live = fixture()
        const liveCreated = await live.manager.create(createInput())
        const firstStop = live.manager.stop(liveCreated.session.id)
        const secondStop = live.manager.stop(liveCreated.session.id)
        assert.equal(firstStop, secondStop)
        await Promise.all([firstStop, secondStop])
        assert.equal(live.engineCalls.filter((call) => call.method === "cancel").length, 1)
        assert.equal(live.clients[0].calls.filter((call) => call.method === "stop").length, 1)

        const source = fixture()
        const created = await source.manager.create(createInput())
        completed(source.clients[0])
        await nextTick()
        const discovery = deferred()
        const restarted = fixture({store: source.store, discover: () => discovery.promise})
        const resuming = restarted.manager.resume(created.session.id)
        await nextTick()
        const stopping = restarted.manager.stop(created.session.id)
        discovery.resolve({available: [runtime()], selected: runtime()})

        await assert.rejects(resuming, /stopped/iu)
        await stopping
        assert.equal(restarted.clients.length, 0)
        assert.equal(restarted.grants.length, 0)
        assert.deepEqual(restarted.revoked, ["capability-1"])
    })

    it("rechecks the control generation inside the Job queue before persisting a late Step", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-session-guard-"))
        directories.push(directory)
        const store = new OperatorJobStore(join(directory, "jobs.json"))
        const blocker = deferred()
        const entered = deferred()
        let calls = 0
        const engine = new OperatorJobEngine({
            store,
            handlers: {
                "datasets.get": async ({params}) => {
                    calls += 1
                    if (calls === 1) {
                        entered.resolve()
                        await blocker.promise
                    }
                    return {dataset: {id: params.datasetId}}
                },
            },
        })
        const context = fixture({store, engine})
        const created = await context.manager.create(createInput())
        const prior = engine.execute(created.parentJob.id, {
            method: "datasets.get",
            params: {datasetId: "prior-dataset", includeCases: false},
            idempotencyKey: "prior-step",
        })
        await entered.promise
        const late = context.clients[0].options.requestTool({
            callId: "late-queued-tool",
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        })
        await context.manager.pause(created.session.id)
        blocker.resolve()

        assert.equal((await prior).status, "succeeded")
        await assert.rejects(late, (error) => error.code === "CONTROL_BUSY")
        assert.equal(store.listSteps({jobId: created.parentJob.id}).length, 1)
        assert.equal(calls, 1)
    })

    it("durably queues follow-up while a restored control does not yet own a Runtime thread", async () => {
        const thread = deferred()
        const turn = deferred()
        const context = fixture({
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.startThread = async (threadOptions) => {
                    client.calls.push({method: "startThread", options: threadOptions})
                    return thread.promise
                }
                client.startTurn = async (threadId, input, turnOptions) => {
                    client.calls.push({method: "startTurn", threadId, input, options: turnOptions})
                    return turn.promise
                }
                return client
            },
        })
        const creating = context.manager.create(createInput())
        await nextTick()
        const session = context.store.listSessions()[0]
        const parent = context.store.listJobs({sessionId: session.id, parentJobId: null})[0]
        const child = context.store.createJob({
            sessionId: session.id,
            parentJobId: parent.id,
            type: "evaluation",
            objective: "Complete while Runtime restores",
            budget: budget(),
        })
        context.store.transitionJob(child.id, "running")
        context.store.transitionJob(child.id, "succeeded", {result: {ok: true}})

        try {
            assert.deepEqual(await context.manager.followUp(session.id, "Wait for restore ownership"), {
                queued: true,
            })
            assert.deepEqual(await context.manager.notifyChildCompletion(session.id, child.id), {
                queued: true,
            })
            assert.equal(context.clients[0].calls.filter((call) => call.method === "startTurn").length, 0)
            assert.equal(context.store.getSession(session.id).transcript.some((entry) => (
                entry.kind === "operator_boundary_enqueued" && entry.content === "Wait for restore ownership"
            )), true)
        } finally {
            thread.resolve({thread: {id: context.clients[0].threadId}})
            turn.resolve({turn: {id: "turn-restored", status: "inProgress"}})
            await creating.catch(() => {})
        }
    })

    it("keeps ACP and CLI socket calls disabled until startTurn ownership is confirmed", async () => {
        const turn = deferred()
        const context = fixture({
            transportSelection: {kind: "acp-mcp", ready: true},
            transportSupport: () => ({mcpServersReady: true}),
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.startTurn = async (threadId, input, turnOptions) => {
                    client.calls.push({method: "startTurn", threadId, input, options: turnOptions})
                    return turn.promise
                }
                return client
            },
        })
        const creating = context.manager.create(createInput())
        await nextTick()
        const grant = context.grants[0]
        const request = {
            token: grant.token,
            sessionId: grant.sessionId,
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }

        try {
            context.clients[0].notify("turn/started", {
                threadId: context.clients[0].threadId,
                turn: {id: "forged-early-turn"},
            })
            await assert.rejects(context.controlPlane.invoke(request), (error) => error.code === "CONTROL_BUSY")
        } finally {
            turn.resolve({turn: {id: "turn-confirmed", status: "inProgress"}})
            await creating
        }
        assert.deepEqual(await context.controlPlane.invoke(request), {ok: true})
    })

    it("preserves a waiting Step and pending Approval when the Runtime fails before handler execution", async () => {
        const context = fixture()
        const created = await context.manager.create(createInput())
        const {step, approval} = makeWaitingApproval(context.store, created.parentJob.id)

        context.clients[0].emit("runtimeError", new Error("provider disconnected"))
        await nextTick()
        await nextTick()

        assert.equal(context.store.getJob(created.parentJob.id).status, "waiting_approval")
        assert.equal(context.store.getStep(step.id).status, "waiting_approval")
        assert.equal(context.store.getApproval(approval.id).status, "pending")
        assert.equal(context.engineCalls.filter((call) => call.method === "interrupt").length, 1)
        assert.equal(context.store.getSession(created.session.id).transcript.some((entry) => (
            entry.kind === "operator_session_needs_resume"
        )), true)
    })

    it("pauses a waiting-approval session without changing its durable Job or Approval", async () => {
        const context = fixture()
        const created = await context.manager.create(createInput())
        const {step, approval} = makeWaitingApproval(context.store, created.parentJob.id)

        const paused = await context.manager.pause(created.session.id)
        assert.equal(paused.state, "paused")
        assert.equal(context.store.getJob(created.parentJob.id).status, "waiting_approval")
        assert.equal(context.store.getStep(step.id).status, "waiting_approval")
        assert.equal(context.store.getApproval(approval.id).status, "pending")
        await assert.rejects(context.controlPlane.invoke({
            token: context.grants[0].token,
            sessionId: context.grants[0].sessionId,
            method: "datasets.get",
            params: {datasetId: "dataset-1", includeCases: false},
        }), (error) => error.code === "CONTROL_BUSY")

        const cold = fixture({store: context.store})
        assert.equal(cold.manager.get(created.session.id).state, "paused")

        const resumed = await context.manager.resume(created.session.id)
        assert.equal(resumed.parentJob.status, "waiting_approval")
        assert.equal(context.store.getApproval(approval.id).status, "pending")
    })

    it("stops the Runtime for App shutdown while preserving its durable waiting approval", async () => {
        const context = fixture()
        const created = await context.manager.create(createInput())
        const {step, approval} = makeWaitingApproval(context.store, created.parentJob.id)

        await context.manager.stopAll({preserveWaitingApprovals: true})

        assert.equal(context.store.getJob(created.parentJob.id).status, "waiting_approval")
        assert.equal(context.store.getStep(step.id).status, "waiting_approval")
        assert.equal(context.store.getApproval(approval.id).status, "pending")
        assert.equal(context.clients[0].calls.some((call) => call.method === "stop"), true)
        assert.deepEqual(context.revoked, ["capability-1"])
        const cold = fixture({store: context.store})
        const restored = await cold.manager.resume(created.session.id)
        assert.equal(restored.parentJob.status, "waiting_approval")
        assert.equal(cold.clients.length, 0, "Waiting for the decision does not restart the Agent Runtime")
    })

    it("rejects an incomplete stop and retries revoke, cancellation, and client teardown", async () => {
        let revokeAttempts = 0
        let cancelAttempts = 0
        let stopAttempts = 0
        const context = fixture({
            revoke(id, {revoked}) {
                revokeAttempts += 1
                if (revokeAttempts === 1) throw new Error("revoke failed")
                revoked.push(id)
                return true
            },
            cancel(jobId, {store}) {
                cancelAttempts += 1
                if (cancelAttempts === 1) throw new Error("cancel failed")
                store.beginCancellation(jobId)
                return store.cancelJobTree(jobId).job
            },
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.stop = async () => {
                    stopAttempts += 1
                    client.calls.push({method: "stop"})
                    if (stopAttempts === 1) throw new Error("stop failed")
                }
                return client
            },
        })
        const created = await context.manager.create(createInput())

        await assert.rejects(context.manager.stop(created.session.id), /revoke failed|cancel failed|stop failed/iu)
        assert.equal(revokeAttempts, 1)
        assert.equal(cancelAttempts, 1)
        assert.equal(stopAttempts, 1)

        const stopped = await context.manager.stop(created.session.id)
        assert.equal(stopped.parentJob.status, "cancelled")
        assert.equal(revokeAttempts, 2)
        assert.equal(cancelAttempts, 2)
        assert.equal(stopAttempts, 2)
    })

    it("does not interrupt an idle Runtime and treats an already-settled active turn as converged", async () => {
        const idle = fixture()
        const idleCreated = await idle.manager.create(createInput())
        completed(idle.clients[0])
        await nextTick()

        await idle.manager.stop(idleCreated.session.id)
        assert.equal(idle.clients[0].calls.some((call) => call.method === "interruptTurn"), false)

        for (const failure of [
            Object.assign(new Error("missing turn"), {code: "NOT_FOUND"}),
            Object.assign(new Error("no active turn"), {code: "NO_ACTIVE_TURN"}),
            new Error("turn already completed"),
        ]) {
            const active = fixture({
                clientFactory(_descriptor, options) {
                    const client = new FakeClient(options)
                    client.interruptTurn = async (threadId, turnId) => {
                        client.calls.push({method: "interruptTurn", threadId, turnId})
                        throw failure
                    }
                    return client
                },
            })
            const created = await active.manager.create(createInput())
            const stopped = await active.manager.stop(created.session.id)

            assert.equal(stopped.parentJob.status, "cancelled")
            assert.equal(active.clients[0].calls.filter((call) => call.method === "interruptTurn").length, 1)
        }
    })

    it("does not repeat successful active-turn, parent, or client teardown while retrying revoke", async () => {
        let revokeAttempts = 0
        const context = fixture({
            revoke(id, {revoked}) {
                revokeAttempts += 1
                if (revokeAttempts === 1) throw new Error("revoke once")
                revoked.push(id)
                return true
            },
        })
        const created = await context.manager.create(createInput())

        await assert.rejects(context.manager.stop(created.session.id), /revoke once/iu)
        await context.manager.stop(created.session.id)

        assert.equal(revokeAttempts, 2)
        assert.equal(context.engineCalls.filter((call) => call.method === "cancel").length, 1)
        assert.equal(context.clients[0].calls.filter((call) => call.method === "interruptTurn").length, 1)
        assert.equal(context.clients[0].calls.filter((call) => call.method === "stop").length, 1)
    })

    it("keeps an active Runtime client alive until a transient turn-interrupt failure is retried", async () => {
        let interruptAttempts = 0
        let stopCalls = 0
        const context = fixture({
            clientFactory(_descriptor, options) {
                const client = new FakeClient(options)
                client.interruptTurn = async (threadId, turnId) => {
                    interruptAttempts += 1
                    client.calls.push({method: "interruptTurn", threadId, turnId})
                    if (interruptAttempts === 1) throw new Error("temporary interrupt failure")
                }
                client.stop = async () => {
                    stopCalls += 1
                    client.calls.push({method: "stop"})
                }
                return client
            },
        })
        const created = await context.manager.create(createInput())

        await assert.rejects(context.manager.stop(created.session.id), /temporary interrupt failure/iu)
        assert.equal(interruptAttempts, 1)
        assert.equal(stopCalls, 0)
        assert.equal(context.engineCalls.filter((call) => call.method === "cancel").length, 1)

        const stopped = await context.manager.stop(created.session.id)
        assert.equal(stopped.parentJob.status, "cancelled")
        assert.equal(interruptAttempts, 2)
        assert.equal(stopCalls, 1)
        assert.equal(context.engineCalls.filter((call) => call.method === "cancel").length, 1)
    })

    it("keeps an active Runtime alive after an internal notification failure until interruption converges", async () => {
        let clientCount = 0
        let oldInterruptAttempts = 0
        let oldStopCalls = 0
        const context = fixture({
            clientFactory(_descriptor, options) {
                clientCount += 1
                const client = new FakeClient(options)
                if (clientCount === 1) {
                    client.interruptTurn = async (threadId, turnId) => {
                        oldInterruptAttempts += 1
                        client.calls.push({method: "interruptTurn", threadId, turnId})
                        if (oldInterruptAttempts === 1) throw new Error("temporary failure interrupt")
                    }
                    client.stop = async () => {
                        oldStopCalls += 1
                        client.calls.push({method: "stop"})
                    }
                }
                return client
            },
        })
        const created = await context.manager.create(createInput())

        context.clients[0].notify("item/completed", {
            threadId: context.clients[0].threadId,
            item: {id: "", type: "runtimeActivity"},
        })
        await nextTick()
        await nextTick()

        assert.equal(context.manager.get(created.session.id).state, "cleanup_failed")
        assert.equal(oldInterruptAttempts, 1)
        assert.equal(oldStopCalls, 0)

        const resumed = await context.manager.resume(created.session.id)
        assert.equal(resumed.state, "idle")
        assert.equal(oldInterruptAttempts, 2)
        assert.equal(oldStopCalls, 1)
        assert.equal(context.clients.length, 2)
    })

    it("retains failed Runtime cleanup and forbids a replacement client until retry succeeds", async () => {
        let clientCount = 0
        let oldStopAttempts = 0
        const context = fixture({
            clientFactory(_descriptor, options) {
                clientCount += 1
                const client = new FakeClient(options)
                if (clientCount === 1) {
                    client.stop = async () => {
                        oldStopAttempts += 1
                        client.calls.push({method: "stop"})
                        if (oldStopAttempts <= 2) throw new Error("old Runtime stop failed")
                    }
                }
                return client
            },
        })
        const created = await context.manager.create(createInput())

        context.clients[0].emit("runtimeError", new Error("provider disconnected"))
        await nextTick()
        await nextTick()

        assert.equal(context.manager.get(created.session.id).state, "cleanup_failed")
        assert.equal(context.clients.length, 1)
        assert.equal(context.controlPlane.routes.size, 0)

        await assert.rejects(context.manager.resume(created.session.id), /old Runtime stop failed/iu)
        assert.equal(context.clients.length, 1)
        assert.equal(context.grants.length, 1)

        const resumed = await context.manager.resume(created.session.id)
        assert.equal(resumed.state, "idle")
        assert.equal(context.clients.length, 2)
        assert.equal(context.grants.length, 2)
        assert.equal(oldStopAttempts, 3)
        assert.equal(context.revoked.filter((id) => id === "capability-1").length, 1)
        assert.equal(context.engineCalls.filter((call) => call.method === "interrupt").length, 1)
    })

    it("retries a failed cold revoke and stopAll cancels every durable nonterminal session", async () => {
        const source = fixture()
        const first = await source.manager.create(createInput({objective: "first durable session"}))
        const second = await source.manager.create(createInput({objective: "second durable session"}))
        let revokeAttempts = 0
        const restarted = fixture({
            store: source.store,
            revoke(id, {revoked}) {
                revokeAttempts += 1
                if (revokeAttempts === 1) throw new Error("cold revoke failed")
                revoked.push(id)
                return true
            },
        })

        await assert.rejects(restarted.manager.stop(first.session.id), /cold revoke failed/iu)
        await restarted.manager.stop(first.session.id)
        await restarted.manager.stopAll()

        assert.equal(source.store.getJob(first.parentJob.id).status, "cancelled")
        assert.equal(source.store.getJob(second.parentJob.id).status, "cancelled")
        assert.equal(restarted.revoked.includes(source.store.getSession(second.session.id).capabilityId), true)
    })

    it("waits for an in-flight cold resume and revokes authority issued after stop began", async () => {
        const source = fixture({supportsNativeResume: () => true})
        const created = await source.manager.create(createInput())
        completed(source.clients[0])
        await nextTick()
        const issuing = deferred()
        let issueStarted
        const entered = new Promise((resolve) => { issueStarted = resolve })
        const restarted = fixture({
            store: source.store,
            supportsNativeResume: () => true,
            issue(request, {grants}) {
                issueStarted()
                return issuing.promise.then(() => {
                    const grant = {
                        id: "capability-late",
                        token: "private-token-late",
                        sessionId: request.sessionId,
                        ...request,
                    }
                    grants.push(grant)
                    return grant
                })
            },
        })
        const resuming = restarted.manager.resume(created.session.id)
        await entered
        let stopSettled = false
        const stopping = restarted.manager.stop(created.session.id).finally(() => {
            stopSettled = true
        })
        await nextTick()

        assert.equal(stopSettled, false)
        issuing.resolve()
        await assert.rejects(resuming, /stopped/iu)
        await stopping
        assert.deepEqual(new Set(restarted.revoked), new Set(["capability-1", "capability-late"]))
    })
})
