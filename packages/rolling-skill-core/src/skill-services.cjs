function copy(value) {
    return JSON.parse(JSON.stringify(value))
}

function requiredText(value, label, maximum = 4_096) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function boundedText(value, maximum = 20_000) {
    const text = String(value ?? "")
    return text.length <= maximum ? text : `${text.slice(0, maximum)}\n…[truncated]`
}

function publicTimeline(entries) {
    return Array.isArray(entries) ? entries.slice(-200).map((entry) => ({
        role: entry.role ?? null,
        type: entry.type ?? null,
        title: entry.title ? boundedText(entry.title, 1_000) : null,
        summary: entry.summary ? boundedText(entry.summary, 4_000) : null,
        content: entry.content ? boundedText(entry.content) : null,
        recordedAt: entry.recordedAt ?? null,
    })) : []
}

function publicInstallationJob(job) {
    if (!job) return null
    return {
        id: job.id,
        operation: job.operation ?? null,
        parentJobId: job.parentJobId ?? null,
        status: job.status,
        runtime: job.runtime ? {
            runtimeId: job.runtime.runtimeId,
            providerId: job.runtime.providerId ?? null,
            displayName: job.runtime.displayName ?? job.runtime.runtimeId,
            version: job.runtime.version ?? null,
        } : null,
        request: job.request ? {
            purpose: job.request.purpose ?? null,
            skillName: job.request.skillName ?? null,
            versionLabel: job.request.versionLabel ?? null,
            source: job.request.source ? {
                repositoryId: job.request.source.repositoryId ?? null,
                skillId: job.request.source.skillId ?? null,
                versionId: job.request.source.versionId ?? null,
                commit: job.request.source.commit ?? null,
                expectedDigest: job.request.source.expectedDigest ?? null,
            } : null,
        } : null,
        modelId: job.modelId ?? null,
        effort: job.effort ?? null,
        permissionMode: job.permissionMode ?? null,
        effectiveModelId: job.effectiveModelId ?? null,
        effectiveEffort: job.effectiveEffort ?? null,
        effectivePermissionMode: job.effectivePermissionMode ?? null,
        conversationStatus: job.conversationStatus ?? null,
        canFollowUp: Boolean(job.threadId),
        conversationError: job.conversationError ? {
            code: job.conversationError.code ?? null,
            message: boundedText(job.conversationError.message, 4_000),
        } : null,
        messages: publicTimeline(job.messages),
        activities: publicTimeline(job.activities),
        error: job.error ? {
            code: job.error.code ?? null,
            message: boundedText(job.error.message, 4_000),
        } : null,
        parsedResult: job.parsedResult ? {
            operation: job.parsedResult.operation ?? null,
            trusted: job.parsedResult.trusted === true,
            verification: job.parsedResult.verification ?? null,
        } : null,
        traceAvailable: Boolean(job.traceReference),
        createdAt: job.createdAt ?? null,
        startedAt: job.startedAt ?? null,
        updatedAt: job.updatedAt ?? null,
        completedAt: job.completedAt ?? null,
    }
}

function publicInstallationOverview(overview) {
    return {
        jobs: (overview?.jobs ?? []).map(publicInstallationJob),
        matrix: (overview?.matrix ?? []).map((entry) => ({
            runtimeId: entry.runtimeId,
            providerId: entry.providerId ?? null,
            displayName: entry.displayName ?? entry.runtimeId,
            skillId: entry.skillId ?? null,
            versionId: entry.versionId ?? null,
            commit: entry.commit ?? null,
            contentDigest: entry.contentDigest ?? null,
            verification: entry.verification ?? "none",
            installedAt: entry.installedAt ?? null,
            trustedJobId: entry.trustedJobId ?? null,
            lastJobId: entry.lastJobId ?? null,
            lastJobStatus: entry.lastJobStatus ?? null,
            lastJobUpdatedAt: entry.lastJobUpdatedAt ?? null,
        })),
    }
}

function createSkillServices({manager, installationManager, installationStore, runtimeServices, revealPath = null}) {
    if (!manager || !installationManager || !installationStore || !runtimeServices) {
        throw new Error("Rolling Skill managed Skill dependencies are required")
    }
    return Object.freeze({
        catalog: () => copy(manager.catalog()),
        get: ({skillId}) => copy(manager.readSkill(requiredText(skillId, "Skill id", 200))),
        path: ({skillId}) => {
            skillId = requiredText(skillId, "Skill id", 200)
            return {skillId, path: manager.skillPath(skillId)}
        },
        versions: (input = {}) => copy(manager.listVersionPage(input)),
        candidateBase: ({skillId}) => manager.candidateBase(requiredText(skillId, "Skill id", 200)),
        createCandidate: (input = {}) => manager.createCandidate(copy(input)),
        release: (input = {}) => manager.releaseVersion(copy(input)),
        deprecate: ({versionId}) => manager.deprecateVersion({
            versionId: requiredText(versionId, "Version id", 200),
        }),
        importSource: (input = {}) => manager.importSource(copy(input)),
        rescan: () => manager.rescanAll(),
        revealRepository: async ({repositoryId}) => {
            if (typeof revealPath !== "function") throw new Error("Opening local repositories is unavailable")
            repositoryId = requiredText(repositoryId, "Repository id", 200)
            await revealPath(manager.repositoryPath(repositoryId))
            return {repositoryId, opened: true}
        },
        installationTargets: () => copy(runtimeServices.list()),
        installations: ({skillId = null} = {}) => publicInstallationOverview(
            installationManager.overview(skillId),
        ),
        installation: ({jobId}) => publicInstallationJob(installationStore.getJob(
            requiredText(jobId, "Installation Job id", 200),
        )),
        startInstallation: async (input = {}) => (await installationManager.start(copy(input))).map(publicInstallationJob),
        cancelInstallation: async ({jobId}) => publicInstallationJob(await installationManager.cancel(
            requiredText(jobId, "Installation Job id", 200),
        )),
        inspectInstallation: async ({jobId}) => publicInstallationJob(await installationManager.inspect(
            requiredText(jobId, "Installation Job id", 200),
        )),
        sendInstallation: async ({jobId, text}) => publicInstallationJob(await installationManager.send(
            requiredText(jobId, "Installation Job id", 200),
            requiredText(text, "Installer message", 120_000),
        )),
    })
}

module.exports = {createSkillServices}
