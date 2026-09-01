const {
    RUBRIC_PROMPT_VERSION,
    UNIFIED_SCORING_MODEL,
    buildDatasetRubricPrompt,
    buildRubricFollowUpPrompt,
    parseDatasetRubric,
} = require("./dataset-rubric.cjs")
const {LiveActivityCoalescer} = require("./live-activity-coalescer.cjs")

const RUBRIC_NOTIFICATION_METHODS = new Set([
    "thread/settings/updated",
    "turn/started",
    "item/started",
    "turn/completed",
    "error",
])

function assistantTextFromTurn(turn) {
    return (turn?.items ?? [])
        .filter((item) => item.type === "agentMessage" && String(item.text ?? "").trim())
        .map((item) => String(item.text).trim())
        .join("\n\n")
}

function compact(value, limit = 240) {
    const text = String(value ?? "").replace(/\s+/gu, " ").trim()
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function failureState(session) {
    return session.draft ? "needs_review" : "failed"
}

class RubricManager {
    constructor({
        store,
        getRuntime,
        getRuntimeDescriptor = () => null,
        onChanged = () => {},
        onActivity = () => {},
        schedule = (task) => Promise.resolve().then(task),
        activityIntervalMs,
        scheduleActivity = setTimeout,
        cancelActivity = clearTimeout,
    }) {
        this.store = store
        this.getRuntime = getRuntime
        this.getRuntimeDescriptor = getRuntimeDescriptor
        this.onChanged = onChanged
        this.onActivity = onActivity
        this.activityCoalescer = new LiveActivityCoalescer({
            emit: onActivity,
            intervalMs: activityIntervalMs,
            schedule: scheduleActivity,
            cancel: cancelActivity,
        })
        this.schedule = schedule
        this.tasks = new Map()
        this.threadSessions = new Map()
        this.activities = new Map()
        for (const session of this.store.listRubricSessions()) {
            if (session.rubricAgent.threadId) {
                this.threadSessions.set(session.rubricAgent.threadId, session.id)
            }
            if (session.status === "queued" || session.status === "running") {
                this.store.updateRubricSession(session.id, {
                    status: failureState(session),
                    error: "The Rubric Agent task was interrupted when Rolling Skill stopped. Retry to continue.",
                    rubricAgent: {currentTurnId: null},
                })
            }
        }
    }

    emitChanged(sessionOrId) {
        const session = typeof sessionOrId === "string"
            ? this.store.getRubricSession(sessionOrId)
            : sessionOrId
        this.onChanged(session)
        return session
    }

    emitActivity(sessionOrId, patch = {}) {
        const session = typeof sessionOrId === "string"
            ? this.store.getRubricSession(sessionOrId)
            : sessionOrId
        const now = Date.now()
        const previous = this.activities.get(session.id)
        const activity = {
            sessionId: session.id,
            stage: patch.stage ?? previous?.stage ?? "starting",
            summary: compact(patch.summary ?? previous?.summary ?? ""),
            startedAt: previous?.startedAt ?? now,
            lastActivityAt: now,
            terminal: Boolean(patch.terminal),
        }
        if (activity.terminal) this.activities.delete(session.id)
        else this.activities.set(session.id, activity)
        this.activityCoalescer.publish(activity)
        return activity
    }

    queue(sessionId, operation) {
        const task = Promise.resolve(this.schedule(operation))
        this.tasks.set(sessionId, task)
        void task.finally(() => {
            if (this.tasks.get(sessionId) === task) this.tasks.delete(sessionId)
        })
        return task
    }

    async waitForIdle(sessionId) {
        await this.tasks.get(sessionId)
    }

    async createSession(input = {}) {
        const dataset = this.store.getDataset(input.datasetId)
        const baseVersionId = input.baseVersionId ?? dataset.activeRubricVersionId ?? null
        const descriptor = this.getRuntimeDescriptor()
        let session = this.store.createRubricSession({
            datasetId: dataset.id,
            baseVersionId,
            skillEvidence: input.skillEvidence,
            executionSkillReference: input.executionSkillReference,
            operationEvidence: input.operationEvidence,
            rubricAgent: {
                runtimeId: descriptor?.runtimeId ?? null,
                modelProvider: descriptor?.providerId ?? null,
                modelId: input.modelId ?? null,
                effort: input.effort ?? null,
                promptVersion: RUBRIC_PROMPT_VERSION,
            },
        })
        const kickoff = baseVersionId
            ? `Revise dataset rubric v${this.store.getDatasetRubricVersion(baseVersionId).version} for ${dataset.name}.`
            : `Create the first dataset rubric for ${dataset.name}.`
        const initialInstruction = String(input.initialInstruction ?? "").trim()
        session = this.store.appendRubricMessage(session.id, {
            role: "user",
            text: initialInstruction ? `${kickoff}\n\n${initialInstruction}` : kickoff,
        })
        this.emitChanged(session)
        this.queue(session.id, () => this.startInitialTurn(session.id))
        return session
    }

    async startInitialTurn(sessionId) {
        try {
            let session = this.store.getRubricSession(sessionId)
            if (session.status === "cancelled") return session
            this.emitActivity(session, {stage: "starting", summary: "Reading frozen Skill evidence"})
            const runtime = await this.getRuntime()
            const response = await runtime.startThread({
                sandbox: "read-only",
                approvalPolicy: "never",
                ephemeral: false,
                threadSource: "subagent",
                ...(session.rubricAgent.modelId ? {model: session.rubricAgent.modelId} : {}),
                ...(session.rubricAgent.effort ? {effort: session.rubricAgent.effort} : {}),
            })
            this.threadSessions.set(response.thread.id, sessionId)
            session = this.store.updateRubricSession(sessionId, {
                status: "running",
                error: null,
                rubricAgent: {
                    threadId: response.thread.id,
                    modelProvider:
                        response.thread.modelProvider ?? session.rubricAgent.modelProvider ?? null,
                    effectiveModelId:
                        response.model ?? response.thread.model ?? session.rubricAgent.modelId ?? null,
                    effectiveEffort:
                        response.reasoningEffort ??
                        response.thread.reasoningEffort ??
                        response.thread.effort ??
                        session.rubricAgent.effort ??
                        null,
                    promptVersion: RUBRIC_PROMPT_VERSION,
                },
            })
            const dataset = this.store.getDataset(session.datasetId)
            const baseVersion = session.baseVersionId
                ? this.store.getDatasetRubricVersion(session.baseVersionId)
                : null
            const prompt = buildDatasetRubricPrompt({
                datasetName: dataset.name,
                skillReference: session.skillReference,
                skillEvidence: session.skillEvidence,
                baseVersion,
                userRequest: session.conversation.find((message) => message.role === "user")?.text ?? "",
            })
            const turnInput = [
                {
                    type: "skill",
                    name: (session.executionSkillReference ?? session.skillReference).name,
                    path: (session.executionSkillReference ?? session.skillReference).path,
                },
                {type: "text", text: prompt, text_elements: []},
            ]
            const turnResponse = await runtime.startTurn(response.thread.id, turnInput, {
                ...(session.rubricAgent.modelId ? {model: session.rubricAgent.modelId} : {}),
                ...(session.rubricAgent.effort ? {effort: session.rubricAgent.effort} : {}),
            })
            session = this.store.updateRubricSession(sessionId, {
                status: "running",
                rubricAgent: {currentTurnId: turnResponse.turn.id},
            })
            this.emitChanged(session)
            this.emitActivity(session, {stage: "analyzing", summary: "Deriving dataset criteria"})
            return session
        } catch (error) {
            const current = this.store.getRubricSession(sessionId)
            if (current.status === "cancelled") return current
            const failed = this.store.updateRubricSession(sessionId, {
                status: failureState(current),
                error: error.message,
                rubricAgent: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {stage: "failed", summary: error.message, terminal: true})
            return failed
        }
    }

    sessionForThread(threadId) {
        const id = this.threadSessions.get(threadId)
        return id ? this.store.getRubricSession(id) : null
    }

    async handleNotification(message) {
        const {method, params = {}} = message ?? {}
        if (!params.threadId || !RUBRIC_NOTIFICATION_METHODS.has(method)) return false
        const session = this.sessionForThread(params.threadId)
        if (!session || session.status === "archived" || session.status === "cancelled") return false

        if (method === "thread/settings/updated") {
            const settings = params.threadSettings ?? params.settings ?? {}
            const rubricAgent = {}
            if ("model" in settings) rubricAgent.effectiveModelId = settings.model ?? null
            if ("effort" in settings || "reasoningEffort" in settings) {
                rubricAgent.effectiveEffort = settings.effort ?? settings.reasoningEffort ?? null
            }
            if (Object.keys(rubricAgent).length) {
                this.emitChanged(this.store.updateRubricSession(session.id, {rubricAgent}))
            }
            return true
        }
        if (method === "turn/started" || method === "item/started") {
            const item = params.item ?? {}
            const summary = item.type === "commandExecution"
                ? item.command ?? item.commandActions?.[0]?.command ?? ""
                : item.tool ?? item.name ?? ""
            this.emitActivity(session, {
                stage: item.type === "commandExecution" ? "command" : "analyzing",
                summary,
            })
            return true
        }
        if (method === "turn/completed") {
            const turn = params.turn
            if (!turn?.id || turn.id !== session.rubricAgent.currentTurnId) return false
            if (turn.status && turn.status !== "completed") {
                const error = turn.error?.message ?? `Rubric Agent turn ended with ${turn.status}`
                const failed = this.store.updateRubricSession(session.id, {
                    status: failureState(session),
                    error,
                    rubricAgent: {currentTurnId: null},
                })
                this.emitChanged(failed)
                this.emitActivity(failed, {stage: "failed", summary: error, terminal: true})
                return true
            }
            const assistantText = assistantTextFromTurn(turn)
            try {
                if (!assistantText) throw new Error("Rubric Agent completed without a response")
                const rubric = parseDatasetRubric(assistantText)
                if (rubric.scoringModel !== UNIFIED_SCORING_MODEL) {
                    throw new Error(
                        `Rubric Agent draft must use scoringModel ${UNIFIED_SCORING_MODEL}`,
                    )
                }
                const reviewed = this.store.recordRubricRevision(session.id, {
                    rubric,
                    assistantText,
                    turnId: turn.id,
                })
                this.emitChanged(reviewed)
                this.emitActivity(reviewed, {stage: "completed", summary: "Draft ready", terminal: true})
            } catch (error) {
                let next = session
                if (assistantText) {
                    next = this.store.appendRubricMessage(session.id, {
                        role: "assistant",
                        text: assistantText,
                        turnId: turn.id,
                    })
                }
                const hasDraft = Boolean(session.draft)
                next = this.store.updateRubricSession(session.id, {
                    status: hasDraft ? "needs_review" : "failed",
                    error: hasDraft && !/```json|schemaVersion|criteria/iu.test(assistantText)
                        ? null
                        : error.message,
                    rubricAgent: {currentTurnId: null},
                })
                this.emitChanged(next)
                this.emitActivity(next, {
                    stage: hasDraft ? "completed" : "failed",
                    summary: hasDraft ? "" : error.message,
                    terminal: true,
                })
            }
            return true
        }
        if (method === "error" && !params.willRetry) {
            if (params.turnId && params.turnId !== session.rubricAgent.currentTurnId) return false
            const error = params.error?.message ?? "Rubric Agent runtime failed"
            const failed = this.store.updateRubricSession(session.id, {
                status: failureState(session),
                error,
                rubricAgent: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {stage: "failed", summary: error, terminal: true})
            return true
        }
        return false
    }

    async sendMessage(sessionId, text) {
        let session = this.store.getRubricSession(sessionId)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This rubric session is no longer editable")
        }
        if (!session.rubricAgent.threadId) throw new Error("The Rubric Agent thread has not started")
        if (session.rubricAgent.currentTurnId) throw new Error("The Rubric Agent is already working")
        session = this.store.appendRubricMessage(sessionId, {role: "user", text})
        session = this.store.updateRubricSession(sessionId, {status: "running", error: null})
        this.emitChanged(session)
        this.emitActivity(session, {stage: "starting", summary: "Applying review message"})
        try {
            const runtime = await this.getRuntime()
            await runtime.resumeThread(session.rubricAgent.threadId, {
                approvalPolicy: "never",
                sandbox: "read-only",
                ...(session.rubricAgent.modelId ? {model: session.rubricAgent.modelId} : {}),
            })
            const response = await runtime.startTurn(
                session.rubricAgent.threadId,
                buildRubricFollowUpPrompt(text),
                {
                    ...(session.rubricAgent.modelId ? {model: session.rubricAgent.modelId} : {}),
                    ...(session.rubricAgent.effort ? {effort: session.rubricAgent.effort} : {}),
                },
            )
            session = this.store.updateRubricSession(sessionId, {
                status: "running",
                rubricAgent: {currentTurnId: response.turn.id},
            })
            return this.emitChanged(session)
        } catch (error) {
            const current = this.store.getRubricSession(sessionId)
            const failed = this.store.updateRubricSession(sessionId, {
                status: failureState(current),
                error: error.message,
                rubricAgent: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {stage: "failed", summary: error.message, terminal: true})
            return failed
        }
    }

    async retry(sessionId) {
        const session = this.store.getRubricSession(sessionId)
        if (session.status !== "failed") throw new Error("Only a failed rubric session can be retried")
        if (!session.rubricAgent.threadId) {
            this.queue(sessionId, () => this.startInitialTurn(sessionId))
            await this.waitForIdle(sessionId)
            return this.store.getRubricSession(sessionId)
        }
        return this.sendMessage(
            sessionId,
            "Return a corrected complete rubric JSON contract that satisfies every required field.",
        )
    }

    updateModel(sessionId, modelId) {
        return this.emitChanged(this.store.updateRubricModel(sessionId, modelId))
    }

    updateEffort(sessionId, effort) {
        return this.emitChanged(this.store.updateRubricEffort(sessionId, effort))
    }

    async discard(sessionId) {
        const current = this.store.getRubricSession(sessionId)
        const discarded = this.store.cancelRubricSession(sessionId)
        this.emitChanged(discarded)
        this.emitActivity(discarded, {stage: "cancelled", terminal: true})
        if (current.rubricAgent.threadId) {
            try {
                const runtime = await this.getRuntime()
                if (current.rubricAgent.currentTurnId) {
                    await runtime.interruptTurn(
                        current.rubricAgent.threadId,
                        current.rubricAgent.currentTurnId,
                    )
                }
                await runtime.archiveThread(current.rubricAgent.threadId)
            } catch {
                // The local cancellation remains authoritative when the runtime is unavailable.
            }
        }
        return discarded
    }

    async publish(sessionId) {
        const version = this.store.publishRubricSession(sessionId)
        const session = this.store.getRubricSession(sessionId)
        this.emitChanged(session)
        if (session.rubricAgent.threadId) {
            try {
                const runtime = await this.getRuntime()
                await runtime.archiveThread(session.rubricAgent.threadId)
            } catch {
                // Publishing is a local atomic commit and must not be rolled back by runtime cleanup.
            }
        }
        return version
    }

    hiddenThreadIds() {
        return new Set(this.threadSessions.keys())
    }
}

module.exports = {RubricManager, assistantTextFromTurn}
