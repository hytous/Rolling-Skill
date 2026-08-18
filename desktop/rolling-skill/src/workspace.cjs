const {existsSync, statSync} = require("node:fs")
const {dirname, join, resolve} = require("node:path")

function isGitWorkspace(candidate) {
    if (!candidate || typeof candidate !== "string") return false
    return existsSync(join(resolve(candidate), ".git"))
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

function findGitWorkspace(candidates) {
    const visited = new Set()
    for (const candidate of candidates) {
        let current = directoryForCandidate(candidate)
        while (current && !visited.has(current)) {
            visited.add(current)
            if (isGitWorkspace(current)) return current
            const parent = dirname(current)
            if (parent === current) break
            current = parent
        }
    }
    return null
}

module.exports = {findGitWorkspace, isGitWorkspace}
