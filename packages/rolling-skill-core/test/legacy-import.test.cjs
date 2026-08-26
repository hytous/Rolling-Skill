const assert = require("node:assert/strict")
const {createHash} = require("node:crypto")
const {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} = require("node:fs")
const {tmpdir} = require("node:os")
const {join, relative} = require("node:path")
const {afterEach, describe, it} = require("node:test")

const {AutomaticCaptureStateStore} = require("../../../desktop/rolling-skill/src/automatic-capture-state-store.cjs")
const {LocalEvaluationStore} = require("../../../desktop/rolling-skill/src/local-store.cjs")
const {ManagedSkillStore} = require("../../../desktop/rolling-skill/src/managed-skill-store.cjs")
const {RawCaseStore} = require("../../../desktop/rolling-skill/src/raw-case-store.cjs")
const {SkillInstallationStore} = require("../../../desktop/rolling-skill/src/skill-installation-store.cjs")
const {RollingSkillConfigStore} = require("../src/config-store.cjs")
const {resolveDataPaths} = require("../src/data-root.cjs")

const directories = []
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function temporaryDirectory(prefix) {
    const directory = mkdtempSync(join(tmpdir(), prefix))
    directories.push(directory)
    return directory
}

function digestTree(root) {
    const hash = createHash("sha256")
    function visit(directory) {
        for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
            const path = join(directory, entry.name)
            hash.update(relative(root, path))
            if (entry.isDirectory()) visit(path)
            else hash.update(readFileSync(path))
        }
    }
    visit(root)
    return hash.digest("hex")
}

function legacyFixture() {
    const sourceRoot = temporaryDirectory("rolling-skill-electron-data-")
    const evaluation = new LocalEvaluationStore(join(sourceRoot, "evaluation-store.json"))
    evaluation.createDataset({
        name: "Imported Cases",
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            name: "rolling-skill",
            path: null,
            scope: "plugin",
            description: "Legacy Rolling Skill",
            runtimeId: "deepseek-harness:legacy",
            providerId: "deepseek-harness",
            workspaceRoot: sourceRoot,
            evidencePrecision: "name-only",
            confirmedAt: "2026-08-26T00:00:00.000Z",
        },
    })
    new AutomaticCaptureStateStore(join(sourceRoot, "automatic-capture-state.json")).read()
    const rawCases = new RawCaseStore(join(sourceRoot, "raw-case-events.jsonl"))
    rawCases.add({question: "Keep this legacy question", skill: {name: "rolling-skill"}, source: {kind: "manual"}})
    rawCases.close()
    new ManagedSkillStore(join(sourceRoot, "skill-registry.json")).read()
    new SkillInstallationStore(join(sourceRoot, "skill-installations.json")).read()
    mkdirSync(join(sourceRoot, "repositories", "repo-1"), {recursive: true})
    writeFileSync(join(sourceRoot, "repositories", "repo-1", "README.md"), "legacy repository\n")
    mkdirSync(join(sourceRoot, "traces", "evaluations"), {recursive: true})
    writeFileSync(join(sourceRoot, "traces", "evaluations", "trace.jsonl"), "{\"kind\":\"legacy\"}\n")
    writeFileSync(join(sourceRoot, "operator-jobs.json"), JSON.stringify({
        schemaVersion: "rolling-skill-operator-jobs/v2",
        sessions: [], jobs: [], steps: [], approvals: [], artifacts: [], events: [],
    }))
    writeFileSync(join(sourceRoot, "optimization-runs.json"), JSON.stringify({
        schemaVersion: "rolling-skill-optimization-runs/v1",
        generation: "legacy-generation",
        revision: 0,
        runs: [],
        creationKeys: [],
    }))
    return sourceRoot
}

describe("Rolling Skill legacy Electron import", () => {
    it("detects the archived macOS Electron data directory", () => {
        const {detectLegacyElectronDataRoot} = require("../src/legacy-import.cjs")
        assert.equal(detectLegacyElectronDataRoot({
            platform: "darwin",
            homeDirectory: "/Users/example",
            environment: {},
        }), "/Users/example/Library/Application Support/Rolling Skill")
    })

    it("copies, validates, and atomically imports known data without changing the source", () => {
        const {importLegacyData, inspectLegacyImport} = require("../src/legacy-import.cjs")
        const sourceRoot = legacyFixture()
        const destinationRoot = temporaryDirectory("rolling-skill-dsh-import-")
        const paths = resolveDataPaths({dataRoot: destinationRoot})
        new RollingSkillConfigStore(paths.config).read()
        const before = digestTree(sourceRoot)

        assert.equal(inspectLegacyImport({sourceRoot, destinationRoot}).available, true)
        const result = importLegacyData({
            sourceRoot,
            destinationRoot,
            now: () => new Date("2026-08-26T12:00:00.000Z"),
        })
        assert.equal(result.status, "imported")
        assert.equal(result.restartRequired, true)
        assert.equal(digestTree(sourceRoot), before)
        assert.equal(statSync(paths.evaluationStore).isFile(), true)
        assert.match(readFileSync(paths.rawCaseEvents, "utf8"), /Keep this legacy question/u)
        assert.match(readFileSync(join(paths.managedSkills, "repositories", "repo-1", "README.md"), "utf8"), /legacy repository/u)
        assert.match(readFileSync(join(paths.traces, "evaluations", "trace.jsonl"), "utf8"), /legacy/u)
        const migration = JSON.parse(readFileSync(paths.migration, "utf8"))
        assert.equal(migration.schemaVersion, "rolling-skill-legacy-import/v1")
        assert.equal(migration.sourceRoot, realpathSync(sourceRoot))
        assert.equal(migration.importedAt, "2026-08-26T12:00:00.000Z")

        assert.equal(importLegacyData({sourceRoot, destinationRoot}).status, "already-imported")
    })

    it("rejects destination conflicts and removes staging after schema failure", () => {
        const {importLegacyData} = require("../src/legacy-import.cjs")
        const sourceRoot = legacyFixture()
        const conflictRoot = temporaryDirectory("rolling-skill-dsh-conflict-")
        writeFileSync(join(conflictRoot, "valuable.txt"), "keep me")
        assert.throws(() => importLegacyData({sourceRoot, destinationRoot: conflictRoot}), /not empty|conflict/iu)
        assert.equal(readFileSync(join(conflictRoot, "valuable.txt"), "utf8"), "keep me")

        const invalidSource = temporaryDirectory("rolling-skill-invalid-source-")
        writeFileSync(join(invalidSource, "evaluation-store.json"), JSON.stringify({schemaVersion: "unknown/v1"}))
        const destinationRoot = temporaryDirectory("rolling-skill-dsh-rollback-")
        new RollingSkillConfigStore(join(destinationRoot, "config.json")).read()
        assert.throws(() => importLegacyData({sourceRoot: invalidSource, destinationRoot}), /schema/iu)
        assert.equal(statSync(join(destinationRoot, "config.json")).isFile(), true)
        assert.equal(readdirSync(join(destinationRoot, "..")).some((name) => name.includes(".import-staging-")), false)
    })

    it("exposes Host-owned detection and confirmed import through the shared application", async () => {
        const {createRollingSkillApplication} = require("../src/application.cjs")
        const sourceRoot = legacyFixture()
        const dataRoot = temporaryDirectory("rolling-skill-dsh-application-import-")
        const application = createRollingSkillApplication({
            dataRoot,
            legacySourceRoot: sourceRoot,
        })

        assert.equal((await application.dispatch("legacyImport.status", {})).status, "ready")
        assert.equal((await application.dispatch("legacyImport.run", {confirmed: true})).status, "imported")
        assert.equal((await application.dispatch("legacyImport.status", {})).status, "already-imported")
        await application.close()
    })
})
