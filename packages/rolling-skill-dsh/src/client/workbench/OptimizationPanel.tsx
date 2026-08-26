import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string; name: string; skillReference?: {id?: string; repositoryId?: string}; activeRubricVersionId?: string | null}
interface Skill {id: string; repositoryId: string; name: string}
interface Version {id: string; skillId: string; repositoryId: string; state: string; versionLabel?: string | null}
interface Catalog {skills: Skill[]}
interface SkillDetail {skill: Skill; versions: Version[]}
interface OptimizationRun {id: string; state: string; currentEpoch?: number; revision?: number; error?: {message?: string} | null}

export function OptimizationPanel({t}: {t: Translate}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: []})
    const [detail, setDetail] = useState<SkillDetail | null>(null)
    const [runs, setRuns] = useState<OptimizationRun[]>([])
    const [skillId, setSkillId] = useState("")
    const [versionId, setVersionId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [operatorRuntimeId, setOperatorRuntimeId] = useState("")
    const [targetRuntimeId, setTargetRuntimeId] = useState("")
    const [judgeRuntimeId, setJudgeRuntimeId] = useState("")
    const [preflightReady, setPreflightReady] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<OptimizationRun[]>("optimizations.list", {}, controller.signal),
        ]).then(([runtimeItems, datasetItems, nextCatalog, nextRuns]) => {
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setCatalog(nextCatalog)
            setRuns(nextRuns)
            setOperatorRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setTargetRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setSkillId((current) => current || nextCatalog.skills[0]?.id || "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        if (!skillId) {
            setDetail(null)
            return
        }
        const controller = new AbortController()
        requestRollingSkill<SkillDetail>("skills.get", {skillId}, controller.signal)
            .then((next) => {
                setDetail(next)
                const released = next.versions.find((version) => version.state === "released")
                setVersionId(released?.id ?? "")
                const matching = datasets.find((dataset) => (
                    dataset.skillReference?.id === next.skill.id &&
                    dataset.skillReference?.repositoryId === next.skill.repositoryId
                ))
                setDatasetId(matching?.id ?? "")
                setPreflightReady(false)
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [skillId, datasets])

    const released = useMemo(() => detail?.versions.filter((version) => version.state === "released") ?? [], [detail])
    const compatibleDatasets = useMemo(() => datasets.filter((dataset) => (
        dataset.skillReference?.id === detail?.skill.id &&
        dataset.skillReference?.repositoryId === detail?.skill.repositoryId &&
        Boolean(dataset.activeRubricVersionId)
    )), [datasets, detail])
    const configuration = () => ({
        skillId,
        baselineVersionId: versionId,
        datasetId,
        operator: {runtimeId: operatorRuntimeId, effort: "high"},
        targets: [{runtimeId: targetRuntimeId, effort: "high"}],
        judge: {runtimeId: judgeRuntimeId, effort: "high"},
        activationMode: "explicit",
        mode: "adaptive",
        limits: {
            maxEpochs: 3,
            maxDurationMs: 60 * 60 * 1000,
            patience: 2,
            minimumImprovement: 0.5,
            maxTurns: 100,
            maxTokens: null,
            maxCostMicros: null,
        },
        target: {minimumScore: 90, minimumPassRate: 0.9, requireCriticalCases: true},
        telemetry: {tokens: false, cost: false},
    })
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
    const preflight = () => mutate(async () => {
        await requestRollingSkill("optimizations.preflight", configuration())
        setPreflightReady(true)
    })
    const start = () => mutate(async () => {
        await requestRollingSkill("optimizations.start", {
            ...configuration(),
            idempotencyKey: `dsh-${Date.now()}`,
        })
        setPreflightReady(false)
    })
    const ready = Boolean(
        skillId && versionId && datasetId &&
        operatorRuntimeId && targetRuntimeId && judgeRuntimeId,
    )

    return (
        <section className="rolling-skill-panel">
            <div className="rolling-skill-panel-header"><div><h3>{t("optimizationTitle")}</h3><p>{t("optimizationDescription")}</p></div><Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
            <div className="rolling-skill-grid">
                <label className="rolling-skill-field"><span>{t("optimizationSkill")}</span><select className="rolling-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{catalog.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
                <label className="rolling-skill-field"><span>{t("optimizationBaseline")}</span><select className="rolling-skill-select" value={versionId} onChange={(event) => {setVersionId(event.target.value); setPreflightReady(false)}}>{released.map((version) => <option key={version.id} value={version.id}>{version.versionLabel || version.id}</option>)}</select></label>
            </div>
            <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => {setDatasetId(event.target.value); setPreflightReady(false)}}>{compatibleDatasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
            <RuntimeSelect t={t} runtimes={runtimes} value={operatorRuntimeId} onChange={(value) => {setOperatorRuntimeId(value); setPreflightReady(false)}} label={t("operatorRuntime")}/>
            <RuntimeSelect t={t} runtimes={runtimes} value={targetRuntimeId} onChange={(value) => {setTargetRuntimeId(value); setPreflightReady(false)}} label={t("optimizationTargetRuntime")}/>
            <RuntimeSelect t={t} runtimes={runtimes} value={judgeRuntimeId} onChange={(value) => {setJudgeRuntimeId(value); setPreflightReady(false)}} label={t("judgeRuntime")}/>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-actions"><Button variant="outline" disabled={busy || !ready} onClick={() => void preflight()}>{t("optimizationPreflight")}</Button><Button variant="outline" disabled={busy || !preflightReady} onClick={() => void start()}>{t("startOptimization")}</Button></div>
            <div className="rolling-skill-list rolling-skill-section-gap">
                {runs.map((run) => <article className="rolling-skill-list-row" key={run.id}><div><strong>{run.state}</strong><span>{run.id} · Epoch {run.currentEpoch ?? 0}</span>{run.error?.message ? <small>{run.error.message}</small> : null}</div><div className="rolling-skill-actions">{!["paused", "completed", "failed", "cancelled"].includes(run.state) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.pause", {runId: run.id}))}>{t("pause")}</Button> : null}{["paused", "needs_recovery"].includes(run.state) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.resume", {runId: run.id}))}>{t("resume")}</Button> : null}{!["completed", "failed", "cancelled"].includes(run.state) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.cancel", {runId: run.id}))}>{t("cancelRun")}</Button> : null}</div></article>)}
                {runs.length === 0 ? <p>{t("emptyOptimizations")}</p> : null}
            </div>
        </section>
    )
}
