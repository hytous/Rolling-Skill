const INTERNAL_RUNTIME_PROMPTS = Object.freeze([
    ["automatic-analysis", "Identify complete user problem ranges from incremental user messages only."],
    ["automatic-analysis", "Classify only this completed problem episode. Identify the principal enabled Skill,"],
    ["automatic-analysis", "Decide whether this completed episode is eligible to become a Skill evaluation Case."],
    ["operator", "[Environment context — rolling-skill-operator/v1]"],
    ["evaluation-judge", "You are judging one agent Skill evaluation result."],
    ["curation", "You are the Curator for an agent Skill evaluation dataset."],
    ["rubric", "You are the Rubric Agent for one Skill evaluation dataset."],
    ["case-refresh", "Re-execute the immutable evaluation question below with the current Skill and current"],
    ["skill-installation", "You are running one managed Skill installation Job."],
    ["skill-installation", "You are running one bounded Skill optimization installation Job."],
])

function classifyInternalRuntimePrompt(value) {
    if (typeof value !== "string") return null
    const text = value.trimStart()
    for (const [kind, prefix] of INTERNAL_RUNTIME_PROMPTS) {
        if (text.startsWith(prefix)) return kind
        const offset = text.indexOf(prefix)
        if (text.startsWith("/") && offset > 0 && offset <= 200) return kind
    }
    return null
}

function classifyInternalRuntimeThread(thread) {
    return classifyInternalRuntimePrompt(thread?.preview)
}

module.exports = {
    classifyInternalRuntimePrompt,
    classifyInternalRuntimeThread,
}
