import {useEffect, useRef, useState} from "react"

import {requestRollingSkill} from "../api"
import type {Translate} from "../locale"
import {projectMarkers, projectSequenceRange, type ConversationCurationMarker, type CurationMarkerStatus} from "./curation-markers"

interface ChatSnapshot {
    chat: {
        order: readonly string[]
        nodes: {get(key: string): {anchorSeq: number} | undefined}
    }
}

interface ConversationCurationMarkersProps {
    sessionId: string
    useSession: <T>(selector: (snapshot: ChatSnapshot) => T) => T
    t: Translate
}

interface MarkerRecord extends ConversationCurationMarker {
    sessionId: string
    endMessageId: string
    curationSessionId: string | null
    caseId: string | null
}

const MARKER_CLASSES = ["rolling-skill-curation-draft", "rolling-skill-curation-saved"]
const CAPTURE_RANGE_CLASS = "rolling-skill-capture-range"

interface CaptureRangeReveal {
    sessionId: string
    startSeq: number
    endSeq: number
}

export function ConversationCurationMarkers({sessionId, useSession, t}: ConversationCurationMarkersProps) {
    const snapshot = useSession((value) => value)
    const [markers, setMarkers] = useState<MarkerRecord[]>([])
    const [revision, setRevision] = useState(0)
    const [compatibilityMissing, setCompatibilityMissing] = useState(false)
    const [captureRange, setCaptureRange] = useState<CaptureRangeReveal | null>(null)
    const applied = useRef(new Set<HTMLElement>())
    const scrollToCaptureRange = useRef(false)

    useEffect(() => {
        const controller = new AbortController()
        requestRollingSkill<MarkerRecord[]>(
            "conversationCuration.markers",
            {sessionId},
            controller.signal,
        ).then(setMarkers).catch(() => {
            if (!controller.signal.aborted) setMarkers([])
        })
        return () => controller.abort()
    }, [sessionId, revision])

    useEffect(() => {
        const refresh = (event: Event) => {
            const detailSessionId = (event as CustomEvent<{sessionId?: string}>).detail?.sessionId
            if (!detailSessionId || detailSessionId === sessionId) {
                setRevision((value) => value + 1)
            }
        }
        window.addEventListener("rolling-skill:curation-markers-changed", refresh)
        return () => window.removeEventListener("rolling-skill:curation-markers-changed", refresh)
    }, [sessionId])

    useEffect(() => {
        const reveal = (event: Event) => {
            const detail = (event as CustomEvent<CaptureRangeReveal>).detail
            if (
                detail?.sessionId !== sessionId ||
                !Number.isSafeInteger(detail.startSeq) ||
                !Number.isSafeInteger(detail.endSeq)
            ) return
            scrollToCaptureRange.current = true
            setCaptureRange({...detail})
        }
        window.addEventListener("rolling-skill:reveal-capture-range", reveal)
        return () => window.removeEventListener("rolling-skill:reveal-capture-range", reveal)
    }, [sessionId])

    useEffect(() => {
        const clear = () => {
            for (const row of applied.current) {
                row.classList.remove(...MARKER_CLASSES, CAPTURE_RANGE_CLASS)
                row.removeAttribute("data-rolling-skill-curation-marker")
                row.removeAttribute("data-rolling-skill-capture-range")
            }
            applied.current.clear()
        }
        const render = () => {
            clear()
            const projection = projectMarkers(snapshot, markers)
            let missing = false
            for (const [key, status] of projection) {
                const selector = `[data-chat-flow-key="${CSS.escape(key)}"]`
                const rows = document.querySelectorAll<HTMLElement>(selector)
                if (rows.length === 0) missing = true
                for (const row of rows) {
                    row.classList.add(`rolling-skill-curation-${status}`)
                    row.dataset.rollingSkillCurationMarker = status
                    applied.current.add(row)
                }
            }
            const captureKeys = captureRange
                ? projectSequenceRange(snapshot, captureRange.startSeq, captureRange.endSeq)
                : []
            let firstCaptureRow: HTMLElement | null = null
            for (const key of captureKeys) {
                const selector = `[data-chat-flow-key="${CSS.escape(key)}"]`
                for (const row of document.querySelectorAll<HTMLElement>(selector)) {
                    row.classList.add(CAPTURE_RANGE_CLASS)
                    row.dataset.rollingSkillCaptureRange = "true"
                    firstCaptureRow ??= row
                    applied.current.add(row)
                }
            }
            if (firstCaptureRow && scrollToCaptureRange.current) {
                scrollToCaptureRange.current = false
                window.setTimeout(() => firstCaptureRow?.scrollIntoView({behavior: "smooth", block: "center"}), 0)
            }
            setCompatibilityMissing((current) => current === missing ? current : missing)
        }
        render()
        const observer = new MutationObserver(render)
        observer.observe(document.body, {childList: true, subtree: true})
        return () => {
            observer.disconnect()
            clear()
        }
    }, [snapshot, markers, captureRange])

    const totals = markers.reduce((result, marker) => {
        result[marker.status] += 1
        return result
    }, {draft: 0, saved: 0} as Record<CurationMarkerStatus, number>)

    if (markers.length === 0) return null
    return (
        <div className="rolling-skill-marker-legend" aria-label={t("markerLegend")}>
            {totals.draft > 0 ? (
                <span className="rolling-skill-marker-chip rolling-skill-marker-chip-draft">
                    {t("markerDraftLegend")} · {totals.draft}
                </span>
            ) : null}
            {totals.saved > 0 ? (
                <span className="rolling-skill-marker-chip rolling-skill-marker-chip-saved">
                    {t("markerSavedLegend")} · {totals.saved}
                </span>
            ) : null}
            {compatibilityMissing ? (
                <span className="rolling-skill-marker-compatibility" role="status" title={t("markerCompatibility")}>
                    {t("markerCompatibilityShort")}
                </span>
            ) : null}
        </div>
    )
}
