/** Path-safe, bounded reader for native Codex rollout trace bundles. */
import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import {
  CODEX_ROLLOUT_EVENT_VERSION,
  CODEX_ROLLOUT_MANIFEST_VERSION,
  DEFAULT_CODEX_ROLLOUT_READER_LIMITS,
  KNOWN_CODEX_ROLLOUT_EVENT_TYPES,
  isJsonObject,
  validateCodexEventPayloadV1,
  type CodexEvidenceValidationReason,
  type CodexEvidenceValidationReasonCode,
  type CodexRawPayloadRef,
  type CodexRolloutIdentity,
  type CodexRolloutManifestV1,
  type CodexRolloutReaderLimits,
  type CodexValidatedPayload,
  type CodexValidatedRolloutEvent,
  type JsonValue,
} from "./codex-rollout-schema.ts";

export interface CodexRolloutBundleInvalid {
  ok: false;
  hardScoreEligible: false;
  reasons: CodexEvidenceValidationReason[];
}

export interface CodexRolloutBundle {
  ok: true;
  bundleDirectory: string;
  manifest: CodexRolloutManifestV1;
  identity: CodexRolloutIdentity;
  events: CodexValidatedRolloutEvent[];
  payloads: CodexValidatedPayload[];
  sequenceWatermark: number;
  hardScoreEligible: boolean;
  reasons: CodexEvidenceValidationReason[];
  byteLengths: {
    manifest: number;
    eventLog: number;
    payloads: number;
    total: number;
  };
  contentDigests: {
    manifestSha256: string;
    eventLogSha256: string;
  };
}

export type CodexRolloutBundleReadResult =
  | CodexRolloutBundle
  | CodexRolloutBundleInvalid;

export type CodexRolloutReaderOptions = Partial<CodexRolloutReaderLimits> & {
  supportedOtherEventKinds?: ReadonlySet<string>;
};

export interface CodexRolloutFilesystem {
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<{ size: number; isFile: boolean }>;
  readFile(path: string): Promise<Uint8Array>;
}

export const nodeCodexRolloutFilesystem: CodexRolloutFilesystem = {
  realpath: (path) => nodeFs.realpath(path),
  stat: async (path) => {
    const value = await nodeFs.stat(path);
    return { size: value.size, isFile: value.isFile() };
  },
  readFile: (path) => nodeFs.readFile(path),
};

export const DEFAULT_SUPPORTED_CODEX_OTHER_EVENT_KINDS: ReadonlySet<string> =
  new Set();

interface BoundedFile {
  bytes: Buffer;
  realPath: string;
}

export type CodexRolloutSpineResult =
  | {
      ok: true;
      manifest: CodexRolloutManifestV1;
      identity: CodexRolloutIdentity;
      events: CodexValidatedRolloutEvent[];
      reasons: CodexEvidenceValidationReason[];
    }
  | {
      ok: false;
      reasons: CodexEvidenceValidationReason[];
    };

/** Pure manifest + JSONL parser used by both local and remote filesystem adapters. */
export function parseCodexRolloutSpine(
  input: {
    manifestBytes: Uint8Array;
    eventLogBytes: Uint8Array;
    /** Internal fast path for bytes already validated to select trace.jsonl. */
    validatedManifest?: CodexRolloutManifestV1;
  },
  options: CodexRolloutReaderOptions = {},
): CodexRolloutSpineResult {
  const { supportedOtherEventKinds, ...limitOverrides } = options;
  const limits = { ...DEFAULT_CODEX_ROLLOUT_READER_LIMITS, ...limitOverrides };
  const reasons: CodexEvidenceValidationReason[] = [];
  const manifestBytes = Buffer.from(input.manifestBytes);
  const eventLogBytes = Buffer.from(input.eventLogBytes);
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    addReason(reasons, "MANIFEST_TOO_LARGE");
    return { ok: false, reasons };
  }
  if (eventLogBytes.byteLength > limits.maxEventLogBytes) {
    addReason(reasons, "EVENT_LOG_TOO_LARGE");
    return { ok: false, reasons };
  }
  if (manifestBytes.byteLength + eventLogBytes.byteLength > limits.maxTotalBytes) {
    addReason(reasons, "BUNDLE_TOO_LARGE");
    return { ok: false, reasons };
  }
  let manifest = input.validatedManifest;
  if (!manifest) {
    let manifestValue: unknown;
    try {
      manifestValue = JSON.parse(manifestBytes.toString("utf8"));
    } catch {
      addReason(reasons, "MANIFEST_MALFORMED");
      return { ok: false, reasons };
    }
    manifest = validateManifest(manifestValue, reasons);
    if (!manifest) return { ok: false, reasons };
  }

  const eventLogText = eventLogBytes.toString("utf8");
  const newlineComplete = eventLogText.length === 0 || eventLogText.endsWith("\n");
  const rawLines = eventLogText.endsWith("\n")
    ? eventLogText.slice(0, -1).split("\n")
    : eventLogText.split("\n");
  if (!newlineComplete) {
    const line = rawLines.length;
    let seq = line;
    try {
      const tail = JSON.parse(rawLines.at(-1) ?? "");
      if (
        isJsonObject(tail) &&
        typeof tail.seq === "number" &&
        Number.isSafeInteger(tail.seq)
      ) {
        seq = tail.seq;
      }
    } catch {
      // The expected contiguous seq is the line number when the tail is partial.
    }
    addReason(reasons, "EVENT_LOG_NOT_NEWLINE_COMPLETE", { line, seq });
  }
  if (rawLines.length > limits.maxEvents) {
    addReason(reasons, "EVENT_COUNT_LIMIT_EXCEEDED");
    return { ok: false, reasons };
  }

  const identity: CodexRolloutIdentity = {
    traceId: manifest.trace_id,
    rolloutId: manifest.rollout_id,
    rootThreadId: manifest.root_thread_id,
  };
  const events: CodexValidatedRolloutEvent[] = [];
  let expectedSeq = 1;
  let sawRolloutStart = false;
  for (const [lineIndex, rawLine] of rawLines.entries()) {
    const line = lineIndex + 1;
    let rawEvent: unknown;
    try {
      rawEvent = JSON.parse(rawLine);
    } catch {
      addReason(reasons, "EVENT_MALFORMED", { line, seq: expectedSeq });
      continue;
    }
    const event = validateEventEnvelope(rawEvent, rawLine, line, reasons);
    if (!event) continue;
    if (event.seq !== expectedSeq) {
      addReason(reasons, "EVENT_SEQUENCE_NONCONTIGUOUS", {
        line,
        seq: event.seq,
      });
    }
    expectedSeq = event.seq + 1;
    validateEventIdentity(event, identity, line, reasons);
    if (event.type === "rollout_started") sawRolloutStart = true;
    if (!event.knownType) {
      addReason(reasons, "EVENT_TYPE_UNSUPPORTED", {
        severity: "warning",
        line,
        seq: event.seq,
      });
    } else if (
      event.type === "other" &&
      typeof event.payload.kind === "string" &&
      !(supportedOtherEventKinds ?? DEFAULT_SUPPORTED_CODEX_OTHER_EVENT_KINDS).has(
        event.payload.kind,
      )
    ) {
      addReason(reasons, "EVENT_OTHER_KIND_UNSUPPORTED", {
        severity: "warning",
        line,
        seq: event.seq,
      });
    }
    events.push(event);
  }
  if (!sawRolloutStart) addReason(reasons, "ROLLOUT_START_MISSING");
  if (reasons.some((reason) => reason.severity === "error")) {
    return { ok: false, reasons };
  }
  return { ok: true, manifest, identity, events, reasons };
}

export async function readCodexRolloutBundle(
  bundleDirectory: string,
  options: CodexRolloutReaderOptions = {},
  filesystem: CodexRolloutFilesystem = nodeCodexRolloutFilesystem,
): Promise<CodexRolloutBundleReadResult> {
  const { supportedOtherEventKinds, ...limitOverrides } = options;
  const limits = { ...DEFAULT_CODEX_ROLLOUT_READER_LIMITS, ...limitOverrides };
  const reasons: CodexEvidenceValidationReason[] = [];
  const invalid = (): CodexRolloutBundleInvalid => ({
    ok: false,
    hardScoreEligible: false,
    reasons,
  });

  let bundleRealPath: string;
  try {
    bundleRealPath = await filesystem.realpath(bundleDirectory);
  } catch {
    addReason(reasons, "MANIFEST_MISSING");
    return invalid();
  }

  const manifestFile = await readConfinedFile({
    filesystem,
    parentRealPath: bundleRealPath,
    candidatePath: resolve(bundleRealPath, "manifest.json"),
    maxBytes: limits.maxManifestBytes,
    reasons,
    missingCode: "MANIFEST_MISSING",
    tooLargeCode: "MANIFEST_TOO_LARGE",
    escapeCode: "MANIFEST_PATH_ESCAPE",
  });
  if (!manifestFile) return invalid();
  if (manifestFile.bytes.byteLength > limits.maxTotalBytes) {
    addReason(reasons, "BUNDLE_TOO_LARGE");
    return invalid();
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestFile.bytes.toString("utf8"));
  } catch {
    addReason(reasons, "MANIFEST_MALFORMED");
    return invalid();
  }
  const manifest = validateManifest(manifestValue, reasons);
  if (!manifest) return invalid();

  const eventLogRelativePath = normalizeRelativePath(manifest.raw_event_log);
  const payloadDirectoryRelativePath = normalizeRelativePath(
    manifest.payloads_dir,
  );
  if (!eventLogRelativePath) {
    addReason(reasons, "MANIFEST_PATH_ESCAPE", {
      field: "raw_event_log",
    });
  }
  if (!payloadDirectoryRelativePath) {
    addReason(reasons, "MANIFEST_PATH_ESCAPE", { field: "payloads_dir" });
  }
  if (!eventLogRelativePath || !payloadDirectoryRelativePath) return invalid();

  const eventLogFile = await readConfinedFile({
    filesystem,
    parentRealPath: bundleRealPath,
    candidatePath: resolve(bundleRealPath, eventLogRelativePath),
    maxBytes: limits.maxEventLogBytes,
    reasons,
    missingCode: "EVENT_LOG_MISSING",
    tooLargeCode: "EVENT_LOG_TOO_LARGE",
    escapeCode: "MANIFEST_PATH_ESCAPE",
    field: "raw_event_log",
  });
  if (!eventLogFile) return invalid();
  let totalBytes = manifestFile.bytes.byteLength + eventLogFile.bytes.byteLength;
  if (totalBytes > limits.maxTotalBytes) {
    addReason(reasons, "BUNDLE_TOO_LARGE");
    return invalid();
  }

  const spine = parseCodexRolloutSpine(
    {
      manifestBytes: manifestFile.bytes,
      eventLogBytes: eventLogFile.bytes,
      validatedManifest: manifest,
    },
    { ...limits, supportedOtherEventKinds },
  );
  reasons.push(...spine.reasons);
  if (!spine.ok) return invalid();
  const { identity, events } = spine;

  const uniqueRefs = new Map<
    string,
    { ref: CodexRawPayloadRef; referencedBySeqs: number[] }
  >();
  for (const event of events) {
    for (const ref of event.payloadRefs) {
      const prior = uniqueRefs.get(ref.rawPayloadId);
      if (!prior) {
        uniqueRefs.set(ref.rawPayloadId, {
          ref,
          referencedBySeqs: [event.seq],
        });
        continue;
      }
      if (
        prior.ref.path !== ref.path ||
        !jsonValuesEqual(prior.ref.kind, ref.kind)
      ) {
        addReason(reasons, "PAYLOAD_REFERENCE_CONFLICT", { seq: event.seq });
      } else if (!prior.referencedBySeqs.includes(event.seq)) {
        prior.referencedBySeqs.push(event.seq);
      }
    }
  }
  if (uniqueRefs.size > limits.maxPayloads) {
    addReason(reasons, "PAYLOAD_COUNT_LIMIT_EXCEEDED");
    return invalid();
  }

  let payloadRootRealPath: string;
  const payloadRootPath = resolve(bundleRealPath, payloadDirectoryRelativePath);
  if (!isWithin(bundleRealPath, payloadRootPath)) {
    addReason(reasons, "MANIFEST_PATH_ESCAPE", { field: "payloads_dir" });
    return invalid();
  }
  try {
    payloadRootRealPath = await filesystem.realpath(payloadRootPath);
    if (!isWithin(bundleRealPath, payloadRootRealPath)) {
      addReason(reasons, "MANIFEST_PATH_ESCAPE", { field: "payloads_dir" });
      return invalid();
    }
  } catch {
    payloadRootRealPath = payloadRootPath;
  }

  const payloads: CodexValidatedPayload[] = [];
  for (const { ref, referencedBySeqs } of uniqueRefs.values()) {
    const seq = referencedBySeqs[0]!;

    const normalizedPayloadPath = normalizeRelativePath(ref.path);
    if (!normalizedPayloadPath) {
      addReason(reasons, "PAYLOAD_PATH_ESCAPE", { seq });
      continue;
    }
    const payloadPath = resolve(bundleRealPath, normalizedPayloadPath);
    if (!isWithin(payloadRootPath, payloadPath)) {
      addReason(reasons, "PAYLOAD_PATH_ESCAPE", { seq });
      continue;
    }

    let payloadRealPath: string;
    try {
      payloadRealPath = await filesystem.realpath(payloadPath);
    } catch {
      addReason(reasons, "PAYLOAD_MISSING", { seq });
      continue;
    }
    if (!isWithin(payloadRootRealPath, payloadRealPath)) {
      addReason(reasons, "PAYLOAD_SYMLINK_ESCAPE", { seq });
      continue;
    }

    const payloadStat = await filesystem.stat(payloadRealPath);
    if (!payloadStat.isFile) {
      addReason(reasons, "PAYLOAD_MISSING", { seq });
      continue;
    }
    if (payloadStat.size > limits.maxPayloadBytes) {
      addReason(reasons, "PAYLOAD_TOO_LARGE", { seq });
      continue;
    }
    if (totalBytes + payloadStat.size > limits.maxTotalBytes) {
      addReason(reasons, "BUNDLE_TOO_LARGE", { seq });
      break;
    }
    const payloadBytes = Buffer.from(await filesystem.readFile(payloadRealPath));
    if (payloadBytes.byteLength > limits.maxPayloadBytes) {
      addReason(reasons, "PAYLOAD_TOO_LARGE", { seq });
      continue;
    }
    if (totalBytes + payloadBytes.byteLength > limits.maxTotalBytes) {
      addReason(reasons, "BUNDLE_TOO_LARGE", { seq });
      break;
    }
    totalBytes += payloadBytes.byteLength;
    let payloadValue: unknown;
    try {
      payloadValue = JSON.parse(payloadBytes.toString("utf8"));
    } catch {
      addReason(reasons, "PAYLOAD_MALFORMED", { seq });
      continue;
    }
    if (!isJsonValue(payloadValue)) {
      addReason(reasons, "PAYLOAD_MALFORMED", { seq });
      continue;
    }
    const payload: CodexValidatedPayload = {
      rawPayloadId: ref.rawPayloadId,
      kind: ref.kind,
      path: ref.path,
      value: payloadValue,
      referencedBySeqs,
      byteLength: payloadBytes.byteLength,
      sha256: sha256(payloadBytes),
    };
    payloads.push(payload);
  }

  if (reasons.some((reason) => reason.severity === "error")) return invalid();
  return {
    ok: true,
    bundleDirectory: bundleRealPath,
    manifest,
    identity,
    events,
    payloads,
    sequenceWatermark: events.at(-1)?.seq ?? 0,
    hardScoreEligible: !reasons.some(
      (reason) =>
        reason.code === "EVENT_TYPE_UNSUPPORTED" ||
        reason.code === "EVENT_OTHER_KIND_UNSUPPORTED",
    ),
    reasons,
    byteLengths: {
      manifest: manifestFile.bytes.byteLength,
      eventLog: eventLogFile.bytes.byteLength,
      payloads: payloads.reduce(
        (sum, payload) => sum + payload.byteLength,
        0,
      ),
      total: totalBytes,
    },
    contentDigests: {
      manifestSha256: sha256(manifestFile.bytes),
      eventLogSha256: sha256(eventLogFile.bytes),
    },
  };
}

function validateManifest(
  value: unknown,
  reasons: CodexEvidenceValidationReason[],
): CodexRolloutManifestV1 | undefined {
  if (!isJsonObject(value)) {
    addReason(reasons, "MANIFEST_MALFORMED");
    return undefined;
  }
  if (value.schema_version !== CODEX_ROLLOUT_MANIFEST_VERSION) {
    addReason(reasons, "MANIFEST_VERSION_UNSUPPORTED");
    return undefined;
  }
  const stringFields = [
    "trace_id",
    "rollout_id",
    "root_thread_id",
    "raw_event_log",
    "payloads_dir",
  ] as const;
  for (const field of stringFields) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      addReason(reasons, "MANIFEST_FIELD_INVALID", { field });
    }
  }
  if (value.raw_event_log !== "trace.jsonl") {
    addReason(reasons, "MANIFEST_FIELD_INVALID", { field: "raw_event_log" });
  }
  if (value.payloads_dir !== "payloads") {
    addReason(reasons, "MANIFEST_FIELD_INVALID", { field: "payloads_dir" });
  }
  if (
    typeof value.started_at_unix_ms !== "number" ||
    !Number.isSafeInteger(value.started_at_unix_ms)
  ) {
    addReason(reasons, "MANIFEST_FIELD_INVALID", {
      field: "started_at_unix_ms",
    });
  }
  if (reasons.some((reason) => reason.severity === "error")) return undefined;
  return value as unknown as CodexRolloutManifestV1;
}

function validateEventEnvelope(
  value: unknown,
  rawLine: string,
  line: number,
  reasons: CodexEvidenceValidationReason[],
): CodexValidatedRolloutEvent | undefined {
  if (!isJsonObject(value)) {
    addReason(reasons, "EVENT_ENVELOPE_INVALID", { line });
    return undefined;
  }
  if (value.schema_version !== CODEX_ROLLOUT_EVENT_VERSION) {
    addReason(reasons, "EVENT_VERSION_UNSUPPORTED", { line });
    return undefined;
  }
  const payload = value.payload;
  if (
    !Number.isSafeInteger(value.seq) ||
    typeof value.seq !== "number" ||
    value.seq < 1 ||
    !Number.isSafeInteger(value.wall_time_unix_ms) ||
    typeof value.wall_time_unix_ms !== "number" ||
    typeof value.rollout_id !== "string" ||
    !isNullableString(value.thread_id) ||
    !isNullableString(value.codex_turn_id) ||
    !isJsonObject(payload) ||
    typeof payload.type !== "string"
  ) {
    addReason(reasons, "EVENT_ENVELOPE_INVALID", { line });
    return undefined;
  }
  const seq = value.seq;
  const payloadValidation = validateCodexEventPayloadV1(payload);
  for (const reason of payloadValidation.reasons) {
    reasons.push({ ...reason, line, seq });
  }
  const payloadRefs = collectPayloadRefs(payload, seq, line, reasons);
  return {
    schemaVersion: 1,
    seq,
    wallTimeUnixMs: value.wall_time_unix_ms,
    rolloutId: value.rollout_id,
    threadId: value.thread_id,
    codexTurnId: value.codex_turn_id,
    type: payload.type,
    knownType: KNOWN_CODEX_ROLLOUT_EVENT_TYPES.has(payload.type),
    payload,
    payloadRefs,
    byteLength: Buffer.byteLength(rawLine, "utf8") + 1,
    rawLineSha256: sha256(`${rawLine}\n`),
  };
}

function validateEventIdentity(
  event: CodexValidatedRolloutEvent,
  identity: CodexRolloutIdentity,
  line: number,
  reasons: CodexEvidenceValidationReason[],
): void {
  if (event.rolloutId !== identity.rolloutId) {
    addReason(reasons, "EVENT_ROLLOUT_ID_MISMATCH", {
      line,
      seq: event.seq,
    });
  }
  if (event.type === "rollout_started") {
    if (event.payload.trace_id !== identity.traceId) {
      addReason(reasons, "EVENT_TRACE_ID_MISMATCH", {
        line,
        seq: event.seq,
      });
    }
    if (event.payload.root_thread_id !== identity.rootThreadId) {
      addReason(reasons, "EVENT_ROOT_THREAD_ID_MISMATCH", {
        line,
        seq: event.seq,
      });
    }
  }

  const payloadThreadId = identityFieldForEvent(event, "thread_id");
  if (
    event.threadId !== null &&
    payloadThreadId !== undefined &&
    payloadThreadId !== event.threadId
  ) {
    addReason(reasons, "EVENT_THREAD_ID_MISMATCH", {
      line,
      seq: event.seq,
    });
  }
  const payloadTurnId = identityFieldForEvent(event, "codex_turn_id");
  if (
    event.codexTurnId !== null &&
    payloadTurnId !== undefined &&
    payloadTurnId !== event.codexTurnId
  ) {
    addReason(reasons, "EVENT_TURN_ID_MISMATCH", {
      line,
      seq: event.seq,
    });
  }
}

function identityFieldForEvent(
  event: CodexValidatedRolloutEvent,
  field: "thread_id" | "codex_turn_id",
): string | undefined {
  const value = event.payload[field];
  return typeof value === "string" ? value : undefined;
}

function collectPayloadRefs(
  value: JsonValue,
  seq: number,
  line: number,
  reasons: CodexEvidenceValidationReason[],
): CodexRawPayloadRef[] {
  const refs: CodexRawPayloadRef[] = [];
  const seen = new Set<string>();
  const visit = (candidate: JsonValue): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }
    if (!isJsonObject(candidate)) return;
    const refShaped = "raw_payload_id" in candidate || "path" in candidate;
    if (refShaped) {
      if (
        typeof candidate.raw_payload_id !== "string" ||
        candidate.raw_payload_id.length === 0 ||
        typeof candidate.path !== "string" ||
        candidate.path.length === 0 ||
        !isJsonObject(candidate.kind) ||
        typeof candidate.kind.type !== "string"
      ) {
        addReason(reasons, "PAYLOAD_REFERENCE_MALFORMED", { line, seq });
      } else {
        const key = `${candidate.raw_payload_id}\u0000${candidate.path}\u0000${JSON.stringify(candidate.kind)}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({
            rawPayloadId: candidate.raw_payload_id,
            kind: candidate.kind,
            path: candidate.path,
          });
        }
      }
    }
    for (const nested of Object.values(candidate)) visit(nested);
  };
  visit(value);
  return refs;
}

async function readConfinedFile(input: {
  filesystem: CodexRolloutFilesystem;
  parentRealPath: string;
  candidatePath: string;
  maxBytes: number;
  reasons: CodexEvidenceValidationReason[];
  missingCode: CodexEvidenceValidationReasonCode;
  tooLargeCode: CodexEvidenceValidationReasonCode;
  escapeCode: CodexEvidenceValidationReasonCode;
  field?: string;
}): Promise<BoundedFile | undefined> {
  if (!isWithin(input.parentRealPath, input.candidatePath)) {
    addReason(input.reasons, input.escapeCode, { field: input.field });
    return undefined;
  }
  let fileRealPath: string;
  try {
    fileRealPath = await input.filesystem.realpath(input.candidatePath);
  } catch {
    addReason(input.reasons, input.missingCode, { field: input.field });
    return undefined;
  }
  if (!isWithin(input.parentRealPath, fileRealPath)) {
    addReason(input.reasons, input.escapeCode, { field: input.field });
    return undefined;
  }
  const fileStat = await input.filesystem.stat(fileRealPath);
  if (!fileStat.isFile) {
    addReason(input.reasons, input.missingCode, { field: input.field });
    return undefined;
  }
  if (fileStat.size > input.maxBytes) {
    addReason(input.reasons, input.tooLargeCode, { field: input.field });
    return undefined;
  }
  const bytes = Buffer.from(await input.filesystem.readFile(fileRealPath));
  if (bytes.byteLength > input.maxBytes) {
    addReason(input.reasons, input.tooLargeCode, { field: input.field });
    return undefined;
  }
  return { bytes, realPath: fileRealPath };
}

function normalizeRelativePath(value: string): string | undefined {
  if (
    value.includes("\u0000") ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    return undefined;
  }
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return undefined;
  }
  return normalized;
}

function isWithin(parentPath: string, candidatePath: string): boolean {
  const pathFromParent = relative(parentPath, candidatePath);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathFromParent))
  );
}

function isNullableString(value: JsonValue | undefined): value is string | null {
  return value === null || typeof value === "string";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value) && Object.values(value).every(isJsonValue);
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function addReason(
  reasons: CodexEvidenceValidationReason[],
  code: CodexEvidenceValidationReasonCode,
  context: Omit<CodexEvidenceValidationReason, "code" | "severity"> & {
    severity?: CodexEvidenceValidationReason["severity"];
  } = {},
): void {
  reasons.push({
    code,
    severity: context.severity ?? "error",
    ...(context.line === undefined ? {} : { line: context.line }),
    ...(context.seq === undefined ? {} : { seq: context.seq }),
    ...(context.field === undefined ? {} : { field: context.field }),
  });
}
