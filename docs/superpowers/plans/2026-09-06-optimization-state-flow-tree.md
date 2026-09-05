# Optimization State Flow Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure automatic optimization always opens its exact unified evaluation record and show the durable optimization state machine as a user-readable progress tree.

**Architecture:** Keep the optimization store as the source of truth. Publish exact evaluation Run IDs from optimization artifacts through the bounded public contract, derive a pure flow-tree view model from the public Run, and render that model in the existing right-side optimization summary. The tree uses completed, active, failed, and pending states; evaluation nodes navigate through the existing entity-selection callback.

**Tech Stack:** Electron, CommonJS JavaScript, Zod public contracts, DOM/CSS renderer, Node.js test runner.

---

## Design

The user-facing backbone is: prepare → baseline evaluation → one group per created/current Epoch → final approval → publish/install improved version or restore original version → finish. Each Epoch expands into edit Skill → install candidate → complete evaluation → review and decide. Completed nodes use a blue check, the live node uses green, an interrupted or failed node uses red, and unreached nodes use gray.

The UI never guesses an evaluation identity from the optimization Run ID. Baseline and live evaluation nodes use checkpoint evaluation IDs; completed Epoch nodes use evaluation IDs recovered from the bounded optimization-evaluation artifact body. Old stored optimization Runs therefore gain correct links without a migration.

### Task 1: Publish exact optimization evaluation identities

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-runner.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Test: `desktop/rolling-skill/test/optimization-runner.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-control-contracts.test.cjs`

- [x] **Step 1: Write failing tests for exact evaluation IDs**

Add assertions that an `optimization-evaluation` artifact stores `metadata.evaluationId`, that `publicEpoch` returns `evaluationRunIds` parsed from artifact bodies, and that the public output contract accepts only a bounded array of identifiers.

- [x] **Step 2: Run the focused tests and confirm RED**

Run: `node --test test/optimization-runner.test.cjs test/optimization-control-service.test.cjs test/optimization-control-contracts.test.cjs`

Expected: failures showing missing `metadata.evaluationId` and `evaluationRunIds`.

- [x] **Step 3: Implement the bounded identity path**

When the runner writes an optimization evaluation artifact, include:

```js
{
    runId: control.runId,
    evaluationId: evaluation.id,
    epoch,
    kind,
}
```

In `publicEpoch`, read at most the existing bounded artifact list, keep only non-empty `artifact.id` values, deduplicate them, and expose them as `evaluationRunIds`. Extend `publicOptimizationEpoch` with `evaluationRunIds: z.array(id).max(512).optional()`.

- [x] **Step 4: Run the focused tests and confirm GREEN**

Run: `node --test test/optimization-runner.test.cjs test/optimization-control-service.test.cjs test/optimization-control-contracts.test.cjs`

Expected: all selected tests pass.

### Task 2: Derive the state-machine flow tree

**Files:**
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`

- [x] **Step 1: Write failing view-model tests**

Add tests for a live candidate evaluation, a baseline interruption in `needs_recovery`, and a successful final installation. Assert node order, child order, status values (`completed`, `active`, `failed`, `pending`), and exact evaluation IDs.

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/operator-workbench.test.cjs`

Expected: failure because `optimizationFlowTreeView` is not exported.

- [x] **Step 3: Implement `optimizationFlowTreeView(run)`**

Create a pure function returning fixed backbone nodes plus bounded Epoch nodes. Derive progress from durable evidence (`state`, `checkpoint`, candidate/install/evaluation/decision IDs, Epoch status) rather than transcript text. If a nonterminal stage is interrupted, mark the earliest unfinished current node `failed`; leave all later nodes `pending`. Attach `{kind: "evaluation", id}` only when an exact evaluation Run ID exists.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/operator-workbench.test.cjs`

Expected: all operator workbench tests pass.

### Task 3: Render and navigate the flow tree

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`

- [x] **Step 1: Add failing renderer assertions**

Require the optimization panel to contain the flow-tree mount, render completed/active/failed/pending nodes, and dispatch an exact evaluation entity selection when an evaluation node is clicked. Add a regression assertion that `artifactDeepLinks` does not treat an optimization Run ID as an evaluation Run ID.

- [x] **Step 2: Run focused DOM and smoke checks and confirm RED**

Run: `node --test test/operator-workbench.test.cjs`

Run: `npm run smoke:renderer`

Expected: missing flow-tree DOM/status/link assertions fail.

- [x] **Step 3: Implement accessible tree rendering**

Insert `#operator-optimization-flow` before the latest-result card. Render nested lists with `aria-label`, visible state icons, concise Chinese/English labels, and a small “查看本次评测” action only for exact evaluation links. Use CSS custom colors already present in the app: blue/check for complete, green/pulse for active, red/error for failed, muted gray for pending. Keep UUIDs and artifact details out of the default view.

- [x] **Step 4: Fix generic artifact deep links**

Use `metadata.evaluationId` for optimization evaluation artifacts and retain `metadata.runId` fallback only for ordinary evaluation artifacts where it is the evaluation identity. Pass evaluation origin metadata through the existing `onSelectEntity` path without changing the evaluation selection behavior.

- [x] **Step 5: Run focused tests and smoke checks and confirm GREEN**

Run: `node --test test/operator-workbench.test.cjs`

Run: `npm run smoke:renderer`

Expected: all checks pass with zero renderer errors.

### Task 4: Full verification, package, install, and inspect

**Files:**
- Update: `docs/superpowers/plans/2026-09-06-optimization-state-flow-tree.md`

- [x] **Step 1: Run the desktop and core suites**

Run: `npm test` in `desktop/rolling-skill`

Run: the repository Core/DSH test command documented in project memory.

Expected: all tests pass.

- [x] **Step 2: Run static and build checks**

Run: `git diff --check`

Run: `npm run build:tool`

Run: `npm run pack:mac`

Expected: no whitespace errors; tool and macOS app build successfully.

- [x] **Step 3: Install and sign the app**

Replace `/Applications/Rolling Skill.app` with the newly packaged app using the repository's established recoverable backup procedure, then sign with:

```bash
codesign --force --deep --sign 'Rolling Skill Local Development' '/Applications/Rolling Skill.app'
```

Expected: `codesign --verify --deep --strict '/Applications/Rolling Skill.app'` succeeds.

- [x] **Step 4: Inspect the real installed UI**

Open the latest automatic optimization. Confirm its interrupted baseline is red, future steps are gray, a running fixture is green in renderer smoke, and clicking an evaluation node opens the exact unified scoring Run rather than an old legacy record.

- [x] **Step 5: Commit and push only intended files**

Stage the source, tests, and this plan explicitly. Confirm no `rolling-skill-dsh-plugin-*.tgz` is staged. Commit and push `main` to `rolling-skill`.
