import { afterEach, describe, expect, it, vi } from "vitest";
import { trace, type Span } from "@opentelemetry/api";

import { createSandboxAgentOtel } from "../../src/tracing/otel.ts";

interface FakeSpan {
  name: string;
  attributes: Record<string, unknown>;
  ended: boolean;
}

function spyTracer(): FakeSpan[] {
  const spans: FakeSpan[] = [];
  const makeSpan = (name: string): Span => {
    const span: FakeSpan = { name, attributes: {}, ended: false };
    spans.push(span);
    const api = {
      setAttribute(key: string, value: unknown) {
        span.attributes[key] = value;
        return api;
      },
      setAttributes(attrs: Record<string, unknown>) {
        Object.assign(span.attributes, attrs);
        return api;
      },
      recordException() {},
      setStatus() {
        return api;
      },
      end() {
        span.ended = true;
      },
      spanContext() {
        return {
          traceId: "1".repeat(32),
          spanId: "2".repeat(16),
          traceFlags: 1,
        };
      },
      isRecording() {
        return true;
      },
      addEvent() {
        return api;
      },
      updateName() {
        return api;
      },
    };
    return api as unknown as Span;
  };
  vi.spyOn(trace, "getTracer").mockReturnValue({
    startSpan: (name: string) => makeSpan(name),
  } as any);
  return spans;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Codex evidence OTel projection", () => {
  it("projects only bounded summary metadata before the agent span ends", () => {
    const spans = spyTracer();
    const run = createSandboxAgentOtel({
      harness: "codex",
      model: "gpt-5.6-sol",
      emitSpans: true,
      captureContent: false,
    });
    run.start({ prompt: "sensitive prompt" });

    run.recordCodexEvidence({
      schemaVersion: "codex-evidence/v1",
      collectionStatus: "PENDING_TERMINAL",
      sourceTrust: "diagnostic_full_access",
      completeness: "turn_complete",
      digest: "sha256:abc",
      artifactRef: "evidence://attempt/attempt-1",
      reasonCodes: ["missing_root_terminal"],
      events: 42,
      payloads: 7,
      tools: 3,
      toolErrors: 1,
      openRuntimeObjects: 2,
    });

    const agentSpan = spans.find((span) => span.name === "invoke_agent");
    expect(agentSpan?.ended).toBe(false);
    expect(agentSpan?.attributes).toMatchObject({
      "ag.meta.eval.schema_version": "codex-evidence/v1",
      "ag.meta.eval.evidence.collection_status": "PENDING_TERMINAL",
      "ag.meta.eval.evidence.source_trust": "diagnostic_full_access",
      "ag.meta.eval.evidence.completeness": "turn_complete",
      "ag.meta.eval.evidence.digest": "sha256:abc",
      "ag.meta.eval.evidence.artifact_ref": "evidence://attempt/attempt-1",
      "ag.meta.eval.evidence.reason_codes": ["missing_root_terminal"],
      "ag.meta.eval.events.count": 42,
      "ag.meta.eval.payloads.count": 7,
      "ag.meta.eval.tools.calls": 3,
      "ag.meta.eval.tools.errors": 1,
      "ag.meta.eval.runtime.open_objects": 2,
    });
    expect(agentSpan?.attributes).not.toHaveProperty("ag.meta.eval.status");

    const serializedAttributes = JSON.stringify(agentSpan?.attributes);
    expect(serializedAttributes).not.toContain("sensitive prompt");
    expect(serializedAttributes).not.toContain("tool arguments");
    expect(serializedAttributes).not.toContain("tool results");

    run.finish();
    expect(agentSpan?.ended).toBe(true);
  });

  it("bounds reason codes and opaque references", () => {
    const spans = spyTracer();
    const run = createSandboxAgentOtel({ harness: "codex", emitSpans: true });
    run.start({ prompt: "hi" });

    run.recordCodexEvidence({
      schemaVersion: "codex-evidence/v1",
      collectionStatus: "INVALID_TRACE",
      sourceTrust: "diagnostic_full_access",
      completeness: "invalid",
      artifactRef: "x".repeat(2_000),
      reasonCodes: Array.from({ length: 40 }, (_, index) => `reason-${index}`),
      events: 0,
      payloads: 0,
      tools: 0,
      toolErrors: 0,
      openRuntimeObjects: 0,
    });

    const attrs = spans.find((span) => span.name === "invoke_agent")?.attributes;
    expect(
      (attrs?.["ag.meta.eval.evidence.reason_codes"] as string[]).length,
    ).toBe(16);
    expect(
      String(attrs?.["ag.meta.eval.evidence.artifact_ref"]).length,
    ).toBe(1_024);
  });
});
