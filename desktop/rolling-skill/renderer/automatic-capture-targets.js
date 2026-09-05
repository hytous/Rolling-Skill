;(function exposeAutomaticCaptureTargets(root, factory) {
    const api = factory()
    if (typeof module === "object" && module.exports) module.exports = api
    else root.RollingSkillAutomaticCaptureTargets = api
})(typeof globalThis === "undefined" ? this : globalThis, function createAutomaticCaptureTargets() {
    "use strict"

    function arrays(value) {
        return Array.isArray(value) ? value : []
    }

    function candidateSkillRows(skills, targets) {
        const rows = arrays(skills)
            .filter((skill) => skill?.status === "valid")
            .map((skill) => ({...skill}))
        const visible = new Set(rows.map((skill) => skill.id))
        for (const target of arrays(targets)) {
            const skillId = String(target?.skillId ?? "").trim()
            if (!skillId || visible.has(skillId)) continue
            rows.push({id: skillId, name: skillId, status: "unavailable"})
            visible.add(skillId)
        }
        return rows
    }

    function candidateDatasetOptions(datasets, skillId, mode) {
        return arrays(datasets)
            .filter((dataset) => dataset?.skillReference?.id === skillId)
            .map((dataset) => ({
                ...dataset,
                disabled: mode === "automatic" && !dataset.activeRubricVersionId,
            }))
    }

    function initialCaptureTargets(profile, datasets) {
        if (arrays(profile?.targets).length) {
            return profile.targets.map(({skillId, datasetId}) => ({skillId, datasetId}))
        }
        const legacy = arrays(datasets).find((dataset) => (
            dataset?.id === profile?.datasetId && dataset.skillReference?.id
        ))
        return legacy
            ? [{skillId: legacy.skillReference.id, datasetId: legacy.id}]
            : []
    }

    function captureTargetsValid(targets, skills, datasets, mode) {
        const selected = arrays(targets)
        if (mode === "off") return true
        if (!selected.length) return false
        const validSkills = new Set(arrays(skills)
            .filter((skill) => skill?.status === "valid")
            .map((skill) => skill.id))
        return selected.every((target) => (
            validSkills.has(target?.skillId) &&
            candidateDatasetOptions(datasets, target.skillId, mode)
                .some((dataset) => dataset.id === target.datasetId && !dataset.disabled)
        ))
    }

    return {
        candidateDatasetOptions,
        candidateSkillRows,
        captureTargetsValid,
        initialCaptureTargets,
    }
})
