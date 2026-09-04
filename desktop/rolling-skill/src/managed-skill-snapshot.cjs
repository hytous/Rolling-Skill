const {createHash} = require("node:crypto")
const {
    lstatSync,
    existsSync,
    readFileSync,
    readdirSync,
    readlinkSync,
    realpathSync,
} = require("node:fs")
const {basename, dirname, isAbsolute, relative, resolve, sep} = require("node:path")
const YAML = require("yaml")
const DEFAULT_SCAN_LIMITS = Object.freeze({
    maxFiles: 10_000,
    maxTotalBytes: 256 * 1024 * 1024,
    maxFileBytes: 32 * 1024 * 1024,
})

function normalizedLimits(input = {}) {
    const result = {...DEFAULT_SCAN_LIMITS}
    for (const key of Object.keys(result)) {
        if (input[key] === undefined) continue
        const value = Number(input[key])
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new Error(`${key} must be a positive integer`)
        }
        result[key] = value
    }
    return result
}

function posixPath(value) {
    return String(value).split(sep).join("/") || "."
}

function comparePaths(left, right) {
    return left < right ? -1 : left > right ? 1 : 0
}

function isContained(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function safeRealRoot(path, label) {
    const root = realpathSync(path)
    if (!lstatSync(root).isDirectory()) throw new Error(`${label} must be a directory`)
    return root
}

function walkTree(path, options = {}) {
    const root = safeRealRoot(path, options.label ?? "Skill root")
    const containmentLabel = options.containmentLabel ?? "Skill root"
    const limits = normalizedLimits(options.limits)
    const records = []
    let entryCount = 0
    let totalBytes = 0

    function account(relativePath, size) {
        if (size > limits.maxFileBytes) {
            throw new Error(`Managed Skill single-file limit exceeded at ${relativePath}`)
        }
        if (totalBytes + size > limits.maxTotalBytes) {
            throw new Error(`Managed Skill total byte limit exceeded at ${relativePath}`)
        }
        totalBytes += size
    }

    function visit(directory, relativeDirectory = "") {
        const entries = readdirSync(directory, {withFileTypes: true})
            .sort((left, right) => comparePaths(left.name, right.name))
        for (const entry of entries) {
            if (entry.name.toLowerCase() === ".git") continue
            const absolutePath = resolve(directory, entry.name)
            const relativePath = posixPath(relative(root, absolutePath))
            entryCount += 1
            if (entryCount > limits.maxFiles) {
                throw new Error(`Managed Skill file count limit exceeded at ${relativePath}`)
            }
            const stat = lstatSync(absolutePath)
            if (stat.isDirectory()) {
                visit(absolutePath, relativePath)
                continue
            }
            if (stat.isSymbolicLink()) {
                const linkTarget = readlinkSync(absolutePath)
                if (isAbsolute(linkTarget)) {
                    throw new Error(
                        `Symbolic link ${relativePath} points outside the ${containmentLabel}`,
                    )
                }
                let resolvedTarget
                try {
                    resolvedTarget = realpathSync(resolve(dirname(absolutePath), linkTarget))
                } catch {
                    throw new Error(`Symbolic link ${relativePath} has a missing target`)
                }
                if (!isContained(root, resolvedTarget)) {
                    throw new Error(
                        `Symbolic link ${relativePath} points outside the ${containmentLabel}`,
                    )
                }
                const size = Buffer.byteLength(linkTarget)
                account(relativePath, size)
                records.push({
                    absolutePath,
                    path: relativePath,
                    type: "symlink",
                    executable: false,
                    size,
                    linkTarget,
                })
                continue
            }
            if (!stat.isFile()) {
                throw new Error(`Unsupported special file in managed Skill: ${relativePath}`)
            }
            account(relativePath, stat.size)
            records.push({
                absolutePath,
                path: relativePath,
                type: "file",
                executable: Boolean(stat.mode & 0o111),
                size: stat.size,
            })
        }
    }

    visit(root)
    records.sort((left, right) => comparePaths(left.path, right.path))
    return {root, records, entryCount, totalBytes, limits}
}

function decodeUtf8(buffer, path) {
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(buffer)
    } catch {
        throw new Error(`${path} must contain valid UTF-8 text`)
    }
}

function readFrontmatter(manifestPath) {
    const warnings = []
    let document = null
    let text
    try {
        text = decodeUtf8(readFileSync(manifestPath), manifestPath).replace(/\r\n?/gu, "\n")
    } catch (error) {
        return {name: null, description: null, warnings: [error.message]}
    }
    const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u)
    if (!match) {
        warnings.push("SKILL.md requires YAML frontmatter")
    } else {
        try {
            document = YAML.parse(match[1])
        } catch (error) {
            warnings.push(`SKILL.md frontmatter is invalid YAML: ${error.message}`)
        }
    }
    const name = typeof document?.name === "string" ? document.name.trim() : ""
    const description =
        typeof document?.description === "string" ? document.description.trim() : ""
    if (!name || name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) {
        warnings.push("Skill name must use lowercase letters, digits, and single hyphens")
    }
    if (!description || description.length > 1_024) {
        warnings.push("Skill description must contain 1 to 1024 characters")
    }
    return {name: name || null, description: description || null, warnings, text}
}

function validateManifestReferences(text, manifestPath, skillRoot) {
    const warnings = []
    const pattern = /\]\(([^)\n]+)\)/gu
    for (const match of text.matchAll(pattern)) {
        let target = match[1].trim()
        if (target.startsWith("<")) {
            const end = target.indexOf(">")
            target = end > 0 ? target.slice(1, end) : target
        } else {
            target = target.split(/\s+/u)[0]
        }
        if (!target || target.startsWith("#") || target.startsWith("//")) continue
        if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) continue
        target = target.split(/[?#]/u)[0]
        try {
            target = decodeURIComponent(target)
        } catch {
            warnings.push(`Skill reference has invalid URL encoding: ${match[1].trim()}`)
            continue
        }
        if (!target) continue
        if (isAbsolute(target) || /^[A-Za-z]:[\\/]/u.test(target)) {
            warnings.push(`Skill reference must be relative: ${target}`)
            continue
        }
        const resolvedTarget = resolve(dirname(manifestPath), target)
        if (!isContained(skillRoot, resolvedTarget)) {
            warnings.push(`Skill reference points outside the Skill root: ${target}`)
            continue
        }
        if (!existsSync(resolvedTarget)) {
            warnings.push(`Skill reference does not exist: ${target}`)
        }
    }
    return warnings
}

function publicFile(record) {
    const result = {
        path: record.path,
        type: record.type,
        executable: record.executable,
        size: record.size,
    }
    if (record.type === "symlink") result.linkTarget = record.linkTarget
    return result
}

function snapshotManagedSkill(skillRoot, limits = {}) {
    const walked = walkTree(skillRoot, {
        label: "Skill root",
        containmentLabel: "Skill root",
        limits,
    })
    const hash = createHash("sha256")
    for (const record of walked.records) {
        const data = record.type === "file"
            ? readFileSync(record.absolutePath)
            : Buffer.from(record.linkTarget, "utf8")
        hash.update(`${record.type}\0${record.path}\0${record.executable ? "1" : "0"}\0${data.length}\0`)
        hash.update(data)
        hash.update("\0")
    }
    return {
        digest: `sha256:${hash.digest("hex")}`,
        files: walked.records.map(publicFile),
        totalBytes: walked.totalBytes,
    }
}

function scanManagedSkillRepository(repositoryRoot, limits = {}) {
    const walked = walkTree(repositoryRoot, {
        label: "Repository root",
        containmentLabel: "repository",
        limits,
    })
    const manifests = walked.records.filter(
        (record) => record.type === "file" && basename(record.path) === "SKILL.md",
    )
    const skills = manifests.map((manifest) => {
        const skillRoot = posixPath(dirname(manifest.path))
        const parsed = readFrontmatter(manifest.absolutePath)
        const absoluteSkillRoot = dirname(manifest.absolutePath)
        if (skillRoot !== "." && parsed.name && basename(skillRoot) !== parsed.name) {
            parsed.warnings.push("Skill directory name must match the frontmatter name")
        }
        parsed.warnings.push(...validateManifestReferences(
            parsed.text ?? "",
            manifest.absolutePath,
            absoluteSkillRoot,
        ))
        const snapshot = snapshotManagedSkill(absoluteSkillRoot, limits)
        return {
            name: parsed.name ?? (skillRoot === "." ? "invalid-skill" : basename(skillRoot)),
            description: parsed.description,
            skillRoot,
            manifestPath: manifest.path,
            status: parsed.warnings.length ? "invalid" : "valid",
            warnings: parsed.warnings,
            executableFiles: snapshot.files
                .filter((entry) => entry.type === "file" && entry.executable)
                .map((entry) => entry.path),
        }
    })
    return {
        skills,
        warnings: manifests.length ? [] : ["Repository does not contain a SKILL.md"],
        stats: {
            fileCount: walked.records.length,
            entryCount: walked.entryCount,
            totalBytes: walked.totalBytes,
        },
    }
}

module.exports = {
    DEFAULT_SCAN_LIMITS,
    scanManagedSkillRepository,
    snapshotManagedSkill,
}
