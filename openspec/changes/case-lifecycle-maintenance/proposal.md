## Why

Saved Cases become stale when source data or Skill tool contracts change, while the current Automatic Capture captures whole conversations immediately instead of finding complete problem-solving episodes incrementally. Deleting Cases or datasets can also permanently discard valuable questions, so Rolling Skill needs a traceable maintenance lifecycle from discovery through refresh and recovery.

## What Changes

- Add single-Case refresh that re-executes the immutable original question with the current Skill and tools, produces a reviewable Curator Draft, and replaces the saved answer only after validation.
- Add sequential batch refresh for Goodcases only or all Cases, with automatic save of valid drafts, stop controls, drift protection, and per-Case history.
- Replace completion-event Automatic Capture with daily or weekly incremental conversation discovery that first classifies user-message boundaries and then inspects only selected local episodes for Skill and resolution state.
- Add explicit off, scheduled discovery, and fully automatic modes. Fully automatic mode may save a validated Case only after the user explicitly enables it; uncertain candidates remain in Raw Cases.
- Add a Raw Case action for discovered episodes to create a Case Draft from frozen thread boundaries.
- Add optional, default-on recovery of questions to Raw Cases before deleting a Case or dataset; abort deletion if recovery fails.
- Migrate existing settings and Cases without rewriting saved questions or answers.

## Capabilities

### New Capabilities

- `case-refresh`: Re-execute, review, batch-process, and atomically replace stale saved Case answers while preserving immutable questions and update history.
- `scheduled-conversation-capture`: Incrementally discover completed problems in new conversation content on a daily or weekly schedule and route candidates through Raw Case, Draft, or fully automatic Case persistence.
- `case-deletion-recovery`: Recover Case questions to Raw Case before destructive Case or dataset deletion with deduplication and fail-safe ordering.

### Modified Capabilities

None. This repository has no existing OpenSpec capability baselines; the change introduces the initial specifications for these behaviors.

## Impact

- Electron main process managers, lifecycle wiring, IPC handlers, and preload APIs.
- Local evaluation-store schema, Curation Session operations, Case archival behavior, Automatic Capture settings, and persisted scan cursors.
- Runtime evaluation execution used by Case refresh, with read-only refresh guidance and hidden internal task tracking.
- Raw Case event metadata, duplicate observation merging, and draft creation from frozen episode boundaries.
- Evaluation workbench, Case Drafts, Raw Cases, Settings, delete dialogs, bilingual strings, and existing Codex-style CSS.
- Focused Node tests for store, managers, IPC/preload, scheduling, batch state, renderer behavior, and migration.
