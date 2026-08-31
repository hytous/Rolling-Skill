import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState, useSyncExternalStore} from "react"

import {ActionButton as Button} from "./ActionButton"
import evidenceModel from "./raw-case-evidence.cjs"
import skillFilterModel from "./raw-case-skill-filter.cjs"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {activeConversationSessionSnapshot, subscribeActiveConversationSession} from "../conversation/active-session"

interface AutomaticObservation {
    runtimeId?: string
    threadId?: string
    startTurnId?: string
    startItemId?: string
    endTurnId?: string
    endItemId?: string
    confidence?: number
    outcome?: string
    caseType?: string
    inspectedAt?: string
    summary?: string
    reason?: string
}

interface RawCase {
    id: string
    question: string
    note: string
    revision: number
    skill: {id?: string; name: string}
    source?: {kind?: string; observations?: AutomaticObservation[]} & Partial<AutomaticObservation>
}
interface ManagedSkill {id: string; repositoryId: string; name: string; status: string}
interface Repository {id: string; displayName: string}
interface SkillCatalog {repositories: Repository[]; skills: ManagedSkill[]}
interface Dataset {id: string; name: string; activeRubricVersionId?: string | null; skillReference?: {id?: string; evidencePrecision?: string} | null}

interface EvidenceView {
    kind: string
    observation: AutomaticObservation | null
    startSeq: number | null
    endSeq: number | null
    canRevealRange: boolean
}

interface EpisodeItem {
    id: string | null
    type: string | null
    text: string
    sourceKind?: string | null
    toolName?: string | null
    status?: string | null
    arguments?: unknown
    result?: unknown
    error?: unknown
}

interface EvidenceResponse {
    provenance: "snapshot" | "source"
    episode: {items: EpisodeItem[]; source?: Record<string, unknown>}
}

interface TimelineItem extends EpisodeItem {
    kind: "user" | "assistant" | "context" | "tool"
    label: string
    boundary: "start" | "end" | null
    collapsible: boolean
}

interface RawCaseSkillOption {key: string; name: string; count: number}
interface RawCaseSkillGroup {key: string; name: string; items: RawCase[]}

const rawCaseEvidence = evidenceModel.rawCaseEvidence as (
    source: RawCase["source"],
    activeSessionId: string | null,
) => EvidenceView
const evidenceTimeline = evidenceModel.evidenceTimeline as (
    episode: EvidenceResponse["episode"] | null | undefined,
) => TimelineItem[]
const rawCaseSkillOptions = skillFilterModel.rawCaseSkillOptions as (
    entries: RawCase[],
    managedSkills?: ManagedSkill[],
) => RawCaseSkillOption[]
const rawCaseSkillGroups = skillFilterModel.rawCaseSkillGroups as (
    entries: RawCase[],
    search: string,
    scope: string,
) => RawCaseSkillGroup[]
const resolveRawCaseSkillScope = skillFilterModel.resolveRawCaseSkillScope as (
    scope: string,
    entries: RawCase[],
    managedSkills?: ManagedSkill[],
) => string

function dateTime(value: string | undefined, fallback: string): string {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

function confidence(value: number | undefined, fallback: string): string {
    return typeof value === "number" && Number.isFinite(value)
        ? `${Math.round(value * 100)}%`
        : fallback
}

function detailText(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

interface RawCasesPanelProps {
    t: Translate
    revision: number
    onChanged: () => void
    initialRawCaseId?: string
    onNavigate: (route: {page: "curation"; sessionId: string}) => void
}

export function RawCasesPanel({t, revision, onChanged, initialRawCaseId, onNavigate}: RawCasesPanelProps) {
    const [entries, setEntries] = useState<RawCase[]>([])
    const [catalog, setCatalog] = useState<SkillCatalog>({repositories: [], skills: []})
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [search, setSearch] = useState("")
    const [skillScope, setSkillScope] = useState("all")
    const [adding, setAdding] = useState(false)
    const [editing, setEditing] = useState<RawCase | null>(null)
    const [question, setQuestion] = useState("")
    const [note, setNote] = useState("")
    const [skillId, setSkillId] = useState("")
    const [deleting, setDeleting] = useState<RawCase | null>(null)
    const [inspecting, setInspecting] = useState<RawCase | null>(null)
    const [drafting, setDrafting] = useState<RawCase | null>(null)
    const [draftDatasetId, setDraftDatasetId] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [dispatchedSessionId, setDispatchedSessionId] = useState<string | null>(null)
    const [loadedEvidence, setLoadedEvidence] = useState<EvidenceResponse | null>(null)
    const [evidenceLoading, setEvidenceLoading] = useState(false)
    const [evidenceError, setEvidenceError] = useState<string | null>(null)
    const [evidenceAttempt, setEvidenceAttempt] = useState(0)
    const activeSessionId = useSyncExternalStore(
        subscribeActiveConversationSession,
        activeConversationSessionSnapshot,
        () => null,
    )
    const evidence = useMemo(
        () => rawCaseEvidence(inspecting?.source, activeSessionId),
        [inspecting?.source, activeSessionId],
    )
    const timeline = useMemo(
        () => evidenceTimeline(loadedEvidence?.episode),
        [loadedEvidence?.episode],
    )
    const skillOptions = useMemo(() => rawCaseSkillOptions(entries, catalog.skills), [entries, catalog.skills])
    const filteredGroups = useMemo(
        () => rawCaseSkillGroups(entries, search, skillScope),
        [entries, search, skillScope],
    )

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<RawCase[]>("rawCases.list", {}, controller.signal),
            requestRollingSkill<SkillCatalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
        ]).then(([rawCases, nextCatalog, datasetItems]) => {
            setEntries(rawCases)
            setCatalog(nextCatalog)
            setDatasets(datasetItems)
            const valid = nextCatalog.skills.filter((skill) => skill.status === "valid")
            setSkillId((current) => valid.some((skill) => skill.id === current) ? current : valid[0]?.id ?? "")
            if (initialRawCaseId) setInspecting(rawCases.find((entry) => entry.id === initialRawCaseId) ?? null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialRawCaseId])

    useEffect(() => {
        setSkillScope((current) => resolveRawCaseSkillScope(current, entries, catalog.skills))
    }, [entries, catalog.skills])

    useEffect(() => {
        const controller = new AbortController()
        setLoadedEvidence(null)
        setEvidenceError(null)
        if (!inspecting || !evidence.observation) {
            setEvidenceLoading(false)
            return () => controller.abort()
        }
        setEvidenceLoading(true)
        requestRollingSkill<EvidenceResponse>(
            "rawCases.evidence",
            {id: inspecting.id},
            controller.signal,
        ).then((value) => {
            if (!controller.signal.aborted) setLoadedEvidence(value)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) {
                setEvidenceError(reason instanceof Error ? reason.message : t("captureEvidenceLoadError"))
            }
        }).finally(() => {
            if (!controller.signal.aborted) setEvidenceLoading(false)
        })
        return () => controller.abort()
    }, [inspecting?.id, evidence.observation, evidenceAttempt])

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
    const compatibleDatasets = (entry: RawCase | null) => datasets.filter((dataset) =>
        Boolean(entry?.skill.id) &&
        dataset.skillReference?.evidencePrecision === "managed" &&
        dataset.skillReference.id === entry?.skill.id &&
        Boolean(dataset.activeRubricVersionId),
    )
    const beginDraft = (entry: RawCase) => {
        const compatible = compatibleDatasets(entry)
        setDrafting(entry)
        setDraftDatasetId(compatible[0]?.id ?? "")
    }
    const createDraft = () => {
        const entry = drafting
        if (!entry || !draftDatasetId) return
        void mutate(async () => {
            const session = await requestRollingSkill<{id: string}>("rawCases.createDraft", {
                id: entry.id,
                datasetId: draftDatasetId,
                idempotencyKey: crypto.randomUUID(),
            })
            setDrafting(null)
            onNavigate({page: "curation", sessionId: session.id})
        })
    }
    const hasCompleteEpisode = (entry: RawCase) => {
        const observation = entry.source?.observations?.at(-1)
        return Boolean(observation && observation.outcome !== "uncertain")
    }
    const dispatchToSession = (entry: RawCase, target: "current" | "new") => void mutate(async () => {
        const result = await requestRollingSkill<{sessionId: string}>("rawCases.dispatch", {
            id: entry.id,
            target,
            ...(target === "current" ? {sessionId: activeSessionId} : {}),
            idempotencyKey: crypto.randomUUID(),
        })
        setDispatchedSessionId(result.sessionId)
    })
    const viewCaptureRange = () => {
        const observation = evidence.observation
        if (
            !evidence.canRevealRange ||
            !observation?.threadId ||
            evidence.startSeq === null ||
            evidence.endSeq === null
        ) return
        window.dispatchEvent(new CustomEvent("rolling-skill:reveal-capture-range", {detail: {
            sessionId: observation.threadId,
            startSeq: evidence.startSeq,
            endSeq: evidence.endSeq,
        }}))
        setInspecting(null)
        window.dispatchEvent(new CustomEvent("rolling-skill:close-workbench"))
    }

    const form = <div className="rolling-skill-form-stack">
        <label><span>{t("question")}</span><textarea value={question} onChange={(event) => setQuestion(event.target.value)}/></label>
        <label><span>{t("datasetSkill")}</span><select className="rolling-skill-select" value={skillId} onChange={(event) => setSkillId(event.target.value)}>
            {catalog.skills.filter((skill) => skill.status === "valid").map((skill) => {
                const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId)
                return <option key={skill.id} value={skill.id}>{skill.name} · {repository?.displayName ?? skill.repositoryId}</option>
            })}
        </select></label>
        <label><span>{t("note")}</span><input value={note} onChange={(event) => setNote(event.target.value)}/></label>
    </div>

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("rawCasesTitle")}</h3><p>{t("rawCasesDescription")}</p></div>
                <Button size="sm" disabled={!catalog.skills.some((skill) => skill.status === "valid")} onClick={beginAdd}>{t("addRawCase")}</Button>
            </div>
            <div className="rolling-skill-raw-filter-toolbar">
                <Input value={search} placeholder={t("searchRawCases")} aria-label={t("searchRawCases")} onChange={(event: {target: {value: string}}) => setSearch(event.target.value)}/>
                <label className="rolling-skill-raw-skill-select">
                    <span>{t("rawCaseSkillFilter")}</span>
                    <select className="rolling-skill-select" aria-label={t("rawCaseSkillFilter")} value={skillScope} onChange={(event) => setSkillScope(event.target.value)}>
                        <option value="all">{t("allSkills")} · {entries.length}</option>
                        {skillOptions.map((option) => <option key={option.key} value={option.key}>{option.name} · {option.count}</option>)}
                    </select>
                </label>
            </div>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            {dispatchedSessionId ? <p className="rolling-skill-inline-success">{t("rawCaseDispatched")} <code>{dispatchedSessionId}</code></p> : null}
            <div className="rolling-skill-group-list">
                {filteredGroups.map((group) => <section className="rolling-skill-raw-group" key={group.key}>
                    <button
                        type="button"
                        className="rolling-skill-raw-group-filter"
                        aria-pressed={skillScope === group.key}
                        onClick={() => setSkillScope((current) => current === group.key ? "all" : group.key)}
                    >
                        <strong>{group.name}</strong><span>{group.items.length}</span>
                    </button>
                    <div className="rolling-skill-list">{group.items.map((entry) => (
                        <article className="rolling-skill-list-row" key={entry.id}>
                            <div><strong className="rolling-skill-verbatim">{entry.question}</strong><span>{entry.source?.kind ?? t("manualSource")}{entry.note ? ` · ${entry.note}` : ""}</span></div>
                            <div className="rolling-skill-actions">
                                <Button size="sm" onClick={() => setInspecting(entry)}>{t("captureEvidence")}</Button>
                                {hasCompleteEpisode(entry) ? <Button size="sm" disabled={compatibleDatasets(entry).length === 0} onClick={() => beginDraft(entry)}>{t("createCaseDraft")}</Button> : <>{activeSessionId ? <Button size="sm" disabled={busy} onClick={() => dispatchToSession(entry, "current")}>{t("validateInCurrentSession")}</Button> : null}<Button size="sm" disabled={busy} onClick={() => dispatchToSession(entry, "new")}>{t("validateInNewSession")}</Button></>}
                                <Button size="sm" onClick={() => beginEdit(entry)}>{t("edit")}</Button>
                                <Button size="sm" onClick={() => setDeleting(entry)}>{t("delete")}</Button>
                            </div>
                        </article>
                    ))}</div>
                </section>)}
                {filteredGroups.length === 0 ? <p>{entries.length ? t("emptyRawCaseFilter") : t("emptyRawCases")}</p> : null}
            </div>
            <Modal open={adding} onClose={() => setAdding(false)} title={t("addRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button onClick={() => setAdding(false)}>{t("cancel")}</Button><Button disabled={busy || !question.trim() || !skillId} onClick={add}>{t("save")}</Button></>}>
                {form}
            </Modal>
            <Modal open={editing !== null} onClose={() => setEditing(null)} title={t("editRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button onClick={() => setEditing(null)}>{t("cancel")}</Button><Button disabled={busy || !question.trim() || !skillId} onClick={save}>{t("save")}</Button></>}>
                {form}
            </Modal>
            <Modal open={inspecting !== null} onClose={() => setInspecting(null)} title={t("rawCaseEvidence")} closeLabel={t("close")} footer={<Button onClick={() => setInspecting(null)}>{t("close")}</Button>}>
                {inspecting ? <div className="rolling-skill-detail-stack rolling-skill-capture-evidence">
                    <p className="rolling-skill-muted">{t("captureEvidenceDescription")}</p>
                    {evidence.observation ? <>
                                <dl className="rolling-skill-evidence-summary">
                                    <div><dt>{t("captureClassification")}</dt><dd>{evidence.observation.caseType === "badcase" ? t("badcase") : evidence.observation.caseType === "goodcase" ? t("goodcase") : t("unknown")}</dd></div>
                            <div><dt>{t("captureOutcome")}</dt><dd>{evidence.observation.outcome === "resolved" ? t("resolved") : evidence.observation.outcome === "unresolved" ? t("unresolved") : t("unknown")}</dd></div>
                            <div><dt>{t("confidence")}</dt><dd>{confidence(evidence.observation.confidence, t("unknown"))}</dd></div>
                            <div><dt>{t("captureInspectedAt")}</dt><dd>{dateTime(evidence.observation.inspectedAt, t("unknown"))}</dd></div>
                        </dl>
                                <section className="rolling-skill-capture-range-card">
                                    <h4>{t("messageRange")}</h4>
                                    <p className="rolling-skill-muted">{t("rangeMeaning")}</p>
                                    {evidenceLoading ? <p className="rolling-skill-muted">{t("captureEvidenceLoading")}</p> : null}
                                    {evidenceError ? <div className="rolling-skill-capture-evidence-error" role="alert"><p>{t("captureEvidenceLoadError")}</p><small>{evidenceError}</small><Button size="sm" onClick={() => setEvidenceAttempt((value) => value + 1)}>{t("retry")}</Button></div> : null}
                                    {!evidenceLoading && !evidenceError && loadedEvidence && timeline.length === 0 ? <p>{t("captureEvidenceEmpty")}</p> : null}
                                    {timeline.length > 0 ? <ol className="rolling-skill-capture-evidence-timeline">
                                        {timeline.map((item, index) => <li key={item.id ?? `${item.type}:${index}`} data-kind={item.kind} data-boundary={item.boundary ?? undefined}>
                                            {item.kind === "tool" ? <details className="rolling-skill-capture-tool">
                                                <summary><strong>{item.label}</strong>{item.status ? <span>{item.status}</span> : null}</summary>
                                                <div className="rolling-skill-capture-tool-details">
                                                    {detailText(item.arguments) ? <div><strong>{t("captureToolArguments")}</strong><pre>{detailText(item.arguments)}</pre></div> : null}
                                                    {detailText(item.result) ? <div><strong>{t("captureToolResult")}</strong><pre>{detailText(item.result)}</pre></div> : null}
                                                    {detailText(item.error) ? <div><strong>{t("captureToolError")}</strong><pre>{detailText(item.error)}</pre></div> : null}
                                                </div>
                                            </details> : item.kind === "context" ? <details className="rolling-skill-capture-context">
                                                <summary>{t("captureContext")}</summary>
                                                <p className="rolling-skill-verbatim">{item.text || t("notAvailable")}</p>
                                            </details> : <article>
                                                <header><strong>{item.kind === "user" ? t("captureUser") : t("captureAssistant")}</strong>{item.boundary ? <span>{item.boundary === "start" ? t("captureStartTag") : t("captureEndTag")}</span> : null}</header>
                                                <p className="rolling-skill-verbatim">{item.text || t("notAvailable")}</p>
                                            </article>}
                                        </li>)}
                                    </ol> : null}
                                    {evidence.canRevealRange ? <Button size="sm" onClick={viewCaptureRange}>{t("viewCaptureRange")}</Button> : null}
                                </section>
                        {evidence.observation.summary ? <div><h4>{t("captureSummary")}</h4><p>{evidence.observation.summary}</p></div> : null}
                        {evidence.observation.reason ? <div><h4>{t("captureReason")}</h4><p>{evidence.observation.reason}</p></div> : null}
                    </> : <p>{t("manualEvidenceDescription")}</p>}
                    <details className="rolling-skill-advanced-evidence">
                        <summary>{t("rawCaseEvidenceAdvanced")}</summary>
                        <pre>{JSON.stringify(inspecting.source ?? {kind: "manual"}, null, 2)}</pre>
                    </details>
                </div> : null}
            </Modal>
            <Modal open={drafting !== null} onClose={() => setDrafting(null)} title={t("createCaseDraft")} closeLabel={t("cancel")} footer={<><Button onClick={() => setDrafting(null)}>{t("cancel")}</Button><Button disabled={busy || !draftDatasetId} onClick={createDraft}>{t("captureCreate")}</Button></>}>
                <p>{t("rawCaseDraftDescription")}</p>
                <select className="rolling-skill-select" value={draftDatasetId} onChange={(event) => setDraftDatasetId(event.target.value)}>{compatibleDatasets(drafting).map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select>
            </Modal>
            <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={t("deleteRawCaseTitle")} closeLabel={t("cancel")} footer={<><Button onClick={() => setDeleting(null)}>{t("cancel")}</Button><Button disabled={busy} onClick={recycle}>{t("confirmDelete")}</Button></>}><p>{t("deleteRawCasePrompt")}</p></Modal>
        </section>
    )
}
