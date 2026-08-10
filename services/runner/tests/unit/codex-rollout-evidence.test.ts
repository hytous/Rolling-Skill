/** Unit tests for bounded native Codex rollout evidence. Run: pnpm exec vitest run tests/unit/codex-rollout-evidence.test.ts */
import { afterEach, describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  promises as fsPromises,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  nodeCodexRolloutFilesystem,
  parseCodexRolloutSpine,
  readCodexRolloutBundle,
  type CodexRolloutBundle,
  type CodexRolloutFilesystem,
} from "../../src/engines/sandbox_agent/codex-rollout-reader.ts";
import {
  validateCodexEventPayloadV1,
  type JsonValue,
} from "../../src/engines/sandbox_agent/codex-rollout-schema.ts";
import {
  createCodexAttemptCursor,
  reduceCodexRolloutLifecycle,
} from "../../src/engines/sandbox_agent/codex-rollout-lifecycle.ts";
import {
  canonicalJson,
  createCodexEvidenceSummary,
} from "../../src/engines/sandbox_agent/codex-evidence-summary.ts";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/codex-rollout-evidence",
);
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryFixture(name: string): string {
  const directory = mkdtempSync(join(tmpdir(), "codex-rollout-evidence-"));
  temporaryDirectories.push(directory);
  cpSync(join(fixtureRoot, name), directory, { recursive: true });
  return directory;
}

function assertValid(
  result: Awaited<ReturnType<typeof readCodexRolloutBundle>>,
): asserts result is CodexRolloutBundle {
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
}

function reasonCodes(
  result: Awaited<ReturnType<typeof readCodexRolloutBundle>>,
): string[] {
  return result.reasons.map((reason) => reason.code);
}

function rawPayloadRef(id: string, path = `payloads/${id}.json`): JsonValue {
  return {
    raw_payload_id: id,
    kind: { type: "protocol_event" },
    path,
  };
}

function readFixtureEvents(directory: string): Array<Record<string, JsonValue>> {
  return readFileSync(join(directory, "trace.jsonl"), "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function writeFixtureEvents(
  directory: string,
  events: Array<Record<string, JsonValue>>,
): void {
  const resequenced = events.map((event, index) => ({ ...event, seq: index + 1 }));
  writeFileSync(
    join(directory, "trace.jsonl"),
    `${resequenced.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
}

describe("Codex rollout bundle reader", () => {
  it("reads a v1 manifest, contiguous newline-complete events, and recursive payload references", async () => {
    const result = await readCodexRolloutBundle(
      join(fixtureRoot, "valid-root-terminal"),
    );

    assertValid(result);
    assert.deepEqual(result.identity, {
      traceId: "trace-valid",
      rolloutId: "rollout-valid",
      rootThreadId: "thread-root",
    });
    assert.equal(result.events.length, 8);
    assert.equal(result.sequenceWatermark, 8);
    assert.deepEqual(
      result.payloads.map((payload) => payload.rawPayloadId),
      ["raw_payload:1", "raw_payload:2", "raw_payload:3"],
    );
    assert.equal(result.hardScoreEligible, true);
  });

  it("rejects missing, malformed, and unsupported manifests with stable reason codes", async () => {
    const missing = temporaryFixture("valid-root-terminal");
    rmSync(join(missing, "manifest.json"));
    const malformed = temporaryFixture("valid-root-terminal");
    writeFileSync(join(malformed, "manifest.json"), "{");
    const unsupported = temporaryFixture("valid-root-terminal");
    const manifest = JSON.parse(
      readFileSync(join(unsupported, "manifest.json"), "utf8"),
    );
    manifest.schema_version = 2;
    writeFileSync(join(unsupported, "manifest.json"), JSON.stringify(manifest));

    expect(reasonCodes(await readCodexRolloutBundle(missing))).toContain(
      "MANIFEST_MISSING",
    );
    expect(reasonCodes(await readCodexRolloutBundle(malformed))).toContain(
      "MANIFEST_MALFORMED",
    );
    expect(reasonCodes(await readCodexRolloutBundle(unsupported))).toContain(
      "MANIFEST_VERSION_UNSUPPORTED",
    );
  });

  it("rejects a sequence gap and a non-newline-complete final event", async () => {
    const truncated = temporaryFixture("turn-terminal");
    const truncatedLog = readFileSync(join(truncated, "trace.jsonl"), "utf8");
    writeFileSync(join(truncated, "trace.jsonl"), truncatedLog.trimEnd());

    const gapResult = await readCodexRolloutBundle(
      join(fixtureRoot, "malformed-sequence"),
    );
    expect(reasonCodes(gapResult)).toContain("EVENT_SEQUENCE_NONCONTIGUOUS");
    expect(gapResult.reasons).toContainEqual(
      expect.objectContaining({ line: 2, seq: 3 }),
    );
    expect(reasonCodes(await readCodexRolloutBundle(truncated))).toContain(
      "EVENT_LOG_NOT_NEWLINE_COMPLETE",
    );
  });

  it("rejects event and lifecycle identities that disagree with the manifest or envelope", async () => {
    const rolloutMismatch = temporaryFixture("turn-terminal");
    writeFileSync(
      join(rolloutMismatch, "trace.jsonl"),
      readFileSync(join(rolloutMismatch, "trace.jsonl"), "utf8").replace(
        '"rollout_id":"rollout-turn"',
        '"rollout_id":"different-rollout"',
      ),
    );
    const turnMismatch = temporaryFixture("turn-terminal");
    writeFileSync(
      join(turnMismatch, "trace.jsonl"),
      readFileSync(join(turnMismatch, "trace.jsonl"), "utf8").replace(
        '"payload":{"type":"codex_turn_started","codex_turn_id":"turn-warm","thread_id":"thread-root"}',
        '"payload":{"type":"codex_turn_started","codex_turn_id":"turn-other","thread_id":"thread-child"}',
      ),
    );

    expect(reasonCodes(await readCodexRolloutBundle(rolloutMismatch))).toContain(
      "EVENT_ROLLOUT_ID_MISMATCH",
    );
    const mismatchCodes = reasonCodes(await readCodexRolloutBundle(turnMismatch));
    expect(mismatchCodes).toContain("EVENT_THREAD_ID_MISMATCH");
    expect(mismatchCodes).toContain("EVENT_TURN_ID_MISMATCH");
  });

  it("finds nested payload refs and rejects missing or malformed payloads", async () => {
    const malformed = temporaryFixture("valid-root-terminal");
    writeFileSync(join(malformed, "payloads/3.json"), "{");

    expect(
      reasonCodes(
        await readCodexRolloutBundle(join(fixtureRoot, "missing-payload")),
      ),
    ).toContain("PAYLOAD_MISSING");
    expect(reasonCodes(await readCodexRolloutBundle(malformed))).toContain(
      "PAYLOAD_MALFORMED",
    );
  });

  it("rejects lexical traversal and symlink escape before reading payload content", async () => {
    const symlinkEscape = temporaryFixture("valid-root-terminal");
    const outsideDirectory = mkdtempSync(join(tmpdir(), "codex-evidence-outside-"));
    temporaryDirectories.push(outsideDirectory);
    const outsidePayload = join(outsideDirectory, "outside.json");
    writeFileSync(outsidePayload, '{"secret":"must-not-be-read"}');
    rmSync(join(symlinkEscape, "payloads/2.json"));
    symlinkSync(outsidePayload, join(symlinkEscape, "payloads/2.json"));

    expect(
      reasonCodes(
        await readCodexRolloutBundle(join(fixtureRoot, "path-escape")),
      ),
    ).toContain("PAYLOAD_PATH_ESCAPE");
    expect(reasonCodes(await readCodexRolloutBundle(symlinkEscape))).toContain(
      "PAYLOAD_SYMLINK_ESCAPE",
    );
  });

  it("preserves unknown event payloads opaquely but makes them hard-score ineligible", async () => {
    const result = await readCodexRolloutBundle(
      join(fixtureRoot, "unsupported-event"),
    );
    assertValid(result);
    assert.equal(result.events[1]?.knownType, false);
    assert.equal(result.events[1]?.type, "future_runtime_observation");
    assert.deepEqual(result.payloads.map((payload) => payload.rawPayloadId), [
      "raw_payload:future",
    ]);
    assert.equal(result.hardScoreEligible, false);
    expect(reasonCodes(result)).toContain("EVENT_TYPE_UNSUPPORTED");
  });

  it("fails closed at configured event-log, event-count, payload, and total byte limits", async () => {
    const directory = join(fixtureRoot, "valid-root-terminal");

    expect(
      reasonCodes(
        await readCodexRolloutBundle(directory, { maxEventLogBytes: 32 }),
      ),
    ).toContain("EVENT_LOG_TOO_LARGE");
    expect(
      reasonCodes(await readCodexRolloutBundle(directory, { maxEvents: 2 })),
    ).toContain("EVENT_COUNT_LIMIT_EXCEEDED");
    expect(
      reasonCodes(
        await readCodexRolloutBundle(directory, { maxPayloadBytes: 8 }),
      ),
    ).toContain("PAYLOAD_TOO_LARGE");
    expect(
      reasonCodes(
        await readCodexRolloutBundle(directory, { maxTotalBytes: 64 }),
      ),
    ).toContain("BUNDLE_TOO_LARGE");
  });
});

describe("complete Codex v1 structural validation", () => {
  const validPayloads: Record<string, Record<string, JsonValue>> = {
    rollout_started: {
      type: "rollout_started",
      trace_id: "trace-1",
      root_thread_id: "thread-root",
    },
    rollout_ended: { type: "rollout_ended", status: "completed" },
    thread_started: {
      type: "thread_started",
      thread_id: "thread-root",
      agent_path: "/root",
      metadata_payload: null,
    },
    thread_ended: {
      type: "thread_ended",
      thread_id: "thread-root",
      status: "completed",
    },
    codex_turn_started: {
      type: "codex_turn_started",
      codex_turn_id: "turn-1",
      thread_id: "thread-root",
    },
    codex_turn_ended: {
      type: "codex_turn_ended",
      codex_turn_id: "turn-1",
      status: "completed",
    },
    inference_started: {
      type: "inference_started",
      inference_call_id: "inference-1",
      thread_id: "thread-root",
      codex_turn_id: "turn-1",
      model: "gpt-test",
      provider_name: "test-provider",
      request_payload: rawPayloadRef("request-1"),
    },
    inference_completed: {
      type: "inference_completed",
      inference_call_id: "inference-1",
      response_id: null,
      upstream_request_id: null,
      response_payload: rawPayloadRef("response-1"),
    },
    inference_failed: {
      type: "inference_failed",
      inference_call_id: "inference-1",
      upstream_request_id: null,
      error: "provider failed",
      partial_response_payload: null,
    },
    inference_cancelled: {
      type: "inference_cancelled",
      inference_call_id: "inference-1",
      upstream_request_id: null,
      reason: "cancelled",
      partial_response_payload: null,
    },
    tool_call_started: {
      type: "tool_call_started",
      tool_call_id: "tool-1",
      model_visible_call_id: null,
      code_mode_runtime_tool_id: null,
      requester: { type: "model" },
      kind: { type: "mcp", server: "billing", tool: "query" },
      summary: {
        type: "generic",
        label: "billing.query",
        input_preview: null,
        output_preview: null,
      },
      invocation_payload: null,
    },
    mcp_tool_call_correlation_assigned: {
      type: "mcp_tool_call_correlation_assigned",
      tool_call_id: "tool-1",
      mcp_call_id: "mcp-1",
    },
    tool_call_runtime_started: {
      type: "tool_call_runtime_started",
      tool_call_id: "tool-1",
      runtime_payload: rawPayloadRef("runtime-start"),
    },
    tool_call_runtime_ended: {
      type: "tool_call_runtime_ended",
      tool_call_id: "tool-1",
      status: "completed",
      runtime_payload: rawPayloadRef("runtime-end"),
    },
    tool_call_ended: {
      type: "tool_call_ended",
      tool_call_id: "tool-1",
      status: "completed",
      result_payload: null,
    },
    code_cell_started: {
      type: "code_cell_started",
      runtime_cell_id: "cell-1",
      model_visible_call_id: "call-1",
      source_js: "1 + 1",
    },
    code_cell_initial_response: {
      type: "code_cell_initial_response",
      runtime_cell_id: "cell-1",
      status: "yielded",
      response_payload: null,
    },
    code_cell_ended: {
      type: "code_cell_ended",
      runtime_cell_id: "cell-1",
      status: "completed",
      response_payload: null,
    },
    compaction_request_started: {
      type: "compaction_request_started",
      compaction_id: "compaction-1",
      compaction_request_id: "request-1",
      thread_id: "thread-root",
      codex_turn_id: "turn-1",
      model: "gpt-test",
      provider_name: "test-provider",
      request_payload: rawPayloadRef("compaction-request"),
    },
    compaction_request_completed: {
      type: "compaction_request_completed",
      compaction_id: "compaction-1",
      compaction_request_id: "request-1",
      response_payload: rawPayloadRef("compaction-response"),
    },
    compaction_request_failed: {
      type: "compaction_request_failed",
      compaction_id: "compaction-1",
      compaction_request_id: "request-1",
      error: "failed",
    },
    compaction_installed: {
      type: "compaction_installed",
      compaction_id: "compaction-1",
      checkpoint_payload: rawPayloadRef("checkpoint-1"),
    },
    agent_result_observed: {
      type: "agent_result_observed",
      edge_id: "edge-1",
      child_thread_id: "thread-child",
      child_codex_turn_id: "turn-child",
      parent_thread_id: "thread-root",
      message: "done",
      carried_payload: null,
    },
    protocol_event_observed: {
      type: "protocol_event_observed",
      event_type: "item_completed",
      event_payload: rawPayloadRef("protocol-1"),
    },
    other: {
      type: "other",
      kind: "future_observation",
      summary: "opaque",
      payloads: [],
      metadata: {},
    },
  };

  const requiredFieldByType: Record<string, string> = {
    rollout_started: "trace_id",
    rollout_ended: "status",
    thread_started: "agent_path",
    thread_ended: "thread_id",
    codex_turn_started: "codex_turn_id",
    codex_turn_ended: "status",
    inference_started: "request_payload",
    inference_completed: "response_payload",
    inference_failed: "error",
    inference_cancelled: "reason",
    tool_call_started: "requester",
    mcp_tool_call_correlation_assigned: "mcp_call_id",
    tool_call_runtime_started: "runtime_payload",
    tool_call_runtime_ended: "status",
    tool_call_ended: "result_payload",
    code_cell_started: "source_js",
    code_cell_initial_response: "response_payload",
    code_cell_ended: "status",
    compaction_request_started: "provider_name",
    compaction_request_completed: "response_payload",
    compaction_request_failed: "error",
    compaction_installed: "checkpoint_payload",
    agent_result_observed: "carried_payload",
    protocol_event_observed: "event_payload",
    other: "metadata",
  };

  it("validates every known v1 discriminated payload and its required fields", () => {
    for (const [type, payload] of Object.entries(validPayloads)) {
      const valid = validateCodexEventPayloadV1(payload);
      assert.equal(valid.ok, true, `${type}: ${JSON.stringify(valid.reasons)}`);

      const missing = structuredClone(payload);
      delete missing[requiredFieldByType[type]!];
      const invalid = validateCodexEventPayloadV1(missing);
      assert.equal(invalid.ok, false, `${type} accepted a missing required field`);
      expect(invalid.reasons.map((reason) => reason.code)).toContain(
        "EVENT_PAYLOAD_INVALID",
      );
    }
  });

  it("rejects invalid nested discriminators, enums, and payload refs", () => {
    const invalidCases = [
      { ...validPayloads.rollout_ended, status: "surprise" },
      {
        ...validPayloads.tool_call_started,
        requester: { type: "code_cell" },
      },
      {
        ...validPayloads.tool_call_started,
        kind: { type: "mcp", server: "billing" },
      },
      {
        ...validPayloads.tool_call_started,
        summary: { type: "generic", label: "x", input_preview: 1 },
      },
      { ...validPayloads.code_cell_ended, status: "aborted" },
      {
        ...validPayloads.protocol_event_observed,
        event_payload: { raw_payload_id: "x", path: "payloads/x.json" },
      },
    ];

    for (const payload of invalidCases) {
      const result = validateCodexEventPayloadV1(payload);
      assert.equal(result.ok, false, JSON.stringify(payload));
      expect(result.reasons.map((reason) => reason.code)).toContain(
        "EVENT_PAYLOAD_INVALID",
      );
    }
  });

  it("requires the native v1 manifest filenames", async () => {
    for (const [field, value] of [
      ["raw_event_log", "events.jsonl"],
      ["payloads_dir", "raw"],
    ] as const) {
      const directory = temporaryFixture("valid-root-terminal");
      const manifestPath = join(directory, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      manifest[field] = value;
      writeFileSync(manifestPath, JSON.stringify(manifest));

      const result = await readCodexRolloutBundle(directory);
      expect(reasonCodes(result)).toContain("MANIFEST_FIELD_INVALID");
      expect(result.reasons).toContainEqual(
        expect.objectContaining({ field }),
      );
    }
  });

  it("counts all unique refs before I/O and detects same-id conflicts", async () => {
    const overLimit = temporaryFixture("turn-terminal");
    const events = readFixtureEvents(overLimit);
    events.splice(3, 0, {
      ...events[3]!,
      payload: {
        type: "other",
        kind: "unscored",
        summary: "three missing refs",
        payloads: [
          rawPayloadRef("missing-1"),
          rawPayloadRef("missing-2"),
          rawPayloadRef("missing-3"),
        ],
        metadata: {},
      },
    });
    writeFixtureEvents(overLimit, events);
    expect(
      reasonCodes(
        await readCodexRolloutBundle(overLimit, { maxPayloads: 2 }),
      ),
    ).toContain("PAYLOAD_COUNT_LIMIT_EXCEEDED");

    const conflict = temporaryFixture("turn-terminal");
    const conflictEvents = readFixtureEvents(conflict);
    conflictEvents.splice(3, 0, {
      ...conflictEvents[3]!,
      payload: {
        type: "other",
        kind: "unscored",
        summary: "conflicting refs",
        payloads: [
          rawPayloadRef("same-id", "payloads/a.json"),
          rawPayloadRef("same-id", "payloads/b.json"),
        ],
        metadata: {},
      },
    });
    writeFixtureEvents(conflict, conflictEvents);
    expect(reasonCodes(await readCodexRolloutBundle(conflict))).toContain(
      "PAYLOAD_REFERENCE_CONFLICT",
    );
  });

  it("keeps schema-known Other events opaque until their kind is evaluator-allowlisted", async () => {
    const directory = temporaryFixture("turn-terminal");
    const events = readFixtureEvents(directory);
    events.splice(3, 0, {
      ...events[3]!,
      payload: {
        type: "other",
        kind: "billing_eval_supported",
        summary: "bounded",
        payloads: [],
        metadata: {},
      },
    });
    writeFixtureEvents(directory, events);

    const opaque = await readCodexRolloutBundle(directory);
    assertValid(opaque);
    assert.equal(opaque.hardScoreEligible, false);
    expect(reasonCodes(opaque)).toContain("EVENT_OTHER_KIND_UNSUPPORTED");

    const supported = await readCodexRolloutBundle(directory, {
      supportedOtherEventKinds: new Set(["billing_eval_supported"]),
    });
    assertValid(supported);
    assert.equal(supported.hardScoreEligible, true);
  });

  it("reports the offending line and expected sequence for a truncated tail", async () => {
    const directory = temporaryFixture("turn-terminal");
    const path = join(directory, "trace.jsonl");
    writeFileSync(path, `${readFileSync(path, "utf8")} {\"schema_version\":1`);

    const result = await readCodexRolloutBundle(directory);
    expect(result.reasons).toContainEqual(
      expect.objectContaining({
        code: "EVENT_LOG_NOT_NEWLINE_COMPLETE",
        line: 5,
        seq: 5,
      }),
    );
  });

  it("uses an injected filesystem port and exposes a pure spine parser", async () => {
    const calls: string[] = [];
    const filesystem: CodexRolloutFilesystem = {
      realpath: async (path) => {
        calls.push(`realpath:${path}`);
        return fsPromises.realpath(path);
      },
      stat: async (path) => {
        calls.push(`stat:${path}`);
        const result = await fsPromises.stat(path);
        return { size: result.size, isFile: result.isFile() };
      },
      readFile: async (path) => {
        calls.push(`readFile:${path}`);
        return fsPromises.readFile(path);
      },
    };
    const directory = join(fixtureRoot, "valid-root-terminal");
    const injected = await readCodexRolloutBundle(directory, {}, filesystem);
    assertValid(injected);
    assert.ok(calls.some((call) => call.startsWith("readFile:")));
    assert.notEqual(filesystem, nodeCodexRolloutFilesystem);

    const spine = parseCodexRolloutSpine({
      manifestBytes: readFileSync(join(directory, "manifest.json")),
      eventLogBytes: readFileSync(join(directory, "trace.jsonl")),
    });
    assert.equal(spine.ok, true, JSON.stringify(spine.reasons));
    if (spine.ok) assert.equal(spine.events.length, 8);
  });

  it("rechecks payload and total byte limits after a lying stat result", async () => {
    const lyingFilesystem: CodexRolloutFilesystem = {
      realpath: (path) => nodeCodexRolloutFilesystem.realpath(path),
      stat: async (path) => {
        const actual = await nodeCodexRolloutFilesystem.stat(path);
        return path.includes("/payloads/")
          ? { ...actual, size: 1 }
          : actual;
      },
      readFile: (path) => nodeCodexRolloutFilesystem.readFile(path),
    };

    const payloadGrowth = await readCodexRolloutBundle(
      join(fixtureRoot, "valid-root-terminal"),
      { maxPayloadBytes: 8 },
      lyingFilesystem,
    );
    expect(reasonCodes(payloadGrowth)).toContain("PAYLOAD_TOO_LARGE");

    const singlePayloadDirectory = join(fixtureRoot, "unsupported-event");
    const fixedBytes =
      readFileSync(join(singlePayloadDirectory, "manifest.json")).byteLength +
      readFileSync(join(singlePayloadDirectory, "trace.jsonl")).byteLength;
    const totalGrowth = await readCodexRolloutBundle(
      singlePayloadDirectory,
      { maxTotalBytes: fixedBytes + 1 },
      lyingFilesystem,
    );
    expect(reasonCodes(totalGrowth)).toContain("BUNDLE_TOO_LARGE");
  });
});

describe("Codex rollout lifecycle", () => {
  it("distinguishes a root turn terminal from a root rollout terminal", async () => {
    const turnBundle = await readCodexRolloutBundle(
      join(fixtureRoot, "turn-terminal"),
    );
    const rolloutBundle = await readCodexRolloutBundle(
      join(fixtureRoot, "valid-root-terminal"),
    );
    assertValid(turnBundle);
    assertValid(rolloutBundle);

    const turn = reduceCodexRolloutLifecycle(turnBundle);
    const rollout = reduceCodexRolloutLifecycle(rolloutBundle);
    assert.equal(turn.completeness, "turn_complete");
    assert.equal(turn.hardScoreEligible, false);
    assert.equal(turn.targetThreadId, "thread-root");
    assert.equal(turn.targetTurnId, "turn-warm");
    assert.equal(rollout.completeness, "rollout_complete");
    assert.equal(rollout.hardScoreEligible, true);
    assert.equal(rollout.rootTerminalSeq, 8);
  });

  it("uses exclusive attempt cursors and stable warm-turn watermarks", async () => {
    const firstRead = await readCodexRolloutBundle(
      join(fixtureRoot, "turn-terminal"),
    );
    assertValid(firstRead);
    const cursor = createCodexAttemptCursor(firstRead);
    assert.deepEqual(cursor, {
      traceId: "trace-turn",
      rolloutId: "rollout-turn",
      rootThreadId: "thread-root",
      afterSeqExclusive: 4,
    });

    const directory = temporaryFixture("turn-terminal");
    const logPath = join(directory, "trace.jsonl");
    const suffix = [
      { type: "codex_turn_started", codex_turn_id: "turn-next", thread_id: "thread-root" },
      { type: "codex_turn_ended", codex_turn_id: "turn-next", status: "completed" },
    ].map((payload, index) =>
      JSON.stringify({
        schema_version: 1,
        seq: index + 5,
        wall_time_unix_ms: 2040 + index * 10,
        rollout_id: "rollout-turn",
        thread_id: "thread-root",
        codex_turn_id: "turn-next",
        payload,
      }),
    );
    writeFileSync(
      logPath,
      `${readFileSync(logPath, "utf8")}${suffix.join("\n")}\n`,
    );
    const secondRead = await readCodexRolloutBundle(directory);
    assertValid(secondRead);

    const secondAttempt = reduceCodexRolloutLifecycle(secondRead, cursor);
    assert.equal(secondAttempt.targetTurnId, "turn-next");
    assert.deepEqual(secondAttempt.watermark, {
      afterSeqExclusive: 4,
      toSeqInclusive: 6,
    });
    assert.equal(secondAttempt.completeness, "turn_complete");
  });

  it("reports yielded/open runtime objects as sorted quality warnings", async () => {
    const bundle = await readCodexRolloutBundle(
      join(fixtureRoot, "open-runtime"),
    );
    assertValid(bundle);

    const lifecycle = reduceCodexRolloutLifecycle(bundle);
    assert.equal(lifecycle.completeness, "rollout_complete");
    assert.equal(lifecycle.hardScoreEligible, true);
    assert.deepEqual(lifecycle.openRuntimeObjects, [
      { kind: "code_cell", id: "cell-open", startedSeq: 4 },
      { kind: "terminal_session", id: "pty-open", startedSeq: 7 },
    ]);
    assert.deepEqual(lifecycle.warnings, [
      {
        code: "OPEN_RUNTIME_OBJECT",
        kind: "code_cell",
        id: "cell-open",
        startedSeq: 4,
      },
      {
        code: "OPEN_RUNTIME_OBJECT",
        kind: "terminal_session",
        id: "pty-open",
        startedSeq: 7,
      },
    ]);
  });

  it("uses rollout_ended for completeness but gates hard scoring on the target turn and root ThreadEnded", async () => {
    const cases = [
      {
        name: "root-only",
        mutate(events: Array<Record<string, JsonValue>>) {
          return events.filter((event) => {
            const type = (event.payload as Record<string, JsonValue>).type;
            return ![
              "codex_turn_started",
              "inference_started",
              "inference_completed",
              "codex_turn_ended",
            ].includes(String(type));
          });
        },
        reason: "TARGET_TURN_START_MISSING",
      },
      {
        name: "missing-root-thread-end",
        mutate(events: Array<Record<string, JsonValue>>) {
          return events.filter(
            (event) =>
              (event.payload as Record<string, JsonValue>).type !==
              "thread_ended",
          );
        },
        reason: "ROOT_THREAD_END_MISSING",
      },
      {
        name: "root-thread-end-after-rollout",
        mutate(events: Array<Record<string, JsonValue>>) {
          const threadEnd = events.find(
            (event) =>
              (event.payload as Record<string, JsonValue>).type ===
              "thread_ended",
          )!;
          return [
            ...events.filter((event) => event !== threadEnd),
            threadEnd,
          ];
        },
        reason: "ROOT_THREAD_END_ORDER_INVALID",
      },
      {
        name: "wrong-root-thread-id",
        mutate(events: Array<Record<string, JsonValue>>) {
          const clone = structuredClone(events);
          const threadEnd = clone.find(
            (event) =>
              (event.payload as Record<string, JsonValue>).type ===
              "thread_ended",
          )!;
          (threadEnd.payload as Record<string, JsonValue>).thread_id =
            "thread-child";
          return clone;
        },
        reason: "ROOT_THREAD_ID_MISMATCH",
      },
    ];

    for (const testCase of cases) {
      const directory = temporaryFixture("valid-root-terminal");
      writeFixtureEvents(directory, testCase.mutate(readFixtureEvents(directory)));
      const bundle = await readCodexRolloutBundle(directory);
      assertValid(bundle);
      const lifecycle = reduceCodexRolloutLifecycle(bundle);
      assert.equal(
        lifecycle.completeness,
        "rollout_complete",
        testCase.name,
      );
      assert.equal(lifecycle.hardScoreEligible, false, testCase.name);
      expect(lifecycle.reasons.map((reason) => reason.code)).toContain(
        testCase.reason,
      );
    }
  });

  it("validates cursor identity and scopes warnings to the current attempt", async () => {
    const directory = temporaryFixture("turn-terminal");
    const events = readFixtureEvents(directory);
    const rolloutStart = events[0]!;
    const threadStart = events[1]!;
    const unknown = {
      ...events[2]!,
      payload: { type: "future_old_event", value: 1 },
    };
    const nextTurnStart = {
      ...events[2]!,
      payload: {
        type: "codex_turn_started",
        codex_turn_id: "turn-next",
        thread_id: "thread-root",
      },
      codex_turn_id: "turn-next",
    };
    const nextTurnEnd = {
      ...events[3]!,
      payload: {
        type: "codex_turn_ended",
        codex_turn_id: "turn-next",
        status: "completed",
      },
      codex_turn_id: "turn-next",
    };
    const threadEnd = {
      ...events[3]!,
      thread_id: null,
      codex_turn_id: null,
      payload: {
        type: "thread_ended",
        thread_id: "thread-root",
        status: "completed",
      },
    };
    const rolloutEnd = {
      ...threadEnd,
      payload: { type: "rollout_ended", status: "completed" },
    };
    writeFixtureEvents(directory, [
      rolloutStart,
      threadStart,
      unknown,
      nextTurnStart,
      nextTurnEnd,
      threadEnd,
      rolloutEnd,
    ]);
    const bundle = await readCodexRolloutBundle(directory);
    assertValid(bundle);
    assert.equal(bundle.hardScoreEligible, false);

    const cleanAttempt = reduceCodexRolloutLifecycle(bundle, {
      traceId: "trace-turn",
      rolloutId: "rollout-turn",
      afterSeqExclusive: 3,
    });
    assert.equal(cleanAttempt.completeness, "rollout_complete");
    assert.equal(cleanAttempt.hardScoreEligible, true);
    assert.equal(
      cleanAttempt.reasons.some(
        (reason) => reason.code === "EVENT_TYPE_UNSUPPORTED",
      ),
      false,
    );
    const cleanSummary = createCodexEvidenceSummary({
      bundle,
      lifecycle: cleanAttempt,
      artifactReference: "artifact://clean-attempt",
      collectedAtUnixMs: 9999,
    });
    assert.equal(
      cleanSummary.validationReasons.some(
        (reason) => reason.code === "EVENT_TYPE_UNSUPPORTED",
      ),
      false,
    );

    const wrongCursor = reduceCodexRolloutLifecycle(bundle, {
      traceId: "trace-other",
      rolloutId: "rollout-turn",
      afterSeqExclusive: 3,
    });
    assert.equal(wrongCursor.completeness, "invalid");
    assert.equal(wrongCursor.hardScoreEligible, false);
    expect(wrongCursor.reasons.map((reason) => reason.code)).toContain(
      "ATTEMPT_CURSOR_IDENTITY_MISMATCH",
    );
  });

  it("requires target turn end before root thread end and rollout end", async () => {
    for (const placement of ["after_thread", "after_rollout"] as const) {
      const directory = temporaryFixture("valid-root-terminal");
      const events = readFixtureEvents(directory);
      const turnEnd = events.find(
        (event) =>
          (event.payload as Record<string, JsonValue>).type ===
          "codex_turn_ended",
      )!;
      const withoutTurnEnd = events.filter((event) => event !== turnEnd);
      const rolloutEndIndex = withoutTurnEnd.findIndex(
        (event) =>
          (event.payload as Record<string, JsonValue>).type === "rollout_ended",
      );
      withoutTurnEnd.splice(
        placement === "after_thread" ? rolloutEndIndex : rolloutEndIndex + 1,
        0,
        turnEnd,
      );
      writeFixtureEvents(directory, withoutTurnEnd);

      const bundle = await readCodexRolloutBundle(directory);
      assertValid(bundle);
      const lifecycle = reduceCodexRolloutLifecycle(bundle);
      assert.equal(lifecycle.completeness, "rollout_complete", placement);
      assert.equal(lifecycle.hardScoreEligible, false, placement);
      expect(lifecycle.reasons.map((reason) => reason.code)).toContain(
        "TARGET_TURN_ORDER_INVALID",
      );
    }
  });

  it("does not treat running end-event statuses as terminal", async () => {
    const cases = [
      {
        fixture: "turn-terminal",
        eventType: "codex_turn_ended",
        completeness: "collecting",
        reason: "TARGET_TURN_TERMINAL_STATUS_INVALID",
      },
      {
        fixture: "valid-root-terminal",
        eventType: "thread_ended",
        completeness: "rollout_complete",
        reason: "ROOT_THREAD_TERMINAL_STATUS_INVALID",
      },
      {
        fixture: "valid-root-terminal",
        eventType: "rollout_ended",
        completeness: "turn_complete",
        reason: "ROLLOUT_TERMINAL_STATUS_INVALID",
      },
    ] as const;

    for (const testCase of cases) {
      const directory = temporaryFixture(testCase.fixture);
      const events = readFixtureEvents(directory);
      const terminal = events.find(
        (event) =>
          (event.payload as Record<string, JsonValue>).type ===
          testCase.eventType,
      )!;
      (terminal.payload as Record<string, JsonValue>).status = "running";
      writeFixtureEvents(directory, events);

      const bundle = await readCodexRolloutBundle(directory);
      assertValid(bundle);
      const lifecycle = reduceCodexRolloutLifecycle(bundle);
      assert.equal(
        lifecycle.completeness,
        testCase.completeness,
        testCase.eventType,
      );
      assert.equal(lifecycle.hardScoreEligible, false, testCase.eventType);
      expect(lifecycle.reasons.map((reason) => reason.code)).toContain(
        testCase.reason,
      );
    }
  });
});

describe("canonical Codex evidence summary", () => {
  it("uses canonical object ordering and stable collection ordering", () => {
    assert.equal(
      canonicalJson({ z: 1, nested: { y: true, a: false }, a: [3, 2, 1] }),
      '{"a":[3,2,1],"nested":{"a":false,"y":true},"z":1}',
    );
  });

  it("emits a bounded codex-evidence/v1 summary with a stable SHA-256 digest", async () => {
    const firstBundle = await readCodexRolloutBundle(
      join(fixtureRoot, "valid-root-terminal"),
    );
    const secondBundle = await readCodexRolloutBundle(
      temporaryFixture("valid-root-terminal"),
    );
    assertValid(firstBundle);
    assertValid(secondBundle);
    const firstLifecycle = reduceCodexRolloutLifecycle(firstBundle);
    const secondLifecycle = reduceCodexRolloutLifecycle(secondBundle);

    const first = createCodexEvidenceSummary({
      bundle: firstBundle,
      lifecycle: firstLifecycle,
      artifactReference: "artifact://worker-a/attempt-1",
      collectedAtUnixMs: 9000,
    });
    const second = createCodexEvidenceSummary({
      bundle: secondBundle,
      lifecycle: secondLifecycle,
      artifactReference: "artifact://worker-b/attempt-99",
      collectedAtUnixMs: 9999,
    });

    assert.equal(first.schemaVersion, "codex-evidence/v1");
    assert.match(first.evidenceDigest, /^[a-f0-9]{64}$/);
    assert.equal(first.evidenceDigest, second.evidenceDigest);
    assert.equal(first.completeness, "rollout_complete");
    assert.deepEqual(first.watermark, {
      afterSeqExclusive: 0,
      toSeqInclusive: 8,
    });
    assert.deepEqual(first.counts, {
      events: 8,
      payloadBytes: firstBundle.payloads.reduce(
        (total, payload) => total + payload.byteLength,
        0,
      ),
      payloads: 3,
      warnings: 0,
    });
    assert.deepEqual(first.capture, {
      startedAtUnixMs: 1000,
      observedThroughUnixMs: 1070,
      collectedAtUnixMs: 9000,
    });
    assert.deepEqual(first.byteSizes, {
      manifest: firstBundle.byteLengths.manifest,
      eventLog: firstBundle.byteLengths.eventLog,
      payloads: firstBundle.byteLengths.payloads,
      total: firstBundle.byteLengths.total,
    });
    assert.equal(JSON.stringify(first).includes("billing prompt"), false);
    assert.equal(JSON.stringify(first).includes("sensitive answer"), false);
    assert.equal(JSON.stringify(first).includes(temporaryFixture.name), false);
  });

  it("keeps settled attempt byte sizes isolated from later warm-turn events and payloads", async () => {
    const directory = temporaryFixture("turn-terminal");
    const payloadDirectory = join(directory, "payloads");
    const initialEvents = readFixtureEvents(directory);
    initialEvents.splice(3, 0, {
      ...initialEvents[3]!,
      payload: {
        type: "protocol_event_observed",
        event_type: "first_attempt_marker",
        event_payload: rawPayloadRef("first", "payloads/first.json"),
      },
    });
    writeFileSync(join(payloadDirectory, "first.json"), '{"first":true}');
    writeFixtureEvents(directory, initialEvents);

    const settledBundle = await readCodexRolloutBundle(directory);
    assertValid(settledBundle);
    const settledLifecycle = reduceCodexRolloutLifecycle(settledBundle, {
      toSeqInclusive: 5,
      targetTurnId: "turn-warm",
    });
    const settledSummary = createCodexEvidenceSummary({
      bundle: settledBundle,
      lifecycle: settledLifecycle,
      artifactReference: "artifact://settled",
      collectedAtUnixMs: 9100,
    });

    const laterEvents = readFixtureEvents(directory);
    laterEvents.push(
      {
        ...laterEvents[2]!,
        codex_turn_id: "turn-later",
        payload: {
          type: "codex_turn_started",
          codex_turn_id: "turn-later",
          thread_id: "thread-root",
        },
      },
      {
        ...laterEvents[3]!,
        codex_turn_id: "turn-later",
        payload: {
          type: "protocol_event_observed",
          event_type: "later_marker",
          event_payload: rawPayloadRef("later", "payloads/later.json"),
        },
      },
      {
        ...laterEvents[4]!,
        codex_turn_id: "turn-later",
        payload: {
          type: "codex_turn_ended",
          codex_turn_id: "turn-later",
          status: "completed",
        },
      },
    );
    writeFileSync(
      join(payloadDirectory, "later.json"),
      JSON.stringify({ later: "x".repeat(4096) }),
    );
    writeFixtureEvents(directory, laterEvents);
    const grownBundle = await readCodexRolloutBundle(directory);
    assertValid(grownBundle);
    const sameSettledLifecycle = reduceCodexRolloutLifecycle(grownBundle, {
      toSeqInclusive: 5,
      targetTurnId: "turn-warm",
    });
    const grownSummary = createCodexEvidenceSummary({
      bundle: grownBundle,
      lifecycle: sameSettledLifecycle,
      artifactReference: "artifact://grown",
      collectedAtUnixMs: 9200,
    });

    assert.deepEqual(grownSummary.byteSizes, settledSummary.byteSizes);
    assert.equal(
      settledSummary.byteSizes.eventLog,
      settledBundle.events
        .filter((event) => event.seq <= 5)
        .reduce((total, event) => total + event.byteLength, 0),
    );
    assert.equal(
      settledSummary.byteSizes.payloads,
      settledBundle.payloads.find(
        (payload) => payload.rawPayloadId === "first",
      )!.byteLength,
    );
    assert.equal(
      settledSummary.byteSizes.total,
      settledSummary.byteSizes.manifest +
        settledSummary.byteSizes.eventLog +
        settledSummary.byteSizes.payloads,
    );
  });
});
