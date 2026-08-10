/** Session-scoped capture, preservation, and assessment for native Codex rollout bundles. */
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

import type { CodexRolloutTraceCapture } from "./codex-rollout-capture.ts";
import {
  readCodexRolloutBundle,
  type CodexRolloutBundle,
  type CodexRolloutBundleReadResult,
} from "./codex-rollout-reader.ts";
import {
  reduceCodexRolloutLifecycle,
  type CodexAttemptCursor,
} from "./codex-rollout-lifecycle.ts";
import {
  createCodexEvidenceSummary,
  type CodexEvidenceSummaryV1,
} from "./codex-evidence-summary.ts";

export const AGENTA_CODEX_EVIDENCE_ARTIFACT_ROOT_ENV =
  "AGENTA_RUNNER_CODEX_EVIDENCE_ARTIFACT_ROOT";
export const AGENTA_CODEX_EVIDENCE_OPERATION_TIMEOUT_ENV =
  "AGENTA_RUNNER_CODEX_EVIDENCE_OPERATION_TIMEOUT_MS";
export const DEFAULT_CODEX_EVIDENCE_OPERATION_TIMEOUT_MS = 5_000;

export type CodexEvidenceOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "failed" | "timed-out" };

/** Bound diagnostic I/O without surfacing raw exception text into runner logs. */
export async function runCodexEvidenceOperation<T>(input: {
  operation: (signal: AbortSignal) => Promise<T>;
  timeoutMs: number;
  label: string;
  log?: (message: string) => void;
}): Promise<CodexEvidenceOperationResult<T>> {
  const timeoutMs =
    Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? Math.trunc(input.timeoutMs)
      : DEFAULT_CODEX_EVIDENCE_OPERATION_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const operation = Promise.resolve()
    .then(() => input.operation(controller.signal))
    .then(
      (value) => ({ ok: true, value }) as const,
      () => ({ ok: false, reason: "failed" }) as const,
    );
  const timeout = new Promise<
    Extract<CodexEvidenceOperationResult<T>, { ok: false }>
  >((resolveTimeout) => {
    timer = setTimeout(
      () => {
        controller.abort(new Error("codex evidence operation timed out"));
        resolveTimeout({ ok: false, reason: "timed-out" });
      },
      timeoutMs,
    );
  });
  const result = await Promise.race([operation, timeout]);
  if (timer) clearTimeout(timer);
  if (!result.ok) input.log?.(`codex evidence ${input.label} ${result.reason}`);
  return result;
}

export function resolveCodexEvidenceOperationTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[AGENTA_CODEX_EVIDENCE_OPERATION_TIMEOUT_ENV]?.trim();
  if (!raw) return DEFAULT_CODEX_EVIDENCE_OPERATION_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CODEX_EVIDENCE_OPERATION_TIMEOUT_MS;
  }
  return Math.min(60_000, Math.max(100, Math.trunc(parsed)));
}

export interface CodexRolloutEvidenceSnapshotFile {
  relativePath: string;
  bytes: Uint8Array;
}

export interface CodexRolloutEvidenceSnapshot {
  files: CodexRolloutEvidenceSnapshotFile[];
}

export interface CodexRolloutEvidenceSource {
  snapshot(options?: { signal?: AbortSignal }): Promise<CodexRolloutEvidenceSnapshot>;
  cleanup(options?: { signal?: AbortSignal }): Promise<void>;
}

export interface CodexEvidenceArtifact {
  reference: string;
  /** Runner-private local path used only for validation; never projected. */
  rawRoot: string;
  /** Runner-private revision directory used only by the sink. */
  revisionRoot: string;
}

export interface CodexEvidencePreserveInput {
  captureId: string;
  attemptId: string;
  revision: number;
  snapshot: CodexRolloutEvidenceSnapshot;
  signal?: AbortSignal;
}

export interface CodexEvidenceSink {
  preserve(input: CodexEvidencePreserveInput): Promise<CodexEvidenceArtifact>;
  appendAssessment(
    artifact: CodexEvidenceArtifact,
    assessment: CodexEvidenceAssessment,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export type CodexEvidenceCollectionStatus =
  | "INVALID_TRACE"
  | "CANCELLED"
  | "DIAGNOSTIC_ONLY"
  | "PENDING_TERMINAL"
  | "READY_FOR_EVALUATION";

export type CodexEvidenceSourceTrust =
  | "diagnostic_full_access"
  | "runtime_isolated";

export interface CodexEvidenceProjection {
  schemaVersion: "codex-evidence/v1";
  collectionStatus: CodexEvidenceCollectionStatus;
  sourceTrust: CodexEvidenceSourceTrust;
  completeness: CodexEvidenceSummaryV1["completeness"];
  digest?: string;
  artifactRef?: string;
  reasonCodes?: string[];
  events: number;
  payloads: number;
  tools: number;
  toolErrors: number;
  openRuntimeObjects: number;
}

export interface CodexEvidenceRecord {
  attemptId: string;
  revision: number;
  phase: "turn" | "final";
  outcome: CodexTurnOutcome;
  artifactReference?: string;
  summary?: CodexEvidenceSummaryV1;
  projection: CodexEvidenceProjection;
  reasonCodes: string[];
}

export interface CodexEvidenceAssessment {
  schemaVersion: "codex-evidence-assessment/v1";
  attemptId: string;
  revision: number;
  phase: "turn" | "final";
  outcome: CodexTurnOutcome;
  artifactReference: string;
  summary?: CodexEvidenceSummaryV1;
  projection: CodexEvidenceProjection;
  reasonCodes: string[];
  baselineAudit: CodexEvidenceBaselineAudit;
}

export type CodexEvidenceBaselineAudit =
  | { kind: "empty" }
  | { kind: "invalid"; reasonCode: string }
  | {
      kind: "valid";
      bundles: Array<{
        bundleRelativeDirectory: string;
        cursor: CodexAttemptCursor;
        manifestSha256: string;
        tracePrefixSha256: string;
        tracePrefixBytes: number;
      }>;
    };

export type CodexTurnOutcome = "completed" | "error" | "cancelled" | "paused";

export interface CodexEvidenceAttempt {
  attemptId: string;
  cursor?: CodexAttemptCursor;
  bundleRelativeDirectory?: string;
}

export interface CodexRolloutEvidencePort {
  beginTurn(input?: { signal?: AbortSignal }): Promise<CodexEvidenceAttempt>;
  settleTurn(input: {
    outcome: CodexTurnOutcome;
    signal?: AbortSignal;
  }): Promise<CodexEvidenceRecord | undefined>;
  finalize(input?: { signal?: AbortSignal }): Promise<void>;
  cleanup(input?: { signal?: AbortSignal }): Promise<void>;
  records(): readonly CodexEvidenceRecord[];
}

export interface CodexEvidenceSourceLimits {
  maxFiles: number;
  maxEntries: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDepth: number;
}

const DEFAULT_SOURCE_LIMITS: Readonly<CodexEvidenceSourceLimits> = {
  maxFiles: 10_002,
  maxEntries: 20_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  maxDepth: 32,
};

interface DaytonaFsEntry {
  path: string;
  name?: string;
  entryType: string;
  size: number;
}

export interface DaytonaCodexEvidenceSandbox {
  listFsEntries(
    input: { path?: string | null },
    options?: { signal?: AbortSignal },
  ): Promise<unknown[]>;
  readFsFile(
    input: { path: string },
    options?: { signal?: AbortSignal },
  ): Promise<Uint8Array>;
  deleteFsEntry(input: {
    path: string;
    recursive?: boolean;
  }, options?: { signal?: AbortSignal }): Promise<unknown>;
  statFs?(
    input: { path: string },
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

export function createLocalCodexRolloutEvidenceSource(
  sourceRoot: string,
  options: {
    limits?: Partial<CodexEvidenceSourceLimits>;
    cleanupToken?: string;
  } = {},
): CodexRolloutEvidenceSource {
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...options.limits };
  return {
    async snapshot(snapshotOptions) {
      const signal = snapshotOptions?.signal;
      throwIfAborted(signal);
      const root = await resolveLocalSourceRoot(sourceRoot, signal);
      if (root === undefined) return { files: [] };
      const files: CodexRolloutEvidenceSnapshotFile[] = [];
      let totalBytes = 0;
      let totalEntries = 0;

      const walk = async (directory: string, depth: number): Promise<void> => {
        throwIfAborted(signal);
        if (depth > limits.maxDepth) {
          throw new Error("source tree depth limit exceeded");
        }
        const handle = await opendir(directory);
        try {
          for await (const entry of handle) {
            throwIfAborted(signal);
            totalEntries += 1;
            if (totalEntries > limits.maxEntries) {
              throw new Error("source entry count limit exceeded");
            }
            if (entry.isSymbolicLink()) {
              throw new Error("source tree contains a symbolic link");
            }
            const absolutePath = join(directory, entry.name);
            const entryStat = await lstat(absolutePath);
            throwIfAborted(signal);
            if (entryStat.isSymbolicLink()) {
              throw new Error("source tree contains a symbolic link");
            }
            const resolvedPath = await realpath(absolutePath);
            throwIfAborted(signal);
            if (!isWithinLocal(root, resolvedPath)) {
              throw new Error("source entry escaped trace root");
            }
            if (entryStat.isDirectory()) {
              await walk(resolvedPath, depth + 1);
              continue;
            }
            if (!entryStat.isFile()) {
              throw new Error("source tree contains an unsupported entry");
            }
            if (files.length >= limits.maxFiles) {
              throw new Error("source file count limit exceeded");
            }
            const remainingTotalBytes = limits.maxTotalBytes - totalBytes;
            const bytes = await readLocalFileBounded({
              path: absolutePath,
              resolvedPath,
              root,
              maxBytes: Math.min(limits.maxFileBytes, remainingTotalBytes),
              signal,
            });
            throwIfAborted(signal);
            totalBytes += bytes.byteLength;
            files.push({
              relativePath: portableRelative(root, resolvedPath),
              bytes,
            });
          }
        } finally {
          await handle.close().catch(() => undefined);
        }
      };

      await walk(root, 0);
      files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );
      return { files };
    },
    async cleanup(cleanupOptions) {
      const signal = cleanupOptions?.signal;
      throwIfAborted(signal);
      const requestedRoot = resolve(sourceRoot);
      assertSafeCleanupRoot(requestedRoot);
      assertOwnedCleanupRoot(requestedRoot, options.cleanupToken);
      const root = await resolveLocalSourceRoot(requestedRoot, signal);
      if (root === undefined) return;
      await rm(root, { recursive: true, force: true });
      throwIfAborted(signal);
    },
  };
}

function baselineFromSnapshot(
  snapshot: CodexRolloutEvidenceSnapshot,
): AttemptBaseline {
  if (snapshot.files.length === 0) return { kind: "empty" };
  const manifests = snapshot.files
    .filter((file) => file.relativePath.endsWith("/manifest.json"))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  if (manifests.length === 0) {
    return { kind: "invalid", reasonCode: "trace.baseline-invalid" };
  }

  const bundles = new Map<string, BundleBaseline>();
  try {
    for (const manifestFile of manifests) {
      const bundleRelativeDirectory = posix.dirname(manifestFile.relativePath);
      const manifest = JSON.parse(
        new TextDecoder().decode(manifestFile.bytes),
      ) as Record<string, unknown>;
      if (
        manifest.schema_version !== 1 ||
        typeof manifest.trace_id !== "string" ||
        typeof manifest.rollout_id !== "string" ||
        typeof manifest.root_thread_id !== "string" ||
        manifest.raw_event_log !== "trace.jsonl"
      ) {
        throw new Error("invalid baseline manifest");
      }
      const eventLog = snapshot.files.find(
        (file) =>
          file.relativePath === `${bundleRelativeDirectory}/trace.jsonl`,
      );
      if (!eventLog || !endsWithNewline(eventLog.bytes)) {
        throw new Error("invalid baseline event log");
      }
      let watermark = 0;
      const lines = new TextDecoder().decode(eventLog.bytes).split("\n");
      for (const line of lines) {
        if (line.length === 0) continue;
        const envelope = JSON.parse(line) as Record<string, unknown>;
        if (
          envelope.schema_version !== 1 ||
          !Number.isSafeInteger(envelope.seq) ||
          envelope.seq !== watermark + 1 ||
          envelope.rollout_id !== manifest.rollout_id
        ) {
          throw new Error("invalid baseline event envelope");
        }
        watermark = envelope.seq as number;
      }
      bundles.set(bundleRelativeDirectory, {
        bundleRelativeDirectory,
        cursor: {
          traceId: manifest.trace_id,
          rolloutId: manifest.rollout_id,
          rootThreadId: manifest.root_thread_id,
          afterSeqExclusive: watermark,
        },
        manifestBytes: new Uint8Array(manifestFile.bytes),
        tracePrefixBytes: new Uint8Array(eventLog.bytes),
      });
    }
  } catch {
    return { kind: "invalid", reasonCode: "trace.baseline-invalid" };
  }
  return { kind: "valid", bundles };
}

async function selectBundleForAttempt(input: {
  attempt: MutableAttempt;
  snapshot: CodexRolloutEvidenceSnapshot;
  artifact: CodexEvidenceArtifact;
  phase: "turn" | "final";
  readBundle: typeof readCodexRolloutBundle;
  signal?: AbortSignal;
}): Promise<
  | {
      validation: Extract<CodexRolloutBundleReadResult, { ok: true }>;
      bundle: SelectedBundle;
    }
  | { reasonCodes: string[] }
> {
  if (input.phase === "final") {
    if (!input.attempt.selectedBundle) {
      return { reasonCodes: ["trace.bundle-not-selected"] };
    }
    const directories = bundleDirectories(input.snapshot);
    if (directories.length === 0) {
      return { reasonCodes: ["trace.bundle-missing"] };
    }
    const invalidReasons: string[] = [];
    const invalidBaselineDirectories = new Set<string>();
    if (input.attempt.baseline.kind === "valid") {
      for (
        const bundleRelativeDirectory of input.attempt.baseline.bundles.keys()
      ) {
        const integrityReason = verifyBaselineSnapshotIntegrity(
          input.attempt.baseline,
          bundleRelativeDirectory,
          input.snapshot,
        );
        if (integrityReason) {
          invalidReasons.push(integrityReason);
          invalidBaselineDirectories.add(bundleRelativeDirectory);
        }
      }
    }
    let validation:
      | Extract<CodexRolloutBundleReadResult, { ok: true }>
      | undefined;
    for (const bundleRelativeDirectory of directories) {
      throwIfAborted(input.signal);
      if (invalidBaselineDirectories.has(bundleRelativeDirectory)) continue;
      const candidate = await readSelectedBundle(
        input.artifact,
        bundleRelativeDirectory,
        input.readBundle,
        input.signal,
      );
      if (!candidate.ok) {
        invalidReasons.push(...candidate.reasons.map((reason) => reason.code));
        continue;
      }
      if (
        bundleRelativeDirectory ===
        input.attempt.selectedBundle.bundleRelativeDirectory
      ) {
        validation = candidate;
      }
    }
    if (invalidReasons.length > 0) {
      return { reasonCodes: uniqueStrings(invalidReasons) };
    }
    if (!validation) return { reasonCodes: ["trace.bundle-not-selected"] };
    const integrityReason = verifyBaselineIntegrity(
      input.attempt.baseline,
      input.attempt.selectedBundle.bundleRelativeDirectory,
      input.snapshot,
      validation,
    );
    return integrityReason
      ? { reasonCodes: [integrityReason] }
      : { validation, bundle: input.attempt.selectedBundle };
  }

  const directories = bundleDirectories(input.snapshot);
  if (directories.length === 0) {
    return { reasonCodes: ["trace.bundle-missing"] };
  }
  const candidates: Array<{
    validation: Extract<CodexRolloutBundleReadResult, { ok: true }>;
    bundle: SelectedBundle;
  }> = [];
  const invalidReasons: string[] = [];
  const invalidBaselineDirectories = new Set<string>();

  if (input.attempt.baseline.kind === "valid") {
    for (
      const bundleRelativeDirectory of input.attempt.baseline.bundles.keys()
    ) {
      const integrityReason = verifyBaselineSnapshotIntegrity(
        input.attempt.baseline,
        bundleRelativeDirectory,
        input.snapshot,
      );
      if (integrityReason) {
        invalidReasons.push(integrityReason);
        invalidBaselineDirectories.add(bundleRelativeDirectory);
      }
    }
  }

  for (const bundleRelativeDirectory of directories) {
    throwIfAborted(input.signal);
    if (invalidBaselineDirectories.has(bundleRelativeDirectory)) continue;
    const validation = await readSelectedBundle(
      input.artifact,
      bundleRelativeDirectory,
      input.readBundle,
      input.signal,
    );
    if (!validation.ok) {
      invalidReasons.push(...validation.reasons.map((reason) => reason.code));
      continue;
    }
    const baseline =
      input.attempt.baseline.kind === "valid"
        ? input.attempt.baseline.bundles.get(bundleRelativeDirectory)
        : undefined;
    const cursor: CodexAttemptCursor = baseline?.cursor ?? {
      traceId: validation.identity.traceId,
      rolloutId: validation.identity.rolloutId,
      rootThreadId: validation.identity.rootThreadId,
      afterSeqExclusive: 0,
    };
    const integrityReason = verifyBaselineIntegrity(
      input.attempt.baseline,
      bundleRelativeDirectory,
      input.snapshot,
      validation,
    );
    if (integrityReason) {
      invalidReasons.push(integrityReason);
      continue;
    }
    const rootTurnStarts = validation.events.filter(
      (event) =>
        event.seq > cursor.afterSeqExclusive &&
        event.type === "codex_turn_started" &&
        event.payload.thread_id === validation.identity.rootThreadId,
    );
    if (rootTurnStarts.length > 1) {
      invalidReasons.push("trace.turn-selection-ambiguous");
      continue;
    }
    if (rootTurnStarts.length === 1) {
      candidates.push({
        validation,
        bundle: { bundleRelativeDirectory, cursor },
      });
    }
  }

  if (invalidReasons.length > 0) {
    return { reasonCodes: uniqueStrings(invalidReasons) };
  }
  if (candidates.length > 1) {
    return { reasonCodes: ["trace.bundle-selection-ambiguous"] };
  }
  if (candidates.length === 1) return candidates[0]!;
  return {
    reasonCodes:
      invalidReasons.length > 0
        ? uniqueStrings(invalidReasons)
        : ["trace.bundle-selection-missing"],
  };
}

function verifyBaselineSnapshotIntegrity(
  baseline: AttemptBaseline,
  bundleRelativeDirectory: string,
  snapshot: CodexRolloutEvidenceSnapshot,
): string | undefined {
  if (baseline.kind !== "valid") return undefined;
  const prior = baseline.bundles.get(bundleRelativeDirectory);
  if (!prior) return undefined;
  const manifest = snapshot.files.find(
    (file) =>
      file.relativePath === `${bundleRelativeDirectory}/manifest.json`,
  );
  const trace = snapshot.files.find(
    (file) => file.relativePath === `${bundleRelativeDirectory}/trace.jsonl`,
  );
  if (
    !manifest ||
    !trace ||
    !bytesEqual(manifest.bytes, prior.manifestBytes) ||
    !bytesStartWith(trace.bytes, prior.tracePrefixBytes)
  ) {
    return "trace.bundle-prefix-rewritten";
  }
  return undefined;
}

async function readSelectedBundle(
  artifact: CodexEvidenceArtifact,
  bundleRelativeDirectory: string,
  readBundle: typeof readCodexRolloutBundle,
  signal?: AbortSignal,
): Promise<CodexRolloutBundleReadResult> {
  throwIfAborted(signal);
  const result = await readBundle(
    join(artifact.rawRoot, ...bundleRelativeDirectory.split("/")),
  );
  throwIfAborted(signal);
  return result;
}

function verifyBaselineIntegrity(
  baseline: AttemptBaseline,
  bundleRelativeDirectory: string,
  snapshot: CodexRolloutEvidenceSnapshot,
  validation: CodexRolloutBundle,
): string | undefined {
  if (baseline.kind !== "valid") return undefined;
  const prior = baseline.bundles.get(bundleRelativeDirectory);
  if (!prior) return undefined;
  if (
    prior.cursor.traceId !== validation.identity.traceId ||
    prior.cursor.rolloutId !== validation.identity.rolloutId ||
    prior.cursor.rootThreadId !== validation.identity.rootThreadId
  ) {
    return "trace.bundle-identity-changed";
  }
  return verifyBaselineSnapshotIntegrity(
    baseline,
    bundleRelativeDirectory,
    snapshot,
  );
}

function bundleDirectories(snapshot: CodexRolloutEvidenceSnapshot): string[] {
  return snapshot.files
    .filter((file) => file.relativePath.endsWith("/manifest.json"))
    .map((file) => posix.dirname(file.relativePath))
    .sort((left, right) => left.localeCompare(right));
}

function baselineAudit(baseline: AttemptBaseline): CodexEvidenceBaselineAudit {
  if (baseline.kind !== "valid") return { ...baseline };
  return {
    kind: "valid",
    bundles: [...baseline.bundles.values()]
      .sort((left, right) =>
        left.bundleRelativeDirectory.localeCompare(
          right.bundleRelativeDirectory,
        ),
      )
      .map((bundle) => ({
        bundleRelativeDirectory: bundle.bundleRelativeDirectory,
        cursor: { ...bundle.cursor },
        manifestSha256: sha256Bytes(bundle.manifestBytes),
        tracePrefixSha256: sha256Bytes(bundle.tracePrefixBytes),
        tracePrefixBytes: bundle.tracePrefixBytes.byteLength,
      })),
  };
}

export function createDaytonaCodexRolloutEvidenceSource(
  sourceRoot: string,
  sandbox: DaytonaCodexEvidenceSandbox,
  options: {
    limits?: Partial<CodexEvidenceSourceLimits>;
    cleanupToken?: string;
  } = {},
): CodexRolloutEvidenceSource {
  const root = posix.resolve(sourceRoot);
  const limits = { ...DEFAULT_SOURCE_LIMITS, ...options.limits };
  assertSafePosixCleanupRoot(root);

  return {
    async snapshot(snapshotOptions) {
      const signal = snapshotOptions?.signal;
      throwIfAborted(signal);
      const files: CodexRolloutEvidenceSnapshotFile[] = [];
      const visitedDirectories = new Set<string>();
      let totalBytes = 0;
      let totalEntries = 0;

      const walk = async (directory: string, depth: number): Promise<void> => {
        throwIfAborted(signal);
        if (depth > limits.maxDepth) {
          throw new Error("source tree depth limit exceeded");
        }
        if (visitedDirectories.has(directory)) {
          throw new Error("source tree contains a directory cycle");
        }
        visitedDirectories.add(directory);
        let listed: unknown[];
        try {
          listed = await sandbox.listFsEntries(
            { path: directory },
            { signal },
          );
        } catch (error) {
          if (directory === root && isNotFoundError(error)) return;
          throw error;
        }
        throwIfAborted(signal);
        const entries = listed
          .map(parseDaytonaFsEntry)
          .sort((left, right) => left.path.localeCompare(right.path));
        for (const entry of entries) {
          throwIfAborted(signal);
          totalEntries += 1;
          if (totalEntries > limits.maxEntries) {
            throw new Error("source entry count limit exceeded");
          }
          const entryPath = posix.resolve(entry.path);
          if (!isWithinPosix(root, entryPath)) {
            throw new Error("source entry escaped trace root");
          }
          if (entry.entryType === "directory") {
            await walk(entryPath, depth + 1);
            continue;
          }
          if (entry.entryType !== "file") {
            throw new Error("source tree contains an unsupported entry");
          }
          if (files.length >= limits.maxFiles) {
            throw new Error("source file count limit exceeded");
          }
          if (
            !Number.isSafeInteger(entry.size) ||
            entry.size < 0 ||
            entry.size > limits.maxFileBytes
          ) {
            throw new Error("source file byte limit exceeded");
          }
          if (totalBytes + entry.size > limits.maxTotalBytes) {
            throw new Error("source total byte limit exceeded");
          }
          const bytes = new Uint8Array(
            await sandbox.readFsFile({ path: entryPath }, { signal }),
          );
          throwIfAborted(signal);
          if (bytes.byteLength > entry.size) {
            throw new Error("source file grew after stat");
          }
          if (bytes.byteLength > limits.maxFileBytes) {
            throw new Error("source file byte limit exceeded");
          }
          if (totalBytes + bytes.byteLength > limits.maxTotalBytes) {
            throw new Error("source total byte limit exceeded");
          }
          totalBytes += bytes.byteLength;
          files.push({
            relativePath: posix.relative(root, entryPath),
            bytes,
          });
        }
      };

      await walk(root, 0);
      throwIfAborted(signal);
      files.sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );
      return { files };
    },
    async cleanup(cleanupOptions) {
      const signal = cleanupOptions?.signal;
      throwIfAborted(signal);
      assertOwnedPosixCleanupRoot(root, options.cleanupToken);
      await sandbox.deleteFsEntry(
        { path: root, recursive: true },
        { signal },
      );
      throwIfAborted(signal);
    },
  };
}

export function createLocalCodexEvidenceSink(input: {
  artifactRoot: string;
}): CodexEvidenceSink {
  const artifactRoot = resolve(input.artifactRoot);
  assertSafeCleanupRoot(artifactRoot);

  return {
    async preserve(preserveInput) {
      const signal = preserveInput.signal;
      throwIfAborted(signal);
      const artifactRootReal = await ensureRealDirectory(artifactRoot, signal);
      assertSafeIdentifier(preserveInput.captureId, "capture id");
      assertSafeIdentifier(preserveInput.attemptId, "attempt id");
      if (!Number.isSafeInteger(preserveInput.revision) || preserveInput.revision < 1) {
        throw new Error("invalid evidence revision");
      }
      const revisionName = `revision-${String(preserveInput.revision).padStart(4, "0")}`;
      const attemptRoot = join(
        artifactRoot,
        preserveInput.captureId,
        preserveInput.attemptId,
      );
      const captureRoot = join(artifactRoot, preserveInput.captureId);
      const revisionRoot = join(attemptRoot, revisionName);
      const stagingRoot = join(
        attemptRoot,
        `.staging-${revisionName}-${randomUUID()}`,
      );
      await ensureChildRealDirectory(captureRoot, artifactRootReal, signal);
      await ensureChildRealDirectory(attemptRoot, artifactRootReal, signal);
      await chmod(artifactRoot, 0o700).catch(() => undefined);
      throwIfAborted(signal);
      await chmod(captureRoot, 0o700);
      throwIfAborted(signal);
      await chmod(attemptRoot, 0o700);
      throwIfAborted(signal);
      await mkdir(stagingRoot, { mode: 0o700 });
      throwIfAborted(signal);
      const rawRoot = join(stagingRoot, "raw");
      await mkdir(rawRoot, { mode: 0o700 });
      throwIfAborted(signal);

      try {
        const seen = new Set<string>();
        for (const file of [...preserveInput.snapshot.files].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        )) {
          throwIfAborted(signal);
          const relativePath = validateSnapshotRelativePath(file.relativePath);
          if (seen.has(relativePath)) throw new Error("duplicate snapshot path");
          seen.add(relativePath);
          const destination = join(rawRoot, ...relativePath.split("/"));
          if (!isWithinLocal(rawRoot, destination)) {
            throw new Error("snapshot path escaped artifact root");
          }
          await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
          throwIfAborted(signal);
          await writeFile(destination, file.bytes, {
            flag: "wx",
            mode: 0o600,
            signal,
          });
          throwIfAborted(signal);
          await chmod(destination, 0o400);
          throwIfAborted(signal);
        }
        throwIfAborted(signal);
        await rename(stagingRoot, revisionRoot);
        throwIfAborted(signal);
      } catch (error) {
        await rm(stagingRoot, { recursive: true, force: true }).catch(
          () => undefined,
        );
        throw error;
      }

      const finalRawRoot = join(revisionRoot, "raw");
      return {
        reference: `codex-evidence://${preserveInput.captureId}/${preserveInput.attemptId}/${revisionName}`,
        rawRoot: finalRawRoot,
        revisionRoot,
      };
    },
    async appendAssessment(artifact, assessment, appendOptions) {
      const signal = appendOptions?.signal;
      throwIfAborted(signal);
      const artifactRootReal = await ensureRealDirectory(artifactRoot, signal);
      const revisionRootReal = await realpath(artifact.revisionRoot);
      throwIfAborted(signal);
      if (!isWithinLocal(artifactRootReal, revisionRootReal)) {
        throw new Error("artifact escaped sink root");
      }
      const path = join(revisionRootReal, "assessment.json");
      await writeFile(path, `${JSON.stringify(assessment)}\n`, {
        flag: "wx",
        mode: 0o600,
        signal,
      });
      throwIfAborted(signal);
      await chmod(path, 0o600);
      throwIfAborted(signal);
    },
  };
}

interface BundleBaseline {
  bundleRelativeDirectory: string;
  cursor: CodexAttemptCursor;
  manifestBytes: Uint8Array;
  tracePrefixBytes: Uint8Array;
}

type AttemptBaseline =
  | { kind: "empty" }
  | { kind: "valid"; bundles: ReadonlyMap<string, BundleBaseline> }
  | { kind: "invalid"; reasonCode: string };

interface SelectedBundle {
  bundleRelativeDirectory: string;
  cursor: CodexAttemptCursor;
}

interface MutableAttempt {
  attemptId: string;
  revision: number;
  baseline: AttemptBaseline;
  publicView: CodexEvidenceAttempt;
  selectedBundle?: SelectedBundle;
  targetTurnId?: string;
  targetTurnTerminalSeq?: number;
  outcome?: CodexTurnOutcome;
  finalized: boolean;
}

interface CodexEvidencePortLimits {
  maxAttempts: number;
  maxRevisions: number;
  maxAggregateSnapshotBytes: number;
}

const DEFAULT_PORT_LIMITS: Readonly<CodexEvidencePortLimits> = {
  maxAttempts: 256,
  maxRevisions: 512,
  maxAggregateSnapshotBytes: 512 * 1024 * 1024,
};

const CAPACITY_EXHAUSTED_ATTEMPT: CodexEvidenceAttempt = deepFreeze({
  attemptId: "evidence-capacity-exhausted",
});

export function createCodexRolloutEvidencePort(input: {
  capture: CodexRolloutTraceCapture;
  sandbox?: DaytonaCodexEvidenceSandbox;
  source?: CodexRolloutEvidenceSource;
  sink?: CodexEvidenceSink;
  artifactRoot?: string;
  attemptId?: () => string;
  now?: () => number;
  readBundle?: typeof readCodexRolloutBundle;
  producerTrust?: CodexEvidenceSourceTrust;
  limits?: Partial<CodexEvidencePortLimits>;
  log?: (message: string) => void;
}): CodexRolloutEvidencePort {
  const source =
    input.source ??
    (input.capture.remote
      ? input.sandbox
        ? createDaytonaCodexRolloutEvidenceSource(
            input.capture.sourceRoot,
            input.sandbox,
            { cleanupToken: input.capture.captureId },
          )
        : unavailableSource()
      : createLocalCodexRolloutEvidenceSource(input.capture.sourceRoot, {
          cleanupToken: input.capture.captureId,
        }));
  const sink =
    input.sink ??
    createLocalCodexEvidenceSink({
      artifactRoot: input.artifactRoot ?? defaultArtifactRoot(),
    });
  const createAttemptId = input.attemptId ?? randomUUID;
  const now = input.now ?? Date.now;
  const readBundle = input.readBundle ?? readCodexRolloutBundle;
  const producerTrust = input.producerTrust ?? "diagnostic_full_access";
  const limits = { ...DEFAULT_PORT_LIMITS, ...input.limits };
  const log = (code: string): void => {
    input.log?.(`codex rollout evidence: ${code}`);
  };
  const recordLog: CodexEvidenceRecord[] = [];
  const pendingFinalization: MutableAttempt[] = [];
  let activeAttempt: MutableAttempt | undefined;
  let attemptCount = 0;
  let revisionCount = 0;
  let aggregateSnapshotBytes = 0;
  let aggregateLimitExceeded = false;
  let abandoned = false;
  let operationTail: Promise<void> = Promise.resolve();

  const observeAbort = (signal?: AbortSignal): (() => void) => {
    if (!signal) return () => {};
    const markAbandoned = (): void => {
      abandoned = true;
    };
    if (signal.aborted) markAbandoned();
    else signal.addEventListener("abort", markAbandoned, { once: true });
    return () => signal.removeEventListener("abort", markAbandoned);
  };

  const serialize = <T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const removeAbortListener = observeAbort(signal);
    const running = operationTail.then(async () => {
      if (abandoned || signal?.aborted) {
        throw abortError();
      }
      return operation();
    });
    operationTail = running.then(
      () => undefined,
      () => undefined,
    );
    void running.finally(removeAbortListener).catch(() => undefined);
    return running;
  };

  const accountSnapshot = (snapshot: CodexRolloutEvidenceSnapshot): void => {
    const bytes = snapshot.files.reduce(
      (total, file) => total + file.bytes.byteLength,
      0,
    );
    if (
      !Number.isSafeInteger(bytes) ||
      aggregateSnapshotBytes + bytes > limits.maxAggregateSnapshotBytes
    ) {
      aggregateLimitExceeded = true;
      aggregateSnapshotBytes = limits.maxAggregateSnapshotBytes;
      throw new Error("aggregate evidence snapshot limit exceeded");
    }
    aggregateSnapshotBytes += bytes;
  };

  const beginTurn = async (beginInput?: {
    signal?: AbortSignal;
  }): Promise<CodexEvidenceAttempt> => {
    if (activeAttempt) return activeAttempt.publicView;
    if (
      attemptCount >= limits.maxAttempts ||
      revisionCount >= limits.maxRevisions ||
      aggregateLimitExceeded
    ) {
      log("capacity-exhausted");
      return CAPACITY_EXHAUSTED_ATTEMPT;
    }
    attemptCount += 1;
    const attempt: MutableAttempt = {
      attemptId: createAttemptId(),
      revision: 0,
      baseline: { kind: "invalid", reasonCode: "trace.baseline-unavailable" },
      publicView: freezeAttempt({ attemptId: "pending" }),
      finalized: false,
    };
    attempt.publicView = freezeAttempt({ attemptId: attempt.attemptId });
    // Publish the handle before snapshot I/O so concurrent pause/resume callers cannot mint two
    // attempts while the first bounded source read is still pending.
    activeAttempt = attempt;

    return serialize(beginInput?.signal, async () => {
      try {
        const snapshot = await source.snapshot({ signal: beginInput?.signal });
        throwIfAborted(beginInput?.signal);
        accountSnapshot(snapshot);
        const baseline = baselineFromSnapshot(snapshot);
        throwIfAborted(beginInput?.signal);
        attempt.baseline = baseline;
        const soleBaseline =
          baseline.kind === "valid" && baseline.bundles.size === 1
            ? [...baseline.bundles.values()][0]
            : undefined;
        attempt.publicView = freezeAttempt({
          attemptId: attempt.attemptId,
          ...(soleBaseline === undefined
            ? {}
            : {
                cursor: soleBaseline.cursor,
                bundleRelativeDirectory:
                  soleBaseline.bundleRelativeDirectory,
              }),
        });
      } catch (error) {
        if (beginInput?.signal?.aborted) return attempt.publicView;
        attempt.baseline = {
          kind: "invalid",
          reasonCode: isAggregateLimitError(error)
            ? "trace.aggregate-limit-exceeded"
            : "trace.baseline-read-failed",
        };
        log("begin-source-read-failed");
      }
      return attempt.publicView;
    });
  };

  const collect = async (
    attempt: MutableAttempt,
    phase: "turn" | "final",
    outcome: CodexTurnOutcome,
    signal?: AbortSignal,
  ): Promise<CodexEvidenceRecord | undefined> => {
    throwIfAborted(signal);
    const shouldRecordBaselineAggregateFailure =
      attempt.revision === 0 &&
      attempt.baseline.kind === "invalid" &&
      attempt.baseline.reasonCode === "trace.aggregate-limit-exceeded";
    if (aggregateLimitExceeded && !shouldRecordBaselineAggregateFailure) {
      log("aggregate-limit-exceeded");
      return undefined;
    }
    if (revisionCount >= limits.maxRevisions) {
      log("revision-limit-exceeded");
      return undefined;
    }
    revisionCount += 1;
    const revision = attempt.revision + 1;
    attempt.revision = revision;
    if (
      attempt.baseline.kind === "invalid" &&
      attempt.baseline.reasonCode === "trace.aggregate-limit-exceeded"
    ) {
      return appendRecord(
        failureRecord(attempt.attemptId, revision, phase, outcome, [
          "trace.aggregate-limit-exceeded",
        ]),
      );
    }
    let snapshot: CodexRolloutEvidenceSnapshot;
    try {
      snapshot = await source.snapshot({ signal });
      throwIfAborted(signal);
      accountSnapshot(snapshot);
    } catch (error) {
      if (signal?.aborted) throw error;
      log("source-read-failed");
      return appendRecord(
        failureRecord(attempt.attemptId, revision, phase, outcome, [
          isAggregateLimitError(error)
            ? "trace.aggregate-limit-exceeded"
            : "trace.source-read-failed",
        ]),
      );
    }

    let artifact: CodexEvidenceArtifact;
    try {
      artifact = await sink.preserve({
        captureId: input.capture.captureId,
        attemptId: attempt.attemptId,
        revision,
        snapshot,
        signal,
      });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      log("raw-preserve-failed");
      return appendRecord(
        failureRecord(attempt.attemptId, revision, phase, outcome, [
          "trace.raw-preserve-failed",
        ]),
      );
    }

    if (attempt.baseline.kind === "invalid") {
      const record = failureRecord(
        attempt.attemptId,
        revision,
        phase,
        outcome,
        [attempt.baseline.reasonCode],
        artifact.reference,
      );
      await appendAssessmentBestEffort(
        sink,
        artifact,
        record,
        attempt,
        producerTrust,
        log,
        signal,
      );
      return appendRecord(record);
    }

    let selected:
      | { validation: Extract<CodexRolloutBundleReadResult, { ok: true }>; bundle: SelectedBundle }
      | { reasonCodes: string[] };
    try {
      selected = await selectBundleForAttempt({
        attempt,
        snapshot,
        artifact,
        phase,
        readBundle,
        signal,
      });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      log("validation-failed");
      const record = failureRecord(attempt.attemptId, revision, phase, outcome, [
        "trace.validation-failed",
      ], artifact.reference);
      await appendAssessmentBestEffort(
        sink,
        artifact,
        record,
        attempt,
        producerTrust,
        log,
        signal,
      );
      return appendRecord(record);
    }

    if ("reasonCodes" in selected) {
      const record = failureRecord(
        attempt.attemptId,
        revision,
        phase,
        outcome,
        selected.reasonCodes,
        artifact.reference,
      );
      await appendAssessmentBestEffort(
        sink,
        artifact,
        record,
        attempt,
        producerTrust,
        log,
        signal,
      );
      return appendRecord(record);
    }
    const { validation, bundle } = selected;
    throwIfAborted(signal);
    attempt.selectedBundle = bundle;

    const lifecycle = reduceCodexRolloutLifecycle(validation, {
      ...bundle.cursor,
      ...(attempt.targetTurnId === undefined
        ? {}
        : { targetTurnId: attempt.targetTurnId }),
    });
    if (phase === "turn" && lifecycle.targetTurnId) {
      attempt.targetTurnId = lifecycle.targetTurnId;
      attempt.targetTurnTerminalSeq = lifecycle.targetTurnTerminalSeq;
    }
    if (
      phase === "final" &&
      attempt.targetTurnTerminalSeq !== undefined &&
      validation.events.some(
        (event) =>
          event.seq > attempt.targetTurnTerminalSeq! &&
          event.type === "codex_turn_started" &&
          event.payload.thread_id === validation.identity.rootThreadId,
      )
    ) {
      const record = failureRecord(
        attempt.attemptId,
        revision,
        phase,
        outcome,
        ["trace.turn-boundary-ambiguous"],
        artifact.reference,
      );
      await appendAssessmentBestEffort(
        sink,
        artifact,
        record,
        attempt,
        producerTrust,
        log,
        signal,
      );
      return appendRecord(record);
    }
    const rawSummary = createCodexEvidenceSummary({
      bundle: validation,
      lifecycle,
      artifactReference: artifact.reference,
      collectedAtUnixMs: now(),
    });
    const producerTrusted = producerTrust === "runtime_isolated";
    const summary: CodexEvidenceSummaryV1 = deepFreeze({
      ...rawSummary,
      hardScoreEligible: rawSummary.hardScoreEligible && producerTrusted,
    });
    const reasonCodes: string[] = lifecycle.reasons.map(
      (reason) => reason.code,
    );
    if (summary.completeness !== "rollout_complete") {
      reasonCodes.push("trace.rollout-incomplete");
    }
    if (summary.completeness !== "invalid" && !producerTrusted) {
      reasonCodes.push("trace.writer-not-isolated");
    }
    const collectionStatus: CodexEvidenceCollectionStatus =
      outcome === "cancelled"
        ? "CANCELLED"
        : outcome === "error"
          ? "INVALID_TRACE"
          : summary.completeness === "invalid"
            ? "INVALID_TRACE"
            : !producerTrusted
              ? "DIAGNOSTIC_ONLY"
              : summary.completeness !== "rollout_complete"
                ? "PENDING_TERMINAL"
                : summary.hardScoreEligible
                  ? "READY_FOR_EVALUATION"
                  : "INVALID_TRACE";
    const attemptEvents = validation.events.filter(
      (event) =>
        event.seq > lifecycle.watermark.afterSeqExclusive &&
        event.seq <= lifecycle.watermark.toSeqInclusive,
    );
    const uniqueReasonCodes = uniqueStrings(reasonCodes);
    const projection: CodexEvidenceProjection = {
      schemaVersion: summary.schemaVersion,
      collectionStatus,
      sourceTrust: producerTrust,
      completeness: summary.completeness,
      digest: summary.evidenceDigest,
      artifactRef: artifact.reference,
      ...(uniqueReasonCodes.length === 0
        ? {}
        : { reasonCodes: uniqueReasonCodes }),
      events: summary.counts.events,
      payloads: summary.counts.payloads,
      tools: summary.eventTypeCounts.tool_call_started ?? 0,
      toolErrors: attemptEvents.filter(
        (event) =>
          event.type === "tool_call_ended" &&
          event.payload.status !== "completed",
      ).length,
      openRuntimeObjects: summary.lifecycleWarnings.length,
    };
    const record: CodexEvidenceRecord = {
      attemptId: attempt.attemptId,
      revision,
      phase,
      outcome,
      artifactReference: artifact.reference,
      summary,
      projection,
      reasonCodes: uniqueReasonCodes,
    };
    throwIfAborted(signal);
    await appendAssessmentBestEffort(
      sink,
      artifact,
      record,
      attempt,
      producerTrust,
      log,
      signal,
    );
    throwIfAborted(signal);
    return appendRecord(record);
  };

  const appendRecord = (record: CodexEvidenceRecord): CodexEvidenceRecord => {
    const frozen = deepFreeze({
      ...record,
      projection: { ...record.projection, sourceTrust: producerTrust },
    });
    recordLog.push(frozen);
    return frozen;
  };

  return {
    beginTurn,
    async settleTurn({ outcome, signal }) {
      if (outcome === "paused") return undefined;
      if (abandoned) return undefined;
      if (!activeAttempt) return undefined;
      const attempt = activeAttempt;
      activeAttempt = undefined;
      attempt.outcome = outcome;
      pendingFinalization.push(attempt);
      return serialize(signal, async () => {
        try {
          return await collect(attempt, "turn", outcome, signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          log("settle-failed");
          return appendRecord(
            failureRecord(
              attempt.attemptId,
              attempt.revision,
              "turn",
              outcome,
              ["trace.collector-failed"],
            ),
          );
        }
      });
    },
    async finalize(finalizeInput) {
      if (abandoned) return;
      if (activeAttempt) {
        activeAttempt.outcome = "paused";
        pendingFinalization.push(activeAttempt);
        activeAttempt = undefined;
      }
      return serialize(finalizeInput?.signal, async () => {
        const attempts = pendingFinalization.splice(0);
        const finalAttempt = attempts.findLast((attempt) => !attempt.finalized);
        for (const attempt of attempts) {
          if (attempt !== finalAttempt) attempt.finalized = true;
        }
        if (!finalAttempt || finalAttempt.finalized) return;
        try {
          await collect(
            finalAttempt,
            "final",
            finalAttempt.outcome ?? "completed",
            finalizeInput?.signal,
          );
        } catch (error) {
          if (finalizeInput?.signal?.aborted) throw error;
          log("finalize-failed");
        }
        finalAttempt.finalized = true;
      });
    },
    async cleanup(cleanupInput) {
      if (abandoned) return;
      return serialize(cleanupInput?.signal, async () => {
        try {
          await source.cleanup({ signal: cleanupInput?.signal });
          throwIfAborted(cleanupInput?.signal);
        } catch (error) {
          if (cleanupInput?.signal?.aborted) throw error;
          log("cleanup-failed");
        }
      });
    },
    records() {
      return deepFreeze([...recordLog]);
    },
  };
}

async function appendAssessmentBestEffort(
  sink: CodexEvidenceSink,
  artifact: CodexEvidenceArtifact,
  record: CodexEvidenceRecord,
  attempt: MutableAttempt,
  sourceTrust: CodexEvidenceSourceTrust,
  log: (code: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await sink.appendAssessment(artifact, {
      schemaVersion: "codex-evidence-assessment/v1",
      attemptId: record.attemptId,
      revision: record.revision,
      phase: record.phase,
      outcome: record.outcome,
      artifactReference: artifact.reference,
      ...(record.summary === undefined ? {} : { summary: record.summary }),
      projection: { ...record.projection, sourceTrust },
      reasonCodes: record.reasonCodes,
      baselineAudit: baselineAudit(attempt.baseline),
    }, { signal });
    throwIfAborted(signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    log("assessment-append-failed");
  }
}

function failureRecord(
  attemptId: string,
  revision: number,
  phase: "turn" | "final",
  outcome: CodexTurnOutcome,
  reasonCodes: string[],
  artifactReference?: string,
): CodexEvidenceRecord {
  return {
    attemptId,
    revision,
    phase,
    outcome,
    ...(artifactReference === undefined ? {} : { artifactReference }),
    projection: {
      schemaVersion: "codex-evidence/v1",
      collectionStatus: "INVALID_TRACE",
      sourceTrust: "diagnostic_full_access",
      completeness: "invalid",
      ...(artifactReference === undefined
        ? {}
        : { artifactRef: artifactReference }),
      ...(reasonCodes.length === 0 ? {} : { reasonCodes: uniqueStrings(reasonCodes) }),
      events: 0,
      payloads: 0,
      tools: 0,
      toolErrors: 0,
      openRuntimeObjects: 0,
    },
    reasonCodes: uniqueStrings(reasonCodes),
  };
}

function unavailableSource(): CodexRolloutEvidenceSource {
  return {
    async snapshot() {
      throw new Error("remote evidence source unavailable");
    },
    async cleanup() {},
  };
}

function parseDaytonaFsEntry(value: unknown): DaytonaFsEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error("invalid sandbox filesystem entry");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.path !== "string" ||
    typeof candidate.entryType !== "string" ||
    typeof candidate.size !== "number"
  ) {
    throw new Error("invalid sandbox filesystem entry");
  }
  return {
    path: candidate.path,
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    entryType: candidate.entryType,
    size: candidate.size,
  };
}

function validateSnapshotRelativePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    posix.isAbsolute(value) ||
    posix.normalize(value) !== value ||
    value === ".." ||
    value.startsWith("../")
  ) {
    throw new Error("invalid snapshot path");
  }
  return value;
}

function portableRelative(parent: string, child: string): string {
  const value = relative(parent, child).split(sep).join("/");
  return validateSnapshotRelativePath(value);
}

function isWithinLocal(parent: string, child: string): boolean {
  const value = relative(parent, child);
  return (
    value === "" ||
    (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  );
}

function isWithinPosix(parent: string, child: string): boolean {
  const value = posix.relative(parent, child);
  return value === "" || (value !== ".." && !value.startsWith("../"));
}

function assertSafeCleanupRoot(path: string): void {
  const absolute = resolve(path);
  const depth = absolute.split(sep).filter(Boolean).length;
  if (
    absolute === dirname(absolute) ||
    absolute === resolve(tmpdir()) ||
    depth < 3
  ) {
    throw new Error("unsafe source root");
  }
}

/**
 * Resolve a local trace root below the OS temp directory without following any
 * symlink introduced below that trusted boundary. The temp directory itself may
 * be a platform alias (for example `/var` to `/private/var` on macOS), so paths
 * are compared relative to its canonical location.
 */
async function resolveLocalSourceRoot(
  sourceRoot: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const requestedRoot = resolve(sourceRoot);
  assertSafeCleanupRoot(requestedRoot);
  const requestedTempRoot = resolve(tmpdir());
  if (!isWithinLocal(requestedTempRoot, requestedRoot)) {
    throw new Error("source root must remain below the OS temp directory");
  }
  throwIfAborted(signal);
  const canonicalTempRoot = await realpath(requestedTempRoot);
  throwIfAborted(signal);
  const relativeRoot = relative(requestedTempRoot, requestedRoot);
  const segments = relativeRoot.split(sep).filter(Boolean);
  let requestedPath = requestedTempRoot;
  let expectedPath = canonicalTempRoot;

  for (let index = 0; index < segments.length; index += 1) {
    requestedPath = join(requestedPath, segments[index]!);
    expectedPath = join(expectedPath, segments[index]!);
    let state;
    try {
      state = await lstat(requestedPath);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      throw error;
    }
    throwIfAborted(signal);
    const isRoot = index === segments.length - 1;
    if (state.isSymbolicLink()) {
      throw new Error(
        isRoot
          ? "source root must be a real directory"
          : "source root contains a symbolic-link ancestor",
      );
    }
    if (!state.isDirectory()) {
      throw new Error(
        isRoot
          ? "source root must be a real directory"
          : "source root ancestor must be a real directory",
      );
    }
    const actualPath = await realpath(requestedPath);
    throwIfAborted(signal);
    if (actualPath !== expectedPath) {
      throw new Error("source root contains a symbolic-link ancestor");
    }
  }

  return expectedPath;
}

function assertSafePosixCleanupRoot(path: string): void {
  const absolute = posix.resolve(path);
  const depth = absolute.split("/").filter(Boolean).length;
  if (absolute === "/" || depth < 3) throw new Error("unsafe source root");
}

function assertOwnedCleanupRoot(path: string, token?: string): void {
  if (
    !token ||
    !/^[A-Za-z0-9._-]+$/.test(token) ||
    dirname(path).split(sep).at(-1) !== "codex-rollout-traces" ||
    path.split(sep).at(-1) !== token
  ) {
    throw new Error("source cleanup ownership is not configured");
  }
}

function assertOwnedPosixCleanupRoot(path: string, token?: string): void {
  if (
    !token ||
    !/^[A-Za-z0-9._-]+$/.test(token) ||
    posix.basename(posix.dirname(path)) !== "codex-rollout-traces" ||
    posix.basename(path) !== token
  ) {
    throw new Error("source cleanup ownership is not configured");
  }
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error(`invalid ${label}`);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function defaultArtifactRoot(): string {
  const configured =
    process.env[AGENTA_CODEX_EVIDENCE_ARTIFACT_ROOT_ENV]?.trim();
  return configured && configured.length > 0
    ? configured
    : join(tmpdir(), `agenta-codex-rollout-evidence-${randomUUID()}`);
}

async function readLocalFileBounded(input: {
  path: string;
  resolvedPath: string;
  root: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  if (input.maxBytes < 0) throw new Error("source total byte limit exceeded");
  throwIfAborted(input.signal);
  const handle = await open(
    input.path,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    throwIfAborted(input.signal);
    const before = await handle.stat();
    throwIfAborted(input.signal);
    if (!before.isFile() || before.size > input.maxBytes) {
      throw new Error("source file byte limit exceeded");
    }
    const currentRealPath = await realpath(input.path);
    throwIfAborted(input.signal);
    if (
      currentRealPath !== input.resolvedPath ||
      !isWithinLocal(input.root, currentRealPath)
    ) {
      throw new Error("source entry changed during snapshot");
    }
    const pathState = await lstat(currentRealPath);
    throwIfAborted(input.signal);
    if (
      pathState.isSymbolicLink() ||
      pathState.dev !== before.dev ||
      pathState.ino !== before.ino
    ) {
      throw new Error("source entry changed during snapshot");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      throwIfAborted(input.signal);
      const capacity = Math.min(64 * 1024, input.maxBytes - total + 1);
      if (capacity <= 0) throw new Error("source file byte limit exceeded");
      const buffer = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(buffer, 0, capacity, total);
      throwIfAborted(input.signal);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > input.maxBytes) {
        throw new Error("source file byte limit exceeded");
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    throwIfAborted(input.signal);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      total !== before.size
    ) {
      throw new Error("source file changed during snapshot");
    }
    const pathAfter = await realpath(input.path);
    const pathAfterState = await lstat(pathAfter);
    throwIfAborted(input.signal);
    if (
      pathAfter !== currentRealPath ||
      pathAfterState.dev !== before.dev ||
      pathAfterState.ino !== before.ino
    ) {
      throw new Error("source entry changed during snapshot");
    }
    return new Uint8Array(Buffer.concat(chunks, total));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function ensureRealDirectory(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  let state;
  try {
    state = await lstat(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
    state = await lstat(path);
  }
  throwIfAborted(signal);
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error("artifact root must be a real directory");
  }
  const resolved = await realpath(path);
  throwIfAborted(signal);
  return resolved;
}

async function assertRealDirectoryWithin(
  path: string,
  parentRealPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const state = await lstat(path);
  throwIfAborted(signal);
  if (state.isSymbolicLink() || !state.isDirectory()) {
    throw new Error("artifact path must be a real directory");
  }
  const resolved = await realpath(path);
  throwIfAborted(signal);
  if (!isWithinLocal(parentRealPath, resolved)) {
    throw new Error("artifact path escaped sink root");
  }
}

async function ensureChildRealDirectory(
  path: string,
  parentRealPath: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
  }
  throwIfAborted(signal);
  await assertRealDirectoryWithin(path, parentRealPath, signal);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw abortError();
}

function abortError(): Error {
  const error = new Error("codex evidence operation aborted");
  error.name = "AbortError";
  return error;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("code" in error && error.code === "ENOENT") ||
      ("status" in error && error.status === 404) ||
      ("statusCode" in error && error.statusCode === 404))
  );
}

function isAggregateLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("aggregate evidence");
}

function endsWithNewline(bytes: Uint8Array): boolean {
  return bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0a;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength &&
    left.every((value, index) => value === right[index])
  );
}

function bytesStartWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return (
    value.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => value[index] === byte)
  );
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function freezeAttempt(attempt: CodexEvidenceAttempt): CodexEvidenceAttempt {
  return deepFreeze({
    attemptId: attempt.attemptId,
    ...(attempt.cursor === undefined ? {} : { cursor: { ...attempt.cursor } }),
    ...(attempt.bundleRelativeDirectory === undefined
      ? {}
      : { bundleRelativeDirectory: attempt.bundleRelativeDirectory }),
  });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    deepFreeze(item);
  }
  return Object.freeze(value);
}
