# Automatic Capture Bounded History Design

## Problem

Automatic Capture currently calls Codex `thread/read` with `includeTurns: true` for every visible
thread. It only partitions user messages after the complete thread, including tool results, has
already been returned, retained in memory, and written to the Runtime JSONL trace. A real scan
produced a 794 MiB trace with individual history responses up to roughly 145 MiB.

After a boundary-analysis turn finishes, `TraceRecorder.evidenceForReference()` reads that entire
trace with `readFileSync(path, "utf8")`. Node then attempts to create one string larger than V8's
`0x1fffffe8` character limit and Automatic Capture fails before outcome classification starts.

## Goals

- Never load an entire Runtime trace into one string.
- Avoid full-history hydration for normal Codex Automatic Capture scans.
- Bound the amount of historical item content retained by the scanner while preserving user,
  assistant, and tool evidence required for Case curation.
- Preserve compatibility with Runtime histories that cannot yet use the paginated API.
- Isolate a failed source thread so later threads in the same scheduled slot are still inspected.
- Preserve immutable trace references and semantic evidence behavior used by evaluation and Case
  curation.

## Considered Approaches

### Only stream trace evidence

Changing `TraceRecorder` alone removes the immediate V8 exception, but Automatic Capture would
continue to hydrate and persist hundreds of megabytes per scan. This treats the final symptom and
leaves the source of the oversized trace intact.

### Only paginate and then rebuild the complete thread

Pagination reduces individual protocol messages, but rebuilding every page into one in-memory
thread still scales with total conversation length and the trace still grows with complete tool
outputs. This merely moves the unbounded aggregation.

### Bounded capture history plus streaming trace access

This is the selected design. Codex supplies a capture-specific history method that reads metadata
without turns, pages newest turns backwards, stops when it reaches the persisted Automatic Capture
anchor, and immediately compacts large item content. The generic trace recorder stores a compact
history index rather than duplicate historical payloads and reads JSONL incrementally.

## Design

### Capture-specific Codex history

`CodexAppServerClient.readThreadForCapture(threadId, options)` reads thread metadata with
`includeTurns: false`, then requests `thread/turns/list` in descending order with full items. It
collects only the pages needed to reach `options.afterUserItemId` or
`options.pendingStartUserItemId`. On an initial scan it uses a fixed recent-turn window instead of
backfilling an unlimited archive.

Each returned page is compacted immediately. User and assistant messages retain bounded text;
command output and tool results use the same limits as frozen Episode evidence. The assembled
thread is restored to chronological order before being returned to Automatic Capture.

Some existing Codex histories currently reject paginated history with an invalid-lineage error.
For those histories only, the method falls back to `thread/read(includeTurns: true)`, then
immediately keeps and compacts only the bounded recent range. The trace layer described below
prevents the compatibility response from being duplicated in full on disk.

`ConversationDiscoveryManager.scanThread()` prefers `readThreadForCapture` when the Runtime offers
it and passes the persisted inspected/pending user-item anchors. Other Runtime providers retain
their current `readThread` contract.

### Bounded trace recording

`TraceRecorder` tracks outbound request IDs. For inbound history responses belonging to
`thread/read` or `thread/turns/list`, it records a compact index containing thread/turn/item
identities and statuses rather than user text, assistant text, command output, or tool results.
The original RPC response object remains untouched for the caller.

This keeps historical item IDs available to `referenceForEpisode()` without writing the same full
conversation into every Runtime trace.

### Streaming trace reads

`evidenceForReference()`, `readRecent()`, and `referenceForEpisode()` iterate the JSONL file in
bounded chunks and parse one line at a time. Evidence collection only retains entries inside the
requested reference and continues to apply existing semantic ranking and total-character limits.
Recent-trace reads keep a fixed-size tail. Episode range discovery keeps only matching line
numbers.

Malformed or incomplete trailing lines are ignored only in recent diagnostic reads; immutable
evidence ranges remain fail-closed as today.

### Failure isolation

The scheduled scan catches errors around each source thread. It reports the error through the
existing error callback, leaves that thread's cursor unchanged for retry, increments a failed-thread
counter, and continues with remaining threads. A successfully completed slot is no longer marked
failed because one unrelated historical thread was unreadable.

## Testing

- A trace-recorder regression test forbids whole-file `readFileSync` access while verifying bounded
  evidence, recent-tail reads, and historical episode range lookup.
- A trace compaction test verifies large historical payload text is absent while item identities
  needed for references remain present.
- Codex request-construction tests cover pagination, anchor stopping, immediate compaction, bounded
  initial history, and invalid-lineage fallback.
- Automatic Capture tests verify persisted anchors are passed to the capture-specific history API
  and one failed thread does not block later threads.
- Run the focused suites, full desktop tests, DSH tests/build, renderer smoke, build tool, macOS app
  packaging/signing, and a real installed-App launch check.

