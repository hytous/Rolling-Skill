# Rolling Skill Operator Localization and UI Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconnect the Operator workbench to Rolling Skill's existing bilingual settings, align it with the Skill evaluation visual system, and stop DeepSeek Harness from opening a browser.

**Architecture:** Static Operator copy uses the existing `data-i18n*` DOM pipeline. Dynamic Operator copy receives the renderer's existing `t()` and `formatMessage()` callbacks, so `settings.language` remains the only language state. CSS keeps the existing three-column DOM but adopts the evaluation workbench's established spacing, typography, surfaces, borders, and control sizing.

**Tech Stack:** Electron, CommonJS, vanilla JavaScript, HTML, CSS, Node test runner.

---

### Task 1: Reuse the existing localization pipeline

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`

- [ ] **Step 1: Add focused failing localization assertions**

Add source-level assertions that Operator static controls use `data-i18n*`, both existing translation catalogs contain Operator keys, and `createOperatorWorkbench` receives `translate: t` plus `formatMessage`. Add a unit assertion for dynamic status text:

```js
assert.equal(jobStatusText("waiting_approval", (key) => ({
    operatorStatusWaitingApproval: "等待审批",
})[key]), "等待审批")
```

- [ ] **Step 2: Run only the focused RED tests**

Run:

```bash
node --test test/local-first-surface.test.cjs test/operator-workbench.test.cjs
```

Expected: FAIL because Operator static and dynamic copy is still hard-coded in English and the translation callbacks are not injected.

- [ ] **Step 3: Convert static and dynamic copy to the existing APIs**

Add Operator keys to `translations.en` and `translations["zh-CN"]`; annotate all static Operator DOM copy with existing `data-i18n`, `data-i18n-placeholder`, and `data-i18n-aria-label` attributes. Inject the existing callbacks:

```js
operatorWorkbench = createOperatorWorkbench({
    api: window.rollingSkill,
    root: elements.operatorWorkbench,
    language: () => state.settings.language,
    translate: t,
    formatMessage,
    onError: showError,
    onSelectEntity: selectOperatorEntity,
})
```

Replace dynamic English status/action/empty/preflight/budget/Epoch/approval strings in `operator-workbench.js` with translation keys and formatted values. Export the pure formatting helpers used by focused tests.

- [ ] **Step 4: Re-render dynamic Operator copy when settings change**

After `applyLocalization()` updates static DOM, notify the existing workbench without creating language state:

```js
operatorWorkbench?.localize()
```

The method re-renders the current catalogs, setup state, Job list, and active Job from persisted snapshots.

- [ ] **Step 5: Run only the focused GREEN tests**

Run:

```bash
node --test test/local-first-surface.test.cjs test/operator-workbench.test.cjs
```

Expected: PASS.

### Task 2: Align the Operator visual system with Skill evaluation

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/renderer/styles.css`

- [ ] **Step 1: Add focused style contract assertions**

Require the Operator workbench to use the evaluation page background treatment, common panel radius, normal readable control typography, and no capitalization transform for localized status text:

```js
assert.match(styles, /\.operator-workbench\s*\{[^}]*radial-gradient/s)
assert.match(styles, /\.operator-job-panel,[\s\S]*border-radius:\s*14px/)
assert.doesNotMatch(styles, /\.operator-state-pill\s*\{[^}]*text-transform:\s*capitalize/s)
```

- [ ] **Step 2: Run the focused RED surface test**

Run:

```bash
node --test test/local-first-surface.test.cjs
```

Expected: FAIL because the Operator page still uses its independent dense styling.

- [ ] **Step 3: Update only the Operator CSS section**

Keep the three-column layout and responsive breakpoints. Match the evaluation surface by using the existing theme variables, 14px panel radii, standard control heights/padding, 12–14px readable copy, consistent selected rows, and neutral/blue ordinary states. Remove forced capitalization and Operator-specific miniature button typography. Keep warning and danger colors limited to approval, stop, recovery, and failure states.

- [ ] **Step 4: Run the focused GREEN surface test**

Run:

```bash
node --test test/local-first-surface.test.cjs
```

Expected: PASS.

### Task 3: Prevent DeepSeek Harness browser launch

**Files:**
- Modify: `desktop/rolling-skill/test/deepseek-harness-runtime-provider.test.cjs`
- Modify: `desktop/rolling-skill/src/deepseek-harness-client.cjs`

- [ ] **Step 1: Change the focused Host argument expectation**

```js
assert.deepEqual(args, ["--profile", "web", "--no-open", "--port", "0"])
```

- [ ] **Step 2: Run the focused RED test**

Run:

```bash
node --test test/deepseek-harness-runtime-provider.test.cjs
```

Expected: FAIL because the production spawn arguments omit `--no-open`.

- [ ] **Step 3: Add the minimal production argument**

```js
["--profile", "web", "--no-open", "--port", "0"]
```

- [ ] **Step 4: Run the focused GREEN test**

Run:

```bash
node --test test/deepseek-harness-runtime-provider.test.cjs
```

Expected: PASS.

### Task 4: Commit, package, sign, and replace the local installation

**Files:**
- Modify: `desktop/rolling-skill/dist/mac-arm64/Rolling Skill.app` through the build pipeline
- Modify: repository-root `Rolling Skill.app` and `rolling-skill-tool` through installation commands

- [ ] **Step 1: Commit source changes directly on `main`**

```bash
git add desktop/rolling-skill docs/superpowers
git commit -m "fix: localize and align operator workbench"
```

- [ ] **Step 2: Build the macOS app once**

```bash
cd desktop/rolling-skill
npm run pack:mac
```

Expected: electron-builder produces `dist/mac-arm64/Rolling Skill.app` and the external tool build.

- [ ] **Step 3: Sign and update the repository-root installation**

Use `scripts/ensure-local-signing-identity.sh`, sign the packaged App once, move the previous root App to a recoverable `/tmp` path, copy the new App with `ditto`, and install `dist-tools/rolling-skill-tool` with mode `755`.

- [ ] **Step 4: Do not run broad verification**

Do not run the full test suite, Renderer smoke, App launch smoke, or a separate signing verification. The focused RED/GREEN tests and successful package/install commands are the complete verification scope requested for this fix.
