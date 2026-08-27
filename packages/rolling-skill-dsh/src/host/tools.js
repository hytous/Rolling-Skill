import {randomUUID} from "node:crypto"

import {defineTool} from "@deepseek-ai/dsh-tools"

const PRIVATE_ERROR = /(?:[A-Za-z]:[\\/][^\s]+|\/(?:[^\s/]+\/)+[^\s]+|(?:token|secret|credential|password)\s*[=:]\s*[^\s]+)/giu

function jsonCopy(value) {
    return JSON.parse(JSON.stringify(value))
}

function exactKeys(value, allowed) {
    const unknown = Object.keys(value ?? {}).find((key) => !allowed.has(key))
    if (unknown) throw new Error(`Rolling Skill tool received an unknown field: ${unknown}`)
}

function cancelled(signal) {
    if (!signal?.aborted) return
    throw Object.assign(new Error("Rolling Skill tool was cancelled"), {code: "ABORTED"})
}

function safeError(error) {
    const message = String(error?.message ?? error ?? "Rolling Skill tool failed")
        .replace(PRIVATE_ERROR, "[private value omitted]")
        .slice(0, 2_000)
    return Object.assign(new Error(message || "Rolling Skill tool failed"), {
        code: typeof error?.code === "string" ? error.code.slice(0, 100) : "ROLLING_SKILL_TOOL_FAILED",
    })
}

async function dispatch(application, method, input, signal) {
    cancelled(signal)
    try {
        const value = await application.dispatch(method, input)
        cancelled(signal)
        return jsonCopy(value)
    } catch (error) {
        throw safeError(error)
    }
}

function closedDefinition(options, allowed) {
    const definition = defineTool(options)
    definition.parameters.additionalProperties = false
    const execute = definition.execute
    definition.execute = async (args, exec) => {
        exactKeys(args, allowed)
        return execute(args, exec)
    }
    return definition
}

function text(value) {
    return [{type: "text", text: value}]
}

export function createRollingSkillTools(application) {
    return [
        closedDefinition({
            name: "rolling_skill_status",
            description: "Read Rolling Skill Dataset, Case, Evaluation, Operator, and automatic-capture status.",
            parameters: {},
            output: {
                schema: {type: "json"},
                render: (_args, value) => text([
                    "Rolling Skill status",
                    `Datasets: ${value?.counts?.datasets ?? 0}`,
                    `Cases: ${value?.counts?.cases ?? 0}`,
                    `Raw Cases: ${value?.counts?.rawCases ?? 0}`,
                ].join(" · ")),
            },
            isConcurrencySafe: () => true,
            execute: (_args, exec) => dispatch(application, "dashboard.get", {}, exec.signal),
        }, new Set()),
        closedDefinition({
            name: "rolling_skill_add_raw_case",
            description: "Add one user question to Rolling Skill Raw Cases for later curation.",
            parameters: {
                question: {type: "string", required: true, description: "The complete user question."},
                skillName: {type: "string", description: "Skill name associated with the question."},
                note: {type: "string", description: "Optional short curation note."},
            },
            output: {
                schema: {type: "json"},
                render: (_args, value) => text(`Raw Case recorded${value?.id ? `: ${value.id}` : ""}.`),
            },
            execute: async (args, exec) => {
                const catalog = await dispatch(application, "skills.catalog", {}, exec.signal)
                const requestedName = String(args.skillName || "rolling-skill").trim().toLocaleLowerCase("en-US")
                const matches = (catalog.skills ?? []).filter((skill) =>
                    skill.status === "valid" &&
                    String(skill.name ?? "").trim().toLocaleLowerCase("en-US") === requestedName,
                )
                if (matches.length !== 1) {
                    throw new Error(matches.length === 0
                        ? `No valid managed Skill named ${args.skillName || "rolling-skill"}`
                        : `Managed Skill name ${args.skillName || "rolling-skill"} is ambiguous`)
                }
                return dispatch(application, "rawCases.add", {
                    question: args.question,
                    repositoryId: matches[0].repositoryId,
                    skillId: matches[0].id,
                    note: args.note || "",
                }, exec.signal)
            },
        }, new Set(["question", "skillName", "note"])),
        closedDefinition({
            name: "rolling_skill_start_evaluation",
            description: "Start a Rolling Skill evaluation for one Dataset and an exact installed Runtime identity.",
            parameters: {
                datasetId: {type: "string", required: true, description: "Dataset id."},
                runtimeId: {type: "string", required: true, description: "Exact Runtime id from Rolling Skill inventory."},
                modelId: {type: "string", description: "Optional Runtime model id."},
                effort: {type: "string", description: "Optional reasoning effort."},
            },
            output: {
                schema: {type: "json"},
                render: (_args, value) => text(`Rolling Skill evaluation ${value?.id ?? "started"}: ${value?.status ?? "queued"}.`),
            },
            execute: (args, exec) => dispatch(application, "evaluations.start", {
                datasetId: args.datasetId,
                selectionMode: "dataset",
                activationMode: "explicit",
                targets: [{
                    runtimeId: args.runtimeId,
                    modelId: args.modelId || null,
                    effort: args.effort || null,
                }],
                judge: {
                    runtimeId: args.runtimeId,
                    modelId: args.modelId || null,
                    effort: args.effort || null,
                },
                idempotencyKey: `dsh-tool-${randomUUID()}`,
            }, exec.signal),
        }, new Set(["datasetId", "runtimeId", "modelId", "effort"])),
        closedDefinition({
            name: "rolling_skill_run_capture",
            description: "Run one due or manual Rolling Skill conversation-capture pass with the configured Runtime.",
            parameters: {
                slot: {type: "string", description: "Optional stable schedule slot; omit for a manual run."},
            },
            output: {
                schema: {type: "json"},
                render: (_args, value) => text(`Rolling Skill capture ${value?.status ?? "completed"}.`),
            },
            execute: (args, exec) => dispatch(application, "automatic.runOnce", {
                slot: args.slot || "manual",
                idempotencyKey: `dsh-tool-${randomUUID()}`,
            }, exec.signal),
        }, new Set(["slot"])),
    ]
}

export function registerRollingSkillTools(ctx, application) {
    const disposers = createRollingSkillTools(application).map((definition) => (
        ctx.tools.register(definition)
    ))
    return () => {
        for (const dispose of disposers.reverse()) dispose()
    }
}
