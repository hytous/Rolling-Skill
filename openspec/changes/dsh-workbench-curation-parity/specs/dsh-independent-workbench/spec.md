## ADDED Requirements

### Requirement: Rolling Skill has an independent DSH entry
The DSH plugin SHALL register an additive `sidebar.footer.action` launcher that opens a near-full-screen Rolling Skill workbench. The `settings.section` contribution SHALL contain only low-frequency plugin configuration, legacy import, data-root, and diagnostic controls.

#### Scenario: Expanded and collapsed sidebar
- **WHEN** the DSH sidebar is expanded or collapsed
- **THEN** the Rolling Skill launcher remains accessible by localized label or accessible icon text

#### Scenario: Workbench opens and closes
- **WHEN** the user toggles the launcher
- **THEN** the overlay opens or closes without replacing, reloading, or losing state in the native conversation

### Requirement: Existing business surfaces remain available
The workbench SHALL provide Overview, Inbox and Drafts, Cases and Datasets, Rubrics, Managed Skills, Evaluations, Automatic Capture, Operator, and Optimization navigation with the behavior assigned to their ledger IDs.

#### Scenario: Existing DSH panel capability
- **WHEN** a capability already exists in the Settings-hosted DSH workbench
- **THEN** it is moved into the independent workbench without losing actions, states, error handling, or data

#### Scenario: Electron-only capability
- **WHEN** the parity ledger assigns an Electron business capability to the DSH workbench
- **THEN** the native React workbench supplies an equivalent workflow backed by Shared Core rather than embedding Electron Renderer code

### Requirement: Raw Case to Draft is a complete workflow
The workbench SHALL allow users to inspect, add, edit, delete, dispatch, and create Drafts from Raw Cases while preserving verbatim questions and trusted source evidence.

#### Scenario: Complete automatic candidate
- **WHEN** a Raw Case has complete DSH source boundaries and compatible Dataset prerequisites
- **THEN** the user can create a reviewable Draft directly

#### Scenario: Manual or incomplete candidate
- **WHEN** a Raw Case lacks a complete source Episode
- **THEN** the user can launch the verbatim question through a native DSH conversation and curate a completed response later

### Requirement: Curation review matches the shared lifecycle
The workbench SHALL list active and archived Curation Sessions, display frozen source and operation evidence, render the latest valid structured Draft and revisions, support Curator follow-up, model/effort changes, retry, save/archive, and discard, and preserve the last valid Draft across conversational or failed revisions.

#### Scenario: Valid Draft save
- **WHEN** a Session is `needs_review`, its source and Rubric snapshot remain current, and the Draft passes the shared contract
- **THEN** Save writes exactly one Case and archives the Session

#### Scenario: Failed revision
- **WHEN** a follow-up produces invalid structured output or the Runtime turn fails
- **THEN** the workbench keeps the last valid Draft reviewable and provides retry or discard

### Requirement: Dataset Rubric review matches the shared lifecycle
The workbench SHALL show the active Dataset Rubric and version history and support Rubric Agent create/revise, structured preview, follow-up, model/effort changes, retry, publish, discard, and post-publication Case calibration.

#### Scenario: Rubric publish
- **WHEN** a Rubric Draft passes the shared contract and its frozen Managed Skill evidence is still valid
- **THEN** publishing creates a new immutable version and makes it active without deleting history

#### Scenario: Stale evidence
- **WHEN** the selected Dataset Skill, Released Version, Runtime Installation, or active state drifts before publish
- **THEN** the operation is rejected with a recovery action instead of publishing stale evidence

### Requirement: Client requests remain narrow and cancellable
The workbench SHALL call strict JSON Host methods using stable IDs and idempotency keys. Closing the workbench or switching detail SHALL abort Client waiting and polling without implicitly cancelling background Agent Sessions or Jobs.

#### Scenario: Overlay closes during an active job
- **WHEN** the user closes the workbench while Curation, Rubric, Evaluation, Installation, Operator, or Optimization work continues
- **THEN** only Client subscriptions are released and the background lifecycle remains recoverable
