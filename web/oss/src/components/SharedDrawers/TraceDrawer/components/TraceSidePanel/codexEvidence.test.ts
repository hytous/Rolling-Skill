import {describe, expect, it} from "vitest"

import {parseCodexEvidenceAttributes} from "./codexEvidence"

describe("parseCodexEvidenceAttributes", () => {
    it("returns null when the span has no Codex evidence projection", () => {
        expect(parseCodexEvidenceAttributes({"ag.type": "agent"})).toBeNull()
    })

    it("parses the bounded evidence projection and marks full-access evidence diagnostic", () => {
        const result = parseCodexEvidenceAttributes({
            "ag.meta.eval.schema_version": "codex-evidence/v1",
            "ag.meta.eval.evidence.collection_status": "DIAGNOSTIC_ONLY",
            "ag.meta.eval.evidence.source_trust": "diagnostic_full_access",
            "ag.meta.eval.evidence.completeness": "turn_complete",
            "ag.meta.eval.evidence.digest": "sha256:abc",
            "ag.meta.eval.evidence.artifact_ref": "evidence://attempt/1",
            "ag.meta.eval.evidence.reason_codes": ["trace.writer-not-isolated"],
            "ag.meta.eval.events.count": 41,
            "ag.meta.eval.payloads.count": "9",
            "ag.meta.eval.tools.calls": 3,
            "ag.meta.eval.tools.errors": 1,
            "ag.meta.eval.runtime.open_objects": 2,
        })

        expect(result).toEqual({
            schemaVersion: "codex-evidence/v1",
            collectionStatus: "DIAGNOSTIC_ONLY",
            sourceTrust: "diagnostic_full_access",
            completeness: "turn_complete",
            digest: "sha256:abc",
            artifactRef: "evidence://attempt/1",
            reasonCodes: ["trace.writer-not-isolated"],
            counts: {
                events: 41,
                payloads: 9,
                toolCalls: 3,
                toolErrors: 1,
                openRuntimeObjects: 2,
            },
            diagnosticOnly: true,
        })
    })

    it("accepts JSON-encoded reason arrays without treating a ready trace as diagnostic", () => {
        const result = parseCodexEvidenceAttributes({
            "ag.meta.eval.evidence.collection_status": "READY_FOR_EVALUATION",
            "ag.meta.eval.evidence.source_trust": "runtime_isolated",
            "ag.meta.eval.evidence.reason_codes": '["one","two"]',
        })

        expect(result?.reasonCodes).toEqual(["one", "two"])
        expect(result?.diagnosticOnly).toBe(false)
    })
})
