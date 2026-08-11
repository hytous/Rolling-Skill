class AutomaticCaptureManager {
    constructor({store, curationManager, getTraceReference = () => null, onError = () => {}}) {
        this.store = store
        this.curationManager = curationManager
        this.getTraceReference = getTraceReference
        this.onError = onError
        this.pending = new Set()
        this.completed = new Set()
    }

    async handleNotification(message) {
        const {method, params = {}} = message ?? {}
        const settings = this.store.read().settings
        if (!settings.autoCapture || method !== "turn/completed" || !params.threadId) return false
        if (this.curationManager.hiddenThreadIds().has(params.threadId)) return false
        const agentMessages = (params.turn?.items ?? []).filter(
            (item) => item.type === "agentMessage" && String(item.text ?? "").trim(),
        )
        const finalMessage = agentMessages.at(-1)
        if (!finalMessage?.id) return false
        const key = `${params.threadId}:${finalMessage.id}`
        if (
            this.pending.has(key) ||
            this.completed.has(key) ||
            this.store.hasCurationForSource(params.threadId, finalMessage.id)
        ) {
            return false
        }
        const profile = settings.autoCaptureProfile
        if (!profile.skillPath) {
            this.onError(
                new Error(
                    "Automatic capture Skill is not configured. Select an enabled Skill in Settings.",
                ),
            )
            return false
        }
        const datasets = this.store.listDatasets()
        const datasetId = datasets.some((dataset) => dataset.id === profile.datasetId)
            ? profile.datasetId
            : datasets[0]?.id
        if (!datasetId) return false
        this.pending.add(key)
        try {
            await this.curationManager.createSession({
                datasetId,
                caseType: profile.caseType ?? "goodcase",
                sourceThreadId: params.threadId,
                startItemId: null,
                endItemId: finalMessage.id,
                endTurnId: params.turn?.id ?? null,
                endMessagePosition: "last",
                traceReference: this.getTraceReference({
                    threadId: params.threadId,
                    startItemId: null,
                    endItemId: finalMessage.id,
                }),
                modelId: profile.modelId,
                ...(profile.effort ? {effort: profile.effort} : {}),
                skillPath: profile.skillPath,
            })
            this.completed.add(key)
            return true
        } catch (error) {
            this.onError(error)
            return false
        } finally {
            this.pending.delete(key)
        }
    }
}

module.exports = {AutomaticCaptureManager}
