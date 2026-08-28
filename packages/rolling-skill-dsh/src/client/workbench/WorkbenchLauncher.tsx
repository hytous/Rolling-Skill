import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useCallback, useEffect, useState} from "react"

import type {Translate} from "../locale"
import {WorkbenchOverlay} from "./WorkbenchOverlay"
import type {WorkbenchRoute} from "./Workbench"

interface LocaleService {
    getSnapshot(): {revision: number}
    subscribe(listener: () => void): () => void
}

interface WorkbenchLauncherProps {
    wide: boolean
    locale: LocaleService
    t: Translate
}

const ROUTE_KEY = "rolling-skill:last-workbench-route"

function savedRoute(): WorkbenchRoute {
    try {
        const value = JSON.parse(localStorage.getItem(ROUTE_KEY) ?? "null")
        if (value && typeof value === "object" && typeof value.page === "string") return value
    } catch {
        // The workbench does not require browser persistence.
    }
    return {page: "overview"}
}

function persistRoute(route: WorkbenchRoute): void {
    try {
        localStorage.setItem(ROUTE_KEY, JSON.stringify(route))
    } catch {
        // The workbench remains usable when storage is unavailable.
    }
}

export function WorkbenchLauncher({wide, locale, t}: WorkbenchLauncherProps) {
    const [open, setOpen] = useState(false)
    const [route, setRoute] = useState<WorkbenchRoute>(savedRoute)
    const changeRoute = useCallback((next: WorkbenchRoute) => {
        setRoute(next)
        persistRoute(next)
    }, [])

    useEffect(() => {
        const openWorkbench = (event: Event) => {
            const next = (event as CustomEvent<{route?: WorkbenchRoute}>).detail?.route
            if (next?.page) changeRoute(next)
            setOpen(true)
        }
        window.addEventListener("rolling-skill:open-workbench", openWorkbench)
        return () => window.removeEventListener("rolling-skill:open-workbench", openWorkbench)
    }, [changeRoute])

    useEffect(() => {
        const closeWorkbench = () => setOpen(false)
        window.addEventListener("rolling-skill:close-workbench", closeWorkbench)
        return () => window.removeEventListener("rolling-skill:close-workbench", closeWorkbench)
    }, [])

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(true)}
                aria-label={t("openWorkbench")}
                title={t("openWorkbench")}
            >
                {wide ? t("nav") : "RS"}
            </Button>
            {open ? (
                <WorkbenchOverlay
                    locale={locale}
                    route={route}
                    t={t}
                    onClose={() => setOpen(false)}
                    onRouteChange={changeRoute}
                />
            ) : null}
        </>
    )
}
