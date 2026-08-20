# Chat Stream Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound live-chat rendering work and restore persisted tool activity at its original assistant-output boundary.

**Architecture:** A renderer-side queue coalesces dirty streaming items and calls a targeted DOM patcher. The main-process activity store adds optional assistant-message anchors and uses them when merging omitted runtime activity into history.

**Tech Stack:** Electron renderer JavaScript, Node.js CommonJS, `node:test`, Electron renderer smoke tests.

---

### Task 1: Coalesce streaming item renders

**Files:**
- Create: `desktop/rolling-skill/renderer/stream-render-queue.js`
- Create: `desktop/rolling-skill/test/stream-render-queue.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`

- [ ] Write a unit test proving repeated updates for one item schedule one flush and preserve distinct dirty item keys.
- [ ] Run `node --test test/stream-render-queue.test.cjs` and verify it fails because the queue module is missing.
- [ ] Implement the bounded queue with `enqueue`, `flushNow`, and `cancel`.
- [ ] Integrate streaming text/reasoning notifications with targeted item replacement and fallback conversation rendering.
- [ ] Re-run the unit test and verify it passes.

### Task 2: Preserve activity timeline anchors

**Files:**
- Modify: `desktop/rolling-skill/test/thread-activity-store.test.cjs`
- Modify: `desktop/rolling-skill/src/thread-activity-store.cjs`

- [ ] Add a failing test for `assistant A -> tool A -> assistant B -> tool B -> assistant C` history restoration.
- [ ] Run `node --test test/thread-activity-store.test.cjs` and verify the activity items incorrectly cluster before assistant C.
- [ ] Capture the latest assistant-message ID per runtime/thread/turn and persist it as the activity's first-seen anchor.
- [ ] Merge anchored missing activities after their anchor while retaining the legacy fallback for old records.
- [ ] Re-run the activity-store tests and verify they pass.

### Task 3: Renderer regression and release verification

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`

- [ ] Add a smoke assertion that repeated deltas keep the enclosing turn block mounted and produce complete output.
- [ ] Run `npm run smoke:renderer` and verify the assertion fails before integration, then passes after integration.
- [ ] Run `npm test`, `npm run smoke:renderer`, and `git diff --check`.
- [ ] Run `bash desktop/rolling-skill/scripts/build-macos-app.sh`, verify the final signature, stop only the old Rolling Skill process, and launch the newly signed app.

