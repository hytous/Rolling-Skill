const {randomUUID} = require("node:crypto")
const {
    chmodSync,
    closeSync,
    constants,
    existsSync,
    fstatSync,
    lstatSync,
    mkdirSync,
    openSync,
    readFileSync,
    readlinkSync,
    readdirSync,
    readSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeSync,
} = require("node:fs")
const {basename, dirname, isAbsolute, join, relative, resolve, sep} = require("node:path")

const {extractManagedSkillZip} = require("./managed-skill-archive.cjs")
const {ManagedSkillGit, redactGitLocation} = require("./managed-skill-git.cjs")
const {
    DEFAULT_SCAN_LIMITS,
    scanManagedSkillRepository,
    snapshotManagedSkill,
} = require("./managed-skill-snapshot.cjs")

const SOURCE_KINDS = new Set(["zip", "folder", "local-git", "git-url"])

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function isContained(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0
}

function nextPatchVersion(versions) {
    const used = new Set(versions.map((entry) => entry.versionLabel).filter(Boolean))
    const stable = versions
        .filter((entry) => entry.state === "released")
        .flatMap((entry) => {
            const match = String(entry.versionLabel ?? "").match(/^(\d+)\.(\d+)\.(\d+)$/u)
            if (!match) return []
            const tuple = match.slice(1).map(Number)
            return tuple.every(Number.isSafeInteger) ? [tuple] : []
        })
        .sort((left, right) => (
            left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
        ))
    let [major, minor, patch] = stable.at(-1) ?? [1, 0, -1]
    let candidate
    do {
        patch += 1
        candidate = `${major}.${minor}.${patch}`
    } while (used.has(candidate))
    return candidate
}

function clearSkillTree(path, {preserveGit = false} = {}) {
    for (const entry of readdirSync(path, {withFileTypes: true})) {
        if (preserveGit && entry.name === ".git") continue
        rmSync(join(path, entry.name), {recursive: true, force: true})
    }
}

function movePreparedTree(preparedPath, targetPath, repositoryRoot) {
    if (targetPath !== repositoryRoot) {
        rmSync(targetPath, {recursive: true, force: true})
        mkdirSync(dirname(targetPath), {recursive: true, mode: 0o700})
        renameSync(preparedPath, targetPath)
        return
    }
    clearSkillTree(targetPath, {preserveGit: true})
    for (const entry of readdirSync(preparedPath, {withFileTypes: true})) {
        renameSync(join(preparedPath, entry.name), join(targetPath, entry.name))
    }
    rmSync(preparedPath, {recursive: true, force: true})
}

function expectedEditBase(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "commit,contentDigest,snapshotDigest") {
        throw new Error("Expected Skill edit base is invalid")
    }
    return {
        commit: requiredText(value.commit, "Expected Skill edit commit", 64),
        contentDigest: requiredText(value.contentDigest, "Expected Skill edit content digest", 80),
        snapshotDigest: requiredText(value.snapshotDigest, "Expected Skill edit snapshot digest", 80),
    }
}

function defaultManagedSkillPaths({applicationSupportDirectory}) {
    const root = resolve(requiredText(applicationSupportDirectory, "Application Support directory"))
    return {
        applicationSupportDirectory: root,
        registryPath: join(root, "skill-registry.json"),
        repositoriesRoot: join(root, "repositories"),
    }
}

function safeSourceLocation(kind, location) {
    return kind === "git-url" ? redactGitLocation(location) : basename(location)
}

function displayNameForSource(location, fallback) {
    const redacted = redactGitLocation(location)
    const withoutSuffix = redacted.replace(/\.(?:git|zip)$/iu, "")
    return withoutSuffix || fallback || "Imported Skill"
}

function publicRepository(repository) {
    const {managedPath: _managedPath, ...publicFields} = repository
    return publicFields
}

async function candidateBaseSnapshot(manager, skill, repository) {
    const scan = scanManagedSkillRepository(repository.managedPath, manager.scanLimits)
    const currentSkill = scan.skills.find((entry) => entry.skillRoot === skill.skillRoot)
    if (!currentSkill || currentSkill.status !== "valid") {
        throw new Error("Selected Skill is not valid in the current Working tree")
    }
    const snapshot = snapshotManagedSkill(
        join(repository.managedPath, currentSkill.skillRoot),
        manager.scanLimits,
    )
    const status = await manager.git.status(repository.managedPath)
    return {
        repositoryId: repository.id,
        skillId: skill.id,
        commit: await manager.git.headOrNull(repository.managedPath),
        contentDigest: snapshot.digest,
        dirty: status.dirty === true,
    }
}

function copyFolderWithoutGit(source, destination, limits = DEFAULT_SCAN_LIMITS) {
    const sourceRoot = realpathSync(source)
    if (!lstatSync(sourceRoot).isDirectory()) throw new Error("Skill folder source must be a directory")
    mkdirSync(destination, {mode: 0o700})
    let entryCount = 0
    let totalBytes = 0
    const buffer = Buffer.allocUnsafe(64 * 1024)

    function account(relativePath, size) {
        entryCount += 1
        if (entryCount > limits.maxFiles) {
            throw new Error(`Managed Skill file count limit exceeded at ${relativePath}`)
        }
        if (size > limits.maxFileBytes) {
            throw new Error(`Managed Skill single-file limit exceeded at ${relativePath}`)
        }
        if (totalBytes + size > limits.maxTotalBytes) {
            throw new Error(`Managed Skill total byte limit exceeded at ${relativePath}`)
        }
        totalBytes += size
    }

    function copyFileBounded(sourcePath, destinationPath, relativePath, mode, declaredSize) {
        account(relativePath, declaredSize)
        const sourceDescriptor = openSync(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW)
        let destinationDescriptor = null
        try {
            const opened = fstatSync(sourceDescriptor)
            if (!opened.isFile() || opened.size !== declaredSize) {
                throw new Error(`Skill folder changed while importing ${relativePath}`)
            }
            destinationDescriptor = openSync(
                destinationPath,
                constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
                mode,
            )
            let copied = 0
            while (true) {
                const count = readSync(sourceDescriptor, buffer, 0, buffer.length, null)
                if (!count) break
                copied += count
                if (copied > declaredSize || copied > limits.maxFileBytes) {
                    throw new Error(`Skill folder changed while importing ${relativePath}`)
                }
                let offset = 0
                while (offset < count) {
                    offset += writeSync(destinationDescriptor, buffer, offset, count - offset)
                }
            }
            if (copied !== declaredSize) {
                throw new Error(`Skill folder changed while importing ${relativePath}`)
            }
        } finally {
            if (destinationDescriptor !== null) closeSync(destinationDescriptor)
            closeSync(sourceDescriptor)
        }
        chmodSync(destinationPath, mode)
    }

    function visit(sourceDirectory, destinationDirectory) {
        const entries = readdirSync(sourceDirectory, {withFileTypes: true})
            .sort((left, right) => compareText(left.name, right.name))
        for (const entry of entries) {
            if (entry.name.toLowerCase() === ".git") continue
            const sourcePath = join(sourceDirectory, entry.name)
            const destinationPath = join(destinationDirectory, entry.name)
            const relativePath = relative(sourceRoot, sourcePath).split(sep).join("/")
            const stat = lstatSync(sourcePath)
            if (stat.isDirectory()) {
                account(relativePath, 0)
                mkdirSync(destinationPath, {mode: 0o700})
                visit(sourcePath, destinationPath)
                continue
            }
            if (stat.isSymbolicLink()) {
                const linkTarget = readlinkSync(sourcePath)
                let resolvedTarget
                try {
                    resolvedTarget = realpathSync(resolve(dirname(sourcePath), linkTarget))
                } catch {
                    throw new Error(`Symbolic link ${relativePath} has a missing target`)
                }
                if (isAbsolute(linkTarget) || !isContained(sourceRoot, resolvedTarget)) {
                    throw new Error(`Symbolic link ${relativePath} points outside the source folder`)
                }
                account(relativePath, Buffer.byteLength(linkTarget))
                symlinkSync(linkTarget, destinationPath)
                continue
            }
            if (!stat.isFile()) {
                throw new Error(`Unsupported special file in managed Skill: ${relativePath}`)
            }
            copyFileBounded(
                sourcePath,
                destinationPath,
                relativePath,
                stat.mode & 0o111 ? 0o755 : 0o644,
                stat.size,
            )
        }
    }

    visit(sourceRoot, destination)
}

class ManagedSkillManager {
    constructor(options = {}) {
        this.paths = defaultManagedSkillPaths(options)
        this.store = options.store
        if (!this.store) throw new Error("Managed Skill store is required")
        this.git = options.git ?? new ManagedSkillGit()
        this.scanLimits = {...DEFAULT_SCAN_LIMITS, ...(options.scanLimits ?? {})}
        this.operationTail = Promise.resolve()
        mkdirSync(this.paths.repositoriesRoot, {recursive: true, mode: 0o700})
        chmodSync(this.paths.repositoriesRoot, 0o700)
    }

    enqueue(operation) {
        const result = this.operationTail.then(operation, operation)
        this.operationTail = result.catch(() => {})
        return result
    }

    overview() {
        return {
            ...this.catalog(),
            versions: this.store.listVersions(),
        }
    }

    catalog() {
        return {
            repositories: this.store.listRepositories().map(publicRepository),
            skills: this.store.listSkills(),
        }
    }

    listVersionPage(input = {}) {
        return this.store.listVersionPage(input)
    }

    importSource(input = {}) {
        return this.enqueue(() => this.performImport(input))
    }

    rescanAll() {
        return this.enqueue(() => {
            const failures = []
            for (const repository of this.store.listRepositories()) {
                try {
                    const scan = scanManagedSkillRepository(
                        repository.managedPath,
                        this.scanLimits,
                    )
                    this.store.replaceRepositorySkills(repository.id, scan.skills)
                } catch (error) {
                    failures.push({
                        repositoryId: repository.id,
                        message: error instanceof Error ? error.message : String(error),
                    })
                }
            }
            return {...this.overview(), failures}
        })
    }

    async performImport(input) {
        const kind = requiredText(input.kind, "Skill source kind", 40)
        if (!SOURCE_KINDS.has(kind)) throw new Error("Unsupported managed Skill source kind")
        const location = requiredText(input.location, "Skill source location", 8_192)
        if (kind !== "git-url" && !isAbsolute(location)) {
            throw new Error("Local Skill source path must be absolute")
        }
        const repositoryId = randomUUID()
        const stagingPath = join(this.paths.repositoriesRoot, `.staging-${repositoryId}`)
        const managedPath = join(this.paths.repositoriesRoot, repositoryId)
        let repository = null
        let moved = false
        try {
            if (kind === "folder") {
                copyFolderWithoutGit(location, stagingPath, this.scanLimits)
            } else if (kind === "zip") {
                await extractManagedSkillZip(location, stagingPath, this.scanLimits)
            } else if (kind === "local-git") {
                await this.git.cloneLocal(location, stagingPath)
            } else {
                await this.git.cloneUrl(location, stagingPath)
            }

            const scan = scanManagedSkillRepository(stagingPath, this.scanLimits)
            const validSkills = scan.skills.filter((skill) => skill.status === "valid")
            if (!validSkills.length) {
                throw new Error("Imported repository must contain at least one valid SKILL.md")
            }

            let commit
            let defaultBranch
            if (kind === "folder" || kind === "zip") {
                await this.git.initialize(stagingPath)
                commit = await this.git.commitAll(stagingPath, "Import Skill source", {
                    forcePaths: validSkills.map((entry) => entry.skillRoot),
                })
                defaultBranch = "main"
            } else {
                commit = await this.git.head(stagingPath)
                defaultBranch = await this.git.defaultBranch(stagingPath)
            }

            const snapshots = new Map()
            for (const skill of validSkills) {
                snapshots.set(skill.skillRoot, await this.git.snapshotSkill(
                    stagingPath,
                    commit,
                    skill.skillRoot,
                    this.scanLimits,
                ))
            }

            renameSync(stagingPath, managedPath)
            moved = true
            return this.store.transaction(() => {
                repository = this.store.addRepository({
                    displayName: requiredText(
                        input.displayName ?? displayNameForSource(location, validSkills[0].name),
                        "Repository display name",
                        200,
                    ),
                    managedPath,
                    defaultBranch,
                    source: {
                        kind,
                        location: safeSourceLocation(kind, location),
                    },
                })
                const skills = this.store.replaceRepositorySkills(repository.id, scan.skills)
                const versions = skills
                    .filter((entry) => entry.status === "valid")
                    .map((skill) => this.store.addVersion({
                        repositoryId: repository.id,
                        skillId: skill.id,
                        commit,
                        contentDigest: snapshots.get(skill.skillRoot).digest,
                        state: "candidate",
                        createdBy: "import",
                    }))
                return {repository, skills, versions}
            })
        } catch (error) {
            if (repository) {
                try {
                    this.store.removeRepository(repository.id, {cascade: true})
                } catch {}
            }
            for (const path of [stagingPath, moved ? managedPath : null]) {
                if (!path) continue
                const resolvedPath = resolve(path)
                if (isContained(this.paths.repositoriesRoot, resolvedPath)) {
                    rmSync(resolvedPath, {recursive: true, force: true})
                }
            }
            throw error
        }
    }

    readSkill(skillId, {includeVersions = true} = {}) {
        if (typeof includeVersions !== "boolean") {
            throw new Error("includeVersions must be a boolean")
        }
        const skill = this.store.getSkill(requiredText(skillId, "Skill id", 200))
        const repository = this.store.getRepository(skill.repositoryId)
        const repositoryRoot = realpathSync(repository.managedPath)
        const skillRoot = realpathSync(join(repositoryRoot, skill.skillRoot))
        if (!isContained(repositoryRoot, skillRoot)) {
            throw new Error("Registered Skill root escapes its managed repository")
        }
        const manifestPath = realpathSync(join(repositoryRoot, skill.manifestPath))
        if (!isContained(skillRoot, manifestPath)) {
            throw new Error("Registered Skill manifest escapes its Skill root")
        }
        const detail = {
            repository,
            skill,
            manifest: readFileSync(manifestPath, "utf8"),
            snapshot: snapshotManagedSkill(skillRoot, this.scanLimits),
        }
        if (includeVersions) detail.versions = this.store.listVersions(skill.id)
        return detail
    }

    candidateBase(skillId) {
        return this.enqueue(async () => {
            const skill = this.store.getSkill(requiredText(skillId, "Skill id", 200))
            const repository = this.store.getRepository(skill.repositoryId)
            return candidateBaseSnapshot(this, skill, repository)
        })
    }

    createCandidate(input = {}) {
        return this.enqueue(async () => {
            const skill = this.store.getSkill(requiredText(input.skillId, "Skill id", 200))
            const repository = this.store.getRepository(skill.repositoryId)
            if (input.expectedBase !== undefined) {
                const expected = input.expectedBase
                if (!expected || typeof expected !== "object" || Array.isArray(expected) ||
                    Object.keys(expected).sort().join(",") !== "commit,contentDigest,dirty") {
                    throw new Error("Expected Candidate base is invalid")
                }
                const actual = await candidateBaseSnapshot(this, skill, repository)
                if (actual.commit !== expected.commit ||
                    actual.contentDigest !== expected.contentDigest ||
                    actual.dirty !== expected.dirty) {
                    throw Object.assign(new Error("Managed Skill Candidate base changed"), {
                        code: "RESOURCE_CHANGED",
                    })
                }
            }
            const scan = scanManagedSkillRepository(repository.managedPath, this.scanLimits)
            const existingByRoot = new Map(
                this.store.listSkills(repository.id).map((entry) => [entry.skillRoot, entry]),
            )
            for (const scanned of scan.skills) {
                const existing = existingByRoot.get(scanned.skillRoot)
                if (existing && existing.name !== scanned.name) {
                    throw new Error(
                        "Managed Skill rename requires an explicit identity migration",
                    )
                }
            }
            const currentSkill = scan.skills.find((entry) => entry.skillRoot === skill.skillRoot)
            if (!currentSkill || currentSkill.status !== "valid") {
                throw new Error("Selected Skill is not valid in the current Working tree")
            }
            const selectedSnapshot = snapshotManagedSkill(
                join(repository.managedPath, currentSkill.skillRoot),
                this.scanLimits,
            )
            if (this.store.listVersions(skill.id).some((entry) =>
                entry.contentDigest === selectedSnapshot.digest,
            )) {
                throw new Error("Selected Skill content has not changed from a recorded version")
            }

            const status = await this.git.status(repository.managedPath)
            const commit = status.dirty
                ? await this.git.commitAll(
                    repository.managedPath,
                    requiredText(input.message, "Candidate commit message", 2_000),
                    {forcePaths: scan.skills
                        .filter((entry) => entry.status === "valid")
                        .map((entry) => entry.skillRoot)},
                )
                : await this.git.head(repository.managedPath)
            const committedScan = scanManagedSkillRepository(
                repository.managedPath,
                this.scanLimits,
            )
            if ((await this.git.status(repository.managedPath)).dirty) {
                throw new Error("Managed Skill Working tree changed while the Candidate was created")
            }
            const snapshots = new Map()
            for (const scannedSkill of committedScan.skills.filter((entry) => entry.status === "valid")) {
                snapshots.set(scannedSkill.skillRoot, await this.git.snapshotSkill(
                    repository.managedPath,
                    commit,
                    scannedSkill.skillRoot,
                    this.scanLimits,
                ))
            }
            const {storedSkills, createdVersions} = this.store.transaction(() => {
                const storedSkills = this.store.replaceRepositorySkills(
                    repository.id,
                    committedScan.skills,
                )
                const createdVersions = []
                for (const storedSkill of storedSkills.filter((entry) => entry.status === "valid")) {
                    const snapshot = snapshots.get(storedSkill.skillRoot)
                    if (this.store.listVersions(storedSkill.id).some((entry) =>
                        entry.contentDigest === snapshot.digest,
                    )) continue
                    createdVersions.push(this.store.addVersion({
                        repositoryId: repository.id,
                        skillId: storedSkill.id,
                        commit,
                        contentDigest: snapshot.digest,
                        state: "candidate",
                        createdBy: input.createdBy ?? "user",
                        optimizationRoundId: input.optimizationRoundId ?? null,
                    }))
                }
                return {storedSkills, createdVersions}
            })
            const selected = createdVersions.find((entry) => entry.skillId === skill.id)
            if (!selected) throw new Error("Selected Skill did not produce a Candidate version")
            return {...selected, relatedVersionIds: createdVersions.map((entry) => entry.id)}
        })
    }

    releaseVersion(input = {}) {
        return this.enqueue(async () => {
            const version = this.store.getVersion(requiredText(input.versionId, "Version id", 200))
            if (input.expectedCandidate !== undefined) {
                const expected = input.expectedCandidate
                if (!expected || typeof expected !== "object" || Array.isArray(expected) ||
                    Object.keys(expected).sort().join(",") !== "commit,contentDigest,state,versionLabel" ||
                    version.commit !== expected.commit ||
                    version.contentDigest !== expected.contentDigest ||
                    version.state !== expected.state ||
                    input.versionLabel !== expected.versionLabel) {
                    throw Object.assign(new Error("Managed Skill release Candidate changed"), {
                        code: "RESOURCE_CHANGED",
                    })
                }
            }
            if (version.state !== "candidate") throw new Error("Only Candidate versions can be released")
            const skill = this.store.getSkill(version.skillId)
            const repository = this.store.getRepository(version.repositoryId)
            const versionLabel = requiredText(input.versionLabel, "Version label", 64)
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(versionLabel)) {
                throw new Error("Version label contains unsupported characters")
            }
            if (this.store.listVersions(skill.id).some((entry) =>
                entry.id !== version.id && entry.versionLabel === versionLabel,
            )) {
                throw new Error("Managed Skill version label already exists")
            }
            const resolvedCommit = await this.git.resolve(repository.managedPath, version.commit)
            if (resolvedCommit !== version.commit) throw new Error("Candidate commit is unavailable")
            const tagName = `rolling-skill/${skill.name}/${versionLabel}`
            await this.git.createAnnotatedTag(
                repository.managedPath,
                tagName,
                `Release ${skill.name} ${versionLabel}`,
                version.commit,
            )
            try {
                return this.store.releaseVersion(version.id, versionLabel)
            } catch (error) {
                await this.git.deleteTag(repository.managedPath, tagName).catch(() => {})
                throw error
            }
        })
    }

    deprecateVersion(input = {}) {
        return this.enqueue(() => this.store.deprecateVersion(
            requiredText(input.versionId, "Version id", 200),
        ))
    }

    applyEditedSkill(input = {}) {
        return this.enqueue(async () => {
            const skill = this.store.getSkill(requiredText(input.skillId, "Skill id", 200))
            const repository = this.store.getRepository(skill.repositoryId)
            const repositoryRoot = this.repositoryPath(repository.id)
            const selectedRoot = this.skillPath(skill.id)
            const expected = expectedEditBase(input.expectedBase)
            const current = await candidateBaseSnapshot(this, skill, repository)
            if (
                current.commit !== expected.commit ||
                current.contentDigest !== expected.contentDigest ||
                current.contentDigest !== expected.snapshotDigest
            ) {
                const error = new Error("Managed Skill changed while the Agent edit was open")
                error.code = "RESOURCE_CHANGED"
                throw error
            }

            const sourceRoot = realpathSync(requiredText(input.sourceRoot, "Skill edit source", 16_384))
            const sourceScan = scanManagedSkillRepository(sourceRoot, this.scanLimits)
            if (
                sourceScan.skills.length !== 1 ||
                sourceScan.skills[0].skillRoot !== "." ||
                sourceScan.skills[0].status !== "valid" ||
                sourceScan.skills[0].name !== skill.name
            ) throw new Error("Edited Skill is invalid or changed identity")
            const sourceSnapshot = snapshotManagedSkill(sourceRoot, this.scanLimits)
            if (sourceSnapshot.digest === current.contentDigest) {
                const error = new Error("Edited Skill has no content changes")
                error.code = "NO_CHANGES"
                throw error
            }

            const versions = this.store.listVersions(skill.id)
            const versionLabel = nextPatchVersion(versions)
            const message = requiredText(input.message, "Agent edit commit message", 2_000)
            const operationId = randomUUID()
            const backupPath = join(this.paths.applicationSupportDirectory, `.skill-edit-backup-${operationId}`)
            const preparedPath = join(this.paths.applicationSupportDirectory, `.skill-edit-stage-${operationId}`)
            const beforeHead = await this.git.head(repositoryRoot)
            let tagName = null
            let committed = false
            let backupReady = false
            try {
                copyFolderWithoutGit(selectedRoot, backupPath, this.scanLimits)
                backupReady = true
                const backupSnapshot = snapshotManagedSkill(backupPath, this.scanLimits)
                if (backupSnapshot.digest !== current.contentDigest) {
                    const error = new Error("Managed Skill changed while its edit was being applied")
                    error.code = "RESOURCE_CHANGED"
                    throw error
                }
                copyFolderWithoutGit(sourceRoot, preparedPath, this.scanLimits)
                if (snapshotManagedSkill(preparedPath, this.scanLimits).digest !== sourceSnapshot.digest) {
                    throw new Error("Edited Skill changed while it was being applied")
                }

                movePreparedTree(preparedPath, selectedRoot, repositoryRoot)
                const commit = await this.git.commitPaths(repositoryRoot, message, [skill.skillRoot])
                committed = true
                const committedSnapshot = await this.git.snapshotSkill(
                    repositoryRoot,
                    commit,
                    skill.skillRoot,
                    this.scanLimits,
                )
                if (committedSnapshot.digest !== sourceSnapshot.digest) {
                    throw new Error("Committed Agent Skill edit digest is inconsistent")
                }
                const committedScan = scanManagedSkillRepository(repositoryRoot, this.scanLimits)
                const committedSkill = committedScan.skills.find((entry) => entry.skillRoot === skill.skillRoot)
                if (!committedSkill || committedSkill.status !== "valid" || committedSkill.name !== skill.name) {
                    throw new Error("Committed Agent Skill edit changed Skill identity")
                }
                tagName = `rolling-skill/${skill.name}/${versionLabel}`
                await this.git.createAnnotatedTag(
                    repositoryRoot,
                    tagName,
                    `Release ${skill.name} ${versionLabel}`,
                    commit,
                )
                const version = this.store.transaction(() => {
                    const refreshed = this.store.replaceRepositorySkills(repository.id, committedScan.skills)
                    if (!refreshed.some((entry) => entry.id === skill.id && entry.status === "valid")) {
                        throw new Error("Managed Skill identity changed during release")
                    }
                    const candidate = this.store.addVersion({
                        repositoryId: repository.id,
                        skillId: skill.id,
                        commit,
                        contentDigest: committedSnapshot.digest,
                        state: "candidate",
                        createdBy: "user",
                    })
                    return this.store.releaseVersion(candidate.id, versionLabel)
                })
                rmSync(backupPath, {recursive: true, force: true})
                backupReady = false
                return {version, commit, contentDigest: committedSnapshot.digest}
            } catch (error) {
                const rollbackErrors = []
                if (tagName) {
                    try {
                        await this.git.deleteTag(repositoryRoot, tagName)
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError)
                    }
                }
                if (committed) {
                    try {
                        await this.git.softReset(repositoryRoot, beforeHead)
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError)
                    }
                }
                if (backupReady && existsSync(backupPath)) {
                    try {
                        movePreparedTree(backupPath, selectedRoot, repositoryRoot)
                        backupReady = false
                    } catch (rollbackError) {
                        rollbackErrors.push(rollbackError)
                    }
                }
                try {
                    await this.git.resetPaths(repositoryRoot, beforeHead, [skill.skillRoot])
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError)
                }
                if (rollbackErrors.length) {
                    const recovery = new Error("Agent Skill edit failed and requires recovery", {cause: error})
                    recovery.code = "NEEDS_RECOVERY"
                    recovery.rollbackErrors = rollbackErrors
                    throw recovery
                }
                throw error
            } finally {
                for (const path of [preparedPath, backupReady ? backupPath : null]) {
                    if (path && existsSync(path)) rmSync(path, {recursive: true, force: true})
                }
            }
        })
    }

    repositoryPath(repositoryId) {
        const repository = this.store.getRepository(requiredText(repositoryId, "Repository id", 200))
        const path = realpathSync(repository.managedPath)
        const repositoriesRoot = realpathSync(this.paths.repositoriesRoot)
        if (!isContained(repositoriesRoot, path)) {
            throw new Error("Managed repository path is outside Application Support")
        }
        return path
    }

    skillPath(skillId) {
        const skill = this.store.getSkill(requiredText(skillId, "Skill id", 200))
        const repositoryRoot = this.repositoryPath(skill.repositoryId)
        const path = realpathSync(join(repositoryRoot, skill.skillRoot))
        if (!isContained(repositoryRoot, path)) {
            throw new Error("Managed Skill path is outside its repository")
        }
        return path
    }
}

module.exports = {
    ManagedSkillManager,
    defaultManagedSkillPaths,
    nextPatchVersion,
}
