## Why

The first native-window client still used Docker Compose and embedded the authenticated Agenta web application. That is not the local-first architecture users expect from Codex Desktop: opening the app should immediately show tasks and start a packaged local agent runtime without Docker or an application login page.

## What Changes

- Replace the Docker/HTTP bootstrap path with a packaged Codex `app-server` child runtime over JSONL stdio.
- Replace the embedded Agenta login/workbench page with a bundled Codex-style task, conversation, trace, and case-curation interface.
- Bundle the Apple Silicon Codex runtime in the `.app`, so a separate Codex CLI installation is not required.
- Remove all startup login checks and login UI. Missing provider credentials are surfaced only as a turn runtime error when a model request is attempted.
- Persist datasets, goodcase/badcase rows, preferences, and raw session event traces locally under Application Support.
- Keep automatic dataset capture disabled; case capture remains an explicit message-side action.

## Capabilities

### New Capabilities

- `local-codex-runtime`: Start and control a packaged Codex app-server directly from the desktop application.
- `local-evaluation-store`: Persist traces, datasets, and manually curated cases without an Agenta backend.

### Modified Capabilities

- `macos-native-desktop-client`: Open directly into a local task UI and remove Docker, HTTP, and application-login dependencies.

## Impact

- Desktop main process, preload API, renderer, tests, packaging metadata, and README are updated.
- `@openai/codex` becomes a pinned production dependency and its arm64 binary is copied into application resources.
- The existing Agenta Compose stack remains in the repository for server deployments but is no longer used by `Rolling Skill.app`.

