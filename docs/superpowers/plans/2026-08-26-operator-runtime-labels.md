# Operator Runtime Full Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Operator Runtime choice human-distinguishable by showing its version and adding its source path only when the full label still collides.

**Architecture:** Add one pure renderer label helper and reuse it in the Operator, target, and Judge Runtime render paths. Keep runtime IDs and all execution requests unchanged; CSS only allows a target label to wrap when a collision suffix is necessary.

**Tech Stack:** Electron renderer JavaScript, DOM, CSS, Node.js test runner

---

### Task 1: Unify Runtime labels

**Files:**
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`

- [ ] **Step 1: Write the failing label tests**

Import `runtimeDisplayLabel` and assert the desired labels:

```js
const codexA = {
    runtimeId: "codex:a",
    displayName: "Codex",
    version: "0.149.0",
    executablePath: "/Applications/ChatGPT.app/Contents/Resources/codex",
}
const codexB = {
    runtimeId: "codex:b",
    displayName: "Codex",
    version: "0.148.0",
    executablePath: "/usr/local/bin/codex",
}
assert.equal(runtimeDisplayLabel(codexA, [codexA, codexB]), "Codex 0.149.0")
assert.equal(runtimeDisplayLabel(codexB, [codexA, codexB]), "Codex 0.148.0")
```

Add a same-version pair and assert that each label ends with its own `executablePath`; also assert `displayName: "Codex 0.149.0"` does not duplicate the version.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `cd desktop/rolling-skill && node --test test/operator-workbench.test.cjs`

Expected: FAIL because `runtimeDisplayLabel` is not exported.

- [ ] **Step 3: Implement the pure label helper**

Add a base-label helper and exported `runtimeDisplayLabel(runtime, catalog)` in `renderer/operator-workbench.js`. Append `version` only when absent from the base label. Count equal base labels in `catalog`; when more than one exists, append `executablePath ?? source ?? runtimeId`.

- [ ] **Step 4: Reuse the helper in all Operator Runtime controls**

Replace the three independent label expressions in `renderSetupCatalogs()`, `renderOptimizationRuntimeSelectors()`, and the target card renderer with `runtimeDisplayLabel(runtime, catalogs.runtimes)`. Add `operator-runtime-label` to the target label span.

- [ ] **Step 5: Let collision details wrap**

Add:

```css
.operator-target-card .operator-runtime-label {
    overflow: visible;
    text-overflow: clip;
    white-space: normal;
    overflow-wrap: anywhere;
}
```

- [ ] **Step 6: Run the focused test to verify GREEN**

Run: `cd desktop/rolling-skill && node --test test/operator-workbench.test.cjs`

Expected: all Operator workbench tests pass with zero failures.

- [ ] **Step 7: Commit the implementation**

```bash
git add desktop/rolling-skill/renderer/operator-workbench.js desktop/rolling-skill/renderer/styles.css desktop/rolling-skill/test/operator-workbench.test.cjs
git commit -m "fix: disambiguate operator runtimes"
```
