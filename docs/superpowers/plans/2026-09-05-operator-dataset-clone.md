# Operator Dataset Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Operator able to create managed datasets and atomically copy a published rubric plus selected Cases from a scoped source dataset.

**Architecture:** Store managed Skill identity independently of Runtime installation paths. Add a `datasets.clone` control method whose domain resolver freezes the source dataset, selected Cases, active rubric, and managed identity before one local-store mutation persists the complete clone.

**Tech Stack:** Electron, Node.js CommonJS, Zod control contracts, `node:test`, local JSON persistence.

---

### Task 1: Define failing store behavior

**Files:**
- Modify: `desktop/rolling-skill/test/dataset-rubric-store.test.cjs`
- Modify: `desktop/rolling-skill/src/local-store.cjs`

- [x] **Step 1: Write a failing test for atomic Dataset cloning**

Create a source dataset with a managed Skill reference, publish a rubric, save several rich Cases, and assert `cloneDataset({sourceDatasetId, name, caseIds})` creates new IDs, copies only the selected Cases, maps the active rubric to a new version, and preserves curated content.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop/rolling-skill/test/dataset-rubric-store.test.cjs`

Expected: FAIL because `store.cloneDataset` does not exist.

- [x] **Step 3: Implement the minimal atomic store method**

Add `cloneDataset` beside `createDataset`. Validate unique Case IDs and source ownership before mutating state, build the target dataset/rubric/Cases in memory, append them, then persist once.

- [x] **Step 4: Add failure-path tests**

Assert duplicate IDs, foreign Case IDs, and missing source objects throw without changing the store.

- [x] **Step 5: Run focused tests and verify GREEN**

Run: `node --test desktop/rolling-skill/test/dataset-rubric-store.test.cjs`

Expected: all local-store tests pass.

### Task 2: Correct managed Dataset creation

**Files:**
- Modify: `desktop/rolling-skill/test/control-plane-domain-services.test.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/domain-services.cjs`

- [x] **Step 1: Write a failing Domain Service test**

Assert `datasets.create` stores an `evidencePrecision: "managed"` identity with null deployment fields and succeeds without calling `resolveManagedSkillBinding`.

- [x] **Step 2: Run the test and verify RED**

Run: `node --test desktop/rolling-skill/test/control-plane-domain-services.test.cjs --test-name-pattern='managed Dataset'`

Expected: FAIL because the service currently resolves and validates the managed source path against Runtime inventory.

- [x] **Step 3: Replace deployment binding with stable managed identity**

Build the Dataset Skill reference from the trusted managed Skill catalog entry. Keep Runtime deployment-path discovery out of Dataset creation.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same command and expect PASS.

### Task 3: Add the scoped `datasets.clone` control operation

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/policy.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/domain-services.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-contracts.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-policy.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-domain-services.test.cjs`

- [x] **Step 1: Write failing contract and policy tests**

Require a unique 1..100 `caseIds` list, expose the method to Operator with action `datasets.write`, and require resolved source Dataset, Skill, and repository scopes without approval.

- [x] **Step 2: Run focused tests and verify RED**

Run: `node --test desktop/rolling-skill/test/control-plane-contracts.test.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs`

Expected: FAIL because `datasets.clone` is unknown.

- [x] **Step 3: Add contract, scope, projection, and handler**

Resolve the source dataset and selected Cases, derive its managed Skill/repository identity, freeze them in the execution snapshot, and call `evaluationStore.cloneDataset`. Return only public Dataset/Case summaries plus `rubricCopied`.

- [x] **Step 4: Add and run Domain Service tests**

Verify success, cross-dataset Case rejection, out-of-scope rejection, and that the store receives the frozen source selection.

- [x] **Step 5: Run all three focused suites and verify GREEN**

Run the contract, policy, and domain-service test files together; expect all pass.

### Task 4: Make tool intent unambiguous

**Files:**
- Modify: `desktop/rolling-skill/src/operator/operator-tool-transport.cjs`
- Modify: `desktop/rolling-skill/test/operator-tool-transport.test.cjs`

- [x] **Step 1: Write a failing tool-description test**

Assert the Codex dynamic tools describe `datasets_create` as creating an empty dataset and `datasets_clone` as atomically copying selected Cases and the active rubric.

- [x] **Step 2: Run the focused test and verify RED**

Run: `node --test desktop/rolling-skill/test/operator-tool-transport.test.cjs`

Expected: FAIL because descriptions are currently generic.

- [x] **Step 3: Add method-specific descriptions**

Keep generic fallback wording for other methods and define concise descriptions for Dataset create/clone.

- [x] **Step 4: Run the focused test and verify GREEN**

Run the same command and expect PASS.

### Task 5: Verify, install, and replay the user journey

**Files:**
- Modify: `docs/superpowers/plans/2026-09-05-operator-dataset-clone.md`

- [x] **Step 1: Run Desktop and core regression suites**

Run the repository's Desktop full suite and core/DSH suite. Expect zero failures.

- [x] **Step 2: Run Renderer smoke and build verification**

Run the Electron renderer smoke, `git diff --check`, and the configured build command. Expect zero renderer errors and successful build.

- [x] **Step 3: Package, sign, and install the App**

Build the macOS app, sign with `Rolling Skill Local Development`, verify the signature, replace `/Applications/Rolling Skill.app` using a recoverable backup, and launch it.

- [x] **Step 4: Replay the exact Operator request**

Use the installed App's self-operation page to request `billing-test` from `billing-skill-cases` with exactly three Cases and identical scoring settings. Verify no approval is requested and no failed child Job is produced.

- [x] **Step 5: Inspect persisted outcome**

Confirm `billing-test` has exactly three new Case IDs, a distinct active rubric version with the same rubric digest/content, and the same managed Skill identity as the source.

- [x] **Step 6: Update this checklist, commit, and push**

Stage only the explicit source, test, and documentation files; verify no `.tgz` is staged; commit to `main` and push `rolling-skill/main`.
