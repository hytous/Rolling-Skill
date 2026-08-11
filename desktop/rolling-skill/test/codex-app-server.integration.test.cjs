const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {after, describe, it} = require("node:test")

const {CodexAppServerClient} = require("../src/codex-app-server.cjs")
const {CodexRuntimeProvider} = require("../src/codex-runtime-provider.cjs")

const descriptor = new CodexRuntimeProvider().discover()[0] ?? null

describe("discovered local Codex app-server smoke", {skip: !descriptor}, () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-"))
    const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-app-server-trace-"))
    const client = new CodexAppServerClient({
        binaryPath: descriptor?.executablePath,
        runtimeDescriptor: descriptor,
        traceDirectory,
        workspaceRoot,
    })

    after(async () => {
        await client.stop()
        rmSync(workspaceRoot, {recursive: true, force: true})
        rmSync(traceDirectory, {recursive: true, force: true})
    })

    it("initializes and lists workspace-scoped threads without any web service", async () => {
        const state = await client.start()
        const response = await client.listThreads()
        const skills = await client.listSkills({forceReload: true})

        assert.equal(state.status, "ready")
        assert.equal(state.runtime.runtimeId, descriptor.runtimeId)
        assert.equal(Array.isArray(response.data), true)
        assert.equal(Array.isArray(skills.data), true)
        assert.equal(skills.data.some((entry) => entry.cwd === workspaceRoot), true)
        assert.equal(response.data.every((thread) => thread.cwd === workspaceRoot), true)
        const listRequest = client
            .recentTrace(20)
            .events.find((event) => event.message?.method === "thread/list")
        assert.equal(listRequest.message.params.cwd, workspaceRoot)
    })
})

describe("Codex app-server request construction", () => {
    it("uses the temporary codex_exec originator while retaining the Rolling Skill title", async () => {
        const writes = []
        class FakeChild extends EventEmitter {
            constructor() {
                super()
                this.stdout = new EventEmitter()
                this.stderr = new EventEmitter()
                this.stdin = {writable: true, write: (value) => writes.push(JSON.parse(value))}
            }
            kill() {
                this.emit("close", 0, null)
            }
        }

        const traceDirectory = mkdtempSync(join(tmpdir(), "rolling-skill-originator-trace-"))
        const child = new FakeChild()
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory,
            workspaceRoot: "/tmp/workspace",
            spawnProcess: () => child,
        })

        try {
            const started = client.start()
            await new Promise((resolve) => setImmediate(resolve))
            child.stdout.emit("data", `${JSON.stringify({id: 1, result: {userAgent: "Codex"}})}\n`)
            await started

            assert.equal(writes[0].method, "initialize")
            assert.deepEqual(writes[0].params.clientInfo, {
                name: "codex_exec",
                title: "Rolling Skill",
                version: require("../package.json").version,
            })
        } finally {
            await client.stop()
            rmSync(traceDirectory, {recursive: true, force: true})
        }
    })

    it("lists the active runtime model catalog", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {data: []}
        }

        await client.listModels()

        assert.deepEqual(request, {
            method: "model/list",
            params: {limit: 100, includeHidden: false},
        })
    })

    it("lists active threads by default and archived threads on request", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        const requests = []
        client.request = async (method, params) => {
            requests.push({method, params})
            return {data: []}
        }

        await client.listThreads()
        await client.listThreads({archived: false})
        await client.listThreads({archived: true})

        assert.deepEqual(
            requests.map(({method, params}) => ({method, archived: params.archived})),
            [
                {method: "thread/list", archived: false},
                {method: "thread/list", archived: false},
                {method: "thread/list", archived: true},
            ],
        )
        assert.equal(requests.every(({params}) => params.cwd === "/tmp/workspace"), true)
    })

    it("can override the model and reasoning effort for this turn and subsequent turns", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-1"}}
        }

        await client.startTurn("thread-1", "hello", {
            model: "gpt-5.6-sol",
            effort: "high",
        })

        assert.equal(request.method, "turn/start")
        assert.equal(request.params.threadId, "thread-1")
        assert.equal(request.params.model, "gpt-5.6-sol")
        assert.equal(request.params.effort, "high")
        assert.equal("reasoningEffort" in request.params, false)
    })

    it("applies approval and sandbox overrides directly on the turn", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-1"}}
        }

        await client.startTurn("thread-1", "hello", {
            approvalPolicy: "never",
            sandbox: "workspace-write",
        })

        assert.equal(request.params.approvalPolicy, "never")
        assert.deepEqual(request.params.sandboxPolicy, {
            type: "workspaceWrite",
            writableRoots: [],
            networkAccess: false,
            excludeTmpdirEnvVar: false,
            excludeSlashTmp: false,
        })
    })

    it("sends explicit nulls when the user resets turn settings to runtime defaults", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-default"}}
        }

        await client.startTurn("thread-1", "hello", {model: null, effort: null})

        assert.equal(request.method, "turn/start")
        assert.equal(request.params.model, null)
        assert.equal(request.params.effort, null)
    })

    it("allows a read-only subagent thread and a caller-selected model", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {thread: {id: "curator-thread"}}
        }

        await client.startThread({
            sandbox: "read-only",
            threadSource: "subagent",
            model: "gpt-5.6-sol",
        })

        assert.equal(request.method, "thread/start")
        assert.equal(request.params.cwd, "/tmp/workspace")
        assert.equal(request.params.sandbox, "read-only")
        assert.equal(request.params.threadSource, "subagent")
        assert.equal(request.params.model, "gpt-5.6-sol")
    })

    it("applies a client-level execution policy to thread start and resume", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
            executionPolicy: {
                sandbox: "danger-full-access",
                approvalPolicy: "never",
            },
        })
        const requests = []
        client.request = async (method, params) => {
            requests.push({method, params})
            return {thread: {id: "thread-1"}}
        }

        await client.startThread()
        await client.resumeThread("thread-1")
        client.setExecutionPolicy({
            sandbox: "workspace-write",
            approvalPolicy: "never",
        })
        await client.startThread()

        assert.deepEqual(
            requests.map(({method, params}) => ({
                method,
                sandbox: params.sandbox,
                approvalPolicy: params.approvalPolicy,
            })),
            [
                {
                    method: "thread/start",
                    sandbox: "danger-full-access",
                    approvalPolicy: "never",
                },
                {
                    method: "thread/resume",
                    sandbox: "danger-full-access",
                    approvalPolicy: "never",
                },
                {
                    method: "thread/start",
                    sandbox: "workspace-write",
                    approvalPolicy: "never",
                },
            ],
        )
    })

    it("archives a Curator thread through the supported protocol method", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {}
        }

        await client.archiveThread("curator-thread")
        assert.deepEqual(request, {
            method: "thread/archive",
            params: {threadId: "curator-thread"},
        })
    })

    it("unarchives a thread through the supported protocol method", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {thread: {id: "thread-1"}}
        }

        const response = await client.unarchiveThread("thread-1")

        assert.deepEqual(request, {
            method: "thread/unarchive",
            params: {threadId: "thread-1"},
        })
        assert.deepEqual(response, {thread: {id: "thread-1"}})
    })

    it("resumes Curator threads without upgrading their sandbox", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {}
        }

        await client.resumeThread("curator-thread", {
            sandbox: "read-only",
            model: "gpt-5.6-sol",
        })
        assert.equal(request.params.sandbox, "read-only")
        assert.equal(request.params.model, "gpt-5.6-sol")
    })

    it("lists runtime-owned Skills for the active workspace", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {data: []}
        }

        await client.listSkills({forceReload: true})

        assert.deepEqual(request, {
            method: "skills/list",
            params: {cwds: ["/tmp/workspace"], forceReload: true},
        })
    })

    it("uses a structured Skill mention only for explicit diagnostic runs", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        let request
        client.request = async (method, params) => {
            request = {method, params}
            return {turn: {id: "turn-1"}}
        }
        const input = [
            {type: "skill", name: "billing-cost-management", path: "/skills/billing/SKILL.md"},
            {type: "text", text: "查一下七月账单", text_elements: []},
        ]

        await client.startTurn("thread-1", input)

        assert.deepEqual(request.params.input, input)
    })

    it("removes its evaluation listener when turn startup fails", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.startThread = async () => ({thread: {id: "evaluation-thread"}})
        client.startTurn = async () => {
            throw new Error("turn startup failed")
        }

        await assert.rejects(
            client.runEvaluationCase({question: "hello"}),
            /turn startup failed/,
        )

        assert.equal(client.listenerCount("notification"), 0)
    })

    it("ends an evaluation immediately when the runtime stops", async () => {
        const client = new CodexAppServerClient({
            binaryPath: "/tmp/codex",
            traceDirectory: "/tmp",
            workspaceRoot: "/tmp/workspace",
        })
        client.startThread = async () => ({thread: {id: "evaluation-thread"}})
        client.startTurn = async () => ({turn: {id: "evaluation-turn"}})

        const operation = client.runEvaluationCase({question: "hello"})
        await new Promise((resolve) => setImmediate(resolve))
        client.emit("state", {status: "stopped"})

        await assert.rejects(operation, /stopped before completion/)
        assert.equal(client.listenerCount("notification"), 0)
        assert.equal(client.listenerCount("state"), 0)
    })
})
