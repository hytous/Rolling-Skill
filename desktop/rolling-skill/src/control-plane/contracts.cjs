const {z} = require("zod")
const {
    MAX_SKILL_VERSION_CURSOR_LENGTH,
    decodeSkillVersionCursor,
} = require("../managed-skill-version-cursor.cjs")

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_SIZE = 100
const MAX_IDENTIFIER_LENGTH = 200
const MAX_CURSOR_LENGTH = 32
const MAX_RAW_CASE_BATCH_SIZE = 200
const MAX_RAW_CASE_QUESTION_LENGTH = 120_000
const MAX_RAW_CASE_NOTE_LENGTH = 10_000
const MAX_SKILL_PATH_LENGTH = 4_000
const MAX_EVALUATION_CASES = 1_000
const MAX_EVALUATION_RUNTIMES = 50
const MAX_PUBLIC_DETAIL_ITEMS = 50
const MAX_CONTROL_MESSAGE_LENGTH = 120_000
const MAX_CANDIDATE_MESSAGE_LENGTH = 2_000
const MAX_INSTALLATION_TARGETS = 20

const reasoningEffort = z.enum([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
])

const id = z.string()
    .min(1)
    .max(MAX_IDENTIFIER_LENGTH)
    .refine((value) => /\S/u.test(value), "Identifier must contain a non-whitespace character")

const boundedText = (maximum, label) => z.string()
    .min(1)
    .max(maximum)
    .refine((value) => /\S/u.test(value), `${label} must contain a non-whitespace character`)

function encodeCursor(sequence) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
        throw new Error("Cursor sequence must be a non-negative safe integer")
    }
    return Buffer.from(String(sequence), "utf8").toString("base64url")
}

function decodeCursor(value) {
    if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > MAX_CURSOR_LENGTH ||
        !/^[A-Za-z0-9_-]+$/u.test(value)
    ) {
        throw new Error("Invalid cursor")
    }

    const decoded = Buffer.from(value, "base64url").toString("utf8")
    if (!/^(?:0|[1-9]\d*)$/u.test(decoded)) throw new Error("Invalid cursor")
    const sequence = Number(decoded)
    if (!Number.isSafeInteger(sequence) || sequence < 0 || encodeCursor(sequence) !== value) {
        throw new Error("Invalid cursor")
    }
    return sequence
}

const cursor = z.string()
    .min(1)
    .max(MAX_CURSOR_LENGTH)
    .refine((value) => {
        try {
            decodeCursor(value)
            return true
        } catch {
            return false
        }
    }, "Invalid cursor")

const page = z.object({
    cursor: cursor.nullable().default(null),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_LIMIT),
})

const skillVersionCursor = z.string()
    .min(1)
    .max(MAX_SKILL_VERSION_CURSOR_LENGTH)
    .refine((value) => {
        try {
            decodeSkillVersionCursor(value)
            return true
        } catch {
            return false
        }
    }, "Invalid managed Skill version cursor")

const skillVersionPage = z.object({
    cursor: skillVersionCursor.nullable().default(null),
    limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_LIMIT),
})

const skillReferenceInput = z.object({
    id: id.optional(),
    name: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name"),
    path: z.string().max(MAX_SKILL_PATH_LENGTH).optional(),
}).strict()

const rawCaseSource = z.object({
    kind: boundedText(MAX_IDENTIFIER_LENGTH, "Raw Case source kind"),
}).strict()

const publicSkillReference = z.object({
    id: id.optional(),
    repositoryId: id.optional(),
    name: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name"),
}).strict()

const publicDataset = z.object({
    id,
    name: boundedText(500, "Dataset name").optional(),
    status: boundedText(80, "Dataset status").optional(),
    skillReference: publicSkillReference.nullable().optional(),
    activeRubricVersionId: id.nullable().optional(),
    caseCount: z.number().int().min(0).optional(),
    goodcaseCount: z.number().int().min(0).optional(),
    badcaseCount: z.number().int().min(0).optional(),
    createdAt: boundedText(100, "Dataset creation time").optional(),
}).strict()

const publicArtifactReference = z.object({
    id,
    kind: boundedText(200, "Artifact kind").optional(),
    mediaType: boundedText(200, "Artifact media type").optional(),
    sizeBytes: z.number().int().nonnegative().max(64 * 1024 * 1024).optional(),
    sha256: boundedText(200, "Artifact digest").optional(),
}).strict()

const publicDatasetCase = z.object({
    id,
    datasetId: id.optional(),
    caseType: z.enum(["goodcase", "badcase"]).optional(),
    title: z.string().max(500).optional(),
    status: boundedText(80, "Case status").optional(),
    label: boundedText(200, "Case label").optional(),
    inputSummary: z.string().max(4_096).optional(),
    outputSummary: z.string().max(4_096).optional(),
    artifactRefs: z.array(publicArtifactReference).max(100).optional(),
    createdAt: boundedText(100, "Case creation time").optional(),
    updatedAt: boundedText(100, "Case update time").optional(),
}).strict()

const publicEvaluationScore = z.object({
    totalScore: z.number().finite().optional(),
    outcomeTier: boundedText(80, "Evaluation outcome tier").optional(),
    overallVerdict: boundedText(80, "Evaluation verdict").optional(),
}).strict()

const publicEvaluationResult = z.object({
    id,
    caseId: id,
    runtimeId: id,
    title: z.string().max(500).optional(),
    status: boundedText(80, "Evaluation result status"),
    gradingStatus: boundedText(80, "Evaluation grading status").optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    computedScore: publicEvaluationScore.nullable().optional(),
    reasonSummary: z.string().max(4_096).nullable().optional(),
    artifactRefs: z.array(publicArtifactReference).max(100).optional(),
    error: z.string().max(4_096).nullable().optional(),
    startedAt: z.string().max(100).nullable().optional(),
    completedAt: z.string().max(100).nullable().optional(),
}).strict()

const publicEvaluationRuntime = z.object({
    runtimeId: id,
    displayName: boundedText(500, "Runtime display name").optional(),
    modelId: id.nullable().optional(),
    effort: reasoningEffort.nullable().optional(),
}).strict()

const publicEvaluationRun = z.object({
    id,
    datasetId: id,
    datasetSnapshot: z.object({
        id,
        name: z.string().max(500).optional(),
    }).strict().optional(),
    selectionMode: z.enum(["selected", "dataset"]).optional(),
    activationMode: z.enum(["automatic", "explicit"]).optional(),
    skillReference: publicSkillReference.nullable().optional(),
    status: boundedText(80, "Evaluation status"),
    caseCount: z.number().int().nonnegative().optional(),
    runtimeCount: z.number().int().nonnegative().optional(),
    resultCount: z.number().int().nonnegative().optional(),
    resultsTruncated: z.boolean().optional(),
    progress: z.object({
        total: z.number().int().nonnegative(),
        queued: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        completed: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
        cancelled: z.number().int().nonnegative(),
    }).strict().optional(),
    runtimeConfigurations: z.array(publicEvaluationRuntime).max(32).optional(),
    results: z.array(publicEvaluationResult).max(1_000).optional(),
    artifactRefs: z.array(publicArtifactReference).max(100).optional(),
    error: z.string().max(4_096).nullable().optional(),
    createdAt: boundedText(100, "Evaluation creation time").optional(),
    startedAt: z.string().max(100).nullable().optional(),
    completedAt: z.string().max(100).nullable().optional(),
}).strict()

const publicRawCaseRecord = z.object({
    skill: publicSkillReference,
}).passthrough()

const rawCaseNote = z.string().max(MAX_RAW_CASE_NOTE_LENGTH)

const rawCaseInput = z.object({
    question: boundedText(MAX_RAW_CASE_QUESTION_LENGTH, "Raw Case question"),
    skill: skillReferenceInput,
    note: rawCaseNote.default(""),
    source: rawCaseSource.default({kind: "operator"}),
}).strict()

const rawCaseChanges = z.object({
    question: rawCaseInput.shape.question.optional(),
    skill: skillReferenceInput.optional(),
    note: rawCaseNote.optional(),
}).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    {message: "Raw Case changes must contain at least one field"},
)

const runtimeProfile = z.object({
    runtimeId: id,
    modelId: id.nullable().default(null),
    effort: reasoningEffort.nullable().default(null),
}).strict()

const installationTarget = runtimeProfile.extend({
    permissionMode: boundedText(100, "Installation permission").nullable().default(null),
}).strict()

const installationRegistrationInput = z.object({
    status: z.enum(["succeeded", "failed", "cancelled", "unverified", "needs_recovery"]),
    operation: z.enum([
        "install",
        "inspect",
        "experiment_install",
        "experiment_restore",
        "experiment_remove",
        "experiment_inspect",
    ]),
    classificationBefore: z.enum([
        "absent",
        "managed-clean",
        "managed-drifted",
        "unmanaged",
        "conflict",
        "uncertain",
    ]),
    destination: z.string().max(4_096).nullable(),
    actualDigest: z.string().max(80).nullable(),
    beforeDigest: z.string().max(80).nullable(),
    mutationPerformed: z.boolean(),
    runtimeDiscovered: z.boolean().nullable(),
    warnings: z.array(z.string().max(4_096)).max(100),
    error: z.object({
        code: id,
        message: z.string().min(1).max(8_192),
    }).strict().nullable(),
}).strict()

const evaluationStart = z.object({
    datasetId: id,
    caseIds: z.array(id).max(MAX_EVALUATION_CASES).default([]),
    selectionMode: z.enum(["selected", "dataset"]),
    activationMode: z.enum(["automatic", "explicit"]),
    runtimeConfigurations: z.array(runtimeProfile).min(1).max(MAX_EVALUATION_RUNTIMES),
    judgeConfiguration: runtimeProfile,
    idempotencyKey: id,
})

function strictEvaluationStart() {
    return evaluationStart.strict().superRefine((input, context) => {
        if (input.selectionMode === "selected" && input.caseIds.length === 0) {
            context.addIssue({
                code: "custom",
                path: ["caseIds"],
                message: "Selected evaluations require at least one case id",
            })
        }
        if (new Set(input.caseIds).size !== input.caseIds.length) {
            context.addIssue({
                code: "custom",
                path: ["caseIds"],
                message: "Evaluation case ids must be unique",
            })
        }
        const runtimeIds = input.runtimeConfigurations.map((profile) => profile.runtimeId)
        if (new Set(runtimeIds).size !== runtimeIds.length) {
            context.addIssue({
                code: "custom",
                path: ["runtimeConfigurations"],
                message: "Evaluation runtime ids must be unique",
            })
        }
    })
}

const managedSkillRepository = z.object({
    id,
    displayName: boundedText(MAX_IDENTIFIER_LENGTH, "Repository display name").optional(),
    defaultBranch: boundedText(MAX_IDENTIFIER_LENGTH, "Repository default branch").optional(),
    source: z.object({
        kind: boundedText(40, "Repository source kind"),
        importedAt: boundedText(100, "Repository import time").optional(),
    }).strict().optional(),
    createdAt: boundedText(100, "Repository creation time").optional(),
    updatedAt: boundedText(100, "Repository update time").optional(),
}).strict()

const managedSkillSummary = z.object({
    id,
    repositoryId: id,
    name: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name"),
    description: z.string().max(1_024).nullable().optional(),
    skillRoot: boundedText(MAX_SKILL_PATH_LENGTH, "Skill root").optional(),
    manifestPath: boundedText(MAX_SKILL_PATH_LENGTH, "Skill manifest path").optional(),
    status: boundedText(40, "Skill status").optional(),
    warnings: z.array(z.string().max(1_024)).max(1_000).optional(),
    warningCount: z.number().int().min(0).max(100_000),
    executableFiles: z.array(z.string().max(MAX_SKILL_PATH_LENGTH)).max(1_000).optional(),
    createdAt: boundedText(100, "Skill creation time").optional(),
    updatedAt: boundedText(100, "Skill update time").optional(),
}).strict()

const managedSkillVersion = z.object({
    id,
    repositoryId: id,
    skillId: id,
    commit: boundedText(200, "Version commit").optional(),
    contentDigest: boundedText(200, "Version content digest").optional(),
    state: boundedText(40, "Version state").optional(),
    versionLabel: z.string().max(64).nullable().optional(),
    createdBy: boundedText(40, "Version creator").optional(),
    optimizationRoundId: z.string().max(MAX_IDENTIFIER_LENGTH).nullable().optional(),
    createdAt: boundedText(100, "Version creation time").optional(),
    releasedAt: z.string().max(100).nullable().optional(),
    deprecatedAt: z.string().max(100).nullable().optional(),
}).strict()

const managedSkillPageResult = z.object({
    repositories: z.array(managedSkillRepository).max(MAX_PAGE_SIZE),
    skills: z.array(managedSkillSummary).max(MAX_PAGE_SIZE),
    nextCursor: cursor.nullable(),
}).strict()

const managedSkillRepositoryPageResult = z.object({
    repositories: z.array(managedSkillRepository).max(MAX_PAGE_SIZE),
    nextCursor: cursor.nullable(),
}).strict()

const managedSkillVersionPageResult = z.object({
    versions: z.array(managedSkillVersion).max(MAX_PAGE_SIZE),
    nextCursor: skillVersionCursor.nullable(),
}).strict()

const operatorJobStatus = z.enum([
    "queued",
    "running",
    "waiting_approval",
    "paused",
    "cancelling",
    "needs_recovery",
    "succeeded",
    "failed",
    "cancelled",
])

const publicOperatorJob = z.object({
    id,
    sessionId: id,
    parentJobId: id.nullable().optional(),
    type: boundedText(MAX_IDENTIFIER_LENGTH, "Operator Job type").optional(),
    objective: z.string().max(32_768).optional(),
    status: operatorJobStatus,
    childJobIds: z.array(id).max(10_000).optional(),
    artifactIds: z.array(id).max(10_000).optional(),
    approvalIds: z.array(id).max(10_000).optional(),
    createdAt: boundedText(100, "Operator Job creation time").optional(),
    updatedAt: boundedText(100, "Operator Job update time").optional(),
    startedAt: z.string().max(100).nullable().optional(),
    completedAt: z.string().max(100).nullable().optional(),
    error: z.object({
        code: boundedText(MAX_IDENTIFIER_LENGTH, "Operator Job error code"),
        message: z.string().max(4_096),
    }).strict().nullable().optional(),
}).strict()

const publicApproval = z.object({
    id,
    jobId: id,
    sessionId: id,
    stepId: id.nullable().optional(),
    action: boundedText(MAX_IDENTIFIER_LENGTH, "Approval action").optional(),
    risk: z.string().max(4_096).optional(),
    scope: z.object({
        skillIds: z.array(id).max(4_096).optional(),
        datasetIds: z.array(id).max(4_096).optional(),
        runtimeIds: z.array(id).max(4_096).optional(),
        repositoryIds: z.array(id).max(4_096).optional(),
        budget: z.object({
            maxDurationMs: z.number().int().nonnegative().optional(),
            maxRuntimeTurns: z.number().int().nonnegative().optional(),
            maxEvaluations: z.number().int().nonnegative().optional(),
            maxTargetExecutions: z.number().int().nonnegative().optional(),
            maxJudgeExecutions: z.number().int().nonnegative().optional(),
            maxTokens: z.number().int().nonnegative().nullable().optional(),
            maxReportedCost: z.number().nonnegative().nullable().optional(),
        }).strict().optional(),
    }).strict().optional(),
    proposedMutation: z.object({
        method: boundedText(MAX_IDENTIFIER_LENGTH, "Approval method").optional(),
        resourceIds: z.object({
            datasetId: id.optional(),
            caseId: id.optional(),
            repositoryId: id.optional(),
            skillId: id.optional(),
            versionId: id.optional(),
            sessionId: id.optional(),
            installationId: id.optional(),
            runId: id.optional(),
            targetRuntimeIds: z.array(id).max(4_096).optional(),
        }).strict().optional(),
    }).strict().optional(),
    expiresAt: boundedText(100, "Approval expiry").optional(),
    status: z.enum(["pending", "approved", "rejected"]),
    decision: z.enum(["approve", "reject"]).nullable().optional(),
    decisionScope: z.string().max(300).nullable().optional(),
    decidedBy: z.string().max(300).nullable().optional(),
    createdAt: boundedText(100, "Approval creation time").optional(),
    resolvedAt: z.string().max(100).nullable().optional(),
}).strict()

const publicCurationSession = z.object({
    id,
    datasetId: id,
    caseType: z.enum(["goodcase", "badcase"]).optional(),
    status: boundedText(80, "Curation status"),
    caseId: id.nullable().optional(),
    error: z.string().max(4_096).nullable().optional(),
    createdAt: boundedText(100, "Curation creation time").optional(),
    updatedAt: boundedText(100, "Curation update time").optional(),
}).strict()

const publicInstallation = z.object({
    id,
    parentJobId: id.nullable().optional(),
    operation: z.enum(["install", "inspect"]).optional(),
    status: boundedText(80, "Installation status"),
    repositoryId: id,
    skillId: id,
    versionId: id.optional(),
    runtimeId: id,
    providerId: id.optional(),
    modelId: id.nullable().optional(),
    effort: reasoningEffort.nullable().optional(),
    error: z.object({
        code: boundedText(MAX_IDENTIFIER_LENGTH, "Installation error code"),
        message: z.string().max(4_096),
    }).strict().nullable().optional(),
    createdAt: boundedText(100, "Installation creation time").optional(),
    updatedAt: boundedText(100, "Installation update time").optional(),
    completedAt: z.string().max(100).nullable().optional(),
}).strict()

const publicSkillDiff = z.object({
    skillId: id,
    repositoryId: id,
    baseVersionId: id,
    candidateVersionId: id,
    changed: z.boolean(),
}).strict()

const optimizationRuntime = z.object({
    runtimeId: id,
    modelId: id,
    effort: reasoningEffort.nullable().default(null),
}).strict()

const legacyOptimizationLimits = z.object({
    maxEpochs: z.number().int().min(1).max(100),
    maxDurationMs: z.number().int().min(1).max(30 * 24 * 60 * 60 * 1_000),
    patience: z.number().int().min(1).max(100),
    minimumImprovement: z.number().finite().min(0).max(100),
    maxTurns: z.number().int().min(1).max(1_000_000).nullable().default(null),
    maxTokens: z.number().int().min(0).max(1_000_000_000_000).nullable().default(null),
    maxCostMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
}).strict().superRefine((limits, context) => {
    if (limits.patience > limits.maxEpochs) {
        context.addIssue({
            code: "custom",
            path: ["patience"],
            message: "Optimization patience cannot exceed max epochs",
        })
    }
})

const compactOptimizationLimits = z.object({
    maxEpochs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
}).strict()

const legacyOptimizationConfigInput = z.object({
    skillId: id,
    baselineVersionId: id,
    datasetId: id,
    operator: optimizationRuntime,
    targets: z.array(optimizationRuntime).min(1).max(64),
    judge: optimizationRuntime,
    activationMode: z.enum(["automatic", "explicit"]),
    mode: z.enum(["fixed", "adaptive"]),
    limits: legacyOptimizationLimits,
    target: z.object({
        minimumScore: z.number().finite().min(0).max(100),
        minimumPassRate: z.number().finite().min(0).max(1),
        requireCriticalCases: z.boolean(),
    }).strict(),
    telemetry: z.object({tokens: z.boolean(), cost: z.boolean()}).strict(),
}).strict().superRefine((input, context) => {
    const runtimeIds = input.targets.map((target) => target.runtimeId)
    if (new Set(runtimeIds).size !== runtimeIds.length) {
        context.addIssue({code: "custom", path: ["targets"], message: "Runtime ids must be unique"})
    }
    if ((input.limits.maxTokens ?? 0) > 0 && input.telemetry.tokens !== true) {
        context.addIssue({code: "custom", path: ["limits", "maxTokens"], message: "Token telemetry is required"})
    }
    if ((input.limits.maxCostMicros ?? 0) > 0 && input.telemetry.cost !== true) {
        context.addIssue({code: "custom", path: ["limits", "maxCostMicros"], message: "Cost telemetry is required"})
    }
})

const compactOptimizationConfigInput = z.object({
    skillId: id,
    baselineVersionId: id,
    datasetId: id,
    operator: optimizationRuntime,
    targets: z.array(optimizationRuntime).min(1).max(64),
    judge: optimizationRuntime,
    activationMode: z.enum(["automatic", "explicit"]),
    limits: compactOptimizationLimits,
}).strict().superRefine((input, context) => {
    const runtimeIds = input.targets.map((target) => target.runtimeId)
    if (new Set(runtimeIds).size !== runtimeIds.length) {
        context.addIssue({code: "custom", path: ["targets"], message: "Runtime ids must be unique"})
    }
})

const optimizationConfigV3Input = z.object({
    skillId: id,
    baselineVersionId: id,
    datasetId: id,
    operator: optimizationRuntime,
    targets: z.array(optimizationRuntime).min(1).max(64),
    judge: optimizationRuntime,
    activationMode: z.enum(["automatic", "explicit"]),
    limits: compactOptimizationLimits,
    optimizationDirection: z.string().max(8_000).nullable(),
}).strict().superRefine((input, context) => {
    const runtimeIds = input.targets.map((target) => target.runtimeId)
    if (new Set(runtimeIds).size !== runtimeIds.length) {
        context.addIssue({code: "custom", path: ["targets"], message: "Runtime ids must be unique"})
    }
})

const optimizationConfigWithIdempotencyInput = z.union([
    optimizationConfigV3Input.extend({idempotencyKey: id}).strict(),
    compactOptimizationConfigInput.extend({idempotencyKey: id}).strict(),
    legacyOptimizationConfigInput.extend({idempotencyKey: id}).strict(),
])

const optimizationDecisionInput = z.object({
    schemaVersion: z.literal("rolling-skill-optimization-decision/v1"),
    action: z.enum(["continue", "finish", "pause"]),
    rationale: boundedText(8_192, "Optimization decision rationale"),
    observations: z.array(z.object({
        kind: boundedText(100, "Optimization observation kind"),
        summary: boundedText(2_000, "Optimization observation summary"),
        artifactId: id.optional(),
    }).strict()).max(64).default([]),
}).strict()

const publicOptimizationBaseline = z.object({
    repositoryId: id,
    skillId: id,
    versionId: id,
    commit: boundedText(80, "Optimization baseline commit").optional(),
    contentDigest: boundedText(80, "Optimization baseline digest").optional(),
}).strict()

const publicOptimizationDataset = z.object({
    id,
    revision: z.number().int().min(1),
    digest: boundedText(80, "Optimization Dataset digest").optional(),
}).strict()

const publicOptimizationRubric = z.object({
    id,
    version: z.number().int().min(1),
    digest: boundedText(80, "Optimization Rubric digest").optional(),
}).strict()

const publicOptimizationPlaybook = z.object({
    id: boundedText(200, "Optimization Playbook id"),
    version: z.number().int().positive(),
    digest: boundedText(80, "Optimization Playbook digest"),
}).strict()

const publicOptimizationCandidate = z.object({
    versionId: id,
    commit: boundedText(80, "Optimization Candidate commit"),
    contentDigest: boundedText(80, "Optimization Candidate digest"),
}).strict()

const positiveOptimizationEpoch = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

const publicOptimizationInstallation = z.object({
    runtimeId: id,
    status: boundedText(80, "Optimization installation status"),
    installationJobId: id,
    operation: boundedText(80, "Optimization installation operation").optional(),
    destination: boundedText(4_096, "Optimization installation destination").nullable().optional(),
    lastVerifiedDigest: boundedText(80, "Optimization installation digest").nullable().optional(),
}).strict()

const publicOptimizationAnalysis = z.object({
    score: z.number().finite().min(0).max(100).nullable().optional(),
    scoreDelta: z.number().finite().min(-100).max(100).nullable().optional(),
    baselineScoreDelta: z.number().finite().min(-100).max(100).nullable().optional(),
    passRate: z.number().finite().min(0).max(1).nullable().optional(),
    regressionCount: z.number().int().min(0).max(100_000),
    executionFailureCount: z.number().int().min(0).max(100_000).optional(),
    gradingFailureCount: z.number().int().min(0).max(100_000).optional(),
}).strict()

const publicOptimizationDecision = z.object({
    action: z.enum(["continue", "finish", "pause"]),
    rationale: z.string().max(8_192),
}).strict()

const publicOptimizationEpoch = z.object({
    number: positiveOptimizationEpoch,
    status: boundedText(40, "Optimization Epoch status"),
    candidateArtifactId: id.nullable(),
    installArtifactIds: z.array(id).max(512).optional(),
    evaluationArtifactIds: z.array(id).max(512).optional(),
    evaluationRunIds: z.array(id).max(512).optional(),
    analysisArtifactId: id.nullable().optional(),
    decisionArtifactId: id.nullable().optional(),
    candidate: publicOptimizationCandidate.optional(),
    installations: z.array(publicOptimizationInstallation).max(64).optional(),
    analysis: publicOptimizationAnalysis.optional(),
    decision: publicOptimizationDecision.optional(),
}).strict()

const publicOptimizationCheckpoint = z.object({
    operatorSessionId: id.optional(),
    activeEvaluationRunId: id.optional(),
    activeEvaluationKind: z.enum(["baseline", "candidate", "final-regression"]).optional(),
    installationOperation: z.enum(["experiment_inspect", "experiment_install", "experiment_restore", "experiment_remove"]).optional(),
    installationPending: z.boolean().optional(),
    installationJobIds: z.array(id).max(64).optional(),
    baselineEvaluationRunId: id.optional(),
    stopRequested: z.boolean().optional(),
    operatorCleanupError: z.string().max(2000).optional(),
    paused: z.boolean().optional(),
    pauseReason: z.string().max(300).optional(),
    stopReason: z.string().max(300).optional(),
    reportArtifactId: id.optional(),
    reportDigest: boundedText(80, "Optimization report digest").optional(),
    finalApprovalId: id.nullable().optional(),
    releaseApprovalId: id.nullable().optional(),
    installApprovalId: id.nullable().optional(),
    releasedVersionId: id.nullable().optional(),
    releasedInstallArtifactId: id.nullable().optional(),
    finalEvaluationArtifactId: id.nullable().optional(),
    finalRegressionPassed: z.boolean().optional(),
    recoveryTargets: z.array(publicOptimizationInstallation).max(64).optional(),
}).strict()

const legacyPublicOptimizationCheckpoint = publicOptimizationCheckpoint.extend({
    telemetry: z.object({
        elapsedMs: z.number().finite().min(0),
        turnsUsed: z.number().int().min(0),
        tokens: z.number().int().min(0).nullable(),
        costMicros: z.number().int().min(0).nullable(),
    }).strict().optional(),
}).strict()

const publicOptimizationRunBase = z.object({
    id,
    state: z.enum([
        "preflight", "baseline", "editing", "installing", "evaluating", "deciding",
        "waiting_approval", "restoring", "succeeded", "failed", "cancelled", "needs_recovery",
    ]),
    revision: z.number().int().min(0),
    currentEpoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    snapshotDigest: boundedText(80, "Optimization snapshot digest"),
    baseline: publicOptimizationBaseline,
    dataset: publicOptimizationDataset,
    rubric: publicOptimizationRubric,
    operator: optimizationRuntime,
    targets: z.array(optimizationRuntime).min(1).max(64),
    judge: optimizationRuntime,
    activationMode: z.enum(["automatic", "explicit"]),
    epochs: z.array(publicOptimizationEpoch),
    checkpoint: publicOptimizationCheckpoint,
    error: z.object({
        code: boundedText(MAX_IDENTIFIER_LENGTH, "Optimization error code"),
        message: z.string().max(4_096),
    }).strict().nullable(),
}).strict()

const publicOptimizationRun = z.union([
    publicOptimizationRunBase.extend({
        limits: compactOptimizationLimits,
        optimizationDirection: z.string().max(8_000).nullable(),
        playbook: publicOptimizationPlaybook,
    }).strict(),
    publicOptimizationRunBase.extend({
        limits: compactOptimizationLimits,
    }).strict(),
    publicOptimizationRunBase.extend({
        mode: z.enum(["fixed", "adaptive"]),
        limits: legacyOptimizationLimits,
        target: legacyOptimizationConfigInput.shape.target,
        telemetry: legacyOptimizationConfigInput.shape.telemetry,
        checkpoint: legacyPublicOptimizationCheckpoint,
    }).strict(),
])

const publicOptimizationPreflightBase = z.object({
    snapshotDigest: boundedText(80, "Optimization snapshot digest"),
    baseline: publicOptimizationBaseline,
    dataset: publicOptimizationDataset,
    rubric: publicOptimizationRubric,
    targets: z.array(optimizationRuntime).min(1).max(64),
    ready: z.boolean(),
})

const publicOptimizationPreflight = z.union([
    publicOptimizationPreflightBase.extend({
        optimizationDirection: z.string().max(8_000).nullable(),
        playbook: publicOptimizationPlaybook,
    }).strict(),
    publicOptimizationPreflightBase.strict(),
])

const OPERATOR_UI_ONLY_METHODS = new Set([
    "approvals.resolve",
    "jobs.pause",
    "jobs.resume",
    "jobs.stop",
    "skills.get",
    "optimization.preflight",
    "optimization.start",
    "optimization.pause",
    "optimization.resume",
    "optimization.stop",
    "installations.register",
])

function freezeMethodDefinitions(definitions) {
    for (const [method, definition] of Object.entries(definitions)) {
        definition.operatorExposed = !OPERATOR_UI_ONLY_METHODS.has(method)
        Object.freeze(definition)
    }
    return Object.freeze(definitions)
}

const METHOD_DEFINITIONS = freezeMethodDefinitions({
    "context.get": {
        action: "context.read",
        input: z.object({}).strict(),
        output: z.object({workspaceRoot: z.string(), runtimes: z.array(z.any())}).strict(),
    },
    "raw_cases.list": {
        action: "raw_cases.read",
        input: page.extend({
            skillName: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name").nullable().default(null),
        }).strict(),
        output: z.object({
            rawCases: z.array(publicRawCaseRecord).max(MAX_PAGE_SIZE),
            nextCursor: cursor.nullable(),
        }).strict(),
    },
    "raw_cases.enqueue": {
        action: "raw_cases.write",
        input: z.object({
            cases: z.array(rawCaseInput).min(1).max(MAX_RAW_CASE_BATCH_SIZE),
            idempotencyKey: id,
        }).strict(),
        output: z.object({
            created: z.array(publicRawCaseRecord),
            duplicates: z.array(z.any()),
            rejected: z.array(z.any()),
        }).strict(),
    },
    "raw_cases.update": {
        action: "raw_cases.write",
        input: z.object({id, changes: rawCaseChanges, idempotencyKey: id}).strict(),
        output: z.object({rawCase: publicRawCaseRecord}).strict(),
    },
    "raw_cases.dispatch": {
        action: "runtime.execute",
        input: z.object({
            id,
            mode: z.enum(["current", "new"]),
            runtime: runtimeProfile,
            idempotencyKey: id,
        }).strict(),
        output: z.object({threadId: id, turnId: id.nullable()}).strict(),
    },
    "runtimes.list": {
        action: "runtimes.read",
        input: z.object({}).strict(),
        output: z.object({runtimes: z.array(z.any())}).strict(),
    },
    "runtimes.models": {
        action: "runtimes.read",
        input: z.object({runtimeId: id}).strict(),
        output: z.object({models: z.array(z.any())}).strict(),
    },
    "datasets.list": {
        action: "datasets.read",
        input: page.strict(),
        output: z.object({
            datasets: z.array(publicDataset).max(MAX_PAGE_SIZE),
            nextCursor: cursor.nullable(),
        }).strict(),
    },
    "datasets.get": {
        action: "datasets.read",
        input: z.object({datasetId: id, includeCases: z.boolean().default(false)}).strict(),
        output: z.object({dataset: publicDataset, cases: z.array(publicDatasetCase).max(10_000).optional()}).strict(),
    },
    "datasets.create": {
        action: "datasets.write",
        description: "Create an empty Dataset bound to a managed Skill; this does not copy Cases or a Rubric.",
        input: z.object({
            name: boundedText(500, "Dataset name"),
            repositoryId: id,
            skillId: id,
            idempotencyKey: id,
        }).strict(),
        output: z.object({dataset: publicDataset}).strict(),
    },
    "datasets.clone": {
        action: "datasets.write",
        description: "Create a Dataset by atomically copying selected Cases and the active Rubric from a scoped source Dataset.",
        input: z.object({
            sourceDatasetId: id,
            name: boundedText(500, "Dataset name"),
            caseIds: z.array(id).min(1).max(100),
            idempotencyKey: id,
        }).strict().superRefine((input, context) => {
            if (new Set(input.caseIds).size !== input.caseIds.length) {
                context.addIssue({
                    code: "custom",
                    path: ["caseIds"],
                    message: "Dataset Case ids must be unique",
                })
            }
        }),
        output: z.object({
            dataset: publicDataset,
            cases: z.array(publicDatasetCase).max(100),
            rubricCopied: z.boolean(),
        }).strict(),
    },
    "datasets.delete": {
        action: "datasets.delete",
        input: z.object({datasetId: id, idempotencyKey: id}).strict(),
        output: z.object({dataset: publicDataset}).strict(),
    },
    "datasets.delete_case": {
        action: "datasets.delete",
        input: z.object({datasetId: id, caseId: id, idempotencyKey: id}).strict(),
        output: z.object({case: publicDatasetCase}).strict(),
    },
    "evaluations.list": {
        action: "evaluations.read",
        input: page.extend({datasetId: id.nullable().default(null)}).strict(),
        output: z.object({
            runs: z.array(publicEvaluationRun).max(MAX_PAGE_SIZE),
            nextCursor: cursor.nullable(),
        }).strict(),
    },
    "evaluations.get": {
        action: "evaluations.read",
        input: z.object({runId: id}).strict(),
        output: z.object({run: publicEvaluationRun}).strict(),
    },
    "evaluations.start": {
        action: "evaluations.execute",
        input: strictEvaluationStart(),
        output: z.object({run: publicEvaluationRun}).strict(),
    },
    "evaluations.cancel": {
        action: "evaluations.execute",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({run: publicEvaluationRun}).strict(),
    },
    "skill_repositories.list": {
        action: "skills.read",
        input: page.strict(),
        output: managedSkillRepositoryPageResult,
    },
    "skills.list": {
        action: "skills.read",
        input: page.strict(),
        output: managedSkillPageResult,
    },
    "skill_versions.list": {
        action: "skills.read",
        input: skillVersionPage.extend({skillId: id.nullable().default(null)}).strict(),
        output: managedSkillVersionPageResult,
    },
    "skills.get": {
        action: "skills.read",
        input: z.object({skillId: id}).strict(),
        output: z.object({skill: z.any()}).strict(),
    },
    "skills.diff": {
        action: "skills.read",
        input: z.object({
            repositoryId: id,
            skillId: id,
            baseVersionId: id,
            candidateVersionId: id,
        }).strict(),
        output: z.object({diff: publicSkillDiff}).strict(),
    },
    "skills.create_candidate": {
        action: "skills.write",
        input: z.object({
            repositoryId: id,
            skillId: id,
            message: boundedText(MAX_CANDIDATE_MESSAGE_LENGTH, "Candidate commit message"),
            idempotencyKey: id,
        }).strict(),
        output: z.object({version: managedSkillVersion}).strict(),
    },
    "skills.release": {
        action: "skills.release",
        input: z.object({
            repositoryId: id,
            skillId: id,
            versionId: id,
            versionLabel: boundedText(64, "Version label"),
            idempotencyKey: id,
        }).strict(),
        output: z.object({version: managedSkillVersion}).strict(),
    },
    "jobs.get": {
        action: "jobs.read",
        input: z.object({jobId: id}).strict(),
        output: z.object({job: publicOperatorJob}).strict(),
    },
    "jobs.list": {
        action: "jobs.read",
        input: page.extend({status: operatorJobStatus.nullable().default(null)}).strict(),
        output: z.object({
            jobs: z.array(publicOperatorJob).max(MAX_PAGE_SIZE),
            nextCursor: cursor.nullable(),
        }).strict(),
    },
    "jobs.pause": {
        action: "jobs.control",
        input: z.object({jobId: id, idempotencyKey: id}).strict(),
        output: z.object({job: publicOperatorJob}).strict(),
    },
    "jobs.resume": {
        action: "jobs.control",
        input: z.object({jobId: id, idempotencyKey: id}).strict(),
        output: z.object({job: publicOperatorJob}).strict(),
    },
    "jobs.stop": {
        action: "jobs.control",
        input: z.object({jobId: id, idempotencyKey: id}).strict(),
        output: z.object({job: publicOperatorJob}).strict(),
    },
    "approvals.list": {
        action: "approvals.read",
        input: page.extend({
            jobId: id.nullable().default(null),
            status: z.enum(["pending", "approved", "rejected"]).nullable().default(null),
        }).strict(),
        output: z.object({
            approvals: z.array(publicApproval).max(MAX_PAGE_SIZE),
            nextCursor: cursor.nullable(),
        }).strict(),
    },
    "approvals.resolve": {
        action: "approvals.resolve",
        input: z.object({
            approvalId: id,
            decision: z.enum(["approve", "reject"]),
            idempotencyKey: id,
        }).strict(),
        output: z.object({
            approval: publicApproval,
            execution: z.object({
                status: boundedText(80, "Approval execution status"),
                jobId: id,
                stepId: id.optional(),
                approvalId: id.optional(),
                error: z.object({
                    code: boundedText(MAX_IDENTIFIER_LENGTH, "Approval execution error code"),
                    message: z.string().max(4_096),
                }).strict().optional(),
            }).strict(),
        }).strict(),
    },
    "curation.start": {
        action: "curation.write",
        input: z.object({
            datasetId: id,
            caseType: z.enum(["goodcase", "badcase"]),
            sourceThreadId: id,
            startItemId: id.nullable().default(null),
            startTurnId: id.nullable().default(null),
            startMessageOrdinal: z.number().int().min(0).nullable().default(null),
            endItemId: id.nullable().default(null),
            endTurnId: id.nullable().default(null),
            endMessageOrdinal: z.number().int().min(0).nullable().default(null),
            endMessagePosition: z.enum(["before", "at", "after"]).nullable().default(null),
            issueDescription: z.string().max(MAX_CONTROL_MESSAGE_LENGTH).default(""),
            modelId: id.nullable().default(null),
            effort: reasoningEffort.nullable().default(null),
            idempotencyKey: id,
        }).strict(),
        output: z.object({session: publicCurationSession}).strict(),
    },
    "curation.message": {
        action: "curation.write",
        input: z.object({
            sessionId: id,
            message: boundedText(MAX_CONTROL_MESSAGE_LENGTH, "Curation message"),
            idempotencyKey: id,
        }).strict(),
        output: z.object({session: publicCurationSession}).strict(),
    },
    "curation.save": {
        action: "curation.write",
        input: z.object({sessionId: id, idempotencyKey: id}).strict(),
        output: z.object({session: publicCurationSession, case: publicDatasetCase}).strict(),
    },
    "curation.discard": {
        action: "curation.write",
        input: z.object({sessionId: id, idempotencyKey: id}).strict(),
        output: z.object({session: publicCurationSession}).strict(),
    },
    "rubrics.publish": {
        action: "rubrics.publish",
        input: z.object({datasetId: id, sessionId: id, idempotencyKey: id}).strict(),
        output: z.object({version: z.any()}).strict(),
    },
    "installations.start": {
        action: "installations.execute",
        input: z.object({
            repositoryId: id,
            skillId: id,
            versionId: id,
            targets: z.array(installationTarget).min(1).max(MAX_INSTALLATION_TARGETS),
            idempotencyKey: id,
        }).strict(),
        output: z.object({
            installations: z.array(publicInstallation).min(1).max(MAX_INSTALLATION_TARGETS),
        }).strict(),
    },
    "installations.get": {
        action: "installations.read",
        input: z.object({installationId: id}).strict(),
        output: z.object({installation: publicInstallation}).strict(),
    },
    "installations.cancel": {
        action: "installations.execute",
        input: z.object({installationId: id, idempotencyKey: id}).strict(),
        output: z.object({installation: publicInstallation}).strict(),
    },
    "installations.inspect": {
        action: "installations.execute",
        input: z.object({installationId: id, idempotencyKey: id}).strict(),
        output: z.object({installation: publicInstallation}).strict(),
    },
    "installations.register": {
        action: "installations.register",
        input: installationRegistrationInput,
        output: z.object({
            accepted: z.boolean(),
            duplicate: z.boolean(),
        }).strict(),
    },
    "optimization.preflight": {
        action: "optimizations.read",
        input: optimizationConfigWithIdempotencyInput,
        output: publicOptimizationPreflight,
    },
    "optimization.start": {
        action: "optimizations.execute",
        input: optimizationConfigWithIdempotencyInput,
        output: z.object({run: publicOptimizationRun}).strict(),
    },
    "optimization.get": {
        action: "optimizations.read",
        input: z.object({runId: id}).strict(),
        output: z.object({run: publicOptimizationRun}).strict(),
    },
    "optimization.pause": {
        action: "optimizations.control",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({run: publicOptimizationRun}).strict(),
    },
    "optimization.resume": {
        action: "optimizations.control",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({run: publicOptimizationRun}).strict(),
    },
    "optimization.stop": {
        action: "optimizations.control",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({run: publicOptimizationRun}).strict(),
    },
    "optimization.submit_candidate": {
        action: "optimizations.execute",
        input: z.object({
            runId: id,
            message: boundedText(MAX_CANDIDATE_MESSAGE_LENGTH, "Candidate commit message"),
            idempotencyKey: id,
        }).strict(),
        output: z.object({accepted: z.object({runId: id, kind: z.literal("candidate")}).strict()}).strict(),
    },
    "optimization.submit_decision": {
        action: "optimizations.execute",
        input: z.object({
            runId: id,
            decision: optimizationDecisionInput,
            idempotencyKey: id,
        }).strict(),
        output: z.object({accepted: z.object({runId: id, kind: z.literal("decision")}).strict()}).strict(),
    },
    "optimization.report": {
        action: "optimizations.read",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({report: z.object({
            artifactId: id.nullable(),
            digest: boundedText(80, "Optimization report digest"),
            mediaType: z.literal("text/markdown; charset=utf-8"),
            preview: boundedText(32768, "Optimization report preview").optional(),
        }).strict()}).strict(),
    },
})

const CONTROL_METHODS = Object.freeze(Object.keys(METHOD_DEFINITIONS))
const OPERATOR_CONTROL_METHODS = Object.freeze(
    CONTROL_METHODS.filter((method) => METHOD_DEFINITIONS[method].operatorExposed),
)
const INSTALLATION_AGENT_CONTROL_METHODS = Object.freeze(["installations.register"])
const OPERATOR_CONTROL_ACTIONS = Object.freeze([
    ...new Set(OPERATOR_CONTROL_METHODS.map((method) => METHOD_DEFINITIONS[method].action)),
])
const CONTROL_ACTIONS = Object.freeze([
    ...new Set(CONTROL_METHODS.map((method) => METHOD_DEFINITIONS[method].action)),
])

const validationPathSegment = z.union([
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u),
    z.number().int().min(0).max(1_000_000),
])

const validationErrorDetails = z.object({
    method: z.enum(CONTROL_METHODS),
    issues: z.array(z.object({
        path: z.array(validationPathSegment).max(16),
    }).strict()).min(1).max(20),
}).strict()

const forbiddenErrorDetails = z.object({
    action: z.enum(CONTROL_ACTIONS),
    retryAfterMs: z.number().int().min(0).max(86_400_000).optional(),
    scopes: z.array(z.enum(CONTROL_ACTIONS)).max(MAX_PUBLIC_DETAIL_ITEMS).optional(),
}).strict()

const notFoundErrorDetails = z.object({
    resource: z.enum([
        "raw_case",
        "evaluation_run",
        "dataset",
        "case",
        "skill",
        "runtime",
        "model",
        "job",
        "approval",
        "curation_session",
        "rubric_session",
        "installation",
        "version",
    ]),
}).strict()

const idempotencyConflictDetails = z.object({
    method: z.enum(CONTROL_METHODS),
}).strict()

const resourceChangedDetails = z.object({
    resource: z.enum([
        "dataset",
        "case",
        "curation_session",
        "rubric_session",
        "skill",
        "version",
        "installation",
    ]),
}).strict()

const approvalRequiredDetails = z.object({
    action: z.enum(CONTROL_ACTIONS),
    reason: z.enum([
        "destructive_action",
        "release",
        "installation",
        "rubric_publish",
        "budget_expansion",
    ]),
    approvalId: id.optional(),
    jobId: id.optional(),
    stepId: id.optional(),
}).strict().superRefine((details, context) => {
    const identityCount = [details.approvalId, details.jobId, details.stepId]
        .filter((value) => value !== undefined)
        .length
    if (identityCount !== 0 && identityCount !== 3) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Approval identity must be complete",
        })
    }
})

const PUBLIC_CONTROL_ERROR_DEFINITIONS = Object.freeze({
    UNKNOWN_CONTROL_METHOD: Object.freeze({
        message: "Unknown control method",
        retryable: false,
        details: z.null(),
    }),
    INVALID_ARGUMENT: Object.freeze({
        message: "Invalid control input",
        retryable: false,
        details: validationErrorDetails,
    }),
    INVALID_RESULT: Object.freeze({
        message: "Invalid control result",
        retryable: false,
        details: validationErrorDetails,
    }),
    FORBIDDEN: Object.freeze({
        message: "Control action is forbidden",
        retryable: false,
        details: forbiddenErrorDetails,
    }),
    NOT_FOUND: Object.freeze({
        message: "Control object was not found",
        retryable: false,
        details: notFoundErrorDetails,
    }),
    IDEMPOTENCY_CONFLICT: Object.freeze({
        message: "Idempotency key conflicts with another request",
        retryable: false,
        details: idempotencyConflictDetails,
    }),
    RESOURCE_CHANGED: Object.freeze({
        message: "Control resource changed after approval",
        retryable: false,
        details: resourceChangedDetails,
    }),
    CONTROL_BUSY: Object.freeze({
        message: "Control operation is busy",
        retryable: true,
        details: z.null(),
    }),
    IDEMPOTENCY_CAPACITY: Object.freeze({
        message: "Idempotency capacity is temporarily unavailable",
        retryable: true,
        details: z.null(),
    }),
    CAPABILITY_INVALID: Object.freeze({
        message: "Control capability is invalid",
        retryable: false,
        details: z.null(),
    }),
    CAPABILITY_REVOKED: Object.freeze({
        message: "Control capability is revoked",
        retryable: false,
        details: z.null(),
    }),
    CAPABILITY_EXPIRED: Object.freeze({
        message: "Control capability is expired",
        retryable: false,
        details: z.null(),
    }),
    CAPABILITY_SESSION_MISMATCH: Object.freeze({
        message: "Control capability belongs to another Operator session",
        retryable: false,
        details: z.null(),
    }),
    CAPABILITY_ACTION_NOT_GRANTED: Object.freeze({
        message: "Control capability does not grant this action",
        retryable: false,
        details: z.null(),
    }),
    APPROVAL_REQUIRED: Object.freeze({
        message: "Control action requires approval",
        retryable: false,
        details: approvalRequiredDetails,
    }),
})

const PUBLIC_CONTROL_ERROR_CODES = Object.freeze(Object.keys(PUBLIC_CONTROL_ERROR_DEFINITIONS))
const trustedPublicErrors = new WeakMap()
const fallbackPublicError = Object.freeze({
    code: "CONTROL_ERROR",
    message: "Control operation failed",
    retryable: false,
    details: null,
})

function copyPublicDetails(details) {
    return details === null ? null : JSON.parse(JSON.stringify(details))
}

function createPublicControlError(code, {details = null, internalMessage, cause} = {}) {
    if (!Object.hasOwn(PUBLIC_CONTROL_ERROR_DEFINITIONS, code)) {
        throw new TypeError("Unknown public control error code")
    }
    const definition = PUBLIC_CONTROL_ERROR_DEFINITIONS[code]
    const safeDetails = definition.details.parse(details)
    const error = new Error(
        typeof internalMessage === "string" ? internalMessage : definition.message,
        cause === undefined ? undefined : {cause},
    )
    error.code = code
    error.retryable = definition.retryable
    error.details = copyPublicDetails(safeDetails)
    trustedPublicErrors.set(error, Object.freeze({
        code,
        message: definition.message,
        retryable: definition.retryable,
        details: safeDetails,
    }))
    return error
}

function controlDefinition(method) {
    if (Object.hasOwn(METHOD_DEFINITIONS, method)) return METHOD_DEFINITIONS[method]
    throw createPublicControlError("UNKNOWN_CONTROL_METHOD", {
        internalMessage: `Unknown control method: ${String(method).slice(0, MAX_IDENTIFIER_LENGTH)}`,
    })
}

function validationDetails(error, method) {
    return {
        method,
        issues: error.issues.slice(0, 20).map((issue) => ({
            path: issue.path.slice(0, 16).filter((segment) =>
                (typeof segment === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(segment)) ||
                (Number.isSafeInteger(segment) && segment >= 0 && segment <= 1_000_000),
            ),
        })),
    }
}

function parseWithSchema(schema, value, {method, code}) {
    try {
        return schema.parse(value)
    } catch (error) {
        if (error instanceof z.ZodError) {
            throw createPublicControlError(code, {
                details: validationDetails(error, method),
                internalMessage: error.message,
                cause: error,
            })
        }
        throw error
    }
}

function parseControlInput(method, input) {
    const definition = controlDefinition(method)
    return parseWithSchema(definition.input, input, {method, code: "INVALID_ARGUMENT"})
}

function parseControlOutput(method, output) {
    const definition = controlDefinition(method)
    return parseWithSchema(definition.output, output, {method, code: "INVALID_RESULT"})
}

function publicControlError(error) {
    const trusted =
        (typeof error === "object" && error !== null) || typeof error === "function"
            ? trustedPublicErrors.get(error)
            : null
    const source = trusted ?? fallbackPublicError
    return {
        code: source.code,
        message: source.message,
        retryable: source.retryable,
        details: copyPublicDetails(source.details),
    }
}

module.exports = {
    CONTROL_METHODS,
    DEFAULT_PAGE_LIMIT,
    INSTALLATION_AGENT_CONTROL_METHODS,
    MAX_PAGE_SIZE,
    METHOD_DEFINITIONS,
    OPERATOR_CONTROL_ACTIONS,
    OPERATOR_CONTROL_METHODS,
    PUBLIC_CONTROL_ERROR_CODES,
    controlDefinition,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
    parseControlInput,
    parseControlOutput,
    publicControlError,
}
