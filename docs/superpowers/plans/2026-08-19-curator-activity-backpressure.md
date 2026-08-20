# Curator Activity Backpressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Curator and Rubric live-activity IPC/DOM update frequency without hiding meaningful state changes.

**Architecture:** A shared main-process coalescer immediately forwards distinct states and batches repeated identical activity. The renderer reuses its keyed stream queue to merge residual activity-card patches.

**Tech Stack:** Node.js CommonJS, Electron IPC/renderer JavaScript, `node:test`, Electron renderer smoke tests.

---

### Task 1: Shared activity coalescer

**Files:**
- Create: `desktop/rolling-skill/src/live-activity-coalescer.cjs`
- Create: `desktop/rolling-skill/test/live-activity-coalescer.test.cjs`

- [ ] Write failing tests proving repeated identical activity schedules one trailing emission, changed stages emit immediately, and terminal activity cancels pending work and emits immediately.
- [ ] Run `node --test test/live-activity-coalescer.test.cjs` and verify it fails because the module is missing.
- [ ] Implement the minimal keyed coalescer with injected timer and clock functions.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Curator and Rubric integration

**Files:**
- Modify: `desktop/rolling-skill/src/curation-manager.cjs`
- Modify: `desktop/rolling-skill/src/rubric-manager.cjs`
- Modify: `desktop/rolling-skill/test/curation-manager.test.cjs`
- Modify: `desktop/rolling-skill/test/rubric-manager.test.cjs`

- [ ] Add failing integration tests that send 100 identical reasoning activities and assert one scheduled trailing update instead of 100 immediate callbacks.
- [ ] Route both managers' activity callbacks through the shared coalescer while retaining their in-memory latest activity.
- [ ] Verify command/tool transitions and terminal states remain immediate.

### Task 3: Renderer fallback and release verification

**Files:**
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`

- [ ] Add a failing renderer smoke assertion that a burst of Curator/Rubric activity IPC produces bounded card mutations and retains the final summary.
- [ ] Queue non-terminal activity-card patches and immediately flush terminal activity.
- [ ] Run focused tests, `npm test`, `npm run smoke:renderer`, and `git diff --check`.
- [ ] Build, sign, verify, and launch the updated macOS App.

