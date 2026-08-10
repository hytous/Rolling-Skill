## 1. Contracts and tests

- [x] 1.1 Add failing tests for bounded evidence attribute parsing and diagnostic trust labeling.
- [x] 1.2 Add failing tests for case metadata augmentation, reserved columns, and ordinary non-case saves.
- [x] 1.3 Add launcher syntax, plist, and Compose configuration checks.

## 2. Frontend workbench

- [x] 2.1 Resolve an assistant message trace ID to the root span and add a message-side `Save case` action.
- [x] 2.2 Extend the existing testset drawer with required goodcase/badcase classification in case-capture mode.
- [x] 2.3 Persist `eval_case_type`, `source_trace_id`, and `source_span_id` on newly curated rows.
- [x] 2.4 Render bounded Codex evidence metadata in a dedicated trace side-panel section.
- [x] 2.5 Render `DIAGNOSTIC_ONLY` as an explicit warning and never as a pass.

## 3. Local application

- [x] 3.1 Add a tracked evaluation Compose overlay with Codex subscription and protected artifact mounts.
- [x] 3.2 Add a double-clickable `Rolling Skill.app` that starts Docker and Agenta, waits for readiness, and opens the browser.
- [x] 3.3 Add a matching stop application or stop action and durable local logs.

## 4. Documentation and verification

- [x] 4.1 Add a root README quick start for the macOS app and CLI fallback.
- [x] 4.2 Document Codex login, evidence location, case fields, stop flow, and current trust/automation limitations.
- [x] 4.3 Run focused tests, web lint/typecheck, OpenSpec strict validation, Compose validation, and launcher smoke tests.
- [x] 4.4 Start the development stack and verify the browser entrypoint.
