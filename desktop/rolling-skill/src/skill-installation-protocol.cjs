const {isAbsolute, posix} = require("node:path")

const INSTALL_MARKER_SCHEMA = "rolling-skill-install/v1"
const INSTALL_RESULT_SCHEMA = "rolling-skill-install-result/v1"
const INSTALL_RESULT_SENTINEL = Object.freeze({
    open: "<rolling-skill-install-result>",
    close: "</rolling-skill-install-result>",
})

const STATUSES = new Set(["succeeded", "failed", "cancelled", "unverified"])
const OPERATIONS = new Set(["install", "update", "overwrite", "inspect"])
const CLASSIFICATIONS = new Set([
    "absent",
    "managed-clean",
    "managed-drifted",
    "unmanaged",
    "conflict",
    "uncertain",
])
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function nullableText(value, label, maxLength = 4_096) {
    if (value === null || value === undefined) return null
    return requiredText(value, label, maxLength)
}

function relativeSkillRoot(value) {
    const root = requiredText(value, "Skill root").replace(/\\/gu, "/")
    if (
        isAbsolute(root) ||
        (root !== "." && (
            posix.normalize(root) !== root ||
            root.split("/").some((segment) => !segment || segment === "." || segment === "..")
        ))
    ) throw new Error("Skill root must be repository-relative")
    return root
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function freezeSkillInstallationRequest(input = {}) {
    const repositoryId = requiredText(input.repository?.id, "Repository id", 200)
    const repositoryPath = requiredText(input.repository?.managedPath, "Managed repository path")
    if (!isAbsolute(repositoryPath)) throw new Error("Managed repository path must be absolute")
    const skillId = requiredText(input.skill?.id, "Skill id", 200)
    const skillName = requiredText(input.skill?.name, "Skill name", 200)
    const skillRoot = relativeSkillRoot(input.skill?.skillRoot)
    const versionId = requiredText(input.version?.id, "Version id", 200)
    if (input.version?.state !== "released") {
        throw new Error("Only a Released Skill version can be installed")
    }
    if (input.version?.repositoryId !== repositoryId || input.version?.skillId !== skillId) {
        throw new Error("Released version does not belong to the selected Skill")
    }
    const commit = requiredText(input.version?.commit, "Released commit", 40)
    if (!COMMIT_PATTERN.test(commit)) throw new Error("Released commit must be a full SHA-1")
    const expectedDigest = requiredText(input.version?.contentDigest, "Released content digest", 80)
    if (!DIGEST_PATTERN.test(expectedDigest)) {
        throw new Error("Released content digest must be SHA-256")
    }
    const versionLabel = requiredText(input.version?.versionLabel, "Released version label", 64)
    return deepFreeze({
        schema: "rolling-skill-install-request/v1",
        markerSchema: INSTALL_MARKER_SCHEMA,
        repositoryPath,
        skillName,
        versionLabel,
        source: {
            repositoryId,
            skillId,
            versionId,
            commit,
            skillRoot,
            expectedDigest,
        },
    })
}

function buildSkillInstallationPrompt(request, options = {}) {
    request = freezeSkillInstallationRequest({
        repository: {id: request.source.repositoryId, managedPath: request.repositoryPath},
        skill: {id: request.source.skillId, name: request.skillName, skillRoot: request.source.skillRoot},
        version: {
            id: request.source.versionId,
            repositoryId: request.source.repositoryId,
            skillId: request.source.skillId,
            state: "released",
            commit: request.source.commit,
            contentDigest: request.source.expectedDigest,
            versionLabel: request.versionLabel,
        },
    })
    const operation = OPERATIONS.has(options.operation) ? options.operation : "install"
    const requestedPermission = nullableText(
        options.requestedPermission,
        "Requested permission",
        100,
    )
    const priorInstallation = options.priorInstallation && typeof options.priorInstallation === "object"
        ? options.priorInstallation
        : null
    const finalShape = {
        schema: INSTALL_RESULT_SCHEMA,
        status: "succeeded | failed | cancelled | unverified",
        operation: "install | update | overwrite | inspect",
        classificationBefore:
            "absent | managed-clean | managed-drifted | unmanaged | conflict | uncertain",
        destination: "/absolute/path/reported/by/the/runtime",
        source: request.source,
        permission: {requested: requestedPermission, effective: null},
        result: {
            actualDigest: request.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: "true | false | null",
        },
        warnings: [],
        error: null,
    }
    return [
        "You are running a managed Skill installation task inside your own local Runtime.",
        "Perform every inspection and filesystem change yourself through Bash/tool calls. Do not ask the host application to copy, delete, or discover paths for you.",
        "Do not run scripts from the managed Skill. Do not install from the working tree or implicit HEAD.",
        "",
        "Frozen installation request (immutable):",
        JSON.stringify({
            operation,
            markerSchema: request.markerSchema,
            repositoryPath: request.repositoryPath,
            skillName: request.skillName,
            versionLabel: request.versionLabel,
            source: request.source,
            priorInstallation,
        }, null, 2),
        "",
        "Required procedure:",
        "1. Verify the repository and exact commit. Export only source.skillRoot from that commit into a temporary directory. Never copy the current working tree.",
        "2. Compute the deterministic Skill content SHA-256 digest, excluding .rolling-skill-managed.json, and require it to equal source.expectedDigest before touching a target.",
        "3. Discover the Skill root actually used by this Runtime and select only the exact target for skillName. Do not assume a provider-specific path supplied by this prompt.",
        "4. Inspect the target, its digest, symlinks, and .rolling-skill-managed.json. Classify the pre-state exactly as one of: absent, managed-clean, managed-drifted, unmanaged, conflict, uncertain.",
        "5. Only absent and managed-clean may continue without an additional overwrite confirmation. For managed-drifted, unmanaged, conflict, or uncertain, pause and ask the user through the Runtime interaction UI. Show the destination, evidence, and exact directory that would be changed. Offer Continue overwrite, I will install manually, and Cancel.",
        "6. Refuse a symlink target, a broad/dangerous destination, an identity boundary you cannot prove, or any operation that would delete outside the exact target, even if broad permission is available.",
        "7. If authorized, install/update the exact target and write .rolling-skill-managed.json with schema, repositoryId, skillId, versionId, commit, contentDigest, and installedAt. The marker is excluded from the content digest.",
        "8. Recompute the installed digest, then refresh or query this Runtime's own Skill inventory when supported. If inventory cannot prove discovery, report runtimeDiscovered as null, not true.",
        "9. If permission is insufficient, request it through the Runtime. Never elevate silently. If the user refuses, stop without pretending success.",
        "10. Finish with exactly one result block using the schema below. Natural-language progress may appear before it, but never emit a second result block.",
        "",
        INSTALL_RESULT_SENTINEL.open,
        JSON.stringify(finalShape, null, 2),
        INSTALL_RESULT_SENTINEL.close,
    ].join("\n")
}

function oneSentinelBody(text) {
    text = String(text ?? "")
    const firstOpen = text.indexOf(INSTALL_RESULT_SENTINEL.open)
    const secondOpen = text.indexOf(INSTALL_RESULT_SENTINEL.open, firstOpen + 1)
    const firstClose = text.indexOf(INSTALL_RESULT_SENTINEL.close)
    const secondClose = text.indexOf(INSTALL_RESULT_SENTINEL.close, firstClose + 1)
    if (firstOpen < 0 || firstClose < 0 || secondOpen >= 0 || secondClose >= 0 || firstClose < firstOpen) {
        throw new Error("Installation output must contain exactly one structured result block")
    }
    return text.slice(firstOpen + INSTALL_RESULT_SENTINEL.open.length, firstClose).trim()
}

function parseJsonBody(text) {
    try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object")
        return parsed
    } catch {
        throw new Error("Installation result must be valid JSON")
    }
}

function requireEnum(value, values, label) {
    const normalized = requiredText(value, label, 80)
    if (!values.has(normalized)) throw new Error(`Installation result ${label} is invalid`)
    return normalized
}

function validateSource(actual, expected) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
        throw new Error("Installation result source does not match the frozen source")
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
        if (actual[key] !== expectedValue) {
            throw new Error("Installation result source does not match the frozen source")
        }
    }
}

function normalizeError(value, required) {
    if (!required && (value === null || value === undefined)) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Installation result error is required")
    }
    return {
        code: requiredText(value.code, "Installation error code", 200),
        message: requiredText(value.message, "Installation error message", 8_192),
    }
}

function parseSkillInstallationResult(text, request) {
    const payload = parseJsonBody(oneSentinelBody(text))
    if (payload.schema !== INSTALL_RESULT_SCHEMA) {
        throw new Error("Unsupported Skill installation result schema")
    }
    const status = requireEnum(payload.status, STATUSES, "status")
    const operation = requireEnum(payload.operation, OPERATIONS, "operation")
    const classificationBefore = requireEnum(
        payload.classificationBefore,
        CLASSIFICATIONS,
        "classification",
    )
    validateSource(payload.source, request.source)
    const destination = nullableText(payload.destination, "Installation destination")
    if (destination && !isAbsolute(destination)) {
        throw new Error("Installation destination must be absolute")
    }
    if (status === "succeeded" && !destination) {
        throw new Error("Successful installation requires an absolute destination")
    }
    const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
        ? payload.result
        : {}
    const actualDigest = nullableText(result.actualDigest, "Actual installation digest", 80)
    if (actualDigest && !DIGEST_PATTERN.test(actualDigest)) {
        throw new Error("Actual installation digest is invalid")
    }
    const markerWritten = result.markerWritten === true
    const runtimeDiscovered = result.runtimeDiscovered === true
        ? true
        : result.runtimeDiscovered === false
          ? false
          : null
    if (status === "succeeded" && actualDigest !== request.source.expectedDigest) {
        throw new Error("Successful installation digest does not match the frozen digest")
    }
    if (status === "succeeded" && !markerWritten) {
        throw new Error("Successful installation must write the management marker")
    }
    const verification = runtimeDiscovered === true
        ? "runtime-inventory"
        : actualDigest === request.source.expectedDigest && markerWritten
          ? "filesystem-only"
          : "none"
    if (status === "succeeded" && verification === "none") {
        throw new Error("Successful installation has no reliable verification")
    }
    const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.map((warning) => requiredText(warning, "Installation warning", 4_096))
        : []
    const error = normalizeError(payload.error, status !== "succeeded")
    return deepFreeze({
        schema: INSTALL_RESULT_SCHEMA,
        status,
        operation,
        classificationBefore,
        destination,
        source: {...request.source},
        permission: {
            requested: nullableText(payload.permission?.requested, "Requested permission", 100),
            effective: nullableText(payload.permission?.effective, "Effective permission", 100),
        },
        result: {actualDigest, markerWritten, runtimeDiscovered},
        warnings,
        error,
        verification,
        trusted: status === "succeeded" && verification !== "none",
    })
}

module.exports = {
    INSTALL_MARKER_SCHEMA,
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
    buildSkillInstallationPrompt,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
}
