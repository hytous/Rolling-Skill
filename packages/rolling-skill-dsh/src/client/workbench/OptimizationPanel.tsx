import {Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {RuntimeDescriptor} from "./RuntimeSelect"
import {initialOptimizationTuning, optimizationNumericLimits, OptimizationRuntimeFields, OptimizationStoppingFields, OptimizationTargets} from "./OptimizationSetupFields"
import type {OptimizationProfile, OptimizationTuning} from "./OptimizationSetupFields"
import {displayDateTime, displayStatus} from "./display-state"
import {MarkdownContent} from "./MarkdownContent"
import {loadOperatorSummary} from "./operator-summary"
import type {WorkbenchRoute} from "./Workbench"

const TERMINAL_RUN_STATES = new Set(["succeeded", "completed", "failed", "cancelled"])

interface Dataset {id: string; name: string; skillReference?: {id?: string; repositoryId?: string}; activeRubricVersionId?: string | null}
interface Skill {id: string; repositoryId: string; name: string}
interface Version {id: string; skillId: string; repositoryId: string; state: string; versionLabel?: string | null}
interface Catalog {skills: Skill[]}
interface SkillDetail {skill: Skill; versions: Version[]}
interface OptimizationRun {id: string; state: string; skillId?: string; datasetId?: string; createdAt?: string; currentEpoch?: number; revision?: number; error?: {message?: string} | null}
interface OperatorJob {id: string; sessionId: string}
interface OperatorApproval {id: string; jobId: string; action: string; risk: string; status: string}
interface OperatorSummary {jobs: OperatorJob[]; approvals: OperatorApproval[]}
interface OptimizationEpoch {
    number: number
    status: string
    candidate?: {versionId?: string; commit?: string; contentDigest?: string}
    installations?: Array<{runtimeId?: string; status?: string; installationJobId?: string}>
    analysis?: {score?: number; scoreDelta?: number; passRate?: number; regressionCount?: number; executionFailureCount?: number; gradingFailureCount?: number}
    decision?: {action?: string; rationale?: string}
}
interface OptimizationDetail extends OptimizationRun {
    snapshotDigest?: string
    optimizationDirection?: string | null
    playbook?: {id: string; version: number; digest: string}
    baseline?: unknown
    dataset?: unknown
    rubric?: unknown
    operator?: unknown
    targets?: Array<{runtimeId?: string}>
    judge?: unknown
    checkpoint?: {operatorSessionId?: string; activeEvaluationRunId?: string; installationOperation?: string; installationPending?: boolean; installationJobIds?: string[]}
    epochs?: OptimizationEpoch[]
}
interface OptimizationReport {artifactId: string | null; digest: string; mediaType: string; preview?: string}

function optimizationPhaseLabel(run: OptimizationDetail, t: Translate): string {
    if (["editing", "installing", "restoring"].includes(run.state) && run.checkpoint?.installationPending) {
        if (run.checkpoint.installationOperation === "experiment_inspect") return t("optimizationInspectingInstallation")
        if (run.checkpoint.installationOperation === "experiment_install") return t("optimizationInstallingCandidate")
        return t("optimizationRestoringInstallation")
    }
    return displayStatus(run.state, t)
}

export function OptimizationPanel({t, initialRunId, onNavigate}: {t: Translate; initialRunId?: string; onNavigate?: (route: WorkbenchRoute) => void}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [catalog, setCatalog] = useState<Catalog>({skills: []})
    const [detail, setDetail] = useState<SkillDetail | null>(null)
    const [runs, setRuns] = useState<OptimizationRun[]>([])
    const [operatorSummary, setOperatorSummary] = useState<OperatorSummary>({jobs: [], approvals: []})
    const [skillId, setSkillId] = useState("")
    const [versionId, setVersionId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [operator, setOperator] = useState<OptimizationProfile>({runtimeId: "", modelId: "", effort: ""})
    const [targets, setTargets] = useState<OptimizationProfile[]>([{runtimeId: "", modelId: "", effort: ""}])
    const [judge, setJudge] = useState<OptimizationProfile>({runtimeId: "", modelId: "", effort: ""})
    const [tuning, setTuning] = useState<OptimizationTuning>(initialOptimizationTuning)
    const [optimizationDirection, setOptimizationDirection] = useState("")
    const initialized = useRef(false)
    const [runDetail, setRunDetail] = useState<OptimizationDetail | null>(null)
    const [report, setReport] = useState<(OptimizationReport & {runId: string}) | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [pollError, setPollError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<OptimizationRun[]>("optimizations.list", {}, controller.signal),
            loadOperatorSummary<never, OperatorJob, OperatorApproval>(controller.signal),
            requestRollingSkill<{plugin: {runtime?: {runtimeId?: string}}; rollingSkill: {judgeProfile?: {modelId?: string; effort?: string}}}>("settings.get", {}, controller.signal),
        ]).then(([runtimeItems, datasetItems, nextCatalog, nextRuns, nextOperatorSummary, settings]) => {
            if (controller.signal.aborted) return
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setCatalog(nextCatalog)
            setRuns(nextRuns)
            setOperatorSummary(nextOperatorSummary)
            if (!initialized.current) {
                const runtimeId = settings.plugin.runtime?.runtimeId ?? ""
                setOperator({runtimeId, modelId: "", effort: ""})
                setJudge({runtimeId, modelId: settings.rollingSkill.judgeProfile?.modelId ?? "", effort: settings.rollingSkill.judgeProfile?.effort ?? ""})
                initialized.current = true
            }
            setSkillId((current) => current || nextCatalog.skills[0]?.id || "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {if (initialRunId) void inspect(initialRunId)}, [initialRunId])

    useEffect(() => {
        if (!skillId) {
            setDetail(null)
            return
        }
        const controller = new AbortController()
        requestRollingSkill<SkillDetail>("skills.get", {skillId}, controller.signal)
            .then((next) => {
                if (controller.signal.aborted) return
                setDetail(next)
                const released = next.versions.find((version) => version.state === "released")
                setVersionId((current) => next.versions.some((version) => version.id === current && version.state === "released")
                    ? current : released?.id ?? "")
                const matching = datasets.filter((dataset) => (
                    dataset.skillReference?.id === next.skill.id &&
                    dataset.skillReference?.repositoryId === next.skill.repositoryId &&
                    Boolean(dataset.activeRubricVersionId)
                ))
                setDatasetId((current) => matching.some((dataset) => dataset.id === current)
                    ? current : matching[0]?.id ?? "")
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
        operator: {...operator, effort: operator.effort || null},
        targets: targets.map((target) => ({...target, effort: target.effort || null})),
        judge: {...judge, effort: judge.effort || null},
        activationMode: tuning.activationMode,
        optimizationDirection: optimizationDirection.trim() || null,
        ...optimizationNumericLimits(tuning),
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
    const start = () => mutate(async () => {
        const result = await requestRollingSkill<{run: OptimizationDetail}>("optimizations.start", {
            ...configuration(),
            idempotencyKey: `dsh-${Date.now()}`,
        })
        setRunDetail(result.run)
        setOptimizationDirection("")
    })
    const inspect = async (runId: string) => {
        setError(null)
        try {
            const next = await requestRollingSkill<{run: OptimizationDetail}>("optimizations.get", {runId})
            setRunDetail(next.run)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }
    const generateReport = async () => {
        if (!runDetail) return
        setBusy(true)
        setError(null)
        try {
            const result = await requestRollingSkill<{report: OptimizationReport}>("optimizations.report", {runId: runDetail.id})
            setReport({...result.report, runId: runDetail.id})
            const next = await requestRollingSkill<{run: OptimizationDetail}>("optimizations.get", {runId: runDetail.id})
            setRunDetail(next.run)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const finalApproval = useMemo(() => {
        const sessionId = runDetail?.checkpoint?.operatorSessionId
        if (!sessionId) return null
        const jobIds = new Set(operatorSummary.jobs.filter((job) => job.sessionId === sessionId).map((job) => job.id))
        return operatorSummary.approvals.find((approval) => (
            approval.status === "pending" &&
            approval.action === "optimization.release-install" &&
            jobIds.has(approval.jobId)
        )) ?? null
    }, [operatorSummary, runDetail?.checkpoint?.operatorSessionId])
    const finalApprovalEpoch = useMemo(() => {
        const epochs = runDetail?.epochs ?? []
        return epochs.find((epoch) => epoch.number === runDetail?.currentEpoch) ?? epochs.at(-1) ?? null
    }, [runDetail?.currentEpoch, runDetail?.epochs])
    const resolveFinalApproval = async (decision: "approve" | "reject") => {
        if (!runDetail || !finalApproval) return
        const job = operatorSummary.jobs.find((item) => item.id === finalApproval.jobId)
        if (!job) return
        setBusy(true)
        setError(null)
        try {
            await requestRollingSkill("operators.approve", {
                sessionId: job.sessionId,
                approvalId: finalApproval.id,
                decision,
                scope: "once",
            })
            const [nextSummary, nextRuns, nextDetail] = await Promise.all([
                loadOperatorSummary<never, OperatorJob, OperatorApproval>(),
                requestRollingSkill<OptimizationRun[]>("optimizations.list", {}),
                requestRollingSkill<{run: OptimizationDetail}>("optimizations.get", {runId: runDetail.id}),
            ])
            setOperatorSummary(nextSummary)
            setRuns(nextRuns)
            setRunDetail(nextDetail.run)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    let validLimits = true
    try {optimizationNumericLimits(tuning)} catch {validLimits = false}
    const completeProfile = (profile: OptimizationProfile) => Boolean(profile.runtimeId && profile.modelId)
    const ready = Boolean(skillId && versionId && datasetId && validLimits &&
        completeProfile(operator) && completeProfile(judge) && targets.length && targets.every(completeProfile) &&
        new Set(targets.map((target) => target.runtimeId)).size === targets.length)

    useEffect(() => {
        if (!runs.some((run) => !TERMINAL_RUN_STATES.has(run.state)) &&
            (!runDetail || TERMINAL_RUN_STATES.has(runDetail.state))) return
        const controller = new AbortController()
        const timer = window.setInterval(() => {
            void Promise.all([
                requestRollingSkill<OptimizationRun[]>("optimizations.list", {}, controller.signal),
                runDetail ? requestRollingSkill<{run: OptimizationDetail}>("optimizations.get", {runId: runDetail.id}, controller.signal) : null,
                loadOperatorSummary<never, OperatorJob, OperatorApproval>(controller.signal),
            ]).then(([nextRuns, nextDetail, nextOperatorSummary]) => {
                if (controller.signal.aborted) return
                setRuns(nextRuns)
                if (nextDetail) setRunDetail(nextDetail.run)
                setOperatorSummary(nextOperatorSummary)
                setPollError(null)
            }).catch((reason: unknown) => {
                if (!controller.signal.aborted) setPollError(reason instanceof Error ? reason.message : t("loadError"))
            })
        }, 1_500)
        return () => {controller.abort(); window.clearInterval(timer)}
    }, [runs, runDetail?.id, runDetail?.state])

    if (!initialized.current) return <section className="rolling-skill-panel"><h3>{t("optimizationTitle")}</h3>{error
        ? <><p role="alert">{error}</p><Button onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button></>
        : <p role="status">{t("loading")}</p>}</section>

    return (
        <section className="rolling-skill-panel">
            <div className="rolling-skill-panel-header"><div><h3>{t("optimizationTitle")}</h3><p>{t("optimizationDescription")}</p></div><Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
            <div className="rolling-skill-grid">
                <label className="rolling-skill-field"><span>{t("optimizationSkill")}</span><select className="rolling-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>{catalog.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label>
                <label className="rolling-skill-field"><span>{t("optimizationBaseline")}</span><select className="rolling-skill-select" value={versionId} onChange={(event) => setVersionId(event.target.value)}>{released.map((version) => <option key={version.id} value={version.id}>{version.versionLabel || version.id}</option>)}</select></label>
            </div>
            <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{compatibleDatasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
            <label className="rolling-skill-field rolling-skill-optimization-direction"><span>{t("optimizationDirection")}</span><textarea className="rolling-skill-textarea" maxLength={8_000} value={optimizationDirection} placeholder={t("optimizationDirectionPlaceholder")} onChange={(event) => setOptimizationDirection(event.target.value)}/><small className="rolling-skill-help">{t("optimizationDirectionHelp")}</small></label>
            <div className="rolling-skill-data-stack rolling-skill-section-gap">
                <OptimizationRuntimeFields label={t("operatorRuntime")} profile={operator} onChange={setOperator} runtimes={runtimes} t={t}/>
                <OptimizationTargets targets={targets} onChange={setTargets} runtimes={runtimes} t={t}/>
                <OptimizationRuntimeFields label={t("judgeRuntime")} profile={judge} onChange={setJudge} runtimes={runtimes} t={t}/>
                <OptimizationStoppingFields value={tuning} onChange={setTuning} t={t}/>
            </div>
            {!validLimits ? <p role="alert">{t("optimizationInvalidLimits")}</p> : null}
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            {pollError ? <p className="rolling-skill-inline-error" role="alert">{pollError}</p> : null}
            <div className="rolling-skill-actions"><Button disabled={busy || !ready} onClick={() => void start()}>{t("startOptimization")}</Button></div>
            <div className="rolling-skill-list rolling-skill-section-gap">
                {runs.map((run) => <article className="rolling-skill-list-row" key={run.id} title={run.id}><div><strong>{displayStatus(run.state, t)}</strong><span>{catalog.skills.find((item) => item.id === run.skillId)?.name ?? t("optimizationTitle")} · {datasets.find((item) => item.id === run.datasetId)?.name ?? ""}</span><small>{displayDateTime(run.createdAt, t("notAvailable"))} · {t("optimizationRound")} {run.currentEpoch ?? 0}</small>{run.error?.message ? <small>{run.error.message}</small> : null}</div><div className="rolling-skill-actions"><Button size="sm" onClick={() => void inspect(run.id)}>{t("details")}</Button>{!["paused", "needs_recovery", "waiting_approval"].includes(run.state) && !TERMINAL_RUN_STATES.has(run.state) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.pause", {runId: run.id}))}>{t("pause")}</Button> : null}{["paused", "needs_recovery"].includes(run.state) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.resume", {runId: run.id}))}>{t("resume")}</Button> : null}{run.state !== "waiting_approval" && !TERMINAL_RUN_STATES.has(run.state) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("optimizations.cancel", {runId: run.id}))}>{t("cancelRun")}</Button> : null}</div></article>)}
                {runs.length === 0 ? <p>{t("emptyOptimizations")}</p> : null}
            </div>
            <Modal open={runDetail !== null} onClose={() => setRunDetail(null)} title={t("optimizationDetail")} closeLabel={t("close")} footer={<><Button disabled={busy} onClick={() => void generateReport()}>{t("generateOptimizationReport")}</Button><Button onClick={() => setRunDetail(null)}>{t("close")}</Button></>}>
                {runDetail ? <div className="rolling-skill-detail-stack">
                    <p role="status"><strong>{optimizationPhaseLabel(runDetail, t)}</strong> · {t("optimizationRound")} {runDetail.currentEpoch ?? 0}</p>
                    {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                    {runDetail.error?.message ? <p className="rolling-skill-inline-error" role="alert">{runDetail.error.message}</p> : null}
                    {pollError ? <p className="rolling-skill-inline-error" role="alert">{pollError}</p> : null}
                    {runDetail.playbook ? <section className="rolling-skill-subpanel">
                        <h4>{t("optimizationFrozenConfiguration")}</h4>
                        <p>{t("optimizationDirection")}: {runDetail.optimizationDirection || t("optimizationSystemDirection")}</p>
                        <p>{t("optimizationMethod")}: {`Rolling Skill Optimization Playbook v${runDetail.playbook.version} · ${runDetail.playbook.digest.slice(0, 19)}…`}</p>
                    </section> : null}
                    {finalApproval ? <section className="rolling-skill-subpanel">
                        <h4>{t("optimizationFinalApproval")}</h4>
                        <p>{t("optimizationCandidateReady")}: {finalApprovalEpoch?.candidate?.versionId ?? t("notAvailable")}</p>
                        <p>{t("optimizationScore")}: {finalApprovalEpoch?.analysis?.score ?? t("notAvailable")} / 100 · {t("optimizationPassRate")}: {finalApprovalEpoch?.analysis?.passRate === undefined ? t("notAvailable") : `${Math.round(finalApprovalEpoch.analysis.passRate * 100)}%`} · {t("optimizationRegressions")}: {finalApprovalEpoch?.analysis?.regressionCount ?? 0}</p>
                        <p>{t("optimizationTargetRuntime")}: {(runDetail.targets ?? []).map((target) => target.runtimeId).filter(Boolean).join(", ") || t("notAvailable")}</p>
                        <p>{finalApproval.risk}</p>
                        <div className="rolling-skill-actions"><Button disabled={busy} onClick={() => void resolveFinalApproval("approve")}>{t("optimizationInstallImproved")}</Button><Button disabled={busy} onClick={() => void resolveFinalApproval("reject")}>{t("optimizationRestoreOriginal")}</Button></div>
                    </section> : null}
                    {runDetail.checkpoint?.operatorSessionId && onNavigate ? <Button onClick={() => onNavigate({page: "operator", sessionId: runDetail.checkpoint!.operatorSessionId!})}>{t("optimizationOpenAgent")}</Button> : null}
                    {runDetail.checkpoint?.activeEvaluationRunId && onNavigate ? <Button onClick={() => onNavigate({page: "evaluations", runId: runDetail.checkpoint!.activeEvaluationRunId!})}>{t("optimizationOpenEvaluation")}</Button> : null}
                    {onNavigate ? (runDetail.checkpoint?.installationJobIds ?? []).map((jobId, index) => <Button key={jobId} onClick={() => onNavigate({page: "skill-install", jobId})}>{t("optimizationOpenInstallation")} {index + 1}</Button>) : null}
                    <details><summary>{t("runtimeInformation")}</summary><pre>{JSON.stringify({snapshotDigest: runDetail.snapshotDigest, optimizationDirection: runDetail.optimizationDirection, playbook: runDetail.playbook, baseline: runDetail.baseline, dataset: runDetail.dataset, rubric: runDetail.rubric, operator: runDetail.operator, targets: runDetail.targets, judge: runDetail.judge, checkpoint: runDetail.checkpoint, error: runDetail.error}, null, 2)}</pre></details>
                    <section className="rolling-skill-subpanel"><h4>{t("optimizationTimeline")}</h4><div className="rolling-skill-list">{(runDetail.epochs ?? []).map((epoch) => <OptimizationEpochCard key={epoch.number} epoch={epoch} statusLabel={epoch.number === runDetail.currentEpoch ? optimizationPhaseLabel(runDetail, t) : undefined} t={t}/>)}{!runDetail.epochs?.length ? <p>{t("emptyOptimizationTimeline")}</p> : null}</div></section>
                    {report?.runId === runDetail.id ? <section className="rolling-skill-subpanel"><h4>{t("optimizationReport")}</h4><MarkdownContent>{report.preview ?? t("notAvailable")}</MarkdownContent></section> : null}
                </div> : null}
            </Modal>
        </section>
    )
}

function OptimizationEpochCard({epoch, statusLabel, t}: {epoch: OptimizationEpoch; statusLabel?: string; t: Translate}) {
    const analysis = epoch.analysis
    return <article className="rolling-skill-subpanel">
        <h4>{t("optimizationRound")} {epoch.number} · {statusLabel ?? displayStatus(epoch.status, t)}</h4>
        {epoch.candidate ? <p>{t("optimizationCandidateReady")}</p> : null}
        {analysis ? <p>{t("optimizationScore")}: {analysis.score ?? t("notAvailable")} / 100 · {t("optimizationScoreDelta")}: {analysis.scoreDelta ?? t("notAvailable")} · {t("optimizationPassRate")}: {analysis.passRate === undefined ? t("notAvailable") : `${Math.round(analysis.passRate * 100)}%`}<br/>{t("optimizationRegressions")}: {analysis.regressionCount ?? 0} · {t("optimizationExecutionFailures")}: {analysis.executionFailureCount ?? 0} · {t("optimizationGradingFailures")}: {analysis.gradingFailureCount ?? 0}</p> : null}
        {epoch.decision?.rationale ? <MarkdownContent>{epoch.decision.rationale}</MarkdownContent> : null}
        <details><summary>{t("runtimeInformation")}</summary><pre>{JSON.stringify(epoch, null, 2)}</pre></details>
    </article>
}
