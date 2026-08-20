const {
    chmodSync,
    createWriteStream,
    existsSync,
    mkdirSync,
    rmSync,
    symlinkSync,
} = require("node:fs")
const {dirname, isAbsolute, posix, resolve, sep} = require("node:path")
const {pipeline} = require("node:stream/promises")
const {Transform} = require("node:stream")
const yauzl = require("yauzl")

const DEFAULT_ARCHIVE_LIMITS = Object.freeze({
    maxFiles: 10_000,
    maxTotalBytes: 256 * 1024 * 1024,
    maxFileBytes: 32 * 1024 * 1024,
    maxCompressionRatio: 1_000,
})

function normalizedLimits(input = {}) {
    const result = {...DEFAULT_ARCHIVE_LIMITS}
    for (const key of Object.keys(result)) {
        if (input[key] === undefined) continue
        const value = Number(input[key])
        if (!Number.isFinite(value) || value <= 0) throw new Error(`${key} must be positive`)
        result[key] = value
    }
    return result
}

function isContained(root, candidate) {
    return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function normalizedEntryPath(value) {
    if (typeof value !== "string" || !value || value.includes("\0")) {
        throw new Error("ZIP contains an invalid entry name")
    }
    if (value.includes("\\")) throw new Error(`ZIP entry uses an unsafe separator: ${value}`)
    if (value.startsWith("/") || /^[A-Za-z]:\//u.test(value)) {
        throw new Error(`ZIP entry uses an absolute or drive-prefixed path: ${value}`)
    }
    const withoutTrailingSlash = value.replace(/\/+$/u, "")
    const segments = withoutTrailingSlash.split("/")
    if (!withoutTrailingSlash || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new Error(`ZIP entry uses an unsafe relative path: ${value}`)
    }
    const normalized = posix.normalize(withoutTrailingSlash)
    if (normalized === ".." || normalized.startsWith("../")) {
        throw new Error(`ZIP entry escapes the destination: ${value}`)
    }
    return normalized
}

function unixMode(entry) {
    return (entry.externalFileAttributes >>> 16) & 0xffff
}

function entryKind(entry) {
    const mode = unixMode(entry)
    const type = mode & 0o170000
    if (type === 0o120000) return "symlink"
    if (type === 0o040000 || entry.fileName.endsWith("/")) return "directory"
    if (type === 0 || type === 0o100000) return "file"
    throw new Error(`ZIP contains an unsupported special file: ${entry.fileName}`)
}

function openZip(path) {
    return new Promise((resolvePromise, reject) => {
        yauzl.open(
            path,
            {
                lazyEntries: true,
                validateEntrySizes: true,
                strictFileNames: true,
            },
            (error, zip) => error ? reject(error) : resolvePromise(zip),
        )
    })
}

function openEntryStream(zip, entry) {
    return new Promise((resolvePromise, reject) => {
        zip.openReadStream(entry, (error, stream) =>
            error ? reject(error) : resolvePromise(stream),
        )
    })
}

async function readEntryBuffer(zip, entry, maxBytes) {
    const stream = await openEntryStream(zip, entry)
    const chunks = []
    let size = 0
    for await (const chunk of stream) {
        size += chunk.length
        if (size > maxBytes) throw new Error(`ZIP entry exceeds single-file limit: ${entry.fileName}`)
        chunks.push(chunk)
    }
    return Buffer.concat(chunks, size)
}

function decodeLinkTarget(buffer, path) {
    let target
    try {
        target = new TextDecoder("utf-8", {fatal: true}).decode(buffer)
    } catch {
        throw new Error(`ZIP symbolic link target is not valid UTF-8: ${path}`)
    }
    if (!target || target.includes("\0") || isAbsolute(target)) {
        throw new Error(`ZIP symbolic link points outside the extraction root: ${path}`)
    }
    return target
}

async function extractManagedSkillZip(zipPath, destination, inputLimits = {}) {
    const limits = normalizedLimits(inputLimits)
    destination = resolve(destination)
    if (existsSync(destination)) throw new Error("ZIP extraction destination already exists")
    mkdirSync(destination, {recursive: true, mode: 0o700})
    chmodSync(destination, 0o700)
    let zip = null
    try {
        zip = await openZip(zipPath)
        const seen = new Set()
        const files = []
        const deferredLinks = []
        let entryCount = 0
        let fileCount = 0
        let totalBytes = 0

        const completed = new Promise((resolvePromise, reject) => {
            let settled = false
            const fail = (error) => {
                if (settled) return
                settled = true
                reject(error)
            }
            zip.once("error", fail)
            zip.once("end", () => {
                if (settled) return
                settled = true
                resolvePromise()
            })
            zip.on("entry", (entry) => {
                void (async () => {
                    const relativePath = normalizedEntryPath(entry.fileName)
                    entryCount += 1
                    if (entryCount > limits.maxFiles) {
                        throw new Error(`ZIP file count limit exceeded at ${relativePath}`)
                    }
                    if (relativePath.split("/").some((segment) => segment.toLowerCase() === ".git")) {
                        zip.readEntry()
                        return
                    }
                    if (seen.has(relativePath)) throw new Error(`ZIP contains duplicate path: ${relativePath}`)
                    seen.add(relativePath)
                    const kind = entryKind(entry)
                    const absolutePath = resolve(destination, ...relativePath.split("/"))
                    if (!isContained(destination, absolutePath)) {
                        throw new Error(`ZIP entry escapes the destination: ${relativePath}`)
                    }
                    if (kind === "directory") {
                        mkdirSync(absolutePath, {recursive: true, mode: 0o700})
                        chmodSync(absolutePath, 0o700)
                        zip.readEntry()
                        return
                    }
                    fileCount += 1
                    if (entry.uncompressedSize > limits.maxFileBytes) {
                        throw new Error(`ZIP single-file limit exceeded at ${relativePath}`)
                    }
                    if (totalBytes + entry.uncompressedSize > limits.maxTotalBytes) {
                        throw new Error(`ZIP total byte limit exceeded at ${relativePath}`)
                    }
                    const ratio = entry.uncompressedSize === 0
                        ? 0
                        : entry.uncompressedSize / Math.max(1, entry.compressedSize)
                    if (ratio > limits.maxCompressionRatio) {
                        throw new Error(`ZIP compression ratio limit exceeded at ${relativePath}`)
                    }
                    totalBytes += entry.uncompressedSize
                    mkdirSync(dirname(absolutePath), {recursive: true, mode: 0o700})
                    if (kind === "symlink") {
                        const contents = await readEntryBuffer(zip, entry, limits.maxFileBytes)
                        deferredLinks.push({
                            absolutePath,
                            relativePath,
                            target: decodeLinkTarget(contents, relativePath),
                        })
                        files.push(relativePath)
                        zip.readEntry()
                        return
                    }
                    const stream = await openEntryStream(zip, entry)
                    let actualBytes = 0
                    const counter = new Transform({
                        transform(chunk, _encoding, callback) {
                            actualBytes += chunk.length
                            if (actualBytes > entry.uncompressedSize || actualBytes > limits.maxFileBytes) {
                                callback(new Error(`ZIP single-file limit exceeded at ${relativePath}`))
                                return
                            }
                            callback(null, chunk)
                        },
                    })
                    const executable = Boolean(unixMode(entry) & 0o111)
                    const output = createWriteStream(absolutePath, {
                        flags: "wx",
                        mode: executable ? 0o755 : 0o644,
                    })
                    await pipeline(stream, counter, output)
                    chmodSync(absolutePath, executable ? 0o755 : 0o644)
                    files.push(relativePath)
                    zip.readEntry()
                })().catch(fail)
            })
            zip.readEntry()
        })

        await completed
        for (const link of deferredLinks.sort((left, right) =>
            left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
        )) {
            const targetPath = resolve(dirname(link.absolutePath), link.target)
            if (!isContained(destination, targetPath)) {
                throw new Error(`ZIP symbolic link points outside the extraction root: ${link.relativePath}`)
            }
            symlinkSync(link.target, link.absolutePath)
        }
        files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
        return {files, fileCount, entryCount, totalBytes}
    } catch (error) {
        try {
            zip?.close()
        } catch {}
        rmSync(destination, {recursive: true, force: true})
        throw error
    }
}

module.exports = {
    DEFAULT_ARCHIVE_LIMITS,
    extractManagedSkillZip,
}
