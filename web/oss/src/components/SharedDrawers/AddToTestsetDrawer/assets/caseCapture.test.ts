import {describe, expect, it} from "vitest"

import {
    augmentCaseCaptureRows,
    CASE_CAPTURE_COLUMNS,
    missingCaseCaptureColumns,
} from "./caseCapture"

describe("case capture metadata", () => {
    const context = {
        caseType: "badcase" as const,
        sourceTraceId: "trace-1",
        sourceSpanId: "span-1",
    }

    it("leaves ordinary add-to-testset rows byte-for-byte untouched", () => {
        const rows = [{question: "q", answer: "a"}]
        expect(augmentCaseCaptureRows(rows, null)).toBe(rows)
    })

    it("adds required classification and source provenance to each captured row", () => {
        expect(
            augmentCaseCaptureRows(
                [{question: "q1", eval_case_type: "stale"}, {question: "q2"}],
                context,
            ),
        ).toEqual([
            {
                question: "q1",
                eval_case_type: "badcase",
                source_trace_id: "trace-1",
                source_span_id: "span-1",
            },
            {
                question: "q2",
                eval_case_type: "badcase",
                source_trace_id: "trace-1",
                source_span_id: "span-1",
            },
        ])
    })

    it("returns only reserved columns missing from the target revision", () => {
        expect(missingCaseCaptureColumns(["question", "eval_case_type"], context)).toEqual([
            "source_trace_id",
            "source_span_id",
        ])
        expect(missingCaseCaptureColumns([], null)).toEqual([])
        expect(CASE_CAPTURE_COLUMNS).toEqual([
            "eval_case_type",
            "source_trace_id",
            "source_span_id",
        ])
    })
})
