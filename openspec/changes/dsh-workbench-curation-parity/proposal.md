## Why

The DeepSeek Harness plugin currently exposes most Rolling Skill business workflows inside Settings and omits the direct conversation-to-Case, reviewable Draft, and Dataset Rubric loops available in the Electron product. A managed parity rollout is needed now so the DSH migration does not silently drop user-visible actions, background lifecycle guarantees, or the stable Managed Skill identity model while the two deliverables are being repaired and installed.

## What Changes

- Add an independent Rolling Skill launcher and near-full-screen workbench in DSH while reducing the Settings section to plugin configuration, legacy import, and diagnostics.
- Add a native per-finalized-assistant “Curate Case” action, trusted DSH Session-log evidence capture, reviewable Draft creation, source-range lifecycle coloring, duplicate protection, and direct Draft/Case navigation.
- Expose the existing Curation and Dataset Rubric managers through strict, idempotent DSH Host APIs and complete their workbench review, retry, publish/save, discard, archive, and recovery flows.
- Preserve all other Electron business capabilities through an explicit 136-item parity ledger. Capabilities supplied by DSH remain host-native and receive non-regression checks instead of being reimplemented.
- Keep Dataset identity permanently bound to a managed Repository/Skill pair. Freeze Released Version, Runtime Installation, commit, digest, provider, and path only as operation evidence for Curation, Rubric, Evaluation, and Optimization.
- Keep DSH and Electron as separate native frontends and distributions. The DSH package remains a Cordis plugin without Electron/Chromium payloads; the Electron archive branch receives the managed-identity backport and produces a signed, installed macOS App.

## Capabilities

### New Capabilities

- `dsh-native-case-curation`: Per-message Case curation, trusted source-boundary selection, frozen DSH trace evidence, Draft/Case lifecycle markers, and direct navigation from the native conversation.
- `dsh-independent-workbench`: Sidebar-launched Rolling Skill workbench with complete Raw Case, Curation, Rubric, Dataset/Case, Skill, Evaluation, Automatic Capture, Operator, and Optimization workflows outside Settings.
- `rolling-skill-surface-parity`: A machine-checkable migration ledger that maps every Electron, Shared Core, and DSH-only capability to its owner surface and required automated/real-UI evidence.
- `managed-skill-operation-evidence`: Stable Dataset-to-managed-Skill identity with operation-scoped Version/Installation evidence across both DSH and Electron distributions.
- `dual-surface-delivery`: Independent DSH plugin and Electron App build, package-content, installation, data-isolation, and real-surface verification contracts.

### Modified Capabilities

None. The repository has no archived OpenSpec baseline under `openspec/specs/`; this change introduces the initial specifications for the migration behavior.

## Impact

- `packages/rolling-skill-core`: trusted DSH episode ingestion, Curation/Rubric application services, marker queries, idempotency, and parity inventory support.
- `packages/rolling-skill-dsh`: Host `sessionQuery` integration, strict API additions, sidebar and conversation slots, independent React workbench, package inspection, worker, and UI verification.
- `desktop/rolling-skill`: shared Store/Manager support plus the managed-Skill identity backport, Electron regression tests, macOS build/sign/install flow.
- Local data: DSH and Electron roots remain isolated; legacy import stays explicit and no user data is moved or deleted.
- Test and delivery: focused RED/GREEN tests per capability, full package suites, real DSH browser checks, Electron renderer smoke, signature verification, and installation checks.
