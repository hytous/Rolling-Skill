## Context

Rolling Skill currently copies a pinned Codex distribution into every application bundle. That
guarantees one known version, but duplicates software already present on developer machines and
makes runtime upgrades require a desktop rebuild. A provider-neutral evaluation client instead
needs runtime discovery and compatibility metadata as first-class concepts.

## Goals / Non-Goals

**Goals**

- Package no agent runtime in `Rolling Skill.app`.
- Discover every compatible local runtime exposed by registered providers.
- Select a deterministic active runtime while preserving a user-selected executable.
- Surface provider, version, source, and path in application state.
- Keep the client/runtime boundary provider-neutral enough to add more harness adapters.

**Non-goals**

- Implement parallel case execution in this change.
- Normalize the different trace protocols of future non-Codex runtimes.
- Install, upgrade, authenticate, or modify local runtimes.
- Accept an executable that has not passed a provider compatibility probe.

## Decisions

### Runtime descriptors

Discovery produces immutable descriptors containing `runtimeId`, `providerId`, `displayName`,
`version`, `executablePath`, `source`, `transport`, and capabilities. Renderer code receives
descriptors, never process primitives.

### Provider registry

Each provider implements `discover(options)` and `createClient(descriptor, options)`. The registry
flattens provider discovery results, de-duplicates descriptors, selects the first compatible result,
and delegates client creation. Main-process thread operations continue to use the selected client's
existing interface.

### Codex discovery priority

The Codex provider checks a saved user selection, `ROLLING_SKILL_CODEX_BIN`, process PATH, known
application resources, Homebrew/system locations, and common user-local installations. Duplicate
real paths are removed. Every executable is probed with fixed argument arrays and `shell: false`;
the probe must identify Codex and confirm `app-server` support.

### No packaged fallback

If discovery finds nothing compatible, the desktop UI still opens and local datasets remain
available. Runtime-backed task controls report an actionable unavailable state with rescan and
manual-selection options. The application does not download or install a runtime.

### Future parallel evaluation

The registry returns all discovered descriptors even though the first UI selects one active
runtime. A later orchestrator can create one client per selected descriptor and associate every
trace/case result with its `runtimeId` without changing discovery or provider adapters.

## Verification

- Unit tests cover discovery priority, de-duplication, compatibility rejection, and provider
  registry selection/client delegation.
- Integration smoke uses an actually discovered local Codex when available and does not depend on
  an npm-bundled runtime.
- Package inspection confirms no Codex binary or `codex-runtime` resource exists in the `.app`.
- Native launch verifies both detected-runtime and unavailable-runtime UI paths remain local-first.
