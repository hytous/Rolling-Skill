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
    name: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name"),
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

function pageResult(name) {
    return z.object({
        [name]: z.array(z.any()).max(MAX_PAGE_SIZE),
        nextCursor: cursor.nullable(),
    }).strict()
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
    risk: z.string().max(16_384).optional(),
    scope: z.record(z.string(), z.any()).optional(),
    proposedMutation: z.record(z.string(), z.any()).optional(),
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

function freezeMethodDefinitions(definitions) {
    for (const definition of Object.values(definitions)) Object.freeze(definition)
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
        output: pageResult("datasets"),
    },
    "datasets.get": {
        action: "datasets.read",
        input: z.object({datasetId: id, includeCases: z.boolean().default(false)}).strict(),
        output: z.object({dataset: z.any(), cases: z.array(z.any()).optional()}).strict(),
    },
    "datasets.create": {
        action: "datasets.write",
        input: z.object({
            name: boundedText(500, "Dataset name"),
            repositoryId: id,
            skillId: id,
            idempotencyKey: id,
        }).strict(),
        output: z.object({dataset: z.any()}).strict(),
    },
    "datasets.delete": {
        action: "datasets.delete",
        input: z.object({datasetId: id, idempotencyKey: id}).strict(),
        output: z.object({dataset: z.any()}).strict(),
    },
    "datasets.delete_case": {
        action: "datasets.delete",
        input: z.object({datasetId: id, caseId: id, idempotencyKey: id}).strict(),
        output: z.object({case: z.any()}).strict(),
    },
    "evaluations.list": {
        action: "evaluations.read",
        input: page.extend({datasetId: id.nullable().default(null)}).strict(),
        output: pageResult("runs"),
    },
    "evaluations.get": {
        action: "evaluations.read",
        input: z.object({runId: id}).strict(),
        output: z.object({run: z.any()}).strict(),
    },
    "evaluations.start": {
        action: "evaluations.execute",
        input: strictEvaluationStart(),
        output: z.object({run: z.any()}).strict(),
    },
    "evaluations.cancel": {
        action: "evaluations.execute",
        input: z.object({runId: id, idempotencyKey: id}).strict(),
        output: z.object({run: z.any()}).strict(),
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
                result: z.any().optional(),
                error: z.any().optional(),
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
        output: z.object({session: publicCurationSession, case: z.any()}).strict(),
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
})

const CONTROL_METHODS = Object.freeze(Object.keys(METHOD_DEFINITIONS))
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
    MAX_PAGE_SIZE,
    METHOD_DEFINITIONS,
    PUBLIC_CONTROL_ERROR_CODES,
    controlDefinition,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
    parseControlInput,
    parseControlOutput,
    publicControlError,
}
