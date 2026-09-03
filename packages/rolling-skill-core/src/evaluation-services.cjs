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

function boundedText(value, maximum = 40_000) {
    const text = String(value ?? "")
    return text.length <= maximum ? text : `${text.slice(0, maximum)}\n…[truncated]`
}

function publicSkillIdentity(reference) {
    if (!reference) return null
    return {
        id: reference.id ?? null,
        repositoryId: reference.repositoryId ?? null,
        name: reference.name ?? null,
        evidencePrecision: reference.evidencePrecision ?? null,
    }
}

function publicEvaluationSummary(summary) {
    if (!summary) return null
    const {skillReference, ...rest} = summary
    return {
        ...rest,
        ...(skillReference ? {skillReference: publicSkillIdentity(skillReference)} : {}),
    }
}

function publicRuntime(configuration) {
    if (!configuration) return null
    return {
        runtimeId: configuration.runtimeId ?? null,
        providerId: configuration.providerId ?? null,
        displayName: configuration.displayName ?? configuration.runtimeId ?? null,
        version: configuration.version ?? null,
        modelId: configuration.modelId ?? null,
        effort: configuration.effort ?? null,
        installationId: configuration.installationId ?? null,
        installationJobId: configuration.installationJobId ?? null,
        installationVerification: configuration.installationVerification ?? null,
    }
}

function publicManagedVersion(snapshot) {
    if (!snapshot) return null
    return {
        repositoryId: snapshot.repositoryId ?? null,
        skillId: snapshot.skillId ?? null,
        versionId: snapshot.versionId ?? null,
        commit: snapshot.commit ?? null,
        contentDigest: snapshot.contentDigest ?? null,
        installationJobIdsByRuntime: snapshot.installationJobIdsByRuntime ?? {},
    }
}

function publicRubricVersion(version) {
    if (!version) return null
    return {
        id: version.id ?? null,
        version: version.version ?? null,
        rubricDigest: version.rubricDigest ?? null,
        rubric: version.rubric ?? null,
        createdAt: version.createdAt ?? null,
    }
}

function publicTraceEvidence(evidence) {
    if (!evidence) return null
    const entries = Array.isArray(evidence.entries) ? evidence.entries.slice(0, 500) : []
    return {
        scope: "case",
        schemaVersion: evidence.schemaVersion ?? null,
        entryCount: entries.length,
        sourceEntryCount: evidence.sourceEntryCount ?? entries.length,
        includedEntries: evidence.includedEntries ?? entries.length,
        compactedEntries: evidence.compactedEntries ?? 0,
        contentCompactedEntries: evidence.contentCompactedEntries ?? 0,
        semanticCoverageComplete: evidence.semanticCoverageComplete === true,
        samplingStrategy: evidence.samplingStrategy ?? null,
        truncated: evidence.truncated === true || (evidence.entries?.length ?? 0) > entries.length,
        omittedEntries:
            (evidence.omittedEntries ?? 0) + Math.max(0, (evidence.entries?.length ?? 0) - entries.length),
        entries,
    }
}

function publicEvaluationResult(result) {
    return {
        id: result.id,
        caseId: result.caseId ?? result.caseSnapshot?.id ?? null,
        question: result.caseSnapshot?.question ?? result.question ?? null,
        caseType: result.caseSnapshot?.caseType ?? null,
        runtimeId: result.runtimeId ?? null,
        status: result.status,
        gradingStatus: result.gradingStatus ?? null,
        durationMs: result.durationMs ?? null,
        response: result.response ? boundedText(result.response) : null,
        error: result.error ? boundedText(result.error, 4_000) : null,
        gradingError: result.gradingError ? boundedText(result.gradingError, 4_000) : null,
        scoreContract: result.scoreContract ?? null,
        judgment: result.judgment ?? null,
        computedScore: result.computedScore ?? null,
        judge: result.judge ? {
            runtimeId: result.judge.runtimeId ?? null,
            providerId: result.judge.providerId ?? null,
            displayName: result.judge.displayName ?? null,
            version: result.judge.version ?? null,
            modelId: result.judge.modelId ?? null,
            effort: result.judge.effort ?? null,
            status: result.judge.status ?? null,
            attempts: result.judge.attempts ?? null,
            durationMs: result.judge.durationMs ?? null,
            contractDigest: result.judge.contractDigest ?? null,
        } : null,
        traceEvidence: publicTraceEvidence(result.traceEvidence),
        startedAt: result.startedAt ?? null,
        completedAt: result.completedAt ?? null,
        gradingStartedAt: result.gradingStartedAt ?? null,
        gradingCompletedAt: result.gradingCompletedAt ?? null,
    }
}

function publicEvaluation(run) {
    if (!run) return null
    return {
        id: run.id,
        datasetId: run.datasetId,
        selectionMode: run.selectionMode ?? null,
        activationMode: run.activationMode ?? null,
        traceScope: "case",
        status: run.status,
        caseCount: run.caseSnapshots?.length ?? 0,
        runtimeCount: run.runtimeConfigurations?.length ?? 0,
        createdAt: run.createdAt ?? null,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
        skillReference: publicSkillIdentity(run.skillReference),
        managedVersionSnapshot: publicManagedVersion(run.managedVersionSnapshot),
        rubricVersionSnapshot: publicRubricVersion(run.rubricVersionSnapshot),
        skillEvidence: run.skillEvidence ? {
            schemaVersion: run.skillEvidence.schemaVersion ?? null,
            digest: run.skillEvidence.digest ?? null,
            managedSource: run.skillEvidence.managedSource ?? null,
            complete: run.skillEvidence.complete ?? null,
            warningCount: Array.isArray(run.skillEvidence.warnings) ? run.skillEvidence.warnings.length : 0,
        } : null,
        runtimeConfigurations: (run.runtimeConfigurations ?? []).map(publicRuntime),
        judgeConfiguration: publicRuntime(run.judgeConfiguration),
        results: (run.results ?? []).map(publicEvaluationResult),
    }
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
        return copy(store.listEvaluationRunSummaries(datasetId).map(publicEvaluationSummary))
    }

    function get({runId} = {}) {
        const result = publicEvaluation(store.getEvaluationRun(requiredText(runId, "Evaluation Run id")))
        const versionId = result.managedVersionSnapshot?.versionId ?? result.skillEvidence?.managedSource?.versionId
        if (versionId) {
            try {
                const version = managedSkillStore.getVersion(versionId)
                result.managedVersionLabel = version.versionLabel ?? null
                result.managedVersionState = version.state
            } catch {
                // Historical evaluation evidence remains readable after a catalog entry is removed.
            }
        }
        return copy(result)
    }

    async function cancel({runId} = {}) {
        const id = requiredText(runId, "Evaluation Run id")
        const value = await runner.cancel(id)
        onChanged({runId: id, status: "cancelled"})
        return copy(value)
    }

    function remove({runId} = {}) {
        const id = requiredText(runId, "Evaluation Run id")
        const value = store.deleteEvaluationRun(id)
        onChanged({runId: id, status: "deleted"})
        return copy(value)
    }

    return Object.freeze({cancel, delete: remove, get, list, start})
}

module.exports = {createEvaluationServices}
