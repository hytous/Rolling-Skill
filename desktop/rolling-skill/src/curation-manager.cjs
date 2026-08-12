const {
    CURATOR_PROMPT_VERSION,
    buildCuratorPrompt,
    buildEpisodeSnapshot,
    parseCuratorDraft,
} = require("./episode-curation.cjs")
const {commandActivityDetail} = require("../renderer/command-activity.js")

const ACTIVITY_SUMMARY_LIMIT = 240

function compactActivityText(value, limit = ACTIVITY_SUMMARY_LIMIT) {
    const text = String(value ?? "").replace(/\s+/gu, " ").trim()
    if (text.length <= limit) return text
    return `${text.slice(0, Math.max(0, limit - 1))}…`
}

function commandSummary(item) {
    return compactActivityText(commandActivityDetail(item).command)
}

function toolSummary(item) {
    return compactActivityText(
        [item?.server, item?.tool ?? item?.name].filter(Boolean).join(" / "),
    )
}

function looksLikeContractRevision(text) {
    return /```json[\s\S]*(?:schemaVersion|referenceAnswer|hardRequirements|grading)/iu.test(
        String(text ?? ""),
    )
}

function failureState(session) {
    return session.draft ? "needs_review" : "failed"
}

function followUpPrompt(text) {
    return `Respond to the user's Curator review message below.

If the user is asking a question about the current reference answer, answer conversationally and
do not return JSON. If the user asks to revise the reference answer or grading contract, return a
short review note followed by exactly one complete rolling-skill-curated-case/v1 JSON code block.
Never return a partial contract fragment.

<user-review-message>${String(text ?? "").trim()}</user-review-message>`
}

function retryPrompt(datasetQuestion) {
    return `The previous response did not satisfy the Curator JSON contract. Re-read the frozen
episode already present in this conversation and return a corrected draft. Use the user-selected
dataset question below verbatim; the original source wording is immutable evidence, not a
replacement evaluation input.

<dataset-question>${String(datasetQuestion ?? "")}</dataset-question>

Do not invent numerical truth, and include every required hard-gating field. Return a short review
note followed by exactly one JSON code block.`
}

function assistantTextFromTurn(turn) {
    return (turn?.items ?? [])
        .filter((item) => item.type === "agentMessage" && String(item.text ?? "").trim())
        .map((item) => String(item.text).trim())
        .join("\n\n")
}

function resolveRuntimeSkill(response, skillPath, runtimeId = null) {
    const selectedPath = String(skillPath ?? "")
    for (const entry of response?.data ?? []) {
        for (const skill of entry.skills ?? []) {
            if (skill?.path !== selectedPath || !skill.enabled) continue
            return {
                schemaVersion: "rolling-skill-skill-reference/v1",
                name: String(skill.name ?? "").trim(),
                path: selectedPath,
                scope: skill.scope ?? null,
                description:
                    skill.description ?? skill.interface?.shortDescription ?? null,
                runtimeId,
                confirmedAt: new Date().toISOString(),
            }
        }
    }
    throw new Error(
        "The selected Skill is not installed and enabled in the current runtime and workspace",
    )
}

class CurationManager {
    constructor({
        store,
        getRuntime,
        getRuntimeDescriptor = () => null,
        onChanged = () => {},
        onActivity = () => {},
        schedule = (task) => Promise.resolve().then(task),
    }) {
        this.store = store
        this.getRuntime = getRuntime
        this.getRuntimeDescriptor = getRuntimeDescriptor
        this.onChanged = onChanged
        this.onActivity = onActivity
        this.schedule = schedule
        this.tasks = new Map()
        this.threadSessions = new Map()
        this.archivedThreadIds = new Set()
        this.activities = new Map()
        for (const session of this.store.listCurationSessions()) {
            if (session.curator.threadId) this.threadSessions.set(session.curator.threadId, session.id)
            if (session.status === "queued" || session.status === "running") {
                this.store.updateCurationSession(session.id, {
                    status: failureState(session),
                    error: "The Curator task was interrupted when Rolling Skill stopped. Retry to continue.",
                    curator: {currentTurnId: null},
                })
            }
        }
    }

    emitChanged(sessionOrId) {
        const session =
            typeof sessionOrId === "string"
                ? this.store.getCurationSession(sessionOrId)
                : sessionOrId
        this.onChanged(session)
        return session
    }

    emitActivity(sessionOrId, patch = {}) {
        const session =
            typeof sessionOrId === "string"
                ? this.store.getCurationSession(sessionOrId)
                : sessionOrId
        const now = Date.now()
        const previous = this.activities.get(session.id)
        const activity = {
            sessionId: session.id,
            stage: patch.stage ?? previous?.stage ?? "starting",
            summary: compactActivityText(patch.summary ?? previous?.summary ?? ""),
            startedAt: previous?.startedAt ?? now,
            lastActivityAt: now,
            terminal: Boolean(patch.terminal),
        }
        if (activity.terminal) this.activities.delete(session.id)
        else this.activities.set(session.id, activity)
        this.onActivity(activity)
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

    async interruptRuntimeTurn(runtime, threadId, turnId) {
        if (!turnId) return false
        try {
            await runtime.interruptTurn(threadId, turnId)
            return true
        } catch {
            return false
        }
    }

    async archiveRuntimeThread(runtime, threadId) {
        if (this.archivedThreadIds.has(threadId)) return true
        try {
            await runtime.archiveThread(threadId)
            this.archivedThreadIds.add(threadId)
            return true
        } catch {
            return false
        }
    }

    async createSession(input) {
        const releaseDataset = this.store.reserveDataset(input.datasetId)
        try {
            return await this.createSessionFromEvidence(input)
        } finally {
            releaseDataset()
        }
    }

    async createSessionFromEvidence(input) {
        const runtime = await this.getRuntime()
        const response = await runtime.readThread(input.sourceThreadId)
        const runtimeDescriptor = this.getRuntimeDescriptor()
        let skillReference = null
        if (input.skillPath) {
            if (typeof runtime.listSkills !== "function") {
                throw new Error("The current runtime cannot verify the selected Skill")
            }
            const skills = await runtime.listSkills({forceReload: true})
            skillReference = resolveRuntimeSkill(
                skills,
                input.skillPath,
                runtimeDescriptor?.runtimeId ?? null,
            )
            if (!skillReference.name) {
                throw new Error("The selected runtime Skill does not have a valid name")
            }
        }
        const curatorModelId = input.modelId ?? response.model ?? response.thread.model ?? null
        const episode = buildEpisodeSnapshot(response.thread, {
            startItemId: input.startItemId,
            startTurnId: input.startTurnId,
            startMessageOrdinal: input.startMessageOrdinal,
            endItemId: input.endItemId,
            endTurnId: input.endTurnId,
            endMessageOrdinal: input.endMessageOrdinal,
            endMessagePosition: input.endMessagePosition,
            runtimeId: runtimeDescriptor?.runtimeId ?? null,
            modelId: input.sourceModelId ?? response.thread.model ?? null,
            traceReference: input.traceReference ?? null,
        })
        const session = this.store.createCurationSession({
            datasetId: input.datasetId,
            caseType: input.caseType,
            datasetQuestion: input.datasetQuestion ?? episode.originalQuestion,
            episode,
            skillReference,
            curator: {
                runtimeId: runtimeDescriptor?.runtimeId ?? null,
                modelProvider: response.thread.modelProvider ?? runtimeDescriptor?.providerId ?? null,
                modelId: curatorModelId,
                effort: input.effort ?? null,
                promptVersion: CURATOR_PROMPT_VERSION,
            },
        })
        this.emitChanged(session)
        this.queue(session.id, () => this.startInitialTurn(session.id))
        return session
    }

    async startInitialTurn(sessionId) {
        try {
            let session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") return session
            this.emitActivity(session, {stage: "starting"})
            const runtime = await this.getRuntime()
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") return session
            const options = {
                sandbox: "read-only",
                approvalPolicy: "never",
                ephemeral: false,
                threadSource: "subagent",
                ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
                ...(session.curator.effort ? {effort: session.curator.effort} : {}),
            }
            const response = await runtime.startThread(options)
            this.threadSessions.set(response.thread.id, sessionId)
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") {
                await this.archiveRuntimeThread(runtime, response.thread.id)
                return session
            }
            session = this.store.updateCurationSession(sessionId, {
                status: "running",
                error: null,
                curator: {
                    threadId: response.thread.id,
                    modelProvider:
                        response.thread.modelProvider ?? session.curator.modelProvider ?? null,
                    effectiveModelId:
                        response.model ?? response.thread.model ?? session.curator.modelId ?? null,
                    effectiveEffort:
                        response.reasoningEffort ??
                        response.thread.reasoningEffort ??
                        response.thread.effort ??
                        session.curator.effort ??
                        null,
                    promptVersion: CURATOR_PROMPT_VERSION,
                },
            })
            const kickoff = `Curate this ${session.caseType} episode. The user-selected dataset question is:\n\n${session.datasetQuestion}\n\nThe immutable source wording remains available in the frozen evidence.`
            session = this.store.appendCurationMessage(sessionId, {role: "user", text: kickoff})
            this.emitChanged(session)
            const prompt = buildCuratorPrompt({
                episode: session.episode,
                datasetQuestion: session.datasetQuestion,
                caseType: session.caseType,
                modelId: session.curator.modelId,
                skillReference: session.skillReference,
            })
            const turnInput = session.skillReference
                ? [
                      {
                          type: "skill",
                          name: session.skillReference.name,
                          path: session.skillReference.path,
                      },
                      {type: "text", text: prompt, text_elements: []},
                  ]
                : prompt
            const turnResponse = await runtime.startTurn(response.thread.id, turnInput, {
                ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
                ...(session.curator.effort ? {effort: session.curator.effort} : {}),
            })
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") {
                await this.interruptRuntimeTurn(runtime, response.thread.id, turnResponse.turn.id)
                await this.archiveRuntimeThread(runtime, response.thread.id)
                return session
            }
            session = this.store.updateCurationSession(sessionId, {
                status: "running",
                curator: {currentTurnId: turnResponse.turn.id},
            })
            this.emitChanged(session)
            this.emitActivity(session, {stage: "analyzing"})
        } catch (error) {
            const current = this.store.getCurationSession(sessionId)
            if (current.status === "cancelled") return current
            const failed = this.store.updateCurationSession(sessionId, {
                status: "failed",
                error: error.message,
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {stage: "failed", summary: error.message, terminal: true})
        }
    }

    sessionForThread(threadId) {
        const sessionId = this.threadSessions.get(threadId)
        return sessionId ? this.store.getCurationSession(sessionId) : null
    }

    async handleNotification(message) {
        const {method, params = {}} = message ?? {}
        if (!params.threadId) return false
        const session = this.sessionForThread(params.threadId)
        if (!session || session.status === "archived" || session.status === "cancelled") return false

        if (method === "thread/settings/updated") {
            const settings = params.threadSettings ?? params.settings ?? {}
            const curator = {}
            if ("model" in settings) curator.effectiveModelId = settings.model ?? null
            if ("effort" in settings || "reasoningEffort" in settings) {
                curator.effectiveEffort = settings.effort ?? settings.reasoningEffort ?? null
            }
            if (Object.keys(curator).length) {
                const updated = this.store.updateCurationSession(session.id, {curator})
                this.emitChanged(updated)
            }
            return true
        }

        if (method === "turn/started") {
            this.emitActivity(session, {stage: "analyzing"})
            return true
        }

        if (method === "item/started" || method === "item/completed") {
            const item = params.item ?? {}
            if (item.type === "reasoning") {
                this.emitActivity(session, {stage: "analyzing", summary: ""})
                return true
            }
            if (item.type === "commandExecution") {
                this.emitActivity(session, {
                    stage: "command",
                    summary: commandSummary(item),
                })
                return true
            }
            if (
                item.type === "mcpToolCall" ||
                item.type === "dynamicToolCall" ||
                item.type === "collabAgentToolCall"
            ) {
                this.emitActivity(session, {stage: "tool", summary: toolSummary(item)})
                return true
            }
            if (item.type === "agentMessage") {
                this.emitActivity(session, {stage: "drafting", summary: ""})
                return true
            }
        }

        if (method === "turn/completed") {
            const turn = params.turn
            if (!turn?.id) return false
            if (session.curator.currentTurnId !== turn.id) return false
            if (session.conversation.some((entry) => entry.role === "assistant" && entry.turnId === turn.id)) {
                return true
            }
            if (turn.status && turn.status !== "completed") {
                const status = failureState(session)
                const error = turn.error?.message ?? `The Curator runtime turn ended with status ${turn.status}`
                const failed = this.store.updateCurationSession(session.id, {
                    status,
                    error,
                    curator: {currentTurnId: null},
                })
                this.emitChanged(failed)
                this.emitActivity(failed, {
                    stage: status === "failed" ? "failed" : "completed",
                    summary: error,
                    terminal: true,
                })
                return true
            }
            const assistantText = assistantTextFromTurn(turn)
            try {
                if (!assistantText) throw new Error("Curator turn completed without an assistant response")
                const draft = parseCuratorDraft(assistantText, {
                    caseType: session.caseType,
                    sourceItemIds: session.episode.items.map((item) => item.id),
                })
                const reviewed = this.store.recordCurationRevision(session.id, {
                    draft,
                    assistantText,
                    turnId: turn.id,
                })
                this.emitChanged(reviewed)
                this.emitActivity(reviewed, {stage: "completed", terminal: true})
            } catch (error) {
                let failed = session
                if (assistantText) {
                    failed = this.store.appendCurationMessage(session.id, {
                        role: "assistant",
                        text: assistantText,
                        turnId: turn.id,
                    })
                }
                const hasValidDraft = Boolean(session.draft)
                failed = this.store.updateCurationSession(session.id, {
                    status: hasValidDraft ? "needs_review" : "failed",
                    error:
                        hasValidDraft && !looksLikeContractRevision(assistantText)
                            ? null
                            : hasValidDraft
                              ? `The last Curator revision was not applied: ${error.message}`
                              : error.message,
                    curator: {currentTurnId: null},
                })
                this.emitChanged(failed)
                this.emitActivity(failed, {
                    stage: hasValidDraft ? "completed" : "failed",
                    summary: hasValidDraft ? "" : error.message,
                    terminal: true,
                })
            }
            return true
        }

        if (method === "error" && !params.willRetry) {
            if (params.turnId && params.turnId !== session.curator.currentTurnId) {
                return false
            }
            const status = failureState(session)
            const failed = this.store.updateCurationSession(session.id, {
                status,
                error: params.error?.message ?? "The Curator runtime turn failed",
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {
                stage: status === "failed" ? "failed" : "completed",
                summary: params.error?.message ?? "The Curator runtime turn failed",
                terminal: true,
            })
            return true
        }
        return false
    }

    async sendMessage(sessionId, text) {
        let session = this.store.getCurationSession(sessionId)
        if (session.status === "archived" || session.status === "cancelled") {
            throw new Error("This curation session is no longer editable")
        }
        if (!session.curator.threadId) throw new Error("The Curator thread has not started")
        if (session.curator.currentTurnId) throw new Error("The Curator is already working")
        session = this.store.appendCurationMessage(sessionId, {role: "user", text})
        session = this.store.updateCurationSession(sessionId, {status: "running", error: null})
        this.emitChanged(session)
        this.emitActivity(session, {stage: "starting", summary: ""})
        try {
            const runtime = await this.getRuntime()
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") return session
            await runtime.resumeThread(session.curator.threadId, {
                cwd: session.episode.source.cwd,
                approvalPolicy: "never",
                sandbox: "read-only",
                ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
            })
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") return session
            const response = await runtime.startTurn(
                session.curator.threadId,
                followUpPrompt(text),
                {
                    ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
                    ...(session.curator.effort ? {effort: session.curator.effort} : {}),
                },
            )
            session = this.store.getCurationSession(sessionId)
            if (session.status === "cancelled") {
                await this.interruptRuntimeTurn(
                    runtime,
                    session.curator.threadId,
                    response.turn.id,
                )
                await this.archiveRuntimeThread(runtime, session.curator.threadId)
                return session
            }
            session = this.store.updateCurationSession(sessionId, {
                status: "running",
                curator: {currentTurnId: response.turn.id},
            })
            return this.emitChanged(session)
        } catch (error) {
            const current = this.store.getCurationSession(sessionId)
            if (current.status === "cancelled") return current
            const status = failureState(current)
            const failed = this.store.updateCurationSession(sessionId, {
                status,
                error: error.message,
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
            this.emitActivity(failed, {
                stage: status === "failed" ? "failed" : "completed",
                summary: error.message,
                terminal: true,
            })
            return failed
        }
    }

    async retry(sessionId) {
        const session = this.store.getCurationSession(sessionId)
        if (session.status !== "failed") throw new Error("Only failed curation can be retried")
        if (!session.curator.threadId) {
            this.queue(sessionId, () => this.startInitialTurn(sessionId))
            await this.waitForIdle(sessionId)
            return this.store.getCurationSession(sessionId)
        }
        return this.sendMessage(sessionId, retryPrompt(session.datasetQuestion))
    }

    updateModel(sessionId, modelId) {
        return this.emitChanged(this.store.updateCurationModel(sessionId, modelId))
    }

    updateEffort(sessionId, effort) {
        return this.emitChanged(this.store.updateCurationEffort(sessionId, effort))
    }

    async discard(sessionId) {
        const current = this.store.getCurationSession(sessionId)
        const discarded = this.store.cancelCurationSession(sessionId)
        this.emitChanged(discarded)
        this.emitActivity(discarded, {stage: "cancelled", terminal: true})
        if (current.curator.threadId) {
            let runtime
            try {
                runtime = await this.getRuntime()
            } catch {
                return discarded
            }
            if (current.curator.currentTurnId) {
                await this.interruptRuntimeTurn(
                    runtime,
                    current.curator.threadId,
                    current.curator.currentTurnId,
                )
            }
            await this.archiveRuntimeThread(runtime, current.curator.threadId)
        }
        return discarded
    }

    async archive(sessionId) {
        const entry = this.store.archiveCurationSession(sessionId)
        const session = this.store.getCurationSession(sessionId)
        this.emitChanged(session)
        if (session.curator.threadId) {
            try {
                const runtime = await this.getRuntime()
                await this.archiveRuntimeThread(runtime, session.curator.threadId)
            } catch {
                // The dataset commit is authoritative; an unavailable runtime must not undo Done.
            }
        }
        return entry
    }

    hiddenThreadIds() {
        return new Set(this.threadSessions.keys())
    }
}

module.exports = {CurationManager, retryPrompt, assistantTextFromTurn, resolveRuntimeSkill}
