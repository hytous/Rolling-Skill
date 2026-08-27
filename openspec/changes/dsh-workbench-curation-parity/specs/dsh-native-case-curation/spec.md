## ADDED Requirements

### Requirement: Finalized Assistant messages expose Case curation
The DSH plugin SHALL add a Case curation action through `conversation.chat.assistant-actions` for every finalized Assistant message and SHALL NOT replace the shipped conversation renderer.

#### Scenario: Finalized response
- **WHEN** DSH renders a finalized Assistant message
- **THEN** the message action row contains the Rolling Skill curation action addressed by that message's stable `messageId`

#### Scenario: In-progress response
- **WHEN** an Assistant response is still in progress
- **THEN** Rolling Skill does not offer a curation action for an unstable boundary

### Requirement: Source boundaries are resolved by the trusted Host
The plugin SHALL resolve eligible Human-message starts and the clicked Assistant-message end from the complete DSH Session event log. The Client MUST NOT submit message bodies or a client-assembled Episode.

#### Scenario: Earlier history is not loaded in the browser
- **WHEN** the selected start message exists in the Session log but is outside the currently loaded browser window
- **THEN** the Host still returns it as an eligible start candidate

#### Scenario: Forged or invalid boundary
- **WHEN** the Client supplies a start identity that is not a direct Human `user/message` before the clicked Assistant message
- **THEN** the Host rejects creation before a Curation Session is persisted

### Requirement: DSH execution evidence is frozen once
The Host SHALL use `sessionQuery.readSession` to freeze a continuous raw-event slice from the selected Human message through the clicked Assistant message's completed turn, including Session header, turn/step boundaries, Assistant messages, tool calls/results, usage, interruption state, source identities, capture boundary, timestamp, and digest.

#### Scenario: Successful capture
- **WHEN** both boundaries can be proven in the complete event log
- **THEN** the Host writes one immutable snapshot and derives both the Rolling Skill Episode and Curator evidence from that same snapshot

#### Scenario: Compacted or replaced source event
- **WHEN** a selected source event has replacement or shadow relationships
- **THEN** the snapshot records `sessionQuery.traceEvent` lineage or rejects capture if the current boundary cannot be proven

#### Scenario: Curation retry
- **WHEN** a Curator Session is retried or revised after the source conversation has changed
- **THEN** it reuses the original frozen evidence rather than rereading a different event slice

### Requirement: Quick curation enforces all creation gates
The native quick dialog SHALL collect start boundary, Dataset, Good/Bad type, and optional issue description, and SHALL validate Dataset Managed Skill identity, Published Rubric, trusted Runtime Installation, source completeness, and idempotency before creating a Draft.

#### Scenario: Missing prerequisite
- **WHEN** any required identity, Rubric, Installation, or source boundary is missing or ambiguous
- **THEN** the dialog displays an actionable blocker and no partial Session is created

#### Scenario: Successful creation
- **WHEN** all prerequisites pass and the user confirms
- **THEN** exactly one reviewable Draft is created and the dialog offers navigation to it

### Requirement: Source lifecycle markers survive navigation
The plugin SHALL mark every projected DSH flow row covered by an active Draft with theme-aware warning styling and every row covered by a saved Case with theme-aware success styling. It SHALL show a terminal status label and direct navigation without taking ownership of native message content.

#### Scenario: Reload and older-history load
- **WHEN** the user reloads, switches Sessions, or loads older messages
- **THEN** markers are reconstructed from trusted Session marker records and current projection keys

#### Scenario: Overlapping states
- **WHEN** a projected source row belongs to both a Draft and a saved Case
- **THEN** saved Case styling and navigation take precedence

#### Scenario: Lifecycle mutation
- **WHEN** a Draft is saved or discarded, or a Case is deleted
- **THEN** affected message actions, labels, and colors update without leaving stale markers
