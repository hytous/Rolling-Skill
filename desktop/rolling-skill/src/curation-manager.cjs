const {
    CURATOR_PROMPT_VERSION,
    buildCuratorPrompt,
    buildEpisodeSnapshot,
    parseCuratorDraft,
} = require("./episode-curation.cjs")

const RETRY_PROMPT = `The previous response did not satisfy the Curator JSON contract. Re-read the
frozen episode already present in this conversation and return a corrected draft. Preserve the
source question verbatim, do not invent numerical truth, and include every required hard-gating
field. Return a short review note followed by exactly one JSON code block.`

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
        schedule = (task) => Promise.resolve().then(task),
    }) {
        this.store = store
        this.getRuntime = getRuntime
        this.getRuntimeDescriptor = getRuntimeDescriptor
        this.onChanged = onChanged
        this.schedule = schedule
        this.tasks = new Map()
        this.threadSessions = new Map()
        this.archivedThreadIds = new Set()
        for (const session of this.store.listCurationSessions()) {
            if (session.curator.threadId) this.threadSessions.set(session.curator.threadId, session.id)
            if (session.status === "queued" || session.status === "running") {
                this.store.updateCurationSession(session.id, {
                    status: "failed",
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
        const curatorModelId = input.modelId ?? response.thread.model ?? null
        const episode = buildEpisodeSnapshot(response.thread, {
            startItemId: input.startItemId,
            endItemId: input.endItemId,
            runtimeId: runtimeDescriptor?.runtimeId ?? null,
            modelId: input.sourceModelId ?? response.thread.model ?? null,
            traceReference: input.traceReference ?? null,
        })
        const session = this.store.createCurationSession({
            datasetId: input.datasetId,
            caseType: input.caseType,
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
                    modelId: session.curator.modelId ?? response.thread.model ?? null,
                    promptVersion: CURATOR_PROMPT_VERSION,
                },
            })
            const kickoff = `Curate this ${session.caseType} episode. The frozen source question is:\n\n${session.episode.originalQuestion}`
            session = this.store.appendCurationMessage(sessionId, {role: "user", text: kickoff})
            this.emitChanged(session)
            const prompt = buildCuratorPrompt({
                episode: session.episode,
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
        } catch (error) {
            const current = this.store.getCurationSession(sessionId)
            if (current.status === "cancelled") return current
            const failed = this.store.updateCurationSession(sessionId, {
                status: "failed",
                error: error.message,
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
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

        if (method === "turn/completed") {
            const turn = params.turn
            if (!turn?.id) return false
            if (session.curator.currentTurnId && session.curator.currentTurnId !== turn.id) return false
            if (session.conversation.some((entry) => entry.role === "assistant" && entry.turnId === turn.id)) {
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
            } catch (error) {
                let failed = session
                if (assistantText) {
                    failed = this.store.appendCurationMessage(session.id, {
                        role: "assistant",
                        text: assistantText,
                        turnId: turn.id,
                    })
                }
                failed = this.store.updateCurationSession(session.id, {
                    status: "failed",
                    error: error.message,
                    curator: {currentTurnId: null},
                })
                this.emitChanged(failed)
            }
            return true
        }

        if (method === "error" && !params.willRetry) {
            const failed = this.store.updateCurationSession(session.id, {
                status: "failed",
                error: params.error?.message ?? "The Curator runtime turn failed",
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
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
                String(text).trim(),
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
            const failed = this.store.updateCurationSession(sessionId, {
                status: "failed",
                error: error.message,
                curator: {currentTurnId: null},
            })
            this.emitChanged(failed)
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
        return this.sendMessage(sessionId, RETRY_PROMPT)
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

module.exports = {CurationManager, RETRY_PROMPT, assistantTextFromTurn, resolveRuntimeSkill}
