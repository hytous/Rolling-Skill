## Context

Rolling Skill currently has three useful but disconnected foundations: Curation Sessions can create and validate Case Drafts; Case calibration already supports sequential auto-save batches; and Raw Cases provide an append-only, deduplicated question inbox. Automatic Capture currently reacts to every completed turn and creates one whole-thread Draft, while Case and dataset deletion removes saved questions without a recovery choice.

The change spans Electron main, local state, Runtime adapters, Curator lifecycle, Raw Case events, preload/IPC, and the bilingual Renderer. It must preserve direct `main` development, current Runtime model catalogs, hidden internal task behavior, local-only data, and existing light/dark visual systems.

The detailed interaction contract is recorded in `docs/superpowers/specs/2026-08-26-case-refresh-scheduled-capture-recycle-design.md`.

## Goals / Non-Goals

**Goals:**

- Refresh stale Case answers with current Skill and tool behavior without rewriting the question.
- Reuse validated Draft and batch semantics so failures never overwrite an existing Case.
- Discover bounded problem episodes incrementally and preserve every candidate before optional automation.
- Make deletion recovery fail-safe and idempotent.
- Keep every new control bilingual and consistent with the current desktop UI.

**Non-Goals:**

- Generate new or paraphrased Case questions.
- Promote evaluation-run results or add Judge scores during refresh.
- Register an OS scheduler or wake a closed App.
- Perform protected external writes to refresh a sample Case.
- Add cloud sync, browser mockups, or a separate web interface.

## Decisions

### Decision: Refresh is a new Curation operation

`refresh` joins existing `capture` and `calibration` Session operations. `CaseRefreshManager` performs the replay and supplies a new Episode, while `CurationManager` retains responsibility for Draft validation, review, retries, Discard, and Done. Local Store archival handles `refresh` by atomically updating the target Case rather than inserting a new Case.

Direct replacement was rejected because it bypasses the existing fixed Curator contract. Evaluation promotion was rejected because scoring and multi-Runtime execution are unrelated to maintenance.

### Decision: Preserve a frozen target and append refresh history

Refresh start records the target Case `updatedAt`, dataset Skill identity, Rubric version, and baseline. Done compares these values again before mutation. On success the current replaceable fields move into `refreshHistory`, then the new Draft and evidence replace them while identity, type, question, and creation time remain unchanged.

This compare-and-set boundary prevents a long-running refresh from overwriting a newer manual or automated update.

### Decision: Reuse current Runtime execution with explicit refresh guidance

The refresh Agent uses the active Runtime, Task profile, current bound Skill, immutable original question, and a structured baseline. The baseline is guidance for intent and workflow, not an oracle. Runtime execution records the new response and trace into a synthetic or read-back Episode whose `originalQuestion` remains the saved question.

Refresh runs non-interactively with read-only-first guidance. A protected external mutation produces a reviewable stop instead of automatic approval.

### Decision: Batch orchestration remains Renderer-owned and sequential

The existing Case calibration batch proves the desired interaction: one active Session, automatic Done for a valid Draft, stop on manual takeover or error, and partial progress retained. A focused `CaseRefreshBatch` mirrors that state machine without coupling refresh eligibility to Rubric calibration status.

Sequential execution limits token spikes, prevents concurrent mutations of the same dataset, and keeps progress understandable.

### Decision: Automatic Capture becomes a scheduled discovery manager

The old turn-completion hook no longer creates Drafts. `ConversationDiscoveryManager` owns timer calculation, startup catch-up, thread pagination, hidden-thread filtering, model calls, cursor commits, and automatic routing.

Settings use `mode`, `cadence`, local time, weekday, analysis model/effort, and optional preferred dataset. A separate internal state stores last satisfied slot and per-Runtime, per-Thread cursors. This keeps operational cursors out of the user-editable profile.

### Decision: Use two model stages with a pending tail

Stage one receives only new user messages and stable IDs, returning problem boundaries and a pending tail. Stage two receives only a completed candidate Episode with compact activity and Skill/dataset identities, returning Skill, resolution state, Case type, confidence, and final boundary.

This avoids growing whole-thread prompts and avoids the boundary loss of a fixed token window. Stable prompts can still benefit from prefix caching without retaining unlimited model conversation history.

### Decision: Raw Case is the durable discovery boundary

Every candidate is added to Raw Case before a scan cursor advances. Automatic-source metadata keeps exact episode boundaries, outcome, confidence, and Skill identity. Duplicate questions merge episode observations. Scheduled mode stops at Raw Case; automatic mode continues to dataset routing, Draft creation, and Done.

This provides one visible recovery path for classifier uncertainty, Curator errors, dataset ambiguity, and App interruption.

### Decision: Fully automatic save is explicit and fail-closed

Automatic mode requires confidence `>= 0.8`, a resolved principal Skill, a preferred compatible dataset or exactly one unambiguous match, a published Rubric, and a valid Draft. Any missing gate leaves Raw Case and Draft state for review. Existing enabled Automatic Capture migrates to scheduled discovery, never automatic save.

### Decision: Deletion recovery is ordered coordination, not a cross-file transaction

`CaseRecycleService` performs store preflight, writes Raw Cases synchronously in chunks, accepts duplicates, aborts on any rejection, then calls the existing deletion mutation. If the final mutation fails, both original Cases and recovered Raw Cases exist; retry deduplication makes that safe.

Writing Raw Cases after deletion was rejected because a crash would lose the question. Modifying `evaluation-store.json` to contain Raw Cases was rejected because the append-only inbox intentionally has an independent trust and concurrency boundary.

## Risks / Trade-offs

- **[Runtime history omits tool items]** → Merge the existing local activity history and retain the full Trace reference; uncertain evidence cannot enter automatic save.
- **[Model boundary classification is imperfect]** → Preserve stable IDs, pending tails, confidence, and Raw Case review; require 0.8 plus all fixed gates for automation.
- **[Same question occurs in multiple episodes]** → Keep one Raw Case question and append distinct episode observations so provenance is not discarded.
- **[App is closed at schedule time]** → Perform one startup catch-up; explicitly avoid hidden OS services.
- **[Long batch consumes tokens]** → Execute one Case at a time and expose stop/error states; completed Case updates are durable.
- **[Refresh baseline tempts stale copying]** → Prompt labels baseline values as untrusted historical evidence and requires current queries or current Skill procedure.
- **[Recovery writes succeed but deletion fails]** → Keep both copies and rely on Raw Case deduplication for safe retry.
- **[Large local cursor map grows]** → Store only compact IDs/timestamps per Runtime and Thread and prune internal/unknown thread entries after a conservative retention period during a later maintenance pass, not in this change.

## Migration Plan

1. Add schema migration defaults for Case refresh history, explicit Automatic Capture profile fields, and internal scan state without rewriting Case content.
2. Keep existing IPC names where practical; add refresh, discovery status, and recovery options additively.
3. Convert `autoCapture: true` to scheduled daily 09:00 and `false` to off. Preserve model, effort, Case type, and dataset preference where they remain applicable.
4. Replace the old completion-event manager only after scheduled discovery tests cover disabled and migrated behavior.
5. Build and replace the repository-root macOS App and adjacent CLI after focused tests and one real App UI inspection.

Rollback uses Git revert and the previous repository-root App. New `refreshHistory` and scan-state fields are additive; older code ignores them. A reverted binary will see the legacy `autoCapture` boolean retained during migration until the new settings schema is archived in a later compatibility cleanup.

## Open Questions

None. The approved design fixes the automation threshold, schedule fallback, dataset routing, write-safety boundary, and App-closed behavior.
