import {useEffect, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {usePollingRevision} from "./usePollingRevision"
import {ConfirmDialog} from "./ConfirmDialog"
import {OperationStatus} from "./OperationStatus"
import {displayStatus} from "./display-state"
import {AgentProfileControls} from "./AgentProfileControls"

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
    rubricAgent: {runtimeId?: string | null; modelId: string | null; effort: string | null; effectiveModelId: string | null; effectiveEffort: string | null; working: boolean} | null
    conversation: Array<{id: string; role: string; text: string}>
    revisions: Array<{id: string; rubric: RubricDraft; rubricDigest: string; createdAt: string}>
    draft: RubricDraft | null
}

export function RubricSessionView({sessionId, t, onChanged}: {sessionId: string; t: Translate; onChanged: () => void}) {
    const [session, setSession] = useState<RubricSession | null>(null)
    const [message, setMessage] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [pendingMethod, setPendingMethod] = useState("")
    const [confirmDiscard, setConfirmDiscard] = useState(false)
    const keys = useRef(new Map<string, string>())
    const working = Boolean(session?.rubricAgent?.working || (session && ["queued", "running"].includes(session.status)))
    const [revision, refresh] = usePollingRevision(working)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<RubricSession>("rubrics.get", {sessionId}, controller.signal)
            .then((value) => { setSession(value); setError(null) })
            .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError")) })
        return () => controller.abort()
    }, [sessionId, revision])

    const mutate = async (method: string, extra: Record<string, unknown> = {}) => {
        if (!session || busy) return false
        const signature = `${method}:${session.revision}:${JSON.stringify(extra)}`
        let idempotencyKey = keys.current.get(signature)
        if (!idempotencyKey) {
            idempotencyKey = `${method}:${globalThis.crypto.randomUUID()}`
            keys.current.set(signature, idempotencyKey)
        }
        setBusy(true)
        setPendingMethod(method)
        setError(null)
        try {
            const result = await requestRollingSkill<any>(method, {sessionId: session.id, expectedRevision: session.revision, idempotencyKey, ...extra})
            keys.current.delete(signature)
            const updated = result.session ?? result
            if (updated?.id) setSession(updated)
            onChanged()
            return true
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
            return false
        } finally {
            setBusy(false)
            setPendingMethod("")
        }
    }

    if (!session && !error) return <div className="rolling-skill-state" role="status">{t("loading")}</div>
    if (!session) return <div className="rolling-skill-state rolling-skill-error" role="alert">{error}</div>
    const editable = !["archived", "cancelled"].includes(session.status)
    return (
        <section className="rolling-skill-panel rolling-skill-session-view">
            <div className="rolling-skill-panel-header"><div><h3>{t("rubricReview")}</h3><p>{displayStatus(session.status, t)}</p></div><Button size="sm" onClick={refresh}>{t("refresh")}</Button></div>
            {working || busy ? <OperationStatus state={busy ? "starting" : "running"}>{t(busy && pendingMethod !== "rubrics.send" && pendingMethod !== "rubrics.retry" ? "savingReviewChanges" : "rubricWorking")}</OperationStatus> : null}
            {session.error || error ? <p className="rolling-skill-inline-error" role="alert">{error ?? session.error}</p> : null}
            <section>
                <h4>{t("latestRubricDraft")}</h4>
                {session.draft ? <div className="rolling-skill-rubric-draft"><h3>{session.draft.title}</h3><p>{session.draft.summary}</p><p>{session.draft.scoringModel}</p>{session.draft.criteria?.map((criterion) => <article key={criterion.id}><strong>{criterion.id} · {criterion.title} · {t("weight")} {criterion.weight}</strong><p>{criterion.criterion}</p>{criterion.evidenceRequirements?.length ? <p><b>{t("rubricEvidenceRequirements")}: </b>{criterion.evidenceRequirements.join(" · ")}</p> : null}{criterion.scoringAnchors ? <details><summary>{t("scoringAnchors")}</summary><dl>{Object.entries(criterion.scoringAnchors).map(([score, anchor]) => <div key={score}><dt>{score}</dt><dd>{anchor}</dd></div>)}</dl></details> : null}{criterion.criticalFailure ? <span className="rolling-skill-inline-error">{t("criticalFailure")}</span> : null}</article>)}{session.draft.automaticFailures?.length ? <section><h4>{t("automaticFailures")}</h4>{session.draft.automaticFailures.map((failure) => <article key={failure.id}><strong>{failure.id} · {failure.condition}</strong><p>{failure.rationale}</p></article>)}</section> : null}</div> : <p>{t("noValidDraft")}</p>}
            </section>
            {editable ? <div className="rolling-skill-form-stack">
                <label className="rolling-skill-field"><span>{t("reviewMessage")}</span><textarea value={message} disabled={busy} onChange={(event) => setMessage(event.target.value)}/></label>
                <div className="rolling-skill-actions">
                    <Button tone="primary" disabled={busy || working || !message.trim()} onClick={async () => {if (await mutate("rubrics.send", {text: message.trim()})) setMessage("")}}>{t("sendRevision")}</Button>
                    {session.status === "failed" ? <Button disabled={busy} onClick={() => mutate("rubrics.retry")}>{t("retry")}</Button> : null}
                    <Button disabled={busy || session.status !== "needs_review" || !session.draft} onClick={() => mutate("rubrics.publish")}>{t("publishRubric")}</Button>
                    <Button disabled={busy} onClick={() => setConfirmDiscard(true)}>{t("discardDraft")}</Button>
                </div>
            </div> : null}
            <details className="rolling-skill-curation-runtime-details">
                <summary>{t("runtimeInformation")}</summary>
                {editable ? <AgentProfileControls t={t} runtimeId={session.rubricAgent?.runtimeId} modelId={session.rubricAgent?.modelId ?? ""} effort={session.rubricAgent?.effort ?? ""} disabled={working || busy} onModelChange={(modelId) => void mutate("rubrics.model", {modelId: modelId || null})} onEffortChange={(effort) => void mutate("rubrics.effort", {effort: effort || null})}/> : null}
                {session.operationEvidence ? <section className="rolling-skill-evidence-card"><h4>{t("frozenEvidence")}</h4><dl><div><dt>{t("skillRepositories")}</dt><dd>{session.operationEvidence.skillName ?? t("notAvailable")} · {session.operationEvidence.versionLabel ?? t("notAvailable")}</dd></div><div><dt>{t("installationCommit")}</dt><dd><code>{session.operationEvidence.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div><div><dt>{t("installationDigest")}</dt><dd><code>{session.operationEvidence.contentDigest ?? t("notAvailable")}</code></dd></div><div><dt>{t("installationRuntime")}</dt><dd>{session.operationEvidence.runtime?.displayName ?? t("notAvailable")} {session.operationEvidence.runtime?.version ?? ""}</dd></div></dl></section> : null}
                <section><h4>{t("rubricAgentConversation")}</h4><div className="rolling-skill-conversation-log">{session.conversation.map((entry) => <div key={entry.id} data-role={entry.role}><strong>{entry.role}</strong><p>{entry.text}</p></div>)}</div></section>
            </details>
            <ConfirmDialog open={confirmDiscard} title={t("discardDraft")} description={t("discardRubricConfirm")} confirmLabel={t("discardDraft")} cancelLabel={t("cancel")} busy={busy} destructive onCancel={() => setConfirmDiscard(false)} onConfirm={async () => {if (await mutate("rubrics.discard")) setConfirmDiscard(false)}}/>
        </section>
    )
}
