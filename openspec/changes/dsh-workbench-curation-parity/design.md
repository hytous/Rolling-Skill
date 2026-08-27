## Context

Rolling Skill began as an Electron task client and accumulated mature Case, Rubric, Evaluation, Managed Skill, Installation, Automatic Capture, Operator, and Optimization lifecycles. The first DSH plugin port correctly reused much of the shared backend but mounted the whole workbench in `settings.section` and exposed only a subset of the Curation and Rubric manager surface. DSH now supplies native Session rendering, history, tools, trace UI, themes, and an additive plugin contract, so parity must preserve business workflows without recreating the host shell.

The approved detailed design and 136-item inventory are recorded in `docs/superpowers/specs/2026-08-27-dsh-workbench-curation-parity-design.md` and `docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md`.

## Goals / Non-Goals

**Goals:**

- Make Rolling Skill a directly accessible DSH workbench and restore the complete reviewable Draft and Rubric loops.
- Allow Case capture to start in the native conversation and use trusted, immutable DSH event evidence.
- Preserve every existing product capability through explicit ownership and evidence-based parity gates.
- Apply the pathless Managed Skill Dataset identity contract to DSH and Electron while freezing exact operation evidence.
- Build, install, and verify a normal DSH plugin and a separate signed Electron App.

**Non-Goals:**

- Embed Electron/Chromium or the Electron DOM Renderer in the DSH plugin.
- Replace DSH conversation, message, tool, history, trace, theme, or sidebar shell renderers.
- Allow the browser Client to submit arbitrary Episodes, trace bodies, executable paths, installation paths, commits, or digests.
- Merge DSH and Electron data roots or silently import legacy data.
- Apply an arbitrary fixed byte ceiling to the DSH package.

## Decisions

### Decision: Shared domain and two native frontends

Core Stores, Managers, Runtime adapters, validation, and operation evidence stay shared. DSH uses React and official Cordis slots; Electron keeps its existing Renderer and IPC. This avoids a bundled webview/Electron runtime and prevents either platform's navigation model from constraining the other.

Reusing the Electron Renderer in DSH was rejected because it would duplicate Chromium assumptions, inflate the package, and fight host theme/navigation. Rewriting domain managers in React Client code was rejected because it would fork persistence and safety semantics.

### Decision: Additive launcher plus independent overlay

`sidebar.footer.action` owns a launcher and local overlay state. The overlay holds the full workbench; `settings.section` retains only plugin defaults, legacy import, data-root, and diagnostics. Replacing `conversation`, `sidebar`, or another single slot was rejected because the DSH contract labels that as shipped-UI shadowing.

### Decision: Trusted Host capture precedes Curation

The Assistant action submits durable identities only. A Host service injected with `sessionQuery` reads the live-preferred Session log, proves the Human start and Assistant end, freezes the raw slice and digest, resolves replacement lineage, then invokes a narrow trusted Curation entry with the derived Episode. Curator execution may use a selected Runtime, but source acquisition never calls that Runtime's generic `readThread` path for a native DSH capture.

Accepting a Client-assembled transcript was rejected because it can omit unloaded history, tools, replacements, or boundaries and can be forged. Using `traceSession` alone was rejected because it describes Session lineage rather than execution events.

### Decision: Marker identity is business-first and projection-second

Persisted marker records contain Session ID, start/end event identities and seq values, Curation/Case IDs, lifecycle state, and frozen evidence digest. The Client maps these records onto the current `ConversationSnapshot` and stable `data-chat-flow-key` rows. Styling is theme-aware and additive. If a future DSH version removes the stable anchor, a compatibility test fails and UI degrades to terminal labels rather than coloring incorrect rows.

Replacing keyed `conversation.chat.node` renderers was rejected because it would shadow every shipped user, Assistant, tool, and turn-tail implementation. Mutating native message bodies was rejected because it would break host ownership.

### Decision: Strict application methods and serialized mutations

DSH adds focused Curation, Rubric, conversation-inspection/create/marker, and parity methods to the existing JSON dispatch boundary. Mutations remain serialized and creation/destructive operations require idempotency keys plus expected revisions where applicable. The Client submits stable IDs; the Host resolves content and paths.

A second arbitrary REST model or direct Store access from React was rejected because it would duplicate validation and make cancellation/idempotency inconsistent.

### Decision: A 136-ID ledger is the completion authority

The implementation adds a machine-readable mapping from the mechanically extracted Electron Renderer, Preload, Main/Core, DSH Tool, and test-name inventories to ledger IDs. Each ID carries an owner surface and evidence fields. Counts detect drift, but exact name sets prevent a removed feature and unrelated addition from cancelling each other out.

Treating the existing DSH tabs as proof of parity was rejected because visible controls do not prove recovery, stale-write protection, permissions, background jobs, destructive recovery, or distribution behavior.

### Decision: Deliver DSH before backporting Electron

`main` receives shared Core changes and the DSH implementation first, followed by build, forced local install, and real UI checks. The existing Electron archive branch then receives the managed identity changes by focused cherry-pick or equivalent adaptation, runs its own tests, and builds/signs/installs the App. Shared working-tree files are never edited simultaneously across branches.

Implementing both branches in parallel was rejected because they share paths and would make the final identity contract and generated artifacts ambiguous.

## Risks / Trade-offs

- **[DSH internal projection anchors change]** → Keep message actions and terminal labels on public slots, add a compatibility test for flow keys, and fail visibly instead of mis-highlighting.
- **[The parity ledger becomes ceremonial]** → Extract exact source-name inventories in tests and require implementation/test/UI evidence per ID in the final report.
- **[Trusted trace snapshots grow large]** → Preserve the complete bounded source slice once, store a digest/reference in normal records, compact only the Curator view, and retain existing request/output limits.
- **[Older Sessions have incomplete or compacted evidence]** → Use `traceEvent` lineage when provable and block Draft creation when it is not; never guess boundaries.
- **[Polling causes background traffic or stale UI]** → Poll only visible active Sessions, abort on navigation, use expected revisions, and never equate Client abort with Job cancellation.
- **[Managed installation drifts after selection]** → Resolve and freeze evidence on the Host, validate again before save/publish/release, and provide inspect/reinstall recovery actions.
- **[DSH package grows while parity is restored]** → Report packed/unpacked changes and reject prohibited payload classes; do not reject legitimate plugin code by an arbitrary size number.
- **[Branch switch encounters user changes]** → Preserve the untracked `openspec/config.yaml`, stop on overlapping dirty files, and never use destructive checkout/reset commands.

## Migration Plan

1. Add parity-contract and domain tests before extending Shared Core; establish exact failing inventories and operation-evidence expectations.
2. Add trusted DSH trace snapshot and conversation Curation services, then Assistant action and lifecycle markers.
3. Add the independent launcher, slim Settings section, Curation/Rubric APIs, and full workbench workflows; close every DSH-assigned ledger item.
4. Run focused and full DSH/Core tests, build and inspect the tarball, force-install it into the local web profile, restart DSH, and execute real browser verification.
5. Commit and push `main`, switch safely to `archive/electron-before-dsh-plugin-20260826`, backport/adapt the Managed Skill identity changes, and run Electron focused/full tests.
6. Build, sign, install, and launch the Electron App; verify repaired Dataset behavior and record both distributions' final parity evidence.

Rollback keeps the previous DSH tarball/install metadata and previous Electron App available until verification completes. Git commits remain small and independently revertible. New snapshot/identity fields are additive or fail-closed; no rollback step deletes product data.

## Open Questions

None. The approved design fixes the owner surface, trusted evidence boundary, marker behavior, parity gate, package policy, branch order, and data-isolation rules.
