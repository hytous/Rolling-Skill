# Native Rolling Skill Desktop Implementation Plan

**Goal:** Replace the shell/browser launcher with a genuine macOS desktop application that manages the local evaluation runtime and embeds the workbench.

**Architecture:** A small Electron main process owns Docker/Compose lifecycle and loads a static status renderer until the local Agenta URL is healthy. A context-isolated preload exposes only fixed lifecycle IPC calls. The packaged app locates or asks for the source checkout and stores all evidence, isolated credentials, and logs under the checkout's ignored `.local` directory.

**Tech Stack:** Electron, Node.js built-ins, Electron Builder, Node test runner, existing Docker Compose stack.

## Task 1: Lock down the runtime contract with tests

- Create `desktop/rolling-skill/test/*.test.cjs` for repository discovery, command construction, and trusted navigation.
- Run tests and confirm they fail because the implementation modules do not exist.
- Implement minimal pure modules and rerun to green.

## Task 2: Implement runtime orchestration

- Add fixed-path process execution, bounded log storage, status events, Docker start/readiness, isolated auth copy, environment preparation, Compose start/stop/restart, and HTTP polling.
- Add unit coverage for edge cases that do not require Docker.

## Task 3: Build the native application surface

- Add Electron main and preload entrypoints with safe `BrowserWindow` preferences.
- Add the startup/status/error renderer and scoped IPC actions.
- Add native menus, single-instance behavior, external-link handling, and repository picker.

## Task 4: Package and document

- Add Electron Builder metadata and icon assets.
- Build an Apple Silicon `.app`, replace the old root launcher, and retain the app-controlled stop path.
- Update README with native-client usage and troubleshooting.

## Task 5: Verify end to end

- Run desktop unit tests and package build.
- Validate OpenSpec strictly and run the repository-required frontend lint gate.
- Parse plist, verify code signing, open the packaged app, confirm a running Electron process and healthy local workbench, and inspect runtime logs for startup failures.
