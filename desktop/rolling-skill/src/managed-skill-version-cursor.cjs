const MAX_SKILL_VERSION_CURSOR_LENGTH = 128
const REVISION_PATTERN = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u

function validRevision(value) {
    return typeof value === "string" && REVISION_PATTERN.test(value)
}

function validSequence(value) {
    return Number.isSafeInteger(value) && value >= 0
}

function encodeSkillVersionCursor({revision, sequence} = {}) {
    if (!validRevision(revision) || !validSequence(sequence)) {
        throw new Error("Invalid managed Skill version cursor")
    }
    return Buffer.from(`v1:${revision}:${sequence}`, "utf8").toString("base64url")
}

function decodeSkillVersionCursor(value) {
    if (
        typeof value !== "string" ||
        value.length < 1 ||
        value.length > MAX_SKILL_VERSION_CURSOR_LENGTH ||
        !/^[A-Za-z0-9_-]+$/u.test(value)
    ) throw new Error("Invalid managed Skill version cursor")

    const decoded = Buffer.from(value, "base64url").toString("utf8")
    const match = /^v1:([^:]+):(0|[1-9]\d*)$/u.exec(decoded)
    if (!match) throw new Error("Invalid managed Skill version cursor")
    const result = {revision: match[1], sequence: Number(match[2])}
    if (
        !validRevision(result.revision) ||
        !validSequence(result.sequence) ||
        encodeSkillVersionCursor(result) !== value
    ) throw new Error("Invalid managed Skill version cursor")
    return result
}

module.exports = {
    MAX_SKILL_VERSION_CURSOR_LENGTH,
    decodeSkillVersionCursor,
    encodeSkillVersionCursor,
}
