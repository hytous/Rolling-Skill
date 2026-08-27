import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {WorkbenchRoute} from "./Workbench"
import {RubricSessionView} from "./RubricSessionView"

interface Dataset {id: string; name: string; activeRubricVersionId: string | null}
interface RubricSessionSummary {id: string; status: string; updatedAt: string; baseVersionId: string | null}
interface RubricVersion {id: string; version: number; rubric: {title?: string}; createdAt: string}

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
    const [sessions, setSessions] = useState<RubricSessionSummary[]>([])
    const [versions, setVersions] = useState<RubricVersion[]>([])
    const [active, setActive] = useState<RubricVersion | null>(null)
    const [modelId, setModelId] = useState("")
    const [effort, setEffort] = useState("")
    const [revision, setRevision] = useState(0)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal)
            .then((rows) => {
                setDatasets(rows)
                setDatasetId((current) => current || rows[0]?.id || "")
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
            setError(null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [datasetId, revision])

    const create = async () => {
        if (!datasetId || busy) return
        setBusy(true)
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
            setBusy(false)
        }
    }

    return (
        <div className="rolling-skill-review-layout">
            <aside className="rolling-skill-panel rolling-skill-review-list">
                <div className="rolling-skill-panel-header"><div><h3>{t("rubrics")}</h3><p>{t("rubricDescription")}</p></div></div>
                <label className="rolling-skill-field"><span>{t("selectDataset")}</span><select className="rolling-skill-select" value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setSelectedSessionId("") }}>{datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
                <div className="rolling-skill-form-stack rolling-skill-create-rubric">
                    <label className="rolling-skill-field"><span>{t("model")}</span><input value={modelId} onChange={(event) => setModelId(event.target.value)}/></label>
                    <label className="rolling-skill-field"><span>{t("effort")}</span><select className="rolling-skill-select" value={effort} onChange={(event) => setEffort(event.target.value)}><option value="">—</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>
                    <Button disabled={!datasetId || busy} onClick={create}>{t("createRubric")}</Button>
                </div>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <h4>{t("rubricSessions")}</h4>
                <div className="rolling-skill-list">
                    {sessions.map((session) => <button type="button" className="rolling-skill-review-list-button" data-selected={selectedSessionId === session.id} key={session.id} onClick={() => { setSelectedSessionId(session.id); onNavigate({page: "rubrics", datasetId, sessionId: session.id}) }}><strong>{session.status}</strong><span>{session.updatedAt}</span></button>)}
                </div>
                <h4>{t("rubricHistory")}</h4>
                {active ? <p className="rolling-skill-badge">{t("activeRubric")} · v{active.version}</p> : <p>{t("noActiveRubric")}</p>}
                <div className="rolling-skill-list">{versions.map((version) => <div className="rolling-skill-list-row" key={version.id}><div><strong>v{version.version} · {version.rubric.title}</strong><span>{version.createdAt}</span></div></div>)}</div>
            </aside>
            <main className="rolling-skill-review-detail">
                {selectedSessionId ? <RubricSessionView sessionId={selectedSessionId} t={t} onChanged={() => setRevision((value) => value + 1)}/> : <div className="rolling-skill-state">{t("selectRubricSession")}</div>}
            </main>
        </div>
    )
}
