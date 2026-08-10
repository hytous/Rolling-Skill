## Context

Codex CLI 0.134+ exposes an experimental `app-server` with stdio, Unix socket, and WebSocket transports. Its v2 JSON-RPC protocol supports initialization, thread list/read/start, turn start/interrupt, item streaming, approvals, skills, model metadata, and raw notifications. This is the same class of local runtime boundary a desktop client needs; Docker is unnecessary.

## Goals / Non-Goals

**Goals**

- Open directly into a usable native task interface with no login screen.
- Start a bundled Codex app-server process over stdio and reconnect/restart it from the app.
- List local threads for the chosen workspace, read conversations, start turns, stream messages, and interrupt active turns.
- Record the raw bidirectional protocol stream as local JSONL evidence.
- Manually save assistant answers to a selected local dataset as goodcase or badcase.
- Work without Docker, Postgres, Redis, Traefik, or an Agenta HTTP service.

**Non-goals**

- Implement provider authentication in Rolling Skill. Codex owns provider credentials and reports request errors.
- Reproduce every Codex Desktop feature in the first local-first slice, such as terminal PTY rendering, rich approvals, or cloud task sync.
- Treat locally recorded protocol events as a trusted numeric correctness oracle.
- Remove server-oriented Agenta deployment code from the wider repository.

## Decisions

### Package the Codex arm64 runtime

The desktop package pins `@openai/codex` and copies the complete Darwin arm64 runtime into `Contents/Resources/codex-runtime/`. Development can fall back to an installed CLI, but the packaged `.app` does not depend on it.

### JSON-RPC over stdio

The main process spawns `codex app-server` with fixed argument arrays. It sends `initialize`, then `initialized`, and exposes a narrow IPC bridge for thread and turn operations. Renderer code never receives process or filesystem primitives.

### No login gate

Runtime initialization and local thread browsing do not require account authentication. The client does not call account login APIs, inspect `auth.json`, or render a login route. If an unauthenticated turn fails, its normal Codex error is rendered in that conversation.

### Local evaluation store

Application Support contains an atomic JSON store for dataset definitions and case rows, plus append-only JSONL files for raw protocol events. Automatic capture remains off. A message-side Save case dialog requires the operator to select a dataset and goodcase/badcase classification.

### Workspace-scoped thread listing

Thread queries pass the active workspace path as the `cwd` filter. This prevents unrelated historical sessions from other products or workspaces from appearing in Rolling Skill.

### Security

- Renderer sandboxing and context isolation remain enabled.
- The app loads only packaged renderer files; external HTTPS links are handed to macOS.
- App-server execution uses a packaged, fixed binary and argument array with `shell: false`.
- Dataset writes are atomic and trace files are append-only under Application Support.
- The default thread uses workspace-write sandboxing and never auto-escalates approval failures.

## Verification

- Unit tests cover protocol framing, request correlation, binary resolution, dataset atomicity, and case classification.
- An integration smoke initializes the bundled app-server and lists workspace-filtered threads without Docker or login.
- Static checks confirm the packaged client bootstrap contains no Docker, Compose, HTTP workbench, or account-login path.
- Package, plist, ad-hoc signature, runtime binary, native launch, and renderer screenshots are verified.
