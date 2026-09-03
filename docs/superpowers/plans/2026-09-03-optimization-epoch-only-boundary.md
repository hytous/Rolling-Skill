# Optimization Epoch-Only Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make complete Optimization Epochs the only user-configured automation limit, with unlimited Agent turns inside each Epoch and no duration, usage, quality-threshold, or budget-expansion stopping controls.

**Architecture:** Introduce an explicit empty Operator budget for new unbounded sessions while retaining both legacy seven-field budgets and persisted `maxIterations` sessions. Add a compact Optimization config/frozen snapshot shape containing only `limits.maxEpochs`, simplify analysis and Runner stopping to safety failures, Agent decisions, and the Epoch boundary, then remove the obsolete Renderer controls. Old snapshots remain readable through legacy parsing branches.

**Tech Stack:** Electron, CommonJS Node.js, `node:test`, Zod control contracts, HTML/CSS/vanilla JavaScript Renderer.

**Execution constraint:** Implement inline in this session. The user explicitly prohibited subagents from writing code.

---

## File map

- `desktop/rolling-skill/src/operator/operator-budget.cjs`: validates legacy, iteration-limited, and new unbounded `{}` Operator budgets.
- `desktop/rolling-skill/src/operator/operator-protocol.cjs`: tells new Operators that no Agent-turn count is used.
- `desktop/rolling-skill/src/operator/job-engine.cjs`: skips legacy telemetry, reservations, and duration enforcement for new unbounded jobs.
- `desktop/rolling-skill/src/operator/operator-session-manager.cjs`: issues scope-only capabilities for unbounded sessions and never reserves an iteration.
- `desktop/rolling-skill/src/optimization/optimization-contract.cjs`: accepts the compact new Optimization config and preserves old frozen snapshots.
- `desktop/rolling-skill/src/optimization/optimization-analysis.cjs`: computes evidence without target/patience/usage stopping rules.
- `desktop/rolling-skill/src/optimization/optimization-runner.cjs`: stops only for safety, Agent choice, manual control, or completed Epoch count.
- `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`: creates new Optimization Operators with `{}` and exposes compact runs.
- `desktop/rolling-skill/src/optimization/optimization-operator-gateway.cjs`: waits for Agent submissions without an aggregate duration timer.
- `desktop/rolling-skill/src/optimization/optimization-workspace.cjs`: accepts any positive safe-integer Epoch.
- `desktop/rolling-skill/src/optimization/optimization-store.cjs`: persists Epoch counts without the old 100-Epoch product limit while validating legacy limit approvals.
- `desktop/rolling-skill/src/optimization/optimization-report.cjs`: reports Epoch evidence instead of removed budgets/telemetry.
- `desktop/rolling-skill/src/control-plane/contracts.cjs`: accepts compact new inputs/outputs and legacy run outputs.
- `desktop/rolling-skill/renderer/index.html`: leaves one “最大闭环次数（Epoch）” field and removes Agent-operation controls.
- `desktop/rolling-skill/renderer/operator-workbench.js`: builds compact requests and generic unbounded sessions.
- `desktop/rolling-skill/renderer/renderer.js`: updates Chinese/English copy.
- Focused tests under `desktop/rolling-skill/test/`: lock each contract, Runner transition, compatibility path, and rendered UI behavior.

### Task 1: Add the explicit unbounded Operator budget

**Files:**
- Modify: `desktop/rolling-skill/src/operator/operator-budget.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-protocol.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-session-manager.cjs`
- Test: `desktop/rolling-skill/test/operator-job-store.test.cjs`
- Test: `desktop/rolling-skill/test/operator-protocol.test.cjs`
- Test: `desktop/rolling-skill/test/operator-job-engine.test.cjs`
- Test: `desktop/rolling-skill/test/operator-session-manager.test.cjs`

- [ ] **Step 1: Write failing budget and protocol tests**

Add assertions proving `{}` is valid and distinct from old iteration budgets:

```js
assert.deepEqual(normalizeOperatorBudget({}), {})
assert.equal(isUnboundedBudget({}), true)
assert.equal(isUnboundedBudget({maxIterations: 5}), false)
assert.deepEqual(preflightOperatorBudget({}), {valid: true, fields: {}})
assert.match(buildOperatorInstructions({...context, budget: {}}), /no Agent-turn limit/iu)
assert.doesNotMatch(buildOperatorInstructions({...context, budget: {}}), /budget expansion/iu)
```

Add a Job Engine test that runs an evaluation Tool step with `budget: {}`, no telemetry provider, no reservation event, and no duration timeout.

- [ ] **Step 2: Run focused tests and verify the new shape fails**

Run:

```bash
cd desktop/rolling-skill
node --test test/operator-job-store.test.cjs test/operator-protocol.test.cjs test/operator-job-engine.test.cjs test/operator-session-manager.test.cjs
```

Expected: FAIL because `{}` is rejected as a legacy budget and unbounded helpers do not exist.

- [ ] **Step 3: Implement the new budget category**

In `operator-budget.cjs`, add and export:

```js
function isUnboundedBudget(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)
}

function isAutomaticBudget(value) {
    return isIterationBudget(value) || isUnboundedBudget(value)
}
```

Return `{}` before the iteration/legacy branches in `normalizeOperatorBudget`. In `job-engine.cjs`, use `isAutomaticBudget` anywhere the modern path skips telemetry, Tool reservations, expansion approvals, and aggregate duration enforcement. Keep `isIterationBudget` only where an actual `maxIterations` counter is required.

In `operator-session-manager.cjs`, make `capabilityBudget({})` return `{}` and give unbounded sessions the existing technical capability lease. Keep `#iterationState()` unchanged so only persisted `{maxIterations}` jobs consume iteration entries.

In `operator-protocol.cjs`, generate three explicit instructions: legacy budgets may request expansion, persisted iteration budgets stop at their count, and `{}` has no Agent-turn count or runtime budget expansion.

- [ ] **Step 4: Run the focused Operator tests**

Run the command from Step 2.

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the Operator budget foundation**

```bash
git add desktop/rolling-skill/src/operator desktop/rolling-skill/test/operator-job-store.test.cjs desktop/rolling-skill/test/operator-protocol.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs
git commit -m "feat: support unbounded Operator sessions"
```

### Task 2: Define the compact Epoch-only Optimization contract

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-contract.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Test: `desktop/rolling-skill/test/optimization-contract.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-control-contracts.test.cjs`

- [ ] **Step 1: Add failing compact-config and legacy-compatibility tests**

Create a new-config fixture shaped as:

```js
const compactConfig = {
    skillId: "skill-1",
    baselineVersionId: "version-1",
    datasetId: "dataset-1",
    operator: {runtimeId: "codex:operator", modelId: "gpt-5.6-sol", effort: "high"},
    targets: [{runtimeId: "codex:target", modelId: "gpt-5.6-sol", effort: "medium"}],
    judge: {runtimeId: "codex:judge", modelId: "gpt-5.6-sol", effort: "high"},
    activationMode: "automatic",
    limits: {maxEpochs: 5},
}
```

Assert the parser accepts this exact shape, rejects `maxEpochs: 0`, accepts a value above 100, and rejects `maxDurationMs`, `patience`, `target`, `telemetry`, or `mode` when mixed into a new config. Keep one legacy fixture proving the old full config and a previously frozen v1 snapshot still validate unchanged.

Update control contract tests so new `optimization.preflight` and `optimization.start` inputs use only the compact shape, while a legacy public run remains parseable.

- [ ] **Step 2: Run the contract tests and observe failure**

```bash
cd desktop/rolling-skill
node --test test/optimization-contract.test.cjs test/optimization-control-contracts.test.cjs
```

Expected: FAIL because the current contract requires mode, target, telemetry, and seven limit fields and caps Epochs at 100.

- [ ] **Step 3: Implement versioned compact parsing**

Keep the old parsers as `legacyLimits`, `legacyTarget`, and `legacyOptimizationConfig`. Add a compact parser whose normalized result contains only:

```js
{
    schemaVersion: "rolling-skill-optimization-config/v2",
    skillId,
    baselineVersionId,
    datasetId,
    operator,
    targets,
    judge,
    activationMode,
    limits: {maxEpochs},
}
```

Detect legacy input only when the complete old field set is present; do not silently discard a partial mixture. Freeze new runs as `rolling-skill-frozen-optimization-run/v2`. Branch `validateFrozenOptimizationRun` by schema version so v1 reconstructs the old config and v2 reconstructs the compact config before checking its digest.

In `control-plane/contracts.cjs`, introduce compact and legacy Zod schemas. New start/preflight input uses the compact schema. Public run output is a union/discriminated shape that accepts v2 fields and persisted v1 fields without inventing removed settings.

- [ ] **Step 4: Run the contract tests**

Run the command from Step 2.

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the compact contract**

```bash
git add desktop/rolling-skill/src/optimization/optimization-contract.cjs desktop/rolling-skill/src/control-plane/contracts.cjs desktop/rolling-skill/test/optimization-contract.test.cjs desktop/rolling-skill/test/optimization-control-contracts.test.cjs
git commit -m "feat: define Epoch-only optimization configs"
```

### Task 3: Remove target, patience, and usage stopping rules

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-analysis.cjs`
- Test: `desktop/rolling-skill/test/optimization-analysis.test.cjs`

- [ ] **Step 1: Rewrite stopping-rule tests around the approved semantics**

Keep the score/pass/failure comparison assertions, but construct comparisons with:

```js
return compareEvaluationRuns({
    baseline,
    previous,
    current,
    epoch: 1,
    limits: {maxEpochs: 5},
    agentDecision: {action: "continue"},
    ...overrides,
})
```

Assert:

```js
assert.equal(evaluateStopRules(comparison({epoch: 5})).reason, "max_epochs_reached")
assert.equal(evaluateStopRules(comparison({agentDecision: {action: "finish"}})).reason, "agent_finish")
assert.equal(evaluateStopRules(comparison({agentDecision: {action: "pause"}})).reason, "agent_pause")
```

Also assert elapsed time, Turn counts, low score gain, and an arbitrary target-like input do not change a `continue` result. Preserve new-critical-failure and configured broad-regression safety tests.

- [ ] **Step 2: Run the analysis test and verify old stop reasons fail the new assertions**

```bash
cd desktop/rolling-skill
node --test test/optimization-analysis.test.cjs
```

Expected: FAIL because target, patience, and usage fields are currently required and enforced.

- [ ] **Step 3: Simplify comparison and stopping**

Delete `insufficientImprovementCount`, target parsing, mode parsing, usage progress, `targetReached`, and patience output. Keep evidence summaries, deltas, critical failures, and optional broad-regression thresholds.

Implement stop precedence as:

```js
if (analysis.cancelRequested) return stop("restore", "cancel_requested", true)
if (analysis.recoveryFailed) return stop("recover", "recovery_failed", true)
if (analysis.newCriticalFailures?.length) return stop("restore", "critical_regression", true)
if (analysis.broadRegression) return stop("restore", "broad_regression", true)
if (analysis.epoch >= analysis.limits.maxEpochs) return stop("finish", "max_epochs_reached", true)
const action = analysis.agentDecision?.action ?? "continue"
if (action === "finish") return stop("finish", "agent_finish", false)
if (action === "pause") return stop("pause", "agent_pause", false)
if (action !== "continue") throw new Error("Optimization Agent decision is invalid")
return stop("continue", "continue", false)
```

- [ ] **Step 4: Run the analysis test**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit simplified stopping**

```bash
git add desktop/rolling-skill/src/optimization/optimization-analysis.cjs desktop/rolling-skill/test/optimization-analysis.test.cjs
git commit -m "feat: stop optimization at complete Epoch boundaries"
```

### Task 4: Make the Runner rely on Agent decisions and Epoch count

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-runner.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-operator-gateway.cjs`
- Test: `desktop/rolling-skill/test/optimization-runner.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-operator-gateway.test.cjs`

- [ ] **Step 1: Add failing Runner boundary tests**

Add a fixture with `limits: {maxEpochs: 2}` whose Operator uses more than two Agent submissions per Epoch. Assert all submissions complete, Epoch 2 finishes, no Epoch 3 candidate request occurs, and the only pending approval is `release-install`.

Add tests proving:

```js
assert.equal(store.getRun(run.id).checkpoint.stopReason, "max_epochs_reached")
assert.equal(approvals.requests.some((entry) => entry.kind === "limit"), false)
assert.equal(gateway.pending(run.id), null)
```

Update the gateway test so `requestCandidate` and `requestDecision` remain pending without an aggregate `timeoutMs`, then resolve through the matching submission. Remove the limit-request success case and assert `submitDecision` carries only `decision`.

- [ ] **Step 2: Run focused Runner tests and observe failures**

```bash
cd desktop/rolling-skill
node --test test/optimization-runner.test.cjs test/optimization-operator-gateway.test.cjs
```

Expected: FAIL because the Runner still reads telemetry/time remaining and supports limit approvals.

- [ ] **Step 3: Remove aggregate budgets and limit approvals from the Runner**

Delete `optimizationLimitRequest`, `approvedLimits`, `#operatorTimeRemaining`, telemetry stop snapshots, and the `kind: "limit"` approval block. Call gateways without `timeoutMs`:

```js
await this.operatorGateway.requestCandidate({
    run: boundedRunSummary(this.store.getRun(control.runId)),
    epoch: epochNumber,
    workspace: clone(control.workspace),
    operatorSessionId: control.operatorSessionId,
})
```

Make `#requestDecision` return only `parseOptimizationDecision(raw.decision ?? raw)` after the existing single repair attempt. Build analysis input from Baseline, previous/current evaluation, `epoch`, `limits: {maxEpochs}`, regression thresholds, and the Agent decision.

In the gateway, remove the task-duration timer and `limitRequest` transport. Preserve `cancelRun` so manual stop, App shutdown, and recovery can reject a pending Agent wait.

- [ ] **Step 4: Run Runner and gateway tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit Runner changes**

```bash
git add desktop/rolling-skill/src/optimization/optimization-runner.cjs desktop/rolling-skill/src/optimization/optimization-operator-gateway.cjs desktop/rolling-skill/test/optimization-runner.test.cjs desktop/rolling-skill/test/optimization-operator-gateway.test.cjs
git commit -m "feat: let the Agent control work within each Epoch"
```

### Task 5: Create unbounded Optimization Operators and preserve legacy recovery

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-store.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-workspace.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/domain-services.cjs`
- Test: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-store.test.cjs`
- Test: `desktop/rolling-skill/test/optimization-control-plane.test.cjs`

- [ ] **Step 1: Add failing service, storage, and control tests**

Assert a new compact run creates its Operator with:

```js
assert.deepEqual(operatorRequest.budget, {})
assert.equal(Object.hasOwn(operatorRequest, "expiresInMs"), false)
```

Assert resuming a v2 run never calculates remaining elapsed time, Turn count, token usage, cost, Target/Judge counts, or Evaluation counts. Keep a v1 recovery test proving the old frozen snapshot can still open and use its durable evidence.

Add storage/workspace tests accepting Epoch 101 and rejecting zero, fractions, and unsafe integers. Assert `currentEpoch` and public Epoch numbers above 100 parse correctly.

- [ ] **Step 2: Run focused service/storage/control tests**

```bash
cd desktop/rolling-skill
node --test test/optimization-control-service.test.cjs test/optimization-store.test.cjs test/optimization-control-plane.test.cjs
```

Expected: FAIL on `{}` Operator budget construction and the old 100-Epoch validators.

- [ ] **Step 3: Implement v2 service and durable Epoch counting**

For a compact v2 run, `#createOperator` passes `budget: {}` and omits `expiresInMs`. Keep a legacy branch only for v1 snapshots so interrupted historical runs retain their frozen budget semantics.

Remove `operatorTurnsUsed`, approved-limit checkpoint output, and telemetry from new public checkpoints. Return only `limits: {maxEpochs}` for v2 public runs; return legacy mode/target/telemetry fields only when present in v1.

Replace literal Epoch maxima in workspace, store, gateway identities, and public control schemas with positive safe-integer validation. Remove fixed `.max(100)` constraints from the persisted/public Epoch arrays and remove `publicRun()`'s `slice(0, 100)` truncation; the existing store byte-size boundary remains the structural resource guard.

Remove `limitRequest` from `optimization.submit_decision` input and forwarding in domain/control services. Legacy stored approval records remain readable but no new limit approval can be created.

- [ ] **Step 4: Run service/storage/control tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit service and persistence changes**

```bash
git add desktop/rolling-skill/src/optimization/optimization-control-service.cjs desktop/rolling-skill/src/optimization/optimization-store.cjs desktop/rolling-skill/src/optimization/optimization-workspace.cjs desktop/rolling-skill/src/control-plane/contracts.cjs desktop/rolling-skill/src/control-plane/domain-services.cjs desktop/rolling-skill/test/optimization-control-service.test.cjs desktop/rolling-skill/test/optimization-store.test.cjs desktop/rolling-skill/test/optimization-control-plane.test.cjs
git commit -m "feat: persist Optimization by Epoch count only"
```

### Task 6: Reduce the App setup to one closed-loop field

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Test: `desktop/rolling-skill/scripts/renderer-smoke.cjs`

- [ ] **Step 1: Add failing request and DOM assertions**

Change the workbench unit fixture to provide only:

```js
limits: {maxEpochs: "5"}
```

Assert `buildOptimizationConfig` returns `limits: {maxEpochs: 5}` and has no `mode`, `target`, or `telemetry`. Assert `buildOperatorSessionRequest` returns `budget: {}` without requiring `maxIterations`.

Extend Renderer smoke assertions so the real setup DOM has exactly one `[data-optimization-limit]`, no `[data-operator-max-iterations]`, no `[data-optimization-target]`, and visible Chinese helper text containing “改进 Skill、安装候选版本、完整评测和结果复盘”.

- [ ] **Step 2: Run workbench tests and Renderer smoke**

```bash
cd desktop/rolling-skill
node --test test/operator-workbench.test.cjs
npm run smoke:renderer
```

Expected: FAIL because obsolete controls and request fields still exist.

- [ ] **Step 3: Implement the simplified form**

Replace the old fieldset with:

```html
<fieldset class="operator-fieldset operator-epoch-boundary">
    <legend data-i18n="operatorEpochBoundary">Closed-loop boundary</legend>
    <label class="operator-field">
        <span data-i18n="operatorMaxEpochs">Maximum closed-loop Epochs</span>
        <input type="number" min="1" step="1" value="5" data-optimization-limit="maxEpochs" required />
    </label>
    <p class="operator-help" data-i18n="operatorEpochBoundaryHelp">One Epoch includes improving the Skill, installing the Candidate, running the complete evaluation, and reviewing the result. Agent operations inside the Epoch are unlimited.</p>
</fieldset>
```

Remove the optimization mode selector and all old limit/target controls. Remove the generic maximum-iterations label/input; retain the permanent-deletion opt-in for ordinary self-operation and hide that details block while Optimization setup is selected.

Make `optimizationValues()` collect only `limits.maxEpochs`. Validate it as a positive safe integer without a product maximum. Remove telemetry inference and all obsolete `remaining` budget display fields. Generic session requests send `budget: {}`.

Add matching English and Chinese strings and delete unused translation keys only after `rg` confirms no consumers remain.

- [ ] **Step 4: Run workbench tests and Renderer smoke**

Run the commands from Step 2.

Expected: PASS with the single Epoch field visible and no layout overflow.

- [ ] **Step 5: Commit the App surface**

```bash
git add desktop/rolling-skill/renderer desktop/rolling-skill/test/operator-workbench.test.cjs desktop/rolling-skill/scripts/renderer-smoke.cjs
git commit -m "feat: show only the closed-loop Epoch boundary"
```

### Task 7: Update reports and end-to-end compatibility coverage

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-report.cjs`
- Modify: `desktop/rolling-skill/test/optimization-report.test.cjs`
- Modify: `desktop/rolling-skill/test/operator-restart-recovery.integration.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-contracts.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane-policy.test.cjs`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Add failing report and restart expectations**

Assert reports contain:

```text
最大闭环次数：5
结束原因：达到最大闭环次数（max_epochs_reached）
```

and do not contain `预算与遥测`, Token, cost, duration, patience, or minimum improvement sections for v2 runs.

Add a restart integration scenario that interrupts an unbounded Operator during Epoch N, restores the same Epoch, allows more Agent Turns, and completes without an iteration-limit transcript entry.

- [ ] **Step 2: Run report and restart tests**

```bash
cd desktop/rolling-skill
node --test test/optimization-report.test.cjs test/operator-restart-recovery.integration.test.cjs test/control-plane-contracts.test.cjs test/control-plane-policy.test.cjs
```

Expected: FAIL on old budget report copy or old compact-contract assumptions.

- [ ] **Step 3: Update reporting and documentation**

Change the report header to list `snapshot.limits.maxEpochs`, preserve each Epoch’s evaluation evidence, and remove aggregate budget/telemetry wording for v2. Keep legacy report rendering defensive when old checkpoints contain telemetry.

Update `README.md` to define one Epoch as candidate editing, experiment installation, complete evaluation, and review; state that Agent Turn counts are not a user limit and internal process/IPC timeouts are fault protection only.

- [ ] **Step 4: Run report and restart tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit reporting and compatibility coverage**

```bash
git add desktop/rolling-skill/src/optimization/optimization-report.cjs desktop/rolling-skill/test/optimization-report.test.cjs desktop/rolling-skill/test/operator-restart-recovery.integration.test.cjs desktop/rolling-skill/test/control-plane-contracts.test.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs desktop/rolling-skill/README.md
git commit -m "docs: describe Epoch-only optimization automation"
```

### Task 8: Full verification, installation, and handoff

**Files:**
- Verify: `desktop/rolling-skill/src/**/*.cjs`
- Verify: `desktop/rolling-skill/renderer/**/*`
- Do not add: `rolling-skill-dsh-plugin-*.tgz`

- [ ] **Step 1: Run syntax and whitespace checks**

```bash
git diff --check
find desktop/rolling-skill/src desktop/rolling-skill/test -name '*.cjs' -print0 | xargs -0 -n1 node --check
node --check desktop/rolling-skill/renderer/operator-workbench.js
node --check desktop/rolling-skill/renderer/renderer.js
```

Expected: every command exits 0.

- [ ] **Step 2: Run the complete Desktop test suite**

```bash
cd desktop/rolling-skill
npm test
```

Expected: all tests PASS with zero failures, cancellations, or skips introduced by this change.

- [ ] **Step 3: Run the real Electron Renderer smoke test**

```bash
cd desktop/rolling-skill
npm run smoke:renderer
```

Expected: exits 0 and confirms the single Epoch field, removed obsolete controls, and usable layout.

- [ ] **Step 4: Review the final diff and tracked file set**

```bash
git status --short
git diff --stat rolling-skill/main...HEAD
git diff rolling-skill/main...HEAD -- desktop/rolling-skill
git ls-files 'rolling-skill-dsh-plugin-*.tgz'
```

Expected: only intended App/docs/tests are changed; the final command prints nothing.

- [ ] **Step 5: Build, sign, and reinstall the App using the repository’s established macOS flow**

```bash
cd desktop/rolling-skill
npm run pack:mac
```

Then replace `/Applications/Rolling Skill.app` using the same backup, signing, and installation procedure already used for the current installed build. Launch it and visually verify the self-operation setup from a user perspective.

Expected: the installed App launches; Optimization setup shows only “最大闭环次数（Epoch）”; ordinary setup has no Agent-operation count; starting an Optimization passes preflight without old budget fields.

- [ ] **Step 6: Commit any final verification-only fixes and push**

```bash
git status --short
git push rolling-skill main
```

Expected: `main` is pushed; all `rolling-skill-dsh-plugin-*.tgz` files remain untracked and absent from every commit.
