const {isAbsolute} = require("node:path")
const {
    LEGACY_BUDGET_FIELDS,
    isIterationBudget,
    isUnboundedBudget,
    normalizeOperatorBudget,
} = require("./operator-budget.cjs")

const OPERATOR_PROTOCOL = "rolling-skill-operator/v1"
const MAX_OBJECTIVE_LENGTH = 32_768
const MAX_IDENTIFIER_LENGTH = 300
const MAX_CLI_PATH_LENGTH = 8_192
const SCOPE_FIELDS = Object.freeze([
    "skillIds",
    "datasetIds",
    "runtimeIds",
    "repositoryIds",
])
const TRANSPORT_KINDS = new Set(["codex-dynamic", "acp-mcp", "dsh-mcp", "cli"])

function plainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function requiredText(value, label, maximum = MAX_IDENTIFIER_LENGTH) {
    if (
        typeof value !== "string" || value.length === 0 || value.length > maximum ||
        value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)
    ) throw new TypeError(`${label} is invalid`)
    return value
}

function objectiveText(value) {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_OBJECTIVE_LENGTH) {
        throw new TypeError("Operator objective is required and bounded")
    }
    return value
}

function contextText(value) {
    if (
        typeof value !== "string" || value.length === 0 || value.length > 128 * 1_024 ||
        /[\u0000\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    ) throw new TypeError("Operator context is invalid")
    return value
}

function stringArray(value, label) {
    if (!Array.isArray(value) || value.length > 4_096) throw new TypeError(`${label} must be bounded`)
    const normalized = value.map((entry) => requiredText(entry, label))
    if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} contains duplicates`)
    return normalized
}

function normalizeScope(value) {
    if (!plainObject(value)) throw new TypeError("Operator scope must be a plain object")
    const scope = {}
    for (const field of SCOPE_FIELDS) scope[field] = stringArray(value[field] ?? [], field)
    return scope
}

function normalizeTransport(value) {
    if (!plainObject(value) || value.ready !== true || !TRANSPORT_KINDS.has(value.kind)) {
        throw new TypeError("Operator transport must be a frozen ready transport")
    }
    const transport = {kind: value.kind}
    if (value.kind === "cli") {
        if (
            typeof value.executablePath !== "string" ||
            value.executablePath.length > MAX_CLI_PATH_LENGTH ||
            !isAbsolute(value.executablePath) || /[\u0000\r\n]/u.test(value.executablePath)
        ) throw new TypeError("Operator CLI Tool path must be absolute")
        transport.command = `${value.executablePath} invoke <method> --params <json>`
    }
    return transport
}

function protocolSnapshot(context) {
    if (!plainObject(context)) throw new TypeError("Operator context must be a plain object")
    return {
        actions: stringArray(context.actions, "Operator actions"),
        scope: normalizeScope(context.scope),
        budget: normalizeOperatorBudget(context.budget),
        transport: normalizeTransport(context.transport),
    }
}

function buildOperatorInstructions(context) {
    const snapshot = protocolSnapshot(context)
    const budgetInstruction = isIterationBudget(snapshot.budget)
        ? `The Job must finish or pause within the frozen ${snapshot.budget.maxIterations} Operator iterations. The iteration ceiling cannot be expanded during this task.`
        : isUnboundedBudget(snapshot.budget)
            ? "The Job has no Agent-turn limit. Continue until the objective is complete, the user stops it, or a technical failure requires recovery. Do not request a runtime budget expansion."
            : "The Job budget is frozen. If it is insufficient, request a budget expansion and wait for approval."
    return [
        "Rolling Skill Operator Protocol v1",
        "",
        "You operate Rolling Skill only through the provided scoped Tool transport.",
        "A durable Job is the unit of work. Use child Jobs for bounded actions and rely on their persisted status after interruption or restart.",
        "Large or durable outputs are artifacts: refer to them by artifact ID instead of copying full bodies into chat.",
        "An approval is a hard execution gate. Explain the proposed action and wait; never claim an approval or expand authority yourself.",
        "Never directly read, edit, or write Rolling Skill data files. Do not bypass the Tool by changing local JSON, databases, repositories, or runtime state.",
        "The capability scope is frozen for this session. Do not infer IDs or act outside it.",
        budgetInstruction,
        "The Tool transport is frozen for this session. Do not switch transports or fall back during a turn.",
        "When a Tool response contains a child jobId, briefly state that the child Job is running and end the turn. Wait for an environment completion message before continuing.",
        "",
        `Frozen actions: ${JSON.stringify(snapshot.actions)}`,
        `Frozen scope: ${JSON.stringify(snapshot.scope)}`,
        `Frozen budget: ${JSON.stringify(snapshot.budget)}`,
        `Frozen transport: ${JSON.stringify(snapshot.transport)}`,
    ].join("\n")
}

function buildOperatorInitialInput(context, objective) {
    return [
        {
            type: "operatorContext",
            protocol: OPERATOR_PROTOCOL,
            text: buildOperatorInstructions(context),
        },
        {type: "text", text: objectiveText(objective)},
    ]
}

function serializeOperatorInput(input) {
    if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
        throw new TypeError("Operator Runtime input must be a bounded array")
    }
    return input.map((part) => {
        if (!plainObject(part)) throw new TypeError("Operator Runtime input part is invalid")
        if (part.type === "operatorContext") {
            if (part.protocol !== OPERATOR_PROTOCOL) throw new TypeError("Operator protocol is unsupported")
            return {type: "text", text: `[Environment context — ${OPERATOR_PROTOCOL}]\n${contextText(part.text)}`}
        }
        if (part.type === "text") return {type: "text", text: objectiveText(part.text)}
        throw new TypeError("Operator Runtime input part is unsupported")
    })
}

module.exports = {
    BUDGET_FIELDS: LEGACY_BUDGET_FIELDS,
    MAX_OBJECTIVE_LENGTH,
    OPERATOR_PROTOCOL,
    SCOPE_FIELDS,
    buildOperatorInitialInput,
    buildOperatorInstructions,
    protocolSnapshot,
    serializeOperatorInput,
}
