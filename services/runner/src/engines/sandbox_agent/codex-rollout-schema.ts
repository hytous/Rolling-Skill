/** Bounded, version-pinned shapes for native Codex rollout trace evidence. */

export const CODEX_ROLLOUT_MANIFEST_VERSION = 1;
export const CODEX_ROLLOUT_EVENT_VERSION = 1;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface CodexRolloutManifestV1 {
  schema_version: 1;
  trace_id: string;
  rollout_id: string;
  root_thread_id: string;
  started_at_unix_ms: number;
  raw_event_log: string;
  payloads_dir: string;
}

export interface CodexRolloutIdentity {
  traceId: string;
  rolloutId: string;
  rootThreadId: string;
}

export type CodexEvidenceValidationReasonCode =
  | "MANIFEST_MISSING"
  | "MANIFEST_TOO_LARGE"
  | "MANIFEST_MALFORMED"
  | "MANIFEST_VERSION_UNSUPPORTED"
  | "MANIFEST_FIELD_INVALID"
  | "MANIFEST_PATH_ESCAPE"
  | "EVENT_LOG_MISSING"
  | "EVENT_LOG_TOO_LARGE"
  | "EVENT_LOG_NOT_NEWLINE_COMPLETE"
  | "EVENT_MALFORMED"
  | "EVENT_ENVELOPE_INVALID"
  | "EVENT_PAYLOAD_INVALID"
  | "EVENT_VERSION_UNSUPPORTED"
  | "EVENT_SEQUENCE_NONCONTIGUOUS"
  | "EVENT_COUNT_LIMIT_EXCEEDED"
  | "EVENT_ROLLOUT_ID_MISMATCH"
  | "EVENT_TRACE_ID_MISMATCH"
  | "EVENT_ROOT_THREAD_ID_MISMATCH"
  | "EVENT_THREAD_ID_MISMATCH"
  | "EVENT_TURN_ID_MISMATCH"
  | "ROLLOUT_START_MISSING"
  | "PAYLOAD_REFERENCE_MALFORMED"
  | "PAYLOAD_REFERENCE_CONFLICT"
  | "PAYLOAD_PATH_ESCAPE"
  | "PAYLOAD_SYMLINK_ESCAPE"
  | "PAYLOAD_MISSING"
  | "PAYLOAD_TOO_LARGE"
  | "PAYLOAD_COUNT_LIMIT_EXCEEDED"
  | "PAYLOAD_MALFORMED"
  | "BUNDLE_TOO_LARGE"
  | "EVENT_TYPE_UNSUPPORTED"
  | "EVENT_OTHER_KIND_UNSUPPORTED"
  | "ATTEMPT_CURSOR_IDENTITY_MISMATCH"
  | "TARGET_TURN_START_MISSING"
  | "TARGET_TURN_END_MISSING"
  | "TARGET_TURN_ORDER_INVALID"
  | "TARGET_TURN_TERMINAL_STATUS_INVALID"
  | "ROOT_THREAD_END_MISSING"
  | "ROOT_THREAD_END_ORDER_INVALID"
  | "ROOT_THREAD_ID_MISMATCH"
  | "ROOT_THREAD_TERMINAL_STATUS_INVALID"
  | "ROLLOUT_TERMINAL_STATUS_INVALID";

export interface CodexEvidenceValidationReason {
  code: CodexEvidenceValidationReasonCode;
  severity: "error" | "warning";
  line?: number;
  seq?: number;
  field?: string;
}

export interface CodexRawPayloadRef {
  rawPayloadId: string;
  kind: JsonValue;
  path: string;
}

export interface CodexValidatedRolloutEvent {
  schemaVersion: 1;
  seq: number;
  wallTimeUnixMs: number;
  rolloutId: string;
  threadId: string | null;
  codexTurnId: string | null;
  type: string;
  knownType: boolean;
  payload: Record<string, JsonValue>;
  payloadRefs: CodexRawPayloadRef[];
  byteLength: number;
  rawLineSha256: string;
}

export interface CodexValidatedPayload {
  rawPayloadId: string;
  kind: JsonValue;
  path: string;
  value: JsonValue;
  referencedBySeqs: number[];
  byteLength: number;
  sha256: string;
}

export interface CodexRolloutReaderLimits {
  maxManifestBytes: number;
  maxEventLogBytes: number;
  maxPayloadBytes: number;
  maxTotalBytes: number;
  maxEvents: number;
  maxPayloads: number;
}

export const DEFAULT_CODEX_ROLLOUT_READER_LIMITS: Readonly<CodexRolloutReaderLimits> = {
  maxManifestBytes: 64 * 1024,
  maxEventLogBytes: 16 * 1024 * 1024,
  maxPayloadBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxEvents: 50_000,
  maxPayloads: 10_000,
};

export const KNOWN_CODEX_ROLLOUT_EVENT_TYPES = new Set([
  "rollout_started",
  "rollout_ended",
  "thread_started",
  "thread_ended",
  "codex_turn_started",
  "codex_turn_ended",
  "inference_started",
  "inference_completed",
  "inference_failed",
  "inference_cancelled",
  "tool_call_started",
  "mcp_tool_call_correlation_assigned",
  "tool_call_runtime_started",
  "tool_call_runtime_ended",
  "tool_call_ended",
  "code_cell_started",
  "code_cell_initial_response",
  "code_cell_ended",
  "compaction_request_started",
  "compaction_request_completed",
  "compaction_request_failed",
  "compaction_installed",
  "agent_result_observed",
  "protocol_event_observed",
  "other",
]);

export function isJsonObject(
  value: unknown,
): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CodexEventPayloadValidationResult {
  ok: boolean;
  reasons: CodexEvidenceValidationReason[];
}

const ROLLOUT_STATUSES = new Set(["running", "completed", "failed", "aborted"]);
const EXECUTION_STATUSES = new Set([
  "running",
  "completed",
  "failed",
  "cancelled",
  "aborted",
]);
const CODE_CELL_STATUSES = new Set([
  "starting",
  "running",
  "yielded",
  "completed",
  "failed",
  "terminated",
]);
const RAW_PAYLOAD_KINDS = new Set([
  "inference_request",
  "inference_response",
  "compaction_request",
  "compaction_checkpoint",
  "compaction_response",
  "tool_invocation",
  "tool_result",
  "tool_runtime_event",
  "terminal_runtime_event",
  "protocol_event",
  "session_metadata",
  "agent_result",
]);

/** Validate the complete serde-discriminated v1 event payload contract. */
export function validateCodexEventPayloadV1(
  payload: unknown,
): CodexEventPayloadValidationResult {
  const reasons: CodexEvidenceValidationReason[] = [];
  const invalid = (field: string): false => {
    if (!reasons.some((reason) => reason.field === field)) {
      reasons.push({
        code: "EVENT_PAYLOAD_INVALID",
        severity: "error",
        field,
      });
    }
    return false;
  };
  if (!isJsonObject(payload) || typeof payload.type !== "string") {
    invalid("payload.type");
    return { ok: false, reasons };
  }

  const string = (field: string): boolean =>
    has(payload, field) && typeof payload[field] === "string"
      ? true
      : invalid(`payload.${field}`);
  const nullableString = (field: string): boolean =>
    has(payload, field) &&
    (payload[field] === null || typeof payload[field] === "string")
      ? true
      : invalid(`payload.${field}`);
  const status = (field: string, values: ReadonlySet<string>): boolean =>
    string(field) && values.has(payload[field] as string)
      ? true
      : invalid(`payload.${field}`);
  const ref = (field: string, nullable = false): boolean => {
    if (!has(payload, field)) return invalid(`payload.${field}`);
    const value = payload[field];
    if (nullable && value === null) return true;
    return isRawPayloadRefV1(value) ? true : invalid(`payload.${field}`);
  };
  const strings = (...fields: string[]): boolean =>
    fields.map(string).every(Boolean);

  switch (payload.type) {
    case "rollout_started":
      strings("trace_id", "root_thread_id");
      break;
    case "rollout_ended":
      status("status", ROLLOUT_STATUSES);
      break;
    case "thread_started":
      strings("thread_id", "agent_path");
      ref("metadata_payload", true);
      break;
    case "thread_ended":
      string("thread_id");
      status("status", ROLLOUT_STATUSES);
      break;
    case "codex_turn_started":
      strings("codex_turn_id", "thread_id");
      break;
    case "codex_turn_ended":
      string("codex_turn_id");
      status("status", EXECUTION_STATUSES);
      break;
    case "inference_started":
      strings(
        "inference_call_id",
        "thread_id",
        "codex_turn_id",
        "model",
        "provider_name",
      );
      ref("request_payload");
      break;
    case "inference_completed":
      string("inference_call_id");
      nullableString("response_id");
      nullableString("upstream_request_id");
      ref("response_payload");
      break;
    case "inference_failed":
      string("inference_call_id");
      nullableString("upstream_request_id");
      string("error");
      ref("partial_response_payload", true);
      break;
    case "inference_cancelled":
      string("inference_call_id");
      nullableString("upstream_request_id");
      string("reason");
      ref("partial_response_payload", true);
      break;
    case "tool_call_started":
      string("tool_call_id");
      nullableString("model_visible_call_id");
      nullableString("code_mode_runtime_tool_id");
      if (!isToolRequesterV1(payload.requester)) invalid("payload.requester");
      if (!isToolKindV1(payload.kind)) invalid("payload.kind");
      if (!isToolSummaryV1(payload.summary)) invalid("payload.summary");
      ref("invocation_payload", true);
      break;
    case "mcp_tool_call_correlation_assigned":
      strings("tool_call_id", "mcp_call_id");
      break;
    case "tool_call_runtime_started":
      string("tool_call_id");
      ref("runtime_payload");
      break;
    case "tool_call_runtime_ended":
      string("tool_call_id");
      status("status", EXECUTION_STATUSES);
      ref("runtime_payload");
      break;
    case "tool_call_ended":
      string("tool_call_id");
      status("status", EXECUTION_STATUSES);
      ref("result_payload", true);
      break;
    case "code_cell_started":
      strings("runtime_cell_id", "model_visible_call_id", "source_js");
      break;
    case "code_cell_initial_response":
    case "code_cell_ended":
      string("runtime_cell_id");
      status("status", CODE_CELL_STATUSES);
      ref("response_payload", true);
      break;
    case "compaction_request_started":
      strings(
        "compaction_id",
        "compaction_request_id",
        "thread_id",
        "codex_turn_id",
        "model",
        "provider_name",
      );
      ref("request_payload");
      break;
    case "compaction_request_completed":
      strings("compaction_id", "compaction_request_id");
      ref("response_payload");
      break;
    case "compaction_request_failed":
      strings("compaction_id", "compaction_request_id", "error");
      break;
    case "compaction_installed":
      string("compaction_id");
      ref("checkpoint_payload");
      break;
    case "agent_result_observed":
      strings(
        "edge_id",
        "child_thread_id",
        "child_codex_turn_id",
        "parent_thread_id",
        "message",
      );
      ref("carried_payload", true);
      break;
    case "protocol_event_observed":
      string("event_type");
      ref("event_payload");
      break;
    case "other":
      strings("kind", "summary");
      if (
        !has(payload, "payloads") ||
        !Array.isArray(payload.payloads) ||
        !payload.payloads.every(isRawPayloadRefV1)
      ) {
        invalid("payload.payloads");
      }
      if (!has(payload, "metadata")) invalid("payload.metadata");
      break;
    default:
      return { ok: true, reasons };
  }
  return { ok: reasons.length === 0, reasons };
}

function has(value: Record<string, JsonValue>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function isRawPayloadRefV1(value: JsonValue | undefined): boolean {
  return (
    isJsonObject(value) &&
    typeof value.raw_payload_id === "string" &&
    typeof value.path === "string" &&
    isJsonObject(value.kind) &&
    typeof value.kind.type === "string" &&
    RAW_PAYLOAD_KINDS.has(value.kind.type)
  );
}

function isToolRequesterV1(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || typeof value.type !== "string") return false;
  return (
    value.type === "model" ||
    (value.type === "code_cell" && typeof value.runtime_cell_id === "string")
  );
}

function isToolKindV1(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || typeof value.type !== "string") return false;
  if (
    [
      "exec_command",
      "write_stdin",
      "apply_patch",
      "web",
      "image_generation",
      "spawn_agent",
      "assign_agent_task",
      "send_message",
      "wait_agent",
      "close_agent",
    ].includes(value.type)
  ) {
    return true;
  }
  if (value.type === "mcp") {
    return typeof value.server === "string" && typeof value.tool === "string";
  }
  return value.type === "other" && typeof value.name === "string";
}

function isToolSummaryV1(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "terminal":
      return typeof value.operation_id === "string";
    case "agent":
      return (
        typeof value.target_agent_path === "string" &&
        (value.task_name === null || typeof value.task_name === "string") &&
        typeof value.message_preview === "string"
      );
    case "wait_agent":
      return (
        (value.target_agent_path === null ||
          typeof value.target_agent_path === "string") &&
        (value.timeout_ms === null ||
          (typeof value.timeout_ms === "number" &&
            Number.isSafeInteger(value.timeout_ms) &&
            value.timeout_ms >= 0))
      );
    case "generic":
      return (
        typeof value.label === "string" &&
        (value.input_preview === null ||
          typeof value.input_preview === "string") &&
        (value.output_preview === null ||
          typeof value.output_preview === "string")
      );
    default:
      return false;
  }
}
