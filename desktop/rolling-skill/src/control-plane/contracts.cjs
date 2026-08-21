const {z} = require("zod")

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
const MAX_PUBLIC_MESSAGE_LENGTH = 4_000
const MAX_PUBLIC_DETAIL_LENGTH = 1_000
const MAX_PUBLIC_DETAIL_ITEMS = 50

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

const skillReferenceInput = z.object({
    name: boundedText(MAX_IDENTIFIER_LENGTH, "Skill name"),
    path: z.string().max(MAX_SKILL_PATH_LENGTH).optional(),
}).strict()

const rawCaseSource = z.object({
    kind: boundedText(MAX_IDENTIFIER_LENGTH, "Raw Case source kind"),
}).strict()

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
        [name]: z.array(z.any()),
        nextCursor: cursor.nullable(),
    }).strict()
}

const METHOD_DEFINITIONS = Object.freeze({
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
        output: pageResult("rawCases"),
    },
    "raw_cases.enqueue": {
        action: "raw_cases.write",
        input: z.object({
            cases: z.array(rawCaseInput).min(1).max(MAX_RAW_CASE_BATCH_SIZE),
            idempotencyKey: id,
        }).strict(),
        output: z.object({
            created: z.array(z.any()),
            duplicates: z.array(z.any()),
            rejected: z.array(z.any()),
        }).strict(),
    },
    "raw_cases.update": {
        action: "raw_cases.write",
        input: z.object({id, changes: rawCaseChanges, idempotencyKey: id}).strict(),
        output: z.object({rawCase: z.any()}).strict(),
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
    "skills.list": {
        action: "skills.read",
        input: page.strict(),
        output: pageResult("skills"),
    },
    "skills.get": {
        action: "skills.read",
        input: z.object({skillId: id}).strict(),
        output: z.object({skill: z.any()}).strict(),
    },
})

const CONTROL_METHODS = Object.freeze(Object.keys(METHOD_DEFINITIONS))

function controlDefinition(method) {
    if (Object.hasOwn(METHOD_DEFINITIONS, method)) return METHOD_DEFINITIONS[method]
    const error = new Error(`Unknown control method: ${String(method).slice(0, MAX_IDENTIFIER_LENGTH)}`)
    error.code = "UNKNOWN_CONTROL_METHOD"
    error.retryable = false
    throw error
}

function validationDetails(error, method) {
    return {
        method,
        issues: error.issues.slice(0, 20).map((issue) => {
            const path = issue.path.length ? `${issue.path.join(".")}: ` : ""
            return `${path}${issue.message}`.slice(0, MAX_PUBLIC_DETAIL_LENGTH)
        }),
    }
}

function parseWithSchema(schema, value, {method, code}) {
    try {
        return schema.parse(value)
    } catch (error) {
        if (error instanceof z.ZodError) {
            error.code = code
            error.retryable = false
            error.details = validationDetails(error, method)
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

function publicDetailValue(value) {
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "string") return value.slice(0, MAX_PUBLIC_DETAIL_LENGTH)
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (!Array.isArray(value) || value.length > MAX_PUBLIC_DETAIL_ITEMS) return undefined
    const items = value.map(publicDetailValue)
    return items.every((item) => item !== undefined && !Array.isArray(item)) ? items : undefined
}

function publicDetails(details) {
    if (!details || typeof details !== "object" || Array.isArray(details)) return null
    try {
        const prototype = Object.getPrototypeOf(details)
        if (prototype !== Object.prototype && prototype !== null) return null
        const result = {}
        for (const key of Object.keys(details)) {
            if (Object.keys(result).length >= MAX_PUBLIC_DETAIL_ITEMS) break
            if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key)) continue
            if (/(?:authorization|cause|error|password|secret|stack|token)/iu.test(key)) continue
            const value = details[key]
            const safeValue = publicDetailValue(value)
            if (safeValue !== undefined) result[key] = safeValue
        }
        return Object.keys(result).length ? result : null
    } catch {
        return null
    }
}

function publicControlError(error) {
    let code = "CONTROL_ERROR"
    let message = "Control operation failed"
    let retryable = false
    let details = null
    try {
        const candidateCode = error?.code
        const candidateMessage = error?.message
        const candidateRetryable = error?.retryable
        const candidateDetails = error?.details
        if (
            typeof candidateCode === "string" &&
            /^[A-Z][A-Z0-9_]{0,63}$/u.test(candidateCode)
        ) {
            code = candidateCode
        }
        if (typeof candidateMessage === "string" && candidateMessage) {
            message = candidateMessage.slice(0, MAX_PUBLIC_MESSAGE_LENGTH)
        }
        retryable = candidateRetryable === true
        details = publicDetails(candidateDetails)
    } catch {
        // Keep the fixed safe defaults when error metadata uses throwing accessors.
    }
    return {code, message, retryable, details}
}

module.exports = {
    CONTROL_METHODS,
    DEFAULT_PAGE_LIMIT,
    MAX_PAGE_SIZE,
    METHOD_DEFINITIONS,
    controlDefinition,
    decodeCursor,
    encodeCursor,
    parseControlInput,
    parseControlOutput,
    publicControlError,
}
