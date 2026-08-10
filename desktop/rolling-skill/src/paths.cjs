const {existsSync, statSync} = require("node:fs")
const {dirname, join, resolve} = require("node:path")

const REPOSITORY_MARKER = join("hosting", "docker-compose", "run.sh")

function isRepositoryRoot(candidate) {
    if (!candidate || typeof candidate !== "string") return false
    return existsSync(join(resolve(candidate), REPOSITORY_MARKER))
}

function directoryForCandidate(candidate) {
    if (!candidate || typeof candidate !== "string") return null
    const resolved = resolve(candidate)
    try {
        return statSync(resolved).isDirectory() ? resolved : dirname(resolved)
    } catch {
        return resolved
    }
}

function findRepositoryRoot(candidates) {
    const visited = new Set()
    for (const candidate of candidates) {
        let current = directoryForCandidate(candidate)
        while (current && !visited.has(current)) {
            visited.add(current)
            if (isRepositoryRoot(current)) return current
            const parent = dirname(current)
            if (parent === current) break
            current = parent
        }
    }
    return null
}

module.exports = {
    REPOSITORY_MARKER,
    findRepositoryRoot,
    isRepositoryRoot,
}
