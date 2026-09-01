import {useEffect, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface RubricDraft {
    title?: string
    summary?: string
    scoringModel?: string
    criteria?: Array<{id?: string; title?: string; criterion?: string; weight?: number; evidenceRequirements?: string[]; scoringAnchors?: Record<string, string>; criticalFailure?: boolean}>
    automaticFailures?: Array<{id?: string; condition?: string; rationale?: string}>
}

interface OperationEvidence {
    skillName?: string | null
    versionLabel?: string | null
    commit?: string | null
    contentDigest?: string | null
    runtime?: {displayName?: string | null; version?: string | null} | null
    installation?: {jobId?: string | null; verification?: string | null; installedAt?: string | null} | null
}

interface RubricSession {
    id: string
    datasetId: string
    status: string
    revision: string
    error: string | null
    operationEvidence: OperationEvidence | null
    rubricAgent: {modelId: string | null; effort: string | null; effectiveModelId: string | null; effectiveEffort: string | null; working: boolean} | null
    conversation: Array<{id: string; role: string; text: string}>
    revisions: Array<{id: string; rubric: RubricDraft; rubricDigest: string; createdAt: string}>
    draft: RubricDraft | null
}

export function RubricSessionView({sessionId, t, onChanged}: {sessionId: string; t: Translate; onChanged: () => void}) {
    const [revision, setRevision] = useState(0)
    const [session, setSession] = useState<RubricSession | null>(null)
    const [message, setMessage] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const keys = useRef(new Map<string, string>())

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<RubricSession>("rubrics.get", {sessionId}, controller.signal)
            .then((value) => { setSession(value); setError(null) })
            .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError")) })
        return () => controller.abort()
    }, [sessionId, revision])

    useEffect(() => {
        if (!session || !["queued", "running"].includes(session.status)) return
        const timer = window.setTimeout(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearTimeout(timer)
    }, [session?.status, session?.revision])

    const mutate = async (method: string, extra: Record<string, unknown> = {}) => {
        if (!session || busy) return
        const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`
        let idempotencyKey = keys.current.get(signature)
        if (!idempotencyKey) {
            idempotencyKey = `${method}:${globalThis.crypto.randomUUID()}`
            keys.current.set(signature, idempotencyKey)
        }
        setBusy(true)
        setError(null)
        try {
            const result = await requestRollingSkill<any>(method, {sessionId: session.id, expectedRevision: session.revision, idempotencyKey, ...extra})
            keys.current.delete(signature)
            const updated = result.session ?? result
            if (updated?.id) setSession(updated)
            if (method === "rubrics.publish" || method === "rubrics.discard") onChanged()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }

    if (!session && !error) return <div className="rolling-skill-state" role="status">{t("loading")}</div>
    if (!session) return <div className="rolling-skill-state rolling-skill-error" role="alert">{error}</div>
    const editable = !["archived", "cancelled"].includes(session.status)
    const working = Boolean(session.rubricAgent?.working || ["queued", "running"].includes(session.status))
    return (
        <section className="rolling-skill-panel rolling-skill-session-view">
            <div className="rolling-skill-panel-header"><div><h3>{t("rubricReview")}</h3><p role={working ? "status" : undefined} aria-live={working ? "polite" : undefined}>{working ? t("rubricWorking") : session.status}</p></div><Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button></div>
            {session.error || error ? <p className="rolling-skill-inline-error" role="alert">{error ?? session.error}</p> : null}
            {session.operationEvidence ? <section className="rolling-skill-evidence-card"><h4>{t("frozenEvidence")}</h4><dl><div><dt>{t("skillRepositories")}</dt><dd>{session.operationEvidence.skillName ?? t("notAvailable")} · {session.operationEvidence.versionLabel ?? t("notAvailable")}</dd></div><div><dt>{t("installationCommit")}</dt><dd><code>{session.operationEvidence.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div><div><dt>{t("installationDigest")}</dt><dd title={session.operationEvidence.contentDigest ?? undefined}><code>{session.operationEvidence.contentDigest ?? t("notAvailable")}</code></dd></div><div><dt>{t("installationRuntime")}</dt><dd>{session.operationEvidence.runtime?.displayName ?? t("notAvailable")} {session.operationEvidence.runtime?.version ?? ""}</dd></div><div><dt>{t("installationJob")}</dt><dd>{session.operationEvidence.installation?.jobId ?? t("notAvailable")} · {session.operationEvidence.installation?.verification ?? t("notAvailable")}</dd></div></dl></section> : null}
            <section><h4>{t("rubricAgentConversation")}</h4><div className="rolling-skill-conversation-log">{session.conversation.map((entry) => <div key={entry.id} data-role={entry.role}><strong>{entry.role}</strong><p>{entry.text}</p></div>)}</div></section>
            <section>
                <h4>{t("latestRubricDraft")}</h4>
                {session.draft ? <div className="rolling-skill-rubric-draft"><h3>{session.draft.title}</h3><p>{session.draft.summary}</p><p>{session.draft.scoringModel}</p>{session.draft.criteria?.map((criterion) => <article key={criterion.id}><strong>{criterion.id} · {criterion.title} · {t("weight")} {criterion.weight}</strong><p>{criterion.criterion}</p>{criterion.evidenceRequirements?.length ? <p><b>{t("rubricEvidenceRequirements")}: </b>{criterion.evidenceRequirements.join(" · ")}</p> : null}{criterion.scoringAnchors ? <details><summary>{t("scoringAnchors")}</summary><dl>{Object.entries(criterion.scoringAnchors).map(([score, anchor]) => <div key={score}><dt>{score}</dt><dd>{anchor}</dd></div>)}</dl></details> : null}{criterion.criticalFailure ? <span className="rolling-skill-inline-error">{t("criticalFailure")}</span> : null}</article>)}{session.draft.automaticFailures?.length ? <section><h4>{t("automaticFailures")}</h4>{session.draft.automaticFailures.map((failure) => <article key={failure.id}><strong>{failure.id} · {failure.condition}</strong><p>{failure.rationale}</p></article>)}</section> : null}</div> : <p>{t("noValidDraft")}</p>}
            </section>
            {editable ? <div className="rolling-skill-form-stack">
                <label className="rolling-skill-field"><span>{t("model")}</span><input value={session.rubricAgent?.modelId ?? ""} placeholder={t("configuredDefault")} onChange={(event) => setSession({...session, rubricAgent: {...session.rubricAgent!, modelId: event.target.value}})} onBlur={() => mutate("rubrics.model", {modelId: session.rubricAgent?.modelId || null})}/></label>
                <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={session.rubricAgent?.effort ?? ""} onChange={(event) => mutate("rubrics.effort", {effort: event.target.value || null})}><option value="">{t("configuredDefault")}</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option><option value="max">max</option></select></label>
                <label className="rolling-skill-field"><span>{t("reviewMessage")}</span><textarea value={message} onChange={(event) => setMessage(event.target.value)}/></label>
                <div className="rolling-skill-actions">
                    <Button tone="primary" disabled={busy || !message.trim()} onClick={() => mutate("rubrics.send", {text: message.trim()}).then(() => setMessage(""))}>{t("sendRevision")}</Button>
                    {session.status === "failed" ? <Button disabled={busy} onClick={() => mutate("rubrics.retry")}>{t("retry")}</Button> : null}
                    <Button disabled={busy || session.status !== "needs_review" || !session.draft} onClick={() => mutate("rubrics.publish")}>{t("publishRubric")}</Button>
                    <Button disabled={busy} onClick={() => { if (window.confirm(t("discardRubricConfirm"))) mutate("rubrics.discard") }}>{t("discardDraft")}</Button>
                </div>
            </div> : null}
        </section>
    )
}
