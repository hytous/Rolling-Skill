import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
interface RuntimeDescriptor {runtimeId: string; displayName: string; version?: string}
interface Model {id?: string; model?: string; displayName?: string}
interface Profile {modelId: string | null; effort: string | null}
interface RollingSettings {
    rollingSkill: {curatorProfile: Profile; rubricProfile: Profile; judgeProfile: Profile}
    plugin: {runtime: RuntimeDescriptor | null}
}

export function RollingSkillSettings({t}: {t: Translate}) {
    const [revision, setRevision] = useState(0)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [models, setModels] = useState<Model[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [profiles, setProfiles] = useState<Record<"curator" | "rubric" | "judge", Profile>>({
        curator: {modelId: null, effort: null},
        rubric: {modelId: null, effort: null},
        judge: {modelId: null, effort: null},
    })
    const [busy, setBusy] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [state, setState] = useState<
        {status: "loading"} |
        {status: "error"; message: string} |
        {status: "ready"}
    >({status: "loading"})

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RollingSettings>("settings.get", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
        ]).then(([settings, runtimeItems]) => {
            setState({status: "ready"})
            setRuntimes(runtimeItems)
            setRuntimeId(settings.plugin.runtime?.runtimeId ?? runtimeItems[0]?.runtimeId ?? "")
            setProfiles({
                curator: settings.rollingSkill.curatorProfile,
                rubric: settings.rollingSkill.rubricProfile,
                judge: settings.rollingSkill.judgeProfile,
            })
        })
            .catch((error: unknown) => {
                if (controller.signal.aborted) return
                setState({status: "error", message: error instanceof Error ? error.message : t("loadError")})
            })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        if (!runtimeId) {
            setModels([])
            return
        }
        const controller = new AbortController()
        requestRollingSkill<Model[]>("runtimes.models", {runtimeId}, controller.signal)
            .then(setModels)
            .catch((error: unknown) => {
                if (!controller.signal.aborted) setSaveError(error instanceof Error ? error.message : t("loadError"))
            })
        return () => controller.abort()
    }, [runtimeId])

    const updateProfile = (kind: keyof typeof profiles, patch: Partial<Profile>) => {
        setProfiles((current) => ({...current, [kind]: {...current[kind], ...patch}}))
    }
    const save = async () => {
        if (!runtimeId) return
        setBusy(true)
        setSaveError(null)
        try {
            await requestRollingSkill("settings.selectRuntime", {runtimeId})
            await requestRollingSkill("settings.update", {rollingSkill: {
                curatorModelId: profiles.curator.modelId,
                curatorEffort: profiles.curator.effort,
                rubricModelId: profiles.rubric.modelId,
                rubricEffort: profiles.rubric.effort,
                judgeModelId: profiles.judge.modelId,
                judgeEffort: profiles.judge.effort,
            }})
            setRevision((value) => value + 1)
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="rolling-skill-settings" aria-labelledby="rolling-skill-settings-title">
            <header className="rolling-skill-header">
                <div>
                    <h2 id="rolling-skill-settings-title">{t("settings")}</h2>
                    <p>{t("settingsDescription")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
                    {t("refresh")}
                </Button>
            </header>
            {state.status === "loading" ? (
                <div className="rolling-skill-state" role="status">{t("loading")}</div>
            ) : state.status === "error" ? (
                <div className="rolling-skill-state rolling-skill-error" role="alert">{state.message}</div>
            ) : (
                <div className="rolling-skill-data-stack"><section className="rolling-skill-panel">
                    <h3>{t("agentDefaults")}</h3>
                    <label className="rolling-skill-field"><span>{t("defaultRuntime")}</span><select className="rolling-skill-select" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.map((item) => <option value={item.runtimeId} key={item.runtimeId}>{item.displayName} {item.version ?? ""}</option>)}</select></label>
                    <div className="rolling-skill-grid">{(["curator", "rubric", "judge"] as const).map((kind) => <section className="rolling-skill-subpanel" key={kind}><h4>{t(kind === "curator" ? "curatorDefault" : kind === "rubric" ? "rubricDefault" : "judgeDefault")}</h4><label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={profiles[kind].modelId ?? ""} onChange={(event) => updateProfile(kind, {modelId: event.target.value || null})}><option value="">{t("runtimeDefault")}</option>{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label><label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={profiles[kind].effort ?? ""} onChange={(event) => updateProfile(kind, {effort: event.target.value || null})}><option value="">{t("runtimeDefault")}</option>{["low", "medium", "high", "xhigh", "max"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></section>)}</div>
                    {saveError ? <p className="rolling-skill-inline-error" role="alert">{saveError}</p> : null}
                    <Button variant="outline" disabled={busy || !runtimeId} onClick={() => void save()}>{t("saveDefaults")}</Button>
                </section></div>
            )}
        </section>
    )
}
