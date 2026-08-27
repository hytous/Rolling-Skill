import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import type {WorkbenchRoute} from "./Workbench"
import {CurationSessionView} from "./CurationSessionView"

interface CurationSummary {
    id: string
    status: string
    caseType: string
    datasetId: string
    updatedAt: string
    episode?: {originalQuestion?: string} | null
}

interface CurationPanelProps {
    t: Translate
    initialSessionId?: string
    onNavigate: (route: WorkbenchRoute) => void
}

export function CurationPanel({t, initialSessionId, onNavigate}: CurationPanelProps) {
    const [selectedId, setSelectedId] = useState(initialSessionId ?? "")
    const [revision, setRevision] = useState(0)
    const [showArchived, setShowArchived] = useState(false)
    const [state, setState] = useState<
        {status: "loading"} |
        {status: "error"; message: string} |
        {status: "ready"; active: CurationSummary[]; archived: CurationSummary[]}
    >({status: "loading"})

    useEffect(() => {
        if (initialSessionId) setSelectedId(initialSessionId)
    }, [initialSessionId])

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<{items: CurationSummary[]}>("curation.list", {}, controller.signal),
            requestRollingSkill<{items: CurationSummary[]}>("curation.list", {archived: true}, controller.signal),
        ]).then(([active, archived]) => {
            setState({status: "ready", active: active.items, archived: archived.items})
            setSelectedId((current) => current || active.items[0]?.id || archived.items[0]?.id || "")
        }).catch((error: unknown) => {
            if (!controller.signal.aborted) {
                setState({status: "error", message: error instanceof Error ? error.message : t("loadError")})
            }
        })
        return () => controller.abort()
    }, [revision])

    if (state.status === "loading") return <div className="rolling-skill-state" role="status">{t("loading")}</div>
    if (state.status === "error") return (
        <div className="rolling-skill-state rolling-skill-error" role="alert">
            <span>{state.message}</span>
            <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("retry")}</Button>
        </div>
    )
    const items = showArchived ? state.archived : state.active
    return (
        <div className="rolling-skill-review-layout">
            <aside className="rolling-skill-panel rolling-skill-review-list">
                <div className="rolling-skill-panel-header">
                    <div>
                        <h3>{t("curation")}</h3>
                        <p>{t("curationDescription")}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
                </div>
                <div className="rolling-skill-actions">
                    <Button size="sm" variant={!showArchived ? "outline" : "ghost"} onClick={() => setShowArchived(false)}>{t("activeDrafts")}</Button>
                    <Button size="sm" variant={showArchived ? "outline" : "ghost"} onClick={() => setShowArchived(true)}>{t("archivedDrafts")}</Button>
                </div>
                <div className="rolling-skill-list">
                    {items.length === 0 ? <p>{t("emptyDrafts")}</p> : items.map((session) => (
                        <button
                            type="button"
                            className="rolling-skill-review-list-button"
                            data-selected={selectedId === session.id}
                            key={session.id}
                            onClick={() => {
                                setSelectedId(session.id)
                                onNavigate({page: "curation", sessionId: session.id})
                            }}
                        >
                            <strong>{session.episode?.originalQuestion || session.id}</strong>
                            <span>{session.caseType} · {session.status}</span>
                        </button>
                    ))}
                </div>
            </aside>
            <main className="rolling-skill-review-detail">
                {selectedId ? (
                    <CurationSessionView
                        sessionId={selectedId}
                        t={t}
                        onChanged={() => setRevision((value) => value + 1)}
                        onNavigate={onNavigate}
                    />
                ) : <div className="rolling-skill-state">{t("selectDraft")}</div>}
            </main>
        </div>
    )
}
