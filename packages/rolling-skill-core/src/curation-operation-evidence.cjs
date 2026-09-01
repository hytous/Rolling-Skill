const {basename, isAbsolute, join, resolve} = require("node:path")

function installedSkillPath(destination) {
    return basename(destination).toLocaleLowerCase("en-US") === "skill.md"
        ? destination
        : join(destination, "SKILL.md")
}

function blockerCode(message) {
    if (/managed Skill/iu.test(message)) return "MANAGED_SKILL_REQUIRED"
    if (/Rubric/iu.test(message)) return "PUBLISHED_RUBRIC_REQUIRED"
    if (/Select a Runtime/iu.test(message)) return "RUNTIME_REQUIRED"
    if (/ambiguous/iu.test(message)) return "INSTALLATION_AMBIGUOUS"
    if (/installation/iu.test(message)) return "INSTALLATION_REQUIRED"
    return "CURATION_PREREQUISITE_FAILED"
}

function createCurationOperationEvidenceResolver({
    store,
    configStore,
    runtimeServices,
    managedSkillStore,
    installationStore,
} = {}) {
    if (!store || !configStore || !runtimeServices || !managedSkillStore || !installationStore) {
        throw new Error("Curation operation evidence dependencies are required")
    }

    function resolveEvidence(datasetId, {
        observedSkills,
        kind = "curation",
        requireRubric = kind === "curation",
    } = {}) {
        if (kind !== "curation" && kind !== "rubric") {
            throw new Error("Managed Skill operation kind is invalid")
        }
        const dataset = store.getDataset(datasetId)
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
        const rubric = store.getActiveDatasetRubric(dataset.id)
        if (requireRubric && !rubric) {
            throw new Error("A published dataset Rubric is required before curation")
        }
        const selectedRuntime = configStore.read().runtime
        if (!selectedRuntime?.runtimeId) {
            throw new Error("Select a Runtime before starting curation")
        }
        const runtime = runtimeServices.descriptor(selectedRuntime.runtimeId)
        const repository = managedSkillStore.getRepository(datasetSkill.repositoryId)
        const skill = managedSkillStore.getSkill(datasetSkill.id)
        if (
            skill.repositoryId !== repository.id ||
            datasetSkill.name !== skill.name
        ) {
            throw new Error("Dataset managed Skill identity no longer matches the catalog")
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
        let installations = installationStore.listVerifiedInstallations({
            repositoryId: repository.id,
            skillId: skill.id,
            runtimeId: runtime.runtimeId,
            providerId: runtime.providerId,
        })
        if (!installations.length && kind === "rubric") {
            installations = installationStore.listVerifiedInstallations({
                repositoryId: repository.id,
                skillId: skill.id,
            })
        }
        if (!installations.length) {
            throw new Error("A verified Skill installation is required before curation")
        }
        const matching = installations.filter((installation) => {
            const version = versionsById.get(installation.versionId)
            return version &&
                installation.commit === version.commit &&
                installation.contentDigest === version.contentDigest
        })
        if (!matching.length) {
            throw new Error("Verified Skill installation does not match a Released version")
        }
        const newestInstalledAt = matching[0].installedAt
        const newest = matching.filter((entry) => entry.installedAt === newestInstalledAt)
        const signatures = new Set(newest.map((entry) => JSON.stringify({
            versionId: entry.versionId,
            commit: entry.commit,
            contentDigest: entry.contentDigest,
            destination: entry.destination,
            verification: entry.verification,
        })))
        if (signatures.size !== 1) {
            throw new Error("Conflicting newest verified Skill installations are ambiguous")
        }
        const installation = newest[0]
        if (!isAbsolute(installation.destination)) {
            throw new Error("Verified Skill installation destination is invalid")
        }
        const version = versionsById.get(installation.versionId)
        const installationRuntime = installation.runtime ?? runtimeServices.descriptor(
            installation.runtimeId,
        )
        if (
            installationRuntime.runtimeId !== installation.runtimeId ||
            installationRuntime.providerId !== installation.providerId
        ) {
            throw new Error("Verified Skill installation Runtime evidence is invalid")
        }
        const runtimeSnapshot = {
            runtimeId: installationRuntime.runtimeId,
            providerId: installationRuntime.providerId,
            displayName: installationRuntime.displayName,
            version: installationRuntime.version ?? null,
            executablePath: installationRuntime.executablePath,
        }
        const marker = {
            schema: "rolling-skill-install/v1",
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: version.id,
            commit: version.commit,
            contentDigest: version.contentDigest,
            installedAt: installation.installedAt,
        }
        let sourceSkill = null
        if (observedSkills !== undefined) {
            if (!Array.isArray(observedSkills) || observedSkills.length === 0) {
                throw new Error("Trusted DSH source Skill evidence is required before curation")
            }
            const matchingSourceSkills = observedSkills.filter((entry) =>
                entry?.name === skill.name &&
                entry.resourceBase?.kind === "directory" &&
                typeof entry.resourceBase.path === "string" &&
                resolve(entry.resourceBase.path) === resolve(installation.destination),
            )
            if (!matchingSourceSkills.length) {
                const named = observedSkills.some((entry) => entry?.name === skill.name)
                throw new Error(named
                    ? "Trusted DSH source Skill does not match the verified installation"
                    : "Trusted DSH observed Skill does not match the Dataset Skill")
            }
            const signatures = new Set(matchingSourceSkills.map((entry) => JSON.stringify({
                name: entry.name,
                provider: entry.provider,
                resourceBase: entry.resourceBase,
            })))
            if (signatures.size !== 1) {
                throw new Error("Trusted DSH source Skill evidence is ambiguous")
            }
            const selected = matchingSourceSkills
                .slice()
                .sort((left, right) => left.callSeq - right.callSeq || left.resultSeq - right.resultSeq)
                .at(-1)
            sourceSkill = {
                name: selected.name,
                provider: selected.provider,
                resourceBase: {...selected.resourceBase},
                callSeq: selected.callSeq,
                resultSeq: selected.resultSeq,
            }
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
                rubricVersionId: rubric?.id ?? null,
                runtime: runtimeSnapshot,
                installation: {
                    installationId: installation.installationId ?? installation.id,
                    jobId: installation.jobId,
                    destination: installation.destination,
                    verification: installation.verification,
                    installedAt: installation.installedAt,
                    marker,
                },
                ...(sourceSkill ? {sourceSkill} : {}),
            },
        }
    }

    function inspectDataset(datasetId) {
        const dataset = store.getDataset(datasetId)
        try {
            const resolved = resolveEvidence(dataset.id)
            return {
                datasetId: dataset.id,
                name: dataset.name,
                ready: true,
                blockers: [],
                rubricVersionId: resolved.operationEvidence.rubricVersionId,
                runtime: {
                    runtimeId: resolved.operationEvidence.runtime.runtimeId,
                    displayName: resolved.operationEvidence.runtime.displayName,
                    version: resolved.operationEvidence.runtime.version,
                },
                version: {
                    versionId: resolved.operationEvidence.versionId,
                    versionLabel: resolved.operationEvidence.versionLabel,
                },
            }
        } catch (error) {
            const message = String(error?.message ?? "Curation prerequisite failed")
            return {
                datasetId: dataset.id,
                name: dataset.name,
                ready: false,
                blockers: [{code: blockerCode(message), message}],
                rubricVersionId: dataset.activeRubricVersionId ?? null,
                runtime: null,
                version: null,
            }
        }
    }

    function resolveRubric(datasetId) {
        return resolveEvidence(datasetId, {kind: "rubric", requireRubric: false})
    }

    return Object.freeze({inspectDataset, resolve: resolveEvidence, resolveRubric})
}

module.exports = {createCurationOperationEvidenceResolver}
