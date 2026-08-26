import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"

interface ImportStatus {
    available: boolean
    status: "ready" | "not-found" | "blocked" | "already-imported"
    sourceRoot: string
    destinationRoot?: string
    error?: string
    migration?: {importedAt: string; copiedFiles: string[]}
}

export function ImportPanel({t}: {t: Translate}) {
    const [state, setState] = useState<
        {kind: "loading"} |
        {kind: "ready"; value: ImportStatus} |
        {kind: "error"; message: string}
    >({kind: "loading"})
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)
    const [imported, setImported] = useState(false)
    const [revision, setRevision] = useState(0)

    useEffect(() => {
        const controller = new AbortController()
        setState({kind: "loading"})
        requestRollingSkill<ImportStatus>("legacyImport.status", {}, controller.signal)
            .then((value) => setState({kind: "ready", value}))
            .catch((reason: unknown) => {
                if (controller.signal.aborted) return
                setState({kind: "error", message: reason instanceof Error ? reason.message : t("loadError")})
            })
        return () => controller.abort()
    }, [revision])

    const runImport = async () => {
        setBusy(true)
        try {
            await requestRollingSkill("legacyImport.run", {confirmed: true})
            setImported(true)
            setConfirming(false)
            setRevision((value) => value + 1)
        } catch (reason) {
            setState({kind: "error", message: reason instanceof Error ? reason.message : t("loadError")})
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="rolling-skill-data-stack">
            <section className="rolling-skill-panel">
                <div className="rolling-skill-panel-header">
                    <div><h3>{t("legacyImportTitle")}</h3><p>{t("legacyImportDescription")}</p></div>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t("refresh")}</Button>
                </div>
                {state.kind === "loading" ? <p>{t("loading")}</p> : state.kind === "error" ? <p className="rolling-skill-inline-error" role="alert">{state.message}</p> : (
                    <>
                        <dl>
                            <div><dt>{t("legacySource")}</dt><dd><code>{state.value.sourceRoot}</code></dd></div>
                            {state.value.destinationRoot ? <div><dt>{t("legacyDestination")}</dt><dd><code>{state.value.destinationRoot}</code></dd></div> : null}
                        </dl>
                        <p className="rolling-skill-help">{t("legacyCopyOnly")}</p>
                        {imported || state.value.status === "already-imported" ? <p>{t("legacyImportedRestart")}</p> : state.value.status === "not-found" ? <p>{t("legacyNotFound")}</p> : state.value.status === "blocked" ? <p className="rolling-skill-inline-error">{state.value.error ?? t("legacyBlocked")}</p> : confirming ? (
                            <div className="rolling-skill-confirm">
                                <p>{t("legacyConfirmPrompt")}</p>
                                <div className="rolling-skill-actions">
                                    <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>{t("cancel")}</Button>
                                    <Button variant="outline" disabled={busy} onClick={() => void runImport()}>{t("confirmImport")}</Button>
                                </div>
                            </div>
                        ) : <Button variant="outline" disabled={busy || !state.value.available} onClick={() => setConfirming(true)}>{t("startImport")}</Button>}
                    </>
                )}
            </section>
        </div>
    )
}
