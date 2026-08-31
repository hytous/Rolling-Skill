import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {ActionButton as Button} from "./ActionButton"
import datasetModel from "./dataset-view-model.cjs"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface DatasetSummary {
    id: string
    name: string
    caseCount: number
    goodcaseCount: number
    badcaseCount: number
    createdAt: string
    skillReference: {
        evidencePrecision?: string
        id?: string
        repositoryId?: string
        name?: string
    } | null
}

interface ManagedSkill {
    id: string
    repositoryId: string
    name: string
    description?: string
    status: string
}

interface Repository {id: string; displayName: string}
interface SkillCatalog {repositories: Repository[]; skills: ManagedSkill[]}

interface CsvExport {
    filename: string
    content: string
}

const managedSkillOptionLabel = datasetModel.managedSkillOptionLabel as (
    skill: ManagedSkill,
    repositories: Repository[],
) => string

export function DatasetsPanel({t, onChanged}: {t: Translate; onChanged: () => void}) {
    const [datasets, setDatasets] = useState<DatasetSummary[]>([])
    const [catalog, setCatalog] = useState<SkillCatalog>({repositories: [], skills: []})
    const [name, setName] = useState("")
    const [skillId, setSkillId] = useState("")
    const [deleting, setDeleting] = useState<DatasetSummary | null>(null)
    const [binding, setBinding] = useState<DatasetSummary | null>(null)
    const [bindingSkillId, setBindingSkillId] = useState("")
    const [exporting, setExporting] = useState<DatasetSummary | null>(null)
    const [exportScope, setExportScope] = useState<"all" | "goodcase">("all")
    const [recoverQuestions, setRecoverQuestions] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        Promise.all([
            requestRollingSkill<DatasetSummary[]>("datasets.list", {}, controller.signal),
            requestRollingSkill<SkillCatalog>("skills.catalog", {}, controller.signal),
        ])
            .then(([datasetItems, nextCatalog]) => {
                setDatasets(datasetItems)
                setCatalog(nextCatalog)
                const validSkills = nextCatalog.skills.filter((skill) => skill.status === "valid")
                setSkillId((current) => validSkills.some((skill) => skill.id === current)
                    ? current
                    : validSkills[0]?.id ?? "")
            })
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
        const selectedSkill = catalog.skills.find((skill) => skill.id === skillId)
        if (!selectedSkill) throw new Error(t("noManagedSkills"))
        await requestRollingSkill("datasets.create", {
            name,
            repositoryId: selectedSkill.repositoryId,
            skillId: selectedSkill.id,
        })
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
    const beginBinding = (dataset: DatasetSummary) => {
        const validSkills = catalog.skills.filter((skill) => skill.status === "valid")
        setBinding(dataset)
        setBindingSkillId(validSkills.some((skill) => skill.id === dataset.skillReference?.id)
            ? dataset.skillReference?.id ?? ""
            : validSkills[0]?.id ?? "")
    }
    const bindSkill = () => {
        const dataset = binding
        const selectedSkill = catalog.skills.find((skill) => skill.id === bindingSkillId)
        if (!dataset || !selectedSkill) return
        void mutate(async () => {
            await requestRollingSkill("datasets.bindSkill", {
                datasetId: dataset.id,
                repositoryId: selectedSkill.repositoryId,
                skillId: selectedSkill.id,
                expectedCreatedAt: dataset.createdAt,
                idempotencyKey: crypto.randomUUID(),
            })
            setBinding(null)
        })
    }
    const beginExport = (dataset: DatasetSummary) => {
        setExporting(dataset)
        setExportScope("all")
    }
    const exportCsv = async () => {
        const datasetId = exporting?.id
        if (!datasetId) return
        setBusy(true)
        setError(null)
        try {
            const exported = await requestRollingSkill<CsvExport>("datasets.exportCsv", {datasetId, caseScope: exportScope})
            const url = URL.createObjectURL(new Blob([exported.content], {type: "text/csv;charset=utf-8"}))
            const anchor = document.createElement("a")
            anchor.href = url
            anchor.download = exported.filename
            anchor.click()
            URL.revokeObjectURL(url)
            setExporting(null)
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : t("loadError"))
        } finally {
            setBusy(false)
        }
    }

    return (
        <section className="rolling-skill-panel rolling-skill-data-panel">
            <div className="rolling-skill-panel-header">
                <div><h3>{t("datasetsTitle")}</h3><p>{t("datasetsDescription")}</p></div>
                <Button size="sm" onClick={reload}>{t("refresh")}</Button>
            </div>
            <div className="rolling-skill-form-row">
                <Input
                    value={name}
                    placeholder={t("datasetName")}
                    aria-label={t("datasetName")}
                    onChange={(event: {target: {value: string}}) => setName(event.target.value)}
                />
                <select
                    className="rolling-skill-select"
                    aria-label={t("datasetSkill")}
                    value={skillId}
                    onChange={(event) => setSkillId(event.target.value)}
                >
                    {catalog.skills.filter((skill) => skill.status === "valid").map((skill) => <option key={skill.id} value={skill.id}>{managedSkillOptionLabel(skill, catalog.repositories)}</option>)}
                </select>
                <Button size="sm" tone="primary" disabled={busy || !name.trim() || !skillId} onClick={create}>
                    {t("createDataset")}
                </Button>
            </div>
            {error ? <p className="rolling-skill-inline-error" role="alert">{error}</p> : null}
            <div className="rolling-skill-list">
                {datasets.map((dataset) => (
                    <article className="rolling-skill-list-row" key={dataset.id}>
                        <div>
                            <strong>{dataset.name}</strong>
                            <span>{dataset.skillReference?.evidencePrecision === "managed"
                                ? `${t("datasetSkill")}: ${dataset.skillReference.name}`
                                : t("unboundManagedSkill")}</span>
                            <span>{t("caseBreakdown")
                                .replace("{all}", String(dataset.caseCount))
                                .replace("{good}", String(dataset.goodcaseCount))
                                .replace("{bad}", String(dataset.badcaseCount))}</span>
                        </div>
                        <div className="rolling-skill-actions">
                            <Button size="sm" onClick={() => beginBinding(dataset)}>{t("changeManagedSkill")}</Button>
                            <Button size="sm" onClick={() => beginExport(dataset)}>{t("exportCsv")}</Button>
                            <Button size="sm" onClick={() => setDeleting(dataset)}>{t("delete")}</Button>
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
                    <Button onClick={() => setDeleting(null)}>{t("cancel")}</Button>
                    <Button disabled={busy} onClick={remove}>{t("confirmDelete")}</Button>
                </>}
            >
                <p>{t("deleteRecoveryPrompt")}</p>
                <label className="rolling-skill-check">
                    <input type="checkbox" checked={recoverQuestions} onChange={(event) => setRecoverQuestions(event.target.checked)}/>
                    <span>{t("recoverToRawCases")}</span>
                </label>
            </Modal>
            <Modal
                open={binding !== null}
                onClose={() => setBinding(null)}
                title={t("bindManagedSkillTitle")}
                closeLabel={t("cancel")}
                footer={<>
                    <Button onClick={() => setBinding(null)}>{t("cancel")}</Button>
                    <Button disabled={busy || !bindingSkillId} onClick={bindSkill}>{t("save")}</Button>
                </>}
            >
                <p>{t("bindManagedSkillDescription")}</p>
                <select className="rolling-skill-select" value={bindingSkillId} onChange={(event) => setBindingSkillId(event.target.value)}>
                    {catalog.skills.filter((skill) => skill.status === "valid").map((skill) => <option key={skill.id} value={skill.id}>{managedSkillOptionLabel(skill, catalog.repositories)}</option>)}
                </select>
            </Modal>
            <Modal
                open={exporting !== null}
                onClose={() => setExporting(null)}
                title={t("exportCsv")}
                closeLabel={t("cancel")}
                footer={<>
                    <Button onClick={() => setExporting(null)}>{t("cancel")}</Button>
                    <Button tone="primary" disabled={busy} onClick={() => void exportCsv()}>{t("exportCsv")}</Button>
                </>}
            >
                <label className="rolling-skill-field">
                    <span>{t("exportScope")}</span>
                    <select className="rolling-skill-select" aria-label={t("exportScope")} value={exportScope} onChange={(event) => setExportScope(event.target.value as typeof exportScope)}>
                        <option value="all">{t("exportAllCases")}</option>
                        <option value="goodcase">{t("exportGoodCases")}</option>
                    </select>
                </label>
            </Modal>
        </section>
    )
}
