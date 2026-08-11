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

    async createSession(input) {
        const runtime = await this.getRuntime()
        const response = await runtime.readThread(input.sourceThreadId)
        const runtimeDescriptor = this.getRuntimeDescriptor()
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
            curator: {
                runtimeId: runtimeDescriptor?.runtimeId ?? null,
                modelProvider: response.thread.modelProvider ?? runtimeDescriptor?.providerId ?? null,
                modelId: curatorModelId,
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
            const runtime = await this.getRuntime()
            const options = {
                sandbox: "read-only",
                approvalPolicy: "never",
                ephemeral: false,
                threadSource: "subagent",
                ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
            }
            const response = await runtime.startThread(options)
            this.threadSessions.set(response.thread.id, sessionId)
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
            })
            const turnResponse = await runtime.startTurn(response.thread.id, prompt)
            session = this.store.updateCurationSession(sessionId, {
                status: "running",
                curator: {currentTurnId: turnResponse.turn.id},
            })
            this.emitChanged(session)
        } catch (error) {
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
            await runtime.resumeThread(session.curator.threadId, {
                cwd: session.episode.source.cwd,
                approvalPolicy: "never",
                sandbox: "read-only",
                ...(session.curator.modelId ? {model: session.curator.modelId} : {}),
            })
            const response = await runtime.startTurn(session.curator.threadId, String(text).trim())
            session = this.store.updateCurationSession(sessionId, {
                status: "running",
                curator: {currentTurnId: response.turn.id},
            })
            return this.emitChanged(session)
        } catch (error) {
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

    async archive(sessionId) {
        const entry = this.store.archiveCurationSession(sessionId)
        const session = this.store.getCurationSession(sessionId)
        this.emitChanged(session)
        if (session.curator.threadId) {
            try {
                const runtime = await this.getRuntime()
                await runtime.archiveThread(session.curator.threadId)
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

module.exports = {CurationManager, RETRY_PROMPT, assistantTextFromTurn}
