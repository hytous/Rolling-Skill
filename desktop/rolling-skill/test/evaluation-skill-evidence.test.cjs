const assert = require("node:assert/strict")
const {existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} = require("node:fs")
const {tmpdir} = require("node:os")
const {join} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {
    snapshotSkillEvidence,
    validateSkillEvidence,
} = require("../src/evaluation-skill-evidence.cjs")

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, {recursive: true, force: true})
    }
})

describe("evaluation Skill evidence snapshot", () => {
    it("freezes the selected SKILL and recursively linked local references", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        temporaryDirectories.push(root)
        mkdirSync(join(root, "references"))
        writeFileSync(join(root, "SKILL.md"), "Read [workflow](references/workflow.md).")
        writeFileSync(join(root, "references/workflow.md"), "Then read [format](format.md).")
        writeFileSync(join(root, "references/format.md"), "Return an evidence table.")

        const snapshot = snapshotSkillEvidence({name: "billing", path: join(root, "SKILL.md")})

        assert.equal(snapshot.schemaVersion, "rolling-skill-evaluation-skill-evidence/v1")
        assert.deepEqual(snapshot.files.map((entry) => entry.id), [
            "skill:SKILL.md",
            "skill:references/workflow.md",
            "skill:references/format.md",
        ])
        assert.match(snapshot.digest, /^sha256:[a-f0-9]{64}$/)
    })

    it("freezes references routed through inline-code and table text like the billing Skill", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        temporaryDirectories.push(root)
        mkdirSync(join(root, "references"))
        writeFileSync(
            join(root, "SKILL.md"),
            "| Task | Required file |\n| --- | --- |\n| Billing | `references/query_routing.md` |\nInstall via `DEPENDENCIES.md`.",
        )
        writeFileSync(join(root, "DEPENDENCIES.md"), "Install the billing CLI.")
        writeFileSync(
            join(root, "references/query_routing.md"),
            "Read `glossary.md` first. Write the generated report to `cloud_cost_report.md`.",
        )
        writeFileSync(join(root, "references/glossary.md"), "Definitions.")

        const snapshot = snapshotSkillEvidence({name: "billing", path: join(root, "SKILL.md")})

        assert.deepEqual(snapshot.files.map((entry) => entry.id), [
            "skill:SKILL.md",
            "skill:references/query_routing.md",
            "skill:DEPENDENCIES.md",
            "skill:references/glossary.md",
        ])
        assert.deepEqual(snapshot.warnings, [])
    })

    it("does not follow linked references outside the Skill directory", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        const outside = mkdtempSync(join(tmpdir(), "rolling-skill-outside-"))
        temporaryDirectories.push(root, outside)
        writeFileSync(join(outside, "secret.md"), "secret")
        symlinkSync(join(outside, "secret.md"), join(root, "escape.md"))
        writeFileSync(join(root, "SKILL.md"), "Never read [escape](escape.md).")

        const snapshot = snapshotSkillEvidence({name: "safe", path: join(root, "SKILL.md")})

        assert.deepEqual(snapshot.files.map((entry) => entry.id), ["skill:SKILL.md"])
        assert.equal(snapshot.warnings.length, 1)
    })

    it("keeps an explicit missing Markdown link as incomplete evidence", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        temporaryDirectories.push(root)
        writeFileSync(join(root, "SKILL.md"), "Read [required](references/missing.md).")

        const snapshot = snapshotSkillEvidence({name: "safe", path: join(root, "SKILL.md")})

        assert.deepEqual(snapshot.files.map((entry) => entry.id), ["skill:SKILL.md"])
        assert.match(snapshot.warnings[0], /missing\.md|no such file/iu)
    })

    it("rejects a selected SKILL.md symlink that escapes its selected directory", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        const outside = mkdtempSync(join(tmpdir(), "rolling-skill-outside-"))
        temporaryDirectories.push(root, outside)
        writeFileSync(join(outside, "SKILL.md"), "escaped Skill")
        symlinkSync(join(outside, "SKILL.md"), join(root, "SKILL.md"))

        assert.throws(
            () => snapshotSkillEvidence({name: "safe", path: join(root, "SKILL.md")}),
            /inside its Skill directory/i,
        )
    })

    it("does not freeze invalid UTF-8 reference bytes as replacement characters", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        temporaryDirectories.push(root)
        mkdirSync(join(root, "references"))
        writeFileSync(join(root, "SKILL.md"), "Read [binary](references/binary.md).")
        writeFileSync(join(root, "references/binary.md"), Buffer.from([0xc3, 0x28]))

        const snapshot = snapshotSkillEvidence({name: "safe", path: join(root, "SKILL.md")})

        assert.deepEqual(snapshot.files.map((entry) => entry.id), ["skill:SKILL.md"])
        assert.match(snapshot.warnings[0], /valid UTF-8/i)
        assert.throws(
            () => validateSkillEvidence(snapshot, {requireComplete: true}),
            /complete Skill evidence|warning|truncated/i,
        )
    })

    it("rejects a formally scored snapshot when a linked reference exceeds snapshot limits", () => {
        const root = mkdtempSync(join(tmpdir(), "rolling-skill-evidence-"))
        temporaryDirectories.push(root)
        mkdirSync(join(root, "references"))
        writeFileSync(join(root, "SKILL.md"), "Read [large](references/large.md).")
        writeFileSync(join(root, "references/large.md"), "x".repeat(100))

        const snapshot = snapshotSkillEvidence(
            {name: "limited", path: join(root, "SKILL.md")},
            {maxFileBytes: 64},
        )

        assert.equal(snapshot.truncated, true)
        assert.deepEqual(snapshot.files.map((entry) => entry.id), ["skill:SKILL.md"])
        assert.throws(
            () => validateSkillEvidence(snapshot, {requireComplete: true}),
            /complete Skill evidence|warning|truncated/i,
        )
    })

    it("freezes the installed billing Skill routing references used by real evaluations", () => {
        const path = "/Users/wangbaoheng/.codex/plugins/cache/openai-primary-runtime/template-creator/26.805.11740/skills/billing-cost-management/SKILL.md"
        if (!existsSync(path)) return

        const snapshot = snapshotSkillEvidence({name: "billing-cost-management", path})
        const ids = new Set(snapshot.files.map((entry) => entry.id))

        for (const required of [
            "skill:SKILL.md",
            "skill:DEPENDENCIES.md",
            "skill:references/query_routing.md",
            "skill:references/glossary.md",
            "skill:references/cli_workflows.md",
            "skill:references/api_reference.md",
            "skill:references/report_routing.md",
            "skill:references/troubleshooting.md",
        ]) {
            assert.equal(ids.has(required), true, `missing ${required}`)
        }
        assert.deepEqual(snapshot.warnings, [])
    })
})
