import {Input} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {InstallationsPanel} from "./InstallationsPanel"
import type {RuntimeDescriptor} from "./RuntimeSelect"
import {SkillEditModal} from "./SkillEditModal"

interface SkillEntry {id: string; repositoryId: string; name: string; description?: string; status: string}
interface Repository {id: string; displayName: string}
interface Version {
    id: string
    skillId: string
    state: "candidate" | "released"
    versionLabel: string | null
    commit: string
    contentDigest: string
    createdAt?: string | null
    releasedAt?: string | null
    deprecatedAt?: string | null
}
interface Catalog {repositories: Repository[]; skills: SkillEntry[]}
interface SkillDetail {skill: SkillEntry; manifest: string; versions: Version[]}
type SkillSourceKind = "folder" | "local-git" | "git-url" | "zip"

function dateTime(value: string | null | undefined, fallback: string): string {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

interface SkillsPanelProps {
    t: Translate
    mode: "import" | "versions" | "install"
    initialSkillId?: string
    initialJobId?: string
    onSkillChange?: (skillId: string) => void
    onOpenVersions?: (skillId: string) => void
}

export function SkillsPanel({t, mode, initialSkillId, initialJobId, onSkillChange, onOpenVersions}: SkillsPanelProps) {
    const [catalog, setCatalog] = useState<Catalog>({repositories: [], skills: []})
    const [detail, setDetail] = useState<SkillDetail | null>(null)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeIds, setRuntimeIds] = useState<string[]>([])
    const [sourceKind, setSourceKind] = useState<SkillSourceKind>("folder")
    const [sourceLocation, setSourceLocation] = useState("")
    const [managedSkillPath, setManagedSkillPath] = useState("")
    const [hasActiveEdit, setHasActiveEdit] = useState(false)
    const [editOpen, setEditOpen] = useState(false)
    const [pathCopied, setPathCopied] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("installations.targets", {}, controller.signal),
        ]).then(([nextCatalog, runtimeItems]) => {
            setCatalog(nextCatalog)
            setRuntimes(runtimeItems)
            setRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : [])
            const selectedSkillId = initialSkillId ?? detail?.skill.id
            const requestedSkill = nextCatalog.skills.find((skill) => skill.id === selectedSkillId) ?? nextCatalog.skills[0]
            if (requestedSkill) void loadSkill(requestedSkill.id, controller.signal)
            else {
                setDetail(null)
                setManagedSkillPath("")
                setHasActiveEdit(false)
            }
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialSkillId, initialJobId, mode])

    const loadSkill = async (skillId: string, signal?: AbortSignal) => {
        setManagedSkillPath("")
        setHasActiveEdit(false)
        if (mode === "versions") {
            const [next, pathResult, editResult] = await Promise.all([
                requestRollingSkill<SkillDetail>("skills.get", {skillId}, signal),
                requestRollingSkill<{skillId: string; path: string}>("skills.path", {skillId}, signal),
                requestRollingSkill<{sessions: Array<{state: string}>}>("skillEdits.list", {skillId}, signal),
            ])
            setDetail(next)
            setManagedSkillPath(pathResult.path)
            setHasActiveEdit(editResult.sessions.some((session) => ["draft", "running", "idle", "applying", "needs_recovery"].includes(session.state)))
            return
        }
        const next = await requestRollingSkill<SkillDetail>("skills.get", {skillId}, signal)
        setDetail(next)
    }
    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true)
        setError(null)
        try {
            await operation()
            setRevision((value) => value + 1)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const publishedVersions = useMemo(() => detail?.versions.filter((version) => version.state === "released") ?? [], [detail])
    const releasedVersions = useMemo(() => detail?.versions.filter((version) => version.state === "released" && !version.deprecatedAt) ?? [], [detail])
    const released = releasedVersions[0] ?? null
    const install = () => mutate(() => requestRollingSkill("installations.start", {
        skillId: detail?.skill.id,
        versionId: released?.id,
        targets: runtimeIds.map((selectedRuntimeId) => ({runtimeId: selectedRuntimeId, modelId: null, effort: null, permissionMode: null})),
    }))
    const deprecate = (version: Version) => mutate(() => requestRollingSkill("skills.deprecate", {versionId: version.id}))
    const revealManagedSkill = (skillId: string | undefined) => mutate(() => requestRollingSkill("skills.revealSkill", {skillId}))
    const copyManagedSkillPath = async () => {
        if (!managedSkillPath) return
        setError(null)
        try {
            await window.navigator.clipboard.writeText(managedSkillPath)
            setPathCopied(true)
            window.setTimeout(() => setPathCopied(false), 1_500)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }
    const chooseSource = async () => {
        if (sourceKind === "git-url") return
        setBusy(true)
        setError(null)
        try {
            const selected = await requestRollingSkill<{kind: SkillSourceKind; location: string | null}>("skills.chooseSource", {kind: sourceKind})
            if (selected.location) setSourceLocation(selected.location)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    return (
        <div className="rolling-skill-data-stack">
            {mode !== "import" ? <label className="rolling-skill-current-skill"><span>{t("currentManagedSkill")}</span><select aria-label={t("currentManagedSkill")} className="rolling-skill-select" value={detail?.skill.id ?? ""} disabled={busy || catalog.skills.length === 0} onChange={(event) => {onSkillChange?.(event.target.value); void loadSkill(event.target.value)}}>{catalog.skills.length === 0 ? <option value="">{t("emptySkills")}</option> : catalog.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></label> : null}
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}

            {mode === "import" ? <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("skillRepositories")}</h3><p>{t("skillRepositoriesDescription")}</p></div><Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("skills.rescan", {}))}>{t("rescan")}</Button></div>
                <div className="rolling-skill-skill-import">
                    <select aria-label={t("skillSourceKind")} className="rolling-skill-select" value={sourceKind} onChange={(event) => {setSourceKind(event.target.value as SkillSourceKind); setSourceLocation("")}}><option value="folder">{t("skillSourceFolder")}</option><option value="local-git">{t("skillSourceLocalGit")}</option><option value="git-url">{t("skillSourceGitUrl")}</option><option value="zip">{t("skillSourceZip")}</option></select>
                    {sourceKind === "git-url" ? <Input value={sourceLocation} placeholder={t("skillGitUrlPlaceholder")} onChange={(event: {target: {value: string}}) => setSourceLocation(event.target.value)}/> : <div className="rolling-skill-skill-source-picker"><Button size="sm" disabled={busy} onClick={() => void chooseSource()}>{t(sourceKind === "zip" ? "chooseSkillZip" : "chooseSkillFolder")}</Button>{sourceLocation ? <div className="rolling-skill-selected-source" title={sourceLocation}><span>{t("selectedSkillSource")}</span><code>{sourceLocation}</code></div> : null}</div>}
                    <Button tone="primary" size="sm" disabled={busy || !sourceLocation.trim()} onClick={() => void mutate(() => requestRollingSkill("skills.import", {kind: sourceKind, location: sourceLocation}))}>{t("importSkill")}</Button>
                </div>
                <div className="rolling-skill-list">{catalog.skills.map((skill) => {
                    const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId)
                    const repositoryLabel = repository?.displayName && repository.displayName !== skill.name ? `${repository.displayName} · ` : ""
                    return <article className="rolling-skill-list-row rolling-skill-managed-skill-row" key={skill.id}><button type="button" className="rolling-skill-skill-row" aria-current={detail?.skill.id === skill.id ? "true" : undefined} onClick={() => onOpenVersions?.(skill.id)}><strong>{skill.name}</strong><span>{repositoryLabel}{skill.description || skill.status}</span></button><Button size="sm" disabled={busy} onClick={() => void revealManagedSkill(skill.id)}>{t("revealRepository")}</Button></article>
                })}{catalog.skills.length === 0 ? <p>{t("emptySkills")}</p> : null}</div>
            </section> : null}

            {mode === "versions" ? detail ? <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{detail.skill.name}</h3><p>{detail.skill.description || detail.skill.status}</p></div><div className="rolling-skill-actions"><Button size="sm" disabled={busy} onClick={() => setEditOpen(true)}>{t(hasActiveEdit ? "continueSkillEdit" : "editSkillWithAgent")}</Button><Button size="sm" disabled={busy} onClick={() => void revealManagedSkill(detail.skill.id)}>{t("revealRepository")}</Button></div></div>
                <div className="rolling-skill-managed-path"><span>{t("managedSkillPath")}</span><code title={managedSkillPath}>{managedSkillPath}</code><Button size="sm" disabled={!managedSkillPath} onClick={() => void copyManagedSkillPath()}>{t(pathCopied ? "pathCopied" : "copyPath")}</Button></div>
                <details className="rolling-skill-manifest-details"><summary>{t("viewSkillContent")}</summary><pre className="rolling-skill-manifest">{detail.manifest}</pre></details>
                <h4 className="rolling-skill-version-heading">{t("publishedVersions")}</h4>
                <div className="rolling-skill-list">
                    {publishedVersions.map((version) => <article className="rolling-skill-version-card" key={version.id}><header><strong>{version.versionLabel ?? t("notAvailable")}</strong>{!version.deprecatedAt ? <Button size="sm" disabled={busy} onClick={() => void deprecate(version)}>{t("deprecateVersion")}</Button> : <span>{t("deprecatedVersion")}</span>}</header><dl><div><dt>{t("createdAt")}</dt><dd>{dateTime(version.releasedAt ?? version.createdAt, t("notAvailable"))}</dd></div></dl></article>)}
                    {publishedVersions.length === 0 ? <p>{t("emptyPublishedVersions")}</p> : null}
                </div>
                <SkillEditModal t={t} open={editOpen} skillId={detail.skill.id} skillName={detail.skill.name} onClose={() => {setEditOpen(false); setRevision((value) => value + 1)}} onPublished={() => {setHasActiveEdit(false); setRevision((value) => value + 1)}}/>
            </section> : <section className="rolling-skill-panel"><p>{t("emptySkills")}</p></section> : null}

            {mode === "install" ? <>
                {detail ? <section className="rolling-skill-panel">
                    <div className="rolling-skill-panel-header"><div><h3>{t("skillInstallTab")}</h3><p>{detail.skill.name} · {released?.versionLabel ?? t("notAvailable")}</p></div></div>
                    <RuntimeSelectionGrid t={t} runtimes={runtimes} values={runtimeIds} onChange={setRuntimeIds}/>
                    <Button tone="primary" disabled={busy || !released || runtimeIds.length === 0} onClick={() => void install()}>{t("installReleased")}</Button>
                </section> : <section className="rolling-skill-panel"><p>{t("emptySkills")}</p></section>}
                <InstallationsPanel t={t} initialJobId={initialJobId} refreshRevision={revision}/>
            </> : null}
        </div>
    )
}

function RuntimeSelectionGrid({t, runtimes, values, onChange}: {t: Translate; runtimes: RuntimeDescriptor[]; values: string[]; onChange: (values: string[]) => void}) {
    return <fieldset className="rolling-skill-runtime-select"><legend>{t("installationRuntime")}</legend><div className="rolling-skill-runtime-list">{runtimes.map((runtime) => <label className="rolling-skill-runtime-option" key={runtime.runtimeId}><input type="checkbox" checked={values.includes(runtime.runtimeId)} onChange={(event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId))}/><span><strong>{runtime.displayName} {runtime.version}</strong><code>{runtime.executablePath}</code></span></label>)}{runtimes.length === 0 ? <p>{t("noRuntimes")}</p> : null}</div></fieldset>
}
