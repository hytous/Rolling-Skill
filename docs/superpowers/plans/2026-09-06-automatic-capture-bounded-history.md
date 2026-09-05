# Automatic Capture Bounded History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly forbids subagent coding. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Automatic Capture scan long Codex conversations without full-history/whole-trace string allocation and without one unreadable thread aborting the slot.

**Architecture:** Add a capture-specific bounded history reader to the Codex client, compact historical RPC payloads only in the trace copy, and replace whole-file JSONL reads with a synchronous chunked iterator. Automatic Capture passes its persisted anchors to the bounded reader and isolates per-thread failures.

**Tech Stack:** Node.js CommonJS, Codex app-server JSON-RPC, synchronous filesystem APIs, `node:test`, Electron packaging, esbuild DSH bundles.

---

### Task 1: Stream Trace JSONL Reads

**Files:**
- Modify: `desktop/rolling-skill/src/trace-recorder.cjs`
- Test: `desktop/rolling-skill/test/trace-recorder.test.cjs`

- [x] **Step 1: Write the failing no-whole-file-read test**

Load `trace-recorder.cjs` with `node:fs.readFileSync` temporarily replaced by a function that throws,
then verify `evidenceForReference()`, `readRecent()`, and `referenceForEpisode()` still work on a
real JSONL trace. The test must fail against the existing implementation with the sentinel error.

```js
assert.doesNotThrow(() => recorder.evidenceForReference(reference))
assert.deepEqual(recorder.readRecent(1).map((entry) => entry.sequence), [3])
assert.equal(recorder.referenceForEpisode(range), "trace://streaming.jsonl#L1-L3")
```

- [x] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/trace-recorder.test.cjs`

Expected: FAIL because one of the public readers calls `readFileSync(this.path, "utf8")`.

- [x] **Step 3: Implement a bounded synchronous JSONL iterator**

Use `openSync`, `readSync`, and a fixed `Buffer` to yield complete lines without retaining the
whole file. Add helpers equivalent to:

```js
function *jsonLines(path, {start = 1, end = Infinity} = {}) {
    // Read fixed-size chunks, retain only the current incomplete line,
    // parse lines whose one-based number lies in [start, end], and close in finally.
}
```

Refactor all three public readers to retain only the data they need: the requested evidence range,
a fixed recent tail, or matching episode line numbers.

- [x] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test test/trace-recorder.test.cjs`

Expected: all trace-recorder tests pass with no sentinel `readFileSync` call.

### Task 2: Compact Historical RPC Trace Entries

**Files:**
- Modify: `desktop/rolling-skill/src/trace-recorder.cjs`
- Test: `desktop/rolling-skill/test/trace-recorder.test.cjs`

- [x] **Step 1: Write the failing history-payload test**

Record an outbound `thread/read`, then an inbound response containing a very large tool result.
Assert the JSONL does not contain that result text, while `threadId`, turn ID, and item IDs remain
available and `referenceForEpisode()` still finds the range.

```js
assert.doesNotMatch(traceText, /oversized-history-payload/u)
assert.match(traceText, /user-1/u)
assert.match(traceText, /answer-1/u)
```

- [x] **Step 2: Run the test and confirm RED**

Run: `node --test test/trace-recorder.test.cjs`

Expected: FAIL because the current recorder serializes the complete inbound history response.

- [x] **Step 3: Add request-aware trace compaction**

Track outbound request method by JSON-RPC ID. Before constructing the trace entry, make a detached
compact copy only for inbound responses to `thread/read` and `thread/turns/list`:

```js
{
  id,
  result: {
    thread: {
      id,
      turns: turns.map(turn => ({
        id: turn.id,
        status: turn.status,
        items: turn.items.map(item => ({id: item.id, type: item.type})),
      })),
    },
  },
}
```

Preserve page cursors and never mutate the response object supplied to the RPC caller.

- [x] **Step 4: Run trace tests and confirm GREEN**

Run: `node --test test/trace-recorder.test.cjs`

Expected: all tests pass and the oversized payload is absent from disk.

### Task 3: Add Bounded Codex Capture History

**Files:**
- Modify: `desktop/rolling-skill/src/codex-app-server.cjs`
- Test: `desktop/rolling-skill/test/codex-app-server.integration.test.cjs`

- [x] **Step 1: Write failing request-construction tests**

Stub `client.request()` with metadata and descending paginated turn responses. Verify the desired
API stops after finding the persisted anchor, returns chronological turns, immediately compacts
large tool output, and limits an initial scan. Add a separate invalid-lineage response and verify a
bounded `thread/read(includeTurns: true)` compatibility fallback.

```js
const result = await client.readThreadForCapture("thread-1", {
    afterUserItemId: "user-anchor",
})
assert.deepEqual(requests.map(({method}) => method), [
    "thread/read",
    "thread/turns/list",
    "thread/turns/list",
])
assert.equal(result.thread.turns[0].id, "older-turn")
```

- [x] **Step 2: Run the Codex client test and confirm RED**

Run: `node --test test/codex-app-server.integration.test.cjs`

Expected: FAIL because `readThreadForCapture` does not exist.

- [x] **Step 3: Implement capture history paging and compaction**

Add fixed internal limits for turn page size, initial recent turns, maximum collected turns, and
bounded item fields. Request metadata without turns, page `thread/turns/list` using
`sortDirection: "desc"` and `itemsView: "full"`, compact each page before retaining it, and stop
after the preferred pending/inspected user anchor is found. Reverse collected turns before return.

If pagination returns the known invalid-lineage/not-supported protocol errors, call the legacy
full-history method once, keep only the bounded recent/anchor range, and compact before returning.
Other errors remain visible to the caller.

- [x] **Step 4: Run Codex client tests and confirm GREEN**

Run: `node --test test/codex-app-server.integration.test.cjs`

Expected: all tests pass.

### Task 4: Use Anchors and Isolate Source-Thread Failures

**Files:**
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`
- Test: `desktop/rolling-skill/test/automatic-capture.test.cjs`

- [x] **Step 1: Write failing Automatic Capture tests**

Add one test proving `scanThread()` calls `readThreadForCapture()` with both persisted anchors and
does not call legacy `readThread()`. Add another with two listed source threads where the first
throws the V8-style RangeError and the second is inspected successfully.

```js
assert.deepEqual(captureReads[0], {
    threadId: "thread-1",
    afterUserItemId: "user-1",
    pendingStartUserItemId: null,
})
assert.deepEqual(successfulReads, ["thread-2"])
```

- [x] **Step 2: Run Automatic Capture tests and confirm RED**

Run: `node --test test/automatic-capture.test.cjs`

Expected: FAIL because the manager only calls `readThread()` and aborts the slot on the first error.

- [x] **Step 3: Implement manager integration**

Read the thread cursor before history hydration, prefer `runtime.readThreadForCapture()` when
available, and pass inspected/pending anchors. Wrap each `scanThread()` call in the existing source
thread loop with a per-thread `try/catch`; call `onError`, record a compact failed-thread summary in
progress, leave its cursor unchanged, and continue. Keep configuration/runtime-wide failures fatal.

- [x] **Step 4: Run Automatic Capture tests and confirm GREEN**

Run: `node --test test/automatic-capture.test.cjs`

Expected: all tests pass and the second source thread is inspected after the first fails.

### Task 5: Rebuild, Verify, Install, and Record

**Files:**
- Modify (generated): `packages/rolling-skill-dsh/lib/index.js`
- Modify (generated): `packages/rolling-skill-dsh/lib/worker.cjs`
- Modify: `docs/superpowers/plans/2026-09-06-automatic-capture-bounded-history.md`
- Modify outside target repository: agent project record files

- [x] **Step 1: Rebuild bundled consumers**

Run: `npm run build:dsh`

Expected: esbuild succeeds and the generated DSH bundles contain the updated shared modules.

- [x] **Step 2: Run focused and full verification**

Run:

```bash
cd desktop/rolling-skill
node --test test/trace-recorder.test.cjs test/codex-app-server.integration.test.cjs test/automatic-capture.test.cjs
npm test
npm run smoke:renderer
npm run build:tool
cd ../..
npm run test:dsh
git diff --check
```

Expected: zero failures, renderer errors, build errors, and whitespace errors.

- [x] **Step 3: Reproduce the historical failure safely**

Use a temporary trace containing enough aggregate data to exceed the configured test threshold and
verify evidence collection remains bounded. Probe the installed local Codex app-server with the
capture-specific reader against the previously failing long thread and assert the returned history
and new trace stay within the fixed bounds.

- [x] **Step 4: Package and install the macOS app**

Run `bash desktop/rolling-skill/scripts/build-macos-app.sh`, replace
`/Applications/Rolling Skill.app` using the existing recoverable backup workflow, verify the local
development signature, launch it, and confirm the main process remains alive.

- [x] **Step 5: Commit and push only intended files**

Explicitly stage source, tests, generated bundles, spec, and plan. Verify no
`rolling-skill-dsh-plugin-*.tgz` appears in the staged list, then commit and push `main` to
`rolling-skill`.

- [x] **Step 6: Append the final project record**

Append final verification and `final_commit_id` for requirement
`20260906-0012-automatic-capture-large-trace`, update concise module onboarding only if the bounded
history/trace constraint is not already captured, then commit and push the external record repo.
