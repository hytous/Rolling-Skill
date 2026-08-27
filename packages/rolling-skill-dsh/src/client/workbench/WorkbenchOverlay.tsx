import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useRef} from "react"

import type {Translate} from "../locale"
import {Workbench, type WorkbenchRoute} from "./Workbench"

interface LocaleService {
    getSnapshot(): {revision: number}
    subscribe(listener: () => void): () => void
}

interface WorkbenchOverlayProps {
    locale: LocaleService
    route: WorkbenchRoute
    t: Translate
    onClose: () => void
    onRouteChange: (route: WorkbenchRoute) => void
}

export function WorkbenchOverlay({locale, route, t, onClose, onRouteChange}: WorkbenchOverlayProps) {
    const overlayRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const overlay = overlayRef.current
        overlay?.querySelector<HTMLElement>("button:not([disabled])")?.focus()
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault()
                onClose()
                return
            }
            if (event.key !== "Tab" || !overlay) return
            const focusable = Array.from(overlay.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
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

    return (
        <div className="rolling-skill-workbench-backdrop" onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose()
        }}>
            <div
                ref={overlayRef}
                className="rolling-skill-workbench-overlay"
                role="dialog"
                aria-modal="true"
                aria-label={t("title")}
            >
                <Button
                    className="rolling-skill-workbench-close"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    aria-label={t("close")}
                >
                    ×
                </Button>
                <Workbench locale={locale} t={t} initialRoute={route} onRouteChange={onRouteChange}/>
            </div>
        </div>
    )
}
