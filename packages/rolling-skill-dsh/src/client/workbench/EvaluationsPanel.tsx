import {Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"
import {MarkdownContent} from "./MarkdownContent"
import {RuntimeInteractions} from "./RuntimeInteractions"
import {displayStatus} from "./display-state"

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
interface RollingSettings {
    rollingSkill: {judgeProfile: {modelId: string | null; effort: string | null}}
    plugin: {runtime: {runtimeId: string} | null}
}
interface EvaluationSummary {
    id: string
    datasetId: string
    status: string
    caseCount: number
    runtimeCount: number
    createdAt: string
}
interface RuntimeConfiguration {
    runtimeId?: string | null
    displayName?: string | null
    version?: string | null
    modelId?: string | null
    effort?: string | null
    installationId?: string | null
    installationJobId?: string | null
    installationVerification?: string | null
}
interface ManagedVersionSnapshot {
    repositoryId?: string | null
    skillId?: string | null
    versionId?: string | null
    commit?: string | null
    contentDigest?: string | null
    installationJobIdsByRuntime?: Record<string, string>
}
interface ScoreCriterion {
    id: string
    points?: number
    maxPoints?: number
    rating?: number
    deduction?: number
    criticalFailureTriggered?: boolean
}
interface ScoreContractCriterion {
    id: string
    title?: string
    criterion?: string
    weight?: number
    mode?: string
    maximumDeduction?: number
}
interface ScoreContract {criteria?: ScoreContractCriterion[]; digest?: string}
interface JudgeAssessment {
    criterionId?: string
    rating?: number
    confidence?: number
    rationale?: string
    evidenceRefs?: string[]
    verificationStatus?: string
    verifiableFields?: unknown[]
    crossChecks?: unknown[]
}
interface Judgment {assessments?: JudgeAssessment[]}
interface TraceEntry {
    sequence?: number
    direction?: string
    timestamp?: string
    recordedAt?: string
    message?: Record<string, unknown>
}
interface TraceEvidence {
    scope?: "case"
    entryCount?: number
    sourceEntryCount?: number
    includedEntries?: number
    compactedEntries?: number
    contentCompactedEntries?: number
    semanticCoverageComplete?: boolean
    truncated?: boolean
    omittedEntries?: number
    entries?: TraceEntry[]
}
interface EvaluationResult {
    id: string
    status: string
    gradingStatus?: string
    question?: string
    response?: string
    error?: string
    gradingError?: string
    durationMs?: number
    runtimeId?: string | null
    scoreContract?: ScoreContract | null
    computedScore?: {totalScore?: number; overallVerdict?: string; outcomeTier?: string; criterionScores?: ScoreCriterion[]}
    judgment?: Judgment | null
    judge?: RuntimeConfiguration & {status?: string | null; attempts?: number | null; durationMs?: number | null; contractDigest?: string | null}
    traceEvidence?: TraceEvidence | null
}
interface EvaluationDetail extends EvaluationSummary {
    managedVersionLabel?: string | null
    managedVersionState?: string
    traceScope?: "case"
    results: EvaluationResult[]
    skillEvidence?: {digest?: string | null; managedSource?: ManagedVersionSnapshot | null; complete?: boolean | null; warningCount?: number} | null
    managedVersionSnapshot?: ManagedVersionSnapshot | null
    rubricVersionSnapshot?: {id?: string | null; version?: number | null; rubricDigest?: string | null; rubric?: {title?: string; scoringModel?: string} | null} | null
    runtimeConfigurations?: RuntimeConfiguration[]
    judgeConfiguration?: RuntimeConfiguration | null
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
    const [targetProfiles, setTargetProfiles] = useState<Record<string, {modelId?: string; effort?: string}>>({})
    const targetModelId = targetProfiles[targetRuntimeId]?.modelId ?? ""
    const effort = targetProfiles[targetRuntimeId]?.effort ?? ""
    const setTargetModelId = (modelId: string) => setTargetProfiles((current) => ({...current, [targetRuntimeId]: {...current[targetRuntimeId], modelId}}))
    const setEffort = (value: string) => setTargetProfiles((current) => ({...current, [targetRuntimeId]: {...current[targetRuntimeId], effort: value}}))
    const [judgeModelId, setJudgeModelId] = useState("")
    const [judgeEffort, setJudgeEffort] = useState("")
    const [activationMode, setActivationMode] = useState<"explicit" | "automatic">("explicit")
    const [caseScope, setCaseScope] = useState<"all" | "goodcase" | "badcase">("all")
    const [caseIds, setCaseIds] = useState<string[]>([])
    const [loadedCaseSelection, setLoadedCaseSelection] = useState("")
    const [detail, setDetail] = useState<EvaluationDetail | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)
    const initialized = useRef(false)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<EvaluationSummary[]>("evaluations.list", {}, controller.signal),
            requestRollingSkill<RollingSettings>("settings.get", {}, controller.signal),
        ]).then(([runtimeItems, datasetItems, runItems, settings]) => {
            if (controller.signal.aborted) return
            const configuredRuntimeId = settings.plugin.runtime?.runtimeId
            setRuntimes(runtimeItems)
            setDatasets(datasetItems)
            setRuns(runItems)
            if (!initialized.current) {
                initialized.current = true
                const runtimeId = configuredRuntimeId || runtimeItems[0]?.runtimeId || ""
                setTargetRuntimeId(runtimeId)
                setTargetRuntimeIds(runtimeId ? [runtimeId] : [])
                setJudgeRuntimeId(runtimeId)
                setJudgeModelId(settings.rollingSkill.judgeProfile.modelId || "")
                setJudgeEffort(settings.rollingSkill.judgeProfile.effort || "")
            }
            setDatasetId((current) => current || datasetItems[0]?.id || "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {if (initialRunId) void inspect(initialRunId)}, [initialRunId])

    useEffect(() => {
        if (!detail?.id) return
        const controller = new AbortController()
        const runId = detail.id
        requestRollingSkill<EvaluationDetail>("evaluations.get", {runId}, controller.signal)
            .then((next) => {if (!controller.signal.aborted) setDetail((current) => current?.id === runId ? next : current)})
            .catch((reason: unknown) => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))})
        return () => controller.abort()
    }, [detail?.id, revision])

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
        setLoadedCaseSelection("")
        const loadCases = async () => {
            const ids = new Set<string>()
            let page = 1
            let pageCount = 1
            do {
                const result = await requestRollingSkill<{items: Array<{id: string}>; pageCount: number}>("cases.list", {datasetId, caseScope, page, pageSize: 200}, controller.signal)
                if (controller.signal.aborted) return
                for (const entry of result.items) ids.add(entry.id)
                pageCount = result.pageCount
                page += 1
            } while (page <= pageCount)
            setCaseIds([...ids])
            setLoadedCaseSelection(`${datasetId}:${caseScope}`)
        }
        void loadCases()
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [datasetId, caseScope, revision])

    useEffect(() => {
        if (!targetRuntimeId) return
        const controller = new AbortController()
        setTargetModels([])
            requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId: targetRuntimeId}, controller.signal)
            .then((models) => {
                if (!controller.signal.aborted) setTargetModels(models)
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [targetRuntimeId])

    useEffect(() => {
        if (!judgeRuntimeId) return
        const controller = new AbortController()
        setJudgeModels([])
            requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId: judgeRuntimeId}, controller.signal)
            .then((models) => {
                if (!controller.signal.aborted) setJudgeModels(models)
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
        && loadedCaseSelection === `${datasetId}:${caseScope}`
    const start = () => mutate(async () => {
        const run = await requestRollingSkill<{id: string}>("evaluations.start", {
        datasetId,
        versionId,
        caseIds: caseScope === "all" ? [] : caseIds,
        selectionMode: caseScope === "all" ? "dataset" : "selected",
        activationMode,
        targets: targetRuntimeIds.map((runtimeId) => ({runtimeId, modelId: targetProfiles[runtimeId]?.modelId || null, effort: targetProfiles[runtimeId]?.effort || null})),
        judge: {runtimeId: judgeRuntimeId, modelId: judgeModelId || null, effort: judgeEffort || null},
        })
        if (run?.id) await inspect(run.id)
    })
    const inspect = async (runId: string) => {
        setError(null)
        try {
            setDetail(await requestRollingSkill<EvaluationDetail>("evaluations.get", {runId}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }

    useEffect(() => {
        if (!runs.some((run) => ["queued", "running"].includes(run.status)) && !["queued", "running"].includes(detail?.status ?? "")) return
        const timer = window.setInterval(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearInterval(timer)
    }, [runs, detail?.status])

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
                    <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={targetModelId} onChange={(event) => setTargetModelId(event.target.value)}><option value="">{t("runtimeDefault")}</option>{targetModelId && !targetModels.some((model) => (model.id ?? model.model) === targetModelId) ? <option value={targetModelId}>{targetModelId}</option> : null}{targetModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={targetModels} modelId={targetModelId} value={effort} onChange={setEffort}/>
                </div>
                <RuntimeSelect t={t} runtimes={runtimes} value={judgeRuntimeId} onChange={setJudgeRuntimeId} label={t("judgeRuntime")}/>
                <div className="rolling-skill-grid"><label className="rolling-skill-field"><span>{t("judgeModel")}</span><select className="rolling-skill-select" value={judgeModelId} onChange={(event) => setJudgeModelId(event.target.value)}><option value="">{t("runtimeDefault")}</option>{judgeModelId && !judgeModels.some((model) => (model.id ?? model.model) === judgeModelId) ? <option value={judgeModelId}>{judgeModelId}</option> : null}{judgeModels.map((model) => {const id = model.id ?? model.model ?? ""; return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label><ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("runtimeDefault")} models={judgeModels} modelId={judgeModelId} value={judgeEffort} onChange={setJudgeEffort}/></div>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <Button disabled={busy || !datasetId || !versionId || !targetRuntimeId || !judgeRuntimeId || !installationsReady || (caseScope !== "all" && caseIds.length === 0)} onClick={() => void start()}>{t("startEvaluation")}</Button>
            </section>
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("evaluationRuns")}</h3></div><Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
                <div className="rolling-skill-list">
                    {runs.map((run) => <article className="rolling-skill-list-row" key={run.id} title={run.id}><div><strong>{displayStatus(run.status, t)}</strong><span>{datasets.find((item) => item.id === run.datasetId)?.name ?? t("notAvailable")} · {run.caseCount ?? 0} Case · {run.runtimeCount ?? 0} Runtime</span><small>{formatDate(run.createdAt)}</small></div><div className="rolling-skill-actions"><Button size="sm" onClick={() => void inspect(run.id)}>{t("details")}</Button>{["queued", "running"].includes(run.status) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("evaluations.cancel", {runId: run.id}))}>{t("cancelRun")}</Button> : <Button size="sm" disabled={busy} onClick={() => {if (window.confirm(t("deleteEvaluationConfirm"))) void mutate(() => requestRollingSkill("evaluations.delete", {runId: run.id}))}}>{t("delete")}</Button>}</div></article>)}
                    {runs.length === 0 ? <p>{t("emptyEvaluations")}</p> : null}
                </div>
            </section>
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("evaluationDetail")} closeLabel={t("cancel")} footer={<Button onClick={() => setDetail(null)}>{t("close")}</Button>}>
                {detail ? <div className="rolling-skill-detail-stack rolling-skill-evaluation-detail">
                    {error ? <p role="alert" className="rolling-skill-inline-error">{error}</p> : null}
                    <RuntimeInteractions t={t} ownerId={detail.id}/>
                    {["queued", "running"].includes(detail.status) ? <Button disabled={busy} onClick={() => void mutate(() => requestRollingSkill("evaluations.cancel", {runId: detail.id}))}>{t("cancelRun")}</Button> : null}
                    <EvaluationRunEvidence detail={detail} t={t}/>
                    <div className="rolling-skill-evaluation-results">{detail.results.map((result) => <EvaluationResultCard key={result.id} result={result} detail={detail} t={t}/>)}</div>
                </div> : null}
            </Modal>
        </div>
    )
}

function formatDate(value?: string | null): string {
    if (!value) return "—"
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

function shortDigest(value?: string | null): string {
    if (!value) return "—"
    return value.length > 32 ? `${value.slice(0, 24)}…${value.slice(-6)}` : value
}

function runtimeLabel(configuration?: RuntimeConfiguration | null): string {
    if (!configuration) return "—"
    return [configuration.displayName ?? configuration.runtimeId, configuration.version, configuration.modelId, configuration.effort].filter(Boolean).join(" · ")
}

function EvaluationRunEvidence({detail, t}: {detail: EvaluationDetail; t: Translate}) {
    const version = detail.managedVersionSnapshot ?? detail.skillEvidence?.managedSource
    const rubric = detail.rubricVersionSnapshot
    return (
        <section className="rolling-skill-evidence-card">
            <div className="rolling-skill-panel-header"><div><h4>{t("evaluationOverview")}</h4><p>{t("evaluationVersion")}: {detail.managedVersionLabel || (detail.managedVersionState === "candidate" ? t("optimizationCandidateReady") : t("notAvailable"))} · {rubric?.rubric?.title ?? t("notAvailable")}</p></div><span className="rolling-skill-badge">{displayStatus(detail.status, t)}</span></div>
            <p role="status">{t("evaluationProgress").replace("{executed}", String(detail.results.filter((result) => result.status === "completed").length)).replace("{graded}", String(detail.results.filter((result) => result.gradingStatus === "completed").length)).replaceAll("{total}", String(detail.results.length))}</p>
            <p>{t("evaluationRuntime")}: {detail.runtimeConfigurations?.map(runtimeLabel).join(" · ") || t("notAvailable")}</p>
            <p>Judge: {runtimeLabel(detail.judgeConfiguration)}</p>
            {!["queued", "running"].includes(detail.status) && detail.results.some((result) => result.status === "failed" || result.gradingStatus === "failed") ? <p className="rolling-skill-inline-error" role="alert">{t("evaluationHasFailures")}</p> : null}
            <details><summary>{t("evaluationRunEvidence")}</summary>
            <p>{t("traceScopeCase")}</p>
            <dl>
                <div><dt>{t("evaluationVersion")}</dt><dd>{version?.versionId ?? t("notAvailable")}</dd></div>
                <div><dt>{t("installationCommit")}</dt><dd><code>{version?.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div>
                <div><dt>{t("installationDigest")}</dt><dd title={version?.contentDigest ?? undefined}><code>{shortDigest(version?.contentDigest)}</code></dd></div>
                <div><dt>{t("frozenRubric")}</dt><dd>{rubric ? `v${rubric.version ?? "—"} · ${rubric.rubric?.title ?? rubric.id ?? "—"}` : t("notAvailable")}</dd></div>
                <div><dt>{t("rubricDigest")}</dt><dd title={rubric?.rubricDigest ?? undefined}><code>{shortDigest(rubric?.rubricDigest)}</code></dd></div>
                <div><dt>{t("createdAt")}</dt><dd>{formatDate(detail.createdAt)}</dd></div>
            </dl>
            <h4>{t("targetRuntimeConfiguration")}</h4>
            <div className="rolling-skill-audit-grid">{detail.runtimeConfigurations?.map((runtime) => <article className="rolling-skill-audit-card" key={runtime.runtimeId ?? runtimeLabel(runtime)}><strong>{runtimeLabel(runtime)}</strong><small>{t("installationJob")} · {runtime.installationJobId ?? t("notAvailable")} · {runtime.installationVerification ?? t("notAvailable")}</small></article>)}</div>
            <h4>{t("judgeConfiguration")}</h4>
            <p>{runtimeLabel(detail.judgeConfiguration)}</p>
            </details>
        </section>
    )
}

function EvaluationResultCard({result, detail, t}: {result: EvaluationResult; detail: EvaluationDetail; t: Translate}) {
    const score = result.computedScore?.totalScore
    return (
        <article className="rolling-skill-evaluation-result">
            <header>
                <div><strong>{result.question ?? result.id}</strong><small>{runtimeLabel(detail.runtimeConfigurations?.find((runtime) => runtime.runtimeId === result.runtimeId))} · {typeof result.durationMs === "number" ? `${result.durationMs} ms` : t("notAvailable")}</small></div>
                <span className="rolling-skill-score-total">{score ?? t("notAvailable")}<small>/100</small></span>
            </header>
            <div className="rolling-skill-actions"><span className="rolling-skill-badge">{displayStatus(result.status, t)}</span><span className="rolling-skill-badge">Judge · {displayStatus(result.gradingStatus, t)}</span>{result.computedScore?.outcomeTier || result.computedScore?.overallVerdict ? <span className="rolling-skill-badge">{displayStatus(result.computedScore.outcomeTier ?? result.computedScore.overallVerdict, t)}</span> : null}</div>
            {result.error || result.gradingError ? <p className="rolling-skill-inline-error">{result.error ?? result.gradingError}</p> : null}
            {result.response ? <details><summary>{t("evaluationResponse")}</summary><MarkdownContent>{result.response}</MarkdownContent></details> : null}
            <EvaluationScoreBreakdown result={result} detail={detail} t={t}/>
            <EvaluationTrace traceEvidence={result.traceEvidence} t={t}/>
        </article>
    )
}

function EvaluationScoreBreakdown({result, detail, t}: {result: EvaluationResult; detail: EvaluationDetail; t: Translate}) {
    const scores = result.computedScore?.criterionScores ?? []
    const contract = result.scoreContract?.criteria ?? []
    const assessments = result.judgment?.assessments ?? []
    const judge = result.judge ?? detail.judgeConfiguration
    if (!scores.length && !result.judgment && !result.computedScore) return null
    return (
        <details className="rolling-skill-score-breakdown">
            <summary>{t("scoreBreakdown")}</summary>
            <p className="rolling-skill-judge-meta"><b>Judge:</b> {runtimeLabel(judge)}{result.judge?.attempts ? ` · ${t("judgeAttempts")} ${result.judge.attempts}` : ""}</p>
            <div className="rolling-skill-score-list">
                {scores.map((score) => {
                    const criterion = contract.find((entry) => entry.id === score.id)
                    const assessment = assessments.find((entry) => entry.criterionId === score.id)
                    return <article key={score.id} className={score.criticalFailureTriggered ? "rolling-skill-score-item rolling-skill-score-critical" : "rolling-skill-score-item"}>
                        <header><strong>{score.id} · {criterion?.title === "Automatic failure" ? t("evaluationAutomaticFailure") : criterion?.title ?? criterion?.criterion ?? t("notAvailable")}</strong><span>{score.points ?? t("notAvailable")}/{score.maxPoints ?? t("notAvailable")}</span></header>
                        <small>{t("weight")} {criterion?.weight ?? t("notAvailable")} · {t("rating")} {score.rating ?? assessment?.rating ?? t("notAvailable")}/10{assessment?.confidence !== undefined ? ` · ${t("confidence")} ${Math.round(assessment.confidence * 100)}%` : ""}</small>
                        {criterion?.criterion ? <details><summary>{t("evaluationCriterionDetails")}</summary><p>{criterion.criterion}</p></details> : null}
                        {assessment?.rationale ? <p><b>{t("judgeRationale")}: </b>{assessment.rationale}</p> : null}
                        {assessment?.evidenceRefs?.length ? <p><b>{t("evidenceReferences")}: </b>{assessment.evidenceRefs.join(" · ")}</p> : null}
                        {assessment?.verificationStatus ? <p><b>{t("verificationStatus")}: </b>{displayStatus(assessment.verificationStatus, t)}</p> : null}
                    </article>
                })}
                {!scores.length ? <p>{t("emptyScoreBreakdown")}</p> : null}
            </div>
        </details>
    )
}

function traceEntryLabel(entry: TraceEntry): {title: string; detail: string} {
    const message = entry.message ?? {}
    const method = typeof message.method === "string" ? message.method : "trace event"
    const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {}
    const item = params.item && typeof params.item === "object" ? params.item as Record<string, unknown> : {}
    const update = params.update && typeof params.update === "object" ? params.update as Record<string, unknown> : {}
    const event = params.event && typeof params.event === "object" ? params.event as Record<string, unknown> : {}
    const data = event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}
    const call = data.call && typeof data.call === "object" ? data.call as Record<string, unknown> : {}
    if (typeof event.type === "string") {
        return {title: [event.type, data.name ?? call.name].filter(Boolean).join(" · "), detail: typeof data.command === "string" ? data.command : ""}
    }
    const title = [entry.direction, method, item.type, item.tool, update.sessionUpdate].filter((value) => typeof value === "string" && value).join(" · ")
    const detail = [item.command, item.status, item.path, update.status].filter((value) => typeof value === "string" && value).join(" · ")
    return {title: title || method, detail}
}

function EvaluationTrace({traceEvidence, t}: {traceEvidence?: TraceEvidence | null; t: Translate}) {
    if (!traceEvidence) return <p>{t("emptyTrace")}</p>
    const entries = traceEvidence.entries ?? []
    return (
        <details className="rolling-skill-trace">
            <summary>{t("evaluationTrace")} · {entries.length}</summary>
            <div className="rolling-skill-trace-summary">
                <span className="rolling-skill-badge">{t("traceScopeCase")}</span>
                <span>{traceEvidence.semanticCoverageComplete ? t("traceComplete") : t("traceCompacted")}</span>
                {traceEvidence.omittedEntries ? <span>{t("traceOmitted")} {traceEvidence.omittedEntries}</span> : null}
            </div>
            <ol className="rolling-skill-trace-list">
                {entries.map((entry, index) => {
                    const label = traceEntryLabel(entry)
                    return <li key={`${entry.sequence ?? index}`}><code>L{entry.sequence ?? "—"}</code><details><summary>{label.title}</summary>{label.detail ? <p>{label.detail}</p> : null}<pre className="rolling-skill-verbatim">{JSON.stringify(entry.message, null, 2)}</pre></details></li>
                })}
            </ol>
            {entries.length === 0 ? <p>{t("emptyTrace")}</p> : null}
        </details>
    )
}

function EvaluationRuntimeMatrix({t, runtimes, values, primary, onChange, onPrimary}: {t: Translate; runtimes: RuntimeDescriptor[]; values: string[]; primary: string; onChange: (values: string[]) => void; onPrimary: (value: string) => void}) {
    return <fieldset className="rolling-skill-runtime-select"><legend>{t("evaluationRuntime")}</legend><div className="rolling-skill-runtime-list">{runtimes.map((runtime) => <label className="rolling-skill-runtime-option" key={runtime.runtimeId}><input type="checkbox" checked={values.includes(runtime.runtimeId)} onChange={(event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId))}/><span><strong>{runtime.displayName} {runtime.version}</strong><code>{runtime.executablePath}</code>{values.includes(runtime.runtimeId) ? <button type="button" className="rolling-skill-link-button" aria-pressed={primary === runtime.runtimeId} onClick={(event) => {event.preventDefault(); onPrimary(runtime.runtimeId)}}>{primary === runtime.runtimeId ? t("primaryRuntime") : t("makePrimaryRuntime")}</button> : null}</span></label>)}{runtimes.length === 0 ? <p>{t("noRuntimes")}</p> : null}</div></fieldset>
}
