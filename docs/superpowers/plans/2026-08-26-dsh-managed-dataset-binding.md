# DSH Managed Skill Dataset Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DSH/Core datasets bind a stable managed Skill identity, migrate uniquely provable legacy bindings without data loss, and resolve one verified installation per target Runtime when starting an evaluation.

**Architecture:** Add `managed` precision to the shared Skill reference domain and a trusted installation resolver to the installation store. Dataset creation accepts only managed repository/Skill IDs. Evaluation start accepts a Released version ID, resolves target-specific installation evidence in Core, and freezes the selected version plus each Runtime's destination into the run; the runner never reads a Runtime path from the Dataset.

**Tech Stack:** Node.js 22, CommonJS Core, React + TypeScript DSH client, `node:test`, esbuild, DeepSeek Harness plugin packaging.

---

## Task 1: Add stable managed Skill references and lossless legacy migration

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/test/local-store.test.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-store.test.cjs`

- [ ] **Step 1: Write failing managed-reference tests**

Cover validation, persistence, and identity equality:

```js
const managed = {
  schemaVersion: "rolling-skill-skill-reference/v1",
  evidencePrecision: "managed",
  id: "skill-a",
  repositoryId: "repo-a",
  name: "incident-response-planner",
  path: null,
  runtimeId: null,
  providerId: null,
}
const dataset = store.createDataset({name: "incidents", skillReference: managed})
assert.equal(dataset.skillReference.id, "skill-a")
assert.equal(dataset.skillReference.path, null)
```

Also assert managed references reject missing IDs and non-null Runtime/path fields, and that a display-name refresh with the same IDs preserves the active Rubric.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: FAIL because `managed` precision is not recognized.

- [ ] **Step 3: Implement the managed reference invariant**

Update `normalizeSkillReference()` so managed references require `id + repositoryId + name`, normalize all deployment fields to `null`, and reject mixed managed/path precision. Update `sameSkillReferenceIdentity()` to compare only `repositoryId + id` for managed references.

- [ ] **Step 4: Write a failing lossless migration test**

Create a Dataset with a legacy path reference, Cases, an active Published Rubric, a Curator Session, and a historical Evaluation Run. Call a new narrowly scoped migration API with the expected legacy identity and assert only `dataset.skillReference` changes:

```js
const before = store.read()
store.migrateDatasetSkillReference(dataset.id, {
  expectedLegacyReference: legacy,
  managedSkillReference: managed,
})
const after = store.read()
assert.deepEqual(after.datasets[0].activeRubricVersionId, before.datasets[0].activeRubricVersionId)
assert.deepEqual(after.cases, before.cases)
assert.deepEqual(after.evaluationRuns, before.evaluationRuns)
```

- [ ] **Step 5: Implement compare-and-swap migration and rerun tests**

The API must atomically verify the current legacy identity before replacing it, preserve all Dataset children, and reject name-only, stale, or already-different bindings. It must not reuse explicit `bindDatasetSkill()` semantics because an intentional rebind to another Skill still clears active Rubric.

Run: `node --test desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: PASS.

## Task 2: Resolve trustworthy Runtime installations

**Files:**
- Modify: `desktop/rolling-skill/src/skill-installation-store.cjs`
- Modify: `desktop/rolling-skill/test/skill-installation-store.test.cjs`

- [ ] **Step 1: Write failing resolver tests**

Cover exact `repositoryId + skillId + versionId + runtimeId + providerId` matching, newest-valid selection, incomplete/unverified record rejection, and conflict failure. The public result must include installation/job IDs, destination, commit, digest, Runtime, provider, and verification.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test desktop/rolling-skill/test/skill-installation-store.test.cjs`

Expected: FAIL because no exact verified-installation resolver exists.

- [ ] **Step 3: Implement read-only installation resolution**

Add `resolveVerifiedInstallation(input)` and a filtered read-only list used by migration. Only normal completed installations are eligible; optimization experiment Jobs and records with `verification: "none"` are excluded. Return frozen copies and fail closed on conflicting newest records.

- [ ] **Step 4: Add legacy-path unique matching**

Normalize both a destination directory and a `.../SKILL.md` inventory path to the Skill root. Match legacy bindings by Runtime, provider when present, normalized root, and Skill name. Return a result only when one managed identity remains after trustworthy-record filtering.

- [ ] **Step 5: Rerun tests and commit the reusable domain layer**

Run: `node --test desktop/rolling-skill/test/skill-installation-store.test.cjs desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs`

Expected: PASS.

```bash
git add desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/src/skill-installation-store.cjs desktop/rolling-skill/test/local-store.test.cjs desktop/rolling-skill/test/evaluation-store.test.cjs desktop/rolling-skill/test/skill-installation-store.test.cjs
git commit -m "feat: model datasets with managed skill identity"
```

## Task 3: Freeze target-specific installation evidence in evaluation runs

**Files:**
- Modify: `desktop/rolling-skill/src/local-store.cjs`
- Modify: `desktop/rolling-skill/src/evaluation-runner.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-runner.test.cjs`
- Modify: `desktop/rolling-skill/test/evaluation-skill-binding.test.cjs`
- Modify: `desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

- [ ] **Step 1: Write failing two-Runtime run tests**

Build a managed run whose two Runtime configurations use different destinations for the same version. Assert persisted configurations retain their own trusted Skill reference and installation evidence, and the runner passes each Runtime its own path.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test desktop/rolling-skill/test/evaluation-runner.test.cjs desktop/rolling-skill/test/evaluation-skill-binding.test.cjs desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

Expected: FAIL because the runner uses `run.skillReference.path` for all targets.

- [ ] **Step 3: Generalize managed evaluation snapshots**

Allow a trusted caller to create a normal managed run with a Released version snapshot, not only an optimization Candidate. Extend normalized Runtime configurations with internal target-specific fields:

```js
{
  runtimeId,
  providerId,
  modelId,
  effort,
  skillReference: runtimeInstalledReference,
  installationId,
  installationJobId,
  expectedContentDigest,
}
```

Keep Client-supplied paths outside this API boundary. Validate each configuration against the common managed snapshot IDs/digest.

- [ ] **Step 4: Make runner binding target-specific**

Use `configuration.skillReference` for inventory verification, execution input, trace evidence, and post-run checks. Keep Dataset `run.skillReference` as the managed identity. Existing optimization runs must continue to pass by populating the same per-Runtime configuration shape from experiment installation Jobs.

- [ ] **Step 5: Rerun focused tests**

Run: `node --test desktop/rolling-skill/test/evaluation-runner.test.cjs desktop/rolling-skill/test/evaluation-skill-binding.test.cjs desktop/rolling-skill/test/optimization-evaluation-binding.test.cjs`

Expected: PASS.

## Task 4: Enforce managed Dataset creation and evaluation version selection in Core

**Files:**
- Modify: `packages/rolling-skill-core/src/application.cjs`
- Modify: `packages/rolling-skill-core/src/evaluation-services.cjs`
- Modify: `packages/rolling-skill-core/src/operator-services.cjs`
- Modify: `packages/rolling-skill-core/test/application.test.cjs`
- Modify: `packages/rolling-skill-core/test/evaluation-services.test.cjs`
- Modify: `packages/rolling-skill-core/test/operator-services.test.cjs`

- [ ] **Step 1: Write failing Core API tests**

Assert `datasets.create` requires repository/Skill IDs, loads the canonical managed Skill, and stores no Runtime/path. Assert `evaluations.start` requires a Released `versionId`, rejects versions from another Skill, rejects missing Runtime installations, and creates per-target bindings from the trusted store.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs`

Expected: FAIL under the existing name-only Dataset and path snapshot behavior.

- [ ] **Step 3: Replace the default Dataset reference**

Change `datasets.create` input to `{name, repositoryId, skillId}`. Resolve IDs against `ManagedSkillStore`, construct managed precision server-side, and reject unknown/mismatched IDs. Do not accept a Client path, Runtime, provider, commit, or digest.

- [ ] **Step 4: Resolve Released version and installations in EvaluationService**

Validate `versionId` belongs to the Dataset Skill and is Released. For every target descriptor, call the exact verified-installation resolver; build target-specific configurations and one managed version snapshot from the frozen managed commit. Fail before creating a run when any target cannot be proven.

- [ ] **Step 5: Reconcile legacy Datasets at application startup**

For each legacy path Dataset, resolve one trustworthy managed identity and call the compare-and-swap migration API. Convert legacy refs that already carry full IDs directly. Leave name-only, missing, ambiguous, or conflicting entries untouched and surface them as requiring explicit binding.

- [ ] **Step 6: Preserve optimization evaluation behavior**

Update candidate-run creation to attach experiment Job destination/provider evidence per Runtime while continuing to validate Dataset and baseline by stable IDs.

- [ ] **Step 7: Rerun Core tests**

Run: `node --test packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs`

Expected: PASS.

## Task 5: Update DSH Dataset and Evaluation workbenches

**Files:**
- Modify: `packages/rolling-skill-dsh/src/client/workbench/DatasetsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/workbench/EvaluationsPanel.tsx`
- Modify: `packages/rolling-skill-dsh/src/client/locale.ts`
- Modify: `packages/rolling-skill-dsh/test/client-source.test.cjs`

- [ ] **Step 1: Write failing Client source contracts**

Assert Dataset creation loads Managed Skills and sends only `name + repositoryId + skillId`. Assert Evaluation loads versions, sends `versionId`, labels only Released versions selectable, and shows the selected version's target Runtime installation state.

- [ ] **Step 2: Run the Client test and confirm RED**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs`

Expected: FAIL because Dataset currently submits only a name and Evaluation has no version selector.

- [ ] **Step 3: Implement managed Dataset selection**

Load `skills.catalog`, render a required managed Skill selector, and keep deployment details out of the request. Render legacy/unbound Dataset state explicitly and offer a stable-ID rebind action where the existing Core API permits it.

- [ ] **Step 4: Implement Released version selection and Runtime status**

After Dataset selection, load versions for its Skill, default only when exactly one Released version is available, and add `versionId` to `evaluations.start`. Disable start for any selected target lacking a verified installation and show the install-required reason.

- [ ] **Step 5: Rerun the DSH Client and Core tests**

Run: `node --test packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-core/test/evaluation-services.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit DSH/Core integration**

```bash
git add desktop/rolling-skill/src/local-store.cjs desktop/rolling-skill/src/evaluation-runner.cjs desktop/rolling-skill/test packages/rolling-skill-core/src packages/rolling-skill-core/test packages/rolling-skill-dsh/src packages/rolling-skill-dsh/test/client-source.test.cjs
git commit -m "fix: bind DSH datasets to managed skills"
```

## Task 6: Verify, package, install, and inspect DSH

**Files:**
- Generated: `packages/rolling-skill-dsh/lib/*`
- Generated: `packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz`

- [ ] **Step 1: Run the complete DSH suite**

Run: `npm run test:dsh`

Expected: PASS with zero failed tests.

- [ ] **Step 2: Build and inspect the package**

Run: `npm run build:dsh`

Run: `npm pack --workspace @rolling-skill/dsh-plugin --pack-destination packages/rolling-skill-dsh/dist`

Run: `node packages/rolling-skill-dsh/scripts/inspect-package.mjs packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz`

Expected: the package contract passes and contains no repository-only source dependency.

- [ ] **Step 3: Install into the DSH web profile**

Run: `dsh plugin --profile web add ./packages/rolling-skill-dsh/dist/rolling-skill-dsh-plugin-0.1.0.tgz`

Restart only the existing DSH web process needed to load the new bundle; preserve `~/.dsh/rolling-skill` data.

- [ ] **Step 4: Inspect the real UI once**

At the existing Harness page, confirm Dataset creation selects a managed Skill without a Runtime path, Evaluation requires a Released version, target Runtime installation failures are explicit, and the migrated incident Dataset retains its Cases/Rubric while becoming optimization-eligible.

- [ ] **Step 5: Final verification and push main**

Run: `git diff --check`

Run: `git status --short`

Push the completed `main` commits only after the tests, package inspection, installation, and UI check are green. Leave the user-owned `openspec/config.yaml` untracked and untouched.
