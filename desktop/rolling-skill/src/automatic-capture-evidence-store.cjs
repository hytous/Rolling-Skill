const {createHash, randomUUID} = require("node:crypto")
const {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {isAbsolute, join, resolve} = require("node:path")

const AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA =
    "rolling-skill-automatic-evidence-reference/v1"
const EPISODE_SCHEMA = "rolling-skill-episode/v1"
const DIGEST_PATTERN = /^sha256:([a-f0-9]{64})$/u

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (!value || typeof value !== "object") return value
    const normalized = {}
    for (const key of Object.keys(value).sort()) normalized[key] = stableValue(value[key])
    return normalized
}

function stableJson(value) {
    return `${JSON.stringify(stableValue(value))}\n`
}

function validatedEpisode(value) {
    if (!value || value.schemaVersion !== EPISODE_SCHEMA) {
        throw new Error("Automatic capture evidence Episode schema is invalid")
    }
    if (!Array.isArray(value.items) || !value.source || typeof value.source !== "object") {
        throw new Error("Automatic capture evidence Episode is invalid")
    }
    return JSON.parse(JSON.stringify(value))
}

function validatedReference(value) {
    if (value?.schemaVersion !== AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA) {
        throw new Error("Automatic capture evidence reference schema is invalid")
    }
    const match = String(value?.digest ?? "").match(DIGEST_PATTERN)
    if (!match) throw new Error("Automatic capture evidence digest is invalid")
    return {
        schemaVersion: AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA,
        digest: `sha256:${match[1]}`,
    }
}

class AutomaticCaptureEvidenceStore {
    constructor(root) {
        const requested = String(root ?? "").trim()
        if (!requested || !isAbsolute(requested)) {
            throw new Error("Automatic capture evidence root must be absolute")
        }
        this.root = resolve(requested)
    }

    pathFor(reference) {
        const normalized = validatedReference(reference)
        return join(this.root, `${normalized.digest.slice(7)}.json`)
    }

    save(episode) {
        const normalized = validatedEpisode(episode)
        const serialized = stableJson(normalized)
        const digest = `sha256:${createHash("sha256").update(serialized).digest("hex")}`
        const reference = {
            schemaVersion: AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA,
            digest,
        }
        const path = this.pathFor(reference)
        mkdirSync(this.root, {recursive: true, mode: 0o700})
        chmodSync(this.root, 0o700)
        if (existsSync(path)) {
            if (readFileSync(path, "utf8") !== serialized) {
                throw new Error("Automatic capture evidence digest collided with different content")
            }
            return reference
        }
        const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
        try {
            writeFileSync(temporary, serialized, {encoding: "utf8", flag: "wx", mode: 0o600})
            chmodSync(temporary, 0o600)
            renameSync(temporary, path)
        } finally {
            if (existsSync(temporary)) unlinkSync(temporary)
        }
        return reference
    }

    read(reference) {
        const normalized = validatedReference(reference)
        const path = this.pathFor(normalized)
        if (!existsSync(path)) throw new Error("Automatic capture evidence snapshot is unavailable")
        const serialized = readFileSync(path, "utf8")
        const actual = `sha256:${createHash("sha256").update(serialized).digest("hex")}`
        if (actual !== normalized.digest) {
            throw new Error("Automatic capture evidence digest does not match the stored snapshot")
        }
        let episode
        try {
            episode = JSON.parse(serialized)
        } catch {
            throw new Error("Automatic capture evidence snapshot is invalid JSON")
        }
        return validatedEpisode(episode)
    }
}

module.exports = {
    AUTOMATIC_EVIDENCE_REFERENCE_SCHEMA,
    AutomaticCaptureEvidenceStore,
    validatedReference,
}
