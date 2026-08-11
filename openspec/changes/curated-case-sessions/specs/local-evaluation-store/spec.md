## MODIFIED Requirements

### Requirement: Local case persistence

The local store SHALL migrate existing datasets/cases in place and persist curation sessions,
episode evidence, Curator conversations/revisions, approved structured cases, and provenance with
atomic owner-only writes.

#### Scenario: Existing v1 store opens
- **WHEN** the upgraded client loads a store created by the message-level MVP
- **THEN** all existing cases remain and new curation collections/settings are added without data
  loss
