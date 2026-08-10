## ADDED Requirements

### Requirement: Message-side manual case capture

The conversation UI SHALL provide a case-capture action for a settled assistant message with a trace. The action SHALL resolve the trace's root span and open the existing testset selection and mapping workflow. It SHALL NOT save data before explicit operator confirmation.

#### Scenario: A traced answer is captured
- **WHEN** an operator selects `Save case` on a settled assistant message
- **THEN** the testset drawer opens with the root run span and requires dataset, classification, and save confirmation

#### Scenario: The trace is still ingesting
- **WHEN** the root span is not yet available
- **THEN** the action reports a resolving state and does not open an empty dataset row

### Requirement: Case classification and provenance

Case-capture mode SHALL require either `goodcase` or `badcase`. Each newly saved row SHALL contain `eval_case_type`, `source_trace_id`, and `source_span_id`. Existing rows and ordinary add-to-testset workflows SHALL remain unchanged.

#### Scenario: A bad case is saved to an existing testset
- **WHEN** the operator selects `badcase` and confirms the save
- **THEN** the new revision adds a row with the three reserved fields and adds any missing reserved columns

### Requirement: Automatic capture is disabled

The workbench SHALL NOT automatically save conversation messages or invoke a curation agent in this change. Capture SHALL begin only from an explicit operator action.

#### Scenario: A conversation finishes
- **WHEN** an assistant turn completes and the operator takes no capture action
- **THEN** no testset or testset revision is created or modified

### Requirement: Bounded evidence presentation

The trace UI SHALL render only the bounded `ag.meta.eval.*` evidence projection: schema version, collection status, source trust, completeness, digest, artifact reference, reason codes, and numeric counts. It SHALL NOT display raw rollout payloads.

#### Scenario: Full-access diagnostic evidence is present
- **WHEN** collection status is `DIAGNOSTIC_ONLY` or source trust is `diagnostic_full_access`
- **THEN** the UI displays a warning that the trace is useful for inspection but ineligible for trusted A-class scoring

#### Scenario: A trace has no Codex evidence attributes
- **WHEN** no known evidence projection attribute exists
- **THEN** the evidence panel is omitted

#### Scenario: The operator selects a child span
- **WHEN** the trace root span contains Codex evidence and the active detail span is a child
- **THEN** the evidence panel continues to render the root-span projection
