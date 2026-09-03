"use strict"

const {
    chmodSync,
    lstatSync,
    mkdirSync,
    realpathSync,
} = require("node:fs")
const {join, resolve, sep} = require("node:path")

const {ManagedSkillGit} = require("../managed-skill-git.cjs")
const {
    DEFAULT_SCAN_LIMITS,
    scanManagedSkillRepository,
    snapshotManagedSkill,
} = require("../managed-skill-snapshot.cjs")

function requiredText(value, label, maximum = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maximum) throw new Error(`${label} is required`)
    return normalized
}

function requiredId(value, label) {
    const id = requiredText(value, `${label} id`, 200)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id)) {
        throw new Error(`${label} id contains unsupported characters`)
    }
    return id
}

function requiredEpoch(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("Optimization epoch must be a positive safe integer")
    }
    return value
}

function isContained(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function exactKeys(value, required, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    const keys = Object.keys(value).sort()
    const expected = [...required].sort()
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new Error(`${label} has an unknown or missing field`)
    }
    return value
}

function workspaceCopy(record) {
    return {
        runId: record.runId,
        repositoryId: record.repositoryId,
        skillId: record.skillId,
        versionId: record.versionId,
        workspacePath: record.workspacePath,
        branchName: record.branchName,
        baselineCommit: record.baselineCommit,
    }
}

class OptimizationWorkspaceManager {
    constructor(options = {}) {
        const applicationSupportDirectory = resolve(requiredText(
            options.applicationSupportDirectory,
            "Application Support directory",
            8_192,
        ))
        mkdirSync(applicationSupportDirectory, {recursive: true, mode: 0o700})
        this.applicationSupportDirectory = realpathSync(applicationSupportDirectory)
        const requestedWorkspacesRoot = join(
            this.applicationSupportDirectory,
            "optimization-workspaces",
        )
        try {
            const status = lstatSync(requestedWorkspacesRoot)
            if (status.isSymbolicLink() || !status.isDirectory()) {
                throw new Error("Optimization workspace root must be a regular directory")
            }
        } catch (error) {
            if (error?.code !== "ENOENT") throw error
            mkdirSync(requestedWorkspacesRoot, {mode: 0o700})
        }
        chmodSync(requestedWorkspacesRoot, 0o700)
        this.workspacesRoot = realpathSync(requestedWorkspacesRoot)
        if (this.workspacesRoot !== requestedWorkspacesRoot ||
            !isContained(this.applicationSupportDirectory, this.workspacesRoot)) {
            throw new Error("Optimization workspace root escapes Application Support")
        }
        this.store = options.store
        if (!this.store) throw new Error("Managed Skill store is required")
        this.git = options.git ?? new ManagedSkillGit()
        this.scanLimits = {...DEFAULT_SCAN_LIMITS, ...(options.scanLimits ?? {})}
        this.workspaces = new Map()
        this.operationTail = Promise.resolve()
    }

    enqueue(operation) {
        const result = this.operationTail.then(operation, operation)
        this.operationTail = result.catch(() => {})
        return result
    }

    create(run) {
        return this.enqueue(() => this.#create(run))
    }

    get(runId) {
        runId = requiredId(runId, "Optimization Run")
        const record = this.workspaces.get(runId)
        if (!record) throw new Error("Unknown registered Optimization workspace")
        this.#verifyWorkspace(record)
        return workspaceCopy(record)
    }

    recover(run, expectedWorkspace) {
        return this.enqueue(async () => {
            if (!run || typeof run !== "object" || Array.isArray(run)) {
                throw new Error("Optimization Run is required")
            }
            exactKeys(
                expectedWorkspace,
                [
                    "runId",
                    "repositoryId",
                    "skillId",
                    "versionId",
                    "workspacePath",
                    "branchName",
                    "baselineCommit",
                ],
                "Persisted Optimization workspace",
            )
            const runId = requiredId(run.id, "Optimization Run")
            if (this.workspaces.has(runId)) {
                throw new Error("Optimization workspace is already registered")
            }
            const baseline = run.snapshot?.baseline
            const repository = this.store.getRepository(baseline?.repositoryId)
            const skill = this.store.getSkill(baseline?.skillId)
            const version = this.store.getVersion(baseline?.versionId)
            if (skill.repositoryId !== repository.id || version.repositoryId !== repository.id ||
                version.skillId !== skill.id || version.state !== "released" ||
                version.commit !== baseline.commit || version.skillRoot !== baseline.skillRoot ||
                version.contentDigest !== baseline.contentDigest) {
                throw new Error("Persisted Optimization baseline identity changed")
            }
            const record = {
                runId,
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: version.id,
                skillRoot: skill.skillRoot,
                repositoryPath: realpathSync(repository.managedPath),
                workspacePath: resolve(this.workspacesRoot, runId),
                branchName: `rolling-skill/optimization/${runId}`,
                baselineCommit: version.commit,
                baselineDigest: version.contentDigest,
            }
            if (JSON.stringify(workspaceCopy(record)) !== JSON.stringify(expectedWorkspace)) {
                throw new Error("Persisted Optimization workspace identity changed")
            }
            this.#verifyWorkspace(record)
            if (await this.git.defaultBranch(record.workspacePath) !== record.branchName ||
                !await this.git.isAncestor(
                    record.repositoryPath,
                    record.baselineCommit,
                    await this.git.worktreeHead(record.workspacePath),
                )) {
                throw new Error("Persisted Optimization workspace branch identity changed")
            }
            this.workspaces.set(runId, record)
            return workspaceCopy(record)
        })
    }

    async #create(run) {
        if (!run || typeof run !== "object" || Array.isArray(run)) {
            throw new Error("Optimization Run is required")
        }
        const runId = requiredId(run.id, "Optimization Run")
        if (this.workspaces.has(runId)) throw new Error("Optimization workspace is already registered")
        const baseline = run.snapshot?.baseline
        if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
            throw new Error("Optimization baseline is required")
        }
        const repositoryId = requiredId(baseline.repositoryId, "Repository")
        const skillId = requiredId(baseline.skillId, "Skill")
        const versionId = requiredId(baseline.versionId, "Version")
        const repository = this.store.getRepository(repositoryId)
        const skill = this.store.getSkill(skillId)
        const version = this.store.getVersion(versionId)
        if (skill.repositoryId !== repository.id || version.repositoryId !== repository.id ||
            version.skillId !== skill.id || version.state !== "released") {
            throw new Error("Optimization baseline does not match a Released managed Skill version")
        }
        for (const field of ["commit", "skillRoot", "contentDigest"]) {
            if (requiredText(baseline[field], `Optimization baseline ${field}`, 4_096) !== version[field]) {
                throw new Error(`Optimization baseline ${field} changed`)
            }
        }
        const repositoryPath = realpathSync(repository.managedPath)
        const workspacePath = resolve(this.workspacesRoot, runId)
        if (!isContained(this.workspacesRoot, workspacePath) || workspacePath === this.workspacesRoot) {
            throw new Error("Optimization workspace path escapes Application Support")
        }
        try {
            lstatSync(workspacePath)
            throw new Error("Optimization workspace path already exists")
        } catch (error) {
            if (error?.code !== "ENOENT") throw error
        }
        const branchName = `rolling-skill/optimization/${runId}`
        const record = {
            runId,
            repositoryId,
            skillId,
            versionId,
            skillRoot: skill.skillRoot,
            repositoryPath,
            workspacePath,
            branchName,
            baselineCommit: version.commit,
            baselineDigest: version.contentDigest,
        }
        this.workspaces.set(runId, record)
        try {
            await this.git.createWorktree(
                repositoryPath,
                workspacePath,
                branchName,
                version.commit,
            )
            const status = lstatSync(workspacePath)
            const actualPath = realpathSync(workspacePath)
            if (status.isSymbolicLink() || !status.isDirectory() || actualPath !== workspacePath ||
                !isContained(this.workspacesRoot, actualPath)) {
                throw new Error("Optimization workspace identity is invalid")
            }
            if (await this.git.worktreeHead(workspacePath) !== version.commit ||
                await this.git.defaultBranch(workspacePath) !== branchName) {
                throw new Error("Optimization workspace did not start at its frozen baseline")
            }
            return workspaceCopy(record)
        } catch (error) {
            this.workspaces.delete(runId)
            if (realpathIfDirectory(workspacePath) === workspacePath) {
                await this.git.removeWorktree(repositoryPath, workspacePath).catch(() => {})
            }
            throw error
        }
    }

    createCandidate(input = {}) {
        return this.enqueue(() => this.#createCandidate(input))
    }

    async #createCandidate(input) {
        exactKeys(input, ["runId", "epoch", "message"], "Optimization Candidate input")
        const runId = requiredId(input.runId, "Optimization Run")
        const epoch = requiredEpoch(input.epoch)
        const message = requiredText(input.message, "Candidate commit message", 2_000)
        const record = this.workspaces.get(runId)
        if (!record) throw new Error("Unknown registered Optimization workspace")
        this.#verifyWorkspace(record)
        if (await this.git.defaultBranch(record.workspacePath) !== record.branchName) {
            throw new Error("Optimization workspace branch identity changed")
        }
        const before = await this.git.worktreeHead(record.workspacePath)
        if (!await this.git.isAncestor(record.repositoryPath, record.baselineCommit, before)) {
            throw new Error("Optimization workspace HEAD is outside its frozen baseline history")
        }
        const status = await this.git.status(record.workspacePath)
        const commitMessage = `${message}\n\n` +
            `Rolling-Skill-Optimization-Run: ${runId}\n` +
            `Rolling-Skill-Optimization-Epoch: ${epoch}`
        if (!status.dirty) {
            const recorded = this.store.listVersions(record.skillId)
                .find((entry) => entry.commit === before)
            if (recorded) {
                if (recorded.optimizationRunId === runId && recorded.optimizationEpoch === epoch) {
                    return recorded
                }
                throw new Error("Optimization workspace HEAD belongs to another Candidate")
            }
            const committedMessage = await this.git.run(
                ["show", "-s", "--format=%B", before],
                {cwd: record.workspacePath},
            )
            if (committedMessage.stdout !== commitMessage) {
                throw new Error("Optimization workspace has no Candidate changes")
            }
        }
        const scan = scanManagedSkillRepository(record.workspacePath, this.scanLimits)
        const selected = scan.skills.find((entry) => entry.skillRoot === record.skillRoot)
        const storedSkill = this.store.getSkill(record.skillId)
        if (!selected || selected.status !== "valid" || selected.name !== storedSkill.name) {
            throw new Error("Selected Optimization Skill is invalid or changed identity")
        }
        const workingSnapshot = snapshotManagedSkill(
            join(record.workspacePath, selected.skillRoot),
            this.scanLimits,
        )
        if (workingSnapshot.digest === record.baselineDigest || this.store.listVersions(record.skillId)
            .some((entry) => entry.contentDigest === workingSnapshot.digest)) {
            throw new Error("Selected Optimization Skill content has not changed")
        }
        const commit = status.dirty
            ? await this.git.commitAll(record.workspacePath, commitMessage, {
                forcePaths: scan.skills
                    .filter((entry) => entry.status === "valid")
                    .map((entry) => entry.skillRoot),
            })
            : before
        if ((await this.git.status(record.workspacePath)).dirty ||
            await this.git.defaultBranch(record.workspacePath) !== record.branchName ||
            await this.git.worktreeHead(record.workspacePath) !== commit ||
            !await this.git.isAncestor(record.repositoryPath, record.baselineCommit, commit)) {
            throw new Error("Optimization Candidate commit changed during creation")
        }
        const committedScan = scanManagedSkillRepository(record.workspacePath, this.scanLimits)
        const committedSkill = committedScan.skills.find((entry) => entry.skillRoot === record.skillRoot)
        if (!committedSkill || committedSkill.status !== "valid" || committedSkill.name !== storedSkill.name) {
            throw new Error("Committed Optimization Skill identity is invalid")
        }
        const snapshot = await this.git.snapshotSkill(
            record.workspacePath,
            commit,
            record.skillRoot,
            this.scanLimits,
        )
        if (snapshot.digest !== workingSnapshot.digest || snapshot.digest === record.baselineDigest) {
            throw new Error("Committed Optimization Skill digest is inconsistent")
        }
        return this.store.addVersion({
            repositoryId: record.repositoryId,
            skillId: record.skillId,
            commit,
            contentDigest: snapshot.digest,
            state: "candidate",
            createdBy: "optimization",
            optimizationRunId: runId,
            optimizationEpoch: epoch,
        })
    }

    cleanup(runId) {
        return this.enqueue(async () => {
            runId = requiredId(runId, "Optimization Run")
            const record = this.workspaces.get(runId)
            if (!record) throw new Error("Unknown registered Optimization workspace")
            this.#verifyWorkspace(record)
            if (await this.git.defaultBranch(record.workspacePath) !== record.branchName) {
                throw new Error("Optimization workspace branch identity changed")
            }
            await this.git.removeWorktree(record.repositoryPath, record.workspacePath)
            this.workspaces.delete(runId)
            return workspaceCopy(record)
        })
    }

    #verifyWorkspace(record) {
        const status = lstatSync(record.workspacePath)
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new Error("Optimization workspace must be a regular directory")
        }
        const actual = realpathSync(record.workspacePath)
        if (actual !== record.workspacePath || !isContained(this.workspacesRoot, actual)) {
            throw new Error("Optimization workspace identity changed or escaped Application Support")
        }
    }
}

function realpathIfDirectory(path) {
    try {
        const status = lstatSync(path)
        if (status.isSymbolicLink() || !status.isDirectory()) return null
        return realpathSync(path)
    } catch {
        return null
    }
}

module.exports = {OptimizationWorkspaceManager}
