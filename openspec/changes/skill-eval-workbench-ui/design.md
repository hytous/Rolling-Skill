## Context

The runner projects bounded evidence fields under `ag.meta.eval.*` onto the root agent span. Agenta already has a trace drawer, a trace-to-testset drawer, and a testset revision API. Reusing those surfaces avoids a parallel dataset store and keeps curated cases compatible with existing evaluation workflows.

The current Codex runtime grants evaluated tools the same filesystem authority as the native rollout writer. Evidence is therefore diagnostic, not a trustworthy A-class hard-score source. The UI must preserve that distinction.

## Goals / Non-Goals

**Goals:**

- make evidence collection status, completeness, provenance, counts, digest, and reasons visible;
- save a conversation run to a selected testset from the message toolbar;
- require a `goodcase` or `badcase` classification and retain source provenance;
- keep all capture manual by default;
- provide a double-click local launcher with actionable errors and durable evidence storage.

**Non-Goals:**

- trusting `diagnostic_full_access` evidence for A-class scoring;
- rendering raw rollout prompts, responses, terminal output, or tool payloads;
- automatically invoking a curation subagent in this slice;
- automatically saving messages without operator confirmation;
- notarizing or distributing the local macOS bundle outside this checkout.

## Decisions

### 1. Reuse trace and testset entities

The message action carries the trace ID already stamped on the assistant message. The add-to-testset button resolves that trace to its root span through `traceRootSpanAtomFamily` and passes the span ID into the existing drawer. No new backend endpoint or duplicate dataset model is introduced.

### 2. Case metadata is injected at the final conversion boundary

The drawer keeps its existing field-mapping behavior. In case-capture mode, the save conversion appends `eval_case_type`, `source_trace_id`, and `source_span_id` to each new row and adds missing columns to the committed revision. Ordinary trace-to-testset actions retain their existing output.

### 3. Manual capture is the only enabled policy

The message toolbar action requires an explicit click, dataset choice, classification, mapping review, and save. Automatic capture remains disabled and is documented as a later capability. This preserves the requested default without presenting a non-functional permission selector.

### 4. Evidence presentation is a pure bounded adapter

A small pure parser reads only known `ag.meta.eval.*` attributes and returns a typed view model. The trace side panel renders a dedicated section only when those attributes exist. `DIAGNOSTIC_ONLY` and `diagnostic_full_access` always produce a visible warning and never a pass badge.

### 5. The macOS application is a local source bundle

`Rolling Skill.app` is a standard `.app` directory with an executable shell entrypoint and `Info.plist`. It locates the repository relative to itself, starts Docker Desktop, validates Codex login, copies only `auth.json` into an ignored `.local/codex-home/`, applies the tracked evaluation overlay, starts Compose, waits for HTTP readiness, and opens the browser. The host `~/.codex` directory is never mounted, so its Skills, plugins, apps, and configuration remain outside evaluated runs. Logs and evidence remain under `.local/` in the checkout.

## Risks / Trade-offs

- A freshly ingested trace may not have a root span immediately. The action stays in a resolving state and uses the trace query retry policy.
- Adding provenance columns can conflict with an existing column name. The conversion deliberately overwrites only the newly added row's reserved fields and leaves existing rows unchanged.
- The local `.app` is not signed or notarized. It is intended for this machine and checkout only.
- First launch builds the development stack and may take several minutes. Later launches reuse Docker images.

## Verification

- Unit-test evidence attribute parsing and case-row augmentation before wiring components.
- Type-check and lint the OSS web app.
- Validate the Compose overlay with `docker compose config`.
- Validate `Info.plist`, shell syntax, and launcher path resolution.
- Start the stack through the `.app`, verify `http://localhost`, and inspect the runner health/logs.
