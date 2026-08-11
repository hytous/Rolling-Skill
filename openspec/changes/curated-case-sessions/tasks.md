## 1. Specification and evidence model

- [x] 1.1 Add failing tests for episode boundaries, exact question preservation, CLI/MCP compaction, and fixed Curator schema.
- [x] 1.2 Implement episode snapshots, tool signatures, Curator prompts, parsing, and formatted answers.
- [x] 1.3 Migrate the local store and persist queued/running/review/archived curation sessions.

## 2. Runtime curation workflow

- [x] 2.1 Add a tested Curation Manager for background threads, completion parsing, follow-ups, and failure isolation.
- [x] 2.2 Add curation IPC/preload APIs and hide Curator threads from the source task list.
- [x] 2.3 Record source and curator runtime/model/trace provenance without asserting an unavailable model id.

## 3. Desktop review workflow

- [x] 3.1 Replace immediate Save case with source episode selection and Start curation.
- [x] 3.2 Add the right-side Case drafts list, review conversation, revision composer, and Done archive action.
- [x] 3.3 Keep source chat usable while multiple drafts queue or run.

## 4. Delivery

- [x] 4.1 Run unit/integration tests, audit, strict OpenSpec validation, and UI interaction checks.
- [x] 4.2 Rebuild/sign/inspect the root app, sync both rolling-skill branches, and leave the app open.
