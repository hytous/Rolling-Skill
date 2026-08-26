const {
    snapshotSkillEvidence,
} = require("../../../desktop/rolling-skill/src/evaluation-skill-evidence.cjs")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 200) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function optionalText(value, label, maximum = 200) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maximum)
}

function configuration(runtimeServices, value, label) {
    const runtimeId = requiredText(value?.runtimeId, `${label} Runtime id`, 500)
    const descriptor = runtimeServices.descriptor(runtimeId)
    return {
        ...descriptor,
        modelId: optionalText(value.modelId, `${label} model id`),
        effort: optionalText(value.effort, `${label} reasoning effort`),
    }
}

function createEvaluationServices({
    store,
    runtimeServices,
    runner,
    snapshotSkill = snapshotSkillEvidence,
    onChanged = () => {},
}) {
    if (!store || !runtimeServices || !runner) {
        throw new Error("Rolling Skill evaluation dependencies are required")
    }

    async function start(input = {}) {
        const datasetId = requiredText(input.datasetId, "Dataset id")
        const dataset = store.getDataset(datasetId)
        const targets = Array.isArray(input.targets) ? input.targets : []
        if (targets.length < 1 || targets.length > 20) {
            throw new Error("At least one evaluation Runtime is required")
        }
        const runtimeConfigurations = targets.map((target) =>
            configuration(runtimeServices, target, "Evaluation"),
        )
        const judgeConfiguration = configuration(runtimeServices, input.judge, "Judge")
        const skillEvidence = snapshotSkill(dataset.skillReference)
        const run = store.createEvaluationRun({
            datasetId,
            caseIds: Array.isArray(input.caseIds) ? input.caseIds : [],
            selectionMode: input.selectionMode ?? "dataset",
            activationMode: input.activationMode ?? "explicit",
            skillEvidence,
            judgeProfile: {
                runtimePolicy: "active",
                modelId: judgeConfiguration.modelId,
                effort: judgeConfiguration.effort,
            },
            judgeConfiguration,
            runtimeConfigurations,
        })
        Promise.resolve(runner.run(run)).catch((error) => {
            try {
                store.updateEvaluationRun?.(run.id, {
                    status: "failed",
                    completedAt: new Date().toISOString(),
                })
                onChanged({runId: run.id, status: "failed", error: error?.message ?? String(error)})
            } catch {}
        })
        onChanged({runId: run.id, status: run.status})
        return copy(run)
    }

    function list({datasetId = null} = {}) {
        return copy(store.listEvaluationRunSummaries(datasetId))
    }

    function get({runId} = {}) {
        return copy(store.getEvaluationRun(requiredText(runId, "Evaluation Run id")))
    }

    async function cancel({runId} = {}) {
        const id = requiredText(runId, "Evaluation Run id")
        const value = await runner.cancel(id)
        onChanged({runId: id, status: "cancelled"})
        return copy(value)
    }

    return Object.freeze({cancel, get, list, start})
}

module.exports = {createEvaluationServices}
