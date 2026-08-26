# Rolling Skill DeepSeek Harness Pluginization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Rolling Skill as one installable DeepSeek Harness bundle with a native bilingual workbench, a shared Node.js Core, and an OS-scheduled worker that can capture Cases while Harness is closed.

**Architecture:** Keep stable business modules in CommonJS behind a new `@rolling-skill/core` facade, then consume that facade from a Cordis Host bundle and a one-shot background Worker. The browser half registers one native `settings.section`, talks to the Host over a bounded same-origin JSON endpoint, and uses Harness locale/theme primitives. The published DSH package bundles the private Core so users install one package.

**Tech Stack:** Node.js 22, CommonJS Core, ESM Cordis Host, React + TypeScript Client, esbuild lazy-CJS client wrapper, DeepSeek Harness 0.1.1-rc.1, macOS LaunchAgent, Linux systemd user timers, Windows Task Scheduler, `node:test`, npm-compatible `.tgz` publishing.

---

## File map

```text
package.json                                      npm workspace/build entry
packages/rolling-skill-core/
  package.json                                    private Core manifest
  src/data-root.cjs                               stable data layout
  src/config-store.cjs                            plugin/background config
  src/run-lease.cjs                               Host/Worker slot lease
  src/application.cjs                             store/manager/runtime composition
  src/index.cjs                                   public Core facade
  test/*.test.cjs                                 focused Core tests
packages/rolling-skill-dsh/
  package.json                                    published one-package manifest
  cordis.patch.yml                                DSH bundle layer
  scripts/build.mjs                               Host/Worker/client bundle builder
  src/host/index.js                               Cordis Host lifecycle
  src/host/api.cjs                                bounded JSON method dispatch
  src/client/index.tsx                            settings.section registration
  src/client/api.ts                               typed fetch client
  src/client/locale.ts                            zh/en dictionaries
  src/client/workbench/*.tsx                      focused workbench panels
  src/worker/cli.cjs                              one-shot CLI entry
  src/worker/run.cjs                              due-slot execution
  src/scheduler/index.cjs                         platform adapter selection
  src/scheduler/launchd.cjs                       macOS LaunchAgent
  src/scheduler/systemd.cjs                       Linux user service/timer
  src/scheduler/task-scheduler.cjs                Windows scheduled task
  test/*.test.cjs                                 Host/client/worker/package tests
```

The initial facade imports stable modules from `desktop/rolling-skill/src`. After the DSH vertical slice works, pure modules move into `packages/rolling-skill-core/src/domain/` in responsibility-sized batches and Electron-only files remain on the archive branch. The published Host and Worker are bundled, so no installed package path points back into `desktop/`.

## Checkpoint A — installable bundle and native workbench

### Task 1: npm workspace and DSH bundle skeleton

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Create: `packages/rolling-skill-core/package.json`
- Create: `packages/rolling-skill-dsh/package.json`
- Create: `packages/rolling-skill-dsh/cordis.patch.yml`
- Create: `packages/rolling-skill-dsh/scripts/build.mjs`
- Create: `packages/rolling-skill-dsh/src/host/index.js`
- Create: `packages/rolling-skill-dsh/src/client/index.tsx`
- Create: `packages/rolling-skill-dsh/src/worker/cli.cjs`
- Create: `packages/rolling-skill-dsh/test/package-manifest.test.cjs`

- [ ] **Step 1: Write a failing manifest contract test**

Assert the public package exports Host, Client, Worker and its DSH declarations:

```js
const manifest = require("../package.json")
assert.equal(manifest.name, "@rolling-skill/dsh-plugin")
assert.equal(manifest.version, "0.1.0")
assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml")
assert.equal(manifest.dsh.client.platform, "web")
assert.equal(manifest.bin["rolling-skill-worker"], "./lib/worker.cjs")
assert.deepEqual(manifest.files.sort(), ["README.md", "cordis.patch.yml", "lib", "package.json"].sort())
```

- [ ] **Step 2: Run the test and verify the missing package failure**

Run: `node --test packages/rolling-skill-dsh/test/package-manifest.test.cjs`

Expected: FAIL because the package does not exist.

- [ ] **Step 3: Add workspace manifests and bundle patch**

The root manifest is private and has workspaces `packages/*`. The public manifest uses `type: module`, Host `./lib/index.js`, Client `./lib/client.js`, and a CommonJS Worker. Its client inject list is exactly:

```json
[
  "@deepseek-ai/dsh-client-runtime",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-settings",
  "@deepseek-ai/dsh-client-ui-primitives"
]
```

The package has a runtime dependency on `@deepseek-ai/dsh-tools` `^0.1.1-rc.1` for trusted model-facing Tool definitions and peer compatibility with `@deepseek-ai/cordis`, React, and the injected DSH client packages.

The patch adds one row without replacing existing UI:

```yaml
- insert:
    - id: rolling-skill
      name: '@rolling-skill/dsh-plugin'
      config:
        dataRoot: !!js dshHomePath('rolling-skill')
```

- [ ] **Step 4: Build Host, Worker, and lazy-CJS Client**

`scripts/build.mjs` calls esbuild three times. Task 1 supplies lifecycle-safe no-op entrypoints so the package format can be built before the real Host, Client, and Worker arrive in later tasks. The Client build uses `format: "cjs"`, externalizes React and injected DSH packages, and wraps output as:

```js
window.__ModuleLoader__.load({
  id: "@rolling-skill/dsh-plugin",
  factory: (require) => {
    const module = {exports: {}}
    const exports = module.exports
    // esbuild CJS body
    return module.exports
  },
})
```

Host and Worker use `platform: "node"`; Core is bundled, while DSH/Cordis packages are external.

- [ ] **Step 5: Install build dependencies, build the three stubs, run the focused test, and commit**

Run: `npm install`

Run: `npm run build --workspace @rolling-skill/dsh-plugin`

Run: `node --test packages/rolling-skill-dsh/test/package-manifest.test.cjs`

Expected: PASS and three files under `packages/rolling-skill-dsh/lib/`. `.gitignore` excludes workspace `node_modules` and local `dist/*.tgz`, but keeps source and lockfiles.

```bash
git add .gitignore package.json package-lock.json packages/rolling-skill-core/package.json packages/rolling-skill-dsh
git commit -m "feat: scaffold Rolling Skill DSH bundle"
```

### Task 2: Stable data root and plugin configuration

**Files:**
- Create: `packages/rolling-skill-core/src/data-root.cjs`
- Create: `packages/rolling-skill-core/src/config-store.cjs`
- Create: `packages/rolling-skill-core/test/data-root.test.cjs`
- Create: `packages/rolling-skill-core/test/config-store.test.cjs`

- [ ] **Step 1: Write failing path and config tests**

Cover explicit root precedence, default `~/.dsh/rolling-skill`, containment, permissions, atomic persistence, migration, daily/weekly validation, selected Runtime full path, and execution location:

```js
assert.equal(paths.root, join(home, ".dsh", "rolling-skill"))
assert.equal(store.read().executionLocation, "while-harness-running")
store.update({
  executionLocation: "always",
  runtime: {providerId: "deepseek-harness", runtimeId: "dsh:a", executablePath: "/opt/dsh"},
})
assert.equal(store.read().runtime.executablePath, "/opt/dsh")
```

- [ ] **Step 2: Run the focused failing tests**

Run: `node --test packages/rolling-skill-core/test/data-root.test.cjs packages/rolling-skill-core/test/config-store.test.cjs`

Expected: FAIL for missing modules.

- [ ] **Step 3: Implement deterministic layout and atomic config**

`resolveDataPaths({dataRoot, homeDirectory, environment})` returns frozen paths for evaluation store, Raw Case events, automatic state, managed skills, traces, jobs, logs, locks and scheduler files. `RollingSkillConfigStore` stores:

```js
{
  schemaVersion: "rolling-skill-plugin-config/v1",
  locale: "follow-harness",
  executionLocation: "while-harness-running",
  runtime: null,
  worker: {enabled: false, installed: false, platform: null, lastRegistrationError: null}
}
```

Reject relative executable paths, unknown providers, unsafe field names, invalid locale, and `always` without a Runtime selection.

- [ ] **Step 4: Run tests and commit**

Run: `node --test packages/rolling-skill-core/test/data-root.test.cjs packages/rolling-skill-core/test/config-store.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core/src packages/rolling-skill-core/test
git commit -m "feat: define DSH plugin data layout"
```

### Task 3: Shared Core application facade

**Files:**
- Create: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-core/src/index.cjs`
- Create: `packages/rolling-skill-core/test/application.test.cjs`

- [ ] **Step 1: Write a failing Core snapshot and dispatch test**

Use a temporary root. Assert one application instance creates stores, returns JSON-owned snapshots, creates a Dataset, adds/updates a Raw Case, updates automatic settings, and closes watchers:

```js
const app = createRollingSkillApplication({dataRoot})
const before = await app.dispatch("dashboard.get", {})
const created = await app.dispatch("datasets.create", {name: "DSH cases"})
await app.dispatch("rawCases.add", {
  question: "How do I refresh this Case?",
  skill: {name: "rolling-skill"},
  source: {kind: "manual"},
})
assert.equal((await app.dispatch("datasets.list", {})).some((item) => item.id === created.id), true)
await app.close()
```

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs`

Expected: FAIL because `createRollingSkillApplication` is absent.

- [ ] **Step 3: Compose existing stable stores behind one interface**

Instantiate `LocalEvaluationStore`, `RawCaseStore`, `AutomaticCaptureStateStore`, `ManagedSkillStore`, and the plugin config store with explicit paths. Export `snapshot()`, `dispatch(method, input)`, `subscribe(listener)`, and `close()`.

Initial exact methods are:

```js
const methods = {
  "dashboard.get": () => dashboardSnapshot(),
  "datasets.list": () => store.listDatasets(),
  "datasets.get": ({datasetId}) => ({...store.getDataset(datasetId), cases: store.listCases(datasetId)}),
  "datasets.create": (input) => store.createDataset(input),
  "rawCases.list": () => rawCaseStore.list(),
  "rawCases.add": (input) => rawCaseStore.add(input),
  "rawCases.update": ({id, changes}) => rawCaseStore.update(id, changes),
  "evaluations.list": ({datasetId = null}) => store.listEvaluationRunSummaries(datasetId),
  "settings.get": () => ({rollingSkill: store.read().settings, plugin: configStore.read()}),
  "settings.update": ({rollingSkill = {}, plugin = {}}) => updateSettings(rollingSkill, plugin),
}
```

Validate exact method names, plain JSON input, and a 1 MiB serialized envelope limit. Returned values must be deep copies.

- [ ] **Step 4: Run the focused test and commit**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core/src packages/rolling-skill-core/test/application.test.cjs
git commit -m "feat: expose shared Rolling Skill core"
```

### Task 4: Cordis Host lifecycle and bounded API

**Files:**
- Create: `packages/rolling-skill-dsh/src/host/api.cjs`
- Modify: `packages/rolling-skill-dsh/src/host/index.js`
- Create: `packages/rolling-skill-dsh/test/host-api.test.cjs`
- Create: `packages/rolling-skill-dsh/test/host-plugin.test.cjs`

- [ ] **Step 1: Write failing HTTP contract tests**

Cover POST-only, `application/json`, 1 MiB maximum, malformed body, unknown method, safe error projection, request abort and disposal. The success envelope is:

```json
{"ok":true,"value":{}}
```

The error envelope is:

```json
{"ok":false,"error":{"code":"INVALID_REQUEST","message":"Request is invalid"}}
```

- [ ] **Step 2: Run focused failing Host tests**

Run: `node --test packages/rolling-skill-dsh/test/host-api.test.cjs packages/rolling-skill-dsh/test/host-plugin.test.cjs`

Expected: FAIL for missing Host modules.

- [ ] **Step 3: Implement Host route and Cordis lifecycle**

Export:

```js
export const inject = ["webServer", "tools"]
export function apply(ctx, config = {}) {
  const app = createRollingSkillApplication({dataRoot: config.dataRoot})
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: "exact",
      path: "/rolling-skill/api",
      handler: createRollingSkillApiHandler(app),
    })
    return async () => {
      disposeRoute()
      await app.close()
    }
  }, "rolling-skill: host service")
}
```

The API refuses cross-origin writes when `Origin` is present and does not match the request authority. Do not expose filesystem paths except the deliberately selected Runtime executable path and user data display path.

- [ ] **Step 4: Run tests, build, and commit**

Run: `node --test packages/rolling-skill-dsh/test/host-api.test.cjs packages/rolling-skill-dsh/test/host-plugin.test.cjs`

Run: `npm run build --workspace @rolling-skill/dsh-plugin`

Expected: tests PASS and `lib/index.js`, `lib/client.js`, `lib/worker.cjs` exist.

```bash
git add packages/rolling-skill-dsh
git commit -m "feat: host Rolling Skill inside DSH"
```

### Task 5: Native bilingual Settings Section

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/api.ts`
- Create: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/index.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Create: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing source-contract tests**

Assert the Client registers `settings.section` with `id: "rolling-skill"`, never replaces `sidebar`, registers `zh` and `en`, uses `/rolling-skill/api`, has no Electron/iframe/open calls, and uses CSS variables instead of fixed page colors.

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because Client sources are absent.

- [ ] **Step 3: Implement locale binding and registration**

Register namespace `rolling-skill` with complete zh/en keys. Client `apply(ctx)` retrieves `slots` and `locale`, binds `t`, and registers:

```tsx
ctx.slots.inject("settings.section", () => ctx.slots.register({
  name: "settings.section",
  id: "rolling-skill",
  order: 20,
  label: () => t("nav"),
  locale: "rolling-skill",
}, RollingSkillWorkbench))
```

React effects must abort stale fetches. The initial page shows overview counts, next/last automatic run, data directory, Runtime selection summary, and navigation tabs for the later panels.

- [ ] **Step 4: Build and assert the DSH lazy-CJS wrapper**

Run: `npm run build --workspace @rolling-skill/dsh-plugin`

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-dsh/test/package-manifest.test.cjs`

Expected: PASS and `lib/client.js` begins with `window.__ModuleLoader__.load`.

- [ ] **Step 5: Commit checkpoint A**

```bash
git add packages/rolling-skill-dsh/src/client packages/rolling-skill-dsh/test packages/rolling-skill-dsh/lib
git commit -m "feat: add native Rolling Skill DSH workbench"
```

## Checkpoint B — Core feature parity

### Task 6: Dataset, Case, Raw Case, and refresh APIs

**Files:**
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-core/src/case-services.cjs`
- Create: `packages/rolling-skill-core/test/case-services.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/CasesPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`

- [ ] **Step 1: Write failing API tests**

Cover pagination, complete Case detail, Dataset create/delete preflight, Case delete/recycle, single refresh start, batch refresh eligibility and Raw Case update/dispatch. Reuse `CaseRecycleService` and `CaseRefreshManager`; do not duplicate their safety rules.

- [ ] **Step 2: Run focused failing tests**

Run: `node --test packages/rolling-skill-core/test/case-services.test.cjs`

Expected: FAIL for missing service methods.

- [ ] **Step 3: Implement exact methods**

Add `cases.list`, `cases.get`, `cases.delete`, `cases.refresh`, `cases.refreshBatch`, `datasets.delete`, `datasets.exportCsv`, `rawCases.dispatch` and `rawCases.recycle`. Mutations accept an idempotency key and compare expected revision/update time before replacing state.

- [ ] **Step 4: Build native panels**

Panels use the shared API client, Harness form controls and compact tables/cards. Case type, question, current answer, refresh state and last update are visible. Delete actions remain neutral until the confirmation panel; recovery choice precedes deletion.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test packages/rolling-skill-core/test/case-services.test.cjs desktop/rolling-skill/test/case-refresh-manager.test.cjs desktop/rolling-skill/test/case-recycle-service.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench
git commit -m "feat: port Rolling Skill case lifecycle"
```

### Task 7: Runtime inventory and evaluation services

**Files:**
- Create: `packages/rolling-skill-core/src/runtime-services.cjs`
- Create: `packages/rolling-skill-core/src/evaluation-services.cjs`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-core/test/runtime-services.test.cjs`
- Create: `packages/rolling-skill-core/test/evaluation-services.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx`

- [ ] **Step 1: Write failing Runtime and evaluation API tests**

Assert Codex, CodeBuddy and every installed DSH executable remain separate Runtime IDs. Public labels include display name, full version and full executable path. Cover model listing, one evaluation start, live summary polling, cancel and completed detail.

- [ ] **Step 2: Run focused failing tests**

Run: `node --test packages/rolling-skill-core/test/runtime-services.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs`

Expected: FAIL for missing services.

- [ ] **Step 3: Compose RuntimeRegistry and EvaluationRunner**

Use existing providers and runner. Methods are `runtimes.list`, `runtimes.models`, `evaluations.start`, `evaluations.list`, `evaluations.get`, and `evaluations.cancel`. Runtime executable paths are Host-owned; Client sends only `runtimeId`, model, effort and permission mode.

- [ ] **Step 4: Build the evaluation panel**

Reuse one Runtime row component for evaluation, installation, automatic capture and operator pages. Each row renders `displayName version` on the primary line and the full executable path beneath it. Start/cancel buttons and result grades follow Harness theme tokens.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test packages/rolling-skill-core/test/runtime-services.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs desktop/rolling-skill/test/evaluation-runner.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx
git commit -m "feat: port multi-runtime evaluations to DSH"
```

### Task 8: Managed Skill and installation services

**Files:**
- Create: `packages/rolling-skill-core/src/skill-services.cjs`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-core/test/skill-services.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx`

- [ ] **Step 1: Write failing Skill API tests**

Cover repository list/detail, Skill versions, candidate/release, installation targets, installation start/cancel/inspect and immutable released source identity. Preserve the current rule that Runtime Agent performs installation through Bash and Runtime owns approval prompts.

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-core/test/skill-services.test.cjs`

Expected: FAIL for missing service.

- [ ] **Step 3: Compose existing managers and add the Client panel**

`ManagedSkillManager`, `ManagedSkillStore`, `SkillInstallationManager`, and `SkillInstallationStore` stay authoritative. The panel separates release from installation and reuses the Runtime row from Task 7.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test packages/rolling-skill-core/test/skill-services.test.cjs desktop/rolling-skill/test/managed-skill-manager.test.cjs desktop/rolling-skill/test/skill-installation-manager.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx
git commit -m "feat: port managed Skills to DSH"
```

### Task 9: Operator and optimization services

**Files:**
- Create: `packages/rolling-skill-core/src/operator-services.cjs`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Create: `packages/rolling-skill-core/test/operator-services.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`

- [ ] **Step 1: Write failing job and recovery tests**

Cover start, status, pause, resume, cancel, approval, restart recovery and public summaries. Verify the DSH UI cannot choose executable paths or bypass Core capabilities.

- [ ] **Step 2: Run focused failing tests**

Run: `node --test packages/rolling-skill-core/test/operator-services.test.cjs`

Expected: FAIL for missing service.

- [ ] **Step 3: Compose the existing job/optimization engines**

Reuse `ControlPlane`, `OperatorJobStore`, `OperatorJobEngine`, `OptimizationStore`, `OptimizationRunner`, and current policy/capability rules. Expose DTOs only; never return capability secrets, sockets, full reasoning or raw environment values.

- [ ] **Step 4: Build native panels and run tests**

The Operator panel uses the same page header, panels and Runtime rows as evaluation. Optimization status and approvals use existing state transitions and compact traces.

Run: `node --test packages/rolling-skill-core/test/operator-services.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs desktop/rolling-skill/test/optimization-runner.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit checkpoint B**

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench
git commit -m "feat: port operator workbench to DSH"
```

### Task 10: Model-facing Rolling Skill tools

**Files:**
- Create: `packages/rolling-skill-dsh/src/host/tools.js`
- Modify: `packages/rolling-skill-dsh/src/host/index.js`
- Create: `packages/rolling-skill-dsh/test/host-tools.test.cjs`

- [ ] **Step 1: Write failing Tool registration and execution tests**

Use an injected Tool registry and Core application. Assert the exact names `rolling_skill_status`, `rolling_skill_add_raw_case`, `rolling_skill_start_evaluation`, and `rolling_skill_run_capture`; schemas reject unknown fields, outputs are JSON-owned, write tools honor cancellation, and errors do not expose absolute internal paths or credentials.

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-dsh/test/host-tools.test.cjs`

Expected: FAIL because the Tool definitions are absent.

- [ ] **Step 3: Register trusted tools through `ctx.tools`**

Build each definition with `defineTool()`, declare exact input/output schemas, and delegate execution to `application.dispatch()`:

```js
ctx.tools.register(defineTool({
  name: "rolling_skill_status",
  description: "Read Rolling Skill dataset, Case, evaluation, and automatic-capture status.",
  parameters: {},
  output: statusOutput,
  execute: async () => application.dispatch("dashboard.get", {}),
}))
```

Mutating tools pass a generated idempotency key and `exec.signal`. Tool `render` returns short text summaries; complete records stay in the canonical JSON value rather than model-facing prose.

- [ ] **Step 4: Run focused tests and commit checkpoint B**

Run: `node --test packages/rolling-skill-dsh/test/host-tools.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/host packages/rolling-skill-dsh/test/host-tools.test.cjs
git commit -m "feat: expose Rolling Skill tools in DSH"
```

## Checkpoint C — completely automatic mode and distribution

### Task 11: Cross-process lease and one-shot Worker

**Files:**
- Create: `packages/rolling-skill-core/src/run-lease.cjs`
- Create: `packages/rolling-skill-core/test/run-lease.test.cjs`
- Create: `packages/rolling-skill-dsh/src/worker/run.cjs`
- Modify: `packages/rolling-skill-dsh/src/worker/cli.cjs`
- Create: `packages/rolling-skill-dsh/test/worker.test.cjs`

- [ ] **Step 1: Write failing lease and Worker tests**

Cover exclusive create, live owner rejection, stale lease recovery, same-slot completion, due slot, disabled mode, failure without slot completion, signal shutdown and bounded status logs.

```js
const first = await acquireRunLease(paths.locks, {slot: "2026-08-26T09:00:00.000Z"})
await assert.rejects(() => acquireRunLease(paths.locks, {slot: first.slot}), {code: "LEASE_BUSY"})
await first.release()
```

- [ ] **Step 2: Run focused failing tests**

Run: `node --test packages/rolling-skill-core/test/run-lease.test.cjs packages/rolling-skill-dsh/test/worker.test.cjs`

Expected: FAIL for missing modules.

- [ ] **Step 3: Implement one-shot execution**

Worker parses only `--data-root` and `--slot`; unknown options fail. It loads the selected Runtime descriptor from Host-owned config, acquires the lease, creates the shared application in Worker mode, calls `runDueAutomaticCapture({slot})`, records status and exits. DeepSeek Harness subprocess arguments are exactly `--profile web --no-open --port 0`.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test packages/rolling-skill-core/test/run-lease.test.cjs packages/rolling-skill-dsh/test/worker.test.cjs desktop/rolling-skill/test/automatic-capture.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/worker packages/rolling-skill-dsh/test/worker.test.cjs
git commit -m "feat: run automatic capture outside Harness"
```

### Task 12: Automatic capture composition for Host and Worker

**Files:**
- Create: `packages/rolling-skill-core/src/automatic-capture-service.cjs`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/src/config-store.cjs`
- Create: `packages/rolling-skill-core/test/automatic-capture-service.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/AutomaticCapturePanel.tsx`

- [ ] **Step 1: Write failing composition tests**

Cover `off`, `scheduled`, `automatic`, `while-harness-running`, `always`, daily/weekly slots, Raw Case-before-cursor ordering, automatic save gates, Runtime unavailable, and Host not scheduling when OS Worker owns triggers.

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-core/test/automatic-capture-service.test.cjs`

Expected: FAIL for missing composition.

- [ ] **Step 3: Compose existing manager with shared dependencies**

Create Runtime client, `CurationManager`, and `ConversationDiscoveryManager` from the same stores. Wire `onChanged` back to `handleCurationChanged`. `runDueAutomaticCapture()` executes one slot; `startHostSchedule()` starts timers only for `while-harness-running`.

- [ ] **Step 4: Build automatic settings/status UI**

Expose business mode, execution location, daily/weekly schedule, Runtime/model/effort/dataset, next run, last success/error, scheduler state and a manual “run once” action. Enabling `always` requires a selected Runtime and explicit user action.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-core/test/automatic-capture-service.test.cjs desktop/rolling-skill/test/automatic-capture.test.cjs desktop/rolling-skill/test/conversation-discovery.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench/AutomaticCapturePanel.tsx
git commit -m "feat: configure completely automatic capture"
```

### Task 13: macOS, Linux, and Windows scheduler adapters

**Files:**
- Create: `packages/rolling-skill-dsh/src/scheduler/index.cjs`
- Create: `packages/rolling-skill-dsh/src/scheduler/launchd.cjs`
- Create: `packages/rolling-skill-dsh/src/scheduler/systemd.cjs`
- Create: `packages/rolling-skill-dsh/src/scheduler/task-scheduler.cjs`
- Create: `packages/rolling-skill-dsh/test/scheduler.test.cjs`

- [ ] **Step 1: Write failing pure rendering and command tests**

Inject filesystem and process execution. Assert exact LaunchAgent plist, systemd service/timer, and `schtasks.exe` arguments for daily and weekly schedules. Verify full paths are XML/argument escaped, no shell interpolation is used, and uninstall touches only the exact Rolling Skill identifier.

- [ ] **Step 2: Run the focused failing test**

Run: `node --test packages/rolling-skill-dsh/test/scheduler.test.cjs`

Expected: FAIL for missing adapters.

- [ ] **Step 3: Implement platform adapters**

Use stable identifier `com.rolling-skill.dsh.capture`. LaunchAgent uses `StartCalendarInterval`; systemd uses `OnCalendar`; Windows uses `/SC DAILY` or `/SC WEEKLY`. The command path is the real profile-level `node_modules/.bin/rolling-skill-worker`, not a pnpm store target. Each adapter exposes `capabilities()`, `install(schedule)`, `status()` and `uninstall()`.

- [ ] **Step 4: Wire explicit scheduler mutations through Host API**

`scheduler.enable` writes files/registers only after the Client action. On failure, keep business mode unchanged, set `worker.installed: false`, and persist a bounded error. `scheduler.disable` removes the exact unit/task and keeps all Case data.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/scheduler.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/scheduler packages/rolling-skill-dsh/test/scheduler.test.cjs packages/rolling-skill-dsh/src/host
git commit -m "feat: schedule background Rolling Skill capture"
```

### Task 14: Legacy import and package-safe data lifecycle

**Files:**
- Create: `packages/rolling-skill-core/src/legacy-import.cjs`
- Create: `packages/rolling-skill-core/test/legacy-import.test.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/ImportPanel.tsx`
- Create: `packages/rolling-skill-dsh/test/uninstall-contract.test.cjs`

- [ ] **Step 1: Write failing import and uninstall tests**

Cover macOS Electron source detection, copy-only import, schema validation, destination conflict, partial failure rollback, recorded provenance, second-run no-op, and package files containing no delete-data hook.

- [ ] **Step 2: Run focused failing tests**

Run: `node --test packages/rolling-skill-core/test/legacy-import.test.cjs packages/rolling-skill-dsh/test/uninstall-contract.test.cjs`

Expected: FAIL for missing importer.

- [ ] **Step 3: Implement explicit import**

Import only after a UI confirmation. Copy evaluation state, Raw Case log, managed Skill registry/repositories, traces and job records into a staging directory; validate known schema roots; atomically rename into an empty DSH data root; write `migration.json`. Never delete or mutate the Electron source.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test packages/rolling-skill-core/test/legacy-import.test.cjs packages/rolling-skill-dsh/test/uninstall-contract.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core packages/rolling-skill-dsh/src/client/workbench/ImportPanel.tsx packages/rolling-skill-dsh/test/uninstall-contract.test.cjs
git commit -m "feat: import archived Rolling Skill data"
```

### Task 15: npm/tgz distribution and one focused local install

**Files:**
- Create: `packages/rolling-skill-dsh/README.md`
- Create: `packages/rolling-skill-dsh/scripts/inspect-package.mjs`
- Modify: `packages/rolling-skill-dsh/package.json`
- Modify: `README.md`

- [ ] **Step 1: Write the distribution contract**

README documents public npm, Tencent npm registry, HTTPS `.tgz`, update, uninstall, retained data, scheduler removal and compatibility. `inspect-package.mjs` rejects absolute developer paths, Electron artifacts, credentials, source maps containing workspace paths, absent Client wrapper, or files outside the manifest allowlist.

- [ ] **Step 2: Build and pack once**

Run: `npm install`

Run: `npm run build --workspace @rolling-skill/dsh-plugin`

Run: `npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist`

Expected: one `rolling-skill-dsh-plugin-0.1.0.tgz` containing only manifest files.

- [ ] **Step 3: Inspect the tarball**

Run: `node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz`

Expected: `package inspection passed`.

- [ ] **Step 4: Install into the existing local web profile**

Run from the repository root:

```bash
dsh plugin --profile web add ./packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
```

Expected: `@rolling-skill/dsh-plugin` appears in `~/.dsh/profiles/web/package.json` dependencies and `dsh.profile.bundles`.

- [ ] **Step 5: Perform one UI launch check**

Launch `dsh web --no-open`, open its existing Harness page once, verify Settings contains Rolling Skill in Chinese, change Harness language to English and verify the same section switches, then stop the process. Do not repeat the launch or run the Electron App.

- [ ] **Step 6: Commit checkpoint C**

```bash
git add README.md package.json package-lock.json packages/rolling-skill-core packages/rolling-skill-dsh
git commit -m "build: package Rolling Skill DSH plugin"
```

## Completion evidence

Run only these final focused checks after Task 15; do not repeat earlier suites:

```bash
node --test packages/rolling-skill-core/test/*.test.cjs packages/rolling-skill-dsh/test/*.test.cjs
npm run build --workspace @rolling-skill/dsh-plugin
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz
```

Record the installed package version, profile path, data path, scheduler status and tarball path in the final handoff. Update the external project record with the final commit id and push it without reading the accumulated requirement log.
