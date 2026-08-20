# Raw Case Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Skill-grouped Raw Case inbox that external Agents can fill through CLI/MCP and users can dispatch verbatim to current or new runtime conversations, plus visually mark conversation ranges already sent through Case curation.

**Architecture:** Keep candidate questions in an append-only JSONL event store separate from formal evaluation data. Electron main watches that store and exposes narrow IPC; renderer owns dispatch because it already owns the selected runtime profile and active-conversation state. Curation range metadata is derived from the existing evaluation store and attached to `thread/read` responses.

**Tech Stack:** Electron 43, Node.js CommonJS for App/store, ESM official MCP TypeScript Server SDK v2 for stdio Tool, vanilla HTML/CSS/JavaScript renderer, Node test runner, renderer smoke test.

---

## File map

- Create `desktop/rolling-skill/src/raw-case-store.cjs`: append-only event validation, reduction, deduplication and file watching.
- Create `desktop/rolling-skill/tools/rolling-skill-tool.mjs`: CLI and MCP stdio entrypoint.
- Create `desktop/rolling-skill/test/raw-case-store.test.cjs`: store behavior and corrupt-tail/concurrent append coverage.
- Create `desktop/rolling-skill/test/rolling-skill-tool.test.cjs`: CLI JSON contract and MCP Tool behavior.
- Modify `desktop/rolling-skill/src/local-store.cjs`: curation range marker query only; do not put Raw Cases in evaluation state.
- Modify `desktop/rolling-skill/src/main.cjs`: initialize/close RawCaseStore, send change events, add IPC, attach curation markers to thread reads.
- Modify `desktop/rolling-skill/src/preload.cjs`: expose Raw Case operations and changed subscription.
- Modify `desktop/rolling-skill/renderer/index.html`: right inbox panel and narrow-screen topbar trigger.
- Modify `desktop/rolling-skill/renderer/renderer.js`: state/render/events, manual add/edit/delete, current/new dispatch, curation range decoration.
- Modify `desktop/rolling-skill/renderer/styles.css`: responsive three-column/drawer layout and curation colors.
- Modify `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`: Raw Case and marker fixtures.
- Modify `desktop/rolling-skill/scripts/renderer-smoke.cjs`: inbox/dispatch/marker smoke assertions.
- Modify `desktop/rolling-skill/scripts/build-macos-app.sh`: copy an executable Tool next to the built App.
- Modify `desktop/rolling-skill/package.json` and lockfile: MCP Server v2, Zod v4, packaged Tool resources.
- Modify `desktop/rolling-skill/README.md`: user workflow and external Agent setup.

### Task 1: Append-only Raw Case store

**Files:**
- Create: `desktop/rolling-skill/test/raw-case-store.test.cjs`
- Create: `desktop/rolling-skill/src/raw-case-store.cjs`

- [ ] **Step 1: Write failing tests for add/list/deduplicate**

```js
const store = new RawCaseStore(join(temp, "raw-case-events.jsonl"))
const first = store.add({
    skill: {name: "billing-cost-management"},
    question: "查一下7月份账单",
    source: {kind: "manual"},
})
const duplicate = store.add({
    skill: {name: "billing-cost-management"},
    question: "  查一下7月份账单  ",
    source: {kind: "mcp"},
})
assert.equal(duplicate.duplicateOf, first.id)
assert.deepEqual(store.list().map((entry) => entry.id), [first.id])
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/raw-case-store.test.cjs`

Expected: FAIL with `Cannot find module '../src/raw-case-store.cjs'`.

- [ ] **Step 3: Implement schemas and append/reduce behavior**

Export:

```js
class RawCaseStore {
    constructor(path, {watch = false, onChanged = null} = {})
    add(input)
    addMany({skill, questions, source})
    list({skillName = null} = {})
    update(id, patch)
    delete(id)
    markDispatched(id, dispatch)
    close()
}

function defaultRawCasePath({platform = process.platform, home = homedir()} = {})
```

Use event schema `rolling-skill-raw-case-event/v1`. Normalize question with `trim()` only, keep its internal whitespace verbatim, and use normalized Skill name plus trimmed question for exact pending deduplication. Write each event with one `appendFileSync(path, JSON + "\n", {mode: 0o600})` call.

- [ ] **Step 4: Add failing tests for update/delete/dispatch and recovery**

Cover:

```js
store.update(id, {question: "新的原始问题"})
store.markDispatched(id, {runtimeId: "codex:test", threadId: "thread-1", turnId: "turn-1", mode: "new"})
assert.equal(store.list().length, 0)
appendFileSync(path, '{"incomplete":')
assert.doesNotThrow(() => new RawCaseStore(path).list())
```

Also spawn two Node writers against one file and assert all unique records are readable.

- [ ] **Step 5: Implement remaining mutation, recovery and watching behavior**

Validate maximum one question at 120,000 characters, one batch at 200 records and 1,000,000 total characters. Ignore only the malformed final non-empty line; reject malformed complete lines with an indexed warning returned by `readEvents()` while retaining valid records. Use `watchFile` with a 300ms interval when `watch: true`, coalescing callbacks by file mtime.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test test/raw-case-store.test.cjs`

Expected: all RawCaseStore tests PASS.

### Task 2: CLI and MCP stdio Tool

**Files:**
- Create: `desktop/rolling-skill/test/rolling-skill-tool.test.cjs`
- Create: `desktop/rolling-skill/tools/rolling-skill-tool.mjs`
- Modify: `desktop/rolling-skill/package.json`
- Modify: `desktop/rolling-skill/package-lock.json`

- [ ] **Step 1: Add official MCP dependencies**

Run:

```bash
npm install @modelcontextprotocol/server@^2 zod@^4
```

Expected: package manifest and lockfile contain both production dependencies.

- [ ] **Step 2: Write failing CLI contract tests**

Spawn the Tool with an isolated `ROLLING_SKILL_RAW_CASE_PATH`:

```js
const result = spawnSync(process.execPath, [toolPath, "raw-case", "add", "--skill", "billing-cost-management", "--question", "问题"], {env})
assert.equal(result.status, 0)
assert.equal(JSON.parse(result.stdout).created.length, 1)
assert.equal(result.stderr, "")
```

Add tests for `raw-case import --json-file`, invalid input exit code, and duplicate reporting.

- [ ] **Step 3: Verify CLI RED, then implement minimal CLI**

Run: `node --test test/rolling-skill-tool.test.cjs`

Expected RED: Tool file is missing.

Implement argument parsing without a general CLI framework. stdout prints exactly one JSON document for one-shot commands; diagnostics and usage errors go to stderr.

- [ ] **Step 4: Write failing MCP tests using official client transport**

Use `@modelcontextprotocol/client` only as a dev dependency if required by the test. Connect via stdio and assert:

```js
const tools = await client.listTools()
assert(tools.tools.some(({name}) => name === "rolling_skill_enqueue_raw_cases"))
const added = await client.callTool({name: "rolling_skill_enqueue_raw_cases", arguments: {...}})
```

Test both `rolling_skill_enqueue_raw_cases` and `rolling_skill_list_raw_cases`.

- [ ] **Step 5: Implement MCP server with SDK v2**

Build `McpServer` with Zod v4 schemas and start it through `serveStdio(() => server)`. Never write logging to stdout in MCP mode. Tool content contains a human-readable summary and `structuredContent` with created/duplicate/rejected arrays.

- [ ] **Step 6: Run Tool tests and verify GREEN**

Run: `node --test test/rolling-skill-tool.test.cjs`

Expected: CLI and MCP tests PASS with no stdout protocol contamination.

### Task 3: Electron lifecycle and IPC

**Files:**
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`

- [ ] **Step 1: Add failing bridge assertions**

Assert main initializes `RawCaseStore(defaultRawCasePath())`, sends `raw-cases:changed`, closes its watcher at quit, and registers:

```text
raw-cases:list
raw-cases:add
raw-cases:update
raw-cases:delete
raw-cases:mark-dispatched
```

Assert preload exposes matching methods and `onRawCasesChanged`.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test test/main-bridge.test.cjs`

Expected: FAIL because Raw Case IPC is absent.

- [ ] **Step 3: Implement store lifecycle and validated IPC**

Initialize the separate store beside `evaluation-store.json`. Changed notifications send only `{updatedAt}`; renderer must call list for fresh state. Main validates ids and leaves question/Skill validation to RawCaseStore. Close watcher in `before-quit` and before replacing process state in tests.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test test/main-bridge.test.cjs test/raw-case-store.test.cjs`

Expected: both suites PASS.

### Task 4: Responsive Raw Case inbox and dispatch

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`

- [ ] **Step 1: Add failing static UI contract tests**

Assert DOM ids and renderer operations exist:

```text
raw-case-panel
raw-case-toggle
raw-case-list
raw-case-add-form
loadRawCases
dispatchRawCase
onRawCasesChanged
```

Assert CSS contains a wide-screen three-column rule and a narrow-screen fixed drawer rule.

- [ ] **Step 2: Run focused test and verify RED**

Run: `node --test test/local-first-surface.test.cjs`

Expected: FAIL with missing Raw Case surface.

- [ ] **Step 3: Add state and render the Skill-grouped panel**

State:

```js
rawCases: [],
rawCasesLoading: false,
rawCasePanelOpen: true,
rawCaseEditingId: null,
rawCaseDispatchingIds: new Set(),
```

Populate Skill choices from runtime inventory plus dataset bindings; allow a custom Skill name. Cards show source, time and verbatim question. Persist only panel open/closed in localStorage, not form text.

- [ ] **Step 4: Implement current/new dispatch by extracting existing send flow**

Extract the current `submitTurn()` core into:

```js
async function submitTaskText(text, {forceNewThread = false, rawCaseId = null} = {})
```

Composer submit calls it with the Composer text. Raw Case actions call it with the stored question. `forceNewThread` starts a separate thread without clearing the previous conversation draft. Call `markRawCaseDispatched` only after `startTurn` returns. A failed turn leaves the card pending.

- [ ] **Step 5: Run static tests and existing thread state tests**

Run: `node --test test/local-first-surface.test.cjs test/thread-view-state.test.cjs`

Expected: PASS.

### Task 5: Curation range markers

**Files:**
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`

- [ ] **Step 1: Add failing store tests for marker projection**

Create active, archived and cancelled capture sessions on one source thread. Assert:

```js
assert.deepEqual(store.listCurationMarkers("thread-source"), [
    {sessionId, status: "needs_review", caseId: null, datasetId, startItemId: "user-1", endItemId: "agent-2"},
    {sessionId: archivedId, status: "archived", caseId, datasetId, startItemId: "user-3", endItemId: "agent-4"},
])
```

Cancelled and calibration sessions must be excluded.

- [ ] **Step 2: Verify RED and implement marker projection**

Run: `node --test test/local-store.test.cjs`

Expected RED: `listCurationMarkers is not a function`.

Implement a copied, sorted projection from capture sessions only.

- [ ] **Step 3: Attach markers to readThread and add renderer decoration**

Main adds `thread.rollingSkillCurationMarkers`. Renderer flattens item keys once per render, identifies every item index between start/end, adds `case-range-draft` or `case-range-archived`, and places one badge on the ending Assistant message. Cancelled markers disappear on the next `curation:changed`; if it belongs to the visible thread, reload only curation markers or re-read the current snapshot without losing draft/scroll.

- [ ] **Step 4: Add repeated-curation copy behavior**

For an ending Assistant item with a marker, render the action text as `再次整理` / `Curate again`. Do not disable it. Unmarked responses keep `沉淀 Case`.

- [ ] **Step 5: Run store/main/static tests and verify GREEN**

Run: `node --test test/local-store.test.cjs test/main-bridge.test.cjs test/local-first-surface.test.cjs`

Expected: PASS.

### Task 6: Renderer smoke and packaged Tool

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/scripts/build-macos-app.sh`
- Modify: `desktop/rolling-skill/package.json`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Add failing smoke fixtures and assertions**

Fixture two Skills and three Raw Cases. Assert:

- grouping and counts;
- external changed event adds a card;
- current dispatch sends exact text and removes only the successful card;
- new dispatch creates a separate thread;
- failed dispatch retains its card;
- active and archived curation ranges have different classes and labels;
- narrow viewport opens the same panel as a drawer.

- [ ] **Step 2: Run renderer smoke and verify RED**

Run: `npm run smoke:renderer`

Expected: FAIL on the first missing Raw Case assertion.

- [ ] **Step 3: Complete smoke preload and responsive styling**

Keep the existing fixed Composer and background-notification routing behavior. The wide layout must use `minmax(0, 1fr) 320px`; below 980px use a fixed right drawer and preserve the full Composer width.

- [ ] **Step 4: Package the Tool**

Add `tools/**/*` to packaged files and unpack the Tool. Extend the build script to copy `tools/rolling-skill-tool.mjs` beside `Rolling Skill.app` as `rolling-skill-tool`, retain its shebang and set executable mode. The copied Tool must resolve `src/raw-case-store.cjs` from the packaged Resources path or use a small bundled standalone store module without reading App source from the repository.

- [ ] **Step 5: Document Agent integration**

README includes CLI examples, MCP command configuration, data location, the two Tool names, limits, verbatim dispatch semantics and the statement that Tool enqueue does not create a formal Case.

- [ ] **Step 6: Verify renderer smoke GREEN**

Run: `npm run smoke:renderer`

Expected: JSON summary includes `rawCaseInbox`, `rawCaseCurrentDispatch`, `rawCaseNewDispatch`, `rawCaseExternalRefresh`, `curationRangeMarkers`, and `rendererErrors: 0`.

### Task 7: Full verification, documentation and App delivery

**Files:**
- Modify: `desktop/rolling-skill/README.md`
- Modify: `docs/superpowers/plans/2026-08-20-raw-case-inbox.md` checkboxes during execution only if desired.

- [ ] **Step 1: Run all automated verification**

```bash
cd desktop/rolling-skill
npm test
npm run smoke:renderer
git diff --check
```

Expected: all tests PASS, renderer errors 0, no whitespace errors.

- [ ] **Step 2: Validate MCP with official Inspector/client**

Use the official client test as the non-interactive gate. Optionally launch Inspector manually for visual confirmation; do not make the build depend on a browser interaction.

- [ ] **Step 3: Build and sign**

Run from repository root:

```bash
bash desktop/rolling-skill/scripts/build-macos-app.sh
codesign --verify --deep --strict --verbose=2 "Rolling Skill.app"
```

Expected: signed by `Rolling Skill Local Development`, App and adjacent `rolling-skill-tool` both exist.

- [ ] **Step 4: Relaunch exact App target**

Terminate only the exact existing `Rolling Skill.app/Contents/MacOS/Rolling Skill` PID, then:

```bash
open "/Users/wangbaoheng/Downloads/billing-cli/agenta/Rolling Skill.app"
```

Verify the process stays alive and the Tool can enqueue one temporary smoke record into an isolated path.

- [ ] **Step 5: Update shared project record**

Add the append-only Raw Case separation and verbatim dispatch rule to onboarding only if still under 500 lines. Append a final requirement event without reading historical logs; do not commit unrelated pre-existing memory changes.
