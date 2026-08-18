const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    commandActivityDetail,
    commandText,
} = require("../renderer/command-activity.js")

describe("command activity details", () => {
    it("prefers full command actions over an outer shell wrapper", () => {
        assert.deepEqual(
            commandActivityDetail({
                command: "/bin/zsh -lc \"sed file && rg needle file\"",
                commandActions: [
                    {command: "sed -n '1p' /private/input.txt"},
                    {command: "rg needle /private/input.txt"},
                ],
            }),
            {
                command: "sed -n '1p' /private/input.txt\nrg needle /private/input.txt",
                invocationCount: 2,
                detailUnavailable: false,
            },
        )
    })

    it("preserves direct string and argv command input", () => {
        assert.equal(commandText("billing-cli query --month 7"), "billing-cli query --month 7")
        assert.equal(
            commandText(["/usr/bin/printf", "%s", "public|literal"]),
            "/usr/bin/printf %s public|literal",
        )
    })

    it("marks old shell-only placeholders as unavailable", () => {
        assert.deepEqual(commandActivityDetail({command: "zsh … [arguments omitted]"}), {
            command: "",
            invocationCount: 0,
            detailUnavailable: true,
        })
    })

    it("restores a persisted command invocation count", () => {
        assert.deepEqual(
            commandActivityDetail({command: "git status\ngit diff", commandInvocationCount: 2}),
            {
                command: "git status\ngit diff",
                invocationCount: 2,
                detailUnavailable: false,
            },
        )
    })
})
