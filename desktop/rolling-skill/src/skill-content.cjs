const {createHash} = require("node:crypto")

function normalizeSkillContent(value) {
    let content = String(value ?? "").replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n")
    content = content.replace(/^Base directory for this skill:[^\n]*(?:\n|$)/u, "")
    if (content.startsWith("---\n")) {
        const closing = content.indexOf("\n---\n", 4)
        if (closing >= 0) content = content.slice(closing + 5)
    }
    return content.trim()
}

function skillContentDigest(value) {
    return `sha256:${createHash("sha256").update(normalizeSkillContent(value), "utf8").digest("hex")}`
}

module.exports = {normalizeSkillContent, skillContentDigest}
