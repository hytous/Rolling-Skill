;(function exposeCommandActivity(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillCommandActivity = api
})(typeof globalThis === "undefined" ? this : globalThis, function createCommandActivity() {
    "use strict"

    const LEGACY_SHELL_PLACEHOLDER = /^(?:bash|dash|ksh|sh|shell|zsh)\s+…\s+\[arguments omitted\]$/u

    function commandText(value) {
        if (Array.isArray(value)) {
            return value.map((part) => String(part)).join(" ").trim()
        }
        const text = String(value ?? "")
        return text.trim() ? text : ""
    }

    function commandActivityDetail(item = {}) {
        const actions = Array.isArray(item.commandActions)
            ? item.commandActions
                  .map((action) => commandText(action?.command))
                  .filter(Boolean)
            : []
        if (actions.length) {
            return {
                command: actions.join("\n"),
                invocationCount: actions.length,
                detailUnavailable: false,
            }
        }

        const command = commandText(item.command)
        if (LEGACY_SHELL_PLACEHOLDER.test(command)) {
            return {command: "", invocationCount: 0, detailUnavailable: true}
        }
        return {
            command,
            invocationCount: Number.isSafeInteger(item.commandInvocationCount)
                ? Math.max(item.commandInvocationCount, command ? 1 : 0)
                : command
                  ? 1
                  : 0,
            detailUnavailable: Boolean(item.commandDetailUnavailable),
        }
    }

    return {commandActivityDetail, commandText}
})
