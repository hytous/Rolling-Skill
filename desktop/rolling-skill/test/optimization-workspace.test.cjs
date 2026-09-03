"use strict"

const assert = require("node:assert/strict")
const {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {dirname, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {ManagedSkillGit} = require("../src/managed-skill-git.cjs")
const {
    ManagedSkillManager,
    defaultManagedSkillPaths,
} = require("../src/managed-skill-manager.cjs")
const {ManagedSkillStore} = require("../src/managed-skill-store.cjs")
const {
    OptimizationWorkspaceManager,
} = require("../src/optimization/optimization-workspace.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory(prefix = "rolling-skill-optimization-workspace-") {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    temporaryDirectories.push(directory)
    return directory
}

function manifest(body) {
    return `---\nname: billing\ndescription: Billing Skill\n---\n\n${body}\n`
}

function write(path, body) {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, body)
}

async function fixture() {
    const applicationSupportDirectory = temporaryDirectory()
    const source = temporaryDirectory("rolling-skill-optimization-source-")
    write(join(source, "SKILL.md"), manifest("Baseline"))
    const paths = defaultManagedSkillPaths({applicationSupportDirectory})
    const store = new ManagedSkillStore(paths.registryPath)
    const git = new ManagedSkillGit()
    const managed = new ManagedSkillManager({applicationSupportDirectory, store, git})
    const imported = await managed.importSource({kind: "folder", location: source})
    const released = await managed.releaseVersion({
        versionId: imported.versions[0].id,
        versionLabel: "v1.0.0",
    })
    const workspaces = new OptimizationWorkspaceManager({
        applicationSupportDirectory,
        store,
        git,
    })
    const run = {
        id: "optimization-run-1",
        snapshot: {
            baseline: {
                repositoryId: released.repositoryId,
                skillId: released.skillId,
                versionId: released.id,
                commit: released.commit,
                skillRoot: released.skillRoot,
                contentDigest: released.contentDigest,
            },
        },
    }
    return {applicationSupportDirectory, git, managed, run, store, workspaces}
}

describe("OptimizationWorkspaceManager", () => {
    it("rejects an optimization workspace root redirected outside Application Support", () => {
        const applicationSupportDirectory = temporaryDirectory()
        const outside = temporaryDirectory("rolling-skill-optimization-root-outside-")
        symlinkSync(outside, join(applicationSupportDirectory, "optimization-workspaces"))
        const paths = defaultManagedSkillPaths({applicationSupportDirectory})
        const store = new ManagedSkillStore(paths.registryPath)

        assert.throws(() => new OptimizationWorkspaceManager({
            applicationSupportDirectory,
            store,
            git: new ManagedSkillGit(),
        }), /symbolic|outside|escape|workspace root/i)
    })

    it("isolates an exact baseline and records an optimization Candidate without dirtying Working", async () => {
        const {git, run, store, workspaces} = await fixture()
        const repository = store.getRepository(run.snapshot.baseline.repositoryId)
        const workspace = await workspaces.create(run)

        assert.equal(workspace.branchName, "rolling-skill/optimization/optimization-run-1")
        assert.equal(workspace.baselineCommit, run.snapshot.baseline.commit)
        assert.equal(await git.worktreeHead(workspace.workspacePath), run.snapshot.baseline.commit)
        assert.equal(await git.defaultBranch(workspace.workspacePath), workspace.branchName)
        assert.equal((await git.status(repository.managedPath)).dirty, false)
        const registered = workspaces.get(run.id)
        assert.deepEqual(registered, workspace)
        registered.workspacePath = "/forged"
        assert.equal(workspaces.get(run.id).workspacePath, workspace.workspacePath)

        for (const epoch of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            await assert.rejects(() => workspaces.createCandidate({
                runId: run.id,
                epoch,
                message: "Invalid Epoch",
            }), /epoch|integer/i)
        }

        write(join(workspace.workspacePath, "SKILL.md"), manifest("Optimized Epoch 101"))
        assert.equal((await git.status(repository.managedPath)).dirty, false)
        const candidate = await workspaces.createCandidate({
            runId: run.id,
            epoch: 101,
            message: "Improve billing workflow",
        })

        assert.equal(candidate.repositoryId, run.snapshot.baseline.repositoryId)
        assert.equal(candidate.skillId, run.snapshot.baseline.skillId)
        assert.equal(candidate.createdBy, "optimization")
        assert.equal(candidate.optimizationRunId, run.id)
        assert.equal(candidate.optimizationEpoch, 101)
        assert.notEqual(candidate.contentDigest, run.snapshot.baseline.contentDigest)
        assert.equal(await git.worktreeHead(workspace.workspacePath), candidate.commit)
        assert.equal(await git.isAncestor(
            repository.managedPath,
            run.snapshot.baseline.commit,
            candidate.commit,
        ), true)
        assert.equal(await git.head(repository.managedPath), run.snapshot.baseline.commit)
        assert.equal((await git.status(repository.managedPath)).dirty, false)
        const message = await git.run(["show", "-s", "--format=%B", candidate.commit], {
            cwd: workspace.workspacePath,
        })
        assert.match(message.stdout, /Rolling-Skill-Optimization-Run: optimization-run-1/u)
        assert.match(message.stdout, /Rolling-Skill-Optimization-Epoch: 101/u)
    })

    it("rejects path escape, symlink substitution, foreign workspace input, and imprecise cleanup", async () => {
        const {applicationSupportDirectory, git, run, store, workspaces} = await fixture()
        await assert.rejects(
            () => workspaces.create({...run, id: "../escape"}),
            /run id|path|normalized|unsupported/i,
        )

        const workspacesRoot = join(applicationSupportDirectory, "optimization-workspaces")
        mkdirSync(workspacesRoot, {recursive: true, mode: 0o700})
        const outside = temporaryDirectory("rolling-skill-optimization-outside-")
        const substituted = join(workspacesRoot, "optimization-run-1")
        symlinkSync(outside, substituted)
        await assert.rejects(() => workspaces.create(run), /symbolic|already exists|workspace/i)
        assert.equal(existsSync(outside), true)
        rmSync(substituted)

        const workspace = await workspaces.create(run)
        await assert.rejects(() => workspaces.createCandidate({
            runId: run.id,
            epoch: 1,
            message: "Foreign",
            workspacePath: outside,
        }), /unknown|field|workspace/i)
        const repository = store.getRepository(run.snapshot.baseline.repositoryId)
        const foreignWorkspace = join(outside, "foreign-worktree")
        await git.createWorktree(
            repository.managedPath,
            foreignWorkspace,
            "rolling-skill/optimization/foreign-run",
            run.snapshot.baseline.commit,
        )
        const parkedWorkspace = `${workspace.workspacePath}.parked`
        renameSync(workspace.workspacePath, parkedWorkspace)
        symlinkSync(foreignWorkspace, workspace.workspacePath)
        await assert.rejects(() => workspaces.createCandidate({
            runId: run.id,
            epoch: 1,
            message: "Foreign Candidate",
        }), /symbolic|identity|workspace/i)
        rmSync(workspace.workspacePath)
        renameSync(parkedWorkspace, workspace.workspacePath)
        await git.removeWorktree(repository.managedPath, foreignWorkspace)
        const sibling = join(workspacesRoot, "unrelated")
        mkdirSync(sibling)
        write(join(sibling, "keep.txt"), "keep")
        await assert.rejects(() => workspaces.cleanup("unknown-run"), /unknown|registered/i)

        const cleaned = await workspaces.cleanup(run.id)
        assert.equal(cleaned.runId, run.id)
        assert.equal(existsSync(workspace.workspacePath), false)
        assert.equal(readFileSync(join(sibling, "keep.txt"), "utf8"), "keep")
        await assert.rejects(() => workspaces.cleanup(run.id), /unknown|registered/i)
    })

    it("recovers an exact unrecorded Candidate after an atomic registry failure", async () => {
        const {run, store, workspaces} = await fixture()
        const workspace = await workspaces.create(run)
        write(join(workspace.workspacePath, "SKILL.md"), manifest("Recoverable Candidate"))
        const persist = store.persist.bind(store)
        store.persist = () => {
            throw new Error("simulated optimization registry failure")
        }
        try {
            await assert.rejects(() => workspaces.createCandidate({
                runId: run.id,
                epoch: 1,
                message: "Recover candidate",
            }), /simulated optimization registry failure/i)
        } finally {
            store.persist = persist
        }

        const recovered = await workspaces.createCandidate({
            runId: run.id,
            epoch: 1,
            message: "Recover candidate",
        })
        assert.equal(recovered.optimizationRunId, run.id)
        assert.equal(recovered.optimizationEpoch, 1)
        assert.equal(store.getVersion(recovered.id).commit, recovered.commit)
    })

    it("re-registers an exact persisted worktree after process restart", async () => {
        const {applicationSupportDirectory, git, run, store, workspaces} = await fixture()
        const workspace = await workspaces.create(run)
        write(join(workspace.workspacePath, "SKILL.md"), manifest("Persisted Candidate"))
        const candidate = await workspaces.createCandidate({
            runId: run.id,
            epoch: 1,
            message: "Persist candidate",
        })
        const restarted = new OptimizationWorkspaceManager({
            applicationSupportDirectory,
            store,
            git,
        })

        const recovered = await restarted.recover(run, workspace)

        assert.deepEqual(recovered, workspace)
        assert.equal(restarted.get(run.id).workspacePath, workspace.workspacePath)
        assert.equal(await git.worktreeHead(workspace.workspacePath), candidate.commit)
        await assert.rejects(() => restarted.recover(run, {
            ...workspace,
            branchName: "rolling-skill/optimization/other-run",
        }), /registered|branch|identity/iu)
    })
})
