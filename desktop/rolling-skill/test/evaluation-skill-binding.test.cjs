const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
} = require("../src/evaluation-skill-binding.cjs")

describe("evaluation Skill binding", () => {
    const skillReference = {
        name: "billing-cost-management",
        path: "/skills/billing-cost-management/SKILL.md",
    }

    it("requires an enabled exact name and absolute path match", () => {
        assert.equal(runtimeReportsSkill({data: [{skills: [{...skillReference, enabled: true}]}]}, skillReference), true)
        assert.equal(runtimeReportsSkill({data: [{skills: [{...skillReference, enabled: false}]}]}, skillReference), false)
        assert.equal(runtimeReportsSkill({data: [{skills: [{...skillReference, name: "other", enabled: true}]}]}, skillReference), false)
        assert.equal(runtimeReportsSkill({data: [{skills: [{...skillReference, path: "/other/SKILL.md", enabled: true}]}]}, skillReference), false)
    })

    it("verifies the selected runtime and downgrades providers without path-precise inventory", async () => {
        const selected = {
            listSkills: async () => ({data: [{skills: [{...skillReference, enabled: true}]}]}),
        }
        let temporaryStops = 0
        const createClient = (descriptor) => ({
            start: async () => {},
            stop: async () => { temporaryStops += 1 },
            ...(descriptor.providerId === "codex"
                ? {listSkills: async () => ({data: [{skills: [{...skillReference, enabled: true}]}]})}
                : {}),
        })

        const bindings = await Promise.all([
            resolveSkillEvidenceBinding({
                descriptor: {runtimeId: "codex:selected", providerId: "codex"},
                selectedRuntimeId: "codex:selected",
                getSelectedRuntime: async () => selected,
                createClient,
                clientOptions: {},
                skillReference,
            }),
            resolveSkillEvidenceBinding({
                descriptor: {runtimeId: "codex:other", providerId: "codex"},
                selectedRuntimeId: "codex:selected",
                getSelectedRuntime: async () => selected,
                createClient,
                clientOptions: {},
                skillReference,
            }),
            resolveSkillEvidenceBinding({
                descriptor: {runtimeId: "codebuddy:one", providerId: "codebuddy"},
                selectedRuntimeId: "codex:selected",
                getSelectedRuntime: async () => selected,
                createClient,
                clientOptions: {},
                skillReference,
            }),
        ])

        assert.deepEqual(bindings, ["verified", "verified", "unverified"])
        assert.equal(temporaryStops, 2)
    })

    it("fails closed to diagnostic and still stops a temporary client when probing fails", async () => {
        let stopped = false
        const binding = await resolveSkillEvidenceBinding({
            descriptor: {runtimeId: "codex:broken", providerId: "codex"},
            selectedRuntimeId: "codex:selected",
            getSelectedRuntime: async () => { throw new Error("must not use selected runtime") },
            createClient: () => ({
                start: async () => {},
                listSkills: async () => { throw new Error("probe failed") },
                stop: async () => { stopped = true },
            }),
            clientOptions: {},
            skillReference,
        })

        assert.equal(binding, "unverified")
        assert.equal(stopped, true)
    })
})
