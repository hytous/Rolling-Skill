## ADDED Requirements

### Requirement: Packaged local runtime

The macOS application SHALL start a bundled Codex app-server directly and SHALL NOT require Docker, Docker Compose, an Agenta HTTP server, or a separately installed Codex CLI.

#### Scenario: Application opens on a machine without Docker
- **WHEN** the operator double-clicks the packaged application
- **THEN** the task interface and local Codex runtime start without inspecting or launching Docker

### Requirement: No application login flow

The client SHALL NOT gate startup or thread browsing on Agenta or Codex authentication and SHALL NOT present a login page.

#### Scenario: Provider credentials are absent
- **WHEN** the local runtime has no provider credentials
- **THEN** the task interface and existing local threads remain available, and only a model turn reports the runtime authentication error

### Requirement: Workspace-scoped Codex threads

The client SHALL list, read, create, and run Codex threads through app-server and SHALL filter the visible thread list to the selected workspace.

#### Scenario: Other products have local Codex sessions
- **WHEN** thread history contains sessions from other working directories
- **THEN** those sessions do not appear in the active Rolling Skill workspace list

### Requirement: Local raw event evidence

The client SHALL append timestamped inbound and outbound app-server messages to local JSONL evidence files without requiring a remote telemetry backend.

#### Scenario: A turn streams tool and assistant events
- **WHEN** app-server emits its event sequence
- **THEN** the raw event file preserves the sequence and the UI can inspect the events for that local session

