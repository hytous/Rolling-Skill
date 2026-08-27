import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import {useEffect, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {CaseCaptureDialog} from "./CaseCaptureDialog"
import {registerActiveConversationSession} from "./active-session"

interface Marker {
    endMessageId: string
    curationSessionId: string | null
    caseId: string | null
    status: "draft" | "saved"
}

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
    const [loading, setLoading] = useState(true)
    const [marker, setMarker] = useState<Marker | null>(null)

    useEffect(() => registerActiveConversationSession(sessionId), [sessionId])

    useEffect(() => {
        const controller = new AbortController()
        setLoading(true)
        requestRollingSkill<Marker[]>(
            "conversationCuration.markers",
            {sessionId},
            controller.signal,
        ).then((markers) => {
            setMarker(markers.find((entry) => entry.endMessageId === messageId) ?? null)
        }).catch(() => {
            if (!controller.signal.aborted) setMarker(null)
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
    }, [messageId, sessionId])

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
            <Button
                variant="ghost"
                size="sm"
                onClick={activate}
                disabled={loading}
                aria-label={label}
                data-rolling-skill-curation-status={marker?.status ?? "available"}
            >
                {label}
            </Button>
            {open ? (
                <CaseCaptureDialog
                    sessionId={sessionId}
                    endMessageId={messageId}
                    t={t}
                    onClose={() => setOpen(false)}
                    onCreated={(curation) => setMarker({
                        endMessageId: messageId,
                        curationSessionId: curation.id,
                        caseId: curation.caseId,
                        status: curation.caseId ? "saved" : "draft",
                    })}
                />
            ) : null}
        </>
    )
}
