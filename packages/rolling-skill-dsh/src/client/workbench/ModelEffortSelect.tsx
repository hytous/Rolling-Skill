import {useEffect} from "react"

export interface RuntimeModel {
    id?: string
    model?: string
    displayName?: string
    reasoningEfforts?: Array<{
        reasoningEffort?: string
        id?: string
        displayName?: string
    }>
}

function modelId(model: RuntimeModel) {
    return model.id ?? model.model ?? ""
}

export function reasoningEffortsFor(models: RuntimeModel[], selectedModelId: string) {
    const selected = models.find((model) => modelId(model) === selectedModelId)
    return (selected?.reasoningEfforts ?? [])
        .map((effort) => ({
            id: effort.reasoningEffort ?? effort.id ?? "",
            label: effort.displayName ?? effort.reasoningEffort ?? effort.id ?? "",
        }))
        .filter((effort) => effort.id)
}

export function ModelEffortSelect({
    label,
    runtimeDefaultLabel,
    models,
    modelId: selectedModelId,
    value,
    onChange,
}: {
    label: string
    runtimeDefaultLabel: string
    models: RuntimeModel[]
    modelId: string
    value: string
    onChange: (value: string) => void
}) {
    const efforts = reasoningEffortsFor(models, selectedModelId)
    useEffect(() => {
        if (value && !efforts.some((effort) => effort.id === value)) onChange("")
    }, [selectedModelId, value, efforts.map((effort) => effort.id).join("\u0000")])
    return (
        <label className="rolling-skill-field">
            <span>{label}</span>
            <select className="rolling-skill-select" value={value} onChange={(event) => onChange(event.target.value)}>
                <option value="">{runtimeDefaultLabel}</option>
                {efforts.map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
            </select>
        </label>
    )
}
