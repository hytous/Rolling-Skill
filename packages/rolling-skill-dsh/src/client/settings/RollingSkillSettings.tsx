import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {ImportPanel} from "../workbench/ImportPanel"

interface SettingsDashboard {
    dataRoot: string
    settings: {
        plugin: {
            runtime: {displayName?: string; version?: string; runtimeId: string} | null
        }
    }
}

export function RollingSkillSettings({t}: {t: Translate}) {
    const [revision, setRevision] = useState(0)
    const [state, setState] = useState<
        {status: "loading"} |
        {status: "error"; message: string} |
        {status: "ready"; dashboard: SettingsDashboard}
    >({status: "loading"})

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<SettingsDashboard>("dashboard.get", {}, controller.signal)
            .then((dashboard) => setState({status: "ready", dashboard}))
            .catch((error: unknown) => {
                if (controller.signal.aborted) return
                setState({status: "error", message: error instanceof Error ? error.message : t("loadError")})
            })
        return () => controller.abort()
    }, [revision])

    const runtime = state.status === "ready" ? state.dashboard.settings.plugin.runtime : null
    return (
        <section className="rolling-skill-settings" aria-labelledby="rolling-skill-settings-title">
            <header className="rolling-skill-header">
                <div>
                    <h2 id="rolling-skill-settings-title">{t("settings")}</h2>
                    <p>{t("settingsDescription")}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}>
                    {t("refresh")}
                </Button>
            </header>
            {state.status === "loading" ? (
                <div className="rolling-skill-state" role="status">{t("loading")}</div>
            ) : state.status === "error" ? (
                <div className="rolling-skill-state rolling-skill-error" role="alert">{state.message}</div>
            ) : (
                <section className="rolling-skill-panel">
                    <h3>{t("diagnostics")}</h3>
                    <dl>
                        <div><dt>{t("dataDirectory")}</dt><dd><code>{state.dashboard.dataRoot}</code></dd></div>
                        <div>
                            <dt>{t("runtime")}</dt>
                            <dd>{runtime
                                ? [runtime.displayName ?? runtime.runtimeId, runtime.version].filter(Boolean).join(" ")
                                : t("noRuntime")}</dd>
                        </div>
                    </dl>
                </section>
            )}
            <ImportPanel t={t}/>
        </section>
    )
}
