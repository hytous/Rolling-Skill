import {Button, Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface DatasetSummary {
    id: string
    name: string
    caseCount: number
    goodcaseCount: number
    badcaseCount: number
    createdAt: string
}

interface CsvExport {
    filename: string
    content: string
}

export function DatasetsPanel({t, onChanged}: {t: Translate; onChanged: () => void}) {
    const [datasets, setDatasets] = useState<DatasetSummary[]>([])
    const [name, setName] = useState("")
    const [deleting, setDeleting] = useState<DatasetSummary | null>(null)
    const [recoverQuestions, setRecoverQuestions] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<DatasetSummary[]>("datasets.list", {}, controller.signal)
            .then(setDatasets)
            .catch((reason: unknown) => {
                if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("loadError"))
            })
        return () => controller.abort()
    }, [revision])

    const reload = () => setRevision((value) => value + 1)
    const mutate = async (operation: () => Promise<unknown>) => {
        setBusy(true)
        setError(null)
        try {
            await operation()
            reload()
            onChanged()
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }
    const create = () => mutate(async () => {
        await requestRollingSkill("datasets.create", {name})
        setName("")
    })
    const remove = () => {
        const dataset = deleting
        if (!dataset) return
        void mutate(async () => {
            await requestRollingSkill("datasets.delete", {
                datasetId: dataset.id,
                expectedCreatedAt: dataset.createdAt,
                recoverQuestions,
                idempotencyKey: crypto.randomUUID(),
            })
            setDeleting(null)
        })
    }
    const exportCsv = async (datasetId: string) => {
        setError(null)
        try {
            const exported = await requestRollingSkill<CsvExport>("datasets.exportCsv", {datasetId})
            const url = URL.createObjectURL(new Blob([exported.content], {type: "text/csv;charset=utf-8"}))
            const anchor = document.createElement("a")
            anchor.href = url
            anchor.download = exported.filename
            anchor.click()
            URL.revokeObjectURL(url)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        }
    }

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("datasetsTitle")}</h3><p>{t("datasetsDescription")}</p></div>
                <Button variant="ghost" size="sm" onClick={reload}>{t("refresh")}</Button>
            </div>
            <div className="rolling-skill-form-row">
                <Input
                    value={name}
                    placeholder={t("datasetName")}
                    aria-label={t("datasetName")}
                    onChange={(event: {target: {value: string}}) => setName(event.target.value)}
                />
                <Button variant="outline" size="sm" disabled={busy || !name.trim()} onClick={create}>
                    {t("createDataset")}
                </Button>
            </div>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-list">
                {datasets.map((dataset) => (
                    <article className="rolling-skill-list-row" key={dataset.id}>
                        <div>
                            <strong>{dataset.name}</strong>
                            <span>{t("caseBreakdown")
                                .replace("{all}", String(dataset.caseCount))
                                .replace("{good}", String(dataset.goodcaseCount))
                                .replace("{bad}", String(dataset.badcaseCount))}</span>
                        </div>
                        <div className="rolling-skill-actions">
                            <Button variant="ghost" size="sm" onClick={() => void exportCsv(dataset.id)}>{t("exportCsv")}</Button>
                            <Button variant="ghost" size="sm" onClick={() => setDeleting(dataset)}>{t("delete")}</Button>
                        </div>
                    </article>
                ))}
                {datasets.length === 0 ? <p>{t("emptyDatasets")}</p> : null}
            </div>
            <Modal
                open={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t("deleteDatasetTitle")}
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
