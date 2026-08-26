# Electron Managed Skill Dataset Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the stable managed Dataset model to the archived Electron application, update Renderer/Main Process flows, and produce a locally installed macOS App without merging the archive branch into `main`.

**Architecture:** Reuse the tested shared store, installation-resolution, and per-Runtime evaluation changes from `main`. Electron Renderer submits only managed IDs and a Released version ID; Main Process resolves canonical Skill/version/install records and owns legacy migration. Existing Runtime inventory references remain execution or Case provenance, never Dataset identity.

**Tech Stack:** Electron, Node.js 22, CommonJS Main Process, vanilla Renderer JavaScript, `node:test`, electron-builder, macOS code signing.

---

## Task 1: Switch to the archived Electron line and port the shared domain commits

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/src/skill-installation-store.cjs`
- Modify: `desktop/rolling-skill/src/evaluation-runner.cjs`
- Modify: corresponding focused tests under `desktop/rolling-skill/test/`

- [ ] **Step 1: Verify main is clean except the user-owned untracked file**

Run: `git status --short`

Expected: no uncommitted implementation files; `openspec/config.yaml` may remain untracked.

- [ ] **Step 2: Switch the current checkout to the existing archive branch**

Run: `git switch archive/electron-before-dsh-plugin-20260826`

Do not create a new branch, worktree, or sub-Agent.

- [ ] **Step 3: Port only reusable domain commits**

Cherry-pick the dedicated managed-reference/installation commit from `main`. If the evaluation-runner change is in a mixed DSH commit, apply only the shared Electron files and their tests, then commit the focused port. Do not bring DSH packages or docs into the archive branch unless already present by ancestry.

- [ ] **Step 4: Run shared focused tests**

Run: `node --test desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs desktop/rolling-skill/test/skill-installation-store.test.cjs desktop/rolling-skill/test/evaluation-runner.test.cjs desktop/rolling-skill/test/evaluation-skill-binding.test.cjs desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

Expected: PASS before Electron-specific UI wiring begins.

## Task 2: Make Main Process own managed Dataset creation and migration

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-store.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-plane.test.cjs`

- [ ] **Step 1: Write failing IPC tests**

Assert `datasets:create` and `datasets:bind-skill` accept stable managed IDs, resolve the canonical managed Skill server-side, and store no path/Runtime/version. Assert unknown IDs and Renderer-supplied deployment evidence are rejected or ignored. Add startup migration coverage for the incident Dataset shape.

- [ ] **Step 2: Run focused IPC tests and confirm RED**

Run: `node --test desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs desktop/rolling-skill/test/optimization-control-plane.test.cjs`

Expected: FAIL because current IPC binds a Runtime inventory path.

- [ ] **Step 3: Implement managed Dataset IPC**

Resolve `{repositoryId, skillId}` against `ManagedSkillStore` in Main Process and construct managed precision. Preserve explicit rebind semantics: rebinding to different IDs clears active Rubric under existing session guards; an automatic legacy-to-managed migration preserves it.

- [ ] **Step 4: Reconcile legacy Datasets after stores load**

Use trustworthy installation records to uniquely convert path bindings. Convert already-ID-complete legacy records directly. Keep zero/multiple/name-only results unchanged and expose their unbound state to Renderer. Never modify historical Case, Curator, Rubric, or Evaluation evidence.

- [ ] **Step 5: Rerun focused tests**

Run: `node --test desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs desktop/rolling-skill/test/optimization-control-plane.test.cjs`

Expected: PASS.

## Task 3: Resolve Released versions and target Runtime installations in Electron evaluation

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-runner.test.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-skill-binding.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing evaluation bridge tests**

Assert an ordinary evaluation requires a Released `versionId`, rejects a version owned by another Skill, and refuses a target Runtime without an exact trustworthy installation. With two target Runtimes and two destinations, assert the run freezes and executes each independently.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/evaluation-runner.test.cjs desktop/rolling-skill/test/evaluation-skill-binding.test.cjs desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

Expected: FAIL under shared Dataset-path execution.

- [ ] **Step 3: Implement Main Process evaluation resolution**

Load Dataset managed IDs, validate the requested Released version, resolve one trusted normal installation for each target descriptor, snapshot the managed commit, and create the managed Evaluation Run with per-Runtime configurations. Renderer must not pass destinations, providers, digests, commits, or Job IDs.

- [ ] **Step 4: Keep optimization Candidate execution compatible**

Populate candidate run configurations from trusted experiment installation Job results so the shared runner always receives a target-specific path. Continue validating baseline Version and Dataset by stable IDs.

- [ ] **Step 5: Rerun evaluation tests**

Run: `node --test desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/evaluation-runner.test.cjs desktop/rolling-skill/test/evaluation-skill-binding.test.cjs desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

Expected: PASS.

## Task 4: Update Electron Dataset and Evaluation interfaces

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/app.js`
- Modify: `desktop/rolling-skill/renderer/styles.css` only if needed for existing component alignment
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-store.test.cjs`

- [ ] **Step 1: Write failing Renderer source contracts**

Assert the Dataset form renders a managed Skill selector rather than a Runtime-inventory path selector. Assert Evaluation renders a Released version selector and Runtime installation status, sends `versionId`, and never sends path/commit/digest.

- [ ] **Step 2: Run Renderer tests and confirm RED**

Run: `node --test desktop/rolling-skill/test/local-first-surface.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: FAIL against the current Runtime-bound form.

- [ ] **Step 3: Implement Dataset managed-Skill selection**

Use the existing managed Skill catalog. Create and rebind requests send only stable IDs. Display legacy/unbound status with an explicit rebind action. Do not require a Runtime installation merely to create a Dataset.

- [ ] **Step 4: Implement evaluation Version and installation status**

Load versions for the selected Dataset Skill, allow Released versions only, and show exact per-target installation readiness. Disable start until every selected target is ready, with a clear route to the installation UI.

- [ ] **Step 5: Preserve Case provenance behavior**

When capturing or refreshing a Case from a Runtime conversation, validate that the observed Runtime Skill maps to the Dataset's managed IDs, then freeze the observed Runtime/path evidence on the Case/session only.

- [ ] **Step 6: Rerun Renderer and bridge tests**

Run: `node --test desktop/rolling-skill/test/local-first-surface.test.cjs desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: PASS.

- [ ] **Step 7: Commit Electron integration**

```bash
git add desktop/rolling-skill/src desktop/rolling-skill/renderer desktop/rolling-skill/test
git commit -m "fix: bind Electron datasets to managed skills"
```

## Task 5: Verify the Electron branch and incident regression

- [ ] **Step 1: Run the complete Electron test suite**

Run from `desktop/rolling-skill`: `npm test`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Run targeted incident data regression safely**

Copy the old `evaluation-store.json`, managed store, and installation store to a temporary directory. Start stores against the copies, run reconciliation, and assert Dataset `3331958b...` becomes managed `repositoryId: 42cad4f2...`, `skillId: f32e251d...` while its Cases, active Rubric `b6da...`, and historical runs are byte-equivalent in content. Never mutate the live archived App data during this diagnostic.

- [ ] **Step 3: Verify optimization preflight**

Using the temporary migrated store, assert the incident Dataset and its Released baseline pass stable-ID preflight; verify ambiguous and missing-install fixtures remain blocked.

## Task 6: Build, install, sign-check, and inspect the App

**Files:**
- Generated/replaced: `Rolling Skill.app`
- Generated/replaced: `rolling-skill-tool`

- [ ] **Step 1: Build through the repository installation script**

Run: `desktop/rolling-skill/scripts/build-macos-app.sh`

Expected: electron-builder creates the arm64 App, signs it with the configured local identity, and installs the new App plus Tool at repository root. Any previous root App is moved to a recoverable backup location before replacement.

- [ ] **Step 2: Verify signing and packaged code**

Run: `codesign --verify --deep --strict --verbose=2 "Rolling Skill.app"`

Inspect packaged `app.asar` or its file list to confirm the managed Dataset and per-Runtime evaluation changes are present.

- [ ] **Step 3: Launch exactly the installed App once**

Terminate only an existing process whose executable exactly resolves to the repository-root `Rolling Skill.app/Contents/MacOS/Rolling Skill`, then run `open -n "/Users/wangbaoheng/Downloads/billing-cli/agenta/Rolling Skill.app"`.

- [ ] **Step 4: Inspect the real Electron flow**

Confirm Dataset creation binds a managed Skill without a Runtime path, Evaluation requires a Released version, two Runtime targets show independent installation readiness, the incident Dataset retains its Cases/Rubric after migration, and optimization preflight accepts it. Quit after this single inspection.

- [ ] **Step 5: Final verification and push archive branch**

Run: `git diff --check`

Run: `git status --short`

Commit the tracked built App/Tool only if this branch's established workflow tracks them, then push `archive/electron-before-dsh-plugin-20260826`. Do not merge it into `main` and do not touch the user-owned `openspec/config.yaml`.
