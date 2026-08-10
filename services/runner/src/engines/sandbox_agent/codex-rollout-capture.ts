import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CODEX_ROLLOUT_TRACE_ROOT_ENV = "CODEX_ROLLOUT_TRACE_ROOT";
export const AGENTA_CODEX_EVIDENCE_CAPTURE_ENV =
  "AGENTA_RUNNER_CODEX_EVIDENCE_CAPTURE";

export interface CodexRolloutTraceCapture {
  /** Runner-generated identifier. It is safe to log; native payload content is not. */
  captureId: string;
  /** Sandbox-visible root below which Codex creates one native bundle per root thread. */
  sourceRoot: string;
  /** True when the source must be read through the remote sandbox filesystem API. */
  remote: boolean;
}

type CodexCapturePlan = {
  acpAgent: string;
  isDaytona: boolean;
};

type CodexCaptureEnvironment = {
  env: Record<string, string>;
  piExtEnv: Record<string, string>;
};

interface PrepareCodexRolloutTraceDeps {
  /** Explicit override for tests and evaluation-worker composition. */
  enabled?: boolean;
  processEnv?: NodeJS.ProcessEnv;
  captureId?: () => string;
  tmpDir?: () => string;
}

function enabledFromEnvironment(env: NodeJS.ProcessEnv): boolean {
  const value = env[AGENTA_CODEX_EVIDENCE_CAPTURE_ENV]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/**
 * Prepare one environment-scoped native Codex trace root before the daemon environment freezes.
 *
 * The source is intentionally isolated from CODEX_HOME, CODEX_SQLITE_HOME, the durable cwd, and
 * the user's workspace. It is a staging area only: the evidence collector must preserve an
 * immutable attempt before teardown removes this source.
 */
export function prepareCodexRolloutTrace(
  plan: CodexCapturePlan,
  target: CodexCaptureEnvironment,
  deps: PrepareCodexRolloutTraceDeps = {},
): CodexRolloutTraceCapture | undefined {
  if (plan.acpAgent !== "codex") return undefined;
  const enabled =
    deps.enabled ?? enabledFromEnvironment(deps.processEnv ?? process.env);
  if (!enabled) return undefined;

  const captureId = (deps.captureId ?? randomUUID)();
  if (!/^[A-Za-z0-9._-]+$/.test(captureId)) {
    throw new Error("Codex rollout capture id contains unsafe path characters");
  }
  const sourceRoot = plan.isDaytona
    ? `/home/sandbox/agenta/codex-rollout-traces/${captureId}`
    : join(
        (deps.tmpDir ?? tmpdir)(),
        "agenta",
        "codex-rollout-traces",
        captureId,
      );

  // Daytona's provider is constructed from piExtEnv. The final runtime merge copies that map
  // into env as well, while a local daemon reads env directly.
  const destination = plan.isDaytona ? target.piExtEnv : target.env;
  destination[CODEX_ROLLOUT_TRACE_ROOT_ENV] = sourceRoot;

  return { captureId, sourceRoot, remote: plan.isDaytona };
}
