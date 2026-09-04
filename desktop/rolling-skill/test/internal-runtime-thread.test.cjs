const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    classifyInternalRuntimePrompt,
    classifyInternalRuntimeThread,
} = require("../src/internal-runtime-thread.cjs")

describe("internal Runtime task classification", () => {
    it("recognizes orphaned App-owned tasks from strict generated prompt prefixes", () => {
        assert.equal(classifyInternalRuntimeThread({
            id: "orphan-refresh",
            preview: "Re-execute the immutable evaluation question below with the current Skill and current\n" +
                "tools. The historical Case is guidance only.",
        }), "case-refresh")
        assert.equal(classifyInternalRuntimePrompt(
            "You are running one managed Skill installation Job.\nPerform path discovery.",
        ), "skill-installation")
        assert.equal(classifyInternalRuntimePrompt(
            "You are running one bounded Skill optimization installation Job.\nPerform path discovery.",
        ), "skill-installation")
    })

    it("recognizes provider command wrappers without matching ordinary human discussion", () => {
        assert.equal(classifyInternalRuntimePrompt(
            "/task generated-wrapper\nYou are the Rubric Agent for one Skill evaluation dataset.",
        ), "rubric")
        assert.equal(classifyInternalRuntimePrompt(
            "请解释这句话：Re-execute the immutable evaluation question below with the current Skill and current tools.",
        ), null)
        assert.equal(classifyInternalRuntimeThread({
            id: "human-task",
            preview: "Rolling Skill 的评测为什么失败？",
        }), null)
    })
})
