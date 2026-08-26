## ADDED Requirements

### Requirement: Delete dialogs offer Raw Case recovery
The system SHALL offer a default-on option to preserve questions in Raw Cases before deleting a Case or dataset and SHALL show the recoverable Case count for dataset deletion.

#### Scenario: Delete one Case
- **WHEN** the Case delete dialog opens for a saved Case
- **THEN** it displays a checked option to preserve that Case question in Raw Cases

#### Scenario: Delete a populated dataset
- **WHEN** the dataset delete dialog opens
- **THEN** it displays a checked recovery option and the number of Case questions that will be preserved

#### Scenario: Delete an empty dataset
- **WHEN** the selected dataset contains no Cases
- **THEN** the dialog shows zero recoverable questions and disables the recovery option

### Requirement: Recovery preserves the question and provenance only
The system SHALL preserve each Case question byte-for-byte with stable Skill identity, source dataset and Case IDs, Case type, recovery time, and a concise note, and MUST NOT copy the old answer, Curator conversation, scoring contract, or evaluation output into Raw Case.

#### Scenario: Recovered Case is inspected
- **WHEN** a Case question is recovered before deletion
- **THEN** the Raw Case contains the original question and deletion provenance but no saved reference answer

### Requirement: Recovery precedes destructive deletion
The system SHALL preflight deletion blockers, synchronously persist all requested Raw Cases, and only then delete the Case or dataset in the same main-process operation.

#### Scenario: Recovery succeeds
- **WHEN** every Case question is created or already exists as a duplicate Raw Case
- **THEN** the requested Case or dataset deletion proceeds using the existing deletion semantics

#### Scenario: Recovery fails
- **WHEN** any Raw Case is rejected or persistence throws
- **THEN** the Case or dataset remains intact and the dialog reports the failure

#### Scenario: Formal deletion fails after recovery
- **WHEN** Raw Cases were persisted but the final store deletion is rejected
- **THEN** the original Cases remain intact and a retry does not duplicate the recovered questions

### Requirement: Dataset recovery handles large and duplicate sets
The system SHALL recover datasets in chunks that respect the Raw Case batch limit and SHALL treat an existing identical pending Raw Case as safely preserved.

#### Scenario: Dataset has more than 200 Cases
- **WHEN** recovery is requested for a dataset larger than one Raw Case batch
- **THEN** all questions are processed in sequential chunks before deletion is committed

#### Scenario: Some questions already exist
- **WHEN** one or more dataset questions are Raw Case duplicates
- **THEN** duplicates count as preserved and do not block deletion

### Requirement: User may explicitly delete without recovery
The system SHALL retain the existing deletion behavior when the user clears the recovery option.

#### Scenario: Recovery option is unchecked
- **WHEN** the user confirms Case or dataset deletion with recovery disabled
- **THEN** no Raw Case is created and the existing preconditions and frozen evaluation snapshot behavior still apply

### Requirement: Recovery UI is bilingual and visually consistent
The system SHALL render recovery controls, counts, help, and errors through the existing Simplified Chinese and English translation pipeline and existing confirmation-dialog styles.

#### Scenario: Delete dialog is localized
- **WHEN** either supported language is active
- **THEN** every recovery label and error in the Case and dataset delete dialogs is localized without opening an external page

