## 1. Desktop contract and runtime controller

- [x] 1.1 Add failing unit tests for checkout discovery, trusted navigation, and fixed Compose invocation.
- [x] 1.2 Implement the tested path, security policy, logging, credential isolation, Docker readiness, and Compose lifecycle modules.
- [x] 1.3 Add an Electron main process, sandboxed preload bridge, single-instance behavior, and macOS application menu.

## 2. Native client experience

- [x] 2.1 Add a packaged startup/status/error renderer with progress, bounded log output, retry, repository selection, and log actions.
- [x] 2.2 Load the local Agenta workbench in the native window after readiness and keep external navigation outside the embedded client.
- [x] 2.3 Add an application icon and Electron Builder configuration for an Apple Silicon macOS `.app`.

## 3. Delivery and documentation

- [x] 3.1 Replace the old root launcher bundle with the packaged Electron app while preserving an explicit runtime stop action in the app menu.
- [x] 3.2 Update README startup, first-run, lifecycle, data, security, development, and troubleshooting instructions.
- [x] 3.3 Run desktop tests, package verification, OpenSpec strict validation, frontend lint gate, and a real Finder-equivalent launch/health smoke test.
