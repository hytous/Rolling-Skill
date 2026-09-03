const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, mkdirSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {it} = require("node:test")
const {createRollingSkillApplication} = require("../src/application.cjs")
const {LocalEvaluationStore} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {RawCaseStore} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")
const {AutomaticCaptureEvidenceStore} = require("../../../desktop/rolling-skill/src/automatic-capture-evidence-store.cjs")
const {SkillInstallationStore} = require("../../../desktop/rolling-skill/src/skill-installation-store.cjs")
const {freezeSkillInstallationRequest} = require("../../../desktop/rolling-skill/src/skill-installation-protocol.cjs")
const {buildEpisodeSnapshot} = require("../../../desktop/rolling-skill/src/episode-curation.cjs")

const settle = () => new Promise((resolve) => setImmediate(resolve))

function thread(id, question = "Original question", answer = "Frozen answer") {
    return {id, model: "source-model", turns: [{id: "source-turn", status: "completed", items: [
        {id: "user-1", type: "userMessage", content: [{type: "text", text: question}]},
        {id: "answer-1", type: "agentMessage", text: answer},
    ]}]}
}

function draft(summary) {
    return {
        schemaVersion: "rolling-skill-curated-case/v1",
        referenceAnswer: {summary, requiredFacts: ["Preserve the original question"], requiredSteps: ["Use the frozen evidence"], requiredOutputFormat: ["State the conclusion"],
            evidence: [{claim: "The original question is preserved", sourceItemIds: ["user-1"]}]},
        grading: {hardRequirements: [{id: "H1", criterion: "Answer the question", passCondition: "Use the source evidence", evidenceBasis: "Original question"}],
            softCriteria: [{id: "S1", criterion: "Concise", weight: 1}], automaticFailures: ["Invented evidence"]},
        badCaseAnalysis: null,
    }
}

class Runtime extends EventEmitter {
    constructor(id) {
        super()
        this.id = id
        this.reads = []
        this.starts = []
        this.turns = []
        this.archived = []
        this.replays = []
        this.sources = new Map()
        this.inventory = []
    }
    async start() {}
    async stop() {}
    async listSkills() { return {data: [{skills: this.inventory}]} }
    async readThread(id) {
        this.reads.push(id)
        if (!this.sources.has(id)) throw new Error(`Source ${id} is unavailable in ${this.id}`)
        return {thread: this.sources.get(id)}
    }
    async runEvaluationCase(input) {
        this.replays.push(input)
        const id = `${this.id}-replay-${this.replays.length}`
        this.sources.set(id, thread(id, input.question, "Fresh replay answer"))
        input.onThreadStarted(id)
        return {threadId: id, turnId: "source-turn"}
    }
    async startThread(options) {
        const id = `${this.id}-curator-${this.starts.length + 1}`
        this.starts.push({id, options})
        return {thread: {id, modelProvider: "codex"}}
    }
    async startTurn(threadId, input, options) {
        const turn = {id: `${this.id}-turn-${this.turns.length + 1}`}
        this.turns.push({threadId, input, options, turn})
        return {turn}
    }
    async resumeThread(id) { assert.ok(id.startsWith(this.id)); return {thread: {id}} }
    async archiveThread(id) { assert.ok(id.startsWith(this.id)); this.archived.push(id) }
    async interruptTurn() {}
    complete(session, summary) {
        this.emit("notification", {method: "turn/completed", params: {
            threadId: session.curator.threadId,
            turn: {id: session.curator.currentTurnId, status: "completed", items: [
                {id: "curator-answer", type: "agentMessage", text: `\`\`\`json\n${JSON.stringify(draft(summary))}\n\`\`\``},
            ]},
        }})
    }
}

async function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-case-journey-"))
    const dataRoot = join(root, "data")
    const source = join(root, "source")
    mkdirSync(source)
    writeFileSync(join(source, "SKILL.md"), "---\nname: billing\ndescription: Billing workflow\n---\nUse evidence.\n")
    const clients = {"codex:a": new Runtime("codex:a"), "codex:b": new Runtime("codex:b")}
    const descriptors = Object.keys(clients).map((runtimeId) => ({runtimeId, providerId: "codex", displayName: runtimeId,
        executablePath: `/runtime/${runtimeId.slice(-1)}/codex`, version: "1"}))
    const registry = {discover: () => ({available: descriptors}), createClient: (descriptor) => clients[descriptor.runtimeId]}
    const bootstrap = createRollingSkillApplication({dataRoot, workerMode: true, runtimeRegistry: registry})
    const imported = await bootstrap.dispatch("skills.import", {kind: "folder", location: source, displayName: "Billing"})
    const skill = imported.skills[0]
    const version = await bootstrap.dispatch("skills.release", {skillId: skill.id, versionId: imported.versions[0].id, versionLabel: "v1"})
    const dataset = await bootstrap.dispatch("datasets.create", {name: "Billing Cases", repositoryId: imported.repository.id, skillId: skill.id})
    await bootstrap.dispatch("settings.selectRuntime", {runtimeId: "codex:b"})
    await bootstrap.dispatch("settings.update", {rollingSkill: {curatorModelId: "curator-model", curatorEffort: "high", taskModelId: "task-model", taskEffort: "medium"}})
    await bootstrap.close()
    const store = new LocalEvaluationStore(join(dataRoot, "evaluation-store.json"))
    const saved = store.saveCase({datasetId: dataset.id, caseType: "goodcase", question: "Original question", answer: "Old answer"})
    const installations = new SkillInstallationStore(join(dataRoot, "skill-installations.json"))
    const request = freezeSkillInstallationRequest({repository: imported.repository, skill, version})
    for (const descriptor of descriptors) {
        const destination = `/installed/${descriptor.runtimeId.slice(-1)}/billing`
        clients[descriptor.runtimeId].inventory = [{name: skill.name, path: `${destination}/SKILL.md`, enabled: true}]
        const job = installations.createJob({runtime: descriptor, request, modelId: null, effort: null, permissionMode: "workspace-write"})
        installations.updateJob(job.id, {status: "running"})
        installations.completeJob(job.id, {status: "succeeded", parsedResult: {
            schema: "rolling-skill-install-result/v1", status: "succeeded", operation: "install", classificationBefore: "absent",
            destination, source: {...request.source}, permission: {requested: "workspace-write", effective: "workspace-write"},
            result: {actualDigest: request.source.expectedDigest, markerWritten: true, runtimeDiscovered: true},
            warnings: [], error: null, verification: "runtime-inventory", trusted: true,
        }})
    }
    const episode = buildEpisodeSnapshot(thread("source-a"), {startItemId: "user-1", endItemId: "answer-1", runtimeId: "codex:a"})
    const frozen = {...episode, source: {...episode.source, kind: "dsh-session", sessionId: "native-session", startSeq: 1, endSeq: 2,
        endMessageId: "native-answer", digest: `sha256:${"a".repeat(64)}`}}
    // Keep the production Core/Curator/store lifecycle; only external Runtime and prerequisite discovery are substituted.
    const operation = {
        executionSkillReference: {schemaVersion: "rolling-skill-skill-reference/v1", id: skill.id, repositoryId: imported.repository.id,
            name: skill.name, path: "/installed/b/billing/SKILL.md", runtimeId: "codex:b", providerId: "codex", scope: "runtime"},
        operationEvidence: {schemaVersion: "rolling-skill-operation-evidence/v1", kind: "curation", skillId: skill.id, repositoryId: imported.repository.id,
            runtime: descriptors[1], installation: {destination: "/installed/b/billing"}},
    }
    const application = createRollingSkillApplication({dataRoot, workerMode: true, runtimeRegistry: registry,
        conversationEpisodeSource: {inspect: async () => ({}), capture: async () => ({episode: frozen, source: frozen.source})},
        conversationCurationOperationResolver: {resolve: () => structuredClone(operation)},
    })
    const raw = new RawCaseStore(join(dataRoot, "raw-cases", "events.jsonl"))
    const evidence = new AutomaticCaptureEvidenceStore(join(dataRoot, "raw-cases", "evidence"))
    t.after(async () => { raw.close(); await application.close(); rmSync(root, {recursive: true, force: true}) })
    const addRaw = ({snapshot = true, runtimeId = "codex:a"} = {}) => raw.addAutomaticCandidate({
        question: episode.originalQuestion, note: "Keep the frozen evidence", skill: {id: skill.id, name: skill.name},
        source: {kind: "automatic_capture", ...episode.source, runtimeId, outcome: "resolved", caseType: "goodcase", confidence: 0.99,
            inspectedAt: "2026-09-01T00:00:00Z", ...(snapshot ? {evidence: evidence.save(episode)} : {})},
    }).rawCase
    return {application, get store() { return new LocalEvaluationStore(join(dataRoot, "evaluation-store.json")) }, dataset, saved, clients, addRaw, frozen}
}

async function completeAndSave(test, sessionId, runtimeId, summary) {
    await settle()
    const started = test.store.getCurationSession(sessionId)
    assert.equal(started.status, "running")
    test.clients[runtimeId].complete(started, summary)
    await settle()
    const reviewed = await test.application.dispatch("curation.get", {sessionId})
    assert.equal(reviewed.status, "needs_review", reviewed.error)
    const result = await test.application.dispatch("curation.save", {sessionId, expectedRevision: reviewed.revision, idempotencyKey: `save-${sessionId}`})
    assert.equal(result.session.status, "archived")
    return test.application.dispatch("cases.get", {datasetId: test.dataset.id, caseId: result.caseRecord.id})
}

it("replays on the requested Runtime but curates with the configured Runtime through reviewed and saved", async (t) => {
    const test = await fixture(t)
    const session = await test.application.dispatch("cases.refresh", {datasetId: test.dataset.id, caseId: test.saved.id, runtimeId: "codex:a", idempotencyKey: "refresh"})
    await settle()
    assert.equal(test.clients["codex:a"].replays[0].skillReference.path, "/installed/a/billing/SKILL.md")
    assert.equal(test.store.getDataset(test.dataset.id).skillReference.path, null)
    assert.equal(test.store.getCurationSession(session.id).curator.runtimeId, "codex:b")
    assert.equal(test.store.getCurationSession(session.id).curator.modelId, "curator-model")
    assert.equal(test.store.getCurationSession(session.id).executionSkillReference.path, "/installed/a/billing/SKILL.md")
    const result = await completeAndSave(test, session.id, "codex:b", "Refreshed and saved")
    assert.equal(result.id, test.saved.id)
    assert.equal(result.curated.referenceAnswer.summary, "Refreshed and saved")
    assert.equal(result.question, test.saved.question)
    assert.equal(test.clients["codex:b"].starts.length, 1)
})

it("does not interrupt an existing Curator when starting a Case refresh", async (t) => {
    const test = await fixture(t)
    const existing = await test.application.dispatch("conversationCuration.create", {datasetId: test.dataset.id, label: "good",
        sessionId: "native-session", endMessageId: "native-answer", startSeq: 1, idempotencyKey: "capture"})
    await settle()
    assert.equal(test.store.getCurationSession(existing.id).status, "running")
    let refreshError
    const refresh = await test.application.dispatch("cases.refresh", {datasetId: test.dataset.id, caseId: test.saved.id, runtimeId: "codex:a", idempotencyKey: "parallel-refresh"}).catch((error) => { refreshError = error })
    assert.equal(test.store.getCurationSession(existing.id).status, "running")
    assert.equal(refreshError, undefined)
    await completeAndSave(test, existing.id, "codex:b", "Original capture saved")
    await completeAndSave(test, refresh.id, "codex:a", "Parallel refresh saved")
})

it("curates a frozen Raw Case without rereading its unavailable source and respects Curator settings", async (t) => {
    const test = await fixture(t)
    const raw = test.addRaw()
    const session = await test.application.dispatch("rawCases.createDraft", {id: raw.id, datasetId: test.dataset.id, idempotencyKey: "frozen-raw"})
    await settle()
    assert.deepEqual(test.clients["codex:a"].reads, [])
    assert.deepEqual(test.clients["codex:b"].reads, [])
    const persisted = test.store.getCurationSession(session.id)
    assert.equal(persisted.curator.modelId, "curator-model")
    assert.equal(persisted.curator.effort, "high")
    assert.equal(persisted.episode.source.runtimeId, "codex:a")
    assert.equal(persisted.episode.items.at(-1).text, "Frozen answer")
    const saved = await completeAndSave(test, session.id, "codex:b", "Frozen case saved")
    assert.equal(saved.question, "Original question")
    assert.equal((await test.application.dispatch("rawCases.list", {})).length, 0)
})

it("reads legacy Raw Case boundaries from the source Runtime, not the Curator Runtime", async (t) => {
    const test = await fixture(t)
    test.clients["codex:a"].sources.set("source-a", thread("source-a"))
    const raw = test.addRaw({snapshot: false})
    const session = await test.application.dispatch("rawCases.createDraft", {id: raw.id, datasetId: test.dataset.id, idempotencyKey: "legacy-raw"})
    assert.deepEqual(test.clients["codex:a"].reads, ["source-a"])
    assert.deepEqual(test.clients["codex:b"].reads, [])
    await completeAndSave(test, session.id, "codex:b", "Legacy case saved")
})

it("keeps a Raw Case pending when its source Runtime is unavailable", async (t) => {
    const test = await fixture(t)
    const raw = test.addRaw({snapshot: false, runtimeId: "codex:missing"})
    await assert.rejects(test.application.dispatch("rawCases.createDraft", {id: raw.id, datasetId: test.dataset.id, idempotencyKey: "missing-source"}), /Runtime.*no longer available/)
    assert.deepEqual(test.clients["codex:b"].reads, [])
    assert.equal((await test.application.dispatch("rawCases.list", {}))[0].id, raw.id)
})
