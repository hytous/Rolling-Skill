const {createHash} = require("node:crypto")
const {isAbsolute} = require("node:path")

const {validateSkillEvidence} = require("../evaluation-skill-evidence.cjs")
const {validateOptimizationPlaybook} = require("./optimization-playbook.cjs")

const LEGACY_OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v1"
const COMPACT_OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v2"
const OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v3"
const OPTIMIZATION_DECISION_SCHEMA = "rolling-skill-optimization-decision/v1"
const LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v1"
const COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v2"
const FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v3"
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_DECISION_BYTES = 64 * 1024
const EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
const MODES = new Set(["fixed", "adaptive"])
const ACTIVATION_MODES = new Set(["automatic", "explicit"])
const DECISION_ACTIONS = new Set(["continue", "finish", "pause"])
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"])

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function requireObject(value, label) {
    if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
    return value
}

function rejectDangerousKey(key, label) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`${label} contains an unsafe field`)
}

function exactKeys(value, required, optional, label) {
    requireObject(value, label)
    const requiredSet = new Set(required)
    const allowed = new Set([...required, ...optional])
    for (const key of Object.keys(value)) {
        rejectDangerousKey(key, label)
        if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`)
    }
    for (const key of requiredSet) {
        if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing field ${key}`)
    }
    return value
}

function cloneJson(value, label = "Value", seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${label} must contain finite JSON numbers`)
        return value
    }
    if (typeof value !== "object" || value === undefined) throw new Error(`${label} must be JSON`)
    if (seen.has(value)) throw new Error(`${label} must not be cyclic`)
    seen.add(value)
    let copy
    if (Array.isArray(value)) {
        const keys = Object.keys(value)
        if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
            throw new Error(`${label} must be a dense array`)
        }
        copy = value.map((entry) => cloneJson(entry, label, seen))
    } else {
        requireObject(value, label)
        copy = {}
        for (const key of Object.keys(value)) {
            rejectDangerousKey(key, label)
            copy[key] = cloneJson(value[key], label, seen)
        }
    }
    seen.delete(value)
    return copy
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function canonicalDigest(value) {
    const copy = cloneJson(value, "Digest input")
    return `sha256:${createHash("sha256").update(canonicalJson(copy)).digest("hex")}`
}

function requiredText(value, label, maxLength = 300) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized.length > maxLength) throw new Error(`${label} is too long`)
    if (/\u0000/u.test(normalized)) throw new Error(`${label} contains unsupported characters`)
    return normalized
}

function nullableText(value, label, maxLength = 300) {
    if (value === undefined || value === null || value === "") return null
    return requiredText(value, label, maxLength)
}

function optimizationDirection(value) {
    if (value === undefined || value === null) return null
    if (typeof value !== "string") throw new Error("Optimization direction must be text or null")
    const normalized = value.trim()
    if (!normalized) return null
    if (normalized.length > 8_000) throw new Error("Optimization direction is too long")
    if (/\u0000/u.test(normalized)) {
        throw new Error("Optimization direction contains unsupported characters")
    }
    return normalized
}

function timestamp(value, label) {
    const normalized = requiredText(value, label, 100)
    if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) {
        throw new Error(`${label} must be a canonical timestamp`)
    }
    return normalized
}

function digestText(value, label) {
    const normalized = requiredText(value, label, 80)
    if (!/^sha256:[a-f0-9]{64}$/u.test(normalized)) throw new Error(`${label} must be SHA-256`)
    return normalized
}

function boundedInteger(value, label, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label} is outside its supported limit`)
    }
    return value
}

function boundedNumber(value, label, minimum, maximum, {exclusiveMinimum = false} = {}) {
    const outsideMinimum = exclusiveMinimum ? value <= minimum : value < minimum
    if (!Number.isFinite(value) || outsideMinimum || value > maximum) {
        throw new Error(`${label} is outside its supported limit`)
    }
    return value
}

function optionalPositiveInteger(value, label, maximum) {
    if (value === undefined || value === null) return null
    return boundedInteger(value, label, 1, maximum)
}

function optionalNonnegativeInteger(value, label, maximum) {
    if (value === undefined || value === null) return null
    return boundedInteger(value, label, 0, maximum)
}

function runtimeSelection(value, label) {
    exactKeys(value, ["runtimeId", "modelId"], ["effort"], label)
    const effort = nullableText(value.effort, `${label} effort`, 100)
    if (effort !== null && !EFFORTS.has(effort)) throw new Error(`${label} effort is unsupported`)
    return {
        runtimeId: requiredText(value.runtimeId, `${label} runtime id`, 300),
        modelId: requiredText(value.modelId, `${label} model id`, 300),
        effort,
    }
}

function legacyLimits(value) {
    exactKeys(
        value,
        ["maxEpochs", "maxDurationMs", "patience", "minimumImprovement"],
        ["maxTurns", "maxTokens", "maxCostMicros"],
        "Optimization limits",
    )
    const maxEpochs = boundedInteger(value.maxEpochs, "Optimization max epochs", 1, 100)
    const patience = boundedInteger(value.patience, "Optimization patience", 1, maxEpochs)
    return {
        maxEpochs,
        maxDurationMs: boundedInteger(
            value.maxDurationMs,
            "Optimization max duration",
            1,
            MAX_DURATION_MS,
        ),
        patience,
        minimumImprovement: boundedNumber(
            value.minimumImprovement,
            "Optimization minimum improvement",
            0,
            100,
        ),
        maxTurns: optionalPositiveInteger(value.maxTurns, "Optimization max turns", 1_000_000),
        maxTokens: optionalNonnegativeInteger(
            value.maxTokens,
            "Optimization max tokens",
            1_000_000_000_000,
        ),
        maxCostMicros: optionalNonnegativeInteger(
            value.maxCostMicros,
            "Optimization max cost",
            Number.MAX_SAFE_INTEGER,
        ),
    }
}

function compactLimits(value) {
    exactKeys(value, ["maxEpochs"], [], "Optimization limits")
    return {
        maxEpochs: boundedInteger(
            value.maxEpochs,
            "Optimization max epochs",
            1,
            Number.MAX_SAFE_INTEGER,
        ),
    }
}

function target(value) {
    exactKeys(
        value,
        ["minimumScore", "minimumPassRate", "requireCriticalCases"],
        [],
        "Optimization target",
    )
    if (typeof value.requireCriticalCases !== "boolean") {
        throw new Error("Optimization critical Case target must be boolean")
    }
    return {
        minimumScore: boundedNumber(value.minimumScore, "Optimization minimum score", 0, 100),
        minimumPassRate: boundedNumber(value.minimumPassRate, "Optimization minimum pass rate", 0, 1),
        requireCriticalCases: value.requireCriticalCases,
    }
}

function telemetry(value) {
    exactKeys(value, ["tokens", "cost"], [], "Optimization telemetry")
    if (typeof value.tokens !== "boolean" || typeof value.cost !== "boolean") {
        throw new Error("Optimization telemetry capabilities must be boolean")
    }
    return {tokens: value.tokens, cost: value.cost}
}

function parseOptimizationConfig(value) {
    const source = cloneJson(value, "Optimization config")
    const legacy = ["mode", "target", "telemetry"].some((field) => Object.hasOwn(source, field))
    const v3 = !legacy && Object.hasOwn(source, "optimizationDirection")
    const compactFields = [
        "skillId",
        "baselineVersionId",
        "datasetId",
        "operator",
        "targets",
        "judge",
        "activationMode",
        "limits",
    ]
    exactKeys(
        source,
        legacy ? [
            "skillId",
            "baselineVersionId",
            "datasetId",
            "operator",
            "targets",
            "judge",
            "activationMode",
            "mode",
            "limits",
            "target",
            "telemetry",
        ] : v3 ? [...compactFields, "optimizationDirection"] : compactFields,
        [],
        "Optimization config",
    )
    const activationMode = requiredText(source.activationMode, "Optimization activation mode", 20)
    if (!ACTIVATION_MODES.has(activationMode)) {
        throw new Error("Optimization activation mode must be automatic or explicit")
    }
    if (!Array.isArray(source.targets) || source.targets.length === 0 || source.targets.length > 64) {
        throw new Error("Optimization targets must contain between 1 and 64 entries")
    }
    const targets = source.targets.map((entry, index) => runtimeSelection(
        entry,
        `Optimization target ${index + 1}`,
    ))
    if (new Set(targets.map((entry) => entry.runtimeId)).size !== targets.length) {
        throw new Error("Optimization target runtime ids must be unique")
    }
    const parsed = {
        schemaVersion: legacy
            ? LEGACY_OPTIMIZATION_CONFIG_SCHEMA
            : v3 ? OPTIMIZATION_CONFIG_SCHEMA : COMPACT_OPTIMIZATION_CONFIG_SCHEMA,
        skillId: requiredText(source.skillId, "Optimization Skill id", 200),
        baselineVersionId: requiredText(
            source.baselineVersionId,
            "Optimization baseline version id",
            200,
        ),
        datasetId: requiredText(source.datasetId, "Optimization Dataset id", 200),
        operator: runtimeSelection(source.operator, "Optimization operator"),
        targets,
        judge: runtimeSelection(source.judge, "Optimization Judge"),
        activationMode,
        limits: legacy ? legacyLimits(source.limits) : compactLimits(source.limits),
        ...(v3 ? {optimizationDirection: optimizationDirection(source.optimizationDirection)} : {}),
        ...(legacy ? {
            mode: requiredText(source.mode, "Optimization mode", 20),
            target: target(source.target),
            telemetry: telemetry(source.telemetry),
        } : {}),
    }
    if (legacy && !MODES.has(parsed.mode)) throw new Error("Optimization mode must be fixed or adaptive")
    if (legacy && parsed.limits.maxTokens > 0 && !parsed.telemetry.tokens) {
        throw new Error("A hard token budget requires token telemetry capability")
    }
    if (legacy && parsed.limits.maxCostMicros > 0 && !parsed.telemetry.cost) {
        throw new Error("A hard cost budget requires cost telemetry capability")
    }
    return deepFreeze(parsed)
}

function parseJsonText(value, label) {
    if (typeof value !== "string") return value
    const blocks = [...value.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu)]
    for (const block of blocks.reverse()) {
        try {
            return JSON.parse(block[1].trim())
        } catch {
            // Try an earlier block, then the complete string.
        }
    }
    try {
        return JSON.parse(value)
    } catch {
        throw new Error(`${label} does not contain valid JSON`)
    }
}

function decisionObservation(value, index) {
    exactKeys(
        value,
        ["kind", "summary"],
        ["artifactId"],
        `Optimization decision observation ${index + 1}`,
    )
    const observation = {
        kind: requiredText(value.kind, `Optimization decision observation ${index + 1} kind`, 100),
        summary: requiredText(value.summary, `Optimization decision observation ${index + 1} summary`, 2_000),
    }
    if (value.artifactId !== undefined) {
        const artifactId = requiredText(
            value.artifactId,
            `Optimization decision observation ${index + 1} artifact id`,
            200,
        )
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(artifactId)) {
            throw new Error("Optimization decision observation artifact id must be opaque")
        }
        observation.artifactId = artifactId
    }
    return observation
}

function parseOptimizationDecision(value) {
    const source = cloneJson(parseJsonText(value, "Optimization decision"), "Optimization decision")
    exactKeys(
        source,
        ["schemaVersion", "action", "rationale"],
        ["observations"],
        "Optimization decision",
    )
    if (source.schemaVersion !== OPTIMIZATION_DECISION_SCHEMA) {
        throw new Error(`Optimization decision must use schema ${OPTIMIZATION_DECISION_SCHEMA}`)
    }
    const action = requiredText(source.action, "Optimization decision action", 20)
    if (!DECISION_ACTIONS.has(action)) {
        throw new Error("Optimization decision action must be continue, finish, or pause")
    }
    const observationSource = source.observations === undefined ? [] : source.observations
    if (!Array.isArray(observationSource) || observationSource.length > 64) {
        throw new Error("Optimization decision observations must be a bounded array")
    }
    const observations = observationSource.map(decisionObservation)
    const parsed = {
        schemaVersion: OPTIMIZATION_DECISION_SCHEMA,
        action,
        rationale: requiredText(source.rationale, "Optimization decision rationale", 8_192),
        observations,
    }
    if (Buffer.byteLength(canonicalJson(parsed)) > MAX_DECISION_BYTES) {
        throw new Error("Optimization decision exceeds its byte limit")
    }
    return deepFreeze(parsed)
}

function trustedSkillRoot(value) {
    const root = requiredText(value, "Baseline Skill root", 4_096)
    if (
        isAbsolute(root) ||
        root.includes("\\") ||
        root.split("/").some((part) => part === ".." || part === "")
    ) {
        throw new Error("Baseline Skill root must be a trusted repository-relative path")
    }
    return root
}

function baselineSnapshot(value, {releasedFact = true} = {}) {
    exactKeys(
        value,
        ["repositoryId", "skillId", "versionId", "commit", "skillRoot", "contentDigest"],
        releasedFact ? ["state", "skillName"] : ["skillName"],
        "Optimization baseline",
    )
    if (releasedFact && String(value.state ?? "").toLowerCase() !== "released") {
        throw new Error("Optimization baseline must be a Released Skill version")
    }
    const commit = requiredText(value.commit, "Baseline commit", 64)
    if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Baseline commit must be a full SHA-1")
    const skillName = value.skillName === undefined
        ? null
        : requiredText(value.skillName, "Baseline Skill name", 200)
    return {
        repositoryId: requiredText(value.repositoryId, "Baseline repository id", 200),
        skillId: requiredText(value.skillId, "Baseline Skill id", 200),
        versionId: requiredText(value.versionId, "Baseline version id", 200),
        commit,
        ...(skillName === null ? {} : {skillName}),
        skillRoot: trustedSkillRoot(value.skillRoot),
        contentDigest: digestText(value.contentDigest, "Baseline content digest"),
    }
}

function caseRevision(value, index) {
    exactKeys(
        value,
        ["caseId", "revision", "rubricVersionId", "calibrationStatus"],
        [],
        `Dataset Case revision ${index + 1}`,
    )
    const calibrationStatus = requiredText(
        value.calibrationStatus,
        `Dataset Case revision ${index + 1} calibration status`,
        40,
    )
    if (calibrationStatus !== "current") {
        throw new Error("Every Dataset Case requires current Rubric calibration")
    }
    return {
        caseId: requiredText(value.caseId, `Dataset Case revision ${index + 1} id`, 200),
        revision: boundedInteger(
            value.revision,
            `Dataset Case revision ${index + 1}`,
            1,
            Number.MAX_SAFE_INTEGER,
        ),
        rubricVersionId: requiredText(
            value.rubricVersionId,
            `Dataset Case revision ${index + 1} Rubric version id`,
            200,
        ),
        calibrationStatus,
    }
}

function datasetSnapshot(value, {bindingFact = true} = {}) {
    exactKeys(
        value,
        ["id", "revision", "caseRevisions", "digest", "repositoryId"],
        bindingFact ? ["skillId"] : [],
        "Optimization Dataset",
    )
    if (!Array.isArray(value.caseRevisions) || value.caseRevisions.length === 0) {
        throw new Error("Optimization Dataset requires calibrated Case revisions")
    }
    if (value.caseRevisions.length > 100_000) {
        throw new Error("Optimization Dataset has too many Case revisions")
    }
    const caseRevisions = value.caseRevisions.map(caseRevision)
    if (new Set(caseRevisions.map((entry) => entry.caseId)).size !== caseRevisions.length) {
        throw new Error("Optimization Dataset Case revisions must be unique")
    }
    return {
        id: requiredText(value.id, "Optimization Dataset id", 200),
        revision: boundedInteger(value.revision, "Optimization Dataset revision", 1, Number.MAX_SAFE_INTEGER),
        caseRevisions,
        digest: digestText(value.digest, "Optimization Dataset digest"),
        repositoryId: requiredText(value.repositoryId, "Optimization Dataset repository id", 200),
    }
}

function rubricSnapshot(value, {publishedFact = true} = {}) {
    if (!isPlainObject(value)) throw new Error("A published Rubric is required for optimization")
    exactKeys(
        value,
        ["id", "version", "scoringModel", "digest"],
        publishedFact ? ["datasetId", "publishedAt"] : [],
        "Optimization Rubric",
    )
    if (publishedFact) timestamp(value.publishedAt, "Optimization Rubric publishedAt")
    const scoringModel = requiredText(value.scoringModel, "Optimization Rubric scoring model", 100)
    if (scoringModel !== "unified-100/v1") {
        throw new Error("Optimization requires a published Rubric using unified-100/v1")
    }
    return {
        id: requiredText(value.id, "Optimization Rubric id", 200),
        version: boundedInteger(value.version, "Optimization Rubric version", 1, Number.MAX_SAFE_INTEGER),
        scoringModel,
        digest: digestText(value.digest, "Optimization Rubric digest"),
    }
}

function frozenRunBody(value, {trustedFacts = true} = {}) {
    const baseline = baselineSnapshot(value.baseline, {releasedFact: trustedFacts})
    const dataset = datasetSnapshot(value.dataset, {bindingFact: trustedFacts})
    const rubric = rubricSnapshot(value.rubric, {publishedFact: trustedFacts})
    const config = parseOptimizationConfig(value.config)
    if (config.skillId !== baseline.skillId || config.baselineVersionId !== baseline.versionId) {
        throw new Error("Optimization config does not match the trusted baseline Skill identity")
    }
    if (config.datasetId !== dataset.id) {
        throw new Error("Optimization config does not match the trusted Dataset identity")
    }
    if (trustedFacts) {
        const datasetSkillId = requiredText(value.dataset.skillId, "Dataset stable Skill identity", 200)
        if (datasetSkillId !== baseline.skillId) {
            throw new Error("Dataset is bound to a different stable Skill identity")
        }
        if (dataset.repositoryId !== baseline.repositoryId) {
            throw new Error("Dataset is bound to a different stable Skill repository identity")
        }
        if (value.rubric.datasetId !== dataset.id) {
            throw new Error("Published Rubric does not belong to the selected Dataset")
        }
    }
    if (dataset.caseRevisions.some((entry) => entry.rubricVersionId !== rubric.id)) {
        throw new Error("One or more Dataset Cases have stale Rubric calibration")
    }
    const legacy = config.schemaVersion === LEGACY_OPTIMIZATION_CONFIG_SCHEMA
    const v3 = config.schemaVersion === OPTIMIZATION_CONFIG_SCHEMA
    if (legacy && config.limits.maxTokens > 0 && !config.telemetry.tokens) {
        throw new Error("A hard token budget requires token telemetry capability")
    }
    if (legacy && config.limits.maxCostMicros > 0 && !config.telemetry.cost) {
        throw new Error("A hard cost budget requires cost telemetry capability")
    }
    return {
        schemaVersion: legacy
            ? LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA
            : v3 ? FROZEN_OPTIMIZATION_RUN_SCHEMA : COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA,
        baseline,
        dataset,
        rubric,
        skillEvidenceDigest: digestText(value.skillEvidenceDigest, "Optimization Skill evidence digest"),
        operator: cloneJson(config.operator),
        targets: cloneJson(config.targets),
        judge: cloneJson(config.judge),
        activationMode: config.activationMode,
        limits: cloneJson(config.limits),
        ...(v3 ? {
            optimizationDirection: config.optimizationDirection,
            playbook: validateOptimizationPlaybook(value.playbook),
        } : {}),
        ...(legacy ? {
            mode: config.mode,
            target: cloneJson(config.target),
            telemetry: cloneJson(config.telemetry),
        } : {}),
        createdAt: timestamp(value.createdAt, "Optimization creation time"),
    }
}

function freezeOptimizationRun(value) {
    const source = cloneJson(value, "Optimization frozen-run input")
    exactKeys(
        source,
        ["baseline", "dataset", "rubric", "skillEvidence", "config", "createdAt"],
        ["playbook"],
        "Optimization frozen-run input",
    )
    let evidence
    try {
        evidence = validateSkillEvidence(source.skillEvidence, {requireComplete: true})
    } catch (error) {
        throw new Error(`Optimization requires complete Skill evidence: ${error.message}`)
    }
    const body = frozenRunBody({...source, skillEvidenceDigest: evidence.digest})
    return deepFreeze({...body, digest: canonicalDigest(body)})
}

function validateFrozenOptimizationRun(value) {
    const source = cloneJson(value, "Frozen optimization run")
    const legacy = source.schemaVersion === LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA
    const compact = source.schemaVersion === COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA
    const v3 = source.schemaVersion === FROZEN_OPTIMIZATION_RUN_SCHEMA
    if (!legacy && !compact && !v3) {
        throw new Error(
            `Frozen optimization run must use ${LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA}, ` +
            `${COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA}, or ${FROZEN_OPTIMIZATION_RUN_SCHEMA}`,
        )
    }
    exactKeys(
        source,
        legacy ? [
            "schemaVersion",
            "baseline",
            "dataset",
            "rubric",
            "skillEvidenceDigest",
            "operator",
            "targets",
            "judge",
            "activationMode",
            "mode",
            "limits",
            "target",
            "telemetry",
            "createdAt",
            "digest",
        ] : v3 ? [
            "schemaVersion",
            "baseline",
            "dataset",
            "rubric",
            "skillEvidenceDigest",
            "operator",
            "targets",
            "judge",
            "activationMode",
            "limits",
            "optimizationDirection",
            "playbook",
            "createdAt",
            "digest",
        ] : [
            "schemaVersion",
            "baseline",
            "dataset",
            "rubric",
            "skillEvidenceDigest",
            "operator",
            "targets",
            "judge",
            "activationMode",
            "limits",
            "createdAt",
            "digest",
        ],
        [],
        "Frozen optimization run",
    )
    const body = frozenRunBody({
        baseline: source.baseline,
        dataset: source.dataset,
        rubric: source.rubric,
        skillEvidenceDigest: source.skillEvidenceDigest,
        config: {
            skillId: source.baseline.skillId,
            baselineVersionId: source.baseline.versionId,
            datasetId: source.dataset.id,
            operator: source.operator,
            targets: source.targets,
            judge: source.judge,
            activationMode: source.activationMode,
            limits: source.limits,
            ...(v3 ? {optimizationDirection: source.optimizationDirection} : {}),
            ...(legacy ? {
                mode: source.mode,
                target: source.target,
                telemetry: source.telemetry,
            } : {}),
        },
        ...(v3 ? {playbook: source.playbook} : {}),
        createdAt: source.createdAt,
    }, {trustedFacts: false})
    const claimedDigest = digestText(source.digest, "Frozen optimization run digest")
    if (canonicalDigest(body) !== claimedDigest) {
        throw new Error("Frozen optimization run digest does not match its immutable snapshot")
    }
    return deepFreeze({...body, digest: claimedDigest})
}

module.exports = {
    COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA,
    COMPACT_OPTIMIZATION_CONFIG_SCHEMA,
    FROZEN_OPTIMIZATION_RUN_SCHEMA,
    MAX_DURATION_MS,
    OPTIMIZATION_CONFIG_SCHEMA,
    OPTIMIZATION_DECISION_SCHEMA,
    canonicalOptimizationDigest: canonicalDigest,
    freezeOptimizationRun,
    parseOptimizationConfig,
    parseOptimizationDecision,
    validateFrozenOptimizationRun,
}
