const PRIVATE_OUTPUT_KEY = /(?:capability|token|secret|socket|environment|executablePath|(?:^|_)path$|reasoning|(?:^|_)body$)/iu
const MAX_TEXT = 32 * 1024
const MAX_ARRAY = 10_000

function requiredText(value, label, maximum = 300) {
    const text = typeof value === "string" ? value.trim() : ""
    if (!text || text.length > maximum) throw new Error(`${label} is required`)
    return text
}

function exactKeys(value, allowed, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    const unsupported = Object.keys(value).find((key) => !allowed.has(key))
    if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`)
    return value
}

function publicValue(value, depth = 0) {
    if (value === null || typeof value === "boolean") return value
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") {
        return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT - 1)}…`
    }
    if (!value || typeof value !== "object" || depth >= 8) return null
    if (Array.isArray(value)) {
        return value.slice(0, MAX_ARRAY).map((entry) => publicValue(entry, depth + 1))
    }
    const output = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
        if (!Object.hasOwn(descriptor, "value") || PRIVATE_OUTPUT_KEY.test(key)) continue
        output[key] = publicValue(descriptor.value, depth + 1)
    }
    return output
}

function sessionId(input) {
    exactKeys(input, new Set(["sessionId"]), "Operator session request")
    return requiredText(input.sessionId, "Operator session id", 200)
}

function runId(input) {
    exactKeys(input, new Set(["runId"]), "Optimization request")
    return requiredText(input.runId, "Optimization Run id", 200)
}

function createOperatorServices({
    jobStore,
    jobEngine,
    sessionManager,
    optimizationStore,
    optimizationControl,
    ready = null,
} = {}) {
    if (!jobStore || typeof jobStore.readSummaryPage !== "function" || typeof jobStore.getApproval !== "function") {
        throw new Error("Operator Job store is required")
    }
    if (!jobEngine || typeof jobEngine.resolveApproval !== "function") {
        throw new Error("Operator Job engine is required")
    }
    for (const method of ["create", "get", "pause", "resume", "stop", "sendMessage"]) {
        if (typeof sessionManager?.[method] !== "function") {
            throw new Error(`Operator session manager with ${method}() is required`)
        }
    }
    if (!optimizationStore || typeof optimizationStore.listPublicSummaries !== "function") {
        throw new Error("Optimization store is required")
    }
    for (const method of ["get", "preflight", "start", "pause", "resume", "stop", "report"]) {
        if (typeof optimizationControl?.[method] !== "function") {
            throw new Error(`Optimization control service with ${method}() is required`)
        }
    }

    return Object.freeze({
        operatorSummary(input = {}) {
            exactKeys(input, new Set(["cursor", "limit"]), "Operator summary request")
            const limit = input.limit === undefined ? 100 : Number(input.limit)
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
                throw new Error("Operator summary limit is invalid")
            }
            return publicValue(jobStore.readSummaryPage({
                cursor: input.cursor ?? null,
                limit,
            }))
        },
        operatorArtifacts(input = {}) {
            exactKeys(input, new Set(["jobId"]), "Operator artifact request")
            return publicValue(jobStore.listArtifacts(
                requiredText(input.jobId, "Operator Job id", 200),
            ))
        },
        operatorArtifact(input = {}) {
            exactKeys(input, new Set(["jobId", "artifactId"]), "Operator artifact content request")
            const jobId = requiredText(input.jobId, "Operator Job id", 200)
            const artifactId = requiredText(input.artifactId, "Operator artifact id", 200)
            const artifact = jobStore.listArtifacts(jobId).find((entry) => entry.id === artifactId)
            if (!artifact) throw new Error("Operator artifact not found in this Job")
            const body = jobStore.readArtifactBody(artifactId)
            const text = body.toString("utf8")
            return {
                id: artifact.id,
                name: artifact.name,
                mediaType: artifact.mediaType,
                preview: text.slice(0, MAX_TEXT),
                truncated: text.length > MAX_TEXT,
            }
        },
        async operatorStart(input = {}) {
            exactKeys(input, new Set([
                "runtimeId",
                "modelId",
                "effort",
                "objective",
                "actions",
                "scopes",
                "budget",
                "expiresInMs",
                "managedSkillBinding",
            ]), "Operator start request")
            await ready
            return publicValue(await sessionManager.create(structuredClone(input)))
        },
        operatorGet(input = {}) {
            return publicValue(sessionManager.get(sessionId(input)))
        },
        operatorPause(input = {}) {
            return Promise.resolve(sessionManager.pause(sessionId(input))).then(publicValue)
        },
        operatorResume(input = {}) {
            return Promise.resolve(sessionManager.resume(sessionId(input))).then(publicValue)
        },
        operatorCancel(input = {}) {
            return Promise.resolve(sessionManager.stop(sessionId(input))).then(publicValue)
        },
        operatorSend(input = {}) {
            exactKeys(input, new Set(["sessionId", "text"]), "Operator message request")
            return Promise.resolve(sessionManager.sendMessage(
                requiredText(input.sessionId, "Operator session id", 200),
                requiredText(input.text, "Operator message", 32_000),
            )).then(publicValue)
        },
        async operatorApprove(input = {}) {
            exactKeys(
                input,
                new Set(["sessionId", "approvalId", "decision", "scope"]),
                "Operator approval request",
            )
            const selectedSessionId = requiredText(input.sessionId, "Operator session id", 200)
            const decision = input.decision === "approve" || input.decision === "reject"
                ? input.decision
                : null
            if (!decision) throw new Error("Operator approval decision is invalid")
            const approvalId = requiredText(input.approvalId, "Operator approval id", 200)
            const approval = jobStore.getApproval(approvalId)
            const result = await jobEngine.resolveApproval(
                approvalId,
                {
                    decision,
                    scope: requiredText(input.scope, "Operator approval scope", 300),
                    decidedBy: "dsh-user",
                },
            )
            if (
                decision === "approve" &&
                approval.action !== "optimization.release-install" &&
                typeof sessionManager.resumeAfterApproval === "function"
            ) {
                await sessionManager.resumeAfterApproval(selectedSessionId)
            }
            return publicValue(result)
        },
        optimizationList() {
            return publicValue(optimizationStore.listPublicSummaries())
        },
        optimizationGet(input = {}) {
            return publicValue(optimizationControl.get(runId(input)))
        },
        optimizationPreflight(input = {}) {
            return Promise.resolve(optimizationControl.preflight(structuredClone(input))).then(publicValue)
        },
        optimizationStart(input = {}) {
            return Promise.resolve(optimizationControl.start(structuredClone(input))).then(publicValue)
        },
        optimizationPause(input = {}) {
            return Promise.resolve(optimizationControl.pause(runId(input))).then(publicValue)
        },
        optimizationResume(input = {}) {
            return Promise.resolve(optimizationControl.resume(runId(input))).then(publicValue)
        },
        optimizationCancel(input = {}) {
            return Promise.resolve(optimizationControl.stop(runId(input))).then(publicValue)
        },
        optimizationReport(input = {}) {
            return publicValue(optimizationControl.report(runId(input)))
        },
    })
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
    if (value && typeof value === "object") {
        return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => (
            `${JSON.stringify(key)}:${canonicalJson(value[key])}`
        )).join(",")}}`
    }
    return JSON.stringify(value)
}

function digest(value) {
    return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}

function revision(value) {
    return Number.parseInt(
        createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 12),
        16,
    ) + 1
}

function optimizationRuntimeSkillBinding({
    runtimeConfiguration,
    repository,
    skill,
    candidate,
    installationJob,
}) {
    if (
        installationJob?.status !== "succeeded" ||
        installationJob.request?.purpose !== "optimization-experiment" ||
        installationJob.parsedResult?.trusted !== true ||
        !installationJob.parsedResult.destination ||
        !installationJob.parsedResult.verification ||
        installationJob.parsedResult.verification === "none" ||
        installationJob.runtime?.runtimeId !== runtimeConfiguration.runtimeId ||
        installationJob.runtime?.providerId !== runtimeConfiguration.providerId ||
        installationJob.request.source?.repositoryId !== repository.id ||
        installationJob.request.source?.skillId !== skill.id ||
        installationJob.request.source?.versionId !== candidate.id ||
        installationJob.request.source?.commit !== candidate.commit ||
        installationJob.request.source?.expectedDigest !== candidate.contentDigest
    ) {
        throw new Error(`Optimization target ${runtimeConfiguration.runtimeId} lacks a trusted Candidate installation`)
    }
    const destination = installationJob.parsedResult.destination
    const path = basename(destination).toLocaleLowerCase("en-US") === "skill.md"
        ? destination
        : join(destination, "SKILL.md")
    return {
        ...runtimeConfiguration,
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: skill.id,
            repositoryId: repository.id,
            name: skill.name,
            path,
            scope: "runtime",
            description: skill.description ?? null,
            runtimeId: runtimeConfiguration.runtimeId,
            providerId: runtimeConfiguration.providerId,
            confirmedAt: installationJob.completedAt ?? new Date().toISOString(),
        },
        installationJobId: installationJob.id,
        installationVerification: installationJob.parsedResult.verification,
        expectedContentDigest: candidate.contentDigest,
    }
}

function optimizationVersionIdentity(version) {
    return {...version, id: version.id ?? version.versionId}
}

function optimizationApprovalRequest(input) {
    const versionId = input.candidate?.id ?? input.versionId ?? null
    const scope = {
        runId: input.runId,
        epoch: input.epoch,
        kind: input.kind,
        ...(versionId ? {versionId} : {}),
        ...(input.request ? {requestedLimit: input.request} : {}),
    }
    return {
        action: `optimization.${input.kind}`,
        risk: input.kind === "release-install"
            ? "Release the selected immutable Optimization Candidate and install it on every frozen target Runtime"
            : `Approve Optimization ${input.kind}`,
        scope,
        proposedMutation: scope,
        idempotencyKey: [
            input.runId,
            input.kind,
            input.epoch,
            versionId ?? input.request?.field,
        ].filter((value) => value !== null && value !== undefined).join(":"),
    }
}

function optimizationReleasedSkillBinding({runtimeConfiguration, repository, skill, candidate, installationStore}) {
    const installation = installationStore.resolveVerifiedInstallation({
        repositoryId: repository.id,
        skillId: skill.id,
        versionId: candidate.id,
        runtimeId: runtimeConfiguration.runtimeId,
        providerId: runtimeConfiguration.providerId,
    })
    if (installation.commit !== candidate.commit || installation.contentDigest !== candidate.contentDigest) {
        throw new Error("Recorded Runtime installation does not match the Optimization release")
    }
    return {
        ...runtimeConfiguration,
        skillEvidenceBinding: "verified",
        skillReference: {
            schemaVersion: "rolling-skill-skill-reference/v1",
            id: skill.id, repositoryId: repository.id, name: skill.name,
            path: basename(installation.destination).toLowerCase() === "skill.md"
                ? installation.destination : join(installation.destination, "SKILL.md"),
            scope: "runtime", description: skill.description ?? null,
            runtimeId: runtimeConfiguration.runtimeId, providerId: runtimeConfiguration.providerId,
            confirmedAt: installation.installedAt,
        },
        installationId: installation.installationId ?? installation.id,
        installationJobId: installation.jobId,
        installationVerification: installation.verification,
        expectedContentDigest: candidate.contentDigest,
    }
}

function createManagedWorkspaceResolver({
    workspaceManager,
    managedSkillStore,
    managedSkillManager,
    resolveSkillEditWorkspace = null,
} = {}) {
    return async (binding = {}) => {
        if (binding.skillEditSessionId) {
            if (typeof resolveSkillEditWorkspace !== "function") {
                throw new Error("Skill edit workspace resolution is unavailable")
            }
            const selected = await resolveSkillEditWorkspace(Object.freeze({...binding}))
            if (
                selected?.repositoryId !== binding.repositoryId ||
                selected?.skillId !== binding.skillId ||
                selected?.skillEditSessionId !== binding.skillEditSessionId ||
                typeof selected?.workspaceRoot !== "string"
            ) throw new Error("Skill edit workspace does not match the managed Skill binding")
            return {
                repositoryId: selected.repositoryId,
                skillId: selected.skillId,
                skillEditSessionId: selected.skillEditSessionId,
                workspaceRoot: selected.workspaceRoot,
            }
        }
        if (binding.optimizationRunId) {
            const selected = workspaceManager.get(binding.optimizationRunId)
            if (selected.repositoryId !== binding.repositoryId || selected.skillId !== binding.skillId) {
                throw new Error("Optimization workspace does not match the managed Skill binding")
            }
            return {
                repositoryId: selected.repositoryId,
                skillId: selected.skillId,
                optimizationRunId: selected.runId,
                workspaceRoot: selected.workspacePath,
            }
        }
        const skill = managedSkillStore.getSkill(binding.skillId)
        if (skill.repositoryId !== binding.repositoryId) {
            throw new Error("Managed Skill does not belong to the selected repository")
        }
        return {
            repositoryId: binding.repositoryId,
            skillId: binding.skillId,
            workspaceRoot: managedSkillManager.repositoryPath(binding.repositoryId),
        }
    }
}

function createOperatorRuntime({
    paths,
    store,
    rawCaseStore,
    managedSkillStore,
    managedSkillManager,
    installationStore,
    installationManager,
    runtimeServices,
    evaluationRunner,
    evaluationServices,
    curationManager,
    rubricManager,
    workspaceRoot,
    requestPermission = null,
    requestQuestion = null,
    operatorToolPath = null,
    resolveSkillEditWorkspace = null,
    onChanged = () => {},
} = {}) {
    if (!paths || !store || !runtimeServices || !evaluationRunner) {
        throw new Error("Operator runtime dependencies are required")
    }
    const jobStore = new OperatorJobStore(paths.operatorJobs)
    const optimizationStore = new OptimizationStore(paths.optimizationRuns)
    let sessionManager = null
    let optimizationControl = null
    const optimizationCompletionTasks = new Map()
    const optimizationChanged = (change) => {
        onChanged(change)
        if (!["succeeded", "failed", "cancelled"].includes(change.state) || optimizationCompletionTasks.has(change.runId)) return
        const run = optimizationStore.getRun(change.runId)
        const {operatorSessionId, operatorParentJobId} = run.checkpoint ?? {}
        if (!operatorSessionId || !operatorParentJobId) return
        const operation = Promise.resolve().then(async () => {
            const parent = jobStore.getJob(operatorParentJobId)
            if (!["succeeded", "failed", "cancelled"].includes(parent.status)) {
                await jobEngine.completeJob(parent.id, run.state, run.error ? {error: run.error} : {})
            }
            await sessionManager.stop(operatorSessionId)
        }).catch((error) => {
            optimizationStore.updateCheckpoint(run.id, {operatorCleanupError: String(error.message).slice(0, 2000)})
            onChanged({runId: run.id, state: run.state})
        })
        optimizationCompletionTasks.set(run.id, operation)
    }

    const optimizationFacade = Object.freeze({
        preflight: (input) => optimizationControl.preflight(input),
        start: (input) => optimizationControl.start(input),
        get: (runId) => optimizationControl.get(runId),
        scope: (runId) => optimizationControl.scope(runId),
        pause: (runId) => optimizationControl.pause(runId),
        resume: (runId) => optimizationControl.resume(runId),
        stop: (runId) => optimizationControl.stop(runId),
        submitCandidate: (input, context) => optimizationControl.submitCandidate(input, context),
        submitDecision: (input, context) => optimizationControl.submitDecision(input, context),
        report: (runId) => optimizationControl.report(runId),
    })
    let domainServices = null
    const handlers = Object.fromEntries(CONTROL_METHODS
        .filter((method) => controlDefinition(method).operatorExposed === true)
        .map((method) => [method, ({params, controlContext, jobId}) => (
            domainServices[method](params, {
                ...controlContext,
                // Capability sessions rotate independently of the persisted
                // Operator session; submissions must use the engine-owned Job.
                operatorSessionId: jobStore.getJob(jobId).sessionId,
            })
        )]))
    const jobEngine = new OperatorJobEngine({
        store: jobStore,
        handlers,
        runtimeTelemetry: () => runtimeServices.list().map((runtime) => ({
            runtimeId: runtime.runtimeId,
            tokens: runtime.capabilities?.includes("token-usage") === true,
            cost: runtime.capabilities?.includes("cost-usage") === true,
        })),
        resolveEvaluationCaseCount: ({datasetId}) => {
            const cases = store.listCases(datasetId).sort((left, right) => (
                String(left.id).localeCompare(String(right.id))
            ))
            return {caseIds: cases.map((entry) => entry.id), datasetRevision: digest(cases)}
        },
        resolveTrustedFacts: (request) => domainServices.resolveTrustedFacts(request),
    })
    const capabilityStore = new CapabilityStore()
    const capabilityIssuer = createTrustedCapabilityIssuer(capabilityStore)
    const controlCapabilities = Object.freeze({
        issue: (request) => capabilityIssuer.issue(request),
        revoke: (id) => capabilityStore.revoke(id),
    })
    const sessionFacade = Object.freeze({
        pause: (sessionId_) => sessionManager.pause(sessionId_),
        resume: (sessionId_) => sessionManager.resume(sessionId_),
        resumeAfterApproval: (sessionId_) => sessionManager.resumeAfterApproval(sessionId_),
        stop: (sessionId_) => sessionManager.stop(sessionId_),
    })
    domainServices = createDomainServices({
        rawCaseStore,
        evaluationStore: store,
        evaluationRunner,
        managedSkillManager,
        managedSkillStore,
        operatorJobStore: jobStore,
        operatorJobEngine: jobEngine,
        operatorSessionManager: sessionFacade,
        curationManager,
        rubricManager,
        skillInstallationStore: installationStore,
        skillInstallationManager: installationManager,
        optimizationControlService: optimizationFacade,
        listDatasets: () => store.listDatasets(),
        listRawCaseSkills: () => ({skills: managedSkillManager.catalog().skills}),
        listRuntimes: () => runtimeServices.list(),
        listModelsForRuntime: (runtimeId_) => runtimeServices.models(runtimeId_),
        startEvaluation: (input) => evaluationServices.start(input),
        workspaceRoot: () => workspaceRoot,
    })
    const controlPlane = new ControlPlane({
        capabilities: capabilityStore,
        policy: createControlPolicy(),
        services: domainServices,
    })
    const controlSocket = new ControlSocketServer({userData: paths.root, controlPlane})
    const controlSocketPath = join(paths.root, "control", "control.sock")
    const runtimeRegistry = {
        discover: async () => runtimeServices.list(),
        createClient: (descriptor, options) => runtimeServices.createClient(
            descriptor.runtimeId,
            options,
        ),
    }
    const workspaceManager = new OptimizationWorkspaceManager({
        applicationSupportDirectory: paths.root,
        store: managedSkillStore,
    })
    const resolveManagedWorkspace = createManagedWorkspaceResolver({
        workspaceManager,
        managedSkillStore,
        managedSkillManager,
        resolveSkillEditWorkspace,
    })
    sessionManager = new OperatorSessionManager({
        store: jobStore,
        engine: jobEngine,
        controlPlane,
        runtimeRegistry,
        capabilities: controlCapabilities,
        controlSocketPath,
        operatorToolPath,
        transportSupport: (runtime) => ({
            dynamicToolsReady: runtime?.providerId === "codex",
            mcpServersReady: runtime?.providerId === "codebuddy" && Boolean(operatorToolPath),
            dshMcpReady: runtime?.providerId === "deepseek-harness" && Boolean(operatorToolPath),
        }),
        requestPermission,
        requestQuestion,
        workspaceRoot,
        resolveManagedSkillWorkspace: resolveManagedWorkspace,
        traceDirectory: join(paths.traces, "operator"),
    })

    function datasetSnapshot(datasetId) {
        const dataset = store.getDataset(requiredText(datasetId, "Optimization Dataset id", 200))
        const cases = store.listCases(dataset.id).sort((left, right) => (
            String(left.id).localeCompare(String(right.id))
        ))
        const rubric = store.getActiveDatasetRubric(dataset.id)
        if (!rubric) throw new Error("Optimization requires an active published Dataset Rubric")
        const binding = dataset.skillReference ?? {}
        const repositoryId = requiredText(binding.repositoryId, "Dataset repository id", 200)
        const skillId = requiredText(binding.id, "Dataset Skill id", 200)
        const body = {dataset, cases}
        return {
            dataset,
            rubric,
            snapshot: {
                id: dataset.id,
                revision: revision(body),
                caseRevisions: cases.map((entry) => ({
                    caseId: entry.id,
                    revision: Number.isSafeInteger(entry.revision) && entry.revision > 0
                        ? entry.revision
                        : revision(entry),
                    rubricVersionId: entry.rubricVersionId,
                    calibrationStatus: entry.rubricCalibration?.status === "current"
                        ? "current"
                        : "needed",
                })),
                digest: digest(body),
                repositoryId,
                skillId,
            },
        }
    }

    async function resolvePreflight(config) {
        const skill = managedSkillStore.getSkill(requiredText(
            config.skillId,
            "Optimization Skill id",
            200,
        ))
        const version = managedSkillStore.getVersion(requiredText(
            config.baselineVersionId,
            "Optimization baseline version id",
            200,
        ))
        const repository = managedSkillStore.getRepository(skill.repositoryId)
        if (version.state !== "released" || version.skillId !== skill.id ||
            version.repositoryId !== repository.id) {
            throw new Error("Optimization baseline must be the selected Skill's Released version")
        }
        const frozenDataset = datasetSnapshot(config.datasetId)
        const requestedRuntimeIds = [...new Set([
            config.operator.runtimeId,
            config.judge.runtimeId,
            ...config.targets.map((target) => target.runtimeId),
        ])]
        const runtimes = requestedRuntimeIds.map((runtimeId_) => runtimeServices.descriptor(runtimeId_))
        for (const target of config.targets) {
            optimizationReleasedSkillBinding({
                runtimeConfiguration: runtimeConfiguration(target), repository, skill,
                candidate: version, installationStore,
            })
        }
        if (config.telemetry.tokens && runtimes.some((entry) => !entry.capabilities?.includes("token-usage"))) {
            throw new Error("Optimization token telemetry is unavailable on one or more Runtimes")
        }
        if (config.telemetry.cost && runtimes.some((entry) => !entry.capabilities?.includes("cost-usage"))) {
            throw new Error("Optimization cost telemetry is unavailable on one or more Runtimes")
        }
        const skillEvidence = await snapshotManagedSkillEvidence({
            name: skill.name,
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: version.id,
            repositoryPath: repository.managedPath,
            commit: version.commit,
            skillRoot: version.skillRoot,
            contentDigest: version.contentDigest,
        }, {git: managedSkillManager.git})
        return {
            baseline: {
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: version.id,
                commit: version.commit,
                skillRoot: version.skillRoot,
                contentDigest: version.contentDigest,
                state: version.state,
            },
            dataset: frozenDataset.snapshot,
            rubric: {
                id: frozenDataset.rubric.id,
                version: frozenDataset.rubric.version,
                scoringModel: frozenDataset.rubric.rubric?.scoringModel,
                digest: frozenDataset.rubric.rubricDigest,
                datasetId: frozenDataset.dataset.id,
                publishedAt: frozenDataset.rubric.publishedAt,
            },
            skillEvidence,
        }
    }

    function runtimeConfiguration(requested) {
        const descriptor = runtimeServices.descriptor(requested.runtimeId)
        return {
            ...descriptor,
            modelId: requested.modelId ?? null,
            effort: requested.effort ?? null,
            skillEvidenceBinding: "verified",
        }
    }

    async function runEvaluation(input) {
        const snapshot = input.optimizationRun.snapshot
        const frozenDataset = datasetSnapshot(snapshot.dataset.id)
        if (frozenDataset.snapshot.digest !== snapshot.dataset.digest ||
            frozenDataset.rubric.id !== snapshot.rubric.id ||
            frozenDataset.rubric.rubricDigest !== snapshot.rubric.digest) {
            throw Object.assign(new Error("Frozen Optimization Dataset or Rubric changed"), {
                code: "RESOURCE_CHANGED",
            })
        }
        const candidate = optimizationVersionIdentity(input.candidate)
        const skill = managedSkillStore.getSkill(candidate.skillId)
        const repository = managedSkillStore.getRepository(candidate.repositoryId)
        const skillEvidence = await snapshotManagedSkillEvidence({
            name: skill.name,
            repositoryId: repository.id,
            skillId: skill.id,
            versionId: candidate.id,
            repositoryPath: repository.managedPath,
            commit: candidate.commit,
            skillRoot: candidate.skillRoot,
            contentDigest: candidate.contentDigest,
        }, {git: managedSkillManager.git})
        const installationJobsByRuntime = new Map(
            (input.installationJobs ?? []).map((job) => [job.runtime.runtimeId, job]),
        )
        const runtimeConfigurations = input.targets.map((target) => {
            const resolved = runtimeConfiguration(target)
            if (input.kind === "baseline" || input.kind === "final-regression") {
                return optimizationReleasedSkillBinding({runtimeConfiguration: resolved, repository, skill, candidate, installationStore})
            }
            return optimizationRuntimeSkillBinding({
                runtimeConfiguration: resolved,
                repository,
                skill,
                candidate,
                installationJob: installationJobsByRuntime.get(resolved.runtimeId),
            })
        })
        const installationJobIdsByRuntime = Object.fromEntries(runtimeConfigurations.map((configuration) => [
            configuration.runtimeId, configuration.installationJobId,
        ]))
        const run = store.createEvaluationRun({
            datasetId: snapshot.dataset.id,
            caseIds: snapshot.dataset.caseRevisions.map((entry) => entry.caseId),
            selectionMode: "selected",
            activationMode: snapshot.activationMode,
            skillEvidence,
            managedVersionSnapshot: {
                repositoryId: repository.id,
                skillId: skill.id,
                versionId: candidate.id,
                commit: candidate.commit,
                skillRoot: candidate.skillRoot,
                contentDigest: candidate.contentDigest,
                installationJobIdsByRuntime,
            },
            judgeProfile: {
                runtimePolicy: "active",
                modelId: snapshot.judge.modelId,
                effort: snapshot.judge.effort,
            },
            judgeConfiguration: runtimeConfiguration(snapshot.judge),
            runtimeConfigurations,
        }, {optimizationAuthorized: true})
        optimizationStore.updateCheckpoint(input.optimizationRun.id, {activeEvaluationRunId: run.id, activeEvaluationKind: input.kind})
        await evaluationRunner.run(run)
        return store.getEvaluationRun(run.id)
    }

    const operatorGateway = new OptimizationOperatorGateway({
        onRequest: ({runId: runId_, kind, epoch, operatorSessionId}) => {
            const run = optimizationStore.getRun(runId_)
            const evaluation = (id) => id ? store.getEvaluationRun(id) : null
            return sessionManager.sendMessage(operatorSessionId, optimizationRequestMessage({
                run, kind, epoch,
                baselineEvaluation: evaluation(run.checkpoint.baselineEvaluationRunId),
                currentEvaluation: evaluation(run.checkpoint.activeEvaluationRunId),
            }))
        },
    })
    const runner = new OptimizationRunner({
        store: optimizationStore,
        artifactStore: jobStore,
        childJobs: createOptimizationChildJobs({jobStore, jobEngine}),
        workspaceManager,
        installationManager,
        evaluationManager: {run: runEvaluation},
        operatorGateway,
        approvals: {
            request: async (input, onPending = null) => {
                const approval = await jobEngine.requestApproval(
                    input.parentJobId,
                    optimizationApprovalRequest(input),
                    {onPending},
                )
                return {
                    ...approval,
                    ...(input.kind === "release" || input.kind === "release-install"
                        ? {versionLabel: `opt-${input.runId.slice(-40)}-e${input.epoch}`.slice(0, 64)}
                        : {}),
                }
            },
            reject: (approvalId) => jobEngine.resolveApproval(approvalId, {
                decision: "reject",
                scope: "optimization_cancel",
                decidedBy: "optimization-runner",
            }),
            suspend: (approvalId) => jobEngine.suspendApprovalWaiter(approvalId),
        },
        releaseManager: {release: (input) => managedSkillManager.releaseVersion({
            versionId: input.candidate.id,
            versionLabel: input.approval.versionLabel,
            expectedCandidate: {
                commit: input.candidate.commit,
                contentDigest: input.candidate.contentDigest,
                state: input.candidate.state,
                versionLabel: input.approval.versionLabel,
            },
        })},
        telemetry: ({runId: runId_}) => {
            const run = optimizationStore.getRun(runId_)
            return {
                elapsedMs: Math.max(0, Date.now() - Date.parse(run.createdAt)),
                turnsUsed: 0,
                tokensUsed: run.snapshot.telemetry?.tokens === true ? 0 : null,
                costMicros: run.snapshot.telemetry?.cost === true ? 0 : null,
            }
        },
        onChanged: optimizationChanged,
    })
    optimizationControl = new OptimizationControlService({
        store: optimizationStore,
        workspaceManager,
        operatorSessionManager: sessionManager,
        runner,
        operatorGateway,
        artifactStore: jobStore,
        readArtifact: (artifactId, maximumBytes) => {
            const artifact = jobStore.getArtifact(artifactId)
            if (artifact.byteLength > maximumBytes) return null
            return jobStore.readArtifactBody(artifactId)
        },
        operatorTurnsUsed: (run) => jobStore.getSession(run.checkpoint.operatorSessionId).transcript
            .filter((entry) => entry.kind === "turn_started").length,
        resolvePreflight,
    })
    const ready = Promise.all([
        controlSocket.start().catch(() => null),
        optimizationControl.recoverStartup(),
    ])
    const services = createOperatorServices({
        jobStore,
        jobEngine,
        sessionManager,
        optimizationStore,
        optimizationControl,
        ready,
    })

    async function close() {
        await Promise.allSettled([
            sessionManager.stopAll({preserveWaitingApprovals: true}),
            runner.checkpointAndStop?.(),
        ])
        await Promise.allSettled([
            runner.waitForIdle?.(),
            controlSocket.close(),
        ])
        await Promise.allSettled([...optimizationCompletionTasks.values()])
        optimizationStore.close()
        jobStore.close()
    }

    return Object.freeze({
        close,
        controlCapabilities,
        controlPlane,
        controlSocketPath,
        jobEngine,
        jobStore,
        optimizationControl,
        optimizationStore,
        ready,
        services,
        sessionManager,
    })
}

function createOptimizationChildJobs({jobStore, jobEngine}) {
    return {
        run(input, operation) {
            // Internal phases share the frozen authority of their parent. The job
            // engine requires an explicit budget; it does not inherit one itself.
            const parent = jobStore.getJob(input.parentJobId)
            return jobEngine.runChild({...input, budget: parent.budget}, operation)
        },
    }
}

module.exports = {
    createOptimizationChildJobs,
    createManagedWorkspaceResolver,
    optimizationApprovalRequest,
    createOperatorRuntime,
    createOperatorServices,
    optimizationRuntimeSkillBinding,
    optimizationVersionIdentity,
    optimizationReleasedSkillBinding,
    publicOperatorValue: publicValue,
}
const {createHash} = require("node:crypto")
const {optimizationRequestMessage} = require("./optimization-agent-context.cjs")
const {basename, join} = require("node:path")

const {
    snapshotManagedSkillEvidence,
} = require("../../../desktop/rolling-skill/src/evaluation-skill-evidence.cjs")
const {
    CapabilityStore,
    createTrustedCapabilityIssuer,
} = require("../../../desktop/rolling-skill/src/control-plane/capability-store.cjs")
const {
    ControlPlane,
} = require("../../../desktop/rolling-skill/src/control-plane/control-plane.cjs")
const {
    CONTROL_METHODS,
    controlDefinition,
} = require("../../../desktop/rolling-skill/src/control-plane/contracts.cjs")
const {
    createDomainServices,
} = require("../../../desktop/rolling-skill/src/control-plane/domain-services.cjs")
const {
    createControlPolicy,
} = require("../../../desktop/rolling-skill/src/control-plane/policy.cjs")
const {
    ControlSocketServer,
} = require("../../../desktop/rolling-skill/src/control-plane/socket-server.cjs")
const {
    OperatorJobEngine,
} = require("../../../desktop/rolling-skill/src/operator/job-engine.cjs")
const {
    OperatorJobStore,
} = require("../../../desktop/rolling-skill/src/operator/job-store.cjs")
const {
    OperatorSessionManager,
} = require("../../../desktop/rolling-skill/src/operator/operator-session-manager.cjs")
const {
    OptimizationControlService,
} = require("../../../desktop/rolling-skill/src/optimization/optimization-control-service.cjs")
const {
    OptimizationOperatorGateway,
} = require("../../../desktop/rolling-skill/src/optimization/optimization-operator-gateway.cjs")
const {
    OptimizationRunner,
} = require("../../../desktop/rolling-skill/src/optimization/optimization-runner.cjs")
const {
    OptimizationStore,
} = require("../../../desktop/rolling-skill/src/optimization/optimization-store.cjs")
const {
    OptimizationWorkspaceManager,
} = require("../../../desktop/rolling-skill/src/optimization/optimization-workspace.cjs")
