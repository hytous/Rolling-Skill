## 1. Delete Recovery Foundation

- [x] 1.1 Add focused LocalEvaluationStore deletion preflight snapshots and tests for active blockers and immutable recovery inputs
- [x] 1.2 Implement CaseRecycleService with Raw Case mapping, duplicate acceptance, 200-entry chunking, and fail-before-delete ordering
- [x] 1.3 Wire Case and dataset delete recovery options through main IPC and preload with focused handler tests
- [x] 1.4 Add localized default-on recovery controls and counts to both delete dialogs and cover their renderer behavior

## 2. Case Refresh Domain

- [x] 2.1 Add Case refresh history migration, refresh Curation Session creation, frozen target checks, and atomic in-place archival tests
- [x] 2.2 Extend Curator prompt and lifecycle behavior for refresh baseline review, retries, Discard, Done, and valid-Draft preservation
- [x] 2.3 Implement CaseRefreshManager replay with current Skill, current Task profile, read-only safety guidance, evidence capture, and hidden task tracking
- [x] 2.4 Wire refresh manager lifecycle, main IPC, preload methods, notifications, and Runtime-change safeguards

## 3. Case Refresh UI and Batch

- [x] 3.1 Add a focused CaseRefreshBatch state machine and tests for Goodcase/all ordering, automatic Done, stop, failure, and stale Session rejection
- [x] 3.2 Add localized single refresh actions, refresh Draft baseline/status rendering, and manual takeover behavior to Case Drafts
- [x] 3.3 Add the localized batch scope dialog, progress/status panel, sequential orchestration, and stop/error behavior to the evaluation workbench

## 4. Scheduled Discovery Foundation

- [x] 4.1 Replace legacy Automatic Capture settings with explicit mode and schedule migration, plus private per-Runtime/thread scan-state APIs and tests
- [x] 4.2 Implement pure daily/weekly slot calculation, one-run startup catch-up, stable boundary and outcome prompt builders, strict JSON parsers, and confidence gates
- [x] 4.3 Extend RawCaseStore to merge duplicate automatic-capture episode observations without changing normal question deduplication

## 5. Scheduled Discovery Runtime

- [x] 5.1 Refactor AutomaticCaptureManager into scheduled ConversationDiscoveryManager orchestration with paginated thread listing, hidden-thread filtering, two-stage bounded analysis, pending tails, and fail-closed cursor commits
- [x] 5.2 Implement Raw Case draft creation from frozen automatic-capture boundaries and compatible dataset selection
- [x] 5.3 Implement fully automatic routing and save with the 0.8 confidence, Skill, dataset, Rubric, Draft, and post-save Raw Case gates
- [x] 5.4 Wire scheduler startup/shutdown, Runtime changes, status notifications, catch-up, and removal of completion-event whole-thread capture

## 6. Scheduled Discovery UI

- [x] 6.1 Replace the Automatic Capture settings UI with localized mode, cadence, weekday, time, model, effort, and preferred dataset controls
- [x] 6.2 Add localized topbar next-run/running/pending/error state and Settings last-success state
- [x] 6.3 Render automatic candidates in Raw Cases with source, Skill, outcome, confidence, and Create Case Draft action while preserving existing delete-recovery execution actions

## 7. Integration and Delivery

- [ ] 7.1 Run only the focused Node test files for deletion recovery, refresh, discovery, store migration, preload/IPC, and batch state; fix observed regressions
- [ ] 7.2 Validate the OpenSpec change and mark completed implementation tasks
- [ ] 7.3 Launch the local App once to inspect Chinese/English refresh, Automatic Capture, Raw Case, and delete dialogs without opening a browser
- [ ] 7.4 Rebuild and replace repository-root Rolling Skill.app and rolling-skill-tool, then record the final focused verification result
