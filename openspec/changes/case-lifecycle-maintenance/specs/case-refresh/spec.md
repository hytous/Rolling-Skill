## ADDED Requirements

### Requirement: Refresh preserves Case identity and question
The system SHALL refresh a saved Case in place, SHALL preserve its Case ID, dataset ID, Case type, creation timestamp, and question byte-for-byte, and SHALL replace its answer only after a new result passes the Curator contract.

#### Scenario: Successful single-Case refresh
- **WHEN** a user starts refresh for a saved Case and approves the resulting valid Draft with Done
- **THEN** the original Case retains its identity and question while its answer, structured contract, Skill evidence, execution evidence, source metadata, and update timestamp are replaced with the new result

#### Scenario: Refresh fails before a valid Draft
- **WHEN** replay execution or initial Curator generation fails
- **THEN** the saved Case remains unchanged and the refresh Session exposes a retryable failure

### Requirement: Refresh replays current behavior from the original Case
The system SHALL give the refresh Agent the immutable original question and the saved Case as intent and workflow guidance, SHALL require the current dataset-bound Skill and current tool contracts, and MUST NOT treat stale values in the saved answer as current facts.

#### Scenario: Source values changed
- **WHEN** the original workflow is still valid but its source data has changed
- **THEN** the refresh Agent re-runs the current queries and the replacement answer contains the newly observed result

#### Scenario: Tool contract changed
- **WHEN** the current Skill describes renamed tools, parameters, or invocation order
- **THEN** the refresh Agent follows the current Skill to satisfy the same question instead of copying the obsolete call sequence

### Requirement: Refresh is reviewable and reversible
The system SHALL represent a single refresh as a `refresh` Curation Session in Case Drafts and SHALL save the prior Case contract and evidence to refresh history before replacement.

#### Scenario: User reviews a refresh Draft
- **WHEN** a valid refresh Draft is produced
- **THEN** the user can inspect the saved baseline, ask follow-up questions, revise, Discard, or use Done through the existing Case Draft interface

#### Scenario: User discards refresh
- **WHEN** the user Discards a refresh Session
- **THEN** the replay and Curator tasks stop or archive and the target Case remains unchanged

#### Scenario: Refresh is saved
- **WHEN** the user uses Done on a current valid refresh Draft
- **THEN** the previous answer, contract, Skill reference, Rubric state, source, and evidence are appended to the target Case refresh history before replacement

### Requirement: Refresh rejects target drift
The system SHALL freeze the target Case update timestamp, dataset Skill identity, and active Rubric version at refresh start and SHALL reject Done if any frozen target changed.

#### Scenario: Case changes during refresh
- **WHEN** the target Case update timestamp no longer matches the frozen refresh target
- **THEN** Done fails without changing the Case and instructs the user to restart refresh

#### Scenario: Dataset contract changes during refresh
- **WHEN** the dataset Skill binding or active Rubric version changes before Done
- **THEN** Done fails without writing the stale refresh Draft

### Requirement: Refresh avoids unconfirmed external mutations
Refresh execution SHALL use a non-interactive, read-only-first policy and MUST NOT automatically approve external deletion, migration, ownership changes, purchases, approval flows, or other writes merely to update a Case.

#### Scenario: Refresh requires a write confirmation
- **WHEN** completing the old Case against current tools requires a protected external write
- **THEN** the refresh pauses or fails for review and does not automatically execute or save the protected mutation

### Requirement: Batch refresh supports requested scopes
The system SHALL support sequential batch refresh for Goodcases only or all Cases in the selected dataset, SHALL automatically save valid refresh Drafts, and SHALL expose progress and stop controls.

#### Scenario: Goodcase-only batch
- **WHEN** the user starts batch refresh with the Goodcase-only scope
- **THEN** only Cases whose type is `goodcase` are queued in their current dataset order

#### Scenario: All-Case batch
- **WHEN** the user starts batch refresh with the all scope
- **THEN** both Goodcases and Badcases are queued

#### Scenario: Batch completes a valid Case
- **WHEN** the current batch refresh produces a valid, non-drifted Draft
- **THEN** the system automatically saves that Case, advances the completed count, and begins the next queued Case

#### Scenario: Batch is stopped or paused
- **WHEN** the user stops the batch, manually takes over its Draft, or the current Case fails
- **THEN** already saved Cases remain updated, the current Draft remains reviewable when available, and no later queued Case starts

### Requirement: Refresh UI follows the existing application system
The system SHALL expose single and batch refresh in the evaluation workbench and SHALL render refresh status, actions, and errors through the existing bilingual translation and Codex-style component system.

#### Scenario: Language changes
- **WHEN** the user switches between Simplified Chinese and English
- **THEN** every refresh action, dialog, status, progress message, and error label uses the selected language

