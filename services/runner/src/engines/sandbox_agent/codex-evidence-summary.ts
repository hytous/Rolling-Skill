/** Safe, content-addressed projection of validated Codex rollout evidence. */
import { createHash } from "node:crypto";

import type { CodexRolloutBundle } from "./codex-rollout-reader.ts";
import type { CodexRolloutLifecycle } from "./codex-rollout-lifecycle.ts";
import type {
  CodexEvidenceValidationReason,
  JsonValue,
} from "./codex-rollout-schema.ts";

export interface CodexEvidenceSummaryV1 {
  schemaVersion: "codex-evidence/v1";
  identity: {
    traceId: string;
    rolloutId: string;
    rootThreadId: string;
    targetThreadId: string;
    targetTurnId?: string;
  };
  watermark: {
    afterSeqExclusive: number;
    toSeqInclusive: number;
  };
  completeness: CodexRolloutLifecycle["completeness"];
  hardScoreEligible: boolean;
  evidenceDigest: string;
  artifactReference: string;
  counts: {
    events: number;
    payloadBytes: number;
    payloads: number;
    warnings: number;
  };
  byteSizes: {
    manifest: number;
    eventLog: number;
    payloads: number;
    total: number;
  };
  eventTypeCounts: Record<string, number>;
  validationReasons: CodexEvidenceValidationReason[];
  lifecycleWarnings: CodexRolloutLifecycle["warnings"];
  contentDigests: {
    manifestSha256: string;
    eventSpineSha256: string;
    payloads: Array<{
      rawPayloadId: string;
      byteLength: number;
      sha256: string;
    }>;
  };
  capture: {
    startedAtUnixMs: number;
    observedThroughUnixMs: number;
    collectedAtUnixMs: number;
  };
}

export function createCodexEvidenceSummary(input: {
  bundle: CodexRolloutBundle;
  lifecycle: CodexRolloutLifecycle;
  artifactReference: string;
  collectedAtUnixMs: number;
}): CodexEvidenceSummaryV1 {
  const { bundle, lifecycle } = input;
  const attemptEvents = bundle.events.filter(
    (event) =>
      event.seq > lifecycle.watermark.afterSeqExclusive &&
      event.seq <= lifecycle.watermark.toSeqInclusive,
  );
  const referencedPayloadIds = new Set(
    attemptEvents.flatMap((event) =>
      event.payloadRefs.map((payload) => payload.rawPayloadId),
    ),
  );
  const payloads = bundle.payloads
    .filter((payload) => referencedPayloadIds.has(payload.rawPayloadId))
    .sort(
      (left, right) =>
        firstReference(left.referencedBySeqs) -
          firstReference(right.referencedBySeqs) ||
        left.rawPayloadId.localeCompare(right.rawPayloadId),
    );
  const validationReasons = [...lifecycle.reasons].sort(compareReasons);
  const lifecycleWarnings = [...lifecycle.warnings].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.startedSeq - right.startedSeq,
  );
  const contentDigests = {
    manifestSha256: bundle.contentDigests.manifestSha256,
    eventSpineSha256: sha256(
      canonicalJson(attemptEvents.map((event) => event.rawLineSha256)),
    ),
    payloads: payloads.map((payload) => ({
      rawPayloadId: payload.rawPayloadId,
      byteLength: payload.byteLength,
      sha256: payload.sha256,
    })),
  };
  const digestInput: JsonValue = {
    schemaVersion: "codex-evidence/v1",
    identity: {
      traceId: bundle.identity.traceId,
      rolloutId: bundle.identity.rolloutId,
      rootThreadId: bundle.identity.rootThreadId,
      targetThreadId: lifecycle.targetThreadId,
      ...(lifecycle.targetTurnId === undefined
        ? {}
        : { targetTurnId: lifecycle.targetTurnId }),
    },
    watermark: lifecycle.watermark,
    contentDigests,
  };
  const observedThroughUnixMs =
    bundle.events.find(
      (event) => event.seq === lifecycle.watermark.toSeqInclusive,
    )?.wallTimeUnixMs ?? bundle.manifest.started_at_unix_ms;
  const eventLogBytes = attemptEvents.reduce(
    (sum, event) => sum + event.byteLength,
    0,
  );
  const payloadBytes = payloads.reduce(
    (sum, payload) => sum + payload.byteLength,
    0,
  );

  return {
    schemaVersion: "codex-evidence/v1",
    identity: {
      traceId: bundle.identity.traceId,
      rolloutId: bundle.identity.rolloutId,
      rootThreadId: bundle.identity.rootThreadId,
      targetThreadId: lifecycle.targetThreadId,
      ...(lifecycle.targetTurnId === undefined
        ? {}
        : { targetTurnId: lifecycle.targetTurnId }),
    },
    watermark: lifecycle.watermark,
    completeness: lifecycle.completeness,
    hardScoreEligible: lifecycle.hardScoreEligible,
    evidenceDigest: sha256(canonicalJson(digestInput)),
    artifactReference: input.artifactReference,
    counts: {
      events: attemptEvents.length,
      payloadBytes: payloads.reduce(
        (sum, payload) => sum + payload.byteLength,
        0,
      ),
      payloads: payloads.length,
      warnings: lifecycleWarnings.length,
    },
    byteSizes: {
      manifest: bundle.byteLengths.manifest,
      eventLog: eventLogBytes,
      payloads: payloadBytes,
      total: bundle.byteLengths.manifest + eventLogBytes + payloadBytes,
    },
    eventTypeCounts: Object.fromEntries(
      Object.entries(lifecycle.eventTypeCounts).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    validationReasons,
    lifecycleWarnings,
    contentDigests,
    capture: {
      startedAtUnixMs: bundle.manifest.started_at_unix_ms,
      observedThroughUnixMs,
      collectedAtUnixMs: input.collectedAtUnixMs,
    },
  };
}

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function compareReasons(
  left: CodexEvidenceValidationReason,
  right: CodexEvidenceValidationReason,
): number {
  return (
    left.code.localeCompare(right.code) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    (left.seq ?? 0) - (right.seq ?? 0) ||
    (left.field ?? "").localeCompare(right.field ?? "")
  );
}

function firstReference(references: number[]): number {
  return Math.min(...references);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
