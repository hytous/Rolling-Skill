const assert = require("node:assert/strict")
const {createServer} = require("node:http")
const {after, before, describe, it} = require("node:test")

const {isHttpReady} = require("../src/runtime-controller.cjs")

function listen(server) {
    return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
}

function close(server) {
    return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
    )
}

describe("runtime HTTP readiness", () => {
    let primary
    let other
    let primaryOrigin
    let otherOrigin

    before(async () => {
        other = createServer((_request, response) => {
            response.writeHead(204)
            response.end()
        })
        await listen(other)
        otherOrigin = `http://127.0.0.1:${other.address().port}`

        primary = createServer((request, response) => {
            if (request.url === "/same-origin") {
                response.writeHead(302, {location: "/ready"})
            } else if (request.url === "/cross-origin") {
                response.writeHead(302, {location: `${otherOrigin}/ready`})
            } else {
                response.writeHead(204)
            }
            response.end()
        })
        await listen(primary)
        primaryOrigin = `http://127.0.0.1:${primary.address().port}`
    })

    after(async () => {
        await Promise.all([close(primary), close(other)])
    })

    it("accepts a healthy response and same-origin redirect", async () => {
        assert.equal(await isHttpReady(`${primaryOrigin}/ready`), true)
        assert.equal(await isHttpReady(`${primaryOrigin}/same-origin`), true)
    })

    it("does not follow a health redirect to another origin", async () => {
        assert.equal(await isHttpReady(`${primaryOrigin}/cross-origin`), false)
    })
})
