## 1. Bundle Contract and Validation

- [x] 1.1 Add deterministic native bundle fixtures for valid root-terminal, turn-terminal, malformed sequence, missing payload, path escape, and unsupported event cases
- [x] 1.2 Add failing unit tests for manifest, JSONL envelope, identity, sequence, payload-reference, byte-limit, and path-confinement validation
- [x] 1.3 Implement the bounded bundle reader, parser, stable reason codes, and validated event model
- [x] 1.4 Add deterministic canonical digest and bounded `codex-evidence/v1` summary tests and implementation

## 2. Lifecycle and Evaluation States

- [x] 2.1 Add failing tests for turn-terminal versus root-terminal completeness, open runtime warnings, and warm-turn sequence watermarks
- [x] 2.2 Implement lifecycle reduction, completeness levels, attempt cursors, and evidence locators
- [x] 2.3 Add failing tests for the explicit status state machine, A-class hard gate, B-class unscored result, and append-only retry history
- [x] 2.4 Implement observable Skill assertion results and bounded automatic retry classification

## 3. Runtime Latency Analysis

- [x] 3.1 Add failing tests for interval union, overlapping work, negative intervals, stable tie-breaking, and unattributed time
- [x] 3.2 Implement interval extraction, union and summed-work aggregation, causal critical path, and evidence-backed bottleneck ranking
- [x] 3.3 Add fixtures and tests for parallel tools, child agents, provider attempts, terminal operations, and trace finalization

## 4. Codex Runtime Integration

- [x] 4.1 Add failing environment tests for Codex-only local and Daytona trace-root injection before daemon environment freeze
- [x] 4.2 Implement an environment-scoped `CodexRolloutEvidencePort` with isolated ephemeral source root and injected immutable evidence sink
- [x] 4.3 Add failing keep-alive tests proving one root across warm turns, pause/resume attempt reuse, settle-once behavior, and collector failure isolation
- [x] 4.4 Integrate begin/settle around `session.prompt`, skip settle on pause, collect cancel/error paths, and preserve the agent result on evidence failure
- [x] 4.5 Add teardown ordering tests and implement final sweep after harness shutdown but before sandbox removal, followed by best-effort source cleanup

## 5. Safe Observability Projection

- [x] 5.1 Add failing OTel tests for bounded evidence attributes, deterministic digest/reference, and absence of raw prompt/response/tool payload data
- [x] 5.2 Add an OTel evidence projection API and attach turn-complete summaries before the existing root span finish boundary
- [x] 5.3 Verify one-shot and streaming runs produce the same evidence summary without changing the public `/run` contract

## 6. Verification and Rollout

- [x] 6.1 Add a disabled-by-default configuration path with documented limits, retention, privacy, and kill-switch behavior
- [x] 6.2 Add a gated live Codex integration test for bundle creation, turn terminal, graceful root terminal, and `trace-reduce` compatibility
- [x] 6.3 Run targeted unit tests and typecheck, then run the full runner suite and compare failures with the recorded 19-test baseline
- [x] 6.4 Run OpenSpec validation, request spec and code-quality reviews, address findings, and record the implementation in project memory
