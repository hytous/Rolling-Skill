# DSH Workbench Grouped Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat DSH Rolling Skill workbench navigation with four two-level business groups and remove the legacy import and duplicate diagnostics UI from the released interface.

**Architecture:** Keep all existing business panels and route payloads intact. Define the group-to-page information architecture in `Workbench.tsx`, derive active first- and second-level navigation from the current route, and normalize retired saved routes to Overview. Remove only the public imports/routes/settings surfaces for legacy import and diagnostics; preserve Core migration APIs.

**Tech Stack:** React, TypeScript/TSX, DSH UI primitives, CSS theme tokens, Node test runner, esbuild, DSH plugin packaging.

---

### Task 1: Lock the visible navigation contract

**Files:**
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`
- Test: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write the failing grouped-navigation test**

Add assertions that `Workbench.tsx` declares `NAVIGATION_GROUPS`, the labels `caseManagement`, `skillAndInstallation`, and `evaluationAndOptimization`, two distinct navigation elements, and no `ImportPanel`, `page: "import"`, or `page: "diagnostics"`. Assert `RollingSkillSettings.tsx` no longer imports or renders `ImportPanel` and its description no longer advertises legacy import or diagnostics.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test packages/rolling-skill-dsh/test/client-source.test.cjs
```

Expected: the grouped-navigation assertions fail because the workbench still maps one flat `TABS` array and still exposes legacy import and diagnostics.

### Task 2: Implement two-level workbench navigation

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Replace flat tabs with the navigation model**

Define four groups:

```ts
const NAVIGATION_GROUPS = [
    {id: "overview", label: "overview", defaultPage: "overview", pages: [{id: "overview", label: "overview"}]},
    {id: "case-management", label: "caseManagement", defaultPage: "automatic", pages: [
        {id: "automatic", label: "automatic"},
        {id: "raw-cases", label: "rawCases"},
        {id: "curation", label: "curation"},
        {id: "cases", label: "cases"},
        {id: "datasets", label: "datasets"},
    ]},
    {id: "skill-installation", label: "skillAndInstallation", defaultPage: "skills", pages: [
        {id: "skills", label: "skills"},
        {id: "installations", label: "runtimeInstallation"},
    ]},
    {id: "evaluation-optimization", label: "evaluationAndOptimization", defaultPage: "rubrics", pages: [
        {id: "rubrics", label: "rubrics"},
        {id: "evaluations", label: "evaluations"},
        {id: "operator", label: "operator"},
        {id: "optimization", label: "optimizationTitle"},
    ]},
] as const
```

Remove `import` and `diagnostics` from `WorkbenchRoute`, normalize unknown persisted routes to `{page: "overview"}`, and render `.rolling-skill-primary-tabs` plus `.rolling-skill-secondary-tabs`. Do not render a secondary row for Overview.

- [ ] **Step 2: Add exact Chinese and English labels**

Add translations:

```ts
caseManagement: "Case 沉淀与管理"
skillAndInstallation: "Skill 与安装"
evaluationAndOptimization: "评测与优化"
runtimeInstallation: "Runtime 安装"
workbenchSections: "工作台功能分组"
workbenchPages: "当前分组页面"
```

and their English equivalents. Update `settingsDescription` so it describes only the default Runtime and Curator/Rubric/Judge profiles.

- [ ] **Step 3: Add hierarchy styling**

Give the primary row a stable bottom border and stronger selected state; give the secondary row a raised, lower-emphasis background and its own spacing. Keep both rows independently wrappable and use only existing DSH theme variables.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test packages/rolling-skill-dsh/test/client-source.test.cjs
```

Expected: all Client source tests pass.

### Task 3: Remove retired UI surfaces without deleting migration APIs

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/settings/RollingSkillSettings.tsx`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`
- Preserve: `packages/rolling-skill-dsh/src/client/workbench/ImportPanel.tsx`
- Preserve: `packages/rolling-skill-core/src/legacy-import.cjs`

- [ ] **Step 1: Remove the Settings import and diagnostics blocks**

Delete the `ImportPanel` import and render. Remove the read-only diagnostics card; keep editable default Runtime and agent profiles unchanged. Do not change `legacyImport.status` or `legacyImport.run` in Shared Core.

- [ ] **Step 2: Update the legacy import contract test**

Keep assertions that `ImportPanel.tsx` remains copy-only and calls the two bounded APIs, but assert that neither `Workbench.tsx` nor `RollingSkillSettings.tsx` imports or renders it.

- [ ] **Step 3: Run the focused test**

Run:

```bash
node --test packages/rolling-skill-dsh/test/client-source.test.cjs
```

Expected: all tests pass and the hidden migration implementation remains covered.

### Task 4: Package and install the released plugin

**Files:**
- Modify: `packages/rolling-skill-dsh/package.json`
- Modify: `package-lock.json`
- Modify: `packages/rolling-skill-dsh/test/package-manifest.test.cjs`
- Regenerate: `packages/rolling-skill-dsh/lib/client.js`
- Regenerate: `packages/rolling-skill-dsh/lib/index.js`
- Regenerate: `packages/rolling-skill-dsh/lib/worker.cjs`

- [ ] **Step 1: Bump the plugin patch version**

Change `0.1.4` to `0.1.5` in the package manifest, lock file, and manifest test so DSH cannot reuse the previous installed package.

- [ ] **Step 2: Run the DSH suite**

Run:

```bash
npm run test:dsh
```

Expected: 0 failures.

- [ ] **Step 3: Build, pack, and inspect**

Run:

```bash
npm pack --workspace @rolling-skill/dsh-plugin
node packages/rolling-skill-dsh/scripts/inspect-package.mjs rolling-skill-dsh-plugin-0.1.5.tgz
```

Expected: six-file package inspection passes and no Electron/Chromium payload is present.

- [ ] **Step 4: Install and restart the local web profile**

Install `rolling-skill-dsh-plugin-0.1.5.tgz` with `dsh plugin --profile web add`, restart the exact current `--profile web --no-open --port 3080` process, and wait until `curl http://127.0.0.1:3080/` returns HTTP 200.

- [ ] **Step 5: Verify the real DSH UI**

In the in-app browser, hard-navigate with a `rollingSkill=0.1.5` cache-buster. Verify exactly four primary buttons, no secondary row on Overview, correct secondary items per group, successful page switching, correct group selection for a deep-linked evaluation or Case, and no visible legacy Electron or diagnostics text in the workbench or Settings.

- [ ] **Step 6: Run final checks**

Run `git diff --check`, the focused Client test, `npm run test:dsh`, package inspection, plugin version listing, and HTTP health check. Report the exact test counts and package size.
