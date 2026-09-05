# Manual Curation Managed Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Electron manual Case curation derive its Skill exclusively from the selected Dataset's managed Skill and start reliably through the centrally verified Runtime installation.

**Architecture:** Add a pure desktop resolver that converts a pathless managed Dataset Skill into a frozen Runtime execution reference and operation evidence using the managed registry, Released version, and installation journal. Wire manual/automatic curation and Dataset mutation IPC to managed identities, then update the Renderer to use managed Skill selectors and explicit submission feedback.

**Tech Stack:** Electron IPC, CommonJS, browser JavaScript, Node test runner, Electron renderer smoke tests.

---

### Task 1: Resolve managed Dataset Skills to verified Runtime installations

**Files:**
- Create: `desktop/rolling-skill/src/managed-curation-operation.cjs`
- Create: `desktop/rolling-skill/test/managed-curation-operation.test.cjs`

- [ ] **Step 1: Write the failing resolver tests**

Add tests with pathless managed Dataset fixtures proving that `resolveManagedCurationOperation()` returns an `executionSkillReference.path` ending in `SKILL.md` and matching `operationEvidence`. Add separate tests for no Released version, no current Runtime installation, digest mismatch, and Dataset/catalog identity mismatch.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `cd desktop/rolling-skill && node --test test/managed-curation-operation.test.cjs`

Expected: FAIL because `managed-curation-operation.cjs` does not exist.

- [ ] **Step 3: Implement the minimal resolver**

Implement:

```js
function managedDatasetSkillReference(binding, {managedSkillStore})
function resolveManagedCurationOperation({
    dataset,
    runtime,
    managedSkillStore,
    installationStore,
    requireRubric = true,
})
```

The first function returns a canonical pathless managed reference from `repositoryId` and `skillId`. The resolver validates the Dataset identity, active Rubric, valid Released version, current Runtime/provider installation, commit/digest equality and absolute destination before returning the Runtime `SKILL.md` reference and immutable operation evidence.

- [ ] **Step 4: Run the resolver tests and verify GREEN**

Run: `cd desktop/rolling-skill && node --test test/managed-curation-operation.test.cjs`

Expected: all resolver tests pass.

### Task 2: Wire Electron IPC and every App curation entry to the managed resolver

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing bridge assertions**

Require `datasets:create` and `datasets:bind-skill` to call `managedDatasetSkillReference()` with IDs rather than `currentRuntimeSkillReference()`. Require manual curation and Raw Case Draft creation to pass `executionSkillReference` and `operationEvidence`. Require Automatic Capture to receive an adapter whose `createSession()` resolves the same evidence before delegating.

- [ ] **Step 2: Run the focused bridge test and verify RED**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs --test-name-pattern='managed Dataset Skill|curation Skills'`

Expected: FAIL on the old Runtime-path handlers and missing curation operation wiring.

- [ ] **Step 3: Wire the managed resolver**

Import the new module, add a helper bound to the active Runtime descriptor and stores, and use it in:

- `curation:create`;
- `createCurationFromRawCase()`;
- the Automatic Capture `curationManager.createSession()` adapter;
- Dataset create/bind IPC.

Keep Dataset storage pathless and place the concrete Runtime path only in each Curation Session's execution evidence.

- [ ] **Step 4: Run the focused bridge and curation tests**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs test/curation-manager.test.cjs test/automatic-capture.test.cjs`

Expected: all focused tests pass.

### Task 3: Make Dataset selection auto-display its managed Skill and provide immediate submit feedback

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing Renderer contract tests**

Assert that the manual curation dialog no longer contains `change-case-dataset-skill`, that new Dataset and binding actions use managed Skill IDs, and that curation submission sets a localized busy label and `aria-busy` state.

- [ ] **Step 2: Run the Renderer contract tests and verify RED**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/main-bridge.test.cjs`

Expected: FAIL because the dialog and handlers still use Runtime Skill selection.

- [ ] **Step 3: Implement managed selectors and automatic display**

Add managed Skill selection helpers backed by `state.managedSkills.skills`, including repository labels for duplicate names. Use them in both Dataset creation forms and the Dataset binding dialog. Make the selected Dataset's managed Skill a read-only curation preflight display and remove the per-curation change button.

- [ ] **Step 4: Implement explicit start feedback and localized blockers**

When submission begins, set the button text to `startingCuration`, disable repeat/close/cancel actions, and set `aria-busy=true`. Restore the computed preflight state after completion. Map known managed Skill/Rubric/installation errors to localized messages and keep the alert scrolled into view.

- [ ] **Step 5: Run focused Renderer tests and verify GREEN**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/main-bridge.test.cjs`

Expected: all focused tests pass.

### Task 4: Verify the packaged App from the user's workflow

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `docs/superpowers/plans/2026-09-05-manual-curation-managed-skill.md`

- [ ] **Step 1: Add a failing renderer smoke scenario**

Make the smoke fixture expose at least two managed Skills and Datasets. Assert that selecting each Dataset changes the read-only managed Skill display, managed selectors exclude unrelated Runtime-only Skills, and clicking “Start curation” immediately enters busy state.

- [ ] **Step 2: Run smoke and verify RED, then update fixture wiring**

Run: `cd desktop/rolling-skill && npm run smoke:renderer`

Expected: the new assertions fail before fixture/Renderer completion, then pass after the minimal fixture changes.

- [ ] **Step 3: Run complete automated verification**

Run:

```bash
cd desktop/rolling-skill && npm test
cd desktop/rolling-skill && npm run smoke:renderer
cd ../.. && npm run test:dsh
git diff --check
```

Expected: zero failures and no Renderer errors.

- [ ] **Step 4: Build, install, and replay the real workflow**

Build with `bash desktop/rolling-skill/scripts/build-macos-app.sh`, replace `/Applications/Rolling Skill.app` while preserving a timestamped backup, verify the signature, launch it, open a message's “沉淀 Case” form, select `billing-skill-cases`, and click “开始沉淀”. Confirm the form shows `billing-cost-management`, the button shows busy feedback, and a Curator Session/Turn is created without the absolute-path error.

- [ ] **Step 5: Commit and push without package archives**

Explicitly stage only source, tests, generated plans, and any generated DSH bundles that actually changed. Verify no staged path ends in `.tgz`, commit to `main`, push `rolling-skill/main`, and append the final project record without reading its requirement log.
