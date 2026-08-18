const {createHash} = require("node:crypto")
const {existsSync, lstatSync, readFileSync, realpathSync} = require("node:fs")
const {dirname, isAbsolute, relative, resolve, sep} = require("node:path")

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

function linkedLocalPaths(markdown) {
    const paths = new Set()
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
        if (withoutFragment) paths.add(withoutFragment)
    }
    const pathTextPattern = /(?:^|[\s`'"(（|])((?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md)(?=$|[\s`'"),，。；;：:|#])/gmu
    for (const match of String(markdown).matchAll(pathTextPattern)) {
        const value = String(match[1] ?? "").trim()
        if (value && !isAbsolute(value)) paths.add(value)
    }
    return [...paths]
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

        for (const linkedPath of linkedLocalPaths(content)) {
            const lexicalTarget = resolveLinkedPath(root, current.logicalPath, linkedPath)
            if (!inside(root, lexicalTarget)) {
                warnings.push(`Skipped ${linkedPath}: linked path leaves the Skill directory`)
                continue
            }
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

module.exports = {SKILL_EVIDENCE_SCHEMA, snapshotSkillEvidence, validateSkillEvidence}
