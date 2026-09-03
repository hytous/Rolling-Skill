import {Input} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface RuntimeInteraction {
    id: string
    kind: "permission" | "question"
    ownerKind: "installation" | "operator"
    ownerId: string
    jobId?: string | null
    requestId?: string | null
    runtime?: {displayName?: string; version?: string; runtimeId?: string} | null
    options?: Array<{optionId?: string; id?: string; value?: string; label?: string; name?: string}>
    questions?: Array<{id?: string; questionId?: string; prompt?: string; question?: string}>
    details?: {tool?: string | null; reason?: string | null; command?: string | string[] | null; cwd?: string | null; arguments?: unknown; permissions?: unknown; locations?: unknown}
    createdAt: string
    expiresAt: string
}

export function RuntimeInteractions({
    t,
    ownerKind,
    ownerId,
}: {
    t: Translate
    ownerKind?: RuntimeInteraction["ownerKind"]
    ownerId?: string
}) {
    const [items, setItems] = useState<RuntimeInteraction[]>([])
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [busyId, setBusyId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<RuntimeInteraction[]>("interactions.list", {
            ownerKind,
            ...(ownerId ? {ownerId} : {}),
        }, controller.signal).then(setItems).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [ownerKind, ownerId, revision])

    useEffect(() => {
        const timer = window.setInterval(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearInterval(timer)
    }, [])

    const resolve = async (interaction: RuntimeInteraction, input: Record<string, unknown>) => {
        setBusyId(interaction.id)
        setError(null)
        try {
            await requestRollingSkill("interactions.resolve", {interactionId: interaction.id, ...input})
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusyId(null)
        }
    }

    if (!items.length && !error) return null
    return <section className="rolling-skill-subpanel rolling-skill-section-gap">
        <h4>{t("runtimeInteractions")}</h4>
        {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
        <div className="rolling-skill-list">{items.map((interaction) => <article className="rolling-skill-list-row" key={interaction.id}>
            <div>
                <strong>{interaction.kind === "permission" ? t("runtimePermissionRequest") : t("runtimeQuestionRequest")}</strong>
                <span>{interaction.runtime?.displayName ?? interaction.ownerId} {interaction.runtime?.version ?? ""} · {interaction.jobId ?? interaction.ownerId}</span>
                {interaction.details ? <div className="rolling-skill-detail-stack">
                    {interaction.details.reason ? <p>{interaction.details.reason}</p> : null}
                    {interaction.details.tool ? <strong>{interaction.details.tool}</strong> : null}
                    {interaction.details.cwd ? <code>{interaction.details.cwd}</code> : null}
                    {interaction.details.command ? <pre className="rolling-skill-verbatim">{Array.isArray(interaction.details.command) ? interaction.details.command.join(" ") : interaction.details.command}</pre> : null}
                    {interaction.details.arguments || interaction.details.permissions || interaction.details.locations ? <details><summary>{t("details")}</summary><pre className="rolling-skill-verbatim">{JSON.stringify({arguments: interaction.details.arguments, permissions: interaction.details.permissions, locations: interaction.details.locations}, null, 2)}</pre></details> : null}
                </div> : null}
                {interaction.kind === "permission" ? <div className="rolling-skill-actions">{(interaction.options ?? []).map((option) => {
                    const decision = option.optionId ?? option.id ?? option.value ?? ""
                    return <Button key={decision} size="sm" disabled={busyId === interaction.id || !decision} onClick={() => void resolve(interaction, {decision})}>{option.label ?? option.name ?? decision}</Button>
                })}<Button size="sm" disabled={busyId === interaction.id} onClick={() => void resolve(interaction, {decision: "decline"})}>{t("reject")}</Button></div> : <div className="rolling-skill-detail-stack">{(interaction.questions ?? []).map((question, index) => {
                    const questionId = question.id ?? question.questionId ?? `question-${index}`
                    const key = `${interaction.id}:${questionId}`
                    return <label className="rolling-skill-field" key={questionId}><span>{question.prompt ?? question.question ?? questionId}</span><Input value={answers[key] ?? ""} onChange={(event: {target: {value: string}}) => setAnswers((current) => ({...current, [key]: event.target.value}))}/></label>
                })}<Button size="sm" disabled={busyId === interaction.id} onClick={() => void resolve(interaction, {answers: (interaction.questions ?? []).map((question, index) => {const questionId = question.id ?? question.questionId ?? `question-${index}`; return {questionId, answer: answers[`${interaction.id}:${questionId}`] ?? ""}})})}>{t("submitAnswers")}</Button></div>}
            </div>
        </article>)}</div>
    </section>
}
