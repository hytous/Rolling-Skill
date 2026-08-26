## ADDED Requirements

### Requirement: Scheduled capture has explicit modes and cadence
The system SHALL support Automatic Capture modes `off`, `scheduled`, and `automatic`, with daily or weekly local-time schedules, model and effort selection from the active Runtime catalog, and an optional preferred dataset.

#### Scenario: Default and migrated settings
- **WHEN** settings are created or an old disabled Automatic Capture setting is migrated
- **THEN** the mode is `off` and no scheduled scan runs

#### Scenario: Existing enabled setting is migrated
- **WHEN** an old `autoCapture: true` setting is migrated
- **THEN** the mode becomes `scheduled` at local time 09:00 daily and cannot automatically save a Case

#### Scenario: Weekly schedule
- **WHEN** a user selects weekly cadence, weekday, and local time
- **THEN** the next run is calculated for that local weekday and time

### Requirement: Missed schedules catch up without an external launcher
The system SHALL run at the configured slot while the App process is active and SHALL run at most one catch-up scan after startup when one or more slots were missed.

#### Scenario: App remains active
- **WHEN** the configured schedule time arrives while Rolling Skill is running
- **THEN** exactly one scan for that schedule slot begins

#### Scenario: App was closed for multiple slots
- **WHEN** Rolling Skill next starts after missing multiple configured slots
- **THEN** it performs one catch-up scan and records the latest satisfied slot without launching a browser or registering an operating-system background agent

### Requirement: Conversation scanning is incremental and Runtime-scoped
The system SHALL persist scan cursors per Runtime and Thread, SHALL inspect only user messages after each cursor plus any pending problem tail, and SHALL exclude internal Curator, Rubric, refresh, and other hidden task threads.

#### Scenario: Two Codex Runtime versions are scanned
- **WHEN** the active Runtime changes between two distinct Runtime IDs
- **THEN** each Runtime uses its own thread cursors and neither advances the other's scan state

#### Scenario: No new user message exists
- **WHEN** a thread has no user message after its saved cursor and no pending tail
- **THEN** the scanner sends no classification request for that thread

#### Scenario: Internal thread is listed
- **WHEN** the Runtime thread list includes a Curator, Rubric, refresh, or other hidden thread
- **THEN** the scanner excludes it from classification and Case discovery

### Requirement: Discovery uses two bounded analysis stages
The system SHALL first identify problem boundaries using only incremental user messages and stable IDs, then SHALL inspect only each completed candidate's local episode and compact activity to determine its principal Skill and outcome.

#### Scenario: Problem continues across scheduled runs
- **WHEN** the last detected problem has not ended at the scan boundary
- **THEN** its start user Item ID is saved as a pending tail and included with the next incremental user-message batch

#### Scenario: User begins another problem
- **WHEN** the boundary model detects a clear intent transition
- **THEN** the prior problem is closed at the preceding user range and the new message starts a separate candidate

#### Scenario: Candidate episode is classified
- **WHEN** a complete problem range is identified
- **THEN** only that range's messages and compact Skill, tool, command, and dataset-binding context are sent for Skill and resolution classification

### Requirement: Every discovered candidate is durably retained
The system SHALL persist each classified candidate to Raw Case before any Draft or Case automation and SHALL retain source Runtime, thread boundaries, detected Skill, outcome, recommended Case type, confidence, and inspection time.

#### Scenario: New candidate is found
- **WHEN** the second stage returns a valid candidate
- **THEN** a pending Raw Case exists before the scan cursor moves past the candidate

#### Scenario: Same Skill and question already exist
- **WHEN** Raw Case deduplication finds an existing pending question
- **THEN** the new episode locator is retained as an associated observation without creating a duplicate question card

#### Scenario: Candidate persistence fails
- **WHEN** Raw Case storage rejects or fails to persist a candidate
- **THEN** the corresponding scan cursor does not advance and the candidate is retried on a later scan

### Requirement: Scheduled mode leaves user-controlled candidates
In `scheduled` mode, the system SHALL leave discovered candidates in Raw Cases and SHALL allow a source-complete candidate to create a Case Draft from its frozen episode boundaries.

#### Scenario: User creates a Draft from an automatic candidate
- **WHEN** the user selects a compatible dataset and creates a Case Draft from a Raw Case with complete episode boundaries
- **THEN** the original episode range is sent to Curator and the Raw Case is marked handled only after Draft creation succeeds

### Requirement: Automatic mode saves only high-confidence valid candidates
In `automatic` mode, the system SHALL require confidence of at least 0.8, a resolved Skill identity, an unambiguous compatible dataset, a published Rubric, and a valid Curator Draft before automatically saving a Case.

#### Scenario: Preferred dataset is compatible
- **WHEN** the preferred dataset Skill matches a high-confidence candidate
- **THEN** the system creates a Draft in that dataset and automatically uses Done after validation

#### Scenario: One compatible dataset exists
- **WHEN** no preferred dataset applies and exactly one dataset matches the detected Skill
- **THEN** that dataset is selected for the automatic Draft

#### Scenario: Automatic route is unsafe or ambiguous
- **WHEN** confidence is below 0.8, outcome is uncertain, Skill evidence is missing, no compatible dataset exists, multiple datasets remain ambiguous, the Rubric is unavailable, or Curator fails
- **THEN** no Case is automatically saved and the Raw Case and any created Draft remain available for review

#### Scenario: Automatic save succeeds
- **WHEN** the compatible Draft passes validation and Done commits the Case
- **THEN** the Raw Case is marked handled only after the Case exists

### Requirement: Scheduled capture is idempotent and observable
The system SHALL deduplicate schedule slots, thread ranges, and Raw Case questions, SHALL bound each model request without splitting a detected problem range, and SHALL display its next run, running state, pending count, last success, or recent error in the existing bilingual UI.

#### Scenario: Same slot is triggered twice
- **WHEN** timer and startup catch-up attempt to run the same recorded schedule slot
- **THEN** only one scan operation runs

#### Scenario: UI language changes
- **WHEN** the user changes the configured language
- **THEN** Automatic Capture settings and topbar status use the selected language and existing visual system

