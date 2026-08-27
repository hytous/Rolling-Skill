## ADDED Requirements

### Requirement: Dataset identity is pathless and managed
Every Dataset SHALL persist only a stable managed Repository/Skill identity for Skill ownership. Runtime IDs, providers, executable paths, installation paths, Version IDs, commits, and digests MUST NOT become Dataset identity fields.

#### Scenario: Dataset creation
- **WHEN** a Client creates a Dataset
- **THEN** it supplies only Dataset name, managed `repositoryId`, and managed `skillId`, and the Host resolves the remaining display metadata

#### Scenario: Runtime installation moves
- **WHEN** a Runtime executable or Skill installation path changes
- **THEN** Dataset ownership remains unchanged

### Requirement: Executions freeze exact operation evidence
Curation, Rubric, Evaluation, and Optimization operations SHALL resolve a Released Version and a verified Runtime-specific Installation on the trusted backend and freeze Version, Runtime, provider, commit, digest, path, marker, and verification evidence in the operation snapshot.

#### Scenario: Valid operation
- **WHEN** the selected Runtime has one verified installation of a Released Version belonging to the Dataset Skill
- **THEN** the operation starts with immutable evidence independent of later installation changes

#### Scenario: Missing, ambiguous, or drifted installation
- **WHEN** no unique verified Installation can be resolved or marker/digest evidence has drifted
- **THEN** the operation fails before starting and provides an install or inspect recovery action

### Requirement: Legacy path-bound Dataset records migrate fail-closed
Legacy Dataset Skill references SHALL migrate to managed identity only when existing installation evidence uniquely resolves the same Repository and Skill. Name-only or ambiguous matches MUST remain unresolved for explicit user repair.

#### Scenario: Unique trusted mapping
- **WHEN** one verified installation proves the legacy reference's Repository and Skill
- **THEN** migration removes the Dataset path binding and preserves the managed identity

#### Scenario: Ambiguous legacy mapping
- **WHEN** multiple candidates or no trusted candidate match
- **THEN** migration leaves the Dataset unresolved and does not guess by Skill name

### Requirement: Both distributions enforce the same domain contract
The DSH `main` implementation and Electron archive branch SHALL use compatible Store validation and operation-evidence rules even though their frontends and data roots remain separate.

#### Scenario: Cross-distribution contract tests
- **WHEN** Dataset and Installation fixtures are executed against each distribution's branch
- **THEN** path rejection, managed identity, evidence freezing, and drift rejection produce equivalent outcomes
