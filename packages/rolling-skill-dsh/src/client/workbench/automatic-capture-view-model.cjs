function candidateSkillRows(skills, targets) {
    const rows = (Array.isArray(skills) ? skills : [])
        .filter((skill) => skill?.status === "valid")
        .map((skill) => ({...skill}))
    const visible = new Set(rows.map((skill) => skill.id))
    for (const target of Array.isArray(targets) ? targets : []) {
        const skillId = String(target?.skillId ?? "").trim()
        if (!skillId || visible.has(skillId)) continue
        rows.push({id: skillId, name: skillId, status: "unavailable"})
        visible.add(skillId)
    }
    return rows
}

function candidateDatasetOptions(datasets, skillId, mode) {
    return (Array.isArray(datasets) ? datasets : [])
        .filter((dataset) => dataset?.skillReference?.id === skillId)
        .map((dataset) => ({
            ...dataset,
            disabled: mode === "automatic" && !dataset.activeRubricVersionId,
        }))
}

module.exports = {candidateDatasetOptions, candidateSkillRows}
