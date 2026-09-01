import type {Translate, TranslationKey} from "../locale"

const STATUS_KEYS: Record<string, TranslationKey> = {
    queued: "statusQueued",
    running: "statusRunning",
    needs_review: "statusNeedsReview",
    failed: "statusFailed",
    archived: "statusArchived",
    completed: "statusCompleted",
    succeeded: "statusSucceeded",
    cancelled: "statusCancelled",
    paused: "statusPaused",
    verifying: "statusVerifying",
    awaiting_permission: "statusAwaitingPermission",
    awaiting_confirmation: "statusAwaitingConfirmation",
    needs_recovery: "statusNeedsRecovery",
}

export function displayStatus(status: string | null | undefined, t: Translate): string {
    if (!status) return t("notAvailable")
    const key = STATUS_KEYS[status]
    return key ? t(key) : status
}

export function displayDateTime(
    value: string | null | undefined,
    fallback: string,
): string {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function shortDiagnosticId(value: string | null | undefined): string | null {
    if (!value) return null
    return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}
