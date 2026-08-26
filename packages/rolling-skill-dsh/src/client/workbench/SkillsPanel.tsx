import {Button, Input} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
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
}
interface Catalog {repositories: Repository[]; skills: SkillEntry[]}
interface SkillDetail {skill: SkillEntry; manifest: string; versions: Version[]}
interface InstallationOverview {jobs: Array<{id: string; status: string; runtime: {displayName: string; version?: string}; request: {skillName?: string}}>}

export function SkillsPanel({t}: {t: Translate}) {
    const [catalog, setCatalog] = useState<Catalog>({repositories: [], skills: []})
    const [detail, setDetail] = useState<SkillDetail | null>(null)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [sourceKind, setSourceKind] = useState("folder")
    const [sourceLocation, setSourceLocation] = useState("")
    const [candidateMessage, setCandidateMessage] = useState("Update Skill workflow")
    const [releaseLabel, setReleaseLabel] = useState("")
    const [installations, setInstallations] = useState<InstallationOverview>({jobs: []})
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<Catalog>("skills.catalog", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("installations.targets", {}, controller.signal),
            requestRollingSkill<InstallationOverview>("installations.list", {}, controller.signal),
        ]).then(([nextCatalog, runtimeItems, jobs]) => {
            setCatalog(nextCatalog)
            setRuntimes(runtimeItems)
            setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setInstallations(jobs)
            if (!detail && nextCatalog.skills[0]) void loadSkill(nextCatalog.skills[0].id, controller.signal)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    const loadSkill = async (skillId: string, signal?: AbortSignal) => {
        const next = await requestRollingSkill<SkillDetail>("skills.get", {skillId}, signal)
        setDetail(next)
        setInstallations(await requestRollingSkill<InstallationOverview>("installations.list", {skillId}, signal))
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
    const released = useMemo(() => detail?.versions.find((version) => version.state === "released" && !version.versionLabel?.startsWith("deprecated")) ?? null, [detail])
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
        targets: [{runtimeId, modelId: null, effort: "high", permissionMode: null}],
    }))

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("skillRepositories")}</h3><p>{t("skillRepositoriesDescription")}</p></div><Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("skills.rescan", {}))}>{t("rescan")}</Button></div>
                <div className="rolling-skill-form-row">
                    <select className="rolling-skill-select" value={sourceKind} onChange={(event) => setSourceKind(event.target.value)}><option value="folder">folder</option><option value="local-git">local-git</option><option value="git-url">git-url</option><option value="zip">zip</option></select>
                    <Input value={sourceLocation} placeholder={t("skillSourceLocation")} onChange={(event: {target: {value: string}}) => setSourceLocation(event.target.value)}/>
                    <Button variant="outline" size="sm" disabled={busy || !sourceLocation.trim()} onClick={() => void mutate(() => requestRollingSkill("skills.import", {kind: sourceKind, location: sourceLocation}))}>{t("importSkill")}</Button>
                </div>
                <div className="rolling-skill-list">{catalog.skills.map((skill) => <button type="button" className="rolling-skill-skill-row" key={skill.id} onClick={() => void loadSkill(skill.id)}><strong>{skill.name}</strong><span>{skill.description || skill.status}</span></button>)}{catalog.skills.length === 0 ? <p>{t("emptySkills")}</p> : null}</div>
            </section>
            {detail ? <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{detail.skill.name}</h3><p>{detail.skill.description || detail.skill.status}</p></div></div>
                <pre className="rolling-skill-manifest">{detail.manifest}</pre>
                <div className="rolling-skill-grid">
                    <div className="rolling-skill-subpanel"><h4>{t("candidateVersion")}</h4><Input value={candidateMessage} onChange={(event: {target: {value: string}}) => setCandidateMessage(event.target.value)}/><Button variant="outline" size="sm" disabled={busy} onClick={() => void createCandidate()}>{t("createCandidate")}</Button></div>
                    <div className="rolling-skill-subpanel"><h4>{t("releaseVersion")}</h4><Input value={releaseLabel} placeholder="1.0.0" onChange={(event: {target: {value: string}}) => setReleaseLabel(event.target.value)}/><Button variant="outline" size="sm" disabled={busy || !candidate || !releaseLabel.trim()} onClick={() => void release()}>{t("release")}</Button></div>
                </div>
                <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("installationRuntime")}/>
                <Button variant="outline" disabled={busy || !released || !runtimeId} onClick={() => void install()}>{t("installReleased")}</Button>
            </section> : null}
            <section className="rolling-skill-panel"><h3>{t("installationJobs")}</h3>{error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}<div className="rolling-skill-list">{installations.jobs.map((job) => <article className="rolling-skill-list-row" key={job.id}><div><strong>{job.status}</strong><span>{job.runtime.displayName} {job.runtime.version || ""} · {job.id}</span></div><div className="rolling-skill-actions"><Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("installations.inspect", {jobId: job.id}))}>{t("inspect")}</Button>{["queued", "running", "awaiting_permission", "awaiting_confirmation"].includes(job.status) ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("installations.cancel", {jobId: job.id}))}>{t("cancelRun")}</Button> : null}</div></article>)}</div></section>
        </div>
    )
}
