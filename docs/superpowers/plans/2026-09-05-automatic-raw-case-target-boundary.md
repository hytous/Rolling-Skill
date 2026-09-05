# Automatic Raw Case Target Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not use subagents for this repository. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Automatic Capture can persist Raw Cases only for the currently selected managed Skill targets.

**Architecture:** Fail closed before scanning when no explicit routes exist, pass only route-resolved Skills to the classifier, and revalidate the chosen Skill against the latest profile immediately before persistence. Keep the existing pre-Curation revalidation as defense in depth.

**Tech Stack:** Node.js CommonJS, Electron, `node:test`, shared DSH/Core service.

---

### Task 1: Lock the corrected Raw Case boundary with failing tests

**Files:**

- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `desktop/rolling-skill/test/conversation-discovery.test.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [x] **Step 1: Reverse the stale-target regression expectation**

Rename the existing stale-target test to state that an obsolete candidate is discarded before Raw Case persistence. Keep the mid-analysis target switch, then assert `candidates.length === 0` and `created.length === 0`.

- [x] **Step 2: Add the empty-target fail-closed regression**

Create a fixture with `targets: []`, instrument Runtime list/read and analysis calls, run one slot, and assert rejection with a target-selection error before any thread read, model analysis, or Raw Case write.

- [x] **Step 3: Add prompt policy coverage**

Assert the Outcome prompt says the supplied Skill list is the complete user-selected managed target set and that an episode resembling an unlisted local/system Skill must be ineligible rather than assigned to that Skill.

- [x] **Step 4: Run focused tests and verify RED**

Add a main-process helper regression where Runtime inventory reports the installed `SKILL.md` path and the central installation store resolves that exact Runtime/name/path to a managed Skill. Assert the cached Runtime Skill uses the managed ID instead of a `local-skill-*` ID.

Run:

```bash
cd desktop/rolling-skill
node --test test/automatic-capture.test.cjs test/conversation-discovery.test.cjs test/main-bridge.test.cjs
```

Expected: stale-target test finds one persisted candidate, empty-target test observes scanning, and the prompt lacks the new target policy.

### Task 2: Enforce target scope before analysis and persistence

**Files:**

- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`
- Modify: `desktop/rolling-skill/src/conversation-discovery.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`

- [x] **Step 1: Reject empty and unresolved target scopes before scanning threads**

Require non-empty `profile.targets` in `runSlot()`. Resolve every target through exact `datasetId` and managed `skillReference.id`; reject missing routes and ambiguous selected Skill names before `listAllThreads()`.

- [x] **Step 2: Revalidate immediately before Raw Case persistence**

Add a focused helper that reads the current profile and Dataset inventory and accepts a candidate only when mode is still enabled, targets are non-empty, and `explicitTargetAcceptsSkill()` succeeds. In `classifySegment()`, call it after outcome validation and before evidence/Raw Case writes; return `{irrelevant: true, skipReason: "stale_target_scope"}` on mismatch.

- [x] **Step 3: Clarify the classifier contract**

Update `buildOutcomePrompt()` to say that `enabledSkills` is the complete current user-selected managed target set. Include the bounded Runtime Skill description, require a counterfactual domain check against `originalQuestion`, and explicitly forbid inferring or returning any other local, system, or merely mentioned Skill.

- [x] **Step 4: Resolve installed Runtime copies through the central journal**

Before assigning a `local-skill-*` identity, call the existing `SkillInstallationStore.resolveManagedInstallationForLegacyReference()` with the exact Runtime ID, provider, Skill name, and reported path. Use its managed Skill ID only on a unique verified match; retain fail-closed behavior for conflicts and fall back to current local identity behavior when no verified installation exists.

- [x] **Step 5: Keep valid same-Skill Dataset changes working**

Add or update a test where the target Dataset changes during analysis but both old and new Datasets bind the same managed Skill ID. Assert one Raw Case and one Curation Session routed to the current Dataset.

- [x] **Step 6: Run focused tests and verify GREEN**

Run the same three test files and require exit code 0.

- [x] **Step 7: Recover one malformed Boundary response**

When a completed model call returns a Boundary result with invalid or unknown Item IDs, retry once with the fixed parser error and exact allowed IDs. Do not retry Runtime transport failures or loop indefinitely.

### Task 3: Regression, packaging, and delivery

**Files:**

- Regenerate: `packages/rolling-skill-dsh/lib/rolling-skill-tool`
- Regenerate: `packages/rolling-skill-dsh/lib/index.js`
- Regenerate: `packages/rolling-skill-dsh/lib/worker.cjs`
- Update: `docs/superpowers/plans/2026-09-05-automatic-raw-case-target-boundary.md`

- [x] **Step 1: Run full verification**

Run:

```bash
cd desktop/rolling-skill && npm test && npm run smoke:renderer && npm run build:tool
cd ../.. && npm run test:dsh && npm run build:dsh
git diff --check
```

Expected: all tests and builds exit 0.

- [x] **Step 2: Package and verify the installed App**

Run `bash desktop/rolling-skill/scripts/build-macos-app.sh`, replace `/Applications/Rolling Skill.app` recoverably, verify `codesign --deep --strict`, launch it, and confirm the process stays running.

- [x] **Step 3: Verify the user-visible flow**

With the configured `billing-cost-management -> billing-test` target, run Automatic Capture and confirm the classifier receives only the selected Skill. Confirm an unrelated real conversation cannot create a new Raw Case and no obsolete route error appears.

- [x] **Step 4: Commit and push**

Stage only scoped source, tests, generated DSH bundles, spec, and plan. Assert no `rolling-skill-dsh-plugin-*.tgz` is staged. Commit to `main`, push `rolling-skill/main`, append the project record without reading its requirement log, and push the record repository.
