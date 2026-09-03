# Rolling Skill Single Final Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Optimization's release approval, install approval, and final regression with one user decision that either releases and installs the validated Candidate or restores the pre-optimization installation.

**Architecture:** Keep the persisted Operator approval system as the single source of truth and introduce one `optimization.release-install` action. The Runner remains the owner of release, installation, rollback, and terminal transitions; App and DSH only resolve the same approval and display progress. Legacy final-regression fields remain readable but are not written by new runs.

**Tech Stack:** CommonJS Node.js state machine and `node:test`; Electron renderer JavaScript; React/TypeScript DSH client; esbuild-generated DSH bundles.

---

### Task 1: Lock the new Runner behavior with failing tests

**Files:**
- Modify: `desktop/rolling-skill/test/optimization-runner.test.cjs`

- [ ] **Step 1: Change the engine-order test to require one final approval and no final regression**

Update the happy-path assertions to require:

```js
assert.deepEqual(fixture.evaluationCalls.map((entry) => entry.kind), [
    "baseline", "candidate", "candidate",
])
assert.deepEqual(fixture.approvalCalls.map((entry) => entry.kind), ["release-install"])
assert.equal(stored.checkpoint.finalEvaluationArtifactId, undefined)
assert.equal(stored.checkpoint.finalRegressionPassed, undefined)
```

- [ ] **Step 2: Add rejection and installation-failure expectations**

Assert that rejecting `release-install` never calls the release manager and restores experiment targets. Keep the formal-install failure case, but remove the final-regression failure fixture.

- [ ] **Step 3: Run the focused test and verify RED**

Run `node --test desktop/rolling-skill/test/optimization-runner.test.cjs`.

Expected: FAIL because the Runner still requests `release` and `install`, and still calls `final-regression`.

### Task 2: Implement the single approval Runner and state transition

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-runner.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-store.cjs`
- Modify: `desktop/rolling-skill/test/optimization-store.test.cjs`

- [ ] **Step 1: Write a failing Store transition test**

Build a Run through Candidate evaluation and approval, then require this path:

```js
store.transitionRun(runId, "waiting_approval")
store.transitionRun(runId, "installing", {checkpoint: {releasePhase: "released-install"}})
store.updateEpoch(runId, epochId, {status: "succeeded"})
store.transitionRun(runId, "succeeded")
```

Verify the Epoch contains only the Candidate evaluation artifact.

- [ ] **Step 2: Run the Store test and verify RED**

Run `node --test desktop/rolling-skill/test/optimization-store.test.cjs`.

Expected: FAIL on `installing -> succeeded`.

- [ ] **Step 3: Replace release-and-verify with release-and-install**

Request one approval:

```js
const approval = await this.approvals.request({
    kind: "release-install",
    parentJobId: control.parentJobId,
    runId: control.runId,
    epoch: context.epochNumber,
    candidate: clone(context.candidate),
})
```

Reject calls the existing restore path. Approve publishes the immutable Candidate and awaits formal installation. On success write `finalApprovalId`, `releasedVersionId`, and `releasedInstallArtifactId`, terminalize the Epoch and Run, and do not create another Evaluation.

- [ ] **Step 4: Allow the successful direct Store transition**

Add `succeeded` to valid successors of `installing`. Preserve legacy validation for persisted old final-regression Runs, but do not route new Runs through it.

- [ ] **Step 5: Run Runner and Store tests and verify GREEN**

Run `node --test desktop/rolling-skill/test/optimization-runner.test.cjs desktop/rolling-skill/test/optimization-store.test.cjs`.

Expected: PASS.

### Task 3: Expose the combined approval contract and report

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `packages/rolling-skill-core/src/operator-services.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-report.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-contracts.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-report.test.cjs`
- Modify: `packages/rolling-skill-core/test/operator-services.test.cjs`

- [ ] **Step 1: Write failing contract and report tests**

Require public checkpoints to expose `finalApprovalId`; require reports for new Runs to contain “最终审批与安装” without “最终回归”; and require App plus core gateways to emit `optimization.release-install` with release-and-install risk text.

- [ ] **Step 2: Run focused tests and verify RED**

Run `node --test desktop/rolling-skill/test/optimization-control-contracts.test.cjs desktop/rolling-skill/test/optimization-report.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs`.

Expected: FAIL because the combined contract is absent.

- [ ] **Step 3: Implement the public and audit contract**

Add `finalApprovalId` to public checkpoint projection and validation. Give `release-install` a deterministic version label and the risk “Release the selected immutable Optimization Candidate and install it on every frozen target Runtime”. Keep old checkpoint fields optional for history.

- [ ] **Step 4: Update the report**

Render “最终审批与安装”, final approval status, Released version, formal installation Artifact, and recovery state. Render a legacy regression note only when old evidence exists.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 4: Put the decision in the Electron App optimization detail

**Files:**
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`

- [ ] **Step 1: Write failing renderer tests**

Create a snapshot with a pending `optimization.release-install` approval and active Optimization Run. Assert the Optimization panel renders “安装改进版” and “回退原版本” using the existing approval ID, and no final-regression label.

- [ ] **Step 2: Run the renderer unit test and verify RED**

Run `node --test desktop/rolling-skill/test/operator-workbench.test.cjs`.

Expected: FAIL because controls only exist in the generic approval queue.

- [ ] **Step 3: Render the persisted approval in the Optimization panel**

Select the pending combined approval owned by the active Optimization Job. Render semantic buttons in the Optimization actions area and reuse the existing resolver and approval ID; do not create a second approval.

- [ ] **Step 4: Update copy and smoke fixture**

Describe first Candidate experiment installation plus one final release-and-install approval. Remove new-flow final-regression output. Use `finalApprovalId` and an installed terminal state in smoke data.

- [ ] **Step 5: Run App renderer tests and smoke**

Run:

```bash
node --test desktop/rolling-skill/test/operator-workbench.test.cjs
npm run smoke:renderer --workspace ./desktop/rolling-skill
```

Expected: PASS.

### Task 5: Put the same decision in the DSH optimization detail

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/test/optimization-preflight-journey.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/operator-review-journey.test.cjs`

- [ ] **Step 1: Write a failing DSH user-journey test**

Return a pending approval from `operators.summary`, open the matching Optimization detail, click “安装改进版”, and assert:

```js
assert.deepEqual(resolveRequest.input, {
    sessionId: "operator-session-1",
    approvalId: "final-approval-1",
    decision: "approve",
    scope: "once",
})
```

Repeat “回退原版本” with `decision: "reject"` and assert polling does not duplicate the action.

- [ ] **Step 2: Run DSH journey tests and verify RED**

Run `node --test packages/rolling-skill-dsh/test/optimization-preflight-journey.test.cjs packages/rolling-skill-dsh/test/operator-review-journey.test.cjs`.

Expected: FAIL because OptimizationPanel does not load approvals.

- [ ] **Step 3: Load and resolve the shared approval from OptimizationPanel**

Fetch `operators.summary` with initial and polling requests, match the approval to `checkpoint.operatorSessionId`, and render semantic buttons in the open Optimization detail. Refresh approval and Run data after resolution. Keep Operator detail as a compatibility entry with the same labels.

- [ ] **Step 4: Update Chinese and English copy**

Add “最终审批”, “安装改进版”, “回退原版本”, and combined-risk translations. Remove final-regression wording from new-flow descriptions.

- [ ] **Step 5: Run DSH journey tests and verify GREEN**

Run the Step 2 command. Expected: PASS.

### Task 6: Build distributed surfaces and run full verification

**Files:**
- Regenerate: `packages/rolling-skill-dsh/lib/client.js`
- Regenerate: `packages/rolling-skill-dsh/lib/worker.cjs`

- [ ] **Step 1: Build DSH**

Run `npm run build:dsh` and require exit 0. Confirm generated bundles contain `optimization.release-install` with no executable new-flow final-regression branch.

- [ ] **Step 2: Run Optimization and DSH tests**

Run:

```bash
node --test desktop/rolling-skill/test/optimization-*.test.cjs
npm run test:dsh
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run the App suite and renderer smoke**

Run:

```bash
npm test --workspace ./desktop/rolling-skill
npm run smoke:renderer --workspace ./desktop/rolling-skill
```

Expected: PASS with zero failures.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Confirm intended hunks sit safely on top of the pre-existing dirty worktree.

- [ ] **Step 5: Leave implementation changes uncommitted**

Relevant files already contain uncommitted user work. Do not create an implementation commit that could accidentally include unrelated pre-existing hunks; report exact files and verification evidence instead.
