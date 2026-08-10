import type {
  CodexValidatedRolloutEvent,
  JsonValue,
} from "../engines/sandbox_agent/codex-rollout-schema.ts";

/** Observable runtime timing categories. Categories can overlap and are not additive. */
export const RUNTIME_LATENCY_CATEGORIES = [
  "acquisition_setup",
  "provider_sampling_wait",
  "queue_wait",
  "tool_execution",
  "child_agent_work",
  "code_cell",
  "terminal_operation",
  "trace_finalization",
] as const;

export type RuntimeLatencyCategory =
  (typeof RUNTIME_LATENCY_CATEGORIES)[number];

export type RuntimeLatencyReasonCode =
  | "CLOCK_REGRESSION"
  | "INVALID_TIMESTAMP"
  | "DUPLICATE_INTERVAL_ID"
  | "MISSING_CAUSAL_PARENT"
  | "CAUSAL_ORDER_INVALID"
  | "PARENT_NOT_TEMPORALLY_CONTAINED"
  | "CAUSAL_CYCLE";

export type RuntimeGraphRole = "root_turn" | "stage_join";

/**
 * A paired, observable lifecycle interval. `causalParentIds` are predecessor
 * operations; `parentId` is a nesting relationship. The locator is an opaque
 * pointer back to evidence, not raw payload content.
 */
export interface RuntimeInterval {
  id: string;
  /** Null for graph-only boundaries which must not be counted as runtime work. */
  category: RuntimeLatencyCategory | null;
  role?: RuntimeGraphRole;
  startMs: number;
  endMs: number;
  sequence: number;
  locator: string;
  parentId?: string;
  causalParentIds?: readonly string[];
  retry?: boolean;
  attemptOrdinal?: number;
}

export interface RuntimeWallWindow {
  startMs: number;
  endMs: number;
}

export interface RuntimeLatencyInput {
  wall: RuntimeWallWindow;
  intervals: readonly RuntimeInterval[];
}

export interface RunnerLifecycleMark {
  id: string;
  category: RuntimeLatencyCategory;
  boundary: "start" | "end";
  wallTimeUnixMs: number;
  sequence: number;
  locator: string;
  parentId?: string;
  causalParentIds?: readonly string[];
  retry?: boolean;
}

export interface RuntimeIntervalExtractionInput {
  rootThreadId: string;
  events: readonly CodexValidatedRolloutEvent[];
  runnerMarks?: readonly RunnerLifecycleMark[];
  retryObservations?: readonly RuntimeRetryObservation[];
}

/** Explicit protocol observation; native rollout v1 does not infer this. */
export interface RuntimeRetryObservation {
  inferenceCallId: string;
  willRetry: boolean;
}

export type RuntimeIntervalExtractionIssueCode =
  | "RUNTIME_START_MISSING"
  | "RUNTIME_TERMINAL_MISSING"
  | "RUNTIME_START_DUPLICATED";

export interface RuntimeIntervalExtractionIssue {
  code: RuntimeIntervalExtractionIssueCode;
  id: string;
  sequence: number;
  locator: string;
}

export interface RuntimeIntervalExtractionResult {
  intervals: RuntimeInterval[];
  issues: RuntimeIntervalExtractionIssue[];
}

export interface RuntimeCategoryMetric {
  available: boolean;
  intervalUnionMs: number | null;
  summedWorkMs: number | null;
  intervalCount: number;
  reasonCodes: RuntimeLatencyReasonCode[];
}

export interface RuntimeCriticalPathEntry {
  id: string;
  category: RuntimeLatencyCategory | null;
  role?: RuntimeGraphRole;
  startMs: number;
  endMs: number;
  sequence: number;
  locator: string;
  contributionMs: number;
  attemptOrdinal?: number;
}

export interface RuntimeBottleneck {
  id: string;
  category: RuntimeLatencyCategory;
  phase: string;
  interval: RuntimeWallWindow;
  intervalUnionMs: number;
  criticalPathContributionMs: number;
  offCriticalPath: boolean;
  sequence: number;
  locator: string;
  attemptOrdinal?: number;
}

export interface RuntimeLatencyReport {
  totalWallMs: number | null;
  categories: Record<RuntimeLatencyCategory, RuntimeCategoryMetric>;
  /** Union across every classified interval inside the requested wall window. */
  classifiedIntervalUnionMs: number | null;
  /** Arithmetic work total. It may exceed total wall time when work overlaps. */
  summedWorkMs: number | null;
  criticalPathMs: number | null;
  criticalPath: RuntimeCriticalPathEntry[];
  unattributedRuntimeOverheadMs: number | null;
  bottlenecks: RuntimeBottleneck[];
  reasonCodes: RuntimeLatencyReasonCode[];
}

interface CriticalPathState {
  interval: RuntimeInterval;
  predecessorId?: string;
  blockingUnionMs: number;
  coverageEndMs?: number;
}

const PHASE_LABELS: Record<RuntimeLatencyCategory, string> = {
  acquisition_setup: "acquisition/setup",
  provider_sampling_wait: "provider sampling/wait",
  queue_wait: "queue/wait",
  tool_execution: "tool execution",
  child_agent_work: "child-agent work",
  code_cell: "code-cell execution",
  terminal_operation: "terminal operation",
  trace_finalization: "trace finalization",
};

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIntervals(
  left: RuntimeInterval,
  right: RuntimeInterval,
): number {
  return (
    left.sequence - right.sequence ||
    left.startMs - right.startMs ||
    left.endMs - right.endMs ||
    compareText(left.id, right.id)
  );
}

function compareIntervalIdentity(
  left: RuntimeInterval,
  right: RuntimeInterval,
): number {
  return left.sequence - right.sequence || compareText(left.id, right.id);
}

function duration(interval: RuntimeWallWindow): number {
  return interval.endMs - interval.startMs;
}

function intervalUnionMs(intervals: readonly RuntimeWallWindow[]): number {
  if (intervals.length === 0) return 0;

  const ordered = [...intervals].sort(
    (left, right) =>
      left.startMs - right.startMs || left.endMs - right.endMs,
  );
  let total = 0;
  let currentStart = ordered[0]!.startMs;
  let currentEnd = ordered[0]!.endMs;

  for (const next of ordered.slice(1)) {
    if (next.startMs <= currentEnd) {
      currentEnd = Math.max(currentEnd, next.endMs);
      continue;
    }
    total += currentEnd - currentStart;
    currentStart = next.startMs;
    currentEnd = next.endMs;
  }

  return total + currentEnd - currentStart;
}

function intervalReason(
  interval: RuntimeInterval,
): RuntimeLatencyReasonCode | undefined {
  if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) {
    return "INVALID_TIMESTAMP";
  }
  if (interval.endMs < interval.startMs) return "CLOCK_REGRESSION";
  return undefined;
}

function wallReason(
  wall: RuntimeWallWindow,
): RuntimeLatencyReasonCode | undefined {
  if (!Number.isFinite(wall.startMs) || !Number.isFinite(wall.endMs)) {
    return "INVALID_TIMESTAMP";
  }
  if (wall.endMs < wall.startMs) return "CLOCK_REGRESSION";
  return undefined;
}

function uniqueReasons(
  reasons: readonly RuntimeLatencyReasonCode[],
): RuntimeLatencyReasonCode[] {
  return [...new Set(reasons)].sort(compareText);
}

interface PendingRuntimeStart {
  id: string;
  category: RuntimeLatencyCategory | null;
  role?: RuntimeGraphRole;
  startMs: number;
  sequence: number;
  locator: string;
  locatorKind: "events" | "marks";
  parentId?: string;
  causalParentIds?: readonly string[];
  retry?: boolean;
  attemptOrdinal?: number;
}

function payloadString(
  event: CodexValidatedRolloutEvent,
  field: string,
): string | undefined {
  const value = event.payload[field];
  return typeof value === "string" ? value : undefined;
}

function payloadObject(
  event: CodexValidatedRolloutEvent,
  field: string,
): Record<string, JsonValue> | undefined {
  const value = event.payload[field];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

function objectString(
  value: Record<string, JsonValue> | undefined,
  field: string,
): string | undefined {
  const fieldValue = value?.[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
}

function turnGraphId(event: CodexValidatedRolloutEvent): string | undefined {
  const turnId = payloadString(event, "codex_turn_id") ?? event.codexTurnId;
  return turnId ? `root_turn:${turnId}` : undefined;
}

function rootTurnParentId(
  event: CodexValidatedRolloutEvent,
  rootThreadId: string,
): string | undefined {
  const threadId = payloadString(event, "thread_id") ?? event.threadId;
  return threadId === rootThreadId ? turnGraphId(event) : undefined;
}

function toolRequesterParentId(
  event: CodexValidatedRolloutEvent,
  rootThreadId: string,
): string | undefined {
  const requester = payloadObject(event, "requester");
  if (objectString(requester, "type") === "code_cell") {
    const cellId =
      objectString(requester, "runtime_cell_id") ??
      objectString(requester, "code_cell_id");
    return cellId ? `code_cell:${cellId}` : undefined;
  }
  return rootTurnParentId(event, rootThreadId);
}

function terminalOperationId(
  event: CodexValidatedRolloutEvent,
  toolCallId: string,
): string | undefined {
  const kind = payloadObject(event, "kind");
  const summary = payloadObject(event, "summary");
  const kindType = objectString(kind, "type");
  const summaryType = objectString(summary, "type");
  if (
    kindType !== "exec_command" &&
    kindType !== "write_stdin" &&
    summaryType !== "terminal"
  ) {
    return undefined;
  }
  return `terminal:${objectString(summary, "operation_id") ?? toolCallId}`;
}

export function runnerRuntimeIntervalId(id: string): string {
  return id.startsWith("runner:") ? id : `runner:${id}`;
}

function withCausalParent(
  interval: RuntimeInterval,
  predecessorId: string,
): RuntimeInterval {
  const causalParentIds = [...new Set([
    ...(interval.causalParentIds ?? []),
    predecessorId,
  ])];
  return { ...interval, causalParentIds };
}

function containsInterval(
  parent: RuntimeInterval,
  child: RuntimeInterval,
): boolean {
  return parent.startMs <= child.startMs && parent.endMs >= child.endMs;
}

/** Build bounded fan-in/fan-out joins for the observable phases of each root turn. */
function linkTurnStageDag(
  source: readonly RuntimeInterval[],
): RuntimeInterval[] {
  const byId = new Map(source.map((interval) => [interval.id, interval]));
  const roots = source
    .filter((interval) => interval.role === "root_turn")
    .sort(
      (left, right) =>
        left.startMs - right.startMs || compareIntervalIdentity(left, right),
    );
  let priorTurnFenceId: string | undefined;

  for (const originalRoot of roots) {
    let root = byId.get(originalRoot.id)!;
    if (priorTurnFenceId) {
      root = withCausalParent(root, priorTurnFenceId);
      byId.set(root.id, root);
    }
    const phases = [...byId.values()]
      .filter(
        (interval) =>
          interval.role === undefined &&
          interval.category !== "trace_finalization" &&
          containsInterval(root, interval) &&
          (interval.parentId === root.id ||
            (interval.parentId === undefined && interval.id.startsWith("thread:"))),
      )
      .sort(
        (left, right) =>
          left.startMs - right.startMs ||
          left.endMs - right.endMs ||
          compareIntervalIdentity(left, right),
      );

    const stages: RuntimeInterval[][] = [];
    let stageEnd = Number.NEGATIVE_INFINITY;
    for (const phase of phases) {
      if (stages.length === 0 || phase.startMs >= stageEnd) {
        stages.push([phase]);
        stageEnd = phase.endMs;
      } else {
        stages.at(-1)!.push(phase);
        stageEnd = Math.max(stageEnd, phase.endMs);
      }
    }

    let priorStageJoinId: string | undefined;
    for (const [stageIndex, stage] of stages.entries()) {
      if (priorStageJoinId) {
        for (const phase of stage) {
          byId.set(phase.id, withCausalParent(byId.get(phase.id)!, priorStageJoinId));
        }
      }
      const joinTime = Math.max(...stage.map((phase) => phase.endMs));
      const joinId = `stage_join:${root.id}:${stageIndex + 1}`;
      const join: RuntimeInterval = {
        id: joinId,
        category: null,
        role: "stage_join",
        startMs: joinTime,
        endMs: joinTime,
        sequence: Math.max(...stage.map((phase) => phase.sequence)),
        locator: `derived:${joinId}`,
        parentId: root.id,
        causalParentIds: stage.map((phase) => phase.id).sort(compareText),
      };
      byId.set(join.id, join);
      priorStageJoinId = join.id;
    }
    priorTurnFenceId = priorStageJoinId ?? root.id;
  }

  if (priorTurnFenceId) {
    for (const finalization of byId.values()) {
      if (finalization.category === "trace_finalization") {
        byId.set(
          finalization.id,
          withCausalParent(finalization, priorTurnFenceId),
        );
      }
    }
  }
  return [...byId.values()].sort(compareIntervals);
}

/**
 * Pair validated native Codex lifecycle boundaries and runner-owned marks into
 * the interval model consumed by `analyzeRuntimeLatency`. It performs no I/O.
 */
export function extractRuntimeIntervals(
  input: RuntimeIntervalExtractionInput,
): RuntimeIntervalExtractionResult {
  const pending = new Map<string, PendingRuntimeStart>();
  const intervals: RuntimeInterval[] = [];
  const issues: RuntimeIntervalExtractionIssue[] = [];
  const retryByInferenceId = new Map(
    (input.retryObservations ?? []).map((observation) => [
      observation.inferenceCallId,
      observation.willRetry,
    ]),
  );
  const inferenceCountByTurn = new Map<string, number>();
  const terminalIdByToolCallId = new Map<string, string>();

  const start = (value: PendingRuntimeStart): void => {
    const existing = pending.get(value.id);
    if (existing) {
      issues.push({
        code: "RUNTIME_START_DUPLICATED",
        id: value.id,
        sequence: value.sequence,
        locator: value.locator,
      });
      return;
    }
    pending.set(value.id, value);
  };
  const finish = (
    id: string,
    endMs: number,
    sequence: number,
    locator: string,
  ): void => {
    const opened = pending.get(id);
    if (!opened) {
      issues.push({
        code: "RUNTIME_START_MISSING",
        id,
        sequence,
        locator,
      });
      return;
    }
    pending.delete(id);
    intervals.push({
      id: opened.id,
      category: opened.category,
      ...(opened.role ? { role: opened.role } : {}),
      startMs: opened.startMs,
      endMs,
      sequence: opened.sequence,
      locator: `${opened.locatorKind}:${opened.sequence}-${sequence}`,
      ...(opened.parentId ? { parentId: opened.parentId } : {}),
      ...(opened.causalParentIds
        ? { causalParentIds: opened.causalParentIds }
        : {}),
      ...(opened.retry === undefined ? {} : { retry: opened.retry }),
      ...(opened.attemptOrdinal === undefined
        ? {}
        : { attemptOrdinal: opened.attemptOrdinal }),
    });
  };

  for (const mark of [...(input.runnerMarks ?? [])].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.wallTimeUnixMs - right.wallTimeUnixMs ||
      compareText(left.id, right.id),
  )) {
    const id = runnerRuntimeIntervalId(mark.id);
    if (mark.boundary === "start") {
      start({
        id,
        category: mark.category,
        startMs: mark.wallTimeUnixMs,
        sequence: mark.sequence,
        locator: mark.locator,
        locatorKind: "marks",
        ...(mark.parentId
          ? { parentId: runnerRuntimeIntervalId(mark.parentId) }
          : {}),
        ...(mark.causalParentIds
          ? {
              causalParentIds: mark.causalParentIds.map(
                runnerRuntimeIntervalId,
              ),
            }
          : {}),
        ...(mark.retry === undefined ? {} : { retry: mark.retry }),
      });
    } else {
      finish(id, mark.wallTimeUnixMs, mark.sequence, mark.locator);
    }
  }

  for (const event of [...input.events].sort(
    (left, right) => left.seq - right.seq,
  )) {
    const locator = `event:${event.seq}`;
    switch (event.type) {
      case "codex_turn_started": {
        const threadId = payloadString(event, "thread_id") ?? event.threadId;
        const id = turnGraphId(event);
        if (threadId === input.rootThreadId && id) {
          start({
            id,
            category: null,
            role: "root_turn",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
          });
        }
        break;
      }
      case "codex_turn_ended": {
        const threadId = payloadString(event, "thread_id") ?? event.threadId;
        const id = turnGraphId(event);
        if (threadId === input.rootThreadId && id) {
          finish(id, event.wallTimeUnixMs, event.seq, locator);
        }
        break;
      }
      case "inference_started": {
        const rawId = payloadString(event, "inference_call_id");
        if (!rawId) break;
        const turnId =
          payloadString(event, "codex_turn_id") ??
          event.codexTurnId ??
          "unknown";
        const attemptOrdinal = (inferenceCountByTurn.get(turnId) ?? 0) + 1;
        inferenceCountByTurn.set(turnId, attemptOrdinal);
        const parentId = rootTurnParentId(event, input.rootThreadId);
        const retry = retryByInferenceId.get(rawId);
        start({
          id: `inference:${rawId}`,
          category: "provider_sampling_wait",
          startMs: event.wallTimeUnixMs,
          sequence: event.seq,
          locator,
          locatorKind: "events",
          ...(parentId ? { parentId } : {}),
          ...(retry === undefined ? {} : { retry }),
          attemptOrdinal,
        });
        break;
      }
      case "inference_completed":
      case "inference_failed":
      case "inference_cancelled": {
        const rawId = payloadString(event, "inference_call_id");
        if (rawId) {
          finish(
            `inference:${rawId}`,
            event.wallTimeUnixMs,
            event.seq,
            locator,
          );
        }
        break;
      }
      case "tool_call_started": {
        const rawId = payloadString(event, "tool_call_id");
        if (rawId) {
          const parentId = toolRequesterParentId(event, input.rootThreadId);
          const terminalId = terminalOperationId(event, rawId);
          if (terminalId) terminalIdByToolCallId.set(rawId, terminalId);
          start({
            id: `tool:${rawId}`,
            category: "tool_execution",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
            ...(parentId ? { parentId } : {}),
          });
        }
        break;
      }
      case "tool_call_ended": {
        const rawId = payloadString(event, "tool_call_id");
        if (rawId) {
          finish(
            `tool:${rawId}`,
            event.wallTimeUnixMs,
            event.seq,
            locator,
          );
        }
        break;
      }
      case "code_cell_started": {
        const rawId = payloadString(event, "runtime_cell_id");
        if (rawId) {
          const parentId = rootTurnParentId(event, input.rootThreadId);
          start({
            id: `code_cell:${rawId}`,
            category: "code_cell",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
            ...(parentId ? { parentId } : {}),
          });
        }
        break;
      }
      case "code_cell_ended": {
        const rawId = payloadString(event, "runtime_cell_id");
        if (rawId) {
          finish(
            `code_cell:${rawId}`,
            event.wallTimeUnixMs,
            event.seq,
            locator,
          );
        }
        break;
      }
      case "thread_started": {
        const threadId = payloadString(event, "thread_id") ?? event.threadId;
        if (threadId && threadId !== input.rootThreadId) {
          start({
            id: `thread:${threadId}`,
            category: "child_agent_work",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
          });
        }
        break;
      }
      case "thread_ended": {
        const threadId = payloadString(event, "thread_id") ?? event.threadId;
        if (threadId === input.rootThreadId) {
          start({
            id: `trace_finalization:${event.rolloutId}`,
            category: "trace_finalization",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
          });
        } else if (threadId) {
          finish(
            `thread:${threadId}`,
            event.wallTimeUnixMs,
            event.seq,
            locator,
          );
        }
        break;
      }
      case "rollout_ended":
        finish(
          `trace_finalization:${event.rolloutId}`,
          event.wallTimeUnixMs,
          event.seq,
          locator,
        );
        break;
      case "tool_call_runtime_started": {
        const rawId = payloadString(event, "tool_call_id");
        const terminalId = rawId
          ? terminalIdByToolCallId.get(rawId)
          : undefined;
        if (rawId && terminalId) {
          start({
            id: terminalId,
            category: "terminal_operation",
            startMs: event.wallTimeUnixMs,
            sequence: event.seq,
            locator,
            locatorKind: "events",
            parentId: `tool:${rawId}`,
          });
        }
        break;
      }
      case "tool_call_runtime_ended": {
        const rawId = payloadString(event, "tool_call_id");
        const terminalId = rawId
          ? terminalIdByToolCallId.get(rawId)
          : undefined;
        if (terminalId) {
          finish(
            terminalId,
            event.wallTimeUnixMs,
            event.seq,
            locator,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  for (const opened of pending.values()) {
    issues.push({
      code: "RUNTIME_TERMINAL_MISSING",
      id: opened.id,
      sequence: opened.sequence,
      locator: opened.locator,
    });
  }

  return {
    intervals: linkTurnStageDag(intervals),
    issues: issues.sort(
      (left, right) =>
        left.sequence - right.sequence ||
        compareText(left.id, right.id) ||
        compareText(left.code, right.code),
    ),
  };
}

function buildCategoryMetrics(
  intervals: readonly RuntimeInterval[],
): Record<RuntimeLatencyCategory, RuntimeCategoryMetric> {
  const entries = RUNTIME_LATENCY_CATEGORIES.map((category) => {
    const members = intervals.filter((interval) => interval.category === category);
    const reasons = uniqueReasons(
      members
        .map(intervalReason)
        .filter((reason): reason is RuntimeLatencyReasonCode => reason !== undefined),
    );

    const metric: RuntimeCategoryMetric =
      reasons.length > 0
        ? {
            available: false,
            intervalUnionMs: null,
            summedWorkMs: null,
            intervalCount: members.length,
            reasonCodes: reasons,
          }
        : {
            available: true,
            intervalUnionMs: intervalUnionMs(members),
            summedWorkMs: members.reduce(
              (total, interval) => total + duration(interval),
              0,
            ),
            intervalCount: members.length,
            reasonCodes: [],
          };
    return [category, metric] as const;
  });

  return Object.fromEntries(entries) as Record<
    RuntimeLatencyCategory,
    RuntimeCategoryMetric
  >;
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function betterContainmentCandidate(
  left: RuntimeInterval | undefined,
  right: RuntimeInterval | undefined,
): RuntimeInterval | undefined {
  if (!left) return right;
  if (!right) return left;
  const durationDifference = duration(left) - duration(right);
  if (durationDifference !== 0) return durationDifference < 0 ? left : right;
  return compareIntervalIdentity(left, right) <= 0 ? left : right;
}

/**
 * Find the narrowest prior interval that contains each unparented interval.
 * Starts are swept in ascending order; a suffix segment tree indexes candidate
 * end timestamps, avoiding a full scan for every interval.
 */
function buildContainmentParents(
  intervals: readonly RuntimeInterval[],
): Map<string, RuntimeInterval> {
  const ordered = [...intervals].sort(
    (left, right) =>
      left.startMs - right.startMs ||
      right.endMs - left.endMs ||
      compareIntervalIdentity(left, right),
  );
  const endValues = [...new Set(ordered.map((interval) => interval.endMs))].sort(
    (left, right) => left - right,
  );
  let leafCount = 1;
  while (leafCount < endValues.length) leafCount *= 2;
  const tree: Array<RuntimeInterval | undefined> = new Array(leafCount * 2);

  const update = (index: number, interval: RuntimeInterval): void => {
    let node = leafCount + index;
    tree[node] = betterContainmentCandidate(tree[node], interval);
    node = Math.floor(node / 2);
    while (node > 0) {
      tree[node] = betterContainmentCandidate(tree[node * 2], tree[node * 2 + 1]);
      node = Math.floor(node / 2);
    }
  };
  const querySuffix = (from: number): RuntimeInterval | undefined => {
    let left = leafCount + from;
    let right = leafCount + endValues.length;
    let best: RuntimeInterval | undefined;
    while (left < right) {
      if (left % 2 === 1) best = betterContainmentCandidate(best, tree[left++]);
      if (right % 2 === 1) best = betterContainmentCandidate(best, tree[--right]);
      left = Math.floor(left / 2);
      right = Math.floor(right / 2);
    }
    return best;
  };

  const parents = new Map<string, RuntimeInterval>();
  for (let offset = 0; offset < ordered.length; ) {
    let groupEnd = offset + 1;
    while (
      groupEnd < ordered.length &&
      ordered[groupEnd]!.startMs === ordered[offset]!.startMs &&
      ordered[groupEnd]!.endMs === ordered[offset]!.endMs
    ) {
      groupEnd += 1;
    }
    for (const interval of ordered.slice(offset, groupEnd)) {
      if (interval.parentId || (interval.causalParentIds?.length ?? 0) > 0) {
        continue;
      }
      const candidate = querySuffix(lowerBound(endValues, interval.endMs));
      if (candidate) parents.set(interval.id, candidate);
    }
    for (const interval of ordered.slice(offset, groupEnd)) {
      update(lowerBound(endValues, interval.endMs), interval);
    }
    offset = groupEnd;
  }
  return parents;
}

class IntervalMinHeap {
  private readonly values: RuntimeInterval[] = [];

  get size(): number {
    return this.values.length;
  }

  push(value: RuntimeInterval): void {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareIntervalIdentity(this.values[parent]!, value) <= 0) break;
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): RuntimeInterval | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || this.values.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.values.length) break;
      const right = left + 1;
      const child =
        right < this.values.length &&
        compareIntervalIdentity(this.values[right]!, this.values[left]!) < 0
          ? right
          : left;
      if (compareIntervalIdentity(last, this.values[child]!) <= 0) break;
      this.values[index] = this.values[child]!;
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function extendCriticalState(
  predecessor: CriticalPathState | undefined,
  interval: RuntimeInterval,
): CriticalPathState {
  let blockingUnionMs = predecessor?.blockingUnionMs ?? 0;
  let coverageEndMs = predecessor?.coverageEndMs;
  if (interval.category !== null) {
    if (coverageEndMs === undefined || interval.startMs >= coverageEndMs) {
      blockingUnionMs += duration(interval);
    } else if (interval.endMs > coverageEndMs) {
      blockingUnionMs += interval.endMs - coverageEndMs;
    }
    coverageEndMs = Math.max(coverageEndMs ?? interval.endMs, interval.endMs);
  }
  return {
    interval,
    ...(predecessor ? { predecessorId: predecessor.interval.id } : {}),
    blockingUnionMs,
    ...(coverageEndMs === undefined ? {} : { coverageEndMs }),
  };
}

function preferredState(
  left: CriticalPathState,
  right: CriticalPathState,
): CriticalPathState {
  if (left.blockingUnionMs !== right.blockingUnionMs) {
    return left.blockingUnionMs > right.blockingUnionMs ? left : right;
  }
  return compareIntervalIdentity(left.interval, right.interval) <= 0
    ? left
    : right;
}

function deriveCriticalPath(
  intervals: readonly RuntimeInterval[],
  containmentSource: readonly RuntimeInterval[] = intervals,
): {
  path: RuntimeInterval[] | null;
  reasonCodes: RuntimeLatencyReasonCode[];
} {
  if (intervals.length === 0) return { path: [], reasonCodes: [] };

  const byId = new Map<string, RuntimeInterval>();
  const containmentById = new Map<string, RuntimeInterval>();
  const reasons: RuntimeLatencyReasonCode[] = [];
  for (const interval of intervals) {
    if (byId.has(interval.id)) reasons.push("DUPLICATE_INTERVAL_ID");
    else byId.set(interval.id, interval);
  }
  for (const interval of containmentSource) {
    if (!containmentById.has(interval.id)) {
      containmentById.set(interval.id, interval);
    }
  }
  if (reasons.length > 0) {
    return { path: null, reasonCodes: uniqueReasons(reasons) };
  }

  const inferredParents = buildContainmentParents(intervals);
  const firstRootTurn = intervals
    .filter((interval) => interval.role === "root_turn")
    .sort(
      (left, right) =>
        left.startMs - right.startMs || compareIntervalIdentity(left, right),
    )[0];
  const setupFenceIds = firstRootTurn
    ? intervals
        .filter(
          (interval) =>
            interval.category === "acquisition_setup" &&
            interval.endMs <= firstRootTurn.startMs,
        )
        .map((interval) => interval.id)
    : [];
  const predecessorIdsById = new Map<string, string[]>();
  const outgoingIdsById = new Map<string, string[]>();
  const indegreeById = new Map<string, number>();
  for (const interval of intervals) {
    const causalPredecessorIds = new Set<string>(
      interval.causalParentIds ?? [],
    );
    if (interval.id === firstRootTurn?.id) {
      for (const setupFenceId of setupFenceIds) {
        causalPredecessorIds.add(setupFenceId);
      }
    }
    const predecessorIds = new Set<string>(causalPredecessorIds);
    if (interval.parentId) {
      predecessorIds.add(interval.parentId);
      const original = containmentById.get(interval.id);
      const originalParent = containmentById.get(interval.parentId);
      if (
        original &&
        originalParent &&
        (originalParent.startMs > original.startMs ||
          originalParent.endMs < original.endMs)
      ) {
        reasons.push("PARENT_NOT_TEMPORALLY_CONTAINED");
      }
    }
    else {
      const inferredParent = inferredParents.get(interval.id);
      if (inferredParent) predecessorIds.add(inferredParent.id);
    }

    const resolved: string[] = [];
    for (const predecessorId of predecessorIds) {
      const predecessor = byId.get(predecessorId);
      if (!predecessor || predecessorId === interval.id) {
        reasons.push("MISSING_CAUSAL_PARENT");
        continue;
      }
      if (causalPredecessorIds.has(predecessorId)) {
        const original = containmentById.get(interval.id);
        const originalPredecessor = containmentById.get(predecessorId);
        if (
          original &&
          originalPredecessor &&
          originalPredecessor.endMs > original.startMs
        ) {
          reasons.push("CAUSAL_ORDER_INVALID");
        }
      }
      resolved.push(predecessor.id);
      const outgoing = outgoingIdsById.get(predecessor.id) ?? [];
      outgoing.push(interval.id);
      outgoingIdsById.set(predecessor.id, outgoing);
    }
    resolved.sort((left, right) =>
      compareIntervalIdentity(byId.get(left)!, byId.get(right)!),
    );
    predecessorIdsById.set(interval.id, resolved);
    indegreeById.set(interval.id, resolved.length);
  }
  if (reasons.length > 0) {
    return { path: null, reasonCodes: uniqueReasons(reasons) };
  }

  const ready = new IntervalMinHeap();
  for (const interval of intervals) {
    if ((indegreeById.get(interval.id) ?? 0) === 0) ready.push(interval);
  }
  const stateById = new Map<string, CriticalPathState>();
  let processed = 0;
  while (ready.size > 0) {
    const interval = ready.pop()!;
    let best: CriticalPathState | undefined;
    for (const predecessorId of predecessorIdsById.get(interval.id) ?? []) {
      const predecessor = stateById.get(predecessorId);
      if (!predecessor) continue;
      const candidate = extendCriticalState(predecessor, interval);
      best = best ? preferredState(best, candidate) : candidate;
    }
    stateById.set(interval.id, best ?? extendCriticalState(undefined, interval));
    processed += 1;
    for (const outgoingId of outgoingIdsById.get(interval.id) ?? []) {
      const nextIndegree = (indegreeById.get(outgoingId) ?? 0) - 1;
      indegreeById.set(outgoingId, nextIndegree);
      if (nextIndegree === 0) ready.push(byId.get(outgoingId)!);
    }
  }

  if (processed !== intervals.length) {
    return {
      path: null,
      reasonCodes: ["CAUSAL_CYCLE"],
    };
  }

  const leafStates = intervals
    .filter((interval) => (outgoingIdsById.get(interval.id)?.length ?? 0) === 0)
    .map((interval) => stateById.get(interval.id)!);
  let selected = leafStates[0];
  for (const candidate of leafStates.slice(1)) {
    if (!selected || candidate.blockingUnionMs > selected.blockingUnionMs) {
      selected = candidate;
      continue;
    }
    if (candidate.blockingUnionMs < selected.blockingUnionMs) continue;
    if (candidate.interval.endMs > selected.interval.endMs) {
      selected = candidate;
      continue;
    }
    if (
      candidate.interval.endMs === selected.interval.endMs &&
      compareIntervalIdentity(candidate.interval, selected.interval) < 0
    ) {
      selected = candidate;
    }
  }
  if (!selected) return { path: [], reasonCodes: [] };

  const reversed: RuntimeInterval[] = [];
  let cursor: CriticalPathState | undefined = selected;
  while (cursor) {
    reversed.push(cursor.interval);
    cursor = cursor.predecessorId
      ? stateById.get(cursor.predecessorId)
      : undefined;
  }
  return { path: reversed.reverse(), reasonCodes: [] };
}

function criticalPathEntries(
  path: readonly RuntimeInterval[],
): RuntimeCriticalPathEntry[] {
  const contributionById = new Map<string, number>();
  const points = [...new Set(path.flatMap((interval) => [interval.startMs, interval.endMs]))]
    .sort((left, right) => left - right);
  const next = Array.from({ length: points.length }, (_, index) => index);
  const findNext = (start: number): number => {
    let cursor = start;
    while (next[cursor] !== cursor) cursor = next[cursor]!;
    while (next[start] !== start) {
      const following = next[start]!;
      next[start] = cursor;
      start = following;
    }
    return cursor;
  };
  for (const interval of [...path].reverse()) {
    const endIndex = lowerBound(points, interval.endMs);
    let segment = findNext(lowerBound(points, interval.startMs));
    let contributionMs = 0;
    while (segment < endIndex) {
      contributionMs += points[segment + 1]! - points[segment]!;
      next[segment] = findNext(segment + 1);
      segment = findNext(segment);
    }
    contributionById.set(interval.id, contributionMs);
  }

  return path.map((interval) => ({
    id: interval.id,
    category: interval.category,
    ...(interval.role ? { role: interval.role } : {}),
    startMs: interval.startMs,
    endMs: interval.endMs,
    sequence: interval.sequence,
    locator: interval.locator,
    contributionMs: contributionById.get(interval.id) ?? 0,
    ...(interval.attemptOrdinal === undefined
      ? {}
      : { attemptOrdinal: interval.attemptOrdinal }),
  }));
}

type CategorizedRuntimeInterval = RuntimeInterval & {
  category: RuntimeLatencyCategory;
};

function bottleneckPhase(interval: CategorizedRuntimeInterval): string {
  if (interval.category === "provider_sampling_wait" && interval.retry) {
    return "provider retry";
  }
  return PHASE_LABELS[interval.category];
}

function buildBottlenecks(
  intervals: readonly RuntimeInterval[],
  criticalPath: readonly RuntimeCriticalPathEntry[],
): RuntimeBottleneck[] {
  const criticalIds = new Set(criticalPath.map((entry) => entry.id));
  const contributionById = new Map(
    criticalPath.map((entry) => [entry.id, entry.contributionMs]),
  );

  return intervals
    .filter(
      (interval): interval is CategorizedRuntimeInterval =>
        interval.category !== null && duration(interval) > 0,
    )
    .map((interval): RuntimeBottleneck => ({
      id: interval.id,
      category: interval.category,
      phase: bottleneckPhase(interval),
      interval: { startMs: interval.startMs, endMs: interval.endMs },
      intervalUnionMs: duration(interval),
      criticalPathContributionMs: contributionById.get(interval.id) ?? 0,
      offCriticalPath: !criticalIds.has(interval.id),
      sequence: interval.sequence,
      locator: interval.locator,
      ...(interval.attemptOrdinal === undefined
        ? {}
        : { attemptOrdinal: interval.attemptOrdinal }),
    }))
    .sort(
      (left, right) =>
        right.criticalPathContributionMs - left.criticalPathContributionMs ||
        right.intervalUnionMs - left.intervalUnionMs ||
        left.sequence - right.sequence ||
        compareText(left.id, right.id),
    );
}

function clipIntervalToWall(
  interval: RuntimeInterval,
  wall: RuntimeWallWindow,
): RuntimeInterval {
  const clamp = (value: number): number =>
    Math.min(wall.endMs, Math.max(wall.startMs, value));
  return {
    ...interval,
    startMs: clamp(interval.startMs),
    endMs: clamp(interval.endMs),
  };
}

export function analyzeRuntimeLatency(
  input: RuntimeLatencyInput,
): RuntimeLatencyReport {
  const sourceIntervals = [...input.intervals].sort(compareIntervals);
  const invalidWallReason = wallReason(input.wall);
  const invalidReasons = uniqueReasons([
    ...(invalidWallReason ? [invalidWallReason] : []),
    ...sourceIntervals
      .map(intervalReason)
      .filter((reason): reason is RuntimeLatencyReasonCode => reason !== undefined),
  ]);
  const totalWallMs = invalidWallReason ? null : duration(input.wall);
  const intervals = invalidWallReason
    ? sourceIntervals
    : sourceIntervals.map((interval) =>
        intervalReason(interval)
          ? interval
          : clipIntervalToWall(interval, input.wall),
      );
  const categories = buildCategoryMetrics(intervals);

  // A bad interval only invalidates its own category above. Metrics that depend on
  // the complete interval set fail closed because excluding it could invent time.
  if (invalidReasons.length > 0 || totalWallMs === null) {
    return {
      totalWallMs,
      categories,
      classifiedIntervalUnionMs: null,
      summedWorkMs: null,
      criticalPathMs: null,
      criticalPath: [],
      unattributedRuntimeOverheadMs: null,
      bottlenecks: [],
      reasonCodes: invalidReasons,
    };
  }

  const categorizedIntervals = intervals.filter(
    (interval): interval is CategorizedRuntimeInterval =>
      interval.category !== null,
  );
  const classifiedIntervalUnionMs = intervalUnionMs(categorizedIntervals);
  const summedWorkMs = categorizedIntervals.reduce(
    (total, interval) => total + duration(interval),
    0,
  );

  const critical = deriveCriticalPath(intervals, sourceIntervals);
  if (!critical.path) {
    return {
      totalWallMs,
      categories,
      classifiedIntervalUnionMs,
      summedWorkMs,
      criticalPathMs: null,
      criticalPath: [],
      unattributedRuntimeOverheadMs:
        totalWallMs - classifiedIntervalUnionMs,
      bottlenecks: [],
      reasonCodes: critical.reasonCodes,
    };
  }

  const criticalPath = criticalPathEntries(critical.path);
  return {
    totalWallMs,
    categories,
    classifiedIntervalUnionMs,
    summedWorkMs,
    criticalPathMs: intervalUnionMs(critical.path),
    criticalPath,
    unattributedRuntimeOverheadMs: totalWallMs - classifiedIntervalUnionMs,
    bottlenecks: buildBottlenecks(intervals, criticalPath),
    reasonCodes: [],
  };
}
