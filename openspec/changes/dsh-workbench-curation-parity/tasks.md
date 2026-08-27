## 1. Parity and managed-identity foundation

- [ ] 1.1 Add the machine-readable 136-ID parity manifest and tests that map exact Electron Renderer, Preload, Main/Core, DSH Tool, and test-name inventories without changing user behavior
- [ ] 1.2 Add failing cross-surface tests for pathless Dataset identity, trusted legacy reconciliation, and operation-scoped Version/Installation evidence
- [ ] 1.3 Complete Shared Core identity/evidence services and make all focused and existing identity tests pass

## 2. Trusted DSH conversation evidence

- [ ] 2.1 Add failing tests for `sessionQuery` boundary inspection, complete raw-event slicing, replacement lineage, digesting, and forged-boundary rejection
- [ ] 2.2 Implement the DSH frozen trace snapshot store and trusted Episode adapter without accepting Client-authored message bodies or paths
- [ ] 2.3 Add strict, serialized, idempotent conversation inspection/create/marker application methods and their Host API tests
- [ ] 2.4 Add failing and passing tests for Curation creation from frozen DSH evidence, retry reuse, and lifecycle marker projection records

## 3. Native conversation extension

- [ ] 3.1 Register the finalized-message `conversation.chat.assistant-actions` entry with localized status and duplicate protection tests
- [ ] 3.2 Implement the quick curation dialog, Host-derived start candidates, Dataset/Good-Bad/note fields, blockers, and Draft navigation
- [ ] 3.3 Implement theme-aware warning/success source-range markers on stable DSH flow keys with overlap, reload, older-history, discard, save, and delete tests
- [ ] 3.4 Run focused Core/Host/Client tests and manually verify the conversation action and marker compatibility fallback

## 4. Independent workbench and missing business loops

- [ ] 4.1 Register the additive sidebar launcher and move the full workbench out of Settings while preserving the native conversation state
- [ ] 4.2 Split the workbench shell into focused navigation/state modules and migrate existing Overview, Dataset/Case/Raw Case, Skill, Evaluation, Automatic, Operator, Optimization, and Import panels
- [ ] 4.3 Expose strict Curation and Rubric list/get/create/send/retry/model/effort/save-publish/discard APIs with mutation and stale-evidence tests
- [ ] 4.4 Implement Inbox/Drafts and Curation review UI including archived Sessions, frozen evidence, live activity, last-valid Draft, retry, save, and discard
- [ ] 4.5 Implement Dataset Rubric active/history, Agent review, publish, legacy migration, and post-publish calibration UI
- [ ] 4.6 Close Raw Case dispatch, Case recycle/refresh/batch, Installation question/permission, Evaluation detail, Operator approval/artifact, Optimization recovery, Settings, and diagnostic gaps assigned by the ledger

## 5. DSH parity, package, and installed UI verification

- [ ] 5.1 Backfill implementation, automated-test, and UI-evidence references for every DSH-assigned ledger ID and make the parity contract report zero gaps
- [ ] 5.2 Run focused tests, `npm run test:dsh`, and the relevant full Shared Core/Desktop suites; resolve every failure without skipping tests
- [ ] 5.3 Build the DSH package, inspect prohibited contents and size report, and verify manifest/Host/Client/Worker/uninstall contracts
- [ ] 5.4 Force-install the exact new tarball into the local web profile, restart DSH, and verify launcher, Settings, conversation curation, markers, Draft, Rubric, and all workbench families in the real browser
- [ ] 5.5 Commit and push verified `main` while preserving the untracked `openspec/config.yaml` and local product data

## 6. Electron managed-identity backport and App delivery

- [ ] 6.1 Switch safely to `archive/electron-before-dsh-plugin-20260826` and add failing Store/Installation/Evaluation tests for the approved managed-identity contract
- [ ] 6.2 Backport or adapt the pathless Dataset and frozen operation-evidence implementation without importing DSH frontend or data-root code
- [ ] 6.3 Run focused and complete Electron tests, renderer smoke, and parity checks for every Electron-assigned ledger ID
- [ ] 6.4 Build the macOS App and adjacent CLI, verify package contents and signature, install it, launch it, and inspect the repaired Dataset/Skill/Case workflows
- [ ] 6.5 Commit and push the Electron archive branch while preserving the previous App as rollback and all user data

## 7. Final verification and archive

- [ ] 7.1 Produce the zero-gap 136-ID parity report with both distribution versions, test commands, package/signature results, real UI evidence, and approved differences
- [ ] 7.2 Update README/design delivery notes and the external project record without copying private logs into the repository
- [ ] 7.3 Run `openspec validate dsh-workbench-curation-parity --json`, mark every completed task, and archive the OpenSpec change only after both installed artifacts pass
