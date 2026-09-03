import {Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ModelEffortSelect} from "./ModelEffortSelect"
import type {RuntimeModel} from "./ModelEffortSelect"
import {RuntimeInteractions} from "./RuntimeInteractions"
import type {RuntimeDescriptor} from "./RuntimeSelect"

const SETTINGS_KEY = "rolling-skill:skill-edit-runtime-settings/v1"
const ACTIVE_STATES = new Set(["draft", "running", "idle", "applying", "needs_recovery"])
const RUNNING_STATES = new Set(["draft", "running", "applying"])

interface SkillEditDiffFile {
    path: string
    status: "added" | "deleted" | "modified"
    binary: boolean
    additions: number | null
    deletions: number | null
    patch: string
    truncated: boolean
}

interface SkillEditDiff {
    changed: boolean
    truncated: boolean
    valid: boolean
    validationError?: {message?: string} | null
    files: SkillEditDiffFile[]
}

interface SkillEditSession {
    id: string
    skillId: string
    state: string
    revision: number
    runtime: {runtimeId: string; modelId: string; effort: string}
    objective: string
    operatorSessionId: string | null
    operator?: {state?: string | null; jobStatus?: string | null} | null
    messages: Array<{role: "user" | "assistant"; content: string; recordedAt?: string | null}>
    diff: SkillEditDiff | null
    publishedVersionLabel: string | null
    error?: {message?: string} | null
}

interface RememberedSettings {runtimeId?: string; modelId?: string; effort?: string}

function rememberedSettings(): RememberedSettings {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}")
        return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
        return {}
    }
}

function modelIdentifier(model: RuntimeModel): string {
    return model.id ?? model.model ?? ""
}

function stateLabel(t: Translate, state: string): string {
    const labels: Record<string, ReturnType<typeof t>> = {
        draft: t("skillEditStateDraft"),
        running: t("skillEditStateRunning"),
        idle: t("skillEditStateIdle"),
        applying: t("skillEditStateApplying"),
        needs_recovery: t("skillEditStateRecovery"),
        published: t("skillEditStatePublished"),
        discarded: t("skillEditStateDiscarded"),
        failed: t("skillEditStateFailed"),
    }
    return labels[state] ?? state
}

export function SkillEditModal({
    t,
    open,
    skillId,
    skillName,
    onClose,
    onPublished,
}: {
    t: Translate
    open: boolean
    skillId: string
    skillName: string
    onClose: () => void
    onPublished: () => void
}) {
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [models, setModels] = useState<RuntimeModel[]>([])
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [objective, setObjective] = useState("")
    const [message, setMessage] = useState("")
    const [session, setSession] = useState<SkillEditSession | null>(null)
    const [busy, setBusy] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const refreshSession = async (sessionId: string, signal?: AbortSignal) => {
        const next = await requestRollingSkill<SkillEditSession>("skillEdits.get", {sessionId}, signal)
        setSession(next)
        return next
    }

    useEffect(() => {
        if (!open || !skillId) return
        const controller = new AbortController()
        const remembered = rememberedSettings()
        setLoading(true)
        setError(null)
        Promise.all([
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
            requestRollingSkill<{sessions: SkillEditSession[]}>("skillEdits.list", {skillId}, controller.signal),
        ]).then(async ([runtimeItems, result]) => {
            setRuntimes(runtimeItems)
            const selectedRuntime = runtimeItems.some((runtime) => runtime.runtimeId === remembered.runtimeId)
                ? remembered.runtimeId ?? ""
                : runtimeItems[0]?.runtimeId ?? ""
            setRuntimeId(selectedRuntime)
            const active = result.sessions.find((candidate) => ACTIVE_STATES.has(candidate.state))
            if (active) await refreshSession(active.id, controller.signal)
            else setSession(null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
    }, [open, skillId])

    useEffect(() => {
        if (!open || session || !runtimeId) return
        const controller = new AbortController()
        const remembered = rememberedSettings()
        requestRollingSkill<RuntimeModel[]>("runtimes.models", {runtimeId}, controller.signal)
            .then((items) => {
                setModels(items)
                const rememberedModel = remembered.runtimeId === runtimeId ? remembered.modelId : ""
                const selectedModel = items.some((model) => modelIdentifier(model) === rememberedModel)
                    ? rememberedModel ?? ""
                    : modelIdentifier(items[0] ?? {})
                setModelId(selectedModel)
                setEffort(remembered.runtimeId === runtimeId && selectedModel === remembered.modelId ? remembered.effort ?? "" : "")
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [open, runtimeId, session?.id])

    useEffect(() => {
        if (!open || !session || !ACTIVE_STATES.has(session.state)) return
        const timer = window.setInterval(() => void refreshSession(session.id).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }), 1_500)
        return () => window.clearInterval(timer)
    }, [open, session?.id, session?.state])

    const perform = async (operation: () => Promise<SkillEditSession>) => {
        setBusy(true)
        setError(null)
        try {
            setSession(await operation())
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }

    const start = () => perform(async () => {
        const next = await requestRollingSkill<SkillEditSession>("skillEdits.start", {
            skillId,
            runtimeId,
            modelId,
            effort,
            objective,
        })
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({runtimeId, modelId, effort}))
        return next
    })
    const send = () => perform(async () => {
        const next = await requestRollingSkill<SkillEditSession>("skillEdits.send", {sessionId: session?.id, text: message})
        setMessage("")
        return next
    })
    const apply = () => perform(async () => {
        const next = await requestRollingSkill<SkillEditSession>("skillEdits.applyAndRelease", {
            sessionId: session?.id,
            expectedRevision: session?.revision,
        })
        onPublished()
        return next
    })
    const discard = () => perform(() => requestRollingSkill<SkillEditSession>("skillEdits.discard", {
        sessionId: session?.id,
        expectedRevision: session?.revision,
    }))

    const canSend = Boolean(session?.operatorSessionId && ACTIVE_STATES.has(session.state) && session.state !== "applying")
    const canApply = Boolean(session?.state === "idle" && session.diff?.changed && session.diff.valid)
    const canStart = Boolean(runtimeId && modelId && effort && objective.trim())
    const footer = session ? <>
        {ACTIVE_STATES.has(session.state) ? <Button disabled={busy || session.state === "applying"} onClick={() => void discard()}>{t("discardSkillEdit")}</Button> : null}
        {ACTIVE_STATES.has(session.state) ? <Button tone="primary" disabled={busy || !canApply} onClick={() => void apply()}>{t("applySkillEdit")}</Button> : null}
        <Button onClick={onClose}>{t("close")}</Button>
    </> : <>
        <Button onClick={onClose}>{t("cancel")}</Button>
        <Button tone="primary" disabled={busy || loading || !canStart} onClick={() => void start()}>{t("startSkillEdit")}</Button>
    </>

    const changedFiles = useMemo(() => session?.diff?.files ?? [], [session?.diff])

    return <Modal open={open} onClose={onClose} title={`${t("skillEditTitle")} · ${skillName}`} closeLabel={t("close")} footer={footer}>
        <div className="rolling-skill-skill-edit-modal">
            {loading ? <p>{t("loading")}</p> : null}
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            {!session && !loading ? <div className="rolling-skill-detail-stack">
                <p className="rolling-skill-help">{t("skillEditDescription")}</p>
                <label className="rolling-skill-field"><span>{t("skillEditRuntime")}</span><select className="rolling-skill-select" aria-label={t("skillEditRuntime")} disabled={runtimes.length === 0} value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>{runtimes.length === 0 ? <option value="">{t("noRuntimes")}</option> : runtimes.map((runtime) => <option key={runtime.runtimeId} value={runtime.runtimeId}>{runtime.displayName} {runtime.version}</option>)}</select></label>
                <div className="rolling-skill-grid">
                    <label className="rolling-skill-field"><span>{t("model")}</span><select className="rolling-skill-select" value={modelId} onChange={(event) => {setModelId(event.target.value); setEffort("")}}>{models.map((model) => {const id = modelIdentifier(model); return <option key={id} value={id}>{model.displayName ?? id}</option>})}</select></label>
                    <ModelEffortSelect label={t("effort")} runtimeDefaultLabel={t("selectSkillEditEffort")} models={models} modelId={modelId} value={effort} onChange={setEffort}/>
                </div>
                <label className="rolling-skill-field"><span>{t("skillEditObjective")}</span><textarea className="rolling-skill-textarea" value={objective} placeholder={t("skillEditObjectivePlaceholder")} onChange={(event) => setObjective(event.target.value)}/></label>
            </div> : null}
            {session ? <div className="rolling-skill-detail-stack">
                <div className="rolling-skill-skill-edit-status"><div><strong>{stateLabel(t, session.state)}</strong><span>{session.runtime.runtimeId} · {session.runtime.modelId} · {session.runtime.effort}</span></div>{session.publishedVersionLabel ? <span>{t("publishedVersionLabel")} {session.publishedVersionLabel}</span> : null}</div>
                {session.messages.length === 0 ? <p className="rolling-skill-help">{session.objective}</p> : null}
                {session.error?.message ? <p className="rolling-skill-inline-error" role="alert">{session.error.message}</p> : null}
                {session.state !== "published" ? <div className="rolling-skill-skill-edit-layout">
                    <section className="rolling-skill-subpanel rolling-skill-skill-edit-conversation">
                        <h4>{t("skillEditConversation")}</h4>
                        <div className="rolling-skill-skill-edit-messages">{session.messages.map((entry, index) => <article data-role={entry.role} key={`${entry.recordedAt ?? "message"}-${index}`}><strong>{entry.role === "assistant" ? t("agent") : t("you")}</strong><p>{entry.content}</p></article>)}{session.messages.length === 0 ? <p>{t("emptySkillEditConversation")}</p> : null}</div>
                        {canSend ? <div className="rolling-skill-skill-edit-follow-up"><textarea className="rolling-skill-textarea" value={message} placeholder={t("skillEditFollowUp")} onChange={(event) => setMessage(event.target.value)}/><Button disabled={busy || !message.trim()} onClick={() => void send()}>{t("send")}</Button></div> : null}
                    </section>
                    <section className="rolling-skill-subpanel rolling-skill-skill-edit-diff">
                        <h4>{t("skillEditChanges")}</h4>
                        {session.diff?.validationError?.message ? <p className="rolling-skill-inline-error">{session.diff.validationError.message}</p> : null}
                        <div className="rolling-skill-skill-edit-files">{changedFiles.map((file) => <article key={file.path}><header><strong>{file.path}</strong><span>{t(file.status === "added" ? "skillEditAdded" : file.status === "deleted" ? "skillEditDeleted" : "skillEditModified")} · +{file.additions ?? "–"} / -{file.deletions ?? "–"}</span></header>{file.binary ? <p>{t("skillEditBinaryFile")}</p> : <pre>{file.patch}</pre>}{file.truncated ? <small>{t("skillEditDiffTruncated")}</small> : null}</article>)}{!changedFiles.length ? <p>{RUNNING_STATES.has(session.state) ? t("skillEditWaitingForChanges") : t("skillEditNoChanges")}</p> : null}</div>
                        {session.diff?.truncated ? <p className="rolling-skill-help">{t("skillEditDiffTruncated")}</p> : null}
                    </section>
                </div> : null}
                {session.operatorSessionId ? <RuntimeInteractions t={t} ownerKind="operator" ownerId={session.operatorSessionId}/> : null}
            </div> : null}
        </div>
    </Modal>
}
