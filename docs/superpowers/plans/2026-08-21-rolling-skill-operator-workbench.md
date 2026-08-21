# Rolling Skill Operator Workbench and Job Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable self-operation workbench where a user-selected local Runtime acts as a Rolling Skill Operator, invokes scoped control tools, manages approvals and long-running Jobs, and survives page switches or App restarts.

**Architecture:** Build an append-only Job store and deterministic Job engine above the phase-one Control Plane. `OperatorSessionManager` owns independent Runtime clients and injects the versioned Operator protocol plus provider-native tools: Codex dynamic tools, CodeBuddy session MCP servers, and an authenticated CLI fallback for DSH or incompatible providers. A dedicated four-surface Renderer page consumes snapshots and coalesced events instead of rendering hidden Runtime streams.

**Tech Stack:** Electron 43, Node.js CommonJS, Zod 4, Codex app-server dynamic tools, CodeBuddy ACP MCP configuration, DSH CLI fallback, HTML/CSS/vanilla JavaScript, `node:test`.

---

## File map

Create:

- `desktop/rolling-skill/src/operator/operator-protocol.cjs`: versioned Operator instructions, public tool definitions and business activity labels.
- `desktop/rolling-skill/src/operator/job-store.cjs`: atomic sessions, Jobs, Steps, approvals, artifacts, events and snapshots.
- `desktop/rolling-skill/src/operator/job-engine.cjs`: transitions, idempotency, budgets, approvals, child jobs, cancellation and recovery.
- `desktop/rolling-skill/src/operator/operator-session-manager.cjs`: independent Runtime session lifecycle and transcript/activity capture.
- `desktop/rolling-skill/src/operator/operator-tool-transport.cjs`: Codex dynamic-tool, ACP MCP and CLI transport selection.
- `desktop/rolling-skill/renderer/operator-workbench.js`: focused state reducers, event coalescing and view helpers.
- Matching `desktop/rolling-skill/test/operator-*.test.cjs` tests.

Modify:

- `desktop/rolling-skill/src/control-plane/contracts.cjs`, `domain-services.cjs`, `policy.cjs`: add Job, approval, curation, version and installation actions.
- `desktop/rolling-skill/src/codex-app-server.cjs`: thread-level dynamic tools and `item/tool/call` responses.
- `desktop/rolling-skill/src/codebuddy-acp-client.cjs`: session-scoped `mcpServers`.
- `desktop/rolling-skill/src/deepseek-harness-client.cjs`: per-client child environment for CLI capability.
- `desktop/rolling-skill/src/*-runtime-provider.cjs`: forward per-client Operator transport options.
- `desktop/rolling-skill/src/main.cjs`, `preload.cjs`: manager lifecycle, IPC and event subscriptions.
- `desktop/rolling-skill/renderer/index.html`, `renderer.js`, `styles.css`: self-operation navigation and three-column workbench.
- Renderer smoke files, bridge/surface tests and `README.md`.

### Task 1: Durable Operator Job store

**Files:**
- Create: `desktop/rolling-skill/test/operator-job-store.test.cjs`
- Create: `desktop/rolling-skill/src/operator/job-store.cjs`

- [ ] **Step 1: Write failing persistence tests**

Cover `0600` atomic persistence, immutable IDs/timestamps, legal transitions, parent-child references, event sequence, bounded artifacts, approval records, session transcript, restart recovery and terminal snapshots:

```js
const store = new OperatorJobStore(join(root, "operator-jobs.json"))
const session = store.createSession({runtime, modelId: "m", effort: "high", protocol: "rolling-skill-operator/v1", capabilityId: "grant-1"})
const job = store.createJob({sessionId: session.id, type: "operator", objective: "评测 billing", budget})
store.transitionJob(job.id, "running")
const child = store.createJob({sessionId: session.id, parentJobId: job.id, type: "evaluation", objective: "run dataset", budget})
store.appendEvent(job.id, {kind: "child_created", childJobId: child.id})
assert.equal(store.getJob(job.id).children[0], child.id)
```

On startup, persisted `running` and `cancelling` Jobs become `needs_recovery`; `waiting_approval` and `paused` remain stable.

- [ ] **Step 2: Run RED**

Run `cd desktop/rolling-skill && node --test test/operator-job-store.test.cjs` and expect a missing-module failure.

- [ ] **Step 3: Implement the schema and atomic writes**

Use schema `rolling-skill-operator-jobs/v1` with arrays for `sessions`, `jobs`, `steps`, `approvals`, `artifacts` and `events`. Enforce:

```text
queued -> running | cancelled | failed
running -> waiting_approval | paused | cancelling | succeeded | failed | needs_recovery
waiting_approval -> running | paused | cancelling | failed
paused -> running | cancelling
cancelling -> cancelled | needs_recovery
needs_recovery -> running | cancelled | failed
```

Limit one event/artifact envelope to 256 KiB, one inline artifact body to 128 KiB, and one Job to 10,000 events. Store larger artifacts in an owner-only artifact directory and persist `{path, sha256, byteLength, mediaType}`.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test and expect PASS, then commit with `feat: persist operator jobs`.

### Task 2: Deterministic Job engine, approvals and budgets

**Files:**
- Create: `desktop/rolling-skill/test/operator-job-engine.test.cjs`
- Create: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/policy.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-policy.test.cjs`

- [ ] **Step 1: Write failing engine tests**

Cover child scheduling, exactly-once Steps, approval creation, approve/reject, budget reservation, cancellation propagation, terminal parent rules and reconcile behavior:

```js
const result = await engine.execute(job.id, {
    method: "skills.release",
    params: {versionId: "candidate-1", versionLabel: "v1.1.0"},
    idempotencyKey: "release-candidate-1",
})
assert.equal(result.status, "waiting_approval")
assert.equal(store.getJob(job.id).status, "waiting_approval")
await engine.resolveApproval(result.approvalId, {decision: "approve", scope: "action"})
assert.equal(release.callCount(), 1)
```

Repeat the same idempotency key before and after restart and assert the mutation executes once.

- [ ] **Step 2: Run RED**

Run `node --test test/operator-job-engine.test.cjs test/control-plane-policy.test.cjs` and expect the new APIs to be absent.

- [ ] **Step 3: Implement Step execution and budgets**

Persist a Step before invoking a handler. Budget fields are:

```js
{
    maxDurationMs,
    maxRuntimeTurns,
    maxEvaluations,
    maxTargetExecutions,
    maxJudgeExecutions,
    maxTokens: null,
    maxReportedCost: null,
}
```

Token and cost limits are selectable only when every involved Runtime reports the matching telemetry; otherwise the preflight marks them `unsupported` and the UI disables those fields. Epoch/time/turn/evaluation limits remain hard regardless of provider telemetry.

- [ ] **Step 4: Implement asynchronous approvals**

Policy decisions create persisted Approval records with `action`, object scope, exact proposed mutation, risk text and expiry. A Tool call returns `{status: "waiting_approval", approvalId, jobId}` immediately. Approval resolution executes the frozen request; rejection records a terminal Step error without retrying it.

- [ ] **Step 5: Implement recovery contracts**

Register a reconciler per Step type. Read actions may retry. Evaluation checks `runId`; installation calls read-only inspect; release checks Candidate/Released state and tag; delete never retries automatically. Jobs remain `needs_recovery` until all unknown Steps reconcile.

- [ ] **Step 6: Run GREEN and commit**

Run focused tests and expect PASS. Commit with `feat: orchestrate durable operator jobs`.

### Task 3: Provider-native Operator tool transports

**Files:**
- Create: `desktop/rolling-skill/test/operator-tool-transport.test.cjs`
- Create: `desktop/rolling-skill/src/operator/operator-tool-transport.cjs`
- Modify: `desktop/rolling-skill/src/codex-app-server.cjs`
- Modify: `desktop/rolling-skill/src/codebuddy-acp-client.cjs`
- Modify: `desktop/rolling-skill/src/deepseek-harness-client.cjs`
- Modify: provider client tests.

- [ ] **Step 1: Write failing Codex dynamic-tool tests**

Assert `startThread({dynamicTools})` sends a `rolling_skill` namespace and an inbound `item/tool/call` invokes the injected `requestTool` callback, then returns:

```js
{
    id: 60,
    result: {
        contentItems: [{type: "inputText", text: JSON.stringify(toolResult)}],
        success: true,
    },
}
```

Unknown namespaces, wrong thread IDs and callback errors must return `success: false` with a bounded public error.

- [ ] **Step 2: Implement Codex dynamic tools**

Add constructor option `requestTool`, pass `options.dynamicTools` through `thread/start` and `thread/resume`, and route `item/tool/call` before the generic unsupported request. Ordinary Chat passes no dynamic tools and retains existing behavior.

- [ ] **Step 3: Write and implement CodeBuddy MCP session tests**

Allow `startThread({mcpServers})` and `resumeThread(..., {mcpServers})` to forward the exact session-scoped ACP descriptors instead of hard-coded empty arrays. `OperatorToolTransport` returns one stdio descriptor using the bundled Tool's `operator-mcp` mode and environment-only socket/token values. Ordinary sessions still send `[]`.

- [ ] **Step 4: Write and implement CLI fallback environment tests**

Add a sanitized `childEnvironment` constructor option to all three clients. Merge only explicitly supplied `ROLLING_SKILL_CONTROL_SOCKET`, `ROLLING_SKILL_CONTROL_TOKEN` and `ROLLING_SKILL_OPERATOR_SESSION` entries into the child environment. DSH and any provider failing typed-tool preflight receive the absolute bundled Tool command in the Operator protocol and use CLI fallback.

- [ ] **Step 5: Implement transport preflight**

Return:

```js
{kind: "codex-dynamic", ready: true}
{kind: "acp-mcp", ready: true}
{kind: "cli", ready: true, executablePath}
{kind: "unsupported", ready: false, reason}
```

Do not silently downgrade after an Operator turn starts; freeze the chosen transport in the session record.

- [ ] **Step 6: Run GREEN and commit**

Run Codex, CodeBuddy, DSH and transport tests and expect PASS. Commit with `feat: connect operator tools to local runtimes`.

### Task 4: Operator protocol and session manager

**Files:**
- Create: `desktop/rolling-skill/test/operator-protocol.test.cjs`
- Create: `desktop/rolling-skill/test/operator-session-manager.test.cjs`
- Create: `desktop/rolling-skill/src/operator/operator-protocol.cjs`
- Create: `desktop/rolling-skill/src/operator/operator-session-manager.cjs`

- [ ] **Step 1: Write failing protocol tests**

Assert the versioned protocol names Rolling Skill, explains Job/artifact/approval semantics, forbids direct data-file edits, freezes scopes, instructs the Agent to end its turn after receiving a child `jobId`, and contains no provider-specific Skill installation path.

- [ ] **Step 2: Implement `rolling-skill-operator/v1`**

Build the initial Runtime input as two visible/collapsible parts:

```js
[
    {type: "operatorContext", protocol: "rolling-skill-operator/v1", text: buildOperatorInstructions(context)},
    {type: "text", text: objective},
]
```

Provider adapters serialize `operatorContext` as text for the Runtime while the Renderer labels it as environment context instead of a user message. The protocol includes the capability scope, budgets and Tool transport, but never the bearer token.

- [ ] **Step 3: Write failing manager tests**

Use fake Runtime clients to cover selected Runtime/model/effort, unsupported effort omission, independent client creation, notification ordering, tool calls, permission/questions, user follow-up, stop, child Job completion wake-up and restart with/without Runtime-native resume.

- [ ] **Step 4: Implement session lifecycle**

`OperatorSessionManager.create()` validates the Runtime descriptor, issues a capability, selects the transport, creates one parent Job, starts an independent Runtime client and sends the protocol plus objective. It persists messages and compact activities using the same ordering rules as installer sessions. A child Job completion enqueues one bounded environment follow-up only when the Operator is idle; otherwise it is delivered at the next message boundary.

- [ ] **Step 5: Implement pause, stop and resume**

Pause prevents new Steps but does not kill already-running child jobs. Stop cancels queued children, interrupts the current Operator turn and active cancellable children, then revokes the capability. Restart first reconciles children; it resumes a durable Runtime session when supported, otherwise creates a new session with a checkpoint summary and artifact IDs.

- [ ] **Step 6: Run GREEN and commit**

Run protocol/manager tests and expect PASS. Commit with `feat: manage rolling skill operator sessions`.

### Task 5: Expand the control surface for workbench operations

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/domain-services.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/policy.cjs`
- Modify: control-plane tests.

- [ ] **Step 1: Write failing Tool contract tests**

Add and exercise:

```text
jobs.get, jobs.list, jobs.pause, jobs.resume, jobs.stop
approvals.list, approvals.resolve
curation.start, curation.message, curation.save, curation.discard
datasets.create, datasets.delete, datasets.delete_case
rubrics.publish
skills.diff, skills.create_candidate, skills.release
installations.start, installations.get, installations.cancel, installations.inspect
```

Each mutation requires an idempotency key. Delete, Rubric publish, release and installation must return an Approval rather than execute without a matching grant.

- [ ] **Step 2: Run RED**

Run all control-plane tests and confirm only the new methods fail.

- [ ] **Step 3: Implement adapters over existing managers**

Use existing `CurationManager`, `RubricManager`, `ManagedSkillManager`, `SkillInstallationManager`, LocalEvaluationStore and Job Engine. Return stable object IDs and Artifact references; never copy full Trace or repository files into Tool responses.

- [ ] **Step 4: Add Skill editing scope**

When an Operator task selects a managed Skill, resolve its repository path in the main process and start that Operator client with the repository as workspace. The capability binds `repositoryId + skillId`; `skills.create_candidate` verifies the Candidate commit came from that repository and records `createdBy: "operator"`.

- [ ] **Step 5: Run GREEN and commit**

Run control-plane, curation, managed-skill and installation tests. Commit with `feat: expose operator workflow actions`.

### Task 6: Main/preload integration and lifecycle

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing bridge tests**

Require IPC/preload functions for Operator bootstrap, create, read, send, pause, resume, stop, approval resolution, artifact paging and subscriptions. Assert no function accepts a raw capability token or arbitrary socket path.

- [ ] **Step 2: Run RED**

Run `node --test test/main-bridge.test.cjs` and confirm the new bridge is absent.

- [ ] **Step 3: Initialize managers in dependency order**

After Runtime registry, stores, EvaluationRunner and SkillInstallationManager exist, create `OperatorJobStore`, `JobEngine` and `OperatorSessionManager`. Add them to App bootstrap. Shutdown order is Operator manager, child Evaluation/Installation managers, active Chat client, socket server, then store flush.

- [ ] **Step 4: Route events without global Runtime broadcasts**

Send `operator:changed`, `operator:event`, `operator:approval` and `operator:artifact`. Operator client notifications never enter ordinary `runtime:notification`, thread history or automatic capture.

- [ ] **Step 5: Run GREEN and commit**

Run bridge and Operator tests and expect PASS. Commit with `feat: wire operator workbench services`.

### Task 7: Dedicated self-operation workbench UI

**Files:**
- Create: `desktop/rolling-skill/renderer/operator-workbench.js`
- Create: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Write failing reducer and surface tests**

Test Job/event deduplication, unread counts, active-session-only delta coalescing and snapshot catch-up in `operator-workbench.test.cjs`. Surface tests require `data-surface="operator"`, task list, conversation, fixed status panel, composer, setup form and approval queue.

- [ ] **Step 2: Run RED**

Run `node --test test/operator-workbench.test.cjs test/local-first-surface.test.cjs` and expect failures.

- [ ] **Step 3: Implement the three-column page**

Add:

```text
left: Operator Jobs
center: Operator transcript + fixed composer
right: scope, budget, child Jobs, artifacts and approvals
```

The setup form selects Operator Runtime/model/effort, optional managed Skill/Dataset, allowed target Runtimes, budget and permission grants. Runtime model/effort fields use the existing capability-gated catalogs.

- [ ] **Step 4: Implement isolated rendering**

`operator-workbench.js` keeps snapshots by Job ID. Hidden sessions update only snapshot, unread count and status. The active session coalesces text/activity deltas at 64 ms, patches keyed DOM nodes and preserves composer drafts/scroll by Job ID. It never calls Chat's `renderAll()` for Operator deltas.

- [ ] **Step 5: Implement approvals and deep links**

Approval cards show exact action/scope and buttons for reject, approve once and approve for current Job when allowed. Artifact cards deep-link to Dataset, Case, Evaluation, Candidate and Installation IDs by calling the existing surface selection functions.

- [ ] **Step 6: Run GREEN and commit**

Run reducer/surface tests and expect PASS. Commit with `feat: add rolling skill operator workbench`.

### Task 8: Renderer smoke, recovery smoke and documentation

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Add deterministic Operator fixtures**

Provide one running Job, one hidden streaming Job, one waiting approval, child Evaluation progress and an Artifact. Verify hidden deltas do not change active DOM, switching restores all prior output directly, composer drafts are per Job, approval resolves, and stop changes state without affecting Chat.

- [ ] **Step 2: Add restart recovery integration test**

Persist a running Operator Job with one running Evaluation Step and one pending release Approval. Reopen the stores, reconcile Evaluation by run ID, preserve the Approval and assert the parent returns to `waiting_approval` without re-running the release.

- [ ] **Step 3: Document the workbench**

Explain Operator identity, Runtime/model selection, scoped tools, approvals, App-running requirement, three provider transports, background refresh behavior and the separation from ordinary Chat/evaluation.

- [ ] **Step 4: Run full verification**

```bash
cd desktop/rolling-skill
npm test
npm run smoke:renderer
npm run build:tool
git diff --check
```

Expected: all unit/integration tests pass, Renderer reports zero errors, Tool build succeeds and diff check is silent.

- [ ] **Step 5: Commit**

Commit smoke/docs changes with `test: verify operator workbench lifecycle`.
