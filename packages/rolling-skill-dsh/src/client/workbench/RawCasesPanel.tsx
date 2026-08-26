import {Button, Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface RawCase {
    id: string
    question: string
    note: string
    revision: number
    skill: {name: string}
}

export function RawCasesPanel({t, revision, onChanged}: {t: Translate; revision: number; onChanged: () => void}) {
    const [entries, setEntries] = useState<RawCase[]>([])
    const [editing, setEditing] = useState<RawCase | null>(null)
    const [question, setQuestion] = useState("")
    const [note, setNote] = useState("")
    const [deleting, setDeleting] = useState<RawCase | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<RawCase[]>("rawCases.list", {}, controller.signal)
            .then(setEntries)
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [revision])

    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true)
        setError(null)
        try {
            await operation()
            onChanged()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const beginEdit = (entry: RawCase) => {
        setEditing(entry)
        setQuestion(entry.question)
        setNote(entry.note ?? "")
    }
    const save = () => {
        const entry = editing
        if (!entry) return
        void mutate(async () => {
            await requestRollingSkill("rawCases.update", {
                id: entry.id,
                expectedRevision: entry.revision,
                expectedSkillName: entry.skill.name,
                changes: {question, note},
                idempotencyKey: crypto.randomUUID(),
            })
            setEditing(null)
        })
    }
    const recycle = () => {
        const entry = deleting
        if (!entry) return
        void mutate(async () => {
            await requestRollingSkill("rawCases.recycle", {
                id: entry.id,
                idempotencyKey: crypto.randomUUID(),
            })
            setDeleting(null)
        })
    }

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header"><div><h3>{t("rawCasesTitle")}</h3><p>{t("rawCasesDescription")}</p></div></div>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-list">
                {entries.map((entry) => (
                    <article className="rolling-skill-list-row" key={entry.id}>
                        <div><strong>{entry.question}</strong><span>{entry.skill.name}{entry.note ? ` · ${entry.note}` : ""}</span></div>
                        <div className="rolling-skill-actions">
                            <Button variant="ghost" size="sm" onClick={() => beginEdit(entry)}>{t("edit")}</Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleting(entry)}>{t("delete")}</Button>
                        </div>
                    </article>
                ))}
                {entries.length === 0 ? <p>{t("emptyRawCases")}</p> : null}
            </div>
            <Modal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={t("editRawCaseTitle")}
                closeLabel={t("cancel")}
                footer={<><Button variant="outline" onClick={() => setEditing(null)}>{t("cancel")}</Button><Button variant="outline" disabled={busy || !question.trim()} onClick={save}>{t("save")}</Button></>}
            >
                <div className="rolling-skill-form-stack">
                    <label><span>{t("question")}</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)}/></label>
                    <label><span>{t("note")}</span><Input value={note} onChange={(event: {target: {value: string}}) => setNote(event.target.value)}/></label>
                </div>
            </Modal>
            <Modal
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t("deleteRawCaseTitle")}
                closeLabel={t("cancel")}
                footer={<><Button variant="outline" onClick={() => setDeleting(null)}>{t("cancel")}</Button><Button variant="outline" disabled={busy} onClick={recycle}>{t("confirmDelete")}</Button></>}
            ><p>{t("deleteRawCasePrompt")}</p></Modal>
        </section>
    )
}
