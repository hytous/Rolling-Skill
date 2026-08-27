## ADDED Requirements

### Requirement: Every product capability has a durable ledger identity
The migration SHALL maintain a unique ID for every Electron user capability, trusted background behavior, DSH-only integration, and cross-cutting guarantee. Adding or discovering a capability MUST add a new ID rather than silently broadening an unrelated entry.

#### Scenario: Source surface changes
- **WHEN** Renderer anchors, Preload methods, Main/Core handlers, DSH tools, or test inventories change
- **THEN** a parity contract reports the added or removed names until the ledger mapping is updated

### Requirement: Every ledger item has one explicit owner surface
Each ledger ID SHALL be assigned to DSH native, Conversation extension, Workbench, Host/Worker, Settings, or an explicitly approved intentional difference.

#### Scenario: Host-native capability
- **WHEN** DSH already supplies a capability such as message rendering, task history, or Session trace UI
- **THEN** Rolling Skill does not duplicate it and instead runs a non-regression check after plugin installation

#### Scenario: Proposed difference
- **WHEN** an implementation cannot preserve an Electron behavior
- **THEN** the item remains incomplete until the difference, reason, migration impact, and user approval are recorded

### Requirement: Completion is evidence based
Every ledger item SHALL record implementation reference, automated test, and, for user-visible behavior, real-surface evidence. No skipped test, unmapped item, placeholder, or unapproved difference may be reported as migration complete.

#### Scenario: Final parity report
- **WHEN** DSH and Electron delivery verification finishes
- **THEN** the report accounts for all ledger IDs and shows zero unresolved or unapproved gaps

### Requirement: Parity checks cover lifecycle behavior, not only controls
The ledger SHALL cover persisted state, restart recovery, idempotency, stale-snapshot rejection, destructive recovery, permission/question flows, late-event isolation, pagination, localization, themes, accessibility, package contents, and data-root isolation in addition to visible buttons and pages.

#### Scenario: Visible control exists but lifecycle is incomplete
- **WHEN** a migrated button lacks its required recovery, concurrency, or persistence behavior
- **THEN** its ledger item remains incomplete even if the control is visible
