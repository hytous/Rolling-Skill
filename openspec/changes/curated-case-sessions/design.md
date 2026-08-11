## Context

The current desktop client copies one user message and one assistant message directly into a case.
That boundary is too narrow for multi-message answers and too noisy for retry loops. The source
conversation must remain usable while case curation runs, and the original user wording must not be
normalized away.

## Goals / Non-Goals

**Goals**

- Snapshot a contiguous source episode without locking or mutating its conversation.
- Keep the exact source question as the dataset input.
- Deterministically summarize tool activity before asking a Curator agent to reason over it.
- Produce a fixed, agent-readable reference-answer and grading schema with hard requirements.
- Let users review and revise Curator output conversationally before committing it.
- Preserve raw snapshot/trace provenance separately from the compact approved case.

**Non-goals**

- Automatically capture every conversation.
- Treat Curator output as verified truth without human approval.
- Recover hidden chain-of-thought or infer a source model id that the runtime does not expose.
- Run curation across multiple runtime providers in parallel in this slice.

## Decisions

### Snapshot, not lock

Creating a curation session copies a bounded, immutable episode from the selected user message
through the selected assistant message. The source thread remains live and future messages do not
change the copy.

### Exact questions and structured answers

The dataset question always comes from the selected source `userMessage` byte-for-byte. The
Curator produces only the reference answer, required facts/steps/output format, hard requirements,
soft criteria, automatic failures, evidence links, and (for badcases) failure analysis.

### Deterministic tool compaction

Visible episode events are normalized before model curation. Shell commands are unwrapped and
grouped by CLI and subcommand; MCP calls use `server/tool`; repeated signatures retain counts,
status distributions, and first/last examples. The raw episode and append-only trace reference are
still retained for audit.

### Persistent Curator threads

Each draft owns a runtime thread. The initial turn creates a structured draft. Follow-up questions
and revision requests run in the same thread. Completed drafts remain `needs_review` until Done,
which materializes one dataset case and archives the curation session.

### Runtime/model provenance

This release pins the active `runtimeId` and records any exposed model provider. The current Codex
thread schema does not expose a reliable concrete model id, so the Curator profile reserves an
optional `modelId` rather than claiming source-model equality.

## Failure handling

- An invalid Curator JSON response leaves the session reviewable with an actionable parse error.
- Runtime failure marks only the curation session failed; source chat and other drafts remain usable.
- Done is rejected until a valid structured draft with at least one hard requirement exists.
- Existing v1 local data is migrated in place without rewriting existing cases.
