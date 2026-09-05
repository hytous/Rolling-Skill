# Operator Title and Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show concise Chinese optimization titles throughout Rolling Skill and make all in-session action buttons visually consistent.

**Architecture:** Preserve the English objective as the Agent instruction and introduce one renderer title selector that prefers persisted session configuration. Persist the managed Skill name in the trusted frozen baseline for new runs, while retaining fallbacks for existing snapshots, and apply one shared CSS component with primary and danger variants to all conversation controls.

**Tech Stack:** Electron, CommonJS JavaScript, HTML/CSS, Node.js built-in test runner

---

### Task 1: Renderer title selection

**Files:**
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`

- [ ] **Step 1: Write the failing title-priority tests**

Add tests importing `operatorJobTitle` and assert that the flattened Job Store transcript form and the legacy nested `payload` form both return the configured Chinese title, while a snapshot without configuration returns `job.objective` and then `job.id`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/operator-workbench.test.cjs`

Expected: FAIL because `operatorJobTitle` is not exported or defined.

- [ ] **Step 3: Implement one renderer title selector**

Add `operatorJobTitle(snapshot, managedSkills)` that searches configuration entries from newest to oldest, accepts both flattened and nested configuration payloads, resolves legacy root-Skill titles containing `.` by stable Skill id, trims a non-empty title, and falls back to objective then id. Export it and replace both direct `snapshot.job.objective || ...` render sites.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test test/operator-workbench.test.cjs`

Expected: PASS.

### Task 2: Trusted Skill display name

**Files:**
- Modify: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-contract.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`

- [ ] **Step 1: Write the failing root-Skill title test**

Make the service fixture freeze a baseline with `skillRoot: "."` and `skillName: "billing-cost-management"`, then expect the launched Operator title to be `Skill 自动优化 · billing-cost-management · optimization-run-1`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/optimization-control-service.test.cjs`

Expected: FAIL because title derivation currently selects `.`.

- [ ] **Step 3: Preserve the real Skill name in trusted frozen state**

Allow optional `skillName` in `baselineSnapshot`, validate it with the existing bounded text helper, return it from `resolveOptimizationPreflight`, and prefer it in `optimizationTaskTitle`. Retain non-dot skillRoot and skillId fallbacks so existing frozen runs remain readable.

- [ ] **Step 4: Run contract and service tests and verify GREEN**

Run: `node --test test/optimization-contract.test.cjs test/optimization-control-service.test.cjs test/main-bridge.test.cjs`

Expected: PASS.

### Task 3: Shared action-button component

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`

- [ ] **Step 1: Write failing static UI assertions**

Assert that the send button contains `operator-action-button primary`, dynamic session and optimization controls use `operator-action-button`, stop controls use an `operator-action-danger` variant, and CSS defines common base, primary, disabled, focus-visible, and hover-only danger states.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/local-first-surface.test.cjs`

Expected: FAIL because the shared action-button component does not exist.

- [ ] **Step 3: Apply the shared classes and styles**

Update static and dynamic button creation to use the shared base class, give send/approve the primary variant, give stop/reject the danger variant, and replace the old isolated composer/control styles with one compact theme-aware component.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/local-first-surface.test.cjs test/operator-workbench.test.cjs`

Expected: PASS.

### Task 4: Regression verification, install, and delivery

**Files:**
- Modify if required by observed failures: only files listed in Tasks 1–3

- [ ] **Step 1: Run the desktop verification suite**

Run: `node --test test/operator-workbench.test.cjs test/optimization-control-service.test.cjs test/optimization-contract.test.cjs test/main-bridge.test.cjs test/local-first-surface.test.cjs && npm run smoke:renderer && npm test && npm run build:tool && git diff --check`

Expected: every command exits 0.

- [ ] **Step 2: Build and reinstall the macOS app**

Run: `bash desktop/rolling-skill/scripts/build-macos-app.sh`, move the existing `/Applications/Rolling Skill.app` to a unique `/tmp` backup, install the new build with `ditto`, verify it with `codesign --verify --deep --strict`, and launch it.

Expected: build, signature validation, and launch all succeed.

- [ ] **Step 3: Verify the user-visible result**

Open 自操作 and confirm the list title and conversation title use the concise configured title, no root Skill title contains ` · . · `, and the send/pause/stop/report controls share dimensions and visual states.

- [ ] **Step 4: Commit and push without archives**

Stage only the files listed by this plan, run `git diff --cached --name-only` and assert no `.tgz` appears, commit with `fix: align operator titles and actions`, and push `main` to remote `rolling-skill`.

Expected: push succeeds and all repository-root `.tgz` files remain untracked.
