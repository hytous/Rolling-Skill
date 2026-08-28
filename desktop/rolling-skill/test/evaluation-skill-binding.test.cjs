const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    resolveExecutedSkillEvidenceBinding,
    resolveSkillEvidenceBinding,
    runtimeReportsSkill,
} = require("../src/evaluation-skill-binding.cjs")
const {skillContentDigest} = require("../src/skill-content.cjs")

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
        assert.equal(runtimeReportsSkill({
            data: [{skills: [{name: skillReference.name, enabled: true, evidencePrecision: "name-only"}]}],
        }, skillReference, {allowNameOnly: true}), true)
        assert.equal(runtimeReportsSkill({
            data: [{skills: [{name: skillReference.name, enabled: true, evidencePrecision: "name-only"}]}],
        }, skillReference), false)
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

    it("promotes a provider without Skill inventory when Trace proves the exact Skill content", () => {
        const content = "---\nname: billing-cost-management\ndescription: costs\n---\n\n# Billing\nUse CLI.\n"
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "unverified",
            skillReference,
            skillEvidence: {files: [{path: "SKILL.md", content}]},
            traceEvidence: {entries: [{
                sequence: 12,
                message: {params: {update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: "skill-1",
                    rawInput: {skill: "billing-cost-management"},
                    skillContentDigest: skillContentDigest(content),
                }}},
            }]},
        })

        assert.deepEqual(binding, {
            declaredBinding: "unverified",
            observedBinding: "matched",
            effectiveBinding: "verified-by-trace",
            skillName: "billing-cost-management",
            expectedContentDigest: skillContentDigest(content),
            observedContentDigest: skillContentDigest(content),
            evidenceSequences: [12],
        })
    })

    it("does not trust a matching Skill name when the executed content differs", () => {
        const content = "---\nname: billing-cost-management\n---\n\n# Frozen body\n"
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "unverified",
            skillReference,
            skillEvidence: {files: [{path: "SKILL.md", content}]},
            traceEvidence: {entries: [{
                sequence: 20,
                message: {params: {update: {
                    rawInput: {skill: "billing-cost-management"},
                    skillContentDigest: skillContentDigest("# Different body\n"),
                }}},
            }]},
        })

        assert.equal(binding.observedBinding, "mismatched")
        assert.equal(binding.effectiveBinding, "unverified")
    })

    it("keeps declared inventory binding separate when no Skill execution is observable", () => {
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "verified",
            skillReference,
            skillEvidence: {files: [{path: "SKILL.md", content: "# Billing\n"}]},
            traceEvidence: {entries: []},
        })

        assert.equal(binding.declaredBinding, "verified")
        assert.equal(binding.observedBinding, "not_observed")
        assert.equal(binding.effectiveBinding, "verified")
    })

    it("verifies DeepSeek Harness explicit Skill injection from its runtime-provided body", () => {
        const content = "---\nname: billing-cost-management\n---\n\n# Billing\nUse CLI.\n"
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "unverified",
            skillReference,
            skillEvidence: {files: [{path: "SKILL.md", content}]},
            traceEvidence: {entries: [{
                sequence: 31,
                message: {params: {event: {
                    type: "user/message",
                    data: {
                        source: {kind: "skill-invocation", name: skillReference.name},
                        content: [{
                            type: "text",
                            text: `<skill_content name="${skillReference.name}">\n<skill_resources>\nBase directory for this skill: /runtime/skills/billing-cost-management\n</skill_resources>\n\n<skill_instructions>\n# Billing\nUse CLI.\n</skill_instructions>\n</skill_content>`,
                        }],
                    },
                }}},
            }]},
        })

        assert.equal(binding.observedBinding, "matched")
        assert.equal(binding.effectiveBinding, "verified-by-trace")
        assert.equal(binding.observedContentDigest, skillContentDigest(content))
        assert.deepEqual(binding.evidenceSequences, [31])
    })

    it("keeps DeepSeek Harness injection name-only when the runtime body is absent", () => {
        const binding = resolveExecutedSkillEvidenceBinding({
            declaredBinding: "unverified",
            skillReference,
            skillEvidence: {files: [{path: "SKILL.md", content: "# Billing\n"}]},
            traceEvidence: {entries: [{
                sequence: 32,
                message: {params: {event: {
                    type: "user/message",
                    data: {source: {kind: "skill-invocation", name: skillReference.name}},
                }}},
            }]},
        })

        assert.equal(binding.observedBinding, "name_only")
        assert.equal(binding.effectiveBinding, "unverified")
    })
})
