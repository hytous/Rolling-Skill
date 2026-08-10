import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, it } from "vitest";

import { readCodexRolloutBundle } from "../../src/engines/sandbox_agent/codex-rollout-reader.ts";
import { reduceCodexRolloutLifecycle } from "../../src/engines/sandbox_agent/codex-rollout-lifecycle.ts";

const enabled = process.env.AGENTA_CODEX_EVIDENCE_LIVE_TEST === "1";
const liveIt = enabled ? it : it.skip;
const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

liveIt(
  "captures and reduces a complete native Codex rollout bundle",
  async () => {
    const binary =
      process.env.AGENTA_CODEX_EVIDENCE_LIVE_BINARY?.trim() || "codex";
    const capability = spawnSync(binary, ["debug", "trace-reduce", "--help"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(
      capability.status,
      0,
      "the selected Codex binary must support `debug trace-reduce`",
    );

    const traceRoot = temporaryRoot("agenta-codex-live-trace-");
    const worktree = temporaryRoot("agenta-codex-live-worktree-");
    const result = spawnSync(
      binary,
      [
        "exec",
        "--skip-git-repo-check",
        "--ignore-rules",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "Reply with exactly OK.",
      ],
      {
        cwd: worktree,
        env: {
          ...process.env,
          CODEX_ROLLOUT_TRACE_ROOT: traceRoot,
        },
        encoding: "utf8",
        timeout: 180_000,
      },
    );
    assert.equal(result.status, 0, "live Codex execution failed");

    const bundleDirectories = readdirSync(traceRoot, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("trace-"))
      .map((entry) => join(traceRoot, entry.name));
    assert.equal(bundleDirectories.length, 1, "expected one root rollout bundle");
    const bundleDirectory = bundleDirectories[0]!;
    const bundle = await readCodexRolloutBundle(bundleDirectory);
    assert.equal(bundle.ok, true, "native bundle failed bounded validation");
    if (!bundle.ok) return;
    const lifecycle = reduceCodexRolloutLifecycle(bundle);
    assert.equal(lifecycle.completeness, "rollout_complete");
    assert.ok(lifecycle.targetTurnTerminalSeq);
    assert.ok(lifecycle.rootTerminalSeq);

    const statePath = join(temporaryRoot("agenta-codex-live-reduced-"), "state.json");
    const reduced = spawnSync(
      binary,
      ["debug", "trace-reduce", bundleDirectory, "--output", statePath],
      { encoding: "utf8", timeout: 30_000 },
    );
    assert.equal(reduced.status, 0, "native trace reducer rejected the bundle");
    assert.equal(existsSync(statePath), true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(typeof state, "object");
    assert.ok(state);
  },
  240_000,
);
