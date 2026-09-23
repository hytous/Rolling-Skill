import type {Translate} from "../locale"
import {ActionButton as Button} from "./ActionButton"
import {AgentProfileControls} from "./AgentProfileControls"
import type {RuntimeDescriptor} from "./RuntimeSelect"

export interface OptimizationProfile {runtimeId: string; modelId: string; effort: string}
export interface OptimizationTuning {
    activationMode: "automatic" | "explicit"
    maxEpochs: string
    sampledSearch?: boolean
    candidatesPerRound?: string
    failureSamples?: string
    caseWorkers?: string
}
export const initialOptimizationTuning: OptimizationTuning = {
    activationMode: "automatic",
    maxEpochs: "3",
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
    return <fieldset className="rolling-skill-subpanel">
        <legend>{t("optimizationBoundary")}</legend>
        <div className="rolling-skill-grid">
            <label className="rolling-skill-field"><span>{t("optimizationActivation")}</span><select className="rolling-skill-select" value={value.activationMode} onChange={(event) => onChange({...value, activationMode: event.target.value as OptimizationTuning["activationMode"]})}><option value="automatic">{t("optimizationAutomaticActivation")}</option><option value="explicit">{t("optimizationExplicitActivation")}</option></select></label>
            <label className="rolling-skill-field"><span>{t("optimizationMaxEpochs")}</span><input className="rolling-skill-select" type="number" min={1} max={100} step={1} value={value.maxEpochs} onChange={(event) => onChange({...value, maxEpochs: event.target.value})}/></label>
            <label className="rolling-skill-field"><span>{t("optimizationSampledSearch")}</span><input type="checkbox" checked={value.sampledSearch ?? false} onChange={(event) => onChange({...value, sampledSearch: event.target.checked})}/></label>
            {value.sampledSearch ? <>
                <label className="rolling-skill-field"><span>{t("optimizationCandidatesPerRound")}</span><input type="number" min={1} max={8} value={value.candidatesPerRound ?? "3"} onChange={(event) => onChange({...value, candidatesPerRound: event.target.value})}/></label>
                <label className="rolling-skill-field"><span>{t("optimizationFailureSamples")}</span><input type="number" min={1} max={24} value={value.failureSamples ?? "6"} onChange={(event) => onChange({...value, failureSamples: event.target.value})}/></label>
                <label className="rolling-skill-field"><span>{t("optimizationCaseWorkers")}</span><input type="number" min={1} max={8} value={value.caseWorkers ?? "1"} onChange={(event) => onChange({...value, caseWorkers: event.target.value})}/></label>
                <p className="rolling-skill-help">{t("optimizationSampledSearchHelp")}</p>
            </> : null}
        </div>
        <p className="rolling-skill-help">{t("optimizationBoundaryHelp")}</p>
    </fieldset>
}

export function optimizationNumericLimits(value: OptimizationTuning) {
    const maxEpochs = Number(value.maxEpochs)
    if (!value.maxEpochs.trim() || !Number.isInteger(maxEpochs) || maxEpochs < 1 || maxEpochs > 100) throw new Error("optimizationInvalidLimits")
    const search = value.sampledSearch ? {
        candidatesPerRound: Number(value.candidatesPerRound ?? "3"),
        failureSamples: Number(value.failureSamples ?? "6"),
        caseWorkers: Number(value.caseWorkers ?? "1"),
    } : null
    if (search && Object.entries(search).some(([key, number]) => !Number.isInteger(number) || number < 1 || number > (key === "failureSamples" ? 24 : 8))) throw new Error("optimizationInvalidLimits")
    return {limits: {maxEpochs}, ...(search ? {search} : {})}
}
