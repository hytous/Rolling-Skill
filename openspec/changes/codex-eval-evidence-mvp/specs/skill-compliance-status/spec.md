## ADDED Requirements

### Requirement: Explicit evaluation state machine
The evaluator SHALL return exactly one of `PASSED`, `BEHAVIOR_FAILED`, `INVALID_TRACE`, `INFRA_RETRYING`, `RETRY_EXHAUSTED`, or `CANCELLED` as the top-level state for each attempt or finalized sample. `B_UNSCORED` SHALL appear only as the nested B-class result. The evaluator SHALL preserve attempt history and SHALL NOT replace an earlier state record when a retry occurs.

#### Scenario: All hard assertions pass
- **WHEN** evidence is rollout-complete and every A-class assertion passes
- **THEN** the finalized sample state is `PASSED`

#### Scenario: A hard assertion fails on valid evidence
- **WHEN** evidence is rollout-complete and at least one A-class assertion fails
- **THEN** the attempt state is `BEHAVIOR_FAILED` with the failed assertion identifiers

#### Scenario: Evidence is incomplete
- **WHEN** a required evidence invariant cannot be established
- **THEN** the attempt state is `INVALID_TRACE` and no behavior assertion is reported as failed

### Requirement: Observable Skill compliance only
The evaluator SHALL score only observable evidence, including Skill file reads, referenced file reads, tool invocation order, pagination, artifact creation, retry behavior, and final-output structure. It SHALL NOT request, infer, store, or score hidden chain-of-thought or describe provider sampling duration as reasoning time.

#### Scenario: The Skill was materialized but not read
- **WHEN** workspace metadata lists a Skill but the rollout contains no evidence that its `SKILL.md` was read
- **THEN** an assertion requiring a Skill read fails on otherwise valid evidence

#### Scenario: A required reference was read
- **WHEN** a tool or terminal event records a read of a reference required by the selected Skill
- **THEN** the evaluator cites the exact event and payload digest as support for that assertion

### Requirement: Provenance gate precedes behavior evaluation
The evaluator SHALL check runner-bound source provenance before trusting bundle validity, summary eligibility, or any evidence index. A `diagnostic_full_access` source SHALL return `INVALID_TRACE` with `trace.writer-not-isolated` at the evaluation boundary and SHALL produce no A-class assertion outcomes.

#### Scenario: Bundle content claims eligibility without writer isolation
- **WHEN** a structurally valid or forged bundle claims `hardScoreEligible=true` but runner-bound provenance is `diagnostic_full_access`
- **THEN** the evaluator rejects the sample before evaluating the rubric

### Requirement: A-class hard gate and B-class soft score
The evaluator SHALL treat Skill execution compliance as the A-class hard gate. Numerical or business-answer correctness SHALL remain B-class soft scoring for this milestone and SHALL be reported as `B_UNSCORED` when no trustworthy oracle is configured.

#### Scenario: The answer contains unverified numbers
- **WHEN** A-class assertions pass but no B-class oracle is configured
- **THEN** the result preserves the A-class pass and marks numerical correctness `B_UNSCORED`

#### Scenario: A-class behavior fails while numbers look plausible
- **WHEN** a required Skill step is observably skipped
- **THEN** the result is `BEHAVIOR_FAILED` regardless of the apparent numerical answer

### Requirement: Evidence-backed assertion format
Each assertion result SHALL include a stable assertion identifier, pass/fail/not-applicable outcome, a concise explanation, and zero or more evidence locators containing bundle identifier, sequence number or interval, event type, and payload digest/reference. A failed assertion without evidence locators SHALL be marked evaluator-invalid rather than behavior-failed.

#### Scenario: An ordering assertion fails
- **WHEN** required event A does not precede event B
- **THEN** the result identifies both observed sequence positions or identifies the bounded search window in which A was absent

### Requirement: Bounded automatic retry policy
The harness SHALL automatically retry only infrastructure failures, declared transient tool failures, or trace-completeness failures. It SHALL NOT automatically retry deterministic behavior assertion failures or user cancellation. Retry state SHALL progress through `INFRA_RETRYING` and end in `RETRY_EXHAUSTED` when the configured attempt limit is reached.

#### Scenario: The first trace is truncated
- **WHEN** an attempt has a retryable incomplete-trace reason and retry budget remains
- **THEN** the attempt is retained as `INFRA_RETRYING` and a new attempt is scheduled

#### Scenario: A deterministic Skill format assertion fails
- **WHEN** valid evidence proves the output format is wrong
- **THEN** the attempt is `BEHAVIOR_FAILED` and is not automatically retried

#### Scenario: The user cancels
- **WHEN** the run is cancelled by the user
- **THEN** the state is `CANCELLED` and no automatic retry is scheduled

### Requirement: Failures remain visible
The harness SHALL surface failed attempts, invalid traces, retry causes, and retry exhaustion to operators. It SHALL NOT label incomplete or failed evidence as trustworthy, and it SHALL NOT discard an attempt merely because a later retry succeeds.

#### Scenario: A retry succeeds
- **WHEN** a later attempt passes after an infrastructure retry
- **THEN** the final sample is passed while the earlier failed attempt and recovery relationship remain queryable
