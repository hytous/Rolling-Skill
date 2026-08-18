const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    readThreadProfile,
    updateThreadProfiles,
} = require("../src/thread-profile-store.cjs")

describe("thread task profile persistence", () => {
    it("restores the selected model, reasoning effort, and permission mode for one runtime thread", () => {
        const profiles = updateThreadProfiles(
            {},
            "codex:alpha",
            "thread-1",
            {modelId: "gpt-5.6-sol", effort: "xhigh", permissionMode: "workspace"},
            "2026-08-11T00:00:00.000Z",
        )

        assert.deepEqual(readThreadProfile({threadProfiles: profiles}, "codex:alpha", "thread-1"), {
            modelId: "gpt-5.6-sol",
            effort: "xhigh",
            permissionMode: "workspace",
            updatedAt: "2026-08-11T00:00:00.000Z",
        })
        assert.equal(readThreadProfile({threadProfiles: profiles}, "codex:beta", "thread-1"), null)
    })

    it("preserves an explicit runtime-default selection instead of falling through", () => {
        const profiles = updateThreadProfiles(
            {},
            "codex:alpha",
            "thread-1",
            {modelId: null, effort: null},
            "2026-08-11T00:00:00.000Z",
        )

        assert.deepEqual(readThreadProfile({threadProfiles: profiles}, "codex:alpha", "thread-1"), {
            modelId: null,
            effort: null,
            updatedAt: "2026-08-11T00:00:00.000Z",
        })
    })

    it("does not mutate the previous profile collection", () => {
        const previous = {"existing::thread": {modelId: null, effort: "low", updatedAt: "then"}}
        const next = updateThreadProfiles(
            previous,
            "codex:alpha",
            "thread-1",
            {modelId: null, effort: "high"},
            "now",
        )

        assert.notEqual(next, previous)
        assert.deepEqual(previous, {
            "existing::thread": {modelId: null, effort: "low", updatedAt: "then"},
        })
    })

    it("preserves the other setting when a runtime notification updates only one field", () => {
        const initial = updateThreadProfiles(
            {},
            "codex:alpha",
            "thread-1",
            {modelId: "gpt-5.6-sol", effort: "max", permissionMode: "full"},
            "2026-08-11T00:00:00.000Z",
        )
        const next = updateThreadProfiles(
            initial,
            "codex:alpha",
            "thread-1",
            {modelId: "gpt-5.7"},
            "2026-08-11T00:01:00.000Z",
        )

        assert.deepEqual(readThreadProfile({threadProfiles: next}, "codex:alpha", "thread-1"), {
            modelId: "gpt-5.7",
            effort: "max",
            permissionMode: "full",
            updatedAt: "2026-08-11T00:01:00.000Z",
        })
    })

    it("keeps an unseen field unknown when the first runtime notification is partial", () => {
        const profiles = updateThreadProfiles(
            {},
            "codex:alpha",
            "thread-1",
            {effort: "max"},
            "2026-08-11T00:00:00.000Z",
        )

        const profile = readThreadProfile({threadProfiles: profiles}, "codex:alpha", "thread-1")
        assert.equal(Object.hasOwn(profile, "modelId"), false)
        assert.equal(profile.effort, "max")
    })
})
