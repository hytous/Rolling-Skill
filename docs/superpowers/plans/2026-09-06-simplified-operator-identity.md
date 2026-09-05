# Simplified Operator Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user explicitly forbids subagent coding. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate Operator session identities so automatic optimization can submit and advance a verified candidate through the real control path.

**Architecture:** Allocate one persisted Operator session ID before issuing its capability. Use that ID in the capability grant, child Runtime environment, executor registration, control-plane invocation, optimization ownership, and resume flow. Capability, Job, Step, and Run IDs retain their separate authorization, audit, and state-machine roles.

**Tech Stack:** Node.js CommonJS, Electron, Zod contracts, `node:test`, esbuild DSH bundles, macOS codesigning and packaging.

---

### Task 1: Lock the single-identity contract with failing tests

**Files:**
- Modify: `desktop/rolling-skill/test/operator-job-store.test.cjs`
- Modify: `desktop/rolling-skill/test/operator-session-manager.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane.test.cjs`

- [x] Add a JobStore test proving a caller-supplied Operator session ID is persisted and duplicate allocation fails.
- [x] Add an OperatorSessionManager test proving persisted session, capability grant, child environment, executor registration, and tool invocation use one ID.
- [x] Add a resume assertion proving a new grant keeps the existing Operator session ID.
- [x] Update optimization submission tests to require `context.sessionId` and reject a spoofed `context.operatorSessionId` alias.
- [x] Add a real manager-to-control-plane optimization submission regression test without constructing the domain context by hand.
- [x] Run the focused tests and confirm they fail for the intended duplicate-identity reasons.

### Task 2: Allocate and propagate one Operator session ID

**Files:**
- Modify: `desktop/rolling-skill/src/operator/job-store.cjs`
- Modify: `desktop/rolling-skill/src/operator/operator-session-manager.cjs`

- [x] Let `OperatorJobStore.createSession()` accept an optional validated ID while preserving automatic UUID generation for old callers.
- [x] Allocate the real Operator session ID before capability issuance during session creation.
- [x] Issue capabilities with the real Operator session ID and validate the returned grant is bound to it.
- [x] Use the real session ID for the child Runtime environment, executor registration, and control-plane calls.
- [x] Issue resume capabilities for the existing persisted session ID.
- [x] Remove every `authoritySessionId` field and reference.
- [x] Run the JobStore and OperatorSessionManager suites and confirm they pass.

### Task 3: Remove the optimization identity alias

**Files:**
- Modify: `desktop/rolling-skill/src/optimization/optimization-control-service.cjs`
- Modify: `desktop/rolling-skill/test/optimization-control-service.test.cjs`
- Modify: `desktop/rolling-skill/test/control-plane.test.cjs`

- [x] Make candidate and decision submission use only the validated control-plane `context.sessionId`.
- [x] Remove reliance on `context.operatorSessionId` from implementation and fixtures.
- [x] Run focused optimization tests and confirm valid submissions advance while a mismatched real session is rejected.

### Task 4: Verify shared Desktop and DSH behavior

**Files:**
- Modify generated DSH outputs only when the repository build scripts produce tracked changes.

- [x] Search the repository to confirm no production `authoritySessionId` or optimization identity fallback remains.
- [x] Run focused Operator, control-plane, and optimization suites.
- [x] Run the complete Desktop and Core/DSH test suites.
- [x] Rebuild the standalone tool and DSH plugin bundles.
- [x] Run Electron renderer smoke and repository diff checks.

### Task 5: Package, install, and recover the real failed run

**Files:**
- Build artifact only; do not stage package archives.

- [x] Package and locally sign the macOS App.
- [x] Replace `/Applications/Rolling Skill.app` while retaining a recoverable backup.
- [x] Validate the installed signature and launch the installed App.
- [x] Resume optimization run `059dd835-8605-4263-9801-91283232d43c` from the App.
- [x] Verify the preserved candidate is submitted, `candidateArtifactId` becomes non-null, and the state machine advances beyond `editing` without manually editing or committing its workspace.

### Task 6: Commit and publish

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-simplified-operator-identity-design.md`
- Modify: `docs/superpowers/plans/2026-09-06-simplified-operator-identity.md`
- Modify: project-record repository outside this product repository.

- [ ] Update all plan checkboxes and append final verification to requirement `20260906-0301-simplify-operator-identity` without reading its history log.
- [ ] Stage only the intended source, tests, docs, and tracked generated outputs; assert that no `.tgz` file is staged.
- [ ] Commit and push `main` to `rolling-skill`.
- [ ] Synchronize the identical source tree to `git@github.com:hytous/Rolling-Skill.git` without force-pushing.
- [ ] Commit and push the final project record.
