## Why

The existing `Rolling Skill.app` is only a shell launcher: it starts Docker Compose and then opens the system browser. Operators asked for a Codex Desktop-like local client with its own macOS window and in-app runtime controls.

## What Changes

- Replace the launcher bundle with a packaged Electron application that owns a native macOS window, Dock presence, and application menu.
- Start and health-check the local Agenta evaluation runtime inside the client, then load the workbench in that same window instead of opening a browser.
- Add an in-window startup/error experience plus native actions for retry, restart, stop, logs, and repository selection.
- Preserve the existing isolated Codex credential copy and durable local evidence boundary.
- Package a Finder-double-clickable Apple Silicon `.app` and document development, build, startup, lifecycle, and troubleshooting workflows.

## Capabilities

### New Capabilities

- `macos-native-desktop-client`: Run Rolling Skill as a native-window macOS client with managed local runtime lifecycle.

### Modified Capabilities

- `macos-local-launcher`: Superseded by the native desktop client; browser-launch behavior is removed.

## Impact

- New Electron source and unit tests under `desktop/rolling-skill/`.
- Root `Rolling Skill.app` becomes a packaged Electron application rather than a shell bundle.
- Root README documents the desktop workflow and the Docker/Codex prerequisites.
- Docker Compose remains the runtime boundary; no host Skills, plugins, apps, or full `~/.codex` directory are mounted.
