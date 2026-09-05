const {createHash} = require("node:crypto")
const {existsSync, lstatSync, readFileSync, realpathSync} = require("node:fs")
const {dirname, isAbsolute, posix, relative, resolve, sep} = require("node:path")

const SKILL_EVIDENCE_SCHEMA = "rolling-skill-evaluation-skill-evidence/v1"
const DEFAULT_LIMITS = Object.freeze({
    maxFiles: 80,
    maxFileBytes: 256_000,
    maxTotalBytes: 1_500_000,
})

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
            .join(",")}}`
    }
    return JSON.stringify(value)
}

function sha256(value) {
    return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function inside(root, candidate) {
    const pathFromRoot = relative(root, candidate)
    return pathFromRoot === "" || (
        !pathFromRoot.startsWith(`..${sep}`) &&
        pathFromRoot !== ".." &&
        !isAbsolute(pathFromRoot)
    )
}

function resolveLinkedPath(root, currentLogicalPath, linkedPath) {
    const rootRelative =
        linkedPath === "SKILL.md" ||
        linkedPath === "DEPENDENCIES.md" ||
        /^(?:references|assets|scripts)\//u.test(linkedPath)
    const base = rootRelative ? root : dirname(resolve(root, currentLogicalPath))
    const candidates = [resolve(base, linkedPath)]
    if (!rootRelative && currentLogicalPath === "SKILL.md" && !linkedPath.includes("/")) {
        candidates.push(resolve(root, "references", linkedPath), resolve(root, "assets", linkedPath))
    }
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

function resolveManagedLinkedPath(available, currentLogicalPath, linkedPath) {
    const root = "/managed-skill"
    const rootRelative =
        linkedPath === "SKILL.md" ||
        linkedPath === "DEPENDENCIES.md" ||
        /^(?:references|assets|scripts)\//u.test(linkedPath)
    const base = rootRelative ? root : posix.dirname(posix.resolve(root, currentLogicalPath))
    const candidates = [posix.resolve(base, linkedPath)]
    if (!rootRelative && currentLogicalPath === "SKILL.md" && !linkedPath.includes("/")) {
        candidates.push(
            posix.resolve(root, "references", linkedPath),
            posix.resolve(root, "assets", linkedPath),
        )
    }
    const logicalPaths = candidates.map((candidate) => posix.relative(root, candidate))
    return logicalPaths.find((candidate) => available.has(candidate)) ?? logicalPaths[0]
}

function linkedLocalPaths(markdown) {
    const paths = new Map()
    const pattern = /!?(?:\[[^\]]*\])\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu
    for (const match of String(markdown).matchAll(pattern)) {
        const value = String(match[1] ?? match[2] ?? "").trim()
        if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(value)) continue
        let decoded = value
        try {
            decoded = decodeURIComponent(value)
        } catch {
            // Keep the literal path so it can produce a bounded warning.
        }
        const withoutFragment = decoded.split("#", 1)[0].split("?", 1)[0]
        if (withoutFragment) paths.set(withoutFragment, true)
    }
    const pathTextPattern = /(?:^|[\s`'"(（|])((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md)(?=$|[\s`'"),，。；;：:|#])/gmu
    for (const match of String(markdown).matchAll(pathTextPattern)) {
        const value = String(match[1] ?? "").trim()
        if (value && !isAbsolute(value) && !paths.has(value)) paths.set(value, false)
    }
    return [...paths].map(([path, required]) => ({path, required}))
}

function validateSkillEvidence(value, {expectedName = null, requireComplete = false} = {}) {
    let snapshot
    try {
        snapshot = JSON.parse(JSON.stringify(value ?? null))
    } catch {
        throw new Error("Skill evidence must be a serializable object")
    }
    if (!snapshot || snapshot.schemaVersion !== SKILL_EVIDENCE_SCHEMA) {
        throw new Error(`Skill evidence must use ${SKILL_EVIDENCE_SCHEMA}`)
    }
    if (typeof snapshot.name !== "string" || !snapshot.name.trim()) {
        throw new Error("Skill evidence requires a name")
    }
    if (expectedName && snapshot.name !== expectedName) {
        throw new Error("Skill evidence name does not match the selected Skill")
    }
    if (!Array.isArray(snapshot.files) || !snapshot.files.length) {
        throw new Error("Skill evidence requires frozen files")
    }
    const ids = new Set()
    for (const file of snapshot.files) {
        const path = String(file?.path ?? "")
        const id = String(file?.id ?? "")
        if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`)) {
            throw new Error("Skill evidence contains an unsafe file path")
        }
        if (id !== `skill:${path.split(sep).join("/")}` || ids.has(id)) {
            throw new Error("Skill evidence contains an invalid or duplicate file id")
        }
        ids.add(id)
        if (typeof file.content !== "string") throw new Error("Skill evidence file content is required")
        const buffer = Buffer.from(file.content, "utf8")
        if (file.bytes !== buffer.length || file.digest !== sha256(buffer)) {
            throw new Error(`Skill evidence file digest is invalid: ${id}`)
        }
    }
    if (!ids.has("skill:SKILL.md")) throw new Error("Skill evidence must contain SKILL.md")
    if (!Array.isArray(snapshot.warnings) || snapshot.warnings.some((entry) => typeof entry !== "string")) {
        throw new Error("Skill evidence warnings must be an array of strings")
    }
    if (typeof snapshot.truncated !== "boolean") {
        throw new Error("Skill evidence truncated flag must be boolean")
    }
    if (requireComplete && (snapshot.truncated || snapshot.warnings.length)) {
        throw new Error("Formal evaluation requires complete Skill evidence without warnings or truncation")
    }
    const {digest: claimedDigest, ...withoutDigest} = snapshot
    if (claimedDigest !== sha256(canonicalJson(withoutDigest))) {
        throw new Error("Skill evidence digest does not match its content")
    }
    return Object.freeze(snapshot)
}

function snapshotSkillEvidence(skillReference, options = {}) {
    const name = String(skillReference?.name ?? "").trim()
    const selectedPath = String(skillReference?.path ?? "").trim()
    if (!name || !isAbsolute(selectedPath)) {
        throw new Error("A Skill name and absolute SKILL.md path are required")
    }
    const limits = {
        maxFiles: Math.max(1, Number(options.maxFiles) || DEFAULT_LIMITS.maxFiles),
        maxFileBytes: Math.max(1, Number(options.maxFileBytes) || DEFAULT_LIMITS.maxFileBytes),
        maxTotalBytes: Math.max(1, Number(options.maxTotalBytes) || DEFAULT_LIMITS.maxTotalBytes),
    }
    const root = realpathSync(dirname(selectedPath))
    const skillPath = realpathSync(selectedPath)
    if (!lstatSync(skillPath).isFile()) throw new Error("The selected Skill path must be a file")
    if (!inside(root, skillPath)) throw new Error("The selected Skill must be inside its Skill directory")

    const queue = [{logicalPath: "SKILL.md", absolutePath: skillPath}]
    const visited = new Set()
    const files = []
    const warnings = []
    let totalBytes = 0

    while (queue.length) {
        const current = queue.shift()
        if (visited.has(current.logicalPath)) continue
        visited.add(current.logicalPath)
        if (files.length >= limits.maxFiles) {
            warnings.push(`File limit reached; omitted ${current.logicalPath}`)
            continue
        }
        let resolvedPath
        try {
            resolvedPath = realpathSync(current.absolutePath)
            if (!inside(root, resolvedPath) || !lstatSync(resolvedPath).isFile()) {
                throw new Error("outside the Skill directory or not a file")
            }
        } catch (error) {
            warnings.push(`Skipped ${current.logicalPath}: ${error.message}`)
            continue
        }
        const buffer = readFileSync(resolvedPath)
        if (buffer.length > limits.maxFileBytes) {
            warnings.push(`Skipped ${current.logicalPath}: file exceeds snapshot limit`)
            continue
        }
        if (totalBytes + buffer.length > limits.maxTotalBytes) {
            warnings.push(`Skipped ${current.logicalPath}: snapshot exceeds total limit`)
            continue
        }
        if (buffer.includes(0)) {
            warnings.push(`Skipped ${current.logicalPath}: binary content is not supported`)
            continue
        }
        const content = buffer.toString("utf8")
        if (!Buffer.from(content, "utf8").equals(buffer)) {
            warnings.push(`Skipped ${current.logicalPath}: content is not valid UTF-8`)
            continue
        }
        totalBytes += buffer.length
        files.push({
            id: `skill:${current.logicalPath}`,
            path: current.logicalPath,
            content,
            bytes: buffer.length,
            digest: sha256(buffer),
        })

        for (const link of linkedLocalPaths(content)) {
            const linkedPath = link.path
            const lexicalTarget = resolveLinkedPath(root, current.logicalPath, linkedPath)
            if (!inside(root, lexicalTarget)) {
                warnings.push(`Skipped ${linkedPath}: linked path leaves the Skill directory`)
                continue
            }
            if (!link.required && !existsSync(lexicalTarget)) continue
            const logicalPath = relative(root, lexicalTarget).split(sep).join("/")
            if (!visited.has(logicalPath)) queue.push({logicalPath, absolutePath: lexicalTarget})
        }
    }

    const snapshot = {
        schemaVersion: SKILL_EVIDENCE_SCHEMA,
        name,
        files,
        warnings,
        limits,
        truncated: warnings.some((warning) => /limit|omitted/iu.test(warning)),
    }
    return Object.freeze({...snapshot, digest: sha256(canonicalJson(snapshot))})
}

async function snapshotManagedSkillEvidence(source = {}, options = {}) {
    const name = String(source.name ?? "").trim()
    const repositoryId = String(source.repositoryId ?? "").trim()
    const skillId = String(source.skillId ?? "").trim()
    const versionId = String(source.versionId ?? "").trim()
    const repositoryPath = String(source.repositoryPath ?? "").trim()
    const commit = String(source.commit ?? "").trim()
    const skillRoot = String(source.skillRoot ?? "").trim().replace(/\\/gu, "/")
    const contentDigest = String(source.contentDigest ?? "").trim()
    const git = options.git
    if (!name || !repositoryId || !skillId || !versionId || !isAbsolute(repositoryPath)) {
        throw new Error("Managed Skill evidence requires a name and absolute repository path")
    }
    if (!/^[a-f0-9]{40}$/u.test(commit) || !/^sha256:[a-f0-9]{64}$/u.test(contentDigest)) {
        throw new Error("Managed Skill evidence requires an immutable commit and content digest")
    }
    if (
        !skillRoot ||
        isAbsolute(skillRoot) ||
        (skillRoot !== "." && (
            skillRoot !== skillRoot.split("/").filter(Boolean).join("/") ||
            skillRoot.split("/").some((segment) => segment === "." || segment === "..")
        ))
    ) {
        throw new Error("Managed Skill evidence requires a repository-relative Skill root")
    }
    if (
        !git ||
        typeof git.snapshotSkill !== "function" ||
        typeof git.readSkillFile !== "function"
    ) {
        throw new Error("Managed Skill Git reader is required")
    }
    const limits = {
        maxFiles: Math.max(1, Number(options.maxFiles) || DEFAULT_LIMITS.maxFiles),
        maxFileBytes: Math.max(1, Number(options.maxFileBytes) || DEFAULT_LIMITS.maxFileBytes),
        maxTotalBytes: Math.max(1, Number(options.maxTotalBytes) || DEFAULT_LIMITS.maxTotalBytes),
    }
    const managed = await git.snapshotSkill(repositoryPath, commit, skillRoot)
    if (managed.digest !== contentDigest) {
        throw new Error("Managed Skill commit content digest does not match the frozen Candidate")
    }
    const available = new Map(managed.files.map((file) => [file.path, file]))
    if (available.get("SKILL.md")?.type !== "file") {
        throw new Error("Managed Skill commit does not contain a regular SKILL.md")
    }
    const queue = ["SKILL.md"]
    const visited = new Set()
    const files = []
    const warnings = []
    let totalBytes = 0
    while (queue.length) {
        const logicalPath = queue.shift()
        if (visited.has(logicalPath)) continue
        visited.add(logicalPath)
        const metadata = available.get(logicalPath)
        if (!metadata || metadata.type !== "file") {
            warnings.push(`Skipped ${logicalPath}: unavailable in the frozen managed commit`)
            continue
        }
        if (files.length >= limits.maxFiles) {
            warnings.push(`File limit reached; omitted ${logicalPath}`)
            continue
        }
        const buffer = await git.readSkillFile(repositoryPath, commit, skillRoot, logicalPath)
        if (buffer.length > limits.maxFileBytes || totalBytes + buffer.length > limits.maxTotalBytes) {
            warnings.push(`Skipped ${logicalPath}: snapshot limit exceeded`)
            continue
        }
        if (buffer.includes(0)) {
            warnings.push(`Skipped ${logicalPath}: binary content is not supported`)
            continue
        }
        let content
        try {
            content = new TextDecoder("utf-8", {fatal: true}).decode(buffer)
        } catch {
            warnings.push(`Skipped ${logicalPath}: content is not valid UTF-8`)
            continue
        }
        totalBytes += buffer.length
        files.push({
            id: `skill:${logicalPath}`,
            path: logicalPath,
            content,
            bytes: buffer.length,
            digest: sha256(buffer),
        })
        for (const link of linkedLocalPaths(content)) {
            const linkedPath = link.path
            const next = resolveManagedLinkedPath(available, logicalPath, linkedPath)
            if (!link.required && !available.has(next)) continue
            if (next && !next.startsWith("../") && !visited.has(next)) queue.push(next)
        }
    }
    const snapshot = {
        schemaVersion: SKILL_EVIDENCE_SCHEMA,
        name,
        files,
        warnings,
        limits,
        truncated: warnings.some((warning) => /limit|omitted/iu.test(warning)),
        managedSource: {
            repositoryId,
            skillId,
            versionId,
            commit,
            skillRoot,
            contentDigest,
        },
    }
    return Object.freeze({...snapshot, digest: sha256(canonicalJson(snapshot))})
}

module.exports = {
    SKILL_EVIDENCE_SCHEMA,
    snapshotManagedSkillEvidence,
    snapshotSkillEvidence,
    validateSkillEvidence,
}
