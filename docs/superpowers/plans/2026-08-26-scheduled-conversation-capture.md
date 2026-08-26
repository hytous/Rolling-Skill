# Scheduled Conversation Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover complete, previously unchecked problem episodes on a daily or weekly schedule, retain every candidate in Raw Cases, and optionally save high-confidence valid Cases automatically.

**Architecture:** Replace turn-completion whole-thread capture with a timer-driven `ConversationDiscoveryManager`. Pure scheduling and classifier helpers build bounded two-stage prompts, a private state store persists per-Runtime/thread cursors and pending tails, and Raw Case is the durable handoff before Draft creation. Fully automatic save subscribes to its own Curation Session updates and remains gated by confidence, Skill, dataset, Rubric, and valid Draft checks.

**Tech Stack:** Node.js CommonJS, Electron main timers, Runtime thread/list/read and internal model execution, append-only Raw Cases, Curator, vanilla Settings/Raw Case UI, `node:test`.

---

### Task 1: Automatic Capture settings migration

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`

- [ ] **Step 1: Write failing default, migration, and update tests**

Assert new stores default to `mode: "off"`, daily 09:00, Monday as a valid weekly fallback, null analysis model/effort/preferred dataset, and current Runtime policy. Assert old `autoCapture: true` becomes scheduled rather than automatic. Validate `HH:mm`, cadence, weekday, mode, effort, and dataset IDs.

```js
assert.deepEqual(store.read().settings.autoCaptureProfile.schedule, {
    cadence: "daily",
    time: "09:00",
    weekday: 1,
})
assert.equal(migrated.settings.autoCaptureProfile.mode, "scheduled")
assert.equal(migrated.settings.autoCapture, true)
```

- [ ] **Step 2: Run the focused failing store test**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: FAIL because explicit mode and schedule fields are absent.

- [ ] **Step 3: Implement normalized settings**

Add constants and normalizers:

```js
const AUTO_CAPTURE_MODES = new Set(["off", "scheduled", "automatic"])
const AUTO_CAPTURE_CADENCES = new Set(["daily", "weekly"])

function captureTime(value) {
    const text = String(value ?? "")
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(text)) throw new Error("Automatic capture time is invalid")
    return text
}
```

Store `autoCaptureProfile.mode`, `.schedule`, `.modelId`, `.effort`, and `.datasetId` as the optional preferred dataset. Keep `settings.autoCapture = mode !== "off"` as a compatibility-derived field. `updateSettings()` accepts `autoCaptureMode`, `autoCaptureCadence`, `autoCaptureTime`, `autoCaptureWeekday`, model/effort, and preferred dataset.

- [ ] **Step 4: Run the focused store test and commit**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/test/local-store.test.cjs
git commit -m "feat: model scheduled capture settings"
```

### Task 2: Private scan-state store and schedule math

**Files:**
- Create: `desktop/rolling-skill/src/automatic-capture-state-store.cjs`
- Create: `desktop/rolling-skill/src/conversation-discovery.cjs`
- Create: `desktop/rolling-skill/test/automatic-capture-state-store.test.cjs`
- Create: `desktop/rolling-skill/test/conversation-discovery.test.cjs`

- [ ] **Step 1: Write failing state-store tests**

Test atomic creation, per-Runtime/thread separation, cursor/pending-tail updates, last successful run, last error, satisfied slot, and no mutation of returned copies.

```js
store.commitThread("codex:a", "thread-1", {
    lastInspectedUserItemId: "user-3",
    pendingStartUserItemId: "user-2",
})
assert.equal(store.read().runtimes["codex:a"].threads["thread-1"].pendingStartUserItemId, "user-2")
assert.equal(store.read().runtimes["codex:b"], undefined)
```

- [ ] **Step 2: Write failing schedule tests**

Use injected dates to cover daily before/after time, weekly same-day before/after time, crossing week/month/year, daylight-saving-safe local construction, first-run catch-up, multiple missed slots collapsing to one, and already-satisfied slot returning null.

```js
assert.equal(dueCaptureSlot({
    now: new Date("2026-08-26T09:05:00+08:00"),
    schedule: {cadence: "daily", time: "09:00", weekday: 1},
    lastScheduledSlot: "2026-08-25T09:00:00+08:00",
})?.getHours(), 9)
```

- [ ] **Step 3: Run the two focused failing tests**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture-state-store.test.cjs test/conversation-discovery.test.cjs`

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement atomic private state persistence**

Follow `LocalEvaluationStore.persist()` permissions and temporary rename. Default shape:

```js
function initialState() {
    return {
        schemaVersion: "rolling-skill-automatic-capture-state/v1",
        lastScheduledSlot: null,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        runtimes: {},
    }
}
```

Expose `read()`, `beginSlot(slot)`, `completeSlot(slot, now)`, `failSlot(error, now)`, `thread(runtimeId, threadId)`, and `commitThread(runtimeId, threadId, patch)`. Do not send the full cursor map through preload.

- [ ] **Step 5: Implement local schedule helpers**

Export `previousScheduledSlot(now, schedule)`, `nextScheduledSlot(now, schedule)`, and `dueCaptureSlot({now, schedule, lastScheduledSlot})`. Build local dates with `new Date(year, month, day, hour, minute)` rather than parsing a timezone-free ISO string. Compare canonical ISO timestamps for slot idempotency.

- [ ] **Step 6: Run focused tests and commit**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture-state-store.test.cjs test/conversation-discovery.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/automatic-capture-state-store.cjs desktop/rolling-skill/src/conversation-discovery.cjs desktop/rolling-skill/test/automatic-capture-state-store.test.cjs desktop/rolling-skill/test/conversation-discovery.test.cjs
git commit -m "feat: persist scheduled capture cursors"
```

### Task 3: Strict two-stage classifier contracts

**Files:**
- Modify: `desktop/rolling-skill/src/conversation-discovery.cjs`
- Modify: `desktop/rolling-skill/test/conversation-discovery.test.cjs`

- [ ] **Step 1: Write failing prompt/parser tests**

Boundary prompt tests MUST prove Agent text, reasoning, commands, and tool output are absent. Outcome prompt tests MUST include only the selected Episode, compact activity, enabled Skill identities, and dataset bindings. Parser tests cover exact schema, stable ID membership, overlap, invalid confidence, unknown Skill, malformed/fenced JSON, and request budgets.

```js
const prompt = buildBoundaryPrompt({threadId: "thread-1", userMessages})
assert.match(prompt, /user-1/u)
assert.doesNotMatch(prompt, /assistant secret|tool output/u)
assert.deepEqual(parseBoundaryResult('{"segments":[],"pendingStartUserItemId":"user-2"}', context), {
    segments: [], pendingStartUserItemId: "user-2",
})
```

- [ ] **Step 2: Run the focused failing contract test**

Run: `cd desktop/rolling-skill && node --test test/conversation-discovery.test.cjs`

Expected: FAIL for missing builders and parsers.

- [ ] **Step 3: Implement stable JSON prompts**

Boundary result schema:

```json
{"segments":[{"startUserItemId":"id","endUserItemId":"id","summary":"text"}],"pendingStartUserItemId":"id-or-null"}
```

Outcome result schema:

```json
{"skillName":"name-or-null","outcome":"resolved|unresolved|uncertain","caseType":"goodcase|badcase","finalAssistantItemId":"id-or-null","confidence":0.8,"reason":"text"}
```

Prompts instruct JSON only. Parse the first complete JSON object, enforce allowed IDs and ordered, non-overlapping boundaries, cap summaries/reasons, and reject extra segment IDs not present in input. Confidence must be finite within 0..1.

- [ ] **Step 4: Implement batching budgets**

Export `partitionUserMessages(messages, {maxMessages, maxCharacters})`. It may split between user messages but never inside one message. Outcome Episode uses existing `buildEpisodeSnapshot` truncation and compact activity limits rather than a second arbitrary history window.

- [ ] **Step 5: Run the contract test and commit**

Run: `cd desktop/rolling-skill && node --test test/conversation-discovery.test.cjs test/episode-curation.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/conversation-discovery.cjs desktop/rolling-skill/test/conversation-discovery.test.cjs
git commit -m "feat: define bounded conversation discovery"
```

### Task 4: Raw Case automatic observations

**Files:**
- Modify: `desktop/rolling-skill/src/raw-case-store.cjs`
- Modify: `desktop/rolling-skill/test/raw-case-store.test.cjs`

- [ ] **Step 1: Write failing duplicate-observation tests**

Add an automatic candidate, add the same Skill/question from another episode, and assert one pending record with two unique observations. Assert normal CLI/manual duplicates still return their current duplicate result without source mutation. Assert compare-and-set conflicts retry from the latest Raw Case at most once.

- [ ] **Step 2: Run the focused failing Raw Case test**

Run: `cd desktop/rolling-skill && node --test test/raw-case-store.test.cjs`

Expected: FAIL because observation merging is absent.

- [ ] **Step 3: Implement `addAutomaticCandidate()`**

Normalize the normal Raw Case input first. If `add()` creates it, store `source.observations: [observation]`. If it finds a duplicate automatic or compatible record, merge by a stable key of Runtime/thread/start/end IDs:

```js
function observationKey(value) {
    return [value.runtimeId, value.threadId, value.startItemId, value.endItemId].join("\u0000")
}
```

Use `updateIfCurrent()` so concurrent external Raw Case edits fail closed. Return `{created, observed, duplicateOf, rawCase}`. Never change `question` or `skill` during merge.

- [ ] **Step 4: Run Raw Case tests and commit**

Run: `cd desktop/rolling-skill && node --test test/raw-case-store.test.cjs test/raw-case-tool.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/raw-case-store.cjs desktop/rolling-skill/test/raw-case-store.test.cjs
git commit -m "feat: retain automatic case observations"
```

### Task 5: ConversationDiscoveryManager incremental scan

**Files:**
- Replace: `desktop/rolling-skill/src/automatic-capture.cjs`
- Replace: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `desktop/rolling-skill/src/codex-app-server.cjs`
- Modify: `desktop/rolling-skill/src/codebuddy-acp-client.cjs`
- Modify: `desktop/rolling-skill/src/deepseek-harness-client.cjs`

- [ ] **Step 1: Replace legacy tests with failing scheduled-manager tests**

Use injected `now`, timer functions, Runtime, analysis runner, state store, and Raw Case store. Cover disabled mode, due slot, no duplicate slot, unarchived and archived pagination, hidden thread filtering, cursor resume, pending tail, stage-one user-only input, stage-two range input, candidate persistence before cursor, failure without cursor, and status events.

```js
const manager = new ConversationDiscoveryManager(fixture.dependencies)
await manager.runDueScan()
assert.equal(boundaryInputs[0].includes("assistant answer"), false)
assert.equal(rawCandidates.length, 1)
assert.equal(stateStore.thread("codex:a", "thread-1").lastInspectedUserItemId, "user-3")
```

- [ ] **Step 2: Run the focused failing manager test**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture.test.cjs`

Expected: FAIL because the old manager is completion-event based.

- [ ] **Step 3: Add internal analysis thread callbacks**

Extend each Runtime `runEvaluationJudge()` or the smallest existing JSON-only internal model method with optional `onThreadStarted(threadId)`, matching the refresh callback pattern. The manager adds these IDs to its hidden set immediately.

- [ ] **Step 4: Implement scheduled manager lifecycle**

Export `ConversationDiscoveryManager` and a compatibility alias `AutomaticCaptureManager`. Constructor dependencies:

```js
{
    store, stateStore, rawCaseStore,
    getRuntime, getRuntimeDescriptor,
    curationManager, listDatasets, listSkills,
    runAnalysis, getHiddenThreadIds,
    now, setTimer, clearTimer, onStatus, onError,
}
```

Implement `start()`, `stop()`, `reschedule()`, `runDueScan()`, `runSlot(slot)`, `listAllThreads(runtime, archived)`, `scanThread()`, and `hiddenThreadIds()`. Only one `running` Promise may exist. `reschedule()` caps timer delay to the platform-safe range and recomputes after wake.

- [ ] **Step 5: Implement cursor-safe two-stage processing**

For each thread, read and flatten canonical user messages. Slice after cursor or from pending start, partition stage-one batches, parse boundaries, build selected Episodes, run outcome classification, then call `rawCaseStore.addAutomaticCandidate()`. Commit the cursor only after every completed segment in the batch is stored or explicitly irrelevant and the pending tail is persisted.

Irrelevant means no substantive question or no identifiable enabled Skill; persist a compact checked-range marker in the cursor state rather than a Raw Case. Runtime/model/parser/storage exceptions call `failSlot` and leave the affected range unadvanced.

- [ ] **Step 6: Remove completion-event capture**

`handleNotification()` no longer creates Curation Sessions on `turn/completed`. It may only trigger lightweight rescheduling/status refresh if needed. Existing Curator and Rubric notification routing remains unchanged.

- [ ] **Step 7: Run manager and provider tests**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture.test.cjs test/conversation-discovery.test.cjs test/automatic-capture-state-store.test.cjs test/codex-app-server.integration.test.cjs test/codebuddy-runtime-provider.test.cjs test/deepseek-harness-runtime-provider.test.cjs`

Expected: PASS.

- [ ] **Step 8: Commit incremental discovery**

```bash
git add desktop/rolling-skill/src/automatic-capture.cjs desktop/rolling-skill/src/*client.cjs desktop/rolling-skill/src/codex-app-server.cjs desktop/rolling-skill/test
git commit -m "feat: discover new conversation cases on schedule"
```

### Task 6: Draft creation and fully automatic save

**Files:**
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Write failing routing and auto-save tests**

Cover preferred compatible dataset, one implicit match, no match, ambiguous match, confidence 0.79, uncertain outcome, missing Rubric, Draft failure, valid Draft auto-Done, Raw Case marked dispatched only after Case save, source Runtime mismatch for manual Draft creation, and manager start/stop/reschedule on App/Runtime/settings changes.

- [ ] **Step 2: Run focused failing tests**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture.test.cjs test/main-bridge.test.cjs`

Expected: FAIL for missing routing, Draft bridge, and lifecycle wiring.

- [ ] **Step 3: Implement dataset routing gates**

Export a pure selector:

```js
function automaticDatasetFor(candidate, datasets, preferredDatasetId) {
    if (candidate.confidence < 0.8 || candidate.outcome === "uncertain") return null
    const matches = datasets.filter((dataset) => sameSkill(dataset.skillReference, candidate.skill))
    const preferred = matches.find((dataset) => dataset.id === preferredDatasetId)
    if (preferred) return preferred
    return matches.length === 1 ? matches[0] : null
}
```

Require `activeRubricVersionId` before Curation creation.

- [ ] **Step 4: Implement automatic Curation tracking**

After Raw Case persistence, automatic mode creates a Curation Session from the frozen source boundaries and stores `sessionId -> rawCaseId`. Add `handleCurationChanged(session)`: on a valid `needs_review` Draft call `curationManager.archive(session.id)` once; only after archive resolves call `rawCaseStore.markDispatched(rawCaseId, {mode: "automatic", caseId})`. On failure, cancellation, drift, or archive error retain Raw Case and Draft.

- [ ] **Step 5: Add manual Raw Case Draft IPC**

Preload exposes:

```js
createCurationFromRawCase: (rawCaseId, datasetId) =>
    ipcRenderer.invoke("curation:create-from-raw-case", {rawCaseId, datasetId})
```

Main validates source kind and complete boundaries, requires the source Runtime to be active, verifies Skill compatibility and published Rubric, creates the Curation Session, then marks the Raw Case dispatched only after creation succeeds.

- [ ] **Step 6: Wire lifecycle and public status**

Instantiate `AutomaticCaptureStateStore` under `app.getPath("userData")`. Start the manager after Runtime and managers initialize, call `reschedule()` after relevant settings updates or Runtime switches, and `stop()` during shutdown. Expose only `{mode, nextRunAt, running, pendingCount, lastSuccessAt, error}` via an IPC read and `automatic-capture:status` subscription.

- [ ] **Step 7: Run focused routing and bridge tests, then commit**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture.test.cjs test/main-bridge.test.cjs test/raw-case-store.test.cjs test/curation-manager.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/automatic-capture.cjs desktop/rolling-skill/src/main.cjs desktop/rolling-skill/src/preload.cjs desktop/rolling-skill/test
git commit -m "feat: route discovered cases through review"
```

### Task 7: Scheduled Capture Settings and status UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Add failing settings and status assertions**

Assert mode/cadence/time/weekday controls, conditional weekly/preferred fields, model/effort catalogs, removal of the old immediate-capture help, status subscription, English/Chinese strings, and next-run/last-success/error rendering.

- [ ] **Step 2: Run the focused failing surface test**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs`

Expected: FAIL.

- [ ] **Step 3: Replace the Automatic Capture form**

Use selects for mode and cadence, native `input type="time"`, weekday select, existing model/effort helpers, and preferred dataset select with an automatic-routing empty option. Disable/hide schedule fields for off and weekday for daily. Save the explicit fields through `updateSettings()`.

- [ ] **Step 4: Render topbar and Settings status**

Subscribe once to `onAutomaticCaptureStatus`. Format local dates with `state.settings.language`. Topbar precedence: error, scanning, pending count, next run, off. Settings also shows last successful scan. Reuse existing capture status dot and do not trigger `renderAll()` for timer-only updates.

- [ ] **Step 5: Add bilingual strings and cohesive styles**

Add all mode, cadence, weekday, schedule, catch-up, running, pending, last-success, and error copy in English and Chinese. Extend `.automatic-capture-settings` with existing grid and disclosure rules; no new theme colors.

- [ ] **Step 6: Run focused UI/store tests and commit**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/local-store.test.cjs test/main-bridge.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/renderer desktop/rolling-skill/test/local-first-surface.test.cjs
git commit -m "feat: configure scheduled case discovery"
```

### Task 8: Automatic candidate Raw Case UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Add failing candidate-card assertions**

Assert automatic-source cards render detected Skill, resolved/unresolved/uncertain, confidence percentage, source time, and Create Case Draft. Assert delete-recovery cards retain existing current/new conversation execution actions and do not show Draft when no frozen boundaries exist.

- [ ] **Step 2: Run the focused failing surface test**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs`

Expected: FAIL.

- [ ] **Step 3: Render candidate metadata and Draft action**

Detect `rawCase.source.kind === "automatic_capture"` and a complete selected observation. Add a compact metadata row and Create Draft button. On click, open a small dataset chooser prefiltered to matching Skills; call `createCurationFromRawCase`, close/remove the Raw Case after the store notification, upsert the Session, and open Case Drafts.

- [ ] **Step 4: Add localized fallback and error behavior**

If source Runtime is not active, no compatible dataset exists, or the episode is incomplete, keep the card and show a localized actionable error. Never silently send the question to a different Runtime or dataset.

- [ ] **Step 5: Run capture-focused tests**

Run: `cd desktop/rolling-skill && node --test test/automatic-capture.test.cjs test/conversation-discovery.test.cjs test/automatic-capture-state-store.test.cjs test/raw-case-store.test.cjs test/local-store.test.cjs test/main-bridge.test.cjs test/local-first-surface.test.cjs`

Expected: PASS.

- [ ] **Step 6: Mark OpenSpec discovery/UI tasks and commit**

Mark tasks 4.1 through 6.3 complete in `openspec/changes/case-lifecycle-maintenance/tasks.md`, then:

```bash
git add desktop/rolling-skill/renderer openspec/changes/case-lifecycle-maintenance/tasks.md
git commit -m "feat: review automatically discovered cases"
```

### Task 9: Focused integration and delivery

**Files:**
- Modify: `openspec/changes/case-lifecycle-maintenance/tasks.md`
- Modify/build: `Rolling Skill.app`
- Modify/build: `rolling-skill-tool`

- [ ] **Step 1: Run the focused changed-area suite once**

Run:

```bash
cd desktop/rolling-skill && node --test \
  test/case-recycle-service.test.cjs \
  test/case-refresh-manager.test.cjs \
  test/case-refresh-batch.test.cjs \
  test/automatic-capture-state-store.test.cjs \
  test/conversation-discovery.test.cjs \
  test/automatic-capture.test.cjs \
  test/raw-case-store.test.cjs \
  test/local-store.test.cjs \
  test/episode-curation.test.cjs \
  test/curation-manager.test.cjs \
  test/main-bridge.test.cjs \
  test/local-first-surface.test.cjs
```

Expected: PASS with no skipped changed-area tests. Do not repeat the full `npm test` unless a focused failure indicates cross-module impact that the focused list cannot resolve.

- [ ] **Step 2: Validate OpenSpec**

Run: `openspec validate case-lifecycle-maintenance --json`

Expected: valid result with no requirement/scenario/task errors. Mark tasks 7.1 and 7.2 complete.

- [ ] **Step 3: Build repository-root artifacts**

Run the existing macOS build script once:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
```

Expected: repository-root `Rolling Skill.app` and `rolling-skill-tool` are replaced with the new build and the script reports success.

- [ ] **Step 4: Perform one local App inspection**

Launch repository-root `Rolling Skill.app` once. Inspect Chinese and English Settings, single/batch refresh controls, automatic candidate Raw Case, and both delete dialogs. Confirm the App does not open a browser. Quit after this one pass and mark task 7.3 complete.

- [ ] **Step 5: Record completion and commit delivery**

Mark OpenSpec tasks 7.3 and 7.4 complete, append the final project-record entry without reading the existing requirement log, update persistent preferences only if the newly explicit fully automatic mode supersedes the old preference, then commit:

```bash
git add openspec/changes/case-lifecycle-maintenance/tasks.md "Rolling Skill.app" rolling-skill-tool
git commit -m "build: install case lifecycle maintenance"
```
