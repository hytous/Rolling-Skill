const {isAbsolute, posix} = require("node:path")

const INSTALL_RESULT_SCHEMA = "rolling-skill-install-result/v2"
const DIGEST_ALGORITHM = "rolling-skill-tree-sha256/v1"
const STATUSES = new Set(["succeeded", "failed", "cancelled", "unverified", "needs_recovery"])
const ORDINARY_OPERATIONS = new Set(["install", "update", "overwrite", "inspect"])
const EXPERIMENT_OPERATIONS = new Set([
    "experiment_install",
    "experiment_restore",
    "experiment_remove",
    "experiment_inspect",
])
const OPERATIONS = new Set([...ORDINARY_OPERATIONS, ...EXPERIMENT_OPERATIONS])
const CLASSIFICATIONS = new Set([
    "absent",
    "managed-clean",
    "managed-drifted",
    "unmanaged",
    "conflict",
    "uncertain",
])
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u

function requiredText(value, label, maxLength = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maxLength) throw new Error(`${label} is required`)
    return normalized
}

function nullableText(value, label, maxLength = 4_096) {
    if (value === null || value === undefined) return null
    return requiredText(value, label, maxLength)
}

function relativeSkillRoot(value) {
    const root = requiredText(value, "Skill root").replace(/\\/gu, "/")
    if (
        isAbsolute(root) ||
        (root !== "." && (
            posix.normalize(root) !== root ||
            root.split("/").some((segment) => !segment || segment === "." || segment === "..")
        ))
    ) throw new Error("Skill root must be repository-relative")
    return root
}

function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    return Object.freeze(value)
}

function requireEnum(value, values, label) {
    const normalized = requiredText(value, label, 80)
    if (!values.has(normalized)) throw new Error(`Installation result ${label} is invalid`)
    return normalized
}

function normalizeError(value, required) {
    if (!required && (value === null || value === undefined)) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Installation result error is required")
    }
    return {
        code: requiredText(value.code, "Installation error code", 200),
        message: requiredText(value.message, "Installation error message", 8_192),
    }
}

function versionSource(version, label) {
    const commit = requiredText(version?.commit, `${label} commit`, 40)
    if (!COMMIT_PATTERN.test(commit)) throw new Error(`${label} commit must be a full SHA-1`)
    const expectedDigest = requiredText(version?.contentDigest, `${label} content digest`, 80)
    if (!DIGEST_PATTERN.test(expectedDigest)) throw new Error(`${label} content digest must be SHA-256`)
    return {
        repositoryId: requiredText(version?.repositoryId, `${label} repository id`, 200),
        skillId: requiredText(version?.skillId, `${label} Skill id`, 200),
        versionId: requiredText(version?.id, `${label} version id`, 200),
        commit,
        skillRoot: relativeSkillRoot(version?.skillRoot),
        expectedDigest,
    }
}

function freezeSkillInstallationRequest(input = {}) {
    const repositoryId = requiredText(input.repository?.id, "Repository id", 200)
    const repositoryPath = requiredText(input.repository?.managedPath, "Managed repository path")
    if (!isAbsolute(repositoryPath)) throw new Error("Managed repository path must be absolute")
    const skillId = requiredText(input.skill?.id, "Skill id", 200)
    const skillName = requiredText(input.skill?.name, "Skill name", 200)
    const skillRoot = relativeSkillRoot(input.skill?.skillRoot)
    const versionId = requiredText(input.version?.id, "Version id", 200)
    if (input.version?.state !== "released") {
        throw new Error("Only a Released Skill version can be installed")
    }
    if (input.version?.repositoryId !== repositoryId || input.version?.skillId !== skillId) {
        throw new Error("Released version does not belong to the selected Skill")
    }
    const commit = requiredText(input.version?.commit, "Released commit", 40)
    if (!COMMIT_PATTERN.test(commit)) throw new Error("Released commit must be a full SHA-1")
    const expectedDigest = requiredText(input.version?.contentDigest, "Released content digest", 80)
    if (!DIGEST_PATTERN.test(expectedDigest)) {
        throw new Error("Released content digest must be SHA-256")
    }
    const versionLabel = requiredText(input.version?.versionLabel, "Released version label", 64)
    return deepFreeze({
        schema: "rolling-skill-install-request/v1",
        purpose: "managed-installation",
        repositoryPath,
        skillName,
        versionLabel,
        source: {
            repositoryId,
            skillId,
            versionId,
            commit,
            skillRoot,
            expectedDigest,
        },
    })
}

function freezeInitialState(value, baselineSource) {
    if (value === null || value === undefined) return null
    const classification = requireEnum(value.classification, CLASSIFICATIONS, "initial classification")
    if (!new Set(["absent", "managed-clean"]).has(classification)) {
        throw new Error("Optimization experiment initial state must be absent or managed-clean")
    }
    if (classification === "absent") {
        if (value.destination !== null && value.destination !== undefined) {
            throw new Error("An absent optimization target cannot have a destination")
        }
        return {classification, destination: null}
    }
    const destination = requiredText(value.destination, "Initial managed destination")
    if (!isAbsolute(destination)) throw new Error("Initial managed destination must be absolute")
    if (
        value.versionId !== baselineSource.versionId ||
        value.commit !== baselineSource.commit ||
        value.contentDigest !== baselineSource.expectedDigest
    ) {
        throw new Error("Initial managed target must exactly match the frozen baseline")
    }
    return {
        classification,
        destination,
        versionId: baselineSource.versionId,
        commit: baselineSource.commit,
        contentDigest: baselineSource.expectedDigest,
    }
}

function freezeSkillExperimentRequest(input = {}) {
    const operation = requiredText(input.operation, "Optimization experiment operation", 80)
    if (!EXPERIMENT_OPERATIONS.has(operation)) {
        throw new Error("Unsupported optimization experiment operation")
    }
    const runId = requiredText(input.run?.id, "Optimization Run id", 200)
    const snapshotDigest = requiredText(
        input.run?.snapshot?.digest,
        "Optimization Run snapshot digest",
        80,
    )
    if (!DIGEST_PATTERN.test(snapshotDigest)) {
        throw new Error("Optimization Run snapshot digest must be SHA-256")
    }
    const epoch = Number(input.epoch)
    if (!Number.isSafeInteger(epoch) || epoch < 1) {
        throw new Error("Optimization Epoch must be a positive safe integer")
    }
    const repositoryId = requiredText(input.repository?.id, "Repository id", 200)
    const repositoryPath = requiredText(input.repository?.managedPath, "Managed repository path")
    if (!isAbsolute(repositoryPath)) throw new Error("Managed repository path must be absolute")
    const skillId = requiredText(input.skill?.id, "Skill id", 200)
    const skillName = requiredText(input.skill?.name, "Skill name", 200)
    const skillRoot = relativeSkillRoot(input.skill?.skillRoot)
    if (input.skill?.repositoryId !== repositoryId) {
        throw new Error("Optimization Skill does not belong to the selected repository")
    }

    if (input.baseline?.state !== "released") {
        throw new Error("Optimization experiment requires a Released baseline")
    }
    const baseline = versionSource(input.baseline, "Optimization baseline")
    const frozenBaseline = input.run?.snapshot?.baseline ?? {}
    if (
        baseline.repositoryId !== repositoryId ||
        baseline.skillId !== skillId ||
        baseline.skillRoot !== skillRoot ||
        frozenBaseline.repositoryId !== baseline.repositoryId ||
        frozenBaseline.skillId !== baseline.skillId ||
        frozenBaseline.versionId !== baseline.versionId ||
        frozenBaseline.commit !== baseline.commit ||
        frozenBaseline.skillRoot !== baseline.skillRoot ||
        frozenBaseline.contentDigest !== baseline.expectedDigest
    ) {
        throw new Error("Optimization baseline does not match the frozen Run")
    }

    if (input.candidate?.state !== "candidate" || input.candidate?.createdBy !== "optimization") {
        throw new Error("Optimization experiment requires an immutable optimization Candidate")
    }
    const source = versionSource(input.candidate, "Optimization Candidate")
    if (
        source.repositoryId !== repositoryId ||
        source.skillId !== skillId ||
        source.skillRoot !== skillRoot
    ) {
        throw new Error("Optimization Candidate does not belong to the frozen Skill")
    }
    if (input.candidate.optimizationRunId !== runId || input.candidate.optimizationEpoch !== epoch) {
        throw new Error("Optimization Candidate does not match the frozen Run and Epoch")
    }

    let previous = null
    if (epoch > 1) {
        if (!input.previousCandidate) {
            throw new Error("A later Optimization Epoch requires the previous Candidate")
        }
        if (
            input.previousCandidate.state !== "candidate" ||
            input.previousCandidate.createdBy !== "optimization" ||
            input.previousCandidate.optimizationRunId !== runId ||
            input.previousCandidate.optimizationEpoch !== epoch - 1
        ) {
            throw new Error("Optimization previous Candidate does not match the prior Run Epoch")
        }
        previous = versionSource(input.previousCandidate, "Optimization previous Candidate")
        if (
            previous.repositoryId !== repositoryId ||
            previous.skillId !== skillId ||
            previous.skillRoot !== skillRoot
        ) {
            throw new Error("Optimization previous Candidate does not belong to the frozen Skill")
        }
    } else if (input.previousCandidate !== null && input.previousCandidate !== undefined) {
        throw new Error("The first Optimization Epoch cannot have a previous Candidate")
    }

    const initial = freezeInitialState(input.initial, baseline)
    if (operation !== "experiment_inspect" && !initial) {
        throw new Error("Optimization mutation requires a frozen initial target state")
    }
    if (operation === "experiment_restore" && initial?.classification !== "managed-clean") {
        throw new Error("Optimization restore requires a managed-clean initial baseline")
    }
    if (operation === "experiment_remove" && initial?.classification !== "absent") {
        throw new Error("Optimization removal requires an initially absent target")
    }
    const restoration = initial === null
        ? null
        : initial.classification === "absent"
          ? {mode: "remove", source: null}
          : {mode: "restore", source: {...baseline}}
    return deepFreeze({
        schema: "rolling-skill-experiment-request/v1",
        purpose: "optimization-experiment",
        operation,
        repositoryPath,
        skillName,
        versionLabel: `Candidate Epoch ${epoch}`,
        source,
        experiment: {
            runId,
            epoch,
            snapshotDigest,
            inspectionMode: operation === "experiment_inspect" ? "preflight" : null,
            baseline,
            initial,
            restoration,
            previous,
        },
    })
}

function freezeSkillExperimentRecoveryInspectionRequest(request) {
    if (
        request?.purpose !== "optimization-experiment" ||
        !EXPERIMENT_OPERATIONS.has(request.operation) ||
        !request.experiment ||
        typeof request.experiment.runId !== "string" ||
        !Number.isSafeInteger(request.experiment.epoch) ||
        request.experiment.epoch < 1
    ) {
        throw new Error("A frozen optimization experiment request is required for recovery inspection")
    }
    return deepFreeze({
        ...request,
        operation: "experiment_inspect",
        experiment: {
            ...request.experiment,
            inspectionMode: "recovery",
        },
    })
}

function installationPromptEvidence(value) {
    if (!value || typeof value !== "object") return null
    const destination = typeof value.destination === "string" ? value.destination.trim() : ""
    if (!destination || destination.length > 4_096 || !isAbsolute(destination)) return null
    const evidence = {destination}
    for (const field of [
        "runtimeId",
        "providerId",
        "skillId",
        "repositoryId",
        "versionId",
        "commit",
        "contentDigest",
        "verification",
        "installedAt",
    ]) {
        const text = typeof value[field] === "string" ? value[field].trim() : ""
        if (text && text.length <= 4_096) evidence[field] = text
    }
    return deepFreeze(evidence)
}

function registrationOperation(request, options = {}) {
    if (request?.purpose === "optimization-experiment") return request.operation
    const operation = options.operation ?? "install"
    if (!ORDINARY_OPERATIONS.has(operation)) {
        throw new Error("Installation registration operation is invalid")
    }
    return operation
}

function registrationWarnings(value) {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value) || value.length > 100) {
        throw new Error("Installation registration warnings are invalid")
    }
    return value.map((warning) => requiredText(warning, "Installation warning", 4_096))
}

function validateExperimentRegistration({
    actualDigest,
    beforeDigest,
    classificationBefore,
    destination,
    mutationPerformed,
    operation,
    request,
}) {
    if (operation === "experiment_inspect") {
        if (mutationPerformed) throw new Error("Optimization experiment inspection must not mutate the target")
        if (classificationBefore === "absent") {
            if (destination !== null || actualDigest !== null || beforeDigest !== null) {
                throw new Error("Optimization absent inspection evidence is inconsistent")
            }
            return
        }
        if (classificationBefore !== "managed-clean" || !destination || beforeDigest !== actualDigest) {
            throw new Error("Optimization inspection requires one exact clean target state")
        }
        const allowed = request.experiment.inspectionMode === "recovery"
            ? new Set([request.source.expectedDigest, request.experiment.baseline.expectedDigest])
            : new Set([request.experiment.baseline.expectedDigest])
        if (!allowed.has(actualDigest)) {
            throw new Error("Optimization inspection digest does not match Candidate or baseline")
        }
        return
    }
    if (!mutationPerformed) {
        throw new Error("A successful optimization experiment mutation must report its mutation")
    }
    if (!destination) throw new Error("A successful optimization mutation requires an absolute destination")
    if (operation === "experiment_install") {
        const expectedBefore = request.experiment.previous?.expectedDigest ?? (
            request.experiment.initial.classification === "absent"
                ? null
                : request.experiment.baseline.expectedDigest
        )
        if (beforeDigest !== expectedBefore) {
            throw new Error(request.experiment.previous
                ? "Installed target does not match the previous Candidate digest"
                : "Installed target does not match the frozen initial digest")
        }
        if (actualDigest !== request.source.expectedDigest) {
            throw new Error("Installed Candidate digest does not match the frozen Candidate")
        }
        return
    }
    if (beforeDigest !== request.source.expectedDigest) {
        throw new Error("Restoration target does not match the current Candidate digest")
    }
    if (operation === "experiment_restore") {
        if (actualDigest !== request.experiment.baseline.expectedDigest) {
            throw new Error("Restored target does not match the frozen baseline digest")
        }
        return
    }
    if (operation === "experiment_remove" && actualDigest === null) return
    throw new Error("Removed experiment target is not proven absent")
}

function validateSkillInstallationRegistration(value, request, options = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Installation registration evidence is required")
    }
    const expectedOperation = registrationOperation(request, options)
    const operation = requireEnum(value.operation, OPERATIONS, "operation")
    if (operation !== expectedOperation) {
        throw new Error("Installation registration operation does not match the frozen request")
    }
    const status = requireEnum(value.status, STATUSES, "status")
    const experiment = request?.purpose === "optimization-experiment"
    if (!experiment && status === "needs_recovery") {
        throw new Error("Ordinary installation cannot report optimization recovery state")
    }
    const classificationBefore = requireEnum(
        value.classificationBefore,
        CLASSIFICATIONS,
        "classification",
    )
    const destination = nullableText(value.destination, "Installation destination")
    if (destination && !isAbsolute(destination)) {
        throw new Error("Installation destination must be absolute")
    }
    const actualDigest = nullableText(value.actualDigest, "Actual installation digest", 80)
    if (actualDigest && !DIGEST_PATTERN.test(actualDigest)) {
        throw new Error("Actual installation digest is invalid")
    }
    const beforeDigest = nullableText(value.beforeDigest, "Installation before digest", 80)
    if (beforeDigest && !DIGEST_PATTERN.test(beforeDigest)) {
        throw new Error("Installation before digest is invalid")
    }
    const mutationPerformed = value.mutationPerformed === true
    const runtimeDiscovered = value.runtimeDiscovered === true
        ? true
        : value.runtimeDiscovered === false
          ? false
          : null
    const warnings = registrationWarnings(value.warnings)
    const error = normalizeError(value.error, status !== "succeeded")
    let verification = "none"
    if (status === "succeeded") {
        if (experiment) {
            validateExperimentRegistration({
                actualDigest,
                beforeDigest,
                classificationBefore,
                destination,
                mutationPerformed,
                operation,
                request,
            })
        } else {
            const absentInspection = operation === "inspect" && classificationBefore === "absent"
            if (absentInspection) {
                if (destination !== null || actualDigest !== null || beforeDigest !== null) {
                    throw new Error("Absent installation inspection evidence is inconsistent")
                }
            } else {
                if (!destination) throw new Error("Successful installation requires an absolute destination")
                if (actualDigest !== request.source.expectedDigest) {
                    throw new Error("Successful installation digest does not match the frozen digest")
                }
            }
            if (operation === "inspect" && mutationPerformed) {
                throw new Error("Read-only installation inspection must not report a mutation")
            }
        }
        verification = runtimeDiscovered === true ? "runtime-inventory" : "filesystem-only"
    }
    return deepFreeze({
        schema: INSTALL_RESULT_SCHEMA,
        purpose: request.purpose,
        status,
        operation,
        classificationBefore,
        destination,
        source: {...request.source},
        permission: {
            requested: nullableText(options.requestedPermission, "Requested permission", 100),
            effective: nullableText(options.effectivePermission, "Effective permission", 100),
        },
        result: {
            actualDigest,
            beforeDigest,
            mutationPerformed,
            runtimeDiscovered,
        },
        warnings,
        error,
        verification,
        trusted: status === "succeeded" && verification !== "none",
    })
}

function operationProcedure(request, operation) {
    if (operation === "inspect" || operation === "experiment_inspect") {
        return [
            "6. This Job is strictly read-only. Do not create, edit, move, delete, overwrite, chmod, or request write permission.",
            "7. Compare the live target with the frozen source, baseline, prior Candidate, and central-journal evidence supplied in this request.",
        ]
    }
    if (operation === "experiment_install") {
        const prior = request.experiment.previous
            ? "the previous Candidate digest"
            : "the frozen initial baseline digest or the proven absent state"
        return [
            `6. Continue only when the live target exactly matches ${prior}; otherwise register needs_recovery without mutation.`,
            "7. Install the exact frozen Candidate, recompute the live digest, and do not represent it as a Released installation.",
        ]
    }
    if (operation === "experiment_restore") {
        return [
            "6. Continue only when the live target exactly matches the current Candidate digest; otherwise register needs_recovery without mutation.",
            "7. Restore only the frozen Released baseline, then recompute the live digest.",
        ]
    }
    if (operation === "experiment_remove") {
        return [
            "6. Continue only when the live target exactly matches the current Candidate digest; otherwise register needs_recovery without mutation.",
            "7. Remove only that exact Candidate target, then prove the target is absent.",
        ]
    }
    return [
        "6. This explicit installation Job authorizes replacing only the exact discovered Skill target. Do not request a second overwrite confirmation for that exact target.",
        "7. Install or update the exact frozen Released source, then recompute the live target digest.",
    ]
}

function buildSkillInstallationPrompt(request, options = {}) {
    const experiment = request?.purpose === "optimization-experiment"
    const operation = registrationOperation(request, options)
    const requestedPermission = nullableText(options.requestedPermission, "Requested permission", 100)
    const priorInstallation = installationPromptEvidence(options.priorInstallation)
    const registrationInstruction = requiredText(
        options.registrationInstruction ??
            "Call rolling_skill_installations_register with the verified terminal evidence.",
        "Installation registration instruction",
        8_192,
    )
    const frozenRequest = {
        operation,
        purpose: request.purpose,
        digestAlgorithm: DIGEST_ALGORITHM,
        repositoryPath: request.repositoryPath,
        skillName: request.skillName,
        versionLabel: request.versionLabel,
        source: request.source,
        priorInstallation,
        ...(experiment ? {experiment: request.experiment} : {}),
    }
    const inspection = operation === "inspect" || operation === "experiment_inspect"
    const actualDigestExample = inspection
        ? "sha256:<live digest> or null when absent"
        : operation === "experiment_restore"
          ? request.experiment.baseline.expectedDigest
          : operation === "experiment_remove"
            ? null
            : request.source.expectedDigest
    const beforeDigestExample = inspection
        ? "same as actualDigest, or null when absent"
        : operation === "experiment_install"
          ? request.experiment.previous?.expectedDigest ?? (
              request.experiment.initial.classification === "absent"
                  ? null
                  : request.experiment.baseline.expectedDigest
          )
          : operation === "experiment_restore" || operation === "experiment_remove"
            ? request.source.expectedDigest
            : "sha256:<previous live digest> or null when absent"
    const procedure = [
        "1. Verify the exact repository, commit, Skill root, and frozen source digest before touching the Runtime target.",
        "2. Export only source.skillRoot from the frozen commit. Never install from the working tree and never execute scripts from the managed Skill. Only delete temporary paths created by this Job. Never delete or modify pre-existing temporary paths.",
        "3. Discover the exact Skill target actually used by this Runtime. priorInstallation.destination is a hint only; verify the Runtime identity and path boundary yourself.",
        "4. Compute deterministic digests over every real file and symbolic link in the Skill root. Do not add controller metadata to the target directory.",
        "5. Refuse symlink targets, broad or dangerous destinations, ambiguous Skill identity, or any operation that could affect a parent or sibling.",
        ...operationProcedure(request, operation),
        "8. Refresh or query the Runtime Skill inventory when supported. Use runtimeDiscovered=null when it cannot prove discovery.",
        "9. Report every terminal outcome through the registration tool, including structured failures. Do not encode Job, Runtime, Skill, version, commit, Run, or Epoch identity in tool arguments; the App binds those identities to this Job.",
        `10. ${registrationInstruction}`,
        "11. The final assistant response is display-only. Keep it short and never place a machine-readable installation result in the response.",
    ]
    return [
        experiment
            ? "You are running one bounded Skill optimization installation Job."
            : "You are running one managed Skill installation Job.",
        "Perform path discovery, filesystem work, and verification yourself through this Runtime's tools.",
        "Rolling Skill records ownership and recovery state centrally; leave the Runtime Skill directory free of controller metadata.",
        "",
        "Frozen installation request (immutable):",
        JSON.stringify(frozenRequest, null, 2),
        "",
        `Digest algorithm ${DIGEST_ALGORITHM}: enumerate every file and symbolic link below the Skill root; sort relative POSIX paths lexicographically; for each entry hash UTF-8 header type\\0path\\0executable-bit\\0byte-length\\0, then exact blob/link-target bytes, then one NUL byte.`,
        "",
        "Required procedure:",
        ...procedure,
        "",
        "Registration arguments:",
        JSON.stringify({
            status: "succeeded | failed | cancelled | unverified | needs_recovery",
            operation,
            classificationBefore:
                "absent | managed-clean | managed-drifted | unmanaged | conflict | uncertain",
            destination: "/absolute/runtime/skill/path or null",
            actualDigest: actualDigestExample,
            beforeDigest: beforeDigestExample,
            mutationPerformed: !inspection,
            runtimeDiscovered: null,
            warnings: [],
            error: null,
        }, null, 2),
        requestedPermission ? `Requested permission profile: ${requestedPermission}` : "",
    ].join("\n")
}

module.exports = {
    INSTALL_RESULT_SCHEMA,
    DIGEST_ALGORITHM,
    buildSkillInstallationPrompt,
    freezeSkillExperimentRequest,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillInstallationRequest,
    validateSkillInstallationRegistration,
}
