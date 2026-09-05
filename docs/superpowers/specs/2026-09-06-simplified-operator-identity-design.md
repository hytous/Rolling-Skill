# Simplified Operator Identity Design

## Problem

Rolling Skill currently creates two identities for one Operator session. The persisted Operator
session gets one UUID, while the capability grant gets a separately generated
`operator-<uuid>` identity. Control-plane tool calls expose the capability identity as
`context.sessionId`, but optimization requests are owned by the persisted Operator session ID.

The optimization Agent can read the run because that operation does not compare ownership, yet
`optimization.submit_candidate` and `optimization.submit_decision` fail when the gateway compares
the two different IDs. The extra `context.operatorSessionId` escape hatch hides this mismatch in
unit tests but is not populated by the real App path.

## Goals

- Give every Operator session exactly one stable identity.
- Keep capability grants responsible only for allowed actions, scope, expiry, and revocation.
- Keep Job and Step IDs as execution and audit identifiers only.
- Preserve optimization state checks, idempotency, audit, and final user approval.
- Make new and resumed Operator sessions follow the same identity path.
- Verify the real App control path, not a hand-built test context.

## Non-goals

- Removing capability action or scope enforcement.
- Weakening final publish/install approval.
- Changing optimization scoring, Dataset, Rubric, or candidate-editing behavior.
- Automatically accepting an Agent claim without a matching controller request.

## Design

### One session identity

`OperatorSessionManager.create()` allocates the Operator session ID first. That ID is supplied to
both the persisted session and the capability grant. Resuming a session issues a fresh capability
grant for the same persisted session ID.

There is no `authoritySessionId`. The capability's own grant ID remains unique and revocable, but
its `sessionId` always equals the real Operator session ID.

### Clear identifier responsibilities

- `operatorSessionId`: who owns and performs the Operator conversation.
- `capabilityId`: what that session is allowed to do and where.
- `jobId` / `stepId`: which execution and audit record is being handled.
- `optimizationRunId`: which optimization state machine is being advanced.

No identifier substitutes for another. The control plane derives `context.sessionId` from the
validated capability grant, so domain services receive the one real Operator session identity.

### Candidate and decision submission

Optimization submission reads only `context.sessionId`. The legacy
`context.operatorSessionId ?? context.sessionId` fallback is removed. The gateway compares this
single ID with the pending optimization request owner.

The submission still requires the matching capability action and scope before it reaches the
domain service. The optimization state machine still requires the correct phase and request,
deduplicates repeated submissions, records audit evidence, and requests final approval where
needed.

Trusted in-process human controls may issue a short-lived grant for the same real session. That
grant bypasses the Agent executor lease and reaches the human-control service path; an ordinary
foreign grant for the same session remains rejected. This lets approval and recovery controls
coexist with the one session identity without weakening the Agent's capability-bound lease.

### Compatibility

`OperatorJobStore.createSession()` accepts an optional explicit ID for the session manager while
retaining automatic UUID allocation for existing callers. Persisted sessions created by older App
versions retain their existing real session ID; resume simply binds the new capability to that ID.

No persisted schema migration is required because the removed authority identity was not stored as
the Operator session's identity.

## Failure and recovery behavior

If the App is restarted during an optimization, the existing recovery flow marks the run as
recoverable. Resuming recreates the Operator capability for the same session ID and reissues the
pending candidate request. The preserved optimization workspace remains untouched until the Agent
successfully submits its candidate through the controller.

An old capability token from the stopped process is not reused. Revocation and expiry continue to
work at grant level or session level.

## Testing

- Job-store coverage proves an explicitly allocated session ID is persisted and cannot collide.
- Operator-session tests prove the persisted session, capability grant, child environment,
  executor registration, and control-plane invocation all use the same ID.
- Optimization-control tests prove submission accepts the real control-plane `sessionId` and does
  not honor a spoofed `operatorSessionId` alias.
- A high-fidelity integration test exercises OperatorSessionManager through ControlPlane and
  JobEngine into optimization submission without fabricating the domain context.
- Focused tests, full desktop/core/DSH tests, generated bundle builds, renderer smoke, packaging,
  signing, installed-App launch, and recovery of the failed optimization run complete the
  verification.
