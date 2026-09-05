const {basename, isAbsolute, join} = require("node:path")

function installedSkillPath(destination) {
    return basename(destination).toLocaleLowerCase("en-US") === "skill.md"
        ? destination
        : join(destination, "SKILL.md")
}

function managedDatasetSkillReference({repositoryId, skillId} = {}, {
    managedSkillStore,
    now = () => new Date().toISOString(),
} = {}) {
    if (!managedSkillStore || !repositoryId || !skillId) {
        throw new Error("Select a managed Skill before saving the Dataset")
    }
    const repository = managedSkillStore.getRepository(repositoryId)
    const skill = managedSkillStore.getSkill(skillId)
    if (skill.repositoryId !== repository.id) {
        throw new Error("Managed Skill does not belong to the selected repository")
    }
    if (skill.status && skill.status !== "valid") {
        throw new Error("Managed Skill is not available")
    }
    return {
        schemaVersion: "rolling-skill-skill-reference/v1",
        evidencePrecision: "managed",
        id: skill.id,
        repositoryId: repository.id,
        name: skill.name,
        path: null,
        scope: "managed",
        description: skill.description ?? null,
        runtimeId: null,
        providerId: null,
        confirmedAt: now(),
    }
}

function resolveManagedCurationOperation({
    dataset,
    runtime,
    managedSkillStore,
    installationStore,
    kind = "curation",
    requireRubric = true,
} = {}) {
    if (!dataset || !managedSkillStore || !installationStore) {
        throw new Error("Managed curation dependencies are required")
    }
    if (kind !== "curation" && kind !== "rubric") {
        throw new Error("Managed Skill operation kind is invalid")
    }
    const datasetSkill = dataset.skillReference
    if (
        datasetSkill?.evidencePrecision !== "managed" ||
        !datasetSkill.id ||
        !datasetSkill.repositoryId ||
        datasetSkill.path ||
        datasetSkill.runtimeId ||
        datasetSkill.providerId
    ) {
        throw new Error("Dataset must bind a pathless managed Skill before curation")
    }
    if (requireRubric && !dataset.activeRubricVersionId) {
        throw new Error("A published dataset Rubric is required before curation")
    }
    if (!runtime?.runtimeId || !runtime?.providerId) {
        throw new Error("Select a Runtime before starting curation")
    }

    const repository = managedSkillStore.getRepository(datasetSkill.repositoryId)
    const skill = managedSkillStore.getSkill(datasetSkill.id)
    if (
        skill.repositoryId !== repository.id ||
        datasetSkill.repositoryId !== repository.id ||
        datasetSkill.name !== skill.name
    ) {
        throw new Error("Dataset managed Skill identity no longer matches the repository catalog")
    }
    if (skill.status && skill.status !== "valid") {
        throw new Error("Dataset managed Skill is not available")
    }

    const released = managedSkillStore.listVersions(skill.id)
        .filter((version) =>
            version.state === "released" &&
            !version.deprecatedAt &&
            version.repositoryId === repository.id &&
            version.skillId === skill.id,
        )
    if (!released.length) {
        throw new Error("A Released managed Skill version is required before curation")
    }
    const versionsById = new Map(released.map((version) => [version.id, version]))
    const matching = installationStore.listVerifiedInstallations({
        repositoryId: repository.id,
        skillId: skill.id,
        runtimeId: runtime.runtimeId,
        providerId: runtime.providerId,
    }).filter((installation) => {
        const version = versionsById.get(installation.versionId)
        return version &&
            installation.commit === version.commit &&
            installation.contentDigest === version.contentDigest
    }).sort((left, right) => String(right.installedAt).localeCompare(String(left.installedAt)))

    if (!matching.length) {
        throw new Error("The current Runtime has no verified Skill installation matching a Released version")
    }
    const installation = matching[0]
    if (!isAbsolute(installation.destination)) {
        throw new Error("Verified Skill installation destination is invalid")
    }
    const version = versionsById.get(installation.versionId)
    const installationRuntime = installation.runtime ?? runtime
    if (
        installationRuntime.runtimeId !== installation.runtimeId ||
        installationRuntime.providerId !== installation.providerId ||
        installation.runtimeId !== runtime.runtimeId ||
        installation.providerId !== runtime.providerId
    ) {
        throw new Error("Verified Skill installation Runtime evidence is invalid")
    }

    return {
        executionSkillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: skill.id,
            repositoryId: repository.id,
            name: skill.name,
            path: installedSkillPath(installation.destination),
            scope: "runtime",
            description: skill.description ?? null,
            runtimeId: installationRuntime.runtimeId,
            providerId: installationRuntime.providerId,
            confirmedAt: installation.installedAt,
        },
        operationEvidence: {
            schemaVersion: "rolling-skill-operation-evidence/v1",
            kind,
            repositoryId: repository.id,
            skillId: skill.id,
            skillName: skill.name,
            versionId: version.id,
            versionLabel: version.versionLabel,
            commit: version.commit,
            skillRoot: version.skillRoot,
            contentDigest: version.contentDigest,
            rubricVersionId: dataset.activeRubricVersionId ?? null,
            runtime: {
                runtimeId: installationRuntime.runtimeId,
                providerId: installationRuntime.providerId,
                displayName: installationRuntime.displayName,
                version: installationRuntime.version ?? null,
                executablePath: installationRuntime.executablePath,
            },
            installation: {
                installationId: installation.installationId ?? installation.id,
                jobId: installation.jobId,
                destination: installation.destination,
                verification: installation.verification,
                installedAt: installation.installedAt,
                marker: {
                    schema: "rolling-skill-install/v1",
                    repositoryId: repository.id,
                    skillId: skill.id,
                    versionId: version.id,
                    commit: version.commit,
                    contentDigest: version.contentDigest,
                    installedAt: installation.installedAt,
                },
            },
        },
    }
}

module.exports = {
    managedDatasetSkillReference,
    resolveManagedCurationOperation,
}
