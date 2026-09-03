# Operator Automatic Authority and Iteration Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly forbids delegating code changes to subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Electron App self-operation run continuously with all normal workflow actions preauthorized, expose only destructive deletion as an optional risk, replace the multi-dimensional hard budget with one durable iteration limit, and fix the oversized critical-Case checkbox.

**Architecture:** The Renderer derives a fixed automatic action set plus one optional destructive action. Operator protocol and Job storage accept a new `{maxIterations}` budget while preserving legacy seven-field budgets for old sessions. Iteration consumption is enforced durably at the Operator Agent Turn boundary; normal Tool Gateway actions run without approval, provider-native permission requests are automatically declined, and the dedicated Optimization final Candidate approval remains unchanged.

**Tech Stack:** Electron, vanilla JavaScript Renderer, CommonJS Node services, HTML/CSS, `node:test`, Electron Renderer smoke.

---

### Task 1: Freeze the App authority and form contract with failing tests

**Files:**
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`

- [ ] **Step 1: Write failing tests for automatic actions and the single risk option**

Add imports for `AUTOMATIC_OPERATOR_ACTIONS`, `OPTIONAL_OPERATOR_ACTIONS`, and `operatorSessionActions`, then add:

```js
it("preauthorizes every normal Operator action and keeps permanent deletion optional", () => {
    assert.deepEqual(OPTIONAL_OPERATOR_ACTIONS, ["datasets.delete"])
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("runtime.execute"), true)
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("evaluations.execute"), true)
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("skills.release"), true)
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("rubrics.publish"), true)
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("installations.execute"), true)
    assert.equal(AUTOMATIC_OPERATOR_ACTIONS.includes("datasets.delete"), false)
    assert.deepEqual(operatorSessionActions(false), AUTOMATIC_OPERATOR_ACTIONS)
    assert.deepEqual(operatorSessionActions(true), [...AUTOMATIC_OPERATOR_ACTIONS, "datasets.delete"])
})
```

Update the setup-request test so its input uses `allowPermanentDelete: false` and `maxIterations: "50"`, and assert:

```js
assert.deepEqual(request.actions, AUTOMATIC_OPERATOR_ACTIONS)
assert.deepEqual(request.budget, {maxIterations: 50})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test desktop/rolling-skill/test/operator-workbench.test.cjs
```

Expected: FAIL because the automatic action exports do not exist and the request builder still expects `actionIds` plus the legacy budget fields.

- [ ] **Step 3: Implement the Renderer authority helpers and request shape**

Keep `OPERATOR_ACTIONS` as the complete control catalog, then add:

```js
const OPTIONAL_OPERATOR_ACTIONS = Object.freeze(["datasets.delete"])
const AUTOMATIC_OPERATOR_ACTIONS = Object.freeze(
    OPERATOR_ACTIONS.filter((action) => !OPTIONAL_OPERATOR_ACTIONS.includes(action)),
)

function operatorSessionActions(allowPermanentDelete = false) {
    return allowPermanentDelete
        ? [...AUTOMATIC_OPERATOR_ACTIONS, ...OPTIONAL_OPERATOR_ACTIONS]
        : [...AUTOMATIC_OPERATOR_ACTIONS]
}
```

In `buildOperatorSessionRequest`, remove caller-supplied `actionIds`, derive `actions` with `operatorSessionActions(values.allowPermanentDelete === true)`, validate `maxIterations` as a positive safe integer, and return:

```js
actions: operatorSessionActions(values.allowPermanentDelete === true),
budget: {maxIterations},
```

Export all three new symbols for the test harness.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same `node --test` command. Expected: all `operator-workbench` tests pass.

- [ ] **Step 5: Commit the contract slice**

```bash
git add desktop/rolling-skill/renderer/operator-workbench.js desktop/rolling-skill/test/operator-workbench.test.cjs
git commit -m "feat: preauthorize normal Operator actions"
```

### Task 2: Support one iteration budget while preserving legacy jobs

**Files:**
- Create: `desktop/rolling-skill/src/operator/operator-budget.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-protocol.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-store.cjs`
- Test: `desktop/rolling-skill/test/operator-protocol.test.cjs`
- Test: `desktop/rolling-skill/test/operator-job-store.test.cjs`

- [ ] **Step 1: Write failing budget compatibility tests**

Add tests proving that a new budget is exactly `{maxIterations: 50}`, `0`, fractions, unknown keys, and mixtures with legacy fields are rejected, while the existing seven-field budget fixture still loads unchanged.

```js
it("stores a positive iteration-only budget for new Operator jobs", () => {
    const created = store.createJob({
        sessionId: session.id,
        type: "operator-session",
        objective: "Run autonomously",
        budget: {maxIterations: 50},
    })
    assert.deepEqual(created.budget, {maxIterations: 50})
})
```

In `operator-protocol.test.cjs`, assert that `protocolSnapshot` accepts `{maxIterations: 50}` and that generated instructions mention the iteration ceiling but do not tell the Agent to request a budget expansion.

- [ ] **Step 2: Run both tests and verify RED**

```bash
node --test desktop/rolling-skill/test/operator-protocol.test.cjs desktop/rolling-skill/test/operator-job-store.test.cjs
```

Expected: FAIL with `Operator budget maxDurationMs is invalid` or `Unknown Operator Job budget`.

- [ ] **Step 3: Add a shared union normalizer**

Create `operator-budget.cjs` with these exports:

```js
const ITERATION_BUDGET_FIELDS = Object.freeze(["maxIterations"])
const LEGACY_BUDGET_FIELDS = Object.freeze([
    "maxDurationMs",
    "maxRuntimeTurns",
    "maxEvaluations",
    "maxTargetExecutions",
    "maxJudgeExecutions",
    "maxTokens",
    "maxReportedCost",
])

function isIterationBudget(value) {
    return Object.hasOwn(value, "maxIterations")
}

function normalizeOperatorBudget(value, {error = TypeError} = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new error("Operator budget must be a plain object")
    }
    if (isIterationBudget(value)) {
        if (Object.keys(value).length !== 1 || !Number.isSafeInteger(value.maxIterations) || value.maxIterations < 1) {
            throw new error("Operator maxIterations must be a positive safe integer")
        }
        return {maxIterations: value.maxIterations}
    }
    const keys = Object.keys(value)
    if (keys.length !== LEGACY_BUDGET_FIELDS.length || keys.some((key) => !LEGACY_BUDGET_FIELDS.includes(key))) {
        throw new error("Legacy Operator budget fields are invalid")
    }
    const normalized = {}
    for (const field of LEGACY_BUDGET_FIELDS) {
        const entry = value[field]
        const optional = field === "maxTokens" || field === "maxReportedCost"
        const valid = optional && entry === null
            ? true
            : field === "maxReportedCost"
                ? Number.isFinite(entry) && entry >= 0
                : Number.isSafeInteger(entry) && entry >= 0
        if (!valid) throw new error(`Legacy Operator budget ${field} is invalid`)
        normalized[field] = entry
    }
    return normalized
}

module.exports = {
    ITERATION_BUDGET_FIELDS,
    LEGACY_BUDGET_FIELDS,
    isIterationBudget,
    normalizeOperatorBudget,
}
```

- [ ] **Step 4: Reuse the normalizer in protocol and Job store**

Replace their duplicated strict seven-field loops with `normalizeOperatorBudget`. Keep the stored legacy object unchanged for restart compatibility. Update Operator instructions for iteration budgets to say the Agent must finish or pause within the frozen iteration count and must not request budget expansion.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the two-file command from Step 2. Expected: all tests pass for both new and legacy budgets.

- [ ] **Step 6: Commit durable budget compatibility**

```bash
git add desktop/rolling-skill/src/operator/operator-budget.cjs desktop/rolling-skill/src/operator/operator-protocol.cjs desktop/rolling-skill/src/operator/job-store.cjs desktop/rolling-skill/test/operator-protocol.test.cjs desktop/rolling-skill/test/operator-job-store.test.cjs
git commit -m "feat: add durable Operator iteration limits"
```

### Task 3: Enforce iterations at Agent Turn boundaries, not Tool fan-out

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/capability-store.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/policy.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/control-plane.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-session-manager.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Test: `desktop/rolling-skill/test/control-plane-capability.test.cjs`
- Test: `desktop/rolling-skill/test/control-plane-policy.test.cjs`
- Test: `desktop/rolling-skill/test/control-plane.test.cjs`
- Test: `desktop/rolling-skill/test/operator-session-manager.test.cjs`
- Test: `desktop/rolling-skill/test/operator-job-engine.test.cjs`

- [ ] **Step 1: Write failing Turn-boundary tests**

Add a fixture with `{maxIterations: 2}`. Assert that the initial Turn and one child-completion Turn start, a third queued boundary does not call `startTurn`, the parent becomes `paused`, and the transcript contains one `operator_iteration_limit_reached` entry with `used: 2` and `limit: 2`.

Also assert that starting one Evaluation with many Case executions does not consume additional iterations.

At the capability layer, assert that an empty Tool-execution budget does not synthesize zero-valued `maxRuntimeTurns` or `maxEvaluations`, and that Runtime/Evaluation actions with no corresponding budget key return `allow` without a reservation.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --test desktop/rolling-skill/test/control-plane-capability.test.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs desktop/rolling-skill/test/control-plane.test.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs
```

Expected: FAIL because `#startTurn` has no durable iteration reservation and the engine only understands legacy budgets.

- [ ] **Step 3: Add durable iteration reservation in `OperatorSessionManager`**

Before calling the Runtime in `#startTurn`, count `operator_iteration_started` transcript entries for the current session. For an iteration budget:

```js
const used = this.#store.getSession(control.sessionId).transcript
    .filter((entry) => entry.kind === "operator_iteration_started").length
if (used >= control.budget.maxIterations) {
    control.paused = true
    if (this.#store.getJob(control.parentJobId).status === "running") {
        this.#store.transitionJob(control.parentJobId, "paused")
    }
    this.#append(control, "operator_iteration_limit_reached", {
        used,
        limit: control.budget.maxIterations,
        reason: "max_iterations_reached",
    })
    return null
}
this.#append(control, "operator_iteration_started", {
    iteration: used + 1,
    limit: control.budget.maxIterations,
})
```

Make `#drainBoundary` keep the undelivered boundary queued when `#startTurn` returns `null`. Existing Pause/Resume retains the transcript count; Resume at the ceiling stays paused instead of silently resetting the limit. A new task is required for a larger total limit in this slice.

- [ ] **Step 4: Make `OperatorJobEngine` treat iteration budgets as having no Tool-execution budget**

For `{maxIterations}`, skip duration, Evaluation, Target/Judge, token, and cost preflight/reservation logic. Preserve all existing legacy-budget behavior for restored old jobs. Remove budget-expansion decisions from the new iteration-budget path.

Change `capabilityBudget` in `OperatorSessionManager` to return `{}` for an iteration budget and the two legacy limits for an old budget. Change `CapabilityStore` to preserve only budget keys actually supplied instead of filling missing keys with zero. In Control Policy, an absent Tool budget key means unbounded within the frozen action/scope and returns `allow` without a reservation; present legacy limits keep their existing compare-and-swap behavior.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: new iteration tests and existing legacy recovery tests pass.

- [ ] **Step 6: Commit iteration enforcement**

```bash
git add desktop/rolling-skill/src/control-plane/capability-store.cjs desktop/rolling-skill/src/control-plane/policy.cjs desktop/rolling-skill/src/control-plane/control-plane.cjs desktop/rolling-skill/src/operator/operator-session-manager.cjs desktop/rolling-skill/src/operator/job-engine.cjs desktop/rolling-skill/test/control-plane-capability.test.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs desktop/rolling-skill/test/control-plane.test.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs
git commit -m "feat: stop Operator jobs at iteration boundaries"
```

### Task 4: Remove runtime approvals from preauthorized self-operation

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/policy.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/control-plane.cjs`
- Modify: `desktop/rolling-skill/src/operator/job-engine.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-session-manager.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Test: `desktop/rolling-skill/test/control-plane-policy.test.cjs`
- Test: `desktop/rolling-skill/test/control-plane.test.cjs`
- Test: `desktop/rolling-skill/test/operator-job-engine.test.cjs`
- Test: `desktop/rolling-skill/test/operator-session-manager.test.cjs`
- Test: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing preauthorization tests**

Add a policy input flag named `operatorPreauthorized`. Assert that granted `skills.release`, `rubrics.publish`, `installations.execute`, and optional `datasets.delete` return `allow` when the flag is true, but an omitted action returns `ACTION_NOT_GRANTED` before any approval decision.

At the engine layer, run `skills.release`, `rubrics.publish`, `installations.start`, and a preauthorized `datasets.delete`; assert each Step succeeds and `store.listApprovals(job.id)` stays empty.

Add a Main source test asserting that the Operator manager receives an automatic-decline callback rather than `showRuntimePermissionDialog`.

- [ ] **Step 2: Run the focused approval tests and verify RED**

```bash
node --test desktop/rolling-skill/test/control-plane-policy.test.cjs desktop/rolling-skill/test/control-plane.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs desktop/rolling-skill/test/main-bridge.test.cjs
```

Expected: FAIL because high-risk definitions still return `approval_required`, Job Engine repeats the mandatory gate, and Main still opens the Runtime permission dialog.

- [ ] **Step 3: Make an Operator route's frozen actions the authorization gate**

Pass `operatorPreauthorized: operatorRoute !== null` from `ControlPlane` to policy. In policy, validate object scope and action membership before risk handling. If `operatorPreauthorized === true` and the action is granted, return the normal allow/reservation decision without `approvalDecision` for method risk.

Keep the existing approval decision for non-Operator callers. Do not change `OptimizationRunner` or its direct `jobEngine.requestApproval` final decision path.

- [ ] **Step 4: Remove the duplicate Job Engine mandatory gate for new self-operation**

Delete the `operatorApprovalRequirement` call from `#preInvokeDecision`. Retain explicit `requestApproval` APIs used by dedicated workflows and legacy approval recovery. A trusted Control Policy denial must remain a denial, never turn into an approval.

- [ ] **Step 5: Auto-decline provider-native permission prompts**

When constructing the App's `OperatorSessionManager`, use:

```js
requestPermission: () => "decline",
```

The manager continues recording `permission_requested` and `permission_resolved`. This prevents accidental shell/file-system actions from opening UI while normal work remains available through Tool Gateway actions.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: no ordinary self-operation Step enters `waiting_approval`; ungranted deletion is denied; provider permission is declined; dedicated manual approval unit tests remain green.

- [ ] **Step 7: Commit approval removal**

```bash
git add desktop/rolling-skill/src/control-plane/policy.cjs desktop/rolling-skill/src/control-plane/control-plane.cjs desktop/rolling-skill/src/operator/job-engine.cjs desktop/rolling-skill/src/operator/operator-session-manager.cjs desktop/rolling-skill/src/main.cjs desktop/rolling-skill/test/control-plane-policy.test.cjs desktop/rolling-skill/test/control-plane.test.cjs desktop/rolling-skill/test/operator-job-engine.test.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs desktop/rolling-skill/test/main-bridge.test.cjs
git commit -m "feat: run preauthorized Operator actions without prompts"
```

### Task 5: Simplify the App form and fix checkbox layout

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Test: `desktop/rolling-skill/test/operator-workbench.test.cjs`

- [ ] **Step 1: Write failing Renderer structure and layout assertions**

Assert the form has no `#operator-permission-grants` and no legacy `data-operator-budget` fields. Assert it has one `[data-operator-max-iterations]` input with value `50` and one unchecked `[data-operator-risk="datasets.delete"]` checkbox.

In Renderer smoke, read bounding boxes for `[data-optimization-target="requireCriticalCases"]` and its adjacent span and assert:

```js
if (checkbox.width < 12 || checkbox.width > 18 || checkbox.height < 12 || checkbox.height > 18) {
    throw new Error("Critical Case checkbox is not compact")
}
if (Math.abs(checkboxCenterY - labelCenterY) > 3) {
    throw new Error("Critical Case checkbox is not vertically aligned")
}
```

- [ ] **Step 2: Run source tests and smoke to verify RED**

```bash
node --test desktop/rolling-skill/test/operator-workbench.test.cjs
npm run smoke:renderer --prefix desktop/rolling-skill
```

Expected: source test finds the old permission/budget grid and smoke reports a 100%-wide, 34px-high checkbox.

- [ ] **Step 3: Replace “权限与预算” with “自动化边界”**

In `index.html`, keep one compact section containing:

```html
<details class="operator-setup-details">
    <summary data-i18n="operatorAutomationBoundary">Automation boundary</summary>
    <p class="operator-help" data-i18n="operatorAutomaticAuthorityHelp">Normal work inside the selected scope can run, evaluate, publish, and install automatically. Every action remains audited.</p>
    <div class="operator-boundary-grid">
        <label class="operator-field">
            <span data-i18n="operatorMaxIterations">Maximum iterations</span>
            <input type="number" min="1" value="50" data-operator-max-iterations required />
        </label>
        <label class="operator-check">
            <input type="checkbox" data-operator-risk="datasets.delete" />
            <span data-i18n="operatorAllowPermanentDelete">Allow permanent Dataset or Case deletion</span>
        </label>
    </div>
</details>
```

Update `createSession` to read these two values. Remove dynamic rendering/localization of 21 action checkboxes. Update the right-side Job summary to display only the iteration budget for new jobs and retain legacy labels for old jobs.

- [ ] **Step 4: Add Chinese and English copy**

Add `operatorAutomationBoundary`, `operatorAutomaticAuthorityHelp`, `operatorMaxIterations`, `operatorAllowPermanentDelete`, and `operatorIterationLimitReached`. Remove obsolete setup copy only when no remaining Renderer path references it.

- [ ] **Step 5: Fix checkbox selector specificity**

Change number-field rules to target number inputs and make checkboxes explicit:

```css
.operator-budget-grid > label:not(.operator-check),
.operator-boundary-grid > label:not(.operator-check) {
    display: grid;
    gap: 4px;
}

.operator-budget-grid input[type="number"],
.operator-boundary-grid input[type="number"] {
    width: 100%;
    min-height: 34px;
}

.operator-check input[type="checkbox"] {
    width: 14px;
    height: 14px;
    min-width: 14px;
    min-height: 14px;
    margin: 0;
    padding: 0;
    flex: 0 0 14px;
}
```

Ensure `.operator-budget-grid .operator-check` and `.operator-boundary-grid .operator-check` use Flex with `align-items: center` at desktop and narrow breakpoints.

- [ ] **Step 6: Run focused tests and smoke to verify GREEN**

Run the commands from Step 2. Expected: source tests pass and Renderer smoke reports a compact aligned checkbox plus the simplified boundary form.

- [ ] **Step 7: Commit the App UI slice**

```bash
git add desktop/rolling-skill/renderer/index.html desktop/rolling-skill/renderer/renderer.js desktop/rolling-skill/renderer/operator-workbench.js desktop/rolling-skill/renderer/styles.css desktop/rolling-skill/scripts/renderer-smoke.cjs desktop/rolling-skill/scripts/renderer-smoke-preload.cjs desktop/rolling-skill/test/operator-workbench.test.cjs
git commit -m "fix: simplify Operator automation controls"
```

### Task 6: Preserve dedicated Optimization approval and verify the user journey

**Files:**
- Modify: `desktop/rolling-skill/test/optimization-runner.test.cjs`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Add the cross-feature regression**

Add a test that runs a normal self-operation release without approval, then separately advances an Optimization Run to Candidate completion and asserts exactly one pending `optimization.release-install` approval still exists.

- [ ] **Step 2: Run the regression and verify it passes without implementation changes**

```bash
node --test desktop/rolling-skill/test/optimization-runner.test.cjs desktop/rolling-skill/test/operator-workbench.test.cjs
```

Expected: PASS, proving the generic approval removal did not erase the dedicated final decision.

- [ ] **Step 3: Update product documentation**

Document that ordinary self-operation actions are preauthorized inside frozen scope, permanent Dataset/Case deletion is the only current opt-in action, provider-native direct permissions are declined, and new tasks use only maximum iterations. Preserve the section describing the single final Optimization approval.

- [ ] **Step 4: Run full verification**

```bash
node --check desktop/rolling-skill/renderer/operator-workbench.js
node --check desktop/rolling-skill/src/operator/operator-budget.cjs
node --check desktop/rolling-skill/src/operator/operator-protocol.cjs
node --check desktop/rolling-skill/src/operator/operator-session-manager.cjs
node --check desktop/rolling-skill/src/operator/job-engine.cjs
node --check desktop/rolling-skill/src/control-plane/policy.cjs
node --check desktop/rolling-skill/src/control-plane/control-plane.cjs
npm test --prefix desktop/rolling-skill
npm run smoke:renderer --prefix desktop/rolling-skill
git diff --check
```

Expected: Desktop suite has zero failures, Renderer smoke returns `rendererErrors: 0`, syntax checks exit 0, and `git diff --check` produces no output.

- [ ] **Step 5: Commit and push the completed implementation**

```bash
git add desktop/rolling-skill docs/superpowers/specs/2026-09-03-operator-automatic-authority-and-iteration-limit-design.md docs/superpowers/plans/2026-09-03-operator-automatic-authority-and-iteration-limit.md
git commit -m "docs: describe automatic Operator authority"
git push rolling-skill main
```

Do not add any `rolling-skill-dsh-plugin-*.tgz` file.
