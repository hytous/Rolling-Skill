import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";

import {
  CODEX_ROLLOUT_TRACE_ROOT_ENV,
  prepareCodexRolloutTrace,
} from "../../src/engines/sandbox_agent/codex-rollout-capture.ts";

const runtimeLifecycleSource = () =>
  readFileSync(
    fileURLToPath(
      new URL("../../src/environment/runtime-lifecycle.ts", import.meta.url),
    ),
    "utf-8",
  );

describe("Codex rollout capture preparation", () => {
  it("is disabled by default", () => {
    const env: Record<string, string> = {};
    const piExtEnv: Record<string, string> = {};

    const capture = prepareCodexRolloutTrace(
      { acpAgent: "codex", isDaytona: false },
      { env, piExtEnv },
      { processEnv: {}, captureId: () => "capture-1", tmpDir: () => "/tmp" },
    );

    assert.equal(capture, undefined);
    assert.equal(env[CODEX_ROLLOUT_TRACE_ROOT_ENV], undefined);
  });

  it("injects an isolated local root only for Codex", () => {
    const env: Record<string, string> = {
      CODEX_HOME: "/workspace/.codex",
      CODEX_SQLITE_HOME: "/tmp/sqlite",
    };
    const piExtEnv: Record<string, string> = {};

    const capture = prepareCodexRolloutTrace(
      { acpAgent: "codex", isDaytona: false },
      { env, piExtEnv },
      {
        enabled: true,
        captureId: () => "capture-1",
        tmpDir: () => "/private/tmp",
      },
    );

    assert.deepEqual(capture, {
      captureId: "capture-1",
      sourceRoot: "/private/tmp/agenta/codex-rollout-traces/capture-1",
      remote: false,
    });
    assert.equal(
      env[CODEX_ROLLOUT_TRACE_ROOT_ENV],
      capture?.sourceRoot,
    );
    assert.equal(piExtEnv[CODEX_ROLLOUT_TRACE_ROOT_ENV], undefined);
    assert.equal(env.CODEX_HOME, "/workspace/.codex");
    assert.equal(env.CODEX_SQLITE_HOME, "/tmp/sqlite");
  });

  it("injects the Daytona root into the environment map used by the provider", () => {
    const env: Record<string, string> = {};
    const piExtEnv: Record<string, string> = {};

    const capture = prepareCodexRolloutTrace(
      { acpAgent: "codex", isDaytona: true },
      { env, piExtEnv },
      { enabled: true, captureId: () => "capture-2" },
    );

    assert.deepEqual(capture, {
      captureId: "capture-2",
      sourceRoot: "/home/sandbox/agenta/codex-rollout-traces/capture-2",
      remote: true,
    });
    assert.equal(env[CODEX_ROLLOUT_TRACE_ROOT_ENV], undefined);
    assert.equal(
      piExtEnv[CODEX_ROLLOUT_TRACE_ROOT_ENV],
      capture?.sourceRoot,
    );
  });

  it("never injects the variable for non-Codex harnesses", () => {
    for (const acpAgent of ["pi", "claude"] as const) {
      const env: Record<string, string> = {};
      const piExtEnv: Record<string, string> = {};
      const capture = prepareCodexRolloutTrace(
        { acpAgent, isDaytona: false },
        { env, piExtEnv },
        { enabled: true, captureId: () => "capture-3" },
      );

      assert.equal(capture, undefined);
      assert.equal(env[CODEX_ROLLOUT_TRACE_ROOT_ENV], undefined);
      assert.equal(piExtEnv[CODEX_ROLLOUT_TRACE_ROOT_ENV], undefined);
    }
  });

  it("runtime lifecycle prepares capture before its final environment merge", () => {
    const source = runtimeLifecycleSource();
    const prepare = source.indexOf("const codexRolloutTrace =");
    const merge = source.lastIndexOf("Object.assign(env, piExtEnv)");
    const returned = source.indexOf("codexRolloutTrace");

    assert.ok(prepare > 0, "runtime lifecycle must prepare Codex capture");
    assert.ok(merge > prepare, "capture injection must precede the final env merge");
    assert.ok(returned > 0, "the environment must retain the capture handle");
  });
});
