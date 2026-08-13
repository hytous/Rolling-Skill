# Dataset-level Skill binding

## Goal

Make one dataset the source of truth for the Skill under test. A user selects the Skill when
creating or repairing a dataset; Case capture, Curator work, and evaluation inherit that binding
without presenting independent Skill selectors.

## Data model

Each dataset stores a nullable `skillReference` using the existing
`rolling-skill-skill-reference/v1` shape. New datasets require a currently enabled runtime Skill
and are created with that complete reference. Cases and curation sessions retain their frozen
`skillReference` as provenance, but new records always copy it from the selected dataset rather
than accepting a caller-selected reference. Evaluation runs continue to freeze their own Skill
reference and evidence snapshot, both derived from the dataset binding at launch.

Changing a dataset binding affects only future curation and evaluation. Existing Cases, archived
Curator sessions, and evaluation runs remain immutable evidence of the Skill version used when
they were created. A binding cannot be changed while the dataset has an unfinished Curator draft
or capture reservation.

## Migration

The local store schema is bumped once. For every legacy dataset without a binding:

1. Collect normalized non-null Skill references from its Cases and curation sessions.
2. If every collected reference has the same Skill name and path, copy the most complete matching
   reference to the dataset.
3. If there is no reference, or more than one name/path pair, leave the dataset unbound.

An unbound dataset is preserved and marked as requiring a binding. It can still be inspected and
deleted, but Case capture and evaluation are disabled until the user chooses one enabled Skill.
Migration never guesses between conflicting references and never rewrites existing Case evidence.

## User interface

Dataset creation in both the Case capture dialog and evaluation workbench asks for dataset name
and Skill together. The action stays disabled until both are present.

Selecting a dataset shows its bound Skill as read-only identity/status. The Case capture dialog no
longer includes a Skill selector. The evaluation launch panel no longer includes a Skill selector;
it displays the selected dataset's binding and validates that the local file exists and can produce
a complete evidence snapshot before enabling launch.

Legacy unbound datasets expose one `Bind Skill` repair action. The same action may be used to
change a binding deliberately, with a confirmation explaining that old Cases and runs retain their
frozen provenance. Stale or unavailable bindings are shown as unavailable instead of being silently
replaced by a same-named Skill.

Curator prompts receive the dataset binding automatically. Automatic Capture uses its configured
dataset and therefore no longer stores or requests a separate Skill name/path.

## Main-process ownership

The renderer does not decide which Skill applies. Main-process/store APIs enforce the invariant:

- `createDataset` accepts `{name, skillReference}`.
- `bindDatasetSkill` validates and stores a new binding.
- `createCurationSession` resolves the dataset and copies its binding, rejecting unbound datasets.
- `createEvaluationRun` and the evaluation IPC derive their Skill reference from the dataset and
  reject any conflicting caller value.

This prevents stale renderer state or a crafted IPC request from evaluating a different Skill.

## Error handling

Errors identify the actionable condition: dataset unbound, bound Skill missing, runtime no longer
reports the exact name/path, or evidence snapshot incomplete. Snapshot failures include the actual
warning list instead of only the generic completeness message.

## Verification

Tests cover deterministic migration, ambiguous migration, dataset creation/binding validation,
Case and Curator inheritance, evaluation inheritance, conflicting IPC input rejection, unavailable
Skill UI state, and both dataset-creation entry points. The normal desktop unit suite, renderer
smoke test, macOS packaging, signature verification, and launch smoke check remain the release gate.
