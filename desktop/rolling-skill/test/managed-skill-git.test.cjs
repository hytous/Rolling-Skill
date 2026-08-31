const assert = require("node:assert/strict")
const {
    chmodSync,
    existsSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    ManagedSkillGit,
    redactGitLocation,
    requireGitSourceLocation,
} = require("../src/managed-skill-git.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory(prefix = "rolling-skill-managed-git-") {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    temporaryDirectories.push(directory)
    return directory
}

function writeSkill(repository, body = "First") {
    writeFileSync(
        join(repository, "SKILL.md"),
        `---\nname: sample\ndescription: Sample Skill\n---\n\n${body}\n`,
    )
}

describe("managed Skill Git service", () => {
    it("initializes main, commits without global identity, and resolves an annotated release", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        writeSkill(repository)

        const commit = await git.commitAll(repository, "Import Skill")
        await git.createAnnotatedTag(
            repository,
            "rolling-skill/sample/v1.0.0",
            "Release v1.0.0",
            commit,
        )

        assert.match(commit, /^[a-f0-9]{40}$/)
        assert.equal(await git.head(repository), commit)
        assert.equal(await git.resolve(repository, "rolling-skill/sample/v1.0.0"), commit)
        assert.equal(await git.defaultBranch(repository), "main")
    })

    it("passes commit messages literally and disables repository hooks", async () => {
        const root = temporaryDirectory()
        const repository = join(root, "repository")
        mkdirSync(repository)
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        const hook = join(repository, ".git", "hooks", "pre-commit")
        writeFileSync(hook, "#!/bin/sh\nexit 91\n")
        chmodSync(hook, 0o755)
        writeSkill(repository)
        const marker = join(root, "shell-expanded")
        const message = `literal $(touch ${marker}) ; value`

        const commit = await git.commitAll(repository, message)

        assert.match(commit, /^[a-f0-9]{40}$/)
        assert.equal(existsSync(marker), false)
        assert.equal(await git.subject(repository, commit), message)
    })

    it("reports dirty state and refuses empty commits", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)

        assert.deepEqual(await git.status(repository), {dirty: false, entries: []})
        await assert.rejects(() => git.commitAll(repository, "Empty"), /no working changes/i)

        writeSkill(repository)
        const dirty = await git.status(repository)
        assert.equal(dirty.dirty, true)
        assert.match(dirty.entries[0], /SKILL\.md/)
    })

    it("creates and removes an exact detached baseline worktree through argument-array Git calls", async () => {
        const root = temporaryDirectory()
        const repository = join(root, "repository")
        const workspace = join(root, "workspaces", "run-1")
        mkdirSync(repository)
        mkdirSync(join(root, "workspaces"))
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        writeSkill(repository, "Baseline")
        const baseline = await git.commitAll(repository, "Baseline")
        writeSkill(repository, "Main moved")
        const later = await git.commitAll(repository, "Later")

        await git.createWorktree(
            repository,
            workspace,
            "rolling-skill/optimization/run-1",
            baseline,
        )

        assert.equal(await git.worktreeHead(workspace), baseline)
        assert.equal(await git.defaultBranch(workspace), "rolling-skill/optimization/run-1")
        assert.equal(await git.isAncestor(repository, baseline, later), true)
        assert.equal(await git.isAncestor(repository, later, baseline), false)
        await git.removeWorktree(repository, workspace)
        assert.equal(existsSync(workspace), false)
        await assert.rejects(() => git.removeWorktree(repository, workspace), /registered|worktree/i)
    })

    it("clones local Git history into an independent managed repository", async () => {
        const root = temporaryDirectory()
        const source = join(root, "source")
        const destination = join(root, "destination")
        mkdirSync(source)
        const git = new ManagedSkillGit()
        await git.initialize(source)
        writeSkill(source, "First")
        const first = await git.commitAll(source, "First")
        writeSkill(source, "Second")
        const second = await git.commitAll(source, "Second")

        await git.cloneLocal(source, destination)
        rmSync(source, {recursive: true, force: true})

        assert.equal(await git.head(destination), second)
        assert.equal(await git.resolve(destination, `${first}^{commit}`), first)
        assert.equal(await git.defaultBranch(destination), "main")
        assert.equal((await git.status(destination)).dirty, false)
    })

    it("does not overwrite an existing release tag", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        writeSkill(repository)
        const commit = await git.commitAll(repository, "Import")
        await git.createAnnotatedTag(
            repository,
            "rolling-skill/sample/v1.0.0",
            "Release",
            commit,
        )

        await assert.rejects(
            () => git.createAnnotatedTag(
                repository,
                "rolling-skill/sample/v1.0.0",
                "Replace",
                commit,
            ),
            /already exists/i,
        )
        assert.equal(await git.resolve(repository, "rolling-skill/sample/v1.0.0"), commit)
    })

    it("deletes only an explicitly named release tag for transaction rollback", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        writeSkill(repository)
        const commit = await git.commitAll(repository, "Import")
        await git.createAnnotatedTag(
            repository,
            "rolling-skill/sample/v1.0.0",
            "Release",
            commit,
        )

        await git.deleteTag(repository, "rolling-skill/sample/v1.0.0")

        await assert.rejects(
            () => git.resolve(repository, "rolling-skill/sample/v1.0.0"),
            /unknown revision|needed a single revision|valid object/i,
        )
    })

    it("redacts credentials, tokens, and local user names from provenance", () => {
        assert.equal(
            redactGitLocation("https://alice:secret@git.example.com/team/repo.git?token=abc#fragment"),
            "https://git.example.com/team/repo.git",
        )
        assert.equal(
            redactGitLocation("alice@git.example.com:team/repo.git"),
            "git.example.com:team/repo.git",
        )
        assert.equal(redactGitLocation("/Users/alice/private/repo"), "repo")
        assert.equal(redactGitLocation("file:///Users/alice/private/repo.git"), "repo.git")
    })

    it("accepts HTTPS, SSH, and SCP clone locations but rejects local and insecure URLs", () => {
        for (const location of [
            "https://git.example.com/team/repo.git",
            "ssh://git@git.example.com/team/repo.git",
            "git@git.example.com:team/repo.git",
        ]) {
            assert.equal(requireGitSourceLocation(location), location)
        }
        for (const location of [
            "file:///Users/alice/repo.git",
            "http://git.example.com/repo.git",
            "/Users/alice/repo",
            "-u=ssh:team/repo.git",
        ]) {
            assert.throws(() => requireGitSourceLocation(location), /HTTPS, SSH, or SCP/i)
        }
    })

    it("terminates clone options before an accepted source operand", async () => {
        const calls = []
        const git = new ManagedSkillGit({
            execFile: (_executable, args, _options, callback) => {
                calls.push(args)
                callback(null, args.includes("rev-parse") ? "a".repeat(40) : "", "")
            },
        })

        await git.cloneUrl("git@git.example.com:team/repo.git", "/tmp/managed-destination")

        assert.deepEqual(
            calls[0].slice(-5),
            ["clone", "--no-recurse-submodules", "--", "git@git.example.com:team/repo.git", "/tmp/managed-destination"],
        )
    })

    it("commits and resets only selected paths without disturbing sibling staged changes", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        mkdirSync(join(repository, "skills", "one"), {recursive: true})
        mkdirSync(join(repository, "skills", "two"), {recursive: true})
        writeFileSync(join(repository, "skills", "one", "SKILL.md"), "one baseline\n")
        writeFileSync(join(repository, "skills", "two", "SKILL.md"), "two baseline\n")
        const baseline = await git.commitAll(repository, "Baseline")

        writeFileSync(join(repository, "skills", "one", "SKILL.md"), "one changed\n")
        writeFileSync(join(repository, "skills", "two", "SKILL.md"), "two staged\n")
        await git.run(["add", "--", "skills/two"], {cwd: repository})
        const committed = await git.commitPaths(repository, "Edit one", ["skills/one"])

        assert.notEqual(committed, baseline)
        assert.equal((await git.run(
            ["diff", "--name-only", `${baseline}..${committed}`],
            {cwd: repository},
        )).stdout, "skills/one/SKILL.md")
        assert.equal((await git.run(
            ["diff", "--cached", "--name-only"],
            {cwd: repository},
        )).stdout, "skills/two/SKILL.md")

        await git.softReset(repository, baseline)
        writeFileSync(join(repository, "skills", "one", "SKILL.md"), "one restored external\n")
        await git.resetPaths(repository, baseline, ["skills/one"])

        assert.equal(await git.head(repository), baseline)
        assert.equal((await git.run(
            ["diff", "--cached", "--name-only"],
            {cwd: repository},
        )).stdout, "skills/two/SKILL.md")
        assert.equal((await git.run(
            ["diff", "--name-only", "--", "skills/one"],
            {cwd: repository},
        )).stdout, "skills/one/SKILL.md")
    })

    it("snapshots committed bytes rather than later Working changes", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        writeSkill(repository, "Committed body")
        writeFileSync(join(repository, ".gitignore"), "references/ignored.md\n")
        mkdirSync(join(repository, "references"))
        writeFileSync(join(repository, "references", "ignored.md"), "Committed reference\n")
        writeFileSync(join(repository, ".rolling-skill-managed.json"), "{\"version\":1}\n")
        const commit = await git.commitAll(repository, "Candidate", {forcePaths: ["."]})

        writeSkill(repository, "Later Working body")
        writeFileSync(join(repository, "references", "ignored.md"), "Later Working reference\n")
        const snapshot = await git.snapshotSkill(repository, commit, ".")

        assert.match(snapshot.digest, /^sha256:[a-f0-9]{64}$/)
        assert.deepEqual(snapshot.files.map((entry) => entry.path), [
            ".gitignore",
            "SKILL.md",
            "references/ignored.md",
        ])
        assert.equal(snapshot.files.find((entry) => entry.path === "references/ignored.md").size, 20)
    })

    it("rejects committed symbolic links that escape the selected Skill root", async () => {
        const repository = temporaryDirectory()
        const git = new ManagedSkillGit()
        await git.initialize(repository)
        mkdirSync(join(repository, "skills", "sample"), {recursive: true})
        writeFileSync(
            join(repository, "skills", "sample", "SKILL.md"),
            "---\nname: sample\ndescription: Sample Skill\n---\n",
        )
        writeFileSync(join(repository, "shared.txt"), "shared")
        symlinkSync("../../shared.txt", join(repository, "skills", "sample", "escape.txt"))
        const commit = await git.commitAll(repository, "Escaping link", {
            forcePaths: ["skills/sample"],
        })

        await assert.rejects(
            () => git.snapshotSkill(repository, commit, "skills/sample"),
            /symbolic link.*outside/i,
        )
    })
})
