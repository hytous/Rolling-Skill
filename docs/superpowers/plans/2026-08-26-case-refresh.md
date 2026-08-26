# Case Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-run saved Cases with the current Skill and tools, review single refreshes, and automatically process Goodcase-only or all-Case batches without changing original questions.

**Architecture:** Add `refresh` as a third Curation operation and make `LocalEvaluationStore` own its compare-and-set replacement and history. A focused `CaseRefreshManager` runs the active Runtime with a baseline-aware, read-only refresh prompt, reads the resulting evidence, and asks `CurationManager` to create the review Draft. Renderer orchestration mirrors the proven calibration batch but uses an independent refresh state machine.

**Tech Stack:** Node.js CommonJS, existing Runtime providers, Curator JSON contract, Electron IPC/preload, vanilla Renderer, `node:test`.

---

### Task 1: Refresh store contract and history

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`

- [ ] **Step 1: Write failing migration and archival tests**

Cover these exact invariants: legacy Cases receive `refreshHistory: []`; refresh creation freezes target `updatedAt`, Skill identity, and Rubric version; only one active refresh per Case exists; Done preserves `id`, `datasetId`, `caseType`, `question`, and `createdAt`; replaceable fields change; old fields are appended to history; target/Skill/Rubric drift rejects Done.

```js
it("archives a refresh in place without changing the question", () => {
    const before = store.listCases(dataset.id)[0]
    const session = store.createCaseRefreshSession({
        datasetId: dataset.id,
        caseId: before.id,
        episode: refreshedEpisode(before.question),
        curator: {modelId: "gpt-refresh"},
    })
    store.recordCurationRevision(session.id, validRevision("new answer"))
    const after = store.archiveCurationSession(session.id)
    assert.equal(after.id, before.id)
    assert.equal(after.question, before.question)
    assert.equal(after.answer.includes("new answer"), true)
    assert.equal(after.refreshHistory.length, 1)
    assert.equal(after.refreshHistory[0].answer, before.answer)
})
```

- [ ] **Step 2: Run the focused failing store test**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: FAIL because refresh migration/session/archive behavior is absent.

- [ ] **Step 3: Add migration fields and a refresh baseline helper**

Add `refreshHistory`, `lastRefresh`, and a baseline that contains only the Case values Curator and compare-and-set need:

```js
function caseRefreshBaseline(entry) {
    return copy({
        id: entry.id,
        updatedAt: entry.updatedAt,
        question: entry.question,
        answer: entry.answer,
        curated: entry.curated,
        issueDescription: entry.issueDescription ?? "",
        skillReference: entry.skillReference ?? null,
        rubricVersionId: entry.rubricVersionId ?? null,
        rubricCalibration: entry.rubricCalibration ?? null,
        source: entry.source ?? null,
        evidence: entry.evidence ?? null,
    })
}
```

Migration MUST only add missing fields and MUST NOT rewrite questions or answers.

- [ ] **Step 4: Implement `createCaseRefreshSession()`**

Use `newCurationSession()` with `operation: "refresh"`, `targetCaseId`, supplied new Episode, current Rubric snapshot, baseline snapshot, and frozen fields:

```js
createCaseRefreshSession({datasetId, caseId, episode, curator}) {
    const state = this.load()
    const dataset = requireDataset(state, datasetId)
    const target = requireCase(state, datasetId, caseId)
    assertNoActiveCaseMaintenance(state, caseId)
    const session = newCurationSession({
        dataset,
        operation: "refresh",
        targetCaseId: target.id,
        baselineCaseSnapshot: caseRefreshBaseline(target),
        episode,
        input: {
            caseType: target.caseType,
            issueDescription: target.issueDescription ?? "",
            curator,
            rubricVersionSnapshot: currentRubricSnapshot(state, dataset),
        },
    })
    session.targetCaseUpdatedAt = target.updatedAt
    state.curationSessions.push(session)
    this.persist()
    return copy(session)
}
```

Update Case deletion and dataset Skill/Rubric blockers to treat active refresh like active calibration.

- [ ] **Step 5: Implement refresh archival compare-and-set**

Before mutation compare target timestamp, normalized Skill identity, and frozen Rubric version. Append a history entry, then update replaceable fields and `lastRefresh`:

```js
target.refreshHistory.push({
    id: randomUUID(),
    answer: target.answer,
    curated: copy(target.curated),
    skillReference: copy(target.skillReference),
    rubricVersionId: target.rubricVersionId ?? null,
    rubricCalibration: copy(target.rubricCalibration),
    source: copy(target.source),
    evidence: copy(target.evidence),
    archivedAt: now,
})
target.answer = formatCuratedAnswer(draft)
target.curated = draft
target.source = refreshedSource(session, latestRevision)
target.evidence = refreshedEvidence(session)
target.updatedAt = now
target.lastRefresh = refreshSummary(session, now)
```

Never assign `target.question`, `target.id`, `target.datasetId`, `target.caseType`, or `target.createdAt`.

- [ ] **Step 6: Run the focused store test and commit**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/test/local-store.test.cjs
git commit -m "feat: store refreshable case revisions"
```

### Task 2: Curator refresh operation

**Files:**
- Modify: `desktop/rolling-skill/src/episode-curation.cjs`
- Modify: `desktop/rolling-skill/src/curation-manager.cjs`
- Modify: `desktop/rolling-skill/test/episode-curation.test.cjs`
- Modify: `desktop/rolling-skill/test/curation-manager.test.cjs`

- [ ] **Step 1: Write failing prompt and lifecycle tests**

Assert a refresh prompt labels the baseline as historical, says values must be re-established from new evidence, preserves the immutable original question, and starts a `refresh` Session through `CurationManager.createRefreshSession()`. Reuse existing tests for cancel checks after every asynchronous Runtime boundary.

```js
assert.match(prompt, /historical.*not current truth/iu)
assert.match(prompt, /immutable evaluation question/iu)
assert.equal(created.operation, "refresh")
```

- [ ] **Step 2: Run the focused failing tests**

Run: `cd desktop/rolling-skill && node --test test/episode-curation.test.cjs test/curation-manager.test.cjs`

Expected: FAIL because refresh prompting and manager entry point are absent.

- [ ] **Step 3: Extend `buildCuratorPrompt()` for refresh**

Add `operation` and `refreshBaseline` inputs. The refresh-specific section must say:

```js
const refreshGuidance = operation === "refresh" ? `
This is a Case refresh. The baseline is historical guidance about intent and prior workflow, not
current truth. Use only the new replay episode as evidence for current values and current tool
behavior. The evaluation question is immutable. Return a complete replacement contract.
<historical-case-baseline>${JSON.stringify(refreshBaseline)}</historical-case-baseline>` : ""
```

Keep the current goodcase/badcase and Rubric validation rules unchanged.

- [ ] **Step 4: Add `createRefreshSession()` and kickoff routing**

The new entry point reserves the dataset, calls `store.createCaseRefreshSession()`, emits the Session, and queues `startInitialTurn()`. `startInitialTurn()` chooses a refresh kickoff and passes `operation` plus baseline to `buildCuratorPrompt()`.

```js
async createRefreshSession(input) {
    const release = this.store.reserveDataset(input.datasetId)
    try {
        const session = this.store.createCaseRefreshSession(input)
        this.emitChanged(session)
        this.queue(session.id, () => this.startInitialTurn(session.id))
        return session
    } finally {
        release()
    }
}
```

- [ ] **Step 5: Run focused Curator tests and commit**

Run: `cd desktop/rolling-skill && node --test test/episode-curation.test.cjs test/curation-manager.test.cjs test/local-store.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/episode-curation.cjs desktop/rolling-skill/src/curation-manager.cjs desktop/rolling-skill/test/episode-curation.test.cjs desktop/rolling-skill/test/curation-manager.test.cjs
git commit -m "feat: curate refreshed case evidence"
```

### Task 3: CaseRefreshManager replay

**Files:**
- Create: `desktop/rolling-skill/src/case-refresh-manager.cjs`
- Create: `desktop/rolling-skill/test/case-refresh-manager.test.cjs`
- Modify: `desktop/rolling-skill/src/codex-app-server.cjs`
- Modify: `desktop/rolling-skill/src/codebuddy-acp-client.cjs`
- Modify: `desktop/rolling-skill/src/deepseek-harness-client.cjs`
- Modify: `desktop/rolling-skill/test/codex-app-server.integration.test.cjs`
- Modify: `desktop/rolling-skill/test/codebuddy-runtime-provider.test.cjs`
- Modify: `desktop/rolling-skill/test/deepseek-harness-runtime-provider.test.cjs`

- [ ] **Step 1: Write failing refresh manager tests**

Test current Case/dataset lookup, current Skill verification, Task profile model/effort, explicit Skill activation, baseline prompt safety text, `onThreadStarted`, read-back Episode creation, Curation handoff, duplicate-active refresh rejection, replay failure without Curation, and hidden thread IDs.

```js
it("replays the immutable question with current Skill and creates a refresh Draft", async () => {
    const session = await manager.createSession({datasetId: "dataset-1", caseId: "case-1"})
    assert.equal(runtimeInput.activationMode, "explicit")
    assert.equal(runtimeInput.skillReference.name, "billing-cost-management")
    assert.match(runtimeInput.question, /do not copy historical values/iu)
    assert.equal(curationInput.episode.originalQuestion, "original question")
    assert.equal(session.operation, "refresh")
})
```

- [ ] **Step 2: Run the focused failing manager test**

Run: `cd desktop/rolling-skill && node --test test/case-refresh-manager.test.cjs`

Expected: FAIL because the manager module does not exist.

- [ ] **Step 3: Add Runtime thread-start callbacks**

In all three `runEvaluationCase()` adapters invoke an optional callback immediately after `startThread()`:

```js
const threadId = threadResponse.thread.id
input.onThreadStarted?.(threadId)
```

Add provider tests that assert exactly one callback with the returned thread ID. This is an in-process callback only; do not serialize or expose it through IPC.

- [ ] **Step 4: Implement refresh prompt and manager**

Export a pure prompt builder and manager:

```js
function buildCaseRefreshPrompt(entry) {
    return `Re-execute the immutable evaluation question below with the current Skill and current
tools. The historical Case is guidance about intent and prior workflow only. Do not copy historical
values as current truth. Do not perform protected external writes; stop and explain if confirmation
would be required.

<immutable-question>${entry.question}</immutable-question>
<historical-case>${JSON.stringify({answer: entry.answer, curated: entry.curated})}</historical-case>`
}
```

`CaseRefreshManager.createSession()` must reserve the dataset, verify the current Skill, call `runtime.runEvaluationCase()`, add the replay thread ID to `hidden`, read the thread back, build an Episode with `originalQuestionOverride: entry.question`, and call `curationManager.createRefreshSession()`. Always release reservations and archive or retain internal thread identity for filtering.

- [ ] **Step 5: Add original-question override to Episode snapshot**

Extend `buildEpisodeSnapshot()` with an optional `originalQuestionOverride` that changes only `episode.originalQuestion`. Keep normalized items and source boundaries from the replay thread so tools and Trace remain observable.

- [ ] **Step 6: Run manager and provider tests**

Run: `cd desktop/rolling-skill && node --test test/case-refresh-manager.test.cjs test/episode-curation.test.cjs test/codex-app-server.integration.test.cjs test/codebuddy-runtime-provider.test.cjs test/deepseek-harness-runtime-provider.test.cjs`

Expected: PASS.

- [ ] **Step 7: Commit replay support**

```bash
git add desktop/rolling-skill/src/case-refresh-manager.cjs desktop/rolling-skill/src/*client.cjs desktop/rolling-skill/src/codex-app-server.cjs desktop/rolling-skill/src/episode-curation.cjs desktop/rolling-skill/test
git commit -m "feat: replay cases with current skill behavior"
```

### Task 4: Refresh main/preload integration

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Add failing bridge assertions**

Assert main creates `CaseRefreshManager`, includes its hidden threads in thread list/read guards, passes current Task profile, emits Curation changes through existing channels, and exposes `createCaseRefresh({datasetId, caseId})` in preload.

- [ ] **Step 2: Run focused failing bridge test**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs`

Expected: FAIL.

- [ ] **Step 3: Wire manager and IPC**

Instantiate after `CurationManager` and Runtime registry dependencies exist. Add:

```js
ipcMain.handle("cases:refresh", async (_event, input = {}) =>
    caseRefreshManager.createSession({
        datasetId: requireIdentifier(input.datasetId, "dataset"),
        caseId: requireIdentifier(input.caseId, "Case"),
    }),
)
```

Preload exposes `createCaseRefresh`. Add `caseRefreshManager.hiddenThreadIds()` to normal/archived thread filtering and hidden read rejection.

- [ ] **Step 4: Run bridge and manager tests, then commit**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs test/case-refresh-manager.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/main.cjs desktop/rolling-skill/src/preload.cjs desktop/rolling-skill/test/main-bridge.test.cjs
git commit -m "feat: expose case refresh sessions"
```

### Task 5: Refresh batch state machine

**Files:**
- Create: `desktop/rolling-skill/renderer/case-refresh-batch.js`
- Create: `desktop/rolling-skill/test/case-refresh-batch.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`

- [ ] **Step 1: Write failing batch tests**

Mirror calibration guarantees without a Rubric calibration key: unique ordered Case IDs, one active Case, `operation === "refresh"` matching, auto-archive exactly once, completion, stop, manual pause, and failure.

```js
const batch = new CaseRefreshBatch({datasetId: "dataset-1", caseIds: ["good-1", "bad-1"]})
assert.equal(batch.nextCase(), "good-1")
batch.attachSession("good-1", "refresh-1")
assert.equal(batch.beginAutoArchive({
    id: "refresh-1", operation: "refresh", targetCaseId: "good-1",
    status: "needs_review", draft: {},
}), true)
```

- [ ] **Step 2: Run the focused failing batch test**

Run: `cd desktop/rolling-skill && node --test test/case-refresh-batch.test.cjs`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `CaseRefreshBatch`**

Copy the proven calibration transitions but remove `rubricVersionId`, use refresh-specific errors, and require `session.operation === "refresh"`. Expose the module in `index.html` before `renderer.js`.

- [ ] **Step 4: Run the batch test and commit**

Run: `cd desktop/rolling-skill && node --test test/case-refresh-batch.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/renderer/case-refresh-batch.js desktop/rolling-skill/test/case-refresh-batch.test.cjs desktop/rolling-skill/renderer/index.html
git commit -m "feat: add sequential case refresh batches"
```

### Task 6: Single refresh and Draft UI

**Files:**
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Add failing surface assertions**

Assert localized `refreshCase`, `refreshingCase`, `reviewRefresh`, `caseRefresh`, `refreshBaseline`, success, drift, and failure keys exist in English and Chinese; Case rows produce `data-refresh-evaluation-case`; refresh Drafts render baseline; manual follow-up stops automatic refresh batch.

- [ ] **Step 2: Run focused failing surface test**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs`

Expected: FAIL.

- [ ] **Step 3: Add Case row action and refresh state**

Track `refreshStartingCaseIds` and find active `operation === "refresh"` Sessions by `targetCaseId`. Each row shows Update, Updating…, or View update. Disable delete while active Case maintenance exists. `createCaseRefresh()` opens the returned Draft exactly like calibration.

- [ ] **Step 4: Render refresh Draft baseline and operation labels**

Reuse `.curation-reference-card` for the saved baseline. Done toast must say Case updated; Discard and follow-up use the existing lifecycle. Do not duplicate the structured replacement contract inside the conversation.

- [ ] **Step 5: Add matching styles and run focused tests**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/case-refresh-batch.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit single refresh UI**

```bash
git add desktop/rolling-skill/renderer/renderer.js desktop/rolling-skill/renderer/styles.css desktop/rolling-skill/test/local-first-surface.test.cjs
git commit -m "feat: review refreshed case drafts"
```

### Task 7: Batch scope dialog and orchestration

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Add failing dialog/orchestration assertions**

Assert a batch dialog contains `goodcase` and `all`, the toolbar has a batch refresh action, Goodcase filtering uses `entry.caseType === "goodcase"`, progress strings exist in both languages, valid Draft updates call automatic archive, and stop prevents the next Case.

- [ ] **Step 2: Run focused failing surface and batch tests**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/case-refresh-batch.test.cjs`

Expected: FAIL for missing dialog and orchestration.

- [ ] **Step 3: Add dialog and sequential orchestration**

Add `openCaseRefreshBatchDialog()`, `startCaseRefreshBatch()`, `advanceCaseRefreshBatch()`, `maybeAutoArchiveRefresh()`, and `stopCaseRefreshBatch()`. Follow the calibration control flow but validate only dataset identity and current Case existence/update eligibility.

```js
const caseIds = state.evaluationCases
    .filter((entry) => scope === "all" || entry.caseType === "goodcase")
    .map((entry) => entry.id)
state.refreshBatch = new CaseRefreshBatch({datasetId: state.evaluationDatasetId, caseIds})
```

Pause on failed Session, target drift, manual send/retry/Done/Discard, or dataset switch.

- [ ] **Step 4: Add localized progress UI and focused styles**

Reuse calibration panel tokens with refresh-specific classes and strings. Show completed/total, current Case title, Saving…, Complete, Stopped, and Paused error. Keep the control neutral blue until the user opens the confirmation dialog.

- [ ] **Step 5: Run refresh-focused tests**

Run: `cd desktop/rolling-skill && node --test test/case-refresh-manager.test.cjs test/case-refresh-batch.test.cjs test/curation-manager.test.cjs test/local-store.test.cjs test/main-bridge.test.cjs test/local-first-surface.test.cjs`

Expected: PASS.

- [ ] **Step 6: Mark OpenSpec refresh tasks and commit**

Mark tasks 2.1 through 3.3 complete in `openspec/changes/case-lifecycle-maintenance/tasks.md`, then:

```bash
git add desktop/rolling-skill/renderer openspec/changes/case-lifecycle-maintenance/tasks.md
git commit -m "feat: batch refresh dataset cases"
```
