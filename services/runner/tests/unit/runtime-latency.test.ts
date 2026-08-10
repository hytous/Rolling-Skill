import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

import {
  analyzeRuntimeLatency,
  extractRuntimeIntervals,
  type RuntimeInterval,
  type RunnerLifecycleMark,
} from "../../src/evaluation/runtime-latency.ts";
import type {
  CodexValidatedRolloutEvent,
  JsonValue,
} from "../../src/engines/sandbox_agent/codex-rollout-schema.ts";
import { readCodexRolloutBundle } from "../../src/engines/sandbox_agent/codex-rollout-reader.ts";

function interval(
  value: Partial<RuntimeInterval> &
    Pick<RuntimeInterval, "id" | "category" | "startMs" | "endMs">,
): RuntimeInterval {
  return {
    sequence: 1,
    locator: `event:${value.id}`,
    ...value,
  };
}

function event(
  seq: number,
  wallTimeUnixMs: number,
  type: string,
  payload: Record<string, JsonValue> = {},
  identity: { threadId?: string | null; turnId?: string | null } = {},
): CodexValidatedRolloutEvent {
  return {
    schemaVersion: 1,
    seq,
    wallTimeUnixMs,
    rolloutId: "rollout-1",
    threadId:
      identity.threadId === undefined
        ? typeof payload.thread_id === "string"
          ? payload.thread_id
          : "thread-root"
        : identity.threadId,
    codexTurnId:
      identity.turnId === undefined
        ? typeof payload.codex_turn_id === "string"
          ? payload.codex_turn_id
          : "turn-1"
        : identity.turnId,
    type,
    knownType: true,
    payload: { type, ...payload },
    payloadRefs: [],
    byteLength: 1,
    rawLineSha256: `sha-${seq}`,
  };
}

describe("runtime latency analysis", () => {
  it("extracts the native v1 fixture without inventing retry metadata", async () => {
    const fixtureDirectory = fileURLToPath(
      new URL(
        "../fixtures/codex-rollout-evidence/valid-root-terminal",
        import.meta.url,
      ),
    );
    const bundle = await readCodexRolloutBundle(fixtureDirectory);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) throw new Error("fixture must be valid");

    const extracted = extractRuntimeIntervals({
      rootThreadId: bundle.identity.rootThreadId,
      events: bundle.events,
    });

    expect(extracted.issues).toEqual([]);
    const inference = extracted.intervals.find(
      (entry) => entry.id === "inference:inference-1",
    );
    expect(inference).toMatchObject({
      category: "provider_sampling_wait",
      attemptOrdinal: 1,
      startMs: 1030,
      endMs: 1040,
      parentId: "root_turn:turn-1",
    });
    expect(inference).not.toHaveProperty("retry");
    expect(extracted.intervals).toContainEqual(
      expect.objectContaining({
        id: "trace_finalization:rollout-valid",
        category: "trace_finalization",
        startMs: 1060,
        endMs: 1070,
      }),
    );
  });

  it("recognizes terminal runtime boundaries from the native v1 tool fixture", async () => {
    const fixtureDirectory = fileURLToPath(
      new URL(
        "../fixtures/codex-rollout-evidence/open-runtime",
        import.meta.url,
      ),
    );
    const bundle = await readCodexRolloutBundle(fixtureDirectory);
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) throw new Error("fixture must be valid");

    const extracted = extractRuntimeIntervals({
      rootThreadId: bundle.identity.rootThreadId,
      events: bundle.events,
    });

    expect(extracted.intervals).toContainEqual(
      expect.objectContaining({
        id: "terminal:tool-open",
        category: "terminal_operation",
        parentId: "tool:tool-open",
        startMs: 3060,
        endMs: 3070,
      }),
    );
    expect(extracted.issues).toContainEqual(
      expect.objectContaining({
        code: "RUNTIME_TERMINAL_MISSING",
        id: "code_cell:cell-open",
      }),
    );
  });

  it("filters child Codex turn boundaries symmetrically", () => {
    const extracted = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events: [
        event(1, 100, "codex_turn_started", {
          thread_id: "thread-root",
          codex_turn_id: "turn-root",
        }),
        event(
          2,
          110,
          "codex_turn_started",
          { thread_id: "thread-child", codex_turn_id: "turn-child" },
          { threadId: "thread-child", turnId: "turn-child" },
        ),
        event(
          3,
          120,
          "codex_turn_ended",
          { codex_turn_id: "turn-child", status: "completed" },
          { threadId: "thread-child", turnId: "turn-child" },
        ),
        event(4, 130, "codex_turn_ended", {
          codex_turn_id: "turn-root",
          status: "completed",
        }),
      ],
    });

    expect(extracted.issues).toEqual([]);
    expect(extracted.intervals).toEqual([
      expect.objectContaining({ id: "root_turn:turn-root" }),
    ]);
  });

  it("derives attempt ordinals and accepts retry only as an explicit observation", () => {
    const events = [
      event(1, 100, "codex_turn_started", {
        thread_id: "thread-root",
        codex_turn_id: "turn-1",
      }),
      event(2, 110, "inference_started", {
        inference_call_id: "inference-1",
        thread_id: "thread-root",
        codex_turn_id: "turn-1",
        model: "gpt-test",
        provider_name: "test-provider",
      }),
      event(3, 120, "inference_failed", {
        inference_call_id: "inference-1",
        error: "transient",
      }),
      event(4, 130, "inference_started", {
        inference_call_id: "inference-2",
        thread_id: "thread-root",
        codex_turn_id: "turn-1",
        model: "gpt-test",
        provider_name: "test-provider",
      }),
      event(5, 150, "inference_completed", {
        inference_call_id: "inference-2",
      }),
      event(6, 160, "codex_turn_ended", {
        codex_turn_id: "turn-1",
        status: "completed",
      }),
    ];

    const withoutObservation = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events,
    });
    expect(
      withoutObservation.intervals.filter(
        (entry) => entry.category === "provider_sampling_wait",
      ),
    ).toEqual([
      expect.objectContaining({ id: "inference:inference-1", attemptOrdinal: 1 }),
      expect.objectContaining({ id: "inference:inference-2", attemptOrdinal: 2 }),
    ]);
    expect(
      withoutObservation.intervals.find(
        (entry) => entry.id === "inference:inference-1",
      ),
    ).not.toHaveProperty("retry");

    const withObservation = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events,
      retryObservations: [
        { inferenceCallId: "inference-1", willRetry: true },
      ],
    });
    expect(
      withObservation.intervals.find(
        (entry) => entry.id === "inference:inference-1",
      ),
    ).toMatchObject({ retry: true, attemptOrdinal: 1 });
  });

  it("parents code-cell tools from requester and emits terminals only for terminal kinds", () => {
    const extracted = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events: [
        event(1, 100, "codex_turn_started", {
          thread_id: "thread-root",
          codex_turn_id: "turn-1",
        }),
        event(2, 110, "code_cell_started", {
          runtime_cell_id: "cell-1",
          model_visible_call_id: "call-cell",
          source_js: "text('ok')",
        }),
        event(3, 120, "tool_call_started", {
          tool_call_id: "terminal-tool",
          requester: { type: "code_cell", runtime_cell_id: "cell-1" },
          kind: { type: "exec_command" },
          summary: { type: "generic", label: "exec_command" },
        }),
        event(4, 125, "tool_call_runtime_started", {
          tool_call_id: "terminal-tool",
        }),
        event(5, 140, "tool_call_runtime_ended", {
          tool_call_id: "terminal-tool",
          status: "completed",
        }),
        event(6, 145, "tool_call_ended", {
          tool_call_id: "terminal-tool",
          status: "completed",
        }),
        event(7, 150, "tool_call_started", {
          tool_call_id: "web-tool",
          requester: { type: "model" },
          kind: { type: "web" },
          summary: { type: "generic", label: "web_search" },
        }),
        event(8, 155, "tool_call_runtime_started", {
          tool_call_id: "web-tool",
        }),
        event(9, 160, "tool_call_runtime_ended", {
          tool_call_id: "web-tool",
          status: "completed",
        }),
        event(10, 165, "tool_call_ended", {
          tool_call_id: "web-tool",
          status: "completed",
        }),
        event(11, 170, "code_cell_ended", {
          runtime_cell_id: "cell-1",
          status: "completed",
        }),
        event(12, 180, "codex_turn_ended", {
          codex_turn_id: "turn-1",
          status: "completed",
        }),
      ],
    });

    expect(extracted.issues).toEqual([]);
    expect(
      extracted.intervals.find((entry) => entry.id === "tool:terminal-tool"),
    ).toMatchObject({ parentId: "code_cell:cell-1" });
    expect(
      extracted.intervals.filter(
        (entry) => entry.category === "terminal_operation",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "terminal:terminal-tool",
        parentId: "tool:terminal-tool",
        startMs: 125,
        endMs: 140,
      }),
    ]);
  });

  it("builds turn stages so the longest parallel tool blocks the critical path", () => {
    const extracted = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events: [
        event(1, 0, "codex_turn_started", {
          thread_id: "thread-root",
          codex_turn_id: "turn-1",
        }),
        event(2, 10, "inference_started", {
          inference_call_id: "inference-1",
          thread_id: "thread-root",
          codex_turn_id: "turn-1",
          model: "gpt-test",
          provider_name: "test-provider",
        }),
        event(3, 20, "inference_completed", {
          inference_call_id: "inference-1",
        }),
        event(4, 21, "tool_call_started", {
          tool_call_id: "tool-short",
          requester: { type: "model" },
          kind: { type: "web" },
          summary: { type: "generic", label: "web_search" },
        }),
        event(5, 22, "tool_call_started", {
          tool_call_id: "tool-blocking",
          requester: { type: "model" },
          kind: { type: "web" },
          summary: { type: "generic", label: "web_search" },
        }),
        event(6, 50, "tool_call_ended", {
          tool_call_id: "tool-short",
          status: "completed",
        }),
        event(7, 70, "tool_call_ended", {
          tool_call_id: "tool-blocking",
          status: "completed",
        }),
        event(8, 71, "inference_started", {
          inference_call_id: "inference-2",
          thread_id: "thread-root",
          codex_turn_id: "turn-1",
          model: "gpt-test",
          provider_name: "test-provider",
        }),
        event(9, 90, "inference_completed", {
          inference_call_id: "inference-2",
        }),
        event(10, 100, "codex_turn_ended", {
          codex_turn_id: "turn-1",
          status: "completed",
        }),
        event(
          11,
          105,
          "thread_ended",
          { thread_id: "thread-root", status: "completed" },
          { threadId: null, turnId: null },
        ),
        event(
          12,
          110,
          "rollout_ended",
          { status: "completed" },
          { threadId: null, turnId: null },
        ),
      ],
    });

    expect(extracted.issues).toEqual([]);
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 110 },
      intervals: extracted.intervals,
    });
    const criticalIds = report.criticalPath.map((entry) => entry.id);
    expect(criticalIds).toContain("inference:inference-1");
    expect(criticalIds).toContain("tool:tool-blocking");
    expect(criticalIds).not.toContain("tool:tool-short");
    expect(criticalIds).toContain("inference:inference-2");
    expect(criticalIds).toContain("trace_finalization:rollout-1");
    expect(
      report.bottlenecks.find((entry) => entry.id === "tool:tool-blocking"),
    ).toMatchObject({ offCriticalPath: false });
    expect(
      report.bottlenecks.find((entry) => entry.id === "tool:tool-short"),
    ).toMatchObject({ offCriticalPath: true });
  });

  it("serializes acquisition setup before the first root turn", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 300 },
      intervals: [
        interval({
          id: "setup",
          category: "acquisition_setup",
          startMs: 0,
          endMs: 200,
          sequence: 1,
        }),
        interval({
          id: "root",
          category: null,
          role: "root_turn",
          startMs: 200,
          endMs: 300,
          sequence: 2,
        }),
        interval({
          id: "provider",
          category: "provider_sampling_wait",
          startMs: 210,
          endMs: 290,
          sequence: 3,
          parentId: "root",
        }),
      ],
    });

    expect(report.criticalPath.map((entry) => entry.id)).toEqual([
      "setup",
      "root",
      "provider",
    ]);
    expect(report.criticalPathMs).toBe(300);
    expect(
      report.bottlenecks.find((entry) => entry.id === "provider"),
    ).toMatchObject({ offCriticalPath: false });
  });

  it("namespaces runner mark relationships consistently", () => {
    const extracted = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events: [],
      runnerMarks: [
        {
          id: "setup",
          category: "acquisition_setup",
          boundary: "start",
          wallTimeUnixMs: 0,
          sequence: 1,
          locator: "runner:setup:start",
        },
        {
          id: "queue",
          category: "queue_wait",
          boundary: "start",
          wallTimeUnixMs: 5,
          sequence: 2,
          locator: "runner:queue:start",
          parentId: "setup",
          causalParentIds: ["setup"],
        },
        {
          id: "queue",
          category: "queue_wait",
          boundary: "end",
          wallTimeUnixMs: 10,
          sequence: 3,
          locator: "runner:queue:end",
        },
        {
          id: "setup",
          category: "acquisition_setup",
          boundary: "end",
          wallTimeUnixMs: 20,
          sequence: 4,
          locator: "runner:setup:end",
        },
      ],
    });

    expect(extracted.intervals).toContainEqual(
      expect.objectContaining({
        id: "runner:queue",
        parentId: "runner:setup",
        causalParentIds: ["runner:setup"],
      }),
    );
  });

  it("handles a 5k-deep causal chain without recursive stack growth", () => {
    const intervals = Array.from({ length: 5_000 }, (_, index) =>
      interval({
        id: `deep-${index}`,
        category: "tool_execution",
        startMs: index,
        endMs: index + 1,
        sequence: index + 1,
        ...(index === 0 ? {} : { causalParentIds: [`deep-${index - 1}`] }),
      }),
    );
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 5_000 },
      intervals,
    });

    expect(report.reasonCodes).toEqual([]);
    expect(report.criticalPath).toHaveLength(5_000);
    expect(report.criticalPathMs).toBe(5_000);
  });

  it("handles a 5k-wide containment graph in bounded time", () => {
    const intervals: RuntimeInterval[] = [
      interval({
        id: "wide-root",
        category: null,
        role: "root_turn",
        startMs: 0,
        endMs: 100,
        sequence: 1,
      }),
      ...Array.from({ length: 5_000 }, (_, index) =>
        interval({
          id: `wide-${index}`,
          category: "tool_execution",
          startMs: 10,
          endMs: 90,
          sequence: index + 2,
        }),
      ),
    ];
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals,
    });

    expect(report.reasonCodes).toEqual([]);
    expect(report.criticalPathMs).toBe(100);
    expect(report.bottlenecks).toHaveLength(5_000);
  });

  it("extracts provider sampling/wait and runner intervals from observable boundaries", () => {
    const runnerMarks: RunnerLifecycleMark[] = [
      {
        id: "acquire",
        category: "acquisition_setup",
        boundary: "start",
        wallTimeUnixMs: 50,
        sequence: 1,
        locator: "runner:acquire:start",
      },
      {
        id: "acquire",
        category: "acquisition_setup",
        boundary: "end",
        wallTimeUnixMs: 90,
        sequence: 2,
        locator: "runner:acquire:end",
      },
    ];
    const extracted = extractRuntimeIntervals({
      rootThreadId: "thread-root",
      events: [
        event(1, 100, "codex_turn_started", {
          thread_id: "thread-root",
          codex_turn_id: "turn-1",
        }),
        event(2, 120, "inference_started", {
          inference_call_id: "inference-1",
        }),
        event(3, 180, "inference_completed", {
          inference_call_id: "inference-1",
        }),
        event(4, 200, "codex_turn_ended", {
          codex_turn_id: "turn-1",
        }),
      ],
      runnerMarks,
    });

    expect(extracted.issues).toEqual([]);
    expect(extracted.intervals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runner:acquire",
          category: "acquisition_setup",
          startMs: 50,
          endMs: 90,
        }),
        expect.objectContaining({
          id: "root_turn:turn-1",
          category: null,
          role: "root_turn",
          startMs: 100,
          endMs: 200,
        }),
        expect.objectContaining({
          id: "inference:inference-1",
          category: "provider_sampling_wait",
          parentId: "root_turn:turn-1",
          startMs: 120,
          endMs: 180,
          locator: "events:2-3",
        }),
        expect.objectContaining({
          role: "stage_join",
          causalParentIds: ["inference:inference-1"],
        }),
      ]),
    );

    const report = analyzeRuntimeLatency({
      wall: { startMs: 50, endMs: 200 },
      intervals: extracted.intervals,
    });
    expect(report.categories.provider_sampling_wait.intervalUnionMs).toBe(60);
    expect(report.categories.acquisition_setup.intervalUnionMs).toBe(40);
    expect(report.summedWorkMs).toBe(100);
    expect(report.criticalPathMs).toBe(140);
  });

  it("uses root turns only as graph boundaries, not terminal-operation cost", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [
        interval({
          id: "root-turn",
          category: null,
          role: "root_turn",
          startMs: 0,
          endMs: 100,
          sequence: 1,
        }),
        interval({
          id: "provider",
          category: "provider_sampling_wait",
          startMs: 20,
          endMs: 80,
          sequence: 2,
          parentId: "root-turn",
        }),
      ],
    });

    expect(report.categories.terminal_operation.intervalUnionMs).toBe(0);
    expect(report.classifiedIntervalUnionMs).toBe(60);
    expect(report.summedWorkMs).toBe(60);
    expect(report.criticalPathMs).toBe(100);
    expect(report.criticalPath[0]).toMatchObject({
      id: "root-turn",
      category: null,
      role: "root_turn",
    });
    expect(report.bottlenecks.map((entry) => entry.id)).toEqual(["provider"]);
  });

  it("fails critical-path analysis when a nesting parent does not contain its child", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [
        interval({
          id: "root-turn",
          category: null,
          role: "root_turn",
          startMs: 0,
          endMs: 40,
          sequence: 1,
        }),
        interval({
          id: "provider",
          category: "provider_sampling_wait",
          startMs: 30,
          endMs: 60,
          sequence: 2,
          parentId: "root-turn",
        }),
      ],
    });

    expect(report.categories.provider_sampling_wait.intervalUnionMs).toBe(30);
    expect(report.classifiedIntervalUnionMs).toBe(30);
    expect(report.summedWorkMs).toBe(30);
    expect(report.criticalPathMs).toBeNull();
    expect(report.bottlenecks).toEqual([]);
    expect(report.reasonCodes).toEqual([
      "PARENT_NOT_TEMPORALLY_CONTAINED",
    ]);
  });

  it("fails closed when a causal predecessor ends after its dependent starts", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 150 },
      intervals: [
        interval({
          id: "predecessor",
          category: "tool_execution",
          startMs: 0,
          endMs: 100,
          sequence: 1,
        }),
        interval({
          id: "dependent",
          category: "provider_sampling_wait",
          startMs: 50,
          endMs: 150,
          sequence: 2,
          causalParentIds: ["predecessor"],
        }),
      ],
    });

    expect(report.criticalPathMs).toBeNull();
    expect(report.criticalPath).toEqual([]);
    expect(report.bottlenecks).toEqual([]);
    expect(report.reasonCodes).toEqual(["CAUSAL_ORDER_INVALID"]);
  });

  it("clips every metric and reported bottleneck to the same wall window", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [
        interval({
          id: "tool-before",
          category: "tool_execution",
          startMs: -20,
          endMs: 50,
          sequence: 1,
        }),
        interval({
          id: "tool-after",
          category: "tool_execution",
          startMs: 80,
          endMs: 120,
          sequence: 2,
          causalParentIds: ["tool-before"],
        }),
      ],
    });

    expect(report.categories.tool_execution).toMatchObject({
      intervalUnionMs: 70,
      summedWorkMs: 70,
    });
    expect(report.classifiedIntervalUnionMs).toBe(70);
    expect(report.summedWorkMs).toBe(70);
    expect(report.criticalPathMs).toBe(70);
    expect(report.unattributedRuntimeOverheadMs).toBe(30);
    expect(report.bottlenecks).toEqual([
      expect.objectContaining({
        id: "tool-before",
        interval: { startMs: 0, endMs: 50 },
        intervalUnionMs: 50,
      }),
      expect.objectContaining({
        id: "tool-after",
        interval: { startMs: 80, endMs: 100 },
        intervalUnionMs: 20,
      }),
    ]);
  });

  it("breaks equally blocking critical-path ties directly by sequence and id", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [
        interval({
          id: "root",
          category: null,
          role: "root_turn",
          startMs: 0,
          endMs: 100,
          sequence: 1,
        }),
        interval({
          id: "long-late-sequence",
          category: "child_agent_work",
          startMs: 10,
          endMs: 90,
          sequence: 10,
          parentId: "root",
        }),
        interval({
          id: "short-early-sequence-1",
          category: "child_agent_work",
          startMs: 10,
          endMs: 50,
          sequence: 2,
          parentId: "root",
        }),
        interval({
          id: "short-early-sequence-2",
          category: "child_agent_work",
          startMs: 50,
          endMs: 90,
          sequence: 3,
          parentId: "root",
          causalParentIds: ["short-early-sequence-1"],
        }),
      ],
    });

    expect(report.criticalPath.map((entry) => entry.id)).toEqual([
      "root",
      "short-early-sequence-1",
      "short-early-sequence-2",
    ]);
  });

  it("uses interval union for wall time and keeps overlapping summed work", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 200 },
      intervals: [
        interval({
          id: "tool-a",
          category: "tool_execution",
          startMs: 0,
          endMs: 100,
          sequence: 1,
        }),
        interval({
          id: "tool-b",
          category: "tool_execution",
          startMs: 50,
          endMs: 150,
          sequence: 2,
        }),
      ],
    });

    expect(report.categories.tool_execution).toMatchObject({
      available: true,
      intervalUnionMs: 150,
      summedWorkMs: 200,
      intervalCount: 2,
    });
    expect(report.totalWallMs).toBe(200);
    expect(report.classifiedIntervalUnionMs).toBe(150);
    expect(report.summedWorkMs).toBe(200);
    expect(report.unattributedRuntimeOverheadMs).toBe(50);
  });

  it("marks an affected category and dependent metrics unavailable on clock regression", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 200 },
      intervals: [
        interval({
          id: "provider",
          category: "provider_sampling_wait",
          startMs: 10,
          endMs: 60,
          sequence: 1,
        }),
        interval({
          id: "bad-tool",
          category: "tool_execution",
          startMs: 120,
          endMs: 80,
          sequence: 2,
        }),
      ],
    });

    expect(report.categories.provider_sampling_wait).toMatchObject({
      available: true,
      intervalUnionMs: 50,
      summedWorkMs: 50,
    });
    expect(report.categories.tool_execution).toMatchObject({
      available: false,
      intervalUnionMs: null,
      summedWorkMs: null,
      reasonCodes: ["CLOCK_REGRESSION"],
    });
    expect(report.classifiedIntervalUnionMs).toBeNull();
    expect(report.summedWorkMs).toBeNull();
    expect(report.criticalPathMs).toBeNull();
    expect(report.unattributedRuntimeOverheadMs).toBeNull();
    expect(report.bottlenecks).toEqual([]);
  });

  it("keeps parallel child work off the causal critical path", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 170 },
      intervals: [
        interval({
          id: "setup",
          category: "acquisition_setup",
          startMs: 0,
          endMs: 20,
          sequence: 1,
        }),
        interval({
          id: "child-fast",
          category: "child_agent_work",
          startMs: 20,
          endMs: 80,
          sequence: 2,
          causalParentIds: ["setup"],
        }),
        interval({
          id: "child-blocking",
          category: "child_agent_work",
          startMs: 20,
          endMs: 140,
          sequence: 3,
          causalParentIds: ["setup"],
        }),
        interval({
          id: "terminal",
          category: "terminal_operation",
          startMs: 140,
          endMs: 160,
          sequence: 4,
          causalParentIds: ["child-blocking"],
        }),
      ],
    });

    expect(report.criticalPathMs).toBe(160);
    expect(report.criticalPath.map((entry) => entry.id)).toEqual([
      "setup",
      "child-blocking",
      "terminal",
    ]);
    expect(
      report.bottlenecks.find((entry) => entry.id === "child-fast"),
    ).toMatchObject({
      criticalPathContributionMs: 0,
      offCriticalPath: true,
    });
    expect(
      report.bottlenecks.find((entry) => entry.id === "child-blocking"),
    ).toMatchObject({
      criticalPathContributionMs: 120,
      offCriticalPath: false,
    });
    expect(report.unattributedRuntimeOverheadMs).toBe(10);
  });

  it("uses temporal containment when an explicit parent is not present", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [
        interval({
          id: "root-turn",
          category: null,
          role: "root_turn",
          startMs: 0,
          endMs: 100,
          sequence: 1,
        }),
        interval({
          id: "provider-early",
          category: "provider_sampling_wait",
          startMs: 10,
          endMs: 40,
          sequence: 2,
        }),
        interval({
          id: "provider-blocking",
          category: "provider_sampling_wait",
          startMs: 50,
          endMs: 90,
          sequence: 3,
        }),
      ],
    });

    expect(report.criticalPath.map((entry) => entry.id)).toEqual([
      "root-turn",
      "provider-blocking",
    ]);
    expect(report.criticalPathMs).toBe(100);
    expect(report.criticalPath).toEqual([
      expect.objectContaining({ id: "root-turn", contributionMs: 60 }),
      expect.objectContaining({
        id: "provider-blocking",
        contributionMs: 40,
      }),
    ]);
  });

  it("ranks bottleneck ties by stable sequence and identifier ordering", () => {
    const firstInput = [
      interval({
        id: "z-tool",
        category: "tool_execution",
        startMs: 50,
        endMs: 100,
        sequence: 7,
        causalParentIds: ["a-provider"],
      }),
      interval({
        id: "a-provider",
        category: "provider_sampling_wait",
        startMs: 0,
        endMs: 50,
        sequence: 7,
      }),
    ];

    const first = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: firstInput,
    });
    const second = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 100 },
      intervals: [...firstInput].reverse(),
    });

    expect(first.bottlenecks.map((entry) => entry.id)).toEqual([
      "a-provider",
      "z-tool",
    ]);
    expect(second).toEqual(first);
  });

  it("accounts for observable phases and labels provider retries precisely", () => {
    const report = analyzeRuntimeLatency({
      wall: { startMs: 0, endMs: 300 },
      intervals: [
        interval({
          id: "setup",
          category: "acquisition_setup",
          startMs: 0,
          endMs: 20,
          sequence: 1,
        }),
        interval({
          id: "queue",
          category: "queue_wait",
          startMs: 5,
          endMs: 15,
          sequence: 2,
          parentId: "setup",
        }),
        interval({
          id: "provider-attempt-1",
          category: "provider_sampling_wait",
          startMs: 20,
          endMs: 80,
          sequence: 3,
          causalParentIds: ["setup"],
          retry: true,
        }),
        interval({
          id: "provider-attempt-2",
          category: "provider_sampling_wait",
          startMs: 80,
          endMs: 160,
          sequence: 4,
          causalParentIds: ["provider-attempt-1"],
        }),
        interval({
          id: "tool-a",
          category: "tool_execution",
          startMs: 160,
          endMs: 240,
          sequence: 5,
          causalParentIds: ["provider-attempt-2"],
        }),
        interval({
          id: "tool-b",
          category: "tool_execution",
          startMs: 180,
          endMs: 230,
          sequence: 6,
          causalParentIds: ["provider-attempt-2"],
        }),
        interval({
          id: "code-cell",
          category: "code_cell",
          startMs: 190,
          endMs: 220,
          sequence: 7,
          causalParentIds: ["provider-attempt-2"],
        }),
        interval({
          id: "child",
          category: "child_agent_work",
          startMs: 160,
          endMs: 250,
          sequence: 8,
          causalParentIds: ["provider-attempt-2"],
        }),
        interval({
          id: "terminal",
          category: "terminal_operation",
          startMs: 250,
          endMs: 280,
          sequence: 9,
          causalParentIds: ["child"],
        }),
        interval({
          id: "finalize",
          category: "trace_finalization",
          startMs: 280,
          endMs: 300,
          sequence: 10,
          causalParentIds: ["terminal"],
        }),
      ],
    });

    expect(report.categories.provider_sampling_wait).toMatchObject({
      intervalUnionMs: 140,
      summedWorkMs: 140,
    });
    expect(report.categories.tool_execution).toMatchObject({
      intervalUnionMs: 80,
      summedWorkMs: 130,
    });
    expect(report.categories.child_agent_work.intervalUnionMs).toBe(90);
    expect(report.categories.queue_wait.intervalUnionMs).toBe(10);
    expect(report.categories.code_cell.intervalUnionMs).toBe(30);
    expect(report.categories.trace_finalization.intervalUnionMs).toBe(20);
    expect(report.classifiedIntervalUnionMs).toBe(300);
    expect(report.unattributedRuntimeOverheadMs).toBe(0);
    expect(report.criticalPath.map((entry) => entry.id)).toEqual([
      "setup",
      "provider-attempt-1",
      "provider-attempt-2",
      "child",
      "terminal",
      "finalize",
    ]);
    expect(
      report.bottlenecks.find(
        (entry) => entry.id === "provider-attempt-1",
      ),
    ).toMatchObject({ phase: "provider retry" });
    expect(
      report.bottlenecks.find(
        (entry) => entry.id === "provider-attempt-2",
      ),
    ).toMatchObject({ phase: "provider sampling/wait" });
    expect(report.bottlenecks.find((entry) => entry.id === "queue")).toMatchObject(
      { phase: "queue/wait", offCriticalPath: true },
    );
    expect(
      report.bottlenecks.find((entry) => entry.id === "code-cell"),
    ).toMatchObject({ phase: "code-cell execution", offCriticalPath: true });
    expect(JSON.stringify(report)).not.toMatch(/hidden|reasoning time/i);
  });
});
