## ADDED Requirements

### Requirement: Double-click startup

The repository SHALL include a macOS `.app` bundle that can be opened from Finder. It SHALL locate the repository relative to the bundle, start Docker Desktop when needed, prepare ignored local configuration, start the OSS development stack with the evaluation overlay, wait for HTTP readiness, and open `http://localhost`.

#### Scenario: First launch with Docker installed
- **WHEN** the operator double-clicks the app and Docker is not running
- **THEN** the app starts Docker, builds the stack, waits for readiness, and opens the browser

#### Scenario: Codex login is missing
- **WHEN** `~/.codex/auth.json` is absent or empty
- **THEN** the app presents an actionable login message and does not claim that Codex evaluation is ready

### Requirement: Durable local evidence and logs

The launcher SHALL store evidence and launcher logs outside containers under the repository's ignored `.local/` directory. Container recreation SHALL NOT remove those host files.

#### Scenario: The runner container is recreated
- **WHEN** evidence was captured before recreation
- **THEN** the host evidence directory still contains the preserved artifact revisions

### Requirement: Isolated Codex credentials

The launcher SHALL copy only the host `auth.json` into an ignored runner credential directory. It
SHALL NOT mount the operator's `~/.codex` directory, Skills, plugins, apps, or configuration.

#### Scenario: Runner subscription credentials are mounted
- **WHEN** the Compose stack starts a local Codex run
- **THEN** `/codex-home` contains the isolated credential copy and no other host Codex assets

### Requirement: Reversible local lifecycle

The local application distribution SHALL include a double-click stop action or application that stops the Compose stack without deleting volumes or evidence.

#### Scenario: The operator stops the app
- **WHEN** the stop action is opened
- **THEN** the Compose services stop while database volumes, local evidence, and logs remain available
