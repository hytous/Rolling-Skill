## ADDED Requirements

### Requirement: Native desktop window

The distribution SHALL provide a foreground macOS application with a Dock icon, native application menu, and independent window. It SHALL render the local workbench inside that window and SHALL NOT automatically open the system browser for local application routes.

#### Scenario: Healthy runtime is already running
- **WHEN** the operator double-clicks `Rolling Skill.app`
- **THEN** one native application window opens and loads the local workbench without launching a browser

### Requirement: Visible managed startup

The client SHALL display Docker, credential, Compose, and HTTP readiness progress inside its own window. A failed step SHALL produce an actionable error and retain bounded diagnostic logs.

#### Scenario: First Compose build is slow
- **WHEN** the local images need to be built
- **THEN** the startup view remains visible, identifies the active build step, and streams recent logs until the workbench is ready or startup fails

#### Scenario: Startup fails
- **WHEN** Docker, Codex login, checkout discovery, Compose, or HTTP readiness fails
- **THEN** the client displays the cause and offers the relevant retry, repository, or log action without claiming readiness

### Requirement: In-app runtime lifecycle

The client SHALL expose status, retry/restart, stop, logs, and checkout actions through native UI. Stopping SHALL preserve Compose volumes, local evidence, and logs.

#### Scenario: Operator stops the runtime
- **WHEN** the operator chooses Stop Runtime
- **THEN** Compose services stop, retained data is not deleted, and the client returns to a stopped state

### Requirement: Isolated Codex credentials

The native client SHALL copy only the host `auth.json` into an ignored runner credential directory and SHALL NOT mount the host Codex Skills, plugins, apps, or configuration.

#### Scenario: Runtime is prepared
- **WHEN** a local Codex evaluation runtime starts
- **THEN** its mounted Codex home contains the isolated credential copy rather than the host `.codex` directory

### Requirement: Desktop renderer security

The native client SHALL disable renderer Node integration, enable context isolation and sandboxing, restrict local navigation to the configured loopback origin, and pass child process arguments without shell interpolation.

#### Scenario: Workbench requests an external URL
- **WHEN** a link targets a non-local HTTPS origin
- **THEN** it is not loaded in the privileged application window and may be opened by the operating system as an external link
