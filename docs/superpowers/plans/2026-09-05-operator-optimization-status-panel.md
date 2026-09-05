# Operator Optimization Status Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This session uses inline execution because the user explicitly forbids subagents and explicitly authorizes direct work on `main`.

**Goal:** Replace the automatic Skill optimization sidebar's internal-data dump with a user-readable progress summary, while preserving audit data inside a collapsed technical-details section.

**Architecture:** Keep optimization orchestration and persistence unchanged. Extend the bounded public evaluation summary with the already-computed baseline delta, derive a pure user-summary view in the renderer, and render that view into a compact progress/result/action surface. Existing scope, child-job, artifact, frozen-input, installation, and identifier output remains available under native `<details>` disclosure and empty sections are removed from layout.

**Tech Stack:** Electron, browser DOM APIs, CommonJS, Node.js test runner, HTML/CSS, renderer smoke harness.

---

### Task 1: Derive a bounded user-facing optimization summary

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Test: `desktop/rolling-skill/test/optimization-control-contracts.test.cjs`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`

- [x] **Step 1: Write failing contract and view-model tests**

Add a public-analysis fixture with `baselineScoreDelta: 12` and assert it survives `optimization.get` output validation. Add an `optimizationUserSummaryView()` test expecting:

```js
assert.deepEqual(optimizationUserSummaryView(run), {
    phase: "waiting_approval",
    currentEpoch: 2,
    maxEpochs: 5,
    direction: "重点改善异常下钻",
    latestResult: {
        epoch: 2,
        score: 94,
        baselineScore: 82,
        baselineScoreDelta: 12,
        passRate: 1,
        regressionCount: 0,
    },
    action: "final_approval",
})
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `cd desktop/rolling-skill && node --test test/optimization-control-contracts.test.cjs test/operator-workbench.test.cjs`

Expected: FAIL because `baselineScoreDelta` is rejected or dropped and `optimizationUserSummaryView` does not exist.

- [x] **Step 3: Implement the bounded field and pure summary helper**

Allow `baselineScoreDelta` in `publicOptimizationAnalysis`, copy it in `publicAnalysis`, and export a renderer helper that selects the most recent evaluated Epoch and computes a baseline score only when both values are finite:

```js
function optimizationUserSummaryView(run = {}) {
    const epochs = Array.isArray(run.epochs) ? run.epochs : []
    const latest = [...epochs].reverse().find((epoch) => Number.isFinite(epoch?.analysis?.score)) ?? null
    const analysis = latest?.analysis ?? null
    const delta = Number.isFinite(analysis?.baselineScoreDelta) ? analysis.baselineScoreDelta : null
    return {
        phase: run.state ?? "unknown",
        currentEpoch: run.currentEpoch ?? 0,
        maxEpochs: Number.isSafeInteger(run.limits?.maxEpochs) ? run.limits.maxEpochs : null,
        direction: typeof run.optimizationDirection === "string" && run.optimizationDirection.trim()
            ? run.optimizationDirection.trim()
            : null,
        latestResult: analysis ? {
            epoch: latest.number,
            score: analysis.score,
            baselineScore: delta === null ? null : analysis.score - delta,
            baselineScoreDelta: delta,
            passRate: Number.isFinite(analysis.passRate) ? analysis.passRate : null,
            regressionCount: Number.isSafeInteger(analysis.regressionCount) ? analysis.regressionCount : 0,
        } : null,
        action: run.state === "waiting_approval"
            ? "final_approval"
            : run.state === "needs_recovery" ? "recovery" : null,
    }
}
```

- [x] **Step 4: Run focused tests and confirm GREEN**

Run: `cd desktop/rolling-skill && node --test test/optimization-control-contracts.test.cjs test/operator-workbench.test.cjs`

Expected: PASS.

### Task 2: Replace the sidebar with progress, result, and action summaries

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Test: `desktop/rolling-skill/scripts/renderer-smoke.cjs`

- [x] **Step 1: Write failing markup behavior tests**

Assert that the optimization panel contains dedicated phase, progress, direction, latest-result, and decision containers, and that audit sections are descendants of a closed native disclosure:

```js
assert.match(markup, /id="operator-optimization-phase"/u)
assert.match(markup, /id="operator-optimization-progress"/u)
assert.match(markup, /<details id="operator-technical-details"[^>]*>/u)
assert.doesNotMatch(markup, /<details id="operator-technical-details"[^>]*\sopen/u)
```

Extend renderer smoke before production changes to assert that a live optimization task shows a non-empty phase, `Epoch 1/2`, a closed technical disclosure, no empty default approval block, and—after the fixture advances—baseline/current scores plus the single final approval controls.

- [x] **Step 2: Run the focused renderer test and confirm RED**

Run:

```bash
cd desktop/rolling-skill && node --test test/operator-workbench.test.cjs
cd desktop/rolling-skill && npm run smoke:renderer
```

Expected: both commands FAIL because the summary containers and disclosure do not exist.

- [x] **Step 3: Implement the semantic markup and renderer**

Render the current phase and `Epoch current/max` at the top, the user direction as one short line, the latest score/baseline/pass-rate/regression metrics as compact cards, and a prominent instruction when final approval or recovery is required. Move frozen identities, Epoch history, installation IDs, scope, budget, child jobs, and artifacts below `<details id="operator-technical-details">`. Exclude `optimization.release-install` from the generic approval list because its single final decision is already rendered beside the comparison.

- [x] **Step 4: Hide empty technical and approval sections**

Toggle each section's `hidden` class from the corresponding data length. Keep the technical disclosure closed when entering an optimization task, preserve the user's manual open state during polling, and keep it open for ordinary self-operation tasks.

- [x] **Step 5: Add Chinese and English copy plus compact Codex-style CSS**

Add translation keys for optimization progress, phase descriptions, baseline/current comparison, next action, and technical details. Style the summary with existing white/blue surfaces, 8–10px radii, restrained status color, and existing `.operator-action-button` controls.

- [x] **Step 6: Run the focused renderer test and confirm GREEN**

Run: `cd desktop/rolling-skill && node --test test/operator-workbench.test.cjs`

Expected: PASS.

### Task 3: Verify the real renderer flow and installed App

- [x] **Step 1: Run all verification**

Run:

```bash
cd desktop/rolling-skill && npm test
cd desktop/rolling-skill && npm run smoke:renderer
cd desktop/rolling-skill && npm run build:tool
cd ../.. && npm run test:dsh
cd ../.. && git diff --check
```

Expected: all tests pass, smoke reports no renderer errors, the tool builds, and the DSH/Core suite passes.

- [x] **Step 2: Build, sign, install, and inspect the App**

Run `bash desktop/rolling-skill/scripts/build-macos-app.sh`, sign without hardened runtime using `Rolling Skill Local Development`, replace `/Applications/Rolling Skill.app`, launch it, and inspect an optimization task through the real UI. Confirm the default sidebar contains only readable progress/results/actions and that technical details expand on demand.

- [x] **Step 3: Commit and push only source changes**

Explicitly stage the plan, renderer, contract, and test files. Verify `git diff --cached --name-only` contains no `rolling-skill-dsh-plugin-*.tgz`, then commit and push `main` to `rolling-skill/main`.
