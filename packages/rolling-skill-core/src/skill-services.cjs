function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 4_096) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function createSkillServices({manager, installationManager, installationStore, runtimeServices}) {
    if (!manager || !installationManager || !installationStore || !runtimeServices) {
        throw new Error("Rolling Skill managed Skill dependencies are required")
    }
    return Object.freeze({
        catalog: () => copy(manager.catalog()),
        get: ({skillId}) => copy(manager.readSkill(requiredText(skillId, "Skill id", 200))),
        versions: (input = {}) => copy(manager.listVersionPage(input)),
        candidateBase: ({skillId}) => manager.candidateBase(requiredText(skillId, "Skill id", 200)),
        createCandidate: (input = {}) => manager.createCandidate(copy(input)),
        release: (input = {}) => manager.releaseVersion(copy(input)),
        deprecate: ({versionId}) => manager.deprecateVersion({
            versionId: requiredText(versionId, "Version id", 200),
        }),
        importSource: (input = {}) => manager.importSource(copy(input)),
        rescan: () => manager.rescanAll(),
        installationTargets: () => copy(runtimeServices.list()),
        installations: ({skillId = null} = {}) => copy(installationManager.overview(skillId)),
        installation: ({jobId}) => copy(installationStore.getJob(
            requiredText(jobId, "Installation Job id", 200),
        )),
        startInstallation: (input = {}) => installationManager.start(copy(input)),
        cancelInstallation: ({jobId}) => installationManager.cancel(
            requiredText(jobId, "Installation Job id", 200),
        ),
        inspectInstallation: ({jobId}) => installationManager.inspect(
            requiredText(jobId, "Installation Job id", 200),
        ),
        sendInstallation: ({jobId, text}) => installationManager.send(
            requiredText(jobId, "Installation Job id", 200),
            requiredText(text, "Installer message", 120_000),
        ),
    })
}

module.exports = {createSkillServices}
