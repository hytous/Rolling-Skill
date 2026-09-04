import {gunzipSync} from "node:zlib"
import {readFileSync, statSync} from "node:fs"
import {resolve} from "node:path"
import {fileURLToPath} from "node:url"

const ALLOWED_FILES = new Set([
    "package/package.json",
    "package/README.md",
    "package/cordis.patch.yml",
    "package/lib/index.js",
    "package/lib/client.js",
    "package/lib/worker.cjs",
    "package/lib/rolling-skill-tool",
])
const REQUIRED_FILES = new Set(ALLOWED_FILES)
const DEVELOPER_PATH_PATTERN = /(?:\/(?:Users|home)\/[^/\s"'<>]+\/|\/(?:data\/)?workspace\/|\/private\/var\/folders\/|[A-Za-z]:\\Users\\[^\\\s"'<>]+\\)/iu
const EXPECTED_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version

function tarText(bytes, start, length) {
    const end = bytes.indexOf(0, start)
    return bytes.subarray(start, end >= start && end < start + length ? end : start + length).toString("utf8")
}

function tarSize(bytes, offset) {
    const source = tarText(bytes, offset + 124, 12).trim().replace(/\0+$/u, "")
    if (!/^[0-7]*$/u.test(source)) throw new Error("Package tar header has an invalid size")
    return Number.parseInt(source || "0", 8)
}

function parsePax(body) {
    const values = {}
    let offset = 0
    while (offset < body.length) {
        const space = body.indexOf(0x20, offset)
        if (space < 0) break
        const length = Number(body.subarray(offset, space).toString("ascii"))
        if (!Number.isSafeInteger(length) || length < 3 || offset + length > body.length) {
            throw new Error("Package PAX header is invalid")
        }
        const record = body.subarray(space + 1, offset + length - 1).toString("utf8")
        const equals = record.indexOf("=")
        if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1)
        offset += length
    }
    return values
}

export function readTarGz(path) {
    const archive = gunzipSync(readFileSync(path))
    const entries = new Map()
    let offset = 0
    let pax = null
    let longName = null
    while (offset + 512 <= archive.length) {
        const header = archive.subarray(offset, offset + 512)
        if (header.every((byte) => byte === 0)) break
        const size = tarSize(archive, offset)
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Package entry size is invalid")
        const bodyStart = offset + 512
        const bodyEnd = bodyStart + size
        if (bodyEnd > archive.length) throw new Error("Package tar entry is truncated")
        const type = String.fromCharCode(header[156] || 0x30)
        const prefix = tarText(header, 345, 155)
        const headerName = [prefix, tarText(header, 0, 100)].filter(Boolean).join("/")
        const body = archive.subarray(bodyStart, bodyEnd)
        if (type === "x" || type === "g") pax = parsePax(body)
        else if (type === "L") longName = body.toString("utf8").replace(/\0+$/u, "")
        else {
            const name = pax?.path ?? longName ?? headerName
            pax = null
            longName = null
            if (type === "0" || type === "\0" || type === "") entries.set(name, Buffer.from(body))
            else if (type !== "5") throw new Error(`Package contains unsupported tar entry type ${type}`)
        }
        offset = bodyStart + Math.ceil(size / 512) * 512
    }
    return entries
}

function text(entries, name) {
    const body = entries.get(name)
    if (!body) throw new Error(`Package is missing ${name}`)
    return body.toString("utf8")
}

export function inspectEntries(entries) {
    if (!(entries instanceof Map)) throw new Error("Package entries are invalid")
    for (const name of entries.keys()) {
        if (name.startsWith("/") || name.split("/").includes("..")) {
            throw new Error(`Package entry escapes its archive root: ${name}`)
        }
        if (!ALLOWED_FILES.has(name)) throw new Error(`Package entry is outside the allowlist: ${name}`)
    }
    for (const name of REQUIRED_FILES) {
        if (!entries.has(name)) throw new Error(`Package is missing required entry: ${name}`)
    }
    const manifest = JSON.parse(text(entries, "package/package.json"))
    if (manifest.name !== "@rolling-skill/dsh-plugin" || manifest.version !== EXPECTED_VERSION) {
        throw new Error("Package manifest identity is invalid")
    }
    const combined = [...entries.values()].map((body) => body.toString("utf8")).join("\n")
    if (DEVELOPER_PATH_PATTERN.test(combined)) {
        throw new Error("Package contains an absolute developer path")
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKID|AKIA)[A-Z0-9]{12,}\b/u.test(combined)) {
        throw new Error("Package contains credential material")
    }
    if (/sourceMappingURL=|\.map(?:\?|$)/u.test(combined)) throw new Error("Package contains a source map")
    if ([...entries.keys()].some((name) => /(?:^|\/)(?:Electron Framework|Chromium Framework|electron(?:\.exe)?|chromium(?:\.exe)?|.*\.app)(?:\/|$)/iu.test(name))) {
        throw new Error("Package contains an Electron or Chromium artifact")
    }
    if (!text(entries, "package/lib/client.js").startsWith("window.__ModuleLoader__.load")) {
        throw new Error("Package Client is missing the DSH lazy module wrapper")
    }
    if (!text(entries, "package/lib/worker.cjs").startsWith("#!/usr/bin/env node\n")) {
        throw new Error("Package Worker is not executable")
    }
    if (!text(entries, "package/lib/rolling-skill-tool").startsWith("#!/usr/bin/env node\n")) {
        throw new Error("Package scoped control Tool is not executable")
    }
    return {
        name: manifest.name,
        version: manifest.version,
        fileCount: entries.size,
        packedBytes: null,
        unpackedBytes: [...entries.values()].reduce((sum, body) => sum + body.byteLength, 0),
        files: [...entries.keys()].sort(),
    }
}

export function inspectPackage(path) {
    return {
        ...inspectEntries(readTarGz(path)),
        packedBytes: statSync(path).size,
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const path = process.argv[2]
    if (!path) {
        process.stderr.write("Usage: node inspect-package.mjs <package.tgz>\n")
        process.exitCode = 1
    } else {
        try {
            const report = inspectPackage(resolve(path))
            process.stdout.write(
                `package inspection passed: ${report.fileCount} files, ` +
                `${report.packedBytes} packed bytes, ${report.unpackedBytes} unpacked bytes\n`,
            )
        } catch (error) {
            process.stderr.write(`package inspection failed: ${error.message}\n`)
            process.exitCode = 1
        }
    }
}
