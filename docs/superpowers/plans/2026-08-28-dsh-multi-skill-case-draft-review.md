# DSH Multi-Skill Case and Draft Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scalable Skill filtering, correct Draft scope selection, a focused Draft revision composer, and safe readable Markdown rendering to the DSH Rolling Skill workbench.

**Architecture:** Keep all persisted schemas and Host APIs unchanged. Put deterministic UI selection/filtering and Markdown URL policy in small CommonJS modules that can be tested directly with Node, then integrate those helpers into the existing React panels. Use `react-markdown` without raw-HTML plugins for rendering and keep audit information in native collapsed details.

**Tech Stack:** React 18, TypeScript/TSX, CommonJS view-model helpers, Node test runner, esbuild, DSH UI primitives and theme tokens.

---

### Task 1: Deterministic Skill and Draft selection helpers

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/raw-case-skill-filter.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/curation-selection.cjs`
- Create: `packages/rolling-skill-dsh/test/workbench-selection.test.cjs`

- [ ] **Step 1: Write failing helper tests**

```js
const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const {rawCaseSkillGroups, rawCaseSkillOptions, resolveRawCaseSkillScope} = require("../src/client/workbench/raw-case-skill-filter.cjs")
const {visibleCurationSelection} = require("../src/client/workbench/curation-selection.cjs")

it("keeps managed Skills separate and filters by stable Skill id", () => {
    const entries = [
        {id: "a", question: "alpha", note: "", skill: {id: "skill-a", name: "Alpha"}},
        {id: "b", question: "beta", note: "", skill: {id: "skill-b", name: "Beta"}},
    ]
    assert.deepEqual(rawCaseSkillOptions(entries).map(({key, count}) => ({key, count})), [
        {key: "skill-a", count: 1},
        {key: "skill-b", count: 1},
    ])
    assert.deepEqual(rawCaseSkillGroups(entries, "", "skill-b").flatMap((group) => group.items.map((item) => item.id)), ["b"])
    assert.equal(resolveRawCaseSkillScope("missing", entries), "all")
})

it("never keeps a Draft selected outside the visible scope", () => {
    assert.equal(visibleCurationSelection("archived", [{id: "active"}]), "active")
    assert.equal(visibleCurationSelection("archived", []), "")
    assert.equal(visibleCurationSelection("active", [{id: "active"}]), "active")
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs`

Expected: FAIL because both helper modules are missing.

- [ ] **Step 3: Implement minimal pure helpers**

```js
function skillKey(entry) {
    return entry?.skill?.id || `legacy:${entry?.skill?.name || "unknown"}`
}

function rawCaseSkillOptions(entries = []) {
    const options = new Map()
    for (const entry of entries) {
        const key = skillKey(entry)
        const current = options.get(key) || {key, name: entry?.skill?.name || "Unknown Skill", count: 0}
        current.count += 1
        options.set(key, current)
    }
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function rawCaseSkillGroups(entries = [], search = "", scope = "all") {
    const query = String(search).trim().toLocaleLowerCase()
    const groups = new Map()
    for (const entry of entries) {
        const key = skillKey(entry)
        if (scope !== "all" && key !== scope) continue
        if (query && !`${entry.question}\n${entry.note || ""}\n${entry.skill?.name || ""}`.toLocaleLowerCase().includes(query)) continue
        const group = groups.get(key) || {key, name: entry.skill?.name || "Unknown Skill", items: []}
        group.items.push(entry)
        groups.set(key, group)
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function resolveRawCaseSkillScope(scope, entries = []) {
    return scope === "all" || rawCaseSkillOptions(entries).some((entry) => entry.key === scope) ? scope : "all"
}

module.exports = {rawCaseSkillGroups, rawCaseSkillOptions, resolveRawCaseSkillScope}
```

```js
function visibleCurationSelection(currentId, items = []) {
    return items.some((entry) => entry.id === currentId) ? currentId : items[0]?.id || ""
}

module.exports = {visibleCurationSelection}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs`

Expected: all tests pass.

### Task 2: Integrate scalable Skill filtering into Raw Case

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Add failing source-contract assertions**

```js
assert.match(rawCases, /rawCaseSkillOptions/u)
assert.match(rawCases, /rawCaseSkillGroups/u)
assert.match(rawCases, /aria-label=\{t\("rawCaseSkillFilter"\)\}/u)
assert.match(rawCases, /aria-pressed=\{skillScope === group\.key\}/u)
assert.match(css, /\.rolling-skill-raw-group-filter/u)
```

- [ ] **Step 2: Run the client source test and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because the Skill filter UI does not exist.

- [ ] **Step 3: Replace inline grouping with the tested helper**

Add `skillScope` state, derive options and groups with the helper, reconcile deleted Skill scopes in an effect, render an “All Skills” option with the total count, and make each group heading a button that toggles between that Skill and all Skills. Keep the existing stable `entry.skill.id` checks for Dataset compatibility and Draft creation.

- [ ] **Step 4: Add compact responsive styling and translations**

Use a toolbar with a bounded select and a group-heading button. Selected group headings use the DSH business-primary border and layer background; long Skill names wrap without expanding the workbench.

- [ ] **Step 5: Run helper and client source tests**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: all tests pass.

### Task 3: Correct Draft scope selection and focus the review surface

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/curation-client.test.cjs`
- Test: `packages/rolling-skill-dsh/test/workbench-selection.test.cjs`

- [ ] **Step 1: Add failing behavior and source-contract tests**

```js
assert.match(panel, /visibleCurationSelection/u)
assert.match(panel, /aria-pressed=\{!showArchived\}/u)
assert.match(panel, /aria-pressed=\{showArchived\}/u)
assert.doesNotMatch(view, /session\.conversation\.map/u)
assert.match(view, /rolling-skill-curation-composer/u)
assert.match(view, /<details className="rolling-skill-curation-runtime-details">/u)
assert.match(view, /placeholder=\{t\("reviewMessagePlaceholder"\)\}/u)
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs packages/rolling-skill-dsh/test/curation-client.test.cjs`

Expected: FAIL because stale selection is still possible and the internal conversation is rendered.

- [ ] **Step 3: Reconcile category and Session selection synchronously**

Derive `items` from `showArchived`, compute `visibleSelectedId = visibleCurationSelection(selectedId, items)`, synchronize it in an effect, and render the detail only for `visibleSelectedId`. If an initial deep link belongs to archived items, select the archived category. Give both category buttons `aria-pressed` and count labels.

- [ ] **Step 4: Reorder CurationSessionView**

Render current Draft first. Immediately after it, render an editable composer with a labeled textarea, explanatory placeholder, running state, retry where applicable, primary “Generate Revision” action, Save Case, and Discard. Remove the Curator conversation log from the standard UI.

- [ ] **Step 5: Preserve audit and model controls in collapsed runtime information**

Move frozen source range, digest, Skill/version, rubric, Runtime/install audit, model and effort controls into `<details className="rolling-skill-curation-runtime-details">`. Archived Sessions remain read-only.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs packages/rolling-skill-dsh/test/curation-client.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: all tests pass.

### Task 4: Add safe readable Markdown rendering

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/markdown-policy.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/MarkdownContent.tsx`
- Create: `packages/rolling-skill-dsh/test/markdown-policy.test.cjs`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Modify: `packages/rolling-skill-dsh/package.json`
- Modify: `package-lock.json`
- Test: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing URL-policy tests**

```js
const {safeMarkdownLink} = require("../src/client/workbench/markdown-policy.cjs")
assert.equal(safeMarkdownLink("https://example.com"), "https://example.com")
assert.equal(safeMarkdownLink("mailto:test@example.com"), "mailto:test@example.com")
assert.equal(safeMarkdownLink("javascript:alert(1)"), null)
assert.equal(safeMarkdownLink("data:text/html,bad"), null)
assert.equal(safeMarkdownLink("file:///tmp/private"), null)
```

- [ ] **Step 2: Run the Markdown policy test and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/markdown-policy.test.cjs`

Expected: FAIL because the policy module is missing.

- [ ] **Step 3: Implement the URL policy and verify GREEN**

```js
function safeMarkdownLink(value) {
    const link = typeof value === "string" ? value.trim() : ""
    return /^(?:https?:|mailto:)/iu.test(link) || link.startsWith("#") ? link : null
}

module.exports = {safeMarkdownLink}
```

- [ ] **Step 4: Add `react-markdown` and implement the renderer**

Create `MarkdownContent` with `skipHtml`, no `rehype-raw`, a custom anchor that renders unsafe URLs as a span, disabled images, and `target="_blank" rel="noreferrer"` for safe external links. The component accepts `compact` to apply preview-height styling.

- [ ] **Step 5: Replace raw Case text output**

Use `MarkdownContent` for Case question and answer in list rows and for question, answer, and issue description in the detail modal. Keep structured evidence in its existing advanced block.

- [ ] **Step 6: Add source-contract assertions and run focused tests**

```js
assert.match(cases, /<MarkdownContent/u)
assert.doesNotMatch(markdown, /dangerouslySetInnerHTML/u)
assert.match(markdown, /skipHtml/u)
assert.match(markdown, /safeMarkdownLink/u)
```

Run: `node --test packages/rolling-skill-dsh/test/markdown-policy.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: all tests pass.

### Task 5: Build, package, install, and visually verify

**Files:**
- Modify: `packages/rolling-skill-dsh/package.json` (version `0.1.16`)
- Modify: `package-lock.json`
- Generated: `packages/rolling-skill-dsh/lib/client.js`
- Generated: `packages/rolling-skill-dsh/lib/index.js`
- Generated: `packages/rolling-skill-dsh/lib/worker.cjs`
- Generated: `rolling-skill-dsh-plugin-0.1.16.tgz`

- [ ] **Step 1: Run focused and complete regression suites**

Run: `node --test packages/rolling-skill-dsh/test/workbench-selection.test.cjs packages/rolling-skill-dsh/test/markdown-policy.test.cjs packages/rolling-skill-dsh/test/curation-client.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs`

Run: `npm run test:dsh`

Expected: zero failures.

- [ ] **Step 2: Build and inspect the plugin package**

Run: `npm pack ./packages/rolling-skill-dsh --pack-destination .`

Run: `node packages/rolling-skill-dsh/scripts/inspect-package.mjs rolling-skill-dsh-plugin-0.1.16.tgz`

Expected: package inspection passes.

- [ ] **Step 3: Install to the local DSH web profile**

Run: `dsh plugin --profile web remove @rolling-skill/dsh-plugin`

Run: `dsh plugin --profile web add file:/Users/wangbaoheng/Downloads/billing-cli/agenta/rolling-skill-dsh-plugin-0.1.16.tgz`

Expected: installed package reports version `0.1.16`.

- [ ] **Step 4: Restart DSH and verify real UI behavior**

Check Raw Case with at least two Skill groups or deterministic fixture data; confirm Skill filtering and heading selection. Check Draft active/saved switching, empty category behavior, hidden Curator log, visible revision composer, collapsed runtime details, and Markdown list/code/link rendering at desktop and narrow widths.

- [ ] **Step 5: Verify installed artifacts**

Compare SHA-256 for source/build and installed `lib/client.js` and `lib/index.js`, verify port 3080 responds, and run `git diff --check`.

