import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {RuntimeInteractions} from "./RuntimeInteractions"
import {OperatorScopeControls, INITIAL_OPERATOR_BUDGET, OPERATOR_ACTIONS, operatorBudgetValue, type OperatorDataset, type OperatorSkill} from "./OperatorScopeControls"
import {MarkdownContent} from "./MarkdownContent"
import {loadOperatorSummary} from "./operator-summary"
import {displayStatus} from "./display-state"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Catalog {skills: OperatorSkill[]; repositories: Array<{id: string}>}
interface OperatorSession {id: string; runtime: {displayName: string; version?: string}; modelId?: string; effort?: string | null; updatedAt?: string}
interface OperatorJob {id: string; sessionId: string; status: string; objective?: string}
interface OperatorApproval {id: string; jobId: string; action: string; risk: string; status: string}
interface OperatorSummary {
    sessions: OperatorSession[]
    jobs: OperatorJob[]
    approvals: OperatorApproval[]
    totals: {sessions: number; jobs: number; approvals: number}
}
interface OperatorDetail {
    session: OperatorSession & {transcript?: Array<Record<string, unknown>>}
    parentJob: OperatorJob & {artifactIds?: string[]; error?: unknown}
    state: string
    runtimeThreadId?: string | null
    transport?: unknown
}
interface OperatorArtifact {id: string; jobId: string; name?: string; mediaType?: string; byteLength?: number}

export function OperatorPanel({t, initialSessionId}: {t: Translate; initialSessionId?: string}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [models, setModels] = useState<RuntimeModel[]>([])
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [objective, setObjective] = useState("")
    const [datasets, setDatasets] = useState<OperatorDataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: [], repositories: []})
    const [skillId, setSkillId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [targetRuntimeIds, setTargetRuntimeIds] = useState<string[]>([])
    const [actions, setActions] = useState<string[]>(() => OPERATOR_ACTIONS.map(([action]) => action).filter((action) => action.endsWith(".read")))
    const [budget, setBudget] = useState({...INITIAL_OPERATOR_BUDGET})
    const [summary, setSummary] = useState<OperatorSummary>({
        sessions: [],
        jobs: [],
        approvals: [],
        totals: {sessions: 0, jobs: 0, approvals: 0},
    })
    const [detail, setDetail] = useState<OperatorDetail | null>(null)
    const [artifacts, setArtifacts] = useState<OperatorArtifact[]>([])
    const [artifactPreview, setArtifactPreview] = useState<{id: string; preview: string; mediaType?: string; truncated: boolean} | null>(null)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<OperatorDataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            loadOperatorSummary<OperatorSession, OperatorJob, OperatorApproval>(controller.signal),
            requestRollingSkill<{plugin?: {runtime?: RuntimeDescriptor}}>("settings.get", {}, controller.signal),
        ]).then(([runtimeItems, datasetItems, nextCatalog, nextSummary, settings]) => {
            if (controller.signal.aborted) return
            setRuntimes(runtimeItems)
            setRuntimeId((current) => current || settings.plugin?.runtime?.runtimeId || "")
            setDatasets(datasetItems)
            setCatalog(nextCatalog)
            setSummary(nextSummary)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {if (initialSessionId) void inspect(initialSessionId)}, [initialSessionId])

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
    const start = () => mutate(async () => {
        const selectedSkill = catalog.skills.find((skill) => skill.id === skillId)
        if (skillId && !selectedSkill || datasetId && !datasets.some((dataset) => dataset.id === datasetId && (!skillId || dataset.skillReference?.id === skillId))) throw new Error(t("operatorScopeInvalid"))
        let submittedBudget
        try { submittedBudget = operatorBudgetValue(budget) } catch { throw new Error(t("operatorBudgetInvalid")) }
        const started = await requestRollingSkill<OperatorDetail>("operators.start", {
        runtimeId,
        modelId: modelId || null,
        effort: effort || null,
        objective,
        actions,
        scopes: {
            skillIds: selectedSkill ? [selectedSkill.id] : [],
            datasetIds: datasetId ? [datasetId] : [],
            runtimeIds: targetRuntimeIds,
            repositoryIds: selectedSkill ? [selectedSkill.repositoryId] : [],
        },
        budget: submittedBudget,
        ...(selectedSkill ? {managedSkillBinding: {repositoryId: selectedSkill.repositoryId, skillId: selectedSkill.id}} : {}),
        })
        await inspect(started.session.id)
    })
    const inspect = async (sessionId: string) => {
        setError(null)
        try {
            const next = await requestRollingSkill<OperatorDetail>("operators.get", {sessionId})
            setDetail(next)
            setArtifacts(await requestRollingSkill<OperatorArtifact[]>("operators.artifacts", {jobId: next.parentJob.id}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }
    const openArtifact = async (artifact: OperatorArtifact) => {
        setBusy(true)
        setError(null)
        try {
            setArtifactPreview(await requestRollingSkill("operators.artifact", {jobId: artifact.jobId, artifactId: artifact.id}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally { setBusy(false) }
    }
    const send = async () => {
        if (!detail || !message.trim()) return
        setBusy(true)
        setError(null)
        try {
            await requestRollingSkill("operators.send", {sessionId: detail.session.id, text: message})
            setMessage("")
            await inspect(detail.session.id)
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const parentJob = (sessionId: string) => summary.jobs.find((job) => job.sessionId === sessionId)
    const pendingApprovals = summary.approvals.filter((approval) => approval.status === "pending")
    const approvalsView = (items: OperatorApproval[]) => items.length ? <div className="rolling-skill-subpanel rolling-skill-section-gap"><h4>{t("pendingApprovals")}</h4>{items.map((approval) => {
        const job = summary.jobs.find((item) => item.id === approval.jobId)
        const finalOptimizationApproval = approval.action === "optimization.release-install"
        return <article className="rolling-skill-list-row" key={approval.id}><div><strong>{finalOptimizationApproval ? t("optimizationFinalApproval") : approval.action}</strong><span>{approval.risk}</span></div><div className="rolling-skill-actions"><Button size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "approve", scope: "once"}))}>{t(finalOptimizationApproval ? "optimizationInstallImproved" : "approve")}</Button><Button size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "reject", scope: "once"}))}>{t(finalOptimizationApproval ? "optimizationRestoreOriginal" : "reject")}</Button></div></article>
    })}</div> : null

    useEffect(() => {
        const terminal = (status: string) => ["cancelled", "failed", "succeeded"].includes(status)
        if (!summary.jobs.some((job) => !terminal(job.status)) && (!detail || terminal(detail.parentJob.status))) return
        const controller = new AbortController()
        const timer = window.setInterval(() => {
            void Promise.all([
                loadOperatorSummary<OperatorSession, OperatorJob, OperatorApproval>(controller.signal),
                detail ? requestRollingSkill<OperatorDetail>("operators.get", {sessionId: detail.session.id}, controller.signal) : null,
                detail ? requestRollingSkill<OperatorArtifact[]>("operators.artifacts", {jobId: detail.parentJob.id}, controller.signal) : null,
            ]).then(([nextSummary, nextDetail, nextArtifacts]) => {
                if (controller.signal.aborted) return
                setSummary(nextSummary)
                if (nextDetail) setDetail(nextDetail)
                if (nextArtifacts) setArtifacts(nextArtifacts)
            }).catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        }, 1_500)
        return () => {controller.abort(); window.clearInterval(timer)}
    }, [summary.jobs, detail?.session.id, detail?.parentJob.status])

    return (
        <section className="rolling-skill-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("operatorTitle")}</h3><p>{t("operatorDescription")}</p></div>
                <Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
            </div>
            <label className="rolling-skill-field"><span>{t("operatorRuntime")}</span><select className="rolling-skill-select" value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}><option value="">{t("selectRuntime")}</option>{runtimes.map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.displayName} {runtime.version}</option>)}</select></label>
            <div className="rolling-skill-grid">
                <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">{t("runtimeDefault")}</option>{modelId && !models.some((model) => (model.id ?? model.model) === modelId) ? <option value={modelId}>{modelId}</option> : null}{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={models} modelId={modelId} value={effort} onChange={setEffort}/>
            </div>
            <label className="rolling-skill-field"><span>{t("operatorObjective")}</span><textarea className="rolling-skill-textarea" rows={3} maxLength={32000} value={objective} placeholder={t("operatorObjectivePlaceholder")} onChange={(event) => setObjective(event.target.value)}/></label>
            <OperatorScopeControls t={t} skills={catalog.skills} datasets={datasets} runtimes={runtimes} skillId={skillId} datasetId={datasetId} targetRuntimeIds={targetRuntimeIds} actions={actions} budget={budget} onSkillChange={(value) => {setSkillId(value); if (datasetId && !datasets.some((dataset) => dataset.id === datasetId && (!value || dataset.skillReference?.id === value))) setDatasetId("")}} onDatasetChange={setDatasetId} onTargetsChange={setTargetRuntimeIds} onActionsChange={setActions} onBudgetChange={setBudget}/>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <Button disabled={busy || !runtimeId || !objective.trim()} onClick={() => void start()}>{t("startOperator")}</Button>

            <div className="rolling-skill-list rolling-skill-section-gap">
                {summary.sessions.map((session) => {
                    const job = parentJob(session.id)
                    return <article className="rolling-skill-list-row" key={session.id}><div><strong>{displayStatus(job?.status, t)}</strong><span>{session.runtime.displayName} {session.runtime.version || ""} · {session.modelId || session.id}</span><small>{job?.objective}</small></div><div className="rolling-skill-actions"><Button size="sm" onClick={() => void inspect(session.id)}>{t("details")}</Button>{job?.status === "running" ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.pause", {sessionId: session.id}))}>{t("pause")}</Button> : null}{["paused", "needs_recovery"].includes(job?.status ?? "") ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.resume", {sessionId: session.id}))}>{t("resume")}</Button> : null}{!(["cancelled", "failed", "succeeded"].includes(job?.status ?? "")) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.cancel", {sessionId: session.id}))}>{t("cancelRun")}</Button> : null}</div></article>
                })}
                {summary.sessions.length === 0 ? <p>{t("emptyOperators")}</p> : null}
            </div>
            {!detail ? approvalsView(pendingApprovals) : null}
            {!detail ? <RuntimeInteractions t={t} ownerKind="operator"/> : null}
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("operatorDetail")} closeLabel={t("close")} footer={<Button onClick={() => setDetail(null)}>{t("close")}</Button>}>
                {detail ? <div className="rolling-skill-detail-stack">
                    <p><strong>{displayStatus(detail.parentJob.status, t)}</strong> · {detail.session.runtime.displayName} · {detail.parentJob.objective}</p>
                    <p className="rolling-skill-help">{t("model")}: {detail.session.modelId || t("runtimeDefault")} · {t("effort")}: {detail.session.effort || t("runtimeDefault")}</p>
                    {detail.state === "idle" && detail.parentJob.status === "running" ? <p role="status">{t("operatorReplyReady")}</p> : null}
                    {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                    {approvalsView(pendingApprovals.filter((approval) => summary.jobs.some((job) => job.id === approval.jobId && job.sessionId === detail.session.id)))}
                    <section className="rolling-skill-subpanel"><h4>{t("operatorTranscript")}</h4><div className="rolling-skill-list">{(detail.session.transcript ?? []).filter((entry) => entry.kind === "message").map((entry, index) => <article className="rolling-skill-list-row" key={String(entry.id ?? index)}><div><strong>{entry.role === "user" ? t("reviewer") : "Agent"}</strong><MarkdownContent>{String(entry.content ?? "")}</MarkdownContent></div></article>)}{!detail.session.transcript?.some((entry) => entry.kind === "message") ? <p>{t("emptyOperatorTranscript")}</p> : null}</div><details><summary>{t("runtimeInformation")}</summary>{(detail.session.transcript ?? []).filter((entry) => entry.kind !== "message").map((entry, index) => <pre className="rolling-skill-verbatim" key={String(entry.id ?? index)}>{JSON.stringify(entry, null, 2)}</pre>)}</details></section>
                    <section className="rolling-skill-subpanel"><h4>{t("operatorArtifacts")}</h4><div className="rolling-skill-list">{artifacts.map((artifact) => <article className="rolling-skill-list-row" key={artifact.id}><div><strong>{artifact.name ?? artifact.id}</strong><span>{artifact.mediaType ?? ""} {artifact.byteLength === undefined ? "" : `· ${artifact.byteLength} B`}</span><Button size="sm" disabled={busy} onClick={() => void openArtifact(artifact)}>{t("details")}</Button>{artifactPreview?.id === artifact.id ? <section>{artifactPreview.mediaType?.includes("markdown") ? <MarkdownContent>{artifactPreview.preview}</MarkdownContent> : <pre className="rolling-skill-verbatim">{artifactPreview.preview}</pre>}{artifactPreview.truncated ? <p>{t("artifactPreviewTruncated")}</p> : null}</section> : null}</div></article>)}{artifacts.length === 0 ? <p>{t("emptyOperatorArtifacts")}</p> : null}</div></section>
                    {!(["cancelled", "failed", "succeeded"].includes(detail.parentJob.status)) ? <div className="rolling-skill-actions"><Input value={message} placeholder={t("operatorFollowUp")} onChange={(event: {target: {value: string}}) => setMessage(event.target.value)}/><Button disabled={busy || !message.trim()} onClick={() => void send()}>{t("send")}</Button></div> : null}
                    <RuntimeInteractions t={t} ownerKind="operator" ownerId={detail.session.id}/>
                </div> : null}
            </Modal>
        </section>
    )
}
