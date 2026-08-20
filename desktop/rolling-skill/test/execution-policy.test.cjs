const assert = require("node:assert/strict")
const {describe, it} = require("node:test")

const {
    defaultPermissionMode,
    permissionModeOptions,
    resolveExecutionPolicy,
    resolveRuntimePermission,
} = require("../src/execution-policy.cjs")

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

    it("maps provider-specific conversation permission modes", () => {
        assert.deepEqual(resolveRuntimePermission("codex", "read-only"), {
            permissionMode: "read-only",
            sandbox: "read-only",
            approvalPolicy: "never",
        })
        assert.deepEqual(resolveRuntimePermission("codebuddy", "fullAccess"), {
            permissionMode: "fullAccess",
        })
        assert.equal(permissionModeOptions("codebuddy").some((entry) => entry.value === "bypassPermissions"), true)
        assert.deepEqual(resolveRuntimePermission("codebuddy", "delegate"), {
            permissionMode: "delegate",
        })
        assert.equal(permissionModeOptions("codebuddy").some((entry) => entry.value === "dontAsk"), true)
        assert.throws(() => resolveRuntimePermission("codebuddy", "bad mode"), /permission mode/i)
    })

    it("maps DeepSeek Harness permissions to its three native sandbox modes", () => {
        assert.deepEqual(permissionModeOptions("deepseek-harness"), [
            {value: "danger-full-access", label: "fullLocalAccess"},
            {value: "workspace-write", label: "workspaceOnlyAccess"},
            {value: "read-only", label: "readOnlyAccess"},
        ])
        assert.equal(defaultPermissionMode("deepseek-harness"), "danger-full-access")
        assert.equal(
            defaultPermissionMode("deepseek-harness", {localAccess: "workspace"}),
            "workspace-write",
        )
        assert.deepEqual(resolveRuntimePermission("deepseek-harness", null), {
            permissionMode: "danger-full-access",
        })
        assert.deepEqual(resolveRuntimePermission("deepseek-harness", null, {localAccess: "workspace"}), {
            permissionMode: "workspace-write",
        })
        assert.deepEqual(resolveRuntimePermission("deepseek-harness", "read-only"), {
            permissionMode: "read-only",
        })
        assert.throws(
            () => resolveRuntimePermission("deepseek-harness", "bypassPermissions"),
            /permission mode/i,
        )
    })
})
