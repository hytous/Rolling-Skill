function skillKey(entry) {
    return entry?.skill?.id || `legacy:${entry?.skill?.name || "unknown"}`
}

function rawCaseSkillOptions(entries = []) {
    const options = new Map()
    for (const entry of entries) {
        const key = skillKey(entry)
        const current = options.get(key) || {
            key,
            name: entry?.skill?.name || "Unknown Skill",
            count: 0,
        }
        current.count += 1
        options.set(key, current)
    }
    return [...options.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function rawCaseSkillGroups(entries = [], search = "", scope = "all") {
    const query = String(search).trim().toLocaleLowerCase()
    const groups = new Map()
    for (const entry of entries) {
        const key = skillKey(entry)
        if (scope !== "all" && key !== scope) continue
        const haystack = `${entry?.question || ""}\n${entry?.note || ""}\n${entry?.skill?.name || ""}`
            .toLocaleLowerCase()
        if (query && !haystack.includes(query)) continue
        const group = groups.get(key) || {
            key,
            name: entry?.skill?.name || "Unknown Skill",
            items: [],
        }
        group.items.push(entry)
        groups.set(key, group)
    }
    return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name))
}

function resolveRawCaseSkillScope(scope, entries = []) {
    return scope === "all" || rawCaseSkillOptions(entries).some((entry) => entry.key === scope)
        ? scope
        : "all"
}

module.exports = {
    rawCaseSkillGroups,
    rawCaseSkillOptions,
    resolveRawCaseSkillScope,
}
