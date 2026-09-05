# Skill Optimization Direction and Playbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional user optimization direction and a frozen, versioned Skill optimization Playbook to new App and DSH multi-Epoch optimization tasks.

**Architecture:** The canonical Playbook and phase-message builders live in the packaged Desktop optimization domain; Core keeps a forwarding module so DSH bundles the identical implementation. A v3 optimization contract freezes the normalized direction and complete Playbook snapshot, while v1/v2 runs retain their original semantics. The controller injects stable task guidance when it creates or recreates the Operator and sends shared evidence-rich Candidate and Decision messages at phase boundaries.

**Tech Stack:** Node.js 22 CommonJS, Electron renderer JavaScript, React/TypeScript DSH client, Zod control contracts, Node test runner, esbuild, electron-builder.

---

### Task 1: Canonical Optimization Playbook and Message Builder

**Files:**
- Create: `desktop/rolling-skill/src/optimization/optimization-playbook.cjs`
- Create: `desktop/rolling-skill/src/optimization/optimization-agent-context.cjs`
- Modify: `packages/rolling-skill-core/src/optimization-agent-context.cjs`
- Create: `desktop/rolling-skill/test/optimization-agent-context.test.cjs`
- Modify: `packages/rolling-skill-core/test/optimization-agent-context.test.cjs`

- [ ] **Step 1: Write failing Playbook snapshot tests**

Test the stable identity, six reviewed sources, required method sections, deep immutability and canonical SHA-256:

```js
const first = currentOptimizationPlaybook()
assert.equal(first.id, "rolling-skill-optimization")
assert.equal(first.version, 1)
assert.match(first.content, /从用户视角理解完整 Skill/u)
assert.match(first.content, /建立证据矩阵/u)
assert.equal(first.sources.length, 6)
assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u)
assert.deepEqual(validateOptimizationPlaybook(first), first)
```

- [ ] **Step 2: Write failing phase-message tests**

Candidate messages must contain the complete frozen Playbook, normalized direction, baseline/current Case evidence, omitted-result count and `optimization.submit_candidate`. Decision messages must contain comparison evidence, direction and `optimization.submit_decision`. Oversized result bodies must be trimmed before the Playbook, direction or failure index.

```js
const candidate = optimizationRequestMessage({
  run: {id: "run-1", snapshot: {
    limits: {maxEpochs: 3},
    optimizationDirection: "重点改善异常下钻",
    playbook: currentOptimizationPlaybook(),
  }},
  kind: "candidate",
  epoch: 1,
  baselineEvaluation: baseline,
  currentEvaluation: baseline,
})
assert.match(candidate, /重点改善异常下钻/u)
assert.match(candidate, /从用户视角理解完整 Skill/u)
assert.match(candidate, /optimization\.submit_candidate/u)
assert.ok(candidate.length <= 32_768)
```

- [ ] **Step 3: Run tests and verify RED**

Run: `node --test desktop/rolling-skill/test/optimization-agent-context.test.cjs packages/rolling-skill-core/test/optimization-agent-context.test.cjs`

Expected: FAIL because the Desktop Playbook/context modules do not exist.

- [ ] **Step 4: Implement the immutable Playbook registry**

Export the exact public API:

```js
const OPTIMIZATION_PLAYBOOK_ID = "rolling-skill-optimization"
const OPTIMIZATION_PLAYBOOK_VERSION = 1

module.exports = {
  OPTIMIZATION_PLAYBOOK_ID,
  OPTIMIZATION_PLAYBOOK_VERSION,
  currentOptimizationPlaybook,
  validateOptimizationPlaybook,
}
```

`currentOptimizationPlaybook()` returns a deeply frozen `{id, version, digest, content, sources}` snapshot. Validation rejects unknown fields, non-HTTPS URLs, invalid timestamps and digest mismatch. Content implements the approved five stages: user journey, evidence matrix, generalizable edits, candidate self-check and full-regression decision.

- [ ] **Step 5: Implement one shared phase-message builder**

Move and extend the existing Core evidence projection into the Desktop optimization domain. Export:

```js
function optimizationDirectionText(value) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "系统全面优化"
}

module.exports = {
  optimizationDirectionText,
  optimizationRequestMessage,
  optimizationTaskObjective,
}
```

Keep messages at or below 32,768 characters and treat Case/model text as untrusted data. Replace the Core implementation with a direct re-export from `desktop/rolling-skill/src/optimization/optimization-agent-context.cjs`.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 3 command. Expected: all Playbook/context tests PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/rolling-skill/src/optimization/optimization-playbook.cjs \
  desktop/rolling-skill/src/optimization/optimization-agent-context.cjs \
  desktop/rolling-skill/test/optimization-agent-context.test.cjs \
  packages/rolling-skill-core/src/optimization-agent-context.cjs \
  packages/rolling-skill-core/test/optimization-agent-context.test.cjs
git commit -m "feat: add frozen optimization playbook"
```

### Task 2: V3 Optimization Contract and Public Projection

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-contract.cjs`
- Modify: `desktop/rolling-skill/src/control-plane/contracts.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/test/optimization-contract.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-contracts.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-service.test.cjs`

- [ ] **Step 1: Write failing v3 contract tests**

```js
const parsed = parseOptimizationConfig({
  ...compactConfig(),
  optimizationDirection: "  改善下钻  ",
})
assert.equal(parsed.schemaVersion, "rolling-skill-optimization-config/v3")
assert.equal(parsed.optimizationDirection, "改善下钻")
assert.equal(parseOptimizationConfig({
  ...compactConfig(), optimizationDirection: null,
}).optimizationDirection, null)
assert.throws(() => parseOptimizationConfig({
  ...compactConfig(), optimizationDirection: "x".repeat(8_001),
}), /direction.*long/i)
```

Freeze a v3 Run with `currentOptimizationPlaybook()`, verify direction and Playbook both affect its digest, reject a mutated Playbook, and retain passing v1/v2 fixture validation.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test desktop/rolling-skill/test/optimization-contract.test.cjs desktop/rolling-skill/test/optimization-control-contracts.test.cjs`

Expected: FAIL because v3 fields and schema do not exist.

- [ ] **Step 3: Implement explicit v1/v2/v3 parsing and freezing**

```js
const LEGACY_OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v1"
const COMPACT_OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v2"
const OPTIMIZATION_CONFIG_SCHEMA = "rolling-skill-optimization-config/v3"
const LEGACY_FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v1"
const COMPACT_FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v2"
const FROZEN_OPTIMIZATION_RUN_SCHEMA = "rolling-skill-frozen-optimization-run/v3"
```

Infer v1 from legacy target/mode/telemetry fields, v3 from required presence of `optimizationDirection`, and otherwise v2. Normalize blank direction to `null`, trim non-empty text, and reject over 8,000 characters. V3 frozen bodies require a validated Playbook and include both new fields in the canonical digest; validation never adds them to v1/v2 bodies.

- [ ] **Step 4: Add v3 Zod input and public output**

Add a strict Epoch-only v3 input with `optimizationDirection: z.string().max(8_000).nullable()`. Expose only the safe Playbook identity in public Run projections:

```js
optimizationDirection: z.string().max(8_000).nullable(),
playbook: z.object({
  id: boundedText(200, "Optimization Playbook id"),
  version: z.number().int().positive(),
  digest: boundedText(80, "Optimization Playbook digest"),
}).strict(),
```

- [ ] **Step 5: Freeze the current Playbook during v3 start/preflight**

In `OptimizationControlService.#snapshot`, pass `currentOptimizationPlaybook()` only for v3 configs. Extend `publicRun()` and `publicPreflight()` with normalized direction and Playbook identity/digest. Keep v1/v2 public shapes unchanged.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test desktop/rolling-skill/test/optimization-contract.test.cjs desktop/rolling-skill/test/optimization-control-contracts.test.cjs desktop/rolling-skill/test/optimization-control-service.test.cjs`

Expected: all tests PASS, including historical compatibility.

- [ ] **Step 7: Commit**

```bash
git add desktop/rolling-skill/src/optimization/optimization-contract.cjs \
  desktop/rolling-skill/src/control-plane/contracts.cjs \
  desktop/rolling-skill/src/optimization/optimization-control-service.cjs \
  desktop/rolling-skill/test/optimization-contract.test.cjs \
  desktop/rolling-skill/test/optimization-control-contracts.test.cjs \
  desktop/rolling-skill/test/optimization-control-service.test.cjs
git commit -m "feat: freeze optimization direction and playbook"
```

### Task 3: Controller Injection, Recovery, and Reports

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `packages/rolling-skill-core/src/operator-services.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/src/optimization/optimization-report.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-report.test.cjs`
- Modify: `packages/rolling-skill-core/test/operator-services.test.cjs`

- [ ] **Step 1: Write failing parity and recovery tests**

Capture initial Operator requests and phase `sendMessage` calls. Require App and Core to generate identical objective/Candidate/Decision messages for the same frozen v3 Run. Recreating an Operator must use the Run's frozen Playbook content/digest and direction.

```js
assert.match(operatorRequest.objective, /Rolling Skill Optimization Playbook v1/u)
assert.match(operatorRequest.objective, /重点改善异常下钻/u)
assert.deepEqual(appCandidateMessage, coreCandidateMessage)
assert.equal(resumedObjective, originalObjective)
```

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test desktop/rolling-skill/test/main-bridge.test.cjs desktop/rolling-skill/test/optimization-control-service.test.cjs desktop/rolling-skill/test/optimization-report.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs`

Expected: FAIL because Desktop still sends its short Run-ID message and reports omit direction/Playbook.

- [ ] **Step 3: Replace Desktop's independent messages**

Import the shared builder in `main.cjs` and load the durable Run plus referenced evaluation runs in the gateway callback:

```js
onRequest: ({runId, kind, epoch, operatorSessionId}) => {
  const run = optimizationStore.getRun(runId)
  const evaluation = (id) => id ? store.getEvaluationRun(id) : null
  return operatorSessionManager.sendMessage(operatorSessionId, optimizationRequestMessage({
    run, kind, epoch,
    baselineEvaluation: evaluation(run.checkpoint.baselineEvaluationRunId),
    currentEvaluation: evaluation(run.checkpoint.activeEvaluationRunId),
  }))
}
```

Use `optimizationTaskObjective(run)` for v3 Operator creation/recreation and retain the old fixed objective for v1/v2 recovery.

- [ ] **Step 4: Make Core use the same frozen builders**

Remove remaining copied optimization objective/message text from Core. Candidate prompts repeat the complete frozen Playbook; Decision prompts include deterministic comparison evidence and the Playbook's decision principles.

- [ ] **Step 5: Extend the Markdown report**

For v3, add `优化方向`, `优化方法` and `方法摘要` near frozen inputs. Render `系统全面优化` for null. V1/v2 reports must not claim they used Playbook v1.

- [ ] **Step 6: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/rolling-skill/src/main.cjs packages/rolling-skill-core/src/operator-services.cjs \
  desktop/rolling-skill/src/optimization/optimization-control-service.cjs \
  desktop/rolling-skill/src/optimization/optimization-report.cjs \
  desktop/rolling-skill/test/main-bridge.test.cjs \
  desktop/rolling-skill/test/optimization-control-service.test.cjs \
  desktop/rolling-skill/test/optimization-report.test.cjs \
  packages/rolling-skill-core/test/operator-services.test.cjs
git commit -m "feat: inject optimization guidance by phase"
```

### Task 4: Desktop Optional Direction Experience

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Write failing renderer tests**

Require optimization mode to relabel the existing textarea as `优化方向（可选）`, switch placeholder/help text, and send a trimmed value or `null` as `optimizationDirection`. Generic self-operation retains required `目标` behavior. Run detail shows direction and Playbook identity.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test desktop/rolling-skill/test/operator-workbench.test.cjs desktop/rolling-skill/test/local-first-surface.test.cjs`

Expected: FAIL because optimization mode ignores the textarea.

- [ ] **Step 3: Implement mode-specific field semantics**

Add stable label/help selectors. In `renderOptimizationSetupMode()`, switch label, placeholder, help and required state without creating a second textarea. Include:

```js
optimizationDirection: selectors.setup.elements.objective.value.trim() || null,
```

in v3 values. Clear the field only after successful task start or explicit reset.

- [ ] **Step 4: Render frozen direction and Playbook identity**

Show `系统全面优化` for null, otherwise the normalized user text. Show `Rolling Skill Optimization Playbook v1` and short digest in the frozen-run summary.

- [ ] **Step 5: Extend renderer smoke coverage**

Drive optimization mode with a blank direction and with `重点改善异常下钻`; inspect outgoing payloads and mode-switch semantics. Verify the generic mode restores `目标` and required state.

- [ ] **Step 6: Run tests and smoke**

```bash
node --test desktop/rolling-skill/test/operator-workbench.test.cjs desktop/rolling-skill/test/local-first-surface.test.cjs
npm run smoke:renderer --prefix desktop/rolling-skill
```

Expected: unit tests and renderer smoke PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/rolling-skill/renderer/index.html \
  desktop/rolling-skill/renderer/operator-workbench.js \
  desktop/rolling-skill/renderer/renderer.js \
  desktop/rolling-skill/renderer/styles.css \
  desktop/rolling-skill/scripts/renderer-smoke-preload.cjs \
  desktop/rolling-skill/scripts/renderer-smoke.cjs \
  desktop/rolling-skill/test/operator-workbench.test.cjs \
  desktop/rolling-skill/test/local-first-surface.test.cjs
git commit -m "feat: add Desktop optimization direction"
```

### Task 5: DSH Epoch-Only Direction Experience

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationSetupFields.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/package-manifest.test.cjs`
- Modify: `packages/rolling-skill-dsh/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing DSH tests**

Require an optional direction textarea and `optimizationDirection` payload. Assert that `maxMinutes`, `patience`, `minimumImprovement`, `maxTurns`, `minimumScore`, `minimumPassRate` and `requireCriticalCases` no longer appear in DSH optimization setup. `optimizationNumericLimits()` returns only `{limits: {maxEpochs}}`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-dsh/test/package-manifest.test.cjs`

Expected: FAIL because DSH still submits v1 tuning.

- [ ] **Step 3: Implement Epoch-only v3 input**

Reduce the tuning interface to:

```ts
export interface OptimizationTuning {
  activationMode: "automatic" | "explicit"
  maxEpochs: string
}
```

Render only activation mode and maximum Epoch. Add local direction state and include `optimizationDirection.trim() || null` in `configuration()`.

- [ ] **Step 4: Display direction and Playbook in DSH detail**

Extend the public Run type with nullable direction and Playbook identity. Show the frozen value or `系统全面优化`. Keep existing `ActionButton` styling.

- [ ] **Step 5: Bump plugin version**

Change `@rolling-skill/dsh-plugin` from `0.1.69` to `0.1.70` in package metadata and lockfile; update the exact version test.

- [ ] **Step 6: Run tests and build**

```bash
npm run test:dsh
npm run build:dsh
npm run inspect --workspace @rolling-skill/dsh-plugin
```

Expected: all Core/DSH tests PASS and package inspection succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx \
  packages/rolling-skill-dsh/src/client/workbench/OptimizationSetupFields.tsx \
  packages/rolling-skill-dsh/src/client/locale.ts \
  packages/rolling-skill-dsh/src/client/workbench/workbench.css \
  packages/rolling-skill-dsh/test/client-source.test.cjs \
  packages/rolling-skill-dsh/test/package-manifest.test.cjs \
  packages/rolling-skill-dsh/package.json package-lock.json
git commit -m "feat: align DSH optimization direction"
```

### Task 6: Full Verification, Installation, and Delivery

**Files:**
- Modify when new real evidence exists: `docs/quality/dsh-user-journey-audit-2026-09-01.md`
- Modify: `docs/superpowers/specs/2026-09-05-optimization-direction-and-playbook-design.md`
- Add: `docs/superpowers/plans/2026-09-05-optimization-direction-and-playbook.md`

- [ ] **Step 1: Run complete automated verification**

```bash
npm test --prefix desktop/rolling-skill
npm run smoke:renderer --prefix desktop/rolling-skill
npm run test:dsh
npm run build:dsh
npm run pack:mac --prefix desktop/rolling-skill
git diff --check
```

Expected: every command exits 0; record exact counts from fresh output.

- [ ] **Step 2: Install Desktop and DSH builds**

Use the established recoverable replacement flow for `/Applications/Rolling Skill.app`. Package DSH 0.1.70, install it into the existing web profile, restart that profile, and verify installed version plus `lib/index.js` hash. Do not stage any `.tgz`.

- [ ] **Step 3: Perform real installed-product checks**

In both installed surfaces, verify only max Epoch and optional direction remain. Start one blank-direction task and one bounded task using `重点改善异常下钻`. Inspect the real Operator transcript for Playbook v1, direction, baseline evidence and Candidate Tool instruction. Let the bounded task reach Candidate submission or a clear recoverable Runtime boundary, then stop test tasks safely and confirm experiment restoration.

- [ ] **Step 4: Record only observed evidence**

If the real DSH task reaches durable phases, append its Run IDs, timestamps, installed version and observed result to the audit. Never mark an unexecuted phase as passed.

- [ ] **Step 5: Final checks, plan/spec commit, and push**

```bash
git diff --check
git status --short
git add docs/superpowers/specs/2026-09-05-optimization-direction-and-playbook-design.md \
  docs/superpowers/plans/2026-09-05-optimization-direction-and-playbook.md
git diff --cached --name-only
git commit -m "docs: plan optimization direction playbook"
git push rolling-skill main
```

Expected: staged names contain no `*.tgz`; `main` matches `rolling-skill/main`; only pre-existing untracked packages remain.

## Inline Execution Choice

The user explicitly requested no sub-Agent code changes. Execute this plan in the current session with `superpowers:executing-plans`, using test-first steps and review checkpoints after the shared contract, UI parity and installed-product verification.
