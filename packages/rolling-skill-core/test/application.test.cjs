const assert = require("node:assert/strict")
const {EventEmitter} = require("node:events")
const {mkdtempSync, mkdirSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")
const {RawCaseStore} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")

const modulePath = "../src/application.cjs"

async function importManagedSkill(application) {
    const source = mkdtempSync(join(tmpdir(), "rolling-skill-core-managed-source-"))
    mkdirSync(join(source, "billing"), {recursive: true})
    writeFileSync(
        join(source, "billing", "SKILL.md"),
        "---\nname: billing\ndescription: Managed billing workflow\n---\n\nUse the managed workflow.\n",
    )
    const imported = await application.dispatch("skills.import", {
        kind: "folder",
        location: source,
        displayName: "Billing repository",
    })
    return {
        repository: imported.repository,
        skill: imported.skills.find((entry) => entry.name === "billing"),
        version: imported.versions[0],
    }
}

describe("shared Rolling Skill application", () => {
    it("accepts a verified managed installation from a name-only Runtime inventory", () => {
        const {runtimeSkillMatchesVerifiedInstallation} = require(modulePath)

        assert.equal(runtimeSkillMatchesVerifiedInstallation({
            runtimeSkill: {
                name: "billing",
                enabled: true,
                evidencePrecision: "name-only",
            },
            managedSkillName: "billing",
            installedManifest: "/Users/test/.dsh/skills/billing/SKILL.md",
            allowNameOnly: true,
        }), true)
        assert.equal(runtimeSkillMatchesVerifiedInstallation({
            runtimeSkill: {
                name: "billing",
                enabled: true,
                evidencePrecision: "name-only",
            },
            managedSkillName: "billing",
            installedManifest: "/Users/test/.dsh/skills/billing/SKILL.md",
            allowNameOnly: false,
        }), false)
        assert.equal(runtimeSkillMatchesVerifiedInstallation({
            runtimeSkill: {
                name: "other",
                enabled: true,
                evidencePrecision: "name-only",
            },
            managedSkillName: "billing",
            installedManifest: "/Users/test/.dsh/skills/billing/SKILL.md",
            allowNameOnly: true,
        }), false)
    })

    it("hides evaluation target and Judge Runtime threads from automatic capture", () => {
        const {evaluationRuntimeThreadIds} = require(modulePath)
        const hidden = evaluationRuntimeThreadIds({
            evaluationRuns: [{
                results: [
                    {threadId: "target-thread", judge: {threadId: "judge-thread"}},
                    {threadId: null, judge: null},
                ],
            }],
        })

        assert.deepEqual([...hidden].sort(), ["judge-thread", "target-thread"])
    })

    it("hides persisted Skill installation Runtime threads from automatic capture", () => {
        const {installationRuntimeThreadIds} = require(modulePath)
        const hidden = installationRuntimeThreadIds({
            listJobs: () => [
                {id: "job-1", threadId: "install-thread"},
                {id: "job-2", threadId: "inspect-thread"},
                {id: "job-3", threadId: null},
            ],
        })

        assert.deepEqual([...hidden].sort(), ["inspect-thread", "install-thread"])
    })

    it("exposes strict review lifecycles for Curation and Rubric sessions", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-review-api-"))
        const calls = []
        const curation = {
            id: "curation-1",
            datasetId: "dataset-1",
            status: "needs_review",
            updatedAt: "2026-08-27T01:00:00.000Z",
            episode: {originalQuestion: "Question", source: {kind: "dsh-session", sessionId: "session-1"}, items: []},
            curator: {modelId: "model-a", effort: "high", threadId: "hidden-curator"},
            conversation: [],
            revisions: [],
            draft: {schemaVersion: "draft/v1"},
        }
        const rubric = {
            id: "rubric-1",
            datasetId: "dataset-1",
            status: "needs_review",
            updatedAt: "2026-08-27T02:00:00.000Z",
            rubricAgent: {modelId: "model-r", effort: "high", threadId: "hidden-rubric"},
            conversation: [],
            revisions: [],
            draft: {schemaVersion: "rubric/v1"},
        }
        const curationManager = {
            hiddenThreadIds: () => new Set(["hidden-curator"]),
            listSessions: ({archived}) => archived ? [] : [curation],
            getSession: () => curation,
            async sendMessage(id, text) { calls.push(["curation.send", id, text]); return curation },
            async retry(id) { calls.push(["curation.retry", id]); return curation },
            updateModel(id, value) { calls.push(["curation.model", id, value]); return curation },
            updateEffort(id, value) { calls.push(["curation.effort", id, value]); return curation },
            async archive(id) { calls.push(["curation.save", id]); return {id: "case-1"} },
            async discard(id) { calls.push(["curation.discard", id]); return {...curation, status: "cancelled"} },
        }
        const rubricManager = {
            hiddenThreadIds: () => new Set(["hidden-rubric"]),
            listSessions: () => [rubric],
            getSession: () => rubric,
            async createSession(input) { calls.push(["rubrics.create", input]); return rubric },
            async sendMessage(id, text) { calls.push(["rubrics.send", id, text]); return rubric },
            async retry(id) { calls.push(["rubrics.retry", id]); return rubric },
            updateModel(id, value) { calls.push(["rubrics.model", id, value]); return rubric },
            updateEffort(id, value) { calls.push(["rubrics.effort", id, value]); return rubric },
            async publish(id) { calls.push(["rubrics.publish", id]); return {id: "rubric-version-1"} },
            async discard(id) { calls.push(["rubrics.discard", id]); return {...rubric, status: "cancelled"} },
        }
        const application = createRollingSkillApplication({dataRoot, curationManager, rubricManager})

        assert.equal((await application.dispatch("curation.list", {})).items[0].id, "curation-1")
        assert.equal((await application.dispatch("curation.get", {sessionId: "curation-1"})).revision, curation.updatedAt)
        assert.deepEqual(await application.dispatch("curation.hidden", {}), ["hidden-curator"])
        await application.dispatch("curation.send", {
            sessionId: "curation-1",
            text: "Revise it",
            expectedRevision: curation.updatedAt,
            idempotencyKey: "curation-send-1",
        })
        await application.dispatch("curation.model", {
            sessionId: "curation-1",
            modelId: "model-b",
            expectedRevision: curation.updatedAt,
            idempotencyKey: "curation-model-1",
        })
        await application.dispatch("curation.save", {
            sessionId: "curation-1",
            expectedRevision: curation.updatedAt,
            idempotencyKey: "curation-save-1",
        })

        assert.equal((await application.dispatch("rubrics.list", {})).sessions[0].id, "rubric-1")
        assert.equal((await application.dispatch("rubrics.get", {sessionId: "rubric-1"})).revision, rubric.updatedAt)
        assert.deepEqual(await application.dispatch("rubrics.hidden", {}), ["hidden-rubric"])
        await application.dispatch("rubrics.send", {
            sessionId: "rubric-1",
            text: "Tighten R1",
            expectedRevision: rubric.updatedAt,
            idempotencyKey: "rubric-send-1",
        })
        await application.dispatch("rubrics.publish", {
            sessionId: "rubric-1",
            expectedRevision: rubric.updatedAt,
            idempotencyKey: "rubric-publish-1",
        })

        assert.deepEqual(calls.map((entry) => entry[0]), [
            "curation.send", "curation.model", "curation.save", "rubrics.send", "rubrics.publish",
        ])
        await assert.rejects(
            () => application.dispatch("curation.send", {
                sessionId: "curation-1",
                text: "Stale",
                expectedRevision: "stale",
                idempotencyKey: "curation-send-stale",
            }),
            /stale.*revision/i,
        )
        await assert.rejects(
            () => application.dispatch("rubrics.send", {
                sessionId: "rubric-1",
                text: "Bad shape",
                expectedRevision: rubric.updatedAt,
                idempotencyKey: "rubric-hostile",
                path: "/forged/SKILL.md",
            }),
            /unsupported.*rubric.*field/i,
        )
        await application.close()
    })

    it("exposes strict trusted conversation curation methods with concurrent idempotency", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-conversation-"))
        const calls = []
        const frozen = {
            episode: {
                schemaVersion: "rolling-skill-episode/v1",
                originalQuestion: "查七月账单",
                source: {
                    kind: "dsh-session",
                    sessionId: "session-1",
                    startSeq: 4,
                    endSeq: 16,
                    endMessageId: "assistant-2",
                    digest: `sha256:${"a".repeat(64)}`,
                },
                items: [{id: "dsh:session-1:4", type: "userMessage", text: "查七月账单"}],
                toolActivity: [],
                capturedAt: "2026-08-27T00:00:00.000Z",
            },
            source: {
                kind: "dsh-session",
                sessionId: "session-1",
                startSeq: 4,
                endSeq: 16,
                endMessageId: "assistant-2",
                digest: `sha256:${"a".repeat(64)}`,
                snapshotPath: "/trusted/dsh-evidence.json",
            },
        }
        const sessions = new Map()
        const curationManager = {
            hiddenThreadIds: () => new Set(),
            async createSessionFromFrozenEpisode(input) {
                calls.push({type: "create", input: structuredClone(input)})
                await new Promise((resolve) => setImmediate(resolve))
                if (!sessions.has(input.idempotencyKey)) {
                    sessions.set(input.idempotencyKey, {
                        id: "curation-1",
                        datasetId: input.datasetId,
                        status: "queued",
                        episode: structuredClone(input.episode),
                    })
                }
                return sessions.get(input.idempotencyKey)
            },
        }
        const conversationEpisodeSource = {
            async inspect(input) {
                calls.push({type: "inspect", input: structuredClone(input)})
                return {sessionId: input.sessionId, startCandidates: [{seq: 4}]}
            },
            async capture(input) {
                calls.push({type: "capture", input: structuredClone(input)})
                return structuredClone(frozen)
            },
        }
        const application = createRollingSkillApplication({
            dataRoot,
            curationManager,
            conversationEpisodeSource,
            conversationCurationOperationResolver: {
                inspectDataset(datasetId) {
                    return {datasetId, name: "Default", ready: true, blockers: []}
                },
                resolve() {
                    return {
                        executionSkillReference: {
                            schemaVersion: "rolling-skill-skill-reference/v1",
                            id: "skill-1",
                            repositoryId: "repository-1",
                            name: "billing",
                            path: "/runtime/skills/billing/SKILL.md",
                            scope: "runtime",
                            description: null,
                            runtimeId: "runtime-1",
                            providerId: "deepseek-harness",
                            confirmedAt: "2026-08-27T00:00:00.000Z",
                        },
                        operationEvidence: {schemaVersion: "rolling-skill-operation-evidence/v1"},
                    }
                },
            },
        })
        const datasetId = (await application.dispatch("datasets.list", {}))[0].id

        assert.deepEqual(
            await application.dispatch("conversationCuration.inspect", {
                sessionId: "session-1",
                endMessageId: "assistant-2",
            }),
            {
                sessionId: "session-1",
                startCandidates: [{seq: 4}],
                datasets: [{datasetId, name: "Default", ready: true, blockers: []}],
            },
        )
        const request = {
            sessionId: "session-1",
            endMessageId: "assistant-2",
            startSeq: 4,
            datasetId,
            label: "good",
            note: "保留证据",
            idempotencyKey: "conversation-create-1",
        }
        const [first, second] = await Promise.all([
            application.dispatch("conversationCuration.create", request),
            application.dispatch("conversationCuration.create", request),
        ])

        assert.equal(first.id, "curation-1")
        assert.equal(second.id, first.id)
        assert.equal(calls.filter((entry) => entry.type === "capture").length, 1)
        assert.equal(calls.filter((entry) => entry.type === "create").length, 1)
        assert.deepEqual(calls.find((entry) => entry.type === "capture").input, {
            sessionId: "session-1",
            endMessageId: "assistant-2",
            startSeq: 4,
        })
        const createInput = calls.find((entry) => entry.type === "create").input
        assert.equal(createInput.caseType, "goodcase")
        assert.equal(createInput.issueDescription, "保留证据")
        assert.deepEqual(createInput.episode, frozen.episode)
        assert.deepEqual(createInput.source, frozen.source)
        assert.equal(createInput.executionSkillReference.path, "/runtime/skills/billing/SKILL.md")
        assert.equal(
            createInput.operationEvidence.schemaVersion,
            "rolling-skill-operation-evidence/v1",
        )
        assert.deepEqual(
            await application.dispatch("conversationCuration.markers", {sessionId: "session-1"}),
            [],
        )

        for (const field of ["episode", "events", "messages", "snapshotPath", "digest", "runtimePath"]) {
            await assert.rejects(
                () => application.dispatch("conversationCuration.create", {
                    ...request,
                    idempotencyKey: `hostile-${field}`,
                    [field]: field === "events" || field === "messages" ? [] : "forged",
                }),
                /unsupported.*conversation.*field/i,
            )
        }
        await assert.rejects(
            () => application.dispatch("conversationCuration.inspect", {
                sessionId: "session-1",
                endMessageId: "assistant-2",
                digest: frozen.source.digest,
            }),
            /unsupported.*conversation.*field/i,
        )
        await assert.rejects(
            () => application.dispatch("conversationCuration.create", {
                ...request,
                idempotencyKey: "hostile-note",
                note: {html: "<b>forged</b>"},
            }),
            /note.*text/i,
        )
        await assert.rejects(
            () => application.dispatch("conversationCuration.markers", {
                sessionId: "session-1",
                snapshotPath: "/forged",
            }),
            /unsupported.*conversation.*field/i,
        )
        await application.close()
    })

    it("reconciles only uniquely proven legacy Dataset paths to managed identity", () => {
        const {reconcileManagedDatasetBindings} = require(modulePath)
        const datasets = [
            {
                id: "unique",
                skillReference: {
                    schemaVersion: "rolling-skill-skill-reference/v1",
                    name: "billing",
                    path: "/installed/billing/SKILL.md",
                    runtimeId: "codex:a",
                    providerId: "codex",
                },
            },
            {
                id: "missing",
                skillReference: {
                    schemaVersion: "rolling-skill-skill-reference/v1",
                    name: "missing",
                    path: "/installed/missing/SKILL.md",
                    runtimeId: "codex:a",
                    providerId: "codex",
                },
            },
        ]
        const migrated = []
        const result = reconcileManagedDatasetBindings({
            store: {
                listDatasets: () => structuredClone(datasets),
                migrateDatasetSkillReference(datasetId, input) {
                    migrated.push({datasetId, input: structuredClone(input)})
                },
            },
            managedSkillStore: {
                getRepository: () => ({id: "repository-1"}),
                getSkill: () => ({
                    id: "skill-1",
                    repositoryId: "repository-1",
                    name: "billing",
                    description: "Managed billing",
                }),
            },
            installationStore: {
                resolveManagedInstallationForLegacyReference(reference) {
                    return reference.name === "billing"
                        ? {
                            repositoryId: "repository-1",
                            skillId: "skill-1",
                            installedAt: "2026-08-26T00:00:00.000Z",
                        }
                        : null
                },
            },
        })

        assert.deepEqual(result, {migrated: 1, skipped: 1})
        assert.equal(migrated.length, 1)
        assert.equal(migrated[0].datasetId, "unique")
        assert.equal(migrated[0].input.managedSkillReference.evidencePrecision, "managed")
        assert.equal(migrated[0].input.managedSkillReference.path, null)
        assert.equal(migrated[0].input.managedSkillReference.id, "skill-1")
    })

    it("owns Case data behind JSON dispatch methods", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-app-"))
        const application = createRollingSkillApplication({dataRoot})

        const before = await application.dispatch("dashboard.get", {})
        assert.equal(before.counts.datasets, 1)
        assert.equal(before.counts.cases, 0)
        assert.equal(before.counts.rawCases, 0)
        assert.equal(before.dataRoot, dataRoot)

        const managed = await importManagedSkill(application)
        const dataset = await application.dispatch("datasets.create", {
            name: "DSH cases",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
        })
        const rawCase = await application.dispatch("rawCases.add", {
            question: "How do I refresh this Case?",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
            note: "Keep the original wording",
        })
        assert.equal(dataset.name, "DSH cases")
        assert.deepEqual(
            {
                evidencePrecision: dataset.skillReference.evidencePrecision,
                repositoryId: dataset.skillReference.repositoryId,
                skillId: dataset.skillReference.id,
                exposesPath: Object.hasOwn(dataset.skillReference, "path"),
                runtimeId: dataset.skillReference.runtimeId,
            },
            {
                evidencePrecision: "managed",
                repositoryId: managed.repository.id,
                skillId: managed.skill.id,
                exposesPath: false,
                runtimeId: null,
            },
        )
        assert.equal(rawCase.question, "How do I refresh this Case?")
        assert.deepEqual(rawCase.skill, {id: managed.skill.id, name: managed.skill.name})
        assert.equal(rawCase.note, "Keep the original wording")
        assert.equal((await application.dispatch("datasets.list", {})).length, 2)
        assert.equal((await application.dispatch("rawCases.list", {})).length, 1)

        const snapshot = await application.dispatch("dashboard.get", {})
        snapshot.counts.datasets = 999
        assert.equal((await application.dispatch("dashboard.get", {})).counts.datasets, 2)
        await application.close()
    })

    it("updates existing Rolling Skill and plugin settings through one facade", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-settings-"))
        const application = createRollingSkillApplication({dataRoot})

        const settings = await application.dispatch("settings.update", {
            rollingSkill: {language: "en", autoCaptureMode: "scheduled"},
            plugin: {locale: "en"},
        })
        assert.equal(settings.rollingSkill.language, "en")
        assert.equal(settings.rollingSkill.autoCaptureProfile.mode, "scheduled")
        assert.equal(settings.plugin.locale, "en")
        await application.close()
    })

    it("persists only stable Runtime identity fields from discovery", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-runtime-settings-"))
        const discovered = {
            runtimeId: "deepseek-harness:test",
            providerId: "deepseek-harness",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
            executablePath: "/usr/local/bin/dsh",
            source: "path",
            transport: "localhost-http-websocket",
            capabilities: ["threads", "turns"],
            label: "DeepSeek Harness 0.1.1-rc.1 · /usr/local/bin/dsh",
        }
        const application = createRollingSkillApplication({
            dataRoot,
            runtimeRegistry: {
                discover: () => ({available: [discovered]}),
                createClient: () => { throw new Error("not used") },
            },
        })

        const settings = await application.dispatch("settings.selectRuntime", {
            runtimeId: discovered.runtimeId,
        })

        assert.deepEqual(settings.plugin.runtime, {
            runtimeId: discovered.runtimeId,
            providerId: discovered.providerId,
            displayName: discovered.displayName,
            version: discovered.version,
            executablePath: discovered.executablePath,
        })
        await application.close()
    })

    it("routes active Runtime notifications to the Rubric manager", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-runtime-events-"))
        const skillRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-runtime-skill-"))
        const skillPath = join(skillRoot, "SKILL.md")
        writeFileSync(skillPath, "---\nname: incident-response-planner\ndescription: Plan incidents\n---\n")
        const client = new EventEmitter()
        client.start = async () => {}
        client.stop = async () => {}
        client.startThread = async () => ({thread: {id: "rubric-thread", modelProvider: "deepseek-harness"}})
        client.startTurn = async () => ({turn: {id: "rubric-turn"}})
        const runtime = {
            runtimeId: "deepseek-harness:test",
            providerId: "deepseek-harness",
            displayName: "DeepSeek Harness",
            version: "0.1.1-rc.1",
            executablePath: "/usr/local/bin/dsh",
        }
        let managedIdentity = null
        const application = createRollingSkillApplication({
            dataRoot,
            runtimeRegistry: {
                discover: () => ({available: [runtime]}),
                createClient: () => client,
            },
            conversationCurationOperationResolver: {
                inspectDataset: () => ({ready: true, blockers: []}),
                resolve: () => { throw new Error("not used") },
                resolveRubric: () => ({
                    executionSkillReference: {
                        schemaVersion: "rolling-skill-skill-reference/v1",
                        id: managedIdentity.skill.id,
                        repositoryId: managedIdentity.repository.id,
                        name: managedIdentity.skill.name,
                        path: skillPath,
                        scope: "runtime",
                        description: null,
                        runtimeId: runtime.runtimeId,
                        providerId: runtime.providerId,
                        confirmedAt: "2026-08-27T00:00:00.000Z",
                    },
                    operationEvidence: {
                        schemaVersion: "rolling-skill-operation-evidence/v1",
                        kind: "rubric",
                        repositoryId: managedIdentity.repository.id,
                        skillId: managedIdentity.skill.id,
                        runtime: {
                            runtimeId: runtime.runtimeId,
                            providerId: runtime.providerId,
                        },
                        installation: {destination: skillRoot},
                    },
                }),
            },
        })
        await application.dispatch("settings.selectRuntime", {runtimeId: runtime.runtimeId})
        const managed = await importManagedSkill(application)
        managedIdentity = managed
        const dataset = await application.dispatch("datasets.create", {
            name: "Runtime notification cases",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
        })
        const datasetId = dataset.id
        const session = await application.dispatch("rubrics.create", {
            datasetId,
            modelId: null,
            effort: null,
            idempotencyKey: "rubric-runtime-notification-1",
        })
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))

        client.emit("notification", {
            method: "turn/completed",
            params: {
                threadId: "rubric-thread",
                turn: {
                    id: "rubric-turn",
                    status: "failed",
                    items: [],
                    error: {message: "synthetic Runtime failure"},
                },
            },
        })
        await new Promise((resolve) => setImmediate(resolve))

        const updated = await application.dispatch("rubrics.get", {sessionId: session.id})
        assert.equal(updated.status, "failed")
        assert.equal(updated.error, "synthetic Runtime failure")
        await application.close()
    })

    it("rejects unknown methods and non-JSON or oversized input", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-guard-"))
        const application = createRollingSkillApplication({dataRoot})

        await assert.rejects(() => application.dispatch("unknown.method", {}), /Unknown Rolling Skill method/u)
        await assert.rejects(
            () => application.dispatch("dashboard.get", {callback() {}}),
            /plain JSON/u,
        )
        await assert.rejects(
            () => application.dispatch("dashboard.get", {text: "x".repeat(1024 * 1024)}),
            /1 MiB/u,
        )
        await application.close()
    })

    it("publishes detached snapshots to subscribers after mutations", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-events-"))
        const application = createRollingSkillApplication({dataRoot})
        const updates = []
        const dispose = application.subscribe((value) => updates.push(value))

        const managed = await importManagedSkill(application)
        await application.dispatch("datasets.create", {
            name: "Observed",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
        })
        assert.equal(updates.at(-1).counts.datasets, 2)
        updates.at(-1).counts.datasets = 0
        assert.equal((await application.snapshot()).counts.datasets, 2)

        dispose()
        await application.close()
    })

    it("rejects unknown or client-supplied Dataset deployment identity", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-dataset-identity-"))
        const application = createRollingSkillApplication({dataRoot})
        const managed = await importManagedSkill(application)

        await assert.rejects(
            () => application.dispatch("datasets.create", {name: "Missing IDs"}),
            /repository.*required|Skill.*required/i,
        )
        await assert.rejects(
            () => application.dispatch("datasets.create", {
                name: "Wrong repository",
                repositoryId: "other-repository",
                skillId: managed.skill.id,
            }),
            /unknown.*repository|repository.*match/i,
        )
        await assert.rejects(
            () => application.dispatch("datasets.create", {
                name: "Injected path",
                repositoryId: managed.repository.id,
                skillId: managed.skill.id,
                path: "/tmp/forged/SKILL.md",
            }),
            /unsupported.*field/i,
        )
        await application.close()
    })

    it("binds and rebinds Datasets only to pathless Managed Skill identities", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-dataset-bind-"))
        const application = createRollingSkillApplication({dataRoot})
        const managed = await importManagedSkill(application)
        const dataset = (await application.dispatch("datasets.list", {}))[0]

        const bound = await application.dispatch("datasets.bindSkill", {
            datasetId: dataset.id,
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
            expectedCreatedAt: dataset.createdAt,
            idempotencyKey: "bind-default-dataset",
        })
        assert.equal(bound.skillReference.evidencePrecision, "managed")
        assert.equal(bound.skillReference.repositoryId, managed.repository.id)
        assert.equal(bound.skillReference.id, managed.skill.id)
        assert.equal(Object.hasOwn(bound.skillReference, "path"), false)
        assert.equal(Object.hasOwn(bound.skillReference, "executablePath"), false)

        await assert.rejects(
            () => application.dispatch("datasets.bindSkill", {
                datasetId: dataset.id,
                repositoryId: managed.repository.id,
                skillId: managed.skill.id,
                expectedCreatedAt: dataset.createdAt,
                idempotencyKey: "bind-with-path",
                path: "/tmp/runtime/skills/billing/SKILL.md",
            }),
            /unsupported.*field/i,
        )
        await application.close()
    })

    it("creates and edits manual Raw Cases with stable Managed Skill identity and no path", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-raw-case-managed-"))
        const application = createRollingSkillApplication({dataRoot})
        const managed = await importManagedSkill(application)

        const created = await application.dispatch("rawCases.add", {
            question: "  preserve these spaces?  ",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
            note: "manual",
        })
        assert.equal(created.question, "  preserve these spaces?  ")
        assert.deepEqual(created.skill, {id: managed.skill.id, name: managed.skill.name})
        assert.equal(Object.hasOwn(created.skill, "path"), false)

        const updated = await application.dispatch("rawCases.updateManaged", {
            id: created.id,
            expectedRevision: created.revision,
            expectedSkillName: created.skill.name,
            question: created.question,
            note: "updated",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
            idempotencyKey: "update-managed-raw-case",
        })
        assert.equal(updated.note, "updated")
        assert.deepEqual(updated.skill, {id: managed.skill.id, name: managed.skill.name})

        await assert.rejects(
            () => application.dispatch("rawCases.add", {
                question: "forged",
                repositoryId: managed.repository.id,
                skillId: managed.skill.id,
                path: "/tmp/forged/SKILL.md",
            }),
            /unsupported.*field/i,
        )
        await application.close()
    })

    it("creates a Draft from a complete automatic Raw Case only after trusted operation resolution", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-raw-case-draft-"))
        const calls = []
        const curationManager = {
            hiddenThreadIds: () => new Set(),
            listSessions: () => [],
            getSession: () => null,
            async createSession(input) {
                calls.push(structuredClone(input))
                return {id: "curation-from-raw", datasetId: input.datasetId, caseType: input.caseType, status: "queued", episode: {source: {}}, conversation: [], revisions: [], updatedAt: "now"}
            },
        }
        const operation = {
            executionSkillReference: {id: "skill-1", repositoryId: "repository-1", name: "billing", path: "/runtime/billing/SKILL.md", runtimeId: "runtime-1", providerId: "codex"},
            operationEvidence: {schemaVersion: "rolling-skill-operation-evidence/v1", kind: "curation"},
        }
        const application = createRollingSkillApplication({
            dataRoot,
            curationManager,
            conversationCurationOperationResolver: {
                inspectDataset: () => ({ready: true}),
                resolve: () => structuredClone(operation),
                resolveRubric: () => structuredClone(operation),
            },
        })
        const managed = await importManagedSkill(application)
        const dataset = await application.dispatch("datasets.create", {
            name: "Automatic",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
        })
        const rawStore = new RawCaseStore(join(dataRoot, "raw-cases", "events.jsonl"))
        const saved = rawStore.addAutomaticCandidate({
            question: "Preserve automatic question verbatim",
            skill: {id: managed.skill.id, name: managed.skill.name},
            note: "complete",
            source: {
                kind: "automatic_capture",
                runtimeId: "runtime-1",
                threadId: "thread-1",
                startTurnId: "turn-1",
                startItemId: "user-1",
                endTurnId: "turn-2",
                endItemId: "assistant-1",
                outcome: "resolved",
                caseType: "goodcase",
                confidence: 0.99,
                inspectedAt: "2026-08-27T00:00:00.000Z",
            },
        })

        const result = await application.dispatch("rawCases.createDraft", {
            id: saved.rawCase.id,
            datasetId: dataset.id,
            idempotencyKey: "raw-case-draft-1",
        })
        assert.equal(result.id, "curation-from-raw")
        assert.equal(calls[0].sourceThreadId, "thread-1")
        assert.equal(calls[0].executionSkillReference.path, "/runtime/billing/SKILL.md")
        assert.equal((await application.dispatch("rawCases.list", {})).length, 0)
        await application.close()
    })

    it("reads frozen automatic Raw Case evidence without publishing a mutation", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const {
            AutomaticCaptureEvidenceStore,
        } = require("../../../desktop/rolling-skill/src/automatic-capture-evidence-store.cjs")
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-raw-evidence-"))
        const episode = {
            schemaVersion: "rolling-skill-episode/v1",
            originalQuestion: "Evidence question",
            source: {
                runtimeId: "codex:/opt/codex",
                threadId: "thread-evidence",
                startTurnId: "turn-1",
                startItemId: "user-1",
                endTurnId: "turn-1",
                endItemId: "agent-1",
            },
            items: [
                {id: "user-1", turnId: "turn-1", type: "userMessage", text: "Evidence question"},
                {id: "tool-1", turnId: "turn-1", type: "dynamicToolCall", tool: "billing", status: "completed", arguments: "{}", result: "100", error: null},
                {id: "agent-1", turnId: "turn-1", type: "agentMessage", text: "Evidence answer"},
            ],
            toolActivity: [],
            capturedAt: "2026-08-28T10:00:00.000Z",
        }
        const evidenceStore = new AutomaticCaptureEvidenceStore(
            join(dataRoot, "raw-cases", "evidence"),
        )
        const reference = evidenceStore.save(episode)
        const rawStore = new RawCaseStore(join(dataRoot, "raw-cases", "events.jsonl"))
        const saved = rawStore.addAutomaticCandidate({
            question: episode.originalQuestion,
            skill: {name: "billing"},
            note: "automatic",
            source: {
                kind: "automatic_capture",
                runtimeId: episode.source.runtimeId,
                threadId: episode.source.threadId,
                startTurnId: episode.source.startTurnId,
                startItemId: episode.source.startItemId,
                endTurnId: episode.source.endTurnId,
                endItemId: episode.source.endItemId,
                outcome: "resolved",
                caseType: "goodcase",
                confidence: 0.98,
                inspectedAt: "2026-08-28T10:01:00.000Z",
                evidence: reference,
            },
        })
        rawStore.close()
        const application = createRollingSkillApplication({dataRoot})
        const publications = []
        const unsubscribe = application.subscribe((value) => publications.push(value))

        const result = await application.dispatch("rawCases.evidence", {id: saved.rawCase.id})

        assert.equal(result.provenance, "snapshot")
        assert.equal(result.episode.originalQuestion, "Evidence question")
        assert.deepEqual(result.episode.items[1], {
            id: "tool-1",
            type: "dynamicToolCall",
            role: null,
            text: "",
            turnId: "turn-1",
            seq: null,
            toolName: "billing",
            status: "completed",
            arguments: "{}",
            result: "100",
            error: null,
            usage: null,
        })
        assert.deepEqual(publications, [])
        unsubscribe()
        await application.close()
    })

    it("reconstructs legacy DSH and non-DSH Raw Case evidence from exact recorded boundaries", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-legacy-evidence-"))
        const descriptor = {
            runtimeId: "codex:/opt/codex",
            providerId: "codex",
            displayName: "Codex",
            version: "1.0.0",
            executablePath: "/opt/codex",
            capabilities: [],
            models: [],
            efforts: [],
        }
        const readRanges = []
        const runtimeReads = []
        const runtimeRegistry = {
            discover: () => ({available: [descriptor], selected: descriptor}),
            createClient() {
                return {
                    async start() {},
                    async stop() {},
                    async readThread(threadId) {
                        runtimeReads.push(threadId)
                        return {thread: {
                            id: threadId,
                            cwd: "/workspace",
                            modelProvider: "openai",
                            turns: [{
                                id: "turn-1",
                                items: [
                                    {id: "before-user", type: "userMessage", content: [{type: "text", text: "Before"}]},
                                    {id: "before-agent", type: "agentMessage", text: "Before answer"},
                                    {id: "user-1", type: "userMessage", content: [{type: "text", text: "Legacy question"}]},
                                    {id: "tool-1", type: "dynamicToolCall", tool: "lookup", status: "completed", arguments: {month: 7}, result: {cost: 100}},
                                    {id: "agent-1", type: "agentMessage", text: "Legacy answer"},
                                    {id: "after-user", type: "userMessage", content: [{type: "text", text: "After"}]},
                                ],
                            }],
                        }}
                    },
                }
            },
        }
        const application = createRollingSkillApplication({
            dataRoot,
            runtimeRegistry,
            conversationEpisodeSource: {
                async readRange(input) {
                    readRanges.push(structuredClone(input))
                    return {
                        schemaVersion: "rolling-skill-episode/v1",
                        originalQuestion: "DSH legacy question",
                        source: {kind: "dsh-session-live", sessionId: input.sessionId, startSeq: input.startSeq, endSeq: input.endSeq},
                        items: [
                            {id: `dsh:${input.sessionId}:${input.startSeq}`, type: "userMessage", text: "DSH legacy question"},
                            {id: `dsh:${input.sessionId}:${input.endSeq}`, type: "agentMessage", text: "DSH legacy answer"},
                        ],
                        toolActivity: [],
                        capturedAt: "2026-08-28T10:00:00.000Z",
                    }
                },
            },
        })
        const rawStore = new RawCaseStore(join(dataRoot, "raw-cases", "events.jsonl"))
        const dsh = rawStore.addAutomaticCandidate({
            question: "DSH legacy question",
            skill: {name: "billing"},
            note: "legacy",
            source: {
                kind: "automatic_capture",
                runtimeId: "deepseek-harness:/opt/dsh",
                threadId: "session-1",
                startTurnId: "dsh:session-1:turn:1",
                startItemId: "dsh:session-1:12",
                endTurnId: "dsh:session-1:turn:1",
                endItemId: "dsh:session-1:20",
                outcome: "resolved",
                caseType: "goodcase",
                confidence: 0.99,
                inspectedAt: "2026-08-28T10:00:00.000Z",
            },
        })
        const codex = rawStore.addAutomaticCandidate({
            question: "Legacy question",
            skill: {name: "billing"},
            note: "legacy",
            source: {
                kind: "automatic_capture",
                runtimeId: descriptor.runtimeId,
                threadId: "thread-legacy",
                startTurnId: "turn-1",
                startItemId: "user-1",
                endTurnId: "turn-1",
                endItemId: "agent-1",
                outcome: "resolved",
                caseType: "goodcase",
                confidence: 0.99,
                inspectedAt: "2026-08-28T10:00:00.000Z",
            },
        })
        rawStore.close()

        const dshEvidence = await application.dispatch("rawCases.evidence", {id: dsh.rawCase.id})
        const codexEvidence = await application.dispatch("rawCases.evidence", {id: codex.rawCase.id})

        assert.equal(dshEvidence.provenance, "source")
        assert.deepEqual(readRanges, [{sessionId: "session-1", startSeq: 12, endSeq: 20}])
        assert.equal(codexEvidence.provenance, "source")
        assert.deepEqual(runtimeReads, ["thread-legacy"])
        assert.deepEqual(codexEvidence.episode.items.map((item) => item.id), [
            "user-1", "tool-1", "agent-1",
        ])
        await application.close()
    })

    it("exposes only brokered background Runtime interactions through strict methods", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-interactions-"))
        const calls = []
        const runtimeInteractionBroker = {
            requestPermission: async () => "decline",
            requestQuestion: async () => ({answers: []}),
            list: (input) => (calls.push(["list", input]), [{
                id: "interaction-1",
                kind: "permission",
                ownerKind: "installation",
                ownerId: "job-1",
                options: [{optionId: "allow_once"}],
            }]),
            resolve: (input) => (calls.push(["resolve", input]), {
                interactionId: input.interactionId,
                status: "resolved",
            }),
            close: () => calls.push(["close"]),
        }
        const application = createRollingSkillApplication({dataRoot, runtimeInteractionBroker})

        const pending = await application.dispatch("interactions.list", {
            ownerKind: "installation",
            ownerId: "job-1",
        })
        assert.equal(pending[0].id, "interaction-1")
        await application.dispatch("interactions.resolve", {
            interactionId: "interaction-1",
            decision: "allow_once",
        })
        assert.deepEqual(calls.slice(0, 2).map(([kind]) => kind), ["list", "resolve"])
        await application.close()
        assert.equal(calls.at(-1)[0], "close")
    })

    it("marks a Raw Case dispatched only after a native DSH Session accepts it", async () => {
        const {createRollingSkillApplication} = require(modulePath)
        const dataRoot = mkdtempSync(join(tmpdir(), "rolling-skill-core-raw-dispatch-"))
        const calls = []
        const application = createRollingSkillApplication({
            dataRoot,
            rawCaseDispatcher: async (input) => {
                calls.push(structuredClone(input))
                return {sessionId: "dsh-session-1", status: "queued"}
            },
        })
        const managed = await importManagedSkill(application)
        const rawCase = await application.dispatch("rawCases.add", {
            question: "Keep this question verbatim",
            note: "manual",
            repositoryId: managed.repository.id,
            skillId: managed.skill.id,
        })

        const result = await application.dispatch("rawCases.dispatch", {
            id: rawCase.id,
            target: "new",
            idempotencyKey: "dispatch-raw-1",
        })
        assert.equal(result.sessionId, "dsh-session-1")
        assert.equal(calls[0].question, "Keep this question verbatim")
        assert.deepEqual(calls[0].skill, {id: managed.skill.id, name: managed.skill.name})
        assert.equal((await application.dispatch("rawCases.list", {})).length, 0)
        await application.close()
    })
})
