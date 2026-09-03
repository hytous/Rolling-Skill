const {randomUUID} = require("node:crypto")
const {
    constants,
    closeSync,
    fchmodSync,
    fstatSync,
    fsyncSync,
    linkSync,
    lstatSync,
    mkdirSync,
    openSync,
    readSync,
    realpathSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} = require("node:fs")
const {basename, dirname, join, resolve} = require("node:path")

const {
    canonicalOptimizationDigest,
    validateFrozenOptimizationRun,
} = require("./optimization-contract.cjs")

const OPTIMIZATION_STORE_SCHEMA = "rolling-skill-optimization-runs/v1"
const MAX_STORE_BYTES = 16 * 1024 * 1024
const MAX_RUNS = 10_000
const MAX_OPERATIONS = 10_000
const MAX_ARTIFACT_REFERENCES = 512
const MAX_CHECKPOINT_BYTES = 64 * 1024
const MAX_OWNERSHIP_BYTES = 4 * 1024
const OWNERSHIP_SCHEMA = "rolling-skill-optimization-owner/v1"
const TAKEOVER_SCHEMA = "rolling-skill-optimization-takeover/v1"
const NOFOLLOW = constants.O_NOFOLLOW ?? 0
const DIRECTORY = constants.O_DIRECTORY ?? 0
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"])
const ACTIVE_RESTART_STATES = new Set([
    "baseline",
    "editing",
    "installing",
    "evaluating",
    "deciding",
    "waiting_approval",
    "restoring",
])
const RUN_STATES = new Set([
    "preflight",
    "baseline",
    "editing",
    "installing",
    "evaluating",
    "deciding",
    "waiting_approval",
    "restoring",
    "succeeded",
    "failed",
    "cancelled",
    "needs_recovery",
])
const RUN_TRANSITIONS = new Map([
    ["preflight", new Set(["baseline", "failed", "cancelled", "needs_recovery"])],
    ["baseline", new Set(["editing", "failed", "cancelled", "needs_recovery"])],
    ["editing", new Set(["installing", "restoring", "failed", "cancelled", "needs_recovery"])],
    ["installing", new Set(["evaluating", "restoring", "succeeded", "failed", "cancelled", "needs_recovery"])],
    ["evaluating", new Set(["deciding", "restoring", "failed", "cancelled", "needs_recovery"])],
    ["deciding", new Set([
        "editing",
        "waiting_approval",
        "restoring",
        "succeeded",
        "failed",
        "cancelled",
        "needs_recovery",
    ])],
    ["waiting_approval", new Set([
        "editing",
        "installing",
        "restoring",
        "failed",
        "cancelled",
        "needs_recovery",
    ])],
    ["restoring", new Set(["succeeded", "failed", "cancelled", "needs_recovery"])],
    ["needs_recovery", new Set([
        "baseline",
        "editing",
        "installing",
        "evaluating",
        "deciding",
        "waiting_approval",
        "restoring",
        "failed",
        "cancelled",
    ])],
])
const EPOCH_STATES = new Set([
    "editing",
    "installing",
    "evaluating",
    "deciding",
    "completed",
    "succeeded",
    "failed",
    "cancelled",
])
const TERMINAL_EPOCH_STATES = new Set(["completed", "succeeded", "failed", "cancelled"])
const EPOCH_TRANSITIONS = new Map([
    ["editing", new Set(["installing", "failed", "cancelled"])],
    ["installing", new Set(["evaluating", "failed", "cancelled"])],
    ["evaluating", new Set(["deciding", "failed", "cancelled"])],
    ["deciding", new Set(["completed", "succeeded", "failed", "cancelled"])],
])
const IMMUTABLE_EPOCH_FIELDS = new Map([
    ["installing", ["candidateArtifactId"]],
    ["evaluating", ["candidateArtifactId", "installArtifactIds"]],
    ["deciding", ["candidateArtifactId", "installArtifactIds", "evaluationArtifactIds"]],
])
const EPOCH_EVIDENCE_FIELDS = [
    "candidateArtifactId",
    "installArtifactIds",
    "evaluationArtifactIds",
    "analysisArtifactId",
    "decisionArtifactId",
]
const OPERATION_KINDS = new Set(["transition", "create_epoch", "update_epoch"])
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"])

function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

function requireObject(value, label) {
    if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`)
    return value
}

function exactKeys(value, required, optional, label) {
    requireObject(value, label)
    const allowed = new Set([...required, ...optional])
    for (const key of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(key)) throw new Error(`${label} contains an unsafe field`)
        if (!allowed.has(key)) throw new Error(`${label} has unknown or missing fields (${key})`)
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) throw new Error(`${label} has unknown or missing fields (${key})`)
    }
    return value
}

function cloneJson(value, label = "Value", seen = new Set()) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return value
    if (typeof value === "number") {
        if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number`)
        return value
    }
    if (typeof value !== "object" || value === undefined) throw new Error(`${label} must be JSON`)
    if (seen.has(value)) throw new Error(`${label} is cyclic`)
    seen.add(value)
    let copy
    if (Array.isArray(value)) {
        const keys = Object.keys(value)
        if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
            throw new Error(`${label} must be a dense array`)
        }
        copy = value.map((entry) => cloneJson(entry, label, seen))
    } else {
        requireObject(value, label)
        copy = {}
        for (const key of Object.keys(value)) {
            if (DANGEROUS_KEYS.has(key)) throw new Error(`${label} contains an unsafe field`)
            copy[key] = cloneJson(value[key], label, seen)
        }
    }
    seen.delete(value)
    return copy
}

function requiredText(value, label, maxLength = 300) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized) throw new Error(`${label} is required`)
    if (normalized !== value) throw new Error(`${label} is not canonical`)
    if (normalized.length > maxLength) throw new Error(`${label} is too long`)
    if (/\u0000/u.test(normalized)) throw new Error(`${label} contains unsupported characters`)
    return normalized
}

function publicId(value, label) {
    const normalized = requiredText(value, label, 200)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(normalized)) {
        throw new Error(`${label} must be an opaque identifier, not a path`)
    }
    return normalized
}

function nullableText(value, label, maxLength = 300) {
    if (value === null) return null
    return requiredText(value, label, maxLength)
}

function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${label} is invalid`)
    }
    return value
}

function timestamp(value, label) {
    const normalized = requiredText(value, label, 100)
    if (!Number.isFinite(Date.parse(normalized)) || new Date(normalized).toISOString() !== normalized) {
        throw new Error(`${label} must be a canonical timestamp`)
    }
    return normalized
}

function nullableTimestamp(value, label) {
    return value === null ? null : timestamp(value, label)
}

function nowTimestamp() {
    return new Date().toISOString()
}

function encodedBytes(value, label) {
    try {
        return Buffer.byteLength(JSON.stringify(value))
    } catch {
        throw new Error(`${label} is invalid`)
    }
}

function boundedJson(value, label, maximum = MAX_CHECKPOINT_BYTES) {
    const copy = cloneJson(value, label)
    if (encodedBytes(copy, label) > maximum) throw new Error(`${label} exceeds its byte limit`)
    return copy
}

function artifactId(value, label) {
    return publicId(value, label)
}

function nullableArtifactId(value, label) {
    return value === null ? null : artifactId(value, label)
}

function artifactIds(value, label) {
    if (!Array.isArray(value) || value.length > MAX_ARTIFACT_REFERENCES) {
        throw new Error(`${label} must be a bounded array`)
    }
    const normalized = value.map((entry) => artifactId(entry, label))
    if (new Set(normalized).size !== normalized.length) {
        throw new Error(`${label} must contain unique references`)
    }
    return normalized
}

function epochEvidencePatchValue(field, value) {
    if (field === "candidateArtifactId") return nullableArtifactId(value, "Candidate artifact id")
    if (field === "installArtifactIds") return artifactIds(value, "Install artifact ids")
    if (field === "evaluationArtifactIds") return artifactIds(value, "Evaluation artifact ids")
    if (field === "analysisArtifactId") return nullableArtifactId(value, "Analysis artifact id")
    return nullableArtifactId(value, "Decision artifact id")
}

function sameJson(left, right) {
    return JSON.stringify(left) === JSON.stringify(right)
}

function extendsArtifactSequence(current, next) {
    return current.every((value, index) => next[index] === value)
}

function pathEntryExists(path) {
    try {
        lstatSync(path)
        return true
    } catch (error) {
        if (error?.code === "ENOENT") return false
        throw error
    }
}

function secureDirectory(path, {create = false} = {}) {
    const directory = resolve(path)
    if (create) mkdirSync(directory, {recursive: true, mode: 0o700})
    const status = lstatSync(directory)
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error("Private directory must be a regular directory, not a symbolic link")
    }
    if ((status.mode & 0o777) !== 0o700) {
        throw new Error("Private directory must use owner-only mode 0700")
    }
    return {path: directory, realPath: realpathSync(directory), status}
}

function secureFileMetadata(path, directory, maximumBytes, label) {
    const filePath = resolve(path)
    const parent = secureDirectory(directory)
    if (dirname(filePath) !== parent.path) throw new Error(`${label} path escapes its private directory`)
    const status = lstatSync(filePath)
    if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error(`${label} must be a regular file, not a symbolic link`)
    }
    if (status.nlink !== 1) throw new Error(`${label} must have a single link`)
    if ((status.mode & 0o777) !== 0o600) throw new Error(`${label} must use owner-only mode 0600`)
    if (status.size > maximumBytes) throw new Error(`${label} exceeds its byte limit`)
    const realPath = realpathSync(filePath)
    if (dirname(realPath) !== parent.realPath) throw new Error(`${label} real path escapes its private directory`)
    return {filePath, realPath, status}
}

function canonicalStorePath(value) {
    const requestedPath = resolve(requiredText(value, "Optimization store path", 8_192))
    const requestedDirectory = dirname(requestedPath)
    const parent = secureDirectory(requestedDirectory, {create: true})
    if (!pathEntryExists(requestedPath)) return join(parent.realPath, basename(requestedPath))
    return secureFileMetadata(
        requestedPath,
        requestedDirectory,
        MAX_STORE_BYTES,
        "Optimization store",
    ).realPath
}

function readSecureFileRecord(path, directory, maximumBytes, label) {
    const before = secureFileMetadata(path, directory, maximumBytes, label)
    const descriptor = openSync(before.filePath, constants.O_RDONLY | NOFOLLOW)
    try {
        const opened = fstatSync(descriptor)
        if (!opened.isFile() || opened.dev !== before.status.dev || opened.ino !== before.status.ino) {
            throw new Error(`${label} changed while it was being opened`)
        }
        if (opened.nlink !== 1) throw new Error(`${label} must have a single link`)
        if ((opened.mode & 0o777) !== 0o600) throw new Error(`${label} must use owner-only mode 0600`)
        if (opened.size > maximumBytes) throw new Error(`${label} exceeds its byte limit`)
        const body = Buffer.alloc(opened.size)
        let offset = 0
        while (offset < body.byteLength) {
            const count = readSync(descriptor, body, offset, body.byteLength - offset, offset)
            if (count === 0) throw new Error(`${label} changed while it was being read`)
            offset += count
        }
        const extra = Buffer.alloc(1)
        if (readSync(descriptor, extra, 0, 1, offset) !== 0) {
            throw new Error(`${label} grew while it was being read`)
        }
        return {
            body,
            identity: {dev: String(opened.dev), ino: String(opened.ino)},
        }
    } finally {
        closeSync(descriptor)
    }
}

function readSecureFile(path, directory, maximumBytes, label) {
    return readSecureFileRecord(path, directory, maximumBytes, label).body
}

function fsyncDirectoryBestEffort(path) {
    let descriptor = null
    try {
        descriptor = openSync(path, constants.O_RDONLY | DIRECTORY | NOFOLLOW)
        if (fstatSync(descriptor).isDirectory()) fsyncSync(descriptor)
    } catch {
        // The atomic rename has committed even on filesystems that reject directory fsync.
    } finally {
        if (descriptor !== null) {
            try {
                closeSync(descriptor)
            } catch {}
        }
    }
}

function writePrivateFile(path, body) {
    const filePath = resolve(path)
    const directory = dirname(filePath)
    secureDirectory(directory, {create: true})
    if (pathEntryExists(filePath)) {
        secureFileMetadata(filePath, directory, Number.MAX_SAFE_INTEGER, "Optimization store")
    }
    const temporaryPath = join(directory, `.${basename(filePath)}.tmp-${process.pid}-${randomUUID()}`)
    const descriptor = openSync(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
        0o600,
    )
    let renamed = false
    try {
        try {
            const status = fstatSync(descriptor)
            if (!status.isFile()) throw new Error("Atomic temporary path is not a regular file")
            fchmodSync(descriptor, 0o600)
            writeFileSync(descriptor, body)
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        secureFileMetadata(temporaryPath, directory, Number.MAX_SAFE_INTEGER, "Atomic temporary file")
        secureDirectory(directory)
        renameSync(temporaryPath, filePath)
        renamed = true
        fsyncDirectoryBestEffort(directory)
    } catch (error) {
        if (!renamed) {
            try {
                unlinkSync(temporaryPath)
            } catch {}
        }
        throw error
    }
}

function processIsAlive(pid) {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        if (error?.code === "ESRCH") return false
        return true
    }
}

function ownershipPath(path) {
    return join(dirname(path), `.${basename(path)}.owner`)
}

function readOwnership(path) {
    const record = readSecureFileRecord(
        path,
        dirname(path),
        MAX_OWNERSHIP_BYTES,
        "Optimization ownership lock",
    )
    const value = JSON.parse(record.body.toString("utf8"))
    exactKeys(value, ["schemaVersion", "pid", "token"], [], "Optimization ownership lock")
    if (value.schemaVersion !== OWNERSHIP_SCHEMA) throw new Error("Optimization ownership lock schema is invalid")
    return {
        schemaVersion: OWNERSHIP_SCHEMA,
        pid: integer(value.pid, "Optimization ownership pid", 1),
        token: publicId(value.token, "Optimization ownership token"),
        ...record.identity,
    }
}

function takeoverPath(path) {
    return `${path}.takeover`
}

function sameFileIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino
}

function sameControlIdentity(left, right) {
    return left.token === right.token && sameFileIdentity(left, right)
}

function readControlFileIdentity(path) {
    const {status} = secureFileMetadata(
        path,
        dirname(path),
        MAX_OWNERSHIP_BYTES,
        "Optimization control file",
    )
    return {dev: String(status.dev), ino: String(status.ino)}
}

function createControlFile(path, value) {
    const body = `${JSON.stringify(value)}\n`
    const descriptor = openSync(
        path,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | NOFOLLOW,
        0o600,
    )
    let identity = null
    let failure = null
    try {
        const status = fstatSync(descriptor)
        identity = {dev: String(status.dev), ino: String(status.ino)}
        fchmodSync(descriptor, 0o600)
        writeFileSync(descriptor, body)
        fsyncSync(descriptor)
    } catch (error) {
        failure = error
    } finally {
        closeSync(descriptor)
    }
    if (failure !== null) {
        if (identity !== null) {
            try {
                verifiedUnlink(
                    path,
                    identity,
                    readControlFileIdentity,
                    "Incomplete Optimization control file",
                    sameFileIdentity,
                )
            } catch {}
        }
        throw failure
    }
    fsyncDirectoryBestEffort(dirname(path))
    return {...value, path, ...identity}
}

function readTakeover(path) {
    const record = readSecureFileRecord(
        path,
        dirname(path),
        MAX_OWNERSHIP_BYTES,
        "Optimization takeover claim",
    )
    const value = JSON.parse(record.body.toString("utf8"))
    exactKeys(
        value,
        ["schemaVersion", "pid", "token", "ownerToken", "ownerDev", "ownerIno"],
        [],
        "Optimization takeover claim",
    )
    if (value.schemaVersion !== TAKEOVER_SCHEMA) throw new Error("Optimization takeover claim schema is invalid")
    for (const field of ["ownerDev", "ownerIno"]) {
        if (!/^\d+$/u.test(requiredText(value[field], `Optimization takeover ${field}`, 100))) {
            throw new Error(`Optimization takeover ${field} is invalid`)
        }
    }
    return {
        schemaVersion: TAKEOVER_SCHEMA,
        pid: integer(value.pid, "Optimization takeover pid", 1),
        token: publicId(value.token, "Optimization takeover token"),
        ownerToken: publicId(value.ownerToken, "Optimization takeover owner token"),
        ownerDev: value.ownerDev,
        ownerIno: value.ownerIno,
        ...record.identity,
    }
}

function createTakeover(path, owner) {
    const token = randomUUID()
    return createControlFile(path, {
        schemaVersion: TAKEOVER_SCHEMA,
        pid: process.pid,
        token,
        ownerToken: owner.token,
        ownerDev: owner.dev,
        ownerIno: owner.ino,
    })
}

function restoreRetiredControlFile(path, retiredPath, label) {
    try {
        linkSync(retiredPath, path)
    } catch (error) {
        if (error?.code !== "EEXIST") {
            throw new Error(`${label} could not be restored: ${error.message}`)
        }
    }
    unlinkSync(retiredPath)
    fsyncDirectoryBestEffort(dirname(path))
}

function verifiedUnlink(path, expected, reader, label, sameIdentity = sameControlIdentity) {
    const retiredPath = `${path}.retired-${process.pid}-${randomUUID()}`
    try {
        renameSync(path, retiredPath)
    } catch (error) {
        if (error?.code === "ENOENT") return false
        throw error
    }
    let retired
    try {
        retired = reader(retiredPath)
    } catch (error) {
        try {
            restoreRetiredControlFile(path, retiredPath, label)
        } catch (restoreError) {
            throw new Error(`${label} verification failed and ${restoreError.message}`, {cause: error})
        }
        throw error
    }
    if (!sameIdentity(retired, expected)) {
        restoreRetiredControlFile(path, retiredPath, label)
        return false
    }
    unlinkSync(retiredPath)
    fsyncDirectoryBestEffort(dirname(path))
    return true
}

function ownershipBlockedError() {
    const error = new Error("Optimization ownership creation is blocked by a takeover claim")
    error.code = "EOWNERSHIPCLAIM"
    return error
}

function createOwnership(path, takeover = null) {
    const claimPath = takeoverPath(path)
    if (takeover === null && pathEntryExists(claimPath)) throw ownershipBlockedError()
    if (takeover !== null) {
        const currentClaim = readTakeover(claimPath)
        if (!sameControlIdentity(currentClaim, takeover)) {
            throw new Error("Optimization takeover claim changed before ownership creation")
        }
    }
    const token = randomUUID()
    const ownership = createControlFile(path, {
        schemaVersion: OWNERSHIP_SCHEMA,
        pid: process.pid,
        token,
    })
    try {
        if (takeover === null && pathEntryExists(claimPath)) {
            throw ownershipBlockedError()
        }
        if (takeover !== null) {
            const currentClaim = readTakeover(claimPath)
            if (!sameControlIdentity(currentClaim, takeover)) {
                throw new Error("Optimization takeover claim changed during ownership creation")
            }
        }
    } catch (error) {
        verifiedUnlink(path, ownership, readOwnership, "Optimization unclaimed ownership")
        throw error
    }
    return ownership
}

function releaseOwnership(ownership) {
    if (!ownership) return
    try {
        verifiedUnlink(
            ownership.path,
            ownership,
            readOwnership,
            "Optimization ownership lock",
        )
    } catch {}
}

function releaseTakeover(path, takeover) {
    return verifiedUnlink(path, takeover, readTakeover, "Optimization takeover claim")
}

function verifyOwnership(ownership) {
    let current
    try {
        current = readOwnership(ownership.path)
    } catch (error) {
        throw new Error(`Could not verify Optimization store ownership: ${error.message}`)
    }
    if (current.pid !== process.pid || !sameControlIdentity(current, ownership)) {
        throw new Error("Optimization store ownership was lost")
    }
}

function acquireOwnership(storePath) {
    const path = ownershipPath(storePath)
    const claimPath = takeoverPath(path)
    for (let attempt = 0; attempt < 12; attempt += 1) {
        try {
            return createOwnership(path)
        } catch (error) {
            if (!["EEXIST", "EOWNERSHIPCLAIM"].includes(error?.code)) throw error
        }
        if (pathEntryExists(claimPath)) {
            const claim = readTakeover(claimPath)
            if (processIsAlive(claim.pid)) {
                throw new Error(`Optimization ownership takeover is held by live process ${claim.pid}`)
            }
            verifiedUnlink(claimPath, claim, readTakeover, "Stale Optimization takeover claim")
            continue
        }
        let owner
        try {
            owner = readOwnership(path)
        } catch (error) {
            if (error?.code === "ENOENT") continue
            throw new Error(`Could not verify Optimization store owner: ${error.message}`)
        }
        if (owner.pid !== process.pid && processIsAlive(owner.pid)) {
            throw new Error(`Optimization store is owned by live process ${owner.pid}`)
        }
        let takeover
        try {
            takeover = createTakeover(claimPath, owner)
        } catch (error) {
            if (error?.code !== "EEXIST") throw error
            const claim = readTakeover(claimPath)
            if (processIsAlive(claim.pid)) {
                throw new Error(`Optimization ownership takeover is held by live process ${claim.pid}`)
            }
            verifiedUnlink(claimPath, claim, readTakeover, "Stale Optimization takeover claim")
            continue
        }
        let currentOwner = null
        try {
            currentOwner = readOwnership(path)
        } catch (error) {
            if (error?.code !== "ENOENT") {
                releaseTakeover(claimPath, takeover)
                throw error
            }
        }
        if (currentOwner !== null && !sameControlIdentity(currentOwner, owner)) {
            releaseTakeover(claimPath, takeover)
            if (currentOwner.pid !== process.pid && processIsAlive(currentOwner.pid)) {
                throw new Error(`Optimization store is owned by live process ${currentOwner.pid}`)
            }
            continue
        }
        if (currentOwner !== null && !verifiedUnlink(
            path,
            owner,
            readOwnership,
            "Stale Optimization ownership lock",
        )) {
            releaseTakeover(claimPath, takeover)
            continue
        }
        let ownership
        try {
            ownership = createOwnership(path, takeover)
        } catch (error) {
            releaseTakeover(claimPath, takeover)
            if (["EEXIST", "EOWNERSHIPCLAIM"].includes(error?.code)) continue
            throw error
        }
        if (!releaseTakeover(claimPath, takeover)) {
            releaseOwnership(ownership)
            throw new Error("Optimization takeover claim changed before release")
        }
        verifyOwnership(ownership)
        return ownership
    }
    throw new Error("Could not acquire Optimization store ownership")
}

function initialState() {
    return {
        schemaVersion: OPTIMIZATION_STORE_SCHEMA,
        generation: randomUUID(),
        revision: 0,
        runs: [],
        creationKeys: [],
    }
}

function canonicalEpoch(value) {
    exactKeys(value, [
        "id",
        "number",
        "status",
        "candidateArtifactId",
        "installArtifactIds",
        "evaluationArtifactIds",
        "analysisArtifactId",
        "decisionArtifactId",
        "createdAt",
        "updatedAt",
        "completedAt",
    ], [], "Optimization epoch")
    const status = requiredText(value.status, "Optimization epoch status", 40)
    if (!EPOCH_STATES.has(status)) throw new Error("Optimization epoch status is invalid")
    const epoch = {
        id: publicId(value.id, "Optimization epoch id"),
        number: integer(value.number, "Optimization epoch number", 1, 100),
        status,
        candidateArtifactId: nullableArtifactId(value.candidateArtifactId, "Candidate artifact id"),
        installArtifactIds: artifactIds(value.installArtifactIds, "Install artifact ids"),
        evaluationArtifactIds: artifactIds(value.evaluationArtifactIds, "Evaluation artifact ids"),
        analysisArtifactId: nullableArtifactId(value.analysisArtifactId, "Analysis artifact id"),
        decisionArtifactId: nullableArtifactId(value.decisionArtifactId, "Decision artifact id"),
        createdAt: timestamp(value.createdAt, "Optimization epoch createdAt"),
        updatedAt: timestamp(value.updatedAt, "Optimization epoch updatedAt"),
        completedAt: nullableTimestamp(value.completedAt, "Optimization epoch completedAt"),
    }
    if (TERMINAL_EPOCH_STATES.has(status) !== (epoch.completedAt !== null)) {
        throw new Error("Optimization epoch terminal fields are inconsistent")
    }
    if (["completed", "succeeded"].includes(status) && (
        epoch.candidateArtifactId === null ||
        epoch.installArtifactIds.length === 0 ||
        epoch.evaluationArtifactIds.length === 0 ||
        epoch.analysisArtifactId === null ||
        epoch.decisionArtifactId === null
    )) {
        throw new Error("A completed Optimization epoch requires Candidate, install, evaluation, analysis, and decision artifact references")
    }
    return epoch
}

function canonicalRunMutationResult(value) {
    exactKeys(
        value,
        ["runId", "state", "revision", "updatedAt"],
        [],
        "Optimization run mutation result",
    )
    const state = requiredText(value.state, "Optimization run mutation result state", 40)
    if (!RUN_STATES.has(state)) throw new Error("Optimization run mutation result state is invalid")
    return {
        runId: publicId(value.runId, "Optimization run mutation result run id"),
        state,
        revision: integer(value.revision, "Optimization run mutation result revision"),
        updatedAt: timestamp(value.updatedAt, "Optimization run mutation result updatedAt"),
    }
}

function canonicalEpochMutationResult(value) {
    exactKeys(
        value,
        ["runId", "epochId", "index", "status", "revision", "updatedAt"],
        [],
        "Optimization Epoch mutation result",
    )
    const status = requiredText(value.status, "Optimization Epoch mutation result status", 40)
    if (!EPOCH_STATES.has(status)) throw new Error("Optimization Epoch mutation result status is invalid")
    return {
        runId: publicId(value.runId, "Optimization Epoch mutation result run id"),
        epochId: publicId(value.epochId, "Optimization Epoch mutation result Epoch id"),
        index: integer(value.index, "Optimization Epoch mutation result index", 1, 100),
        status,
        revision: integer(value.revision, "Optimization Epoch mutation result revision"),
        updatedAt: timestamp(value.updatedAt, "Optimization Epoch mutation result updatedAt"),
    }
}

function canonicalOperation(value) {
    exactKeys(value, ["key", "kind", "inputDigest", "result"], [], "Optimization operation")
    const inputDigest = requiredText(value.inputDigest, "Optimization operation input digest", 80)
    if (!/^sha256:[a-f0-9]{64}$/u.test(inputDigest)) {
        throw new Error("Optimization operation input digest is invalid")
    }
    const kind = requiredText(value.kind, "Optimization operation kind", 100)
    if (!OPERATION_KINDS.has(kind)) throw new Error("Optimization operation kind is invalid")
    return {
        key: requiredText(value.key, "Optimization idempotency key", 500),
        kind,
        inputDigest,
        result: kind === "transition"
            ? canonicalRunMutationResult(value.result)
            : canonicalEpochMutationResult(value.result),
    }
}

function canonicalRecovery(value) {
    if (value === null) return null
    exactKeys(
        value,
        ["previousState", "reason", "recoveredAt"],
        [],
        "Optimization recovery metadata",
    )
    const previousState = requiredText(value.previousState, "Optimization recovery previous state", 40)
    if (!ACTIVE_RESTART_STATES.has(previousState)) {
        throw new Error("Optimization recovery previous state is invalid")
    }
    const reason = requiredText(value.reason, "Optimization recovery reason", 100)
    if (reason !== "process_interrupted") throw new Error("Optimization recovery reason is invalid")
    return {
        previousState,
        reason,
        recoveredAt: timestamp(value.recoveredAt, "Optimization recovery time"),
    }
}

function canonicalRun(value) {
    exactKeys(value, [
        "id",
        "state",
        "revision",
        "snapshot",
        "epochs",
        "currentEpoch",
        "checkpoint",
        "recovery",
        "error",
        "operations",
        "createdAt",
        "updatedAt",
        "completedAt",
    ], [], "Optimization run")
    const state = requiredText(value.state, "Optimization run state", 40)
    if (!RUN_STATES.has(state)) throw new Error("Optimization run state is invalid")
    if (!Array.isArray(value.epochs) || value.epochs.length > 100) {
        throw new Error("Optimization run epochs exceed their limit")
    }
    if (!Array.isArray(value.operations) || value.operations.length > MAX_OPERATIONS) {
        throw new Error("Optimization run operations exceed their limit")
    }
    const snapshot = validateFrozenOptimizationRun(value.snapshot)
    const epochs = value.epochs.map(canonicalEpoch)
    const operations = value.operations.map(canonicalOperation)
    const checkpoint = boundedJson(
        requireObject(value.checkpoint, "Optimization checkpoint"),
        "Optimization checkpoint",
    )
    if (new Set(epochs.map((entry) => entry.id)).size !== epochs.length) {
        throw new Error("Optimization epoch ids must be unique")
    }
    epochs.forEach((epoch, index) => {
        if (epoch.number !== index + 1) throw new Error("Optimization epoch sequence is invalid")
    })
    const effectiveMaxEpochs = Number.isSafeInteger(checkpoint?.approvedLimits?.maxEpochs)
        ? checkpoint.approvedLimits.maxEpochs
        : snapshot.limits.maxEpochs
    if (effectiveMaxEpochs < snapshot.limits.maxEpochs || effectiveMaxEpochs > 100) {
        throw new Error("Optimization approved epoch limit is invalid")
    }
    if (epochs.length > effectiveMaxEpochs) {
        throw new Error("Optimization run exceeds its frozen epoch limit")
    }
    if (new Set(operations.map((entry) => entry.key)).size !== operations.length) {
        throw new Error("Optimization run idempotency keys must be unique")
    }
    const run = {
        id: publicId(value.id, "Optimization run id"),
        state,
        revision: integer(value.revision, "Optimization run revision"),
        snapshot: cloneJson(snapshot),
        epochs,
        currentEpoch: integer(value.currentEpoch, "Optimization current epoch", 0, epochs.length),
        checkpoint,
        recovery: canonicalRecovery(value.recovery),
        error: value.error === null ? null : boundedJson(value.error, "Optimization error", 32 * 1024),
        operations,
        createdAt: timestamp(value.createdAt, "Optimization run createdAt"),
        updatedAt: timestamp(value.updatedAt, "Optimization run updatedAt"),
        completedAt: nullableTimestamp(value.completedAt, "Optimization run completedAt"),
    }
    if (run.currentEpoch !== epochs.length) throw new Error("Optimization current epoch is inconsistent")
    if (TERMINAL_STATES.has(run.state) !== (run.completedAt !== null)) {
        throw new Error("Optimization run terminal fields are inconsistent")
    }
    const currentEpoch = epochs.at(-1) ?? null
    if (TERMINAL_STATES.has(run.state) && epochs.some((epoch) => !TERMINAL_EPOCH_STATES.has(epoch.status))) {
        throw new Error("A terminal Optimization run cannot contain a nonterminal Epoch")
    }
    if (["editing", "installing", "evaluating", "deciding"].includes(run.state)) {
        const releaseFinalRegression =
            run.state === "evaluating" &&
            run.checkpoint.releasePhase === "final-regression" &&
            currentEpoch?.status === "deciding"
        if (
            currentEpoch !== null &&
            !TERMINAL_EPOCH_STATES.has(currentEpoch.status) &&
            currentEpoch.status !== run.state &&
            !(run.state === "installing" && currentEpoch.status === "deciding") &&
            !releaseFinalRegression
        ) {
            throw new Error("Optimization Run phase does not match its current Epoch")
        }
        if (["installing", "evaluating", "deciding"].includes(run.state) && currentEpoch === null) {
            throw new Error(`Optimization Run phase ${run.state} requires a current Epoch`)
        }
    }
    if (run.state === "waiting_approval" && (
        currentEpoch === null ||
        (!TERMINAL_EPOCH_STATES.has(currentEpoch.status) && currentEpoch.status !== "deciding")
    )) {
        throw new Error("Optimization approval requires a deciding current Epoch")
    }
    if (["installing", "evaluating", "deciding", "waiting_approval"].includes(run.state)) {
        if (currentEpoch.candidateArtifactId === null) {
            throw new Error("Optimization installing phase requires a Candidate artifact")
        }
    }
    if (["evaluating", "deciding", "waiting_approval"].includes(run.state)) {
        if (currentEpoch.installArtifactIds.length === 0) {
            throw new Error("Optimization evaluating phase requires an install artifact")
        }
    }
    if (["deciding", "waiting_approval"].includes(run.state)) {
        if (currentEpoch.evaluationArtifactIds.length === 0) {
            throw new Error("Optimization deciding phase requires an evaluation artifact")
        }
    }
    if (
        run.state === "waiting_approval" ||
        (run.state === "installing" && currentEpoch?.status === "deciding")
    ) {
        if (currentEpoch.analysisArtifactId === null || currentEpoch.decisionArtifactId === null) {
            throw new Error("Optimization approval requires analysis and decision artifacts")
        }
    }
    for (const operation of run.operations) {
        if (operation.result.runId !== run.id) {
            throw new Error("Optimization operation result reference is inconsistent")
        }
        if (operation.result.revision > run.revision) {
            throw new Error("Optimization operation result revision is in the future")
        }
        if (operation.result.updatedAt > run.updatedAt) {
            throw new Error("Optimization operation result timestamp is in the future")
        }
        if (operation.kind !== "transition") {
            const epoch = epochs[operation.result.index - 1]
            if (!epoch || epoch.id !== operation.result.epochId) {
                throw new Error("Optimization operation result references an inconsistent Epoch")
            }
        }
    }
    return run
}

function canonicalCreationKey(value) {
    exactKeys(value, ["key", "inputDigest", "result"], [], "Optimization creation idempotency record")
    const inputDigest = requiredText(value.inputDigest, "Optimization creation input digest", 80)
    if (!/^sha256:[a-f0-9]{64}$/u.test(inputDigest)) {
        throw new Error("Optimization creation input digest is invalid")
    }
    return {
        key: requiredText(value.key, "Optimization creation idempotency key", 500),
        inputDigest,
        result: canonicalRunMutationResult(value.result),
    }
}

function canonicalState(value) {
    requireObject(value, "Optimization store")
    if (value.schemaVersion !== OPTIMIZATION_STORE_SCHEMA) {
        throw new Error(`Unsupported Optimization store schema: ${value.schemaVersion}`)
    }
    exactKeys(
        value,
        ["schemaVersion", "generation", "revision", "runs", "creationKeys"],
        [],
        "Optimization store",
    )
    if (!Array.isArray(value.runs) || value.runs.length > MAX_RUNS) {
        throw new Error("Optimization store run count is invalid")
    }
    if (!Array.isArray(value.creationKeys) || value.creationKeys.length > MAX_RUNS) {
        throw new Error("Optimization store creation-key count is invalid")
    }
    const state = {
        schemaVersion: OPTIMIZATION_STORE_SCHEMA,
        generation: publicId(value.generation, "Optimization store generation"),
        revision: integer(value.revision, "Optimization store revision"),
        runs: value.runs.map(canonicalRun),
        creationKeys: value.creationKeys.map(canonicalCreationKey),
    }
    if (new Set(state.runs.map((entry) => entry.id)).size !== state.runs.length) {
        throw new Error("Optimization run ids must be unique")
    }
    if (new Set(state.creationKeys.map((entry) => entry.key)).size !== state.creationKeys.length) {
        throw new Error("Optimization creation idempotency keys must be unique")
    }
    const runs = new Map(state.runs.map((entry) => [entry.id, entry]))
    for (const creation of state.creationKeys) {
        const run = runs.get(creation.result.runId)
        if (!run) throw new Error("Optimization creation key references an unknown run")
        if (
            creation.result.state !== "preflight" ||
            creation.result.revision !== 0 ||
            creation.result.updatedAt !== run.createdAt
        ) {
            throw new Error("Optimization creation result is inconsistent with Run creation")
        }
    }
    return state
}

function copyRun(run) {
    return cloneJson(run)
}

function operationOptions(patch, options) {
    const normalizedPatch = cloneJson(patch, "Optimization mutation patch")
    const normalizedOptions = cloneJson(options, "Optimization mutation options")
    exactKeys(normalizedOptions, [], ["expectedRevision", "idempotencyKey"], "Optimization mutation options")
    return {patch: normalizedPatch, options: normalizedOptions}
}

function publicRunSummary(run) {
    const refs = {
        candidates: [],
        installations: [],
        evaluations: [],
        analyses: [],
        decisions: [],
    }
    for (const epoch of run.epochs) {
        if (epoch.candidateArtifactId !== null) refs.candidates.push(epoch.candidateArtifactId)
        refs.installations.push(...epoch.installArtifactIds)
        refs.evaluations.push(...epoch.evaluationArtifactIds)
        if (epoch.analysisArtifactId !== null) refs.analyses.push(epoch.analysisArtifactId)
        if (epoch.decisionArtifactId !== null) refs.decisions.push(epoch.decisionArtifactId)
    }
    for (const values of Object.values(refs)) {
        const unique = [...new Set(values)]
        values.splice(0, values.length, ...unique)
    }
    return {
        id: run.id,
        state: run.state,
        revision: run.revision,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt,
        currentEpoch: run.currentEpoch,
        skillId: run.snapshot.baseline.skillId,
        datasetId: run.snapshot.dataset.id,
        counts: {
            epochs: run.epochs.length,
            terminalEpochs: run.epochs.filter((entry) => TERMINAL_EPOCH_STATES.has(entry.status)).length,
        },
        artifactRefs: refs,
    }
}

const PATH_BACKENDS = new Map()
const PATH_BACKEND_FINALIZER = new FinalizationRegistry(({path, reference, ownership}) => {
    if (PATH_BACKENDS.get(path) === reference) PATH_BACKENDS.delete(path)
    releaseOwnership(ownership)
})

function acquirePathBackend(path) {
    const existingReference = PATH_BACKENDS.get(path)
    let backend = existingReference?.deref()
    if (!backend) {
        const ownership = acquireOwnership(path)
        backend = {
            state: null,
            coordinationKey: Object.freeze({}),
            ownership,
            references: 0,
            finalizerToken: {},
        }
        const reference = new WeakRef(backend)
        PATH_BACKENDS.set(path, reference)
        PATH_BACKEND_FINALIZER.register(
            backend,
            {path, reference, ownership},
            backend.finalizerToken,
        )
    }
    backend.references += 1
    return backend
}

function releasePathBackend(path, backend) {
    backend.references -= 1
    if (backend.references !== 0) return
    const reference = PATH_BACKENDS.get(path)
    if (reference?.deref() === backend) PATH_BACKENDS.delete(path)
    PATH_BACKEND_FINALIZER.unregister(backend.finalizerToken)
    releaseOwnership(backend.ownership)
}

class OptimizationStore {
    #path
    #backend

    get #state() {
        if (this.#backend === null) throw new Error("Optimization store is closed")
        return this.#backend.state
    }

    set #state(value) {
        if (this.#backend === null) throw new Error("Optimization store is closed")
        this.#backend.state = value
    }

    get #storeRevision() {
        return this.#state.revision
    }

    constructor(path) {
        this.#path = canonicalStorePath(path)
        this.#backend = acquirePathBackend(this.#path)
        try {
            if (this.#state === null) this.load()
        } catch (error) {
            releasePathBackend(this.#path, this.#backend)
            this.#backend = null
            throw error
        }
    }

    get path() {
        return this.#path
    }

    get revision() {
        this.#requireOpen()
        return this.#storeRevision
    }

    get generation() {
        this.#requireOpen()
        return this.#state.generation
    }

    get coordinationKey() {
        this.#requireOpen()
        return this.#backend.coordinationKey
    }

    #requireOpen() {
        if (this.#backend === null) throw new Error("Optimization store is closed")
    }

    close() {
        if (this.#backend === null) return
        const backend = this.#backend
        this.#backend = null
        releasePathBackend(this.#path, backend)
    }

    load() {
        this.#requireOpen()
        if (!pathEntryExists(this.#path)) {
            this.#state = canonicalState(initialState())
            this.persist()
            return this.read()
        }
        try {
            const body = readSecureFile(
                this.#path,
                dirname(this.#path),
                MAX_STORE_BYTES,
                "Optimization store",
            )
            this.#state = canonicalState(JSON.parse(body.toString("utf8")))
        } catch (error) {
            throw new Error(`Could not read Optimization store: ${error.message}`)
        }
        this.#normalizeInterruptedRuns()
        return this.read()
    }

    persist() {
        this.#requireOpen()
        verifyOwnership(this.#backend.ownership)
        this.#state = canonicalState(this.#state)
        const encoded = `${JSON.stringify(this.#state, null, 2)}\n`
        if (Buffer.byteLength(encoded) > MAX_STORE_BYTES) {
            throw new Error("Optimization store exceeds its byte limit")
        }
        writePrivateFile(this.#path, encoded)
    }

    #mutate(callback) {
        this.#requireOpen()
        const previous = this.#state
        this.#state = cloneJson(previous)
        try {
            const result = callback(this.#state)
            this.#state.revision += 1
            this.#state = canonicalState(this.#state)
            this.persist()
            return cloneJson(result)
        } catch (error) {
            this.#state = previous
            throw error
        }
    }

    #requireRun(runId, state = this.#state) {
        const id = publicId(runId, "Optimization run id")
        const run = state.runs.find((entry) => entry.id === id)
        if (!run) throw new Error("Unknown Optimization run")
        return run
    }

    #checkRevision(run, expectedRevision) {
        if (expectedRevision === undefined || expectedRevision === null) return
        integer(expectedRevision, "Expected Optimization run revision")
        if (run.revision !== expectedRevision) {
            throw new Error("Optimization run revision changed; CAS rejected the mutation")
        }
    }

    #existingOperation(run, key, kind, inputDigest) {
        if (key === undefined || key === null) return null
        const normalizedKey = requiredText(key, "Optimization idempotency key", 500)
        const existing = run.operations.find((entry) => entry.key === normalizedKey)
        if (!existing) return null
        if (existing.kind !== kind || existing.inputDigest !== inputDigest) {
            throw new Error("Optimization idempotency key was already used for different input")
        }
        return existing
    }

    #recordOperation(run, key, kind, inputDigest, epoch = null) {
        const result = epoch === null
            ? canonicalRunMutationResult({
                runId: run.id,
                state: run.state,
                revision: run.revision,
                updatedAt: run.updatedAt,
            })
            : canonicalEpochMutationResult({
                runId: run.id,
                epochId: epoch.id,
                index: epoch.number,
                status: epoch.status,
                revision: run.revision,
                updatedAt: run.updatedAt,
            })
        if (key !== undefined && key !== null) {
            if (run.operations.length >= MAX_OPERATIONS) {
                throw new Error("Optimization run reached its idempotency operation limit")
            }
            run.operations.push({
                key: requiredText(key, "Optimization idempotency key", 500),
                kind,
                inputDigest,
                result,
            })
        }
        return result
    }

    read() {
        this.#requireOpen()
        return cloneJson(this.#state)
    }

    createRun(snapshot, options = {}) {
        this.#requireOpen()
        const frozen = validateFrozenOptimizationRun(snapshot)
        const normalizedOptions = cloneJson(options, "Optimization create options")
        exactKeys(
            normalizedOptions,
            [],
            ["id", "idempotencyKey", "expectedRevision"],
            "Optimization create options",
        )
        if (normalizedOptions.expectedRevision !== undefined) {
            integer(normalizedOptions.expectedRevision, "Expected Optimization store revision")
            if (normalizedOptions.expectedRevision !== this.#storeRevision) {
                throw new Error("Optimization store revision changed; CAS rejected run creation")
            }
        }
        const inputDigest = canonicalOptimizationDigest(frozen)
        if (normalizedOptions.idempotencyKey !== undefined) {
            const key = requiredText(normalizedOptions.idempotencyKey, "Optimization creation idempotency key", 500)
            const existing = this.#state.creationKeys.find((entry) => entry.key === key)
            if (existing) {
                if (existing.inputDigest !== inputDigest) {
                    throw new Error("Optimization creation idempotency key was already used for different input")
                }
                return cloneJson(existing.result)
            }
        }
        if (this.#state.runs.length >= MAX_RUNS) throw new Error("Optimization store reached its run limit")
        const now = nowTimestamp()
        const run = {
            id: normalizedOptions.id === undefined
                ? randomUUID()
                : publicId(normalizedOptions.id, "Optimization run id"),
            state: "preflight",
            revision: 0,
            snapshot: cloneJson(frozen),
            epochs: [],
            currentEpoch: 0,
            checkpoint: {},
            recovery: null,
            error: null,
            operations: [],
            createdAt: now,
            updatedAt: now,
            completedAt: null,
        }
        return this.#mutate((state) => {
            if (state.runs.some((entry) => entry.id === run.id)) {
                throw new Error("Optimization run id already exists")
            }
            state.runs.push(run)
            const result = canonicalRunMutationResult({
                runId: run.id,
                state: run.state,
                revision: run.revision,
                updatedAt: run.updatedAt,
            })
            if (normalizedOptions.idempotencyKey !== undefined) {
                state.creationKeys.push({
                    key: normalizedOptions.idempotencyKey,
                    inputDigest,
                    result,
                })
            }
            return result
        })
    }

    getRun(runId) {
        this.#requireOpen()
        return copyRun(this.#requireRun(runId))
    }

    listRuns() {
        this.#requireOpen()
        return this.#state.runs
            .map(copyRun)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id))
    }

    updateCheckpoint(runId, patch = {}, options = {}) {
        this.#requireOpen()
        const checkpointPatch = boundedJson(
            requireObject(cloneJson(patch, "Optimization checkpoint patch"), "Optimization checkpoint patch"),
            "Optimization checkpoint patch",
        )
        const normalizedOptions = cloneJson(options, "Optimization checkpoint options")
        exactKeys(
            normalizedOptions,
            [],
            ["expectedRevision"],
            "Optimization checkpoint options",
        )
        const current = this.#requireRun(runId)
        this.#checkRevision(current, normalizedOptions.expectedRevision)
        return this.#mutate((state) => {
            const run = this.#requireRun(runId, state)
            const now = nowTimestamp()
            run.checkpoint = boundedJson(
                {...run.checkpoint, ...checkpointPatch},
                "Optimization checkpoint",
            )
            run.revision += 1
            run.updatedAt = now
            return copyRun(run)
        })
    }

    transitionRun(runId, nextState, patch = {}, options = {}) {
        this.#requireOpen()
        nextState = requiredText(nextState, "Optimization next state", 40)
        if (!RUN_STATES.has(nextState)) throw new Error("Optimization next state is invalid")
        const normalized = operationOptions(patch, options)
        exactKeys(normalized.patch, [], ["checkpoint", "error"], "Optimization transition patch")
        const inputDigest = canonicalOptimizationDigest({nextState, patch: normalized.patch})
        const current = this.#requireRun(runId)
        const existing = this.#existingOperation(
            current,
            normalized.options.idempotencyKey,
            "transition",
            inputDigest,
        )
        if (existing) return cloneJson(existing.result)
        this.#checkRevision(current, normalized.options.expectedRevision)
        if (TERMINAL_STATES.has(current.state)) throw new Error("A terminal Optimization run is immutable")
        if (!RUN_TRANSITIONS.get(current.state)?.has(nextState)) {
            throw new Error(`Invalid Optimization run transition: ${current.state} -> ${nextState}`)
        }
        const currentEpoch = current.epochs.at(-1) ?? null
        const releaseInstallRecovery = current.state === "needs_recovery" &&
            current.recovery?.previousState === "installing" &&
            currentEpoch?.status === "deciding"
        const approvedReleaseInstall = nextState === "installing" &&
            currentEpoch?.status === "deciding" &&
            (
                current.state === "waiting_approval" ||
                releaseInstallRecovery
            )
        const releaseFinalRegression = currentEpoch?.status === "deciding" && (
            (
                current.state === "installing" &&
                current.checkpoint?.releasePhase === "released-install" &&
                nextState === "evaluating"
            ) ||
            (
                current.state === "evaluating" &&
                current.checkpoint?.releasePhase === "final-regression" &&
                nextState === "deciding"
            )
        )
        if (
            releaseInstallRecovery &&
            !new Set(["installing", "restoring", "failed", "cancelled"]).has(nextState)
        ) {
            throw new Error("Optimization approved installation recovery cannot backtrack or skip phase")
        }
        if (["installing", "evaluating", "deciding"].includes(nextState)) {
            if (currentEpoch === null || TERMINAL_EPOCH_STATES.has(currentEpoch.status)) {
                throw new Error(`Optimization ${nextState} phase requires a nonterminal current Epoch`)
            }
            const allowedEpochStatuses = approvedReleaseInstall || releaseFinalRegression
                ? new Set(["deciding"])
                : new Map([
                    ["installing", new Set(["editing", "installing"])],
                    ["evaluating", new Set(["installing", "evaluating"])],
                    ["deciding", new Set(["evaluating", "deciding"])],
                ]).get(nextState)
            if (!allowedEpochStatuses.has(currentEpoch.status)) {
                throw new Error(`Optimization Epoch cannot backtrack or skip forward into ${nextState}`)
            }
            if (currentEpoch.candidateArtifactId === null) {
                throw new Error("Optimization installing phase requires a Candidate artifact")
            }
            if (["evaluating", "deciding"].includes(nextState) && currentEpoch.installArtifactIds.length === 0) {
                throw new Error("Optimization evaluating phase requires an install artifact")
            }
            if (nextState === "deciding" && currentEpoch.evaluationArtifactIds.length === 0) {
                throw new Error("Optimization deciding phase requires an evaluation artifact")
            }
            if (approvedReleaseInstall && (
                currentEpoch.analysisArtifactId === null ||
                currentEpoch.decisionArtifactId === null
            )) {
                throw new Error("Optimization approved installation requires analysis and decision artifacts")
            }
        }
        if (nextState === "waiting_approval" && (
            currentEpoch === null ||
            currentEpoch.status !== "deciding"
        )) {
            throw new Error("Optimization approval requires a deciding current Epoch")
        }
        if (nextState === "waiting_approval" && (
            currentEpoch.analysisArtifactId === null ||
            currentEpoch.decisionArtifactId === null
        )) {
            throw new Error("Optimization approval requires analysis and decision artifacts")
        }
        const resumingUnsubmittedEdit = current.state === "needs_recovery" &&
            current.checkpoint?.paused === true && currentEpoch?.status === "editing" &&
            currentEpoch.candidateArtifactId === null
        if (nextState === "editing" && currentEpoch !== null && !TERMINAL_EPOCH_STATES.has(currentEpoch.status) && !resumingUnsubmittedEdit) {
            throw new Error("Optimization must terminalize the current Epoch before returning to editing")
        }
        if (TERMINAL_STATES.has(nextState) && current.epochs.some(
            (epoch) => !TERMINAL_EPOCH_STATES.has(epoch.status),
        )) {
            throw new Error("A terminal Optimization run requires every Epoch to be terminal")
        }
        return this.#mutate((state) => {
            const run = this.#requireRun(runId, state)
            const now = nowTimestamp()
            run.state = nextState
            if (
                ["installing", "evaluating", "deciding"].includes(nextState) &&
                !approvedReleaseInstall &&
                !releaseFinalRegression
            ) {
                const epoch = run.epochs.at(-1)
                epoch.status = nextState
                epoch.updatedAt = now
                epoch.completedAt = null
            }
            if (Object.hasOwn(normalized.patch, "checkpoint")) {
                run.checkpoint = boundedJson(
                    requireObject(normalized.patch.checkpoint, "Optimization checkpoint"),
                    "Optimization checkpoint",
                )
            }
            if (Object.hasOwn(normalized.patch, "error")) {
                run.error = normalized.patch.error === null
                    ? null
                    : boundedJson(normalized.patch.error, "Optimization error", 32 * 1024)
            }
            run.revision += 1
            run.updatedAt = now
            if (TERMINAL_STATES.has(nextState)) run.completedAt = now
            return this.#recordOperation(
                run,
                normalized.options.idempotencyKey,
                "transition",
                inputDigest,
            )
        })
    }

    createEpoch(runId, input = {}, options = {}) {
        this.#requireOpen()
        const source = cloneJson(input, "Optimization epoch input")
        exactKeys(source, [], ["id", "candidateArtifactId"], "Optimization epoch input")
        const normalizedOptions = cloneJson(options, "Optimization epoch options")
        exactKeys(
            normalizedOptions,
            [],
            ["expectedRevision", "idempotencyKey"],
            "Optimization epoch options",
        )
        const current = this.#requireRun(runId)
        const inputDigest = canonicalOptimizationDigest(source)
        const existing = this.#existingOperation(
            current,
            normalizedOptions.idempotencyKey,
            "create_epoch",
            inputDigest,
        )
        if (existing) return cloneJson(existing.result)
        this.#checkRevision(current, normalizedOptions.expectedRevision)
        if (TERMINAL_STATES.has(current.state)) throw new Error("A terminal Optimization run is immutable")
        if (current.state !== "editing") throw new Error("Optimization epochs can only start while editing")
        if (current.epochs.some((entry) => !TERMINAL_EPOCH_STATES.has(entry.status))) {
            throw new Error("An Optimization Epoch is already in progress")
        }
        const effectiveMaxEpochs = Number.isSafeInteger(current.checkpoint?.approvedLimits?.maxEpochs)
            ? current.checkpoint.approvedLimits.maxEpochs
            : current.snapshot.limits.maxEpochs
        if (
            effectiveMaxEpochs < current.snapshot.limits.maxEpochs ||
            effectiveMaxEpochs > 100
        ) {
            throw new Error("Optimization approved epoch limit is invalid")
        }
        if (current.epochs.length >= effectiveMaxEpochs) {
            throw new Error("Optimization run reached its frozen epoch limit")
        }
        return this.#mutate((state) => {
            const run = this.#requireRun(runId, state)
            const now = nowTimestamp()
            const epoch = {
                id: source.id === undefined
                    ? randomUUID()
                    : publicId(source.id, "Optimization epoch id"),
                number: run.epochs.length + 1,
                status: "editing",
                candidateArtifactId: source.candidateArtifactId === undefined
                    ? null
                    : artifactId(source.candidateArtifactId, "Candidate artifact id"),
                installArtifactIds: [],
                evaluationArtifactIds: [],
                analysisArtifactId: null,
                decisionArtifactId: null,
                createdAt: now,
                updatedAt: now,
                completedAt: null,
            }
            run.epochs.push(epoch)
            run.currentEpoch = epoch.number
            run.revision += 1
            run.updatedAt = now
            return this.#recordOperation(
                run,
                normalizedOptions.idempotencyKey,
                "create_epoch",
                inputDigest,
                epoch,
            )
        })
    }

    updateEpoch(runId, epochId, patch = {}, options = {}) {
        this.#requireOpen()
        epochId = publicId(epochId, "Optimization epoch id")
        const normalized = operationOptions(patch, options)
        exactKeys(normalized.patch, [], [
            "status",
            "candidateArtifactId",
            "installArtifactIds",
            "evaluationArtifactIds",
            "analysisArtifactId",
            "decisionArtifactId",
        ], "Optimization epoch patch")
        const current = this.#requireRun(runId)
        const epoch = current.epochs.find((entry) => entry.id === epochId)
        if (!epoch) throw new Error("Unknown Optimization epoch")
        const inputDigest = canonicalOptimizationDigest({epochId, patch: normalized.patch})
        const existing = this.#existingOperation(
            current,
            normalized.options.idempotencyKey,
            "update_epoch",
            inputDigest,
        )
        if (existing) return cloneJson(existing.result)
        this.#checkRevision(current, normalized.options.expectedRevision)
        if (TERMINAL_STATES.has(current.state)) throw new Error("A terminal Optimization run is immutable")
        if (TERMINAL_EPOCH_STATES.has(epoch.status)) {
            throw new Error("A terminal Optimization epoch is append-only and immutable")
        }
        const evidencePatch = {}
        for (const field of EPOCH_EVIDENCE_FIELDS) {
            if (Object.hasOwn(normalized.patch, field)) {
                evidencePatch[field] = epochEvidencePatchValue(field, normalized.patch[field])
            }
        }
        const frozenEvidence = current.state === "waiting_approval" ||
            (epoch.status === "deciding" && (
                current.state === "installing" ||
                (
                    current.state === "needs_recovery" &&
                    current.recovery?.previousState === "installing"
                )
            ))
        if (frozenEvidence) {
            for (const [field, value] of Object.entries(evidencePatch)) {
                if (!sameJson(value, epoch[field])) {
                    throw new Error(`Optimization Epoch ${field} evidence is frozen and immutable`)
                }
            }
        }
        for (const field of ["candidateArtifactId", "analysisArtifactId", "decisionArtifactId"]) {
            if (
                Object.hasOwn(evidencePatch, field) &&
                epoch[field] !== null &&
                evidencePatch[field] !== epoch[field]
            ) {
                throw new Error(`Optimization Epoch ${field} is append-only and immutable`)
            }
        }
        for (const field of ["installArtifactIds", "evaluationArtifactIds"]) {
            if (
                Object.hasOwn(evidencePatch, field) &&
                !extendsArtifactSequence(epoch[field], evidencePatch[field])
            ) {
                throw new Error(`Optimization Epoch ${field} is append-only and immutable`)
            }
        }
        for (const field of IMMUTABLE_EPOCH_FIELDS.get(epoch.status) ?? []) {
            const finalRegressionAppend =
                field === "evaluationArtifactIds" &&
                current.state === "evaluating" &&
                current.checkpoint?.releasePhase === "final-regression"
            if (
                Object.hasOwn(evidencePatch, field) &&
                !sameJson(evidencePatch[field], epoch[field]) &&
                !finalRegressionAppend
            ) {
                throw new Error(`Optimization Epoch ${field} is append-only and immutable in ${epoch.status}`)
            }
        }
        if (Object.hasOwn(normalized.patch, "status")) {
            const requestedStatus = requiredText(
                normalized.patch.status,
                "Optimization epoch status",
                40,
            )
            if (
                requestedStatus !== epoch.status &&
                !EPOCH_TRANSITIONS.get(epoch.status)?.has(requestedStatus)
            ) {
                throw new Error(`Invalid Optimization Epoch transition: ${epoch.status} -> ${requestedStatus}`)
            }
        }
        return this.#mutate((state) => {
            const run = this.#requireRun(runId, state)
            const stored = run.epochs.find((entry) => entry.id === epochId)
            const nextStatus = normalized.patch.status === undefined
                ? stored.status
                : requiredText(normalized.patch.status, "Optimization epoch status", 40)
            if (!EPOCH_STATES.has(nextStatus)) throw new Error("Optimization epoch status is invalid")
            if (Object.hasOwn(normalized.patch, "candidateArtifactId")) {
                stored.candidateArtifactId = nullableArtifactId(
                    normalized.patch.candidateArtifactId,
                    "Candidate artifact id",
                )
            }
            if (Object.hasOwn(normalized.patch, "installArtifactIds")) {
                stored.installArtifactIds = artifactIds(
                    normalized.patch.installArtifactIds,
                    "Install artifact ids",
                )
            }
            if (Object.hasOwn(normalized.patch, "evaluationArtifactIds")) {
                stored.evaluationArtifactIds = artifactIds(
                    normalized.patch.evaluationArtifactIds,
                    "Evaluation artifact ids",
                )
            }
            for (const [field, label] of [
                ["analysisArtifactId", "Analysis artifact id"],
                ["decisionArtifactId", "Decision artifact id"],
            ]) {
                if (Object.hasOwn(normalized.patch, field)) {
                    stored[field] = nullableArtifactId(normalized.patch[field], label)
                }
            }
            const now = nowTimestamp()
            stored.status = nextStatus
            stored.updatedAt = now
            if (TERMINAL_EPOCH_STATES.has(nextStatus)) stored.completedAt = now
            canonicalEpoch(stored)
            run.revision += 1
            run.updatedAt = now
            return this.#recordOperation(
                run,
                normalized.options.idempotencyKey,
                "update_epoch",
                inputDigest,
                stored,
            )
        })
    }

    publicSummary(runId) {
        this.#requireOpen()
        return cloneJson(publicRunSummary(this.#requireRun(runId)))
    }

    listPublicSummaries() {
        this.#requireOpen()
        return this.#state.runs.map(publicRunSummary).map((entry) => cloneJson(entry))
    }

    #normalizeInterruptedRuns() {
        const interrupted = this.#state.runs.filter((run) => ACTIVE_RESTART_STATES.has(run.state))
        if (interrupted.length === 0) return
        const now = nowTimestamp()
        for (const run of interrupted) {
            const previousState = run.state
            run.state = "needs_recovery"
            run.revision += 1
            run.recovery = {
                previousState,
                reason: "process_interrupted",
                recoveredAt: now,
            }
            run.updatedAt = now
        }
        this.#state.revision += 1
        this.persist()
    }
}

module.exports = {
    MAX_STORE_BYTES,
    OPTIMIZATION_STORE_SCHEMA,
    OptimizationStore,
}
