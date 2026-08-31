const assert = require("node:assert/strict")
const {
    createWriteStream,
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {basename, dirname, join} = require("node:path")
const {pathToFileURL} = require("node:url")
const {afterEach, describe, it} = require("node:test")
const yazl = require("yazl")

const {ManagedSkillGit} = require("../src/managed-skill-git.cjs")
const {
    ManagedSkillManager,
    defaultManagedSkillPaths,
} = require("../src/managed-skill-manager.cjs")
const {ManagedSkillStore} = require("../src/managed-skill-store.cjs")
const {snapshotManagedSkill} = require("../src/managed-skill-snapshot.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory(prefix = "rolling-skill-managed-manager-") {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    temporaryDirectories.push(directory)
    return directory
}

function write(path, contents) {
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, contents)
}

function manifest(name, description = `${name} Skill`, body = "Use it.") {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

function managerFixture() {
    const applicationSupportDirectory = temporaryDirectory()
    const paths = defaultManagedSkillPaths({applicationSupportDirectory})
    const store = new ManagedSkillStore(paths.registryPath)
    const git = new ManagedSkillGit()
    return {
        applicationSupportDirectory,
        paths,
        store,
        git,
        manager: new ManagedSkillManager({applicationSupportDirectory, store, git}),
    }
}

function createZip(root, entries) {
    const path = join(root, "skill.zip")
    const zip = new yazl.ZipFile()
    for (const entry of entries) {
        zip.addBuffer(Buffer.from(entry.contents), entry.path, {mode: entry.mode ?? 0o100644})
    }
    zip.end()
    return new Promise((resolvePromise, reject) => {
        const output = createWriteStream(path)
        output.once("error", reject)
        output.once("close", () => resolvePromise(path))
        zip.outputStream.once("error", reject)
        zip.outputStream.pipe(output)
    })
}

describe("managed Skill repository manager", () => {
    it("imports a folder into an independent Git repository and creates a Candidate", async () => {
        const {manager, store} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-source-")
        write(join(source, "SKILL.md"), manifest("billing"))
        write(join(source, "references", "guide.md"), "Guide")
        write(join(source, ".GIT", "config"), "[core]\nfsmonitor = unsafe\n")
        write(join(source, ".git", "should-not-copy"), "foreign metadata")

        const imported = await manager.importSource({kind: "folder", location: source})
        rmSync(source, {recursive: true, force: true})

        assert.equal(imported.repository.source.kind, "folder")
        assert.equal(imported.repository.source.location, basename(source))
        assert.equal(imported.skills[0].name, "billing")
        assert.equal(imported.versions[0].state, "candidate")
        assert.match(imported.versions[0].contentDigest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(existsSync(join(imported.repository.managedPath, "SKILL.md")), true)
        assert.equal(existsSync(join(imported.repository.managedPath, ".git")), true)
        assert.equal(existsSync(join(imported.repository.managedPath, ".git", "should-not-copy")), false)
        assert.doesNotMatch(
            readFileSync(join(imported.repository.managedPath, ".git", "config"), "utf8"),
            /fsmonitor|unsafe/u,
        )
        assert.equal(store.listRepositories().length, 1)
    })

    it("keeps multiple Skills in one repository with separate versions at one commit", async () => {
        const {manager} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-multi-")
        write(join(source, "skills", "one", "SKILL.md"), manifest("one"))
        write(join(source, "skills", "two", "SKILL.md"), manifest("two"))

        const imported = await manager.importSource({kind: "folder", location: source})

        assert.deepEqual(imported.skills.map((entry) => entry.name), ["one", "two"])
        assert.equal(imported.versions.length, 2)
        assert.equal(new Set(imported.versions.map((entry) => entry.commit)).size, 1)
        assert.equal(new Set(imported.versions.map((entry) => entry.skillId)).size, 2)
    })

    it("imports ZIP content and removes staging data after invalid imports", async () => {
        const {manager, paths, store} = managerFixture()
        const fixtureRoot = temporaryDirectory("rolling-skill-managed-zip-")
        const zip = await createZip(fixtureRoot, [
            {path: "billing/SKILL.md", contents: manifest("billing")},
            {path: "billing/scripts/run.sh", contents: "#!/bin/sh\n", mode: 0o100755},
        ])

        const imported = await manager.importSource({kind: "zip", location: zip})

        assert.equal(imported.skills[0].skillRoot, "billing")
        assert.deepEqual(imported.skills[0].executableFiles, ["scripts/run.sh"])

        const invalid = temporaryDirectory("rolling-skill-managed-invalid-")
        write(join(invalid, "README.md"), "No Skill")
        await assert.rejects(
            () => manager.importSource({kind: "folder", location: invalid}),
            /valid SKILL\.md/i,
        )
        assert.equal(store.listRepositories().length, 1)
        assert.equal(
            readdirSync(paths.repositoriesRoot).some((name) => name.startsWith(".staging-")),
            false,
        )
    })

    it("clones local Git and Git URL sources with their history and redacted provenance", async () => {
        const localFixture = managerFixture()
        const localSource = temporaryDirectory("rolling-skill-managed-local-git-")
        await localFixture.git.initialize(localSource)
        write(join(localSource, "SKILL.md"), manifest("local", "Local Skill", "First"))
        const firstCommit = await localFixture.git.commitAll(localSource, "First")
        write(join(localSource, "SKILL.md"), manifest("local", "Local Skill", "Second"))
        await localFixture.git.commitAll(localSource, "Second")

        const localImport = await localFixture.manager.importSource({
            kind: "local-git",
            location: localSource,
        })
        rmSync(localSource, {recursive: true, force: true})

        assert.equal(localImport.repository.source.location, basename(localSource))
        assert.equal(
            await localFixture.git.resolve(localImport.repository.managedPath, `${firstCommit}^{commit}`),
            firstCommit,
        )
        assert.doesNotMatch(
            readFileSync(join(localImport.repository.managedPath, ".git", "config"), "utf8"),
            /remote "origin"|rolling-skill-managed-local-git/u,
        )

        const urlFixture = managerFixture()
        const urlSource = temporaryDirectory("rolling-skill-managed-url-git-")
        await urlFixture.git.initialize(urlSource)
        write(join(urlSource, "SKILL.md"), manifest("remote"))
        await urlFixture.git.commitAll(urlSource, "Initial")
        const sourceUrl = pathToFileURL(urlSource).toString()

        const urlImport = await urlFixture.manager.importSource({kind: "git-url", location: sourceUrl})

        assert.equal(urlImport.repository.source.location, basename(urlSource))
        assert.equal(urlImport.skills[0].name, "remote")
        assert.doesNotMatch(
            readFileSync(join(urlImport.repository.managedPath, ".git", "config"), "utf8"),
            /remote "origin"|rolling-skill-managed-url-git/u,
        )
    })

    it("commits Working changes as a new Candidate and refuses an unchanged Skill", async () => {
        const {manager, store} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-candidate-")
        write(join(source, "SKILL.md"), manifest("billing", "Billing Skill", "First"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const skill = imported.skills[0]
        write(
            join(imported.repository.managedPath, "SKILL.md"),
            manifest("billing", "Billing Skill", "Second"),
        )

        const base = await manager.candidateBase(skill.id)
        assert.deepEqual({
            repositoryId: base.repositoryId,
            skillId: base.skillId,
            commit: base.commit,
            dirty: base.dirty,
        }, {
            repositoryId: imported.repository.id,
            skillId: skill.id,
            commit: imported.versions[0].commit,
            dirty: true,
        })
        assert.notEqual(base.contentDigest, imported.versions[0].contentDigest)

        const candidate = await manager.createCandidate({
            skillId: skill.id,
            message: "Clarify billing workflow",
            expectedBase: {
                commit: base.commit,
                contentDigest: base.contentDigest,
                dirty: base.dirty,
            },
        })

        assert.notEqual(candidate.commit, imported.versions[0].commit)
        assert.equal(candidate.createdBy, "user")
        assert.equal(store.listVersions(skill.id).length, 2)
        await assert.rejects(
            () => manager.createCandidate({skillId: skill.id, message: "No changes"}),
            /no working changes|has not changed/i,
        )
    })

    it("recovers an unrecorded clean Candidate after an atomic registry write fails", async () => {
        const {manager, store, git} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-recover-candidate-")
        write(join(source, "SKILL.md"), manifest("billing", "Billing Skill", "First"))
        const imported = await manager.importSource({kind: "folder", location: source})
        write(
            join(imported.repository.managedPath, "SKILL.md"),
            manifest("billing", "Billing Skill", "Second"),
        )
        const persist = store.persist.bind(store)
        store.persist = () => { throw new Error("simulated registry failure") }

        await assert.rejects(
            () => manager.createCandidate({skillId: imported.skills[0].id, message: "Second"}),
            /simulated registry failure/i,
        )
        store.persist = persist
        assert.equal((await git.status(imported.repository.managedPath)).dirty, false)
        assert.equal(store.listVersions(imported.skills[0].id).length, 1)

        const recovered = await manager.createCandidate({
            skillId: imported.skills[0].id,
            message: "Recover second",
        })
        assert.equal(recovered.commit, await git.head(imported.repository.managedPath))
        assert.equal(store.listVersions(imported.skills[0].id).length, 2)
    })

    it("rejects an oversized folder before copying its full tree", async () => {
        const fixture = managerFixture()
        const manager = new ManagedSkillManager({
            applicationSupportDirectory: fixture.applicationSupportDirectory,
            store: fixture.store,
            git: fixture.git,
            scanLimits: {maxFiles: 2},
        })
        const source = temporaryDirectory("rolling-skill-managed-bounded-folder-")
        write(join(source, "SKILL.md"), manifest("billing"))
        mkdirSync(join(source, "empty", "nested"), {recursive: true})

        await assert.rejects(
            () => manager.importSource({kind: "folder", location: source}),
            /file count limit/i,
        )
        assert.deepEqual(fixture.store.listRepositories(), [])
        assert.deepEqual(readdirSync(fixture.paths.repositoriesRoot), [])
    })

    it("releases and deprecates a Candidate without moving HEAD", async () => {
        const {manager, git} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-release-")
        write(join(source, "SKILL.md"), manifest("billing"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const candidate = imported.versions[0]
        const headBefore = await git.head(imported.repository.managedPath)

        const released = await manager.releaseVersion({
            versionId: candidate.id,
            versionLabel: "v1.0.0",
        })
        const deprecated = await manager.deprecateVersion({versionId: released.id})

        assert.equal(released.state, "released")
        assert.equal(released.versionLabel, "v1.0.0")
        assert.equal(await git.head(imported.repository.managedPath), headBefore)
        assert.equal(
            await git.resolve(imported.repository.managedPath, "rolling-skill/billing/v1.0.0"),
            candidate.commit,
        )
        assert.ok(deprecated.deprecatedAt)
    })

    it("rolls back the Git tag if persisting a release fails", async () => {
        const fixture = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-release-failure-")
        write(join(source, "SKILL.md"), manifest("billing"))
        const imported = await fixture.manager.importSource({kind: "folder", location: source})
        const failingStore = new Proxy(fixture.store, {
            get(target, property) {
                if (property === "releaseVersion") return () => { throw new Error("store failed") }
                const value = Reflect.get(target, property, target)
                return typeof value === "function" ? value.bind(target) : value
            },
        })
        const manager = new ManagedSkillManager({
            applicationSupportDirectory: fixture.applicationSupportDirectory,
            store: failingStore,
            git: fixture.git,
        })

        await assert.rejects(
            () => manager.releaseVersion({
                versionId: imported.versions[0].id,
                versionLabel: "v1.0.0",
            }),
            /store failed/i,
        )
        await assert.rejects(
            () => fixture.git.resolve(
                imported.repository.managedPath,
                "rolling-skill/billing/v1.0.0",
            ),
        )
    })

    it("applies one edited Skill and releases the next patch without committing siblings", async () => {
        const {manager, store, git} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-agent-source-")
        write(join(source, "skills", "one", "SKILL.md"), manifest("one", "One Skill", "First"))
        write(join(source, "skills", "two", "SKILL.md"), manifest("two", "Two Skill", "First"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const skillOne = imported.skills.find((entry) => entry.name === "one")
        const skillTwo = imported.skills.find((entry) => entry.name === "two")
        const initial = imported.versions.find((entry) => entry.skillId === skillOne.id)
        await manager.releaseVersion({versionId: initial.id, versionLabel: "1.0.0"})
        write(join(imported.repository.managedPath, skillTwo.skillRoot, "local.txt"), "uncommitted\n")
        const editWorkspace = temporaryDirectory("rolling-skill-managed-agent-edit-")
        write(join(editWorkspace, "SKILL.md"), manifest("one", "One Skill", "Agent improved"))
        const expectedBase = await manager.candidateBase(skillOne.id)

        const result = await manager.applyEditedSkill({
            skillId: skillOne.id,
            sourceRoot: editWorkspace,
            expectedBase: {
                commit: expectedBase.commit,
                contentDigest: expectedBase.contentDigest,
                snapshotDigest: expectedBase.contentDigest,
            },
            message: "Agent edit",
        })

        assert.equal(result.version.versionLabel, "1.0.1")
        assert.equal(result.version.state, "released")
        assert.equal(result.version.createdBy, "user")
        assert.match(
            readFileSync(join(imported.repository.managedPath, skillOne.skillRoot, "SKILL.md"), "utf8"),
            /Agent improved/u,
        )
        assert.equal(
            readFileSync(join(imported.repository.managedPath, skillTwo.skillRoot, "local.txt"), "utf8"),
            "uncommitted\n",
        )
        assert.equal((await git.status(imported.repository.managedPath)).entries.some(
            (entry) => entry.includes("skills/two/local.txt"),
        ), true)
        assert.equal(store.listVersions(skillOne.id).length, 2)
        assert.equal(
            await git.resolve(imported.repository.managedPath, "rolling-skill/one/1.0.1"),
            result.version.commit,
        )
    })

    it("uses 1.0.0 for the first automatic release", async () => {
        const {manager} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-first-release-")
        write(join(source, "SKILL.md"), manifest("billing", "Billing Skill", "First"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const editWorkspace = temporaryDirectory("rolling-skill-managed-first-edit-")
        write(join(editWorkspace, "SKILL.md"), manifest("billing", "Billing Skill", "Second"))
        const base = await manager.candidateBase(imported.skills[0].id)

        const result = await manager.applyEditedSkill({
            skillId: imported.skills[0].id,
            sourceRoot: editWorkspace,
            expectedBase: {
                commit: base.commit,
                contentDigest: base.contentDigest,
                snapshotDigest: base.contentDigest,
            },
            message: "Agent edit",
        })

        assert.equal(result.version.versionLabel, "1.0.0")
    })

    it("rejects applying a draft after the selected managed Skill changes", async () => {
        const {manager} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-agent-conflict-")
        write(join(source, "SKILL.md"), manifest("billing", "Billing Skill", "First"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const skill = imported.skills[0]
        const editWorkspace = temporaryDirectory("rolling-skill-managed-agent-conflict-edit-")
        write(join(editWorkspace, "SKILL.md"), manifest("billing", "Billing Skill", "Agent change"))
        const base = await manager.candidateBase(skill.id)
        write(
            join(imported.repository.managedPath, skill.skillRoot, "SKILL.md"),
            manifest("billing", "Billing Skill", "External change"),
        )

        await assert.rejects(() => manager.applyEditedSkill({
            skillId: skill.id,
            sourceRoot: editWorkspace,
            expectedBase: {
                commit: base.commit,
                contentDigest: base.contentDigest,
                snapshotDigest: base.contentDigest,
            },
            message: "Agent edit",
        }), error => error.code === "RESOURCE_CHANGED")
        assert.match(
            readFileSync(join(imported.repository.managedPath, skill.skillRoot, "SKILL.md"), "utf8"),
            /External change/u,
        )
    })

    it("restores selected files and metadata when the atomic release fails", async () => {
        const fixture = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-agent-rollback-")
        write(join(source, "SKILL.md"), manifest("billing", "Billing Skill", "First"))
        const imported = await fixture.manager.importSource({kind: "folder", location: source})
        const skill = imported.skills[0]
        const editWorkspace = temporaryDirectory("rolling-skill-managed-agent-failing-edit-")
        write(join(editWorkspace, "SKILL.md"), manifest("billing", "Billing Skill", "Second"))
        const base = await fixture.manager.candidateBase(skill.id)
        const beforeHead = await fixture.git.head(imported.repository.managedPath)
        const beforeSnapshot = snapshotManagedSkill(imported.repository.managedPath)
        const versionCount = fixture.store.listVersions(skill.id).length
        const failingStore = new Proxy(fixture.store, {
            get(target, property) {
                if (property === "releaseVersion") return () => { throw new Error("release failed") }
                const value = Reflect.get(target, property, target)
                return typeof value === "function" ? value.bind(target) : value
            },
        })
        const failingManager = new ManagedSkillManager({
            applicationSupportDirectory: fixture.applicationSupportDirectory,
            store: failingStore,
            git: fixture.git,
        })

        await assert.rejects(() => failingManager.applyEditedSkill({
            skillId: skill.id,
            sourceRoot: editWorkspace,
            expectedBase: {
                commit: base.commit,
                contentDigest: base.contentDigest,
                snapshotDigest: base.contentDigest,
            },
            message: "Agent edit",
        }), /release failed/iu)

        assert.equal(await fixture.git.head(imported.repository.managedPath), beforeHead)
        assert.equal(snapshotManagedSkill(imported.repository.managedPath).digest, beforeSnapshot.digest)
        assert.equal(fixture.store.listVersions(skill.id).length, versionCount)
        await assert.rejects(
            () => fixture.git.resolve(imported.repository.managedPath, "rolling-skill/billing/1.0.0"),
        )
    })

    it("reads only registered Skill content and returns a redacted overview", async () => {
        const {manager} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-read-")
        write(join(source, "SKILL.md"), manifest("billing"))
        const imported = await manager.importSource({kind: "folder", location: source})

        const listVersions = manager.store.listVersions
        let listVersionCalls = 0
        manager.store.listVersions = () => {
            listVersionCalls += 1
            throw new Error("Would materialize 100,000 versions")
        }
        const boundedDetail = manager.readSkill(imported.skills[0].id, {
            includeVersions: false,
        })
        assert.equal(listVersionCalls, 0)
        assert.equal(Object.hasOwn(boundedDetail, "versions"), false)
        manager.store.listVersions = listVersions

        const detail = manager.readSkill(imported.skills[0].id)
        const overview = manager.overview()
        const catalog = manager.catalog()
        const versionPage = manager.listVersionPage({
            skillIds: [imported.skills[0].id],
            skillId: imported.skills[0].id,
            cursor: null,
            limit: 1,
        })

        assert.match(detail.manifest, /name: billing/)
        assert.match(detail.snapshot.digest, /^sha256:/)
        assert.equal(overview.repositories[0].source.location, basename(source))
        assert.equal(overview.repositories[0].managedPath, undefined)
        assert.doesNotMatch(JSON.stringify(overview), new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
        assert.deepEqual(overview.skills.map((entry) => entry.name), ["billing"])
        assert.deepEqual(catalog, {
            repositories: overview.repositories,
            skills: overview.skills,
        })
        assert.equal(versionPage.versions.length, 1)
        assert.equal(versionPage.versions[0].skillId, imported.skills[0].id)
        assert.equal(versionPage.nextCursor, null)
    })

    it("rescans Finder edits so repaired and newly added Skills can be versioned", async () => {
        const {manager, store} = managerFixture()
        const source = temporaryDirectory("rolling-skill-managed-rescan-")
        write(join(source, "SKILL.md"), manifest("billing"))
        const imported = await manager.importSource({kind: "folder", location: source})
        const repository = store.getRepository(imported.repository.id)
        write(
            join(repository.managedPath, "skills", "new-skill", "SKILL.md"),
            manifest("new-skill", "Newly added Skill"),
        )

        const rescanned = await manager.rescanAll()
        const added = rescanned.skills.find((entry) => entry.name === "new-skill")

        assert.ok(added?.id)
        assert.equal(added.status, "valid")
        const candidate = await manager.createCandidate({
            skillId: added.id,
            message: "Add new Skill",
        })
        assert.equal(candidate.skillId, added.id)
    })
})
