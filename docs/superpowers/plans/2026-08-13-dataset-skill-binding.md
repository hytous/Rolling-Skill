# Dataset-level Skill Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind exactly one runtime Skill to each dataset and make Case capture, Curator, Automatic Capture, and evaluation inherit it without independent Skill selection.

**Architecture:** `LocalEvaluationStore` owns the invariant and migrates legacy references into datasets. Electron IPC resolves only dataset bindings; renderer controls create or repair the binding but never supplies a per-operation Skill. Existing Case and evaluation snapshots remain immutable provenance.

**Tech Stack:** Electron, CommonJS Node.js, vanilla JavaScript renderer, Node test runner.

---

### Task 1: Store schema and migration

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Test: `desktop/rolling-skill/test/local-store.test.cjs`

- [x] Add failing tests proving new datasets require a normalized Skill, unique legacy references migrate, and conflicting legacy references remain unbound.
- [x] Run the focused store tests and confirm failures are caused by missing dataset binding behavior.
- [x] Bump the local schema, add deterministic migration, `getDataset`, `createDataset({name, skillReference})`, and `bindDatasetSkill`.
- [x] Make curation creation copy the dataset binding and reject unbound datasets.
- [x] Make evaluation creation validate its evidence against the dataset binding and reject conflicting input.
- [x] Re-run focused tests to green.

### Task 2: Main-process and manager boundaries

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/src/curation-manager.cjs`
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`
- Test: `desktop/rolling-skill/test/curation-manager.test.cjs`
- Test: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [x] Add failing tests showing callers cannot select a per-curation or per-evaluation Skill.
- [x] Derive Skill references from the dataset in the main process and Curator manager.
- [x] Add dataset binding IPC and remove automatic-capture Skill profile fields.
- [x] Include actionable evidence snapshot warnings in launch failures.
- [x] Re-run the focused manager and bridge tests to green.

### Task 3: Dataset binding UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Test: `desktop/rolling-skill/scripts/smoke-renderer.mjs`

- [x] Add renderer smoke assertions that Case capture and launch contain no operation-level Skill selector.
- [x] Require name plus Skill when creating a dataset from either entry point.
- [x] Display the selected dataset binding and offer dataset-level bind/change controls.
- [x] Disable capture and launch for unbound, missing, or stale bindings with actionable status.
- [x] Ensure Curator and evaluation requests send only the dataset id for Skill resolution.
- [x] Run renderer smoke tests to green.

### Task 4: Regression verification and packaging

**Files:**
- Modify: `README.md`
- Modify: `desktop/rolling-skill/README.md`

- [x] Document dataset-level binding, migration, and immutable historical evidence.
- [x] Run the complete desktop test suite and renderer smoke suite.
- [x] Build and sign `Rolling Skill.app` using `desktop/rolling-skill/scripts/build-macos-app.sh`.
- [x] Verify the signature and packaged files, restart the app, and confirm the local store migrated without losing Cases.
- [ ] Commit and push `main` to the Rolling Skill remote.
