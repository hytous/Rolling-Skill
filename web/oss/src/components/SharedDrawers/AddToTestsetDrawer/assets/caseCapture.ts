export const CASE_CAPTURE_COLUMNS = ["eval_case_type", "source_trace_id", "source_span_id"] as const

export type CaseCaptureType = "goodcase" | "badcase"

export interface CaseCaptureContext {
    caseType: CaseCaptureType
    sourceTraceId: string
    sourceSpanId: string
}

export function augmentCaseCaptureRows<T extends Record<string, unknown>>(
    rows: T[],
    context: CaseCaptureContext | null,
): (T & {
    eval_case_type?: CaseCaptureType
    source_trace_id?: string
    source_span_id?: string
})[] {
    if (!context) return rows
    return rows.map((row) => ({
        ...row,
        eval_case_type: context.caseType,
        source_trace_id: context.sourceTraceId,
        source_span_id: context.sourceSpanId,
    }))
}

export function missingCaseCaptureColumns(
    existingColumns: string[],
    context: CaseCaptureContext | null,
): string[] {
    if (!context) return []
    const existing = new Set(existingColumns)
    return CASE_CAPTURE_COLUMNS.filter((column) => !existing.has(column))
}
