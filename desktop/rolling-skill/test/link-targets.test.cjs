const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {requireLocalPath, requireWebUrl} = require("../src/link-targets.cjs")

describe("safe message link targets", () => {
    it("accepts only HTTP and HTTPS external URLs", () => {
        assert.equal(requireWebUrl("https://openai.com/docs?q=1"), "https://openai.com/docs?q=1")
        assert.equal(requireWebUrl("http://localhost:3000"), "http://localhost:3000/")
        assert.throws(() => requireWebUrl("javascript:alert(1)"), /HTTP or HTTPS/i)
        assert.throws(() => requireWebUrl("file:///etc/passwd"), /HTTP or HTTPS/i)
    })

    it("accepts absolute local paths and separates an optional line number", () => {
        assert.deepEqual(requireLocalPath("/Users/example/project/app.js:42"), {
            path: "/Users/example/project/app.js",
            line: 42,
        })
        assert.deepEqual(requireLocalPath("/Users/example/My Project/README.md"), {
            path: "/Users/example/My Project/README.md",
            line: null,
        })
        assert.throws(() => requireLocalPath("../README.md"), /absolute/i)
    })
})
