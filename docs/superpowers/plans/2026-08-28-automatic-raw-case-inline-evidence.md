# Automatic Raw Case Inline Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users read the exact source-conversation range of an automatically captured Raw Case inside the workbench without finding or opening the source conversation.

**Architecture:** Persist the already-classified Episode in a private content-addressed store for new candidates and add a read-only `rawCases.evidence` method. For legacy candidates, reconstruct the exact bounded Episode from trusted DSH session events or the recorded Runtime thread boundaries, then render the returned public Episode as a compact message timeline with collapsed tool details.

**Tech Stack:** Node.js CommonJS stores and services, SHA-256 content addressing, React 18, TypeScript, DSH Client UI primitives, CSS, Node test runner, esbuild.

---

### Task 1: Add the private content-addressed Episode store

**Files:**
- Create: `desktop/rolling-skill/src/automatic-capture-evidence-store.cjs`
- Create: `desktop/rolling-skill/test/automatic-capture-evidence-store.test.cjs`
- Modify: `packages/rolling-skill-core/src/data-root.cjs`

- [ ] Write failing tests that save a `rolling-skill-episode/v1`, assert a stable `rolling-skill-automatic-evidence-reference/v1` digest, verify deduplication and `0700`/`0600` permissions, and reject changed content or malformed references.
- [ ] Run `node --test desktop/rolling-skill/test/automatic-capture-evidence-store.test.cjs` and verify RED because the store does not exist.
- [ ] Implement stable JSON serialization, SHA-256 filenames, atomic private writes, validated reads, and the `raw-cases/evidence` data path.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Attach evidence references to new automatic candidates

**Files:**
- Modify: `desktop/rolling-skill/src/raw-case-store.cjs`
- Modify: `desktop/rolling-skill/test/raw-case-store.test.cjs`
- Modify: `desktop/rolling-skill/src/automatic-capture.cjs`
- Modify: `desktop/rolling-skill/test/automatic-capture.test.cjs`
- Modify: `packages/rolling-skill-core/src/automatic-capture-service.cjs`

- [ ] Add failing store tests that accept only a valid optional evidence reference while keeping legacy observations readable.
- [ ] Add a failing discovery test proving `saveEvidence(episode)` runs only after a candidate passes classification and its returned reference is stored on the observation.
- [ ] Run the focused raw-store and automatic-capture tests and verify RED.
- [ ] Add strict evidence-reference normalization, inject `saveEvidence` into `ConversationDiscoveryManager`, and attach the reference to the source passed to `addAutomaticCandidate`.
- [ ] Re-run both focused test files and verify GREEN.

### Task 3: Add exact legacy reconstruction and the read-only evidence API

**Files:**
- Modify: `packages/rolling-skill-dsh/src/host/session-evidence.cjs`
- Create: `packages/rolling-skill-dsh/test/session-evidence.test.cjs`
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`

- [ ] Add failing DSH tests for `readRange({sessionId,startSeq,endSeq})`, including direct-human start, completed Assistant end, and exclusion of events outside the range.
- [ ] Add failing application tests for snapshot reads, legacy DSH reads, legacy non-DSH `readThread` reconstruction, invalid boundaries, and `rawCases.evidence` remaining outside the mutation set.
- [ ] Run the focused DSH Host and Core application tests and verify RED.
- [ ] Implement DSH range reading, initialize the evidence store, pass `saveEvidence` into automatic capture, add `rawCases.evidence`, and extend `publicEpisode` with bounded tool status/result/error fields.
- [ ] Re-run the focused tests and verify GREEN.

### Task 4: Render the source range directly in Capture Evidence

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/RawCasesPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/raw-case-evidence.cjs`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/workbench.css`
- Modify: `packages/rolling-skill-dsh/test/raw-case-evidence.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] Add failing view-model and source-contract tests for evidence loading, message roles, start/end labels, collapsed tool details, retry, and removal of the instruction to open a source conversation.
- [ ] Run the focused Client tests and verify RED.
- [ ] Request `rawCases.evidence` only for automatic observations, render the bounded Episode timeline, retain current-session positioning as optional, move source IDs to advanced details, and add responsive theme-token styles.
- [ ] Re-run the focused Client tests and verify GREEN.

### Task 5: Regression, build, package, install, and real-page verification

**Files:**
- Modify: `packages/rolling-skill-dsh/package.json`
- Modify: `package-lock.json`
- Generated: `packages/rolling-skill-dsh/lib/client.js`
- Generated: `packages/rolling-skill-dsh/lib/index.js`
- Generated: `packages/rolling-skill-dsh/lib/worker.cjs`
- Generated: `rolling-skill-dsh-plugin-0.1.14.tgz`

- [ ] Run the new focused desktop tests plus `npm run test:dsh`; require zero failures.
- [ ] Bump the DSH plugin version from `0.1.13` to `0.1.14`, update the lockfile, run `npm run build:dsh`, pack, and inspect the archive.
- [ ] Install `0.1.14` into the local DSH profile and verify the installed Client and Host bundle hashes match the package.
- [ ] Reload the real DSH workbench, open an existing automatically captured Raw Case, and verify the source range appears without opening another conversation; verify tool details, retry state, modal scrolling, and browser console.
- [ ] Append test/build/package/browser evidence to requirement `20260828-171329`, then commit and push the external project record without reading historical requirement logs.
