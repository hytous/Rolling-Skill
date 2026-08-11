# Multi-runtime Skill evaluation implementation plan

**Goal:** Make Rolling Skill a useful local evaluation harness: hide completed drafts, expose reasoning effort everywhere a model is chosen, run one Case or an entire dataset across multiple local runtimes in parallel, preserve run evidence, support deletion, and add CodeBuddy through its native ACP protocol.

**Architecture:** Keep Chat bound to the active runtime. Add a provider-neutral evaluation orchestrator that creates an isolated client per selected runtime, executes that runtime's Case queue while runtime queues run concurrently, and persists immutable snapshots of Cases, runtime configurations, and results. Codex continues to use app-server; CodeBuddy gets an ACP JSONL client. The local store remains the source of truth and migrates additively.

## Task 1: Lock storage and protocol contracts with failing tests

- Test that archived/cancelled curation sessions are absent from the draft list and archived sessions have a dedicated query.
- Test effort persistence/migration, Case deletion, immutable evaluation-run snapshots, and run status updates.
- Test Codex `turn/start.params.effort` and model effort normalization.
- Test CodeBuddy discovery, ACP handshake, session model/effort configuration, prompt notifications, and honest capabilities.

## Task 2: Implement provider-neutral evaluation execution

- Add a client pool/orchestrator separate from the active Chat client.
- Run selected Cases sequentially within each runtime and run different runtime configurations concurrently.
- Persist run metadata before execution and update each Case × runtime result with duration, response, error, session/thread id, and trace reference.
- Snapshot the Cases and runtime configurations so later Case deletion cannot invalidate historical runs.

## Task 3: Extend the desktop surface

- Add paired model/effort selectors to Chat, Curator, Settings, Automatic Capture, and evaluation runtime rows.
- Add dataset-wide and selected-Case launch actions.
- Add runtime rows with checkboxes, model, and effort selectors.
- Add `Cases / Evaluation runs` views, run detail, Case deletion with confirmation, and Settings-only archived draft history.

## Task 4: CodeBuddy ACP provider

- Discover and compatibility-probe local `codebuddy` executables.
- Implement ACP initialize/new/load/prompt/cancel and map ACP updates to the existing renderer event shape.
- Use `session/set_model` and `session/set_config_option` (`thought_level`) for per-session model and reasoning effort.
- Do not claim Skill inventory/plugin support when ACP cannot provide path-precise inventory.

## Task 5: Verify, package, and document

- Run the desktop unit/integration suite.
- Smoke-test Codex and CodeBuddy compatibility probes and Codex effort payloads.
- Exercise the Electron UI, inspect screenshots, and check for renderer errors.
- Update the README, bump the desktop version, rebuild `Rolling Skill.app`, then commit and push the feature branch.
