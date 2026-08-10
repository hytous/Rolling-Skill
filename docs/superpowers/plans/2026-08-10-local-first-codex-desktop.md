# Local-first Codex Desktop Runtime Plan

**Goal:** Replace the Docker-backed embedded web app with a packaged Codex app-server, local task UI, local traces, and local evaluation datasets.

**Architecture:** Electron spawns a bundled arm64 Codex binary over JSONL stdio. A narrow context-isolated IPC API exposes workspace-scoped thread and turn operations. The renderer is a bundled two-pane task client. Application Support stores atomic dataset JSON and append-only raw runtime traces.

## Task 1: Runtime and persistence tests

- Write failing tests for JSON line decoding, JSON-RPC request correlation, packaged runtime path selection, and goodcase/badcase persistence.
- Implement the minimum protocol client and local store to make them pass.

## Task 2: Package Codex

- Pin `@openai/codex` and copy the Darwin arm64 native executable into application resources.
- Add an integration smoke that initializes app-server and calls `thread/list` without login or Docker.

## Task 3: Replace the desktop surface

- Rewrite main/preload around app-server lifecycle and local store IPC.
- Build a Codex-style sidebar, conversation surface, composer, trace drawer, runtime status, and Save case dialog.
- Filter threads by selected workspace and keep automatic capture off.

## Task 4: Remove legacy dependencies

- Delete the desktop Docker controller and credential-copy code.
- Remove login, Compose, HTTP health, and embedded Agenta navigation from the application and docs.

## Task 5: Verify and deliver

- Run unit and app-server integration tests, audit, frontend lint, and OpenSpec strict validation.
- Rebuild, sign, launch, and screenshot the root `.app` on a Docker-independent path.
- Commit and push both configured rolling-skill branches, then leave the final app open for testing.
