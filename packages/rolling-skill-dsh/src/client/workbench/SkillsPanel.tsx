import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeInteractions} from "./RuntimeInteractions"
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
interface InstallationJob {
    id: string
    status: string
    operation?: string
    runtime: {displayName: string; version?: string; runtimeId?: string}
    request: {skillName?: string; versionLabel?: string}
    messages?: Array<{role?: string; content?: string; recordedAt?: string}>
    activities?: Array<{type?: string; title?: string; summary?: string; recordedAt?: string}>
    error?: {code?: string; message?: string} | null
    conversationStatus?: string | null
    conversationError?: {message?: string} | null
    parsedResult?: {verification?: string; trusted?: boolean} | null
    traceAvailable?: boolean
    canFollowUp?: boolean
}
interface InstallationOverview {jobs: InstallationJob[]}
type SkillSourceKind = "folder" | "local-git" | "git-url" | "zip"

export function SkillsPanel({t, initialSkillId, initialJobId}: {t: Translate; initialSkillId?: string; initialJobId?: string}) {
    const [catalog, setCatalog] = useState<Catalog>({repositories: [], skills: []})
    const [detail, setDetail] = useState<SkillDetail | null>(null)
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeIds, setRuntimeIds] = useState<string[]>([])
    const [sourceKind, setSourceKind] = useState<SkillSourceKind>("folder")
    const [sourceLocation, setSourceLocation] = useState("")
    const [candidateMessage, setCandidateMessage] = useState("Update Skill workflow")
    const [releaseLabel, setReleaseLabel] = useState("")
    const [installations, setInstallations] = useState<InstallationOverview>({jobs: []})
    const [selectedJob, setSelectedJob] = useState<InstallationJob | null>(null)
    const [followUp, setFollowUp] = useState("")
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
            setRuntimeIds((current) => current.length ? current : runtimeItems[0]?.runtimeId ? [runtimeItems[0].runtimeId] : [])
            setInstallations(jobs)
            const requestedSkill = nextCatalog.skills.find((skill) => skill.id === initialSkillId) ?? nextCatalog.skills[0]
            if (!detail && requestedSkill) void loadSkill(requestedSkill.id, controller.signal)
            if (initialJobId) void loadJob(initialJobId, controller.signal)
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision, initialSkillId, initialJobId])

    const loadSkill = async (skillId: string, signal?: AbortSignal) => {
        const next = await requestRollingSkill<SkillDetail>("skills.get", {skillId}, signal)
        setDetail(next)
        setInstallations(await requestRollingSkill<InstallationOverview>("installations.list", {skillId}, signal))
    }
    const loadJob = async (jobId: string, signal?: AbortSignal) => {
        setSelectedJob(await requestRollingSkill<InstallationJob>("installations.get", {jobId}, signal))
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
    const sendFollowUp = () => {
        const job = selectedJob
        if (!job || !followUp.trim()) return
        void mutate(async () => {
            setSelectedJob(await requestRollingSkill<InstallationJob>("installations.send", {jobId: job.id, text: followUp.trim()}))
            setFollowUp("")
        })
    }

    useEffect(() => {
        if (!installations.jobs.some((job) => ["queued", "running", "verifying", "awaiting_permission", "awaiting_confirmation"].includes(job.status))) return
        const timer = window.setInterval(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearInterval(timer)
    }, [installations.jobs])

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{t("skillRepositories")}</h3><p>{t("skillRepositoriesDescription")}</p></div><Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("skills.rescan", {}))}>{t("rescan")}</Button></div>
                <div className="rolling-skill-skill-import">
                    <select aria-label={t("skillSourceKind")} className="rolling-skill-select" value={sourceKind} onChange={(event) => {setSourceKind(event.target.value as SkillSourceKind); setSourceLocation("")}}><option value="folder">{t("skillSourceFolder")}</option><option value="local-git">{t("skillSourceLocalGit")}</option><option value="git-url">{t("skillSourceGitUrl")}</option><option value="zip">{t("skillSourceZip")}</option></select>
                    {sourceKind === "git-url" ? <Input value={sourceLocation} placeholder={t("skillGitUrlPlaceholder")} onChange={(event: {target: {value: string}}) => setSourceLocation(event.target.value)}/> : <div className="rolling-skill-skill-source-picker"><div className="rolling-skill-selected-source" title={sourceLocation || t("noSkillSourceSelected")}><span>{t("selectedSkillSource")}</span><code>{sourceLocation || t("noSkillSourceSelected")}</code></div><Button size="sm" disabled={busy} onClick={() => void chooseSource()}>{t(sourceKind === "zip" ? "chooseSkillZip" : "chooseSkillFolder")}</Button></div>}
                    <Button tone="primary" size="sm" disabled={busy || !sourceLocation.trim()} onClick={() => void mutate(() => requestRollingSkill("skills.import", {kind: sourceKind, location: sourceLocation}))}>{t("importSkill")}</Button>
                </div>
                <div className="rolling-skill-list">{catalog.skills.map((skill) => {
                    const repository = catalog.repositories.find((entry) => entry.id === skill.repositoryId)
                    return <article className="rolling-skill-list-row rolling-skill-managed-skill-row" key={skill.id}><button type="button" className="rolling-skill-skill-row" onClick={() => void loadSkill(skill.id)}><strong>{skill.name}</strong><span>{repository?.displayName ?? skill.repositoryId} · {skill.description || skill.status}</span></button><Button size="sm" disabled={busy} onClick={() => void revealRepository(skill.repositoryId)}>{t("revealRepository")}</Button></article>
                })}{catalog.skills.length === 0 ? <p>{t("emptySkills")}</p> : null}</div>
            </section>
            {detail ? <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header"><div><h3>{detail.skill.name}</h3><p>{detail.skill.description || detail.skill.status}</p></div></div>
                <pre className="rolling-skill-manifest">{detail.manifest}</pre>
                <div className="rolling-skill-list">
                    {detail.versions.map((version) => <article className="rolling-skill-version-card" key={version.id}><header><div><strong>{version.versionLabel ?? t("candidateVersion")}</strong><span className="rolling-skill-badge">{version.state}</span></div>{version.state === "released" && !version.deprecatedAt ? <Button size="sm" disabled={busy} onClick={() => void deprecate(version)}>{t("deprecateVersion")}</Button> : version.deprecatedAt ? <span>{t("deprecatedVersion")}</span> : null}</header><dl><div><dt>{t("installationCommit")}</dt><dd><code>{version.commit.slice(0, 12)}</code></dd></div><div><dt>{t("installationDigest")}</dt><dd title={version.contentDigest}><code>{version.contentDigest}</code></dd></div><div><dt>{t("createdAt")}</dt><dd>{version.releasedAt ?? version.createdAt ?? t("notAvailable")}</dd></div></dl></article>)}
                </div>
                <div className="rolling-skill-grid">
                    <div className="rolling-skill-subpanel"><h4>{t("candidateVersion")}</h4><Input value={candidateMessage} onChange={(event: {target: {value: string}}) => setCandidateMessage(event.target.value)}/><Button size="sm" disabled={busy} onClick={() => void createCandidate()}>{t("createCandidate")}</Button></div>
                    <div className="rolling-skill-subpanel"><h4>{t("releaseVersion")}</h4><Input value={releaseLabel} placeholder="1.0.0" onChange={(event: {target: {value: string}}) => setReleaseLabel(event.target.value)}/><Button size="sm" disabled={busy || !candidate || !releaseLabel.trim()} onClick={() => void release()}>{t("release")}</Button></div>
                </div>
                <RuntimeSelectionGrid t={t} runtimes={runtimes} values={runtimeIds} onChange={setRuntimeIds}/>
                <Button disabled={busy || !released || runtimeIds.length === 0} onClick={() => void install()}>{t("installReleased")}</Button>
            </section> : null}
            <section className="rolling-skill-panel"><h3>{t("installationJobs")}</h3>{error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}<div className="rolling-skill-list">{installations.jobs.map((job) => <article className="rolling-skill-list-row" key={job.id}><div><strong>{job.status}</strong><span>{job.runtime.displayName} {job.runtime.version || ""} · {job.request.versionLabel ?? job.id}</span></div><div className="rolling-skill-actions"><Button size="sm" onClick={() => void loadJob(job.id)}>{t("details")}</Button>{["queued", "running", "verifying", "awaiting_permission", "awaiting_confirmation"].includes(job.status) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("installations.cancel", {jobId: job.id}))}>{t("cancelRun")}</Button> : null}</div></article>)}</div></section>
            <RuntimeInteractions t={t} ownerKind="installation"/>
            <Modal open={selectedJob !== null} onClose={() => setSelectedJob(null)} title={t("installationDetail")} closeLabel={t("close")} footer={<Button onClick={() => setSelectedJob(null)}>{t("close")}</Button>}>
                {selectedJob ? <div className="rolling-skill-detail-stack">
                    <p>{selectedJob.status} · {selectedJob.runtime.displayName} {selectedJob.runtime.version ?? ""}</p>
                    {selectedJob.parsedResult ? <p>{t("installationVerification")}: {selectedJob.parsedResult.verification ?? t("notAvailable")}</p> : null}
                    {selectedJob.error ? <p className="rolling-skill-inline-error">{selectedJob.error.code} · {selectedJob.error.message}</p> : null}
                    <h4>{t("installerConversation")}</h4>
                    <div className="rolling-skill-conversation-log">{selectedJob.messages?.map((message, index) => <div key={`${message.recordedAt ?? index}`} data-role={message.role}><strong>{message.role}</strong><p>{message.content}</p></div>)}</div>
                    <h4>{t("installerActivity")}</h4>
                    <div className="rolling-skill-list">{selectedJob.activities?.map((activity, index) => <div className="rolling-skill-list-row" key={`${activity.recordedAt ?? index}`}><div><strong>{activity.title ?? activity.type}</strong><span>{activity.summary}</span></div></div>)}</div>
                    {selectedJob.canFollowUp ? <div className="rolling-skill-form-row"><Input value={followUp} placeholder={t("installerFollowUp")} onChange={(event: {target: {value: string}}) => setFollowUp(event.target.value)}/><Button disabled={busy || !followUp.trim()} onClick={sendFollowUp}>{t("sendRevision")}</Button></div> : null}
                </div> : null}
            </Modal>
        </div>
    )
}

function RuntimeSelectionGrid({t, runtimes, values, onChange}: {t: Translate; runtimes: RuntimeDescriptor[]; values: string[]; onChange: (values: string[]) => void}) {
    return <fieldset className="rolling-skill-runtime-select"><legend>{t("installationRuntime")}</legend><div className="rolling-skill-runtime-list">{runtimes.map((runtime) => <label className="rolling-skill-runtime-option" key={runtime.runtimeId}><input type="checkbox" checked={values.includes(runtime.runtimeId)} onChange={(event) => onChange(event.target.checked ? [...values, runtime.runtimeId] : values.filter((value) => value !== runtime.runtimeId))}/><span><strong>{runtime.displayName} {runtime.version}</strong><code>{runtime.executablePath}</code></span></label>)}{runtimes.length === 0 ? <p>{t("noRuntimes")}</p> : null}</div></fieldset>
}
