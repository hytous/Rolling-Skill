import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState, useSyncExternalStore} from "react"

import {requestRollingSkill} from "../api"
import type {Translate, TranslationKey} from "../locale"
import {CasesPanel} from "./CasesPanel"
import {DatasetsPanel} from "./DatasetsPanel"
import {EvaluationsPanel} from "./EvaluationsPanel"
import {RawCasesPanel} from "./RawCasesPanel"
import {SkillsPanel} from "./SkillsPanel"

interface DashboardSnapshot {
    counts: {
        datasets: number
        cases: number
        rawCases: number
        evaluations: number
        managedSkills: number
    }
    dataRoot: string
    automaticCapture: {
        lastSuccessAt: string | null
        lastError: {message: string; at: string} | null
    }
    settings: {
        plugin: {
            runtime: {
                displayName?: string
                version?: string
                executablePath: string
                runtimeId: string
            } | null
        }
    }
}

interface LocaleService {
    getSnapshot(): {revision: number}
    subscribe(listener: () => void): () => void
}

interface WorkbenchProps {
    locale: LocaleService
    t: Translate
}

type TabId = "overview" | "cases" | "skills" | "evaluations" | "automatic" | "operator" | "settings"

const TABS: Array<{id: TabId; label: TranslationKey}> = [
    {id: "overview", label: "overview"},
    {id: "cases", label: "cases"},
    {id: "skills", label: "skills"},
    {id: "evaluations", label: "evaluations"},
    {id: "automatic", label: "automatic"},
    {id: "operator", label: "operator"},
    {id: "settings", label: "settings"},
]

function dateTime(value: string | null, fallback: string): string {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function Workbench({locale, t}: WorkbenchProps) {
    useSyncExternalStore(
        (listener) => locale.subscribe(listener),
        () => locale.getSnapshot().revision,
        () => 0,
    )
    const [activeTab, setActiveTab] = useState<TabId>("overview")
    const [reloadRevision, setReloadRevision] = useState(0)
    const [dataRevision, setDataRevision] = useState(0)
    const [state, setState] = useState<
        {status: "loading"} |
        {status: "error"; message: string} |
        {status: "ready"; dashboard: DashboardSnapshot}
    >({status: "loading"})

    useEffect(() => {
        const controller = new AbortController()
        setState({status: "loading"})
        requestRollingSkill<DashboardSnapshot>("dashboard.get", {}, controller.signal)
            .then((dashboard) => setState({status: "ready", dashboard}))
            .catch((error: unknown) => {
                if (controller.signal.aborted) return
                setState({
                    status: "error",
                    message: error instanceof Error ? error.message : t("loadError"),
                })
            })
        return () => controller.abort()
    }, [reloadRevision])

    const reload = () => setReloadRevision((revision) => revision + 1)

    return (
        <section className="rolling-skill-workbench" aria-labelledby="rolling-skill-title">
            <header className="rolling-skill-header">
                <div>
                    <h2 id="rolling-skill-title">{t("title")}</h2>
                    <p>{t("subtitle")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={reload} disabled={state.status === "loading"}>
                    {t("refresh")}
                </Button>
            </header>

            <nav className="rolling-skill-tabs" aria-label={t("title")}>
                {TABS.map((tab) => (
                    <Button
                        key={tab.id}
                        variant={activeTab === tab.id ? "outline" : "ghost"}
                        size="sm"
                        aria-pressed={activeTab === tab.id}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {t(tab.label)}
                    </Button>
                ))}
            </nav>

            {state.status === "loading" ? (
                <div className="rolling-skill-state" role="status">{t("loading")}</div>
            ) : state.status === "error" ? (
                <div className="rolling-skill-state rolling-skill-error" role="alert">
                    <strong>{t("loadError")}</strong>
                    <span>{state.message}</span>
                    <Button variant="outline" size="sm" onClick={reload}>{t("retry")}</Button>
                </div>
            ) : activeTab === "cases" ? (
                <div className="rolling-skill-data-stack">
                    <DatasetsPanel t={t} onChanged={() => setDataRevision((value) => value + 1)}/>
                    <CasesPanel t={t} revision={dataRevision} onChanged={() => setDataRevision((value) => value + 1)}/>
                    <RawCasesPanel t={t} revision={dataRevision} onChanged={() => setDataRevision((value) => value + 1)}/>
                </div>
            ) : activeTab === "evaluations" ? (
                <EvaluationsPanel t={t}/>
            ) : activeTab === "skills" ? (
                <SkillsPanel t={t}/>
            ) : activeTab !== "overview" ? (
                <div className="rolling-skill-panel">
                    <h3>{t(TABS.find((tab) => tab.id === activeTab)?.label ?? "overview")}</h3>
                    <p>{t("comingSoon")}</p>
                </div>
            ) : (
                <Overview dashboard={state.dashboard} t={t}/>
            )}
        </section>
    )
}

function Overview({dashboard, t}: {dashboard: DashboardSnapshot; t: Translate}) {
    const counts: Array<{key: keyof DashboardSnapshot["counts"]; label: TranslationKey}> = [
        {key: "datasets", label: "datasetsCount"},
        {key: "cases", label: "casesCount"},
        {key: "rawCases", label: "rawCasesCount"},
        {key: "evaluations", label: "evaluationsCount"},
        {key: "managedSkills", label: "managedSkillsCount"},
    ]
    const runtime = dashboard.settings.plugin.runtime
    return (
        <div className="rolling-skill-overview">
            <div className="rolling-skill-counts">
                {counts.map((count) => (
                    <div className="rolling-skill-count" key={count.key}>
                        <strong>{dashboard.counts[count.key]}</strong>
                        <span>{t(count.label)}</span>
                    </div>
                ))}
            </div>

            <div className="rolling-skill-grid">
                <section className="rolling-skill-panel">
                    <h3>{t("automaticStatus")}</h3>
                    <dl>
                        <div><dt>{t("nextRun")}</dt><dd>{t("notAvailable")}</dd></div>
                        <div>
                            <dt>{t("lastSuccess")}</dt>
                            <dd>{dateTime(dashboard.automaticCapture.lastSuccessAt, t("notAvailable"))}</dd>
                        </div>
                        <div>
                            <dt>{t("lastError")}</dt>
                            <dd>{dashboard.automaticCapture.lastError?.message ?? t("noError")}</dd>
                        </div>
                    </dl>
                </section>

                <section className="rolling-skill-panel">
                    <h3>{t("runtime")}</h3>
                    {runtime ? (
                        <div className="rolling-skill-runtime">
                            <strong>{[runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ")}</strong>
                            <code>{runtime.executablePath}</code>
                        </div>
                    ) : <p>{t("noRuntime")}</p>}
                </section>
            </div>

            <section className="rolling-skill-panel rolling-skill-path">
                <h3>{t("dataDirectory")}</h3>
                <code>{dashboard.dataRoot}</code>
            </section>
        </div>
    )
}
