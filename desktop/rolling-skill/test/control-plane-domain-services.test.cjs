const assert = require("node:assert/strict")
const {describe, it, mock} = require("node:test")

const {CONTROL_METHODS, encodeCursor} = require("../src/control-plane/contracts.cjs")
const {createDomainServices} = require("../src/control-plane/domain-services.cjs")

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
            },
        },
        scopeFilter,
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
            await services["skills.list"]({cursor: null, limit: 100}, serviceContext({skillIds: []})),
            {skills: [], nextCursor: null},
        )
        assert.deepEqual(
            await services["runtimes.list"]({}, serviceContext({runtimeIds: []})),
            {runtimes: []},
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
})
