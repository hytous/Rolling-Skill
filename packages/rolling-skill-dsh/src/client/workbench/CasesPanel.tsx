import {Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useRef, useState} from "react"

import {ActionButton as Button} from "./ActionButton"
import {MarkdownContent} from "./MarkdownContent"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"
import type {WorkbenchRoute} from "./Workbench"

interface Dataset {id: string; name: string}
interface CaseEntry {
    id: string
    caseType: "goodcase" | "badcase"
    question: string
    answer: string
    updatedAt: string
    rubricVersionId?: string | null
    rubricCalibration?: {status?: string; calibratedAt?: string | null} | null
}
interface CaseDetail extends CaseEntry {
    createdAt?: string
    issueDescription?: string
    rubric?: unknown
    operationEvidence?: unknown
    episode?: {source?: unknown}
}
interface CasePage {items: CaseEntry[]; total: number; page: number; pageSize: number; pageCount: number}
interface CalibrationSession {id: string; status: string; revision: string; draft?: unknown; error?: {message?: string} | null}
interface CalibrationBatch {status: "running" | "stopped" | "failed" | "completed"; completed: number; total: number; currentSessionId?: string; error?: string}

interface CasesPanelProps {
    t: Translate
    revision: number
    onChanged: () => void
    initialDatasetId?: string
    initialCaseId?: string
    onNavigate: (route: WorkbenchRoute) => void
}

export function CasesPanel({t, revision, onChanged, initialDatasetId, initialCaseId, onNavigate}: CasesPanelProps) {
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [datasetId, setDatasetId] = useState(initialDatasetId ?? "")
    const [entries, setEntries] = useState<CaseEntry[]>([])
    const [caseScope, setCaseScope] = useState<"all" | "goodcase" | "badcase">("all")
    const [page, setPage] = useState(1)
    const [pageResult, setPageResult] = useState<CasePage>({items: [], total: 0, page: 1, pageSize: 20, pageCount: 0})
    const [detail, setDetail] = useState<CaseDetail | null>(null)
    const [deleting, setDeleting] = useState<CaseEntry | null>(null)
    const [recoverQuestions, setRecoverQuestions] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [calibrationBatch, setCalibrationBatch] = useState<CalibrationBatch | null>(null)
    const stopCalibration = useRef(false)

    useEffect(() => () => {
        stopCalibration.current = true
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<Dataset[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<RuntimeDescriptor[]>("runtimes.list", {}, controller.signal),
        ]).then(([value, runtimeItems]) => {
            setDatasets(value)
            setRuntimes(runtimeItems)
            setRuntimeId((current) => current || runtimeItems[0]?.runtimeId || "")
            setDatasetId((current) => current && value.some((entry) => entry.id === current)
                ? current
                : value[0]?.id ?? "")
        }).catch((reason: unknown) => {
            if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
        })
        return () => controller.abort()
    }, [revision])

    useEffect(() => {
        if (!datasetId) {
            setEntries([])
            return
        }
        const controller = new AbortController()
        requestRollingSkill<CasePage>("cases.list", {datasetId, caseScope, page, pageSize: 20}, controller.signal)
            .then((result) => {
                setPageResult(result)
                setEntries(result.items)
                if (result.pageCount > 0 && result.page > result.pageCount) setPage(result.pageCount)
            })
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [datasetId, caseScope, page, revision])

    useEffect(() => {
        if (!initialCaseId || !datasetId) return
        const controller = new AbortController()
        requestRollingSkill<CaseDetail>("cases.get", {datasetId, caseId: initialCaseId}, controller.signal)
            .then(setDetail)
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [datasetId, initialCaseId])

    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true)
        setError(null)
        try {
            await operation()
            onChanged()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const inspect = async (entry: CaseEntry) => {
        setError(null)
        try {
            setDetail(await requestRollingSkill<CaseDetail>("cases.get", {datasetId, caseId: entry.id}))
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }
    const refreshOne = (entry: CaseEntry) => mutate(() => requestRollingSkill("cases.refresh", {
        datasetId, caseId: entry.id, expectedUpdatedAt: entry.updatedAt,
        idempotencyKey: crypto.randomUUID(), runtimeId,
    }))
    const refreshBatch = (scope: "goodcase" | "all") => mutate(() => requestRollingSkill("cases.refreshBatch", {
        datasetId, scope, idempotencyKey: crypto.randomUUID(), runtimeId,
    }))
    const calibrate = (entry: CaseEntry) => mutate(async () => {
        const session = await requestRollingSkill<{id: string}>("curation.createCalibration", {
            datasetId,
            caseId: entry.id,
            idempotencyKey: crypto.randomUUID(),
        })
        onNavigate({page: "curation", sessionId: session.id})
    })
    const waitForCalibrationDraft = async (sessionId: string): Promise<CalibrationSession> => {
        while (!stopCalibration.current) {
            const session = await requestRollingSkill<CalibrationSession>("curation.get", {sessionId})
            if (session.status === "needs_review" && session.draft) return session
            if (["failed", "cancelled", "archived"].includes(session.status)) {
                throw new Error(session.error?.message ?? `Calibration stopped while ${session.status}`)
            }
            await new Promise((resolve) => window.setTimeout(resolve, 1_200))
        }
        throw new Error("CALIBRATION_BATCH_STOPPED")
    }
    const startCalibrationBatch = async () => {
        if (!datasetId || calibrationBatch?.status === "running") return
        stopCalibration.current = false
        setError(null)
        let currentSessionId: string | undefined
        try {
            const all: CaseEntry[] = []
            let nextPage = 1
            while (true) {
                const result = await requestRollingSkill<CasePage>("cases.list", {datasetId, caseScope: "all", page: nextPage, pageSize: 200})
                all.push(...result.items)
                if (nextPage >= result.pageCount) break
                nextPage += 1
            }
            const pending = all.filter((entry) => entry.rubricCalibration?.status !== "current")
            setCalibrationBatch({status: "running", completed: 0, total: pending.length})
            let completed = 0
            for (const entry of pending) {
                if (stopCalibration.current) throw new Error("CALIBRATION_BATCH_STOPPED")
                const session = await requestRollingSkill<CalibrationSession>("curation.createCalibration", {
                    datasetId,
                    caseId: entry.id,
                    idempotencyKey: crypto.randomUUID(),
                })
                currentSessionId = session.id
                setCalibrationBatch({status: "running", completed, total: pending.length, currentSessionId})
                const ready = await waitForCalibrationDraft(session.id)
                await requestRollingSkill("curation.save", {
                    sessionId: ready.id,
                    expectedRevision: ready.revision,
                    idempotencyKey: crypto.randomUUID(),
                })
                completed += 1
                setCalibrationBatch({status: "running", completed, total: pending.length})
                onChanged()
            }
            setCalibrationBatch({status: "completed", completed, total: pending.length})
        } catch (reason) {
            const message = reason instanceof Error ? reason.message : t("loadError")
            setCalibrationBatch((current) => ({
                status: message === "CALIBRATION_BATCH_STOPPED" ? "stopped" : "failed",
                completed: current?.completed ?? 0,
                total: current?.total ?? 0,
                ...(currentSessionId ? {currentSessionId} : {}),
                ...(message === "CALIBRATION_BATCH_STOPPED" ? {} : {error: message}),
            }))
        }
    }
    const remove = () => {
        const entry = deleting
        if (!entry) return
        void mutate(async () => {
            await requestRollingSkill("cases.delete", {
                datasetId, caseId: entry.id, expectedUpdatedAt: entry.updatedAt,
                recoverQuestions, idempotencyKey: crypto.randomUUID(),
            })
            setDeleting(null)
            setDetail((current) => current?.id === entry.id ? null : current)
        })
    }

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("casesTitle")}</h3><p>{t("casesDescription")}</p></div>
                <div className="rolling-skill-actions">
                    <Button size="sm" disabled={!datasetId || busy} onClick={() => void refreshBatch("goodcase")}>{t("refreshGoodCases")}</Button>
                    <Button size="sm" disabled={!datasetId || busy} onClick={() => void refreshBatch("all")}>{t("refreshAllCases")}</Button>
                    {calibrationBatch?.status === "running" ? <Button size="sm" onClick={() => {stopCalibration.current = true}}>{t("stopCalibrationBatch")}</Button> : <Button size="sm" disabled={!datasetId || busy} onClick={() => void startCalibrationBatch()}>{t("calibrateAllCases")}</Button>}
                </div>
            </div>
            <div className="rolling-skill-form-row">
                <select className="rolling-skill-select" aria-label={t("selectDataset")} value={datasetId} onChange={(event) => { setDatasetId(event.target.value); setPage(1) }}>
                    {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
                </select>
                <select className="rolling-skill-select" aria-label={t("caseFilter")} value={caseScope} onChange={(event) => { setCaseScope(event.target.value as typeof caseScope); setPage(1) }}>
                    <option value="all">{t("allCases")}</option>
                    <option value="goodcase">{t("goodcase")}</option>
                    <option value="badcase">{t("badcase")}</option>
                </select>
                <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("refreshRuntime")}/>
            </div>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            {calibrationBatch ? <section className="rolling-skill-subpanel"><p>{t("calibrationBatchProgress").replace("{completed}", String(calibrationBatch.completed)).replace("{total}", String(calibrationBatch.total))} · {calibrationBatch.status}</p>{calibrationBatch.error ? <p className="rolling-skill-inline-error">{calibrationBatch.error}</p> : null}{calibrationBatch.currentSessionId ? <Button size="sm" onClick={() => onNavigate({page: "curation", sessionId: calibrationBatch.currentSessionId!})}>{t("reviewCalibration")}</Button> : null}</section> : null}
            <div className="rolling-skill-list">
                {entries.map((entry) => (
                    <article className="rolling-skill-case-row" key={entry.id}>
                        <div className="rolling-skill-case-copy">
                            <span className="rolling-skill-badge">{entry.caseType === "goodcase" ? t("goodcase") : t("badcase")}</span>
                            {entry.rubricCalibration?.status !== "current" ? <span className="rolling-skill-badge">{t("caseNeedsCalibration")}</span> : null}
                            <div className="rolling-skill-case-question"><MarkdownContent compact>{entry.question}</MarkdownContent></div>
                            <MarkdownContent compact>{entry.answer}</MarkdownContent>
                        </div>
                        <div className="rolling-skill-actions">
                            <Button size="sm" onClick={() => void inspect(entry)}>{t("details")}</Button>
                            <Button size="sm" disabled={busy} onClick={() => void refreshOne(entry)}>{t("refreshCase")}</Button>
                            {entry.rubricCalibration?.status !== "current" ? <Button size="sm" disabled={busy} onClick={() => void calibrate(entry)}>{t("calibrateCase")}</Button> : null}
                            <Button size="sm" disabled={busy} onClick={() => setDeleting(entry)}>{t("delete")}</Button>
                        </div>
                    </article>
                ))}
                {entries.length === 0 ? <p>{t("emptyCases")}</p> : null}
            </div>
            <div className="rolling-skill-pagination" aria-label={t("casePages")}>
                <Button size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>{t("previousPage")}</Button>
                <span>{t("pageStatus").replace("{page}", String(pageResult.page)).replace("{pages}", String(pageResult.pageCount || 1)).replace("{total}", String(pageResult.total))}</span>
                <Button size="sm" disabled={pageResult.pageCount === 0 || page >= pageResult.pageCount} onClick={() => setPage((value) => value + 1)}>{t("nextPage")}</Button>
            </div>
            <Modal open={detail !== null} onClose={() => setDetail(null)} title={t("caseDetailTitle")} closeLabel={t("close")} footer={<Button onClick={() => setDetail(null)}>{t("close")}</Button>}>
                {detail ? <div className="rolling-skill-detail-stack">
                    <span className="rolling-skill-badge">{detail.caseType === "goodcase" ? t("goodcase") : t("badcase")}</span>
                    <h4>{t("question")}</h4><MarkdownContent>{detail.question}</MarkdownContent>
                    <h4>{t("caseAnswer")}</h4><MarkdownContent>{detail.answer}</MarkdownContent>
                    {detail.issueDescription ? <><h4>{t("caseIssue")}</h4><MarkdownContent>{detail.issueDescription}</MarkdownContent></> : null}
                    <h4>{t("caseEvidence")}</h4>
                    <pre>{JSON.stringify({rubric: detail.rubric ?? null, operationEvidence: detail.operationEvidence ?? null, source: detail.episode?.source ?? null}, null, 2)}</pre>
                </div> : null}
            </Modal>
            <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={t("deleteCaseTitle")} closeLabel={t("cancel")} footer={<>
                <Button onClick={() => setDeleting(null)}>{t("cancel")}</Button>
                <Button disabled={busy} onClick={remove}>{t("confirmDelete")}</Button>
            </>}>
                <p>{t("deleteRecoveryPrompt")}</p>
                <label className="rolling-skill-check"><input type="checkbox" checked={recoverQuestions} onChange={(event) => setRecoverQuestions(event.target.checked)}/><span>{t("recoverToRawCases")}</span></label>
            </Modal>
        </section>
    )
}
