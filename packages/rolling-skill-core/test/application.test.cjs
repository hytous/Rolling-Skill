const assert = require("node:assert/strict")
const {mkdtempSync, mkdirSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it} = require("node:test")

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
        })
        const datasetId = (await application.dispatch("datasets.list", {}))[0].id

        assert.deepEqual(
            await application.dispatch("conversationCuration.inspect", {
                sessionId: "session-1",
                endMessageId: "assistant-2",
            }),
            {sessionId: "session-1", startCandidates: [{seq: 4}]},
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
            skill: {name: "rolling-skill"},
            source: {kind: "manual"},
        })
        assert.equal(dataset.name, "DSH cases")
        assert.deepEqual(
            {
                evidencePrecision: dataset.skillReference.evidencePrecision,
                repositoryId: dataset.skillReference.repositoryId,
                skillId: dataset.skillReference.id,
                path: dataset.skillReference.path,
                runtimeId: dataset.skillReference.runtimeId,
            },
            {
                evidencePrecision: "managed",
                repositoryId: managed.repository.id,
                skillId: managed.skill.id,
                path: null,
                runtimeId: null,
            },
        )
        assert.equal(rawCase.question, "How do I refresh this Case?")
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
})
