# Case Deletion Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve selected Case questions in Raw Cases before deleting a Case or dataset, with fail-safe ordering and bilingual confirmation controls.

**Architecture:** Add deletion preflight snapshots to `LocalEvaluationStore`, coordinate Raw Case writes and formal deletion in a focused `CaseRecycleService`, then pass a `recoverQuestions` flag through the existing Electron bridge. The service writes synchronous Raw Case chunks before invoking the existing synchronous deletion methods, so failure can leave a harmless duplicate but cannot lose the source question.

**Tech Stack:** Node.js CommonJS, Electron IPC/preload, append-only `RawCaseStore`, local JSON `LocalEvaluationStore`, vanilla HTML/CSS/JavaScript, `node:test`.

---

### Task 1: Deletion preflight snapshots

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`

- [ ] **Step 1: Write failing tests for Case and dataset preflight**

Add tests that create Cases, assert `prepareCaseDeletion()` returns one immutable snapshot, assert `prepareDatasetDeletion()` returns every Case, and assert the same active-calibration/Curator/Rubric/reservation blockers used by formal deletion are raised before a snapshot is returned.

```js
it("preflights Case and dataset deletion with frozen recovery inputs", () => {
    const {store, dataset} = fixtureWithCases(["question one", "question two"])
    const one = store.prepareCaseDeletion(dataset.id, store.listCases(dataset.id)[0].id)
    assert.equal(one.cases.length, 1)
    assert.equal(one.cases[0].question, "question one")
    const all = store.prepareDatasetDeletion(dataset.id)
    assert.deepEqual(all.cases.map((entry) => entry.question), ["question one", "question two"])
})
```

- [ ] **Step 2: Run the focused failing test**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: FAIL because `prepareCaseDeletion` and `prepareDatasetDeletion` do not exist.

- [ ] **Step 3: Extract shared blocker checks and return copies**

Implement private helpers used by both preflight and deletion, then expose:

```js
prepareCaseDeletion(datasetId, caseId) {
    const state = this.load()
    const dataset = requireDataset(state, datasetId)
    const target = requireCase(state, datasetId, caseId)
    assertCaseDeletable(state, datasetId, caseId)
    return copy({dataset, cases: [target]})
}

prepareDatasetDeletion(datasetId) {
    const state = this.load()
    const dataset = requireDataset(state, datasetId)
    assertDatasetDeletable(state, this.datasetReservations, datasetId)
    return copy({
        dataset,
        cases: state.cases.filter((entry) => entry.datasetId === datasetId),
    })
}
```

Make `deleteCase()` and `deleteDataset()` call the same helpers so preflight cannot drift from commit checks.

- [ ] **Step 4: Run the focused store test**

Run: `cd desktop/rolling-skill && node --test test/local-store.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the preflight foundation**

```bash
git add desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/test/local-store.test.cjs
git commit -m "feat: preflight recoverable case deletion"
```

### Task 2: CaseRecycleService

**Files:**
- Create: `desktop/rolling-skill/src/case-recycle-service.cjs`
- Create: `desktop/rolling-skill/test/case-recycle-service.test.cjs`

- [ ] **Step 1: Write failing service tests**

Cover byte-for-byte questions, Skill ID/name/path mapping, no answer leakage, duplicate acceptance, more than 200 Cases in multiple calls, any rejected entry aborting deletion, and `recoverQuestions: false` bypassing Raw Case writes.

```js
it("persists every question before deleting a dataset", () => {
    const calls = []
    const service = new CaseRecycleService({
        store: fakeStoreWithDataset(201),
        rawCaseStore: {addMany: (entries) => (calls.push(entries), {created: entries, duplicates: [], rejected: []})},
        now: () => "2026-08-26T02:00:00.000Z",
    })
    service.deleteDataset({datasetId: "dataset-1", recoverQuestions: true})
    assert.deepEqual(calls.map((batch) => batch.length), [200, 1])
})
```

- [ ] **Step 2: Run the focused failing test**

Run: `cd desktop/rolling-skill && node --test test/case-recycle-service.test.cjs`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement deterministic mapping and ordered commit**

Implement the exported service and mapper:

```js
const {MAX_BATCH_SIZE} = require("./raw-case-store.cjs")

function recoveryInput(dataset, entry, recoveredAt) {
    const skill = entry.skillReference ?? dataset.skillReference
    return {
        question: entry.question,
        skill: {id: skill?.id, name: skill?.name, path: skill?.path},
        note: `${dataset.name} · ${entry.caseType} · recovered before deletion`,
        source: {
            kind: "deleted_case",
            datasetId: dataset.id,
            caseId: entry.id,
            caseType: entry.caseType,
            recoveredAt,
        },
    }
}

class CaseRecycleService {
    constructor({store, rawCaseStore, now = () => new Date().toISOString()}) {
        this.store = store
        this.rawCaseStore = rawCaseStore
        this.now = now
    }

    recover(snapshot) {
        const inputs = snapshot.cases.map((entry) => recoveryInput(snapshot.dataset, entry, this.now()))
        for (let offset = 0; offset < inputs.length; offset += MAX_BATCH_SIZE) {
            const result = this.rawCaseStore.addMany(inputs.slice(offset, offset + MAX_BATCH_SIZE))
            if (result.rejected.length) throw new Error(`Raw Case recovery failed: ${result.rejected[0].error}`)
        }
    }

    deleteCase({datasetId, caseId, recoverQuestions = true}) {
        const snapshot = this.store.prepareCaseDeletion(datasetId, caseId)
        if (recoverQuestions) this.recover(snapshot)
        return this.store.deleteCase(datasetId, caseId)
    }

    deleteDataset({datasetId, recoverQuestions = true}) {
        const snapshot = this.store.prepareDatasetDeletion(datasetId)
        if (recoverQuestions) this.recover(snapshot)
        return this.store.deleteDataset(datasetId)
    }
}
```

Omit undefined Skill fields before calling `RawCaseStore` and keep all operations synchronous.

- [ ] **Step 4: Run service and store tests**

Run: `cd desktop/rolling-skill && node --test test/case-recycle-service.test.cjs test/local-store.test.cjs test/raw-case-store.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the recovery service**

```bash
git add desktop/rolling-skill/src/case-recycle-service.cjs desktop/rolling-skill/test/case-recycle-service.test.cjs
git commit -m "feat: recover deleted case questions"
```

### Task 3: Electron bridge

**Files:**
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`

- [ ] **Step 1: Add failing bridge assertions**

Assert preload sends object inputs and main routes them through `CaseRecycleService`:

```js
assert.match(preloadSource, /deleteDataset:\s*\(datasetId, recoverQuestions = true\)/u)
assert.match(mainSource, /caseRecycleService\.deleteDataset/u)
assert.match(mainSource, /caseRecycleService\.deleteCase/u)
```

- [ ] **Step 2: Run the focused failing bridge test**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs`

Expected: FAIL because the new signatures and service wiring are absent.

- [ ] **Step 3: Instantiate and route the service**

Create `caseRecycleService` immediately after both stores exist. Change handlers and preload APIs to:

```js
deleteCase: (datasetId, caseId, recoverQuestions = true) =>
    ipcRenderer.invoke("datasets:delete-case", {datasetId, caseId, recoverQuestions}),
deleteDataset: (datasetId, recoverQuestions = true) =>
    ipcRenderer.invoke("datasets:delete", {datasetId, recoverQuestions}),
```

Main handlers validate IDs, normalize `recoverQuestions !== false`, and call the service. Do not alter Control Plane deletion contracts in this phase.

- [ ] **Step 4: Run bridge and service tests**

Run: `cd desktop/rolling-skill && node --test test/main-bridge.test.cjs test/case-recycle-service.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the bridge**

```bash
git add desktop/rolling-skill/src/main.cjs desktop/rolling-skill/src/preload.cjs desktop/rolling-skill/test/main-bridge.test.cjs
git commit -m "feat: expose safe case deletion recovery"
```

### Task 4: Bilingual delete dialogs

**Files:**
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`

- [ ] **Step 1: Add failing static UI assertions**

Assert both dialogs contain checkbox elements, dataset recovery count, English and Chinese keys, and both delete calls pass the checkbox value.

```js
assert.match(html, /id="recover-deleted-case-question"/u)
assert.match(html, /id="recover-deleted-dataset-questions"/u)
assert.match(renderer, /deleteCase\([^,]+,[^,]+,\s*elements\.recoverDeletedCaseQuestion\.checked/u)
assert.match(renderer, /recoverDeleteQuestions:\s*"删除前将问题保留到 Raw Case"/u)
```

- [ ] **Step 2: Run the focused failing surface test**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs`

Expected: FAIL because recovery controls and strings are absent.

- [ ] **Step 3: Add dialog controls and state wiring**

Use a shared compact checkbox row:

```html
<label class="confirm-preserve-option">
    <input id="recover-deleted-case-question" type="checkbox" checked />
    <span><strong data-i18n="recoverDeleteQuestions"></strong><small data-i18n="recoverDeleteCaseHelp"></small></span>
</label>
```

Reset each checkbox to checked when opening a dialog. For datasets compute the selected dataset `caseCount`, render the localized count, and disable the option when the count is zero. Pass the boolean to preload. Keep dialogs open and show the existing error region if recovery fails.

- [ ] **Step 4: Add bilingual strings and matching styles**

Add English and `zh-CN` strings for the option, count, successful recovery, and recovery failure. Style `.confirm-preserve-option` using current border, surface, radius, spacing, focus, and theme variables; do not add a new color system.

- [ ] **Step 5: Run focused deletion UI tests**

Run: `cd desktop/rolling-skill && node --test test/local-first-surface.test.cjs test/main-bridge.test.cjs test/case-recycle-service.test.cjs`

Expected: PASS.

- [ ] **Step 6: Mark OpenSpec deletion tasks and commit**

Mark tasks 1.1 through 1.4 complete in `openspec/changes/case-lifecycle-maintenance/tasks.md`, then:

```bash
git add desktop/rolling-skill/renderer openspec/changes/case-lifecycle-maintenance/tasks.md
git commit -m "feat: add delete recovery controls"
```
