import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeInteractions} from "./RuntimeInteractions"
import {displayStatus} from "./display-state"

interface InstallationSource {
    repositoryId?: string | null
    skillId?: string | null
    versionId?: string | null
    commit?: string | null
    expectedDigest?: string | null
}

interface InstallationJob {
    id: string
    parentJobId?: string | null
    status: string
    operation?: string | null
    runtime: {displayName: string; version?: string | null; runtimeId?: string}
    request: {skillName?: string | null; versionLabel?: string | null; source?: InstallationSource | null}
    messages?: Array<{role?: string | null; content?: string | null; recordedAt?: string | null}>
    activities?: Array<{type?: string | null; title?: string | null; summary?: string | null; command?: string | null; name?: string | null; status?: string | null; recordedAt?: string | null}>
    error?: {code?: string | null; message?: string | null} | null
    parsedResult?: {verification?: string | null; trusted?: boolean} | null
    traceAvailable?: boolean
    canFollowUp?: boolean
    conversationStatus?: string
    createdAt?: string | null
    startedAt?: string | null
    updatedAt?: string | null
    completedAt?: string | null
}

interface InstallationRecord {
    runtimeId: string
    providerId?: string | null
    displayName?: string | null
    skillId?: string | null
    versionId?: string | null
    commit?: string | null
    contentDigest?: string | null
    verification?: string | null
    installedAt?: string | null
    trustedJobId?: string | null
    lastJobId?: string | null
    lastJobStatus?: string | null
    lastJobUpdatedAt?: string | null
}

interface InstallationOverview {
    jobs: InstallationJob[]
    matrix: InstallationRecord[]
}

const ACTIVE_STATUSES = new Set([
    "queued", "running", "verifying", "awaiting_permission", "awaiting_confirmation",
])

function shortDigest(value?: string | null): string {
    if (!value) return "—"
    return value.length > 28 ? `${value.slice(0, 20)}…${value.slice(-6)}` : value
}

function dateTime(value?: string | null): string {
    if (!value) return "—"
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : value
}

export function InstallationsPanel({t, skillId, initialJobId, refreshRevision = 0}: {t: Translate; skillId?: string; initialJobId?: string; refreshRevision?: number}) {
    const [overview, setOverview] = useState<InstallationOverview>({jobs: [], matrix: []})
    const [selectedJob, setSelectedJob] = useState<InstallationJob | null>(null)
    const [followUp, setFollowUp] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)
    const visibleJobs = skillId ? overview.jobs.filter((job) => job.request.source?.skillId === skillId) : overview.jobs
    const visibleRecords = skillId ? overview.matrix.filter((record) => record.skillId === skillId) : overview.matrix

    const loadJob = async (jobId: string, signal?: AbortSignal) => {
        try {
            setSelectedJob(await requestRollingSkill<InstallationJob>("installations.get", {jobId}, signal))
            setError(null)
        } catch (reason) {
            if (!signal?.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }

    useEffect(() => {
        if (initialJobId) void loadJob(initialJobId)
    }, [initialJobId])

    useEffect(() => {
        if (!selectedJob) return
        const jobId = selectedJob.id
        const controller = new AbortController()
        requestRollingSkill<InstallationJob>("installations.get", {jobId}, controller.signal)
            .then((job) => {if (!controller.signal.aborted) setSelectedJob((current) => current?.id === jobId ? job : current)})
            .catch((reason: unknown) => {if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))})
        return () => controller.abort()
    }, [selectedJob?.id, revision, refreshRevision])

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<InstallationOverview>("installations.list", skillId ? {skillId} : {}, controller.signal)
            .then((value) => {
                setOverview(value)
                setError(null)
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [revision, skillId, initialJobId, refreshRevision])

    useEffect(() => {
        if (!overview.jobs.some((job) => ACTIVE_STATUSES.has(job.status) || job.conversationStatus === "running")) return
        const timer = window.setInterval(() => setRevision((value) => value + 1), 1_500)
        return () => window.clearInterval(timer)
    }, [overview.jobs])

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

    const sendFollowUp = () => {
        if (!selectedJob || !followUp.trim()) return
        void mutate(async () => {
            setSelectedJob(await requestRollingSkill<InstallationJob>("installations.send", {
                jobId: selectedJob.id,
                text: followUp.trim(),
            }))
            setFollowUp("")
        })
    }

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header">
                    <div><h3>{t("installationAudit")}</h3><p>{t("installationAuditDescription")}</p></div>
                    <Button size="sm" onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
                </div>
                {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                <h4>{t("trustedInstallations")}</h4>
                <div className="rolling-skill-audit-grid">
                    {visibleRecords.map((record) => (
                        <article className="rolling-skill-audit-card" key={`${record.runtimeId}:${record.skillId}:${record.versionId}`}>
                            <header><strong>{record.displayName ?? record.runtimeId}</strong><span className="rolling-skill-badge">{record.verification ?? t("notAvailable")}</span></header>
                            <dl>
                                <div><dt>{t("installationVersion")}</dt><dd>{record.versionId ?? t("notAvailable")}</dd></div>
                                <div><dt>{t("installationCommit")}</dt><dd><code>{record.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div>
                                <div><dt>{t("installationDigest")}</dt><dd title={record.contentDigest ?? undefined}><code>{shortDigest(record.contentDigest)}</code></dd></div>
                                <div><dt>{t("installationJob")}</dt><dd>{record.trustedJobId ?? t("notAvailable")}</dd></div>
                                <div><dt>{t("installedAt")}</dt><dd>{dateTime(record.installedAt)}</dd></div>
                            </dl>
                            {record.trustedJobId ? <Button size="sm" onClick={() => void loadJob(record.trustedJobId!)}>{t("details")}</Button> : null}
                        </article>
                    ))}
                    {visibleRecords.length === 0 ? <p>{t("emptyInstallationAudit")}</p> : null}
                </div>
            </section>

            <section className="rolling-skill-panel">
                <h3>{t("installationJobs")}</h3>
                <div className="rolling-skill-list">
                    {visibleJobs.map((job) => (
                        <article className="rolling-skill-list-row" key={job.id}>
                            <div>
                                <strong>{displayStatus(job.status, t)} · {job.request.skillName ?? t("notAvailable")}</strong>
                                <span>{displayStatus(job.operation ?? "install", t)}</span>
                                <span>{job.runtime.displayName} {job.runtime.version ?? ""} · {job.request.versionLabel ?? job.request.source?.versionId ?? job.id}</span>
                                <small>{dateTime(job.completedAt ?? job.updatedAt ?? job.createdAt)}</small>
                            </div>
                            <div className="rolling-skill-actions">
                                <Button size="sm" onClick={() => void loadJob(job.id)}>{t("details")}</Button>
                                {ACTIVE_STATUSES.has(job.status) ? <Button size="sm" disabled={busy} onClick={() => void mutate(() => requestRollingSkill("installations.cancel", {jobId: job.id}))}>{t("cancelRun")}</Button> : null}
                            </div>
                        </article>
                    ))}
                    {visibleJobs.length === 0 ? <p>{t("emptyInstallationJobs")}</p> : null}
                </div>
            </section>
            {!selectedJob ? <RuntimeInteractions t={t} ownerKind="installation"/> : null}

            <Modal open={selectedJob !== null} onClose={() => setSelectedJob(null)} title={t("installationDetail")} closeLabel={t("close")} footer={<Button onClick={() => setSelectedJob(null)}>{t("close")}</Button>}>
                {selectedJob ? <div className="rolling-skill-detail-stack">
                    <RuntimeInteractions t={t} ownerKind="installation" ownerId={selectedJob.id}/>
                    {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
                    <section className="rolling-skill-evidence-card">
                        <h4>{t("installationSource")}</h4>
                        <dl>
                            <div><dt>{t("status")}</dt><dd>{displayStatus(selectedJob.status, t)}</dd></div>
                            <div><dt>{t("installationOperation")}</dt><dd>{displayStatus(selectedJob.operation, t)}</dd></div>
                            <div><dt>{t("runtime")}</dt><dd>{selectedJob.runtime.displayName} {selectedJob.runtime.version ?? ""}</dd></div>
                            <div><dt>{t("installationVersion")}</dt><dd>{selectedJob.request.versionLabel ?? selectedJob.request.source?.versionId ?? t("notAvailable")}</dd></div>
                            <div><dt>{t("installationCommit")}</dt><dd><code>{selectedJob.request.source?.commit?.slice(0, 12) ?? t("notAvailable")}</code></dd></div>
                            <div><dt>{t("installationDigest")}</dt><dd title={selectedJob.request.source?.expectedDigest ?? undefined}><code>{shortDigest(selectedJob.request.source?.expectedDigest)}</code></dd></div>
                            <div><dt>{t("installationVerification")}</dt><dd>{selectedJob.parsedResult?.verification ?? t("notAvailable")}</dd></div>
                            <div><dt>{t("installedAt")}</dt><dd>{dateTime(selectedJob.completedAt)}</dd></div>
                        </dl>
                    </section>
                    {selectedJob.error ? <p className="rolling-skill-inline-error">{selectedJob.error.code} · {selectedJob.error.message}</p> : null}
                    <h4>{t("installerConversation")}</h4>
                    <div className="rolling-skill-conversation-log">{selectedJob.messages?.map((message, index) => <div key={`${message.recordedAt ?? index}`} data-role={message.role}><strong>{message.role}</strong><p>{message.content}</p></div>)}</div>
                    <h4>{t("installerActivity")}</h4>
                    {ACTIVE_STATUSES.has(selectedJob.status) && !selectedJob.activities?.length
                        ? <p className="rolling-skill-help" role="status">{t("installationWaitingForActivity")}</p>
                        : null}
                    <div className="rolling-skill-list">{selectedJob.activities?.map((activity, index) => <details className="rolling-skill-subpanel" key={`${activity.recordedAt ?? index}`}>
                        <summary>{activity.type === "commandExecution" ? t("installationCommandActivity") : activity.title ?? activity.name ?? activity.type} · {displayStatus(activity.status, t)} · {dateTime(activity.recordedAt)}</summary>
                        {activity.command ? <pre>{activity.command}</pre> : null}
                        {activity.summary ? <p>{activity.summary}</p> : null}
                    </details>)}</div>
                    {selectedJob.canFollowUp ? <div className="rolling-skill-form-row"><Input value={followUp} placeholder={t("installerFollowUp")} onChange={(event: {target: {value: string}}) => setFollowUp(event.target.value)}/><Button disabled={busy || ACTIVE_STATUSES.has(selectedJob.status) || selectedJob.conversationStatus === "running" || !followUp.trim()} onClick={sendFollowUp}>{t("sendRevision")}</Button></div> : null}
                </div> : null}
            </Modal>
        </div>
    )
}
