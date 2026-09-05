# Automatic Capture Skill Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron App's single preferred Dataset selector with explicit multi-Skill automatic-capture routes.

**Architecture:** A small UMD renderer helper supplies deterministic route projection and validation. The existing Settings page renders one checkbox/select row per managed Skill and persists the route list through the already-supported `autoCaptureTargets` store field.

**Tech Stack:** Electron renderer JavaScript, HTML/CSS, Node.js built-in test runner.

---

### Task 1: Route view model

**Files:**
- Create: `desktop/rolling-skill/renderer/automatic-capture-targets.js`
- Create: `desktop/rolling-skill/test/automatic-capture-targets.test.cjs`

- [ ] Write tests that require valid managed Skills, preserve stale saved target rows, filter Datasets by managed Skill ID, disable missing-Rubric Datasets only in automatic mode, migrate a legacy Dataset route, and report invalid selected targets.
- [ ] Run `node --test test/automatic-capture-targets.test.cjs` from `desktop/rolling-skill` and confirm the missing module makes the test fail.
- [ ] Implement `candidateSkillRows`, `candidateDatasetOptions`, `initialCaptureTargets`, and `validateCaptureTargets` in a UMD helper export.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Electron Settings UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] Change the surface test to require a candidate-Skill fieldset, helper script loading, checkbox/select event wiring, and `autoCaptureTargets` persistence while rejecting the old preferred-Dataset control.
- [ ] Run `node --test test/local-first-surface.test.cjs` and confirm it fails on the old UI.
- [ ] Replace the old select with a rendered list, add bilingual copy, migrate the legacy setting during rendering, update visibility and validity state by mode, and save `autoCaptureDatasetId: null` plus selected `autoCaptureTargets`.
- [ ] Add compact styles matching existing Settings controls and DSH row layout.
- [ ] Re-run the focused surface and helper tests.

### Task 3: Verification and delivery

**Files:**
- Modify only if verification exposes a defect in the files above.

- [ ] Run `npm test` from `desktop/rolling-skill`.
- [ ] Run `npm run smoke:renderer` and `npm run build:tool`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated files or `.tgz` archives.
- [ ] Build the macOS App with `bash desktop/rolling-skill/scripts/build-macos-app.sh` and reinstall the generated App without adding package archives to Git.
- [ ] Commit and push the scoped source, tests, spec, and plan to `main`.

