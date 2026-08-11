# Curated Case Sessions Plan

**Goal:** Turn a multi-message problem-solving episode into an asynchronously curated, reviewable,
structured evaluation case while the source conversation remains live.

## Task 1: Model and test episode evidence

- Build pure snapshot and normalization helpers.
- Parse shell invocations by CLI/subcommand and compact repeated tool activity.
- Define and validate the fixed Curator JSON contract and formatted compatibility answer.

## Task 2: Persist curation lifecycle

- Migrate the v1 store to add curation sessions and Curator profile settings.
- Preserve source question bytes, episode bounds, normalized evidence, trace/runtime metadata,
  conversations, revisions, and archive linkage.

## Task 3: Run Curator threads

- Create background read-only runtime threads from episode snapshots.
- Parse completed turns, isolate failures, support follow-up revision turns, and filter Curator
  threads out of the source task list.

## Task 4: Build the review UI

- Change per-message Save case into episode-aware Start curation.
- Add a right-side drafts queue and detail conversation with structured preview, follow-up input,
  and Done.

## Task 5: Verify and deliver

- Run unit/integration/security checks and strict OpenSpec validation.
- Exercise real Codex curation and concurrent source interaction.
- Rebuild, inspect, sign, launch, screenshot, commit, and sync the app.
