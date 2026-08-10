## ADDED Requirements

### Requirement: Manual local case curation

Every settled assistant message SHALL expose a Save case action that requires a local dataset and a goodcase or badcase classification. Automatic capture SHALL default to disabled.

#### Scenario: Operator saves a bad case
- **WHEN** the operator selects a dataset, chooses badcase, and confirms an assistant message
- **THEN** the local store atomically persists the question, answer, classification, thread/turn/item provenance, and trace reference

### Requirement: Backend-independent persistence

Dataset definitions, case rows, preferences, and trace references SHALL be stored under the desktop application's local Application Support directory and SHALL NOT require Postgres, Redis, or Agenta authentication.

#### Scenario: Application restarts
- **WHEN** previously curated local cases exist
- **THEN** reopening the app preserves and lists their datasets and counts without starting any server stack

