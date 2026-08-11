const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {resolveExecutionPolicy} = require("../src/execution-policy.cjs")

describe("runtime execution policy", () => {
    it("defaults new local tasks to full access", () => {
        assert.deepEqual(resolveExecutionPolicy(), {
            sandbox: "danger-full-access",
            approvalPolicy: "never",
        })
        assert.deepEqual(resolveExecutionPolicy({localAccess: "full"}), {
            sandbox: "danger-full-access",
            approvalPolicy: "never",
        })
    })

    it("maps workspace-only access to the Codex workspace sandbox", () => {
        assert.deepEqual(resolveExecutionPolicy({localAccess: "workspace"}), {
            sandbox: "workspace-write",
            approvalPolicy: "never",
        })
    })
})
