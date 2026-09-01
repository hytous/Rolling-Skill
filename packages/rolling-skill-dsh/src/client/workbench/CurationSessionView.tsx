import {useEffect, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {WorkbenchRoute} from "./Workbench"
import {usePollingRevision} from "./usePollingRevision"

interface CurationSession {
    id: string
    datasetId: string
    status: string
    caseType: string
    issueDescription: string
    revision: string
    error: string | null
    episode: {
        originalQuestion: string
        source: {
            sessionId: string | null
            startSeq: number | null
            endSeq: number | null
            digest: string | null
            observedSkills: Array<{name: string; provider: string; callSeq: number; resultSeq: number}>
        }
        items: Array<{id: string; type: string; text: string}>
    } | null
    operationEvidence: {
        skillName?: string | null
        versionLabel?: string | null
        commit?: string | null
        contentDigest?: string | null
        rubricVersionId?: string | null
        runtime?: {displayName?: string | null; version?: string | null} | null
        installation?: {jobId?: string | null; verification?: string | null; installedAt?: string | null} | null
    } | null
    curator: {modelId: string | null; effort: string | null; effectiveModelId: string | null; effectiveEffort: string | null; working: boolean} | null
    conversation: Array<{id: string; role: string; text: string}>
    revisions: Array<{id: string; draft: CurationDraft; createdAt: string}>
    draft: CurationDraft | null
}

interface CurationDraft {
    schemaVersion?: string
    referenceAnswer?: {
        summary?: string
        requiredFacts?: string[]
        requiredSteps?: string[]
        requiredOutputFormat?: string[]
        evidence?: Array<{claim?: string; sourceItemIds?: string[]}>
    }
    rubricCoverage?: Array<{criterionId?: string; applicability?: string; expectation?: string; evidenceBasis?: string}>
    caseSpecificCriteria?: Array<{id?: string; criterion?: string; weight?: number}>
    caseAutomaticFailures?: Array<{id?: string; condition?: string; rationale?: string} | string>
    badCaseAnalysis?: {summary?: string; rootCauses?: string[]; improvements?: string[]} | string | null
}

function newKey(prefix: string): string {
    return `${prefix}:${globalThis.crypto.randomUUID()}`
}

export function CurationSessionView({
    sessionId,
    t,
    onChanged,
    onNavigate,
}: {
    sessionId: string
    t: Translate
    onChanged: () => void
    onNavigate: (route: WorkbenchRoute) => void
}) {
    const [session, setSession] = useState<CurationSession | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const keys = useRef(new Map<string, string>())
    const working = Boolean(session?.curator?.working || (session && ["queued", "running"].includes(session.status)))
    const [revision, refresh] = usePollingRevision(working)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<CurationSession>("curation.get", {sessionId}, controller.signal)
            .then((value) => { setSession(value); setError(null) })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [sessionId, revision])

    const mutate = async (method: string, extra: Record<string, unknown> = {}) => {
        if (!session || busy) return false
        const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`
        let idempotencyKey = keys.current.get(signature)
        if (!idempotencyKey) {
            idempotencyKey = newKey(method)
            keys.current.set(signature, idempotencyKey)
        }
        setBusy(true)
        setError(null)
        try {
            const result = await requestRollingSkill<any>(method, {
                sessionId: session.id,
                expectedRevision: session.revision,
                idempotencyKey,
                ...extra,
            })
            keys.current.delete(signature)
            const updated = result.session ?? result
            if (updated?.id) setSession(updated)
            if (method === "curation.save" || method === "curation.discard") {
                window.dispatchEvent(new CustomEvent("rolling-skill:curation-markers-changed", {
                    detail: {sessionId: session.episode?.source.sessionId},
                }))
                onChanged()
            }
            if (method === "curation.save" && result.caseRecord?.id) {
                onNavigate({page: "cases", datasetId: session.datasetId, caseId: result.caseRecord.id})
            }
            return true
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
            return false
        } finally {
            setBusy(false)
        }
    }

    const sendRevision = async () => {
        const text = message.trim()
        if (!text) return
        if (await mutate("curation.send", {text})) setMessage("")
    }

    if (!session && !error) return <div className="rolling-skill-state" role="status">{t("loading")}</div>
    if (!session) return <div className="rolling-skill-state rolling-skill-error" role="alert">{error}</div>
    const editable = !["archived", "cancelled"].includes(session.status)
    return (
        <section className="rolling-skill-panel rolling-skill-session-view">
            <div className="rolling-skill-panel-header">
                <div>
                    <h3>{session.episode?.originalQuestion ?? session.id}</h3>
                    <p>{session.caseType} · {session.status}</p>
                </div>
                <Button size="sm" onClick={refresh}>{t("refresh")}</Button>
            </div>
            {session.error || error ? <p className="rolling-skill-inline-error" role="alert">{error ?? session.error}</p> : null}
            <section className="rolling-skill-curation-primary">
                <h4>{t("latestDraft")}</h4>
                {session.draft ? <CurationDraftCard draft={session.draft} t={t}/> : <p>{t("noValidDraft")}</p>}
            </section>
            {editable ? (
                <section className="rolling-skill-curation-composer">
                    <div><h4>{t("revisionComposerTitle")}</h4><p>{t("revisionComposerDescription")}</p></div>
                    <textarea
                        aria-label={t("reviewMessage")}
                        placeholder={t("reviewMessagePlaceholder")}
                        value={message}
                        disabled={working || busy}
                        onChange={(event) => setMessage(event.target.value)}
                    />
                    {working ? <p className="rolling-skill-muted" role="status">{t("curationWorking")}</p> : null}
                    <div className="rolling-skill-actions">
                        <Button tone="primary" disabled={working || busy || !message.trim()} onClick={() => void sendRevision()}>{t("generateRevision")}</Button>
                        {session.status === "failed" ? <Button disabled={busy} onClick={() => mutate("curation.retry")}>{t("retry")}</Button> : null}
                        <Button disabled={busy || session.status !== "needs_review" || !session.draft} onClick={() => mutate("curation.save")}>{t("saveCase")}</Button>
                        <Button disabled={busy} onClick={() => { if (window.confirm(t("discardDraftConfirm"))) mutate("curation.discard") }}>{t("discardDraft")}</Button>
                    </div>
                </section>
            ) : null}
            <details className="rolling-skill-curation-runtime-details">
                <summary>{t("runtimeInformation")}</summary>
                <section className="rolling-skill-evidence-card">
                    <h4>{t("frozenEvidence")}</h4>
                    <dl>
                        <div><dt>{t("sourceRange")}</dt><dd>{session.episode?.source.startSeq}–{session.episode?.source.endSeq}</dd></div>
                        <div><dt>Digest</dt><dd><code>{session.episode?.source.digest}</code></dd></div>
                    </dl>
                    {session.episode?.source.observedSkills.map((skill) => (
                        <p key={`${skill.name}:${skill.callSeq}`}>{skill.name} · {skill.provider} · #{skill.callSeq}–{skill.resultSeq}</p>
                    ))}
                    {session.operationEvidence ? <dl><div><dt>{t("skillRepositories")}</dt><dd>{session.operationEvidence.skillName ?? t("notAvailable")} · {session.operationEvidence.versionLabel ?? t("notAvailable")}</dd></div><div><dt>{t("installationCommit")}</dt><dd><code>{session.operationEvidence.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div><div><dt>{t("installationDigest")}</dt><dd title={session.operationEvidence.contentDigest ?? undefined}><code>{session.operationEvidence.contentDigest ?? t("notAvailable")}</code></dd></div><div><dt>{t("frozenRubric")}</dt><dd>{session.operationEvidence.rubricVersionId ?? t("notAvailable")}</dd></div><div><dt>{t("installationRuntime")}</dt><dd>{session.operationEvidence.runtime?.displayName ?? t("notAvailable")} {session.operationEvidence.runtime?.version ?? ""}</dd></div><div><dt>{t("installationJob")}</dt><dd>{session.operationEvidence.installation?.jobId ?? t("notAvailable")} · {session.operationEvidence.installation?.verification ?? t("notAvailable")}</dd></div></dl> : null}
                    {editable ? <div className="rolling-skill-curation-model-controls">
                        <label className="rolling-skill-field"><span>{t("model")}</span><input value={session.curator?.modelId ?? ""} placeholder={t("configuredDefault")} onChange={(event) => setSession({...session, curator: {...session.curator!, modelId: event.target.value}})} onBlur={() => mutate("curation.model", {modelId: session.curator?.modelId || null})}/></label>
                        <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={session.curator?.effort ?? ""} onChange={(event) => mutate("curation.effort", {effort: event.target.value || null})}><option value="">{t("configuredDefault")}</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option><option value="max">max</option></select></label>
                    </div> : null}
                </section>
            </details>
        </section>
    )
}

function StringList({title, values}: {title: string; values?: string[]}) {
    if (!values?.length) return null
    return <section><h4>{title}</h4><ul>{values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}</ul></section>
}

function CurationDraftCard({draft, t}: {draft: CurationDraft; t: Translate}) {
    const answer = draft.referenceAnswer
    const hasDetails = Boolean(
        answer?.evidence?.length ||
        draft.rubricCoverage?.length ||
        draft.caseSpecificCriteria?.length ||
        draft.caseAutomaticFailures?.length ||
        draft.badCaseAnalysis,
    )
    return <div className="rolling-skill-curation-draft-card">
        <header><strong>{answer?.summary ?? draft.schemaVersion ?? t("notAvailable")}</strong><span className="rolling-skill-badge">{draft.schemaVersion}</span></header>
        <StringList title={t("requiredFacts")} values={answer?.requiredFacts}/>
        <StringList title={t("requiredSteps")} values={answer?.requiredSteps}/>
        <StringList title={t("requiredOutputFormat")} values={answer?.requiredOutputFormat}/>
        {hasDetails ? <details className="rolling-skill-curation-draft-details">
            <summary>{t("draftDetails")}</summary>
            <div>
                {answer?.evidence?.length ? <section><h4>{t("evidenceReferences")}</h4><div className="rolling-skill-rubric-criteria">{answer.evidence.map((entry, index) => <article key={`${index}:${entry.claim}`}><strong>{entry.claim}</strong><p>{entry.sourceItemIds?.join(" · ")}</p></article>)}</div></section> : null}
                {draft.rubricCoverage?.length ? <section><h4>{t("rubricCoverage")}</h4><div className="rolling-skill-rubric-criteria">{draft.rubricCoverage.map((entry, index) => <article key={`${entry.criterionId}:${index}`}><strong>{entry.criterionId} · {entry.applicability}</strong><p>{entry.expectation}</p><small>{entry.evidenceBasis}</small></article>)}</div></section> : null}
                {draft.caseSpecificCriteria?.length ? <section><h4>{t("caseSpecificCriteria")}</h4><div className="rolling-skill-rubric-criteria">{draft.caseSpecificCriteria.map((entry, index) => <article key={`${entry.id}:${index}`}><strong>{entry.id} · {entry.criterion}</strong><span>{t("weight")} {entry.weight}</span></article>)}</div></section> : null}
                {draft.caseAutomaticFailures?.length ? <section><h4>{t("automaticFailures")}</h4><ul>{draft.caseAutomaticFailures.map((entry, index) => <li key={index}>{typeof entry === "string" ? entry : `${entry.id ?? ""} ${entry.condition ?? ""} ${entry.rationale ?? ""}`}</li>)}</ul></section> : null}
                {draft.badCaseAnalysis ? <section><h4>{t("badCaseAnalysis")}</h4><p>{typeof draft.badCaseAnalysis === "string" ? draft.badCaseAnalysis : draft.badCaseAnalysis.summary}</p>{typeof draft.badCaseAnalysis === "object" ? <><StringList title={t("rootCauses")} values={draft.badCaseAnalysis.rootCauses}/><StringList title={t("improvements")} values={draft.badCaseAnalysis.improvements}/></> : null}</section> : null}
            </div>
        </details> : null}
    </div>
}
