import type {Translate} from "../locale"
import {ActionButton as Button} from "./ActionButton"
import {AgentProfileControls} from "./AgentProfileControls"
import type {RuntimeDescriptor} from "./RuntimeSelect"

export interface OptimizationProfile {runtimeId: string; modelId: string; effort: string}
export interface OptimizationTuning {
    activationMode: "automatic" | "explicit"
    mode: "adaptive" | "fixed"
    maxEpochs: string
    maxMinutes: string
    patience: string
    minimumImprovement: string
    maxTurns: string
    minimumScore: string
    minimumPassRate: string
    requireCriticalCases: boolean
}
export const initialOptimizationTuning: OptimizationTuning = {
    activationMode: "automatic", mode: "adaptive", maxEpochs: "3", maxMinutes: "60",
    patience: "2", minimumImprovement: "0.5", maxTurns: "100", minimumScore: "90",
    minimumPassRate: "90", requireCriticalCases: true,
}

export function OptimizationRuntimeFields({label, profile, runtimes, t, onChange}: {
    label: string; profile: OptimizationProfile; runtimes: RuntimeDescriptor[]; t: Translate
    onChange: (profile: OptimizationProfile) => void
}) {
    return <fieldset className="rolling-skill-subpanel">
        <legend>{label}</legend>
        <div className="rolling-skill-field">
            <select aria-label={label} className="rolling-skill-select" value={profile.runtimeId} onChange={(event) => onChange({...profile, runtimeId: event.target.value})}>
                <option value="">{t("selectRuntime")}</option>
                {runtimes.map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.displayName} {runtime.version}</option>)}
            </select>
        </div>
        <AgentProfileControls t={t} runtimeId={profile.runtimeId} modelId={profile.modelId} effort={profile.effort}
            modelPlaceholder={t("optimizationSelectModel")}
            effortPlaceholder={t("runtimeDefault")}
            onModelChange={(modelId) => onChange({...profile, modelId})}
            onEffortChange={(effort) => onChange({...profile, effort})}/>
    </fieldset>
}

export function OptimizationTargets({targets, runtimes, t, onChange}: {
    targets: OptimizationProfile[]; runtimes: RuntimeDescriptor[]; t: Translate
    onChange: (targets: OptimizationProfile[]) => void
}) {
    return <div className="rolling-skill-data-stack">
        {targets.map((profile, index) => <div key={index}>
            <OptimizationRuntimeFields label={`${t("optimizationTargetRuntime")} ${index + 1}`} profile={profile}
                runtimes={runtimes.filter((runtime) => runtime.runtimeId === profile.runtimeId || !targets.some((target) => target.runtimeId === runtime.runtimeId))} t={t}
                onChange={(next) => onChange(targets.map((target, position) => position === index ? next : target))}/>
            {targets.length > 1 ? <Button size="sm" onClick={() => onChange(targets.filter((_, position) => position !== index))}>{t("optimizationRemoveTarget")}</Button> : null}
        </div>)}
        <Button disabled={targets.length >= runtimes.length} onClick={() => onChange([...targets, {runtimeId: "", modelId: "", effort: ""}])}>{t("optimizationAddTarget")}</Button>
    </div>
}

export function OptimizationStoppingFields({value, onChange, t}: {
    value: OptimizationTuning; onChange: (value: OptimizationTuning) => void; t: Translate
}) {
    const numbers = [
        ["maxEpochs", "optimizationMaxEpochs", 1, 100, 1],
        ["maxMinutes", "operatorDurationMinutes", 1, 43200, 1],
        ["maxTurns", "operatorRuntimeTurns", 1, 1000000, 1],
        ["patience", "optimizationPatience", 1, 100, 1],
        ["minimumImprovement", "optimizationMinimumImprovement", 0, 100, 0.1],
        ["minimumScore", "optimizationMinimumScore", 0, 100, 0.1],
        ["minimumPassRate", "optimizationMinimumPassRate", 0, 100, 1],
    ] as const
    return <fieldset className="rolling-skill-subpanel">
        <legend>{t("optimizationStoppingRules")}</legend>
        <div className="rolling-skill-grid">
            <label className="rolling-skill-field"><span>{t("optimizationActivation")}</span><select className="rolling-skill-select" value={value.activationMode} onChange={(event) => onChange({...value, activationMode: event.target.value as OptimizationTuning["activationMode"]})}><option value="automatic">{t("optimizationAutomaticActivation")}</option><option value="explicit">{t("optimizationExplicitActivation")}</option></select></label>
            <label className="rolling-skill-field"><span>{t("optimizationEpochMode")}</span><select className="rolling-skill-select" value={value.mode} onChange={(event) => onChange({...value, mode: event.target.value as OptimizationTuning["mode"]})}><option value="adaptive">{t("optimizationAdaptive")}</option><option value="fixed">{t("optimizationFixed")}</option></select></label>
            {numbers.map(([key, label, min, max, step]) => <label key={key} className="rolling-skill-field"><span>{t(label)}</span><input className="rolling-skill-select" type="number" min={min} max={max} step={step} value={value[key]} onChange={(event) => onChange({...value, [key]: event.target.value})}/></label>)}
        </div>
        <label className="rolling-skill-check-option"><input type="checkbox" checked={value.requireCriticalCases} onChange={(event) => onChange({...value, requireCriticalCases: event.target.checked})}/>{t("optimizationCriticalCases")}</label>
        <p className="rolling-skill-help">{t("optimizationStoppingHelp")}</p>
    </fieldset>
}

export function optimizationNumericLimits(value: OptimizationTuning) {
    const number = (text: string, min: number, max: number, integer = false) => {
        const result = Number(text)
        if (!text.trim() || !Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) throw new Error("optimizationInvalidLimits")
        return result
    }
    const maxEpochs = number(value.maxEpochs, 1, 100, true)
    return {
        limits: {maxEpochs, maxDurationMs: number(value.maxMinutes, 1, 43200, true) * 60000,
            patience: number(value.patience, 1, maxEpochs, true), minimumImprovement: number(value.minimumImprovement, 0, 100),
            maxTurns: number(value.maxTurns, 1, 1000000, true), maxTokens: null, maxCostMicros: null},
        target: {minimumScore: number(value.minimumScore, 0, 100), minimumPassRate: number(value.minimumPassRate, 0, 100) / 100, requireCriticalCases: value.requireCriticalCases},
    }
}
