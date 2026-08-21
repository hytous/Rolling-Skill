# Rolling Skill Control Plane and Tool Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Rolling Skill's first provider-neutral control-plane services and expose them safely through Renderer IPC, an owner-only local socket, MCP, and CLI without changing ordinary Chat or evaluation behavior.

**Architecture:** Introduce a schema-first `ControlPlane` whose handlers receive stable IDs and injected domain dependencies. A short-lived capability authorizes every socket request; Electron IPC uses an explicit renderer capability created in-process. The existing external Tool keeps its offline Raw Case path, while new control commands connect to the running App and share the same schemas and handlers.

**Tech Stack:** Electron 43, Node.js CommonJS/ESM, Unix domain sockets, Zod 4, MCP SDK 2, `node:test`, existing local stores/managers.

---

## File map

Create:

- `desktop/rolling-skill/src/control-plane/contracts.cjs`: method names, Zod input/output contracts, pagination and public errors.
- `desktop/rolling-skill/src/control-plane/capability-store.cjs`: ephemeral scoped capability creation, authorization, expiry and revocation.
- `desktop/rolling-skill/src/control-plane/policy.cjs`: action classification, object-scope checks and budget decisions.
- `desktop/rolling-skill/src/control-plane/control-plane.cjs`: handler registry and provider-neutral command/query dispatch.
- `desktop/rolling-skill/src/control-plane/domain-services.cjs`: adapters over existing Raw Case, Runtime, Dataset, Evaluation and Managed Skill dependencies.
- `desktop/rolling-skill/src/control-plane/socket-server.cjs`: owner-only JSONL socket server.
- `desktop/rolling-skill/src/control-plane/socket-client.cjs`: bounded request client used by CLI/MCP.
- Matching `desktop/rolling-skill/test/control-plane-*.test.cjs` tests.

Modify:

- `desktop/rolling-skill/src/main.cjs`: construct the control plane, start/stop the socket and route selected IPC through it.
- `desktop/rolling-skill/src/preload.cjs`: call the new `control:invoke` bridge for migrated functions while preserving its public API.
- `desktop/rolling-skill/tools/rolling-skill-tool.mjs`: add authenticated `control` CLI and `operator-mcp` modes without weakening offline Raw Case commands.
- `desktop/rolling-skill/scripts/build-external-tool.mjs`: bundle the new socket client and MCP gateway.
- `desktop/rolling-skill/test/main-bridge.test.cjs`, `raw-case-tool.test.cjs`, `local-first-surface.test.cjs`.
- `desktop/rolling-skill/README.md`.

### Task 1: Schema-first control-plane contracts

**Files:**
- Create: `desktop/rolling-skill/test/control-plane-contracts.test.cjs`
- Create: `desktop/rolling-skill/src/control-plane/contracts.cjs`

- [ ] **Step 1: Write failing contract tests**

Cover unknown methods, strict object schemas, identifier limits, cursor/limit validation, output parsing and safe public errors:

```js
const {CONTROL_METHODS, parseControlInput, parseControlOutput, publicControlError} =
    require("../src/control-plane/contracts.cjs")

assert.deepEqual(parseControlInput("raw_cases.list", {skillName: "billing", limit: 20}), {
    skillName: "billing", cursor: null, limit: 20,
})
assert.throws(() => parseControlInput("raw_cases.list", {limit: 500}), /limit/u)
assert.throws(() => parseControlInput("unknown.method", {}), /Unknown control method/u)
assert.equal(publicControlError(Object.assign(new Error("denied"), {code: "FORBIDDEN"})).code, "FORBIDDEN")
assert.ok(CONTROL_METHODS.includes("evaluations.start"))
```

- [ ] **Step 2: Run RED**

Run `cd desktop/rolling-skill && node --test test/control-plane-contracts.test.cjs`.

Expected: FAIL with a missing `contracts.cjs` module.

- [ ] **Step 3: Implement strict contracts**

Define initial methods:

```js
const METHOD_DEFINITIONS = Object.freeze({
    "context.get": {action: "context.read", input: z.object({}).strict(), output: z.object({workspaceRoot: z.string(), runtimes: z.array(z.any())})},
    "raw_cases.list": {action: "raw_cases.read", input: page.extend({skillName: z.string().max(200).nullable().default(null)}).strict(), output: pageResult("rawCases")},
    "raw_cases.enqueue": {action: "raw_cases.write", input: z.object({cases: z.array(rawCaseInput).min(1).max(200), idempotencyKey: id}).strict(), output: z.object({created: z.array(z.any()), duplicates: z.array(z.any()), rejected: z.array(z.any())})},
    "raw_cases.update": {action: "raw_cases.write", input: z.object({id, changes: rawCaseChanges, idempotencyKey: id}).strict(), output: z.object({rawCase: z.any()})},
    "raw_cases.dispatch": {action: "runtime.execute", input: z.object({id, mode: z.enum(["current", "new"]), runtime: runtimeProfile, idempotencyKey: id}).strict(), output: z.object({threadId: id, turnId: id.nullable()})},
    "runtimes.list": {action: "runtimes.read", input: z.object({}).strict(), output: z.object({runtimes: z.array(z.any())})},
    "runtimes.models": {action: "runtimes.read", input: z.object({runtimeId: id}).strict(), output: z.object({models: z.array(z.any())})},
    "datasets.list": {action: "datasets.read", input: page.strict(), output: pageResult("datasets")},
    "datasets.get": {action: "datasets.read", input: z.object({datasetId: id, includeCases: z.boolean().default(false)}).strict(), output: z.object({dataset: z.any(), cases: z.array(z.any()).optional()})},
    "evaluations.list": {action: "evaluations.read", input: page.extend({datasetId: id.nullable().default(null)}).strict(), output: pageResult("runs")},
    "evaluations.get": {action: "evaluations.read", input: z.object({runId: id}).strict(), output: z.object({run: z.any()})},
    "evaluations.start": {action: "evaluations.execute", input: evaluationStart.strict(), output: z.object({run: z.any()})},
    "evaluations.cancel": {action: "evaluations.execute", input: z.object({runId: id, idempotencyKey: id}).strict(), output: z.object({run: z.any()})},
    "skills.list": {action: "skills.read", input: page.strict(), output: pageResult("skills")},
    "skills.get": {action: "skills.read", input: z.object({skillId: id}).strict(), output: z.object({skill: z.any()})},
})
```

Reject unknown object keys. Limit a page to 100 records and encode cursors as opaque base64url sequence tokens. `publicControlError` returns only `{code, message, retryable, details}` and never a stack or arbitrary nested error.

- [ ] **Step 4: Run GREEN**

Run `node --test test/control-plane-contracts.test.cjs` and expect PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/rolling-skill/src/control-plane/contracts.cjs desktop/rolling-skill/test/control-plane-contracts.test.cjs
git commit -m "feat: define rolling skill control contracts"
```

### Task 2: Capability and policy enforcement

**Files:**
- Create: `desktop/rolling-skill/test/control-plane-capability.test.cjs`
- Create: `desktop/rolling-skill/test/control-plane-policy.test.cjs`
- Create: `desktop/rolling-skill/src/control-plane/capability-store.cjs`
- Create: `desktop/rolling-skill/src/control-plane/policy.cjs`

- [ ] **Step 1: Write failing capability tests**

Exercise issue, authorize, object scope, action scope, expiration, revocation and single-session ownership:

```js
const grant = capabilities.issue({
    sessionId: "operator-1",
    actions: ["raw_cases.read", "raw_cases.write", "evaluations.read"],
    scopes: {skillIds: ["skill-1"], datasetIds: ["dataset-1"], runtimeIds: []},
    expiresInMs: 60_000,
    budget: {maxRuntimeTurns: 4, maxEvaluations: 1},
})
assert.equal(capabilities.authorize(grant.token, "raw_cases.read").sessionId, "operator-1")
assert.throws(() => capabilities.authorize(grant.token, "evaluations.execute"), /not granted/u)
capabilities.revoke(grant.id)
assert.throws(() => capabilities.authorize(grant.token, "raw_cases.read"), /revoked/u)
```

- [ ] **Step 2: Run RED**

Run `node --test test/control-plane-capability.test.cjs test/control-plane-policy.test.cjs` and expect missing-module failures.

- [ ] **Step 3: Implement capabilities without persisting bearer tokens**

`CapabilityStore.issue()` returns the raw token once and stores only `sha256(token)`. Use `timingSafeEqual` for lookup, `randomBytes(32).toString("base64url")` for tokens, an injected clock for tests, and a maximum lifetime of 24 hours. Export `issue`, `authorize`, `revoke`, `revokeSession` and `sweepExpired`.

- [ ] **Step 4: Implement policy decisions**

Return one of:

```js
{decision: "allow", reservation: null}
{decision: "deny", code: "OBJECT_OUT_OF_SCOPE", message: "Dataset is outside this Operator session"}
{decision: "approval_required", reason: "budget_expansion", requestedScope: {...}}
```

Phase one allows reads, Raw Case writes and runtime/evaluation execution only when the capability includes the action and object IDs. Delete, release, install, Rubric publish and budget expansion always return `approval_required`; no phase-one method executes them.

- [ ] **Step 5: Run GREEN and commit**

Run the two focused tests and expect PASS, then:

```bash
git add desktop/rolling-skill/src/control-plane/capability-store.cjs desktop/rolling-skill/src/control-plane/policy.cjs desktop/rolling-skill/test/control-plane-capability.test.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs
git commit -m "feat: enforce scoped control capabilities"
```

### Task 3: Provider-neutral domain services and dispatch

**Files:**
- Create: `desktop/rolling-skill/test/control-plane-domain-services.test.cjs`
- Create: `desktop/rolling-skill/test/control-plane.test.cjs`
- Create: `desktop/rolling-skill/src/control-plane/domain-services.cjs`
- Create: `desktop/rolling-skill/src/control-plane/control-plane.cjs`

- [ ] **Step 1: Write failing service tests with fake dependencies**

Verify stable-ID lookup, pagination, no renderer paths, exact Raw Case text, evaluation preflight forwarding and idempotency:

```js
const services = createDomainServices({
    rawCaseStore, evaluationStore, evaluationRunner, managedSkillManager,
    listRuntimes: () => runtimes,
    listModelsForRuntime,
    dispatchRawCase,
    startEvaluation,
})
const control = new ControlPlane({services, capabilities, policy})
const first = await control.invoke({token, method: "raw_cases.enqueue", params: {cases, idempotencyKey: "enqueue-1"}})
const repeated = await control.invoke({token, method: "raw_cases.enqueue", params: {cases, idempotencyKey: "enqueue-1"}})
assert.deepEqual(repeated, first)
assert.equal(rawCaseStore.addMany.mock.callCount(), 1)
```

- [ ] **Step 2: Run RED**

Run `node --test test/control-plane-domain-services.test.cjs test/control-plane.test.cjs` and expect missing-module failures.

- [ ] **Step 3: Implement domain adapters**

`createDomainServices()` receives functions and stores from `main.cjs`. It returns handlers named exactly like the contracts. It resolves runtime, dataset, case, run and Skill IDs from the injected inventories; it never accepts absolute filesystem paths from Tool input. Use a bounded in-memory idempotency cache keyed by `capabilityId + method + idempotencyKey`, storing terminal result digests for 24 hours. Persistent idempotency moves into Job Engine in phase two.

- [ ] **Step 4: Implement `ControlPlane.invoke()`**

Execution order is fixed:

```js
const definition = controlDefinition(method)
const input = parseControlInput(method, params)
const grant = capabilityStore.authorize(token, definition.action)
const decision = policy.decide({grant, method, action: definition.action, input})
if (decision.decision !== "allow") throw controlDecisionError(decision)
const result = await services[method](input, {grant})
return parseControlOutput(method, result)
```

Record an audit event containing capability ID, session ID, method, object IDs, duration, outcome and redacted error code. Never record the token or unbounded Tool payload.

- [ ] **Step 5: Run GREEN and commit**

Run both focused tests and expect PASS, then commit the four files with `feat: add rolling skill control plane`.

### Task 4: Owner-only local socket transport

**Files:**
- Create: `desktop/rolling-skill/test/control-plane-socket.test.cjs`
- Create: `desktop/rolling-skill/src/control-plane/socket-server.cjs`
- Create: `desktop/rolling-skill/src/control-plane/socket-client.cjs`
- Modify: `desktop/rolling-skill/src/json-rpc.cjs`
- Modify: `desktop/rolling-skill/test/json-rpc.test.cjs`

- [ ] **Step 1: Write failing transport tests**

Use a temporary `0700` directory. Cover request/result, public error, malformed JSON, payload over 1 MiB, 15-second timeout, concurrent IDs, client disconnect and stale socket replacement only inside the configured directory. Assert the socket mode is `0600` on macOS.

- [ ] **Step 2: Run RED**

Run `node --test test/control-plane-socket.test.cjs test/json-rpc.test.cjs` and expect missing transport exports.

- [ ] **Step 3: Extend JSONL primitives**

Add a maximum buffer size to `JsonLineDecoder`; exceeding it calls `onError` and clears the connection buffer. Keep existing Runtime clients at their current default while the control socket passes `1_048_576` bytes explicitly.

- [ ] **Step 4: Implement server and client**

Use one JSON object per line:

```json
{"id":"uuid","method":"raw_cases.list","params":{"limit":20},"token":"opaque"}
{"id":"uuid","result":{"rawCases":[],"nextCursor":null}}
```

The server binds under `<userData>/control/control.sock`, creates the parent as `0700`, verifies the socket path is the exact configured child, unlinks only that stale socket, then `chmodSync(path, 0o600)`. Close removes only the same socket. The client accepts socket path and token through constructor options, never command-line logging.

- [ ] **Step 5: Run GREEN and commit**

Run both focused tests and expect PASS, then commit with `feat: add local control socket`.

### Task 5: Authenticated CLI and MCP Tool Gateway

**Files:**
- Modify: `desktop/rolling-skill/tools/rolling-skill-tool.mjs`
- Modify: `desktop/rolling-skill/scripts/build-external-tool.mjs`
- Modify: `desktop/rolling-skill/test/raw-case-tool.test.cjs`

- [ ] **Step 1: Write failing CLI/MCP tests**

Start a fixture socket server and run:

```bash
rolling-skill-tool control raw_cases.list --params-json -
rolling-skill-tool operator-mcp
```

Provide `ROLLING_SKILL_CONTROL_SOCKET` and `ROLLING_SKILL_CONTROL_TOKEN` only in the child environment. Assert `operator-mcp` lists the initial typed tools, calls the socket, preserves structured errors, and never includes the token in stdout/stderr. Assert `enqueue`, `list` and `mcp` retain their existing offline behavior without a running App.

- [ ] **Step 2: Run RED**

Run `node --test test/raw-case-tool.test.cjs` and confirm the new modes are unknown.

- [ ] **Step 3: Implement the control CLI**

Parse `control <method> --params-json <file|->`; reject control mode when either environment variable is absent. Print one JSON result on stdout and public errors on stderr with a nonzero exit code.

- [ ] **Step 4: Implement MCP registration from shared contracts**

Register one MCP tool per exposed method using stable names such as `rolling_skill_raw_cases_list` and `rolling_skill_evaluations_start`. MCP handlers call `ControlSocketClient.invoke`; annotations derive from each method action, with read-only hints only for queries and destructive hints false in phase one.

- [ ] **Step 5: Rebuild and run GREEN**

Run:

```bash
npm run build:tool
node --test test/raw-case-tool.test.cjs
```

Expected: Tool build succeeds and all Raw Case/control gateway tests pass. Commit with `feat: expose rolling skill control tools`.

### Task 6: Main-process lifecycle and IPC migration

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Write failing lifecycle and bridge assertions**

Assert `main.cjs` constructs one ControlPlane, starts one socket after stores/managers exist, stops it before quit, and exposes only `control:invoke` plus existing UI-shaped preload functions. Assert preload cannot issue or enumerate capability tokens.

- [ ] **Step 2: Run RED**

Run `node --test test/main-bridge.test.cjs test/local-first-surface.test.cjs` and confirm the new assertions fail.

- [ ] **Step 3: Add the lifecycle**

Create an in-process renderer capability with only the actions already available to the UI. `ipcMain.handle("control:invoke", ...)` ignores any renderer-provided token and supplies the private renderer capability internally. Start the socket with no externally issued capability; phase two will issue per-Operator capabilities.

- [ ] **Step 4: Migrate the first handlers without changing preload call sites**

Move Raw Case list/add/update, runtime/model lists, Dataset list/read, Evaluation list/read/start/cancel and managed Skill list/read through the control plane. Preload methods retain names such as `listRawCases()` and `startEvaluationRun()` so Renderer behavior does not change.

- [ ] **Step 5: Run GREEN and commit**

Run bridge/surface/control-plane tests and expect PASS. Commit with `refactor: route desktop actions through control plane`.

### Task 7: Full verification and documentation

**Files:**
- Modify: `desktop/rolling-skill/README.md`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`

- [ ] **Step 1: Document trust and transport boundaries**

Describe the socket location class without printing a live token, App-running requirement, environment-only credentials, offline Raw Case exception, initial Tool list and the fact that ordinary Chat/Evaluation receive no Operator capability.

- [ ] **Step 2: Extend the renderer smoke preload**

Make existing UI-shaped preload methods pass through a fake `controlInvoke` implementation. Assert Chat, Raw Cases, Dataset and Evaluation behavior remain unchanged after IPC migration.

- [ ] **Step 3: Run all verification**

```bash
cd desktop/rolling-skill
npm test
npm run smoke:renderer
npm run build:tool
git diff --check
```

Expected: all unit tests pass, Renderer reports zero errors, the external Tool builds, and `git diff --check` is silent.

- [ ] **Step 4: Commit**

```bash
git add desktop/rolling-skill/README.md desktop/rolling-skill/scripts/renderer-smoke-preload.cjs
git commit -m "docs: describe rolling skill control gateway"
```
