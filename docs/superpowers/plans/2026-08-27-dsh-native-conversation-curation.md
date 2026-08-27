# DSH Native Conversation Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add trusted Case curation entry points and lifecycle coloring directly to finalized Assistant messages in the native DSH conversation without replacing DSH conversation renderers.

**Architecture:** A DSH Host adapter injected with `sessionQuery` re-reads and validates Session events, freezes an immutable evidence slice, derives an Episode, and calls a narrow Shared Core Curation entry. The React client sends durable IDs only, uses the additive `conversation.chat.assistant-actions` slot, and projects Host marker records onto stable native flow keys.

**Tech Stack:** TypeScript/React, Cordis/DSH slots, Node.js CommonJS, Shared Rolling Skill Core, `node:test`, JSON Host API.

---

## Task 1: Allow Curation to start from an already frozen Episode

**Files:**
- Modify: `desktop/rolling-skill/src/curation-manager.cjs`
- Modify: `desktop/rolling-skill/test/curation-manager.test.cjs`

- [ ] **Step 1: Write a failing frozen-evidence unit test**

Add a test that provides a complete immutable Episode and proves no Runtime thread reader is called:

```js
test("creates a curation session from trusted frozen evidence", async () => {
  const runtime = { readThread: () => assert.fail("must not read Runtime thread") };
  const result = await manager.createSessionFromFrozenEpisode({
    datasetId: "dataset-1",
    episode: frozenEpisode,
    source: { kind: "dsh-session", sessionId: "session-1", digest: "sha256:abc" },
    curator: { runtimeDescriptor: "codex/local", model: "gpt-5.6-sol", effort: "high" },
    idempotencyKey: "capture:session-1:42",
  });
  assert.equal(result.session.source.digest, "sha256:abc");
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test desktop/rolling-skill/test/curation-manager.test.cjs`

Expected: FAIL because `createSessionFromFrozenEpisode` does not exist.

- [ ] **Step 3: Add the trusted internal entry**

Implement a method that validates the frozen Episode, creates the Store record directly, preserves curator Runtime/model/effort metadata, and starts the initial curator turn. Keep `createSession` unchanged for Runtime-backed Electron capture.

```js
async createSessionFromFrozenEpisode(input) {
  const episode = validateFrozenEpisode(input.episode);
  return this.#createSessionRecord({
    ...input,
    episode,
    source: validateFrozenSource(input.source),
  });
}
```

Do not expose this method as a generic browser endpoint that accepts an arbitrary Episode.

- [ ] **Step 4: Cover idempotency and malformed evidence**

Assert that the same idempotency key returns the existing Session and that missing item IDs, invalid range metadata, or a digest mismatch fail before Store mutation.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test desktop/rolling-skill/test/curation-manager.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/curation-manager.cjs desktop/rolling-skill/test/curation-manager.test.cjs
git commit -m "feat: curate trusted frozen episodes"
```

## Task 2: Freeze trusted DSH Session evidence

**Files:**
- Create: `packages/rolling-skill-dsh/src/host/session-evidence.cjs`
- Create: `packages/rolling-skill-dsh/test/session-evidence.test.cjs`
- Modify: `packages/rolling-skill-core/src/data-root.cjs`
- Modify: `packages/rolling-skill-core/test/data-root.test.cjs`

- [ ] **Step 1: Write boundary and forgery tests**

Build a fake `sessionQuery` log containing Human, Assistant, tool, replacement, turn, and compaction events. Assert `inspect()` returns only valid Human start candidates and `capture()` rejects a Client-selected end that is not the finalized Assistant message.

```js
const source = createSessionEvidenceSource({ sessionQuery, traceRoot });
const inspection = await source.inspect({
  sessionId: "session-1",
  endMessageId: "assistant-2",
});
assert.deepEqual(inspection.startCandidates.map((item) => item.seq), [4, 12]);
await assert.rejects(
  source.capture({ sessionId: "session-1", startSeq: 5, endMessageId: "forged" }),
  /finalized Assistant boundary/,
);
```

- [ ] **Step 2: Run the new test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/session-evidence.test.cjs packages/rolling-skill-core/test/data-root.test.cjs`

Expected: FAIL because the evidence source and trace data path do not exist.

- [ ] **Step 3: Add a dedicated DSH trace snapshot root**

Extend the Core data-root result with a path under the existing trace root, for example `traces/dsh-conversations`, and retain all current paths unchanged.

- [ ] **Step 4: Implement inspection and capture**

`inspect()` must call `sessionQuery.readSession(sessionId)` and derive candidates from the full validated log. `capture()` must re-read the Session, validate both boundaries, include the complete event slice through the corresponding `turn/end`, ask `traceEvent` for replacement lineage where needed, canonicalize JSON, compute SHA-256, and atomically persist one immutable snapshot.

```js
const canonical = `${stableStringify(snapshot)}\n`;
const digest = `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
await writeFileAtomically(join(traceRoot, `${digest.slice(7)}.json`), canonical);
```

Do not accept message text, tool bodies, paths, commits, providers, or digests from the Client.

- [ ] **Step 5: Derive a deterministic Rolling Skill Episode**

Map source items to stable IDs such as `dsh:<sessionId>:<seq>`, preserve tool calls/results and usage, and attach only Host-derived source metadata:

```js
return {
  episode: { id: `dsh:${sessionId}:${startSeq}-${endSeq}`, items },
  source: { kind: "dsh-session", sessionId, startSeq, endSeq, endMessageId, digest, snapshotPath },
};
```

Resolve observed Skill usage from trusted tool events to managed Skill/Installation records; block ambiguous or unknown identity instead of binding the Dataset to a Runtime path.

- [ ] **Step 6: Exercise edge cases**

Add passing tests for hidden history, tool events, interruption exclusion, replacement lineage, repeated capture reuse, atomic-write recovery, and an older compacted Session whose boundary cannot be proven. The last case must return an explicit blocker.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/session-evidence.test.cjs packages/rolling-skill-core/test/data-root.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/host/session-evidence.cjs packages/rolling-skill-dsh/test/session-evidence.test.cjs packages/rolling-skill-core/src/data-root.cjs packages/rolling-skill-core/test/data-root.test.cjs
git commit -m "feat: freeze trusted DSH conversation evidence"
```

## Task 3: Add narrow conversation-curation application methods

**Files:**
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`

- [ ] **Step 1: Write failing dispatch and lifecycle-marker tests**

Configure `createRollingSkillApplication({ conversationEpisodeSource })` and assert these methods exist:

```js
await app.dispatch("conversationCuration.inspect", { sessionId, endMessageId });
await app.dispatch("conversationCuration.create", {
  sessionId, endMessageId, startSeq, datasetId, label: "good", note: "", idempotencyKey,
});
await app.dispatch("conversationCuration.markers", { sessionId });
```

Assert unknown fields are rejected and a second concurrent create with the same key returns the same Curation Session.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/local-store.test.cjs`

Expected: FAIL because the methods and marker projection are absent.

- [ ] **Step 3: Wire the trusted adapter behind strict methods**

`conversationCuration.inspect` and `.create` accept only durable boundary/selection IDs. `.create` calls the injected evidence source and then `createSessionFromFrozenEpisode`; it never forwards a Client-authored Episode.

- [ ] **Step 4: Derive lifecycle markers from persisted business records**

Return normalized marker records from Curation Sessions and saved Cases:

```js
{
  sessionId, startSeq, endSeq, endMessageId,
  curationSessionId, caseId: caseRecord?.id ?? null,
  status: caseRecord ? "saved" : "draft",
  digest,
}
```

Discard removes the Draft projection; save switches the same range to `saved`; deleting the Case removes the saved projection unless another record still owns that evidence digest.

- [ ] **Step 5: Add overlap, reload, and deletion coverage**

Test two overlapping ranges, archived Curation Sessions, Store reload, Case save/discard/delete, and filtering by Session ID. Results must be deterministic and must not depend on Client cache state.

- [ ] **Step 6: Run tests and commit**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/curation-manager.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-core/src/application.cjs packages/rolling-skill-core/test/application.test.cjs desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/test/local-store.test.cjs
git commit -m "feat: expose trusted conversation curation"
```

## Task 4: Inject DSH Session Query and expose the strict Host boundary

**Files:**
- Modify: `packages/rolling-skill-dsh/src/host/index.js`
- Modify: `packages/rolling-skill-dsh/src/host/api.cjs`
- Modify: `packages/rolling-skill-dsh/test/host-plugin.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/host-api.test.cjs`

- [ ] **Step 1: Write failing Host plugin tests**

Update the injection contract to expect `sessionQuery`, inject a fake validated Session service, and assert `/rolling-skill/api` can call the three conversation methods while still enforcing same-origin JSON, the 1 MiB request limit, and strict method names.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/host-plugin.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs`

Expected: FAIL because the Host does not inject or pass `sessionQuery`.

- [ ] **Step 3: Wire the evidence source into Core application creation**

```js
export const inject = ["webServer", "tools", "sessionQuery"];

const conversationEpisodeSource = createSessionEvidenceSource({
  sessionQuery: ctx.sessionQuery,
  traceRoot: dataPaths.dshConversationTraces,
  managedSkills: applicationServices.managedSkills,
  installations: applicationServices.installations,
});
```

Construct the Core application with the adapter. Keep the generic dispatch route and its existing allowlist/serialization behavior.

- [ ] **Step 4: Test hostile request shapes**

Reject supplied `episode`, `events`, `messages`, `snapshotPath`, `digest`, `runtimePath`, or installation evidence. Assert the Host re-reads Session data between inspect and create so a stale/changed boundary cannot be smuggled through.

- [ ] **Step 5: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/host-plugin.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs packages/rolling-skill-dsh/test/session-evidence.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/host/index.js packages/rolling-skill-dsh/src/host/api.cjs packages/rolling-skill-dsh/test/host-plugin.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs
git commit -m "feat: connect DSH session evidence"
```

## Task 5: Add the native Assistant-message capture action and quick dialog

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/conversation/CaseCaptureAction.tsx`
- Create: `packages/rolling-skill-dsh/src/client/conversation/CaseCaptureDialog.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/index.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/styles/workbench.css`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing source and interaction contracts**

Assert the Client registers exactly one additive `conversation.chat.assistant-actions` component, consumes its `{messageId}` owner prop plus the standard Session context, never registers `conversation.chat.node`, and sends only stable IDs.

- [ ] **Step 2: Run the Client test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because the conversation action is absent.

- [ ] **Step 3: Register the finalized-message action**

```tsx
ctx.slots.add({
  slot: "conversation.chat.assistant-actions",
  key: "rolling-skill-case-capture",
  component: CaseCaptureAction,
});
```

Render localized states for available, loading, Draft exists, Case saved, and blocked. Suppress duplicate submission while inspect/create is active.

- [ ] **Step 4: Implement the quick dialog**

On open, call `conversationCuration.inspect`. Present Host-derived Human start candidates, a managed Dataset selector, Good/Bad label, and optional note. Show blockers for unbound Dataset/Skill, ambiguous Installation, unprovable history, or stale Assistant boundary.

```ts
await api.call("conversationCuration.create", {
  sessionId,
  endMessageId: messageId,
  startSeq: selectedStartSeq,
  datasetId,
  label,
  note,
  idempotencyKey: `dsh:${sessionId}:${messageId}:${selectedStartSeq}:${datasetId}`,
});
```

After success, expose a “查看 Draft” action that opens the independent workbench at that Curation Session.

- [ ] **Step 5: Add keyboard, theme, and error-state coverage**

Verify focus trapping, Escape/Cancel, retry after network failure, dark/light theme tokens, narrow layout, and that user-entered note text is never inserted as HTML.

- [ ] **Step 6: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/conversation packages/rolling-skill-dsh/src/client/index.tsx packages/rolling-skill-dsh/src/client/styles/workbench.css packages/rolling-skill-dsh/test/client-source.test.cjs
git commit -m "feat: capture cases from DSH conversations"
```

## Task 6: Project Draft and saved-Case ranges onto native conversation rows

**Files:**
- Create: `packages/rolling-skill-dsh/src/client/conversation/curation-markers.ts`
- Create: `packages/rolling-skill-dsh/src/client/conversation/ConversationCurationMarkers.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/index.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/styles/workbench.css`
- Create: `packages/rolling-skill-dsh/test/conversation-markers.test.cjs`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing projection tests**

Provide a `ConversationSnapshot` with `chat.order`, `chat.nodes`, `anchorSeq`, and stable `key` values. Assert a Draft marks the exact inclusive range warning/yellow, a saved Case marks it success/green, overlap resolves predictably, and unrelated rows remain untouched.

```js
assert.deepEqual(
  projectMarkers(snapshot, [{ startSeq: 12, endSeq: 21, status: "draft" }]),
  new Map([["flow-12", "draft"], ["flow-18", "draft"], ["flow-21", "draft"]]),
);
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/conversation-markers.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because no projection/controller exists.

- [ ] **Step 3: Implement stable-key projection**

Fetch `conversationCuration.markers` for the current Session, map seq ranges through `ConversationSnapshot.chat.nodes`, and add scoped classes to rows selected by escaped `data-chat-flow-key`. Never modify message content or replace node renderers.

- [ ] **Step 4: Add lifecycle refresh and compatibility fallback**

Refresh after create/save/discard/delete and on Session change; include older loaded history. If a target node lacks a stable key, do not color a guessed row—show the action's terminal Draft/saved status and emit one compatibility diagnostic.

- [ ] **Step 5: Verify styling semantics**

Use DSH theme variables for warning/success background, border, and contrast. Saved Case wins over Draft for identical/overlapping cells; add a compact legend with accessible text so color is not the sole indicator.

- [ ] **Step 6: Run tests and commit**

Run: `node --test packages/rolling-skill-dsh/test/conversation-markers.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-core/test/application.test.cjs`

Expected: PASS.

```bash
git add packages/rolling-skill-dsh/src/client/conversation packages/rolling-skill-dsh/src/client/index.tsx packages/rolling-skill-dsh/src/client/styles/workbench.css packages/rolling-skill-dsh/test/conversation-markers.test.cjs packages/rolling-skill-dsh/test/client-source.test.cjs
git commit -m "feat: mark curated DSH conversation ranges"
```

## Task 7: Verify the native conversation loop end to end

- [ ] **Step 1: Run all DSH and Shared Core tests**

Run: `npm run test:dsh`

Expected: PASS with zero skipped/failing conversation-curation tests.

- [ ] **Step 2: Build the plugin**

Run: `npm run build:dsh`

Expected: Host, Client, Worker, manifest, and package inspection all succeed.

- [ ] **Step 3: Inspect the generated package**

Run the repository package inspection command documented by `packages/rolling-skill-dsh/package.json` and verify no Electron binary, Chromium, source map, credential, absolute path, or frozen Session payload is present.

- [ ] **Step 4: Preserve verification evidence**

Record exact test/build output and the affected parity IDs from `docs/superpowers/specs/2026-08-27-rolling-skill-surface-parity-ledger.md`. Defer real installed-browser acceptance until the independent workbench plan has built the final combined tarball.

- [ ] **Step 5: Check the working tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; `openspec/config.yaml` remains untracked and untouched.
