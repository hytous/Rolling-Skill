## ADDED Requirements

### Requirement: Codex-only rollout tracing
The runner SHALL set `CODEX_ROLLOUT_TRACE_ROOT` only for Codex harness environments when evidence capture is enabled. The configured root SHALL be unique to the acquired environment, SHALL be readable through the sandbox filesystem abstraction, and SHALL NOT alter the public `/run` wire contract.

#### Scenario: Codex capture is enabled
- **WHEN** the runner acquires a Codex environment with evidence capture enabled
- **THEN** the Codex daemon receives a runner-owned rollout trace root

#### Scenario: A different harness is acquired
- **WHEN** the runner acquires a Pi or Claude environment
- **THEN** the runner does not add `CODEX_ROLLOUT_TRACE_ROOT` to that environment

### Requirement: Native bundle discovery and preservation
The collector SHALL discover bundles by their `manifest.json` below the configured trace root, SHALL treat the native files as the evidence source, and SHALL preserve every captured attempt without overwriting an earlier attempt. Raw payload content SHALL NOT be written to application logs or copied into OTLP attributes.

#### Scenario: Multiple attempts exist
- **WHEN** retry attempts emit more than one rollout bundle
- **THEN** the collector retains a separately identified record for every attempt

#### Scenario: Sensitive payloads are collected
- **WHEN** payload files contain prompts, tool arguments, terminal output, or credentials
- **THEN** logs and OTel attributes contain only bounded metadata, identifiers, digests, statuses, sizes, and artifact references

### Requirement: Runner-bound writer provenance
The collector SHALL attach provenance that cannot be self-asserted by native bundle content. Evidence from a runtime where evaluated tool subprocesses share the trace writer's filesystem authority SHALL be marked `diagnostic_full_access`, SHALL be reported as `DIAGNOSTIC_ONLY`, and SHALL NOT be eligible for A-class hard scoring. `runtime_isolated` provenance SHALL require an out-of-band writer or sink capability unavailable to evaluated tool subprocesses.

#### Scenario: Current full-access Codex runtime emits a valid rollout
- **WHEN** structural and lifecycle validation succeeds but the writer shares authority with evaluated tools
- **THEN** the trace remains available for diagnostics and latency analysis, `trace.writer-not-isolated` is reported, and no A-class assertion is evaluated

#### Scenario: A deployment supplies an isolated writer
- **WHEN** runner-bound provenance confirms that tool subprocesses cannot write or forge the evidence sink
- **THEN** the collector may mark the source `runtime_isolated` and continue to structural hard-score gates

### Requirement: Fail-closed structural validation
The validator SHALL reject a bundle as incomplete when the manifest is missing or unsupported, JSONL is malformed, event sequence numbers are not contiguous from one, an event identity conflicts with the manifest, a referenced payload path escapes the bundle, or a referenced payload is missing or malformed. An unknown event payload type SHALL be preserved opaquely for audit but SHALL make the evidence ineligible for hard scoring unless that type is explicitly supported by the evaluator version.

#### Scenario: A payload reference is missing
- **WHEN** an event references a payload file that cannot be read
- **THEN** validation reports an incomplete trace with a stable reason code and does not evaluate Skill behavior

#### Scenario: The event log is truncated
- **WHEN** the final JSONL line is malformed or the sequence has a gap
- **THEN** validation reports an incomplete trace with the offending sequence or line number

#### Scenario: A path escapes the bundle
- **WHEN** a payload reference is absolute or resolves outside the declared payload directory
- **THEN** validation rejects the bundle without reading the escaped path

### Requirement: Explicit terminal completeness
The collector SHALL distinguish a target root-thread turn terminal from a root rollout terminal. A turn-terminal snapshot MAY be emitted for immediate display, but evidence SHALL be eligible for hard Skill scoring only after the root rollout has a terminal event. Open runtime resources that Codex permits to outlive a turn, including yielded code cells and terminal sessions, SHALL be reported as quality warnings rather than silently force-closed or automatically treated as trace corruption.

#### Scenario: The turn ended but the root session remains warm
- **WHEN** the target root turn has `codex_turn_ended` but the root rollout has no terminal event
- **THEN** the collector marks the snapshot as `turn_complete` and not as hard-score eligible

#### Scenario: The root rollout ended cleanly
- **WHEN** the root rollout has a terminal event, no lifecycle object remains open, and writer provenance is `runtime_isolated`
- **THEN** the collector marks the evidence as `rollout_complete` and hard-score eligible

#### Scenario: A runtime resource remains open at root end
- **WHEN** the root rollout ends while a yielded code cell or terminal session remains open
- **THEN** the collector reports the open object and leaves behavior assertions to decide whether that lifecycle matters

### Requirement: Deterministic evidence summary
For the same manifest and ordered event/payload bytes, the collector SHALL emit the same versioned summary and SHA-256 digest. The bounded summary SHALL include bundle identity, sequence watermark, terminal completeness, validation reasons, lifecycle counts, artifact reference, capture timestamp boundaries, and content digests without embedding raw payloads.

#### Scenario: The same bundle is collected twice
- **WHEN** collection is repeated without changing the bundle
- **THEN** both summaries have the same schema version, evidence digest, counts, and completeness result

### Requirement: Best-effort tracing remains distinguishable from behavior
Because Codex rollout tracing is best-effort, absence or corruption of the native bundle SHALL be represented as trace/infrastructure failure and SHALL NOT be converted into a Skill behavior failure.

#### Scenario: Codex produces no bundle
- **WHEN** a Codex turn otherwise returns but no manifest is discoverable
- **THEN** the attempt is trace-invalid or retrying according to retry policy and no A-class assertion is evaluated

### Requirement: Collection status remains separate from evaluation outcome
The collector SHALL report exactly one of `INVALID_TRACE`, `CANCELLED`, `DIAGNOSTIC_ONLY`, `PENDING_TERMINAL`, or `READY_FOR_EVALUATION` as `collectionStatus`. It SHALL NOT emit `PASSED`, `BEHAVIOR_FAILED`, or `B_UNSCORED`, and SHALL NOT write an evaluator result before the observable Skill evaluator runs.

#### Scenario: A trusted turn is complete but its root is still warm
- **WHEN** structural validation succeeds at the target turn terminal but no root rollout terminal exists
- **THEN** the collector reports `PENDING_TERMINAL`

#### Scenario: Trusted rollout evidence is ready
- **WHEN** structural validation and root lifecycle validation succeed and writer provenance is `runtime_isolated`
- **THEN** the collector reports `READY_FOR_EVALUATION` without asserting an evaluation outcome
