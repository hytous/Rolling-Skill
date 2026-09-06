const {randomUUID} = require("node:crypto")
const {
    chmodSync,
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {dirname, isAbsolute, posix, resolve} = require("node:path")
const {
    decodeSkillVersionCursor,
    encodeSkillVersionCursor,
} = require("./managed-skill-version-cursor.cjs")

const MANAGED_SKILL_SCHEMA = "rolling-skill-managed-skills/v1"
const SOURCE_KINDS = new Set(["zip", "folder", "local-git", "git-url"])
const VERSION_STATES = new Set(["candidate", "released"])
const VERSION_CREATORS = new Set(["import", "user", "optimization"])
const SKILL_STATES = new Set(["valid", "warning", "invalid", "missing"])
const MAX_REGISTRY_BYTES = 16 * 1024 * 1024

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function initialManagedSkillState() {
    return {
        schemaVersion: MANAGED_SKILL_SCHEMA,
        repositories: [],
        skills: [],
        versions: [],
    }
}

function requiredString(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function requiredId(value, label) {
    return requiredString(value, `${label} id`, 200)
}

function normalizedWarnings(value) {
    if (!Array.isArray(value)) return []
    return value.map((warning) => requiredString(warning, "Skill warning", 4_096))
}

function normalizedExecutables(value) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map((path) => requiredString(path, "Executable path", 4_096)))].sort()
}

function validateRelativePath(value, label, allowRoot = false) {
    const path = requiredString(value, label, 4_096).replace(/\\/gu, "/")
    if (
        isAbsolute(path) ||
        (path === "." ? !allowRoot : (
            posix.normalize(path) !== path ||
            path.split("/").some((segment) => !segment || segment === "." || segment === "..")
        ))
    ) throw new Error(`${label} must be repository-relative`)
    return path
}

function validateUniqueId(value, label, ids) {
    const id = requiredId(value, label)
    if (ids.has(id)) throw new Error(`Duplicate managed Skill ${label.toLowerCase()} id`)
    ids.add(id)
    return id
}

function validateNullableText(value, label, maxLength) {
    if (value === null || value === undefined) return null
    return requiredString(value, label, maxLength)
}

function validateOptimizationEpoch(value) {
    if (value === null || value === undefined) return null
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("Optimization epoch must be a positive safe integer")
    }
    return value
}

function validateState(state) {
    if (!state || typeof state !== "object" || state.schemaVersion !== MANAGED_SKILL_SCHEMA) {
        throw new Error("Unsupported managed Skill registry schema")
    }
    for (const field of ["repositories", "skills", "versions"]) {
        if (!Array.isArray(state[field])) throw new Error(`Managed Skill registry ${field} is invalid`)
        if (state[field].length > 100_000) {
            throw new Error(`Managed Skill registry ${field} exceeds its entry limit`)
        }
    }
    const repositoryIds = new Set()
    const repositoryPaths = new Set()
    for (const repository of state.repositories) {
        if (!repository || typeof repository !== "object") {
            throw new Error("Managed Skill registry repository is invalid")
        }
        validateUniqueId(repository.id, "Repository", repositoryIds)
        requiredString(repository.displayName, "Repository display name", 200)
        const managedPath = requiredString(repository.managedPath, "Managed path")
        if (!isAbsolute(managedPath)) throw new Error("Managed path must be absolute")
        const canonicalPath = resolve(managedPath)
        if (repositoryPaths.has(canonicalPath)) throw new Error("Duplicate managed repository path")
        repositoryPaths.add(canonicalPath)
        requiredString(repository.defaultBranch, "Default branch", 200)
        const sourceKind = requiredString(repository.source?.kind, "Source kind", 40)
        if (!SOURCE_KINDS.has(sourceKind)) throw new Error("Unsupported managed Skill source kind")
        requiredString(repository.source?.location, "Source location", 8_192)
        requiredString(repository.source?.importedAt, "Source import time", 100)
        requiredString(repository.createdAt, "Repository creation time", 100)
        requiredString(repository.updatedAt, "Repository update time", 100)
    }
    const skillIds = new Set()
    const skillsById = new Map()
    const skillRoots = new Set()
    for (const skill of state.skills) {
        if (!skill || typeof skill !== "object") throw new Error("Managed Skill registry Skill is invalid")
        validateUniqueId(skill.id, "Skill", skillIds)
        skillsById.set(skill.id, skill)
        const repositoryId = requiredId(skill.repositoryId, "Repository")
        if (!repositoryIds.has(repositoryId)) throw new Error("Managed Skill references an unknown repository")
        requiredString(skill.name, "Skill name", 200)
        validateNullableText(skill.description, "Skill description", 1_024)
        const skillRoot = validateRelativePath(skill.skillRoot, "Skill root", true)
        const rootKey = `${repositoryId}\0${skillRoot}`
        if (skillRoots.has(rootKey)) throw new Error("Duplicate Skill root in repository")
        skillRoots.add(rootKey)
        const manifestPath = validateRelativePath(skill.manifestPath, "Skill manifest path")
        const expectedManifest = skillRoot === "." ? "SKILL.md" : `${skillRoot}/SKILL.md`
        if (manifestPath !== expectedManifest) {
            throw new Error("Skill manifest path does not match its registered root")
        }
        const status = requiredString(skill.status, "Skill status", 40)
        if (!SKILL_STATES.has(status)) throw new Error("Managed Skill status is invalid")
        normalizedWarnings(skill.warnings)
        normalizedExecutables(skill.executableFiles).forEach((path) =>
            validateRelativePath(path, "Executable path"),
        )
        requiredString(skill.createdAt, "Skill creation time", 100)
        requiredString(skill.updatedAt, "Skill update time", 100)
    }
    const versionIds = new Set()
    const commits = new Set()
    const labels = new Set()
    const optimizationCoordinates = new Set()
    for (const version of state.versions) {
        if (!version || typeof version !== "object") {
            throw new Error("Managed Skill registry version is invalid")
        }
        validateUniqueId(version.id, "Version", versionIds)
        const repositoryId = requiredId(version.repositoryId, "Repository")
        const skillId = requiredId(version.skillId, "Skill")
        if (!repositoryIds.has(repositoryId) || !skillIds.has(skillId)) {
            throw new Error("Managed Skill version references an unknown record")
        }
        const skill = skillsById.get(skillId)
        if (skill.repositoryId !== repositoryId) {
            throw new Error("Managed Skill version repository does not match its Skill")
        }
        const versionSkillRoot = validateRelativePath(
            version.skillRoot,
            "Version Skill root",
            true,
        )
        if (versionSkillRoot !== skill.skillRoot) {
            throw new Error("Managed Skill version root does not match its Skill")
        }
        const commit = requiredString(version.commit, "Version commit", 40)
        if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Version commit must be a full SHA-1")
        const commitKey = `${skillId}\0${commit}`
        if (commits.has(commitKey)) throw new Error("Duplicate managed Skill version commit")
        commits.add(commitKey)
        const digest = requiredString(version.contentDigest, "Version content digest", 80)
        if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new Error("Version digest is invalid")
        const versionState = requiredString(version.state, "Version state", 40)
        if (!VERSION_STATES.has(versionState)) throw new Error("Managed Skill version state is invalid")
        const label = validateNullableText(version.versionLabel, "Version label", 64)
        validateNullableText(version.title, "Version title", 80)
        if (versionState === "released" && !label) throw new Error("Released version requires a label")
        if (label) {
            const labelKey = `${skillId}\0${label}`
            if (labels.has(labelKey)) throw new Error("Duplicate managed Skill version label")
            labels.add(labelKey)
        }
        const creator = requiredString(version.createdBy, "Version creator", 40)
        if (!VERSION_CREATORS.has(creator)) throw new Error("Unsupported version creator")
        validateNullableText(version.optimizationRoundId, "Optimization round", 200)
        const optimizationRunId = validateNullableText(
            version.optimizationRunId,
            "Optimization Run",
            200,
        )
        const optimizationEpoch = validateOptimizationEpoch(version.optimizationEpoch)
        if ((optimizationRunId === null) !== (optimizationEpoch === null)) {
            throw new Error("Optimization Run and epoch provenance must be provided together")
        }
        if (optimizationRunId !== null) {
            const coordinate = `${skillId}\0${optimizationRunId}\0${optimizationEpoch}`
            if (optimizationCoordinates.has(coordinate)) {
                throw new Error("Duplicate Optimization Run and Epoch Candidate provenance")
            }
            optimizationCoordinates.add(coordinate)
        }
        requiredString(version.createdAt, "Version creation time", 100)
        validateNullableText(version.releasedAt, "Version release time", 100)
        validateNullableText(version.deprecatedAt, "Version deprecation time", 100)
    }
    return state
}

function versionOrder(left, right) {
    if (left.state !== right.state) return left.state === "released" ? -1 : 1
    const leftTime = left.releasedAt ?? left.createdAt ?? ""
    const rightTime = right.releasedAt ?? right.createdAt ?? ""
    return String(rightTime).localeCompare(String(leftTime)) || left.id.localeCompare(right.id)
}

class ManagedSkillStore {
    constructor(path) {
        this.path = resolve(requiredString(path, "Managed Skill registry path"))
        this.state = null
        this.transactionDepth = 0
        this.catalogRevision = null
        this.versionOrderIndex = null
        this.load()
    }

    load() {
        if (!existsSync(this.path)) {
            this.state = initialManagedSkillState()
            this.persist()
            this.catalogRevision = randomUUID()
            this.versionOrderIndex = null
            return this.state
        }
        try {
            if (statSync(this.path).size > MAX_REGISTRY_BYTES) {
                throw new Error("Managed Skill registry exceeds its byte limit")
            }
            this.state = validateState(JSON.parse(readFileSync(this.path, "utf8")))
            chmodSync(dirname(this.path), 0o700)
            chmodSync(this.path, 0o600)
            this.catalogRevision = randomUUID()
            this.versionOrderIndex = null
            return this.state
        } catch (error) {
            if (/Unsupported managed Skill registry/u.test(error.message)) throw error
            throw new Error(`Could not read managed Skill registry: ${error.message}`)
        }
    }

    persist() {
        const directory = dirname(this.path)
        mkdirSync(directory, {recursive: true, mode: 0o700})
        chmodSync(directory, 0o700)
        const temporaryPath = `${this.path}.tmp-${process.pid}-${randomUUID()}`
        const descriptor = openSync(temporaryPath, "wx", 0o600)
        try {
            try {
                writeFileSync(descriptor, `${JSON.stringify(this.state, null, 2)}\n`, "utf8")
                fsyncSync(descriptor)
            } finally {
                closeSync(descriptor)
            }
            renameSync(temporaryPath, this.path)
            chmodSync(this.path, 0o600)
        } catch (error) {
            try {
                unlinkSync(temporaryPath)
            } catch {}
            throw error
        }
    }

    mutate(operation) {
        if (this.transactionDepth > 0) return copy(operation())
        return this.transaction(operation)
    }

    transaction(operation) {
        if (typeof operation !== "function") throw new Error("Registry transaction is required")
        if (this.transactionDepth > 0) return copy(operation())
        const previous = this.state
        const previousVersionOrderIndex = this.versionOrderIndex
        this.state = copy(previous)
        this.versionOrderIndex = null
        this.transactionDepth = 1
        try {
            const result = operation()
            this.persist()
            this.catalogRevision = randomUUID()
            this.versionOrderIndex = null
            return copy(result)
        } catch (error) {
            this.state = previous
            this.versionOrderIndex = previousVersionOrderIndex
            throw error
        } finally {
            this.transactionDepth = 0
        }
    }

    read() {
        return copy(this.state)
    }

    listRepositories() {
        return copy([...this.state.repositories].sort((left, right) =>
            left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id),
        ))
    }

    getRepository(repositoryId) {
        repositoryId = requiredId(repositoryId, "Repository")
        const repository = this.state.repositories.find((entry) => entry.id === repositoryId)
        if (!repository) throw new Error("Unknown managed Skill repository")
        return copy(repository)
    }

    addRepository(input = {}) {
        const requestedPath = requiredString(input.managedPath, "Managed path")
        if (!isAbsolute(requestedPath)) throw new Error("Managed path must be absolute")
        const managedPath = resolve(requestedPath)
        if (this.state.repositories.some((entry) => entry.managedPath === managedPath)) {
            throw new Error("Managed path already exists in the Skill registry")
        }
        const sourceKind = requiredString(input.source?.kind, "Source kind", 40)
        if (!SOURCE_KINDS.has(sourceKind)) throw new Error("Unsupported managed Skill source kind")
        const now = new Date().toISOString()
        const repository = {
            id: randomUUID(),
            displayName: requiredString(input.displayName, "Repository display name", 200),
            managedPath,
            defaultBranch: requiredString(input.defaultBranch, "Default branch", 200),
            source: {
                kind: sourceKind,
                location: requiredString(input.source?.location, "Source location", 8_192),
                importedAt: input.source?.importedAt
                    ? requiredString(input.source.importedAt, "Source import time", 100)
                    : now,
            },
            createdAt: now,
            updatedAt: now,
        }
        return this.mutate(() => {
            this.state.repositories.push(repository)
            return repository
        })
    }

    removeRepository(repositoryId, options = {}) {
        const repository = this.getRepository(repositoryId)
        const skills = this.state.skills.filter((entry) => entry.repositoryId === repository.id)
        const skillIds = new Set(skills.map((entry) => entry.id))
        const versions = this.state.versions.filter((entry) => skillIds.has(entry.skillId))
        if (versions.length && !options.cascade) {
            throw new Error("Managed Skill repository has versions and cannot be removed")
        }
        return this.mutate(() => {
            this.state.repositories = this.state.repositories.filter((entry) => entry.id !== repository.id)
            this.state.skills = this.state.skills.filter((entry) => entry.repositoryId !== repository.id)
            this.state.versions = this.state.versions.filter((entry) => !skillIds.has(entry.skillId))
            return {
                repository,
                skillCount: skills.length,
                versionCount: versions.length,
            }
        })
    }

    replaceRepositorySkills(repositoryId, inputs) {
        const repository = this.getRepository(repositoryId)
        if (!Array.isArray(inputs)) throw new Error("Repository Skills must be an array")
        const seenRoots = new Set()
        const seenNames = new Set()
        const existing = this.state.skills.filter((entry) => entry.repositoryId === repository.id)
        const existingByRoot = new Map(existing.map((entry) => [entry.skillRoot, entry]))
        const now = new Date().toISOString()
        const next = inputs.map((input) => {
            const skillRoot = requiredString(input.skillRoot, "Skill root", 4_096)
            const name = requiredString(input.name, "Skill name", 200)
            if (seenRoots.has(skillRoot)) throw new Error("Duplicate Skill root in repository")
            if (seenNames.has(name)) throw new Error("Duplicate Skill name in repository")
            seenRoots.add(skillRoot)
            seenNames.add(name)
            const previous = existingByRoot.get(skillRoot)
            if (previous && previous.name !== name) {
                throw new Error(
                    "Managed Skill rename requires an explicit identity migration",
                )
            }
            return {
                id: previous?.id ?? randomUUID(),
                repositoryId: repository.id,
                name,
                description: input.description === null || input.description === undefined
                    ? null
                    : requiredString(input.description, "Skill description", 1_024),
                skillRoot,
                manifestPath: requiredString(input.manifestPath, "Skill manifest path", 4_096),
                status: requiredString(input.status, "Skill status", 40),
                warnings: normalizedWarnings(input.warnings),
                executableFiles: normalizedExecutables(input.executableFiles),
                createdAt: previous?.createdAt ?? now,
                updatedAt: now,
            }
        })
        const incomingRoots = new Set(next.map((entry) => entry.skillRoot))
        const retainedMissing = existing
            .filter((entry) => !incomingRoots.has(entry.skillRoot))
            .filter((entry) => this.state.versions.some((version) => version.skillId === entry.id))
            .map((entry) => ({
                ...entry,
                status: "missing",
                warnings: ["Skill root was not found during the latest repository scan"],
                updatedAt: now,
            }))
        return this.mutate(() => {
            this.state.skills = [
                ...this.state.skills.filter((entry) => entry.repositoryId !== repository.id),
                ...next,
                ...retainedMissing,
            ]
            const storedRepository = this.state.repositories.find((entry) => entry.id === repository.id)
            storedRepository.updatedAt = now
            return [...next, ...retainedMissing]
        })
    }

    listSkills(repositoryId = null) {
        if (repositoryId !== null) this.getRepository(repositoryId)
        return copy(this.state.skills
            .filter((entry) => repositoryId === null || entry.repositoryId === repositoryId)
            .sort((left, right) => left.skillRoot.localeCompare(right.skillRoot) || left.id.localeCompare(right.id)))
    }

    getSkill(skillId) {
        skillId = requiredId(skillId, "Skill")
        const skill = this.state.skills.find((entry) => entry.id === skillId)
        if (!skill) throw new Error("Unknown managed Skill")
        return copy(skill)
    }

    listVersions(skillId = null) {
        if (skillId !== null) this.getSkill(skillId)
        const versionOrderIndex = this.versionOrderIndex ?? this.buildVersionOrderIndex()
        return copy(versionOrderIndex
            .map((position) => this.state.versions[position])
            .filter((entry) => skillId === null || entry.skillId === skillId))
    }

    buildVersionOrderIndex() {
        const index = Array.from({length: this.state.versions.length}, (_, position) => position)
        index.sort((left, right) =>
            versionOrder(this.state.versions[left], this.state.versions[right]) || left - right,
        )
        this.versionOrderIndex = index
        return index
    }

    listVersionPage(input = {}) {
        if (!Array.isArray(input.skillIds) || input.skillIds.length > 100_000) {
            throw new Error("Authorized managed Skill ids are required")
        }
        const skillIds = new Set(input.skillIds.map((skillId) => requiredId(skillId, "Skill")))
        const skillId = input.skillId === null || input.skillId === undefined
            ? null
            : requiredId(input.skillId, "Skill")
        const limit = input.limit === undefined ? 50 : input.limit
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
            throw new Error("Managed Skill version page limit is invalid")
        }
        const versionOrderIndex = this.versionOrderIndex ?? this.buildVersionOrderIndex()
        let sequence = 0
        if (input.cursor !== null && input.cursor !== undefined) {
            let decoded
            try {
                decoded = decodeSkillVersionCursor(input.cursor)
            } catch (error) {
                const invalid = new Error("Managed Skill version cursor is invalid", {cause: error})
                invalid.code = "MANAGED_SKILL_VERSION_CURSOR_INVALID"
                throw invalid
            }
            if (decoded.revision !== this.catalogRevision) {
                const stale = new Error("Managed Skill version cursor is stale")
                stale.code = "MANAGED_SKILL_VERSION_CURSOR_STALE"
                throw stale
            }
            sequence = decoded.sequence
            if (sequence > versionOrderIndex.length) {
                const invalid = new Error("Managed Skill version cursor is outside the catalog")
                invalid.code = "MANAGED_SKILL_VERSION_CURSOR_INVALID"
                throw invalid
            }
        }

        const matches = (version) => skillIds.has(version.skillId) &&
            (skillId === null || version.skillId === skillId)
        const versions = []
        while (sequence < versionOrderIndex.length && versions.length < limit) {
            const version = this.state.versions[versionOrderIndex[sequence]]
            sequence += 1
            if (matches(version)) versions.push(copy(version))
        }
        while (
            sequence < versionOrderIndex.length &&
            !matches(this.state.versions[versionOrderIndex[sequence]])
        ) {
            sequence += 1
        }
        return {
            versions,
            nextCursor: sequence < versionOrderIndex.length
                ? encodeSkillVersionCursor({revision: this.catalogRevision, sequence})
                : null,
        }
    }

    getVersion(versionId) {
        versionId = requiredId(versionId, "Version")
        const version = this.state.versions.find((entry) => entry.id === versionId)
        if (!version) throw new Error("Unknown managed Skill version")
        return copy(version)
    }

    addVersion(input = {}) {
        const repository = this.getRepository(input.repositoryId)
        const skill = this.getSkill(input.skillId)
        if (skill.repositoryId !== repository.id) {
            throw new Error("Managed Skill version repository does not match its Skill")
        }
        const commit = requiredString(input.commit, "Version commit", 40)
        if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error("Version commit must be a full SHA-1")
        const contentDigest = requiredString(input.contentDigest, "Version content digest", 80)
        if (!/^sha256:[a-f0-9]{64}$/u.test(contentDigest)) {
            throw new Error("Version content digest must be SHA-256")
        }
        const state = requiredString(input.state, "Version state", 40)
        if (!VERSION_STATES.has(state) || state !== "candidate") {
            throw new Error("New managed Skill versions must be candidates")
        }
        const createdBy = requiredString(input.createdBy, "Version creator", 40)
        if (!VERSION_CREATORS.has(createdBy)) throw new Error("Unsupported version creator")
        const optimizationRunId = validateNullableText(
            input.optimizationRunId,
            "Optimization Run",
            200,
        )
        const optimizationEpoch = validateOptimizationEpoch(input.optimizationEpoch)
        if ((optimizationRunId === null) !== (optimizationEpoch === null)) {
            throw new Error("Optimization Run and epoch provenance must be provided together")
        }
        if (optimizationRunId !== null && this.state.versions.some((entry) =>
            entry.skillId === skill.id &&
            entry.optimizationRunId === optimizationRunId &&
            entry.optimizationEpoch === optimizationEpoch,
        )) {
            throw new Error("Optimization Run and Epoch Candidate provenance already exists")
        }
        if (this.state.versions.some((entry) => entry.skillId === skill.id && entry.commit === commit)) {
            throw new Error("Managed Skill version already exists for this commit")
        }
        const version = {
            id: randomUUID(),
            repositoryId: repository.id,
            skillId: skill.id,
            skillRoot: skill.skillRoot,
            commit,
            contentDigest,
            state,
            versionLabel: null,
            title: validateNullableText(input.title, "Version title", 80),
            createdBy,
            optimizationRoundId: input.optimizationRoundId
                ? requiredString(input.optimizationRoundId, "Optimization round", 200)
                : null,
            optimizationRunId,
            optimizationEpoch,
            createdAt: new Date().toISOString(),
            releasedAt: null,
            deprecatedAt: null,
        }
        return this.mutate(() => {
            this.state.versions.push(version)
            return version
        })
    }

    releaseVersion(versionId, value) {
        const version = this.state.versions.find((entry) => entry.id === requiredId(versionId, "Version"))
        if (!version) throw new Error("Unknown managed Skill version")
        if (version.state === "released") throw new Error("Managed Skill version is already released")
        const versionLabel = requiredString(value, "Version label", 64)
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(versionLabel)) {
            throw new Error("Version label contains unsupported characters")
        }
        if (this.state.versions.some((entry) =>
            entry.id !== version.id &&
            entry.skillId === version.skillId &&
            entry.versionLabel === versionLabel,
        )) {
            throw new Error("Managed Skill version label already exists")
        }
        return this.mutate(() => {
            const stored = this.state.versions.find((entry) => entry.id === version.id)
            stored.state = "released"
            stored.versionLabel = versionLabel
            stored.releasedAt = new Date().toISOString()
            return stored
        })
    }

    deprecateVersion(versionId) {
        const version = this.state.versions.find((entry) => entry.id === requiredId(versionId, "Version"))
        if (!version) throw new Error("Unknown managed Skill version")
        if (version.state !== "released") throw new Error("Only released Skill versions can be deprecated")
        return this.mutate(() => {
            const stored = this.state.versions.find((entry) => entry.id === version.id)
            if (!stored.deprecatedAt) stored.deprecatedAt = new Date().toISOString()
            return stored
        })
    }
}

module.exports = {
    MANAGED_SKILL_SCHEMA,
    ManagedSkillStore,
    initialManagedSkillState,
}
