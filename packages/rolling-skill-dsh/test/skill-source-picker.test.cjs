const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const modulePath = "../src/host/skill-source-picker.cjs"

describe("DSH Skill source picker", () => {
    it("uses a native folder dialog and returns one absolute local source", async () => {
        const {createNativeSkillSourcePicker} = require(modulePath)
        const calls = []
        const picker = createNativeSkillSourcePicker({
            platform: "darwin",
            run: async (command, args) => {
                calls.push({command, args})
                return {status: "selected", output: "/Users/test/skill-source/\n"}
            },
        })

        assert.equal(await picker("folder"), "/Users/test/skill-source")
        assert.equal(calls[0].command, "osascript")
        assert.match(calls[0].args.join("\n"), /choose folder/u)
    })

    it("uses a native file dialog for ZIP and preserves cancellation", async () => {
        const {createNativeSkillSourcePicker} = require(modulePath)
        const calls = []
        const picker = createNativeSkillSourcePicker({
            platform: "darwin",
            run: async (command, args) => {
                calls.push({command, args})
                return {status: calls.length === 1 ? "selected" : "cancelled", output: "/Users/test/skill.zip\n"}
            },
        })

        assert.equal(await picker("zip"), "/Users/test/skill.zip")
        assert.equal(await picker("local-git"), null)
        assert.match(calls[0].args.join("\n"), /choose file/u)
    })

    it("exposes only local source kinds and delegates every other method", async () => {
        const {createSkillSourceDispatch} = require(modulePath)
        const calls = []
        const application = {
            dispatch: async (method, input) => {
                calls.push({method, input})
                return {delegated: true}
            },
        }
        const dispatch = createSkillSourceDispatch(application, async (kind) => `/tmp/${kind}`)

        assert.deepEqual(await dispatch.dispatch("skills.chooseSource", {kind: "folder"}), {
            kind: "folder",
            location: "/tmp/folder",
        })
        assert.equal(await dispatch.dispatch("skills.chooseSource", {kind: "local-git"}).then((value) => value.location), "/tmp/local-git")
        assert.equal(await dispatch.dispatch("skills.chooseSource", {kind: "zip"}).then((value) => value.location), "/tmp/zip")
        assert.deepEqual(await dispatch.dispatch("skills.catalog", {}), {delegated: true})
        assert.deepEqual(calls, [{method: "skills.catalog", input: {}}])
        await assert.rejects(dispatch.dispatch("skills.chooseSource", {kind: "git-url"}), /local Skill source kind/u)
        await assert.rejects(dispatch.dispatch("skills.chooseSource", {kind: "folder", location: "/forged"}), /only kind/u)
    })
})
