# Rolling Skill Multi-Epoch Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the self-operation workbench run bounded, auditable multi-Epoch Skill optimization using a frozen Dataset/Rubric, isolated Git workspaces, real Candidate installations, cross-Runtime evaluation, safe restoration, explicit release approval and final regression testing.

**Architecture:** Add a deterministic `OptimizationRunner` above the Operator Job Engine. The runner owns the phase order and invariants; the Operator Agent supplies diagnosis, edits and a structured continue/finish/pause decision. Each Epoch commits an immutable Candidate from a linked experiment worktree, asks selected Runtime Agents to install and verify it under an experiment marker, evaluates the same frozen snapshot, computes deterministic deltas, then continues within hard limits or restores the initial Runtime state.

**Tech Stack:** Electron 43, Node.js CommonJS, Git CLI through the existing argument-array wrapper, existing managed Skill/version/install/evaluation subsystems, Zod 4, `node:test`, HTML/CSS/vanilla JavaScript.

---

## File map

Create:

- `desktop/rolling-skill/src/optimization/optimization-contract.cjs`: run configuration, frozen snapshot and Agent decision schemas.
- `desktop/rolling-skill/src/optimization/optimization-store.cjs`: durable Run/Epoch state and references to Job artifacts.
- `desktop/rolling-skill/src/optimization/optimization-workspace.cjs`: isolated Git worktree lifecycle and Candidate commit validation.
- `desktop/rolling-skill/src/optimization/optimization-analysis.cjs`: deterministic score/pass/regression comparisons and stop rules.
- `desktop/rolling-skill/src/optimization/optimization-runner.cjs`: baseline, Epoch, installation, evaluation, decision, release and restore state machine.
- `desktop/rolling-skill/src/optimization/optimization-report.cjs`: deterministic Chinese Markdown report.
- Matching `desktop/rolling-skill/test/optimization-*.test.cjs` tests.

Modify:

- `desktop/rolling-skill/src/managed-skill-git.cjs`, `managed-skill-manager.cjs`, `managed-skill-store.cjs`: experiment worktrees and optimization-created Candidates.
- `desktop/rolling-skill/src/skill-installation-protocol.cjs`, `skill-installation-store.cjs`, `skill-installation-manager.cjs`: Candidate experiment install, inspect, restore and removal.
- `desktop/rolling-skill/src/evaluation-skill-binding.cjs`, `evaluation-skill-evidence.cjs`, `local-store.cjs`, `evaluation-runner.cjs`: managed-version snapshots and expected digest checks.
- Operator control contracts, Job Engine, main/preload, workbench Renderer, tests, smoke and `README.md`.

### Task 1: Optimization contracts and frozen-run store

**Files:**
- Create: `desktop/rolling-skill/test/optimization-contract.test.cjs`
- Create: `desktop/rolling-skill/test/optimization-store.test.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-contract.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-store.cjs`

- [ ] **Step 1: Write failing configuration tests**

Validate fixed/adaptive modes, hard bounds, runtime uniqueness, frozen Dataset/Rubric revisions, baseline Released identity and decision schema:

```js
const config = parseOptimizationConfig({
    skillId: "skill-1",
    baselineVersionId: "release-1",
    datasetId: "dataset-1",
    operator: {runtimeId: "codex-1", modelId: "gpt", effort: "high"},
    targets: [{runtimeId: "codex-1", modelId: "gpt", effort: "high"}],
    mode: "adaptive",
    limits: {maxEpochs: 5, maxDurationMs: 7_200_000, patience: 2, minimumImprovement: 1},
    target: {minimumScore: 85, minimumPassRate: 0.9, requireCriticalCases: true},
})
assert.equal(config.limits.maxEpochs, 5)
assert.throws(() => parseOptimizationConfig({...config, limits: {...config.limits, maxEpochs: 101}}), /maxEpochs/u)
assert.equal(parseOptimizationDecision({schema: "rolling-skill-optimization-decision/v1", action: "continue", rationale: "仍有工具链缺口"}).action, "continue")
```

- [ ] **Step 2: Run RED**

Run `cd desktop/rolling-skill && node --test test/optimization-contract.test.cjs test/optimization-store.test.cjs` and expect missing-module failures.

- [ ] **Step 3: Implement immutable snapshots**

`freezeOptimizationRun()` stores copies and digests of:

```js
{
    baseline: {repositoryId, skillId, versionId, commit, skillRoot, contentDigest},
    dataset: {id, revision, caseRevisions, digest},
    rubric: {id, version, scoringModel, digest},
    operator,
    targets,
    judge,
    activationMode,
    limits,
    target,
    createdAt,
}
```

Reject a non-Released baseline, missing published Rubric, stale Case calibration, incomplete Skill evidence or a Dataset bound to a different Skill identity.

- [ ] **Step 4: Implement the Run/Epoch store**

Use schema `rolling-skill-optimization-runs/v1`. Run states are `preflight`, `baseline`, `editing`, `installing`, `evaluating`, `deciding`, `waiting_approval`, `restoring`, `succeeded`, `failed`, `cancelled`, `needs_recovery`. Epoch records are append-only after terminal evaluation and reference Candidate, installation Jobs, Evaluation run, analysis and Agent decision artifacts.

- [ ] **Step 5: Run GREEN and commit**

Run the focused tests and expect PASS. Commit with `feat: persist frozen optimization runs`.

### Task 2: Isolated optimization Git workspaces

**Files:**
- Create: `desktop/rolling-skill/test/optimization-workspace.test.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-workspace.cjs`
- Modify: `desktop/rolling-skill/src/managed-skill-git.cjs`
- Modify: `desktop/rolling-skill/src/managed-skill-manager.cjs`
- Modify: `desktop/rolling-skill/src/managed-skill-store.cjs`
- Modify: managed Skill tests.

- [ ] **Step 1: Write failing worktree tests**

Create a managed fixture repository and assert:

- workspace starts at the exact baseline commit;
- branch is `rolling-skill/optimization/<runId>`;
- path is under Application Support `optimization-workspaces/<runId>`;
- edits do not dirty the primary managed Working tree;
- Candidate commit is reachable from the optimization branch and records run/Epoch IDs;
- symlink/path escape and a Candidate from another worktree are rejected;
- cleanup removes only the registered worktree after Git confirms its identity.

- [ ] **Step 2: Run RED**

Run optimization workspace and managed Git tests; expect missing APIs.

- [ ] **Step 3: Add safe Git worktree primitives**

Add argument-array operations:

```js
git.createWorktree(repositoryPath, workspacePath, branchName, baselineCommit)
git.worktreeHead(workspacePath)
git.removeWorktree(repositoryPath, workspacePath)
git.isAncestor(repositoryPath, baselineCommit, candidateCommit)
```

Disable imported hooks and use the existing local Git identity. Never shell-concatenate a branch or path.

- [ ] **Step 4: Implement workspace registry and Candidate creation**

`OptimizationWorkspaceManager.create(run)` registers the resolved paths, baseline and branch before returning the workspace. `createCandidate({runId, epoch, message})` scans the Skill, commits all valid Skill roots, verifies the selected Skill digest changed, and calls `ManagedSkillStore.addVersion()` with:

```js
{state: "candidate", createdBy: "optimization", optimizationRunId: runId, optimizationEpoch: epoch}
```

It does not merge or reset the primary Working tree.

- [ ] **Step 5: Run GREEN and commit**

Run focused managed Skill/workspace tests and expect PASS. Commit with `feat: isolate optimization skill workspaces`.

### Task 3: Candidate experiment installation protocol

**Files:**
- Create: `desktop/rolling-skill/test/skill-experiment-installation.test.cjs`
- Modify: `desktop/rolling-skill/src/skill-installation-protocol.cjs`
- Modify: `desktop/rolling-skill/src/skill-installation-store.cjs`
- Modify: `desktop/rolling-skill/src/skill-installation-manager.cjs`
- Modify: installation tests.

- [ ] **Step 1: Write failing protocol tests**

Cover `experiment_install`, `experiment_restore`, `experiment_remove` and `experiment_inspect`. A valid request freezes run ID, Epoch, Candidate commit/digest, initial state and restoration source. Result schema is `rolling-skill-install-result/v2` and includes `purpose: "optimization-experiment"` plus experiment marker evidence.

- [ ] **Step 2: Run RED**

Run all installation protocol/store/manager tests and confirm experiment operations are rejected.

- [ ] **Step 3: Extend protocol without weakening ordinary installs**

Ordinary `install` continues to accept Released versions only and update the trusted installation matrix. Experiment install accepts an immutable Candidate only when called by `OptimizationRunner` with a matching frozen Run. The Runtime prompt writes:

```json
{
  "schema": "rolling-skill-experiment/v1",
  "runId": "run-id",
  "epoch": 2,
  "skillId": "skill-id",
  "versionId": "candidate-id",
  "commit": "full-sha",
  "contentDigest": "sha256:..."
}
```

Do not add experiment records to `installations`; store them in the installation Job history and OptimizationRun references.

- [ ] **Step 4: Enforce safe enrollment and rotation**

Before Epoch 1, each target must inspect as `absent` or `managed-clean` at the frozen baseline Released version. Drifted, unmanaged, conflicting and uncertain targets fail preflight. Later Candidate rotation requires the target to match the current Run marker and previous Candidate digest exactly.

- [ ] **Step 5: Implement restoration**

For a managed-clean baseline, export and reinstall the frozen Released source. For initial absent state, remove only the exact target carrying the current Run marker and expected Candidate digest. Inspect after restoration. Any mismatch returns `needs_recovery` and performs no delete/overwrite.

- [ ] **Step 6: Run GREEN and commit**

Run all installation and experiment tests and expect PASS. Commit with `feat: install candidate versions for optimization`.

### Task 4: Evaluation against a managed Candidate snapshot

**Files:**
- Create: `desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`
- Modify: `desktop/rolling-skill/src/evaluation-skill-binding.cjs`
- Modify: `desktop/rolling-skill/src/evaluation-skill-evidence.cjs`
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/src/evaluation-runner.cjs`
- Modify: evaluation tests.

- [ ] **Step 1: Write failing managed-version tests**

Start an internal Evaluation from a frozen Candidate version and assert:

- original user questions, Case revisions and Rubric version are unchanged;
- Judge Skill evidence is exported from the exact managed commit, not mutable Working or a Runtime path;
- every target stores expected Candidate digest and experiment installation Job ID;
- pre/post target verification checks that exact digest;
- a Runtime still exposing the previous Candidate becomes `SKILL_VERSION_CHANGED` and is not graded;
- point-in-time live billing values retain the existing historical-comparison semantics.

- [ ] **Step 2: Run RED**

Run the focused test plus evaluation binding/runner/store tests; expect missing managed snapshot fields.

- [ ] **Step 3: Add the internal managed-version start path**

`EvaluationService.start()` accepts `managedVersionSnapshot` only from an Optimization Job capability. Persist:

```js
{
    repositoryId, skillId, versionId, commit, skillRoot, contentDigest,
    installationJobIdsByRuntime,
}
```

Ordinary UI Evaluation continues deriving Skill from the Dataset binding and cannot supply these fields.

- [ ] **Step 4: Verify installed content**

Extend binding evidence with `expectedContentDigest`. Path-precise inventory may verify name/path/digest directly. Name-only providers require the existing unabridged Skill body digest evidence. A matching name alone remains insufficient for formal grading.

- [ ] **Step 5: Run GREEN and commit**

Run all evaluation tests and expect PASS. Commit with `feat: evaluate immutable candidate skill snapshots`.

### Task 5: Deterministic analysis and stopping rules

**Files:**
- Create: `desktop/rolling-skill/test/optimization-analysis.test.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-analysis.cjs`

- [ ] **Step 1: Write failing comparison tests**

Cover per-Case/per-Runtime deltas, missing score, Judge failure, critical failures, regression thresholds, pass rate, target reached, patience and fixed/adaptive maximum Epoch behavior:

```js
const analysis = compareEvaluationRuns({baseline, previous, current, target, limits, history})
assert.equal(analysis.scoreDelta, 6.5)
assert.deepEqual(analysis.regressions.map((entry) => entry.caseId), ["case-3"])
assert.equal(evaluateStopRules(analysis).reason, "continue")
```

- [ ] **Step 2: Run RED**

Run `node --test test/optimization-analysis.test.cjs` and expect a missing-module failure.

- [ ] **Step 3: Implement arithmetic without an Agent**

Compute weighted mean only from completed current unified scores; keep execution failures and grading failures as separate counts. Compare the exact same Case × Runtime keys. A missing current result is a regression, not an omitted denominator. Produce stable arrays for improved, unchanged, regressed, newly passed, newly failed and critical failures.

- [ ] **Step 4: Implement hard stop precedence**

Apply in order:

```text
cancel/recovery failure
hard budget exhausted
new critical failure or configured broad regression
target achieved
fixed maxEpochs reached
adaptive patience exhausted
Agent decision constrained by the above
```

The Agent can request `finish` or `pause`; it can request `continue` only when no hard rule stops the Run.

- [ ] **Step 5: Run GREEN and commit**

Run the focused test and expect PASS. Commit with `feat: compare optimization epochs deterministically`.

### Task 6: Multi-Epoch OptimizationRunner

**Files:**
- Create: `desktop/rolling-skill/test/optimization-runner.test.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-runner.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-protocol.cjs`
- Modify: Operator tests.

- [ ] **Step 1: Write a failing full-loop test with fakes**

Model this sequence:

```text
preflight -> baseline evaluation
Epoch 1 edit -> Candidate 1 -> install -> evaluation -> continue
Epoch 2 edit -> Candidate 2 -> install -> evaluation -> target achieved
release approval -> Released install -> final regression -> success
```

Assert baseline does not count as an Epoch, Dataset/Rubric snapshots remain byte-identical, Candidate 1 is not restored before Candidate 2, and no phase advances until all selected Runtime installation/evaluation children are terminal.

- [ ] **Step 2: Add failure-path tests**

Cover max Epoch, patience, timeout, Token telemetry exhaustion, user pause, user stop, Candidate install failure, evaluation failure, invalid Agent decision, release rejection, Released install failure, restoration success and restoration failure.

- [ ] **Step 3: Run RED**

Run `node --test test/optimization-runner.test.cjs` and expect a missing runner.

- [ ] **Step 4: Implement the engine-owned phase machine**

`OptimizationRunner` creates child Jobs through Job Engine. It wakes the Operator with bounded Artifact summaries at `editing` and `deciding`; the Agent never calls an unrestricted “advance phase” method. To finish an editing turn it calls `optimization.submit_candidate`; to finish a decision turn it calls `optimization.submit_decision` with the v1 schema.

- [ ] **Step 5: Implement bounded decision retries**

Invalid decision JSON returns the exact schema error once and allows one repair turn. A second invalid response pauses the Run. An Agent request to raise a limit creates a separate Approval; until approved, current limits remain effective and no new Epoch begins.

- [ ] **Step 6: Implement terminal release/restore behavior**

Release and formal install are separate approvals/actions. If both succeed, run one final regression against the Released installation and do not restore baseline. Otherwise restore every enrolled Runtime; mark the parent `cancelled`/`failed` only after successful restoration, or `needs_recovery` when any target remains uncertain.

- [ ] **Step 7: Run GREEN and commit**

Run runner, Job engine, installation and evaluation tests and expect PASS. Commit with `feat: run bounded multi epoch skill optimization`.

### Task 7: Reports, Tool API and main-process lifecycle

**Files:**
- Create: `desktop/rolling-skill/test/optimization-report.test.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-report.cjs`
- Modify: control-plane contracts/services/policy tests and sources.
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing report tests**

Generate Chinese Markdown and assert it includes frozen baseline, Runtime matrix, every Epoch Candidate/commit/Diff summary, per-Case deltas, improvements, regressions, stop reason, release/install/final regression and recovery state. Missing token/cost telemetry must be labeled “运行时未提供”，not zero.

- [ ] **Step 2: Implement deterministic reporting**

Render from stored artifacts and computed analysis; Agent prose is quoted only as “Agent 判断理由”. Store the report as an Artifact with SHA-256 and expose it from the Run.

- [ ] **Step 3: Add typed Tools**

Add:

```text
optimization.preflight
optimization.start
optimization.get
optimization.pause
optimization.resume
optimization.stop
optimization.submit_candidate
optimization.submit_decision
optimization.report
```

Only the Runner's current Operator session may submit Candidate/decision. `start` freezes configuration after preflight; later Dataset/Rubric changes do not mutate it.

- [ ] **Step 4: Wire lifecycle**

Initialize OptimizationStore/WorkspaceManager/Runner after Operator and installation/evaluation managers. App shutdown asks OptimizationRunner to checkpoint and stop scheduling, then Operator manager interrupts turns, then active child managers stop. On startup, recovery runs before a user can resume.

- [ ] **Step 5: Run GREEN and commit**

Run report, control-plane, bridge and runner tests. Commit with `feat: expose optimization lifecycle and reports`.

### Task 8: Multi-Epoch workbench UI and end-to-end verification

**Files:**
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: Renderer smoke files and `README.md`.

- [ ] **Step 1: Write failing configuration and state tests**

Require Skill/baseline/Dataset/target Runtime selection, fixed/adaptive mode, max Epoch, patience, score/pass targets, time/turn limits, telemetry-gated token/cost fields and experiment-install approval summary. Test Epoch timeline reducer and terminal restore states.

- [ ] **Step 2: Implement creation preflight**

Show Dataset/Rubric/Case revision, baseline digest, target installation classification, Tool transport and budget capability before Start. Disable Start on any incomplete Rubric/Case, unknown Skill binding, untrusted target state or unsupported hard budget.

- [ ] **Step 3: Implement the live Epoch panel**

The right panel displays baseline, current Epoch, Candidate, per-Runtime installation/evaluation states, score/pass trend, regressions, remaining hard budgets and approvals. Diff and result detail remain lazy Artifacts; hidden Runs update badges/snapshots only.

- [ ] **Step 4: Implement stop and recovery UX**

Stop text states that queued work will cancel and Runtime Skills will restore. While restoring, disable release/new Epoch actions. `needs_recovery` shows each target's last verified marker/digest and direct links to the installer inspect session.

- [ ] **Step 5: Extend Renderer smoke**

Simulate two Epochs, hidden background progress, release approval, final regression, stop during Candidate 2 and one restore failure. Assert no invisible stream triggers full-page rendering, the composer remains pinned, score trend is stable and recovery details survive task switching.

- [ ] **Step 6: Run full verification**

```bash
cd desktop/rolling-skill
npm test
npm run smoke:renderer
npm run build:tool
git diff --check
```

Expected: all tests pass, Renderer reports zero errors, Tool build succeeds and diff check is silent.

- [ ] **Step 7: Run optional real Runtime smoke with explicit budget**

Using a disposable fixture Skill and two tiny Cases, run one Epoch separately on each locally available provider. Do not use the production billing Dataset. Verify Codex dynamic tools, CodeBuddy MCP and DSH CLI fallback; verify stop restores the fixture Skill. Record unavailable providers as skipped with a reason.

- [ ] **Step 8: Commit**

Commit UI/smoke/docs changes with `feat: complete multi epoch optimization workbench`.
