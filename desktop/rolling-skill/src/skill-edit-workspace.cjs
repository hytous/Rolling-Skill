"use strict"

const {
    chmodSync,
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    realpathSync,
    rmSync,
    symlinkSync,
} = require("node:fs")
const {dirname, join, resolve, sep} = require("node:path")

const {ManagedSkillGit} = require("./managed-skill-git.cjs")
const {
    DEFAULT_SCAN_LIMITS,
    scanManagedSkillRepository,
    snapshotManagedSkill,
} = require("./managed-skill-snapshot.cjs")

const DEFAULT_MAX_DIFF_FILES = 500
const DEFAULT_MAX_PATCH_BYTES = 256 * 1024
const DEFAULT_MAX_TOTAL_PATCH_BYTES = 2 * 1024 * 1024

function requiredText(value, label, maximum = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maximum) throw new Error(`${label} is required`)
    return normalized
}

function requiredId(value) {
    const id = requiredText(value, "Skill edit session id", 200)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id)) {
        throw new Error("Skill edit session id contains unsupported characters")
    }
    return id
}

function positiveInteger(value, label, fallback) {
    if (value === undefined) return fallback
    const normalized = Number(value)
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new Error(`${label} must be a positive integer`)
    }
    return normalized
}

function isContained(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function ensurePrivateRoot(inputPath) {
    const requested = resolve(requiredText(inputPath, "Skill edit workspace root", 16_384))
    if (existsSync(requested)) {
        const status = lstatSync(requested)
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new Error("Skill edit workspace root must be a regular directory")
        }
    } else {
        mkdirSync(requested, {recursive: true, mode: 0o700})
    }
    chmodSync(requested, 0o700)
    const actual = realpathSync(requested)
    return actual
}

function copyValidatedSkillTree(sourceRoot, destinationPath, limits) {
    const sourceSnapshot = snapshotManagedSkill(sourceRoot, limits)
    mkdirSync(destinationPath, {mode: 0o700})
    chmodSync(destinationPath, 0o700)
    for (const file of sourceSnapshot.files) {
        const target = resolve(destinationPath, file.path)
        if (!isContained(destinationPath, target) || target === destinationPath) {
            throw new Error("Skill file path escapes the edit workspace")
        }
        mkdirSync(dirname(target), {recursive: true, mode: 0o700})
        if (file.type === "symlink") {
            symlinkSync(file.linkTarget, target)
            continue
        }
        copyFileSync(resolve(sourceRoot, file.path), target)
        chmodSync(target, file.executable ? 0o755 : 0o644)
    }
    const copiedSnapshot = snapshotManagedSkill(destinationPath, limits)
    if (copiedSnapshot.digest !== sourceSnapshot.digest) {
        throw new Error("Managed Skill changed while creating the edit workspace")
    }
    return copiedSnapshot
}

function statusName(value) {
    return ({A: "added", D: "deleted", M: "modified", T: "modified"})[value] ?? "modified"
}

function parseNameStatus(buffer) {
    const tokens = buffer.toString("utf8").split("\0").filter(Boolean)
    const records = []
    for (let index = 0; index < tokens.length;) {
        let status = tokens[index++]
        let path
        const tab = status.indexOf("\t")
        if (tab >= 0) {
            path = status.slice(tab + 1)
            status = status.slice(0, tab)
        } else {
            path = tokens[index++]
        }
        if (!path) throw new Error("Git Diff returned an invalid path record")
        records.push({path, status: statusName(status[0])})
    }
    return records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

function parseNumstat(buffer) {
    const result = new Map()
    for (const record of buffer.toString("utf8").split("\0").filter(Boolean)) {
        const [added, deleted, ...pathParts] = record.split("\t")
        const path = pathParts.join("\t")
        if (!path) continue
        const binary = added === "-" || deleted === "-"
        result.set(path, {
            binary,
            additions: binary ? null : Number(added),
            deletions: binary ? null : Number(deleted),
        })
    }
    return result
}

function boundedPatch(buffer, limit) {
    const truncated = buffer.length > limit
    const bounded = truncated ? buffer.subarray(0, limit) : buffer
    return {
        patch: bounded.toString("utf8"),
        patchBytes: bounded.length,
        truncated,
    }
}

class SkillEditWorkspaceManager {
    constructor(options = {}) {
        this.workspacesRoot = ensurePrivateRoot(options.workspacesRoot)
        this.git = options.git ?? new ManagedSkillGit()
        this.scanLimits = {...DEFAULT_SCAN_LIMITS, ...(options.scanLimits ?? {})}
        this.maxDiffFiles = positiveInteger(
            options.maxDiffFiles,
            "Maximum Diff files",
            DEFAULT_MAX_DIFF_FILES,
        )
        this.maxPatchBytes = positiveInteger(
            options.maxPatchBytes,
            "Maximum patch bytes",
            DEFAULT_MAX_PATCH_BYTES,
        )
        this.maxTotalPatchBytes = positiveInteger(
            options.maxTotalPatchBytes,
            "Maximum total patch bytes",
            DEFAULT_MAX_TOTAL_PATCH_BYTES,
        )
        this.workspaces = new Map()
        this.operationTail = Promise.resolve()
    }

    enqueue(operation) {
        const result = this.operationTail.then(operation, operation)
        this.operationTail = result.catch(() => {})
        return result
    }

    workspacePath(sessionId) {
        const path = resolve(this.workspacesRoot, requiredId(sessionId))
        if (path === this.workspacesRoot || !isContained(this.workspacesRoot, path)) {
            throw new Error("Skill edit workspace path escapes its private root")
        }
        return path
    }

    create(input = {}) {
        return this.enqueue(async () => {
            const sessionId = requiredId(input.sessionId)
            const skillName = requiredText(input.skillName, "Skill name", 128)
            const sourceRoot = realpathSync(requiredText(input.sourceRoot, "Skill source root", 16_384))
            if (this.workspaces.has(sessionId)) throw new Error("Skill edit workspace is already registered")
            const workspacePath = this.workspacePath(sessionId)
            if (existsSync(workspacePath)) throw new Error("Skill edit workspace already exists")
            try {
                const baseline = copyValidatedSkillTree(sourceRoot, workspacePath, this.scanLimits)
                const scan = scanManagedSkillRepository(workspacePath, this.scanLimits)
                if (
                    scan.skills.length !== 1 ||
                    scan.skills[0].skillRoot !== "." ||
                    scan.skills[0].status !== "valid" ||
                    scan.skills[0].name !== skillName
                ) throw new Error("Selected Skill is invalid or changed identity")
                await this.git.initialize(workspacePath)
                const baselineCommit = await this.git.commitAll(
                    workspacePath,
                    "Rolling Skill edit baseline",
                    {forcePaths: ["."]},
                )
                const record = {sessionId, skillName, workspacePath, baselineCommit, baselineDigest: baseline.digest}
                this.workspaces.set(sessionId, record)
                return {...record}
            } catch (error) {
                this.workspaces.delete(sessionId)
                if (existsSync(workspacePath)) rmSync(workspacePath, {recursive: true, force: true})
                throw error
            }
        })
    }

    register(input = {}) {
        return this.enqueue(async () => {
            const sessionId = requiredId(input.sessionId)
            const skillName = requiredText(input.skillName, "Skill name", 128)
            const workspacePath = this.workspacePath(sessionId)
            const persistedPath = resolve(requiredText(input.workspacePath, "Skill edit workspace path", 16_384))
            const canonicalPersistedPath = existsSync(persistedPath) ? realpathSync(persistedPath) : persistedPath
            if (canonicalPersistedPath !== workspacePath) {
                throw new Error("Persisted Skill edit workspace identity changed")
            }
            this.#verifyPath(workspacePath)
            const baselineCommit = await this.git.resolve(workspacePath, input.baselineCommit ?? "HEAD")
            const baseline = await this.git.snapshotSkill(workspacePath, baselineCommit, ".", this.scanLimits)
            const baselineDigest = requiredText(input.baselineDigest, "Skill edit baseline digest", 80)
            if (baseline.digest !== baselineDigest) throw new Error("Skill edit baseline digest changed")
            const record = {sessionId, skillName, workspacePath, baselineCommit, baselineDigest}
            this.workspaces.set(sessionId, record)
            await this.validate(sessionId)
            return {...record}
        })
    }

    resolve(sessionId) {
        const record = this.#record(sessionId)
        return record.workspacePath
    }

    async validate(sessionId) {
        const record = this.#record(sessionId)
        const scan = scanManagedSkillRepository(record.workspacePath, this.scanLimits)
        if (
            scan.skills.length !== 1 ||
            scan.skills[0].skillRoot !== "." ||
            scan.skills[0].status !== "valid" ||
            scan.skills[0].name !== record.skillName
        ) throw new Error("Edited Skill is invalid or changed identity")
        return {
            skill: scan.skills[0],
            snapshot: snapshotManagedSkill(record.workspacePath, this.scanLimits),
        }
    }

    async diff(sessionId) {
        const record = this.#record(sessionId)
        snapshotManagedSkill(record.workspacePath, this.scanLimits)
        await this.git.run(["add", "-N", "-f", "--", "."], {cwd: record.workspacePath})
        const statuses = parseNameStatus(await this.git.runRaw(
            ["diff", "--no-renames", "--name-status", "-z", "HEAD", "--", "."],
            {cwd: record.workspacePath},
        ))
        if (statuses.length > this.maxDiffFiles) throw new Error("Skill edit Diff file limit exceeded")
        const numstat = parseNumstat(await this.git.runRaw(
            ["diff", "--no-renames", "--numstat", "-z", "HEAD", "--", "."],
            {cwd: record.workspacePath},
        ))
        let remaining = this.maxTotalPatchBytes
        let truncated = false
        const files = []
        for (const entry of statuses) {
            const stats = numstat.get(entry.path) ?? {binary: false, additions: 0, deletions: 0}
            let patch = {patch: "", patchBytes: 0, truncated: false}
            if (!stats.binary && remaining > 0) {
                const raw = await this.git.runRaw(
                    ["diff", "--no-color", "--no-ext-diff", "HEAD", "--", entry.path],
                    {cwd: record.workspacePath},
                )
                patch = boundedPatch(raw, Math.min(this.maxPatchBytes, remaining))
                remaining -= patch.patchBytes
                truncated ||= patch.truncated
            } else if (!stats.binary) {
                patch.truncated = true
                truncated = true
            }
            files.push({...entry, ...stats, ...patch})
        }
        return {
            changed: files.length > 0,
            truncated,
            files,
            currentSnapshotDigest: snapshotManagedSkill(record.workspacePath, this.scanLimits).digest,
        }
    }

    cleanup(sessionId) {
        return this.enqueue(() => {
            const record = this.#record(sessionId)
            rmSync(record.workspacePath, {recursive: true, force: true})
            this.workspaces.delete(record.sessionId)
            return {sessionId: record.sessionId}
        })
    }

    #record(sessionId) {
        const id = requiredId(sessionId)
        const record = this.workspaces.get(id)
        if (!record) throw new Error("Unknown registered Skill edit workspace")
        this.#verifyPath(record.workspacePath)
        return record
    }

    #verifyPath(workspacePath) {
        const status = lstatSync(workspacePath)
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new Error("Skill edit workspace must be a regular directory")
        }
        const actual = realpathSync(workspacePath)
        if (actual !== workspacePath || !isContained(this.workspacesRoot, actual)) {
            throw new Error("Skill edit workspace identity changed or escaped its private root")
        }
    }
}

module.exports = {
    SkillEditWorkspaceManager,
    copyValidatedSkillTree,
}
