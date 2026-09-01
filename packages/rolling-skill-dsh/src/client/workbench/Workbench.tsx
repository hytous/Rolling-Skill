import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState, useSyncExternalStore} from "react"

import {
    getRollingSkillConnectionSnapshot,
    requestRollingSkill,
    subscribeRollingSkillConnection,
} from "../api"
import type {Translate, TranslationKey} from "../locale"
import {ActionButton} from "./ActionButton"
import {AutomaticCapturePanel} from "./AutomaticCapturePanel"
import {CasesPanel} from "./CasesPanel"
import {DatasetsPanel} from "./DatasetsPanel"
import {EvaluationsPanel} from "./EvaluationsPanel"
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
    | {page: "skill-import"; skillId?: string}
    | {page: "skill-versions"; skillId?: string}
    | {page: "skill-install"; skillId?: string; jobId?: string}
    | {page: "evaluations"; runId?: string}
    | {page: "automatic"}
    | {page: "operator"; sessionId?: string}
    | {page: "optimization"; runId?: string}

interface NavigationPage {
    id: WorkbenchRoute["page"]
    label: TranslationKey
}

interface NavigationGroup {
    id: "overview" | "case-management" | "skill-installation" | "evaluation-optimization"
    label: TranslationKey
    defaultPage: WorkbenchRoute["page"]
    pages: NavigationPage[]
}

const NAVIGATION_GROUPS: NavigationGroup[] = [
    {
        id: "overview",
        label: "overview",
        defaultPage: "overview",
        pages: [{id: "overview", label: "overview"}],
    },
    {
        id: "case-management",
        label: "caseManagement",
        defaultPage: "automatic",
        pages: [
            {id: "automatic", label: "automatic"},
            {id: "raw-cases", label: "rawCases"},
            {id: "curation", label: "curation"},
            {id: "cases", label: "cases"},
            {id: "datasets", label: "datasets"},
        ],
    },
    {
        id: "skill-installation",
        label: "skillAndInstallation",
        defaultPage: "skill-import",
        pages: [
            {id: "skill-import", label: "skillImportTab"},
            {id: "skill-versions", label: "skillVersionsTab"},
            {id: "skill-install", label: "skillInstallTab"},
        ],
    },
    {
        id: "evaluation-optimization",
        label: "evaluationAndOptimization",
        defaultPage: "rubrics",
        pages: [
            {id: "rubrics", label: "rubrics"},
            {id: "evaluations", label: "evaluations"},
            {id: "operator", label: "operator"},
            {id: "optimization", label: "optimizationTitle"},
        ],
    },
]

const VISIBLE_PAGES = new Set(NAVIGATION_GROUPS.flatMap((group) => group.pages.map((page) => page.id)))

export function normalizeWorkbenchRoute(route: unknown): WorkbenchRoute {
    if (!route || typeof route !== "object") return {page: "overview"}
    const candidate = route as {page?: unknown; skillId?: unknown; jobId?: unknown}
    if (candidate.page === "skills") {
        return typeof candidate.skillId === "string"
            ? {page: "skill-versions", skillId: candidate.skillId}
            : {page: "skill-import"}
    }
    if (candidate.page === "installations") {
        return typeof candidate.jobId === "string"
            ? {page: "skill-install", jobId: candidate.jobId}
            : {page: "skill-install"}
    }
    if (typeof candidate.page !== "string" || !VISIBLE_PAGES.has(candidate.page as WorkbenchRoute["page"])) {
        return {page: "overview"}
    }
    return route as WorkbenchRoute
}

function navigationRoute(page: WorkbenchRoute["page"], current: WorkbenchRoute): WorkbenchRoute {
    const skillId = "skillId" in current ? current.skillId : undefined
    if (page === "skill-import") return {page, skillId}
    if (page === "skill-versions") return {page, skillId}
    if (page === "skill-install") return {page, skillId}
    return {page} as WorkbenchRoute
}

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
    const connection = useSyncExternalStore(
        subscribeRollingSkillConnection,
        getRollingSkillConnectionSnapshot,
        getRollingSkillConnectionSnapshot,
    )
    const [route, setRoute] = useState<WorkbenchRoute>(() => normalizeWorkbenchRoute(initialRoute))
    const [reloadRevision, setReloadRevision] = useState(0)
    const [dataRevision, setDataRevision] = useState(0)
    const [state, setState] = useState<
        {status: "loading"} |
        {status: "error"; message: string} |
        {status: "ready"; dashboard: DashboardSnapshot}
    >({status: "loading"})

    useEffect(() => {
        const controller = new AbortController()
        setState((current) => current.status === "ready" ? current : {status: "loading"})
        requestRollingSkill<DashboardSnapshot>("dashboard.get", {}, controller.signal)
            .then((dashboard) => setState({status: "ready", dashboard}))
            .catch((error: unknown) => {
                if (controller.signal.aborted) return
                setState((current) => current.status === "ready" ? current : {
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
        const next = normalizeWorkbenchRoute(initialRoute)
        setRoute(next)
        if (next.page !== (initialRoute as {page?: string}).page) onRouteChange?.(next)
    }, [JSON.stringify(initialRoute)])

    const activeGroup = NAVIGATION_GROUPS.find((group) =>
        group.pages.some((page) => page.id === route.page),
    ) ?? NAVIGATION_GROUPS[0]

    return (
        <section className="rolling-skill-workbench" aria-labelledby="rolling-skill-title">
            <header className="rolling-skill-header">
                <div>
                    <h2 id="rolling-skill-title">{t("title")}</h2>
                    <p>{t("subtitle")}</p>
                </div>
                <ActionButton size="sm" onClick={reload} disabled={state.status === "loading"}>
                    {t("refresh")}
                </ActionButton>
            </header>

            {connection.status === "disconnected" ? (
                <div className="rolling-skill-connection-banner" role="alert">
                    <div>
                        <strong>{t("connectionUnavailable")}</strong>
                        <span>{t("connectionUnavailableDescription")}</span>
                    </div>
                    <ActionButton size="sm" onClick={reload}>{t("reconnect")}</ActionButton>
                </div>
            ) : null}

            <nav className="rolling-skill-tabs rolling-skill-primary-tabs" aria-label={t("workbenchSections")}>
                {NAVIGATION_GROUPS.map((group) => (
                    <Button
                        key={group.id}
                        variant={activeGroup.id === group.id ? "outline" : "ghost"}
                        size="sm"
                        aria-pressed={activeGroup.id === group.id}
                        onClick={() => navigate({page: group.defaultPage} as WorkbenchRoute)}
                    >
                        {t(group.label)}
                    </Button>
                ))}
            </nav>
            {activeGroup.id !== "overview" ? (
                <nav className="rolling-skill-tabs rolling-skill-secondary-tabs" aria-label={t("workbenchPages")}>
                    {activeGroup.pages.map((page) => (
                        <Button
                            key={page.id}
                            variant={route.page === page.id ? "outline" : "ghost"}
                            size="sm"
                            aria-pressed={route.page === page.id}
                            onClick={() => navigate(navigationRoute(page.id, route))}
                        >
                            {t(page.label)}
                        </Button>
                    ))}
                </nav>
            ) : null}

            {state.status === "loading" ? (
                <div className="rolling-skill-state" role="status">{t("loading")}</div>
            ) : state.status === "error" ? (
                <div className="rolling-skill-state rolling-skill-error" role="alert">
                    <strong>{t("loadError")}</strong>
                    {connection.status === "connected" ? <span>{state.message}</span> : null}
                    <ActionButton size="sm" onClick={reload}>{t("retry")}</ActionButton>
                </div>
            ) : route.page === "curation" ? (
                <CurationPanel key={`curation:${reloadRevision}`} t={t} initialSessionId={route.sessionId} onNavigate={navigate}/>
            ) : route.page === "datasets" ? (
                <DatasetsPanel key={`datasets:${reloadRevision}`} t={t} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "cases" ? (
                <CasesPanel key={`cases:${reloadRevision}`} t={t} revision={dataRevision} initialDatasetId={route.datasetId} initialCaseId={route.caseId} onNavigate={navigate} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "raw-cases" ? (
                <RawCasesPanel key={`raw-cases:${reloadRevision}`} t={t} revision={dataRevision} initialRawCaseId={route.rawCaseId} onNavigate={navigate} onChanged={() => setDataRevision((value) => value + 1)}/>
            ) : route.page === "rubrics" ? (
                <RubricPanel
                    key={`rubrics:${reloadRevision}`}
                    t={t}
                    initialDatasetId={route.datasetId}
                    initialSessionId={route.sessionId}
                    onNavigate={navigate}
                />
            ) : route.page === "evaluations" ? (
                <EvaluationsPanel key={`evaluations:${reloadRevision}`} t={t} initialRunId={route.runId}/>
            ) : route.page === "skill-import" || route.page === "skill-versions" || route.page === "skill-install" ? (
                <SkillsPanel
                    key={`${route.page}:${reloadRevision}`}
                    t={t}
                    mode={route.page === "skill-import" ? "import" : route.page === "skill-versions" ? "versions" : "install"}
                    initialSkillId={route.skillId}
                    initialJobId={route.page === "skill-install" ? route.jobId : undefined}
                    onSkillChange={(skillId) => navigate({...route, skillId})}
                    onOpenVersions={(skillId) => navigate({page: "skill-versions", skillId})}
                />
            ) : route.page === "automatic" ? (
                <AutomaticCapturePanel key={`automatic:${reloadRevision}`} t={t}/>
            ) : route.page === "operator" ? (
                <OperatorPanel key={`operator:${reloadRevision}`} t={t} initialSessionId={route.sessionId}/>
            ) : route.page === "optimization" ? (
                <OptimizationPanel key={`optimization:${reloadRevision}`} t={t} initialRunId={route.runId}/>
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
