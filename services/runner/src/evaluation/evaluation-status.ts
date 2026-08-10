import type {
  CodexEvidenceValidationReasonCode,
} from "../engines/sandbox_agent/codex-rollout-schema.ts";

/** Explicit status vocabulary shared by attempt and class-level evaluation results. */
export const EVALUATION_STATES = [
  "PASSED",
  "BEHAVIOR_FAILED",
  "INVALID_TRACE",
  "INFRA_RETRYING",
  "RETRY_EXHAUSTED",
  "CANCELLED",
] as const;

export type EvaluationState = (typeof EVALUATION_STATES)[number];
export const B_CLASS_EVALUATION_STATES = ["B_UNSCORED"] as const;
export type BClassEvaluationState =
  (typeof B_CLASS_EVALUATION_STATES)[number];
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type AttemptObservedState =
  | "PASSED"
  | "BEHAVIOR_FAILED"
  | "INVALID_TRACE"
  | "CANCELLED";

export type AutomaticRetryCause =
  | "NONE"
  | "INFRASTRUCTURE"
  | "TRANSIENT_TOOL"
  | "TRACE_COMPLETENESS"
  | "NON_RETRYABLE_TRACE"
  | "DETERMINISTIC_BEHAVIOR"
  | "USER_CANCELLED";

/** Exact infrastructure reasons produced by trusted runner boundaries. */
export const TRUSTED_INFRASTRUCTURE_RETRY_REASONS = [
  "infra.runtime-unavailable",
  "infra.transport-disconnected",
  "infra.timeout",
] as const;

/** Exact completeness reasons emitted by the validated bundle collector. */
export const TRUSTED_TRACE_COMPLETENESS_RETRY_REASONS = [
  "trace.missing",
  "trace.truncated",
  "trace.root-terminal-missing",
  "trace.payload-missing",
] as const;

type TrustedTraceCompletenessRetryReason =
  (typeof TRUSTED_TRACE_COMPLETENESS_RETRY_REASONS)[number];

/**
 * Typed boundary between Codex's native validator vocabulary and the stable
 * retry-policy vocabulary. Omitted native reasons are deliberately non-retryable.
 */
export const NATIVE_VALIDATOR_RETRY_REASON_MAP = {
  MANIFEST_MISSING: "trace.missing",
  EVENT_LOG_MISSING: "trace.missing",
  EVENT_LOG_NOT_NEWLINE_COMPLETE: "trace.truncated",
  PAYLOAD_MISSING: "trace.payload-missing",
  TARGET_TURN_END_MISSING: "trace.root-terminal-missing",
  ROOT_THREAD_END_MISSING: "trace.root-terminal-missing",
} as const satisfies Partial<
  Record<
    CodexEvidenceValidationReasonCode,
    TrustedTraceCompletenessRetryReason
  >
>;

export function normalizeAutomaticRetryReasonCode(reasonCode: string): string {
  return (
    NATIVE_VALIDATOR_RETRY_REASON_MAP[
      reasonCode as keyof typeof NATIVE_VALIDATOR_RETRY_REASON_MAP
    ] ?? reasonCode
  );
}

export interface AutomaticRetryInput {
  observedState: AttemptObservedState;
  reasonCode: string;
  /** Tool reasons declared transient by the selected runtime/tool policy. */
  declaredTransientToolReasonCodes: readonly string[];
  /** One-based number of the attempt being classified. */
  attemptNumber: number;
  /** Total number of attempts, including the current attempt. */
  maxAttempts: number;
}

interface RetryPolicyProvenanceShape {
  classifier: "agenta.retry-policy/v1";
  reasonCode: string;
  /** Exact immutable snapshot used by the classifier for this decision. */
  declaredTransientToolReasonCodes: readonly string[];
}
export type RetryPolicyProvenance = DeepReadonly<RetryPolicyProvenanceShape>;

interface AutomaticRetryDecisionShape {
  observedState: AttemptObservedState;
  state: AttemptObservedState | "INFRA_RETRYING" | "RETRY_EXHAUSTED";
  cause: AutomaticRetryCause;
  retryPolicyProvenance: RetryPolicyProvenance;
  shouldRetry: boolean;
  nextAttemptNumber: number | null;
  reasonCode: string;
}
export type AutomaticRetryDecision = DeepReadonly<AutomaticRetryDecisionShape>;

interface AttemptEvaluationRecordShape {
  attemptNumber: number;
  observedState: AttemptObservedState;
  state: AttemptObservedState | "INFRA_RETRYING" | "RETRY_EXHAUSTED";
  cause: AutomaticRetryCause;
  retryPolicyProvenance: RetryPolicyProvenance;
  reasonCodes: readonly string[];
  retryOfAttemptNumber: number | null;
}
export type AttemptEvaluationRecord = DeepReadonly<AttemptEvaluationRecordShape>;
export type AttemptEvaluationHistory = readonly AttemptEvaluationRecord[];

const INFRASTRUCTURE_REASONS: ReadonlySet<string> = new Set(
  TRUSTED_INFRASTRUCTURE_RETRY_REASONS,
);
const TRACE_COMPLETENESS_REASONS: ReadonlySet<string> = new Set(
  TRUSTED_TRACE_COMPLETENESS_RETRY_REASONS,
);
const RETRYABLE_CAUSES: ReadonlySet<AutomaticRetryCause> = new Set([
  "INFRASTRUCTURE",
  "TRANSIENT_TOOL",
  "TRACE_COMPLETENESS",
]);
const TRANSIENT_TOOL_REASON_SUFFIXES = [
  ".rate-limited",
  ".timeout",
  ".temporarily-unavailable",
  ".connection-reset",
  ".server-error",
] as const;

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${field} must be a positive integer`);
  }
}

function classifyRetryCause(input: AutomaticRetryInput): AutomaticRetryCause {
  if (input.observedState === "PASSED") return "NONE";
  if (input.observedState === "BEHAVIOR_FAILED") {
    return "DETERMINISTIC_BEHAVIOR";
  }
  if (input.observedState === "CANCELLED") return "USER_CANCELLED";

  const normalizedReasonCode = normalizeAutomaticRetryReasonCode(
    input.reasonCode,
  );
  if (INFRASTRUCTURE_REASONS.has(normalizedReasonCode)) {
    return "INFRASTRUCTURE";
  }
  if (TRACE_COMPLETENESS_REASONS.has(normalizedReasonCode)) {
    return "TRACE_COMPLETENESS";
  }
  if (
    input.reasonCode.startsWith("tool.") &&
    input.declaredTransientToolReasonCodes.includes(input.reasonCode) &&
    TRANSIENT_TOOL_REASON_SUFFIXES.some((suffix) =>
      input.reasonCode.endsWith(suffix),
    )
  ) {
    return "TRANSIENT_TOOL";
  }
  return "NON_RETRYABLE_TRACE";
}

function retryPolicyProvenance(
  input: AutomaticRetryInput,
): RetryPolicyProvenance {
  return Object.freeze({
    classifier: "agenta.retry-policy/v1" as const,
    reasonCode: input.reasonCode,
    declaredTransientToolReasonCodes: Object.freeze([
      ...input.declaredTransientToolReasonCodes,
    ]),
  });
}

function immutableDecision(
  decision: AutomaticRetryDecision,
): AutomaticRetryDecision {
  return Object.freeze(decision);
}

/** Classify a trusted reason and apply the configured, finite attempt bound. */
export function decideAutomaticRetry(
  input: AutomaticRetryInput,
): AutomaticRetryDecision {
  assertPositiveSafeInteger(input.attemptNumber, "attemptNumber");
  assertPositiveSafeInteger(input.maxAttempts, "maxAttempts");
  if (input.attemptNumber > input.maxAttempts) {
    throw new RangeError("attemptNumber cannot exceed maxAttempts");
  }

  const cause = classifyRetryCause(input);
  const provenance = retryPolicyProvenance(input);
  if (!RETRYABLE_CAUSES.has(cause)) {
    return immutableDecision({
      observedState: input.observedState,
      state: input.observedState,
      cause,
      retryPolicyProvenance: provenance,
      shouldRetry: false,
      nextAttemptNumber: null,
      reasonCode: input.reasonCode,
    });
  }

  if (input.attemptNumber === input.maxAttempts) {
    return immutableDecision({
      observedState: input.observedState,
      state: "RETRY_EXHAUSTED",
      cause,
      retryPolicyProvenance: provenance,
      shouldRetry: false,
      nextAttemptNumber: null,
      reasonCode: input.reasonCode,
    });
  }

  return immutableDecision({
    observedState: input.observedState,
    state: "INFRA_RETRYING",
    cause,
    retryPolicyProvenance: provenance,
    shouldRetry: true,
    nextAttemptNumber: input.attemptNumber + 1,
    reasonCode: input.reasonCode,
  });
}

function isConsistentRecord(record: AttemptEvaluationRecord): boolean {
  if (record.state === "INFRA_RETRYING" || record.state === "RETRY_EXHAUSTED") {
    if (record.observedState !== "INVALID_TRACE") return false;
    if (record.cause === "INFRASTRUCTURE") {
      return record.reasonCodes.some((reason) => INFRASTRUCTURE_REASONS.has(reason));
    }
    if (record.cause === "TRACE_COMPLETENESS") {
      return record.reasonCodes.some((reason) =>
        TRACE_COMPLETENESS_REASONS.has(
          normalizeAutomaticRetryReasonCode(reason),
        ),
      );
    }
    if (record.cause === "TRANSIENT_TOOL") {
      return record.reasonCodes.some((reason) => reason.startsWith("tool."));
    }
    return false;
  }
  if (record.state !== record.observedState) return false;
  if (record.state === "PASSED") return record.cause === "NONE";
  if (record.state === "BEHAVIOR_FAILED") {
    return record.cause === "DETERMINISTIC_BEHAVIOR";
  }
  if (record.state === "CANCELLED") return record.cause === "USER_CANCELLED";
  return record.cause === "NON_RETRYABLE_TRACE";
}

function validateRecord(record: AttemptEvaluationRecord): void {
  assertPositiveSafeInteger(record.attemptNumber, "attemptNumber");
  if (!isConsistentRecord(record)) {
    throw new TypeError("inconsistent attempt state, observedState, and cause");
  }
  if (!isConsistentRetryPolicyProvenance(record)) {
    throw new TypeError("inconsistent retry policy provenance");
  }
}

function isConsistentRetryPolicyProvenance(
  record: AttemptEvaluationRecord,
): boolean {
  const provenance = record.retryPolicyProvenance;
  if (
    typeof provenance !== "object" ||
    provenance === null ||
    provenance.classifier !== "agenta.retry-policy/v1" ||
    typeof provenance.reasonCode !== "string" ||
    !Array.isArray(provenance.declaredTransientToolReasonCodes) ||
    !provenance.declaredTransientToolReasonCodes.every(
      (reason) => typeof reason === "string",
    )
  ) {
    return false;
  }
  const classified = classifyRetryCause({
    observedState: record.observedState,
    reasonCode: provenance.reasonCode,
    declaredTransientToolReasonCodes:
      provenance.declaredTransientToolReasonCodes,
    attemptNumber: record.attemptNumber,
    maxAttempts: record.attemptNumber,
  });
  return (
    classified === record.cause &&
    (record.cause === "NONE" ||
      record.reasonCodes.includes(provenance.reasonCode))
  );
}

function immutableRecord(
  record: AttemptEvaluationRecord,
): AttemptEvaluationRecord {
  return Object.freeze({
    ...record,
    reasonCodes: Object.freeze([...record.reasonCodes]),
    retryPolicyProvenance: Object.freeze({
      ...record.retryPolicyProvenance,
      declaredTransientToolReasonCodes: Object.freeze([
        ...record.retryPolicyProvenance.declaredTransientToolReasonCodes,
      ]),
    }),
  });
}

function validateExistingHistory(
  history: readonly AttemptEvaluationRecord[],
): void {
  for (const [index, record] of history.entries()) {
    validateRecord(record);
    if (index === 0) {
      if (record.attemptNumber !== 1) {
        throw new RangeError(
          "corrupted history: attemptNumber must be contiguous from one",
        );
      }
      if (record.retryOfAttemptNumber !== null) {
        throw new RangeError(
          "corrupted history: retryOfAttemptNumber must be null for the first attempt",
        );
      }
      continue;
    }

    const previous = history[index - 1];
    if (record.attemptNumber !== previous.attemptNumber + 1) {
      throw new RangeError(
        "corrupted history: attemptNumber must be contiguous",
      );
    }
    if (record.retryOfAttemptNumber !== previous.attemptNumber) {
      throw new RangeError(
        "corrupted history: retryOfAttemptNumber must reference the previous attempt",
      );
    }
    if (previous.state !== "INFRA_RETRYING") {
      throw new TypeError(
        "corrupted history: retryOfAttemptNumber must reference an INFRA_RETRYING attempt",
      );
    }
  }
}

/**
 * Append an attempt as a deeply immutable snapshot.
 *
 * A record after the first must identify the immediately preceding retryable attempt. This
 * retains the recovery edge and prevents unrelated or already-terminal attempts from being
 * rewritten into a retry chain.
 */
export function appendAttemptRecord(
  history: readonly AttemptEvaluationRecord[],
  record: AttemptEvaluationRecord,
): AttemptEvaluationHistory {
  validateExistingHistory(history);
  validateRecord(record);

  const previous = history.at(-1);
  if (!previous) {
    if (record.retryOfAttemptNumber !== null) {
      throw new RangeError("retryOfAttemptNumber must reference an existing attempt");
    }
    if (record.attemptNumber !== 1) {
      throw new RangeError("the first attemptNumber must be one");
    }
  } else {
    if (record.attemptNumber <= previous.attemptNumber) {
      throw new RangeError("attemptNumber must strictly increase");
    }
    const target = history.find(
      ({ attemptNumber }) => attemptNumber === record.retryOfAttemptNumber,
    );
    if (!target) {
      throw new RangeError("retryOfAttemptNumber must reference an existing attempt");
    }
    if (target.state !== "INFRA_RETRYING") {
      throw new TypeError(
        "retryOfAttemptNumber must reference an INFRA_RETRYING attempt",
      );
    }
    if (
      target.attemptNumber !== previous.attemptNumber ||
      record.attemptNumber !== previous.attemptNumber + 1
    ) {
      throw new RangeError("retry recovery must extend the current attempt chain");
    }
  }

  return Object.freeze([
    ...history.map((existing) => immutableRecord(existing)),
    immutableRecord(record),
  ]);
}
