# Automatic Curation Scope Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagents for this repository.

**Goal:** Prevent a stale Automatic Capture candidate from failing the whole scan after the user changes the target Skill/Dataset, while preserving real missing-Rubric failures and clearing obsolete configuration errors.

**Architecture:** Persist every eligible candidate as Raw Case first, then revalidate it against the latest explicit target routes immediately before Automatic Curation. Add a narrow error-reset lifecycle to the private state store and call it only for Automatic Capture configuration changes or for the exact legacy route error when all current targets are valid.

**Tech Stack:** Node.js CommonJS, Electron IPC, `node:test`, DSH/Core shared service, esbuild-generated DSH bundles.

---

### Task 1: Reproduce the stale-target failure and define safe routing

**Files:**

- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`

- [x] **Step 1: Write the failing integration test**

Add a test that starts with a `systematic-debugging` target, switches `settings.autoCaptureProfile.targets` to a valid `billing-cost-management` target from inside the outcome analysis, and returns a high-confidence systematic-debugging result. Assert:

```js
assert.equal(await value.manager.runDueScan(), true)
assert.equal(value.candidates.length, 1)
assert.equal(created.length, 0)
assert.equal(value.stateStore.read().lastError, null)
assert.ok(value.stateStore.read().lastSuccessAt)
assert.equal(value.stateStore.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId, "thread-1-user-2")
```

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
cd desktop/rolling-skill
node --test test/automatic-capture.test.cjs
```

Expected: the new test fails because `createAutomaticCuration()` throws the published-Rubric route error and `runDueScan()` returns `false`.

- [x] **Step 3: Add latest-target scope revalidation**

In `automatic-capture.cjs`, use a focused helper equivalent to:

```js
function explicitTargetAcceptsSkill(skill, datasets, targets) {
    return arrays(targets).some((target) => arrays(datasets).some((dataset) => (
        target?.datasetId === dataset.id &&
        target?.skillId === dataset.skillReference?.id &&
        sameAutomaticSkill(dataset.skillReference, skill)
    )))
}
```

In `createAutomaticCuration()`, after reading the latest profile and datasets, return `null` when explicit targets exist but none accepts the candidate Skill. Only then call `automaticDatasetFor()`. Keep the existing error when an accepted Dataset lacks `activeRubricVersionId`.

- [x] **Step 4: Verify GREEN and the real missing-Rubric guard**

Run the same test file. Expected: the race regression passes and the existing missing-Rubric test still passes.

### Task 2: Give obsolete errors a narrow lifecycle

**Files:**

- Modify: `desktop/rolling-skill/test/automatic-capture-state-store.test.cjs`
- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `desktop/rolling-skill/src/automatic-capture-state-store.cjs`
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`

- [x] **Step 1: Write failing state and startup-cleanup tests**

Add a state-store test that records an error, commits a thread cursor, invokes `clearError()` twice, and asserts only `lastError` changes:

```js
store.clearError()
store.clearError()
assert.equal(store.read().lastError, null)
assert.equal(store.read().lastScheduledSlot, slot)
assert.equal(store.thread("codex:/opt/codex-a", "thread-1").lastInspectedUserItemId, "user-1")
```

Add manager tests asserting `clearObsoleteRouteError()` clears only the exact legacy Dataset/Rubric route error when every current explicit target exists, has the matching Skill binding, and has `activeRubricVersionId`. It must retain unrelated errors and retain the route error when a target still lacks a Rubric.

- [x] **Step 2: Run the tests and verify RED**

Run:

```bash
cd desktop/rolling-skill
node --test test/automatic-capture-state-store.test.cjs test/automatic-capture.test.cjs
```

Expected: failures report missing `clearError()` and `clearObsoleteRouteError()`.

- [x] **Step 3: Implement minimal error lifecycle methods**

Add an idempotent store method:

```js
clearError() {
    const state = this.load()
    if (state.lastError === null) return this.read()
    state.lastError = null
    this.persist()
    return this.read()
}
```

Add `configurationChanged()` to clear the stored error and reschedule. Add async `clearObsoleteRouteError()` that compares the exact old route-error message, validates all current explicit targets through `listDatasets()`, clears only when they are ready, and emits the refreshed status.

- [x] **Step 4: Verify GREEN**

Re-run both test files and confirm every test passes.

### Task 3: Wire App and shared DSH service configuration changes

**Files:**

- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `packages/rolling-skill-core/test/automatic-capture-service.test.cjs`
- Modify: `packages/rolling-skill-core/src/automatic-capture-service.cjs`

- [x] **Step 1: Write failing wiring tests**

In the main bridge test, require `settings:update` to distinguish Automatic Capture fields from unrelated fields, invoke `configurationChanged()` only for the former, and await `clearObsoleteRouteError()` before manager startup.

In the shared service test, replace the expected `reschedule` call after `update()` with `configurationChanged`, and require host startup to request obsolete-route cleanup without blocking startup.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
cd desktop/rolling-skill
node --test test/main-bridge.test.cjs
cd ../..
node --test packages/rolling-skill-core/test/automatic-capture-service.test.cjs
```

Expected: assertions fail because the new lifecycle methods are not wired.

- [x] **Step 3: Implement narrow setting detection and startup cleanup**

In `main.cjs`, define the supported Automatic Capture input keys:

```js
const AUTOMATIC_CAPTURE_SETTING_KEYS = new Set([
    "autoCapture", "autoCaptureMode", "autoCaptureCadence", "autoCaptureTime",
    "autoCaptureWeekday", "autoCaptureModelId", "autoCaptureEffort",
    "autoCaptureDatasetId", "autoCaptureTargets",
])
```

After `store.updateSettings()`, call `configurationChanged()` only when an input owns one of these keys; otherwise retain ordinary `reschedule()`. During app initialization, await obsolete-route cleanup before `start()`.

In the Core service, call `configurationChanged()` after successful Automatic Capture updates and request `clearObsoleteRouteError()` when starting the host schedule.

- [x] **Step 4: Verify focused tests GREEN**

Run all four focused test files and confirm exit code 0.

### Task 4: Build, regress, install, and verify the actual App

**Files:**

- Regenerate: `packages/rolling-skill-dsh/lib/rolling-skill-tool`
- Regenerate: `packages/rolling-skill-dsh/lib/index.js`
- Regenerate: `packages/rolling-skill-dsh/lib/worker.cjs`
- Modify: `desktop/rolling-skill/src/conversation-discovery.cjs`
- Modify: `desktop/rolling-skill/test/conversation-discovery.test.cjs`
- Update: `docs/superpowers/plans/2026-09-05-automatic-curation-scope-race.md`

- [x] **Step 0: Harden the optional final-response locator exposed by the real rerun**

Add a RED regression for a model-produced `finalAssistantItemId` that is not present in the frozen Episode. Normalize only this optional, untrusted locator to `null` so the caller falls back to the trusted Episode end boundary, and make the prompt require exact ID copying. Keep every required outcome field and Skill route validation strict.

- [x] **Step 1: Run complete verification**

Run:

```bash
cd desktop/rolling-skill && npm test && npm run smoke:renderer && npm run build:tool
cd ../.. && npm run test:dsh && npm run build:dsh
git diff --check
```

Expected: all tests and builds exit 0, and generated DSH bundles contain the fixed logic.

- [x] **Step 2: Package, sign, and install**

Run the existing macOS packaging workflow without hardened runtime, replace `/Applications/Rolling Skill.app` recoverably, verify `codesign --deep --strict`, and launch the installed App.

- [x] **Step 3: Verify the user-visible regression**

Confirm the installed App no longer displays the obsolete Dataset/Rubric error for the currently valid `billing-test` target. Confirm its Dataset binding and published Rubric remain unchanged.

- [x] **Step 4: Commit and push**

Stage only the source, tests, generated DSH bundles, design, and plan. Reject the staging set if any `.tgz` is present. Commit to `main`, push `rolling-skill/main`, append the final project record without reading the existing requirement log, and push the record repository.
