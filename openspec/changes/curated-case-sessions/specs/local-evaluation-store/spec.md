## MODIFIED Requirements

### Requirement: Local case persistence

The local store SHALL migrate existing datasets/cases in place and persist curation sessions,
editable dataset questions, immutable original questions in episode evidence, Curator
conversations/revisions, approved structured cases, and provenance with atomic owner-only writes.

#### Scenario: Existing v1 store opens
- **WHEN** the upgraded client loads a store created by the message-level MVP
- **THEN** all existing cases remain and new curation collections/settings are added without data
  loss

#### Scenario: Existing curation session has no dataset question
- **WHEN** the upgraded client loads a curation session created before dataset questions were stored
  separately
- **THEN** it initializes the missing dataset question from `episode.originalQuestion`
- **AND** it does not modify the frozen episode evidence
