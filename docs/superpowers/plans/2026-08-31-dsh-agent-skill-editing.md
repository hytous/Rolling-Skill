# DSH Agent Skill Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a resumable Agent conversation that edits an isolated managed Skill draft, shows a Host-computed Diff, and atomically applies and publishes the next patch version.

**Architecture:** A new persistent Skill Edit Store and isolated Workspace Manager own draft state and files. The existing Operator runtime is bound to a server-resolved edit workspace, while a Skill Edit Service exposes bounded Host methods and delegates the final selected-root commit plus release to ManagedSkillManager. The DSH Client adds a version-page entry and a large conversation/Diff modal.

**Tech Stack:** Node.js 22 CommonJS domain services, JSON stores, Git CLI through ManagedSkillGit, React 18 TypeScript DSH Client, node:test source and integration tests.

---

## File map

- Create desktop/rolling-skill/src/skill-edit-store.cjs: durable session state and revisions.
- Create desktop/rolling-skill/src/skill-edit-workspace.cjs: safe snapshot copy, isolated Git baseline, Diff, validation and cleanup.
- Create packages/rolling-skill-core/src/skill-edit-services.cjs: public DTOs, Operator orchestration and apply/discard lifecycle.
- Create packages/rolling-skill-dsh/src/client/workbench/SkillEditModal.tsx: Runtime configuration, chat, Diff and apply UI.
- Create corresponding store, workspace, service and Client tests.
- Modify data-root, managed Git/manager, Operator binding, application dispatch, version UI, CSS, locale and package artifacts.

### Task 1: Durable Skill Edit state and data layout

**Files:**
- Create: desktop/rolling-skill/src/skill-edit-store.cjs
- Create: desktop/rolling-skill/test/skill-edit-store.test.cjs
- Modify: packages/rolling-skill-core/src/data-root.cjs
- Test: packages/rolling-skill-core/test/data-root.test.cjs

- [ ] **Step 1: Write failing store and data-root tests**

~~~js
it("persists one active edit per Skill with revision checks", () => {
    const store = new SkillEditStore(join(root, "skill-edits.json"))
    const created = store.create({
        repositoryId: "repository-1",
        skillId: "skill-1",
        skillRoot: ".",
        baseCommit: "a".repeat(40),
        baseContentDigest: "sha256:" + "b".repeat(64),
        baseSnapshotDigest: "sha256:" + "c".repeat(64),
        workspacePath: join(root, "workspaces", "edit-1"),
        runtime: {runtimeId: "codex:one", modelId: "gpt-5.6-sol", effort: "high"},
    })
    assert.equal(created.state, "draft")
    assert.throws(() => store.create(input), /active edit session/iu)
    assert.throws(() => store.update(created.id, 99, {state: "idle"}), /revision/iu)
})

assert.equal(paths.skillEdits, join(root, "jobs", "skill-edits.json"))
assert.equal(paths.skillEditWorkspaces, join(root, "skill-edit-workspaces"))
~~~

- [ ] **Step 2: Run tests and verify missing modules and paths fail**

Run: node --test desktop/rolling-skill/test/skill-edit-store.test.cjs packages/rolling-skill-core/test/data-root.test.cjs

Expected: FAIL because SkillEditStore and the two data paths do not exist.

- [ ] **Step 3: Implement the store and layout**

The store exposes create, get, list, activeForSkill, update and close. Persist schema rolling-skill-skill-edits/v1 through an owner-only temporary file rename. Every mutation increments revision and enforces:

~~~js
const ACTIVE_STATES = new Set(["draft", "running", "idle", "applying", "needs_recovery"])

update(id, expectedRevision, patch) {
    const current = this.require(id)
    if (current.revision !== expectedRevision) {
        throw Object.assign(new Error("Skill edit changed since it was loaded"), {
            code: "RESOURCE_CHANGED",
        })
    }
    return this.persistValidatedPatch(current, patch)
}
~~~

Add skillEdits and skillEditWorkspaces to resolveDataPaths and create the workspace directory with mode 0700.

- [ ] **Step 4: Run focused tests**

Run: node --test desktop/rolling-skill/test/skill-edit-store.test.cjs packages/rolling-skill-core/test/data-root.test.cjs

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add desktop/rolling-skill/src/skill-edit-store.cjs desktop/rolling-skill/test/skill-edit-store.test.cjs packages/rolling-skill-core/src/data-root.cjs packages/rolling-skill-core/test/data-root.test.cjs
git commit -m "feat: persist Skill edit sessions"
~~~

### Task 2: Isolated Skill workspace and structured Diff

**Files:**
- Create: desktop/rolling-skill/src/skill-edit-workspace.cjs
- Create: desktop/rolling-skill/test/skill-edit-workspace.test.cjs
- Modify: desktop/rolling-skill/src/managed-skill-git.cjs
- Test: desktop/rolling-skill/test/managed-skill-git.test.cjs

- [ ] **Step 1: Write failing workspace tests**

~~~js
it("copies only the selected Skill and computes bounded file diffs", async () => {
    const created = await manager.create({
        sessionId: "edit-1",
        sourceRoot: join(repository, "skills", "one"),
    })
    assert.equal(existsSync(join(created.workspacePath, "SKILL.md")), true)
    assert.equal(existsSync(join(created.workspacePath, "..", "two")), false)
    writeFileSync(join(created.workspacePath, "SKILL.md"), changedManifest)
    writeFileSync(join(created.workspacePath, "new.txt"), "new")
    const diff = await manager.diff("edit-1")
    assert.deepEqual(diff.files.map(({path, status}) => [path, status]), [
        ["SKILL.md", "modified"],
        ["new.txt", "added"],
    ])
    assert.equal(diff.changed, true)
})

it("rejects escaped symlinks and special files", () => {
    assert.throws(() => manager.create(escapedFixture), /outside|unsupported/iu)
})
~~~

- [ ] **Step 2: Run the tests and verify failure**

Run: node --test desktop/rolling-skill/test/skill-edit-workspace.test.cjs desktop/rolling-skill/test/managed-skill-git.test.cjs

Expected: FAIL because SkillEditWorkspaceManager and Diff helpers are absent.

- [ ] **Step 3: Implement safe snapshot copy and baseline Git**

~~~js
async create({sessionId, sourceRoot}) {
    const workspacePath = this.workspacePath(sessionId)
    copyValidatedSkillTree(sourceRoot, workspacePath, this.scanLimits)
    await this.git.initialize(workspacePath)
    await this.git.commitAll(workspacePath, "Rolling Skill edit baseline", {forcePaths: ["."]})
    const snapshot = snapshotManagedSkill(workspacePath, this.scanLimits)
    this.workspaces.set(sessionId, {workspacePath, baselineDigest: snapshot.digest})
    return {workspacePath, baselineDigest: snapshot.digest}
}
~~~

Diff adds intent-to-add entries for untracked files, parses name-status, detects binary numstat, and returns per-file bounded patches plus current snapshot digest. It never returns workspacePath.

- [ ] **Step 4: Add selected-path Git primitives**

Add commitPaths(repositoryPath, message, paths), softReset(repositoryPath, commit), and resetPaths(repositoryPath, commit, paths) to ManagedSkillGit. commitPaths stages and commits only normalized selected paths and leaves unrelated repository changes untouched.

- [ ] **Step 5: Run focused tests**

Run: node --test desktop/rolling-skill/test/skill-edit-workspace.test.cjs desktop/rolling-skill/test/managed-skill-git.test.cjs

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add desktop/rolling-skill/src/skill-edit-workspace.cjs desktop/rolling-skill/test/skill-edit-workspace.test.cjs desktop/rolling-skill/src/managed-skill-git.cjs desktop/rolling-skill/test/managed-skill-git.test.cjs
git commit -m "feat: add isolated Skill edit workspaces"
~~~

### Task 3: Selected-root apply and automatic patch release

**Files:**
- Modify: desktop/rolling-skill/src/managed-skill-manager.cjs
- Test: desktop/rolling-skill/test/managed-skill-manager.test.cjs

- [ ] **Step 1: Write failing manager tests**

~~~js
it("applies one edited Skill and releases the next patch without committing siblings", async () => {
    const result = await manager.applyEditedSkill({
        skillId: skillOne.id,
        sourceRoot: editWorkspace,
        expectedBase,
        message: "Agent edit",
    })
    assert.equal(result.version.versionLabel, "1.0.1")
    assert.equal(result.version.state, "released")
    assert.equal(readFileSync(join(repository, "skills/two/local.txt"), "utf8"), "uncommitted")
    assert.equal((await git.status(repository)).entries.some((entry) => entry.includes("skills/two")), true)
})

it("restores files and metadata when release fails", async () => {
    await assert.rejects(() => failingManager.applyEditedSkill(input), /release failed/iu)
    assert.equal(snapshotManagedSkill(skillRoot).digest, expectedBase.contentDigest)
    assert.equal(store.listVersions(skill.id).length, versionCount)
})
~~~

- [ ] **Step 2: Run the failing manager tests**

Run: node --test --test-name-pattern="applies one edited Skill|restores files" desktop/rolling-skill/test/managed-skill-manager.test.cjs

Expected: FAIL because applyEditedSkill is undefined.

- [ ] **Step 3: Implement automatic version selection**

~~~js
function nextPatchVersion(versions) {
    const used = new Set(versions.map((entry) => entry.versionLabel).filter(Boolean))
    const stable = [...used].flatMap((label) => {
        const match = String(label).match(/^(\d+)\.(\d+)\.(\d+)$/u)
        return match ? [[Number(match[1]), Number(match[2]), Number(match[3])]] : []
    }).sort(compareSemver)
    let [major, minor, patch] = stable.at(-1) ?? [1, 0, -1]
    let candidate
    do {
        patch += 1
        candidate = [major, minor, patch].join(".")
    } while (used.has(candidate))
    return candidate
}
~~~

- [ ] **Step 4: Implement applyEditedSkill**

Inside the manager queue, verify expected base, validate the source Skill identity, back up the selected root, sync only that root, call git.commitPaths, create the release tag, and add plus release the Candidate in one ManagedSkillStore transaction. On failure, delete the tag, soft-reset HEAD, restore the backup and reset only the selected path. Do not expose a partial Candidate.

- [ ] **Step 5: Run manager and store tests**

Run: node --test desktop/rolling-skill/test/managed-skill-manager.test.cjs desktop/rolling-skill/test/managed-skill-store.test.cjs

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add desktop/rolling-skill/src/managed-skill-manager.cjs desktop/rolling-skill/test/managed-skill-manager.test.cjs
git commit -m "feat: apply and publish Agent Skill edits"
~~~

### Task 4: Bind Operator sessions to edit workspaces

**Files:**
- Modify: desktop/rolling-skill/src/operator/operator-session-manager.cjs
- Modify: desktop/rolling-skill/test/operator-session-manager.test.cjs
- Modify: packages/rolling-skill-core/src/operator-services.cjs
- Test: packages/rolling-skill-core/test/operator-services.test.cjs

- [ ] **Step 1: Write failing binding tests**

~~~js
await manager.create({
    ...operatorInput,
    managedSkillBinding: {
        repositoryId: "repository-1",
        skillId: "skill-1",
        skillEditSessionId: "edit-1",
    },
})
assert.equal(resolvedBinding.skillEditSessionId, "edit-1")
assert.equal(runtimeClientOptions.workspaceRoot, "/private/edit-workspaces/edit-1")
~~~

- [ ] **Step 2: Run the tests and verify failure**

Run: node --test --test-name-pattern="Skill edit" desktop/rolling-skill/test/operator-session-manager.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs

Expected: FAIL because skillEditSessionId is rejected.

- [ ] **Step 3: Extend managed binding validation**

Allow exactly one optional specialization: optimizationRunId or skillEditSessionId. Persist the chosen ID with workspaceDigest and require the resolver result to echo the same specialization.

~~~js
if (binding.optimizationRunId && binding.skillEditSessionId) {
    throw new TypeError("Managed Skill binding cannot select two workspaces")
}
~~~

- [ ] **Step 4: Extend createOperatorRuntime**

Accept resolveSkillEditWorkspace. In resolveManagedWorkspace, resolve skillEditSessionId before optimizationRunId, validate repositoryId and skillId, then return the isolated workspaceRoot. Preserve the existing default managed repository behavior.

- [ ] **Step 5: Run focused Operator tests**

Run: node --test desktop/rolling-skill/test/operator-session-manager.test.cjs packages/rolling-skill-core/test/operator-services.test.cjs

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add desktop/rolling-skill/src/operator/operator-session-manager.cjs desktop/rolling-skill/test/operator-session-manager.test.cjs packages/rolling-skill-core/src/operator-services.cjs packages/rolling-skill-core/test/operator-services.test.cjs
git commit -m "feat: bind Operators to Skill edit drafts"
~~~

### Task 5: Skill Edit application service and Host methods

**Files:**
- Create: packages/rolling-skill-core/src/skill-edit-services.cjs
- Create: packages/rolling-skill-core/test/skill-edit-services.test.cjs
- Modify: packages/rolling-skill-core/src/application.cjs
- Modify: packages/rolling-skill-core/src/skill-services.cjs
- Test: packages/rolling-skill-core/test/application.test.cjs

- [ ] **Step 1: Write failing service tests**

~~~js
it("starts, continues, diffs, applies and discards a bounded edit session", async () => {
    const started = await services.start({
        skillId: "skill-1",
        runtimeId: "codex:one",
        modelId: "gpt-5.6-sol",
        effort: "high",
        objective: "Improve trigger guidance",
    })
    assert.equal(started.skillId, "skill-1")
    await services.send({sessionId: started.id, text: "Also add an example"})
    assert.equal((await services.diff({sessionId: started.id})).changed, true)
    const applied = await services.applyAndRelease({
        sessionId: started.id,
        expectedRevision: started.revision,
    })
    assert.equal(applied.publishedVersionLabel, "1.0.1")
    assert.doesNotMatch(JSON.stringify(applied), /workspacePath|capability|executablePath/iu)
})
~~~

- [ ] **Step 2: Run tests and verify missing service failure**

Run: node --test packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-core/test/application.test.cjs

Expected: FAIL because skill-edit-services and Host methods do not exist.

- [ ] **Step 3: Implement createSkillEditServices**

The service validates exact fields and returns bounded public DTOs. start creates the store record and workspace, then starts an Operator with:

~~~js
{
  actions: ["skills.read"],
  scopes: {
    repositoryIds: [repositoryId],
    skillIds: [skillId],
    runtimeIds: [runtimeId],
    datasetIds: [],
  },
  managedSkillBinding: {repositoryId, skillId, skillEditSessionId: edit.id},
  budget: {
    maxDurationMs: 60 * 60 * 1000,
    maxRuntimeTurns: 100,
    maxEvaluations: 0,
    maxTargetExecutions: 0,
    maxJudgeExecutions: 0,
    maxTokens: null,
    maxReportedCost: null,
  }
}
~~~

get merges the edit record, public Operator transcript/status and current Diff. send delegates to operatorSend. applyAndRelease refuses a running Operator, calls manager.applyEditedSkill, stores the published result and cleans the workspace. discard stops a live Operator before cleanup.

- [ ] **Step 4: Add Skill path service**

Add skillServices.path({skillId}) returning {skillId, path} from a manager method that validates the resolved path remains inside the managed repository root.

- [ ] **Step 5: Register construction and dispatch**

Construct SkillEditStore and SkillEditWorkspaceManager before createOperatorRuntime, pass resolveSkillEditWorkspace, then construct the service. Register skillEdits.list/start/get/send/diff/applyAndRelease/discard and skills.path. Add writes to the mutation set and close the store/service.

- [ ] **Step 6: Run Core tests**

Run: node --test packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-core/test/data-root.test.cjs

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/rolling-skill-core/src/skill-edit-services.cjs packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-core/src/application.cjs packages/rolling-skill-core/src/skill-services.cjs packages/rolling-skill-core/test/application.test.cjs
git commit -m "feat: expose Agent Skill edit workflow"
~~~

### Task 6: DSH Agent edit modal and version-page actions

**Files:**
- Create: packages/rolling-skill-dsh/src/client/workbench/SkillEditModal.tsx
- Modify: packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx
- Modify: packages/rolling-skill-dsh/src/client/workbench/workbench.css
- Modify: packages/rolling-skill-dsh/src/client/locale.ts
- Test: packages/rolling-skill-dsh/test/client-source.test.cjs

- [ ] **Step 1: Write failing Client source assertions**

~~~js
assert.match(skills, /skills\.path/u)
assert.match(skills, /<SkillEditModal/u)
assert.match(modal, /skillEdits\.start/u)
assert.match(modal, /skillEdits\.send/u)
assert.match(modal, /skillEdits\.applyAndRelease/u)
assert.match(modal, /skillEdits\.discard/u)
assert.match(modal, /<RuntimeSelect/u)
assert.match(modal, /<ModelEffortSelect/u)
assert.match(locale, /agentEditSkill:\s*"让 Agent 编辑"/u)
assert.match(locale, /applyAndPublish:\s*"应用修改并发布"/u)
~~~

- [ ] **Step 2: Run the focused source test and verify failure**

Run: node --test --test-name-pattern="Agent Skill editing" packages/rolling-skill-dsh/test/client-source.test.cjs

Expected: FAIL because the modal and locale keys do not exist.

- [ ] **Step 3: Implement SkillEditModal**

The component loads runtimes and the active edit, remembers the last valid Runtime/model/effort selection in localStorage, polls nonterminal sessions every 1.5 seconds, renders readable chat and per-file Diff, and includes RuntimeInteractions for Operator prompts.

~~~tsx
<Modal open={open} onClose={onClose} title={t("agentEditSkill")} closeLabel={t("close")}>
  {session ? <SkillEditConversationAndDiff session={session}/> : <SkillEditConfiguration/>}
  <RuntimeInteractions t={t} ownerKind="operator"/>
  <div className="rolling-skill-skill-edit-actions">
    <Button onClick={discard}>{t("discardChanges")}</Button>
    <Button tone="primary" disabled={!canApply} onClick={applyAndRelease}>
      {t("applyAndPublish")}
    </Button>
  </div>
</Modal>
~~~

- [ ] **Step 4: Integrate version page actions**

Load skills.path and skillEdits.list with the selected Skill. Show “让 Agent 编辑” or “继续 Agent 编辑”, “打开受管 Skill 文件夹”, the path and “复制路径” in the header. Copy only after the explicit user click.

- [ ] **Step 5: Add responsive styling and translations**

Use a two-column chat/Diff layout above 960 px and a stacked layout below it. Set min-width: 0, overflow-wrap: anywhere and bounded scroll areas so controls cannot overlap.

- [ ] **Step 6: Run Client tests and build**

Run: node --test packages/rolling-skill-dsh/test/client-source.test.cjs

Run: npm run build:dsh

Expected: PASS and TypeScript bundle succeeds.

- [ ] **Step 7: Commit**

~~~bash
git add packages/rolling-skill-dsh/src/client/workbench/SkillEditModal.tsx packages/rolling-skill-dsh/src/client/workbench/SkillsPanel.tsx packages/rolling-skill-dsh/src/client/workbench/workbench.css packages/rolling-skill-dsh/src/client/locale.ts packages/rolling-skill-dsh/test/client-source.test.cjs packages/rolling-skill-dsh/lib/client.js
git commit -m "feat: add Agent Skill editing dialog"
~~~

### Task 7: Recovery, conflict and security regressions

**Files:**
- Modify: desktop/rolling-skill/test/skill-edit-workspace.test.cjs
- Modify: packages/rolling-skill-core/test/skill-edit-services.test.cjs
- Modify: packages/rolling-skill-core/test/application.test.cjs
- Modify: packages/rolling-skill-dsh/test/host-api.test.cjs

- [ ] **Step 1: Add failing conflict and restart tests**

Cover external selected-Skill changes returning RESOURCE_CHANGED without mutation, missing workspace returning needs_recovery, running Turn blocking apply, duplicate apply idempotency, out-of-root files, DTO path redaction, and no installation Job after publish.

~~~js
await assert.rejects(
    () => services.applyAndRelease({sessionId, expectedRevision}),
    (error) => error.code === "RESOURCE_CHANGED",
)
assert.equal(snapshotManagedSkill(managedRoot).digest, externallyChangedDigest)
assert.equal(installationStore.listJobs().length, 0)
~~~

- [ ] **Step 2: Run tests and confirm intended failures**

Run: node --test desktop/rolling-skill/test/skill-edit-workspace.test.cjs packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs

Expected: FAIL on missing recovery/conflict behavior, not syntax or fixture errors.

- [ ] **Step 3: Implement recovery and public error mapping**

On service construction, reconcile nonterminal records with existing workspaces and Operator sessions. Convert absent or inconsistent workspaces to needs_recovery. Preserve RESOURCE_CHANGED and NO_CHANGES codes through the same-origin API public error allowlist without exposing internal paths or causes.

- [ ] **Step 4: Run focused recovery tests**

Run: node --test desktop/rolling-skill/test/skill-edit-workspace.test.cjs packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add desktop/rolling-skill/test/skill-edit-workspace.test.cjs packages/rolling-skill-core/test/skill-edit-services.test.cjs packages/rolling-skill-core/test/application.test.cjs packages/rolling-skill-dsh/test/host-api.test.cjs packages/rolling-skill-core/src/skill-edit-services.cjs
git commit -m "test: harden Agent Skill edit recovery"
~~~

### Task 8: Version, package, install and real DSH verification

**Files:**
- Modify: packages/rolling-skill-dsh/package.json
- Modify: package-lock.json
- Modify: packages/rolling-skill-dsh/test/package-manifest.test.cjs
- Regenerate: packages/rolling-skill-dsh/lib/client.js
- Regenerate: packages/rolling-skill-dsh/lib/index.js
- Regenerate: packages/rolling-skill-dsh/lib/worker.cjs

- [ ] **Step 1: Bump the plugin to 0.1.23 and update manifest expectations**

Update package.json, package-lock.json and package-manifest.test.cjs to 0.1.23.

- [ ] **Step 2: Run the full build and regression suite**

Run: npm run build:dsh

Run: npm run test:dsh

Expected: all existing and new tests pass.

- [ ] **Step 3: Inspect and pack**

Run: npm pack --workspace @rolling-skill/dsh-plugin --pack-destination .

Run: node packages/rolling-skill-dsh/scripts/inspect-package.mjs rolling-skill-dsh-plugin-0.1.23.tgz

Expected: six allowlisted files, no source map, developer path, credential or Electron artifact.

- [ ] **Step 4: Install and restart the exact DSH process**

Remove the installed Rolling Skill plugin, add the absolute 0.1.23 tgz, stop only the exact DSH server PID bound to port 3080, and restart the same command. Confirm HTTP 200 and compare SHA-256 for built and installed lib/client.js.

- [ ] **Step 5: Verify the live UI**

Open the local DSH workbench. Confirm path display/copy, Runtime/model/effort selection, Agent edit start/resume, chat, Diff, disabled apply with no changes, automatic patch release after a controlled test edit, no installation Job and no console errors.

- [ ] **Step 6: Final commit**

~~~bash
git add package-lock.json packages/rolling-skill-dsh/package.json packages/rolling-skill-dsh/test/package-manifest.test.cjs packages/rolling-skill-dsh/lib
git commit -m "build: package Agent Skill editing"
~~~
