const {isAbsolute, posix} = require("node:path")

const INSTALL_MARKER_SCHEMA = "rolling-skill-install/v1"
const EXPERIMENT_MARKER_SCHEMA = "rolling-skill-experiment/v1"
const EXPERIMENT_MARKER_FILE = ".rolling-skill-experiment.json"
const INSTALL_RESULT_SCHEMA = "rolling-skill-install-result/v2"
const INSTALL_RESULT_SENTINEL = Object.freeze({
    open: "<rolling-skill-install-result>",
    close: "</rolling-skill-install-result>",
})

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
const DIGEST_ALGORITHM = "rolling-skill-tree-sha256/v1"

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

function experimentMarker(runId, epoch, source) {
    return {
        schema: EXPERIMENT_MARKER_SCHEMA,
        runId,
        epoch,
        skillId: source.skillId,
        versionId: source.versionId,
        commit: source.commit,
        contentDigest: source.expectedDigest,
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
        markerSchema: INSTALL_MARKER_SCHEMA,
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
    const snapshotDigest = requiredText(input.run?.snapshot?.digest, "Optimization Run snapshot digest", 80)
    if (!DIGEST_PATTERN.test(snapshotDigest)) {
        throw new Error("Optimization Run snapshot digest must be SHA-256")
    }
    const epoch = Number(input.epoch)
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 100) {
        throw new Error("Optimization Epoch must be between 1 and 100")
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
        previous.marker = experimentMarker(runId, epoch - 1, previous)
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
        markerSchema: EXPERIMENT_MARKER_SCHEMA,
        repositoryPath,
        skillName,
        versionLabel: `Candidate Epoch ${epoch}`,
        source,
        experiment: {
            runId,
            epoch,
            snapshotDigest,
            inspectionMode: operation === "experiment_inspect" ? "preflight" : null,
            marker: experimentMarker(runId, epoch, source),
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
        !sameMarker(request.experiment.marker, experimentMarker(
            request.experiment.runId,
            request.experiment.epoch,
            request.source,
        ))
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

function buildSkillInstallationPrompt(request, options = {}) {
    const experiment = request?.purpose === "optimization-experiment"
    if (!experiment) {
        request = freezeSkillInstallationRequest({
            repository: {id: request.source.repositoryId, managedPath: request.repositoryPath},
            skill: {id: request.source.skillId, name: request.skillName, skillRoot: request.source.skillRoot},
            version: {
                id: request.source.versionId,
                repositoryId: request.source.repositoryId,
                skillId: request.source.skillId,
                state: "released",
                commit: request.source.commit,
                contentDigest: request.source.expectedDigest,
                versionLabel: request.versionLabel,
            },
        })
    }
    const operation = experiment
        ? request.operation
        : ORDINARY_OPERATIONS.has(options.operation) ? options.operation : "install"
    const requestedPermission = nullableText(
        options.requestedPermission,
        "Requested permission",
        100,
    )
    const priorInstallation = installationPromptEvidence(options.priorInstallation)
    let experimentResult = null
    let destinationExample = "/absolute/path/reported/by/the/runtime"
    if (experiment) {
        const currentMarker = request.experiment.marker
        if (operation === "experiment_inspect" && request.experiment.inspectionMode !== "recovery") {
            experimentResult = {
                actualDigest: request.experiment.baseline.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: null,
                beforeDigest: request.experiment.baseline.expectedDigest,
                mutationPerformed: false,
                markerBefore: null,
                markerAfter: null,
            }
        } else if (operation === "experiment_inspect") {
            experimentResult = {
                actualDigest: request.source.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: null,
                beforeDigest: request.source.expectedDigest,
                mutationPerformed: false,
                markerBefore: currentMarker,
                markerAfter: currentMarker,
            }
        } else if (operation === "experiment_restore") {
            experimentResult = {
                actualDigest: request.experiment.baseline.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: null,
                beforeDigest: request.source.expectedDigest,
                mutationPerformed: true,
                markerBefore: currentMarker,
                markerAfter: null,
            }
        } else if (operation === "experiment_remove") {
            experimentResult = {
                actualDigest: null,
                markerWritten: false,
                runtimeDiscovered: false,
                beforeDigest: request.source.expectedDigest,
                mutationPerformed: true,
                markerBefore: currentMarker,
                markerAfter: null,
            }
        } else {
            const previous = request.experiment.previous
            const beforeDigest = previous?.expectedDigest ?? (
                request.experiment.initial?.classification === "managed-clean"
                    ? request.experiment.baseline.expectedDigest
                    : null
            )
            experimentResult = {
                actualDigest: request.source.expectedDigest,
                markerWritten: true,
                runtimeDiscovered: null,
                beforeDigest,
                mutationPerformed: true,
                markerBefore: previous?.marker ?? null,
                markerAfter: currentMarker,
            }
        }
    }
    const finalShape = {
        schema: INSTALL_RESULT_SCHEMA,
        purpose: experiment ? "optimization-experiment" : "managed-installation",
        status: experiment
            ? "succeeded | failed | cancelled | unverified | needs_recovery"
            : "succeeded | failed | cancelled | unverified",
        operation: experiment
            ? "experiment_install | experiment_restore | experiment_remove | experiment_inspect"
            : "install | update | overwrite | inspect",
        classificationBefore:
            "absent | managed-clean | managed-drifted | unmanaged | conflict | uncertain",
        destination: destinationExample,
        source: request.source,
        permission: {requested: requestedPermission, effective: null},
        result: experimentResult ?? {
            actualDigest: request.source.expectedDigest,
            markerWritten: true,
            runtimeDiscovered: null,
        },
        warnings: [],
        error: null,
    }
    const managedReadScope = "Read scope: the specified repository, the exact Skill target and markers, and this Runtime's own Skill inventory or configuration. Start with priorInstallation.destination when it is present, but still verify that it is the exact non-symlink target for skillName before mutation. Do not search controller stores, Job records, historical conversations, or traces; every immutable request value is already in the frozen JSON. Do not search application source for another copy of the request."
    let procedure
    if (experiment) {
        const common = [
            "1. This is an optimization experiment. Use the supplied frozen request as the authority for Run identity and operation; verify its exact repository, commit, Skill identity, and digest against the filesystem before touching any Runtime target.",
            "Read scope: only the specified repository, exact Skill target/markers, and this Runtime's own Skill inventory. Do not search controller stores, historical conversations, traces, or application source code for precedents or another copy of the request. Parse/copy exact values from the supplied JSON; do not retype or guess UUIDs or paths. If the frozen repository path does not exist, stop with a concrete failure and no mutation; do not infer a replacement repository.",
            "2. Export only source.skillRoot from the exact frozen commit. Never use the managed Working tree or implicit HEAD, and never run code from the Skill.",
            "3. Discover the exact Runtime target yourself. Refuse symlinks, broad destinations, ambiguous identity boundaries, or any path you cannot prove is the one Skill target.",
            "4. Inspect the current target, deterministic digest, management marker, and rolling-skill-experiment/v1 marker before any mutation.",
        ]
        if (operation === "experiment_inspect") {
            procedure = request.experiment.inspectionMode === "recovery"
                ? [
                    ...common,
                    "5. This is a strict read-only recovery inspection. Do not create, edit, move, delete, overwrite, or chmod any target or marker, and do not request write permission.",
                    "6. Inspect for the exact current Candidate marker and digest, the exact frozen Released baseline without an experiment marker, or the exact absent state. Any partial or mismatched state must report needs_recovery with mutationPerformed=false.",
                    "7. Report mutationPerformed=false and identical before/after marker evidence because no mutation is permitted.",
                    "8. Finish with exactly one result block using the schema below.",
                ]
                : [
                    ...common,
                    "5. This is strict read-only preflight. Do not create, edit, move, delete, overwrite, or chmod any target or marker, and do not request write permission.",
                    "6. Epoch 1 enrollment succeeds only when the target is absent or is managed-clean at the exact frozen Released baseline digest and identity. managed-drifted, unmanaged, conflict, and uncertain must fail preflight.",
                    "7. Report mutationPerformed=false and exact before-state evidence. For managed-clean, destination is the discovered absolute target, actualDigest and beforeDigest are the installed baseline digest (NOT the Candidate digest), and markerWritten=true means the existing ordinary management marker is present and verified, not newly written. markerBefore and markerAfter remain null because no experiment marker exists. For absent, destination/actualDigest/beforeDigest are null and markerWritten=false. Never claim an experiment marker was written.",
                    "8. Finish with exactly one result block using the schema below.",
                ]
        } else if (operation === "experiment_install") {
            procedure = [
                ...common,
                "5. For Epoch 1, continue only from the frozen initial absent state or the exact managed-clean frozen baseline. For later Epochs, require the exact current Run marker and previous Candidate digest shown in the request.",
                "6. If the target, previous Candidate digest, or marker differs, do not delete or overwrite anything. Report needs_recovery with mutationPerformed=false.",
                `7. Install the exact Candidate and write the exact rolling-skill-experiment/v1 marker from experiment.marker to ${EXPERIMENT_MARKER_FILE}. Do not represent it as a formal Released installation.`,
                "Preserve the existing ordinary management marker unchanged during a trial installation; it records the formal Released baseline. If initially absent, do not create an ordinary management marker. The separate experiment marker identifies the temporary Candidate, and both marker files are excluded from the content digest.",
                "8. Recompute the installed digest and verify the exact marker. Report the before and after evidence and whether Runtime inventory discovered it.",
                "9. Finish with exactly one result block using the schema below.",
            ]
        } else if (operation === "experiment_restore") {
            procedure = [
                ...common,
                "5. Before restoration, require the exact current Run marker and current Candidate digest. On any mismatch, do not delete or overwrite anything; report needs_recovery with mutationPerformed=false.",
                "6. Export and reinstall only the exact frozen Released source in experiment.restoration.source, then write its normal management marker and remove the experiment marker.",
                "7. Re-inspect the target and require the frozen baseline digest, matching management identity, and no experiment marker.",
                "8. Finish with exactly one result block using the schema below.",
            ]
        } else {
            procedure = [
                ...common,
                "5. Before removal, require the exact current Run marker and current Candidate digest. On any mismatch, do not delete or overwrite anything; report needs_recovery with mutationPerformed=false.",
                "6. Because the frozen initial state was absent, remove only that exact target after all identity checks. Never delete a parent, sibling, symlink target, or path outside the exact target.",
                "7. Re-inspect and require the exact target to be absent with no experiment marker.",
                "8. Finish with exactly one result block using the schema below.",
            ]
        }
    } else if (operation === "inspect") {
        procedure = [
            "1. Verify the repository and exact commit. Export only source.skillRoot from that commit into a temporary directory. Never read install bytes from the current working tree.",
            "2. Compute the deterministic source Skill SHA-256 digest, excluding .rolling-skill-managed.json, and require it to equal source.expectedDigest.",
            managedReadScope,
            "3. Discover the Skill root actually used by this Runtime and select only the exact target for skillName. Do not assume a provider-specific path supplied by this prompt.",
            "4. Inspect the target, its digest, symlinks, and .rolling-skill-managed.json. Classify the current state exactly as one of: absent, managed-clean, managed-drifted, unmanaged, conflict, uncertain.",
            "5. This is an inspect-only recovery turn. Do not create, edit, move, delete, overwrite, or chmod any target or marker. Do not request write permission.",
            "6. Query this Runtime's own Skill inventory when supported. If inventory cannot prove discovery, report runtimeDiscovered as null, not true.",
            "7. Report succeeded only when the installed target already matches source.expectedDigest and contains the matching management marker. Otherwise report failed, cancelled, or unverified with a structured error.",
            "8. Finish with exactly one result block using the schema below. Natural-language progress may appear before it, but never emit a second result block.",
        ]
    } else {
        procedure = [
            "1. Verify the repository and exact commit. Export only source.skillRoot from that commit into a temporary directory. Never copy the current working tree.",
            "2. Compute the deterministic Skill content SHA-256 digest, excluding .rolling-skill-managed.json, and require it to equal source.expectedDigest before touching a target.",
            managedReadScope,
            "3. Discover the Skill root actually used by this Runtime and select only the exact target for skillName. Do not assume a provider-specific path supplied by this prompt.",
            "4. Inspect the target, its digest, symlinks, and .rolling-skill-managed.json. Classify the pre-state exactly as one of: absent, managed-clean, managed-drifted, unmanaged, conflict, uncertain.",
            "5. Only absent and managed-clean may continue without an additional overwrite confirmation. For managed-drifted, unmanaged, conflict, or uncertain, pause and ask the user through the Runtime interaction UI. Show the destination, evidence, and exact directory that would be changed. Offer Continue overwrite, I will install manually, and Cancel.",
            "6. Refuse a symlink target, a broad/dangerous destination, an identity boundary you cannot prove, or any operation that would delete outside the exact target, even if broad permission is available.",
            "7. If authorized, install/update the exact target and write .rolling-skill-managed.json with schema, repositoryId, skillId, versionId, commit, contentDigest, and installedAt. The marker is excluded from the content digest.",
            "8. Recompute the installed digest, then refresh or query this Runtime's own Skill inventory when supported. If inventory cannot prove discovery, report runtimeDiscovered as null, not true.",
            "9. If permission is insufficient, request it through the Runtime. Never elevate silently. If the user refuses, stop without pretending success.",
            "10. Finish with exactly one result block using the schema below. Natural-language progress may appear before it, but never emit a second result block.",
        ]
    }
    return [
        experiment
            ? "You are running a bounded optimization experiment installation task inside your own local Runtime."
            : "You are running a managed Skill installation task inside your own local Runtime.",
        operation === "inspect" || operation === "experiment_inspect"
            ? "Perform every inspection yourself through Bash/tool calls. This recovery turn is strictly read-only."
            : "Perform every inspection and filesystem change yourself through Bash/tool calls. Do not ask the host application to copy, delete, or discover paths for you.",
        "Do not run scripts from the managed Skill. Do not install from the working tree or implicit HEAD.",
        "",
        "Frozen installation request (immutable):",
        JSON.stringify({
            operation,
            purpose: request.purpose,
            markerSchema: request.markerSchema,
            digestAlgorithm: DIGEST_ALGORITHM,
            repositoryPath: request.repositoryPath,
            skillName: request.skillName,
            versionLabel: request.versionLabel,
            source: request.source,
            priorInstallation,
            ...(experiment ? {experiment: request.experiment} : {}),
        }, null, 2),
        "",
        `Digest algorithm ${DIGEST_ALGORITHM}: enumerate every file and symbolic link below the Skill root; exclude the root .rolling-skill-managed.json${experiment ? ` and ${EXPERIMENT_MARKER_FILE}` : ""}; sort relative POSIX paths lexicographically; and for each entry hash UTF-8 header type\\0path\\0executable-bit\\0byte-length\\0, then the exact blob/link-target bytes, then one NUL byte. type is file or symlink; executable-bit is 1 only for executable regular files.`,
        "",
        "Required procedure:",
        ...procedure,
        "For marker JSON, serialize the exact identity and digest values from the frozen request with a JSON library; do not abbreviate, retype, or infer them. SHA-256 content digests are not Git object IDs.",
        ...(experiment ? ["result.markerBefore and result.markerAfter refer only to .rolling-skill-experiment.json (rolling-skill-experiment/v1), never the ordinary .rolling-skill-managed.json marker. If no experiment marker exists, use null; explain an invalid ordinary marker in error.message."] : []),
        "In result.runtimeDiscovered, runtimeDiscovered must be the JSON boolean true, the JSON boolean false, or null. Never return the strings \"true\", \"false\", or \"null\".",
        'For every non-success status, error must be an object with code and message, for example {"code":"OVERWRITE_CONFIRMATION_REQUIRED","message":"Destination unchanged; waiting for the user to approve replacing the existing marker."}. Use error:null only on success. If the Runtime cannot open its interaction UI, end unverified with this concrete explanation; never treat silence as approval.',
        "",
        INSTALL_RESULT_SENTINEL.open,
        JSON.stringify(finalShape, null, 2),
        INSTALL_RESULT_SENTINEL.close,
    ].join("\n")
}

function oneSentinelBody(text) {
    text = String(text ?? "")
    const firstOpen = text.indexOf(INSTALL_RESULT_SENTINEL.open)
    const secondOpen = text.indexOf(INSTALL_RESULT_SENTINEL.open, firstOpen + 1)
    const firstClose = text.indexOf(INSTALL_RESULT_SENTINEL.close)
    const secondClose = text.indexOf(INSTALL_RESULT_SENTINEL.close, firstClose + 1)
    if (firstOpen < 0 || firstClose < 0 || secondOpen >= 0 || secondClose >= 0 || firstClose < firstOpen) {
        throw new Error("Installation output must contain exactly one structured result block")
    }
    return text.slice(firstOpen + INSTALL_RESULT_SENTINEL.open.length, firstClose).trim()
}

function parseJsonBody(text) {
    try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object")
        return parsed
    } catch {
        throw new Error("Installation result must be valid JSON")
    }
}

function requireEnum(value, values, label) {
    const normalized = requiredText(value, label, 80)
    if (!values.has(normalized)) throw new Error(`Installation result ${label} is invalid`)
    return normalized
}

function validateSource(actual, expected) {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
        throw new Error("Installation result source does not match the frozen source")
    }
    for (const [key, expectedValue] of Object.entries(expected)) {
        if (actual[key] !== expectedValue) {
            throw new Error("Installation result source does not match the frozen source")
        }
    }
}

function normalizeError(value, required) {
    if (!required && (value === null || value === undefined)) return null
    // A failure's explanation is display data, not installation evidence. Preserve
    // it even when the Runtime omits the object wrapper; success remains strict.
    if (required && typeof value === "string" && value.trim()) {
        return {code: "RUNTIME_INSTALLATION_INCOMPLETE", message: requiredText(value, "Installation error message", 8_192)}
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Installation result error is required")
    }
    return {
        code: requiredText(value.code, "Installation error code", 200),
        message: requiredText(value.message, "Installation error message", 8_192),
    }
}

function normalizeExperimentMarker(value, label) {
    if (value === null || value === undefined) return null
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} experiment marker is invalid`)
    }
    const epoch = Number(value.epoch)
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch > 100) {
        throw new Error(`${label} experiment marker is invalid`)
    }
    const commit = requiredText(value.commit, `${label} experiment marker commit`, 40)
    const contentDigest = requiredText(
        value.contentDigest,
        `${label} experiment marker digest`,
        80,
    )
    if (
        value.schema !== EXPERIMENT_MARKER_SCHEMA ||
        !COMMIT_PATTERN.test(commit) ||
        !DIGEST_PATTERN.test(contentDigest)
    ) {
        throw new Error(`${label} experiment marker is invalid`)
    }
    return {
        schema: EXPERIMENT_MARKER_SCHEMA,
        runId: requiredText(value.runId, `${label} experiment marker Run id`, 200),
        epoch,
        skillId: requiredText(value.skillId, `${label} experiment marker Skill id`, 200),
        versionId: requiredText(value.versionId, `${label} experiment marker version id`, 200),
        commit,
        contentDigest,
    }
}

function sameMarker(actual, expected) {
    if (actual === null || expected === null) return actual === expected
    return Object.keys(expected).every((key) => actual[key] === expected[key]) &&
        Object.keys(actual).every((key) => Object.hasOwn(expected, key))
}

function experimentVerification({
    actualDigest,
    beforeDigest,
    classificationBefore,
    destination,
    markerAfter,
    markerBefore,
    markerWritten,
    mutationPerformed,
    operation,
    request,
}) {
    if (operation === "experiment_inspect") {
        if (mutationPerformed) throw new Error("Optimization experiment preflight must not mutate the target")
        if (request.experiment.inspectionMode === "recovery") {
            if (
                classificationBefore === "managed-clean" &&
                actualDigest === request.source.expectedDigest &&
                beforeDigest === request.source.expectedDigest &&
                markerWritten &&
                destination &&
                sameMarker(markerBefore, request.experiment.marker) &&
                sameMarker(markerAfter, request.experiment.marker)
            ) {
                return "experiment-inspection"
            }
            if (
                classificationBefore === "managed-clean" &&
                actualDigest === request.experiment.baseline.expectedDigest &&
                beforeDigest === request.experiment.baseline.expectedDigest &&
                markerWritten &&
                destination &&
                markerBefore === null &&
                markerAfter === null
            ) {
                return "experiment-inspection"
            }
            if (
                classificationBefore === "absent" &&
                actualDigest === null &&
                beforeDigest === null &&
                !markerWritten &&
                destination === null &&
                markerBefore === null &&
                markerAfter === null
            ) {
                return "experiment-inspection"
            }
            throw new Error("Optimization recovery inspection does not match a known safe target state")
        }
        if (!new Set(["absent", "managed-clean"]).has(classificationBefore)) {
            throw new Error("Optimization experiment preflight rejected the unsafe target classification")
        }
        if (markerBefore !== null || markerAfter !== null) {
            throw new Error("Optimization experiment preflight found an unexpected experiment marker")
        }
        if (classificationBefore === "absent") {
            if (destination !== null || actualDigest !== null || markerWritten) {
                throw new Error("Optimization experiment absent preflight evidence is inconsistent")
            }
        } else if (
            actualDigest !== request.experiment.baseline.expectedDigest ||
            !markerWritten ||
            !destination
        ) {
            throw new Error("Optimization experiment managed-clean preflight does not match the baseline")
        }
        return "experiment-preflight"
    }

    if (!mutationPerformed) {
        throw new Error("A successful optimization experiment mutation must report its mutation")
    }
    let expectedBeforeDigest
    let expectedBeforeMarker
    if (operation === "experiment_install" && request.experiment.previous) {
        expectedBeforeDigest = request.experiment.previous.expectedDigest
        expectedBeforeMarker = request.experiment.previous.marker
        if (actualDigest !== request.source.expectedDigest) {
            throw new Error("Installed Candidate digest does not match the frozen Candidate")
        }
        if (!markerWritten || !sameMarker(markerAfter, request.experiment.marker)) {
            throw new Error("Installed Candidate experiment marker does not match the frozen marker")
        }
        if (beforeDigest !== expectedBeforeDigest) {
            throw new Error("Installed target does not match the previous Candidate digest")
        }
        if (!sameMarker(markerBefore, expectedBeforeMarker)) {
            throw new Error("Installed target does not match the previous Candidate experiment marker")
        }
        return "experiment-marker"
    }
    if (operation === "experiment_install") {
        const initial = request.experiment.initial
        expectedBeforeDigest = initial.classification === "absent"
            ? null
            : request.experiment.baseline.expectedDigest
        if (beforeDigest !== expectedBeforeDigest || markerBefore !== null) {
            throw new Error("Epoch 1 target does not match the frozen experiment initial state")
        }
        if (classificationBefore !== initial.classification) {
            throw new Error("Epoch 1 target classification changed after preflight")
        }
        if (
            actualDigest !== request.source.expectedDigest ||
            !markerWritten ||
            !sameMarker(markerAfter, request.experiment.marker)
        ) {
            throw new Error("Installed Candidate experiment marker or digest does not match")
        }
        return "experiment-marker"
    }

    if (
        beforeDigest !== request.source.expectedDigest ||
        !sameMarker(markerBefore, request.experiment.marker)
    ) {
        throw new Error("Restoration target does not match the current Candidate experiment marker and digest")
    }
    if (operation === "experiment_restore") {
        if (
            request.experiment.restoration?.mode !== "restore" ||
            actualDigest !== request.experiment.baseline.expectedDigest ||
            !markerWritten ||
            markerAfter !== null ||
            !destination
        ) {
            throw new Error("Restored target does not match the frozen Released baseline")
        }
        return "experiment-restored"
    }
    if (
        request.experiment.restoration?.mode !== "remove" ||
        actualDigest !== null ||
        markerWritten ||
        markerAfter !== null ||
        !destination
    ) {
        throw new Error("Removed experiment target is not proven absent")
    }
    return "experiment-removed"
}

// Diagnostic-only: malformed evidence must never become a trusted installation.
function reportedSkillInstallationFailure(text, request) {
    try {
        const payload = parseJsonBody(oneSentinelBody(text))
        if (payload.schema !== INSTALL_RESULT_SCHEMA || !["failed", "cancelled", "unverified", "needs_recovery"].includes(payload.status)) return null
        const experiment = request?.purpose === "optimization-experiment"
        if ((payload.purpose ?? "managed-installation") !== request?.purpose ||
            !(experiment ? EXPERIMENT_OPERATIONS : ORDINARY_OPERATIONS).has(payload.operation) ||
            (experiment && payload.operation !== request.operation)) return null
        validateSource(payload.source, request.source)
        return requiredText(payload.error?.message, "Reported installation failure", 4_096)
    } catch {
        return null
    }
}

function parseSkillInstallationResult(text, request) {
    const payload = parseJsonBody(oneSentinelBody(text))
    if (payload.schema !== INSTALL_RESULT_SCHEMA) {
        throw new Error("Unsupported Skill installation result schema")
    }
    const status = requireEnum(payload.status, STATUSES, "status")
    const operation = requireEnum(payload.operation, OPERATIONS, "operation")
    const experiment = request?.purpose === "optimization-experiment"
    const purpose = payload.purpose === undefined && !experiment
        ? "managed-installation"
        : requiredText(payload.purpose, "Installation purpose", 100)
    if (
        purpose !== request?.purpose ||
        !(experiment ? EXPERIMENT_OPERATIONS : ORDINARY_OPERATIONS).has(operation)
    ) {
        throw new Error("Installation result purpose or operation does not match the frozen request")
    }
    if (experiment && operation !== request.operation) {
        throw new Error("Optimization experiment result operation does not match the frozen request")
    }
    if (!experiment && status === "needs_recovery") {
        throw new Error("Ordinary installation cannot report optimization recovery state")
    }
    const classificationBefore = requireEnum(
        payload.classificationBefore,
        CLASSIFICATIONS,
        "classification",
    )
    validateSource(payload.source, request.source)
    const destination = nullableText(payload.destination, "Installation destination")
    if (destination && !isAbsolute(destination)) {
        throw new Error("Installation destination must be absolute")
    }
    if (
        status === "succeeded" &&
        !destination &&
        !(experiment && (
            (operation === "experiment_inspect" && classificationBefore === "absent")
        ))
    ) {
        throw new Error("Successful installation requires an absolute destination")
    }
    const result = payload.result && typeof payload.result === "object" && !Array.isArray(payload.result)
        ? payload.result
        : {}
    const actualDigest = nullableText(result.actualDigest, "Actual installation digest", 80)
    if (actualDigest && !DIGEST_PATTERN.test(actualDigest)) {
        throw new Error("Actual installation digest is invalid")
    }
    const markerWritten = result.markerWritten === true
    const runtimeDiscovered = result.runtimeDiscovered === true
        ? true
        : result.runtimeDiscovered === false
          ? false
          : null
    let beforeDigest = null
    let mutationPerformed = false
    let markerBefore = null
    let markerAfter = null
    let verification
    if (experiment) {
        beforeDigest = nullableText(result.beforeDigest, "Experiment before digest", 80)
        if (beforeDigest && !DIGEST_PATTERN.test(beforeDigest)) {
            throw new Error("Experiment before digest is invalid")
        }
        mutationPerformed = result.mutationPerformed === true
        markerBefore = normalizeExperimentMarker(result.markerBefore, "Before")
        markerAfter = normalizeExperimentMarker(result.markerAfter, "After")
        if (status === "needs_recovery") {
            if (mutationPerformed) {
                throw new Error("A needs_recovery result must not mutate the experiment target")
            }
            verification = "none"
        } else if (status === "succeeded") {
            verification = experimentVerification({
                actualDigest,
                beforeDigest,
                classificationBefore,
                destination,
                markerAfter,
                markerBefore,
                markerWritten,
                mutationPerformed,
                operation,
                request,
            })
        } else {
            verification = "none"
        }
    } else {
        if (status === "succeeded" && actualDigest !== request.source.expectedDigest) {
            throw new Error("Successful installation digest does not match the frozen digest")
        }
        if (status === "succeeded" && !markerWritten) {
            throw new Error("Successful installation must write the management marker")
        }
        verification = runtimeDiscovered === true
            ? "runtime-inventory"
            : actualDigest === request.source.expectedDigest && markerWritten
              ? "filesystem-only"
              : "none"
        if (status === "succeeded" && verification === "none") {
            throw new Error("Successful installation has no reliable verification")
        }
    }
    const warnings = Array.isArray(payload.warnings)
        ? payload.warnings.map((warning) => requiredText(warning, "Installation warning", 4_096))
        : []
    const error = normalizeError(payload.error, status !== "succeeded")
    return deepFreeze({
        schema: INSTALL_RESULT_SCHEMA,
        purpose,
        status,
        operation,
        classificationBefore,
        destination,
        source: {...request.source},
        permission: {
            requested: nullableText(payload.permission?.requested, "Requested permission", 100),
            effective: nullableText(payload.permission?.effective, "Effective permission", 100),
        },
        result: {
            actualDigest,
            markerWritten,
            runtimeDiscovered,
            ...(experiment ? {
                beforeDigest,
                mutationPerformed,
                markerBefore,
                markerAfter,
            } : {}),
        },
        warnings,
        error,
        verification,
        trusted: status === "succeeded" && verification !== "none",
    })
}

module.exports = {
    EXPERIMENT_MARKER_SCHEMA,
    INSTALL_MARKER_SCHEMA,
    INSTALL_RESULT_SCHEMA,
    INSTALL_RESULT_SENTINEL,
    DIGEST_ALGORITHM,
    buildSkillInstallationPrompt,
    freezeSkillExperimentRequest,
    freezeSkillExperimentRecoveryInspectionRequest,
    freezeSkillInstallationRequest,
    parseSkillInstallationResult,
    reportedSkillInstallationFailure,
}
