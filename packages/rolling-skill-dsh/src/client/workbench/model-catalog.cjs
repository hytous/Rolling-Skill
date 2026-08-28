function modelId(model) {
    return model?.id ?? model?.model ?? ""
}

function resolveModelId(models, requested) {
    const requestedId = requested ?? ""
    if (!Array.isArray(models) || models.length === 0) return ""
    return models.some((model) => modelId(model) === requestedId)
        ? requestedId
        : modelId(models[0])
}

function normalizeEffort(value) {
    if (typeof value === "string") return {id: value, label: value}
    const id = value?.reasoningEffort ?? value?.effort ?? value?.id ?? value?.value ?? ""
    return {id, label: value?.displayName ?? id}
}

function reasoningEffortsFor(models, selectedModelId) {
    const selected = (Array.isArray(models) ? models : [])
        .find((model) => modelId(model) === selectedModelId)
    const values = [
        ...(Array.isArray(selected?.reasoningEfforts) ? selected.reasoningEfforts : []),
        ...(Array.isArray(selected?.supportedReasoningEfforts)
            ? selected.supportedReasoningEfforts
            : []),
    ]
    const found = new Map()
    for (const value of values) {
        const effort = normalizeEffort(value)
        if (effort.id && !found.has(effort.id)) found.set(effort.id, effort)
    }
    return [...found.values()]
}

function resolveReasoningEffort(models, selectedModelId, requested) {
    const requestedId = requested ?? ""
    return reasoningEffortsFor(models, selectedModelId)
        .some((effort) => effort.id === requestedId)
        ? requestedId
        : ""
}

module.exports = {reasoningEffortsFor, resolveModelId, resolveReasoningEffort}
