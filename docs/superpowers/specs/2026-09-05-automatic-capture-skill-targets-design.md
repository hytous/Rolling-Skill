# Automatic Capture Skill Targets Design

## Goal

Bring the Electron App's automatic-capture settings to parity with the DSH plugin so users can explicitly choose which managed Skills are eligible for collection and select one bound Dataset for each chosen Skill.

## User experience

- Replace the single “Preferred dataset” select with a “Candidate Skills” fieldset.
- Show every valid managed Skill that has been imported into Rolling Skill, plus unavailable rows retained by an existing saved target.
- Each row has a checkbox and a Dataset select.
- Checking a Skill adds it to automatic-capture scope and selects its first eligible Dataset when available.
- Unchecking a Skill removes it from scope.
- Only Datasets bound to that exact managed Skill appear in its select.
- In `automatic` mode, Datasets without a published Rubric are visible but disabled; in `scheduled` mode they remain selectable because the result only enters Raw Cases.
- Whenever automatic capture is enabled, Settings requires at least one valid Skill-to-Dataset route and blocks saving an empty selection. The App never treats an empty selection as “scan every installed Skill”.

## Persistence and compatibility

- Save the rows through the existing `autoCaptureTargets` setting as `{skillId, datasetId}` pairs.
- Clear legacy `autoCaptureDatasetId` on every save.
- When the saved target list is empty but a legacy `datasetId` exists, initialize the UI with a single route derived from that Dataset's bound Skill.
- When a legacy path-based or Runtime name-only Dataset binding uniquely matches one valid managed Skill by name, present it under that Skill and persist the managed identity before saving the route. Ambiguous names remain unavailable rather than being guessed.
- Keep unavailable saved Skill rows visible so users can remove or repair stale configuration.

## Validation

- A checked Skill must have a Dataset selected.
- The Dataset must be bound to the same Skill.
- In fully automatic mode, the Dataset must have an active published Rubric.
- Invalid rows are visually marked, disable Settings save, and surface the reason through the Settings-level validation message.
- Runtime-side validation in `LocalEvaluationStore` remains the authority.

## Architecture

Add a small renderer helper responsible for candidate-row projection, Dataset eligibility, legacy migration, and target validation. The Settings renderer owns DOM creation and event handling, while the existing store and `ConversationDiscoveryManager` continue to persist and enforce the route list.

## Verification

- Pure helper tests cover valid Skill rows, stale saved rows, mode-sensitive Dataset eligibility, legacy migration, and validation.
- Surface tests assert the multi-Skill fieldset and `autoCaptureTargets` persistence wiring.
- Desktop test suite and renderer smoke test must pass.
