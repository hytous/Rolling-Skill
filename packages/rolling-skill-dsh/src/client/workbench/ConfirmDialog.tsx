import {useEffect, useId} from "react"
import type {ReactNode} from "react"

import {ActionButton} from "./ActionButton"

export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    busy = false,
    destructive = false,
    children,
    onConfirm,
    onCancel,
}: {
    open: boolean
    title: string
    description?: string
    confirmLabel: string
    cancelLabel: string
    busy?: boolean
    destructive?: boolean
    children?: ReactNode
    onConfirm: () => void
    onCancel: () => void
}) {
    const titleId = useId()
    const descriptionId = useId()

    useEffect(() => {
        if (!open) return
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !busy) onCancel()
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    }, [open, busy, onCancel])

    if (!open) return null
    return (
        <div className="rolling-skill-dialog-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onCancel()
        }}>
            <section
                className="rolling-skill-dialog rolling-skill-confirm-dialog"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
            >
                <header className="rolling-skill-dialog-header">
                    <div>
                        <h2 id={titleId}>{title}</h2>
                        {description ? <p id={descriptionId}>{description}</p> : null}
                    </div>
                </header>
                {children}
                <div className="rolling-skill-actions rolling-skill-dialog-actions">
                    <ActionButton onClick={onCancel} disabled={busy}>{cancelLabel}</ActionButton>
                    <ActionButton
                        tone="primary"
                        className={destructive ? "rolling-skill-destructive-action" : undefined}
                        onClick={onConfirm}
                        disabled={busy}
                        autoFocus
                    >
                        {confirmLabel}
                    </ActionButton>
                </div>
            </section>
        </div>
    )
}
