## Why

An evaluation case represents one problem-solving episode, not one assistant message. A single
runtime turn can emit several assistant messages and many reasoning/tool events, including retries
and repetitive failure loops. Saving one raw message loses the useful path and makes goodcases and
badcases noisy or misleading.

## What Changes

- Replace immediate per-message case persistence with immutable episode snapshots and asynchronous
  curation sessions.
- Preserve the user's selected source question verbatim while a Curator agent extracts a concise,
  structured reference answer and grading rubric.
- Distinguish shell/CLI, MCP, and dynamic tool invocations and collapse repeated activity without
  deleting the append-only source evidence.
- Add a right-side Case drafts workspace where curation jobs run independently, can be questioned
  and revised as conversations, and are committed only when the user selects Done.
- Keep automatic capture disabled; every curation session starts from an explicit user action.

## Capabilities

### New Capabilities

- `curated-case-sessions`: Capture, curate, review, revise, and archive evaluation episodes.

### Modified Capabilities

- `local-evaluation-store`: Persist curation sessions, revisions, structured rubrics, and approved
  cases while migrating existing local data in place.

## Impact

- Local store schema, episode/trace provenance, runtime client lifecycle, IPC/preload APIs, source
  conversation controls, right-side desktop UI, tests, packaging, and documentation change.
