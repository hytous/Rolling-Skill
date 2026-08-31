import {Input} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {InstallationsPanel} from "./InstallationsPanel"
import type {RuntimeDescriptor} from "./RuntimeSelect"

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
    const [candidateMessage, setCandidateMessage] = useState("Update Skill workflow")
    const [releaseLabel, setReleaseLabel] = useState("")
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
            const selectedSkillId = detail?.skill.id ?? initialSkillId
            const requestedSkill = nextCatalog.skills.find((skill) => skill.id === selectedSkillId) ?? nextCatalog.skills[0]
            if (requestedSkill) void loadSkill(requestedSkill.id, controller.signal)
            else setDetail(null)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialSkillId, initialJobId])

    const loadSkill = async (skillId: string, signal?: AbortSignal) => {
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
    const candidate = detail?.versions.find((version) => version.state === "candidate") ?? null
    const releasedVersions = useMemo(() => detail?.versions.filter((version) => version.state === "released" && !version.deprecatedAt) ?? [], [detail])
    const released = releasedVersions[0] ?? null
    const createCandidate = () => mutate(async () => {
        if (!detail) return
        const expectedBase = await requestRollingSkill<{commit: string | null; contentDigest: string; dirty: boolean}>("skills.candidateBase", {skillId: detail.skill.id})
        await requestRollingSkill("skills.createCandidate", {skillId: detail.skill.id, message: candidateMessage, expectedBase})
    })
    const release = () => mutate(() => requestRollingSkill("skills.release", {
        versionId: candidate?.id,
        versionLabel: releaseLabel,
        expectedCandidate: candidate ? {
            commit: candidate.commit,
            contentDigest: candidate.contentDigest,
            state: candidate.state,
            versionLabel: releaseLabel,
        } : null,
    }))
    const install = () => mutate(() => requestRollingSkill("installations.start", {
        skillId: detail?.skill.id,
        versionId: released?.id,
        targets: runtimeIds.map((selectedRuntimeId) => ({runtimeId: selectedRuntimeId, modelId: null, effort: null, permissionMode: null})),
    }))
    const deprecate = (version: Version) => mutate(() => requestRollingSkill("skills.deprecate", {versionId: version.id}))
    const revealRepository = (repositoryId: string) => mutate(() => requestRollingSkill("skills.reveal", {repositoryId}))
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
                    return <article className="rolling-skill-list-row rolling-skill-managed-skill-row" key={skill.id}><button type="button" className="rolling-skill-skill-row" aria-current={detail?.skill.id === skill.id ? "true" : undefined} onClick={() => onOpenVersions?.(skill.id)}><strong>{skill.name}</strong><span>{repositoryLabel}{skill.description || skill.status}</span></button><Button size="sm" disabled={busy} onClick={() => void revealRepository(skill.repositoryId)}>{t("revealRepository")}</Button></article>
                })}{catalog.skills.length === 0 ? <p>{t("emptySkills")}</p> : null}</div>
            </section> : null}

            {mode === "versions" ? detail ? <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{detail.skill.name}</h3><p>{detail.skill.description || detail.skill.status}</p></div></div>
                <pre className="rolling-skill-manifest">{detail.manifest}</pre>
                <div className="rolling-skill-list">
                    {detail.versions.map((version) => <article className="rolling-skill-version-card" key={version.id}><header><div><strong>{version.versionLabel ?? t("candidateVersion")}</strong><span className="rolling-skill-badge">{version.state}</span></div>{version.state === "released" && !version.deprecatedAt ? <Button size="sm" disabled={busy} onClick={() => void deprecate(version)}>{t("deprecateVersion")}</Button> : version.deprecatedAt ? <span>{t("deprecatedVersion")}</span> : null}</header><dl><div><dt>{t("installationCommit")}</dt><dd><code>{version.commit.slice(0, 12)}</code></dd></div><div><dt>{t("installationDigest")}</dt><dd title={version.contentDigest}><code>{version.contentDigest}</code></dd></div><div><dt>{t("createdAt")}</dt><dd>{version.releasedAt ?? version.createdAt ?? t("notAvailable")}</dd></div></dl></article>)}
                </div>
                <div className="rolling-skill-grid">
                    <div className="rolling-skill-subpanel"><h4>{t("candidateVersion")}</h4><Input value={candidateMessage} onChange={(event: {target: {value: string}}) => setCandidateMessage(event.target.value)}/><Button size="sm" disabled={busy} onClick={() => void createCandidate()}>{t("createCandidate")}</Button></div>
                    <div className="rolling-skill-subpanel"><h4>{t("releaseVersion")}</h4><Input value={releaseLabel} placeholder="1.0.0" onChange={(event: {target: {value: string}}) => setReleaseLabel(event.target.value)}/><Button size="sm" disabled={busy || !candidate || !releaseLabel.trim()} onClick={() => void release()}>{t("release")}</Button></div>
                </div>
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
