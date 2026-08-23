const assert = require("node:assert/strict")
const {mkdtempSync, rmSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {describe, it, mock} = require("node:test")

const {CONTROL_METHODS, encodeCursor} = require("../src/control-plane/contracts.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")
const {createControlPolicy, createResolvedScope} = require("../src/control-plane/policy.cjs")
const {
    decodeSkillVersionCursor,
    encodeSkillVersionCursor,
} = require("../src/managed-skill-version-cursor.cjs")
const {RawCaseStore} = require("../src/raw-case-store.cjs")

function fixture(overrides = {}) {
    const skills = [
        {id: "skill-1", repositoryId: "repository-1", name: "billing", skillRoot: "billing"},
        {id: "skill-2", repositoryId: "repository-1", name: "support", skillRoot: "support"},
    ]
    const rawCases = [
        {id: "raw-3", question: "three", skill: {name: "support"}},
        {id: "raw-2", question: "two", skill: {name: "billing"}},
        {id: "raw-1", question: "one", skill: {name: "billing"}},
    ]
    const datasets = [
        {id: "dataset-1", name: "Billing", skillReference: {name: "billing"}},
        {id: "dataset-2", name: "Support", skillReference: {name: "support"}},
    ]
    const cases = [
        {id: "case-1", datasetId: "dataset-1", question: "case one"},
        {id: "case-2", datasetId: "dataset-2", question: "case two"},
    ]
    const runs = [
        {id: "run-2", datasetId: "dataset-2", status: "completed"},
        {id: "run-1", datasetId: "dataset-1", status: "running"},
    ]
    const runtimes = [
        {runtimeId: "runtime-1", providerId: "codex", executablePath: "/trusted/codex"},
        {runtimeId: "judge-1", providerId: "codebuddy", executablePath: "/trusted/codebuddy"},
    ]
    const rawCaseStore = {
        list: mock.fn(() => structuredClone(rawCases)),
        get: mock.fn((id) => structuredClone(rawCases.find((entry) => entry.id === id) ?? null)),
        addMany: mock.fn((entries) => ({created: structuredClone(entries), duplicates: [], rejected: []})),
        update: mock.fn((id, changes) => ({...structuredClone(rawCases.find((entry) => entry.id === id)), ...structuredClone(changes)})),
    }
    const evaluationStore = {
        listDatasets: mock.fn(() => structuredClone(datasets)),
        getDataset: mock.fn((id) => {
            const dataset = datasets.find((entry) => entry.id === id)
            if (!dataset) throw new Error("Unknown dataset")
            return structuredClone(dataset)
        }),
        listCases: mock.fn((datasetId) => structuredClone(cases.filter((entry) => entry.datasetId === datasetId))),
        listEvaluationRunSummaries: mock.fn((datasetId = null) => structuredClone(runs.filter((entry) => !datasetId || entry.datasetId === datasetId))),
        getEvaluationRun: mock.fn((id) => {
            const run = runs.find((entry) => entry.id === id)
            if (!run) throw new Error("Unknown evaluation run")
            return structuredClone(run)
        }),
    }
    const managedSkillManager = {
        overview: mock.fn(() => ({repositories: [], skills: structuredClone(skills), versions: []})),
        catalog: mock.fn(() => ({repositories: [], skills: structuredClone(skills)})),
        listVersionPage: mock.fn(() => ({versions: [], nextCursor: null})),
        readSkill: mock.fn((id) => ({
            repository: {id: "repository-1", managedPath: "/private/managed"},
            skill: structuredClone(skills.find((entry) => entry.id === id)),
            manifest: "---\nname: billing\n---\n",
            snapshot: {digest: "sha256:test"},
            versions: [],
        })),
    }
    const evaluationRunner = {
        cancel: mock.fn((runId) => ({...runs.find((entry) => entry.id === runId), status: "cancelled"})),
    }
    const dependencies = {
        workspaceRoot: "/trusted/workspace",
        rawCaseStore,
        evaluationStore,
        evaluationRunner,
        managedSkillManager,
        listRuntimes: mock.fn(() => structuredClone(runtimes)),
        listModelsForRuntime: mock.fn((runtimeId) => [{id: `${runtimeId}-model`}]),
        dispatchRawCase: mock.fn(({runtime}) => ({
            threadId: `thread-${runtime.runtimeId}`,
            turnId: null,
        })),
        startEvaluation: mock.fn((input) => ({id: "run-new", ...structuredClone(input), status: "queued"})),
        ...overrides,
    }
    return {dependencies, rawCaseStore, evaluationStore, evaluationRunner, managedSkillManager}
}

function serviceContext(scopeFilter = null) {
    return {
        capabilityId: "capability-1",
        sessionId: "operator-1",
        grant: {
            id: "capability-1",
            sessionId: "operator-1",
            scopes: {
                skillIds: ["skill-1"],
                datasetIds: ["dataset-1"],
                runtimeIds: ["runtime-1", "judge-1"],
                repositoryIds: ["repository-1"],
            },
        },
        scopeFilter,
    }
}

function snapshotContext(resolution, scopeFilter) {
    return {
        ...serviceContext(scopeFilter),
        executionContext: resolution.executionContext,
    }
}

describe("control-plane domain services", () => {
    it("returns exactly one enumerable handler for every control contract", () => {
        const services = createDomainServices(fixture().dependencies)

        assert.deepEqual(Object.keys(services).sort(), [...CONTROL_METHODS].sort())
        assert.equal(typeof services.resolveScope, "function")
        assert.equal(Object.prototype.propertyIsEnumerable.call(services, "resolveScope"), false)
    })

    it("preserves Raw Case question text byte-for-byte and resolves its Skill from inventory", async () => {
        const {dependencies, rawCaseStore} = fixture()
        const services = createDomainServices(dependencies)
        const question = "  exact question\nwith trailing space  "

        await services["raw_cases.enqueue"]({
            cases: [{question, skill: {name: "billing"}, note: "", source: {kind: "operator"}}],
            idempotencyKey: "enqueue-1",
        }, serviceContext())

        assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
        const stored = rawCaseStore.addMany.mock.calls[0].arguments[0][0]
        assert.equal(stored.question, question)
        assert.equal(stored.skill.name, "billing")
    })

    it("rejects every Tool-supplied Skill path before calling the Raw Case store", async () => {
        const {dependencies, rawCaseStore} = fixture()
        const services = createDomainServices(dependencies)

        for (const [index, path] of [
            "/tmp/attacker-skill",
            "billing",
            "",
        ].entries()) {
            await assert.rejects(
                services["raw_cases.enqueue"]({
                    cases: [{
                        question: "question",
                        skill: {name: "billing", path},
                        note: "",
                        source: {kind: "operator"},
                    }],
                    idempotencyKey: `enqueue-unsafe-${index}`,
                }, serviceContext()),
                (error) => error.code === "INVALID_ARGUMENT",
            )
        }
        assert.equal(rawCaseStore.addMany.mock.callCount(), 0)
    })

    it("filters by capability scope before applying the opaque sequence cursor", async () => {
        const services = createDomainServices(fixture().dependencies)

        const first = await services["raw_cases.list"]({
            skillName: null,
            cursor: null,
            limit: 1,
        }, serviceContext({skillIds: ["skill-1"]}))
        const second = await services["raw_cases.list"]({
            skillName: null,
            cursor: first.nextCursor,
            limit: 1,
        }, serviceContext({skillIds: ["skill-1"]}))

        assert.deepEqual(first, {rawCases: [{id: "raw-2", question: "two", skill: {name: "billing"}}], nextCursor: encodeCursor(1)})
        assert.deepEqual(second, {rawCases: [{id: "raw-1", question: "one", skill: {name: "billing"}}], nextCursor: null})
    })

    it("returns no list entries when the policy scope filter is empty", async () => {
        const services = createDomainServices(fixture().dependencies)

        assert.deepEqual(
            await services["datasets.list"]({cursor: null, limit: 100}, serviceContext({datasetIds: []})),
            {datasets: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["skill_repositories.list"](
                {cursor: null, limit: 100},
                serviceContext({repositoryIds: []}),
            ),
            {repositories: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["skills.list"]({cursor: null, limit: 100}, serviceContext({skillIds: []})),
            {repositories: [], skills: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["skill_versions.list"](
                {skillId: null, cursor: null, limit: 100},
                serviceContext({skillIds: []}),
            ),
            {versions: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["runtimes.list"]({}, serviceContext({runtimeIds: []})),
            {runtimes: []},
        )
        assert.deepEqual(
            await services["raw_cases.list"](
                {skillName: null, cursor: null, limit: 100},
                serviceContext({skillIds: []}),
            ),
            {rawCases: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["evaluations.list"](
                {datasetId: null, cursor: null, limit: 100},
                serviceContext({datasetIds: []}),
            ),
            {runs: [], nextCursor: null},
        )
    })

    it("uses one frozen authorized inventory snapshot for every list handler", async () => {
        const runtimeFixture = fixture()
        let runtimeRead = 0
        runtimeFixture.dependencies.listRuntimes = mock.fn(() => [{
            runtimeId: "runtime-1",
            marker: ++runtimeRead === 1 ? "authorized" : "changed",
        }])
        const runtimeServices = createDomainServices(runtimeFixture.dependencies)
        const runtimeResolution = await runtimeServices.resolveScope(
            "runtimes.list",
            {},
            serviceContext().grant,
        )
        const runtimeResult = await runtimeServices["runtimes.list"](
            {},
            snapshotContext(runtimeResolution, {runtimeIds: ["runtime-1"]}),
        )

        const datasetFixture = fixture()
        let datasetRead = 0
        datasetFixture.evaluationStore.listDatasets = mock.fn(() => [{
            id: "dataset-1",
            marker: ++datasetRead === 1 ? "authorized" : "changed",
        }])
        const datasetServices = createDomainServices(datasetFixture.dependencies)
        const datasetResolution = await datasetServices.resolveScope(
            "datasets.list",
            {cursor: null, limit: 100},
            serviceContext().grant,
        )
        const datasetResult = await datasetServices["datasets.list"](
            {cursor: null, limit: 100},
            snapshotContext(datasetResolution, {datasetIds: ["dataset-1"]}),
        )

        const skillFixture = fixture()
        let skillRead = 0
        skillFixture.managedSkillManager.catalog = mock.fn(() => ({
            skills: [{
                id: "skill-1",
                repositoryId: "repository-1",
                name: ++skillRead === 1 ? "authorized" : "changed",
            }],
        }))
        const skillServices = createDomainServices(skillFixture.dependencies)
        const skillResolution = await skillServices.resolveScope(
            "skills.list",
            {cursor: null, limit: 100},
            serviceContext().grant,
        )
        const skillResult = await skillServices["skills.list"](
            {cursor: null, limit: 100},
            snapshotContext(skillResolution, {skillIds: ["skill-1"]}),
        )

        const rawFixture = fixture()
        let rawRead = 0
        rawFixture.rawCaseStore.list = mock.fn(() => [{
            id: "raw-1",
            question: ++rawRead === 1 ? "authorized" : "changed",
            skill: {name: "billing"},
        }])
        const rawServices = createDomainServices(rawFixture.dependencies)
        const rawResolution = await rawServices.resolveScope(
            "raw_cases.list",
            {skillName: null, cursor: null, limit: 100},
            serviceContext().grant,
        )
        const rawResult = await rawServices["raw_cases.list"](
            {skillName: null, cursor: null, limit: 100},
            snapshotContext(rawResolution, {skillIds: ["skill-1"]}),
        )

        const evaluationFixture = fixture()
        let runRead = 0
        evaluationFixture.evaluationStore.listEvaluationRunSummaries = mock.fn(() => [{
            id: "run-1",
            datasetId: "dataset-1",
            status: ++runRead === 1 ? "authorized" : "changed",
        }])
        const evaluationServices = createDomainServices(evaluationFixture.dependencies)
        const evaluationResolution = await evaluationServices.resolveScope(
            "evaluations.list",
            {datasetId: null, cursor: null, limit: 100},
            serviceContext().grant,
        )
        const evaluationResult = await evaluationServices["evaluations.list"](
            {datasetId: null, cursor: null, limit: 100},
            snapshotContext(evaluationResolution, {datasetIds: ["dataset-1"]}),
        )

        assert.equal(runtimeFixture.dependencies.listRuntimes.mock.callCount(), 1)
        assert.equal(runtimeResult.runtimes[0].marker, "authorized")
        assert.equal(datasetFixture.evaluationStore.listDatasets.mock.callCount(), 1)
        assert.equal(datasetResult.datasets[0].marker, "authorized")
        assert.equal(skillFixture.managedSkillManager.catalog.mock.callCount(), 1)
        assert.equal(skillResult.skills[0].name, "authorized")
        assert.equal(rawFixture.rawCaseStore.list.mock.callCount(), 1)
        assert.equal(rawFixture.managedSkillManager.catalog.mock.callCount(), 1)
        assert.equal(rawResult.rawCases[0].question, "authorized")
        assert.equal(evaluationFixture.evaluationStore.listDatasets.mock.callCount(), 1)
        assert.equal(evaluationFixture.evaluationStore.listEvaluationRunSummaries.mock.callCount(), 1)
        assert.equal(evaluationResult.runs[0].status, "authorized")
        for (const resolution of [
            runtimeResolution,
            datasetResolution,
            skillResolution,
            rawResolution,
            evaluationResolution,
        ]) {
            assert.ok(Object.isFrozen(resolution.executionContext))
        }
    })

    it("pages managed Skill summaries with only their related sanitized metadata", async () => {
        const catalog = {
            repositories: [
                {
                    id: "repository-1",
                    displayName: "Billing",
                    managedPath: "/private/billing",
                    defaultBranch: "main",
                    source: {
                        kind: "folder",
                        location: "/private/source/billing",
                        importedAt: "2026-08-20T00:00:00.000Z",
                    },
                    createdAt: "2026-08-20T00:00:00.000Z",
                    updatedAt: "2026-08-21T00:00:00.000Z",
                },
                {id: "repository-2", displayName: "Support", managedPath: "/private/support"},
                {id: "repository-empty", displayName: "Empty", managedPath: "/private/empty"},
                {id: "repository-hidden", displayName: "Hidden", managedPath: "/private/hidden"},
            ],
            skills: [
                {
                    id: "skill-1",
                    repositoryId: "repository-1",
                    name: "billing",
                    description: "Billing cost analysis",
                    skillRoot: "skills/billing",
                    manifestPath: "skills/billing/SKILL.md",
                    status: "invalid",
                    warnings: ["Private: /Users/alice/skills/billing/missing.md"],
                    executableFiles: ["scripts/query.js"],
                    createdAt: "2026-08-20T00:00:00.000Z",
                    updatedAt: "2026-08-21T00:00:00.000Z",
                },
                {id: "skill-2", repositoryId: "repository-2", name: "support"},
                {id: "skill-hidden", repositoryId: "repository-hidden", name: "hidden"},
            ],
        }
        const {dependencies} = fixture({
            managedSkillManager: {
                catalog: mock.fn(() => structuredClone(catalog)),
                readSkill: mock.fn(() => {
                    throw new Error("skills.list must not read Skill detail")
                }),
            },
        })
        const services = createDomainServices(dependencies)
        const grant = {
            ...serviceContext().grant,
            scopes: {
                ...serviceContext().grant.scopes,
                skillIds: ["skill-1", "skill-2"],
                repositoryIds: ["repository-1", "repository-empty"],
            },
        }
        const repositoryResolution = await services.resolveScope(
            "skill_repositories.list",
            {cursor: null, limit: 100},
            grant,
        )
        const repositories = await services["skill_repositories.list"](
            {cursor: null, limit: 100},
            {
                ...serviceContext({repositoryIds: ["repository-1", "repository-empty"]}),
                grant,
                executionContext: repositoryResolution.executionContext,
            },
        )
        const resolution = await services.resolveScope(
            "skills.list",
            {cursor: null, limit: 1},
            grant,
        )
        const result = await services["skills.list"](
            {cursor: null, limit: 1},
            {
                ...serviceContext({skillIds: ["skill-1", "skill-2"]}),
                grant,
                executionContext: resolution.executionContext,
            },
        )

        assert.deepEqual(result, {
            repositories: [{
                id: "repository-1",
                displayName: "Billing",
                defaultBranch: "main",
                source: {
                    kind: "folder",
                    importedAt: "2026-08-20T00:00:00.000Z",
                },
                createdAt: "2026-08-20T00:00:00.000Z",
                updatedAt: "2026-08-21T00:00:00.000Z",
            }],
            skills: [{
                id: "skill-1",
                repositoryId: "repository-1",
                name: "billing",
                description: "Billing cost analysis",
                skillRoot: "skills/billing",
                manifestPath: "skills/billing/SKILL.md",
                status: "invalid",
                warnings: ["Private: [absolute path omitted]"],
                warningCount: 1,
                executableFiles: ["scripts/query.js"],
                createdAt: "2026-08-20T00:00:00.000Z",
                updatedAt: "2026-08-21T00:00:00.000Z",
            }],
            nextCursor: encodeCursor(1),
        })
        assert.deepEqual(repositories.repositories.map((entry) => entry.id), [
            "repository-1",
            "repository-empty",
        ])
        assert.doesNotMatch(JSON.stringify(repositories), /private/u)
        assert.equal(dependencies.managedSkillManager.catalog.mock.callCount(), 2)
        assert.equal(dependencies.managedSkillManager.readSkill.mock.callCount(), 0)
    })

    it("traverses 100,000 managed Skill versions through bounded authorized manager pages", async () => {
        const versions = Array.from({length: 100_000}, (_, index) => ({
            id: `version-${index}`,
            repositoryId: index % 2 === 0 ? "repository-1" : "repository-2",
            skillId: index % 2 === 0 ? "skill-1" : "skill-2",
            skillRoot: index % 2 === 0 ? "billing" : "support",
            commit: String(index).padStart(40, "0"),
            contentDigest: `sha256:${String(index).padStart(64, "0")}`,
            state: "candidate",
            versionLabel: null,
            createdBy: "optimization",
            optimizationRoundId: null,
            createdAt: "2026-08-21T00:00:00.000Z",
            releasedAt: null,
            deprecatedAt: null,
        }))
        const revision = "01234567-89ab-4def-8123-456789abcdef"
        const catalog = mock.fn(() => ({
            repositories: [],
            skills: [
                {id: "skill-1", repositoryId: "repository-1", name: "billing"},
                {id: "skill-2", repositoryId: "repository-2", name: "support"},
            ],
        }))
        let scanned = 0
        const listVersionPage = mock.fn(({skillIds, skillId, cursor, limit}) => {
            const allowed = new Set(skillIds)
            let sequence = cursor === null ? 0 : decodeSkillVersionCursor(cursor).sequence
            const page = []
            while (sequence < versions.length && page.length < limit) {
                const version = versions[sequence]
                sequence += 1
                scanned += 1
                if (
                    allowed.has(version.skillId) &&
                    (skillId === null || version.skillId === skillId)
                ) page.push(structuredClone(version))
            }
            while (sequence < versions.length) {
                const version = versions[sequence]
                scanned += 1
                if (
                    allowed.has(version.skillId) &&
                    (skillId === null || version.skillId === skillId)
                ) break
                sequence += 1
            }
            return {
                versions: page,
                nextCursor: sequence < versions.length
                    ? encodeSkillVersionCursor({revision, sequence})
                    : null,
            }
        })
        const {dependencies} = fixture({
            managedSkillManager: {
                catalog,
                listVersionPage,
            },
        })
        const services = createDomainServices(dependencies)
        const grant = serviceContext().grant
        const collected = []
        let cursor = null
        do {
            const input = {skillId: null, cursor, limit: 100}
            const resolution = await services.resolveScope("skill_versions.list", input, grant)
            assert.deepEqual(Object.keys(resolution.executionContext).sort(), [
                "method",
                "versionPage",
            ])
            assert.ok(resolution.executionContext.versionPage.versions.length <= 100)
            assert.ok(Buffer.byteLength(
                JSON.stringify(resolution.executionContext),
                "utf8",
            ) < 1_048_576)
            const result = await services["skill_versions.list"](
                input,
                snapshotContext(resolution, {skillIds: ["skill-1"]}),
            )
            collected.push(...result.versions.map((version) => version.id))
            cursor = result.nextCursor
        } while (cursor !== null)

        assert.equal(collected.length, 50_000)
        assert.equal(new Set(collected).size, 50_000)
        assert.ok(scanned <= 100_500)
        assert.equal(catalog.mock.callCount(), 500)
        assert.equal(listVersionPage.mock.callCount(), 500)
    })

    it("maps a stale managed Skill version cursor to a public invalid argument", async () => {
        const stale = new Error("Managed Skill version cursor is stale")
        stale.code = "MANAGED_SKILL_VERSION_CURSOR_STALE"
        const {dependencies} = fixture({
            managedSkillManager: {
                catalog: mock.fn(() => ({
                    repositories: [],
                    skills: [{id: "skill-1", repositoryId: "repository-1", name: "billing"}],
                })),
                listVersionPage: mock.fn(() => {
                    throw stale
                }),
            },
        })
        const services = createDomainServices(dependencies)

        await assert.rejects(
            services.resolveScope("skill_versions.list", {
                skillId: null,
                cursor: encodeSkillVersionCursor({
                    revision: "01234567-89ab-4def-8123-456789abcdef",
                    sequence: 10,
                }),
                limit: 100,
            }, serviceContext().grant),
            (error) => error.code === "INVALID_ARGUMENT" &&
                error.details.issues[0].path[0] === "cursor",
        )
    })

    it("resolves opaque Raw Case and evaluation run owners with an exact subject binding", async () => {
        const services = createDomainServices(fixture().dependencies)

        const rawResolution = await services.resolveScope(
            "raw_cases.update",
            {id: "raw-2", changes: {note: "updated"}, idempotencyKey: "update-1"},
            serviceContext().grant,
        )
        assert.deepEqual(rawResolution.scope, {
            method: "raw_cases.update",
            mode: "access",
            subject: {kind: "raw_case", id: "raw-2"},
            skillIds: ["skill-1"],
        })
        assert.ok(Object.isFrozen(rawResolution.executionContext))
        assert.equal(rawResolution.executionContext.rawCase.id, "raw-2")

        const runResolution = await services.resolveScope(
            "evaluations.cancel",
            {runId: "run-1", idempotencyKey: "cancel-1"},
            serviceContext().grant,
        )
        assert.deepEqual(runResolution.scope, {
            method: "evaluations.cancel",
            mode: "access",
            subject: {kind: "evaluation_run", id: "run-1"},
            datasetIds: ["dataset-1"],
        })
        assert.ok(Object.isFrozen(runResolution.executionContext))
        assert.equal(runResolution.executionContext.run.id, "run-1")
        await assert.rejects(
            services.resolveScope(
                "raw_cases.dispatch",
                {id: "missing", mode: "new", runtime: {runtimeId: "runtime-1"}, idempotencyKey: "dispatch-1"},
                serviceContext().grant,
            ),
            (error) => error.code === "NOT_FOUND",
        )
    })

    it("validates Dataset, Case and Runtime IDs then forwards formal evaluation input unchanged", async () => {
        const {dependencies} = fixture()
        const services = createDomainServices(dependencies)
        const input = {
            datasetId: "dataset-1",
            caseIds: ["case-1"],
            selectionMode: "selected",
            activationMode: "explicit",
            runtimeConfigurations: [{runtimeId: "runtime-1", modelId: "model-1", effort: "high"}],
            judgeConfiguration: {runtimeId: "judge-1", modelId: null, effort: null},
            idempotencyKey: "evaluation-1",
        }

        const result = await services["evaluations.start"](input, serviceContext())

        assert.deepEqual(dependencies.startEvaluation.mock.calls[0].arguments[0], input)
        assert.equal(result.run.id, "run-new")
        await assert.rejects(
            services["evaluations.start"]({
                ...input,
                runtimeConfigurations: [{runtimeId: "runtime-missing", modelId: null, effort: null}],
            }, serviceContext()),
            (error) => error.code === "NOT_FOUND",
        )
        assert.equal(dependencies.startEvaluation.mock.callCount(), 1)
    })

    it("resolves direct Runtime, Dataset, and Skill IDs into frozen execution contexts", async () => {
        const services = createDomainServices(fixture().dependencies)

        const runtime = await services.resolveScope(
            "runtimes.models",
            {runtimeId: "runtime-1"},
            serviceContext().grant,
        )
        const dataset = await services.resolveScope(
            "datasets.get",
            {datasetId: "dataset-1", includeCases: true},
            serviceContext().grant,
        )
        const skill = await services.resolveScope(
            "skills.get",
            {skillId: "skill-1"},
            serviceContext().grant,
        )

        assert.equal(runtime.executionContext.runtime.runtimeId, "runtime-1")
        assert.equal(dataset.executionContext.dataset.id, "dataset-1")
        assert.deepEqual(dataset.executionContext.cases.map((entry) => entry.id), ["case-1"])
        assert.equal(skill.executionContext.skill.id, "skill-1")
        assert.equal(skill.executionContext.detail.repository.managedPath, undefined)
        for (const resolution of [runtime, dataset, skill]) {
            assert.equal(resolution.scope, null)
            assert.ok(Object.isFrozen(resolution.executionContext))
        }
    })

    it("sanitizes absolute Skill warning paths while preserving manifest and snapshot detail", async () => {
        const manifest = "---\nname: billing\n---\nRead references/query.md\n"
        const snapshot = {
            digest: "sha256:test",
            files: [{path: "references/query.md", type: "file", executable: false, size: 12}],
        }
        const {dependencies} = fixture({
            managedSkillManager: {
                overview: mock.fn(() => ({
                    repositories: [],
                    skills: [{id: "skill-1", repositoryId: "repository-1", name: "billing"}],
                    versions: [],
                })),
                readSkill: mock.fn((_skillId, options) => {
                    assert.deepEqual(options, {includeVersions: false})
                    return {
                        repository: {
                            id: "repository-1",
                            managedPath: "/Users/alice/private/repo",
                        },
                        skill: {
                            id: "skill-1",
                            repositoryId: "repository-1",
                            name: "billing",
                            warnings: [
                                "Skill reference does not exist: references/missing.md",
                                "Skill reference must be relative: /Users/alice/private/secret.md",
                                "Could not read C:\\Users\\alice\\private\\secret.md",
                            ],
                        },
                        manifest,
                        snapshot,
                    }
                }),
            },
        })
        const services = createDomainServices(dependencies)
        const result = await services["skills.get"](
            {skillId: "skill-1"},
            serviceContext(),
        )

        assert.equal(result.skill.repository.managedPath, undefined)
        assert.equal(result.skill.skill.warnings[0], "Skill reference does not exist: references/missing.md")
        assert.match(result.skill.skill.warnings[1], /absolute path omitted/iu)
        assert.match(result.skill.skill.warnings[2], /absolute path omitted/iu)
        assert.doesNotMatch(JSON.stringify(result), /Users[\\/]alice|private[\\/]secret/iu)
        assert.equal(result.skill.manifest, manifest)
        assert.deepEqual(result.skill.snapshot, snapshot)
        assert.equal(Object.hasOwn(result.skill, "versions"), false)
        assert.deepEqual(
            dependencies.managedSkillManager.readSkill.mock.calls[0].arguments,
            ["skill-1", {includeVersions: false}],
        )
    })

    it("projects every public Raw Case Skill reference without legacy paths", async () => {
        const legacyRawCase = {
            id: "raw-legacy-path",
            question: "legacy path",
            skill: {
                id: "skill-1",
                name: "billing",
                path: "/Users/alice/private/billing/SKILL.md",
            },
            revision: 1,
        }
        const rawCaseStore = {
            list: mock.fn(() => [structuredClone(legacyRawCase)]),
            get: mock.fn(() => structuredClone(legacyRawCase)),
            addMany: mock.fn((entries) => ({
                created: entries.map((entry) => ({
                    ...structuredClone(entry),
                    id: "raw-created",
                    skill: {...entry.skill, path: "/Users/alice/private/created/SKILL.md"},
                })),
                duplicates: [{
                    index: 1,
                    duplicateOf: "raw-legacy-path",
                    rawCase: structuredClone(legacyRawCase),
                }],
                rejected: [{
                    index: 2,
                    input: {skill: structuredClone(legacyRawCase.skill)},
                    error: "rejected",
                }],
            })),
            updateIfCurrent: mock.fn(() => structuredClone(legacyRawCase)),
        }
        const {dependencies} = fixture({rawCaseStore})
        const services = createDomainServices(dependencies)

        const listed = await services["raw_cases.list"](
            {skillName: null, cursor: null, limit: 100},
            serviceContext({skillIds: ["skill-1"]}),
        )
        const enqueued = await services["raw_cases.enqueue"]({
            cases: [{
                question: "new",
                skill: {id: "skill-1", name: "billing"},
                note: "",
                source: {kind: "operator"},
            }],
            idempotencyKey: "enqueue-public-projection",
        }, serviceContext())
        const updated = await services["raw_cases.update"]({
            id: "raw-legacy-path",
            changes: {note: "updated"},
            idempotencyKey: "update-public-projection",
        }, serviceContext())

        for (const result of [listed, enqueued, updated]) {
            assert.doesNotMatch(JSON.stringify(result), /\/Users\/alice\/private/u)
        }
        assert.deepEqual(listed.rawCases[0].skill, {id: "skill-1", name: "billing"})
        assert.deepEqual(enqueued.created[0].skill, {id: "skill-1", name: "billing"})
        assert.deepEqual(enqueued.duplicates[0].rawCase.skill, {id: "skill-1", name: "billing"})
        assert.deepEqual(enqueued.rejected[0].input.skill, {id: "skill-1", name: "billing"})
        assert.deepEqual(updated.rawCase.skill, {id: "skill-1", name: "billing"})
    })

    it("dispatches only with the trusted discovered runtime descriptor", async () => {
        const {dependencies} = fixture()
        const services = createDomainServices(dependencies)

        const result = await services["raw_cases.dispatch"]({
            id: "raw-2",
            mode: "new",
            runtime: {runtimeId: "runtime-1", modelId: "model-1", effort: "high"},
            idempotencyKey: "dispatch-1",
        }, serviceContext())

        const request = dependencies.dispatchRawCase.mock.calls[0].arguments[0]
        assert.equal(request.rawCase.id, "raw-2")
        assert.equal(request.runtime.runtimeId, "runtime-1")
        assert.equal(request.runtime.executablePath, "/trusted/codex")
        assert.equal(request.runtime.modelId, "model-1")
        assert.deepEqual(result, {threadId: "thread-runtime-1", turnId: null})
    })

    it("uses the resolved Raw Case revision and owner for compare-and-set updates", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-cas-"))
        const store = new RawCaseStore(join(directory, "raw-cases.jsonl"))
        try {
            const created = store.add({
                question: "original",
                skill: {name: "owner-a"},
                note: "",
                source: {kind: "operator"},
            })
            const skills = ["a", "b", "c"].map((suffix) => ({
                id: `skill-${suffix}`,
                name: `owner-${suffix}`,
                repositoryId: `repository-${suffix}`,
            }))
            const {dependencies} = fixture({
                rawCaseStore: store,
                managedSkillManager: {
                    overview: mock.fn(() => ({skills: structuredClone(skills)})),
                },
            })
            const services = createDomainServices(dependencies)
            const firstGrant = {
                ...serviceContext().grant,
                scopes: {...serviceContext().grant.scopes, skillIds: ["skill-a", "skill-b"]},
            }
            const secondGrant = {
                ...serviceContext().grant,
                scopes: {...serviceContext().grant.scopes, skillIds: ["skill-a", "skill-c"]},
            }
            const firstInput = {
                id: created.id,
                changes: {skill: {name: "owner-b"}},
                idempotencyKey: "update-b",
            }
            const secondInput = {
                id: created.id,
                changes: {skill: {name: "owner-c"}},
                idempotencyKey: "update-c",
            }
            const firstResolution = await services.resolveScope(
                "raw_cases.update",
                firstInput,
                firstGrant,
            )
            const secondResolution = await services.resolveScope(
                "raw_cases.update",
                secondInput,
                secondGrant,
            )

            const first = await services["raw_cases.update"](firstInput, {
                ...serviceContext(),
                grant: firstGrant,
                executionContext: firstResolution.executionContext,
            })
            await assert.rejects(services["raw_cases.update"](secondInput, {
                ...serviceContext(),
                grant: secondGrant,
                executionContext: secondResolution.executionContext,
            }), (error) => error.code === "CONTROL_BUSY")

            assert.equal(first.rawCase.revision, 2)
            assert.equal(first.rawCase.skill.name, "owner-b")
            assert.equal(store.get(created.id).revision, 2)
            assert.equal(store.get(created.id).skill.name, "owner-b")
        } finally {
            store.close()
            rmSync(directory, {recursive: true, force: true})
        }
    })

    it("normalizes legacy Skill names and disambiguates writes inside the capability scope", async () => {
        const legacy = fixture({
            rawCaseStore: {
                list: mock.fn(() => [{
                    id: "raw-legacy",
                    question: "legacy",
                    skill: {name: "  BILLING  "},
                }]),
            },
            managedSkillManager: {
                overview: mock.fn(() => ({
                    skills: [{id: "skill-1", name: "billing", repositoryId: "repository-1"}],
                })),
            },
        })
        const legacyServices = createDomainServices(legacy.dependencies)
        const legacyResolution = await legacyServices.resolveScope(
            "raw_cases.list",
            {skillName: null, cursor: null, limit: 100},
            serviceContext().grant,
        )
        const legacyResult = await legacyServices["raw_cases.list"](
            {skillName: null, cursor: null, limit: 100},
            snapshotContext(legacyResolution, {skillIds: ["skill-1"]}),
        )

        assert.deepEqual(legacyResult.rawCases.map((entry) => entry.id), ["raw-legacy"])

        const addMany = mock.fn((cases) => ({created: structuredClone(cases), duplicates: [], rejected: []}))
        const duplicateSkills = [
            {id: "skill-1", name: "Billing", repositoryId: "repository-1"},
            {id: "skill-2", name: "billing", repositoryId: "repository-2"},
        ]
        const duplicate = fixture({
            rawCaseStore: {addMany},
            managedSkillManager: {
                overview: mock.fn(() => ({skills: structuredClone(duplicateSkills)})),
            },
        })
        const duplicateServices = createDomainServices(duplicate.dependencies)
        const input = {
            cases: [{
                question: "scoped owner",
                skill: {name: "  BILLING  "},
                note: "",
                source: {kind: "operator"},
            }],
            idempotencyKey: "enqueue-scoped",
        }
        const oneOwnerGrant = {
            ...serviceContext().grant,
            scopes: {...serviceContext().grant.scopes, skillIds: ["skill-2"]},
        }
        const resolution = await duplicateServices.resolveScope(
            "raw_cases.enqueue",
            input,
            oneOwnerGrant,
        )
        await duplicateServices["raw_cases.enqueue"](input, {
            ...serviceContext(),
            grant: oneOwnerGrant,
            executionContext: resolution.executionContext,
        })

        assert.deepEqual(resolution.scope.skillIds, ["skill-2"])
        assert.equal(addMany.mock.calls[0].arguments[0][0].skill.name, "billing")

        const ambiguousGrant = {
            ...serviceContext().grant,
            scopes: {...serviceContext().grant.scopes, skillIds: ["skill-1", "skill-2"]},
        }
        await assert.rejects(duplicateServices.resolveScope(
            "raw_cases.enqueue",
            {...input, idempotencyKey: "enqueue-ambiguous"},
            ambiguousGrant,
        ), (error) => error.code === "INVALID_ARGUMENT")
    })

    it("allows an explicit stable-id rebind of an ambiguous legacy Raw Case only with all owner scopes", async () => {
        const legacyRawCase = {
            id: "raw-legacy-ambiguous",
            question: "legacy owner",
            skill: {name: "billing", path: "/Users/alice/legacy/SKILL.md"},
            revision: 1,
        }
        const updateIfCurrent = mock.fn((_id, _expected, changes) => ({
            ...structuredClone(legacyRawCase),
            ...structuredClone(changes),
            revision: 2,
        }))
        const {dependencies} = fixture({
            rawCaseStore: {
                list: mock.fn(() => [structuredClone(legacyRawCase)]),
                get: mock.fn(() => structuredClone(legacyRawCase)),
                updateIfCurrent,
            },
            listRawCaseSkills: mock.fn(() => [
                {id: "skill-1", name: "Billing", providerId: "codex"},
                {id: "skill-2", name: "billing", providerId: "codebuddy"},
            ]),
        })
        const services = createDomainServices(dependencies)
        const input = {
            id: legacyRawCase.id,
            changes: {skill: {id: "skill-2", name: "billing"}},
            idempotencyKey: "rebind-legacy-owner",
        }
        const fullGrant = {
            ...serviceContext().grant,
            scopes: {...serviceContext().grant.scopes, skillIds: ["skill-1", "skill-2"]},
        }
        const fullResolution = await services.resolveScope("raw_cases.update", input, fullGrant)
        const updated = await services["raw_cases.update"](input, {
            ...serviceContext(),
            grant: fullGrant,
            executionContext: fullResolution.executionContext,
        })

        assert.deepEqual(fullResolution.scope.skillIds, ["skill-1", "skill-2"])
        assert.deepEqual(updateIfCurrent.mock.calls[0].arguments[2].skill, {
            id: "skill-2",
            name: "billing",
        })
        assert.deepEqual(updated.rawCase.skill, {id: "skill-2", name: "billing"})

        const partialGrant = {
            ...fullGrant,
            scopes: {...fullGrant.scopes, skillIds: ["skill-2"]},
        }
        const partialResolution = await services.resolveScope(
            "raw_cases.update",
            {...input, idempotencyKey: "rebind-partial-owner"},
            partialGrant,
        )
        assert.deepEqual(partialResolution.scope.skillIds, ["skill-1", "skill-2"])
        const partialDecision = createControlPolicy().decide({
            grant: {...partialGrant, actions: ["raw_cases.write"]},
            method: "raw_cases.update",
            action: "raw_cases.write",
            input,
            resolvedScope: createResolvedScope(partialResolution.scope),
        })
        assert.equal(partialDecision.decision, "deny")
        assert.equal(partialDecision.code, "OBJECT_OUT_OF_SCOPE")

        const dispatchInput = {
            id: legacyRawCase.id,
            mode: "new",
            runtime: {runtimeId: "runtime-1", modelId: null, effort: null},
            idempotencyKey: "dispatch-ambiguous-owner",
        }
        const noOwnerGrant = {
            ...fullGrant,
            scopes: {...fullGrant.scopes, skillIds: []},
        }
        for (const grant of [fullGrant, partialGrant, noOwnerGrant, null]) {
            await assert.rejects(
                services.resolveScope("raw_cases.dispatch", dispatchInput, grant),
                (error) => error.code === "INVALID_ARGUMENT" &&
                    error.details.issues[0].path.at(-1) === "name",
            )
        }

        for (const changes of [
            {note: "not a rebind"},
            {skill: {name: "billing"}},
        ]) {
            await assert.rejects(
                services.resolveScope("raw_cases.update", {
                    id: legacyRawCase.id,
                    changes,
                    idempotencyKey: "ambiguous-non-rebind",
                }, fullGrant),
                (error) => error.code === "INVALID_ARGUMENT" &&
                    error.details.issues[0].path.at(-1) === "name",
            )
        }
    })

    it("uses a trusted unified Raw Case Skill inventory without exposing it through managed Skill reads", async () => {
        const addMany = mock.fn((cases) => ({created: structuredClone(cases), duplicates: [], rejected: []}))
        const listRawCaseSkills = mock.fn(() => ({skills: [
            {id: "runtime-skill-1", name: "shared", providerId: "codex"},
            {id: "runtime-skill-2", name: "shared", providerId: "codebuddy"},
        ]}))
        const {dependencies} = fixture({
            rawCaseStore: {
                list: mock.fn(() => [{
                    id: "raw-runtime",
                    question: "runtime Skill",
                    skill: {id: "runtime-skill-2", name: "shared"},
                }]),
                addMany,
            },
            listRawCaseSkills,
        })
        const services = createDomainServices(dependencies)
        const grant = {
            ...serviceContext().grant,
            scopes: {
                ...serviceContext().grant.scopes,
                skillIds: ["runtime-skill-1", "runtime-skill-2", "skill-1"],
            },
        }
        const exactInput = {
            cases: [{
                question: "use the second runtime Skill",
                skill: {id: "runtime-skill-2", name: "shared"},
                note: "",
                source: {kind: "operator"},
            }],
            idempotencyKey: "enqueue-runtime-skill",
        }
        const exactResolution = await services.resolveScope(
            "raw_cases.enqueue",
            exactInput,
            grant,
        )
        const exactResult = await services["raw_cases.enqueue"](exactInput, {
            ...serviceContext(),
            grant,
            executionContext: exactResolution.executionContext,
        })

        assert.deepEqual(exactResolution.scope.skillIds, ["runtime-skill-2"])
        assert.deepEqual(exactResult.created[0].skill, {id: "runtime-skill-2", name: "shared"})
        assert.deepEqual(addMany.mock.calls[0].arguments[0][0].skill, {
            id: "runtime-skill-2",
            name: "shared",
        })

        await assert.rejects(services.resolveScope(
            "raw_cases.enqueue",
            {
                ...exactInput,
                cases: [{...exactInput.cases[0], skill: {name: "shared"}}],
                idempotencyKey: "enqueue-ambiguous-runtime-skill",
            },
            grant,
        ), (error) => error.code === "INVALID_ARGUMENT")

        const listResolution = await services.resolveScope(
            "raw_cases.list",
            {skillName: null, cursor: null, limit: 100},
            grant,
        )
        const listed = await services["raw_cases.list"](
            {skillName: null, cursor: null, limit: 100},
            {
                ...serviceContext({skillIds: ["runtime-skill-2"]}),
                grant,
                executionContext: listResolution.executionContext,
            },
        )
        assert.deepEqual(listed.rawCases.map((entry) => entry.id), ["raw-runtime"])

        const managedResolution = await services.resolveScope(
            "skills.list",
            {cursor: null, limit: 100},
            grant,
        )
        const managed = await services["skills.list"](
            {cursor: null, limit: 100},
            {
                ...serviceContext({skillIds: ["runtime-skill-2", "skill-1"]}),
                grant,
                executionContext: managedResolution.executionContext,
            },
        )
        assert.deepEqual(managed.skills.map((entry) => entry.id), ["skill-1"])
        await assert.rejects(
            services.resolveScope("skills.get", {skillId: "runtime-skill-2"}, grant),
            (error) => error.code === "NOT_FOUND",
        )
        assert.equal(listRawCaseSkills.mock.callCount(), 3)
        assert.ok(dependencies.managedSkillManager.catalog.mock.callCount() >= 2)
    })

    it("persists the resolved Skill ID and filters same-name records by that stable owner", async () => {
        const directory = mkdtempSync(join(tmpdir(), "rolling-skill-control-owner-"))
        const store = new RawCaseStore(join(directory, "raw-cases.jsonl"))
        try {
            const skills = [
                {
                    id: "skill-1",
                    name: "Billing",
                    path: "/trusted/repository-1/billing",
                    repositoryId: "repository-1",
                },
                {
                    id: "skill-2",
                    name: "billing",
                    path: "/trusted/repository-2/billing",
                    repositoryId: "repository-2",
                },
            ]
            const {dependencies} = fixture({
                rawCaseStore: store,
                managedSkillManager: {
                    overview: mock.fn(() => ({skills: structuredClone(skills)})),
                },
            })
            const services = createDomainServices(dependencies)
            const ownerGrant = {
                ...serviceContext().grant,
                scopes: {...serviceContext().grant.scopes, skillIds: ["skill-2"]},
            }
            const otherGrant = {
                ...serviceContext().grant,
                scopes: {...serviceContext().grant.scopes, skillIds: ["skill-1"]},
            }
            const enqueueInput = {
                cases: [{
                    question: "stable owner",
                    skill: {name: " BILLING "},
                    note: "",
                    source: {kind: "operator"},
                }],
                idempotencyKey: "enqueue-stable-owner",
            }
            const enqueueResolution = await services.resolveScope(
                "raw_cases.enqueue",
                enqueueInput,
                ownerGrant,
            )
            const enqueued = await services["raw_cases.enqueue"](enqueueInput, {
                ...serviceContext(),
                grant: ownerGrant,
                executionContext: enqueueResolution.executionContext,
            })

            assert.deepEqual(enqueued.created[0].skill, {id: "skill-2", name: "billing"})
            assert.deepEqual(store.get(enqueued.created[0].id).skill, {
                id: "skill-2",
                name: "billing",
            })

            const ownerResolution = await services.resolveScope(
                "raw_cases.list",
                {skillName: null, cursor: null, limit: 100},
                ownerGrant,
            )
            const visible = await services["raw_cases.list"](
                {skillName: null, cursor: null, limit: 100},
                snapshotContext(ownerResolution, {skillIds: ["skill-2"]}),
            )
            const otherResolution = await services.resolveScope(
                "raw_cases.list",
                {skillName: null, cursor: null, limit: 100},
                otherGrant,
            )
            const hidden = await services["raw_cases.list"](
                {skillName: null, cursor: null, limit: 100},
                snapshotContext(otherResolution, {skillIds: ["skill-1"]}),
            )

            assert.deepEqual(visible.rawCases.map((entry) => entry.id), [enqueued.created[0].id])
            assert.deepEqual(hidden.rawCases, [])
        } finally {
            store.close()
            rmSync(directory, {recursive: true, force: true})
        }
    })
})
