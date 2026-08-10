## Context

Rolling Skill already has a Docker Compose evaluation stack and web workbench. The old `.app` resolves the checkout, copies `~/.codex/auth.json` into an isolated directory, starts the stack, waits for HTTP readiness, and opens Safari/Chrome. The new client should retain that proven runtime path while replacing the launcher UX with an actual desktop application.

## Goals / Non-Goals

**Goals**

- A real foreground macOS application with a native window, Dock icon, application menu, and no automatic browser launch.
- Visible startup progress and actionable errors rather than background notifications only.
- Runtime start/restart/stop/status/log controls from inside the application.
- Safe navigation and credential handling.
- A reproducible, verifiable `.app` package.

**Non-goals**

- Reimplementing the Agenta workbench as an offline renderer.
- Bundling Docker or the entire Agenta source tree inside the application.
- Automatic dataset capture; explicit save remains the default.
- Treating diagnostic Codex evidence as a correctness oracle.

## Decisions

### Electron shell around the existing local workbench

Electron is used because it can reuse the current web workbench immediately while providing a native macOS lifecycle. The main window initially displays a packaged startup renderer. Once `http://localhost/` is healthy, the same `BrowserWindow` navigates to the local workbench. Only external HTTPS links are handed to the system browser.

### Main-process runtime controller

The Electron main process owns repository discovery, Docker readiness, isolated credential preparation, Compose execution, HTTP health checks, log capture, and lifecycle commands. Renderer code receives a small context-isolated IPC API; it never receives shell access or arbitrary command execution.

### Repository discovery remains explicit and recoverable

The application scans upward from its bundle, current working directory, and executable for `hosting/docker-compose/run.sh`. This makes the root-level packaged app work when double-clicked from the checkout. If the bundle is moved, the operator can choose the checkout with a native directory picker; the chosen path is persisted in application preferences.

### Runtime remains outside the app lifecycle by default

Closing the window does not destroy Docker volumes or evidence. The native menu exposes explicit Stop Runtime and Restart Runtime actions. Quitting the app leaves a healthy runtime running, matching the low-cost reopen path and avoiding accidental loss of long-running work.

### Security boundaries

- `nodeIntegration` is off, `contextIsolation` and renderer sandboxing are on.
- Local navigation is restricted to `http://localhost` and the packaged startup page.
- Only `auth.json` is copied into `.local/codex-home`; the host Codex directory is never mounted.
- Child processes use fixed executable paths and argument arrays, never interpolated shell commands.
- Logs contain command output but never auth file contents.

## Risks / Trade-offs

- The runtime still depends on Docker Desktop and an Agenta checkout. The startup screen makes both dependencies explicit and recoverable.
- First build can take several minutes. Progress and live logs are shown so the client is not mistaken for idle.
- An unsigned/ad-hoc signed local build may trigger macOS warnings on another machine. Distribution signing and notarization are a later release concern.

## Verification

- Unit tests cover repository discovery, runtime command construction, path validation, and localhost navigation policy.
- OpenSpec strict validation passes.
- The Electron package builds for Apple Silicon, its plist parses, and ad-hoc code-sign verification passes.
- Launch the packaged app with `open`, confirm the Electron process/window exists, and confirm the local workbench remains HTTP healthy.
