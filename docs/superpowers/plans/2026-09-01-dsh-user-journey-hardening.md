# DSH Rolling Skill User Journey Hardening Implementation Plan

> **Execution constraint (user, 2026-09-01):** All implementation and review are performed by the primary agent. Do not delegate code to subagents. Use executing-plans task-by-task; installed-browser evidence in the audit is the authoritative completion record, not source-test counts.

**Goal:** Make the installed DSH Rolling Skill plugin complete and reliable from a user's perspective, using the Electron App as the task-completeness baseline and real DSH browser journeys as the release gate.

**Architecture:** Keep DSH native conversation and Trace surfaces, but centralize plugin connection state, long-running operation polling, human-readable status, confirmation, and refresh behavior in reusable client primitives. Audit and close page-level gaps against eleven end-to-end user journeys, then package, install, and verify the actual plugin rather than relying on source-level tests.

**Tech Stack:** React 18, TypeScript/TSX, DSH client slots/primitives, Node test runner, esbuild, Shared Rolling Skill Core JSON API, real DSH web host and in-app browser.

---

### Task 1: Replace synthetic parity claims with a user-journey audit

**Files:**
- Create: `docs/quality/dsh-user-journey-audit-2026-09-01.md`
- Modify: `packages/rolling-skill-core/src/surface-parity-manifest.cjs`
- Test: `packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`

- [ ] **Step 1: Write a failing manifest test**

Require every manifest entry to expose a real journey ID, named capability, concrete DSH interaction, and evidence status; reject generated labels such as `Electron baseline capability RB-01` and blanket UI evidence.

```js
test("surface parity entries describe real user capabilities and evidence", () => {
    for (const entry of SURFACE_PARITY_MANIFEST) {
        assert.match(entry.journeyId, /^J(?:[1-9]|1[01])$/)
        assert.ok(entry.capability.length >= 12)
        assert.ok(!entry.electronOwner.includes("baseline capability"))
        assert.ok(["native", "complete", "partial", "broken", "intentional"].includes(entry.status))
        if (entry.status === "complete") assert.notEqual(entry.uiEvidence, "Pending installed DSH browser verification")
    }
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`  
Expected: FAIL because current entries are generated from counts and generic labels.

- [ ] **Step 3: Implement an explicit journey manifest**

Replace the generated family/count structure with named capability records. Preserve stable legacy IDs for traceability, add `journeyId`, and initialize statuses from real browser evidence rather than assuming green.

```js
const CAPABILITIES = Object.freeze([
    capability("J1", "ST-07", "Open and close the workbench from DSH", "native"),
    capability("J1", "QL-06", "Reconnect after the DSH Host becomes unavailable", "broken"),
    capability("J5", "CU-09", "Keep polling a Curator task until a terminal state", "broken"),
    capability("J8", "RB-03", "Generate a dataset Rubric and reach review", "broken"),
])
```

Add explicit records for these legacy capability groups, assigning every record to the named journey shown: `SH/ST/QL connection and shell → J1`, `CV → J2`, `AC → J3`, `DC-09..16 → J4`, `CU → J5`, `DC-01..08 → J6`, `MS → J7`, `RB → J8`, `EV → J9`, `OP → J10`, and `OZ → J11`. Use the capability text already written in `docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md` verbatim as the `capability` field and initialize every non-native item without installed-browser evidence as `partial` or `broken`.

- [ ] **Step 4: Write the audit document**

For each journey record prerequisites, exact user actions, App behavior, current DSH result, status, defect, and later verification evidence. Record the already reproduced stale Rubric UI and Host-disconnect behavior as `broken` with timestamps and API/UI evidence.

- [ ] **Step 5: Run the manifest test and commit**

Run: `node --test packages/rolling-skill-core/test/surface-parity-manifest.test.cjs`  
Expected: PASS.

Commit: `test: replace synthetic DSH parity claims with user journeys`

### Task 2: Centralize connection errors and long-running polling

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/connection-store.ts`
- Create: `packages/rolling-skill-dsh/src/client/workbench/polling-scheduler.cjs`
- Create: `packages/rolling-skill-dsh/src/client/workbench/usePollingRevision.ts`
- Modify: `packages/rolling-skill-dsh/src/client/api.ts`
- Test: `packages/rolling-skill-dsh/test/workbench-reliability.test.cjs`

- [ ] **Step 1: Write scenario-level failing tests**

Cover a complete active-task sequence where three unchanged `running` snapshots are followed by `needs_review`, and a connection sequence `connected → fetch TypeError → successful response`.

```js
test("active work keeps polling when the server revision does not change", async () => {
    const seen = []
    const scheduler = createPollingScheduler({intervalMs: 5, schedule: setTimeout, cancel: clearTimeout})
    let status = "running"
    scheduler.start(async () => {
        const current = status
        seen.push(current)
        if (seen.length === 4) status = "needs_review"
        return current === "running"
    })
    await scheduler.idle()
    assert.deepEqual(seen, ["running", "running", "running", "running", "needs_review"])
})
```

The connection test must assert that business `RollingSkillApiError` responses do not mark the Host disconnected, while network failures do.

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-reliability.test.cjs`  
Expected: FAIL because the shared connection store and polling scheduler do not exist.

- [ ] **Step 3: Implement the polling scheduler and hook**

The scheduler re-arms after every active result, regardless of whether status/revision changed, stops on terminal state/unmount, and has no overlapping calls.

```ts
export function usePollingRevision(active: boolean, intervalMs = 1_500) {
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        if (!active) return
        let cancelled = false
        const timer = window.setInterval(() => {
            if (!cancelled) setRevision((value) => value + 1)
        }, intervalMs)
        return () => { cancelled = true; window.clearInterval(timer) }
    }, [active, intervalMs])
    return [revision, () => setRevision((value) => value + 1)] as const
}
```

- [ ] **Step 4: Implement connection state in the API boundary**

Expose `subscribeRollingSkillConnection()` and `getRollingSkillConnectionSnapshot()`. Mark disconnected only when `fetch` itself fails; mark connected after any valid HTTP envelope, including a business error. Convert the user-facing network message to a localized key at the Workbench boundary rather than returning raw `Failed to fetch`.

- [ ] **Step 5: Run RED/GREEN verification and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-reliability.test.cjs`  
Expected: PASS.

Commit: `fix: centralize DSH connection and task polling`

### Task 3: Add a reliable Workbench shell and human-readable states

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/workbench/OperationStatus.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/ConfirmDialog.tsx`
- Create: `packages/rolling-skill-dsh/src/client/workbench/display-state.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/Workbench.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Test: `packages/rolling-skill-dsh/test/workbench-reliability.test.cjs`

- [ ] **Step 1: Extend the failing journey test**

Assert that a network failure keeps the current page content, renders a single “DSH 服务连接已断开” banner with a reconnect button, and that reconnect success clears it and reloads the active page. Assert localized labels for `queued`, `running`, `needs_review`, `failed`, `archived`, `completed`, and `cancelled` plus local time formatting.

- [ ] **Step 2: Verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-reliability.test.cjs`  
Expected: FAIL because the shell has no connection banner and pages print raw states.

- [ ] **Step 3: Implement shell-level connection and refresh**

Keep the last successful Dashboard while reconnecting. The header refresh increments a shared `refreshEpoch`; render the active page with `key={route.page + ':' + refreshEpoch}` so explicit refresh reloads the complete current journey. Display one connection banner above the content.

- [ ] **Step 4: Implement shared status, confirmation, and formatting primitives**

`OperationStatus` renders persistent starting/running/succeeded/failed feedback. `ConfirmDialog` replaces `window.confirm` for plugin actions. `display-state.ts` owns localized state labels, local date/time, short Runtime labels, and diagnostic-only IDs.

- [ ] **Step 5: Verify and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-reliability.test.cjs && npm run build:dsh`  
Expected: PASS and build exit 0.

Commit: `feat: add reliable DSH workbench shell states`

### Task 4: Repair Curator and Rubric journeys to App-level completeness

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CurationSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RubricPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RubricSessionView.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/ModelEffortSelect.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/workbench-agent-journeys.test.cjs`

- [ ] **Step 1: Write failing Curator and Rubric journey tests**

Bundle the real TSX with esbuild and render it with React test renderer. Simulate `queued → running (unchanged revision) → needs_review`, then a natural-language revision, failure/retry, and publish/save. Assert persistent operation feedback, structured Draft, localized state/time, and folded diagnostics.

- [ ] **Step 2: Verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-agent-journeys.test.cjs`  
Expected: FAIL because both session views stop polling after one unchanged response and use raw inputs/statuses.

- [ ] **Step 3: Replace one-shot effects with the shared polling hook**

Use `usePollingRevision(working)` in list and detail views. When a terminal state is observed, call the parent refresh callback exactly once. Keep the user’s unsent revision text across background refreshes.

- [ ] **Step 4: Align the review experience with App**

Use configured profile values by default, actual Runtime model catalogs for overrides, natural-language revision as the primary control, structured Draft as the main content, and fold Agent transcript plus commit/digest/Job IDs under diagnostics. Use `ConfirmDialog` for discard and `OperationStatus` for generation/revision/publish/save.

- [ ] **Step 5: Verify and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-agent-journeys.test.cjs packages/rolling-skill-dsh/test/curation-client.test.cjs packages/rolling-skill-dsh/test/rubric-client.test.cjs`  
Expected: PASS.

Commit: `fix: complete DSH Curator and Rubric journeys`

### Task 5: Complete Raw Case, Dataset, and Case lifecycle journeys

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/CasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/MarkdownContent.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/workbench-case-journeys.test.cjs`

- [ ] **Step 1: Write a failing full Case lifecycle test**

Run one scenario: filter a managed Skill, inspect automatic source evidence, create a Draft, view a structured saved Case, export all/good and curated/original modes, start refresh, observe progress, and open destructive confirmation with recovery choice. Include multiple Skills and a narrow viewport layout contract.

- [ ] **Step 2: Verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-case-journeys.test.cjs`  
Expected: FAIL on incomplete confirmations, raw states, and missing persistent refresh feedback.

- [ ] **Step 3: Implement complete empty/ready/operation states**

Never render blank selects. Show source messages rather than raw event JSON. Keep Runtime Context folded. Localize type/status/time and display selected Skill/Dataset state clearly.

- [ ] **Step 4: Complete export, refresh, calibration, and deletion flows**

Use styled dialogs for export scope/output and delete recovery. Poll refresh/calibration jobs until terminal. Preserve list selection and expose the next action after success.

- [ ] **Step 5: Verify and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-case-journeys.test.cjs packages/rolling-skill-dsh/test/raw-case-evidence.test.cjs packages/rolling-skill-dsh/test/dataset-view-model.test.cjs`  
Expected: PASS.

Commit: `fix: complete DSH Case lifecycle journeys`

### Task 6: Complete Managed Skill and installation journeys

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/SkillEditModal.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/InstallationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RuntimeInteractions.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/workbench-skill-journeys.test.cjs`

- [ ] **Step 1: Write a failing end-to-end Skill journey test**

Cover source selection, import, Skill selection retained across tabs, Agent edit conversation, Diff, apply/release, version history, Runtime installation, interaction resolution, cancellation, and terminal audit result.

- [ ] **Step 2: Verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-skill-journeys.test.cjs`  
Expected: FAIL where jobs use inconsistent polling/feedback and empty options are not actionable.

- [ ] **Step 3: Implement shared task and confirmation behavior**

Use continuous polling for Skill Edit and Installation. Keep the selected Skill through Import/Versions/Install. Keep large Diff and logs scrollable; show trusted result summary first and diagnostic IDs second.

- [ ] **Step 4: Verify and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-skill-journeys.test.cjs packages/rolling-skill-dsh/test/skill-source-picker.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs`  
Expected: PASS.

Commit: `fix: complete DSH Skill delivery journeys`

### Task 7: Complete Evaluation, Operator, and Optimization journeys

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OperatorPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/OptimizationPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RuntimeInteractions.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Test: `packages/rolling-skill-dsh/test/workbench-execution-journeys.test.cjs`

- [ ] **Step 1: Write failing execution journey tests**

Evaluation: configure target and Judge separately, run, poll, inspect score/criterion/Trace, cancel, delete. Operator: start, message, approve/reject, artifact, pause/resume/cancel. Optimization: preflight, start, epoch progress, pause/resume/cancel, report.

- [ ] **Step 2: Verify RED**

Run: `node --test packages/rolling-skill-dsh/test/workbench-execution-journeys.test.cjs`  
Expected: FAIL on incomplete empty-state guidance, raw statuses/timestamps, and inconsistent operation feedback.

- [ ] **Step 3: Implement complete user-facing state machines**

Reuse shared polling, status, confirmation and empty-state primitives. Keep target/Judge Runtime identity explicit. Render evaluation criterion and bounded Trace evidence structurally. Keep internal IDs in diagnostics. Preserve forms on preflight errors.

- [ ] **Step 4: Verify and commit**

Run: `node --test packages/rolling-skill-dsh/test/workbench-execution-journeys.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs`  
Expected: PASS.

Commit: `fix: complete DSH execution and optimization journeys`

### Task 8: Run installed-browser acceptance and close the audit

**Files:**
- Modify: `docs/quality/dsh-user-journey-audit-2026-09-01.md`
- Modify: `packages/rolling-skill-core/src/surface-parity-manifest.cjs`
- Modify: `packages/rolling-skill-dsh/package.json`

- [ ] **Step 1: Run full source verification**

Run: `npm run test:dsh`  
Expected: all Core + DSH tests pass with zero failures.

Run: `npm run build:dsh`  
Expected: exit 0.

- [ ] **Step 2: Build and inspect the package**

Increment the plugin patch version, then run:

```bash
npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist
node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.35.tgz
```

Record file count and unpacked size; reject Electron/Chromium/App contents.

- [ ] **Step 3: Install a clean copy and verify hashes**

Remove the old DSH plugin, add the exact new tarball, and compare SHA-256 for the built and installed `lib/index.js` and `lib/client.js`. Start `dsh web --no-open --port 3080`.

- [ ] **Step 4: Run the real browser matrix**

In the installed DSH page, execute J1–J11 at normal and narrow widths. At minimum run one real Curator, Rubric, Installation, and Evaluation task to terminal. Test Host stop/restart, retry, navigation while active, workbench close/reopen, and browser reload. Inspect console errors and visual overflow.

- [ ] **Step 5: Close only verified audit entries**

Update each capability with exact UI evidence. Leave external-runtime-blocked or data-precondition-blocked entries as `partial` with the blocker; never infer completion from tests.

- [ ] **Step 6: Final verification and commit**

Run: `npm run test:dsh && npm run build:dsh && git diff --check`  
Expected: zero failures, build exit 0, no whitespace errors.

Commit: `release: harden DSH plugin user journeys`
