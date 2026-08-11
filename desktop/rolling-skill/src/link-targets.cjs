const {isAbsolute} = require("node:path")

function requireWebUrl(value) {
    let url
    try {
        url = new URL(String(value ?? "").trim())
    } catch {
        throw new Error("Message links must use an HTTP or HTTPS URL")
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Message links must use an HTTP or HTTPS URL")
    }
    return url.toString()
}

function requireLocalPath(value) {
    const input = String(value ?? "").trim()
    const match = input.match(/^(.*):(\d+)$/)
    const path = match ? match[1] : input
    if (!isAbsolute(path)) throw new Error("Message file links must use an absolute path")
    return {path, line: match ? Number(match[2]) : null}
}

module.exports = {requireLocalPath, requireWebUrl}
