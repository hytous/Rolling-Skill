## ADDED Requirements

### Requirement: Provider-neutral runtime discovery

The desktop client SHALL discover local agent runtimes through registered providers and represent
every compatible result with a provider-neutral descriptor.

#### Scenario: Multiple providers are registered
- **WHEN** runtime discovery runs
- **THEN** the registry returns compatible descriptors from every provider without coupling the
  application lifecycle to a provider-specific executable path

### Requirement: Deterministic runtime selection

The registry SHALL prioritize a valid user-selected runtime and otherwise select the first
compatible automatically discovered runtime.

#### Scenario: Saved runtime remains compatible
- **WHEN** the application restarts with a previously selected executable
- **THEN** that runtime is selected and its provider, version, source, and path are visible

### Requirement: Missing runtimes do not block local data

The application SHALL open without an agent runtime and SHALL keep local datasets and preferences
available.

#### Scenario: No compatible runtime is installed
- **WHEN** discovery returns no descriptors
- **THEN** the task UI reports runtime unavailability and offers rescan/manual selection without
  presenting authentication or requiring a server stack

### Requirement: Multi-runtime-ready identity

Every trace session and active client SHALL retain a stable runtime identifier suitable for future
parallel evaluation attribution.

#### Scenario: Two runtime versions are discovered
- **WHEN** both are selected by a future parallel orchestrator
- **THEN** their clients and evidence can be distinguished by `runtimeId`
