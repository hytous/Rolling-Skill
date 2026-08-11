## ADDED Requirements

### Requirement: Episode-based capture

The desktop client SHALL create a bounded snapshot from a selected source user message through a
selected assistant message and SHALL NOT lock or mutate the source conversation.

#### Scenario: Source conversation continues
- **WHEN** a user starts curation and then continues the original task
- **THEN** the Curator receives the frozen episode while the original task accepts new turns

### Requirement: Editable dataset question with immutable source evidence

The system SHALL initialize the dataset question from the selected user message byte-for-byte,
allow the user to edit that evaluation input before starting curation, and preserve the original
source wording separately in immutable evidence. The Curator SHALL NOT normalize or rewrite the
selected dataset question.

#### Scenario: Natural language is irregular
- **WHEN** the source question contains colloquial wording, typos, or unusual structure
- **AND** the user does not edit the dataset question
- **THEN** the approved dataset input contains that same wording

#### Scenario: User edits the evaluation input
- **WHEN** the user edits the dataset question before starting curation
- **THEN** the Curator and approved case use the edited text verbatim
- **AND** the frozen episode retains the original source question unchanged

### Requirement: Tool-aware evidence compaction

The system SHALL distinguish shell CLI/subcommand signatures and provider tool identities, collapse
repetitive activity, and retain raw evidence provenance.

#### Scenario: Badcase repeats one command
- **WHEN** a failed episode invokes the same CLI operation repeatedly
- **THEN** the Curator input contains its signature, count, status distribution, and representative
  examples instead of duplicating every event

### Requirement: Fixed evaluation contract

Every approved case SHALL contain a structured reference answer and grading contract with required
facts, required steps, required output format, hard requirements, evidence basis, soft criteria,
and automatic-failure rules.

#### Scenario: Agent evaluator scores a response
- **WHEN** an evaluation agent reads an approved case
- **THEN** it can apply explicit hard pass/fail requirements before optional soft scoring

### Requirement: Conversational human review

Each curation draft SHALL appear as an independent persistent Curator conversation and SHALL accept
follow-up questions and revision requests without blocking source chat or other captures.

#### Scenario: Curator summary is wrong
- **WHEN** the user asks the Curator to correct its analysis
- **THEN** the same curation thread produces a new revision and the previous revision remains
  attributable

### Requirement: Done commits one approved revision

The system SHALL write a dataset case only after the user selects Done on a valid draft and SHALL
archive the corresponding curation session.

#### Scenario: Curation is still running
- **WHEN** the user has not reviewed a valid completed draft
- **THEN** no dataset case is created
