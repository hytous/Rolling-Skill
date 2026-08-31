const {randomUUID} = require("node:crypto")
const {
    chmodSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    writeFileSync,
} = require("node:fs")
const {homedir} = require("node:os")
const {basename, dirname, isAbsolute, join, relative, resolve, sep} = require("node:path")

const {ensureDataLayout, resolveDataPaths} = require("./data-root.cjs")

const MIGRATION_SCHEMA = "rolling-skill-legacy-import/v1"
const SOURCE_FILES = Object.freeze([
    {source: "evaluation-store.json", destination: "evaluation-store.json", schema: "evaluation"},
    {source: "automatic-capture-state.json", destination: "automatic-capture-state.json", schema: "automatic"},
    {source: "raw-case-events.jsonl", destination: "raw-cases/events.jsonl", schema: "raw-cases"},
    {source: "skill-registry.json", destination: "managed-skills/registry.json", schema: "managed-skills"},
    {source: "skill-installations.json", destination: "skill-installations.json", schema: "installations"},
    {source: "operator-jobs.json", destination: "jobs/operator-jobs.json", schema: "operator"},
    {source: "optimization-runs.json", destination: "jobs/optimization-runs.json", schema: "optimization"},
])
const SOURCE_DIRECTORIES = Object.freeze([
    {source: "repositories", destination: "managed-skills/repositories"},
    {source: "traces", destination: "traces"},
])

function detectLegacyElectronDataRoot({
    platform = process.platform,
    homeDirectory = homedir(),
    environment = process.env,
} = {}) {
    const home = resolve(String(homeDirectory ?? ""))
    if (platform === "darwin") return join(home, "Library", "Application Support", "Rolling Skill")
    if (platform === "win32") {
        return join(String(environment?.APPDATA ?? join(home, "AppData", "Roaming")), "Rolling Skill")
    }
    return join(String(environment?.XDG_CONFIG_HOME ?? join(home, ".config")), "Rolling Skill")
}

function requiredRoot(value, label) {
    const path = String(value ?? "").trim()
    if (!path || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`)
    return resolve(path)
}

function contained(root, path) {
    return path === root || path.startsWith(`${root}${sep}`)
}

function json(path, label) {
    let value
    try {
        value = JSON.parse(readFileSync(path, "utf8"))
    } catch (error) {
        throw new Error(`${label} JSON is invalid: ${error.message}`)
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} schema is invalid`)
    }
    return value
}

function arrays(value, names, label) {
    for (const name of names) {
        if (!Array.isArray(value[name])) throw new Error(`${label} schema is invalid`)
    }
}

function validateFile(path, schema) {
    if (schema === "raw-cases") {
        const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim())
        for (const line of lines) {
            let event
            try {
                event = JSON.parse(line)
            } catch {
                throw new Error("Raw Case event schema is invalid")
            }
            if (event?.schemaVersion !== "rolling-skill-raw-case-event/v1" || typeof event.type !== "string") {
                throw new Error("Raw Case event schema is invalid")
            }
        }
        return
    }
    const value = json(path, `Legacy ${schema}`)
    if (schema === "evaluation") {
        if (!/^rolling-skill-local\/v\d+$/u.test(String(value.schemaVersion ?? ""))) {
            throw new Error("Legacy evaluation schema is unsupported")
        }
        arrays(value, ["datasets", "cases", "curationSessions", "datasetRubricVersions", "rubricSessions", "evaluationRuns"], "Legacy evaluation")
    } else if (schema === "automatic") {
        if (value.schemaVersion !== "rolling-skill-automatic-capture-state/v1") throw new Error("Legacy automatic capture schema is unsupported")
    } else if (schema === "managed-skills") {
        if (value.schemaVersion !== "rolling-skill-managed-skills/v1") throw new Error("Legacy managed Skill schema is unsupported")
        arrays(value, ["repositories", "skills", "versions"], "Legacy managed Skill")
    } else if (schema === "installations") {
        if (value.schemaVersion !== "rolling-skill-installations/v1") throw new Error("Legacy installation schema is unsupported")
        arrays(value, ["jobs", "installations"], "Legacy installation")
    } else if (schema === "operator") {
        if (!["rolling-skill-operator-jobs/v1", "rolling-skill-operator-jobs/v2"].includes(value.schemaVersion)) throw new Error("Legacy Operator schema is unsupported")
        arrays(value, ["sessions", "jobs", "steps", "approvals", "artifacts", "events"], "Legacy Operator")
    } else if (schema === "optimization") {
        if (value.schemaVersion !== "rolling-skill-optimization-runs/v1") throw new Error("Legacy optimization schema is unsupported")
        arrays(value, ["runs", "creationKeys"], "Legacy optimization")
    }
}

function validateSource(sourceRoot) {
    const root = realpathSync(sourceRoot)
    if (!lstatSync(root).isDirectory()) throw new Error("Legacy Electron data source is not a directory")
    let found = false
    for (const entry of SOURCE_FILES) {
        const path = join(root, entry.source)
        if (!existsSync(path)) continue
        if (!lstatSync(path).isFile()) throw new Error(`Legacy ${entry.source} is not a regular file`)
        validateFile(path, entry.schema)
        found = true
    }
    for (const entry of SOURCE_DIRECTORIES) {
        const path = join(root, entry.source)
        if (!existsSync(path)) continue
        if (!lstatSync(path).isDirectory()) throw new Error(`Legacy ${entry.source} is not a directory`)
        found = true
    }
    if (!found) throw new Error("No supported Rolling Skill Electron data was found")
    return root
}

function copyTree(source, destination, copied, relativeDestination) {
    const metadata = lstatSync(source)
    if (metadata.isSymbolicLink()) throw new Error(`Legacy data contains an unsupported symbolic link: ${source}`)
    if (metadata.isDirectory()) {
        mkdirSync(destination, {recursive: true, mode: 0o700})
        for (const name of readdirSync(source)) {
            copyTree(join(source, name), join(destination, name), copied, join(relativeDestination, name))
        }
        return
    }
    if (!metadata.isFile()) throw new Error(`Legacy data contains an unsupported file type: ${source}`)
    mkdirSync(dirname(destination), {recursive: true, mode: 0o700})
    copyFileSync(source, destination)
    chmodSync(destination, 0o600)
    copied.push(relativeDestination.replaceAll("\\", "/"))
}

function emptyJsonFile(path, schema) {
    const value = json(path, "DSH destination")
    if (schema === "evaluation") {
        return ["cases", "curationSessions", "datasetRubricVersions", "rubricSessions", "evaluationRuns"].every((key) => Array.isArray(value[key]) && value[key].length === 0) &&
            Array.isArray(value.datasets) && value.datasets.length <= 1 && (!value.datasets[0] || value.datasets[0].skillReference === null)
    }
    if (schema === "automatic") return value.lastScheduledSlot == null && value.lastRunAt == null && value.lastSuccessAt == null && value.lastError == null && Object.keys(value.runtimes ?? {}).length === 0
    if (schema === "managed-skills") return ["repositories", "skills", "versions"].every((key) => Array.isArray(value[key]) && value[key].length === 0)
    if (schema === "installations") return ["jobs", "installations"].every((key) => Array.isArray(value[key]) && value[key].length === 0)
    if (schema === "operator") return ["sessions", "jobs", "steps", "approvals", "artifacts", "events"].every((key) => Array.isArray(value[key]) && value[key].length === 0)
    if (schema === "optimization") return Array.isArray(value.runs) && value.runs.length === 0 && Array.isArray(value.creationKeys) && value.creationKeys.length === 0
    if (schema === "skill-edits") return value.schemaVersion === "rolling-skill-skill-edits/v1" && Array.isArray(value.edits) && value.edits.length === 0
    return false
}

function assertPristineDestination(destinationRoot) {
    if (!existsSync(destinationRoot)) return
    const allowedFiles = new Map([
        ["config.json", "config"],
        ["evaluation-store.json", "evaluation"],
        ["automatic-capture-state.json", "automatic"],
        ["raw-cases/events.jsonl", "raw-cases"],
        ["managed-skills/registry.json", "managed-skills"],
        ["skill-installations.json", "installations"],
        ["jobs/operator-jobs.json", "operator"],
        ["jobs/optimization-runs.json", "optimization"],
        ["jobs/skill-edits.json", "skill-edits"],
        ["jobs/.optimization-runs.json.owner", "optimization-owner"],
    ])
    const allowedEmptyDirectories = new Set([
        "raw-cases", "managed-skills", "managed-skills/repositories", "traces", "jobs",
        "logs", "locks", "scheduler", "optimization-workspaces", "skill-edit-workspaces",
    ])
    function visit(directory) {
        for (const name of readdirSync(directory)) {
            const path = join(directory, name)
            const relativePath = relative(destinationRoot, path).replaceAll("\\", "/")
            const metadata = lstatSync(path)
            if (metadata.isDirectory()) {
                if (!allowedEmptyDirectories.has(relativePath)) throw new Error(`DSH data destination conflict: ${relativePath}`)
                visit(path)
                continue
            }
            if (!metadata.isFile() || !allowedFiles.has(relativePath)) throw new Error(`DSH data destination conflict: ${relativePath}`)
            const schema = allowedFiles.get(relativePath)
            if (schema === "config") continue
            if (schema === "optimization-owner") {
                const owner = json(path, "Optimization ownership")
                if (owner.schemaVersion !== "rolling-skill-optimization-owner/v1" || owner.pid !== process.pid) {
                    throw new Error(`DSH data destination conflict: ${relativePath}`)
                }
                continue
            }
            if (schema === "raw-cases") {
                if (readFileSync(path, "utf8").trim()) throw new Error("DSH data destination is not empty")
            } else if (!emptyJsonFile(path, schema)) {
                throw new Error(`DSH data destination conflict: ${relativePath}`)
            }
        }
    }
    visit(destinationRoot)
}

function existingMigration(destinationRoot) {
    const path = join(destinationRoot, "migration.json")
    if (!existsSync(path)) return null
    const value = json(path, "Rolling Skill migration")
    return value.schemaVersion === MIGRATION_SCHEMA ? value : null
}

function inspectLegacyImport({sourceRoot, destinationRoot} = {}) {
    const source = requiredRoot(sourceRoot, "Legacy Electron data source")
    const destination = requiredRoot(destinationRoot, "DSH data destination")
    const migration = existingMigration(destination)
    if (migration) return {available: false, status: "already-imported", sourceRoot: migration.sourceRoot, migration}
    if (!existsSync(source)) return {available: false, status: "not-found", sourceRoot: source, destinationRoot: destination}
    try {
        validateSource(source)
        assertPristineDestination(destination)
        return {available: true, status: "ready", sourceRoot: source, destinationRoot: destination}
    } catch (error) {
        return {available: false, status: "blocked", sourceRoot: source, destinationRoot: destination, error: String(error.message).slice(0, 2_000)}
    }
}

function importLegacyData({sourceRoot, destinationRoot, now = () => new Date()} = {}) {
    const source = requiredRoot(sourceRoot, "Legacy Electron data source")
    const destination = requiredRoot(destinationRoot, "DSH data destination")
    const previous = existingMigration(destination)
    if (previous) return {status: "already-imported", restartRequired: false, migration: previous}
    const realSource = validateSource(source)
    if (contained(realSource, destination) || contained(destination, realSource)) {
        throw new Error("Legacy source and DSH destination must not overlap")
    }
    assertPristineDestination(destination)
    mkdirSync(dirname(destination), {recursive: true, mode: 0o700})
    const token = randomUUID()
    const staging = join(dirname(destination), `${basename(destination)}.import-staging-${token}`)
    const backup = join(dirname(destination), `${basename(destination)}.pre-import-${token}`)
    const copied = []
    let destinationBackedUp = false
    try {
        const stagePaths = ensureDataLayout(resolveDataPaths({dataRoot: staging}))
        const config = join(destination, "config.json")
        if (existsSync(config)) copyTree(config, stagePaths.config, copied, "config.json")
        for (const entry of SOURCE_FILES) {
            const from = join(realSource, entry.source)
            if (!existsSync(from)) continue
            const to = join(staging, entry.destination)
            copyTree(from, to, copied, entry.destination)
            validateFile(to, entry.schema)
        }
        for (const entry of SOURCE_DIRECTORIES) {
            const from = join(realSource, entry.source)
            if (!existsSync(from)) continue
            copyTree(from, join(staging, entry.destination), copied, entry.destination)
        }
        const importedAt = now().toISOString()
        const migration = {
            schemaVersion: MIGRATION_SCHEMA,
            sourceKind: "rolling-skill-electron",
            sourceRoot: realSource,
            importedAt,
            copiedFiles: [...new Set(copied)].sort(),
        }
        writeFileSync(stagePaths.migration, `${JSON.stringify(migration, null, 2)}\n`, {mode: 0o600})
        if (existsSync(destination)) {
            renameSync(destination, backup)
            destinationBackedUp = true
        }
        try {
            renameSync(staging, destination)
        } catch (error) {
            if (destinationBackedUp && !existsSync(destination)) renameSync(backup, destination)
            destinationBackedUp = false
            throw error
        }
        if (destinationBackedUp) rmSync(backup, {recursive: true, force: true})
        return {status: "imported", restartRequired: true, migration}
    } catch (error) {
        rmSync(staging, {recursive: true, force: true})
        if (destinationBackedUp && existsSync(backup) && !existsSync(destination)) renameSync(backup, destination)
        throw error
    }
}

module.exports = {
    MIGRATION_SCHEMA,
    detectLegacyElectronDataRoot,
    importLegacyData,
    inspectLegacyImport,
}
