const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {SkillInstallationManager} = require("../src/skill-installation-manager.cjs")
const {SkillInstallationStore} = require("../src/skill-installation-store.cjs")
const {
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
} = require("../src/skill-installation-protocol.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function deferred() {
    let resolve
    let reject
    const promise = new Promise((resolve_, reject_) => {
        resolve = resolve_
        reject = reject_
    })
    return {promise, resolve, reject}
}

function runtime(runtimeId, providerId = runtimeId.split(":")[0]) {
    return {
        runtimeId,
        providerId,
        displayName: runtimeId,
        version: "1.0.0",
        executablePath: `/bin/${providerId}`,
        capabilities: ["threads", "turns", "raw-trace"],
    }
}

function managedFixtures(state = "released") {
    const repository = {
        id: "repository-1",
        managedPath: "/managed/repository-1",
    }
    const skill = {
        id: "skill-1",
        repositoryId: repository.id,
        name: "billing",
        skillRoot: "skills/billing",
    }
    const version = {
        id: "version-1",
        repositoryId: repository.id,
        skillId: skill.id,
        skillRoot: skill.skillRoot,
        state,
        commit: "a".repeat(40),
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionLabel: state === "released" ? "v1.0.0" : null,
    }
    return {
        repository,
        skill,
        version,
        store: {
            getRepository: (id) => {
                assert.equal(id, repository.id)
                return {...repository}
            },
            getSkill: (id) => {
                assert.equal(id, skill.id)
                return {...skill}
            },
            getVersion: (id) => {
                assert.equal(id, version.id)
                return {...version}
            },
        },
        manager: {
            repositoryPath: (id) => {
                assert.equal(id, repository.id)
                return repository.managedPath
            },
        },
    }
}

function resultText(jobRequest, overrides = {}) {
    const payload = {
        schema: INSTALL_RESULT_SCHEMA,
        status: "succeeded",
        operation: "install",
        classificationBefore: "absent",
        destination: "/runtime/skills/billing",
        source: {...jobRequest.source},
        permission: {requested: "workspace-write", effective: "workspace-write"},
        result: {
            actualDigest: jobRequest.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: true,
        },
        warnings: [],
        error: null,
        ...overrides,
    }
    return `${INSTALL_RESULT_SENTINEL.open}\n${JSON.stringify(payload)}\n${INSTALL_RESULT_SENTINEL.close}`
}

class FakeClient extends EventEmitter {
    constructor({descriptor, options, behavior}) {
        super()
        this.descriptor = descriptor
        this.options = options
        this.behavior = behavior
        this.ready = false
        this.startedTurns = []
        this.interrupts = []
        this.stopped = false
        this.recorder = {latestReference: `/trace/${descriptor.runtimeId}`}
    }

    async start() {
        this.ready = true
        this.behavior.onClientStart?.(this)
    }

    async startThread(options) {
        this.threadOptions = options
        return {
            thread: {
                id: `thread-${this.descriptor.runtimeId}-${this.behavior.threadSequence++}`,
                model: options.model ?? null,
                effort: options.effort ?? null,
                permissionMode: options.permissionMode ?? null,
            },
        }
    }

    async resumeThread(threadId, options) {
        this.resumedThreadId = threadId
        this.threadOptions = options
        return {thread: {id: threadId}}
    }

    async startTurn(threadId, prompt, options) {
        const turnId = `turn-${this.behavior.turnSequence++}`
        this.startedTurns.push({threadId, prompt, options, turnId})
        this.emit("notification", {
            method: "turn/started",
            params: {threadId, turn: {id: turnId, status: "inProgress"}},
        })
        void this.behavior.run(this, {threadId, prompt, options, turnId})
        return {turn: {id: turnId, status: "inProgress"}}
    }

    async interruptTurn(threadId, turnId) {
        this.interrupts.push({threadId, turnId})
        this.behavior.onInterrupt?.(this, {threadId, turnId})
    }

    state() {
        return {status: this.ready ? "ready" : "stopped", traceReference: this.recorder.latestReference}
    }

    async stop() {
        this.stopped = true
        this.ready = false
    }
}

function successfulBehavior(options = {}) {
    return {
        threadSequence: 1,
        turnSequence: 1,
        ...options,
        async run(client, turn) {
            if (options.beforeRun) await options.beforeRun(client, turn)
            const request = options.requestForPrompt(turn.prompt, client) ?? client.options.installationRequest
            const items = options.items ?? [
                {id: "message-1", type: "agentMessage", text: "Checking target"},
                {id: "command-1", type: "commandExecution", command: "git archive", status: "completed"},
                {
                    id: "message-2",
                    type: "agentMessage",
                    text: resultText(request, {
                        operation: turn.prompt.includes('"operation": "inspect"')
                            ? "inspect"
                            : "install",
                        ...options.resultOverrides,
                    }),
                },
            ]
            for (const item of items) {
                client.emit("notification", {
                    method: "item/completed",
                    params: {threadId: turn.threadId, turnId: turn.turnId, item},
                })
            }
            client.emit("notification", {
                method: "turn/completed",
                params: {
                    threadId: turn.threadId,
                    turn: {id: turn.turnId, status: "completed", items},
                },
            })
        },
    }
}

function fixture(options = {}) {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-install-manager-"))
    temporaryDirectories.push(root)
    const managed = managedFixtures(options.versionState)
    const runtimes = options.runtimes ?? [runtime("codex:one", "codex")]
    const clients = []
    let currentRequest = null
    const behaviors = options.behaviors ?? new Map()
    const fallback = successfulBehavior({requestForPrompt: () => currentRequest})
    const registry = {
        createClient(descriptor, clientOptions) {
            const behavior = behaviors.get(descriptor.runtimeId) ?? fallback
            const client = new FakeClient({descriptor, options: clientOptions, behavior})
            clients.push(client)
            return client
        },
    }
    const store = new SkillInstallationStore(join(root, "installations.json"))
    const changes = []
    const manager = new SkillInstallationManager({
        store,
        managedSkillStore: managed.store,
        managedSkillManager: managed.manager,
        runtimeRegistry: registry,
        getRuntimes: () => runtimes,
        workspaceRoot: "/workspace",
        traceDirectory: join(root, "traces"),
        requestPermission: options.requestPermission,
        requestQuestion: options.requestQuestion,
        resolvePermission: (_providerId, mode) => ({permissionMode: mode}),
        onChanged: (job) => changes.push(job),
        timeoutMs: 2_000,
    })
    async function start(input = {}) {
        const jobs = await manager.start({
            skillId: managed.skill.id,
            versionId: managed.version.id,
            targets: input.targets ?? [{
                runtimeId: runtimes[0].runtimeId,
                modelId: "model-1",
                effort: "high",
                permissionMode: "workspace-write",
            }],
            destination: input.destination,
            commit: input.commit,
        })
        currentRequest = jobs[0].request
        for (const behavior of behaviors.values()) {
            behavior.requestForPrompt ??= () => jobs.find(
                (job) => job.runtime.runtimeId === behavior.runtimeId,
            )?.request ?? jobs[0].request
        }
        fallback.requestForPrompt = () => jobs[0].request
        return jobs
    }
    return {manager, store, clients, changes, runtimes, managed, start}
}

describe("Runtime Skill installation manager", () => {
    it("freezes source facts from registered IDs and ignores renderer path or commit injection", async () => {
        const {manager, store, start} = fixture()
        const jobs = await start({destination: "/attacker", commit: "f".repeat(40)})
        await manager.wait(jobs[0].id)
        const stored = store.getJob(jobs[0].id)

        assert.equal(stored.request.repositoryPath, "/managed/repository-1")
        assert.equal(stored.request.source.commit, "a".repeat(40))
        assert.equal(stored.status, "succeeded")
        assert.equal(stored.parsedResult.trusted, true)
    })

    it("returns trusted installation records in the unfiltered audit overview", async () => {
        const {manager, start} = fixture()
        const [job] = await start()
        await manager.wait(job.id)

        const overview = manager.overview()
        assert.equal(overview.jobs[0].id, job.id)
        assert.equal(overview.matrix.length, 1)
        assert.equal(overview.matrix[0].skillId, "skill-1")
        assert.equal(overview.matrix[0].trustedJobId, job.id)
    })

    it("refuses Candidate versions before creating a Runtime client", async () => {
        const {manager, clients, managed} = fixture({versionState: "candidate"})
        await assert.rejects(
            () => manager.start({
                skillId: managed.skill.id,
                versionId: managed.version.id,
                targets: [{runtimeId: "codex:one"}],
            }),
            /Released/u,
        )
        assert.equal(clients.length, 0)
    })

    it("keeps assistant messages and tool activity in first-seen timeline order", async () => {
        const {manager, store, start} = fixture()
        const [job] = await start()
        await manager.wait(job.id)
        const timeline = store.getJob(job.id).timeline.filter((entry) => entry.role !== "user")

        assert.deepEqual(timeline.map((entry) => entry.kind), ["message", "activity", "message"])
        assert.equal(timeline[1].command, "git archive")
    })

    it("preserves a readable DSH tool title instead of exposing only dynamicToolCall", async () => {
        const behavior = {
            threadSequence: 1,
            turnSequence: 1,
            async run(client, turn) {
                const request = client.options.installationRequest
                const items = [
                    {
                        id: "todo-1",
                        type: "dynamicToolCall",
                        tool: "todo_write",
                        title: "Update installation checklist",
                        status: "completed",
                    },
                    {id: "message-1", type: "agentMessage", text: resultText(request)},
                ]
                for (const item of items) {
                    client.emit("notification", {
                        method: "item/completed",
                        params: {threadId: turn.threadId, turnId: turn.turnId, item},
                    })
                }
                client.emit("notification", {
                    method: "turn/completed",
                    params: {threadId: turn.threadId, turn: {id: turn.turnId, status: "completed", items}},
                })
            },
        }
        const {manager, store, start} = fixture({behaviors: new Map([["codex:one", behavior]])})
        const [job] = await start()
        await manager.wait(job.id)

        const [activity] = store.getJob(job.id).activities
        assert.equal(activity.name, "Update installation checklist")
    })

    it("serializes the same Runtime and Skill while running different Runtimes concurrently", async () => {
        const gate = deferred()
        const starts = []
        const runtimes = [runtime("codex:one", "codex"), runtime("codebuddy:one", "codebuddy")]
        const behaviors = new Map()
        for (const descriptor of runtimes) {
            const behavior = successfulBehavior({
                runtimeId: descriptor.runtimeId,
                requestForPrompt: () => null,
                async beforeRun() {
                    starts.push(descriptor.runtimeId)
                    if (descriptor.runtimeId === "codex:one") await gate.promise
                },
            })
            behaviors.set(descriptor.runtimeId, behavior)
        }
        const {manager, start} = fixture({runtimes, behaviors})
        const [first] = await start({targets: [{runtimeId: "codex:one"}]})
        const [second] = await start({targets: [{runtimeId: "codex:one"}]})
        const [other] = await start({targets: [{runtimeId: "codebuddy:one"}]})
        await new Promise((resolve) => setImmediate(resolve))

        assert.deepEqual(starts.sort(), ["codebuddy:one", "codex:one"])
        assert.equal(manager.isRunning(second.id), false)
        gate.resolve()
        await Promise.all([manager.wait(first.id), manager.wait(second.id), manager.wait(other.id)])
        assert.equal(starts.filter((entry) => entry === "codex:one").length, 2)
    })

    it("scopes permission and question interactions to the installation job", async () => {
        const observed = []
        const behaviors = new Map()
        const behavior = successfulBehavior({
            runtimeId: "deepseek-harness:one",
            requestForPrompt: () => null,
            async beforeRun(client, turn) {
                await client.options.requestPermission({
                    params: {sessionId: turn.threadId},
                    options: [{optionId: "allow_once"}, {optionId: "reject"}],
                })
                await client.options.requestQuestion({
                    sessionId: turn.threadId,
                    rpcId: "question-1",
                    questions: [{id: "confirm", prompt: "Overwrite?"}],
                })
            },
        })
        behaviors.set("deepseek-harness:one", behavior)
        const {manager, store, start} = fixture({
            runtimes: [runtime("deepseek-harness:one", "deepseek-harness")],
            behaviors,
            requestPermission: async (request) => {
                observed.push({kind: "permission", jobId: request.jobId})
                return "allow_once"
            },
            requestQuestion: async (request) => {
                observed.push({kind: "question", jobId: request.jobId})
                return {answers: [{questionId: "confirm", answer: "Continue overwrite"}]}
            },
        })
        const [job] = await start()
        await manager.wait(job.id)

        assert.deepEqual(observed, [
            {kind: "permission", jobId: job.id},
            {kind: "question", jobId: job.id},
        ])
        assert.equal(store.getJob(job.id).status, "succeeded")
    })

    it("marks missing or invalid final protocol as unverified and always stops the client", async () => {
        const behavior = successfulBehavior({
            runtimeId: "codex:one",
            requestForPrompt: () => null,
            items: [{id: "message-1", type: "agentMessage", text: "I think it worked"}],
        })
        const {manager, store, clients, start} = fixture({
            behaviors: new Map([["codex:one", behavior]]),
        })
        const [job] = await start()
        await manager.wait(job.id)

        const stored = store.getJob(job.id)
        assert.equal(stored.status, "unverified")
        assert.match(stored.error.message, /structured result/u)
        assert.equal(clients[0].stopped, true)
    })

    it("keeps the Runtime's bounded failure explanation when its result evidence is invalid", async () => {
        const behavior = successfulBehavior({
            runtimeId: "codex:one",
            requestForPrompt: () => null,
            resultOverrides: {
                status: "failed",
                result: {actualDigest: "sha256:truncated", markerWritten: false},
                error: {code: "MARKER_INVALID", message: "The existing management marker is truncated; nothing was changed."},
            },
        })
        const {manager, store, start} = fixture({behaviors: new Map([["codex:one", behavior]])})
        const [job] = await start()
        await manager.wait(job.id)
        const stored = store.getJob(job.id)
        assert.equal(stored.status, "unverified")
        assert.equal(stored.parsedResult, null)
        assert.equal(stored.error.code, "INSTALLATION_RESULT_INVALID")
        assert.match(stored.error.message, /management marker is truncated/u)
        assert.match(stored.error.message, /digest is invalid/u)
    })

    for (const repairSucceeds of [true, false]) it(`repairs an invalid read-only result at most once (success=${repairSucceeds})`, async () => {
        let inspectionTurns = 0
        const behavior = {
            threadSequence: 1, turnSequence: 1,
            async run(client, turn) {
                const inspection = turn.options.permissionMode === "read-only"
                if (inspection) inspectionTurns++
                const text = resultText(client.options.installationRequest, {
                    operation: inspection ? "inspect" : "install",
                    ...(inspection && (inspectionTurns === 1 || !repairSucceeds) ? {destination: null} : {}),
                })
                client.emit("notification", {method: "item/completed", params: {threadId: turn.threadId, turnId: turn.turnId, item: {id: `result-${turn.turnId}`, type: "agentMessage", text}}})
                client.emit("notification", {method: "turn/completed", params: {threadId: turn.threadId, turn: {id: turn.turnId, status: "completed"}}})
            },
        }
        const {manager, store, clients, start} = fixture({behaviors: new Map([["codex:one", behavior]])})
        const [installed] = await start()
        await manager.wait(installed.id)
        const inspection = await manager.inspect(installed.id)
        await manager.wait(inspection.id)
        assert.equal(inspectionTurns, 2)
        assert.equal(store.getJob(inspection.id).status, repairSucceeds ? "succeeded" : "unverified")
        assert.ok(clients[1].startedTurns.every((turn) => turn.options.permissionMode === "read-only"))
        assert.match(clients[1].startedTurns[1].prompt, /absolute destination/u)
        assert.ok(store.getJob(inspection.id).messages.some((message) => message.role === "user" && message.content.includes("format")))
    })

    it("interrupts an active turn, performs a read-only inspection, and keeps the job cancelled", async () => {
        const turnStarted = deferred()
        const behavior = {
            runtimeId: "codex:one",
            threadSequence: 1,
            turnSequence: 1,
            requestForPrompt: () => null,
            async run(client, turn) {
                if (client.startedTurns.length === 1) {
                    turnStarted.resolve({client, turn})
                    return
                }
                const text = resultText(client.options.installationRequest, {
                    operation: "inspect",
                })
                client.emit("notification", {
                    method: "item/completed",
                    params: {
                        threadId: turn.threadId,
                        turnId: turn.turnId,
                        item: {id: "inspect-result", type: "agentMessage", text},
                    },
                })
                client.emit("notification", {
                    method: "turn/completed",
                    params: {threadId: turn.threadId, turn: {id: turn.turnId, status: "completed"}},
                })
            },
            onInterrupt(client, turn) {
                client.emit("notification", {
                    method: "turn/completed",
                    params: {threadId: turn.threadId, turn: {id: turn.turnId, status: "interrupted"}},
                })
            },
        }
        const {manager, store, start} = fixture({
            behaviors: new Map([["codex:one", behavior]]),
        })
        const [job] = await start()
        const {client} = await turnStarted.promise
        await manager.cancel(job.id)
        await manager.wait(job.id)

        assert.equal(client.interrupts.length, 1)
        assert.equal(client.startedTurns.length, 2)
        assert.match(client.startedTurns[1].prompt, /"operation": "inspect"/u)
        assert.equal(client.startedTurns[1].options.permissionMode, "read-only")
        const stored = store.getJob(job.id)
        assert.equal(stored.status, "cancelled")
        assert.equal(stored.parsedResult.operation, "inspect")
    })

    it("starts an explicit read-only inspection in the existing installer thread", async () => {
        const {manager, store, clients, start} = fixture()
        const [installed] = await start()
        await manager.wait(installed.id)

        const inspected = await manager.inspect(installed.id)
        await manager.wait(inspected.id)

        assert.equal(clients.length, 2)
        assert.equal(clients[1].resumedThreadId, store.getJob(installed.id).threadId)
        assert.equal(clients[1].threadOptions.permissionMode, "read-only")
        const stored = store.getJob(inspected.id)
        assert.equal(stored.operation, "inspect")
        assert.equal(stored.parentJobId, installed.id)
        assert.equal(stored.status, "succeeded")
        assert.equal(stored.parsedResult.operation, "inspect")
    })

    it("continues a terminal installer session without changing its trusted outcome", async () => {
        const {manager, store, clients, start} = fixture()
        const [installed] = await start()
        await manager.wait(installed.id)
        const before = store.getJob(installed.id)

        await manager.send(installed.id, "Explain how the destination was discovered.")
        await manager.wait(installed.id)

        const after = store.getJob(installed.id)
        assert.equal(clients.length, 2)
        assert.equal(clients[1].resumedThreadId, before.threadId)
        assert.equal(after.status, "succeeded")
        assert.equal(after.conversationStatus, "idle")
        assert.equal(after.completedAt, before.completedAt)
        assert.ok(after.timeline.some(
            (entry) => entry.role === "user" && entry.content.includes("destination was discovered"),
        ))
    })
})
