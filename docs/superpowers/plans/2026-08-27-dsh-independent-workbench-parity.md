# DSH Independent Workbench Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Rolling Skill out of the DSH Settings page into an independent additive workbench and close every DSH-owned gap in the 136-ID parity ledger before packaging and installing the plugin.

**Architecture:** The plugin retains Shared Core Stores/Managers and the strict JSON dispatch boundary. A `sidebar.footer.action` launcher owns an overlay workbench with focused React state/navigation modules; Settings keeps only defaults, import, data-root, and diagnostics. Missing Curation/Rubric and operational flows call narrow Host-owned methods, never direct browser Store access.

**Tech Stack:** TypeScript/React, Cordis/DSH slots and primitives, Shared Rolling Skill Core, Node.js CommonJS, `node:test`, npm workspaces, local DSH web install.

---

## Task 1: Make the parity ledger executable

**Files:**
- Create: `packages/rolling-skill-core/src/surface-parity-manifest.cjs`
- Create: `packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`
- Modify: `docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md`

- [ ] **Step 1: Write a failing exact-name inventory test**

Parse the Electron Renderer actions, Preload methods, Main handlers, Core dispatch methods, DSH methods, and test names into normalized exact-name sets. Assert every extracted name maps to one of the 136 ledger IDs and every ID carries owner, implementation evidence, automated evidence, and UI evidence fields.

```js
assert.deepEqual(actual.electronPreloadNames, expected.electronPreloadNames);
assert.equal(report.ledgerIds.length, 136);
assert.deepEqual(report.unmappedSourceNames, []);
assert.deepEqual(report.idsWithoutEvidence, []);
```

- [ ] **Step 2: Run the test and confirm RED**

Run: `node --test packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`

Expected: FAIL because no machine-readable manifest exists.

- [ ] **Step 3: Add the manifest and drift report**

Represent each ID with its family, both surface owners, approved differences, and exact evidence references. Keep the human ledger as the readable authority and assert its ID set matches the manifest.

- [ ] **Step 4: Seed existing evidence without claiming missing work**

Map current implementations/tests only where they already exist. Mark incomplete DSH evidence as a failing gap, not as a completed placeholder. The test remains RED until later tasks close all DSH-assigned gaps.

- [ ] **Step 5: Commit the parity foundation**

```bash
git add packages/rolling-skill-core/src/surface-parity-manifest.cjs packages/rolling-skill-core/test/surface-parity-manifest.test.cjs docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md
git commit -m "test: enforce rolling skill surface parity"
```

## Task 2: Move the full workbench out of Settings

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/WorkbenchLauncher.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/WorkbenchOverlay.tsx`
- Create: `packages/rolling-skill-dsh/src/client/settings/RollingSkillSettings.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/index.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/styles/workbench.css`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing slot-ownership tests**

Assert the Client registers one additive `sidebar.footer.action` launcher and a slim `settings.section`, while the full `Workbench` is not mounted inside Settings. Assert no replace-risk shell slots are registered.

- [ ] **Step 2: Run the Client test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because the full workbench is still mounted in Settings.

- [ ] **Step 3: Add the sidebar launcher and overlay shell**

```tsx
ctx.slots.add({
  slot: "sidebar.footer.action",
  key: "rolling-skill-workbench",
  component: WorkbenchLauncher,
});
```

The overlay must keep native conversation state mounted, restore the last Rolling Skill page, support deep links such as a Curation Session ID, close via Escape/backdrop/button, trap focus, and fit wide/narrow layouts.

- [ ] **Step 4: Slim Settings to plugin administration**

Keep Runtime defaults, locale, legacy import, data-root, diagnostics, and uninstall/help links. Remove business workflows from Settings without deleting their components or state.

- [ ] **Step 5: Split workbench navigation state**

Replace the single large tab switch with typed route objects covering Overview, Inbox/Drafts, Datasets, Cases, Raw Cases, Rubrics, Skills, Installations, Evaluations, Automatic Capture, Operator, Optimization, Import, and Diagnostics.

```ts
type WorkbenchRoute =
  | { page: "overview" }
  | { page: "curation"; sessionId?: string }
  | { page: "dataset"; datasetId?: string; section?: "cases" | "rubric" }
  | { page: "evaluation"; runId?: string };
```

- [ ] **Step 6: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: PASS for launcher/settings/shell contracts.

```bash
git add packages/rolling-skill-dsh/src/client packages/rolling-skill-dsh/test/client-source.test.cjs
git commit -m "feat: add independent DSH rolling skill workbench"
```

## Task 3: Expose complete strict Curation and Rubric methods

**Files:**
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/host-api.test.cjs`

- [ ] **Step 1: Write failing method-contract tests**

Cover Curation list/get/create/send/retry/model/effort/save/discard/archive/hidden and Rubric list/get/create/send/retry/model/effort/publish/discard/hidden. Assert mutating methods are serialized and stale revisions fail.

```js
await app.dispatch("curation.send", { sessionId, text, expectedRevision, idempotencyKey });
await app.dispatch("rubrics.publish", { sessionId, expectedRevision, idempotencyKey });
await assert.rejects(
  app.dispatch("curation.send", { sessionId, text, expectedRevision: 1 }),
  /stale revision/,
);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs`

Expected: FAIL for currently unexposed manager operations.

- [ ] **Step 3: Add narrow dispatch methods**

Validate exact input keys and stable IDs, look up records on Host, pass expected revisions/idempotency keys to managers, and return serializable projections. Do not expose Store objects, Runtime paths, arbitrary transcripts, or executable command fields.

- [ ] **Step 4: Cover cancellation and hidden activity**

List active and hidden Runtime threads separately, distinguish Client polling abort from a requested Job cancellation, and retain last-valid Draft output after a failed retry.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs desktop/rolling-skill/test/curation-manager.test.cjs desktop/rolling-skill/test/rubric-manager.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core/src/application.cjs packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs
git commit -m "feat: expose DSH curation and rubric workflows"
```

## Task 4: Implement Inbox, Draft review, and Case finalization

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/CurationPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/CurationSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/styles/workbench.css`
- Create: `packages/rolling-skill-dsh/test/curation-client.test.cjs`

- [ ] **Step 1: Write failing Curation client contracts**

Assert active/archived lists, frozen evidence, curator activity, message send, retry, model/effort selection, last-valid Draft, Good/Bad/note editing, save to Case, discard, and deep-link navigation are all represented and call exact Core methods.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/curation-client.test.cjs`

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement list and review states**

Render explicit loading, empty, active, failed, retrying, archived, saved, and discarded states. Show frozen source Session/range/digest and observed Skill evidence read-only. Poll only a visible active Session and abort polling on route change.

- [ ] **Step 4: Implement save/discard semantics**

Save requires a valid Draft, unchanged evidence revision, managed Dataset identity, and chosen label. On success, navigate to the created Case and refresh native conversation markers. Discard requires confirmation and removes only the Curation Session projection.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/curation-client.test.cjs packages/rolling-skill-core/test/application.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench/CurationPanel.tsx packages/rolling-skill-dsh/src/client/workbench/CurationSessionView.tsx packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx packages/rolling-skill-dsh/src/client/styles/workbench.css packages/rolling-skill-dsh/test/curation-client.test.cjs
git commit -m "feat: review DSH curation drafts"
```

## Task 5: Implement Dataset Rubric creation, review, and publishing

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/RubricPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/RubricSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Create: `packages/rolling-skill-dsh/test/rubric-client.test.cjs`

- [ ] **Step 1: Write failing Rubric client contracts**

Assert Dataset active/history display, create with selected Runtime/model/effort, Agent conversation, retry, last-valid Rubric Draft, publish, discard, archived sessions, legacy migration notice, and post-publish calibration entry.

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/rubric-client.test.cjs`

Expected: FAIL because DSH has no Rubric workflow UI.

- [ ] **Step 3: Implement Rubric lifecycle UI**

Keep generated Draft separate from active published Rubric. Publish must present the pending version and expected revision, preserve history, and surface stale Dataset/Case evidence as an actionable blocker.

- [ ] **Step 4: Add legacy and calibration recovery**

Show path-bound legacy Dataset state without silently rewriting ambiguous identity. After publish, offer evaluation/calibration against a Released Skill version and per-target trustworthy Installation status.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/rubric-client.test.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/rubric-manager.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench/RubricPanel.tsx packages/rolling-skill-dsh/src/client/workbench/RubricSessionView.tsx packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx packages/rolling-skill-dsh/test/rubric-client.test.cjs
git commit -m "feat: manage rubrics in DSH workbench"
```

## Task 6: Close Dataset, Case, and Raw Case lifecycle gaps

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`
- Create: `packages/rolling-skill-dsh/test/case-lifecycle-client.test.cjs`

- [ ] **Step 1: Turn ledger gaps into failing tests**

Cover managed-Skill bind/rebind/unbound migration, Dataset recycle/delete guards, Case refresh/recycle/delete/batch, Raw Case inspect/dispatch/retry/remove, provenance display, active Rubric guard, pagination/filtering, and explicit destructive confirmation.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/case-lifecycle-client.test.cjs packages/rolling-skill-core/test/application.test.cjs`

Expected: FAIL for the ledger-assigned missing flows.

- [ ] **Step 3: Add missing strict Core methods**

Expose only the Manager operations required by the ledger. Resolve managed identity on Host and keep observed Runtime path/Installation data on Case evidence, never on Dataset identity.

- [ ] **Step 4: Complete the three panels**

Use shared confirmation/error/loading components and refresh affected lists after mutation. Batch operations must report per-item success/failure and remain safe to retry through idempotency keys.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/case-lifecycle-client.test.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench packages/rolling-skill-dsh/test/case-lifecycle-client.test.cjs packages/rolling-skill-core/src/application.cjs packages/rolling-skill-core/test/application.test.cjs
git commit -m "feat: complete DSH case lifecycles"
```

## Task 7: Close Managed Skill, Version, and Installation gaps

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/InstallationPanel.tsx`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`
- Create: `packages/rolling-skill-dsh/test/managed-skill-client.test.cjs`

- [ ] **Step 1: Write failing managed-lifecycle tests**

Cover repository/Skill/version detail, Released-only selection, install/reinstall/remove, Runtime questions/permissions, Job progress, exact commit/digest/destination evidence, drift detection, and recovery from failed/ambiguous installation.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/managed-skill-client.test.cjs packages/rolling-skill-core/test/application.test.cjs`

Expected: FAIL for unrepresented managed lifecycle operations.

- [ ] **Step 3: Complete Host methods and UI**

Dataset selection uses `{repositoryId, skillId}` only. Release/install/evaluate operations select a Version and Host-resolved trustworthy Installation, then freeze that operation evidence. The browser never supplies destination, path, provider, commit, digest, or Job result.

- [ ] **Step 4: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/managed-skill-client.test.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/skill-installation-store.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench packages/rolling-skill-dsh/test/managed-skill-client.test.cjs packages/rolling-skill-core/src/application.cjs packages/rolling-skill-core/test/application.test.cjs
git commit -m "feat: complete DSH managed skill lifecycles"
```

## Task 8: Close Evaluation and Automatic Capture gaps

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/AutomaticCapturePanel.tsx`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-dsh/test/evaluation-client.test.cjs`
- Create: `packages/rolling-skill-dsh/test/automatic-capture-client.test.cjs`

- [ ] **Step 1: Write failing lifecycle tests**

Evaluation coverage must include Released version selection, independent per-Runtime installation readiness, run create/detail/progress/cancel/retry, per-Case scores, artifacts, aggregate summary, and stale-evidence blockers. Automatic coverage must include rule schedule/filter/preview/run/history/error/retry/enable-disable/delete.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/evaluation-client.test.cjs packages/rolling-skill-dsh/test/automatic-capture-client.test.cjs`

Expected: FAIL for missing detail and recovery states.

- [ ] **Step 3: Implement exact operation states**

Poll only visible active Jobs, abort on route change, keep server cancellation separate, and show target-specific frozen Version/Installation evidence. Automatic previews must be read-only and scheduled mutations must use expected revisions.

- [ ] **Step 4: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/evaluation-client.test.cjs packages/rolling-skill-dsh/test/automatic-capture-client.test.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/evaluation-runner.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench packages/rolling-skill-dsh/test/evaluation-client.test.cjs packages/rolling-skill-dsh/test/automatic-capture-client.test.cjs packages/rolling-skill-core/src/application.cjs
git commit -m "feat: complete DSH evaluation automation"
```

## Task 9: Close Operator and Optimization control-plane gaps

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-dsh/test/operator-client.test.cjs`
- Create: `packages/rolling-skill-dsh/test/optimization-client.test.cjs`

- [ ] **Step 1: Write failing control-plane tests**

Cover Operator request/question/permission/approval/artifact/cancel/retry/history and Optimization create/preflight/progress/candidate/baseline/evaluation/promotion/recovery/cancel/delete. Include stale Dataset/Rubric/Version/Installation blockers and destructive confirmations.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/operator-client.test.cjs packages/rolling-skill-dsh/test/optimization-client.test.cjs`

Expected: FAIL for incomplete control-plane states.

- [ ] **Step 3: Implement missing methods and views**

Keep permission/approval decisions Host-validated, render artifacts as inert links/data, and freeze Candidate/Baseline execution evidence per target Runtime. Failed steps must retain previous valid output and offer a ledger-defined recovery action.

- [ ] **Step 4: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/operator-client.test.cjs packages/rolling-skill-dsh/test/optimization-client.test.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/optimization-control-plane.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/workbench packages/rolling-skill-dsh/test/operator-client.test.cjs packages/rolling-skill-dsh/test/optimization-client.test.cjs packages/rolling-skill-core/src/application.cjs
git commit -m "feat: complete DSH control plane"
```

## Task 10: Close parity evidence and distribution contracts

**Files:**
- Modify: `packages/rolling-skill-core/src/surface-parity-manifest.cjs`
- Modify: `packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`
- Modify: `packages/rolling-skill-dsh/scripts/inspect-package.mjs`
- Modify: `packages/rolling-skill-dsh/test/distribution-contract.test.cjs`
- Modify: `docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md`

- [ ] **Step 1: Backfill exact evidence references**

For every DSH-assigned ID, record the exact component/method, automated test name, and real-UI check. For approved platform differences, record the DSH-native replacement and why it preserves the business behavior.

- [ ] **Step 2: Run parity test and eliminate every gap**

Run: `node --test packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`

Expected: PASS with exactly 136 IDs, exact source name sets, zero unmapped names, and zero missing evidence fields.

- [ ] **Step 3: Report package size instead of enforcing an arbitrary cap**

Extend package inspection output with packed bytes, unpacked bytes, and file count while retaining prohibited-content checks:

```js
return { name, version, files, fileCount: files.length, packedBytes, unpackedBytes };
```

Reject Electron/Chromium binaries, credentials, absolute paths, source maps, product data, and undeclared files; do not reject legitimate plugin code merely for exceeding 2 MB.

- [ ] **Step 4: Run package contract tests**

Run: `node --test packages/rolling-skill-dsh/test/distribution-contract.test.cjs`

Expected: PASS and print the distribution size report.

- [ ] **Step 5: Commit parity closure**

```bash
git add packages/rolling-skill-core/src/surface-parity-manifest.cjs packages/rolling-skill-core/test/surface-parity-manifest.test.cjs packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/test/distribution-contract.test.cjs docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md
git commit -m "test: close DSH surface parity"
```

## Task 11: Build, force-install, and inspect the real DSH plugin

- [ ] **Step 1: Run focused and complete automated verification**

```bash
npm run test:dsh
npm test --prefix desktop/rolling-skill
npm run build:dsh
git diff --check
```

Expected: all tests/builds PASS, parity reports zero gaps, and no whitespace errors.

- [ ] **Step 2: Inspect the exact tarball**

Run the DSH package inspection script against the newly generated tarball. Record name/version, checksum, file list, packed/unpacked bytes, and prohibited-content result.

- [ ] **Step 3: Preserve the installed rollback**

Resolve the currently installed Rolling Skill plugin metadata and tarball/profile path with read-only commands. Copy the existing artifact and metadata to a timestamped recoverable location outside the product data root before forcing installation.

- [ ] **Step 4: Install the exact new tarball and restart DSH**

Use the repository's documented DSH installation command and the resolved local web profile. Confirm the installed manifest/version/checksum matches the built tarball; restart only the DSH process serving `http://127.0.0.1:3080/`.

- [ ] **Step 5: Verify the native conversation loop in the real browser**

Open an existing Session, confirm the finalized Assistant action appears, create a Draft from a selected Human boundary, verify warning/yellow source range, open that Draft in the workbench, save it, verify success/green range, reload, and verify persistence. Exercise discard/delete and compatibility fallback once.

- [ ] **Step 6: Verify every workbench family in the real browser**

Check launcher/close/deep link, slim Settings, Inbox/Drafts, Dataset/Case/Raw Case, Rubric, Managed Skill/Installation, Evaluation, Automatic Capture, Operator, Optimization, Import, and Diagnostics. Record UI evidence beside every ledger ID; do not infer completion from a tab label.

- [ ] **Step 7: Commit and push verified `main`**

Run: `git status --short`

Expected: only intended tracked changes plus the untouched untracked `openspec/config.yaml`.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh docs/superpowers/specs docs/superpowers/plans openspec/changes/dsh-workbench-curation-parity
git commit -m "feat: complete DSH rolling skill workbench"
git push origin main
```

Do not add `openspec/config.yaml`, DSH product data, frozen trace snapshots, installed profile files, or generated credentials.
