# Rolling Skill Operator Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current three equal blue cards with a visually weighted task rail, primary setup canvas, and subdued context rail while preserving every Operator workflow and translation.

**Architecture:** Keep all existing field IDs, workbench selectors, request builders, and state transitions intact. Add semantic setup grouping in `index.html`, extend the existing bilingual dictionary for two group headings, and rewrite only the Operator CSS block plus its responsive rules. Use the existing `operator-panel-empty` state to reduce empty right-rail noise and CSS `:has()` to hide the redundant creation transcript.

**Tech Stack:** Electron renderer, semantic HTML, CSS Grid/Flexbox, existing CSS theme variables, existing `translations`/`data-i18n`, Node.js built-in test runner.

---

### Task 1: Lock the approved visual hierarchy with a failing focused test

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs:61-69`
- Test: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Replace the old visual assertions with the approved structure**

```js
assert.match(html, /class="operator-setup-section operator-environment-section"/)
assert.match(html, /class="operator-setup-section operator-resource-section"/)
assert.match(html, /class="operator-setup-actions operator-setup-footer"/)
assert.match(renderer, /operatorEnvironment:\s*"Run environment"/)
assert.match(renderer, /operatorEnvironment:\s*"运行环境"/)
assert.match(styles, /\.operator-workbench\s*\{[^}]*background:\s*var\(--surface\)/s)
assert.doesNotMatch(styles, /\.operator-workbench\s*\{[^}]*radial-gradient/s)
assert.match(styles, /\.operator-job-panel\s*\{[^}]*background:\s*transparent/s)
assert.match(styles, /\.operator-status-panel\s*\{[^}]*background:\s*transparent/s)
assert.match(styles, /\.operator-session-panel\s*\{[^}]*border-inline:/s)
assert.match(styles, /\.operator-target-card:has\(input:checked\)/)
assert.match(styles, /\.operator-setup-actions button\.primary\s*\{[^}]*background:\s*var\(--accent\)/s)
assert.match(styles, /\.operator-session-panel:has\(\.operator-setup-form:not\(\.hidden\)\) \.operator-transcript/)
```

- [ ] **Step 2: Run the single test file and confirm RED**

Run:

```bash
cd desktop/rolling-skill
node --test test/local-first-surface.test.cjs
```

Expected: FAIL because the semantic setup sections and transparent rail/primary-action styles do not exist yet.

### Task 2: Restructure the setup canvas without changing the form contract

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html:297-480`
- Modify: `desktop/rolling-skill/renderer/renderer.js` in both `translations.en` and `translations["zh-CN"]`

- [ ] **Step 1: Add the two existing-pipeline translation keys**

Add to English:

```js
operatorEnvironment: "Run environment",
operatorResources: "Resources and scope",
```

Add to Chinese:

```js
operatorEnvironment: "运行环境",
operatorResources: "资源与范围",
```

- [ ] **Step 2: Group the existing controls semantically**

Keep every existing `id`, `name`, `data-*`, option, and submission order. Change only the wrappers so the setup body follows this structure:

```html
<header class="operator-setup-hero">…</header>
<label class="operator-field operator-objective-field">…</label>

<section class="operator-setup-section operator-environment-section">
    <h2 data-i18n="operatorEnvironment">Run environment</h2>
    <label class="operator-field operator-job-kind-field">…</label>
    <div class="operator-setup-row">…runtime/model/effort…</div>
</section>

<section class="operator-setup-section operator-resource-section">
    <h2 data-i18n="operatorResources">Resources and scope</h2>
    <div class="operator-setup-row two">…skill/dataset…</div>
    <fieldset class="operator-fieldset operator-target-fieldset">…targets…</fieldset>
</section>

<section id="operator-optimization-fields" class="operator-optimization-fields hidden">…</section>
<details class="operator-setup-details">…</details>
<p id="operator-setup-error" class="operator-error hidden" role="alert"></p>
<div class="operator-setup-actions operator-setup-footer">…existing buttons…</div>
```

- [ ] **Step 3: Keep static localization compatible**

Do not introduce a new language state or renderer function. The new headings use `data-i18n`, so the existing `applyLocalization()` handles them and the existing Operator `localize()` continues to handle dynamic content.

### Task 3: Rewrite the Operator visual hierarchy

**Files:**
- Modify: `desktop/rolling-skill/renderer/styles.css:589-1111`
- Modify: `desktop/rolling-skill/renderer/styles.css:5446-5492`

- [ ] **Step 1: Replace the equal-card shell with weighted rails and a primary canvas**

The core shell must use the following rules:

```css
.operator-workbench {
    display: grid;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    padding: 14px 20px 20px;
    background: var(--surface);
    grid-row: 2 / -1;
    grid-template-columns: minmax(168px, 184px) minmax(480px, 1fr) minmax(218px, 238px);
    gap: 0;
}

.operator-job-panel,
.operator-status-panel {
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
}

.operator-session-panel {
    position: relative;
    display: grid;
    overflow: hidden;
    min-width: 0;
    min-height: 0;
    border-inline: 1px solid var(--border);
    background: var(--surface);
    grid-template-rows: auto minmax(0, 1fr) auto;
}
```

- [ ] **Step 2: Make the task rail compact and accent-led**

Use `12px 14px 12px 0` rail padding, remove the repeated kicker visually, keep the list near the top, and make `#operator-new-job` a compact accent button. Active jobs retain a light accent background without a large panel fill.

```css
.operator-panel-header .panel-kicker { display: none; }
.operator-panel-header button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
}
.operator-job-list .operator-empty {
    padding: 18px 6px;
    text-align: left;
}
```

- [ ] **Step 3: Build a scan-friendly setup canvas**

Use a single white canvas with a bounded reading width, a full-width objective, quiet section dividers, consistent 38px controls, accent focus, and tag-like Runtime targets:

```css
.operator-setup-form {
    overflow-y: auto;
    min-height: 0;
    padding: 28px clamp(28px, 4vw, 56px) 30px;
    grid-row: 1 / 3;
}
.operator-setup-section {
    margin-top: 20px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
}
.operator-setup-section h2 {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 680;
}
.operator-field textarea:focus,
.operator-field select:focus,
.operator-budget-grid input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
}
.operator-target-card:has(input:checked) {
    border-color: color-mix(in srgb, var(--accent) 48%, var(--border));
    background: color-mix(in srgb, var(--accent) 9%, var(--surface));
    color: var(--text);
}
.operator-session-panel:has(.operator-setup-form:not(.hidden)) .operator-transcript,
.operator-session-panel:has(.operator-setup-form:not(.hidden)) .operator-composer-wrap {
    display: none;
}
```

- [ ] **Step 4: Make the context rail subordinate and remove empty noise**

Use `12px 0 12px 16px` padding, transparent background, compact dividers, and hide empty child/artifact/approval sections while `operator-panel-empty` is present:

```css
.operator-status-panel {
    overflow-y: auto;
    padding: 12px 0 12px 16px;
    background: transparent;
}
.operator-status-panel.operator-panel-empty .operator-side-section {
    display: none;
}
.operator-status-panel.operator-panel-empty .operator-compact-copy {
    color: var(--faint);
}
```

- [ ] **Step 5: Make the setup action unmistakably primary**

```css
.operator-setup-actions {
    display: flex;
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--border);
    justify-content: flex-end;
    gap: 8px;
}
.operator-setup-actions button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
}
```

- [ ] **Step 6: Preserve usable responsive behavior**

At the existing `1120px` breakpoint, use a `146–164px` task rail, flexible center, and `186–204px` context rail. Below the existing narrow breakpoint, switch to two columns and place the context rail below the center instead of shrinking the form controls below one usable column.

- [ ] **Step 7: Run the focused test and confirm GREEN**

Run:

```bash
cd desktop/rolling-skill
node --test test/local-first-surface.test.cjs
```

Expected: the file passes with zero failures.

- [ ] **Step 8: Commit the implementation**

```bash
git add desktop/rolling-skill/renderer/index.html \
  desktop/rolling-skill/renderer/renderer.js \
  desktop/rolling-skill/renderer/styles.css \
  desktop/rolling-skill/test/local-first-surface.test.cjs
git commit -m "fix: redesign operator workbench hierarchy"
```

### Task 4: Rebuild, install, and inspect the real App

**Files:**
- Generated: `desktop/rolling-skill/dist/mac-arm64/Rolling Skill.app`
- Generated: `desktop/rolling-skill/dist-tools/rolling-skill-tool`
- Replace: `Rolling Skill.app`
- Replace: `rolling-skill-tool`

- [ ] **Step 1: Package without running the full suite**

Run:

```bash
cd desktop/rolling-skill
npm run pack:mac
```

Expected: `electron-builder` exits `0` and writes the arm64 App plus CLI.

- [ ] **Step 2: Sign and replace the repository-root install**

Sign the built App with the configured local identity, move the current root App/CLI to one explicit `/tmp` backup, copy the new App with `ditto`, copy the new CLI, and set CLI mode `755`. Do not run a separate signature verification.

- [ ] **Step 3: Inspect the actual Chinese page**

Open `/Users/wangbaoheng/Downloads/billing-cli/agenta/Rolling Skill.app`, navigate to “自操作”, and confirm from the real App screenshot that:

- the three blue equal cards are gone;
- the center canvas is visually dominant;
- the empty right rail is subdued;
- the primary action is accent-filled;
- the redundant creation transcript text is absent;
- visible setup copy remains Chinese.

- [ ] **Step 4: Check English linkage and restore Chinese**

Use Settings to switch to English, confirm the two new section headings translate, then restore Simplified Chinese. Do not create or run an Operator Job.

- [ ] **Step 5: Remove the temporary old-install backup**

Move the explicit backup to macOS Trash after the new App screenshot is accepted. Do not retain a duplicate old App in the repository or `/tmp`.
