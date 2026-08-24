const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {OperatorJobStore} = require("../src/operator/job-store.cjs")
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
        return this.selected.kind === "acp-mcp" ? [{name: "rolling-skill-operator"}] : []
    }

    childEnvironment() {
        return {...this.environment}
    }
}

function fixture(options = {}) {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-operator-session-"))
    directories.push(directory)
    const store = options.store ?? new OperatorJobStore(join(directory, "jobs.json"))
    const descriptors = options.runtimes ?? [runtime()]
    const clients = []
    const registry = {
        discover: () => ({available: descriptors, selected: descriptors[0] ?? null}),
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
            revoked.push(id)
            return true
        },
    }
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
            store.beginCancellation(jobId)
            return store.cancelJobTree(jobId).job
        },
    }
    const transports = []
    const manager = new OperatorSessionManager({
        store,
        engine,
        runtimeRegistry: registry,
        capabilities,
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
    })
    return {store, manager, clients, grants, revoked, transports, engineCalls, capabilities, directory}
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

describe("OperatorSessionManager", () => {
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

    it("persists ordered compact notifications and routes tools, permissions, and questions", async () => {
        const permissionRequests = []
        const questionRequests = []
        const {manager, clients, store, engineCalls} = fixture({
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
            method: "datasets.read",
            params: {datasetId: "dataset-1"},
        }), {status: "succeeded", jobId: created.parentJob.id, stepId: "step-1", result: {ok: true}})
        assert.match(engineCalls[0].request.idempotencyKey, /^operator:[a-f0-9]{64}$/u)
        assert.equal(Object.hasOwn(engineCalls[0].request, "reservation"), false)

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
        const created = await first.manager.create(createInput())
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
            controlSocketPath: "/private/operator-control.sock",
            transportFactory(input) { return new FakeTransport(input) },
            transportSupport: () => ({dynamicToolsReady: true}),
            supportsNativeResume: () => false,
        })
        const resumed = await restarted.resume(created.session.id)
        const replacement = resumedClients[0]
        const checkpointTurn = replacement.calls.find((call) => call.method === "startTurn")

        assert.equal(replacement.calls.some((call) => call.method === "startThread"), true)
        assert.equal(replacement.calls.some((call) => call.method === "resumeThread"), false)
        assert.match(JSON.stringify(checkpointTurn.input), /Reviewed candidate/iu)
        assert.match(JSON.stringify(checkpointTurn.input), new RegExp(artifact.id, "u"))
        assert.equal(resumed.runtimeThreadId, "replacement-thread")
    })
})
