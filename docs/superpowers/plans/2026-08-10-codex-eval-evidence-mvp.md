# Codex Eval Evidence MVP Implementation Plan

> **For implementation:** Follow the repository `AGENTS.md`, use test-driven development for every behavior change, and complete each OpenSpec checkbox only after its verification command passes.

**Goal:** Make native Codex rollout bundles a trustworthy evidence source for observable Skill compliance and runtime bottleneck evaluation inside Agenta's runner, without changing the public `/run` wire contract.

**Architecture:** A Codex-only environment-scoped capture port injects `CODEX_ROLLOUT_TRACE_ROOT`, snapshots each native turn into an immutable attempt artifact, validates the native bundle through pure deterministic modules, and projects only a bounded summary into OTel. A lifecycle reducer provides explicit completeness/status and interval data; evaluation and retry policy operate only on validated evidence.

**Tech Stack:** TypeScript, Node 24, Vitest, sandbox-agent filesystem/process APIs, OpenTelemetry, OpenSpec.

---

## Task 1: Native Bundle Fixtures and Parser

**Files:**

- Create: `services/runner/tests/fixtures/codex-rollout-evidence/**`
- Create: `services/runner/tests/unit/codex-rollout-evidence.test.ts`
- Create: `services/runner/src/engines/sandbox_agent/codex-rollout-schema.ts`
- Create: `services/runner/src/engines/sandbox_agent/codex-rollout-reader.ts`

1. Write fixtures and failing tests for the v1 manifest, contiguous `seq`, newline-complete JSONL, identity agreement, recursive payload refs, missing/malformed payloads, traversal, symlink escape, unknown types, and size limits.
2. Run `pnpm exec vitest run tests/unit/codex-rollout-evidence.test.ts` and confirm the tests fail because the modules do not exist.
3. Implement the smallest bounded reader/parser with stable validation codes and no raw-content logging.
4. Re-run the focused test until green, then run `pnpm run typecheck`.

## Task 2: Lifecycle Completeness and Canonical Summary

**Files:**

- Modify: `services/runner/tests/unit/codex-rollout-evidence.test.ts`
- Create: `services/runner/src/engines/sandbox_agent/codex-rollout-lifecycle.ts`
- Create: `services/runner/src/engines/sandbox_agent/codex-evidence-summary.ts`

1. Add failing tests for `turn_complete`, `rollout_complete`, root/turn identity, attempt watermarks, open runtime warnings, canonical ordering, and stable SHA-256 digests.
2. Confirm RED with the focused Vitest command.
3. Implement the lifecycle reducer and `codex-evidence/v1` summary using canonical JSON that excludes local paths and capture time from its digest.
4. Confirm GREEN and typecheck.

## Task 3: Status, Skill Assertions, and Retry Policy

**Files:**

- Create: `services/runner/tests/unit/codex-skill-evaluation.test.ts`
- Create: `services/runner/src/evaluation/codex-skill-evaluation.ts`
- Create: `services/runner/src/evaluation/evaluation-status.ts`

1. Add failing table tests covering `PASSED`, `BEHAVIOR_FAILED`, `INVALID_TRACE`, `INFRA_RETRYING`, `RETRY_EXHAUSTED`, `CANCELLED`, and `B_UNSCORED`.
2. Add evidence-locator and retry allowlist tests proving missing evidence cannot become a behavior failure and behavior failures do not auto-retry.
3. Confirm RED, implement the pure state machine/assertion format, then confirm GREEN and typecheck.

## Task 4: Interval and Critical-Path Analyzer

**Files:**

- Create: `services/runner/tests/unit/codex-runtime-latency.test.ts`
- Create: `services/runner/src/evaluation/runtime-latency.ts`

1. Add failing tests for interval union, summed work, clock regression, overlap, causal parentage, parallel child work, stable tie-breaking, and unattributed time.
2. Confirm RED, implement normalized interval extraction and deterministic critical-path ranking, then confirm GREEN.
3. Verify output terminology uses provider sampling/wait and never hidden reasoning time.

## Task 5: Environment-Scoped Capture Port

**Files:**

- Modify: `services/runner/src/engines/sandbox_agent/runtime-contracts.ts`
- Modify: `services/runner/src/environment/runtime-lifecycle.ts`
- Modify: `services/runner/src/engines/sandbox_agent/environment-setup.ts`
- Create: `services/runner/src/engines/sandbox_agent/codex-rollout-evidence.ts`
- Modify: `services/runner/tests/unit/environment-units.test.ts`

1. Add failing tests for Codex-only local/Daytona injection, isolated ephemeral roots, environment freeze ordering, and non-Codex no-op behavior.
2. Confirm RED.
3. Add an injected `CodexRolloutEvidencePort` and `EvidenceSink`; configure a source root before daemon startup without changing `CODEX_HOME`, SQLite home, durable cwd, or user workspace.
4. Confirm GREEN and typecheck.

## Task 6: Turn and Teardown Integration

**Files:**

- Modify: `services/runner/src/engines/sandbox_agent/run-turn.ts`
- Modify: `services/runner/src/engines/sandbox_agent/environment.ts`
- Modify: `services/runner/tests/unit/session-keepalive-engine.test.ts`
- Modify: `services/runner/tests/unit/session-keepalive-approval.test.ts`
- Modify: `services/runner/tests/unit/sandbox-agent-orchestration.test.ts`

1. Add failing tests for begin-before-prompt, successful settle, pause preservation, resume settle-once, cancel/error partial capture, preserve-before-validate, and never-throw collector behavior.
2. Add teardown-order tests that place final sweep after harness shutdown and before sandbox stop/delete.
3. Confirm RED, integrate the port, and keep evidence failures out of `AgentRunResult.ok` and the session coordinator's cold-retry decision.
4. Confirm focused tests GREEN and typecheck.

## Task 7: Bounded OTel Projection

**Files:**

- Modify: `services/runner/src/tracing/otel.ts`
- Modify: `services/runner/src/engines/sandbox_agent/run-turn.ts`
- Modify: `services/runner/tests/unit/otel.test.ts` or the existing sandbox-agent OTel test file selected by repository conventions

1. Add failing tests for `ag.meta.eval.*` status, completeness, digest, counts, reason codes, and opaque artifact reference.
2. Add explicit negative assertions for prompts, response text, tool arguments/results, and raw payload bytes.
3. Implement `recordCodexEvidence` before `finish()`, confirm one-shot/stream parity, and keep the public protocol unchanged.

## Task 8: Live Gate, Verification, and Review

**Files:**

- Create: `services/runner/tests/integration/codex-rollout-evidence.live.test.ts`
- Modify: runner configuration documentation selected during implementation
- Modify: `openspec/changes/codex-eval-evidence-mvp/tasks.md`

1. Add an explicit environment-gated live test using the installed Codex binary and native `codex debug trace-reduce`.
2. Run focused tests with bundled Node 24:
   `PATH=/Users/wangbaoheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH pnpm exec vitest run <focused files>`.
3. Run `pnpm run typecheck`.
4. Run the full `pnpm test`; compare against the pre-change baseline of 121 files passed, 3 files failed, 2093 tests passed, and 19 tests failed in workspace import, commit authorization, and sandbox ACP interaction tests.
5. Run `openspec validate codex-eval-evidence-mvp --json`.
6. Complete spec review, code-quality review, inspect the final diff, and append the project requirement record without reading historical requirement logs.
