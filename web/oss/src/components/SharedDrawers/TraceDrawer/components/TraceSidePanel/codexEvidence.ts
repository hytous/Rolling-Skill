export interface CodexEvidenceView {
    schemaVersion?: string
    collectionStatus?: string
    sourceTrust?: string
    completeness?: string
    digest?: string
    artifactRef?: string
    reasonCodes: string[]
    counts: {
        events?: number
        payloads?: number
        toolCalls?: number
        toolErrors?: number
        openRuntimeObjects?: number
    }
    diagnosticOnly: boolean
}

const KEYS = {
    schemaVersion: "ag.meta.eval.schema_version",
    collectionStatus: "ag.meta.eval.evidence.collection_status",
    sourceTrust: "ag.meta.eval.evidence.source_trust",
    completeness: "ag.meta.eval.evidence.completeness",
    digest: "ag.meta.eval.evidence.digest",
    artifactRef: "ag.meta.eval.evidence.artifact_ref",
    reasonCodes: "ag.meta.eval.evidence.reason_codes",
    events: "ag.meta.eval.events.count",
    payloads: "ag.meta.eval.payloads.count",
    toolCalls: "ag.meta.eval.tools.calls",
    toolErrors: "ag.meta.eval.tools.errors",
    openRuntimeObjects: "ag.meta.eval.runtime.open_objects",
} as const

const optionalString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value : undefined

const optionalCount = (value: unknown): number | undefined => {
    const parsed =
        typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : undefined
}

const reasonCodes = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string" && Boolean(item))
    }
    if (typeof value !== "string" || !value.trim()) return []
    try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
            return parsed.filter(
                (item): item is string => typeof item === "string" && Boolean(item),
            )
        }
    } catch {
        return value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    }
    return []
}

export function parseCodexEvidenceAttributes(
    attributes: Record<string, unknown> | null | undefined,
): CodexEvidenceView | null {
    if (!attributes || !Object.values(KEYS).some((key) => key in attributes)) return null

    const collectionStatus = optionalString(attributes[KEYS.collectionStatus])
    const sourceTrust = optionalString(attributes[KEYS.sourceTrust])

    return {
        schemaVersion: optionalString(attributes[KEYS.schemaVersion]),
        collectionStatus,
        sourceTrust,
        completeness: optionalString(attributes[KEYS.completeness]),
        digest: optionalString(attributes[KEYS.digest]),
        artifactRef: optionalString(attributes[KEYS.artifactRef]),
        reasonCodes: reasonCodes(attributes[KEYS.reasonCodes]),
        counts: {
            events: optionalCount(attributes[KEYS.events]),
            payloads: optionalCount(attributes[KEYS.payloads]),
            toolCalls: optionalCount(attributes[KEYS.toolCalls]),
            toolErrors: optionalCount(attributes[KEYS.toolErrors]),
            openRuntimeObjects: optionalCount(attributes[KEYS.openRuntimeObjects]),
        },
        diagnosticOnly:
            collectionStatus === "DIAGNOSTIC_ONLY" || sourceTrust === "diagnostic_full_access",
    }
}
