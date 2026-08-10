/** Deterministic lifecycle reduction over a structurally validated rollout. */
import type {
  CodexRolloutBundle,
} from "./codex-rollout-reader.ts";
import type {
  CodexEvidenceValidationReason,
  CodexValidatedRolloutEvent,
} from "./codex-rollout-schema.ts";

export interface CodexAttemptCursor {
  traceId: string;
  rolloutId: string;
  rootThreadId: string;
  afterSeqExclusive: number;
}

export interface CodexLifecycleOptions {
  traceId?: string;
  rolloutId?: string;
  rootThreadId?: string;
  afterSeqExclusive?: number;
  toSeqInclusive?: number;
  targetTurnId?: string;
}

export type CodexRolloutCompleteness =
  | "invalid"
  | "collecting"
  | "turn_complete"
  | "rollout_complete";

export type CodexOpenRuntimeKind =
  | "code_cell"
  | "compaction_request"
  | "inference"
  | "terminal_session"
  | "tool_call";

export interface CodexOpenRuntimeObject {
  kind: CodexOpenRuntimeKind;
  id: string;
  startedSeq: number;
}

export interface CodexLifecycleWarning extends CodexOpenRuntimeObject {
  code: "OPEN_RUNTIME_OBJECT";
}

export interface CodexRolloutLifecycle {
  completeness: CodexRolloutCompleteness;
  hardScoreEligible: boolean;
  targetThreadId: string;
  targetTurnId?: string;
  targetTurnTerminalSeq?: number;
  rootTerminalSeq?: number;
  watermark: {
    afterSeqExclusive: number;
    toSeqInclusive: number;
  };
  openRuntimeObjects: CodexOpenRuntimeObject[];
  warnings: CodexLifecycleWarning[];
  eventTypeCounts: Record<string, number>;
  reasons: CodexEvidenceValidationReason[];
}

export function createCodexAttemptCursor(
  bundle: CodexRolloutBundle,
): CodexAttemptCursor {
  return {
    traceId: bundle.identity.traceId,
    rolloutId: bundle.identity.rolloutId,
    rootThreadId: bundle.identity.rootThreadId,
    afterSeqExclusive: bundle.sequenceWatermark,
  };
}

export function reduceCodexRolloutLifecycle(
  bundle: CodexRolloutBundle,
  options: CodexLifecycleOptions = {},
): CodexRolloutLifecycle {
  const afterSeqExclusive = options.afterSeqExclusive ?? 0;
  const toSeqInclusive = Math.min(
    options.toSeqInclusive ?? bundle.sequenceWatermark,
    bundle.sequenceWatermark,
  );
  const attemptEvents = bundle.events.filter(
    (event) =>
      event.seq > afterSeqExclusive && event.seq <= toSeqInclusive,
  );
  const observedEvents = bundle.events.filter(
    (event) => event.seq <= toSeqInclusive,
  );
  const cursorIdentityValid =
    (options.traceId === undefined ||
      options.traceId === bundle.identity.traceId) &&
    (options.rolloutId === undefined ||
      options.rolloutId === bundle.identity.rolloutId) &&
    (options.rootThreadId === undefined ||
      options.rootThreadId === bundle.identity.rootThreadId);
  const reasons = bundle.reasons.filter(
    (reason) =>
      reason.seq === undefined ||
      (reason.seq > afterSeqExclusive && reason.seq <= toSeqInclusive),
  );
  if (!cursorIdentityValid) {
    reasons.push({
      code: "ATTEMPT_CURSOR_IDENTITY_MISMATCH",
      severity: "error",
    });
  }

  const rootTurnStarts = attemptEvents.filter(
    (event) =>
      event.type === "codex_turn_started" &&
      event.payload.thread_id === bundle.identity.rootThreadId,
  );
  const targetTurnId =
    options.targetTurnId ??
    stringField(rootTurnStarts.at(-1), "codex_turn_id") ??
    undefined;
  const targetTurnStart = targetTurnId
    ? rootTurnStarts.find(
        (event) => stringField(event, "codex_turn_id") === targetTurnId,
      )
    : undefined;
  const targetTurnEndEvent = targetTurnId
    ? attemptEvents.find(
        (event) =>
          event.type === "codex_turn_ended" &&
          event.threadId === bundle.identity.rootThreadId &&
          stringField(event, "codex_turn_id") === targetTurnId,
      )
    : undefined;
  const turnTerminal =
    targetTurnEndEvent && hasTerminalExecutionStatus(targetTurnEndEvent)
      ? targetTurnEndEvent
      : undefined;
  const rolloutEndEvent = attemptEvents.find(
    (event) => event.type === "rollout_ended",
  );
  const rootTerminal =
    rolloutEndEvent && hasTerminalRolloutStatus(rolloutEndEvent)
      ? rolloutEndEvent
      : undefined;
  const threadTerminals = attemptEvents.filter(
    (event) => event.type === "thread_ended",
  );
  const rootThreadEndEvent = threadTerminals.find(
    (event) =>
      stringField(event, "thread_id") === bundle.identity.rootThreadId,
  );
  const rootThreadTerminal =
    rootThreadEndEvent && hasTerminalRolloutStatus(rootThreadEndEvent)
      ? rootThreadEndEvent
      : undefined;

  if (targetTurnEndEvent && !turnTerminal) {
    reasons.push({
      code: "TARGET_TURN_TERMINAL_STATUS_INVALID",
      severity: "error",
      seq: targetTurnEndEvent.seq,
    });
  }
  if (rootThreadEndEvent && !rootThreadTerminal) {
    reasons.push({
      code: "ROOT_THREAD_TERMINAL_STATUS_INVALID",
      severity: "error",
      seq: rootThreadEndEvent.seq,
    });
  }
  if (rolloutEndEvent && !rootTerminal) {
    reasons.push({
      code: "ROLLOUT_TERMINAL_STATUS_INVALID",
      severity: "error",
      seq: rolloutEndEvent.seq,
    });
  }

  const turnPaired =
    targetTurnStart !== undefined &&
    turnTerminal !== undefined &&
    targetTurnStart.seq < turnTerminal.seq;
  if (rootTerminal) {
    if (!targetTurnStart) {
      reasons.push({
        code: "TARGET_TURN_START_MISSING",
        severity: "error",
        seq: rootTerminal.seq,
      });
    } else if (!targetTurnEndEvent) {
      reasons.push({
        code: "TARGET_TURN_END_MISSING",
        severity: "error",
        seq: targetTurnStart.seq,
      });
    } else if (
      turnTerminal &&
      (targetTurnStart.seq >= turnTerminal.seq ||
        turnTerminal.seq >= rootTerminal.seq ||
        (rootThreadEndEvent !== undefined &&
          turnTerminal.seq >= rootThreadEndEvent.seq))
    ) {
      reasons.push({
        code: "TARGET_TURN_ORDER_INVALID",
        severity: "error",
        seq: turnTerminal.seq,
      });
    }

    if (!rootThreadEndEvent) {
      reasons.push({
        code:
          threadTerminals.length > 0
            ? "ROOT_THREAD_ID_MISMATCH"
            : "ROOT_THREAD_END_MISSING",
        severity: "error",
        seq: rootTerminal.seq,
      });
    } else if (
      rootThreadTerminal &&
      rootThreadTerminal.seq >= rootTerminal.seq
    ) {
      reasons.push({
        code: "ROOT_THREAD_END_ORDER_INVALID",
        severity: "error",
        seq: rootThreadTerminal.seq,
      });
    }
  }

  const completeness: CodexRolloutCompleteness = !cursorIdentityValid
    ? "invalid"
    : rootTerminal
      ? "rollout_complete"
      : turnPaired
        ? "turn_complete"
        : "collecting";
  const openRuntimeObjects = reduceOpenRuntimeObjects(bundle, observedEvents);
  const eventTypeCounts = Object.fromEntries(
    [...countBy(attemptEvents, (event) => event.type).entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );

  return {
    completeness,
    hardScoreEligible:
      completeness === "rollout_complete" &&
      turnPaired &&
      rootThreadTerminal !== undefined &&
      rootTerminal !== undefined &&
      turnTerminal !== undefined &&
      turnTerminal.seq < rootThreadTerminal.seq &&
      rootThreadTerminal.seq < rootTerminal.seq &&
      !reasons.some(
        (reason) =>
          reason.severity === "error" ||
          reason.code === "EVENT_TYPE_UNSUPPORTED" ||
          reason.code === "EVENT_OTHER_KIND_UNSUPPORTED",
      ),
    targetThreadId: bundle.identity.rootThreadId,
    ...(targetTurnId === undefined ? {} : { targetTurnId }),
    ...(turnTerminal === undefined
      ? {}
      : { targetTurnTerminalSeq: turnTerminal.seq }),
    ...(rootTerminal === undefined ? {} : { rootTerminalSeq: rootTerminal.seq }),
    watermark: { afterSeqExclusive, toSeqInclusive },
    openRuntimeObjects,
    warnings: openRuntimeObjects.map((object) => ({
      code: "OPEN_RUNTIME_OBJECT" as const,
      ...object,
    })),
    eventTypeCounts,
    reasons,
  };
}

function reduceOpenRuntimeObjects(
  bundle: CodexRolloutBundle,
  events: CodexValidatedRolloutEvent[],
): CodexOpenRuntimeObject[] {
  const open = new Map<string, CodexOpenRuntimeObject>();
  const start = (
    event: CodexValidatedRolloutEvent,
    kind: CodexOpenRuntimeKind,
    field: string,
  ): void => {
    const id = stringField(event, field);
    if (id) open.set(`${kind}\u0000${id}`, { kind, id, startedSeq: event.seq });
  };
  const end = (
    event: CodexValidatedRolloutEvent,
    kind: CodexOpenRuntimeKind,
    field: string,
  ): void => {
    const id = stringField(event, field);
    if (id) open.delete(`${kind}\u0000${id}`);
  };

  for (const event of events) {
    switch (event.type) {
      case "inference_started":
        start(event, "inference", "inference_call_id");
        break;
      case "inference_completed":
      case "inference_failed":
      case "inference_cancelled":
        end(event, "inference", "inference_call_id");
        break;
      case "tool_call_started":
        start(event, "tool_call", "tool_call_id");
        break;
      case "tool_call_ended":
        end(event, "tool_call", "tool_call_id");
        break;
      case "tool_call_runtime_started":
      case "tool_call_runtime_ended": {
        const payloadRef = event.payload.runtime_payload;
        const rawPayloadId =
          typeof payloadRef === "object" &&
          payloadRef !== null &&
          !Array.isArray(payloadRef) &&
          typeof payloadRef.raw_payload_id === "string"
            ? payloadRef.raw_payload_id
            : undefined;
        const runtimePayload = bundle.payloads.find(
          (payload) => payload.rawPayloadId === rawPayloadId,
        )?.value;
        const terminalId =
          typeof runtimePayload === "object" &&
          runtimePayload !== null &&
          !Array.isArray(runtimePayload) &&
          typeof runtimePayload.process_id === "string"
            ? runtimePayload.process_id
            : undefined;
        if (terminalId) {
          const key = `terminal_session\u0000${terminalId}`;
          if (!open.has(key)) {
            open.set(key, {
              kind: "terminal_session",
              id: terminalId,
              startedSeq: event.seq,
            });
          }
        }
        break;
      }
      case "code_cell_started":
        start(event, "code_cell", "runtime_cell_id");
        break;
      case "code_cell_ended":
        end(event, "code_cell", "runtime_cell_id");
        break;
      case "compaction_request_started":
        start(event, "compaction_request", "compaction_request_id");
        break;
      case "compaction_request_completed":
      case "compaction_request_failed":
        end(event, "compaction_request", "compaction_request_id");
        break;
      default:
        break;
    }
  }

  return [...open.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.startedSeq - right.startedSeq,
  );
}

function stringField(
  event: CodexValidatedRolloutEvent | undefined,
  field: string,
): string | undefined {
  const value = event?.payload[field];
  return typeof value === "string" ? value : undefined;
}

function hasTerminalExecutionStatus(
  event: CodexValidatedRolloutEvent,
): boolean {
  return ["completed", "failed", "cancelled", "aborted"].includes(
    String(event.payload.status),
  );
}

function hasTerminalRolloutStatus(event: CodexValidatedRolloutEvent): boolean {
  return ["completed", "failed", "aborted"].includes(
    String(event.payload.status),
  );
}

function countBy<T>(
  values: T[],
  keyFor: (value: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyFor(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
