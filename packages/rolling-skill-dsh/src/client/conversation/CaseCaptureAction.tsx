import {useEffect, useState} from "react"

import type {Translate} from "../locale"
import {CaseCaptureDialog} from "./CaseCaptureDialog"
import {registerActiveConversationSession} from "./active-session"
import {refreshConversationMarkers, useConversationMarkers} from "./useConversationMarkers"

interface CaseCaptureActionProps {
    messageId: string
    sessionId: string
    useSession?: unknown
    useProjection?: unknown
    t: Translate
}

function openWorkbench(sessionId: string): void {
    window.dispatchEvent(new CustomEvent("rolling-skill:open-workbench", {
        detail: {route: {page: "curation", sessionId}},
    }))
}

export function CaseCaptureAction({messageId, sessionId, t}: CaseCaptureActionProps) {
    const [open, setOpen] = useState(false)
    const {loading, markers} = useConversationMarkers(sessionId)
    const marker = markers.find((entry) => entry.endMessageId === messageId) ?? null

    useEffect(() => registerActiveConversationSession(sessionId), [sessionId])

    const label = loading
        ? t("captureChecking")
        : marker?.status === "saved"
            ? t("captureSaved")
            : marker?.status === "draft"
                ? t("captureDraft")
                : t("captureAction")

    const activate = () => {
        if (marker?.curationSessionId) {
            openWorkbench(marker.curationSessionId)
            return
        }
        setOpen(true)
    }

    return (
        <>
            <button
                type="button"
                className="rolling-skill-capture-action"
                onClick={activate}
                disabled={loading}
                aria-label={label}
                data-rolling-skill-curation-status={marker?.status ?? "available"}
            >
                {label}
            </button>
            {open ? (
                <CaseCaptureDialog
                    sessionId={sessionId}
                    endMessageId={messageId}
                    t={t}
                    onClose={() => setOpen(false)}
                    onCreated={() => refreshConversationMarkers(sessionId)}
                />
            ) : null}
        </>
    )
}
