import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useMemo, useRef, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface StartCandidate {
    seq: number
    messageId: string
    text: string
    time: number
}

interface DatasetReadiness {
    datasetId: string
    skillId?: string | null
    name: string
    ready: boolean
    blockers: Array<{code: string; message: string}>
    version: {versionId: string; versionLabel: string} | null
    runtime: {runtimeId: string; displayName?: string; version?: string} | null
}

interface Inspection {
    sessionId: string
    endMessageId: string
    startCandidates: StartCandidate[]
    datasets: DatasetReadiness[]
}

interface CreatedCuration {
    id: string
    datasetId: string
    status: string
    caseId: string | null
    startSeq: number
    endSeq: number
    endMessageId: string
}

interface CaseCaptureDialogProps {
    sessionId: string
    endMessageId: string
    t: Translate
    onClose: () => void
    onCreated: (curation: CreatedCuration) => void
}

type LoadState =
    | {status: "loading"}
    | {status: "error"; message: string}
    | {status: "ready"; inspection: Inspection}

function openDraft(sessionId: string): void {
    window.dispatchEvent(new CustomEvent("rolling-skill:open-workbench", {
        detail: {route: {page: "curation", sessionId}},
    }))
}

export function CaseCaptureDialog({
    sessionId,
    endMessageId,
    t,
    onClose,
    onCreated,
}: CaseCaptureDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null)
    const [loadRevision, setLoadRevision] = useState(0)
    const [loadState, setLoadState] = useState<LoadState>({status: "loading"})
    const [startSeq, setStartSeq] = useState<number | null>(null)
    const [datasetId, setDatasetId] = useState("")
    const [label, setLabel] = useState<"good" | "bad">("good")
    const [note, setNote] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [created, setCreated] = useState<CreatedCuration | null>(null)

    useEffect(() => {
        const controller = new AbortController()
        setLoadState({status: "loading"})
        requestRollingSkill<Inspection>(
            "conversationCuration.inspect",
            {sessionId, endMessageId},
            controller.signal,
        ).then((inspection) => {
            setLoadState({status: "ready", inspection})
            const latest = inspection.startCandidates.at(-1)
            setStartSeq((current) => current ?? latest?.seq ?? null)
            const firstReady = inspection.datasets.find((dataset) => dataset.ready)
            setDatasetId((current) => current || firstReady?.datasetId || inspection.datasets[0]?.datasetId || "")
        }).catch((error: unknown) => {
            if (controller.signal.aborted) return
            setLoadState({
                status: "error",
                message: error instanceof Error ? error.message : t("captureLoadError"),
            })
        })
        return () => controller.abort()
    }, [sessionId, endMessageId, loadRevision])

    useEffect(() => {
        const dialog = dialogRef.current
        const first = dialog?.querySelector<HTMLElement>(
            "button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
        )
        first?.focus()
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
            }
            if (event.key !== "Tab" || !dialog) return
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
                "button:not([disabled]), select:not([disabled]), textarea:not([disabled])",
            ))
            if (focusable.length === 0) return
            const current = focusable.indexOf(document.activeElement as HTMLElement)
            const next = event.shiftKey
                ? (current <= 0 ? focusable.length - 1 : current - 1)
                : (current < 0 || current === focusable.length - 1 ? 0 : current + 1)
            event.preventDefault()
            focusable[next].focus()
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [onClose])

    const inspection = loadState.status === "ready" ? loadState.inspection : null
    const selectedDataset = useMemo(
        () => inspection?.datasets.find((dataset) => dataset.datasetId === datasetId) ?? null,
        [inspection, datasetId],
    )
    const canSubmit = Boolean(
        inspection &&
        startSeq !== null &&
        selectedDataset?.ready &&
        !submitting &&
        !created,
    )

    const create = async () => {
        if (!canSubmit || startSeq === null) return
        setSubmitting(true)
        setSubmitError(null)
        try {
            const curation = await requestRollingSkill<CreatedCuration>(
                "conversationCuration.create",
                {
                    sessionId,
                    endMessageId,
                    startSeq,
                    datasetId,
                    label,
                    note,
                    idempotencyKey: `dsh:${sessionId}:${endMessageId}:${startSeq}:${datasetId}`,
                },
            )
            setCreated(curation)
            onCreated(curation)
            window.dispatchEvent(new CustomEvent("rolling-skill:curation-markers-changed", {
                detail: {sessionId},
            }))
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : t("captureCreateError"))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="rolling-skill-dialog-backdrop" onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose()
        }}>
            <div
                ref={dialogRef}
                className="rolling-skill-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="rolling-skill-capture-title"
            >
                <header className="rolling-skill-dialog-header">
                    <div>
                        <h2 id="rolling-skill-capture-title">{t("captureTitle")}</h2>
                        <p>{t("captureDescription")}</p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={onClose} aria-label={t("close")}>×</Button>
                </header>

                {loadState.status === "loading" ? (
                    <div className="rolling-skill-state" role="status">{t("captureLoading")}</div>
                ) : loadState.status === "error" ? (
                    <div className="rolling-skill-state rolling-skill-error" role="alert">
                        <span>{loadState.message}</span>
                        <Button variant="outline" size="sm" onClick={() => setLoadRevision((value) => value + 1)}>
                            {t("retry")}
                        </Button>
                    </div>
                ) : created ? (
                    <div className="rolling-skill-form-stack" role="status">
                        <strong>{t("captureDraftCreated")}</strong>
                        <p>{t("captureDraftDescription")}</p>
                        <div className="rolling-skill-actions">
                            <Button onClick={() => {onClose(); openDraft(created.id)}}>{t("captureViewDraft")}</Button>
                            <Button variant="outline" onClick={onClose}>{t("close")}</Button>
                        </div>
                    </div>
                ) : (
                    <div className="rolling-skill-form-stack">
                        <label className="rolling-skill-field">
                            <span>{t("captureStart")}</span>
                            <select
                                className="rolling-skill-select"
                                value={startSeq ?? ""}
                                onChange={(event) => setStartSeq(Number(event.target.value))}
                            >
                                {loadState.inspection.startCandidates.map((candidate) => (
                                    <option key={candidate.seq} value={candidate.seq}>
                                        {candidate.text || `${t("question")} #${candidate.seq}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="rolling-skill-field">
                            <span>{t("captureDataset")}</span>
                            <select
                                className="rolling-skill-select"
                                value={datasetId}
                                onChange={(event) => setDatasetId(event.target.value)}
                            >
                                {loadState.inspection.datasets.map((dataset) => (
                                    <option key={dataset.datasetId} value={dataset.datasetId}>
                                        {dataset.name}{dataset.ready ? "" : ` — ${t("captureBlocked")}`}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {selectedDataset && !selectedDataset.ready ? (
                            <div className="rolling-skill-blockers" role="alert">
                                <strong>{t("captureBlocked")}</strong>
                                <ul>
                                    {selectedDataset.blockers.map((blocker) => (
                                        <li key={`${blocker.code}:${blocker.message}`}>{blocker.code === "INSTALLATION_REQUIRED" ? `${t("captureInstallRequired")} ${selectedDataset.runtime?.displayName ?? "Runtime"} ${selectedDataset.runtime?.version ?? ""}` : blocker.code === "PUBLISHED_RUBRIC_REQUIRED" ? t("captureRubricRequired") : blocker.message}</li>
                                    ))}
                                </ul>
                                {selectedDataset.blockers.some((blocker) => ["INSTALLATION_REQUIRED", "PUBLISHED_RUBRIC_REQUIRED"].includes(blocker.code)) ? <Button variant="outline" onClick={() => {
                                    const needsRubric = selectedDataset.blockers.some((blocker) => blocker.code === "PUBLISHED_RUBRIC_REQUIRED")
                                    onClose()
                                    window.dispatchEvent(new CustomEvent("rolling-skill:open-workbench", {detail: {route: needsRubric ? {page: "rubrics", datasetId} : {page: "skill-install", skillId: selectedDataset.skillId}}}))
                                }}>{selectedDataset.blockers.some((blocker) => blocker.code === "PUBLISHED_RUBRIC_REQUIRED") ? t("createRubric") : t("installReleased")}</Button> : null}
                            </div>
                        ) : null}
                        <fieldset className="rolling-skill-label-fieldset">
                            <legend>{t("captureLabel")}</legend>
                            <label><input type="radio" name="rolling-skill-label" checked={label === "good"} onChange={() => setLabel("good")}/>{t("captureGood")}</label>
                            <label><input type="radio" name="rolling-skill-label" checked={label === "bad"} onChange={() => setLabel("bad")}/>{t("captureBad")}</label>
                        </fieldset>
                        <label className="rolling-skill-field">
                            <span>{t("note")}</span>
                            <textarea value={note} maxLength={120000} onChange={(event) => setNote(event.target.value)}/>
                        </label>
                        {submitError ? <p className="rolling-skill-inline-error" role="alert">{submitError}</p> : null}
                        <div className="rolling-skill-actions rolling-skill-dialog-actions">
                            <Button variant="outline" onClick={onClose} disabled={submitting}>{t("cancel")}</Button>
                            <Button onClick={create} disabled={!canSubmit}>
                                {submitting ? t("captureCreating") : t("captureCreate")}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
