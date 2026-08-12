function runtimeReportsSkill(response, skillReference) {
    for (const entry of response?.data ?? []) {
        for (const skill of entry.skills ?? []) {
            if (
                skill?.enabled &&
                skill.path === skillReference.path &&
                skill.name === skillReference.name
            ) {
                return true
            }
        }
    }
    return false
}

async function resolveSkillEvidenceBinding({
    descriptor,
    selectedRuntimeId,
    getSelectedRuntime,
    createClient,
    clientOptions,
    skillReference,
}) {
    let temporaryClient = null
    try {
        const runtime = descriptor.runtimeId === selectedRuntimeId
            ? await getSelectedRuntime()
            : (temporaryClient = createClient(descriptor, clientOptions))
        if (temporaryClient) await temporaryClient.start()
        if (typeof runtime.listSkills !== "function") return "unverified"
        const response = await runtime.listSkills({forceReload: true})
        return runtimeReportsSkill(response, skillReference) ? "verified" : "unverified"
    } catch {
        return "unverified"
    } finally {
        if (temporaryClient) await temporaryClient.stop().catch(() => {})
    }
}

module.exports = {resolveSkillEvidenceBinding, runtimeReportsSkill}
