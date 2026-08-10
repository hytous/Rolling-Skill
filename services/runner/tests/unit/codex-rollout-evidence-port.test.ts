import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { SandboxAgent } from "sandbox-agent";

import {
  createCodexRolloutEvidencePort,
  createDaytonaCodexRolloutEvidenceSource,
  createLocalCodexEvidenceSink,
  createLocalCodexRolloutEvidenceSource,
  runCodexEvidenceOperation,
  type CodexEvidenceSink,
  type CodexRolloutEvidenceSource,
} from "../../src/engines/sandbox_agent/codex-rollout-evidence.ts";
import { readCodexRolloutBundle } from "../../src/engines/sandbox_agent/codex-rollout-reader.ts";

const fixtureRoot = join(
  import.meta.dirname,
  "../fixtures/codex-rollout-evidence",
);
const temporaryRoots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function sourceWithFixture(name: string): {
  sourceRoot: string;
  bundleDirectory: string;
} {
  const sourceRoot = temporaryRoot("agenta-codex-source-");
  const bundleDirectory = join(sourceRoot, "root-thread");
  cpSync(join(fixtureRoot, name), bundleDirectory, { recursive: true });
  return { sourceRoot, bundleDirectory };
}

interface FixtureIdentity {
  traceId: string;
  rolloutId: string;
  rootThreadId: string;
}

function addTurnTerminalBundle(input: {
  sourceRoot: string;
  relativeDirectory: string;
  identity: FixtureIdentity;
}): string {
  const bundleDirectory = join(input.sourceRoot, input.relativeDirectory);
  cpSync(join(fixtureRoot, "turn-terminal"), bundleDirectory, {
    recursive: true,
  });
  for (const filename of ["manifest.json", "trace.jsonl"]) {
    const path = join(bundleDirectory, filename);
    const contents = readFileSync(path, "utf8")
      .replaceAll("trace-turn", input.identity.traceId)
      .replaceAll("rollout-turn", input.identity.rolloutId)
      .replaceAll("thread-root", input.identity.rootThreadId);
    writeFileSync(path, contents);
  }
  return bundleDirectory;
}

function rootTurnEvents(
  startSeq: number,
  identity: FixtureIdentity,
  turnId: string,
): Array<Record<string, unknown>> {
  return [
    event(
      startSeq,
      {
        type: "codex_turn_started",
        codex_turn_id: turnId,
        thread_id: identity.rootThreadId,
      },
      {
        rollout_id: identity.rolloutId,
        thread_id: identity.rootThreadId,
        codex_turn_id: turnId,
      },
    ),
    event(
      startSeq + 1,
      {
        type: "codex_turn_ended",
        codex_turn_id: turnId,
        status: "completed",
      },
      {
        rollout_id: identity.rolloutId,
        thread_id: identity.rootThreadId,
        codex_turn_id: turnId,
      },
    ),
  ];
}

function renameFixtureTurn(bundleDirectory: string, turnId: string): void {
  const path = join(bundleDirectory, "trace.jsonl");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replaceAll("turn-warm", turnId),
  );
}

function appendEvents(
  bundleDirectory: string,
  events: Array<Record<string, unknown>>,
): void {
  const tracePath = join(bundleDirectory, "trace.jsonl");
  const existing = readFileSync(tracePath, "utf8");
  const suffix = events.map((event) => JSON.stringify(event)).join("\n");
  writeFileSync(tracePath, `${existing}${suffix}\n`);
}

function event(
  seq: number,
  payload: Record<string, unknown>,
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    seq,
    wall_time_unix_ms: 2_000 + seq * 10,
    rollout_id: "rollout-turn",
    thread_id: "thread-root",
    codex_turn_id: "turn-next",
    payload,
    ...overrides,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("CodexRolloutEvidencePort", () => {
  it("reuses one attempt across pause/resume and upgrades it append-only at final sweep", async () => {
    const { sourceRoot, bundleDirectory } = sourceWithFixture("turn-terminal");
    const artifactRoot = temporaryRoot("agenta-codex-artifacts-");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-1",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({ artifactRoot }),
      attemptId: () => "attempt-1",
      now: () => 10_000,
      producerTrust: "runtime_isolated",
    });

    const beforePrompt = await port.beginTurn();
    const resumed = await port.beginTurn();
    assert.equal(beforePrompt.attemptId, "attempt-1");
    assert.strictEqual(resumed, beforePrompt, "resume reuses the active attempt");

    appendEvents(bundleDirectory, [
      event(5, {
        type: "codex_turn_started",
        codex_turn_id: "turn-next",
        thread_id: "thread-root",
      }),
      event(6, {
        type: "codex_turn_ended",
        codex_turn_id: "turn-next",
        status: "completed",
      }),
    ]);

    const settled = await port.settleTurn({ outcome: "completed" });
    assert.ok(settled);
    assert.equal(settled.attemptId, "attempt-1");
    assert.equal(settled.revision, 1);
    assert.equal(settled.summary?.completeness, "turn_complete");
    assert.equal(settled.projection.collectionStatus, "PENDING_TERMINAL");
    assert.deepEqual(settled.summary?.watermark, {
      afterSeqExclusive: 4,
      toSeqInclusive: 6,
    });

    appendEvents(bundleDirectory, [
      event(
        7,
        {
          type: "thread_ended",
          thread_id: "thread-root",
          status: "completed",
        },
        { thread_id: null, codex_turn_id: null },
      ),
      event(
        8,
        { type: "rollout_ended", status: "completed" },
        { thread_id: null, codex_turn_id: null },
      ),
    ]);

    await port.finalize();
    const records = port.records();
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map(({ attemptId, revision, phase }) => ({
        attemptId,
        revision,
        phase,
      })),
      [
        { attemptId: "attempt-1", revision: 1, phase: "turn" },
        { attemptId: "attempt-1", revision: 2, phase: "final" },
      ],
    );
    assert.equal(records[1]?.summary?.completeness, "rollout_complete");
    assert.equal(
      records[1]?.projection.collectionStatus,
      "READY_FOR_EVALUATION",
    );
    assert.notEqual(
      records[0]?.artifactReference,
      records[1]?.artifactReference,
      "each append-only revision has its own immutable artifact",
    );
    assert.equal(
      readFileSync(
        join(
          artifactRoot,
          "capture-1",
          "attempt-1",
          "revision-0001",
          "raw",
          "root-thread",
          "trace.jsonl",
        ),
        "utf8",
      ).includes('"seq":7'),
      false,
      "the first preserved revision never changes after finalization",
    );
    const assessment = JSON.parse(
      readFileSync(
        join(
          artifactRoot,
          "capture-1",
          "attempt-1",
          "revision-0001",
          "assessment.json",
        ),
        "utf8",
      ),
    ) as {
      projection: { sourceTrust: string };
      baselineAudit: {
        kind: string;
        bundles: Array<{
          cursor: { rootThreadId: string; afterSeqExclusive: number };
          tracePrefixBytes: number;
          tracePrefixSha256: string;
        }>;
      };
    };
    assert.equal(assessment.projection.sourceTrust, "runtime_isolated");
    assert.equal(assessment.baselineAudit.kind, "valid");
    assert.equal(assessment.baselineAudit.bundles[0]?.cursor.rootThreadId, "thread-root");
    assert.equal(assessment.baselineAudit.bundles[0]?.cursor.afterSeqExclusive, 4);
    assert.ok(assessment.baselineAudit.bundles[0]!.tracePrefixBytes > 0);
    assert.match(
      assessment.baselineAudit.bundles[0]!.tracePrefixSha256,
      /^[0-9a-f]{64}$/,
    );
  });

  it("preserves malformed raw bytes before validation and returns INVALID_TRACE", async () => {
    const snapshot = {
      files: [
        {
          relativePath: "root-thread/manifest.json",
          bytes: new TextEncoder().encode("{}"),
        },
        {
          relativePath: "root-thread/trace.jsonl",
          bytes: new TextEncoder().encode("not json\n"),
        },
      ],
    };
    const order: string[] = [];
    const artifactRoot = temporaryRoot("agenta-codex-artifacts-");
    const localSink = createLocalCodexEvidenceSink({ artifactRoot });
    const sink: CodexEvidenceSink = {
      preserve: async (input) => {
        order.push("preserve");
        return localSink.preserve(input);
      },
      appendAssessment: (artifact, assessment) =>
        localSink.appendAssessment(artifact, assessment),
    };
    let snapshotCall = 0;
    const source: CodexRolloutEvidenceSource = {
      snapshot: async () => (++snapshotCall === 1 ? { files: [] } : snapshot),
      cleanup: async () => {},
    };
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-malformed",
        sourceRoot: "/unused",
        remote: false,
      },
      source,
      sink,
      attemptId: () => "attempt-malformed",
      readBundle: async (...args) => {
        order.push("validate");
        return readCodexRolloutBundle(...args);
      },
    });

    await port.beginTurn();
    const record = await port.settleTurn({ outcome: "error" });
    assert.ok(record);
    assert.deepEqual(order, ["preserve", "validate"]);
    assert.equal(record.projection.collectionStatus, "INVALID_TRACE");
    assert.ok(record.artifactReference);
    assert.ok(record.reasonCodes.length > 0);
  });

  it("never throws when source or sink collection fails", async () => {
    const errors: string[] = [];
    const source: CodexRolloutEvidenceSource = {
      snapshot: async () => {
        throw new Error("sensitive source failure");
      },
      cleanup: async () => {
        throw new Error("cleanup failure");
      },
    };
    const sink: CodexEvidenceSink = {
      preserve: async () => {
        throw new Error("sink failure");
      },
      appendAssessment: async () => {
        throw new Error("assessment failure");
      },
    };
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-failure",
        sourceRoot: "/unused",
        remote: false,
      },
      source,
      sink,
      attemptId: () => "attempt-failure",
      log: (message) => errors.push(message),
    });

    await assert.doesNotReject(() => port.beginTurn());
    const record = await port.settleTurn({ outcome: "cancelled" });
    assert.equal(record?.projection.collectionStatus, "INVALID_TRACE");
    assert.deepEqual(record?.reasonCodes, ["trace.source-read-failed"]);
    await assert.doesNotReject(() => port.finalize());
    await assert.doesNotReject(() => port.cleanup());
    assert.ok(errors.length > 0);
    assert.equal(
      errors.some((message) => message.includes("sensitive source failure")),
      false,
      "collector logs never expose raw exception content",
    );
  });

  it("preserves cancellation provenance across the final append-only revision", async () => {
    const { sourceRoot, bundleDirectory } = sourceWithFixture("turn-terminal");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-cancelled",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-cancelled",
    });
    await port.beginTurn();
    appendEvents(bundleDirectory, [
      event(5, {
        type: "codex_turn_started",
        codex_turn_id: "turn-next",
        thread_id: "thread-root",
      }),
      event(6, {
        type: "codex_turn_ended",
        codex_turn_id: "turn-next",
        status: "cancelled",
      }),
    ]);
    const settled = await port.settleTurn({ outcome: "cancelled" });
    assert.equal(settled?.projection.collectionStatus, "CANCELLED");
    assert.equal(
      await port.settleTurn({ outcome: "error" }),
      undefined,
      "a second settle cannot reuse the prior turn's artifact",
    );

    appendEvents(bundleDirectory, [
      event(
        7,
        {
          type: "thread_ended",
          thread_id: "thread-root",
          status: "aborted",
        },
        { thread_id: null, codex_turn_id: null },
      ),
      event(
        8,
        { type: "rollout_ended", status: "aborted" },
        { thread_id: null, codex_turn_id: null },
      ),
    ]);
    await port.finalize();

    assert.deepEqual(
      port.records().map(({ phase, outcome, projection }) => ({
        phase,
        outcome,
        collectionStatus: projection.collectionStatus,
      })),
      [
        {
          phase: "turn",
          outcome: "cancelled",
          collectionStatus: "CANCELLED",
        },
        {
          phase: "final",
          outcome: "cancelled",
          collectionStatus: "CANCELLED",
        },
      ],
    );
  });

  it("bundle selection accepts the sole new root-turn bundle after an empty baseline", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-empty-");
    const identity: FixtureIdentity = {
      traceId: "trace-after-empty",
      rolloutId: "rollout-after-empty",
      rootThreadId: "thread-after-empty",
    };
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-empty-baseline",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-empty-baseline",
    });

    const attempt = await port.beginTurn();
    assert.equal(attempt.cursor, undefined);
    const bundleDirectory = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "new-bundle",
      identity,
    });
    renameFixtureTurn(bundleDirectory, "turn-after-empty");

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.summary?.identity.traceId, identity.traceId);
    assert.equal(record?.summary?.identity.targetTurnId, "turn-after-empty");
    assert.deepEqual(record?.summary?.watermark, {
      afterSeqExclusive: 0,
      toSeqInclusive: 4,
    });
  });

  it("bundle selection distinguishes an invalid baseline from an empty baseline", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-invalid-");
    const invalidDirectory = join(sourceRoot, "a-invalid-baseline");
    mkdirSync(invalidDirectory, { recursive: true });
    writeFileSync(join(invalidDirectory, "manifest.json"), "{");
    writeFileSync(join(invalidDirectory, "trace.jsonl"), "not json\n");
    const identity: FixtureIdentity = {
      traceId: "trace-after-invalid",
      rolloutId: "rollout-after-invalid",
      rootThreadId: "thread-after-invalid",
    };
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-invalid-baseline",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-invalid-baseline",
    });

    const attempt = await port.beginTurn();
    assert.equal(attempt.cursor, undefined);
    const bundleDirectory = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "z-valid-after-invalid",
      identity,
    });
    renameFixtureTurn(bundleDirectory, "turn-after-invalid");

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.projection.collectionStatus, "INVALID_TRACE");
    assert.equal(record?.summary, undefined);
    assert.deepEqual(record?.reasonCodes, ["trace.baseline-invalid"]);
  });

  it("bundle selection chooses the unique new root-turn bundle instead of a valid baseline bundle", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-valid-");
    const baselineIdentity: FixtureIdentity = {
      traceId: "trace-baseline",
      rolloutId: "rollout-baseline",
      rootThreadId: "thread-baseline",
    };
    addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "a-valid-baseline",
      identity: baselineIdentity,
    });
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-valid-baseline",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-valid-baseline",
    });

    const attempt = await port.beginTurn();
    assert.equal(attempt.cursor?.traceId, baselineIdentity.traceId);
    const newIdentity: FixtureIdentity = {
      traceId: "trace-new-candidate",
      rolloutId: "rollout-new-candidate",
      rootThreadId: "thread-new-candidate",
    };
    const newBundleDirectory = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "z-new-candidate",
      identity: newIdentity,
    });
    renameFixtureTurn(newBundleDirectory, "turn-new-candidate");

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.summary?.identity.traceId, newIdentity.traceId);
    assert.equal(record?.summary?.identity.rolloutId, newIdentity.rolloutId);
    assert.equal(record?.summary?.identity.targetTurnId, "turn-new-candidate");
  });

  it("bundle selection fails closed when multiple bundles contain new root turns", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-ambiguous-");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-ambiguous",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-ambiguous",
    });
    await port.beginTurn();

    for (const candidate of ["first", "second"]) {
      const identity: FixtureIdentity = {
        traceId: `trace-${candidate}`,
        rolloutId: `rollout-${candidate}`,
        rootThreadId: `thread-${candidate}`,
      };
      const bundleDirectory = addTurnTerminalBundle({
        sourceRoot,
        relativeDirectory: `${candidate}-candidate`,
        identity,
      });
      renameFixtureTurn(bundleDirectory, `turn-${candidate}`);
    }

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.projection.collectionStatus, "INVALID_TRACE");
    assert.equal(record?.summary, undefined);
    assert.deepEqual(record?.reasonCodes, [
      "trace.bundle-selection-ambiguous",
    ]);
  });

  it("fails closed when any valid baseline bundle is rewritten beside the selected bundle", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-multi-prefix-");
    const oldIdentity: FixtureIdentity = {
      traceId: "trace-old",
      rolloutId: "rollout-old",
      rootThreadId: "thread-old",
    };
    const targetIdentity: FixtureIdentity = {
      traceId: "trace-target",
      rolloutId: "rollout-target",
      rootThreadId: "thread-target",
    };
    const oldBundle = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "a-old",
      identity: oldIdentity,
    });
    const targetBundle = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "b-target",
      identity: targetIdentity,
    });
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-multi-prefix",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-multi-prefix",
      producerTrust: "runtime_isolated",
    });
    await port.beginTurn();
    const oldTrace = join(oldBundle, "trace.jsonl");
    writeFileSync(
      oldTrace,
      readFileSync(oldTrace, "utf8").replace(
        '"wall_time_unix_ms":2000',
        '"wall_time_unix_ms":1999',
      ),
    );
    appendEvents(targetBundle, [
      ...rootTurnEvents(5, targetIdentity, "turn-target-new"),
      event(
        7,
        {
          type: "thread_ended",
          thread_id: targetIdentity.rootThreadId,
          status: "completed",
        },
        {
          rollout_id: targetIdentity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
      event(
        8,
        { type: "rollout_ended", status: "completed" },
        {
          rollout_id: targetIdentity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
    ]);

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.projection.collectionStatus, "INVALID_TRACE");
    assert.equal(record?.summary, undefined);
    assert.deepEqual(record?.reasonCodes, ["trace.bundle-prefix-rewritten"]);
  });

  it("revalidates every baseline bundle during finalization", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-final-prefix-");
    const oldIdentity: FixtureIdentity = {
      traceId: "trace-final-old",
      rolloutId: "rollout-final-old",
      rootThreadId: "thread-final-old",
    };
    const targetIdentity: FixtureIdentity = {
      traceId: "trace-final-target",
      rolloutId: "rollout-final-target",
      rootThreadId: "thread-final-target",
    };
    const oldBundle = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "a-old",
      identity: oldIdentity,
    });
    const targetBundle = addTurnTerminalBundle({
      sourceRoot,
      relativeDirectory: "b-target",
      identity: targetIdentity,
    });
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-final-prefix",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-final-prefix",
      producerTrust: "runtime_isolated",
    });
    await port.beginTurn();
    appendEvents(
      targetBundle,
      rootTurnEvents(5, targetIdentity, "turn-final-target"),
    );
    const settled = await port.settleTurn({ outcome: "completed" });
    assert.equal(settled?.projection.collectionStatus, "PENDING_TERMINAL");

    const oldTrace = join(oldBundle, "trace.jsonl");
    writeFileSync(
      oldTrace,
      readFileSync(oldTrace, "utf8").replace(
        '"wall_time_unix_ms":2000',
        '"wall_time_unix_ms":1999',
      ),
    );
    appendEvents(targetBundle, [
      event(
        7,
        {
          type: "thread_ended",
          thread_id: targetIdentity.rootThreadId,
          status: "completed",
        },
        {
          rollout_id: targetIdentity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
      event(
        8,
        { type: "rollout_ended", status: "completed" },
        {
          rollout_id: targetIdentity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
    ]);

    await port.finalize();
    const finalized = port.records().at(-1);

    assert.equal(finalized?.phase, "final");
    assert.equal(finalized?.projection.collectionStatus, "INVALID_TRACE");
    assert.deepEqual(finalized?.reasonCodes, [
      "trace.bundle-prefix-rewritten",
    ]);
  });

  it("isolates an earlier attempt finalization from later warm turns", async () => {
    const { sourceRoot, bundleDirectory } = sourceWithFixture("turn-terminal");
    let attemptSequence = 0;
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-warm-turn-isolation",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => `attempt-${++attemptSequence}`,
    });
    const identity: FixtureIdentity = {
      traceId: "trace-turn",
      rolloutId: "rollout-turn",
      rootThreadId: "thread-root",
    };

    await port.beginTurn();
    appendEvents(bundleDirectory, rootTurnEvents(5, identity, "turn-target"));
    const attemptOneTurn = await port.settleTurn({ outcome: "completed" });
    assert.equal(attemptOneTurn?.summary?.identity.targetTurnId, "turn-target");

    await port.beginTurn();
    appendEvents(bundleDirectory, rootTurnEvents(7, identity, "turn-later-warm"));
    const attemptTwoTurn = await port.settleTurn({ outcome: "completed" });
    assert.equal(
      attemptTwoTurn?.summary?.identity.targetTurnId,
      "turn-later-warm",
    );

    appendEvents(bundleDirectory, [
      event(
        9,
        {
          type: "thread_ended",
          thread_id: identity.rootThreadId,
          status: "completed",
        },
        {
          rollout_id: identity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
      event(
        10,
        { type: "rollout_ended", status: "completed" },
        {
          rollout_id: identity.rolloutId,
          thread_id: null,
          codex_turn_id: null,
        },
      ),
    ]);
    await port.finalize();

    const attemptOneRecords = port
      .records()
      .filter((record) => record.attemptId === "attempt-1");
    assert.equal(
      attemptOneRecords.length,
      1,
      "an earlier warm attempt remains turn-complete instead of absorbing later turns",
    );
    assert.equal(attemptOneRecords[0]?.summary?.completeness, "turn_complete");
    assert.equal(
      attemptOneRecords[0]?.summary?.eventTypeCounts.codex_turn_started,
      1,
    );
  });

  it("bounds a diagnostic operation that never settles", async () => {
    vi.useFakeTimers();
    const pending = runCodexEvidenceOperation({
      operation: () => new Promise<never>(() => {}),
      timeoutMs: 25,
      label: "test",
    });
    await vi.advanceTimersByTimeAsync(25);
    assert.deepEqual(await pending, { ok: false, reason: "timed-out" });
  });

  it("cooperatively aborts the underlying diagnostic operation on timeout", async () => {
    vi.useFakeTimers();
    let operationSignal: AbortSignal | undefined;
    const pending = runCodexEvidenceOperation({
      operation: (signal?: AbortSignal) => {
        operationSignal = signal;
        return new Promise<never>(() => {});
      },
      timeoutMs: 25,
      label: "test-abort",
    });

    await vi.advanceTimersByTimeAsync(25);

    assert.deepEqual(await pending, { ok: false, reason: "timed-out" });
    assert.equal(
      operationSignal?.aborted,
      true,
      "timeout must signal the operation instead of only abandoning its promise",
    );
  });

  it("prevents a timed-out begin from mutating its attempt after late source completion", async () => {
    vi.useFakeTimers();
    const snapshotGate = deferred<{
      files: Array<{ relativePath: string; bytes: Uint8Array }>;
    }>();
    const source: CodexRolloutEvidenceSource = {
      snapshot: (options?: { signal?: AbortSignal }) =>
        new Promise((resolveSnapshot, rejectSnapshot) => {
          options?.signal?.addEventListener(
            "abort",
            () => rejectSnapshot(new Error("source read aborted")),
            { once: true },
          );
          void snapshotGate.promise.then(resolveSnapshot, rejectSnapshot);
        }),
      cleanup: async () => {},
    };
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-late-begin",
        sourceRoot: "/unused",
        remote: false,
      },
      source,
      sink: {
        preserve: async () => {
          throw new Error("not reached");
        },
        appendAssessment: async () => {},
      },
      attemptId: () => "attempt-late-begin",
    });
    let beginPromise!: ReturnType<typeof port.beginTurn>;
    const timedBegin = runCodexEvidenceOperation({
      operation: (signal?: AbortSignal) => {
        beginPromise = (
          port.beginTurn as unknown as (input?: {
            signal?: AbortSignal;
          }) => ReturnType<typeof port.beginTurn>
        )({ signal });
        return beginPromise;
      },
      timeoutMs: 25,
      label: "begin",
    });
    await Promise.resolve();
    const activeAttempt = await port.beginTurn();

    await vi.advanceTimersByTimeAsync(25);
    assert.deepEqual(await timedBegin, { ok: false, reason: "timed-out" });
    snapshotGate.resolve({
      files: [
        {
          relativePath: "root-thread/manifest.json",
          bytes: new TextEncoder().encode(
            JSON.stringify({ trace_id: "trace-late", rollout_id: "rollout-late" }),
          ),
        },
        {
          relativePath: "root-thread/trace.jsonl",
          bytes: new TextEncoder().encode(`${JSON.stringify({ seq: 9 })}\n`),
        },
      ],
    });
    await beginPromise;

    assert.equal(
      activeAttempt.cursor,
      undefined,
      "a begin that exceeded its deadline must not publish a late cursor",
    );
  });

  it("quiesces a late settle before finalization drains the attempt", async () => {
    const { sourceRoot } = sourceWithFixture("turn-terminal");
    const localSource = createLocalCodexRolloutEvidenceSource(sourceRoot);
    const stableSnapshot = await localSource.snapshot();
    const settleSnapshot = deferred<typeof stableSnapshot>();
    let snapshotCalls = 0;
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-late-settle",
        sourceRoot,
        remote: false,
      },
      source: {
        snapshot: async () => {
          snapshotCalls += 1;
          if (snapshotCalls === 2) return settleSnapshot.promise;
          return stableSnapshot;
        },
        cleanup: async () => {},
      },
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-late-settle",
    });
    await port.beginTurn();
    const settlePromise = port.settleTurn({ outcome: "completed" });

    let finalized = false;
    const finalizePromise = port.finalize().then(() => {
      finalized = true;
    });
    await Promise.resolve();

    assert.equal(
      finalized,
      false,
      "finalization must serialize behind an in-flight settle",
    );
    settleSnapshot.resolve(stableSnapshot);
    await settlePromise;
    await finalizePromise;
    assert.deepEqual(
      port.records().map(({ phase }) => phase),
      ["turn", "final"],
      "late settle completion must still receive exactly one final revision",
    );
  });

  it("keeps full-access native evidence diagnostic-only even when structurally complete", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-untrusted-");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-untrusted",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-untrusted",
    });
    await port.beginTurn();
    cpSync(
      join(fixtureRoot, "valid-root-terminal"),
      join(sourceRoot, "root-thread"),
      { recursive: true },
    );

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.summary?.completeness, "rollout_complete");
    assert.equal(record?.summary?.hardScoreEligible, false);
    assert.equal(record?.projection.collectionStatus, "DIAGNOSTIC_ONLY");
    assert.equal(record?.projection.sourceTrust, "diagnostic_full_access");
    assert.deepEqual(record?.reasonCodes, ["trace.writer-not-isolated"]);
  });

  it("keeps valid warm full-access evidence diagnostic-only instead of pending", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-untrusted-warm-");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-untrusted-warm",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-untrusted-warm",
    });
    await port.beginTurn();
    cpSync(
      join(fixtureRoot, "turn-terminal"),
      join(sourceRoot, "root-thread"),
      { recursive: true },
    );

    const record = await port.settleTurn({ outcome: "completed" });

    assert.equal(record?.summary?.completeness, "turn_complete");
    assert.equal(record?.projection.collectionStatus, "DIAGNOSTIC_ONLY");
    assert.deepEqual(record?.reasonCodes, [
      "trace.rollout-incomplete",
      "trace.writer-not-isolated",
    ]);
  });

  it("returns deeply frozen attempt and record snapshots", async () => {
    const { sourceRoot, bundleDirectory } = sourceWithFixture("turn-terminal");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-readonly",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-readonly",
    });
    const attempt = await port.beginTurn();
    assert.throws(
      () => ((attempt as unknown as { attemptId: string }).attemptId = "forged"),
      TypeError,
    );
    appendEvents(bundleDirectory, [
      event(5, {
        type: "codex_turn_started",
        codex_turn_id: "turn-readonly",
        thread_id: "thread-root",
      }),
      event(6, {
        type: "codex_turn_ended",
        codex_turn_id: "turn-readonly",
        status: "completed",
      }),
    ]);
    await port.settleTurn({ outcome: "completed" });
    const records = port.records();
    assert.throws(
      () =>
        ((records[0]!.projection as { collectionStatus: string })
          .collectionStatus = "READY_FOR_EVALUATION"),
      TypeError,
    );
    assert.equal(
      port.records()[0]?.projection.collectionStatus,
      "INVALID_TRACE",
    );
  });

  it("rejects an append-only baseline whose event prefix is rewritten", async () => {
    const { sourceRoot, bundleDirectory } = sourceWithFixture("turn-terminal");
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-prefix",
        sourceRoot,
        remote: false,
      },
      source: createLocalCodexRolloutEvidenceSource(sourceRoot),
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => "attempt-prefix",
    });
    await port.beginTurn();
    const tracePath = join(bundleDirectory, "trace.jsonl");
    writeFileSync(
      tracePath,
      readFileSync(tracePath, "utf8").replace(
        '"wall_time_unix_ms":2000',
        '"wall_time_unix_ms":1999',
      ),
    );
    appendEvents(
      bundleDirectory,
      rootTurnEvents(
        5,
        {
          traceId: "trace-turn",
          rolloutId: "rollout-turn",
          rootThreadId: "thread-root",
        },
        "turn-prefix",
      ),
    );

    const record = await port.settleTurn({ outcome: "completed" });

    assert.deepEqual(record?.reasonCodes, ["trace.bundle-prefix-rewritten"]);
    assert.equal(record?.summary, undefined);
  });

  it("stops minting attempts and records after configured capacity is exhausted", async () => {
    let attemptIds = 0;
    let snapshots = 0;
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-capacity",
        sourceRoot: "/unused",
        remote: false,
      },
      source: {
        snapshot: async () => {
          snapshots += 1;
          return { files: [] };
        },
        cleanup: async () => {},
      },
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => `attempt-${++attemptIds}`,
      limits: { maxAttempts: 1, maxRevisions: 1 },
    });

    for (let index = 0; index < 5; index += 1) {
      await port.beginTurn();
      await port.settleTurn({ outcome: "completed" });
    }

    assert.equal(attemptIds, 1);
    assert.equal(snapshots, 2);
    assert.equal(port.records().length, 1);
  });

  it("charges a rejected snapshot once and stops reading after aggregate overflow", async () => {
    let attemptIds = 0;
    let snapshots = 0;
    const port = createCodexRolloutEvidencePort({
      capture: {
        captureId: "capture-aggregate-capacity",
        sourceRoot: "/unused",
        remote: false,
      },
      source: {
        snapshot: async () => {
          snapshots += 1;
          return {
            files: [
              {
                relativePath: "bundle/oversized.bin",
                bytes: new Uint8Array([1, 2]),
              },
            ],
          };
        },
        cleanup: async () => {},
      },
      sink: createLocalCodexEvidenceSink({
        artifactRoot: temporaryRoot("agenta-codex-artifacts-"),
      }),
      attemptId: () => `attempt-${++attemptIds}`,
      limits: {
        maxAttempts: 5,
        maxRevisions: 5,
        maxAggregateSnapshotBytes: 1,
      },
    });

    await port.beginTurn();
    const overflow = await port.settleTurn({ outcome: "completed" });
    await port.finalize();
    for (let index = 0; index < 3; index += 1) {
      await port.beginTurn();
      await port.settleTurn({ outcome: "completed" });
    }

    assert.deepEqual(overflow?.reasonCodes, [
      "trace.aggregate-limit-exceeded",
    ]);
    assert.equal(attemptIds, 1);
    assert.equal(snapshots, 1);
    assert.equal(port.records().length, 1);
  });
});

describe("Codex rollout evidence sources", () => {
  it("forwards Daytona filesystem cancellation as fetch signal, never as a URL query", async () => {
    const controller = new AbortController();
    const observed: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
    const client = await SandboxAgent.connect({
      baseUrl: "https://sandbox.invalid",
      skipHealthCheck: true,
      fetch: (async (request: string | URL | Request, init?: RequestInit) => {
        observed.push({
          url: String(request),
          signal: init?.signal,
        });
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    await client.listFsEntries(
      { path: "/home/sandbox/evidence" },
      { signal: controller.signal },
    );

    assert.equal(observed.length, 1);
    assert.strictEqual(observed[0]?.signal, controller.signal);
    const url = new URL(observed[0]!.url);
    assert.equal(url.searchParams.get("path"), "/home/sandbox/evidence");
    assert.equal(url.searchParams.has("signal"), false);
    await client.dispose();
  });

  it("reads and cleans a bounded local source tree", async () => {
    const parent = temporaryRoot("agenta-codex-local-source-");
    const sourceRoot = join(parent, "codex-rollout-traces", "capture-test");
    mkdirSync(join(sourceRoot, "bundle", "payloads"), { recursive: true });
    writeFileSync(join(sourceRoot, "bundle", "manifest.json"), "{}");
    writeFileSync(join(sourceRoot, "bundle", "trace.jsonl"), "{}\n");
    writeFileSync(join(sourceRoot, "bundle", "payloads", "1.json"), "{}");
    const source = createLocalCodexRolloutEvidenceSource(sourceRoot, {
      cleanupToken: "capture-test",
    });

    const snapshot = await source.snapshot();
    assert.deepEqual(
      snapshot.files.map(({ relativePath }) => relativePath),
      [
        "bundle/manifest.json",
        "bundle/payloads/1.json",
        "bundle/trace.jsonl",
      ],
    );
    await source.cleanup();
    assert.throws(() => readFileSync(join(sourceRoot, "bundle", "manifest.json")));
  });

  it("uses sandbox-agent filesystem operations for Daytona without host-path reads", async () => {
    const calls: string[] = [];
    const entries = new Map<string, Array<Record<string, unknown>>>([
      [
        "/remote/agenta/codex-rollout-traces/capture-test",
        [
          {
            path: "/remote/agenta/codex-rollout-traces/capture-test/root-thread",
            name: "root-thread",
            entryType: "directory",
            size: 0,
          },
        ],
      ],
      [
        "/remote/agenta/codex-rollout-traces/capture-test/root-thread",
        [
          {
            path: "/remote/agenta/codex-rollout-traces/capture-test/root-thread/manifest.json",
            name: "manifest.json",
            entryType: "file",
            size: 2,
          },
          {
            path: "/remote/agenta/codex-rollout-traces/capture-test/root-thread/trace.jsonl",
            name: "trace.jsonl",
            entryType: "file",
            size: 3,
          },
        ],
      ],
    ]);
    const sandbox = {
      listFsEntries: async ({ path }: { path?: string | null }) => {
        calls.push(`list:${path}`);
        return entries.get(String(path)) ?? [];
      },
      readFsFile: async ({ path }: { path: string }) => {
        calls.push(`read:${path}`);
        return new TextEncoder().encode(path.endsWith("manifest.json") ? "{}" : "{}\n");
      },
      deleteFsEntry: async ({ path, recursive }: { path: string; recursive?: boolean }) => {
        calls.push(`delete:${path}:${recursive}`);
        return { path };
      },
    };
    const source = createDaytonaCodexRolloutEvidenceSource(
      "/remote/agenta/codex-rollout-traces/capture-test",
      sandbox,
      { cleanupToken: "capture-test" },
    );

    const snapshot = await source.snapshot();
    assert.deepEqual(
      snapshot.files.map(({ relativePath }) => relativePath),
      ["root-thread/manifest.json", "root-thread/trace.jsonl"],
    );
    await source.cleanup();
    assert.deepEqual(calls, [
      "list:/remote/agenta/codex-rollout-traces/capture-test",
      "list:/remote/agenta/codex-rollout-traces/capture-test/root-thread",
      "read:/remote/agenta/codex-rollout-traces/capture-test/root-thread/manifest.json",
      "read:/remote/agenta/codex-rollout-traces/capture-test/root-thread/trace.jsonl",
      "delete:/remote/agenta/codex-rollout-traces/capture-test:true",
    ]);
  });

  it("rejects path escape and post-stat growth before preserving bytes", async () => {
    const sourceRoot = temporaryRoot("agenta-codex-source-limits-");
    const outside = temporaryRoot("agenta-codex-outside-");
    const target = join(outside, "payload.json");
    writeFileSync(target, "secret");
    const source = createDaytonaCodexRolloutEvidenceSource(sourceRoot, {
      listFsEntries: async () => [
        {
          path: target,
          name: "payload.json",
          entryType: "file",
          size: 1,
        },
      ],
      readFsFile: async () => new TextEncoder().encode("too large"),
      deleteFsEntry: async ({ path }: { path: string }) => ({ path }),
    });

    await assert.rejects(() => source.snapshot(), /source entry escaped trace root/);
  });

  it("treats a missing trace root as an empty first-turn baseline", async () => {
    const parent = temporaryRoot("agenta-codex-missing-parent-");
    const source = createLocalCodexRolloutEvidenceSource(join(parent, "missing"));
    assert.deepEqual(await source.snapshot(), { files: [] });
  });

  it("rejects a symlink trace root and broad recursive cleanup targets", async () => {
    const parent = temporaryRoot("agenta-codex-symlink-parent-");
    const target = temporaryRoot("agenta-codex-symlink-target-");
    const link = join(parent, "trace-link");
    symlinkSync(target, link);
    await assert.rejects(
      () => createLocalCodexRolloutEvidenceSource(link).snapshot(),
      /source root must be a real directory/,
    );
    await assert.rejects(
      () => createLocalCodexRolloutEvidenceSource(tmpdir()).cleanup(),
      /unsafe source root/,
    );
    assert.throws(
      () =>
        createDaytonaCodexRolloutEvidenceSource("/home/sandbox", {
          listFsEntries: async () => [],
          readFsFile: async () => new Uint8Array(),
          deleteFsEntry: async () => ({}),
        }),
      /unsafe source root/,
    );
  });

  it("rejects cleanup when a descendant of the temp root is a symlink ancestor", async () => {
    const parent = temporaryRoot("agenta-codex-cleanup-parent-");
    const outside = temporaryRoot("agenta-codex-cleanup-outside-");
    const owner = join(parent, "owner");
    mkdirSync(owner, { recursive: true });
    mkdirSync(join(outside, "capture-x"), { recursive: true });
    const sentinel = join(outside, "capture-x", "sentinel.txt");
    writeFileSync(sentinel, "keep");
    symlinkSync(outside, join(owner, "codex-rollout-traces"));
    const source = createLocalCodexRolloutEvidenceSource(
      join(owner, "codex-rollout-traces", "capture-x"),
      { cleanupToken: "capture-x" },
    );

    await assert.rejects(
      () => source.cleanup(),
      /source root contains a symbolic-link ancestor/,
    );
    assert.equal(readFileSync(sentinel, "utf8"), "keep");
  });
});

describe("Codex rollout evidence sink", () => {
  it("rejects symlink artifact roots and capture directories", async () => {
    const parent = temporaryRoot("agenta-codex-sink-parent-");
    const outside = temporaryRoot("agenta-codex-sink-outside-");
    const rootLink = join(parent, "root-link");
    symlinkSync(outside, rootLink);
    await assert.rejects(
      () =>
        createLocalCodexEvidenceSink({ artifactRoot: rootLink }).preserve({
          captureId: "capture-link",
          attemptId: "attempt-link",
          revision: 1,
          snapshot: { files: [] },
        }),
      /artifact root must be a real directory/,
    );

    const artifactRoot = temporaryRoot("agenta-codex-sink-root-");
    symlinkSync(outside, join(artifactRoot, "capture-link"));
    await assert.rejects(
      () =>
        createLocalCodexEvidenceSink({ artifactRoot }).preserve({
          captureId: "capture-link",
          attemptId: "attempt-link",
          revision: 1,
          snapshot: { files: [] },
        }),
      /artifact path must be a real directory/,
    );
  });
});
