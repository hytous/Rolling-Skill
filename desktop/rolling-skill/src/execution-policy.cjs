const CODEX_PERMISSION_MODES = Object.freeze([
    {value: "full", label: "fullLocalAccess"},
    {value: "workspace", label: "workspaceOnlyAccess"},
    {value: "read-only", label: "readOnlyAccess"},
])

const CODEBUDDY_PERMISSION_MODES = Object.freeze([
    {value: "auto", label: "codebuddyAutoAccess"},
    {value: "default", label: "codebuddyAskAccess"},
    {value: "acceptEdits", label: "codebuddyAcceptEditsAccess"},
    {value: "plan", label: "codebuddyPlanAccess"},
    {value: "dontAsk", label: "codebuddyDontAskAccess"},
    {value: "bypassPermissions", label: "codebuddyBypassAccess"},
    {value: "fullAccess", label: "fullLocalAccess"},
])

function resolveExecutionPolicy(settings = {}) {
    return {
        sandbox: settings.localAccess === "workspace" ? "workspace-write" : "danger-full-access",
        approvalPolicy: "never",
    }
}

function permissionModeOptions(providerId) {
    if (providerId === "codex") return CODEX_PERMISSION_MODES.map((entry) => ({...entry}))
    if (providerId === "codebuddy") {
        return CODEBUDDY_PERMISSION_MODES.map((entry) => ({...entry}))
    }
    return []
}

function defaultPermissionMode(providerId, settings = {}) {
    if (providerId === "codex") {
        return settings.localAccess === "workspace" ? "workspace" : "full"
    }
    if (providerId === "codebuddy") return "auto"
    return null
}

function resolveRuntimePermission(providerId, requestedMode, settings = {}) {
    if (providerId === "deepseek-harness") return {}
    const permissionMode = requestedMode || defaultPermissionMode(providerId, settings)
    const supported =
        providerId === "codebuddy"
            ? typeof permissionMode === "string" &&
              /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(permissionMode)
            : permissionModeOptions(providerId).some(
                  (option) => option.value === permissionMode,
              )
    if (!supported) throw new Error(`Unsupported ${providerId || "runtime"} permission mode`)
    if (providerId === "codex") {
        return {
            permissionMode,
            sandbox:
                permissionMode === "full"
                    ? "danger-full-access"
                    : permissionMode === "read-only"
                      ? "read-only"
                      : "workspace-write",
            approvalPolicy: "never",
        }
    }
    return {permissionMode}
}

module.exports = {
    defaultPermissionMode,
    permissionModeOptions,
    resolveExecutionPolicy,
    resolveRuntimePermission,
}
