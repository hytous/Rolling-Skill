const assert = require("node:assert/strict")
const {createServer} = require("node:http")
const {once} = require("node:events")
const {afterEach, describe, it} = require("node:test")

const servers = new Set()

async function serve(handler) {
    const server = createServer(handler)
    servers.add(server)
    server.listen(0, "127.0.0.1")
    await once(server, "listening")
    return `http://127.0.0.1:${server.address().port}`
}

async function request(handler, {method = "POST", headers = {}, body = ""} = {}) {
    const origin = await serve(handler)
    const response = await fetch(`${origin}/rolling-skill/api`, {
        method,
        headers,
        ...(method === "GET" || method === "HEAD" ? {} : {body}),
    })
    return {
        status: response.status,
        headers: response.headers,
        text: await response.text(),
    }
}

afterEach(async () => {
    await Promise.all([...servers].map((server) => new Promise((resolve) =>
        server.close(resolve),
    )))
    servers.clear()
})

describe("Rolling Skill Host JSON API", () => {
    it("dispatches bounded JSON requests and returns a no-store envelope", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const calls = []
        const handler = createRollingSkillApiHandler({
            dispatch: async (method, input) => {
                calls.push({method, input})
                return {datasets: 2}
            },
        })

        const response = await request(handler, {
            headers: {"content-type": "application/json; charset=utf-8"},
            body: JSON.stringify({method: "dashboard.get", input: {}}),
        })

        assert.equal(response.status, 200)
        assert.equal(response.headers.get("cache-control"), "no-store")
        assert.deepEqual(JSON.parse(response.text), {ok: true, value: {datasets: 2}})
        assert.deepEqual(calls, [{method: "dashboard.get", input: {}}])
    })

    it("rejects wrong methods, media types, malformed JSON, and oversized bodies", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const handler = createRollingSkillApiHandler({dispatch: async () => ({})})

        const wrongMethod = await request(handler, {method: "GET"})
        assert.equal(wrongMethod.status, 405)
        assert.equal(wrongMethod.headers.get("allow"), "POST")

        const wrongType = await request(handler, {
            headers: {"content-type": "text/plain"},
            body: "{}",
        })
        assert.equal(wrongType.status, 415)

        const malformed = await request(handler, {
            headers: {"content-type": "application/json"},
            body: "{",
        })
        assert.equal(malformed.status, 400)
        assert.deepEqual(JSON.parse(malformed.text), {
            ok: false,
            error: {code: "INVALID_REQUEST", message: "Request is invalid"},
        })

        const oversized = await request(handler, {
            headers: {"content-type": "application/json"},
            body: JSON.stringify({method: "dashboard.get", input: {text: "x".repeat(1024 * 1024)}}),
        })
        assert.equal(oversized.status, 413)
        assert.equal(JSON.parse(oversized.text).error.code, "REQUEST_TOO_LARGE")
    })

    it("refuses cross-origin requests and projects internal failures safely", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const handler = createRollingSkillApiHandler({
            dispatch: async () => {
                throw new Error("token=secret at /private/rolling-skill/config.json")
            },
        })

        const crossOrigin = await request(handler, {
            headers: {
                "content-type": "application/json",
                origin: "https://attacker.example",
            },
            body: JSON.stringify({method: "dashboard.get", input: {}}),
        })
        assert.equal(crossOrigin.status, 403)
        assert.equal(JSON.parse(crossOrigin.text).error.code, "FORBIDDEN")

        const failed = await request(handler, {
            headers: {"content-type": "application/json"},
            body: JSON.stringify({method: "dashboard.get", input: {}}),
        })
        assert.equal(failed.status, 500)
        assert.deepEqual(JSON.parse(failed.text), {
            ok: false,
            error: {code: "INTERNAL_ERROR", message: "Rolling Skill request failed"},
        })
        assert.doesNotMatch(failed.text, /secret|private|config\.json/u)
    })

    it("returns an actionable capture prerequisite instead of masking it as an internal failure", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const handler = createRollingSkillApiHandler({dispatch: async () => {throw new Error("Trusted DSH source Skill evidence is required before curation")}})
        const result = await request(handler, {headers: {"content-type": "application/json"}, body: JSON.stringify({method: "conversation.curation.create", input: {}})})
        assert.equal(result.status, 409)
        assert.equal(JSON.parse(result.text).error.code, "CAPTURE_SKILL_CONTEXT_MISSING")
        assert.match(JSON.parse(result.text).error.message, /Skill/)
    })

    it("classifies hostile conversation fields as invalid without exposing details", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const handler = createRollingSkillApiHandler({
            dispatch: async () => {
                throw new Error("Unsupported conversation curation field: snapshotPath=/private")
            },
        })

        const response = await request(handler, {
            headers: {"content-type": "application/json"},
            body: JSON.stringify({
                method: "conversationCuration.create",
                input: {snapshotPath: "/private"},
            }),
        })

        assert.equal(response.status, 400)
        assert.deepEqual(JSON.parse(response.text), {
            ok: false,
            error: {code: "INVALID_REQUEST", message: "Request is invalid"},
        })
        assert.doesNotMatch(response.text, /snapshotPath|private/u)
    })

    it("returns actionable edit conflicts without exposing internal paths", async () => {
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        const handler = createRollingSkillApiHandler({
            dispatch: async () => {
                const error = new Error("changed at /private/rolling-skill/repositories/secret")
                error.code = "RESOURCE_CHANGED"
                throw error
            },
        })

        const response = await request(handler, {
            headers: {"content-type": "application/json"},
            body: JSON.stringify({method: "skillEdits.applyAndRelease", input: {}}),
        })

        assert.equal(response.status, 409)
        assert.deepEqual(JSON.parse(response.text), {
            ok: false,
            error: {code: "RESOURCE_CHANGED", message: "The Skill changed. Refresh before continuing."},
        })
        assert.doesNotMatch(response.text, /private|repositories|secret/u)
    })

    it("does not dispatch an already-aborted request", async () => {
        const {PassThrough} = require("node:stream")
        const {createRollingSkillApiHandler} = require("../src/host/api.cjs")
        let calls = 0
        const handler = createRollingSkillApiHandler({
            dispatch: async () => {
                calls += 1
                return {}
            },
        })
        const requestStream = new PassThrough()
        requestStream.method = "POST"
        requestStream.headers = {"content-type": "application/json", host: "127.0.0.1"}
        requestStream.aborted = true
        const response = {
            destroyed: false,
            headersSent: false,
            setHeader() {},
            end() {
                throw new Error("An aborted request must not write a response")
            },
        }

        await handler(requestStream, response)
        assert.equal(calls, 0)
    })
})
