import {Button, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {
    id: string
    name: string
    caseCount: number
    skillReference: {
        evidencePrecision?: string
        id?: string
        repositoryId?: string
        name?: string
    } | null
}
interface Version {
    id: string
    skillId: string
    state: "candidate" | "released"
    versionLabel: string | null
    deprecatedAt?: string | null
}
interface VersionPage {versions: Version[]; nextCursor: string | null}
interface Installation {
    runtimeId: string
    providerId: string | null
    versionId: string | null
    verification: string
}
interface InstallationOverview {matrix: Installation[]}
interface EvaluationSummary {
    id: string
    datasetId: string
    status: string
    caseCount: number
    runtimeCount: number
    createdAt: string
}
interface EvaluationDetail extends EvaluationSummary {
    results: Array<{id: string; status: string; gradingStatus?: string; question?: string; response?: string; error?: string; gradingError?: string; durationMs?: number; computedScore?: {totalScore?: number; overallVerdict?: string}; judgment?: unknown; traceEvidence?: unknown}>
    skillEvidence?: unknown
    runtimeConfigurations?: unknown[]
    judgeConfiguration?: unknown
}

export function EvaluationsPanel({t, initialRunId}: {t: Translate; initialRunId?: string}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [runs, setRuns] = useState<EvaluationSummary[]>([])
    const [targetRuntimeId, setTargetRuntimeId] = useState("")
    const [targetRuntimeIds, setTargetRuntimeIds] = useState<string[]>([])
    const [judgeRuntimeId, setJudgeRuntimeId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [versions, setVersions] = useState<Version[]>([])
    const [versionId, setVersionId] = useState("")
    const [installations, setInstallations] = useState<Installation[]>([])
    const [targetModels, setTargetModels] = useState<RuntimeModel[]>([])
    const [judgeModels, setJudgeModels] = useState<RuntimeModel[]>([])
    const [targetModelId, setTargetModelId] = useState("")
    const [judgeModelId, setJudgeModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [judgeEffort, setJudgeEffort] = useState("")
    const [activationMode, setActivationMode] = useState<"explicit" | "automatic">("explicit")
    const [caseScope, setCaseScope] = useState<"all" | "goodcase" | "badcase">("all")
    const [caseIds, setCaseIds] = useState<string[]>([])
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
            setTargetRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : [])
            setJudgeRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setDatasetId((current) => current || datasetItems[0]?.id || "")
            if (initialRunId) void inspect(initialRunId)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialRunId])

    const selectedDataset = useMemo(
        () => datasets.find((dataset) => dataset.id === datasetId) ?? null,
        [datasets, datasetId],
    )

    useEffect(() => {
        const skillId = selectedDataset?.skillReference?.evidencePrecision === "managed"
            ? selectedDataset.skillReference.id
            : null
        if (!skillId) {
            setVersions([])
            setVersionId("")
            setInstallations([])
            return
        }
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<VersionPage>("skills.versions", {
                skillIds: [skillId],
                skillId,
                limit: 100,
            }, controller.signal),
            requestRollingSkill<InstallationOverview>("installations.list", {skillId}, controller.signal),
        ]).then(([page, overview]) => {
            const released = page.versions.filter(
                (version) => version.state === "released" && !version.deprecatedAt,
            )
            setVersions(released)
            setVersionId((current) => released.some((version) => version.id === current)
                ? current
                : released[0]?.id ?? "")
            setInstallations(overview.matrix)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [selectedDataset, revision])

    useEffect(() => {
        if (!datasetId) return
        const controller = new AbortController()
        requestRollingSkill<{items: Array<{id: string}>}>("cases.list", {datasetId, caseScope, pageSize: 200}, controller.signal)
            .then((page) => setCaseIds(page.items.map((entry) => entry.id)))
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [datasetId, caseScope, revision])

    useEffect(() => {
        if (!targetRuntimeId) return
        const controller = new AbortController()
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId: targetRuntimeId}, controller.signal)
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
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId: judgeRuntimeId}, controller.signal)
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
    const selectedInstallations = targetRuntimeIds.map((selectedRuntimeId) => installations.find((installation) =>
        installation.runtimeId === selectedRuntimeId &&
        installation.versionId === versionId &&
        installation.verification !== "none",
    ) ?? null)
    const installationsReady = targetRuntimeIds.length > 0 && selectedInstallations.every(Boolean)
    const start = () => mutate(() => requestRollingSkill("evaluations.start", {
        datasetId,
        versionId,
        caseIds: caseScope === "all" ? [] : caseIds,
        selectionMode: caseScope === "all" ? "dataset" : "selected",
        activationMode,
        targets: targetRuntimeIds.map((runtimeId) => ({runtimeId, modelId: runtimeId === targetRuntimeId ? targetModelId || null : null, effort: effort || null})),
        judge: {runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort: judgeEffort || null},
    }))
    const inspect = async (runId: string) => {
        setError(null)
        try {
            setDetail(await requestRollingSkill<EvaluationDetail>("evaluations.get", {runId}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }

    useEffect(() => {
        if (!runs.some((run) => ["queued", "running"].includes(run.status))) return
        const timer = window.setInterval(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearInterval(timer)
    }, [runs])

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("evaluationStartTitle")}</h3><p>{t("evaluationStartDescription")}</p></div></div>
                <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name} · {dataset.caseCount}</option>)}</select></label>
                <label className="rolling-skill-field"><span>{t("evaluationVersion")}</span><select className="rolling-skill-select" value={versionId} onChange={(event) => setVersionId(event.target.value)}>{versions.map((version) => <option key={version.id} value={version.id}>{version.versionLabel ?? version.id}</option>)}</select></label>
                <label className="rolling-skill-field"><span>{t("evaluationCaseScope")}</span><select className="rolling-skill-select" value={caseScope} onChange={(event) => setCaseScope(event.target.value as typeof caseScope)}><option value="all">{t("allCases")}</option><option value="goodcase">{t("goodcase")}</option><option value="badcase">{t("badcase")}</option></select></label>
                <label className="rolling-skill-field"><span>{t("activationMode")}</span><select className="rolling-skill-select" value={activationMode} onChange={(event) => setActivationMode(event.target.value as typeof activationMode)}><option value="explicit">{t("explicitActivation")}</option><option value="automatic">{t("automaticActivation")}</option></select></label>
                <EvaluationRuntimeMatrix t={t} runtimes={runtimes} values={targetRuntimeIds} primary={targetRuntimeId} onChange={(values) => {setTargetRuntimeIds(values); setTargetRuntimeId((current) => values.includes(current) ? current : values[0] ?? "")}} onPrimary={setTargetRuntimeId}/>
                <p className={installationsReady ? "rolling-skill-inline-success" : "rolling-skill-inline-error"}>{installationsReady ? t("installationReady") : t("installationMissing")}</p>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={targetModelId} onChange={(event) => setTargetModelId(event.target.value)}>{targetModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={targetModels} modelId={targetModelId} value={effort} onChange={setEffort}/>
                </div>
                <RuntimeSelect t={t} runtimes={runtimes} value={judgeRuntimeId} onChange={setJudgeRuntimeId} label={t("judgeRuntime")}/>
                <div className="rolling-skill-grid"><label className="rolling-skill-field"><span>{t("judgeModel")}</span><select className="rolling-skill-select" value={judgeModelId} onChange={(event) => setJudgeModelId(event.target.value)}>{judgeModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label><ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={judgeModels} modelId={judgeModelId} value={judgeEffort} onChange={setJudgeEffort}/></div>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <Button variant="outline" disabled={busy || !datasetId || !versionId || !targetRuntimeId || !judgeRuntimeId || !installationsReady || (caseScope !== "all" && caseIds.length === 0)} onClick={() => void start()}>{t("startEvaluation")}</Button>
            </section>
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("evaluationRuns")}</h3></div><Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
                <div className="rolling-skill-list">
                    {runs.map((run) => <article className="rolling-skill-list-row" key={run.id}><div><strong>{run.status}</strong><span>{run.id} · {run.caseCount ?? 0} Cases · {run.runtimeCount ?? 0} Runtimes</span></div><div className="rolling-skill-actions"><Button variant="ghost" size="sm" onClick={() => void inspect(run.id)}>{t("details")}</Button>{["queued", "running"].includes(run.status) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("evaluations.cancel", {runId: run.id}))}>{t("cancelRun")}</Button> : <Button variant="ghost" size="sm" disabled={busy} onClick={() => {if (window.confirm(t("deleteEvaluationConfirm"))) void mutate(() => requestRollingSkill("evaluations.delete", {runId: run.id}))}}>{t("delete")}</Button>}</div></article>)}
                    {runs.length === 0 ? <p>{t("emptyEvaluations")}</p> : null}
                </div>
            </section>
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("evaluationDetail")} closeLabel={t("cancel")} footer={<Button variant="outline" onClick={() => setDetail(null)}>{t("close")}</Button>}>
                {detail ? <div className="rolling-skill-detail-stack"><pre>{JSON.stringify({skillEvidence: detail.skillEvidence, runtimeConfigurations: detail.runtimeConfigurations, judgeConfiguration: detail.judgeConfiguration}, null, 2)}</pre><div className="rolling-skill-list">{detail.results.map((result) => <article className="rolling-skill-list-row" key={result.id}><div><strong>{result.computedScore?.totalScore ?? t("notAvailable")} · {result.status} / {result.gradingStatus ?? t("notAvailable")}</strong><span className="rolling-skill-verbatim">{result.question}</span><span>{result.response || result.error || result.gradingError || result.id}</span><small>{result.durationMs !== undefined ? `${result.durationMs} ms` : ""}</small><pre>{JSON.stringify({computedScore: result.computedScore ?? null, judgment: result.judgment ?? null, traceEvidence: result.traceEvidence ?? null}, null, 2)}</pre></div></article>)}</div></div> : null}
            </Modal>
        </div>
    )
}

function EvaluationRuntimeMatrix({t, runtimes, values, primary, onChange, onPrimary}: {t: Translate; runtimes: RuntimeDescriptor[]; values: string[]; primary: string; onChange: (values: string[]) => void; onPrimary: (value: string) => void}) {
    return <fieldset className="rolling-skill-runtime-select"><legend>{t("evaluationRuntime")}</legend><div className="rolling-skill-runtime-list">{runtimes.map((runtime) => <label className="rolling-skill-runtime-option" key={runtime.runtimeId}><input type="checkbox" checked={values.includes(runtime.runtimeId)} onChange={(event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId))}/><span><strong>{runtime.displayName} {runtime.version}</strong><code>{runtime.executablePath}</code>{values.includes(runtime.runtimeId) ? <button type="button" className="rolling-skill-link-button" aria-pressed={primary === runtime.runtimeId} onClick={(event) => {event.preventDefault(); onPrimary(runtime.runtimeId)}}>{primary === runtime.runtimeId ? t("primaryRuntime") : t("makePrimaryRuntime")}</button> : null}</span></label>)}{runtimes.length === 0 ? <p>{t("noRuntimes")}</p> : null}</div></fieldset>
}
