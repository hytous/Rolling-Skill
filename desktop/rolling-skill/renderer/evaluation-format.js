;(function exposeEvaluationFormat(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillEvaluationFormat = api
})(typeof globalThis === "undefined" ? this : globalThis, function createEvaluationFormat() {
    "use strict"

    function formatEvaluationDuration(milliseconds) {
        const numeric = Number(milliseconds)
        const seconds = Number.isFinite(numeric) && numeric > 0
            ? Math.round(numeric / 1000)
            : 0
        const minutes = Math.floor(seconds / 60)
        return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
    }

    return {formatEvaluationDuration}
})
