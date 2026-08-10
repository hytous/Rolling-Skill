## Why

Bundling Codex makes Rolling Skill large and couples every desktop release to a specific agent
runtime version. Skill evaluation also needs to expand beyond one harness and eventually run the
same case against multiple local runtimes in parallel.

## What Changes

- Replace bundled-Codex resolution with a pluggable local Runtime Provider registry.
- Discover compatible local Codex executables from an explicit selection, environment override,
  process PATH, installed applications, and common user/system install locations.
- Probe each candidate for identity, version, and app-server support before selecting it.
- Add runtime rescan, manual executable selection, and automatic-selection controls to the desktop
  application without adding an authentication flow.
- Remove `@openai/codex` and native runtime resources from the packaged application.

## Capabilities

### New Capabilities

- `agent-runtime-registry`: Discover, describe, select, and create clients for local agent runtime
  providers through a common interface.

### Modified Capabilities

- `local-codex-runtime`: Use a compatible locally installed Codex runtime instead of a packaged
  executable.

## Impact

- Desktop runtime discovery, main-process lifecycle, preload API, runtime status UI, tests,
  packaging, and documentation change.
- The first provider remains Codex. The registry boundary is designed for additional providers and
  future multi-runtime evaluation, but parallel orchestration is not implemented in this slice.
