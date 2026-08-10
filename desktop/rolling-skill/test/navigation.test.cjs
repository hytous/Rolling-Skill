const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {classifyNavigation} = require("../src/navigation.cjs")

describe("desktop navigation policy", () => {
    const localOrigin = "http://localhost"

    it("keeps configured loopback routes inside the native window", () => {
        assert.equal(classifyNavigation("http://localhost/w/abc", localOrigin), "internal")
        assert.equal(classifyNavigation("http://localhost/api/health", localOrigin), "internal")
    })

    it("opens only external HTTPS links through the operating system", () => {
        assert.equal(classifyNavigation("https://docs.agenta.ai/guide", localOrigin), "external")
    })

    it("blocks lookalike hosts, scripts, files, and insecure external URLs", () => {
        assert.equal(classifyNavigation("http://localhost.attacker.test/", localOrigin), "blocked")
        assert.equal(classifyNavigation("javascript:alert(1)", localOrigin), "blocked")
        assert.equal(classifyNavigation("file:///etc/passwd", localOrigin), "blocked")
        assert.equal(classifyNavigation("http://example.com/", localOrigin), "blocked")
    })

    it("blocks malformed input", () => {
        assert.equal(classifyNavigation("not a url", localOrigin), "blocked")
    })
})
