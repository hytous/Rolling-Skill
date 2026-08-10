## Why

The Codex evidence MVP records diagnostic rollout evidence, but operators cannot see its status in the Agenta UI or curate an agent answer into an evaluation dataset from the conversation. Local testing also requires several manual Docker, Compose, evidence, and browser steps.

## What Changes

- Show bounded Codex evidence metadata in the trace side panel with an explicit trust warning.
- Add a message-side action that resolves the run's root span and opens the existing testset drawer.
- Let the operator classify the saved row as `goodcase` or `badcase` and persist source trace/span provenance.
- Keep automatic dataset capture disabled; every row in this change requires an explicit operator save.
- Add a tracked Compose overlay and a double-clickable macOS application bundle that starts Docker Desktop, prepares local files, starts Agenta, and opens the browser.
- Document the runnable workflow, evidence limitations, data locations, and stop procedure.

## Capabilities

### New Capabilities

- `skill-eval-workbench`: Inspect Codex evidence status and manually curate conversation runs into evaluation testsets.
- `macos-local-launcher`: Start the local OSS evaluation stack from a double-clickable macOS application.

### Modified Capabilities

- `codex-rollout-evidence`: Surface its bounded OTel projection in the trace UI without exposing raw evidence payloads.

## Impact

- Frontend: agent message actions, the existing add-to-testset drawer, and trace side panel.
- Hosting: one evaluation-specific Compose overlay and macOS launcher bundle.
- Documentation: root README local-evaluation quick start and current limitations.
- Data: manually captured rows gain `eval_case_type`, `source_trace_id`, and `source_span_id` columns.
- Security: raw native evidence stays on the local protected artifact volume and is never rendered in the browser.
