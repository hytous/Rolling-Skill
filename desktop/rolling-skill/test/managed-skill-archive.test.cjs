const assert = require("node:assert/strict")
const {
    createWriteStream,
    existsSync,
    lstatSync,
    mkdtempSync,
    readFileSync,
    readlinkSync,
    rmSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")
const yazl = require("yazl")

const {extractManagedSkillZip} = require("../src/managed-skill-archive.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

function temporaryDirectory() {
    const directory = mkdtempSync(join(tmpdir(), "rolling-skill-managed-archive-"))
    temporaryDirectories.push(directory)
    return directory
}

function createZip(root, entries, name = "fixture.zip") {
    const path = join(root, name)
    const zip = new yazl.ZipFile()
    for (const entry of entries) {
        if (entry.directory) {
            zip.addEmptyDirectory(entry.path, {mode: entry.mode ?? 0o40755})
        } else {
            zip.addBuffer(Buffer.from(entry.contents), entry.path, {
                mode: entry.mode ?? 0o100644,
                compress: entry.compress !== false,
            })
        }
    }
    zip.end()
    return new Promise((resolve, reject) => {
        const output = createWriteStream(path)
        zip.outputStream.once("error", reject)
        output.once("error", reject)
        output.once("close", () => resolve(path))
        zip.outputStream.pipe(output)
    })
}

function replaceZipPath(path, before, after) {
    assert.equal(Buffer.byteLength(before), Buffer.byteLength(after))
    const buffer = readFileSync(path)
    const source = Buffer.from(before)
    const replacement = Buffer.from(after)
    let offset = 0
    let replaced = 0
    while ((offset = buffer.indexOf(source, offset)) >= 0) {
        replacement.copy(buffer, offset)
        offset += source.length
        replaced += 1
    }
    assert.ok(replaced >= 2, "local and central ZIP names must both be replaced")
    writeFileSync(path, buffer)
}

describe("managed Skill ZIP extraction", () => {
    it("extracts nested files, executable mode, and contained symbolic links", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "SKILL.md", contents: "Skill"},
            {path: "scripts/run.sh", contents: "#!/bin/sh\n", mode: 0o100755},
            {path: "references/guide.md", contents: "Guide"},
            {path: "references/current.md", contents: "guide.md", mode: 0o120777},
        ])
        const destination = join(root, "extracted")

        const result = await extractManagedSkillZip(zip, destination)

        assert.deepEqual(result.files, [
            "SKILL.md",
            "references/current.md",
            "references/guide.md",
            "scripts/run.sh",
        ])
        assert.equal(lstatSync(join(destination, "scripts/run.sh")).mode & 0o111, 0o111)
        assert.equal(lstatSync(join(destination, "references/current.md")).isSymbolicLink(), true)
        assert.equal(readlinkSync(join(destination, "references/current.md")), "guide.md")
    })

    it("strips embedded Git metadata before the managed repository is initialized", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "SKILL.md", contents: "Skill"},
            {path: ".GIT/config", contents: "[filter \"unsafe\"]\nclean = false\n"},
            {path: "nested/.git/hooks/pre-commit", contents: "#!/bin/sh\nexit 91\n", mode: 0o100755},
        ])
        const destination = join(root, "extracted")

        const result = await extractManagedSkillZip(zip, destination)

        assert.deepEqual(result.files, ["SKILL.md"])
        assert.equal(existsSync(join(destination, ".git")), false)
        assert.equal(existsSync(join(destination, ".GIT")), false)
        assert.equal(existsSync(join(destination, "nested", ".git")), false)
    })

    for (const [label, before, after] of [
        ["parent traversal", "aa/x", "../x"],
        ["absolute path", "aa/x", "/a/x"],
        ["drive-prefixed path", "aa/x", "C:/x"],
    ]) {
        it(`rejects a ${label} entry and cleans the destination`, async () => {
            const root = temporaryDirectory()
            const zip = await createZip(root, [{path: before, contents: "unsafe"}])
            replaceZipPath(zip, before, after)
            const destination = join(root, "extracted")

            await assert.rejects(
                () => extractManagedSkillZip(zip, destination),
                /unsafe|absolute|relative path|drive|invalid/i,
            )
            assert.equal(existsSync(destination), false)
            assert.equal(existsSync(join(root, "x")), false)
        })
    }

    it("rejects duplicate normalized paths", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "one.txt", contents: "one"},
            {path: "two.txt", contents: "two"},
        ])
        replaceZipPath(zip, "two.txt", "one.txt")

        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "extracted")),
            /duplicate/i,
        )
    })

    it("enforces file count, single-file, and total byte limits", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "one.txt", contents: "123456"},
            {path: "two.txt", contents: "abcdef"},
        ])

        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "count"), {maxFiles: 1}),
            /file count/i,
        )
        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "single"), {maxFileBytes: 5}),
            /single-file/i,
        )
        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "total"), {maxTotalBytes: 10}),
            /total byte/i,
        )
    })

    it("counts directories and stripped Git metadata toward the archive entry limit", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "empty/", directory: true},
            {path: ".GIT/config", contents: "[core]\nfsmonitor = unsafe\n"},
            {path: "SKILL.md", contents: "Skill"},
        ])

        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "extracted"), {maxFiles: 2}),
            /file count limit/i,
        )
    })

    it("rejects suspicious compression ratios before extraction", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [{
            path: "large.txt",
            contents: Buffer.alloc(100_000),
        }])

        await assert.rejects(
            () => extractManagedSkillZip(zip, join(root, "extracted"), {
                maxCompressionRatio: 10,
            }),
            /compression ratio/i,
        )
    })

    it("rejects symbolic links that escape the extraction root", async () => {
        const root = temporaryDirectory()
        const zip = await createZip(root, [
            {path: "SKILL.md", contents: "Skill"},
            {path: "references/escape.md", contents: "../../secret", mode: 0o120777},
        ])
        const destination = join(root, "extracted")

        await assert.rejects(
            () => extractManagedSkillZip(zip, destination),
            /symbolic link.*outside/i,
        )
        assert.equal(existsSync(destination), false)
    })
})
