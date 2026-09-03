# Automatic Optimization Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly prohibits subagent-driven implementation for this repository.

**Goal:** Replace the separate Optimization preflight step with one Start action that automatically validates and freezes inputs, starts the Run, and reports the exact blocking problem.

**Architecture:** Keep preflight as a backend invariant inside `optimization.start`, but remove its Renderer-owned state machine. Isolate legacy telemetry capability checks in a small testable module, expose trusted-human scope-resolution diagnostics only through the existing private diagnostic channel, and keep all external control errors redacted.

**Tech Stack:** Electron, CommonJS, Node.js built-in test runner, DOM Renderer smoke tests, macOS codesign.

---

### Task 1: Make Optimization v2 preflight independent of legacy telemetry

**Files:**
- Create: `desktop/rolling-skill/src/optimization/optimization-preflight.cjs`
- Create: `desktop/rolling-skill/test/optimization-preflight.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs:2217-2250`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs:850-930`

- [ ] **Step 1: Write the failing compatibility test**

```js
const assert = require("node:assert/strict")
const {describe, it} = require("node:test")
const {assertOptimizationTelemetrySupport} = require("../src/optimization/optimization-preflight.cjs")

describe("Optimization preflight compatibility", () => {
    const runtimes = [{runtimeId: "runtime-1", capabilities: []}]

    it("accepts an Epoch-only v2 config without telemetry", () => {
        assert.doesNotThrow(() => assertOptimizationTelemetrySupport({
            limits: {maxEpochs: 5},
        }, runtimes))
    })

    it("keeps legacy token and cost capability checks", () => {
        assert.throws(() => assertOptimizationTelemetrySupport({
            telemetry: {tokens: true, cost: false},
        }, runtimes), /token telemetry is unavailable/i)
        assert.throws(() => assertOptimizationTelemetrySupport({
            telemetry: {tokens: false, cost: true},
        }, runtimes), /cost telemetry is unavailable/i)
    })
})
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run: `node --test test/optimization-preflight.test.cjs`

Expected: FAIL because `src/optimization/optimization-preflight.cjs` does not exist.

- [ ] **Step 3: Add the minimal compatibility module**

```js
"use strict"

function assertOptimizationTelemetrySupport(config = {}, runtimes = []) {
    const telemetry = config?.telemetry
    if (!telemetry) return
    const allSupport = (capability) => runtimes.every((runtime) => (
        Array.isArray(runtime.capabilities) && runtime.capabilities.includes(capability)
    ))
    if (telemetry.tokens && !allSupport("token-usage")) {
        throw new Error("Optimization token telemetry is unavailable on one or more Runtimes")
    }
    if (telemetry.cost && !allSupport("cost-usage")) {
        throw new Error("Optimization cost telemetry is unavailable on one or more Runtimes")
    }
}

module.exports = {assertOptimizationTelemetrySupport}
```

Import this function in `main.cjs` and replace the unconditional `config.telemetry.tokens/cost` block with:

```js
assertOptimizationTelemetrySupport(config, runtimes)
```

Add a `main-bridge.test.cjs` assertion that `resolveOptimizationPreflight()` calls the helper and does not access `config.telemetry.tokens` directly.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/optimization-preflight.test.cjs test/main-bridge.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the backend compatibility fix**

```bash
git add desktop/rolling-skill/src/optimization/optimization-preflight.cjs desktop/rolling-skill/src/main.cjs desktop/rolling-skill/test/optimization-preflight.test.cjs desktop/rolling-skill/test/main-bridge.test.cjs
git commit -m "fix: support Epoch-only optimization preflight"
```

### Task 2: Preserve exact preflight failures for the trusted local Renderer

**Files:**
- Modify: `desktop/rolling-skill/src/control-plane/control-plane.cjs:1-20,810-885`
- Modify: `desktop/rolling-skill/test/control-plane.test.cjs:1-170,1000-1040`

- [ ] **Step 1: Write the failing diagnostic-boundary test**

Extend the control-plane fixture so a capability can be issued through `createTrustedHumanCapabilityIssuer`. Add a test whose `resolveScope()` throws `Optimization Dataset requires a published Rubric` and assert:

```js
const trustedError = await trusted.control.invoke(request).catch((error) => error)
assert.equal(trustedError.code, "CONTROL_ERROR")
assert.deepEqual(diagnostics.consume(trustedError), {
    message: "Optimization Dataset requires a published Rubric",
})

const ordinaryError = await ordinary.control.invoke(request).catch((error) => error)
assert.equal(diagnostics.consume(ordinaryError), null)
```

The public error must remain `{code: "CONTROL_ERROR", message: "Control operation failed"}` in both cases.

- [ ] **Step 2: Run the test and confirm trusted scope diagnostics are missing**

Run: `node --test test/control-plane.test.cjs`

Expected: FAIL because scope-resolution exceptions are not captured by `serviceErrorDiagnostics`.

- [ ] **Step 3: Capture only trusted-human resolution failures**

Import `isTrustedHumanCapability` and wrap `trustedResolution()`:

```js
let source
try {
    source = await trustedResolution(state.services, method, input, grant)
} catch (error) {
    if (isTrustedHumanCapability(grant)) serviceFailure = error
    throw error
}
```

Do not change `safeControlError()`, public error contracts, socket behavior, or authorization errors.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/control-plane.test.cjs test/control-plane-contracts.test.cjs`

Expected: PASS, including the existing assertion that ordinary scope errors expose no diagnostic.

- [ ] **Step 5: Commit the diagnostic fix**

```bash
git add desktop/rolling-skill/src/control-plane/control-plane.cjs desktop/rolling-skill/test/control-plane.test.cjs
git commit -m "fix: explain trusted optimization setup failures"
```

### Task 3: Replace the Renderer preflight step with one Start action

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html:401-435`
- Modify: `desktop/rolling-skill/renderer/operator-workbench.js:194-209,1646-1665,1680-1695,2119-2250,2780-2835,3038-3042`
- Modify: `desktop/rolling-skill/renderer/renderer.js:375-415,509-512,1119-1159,1253-1256`
- Modify: `desktop/rolling-skill/renderer/styles.css:1336-1365`
- Modify: `desktop/rolling-skill/test/operator-workbench.test.cjs:190-220,1595-1635`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs:20-60`

- [ ] **Step 1: Write failing surface and localization tests**

Update the markup test to require exactly one Optimization setup action:

```js
assert.doesNotMatch(markup, /id="operator-optimization-preflight"/u)
assert.doesNotMatch(markup, /id="operator-optimization-preflight-summary"/u)
assert.match(markup, /id="operator-optimization-start"[^>]*type="submit"/u)
assert.doesNotMatch(markup.match(/id="operator-optimization-start"[^>]*>/u)?.[0] ?? "", /disabled/u)
```

Export and test an `optimizationSetupErrorText(error, translate, formatMessage)` helper. At minimum assert exact Chinese messages for a missing published Rubric, a mismatched Released baseline, and an unavailable Runtime; the fallback must contain the diagnostic detail rather than only `Control operation failed`.

- [ ] **Step 2: Run tests and confirm the old two-button flow fails**

Run: `node --test test/operator-workbench.test.cjs test/local-first-surface.test.cjs`

Expected: FAIL because the preflight button/summary and preflight-gated Start state still exist.

- [ ] **Step 3: Implement the one-click state machine**

Remove `optimizationPreflight`, `optimizationPreflightSignature`, `optimizationPreflightSummary()`, `renderOptimizationPreflight()`, `preflightOptimization()`, their selectors, and the preflight click listener. The Optimization submit branch becomes:

```js
const config = optimizationConfigFromSetup()
selectors.optimizationStart.disabled = true
selectors.optimizationStart.textContent = text(
    "operatorStartingOptimization",
    "Checking and starting…",
)
try {
    const run = await api.startOptimization({
        ...config,
        idempotencyKey: optimizationRequestId("optimization-start"),
    })
    // Keep the existing successful Run activation and polling logic.
} catch (error) {
    selectors.setupError.textContent = optimizationSetupErrorText(error, translate, formatMessage_)
    selectors.setupError.classList.remove("hidden")
    selectors.optimizationStart.disabled = false
    selectors.optimizationStart.textContent = text("operatorStartOptimization", "Start Optimization")
}
```

On successful transition, normal rendering owns the button. Add:

```css
.operator-setup-actions button:disabled {
    cursor: default;
    opacity: 0.45;
}
```

Add English and Chinese `operatorStartingOptimization` and actionable error translations. Remove obsolete preflight-button instructions.

- [ ] **Step 4: Run focused Renderer tests**

Run: `node --test test/operator-workbench.test.cjs test/local-first-surface.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the one-click UI**

```bash
git add desktop/rolling-skill/renderer/index.html desktop/rolling-skill/renderer/operator-workbench.js desktop/rolling-skill/renderer/renderer.js desktop/rolling-skill/renderer/styles.css desktop/rolling-skill/test/operator-workbench.test.cjs desktop/rolling-skill/test/local-first-surface.test.cjs
git commit -m "feat: start optimization with one action"
```

### Task 4: Update the smoke journey and documentation

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs:1940-2030`
- Modify: `desktop/rolling-skill/README.md:272-289`

- [ ] **Step 1: Make the smoke test click Start exactly once**

Delete the explicit preflight click/wait. After filling the form, assert the old control is absent, click Start once, and wait for the Optimization Job:

```js
if (document.querySelector("#operator-optimization-preflight")) {
    throw new Error("Optimization still exposes a separate preflight action")
}
document.querySelector("#operator-optimization-start").click()
```

Add a smoke branch whose mocked `startOptimization` rejects with a published-Rubric diagnostic and assert that the inline error names the Rubric problem and the Start button is re-enabled.

- [ ] **Step 2: Run the updated end-to-end Renderer smoke**

Run: `npm run smoke:renderer`

Expected: PASS after Task 3, with one Start call, no separate preflight control, an actionable failure branch, and `rendererErrors: 0`.

- [ ] **Step 3: Update the README**

Replace “Before Start is enabled, preflight…” with: clicking Start once performs the internal preflight, freezes the selected inputs, and immediately creates the Run. Document that failure remains on the form with the exact blocking resource or Runtime.

- [ ] **Step 4: Run all verification**

Run:

```bash
find src test -name '*.cjs' -print0 | xargs -0 -n1 node --check
node --check renderer/operator-workbench.js
node --check renderer/renderer.js
npm test
npm run smoke:renderer
git diff --check
git ls-files 'rolling-skill-dsh-plugin-*.tgz'
```

Expected: syntax checks exit 0, all Desktop tests pass, Renderer smoke reports zero errors, whitespace check passes, and the `.tgz` query has no output.

- [ ] **Step 5: Commit documentation and smoke updates**

```bash
git add desktop/rolling-skill/scripts/renderer-smoke.cjs desktop/rolling-skill/README.md
git commit -m "test: cover automatic optimization startup"
```

### Task 5: Build, install, and verify the real App

**Files:**
- Build output: `desktop/rolling-skill/dist/mac-arm64/Rolling Skill.app`
- Installed output: `/Applications/Rolling Skill.app`

- [ ] **Step 1: Build and sign**

Run: `npm run pack:mac`, then sign with `Rolling Skill Local Development` and verify with `codesign --verify --deep --strict --verbose=2`.

Expected: package succeeds and the bundle satisfies its designated requirement.

- [ ] **Step 2: Install recoverably**

Stop the current App, move `/Applications/Rolling Skill.app` to a timestamped backup, copy the signed build into `/Applications`, and start it.

- [ ] **Step 3: Verify the original user journey**

In **Self-operation → Multi-Epoch Optimization**, select `billing-cost-management`, `billing-skill-cases`, Released `v1.0.0`, the desired target Runtime matrix, and click **Start Optimization** once. Confirm the old telemetry crash and generic error do not appear and a Run is created. Stop the verification Run promptly so it does not continue making optimization changes.

- [ ] **Step 4: Push and record completion**

Confirm local `main` equals `rolling-skill/main`, push all implementation commits, append the final `agent-project-record` event without reading its history log, and push that record repository. Never add the root `.tgz` files.
