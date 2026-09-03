const assert = require("node:assert/strict")
const {
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    MANAGED_SKILL_SCHEMA,
    ManagedSkillStore,
} = require("../src/managed-skill-store.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "rolling-skill-managed-store-"))
    temporaryDirectories.push(root)
    const path = join(root, "private", "skill-registry.json")
    return {root, path, store: new ManagedSkillStore(path)}
}

function addRepository(store, root, suffix = "one") {
    return store.addRepository({
        displayName: `Repository ${suffix}`,
        managedPath: join(root, "repositories", suffix),
        defaultBranch: "main",
        source: {kind: "folder", location: `/source/${suffix}`},
    })
}

function addSkill(store, repositoryId, name = "billing", skillRoot = ".") {
    return store.replaceRepositorySkills(repositoryId, [{
        name,
        description: `${name} Skill`,
        skillRoot,
        manifestPath: skillRoot === "." ? "SKILL.md" : `${skillRoot}/SKILL.md`,
        status: "valid",
        warnings: [],
        executableFiles: ["scripts/run.sh"],
    }])[0]
}

function addCandidate(store, repository, skill, commitCharacter = "a") {
    return store.addVersion({
        repositoryId: repository.id,
        skillId: skill.id,
        commit: commitCharacter.repeat(40),
        contentDigest: `sha256:${"b".repeat(64)}`,
        state: "candidate",
        createdBy: "import",
    })
}

function versionRecord(index, skillId = "skill-1") {
    return {
        id: `version-${index}`,
        repositoryId: skillId === "skill-1" ? "repository-1" : "repository-2",
        skillId,
        skillRoot: ".",
        commit: index.toString(16).padStart(40, "0"),
        contentDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
        state: "candidate",
        versionLabel: null,
        createdBy: "optimization",
        optimizationRoundId: null,
        createdAt: "2026-08-23T00:00:00.000Z",
        releasedAt: null,
        deprecatedAt: null,
    }
}

describe("managed Skill registry", () => {
    it("creates a private versioned registry and returns defensive copies", () => {
        const {path, store} = fixture()
        const snapshot = store.read()

        assert.equal(snapshot.schemaVersion, MANAGED_SKILL_SCHEMA)
        assert.deepEqual(snapshot.repositories, [])
        assert.deepEqual(snapshot.skills, [])
        assert.deepEqual(snapshot.versions, [])
        assert.equal(statSync(path).mode & 0o777, 0o600)
        assert.equal(statSync(join(path, "..")).mode & 0o777, 0o700)

        snapshot.repositories.push({id: "mutated"})
        assert.deepEqual(store.read().repositories, [])
    })

    it("persists repositories and rejects duplicate managed paths", () => {
        const {root, path, store} = fixture()
        const repository = addRepository(store, root)

        assert.match(repository.id, /^[a-f0-9-]{36}$/)
        assert.equal(repository.source.kind, "folder")
        assert.throws(
            () => store.addRepository({
                displayName: "Duplicate",
                managedPath: repository.managedPath,
                defaultBranch: "main",
                source: {kind: "zip", location: "/source/archive.zip"},
            }),
            /managed path already exists/i,
        )

        const reopened = new ManagedSkillStore(path)
        assert.deepEqual(reopened.listRepositories(), [repository])
        assert.doesNotMatch(readFileSync(path, "utf8"), /undefined/)
    })

    it("rolls back in-memory state when an atomic registry write fails", () => {
        const {root, path, store} = fixture()
        const before = store.read()
        const persist = store.persist.bind(store)
        store.persist = () => {
            throw new Error("simulated atomic write failure")
        }
        try {
            assert.throws(() => addRepository(store, root), /simulated atomic write failure/i)
        } finally {
            store.persist = persist
        }

        assert.deepEqual(store.read(), before)
        assert.deepEqual(new ManagedSkillStore(path).read(), before)
    })

    it("persists nested repository mutations as one atomic transaction", () => {
        const {root, store} = fixture()
        const persist = store.persist.bind(store)
        let writes = 0
        store.persist = () => {
            writes += 1
            persist()
        }

        const result = store.transaction(() => {
            const repository = addRepository(store, root)
            const skill = addSkill(store, repository.id)
            return {repository, skill}
        })

        assert.equal(writes, 1)
        assert.equal(store.listRepositories().length, 1)
        assert.equal(store.listSkills().length, 1)
        assert.equal(result.skill.repositoryId, result.repository.id)
    })

    it("rejects a relative managed repository path", () => {
        const {store} = fixture()

        assert.throws(
            () => store.addRepository({
                displayName: "Relative",
                managedPath: "repositories/relative",
                defaultBranch: "main",
                source: {kind: "folder", location: "/source/relative"},
            }),
            /must be absolute/i,
        )
    })

    it("preserves Skill identity across rescans and marks versioned missing roots", () => {
        const {root, store} = fixture()
        const repository = addRepository(store, root)
        const first = addSkill(store, repository.id)
        addCandidate(store, repository, first)

        const rescanned = store.replaceRepositorySkills(repository.id, [{
            name: "other",
            description: "Other Skill",
            skillRoot: "skills/other",
            manifestPath: "skills/other/SKILL.md",
            status: "valid",
            warnings: [],
            executableFiles: [],
        }])

        const missing = store.getSkill(first.id)
        assert.equal(missing.id, first.id)
        assert.equal(missing.status, "missing")
        assert.match(missing.warnings.join("\n"), /not found/i)
        assert.deepEqual(rescanned.map((entry) => entry.name), ["other", "billing"])
    })

    it("requires an explicit migration when a Skill name changes at the same root", () => {
        const {root, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)

        assert.throws(
            () => store.replaceRepositorySkills(repository.id, [{
                name: "renamed-billing",
                description: "Renamed billing Skill",
                skillRoot: skill.skillRoot,
                manifestPath: "SKILL.md",
                status: "valid",
                warnings: [],
                executableFiles: [],
            }]),
            /rename.*migration/i,
        )
        assert.equal(store.getSkill(skill.id).name, "billing")
    })

    it("creates immutable candidates and releases unique labels per Skill", () => {
        const {root, path, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)
        const candidate = addCandidate(store, repository, skill)

        assert.throws(
            () => addCandidate(store, repository, skill),
            /version already exists/i,
        )
        const released = store.releaseVersion(candidate.id, "v1.0.0")
        assert.equal(released.state, "released")
        assert.equal(released.versionLabel, "v1.0.0")
        assert.equal(released.commit, candidate.commit)
        assert.ok(released.releasedAt)
        assert.throws(() => store.releaseVersion(candidate.id, "v1.0.1"), /already released/i)

        const second = store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "c".repeat(40),
            contentDigest: `sha256:${"d".repeat(64)}`,
            state: "candidate",
            createdBy: "user",
        })
        assert.throws(() => store.releaseVersion(second.id, "v1.0.0"), /label already exists/i)

        const reopened = new ManagedSkillStore(path)
        assert.equal(reopened.listVersions(skill.id)[0].versionLabel, "v1.0.0")
    })

    it("persists exact optimization Run and Epoch provenance for generated Candidates", () => {
        const {root, path, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)
        const candidate = store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "e".repeat(40),
            contentDigest: `sha256:${"f".repeat(64)}`,
            state: "candidate",
            createdBy: "optimization",
            optimizationRunId: "optimization-run-1",
            optimizationEpoch: 101,
        })

        assert.equal(candidate.optimizationRunId, "optimization-run-1")
        assert.equal(candidate.optimizationEpoch, 101)
        assert.equal(new ManagedSkillStore(path).getVersion(candidate.id).optimizationEpoch, 101)
        assert.throws(() => store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "3".repeat(40),
            contentDigest: `sha256:${"4".repeat(64)}`,
            state: "candidate",
            createdBy: "optimization",
            optimizationRunId: "optimization-run-1",
            optimizationEpoch: 101,
        }), /Run.*Epoch|provenance|already/i)
        assert.throws(() => store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "1".repeat(40),
            contentDigest: `sha256:${"2".repeat(64)}`,
            state: "candidate",
            createdBy: "optimization",
            optimizationRunId: "optimization-run-2",
            optimizationEpoch: 0,
        }), /epoch/i)
    })

    it("deprecates releases without deleting their evidence", () => {
        const {root, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)
        const released = store.releaseVersion(
            addCandidate(store, repository, skill).id,
            "v1.0.0",
        )

        const deprecated = store.deprecateVersion(released.id)

        assert.equal(deprecated.state, "released")
        assert.ok(deprecated.deprecatedAt)
        assert.equal(store.listVersions(skill.id).length, 1)
    })

    it("matches the existing version order across bounded pages", () => {
        const {store} = fixture()
        store.state.versions = [
            {
                ...versionRecord(6),
                id: "candidate-b",
                createdAt: "2026-08-23T06:00:00.000Z",
            },
            {
                ...versionRecord(3),
                id: "released-b",
                state: "released",
                versionLabel: "v3",
                releasedAt: "2026-08-23T03:00:00.000Z",
            },
            {
                ...versionRecord(5),
                id: "candidate-new",
                createdAt: "2026-08-23T07:00:00.000Z",
            },
            {
                ...versionRecord(1),
                id: "released-new",
                state: "released",
                versionLabel: "v1",
                releasedAt: "2026-08-23T04:00:00.000Z",
            },
            {
                ...versionRecord(2),
                id: "released-a-deprecated",
                state: "released",
                versionLabel: "v2",
                releasedAt: "2026-08-23T03:00:00.000Z",
                deprecatedAt: "2026-08-23T05:00:00.000Z",
            },
            {
                ...versionRecord(4),
                id: "candidate-a",
                createdAt: "2026-08-23T06:00:00.000Z",
            },
        ]
        const buildVersionOrderIndex = store.buildVersionOrderIndex.bind(store)
        let indexBuilds = 0
        store.buildVersionOrderIndex = () => {
            indexBuilds += 1
            return buildVersionOrderIndex()
        }
        const expected = store.listVersions().map((version) => version.id)
        assert.deepEqual(expected, [
            "released-new",
            "released-a-deprecated",
            "released-b",
            "candidate-new",
            "candidate-a",
            "candidate-b",
        ])

        const paged = []
        let cursor = null
        do {
            const page = store.listVersionPage({
                skillIds: ["skill-1"],
                skillId: null,
                cursor,
                limit: 2,
            })
            paged.push(...page.versions.map((version) => version.id))
            cursor = page.nextCursor
        } while (cursor !== null)

        assert.deepEqual(paged, expected)
        assert.equal(indexBuilds, 1)
    })

    it("rebuilds order inside a transaction and restores the prior cache on rollback", () => {
        const {store} = fixture()
        store.state.versions = [
            {...versionRecord(1), id: "candidate"},
            {
                ...versionRecord(2),
                id: "released",
                state: "released",
                versionLabel: "v1",
                releasedAt: "2026-08-23T01:00:00.000Z",
            },
        ]
        assert.deepEqual(
            store.listVersions().map((version) => version.id),
            ["released", "candidate"],
        )
        const priorOrderIndex = store.versionOrderIndex
        const persist = store.persist.bind(store)
        store.persist = () => {
            throw new Error("simulated version registry write failure")
        }
        try {
            assert.throws(() => store.transaction(() => {
                store.state.versions.reverse()
                assert.deepEqual(
                    store.listVersions().map((version) => version.id),
                    ["released", "candidate"],
                )
            }), /simulated version registry write failure/i)
        } finally {
            store.persist = persist
        }

        assert.equal(store.versionOrderIndex, priorOrderIndex)
        assert.deepEqual(
            store.listVersions().map((version) => version.id),
            ["released", "candidate"],
        )
    })

    it("builds one stable order index while traversing 100,000 bounded version pages", () => {
        const {store} = fixture()
        const versions = Array.from({length: 100_000}, (_, index) =>
            versionRecord(index, index % 2 === 0 ? "skill-1" : "skill-2"),
        )
        store.state.versions = versions
        const buildVersionOrderIndex = store.buildVersionOrderIndex.bind(store)
        let indexBuilds = 0
        store.buildVersionOrderIndex = () => {
            indexBuilds += 1
            return buildVersionOrderIndex()
        }

        const collected = []
        let cursor = null
        do {
            const page = store.listVersionPage({
                skillIds: ["skill-1"],
                skillId: null,
                cursor,
                limit: 100,
            })
            assert.ok(page.versions.length <= 100)
            assert.ok(page.versions.every((version) => version.skillId === "skill-1"))
            collected.push(...page.versions.map((version) => version.id))
            cursor = page.nextCursor
        } while (cursor !== null)

        assert.equal(collected.length, 50_000)
        assert.equal(new Set(collected).size, 50_000)
        assert.equal(collected[0], "version-0")
        assert.equal(collected.at(-1), "version-99998")
        assert.equal(indexBuilds, 1)
    })

    it("rejects a version cursor after any successful catalog revision", () => {
        const {root, path, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)
        addCandidate(store, repository, skill, "a")
        store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "c".repeat(40),
            contentDigest: `sha256:${"d".repeat(64)}`,
            state: "candidate",
            createdBy: "user",
        })
        const first = store.listVersionPage({
            skillIds: [skill.id],
            skillId: skill.id,
            cursor: null,
            limit: 1,
        })
        assert.ok(first.nextCursor)
        const firstOrderIndex = store.versionOrderIndex
        assert.ok(firstOrderIndex)

        store.addVersion({
            repositoryId: repository.id,
            skillId: skill.id,
            commit: "e".repeat(40),
            contentDigest: `sha256:${"f".repeat(64)}`,
            state: "candidate",
            createdBy: "user",
        })
        assert.equal(store.versionOrderIndex, null)

        assert.throws(
            () => store.listVersionPage({
                skillIds: [skill.id],
                skillId: skill.id,
                cursor: first.nextCursor,
                limit: 1,
            }),
            (error) => error.code === "MANAGED_SKILL_VERSION_CURSOR_STALE",
        )

        store.listVersionPage({
            skillIds: [skill.id],
            skillId: skill.id,
            cursor: null,
            limit: 1,
        })
        assert.notEqual(store.versionOrderIndex, firstOrderIndex)

        const reopened = new ManagedSkillStore(path)
        assert.equal(reopened.versionOrderIndex, null)
        reopened.listVersionPage({
            skillIds: [skill.id],
            skillId: skill.id,
            cursor: null,
            limit: 1,
        })
        assert.ok(reopened.versionOrderIndex)
    })

    it("protects referenced repositories unless an explicit cascade is requested", () => {
        const {root, store} = fixture()
        const repository = addRepository(store, root)
        const skill = addSkill(store, repository.id)
        addCandidate(store, repository, skill)

        assert.throws(() => store.removeRepository(repository.id), /versions/i)
        const removed = store.removeRepository(repository.id, {cascade: true})

        assert.equal(removed.repository.id, repository.id)
        assert.equal(removed.skillCount, 1)
        assert.equal(removed.versionCount, 1)
        assert.deepEqual(store.read().repositories, [])
        assert.deepEqual(store.read().skills, [])
        assert.deepEqual(store.read().versions, [])
    })

    it("fails closed on corrupted or unsupported registry data", () => {
        const {path} = fixture()
        writeFileSync(path, "not json\n")
        assert.throws(() => new ManagedSkillStore(path), /read managed Skill registry/i)

        writeFileSync(path, JSON.stringify({schemaVersion: "future/v99"}))
        assert.throws(() => new ManagedSkillStore(path), /unsupported managed Skill registry/i)

        writeFileSync(path, JSON.stringify({
            schemaVersion: MANAGED_SKILL_SCHEMA,
            repositories: [{id: "orphan"}],
            skills: [],
            versions: [],
        }))
        assert.throws(() => new ManagedSkillStore(path), /read managed Skill registry/i)

        writeFileSync(path, JSON.stringify({
            schemaVersion: MANAGED_SKILL_SCHEMA,
            repositories: [],
            skills: [{
                id: "skill",
                repositoryId: "missing",
                name: "skill",
                skillRoot: ".",
                manifestPath: "SKILL.md",
                status: "valid",
                warnings: [],
                executableFiles: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }],
            versions: [],
        }))
        assert.throws(() => new ManagedSkillStore(path), /read managed Skill registry/i)
    })
})
