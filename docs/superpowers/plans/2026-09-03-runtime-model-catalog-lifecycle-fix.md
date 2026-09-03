# Runtime Model Catalog Lifecycle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the self-operation workbench from stopping a temporary Runtime before its model catalog request settles.

**Architecture:** Preserve the existing temporary-client boundary in `main.cjs`; change only the promise ordering so `finally` owns cleanup after catalog settlement. Exercise the real main-process helper through the existing VM-based bridge test harness, then build and reinstall the signed macOS App.

**Tech Stack:** Electron, CommonJS, Node.js `node:test`, electron-builder, macOS codesign.

---

### Task 1: Reproduce the temporary-client shutdown race

**Files:**
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Test: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("desktop main/preload bridge", ...)`:

```js
it("keeps a temporary Runtime alive until its model catalog request settles", async () => {
    let resolveModels
    const calls = []
    const models = new Promise((resolve) => { resolveModels = resolve })
    const temporaryClient = {
        async start() { calls.push("start") },
        listModels() {
            calls.push("listModels")
            return models
        },
        async stop() { calls.push("stop") },
    }
    const context = mainFunctionContext(
        "listModelsForRuntimeFromControl",
        "controlScopeIds",
        {
            app: {getPath: () => "/tmp/rolling-skill-test"},
            availableRuntimes: [{runtimeId: "runtime-secondary"}],
            currentExecutionPolicy: () => ({}),
            join,
            requireIdentifier: (value) => String(value),
            runtimeDescriptor: {runtimeId: "runtime-active"},
            runtimeRegistry: {createClient: () => temporaryClient},
            workspaceRoot: "/workspace/project",
        },
    )

    const pending = context.listModelsForRuntimeFromControl("runtime-secondary")
    await new Promise((resolve) => setImmediate(resolve))

    assert.deepEqual(calls, ["start", "listModels"])
    resolveModels({data: [{id: "model-1"}]})
    assert.deepEqual(plain(await pending), {data: [{id: "model-1"}]})
    assert.deepEqual(calls, ["start", "listModels", "stop"])
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd desktop/rolling-skill
node --test --test-name-pattern='keeps a temporary Runtime alive' test/main-bridge.test.cjs
```

Expected: FAIL because `calls` already contains `"stop"` before `resolveModels(...)`.

### Task 2: Correct the catalog request lifecycle

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs:1328`
- Test: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Await the temporary model request**

Change the temporary-client return expression to:

```js
return typeof temporaryClient.listModels === "function"
    ? await temporaryClient.listModels()
    : {data: [], nextCursor: null}
```

This guarantees that `finally` calls `stop()` only after fulfillment or rejection.

- [ ] **Step 2: Run the focused test and verify GREEN**

Run:

```bash
cd desktop/rolling-skill
node --test --test-name-pattern='keeps a temporary Runtime alive' test/main-bridge.test.cjs
```

Expected: PASS with zero failures.

- [ ] **Step 3: Check the patch**

Run:

```bash
git diff --check
git diff -- desktop/rolling-skill/src/main.cjs desktop/rolling-skill/test/main-bridge.test.cjs
```

Expected: no whitespace errors; only the lifecycle await and focused regression test are present.

- [ ] **Step 4: Commit the fix**

```bash
git add desktop/rolling-skill/src/main.cjs desktop/rolling-skill/test/main-bridge.test.cjs docs/superpowers/plans/2026-09-03-runtime-model-catalog-lifecycle-fix.md
git commit -m "fix: await Runtime model catalogs before shutdown"
```

### Task 3: Build, install, and verify the App

**Files:**
- Generated locally: `Rolling Skill.app`
- Install target: `/Applications/Rolling Skill.app`

- [ ] **Step 1: Run the renderer smoke check**

Run:

```bash
cd desktop/rolling-skill
npm run smoke:renderer
```

Expected: exit code 0.

- [ ] **Step 2: Run the full desktop verification and signed App build once**

Run from the repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

Expected: `npm test`, the external tool build, electron-builder, codesign, and plist validation all exit successfully and produce `Rolling Skill.app` at the repository root. Do not stage generated `.tgz` archives.

- [ ] **Step 3: Replace the installed App safely**

Quit the running App, copy the existing installation to a uniquely named `/tmp` backup, replace only `/Applications/Rolling Skill.app` with the newly built bundle, then relaunch it. Confirm the installed `app.asar` contains the same `src/main.cjs` digest as the working tree.

- [ ] **Step 4: Verify the user journey**

Open the self-operation workbench and wait for all Runtime model catalogs to settle. Confirm there is no global “Task could not continue / Codex app-server exited with code 0” banner, the workbench remains usable, and no Operator Job is created merely by opening the page.

- [ ] **Step 5: Push the committed changes**

Run:

```bash
git push rolling-skill main
```

Expected: remote `main` advances to the local fix commit; no `rolling-skill-dsh-plugin-*.tgz` file is included.
