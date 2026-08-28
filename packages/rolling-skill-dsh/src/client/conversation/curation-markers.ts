import markerProjection from "./curation-markers.cjs"

export type CurationMarkerStatus = "draft" | "saved"

export interface ConversationCurationMarker {
    startSeq: number
    endSeq: number
    status: CurationMarkerStatus
}

interface MarkerConversationSnapshot {
    chat: {
        order: readonly string[]
        nodes: {get(key: string): {anchorSeq: number} | undefined}
    }
}

export const projectMarkers = markerProjection.projectMarkers as (
    snapshot: MarkerConversationSnapshot,
    markers: readonly ConversationCurationMarker[],
) => Map<string, CurationMarkerStatus>

export const projectSequenceRange = markerProjection.projectSequenceRange as (
    snapshot: MarkerConversationSnapshot,
    startSeq: number,
    endSeq: number,
) => string[]
