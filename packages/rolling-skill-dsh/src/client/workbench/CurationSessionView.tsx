import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useRef, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {WorkbenchRoute} from "./Workbench"

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
    operationEvidence: Record<string, unknown> | null
    curator: {modelId: string | null; effort: string | null; effectiveModelId: string | null; effectiveEffort: string | null; working: boolean} | null
    conversation: Array<{id: string; role: string; text: string}>
    revisions: Array<{id: string; draft: unknown; createdAt: string}>
    draft: unknown
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
    const [revision, setRevision] = useState(0)
    const [session, setSession] = useState<CurationSession | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState("")
    const [busy, setBusy] = useState(false)
    const keys = useRef(new Map<string, string>())

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<CurationSession>("curation.get", {sessionId}, controller.signal)
            .then((value) => { setSession(value); setError(null) })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
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
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
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
                <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
            </div>
            {session.error || error ? <p className="rolling-skill-inline-error" role="alert">{error ?? session.error}</p> : null}
            <section className="rolling-skill-evidence-card">
                <h4>{t("frozenEvidence")}</h4>
                <dl>
                    <div><dt>{t("sourceRange")}</dt><dd>{session.episode?.source.startSeq}–{session.episode?.source.endSeq}</dd></div>
                    <div><dt>Digest</dt><dd><code>{session.episode?.source.digest}</code></dd></div>
                </dl>
                {session.episode?.source.observedSkills.map((skill) => (
                    <p key={`${skill.name}:${skill.callSeq}`}>{skill.name} · {skill.provider} · #{skill.callSeq}–{skill.resultSeq}</p>
                ))}
                {session.operationEvidence ? <pre>{JSON.stringify(session.operationEvidence, null, 2)}</pre> : null}
            </section>
            <section>
                <h4>{t("curatorConversation")}</h4>
                <div className="rolling-skill-conversation-log">
                    {session.conversation.map((entry) => (
                        <div key={entry.id} data-role={entry.role}><strong>{entry.role}</strong><p>{entry.text}</p></div>
                    ))}
                </div>
            </section>
            <section>
                <h4>{t("latestDraft")}</h4>
                {session.draft ? <pre>{JSON.stringify(session.draft, null, 2)}</pre> : <p>{t("noValidDraft")}</p>}
            </section>
            {editable ? (
                <div className="rolling-skill-form-stack">
                    <label className="rolling-skill-field"><span>{t("model")}</span><input value={session.curator?.modelId ?? ""} onChange={(event) => setSession({...session, curator: {...session.curator!, modelId: event.target.value}})} onBlur={() => mutate("curation.model", {modelId: session.curator?.modelId || null})}/></label>
                    <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={session.curator?.effort ?? ""} onChange={(event) => mutate("curation.effort", {effort: event.target.value || null})}><option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>
                    <label className="rolling-skill-field"><span>{t("reviewMessage")}</span><textarea value={message} onChange={(event) => setMessage(event.target.value)}/></label>
                    <div className="rolling-skill-actions">
                        <Button disabled={busy || !message.trim()} onClick={() => mutate("curation.send", {text: message.trim()}).then(() => setMessage(""))}>{t("sendRevision")}</Button>
                        {session.status === "failed" ? <Button variant="outline" disabled={busy} onClick={() => mutate("curation.retry")}>{t("retry")}</Button> : null}
                        <Button variant="outline" disabled={busy || session.status !== "needs_review" || !session.draft} onClick={() => mutate("curation.save")}>{t("saveCase")}</Button>
                        <Button variant="outline" disabled={busy} onClick={() => { if (window.confirm(t("discardDraftConfirm"))) mutate("curation.discard") }}>{t("discardDraft")}</Button>
                    </div>
                </div>
            ) : null}
        </section>
    )
}
