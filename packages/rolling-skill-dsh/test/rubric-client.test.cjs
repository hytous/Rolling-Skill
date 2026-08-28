const assert = require("node:assert/strict")
const {readFileSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const root = join(__dirname, "../src/client/workbench")
const source = (file) => readFileSync(join(root, file), "utf8")

describe("DSH Rubric workbench", () => {
    it("covers create, review, model, effort, retry, publish, discard, and history", () => {
        const panel = source("RubricPanel.tsx")
        const view = source("RubricSessionView.tsx")
        const combined = `${panel}\n${view}`

        for (const method of [
            "rubrics.list", "rubrics.get", "rubrics.create", "rubrics.send",
            "rubrics.retry", "rubrics.model", "rubrics.effort", "rubrics.publish",
            "rubrics.discard",
        ]) assert.match(combined, new RegExp(method.replace(".", "\\."), "u"))
        assert.match(panel, /active/u)
        assert.match(panel, /versions/u)
        assert.match(panel, /RubricVersionCard/u)
        assert.match(panel, /rubricDigest/u)
        assert.match(panel, /automaticFailures/u)
        assert.match(panel, /scoringAnchors/u)
        assert.match(panel, /operationEvidence/u)
        assert.match(view, /expectedRevision/u)
        assert.match(view, /idempotencyKey/u)
        assert.match(view, /scoringModel/u)
        assert.match(view, /criteria/u)
        assert.doesNotMatch(combined, /(?:path|destination|executablePath)\s*:/u)
        assert.doesNotMatch(panel, /<pre>\{JSON\.stringify/u)
    })
})
