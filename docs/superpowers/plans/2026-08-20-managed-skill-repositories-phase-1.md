# Managed Skill Repositories Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local managed-repository core so Rolling Skill can safely import ZIP, folder, local Git, and Git URL sources, discover one or more Skills, create immutable Candidate versions, publish Released versions, and inspect them in a third Skill Management surface.

**Architecture:** Keep Skill repository state outside the evaluation store in a private `skill-registry.json`, with managed Git repositories under Application Support. Focused scanner, snapshot, archive, Git, store, and manager modules run only in Electron's main process; renderer IPC accepts stable IDs and source intent, never arbitrary destination paths. Phase 1 ends at repository/version management and does not install into Runtime roots.

**Tech Stack:** Electron 43, Node.js CommonJS, `node:test`, Git CLI through `execFile`, `yaml` for frontmatter, `yauzl` for bounded ZIP extraction, HTML/CSS/vanilla JavaScript renderer.

---

## File map

Create:

- `desktop/rolling-skill/src/managed-skill-snapshot.cjs`: safe traversal, discovery, validation, digest.
- `desktop/rolling-skill/src/managed-skill-store.cjs`: private atomic JSON registry.
- `desktop/rolling-skill/src/managed-skill-archive.cjs`: bounded ZIP extraction.
- `desktop/rolling-skill/src/managed-skill-git.cjs`: non-shell Git operations.
- `desktop/rolling-skill/src/managed-skill-manager.cjs`: imports and version lifecycle.
- Matching `desktop/rolling-skill/test/managed-skill-*.test.cjs` files.

Modify:

- `desktop/rolling-skill/package.json` and `package-lock.json`: add `yaml` and `yauzl`.
- `desktop/rolling-skill/src/main.cjs` and `src/preload.cjs`: main-process ownership and IPC.
- `desktop/rolling-skill/renderer/index.html`, `renderer.js`, and `styles.css`: third main surface.
- `desktop/rolling-skill/test/main-bridge.test.cjs` and `local-first-surface.test.cjs`.
- `desktop/rolling-skill/scripts/renderer-smoke*.cjs` and `README.md`.

Existing integration files already contain unrelated uncommitted work. Never stage those whole files. New isolated modules/tests may be committed independently; integration changes stay in the worktree unless only the new hunks can be staged safely.

### Task 1: Safe Skill discovery and deterministic snapshots

**Files:**
- Create: `desktop/rolling-skill/test/managed-skill-snapshot.test.cjs`
- Create: `desktop/rolling-skill/src/managed-skill-snapshot.cjs`
- Modify: `desktop/rolling-skill/package.json`
- Modify: `desktop/rolling-skill/package-lock.json`

- [ ] **Step 1: Install dependencies**

Run `npm install --save yaml yauzl && npm install --save-dev yazl` from `desktop/rolling-skill`. `yazl` is test-fixture-only; production extraction uses `yauzl`.

Expected: npm exits 0 and preserves existing dependencies.

- [ ] **Step 2: Write the failing tests**

Use this public API and assertions:

```js
const {
    scanManagedSkillRepository,
    snapshotManagedSkill,
} = require("../src/managed-skill-snapshot.cjs")

it("discovers every SKILL.md", () => {
    const root = fixtureRepository({
        "skills/one/SKILL.md": "---\\nname: one\\ndescription: First Skill\\n---\\n",
        "skills/two/SKILL.md": "---\\nname: two\\ndescription: Second Skill\\n---\\n",
    })
    assert.deepEqual(
        scanManagedSkillRepository(root).skills.map(({name, skillRoot}) => ({name, skillRoot})),
        [{name: "one", skillRoot: "skills/one"}, {name: "two", skillRoot: "skills/two"}],
    )
})

it("changes the digest when executable mode changes", () => {
    const root = fixtureRepository({
        "SKILL.md": "---\\nname: sample\\ndescription: Sample\\n---\\n",
        "scripts/run.sh": "#!/bin/sh\\necho ok\\n",
    })
    const first = snapshotManagedSkill(root)
    chmodSync(join(root, "scripts/run.sh"), 0o755)
    assert.notEqual(first.digest, snapshotManagedSkill(root).digest)
})

it("rejects a symlink escaping the repository", () => {
    const {root} = escapingSymlinkFixture()
    assert.throws(() => scanManagedSkillRepository(root), /outside the repository/i)
})
```

- [ ] **Step 3: Verify RED**

Run `node --test test/managed-skill-snapshot.test.cjs`.

Expected: FAIL with `Cannot find module '../src/managed-skill-snapshot.cjs'`.

- [ ] **Step 4: Implement the scanner**

Export:

```js
module.exports = {
    DEFAULT_SCAN_LIMITS,
    scanManagedSkillRepository,
    snapshotManagedSkill,
}
```

Canonicalize the root, ignore `.git`, sort POSIX relative paths, reject escaping links and device files, enforce file-count/total/single-file limits, and parse YAML frontmatter. Return `{skills, warnings, stats}` where each Skill has `name`, `description`, `skillRoot`, `manifestPath`, `status`, `warnings`, and `executableFiles`.

The snapshot digest hashes each relative path, executable bit, byte length, and raw bytes in sorted order; return `{digest, files, totalBytes}`.

- [ ] **Step 5: Verify GREEN and commit isolated files**

Run:

```bash
node --test test/managed-skill-snapshot.test.cjs test/evaluation-skill-evidence.test.cjs
git add desktop/rolling-skill/src/managed-skill-snapshot.cjs desktop/rolling-skill/test/managed-skill-snapshot.test.cjs
git commit -m "feat: scan and fingerprint managed skills"
```

Expected: tests PASS. Do not stage package files.

### Task 2: Atomic managed-Skill registry

**Files:**
- Create: `desktop/rolling-skill/test/managed-skill-store.test.cjs`
- Create: `desktop/rolling-skill/src/managed-skill-store.cjs`

- [ ] **Step 1: Write failing tests**

Test initial schema, `0600` file mode, `0700` directory mode, deep-copy reads, duplicate path rejection, restart persistence, cascade protection, and version uniqueness through:

```js
const store = new ManagedSkillStore(registryPath)
const repository = store.addRepository({
    displayName: "billing",
    managedPath: join(root, "repositories", "repo-1"),
    defaultBranch: "main",
    source: {kind: "folder", location: "/source"},
})
const skill = store.replaceRepositorySkills(repository.id, [{
    name: "billing",
    description: "Billing Skill",
    skillRoot: ".",
    manifestPath: "SKILL.md",
    status: "valid",
    warnings: [],
}])[0]
const candidate = store.addVersion({
    repositoryId: repository.id,
    skillId: skill.id,
    commit: "a".repeat(40),
    contentDigest: `sha256:${"b".repeat(64)}`,
    state: "candidate",
    createdBy: "import",
})
assert.equal(store.releaseVersion(candidate.id, "v1.0.0").state, "released")
```

- [ ] **Step 2: Verify RED**

Run `node --test test/managed-skill-store.test.cjs`.

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the registry**

Use schema `rolling-skill-managed-skills/v1` with `repositories`, `skills`, and `versions`. Persist through a mode-`0600` temporary sibling, fsync, rename, and `0700` directory permissions.

Export `MANAGED_SKILL_SCHEMA`, `ManagedSkillStore`, and `initialManagedSkillState`. Implement `read`, repository CRUD, `replaceRepositorySkills`, Skill reads, version reads, `addVersion`, `releaseVersion`, and `deprecateVersion`. Repository removal fails while versions exist unless the manager supplies a validated cascade flag.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test, then commit only the new store and test with message `feat: persist managed skill registry`.

### Task 3: Deterministic Git service

**Files:**
- Create: `desktop/rolling-skill/test/managed-skill-git.test.cjs`
- Create: `desktop/rolling-skill/src/managed-skill-git.cjs`

- [ ] **Step 1: Write failing real-Git tests**

```js
const git = new ManagedSkillGit({gitExecutable: "git"})
await git.initialize(repositoryPath)
const commit = await git.commitAll(repositoryPath, "Import Skill")
assert.match(commit, /^[a-f0-9]{40}$/)
await git.createAnnotatedTag(repositoryPath, "rolling-skill/sample/v1.0.0", "Release v1.0.0", commit)
assert.equal(await git.resolve(repositoryPath, "rolling-skill/sample/v1.0.0"), commit)
```

Also cover local clone history, dirty status, literal shell metacharacters, redacted URL credentials, non-overwritable tags, disabled hooks, and no submodule initialization.

- [ ] **Step 2: Verify RED**

Run `node --test test/managed-skill-git.test.cjs` and expect missing-module failure.

- [ ] **Step 3: Implement non-shell Git operations**

Wrap promisified `execFile`, always pass argument arrays, and set `GIT_TERMINAL_PROMPT=0`, `GIT_CONFIG_NOSYSTEM=1`, and `-c core.hooksPath=/dev/null`.

Export `ManagedSkillGit` and `redactGitLocation`. Implement `initialize`, `cloneLocal`, `cloneUrl`, `head`, `resolve`, `status`, `commitAll`, `createAnnotatedTag`, and `defaultBranch`. New repositories use `main`; imported Git keeps its detected default branch. Release tags use `rolling-skill/<skill-name>/<version-label>` so two Skills in one repository cannot collide.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test and commit the two new files with message `feat: manage local skill git history`.

### Task 4: Bounded ZIP extraction

**Files:**
- Create: `desktop/rolling-skill/test/managed-skill-archive.test.cjs`
- Create: `desktop/rolling-skill/src/managed-skill-archive.cjs`

- [ ] **Step 1: Write failing archive tests**

Generate ZIP fixtures in test code and cover normal files, nested Skills, executable bits, `../escape`, absolute paths, duplicates, file-count and byte limits, suspicious compression ratios, and escaping symlink targets.

```js
const result = await extractManagedSkillZip(zipPath, destination, {
    maxFiles: 100,
    maxTotalBytes: 1_000_000,
    maxFileBytes: 100_000,
    maxCompressionRatio: 200,
})
assert.deepEqual(result.files.sort(), ["SKILL.md", "scripts/run.sh"])
```

- [ ] **Step 2: Verify RED**

Run `node --test test/managed-skill-archive.test.cjs` and expect missing-module failure.

- [ ] **Step 3: Implement safe lazy extraction**

Use `yauzl.open(zipPath, {lazyEntries: true, validateEntrySizes: true})`. Reject NUL, absolute, drive-prefixed, duplicate, parent-traversal, oversized, and suspicious-ratio entries before writing. Stream regular files through a byte counter opened with `wx`; defer links until all files exist, then ensure every resolved target remains inside destination. Remove the validated staging destination after any error.

Export `DEFAULT_ARCHIVE_LIMITS` and `extractManagedSkillZip`.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused test, confirm no outside files exist, and commit the two new files with message `feat: safely extract skill archives`.

### Task 5: Transactional manager and version lifecycle

**Files:**
- Create: `desktop/rolling-skill/test/managed-skill-manager.test.cjs`
- Create: `desktop/rolling-skill/src/managed-skill-manager.cjs`

- [ ] **Step 1: Write failing manager tests**

```js
const manager = new ManagedSkillManager({applicationSupportDirectory, store, git})
const imported = await manager.importSource({kind: "folder", location: source})
assert.equal(imported.repository.source.kind, "folder")
assert.equal(imported.skills[0].name, "billing")
assert.equal(imported.versions[0].state, "candidate")

const candidate = await manager.createCandidate({
    skillId: imported.skills[0].id,
    message: "Clarify billing query order",
})
const released = await manager.releaseVersion({versionId: candidate.id, versionLabel: "v1.0.0"})
assert.equal(released.state, "released")
```

Cover all four source kinds, copy independence, local Git history, redacted provenance, multiple Skill roots at one commit, failure cleanup, serialized duplicate imports, dirty Working requirements, and release without Dataset/Rubric mutation.

- [ ] **Step 2: Verify RED**

Run `node --test test/managed-skill-manager.test.cjs` and expect missing-module failure.

- [ ] **Step 3: Implement transactional orchestration**

Import into `repositories/.staging-<uuid>`, scan and commit there, atomically rename to `<repository-id>`, then add registry rows. On failure remove only the canonical validated staging path.

Export `ManagedSkillManager` and `defaultManagedSkillPaths`. Implement `overview`, `importSource`, `readSkill`, `createCandidate`, `releaseVersion`, `deprecateVersion`, and `repositoryPath`. `overview` returns redacted nested repository/Skill/version data. `readSkill` only reads the registered Skill manifest and inventory.

- [ ] **Step 4: Verify GREEN and commit**

Run all five managed-Skill test files. Expected: all PASS. Commit the manager and test with message `feat: import and version managed skills`.

### Task 6: Main-process IPC and preload

**Files:**
- Modify: `desktop/rolling-skill/test/main-bridge.test.cjs`
- Modify: `desktop/rolling-skill/src/main.cjs`
- Modify: `desktop/rolling-skill/src/preload.cjs`

- [ ] **Step 1: Add failing bridge assertions**

Require construction below `app.getPath("userData")`, bootstrap `managedSkills`, a `managed-skills:changed` event, and channels:

```text
skill-repositories:list
skill-repositories:import
skill-repositories:reveal
managed-skills:read
skill-versions:create-candidate
skill-versions:release
skill-versions:deprecate
```

Local source kinds must open Electron dialogs in main; renderer cannot pass a destination path. Git URL accepts only HTTPS, SSH, or SCP-like Git syntax and errors redact credentials.

- [ ] **Step 2: Verify RED**

Run `node --test test/main-bridge.test.cjs` and confirm only the new assertions fail.

- [ ] **Step 3: Construct manager and handlers in main**

```js
managedSkillStore = new ManagedSkillStore(join(app.getPath("userData"), "skill-registry.json"))
managedSkillManager = new ManagedSkillManager({
    applicationSupportDirectory: app.getPath("userData"),
    store: managedSkillStore,
})
```

ZIP/folder/local-git imports choose their source through `dialog.showOpenDialog`. Git URL validation and all destination resolution stay in main. Mutations emit `managed-skills:changed` with `manager.overview()`.

- [ ] **Step 4: Expose narrow preload methods**

```js
listManagedSkills: () => ipcRenderer.invoke("skill-repositories:list"),
importManagedSkill: (input) => ipcRenderer.invoke("skill-repositories:import", input),
readManagedSkill: (skillId) => ipcRenderer.invoke("managed-skills:read", {skillId}),
createManagedSkillCandidate: (input) => ipcRenderer.invoke("skill-versions:create-candidate", input),
releaseManagedSkillVersion: (input) => ipcRenderer.invoke("skill-versions:release", input),
deprecateManagedSkillVersion: (input) => ipcRenderer.invoke("skill-versions:deprecate", input),
revealManagedSkillRepository: (repositoryId) => ipcRenderer.invoke("skill-repositories:reveal", {repositoryId}),
onManagedSkillsChanged: (listener) => subscribe("managed-skills:changed", listener),
```

- [ ] **Step 5: Verify GREEN**

Run `node --test test/main-bridge.test.cjs test/local-first-surface.test.cjs`. Bridge assertions pass; the surface test may still fail only for Task 7 expectations.

### Task 7: Skill Management renderer surface

**Files:**
- Modify: `desktop/rolling-skill/test/local-first-surface.test.cjs`
- Modify: `desktop/rolling-skill/renderer/index.html`
- Modify: `desktop/rolling-skill/renderer/renderer.js`
- Modify: `desktop/rolling-skill/renderer/styles.css`

- [ ] **Step 1: Write failing UI source tests**

Assert a third `data-surface="skills"` button, `#skill-management-workbench`, repository/Skill/version regions, four import actions, Git URL dialog, Candidate dialog, release action, and responsive layout. `setSurface` accepts exactly chat/evaluation/skills; Raw Case, curation, trace, conversation, and composer remain Chat-only.

- [ ] **Step 2: Verify RED**

Run `node --test test/local-first-surface.test.cjs` and confirm the new assertions fail.

- [ ] **Step 3: Add semantic HTML**

```html
<section id="skill-management-workbench" class="skill-management-workbench hidden">
    <header class="skill-management-header">
        <h1 data-i18n="skillManagement">Skill management</h1>
        <div class="skill-import-actions">
            <button type="button" data-import-skill="zip">Import ZIP</button>
            <button type="button" data-import-skill="folder">Import folder</button>
            <button type="button" data-import-skill="local-git">Import Git repository</button>
            <button type="button" data-import-skill="git-url">Clone Git URL</button>
        </div>
    </header>
    <div class="skill-management-grid">
        <aside><nav id="managed-repository-list"></nav></aside>
        <section id="managed-skill-detail"></section>
        <aside id="managed-skill-versions"></aside>
    </div>
</section>
```

Add labelled, cancellable modal forms for Git URL, Candidate message, and release label, each with an inline error region and disabled submit state while IPC runs.

- [ ] **Step 4: Implement state and events**

```js
managedSkills: {repositories: [], skills: [], versions: []},
activeManagedRepositoryId: null,
activeManagedSkillId: null,
managedSkillDetail: null,
managedSkillLoading: false,
managedSkillError: null,
```

Implement load, render, select, import, Candidate, release, deprecate, reveal, and changed-event refresh. Import errors remain inside Skill Management. Surface switching preserves Chat scroll and composer draft.

- [ ] **Step 5: Add responsive styles and verify GREEN**

Wide windows use three columns; medium windows place versions below detail; narrow windows use one independently scrollable column with a sticky header. Reuse theme variables and never set a global wait cursor. Run the focused UI test and expect PASS.

### Task 8: Renderer smoke, documentation, and Phase 1 verification

**Files:**
- Modify: `desktop/rolling-skill/scripts/renderer-smoke-preload.cjs`
- Modify: `desktop/rolling-skill/scripts/renderer-smoke.cjs`
- Modify: `desktop/rolling-skill/README.md`

- [ ] **Step 1: Add failing smoke interactions**

Fake one repository with two Skills and Candidate/Released versions. Switch to Skill Management, select both Skills, open/cancel import dialogs, create a Candidate, release it, deliver `managed-skills:changed`, then switch back and assert the Chat composer draft remains.

- [ ] **Step 2: Verify RED**

Run `npm run smoke:renderer`; expect failure at the first new interaction.

- [ ] **Step 3: Complete fake preload and UI behavior**

Add deterministic in-memory implementations for the new bridge methods. Cancelling dialogs leaves no leaked pending promise or global busy state.

- [ ] **Step 4: Update README**

Document Application Support paths, source copying, one-source-per-repository, multi-Skill repositories, Working/Candidate/Released semantics, source redaction, reveal behavior, and the Phase 1 boundary: no remote sync, script execution, Runtime installation, or unmanaged overwrite.

- [ ] **Step 5: Run final verification**

Run:

```bash
npm test
npm run smoke:renderer
git diff --check
```

Expected: all Node tests PASS, renderer smoke reports zero renderer errors, and diff check emits no output.

- [ ] **Step 6: Review against the design**

Confirm tests evidence all four source kinds, multiple Skills, independence from deleted source material, Candidate/Released immutability, secret redaction, safe ZIP handling, main-process path ownership, third surface, and absence of Runtime installation side effects.

- [ ] **Step 7: Start Phase 2 only from a green Phase 1**

Write the Runtime adapter/install/rollback plan after Phase 1 is green. Keep adapter installation logic out of importer modules.
