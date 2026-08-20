# Runtime-Driven Skill Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users install one immutable Released Skill version into Codex, CodeBuddy, and DeepSeek Harness through independent Runtime Agent sessions, with interactive permission decisions, validated structured results, persistent history, and a Runtime installation matrix.

**Architecture:** Add three focused main-process modules: a provider-neutral prompt/result protocol, an atomic installation registry, and an installation task manager that owns independent Runtime clients. Existing provider adapters remain responsible only for thread/turn/permission/Trace transport; the Runtime Agent performs every target filesystem operation through Bash. Electron IPC accepts only registered runtime/skill/version IDs, and the renderer displays persisted jobs without refreshing hidden sessions.

**Tech Stack:** Electron 43, Node.js CommonJS, `node:test`, existing Codex app-server/CodeBuddy ACP/DSH clients, HTML/CSS/vanilla JavaScript renderer.

---

## File map

Create:

- `desktop/rolling-skill/src/skill-installation-protocol.cjs`: frozen request validation, provider-neutral prompt construction, result parsing and consistency checks.
- `desktop/rolling-skill/src/skill-installation-store.cjs`: atomic `0600` installation-job and trusted-installation registry.
- `desktop/rolling-skill/src/skill-installation-manager.cjs`: per-target queues, independent Runtime clients, turn collection, interruption and persistence.
- Matching `desktop/rolling-skill/test/skill-installation-*.test.cjs` files.

Modify:

- `desktop/rolling-skill/src/main.cjs`: initialize manager, register IPC, route installer interactions and forward job updates.
- `desktop/rolling-skill/src/preload.cjs`: expose installer APIs and subscriptions.
- `desktop/rolling-skill/src/codex-app-server.cjs`: answer Codex app-server permission and user-input requests through injected callbacks.
- `desktop/rolling-skill/renderer/index.html`: add `版本 | Runtime 安装` tabs, matrix, task drawer and installer session surface.
- `desktop/rolling-skill/renderer/renderer.js`: installation state, model/effort/permission selection, batch start, stop, inspect and publish toast.
- `desktop/rolling-skill/renderer/styles.css`: native-looking matrix, status chips, non-blocking toast and responsive task session.
- `desktop/rolling-skill/test/main-bridge.test.cjs`, `local-first-surface.test.cjs`, and renderer smoke fixtures.
- `desktop/rolling-skill/README.md`: document Runtime-driven installation and safety states.

Existing integration files contain unrelated work. Never reset them or stage them wholesale unless all current hunks are intentionally included in the final app build.

### Task 1: Frozen request and result protocol

**Files:**
- Create: `desktop/rolling-skill/test/skill-installation-protocol.test.cjs`
- Create: `desktop/rolling-skill/src/skill-installation-protocol.cjs`

- [ ] **Step 1: Write failing protocol tests**

Cover a valid success, missing/duplicate sentinels, malformed JSON, non-Released input, source identity mismatch, digest mismatch, contradictory status, relative destination and provider-neutral prompt text:

```js
const request = freezeSkillInstallationRequest({
    repository: {id: "repo", managedPath: "/managed/repo"},
    skill: {id: "skill", name: "billing", skillRoot: "skills/billing"},
    version: {
        id: "version", repositoryId: "repo", skillId: "skill",
        state: "released", commit: "a".repeat(40),
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionLabel: "v1.0.0",
    },
})
const parsed = parseSkillInstallationResult(resultText(request), request)
assert.equal(parsed.status, "succeeded")
assert.equal(parsed.verification, "runtime-inventory")
assert.doesNotMatch(buildSkillInstallationPrompt(request), /\.codex\/skills|\.codebuddy\/skills|\.dsh\/skills/u)
```

- [ ] **Step 2: Run RED**

Run `node --test test/skill-installation-protocol.test.cjs`.

Expected: FAIL with `Cannot find module '../src/skill-installation-protocol.cjs'`.

- [ ] **Step 3: Implement the minimal protocol**

Export:

```js
module.exports = {
    INSTALL_MARKER_SCHEMA,
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
    freezeSkillInstallationRequest,
    buildSkillInstallationPrompt,
    parseSkillInstallationResult,
}
```

The parser must derive verification rather than trust a model-provided field:

```js
const verification = result.runtimeDiscovered === true
    ? "runtime-inventory"
    : result.actualDigest === frozen.source.expectedDigest && result.markerWritten
      ? "filesystem-only"
      : "none"
```

Only `succeeded` with matching digest, written marker and non-`none` verification is trusted. Return `{...payload, verification, trusted}`.

- [ ] **Step 4: Run GREEN**

Run `node --test test/skill-installation-protocol.test.cjs` and expect all tests PASS.

### Task 2: Atomic installation registry

**Files:**
- Create: `desktop/rolling-skill/test/skill-installation-store.test.cjs`
- Create: `desktop/rolling-skill/src/skill-installation-store.cjs`

- [ ] **Step 1: Write failing store tests**

Cover initial schema, `0600` file mode, restart persistence, immutable frozen request, legal state transitions, message/activity append limits, newest trusted installation selection, and failed/unverified jobs not replacing the last trusted record:

```js
const store = new SkillInstallationStore(join(root, "skill-installations.json"))
const job = store.createJob({runtime, request, modelId: "model", effort: "high", permissionMode: "workspace-write"})
store.updateJob(job.id, {status: "running", threadId: "thread-1"})
store.appendMessage(job.id, {role: "assistant", content: "Checking installation"})
store.completeJob(job.id, {status: "succeeded", parsedResult, traceReference: "/trace"})
assert.equal(store.installationMatrix("skill")[0].versionId, "version")
```

- [ ] **Step 2: Run RED**

Run `node --test test/skill-installation-store.test.cjs` and expect a missing-module failure.

- [ ] **Step 3: Implement the registry**

Use schema `rolling-skill-installations/v1` with `jobs` and `installations`. Persist through a `0600` temporary sibling, `fsync`, rename, and `0700` parent directory. Export `SkillInstallationStore`, `initialSkillInstallationState`, and the schema constant.

Allow transitions:

```text
queued -> running -> awaiting_permission | awaiting_confirmation | verifying
running/awaiting/verifying -> succeeded | failed | cancelled | unverified
```

Persist at most 2,000 messages/activities per job and reject entries over 128 KiB. On startup, turn nonterminal jobs into `unverified` with an interrupted-process error.

- [ ] **Step 4: Run GREEN**

Run `node --test test/skill-installation-store.test.cjs` and expect all tests PASS.

### Task 3: Runtime installation task manager

**Files:**
- Create: `desktop/rolling-skill/test/skill-installation-manager.test.cjs`
- Create: `desktop/rolling-skill/src/skill-installation-manager.cjs`

- [ ] **Step 1: Write failing manager tests using event-emitting fake clients**

Cover:

- renderer input can select IDs but cannot override managed path, commit, digest or destination;
- only Released versions start;
- same `runtimeId + skillId` jobs serialize;
- different runtimes start concurrently;
- notifications preserve assistant/tool ordering;
- valid final protocol completes trusted;
- missing protocol becomes `unverified`;
- permission/question callbacks include `jobId` and update waiting states;
- cancel interrupts the turn and runs an inspect-only follow-up;
- clients always stop after terminal completion.

The public API is:

```js
const manager = new SkillInstallationManager({
    store, managedSkillStore, managedSkillManager, runtimeRegistry,
    getRuntimes: () => [runtime], workspaceRoot: "/workspace", traceDirectory: "/traces",
    requestPermission, requestQuestion, onChanged,
})
const jobs = await manager.start({
    skillId: "skill", versionId: "released", targets: [{runtimeId: "codex:1", modelId: "m", effort: "high", permissionMode: "workspace-write"}],
})
await manager.wait(jobs[0].id)
```

- [ ] **Step 2: Run RED**

Run `node --test test/skill-installation-manager.test.cjs` and expect a missing-module failure.

- [ ] **Step 3: Implement client lifecycle and queues**

For each job, create a provider client with `nonInteractive: false`, injected permission/question callbacks, the installation trace directory, the current workspace, and the selected permission policy. Start or resume an installer thread, run the prompt, collect only that thread's notifications, and wait for `turn/completed`, terminal `error`, client stop, cancellation, or a 30-minute timeout.

Use a per-key tail map:

```js
const key = `${runtime.runtimeId}\0${request.source.skillId}`
const previous = this.queueTails.get(key) ?? Promise.resolve()
const operation = previous.then(() => this.execute(job.id), () => this.execute(job.id))
this.queueTails.set(key, operation.catch(() => {}))
```

Different keys must not share a global queue.

- [ ] **Step 4: Implement stop and follow-up**

`cancel(jobId)` calls `interruptTurn(threadId, turnId)`, marks the job cancelled, and schedules a read-only inspect prompt in the same thread. The inspect result updates evidence but never converts the cancelled job into a successful install.

- [ ] **Step 5: Run GREEN**

Run all three installation test files and expect all tests PASS.

### Task 4: Codex interactive permission transport

**Files:**
- Modify: `desktop/rolling-skill/src/codex-app-server.cjs`
- Modify: `desktop/rolling-skill/test/codex-app-server.test.cjs`

- [ ] **Step 1: Write failing request-handling tests**

Inject `requestPermission` and `requestQuestion`, feed JSON-RPC requests for Codex command/file approval and user input, and assert the client writes the matching response ID. With no callback or an invalid answer, assert a fail-closed rejection/cancellation response.

- [ ] **Step 2: Run RED**

Run the focused Codex client test and confirm it fails because inbound requests are always rejected as unsupported.

- [ ] **Step 3: Implement request routing**

Store the two callbacks in the constructor. In `handleMessage`, route known app-server request methods before the generic unsupported branch, normalize them to the existing permission/question callback shapes, and write exactly one JSON-RPC result or fail-closed error. Keep unknown client requests rejected.

- [ ] **Step 4: Run GREEN**

Run `node --test test/codex-app-server.test.cjs test/skill-installation-manager.test.cjs` and expect PASS.

### Task 5: Main process, preload and persisted installer interactions

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing bridge assertions**

Require channels:

```text
skill-installations:list
skill-installations:start
skill-installations:get
skill-installations:cancel
skill-installations:send
skill-installations:respond-question
skill-installations:changed
```

Assert that `start` passes only IDs and profile selections to the manager, and that publish sends a release notification without starting installation.

- [ ] **Step 2: Run RED**

Run `node --test test/main-bridge.test.cjs` and confirm only the new assertions fail.

- [ ] **Step 3: Wire the manager**

Create `SkillInstallationStore` under App userData and `SkillInstallationManager` after Runtime discovery components exist. Installer clients use their own request callbacks, not the active Chat generation checks. Permission requests reuse the existing local permission dialog with the installer Runtime descriptor; questions emit job-scoped IPC and are resolved only by matching `jobId + requestId`.

Bootstrap includes `skillInstallations` and the discovered Runtime descriptors. App shutdown calls `skillInstallationManager.stopAll()`.

- [ ] **Step 4: Run GREEN**

Run the bridge, protocol, store and manager tests and expect PASS.

### Task 6: Runtime installation matrix and installer session UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Write failing surface assertions**

Assert the Skill Management right panel has `Versions` and `Runtime installations` tabs, a Released-version selector, Runtime rows, per-row model/effort/permission controls, batch install, inspect, stop, task history, and an installer session region. Assert a publish toast navigates but does not start jobs.

- [ ] **Step 2: Run RED**

Run `node --test test/local-first-surface.test.cjs` and confirm the new selectors/actions are absent.

- [ ] **Step 3: Implement renderer state and actions**

Keep installation state separate from Chat, Case Drafts and Raw Case sidebars. Fetch models lazily per Runtime through the existing `listModelsForRuntime`. Hide effort when the selected model exposes no supported efforts. Batch start sends one frozen version ID plus selected target profiles.

Job updates patch only the installation matrix/task/session nodes. Do not call page-wide `renderAll()` for assistant deltas, reasoning or tool activity; use the existing keyed render queue and refresh a hidden job only when its session is opened.

- [ ] **Step 4: Implement status presentation**

Show `runtime-inventory` as verified, `filesystem-only` as “copied, awaiting Runtime verification,” and failed/cancelled/unverified independently from the last trusted installed version. Destructive confirmation and permission requests remain in the installer session/dialog; the matrix never auto-confirms.

- [ ] **Step 5: Run GREEN**

Run `node --test test/local-first-surface.test.cjs` and expect PASS.

### Task 7: Renderer smoke, documentation and package verification

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Extend renderer smoke fixtures**

Provide one Released Skill, three Runtime descriptors, model catalogs, an empty matrix, and deterministic installation job updates. Exercise Runtime selection, profile selection, batch start, session opening, question response, stop, and publish-toast navigation.

- [ ] **Step 2: Run focused and full verification**

Run:

```bash
cd desktop/rolling-skill
npm test
npm run smoke:renderer
git diff --check
```

Expected: all Node tests pass, smoke reports `rendererErrors: 0`, and diff check exits 0.

- [ ] **Step 3: Document the feature**

README must state that the Runtime Agent performs Bash operations, only Released commits install, unmanaged/drifted/conflict states require confirmation, permissions are user-controlled, no rollback is guaranteed, and protocol failures remain unverified.

- [ ] **Step 4: Build, sign and launch**

Run:

```bash
cd /Users/wangbaoheng/Downloads/billing-cli/agenta
bash desktop/rolling-skill/scripts/build-macos-app.sh
codesign --verify --deep --strict --verbose=2 "Rolling Skill.app"
open "Rolling Skill.app"
```

Expected: packaging succeeds, the App verifies with the stable `Rolling Skill Local Development` identity, and the updated Skill Management page opens without Renderer errors.
