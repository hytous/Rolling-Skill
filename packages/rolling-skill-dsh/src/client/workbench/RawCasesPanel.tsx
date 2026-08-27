import {Button, Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface RawCase {
    id: string
    question: string
    note: string
    revision: number
    skill: {id?: string; name: string}
    source?: {kind?: string; observations?: Array<{runtimeId?: string; confidence?: number; outcome?: string; caseType?: string; inspectedAt?: string}>}
}
interface ManagedSkill {id: string; repositoryId: string; name: string; status: string}
interface Repository {id: string; displayName: string}
interface SkillCatalog {repositories: Repository[]; skills: ManagedSkill[]}

interface RawCasesPanelProps {
    t: Translate
    revision: number
    onChanged: () => void
    initialRawCaseId?: string
}

export function RawCasesPanel({t, revision, onChanged, initialRawCaseId}: RawCasesPanelProps) {
    const [entries, setEntries] = useState<RawCase[]>([])
    const [catalog, setCatalog] = useState<SkillCatalog>({repositories: [], skills: []})
    const [search, setSearch] = useState("")
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<RawCase | null>(null)
    const [question, setQuestion] = useState("")
    const [note, setNote] = useState("")
    const [skillId, setSkillId] = useState("")
    const [deleting, setDeleting] = useState<RawCase | null>(null)
    const [inspecting, setInspecting] = useState<RawCase | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RawCase[]>("rawCases.list", {}, controller.signal),
            requestRollingSkill<SkillCatalog>("skills.catalog", {}, controller.signal),
        ]).then(([rawCases, nextCatalog]) => {
            setEntries(rawCases)
            setCatalog(nextCatalog)
            const valid = nextCatalog.skills.filter((skill) => skill.status === "valid")
            setSkillId((current) => valid.some((skill) => skill.id === current) ? current : valid[0]?.id ?? "")
            if (initialRawCaseId) setInspecting(rawCases.find((entry) => entry.id === initialRawCaseId) ?? null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialRawCaseId])

    const filteredGroups = useMemo(() => {
        const query = search.trim().toLocaleLowerCase()
        const filtered = entries.filter((entry) => !query || `${entry.question}\n${entry.note}\n${entry.skill.name}`.toLocaleLowerCase().includes(query))
        const groups = new Map<string, RawCase[]>()
        for (const entry of filtered) {
            const key = entry.skill.id ?? `legacy:${entry.skill.name}`
            groups.set(key, [...(groups.get(key) ?? []), entry])
        }
        return [...groups.entries()].map(([key, items]) => ({key, name: items[0].skill.name, items}))
    }, [entries, search])

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
    const selectedSkill = () => catalog.skills.find((skill) => skill.id === skillId)
    const beginAdd = () => {
        setAdding(true)
        setEditing(null)
        setQuestion("")
        setNote("")
    }
    const beginEdit = (entry: RawCase) => {
        setAdding(false)
        setEditing(entry)
        setQuestion(entry.question)
        setNote(entry.note ?? "")
        const exact = catalog.skills.find((skill) => skill.id === entry.skill.id)
            ?? catalog.skills.find((skill) => skill.name === entry.skill.name && skill.status === "valid")
        setSkillId(exact?.id ?? catalog.skills.find((skill) => skill.status === "valid")?.id ?? "")
    }
    const add = () => {
        const skill = selectedSkill()
        if (!skill) return
        void mutate(async () => {
            await requestRollingSkill("rawCases.add", {
                question,
                note,
                repositoryId: skill.repositoryId,
                skillId: skill.id,
            })
            setAdding(false)
        })
    }
    const save = () => {
        const entry = editing
        const skill = selectedSkill()
        if (!entry || !skill) return
        void mutate(async () => {
            await requestRollingSkill("rawCases.updateManaged", {
                id: entry.id,
                expectedRevision: entry.revision,
                expectedSkillName: entry.skill.name,
                question,
                note,
                repositoryId: skill.repositoryId,
                skillId: skill.id,
                idempotencyKey: crypto.randomUUID(),
            })
            setEditing(null)
        })
    }
    const recycle = () => {
        const entry = deleting
        if (!entry) return
        void mutate(async () => {
            await requestRollingSkill("rawCases.recycle", {id: entry.id, idempotencyKey: crypto.randomUUID()})
            setDeleting(null)
        })
    }

    const form = <div className="rolling-skill-form-stack">
        <label><span>{t("question")}</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)}/></label>
        <label><span>{t("datasetSkill")}</span><select className="rolling-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
            {catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
                const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId)
                return <option key={skill.id} value={skill.id}>{skill.name} · {repository?.displayName ?? skill.repositoryId}</option>
            })}
        </select></label>
        <label><span>{t("note")}</span><Input value={note} onChange={(event: {target: {value: string}}) => setNote(event.target.value)}/></label>
    </div>

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("rawCasesTitle")}</h3><p>{t("rawCasesDescription")}</p></div>
                <Button variant="outline" size="sm" disabled={!catalog.skills.some((skill) => skill.status === "valid")} onClick={beginAdd}>{t("addRawCase")}</Button>
            </div>
            <Input value={search} placeholder={t("searchRawCases")} aria-label={t("searchRawCases")} onChange={(event: {target: {value: string}}) => setSearch(event.target.value)}/>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-group-list">
                {filteredGroups.map((group) => <section className="rolling-skill-raw-group" key={group.key}>
                    <h4>{group.name} <span>{group.items.length}</span></h4>
                    <div className="rolling-skill-list">{group.items.map((entry) => (
                        <article className="rolling-skill-list-row" key={entry.id}>
                            <div><strong className="rolling-skill-verbatim">{entry.question}</strong><span>{entry.source?.kind ?? t("manualSource")}{entry.note ? ` · ${entry.note}` : ""}</span></div>
                            <div className="rolling-skill-actions">
                                <Button variant="ghost" size="sm" onClick={() => setInspecting(entry)}>{t("details")}</Button>
                                <Button variant="ghost" size="sm" onClick={() => beginEdit(entry)}>{t("edit")}</Button>
                                <Button variant="ghost" size="sm" onClick={() => setDeleting(entry)}>{t("delete")}</Button>
                            </div>
                        </article>
                    ))}</div>
                </section>)}
                {filteredGroups.length === 0 ? <p>{t("emptyRawCases")}</p> : null}
            </div>
            <Modal open={adding} onClose={() => setAdding(false)} title={t("addRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button variant="outline" onClick={() => setAdding(false)}>{t("cancel")}</Button><Button variant="outline" disabled={busy || !question.trim() || !skillId} onClick={add}>{t("save")}</Button></>}>
                {form}
            </Modal>
            <Modal open={editing !== null} onClose={() => setEditing(null)} title={t("editRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button variant="outline" onClick={() => setEditing(null)}>{t("cancel")}</Button><Button variant="outline" disabled={busy || !question.trim() || !skillId} onClick={save}>{t("save")}</Button></>}>
                {form}
            </Modal>
            <Modal open={inspecting !== null} onClose={() => setInspecting(null)} title={t("rawCaseEvidence")} closeLabel={t("close")} footer={<Button variant="outline" onClick={() => setInspecting(null)}>{t("close")}</Button>}>
                {inspecting ? <div className="rolling-skill-detail-stack"><h4>{t("question")}</h4><p className="rolling-skill-verbatim">{inspecting.question}</p><h4>{t("caseEvidence")}</h4><pre>{JSON.stringify(inspecting.source ?? {kind: "manual"}, null, 2)}</pre></div> : null}
            </Modal>
            <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={t("deleteRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button variant="outline" onClick={() => setDeleting(null)}>{t("cancel")}</Button><Button variant="outline" disabled={busy} onClick={recycle}>{t("confirmDelete")}</Button></>}><p>{t("deleteRawCasePrompt")}</p></Modal>
        </section>
    )
}
