const {Buffer} = require("node:buffer")

const MAX_BODY_BYTES = 1024 * 1024

class PublicApiError extends Error {
    constructor(status, code, message) {
        super(message)
        this.status = status
        this.code = code
    }
}

function responseAvailable(request, response) {
    return !request.aborted && !response.destroyed && !response.writableEnded
}

function writeJson(request, response, status, value, headers = {}) {
    if (!responseAvailable(request, response)) return
    response.statusCode = status
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.setHeader("cache-control", "no-store")
    for (const [name, headerValue] of Object.entries(headers)) {
        response.setHeader(name, headerValue)
    }
    response.end(JSON.stringify(value))
}

function publicFailure(request, response, error) {
    if (error instanceof PublicApiError) {
        writeJson(request, response, error.status, {
            ok: false,
            error: {code: error.code, message: error.message},
        })
        return
    }
    const publicCodes = {
        RESOURCE_CHANGED: {status: 409, message: "The Skill changed. Refresh before continuing."},
        NO_CHANGES: {status: 409, message: "The Skill edit has no changes to apply."},
        NEEDS_RECOVERY: {status: 409, message: "The Skill edit needs recovery before it can continue."},
        NOT_FOUND: {status: 404, message: "The requested Rolling Skill resource was not found."},
    }
    const publicCode = typeof error?.code === "string" ? publicCodes[error.code] : null
    if (publicCode) {
        writeJson(request, response, publicCode.status, {
            ok: false,
            error: {code: error.code, message: publicCode.message},
        })
        return
    }
    const message = String(error?.message ?? "")
    if (
        message.startsWith("Unknown Rolling Skill method") ||
        message.startsWith("Unsupported conversation curation field") ||
        message.includes("must be plain JSON") ||
        message.includes("must not exceed 1 MiB")
    ) {
        writeJson(request, response, 400, {
            ok: false,
            error: {code: "INVALID_REQUEST", message: "Request is invalid"},
        })
        return
    }
    writeJson(request, response, 500, {
        ok: false,
        error: {code: "INTERNAL_ERROR", message: "Rolling Skill request failed"},
    })
}

function assertSameOrigin(request) {
    const origin = String(request.headers.origin ?? "").trim()
    if (!origin) return
    const authority = String(request.headers.host ?? "").trim().toLocaleLowerCase("en-US")
    let parsed
    try {
        parsed = new URL(origin)
    } catch {
        throw new PublicApiError(403, "FORBIDDEN", "Request origin is not allowed")
    }
    if (
        !authority ||
        !new Set(["http:", "https:"]).has(parsed.protocol) ||
        parsed.host.toLocaleLowerCase("en-US") !== authority
    ) {
        throw new PublicApiError(403, "FORBIDDEN", "Request origin is not allowed")
    }
}

async function readBody(request, maximumBytes) {
    const declaredLength = Number(request.headers["content-length"])
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
        request.resume?.()
        throw new PublicApiError(
            413,
            "REQUEST_TOO_LARGE",
            "Request must not exceed 1 MiB",
        )
    }
    const chunks = []
    let total = 0
    for await (const chunk of request) {
        if (request.aborted) return null
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        total += bytes.length
        if (total > maximumBytes) {
            request.resume?.()
            throw new PublicApiError(
                413,
                "REQUEST_TOO_LARGE",
                "Request must not exceed 1 MiB",
            )
        }
        chunks.push(bytes)
    }
    return request.aborted ? null : Buffer.concat(chunks, total).toString("utf8")
}

function parseEnvelope(source) {
    let envelope
    try {
        envelope = JSON.parse(source)
    } catch {
        throw new PublicApiError(400, "INVALID_REQUEST", "Request is invalid")
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
        throw new PublicApiError(400, "INVALID_REQUEST", "Request is invalid")
    }
    const keys = Object.keys(envelope)
    if (
        keys.some((key) => key !== "method" && key !== "input") ||
        typeof envelope.method !== "string" ||
        !envelope.method.trim() ||
        envelope.method.length > 200 ||
        (Object.hasOwn(envelope, "input") && envelope.input === undefined)
    ) {
        throw new PublicApiError(400, "INVALID_REQUEST", "Request is invalid")
    }
    return {method: envelope.method, input: envelope.input ?? {}}
}

function createRollingSkillApiHandler(application, {maximumBodyBytes = MAX_BODY_BYTES} = {}) {
    if (!application || typeof application.dispatch !== "function") {
        throw new Error("Rolling Skill application dispatch is required")
    }
    return async function rollingSkillApiHandler(request, response) {
        if (request.aborted) return
        response.setHeader("cache-control", "no-store")
        try {
            response.setHeader("allow", "POST")
            if (request.method !== "POST") {
                throw new PublicApiError(405, "METHOD_NOT_ALLOWED", "Only POST is supported")
            }
            const mediaType = String(request.headers["content-type"] ?? "")
                .split(";", 1)[0]
                .trim()
                .toLocaleLowerCase("en-US")
            if (mediaType !== "application/json") {
                throw new PublicApiError(
                    415,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "Content-Type must be application/json",
                )
            }
            assertSameOrigin(request)
            const source = await readBody(request, maximumBodyBytes)
            if (source === null || request.aborted) return
            const {method, input} = parseEnvelope(source)
            const value = await application.dispatch(method, input)
            if (request.aborted) return
            writeJson(request, response, 200, {ok: true, value})
        } catch (error) {
            publicFailure(request, response, error)
        }
    }
}

module.exports = {
    MAX_BODY_BYTES,
    createRollingSkillApiHandler,
}
