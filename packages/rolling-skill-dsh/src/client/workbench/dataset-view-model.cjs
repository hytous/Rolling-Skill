function managedSkillOptionLabel(skill, repositories = []) {
    const skillName = String(skill?.name || "").trim() || "Unknown Skill"
    const repository = repositories.find((entry) => entry?.id === skill?.repositoryId)
    const repositoryName = String(repository?.displayName || "").trim()
    return repositoryName && repositoryName !== skillName
        ? `${skillName} · ${repositoryName}`
        : skillName
}

module.exports = {
    managedSkillOptionLabel,
}
