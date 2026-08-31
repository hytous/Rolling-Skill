const assert = require("node:assert/strict")
const {existsSync} = require("node:fs")
const {join} = require("node:path")
const {describe, it} = require("node:test")

const modelPath = join(__dirname, "../src/client/workbench/dataset-view-model.cjs")

describe("Dataset workbench view model", () => {
    it("shows a managed Skill name only once when its repository has the same display name", () => {
        assert.equal(existsSync(modelPath), true, "Dataset option label model should exist")
        const {managedSkillOptionLabel} = require(modelPath)
        const skill = {id: "skill-a", repositoryId: "repo-a", name: "incident-response-planner"}

        assert.equal(
            managedSkillOptionLabel(skill, [{id: "repo-a", displayName: "incident-response-planner"}]),
            "incident-response-planner",
        )
        assert.equal(
            managedSkillOptionLabel(skill, [{id: "repo-a", displayName: "operations-skills"}]),
            "incident-response-planner · operations-skills",
        )
    })
})
