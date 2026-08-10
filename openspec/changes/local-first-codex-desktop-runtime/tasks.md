## 1. Runtime protocol and local persistence

- [x] 1.1 Add failing tests for JSONL protocol framing, request correlation, packaged binary resolution, and local case persistence.
- [x] 1.2 Implement the Codex app-server client, runtime lifecycle, raw event recorder, and atomic dataset store.
- [x] 1.3 Pin and package the Darwin arm64 Codex runtime.

## 2. Local-first desktop client

- [x] 2.1 Replace Docker bootstrap and HTTP navigation with a packaged task/conversation renderer.
- [x] 2.2 Implement workspace-scoped thread list/read/start, turn streaming/interrupt, and visible runtime errors.
- [x] 2.3 Implement message-side manual goodcase/badcase curation and a local trace inspector.
- [x] 2.4 Remove login, Docker, Compose, and Agenta HTTP dependencies from the default application path and menus.

## 3. Delivery

- [x] 3.1 Update README and desktop documentation for the no-Docker, no-login architecture and local data paths.
- [x] 3.2 Run unit, integration, audit, lint, OpenSpec, package, signature, binary, launch, and screenshot verification.
- [x] 3.3 Rebuild the root Finder-double-clickable app and sync the source commit to the rolling-skill remote.
