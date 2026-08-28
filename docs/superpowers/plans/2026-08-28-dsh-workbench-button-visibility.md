# DSH Workbench Button Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Rolling Skill workbench text action recognizable in its default state and prevent fixed-height buttons from stretching, shrinking, wrapping, or overflowing at narrow widths.

**Architecture:** Add a workbench-only `ActionButton` wrapper around the DSH primitive so content actions have explicit primary/secondary/quiet semantics while the two-level navigation continues using the primitive directly. Centralize sizing and responsive behavior in `workbench.css`; keep all business callbacks and API calls unchanged.

**Tech Stack:** React 18, TypeScript, DSH Client UI primitives, CSS, Node test runner, esbuild.

---

### Task 1: Add failing button-semantics and layout contracts

**Files:**
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`
- Test: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write the failing test**

Add a source contract that reads `workbench/ActionButton.tsx`, every reachable workbench panel, `Workbench.tsx`, and `workbench.css`. Assert that the wrapper maps `primary`, `secondary`, and `quiet` to DSH variants; reachable panels import the wrapper instead of the primitive `Button`; navigation retains the primitive; and CSS contains `flex: 0 0 auto`, `white-space: nowrap`, `text-overflow: ellipsis`, `flex-wrap: wrap`, and the narrow-width `align-items: flex-start` rule.

```js
it("gives workbench actions visible semantics without stretching or text overflow", () => {
    const actionButton = source("workbench/ActionButton.tsx")
    const workbench = source("workbench/Workbench.tsx")
    const css = source("workbench/workbench.css")
    const panels = [
        "AutomaticCapturePanel.tsx", "CasesPanel.tsx", "CurationPanel.tsx",
        "CurationSessionView.tsx", "DatasetsPanel.tsx", "EvaluationsPanel.tsx",
        "InstallationsPanel.tsx", "OperatorPanel.tsx", "OptimizationPanel.tsx",
        "RawCasesPanel.tsx", "RubricPanel.tsx", "RubricSessionView.tsx",
        "RuntimeInteractions.tsx", "SkillsPanel.tsx",
    ].map((name) => source(`workbench/${name}`))

    assert.match(actionButton, /tone\s*=\s*"secondary"/u)
    assert.match(actionButton, /primary:\s*"primary"/u)
    assert.match(actionButton, /secondary:\s*"outline"/u)
    assert.match(actionButton, /quiet:\s*"ghost"/u)
    for (const panel of panels) {
        assert.match(panel, /ActionButton as Button/u)
        assert.doesNotMatch(panel, /import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*"@deepseek-ai\/dsh-client-ui-primitives"/u)
    }
    assert.match(workbench, /import\s*\{Button\}\s*from\s*"@deepseek-ai\/dsh-client-ui-primitives"/u)
    assert.match(css, /\.rolling-skill-action-button\s*\{[\s\S]*flex:\s*0 0 auto/u)
    assert.match(css, /\.rolling-skill-action-button\s*\{[\s\S]*white-space:\s*nowrap/u)
    assert.match(css, /text-overflow:\s*ellipsis/u)
    assert.match(css, /\.rolling-skill-actions\s*\{[\s\S]*flex-wrap:\s*wrap/u)
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*align-items:\s*flex-start/u)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="visible semantics" packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because `workbench/ActionButton.tsx` does not exist.

### Task 2: Implement the semantic workbench action component

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/ActionButton.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/AutomaticCapturePanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/InstallationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RubricPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RubricSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RuntimeInteractions.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`

- [ ] **Step 1: Create the wrapper**

```tsx
import {Button} from "@deepseek-ai/dsh-client-ui-primitives"
import type {ComponentProps} from "react"

type PrimitiveButtonProps = ComponentProps<typeof Button>
type ActionTone = "primary" | "secondary" | "quiet"

export interface ActionButtonProps extends Omit<PrimitiveButtonProps, "variant"> {
    tone?: ActionTone
}

const VARIANTS: Record<ActionTone, "primary" | "outline" | "ghost"> = {
    primary: "primary",
    secondary: "outline",
    quiet: "ghost",
}

export function ActionButton({tone = "secondary", className, ...props}: ActionButtonProps) {
    const classes = ["rolling-skill-action-button", className].filter(Boolean).join(" ")
    return <Button {...props} className={classes} data-rolling-skill-tone={tone} variant={VARIANTS[tone]}/>
}
```

- [ ] **Step 2: Migrate reachable panels**

Keep non-Button primitives imported from DSH, add `import {ActionButton as Button} from "./ActionButton"`, remove all `variant="outline"` and `variant="ghost"` props, and add `tone="primary"` to the three existing primary actions in `CurationSessionView.tsx`, `RubricPanel.tsx`, and `RubricSessionView.tsx`. Do not change callbacks, disabled expressions, labels, sizes, modal structure, or API payloads.

```tsx
import {Input, Modal} from "@deepseek-ai/dsh-client-ui-primitives"
import {ActionButton as Button} from "./ActionButton"

<Button size="sm" onClick={refresh}>{t("refresh")}</Button>
<Button tone="primary" disabled={busy} onClick={submit}>{t("send")}</Button>
```

- [ ] **Step 3: Add shared sizing and responsive rules**

In `workbench.css`, add:

```css
.rolling-skill-action-button {
    flex: 0 0 auto;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.rolling-skill-action-button[data-rolling-skill-tone="secondary"] {
    background: var(--dsw-alias-bg-layer-1);
}

.rolling-skill-actions {
    flex-wrap: wrap;
    min-width: 0;
}
```

Change the shared first form child to `flex: 1 1 0; min-width: 0`. At 760px and below, use `align-items: flex-start` for panel headers, rows, and form rows; give information bodies, input/select wrappers, and row action groups width `100%`, while leaving `.rolling-skill-action-button` at content width.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test --test-name-pattern="visible semantics" packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: PASS.

### Task 3: Verify, package, install, and inspect the real DSH page

**Files:**
- Modify: `packages/rolling-skill-dsh/package.json`
- Generated: `packages/rolling-skill-dsh/lib/client.js`
- Generated: `packages/rolling-skill-dsh/lib/index.js`
- Generated: `packages/rolling-skill-dsh/lib/worker.cjs`
- Generated: `rolling-skill-dsh-plugin-0.1.6.tgz`

- [ ] **Step 1: Run the complete DSH regression suite**

Run: `npm run test:dsh`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Build the Client bundle**

Run: `npm run build:dsh`

Expected: exit code 0 and refreshed `lib` bundles.

- [ ] **Step 3: Publish a locally distinguishable package version**

Change the DSH package version from `0.1.5` to `0.1.6`, update the lockfile through npm, pack to the repository root, and run the package inspector against the resulting archive.

- [ ] **Step 4: Reinstall the local DSH plugin**

Remove the currently installed Rolling Skill plugin from the DSH web profile, add the new `0.1.6` tarball, and verify the installed Client bundle hash matches the packed bundle.

- [ ] **Step 5: Verify in the in-app DSH browser**

Reload `http://127.0.0.1:3080/?rollingSkill=0.1.6`, inspect Case, Skill installation, evaluation, and optimization pages, and assert through computed styles that visible content actions have a border or primary fill, no action button has `scrollWidth > clientWidth` or `scrollHeight > clientHeight`, narrow panel-header actions do not stretch to the content width, and the console contains no errors.

- [ ] **Step 6: Record final status**

Append the fresh test, build, package, installed hash, and browser evidence to the active project record entry. Commit and push the record repository when possible without reading prior requirement logs.
