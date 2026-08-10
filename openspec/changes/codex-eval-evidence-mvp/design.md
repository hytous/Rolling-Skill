## Context

Agenta's runner already executes Codex through the sandbox-agent ACP adapter and emits a normalized OTel span tree. That stream is useful for display, but it cannot prove that Codex read a particular `SKILL.md`, followed a required reference, exhausted pagination, or completed child-agent work. Codex now has an opt-in native rollout trace bundle containing an append-only event log and referenced raw payloads. The bundle is local, best-effort, and sensitive.

The MVP is the evidence layer for a broader Skill evaluation platform. It must make A-class observable execution compliance trustworthy before the platform adds dataset curation UI. Numerical answer correctness is deliberately a B-class soft score because reliable business-data oracles are not yet available.

Important runner constraints are:

- local and Daytona sandboxes must be accessed through the same filesystem abstraction;
- a session-scoped `SessionEnvironment` can serve multiple turns;
- Codex creates one native bundle per root thread under `CODEX_ROLLOUT_TRACE_ROOT`, and spawned children share that bundle;
- a root Codex session can remain open after a turn finishes, so `codex_turn_ended` and `rollout_ended` are different completeness levels;
- `runTurn` currently ends and flushes OTel before environment teardown closes the native root thread;
- public `/run` results are mirrored in the Python SDK, so the MVP avoids a wire change;
- existing full runner tests have 19 unrelated baseline failures; new behavior needs isolated deterministic coverage.

## Goals / Non-Goals

**Goals:**

- capture native Codex rollout evidence without affecting other harnesses;
- validate bundle structure and lifecycle completeness fail-closed;
- derive bounded, deterministic evidence and latency summaries;
- expose explicit trace, infrastructure, behavior, cancellation, and unscored states;
- preserve all attempts and make automatic retries auditable;
- project only safe summary metadata into Agenta OTel;
- provide unit fixtures and a gated live Codex validation path.

**Non-Goals:**

- scoring hidden chain-of-thought or reconstructing private model reasoning;
- making numerical answer correctness a hard gate in this milestone;
- embedding raw prompts, tool input/output, or terminal logs in OTel;
- changing the public `/run` wire contract;
- building the dataset curation button and review UI in this change;
- making the native Codex schema an Agenta-owned compatibility contract;
- fixing unrelated runner baseline test failures.

## Decisions

### 1. Native rollout bundle is the evidence source; OTel is a projection

The runner will parse and validate `manifest.json`, `trace.jsonl`, and referenced `payloads/*.json`. The original bundle remains the authoritative evidence. OTel receives a version, state, counts, digest, and an opaque artifact reference only.

This is preferred to extending `AgentEvent` because normalized ACP events omit several native boundaries and have no complete causal graph or trustworthy timestamps. It is preferred to storing raw evidence on the root span because trace attributes are bounded, replicated, and often visible to a broader audience than the artifact store.

### 2. Capture is opt-in, Codex-only, and injected before daemon startup

A configuration resolver will enable evidence capture and derive a trace root inside the sandbox-visible per-environment runtime area. `configureCodexHome` and `configureDaytonaCodexEnv` are the existing safe seams for local and Daytona Codex environment variables. Non-Codex plans remain byte-identical.

The trace root is session-scoped because the daemon environment is immutable after startup and a warm Codex session can serve multiple turns. The collector records all bundle baselines at each turn start, verifies their append-only prefixes, and selects the unique bundle containing a new root turn. An invalid baseline or multiple candidates fails closed. At teardown only the final warm attempt is upgraded; earlier attempts remain turn-complete so later turns cannot enter their evidence window.

An operator kill switch remains available. Capture is not silently treated as complete merely because the environment variable was set; Codex tracing is best-effort.

### 3. Two completeness levels prevent premature hard scoring

The collector produces:

- `turn_complete`: the target root-thread turn has a terminal event and structural validation succeeds at the observed watermark;
- `rollout_complete`: the root rollout has a terminal event and structural validation succeeds.

The immediate turn summary can be projected for inspection and speed analysis. A-class hard scoring requires `rollout_complete`. If environment teardown has not yet closed the root thread, the sample remains non-final rather than becoming a behavior failure.

This preserves the approved strict root-terminal rule while supporting warm sessions. A later artifact finalizer can upgrade the final attempt from turn-complete to rollout-complete; all state transitions are append-only.

### 4. Parser and evaluator are pure modules with injected I/O

The implementation is separated into:

1. a sandbox bundle reader that discovers and reads bounded bytes;
2. a pure parser/validator that consumes manifest text, JSONL text, and a payload resolver;
3. a lifecycle reducer that matches start/terminal objects and produces intervals;
4. a Skill assertion evaluator that consumes only validated evidence;
5. a safe OTel projector.

Filesystem and clock access are injected. This enables deterministic tests without launching Codex or depending on host paths. The live integration test is gated by an explicit environment flag and verifies the installed Codex binary's actual schema.

### 5. Writer provenance precedes structural validation

The current Agenta Codex container path uses `agent-full-access`, while upstream rollout tracing writes ordinary files and passes the trace-root environment to tool subprocesses. The native bundle therefore has no producer-authenticity boundary from the evaluated agent. Current captures carry runner-bound `diagnostic_full_access` provenance, receive the evidence-collection status `DIAGNOSTIC_ONLY`, and are forced hard-score-ineligible even when structurally rollout-complete.

The evaluator checks provenance before structural validity or behavior assertions. `runtime_isolated` may be asserted only by a deployment that supplies an out-of-band writer/sink capability unavailable to evaluated tool subprocesses. Random paths, chmod, hidden environment variables, post-copy hashes, and keys inherited in the process environment do not establish this property.

### 6. Validation is fail-closed and path-safe

Before semantic evaluation, the validator checks supported manifest and event envelope versions, contiguous sequence numbers, rollout identity, safe relative payload paths, file existence, and JSON parseability. It recursively finds payload-reference-shaped objects in event payloads so forward-compatible event types cannot bypass payload existence checks.

Unknown event payload types are retained as opaque events for audit but make the attempt hard-score ineligible until the evaluator explicitly supports them. Unknown manifest/envelope versions are invalid because their invariants cannot be assumed.

Every error uses a stable reason code plus bounded context such as line or sequence. Raw content never enters the error message.

### 7. Evidence summaries are canonical and content-addressed

The summary schema is `codex-evidence/v1`. Canonical JSON serialization sorts object keys and stable collections before SHA-256 hashing. The digest covers the manifest and ordered raw event/payload digests, not local absolute paths or collection time. Re-reading unchanged evidence therefore produces the same digest across runner hosts.

The summary contains only identities, counts, interval metadata, assertion locators, validation reasons, byte sizes, and artifact references. Raw payloads remain in protected artifact storage.

### 8. Explicit evaluator states and retry classification

Evidence collection precedes behavior assertions. Collection and evaluation use separate state fields:

```text
collection: missing/corrupt      -> INVALID_TRACE
collection: warm root            -> PENDING_TERMINAL
collection: trusted complete     -> READY_FOR_EVALUATION
collection: full-access trace    -> DIAGNOSTIC_ONLY -> no A assertions
evaluation: trusted evidence     -> PASSED | BEHAVIOR_FAILED
evaluation: user cancellation    -> CANCELLED
evaluation: retry exhausted      -> RETRY_EXHAUSTED
evaluation: no numerical oracle  -> A outcome plus nested B_UNSCORED
```

Only infrastructure, declared transient tool, and trace-completeness errors are auto-retryable. Deterministic Skill assertion failures and cancellation are not. Attempt records are append-only, including recovered failures.

### 9. Latency uses interval unions and causal critical paths

Raw wall timestamps define observable intervals for inference, tools, code cells, terminal operations, child threads, and rollout finalization. Runner marks add acquisition/setup where available.

For each category the analyzer reports both:

- interval-union wall time, which avoids double counting parallel operations;
- summed work time, which explains resource effort but can exceed wall time.

Critical-path attribution follows explicit parent/causal IDs and temporal containment. Ties use sequence and identifier ordering. Residual wall time is named unattributed runtime overhead. Provider intervals are called provider sampling/wait, never hidden reasoning time.

### 10. OTel gets a bounded projection before the existing finish boundary

The immediate turn-complete summary is attached to the sandbox-agent root span before `finish()` under a small `ag.meta.eval.*` namespace. The projection includes schema version, completeness level, evidence collection status, reason codes, counts, digest, and opaque artifact reference. It does not write the evaluator-owned `ag.meta.eval.status` field. It excludes raw payloads and unbounded ID lists.

The native artifact finalizer runs at root-session teardown. Because the current tracer flush boundary precedes teardown, final rollout-complete evidence remains authoritative in the artifact record for the MVP; moving final status projection onto the same already-ended root span would require a broader tracer lifecycle refactor. A later change can add a dedicated artifact persistence API or defer root-span flush.

## Risks / Trade-offs

- **[Risk] Codex tracing is best-effort and may emit nothing** → Treat missing evidence as `INVALID_TRACE`, never as behavior failure, and use bounded infra retries.
- **[Risk] Full-access tool subprocesses can modify native trace files** → Label current captures `DIAGNOSTIC_ONLY`, block A-class evaluation, and require a separately isolated writer before accepting hard-score provenance.
- **[Risk] Warm sessions are turn-complete before root-terminal** → Keep hard scoring pending until teardown finalization and expose the completeness level explicitly.
- **[Risk] Native schema evolves** → Gate on manifest/envelope versions, preserve unknown payload types opaquely, and run a gated live compatibility test.
- **[Risk] Payloads can contain secrets and large terminal output** → Enforce byte/file limits, path confinement, restrictive artifact permissions, digest-only logs, and no raw OTel attributes.
- **[Risk] Bundle reads race with appends** → Snapshot a sequence watermark, require newline-complete JSONL, re-read boundedly when finalizing, and never call a partial read complete.
- **[Risk] Interval categories overlap** → Report union, summed work, and critical-path contribution separately; do not present categories as additive percentages.
- **[Risk] Wall clocks can be non-monotonic across processes** → Reject negative pairs, use runner monotonic marks where available, and label unavailable metrics rather than normalizing silently.
- **[Risk] Full test suite already fails** → Pin new targeted tests and report the unchanged 19-test baseline separately.

## Migration Plan

1. Land the pure bundle schema, validation, lifecycle, status, and latency modules with fixtures.
2. Add Codex-only environment injection behind the evidence-capture setting.
3. Add turn cursor collection and bounded OTel projection.
4. Add root-session teardown finalization and protected artifact metadata.
5. Enable the gated live Codex integration test in a controlled environment.
6. Roll out disabled by default, then enable for evaluation workers only.

Rollback is configuration-first: disable evidence capture to restore the existing runner path. The new modules and attributes are additive and do not change `/run` response parsing.

## Open Questions

- Which durable artifact service should own raw bundle retention once the MVP moves beyond runner-local/evaluation-worker storage?
- Should final rollout status later be added through a dedicated evidence span or by moving the existing OTel flush boundary after environment teardown?
- What byte, file-count, and retention defaults are appropriate for production evaluation workloads?
- Which exact billing Skill assertions and output schemas form the first versioned A-class rubric?
