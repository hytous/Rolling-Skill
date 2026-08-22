const fs = require("node:fs")
const net = require("node:net")
const path = require("node:path")
const {createHash, randomBytes, randomUUID, timingSafeEqual} = require("node:crypto")

const {JsonLineDecoder} = require("../json-rpc.cjs")
const {createPublicControlError, publicControlError} = require("./contracts.cjs")

const CONTROL_SOCKET_DIRECTORY = "control"
const CONTROL_SOCKET_NAME = "control.sock"
const CONTROL_SOCKET_QUARANTINE_PREFIX = ".control.sock.stale-"
const CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX = ".control.sock.close-"
const CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX = ".p-"
const CONTROL_SOCKET_BIND_DIRECTORY_PREFIX = ".b-"
const CONTROL_SOCKET_BIND_RECOVERY_PREFIX = ".r-"
const CONTROL_SOCKET_BIND_NAME = "s"
const MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS = 8
const MAX_CONTROL_SOCKET_PATH_BYTES = process.platform === "linux" ? 107 : 103
const MAX_CONTROL_MESSAGE_BYTES = 1_048_576
const MAX_CONTROL_REQUEST_ID_LENGTH = 200
const MAX_CONTROL_METHOD_LENGTH = 200
const MAX_CONTROL_TOKEN_LENGTH = 4_096
const MAX_CONTROL_SESSION_ID_LENGTH = 200
const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 32
const DEFAULT_MAX_QUEUED_RESPONSES = 32
const DEFAULT_MAX_QUEUED_RESPONSE_BYTES = 4 * MAX_CONTROL_MESSAGE_BYTES
const CONTROL_SOCKET_BIND_DIRECTORY_PATTERN = /^\.b-[A-Za-z0-9_-]{11}$/
const CONTROL_SOCKET_BIND_RECOVERY_PATTERN = /^\.r-[A-Za-z0-9_-]{11}$/
const CONTROL_SOCKET_PUBLIC_RECOVERY_PATTERN = /^\.p-([A-Za-z0-9_-]{12})$/
const CONTROL_SOCKET_PUBLIC_RECOVERY_FINGERPRINT_BYTES = 9
const CONTROL_SOCKET_PUBLIC_RECOVERY_STAGES = 2
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"])
const stateByServer = new WeakMap()

function isPlainObject(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false
    return Object.getPrototypeOf(value) === Object.prototype
}

function ownDataValue(object, key) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor && Object.hasOwn(descriptor, "value")
        ? {present: true, value: descriptor.value}
        : {present: false, value: undefined}
}

function isBoundedString(value, maximum) {
    return typeof value === "string" &&
        value.length > 0 &&
        Buffer.byteLength(value, "utf8") <= maximum
}

function containsForbiddenObjectKey(root) {
    const pending = [root]
    let visited = 0
    while (pending.length > 0) {
        const value = pending.pop()
        if (typeof value !== "object" || value === null) continue
        visited += 1
        if (visited > MAX_CONTROL_MESSAGE_BYTES) return true
        if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return true
        const descriptors = Object.getOwnPropertyDescriptors(value)
        for (const [key, descriptor] of Object.entries(descriptors)) {
            if (FORBIDDEN_OBJECT_KEYS.has(key)) return true
            if (!Object.hasOwn(descriptor, "value")) return true
            if (typeof descriptor.value === "object" && descriptor.value !== null) {
                pending.push(descriptor.value)
            }
        }
    }
    return false
}

function parseRequest(message) {
    if (!isPlainObject(message) || containsForbiddenObjectKey(message)) return null
    const id = ownDataValue(message, "id")
    const method = ownDataValue(message, "method")
    const params = ownDataValue(message, "params")
    const token = ownDataValue(message, "token")
    const sessionId = ownDataValue(message, "sessionId")
    if (
        !id.present || !isBoundedString(id.value, MAX_CONTROL_REQUEST_ID_LENGTH) ||
        !method.present || !isBoundedString(method.value, MAX_CONTROL_METHOD_LENGTH) ||
        !params.present || !isPlainObject(params.value) ||
        !token.present || !isBoundedString(token.value, MAX_CONTROL_TOKEN_LENGTH) ||
        !sessionId.present || !isBoundedString(sessionId.value, MAX_CONTROL_SESSION_ID_LENGTH)
    ) return null
    return {
        id: id.value,
        invocation: {
            token: token.value,
            sessionId: sessionId.value,
            method: method.value,
            params: params.value,
        },
    }
}

function checkOwner(stat, label) {
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new Error(`${label} must be owned by the current user`)
    }
}

async function existingLstat(candidate) {
    try {
        return await fs.promises.lstat(candidate)
    } catch (error) {
        if (error?.code === "ENOENT") return null
        throw error
    }
}

async function prepareControlDirectory(userData, configuredControlDir, ensureOpen = () => {}) {
    if (typeof userData !== "string" || !path.isAbsolute(userData) || path.resolve(userData) !== userData) {
        throw new Error("userData must be an exact absolute directory")
    }
    const expectedControlDir = path.join(userData, CONTROL_SOCKET_DIRECTORY)
    const controlDir = configuredControlDir ?? expectedControlDir
    if (controlDir !== expectedControlDir) {
        throw new Error("Control directory must be the exact configured child")
    }

    ensureOpen()
    const userDataStat = await fs.promises.lstat(userData)
    ensureOpen()
    if (userDataStat.isSymbolicLink() || !userDataStat.isDirectory()) {
        throw new Error("userData must be a real directory")
    }
    checkOwner(userDataStat, "userData")
    const realUserData = await fs.promises.realpath(userData)
    ensureOpen()

    try {
        ensureOpen()
        await fs.promises.mkdir(controlDir, {mode: 0o700})
    } catch (error) {
        if (error?.code !== "EEXIST") throw error
    }
    ensureOpen()
    const controlStat = await fs.promises.lstat(controlDir)
    ensureOpen()
    if (controlStat.isSymbolicLink() || !controlStat.isDirectory()) {
        throw new Error("Control directory must be a real directory, not a symlink")
    }
    checkOwner(controlStat, "Control directory")
    const realControlDir = await fs.promises.realpath(controlDir)
    ensureOpen()
    if (realControlDir !== path.join(realUserData, CONTROL_SOCKET_DIRECTORY)) {
        throw new Error("Control directory must be the exact configured child")
    }
    ensureOpen()
    await fs.promises.chmod(controlDir, 0o700)
    ensureOpen()
    const securedStat = await fs.promises.lstat(controlDir)
    ensureOpen()
    checkOwner(securedStat, "Control directory")
    if ((securedStat.mode & 0o777) !== 0o700) {
        throw new Error("Control directory permissions are not private")
    }
    return {controlDir, socketPath: path.join(controlDir, CONTROL_SOCKET_NAME)}
}

function probeSocket(socketPath) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath)
        let settled = false
        const finish = (callback, value) => {
            if (settled) return
            settled = true
            socket.removeAllListeners()
            socket.destroy()
            callback(value)
        }
        socket.once("connect", () => finish(resolve, "active"))
        socket.once("error", (error) => {
            if (error?.code === "ECONNREFUSED" || error?.code === "ENOENT") {
                finish(resolve, "stale")
                return
            }
            finish(reject, error)
        })
    })
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino
}

async function removeStaleSocketAtPath(socketPath, {
    label,
    quarantinePrefix,
    validatePath,
    ensureOpen = () => {},
}) {
    validatePath(socketPath)
    ensureOpen()
    const initial = await existingLstat(socketPath)
    ensureOpen()
    if (!initial) return
    if (initial.isSymbolicLink() || !initial.isSocket()) {
        throw new Error(`Refusing to replace a non-socket ${label} path`)
    }
    checkOwner(initial, label)
    const socketState = await probeSocket(socketPath)
    ensureOpen()
    if (socketState === "active") {
        throw new Error(`${label} is active or already in use`)
    }
    const current = await existingLstat(socketPath)
    ensureOpen()
    if (!current) return
    if (!current.isSocket() || !sameFile(initial, current)) {
        throw new Error("Control socket path changed while checking stale state")
    }
    const quarantinePath = controlledSibling(socketPath, quarantinePrefix)

    ensureOpen()
    fs.renameSync(socketPath, quarantinePath)
    const quarantined = await fs.promises.lstat(quarantinePath)
    if (quarantined.isSocket() && sameFile(current, quarantined)) {
        fs.unlinkSync(quarantinePath)
        return
    }

    let restored = false
    if (!await existingLstat(socketPath)) {
        try {
            fs.linkSync(quarantinePath, socketPath)
            const linked = await fs.promises.lstat(socketPath)
            if (!sameFile(linked, quarantined)) {
                throw new Error("Restored control socket replacement changed identity")
            }
            fs.unlinkSync(quarantinePath)
            restored = true
        } catch (error) {
            if (error?.code !== "EEXIST") {
                throw new Error("Control socket quarantine restore failed", {cause: error})
            }
        }
    }
    throw new Error(restored
        ? "Stale control socket changed before quarantine and was restored"
        : "Stale control socket changed before quarantine; replacement remains quarantined")
}

async function removeStaleSocket(socketPath, ensureOpen) {
    return removeStaleSocketAtPath(socketPath, {
        label: "Control socket",
        quarantinePrefix: CONTROL_SOCKET_QUARANTINE_PREFIX,
        ensureOpen,
        validatePath(candidate) {
            if (path.basename(candidate) !== CONTROL_SOCKET_NAME) {
                throw new Error("Control socket path is not the exact configured child")
            }
        },
    })
}

function controlledSibling(candidate, prefix) {
    const directory = path.dirname(candidate)
    const sibling = path.join(directory, `${prefix}${process.pid}-${randomUUID()}`)
    if (
        path.dirname(sibling) !== directory ||
        !path.basename(sibling).startsWith(prefix)
    ) throw new Error("Control socket generated path is invalid")
    return sibling
}

function assertSocketPathWithinBudget(candidate, label) {
    if (Buffer.byteLength(candidate, "utf8") > MAX_CONTROL_SOCKET_PATH_BYTES) {
        throw new Error(`${label} is too long for the Unix socket path budget`)
    }
}

function assertControlSocketLayoutWithinBudget(controlDir, socketPath) {
    const bindSuffix = "A".repeat(11)
    const candidates = [
        [socketPath, "Control socket path"],
        [
            path.join(
                controlDir,
                `${CONTROL_SOCKET_BIND_DIRECTORY_PREFIX}${bindSuffix}`,
                CONTROL_SOCKET_BIND_NAME,
            ),
            "Control bind socket path",
        ],
        [
            path.join(
                controlDir,
                `${CONTROL_SOCKET_BIND_RECOVERY_PREFIX}${bindSuffix}`,
                CONTROL_SOCKET_BIND_NAME,
            ),
            "Control bind recovery socket path",
        ],
        [
            path.join(
                controlDir,
                `${CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX}${"A".repeat(12)}`,
            ),
            "Control public recovery socket path",
        ],
    ]
    for (const [candidate, label] of candidates) {
        assertSocketPathWithinBudget(candidate, label)
    }
}

function randomBindSuffix() {
    return randomBytes(8).toString("base64url")
}

function publicRecoveryFingerprints(identity) {
    const digest = createHash("sha256")
        .update(`${identity.dev}:${identity.ino}`)
        .digest()
    return Array.from({length: CONTROL_SOCKET_PUBLIC_RECOVERY_STAGES}, (_, stage) =>
        digest.subarray(
            stage * CONTROL_SOCKET_PUBLIC_RECOVERY_FINGERPRINT_BYTES,
            (stage + 1) * CONTROL_SOCKET_PUBLIC_RECOVERY_FINGERPRINT_BYTES,
        ))
}

function publicRecoveryName(identity, stage = 0) {
    const fingerprints = publicRecoveryFingerprints(identity)
    if (!Number.isInteger(stage) || stage < 0 || stage >= fingerprints.length) {
        throw new Error("Control public recovery stage is invalid")
    }
    return `${CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX}${fingerprints[stage].toString("base64url")}`
}

function publicRecoveryStage(name, identity) {
    const match = CONTROL_SOCKET_PUBLIC_RECOVERY_PATTERN.exec(name)
    if (!match) return -1
    const actual = Buffer.from(match[1], "base64url")
    let matchingStage = -1
    for (const [stage, expected] of publicRecoveryFingerprints(identity).entries()) {
        const matches = actual.length === expected.length && timingSafeEqual(actual, expected)
        if (matches) matchingStage = stage
    }
    return matchingStage
}

function createPublicRecoveryPath(socketPath, identity, stage = 0) {
    const controlDir = path.dirname(socketPath)
    const candidate = path.join(controlDir, publicRecoveryName(identity, stage))
    try {
        const existing = fs.lstatSync(candidate)
        throw new Error(sameFile(existing, identity)
            ? "Control public recovery fingerprint is already occupied"
            : "Control public recovery fingerprint is occupied by a different identity")
    } catch (error) {
        if (error?.code === "ENOENT") return candidate
        throw error
    }
}

function validatePublicRecoveryPath(candidate, controlDir) {
    if (
        path.dirname(candidate) !== controlDir ||
        !CONTROL_SOCKET_PUBLIC_RECOVERY_PATTERN.test(path.basename(candidate))
    ) throw new Error("Control public recovery path is invalid")
}

async function recoverPublicSocket(candidate, ensureOpen = () => {}) {
    const controlDir = path.dirname(candidate)
    validatePublicRecoveryPath(candidate, controlDir)
    assertSocketPathWithinBudget(candidate, "Control public recovery socket path")
    ensureOpen()
    const initial = await existingLstat(candidate)
    ensureOpen()
    if (!initial) return
    if (initial.isSymbolicLink() || !initial.isSocket()) {
        throw new Error("Refusing non-socket control public recovery evidence")
    }
    checkOwner(initial, "Control public recovery socket")
    const initialStage = publicRecoveryStage(path.basename(candidate), initial)
    if (initialStage < 0) {
        throw new Error("Control public recovery socket identity does not match its name")
    }
    const socketState = await probeSocket(candidate)
    ensureOpen()
    if (socketState === "active") {
        throw new Error("Control public recovery socket is active or already in use")
    }
    const current = await existingLstat(candidate)
    ensureOpen()
    if (!current) return
    if (
        current.isSymbolicLink() || !current.isSocket() ||
        !sameFile(current, initial) ||
        publicRecoveryStage(path.basename(candidate), current) !== initialStage
    ) throw new Error("Control public recovery changed while checking stale state")
    checkOwner(current, "Control public recovery socket")

    const cleanupStage = (initialStage + 1) % CONTROL_SOCKET_PUBLIC_RECOVERY_STAGES
    const cleanupPath = createPublicRecoveryPath(candidate, current, cleanupStage)
    ensureOpen()
    try {
        fs.renameSync(candidate, cleanupPath)
    } catch (error) {
        if (error?.code === "ENOENT") return
        throw new Error("Control public recovery cleanup rename failed", {cause: error})
    }
    const cleanup = fs.lstatSync(cleanupPath)
    if (
        cleanup.isSymbolicLink() || !cleanup.isSocket() ||
        !sameFile(cleanup, current) ||
        publicRecoveryStage(path.basename(cleanupPath), cleanup) !== cleanupStage
    ) {
        throw new Error("Control public recovery changed after cleanup rename")
    }
    checkOwner(cleanup, "Control public recovery socket")
    fs.unlinkSync(cleanupPath)
}

async function recoverPublicSockets(controlDir, ensureOpen = () => {}) {
    ensureOpen()
    const names = await fs.promises.readdir(controlDir)
    ensureOpen()
    const candidates = names
        .filter((name) => name.startsWith(CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX))
        .sort()
    for (const name of candidates) {
        ensureOpen()
        await recoverPublicSocket(path.join(controlDir, name), ensureOpen)
        ensureOpen()
    }
}

function validateBindNamespacePath(candidate, controlDir, {allowRecovery = false} = {}) {
    if (path.dirname(candidate) !== controlDir) {
        throw new Error("Control bind namespace must be an exact control-directory child")
    }
    const name = path.basename(candidate)
    if (
        !CONTROL_SOCKET_BIND_DIRECTORY_PATTERN.test(name) &&
        !(allowRecovery && CONTROL_SOCKET_BIND_RECOVERY_PATTERN.test(name))
    ) throw new Error("Control bind namespace name is invalid")
}

function createBindNamespace(controlDir, ensureOpen = () => {}) {
    assertSocketPathWithinBudget(
        path.join(
            controlDir,
            `${CONTROL_SOCKET_BIND_RECOVERY_PREFIX}${"A".repeat(11)}`,
            CONTROL_SOCKET_BIND_NAME,
        ),
        "Control bind recovery socket path",
    )
    let collision = null
    for (let attempt = 0; attempt < MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS; attempt += 1) {
        ensureOpen()
        const bindDir = path.join(
            controlDir,
            `${CONTROL_SOCKET_BIND_DIRECTORY_PREFIX}${randomBindSuffix()}`,
        )
        validateBindNamespacePath(bindDir, controlDir)
        const bindPath = path.join(bindDir, CONTROL_SOCKET_BIND_NAME)
        assertSocketPathWithinBudget(bindPath, "Control bind socket path")
        try {
            fs.mkdirSync(bindDir, {mode: 0o700})
        } catch (error) {
            if (error?.code !== "EEXIST") throw error
            collision = error
            continue
        }
        try {
            const bindDirectoryIdentity = fs.lstatSync(bindDir)
            if (bindDirectoryIdentity.isSymbolicLink() || !bindDirectoryIdentity.isDirectory()) {
                throw new Error("Control bind namespace must be a real directory")
            }
            checkOwner(bindDirectoryIdentity, "Control bind namespace")
            fs.chmodSync(bindDir, 0o700)
            const secured = fs.lstatSync(bindDir)
            if (!secured.isDirectory() || !sameFile(secured, bindDirectoryIdentity)) {
                throw new Error("Control bind namespace changed while securing permissions")
            }
            checkOwner(secured, "Control bind namespace")
            if ((secured.mode & 0o777) !== 0o700) {
                throw new Error("Control bind namespace permissions are not private")
            }
            return {bindDir, bindPath, bindDirectoryIdentity: secured}
        } catch (error) {
            try {
                const current = fs.lstatSync(bindDir)
                if (
                    current.isDirectory() &&
                    fs.readdirSync(bindDir).length === 0
                ) fs.rmdirSync(bindDir)
            } catch {}
            throw error
        }
    }
    throw new Error("Control bind namespace collisions exhausted the creation limit", {
        cause: collision,
    })
}

function reserveBindRecoveryDirectory(controlDir) {
    let collision = null
    for (let attempt = 0; attempt < MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS; attempt += 1) {
        const recoveryPath = path.join(
            controlDir,
            `${CONTROL_SOCKET_BIND_RECOVERY_PREFIX}${randomBindSuffix()}`,
        )
        validateBindNamespacePath(recoveryPath, controlDir, {allowRecovery: true})
        try {
            fs.mkdirSync(recoveryPath, {mode: 0o700})
            const identity = fs.lstatSync(recoveryPath)
            if (!identity.isDirectory() || identity.isSymbolicLink()) {
                throw new Error("Control bind recovery reservation is invalid")
            }
            checkOwner(identity, "Control bind recovery directory")
            return {recoveryPath, reservationIdentity: identity}
        } catch (error) {
            if (error?.code !== "EEXIST") throw error
            collision = error
        }
    }
    throw new Error("Control bind recovery collisions exhausted the creation limit", {
        cause: collision,
    })
}

function createVacantBindRecoveryPath(controlDir) {
    for (let attempt = 0; attempt < MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS; attempt += 1) {
        const recoveryPath = path.join(
            controlDir,
            `${CONTROL_SOCKET_BIND_RECOVERY_PREFIX}${randomBindSuffix()}`,
        )
        validateBindNamespacePath(recoveryPath, controlDir, {allowRecovery: true})
        try {
            fs.lstatSync(recoveryPath)
        } catch (error) {
            if (error?.code === "ENOENT") return recoveryPath
            throw error
        }
    }
    throw new Error("Control bind recovery collisions exhausted the creation limit")
}

function moveBindSymlinkToRecovery(bindDir, identity) {
    const recoveryPath = createVacantBindRecoveryPath(path.dirname(bindDir))
    try {
        fs.renameSync(bindDir, recoveryPath)
    } catch (error) {
        throw new Error("Control bind symlink recovery failed", {cause: error})
    }
    const recovered = fs.lstatSync(recoveryPath)
    if (!recovered.isSymbolicLink() || !sameFile(recovered, identity)) {
        throw new Error("Control bind symlink changed while moving to recovery")
    }
    return recoveryPath
}

function removeRecoveryReservation(recoveryPath, reservationIdentity) {
    try {
        const current = fs.lstatSync(recoveryPath)
        if (
            current.isDirectory() && sameFile(current, reservationIdentity) &&
            fs.readdirSync(recoveryPath).length === 0
        ) fs.rmdirSync(recoveryPath)
    } catch {}
}

function moveBindNamespaceToRecovery(bindDir, bindDirectoryIdentity) {
    const controlDir = path.dirname(bindDir)
    validateBindNamespacePath(bindDir, controlDir, {allowRecovery: true})
    const {recoveryPath, reservationIdentity} = reserveBindRecoveryDirectory(controlDir)
    try {
        fs.renameSync(bindDir, recoveryPath)
    } catch (error) {
        removeRecoveryReservation(recoveryPath, reservationIdentity)
        throw new Error("Control bind namespace quarantine failed", {cause: error})
    }
    const recoveredDirectory = fs.lstatSync(recoveryPath)
    return {
        recoveryPath,
        directoryMatches: recoveredDirectory.isDirectory() &&
            !recoveredDirectory.isSymbolicLink() &&
            sameFile(recoveredDirectory, bindDirectoryIdentity),
    }
}

function listenAtPath(server, socketPath) {
    return new Promise((resolve, reject) => {
        const onError = (error) => {
            server.off("listening", onListening)
            reject(error)
        }
        const onListening = () => {
            server.off("error", onError)
            resolve()
        }
        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(socketPath)
    })
}

function validateCleanupCandidate(candidate, kind) {
    const name = path.basename(candidate)
    if (kind === "public" && name !== CONTROL_SOCKET_NAME) {
        throw new Error("Control socket path is not the exact configured child")
    }
}

function tryRestoreQuarantinedPath(socketPath, quarantinePath, identity) {
    try {
        fs.linkSync(quarantinePath, socketPath)
    } catch (error) {
        if (error?.code === "EEXIST") return false
        throw new Error("Control socket quarantine restore failed", {cause: error})
    }
    const restored = fs.lstatSync(socketPath)
    if (!sameFile(restored, identity)) {
        throw new Error("Restored control socket replacement changed identity")
    }
    fs.unlinkSync(quarantinePath)
    return true
}

async function cleanupSocketPath(socketPath, serverIdentity, kind) {
    if (!socketPath || !serverIdentity) return
    validateCleanupCandidate(socketPath, kind)
    if (!await existingLstat(socketPath)) return
    const quarantinedPath = createPublicRecoveryPath(socketPath, serverIdentity)
    try {
        fs.renameSync(socketPath, quarantinedPath)
    } catch (error) {
        if (error?.code === "ENOENT") return
        throw new Error("Control socket cleanup quarantine failed", {cause: error})
    }

    const quarantined = await fs.promises.lstat(quarantinedPath)
    if (quarantined.isSocket() && sameFile(quarantined, serverIdentity)) {
        fs.unlinkSync(quarantinedPath)
        return
    }
    if (tryRestoreQuarantinedPath(
        socketPath,
        quarantinedPath,
        quarantined,
    )) return
    throw new Error(
        "Control socket cleanup quarantine is occupied; replacement remains quarantined",
    )
}

function preserveBindRecovery(recoveryPath) {
    try {
        const stat = fs.lstatSync(recoveryPath)
        if (stat.isDirectory() && !stat.isSymbolicLink()) fs.chmodSync(recoveryPath, 0o500)
    } catch {}
}

function bindRecoveryError(recoveryPath) {
    preserveBindRecovery(recoveryPath)
    return new Error("Control bind namespace mismatch; recovery evidence was retained")
}

function finishBindNamespaceCleanup(
    recoveryPath,
    directoryMatches,
    expectedSocketIdentity,
) {
    try {
        if (!directoryMatches) throw bindRecoveryError(recoveryPath)
        const entries = fs.readdirSync(recoveryPath)
        if (entries.length === 0) {
            fs.rmdirSync(recoveryPath)
            return
        }
        if (entries.length !== 1 || entries[0] !== CONTROL_SOCKET_BIND_NAME) {
            throw bindRecoveryError(recoveryPath)
        }
        const recoveredSocketPath = path.join(recoveryPath, CONTROL_SOCKET_BIND_NAME)
        const recoveredSocket = fs.lstatSync(recoveredSocketPath)
        if (
            !expectedSocketIdentity || recoveredSocket.isSymbolicLink() ||
            !recoveredSocket.isSocket() || !sameFile(recoveredSocket, expectedSocketIdentity)
        ) throw bindRecoveryError(recoveryPath)
        checkOwner(recoveredSocket, "Control bind socket")
        fs.unlinkSync(recoveredSocketPath)
        fs.rmdirSync(recoveryPath)
    } catch (error) {
        preserveBindRecovery(recoveryPath)
        throw error
    }
}

async function cleanupBindNamespace(
    bindDir,
    bindDirectoryIdentity,
    socketIdentity,
) {
    if (!bindDir || !bindDirectoryIdentity) return
    const controlDir = path.dirname(bindDir)
    validateBindNamespacePath(bindDir, controlDir, {allowRecovery: true})
    const initial = await existingLstat(bindDir)
    if (!initial) return
    if (initial.isSymbolicLink()) {
        throw bindRecoveryError(moveBindSymlinkToRecovery(bindDir, initial))
    }
    if (!initial.isDirectory()) {
        throw new Error("Control bind namespace identity changed; evidence was retained")
    }
    checkOwner(initial, "Control bind namespace")
    await fs.promises.chmod(bindDir, 0o700)
    const writable = fs.lstatSync(bindDir)
    if (
        writable.isSymbolicLink() || !writable.isDirectory() ||
        !sameFile(writable, initial)
    ) {
        throw new Error("Control bind namespace changed while opening cleanup")
    }
    checkOwner(writable, "Control bind namespace")
    if ((writable.mode & 0o777) !== 0o700) {
        throw new Error("Control bind namespace cleanup permissions are invalid")
    }
    const {recoveryPath, directoryMatches} = moveBindNamespaceToRecovery(
        bindDir,
        bindDirectoryIdentity,
    )
    finishBindNamespaceCleanup(recoveryPath, directoryMatches, socketIdentity)
}

async function recoverBindNamespace(candidate, ensureOpen = () => {}) {
    const controlDir = path.dirname(candidate)
    validateBindNamespacePath(candidate, controlDir, {allowRecovery: true})
    ensureOpen()
    const directoryIdentity = await fs.promises.lstat(candidate)
    ensureOpen()
    if (directoryIdentity.isSymbolicLink() || !directoryIdentity.isDirectory()) {
        throw new Error("Refusing non-directory control bind recovery evidence")
    }
    checkOwner(directoryIdentity, "Control bind recovery directory")
    const entries = await fs.promises.readdir(candidate)
    ensureOpen()
    if (entries.length === 0) {
        await cleanupBindNamespace(candidate, directoryIdentity, null)
        return
    }
    if (entries.length !== 1 || entries[0] !== CONTROL_SOCKET_BIND_NAME) {
        throw new Error("Control bind recovery directory has unexpected entries")
    }
    const socketPath = path.join(candidate, CONTROL_SOCKET_BIND_NAME)
    assertSocketPathWithinBudget(socketPath, "Control bind recovery socket path")
    const socketIdentity = await fs.promises.lstat(socketPath)
    ensureOpen()
    if (socketIdentity.isSymbolicLink() || !socketIdentity.isSocket()) {
        throw new Error("Refusing non-socket control bind recovery entry")
    }
    checkOwner(socketIdentity, "Control bind recovery socket")
    const socketState = await probeSocket(socketPath)
    ensureOpen()
    if (socketState === "active") {
        throw new Error("Control bind socket is active or already in use")
    }
    const currentDirectory = fs.lstatSync(candidate)
    const currentSocket = fs.lstatSync(socketPath)
    if (
        !currentDirectory.isDirectory() || currentDirectory.isSymbolicLink() ||
        !sameFile(currentDirectory, directoryIdentity) ||
        !currentSocket.isSocket() || currentSocket.isSymbolicLink() ||
        !sameFile(currentSocket, socketIdentity)
    ) throw new Error("Control bind recovery changed while checking stale state")
    await cleanupBindNamespace(candidate, directoryIdentity, socketIdentity)
}

async function recoverBindNamespaces(controlDir, ensureOpen = () => {}) {
    ensureOpen()
    const names = await fs.promises.readdir(controlDir)
    ensureOpen()
    const candidates = names.filter((name) =>
        CONTROL_SOCKET_BIND_DIRECTORY_PATTERN.test(name) ||
        CONTROL_SOCKET_BIND_RECOVERY_PATTERN.test(name),
    ).sort((left, right) => {
        const leftRecovery = CONTROL_SOCKET_BIND_RECOVERY_PATTERN.test(left)
        const rightRecovery = CONTROL_SOCKET_BIND_RECOVERY_PATTERN.test(right)
        return Number(rightRecovery) - Number(leftRecovery) || left.localeCompare(right)
    })
    for (const name of candidates) {
        ensureOpen()
        await recoverBindNamespace(path.join(controlDir, name), ensureOpen)
        ensureOpen()
    }
}

async function closeListeningServer(server) {
    if (!server?.listening) return
    await new Promise((resolve, reject) => {
        try {
            server.close((error) => error ? reject(error) : resolve())
        } catch (error) {
            reject(error)
        }
    })
}

function protectBindNamespaceForNativeClose(state) {
    if (!state.server?.listening || !state.bindDir || !state.bindDirectoryIdentity) return
    let current = null
    for (let attempt = 0; attempt < MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS; attempt += 1) {
        try {
            current = fs.lstatSync(state.bindDir)
            break
        } catch (error) {
            if (error?.code !== "ENOENT") throw error
        }
        try {
            fs.mkdirSync(state.bindDir, {mode: 0o700})
            current = fs.lstatSync(state.bindDir)
            state.bindDirectoryIdentity = current
            break
        } catch (error) {
            if (error?.code !== "EEXIST") throw error
        }
    }
    if (!current) throw new Error("Control bind namespace guard collisions were exhausted")
    if (current.isSymbolicLink()) {
        const recoveryPath = moveBindSymlinkToRecovery(state.bindDir, current)
        fs.mkdirSync(state.bindDir, {mode: 0o700})
        current = fs.lstatSync(state.bindDir)
        if (current.isSymbolicLink() || !current.isDirectory()) {
            throw new Error("Control bind namespace guard is invalid")
        }
        checkOwner(current, "Control bind namespace")
        state.bindDirectoryIdentity = current
        fs.chmodSync(state.bindDir, 0o500)
        const protectedDirectory = fs.lstatSync(state.bindDir)
        if (
            protectedDirectory.isSymbolicLink() || !protectedDirectory.isDirectory() ||
            !sameFile(protectedDirectory, current) ||
            (protectedDirectory.mode & 0o777) !== 0o500
        ) throw new Error("Control bind namespace changed while protecting native close")
        checkOwner(protectedDirectory, "Control bind namespace")
        throw bindRecoveryError(recoveryPath)
    }
    if (!current.isDirectory()) {
        throw new Error("Control bind namespace is unsafe for native close")
    }
    checkOwner(current, "Control bind namespace")
    fs.chmodSync(state.bindDir, 0o500)
    const protectedDirectory = fs.lstatSync(state.bindDir)
    if (
        protectedDirectory.isSymbolicLink() || !protectedDirectory.isDirectory() ||
        !sameFile(protectedDirectory, current) ||
        (protectedDirectory.mode & 0o777) !== 0o500
    ) throw new Error("Control bind namespace changed while protecting native close")
    checkOwner(protectedDirectory, "Control bind namespace")
}

async function cleanupServerSocketPaths({
    bindDir,
    bindDirectoryIdentity,
    socketPath,
    socketIdentity,
    publicPublished,
}) {
    const errors = []
    if (publicPublished && socketPath && socketIdentity) {
        try {
            await cleanupSocketPath(socketPath, socketIdentity, "public")
        } catch (error) {
            errors.push(error)
        }
    }
    if (bindDir && bindDirectoryIdentity) {
        try {
            await cleanupBindNamespace(bindDir, bindDirectoryIdentity, socketIdentity)
        } catch (error) {
            errors.push(error)
        }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
        throw new AggregateError(errors, "Control socket path cleanup failed")
    }
}

function ensureServerIsOpen(state) {
    if (state.closed) throw new Error("Control socket server is closed")
}

async function stopAndCleanupServer(state) {
    const errors = []
    for (const socket of state.connections) socket.destroy()
    state.connections.clear()
    try {
        protectBindNamespaceForNativeClose(state)
    } catch (error) {
        errors.push(error)
    }
    try {
        await closeListeningServer(state.server)
    } catch (error) {
        errors.push(error)
    }
    try {
        await cleanupServerSocketPaths(state)
    } catch (error) {
        if (error instanceof AggregateError) errors.push(...error.errors)
        else errors.push(error)
    }
    if (errors.length > 0) {
        throw new AggregateError(
            errors,
            errors.map((error) => error?.message ?? String(error)).join("; "),
        )
    }
}

function serializeResponse(response, method) {
    let line
    try {
        line = `${JSON.stringify(response)}\n`
    } catch {
        line = `${JSON.stringify({
            id: response.id,
            error: publicControlError(null),
        })}\n`
    }
    if (Buffer.byteLength(line, "utf8") - 1 <= MAX_CONTROL_MESSAGE_BYTES) {
        return {line, bytes: Buffer.byteLength(line, "utf8")}
    }
    if (!Object.hasOwn(response, "result")) return null
    let boundedError
    try {
        boundedError = publicControlError(createPublicControlError("INVALID_RESULT", {
            details: {method, issues: [{path: ["limit"]}]},
        }))
    } catch {
        boundedError = publicControlError(null)
    }
    line = `${JSON.stringify({id: response.id, error: boundedError})}\n`
    const bytes = Buffer.byteLength(line, "utf8")
    if (bytes - 1 > MAX_CONTROL_MESSAGE_BYTES) return null
    return {line, bytes}
}

function attachControlSocketConnection(socket, controlPlane, {
    maxInFlightRequests = DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    maxQueuedResponses = DEFAULT_MAX_QUEUED_RESPONSES,
    maxQueuedResponseBytes = DEFAULT_MAX_QUEUED_RESPONSE_BYTES,
} = {}) {
    if (
        !Number.isSafeInteger(maxInFlightRequests) || maxInFlightRequests < 1 ||
        !Number.isSafeInteger(maxQueuedResponses) || maxQueuedResponses < 1 ||
        !Number.isSafeInteger(maxQueuedResponseBytes) || maxQueuedResponseBytes < 1
    ) throw new TypeError("Control socket connection limits must be positive integers")

    const state = {
        inFlight: 0,
        paused: false,
        outputBackpressured: false,
        responseQueue: [],
        responseQueueBytes: 0,
        closed: false,
    }
    const pause = () => {
        if (state.closed || state.paused) return
        state.paused = true
        socket.pause()
    }
    const close = () => {
        if (state.closed) return
        state.closed = true
        state.responseQueue.length = 0
        state.responseQueueBytes = 0
        if (!socket.destroyed) socket.destroy()
    }
    const maybeResume = () => {
        if (
            state.closed || socket.destroyed || !state.paused ||
            state.inFlight >= maxInFlightRequests ||
            state.outputBackpressured || state.responseQueue.length > 0
        ) return
        if (!decoder.resume()) return
        state.paused = false
        socket.resume()
    }
    const writeLine = (line) => {
        if (state.closed || socket.destroyed || !socket.writable) return false
        try {
            const accepted = socket.write(line, (error) => {
                if (error) close()
            })
            if (!accepted) {
                state.outputBackpressured = true
                pause()
            }
            return true
        } catch {
            close()
            return false
        }
    }
    const send = (response, method) => {
        if (state.closed || socket.destroyed) return
        const serialized = serializeResponse(response, method)
        if (!serialized) {
            close()
            return
        }
        const {line, bytes} = serialized
        if (state.outputBackpressured || state.responseQueue.length > 0) {
            if (
                state.responseQueue.length >= maxQueuedResponses ||
                state.responseQueueBytes + bytes > maxQueuedResponseBytes
            ) {
                close()
                return
            }
            state.responseQueue.push(serialized)
            state.responseQueueBytes += bytes
            return
        }
        writeLine(line)
    }
    const settle = (response, method) => {
        if (state.closed) return
        state.inFlight -= 1
        send(response, method)
        maybeResume()
    }
    const decoder = new JsonLineDecoder(
        (message) => {
            if (state.closed || socket.destroyed) return
            const request = parseRequest(message)
            if (!request) {
                close()
                return
            }
            state.inFlight += 1
            Promise.resolve()
                .then(() => controlPlane.invoke(request.invocation))
                .then(
                    (result) => settle(
                        {id: request.id, result},
                        request.invocation.method,
                    ),
                    (error) => settle(
                        {id: request.id, error: publicControlError(error)},
                        request.invocation.method,
                    ),
                )
                .catch(close)
            if (state.inFlight >= maxInFlightRequests) {
                pause()
                return false
            }
            return true
        },
        close,
        {maximumBufferBytes: MAX_CONTROL_MESSAGE_BYTES},
    )
    const onData = (chunk) => {
        if (!decoder.push(chunk)) pause()
    }
    const onDrain = () => {
        if (state.closed) return
        state.outputBackpressured = false
        while (!state.outputBackpressured && state.responseQueue.length > 0) {
            const {line, bytes} = state.responseQueue.shift()
            state.responseQueueBytes -= bytes
            if (!writeLine(line)) return
        }
        maybeResume()
    }
    const onClose = () => {
        state.closed = true
        state.responseQueue.length = 0
        state.responseQueueBytes = 0
    }
    socket.on("data", onData)
    socket.on("drain", onDrain)
    socket.on("error", close)
    socket.once("close", onClose)
    return {close}
}

class ControlSocketServer {
    constructor({userData, controlDir, controlPlane} = {}) {
        stateByServer.set(this, {
            userData,
            configuredControlDir: controlDir,
            controlPlane,
            server: null,
            socketPath: null,
            bindDir: null,
            bindPath: null,
            bindDirectoryIdentity: null,
            socketIdentity: null,
            publicPublished: false,
            connections: new Set(),
            startPromise: null,
            closePromise: null,
            closed: false,
        })
    }

    get socketPath() {
        return stateByServer.get(this).socketPath
    }

    get connectionCount() {
        return stateByServer.get(this).connections.size
    }

    start() {
        const state = stateByServer.get(this)
        if (state.closed) return Promise.reject(new Error("Control socket server is closed"))
        if (state.startPromise) return state.startPromise
        state.startPromise = this.#start(state)
        return state.startPromise
    }

    async #start(state) {
        ensureServerIsOpen(state)
        if (!state.controlPlane || typeof state.controlPlane.invoke !== "function") {
            throw new Error("A control plane is required")
        }
        const layout = await prepareControlDirectory(
            state.userData,
            state.configuredControlDir,
            () => ensureServerIsOpen(state),
        )
        ensureServerIsOpen(state)
        state.socketPath = layout.socketPath
        assertControlSocketLayoutWithinBudget(layout.controlDir, state.socketPath)
        ensureServerIsOpen(state)
        await recoverPublicSockets(layout.controlDir, () => ensureServerIsOpen(state))
        ensureServerIsOpen(state)
        await recoverBindNamespaces(layout.controlDir, () => ensureServerIsOpen(state))
        ensureServerIsOpen(state)
        await removeStaleSocket(state.socketPath, () => ensureServerIsOpen(state))
        ensureServerIsOpen(state)

        try {
            ensureServerIsOpen(state)
            const namespace = createBindNamespace(
                layout.controlDir,
                () => ensureServerIsOpen(state),
            )
            state.bindDir = namespace.bindDir
            state.bindPath = namespace.bindPath
            state.bindDirectoryIdentity = namespace.bindDirectoryIdentity
            ensureServerIsOpen(state)

            const server = net.createServer((socket) => this.#accept(state, socket))
            state.server = server
            server.on("error", () => {})
            await listenAtPath(server, state.bindPath)

            const boundStat = fs.lstatSync(state.bindPath)
            if (!boundStat.isSocket()) throw new Error("Control bind path is not a socket")
            checkOwner(boundStat, "Control bind socket")
            state.socketIdentity = boundStat
            ensureServerIsOpen(state)

            fs.chmodSync(state.bindDir, 0o500)
            const protectedDirectory = fs.lstatSync(state.bindDir)
            if (
                protectedDirectory.isSymbolicLink() || !protectedDirectory.isDirectory() ||
                !sameFile(protectedDirectory, state.bindDirectoryIdentity)
            ) {
                throw new Error("Control bind namespace changed while becoming read-only")
            }
            checkOwner(protectedDirectory, "Control bind namespace")
            if ((protectedDirectory.mode & 0o777) !== 0o500) {
                throw new Error("Control bind namespace must remain read-only while listening")
            }
            ensureServerIsOpen(state)

            await fs.promises.chmod(state.bindPath, 0o600)
            ensureServerIsOpen(state)
            const securedStat = await fs.promises.lstat(state.bindPath)
            ensureServerIsOpen(state)
            if (!securedStat.isSocket() || !sameFile(securedStat, boundStat)) {
                throw new Error("Control bind socket changed while securing permissions")
            }
            checkOwner(securedStat, "Control bind socket")
            if ((securedStat.mode & 0o777) !== 0o600) {
                throw new Error("Control bind socket permissions are not private")
            }
            state.socketIdentity = securedStat

            ensureServerIsOpen(state)
            try {
                fs.linkSync(state.bindPath, state.socketPath)
            } catch (error) {
                throw new Error("Control socket publish failed without replacing its path", {
                    cause: error,
                })
            }
            state.publicPublished = true
            ensureServerIsOpen(state)
            const publicStat = await fs.promises.lstat(state.socketPath)
            ensureServerIsOpen(state)
            if (!publicStat.isSocket() || !sameFile(publicStat, securedStat)) {
                throw new Error("Published control socket changed identity")
            }
            checkOwner(publicStat, "Published control socket")
            if ((publicStat.mode & 0o777) !== 0o600) {
                throw new Error("Published control socket permissions are not private")
            }

            const retainedSocket = await fs.promises.lstat(state.bindPath)
            ensureServerIsOpen(state)
            if (!retainedSocket.isSocket() || !sameFile(retainedSocket, securedStat)) {
                throw new Error("Control bind socket changed after publication")
            }

            const retainedDirectory = await fs.promises.lstat(state.bindDir)
            ensureServerIsOpen(state)
            if (
                retainedDirectory.isSymbolicLink() || !retainedDirectory.isDirectory() ||
                !sameFile(retainedDirectory, state.bindDirectoryIdentity)
            ) {
                throw new Error("Control bind namespace changed after publication")
            }
            checkOwner(retainedDirectory, "Control bind namespace")
            if ((retainedDirectory.mode & 0o777) !== 0o500) {
                throw new Error("Control bind namespace must remain read-only while listening")
            }
            ensureServerIsOpen(state)
            return this
        } catch (error) {
            let cleanupError = null
            try {
                await stopAndCleanupServer(state)
            } catch (caught) {
                cleanupError = caught
            }
            if (cleanupError) {
                throw new AggregateError(
                    [error, cleanupError],
                    "Control socket startup and cleanup failed",
                )
            }
            throw error
        }
    }

    #accept(state, socket) {
        if (state.closed) {
            socket.destroy()
            return
        }
        state.connections.add(socket)
        socket.once("close", () => state.connections.delete(socket))
        attachControlSocketConnection(socket, state.controlPlane)
    }

    close() {
        const state = stateByServer.get(this)
        if (state.closePromise) return state.closePromise
        state.closed = true
        state.closePromise = this.#close(state)
        return state.closePromise
    }

    async #close(state) {
        if (state.startPromise) {
            try {
                await state.startPromise
            } catch {
                // Startup owns its cleanup; close retries it below for idempotence.
            }
        }
        await stopAndCleanupServer(state)
    }
}

module.exports = {
    CONTROL_SOCKET_BIND_DIRECTORY_PREFIX,
    CONTROL_SOCKET_BIND_NAME,
    CONTROL_SOCKET_BIND_RECOVERY_PREFIX,
    CONTROL_SOCKET_DIRECTORY,
    CONTROL_SOCKET_NAME,
    CONTROL_SOCKET_CLOSE_QUARANTINE_PREFIX,
    CONTROL_SOCKET_PUBLIC_RECOVERY_PREFIX,
    CONTROL_SOCKET_QUARANTINE_PREFIX,
    DEFAULT_MAX_IN_FLIGHT_REQUESTS,
    DEFAULT_MAX_QUEUED_RESPONSES,
    DEFAULT_MAX_QUEUED_RESPONSE_BYTES,
    MAX_CONTROL_BIND_DIRECTORY_ATTEMPTS,
    MAX_CONTROL_MESSAGE_BYTES,
    MAX_CONTROL_REQUEST_ID_LENGTH,
    MAX_CONTROL_SOCKET_PATH_BYTES,
    ControlSocketServer,
    attachControlSocketConnection,
}
