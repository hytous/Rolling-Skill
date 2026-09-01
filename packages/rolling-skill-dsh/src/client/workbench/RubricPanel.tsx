import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {WorkbenchRoute} from "./Workbench"
import {RubricSessionView} from "./RubricSessionView"

interface Dataset {id: string; name: string; activeRubricVersionId: string | null}
interface RubricSessionSummary {id: string; status: string; updatedAt: string; baseVersionId: string | null}
interface RollingSettings {rollingSkill: {rubricProfile: {modelId: string | null; effort: string | null}}}
interface RubricCriterion {
    id?: string
    title?: string
    criterion?: string
    weight?: number
    evidenceRequirements?: string[]
    scoringAnchors?: Record<string, string>
    criticalFailure?: boolean
}
interface RubricAutomaticFailure {id?: string; condition?: string; rationale?: string}
interface RubricVersion {
    id: string
    version: number
    rubricDigest?: string | null
    rubric: {
        title?: string
        summary?: string
        scoringModel?: string
        criteria?: RubricCriterion[]
        automaticFailures?: RubricAutomaticFailure[]
    }
    operationEvidence?: {
        skillName?: string | null
        versionLabel?: string | null
        commit?: string | null
        contentDigest?: string | null
        runtime?: {displayName?: string | null; version?: string | null} | null
        installation?: {jobId?: string | null; verification?: string | null; installedAt?: string | null} | null
    } | null
    createdAt: string
}

export function RubricPanel({
    t,
    initialDatasetId,
    initialSessionId,
    onNavigate,
}: {
    t: Translate
    initialDatasetId?: string
    initialSessionId?: string
    onNavigate: (route: WorkbenchRoute) => void
}) {
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [datasetId, setDatasetId] = useState(initialDatasetId ?? "")
    const [selectedSessionId, setSelectedSessionId] = useState(initialSessionId ?? "")
    const [selectedVersionId, setSelectedVersionId] = useState("")
    const [sessions, setSessions] = useState<RubricSessionSummary[]>([])
    const [versions, setVersions] = useState<RubricVersion[]>([])
    const [active, setActive] = useState<RubricVersion | null>(null)
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<RollingSettings>("settings.get", {}, controller.signal),
        ])
            .then(([rows, settings]) => {
                setDatasets(rows)
                setDatasetId((current) => current || rows[0]?.id || "")
                setModelId((current) => current || settings.rollingSkill.rubricProfile.modelId || "")
                setEffort((current) => current || settings.rollingSkill.rubricProfile.effort || "")
            }).catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [])

    useEffect(() => {
        if (!datasetId) return
        const controller = new AbortController()
        requestRollingSkill<{sessions: RubricSessionSummary[]; versions: RubricVersion[]; active: RubricVersion | null}>(
            "rubrics.list",
            {datasetId},
            controller.signal,
        ).then((result) => {
            setSessions(result.sessions)
            setVersions(result.versions)
            setActive(result.active)
            setSelectedSessionId((current) => current || result.sessions[0]?.id || "")
            setSelectedVersionId((current) => result.versions.some((version) => version.id === current) ? current : result.active?.id ?? result.versions[0]?.id ?? "")
            setError(null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [datasetId, revision])

    const create = async () => {
        if (!datasetId || busy) return
        setBusy(true)
        setCreating(true)
        setError(null)
        try {
            const session = await requestRollingSkill<RubricSessionSummary>("rubrics.create", {
                datasetId,
                modelId: modelId || null,
                effort: effort || null,
                idempotencyKey: `rubric-create:${datasetId}:${globalThis.crypto.randomUUID()}`,
            })
            setSelectedSessionId(session.id)
            onNavigate({page: "rubrics", datasetId, sessionId: session.id})
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setCreating(false)
            setBusy(false)
        }
    }
    const migrateLegacy = async () => {
        if (!datasetId || busy) return
        setBusy(true)
        setError(null)
        try {
            await requestRollingSkill("rubrics.migrateLegacy", {
                datasetId,
                idempotencyKey: crypto.randomUUID(),
            })
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }

    const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? active

    return (
        <div className="rolling-skill-review-layout">
            <aside className="rolling-skill-panel rolling-skill-review-list">
                <div className="rolling-skill-panel-header"><div><h3>{t("rubrics")}</h3><p>{t("rubricDescription")}</p></div></div>
                <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setSelectedSessionId(""); setSelectedVersionId("") }}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
                <div className="rolling-skill-form-stack rolling-skill-create-rubric">
                    <label className="rolling-skill-field"><span>{t("model")}</span><input value={modelId} placeholder={t("configuredDefault")} onChange={(event) => setModelId(event.target.value)}/></label>
                    <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={effort} onChange={(event) => setEffort(event.target.value)}><option value="">{t("configuredDefault")}</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option><option value="max">max</option></select></label>
                    <Button tone="primary" disabled={!datasetId || busy} aria-busy={creating} onClick={create}>{creating ? t("creatingRubric") : t("createRubric")}</Button>
                    {creating ? <p className="rolling-skill-operation-status" role="status" aria-live="polite">{t("creatingRubricStatus")}</p> : null}
                </div>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <h4>{t("rubricSessions")}</h4>
                <div className="rolling-skill-list">
                    {sessions.map((session) => <button type="button" className="rolling-skill-review-list-button" data-selected={selectedSessionId === session.id} key={session.id} onClick={() => { setSelectedSessionId(session.id); onNavigate({page: "rubrics", datasetId, sessionId: session.id}) }}><strong>{session.status}</strong><span>{session.updatedAt}</span></button>)}
                </div>
                <h4>{t("rubricHistory")}</h4>
                {!active ? <p>{t("noActiveRubric")}</p> : null}
                {active && active.rubric.scoringModel !== "unified-100/v1" ? <section className="rolling-skill-subpanel"><p>{t("legacyRubricNotice")}</p><Button size="sm" disabled={busy} onClick={() => void migrateLegacy()}>{t("migrateLegacyRubric")}</Button></section> : null}
                <div className="rolling-skill-list">{versions.map((version) => <RubricVersionListButton key={version.id} version={version} active={version.id === active?.id} selected={!selectedSessionId && selectedVersion?.id === version.id} t={t} onSelect={() => { setSelectedSessionId(""); setSelectedVersionId(version.id); onNavigate({page: "rubrics", datasetId}) }}/>)}</div>
            </aside>
            <main className="rolling-skill-review-detail">
                {selectedSessionId ? <RubricSessionView sessionId={selectedSessionId} t={t} onChanged={() => setRevision((value) => value + 1)}/> : selectedVersion ? <RubricVersionCard version={selectedVersion} active={selectedVersion.id === active?.id} t={t}/> : <div className="rolling-skill-state">{t("selectRubricSession")}</div>}
            </main>
        </div>
    )
}

function RubricVersionListButton({version, active, selected, t, onSelect}: {version: RubricVersion; active: boolean; selected: boolean; t: Translate; onSelect: () => void}) {
    return <button type="button" className="rolling-skill-review-list-button" data-selected={selected} onClick={onSelect}><strong>v{version.version} · {version.rubric.title ?? t("notAvailable")}</strong><span>{new Date(version.createdAt).toLocaleString()}{active ? ` · ${t("activeRubric")}` : ""}</span></button>
}

function RubricVersionCard({version, active, t}: {version: RubricVersion; active: boolean; t: Translate}) {
    const evidence = version.operationEvidence
    return (
        <details className="rolling-skill-rubric-version" open>
            <summary>
                <span><strong>v{version.version} · {version.rubric.title ?? t("notAvailable")}</strong><small>{new Date(version.createdAt).toLocaleString()}</small></span>
                {active ? <span className="rolling-skill-badge">{t("activeRubric")}</span> : null}
            </summary>
            <div className="rolling-skill-rubric-version-body">
                <p>{version.rubric.summary}</p>
                <dl>
                    <div><dt>{t("scoringModel")}</dt><dd>{version.rubric.scoringModel ?? t("notAvailable")}</dd></div>
                    <div><dt>{t("rubricDigest")}</dt><dd title={version.rubricDigest ?? undefined}><code>{version.rubricDigest ?? t("notAvailable")}</code></dd></div>
                    {evidence ? <>
                        <div><dt>{t("skillRepositories")}</dt><dd>{evidence.skillName ?? t("notAvailable")} · {evidence.versionLabel ?? t("notAvailable")}</dd></div>
                        <div><dt>{t("installationCommit")}</dt><dd><code>{evidence.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div>
                        <div><dt>{t("installationRuntime")}</dt><dd>{evidence.runtime?.displayName ?? t("notAvailable")} {evidence.runtime?.version ?? ""}</dd></div>
                        <div><dt>{t("installationJob")}</dt><dd>{evidence.installation?.jobId ?? t("notAvailable")} · {evidence.installation?.verification ?? t("notAvailable")}</dd></div>
                    </> : null}
                </dl>
                <h4>{t("rubricCriteria")}</h4>
                <div className="rolling-skill-rubric-criteria">
                    {version.rubric.criteria?.map((criterion) => (
                        <article key={criterion.id}>
                            <header><strong>{criterion.id} · {criterion.title}</strong><span>{t("weight")} {criterion.weight}</span></header>
                            <p>{criterion.criterion}</p>
                            {criterion.evidenceRequirements?.length ? <p><b>{t("rubricEvidenceRequirements")}: </b>{criterion.evidenceRequirements.join(" · ")}</p> : null}
                            {criterion.scoringAnchors ? <details><summary>{t("scoringAnchors")}</summary><dl>{Object.entries(criterion.scoringAnchors).map(([score, anchor]) => <div key={score}><dt>{score}</dt><dd>{anchor}</dd></div>)}</dl></details> : null}
                            {criterion.criticalFailure ? <span className="rolling-skill-inline-error">{t("criticalFailure")}</span> : null}
                        </article>
                    ))}
                </div>
                {version.rubric.automaticFailures?.length ? <section><h4>{t("automaticFailures")}</h4><div className="rolling-skill-rubric-criteria">{version.rubric.automaticFailures.map((failure) => <article key={failure.id}><strong>{failure.id} · {failure.condition}</strong><p>{failure.rationale}</p></article>)}</div></section> : null}
            </div>
        </details>
    )
}
