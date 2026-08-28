import {useEffect} from "react"

import {reasoningEffortsFor} from "./model-catalog.cjs"

export interface RuntimeModel {
    id?: string
    model?: string
    displayName?: string
    reasoningEfforts?: Array<string | {
        reasoningEffort?: string
        effort?: string
        id?: string
        value?: string
        displayName?: string
    }>
    supportedReasoningEfforts?: Array<string | {
        reasoningEffort?: string
        effort?: string
        id?: string
        value?: string
        displayName?: string
    }>
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
