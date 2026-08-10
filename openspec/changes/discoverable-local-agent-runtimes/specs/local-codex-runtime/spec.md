## MODIFIED Requirements

### Requirement: Discovered local runtime

The macOS application SHALL discover and start a compatible locally installed Codex app-server and
SHALL NOT package Codex or require Docker, Docker Compose, or an Agenta HTTP server.

#### Scenario: Compatible Codex exists on PATH
- **WHEN** the operator opens the application
- **THEN** Rolling Skill probes and starts that executable without using a packaged runtime

#### Scenario: Codex is supplied by an installed application
- **WHEN** no PATH executable is available but a known application contains compatible Codex
- **THEN** Rolling Skill discovers and uses the application resource

#### Scenario: Candidate lacks app-server support
- **WHEN** an executable does not pass the Codex compatibility probe
- **THEN** it is excluded from available runtimes and is never started for a task
