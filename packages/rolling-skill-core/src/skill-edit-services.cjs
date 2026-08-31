const {randomUUID} = require("node:crypto")

const ACTIVE_OPERATOR_STATES = new Set(["active", "queued", "running"])
const TERMINAL_EDIT_STATES = new Set(["published", "discarded", "failed"])

function requiredText(value, label, maximum = 4_096) {
    const normalized = typeof value === "string" ? value.trim() : ""
    if (!normalized || normalized.length > maximum) throw new Error(`${label} is required`)
    return normalized
}

function exactKeys(value, allowed, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be an object`)
    }
    const unsupported = Object.keys(value).find((key) => !allowed.has(key))
    if (unsupported) throw new Error(`${label} contains an unsupported field: ${unsupported}`)
    return value
}

function revision(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Skill edit revision is invalid")
    return value
}

function boundedText(value, maximum = 32_000) {
    const text = String(value ?? "")
    return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

function sanitizedError(error, workspacePath = null) {
    let message = boundedText(error?.message ?? error ?? "Skill edit failed", 2_000)
    if (workspacePath) message = message.split(workspacePath).join("Skill edit workspace")
    return {
        code: typeof error?.code === "string" ? boundedText(error.code, 128) : null,
        message,
    }
}

function messages(operator) {
    return (operator?.session?.transcript ?? [])
        .filter((entry) => (
            entry?.kind === "message" &&
            (entry.role === "user" || entry.role === "assistant") &&
            typeof entry.content === "string"
        ))
        .slice(-200)
        .map((entry) => ({
            role: entry.role,
            content: boundedText(entry.content),
            recordedAt: entry.recordedAt ?? null,
        }))
}

function publicRecord(record, {operator = null, diff = null} = {}) {
    return {
        id: record.id,
        repositoryId: record.repositoryId,
        skillId: record.skillId,
        state: record.state,
        revision: record.revision,
        runtime: {...record.runtime},
        objective: boundedText(record.objective, 20_000),
        operatorSessionId: record.operatorSessionId,
        operator: operator ? {
            state: operator.state ?? null,
            jobStatus: operator.parentJob?.status ?? null,
        } : null,
        messages: messages(operator),
        diff,
        publishedVersionId: record.publishedVersion?.id ?? null,
        publishedVersionLabel: record.publishedVersion?.label ?? null,
        error: record.error ? {...record.error} : null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    }
}

function createSkillEditServices({
    store,
    workspaceManager,
    managedSkillManager,
    operatorServices,
    idFactory = randomUUID,
} = {}) {
    for (const [dependency, methods] of [
        [store, ["create", "require", "list", "activeForSkill", "update", "close"]],
        [workspaceManager, ["workspacePath", "create", "register", "resolve", "diff", "validate", "cleanup"]],
        [managedSkillManager, ["readSkill", "candidateBase", "skillPath", "applyEditedSkill"]],
        [operatorServices, ["operatorStart", "operatorGet", "operatorSend", "operatorCancel"]],
    ]) {
        if (!dependency || methods.some((method) => typeof dependency[method] !== "function")) {
            throw new Error("Rolling Skill Agent edit dependencies are incomplete")
        }
    }
    if (typeof idFactory !== "function") throw new Error("Skill edit id factory is invalid")

    async function reconcile() {
        for (const record of store.list()) {
            if (TERMINAL_EDIT_STATES.has(record.state)) continue
            try {
                if (record.state === "applying") throw new Error("Interrupted apply requires recovery")
                const detail = managedSkillManager.readSkill(record.skillId, {includeVersions: false})
                await workspaceManager.register({
                    sessionId: record.id,
                    skillName: detail.skill.name,
                    workspacePath: record.workspacePath,
                    baselineDigest: record.baseSnapshotDigest,
                })
            } catch (error) {
                if (record.state !== "needs_recovery") {
                    store.update(record.id, record.revision, {
                        state: "needs_recovery",
                        error: sanitizedError(error, record.workspacePath),
                    })
                }
            }
        }
    }

    const ready = reconcile()

    function operatorFor(record) {
        if (!record.operatorSessionId) return null
        return operatorServices.operatorGet({sessionId: record.operatorSessionId})
    }

    function synchronizedRecord(record, operator) {
        if (!operator || TERMINAL_EDIT_STATES.has(record.state) || record.state === "applying" || record.state === "needs_recovery") {
            return record
        }
        const nextState = ACTIVE_OPERATOR_STATES.has(operator.state) ? "running" : "idle"
        if (record.state === nextState) return record
        return store.update(record.id, record.revision, {state: nextState, error: null})
    }

    async function diffFor(record) {
        try {
            const diff = await workspaceManager.diff(record.id)
            await workspaceManager.validate(record.id)
            return {...diff, valid: true, validationError: null}
        } catch (error) {
            return {
                changed: false,
                truncated: false,
                files: [],
                currentSnapshotDigest: null,
                valid: false,
                validationError: sanitizedError(error, record.workspacePath),
            }
        }
    }

    async function getRecord(sessionId, {includeDiff = true} = {}) {
        await ready
        let record = store.require(requiredText(sessionId, "Skill edit session id", 200))
        let operator = null
        if (record.operatorSessionId) {
            try {
                operator = await operatorFor(record)
                record = synchronizedRecord(record, operator)
            } catch (error) {
                if (!TERMINAL_EDIT_STATES.has(record.state) && record.state !== "needs_recovery") {
                    record = store.update(record.id, record.revision, {
                        state: "idle",
                        error: sanitizedError(error, record.workspacePath),
                    })
                }
            }
        }
        const diff = includeDiff && !TERMINAL_EDIT_STATES.has(record.state)
            ? await diffFor(record)
            : null
        return publicRecord(record, {operator, diff})
    }

    const services = {
        async list(input = {}) {
            exactKeys(input, new Set(["skillId"]), "Skill edit list request")
            await ready
            const skillId = requiredText(input.skillId, "Skill id", 200)
            return {
                sessions: store.list({skillId}).map((record) => publicRecord(record)),
            }
        },

        async start(input = {}) {
            exactKeys(
                input,
                new Set(["skillId", "runtimeId", "modelId", "effort", "objective"]),
                "Skill edit start request",
            )
            await ready
            const skillId = requiredText(input.skillId, "Skill id", 200)
            const runtimeId = requiredText(input.runtimeId, "Runtime id", 1_024)
            const modelId = requiredText(input.modelId, "Model id", 1_024)
            const effort = requiredText(input.effort, "Reasoning effort", 64)
            const objective = requiredText(input.objective, "Skill edit objective", 20_000)
            const detail = managedSkillManager.readSkill(skillId, {includeVersions: false})
            const base = await managedSkillManager.candidateBase(skillId)
            const sessionId = requiredText(idFactory(), "Skill edit session id", 200)
            const workspacePath = workspaceManager.workspacePath(sessionId)
            let workspaceCreated = false
            let record = null
            try {
                const workspace = await workspaceManager.create({
                    sessionId,
                    sourceRoot: managedSkillManager.skillPath(skillId),
                    skillName: detail.skill.name,
                })
                workspaceCreated = true
                record = store.create({
                    id: sessionId,
                    repositoryId: detail.repository.id,
                    skillId,
                    skillRoot: detail.skill.skillRoot,
                    baseCommit: base.commit,
                    baseContentDigest: base.contentDigest,
                    baseSnapshotDigest: workspace.baselineDigest,
                    workspacePath,
                    runtime: {runtimeId, modelId, effort},
                    objective,
                })
                const operator = await operatorServices.operatorStart({
                    runtimeId,
                    modelId,
                    effort,
                    objective: [
                        "Edit the isolated managed Skill draft in this workspace.",
                        "Work only inside the current workspace. Do not publish, install, or modify another Skill.",
                        "Inspect the existing files, make the requested changes directly, and explain the result briefly.",
                        "",
                        `User request: ${objective}`,
                    ].join("\n"),
                    actions: ["skills.read"],
                    scopes: {
                        repositoryIds: [detail.repository.id],
                        skillIds: [skillId],
                        runtimeIds: [runtimeId],
                        datasetIds: [],
                    },
                    managedSkillBinding: {
                        repositoryId: detail.repository.id,
                        skillId,
                        skillEditSessionId: record.id,
                    },
                    budget: {
                        maxDurationMs: 60 * 60 * 1_000,
                        maxRuntimeTurns: 100,
                        maxEvaluations: 0,
                        maxTargetExecutions: 0,
                        maxJudgeExecutions: 0,
                        maxTokens: null,
                        maxReportedCost: null,
                    },
                })
                record = store.update(record.id, record.revision, {
                    state: ACTIVE_OPERATOR_STATES.has(operator.state) ? "running" : "idle",
                    operatorSessionId: requiredText(operator.session?.id, "Operator session id", 200),
                    error: null,
                })
                return getRecord(record.id)
            } catch (error) {
                if (record) {
                    store.update(record.id, record.revision, {
                        state: "needs_recovery",
                        error: sanitizedError(error, workspacePath),
                    })
                } else if (workspaceCreated) {
                    await workspaceManager.cleanup(sessionId).catch(() => {})
                }
                throw error
            }
        },

        async get(input = {}) {
            exactKeys(input, new Set(["sessionId"]), "Skill edit get request")
            return getRecord(input.sessionId)
        },

        async send(input = {}) {
            exactKeys(input, new Set(["sessionId", "text"]), "Skill edit message request")
            await ready
            let record = store.require(requiredText(input.sessionId, "Skill edit session id", 200))
            if (!record.operatorSessionId || TERMINAL_EDIT_STATES.has(record.state) || record.state === "applying") {
                throw new Error("Skill edit session cannot accept a message")
            }
            await operatorServices.operatorSend({
                sessionId: record.operatorSessionId,
                text: requiredText(input.text, "Skill edit message", 32_000),
            })
            if (record.state !== "running") {
                record = store.update(record.id, record.revision, {state: "running", error: null})
            }
            return getRecord(record.id)
        },

        async diff(input = {}) {
            exactKeys(input, new Set(["sessionId"]), "Skill edit Diff request")
            await ready
            const record = store.require(requiredText(input.sessionId, "Skill edit session id", 200))
            return diffFor(record)
        },

        async applyAndRelease(input = {}) {
            exactKeys(input, new Set(["sessionId", "expectedRevision"]), "Skill edit apply request")
            await ready
            let record = store.require(requiredText(input.sessionId, "Skill edit session id", 200))
            const expectedRevision = revision(input.expectedRevision)
            if (record.revision !== expectedRevision) {
                const error = new Error("Skill edit changed since it was loaded")
                error.code = "RESOURCE_CHANGED"
                throw error
            }
            const operator = await operatorFor(record)
            if (operator?.state !== "idle") throw new Error("Skill edit Agent is still running")
            const diff = await diffFor(record)
            if (!diff.valid) throw new Error(diff.validationError?.message ?? "Edited Skill is invalid")
            if (!diff.changed) {
                const error = new Error("Edited Skill has no content changes")
                error.code = "NO_CHANGES"
                throw error
            }
            record = store.update(record.id, record.revision, {state: "applying", error: null})
            try {
                const result = await managedSkillManager.applyEditedSkill({
                    skillId: record.skillId,
                    sourceRoot: workspaceManager.resolve(record.id),
                    expectedBase: {
                        commit: record.baseCommit,
                        contentDigest: record.baseContentDigest,
                        snapshotDigest: record.baseSnapshotDigest,
                    },
                    message: `Apply Agent edit for ${record.skillId}`,
                })
                const closed = store.close(record.id, record.revision, {
                    state: "published",
                    publishedVersion: {
                        id: result.version.id,
                        label: result.version.versionLabel,
                    },
                    error: null,
                })
                await workspaceManager.cleanup(record.id).catch(() => {})
                return publicRecord(closed)
            } catch (error) {
                store.update(record.id, record.revision, {
                    state: error?.code === "NEEDS_RECOVERY" ? "needs_recovery" : "idle",
                    error: sanitizedError(error, record.workspacePath),
                })
                throw error
            }
        },

        async discard(input = {}) {
            exactKeys(input, new Set(["sessionId", "expectedRevision"]), "Skill edit discard request")
            await ready
            let record = store.require(requiredText(input.sessionId, "Skill edit session id", 200))
            if (record.revision !== revision(input.expectedRevision)) {
                const error = new Error("Skill edit changed since it was loaded")
                error.code = "RESOURCE_CHANGED"
                throw error
            }
            if (record.operatorSessionId) {
                const operator = await Promise.resolve(operatorFor(record)).catch(() => null)
                if (operator?.state !== "stopped") {
                    await operatorServices.operatorCancel({sessionId: record.operatorSessionId})
                }
            }
            await workspaceManager.cleanup(record.id)
            record = store.close(record.id, record.revision, {state: "discarded", error: null})
            return publicRecord(record)
        },

        async close() {
            await ready
        },
    }

    return Object.freeze(services)
}

module.exports = {createSkillEditServices}
