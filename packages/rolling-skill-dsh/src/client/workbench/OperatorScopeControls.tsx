import type {Translate, TranslationKey} from "../locale"
import type {RuntimeDescriptor} from "./RuntimeSelect"

export interface OperatorDataset {id: string; name?: string; skillReference?: {id?: string} | null}
export interface OperatorSkill {id: string; name?: string; repositoryId: string; status?: string}
export const OPERATOR_ACTIONS = [
    ["context.read", "operatorActionContextRead"],
    ["raw_cases.read", "operatorActionRawCasesRead"],
    ["raw_cases.write", "operatorActionRawCasesWrite"],
    ["runtime.execute", "operatorActionRuntimeExecute"],
    ["runtimes.read", "operatorActionRuntimesRead"],
    ["datasets.read", "operatorActionDatasetsRead"],
    ["datasets.write", "operatorActionDatasetsWrite"],
    ["datasets.delete", "operatorActionDatasetsDelete"],
    ["evaluations.read", "operatorActionEvaluationsRead"],
    ["evaluations.execute", "operatorActionEvaluationsExecute"],
    ["skills.read", "operatorActionSkillsRead"],
    ["skills.write", "operatorActionSkillsWrite"],
    ["skills.release", "operatorActionSkillsRelease"],
    ["jobs.read", "operatorActionJobsRead"],
    ["approvals.read", "operatorActionApprovalsRead"],
    ["curation.write", "operatorActionCurationWrite"],
    ["rubrics.publish", "operatorActionRubricsPublish"],
    ["installations.execute", "operatorActionInstallationsExecute"],
    ["installations.read", "operatorActionInstallationsRead"],
    ["optimizations.read", "operatorActionOptimizationsRead"],
    ["optimizations.execute", "operatorActionOptimizationsExecute"],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>

const BUDGET_FIELDS = [
    ["maxDurationMs", "operatorDurationMinutes"], ["maxRuntimeTurns", "operatorRuntimeTurns"],
    ["maxEvaluations", "operatorEvaluations"], ["maxTargetExecutions", "operatorTargetExecutions"],
    ["maxJudgeExecutions", "operatorJudgeExecutions"], ["maxTokens", "operatorTokensOptional"],
    ["maxReportedCost", "operatorCostOptional"],
] as const satisfies ReadonlyArray<readonly [string, TranslationKey]>
export type OperatorBudget = Record<(typeof BUDGET_FIELDS)[number][0], string>
export const INITIAL_OPERATOR_BUDGET: OperatorBudget = {maxDurationMs: "60", maxRuntimeTurns: "20", maxEvaluations: "5", maxTargetExecutions: "50", maxJudgeExecutions: "20", maxTokens: "", maxReportedCost: ""}
export function operatorBudgetValue(value: OperatorBudget) {
    return Object.fromEntries(BUDGET_FIELDS.map(([key]) => {
        const optional = key === "maxTokens" || key === "maxReportedCost"
        if (optional && value[key].trim() === "") return [key, null]
        const number = Number(value[key]) * (key === "maxDurationMs" ? 60_000 : 1)
        if (!value[key].trim() || !Number.isFinite(number) || number < 0 || (key !== "maxReportedCost" && !Number.isSafeInteger(number)) || (["maxDurationMs", "maxRuntimeTurns"].includes(key) && number === 0)) {
            throw new Error(key)
        }
        return [key, number]
    }))
}

export function OperatorScopeControls({t, skills, datasets, runtimes, skillId, datasetId, targetRuntimeIds, actions, budget, onSkillChange, onDatasetChange, onTargetsChange, onActionsChange, onBudgetChange}: {
    t: Translate; skills: OperatorSkill[]; datasets: OperatorDataset[]; runtimes: RuntimeDescriptor[]
    skillId: string; datasetId: string; targetRuntimeIds: string[]; actions: string[]; budget: OperatorBudget
    onSkillChange: (value: string) => void; onDatasetChange: (value: string) => void
    onTargetsChange: (value: string[]) => void; onActionsChange: (value: string[]) => void; onBudgetChange: (value: OperatorBudget) => void
}) {
    const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter((value) => value !== id)
    return <section className="rolling-skill-subpanel rolling-skill-detail-stack">
        <h4>{t("operatorScopeTitle")}</h4>
        <p className="rolling-skill-help">{t("operatorScopeHelp")}</p>
        <div className="rolling-skill-grid">
            <label className="rolling-skill-field"><span>{t("operatorScopeSkill")}</span><select className="rolling-skill-select" value={skillId} onChange={(event) => onSkillChange(event.target.value)}><option value="">{t("operatorScopeNone")}</option>{skills.filter((skill) => !skill.status || skill.status === "valid").map((skill) => <option key={skill.id} value={skill.id}>{skill.name ?? skill.id}</option>)}</select></label>
            <label className="rolling-skill-field"><span>{t("operatorScopeDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => onDatasetChange(event.target.value)}><option value="">{t("operatorScopeNone")}</option>{datasets.filter((dataset) => !skillId || dataset.skillReference?.id === skillId).map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name ?? dataset.id}</option>)}</select></label>
        </div>
        <fieldset className="rolling-skill-candidate-targets"><legend>{t("operatorScopeRuntimes")}</legend><div className="rolling-skill-option-grid">{runtimes.map((runtime) => <label key={runtime.runtimeId}><input type="checkbox" value={runtime.runtimeId} checked={targetRuntimeIds.includes(runtime.runtimeId)} onChange={(event) => onTargetsChange(toggle(targetRuntimeIds, runtime.runtimeId, event.target.checked))}/><span>{runtime.displayName} {runtime.version}</span></label>)}</div></fieldset>
        <details><summary>{t("operatorGrantsTitle")} · {actions.length}</summary><p className="rolling-skill-help">{t("operatorGrantsHelp")}</p><div className="rolling-skill-option-grid">{OPERATOR_ACTIONS.map(([action, key]) => <label key={action}><input type="checkbox" value={action} checked={actions.includes(action)} onChange={(event) => onActionsChange(toggle(actions, action, event.target.checked))}/><span>{t(key)}</span></label>)}</div></details>
        <details open><summary>{t("operatorBudgetTitle")}</summary><div className="rolling-skill-grid">{BUDGET_FIELDS.map(([key, label]) => <label className="rolling-skill-field" key={key}><span>{t(label)}</span><input className="rolling-skill-select" name={key} type="number" min={key === "maxDurationMs" || key === "maxRuntimeTurns" ? 1 : 0} step={key === "maxReportedCost" ? "0.01" : "1"} value={budget[key]} onChange={(event) => onBudgetChange({...budget, [key]: event.target.value})}/></label>)}</div><p className="rolling-skill-help">{t("operatorBudgetHelp")}</p></details>
    </section>
}
