import {useCallback, useSyncExternalStore} from "react"
import {requestRollingSkill} from "../api"
import markerSource from "./marker-source.cjs"
import type {ConversationCurationMarker} from "./curation-markers"

export interface MarkerRecord extends ConversationCurationMarker {
    sessionId: string
    endMessageId: string
    curationSessionId: string | null
    caseId: string | null
}
const source = markerSource.createConversationMarkerSource({
    load: (sessionId: string, signal: AbortSignal) => requestRollingSkill<MarkerRecord[]>("conversationCuration.markers", {sessionId}, signal),
    listen: (notify: (sessionId?: string) => void) => {
        const listener = (event: Event) => notify((event as CustomEvent<{sessionId?: string}>).detail?.sessionId)
        window.addEventListener("rolling-skill:curation-markers-changed", listener)
        return () => window.removeEventListener("rolling-skill:curation-markers-changed", listener)
    },
})

export const refreshConversationMarkers = (sessionId: string) => source.refresh(sessionId)
export function useConversationMarkers(sessionId: string): {loading: boolean; markers: MarkerRecord[]} {
    return useSyncExternalStore(
        useCallback((notify: () => void) => source.subscribe(sessionId, notify), [sessionId]),
        useCallback(() => source.getSnapshot(sessionId), [sessionId]),
    )
}
