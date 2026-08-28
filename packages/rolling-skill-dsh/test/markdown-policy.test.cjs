const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {safeMarkdownLink} = require("../src/client/workbench/markdown-policy.cjs")

describe("Case Markdown policy", () => {
    it("allows only explicit web, mail, and same-document links", () => {
        assert.equal(safeMarkdownLink("https://example.com/path"), "https://example.com/path")
        assert.equal(safeMarkdownLink("http://example.com"), "http://example.com")
        assert.equal(safeMarkdownLink("mailto:test@example.com"), "mailto:test@example.com")
        assert.equal(safeMarkdownLink("#criterion-r1"), "#criterion-r1")
    })

    it("rejects executable, embedded, local-file, protocol-relative, and relative links", () => {
        assert.equal(safeMarkdownLink("javascript:alert(1)"), null)
        assert.equal(safeMarkdownLink("data:text/html,bad"), null)
        assert.equal(safeMarkdownLink("file:///tmp/private"), null)
        assert.equal(safeMarkdownLink("//example.com"), null)
        assert.equal(safeMarkdownLink("../private"), null)
        assert.equal(safeMarkdownLink(""), null)
    })
})
