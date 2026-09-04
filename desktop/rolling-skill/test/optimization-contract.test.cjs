const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {mkdtempSync, rmSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    OPTIMIZATION_DECISION_SCHEMA,
    freezeOptimizationRun,
    parseOptimizationConfig,
    parseOptimizationDecision,
    validateFrozenOptimizationRun,
} = require("../src/optimization/optimization-contract.cjs")
const {snapshotSkillEvidence} = require("../src/evaluation-skill-evidence.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function digest(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function skillEvidence() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-optimization-evidence-"))
    temporaryDirectories.push(directory)
    const path = join(directory, "SKILL.md")
    writeFileSync(path, "# Billing\n\nUse the billing workflow.\n")
    return snapshotSkillEvidence({name: "billing-cost-management", path})
}

function config(overrides = {}) {
    return {
        skillId: "skill-1",
        baselineVersionId: "version-1",
        datasetId: "dataset-1",
        operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
        targets: [
            {runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"},
            {runtimeId: "codebuddy:target", modelId: "claude-sonnet"},
        ],
        judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "xhigh"},
        activationMode: "automatic",
        mode: "adaptive",
        limits: {
            maxEpochs: 8,
            maxDurationMs: 3_600_000,
            patience: 2,
            minimumImprovement: 0.5,
            maxTurns: 120,
            maxTokens: 2_000_000,
            maxCostMicros: 50_000_000,
        },
        target: {
            minimumScore: 90,
            minimumPassRate: 0.95,
            requireCriticalCases: true,
        },
        telemetry: {tokens: true, cost: true},
        ...overrides,
    }
}

function compactConfig(overrides = {}) {
    return {
        skillId: "skill-1",
        baselineVersionId: "version-1",
        datasetId: "dataset-1",
        operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
        targets: [
            {runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"},
            {runtimeId: "codebuddy:target", modelId: "claude-sonnet"},
        ],
        judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "xhigh"},
        activationMode: "automatic",
        limits: {maxEpochs: 5},
        ...overrides,
    }
}

function freezeInput(overrides = {}) {
    return {
        baseline: {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            state: "released",
            commit: "a".repeat(40),
            skillName: "billing-cost-management",
            skillRoot: "skills/billing-cost-management",
            contentDigest: digest("baseline content"),
        },
        dataset: {
            id: "dataset-1",
            revision: 7,
            caseRevisions: [{
                caseId: "case-1",
                revision: 3,
                rubricVersionId: "rubric-1",
                calibrationStatus: "current",
            }],
            digest: digest("dataset revision 7"),
            skillId: "skill-1",
            repositoryId: "repository-1",
        },
        rubric: {
            id: "rubric-1",
            version: 4,
            scoringModel: "unified-100/v1",
            digest: digest("rubric version 4"),
            datasetId: "dataset-1",
            publishedAt: "2026-08-25T01:02:03.000Z",
        },
        skillEvidence: skillEvidence(),
        config: config(),
        createdAt: "2026-08-25T02:03:04.000Z",
        ...overrides,
    }
}

describe("optimization contract", () => {
    it("accepts a compact Epoch-only configuration without an Agent-operation ceiling", () => {
        const parsed = parseOptimizationConfig(compactConfig())

        assert.equal(parsed.schemaVersion, "rolling-skill-optimization-config/v2")
        assert.deepEqual(parsed.limits, {maxEpochs: 5})
        assert.equal(Object.hasOwn(parsed, "mode"), false)
        assert.equal(Object.hasOwn(parsed, "target"), false)
        assert.equal(Object.hasOwn(parsed, "telemetry"), false)
        assert.equal(Object.isFrozen(parsed.limits), true)
        assert.equal(parseOptimizationConfig(compactConfig({
            limits: {maxEpochs: 101},
        })).limits.maxEpochs, 101)
    })

    it("rejects invalid or mixed compact Epoch-only configurations", () => {
        for (const limits of [
            {maxEpochs: 0},
            {maxEpochs: 1.5},
            {maxEpochs: Number.MAX_SAFE_INTEGER + 1},
            {maxEpochs: 5, maxDurationMs: 60_000},
            {maxEpochs: 5, patience: 2},
        ]) assert.throws(() => parseOptimizationConfig(compactConfig({limits})), /limit|epoch|unsupported/i)

        for (const field of ["mode", "target", "telemetry"]) {
            assert.throws(() => parseOptimizationConfig(compactConfig({
                [field]: field === "mode" ? "adaptive" : {},
            })), /unsupported|unknown|config/i)
        }
    })

    it("freezes compact runs as v2 while continuing to validate frozen v1 runs", () => {
        const compact = freezeOptimizationRun(freezeInput({config: compactConfig()}))
        assert.equal(compact.schemaVersion, "rolling-skill-frozen-optimization-run/v2")
        assert.deepEqual(compact.limits, {maxEpochs: 5})
        assert.equal(Object.hasOwn(compact, "mode"), false)
        assert.equal(Object.hasOwn(compact, "target"), false)
        assert.deepEqual(validateFrozenOptimizationRun(compact), compact)

        const legacy = freezeOptimizationRun(freezeInput())
        assert.equal(legacy.schemaVersion, "rolling-skill-frozen-optimization-run/v1")
        assert.equal(validateFrozenOptimizationRun(legacy).mode, "adaptive")

        const unnamedInput = freezeInput({config: compactConfig()})
        delete unnamedInput.baseline.skillName
        const unnamed = freezeOptimizationRun(unnamedInput)
        assert.equal(Object.hasOwn(unnamed.baseline, "skillName"), false)
        assert.deepEqual(validateFrozenOptimizationRun(unnamed), unnamed)
    })

    it("parses fixed and adaptive configurations into deeply immutable local selections", () => {
        const adaptive = parseOptimizationConfig(config())
        const fixed = parseOptimizationConfig(config({mode: "fixed"}))

        assert.equal(adaptive.mode, "adaptive")
        assert.equal(fixed.mode, "fixed")
        assert.equal(adaptive.targets[1].effort, null)
        assert.equal(Object.isFrozen(adaptive), true)
        assert.equal(Object.isFrozen(adaptive.limits), true)
        assert.equal(Object.isFrozen(adaptive.targets[0]), true)
        assert.throws(() => adaptive.targets.push({}), TypeError)
    })

    it("rejects duplicate targets, unsupported modes, renderer paths, and credential tokens", () => {
        const duplicate = config()
        duplicate.targets[1].runtimeId = duplicate.targets[0].runtimeId
        assert.throws(() => parseOptimizationConfig(duplicate), /duplicate|unique/i)
        assert.throws(() => parseOptimizationConfig(config({mode: "random"})), /mode/i)
        assert.throws(() => parseOptimizationConfig(config({
            operator: {...config().operator, executablePath: "/usr/local/bin/codex"},
        })), /unknown|unsupported|path/i)
        assert.throws(() => parseOptimizationConfig({...config(), accessToken: "secret"}), /unknown|token/i)
    })

    it("enforces bounded epochs, duration, patience, improvements, budgets, and targets", () => {
        const invalidLimits = [
            {maxEpochs: 0},
            {maxEpochs: 101},
            {maxDurationMs: 0},
            {maxDurationMs: Number.MAX_SAFE_INTEGER},
            {patience: 0},
            {patience: 9},
            {minimumImprovement: -0.01},
            {minimumImprovement: 101},
            {maxTurns: 0},
            {maxTokens: -1},
            {maxCostMicros: -1},
        ]
        for (const patch of invalidLimits) {
            assert.throws(() => parseOptimizationConfig(config({
                limits: {...config().limits, ...patch},
            })), /limit|epoch|duration|patience|improvement|turn|token|cost/i)
        }
        for (const target of [
            {...config().target, minimumScore: 101},
            {...config().target, minimumPassRate: 1.1},
            {...config().target, requireCriticalCases: "yes"},
        ]) {
            assert.throws(() => parseOptimizationConfig(config({target})), /target|score|pass|critical/i)
        }
        const zeroFloor = parseOptimizationConfig(config({
            limits: {
                ...config().limits,
                minimumImprovement: 0,
                maxTokens: 0,
                maxCostMicros: 0,
            },
        }))
        assert.equal(zeroFloor.limits.minimumImprovement, 0)
        assert.equal(zeroFloor.limits.maxTokens, 0)
        assert.equal(zeroFloor.limits.maxCostMicros, 0)
    })

    it("rejects sparse arrays, non-plain objects, and unknown nested fields", () => {
        const sparseTargets = []
        sparseTargets[1] = config().targets[0]
        assert.throws(() => parseOptimizationConfig(config({targets: sparseTargets})), /dense|array/i)
        assert.throws(
            () => parseOptimizationConfig(Object.assign(Object.create({polluted: true}), config())),
            /plain object/i,
        )
        assert.throws(() => parseOptimizationConfig(config({
            telemetry: {tokens: true, cost: true, pricingPath: "/tmp/prices"},
        })), /unknown|unsupported/i)
    })

    it("freezes trusted identities without retaining caller-owned objects", () => {
        const input = freezeInput()
        const frozen = freezeOptimizationRun(input)
        input.baseline.skillRoot = "renderer/forged"
        input.dataset.caseRevisions[0].revision = 999

        assert.deepEqual(frozen.baseline, {
            repositoryId: "repository-1",
            skillId: "skill-1",
            versionId: "version-1",
            commit: "a".repeat(40),
            skillName: "billing-cost-management",
            skillRoot: "skills/billing-cost-management",
            contentDigest: digest("baseline content"),
        })
        assert.equal(frozen.dataset.caseRevisions[0].revision, 3)
        assert.equal(frozen.skillEvidenceDigest, input.skillEvidence.digest)
        assert.match(frozen.digest, /^sha256:[a-f0-9]{64}$/u)
        assert.equal(Object.isFrozen(frozen.baseline), true)
        assert.equal(Object.isFrozen(frozen.dataset.caseRevisions[0]), true)
    })

    it("produces a deterministic canonical digest independent of input key order", () => {
        const firstInput = freezeInput()
        const secondInput = {
            createdAt: firstInput.createdAt,
            config: {...firstInput.config},
            skillEvidence: firstInput.skillEvidence,
            rubric: {...firstInput.rubric},
            dataset: {...firstInput.dataset},
            baseline: {...firstInput.baseline},
        }
        assert.equal(
            freezeOptimizationRun(firstInput).digest,
            freezeOptimizationRun(secondInput).digest,
        )
    })

    it("rejects untrusted or stale frozen-run prerequisites", () => {
        const notReleased = freezeInput()
        notReleased.baseline.state = "candidate"
        assert.throws(() => freezeOptimizationRun(notReleased), /released/i)

        const missingRubric = freezeInput({rubric: null})
        assert.throws(() => freezeOptimizationRun(missingRubric), /published.*rubric|rubric.*published/i)

        const staleCase = freezeInput()
        staleCase.dataset.caseRevisions[0].calibrationStatus = "needed"
        assert.throws(() => freezeOptimizationRun(staleCase), /calibration/i)

        const differentSkill = freezeInput()
        differentSkill.dataset.skillId = "skill-2"
        assert.throws(() => freezeOptimizationRun(differentSkill), /dataset.*skill|skill.*identity/i)

        const incompleteEvidence = freezeInput()
        incompleteEvidence.skillEvidence = {...incompleteEvidence.skillEvidence, truncated: true}
        assert.throws(() => freezeOptimizationRun(incompleteEvidence), /complete|truncat|digest/i)
    })

    it("requires and freezes the Dataset repository identity", () => {
        const matching = freezeInput()
        matching.dataset.repositoryId = matching.baseline.repositoryId
        const frozen = freezeOptimizationRun(matching)
        assert.equal(frozen.dataset.repositoryId, matching.baseline.repositoryId)

        const missing = freezeInput()
        delete missing.dataset.repositoryId
        assert.throws(() => freezeOptimizationRun(missing), /dataset.*repository|required/i)

        const differentRepository = freezeInput()
        differentRepository.dataset.repositoryId = "repository-2"
        assert.throws(
            () => freezeOptimizationRun(differentRepository),
            /dataset.*repository|repository.*identity/i,
        )

        const secondRepository = freezeInput()
        secondRepository.baseline.repositoryId = "repository-2"
        secondRepository.dataset.repositoryId = "repository-2"
        assert.notEqual(frozen.digest, freezeOptimizationRun(secondRepository).digest)
    })

    it("rejects hard token or cost budgets without matching telemetry", () => {
        assert.throws(() => parseOptimizationConfig(config({
            telemetry: {tokens: false, cost: true},
        })), /token.*telemetry/i)
        assert.throws(() => parseOptimizationConfig(config({
            telemetry: {tokens: true, cost: false},
        })), /cost.*telemetry/i)
        assert.doesNotThrow(() => parseOptimizationConfig(config({
            limits: {...config().limits, maxTokens: 0, maxCostMicros: 0},
            telemetry: {tokens: false, cost: false},
        })))

        const noTokens = freezeInput()
        noTokens.config.telemetry.tokens = false
        assert.throws(() => freezeOptimizationRun(noTokens), /token.*telemetry/i)

        const noCost = freezeInput()
        noCost.config.telemetry.cost = false
        assert.throws(() => freezeOptimizationRun(noCost), /cost.*telemetry/i)

        const zeroBudgets = freezeInput()
        zeroBudgets.config.limits.maxTokens = 0
        zeroBudgets.config.limits.maxCostMicros = 0
        zeroBudgets.config.telemetry = {tokens: false, cost: false}
        assert.doesNotThrow(() => freezeOptimizationRun(zeroBudgets))
    })

    it("parses bounded structured decisions from objects or fenced JSON", () => {
        const value = {
            schemaVersion: OPTIMIZATION_DECISION_SCHEMA,
            action: "continue",
            rationale: "The latest score improved but remains below target.",
            observations: [{kind: "score", summary: "Improved by 3.5 points", artifactId: "analysis-1"}],
        }
        const direct = parseOptimizationDecision(value)
        const fenced = parseOptimizationDecision(`Review:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``)

        assert.deepEqual(fenced, direct)
        assert.equal(Object.isFrozen(direct.observations[0]), true)
        assert.throws(() => direct.observations.push({}), TypeError)
    })

    it("rejects decision schema drift, phase overrides, and limit mutation", () => {
        const base = {
            schemaVersion: OPTIMIZATION_DECISION_SCHEMA,
            action: "pause",
            rationale: "Approval is required.",
        }
        assert.throws(() => parseOptimizationDecision({...base, schemaVersion: "v2"}), /schema/i)
        assert.throws(() => parseOptimizationDecision({...base, action: "restore"}), /action/i)
        assert.throws(() => parseOptimizationDecision({...base, nextPhase: "succeeded"}), /unknown|phase/i)
        assert.throws(() => parseOptimizationDecision({
            ...base,
            observations: [{kind: "proposal", limits: {maxEpochs: 100}}],
        }), /limit|override|mutation/i)
        assert.throws(() => parseOptimizationDecision({...base, rationale: "x".repeat(9_000)}), /rationale|long/i)
    })

    it("accepts only the positive Decision observation schema", () => {
        const base = {
            schemaVersion: OPTIMIZATION_DECISION_SCHEMA,
            action: "continue",
            rationale: "Continue because the score is improving.",
        }
        assert.deepEqual(parseOptimizationDecision({...base, observations: [{
            kind: "score",
            summary: "Score increased by 3.5 points.",
            artifactId: "analysis-1",
        }]}).observations, [{
            kind: "score",
            summary: "Score increased by 3.5 points.",
            artifactId: "analysis-1",
        }])
        assert.throws(() => parseOptimizationDecision({
            ...base,
            observations: {kind: "score", summary: "Not an observation list."},
        }), /observation.*array|schema/i)
        for (const field of ["config", "target", "runtime", "judge", "telemetry", "details"]) {
            assert.throws(() => parseOptimizationDecision({
                ...base,
                observations: [{kind: "score", summary: "Forged mutation.", [field]: {enabled: true}}],
            }), /observation|unsupported|unknown|schema/i, field)
        }
    })
})
