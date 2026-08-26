import {Button, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string; name: string; caseCount: number}
interface Model {id?: string; model?: string; displayName?: string}
interface EvaluationSummary {
    id: string
    datasetId: string
    status: string
    caseCount: number
    runtimeCount: number
    createdAt: string
}
interface EvaluationDetail extends EvaluationSummary {
    results: Array<{id: string; status: string; response?: string; error?: string}>
}

export function EvaluationsPanel({t}: {t: Translate}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [runs, setRuns] = useState<EvaluationSummary[]>([])
    const [targetRuntimeId, setTargetRuntimeId] = useState("")
    const [judgeRuntimeId, setJudgeRuntimeId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [targetModels, setTargetModels] = useState<Model[]>([])
    const [judgeModels, setJudgeModels] = useState<Model[]>([])
    const [targetModelId, setTargetModelId] = useState("")
    const [judgeModelId, setJudgeModelId] = useState("")
    const [effort, setEffort] = useState("high")
    const [detail, setDetail] = useState<EvaluationDetail | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<EvaluationSummary[]>("evaluations.list", {}, controller.signal),
        ]).then(([runtimeItems, datasetItems, runItems]) => {
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setRuns(runItems)
            setTargetRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setDatasetId((current) => current || datasetItems[0]?.id || "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        if (!targetRuntimeId) return
        const controller = new AbortController()
        requestRollingSkill<Model[]>("runtimes.models", {runtimeId: targetRuntimeId}, controller.signal)
            .then((models) => {
                setTargetModels(models)
                setTargetModelId(models[0]?.id ?? models[0]?.model ?? "")
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [targetRuntimeId])

    useEffect(() => {
        if (!judgeRuntimeId) return
        const controller = new AbortController()
        requestRollingSkill<Model[]>("runtimes.models", {runtimeId: judgeRuntimeId}, controller.signal)
            .then((models) => {
                setJudgeModels(models)
                setJudgeModelId(models[0]?.id ?? models[0]?.model ?? "")
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [judgeRuntimeId])

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
    const start = () => mutate(() => requestRollingSkill("evaluations.start", {
        datasetId,
        selectionMode: "dataset",
        activationMode: "explicit",
        targets: [{runtimeId: targetRuntimeId, modelId: targetModelId || null, effort}],
        judge: {runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort},
    }))
    const inspect = async (runId: string) => {
        setError(null)
        try {
            setDetail(await requestRollingSkill<EvaluationDetail>("evaluations.get", {runId}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("evaluationStartTitle")}</h3><p>{t("evaluationStartDescription")}</p></div></div>
                <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount}</option>)}</select></label>
                <RuntimeSelect t={t} runtimes={runtimes} value={targetRuntimeId} onChange={setTargetRuntimeId} label={t("evaluationRuntime")}/>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={targetModelId} onChange={(event) => setTargetModelId(event.target.value)}>{targetModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={effort} onChange={(event) => setEffort(event.target.value)}>{["low", "medium", "high", "xhigh", "max"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                </div>
                <RuntimeSelect t={t} runtimes={runtimes} value={judgeRuntimeId} onChange={setJudgeRuntimeId} label={t("judgeRuntime")}/>
                <label className="rolling-skill-field"><span>{t("judgeModel")}</span><select className="rolling-skill-select" value={judgeModelId} onChange={(event) => setJudgeModelId(event.target.value)}>{judgeModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <Button variant="outline" disabled={busy || !datasetId || !targetRuntimeId || !judgeRuntimeId} onClick={() => void start()}>{t("startEvaluation")}</Button>
            </section>
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("evaluationRuns")}</h3></div><Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
                <div className="rolling-skill-list">
                    {runs.map((run) => <article className="rolling-skill-list-row" key={run.id}><div><strong>{run.status}</strong><span>{run.id} · {run.caseCount ?? 0} Cases · {run.runtimeCount ?? 0} Runtimes</span></div><div className="rolling-skill-actions"><Button variant="ghost" size="sm" onClick={() => void inspect(run.id)}>{t("details")}</Button>{["queued", "running"].includes(run.status) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("evaluations.cancel", {runId: run.id}))}>{t("cancelRun")}</Button> : null}</div></article>)}
                    {runs.length === 0 ? <p>{t("emptyEvaluations")}</p> : null}
                </div>
            </section>
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("evaluationDetail")} closeLabel={t("cancel")} footer={<Button variant="outline" onClick={() => setDetail(null)}>{t("close")}</Button>}>
                <div className="rolling-skill-list">{detail?.results.map((result) => <article className="rolling-skill-list-row" key={result.id}><div><strong>{result.status}</strong><span>{result.response || result.error || result.id}</span></div></article>)}</div>
            </Modal>
        </div>
    )
}
