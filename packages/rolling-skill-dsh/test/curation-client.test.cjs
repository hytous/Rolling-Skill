const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "../src/client/workbench")
const source = (file) => readFileSync(join(root, file), "utf8")

describe("DSH Curation workbench", () => {
    it("covers active, archived, review, retry, save, discard, and deep links", () => {
        const panel = source("CurationPanel.tsx")
        const view = source("CurationSessionView.tsx")
        const combined = `${panel}\n${view}`

        for (const method of [
            "curation.list", "curation.get", "curation.send", "curation.retry",
            "curation.model", "curation.effort", "curation.save", "curation.discard",
        ]) assert.match(combined, new RegExp(method.replace(".", "\\."), "u"))
        assert.match(panel, /archived:\s*true/u)
        assert.match(panel, /initialSessionId/u)
        assert.match(view, /operationEvidence/u)
        assert.match(view, /observedSkills/u)
        assert.match(view, /expectedRevision/u)
        assert.match(view, /idempotencyKey/u)
        assert.match(view, /rolling-skill:curation-markers-changed/u)
        assert.doesNotMatch(combined, /dangerouslySetInnerHTML/u)
    })
})
