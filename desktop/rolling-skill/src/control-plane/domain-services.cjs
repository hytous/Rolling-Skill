const {
    CONTROL_METHODS,
    createPublicControlError,
    decodeCursor,
    encodeCursor,
} = require("./contracts.cjs")
const {
    normalizedSkillName,
    RawCaseConflictError,
} = require("../raw-case-store.cjs")
const {isTrustedHumanCapability} = require("./capability-store.cjs")
const {createHash} = require("node:crypto")
const {isAbsolute, relative, resolve, sep} = require("node:path")

const TRUSTED_MUTATION_METHODS = new Set([
    "datasets.clone",
    "datasets.delete",
    "datasets.delete_case",
    "curation.save",
    "curation.discard",
    "rubrics.publish",
    "skills.create_candidate",
    "skills.release",
    "installations.start",
    "installations.cancel",
])

const FILTER_METHODS = Object.freeze({
    "context.get": "runtimeIds",
    "raw_cases.list": "skillIds",
    "runtimes.list": "runtimeIds",
    "datasets.list": "datasetIds",
    "skill_repositories.list": "repositoryIds",
    "skills.list": "skillIds",
    "skill_versions.list": "skillIds",
})

function invalidArgument(method, path, internalMessage = "Invalid control domain input") {
    return createPublicControlError("INVALID_ARGUMENT", {
        details: {method, issues: [{path}]},
        internalMessage,
    })
}

function notFound(resource) {
    return createPublicControlError("NOT_FOUND", {details: {resource}})
}

function resourceChanged(resource) {
    return createPublicControlError("RESOURCE_CHANGED", {details: {resource}})
}

function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
    if (value !== null && typeof value === "object") {
        return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => (
            `${JSON.stringify(key)}:${stableJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function snapshotDigest(value) {
    return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`
}

function immutableSnapshot(value) {
    const snapshot = clone(value)
    const freeze = (candidate) => {
        if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) {
            return candidate
        }
        for (const child of Object.values(candidate)) freeze(child)
        return Object.freeze(candidate)
    }
    return freeze(snapshot)
}

function scopeResolution(scope, executionContext = null) {
    return Object.freeze({
        scope: scope === null ? null : immutableSnapshot(scope),
        executionContext: executionContext === null
            ? null
            : immutableSnapshot(executionContext),
    })
}

function trustedExecution(context, method) {
    const execution = context?.executionContext
    return execution?.method === method && Object.isFrozen(execution) ? execution : null
}

function identifier(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 200
        ? value
        : null
}

function arrayFromInventory(value, keys = []) {
    if (Array.isArray(value)) return value
    for (const key of keys) {
        if (Array.isArray(value?.[key])) return value[key]
    }
    return []
}

function unique(values) {
    return [...new Set(values)]
}

function scopeIds(context, key) {
    const value = context?.scopeFilter?.[key]
    return new Set(Array.isArray(value) ? value : [])
}

function paginate(items, {cursor, limit}) {
    const sequence = cursor === null ? 0 : decodeCursor(cursor)
    const page = items.slice(sequence, sequence + limit)
    const nextSequence = sequence + page.length
    return {
        items: page,
        nextCursor: nextSequence < items.length ? encodeCursor(nextSequence) : null,
    }
}

function sanitizedSkillDetail(detail) {
    if (!detail || typeof detail !== "object") return detail
    const result = clone(detail)
    if (result.repository && typeof result.repository === "object") {
        delete result.repository.managedPath
    }
    if (Array.isArray(result.skill?.warnings)) {
        result.skill.warnings = result.skill.warnings.map(sanitizedWarningMessage)
    }
    delete result.versions
    return result
}

function sanitizedWarningMessage(warning) {
    const message = String(warning ?? "")
    const matches = [
        /file:\/\/\/[^\s]*/iu.exec(message),
        /(^|[\s(<:='"])[A-Za-z]:[\\/]/u.exec(message),
        /(^|[\s(<:='"])\/(?!\/)/u.exec(message),
    ].filter(Boolean)
    if (matches.length === 0) return message
    const pathStart = Math.min(...matches.map((match) =>
        match.index + (match[1]?.length ?? 0),
    ))
    return `${message.slice(0, pathStart)}[absolute path omitted]`.trim()
}

function publicSkillReference(skill) {
    const stableId = identifier(skill?.id) ?? identifier(skill?.skillId)
    const repositoryId = identifier(skill?.repositoryId)
    return {
        ...(stableId === null ? {} : {id: stableId}),
        ...(repositoryId === null ? {} : {repositoryId}),
        name: String(skill?.name ?? ""),
    }
}

function sanitizedRawCasePublicValue(value, seen = new WeakMap()) {
    if (!value || typeof value !== "object") return value
    if (seen.has(value)) return seen.get(value)
    const result = Array.isArray(value) ? [] : {}
    seen.set(value, result)
    for (const [key, child] of Object.entries(value)) {
        result[key] = key === "skill" && child && typeof child === "object"
            ? publicSkillReference(child)
            : sanitizedRawCasePublicValue(child, seen)
    }
    return result
}

function sanitizedRepository(repository) {
    if (!repository || typeof repository !== "object") return repository
    const result = clone(repository)
    delete result.managedPath
    return result
}

function ownFields(value, keys) {
    const result = {}
    for (const key of keys) {
        if (Object.hasOwn(value ?? {}, key)) result[key] = clone(value[key])
    }
    return result
}

function managedRepositorySummary(repository) {
    const summary = ownFields(repository, ["id", "displayName", "defaultBranch"])
    if (typeof repository?.source?.kind === "string") {
        summary.source = ownFields(repository.source, ["kind", "importedAt"])
    }
    return {...summary, ...ownFields(repository, ["createdAt", "updatedAt"])}
}

function managedSkillSummary(skill) {
    const warnings = Array.isArray(skill?.warnings)
        ? skill.warnings.slice(0, 1_000).map((warning) =>
              sanitizedWarningMessage(warning).slice(0, 1_024))
        : []
    return {
        ...ownFields(skill, [
            "id",
            "repositoryId",
            "name",
            "description",
            "skillRoot",
            "manifestPath",
            "status",
            "executableFiles",
            "createdAt",
            "updatedAt",
        ]),
        warnings,
        warningCount: Array.isArray(skill?.warnings) ? skill.warnings.length : 0,
    }
}

function managedVersionSummary(version) {
    return ownFields(version, [
        "id",
        "repositoryId",
        "skillId",
        "commit",
        "contentDigest",
        "state",
        "versionLabel",
        "title",
        "createdBy",
        "optimizationRoundId",
        "optimizationRunId",
        "optimizationEpoch",
        "createdAt",
        "releasedAt",
        "deprecatedAt",
    ])
}

function boundedError(value) {
    if (!value || typeof value !== "object") return null
    const code = identifier(value.code)
    if (code === null) return null
    return {
        code,
        message: safeDiagnosticText(value.message),
    }
}

function safeDiagnosticText(value) {
    return sanitizedWarningMessage(String(value ?? ""))
        .replace(/\b(token|secret|password|socket)\s*[:=]\s*[^\s,;]+/giu, "$1=[redacted]")
        .slice(0, 4_096)
}

function publicApprovalScope(scope) {
    if (!scope || typeof scope !== "object") return undefined
    const result = {}
    for (const key of ["skillIds", "datasetIds", "runtimeIds", "repositoryIds"]) {
        if (!Array.isArray(scope[key])) continue
        result[key] = unique(scope[key].map(identifier).filter(Boolean)).slice(0, 4_096)
    }
    if (scope.budget && typeof scope.budget === "object") {
        const budget = ownFields(scope.budget, [
            "maxDurationMs",
            "maxRuntimeTurns",
            "maxEvaluations",
            "maxTargetExecutions",
            "maxJudgeExecutions",
            "maxTokens",
            "maxReportedCost",
        ])
        if (Object.keys(budget).length > 0) result.budget = budget
    }
    return result
}

function publicApprovalMutation(mutation) {
    if (!mutation || typeof mutation !== "object") return undefined
    const params = mutation.params && typeof mutation.params === "object" ? mutation.params : {}
    const resourceIds = ownFields(params, [
        "datasetId",
        "caseId",
        "repositoryId",
        "skillId",
        "versionId",
        "sessionId",
        "installationId",
        "runId",
    ])
    if (Array.isArray(params.targets)) {
        resourceIds.targetRuntimeIds = unique(params.targets
            .map((target) => identifier(target?.runtimeId))
            .filter(Boolean))
            .slice(0, 4_096)
    }
    const result = {}
    const method = identifier(mutation.method)
    if (method !== null) result.method = method
    if (Object.keys(resourceIds).length > 0) result.resourceIds = resourceIds
    return result
}

function publicApprovalExecution(result, approval) {
    const execution = ownFields(result, ["status", "jobId", "stepId", "approvalId"])
    if (!Object.hasOwn(execution, "jobId")) execution.jobId = approval.jobId
    if (result?.error) execution.error = boundedError(result.error)
    return execution
}

function publicOperatorJob(job) {
    return {
        id: job.id,
        sessionId: job.sessionId,
        parentJobId: job.parentJobId ?? null,
        ...ownFields(job, ["type", "objective", "status"]),
        childJobIds: clone(Array.isArray(job.children) ? job.children : []),
        artifactIds: clone(Array.isArray(job.artifactIds) ? job.artifactIds : []),
        approvalIds: clone(Array.isArray(job.approvalIds) ? job.approvalIds : []),
        ...ownFields(job, ["createdAt", "updatedAt", "startedAt", "completedAt"]),
        ...(Object.hasOwn(job, "error") ? {error: boundedError(job.error)} : {}),
    }
}

function publicApproval(approval) {
    return {
        ...ownFields(approval, [
            "id",
            "jobId",
            "sessionId",
            "stepId",
            "action",
            "expiresAt",
            "status",
            "decision",
            "decisionScope",
            "decidedBy",
            "createdAt",
            "resolvedAt",
        ]),
        ...(Object.hasOwn(approval ?? {}, "risk")
            ? {risk: safeDiagnosticText(approval.risk)}
            : {}),
        ...(Object.hasOwn(approval ?? {}, "scope")
            ? {scope: publicApprovalScope(approval.scope)}
            : {}),
        ...(Object.hasOwn(approval ?? {}, "proposedMutation")
            ? {proposedMutation: publicApprovalMutation(approval.proposedMutation)}
            : {}),
    }
}

function publicCurationSession(session) {
    const error = session?.error
    return {
        ...ownFields(session, [
            "id",
            "datasetId",
            "caseType",
            "status",
            "caseId",
            "createdAt",
            "updatedAt",
        ]),
        ...(Object.hasOwn(session ?? {}, "error")
            ? {error: error === null
                ? null
                : safeDiagnosticText(typeof error === "object" ? error?.message ?? "" : error)}
            : {}),
    }
}

function publicDataset(dataset) {
    return {
        ...ownFields(dataset, [
            "id",
            "name",
            "status",
            "activeRubricVersionId",
            "caseCount",
            "goodcaseCount",
            "badcaseCount",
            "createdAt",
        ]),
        ...(Object.hasOwn(dataset ?? {}, "skillReference")
            ? {skillReference: dataset.skillReference === null
                ? null
                : publicSkillReference(dataset.skillReference)}
            : {}),
    }
}

function publicArtifactReferences(value) {
    const references = []
    const seen = new Set()
    const inputs = [
        ...(Array.isArray(value?.artifactRefs) ? value.artifactRefs : []),
        ...(Array.isArray(value?.artifactIds) ? value.artifactIds : []),
    ]
    for (const input of inputs) {
        const artifact = typeof input === "string" ? {id: input} : input
        const artifactId = identifier(artifact?.id)
        if (artifactId === null || seen.has(artifactId)) continue
        const summary = {id: artifactId}
        for (const [key, limit] of [["kind", 200], ["mediaType", 200], ["sha256", 200]]) {
            if (typeof artifact?.[key] === "string" && artifact[key].trim()) {
                summary[key] = safeDiagnosticText(artifact[key]).slice(0, limit)
            }
        }
        if (
            Number.isSafeInteger(artifact?.sizeBytes) &&
            artifact.sizeBytes >= 0 &&
            artifact.sizeBytes <= 64 * 1024 * 1024
        ) summary.sizeBytes = artifact.sizeBytes
        references.push(summary)
        seen.add(artifactId)
        if (references.length === 100) break
    }
    return references
}

function publicSummaryText(value, limit = 4_096) {
    if (typeof value !== "string" || value.length === 0) return null
    return safeDiagnosticText(value).slice(0, limit)
}

function publicCase(entry) {
    const title = publicSummaryText(entry?.title ?? entry?.question, 500)
    const caseType = ["goodcase", "badcase"].includes(entry?.caseType) ? entry.caseType : null
    const label = identifier(entry?.label) ?? identifier(entry?.caseType)
    const inputSummary = publicSummaryText(entry?.inputSummary ?? entry?.question)
    const outputSummary = publicSummaryText(
        entry?.outputSummary ?? entry?.curated?.referenceAnswer?.summary ?? entry?.answer,
    )
    const artifactRefs = publicArtifactReferences(entry)
    return {
        ...ownFields(entry, ["id", "datasetId"]),
        ...(caseType === null ? {} : {caseType}),
        ...(title === null ? {} : {title}),
        ...(identifier(entry?.status ?? entry?.rubricCalibration?.status) === null
            ? {}
            : {status: identifier(entry?.status ?? entry?.rubricCalibration?.status)}),
        ...(label === null ? {} : {label}),
        ...(inputSummary === null ? {} : {inputSummary}),
        ...(outputSummary === null ? {} : {outputSummary}),
        ...(artifactRefs.length === 0 ? {} : {artifactRefs}),
        ...ownFields(entry, ["createdAt", "updatedAt"]),
    }
}

function publicEvaluationScore(score) {
    if (!score || typeof score !== "object") return null
    const result = {}
    if (Number.isFinite(score.totalScore)) result.totalScore = score.totalScore
    else if (Number.isFinite(score.aScore) && Number.isFinite(score.bScore)) {
        result.totalScore = Math.round((score.aScore + score.bScore + Number.EPSILON) * 10) / 10
    }
    for (const key of ["outcomeTier", "overallVerdict"]) {
        const value = identifier(score[key])
        if (value !== null) result[key] = value
    }
    return Object.keys(result).length === 0 ? null : result
}

function publicEvaluationRuntime(configuration) {
    const runtimeId = identifier(configuration?.runtimeId)
    if (runtimeId === null) return null
    const result = {runtimeId}
    const displayName = publicSummaryText(configuration?.displayName, 500)
    if (displayName !== null) result.displayName = displayName
    if (Object.hasOwn(configuration ?? {}, "modelId")) {
        result.modelId = configuration.modelId === null
            ? null
            : identifier(configuration.modelId)
    }
    if (Object.hasOwn(configuration ?? {}, "effort")) {
        result.effort = PUBLIC_REASONING_EFFORTS.has(configuration.effort)
            ? configuration.effort
            : null
    }
    return result
}

function publicEvaluationResult(result) {
    const score = publicEvaluationScore(result?.computedScore)
    const title = publicSummaryText(result?.title ?? result?.caseSnapshot?.question, 500)
    const reasonSummary = publicSummaryText(
        result?.reasonSummary ?? result?.judgment?.summary ?? result?.judgment?.reason ??
            result?.gradingError,
    )
    const error = result?.error === null || result?.error === undefined
        ? result?.error ?? null
        : publicSummaryText(
            typeof result.error === "object" ? result.error?.message ?? "" : result.error,
        )
    const artifactRefs = publicArtifactReferences(result)
    return {
        id: result.id,
        caseId: result.caseId,
        runtimeId: result.runtimeId ?? result?.runtimeConfiguration?.runtimeId,
        ...(title === null ? {} : {title}),
        status: String(result.status ?? "queued").slice(0, 80),
        ...(identifier(result?.gradingStatus) === null
            ? {}
            : {gradingStatus: identifier(result.gradingStatus)}),
        ...(Object.hasOwn(result ?? {}, "durationMs") &&
            (result.durationMs === null ||
                (Number.isSafeInteger(result.durationMs) && result.durationMs >= 0))
            ? {durationMs: result.durationMs}
            : {}),
        ...(score === null ? {} : {computedScore: score}),
        ...(reasonSummary === null ? {} : {reasonSummary}),
        ...(artifactRefs.length === 0 ? {} : {artifactRefs}),
        ...(Object.hasOwn(result ?? {}, "error") ? {error} : {}),
        ...ownFields(result, ["startedAt", "completedAt"]),
    }
}

function publicEvaluationRun(run, {includeResults = false} = {}) {
    const results = Array.isArray(run?.results) ? run.results : []
    const publicResults = includeResults
        ? results.slice(0, 1_000).map(publicEvaluationResult)
        : null
    const runtimeConfigurations = (Array.isArray(run?.runtimeConfigurations)
        ? run.runtimeConfigurations
        : [])
        .map(publicEvaluationRuntime)
        .filter(Boolean)
        .slice(0, 32)
    const counts = {queued: 0, running: 0, completed: 0, failed: 0, cancelled: 0}
    for (const result of results) {
        const status = Object.hasOwn(counts, result?.status) ? result.status : "failed"
        counts[status] += 1
    }
    const datasetId = run?.datasetId ?? run?.datasetSnapshot?.id
    const datasetName = publicSummaryText(run?.datasetSnapshot?.name, 500)
    const skillReference = run?.skillReference && typeof run.skillReference === "object"
        ? publicSkillReference(run.skillReference)
        : null
    const artifactRefs = publicArtifactReferences(run)
    const error = Object.hasOwn(run ?? {}, "error")
        ? run.error === null
            ? null
            : publicSummaryText(typeof run.error === "object" ? run.error?.message ?? "" : run.error)
        : undefined
    return {
        id: run.id,
        datasetId,
        ...(run?.datasetSnapshot?.id ? {datasetSnapshot: {
            id: run.datasetSnapshot.id,
            ...(datasetName === null ? {} : {name: datasetName}),
        }} : {}),
        ...ownFields(run, ["selectionMode", "activationMode"]),
        ...(skillReference === null ? {} : {skillReference}),
        status: String(run?.status ?? "queued").slice(0, 80),
        caseCount: Number.isSafeInteger(run?.caseCount)
            ? run.caseCount
            : Array.isArray(run?.caseSnapshots) ? run.caseSnapshots.length : 0,
        runtimeCount: Number.isSafeInteger(run?.runtimeCount)
            ? run.runtimeCount
            : runtimeConfigurations.length,
        resultCount: results.length,
        progress: {total: results.length, ...counts},
        ...(runtimeConfigurations.length === 0 ? {} : {runtimeConfigurations}),
        ...(publicResults === null ? {} : {
            results: publicResults,
            resultsTruncated: publicResults.length < results.length,
        }),
        ...(artifactRefs.length === 0 ? {} : {artifactRefs}),
        ...(error === undefined ? {} : {error}),
        ...ownFields(run, ["createdAt", "startedAt", "completedAt"]),
    }
}

function publicRubricVersion(version) {
    return ownFields(version, ["id", "datasetId", "version", "createdAt", "publishedAt"])
}

const PUBLIC_REASONING_EFFORTS = new Set([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
])

function publicInstallation(job) {
    const source = job?.request?.source ?? {}
    return {
        id: job.id,
        parentJobId: job.parentJobId ?? null,
        ...ownFields(job, ["operation", "status"]),
        repositoryId: source.repositoryId,
        skillId: source.skillId,
        ...ownFields(source, ["versionId"]),
        runtimeId: job?.runtime?.runtimeId,
        ...ownFields(job.runtime, ["providerId"]),
        modelId: job.modelId ?? null,
        effort: PUBLIC_REASONING_EFFORTS.has(job.effort) ? job.effort : null,
        ...(Object.hasOwn(job, "error") ? {error: boundedError(job.error)} : {}),
        ...ownFields(job, ["createdAt", "updatedAt", "completedAt"]),
    }
}

function assertCurationIdentity(session, {sessionId = null, datasetId}) {
    if (
        identifier(session?.id) === null ||
        (sessionId !== null && session.id !== sessionId) ||
        session?.datasetId !== datasetId
    ) throw new Error("Curation session identity did not match its Dataset")
    return session
}

function assertInstallationIdentity(job, expected, {inspection = false} = {}) {
    const source = job?.request?.source ?? {}
    const expectedSource = expected?.request?.source ?? {}
    if (
        identifier(job?.id) === null ||
        (inspection ? job?.parentJobId !== expected?.id : job?.id !== expected?.id) ||
        job?.operation !== (inspection ? "inspect" : expected?.operation) ||
        job?.runtime?.runtimeId !== expected?.runtime?.runtimeId ||
        source.repositoryId !== expectedSource.repositoryId ||
        source.skillId !== expectedSource.skillId ||
        source.versionId !== expectedSource.versionId
    ) throw new Error("Skill installation identity did not match its resolved request")
    return job
}

function createDomainServices(dependencies = {}) {
    const {
        rawCaseStore,
        evaluationStore,
        evaluationRunner,
        managedSkillManager,
        managedSkillStore,
        operatorJobStore,
        operatorJobEngine,
        operatorSessionManager,
        curationManager,
        rubricManager,
        skillInstallationStore,
        skillInstallationManager,
        optimizationControlService,
        listDatasets,
        listRawCaseSkills,
        listRuntimes,
        listModelsForRuntime,
        dispatchRawCase,
        startEvaluation,
    } = dependencies

    async function runtimeInventory() {
        const inventory = typeof listRuntimes === "function" ? await listRuntimes() : []
        return clone(arrayFromInventory(inventory, ["available", "runtimes", "data"]))
    }

    async function requireRuntime(runtimeId) {
        const runtime = (await runtimeInventory()).find((entry) => entry?.runtimeId === runtimeId)
        if (!runtime) throw notFound("runtime")
        return runtime
    }

    function requireRuntimeFrom(inventory, runtimeId) {
        const runtime = inventory.find((entry) => entry?.runtimeId === runtimeId)
        if (!runtime) throw notFound("runtime")
        return runtime
    }

    async function managedSkillCatalog() {
        const catalog = typeof managedSkillManager?.catalog === "function"
            ? await managedSkillManager.catalog()
            : typeof managedSkillManager?.overview === "function"
                ? await managedSkillManager.overview()
            : {}
        return {
            repositories: clone(arrayFromInventory(catalog, ["repositories"]))
                .map(sanitizedRepository),
            skills: clone(arrayFromInventory(catalog, ["skills"])),
        }
    }

    async function managedSkillInventory() {
        return (await managedSkillCatalog()).skills
    }

    async function managedSkillVersionPage(input, skillIds) {
        if (typeof managedSkillManager?.listVersionPage !== "function") {
            throw new Error("Managed Skill version paging is unavailable")
        }
        let page
        try {
            page = await managedSkillManager.listVersionPage({
                skillIds: [...skillIds],
                skillId: input.skillId,
                cursor: input.cursor,
                limit: input.limit,
            })
        } catch (error) {
            if (
                error?.code === "MANAGED_SKILL_VERSION_CURSOR_INVALID" ||
                error?.code === "MANAGED_SKILL_VERSION_CURSOR_STALE"
            ) {
                throw invalidArgument(
                    "skill_versions.list",
                    ["cursor"],
                    "Managed Skill version cursor is invalid or stale",
                )
            }
            throw error
        }
        const versions = arrayFromInventory(page, ["versions"])
        if (versions.length > input.limit || versions.length > 100) {
            throw new Error("Managed Skill version page exceeded its requested limit")
        }
        return {
            versions: clone(versions),
            nextCursor: page?.nextCursor ?? null,
        }
    }

    async function rawCaseSkillInventory() {
        if (typeof listRawCaseSkills !== "function") return managedSkillInventory()
        const inventory = await listRawCaseSkills()
        return clone(arrayFromInventory(inventory, ["skills", "available", "data"]))
    }

    function resolveSkillReferenceFrom(reference, inventory, {
        grant = null,
        method = null,
        path = [],
        toolSupplied = false,
    } = {}) {
        if (!reference || typeof reference !== "object") throw notFound("skill")
        if (toolSupplied && typeof reference.path === "string") {
            throw invalidArgument(
                method,
                [...path, "path"],
                "Tool-supplied Skill paths are not accepted",
            )
        }

        const stableId = identifier(reference.skillId) ?? identifier(reference.id)
        let candidates = matchingSkillReferences(reference, inventory)
        if (grant !== null) {
            const grantedIds = new Set(
                Array.isArray(grant?.scopes?.skillIds) ? grant.scopes.skillIds : [],
            )
            candidates = candidates.filter((skill) => grantedIds.has(skill?.id))
        }
        if (candidates.length === 0) throw notFound("skill")
        if (candidates.length > 1) {
            throw invalidArgument(
                method,
                stableId === null ? [...path, "name"] : [...path, "skillId"],
                "Skill reference is ambiguous inside the capability scope",
            )
        }
        return candidates[0]
    }

    function matchingSkillReferences(reference, inventory) {
        const stableId = identifier(reference?.skillId) ?? identifier(reference?.id)
        if (stableId !== null) {
            return inventory.filter((skill) => skill?.id === stableId)
        }
        const name = identifier(reference?.name)
        if (name === null) return []
        const normalizedName = normalizedSkillName(name)
        return inventory.filter(
            (skill) => normalizedSkillName(skill?.name) === normalizedName,
        )
    }

    async function resolveSkillReference(reference, options) {
        return resolveSkillReferenceFrom(reference, await rawCaseSkillInventory(), options)
    }

    function canonicalSkillReference(skill) {
        return {id: skill.id, name: skill.name}
    }

    async function rawCaseInventory(skillName = null) {
        if (typeof rawCaseStore?.list !== "function") return []
        return clone(await rawCaseStore.list({skillName}))
    }

    async function requireRawCase(id) {
        let rawCase = null
        if (typeof rawCaseStore?.get === "function") rawCase = await rawCaseStore.get(id)
        else rawCase = (await rawCaseInventory()).find((entry) => entry?.id === id) ?? null
        if (!rawCase || rawCase.id !== id) throw notFound("raw_case")
        return clone(rawCase)
    }

    async function datasetInventory() {
        if (typeof listDatasets === "function") return clone(await listDatasets())
        if (typeof evaluationStore?.listDatasets !== "function") return []
        return clone(await evaluationStore.listDatasets())
    }

    async function requireDataset(datasetId) {
        const summary = (await datasetInventory()).find((entry) => entry?.id === datasetId)
        if (!summary) throw notFound("dataset")
        if (typeof evaluationStore?.getDataset !== "function") return summary
        try {
            const dataset = await evaluationStore.getDataset(datasetId)
            if (!dataset || dataset.id !== datasetId) throw notFound("dataset")
            return clone(dataset)
        } catch (error) {
            throw notFound("dataset")
        }
    }

    async function casesForDataset(datasetId) {
        if (typeof evaluationStore?.listCases !== "function") return []
        return clone(await evaluationStore.listCases(datasetId))
            .filter((entry) => entry?.datasetId === datasetId)
    }

    async function activeRubricForDataset(dataset) {
        if (!dataset?.activeRubricVersionId) return null
        if (typeof evaluationStore?.getActiveDatasetRubric !== "function") {
            throw new Error("Dataset Rubric store unavailable")
        }
        let rubric
        try {
            rubric = await evaluationStore.getActiveDatasetRubric(dataset.id)
        } catch {
            throw notFound("version")
        }
        if (
            !rubric ||
            rubric.id !== dataset.activeRubricVersionId ||
            rubric.datasetId !== dataset.id
        ) throw notFound("version")
        return clone(rubric)
    }

    async function evaluationStartSnapshot(input) {
        const dataset = await requireDataset(input.datasetId)
        const cases = await casesForDataset(input.datasetId)
        const caseIds = new Set(cases.map((entry) => entry.id))
        if (input.caseIds.some((caseId) => !caseIds.has(caseId))) {
            throw notFound("case")
        }
        const inventory = await runtimeInventory()
        const runtimes = input.runtimeConfigurations.map((profile) =>
            requireRuntimeFrom(inventory, profile.runtimeId),
        )
        const judgeRuntime = requireRuntimeFrom(
            inventory,
            input.judgeConfiguration.runtimeId,
        )
        return {dataset, cases, runtimes, judgeRuntime}
    }

    async function runInventory(datasetId = null) {
        const list = evaluationStore?.listEvaluationRunSummaries ??
            evaluationStore?.listEvaluationRuns
        if (typeof list !== "function") return []
        const runs = clone(await list.call(evaluationStore, datasetId))
        return Array.isArray(runs)
            ? runs.filter((entry) => datasetId === null || entry?.datasetId === datasetId)
            : []
    }

    async function requireEvaluationRun(runId) {
        const summary = (await runInventory(null)).find((entry) => entry?.id === runId)
        if (!summary) throw notFound("evaluation_run")
        if (typeof evaluationStore?.getEvaluationRun !== "function") return summary
        try {
            const run = await evaluationStore.getEvaluationRun(runId)
            if (!run || run.id !== runId) throw notFound("evaluation_run")
            return clone(run)
        } catch (error) {
            throw notFound("evaluation_run")
        }
    }

    async function requireSkill(skillId) {
        const skill = (await managedSkillInventory()).find((entry) => entry?.id === skillId)
        if (!skill) throw notFound("skill")
        return skill
    }

    async function requireManagedSkillSelection(skillId, repositoryId) {
        const skill = await requireSkill(skillId)
        if (skill.repositoryId !== repositoryId) throw notFound("skill")
        return skill
    }

    function requireManagedVersion(versionId, {skillId, repositoryId}) {
        if (typeof managedSkillStore?.getVersion !== "function") {
            throw new Error("Managed Skill version store unavailable")
        }
        let version
        try {
            version = managedSkillStore.getVersion(versionId)
        } catch {
            throw notFound("version")
        }
        if (version?.id !== versionId || version.skillId !== skillId ||
            version.repositoryId !== repositoryId) throw notFound("version")
        return clone(version)
    }

    function requireOperatorJob(jobId, sessionId, grant = null) {
        if (typeof operatorJobStore?.getJob !== "function") throw new Error("Operator Job store unavailable")
        let job
        try {
            job = operatorJobStore.getJob(jobId)
        } catch {
            throw notFound("job")
        }
        if (
            job?.id !== jobId ||
            (job.sessionId !== sessionId && !isTrustedHumanCapability(grant))
        ) throw notFound("job")
        return clone(job)
    }

    function operatorJobs(sessionId) {
        if (typeof operatorJobStore?.listJobs !== "function") return []
        return clone(operatorJobStore.listJobs({sessionId})).filter(
            (job) => job?.sessionId === sessionId,
        )
    }

    function requireOperatorApproval(approvalId, sessionId, grant = null) {
        if (typeof operatorJobStore?.getApproval !== "function") {
            throw new Error("Operator approval store unavailable")
        }
        let approval
        try {
            approval = operatorJobStore.getApproval(approvalId)
        } catch {
            throw notFound("approval")
        }
        if (
            approval?.id !== approvalId ||
            (approval.sessionId !== sessionId && !isTrustedHumanCapability(grant))
        ) {
            throw notFound("approval")
        }
        requireOperatorJob(approval.jobId, sessionId, grant)
        return clone(approval)
    }

    function approvalsForSession(sessionId, jobId = null) {
        const jobs = jobId === null
            ? operatorJobs(sessionId)
            : [requireOperatorJob(jobId, sessionId)]
        if (typeof operatorJobStore?.listApprovals !== "function") return []
        return jobs.flatMap((job) => clone(operatorJobStore.listApprovals(job.id)))
            .filter((approval) => approval?.jobId === jobId || jobId === null)
            .filter((approval) => approval?.sessionId === sessionId)
    }

    function requireCurationSession(sessionId) {
        if (typeof evaluationStore?.getCurationSession !== "function") {
            throw new Error("Curation store unavailable")
        }
        let session
        try {
            session = evaluationStore.getCurationSession(sessionId)
        } catch {
            throw notFound("curation_session")
        }
        if (!session || session.id !== sessionId) throw notFound("curation_session")
        return clone(session)
    }

    function requireRubricSession(sessionId) {
        if (typeof evaluationStore?.getRubricSession !== "function") {
            throw new Error("Rubric store unavailable")
        }
        let session
        try {
            session = evaluationStore.getRubricSession(sessionId)
        } catch {
            throw notFound("rubric_session")
        }
        if (!session || session.id !== sessionId) throw notFound("rubric_session")
        return clone(session)
    }

    function requireInstallation(installationId) {
        if (typeof skillInstallationStore?.getJob !== "function") {
            throw new Error("Skill installation store unavailable")
        }
        let installation
        try {
            installation = skillInstallationStore.getJob(installationId)
        } catch {
            throw notFound("installation")
        }
        if (!installation || installation.id !== installationId) throw notFound("installation")
        return clone(installation)
    }

    async function candidateBase(skill) {
        if (typeof managedSkillManager?.candidateBase === "function") {
            const base = await managedSkillManager.candidateBase(skill.id)
            if (base?.skillId !== skill.id || base?.repositoryId !== skill.repositoryId) {
                throw new Error("Managed Skill Candidate base identity did not match")
            }
            return ownFields(base, [
                "repositoryId",
                "skillId",
                "commit",
                "contentDigest",
                "dirty",
            ])
        }
        const versions = typeof managedSkillStore?.listVersions === "function"
            ? managedSkillStore.listVersions(skill.id)
            : []
        const latest = versions.at(-1) ?? null
        return {
            repositoryId: skill.repositoryId,
            skillId: skill.id,
            commit: latest?.commit ?? null,
            contentDigest: latest?.contentDigest ?? null,
            dirty: null,
        }
    }

    async function mutationFactsFromExecution(method, input, execution) {
        if (!TRUSTED_MUTATION_METHODS.has(method)) return null
        if (!execution || execution.method !== method) {
            throw new Error("Trusted mutation execution snapshot is missing")
        }
        if (method === "datasets.delete") {
            const cases = execution.cases ?? await casesForDataset(input.datasetId)
            const runs = execution.runs ?? await runInventory(input.datasetId)
            return {
                method,
                datasetId: input.datasetId,
                datasetRevision: execution.dataset?.revision ?? execution.dataset?.updatedAt ?? null,
                caseIds: cases.map((entry) => entry.id).sort(),
                runIds: runs.map((entry) => entry.id).sort(),
                resourceDigest: snapshotDigest({dataset: execution.dataset, cases, runs}),
            }
        }
        if (method === "datasets.clone") {
            const cases = [...execution.cases].sort((left, right) =>
                String(left.id).localeCompare(String(right.id)))
            return {
                method,
                sourceDatasetId: input.sourceDatasetId,
                datasetRevision: execution.dataset?.revision ?? execution.dataset?.updatedAt ?? null,
                caseRevisions: cases.map((entry) => ({
                    id: entry.id,
                    revision: entry.revision ?? entry.updatedAt ?? null,
                })),
                rubricVersionId: execution.rubric?.id ?? null,
                resourceDigest: snapshotDigest({
                    dataset: execution.dataset,
                    cases,
                    rubric: execution.rubric,
                    skill: execution.skill,
                }),
            }
        }
        if (method === "datasets.delete_case") {
            const runs = execution.runs ?? await runInventory(input.datasetId)
            return {
                method,
                datasetId: input.datasetId,
                caseId: input.caseId,
                datasetRevision: execution.dataset?.revision ?? execution.dataset?.updatedAt ?? null,
                caseRevision: execution.case?.revision ?? execution.case?.updatedAt ?? null,
                runIds: runs.map((entry) => entry.id).sort(),
                resourceDigest: snapshotDigest({
                    dataset: execution.dataset,
                    case: execution.case,
                    runs,
                }),
            }
        }
        if (method === "curation.save" || method === "curation.discard") {
            return {
                method,
                sessionId: input.sessionId,
                datasetId: execution.session.datasetId,
                sessionRevision: execution.session.revision ?? execution.session.updatedAt ?? null,
                resourceDigest: snapshotDigest(execution.session),
            }
        }
        if (method === "rubrics.publish") {
            return {
                method,
                sessionId: input.sessionId,
                datasetId: input.datasetId,
                sessionRevision: execution.session.revision ?? execution.session.updatedAt ?? null,
                resourceDigest: snapshotDigest(execution.session),
            }
        }
        if (method === "skills.create_candidate") {
            const base = execution.candidateBase ?? await candidateBase(execution.skill)
            return {
                method,
                repositoryId: input.repositoryId,
                skillId: input.skillId,
                baseCommit: base.commit ?? null,
                baseContentDigest: base.contentDigest ?? null,
                dirty: base.dirty ?? null,
                resourceDigest: snapshotDigest({skill: execution.skill, base}),
            }
        }
        if (method === "skills.release") {
            return {
                method,
                repositoryId: input.repositoryId,
                skillId: input.skillId,
                versionId: input.versionId,
                candidateCommit: execution.version.commit,
                candidateDigest: execution.version.contentDigest,
                candidateState: execution.version.state,
                versionLabel: input.versionLabel,
                resourceDigest: snapshotDigest(execution.version),
            }
        }
        if (method === "installations.start") {
            const targets = execution.runtimes.map((runtime) => ({
                runtimeId: runtime.runtimeId,
                providerId: runtime.providerId,
                descriptorDigest: snapshotDigest(runtime),
            })).sort((left, right) => left.runtimeId.localeCompare(right.runtimeId))
            return {
                method,
                repositoryId: input.repositoryId,
                skillId: input.skillId,
                versionId: input.versionId,
                versionCommit: execution.version.commit,
                versionDigest: execution.version.contentDigest,
                targets,
                resourceDigest: snapshotDigest({version: execution.version, targets}),
            }
        }
        const installation = execution.installation
        const source = installation.request?.source ?? {}
        return {
            method,
            installationId: input.installationId,
            repositoryId: source.repositoryId,
            skillId: source.skillId,
            versionId: source.versionId ?? null,
            runtimeId: installation.runtime?.runtimeId,
            observedState: installation.status,
            resourceDigest: snapshotDigest(installation),
        }
    }

    async function resolveTrustedFacts({method, params, controlContext}) {
        if (!TRUSTED_MUTATION_METHODS.has(method)) return null
        let execution = trustedExecution(controlContext, method)
        if (execution === null) {
            execution = (await resolveScope(method, params, controlContext?.grant)).executionContext
        }
        return immutableSnapshot(await mutationFactsFromExecution(method, params, execution))
    }

    async function assertMutationCurrent(method, input, context) {
        const expected = context?.trustedFacts?.methodFacts
        if (expected === undefined) return
        if (!expected || expected.method !== method) throw resourceChanged("dataset")
        const currentResolution = await resolveScope(method, input, context?.grant)
        const current = await mutationFactsFromExecution(
            method,
            input,
            currentResolution.executionContext,
        )
        if (stableJson(current) !== stableJson(expected)) {
            const resource = method.startsWith("datasets.delete_case") ? "case"
                : method.startsWith("datasets.") ? "dataset"
                : method.startsWith("curation.") ? "curation_session"
                : method.startsWith("rubrics.") ? "rubric_session"
                : method === "skills.create_candidate" ? "skill"
                : method.startsWith("skills.") ? "version"
                : "installation"
            throw resourceChanged(resource)
        }
    }

    async function requireSkillDetail(skillId) {
        const skill = await requireSkill(skillId)
        if (typeof managedSkillManager?.readSkill !== "function") throw notFound("skill")
        let detail
        try {
            detail = sanitizedSkillDetail(await managedSkillManager.readSkill(skillId, {
                includeVersions: false,
            }))
        } catch {
            throw notFound("skill")
        }
        if (detail?.skill?.id !== skill.id) throw notFound("skill")
        return {detail, skill}
    }

    async function filteredRawCases(input, context, execution = null) {
        const allowed = scopeIds(context, "skillIds")
        if (allowed.size === 0) return []
        const records = execution?.rawCases ?? await rawCaseInventory(input.skillName)
        const skills = execution?.skills ?? await rawCaseSkillInventory()
        const visible = []
        for (const record of records) {
            const stableId = identifier(record?.skill?.skillId) ?? identifier(record?.skill?.id)
            const candidates = stableId === null
                ? skills.filter((skill) =>
                    normalizedSkillName(skill?.name) ===
                        normalizedSkillName(record?.skill?.name))
                : skills.filter((skill) => skill?.id === stableId)
            if (
                candidates.length > 0 &&
                candidates.every((candidate) => allowed.has(candidate?.id))
            ) visible.push(record)
        }
        return visible
    }

    async function filterResolution(method, input, grant) {
        const key = FILTER_METHODS[method]
        const granted = new Set(Array.isArray(grant?.scopes?.[key]) ? grant.scopes[key] : [])
        if (method === "skill_versions.list") {
            const catalog = await managedSkillCatalog()
            const skillIds = unique(catalog.skills
                .map((entry) => entry?.id)
                .filter((id) => granted.has(id)))
            const versionPage = await managedSkillVersionPage(input, skillIds)
            return scopeResolution({
                method,
                mode: "filter",
                skillIds,
            }, {method, versionPage})
        }
        let inventoryIds = []
        let executionContext
        if (key === "runtimeIds") {
            const runtimes = await runtimeInventory()
            inventoryIds = runtimes.map((entry) => entry?.runtimeId)
            executionContext = {method, runtimes}
        } else if (key === "datasetIds") {
            const datasets = await datasetInventory()
            inventoryIds = datasets.map((entry) => entry?.id)
            executionContext = {method, datasets}
        } else if (key === "repositoryIds") {
            const catalog = await managedSkillCatalog()
            inventoryIds = catalog.repositories.map((entry) => entry?.id)
            executionContext = {method, catalog}
        } else {
            const catalog = method === "skills.list"
                ? await managedSkillCatalog()
                : null
            const skills = catalog?.skills ?? await rawCaseSkillInventory()
            inventoryIds = skills.map((entry) => entry?.id)
            executionContext = {
                method,
                skills,
                catalog,
                rawCases: method === "raw_cases.list"
                    ? await rawCaseInventory(input.skillName)
                    : null,
            }
        }
        return scopeResolution({
            method,
            mode: "filter",
            [key]: unique(inventoryIds.filter((id) => granted.has(id))),
        }, executionContext)
    }

    async function resolveScope(method, input, grant) {
        if (Object.hasOwn(FILTER_METHODS, method)) {
            return filterResolution(method, input, grant)
        }
        if (["jobs.get", "jobs.pause", "jobs.resume", "jobs.stop"].includes(method)) {
            return scopeResolution(null, {
                method,
                job: requireOperatorJob(input.jobId, grant?.sessionId, grant),
            })
        }
        if (method === "jobs.list") {
            return scopeResolution(null, {
                method,
                jobs: operatorJobs(grant?.sessionId),
            })
        }
        if (method === "approvals.list") {
            return scopeResolution(null, {
                method,
                approvals: approvalsForSession(grant?.sessionId, input.jobId),
            })
        }
        if (method === "approvals.resolve") {
            return scopeResolution(null, {
                method,
                approval: requireOperatorApproval(input.approvalId, grant?.sessionId, grant),
            })
        }
        if (["datasets.create", "skills.diff", "skills.create_candidate", "skills.release", "installations.start"].includes(method)) {
            const skill = await requireManagedSkillSelection(input.skillId, input.repositoryId)
            const execution = {method, skill}
            if (method === "skills.diff") {
                execution.baseVersion = requireManagedVersion(input.baseVersionId, input)
                execution.candidateVersion = requireManagedVersion(input.candidateVersionId, input)
            } else if (method === "skills.release" || method === "installations.start") {
                execution.version = requireManagedVersion(input.versionId, input)
            }
            if (method === "skills.create_candidate") {
                execution.candidateBase = await candidateBase(skill)
            }
            if (method === "installations.start") {
                const runtimes = await runtimeInventory()
                execution.runtimes = input.targets.map((target) =>
                    requireRuntimeFrom(runtimes, target.runtimeId))
            }
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "skill", id: skill.id},
                skillIds: [skill.id],
                repositoryIds: [skill.repositoryId],
            }, execution)
        }
        if (method === "datasets.clone") {
            const dataset = await requireDataset(input.sourceDatasetId)
            const skillId = identifier(dataset.skillReference?.id)
            const repositoryId = identifier(dataset.skillReference?.repositoryId)
            if (skillId === null || repositoryId === null) throw notFound("skill")
            const skill = await requireManagedSkillSelection(skillId, repositoryId)
            const availableCases = await casesForDataset(dataset.id)
            const byId = new Map(availableCases.map((entry) => [entry.id, entry]))
            const cases = input.caseIds.map((caseId) => {
                const entry = byId.get(caseId)
                if (!entry) throw notFound("case")
                return entry
            })
            const rubric = await activeRubricForDataset(dataset)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "dataset", id: dataset.id},
                skillIds: [skill.id],
                datasetIds: [dataset.id],
                repositoryIds: [skill.repositoryId],
            }, {method, dataset, cases, rubric, skill})
        }
        if (method === "curation.start") {
            return scopeResolution(null, {method, dataset: await requireDataset(input.datasetId)})
        }
        if (["curation.message", "curation.save", "curation.discard"].includes(method)) {
            const session = requireCurationSession(input.sessionId)
            await requireDataset(session.datasetId)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "curation_session", id: session.id},
                datasetIds: [session.datasetId],
            }, {method, session})
        }
        if (method === "rubrics.publish") {
            const session = requireRubricSession(input.sessionId)
            if (session.datasetId !== input.datasetId) throw notFound("rubric_session")
            await requireDataset(session.datasetId)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "rubric_session", id: session.id},
                datasetIds: [session.datasetId],
            }, {method, session})
        }
        if (["installations.get", "installations.cancel", "installations.inspect"].includes(method)) {
            const installation = requireInstallation(input.installationId)
            const source = installation.request?.source ?? {}
            await requireManagedSkillSelection(source.skillId, source.repositoryId)
            await requireRuntime(installation.runtime?.runtimeId)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "installation", id: installation.id},
                skillIds: [source.skillId],
                repositoryIds: [source.repositoryId],
                runtimeIds: [installation.runtime.runtimeId],
            }, {method, installation})
        }
        if (method === "optimization.preflight" || method === "optimization.start") {
            if (typeof optimizationControlService?.preflight !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            const {idempotencyKey: _idempotencyKey, ...config} = input
            const preflight = await optimizationControlService.preflight(config)
            return scopeResolution({
                method,
                mode: "access",
                skillIds: [preflight.baseline.skillId],
                datasetIds: [preflight.dataset.id],
                runtimeIds: unique([
                    input.operator.runtimeId,
                    input.judge.runtimeId,
                    ...input.targets.map((target) => target.runtimeId),
                ]),
                repositoryIds: [preflight.baseline.repositoryId],
            }, {method, preflight})
        }
        if (method.startsWith("optimization.")) {
            if (typeof optimizationControlService?.scope !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return scopeResolution({
                method,
                mode: "access",
                ...optimizationControlService.scope(input.runId),
            }, {method, runId: input.runId})
        }
        if (method === "datasets.delete") {
            return scopeResolution(null, {
                method,
                dataset: await requireDataset(input.datasetId),
                cases: await casesForDataset(input.datasetId),
                runs: await runInventory(input.datasetId),
            })
        }
        if (method === "datasets.delete_case") {
            const dataset = await requireDataset(input.datasetId)
            const selectedCase = (await casesForDataset(dataset.id))
                .find((entry) => entry.id === input.caseId)
            if (!selectedCase) throw notFound("case")
            return scopeResolution(null, {
                method,
                dataset,
                case: selectedCase,
                runs: await runInventory(input.datasetId),
            })
        }
        if (method === "evaluations.list" && input.datasetId === null) {
            const granted = new Set(Array.isArray(grant?.scopes?.datasetIds)
                ? grant.scopes.datasetIds
                : [])
            const datasets = await datasetInventory()
            const runs = await runInventory(null)
            return scopeResolution({
                method,
                mode: "filter",
                datasetIds: datasets
                    .map((entry) => entry?.id)
                    .filter((id) => granted.has(id)),
            }, {method, datasets, runs})
        }
        if (method === "raw_cases.enqueue") {
            const inventory = await rawCaseSkillInventory()
            const skills = []
            for (let index = 0; index < input.cases.length; index += 1) {
                skills.push(resolveSkillReferenceFrom(input.cases[index].skill, inventory, {
                    grant,
                    method,
                    path: ["cases", index, "skill"],
                    toolSupplied: true,
                }))
            }
            return scopeResolution(
                {method, mode: "access", skillIds: unique(skills.map((skill) => skill.id))},
                {method, skills},
            )
        }
        if (method === "raw_cases.update" || method === "raw_cases.dispatch") {
            const rawCase = await requireRawCase(input.id)
            const inventory = await rawCaseSkillInventory()
            const legacyOwner = identifier(rawCase.skill?.skillId) === null &&
                identifier(rawCase.skill?.id) === null
            const ownerCandidates = matchingSkillReferences(rawCase.skill, inventory)
            if (ownerCandidates.length === 0) throw notFound("skill")
            const explicitTargetId = method === "raw_cases.update"
                ? identifier(input.changes.skill?.id)
                : null
            const ambiguousOwners = legacyOwner && ownerCandidates.length > 1
                ? ownerCandidates
                : []
            const explicitRebind = ambiguousOwners.length > 1 && explicitTargetId !== null
            if (ambiguousOwners.length > 1 && !explicitRebind) {
                throw invalidArgument(
                    method,
                    ["id", "skill", "name"],
                    "Stored legacy Skill owner is ambiguous",
                )
            }
            const skill = explicitRebind
                ? null
                : resolveSkillReferenceFrom(rawCase.skill, inventory, {method})
            const skillIds = explicitRebind
                ? ambiguousOwners.map((candidate) => candidate?.id)
                : [skill.id]
            if (skillIds.some((skillId) => identifier(skillId) === null)) {
                throw invalidArgument(method, ["id"], "Legacy Skill owners require stable IDs")
            }
            let targetSkill = null
            if (method === "raw_cases.update" && input.changes.skill) {
                targetSkill = resolveSkillReferenceFrom(
                    input.changes.skill,
                    inventory,
                    {
                        method,
                        path: ["changes", "skill"],
                        toolSupplied: true,
                    },
                )
                skillIds.push(targetSkill.id)
            }
            let runtime = null
            if (method === "raw_cases.dispatch") {
                runtime = await requireRuntime(input.runtime.runtimeId)
            }
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "raw_case", id: rawCase.id},
                skillIds: unique(skillIds),
            }, {method, rawCase, runtime, skill, ownerSkills: ambiguousOwners, targetSkill})
        }
        if (method === "evaluations.get" || method === "evaluations.cancel") {
            const run = await requireEvaluationRun(input.runId)
            return scopeResolution({
                method,
                mode: "access",
                subject: {kind: "evaluation_run", id: run.id},
                datasetIds: [run.datasetId],
            }, {method, run})
        }
        if (method === "evaluations.start") {
            return scopeResolution(null, {
                method,
                ...await evaluationStartSnapshot(input),
            })
        }
        if (method === "runtimes.models") {
            return scopeResolution(null, {
                method,
                runtime: await requireRuntime(input.runtimeId),
            })
        }
        if (method === "datasets.get") {
            const dataset = await requireDataset(input.datasetId)
            return scopeResolution(null, {
                method,
                dataset,
                cases: input.includeCases ? await casesForDataset(dataset.id) : null,
            })
        }
        if (method === "evaluations.list" && input.datasetId !== null) {
            const dataset = await requireDataset(input.datasetId)
            return scopeResolution(null, {
                method,
                dataset,
                runs: await runInventory(dataset.id),
            })
        }
        if (method === "skills.get") {
            return scopeResolution(null, {
                method,
                ...await requireSkillDetail(input.skillId),
            })
        }
        return scopeResolution(null)
    }

    async function controlOperatorJob(operation, input, context) {
        const method = `jobs.${operation}`
        const execution = trustedExecution(context, method)
        const job = execution?.job ?? requireOperatorJob(input.jobId, context?.sessionId)
        if (job.parentJobId !== null && job.parentJobId !== undefined) {
            if (operation !== "stop") {
                throw invalidArgument(
                    method,
                    ["jobId"],
                    `Child Operator Jobs do not support ${operation}`,
                )
            }
            if (typeof operatorJobEngine?.cancel !== "function") {
                throw new Error("Operator child Job cancellation unavailable")
            }
            await operatorJobEngine.cancel(job.id)
            return {job: publicOperatorJob(requireOperatorJob(
                job.id,
                context.sessionId,
                context.grant,
            ))}
        }
        if (typeof operatorSessionManager?.[operation] !== "function") {
            throw new Error("Operator session control unavailable")
        }
        await operatorSessionManager[operation](job.sessionId)
        return {job: publicOperatorJob(requireOperatorJob(
            job.id,
            context.sessionId,
            context.grant,
        ))}
    }

    const handlers = {
        async "context.get"(_input, context) {
            const allowed = scopeIds(context, "runtimeIds")
            const execution = trustedExecution(context, "context.get")
            const inventory = execution?.runtimes ?? await runtimeInventory()
            const operatorRuntimeId = identifier(context?.operatorSession?.runtimeId)
            const runtimes = inventory
                .filter((entry) => allowed.has(entry.runtimeId))
                .filter((entry) => operatorRuntimeId === null || entry.runtimeId === operatorRuntimeId)
            const workspaceRoot = context?.operatorSession?.workspaceRoot ?? (
                typeof dependencies.workspaceRoot === "function"
                    ? await dependencies.workspaceRoot()
                    : dependencies.workspaceRoot
            )
            return {workspaceRoot: String(workspaceRoot ?? ""), runtimes}
        },

        async "raw_cases.list"(input, context) {
            const execution = trustedExecution(context, "raw_cases.list")
            const page = paginate(await filteredRawCases(input, context, execution), input)
            return {
                rawCases: page.items.map((record) => sanitizedRawCasePublicValue(record)),
                nextCursor: page.nextCursor,
            }
        },

        async "raw_cases.enqueue"(input, context) {
            const execution = trustedExecution(context, "raw_cases.enqueue")
            const cases = []
            for (let index = 0; index < input.cases.length; index += 1) {
                const rawCase = input.cases[index]
                const skill = execution?.skills[index] ??
                    await resolveSkillReference(rawCase.skill, {
                        grant: context?.grant,
                        method: "raw_cases.enqueue",
                        path: ["cases", index, "skill"],
                        toolSupplied: true,
                    })
                cases.push({
                    ...clone(rawCase),
                    question: rawCase.question,
                    skill: canonicalSkillReference(skill),
                })
            }
            if (typeof rawCaseStore?.addMany !== "function") throw new Error("Raw Case store unavailable")
            return sanitizedRawCasePublicValue(await rawCaseStore.addMany(cases))
        },

        async "raw_cases.update"(input, context) {
            const execution = trustedExecution(context, "raw_cases.update")
            const rawCase = execution?.rawCase ?? await requireRawCase(input.id)
            const changes = clone(input.changes)
            if (changes.skill) {
                const skill = execution?.targetSkill ??
                    await resolveSkillReference(changes.skill, {
                        grant: context?.grant,
                        method: "raw_cases.update",
                        path: ["changes", "skill"],
                        toolSupplied: true,
                    })
                changes.skill = canonicalSkillReference(skill)
            }
            if (typeof rawCaseStore?.updateIfCurrent !== "function") {
                throw new Error("Raw Case store unavailable")
            }
            try {
                return {rawCase: sanitizedRawCasePublicValue(await rawCaseStore.updateIfCurrent(input.id, {
                    expectedRevision: rawCase.revision,
                    expectedSkillName: rawCase.skill?.name,
                }, changes))}
            } catch (error) {
                let conflict = false
                try {
                    conflict = error instanceof RawCaseConflictError
                } catch {}
                if (conflict) throw createPublicControlError("CONTROL_BUSY")
                throw error
            }
        },

        async "raw_cases.dispatch"(input, context) {
            const execution = trustedExecution(context, "raw_cases.dispatch")
            const rawCase = execution?.rawCase ?? await requireRawCase(input.id)
            const skill = execution?.skill ?? await resolveSkillReference(rawCase.skill, {
                grant: context?.grant,
                method: "raw_cases.dispatch",
            })
            const descriptor = execution?.runtime ?? await requireRuntime(input.runtime.runtimeId)
            if (typeof dispatchRawCase !== "function") throw new Error("Runtime dispatch unavailable")
            const result = await dispatchRawCase({
                rawCase,
                skill: clone(skill),
                mode: input.mode,
                runtime: {
                    ...descriptor,
                    modelId: input.runtime.modelId,
                    effort: input.runtime.effort,
                },
            })
            return {threadId: result.threadId, turnId: result.turnId ?? null}
        },

        async "runtimes.list"(_input, context) {
            const allowed = scopeIds(context, "runtimeIds")
            const execution = trustedExecution(context, "runtimes.list")
            const runtimes = execution?.runtimes ?? await runtimeInventory()
            return {
                runtimes: runtimes.filter((entry) => allowed.has(entry.runtimeId)),
            }
        },

        async "runtimes.models"(input, context) {
            const execution = trustedExecution(context, "runtimes.models")
            const runtime = execution?.runtime ?? await requireRuntime(input.runtimeId)
            if (typeof listModelsForRuntime !== "function") return {models: []}
            const result = await listModelsForRuntime(runtime.runtimeId, clone(runtime))
            return {models: clone(arrayFromInventory(result, ["models", "data"]))}
        },

        async "datasets.list"(input, context) {
            const allowed = scopeIds(context, "datasetIds")
            const execution = trustedExecution(context, "datasets.list")
            const inventory = execution?.datasets ?? await datasetInventory()
            const datasets = inventory.filter((entry) => allowed.has(entry.id))
            const page = paginate(datasets, input)
            return {datasets: page.items.map(publicDataset), nextCursor: page.nextCursor}
        },

        async "datasets.get"(input, context) {
            const execution = trustedExecution(context, "datasets.get")
            const dataset = execution?.dataset ?? await requireDataset(input.datasetId)
            const result = {dataset: publicDataset(dataset)}
            if (input.includeCases) {
                result.cases = (execution?.cases ?? await casesForDataset(dataset.id))
                    .map(publicCase)
            }
            return result
        },

        async "datasets.create"(input, context) {
            const execution = trustedExecution(context, "datasets.create")
            const skill = execution?.skill ??
                await requireManagedSkillSelection(input.skillId, input.repositoryId)
            if (typeof evaluationStore?.createDataset !== "function") {
                throw new Error("Dataset store unavailable")
            }
            const dataset = await evaluationStore.createDataset({
                name: input.name,
                skillReference: {
                    schemaVersion: "rolling-skill-skill-reference/v1",
                    evidencePrecision: "managed",
                    id: skill.id,
                    repositoryId: skill.repositoryId,
                    name: skill.name,
                    path: null,
                    scope: "managed",
                    description: skill.description ?? null,
                    providerId: null,
                    runtimeId: null,
                    confirmedAt: new Date().toISOString(),
                },
            })
            return {dataset: publicDataset(dataset)}
        },

        async "datasets.clone"(input, context) {
            const execution = trustedExecution(context, "datasets.clone")
            if (execution === null) {
                await resolveScope("datasets.clone", input, context?.grant)
            }
            await assertMutationCurrent("datasets.clone", input, context)
            if (typeof evaluationStore?.cloneDataset !== "function") {
                throw new Error("Dataset clone store unavailable")
            }
            const result = await evaluationStore.cloneDataset({
                sourceDatasetId: input.sourceDatasetId,
                name: input.name,
                caseIds: input.caseIds,
            })
            return {
                dataset: publicDataset(result.dataset),
                cases: result.cases.map(publicCase),
                rubricCopied: Boolean(result.rubricVersion),
            }
        },

        async "datasets.delete"(input, context) {
            const execution = trustedExecution(context, "datasets.delete")
            if (execution === null) await requireDataset(input.datasetId)
            await assertMutationCurrent("datasets.delete", input, context)
            if (typeof evaluationStore?.deleteDataset !== "function") {
                throw new Error("Dataset store unavailable")
            }
            const deleted = await evaluationStore.deleteDataset(input.datasetId)
            return {dataset: publicDataset(deleted?.dataset ?? deleted)}
        },

        async "datasets.delete_case"(input, context) {
            const execution = trustedExecution(context, "datasets.delete_case")
            if (execution === null) {
                const dataset = await requireDataset(input.datasetId)
                const selectedCase = (await casesForDataset(dataset.id))
                    .find((entry) => entry.id === input.caseId)
                if (!selectedCase) throw notFound("case")
            }
            await assertMutationCurrent("datasets.delete_case", input, context)
            if (typeof evaluationStore?.deleteCase !== "function") {
                throw new Error("Dataset Case store unavailable")
            }
            return {case: publicCase(await evaluationStore.deleteCase(input.datasetId, input.caseId))}
        },

        async "evaluations.list"(input, context) {
            const execution = trustedExecution(context, "evaluations.list")
            let runs = execution?.runs ?? await runInventory(input.datasetId)
            if (input.datasetId === null) {
                const allowed = scopeIds(context, "datasetIds")
                runs = runs.filter((entry) => allowed.has(entry.datasetId))
            } else {
                const execution = trustedExecution(context, "evaluations.list")
                if (execution === null) await requireDataset(input.datasetId)
            }
            const page = paginate(runs, input)
            return {
                runs: page.items.map((run) => publicEvaluationRun(run)),
                nextCursor: page.nextCursor,
            }
        },

        async "evaluations.get"(input, context) {
            const execution = trustedExecution(context, "evaluations.get")
            return {
                run: publicEvaluationRun(
                    execution?.run ?? await requireEvaluationRun(input.runId),
                    {includeResults: true},
                ),
            }
        },

        async "evaluations.start"(input, context) {
            const execution = trustedExecution(context, "evaluations.start") ??
                immutableSnapshot({
                    method: "evaluations.start",
                    ...await evaluationStartSnapshot(input),
            })
            if (typeof startEvaluation !== "function") throw new Error("Evaluation start unavailable")
            return {
                run: publicEvaluationRun(
                    clone(await startEvaluation(clone(input), execution)),
                    {includeResults: true},
                ),
            }
        },

        async "evaluations.cancel"(input, context) {
            const execution = trustedExecution(context, "evaluations.cancel")
            if (execution === null) await requireEvaluationRun(input.runId)
            if (typeof evaluationRunner?.cancel !== "function") {
                throw new Error("Evaluation cancellation unavailable")
            }
            return {
                run: publicEvaluationRun(
                    clone(await evaluationRunner.cancel(input.runId)),
                    {includeResults: true},
                ),
            }
        },

        async "skill_repositories.list"(input, context) {
            const allowed = scopeIds(context, "repositoryIds")
            const execution = trustedExecution(context, "skill_repositories.list")
            const catalog = execution?.catalog ?? await managedSkillCatalog()
            const repositories = catalog.repositories.filter((entry) => allowed.has(entry.id))
            const page = paginate(repositories, input)
            return {
                repositories: page.items.map(managedRepositorySummary),
                nextCursor: page.nextCursor,
            }
        },

        async "skills.list"(input, context) {
            const allowed = scopeIds(context, "skillIds")
            const execution = trustedExecution(context, "skills.list")
            const catalog = execution?.catalog ?? await managedSkillCatalog()
            const skills = catalog.skills.filter((entry) => allowed.has(entry.id))
            const page = paginate(skills, input)
            const repositoryIds = new Set(page.items.map((entry) => entry.repositoryId))
            return {
                repositories: catalog.repositories
                    .filter((entry) => repositoryIds.has(entry?.id))
                    .map(managedRepositorySummary),
                skills: page.items.map(managedSkillSummary),
                nextCursor: page.nextCursor,
            }
        },

        async "skill_versions.list"(input, context) {
            const allowed = scopeIds(context, "skillIds")
            const execution = trustedExecution(context, "skill_versions.list")
            const page = execution?.versionPage ??
                await managedSkillVersionPage(input, allowed)
            return {
                versions: page.versions.map(managedVersionSummary),
                nextCursor: page.nextCursor,
            }
        },

        async "skills.get"(input, context) {
            const execution = trustedExecution(context, "skills.get")
            const detail = execution?.detail ?? (await requireSkillDetail(input.skillId)).detail
            return {skill: detail}
        },

        async "skills.diff"(input, context) {
            const execution = trustedExecution(context, "skills.diff")
            if (execution === null) {
                await requireManagedSkillSelection(input.skillId, input.repositoryId)
            }
            const baseVersion = execution?.baseVersion ??
                requireManagedVersion(input.baseVersionId, input)
            const candidateVersion = execution?.candidateVersion ??
                requireManagedVersion(input.candidateVersionId, input)
            return {diff: {
                skillId: input.skillId,
                repositoryId: input.repositoryId,
                baseVersionId: baseVersion.id,
                candidateVersionId: candidateVersion.id,
                changed: baseVersion.contentDigest !== candidateVersion.contentDigest,
            }}
        },

        async "skills.create_candidate"(input, context) {
            const execution = trustedExecution(context, "skills.create_candidate")
            if (execution === null) {
                await requireManagedSkillSelection(input.skillId, input.repositoryId)
            }
            if (typeof managedSkillManager?.repositoryPath !== "function" ||
                typeof managedSkillManager?.createCandidate !== "function") {
                throw new Error("Managed Skill Candidate creation unavailable")
            }
            await assertMutationCurrent("skills.create_candidate", input, context)
            await managedSkillManager.repositoryPath(input.repositoryId)
            const approvedFacts = context?.trustedFacts?.methodFacts
            const version = await managedSkillManager.createCandidate({
                skillId: input.skillId,
                message: input.message,
                ...(input.title ? {title: input.title} : {}),
                createdBy: "operator",
                ...(approvedFacts?.method === "skills.create_candidate" ? {
                    expectedBase: {
                        commit: approvedFacts.baseCommit,
                        contentDigest: approvedFacts.baseContentDigest,
                        dirty: approvedFacts.dirty,
                    },
                } : {}),
            })
            if (version?.repositoryId !== input.repositoryId ||
                version?.skillId !== input.skillId || version?.createdBy !== "operator") {
                throw new Error("Managed Skill Candidate identity did not match its repository")
            }
            const persisted = requireManagedVersion(version.id, input)
            if (persisted.commit !== version.commit || persisted.createdBy !== "operator") {
                throw new Error("Managed Skill Candidate commit was not persisted by its repository")
            }
            return {version: managedVersionSummary(version)}
        },

        async "skills.release"(input, context) {
            const execution = trustedExecution(context, "skills.release")
            const version = execution?.version ?? requireManagedVersion(input.versionId, input)
            if (version.skillId !== input.skillId || version.repositoryId !== input.repositoryId) {
                throw notFound("version")
            }
            if (typeof managedSkillManager?.releaseVersion !== "function") {
                throw new Error("Managed Skill release unavailable")
            }
            await assertMutationCurrent("skills.release", input, context)
            const approvedFacts = context?.trustedFacts?.methodFacts
            const released = await managedSkillManager.releaseVersion({
                versionId: version.id,
                versionLabel: input.versionLabel,
                ...(approvedFacts?.method === "skills.release" ? {
                    expectedCandidate: {
                        commit: approvedFacts.candidateCommit,
                        contentDigest: approvedFacts.candidateDigest,
                        state: approvedFacts.candidateState,
                        versionLabel: approvedFacts.versionLabel,
                    },
                } : {}),
            })
            if (released?.id !== version.id || released.skillId !== input.skillId ||
                released.repositoryId !== input.repositoryId) {
                throw new Error("Managed Skill release identity did not match its repository")
            }
            return {version: managedVersionSummary(released)}
        },

        async "jobs.get"(input, context) {
            const execution = trustedExecution(context, "jobs.get")
            return {job: publicOperatorJob(
                execution?.job ?? requireOperatorJob(input.jobId, context?.sessionId, context?.grant),
            )}
        },

        async "jobs.list"(input, context) {
            const execution = trustedExecution(context, "jobs.list")
            let jobs = execution?.jobs ?? operatorJobs(context?.sessionId)
            if (input.status !== null) jobs = jobs.filter((job) => job.status === input.status)
            const page = paginate(jobs, input)
            return {jobs: page.items.map(publicOperatorJob), nextCursor: page.nextCursor}
        },

        async "jobs.pause"(input, context) {
            return controlOperatorJob("pause", input, context)
        },

        async "jobs.resume"(input, context) {
            return controlOperatorJob("resume", input, context)
        },

        async "jobs.stop"(input, context) {
            return controlOperatorJob("stop", input, context)
        },

        async "approvals.list"(input, context) {
            const execution = trustedExecution(context, "approvals.list")
            let approvals = execution?.approvals ??
                approvalsForSession(context?.sessionId, input.jobId)
            if (input.status !== null) {
                approvals = approvals.filter((approval) => approval.status === input.status)
            }
            const page = paginate(approvals, input)
            return {
                approvals: page.items.map(publicApproval),
                nextCursor: page.nextCursor,
            }
        },

        async "approvals.resolve"(input, context) {
            if (!isTrustedHumanCapability(context?.grant)) {
                throw createPublicControlError("FORBIDDEN", {
                    details: {action: "approvals.resolve"},
                })
            }
            const execution = trustedExecution(context, "approvals.resolve")
            const approval = execution?.approval ??
                requireOperatorApproval(input.approvalId, context?.sessionId, context?.grant)
            if (typeof operatorJobEngine?.resolveApproval !== "function") {
                throw new Error("Operator approval engine unavailable")
            }
            const expectedStatus = input.decision === "approve" ? "approved" : "rejected"
            let result
            if (approval.status === "pending") {
                try {
                    result = await operatorJobEngine.resolveApproval(approval.id, {
                        decision: input.decision,
                        scope: "action",
                        decidedBy: "user",
                    })
                } catch (error) {
                    const current = requireOperatorApproval(
                        approval.id,
                        context.sessionId,
                        context.grant,
                    )
                    if (current.status !== expectedStatus) throw error
                }
            } else if (approval.status !== expectedStatus) {
                throw resourceChanged("approval")
            }
            const currentApproval = requireOperatorApproval(
                approval.id,
                context.sessionId,
                context.grant,
            )
            if (currentApproval.status !== expectedStatus) throw resourceChanged("approval")
            if (result === undefined) {
                if (typeof operatorJobStore?.getStep !== "function" || currentApproval.stepId === null) {
                    throw new Error("Operator approval Step unavailable")
                }
                const step = operatorJobStore.getStep(currentApproval.stepId)
                result = {
                    status: step.status,
                    jobId: step.jobId,
                    stepId: step.id,
                    approvalId: currentApproval.id,
                    ...(step.error === null ? {} : {error: step.error}),
                }
            }
            if (currentApproval.action !== "optimization.release-install") {
                if (typeof operatorSessionManager?.resumeAfterApproval !== "function") {
                    throw new Error("Operator approval recovery unavailable")
                }
                try {
                    await operatorSessionManager.resumeAfterApproval(currentApproval.sessionId)
                } catch (cause) {
                    throw createPublicControlError("CONTROL_BUSY", {cause})
                }
            }
            return {
                approval: publicApproval(currentApproval),
                execution: publicApprovalExecution(result, currentApproval),
            }
        },

        async "curation.start"(input, context) {
            const execution = trustedExecution(context, "curation.start")
            if (execution === null) await requireDataset(input.datasetId)
            if (typeof curationManager?.createSession !== "function") {
                throw new Error("Curator unavailable")
            }
            const {idempotencyKey: _idempotencyKey, ...request} = input
            const session = await curationManager.createSession(request)
            return {session: publicCurationSession(assertCurationIdentity(session, {
                datasetId: input.datasetId,
            }))}
        },

        async "curation.message"(input, context) {
            const execution = trustedExecution(context, "curation.message")
            const existing = execution?.session ?? requireCurationSession(input.sessionId)
            if (typeof curationManager?.sendMessage !== "function") throw new Error("Curator unavailable")
            const session = await curationManager.sendMessage(input.sessionId, input.message)
            return {session: publicCurationSession(assertCurationIdentity(session, {
                sessionId: existing.id,
                datasetId: existing.datasetId,
            }))}
        },

        async "curation.save"(input, context) {
            const execution = trustedExecution(context, "curation.save")
            const session = execution?.session ?? requireCurationSession(input.sessionId)
            await assertMutationCurrent("curation.save", input, context)
            if (typeof curationManager?.archive !== "function") throw new Error("Curator unavailable")
            const entry = await curationManager.archive(session.id)
            return {
                session: publicCurationSession({...session, status: "archived", caseId: entry.id}),
                case: publicCase(entry),
            }
        },

        async "curation.discard"(input, context) {
            const execution = trustedExecution(context, "curation.discard")
            const existing = execution?.session ?? requireCurationSession(input.sessionId)
            await assertMutationCurrent("curation.discard", input, context)
            if (typeof curationManager?.discard !== "function") throw new Error("Curator unavailable")
            const session = await curationManager.discard(input.sessionId)
            return {session: publicCurationSession(assertCurationIdentity(session, {
                sessionId: existing.id,
                datasetId: existing.datasetId,
            }))}
        },

        async "rubrics.publish"(input, context) {
            const execution = trustedExecution(context, "rubrics.publish")
            const session = execution?.session ?? requireRubricSession(input.sessionId)
            if (session.datasetId !== input.datasetId) throw notFound("rubric_session")
            await assertMutationCurrent("rubrics.publish", input, context)
            if (typeof rubricManager?.publish !== "function") throw new Error("Rubric Agent unavailable")
            return {version: publicRubricVersion(await rubricManager.publish(session.id))}
        },

        async "installations.start"(input, context) {
            const execution = trustedExecution(context, "installations.start")
            const skill = execution?.skill ??
                await requireManagedSkillSelection(input.skillId, input.repositoryId)
            const version = execution?.version ?? requireManagedVersion(input.versionId, input)
            if (skill.repositoryId !== version.repositoryId || skill.id !== version.skillId) {
                throw notFound("version")
            }
            await assertMutationCurrent("installations.start", input, context)
            if (typeof skillInstallationManager?.start !== "function") {
                throw new Error("Skill installation unavailable")
            }
            const installations = await skillInstallationManager.start({
                skillId: skill.id,
                versionId: version.id,
                targets: clone(input.targets),
            })
            const jobs = clone(installations)
            const targetRuntimeIds = new Set(input.targets.map((target) => target.runtimeId))
            const returnedRuntimeIds = new Set()
            if (!Array.isArray(jobs) || jobs.length !== input.targets.length) {
                throw new Error("Skill installation target identity did not match its request")
            }
            for (const job of jobs) {
                const source = job?.request?.source ?? {}
                const runtimeId = job?.runtime?.runtimeId
                if (
                    job?.operation !== "install" ||
                    source.repositoryId !== input.repositoryId ||
                    source.skillId !== input.skillId ||
                    source.versionId !== input.versionId ||
                    !targetRuntimeIds.has(runtimeId) ||
                    returnedRuntimeIds.has(runtimeId)
                ) {
                    throw new Error("Skill installation target identity did not match its request")
                }
                returnedRuntimeIds.add(runtimeId)
            }
            return {installations: jobs.map(publicInstallation)}
        },

        async "installations.get"(input, context) {
            const execution = trustedExecution(context, "installations.get")
            return {installation: publicInstallation(
                execution?.installation ?? requireInstallation(input.installationId),
            )}
        },

        async "installations.cancel"(input, context) {
            const execution = trustedExecution(context, "installations.cancel")
            const existing = execution?.installation ?? requireInstallation(input.installationId)
            await assertMutationCurrent("installations.cancel", input, context)
            if (typeof skillInstallationManager?.cancel !== "function") {
                throw new Error("Skill installation cancellation unavailable")
            }
            return {installation: publicInstallation(
                assertInstallationIdentity(
                    await skillInstallationManager.cancel(input.installationId),
                    existing,
                ),
            )}
        },

        async "installations.inspect"(input, context) {
            const execution = trustedExecution(context, "installations.inspect")
            const existing = execution?.installation ?? requireInstallation(input.installationId)
            if (typeof skillInstallationManager?.inspect !== "function") {
                throw new Error("Skill installation inspection unavailable")
            }
            return {installation: publicInstallation(
                assertInstallationIdentity(
                    await skillInstallationManager.inspect(input.installationId),
                    existing,
                    {inspection: true},
                ),
            )}
        },

        async "installations.register"() {
            throw new Error("Installation registration requires a live Job-scoped executor")
        },

        async "optimization.preflight"(input, context) {
            if (typeof optimizationControlService?.preflight !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            const execution = trustedExecution(context, "optimization.preflight")
            if (execution?.preflight) return clone(execution.preflight)
            const {idempotencyKey: _idempotencyKey, ...config} = input
            return optimizationControlService.preflight(config)
        },

        async "optimization.start"(input) {
            if (typeof optimizationControlService?.start !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.start(input)
        },

        async "optimization.get"(input) {
            if (typeof optimizationControlService?.get !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.get(input.runId)
        },

        async "optimization.pause"(input) {
            if (typeof optimizationControlService?.pause !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.pause(input.runId)
        },

        async "optimization.resume"(input) {
            if (typeof optimizationControlService?.resume !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.resume(input.runId)
        },

        async "optimization.stop"(input) {
            if (typeof optimizationControlService?.stop !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.stop(input.runId)
        },

        async "optimization.submit_candidate"(input, context) {
            if (typeof optimizationControlService?.submitCandidate !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            const {idempotencyKey: _idempotencyKey, ...submission} = input
            return optimizationControlService.submitCandidate(submission, context)
        },

        async "optimization.submit_decision"(input, context) {
            if (typeof optimizationControlService?.submitDecision !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            const {idempotencyKey: _idempotencyKey, ...submission} = input
            return optimizationControlService.submitDecision(submission, context)
        },

        async "optimization.report"(input) {
            if (typeof optimizationControlService?.report !== "function") {
                throw new Error("Optimization control service unavailable")
            }
            return optimizationControlService.report(input.runId)
        },
    }

    for (const method of CONTROL_METHODS) {
        if (typeof handlers[method] !== "function") throw new Error(`Missing domain handler: ${method}`)
    }
    Object.defineProperty(handlers, "resolveScope", {
        configurable: false,
        enumerable: false,
        value: resolveScope,
        writable: false,
    })
    Object.defineProperty(handlers, "resolveTrustedFacts", {
        configurable: false,
        enumerable: false,
        value: resolveTrustedFacts,
        writable: false,
    })
    return Object.freeze(handlers)
}

module.exports = {createDomainServices}
