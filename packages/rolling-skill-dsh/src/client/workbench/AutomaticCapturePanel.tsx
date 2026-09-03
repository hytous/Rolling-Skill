import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate, TranslationKey} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {
    candidateDatasetOptions,
    candidateSkillRows,
} from "./automatic-capture-view-model.cjs"
import type {RuntimeDescriptor} from "./RuntimeSelect"
import {usePollingRevision} from "./usePollingRevision"

interface SkillReference {id?: string; name?: string}
interface Dataset {
    id: string
    name: string
    skillReference?: SkillReference | null
    activeRubricVersionId?: string | null
}
interface SkillEntry {id: string; name: string; description?: string; status: string}
interface Catalog {skills: SkillEntry[]}
interface CaptureTarget {skillId: string; datasetId: string}
interface Profile {runtimePolicy: string; modelId: string | null; effort: string | null}
interface RollingSettings {rollingSkill: {curatorProfile: Profile}}
interface AutomaticStatus {
    mode: "off" | "scheduled" | "automatic"
    executionLocation: "while-harness-running" | "always"
    schedule: {cadence: "daily" | "weekly"; time: string; weekday: number}
    runtime: RuntimeDescriptor | null
    sourceRuntime: RuntimeDescriptor | null
    curatorRuntime: RuntimeDescriptor | null
    modelId: string | null
    effort: string | null
    datasetId: string | null
    targets: CaptureTarget[]
    nextRunAt: string | null
    lastSuccessAt: string | null
    error: string | null
    pendingCount: number
    curationPendingCount?: number
    running: boolean
    progress?: {stage: string; startedAt: string; totalThreads: number; completedThreads: number; analysisCount: number} | null
    worker: {enabled: boolean; installed: boolean; platform: string | null; lastRegistrationError: string | null}
    scheduler: {supported: boolean; installed: boolean; platform: string; error?: string | null}
}

const WEEKDAY_KEYS = [
    "weekday0",
    "weekday1",
    "weekday2",
    "weekday3",
    "weekday4",
    "weekday5",
    "weekday6",
] satisfies TranslationKey[]

const HOURS = Array.from({length: 24}, (_, value) => String(value).padStart(2, "0"))
const MINUTES = Array.from({length: 60}, (_, value) => String(value).padStart(2, "0"))

function displayTime(value: string | null, fallback: string) {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function AutomaticCapturePanel({t}: {t: Translate}) {
    const [status, setStatus] = useState<AutomaticStatus | null>(null)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: []})
    const [models, setModels] = useState<RuntimeModel[]>([])
    const [curatorProfile, setCuratorProfile] = useState<Profile>({runtimePolicy: "active", modelId: null, effort: null})
    const [mode, setMode] = useState<AutomaticStatus["mode"]>("off")
    const [executionLocation, setExecutionLocation] = useState<AutomaticStatus["executionLocation"]>("while-harness-running")
    const [cadence, setCadence] = useState<"daily" | "weekly">("daily")
    const [time, setTime] = useState("09:00")
    const [weekday, setWeekday] = useState(1)
    const [runtimeId, setRuntimeId] = useState("")
    const [sourceRuntimeId, setSourceRuntimeId] = useState("")
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [modelCatalogRevision, setModelCatalogRevision] = useState(0)
    const [candidateTargets, setCandidateTargets] = useState<CaptureTarget[]>([])
    const [busy, setBusy] = useState(false)
    const [initialized, setInitialized] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [statusError, setStatusError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)
    const [pollRevision] = usePollingRevision(true, 3_000)

    useEffect(() => {
        if (!pollRevision) return
        const controller = new AbortController()
        requestRollingSkill<AutomaticStatus>("automatic.status", {}, controller.signal)
            .then((next) => {if (!controller.signal.aborted) {setStatus(next); setStatusError(null)}})
            .catch((reason) => {if (!controller.signal.aborted) setStatusError(reason instanceof Error ? reason.message : t("loadError"))})
        return () => controller.abort()
    }, [pollRevision])

    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        Promise.all([
            requestRollingSkill<AutomaticStatus>("automatic.status", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<RollingSettings>("settings.get", {}, controller.signal),
        ]).then(([nextStatus, runtimeItems, datasetItems, nextCatalog, settings]) => {
            if (controller.signal.aborted) return
            setStatus(nextStatus)
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setCatalog(nextCatalog)
            setCuratorProfile(settings.rollingSkill.curatorProfile)
            setMode(nextStatus.mode)
            setExecutionLocation(nextStatus.executionLocation)
            setCadence(nextStatus.schedule.cadence)
            setTime(nextStatus.schedule.time)
            setWeekday(nextStatus.schedule.weekday)
            setRuntimeId(nextStatus.runtime?.runtimeId || "")
            setSourceRuntimeId((nextStatus.sourceRuntime ?? nextStatus.runtime)?.runtimeId || "")
            setModelId(nextStatus.modelId || "")
            setEffort(nextStatus.effort || "")
            setModelCatalogRevision((value) => value + 1)
            const migratedTarget = nextStatus.datasetId
                ? datasetItems.find((dataset) => dataset.id === nextStatus.datasetId && dataset.skillReference?.id)
                : null
            setCandidateTargets(nextStatus.targets?.length
                ? nextStatus.targets
                : migratedTarget?.skillReference?.id
                    ? [{skillId: migratedTarget.skillReference.id, datasetId: migratedTarget.id}]
                    : [])
            setInitialized(true)
            setError(null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        setModels([])
        if (!runtimeId) return
        const controller = new AbortController()
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId}, controller.signal)
            .then((items) => {
                if (!controller.signal.aborted) setModels(items)
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [runtimeId, modelCatalogRevision])

    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true)
        setError(null)
        try {
            await operation()
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const updateAutomaticSettings = () => requestRollingSkill("automatic.update", {
            mode,
            executionLocation,
            cadence,
            time,
            weekday,
            runtimeId: runtimeId || null,
            sourceRuntimeId: sourceRuntimeId || null,
            modelId: modelId || null,
            effort: effort || null,
            datasetId: null,
            targets: candidateTargets,
        })
    const save = () => mutate(async () => {
        await updateAutomaticSettings()
        if (status?.worker.installed) {
            await requestRollingSkill(
                executionLocation === "always" ? "scheduler.enable" : "scheduler.disable",
                {},
            )
        }
    })
    const runOnce = () => mutate(async () => {
        await updateAutomaticSettings()
        await requestRollingSkill("automatic.runOnce", {slot: "manual", wait: false})
    })
    const enableScheduler = () => mutate(async () => {
        await updateAutomaticSettings()
        await requestRollingSkill("scheduler.enable", {})
    })
    const disableScheduler = () => mutate(() => requestRollingSkill("scheduler.disable", {}))
    const requiresRuntime = mode !== "off"
    const schedulerInstalled = status?.scheduler.installed ?? status?.worker.installed ?? false
    const [hour = "09", minute = "00"] = time.split(":")
    const curatorProfileSummary = [
        status?.curatorRuntime?.displayName,
        curatorProfile.modelId || t("runtimeDefault"),
        curatorProfile.effort ? `${t("effort")}: ${curatorProfile.effort}` : null,
    ].filter(Boolean).join(" · ")
    const datasetOptions = (skillId: string) => candidateDatasetOptions(
        datasets,
        skillId,
        mode,
    ) as Array<Dataset & {disabled: boolean}>
    const availableDatasets = (skillId: string) => datasetOptions(skillId)
        .filter((dataset) => !dataset.disabled)
    const toggleCandidate = (skillId: string, checked: boolean) => {
        if (!checked) {
            setCandidateTargets((current) => current.filter((target) => target.skillId !== skillId))
            return
        }
        const datasetId = availableDatasets(skillId)[0]?.id ?? ""
        setCandidateTargets((current) => [...current, {skillId, datasetId}])
    }
    const selectCandidateDataset = (skillId: string, datasetId: string) => {
        setCandidateTargets((current) => current.map((target) => (
            target.skillId === skillId ? {...target, datasetId} : target
        )))
    }
    const invalidCandidateTargets = candidateTargets.some((target) => (
        !target.datasetId || !availableDatasets(target.skillId).some((dataset) => dataset.id === target.datasetId)
    ))
    const visibleCandidateSkills = candidateSkillRows(catalog.skills, candidateTargets) as SkillEntry[]
    const runtimeOptions = (selected: string) => <>
        <option value="">{t("selectRuntime")}</option>
        {selected && !runtimes.some((runtime) => runtime.runtimeId === selected) ? <option value={selected}>{selected}</option> : null}
        {runtimes.map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.displayName} {runtime.version}</option>)}
    </>
    const missingRuntime = !runtimeId || !sourceRuntimeId

    if (!initialized) return <section className="rolling-skill-panel"><h3>{t("automaticTitle")}</h3>{error
        ? <><p role="alert">{error}</p><Button disabled={loading} onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button></>
        : <p role="status">{t("loading")}</p>}</section>

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("automaticTitle")}</h3><p>{t("automaticDescription")}</p></div><Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("automaticMode")}</span><select className="rolling-skill-select" value={mode} onChange={(event) => setMode(event.target.value as AutomaticStatus["mode"])}><option value="off">{t("automaticOff")}</option><option value="scheduled">{t("automaticScheduled")}</option><option value="automatic">{t("automaticFull")}</option></select></label>
                    <label className="rolling-skill-field"><span>{t("executionLocation")}</span><select className="rolling-skill-select" value={executionLocation} onChange={(event) => setExecutionLocation(event.target.value as AutomaticStatus["executionLocation"])}><option value="while-harness-running">{t("whileHarnessRunning")}</option><option value="always">{t("alwaysRunning")}</option></select></label>
                </div>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("cadence")}</span><select className="rolling-skill-select" value={cadence} onChange={(event) => setCadence(event.target.value as "daily" | "weekly")}><option value="daily">{t("daily")}</option><option value="weekly">{t("weekly")}</option></select></label>
                    <div className="rolling-skill-field"><span>{t("captureTime")}</span><div className="rolling-skill-time-selects"><label><select aria-label={t("captureHour")} className="rolling-skill-select" value={hour} onChange={(event) => setTime(`${event.target.value}:${minute}`)}>{HOURS.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>{t("hourUnit")}</span></label><label><select aria-label={t("captureMinute")} className="rolling-skill-select" value={minute} onChange={(event) => setTime(`${hour}:${event.target.value}`)}>{MINUTES.map((value) => <option key={value} value={value}>{value}</option>)}</select><span>{t("minuteUnit")}</span></label></div></div>
                    {cadence === "weekly" ? <label className="rolling-skill-field"><span>{t("weekday")}</span><select className="rolling-skill-select" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{WEEKDAY_KEYS.map((key, day) => <option key={key} value={day}>{t(key)}</option>)}</select></label> : null}
                </div>
                {executionLocation === "always" ? <p className="rolling-skill-help rolling-skill-scheduler-explanation">{t("schedulerExplanation")}</p> : null}
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("automaticSourceRuntime")}</span><select className="rolling-skill-select" value={sourceRuntimeId} onChange={(event) => setSourceRuntimeId(event.target.value)}>{runtimeOptions(sourceRuntimeId)}</select></label>
                    <label className="rolling-skill-field"><span>{t("automaticRuntime")}</span><select className="rolling-skill-select" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimeOptions(runtimeId)}</select></label>
                </div>
                <p className="rolling-skill-help">{t("automaticRuntimeRoles")}</p>
                <p className="rolling-skill-automatic-flow-summary">{t("automaticFlowSummaryPrefix")}<strong>{curatorProfileSummary}</strong>{t("automaticFlowSummarySuffix")}</p>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("automaticDetectionModel")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">{t("runtimeDefault")}</option>{modelId && !models.some((model) => (model.id ?? model.model) === modelId) ? <option value={modelId}>{modelId}</option> : null}{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <ModelEffortSelect label={t("automaticDetectionEffort")} runtimeDefaultLabel={t("runtimeDefault")} models={models} modelId={modelId} value={effort} onChange={setEffort}/>
                </div>
                <fieldset className="rolling-skill-candidate-targets">
                    <legend>{t("candidateSkills")}</legend>
                    <p className="rolling-skill-help">{t("candidateSkillsDescription")}</p>
                    <div className="rolling-skill-candidate-target-list">
                        {visibleCandidateSkills.map((skill) => {
                            const target = candidateTargets.find((entry) => entry.skillId === skill.id)
                            const boundDatasets = datasetOptions(skill.id)
                            const selectableDatasets = boundDatasets.filter((dataset) => !dataset.disabled)
                            return <div className="rolling-skill-candidate-target" key={skill.id}>
                                <label className="rolling-skill-candidate-skill"><input type="checkbox" checked={Boolean(target)} disabled={selectableDatasets.length === 0 && !target} onChange={(event) => toggleCandidate(skill.id, event.target.checked)}/><span><strong>{skill.name}</strong><small>{skill.status !== "valid" ? t("candidateSkillUnavailable") : boundDatasets.length ? skill.description : t("candidateSkillNoDataset")}</small></span></label>
                                <div className="rolling-skill-candidate-dataset"><select aria-label={`${skill.name} ${t("automaticDataset")}`} className="rolling-skill-select" disabled={!target || skill.status !== "valid"} value={target?.datasetId ?? ""} onChange={(event) => selectCandidateDataset(skill.id, event.target.value)}><option value="">{t("selectDataset")}</option>{boundDatasets.map((option) => <option disabled={option.disabled} key={option.id} value={option.id}>{option.name}{option.disabled ? t("datasetRubricRequiredSuffix") : ""}</option>)}</select>{skill.status === "valid" && selectableDatasets.length === 1 ? <small>{t("candidateDatasetOnlyOne")}</small> : null}</div>
                            </div>
                        })}
                        {visibleCandidateSkills.length === 0 ? <p>{t("noCandidateSkills")}</p> : null}
                    </div>
                </fieldset>
                <p className="rolling-skill-help">{mode === "scheduled" ? t("scheduledBehavior") : mode === "automatic" ? t("automaticBehavior") : t("offBehavior")}</p>
                {status?.running ? <div role="status"><p>{t("automaticScanning")}</p>{status.progress ? <p className="rolling-skill-help">{t(status.progress.stage === "boundary" ? "automaticBoundaryStage" : status.progress.stage === "outcome" ? "automaticOutcomeStage" : "automaticReadingStage")} · {t("automaticCheckedThreads")} {status.progress.completedThreads}/{status.progress.totalThreads} · {t("automaticAnalysisCount")} {status.progress.analysisCount} · {t("automaticStartedAt")} {displayTime(status.progress.startedAt, t("notAvailable"))}</p> : null}</div> : null}
                {Boolean(status?.curationPendingCount) ? <p role="status">{t("automaticCurating")} {status?.curationPendingCount}</p> : null}
                {error || statusError ? <p className="rolling-skill-inline-error" role="alert">{error || statusError}</p> : null}
                <div className="rolling-skill-form-actions">
                    <div className="rolling-skill-actions">
                        <Button disabled={loading || busy || status?.running || mode === "off" || missingRuntime || invalidCandidateTargets} onClick={() => void runOnce()}>{t("runOnce")}</Button>
                        {executionLocation === "always" ? schedulerInstalled
                            ? <Button disabled={loading || busy} onClick={() => void disableScheduler()}>{t("disableScheduler")}</Button>
                            : <Button disabled={loading || busy || status?.running || mode === "off" || missingRuntime || invalidCandidateTargets || !status?.scheduler.supported} onClick={() => void enableScheduler()}>{t("enableScheduler")}</Button> : null}
                    </div>
                    <Button tone="primary" disabled={loading || busy || status?.running || (requiresRuntime && missingRuntime) || invalidCandidateTargets} onClick={() => void save()}>{t("saveAutomatic")}</Button>
                </div>
            </section>
            <section className="rolling-skill-panel"><h3>{t("automaticStatus")}</h3><dl><div><dt>{t("nextRun")}</dt><dd>{displayTime(status?.nextRunAt ?? null, t("notAvailable"))}</dd></div><div><dt>{t("lastSuccess")}</dt><dd>{displayTime(status?.lastSuccessAt ?? null, t("notAvailable"))}</dd></div><div><dt>{t("pendingRawCases")}</dt><dd>{status?.pendingCount ?? 0}</dd></div><div><dt>{t("schedulerStatus")}</dt><dd>{executionLocation === "always" ? schedulerInstalled ? t("installed") : t("notInstalled") : t("harnessTimer")}</dd></div><div><dt>{t("lastError")}</dt><dd>{status?.error || status?.scheduler.error || status?.worker.lastRegistrationError || t("noError")}</dd></div></dl></section>
        </div>
    )
}
