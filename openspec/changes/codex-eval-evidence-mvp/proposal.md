## Why

Agenta can already execute Codex through its sandbox-agent harness, but its normalized ACP event stream is not sufficient to prove that a billing Skill was actually loaded and followed. The evaluation platform needs a durable, machine-readable Codex evidence bundle so infrastructure failures, trace failures, and Skill-behavior failures are never conflated or hidden.

## What Changes

- Enable a per-run Codex rollout trace root without affecting non-Codex harnesses.
- Collect and validate the emitted rollout bundle after a terminal turn while preserving the original files and every attempt.
- Produce an explicit evidence summary with fail-closed trace completeness and machine states such as `PASSED`, `BEHAVIOR_FAILED`, `INVALID_TRACE`, `INFRA_RETRYING`, and `RETRY_EXHAUSTED`.
- Derive observable latency phases from native timestamps and intervals without describing provider sampling as hidden reasoning time.
- Keep Agenta's existing OTLP trace as a display projection; the native rollout bundle remains the evidence source.
- Add deterministic unit fixtures and a gated live Codex integration test path.

## Capabilities

### New Capabilities

- `codex-rollout-evidence`: Capture, preserve, validate, and summarize a Codex rollout trace bundle for one Agenta run attempt.
- `skill-compliance-status`: Evaluate deterministic observable evidence and return explicit trace/infrastructure/behavior states without using numerical answer correctness as a hard gate.
- `runtime-latency-breakdown`: Attribute run time to observable runtime, provider, tool, child-agent, and trace-finalization intervals using critical-path-aware calculations.

### Modified Capabilities

None.

## Impact

- Primary code: `services/runner/src/engines/sandbox_agent/`, runner tracing utilities, and runner unit tests.
- Configuration: a runner-owned trace storage root and bounded retention/cleanup behavior.
- Observability: new derived span attributes and artifact references; no raw rollout payloads are inserted into OTLP spans.
- Compatibility: no breaking change to the public `/run` wire contract in the MVP unless repository inspection proves that an artifact reference cannot be represented through existing trace metadata.
- Security: trace content is treated as sensitive; logs contain only identifiers, status codes, sizes, and digests.
