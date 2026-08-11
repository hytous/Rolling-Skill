function resolveExecutionPolicy(settings = {}) {
    return {
        sandbox: settings.localAccess === "workspace" ? "workspace-write" : "danger-full-access",
        approvalPolicy: "never",
    }
}

module.exports = {resolveExecutionPolicy}
