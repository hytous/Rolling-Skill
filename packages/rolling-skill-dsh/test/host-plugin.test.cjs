const assert = require("node:assert/strict")
const {mkdtempSync, mkdirSync, readFileSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {Readable} = require("node:stream")
const {it} = require("node:test")
const {pathToFileURL} = require("node:url")

const {LocalEvaluationStore} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {ManagedSkillStore} = require("../../../desktop/rolling-skill/src/managed-skill-store.cjs")
const {SkillInstallationStore} = require("../../../desktop/rolling-skill/src/skill-installation-store.cjs")
const {RollingSkillConfigStore} = require("../../rolling-skill-core/src/config-store.cjs")

const COMMIT = "b".repeat(40)
const DIGEST = `sha256:${"a".repeat(64)}`
const RUNTIME = {
    runtimeId: "deepseek-harness:/opt/test-dsh",
    providerId: "deepseek-harness",
    displayName: "Test DSH",
    version: "1.0.0",
    executablePath: "/opt/test-dsh",
    source: "test",
    transport: "stdio-jsonl",
    capabilities: [],
    models: [],
    efforts: [],
}

function sessionLog() {
    return {
        session: {version: 0, id: "session-1", createdAt: 100, cwd: "/workspace"},
        events: [
            {seq: 0, time: 100, type: "turn/start", data: {turn: 0}},
            {
                seq: 1,
                time: 101,
                type: "user/message",
                data: {
                    id: "human-1",
                    role: "user",
                    content: [{type: "text", text: "查七月账单"}],
                    source: {kind: "user"},
                },
            },
            {
                seq: 2,
                time: 102,
                type: "tool/call",
                data: {turn: 0, step: 0, callId: "skill-1", name: "skill", arguments: {name: "billing"}},
            },
            {
                seq: 3,
                time: 103,
                type: "tool/result",
                data: {
                    turn: 0,
                    step: 0,
                    message: {
                        id: "tool-1",
                        role: "user",
                        source: {kind: "tool", callId: "skill-1"},
                        content: [{type: "text", text: "billing loaded"}],
                    },
                    meta: {
                        name: "billing",
                        provider: "filesystem",
                        resourceBase: {kind: "directory", path: "/runtime/skills/billing"},
                    },
                },
            },
            {
                seq: 4,
                time: 102,
                type: "assistant/message",
                data: {
                    turn: 0,
                    step: 0,
                    message: {
                        id: "assistant-1",
                        role: "assistant",
                        content: [{type: "text", text: "七月成本 100 元"}],
                        source: {kind: "model", provider: "deepseek", model: "deepseek-chat"},
                    },
                },
            },
            {seq: 5, time: 105, type: "turn/end", data: {turn: 0, reason: {kind: "completed"}}},
        ],
    }
}

function seedCurationPrerequisites(dataRoot) {
    mkdirSync(join(dataRoot, "managed-skills"), {recursive: true})
    const managedPath = mkdtempSync(join(tmpdir(), "rolling-skill-managed-repo-"))
    const managedStore = new ManagedSkillStore(join(dataRoot, "managed-skills", "registry.json"))
    const repository = managedStore.addRepository({
        displayName: "Billing repository",
        managedPath,
        defaultBranch: "main",
        source: {kind: "folder", location: managedPath},
    })
    const skill = managedStore.replaceRepositorySkills(repository.id, [{
        name: "billing",
        description: "Billing Skill",
        skillRoot: "billing",
        manifestPath: "billing/SKILL.md",
        status: "valid",
        warnings: [],
        executableFiles: [],
    }])[0]
    const candidate = managedStore.addVersion({
        repositoryId: repository.id,
        skillId: skill.id,
        commit: COMMIT,
        contentDigest: DIGEST,
        state: "candidate",
        createdBy: "user",
    })
    const version = managedStore.releaseVersion(candidate.id, "v1")

    const seedStore = new LocalEvaluationStore(join(dataRoot, "evaluation-store.json"))
    const dataset = seedStore.bindDatasetSkill(seedStore.listDatasets()[0].id, {
        schemaVersion: "rolling-skill-skill-reference/v1",
        evidencePrecision: "managed",
        id: skill.id,
        repositoryId: repository.id,
        name: skill.name,
        path: null,
        scope: "managed",
        description: skill.description,
        runtimeId: null,
        providerId: null,
        confirmedAt: "2026-08-27T00:00:00.000Z",
    })
    const state = seedStore.read()
    state.datasetRubricVersions.push({
        id: "rubric-1",
        datasetId: dataset.id,
        version: 1,
        rubric: {
            schemaVersion: "rolling-skill-dataset-rubric/v1",
            scoringModel: "unified-100/v1",
            title: "Billing rubric",
            summary: "Billing quality",
            criteria: [],
            automaticFailures: [],
        },
        rubricDigest: DIGEST,
        skillReference: dataset.skillReference,
        skillEvidenceDigest: DIGEST,
        createdAt: "2026-08-27T00:00:00.000Z",
    })
    state.datasets.find((entry) => entry.id === dataset.id).activeRubricVersionId = "rubric-1"
    writeFileSync(join(dataRoot, "evaluation-store.json"), `${JSON.stringify(state, null, 2)}\n`)

    new RollingSkillConfigStore(join(dataRoot, "config.json")).update({runtime: {
        providerId: RUNTIME.providerId,
        runtimeId: RUNTIME.runtimeId,
        displayName: RUNTIME.displayName,
        version: RUNTIME.version,
        executablePath: RUNTIME.executablePath,
    }})
    const installations = new SkillInstallationStore(join(dataRoot, "skill-installations.json"))
    const destination = "/runtime/skills/billing"
    const job = installations.createJob({
        operation: "install",
        runtime: RUNTIME,
        request: {
            schema: "rolling-skill-install-request/v1",
            purpose: "managed-installation",
            markerSchema: "rolling-skill-install/v1",
            repositoryPath: managedPath,
            skillName: skill.name,
            versionLabel: version.versionLabel,
            source: {
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: version.id,
                commit: version.commit,
                skillRoot: version.skillRoot,
                expectedDigest: version.contentDigest,
            },
        },
    })
    installations.updateJob(job.id, {status: "running"})
    installations.completeJob(job.id, {
        status: "succeeded",
        parsedResult: {trusted: true, destination, verification: "runtime-inventory"},
    })
    return dataset
}

async function callRoute(handler, method, input) {
    const request = Readable.from([Buffer.from(JSON.stringify({method, input}))])
    request.method = "POST"
    request.headers = {
        "content-type": "application/json",
        host: "127.0.0.1:3080",
        origin: "http://127.0.0.1:3080",
    }
    request.aborted = false
    const headers = new Map()
    let body = ""
    const response = {
        destroyed: false,
        writableEnded: false,
        statusCode: 0,
        setHeader(name, value) {
            headers.set(String(name).toLowerCase(), value)
        },
        end(value = "") {
            body += String(value)
            this.writableEnded = true
        },
    }
    await handler(request, response)
    return {status: response.statusCode, headers, body: JSON.parse(body)}
}

it("does not mount a second Rolling Skill Host inside a managed DSH Runtime", async () => {
    const source = pathToFileURL(join(__dirname, "../src/host/index.js"))
    const plugin = await import(`${source.href}?nested-host=${Date.now()}`)
    const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-nested-host-"))
    let effects = 0
    let cleanup = null
    const context = {
        agents: {},
        sessionQuery: {},
        tools: {register: () => () => {}},
        webServer: {register: () => () => {}},
        effect(factory) {
            effects += 1
            cleanup = factory()
        },
    }

    try {
        plugin.apply(context, {dataRoot}, {
            environment: {ROLLING_SKILL_OPERATOR_HOST: "1"},
        })
        assert.equal(effects, 0)
    } finally {
        await cleanup?.()
    }
})

it("registers and disposes the Rolling Skill Cordis Host route", async () => {
    const hostSource = readFileSync(join(__dirname, "../src/host/index.js"), "utf8")
    assert.doesNotMatch(hostSource, /ctx\.runtimeRegistry/u)
    const source = pathToFileURL(join(__dirname, "../src/host/index.js"))
    const plugin = await import(`${source.href}?test=${Date.now()}`)
    const effects = []
    let registeredRoute = null
    let routeDisposed = false
    const toolNames = []
    let sessionReads = 0
    const pickedSourceKinds = []
    const context = {
        agents: {
            get: () => null,
            async create() {
                return {
                    agent: {followup() {}},
                    async dispose() {},
                }
            },
        },
        tools: {
            register(definition) {
                toolNames.push(definition.name)
                return () => {}
            },
        },
        sessionQuery: {
            async readSession(sessionId) {
                sessionReads += 1
                assert.equal(sessionId, "session-1")
                return sessionLog()
            },
            async traceEvent({sessionId, seq}) {
                return {
                    session: sessionLog().session,
                    target: {
                        sessionId,
                        seq,
                        type: seq === 1 ? "user/message" : "assistant/message",
                        time: seq === 1 ? 101 : 104,
                        surface: "current",
                    },
                    replacementChain: [],
                    replacedEventSeqs: [],
                    sourceEventSeqs: [],
                    derivedEventSeqs: [],
                }
            },
        },
        runtimeRegistry: {
            discover: () => ({available: [RUNTIME], selected: RUNTIME}),
            createClient() {
                return {
                    async start() {},
                    async stop() {},
                    async startThread() {
                        return {thread: {id: "curator-thread-1", modelProvider: RUNTIME.providerId}}
                    },
                    async startTurn() {
                        return {turn: {id: "curator-turn-1", items: []}}
                    },
                    async archiveThread() {},
                }
            },
        },
        webServer: {
            register(route) {
                registeredRoute = route
                return () => {
                    routeDisposed = true
                }
            },
        },
        effect(factory, label) {
            const dispose = factory()
            effects.push({dispose, label})
            return dispose
        },
    }

    assert.deepEqual(plugin.inject, ["webServer", "tools", "sessionQuery", "agents"])
    const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-host-"))
    const dataset = seedCurationPrerequisites(dataRoot)
    plugin.apply(context, {dataRoot}, {
        runtimeRegistry: context.runtimeRegistry,
        skillSourcePicker: async (kind) => {
            pickedSourceKinds.push(kind)
            return "/tmp/selected-skill-source"
        },
    })

    assert.equal(registeredRoute.kind, "exact")
    assert.equal(registeredRoute.path, "/rolling-skill/api")
    assert.equal(typeof registeredRoute.handler, "function")
    assert.equal(effects[0].label, "rolling-skill: host service")
    assert.deepEqual(toolNames, [
        "rolling_skill_status",
        "rolling_skill_add_raw_case",
        "rolling_skill_start_evaluation",
        "rolling_skill_run_capture",
    ])

    const pickedSource = await callRoute(
        registeredRoute.handler,
        "skills.chooseSource",
        {kind: "folder"},
    )
    assert.equal(pickedSource.status, 200)
    assert.deepEqual(pickedSource.body.value, {
        kind: "folder",
        location: "/tmp/selected-skill-source",
    })
    assert.deepEqual(pickedSourceKinds, ["folder"])

    const inspected = await callRoute(
        registeredRoute.handler,
        "conversationCuration.inspect",
        {sessionId: "session-1", endMessageId: "assistant-1"},
    )
    assert.equal(inspected.status, 200)
    assert.deepEqual(inspected.body.value.startCandidates.map((entry) => entry.seq), [1])

    const hostile = await callRoute(
        registeredRoute.handler,
        "conversationCuration.create",
        {
            sessionId: "session-1",
            endMessageId: "assistant-1",
            startSeq: 1,
            datasetId: dataset.id,
            label: "good",
            note: "",
            idempotencyKey: "host-create-hostile",
            episode: {forged: true},
        },
    )
    assert.equal(hostile.status, 400)
    assert.equal(sessionReads, 1)

    const created = await callRoute(
        registeredRoute.handler,
        "conversationCuration.create",
        {
            sessionId: "session-1",
            endMessageId: "assistant-1",
            startSeq: 1,
            datasetId: dataset.id,
            label: "good",
            note: "",
            idempotencyKey: "host-create-1",
        },
    )
    assert.equal(created.status, 200)
    assert.equal(created.body.value.sessionId, "session-1")
    assert.equal(created.body.value.startSeq, 1)
    assert.equal(sessionReads, 2, "create must re-read the Session after inspect")

    const markers = await callRoute(
        registeredRoute.handler,
        "conversationCuration.markers",
        {sessionId: "session-1"},
    )
    assert.equal(markers.status, 200)
    assert.equal(markers.body.value[0].curationSessionId, created.body.value.id)
    assert.equal(markers.body.value[0].status, "draft")

    await effects[0].dispose()
    assert.equal(routeDisposed, true)
})
