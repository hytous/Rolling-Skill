import {Button, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {RuntimeSelect} from "./RuntimeSelect"
import type {RuntimeDescriptor} from "./RuntimeSelect"

interface Dataset {id: string; name: string}
interface CaseEntry {
    id: string
    caseType: "goodcase" | "badcase"
    question: string
    answer: string
    updatedAt: string
}
interface CasePage {items: CaseEntry[]; total: number}

export function CasesPanel({t, revision, onChanged}: {t: Translate; revision: number; onChanged: () => void}) {
    const [datasets, setDatasets] = useState<Dataset[]>([])
    const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([])
    const [runtimeId, setRuntimeId] = useState("")
    const [datasetId, setDatasetId] = useState("")
    const [entries, setEntries] = useState<CaseEntry[]>([])
    const [deleting, setDeleting] = useState<CaseEntry | null>(null)
    const [recoverQuestions, setRecoverQuestions] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

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
            })
            .catch((reason: unknown) => {
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
        requestRollingSkill<CasePage>("cases.list", {datasetId, pageSize: 200}, controller.signal)
            .then((page) => setEntries(page.items))
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [datasetId, revision])

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
    const refreshOne = (entry: CaseEntry) => mutate(() => requestRollingSkill("cases.refresh", {
        datasetId,
        caseId: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        idempotencyKey: crypto.randomUUID(),
        runtimeId,
    }))
    const refreshBatch = (scope: "goodcase" | "all") => mutate(() => requestRollingSkill("cases.refreshBatch", {
        datasetId,
        scope,
        idempotencyKey: crypto.randomUUID(),
        runtimeId,
    }))
    const remove = () => {
        const entry = deleting
        if (!entry) return
        void mutate(async () => {
            await requestRollingSkill("cases.delete", {
                datasetId,
                caseId: entry.id,
                expectedUpdatedAt: entry.updatedAt,
                recoverQuestions,
                idempotencyKey: crypto.randomUUID(),
            })
            setDeleting(null)
        })
    }

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("casesTitle")}</h3><p>{t("casesDescription")}</p></div>
                <div className="rolling-skill-actions">
                    <Button variant="outline" size="sm" disabled={!datasetId || busy} onClick={() => void refreshBatch("goodcase")}>{t("refreshGoodCases")}</Button>
                    <Button variant="outline" size="sm" disabled={!datasetId || busy} onClick={() => void refreshBatch("all")}>{t("refreshAllCases")}</Button>
                </div>
            </div>
            <select className="rolling-skill-select" aria-label={t("selectDataset")} value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>
                {datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}
            </select>
            <RuntimeSelect t={t} runtimes={runtimes} value={runtimeId} onChange={setRuntimeId} label={t("refreshRuntime")}/>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-list">
                {entries.map((entry) => (
                    <article className="rolling-skill-case-row" key={entry.id}>
                        <div className="rolling-skill-case-copy">
                            <span className="rolling-skill-badge">{entry.caseType === "goodcase" ? t("goodcase") : t("badcase")}</span>
                            <strong>{entry.question}</strong>
                            <p>{entry.answer}</p>
                        </div>
                        <div className="rolling-skill-actions">
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refreshOne(entry)}>{t("refreshCase")}</Button>
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleting(entry)}>{t("delete")}</Button>
                        </div>
                    </article>
                ))}
                {entries.length === 0 ? <p>{t("emptyCases")}</p> : null}
            </div>
            <Modal
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t("deleteCaseTitle")}
                closeLabel={t("cancel")}
                footer={<>
                    <Button variant="outline" onClick={() => setDeleting(null)}>{t("cancel")}</Button>
                    <Button variant="outline" disabled={busy} onClick={remove}>{t("confirmDelete")}</Button>
                </>}
            >
                <p>{t("deleteRecoveryPrompt")}</p>
                <label className="rolling-skill-check">
                    <input type="checkbox" checked={recoverQuestions} onChange={(event) => setRecoverQuestions(event.target.checked)}/>
                    <span>{t("recoverToRawCases")}</span>
                </label>
            </Modal>
        </section>
    )
}
