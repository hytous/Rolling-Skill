# Discoverable Agent Runtimes Plan

**Goal:** Remove bundled Codex and introduce a provider registry that discovers compatible local
agent runtimes and can later support multi-runtime Skill evaluation.

## Task 1: Specify and test the provider boundary

- Define provider-neutral runtime descriptors and registry behavior.
- Add failing tests for Codex candidate discovery/probing and provider delegation.

## Task 2: Implement local Codex discovery

- Probe configured, environment, PATH, application, system, and user-local candidates.
- Preserve all compatible descriptors while deterministically choosing the active runtime.
- Construct the existing app-server client through the Codex provider adapter.

## Task 3: Wire the desktop experience

- Add rescan, manual runtime selection, and automatic-selection IPC/menu controls.
- Show runtime provider/version/source metadata and keep the shell usable when none is available.

## Task 4: Remove bundling and deliver

- Remove the Codex npm dependency and extra resource packaging.
- Replace packaged-runtime integration assumptions with locally discovered runtime smoke coverage.
- Rebuild, inspect, sign, launch, screenshot, commit, and sync the application.
