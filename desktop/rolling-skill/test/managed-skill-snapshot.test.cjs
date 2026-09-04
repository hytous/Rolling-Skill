const assert = require("node:assert/strict")
const {
    chmodSync,
    mkdtempSync,
    mkdirSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {dirname, join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    scanManagedSkillRepository,
    snapshotManagedSkill,
} = require("../src/managed-skill-snapshot.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory(prefix = "rolling-skill-managed-snapshot-") {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    temporaryDirectories.push(directory)
    return directory
}

function repositoryFixture(files) {
    const root = temporaryDirectory()
    for (const [relativePath, contents] of Object.entries(files)) {
        const path = join(root, relativePath)
        mkdirSync(dirname(path), {recursive: true})
        writeFileSync(path, contents)
    }
    return root
}

function manifest(name, description) {
    return `---\nname: ${name}\ndescription: ${description}\n---\n\nUse this Skill.\n`
}

describe("managed Skill repository snapshots", () => {
    it("discovers every SKILL.md in stable path order and parses its frontmatter", () => {
        const root = repositoryFixture({
            "skills/two/SKILL.md": manifest("two", "Second Skill"),
            "skills/one/SKILL.md": manifest("one", "First Skill"),
            "skills/one/references/guide.md": "Guide",
            ".git/ignored/SKILL.md": manifest("ignored", "Ignored Skill"),
        })

        const result = scanManagedSkillRepository(root)

        assert.deepEqual(
            result.skills.map(({name, description, skillRoot, manifestPath, status}) => ({
                name,
                description,
                skillRoot,
                manifestPath,
                status,
            })),
            [
                {
                    name: "one",
                    description: "First Skill",
                    skillRoot: "skills/one",
                    manifestPath: "skills/one/SKILL.md",
                    status: "valid",
                },
                {
                    name: "two",
                    description: "Second Skill",
                    skillRoot: "skills/two",
                    manifestPath: "skills/two/SKILL.md",
                    status: "valid",
                },
            ],
        )
        assert.deepEqual(result.warnings, [])
        assert.equal(result.stats.fileCount, 3)
    })

    it("marks malformed Skill frontmatter invalid without hiding the discovered root", () => {
        const root = repositoryFixture({
            "SKILL.md": "---\nname: Not Valid\ndescription: ''\n---\n",
        })

        const result = scanManagedSkillRepository(root)

        assert.equal(result.skills.length, 1)
        assert.equal(result.skills[0].skillRoot, ".")
        assert.equal(result.skills[0].status, "invalid")
        assert.match(result.skills[0].warnings.join("\n"), /name|description/i)
    })

    it("rejects directory identity mismatches and relative references outside the Skill root", () => {
        const root = repositoryFixture({
            "skills/billing/SKILL.md": `${manifest("renamed", "Renamed Skill")}\n[escape](../../secret.md)\n`,
            "secret.md": "secret",
        })

        const result = scanManagedSkillRepository(root)

        assert.equal(result.skills[0].status, "invalid")
        assert.match(result.skills[0].warnings.join("\n"), /directory.*name/i)
        assert.match(result.skills[0].warnings.join("\n"), /reference.*outside/i)
    })

    it("fingerprints paths, bytes, and executable mode deterministically", () => {
        const root = repositoryFixture({
            "SKILL.md": manifest("sample", "Sample Skill"),
            "scripts/run.sh": "#!/bin/sh\necho ok\n",
            "references/guide.md": "Guide",
        })

        const first = snapshotManagedSkill(root)
        const unchanged = snapshotManagedSkill(root)
        writeFileSync(join(root, ".rolling-skill-managed.json"), "{\"version\":1}\n")
        const withManagedMarker = snapshotManagedSkill(root)
        writeFileSync(join(root, ".rolling-skill-experiment.json"), "{\"epoch\":1}\n")
        const withExperimentMarker = snapshotManagedSkill(root)
        chmodSync(join(root, "scripts/run.sh"), 0o755)
        const executable = snapshotManagedSkill(root)
        writeFileSync(join(root, "references/guide.md"), "Changed guide")
        const changed = snapshotManagedSkill(root)

        assert.match(first.digest, /^sha256:[a-f0-9]{64}$/)
        assert.equal(first.digest, unchanged.digest)
        assert.notEqual(first.digest, withManagedMarker.digest)
        assert.notEqual(withManagedMarker.digest, withExperimentMarker.digest)
        assert.equal(
            withManagedMarker.files.some((entry) => entry.path === ".rolling-skill-managed.json"),
            true,
        )
        assert.equal(
            withExperimentMarker.files.some((entry) => entry.path === ".rolling-skill-experiment.json"),
            true,
        )
        assert.deepEqual(first.files.map((entry) => entry.path), [
            "SKILL.md",
            "references/guide.md",
            "scripts/run.sh",
        ])
        assert.notEqual(first.digest, executable.digest)
        assert.notEqual(executable.digest, changed.digest)
        assert.equal(executable.files.find((entry) => entry.path === "scripts/run.sh").executable, true)
    })

    it("records contained symbolic links but rejects links outside the Skill root", () => {
        const root = repositoryFixture({
            "SKILL.md": manifest("links", "Linked Skill"),
            "references/guide.md": "Guide",
        })
        symlinkSync("guide.md", join(root, "references", "current.md"))

        const snapshot = snapshotManagedSkill(root)

        assert.deepEqual(
            snapshot.files.find((entry) => entry.path === "references/current.md"),
            {
                path: "references/current.md",
                type: "symlink",
                executable: false,
                size: 8,
                linkTarget: "guide.md",
            },
        )

        const outside = temporaryDirectory("rolling-skill-managed-outside-")
        writeFileSync(join(outside, "secret.md"), "secret")
        symlinkSync(join(outside, "secret.md"), join(root, "escape.md"))

        assert.throws(() => snapshotManagedSkill(root), /outside the Skill root/i)
        assert.throws(() => scanManagedSkillRepository(root), /outside the repository/i)
    })

    it("enforces file count, per-file, and aggregate byte limits", () => {
        const root = repositoryFixture({
            "SKILL.md": manifest("limited", "Limited Skill"),
            "one.txt": "12345",
            "two.txt": "67890",
        })

        assert.throws(
            () => scanManagedSkillRepository(root, {maxFiles: 2}),
            /file count limit/i,
        )
        assert.throws(
            () => snapshotManagedSkill(root, {maxFileBytes: 4}),
            /single-file limit/i,
        )
        assert.throws(
            () => snapshotManagedSkill(root, {maxTotalBytes: 10}),
            /total byte limit/i,
        )
    })

    it("counts directories toward the repository entry limit", () => {
        const root = repositoryFixture({
            "SKILL.md": manifest("limited", "Limited Skill"),
        })
        mkdirSync(join(root, "empty", "nested"), {recursive: true})

        assert.throws(
            () => scanManagedSkillRepository(root, {maxFiles: 2}),
            /file count limit/i,
        )
    })
})
