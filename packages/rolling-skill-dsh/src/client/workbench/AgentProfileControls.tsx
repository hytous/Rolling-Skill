import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect, type RuntimeModel} from "./ModelEffortSelect"

export function AgentProfileControls({runtimeId, modelId, effort, disabled = false, modelPlaceholder, effortPlaceholder, t, onModelChange, onEffortChange}: {
    runtimeId?: string | null
    modelId: string
    effort: string
    disabled?: boolean
    modelPlaceholder?: string
    effortPlaceholder?: string
    t: Translate
    onModelChange: (value: string) => void
    onEffortChange: (value: string) => void
}) {
    const [models, setModels] = useState<RuntimeModel[]>([])
    useEffect(() => {
        if (!runtimeId) return
        const controller = new AbortController()
        setModels([])
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId}, controller.signal)
            .then((items) => {if (!controller.signal.aborted) setModels(items)})
            .catch(() => { /* Catalog failure must not overwrite the saved profile. */ })
        return () => controller.abort()
    }, [runtimeId])
    const preserveCurrent = modelId && !models.some((model) => (model.id ?? model.model) === modelId)
    return <div className="rolling-skill-curation-model-controls">
        <label className="rolling-skill-field"><span>{t("model")}</span>
            <select className="rolling-skill-select" value={modelId} disabled={disabled} onChange={(event) => onModelChange(event.target.value)}>
                <option value="">{modelPlaceholder ?? t("configuredDefault")}</option>
                {preserveCurrent ? <option value={modelId}>{modelId}</option> : null}
                {models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}
            </select>
        </label>
        <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={effortPlaceholder ?? t("configuredDefault")} models={models} modelId={modelId} value={effort} disabled={disabled} onChange={onEffortChange}/>
    </div>
}
