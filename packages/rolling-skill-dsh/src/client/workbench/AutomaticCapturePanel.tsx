import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate, TranslationKey} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string; name: string}
interface Model {id?: string; model?: string; displayName?: string}
interface AutomaticStatus {
    mode: "off" | "scheduled" | "automatic"
    executionLocation: "while-harness-running" | "always"
    schedule: {cadence: "daily" | "weekly"; time: string; weekday: number}
    runtime: RuntimeDescriptor | null
    modelId: string | null
    effort: string | null
    datasetId: string | null
    nextRunAt: string | null
    lastSuccessAt: string | null
    error: string | null
    pendingCount: number
    running: boolean
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

function displayTime(value: string | null, fallback: string) {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function AutomaticCapturePanel({t}: {t: Translate}) {
    const [status, setStatus] = useState<AutomaticStatus | null>(null)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [models, setModels] = useState<Model[]>([])
    const [mode, setMode] = useState<AutomaticStatus["mode"]>("off")
    const [executionLocation, setExecutionLocation] = useState<AutomaticStatus["executionLocation"]>("while-harness-running")
    const [cadence, setCadence] = useState<"daily" | "weekly">("daily")
    const [time, setTime] = useState("09:00")
    const [weekday, setWeekday] = useState(1)
    const [runtimeId, setRuntimeId] = useState("")
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("low")
    const [datasetId, setDatasetId] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<AutomaticStatus>("automatic.status", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
        ]).then(([nextStatus, runtimeItems, datasetItems]) => {
            setStatus(nextStatus)
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setMode(nextStatus.mode)
            setExecutionLocation(nextStatus.executionLocation)
            setCadence(nextStatus.schedule.cadence)
            setTime(nextStatus.schedule.time)
            setWeekday(nextStatus.schedule.weekday)
            setRuntimeId(nextStatus.runtime?.runtimeId || runtimeItems[0]?.runtimeId || "")
            setModelId(nextStatus.modelId || "")
            setEffort(nextStatus.effort || "low")
            setDatasetId(nextStatus.datasetId || "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        if (!runtimeId) return
        const controller = new AbortController()
        requestRollingSkill<Model[]>("runtimes.models", {runtimeId}, controller.signal)
            .then((items) => {
                setModels(items)
                setModelId((current) => current || items[0]?.id || items[0]?.model || "")
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [runtimeId])

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
    const save = () => mutate(async () => {
        await requestRollingSkill("automatic.update", {
            mode,
            executionLocation,
            cadence,
            time,
            weekday,
            runtimeId: runtimeId || null,
            modelId: modelId || null,
            effort: effort || null,
            datasetId: datasetId || null,
        })
        if (status?.worker.installed) {
            await requestRollingSkill(
                executionLocation === "always" ? "scheduler.enable" : "scheduler.disable",
                {},
            )
        }
    })
    const runOnce = () => mutate(() => requestRollingSkill("automatic.runOnce", {slot: "manual"}))
    const enableScheduler = () => mutate(() => requestRollingSkill("scheduler.enable", {}))
    const disableScheduler = () => mutate(() => requestRollingSkill("scheduler.disable", {}))
    const requiresRuntime = mode !== "off"
    const schedulerInstalled = status?.scheduler.installed ?? status?.worker.installed ?? false

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("automaticTitle")}</h3><p>{t("automaticDescription")}</p></div><Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("automaticMode")}</span><select className="rolling-skill-select" value={mode} onChange={(event) => setMode(event.target.value as AutomaticStatus["mode"])}><option value="off">{t("automaticOff")}</option><option value="scheduled">{t("automaticScheduled")}</option><option value="automatic">{t("automaticFull")}</option></select></label>
                    <label className="rolling-skill-field"><span>{t("executionLocation")}</span><select className="rolling-skill-select" value={executionLocation} onChange={(event) => setExecutionLocation(event.target.value as AutomaticStatus["executionLocation"])}><option value="while-harness-running">{t("whileHarnessRunning")}</option><option value="always">{t("alwaysRunning")}</option></select></label>
                </div>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("cadence")}</span><select className="rolling-skill-select" value={cadence} onChange={(event) => setCadence(event.target.value as "daily" | "weekly")}><option value="daily">{t("daily")}</option><option value="weekly">{t("weekly")}</option></select></label>
                    <label className="rolling-skill-field"><span>{t("captureTime")}</span><input className="rolling-skill-select" type="time" value={time} onChange={(event) => setTime(event.target.value)}/></label>
                    {cadence === "weekly" ? <label className="rolling-skill-field"><span>{t("weekday")}</span><select className="rolling-skill-select" value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{WEEKDAY_KEYS.map((key, day) => <option key={key} value={day}>{t(key)}</option>)}</select></label> : null}
                </div>
                <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("automaticRuntime")}/>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={effort} onChange={(event) => setEffort(event.target.value)}>{["low", "medium", "high", "xhigh", "max"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                    <label className="rolling-skill-field"><span>{t("automaticDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="">{t("automaticDatasetMatch")}</option>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
                </div>
                <p className="rolling-skill-help">{mode === "scheduled" ? t("scheduledBehavior") : mode === "automatic" ? t("automaticBehavior") : t("offBehavior")}</p>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <div className="rolling-skill-actions"><Button variant="outline" disabled={busy || (requiresRuntime && !runtimeId)} onClick={() => void save()}>{t("saveAutomatic")}</Button><Button variant="ghost" disabled={busy || mode === "off" || !runtimeId} onClick={() => void runOnce()}>{t("runOnce")}</Button>{executionLocation === "always" ? schedulerInstalled ? <Button variant="ghost" disabled={busy} onClick={() => void disableScheduler()}>{t("disableScheduler")}</Button> : <Button variant="outline" disabled={busy || status?.executionLocation !== "always" || status?.mode === "off" || !status?.scheduler.supported} onClick={() => void enableScheduler()}>{t("enableScheduler")}</Button> : null}</div>
            </section>
            <section className="rolling-skill-panel"><h3>{t("automaticStatus")}</h3><dl><div><dt>{t("nextRun")}</dt><dd>{displayTime(status?.nextRunAt ?? null, t("notAvailable"))}</dd></div><div><dt>{t("lastSuccess")}</dt><dd>{displayTime(status?.lastSuccessAt ?? null, t("notAvailable"))}</dd></div><div><dt>{t("pendingRawCases")}</dt><dd>{status?.pendingCount ?? 0}</dd></div><div><dt>{t("schedulerStatus")}</dt><dd>{executionLocation === "always" ? schedulerInstalled ? t("installed") : t("notInstalled") : t("harnessTimer")}</dd></div><div><dt>{t("lastError")}</dt><dd>{status?.error || status?.scheduler.error || status?.worker.lastRegistrationError || t("noError")}</dd></div></dl></section>
        </div>
    )
}
