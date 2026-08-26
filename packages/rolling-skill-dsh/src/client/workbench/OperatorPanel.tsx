import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string}
interface Skill {id: string; repositoryId: string}
interface Catalog {skills: Skill[]; repositories: Array<{id: string}>}
interface Model {id?: string; model?: string; displayName?: string}
interface OperatorSession {id: string; runtime: {displayName: string; version?: string}; modelId?: string; updatedAt?: string}
interface OperatorJob {id: string; sessionId: string; status: string; objective?: string}
interface OperatorApproval {id: string; jobId: string; action: string; risk: string; status: string}
interface OperatorSummary {
    sessions: OperatorSession[]
    jobs: OperatorJob[]
    approvals: OperatorApproval[]
    totals: {sessions: number; jobs: number; approvals: number}
}

export function OperatorPanel({t}: {t: Translate}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [models, setModels] = useState<Model[]>([])
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("high")
    const [objective, setObjective] = useState("")
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: [], repositories: []})
    const [summary, setSummary] = useState<OperatorSummary>({
        sessions: [],
        jobs: [],
        approvals: [],
        totals: {sessions: 0, jobs: 0, approvals: 0},
    })
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
    const start = () => mutate(() => requestRollingSkill("operators.start", {
        runtimeId,
        modelId: modelId || null,
        effort,
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
    const parentJob = (sessionId: string) => summary.jobs.find((job) => job.sessionId === sessionId)
    const pendingApprovals = summary.approvals.filter((approval) => approval.status === "pending")

    return (
        <section className="rolling-skill-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("operatorTitle")}</h3><p>{t("operatorDescription")}</p></div>
                <Button variant="ghost" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
            </div>
            <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("operatorRuntime")}/>
            <div className="rolling-skill-grid">
                <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => setModelId(event.target.value)}>{models.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={effort} onChange={(event) => setEffort(event.target.value)}>{["low", "medium", "high", "xhigh", "max"].map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            </div>
            <label className="rolling-skill-field"><span>{t("operatorObjective")}</span><Input value={objective} placeholder={t("operatorObjectivePlaceholder")} onChange={(event: {target: {value: string}}) => setObjective(event.target.value)}/></label>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <Button variant="outline" disabled={busy || !runtimeId || !objective.trim()} onClick={() => void start()}>{t("startOperator")}</Button>

            <div className="rolling-skill-list rolling-skill-section-gap">
                {summary.sessions.map((session) => {
                    const job = parentJob(session.id)
                    return <article className="rolling-skill-list-row" key={session.id}><div><strong>{job?.status ?? t("notAvailable")}</strong><span>{session.runtime.displayName} {session.runtime.version || ""} · {session.modelId || session.id}</span><small>{job?.objective}</small></div><div className="rolling-skill-actions">{job?.status === "running" ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.pause", {sessionId: session.id}))}>{t("pause")}</Button> : null}{["paused", "needs_recovery"].includes(job?.status ?? "") ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.resume", {sessionId: session.id}))}>{t("resume")}</Button> : null}{!(["cancelled", "failed", "succeeded"].includes(job?.status ?? "")) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("operators.cancel", {sessionId: session.id}))}>{t("cancelRun")}</Button> : null}</div></article>
                })}
                {summary.sessions.length === 0 ? <p>{t("emptyOperators")}</p> : null}
            </div>
            {pendingApprovals.length ? <div className="rolling-skill-subpanel rolling-skill-section-gap"><h4>{t("pendingApprovals")}</h4>{pendingApprovals.map((approval) => {const job = summary.jobs.find((item) => item.id === approval.jobId); return <article className="rolling-skill-list-row" key={approval.id}><div><strong>{approval.action}</strong><span>{approval.risk}</span></div><div className="rolling-skill-actions"><Button variant="outline" size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "approve", scope: "once"}))}>{t("approve")}</Button><Button variant="ghost" size="sm" disabled={busy || !job} onClick={() => void mutate(() => requestRollingSkill("operators.approve", {sessionId: job?.sessionId, approvalId: approval.id, decision: "reject", scope: "once"}))}>{t("reject")}</Button></div></article>})}</div> : null}
        </section>
    )
}
