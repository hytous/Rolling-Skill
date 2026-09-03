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
    disabled = false,
}: {
    label: string
    runtimeDefaultLabel: string
    models: RuntimeModel[]
    modelId: string
    value: string
    onChange: (value: string) => void
    disabled?: boolean
}) {
    const efforts = reasoningEffortsFor(models, selectedModelId)
    const preserveCurrent = value && !efforts.some((effort) => effort.id === value)
    return (
        <label className="rolling-skill-field">
            <span>{label}</span>
            <select className="rolling-skill-select" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
                <option value="">{runtimeDefaultLabel}</option>
                {preserveCurrent ? <option value={value}>{value}</option> : null}
                {efforts.map((effort) => <option key={effort.id} value={effort.id}>{effort.label}</option>)}
            </select>
        </label>
    )
}
