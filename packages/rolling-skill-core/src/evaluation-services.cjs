const {
    snapshotManagedSkillEvidence,
} = require("../../../desktop/rolling-skill/src/evaluation-skill-evidence.cjs")
const {basename, join} = require("node:path")

function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 200) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function optionalText(value, label, maximum = 200) {
    if (value === null || value === undefined || value === "") return null
    return requiredText(value, label, maximum)
}

function configuration(runtimeServices, value, label) {
    const runtimeId = requiredText(value?.runtimeId, `${label} Runtime id`, 500)
    const descriptor = runtimeServices.descriptor(runtimeId)
    return {
        ...descriptor,
        modelId: optionalText(value.modelId, `${label} model id`),
        effort: optionalText(value.effort, `${label} reasoning effort`),
    }
}

function installedSkillPath(destination) {
    return basename(destination).toLocaleLowerCase("en-US") === "skill.md"
        ? destination
        : join(destination, "SKILL.md")
}

function createEvaluationServices({
    store,
    runtimeServices,
    runner,
    managedSkillStore,
    managedSkillManager,
    installationStore,
    snapshotManagedSkill = snapshotManagedSkillEvidence,
    onChanged = () => {},
}) {
    if (
        !store ||
        !runtimeServices ||
        !runner ||
        !managedSkillStore ||
        !managedSkillManager ||
        !installationStore
    ) {
        throw new Error("Rolling Skill evaluation dependencies are required")
    }

    async function start(input = {}) {
        const datasetId = requiredText(input.datasetId, "Dataset id")
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
            throw new Error("Dataset must bind a managed Skill before evaluation")
        }
        const versionId = requiredText(input.versionId, "Evaluation version id")
        const skill = managedSkillStore.getSkill(datasetSkill.id)
        const repository = managedSkillStore.getRepository(datasetSkill.repositoryId)
        if (skill.repositoryId !== repository.id || datasetSkill.name !== skill.name) {
            throw new Error("Dataset managed Skill identity no longer matches the catalog")
        }
        const version = managedSkillStore.getVersion(versionId)
        if (
            version.state !== "released" ||
            version.deprecatedAt ||
            version.skillId !== skill.id ||
            version.repositoryId !== repository.id
        ) {
            throw new Error("Evaluation requires the Dataset Skill's Released version")
        }
        const targets = Array.isArray(input.targets) ? input.targets : []
        if (targets.length < 1 || targets.length > 20) {
            throw new Error("At least one evaluation Runtime is required")
        }
        const requestedRuntimeConfigurations = targets.map((target) =>
            configuration(runtimeServices, target, "Evaluation"),
        )
        const judgeConfiguration = configuration(runtimeServices, input.judge, "Judge")
        const installationJobIdsByRuntime = {}
        const runtimeConfigurations = requestedRuntimeConfigurations.map((runtimeConfiguration) => {
            const installation = installationStore.resolveVerifiedInstallation({
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: version.id,
                runtimeId: runtimeConfiguration.runtimeId,
                providerId: runtimeConfiguration.providerId,
            })
            if (
                installation.commit !== version.commit ||
                installation.contentDigest !== version.contentDigest
            ) {
                throw new Error("Verified Runtime installation does not match the Released version")
            }
            installationJobIdsByRuntime[runtimeConfiguration.runtimeId] = installation.jobId
            return {
                ...runtimeConfiguration,
                skillEvidenceBinding: "verified",
                skillReference: {
                    schemaVersion: "rolling-skill-skill-reference/v1",
                    id: skill.id,
                    repositoryId: repository.id,
                    name: skill.name,
                    path: installedSkillPath(installation.destination),
                    scope: "runtime",
                    description: skill.description ?? null,
                    runtimeId: runtimeConfiguration.runtimeId,
                    providerId: runtimeConfiguration.providerId,
                    confirmedAt: installation.installedAt,
                },
                installationId: installation.installationId ?? installation.id,
                installationJobId: installation.jobId,
                installationVerification: installation.verification,
                expectedContentDigest: version.contentDigest,
            }
        })
        const skillEvidence = await snapshotManagedSkill({
            name: skill.name,
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: version.id,
            repositoryPath: repository.managedPath,
            commit: version.commit,
            skillRoot: version.skillRoot,
            contentDigest: version.contentDigest,
        }, {git: managedSkillManager.git})
        const run = store.createEvaluationRun({
            datasetId,
            caseIds: Array.isArray(input.caseIds) ? input.caseIds : [],
            selectionMode: input.selectionMode ?? "dataset",
            activationMode: input.activationMode ?? "explicit",
            skillEvidence,
            managedVersionSnapshot: {
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: version.id,
                commit: version.commit,
                skillRoot: version.skillRoot,
                contentDigest: version.contentDigest,
                installationJobIdsByRuntime,
            },
            judgeProfile: {
                runtimePolicy: "active",
                modelId: judgeConfiguration.modelId,
                effort: judgeConfiguration.effort,
            },
            judgeConfiguration,
            runtimeConfigurations,
        }, {managedVersionAuthorized: true})
        Promise.resolve(runner.run(run)).catch((error) => {
            try {
                store.updateEvaluationRun?.(run.id, {
                    status: "failed",
                    completedAt: new Date().toISOString(),
                })
                onChanged({runId: run.id, status: "failed", error: error?.message ?? String(error)})
            } catch {}
        })
        onChanged({runId: run.id, status: run.status})
        return copy(run)
    }

    function list({datasetId = null} = {}) {
        return copy(store.listEvaluationRunSummaries(datasetId))
    }

    function get({runId} = {}) {
        return copy(store.getEvaluationRun(requiredText(runId, "Evaluation Run id")))
    }

    async function cancel({runId} = {}) {
        const id = requiredText(runId, "Evaluation Run id")
        const value = await runner.cancel(id)
        onChanged({runId: id, status: "cancelled"})
        return copy(value)
    }

    return Object.freeze({cancel, get, list, start})
}

module.exports = {createEvaluationServices}
