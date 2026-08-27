import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState, useSyncExternalStore} from "react"

import {requestRollingSkill} from "../api"
import type {Translate, TranslationKey} from "../locale"
import {AutomaticCapturePanel} from "./AutomaticCapturePanel"
import {CasesPanel} from "./CasesPanel"
import {DatasetsPanel} from "./DatasetsPanel"
import {EvaluationsPanel} from "./EvaluationsPanel"
import {ImportPanel} from "./ImportPanel"
import {OperatorPanel} from "./OperatorPanel"
import {OptimizationPanel} from "./OptimizationPanel"
import {RawCasesPanel} from "./RawCasesPanel"
import {SkillsPanel} from "./SkillsPanel"
import {CurationPanel} from "./CurationPanel"
import {RubricPanel} from "./RubricPanel"

interface DashboardSnapshot {
    counts: {
        datasets: number
        cases: number
        rawCases: number
        evaluations: number
        managedSkills: number
        operatorSessions: number
        optimizations: number
    }
    dataRoot: string
    automaticCapture: {
        nextRunAt: string | null
        lastSuccessAt: string | null
        error: string | null
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
    initialRoute?: WorkbenchRoute
    onRouteChange?: (route: WorkbenchRoute) => void
}

export type WorkbenchRoute =
    | {page: "overview"}
    | {page: "curation"; sessionId?: string}
    | {page: "datasets"; datasetId?: string}
    | {page: "cases"; datasetId?: string; caseId?: string}
    | {page: "raw-cases"; rawCaseId?: string}
    | {page: "rubrics"; datasetId?: string; sessionId?: string}
    | {page: "skills"; repositoryId?: string; skillId?: string}
    | {page: "installations"; jobId?: string}
    | {page: "evaluations"; runId?: string}
    | {page: "automatic"}
    | {page: "operator"; sessionId?: string}
    | {page: "optimization"; runId?: string}
    | {page: "import"}
    | {page: "diagnostics"}

const TABS: Array<{id: WorkbenchRoute["page"]; label: TranslationKey}> = [
    {id: "overview", label: "overview"},
    {id: "curation", label: "curation"},
    {id: "datasets", label: "datasets"},
    {id: "cases", label: "cases"},
    {id: "raw-cases", label: "rawCases"},
    {id: "rubrics", label: "rubrics"},
    {id: "skills", label: "skills"},
    {id: "installations", label: "installations"},
    {id: "evaluations", label: "evaluations"},
    {id: "automatic", label: "automatic"},
    {id: "operator", label: "operator"},
    {id: "optimization", label: "optimizationTitle"},
    {id: "import", label: "legacyImportTitle"},
    {id: "diagnostics", label: "diagnostics"},
]

function dateTime(value: string | null, fallback: string): string {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function Workbench({locale, t, initialRoute = {page: "overview"}, onRouteChange}: WorkbenchProps) {
    useSyncExternalStore(
        (listener) => locale.subscribe(listener),
        () => locale.getSnapshot().revision,
        () => 0,
    )
    const [route, setRoute] = useState<WorkbenchRoute>(initialRoute)
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
    const navigate = (next: WorkbenchRoute) => {
        setRoute(next)
        onRouteChange?.(next)
    }

    useEffect(() => {
        setRoute(initialRoute)
    }, [JSON.stringify(initialRoute)])

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
                        variant={route.page === tab.id ? "outline" : "ghost"}
                        size="sm"
                        aria-pressed={route.page === tab.id}
                        onClick={() => navigate({page: tab.id} as WorkbenchRoute)}
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
            ) : route.page === "curation" ? (
                <CurationPanel t={t} initialSessionId={route.sessionId} onNavigate={navigate}/>
            ) : route.page === "datasets" ? (
                <DatasetsPanel t={t} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "cases" ? (
                <CasesPanel t={t} revision={dataRevision} initialDatasetId={route.datasetId} initialCaseId={route.caseId} onNavigate={navigate} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "raw-cases" ? (
                <RawCasesPanel t={t} revision={dataRevision} initialRawCaseId={route.rawCaseId} onNavigate={navigate} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "rubrics" ? (
                <RubricPanel
                    t={t}
                    initialDatasetId={route.datasetId}
                    initialSessionId={route.sessionId}
                    onNavigate={navigate}
                />
            ) : route.page === "evaluations" ? (
                <EvaluationsPanel t={t} initialRunId={route.runId}/>
            ) : route.page === "skills" || route.page === "installations" ? (
                <SkillsPanel t={t} initialSkillId={route.page === "skills" ? route.skillId : undefined} initialJobId={route.page === "installations" ? route.jobId : undefined}/>
            ) : route.page === "automatic" ? (
                <AutomaticCapturePanel t={t}/>
            ) : route.page === "operator" ? (
                <OperatorPanel t={t} initialSessionId={route.sessionId}/>
            ) : route.page === "optimization" ? (
                <OptimizationPanel t={t} initialRunId={route.runId}/>
            ) : route.page === "import" ? (
                <ImportPanel t={t}/>
            ) : route.page === "diagnostics" ? (
                <Overview dashboard={state.dashboard} t={t}/>
            ) : route.page !== "overview" ? (
                <div className="rolling-skill-panel">
                    <h3>{t(TABS.find((tab) => tab.id === route.page)?.label ?? "overview")}</h3>
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
        {key: "operatorSessions", label: "operatorSessionsCount"},
        {key: "optimizations", label: "optimizationsCount"},
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
                        <div>
                            <dt>{t("nextRun")}</dt>
                            <dd>{dateTime(dashboard.automaticCapture.nextRunAt, t("notAvailable"))}</dd>
                        </div>
                        <div>
                            <dt>{t("lastSuccess")}</dt>
                            <dd>{dateTime(dashboard.automaticCapture.lastSuccessAt, t("notAvailable"))}</dd>
                        </div>
                        <div>
                            <dt>{t("lastError")}</dt>
                            <dd>{dashboard.automaticCapture.error ?? t("noError")}</dd>
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
