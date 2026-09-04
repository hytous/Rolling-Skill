const {createHash} = require("node:crypto")
const {execFile} = require("node:child_process")
const {realpathSync} = require("node:fs")
const {basename, isAbsolute, posix, resolve: resolvePath} = require("node:path")

const {DEFAULT_SCAN_LIMITS} = require("./managed-skill-snapshot.cjs")

const MAX_GIT_OUTPUT = 8 * 1024 * 1024

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function redactGitLocation(value) {
    const location = requiredText(value, "Git location", 8_192)
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(location)) {
        try {
            const url = new URL(location)
            if (url.protocol === "file:") return basename(url.pathname) || "local-git-repository"
            url.username = ""
            url.password = ""
            url.search = ""
            url.hash = ""
            return url.toString().replace(/\/$/u, "")
        } catch {}
    }
    const scp = location.match(/^(?:[^@/\s]+@)?([^:/\s]+):([^?#]+)(?:[?#].*)?$/u)
    if (scp) return `${scp[1]}:${scp[2]}`
    return basename(location.replace(/[?#].*$/u, "")) || "local-git-repository"
}

function redactGitError(value, locations = []) {
    let message = String(value ?? "Git operation failed")
    for (const location of locations) {
        if (!location) continue
        message = message.split(String(location)).join(redactGitLocation(location))
    }
    message = message.replace(/(https?:\/\/)[^/@\s]+@/giu, "$1")
    message = message.replace(/([?&](?:token|access_token|password|key)=)[^&#\s]+/giu, "$1[redacted]")
    return message.trim()
}

function requireGitSourceLocation(value) {
    const location = requiredText(value, "Git URL", 8_192)
    if (location.startsWith("-")) {
        throw new Error("Git URL must use HTTPS, SSH, or SCP syntax")
    }
    if (
        !location.includes("://") &&
        /^(?:[^@/\s]+@)?[^:/\s]+:[^\s]+$/u.test(location)
    ) return location
    let url
    try {
        url = new URL(location)
    } catch {
        throw new Error("Git URL must use HTTPS, SSH, or SCP syntax")
    }
    if (!new Set(["https:", "ssh:"]).has(url.protocol)) {
        throw new Error("Git URL must use HTTPS, SSH, or SCP syntax")
    }
    return location
}

function normalizedSnapshotLimits(input = {}) {
    const limits = {...DEFAULT_SCAN_LIMITS}
    for (const key of Object.keys(limits)) {
        if (input[key] === undefined) continue
        const value = Number(input[key])
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${key} must be a positive integer`)
        }
        limits[key] = value
    }
    return limits
}

function normalizedSkillRoot(value) {
    const skillRoot = requiredText(value, "Skill root", 4_096).replace(/\\/gu, "/")
    if (
        isAbsolute(skillRoot) ||
        (skillRoot !== "." && (
            posix.normalize(skillRoot) !== skillRoot ||
            skillRoot.split("/").some((segment) => !segment || segment === "." || segment === "..")
        ))
    ) {
        throw new Error("Skill root must be a normalized repository-relative path")
    }
    return skillRoot
}

class ManagedSkillGit {
    constructor(options = {}) {
        this.gitExecutable = options.gitExecutable ?? "git"
        this.environment = {...process.env, ...(options.environment ?? {})}
        this.execFile = options.execFile ?? execFile
    }

    run(args, options = {}) {
        const baseArgs = [
            "-c", "core.hooksPath=/dev/null",
            "-c", "user.name=Rolling Skill",
            "-c", "user.email=rolling-skill@localhost",
            "-c", "tag.gpgSign=false",
        ]
        const allowed = new Set(options.allowExitCodes ?? [0])
        return new Promise((resolve, reject) => {
            this.execFile(
                this.gitExecutable,
                [...baseArgs, ...args],
                {
                    cwd: options.cwd,
                    env: {
                        ...this.environment,
                        GIT_CONFIG_NOSYSTEM: "1",
                        GIT_TERMINAL_PROMPT: "0",
                    },
                    encoding: "utf8",
                    maxBuffer: MAX_GIT_OUTPUT,
                },
                (error, stdout = "", stderr = "") => {
                    const exitCode = Number.isInteger(error?.code) ? error.code : error ? null : 0
                    if (!error || allowed.has(exitCode)) {
                        resolve({
                            exitCode: exitCode ?? 0,
                            stdout: String(stdout).trim(),
                            stderr: String(stderr).trim(),
                        })
                        return
                    }
                    const detail = stderr || stdout || error.message
                    const failure = new Error(redactGitError(detail, options.redactLocations))
                    failure.code = "MANAGED_SKILL_GIT_FAILED"
                    failure.exitCode = exitCode
                    reject(failure)
                },
            )
        })
    }

    runRaw(args, options = {}) {
        const baseArgs = [
            "-c", "core.hooksPath=/dev/null",
            "-c", "user.name=Rolling Skill",
            "-c", "user.email=rolling-skill@localhost",
            "-c", "tag.gpgSign=false",
        ]
        return new Promise((resolve, reject) => {
            this.execFile(
                this.gitExecutable,
                [...baseArgs, ...args],
                {
                    cwd: options.cwd,
                    env: {
                        ...this.environment,
                        GIT_CONFIG_NOSYSTEM: "1",
                        GIT_TERMINAL_PROMPT: "0",
                    },
                    encoding: null,
                    maxBuffer: options.maxBuffer ?? MAX_GIT_OUTPUT,
                },
                (error, stdout = Buffer.alloc(0), stderr = Buffer.alloc(0)) => {
                    if (!error) {
                        resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout))
                        return
                    }
                    const detail = Buffer.isBuffer(stderr) && stderr.length
                        ? stderr.toString("utf8")
                        : Buffer.isBuffer(stdout) && stdout.length
                          ? stdout.toString("utf8")
                          : error.message
                    const failure = new Error(redactGitError(detail, options.redactLocations))
                    failure.code = "MANAGED_SKILL_GIT_FAILED"
                    reject(failure)
                },
            )
        })
    }

    async initialize(repositoryPath) {
        await this.run(["init", "-b", "main", "."], {cwd: repositoryPath})
        return this.headOrNull(repositoryPath)
    }

    async cloneLocal(sourcePath, destinationPath) {
        await this.run(
            ["clone", "--no-recurse-submodules", "--no-local", "--", sourcePath, destinationPath],
            {redactLocations: [sourcePath]},
        )
        await this.run(["remote", "remove", "origin"], {cwd: destinationPath})
        return this.head(destinationPath)
    }

    async cloneUrl(location, destinationPath) {
        location = requiredText(location, "Git URL", 8_192)
        await this.run(
            ["clone", "--no-recurse-submodules", "--", location, destinationPath],
            {redactLocations: [location]},
        )
        await this.run(["remote", "remove", "origin"], {cwd: destinationPath})
        return this.head(destinationPath)
    }

    async headOrNull(repositoryPath) {
        const result = await this.run(
            ["rev-parse", "--verify", "HEAD^{commit}"],
            {cwd: repositoryPath, allowExitCodes: [0, 128]},
        )
        return result.exitCode === 0 ? result.stdout : null
    }

    async head(repositoryPath) {
        const commit = await this.headOrNull(repositoryPath)
        if (!commit || !/^[a-f0-9]{40}$/u.test(commit)) {
            throw new Error("Managed Skill repository does not have a valid HEAD commit")
        }
        return commit
    }

    async resolve(repositoryPath, reference) {
        reference = requiredText(reference, "Git reference", 500)
        const commitReference = reference.endsWith("^{commit}")
            ? reference
            : `${reference}^{commit}`
        const result = await this.run(
            ["rev-parse", "--verify", commitReference],
            {cwd: repositoryPath},
        )
        if (!/^[a-f0-9]{40}$/u.test(result.stdout)) throw new Error("Git reference is not a commit")
        return result.stdout
    }

    async defaultBranch(repositoryPath) {
        const result = await this.run(["symbolic-ref", "--short", "HEAD"], {cwd: repositoryPath})
        return requiredText(result.stdout, "Default branch", 200)
    }

    async status(repositoryPath) {
        const result = await this.run(
            ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            {cwd: repositoryPath},
        )
        const entries = result.stdout.split("\0").filter(Boolean)
        return {dirty: entries.length > 0, entries}
    }

    async createWorktree(repositoryPath, workspacePath, branchName, baselineCommit) {
        repositoryPath = resolvePath(requiredText(repositoryPath, "Managed repository path", 8_192))
        workspacePath = resolvePath(requiredText(workspacePath, "Optimization workspace path", 8_192))
        branchName = requiredText(branchName, "Optimization branch", 500)
        await this.run(["check-ref-format", `refs/heads/${branchName}`], {cwd: repositoryPath})
        baselineCommit = await this.resolve(
            repositoryPath,
            requiredText(baselineCommit, "Optimization baseline commit", 500),
        )
        const existing = await this.run(
            ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
            {cwd: repositoryPath, allowExitCodes: [0, 1]},
        )
        if (existing.exitCode === 0) throw new Error("Optimization branch already exists")
        await this.run(
            ["worktree", "add", "-b", branchName, "--", workspacePath, baselineCommit],
            {cwd: repositoryPath},
        )
        return {
            workspacePath,
            branchName,
            commit: await this.worktreeHead(workspacePath),
        }
    }

    async worktreeHead(workspacePath) {
        return this.head(resolvePath(requiredText(workspacePath, "Optimization workspace path", 8_192)))
    }

    async isAncestor(repositoryPath, ancestorCommit, descendantCommit) {
        repositoryPath = resolvePath(requiredText(repositoryPath, "Managed repository path", 8_192))
        ancestorCommit = await this.resolve(repositoryPath, ancestorCommit)
        descendantCommit = await this.resolve(repositoryPath, descendantCommit)
        const result = await this.run(
            ["merge-base", "--is-ancestor", ancestorCommit, descendantCommit],
            {cwd: repositoryPath, allowExitCodes: [0, 1]},
        )
        return result.exitCode === 0
    }

    async removeWorktree(repositoryPath, workspacePath) {
        repositoryPath = resolvePath(requiredText(repositoryPath, "Managed repository path", 8_192))
        workspacePath = resolvePath(requiredText(workspacePath, "Optimization workspace path", 8_192))
        try {
            workspacePath = realpathSync(workspacePath)
        } catch {
            throw new Error("Optimization path is not a registered Git worktree")
        }
        const listed = await this.run(["worktree", "list", "--porcelain", "-z"], {
            cwd: repositoryPath,
        })
        const registered = listed.stdout
            .split("\0\0")
            .flatMap((record) => record.split("\0"))
            .some((field) => field === `worktree ${workspacePath}`)
        if (!registered) throw new Error("Optimization path is not a registered Git worktree")
        await this.run(["worktree", "remove", "--force", "--", workspacePath], {
            cwd: repositoryPath,
        })
        return {workspacePath}
    }

    async commitAll(repositoryPath, message, options = {}) {
        message = requiredText(message, "Commit message", 2_000)
        await this.run(["add", "-A", "--", "."], {cwd: repositoryPath})
        const forcePaths = [...new Set((options.forcePaths ?? []).map(normalizedSkillRoot))]
        if (forcePaths.length) {
            await this.run(["add", "-f", "-A", "--", ...forcePaths], {cwd: repositoryPath})
        }
        const staged = await this.run(
            ["diff", "--cached", "--quiet", "--exit-code"],
            {cwd: repositoryPath, allowExitCodes: [0, 1]},
        )
        if (staged.exitCode === 0) {
            throw new Error("Managed Skill repository has no working changes to commit")
        }
        await this.run(["commit", "--no-gpg-sign", "-m", message], {cwd: repositoryPath})
        return this.head(repositoryPath)
    }

    async commitPaths(repositoryPath, message, inputPaths) {
        message = requiredText(message, "Commit message", 2_000)
        const paths = [...new Set((inputPaths ?? []).map(normalizedSkillRoot))]
        if (!paths.length) throw new Error("At least one commit path is required")
        await this.run(["add", "-f", "-A", "--", ...paths], {cwd: repositoryPath})
        const staged = await this.run(
            ["diff", "--cached", "--quiet", "--exit-code", "--", ...paths],
            {cwd: repositoryPath, allowExitCodes: [0, 1]},
        )
        if (staged.exitCode === 0) {
            throw new Error("Managed Skill paths have no working changes to commit")
        }
        await this.run(
            ["commit", "--no-gpg-sign", "--only", "-m", message, "--", ...paths],
            {cwd: repositoryPath},
        )
        return this.head(repositoryPath)
    }

    async softReset(repositoryPath, inputCommit) {
        const target = await this.resolve(
            repositoryPath,
            requiredText(inputCommit, "Reset commit", 500),
        )
        await this.run(["reset", "--soft", target], {cwd: repositoryPath})
        return this.head(repositoryPath)
    }

    async resetPaths(repositoryPath, inputCommit, inputPaths) {
        const target = await this.resolve(
            repositoryPath,
            requiredText(inputCommit, "Reset commit", 500),
        )
        const paths = [...new Set((inputPaths ?? []).map(normalizedSkillRoot))]
        if (!paths.length) throw new Error("At least one reset path is required")
        await this.run(["reset", target, "--", ...paths], {cwd: repositoryPath})
        return {commit: target, paths}
    }

    async snapshotSkill(repositoryPath, commit, inputSkillRoot, inputLimits = {}) {
        commit = await this.resolve(repositoryPath, requiredText(commit, "Commit", 500))
        const skillRoot = normalizedSkillRoot(inputSkillRoot)
        const limits = normalizedSnapshotLimits(inputLimits)
        const tree = await this.run(
            ["ls-tree", "-rlz", "--full-tree", commit],
            {cwd: repositoryPath},
        )
        const records = []
        let totalBytes = 0
        for (const raw of tree.stdout.split("\0").filter(Boolean)) {
            const tab = raw.indexOf("\t")
            if (tab < 0 || raw.includes("\uFFFD")) throw new Error("Git tree contains an invalid path")
            const [mode, type, objectId, sizeText] = raw.slice(0, tab).trim().split(/\s+/u)
            const repositoryPathName = raw.slice(tab + 1)
            const inside = skillRoot === "."
                ? repositoryPathName
                : repositoryPathName.startsWith(`${skillRoot}/`)
                  ? repositoryPathName.slice(skillRoot.length + 1)
                  : null
            if (!inside) continue
            if (inside.split("/").some((segment) => segment.toLowerCase() === ".git")) continue
            if (type !== "blob" || !new Set(["100644", "100755", "120000"]).has(mode)) {
                throw new Error(`Unsupported Git tree entry in managed Skill: ${repositoryPathName}`)
            }
            const size = Number(sizeText)
            if (!Number.isSafeInteger(size) || size < 0) throw new Error("Git tree entry size is invalid")
            if (records.length + 1 > limits.maxFiles) {
                throw new Error(`Managed Skill file count limit exceeded at ${inside}`)
            }
            if (size > limits.maxFileBytes) {
                throw new Error(`Managed Skill single-file limit exceeded at ${inside}`)
            }
            if (totalBytes + size > limits.maxTotalBytes) {
                throw new Error(`Managed Skill total byte limit exceeded at ${inside}`)
            }
            totalBytes += size
            records.push({
                path: inside,
                objectId,
                size,
                type: mode === "120000" ? "symlink" : "file",
                executable: mode === "100755",
            })
        }
        records.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
        const hash = createHash("sha256")
        const files = []
        for (const record of records) {
            const data = await this.runRaw(["cat-file", "blob", record.objectId], {
                cwd: repositoryPath,
                maxBuffer: Math.max(MAX_GIT_OUTPUT, record.size + 1_024),
            })
            if (data.length !== record.size) throw new Error(`Git blob size changed for ${record.path}`)
            hash.update(`${record.type}\0${record.path}\0${record.executable ? "1" : "0"}\0${data.length}\0`)
            hash.update(data)
            hash.update("\0")
            const file = {
                path: record.path,
                type: record.type,
                executable: record.executable,
                size: data.length,
            }
            if (record.type === "symlink") {
                const linkTarget = new TextDecoder("utf-8", {fatal: true}).decode(data)
                const resolvedTarget = posix.normalize(posix.join(
                    posix.dirname(record.path),
                    linkTarget,
                ))
                if (
                    !linkTarget ||
                    linkTarget.includes("\0") ||
                    isAbsolute(linkTarget) ||
                    /^[A-Za-z]:[\\/]/u.test(linkTarget) ||
                    resolvedTarget === ".." ||
                    resolvedTarget.startsWith("../")
                ) {
                    throw new Error(`Git symbolic link points outside the Skill root: ${record.path}`)
                }
                file.linkTarget = linkTarget
            }
            files.push(file)
        }
        return {digest: `sha256:${hash.digest("hex")}`, files, totalBytes}
    }

    async readSkillFile(repositoryPath, commit, inputSkillRoot, inputPath) {
        commit = await this.resolve(repositoryPath, requiredText(commit, "Commit", 500))
        const skillRoot = normalizedSkillRoot(inputSkillRoot)
        const path = requiredText(inputPath, "Skill file path", 4_096).replace(/\\/gu, "/")
        if (
            isAbsolute(path) ||
            posix.normalize(path) !== path ||
            path.split("/").some((segment) => !segment || segment === "." || segment === "..")
        ) {
            throw new Error("Skill file path must stay inside the Skill root")
        }
        const repositoryFile = skillRoot === "." ? path : `${skillRoot}/${path}`
        return this.runRaw(["show", `${commit}:${repositoryFile}`], {
            cwd: repositoryPath,
            maxBuffer: MAX_GIT_OUTPUT,
        })
    }

    async createAnnotatedTag(repositoryPath, tagName, message, commit) {
        tagName = requiredText(tagName, "Release tag", 500)
        message = requiredText(message, "Release tag message", 2_000)
        commit = requiredText(commit, "Release commit", 40)
        await this.run(["check-ref-format", `refs/tags/${tagName}`], {cwd: repositoryPath})
        const existing = await this.run(
            ["show-ref", "--verify", "--quiet", `refs/tags/${tagName}`],
            {cwd: repositoryPath, allowExitCodes: [0, 1]},
        )
        if (existing.exitCode === 0) throw new Error(`Release tag already exists: ${tagName}`)
        await this.run(["tag", "-a", tagName, "-m", message, commit], {cwd: repositoryPath})
        return this.resolve(repositoryPath, tagName)
    }

    async deleteTag(repositoryPath, tagName) {
        tagName = requiredText(tagName, "Release tag", 500)
        await this.run(["check-ref-format", `refs/tags/${tagName}`], {cwd: repositoryPath})
        await this.run(["tag", "-d", tagName], {cwd: repositoryPath})
    }

    async subject(repositoryPath, commit = "HEAD") {
        const result = await this.run(
            ["show", "-s", "--format=%s", requiredText(commit, "Commit", 500)],
            {cwd: repositoryPath},
        )
        return result.stdout
    }
}

module.exports = {
    ManagedSkillGit,
    redactGitLocation,
    requireGitSourceLocation,
}
