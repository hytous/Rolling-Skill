import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {RuntimeInteractions} from "./RuntimeInteractions"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string}
interface Skill {id: string; repositoryId: string}
interface Catalog {skills: Skill[]; repositories: Array<{id: string}>}
interface OperatorSession {id: string; runtime: {displayName: string; version?: string}; modelId?: string; updatedAt?: string}
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
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: [], repositories: []})
    const [summary, setSummary] = useState<OperatorSummary>({
        sessions: [],
        jobs: [],
        approvals: [],
        totals: {sessions: 0, jobs: 0, approvals: 0},
    })
    const [detail, setDetail] = useState<OperatorDetail | null>(null)
    const [artifacts, setArtifacts] = useState<OperatorArtifact[]>([])
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<OperatorSummary>("operators.summary", {limit: 100}, controller.signal),
        ]).then(([runtimeItems, datasetItems, nextCatalog, nextSummary]) => {
            setRuntimes(runtimeItems)
            setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setDatasets(datasetItems)
            setCatalog(nextCatalog)
            setSummary(nextSummary)
            if (initialSessionId) void inspect(initialSessionId)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialSessionId])

    useEffect(() => {
        if (!runtimeId) return
        const controller = new AbortController()
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId}, controller.signal)
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
    const start = () => mutate(() => requestRollingSkill("operators.start", {
        runtimeId,
        modelId: modelId || null,
        effort: effort || null,
        objective,
        actions: [
            "raw_cases.read",
            "raw_cases.write",
            "runtimes.read",
            "datasets.read",
            "evaluations.read",
            "evaluations.execute",
            "skills.read",
            "approvals.resolve",
            "jobs.control",
            "optimizations.read",
            "optimizations.execute",
        ],
        scopes: {
            skillIds: catalog.skills.map((skill) => skill.id),
            datasetIds: datasets.map((dataset) => dataset.id),
            runtimeIds: runtimes.map((runtime) => runtime.runtimeId),
            repositoryIds: catalog.repositories.map((repository) => repository.id),
        },
        budget: {
            maxDurationMs: 60 * 60 * 1000,
            maxRuntimeTurns: 100,
            maxEvaluations: 20,
            maxTargetExecutions: 200,
            maxJudgeExecutions: 40,
            maxTokens: null,
            maxReportedCost: null,
        },
    }))
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

    useEffect(() => {
        if (!summary.jobs.some((job) => !["cancelled", "failed", "succeeded"].includes(job.status))) return
        const timer = window.setInterval(() => {
            setRevision((value) => value + 1)
            if (detail) void inspect(detail.session.id)
        }, 1_500)
        return () => window.clearInterval(timer)
    }, [summary.jobs, detail?.session.id])

    return (
        <section className="rolling-skill-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("operatorTitle")}</h3><p>{t("operatorDescription")}</p></div>
                <Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
            </div>
            <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("operatorRuntime")}/>
            <div className="rolling-skill-grid">
                <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={models} modelId={modelId} value={effort} onChange={setEffort}/>
            </div>
            <label className="rolling-skill-field"><span>{t("operatorObjective")}</span><Input value={objective} placeholder={t("operatorObjectivePlaceholder")} onChange={(event: {target: {value: string}}) => setObjective(event.target.value)}/></label>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <Button disabled={busy || !runtimeId || !objective.trim()} onClick={() => void start()}>{t("startOperator")}</Button>

            <div className="rolling-skill-list rolling-skill-section-gap">
                {summary.sessions.map((session) => {
                    const job = parentJob(session.id)
                    return <article className="rolling-skill-list-row" key={session.id}><div><strong>{job?.status ?? t("notAvailable")}</strong><span>{session.runtime.displayName} {session.runtime.version || ""} · {session.modelId || session.id}</span><small>{job?.objective}</small></div><div className="rolling-skill-actions"><Button size="sm" onClick={() => void inspect(session.id)}>{t("details")}</Button>{job?.status === "running" ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.pause", {sessionId: session.id}))}>{t("pause")}</Button> : null}{["paused", "needs_recovery"].includes(job?.status ?? "") ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.resume", {sessionId: session.id}))}>{t("resume")}</Button> : null}{!(["cancelled", "failed", "succeeded"].includes(job?.status ?? "")) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.cancel", {sessionId: session.id}))}>{t("cancelRun")}</Button> : null}</div></article>
                })}
                {summary.sessions.length === 0 ? <p>{t("emptyOperators")}</p> : null}
            </div>
            {pendingApprovals.length ? <div className="rolling-skill-subpanel rolling-skill-section-gap"><h4>{t("pendingApprovals")}</h4>{pendingApprovals.map((approval) => {const job = summary.jobs.find((item) => item.id === approval.jobId); return <article className="rolling-skill-list-row" key={approval.id}><div><strong>{approval.action}</strong><span>{approval.risk}</span></div><div className="rolling-skill-actions"><Button size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "approve", scope: "once"}))}>{t("approve")}</Button><Button size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "reject", scope: "once"}))}>{t("reject")}</Button></div></article>})}</div> : null}
            <RuntimeInteractions t={t} ownerKind="operator"/>
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("operatorDetail")} closeLabel={t("close")} footer={<Button onClick={() => setDetail(null)}>{t("close")}</Button>}>
                {detail ? <div className="rolling-skill-detail-stack">
                    <p><strong>{detail.state}</strong> · {detail.session.runtime.displayName} · {detail.parentJob.objective}</p>
                    <section className="rolling-skill-subpanel"><h4>{t("operatorTranscript")}</h4><div className="rolling-skill-list">{(detail.session.transcript ?? []).map((entry, index) => <article className="rolling-skill-list-row" key={String(entry.id ?? index)}><div><strong>{String(entry.kind ?? t("notAvailable"))}</strong><pre>{JSON.stringify(entry, null, 2)}</pre></div></article>)}{!detail.session.transcript?.length ? <p>{t("emptyOperatorTranscript")}</p> : null}</div></section>
                    <section className="rolling-skill-subpanel"><h4>{t("operatorArtifacts")}</h4><div className="rolling-skill-list">{artifacts.map((artifact) => <article className="rolling-skill-list-row" key={artifact.id}><div><strong>{artifact.name ?? artifact.id}</strong><span>{artifact.mediaType ?? ""} {artifact.byteLength === undefined ? "" : `· ${artifact.byteLength} B`}</span></div></article>)}{artifacts.length === 0 ? <p>{t("emptyOperatorArtifacts")}</p> : null}</div></section>
                    {!(["cancelled", "failed", "succeeded"].includes(detail.parentJob.status)) ? <div className="rolling-skill-actions"><Input value={message} placeholder={t("operatorFollowUp")} onChange={(event: {target: {value: string}}) => setMessage(event.target.value)}/><Button disabled={busy || !message.trim()} onClick={() => void send()}>{t("send")}</Button></div> : null}
                </div> : null}
            </Modal>
        </section>
    )
}
